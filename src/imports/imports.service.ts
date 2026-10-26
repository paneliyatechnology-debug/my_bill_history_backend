import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { ImportSchemaRegistry } from "./import-schema.registry";
import { FileParserService } from "./file-parser.service";
import { TemplateGeneratorService } from "./template-generator.service";
import { ImportValidatorService } from "./import-validator.service";
import { ImportExecutorService } from "./import-executor.service";
import { ErrorReporterService } from "./error-reporter.service";
import {
  ImportErrorPolicy,
  ImportJobDto,
  ImportMode,
  ImportModuleSchema,
  ImportModuleType,
  ImportParseResult,
  ImportPreviewResult,
  ImportStatus,
  TenantContext,
} from "@billing/shared-types";

// In-memory cache for parsed raw sheets during the wizard flow before execution
interface CachedParsedFile {
  jobId: string;
  companyId: string;
  fileName: string;
  fileBuffer: Buffer;
  parsedRows: Record<string, any>[];
  headers: string[];
  module?: string;
  mapping?: Record<string, string>;
  createdAt: number;
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);
  private readonly parsedFilesCache = new Map<string, CachedParsedFile>();

  constructor(
    private readonly prisma: DatabaseService,
    private readonly schemaRegistry: ImportSchemaRegistry,
    private readonly fileParser: FileParserService,
    private readonly templateGenerator: TemplateGeneratorService,
    private readonly validator: ImportValidatorService,
    private readonly executor: ImportExecutorService,
    private readonly errorReporter: ErrorReporterService,
  ) {
    // Evict expired cached parsed files older than 1 hour every 15 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [key, item] of this.parsedFilesCache.entries()) {
        if (now - item.createdAt > 3600000) {
          this.parsedFilesCache.delete(key);
        }
      }
    }, 900000);
  }

  /**
   * 1. Get all supported import modules
   */
  getModules(): ImportModuleSchema[] {
    return this.schemaRegistry.getAllSchemas();
  }

  /**
   * 2. Get schema for a specific module
   */
  getSchema(moduleName: string): ImportModuleSchema {
    const schema = this.schemaRegistry.getSchema(moduleName);
    if (!schema) {
      throw new NotFoundException({
        statusCode: 404,
        message: `Import module '${moduleName}' not found.`,
      });
    }
    return schema;
  }

  /**
   * 3. Download module template (XLSX or CSV)
   */
  getTemplate(moduleName: string, format: "xlsx" | "csv" = "xlsx"): { buffer: Buffer; fileName: string; mimeType: string } {
    const schema = this.getSchema(moduleName);
    const baseName = `${schema.module}-import-template`;

    if (format === "csv") {
      const buffer = this.templateGenerator.generateCsvTemplate(schema.module);
      return {
        buffer,
        fileName: `${baseName}.csv`,
        mimeType: "text/csv; charset=utf-8",
      };
    }

    const buffer = this.templateGenerator.generateExcelTemplate(schema.module);
    return {
      buffer,
      fileName: `${baseName}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }

  /**
   * 4. Upload & Parse File
   */
  async parseUploadedFile(
    ctx: TenantContext,
    fileBuffer: Buffer,
    fileName: string,
    targetModule?: string,
    worksheetName?: string,
  ): Promise<ImportParseResult> {
    const parsed = this.fileParser.parseBuffer(fileBuffer, fileName, worksheetName);

    const schema = targetModule ? this.schemaRegistry.getSchema(targetModule) : undefined;
    const detectedMapping = schema
      ? this.fileParser.detectColumnMapping(parsed.headers, schema.fields)
      : {};

    // Create persistent ImportJob record in DB with resilient in-memory fallback
    const fileFormat = fileName.toLowerCase().endsWith(".csv") ? "CSV" : "XLSX";
    let jobId: string = randomUUID();

    try {
      const job = await this.prisma.executeBypassRls(async (tx) => {
        return tx.importJob.create({
          data: {
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            userId: ctx.userId || null,
            module: targetModule || "parties",
            fileName,
            fileSize: fileBuffer.length,
            fileFormat,
            worksheetName: parsed.selectedWorksheet,
            status: "PARSING",
            totalRows: parsed.totalRows,
            columnMapping: detectedMapping as any,
          },
        });
      });
      jobId = job.id;
    } catch (err: any) {
      this.logger.warn(
        `Notice: Could not persist importJob in DB (using resilient in-memory session ${jobId}): ${err?.message}`,
      );
    }

    // Cache in memory for quick step-by-step wizard preview & execution
    this.parsedFilesCache.set(jobId, {
      jobId,
      companyId: ctx.companyId,
      fileName,
      fileBuffer,
      parsedRows: parsed.rows,
      headers: parsed.headers,
      module: targetModule,
      mapping: detectedMapping,
      createdAt: Date.now(),
    });

    return {
      jobId,
      fileName,
      fileFormat,
      fileSize: fileBuffer.length,
      worksheets: parsed.worksheets,
      selectedWorksheet: parsed.selectedWorksheet,
      headers: parsed.headers,
      detectedMapping,
      totalRows: parsed.totalRows,
      sampleRows: parsed.rows.slice(0, 5),
    };
  }

  /**
   * 5. Validate mapped columns & generate preview
   */
  async validateMapping(
    ctx: TenantContext,
    jobId: string,
    moduleName: string,
    mapping: Record<string, string>,
    mode: ImportMode = ImportMode.SKIP_DUPLICATES,
  ): Promise<ImportPreviewResult> {
    const cached = this.parsedFilesCache.get(jobId);
    if (!cached || cached.companyId !== ctx.companyId) {
      throw new NotFoundException({
        statusCode: 404,
        message: "Import session expired or not found. Please upload your file again.",
        messageGujarati: "આયાત સત્ર સમાપ્ત થઈ ગયું છે. કૃપા કરીને ફાઇલ ફરીથી અપલોડ કરો.",
      });
    }

    cached.module = moduleName;
    cached.mapping = mapping;

    const preview = await this.validator.validateDataset(
      ctx,
      moduleName,
      cached.parsedRows,
      mapping,
      mode,
    );

    preview.jobId = jobId;

    // Update job status in DB if table is accessible
    try {
      await this.prisma.executeBypassRls(async (tx) => {
        return tx.importJob.update({
          where: { id: jobId },
          data: {
            module: moduleName,
            status: "VALIDATING",
            mode: mode as any,
            columnMapping: mapping as any,
            validRows: preview.validRows,
          },
        });
      });
    } catch (err: any) {
      this.logger.debug(`Import job status update skipped: ${err?.message}`);
    }

    return preview;
  }

  /**
   * 6. Confirm and execute import
   */
  async confirmAndExecute(
    ctx: TenantContext,
    jobId: string,
    moduleName: string,
    mapping: Record<string, string>,
    mode: ImportMode = ImportMode.SKIP_DUPLICATES,
    errorPolicy: ImportErrorPolicy = ImportErrorPolicy.IMPORT_VALID_ONLY,
  ): Promise<ImportJobDto> {
    const cached = this.parsedFilesCache.get(jobId);
    if (!cached || cached.companyId !== ctx.companyId) {
      throw new NotFoundException({
        statusCode: 404,
        message: "Import session expired. Please re-upload your file to proceed.",
        messageGujarati: "આયાત સત્ર સમાપ્ત થઈ ગયું છે. કૃપા કરીને ફરીથી અપલોડ કરો.",
      });
    }

    // Run authoritative validation pass
    const preview = await this.validator.validateDataset(
      ctx,
      moduleName,
      cached.parsedRows,
      mapping,
      mode,
    );

    // Execute through transaction-safe executor
    const result = await this.executor.executeImport(
      ctx,
      jobId,
      moduleName,
      preview.rows,
      mode,
      errorPolicy,
    );

    // Evict cached memory
    this.parsedFilesCache.delete(jobId);

    return result;
  }

  /**
   * 7. List import jobs for current company
   */
  async getJobs(ctx: TenantContext): Promise<ImportJobDto[]> {
    try {
      const jobs = await this.prisma.executeBypassRls(async (tx) => {
        return tx.importJob.findMany({
          where: { companyId: ctx.companyId },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
      });

      return jobs.map((j) => this.mapDbJobToDto(j));
    } catch (err: any) {
      this.logger.warn(`Could not query importJob table: ${err?.message}`);
      return [];
    }
  }

  /**
   * 8. Get job by ID
   */
  async getJobById(ctx: TenantContext, jobId: string): Promise<ImportJobDto> {
    try {
      const job = await this.prisma.executeBypassRls(async (tx) => {
        return tx.importJob.findFirst({
          where: { id: jobId, companyId: ctx.companyId },
        });
      });

      if (job) {
        return this.mapDbJobToDto(job);
      }
    } catch (err: any) {
      this.logger.debug(`Import job DB lookup error: ${err?.message}`);
    }

    const cached = this.parsedFilesCache.get(jobId);
    if (cached && cached.companyId === ctx.companyId) {
      return {
        id: jobId,
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        userId: ctx.userId,
        module: (cached.module || "parties") as any,
        fileName: cached.fileName,
        fileSize: cached.fileBuffer.length,
        fileFormat: cached.fileName.toLowerCase().endsWith(".csv") ? "CSV" : "XLSX",
        status: ImportStatus.PARSING,
        mode: ImportMode.SKIP_DUPLICATES,
        errorPolicy: ImportErrorPolicy.IMPORT_VALID_ONLY,
        totalRows: cached.parsedRows.length,
        validRows: cached.parsedRows.length,
        importedRows: 0,
        updatedRows: 0,
        skippedRows: 0,
        failedRows: 0,
        createdAt: new Date(cached.createdAt).toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    throw new NotFoundException({
      statusCode: 404,
      message: `Import job '${jobId}' not found.`,
    });
  }

  /**
   * 9. Download error report
   */
  async downloadErrorReport(
    ctx: TenantContext,
    jobId: string,
    format: "xlsx" | "csv" = "xlsx",
  ): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    const job = await this.getJobById(ctx, jobId);
    const errors = job.errors || [];
    const baseName = `${job.module}-import-errors-${jobId.slice(0, 8)}`;

    if (format === "csv") {
      const buffer = this.errorReporter.generateCsvErrorReport(jobId, job.module, errors);
      return {
        buffer,
        fileName: `${baseName}.csv`,
        mimeType: "text/csv; charset=utf-8",
      };
    }

    const buffer = this.errorReporter.generateExcelErrorReport(jobId, job.module, errors);
    return {
      buffer,
      fileName: `${baseName}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }

  private mapDbJobToDto(job: any): ImportJobDto {
    return {
      id: job.id,
      organizationId: job.organizationId,
      companyId: job.companyId,
      userId: job.userId || undefined,
      module: job.module as ImportModuleType,
      fileName: job.fileName,
      fileSize: job.fileSize,
      fileFormat: job.fileFormat,
      worksheetName: job.worksheetName || undefined,
      status: job.status as ImportStatus,
      mode: job.mode as ImportMode,
      errorPolicy: (job.errorPolicy || "IMPORT_VALID_ONLY") as ImportErrorPolicy,
      totalRows: job.totalRows,
      validRows: job.validRows,
      importedRows: job.importedRows,
      updatedRows: job.updatedRows,
      skippedRows: job.skippedRows,
      failedRows: job.failedRows,
      columnMapping: (job.columnMapping as any) || undefined,
      errors: (job.errorsJson as any) || [],
      summary: (job.summaryJson as any) || undefined,
      errorMessage: job.errorMessage || undefined,
      idempotencyKey: job.idempotencyKey || undefined,
      startedAt: job.startedAt ? job.startedAt.toISOString() : undefined,
      completedAt: job.completedAt ? job.completedAt.toISOString() : undefined,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }
}
