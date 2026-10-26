import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
} from "@nestjs/common";
import { TenantContext } from "@billing/shared-types";
import { DatabaseService } from "../../../database/database.service";
import { AuditService } from "../../../audit/audit.service";
import { PurchasesService } from "../../purchases.service";
import { BillStorageService } from "./bill-storage.service";
import { BillNormalizerService } from "./bill-normalizer.service";
import { BillMatcherService } from "./bill-matcher.service";
import { OcrProviderFactory } from "../providers/ocr-provider.factory";
import {
  ConfirmPurchaseScanDto,
  UpdateScanDraftDto,
  ExtractedBillDataDto,
} from "../schemas/bill-extraction.schema";
import { isValidGstinChecksum } from "../../../common/validators/gstin.validator";

@Injectable()
export class PurchaseScannerService {
  private readonly logger = new Logger(PurchaseScannerService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: BillStorageService,
    private readonly normalizer: BillNormalizerService,
    private readonly matcher: BillMatcherService,
    private readonly ocrFactory: OcrProviderFactory,
    private readonly purchasesService: PurchasesService,
  ) {}

  /**
   * Uploads, extracts, normalizes, matches, and creates a PurchaseBillScan draft.
   * When isAsync is true, returns immediately after storing file with status: PROCESSING,
   * running OCR and document intelligence asynchronously in the background.
   */
  async uploadAndProcessBill(
    fileBuffer: Buffer,
    fileName: string,
    declaredMimeType: string,
    tenant: TenantContext,
    idempotencyKey?: string,
    requestedProvider?: string,
    isAsync: boolean = false,
  ): Promise<any> {
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException("Uploaded file buffer cannot be empty.");
    }

    const uploadStartTime = Date.now();

    // 1. Check Idempotency Key
    if (idempotencyKey) {
      const existingKey = await this.prisma.purchaseBillScan.findFirst({
        where: {
          companyId: tenant.companyId,
          idempotencyKey: idempotencyKey.trim(),
        },
        include: {
          matchedParty: true,
          purchaseInvoice: true,
        },
      });
      if (existingKey) {
        this.logger.log(`Idempotent replay detected for key: ${idempotencyKey}`);
        return existingKey;
      }
    }

    // 2. Validate and Store File
    const scanId = crypto.randomUUID();
    const storedFile = await this.storage.validateAndSaveFile(
      fileBuffer,
      fileName,
      tenant.companyId,
      scanId,
    );

    // 3. Resolve Company Context (e.g. state code, GSTIN)
    const company = await this.prisma.company.findUnique({
      where: { id: tenant.companyId },
      select: { stateCode: true, legalName: true, gstin: true },
    });

    // 4. Initial Pending Record
    const initialScan = await this.prisma.executeInTenantContext(
      tenant,
      async (tx) => {
        return tx.purchaseBillScan.create({
          data: {
            id: scanId,
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            branchId: tenant.branchId || null,
            fileName: storedFile.fileName,
            fileMimeType: storedFile.mimeType,
            fileSizeBytes: storedFile.sizeBytes,
            fileStoragePath: storedFile.storagePath,
            fileSha256: storedFile.sha256,
            status: "PROCESSING",
            ocrProvider: requestedProvider || "gemini",
            idempotencyKey: idempotencyKey || null,
            createdById: tenant.userId || null,
          },
        });
      },
    );

    const storageDurationMs = Date.now() - uploadStartTime;
    this.logger.log(
      `[DIAGNOSTIC] Stage: UPLOAD_STORED | ScanId: ${scanId} | StorageDurationMs: ${storageDurationMs} | Async: ${isAsync} | Provider: ${requestedProvider || "gemini"}`,
    );

    // 5. Asynchronous path: return prompt response to client and process in background
    if (isAsync) {
      setImmediate(() => {
        this.processScanOcr(
          scanId,
          tenant,
          requestedProvider,
          fileBuffer,
          storedFile,
          company,
          true,
        ).catch((err) => {
          this.logger.error(
            `[DIAGNOSTIC] Stage: ASYNC_BACKGROUND_OCR_FAILED | ScanId: ${scanId} | Error: ${err.message}`,
            err.stack,
          );
        });
      });

      return {
        id: scanId,
        status: "PROCESSING",
        fileName: storedFile.fileName,
        fileSizeBytes: storedFile.sizeBytes,
        fileMimeType: storedFile.mimeType,
        ocrProvider: requestedProvider || "gemini",
        createdAt: initialScan.createdAt,
      };
    }

    // Synchronous execution for legacy / non-async callers
    return await this.processScanOcr(
      scanId,
      tenant,
      requestedProvider,
      fileBuffer,
      storedFile,
      company,
      false,
    );
  }

  /**
   * Performs OCR extraction, normalization, item/supplier matching, duplicate detection,
   * and updates the PurchaseBillScan record to READY_FOR_REVIEW or FAILED.
   */
  async processScanOcr(
    scanId: string,
    tenant: TenantContext,
    requestedProvider?: string,
    preloadedBuffer?: Buffer,
    preloadedStoredFile?: { fileName: string; mimeType: string; storagePath: string; sha256: string },
    preloadedCompany?: { stateCode?: string | null; legalName?: string | null; gstin?: string | null } | null,
    isAsync: boolean = true,
  ): Promise<any> {
    const startTime = Date.now();

    // 1. Load scan metadata and file buffer if not preloaded (e.g., in retry)
    let storedFile = preloadedStoredFile;
    let fileBuffer = preloadedBuffer;
    let company = preloadedCompany;

    if (!storedFile || !fileBuffer) {
      const scan = await this.prisma.executeInTenantContext(tenant, async (tx) => {
        return tx.purchaseBillScan.findFirst({
          where: { id: scanId, companyId: tenant.companyId },
        });
      });

      if (!scan) {
        throw new NotFoundException(`Purchase bill scan '${scanId}' not found.`);
      }

      storedFile = {
        fileName: scan.fileName,
        mimeType: scan.fileMimeType,
        storagePath: scan.fileStoragePath,
        sha256: scan.fileSha256,
      };

      fileBuffer = await this.storage.readFile(scan.fileStoragePath);
    }

    if (company === undefined) {
      company = await this.prisma.company.findUnique({
        where: { id: tenant.companyId },
        select: { stateCode: true, legalName: true, gstin: true },
      });
    }

    // 2. OCR & AI Extraction
    let ocrResult: any;
    const provider = this.ocrFactory.getProvider(requestedProvider);
    this.logger.log(
      `[DIAGNOSTIC] Stage: OCR_START | ScanId: ${scanId} | File: ${storedFile.fileName} | Mime: ${storedFile.mimeType} | SizeBytes: ${fileBuffer.length} | Provider: ${provider.name} (available: ${provider.isAvailable()})`,
    );

    try {
      ocrResult = await provider.extractInvoice(fileBuffer, storedFile.mimeType, {
        fileName: storedFile.fileName,
        mimeType: storedFile.mimeType,
        companyStateCode: company?.stateCode || "24",
        companyGstin: company?.gstin || undefined,
        companyName: company?.legalName || undefined,
      });

      const ocrDurationMs = Date.now() - startTime;
      this.logger.log(
        `[DIAGNOSTIC] Stage: OCR_COMPLETED | ScanId: ${scanId} | DurationMs: ${ocrDurationMs} | Provider: ${ocrResult.provider} | HasRawText: ${!!ocrResult.rawText} | RawTextLength: ${ocrResult.rawText?.length || 0} | ExtractedItems: ${ocrResult.extractedData?.items?.length || 0}`,
      );
    } catch (err: any) {
      const allowLocalFallback = process.env.ALLOW_LOCAL_FALLBACK !== "false";
      if (allowLocalFallback && provider.name !== "local") {
        this.logger.warn(`Primary OCR provider '${provider.name}' failed (${err?.message}). Attempting fallback to local OCR provider...`);
        try {
          const localProvider = this.ocrFactory.getProvider("local");
          ocrResult = await localProvider.extractInvoice(fileBuffer, storedFile.mimeType, {
            fileName: storedFile.fileName,
            mimeType: storedFile.mimeType,
            companyStateCode: company?.stateCode || "24",
            companyGstin: company?.gstin || undefined,
            companyName: company?.legalName || undefined,
          });
          this.logger.log(`[DIAGNOSTIC] Fallback to local OCR provider succeeded for scanId: ${scanId}`);
        } catch (localFallbackErr: any) {
          err = localFallbackErr;
        }
      }

      if (!ocrResult) {
        const durationMs = Date.now() - startTime;
        const classified = this.classifyOcrError(err, durationMs);

        this.logger.error(
          `[DIAGNOSTIC] Stage: OCR_FAILED | ScanId: ${scanId} | DurationMs: ${durationMs} | Category: ${classified.category} | Error: ${classified.message}`,
          err.stack,
        );

        await this.prisma.purchaseBillScan.update({
          where: { id: scanId },
          data: {
            status: "FAILED",
            errorMessage: classified.message,
          },
        });

      await this.audit.record({
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        userId: tenant.userId || "system",
        action: "PURCHASE_BILL_SCAN_FAILED",
        entityName: "PurchaseBillScan",
        entityId: scanId,
        newState: {
          errorCategory: classified.category,
          error: classified.message,
          fileName: storedFile.fileName,
          durationMs,
        },
      });

      if (!isAsync) {
        if (err instanceof HttpException) {
          throw err;
        }
        throw new BadRequestException(classified.message);
      }
      return;
    }
  }

    // 3. Normalization
    const normalizedData = this.normalizer.normalizeBillData(
      ocrResult.extractedData,
      company?.stateCode || "24",
    );

    // 4. Intelligent Supplier & Item Matching
    const supplierMatch = await this.matcher.matchSupplier(
      normalizedData.supplier,
      tenant,
    );

    normalizedData.supplier = {
      ...normalizedData.supplier,
      matchedPartyId: supplierMatch.matchedPartyId,
      matchedPartyName: supplierMatch.matchedPartyName,
      matchedPartyGstin: supplierMatch.matchedPartyGstin,
      matchedPartyScore: supplierMatch.matchedPartyScore,
      isNewSupplier: supplierMatch.isNewSupplier,
    };

    if (normalizedData.buyer) {
      const buyerMatch = await this.matcher.matchCustomer(
        normalizedData.buyer,
        tenant,
      );
      normalizedData.buyer = {
        ...normalizedData.buyer,
        matchedPartyId: buyerMatch.matchedPartyId,
        matchedPartyName: buyerMatch.matchedPartyName,
        matchedPartyScore: buyerMatch.matchedPartyScore,
      };
    }

    normalizedData.items = await this.matcher.matchAllItems(
      normalizedData.items,
      tenant,
    );

    // 5. Duplicate Invoice Detection (Check vendor invoice number against company purchase invoices)
    if (
      normalizedData.invoice?.invoiceNumber &&
      supplierMatch.matchedPartyId
    ) {
      const duplicateInvoice = await this.prisma.purchaseInvoice.findFirst({
        where: {
          companyId: tenant.companyId,
          partyId: supplierMatch.matchedPartyId,
          vendorInvoiceNumber: normalizedData.invoice.invoiceNumber.trim(),
        },
      });
      if (duplicateInvoice) {
        normalizedData.invoice.isDuplicateWarning = true;
        normalizedData.documentMetadata.warnings.push(
          `Warning: Vendor invoice '${normalizedData.invoice.invoiceNumber}' already exists for this supplier in the system.`,
        );
      }
    }

    // Check duplicate file upload warning in company
    const existingSameFile = await this.prisma.purchaseBillScan.findFirst({
      where: {
        companyId: tenant.companyId,
        fileSha256: storedFile.sha256,
        id: { not: scanId },
      },
    });
    if (existingSameFile) {
      normalizedData.documentMetadata.warnings.push(
        "Notice: An identical bill file (matching SHA-256) has previously been uploaded to this company.",
      );
    }

    // 6. Update Scan to READY_FOR_REVIEW
    const updatedScan = await this.prisma.executeInTenantContext(
      tenant,
      async (tx) => {
        const engineName = ocrResult.extractedData?.documentMetadata?.engine;
        const resolvedProvider = engineName ? `${ocrResult.provider}:${engineName}` : ocrResult.provider;

        return tx.purchaseBillScan.update({
          where: { id: scanId },
          data: {
            status: "READY_FOR_REVIEW",
            ocrProvider: resolvedProvider,
            extractedData: normalizedData as any,
            rawOcrText: ocrResult.rawText || null,
            matchedPartyId: supplierMatch.matchedPartyId,
            matchedPartyScore: supplierMatch.matchedPartyScore,
            errorMessage: null,
          },
          include: {
            matchedParty: true,
          },
        });
      },
    );

    // 7. Audit Event
    await this.audit.record({
      organizationId: tenant.organizationId,
      companyId: tenant.companyId,
      userId: tenant.userId || "system",
      action: "PURCHASE_BILL_SCAN_UPLOADED",
      entityName: "PurchaseBillScan",
      entityId: scanId,
      newState: {
        fileName: storedFile.fileName,
        provider: ocrResult.provider,
        matchedPartyId: supplierMatch.matchedPartyId,
        itemCount: normalizedData.items.length,
      },
    });

    this.logger.log(
      `[DIAGNOSTIC] Stage: DRAFT_SAVED | ScanId: ${scanId} | Status: READY_FOR_REVIEW | MatchedParty: ${supplierMatch.matchedPartyId ? "MATCHED" : "NEW"} | FinalItems: ${normalizedData.items.length} | TotalDurationMs: ${Date.now() - startTime}`,
    );

    return updatedScan;
  }

  /**
   * Classifies OCR failure into distinct actionable categories:
   * - INVALID_API_KEY
   * - RATE_LIMIT_OR_QUOTA
   * - TIMEOUT
   * - NETWORK_ERROR
   * - DOCUMENT_PARSE_ERROR
   * - OCR_PROCESSING_FAILED
   */
  classifyOcrError(err: any, durationMs?: number): { category: string; message: string } {
    const rawMsg = (err?.message || String(err)).toLowerCase();
    const status = err?.status || err?.statusCode || err?.response?.status;

    if (
      rawMsg.includes("api key not valid") ||
      rawMsg.includes("api_key_invalid") ||
      rawMsg.includes("unauthorized") ||
      rawMsg.includes("gemini_api_key is not configured")
    ) {
      return {
        category: "INVALID_API_KEY",
        message: "Gemini API key is invalid or not configured on the server.",
      };
    }

    if (
      status === 429 ||
      rawMsg.includes("quota") ||
      rawMsg.includes("resource_exhausted") ||
      rawMsg.includes("rate limit") ||
      rawMsg.includes("too many requests")
    ) {
      return {
        category: "RATE_LIMIT_OR_QUOTA",
        message: "Gemini Vision rate limit or quota exceeded. Please wait a moment and click Retry OCR.",
      };
    }

    if (
      err?.name === "GatewayTimeoutException" ||
      rawMsg.includes("timed out") ||
      rawMsg.includes("timeout") ||
      status === 504 ||
      status === 408
    ) {
      return {
        category: "TIMEOUT",
        message: `OCR document analysis timed out${durationMs ? ` after ${Math.round(durationMs / 1000)}s` : ""}. Click Retry OCR to try again.`,
      };
    }

    if (
      rawMsg.includes("fetch failed") ||
      rawMsg.includes("enotfound") ||
      rawMsg.includes("econnrefused") ||
      rawMsg.includes("econnreset") ||
      rawMsg.includes("network")
    ) {
      return {
        category: "NETWORK_ERROR",
        message: "Network failure while connecting to OCR service. Please check server internet connectivity and click Retry OCR.",
      };
    }

    if (
      rawMsg.includes("unparseable json") ||
      rawMsg.includes("invalid or unparseable json") ||
      rawMsg.includes("empty extraction response") ||
      rawMsg.includes("could not parse") ||
      rawMsg.includes("invalid_union") ||
      rawMsg.includes("invalid_type") ||
      (rawMsg.startsWith("[") && rawMsg.includes('"code"')) ||
      rawMsg.includes("zoderror")
    ) {
      return {
        category: "DOCUMENT_PARSE_ERROR",
        message: "AI document extraction encountered incomplete item fields (e.g. taxable amount or tax rate). Please click Retry OCR or verify the image is clear.",
      };
    }

    return {
      category: "OCR_PROCESSING_FAILED",
      message: err?.message || "OCR document extraction failed. Please retry.",
    };
  }

  /**
   * Retries OCR processing for an existing scan record without uploading duplicate documents.
   */
  async retryScanOcr(
    id: string,
    tenant: TenantContext,
    requestedProvider?: string,
  ): Promise<any> {
    const scan = await this.prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.purchaseBillScan.findFirst({
        where: { id, companyId: tenant.companyId },
      });
    });

    if (!scan) {
      throw new NotFoundException(`Purchase bill scan '${id}' not found.`);
    }

    if (scan.status === "CONFIRMED") {
      throw new BadRequestException("Cannot retry an already confirmed purchase bill scan.");
    }

    // Set status back to PROCESSING and clear previous error message
    const updated = await this.prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.purchaseBillScan.update({
        where: { id },
        data: {
          status: "PROCESSING",
          errorMessage: null,
          ocrProvider: requestedProvider || scan.ocrProvider,
        },
      });
    });

    this.logger.log(
      `[DIAGNOSTIC] Stage: RETRY_INITIATED | ScanId: ${id} | CompanyId: ${tenant.companyId} | Provider: ${requestedProvider || scan.ocrProvider}`,
    );

    // Run OCR asynchronously in background
    setImmediate(() => {
      this.processScanOcr(id, tenant, requestedProvider || scan.ocrProvider).catch((err) => {
        this.logger.error(`Background retry OCR failed for scan ${id}: ${err.message}`, err.stack);
      });
    });

    return {
      id: scan.id,
      status: "PROCESSING",
      message: "OCR processing re-initiated.",
      ocrProvider: requestedProvider || scan.ocrProvider,
      fileName: scan.fileName,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Retrieves paginated list of scans for current tenant.
   */
  async getScans(
    tenant: TenantContext,
    status?: string,
    search?: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<any> {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const skip = (page - 1) * limit;
      const where: any = {
        companyId: tenant.companyId,
      };

      if (status) {
        where.status = status as any;
      }
      if (search) {
        where.OR = [
          { fileName: { contains: search, mode: "insensitive" } },
          { matchedParty: { name: { contains: search, mode: "insensitive" } } },
        ];
      }

      const [items, total] = await Promise.all([
        tx.purchaseBillScan.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            matchedParty: {
              select: { id: true, name: true, gstin: true, phone: true },
            },
            purchaseInvoice: {
              select: {
                id: true,
                vendorInvoiceNumber: true,
                grandTotal: true,
                createdAt: true,
              },
            },
          },
        }),
        tx.purchaseBillScan.count({ where }),
      ]);

      return {
        data: items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  /**
   * Retrieves single scan by ID.
   */
  async getScanById(id: string, tenant: TenantContext): Promise<any> {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const scan = await tx.purchaseBillScan.findFirst({
        where: { id, companyId: tenant.companyId },
        include: {
          matchedParty: true,
          purchaseInvoice: {
            include: {
              items: {
                include: { item: true },
              },
            },
          },
        },
      });

      if (!scan) {
        throw new NotFoundException(`Purchase bill scan '${id}' not found.`);
      }

      return scan;
    });
  }

  /**
   * Streams/retrieves bill file content for authorized tenant download/preview.
   */
  async getScanFile(
    id: string,
    tenant: TenantContext,
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    const scan = await this.prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.purchaseBillScan.findFirst({
        where: { id, companyId: tenant.companyId },
        select: {
          fileName: true,
          fileMimeType: true,
          fileStoragePath: true,
        },
      });
    });

    if (!scan) {
      throw new NotFoundException(`Bill scan document '${id}' not found.`);
    }

    const buffer = await this.storage.readFile(scan.fileStoragePath);
    return {
      buffer,
      mimeType: scan.fileMimeType,
      fileName: scan.fileName,
    };
  }

  /**
   * Updates an in-progress scan draft with corrected fields before confirmation.
   */
  async updateScanDraft(
    id: string,
    dto: UpdateScanDraftDto,
    tenant: TenantContext,
  ): Promise<any> {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const scan = await tx.purchaseBillScan.findFirst({
        where: { id, companyId: tenant.companyId },
      });

      if (!scan) {
        throw new NotFoundException(`Purchase bill scan '${id}' not found.`);
      }
      if (scan.status === "CONFIRMED") {
        throw new BadRequestException("Cannot edit an already confirmed purchase invoice scan.");
      }

      let currentData: any = scan.extractedData || {};
      if (dto.extractedData) {
        currentData = dto.extractedData;
      }
      if (dto.vendorInvoiceNumber) {
        currentData.invoice = {
          ...currentData.invoice,
          invoiceNumber: dto.vendorInvoiceNumber.trim(),
        };
      }
      if (dto.invoiceDate) {
        currentData.invoice = {
          ...currentData.invoice,
          invoiceDate: dto.invoiceDate,
        };
      }
      if (dto.placeOfSupply) {
        currentData.invoice = {
          ...currentData.invoice,
          placeOfSupply: dto.placeOfSupply,
        };
      }

      const updated = await tx.purchaseBillScan.update({
        where: { id },
        data: {
          matchedPartyId: dto.partyId !== undefined ? dto.partyId : scan.matchedPartyId,
          extractedData: currentData,
        },
        include: {
          matchedParty: true,
        },
      });

      await this.audit.record({
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        userId: tenant.userId || "system",
        action: "PURCHASE_BILL_SCAN_DRAFT_UPDATED",
        entityName: "PurchaseBillScan",
        entityId: id,
        newState: { partyId: dto.partyId, invoiceNumber: dto.vendorInvoiceNumber },
      });

      return updated;
    });
  }

  /**
   * Confirms the purchase scan:
   * 1. Creates any approved new products atomically
   * 2. Calls PurchasesService.createPurchaseInvoice (stock ledger, double-entry vouchers)
   * 3. Links scan to confirmed PurchaseInvoice
   * 4. Enforces strict idempotency
   */
  async confirmPurchaseScan(
    scanId: string,
    dto: ConfirmPurchaseScanDto,
    tenant: TenantContext,
  ): Promise<any> {
    // 1. Check Scan State and Idempotency
    const confirmStart = Date.now();
    this.logger.log(
      `[DIAGNOSTIC] Stage: CONFIRM_START | ScanId: ${scanId} | ItemsCount: ${dto.items.length} | IsNewSupplier: ${dto.createNewSupplier} | Currency: ${dto.currency || "INR"}`,
    );

    const scan = await this.prisma.purchaseBillScan.findFirst({
      where: { id: scanId, companyId: tenant.companyId },
      include: { purchaseInvoice: true },
    });

    if (!scan) {
      throw new NotFoundException(`Purchase bill scan '${scanId}' not found.`);
    }

    if (scan.status === "CONFIRMED" && scan.purchaseInvoiceId) {
      this.logger.log(`Scan ${scanId} was already confirmed. Returning existing purchase invoice.`);
      return {
        scan,
        invoice: scan.purchaseInvoice,
        isIdempotentReplay: true,
      };
    }

    // 2. Prepare Items & Create Approved New Products
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      // Find company default UOM or create "PCS" if missing
      let defaultUom = await tx.unitOfMeasure.findFirst({
        where: { companyId: tenant.companyId },
      });
      if (!defaultUom) {
        defaultUom = await tx.unitOfMeasure.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            name: "PIECES",
            symbol: "PCS",
            uqcCode: "PCS",
            decimalPlaces: 0,
          },
        });
      }

      const finalPurchaseItems: Array<{
        itemId: string;
        hsnCode?: string;
        quantity: number | string;
        unitPrice: number | string;
        taxRate: number | string;
      }> = [];

      for (const line of dto.items) {
        let resolvedItemId = line.itemId;

        // If user explicitly confirmed creating a new product
        if (line.createNewProduct && line.newProductDetails) {
          const np = line.newProductDetails;
          let uomId = defaultUom.id;

          if (np.unitSymbol) {
            const matchedUom = await tx.unitOfMeasure.findFirst({
              where: {
                companyId: tenant.companyId,
                symbol: { equals: np.unitSymbol.trim(), mode: "insensitive" },
              },
            });
            if (matchedUom) {
              uomId = matchedUom.id;
            }
          }

          const isService = np.itemType === "SERVICE" || line.itemType === "SERVICE";
          const createdItem = await tx.item.create({
            data: {
              organizationId: tenant.organizationId,
              companyId: tenant.companyId,
              type: isService ? "SERVICE" : "PRODUCT",
              name: np.name.trim(),
              hsnCode: np.hsnCode || "0000",
              primaryUomId: uomId,
              taxRate: np.taxRate || 18,
              purchaseRate: np.purchasePrice || 0,
              retailPrice: np.retailPrice || np.purchasePrice || 0,
              wholesalePrice: np.purchasePrice || 0,
            },
          });

          resolvedItemId = createdItem.id;
          this.logger.log(`Created new ${isService ? "service" : "product"} '${createdItem.name}' (${createdItem.id}) from bill scan.`);
        }

        if (!resolvedItemId) {
          throw new BadRequestException(
            "Each line item must either map to an existing product or be confirmed as a new product.",
          );
        }

        const exchangeRate = dto.currency && dto.currency !== "INR" && dto.exchangeRate ? Number(dto.exchangeRate) : 1;
        const convertedUnitPrice = Number(line.unitPrice) * exchangeRate;

        finalPurchaseItems.push({
          itemId: resolvedItemId,
          hsnCode: line.hsnCode,
          quantity: line.quantity,
          unitPrice: convertedUnitPrice,
          taxRate: line.taxRate,
        });
      }

      // 3. Resolve or Auto-Create Supplier Party
      let resolvedPartyId = dto.partyId;
      if (
        (!resolvedPartyId || resolvedPartyId === "__NEW_SUPPLIER__" || dto.createNewSupplier) &&
        dto.newSupplierDetails?.name
      ) {
        const sup = dto.newSupplierDetails;
        const rawGstin = sup.gstin ? sup.gstin.trim().toUpperCase() : null;
        const isValidGstin = rawGstin ? isValidGstinChecksum(rawGstin) : false;
        const validGstin = isValidGstin ? rawGstin : null;
        const supplierState = (validGstin ? validGstin.substring(0, 2) : (dto.placeOfSupply || "24"));

        const createdParty = await tx.party.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            name: sup.name.trim(),
            gstin: validGstin,
            phone: sup.phone ? sup.phone.trim() : "",
            email: sup.email ? sup.email.trim() : null,
            type: "SUPPLIER",
            gstType: validGstin ? "REGULAR" : "UNREGISTERED",
            stateCode: supplierState,
            billingAddress: sup.address ? ({ line1: sup.address, city: "", pincode: "" } as any) : ({ line1: "Main Office", city: "", pincode: "" } as any),
            creditLimit: 0,
            creditDays: 0,
            interestRate: 0,
            defaultDiscount: 0,
            isActive: true,
          },
        });
        resolvedPartyId = createdParty.id;
        this.logger.log(`Created new supplier '${createdParty.name}' (${createdParty.id}) from bill scan. Valid GSTIN: ${validGstin || "UNREGISTERED"}`);
      }

      if (!resolvedPartyId || resolvedPartyId === "__NEW_SUPPLIER__") {
        throw new BadRequestException("Please select or confirm a supplier party.");
      }

      // 4. Call existing transactional PurchasesService
      const purchaseInvoice = await this.purchasesService.createPurchaseInvoice(
        {
          partyId: resolvedPartyId,
          vendorInvoiceNumber: dto.vendorInvoiceNumber.trim(),
          invoiceDate: dto.invoiceDate,
          placeOfSupply: dto.placeOfSupply,
          warehouseId: dto.warehouseId,
          itcEligibility: dto.itcEligibility || "INPUT",
          items: finalPurchaseItems,
        },
        tenant,
        tx,
      );

      // 4. Update scan status to CONFIRMED
      const confirmedScan = await tx.purchaseBillScan.update({
        where: { id: scanId },
        data: {
          status: "CONFIRMED",
          purchaseInvoiceId: purchaseInvoice.id,
          matchedPartyId: dto.partyId,
        },
        include: {
          matchedParty: true,
          purchaseInvoice: true,
        },
      });

      // 5. Audit Log
      await this.audit.record({
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        userId: tenant.userId || "system",
        action: "PURCHASE_BILL_SCAN_CONFIRMED",
        entityName: "PurchaseBillScan",
        entityId: scanId,
        newState: {
          purchaseInvoiceId: purchaseInvoice.id,
          vendorInvoiceNumber: dto.vendorInvoiceNumber,
          grandTotal: purchaseInvoice.grandTotal,
        },
      });

      this.logger.log(
        `[DIAGNOSTIC] Stage: CONFIRM_COMMITTED | ScanId: ${scanId} | InvoiceId: ${purchaseInvoice.id} | VendorInvNo: ${purchaseInvoice.vendorInvoiceNumber} | GrandTotal: ${purchaseInvoice.grandTotal} | DurationMs: ${Date.now() - confirmStart}`,
      );

      return {
        scan: confirmedScan,
        invoice: purchaseInvoice,
        isIdempotentReplay: false,
      };
    });
  }

  /**
   * Discards a scan draft.
   */
  async discardScan(id: string, tenant: TenantContext): Promise<any> {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const scan = await tx.purchaseBillScan.findFirst({
        where: { id, companyId: tenant.companyId },
      });

      if (!scan) {
        throw new NotFoundException(`Purchase bill scan '${id}' not found.`);
      }
      if (scan.status === "CONFIRMED") {
        throw new BadRequestException("Cannot discard an already confirmed purchase invoice.");
      }

      const updated = await tx.purchaseBillScan.update({
        where: { id },
        data: { status: "DISCARDED" },
      });

      await this.audit.record({
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        userId: tenant.userId || "system",
        action: "PURCHASE_BILL_SCAN_DISCARDED",
        entityName: "PurchaseBillScan",
        entityId: id,
      });

      return updated;
    });
  }
}
