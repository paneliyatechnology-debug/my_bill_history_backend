import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../audit/audit.service";
import { FileParserService } from "./file-parser.service";
import {
  GstRegistrationType,
  ImportErrorPolicy,
  ImportErrorRow,
  ImportJobDto,
  ImportMode,
  ImportModuleType,
  ImportRowPreview,
  ImportStatus,
  ItemType,
  PartyType,
  StockTransactionType,
  TenantContext,
  ValuationMethod,
} from "@billing/shared-types";
import { Prisma } from "@billing/database";
import { INDIAN_STATES } from "../common/validators/gstin.validator";

@Injectable()
export class ImportExecutorService {
  private readonly logger = new Logger(ImportExecutorService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
    private readonly fileParser: FileParserService,
  ) {}

  /**
   * Execute import in a transactional, tenant-isolated context
   */
  async executeImport(
    ctx: TenantContext,
    jobId: string,
    moduleType: ImportModuleType | string,
    previews: ImportRowPreview[],
    mode: ImportMode = ImportMode.SKIP_DUPLICATES,
    errorPolicy: ImportErrorPolicy = ImportErrorPolicy.IMPORT_VALID_ONLY,
  ): Promise<ImportJobDto> {
    const startTime = Date.now();
    const cleanModule = moduleType as ImportModuleType;

    // Check if any row is invalid when policy is ABORT_ON_ERROR
    const hasInvalid = previews.some((p) => p.status === "INVALID");
    if (hasInvalid && errorPolicy === ImportErrorPolicy.ABORT_ON_ERROR) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: "IMPORT_ABORTED_ON_ERROR",
        message: "Import was aborted because one or more rows are invalid, and the error policy is set to 'Abort on Any Error'.",
        messageGujarati: "કોઈપણ એક ભૂલ પર આયાત રદ કરવાની નીતિ હોવાથી પ્રક્રિયા અટકાવવામાં આવી.",
      });
    }

    const createdIds: string[] = [];
    const updatedIds: string[] = [];
    const executionErrors: ImportErrorRow[] = [];
    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // Execute within tenant database transaction
    await this.prisma.executeInTenantContext(ctx, async (tx) => {
      // 1. Resolve or establish default branch & warehouse
      const defaultBranch = await this.resolveBranch(ctx, tx);
      const defaultWarehouseId = await this.resolveWarehouseId(ctx, tx, defaultBranch.id);
      const defaultFY = await this.resolveFinancialYear(ctx, tx);

      // Group rows if invoice (to group items under the same invoice number)
      if (cleanModule === ImportModuleType.SALES_INVOICES) {
        await this.executeSalesInvoicesImport(
          ctx,
          tx,
          previews,
          mode,
          defaultBranch.id,
          defaultFY.id,
          createdIds,
          executionErrors,
        );
      } else if (cleanModule === ImportModuleType.PURCHASE_INVOICES) {
        await this.executePurchaseInvoicesImport(
          ctx,
          tx,
          previews,
          mode,
          defaultBranch.id,
          defaultFY.id,
          createdIds,
          executionErrors,
        );
      } else {
        // Individual row execution
        for (const preview of previews) {
          if (preview.action === "FAIL" || preview.status === "INVALID") {
            failedCount++;
            continue;
          }

          if (preview.action === "SKIP") {
            skippedCount++;
            continue;
          }

          try {
            switch (cleanModule) {
              case ImportModuleType.PARTIES:
              case ImportModuleType.CUSTOMERS:
              case ImportModuleType.SUPPLIERS:
                await this.importPartyRow(ctx, tx, preview, mode, cleanModule, createdIds, updatedIds);
                break;

              case ImportModuleType.ITEMS:
              case ImportModuleType.SERVICES:
                await this.importItemRow(ctx, tx, preview, mode, defaultWarehouseId, createdIds, updatedIds);
                break;

              case ImportModuleType.ITEM_CATEGORIES:
                await this.importCategoryRow(ctx, tx, preview, mode, createdIds, updatedIds);
                break;

              case ImportModuleType.UNITS_OF_MEASURE:
                await this.importUomRow(ctx, tx, preview, mode, createdIds, updatedIds);
                break;

              case ImportModuleType.WAREHOUSES:
                await this.importWarehouseRow(ctx, tx, preview, defaultBranch.id, createdIds, updatedIds);
                break;

              case ImportModuleType.ITEM_BATCHES:
                await this.importBatchRow(ctx, tx, preview, createdIds, updatedIds);
                break;

              case ImportModuleType.HSN_MASTERS:
                await this.importHsnRow(ctx, tx, preview, createdIds, updatedIds);
                break;

              case ImportModuleType.LEDGER_GROUPS:
                await this.importLedgerGroupRow(ctx, tx, preview, createdIds, updatedIds);
                break;

              case ImportModuleType.LEDGER_ACCOUNTS:
                await this.importLedgerAccountRow(ctx, tx, preview, mode, createdIds, updatedIds);
                break;

              case ImportModuleType.DELIVERY_CHALLANS:
                await this.importDeliveryChallanRow(ctx, tx, preview, defaultBranch.id, defaultFY.id, defaultWarehouseId, createdIds);
                break;

              case ImportModuleType.BILL_OF_MATERIALS:
                await this.importBomRow(ctx, tx, preview, createdIds);
                break;

              default:
                throw new Error(`Unsupported import module: ${cleanModule}`);
            }

            if (preview.action === "UPDATE") {
              updatedCount++;
            } else {
              importedCount++;
            }
          } catch (rowErr: any) {
            this.logger.warn(`Error importing row ${preview.rowNumber}: ${rowErr.message}`);
            failedCount++;
            executionErrors.push({
              rowNumber: preview.rowNumber,
              errorCode: "EXECUTION_ERROR",
              errorMessage: rowErr.message || "Failed to commit record",
              isBlocking: errorPolicy === ImportErrorPolicy.ABORT_ON_ERROR,
              actionTaken: "FAILED",
            });

            if (errorPolicy === ImportErrorPolicy.ABORT_ON_ERROR) {
              throw rowErr;
            }
          }
        }
      }

      // Record audit log entry
      if (ctx.userId) {
        await this.audit.record({
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId,
          action: "DATA_IMPORT_EXECUTED",
          entityName: "ImportJob",
          entityId: jobId,
          newState: {
            module: cleanModule,
            mode,
            totalRows: previews.length,
            importedCount,
            updatedCount,
            skippedCount,
            failedCount,
          },
        });
      }
    });

    const durationMs = Date.now() - startTime;

    // Update ImportJob record in DB
    const finalStatus = failedCount > 0 && importedCount === 0 && updatedCount === 0
      ? ImportStatus.FAILED
      : ImportStatus.COMPLETED;

    const summaryObj = {
      durationMs,
      createdCount: createdIds.length,
      updatedCount: updatedIds.length,
      createdIds: createdIds.slice(0, 50), // Store up to first 50 IDs
    };

    let updatedJob: any = null;
    try {
      updatedJob = await this.prisma.executeBypassRls(async (tx) => {
        return tx.importJob.update({
          where: { id: jobId },
          data: {
            status: finalStatus as any,
            importedRows: importedCount,
            updatedRows: updatedCount,
            skippedRows: skippedCount,
            failedRows: failedCount,
            errorsJson: executionErrors as any,
            summaryJson: summaryObj as any,
            completedAt: new Date(),
          },
        });
      });
    } catch {
      // ignore if job was transient / not pre-saved
    }

    return {
      id: jobId,
      organizationId: ctx.organizationId,
      companyId: ctx.companyId,
      userId: ctx.userId,
      module: cleanModule,
      fileName: updatedJob?.fileName || "import.xlsx",
      fileSize: updatedJob?.fileSize || 0,
      fileFormat: updatedJob?.fileFormat || "XLSX",
      status: finalStatus,
      mode,
      errorPolicy,
      totalRows: previews.length,
      validRows: importedCount + updatedCount,
      importedRows: importedCount,
      updatedRows: updatedCount,
      skippedRows: skippedCount,
      failedRows: failedCount,
      errors: executionErrors,
      summary: summaryObj,
      createdAt: updatedJob?.createdAt ? updatedJob.createdAt.toISOString() : new Date().toISOString(),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------
  // MODULE IMPORTERS
  // -------------------------------------------------------------

  private async importPartyRow(
    ctx: TenantContext,
    tx: any,
    preview: ImportRowPreview,
    mode: ImportMode,
    moduleType: ImportModuleType,
    createdIds: string[],
    updatedIds: string[],
  ) {
    const d = preview.data;
    const name = String(d.name || "").trim();
    const phone = String(d.phone || "").trim() || "0000000000";
    const gstin = d.gstin ? String(d.gstin).trim().toUpperCase() : null;
    const pan = d.pan ? String(d.pan).trim().toUpperCase() : (gstin ? gstin.substring(2, 12) : null);

    let type = PartyType.CUSTOMER;
    if (moduleType === ImportModuleType.SUPPLIERS) {
      type = PartyType.SUPPLIER;
    } else if (d.type) {
      const t = String(d.type).toUpperCase();
      if (t === "SUPPLIER") type = PartyType.SUPPLIER;
      else if (t === "BOTH") type = PartyType.BOTH;
    }

    let gstType = GstRegistrationType.UNREGISTERED;
    if (gstin) {
      gstType = GstRegistrationType.REGULAR;
    }
    if (d.gstType) {
      const gt = String(d.gstType).toUpperCase();
      if (Object.values(GstRegistrationType).includes(gt as any)) {
        gstType = gt as any;
      }
    }

    let stateCode = String(d.stateCode || "").trim();
    if (!stateCode) {
      stateCode = gstin ? gstin.substring(0, 2) : "24";
    }

    const billingAddress = {
      line1: String(d.addressLine1 || d.address || "").trim(),
      city: String(d.city || "Ahmedabad").trim(),
      pincode: String(d.pincode || "380001").trim(),
      state: INDIAN_STATES[stateCode]?.name || "Gujarat",
    };

    const creditLimit = new Prisma.Decimal(this.fileParser.parseNumberValue(d.creditLimit, 0));
    const creditDays = Math.max(0, Math.floor(this.fileParser.parseNumberValue(d.creditDays, 0)));

    if (preview.action === "UPDATE" && preview.matchedExistingId) {
      const updated = await tx.party.update({
        where: { id: preview.matchedExistingId },
        data: {
          name,
          phone,
          gstin,
          pan,
          gstType,
          stateCode,
          billingAddress,
          creditLimit,
          creditDays,
          email: d.email ? String(d.email).trim() : undefined,
          contactPerson: d.contactPerson ? String(d.contactPerson).trim() : undefined,
        },
      });
      updatedIds.push(updated.id);
      return;
    }

    // Create party
    const created = await tx.party.create({
      data: {
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        type,
        name,
        phone,
        gstin,
        pan,
        gstType,
        stateCode,
        billingAddress,
        creditLimit,
        creditDays,
        email: d.email ? String(d.email).trim() : null,
        contactPerson: d.contactPerson ? String(d.contactPerson).trim() : null,
        isActive: true,
      },
    });

    createdIds.push(created.id);

    // Initialize ledger account & opening balance if specified
    const opBal = this.fileParser.parseNumberValue(d.openingBalance, 0);
    const opType = String(d.openingBalanceType || (type === PartyType.SUPPLIER ? "CR" : "DR")).toUpperCase();

    // Find Sundry Debtors or Sundry Creditors group
    const targetGroup = await tx.ledgerGroup.findFirst({
      where: {
        companyId: ctx.companyId,
        name: type === PartyType.SUPPLIER ? "Sundry Creditors" : "Sundry Debtors",
      },
    });

    if (targetGroup) {
      await tx.ledgerAccount.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          groupId: targetGroup.id,
          partyId: created.id,
          isPartyLedger: true,
          name: created.name,
          openingBalance: new Prisma.Decimal(opBal),
          openingType: opType === "CR" ? "CR" : "DR",
          currentBalance: new Prisma.Decimal(opBal),
        },
      });
    }
  }

  private async importItemRow(
    ctx: TenantContext,
    tx: any,
    preview: ImportRowPreview,
    mode: ImportMode,
    defaultWarehouseId: string,
    createdIds: string[],
    updatedIds: string[],
  ) {
    const d = preview.data;
    const name = String(d.name || "").trim();
    const sku = d.sku ? String(d.sku).trim() : null;
    const barcode = d.barcode ? String(d.barcode).trim() : null;
    const hsnCode = String(d.hsnCode || "9999").trim();
    const taxRate = new Prisma.Decimal(this.fileParser.parseNumberValue(d.taxRate, 18));
    const purchaseRate = new Prisma.Decimal(this.fileParser.parseNumberValue(d.purchaseRate, 0));
    const retailPrice = new Prisma.Decimal(this.fileParser.parseNumberValue(d.retailPrice, 0));
    const wholesalePrice = new Prisma.Decimal(this.fileParser.parseNumberValue(d.wholesalePrice, 0));
    const mrp = d.mrp ? new Prisma.Decimal(this.fileParser.parseNumberValue(d.mrp, 0)) : null;
    const minStockLevel = new Prisma.Decimal(this.fileParser.parseNumberValue(d.minStockLevel, 0));
    const itemType = String(d.type || "").toUpperCase() === "SERVICE" ? ItemType.SERVICE : ItemType.PRODUCT;

    // Resolve or auto-create primary UOM
    const uomSymbol = String(d.primaryUom || d.uom || "PCS").trim().toUpperCase();
    let uom = await tx.unitOfMeasure.findFirst({
      where: { companyId: ctx.companyId, symbol: uomSymbol },
    });
    if (!uom) {
      uom = await tx.unitOfMeasure.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          name: uomSymbol,
          symbol: uomSymbol,
          uqcCode: uomSymbol,
          decimalPlaces: ["KG", "MTR", "LTR"].includes(uomSymbol) ? 2 : 0,
        },
      });
    }

    // Resolve or auto-create category
    let categoryId: string | null = null;
    const catName = String(d.category || "").trim();
    if (catName) {
      let category = await tx.itemCategory.findFirst({
        where: { companyId: ctx.companyId, name: catName },
      });
      if (!category) {
        category = await tx.itemCategory.create({
          data: {
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            name: catName,
          },
        });
      }
      categoryId = category.id;
    }

    if (preview.action === "UPDATE" && preview.matchedExistingId) {
      const updated = await tx.item.update({
        where: { id: preview.matchedExistingId },
        data: {
          name,
          sku,
          barcode,
          hsnCode,
          taxRate,
          purchaseRate,
          retailPrice,
          wholesalePrice,
          mrp,
          minStockLevel,
          categoryId,
          primaryUomId: uom.id,
        },
      });
      updatedIds.push(updated.id);
      return;
    }

    // Create item
    const created = await tx.item.create({
      data: {
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        type: itemType,
        name,
        sku,
        barcode,
        hsnCode,
        taxRate,
        purchaseRate,
        retailPrice,
        wholesalePrice,
        mrp,
        minStockLevel,
        categoryId,
        primaryUomId: uom.id,
        valuationMethod: ValuationMethod.FIFO,
        supplyCategory: "TAXABLE" as any,
        isActive: true,
      },
    });

    createdIds.push(created.id);

    // Opening stock transaction if physical product and qty > 0
    const opQty = this.fileParser.parseNumberValue(d.openingStock, 0);
    if (itemType === ItemType.PRODUCT && opQty > 0) {
      const unitCost = Number(purchaseRate) > 0 ? purchaseRate : retailPrice;
      const totalValuation = new Prisma.Decimal(opQty).mul(unitCost);

      await tx.stockTransaction.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          itemId: created.id,
          warehouseId: defaultWarehouseId,
          transactionType: StockTransactionType.OPENING,
          quantity: new Prisma.Decimal(opQty),
          unitCost,
          totalValue: totalValuation,
          balanceAfter: new Prisma.Decimal(opQty),
          transactionDate: new Date(),
          referenceNo: "OPENING-STOCK-IMPORT",
          notes: "Initial balance from Excel/CSV migration",
        },
      });
    }
  }

  private async importCategoryRow(
    ctx: TenantContext,
    tx: any,
    preview: ImportRowPreview,
    mode: ImportMode,
    createdIds: string[],
    updatedIds: string[],
  ) {
    const name = String(preview.data.name || "").trim();
    const nameGujarati = preview.data.nameGujarati ? String(preview.data.nameGujarati).trim() : null;

    if (preview.action === "UPDATE" && preview.matchedExistingId) {
      const updated = await tx.itemCategory.update({
        where: { id: preview.matchedExistingId },
        data: { name, nameGujarati },
      });
      updatedIds.push(updated.id);
      return;
    }

    const created = await tx.itemCategory.create({
      data: {
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        name,
        nameGujarati,
      },
    });
    createdIds.push(created.id);
  }

  private async importUomRow(
    ctx: TenantContext,
    tx: any,
    preview: ImportRowPreview,
    mode: ImportMode,
    createdIds: string[],
    updatedIds: string[],
  ) {
    const symbol = String(preview.data.symbol || "").trim().toUpperCase();
    const name = String(preview.data.name || symbol).trim();
    const uqcCode = String(preview.data.uqcCode || symbol).trim().toUpperCase();
    const decimalPlaces = Math.max(0, Math.floor(this.fileParser.parseNumberValue(preview.data.decimalPlaces, 0)));

    if (preview.action === "UPDATE" && preview.matchedExistingId) {
      const updated = await tx.unitOfMeasure.update({
        where: { id: preview.matchedExistingId },
        data: { name, uqcCode, decimalPlaces },
      });
      updatedIds.push(updated.id);
      return;
    }

    const created = await tx.unitOfMeasure.create({
      data: {
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        name,
        symbol,
        uqcCode,
        decimalPlaces,
      },
    });
    createdIds.push(created.id);
  }

  private async importWarehouseRow(
    ctx: TenantContext,
    tx: any,
    preview: ImportRowPreview,
    defaultBranchId: string,
    createdIds: string[],
    updatedIds: string[],
  ) {
    const name = String(preview.data.name || "").trim();
    const address = preview.data.address ? String(preview.data.address).trim() : null;
    const isDefault = String(preview.data.isDefault || "").toLowerCase() === "true";

    if (preview.action === "UPDATE" && preview.matchedExistingId) {
      const updated = await tx.warehouse.update({
        where: { id: preview.matchedExistingId },
        data: { name, address, isDefault },
      });
      updatedIds.push(updated.id);
      return;
    }

    const created = await tx.warehouse.create({
      data: {
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        branchId: defaultBranchId,
        name,
        address,
        isDefault,
      },
    });
    createdIds.push(created.id);
  }

  private async importBatchRow(
    ctx: TenantContext,
    tx: any,
    preview: ImportRowPreview,
    createdIds: string[],
    updatedIds: string[],
  ) {
    const d = preview.data;
    const itemName = String(d.itemName || "").trim();
    const batchNumber = String(d.batchNumber || "").trim();
    const mfgDate = this.fileParser.parseDateValue(d.mfgDate);
    const expiryDate = this.fileParser.parseDateValue(d.expiryDate);
    const mrp = new Prisma.Decimal(this.fileParser.parseNumberValue(d.mrp, 0));
    const salePrice = new Prisma.Decimal(this.fileParser.parseNumberValue(d.salePrice, 0));

    // Resolve item
    const item = await tx.item.findFirst({
      where: { companyId: ctx.companyId, name: { equals: itemName, mode: "insensitive" } },
    });
    if (!item) {
      throw new Error(`Item '${itemName}' not found for batch '${batchNumber}'. Please import the item first.`);
    }

    const existingBatch = await tx.itemBatch.findFirst({
      where: { itemId: item.id, batchNumber },
    });

    if (existingBatch) {
      const updated = await tx.itemBatch.update({
        where: { id: existingBatch.id },
        data: { mfgDate, expiryDate, mrp, salePrice },
      });
      updatedIds.push(updated.id);
      return;
    }

    const created = await tx.itemBatch.create({
      data: {
        itemId: item.id,
        batchNumber,
        mfgDate,
        expiryDate,
        mrp,
        salePrice,
        purchaseRate: item.purchaseRate,
      },
    });
    createdIds.push(created.id);
  }

  private async importHsnRow(
    ctx: TenantContext,
    tx: any,
    preview: ImportRowPreview,
    createdIds: string[],
    updatedIds: string[],
  ) {
    const code = String(preview.data.code || "").trim();
    const description = String(preview.data.description || code).trim();
    const gstRate = new Prisma.Decimal(this.fileParser.parseNumberValue(preview.data.gstRate, 18));
    const type = String(preview.data.type || "").toUpperCase() === "SAC" ? "SAC" : "HSN";

    const existing = await tx.hsnMaster.findFirst({
      where: { companyId: ctx.companyId, code },
    });

    if (existing) {
      const updated = await tx.hsnMaster.update({
        where: { id: existing.id },
        data: { description, gstRate, type: type as any },
      });
      updatedIds.push(updated.id);
      return;
    }

    const created = await tx.hsnMaster.create({
      data: {
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        code,
        description,
        type: type as any,
        gstRate,
        isSystem: false,
        isActive: true,
      },
    });
    createdIds.push(created.id);
  }

  private async importLedgerGroupRow(
    ctx: TenantContext,
    tx: any,
    preview: ImportRowPreview,
    createdIds: string[],
    updatedIds: string[],
  ) {
    const name = String(preview.data.name || "").trim();
    const nature = String(preview.data.nature || "EXPENSE").toUpperCase();
    const parentName = String(preview.data.parentGroupName || "").trim();

    let parentId: string | null = null;
    if (parentName) {
      const p = await tx.ledgerGroup.findFirst({
        where: { companyId: ctx.companyId, name: parentName },
      });
      if (p) parentId = p.id;
    }

    const created = await tx.ledgerGroup.create({
      data: {
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        name,
        nature: nature as any,
        parentId,
      },
    });
    createdIds.push(created.id);
  }

  private async importLedgerAccountRow(
    ctx: TenantContext,
    tx: any,
    preview: ImportRowPreview,
    mode: ImportMode,
    createdIds: string[],
    updatedIds: string[],
  ) {
    const d = preview.data;
    const name = String(d.name || "").trim();
    const groupName = String(d.groupName || "").trim();
    const code = d.code ? String(d.code).trim() : null;
    const opBal = this.fileParser.parseNumberValue(d.openingBalance, 0);
    const opType = String(d.openingType || "DR").toUpperCase();

    // Resolve or fallback group
    let group = await tx.ledgerGroup.findFirst({
      where: { companyId: ctx.companyId, name: groupName },
    });
    if (!group) {
      group = await tx.ledgerGroup.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          name: groupName || "General Accounts",
          nature: "ASSET",
        },
      });
    }

    if (preview.action === "UPDATE" && preview.matchedExistingId) {
      const updated = await tx.ledgerAccount.update({
        where: { id: preview.matchedExistingId },
        data: {
          name,
          groupId: group.id,
          code,
          openingBalance: new Prisma.Decimal(opBal),
          openingType: opType,
          currentBalance: new Prisma.Decimal(opBal),
        },
      });
      updatedIds.push(updated.id);
      return;
    }

    const created = await tx.ledgerAccount.create({
      data: {
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        groupId: group.id,
        name,
        code,
        openingBalance: new Prisma.Decimal(opBal),
        openingType: opType,
        currentBalance: new Prisma.Decimal(opBal),
      },
    });
    createdIds.push(created.id);
  }

  private async importDeliveryChallanRow(
    ctx: TenantContext,
    tx: any,
    preview: ImportRowPreview,
    branchId: string,
    financialYearId: string,
    warehouseId: string,
    createdIds: string[],
  ) {
    const d = preview.data;
    const challanNumber = String(d.challanNumber || "").trim();
    const challanDate = this.fileParser.parseDateValue(d.challanDate) || new Date();
    const partyName = String(d.partyName || "").trim();
    const itemName = String(d.itemName || "").trim();
    const qty = new Prisma.Decimal(this.fileParser.parseNumberValue(d.quantity, 1));

    let party = await tx.party.findFirst({
      where: { companyId: ctx.companyId, name: { equals: partyName, mode: "insensitive" } },
    });
    if (!party) {
      party = await tx.party.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          name: partyName,
          phone: "0000000000",
          stateCode: "24",
          billingAddress: { line1: "Challan Delivery", city: "Ahmedabad", pincode: "380001" },
        },
      });
    }

    let item = await tx.item.findFirst({
      where: { companyId: ctx.companyId, name: { equals: itemName, mode: "insensitive" } },
    });
    if (!item) {
      const uom = await tx.unitOfMeasure.findFirst({ where: { companyId: ctx.companyId } });
      item = await tx.item.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          name: itemName,
          hsnCode: "9999",
          taxRate: 18,
          primaryUomId: uom.id,
        },
      });
    }

    const challan = await tx.deliveryChallan.create({
      data: {
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        branchId,
        financialYearId,
        warehouseId,
        partyId: party.id,
        challanNumber,
        challanDate,
        purpose: "SUPPLY_ON_APPROVAL",
        consigneeName: party.name,
        deliveryAddress: party.billingAddress as any,
        totalTaxable: new Prisma.Decimal(0),
        cgstAmount: new Prisma.Decimal(0),
        sgstAmount: new Prisma.Decimal(0),
        igstAmount: new Prisma.Decimal(0),
        grandTotal: new Prisma.Decimal(0),
        status: "DELIVERED",
        items: {
          create: [
            {
              itemId: item.id,
              quantity: qty,
              unitPrice: item.retailPrice,
              taxableAmount: new Prisma.Decimal(0),
              cgstAmount: new Prisma.Decimal(0),
              sgstAmount: new Prisma.Decimal(0),
              igstAmount: new Prisma.Decimal(0),
              totalAmount: new Prisma.Decimal(0),
            },
          ],
        },
      },
    });

    createdIds.push(challan.id);
  }

  private async importBomRow(ctx: TenantContext, tx: any, preview: ImportRowPreview, createdIds: string[]) {
    const d = preview.data;
    const bomName = String(d.bomName || "").trim();
    const outputName = String(d.outputItemName || "").trim();
    const rawName = String(d.rawItemName || "").trim();
    const outputQty = new Prisma.Decimal(this.fileParser.parseNumberValue(d.outputQuantity, 1));
    const rawQty = new Prisma.Decimal(this.fileParser.parseNumberValue(d.rawQuantity, 1));

    const uom = await tx.unitOfMeasure.findFirst({ where: { companyId: ctx.companyId } });

    let outItem = await tx.item.findFirst({
      where: { companyId: ctx.companyId, name: { equals: outputName, mode: "insensitive" } },
    });
    if (!outItem) {
      outItem = await tx.item.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          name: outputName,
          hsnCode: "9999",
          taxRate: 18,
          primaryUomId: uom.id,
        },
      });
    }

    let inItem = await tx.item.findFirst({
      where: { companyId: ctx.companyId, name: { equals: rawName, mode: "insensitive" } },
    });
    if (!inItem) {
      inItem = await tx.item.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          name: rawName,
          hsnCode: "9999",
          taxRate: 18,
          primaryUomId: uom.id,
        },
      });
    }

    let bom = await tx.billOfMaterial.findFirst({
      where: { companyId: ctx.companyId, name: bomName },
    });

    if (!bom) {
      bom = await tx.billOfMaterial.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          name: bomName,
          finishedItemId: outItem.id,
          expectedYield: outputQty,
        },
      });
      createdIds.push(bom.id);
    }

    await tx.bomItem.create({
      data: {
        bomId: bom.id,
        rawItemId: inItem.id,
        quantityRequired: rawQty,
      },
    });
  }

  // -------------------------------------------------------------
  // MULTI-LINE DOCUMENT IMPORTERS (SALES & PURCHASES)
  // -------------------------------------------------------------

  private async executeSalesInvoicesImport(
    ctx: TenantContext,
    tx: any,
    previews: ImportRowPreview[],
    mode: ImportMode,
    branchId: string,
    financialYearId: string,
    createdIds: string[],
    executionErrors: ImportErrorRow[],
  ) {
    // Group line items by invoiceNumber
    const grouped = new Map<string, ImportRowPreview[]>();
    for (const p of previews) {
      if (p.action === "FAIL" || p.action === "SKIP") continue;
      const invNo = String(p.data.invoiceNumber || "").trim();
      if (!invNo) continue;
      if (!grouped.has(invNo)) grouped.set(invNo, []);
      grouped.get(invNo)!.push(p);
    }

    const defaultUom = await tx.unitOfMeasure.findFirst({ where: { companyId: ctx.companyId } });

    for (const [invoiceNumber, items] of grouped.entries()) {
      try {
        const firstRow = items[0].data;
        const partyName = String(firstRow.partyName || "").trim();
        const invoiceDate = this.fileParser.parseDateValue(firstRow.invoiceDate) || new Date();

        // Check if invoice already exists
        const existing = await tx.salesInvoice.findFirst({
          where: { companyId: ctx.companyId, invoiceNumber },
        });

        if (existing) {
          if (mode === ImportMode.SKIP_DUPLICATES) continue;
          throw new Error(`Sales Invoice '${invoiceNumber}' already exists in this company.`);
        }

        // Resolve or create customer party
        let party = await tx.party.findFirst({
          where: { companyId: ctx.companyId, name: { equals: partyName, mode: "insensitive" } },
        });

        if (!party) {
          party = await tx.party.create({
            data: {
              organizationId: ctx.organizationId,
              companyId: ctx.companyId,
              type: PartyType.CUSTOMER,
              name: partyName,
              phone: "0000000000",
              stateCode: "24",
              billingAddress: { line1: "Billing Address", city: "Ahmedabad", pincode: "380001" },
            },
          });
        }

        let subTotal = 0;
        let cgstTotal = 0;
        let sgstTotal = 0;
        let igstTotal = 0;

        const lineItemsData: any[] = [];

        for (const itemRow of items) {
          const d = itemRow.data;
          const itemName = String(d.itemName || "Item").trim();
          const qty = this.fileParser.parseNumberValue(d.quantity, 1);
          const rate = this.fileParser.parseNumberValue(d.unitPrice, 0);
          const taxRate = this.fileParser.parseNumberValue(d.taxRate, 18);

          let item = await tx.item.findFirst({
            where: { companyId: ctx.companyId, name: { equals: itemName, mode: "insensitive" } },
          });

          if (!item) {
            item = await tx.item.create({
              data: {
                organizationId: ctx.organizationId,
                companyId: ctx.companyId,
                name: itemName,
                hsnCode: "9999",
                taxRate: new Prisma.Decimal(taxRate),
                retailPrice: new Prisma.Decimal(rate),
                primaryUomId: defaultUom.id,
              },
            });
          }

          const taxable = qty * rate;
          const taxAmt = taxable * (taxRate / 100);
          // Intra-state Gujarat split vs Inter-state
          const isInterState = party.stateCode !== "24";
          const cgst = isInterState ? 0 : taxAmt / 2;
          const sgst = isInterState ? 0 : taxAmt / 2;
          const igst = isInterState ? taxAmt : 0;
          const total = taxable + taxAmt;

          subTotal += taxable;
          cgstTotal += cgst;
          sgstTotal += sgst;
          igstTotal += igst;

          lineItemsData.push({
            itemId: item.id,
            hsnCode: item.hsnCode,
            quantity: new Prisma.Decimal(qty),
            unitPrice: new Prisma.Decimal(rate),
            taxableAmount: new Prisma.Decimal(taxable),
            taxRate: new Prisma.Decimal(taxRate),
            cgstAmount: new Prisma.Decimal(cgst),
            sgstAmount: new Prisma.Decimal(sgst),
            igstAmount: new Prisma.Decimal(igst),
            totalAmount: new Prisma.Decimal(total),
          });
        }

        const grandTotal = subTotal + cgstTotal + sgstTotal + igstTotal;
        const paidAmount = this.fileParser.parseNumberValue(firstRow.paidAmount, 0);
        const balanceAmount = Math.max(0, grandTotal - paidAmount);

        const created = await tx.salesInvoice.create({
          data: {
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            branchId,
            financialYearId,
            partyId: party.id,
            invoiceNumber,
            invoiceDate,
            placeOfSupply: party.stateCode,
            billingAddress: party.billingAddress as any,
            subTotal: new Prisma.Decimal(subTotal),
            taxableAmount: new Prisma.Decimal(subTotal),
            cgstAmount: new Prisma.Decimal(cgstTotal),
            sgstAmount: new Prisma.Decimal(sgstTotal),
            igstAmount: new Prisma.Decimal(igstTotal),
            grandTotal: new Prisma.Decimal(grandTotal),
            paidAmount: new Prisma.Decimal(paidAmount),
            balanceAmount: new Prisma.Decimal(balanceAmount),
            status: "ISSUED",
            items: {
              create: lineItemsData,
            },
          },
        });

        createdIds.push(created.id);
      } catch (err: any) {
        executionErrors.push({
          rowNumber: items[0]?.rowNumber || 2,
          errorCode: "INVOICE_IMPORT_ERROR",
          errorMessage: `Invoice '${invoiceNumber}': ${err.message}`,
          isBlocking: false,
          actionTaken: "FAILED",
        });
      }
    }
  }

  private async executePurchaseInvoicesImport(
    ctx: TenantContext,
    tx: any,
    previews: ImportRowPreview[],
    mode: ImportMode,
    branchId: string,
    financialYearId: string,
    createdIds: string[],
    executionErrors: ImportErrorRow[],
  ) {
    const grouped = new Map<string, ImportRowPreview[]>();
    for (const p of previews) {
      if (p.action === "FAIL" || p.action === "SKIP") continue;
      const billNo = String(p.data.vendorInvoiceNumber || "").trim();
      if (!billNo) continue;
      if (!grouped.has(billNo)) grouped.set(billNo, []);
      grouped.get(billNo)!.push(p);
    }

    const defaultUom = await tx.unitOfMeasure.findFirst({ where: { companyId: ctx.companyId } });

    for (const [vendorInvoiceNumber, items] of grouped.entries()) {
      try {
        const firstRow = items[0].data;
        const supplierName = String(firstRow.supplierName || "").trim();
        const invoiceDate = this.fileParser.parseDateValue(firstRow.invoiceDate) || new Date();

        // Resolve or create supplier party
        let supplier = await tx.party.findFirst({
          where: { companyId: ctx.companyId, name: { equals: supplierName, mode: "insensitive" } },
        });

        if (!supplier) {
          supplier = await tx.party.create({
            data: {
              organizationId: ctx.organizationId,
              companyId: ctx.companyId,
              type: PartyType.SUPPLIER,
              name: supplierName,
              phone: "0000000000",
              stateCode: "24",
              billingAddress: { line1: "Supplier Address", city: "Ahmedabad", pincode: "380001" },
            },
          });
        }

        // Check uniqueness per company + supplier + bill number
        const existing = await tx.purchaseInvoice.findFirst({
          where: { companyId: ctx.companyId, partyId: supplier.id, vendorInvoiceNumber },
        });

        if (existing) {
          if (mode === ImportMode.SKIP_DUPLICATES) continue;
          throw new Error(`Purchase Bill '${vendorInvoiceNumber}' for '${supplierName}' already exists.`);
        }

        let taxableTotal = 0;
        let cgstTotal = 0;
        let sgstTotal = 0;
        let igstTotal = 0;

        const lineItemsData: any[] = [];

        for (const itemRow of items) {
          const d = itemRow.data;
          const itemName = String(d.itemName || "Item").trim();
          const qty = this.fileParser.parseNumberValue(d.quantity, 1);
          const rate = this.fileParser.parseNumberValue(d.unitPrice, 0);
          const taxRate = this.fileParser.parseNumberValue(d.taxRate, 18);

          let item = await tx.item.findFirst({
            where: { companyId: ctx.companyId, name: { equals: itemName, mode: "insensitive" } },
          });

          if (!item) {
            item = await tx.item.create({
              data: {
                organizationId: ctx.organizationId,
                companyId: ctx.companyId,
                name: itemName,
                hsnCode: "9999",
                taxRate: new Prisma.Decimal(taxRate),
                purchaseRate: new Prisma.Decimal(rate),
                primaryUomId: defaultUom.id,
              },
            });
          }

          const taxable = qty * rate;
          const taxAmt = taxable * (taxRate / 100);
          const isInterState = supplier.stateCode !== "24";
          const cgst = isInterState ? 0 : taxAmt / 2;
          const sgst = isInterState ? 0 : taxAmt / 2;
          const igst = isInterState ? taxAmt : 0;
          const total = taxable + taxAmt;

          taxableTotal += taxable;
          cgstTotal += cgst;
          sgstTotal += sgst;
          igstTotal += igst;

          lineItemsData.push({
            itemId: item.id,
            hsnCode: item.hsnCode,
            quantity: new Prisma.Decimal(qty),
            unitPrice: new Prisma.Decimal(rate),
            taxableAmount: new Prisma.Decimal(taxable),
            taxRate: new Prisma.Decimal(taxRate),
            cgstAmount: new Prisma.Decimal(cgst),
            sgstAmount: new Prisma.Decimal(sgst),
            igstAmount: new Prisma.Decimal(igst),
            totalAmount: new Prisma.Decimal(total),
          });
        }

        const grandTotal = taxableTotal + cgstTotal + sgstTotal + igstTotal;
        const paidAmount = this.fileParser.parseNumberValue(firstRow.paidAmount, 0);
        const balanceAmount = Math.max(0, grandTotal - paidAmount);

        const created = await tx.purchaseInvoice.create({
          data: {
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            branchId,
            financialYearId,
            partyId: supplier.id,
            vendorInvoiceNumber,
            invoiceDate,
            placeOfSupply: supplier.stateCode,
            taxableAmount: new Prisma.Decimal(taxableTotal),
            cgstAmount: new Prisma.Decimal(cgstTotal),
            sgstAmount: new Prisma.Decimal(sgstTotal),
            igstAmount: new Prisma.Decimal(igstTotal),
            grandTotal: new Prisma.Decimal(grandTotal),
            paidAmount: new Prisma.Decimal(paidAmount),
            balanceAmount: new Prisma.Decimal(balanceAmount),
            items: {
              create: lineItemsData,
            },
          },
        });

        createdIds.push(created.id);
      } catch (err: any) {
        executionErrors.push({
          rowNumber: items[0]?.rowNumber || 2,
          errorCode: "PURCHASE_IMPORT_ERROR",
          errorMessage: `Bill '${vendorInvoiceNumber}': ${err.message}`,
          isBlocking: false,
          actionTaken: "FAILED",
        });
      }
    }
  }

  // -------------------------------------------------------------
  // CONTEXT RESOLUTION HELPERS
  // -------------------------------------------------------------

  private async resolveBranch(ctx: TenantContext, tx: any) {
    if (ctx.branchId) {
      const b = await tx.branch.findFirst({ where: { id: ctx.branchId, companyId: ctx.companyId } });
      if (b) return b;
    }
    const mainBranch = await tx.branch.findFirst({ where: { companyId: ctx.companyId, isMainBranch: true } });
    if (mainBranch) return mainBranch;

    const anyBranch = await tx.branch.findFirst({ where: { companyId: ctx.companyId } });
    if (anyBranch) return anyBranch;

    return tx.branch.create({
      data: {
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        name: "Main Branch",
        code: "MAIN",
        isMainBranch: true,
        addressLine1: "Head Office",
        city: "Ahmedabad",
        pincode: "380001",
        stateCode: "24",
        phone: "9999999999",
      },
    });
  }

  private async resolveWarehouseId(ctx: TenantContext, tx: any, branchId: string): Promise<string> {
    const defaultWh = await tx.warehouse.findFirst({ where: { companyId: ctx.companyId, isDefault: true } });
    if (defaultWh) return defaultWh.id;

    const anyWh = await tx.warehouse.findFirst({ where: { companyId: ctx.companyId } });
    if (anyWh) return anyWh.id;

    const created = await tx.warehouse.create({
      data: {
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        branchId,
        name: "Main Godown",
        isDefault: true,
      },
    });
    return created.id;
  }

  private async resolveFinancialYear(ctx: TenantContext, tx: any) {
    if (ctx.financialYearId) {
      const fy = await tx.financialYear.findFirst({ where: { id: ctx.financialYearId, companyId: ctx.companyId } });
      if (fy) return fy;
    }

    const currentYear = new Date().getFullYear();
    const fyCode = `${currentYear}-${(currentYear + 1).toString().slice(2)}`;

    const existingFy = await tx.financialYear.findFirst({
      where: { companyId: ctx.companyId, isCurrent: true },
    });
    if (existingFy) return existingFy;

    const anyFy = await tx.financialYear.findFirst({
      where: { companyId: ctx.companyId },
    });
    if (anyFy) return anyFy;

    return tx.financialYear.create({
      data: {
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        name: `FY ${fyCode}`,
        code: fyCode,
        startDate: new Date(Date.UTC(currentYear, 3, 1)),
        endDate: new Date(Date.UTC(currentYear + 1, 2, 31)),
        isCurrent: true,
      },
    });
  }
}
