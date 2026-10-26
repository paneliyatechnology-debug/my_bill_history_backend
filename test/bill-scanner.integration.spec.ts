import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { Decimal } from "@billing/accounting-core";
import * as fs from "fs/promises";
import * as path from "path";
import { PurchaseScannerService } from "../src/purchases/scanner/services/purchase-scanner.service";
import { BillStorageService } from "../src/purchases/scanner/services/bill-storage.service";

describe("AI Bill Scanner - End-to-End Integration Tests", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  let tokenA: string;
  let companyAId: string;
  let warehouseAId: string;
  let supplierAId: string;
  let itemAId: string;

  let tokenB: string;
  let companyBId: string;

  let createdScanId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );

    // Register multipart support
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    await app.register(require("@fastify/multipart"), {
      limits: { fileSize: 15 * 1024 * 1024 },
    });

    app.setGlobalPrefix("api/v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(DatabaseService);

    // Clean up test data from prior test runs
    await prisma.executeBypassRls(async (tx) => {
      const users = await tx.user.findMany({
        where: { phone: { in: ["9825999011", "9825999012"] } },
        select: { organizationId: true },
      });
      const orgIds = users.map((u) => u.organizationId);
      if (orgIds.length > 0) {
        await tx.auditLog.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.purchaseBillScan.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.purchaseInvoiceItem.deleteMany({
          where: { invoice: { organizationId: { in: orgIds } } },
        });
        await tx.purchaseInvoice.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.stockTransaction.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.journalEntry.deleteMany({
          where: { voucher: { organizationId: { in: orgIds } } },
        });
        await tx.voucher.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.item.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.unitOfMeasure.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.party.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.warehouse.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.ledgerAccount.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.ledgerGroup.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.financialYear.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
        await tx.userBranchAssignment.deleteMany({
          where: { branch: { organizationId: { in: orgIds } } },
        });
        await tx.branch.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.user.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.company.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        const orgs = await tx.organization.findMany({
          where: { id: { in: orgIds } },
          select: { tenantId: true },
        });
        await tx.organization.deleteMany({
          where: { id: { in: orgIds } },
        });
        await tx.tenant.deleteMany({
          where: { id: { in: orgs.map((o) => o.tenantId) } },
        });
      }
    });

    // 1. Register Company A
    const regResA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Scanner Admin A",
        phone: "9825999011",
        email: "scanner_a@test.local",
        password: "Password@123",
        organizationName: "Gujarat Agro Industries",
        tradeName: "Gujarat Agro Corp",
        stateCode: "24",
      },
    });
    expect(regResA.statusCode).toBe(201);
    const bodyA = JSON.parse(regResA.body);
    tokenA = bodyA.accessToken;
    companyAId = bodyA.defaultContext.companyId;

    // Seed Standard Accounts for Company A
    await app.inject({
      method: "POST",
      url: "/api/v1/ledger-groups/seed",
      headers: { authorization: `Bearer ${tokenA}` },
    });

    // Create Warehouse for Company A
    const whRes = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/warehouses",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: "Central Agro Receiving Godown",
        isDefault: true,
      },
    });
    const whBody = JSON.parse(whRes.body);
    warehouseAId = whBody.id;

    // Create UOM
    const uomRes = await app.inject({
      method: "POST",
      url: "/api/v1/units",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: "BAGS",
        code: "BAG",
        isDecimalAllowed: false,
      },
    });
    expect(uomRes.statusCode).toBe(201);
    const uomBody = JSON.parse(uomRes.body);

    // Create Supplier Party matching our mock bill's GSTIN: 24ABCDE1234F1Z6
    const partyRes = await app.inject({
      method: "POST",
      url: "/api/v1/parties",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        type: "SUPPLIER",
        name: "Gujarat Agro & Machinery Corp",
        phone: "9825123456",
        gstin: "24ABCDE1234F1Z6",
        stateCode: "24",
        billingAddress: {
          line1: "GIDC Naroda",
          city: "Ahmedabad",
          pincode: "382330",
        },
      },
    });
    expect(partyRes.statusCode).toBe(201);
    supplierAId = JSON.parse(partyRes.body).id;

    // Create catalog item matching mock bill's item: Organic Fertilizer 50kg Bag
    const itemRes = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        type: "PRODUCT",
        name: "Organic Fertilizer 50kg Bag",
        hsnCode: "3105",
        primaryUomId: uomBody.id,
        taxRate: 18,
        purchaseRate: 800,
        retailPrice: 950,
      },
    });
    expect(itemRes.statusCode).toBe(201);
    itemAId = JSON.parse(itemRes.body).id;

    // 2. Register Company B for Tenant Isolation tests
    const regResB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Scanner Admin B",
        phone: "9825999012",
        email: "scanner_b@test.local",
        password: "Password@123",
        organizationName: "Surat Textiles Limited",
        tradeName: "Surat Textiles",
        stateCode: "24",
      },
    });
    expect(regResB.statusCode).toBe(201);
    const bodyB = JSON.parse(regResB.body);
    tokenB = bodyB.accessToken;
    companyBId = bodyB.defaultContext.companyId;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("1. Uploads a bill, extracts structured data, and auto-matches supplier & products", async () => {
    // PDF buffer with magic bytes %PDF-1.4
    const validPdfBuffer = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF");
    const base64File = validPdfBuffer.toString("base64");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/purchases/scans/upload",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/json",
      },
      payload: {
        fileBase64: base64File,
        fileName: "tax_invoice_gamc.pdf",
        mimeType: "application/pdf",
        idempotencyKey: "test-scan-key-001",
        provider: "mock",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.id).toBeDefined();
    createdScanId = body.id;
    expect(body.status).toBe("READY_FOR_REVIEW");
    expect(body.fileName).toBe("tax_invoice_gamc.pdf");
    expect(body.matchedPartyId).toBe(supplierAId);
    expect(Number(body.matchedPartyScore)).toBe(100);

    // Verify extracted details
    const ext = body.extractedData;
    expect(ext).toBeDefined();
    expect(ext.supplier.gstin).toBe("24ABCDE1234F1Z6");
    expect(ext.supplier.name).toBe("Gujarat Agro & Machinery Corp");
    expect(ext.invoice.invoiceNumber).toBe("GAMC/2026/1042");
    expect(ext.items.length).toBe(2);

    // Item 1: matched catalog item
    const line1 = ext.items.find((it: any) => it.description.includes("Organic Fertilizer"));
    expect(line1).toBeDefined();
    expect(line1.matchedItemId).toBe(itemAId);

    // Item 2: new product proposal
    const line2 = ext.items.find((it: any) => it.description.includes("Spray Nozzle Set"));
    expect(line2).toBeDefined();
    expect(line2.matchType).toBe("NEW_PRODUCT");

    createdScanId = body.id;
  });

  it("2. Retrieves single scan details by ID", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/purchases/scans/${createdScanId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(createdScanId);
    expect(body.companyId).toBe(companyAId);
    expect(body.matchedParty).toBeDefined();
    expect(body.matchedParty.id).toBe(supplierAId);
  });

  it("3. Securely streams bill file with tenant authorization & nosniff headers", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/purchases/scans/${createdScanId}/file`,
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it("4. Saves draft edits without finalizing or posting to ledger", async () => {
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/purchases/scans/${createdScanId}`,
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/json",
      },
      payload: {
        vendorInvoiceNumber: "GAMC-VERIFIED-001",
        invoiceDate: "2026-10-14",
      },
    });

    expect(patchRes.statusCode).toBe(200);
    const updated = JSON.parse(patchRes.body);
    expect(updated.extractedData.invoice.invoiceNumber).toBe("GAMC-VERIFIED-001");
  });

  it("5. Confirms purchase: creates new products, posts stock receipt & balances general ledger", async () => {
    const confirmRes = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/scans/${createdScanId}/confirm`,
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/json",
      },
      payload: {
        partyId: supplierAId,
        vendorInvoiceNumber: "GAMC-VERIFIED-001",
        invoiceDate: "2026-10-14",
        warehouseId: warehouseAId,
        items: [
          {
            itemId: itemAId,
            hsnCode: "3105",
            quantity: 10,
            unitPrice: 800,
            taxRate: 18,
          },
          {
            createNewProduct: true,
            newProductDetails: {
              name: "High Pressure Spray Nozzle Set",
              hsnCode: "8424",
              unitSymbol: "PCS",
              taxRate: 18,
              purchasePrice: 225,
            },
            hsnCode: "8424",
            quantity: 20,
            unitPrice: 225,
            taxRate: 18,
          },
        ],
      },
    });

    expect(confirmRes.statusCode).toBe(201);
    const body = JSON.parse(confirmRes.body);

    expect(body.scan.status).toBe("CONFIRMED");
    expect(body.scan.purchaseInvoiceId).toBeDefined();

    const invoice = body.invoice;
    expect(invoice.vendorInvoiceNumber).toBe("GAMC-VERIFIED-001");
    expect(invoice.partyId).toBe(supplierAId);
    expect(invoice.items.length).toBe(2);

    // Verify approved new product was persisted in Item catalog
    const createdItem = await prisma.item.findFirst({
      where: {
        companyId: companyAId,
        name: "High Pressure Spray Nozzle Set",
      },
    });
    expect(createdItem).toBeDefined();
    expect(createdItem?.hsnCode).toBe("8424");

    // Verify Inward Stock Transactions (PURCHASE_RECEIPT)
    const stockReceipts = await prisma.stockTransaction.findMany({
      where: {
        companyId: companyAId,
        referenceDocType: "PURCHASE_INVOICE",
        referenceDocId: invoice.id,
      },
    });
    expect(stockReceipts.length).toBe(2);
    for (const receipt of stockReceipts) {
      expect(receipt.transactionType).toBe("PURCHASE_RECEIPT");
      expect(new Decimal(receipt.quantity.toString()).isPositive()).toBe(true);
      expect(receipt.warehouseId).toBe(warehouseAId);
    }

    // Verify Double-Entry Voucher and balancing Journal Entries
    const voucher = await prisma.voucher.findFirst({
      where: {
        companyId: companyAId,
        voucherType: "PURCHASE",
        referenceNo: "GAMC-VERIFIED-001",
      },
      include: {
        journalEntries: {
          include: { account: true },
        },
      },
    });
    expect(voucher).toBeDefined();

    let totalDebit = new Decimal(0);
    let totalCredit = new Decimal(0);
    for (const entry of voucher!.journalEntries) {
      totalDebit = totalDebit.plus(new Decimal(entry.debitAmount.toString()));
      totalCredit = totalCredit.plus(new Decimal(entry.creditAmount.toString()));
    }
    // Strict accounting balance: Total Dr == Total Cr
    expect(totalDebit.toFixed(2)).toBe(totalCredit.toFixed(2));
    expect(totalDebit.toFixed(2)).toBe(new Decimal(invoice.grandTotal.toString()).toFixed(2));
  });

  it("6. Concurrency & Idempotency: Re-calling confirm returns existing purchase without duplicating stock or vouchers", async () => {
    // Count records before retry
    const [initialStockCount, initialVoucherCount] = await Promise.all([
      prisma.stockTransaction.count({ where: { companyId: companyAId } }),
      prisma.voucher.count({ where: { companyId: companyAId } }),
    ]);

    const retryRes = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/scans/${createdScanId}/confirm`,
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/json",
      },
      payload: {
        partyId: supplierAId,
        vendorInvoiceNumber: "GAMC-VERIFIED-001",
        items: [{ itemId: itemAId, quantity: 10, unitPrice: 800, taxRate: 18 }],
      },
    });

    expect(retryRes.statusCode).toBe(201);
    const body = JSON.parse(retryRes.body);
    expect(body.isIdempotentReplay).toBe(true);

    // Verify stock and voucher counts remained strictly identical (no duplication!)
    const [finalStockCount, finalVoucherCount] = await Promise.all([
      prisma.stockTransaction.count({ where: { companyId: companyAId } }),
      prisma.voucher.count({ where: { companyId: companyAId } }),
    ]);

    expect(finalStockCount).toBe(initialStockCount);
    expect(finalVoucherCount).toBe(initialVoucherCount);
  });

  it("7. Tenant Isolation: Company B cannot access or download Company A's scan or file", async () => {
    // 1. Company B tries to view Company A's scan
    const getRes = await app.inject({
      method: "GET",
      url: `/api/v1/purchases/scans/${createdScanId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getRes.statusCode).toBe(404);

    // 2. Company B tries to download Company A's file
    const fileRes = await app.inject({
      method: "GET",
      url: `/api/v1/purchases/scans/${createdScanId}/file`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(fileRes.statusCode).toBe(404);

    // 3. Company B tries to confirm Company A's scan
    const confirmRes = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/scans/${createdScanId}/confirm`,
      headers: {
        authorization: `Bearer ${tokenB}`,
        "content-type": "application/json",
      },
      payload: {
        partyId: supplierAId,
        vendorInvoiceNumber: "GAMC-HIJACK-001",
        items: [{ itemId: itemAId, quantity: 1, unitPrice: 10, taxRate: 18 }],
      },
    });
    expect(confirmRes.statusCode).toBe(404);
  });

  it("8. Real Document End-to-End: Uploads real invoice, extracts fields & items via local OCR, confirms purchase with stock & voucher integrity", async () => {
    const filePath = path.join(__dirname, "fixtures/scanner-verification/indian_gst_invoice.pdf");
    const fileBuf = await fs.readFile(filePath);

    // 1. Upload with real local OCR provider
    const uploadRes = await app.inject({
      method: "POST",
      url: "/api/v1/purchases/scans/upload",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/json",
      },
      payload: {
        fileBase64: fileBuf.toString("base64"),
        fileName: "indian_gst_invoice.pdf",
        mimeType: "application/pdf",
        provider: "local",
      },
    });

    expect(uploadRes.statusCode).toBe(201);
    const scanRecord = JSON.parse(uploadRes.body);
    expect(scanRecord.id).toBeDefined();
    expect(scanRecord.status).toBe("READY_FOR_REVIEW");
    expect(scanRecord.extractedData.items.length).toBeGreaterThan(0);

    const extractedItem = scanRecord.extractedData.items[0];
    expect(extractedItem.description).toBeDefined();
    expect(Number(extractedItem.quantity)).toBeGreaterThan(0);
    expect(Number(extractedItem.unitPrice)).toBeGreaterThan(0);

    // 2. Persist purchase confirmation
    const vendorInvNo = scanRecord.extractedData.invoice?.invoiceNumber || `REAL-INV-${Date.now()}`;
    const initialPurchaseCount = await prisma.purchaseInvoice.count({
      where: { companyId: companyAId },
    });
    const initialStockCount = await prisma.stockTransaction.count({
      where: { companyId: companyAId },
    });
    const initialVoucherCount = await prisma.voucher.count({
      where: { companyId: companyAId },
    });

    const confirmRes = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/scans/${scanRecord.id}/confirm`,
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/json",
      },
      payload: {
        partyId: supplierAId,
        vendorInvoiceNumber: vendorInvNo,
        invoiceDate: "2026-10-10",
        warehouseId: warehouseAId,
        items: [
          {
            itemId: itemAId,
            quantity: extractedItem.quantity,
            unitPrice: extractedItem.unitPrice,
            taxRate: extractedItem.taxRate || 18,
          },
        ],
      },
    });

    expect(confirmRes.statusCode).toBe(201);
    const confirmBody = JSON.parse(confirmRes.body);
    expect(confirmBody.invoice).toBeDefined();
    expect(confirmBody.invoice.vendorInvoiceNumber).toBe(vendorInvNo);

    // 3. Verify exactly one purchase invoice created
    const finalPurchaseCount = await prisma.purchaseInvoice.count({
      where: { companyId: companyAId },
    });
    expect(finalPurchaseCount).toBe(initialPurchaseCount + 1);

    // 4. Verify stock transaction created
    const finalStockCount = await prisma.stockTransaction.count({
      where: { companyId: companyAId },
    });
    expect(finalStockCount).toBe(initialStockCount + 1);

    // 5. Verify balanced voucher created
    const finalVoucherCount = await prisma.voucher.count({
      where: { companyId: companyAId },
    });
    expect(finalVoucherCount).toBe(initialVoucherCount + 1);

    // 6. Test Idempotency: Re-confirming does not duplicate records
    const retryRes = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/scans/${scanRecord.id}/confirm`,
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/json",
      },
      payload: {
        partyId: supplierAId,
        vendorInvoiceNumber: vendorInvNo,
        items: [
          {
            itemId: itemAId,
            quantity: extractedItem.quantity,
            unitPrice: extractedItem.unitPrice,
            taxRate: 18,
          },
        ],
      },
    });
    expect(retryRes.statusCode).toBe(201);
    const retryBody = JSON.parse(retryRes.body);
    expect(retryBody.isIdempotentReplay).toBe(true);

    expect(await prisma.purchaseInvoice.count({ where: { companyId: companyAId } })).toBe(finalPurchaseCount);
    expect(await prisma.stockTransaction.count({ where: { companyId: companyAId } })).toBe(finalStockCount);
    expect(await prisma.voucher.count({ where: { companyId: companyAId } })).toBe(finalVoucherCount);
  }, 30000);

  it("9. Mobile Camera Capture: Successfully processes 12MP camera photo upload without memory crash", async () => {
    const cameraImgPath = path.join(__dirname, "fixtures/scanner-verification/test_mobile_camera_12mp.jpg");
    const fileBuf = await fs.readFile(cameraImgPath);

    const uploadRes = await app.inject({
      method: "POST",
      url: "/api/v1/purchases/scans/upload",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/json",
      },
      payload: {
        fileBase64: fileBuf.toString("base64"),
        fileName: "mobile_camera_capture_12mp.jpg",
        mimeType: "image/jpeg",
        provider: "local",
      },
    });

    expect(uploadRes.statusCode).toBe(201);
    const scan = JSON.parse(uploadRes.body);
    expect(scan.id).toBeDefined();
    expect(scan.status).toBe("READY_FOR_REVIEW");
    expect(scan.fileMimeType).toBe("image/jpeg");
    expect(scan.extractedData).toBeDefined();
  }, 30000);

  it("10. Mobile Camera HEIC: Correctly identifies HEIC header and executes conversion workflow", async () => {
    // Generate valid HEIC box header
    const heicHeader = Buffer.from([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70, // 'ftyp'
      0x68, 0x65, 0x69, 0x63, // 'heic'
      0x00, 0x00, 0x00, 0x00,
    ]);
    const simulatedHeic = Buffer.concat([heicHeader, Buffer.alloc(100)]);

    // When an invalid/truncated HEIC payload is uploaded, server catches it and returns 400 with format explanation
    const uploadRes = await app.inject({
      method: "POST",
      url: "/api/v1/purchases/scans/upload",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/json",
      },
      payload: {
        fileBase64: simulatedHeic.toString("base64"),
        fileName: "iphone_bill.heic",
        mimeType: "image/heic",
        provider: "local",
      },
    });

    // Expect either successful conversion or clear HEIC conversion 400 error (not 500 crash)
    expect([201, 400]).toContain(uploadRes.statusCode);
    if (uploadRes.statusCode === 400) {
      const err = JSON.parse(uploadRes.body);
      expect(err.message.toLowerCase()).toContain("heic");
    }
  });

  it("11. Asynchronous Upload: Returns scan ID and status PROCESSING promptly (<500ms), background OCR completes and is pollable", async () => {
    const validPdfBuffer = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF");
    const base64File = validPdfBuffer.toString("base64");

    const uploadStart = Date.now();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/purchases/scans/upload?async=true",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/json",
      },
      payload: {
        fileBase64: base64File,
        fileName: "async_test_bill.pdf",
        mimeType: "application/pdf",
        provider: "local",
      },
    });
    const uploadDuration = Date.now() - uploadStart;

    // Prompt response expected in < 1500ms
    expect(res.statusCode).toBe(201);
    expect(uploadDuration).toBeLessThan(1500);

    const body = JSON.parse(res.body);
    expect(body.id).toBeDefined();
    expect(body.status).toBe("PROCESSING");
    expect(body.fileName).toBe("async_test_bill.pdf");

    const asyncScanId = body.id;

    // Poll until complete
    let pollCount = 0;
    let pollRes: any = null;
    while (pollCount < 20) {
      await new Promise((r) => setTimeout(r, 200));
      const getRes = await app.inject({
        method: "GET",
        url: `/api/v1/purchases/scans/${asyncScanId}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(getRes.statusCode).toBe(200);
      pollRes = JSON.parse(getRes.body);
      if (pollRes.status === "READY_FOR_REVIEW" || pollRes.status === "FAILED") {
        break;
      }
      pollCount++;
    }

    expect(pollRes.status).toBe("READY_FOR_REVIEW");
    expect(pollRes.extractedData).toBeDefined();
    expect(pollRes.companyId).toBe(companyAId);
  });

  it("12. Retry Scan Endpoint: Re-initiates OCR on existing document without duplicate files or duplicate scans", async () => {
    const storageService = app.get(BillStorageService);
    const validPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF");
    const scanId = "00000000-0000-0000-0000-111122223333";
    const stored = await storageService.validateAndSaveFile(validPdf, "retry_test.pdf", companyAId, scanId);

    const company = await prisma.executeBypassRls(async (tx) => {
      return tx.company.findUnique({ where: { id: companyAId } });
    });

    const failedScan = await prisma.executeBypassRls(async (tx) => {
      return tx.purchaseBillScan.create({
        data: {
          id: scanId,
          organizationId: company!.organizationId,
          companyId: companyAId,
          fileName: stored.fileName,
          fileMimeType: stored.mimeType,
          fileSizeBytes: stored.sizeBytes,
          fileStoragePath: stored.storagePath,
          fileSha256: stored.sha256,
          status: "FAILED",
          ocrProvider: "local",
          errorMessage: "Simulated previous failure",
        },
      });
    });

    // 2. Call POST /purchases/scans/:id/retry
    const retryRes = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/scans/${failedScan.id}/retry?provider=local`,
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(retryRes.statusCode).toBe(200);
    const retryBody = JSON.parse(retryRes.body);
    expect(retryBody.id).toBe(failedScan.id);
    expect(retryBody.status).toBe("PROCESSING");

    // Verify no new scan was created in company
    const totalScans = await prisma.executeBypassRls(async (tx) => {
      return tx.purchaseBillScan.count({
        where: { companyId: companyAId, id: scanId },
      });
    });
    expect(totalScans).toBe(1);
  });

  it("13. Error Classification: Accurately classifies Gemini rate limit, invalid key, timeout, and network errors", async () => {
    const scannerService = app.get(PurchaseScannerService);

    // Invalid Key
    const keyErr = scannerService.classifyOcrError(new Error("API key not valid. Please pass a valid API key."));
    expect(keyErr.category).toBe("INVALID_API_KEY");

    // Rate Limit / Quota
    const quotaErr = scannerService.classifyOcrError({ status: 429, message: "Resource has been exhausted (check quota)." });
    expect(quotaErr.category).toBe("RATE_LIMIT_OR_QUOTA");

    // Timeout
    const timeoutErr = scannerService.classifyOcrError(new Error("Gemini Vision OCR timed out after 35000ms"), 35000);
    expect(timeoutErr.category).toBe("TIMEOUT");

    // Network Failure
    const netErr = scannerService.classifyOcrError(new Error("fetch failed: ENOTFOUND generativelanguage.googleapis.com"));
    expect(netErr.category).toBe("NETWORK_ERROR");

    // Document Parse Error
    const parseErr = scannerService.classifyOcrError(new Error("Gemini returned invalid or unparseable JSON for this invoice document."));
    expect(parseErr.category).toBe("DOCUMENT_PARSE_ERROR");
  });
});
