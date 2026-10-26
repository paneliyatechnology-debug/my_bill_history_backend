import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Res,
  HttpStatus,
  HttpCode,
  BadRequestException,
} from "@nestjs/common";
import { FastifyRequest, FastifyReply } from "fastify";
import { TenantContext, UserRole } from "@billing/shared-types";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ImportsService } from "./imports.service";
import { ValidateImportDto } from "./dto/validate-import.dto";
import { ConfirmImportDto } from "./dto/confirm-import.dto";
import { Public } from "../common/decorators/public.decorator";

@Controller("imports")
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  /**
   * 1. List all supported importable modules
   */
  @Public()
  @Get("modules")
  getModules() {
    return this.importsService.getModules();
  }

  /**
   * 2. Get import schema for a module
   */
  @Public()
  @Get(":module/schema")
  getModuleSchema(@Param("module") moduleName: string) {
    return this.importsService.getSchema(moduleName);
  }

  /**
   * 3. Download template for a module (XLSX or CSV)
   */
  @Public()
  @Get(":module/template")
  async downloadTemplate(
    @Param("module") moduleName: string,
    @Query("format") format: "xlsx" | "csv" = "xlsx",
    @Res() reply: FastifyReply,
  ) {
    const file = this.importsService.getTemplate(moduleName, format);
    reply.header("Content-Type", file.mimeType);
    reply.header(
      "Content-Disposition",
      `attachment; filename="${file.fileName}"`,
    );
    return reply.send(file.buffer);
  }

  /**
   * 4. Upload & Parse File (Supports both multipart form-data and JSON base64)
   */
  @Post("parse")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async parseFile(
    @Req() req: FastifyRequest,
    @Query("module") moduleQuery: string,
    @Query("sheet") sheetQuery: string,
    @CurrentTenant() ctx: TenantContext,
  ) {
    let fileBuffer: Buffer | null = null;
    let fileName = "import.xlsx";
    let targetModule = moduleQuery;
    let worksheetName = sheetQuery;

    // Check multipart
    if ((req as any).isMultipart && (req as any).isMultipart()) {
      const parts = (req as any).parts();
      for await (const part of parts) {
        if (part.type === "file") {
          fileBuffer = await part.toBuffer();
          fileName = part.filename || "import.xlsx";
        } else if (part.fieldname === "module") {
          targetModule = part.value as string;
        } else if (part.fieldname === "worksheet") {
          worksheetName = part.value as string;
        }
      }
    } else {
      // JSON body with base64
      const body = (req.body || {}) as any;
      if (body.fileBase64) {
        fileBuffer = Buffer.from(body.fileBase64, "base64");
        fileName = body.fileName || "import.xlsx";
        targetModule = body.module || targetModule;
        worksheetName = body.worksheetName || worksheetName;
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: "No file was uploaded. Please upload an Excel (.xlsx) or CSV (.csv) file.",
        messageGujarati: "કોઈ ફાઇલ મળી નથી. એક્સેલ અથવા સીએસવી ફાઇલ પસંદ કરો.",
      });
    }

    return await this.importsService.parseUploadedFile(
      ctx,
      fileBuffer,
      fileName,
      targetModule,
      worksheetName,
    );
  }

  /**
   * 5. Validate column mapping & generate preview
   */
  @Post("validate")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async validateMapping(
    @Body() dto: ValidateImportDto,
    @CurrentTenant() ctx: TenantContext,
  ) {
    if (!dto.jobId || !dto.module || !dto.mapping) {
      throw new BadRequestException({
        statusCode: 400,
        message: "jobId, module, and column mapping are required.",
      });
    }

    return await this.importsService.validateMapping(
      ctx,
      dto.jobId,
      dto.module,
      dto.mapping,
      dto.mode,
    );
  }

  /**
   * 6. Confirm & execute import
   */
  @Post("execute")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async executeImport(
    @Body() dto: ConfirmImportDto,
    @CurrentTenant() ctx: TenantContext,
  ) {
    if (!dto.jobId || !dto.module || !dto.mapping) {
      throw new BadRequestException({
        statusCode: 400,
        message: "jobId, module, and column mapping are required to execute import.",
      });
    }

    return await this.importsService.confirmAndExecute(
      ctx,
      dto.jobId,
      dto.module,
      dto.mapping,
      dto.mode,
      dto.errorPolicy,
    );
  }

  /**
   * 7. List import history jobs
   */
  @Get("jobs")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async getJobs(@CurrentTenant() ctx: TenantContext) {
    return await this.importsService.getJobs(ctx);
  }

  /**
   * 8. Get job by ID
   */
  @Get("jobs/:jobId")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async getJobById(
    @Param("jobId") jobId: string,
    @CurrentTenant() ctx: TenantContext,
  ) {
    return await this.importsService.getJobById(ctx, jobId);
  }

  /**
   * 9. Download diagnostic error report
   */
  @Get("jobs/:jobId/errors")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async downloadErrorReport(
    @Param("jobId") jobId: string,
    @Query("format") format: "xlsx" | "csv" = "xlsx",
    @CurrentTenant() ctx: TenantContext,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.importsService.downloadErrorReport(ctx, jobId, format);
    reply.header("Content-Type", file.mimeType);
    reply.header(
      "Content-Disposition",
      `attachment; filename="${file.fileName}"`,
    );
    return reply.send(file.buffer);
  }
}
