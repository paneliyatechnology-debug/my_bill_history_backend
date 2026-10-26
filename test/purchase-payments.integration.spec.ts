import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import * as bcrypt from "bcryptjs";
import { DatabaseService } from "../src/database/database.service";

describe("Supplier purchase payments", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;
  let tokenA = "";
  let tokenB = "";
  let auditorToken = "";
  let companyA = "";
  let orgA = "";
  const headersA = () => ({ authorization: `Bearer ${tokenA}` });
  const headersB = () => ({ authorization: `Bearer ${tokenB}` });

  const createBill = async (number: string) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/purchases",
      headers: headersA(),
      payload: {
        partyId: supplierId,
        vendorInvoiceNumber: number,
        invoiceDate: "2026-10-12",
        warehouseId,
        items: [{ itemId, quantity: 1, unitPrice: 1000, taxRate: 18 }],
      },
    });
    expect(response.statusCode).toBe(201);
    return JSON.parse(response.body);
  };

  let supplierId = "";
  let warehouseId = "";
  let itemId = "";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    app.setGlobalPrefix("api/v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(DatabaseService);

    await prisma.executeBypassRls(async (tx) => {
      const users = await tx.user.findMany({
        where: { phone: { in: ["9825999044", "9825999045", "9825999099"] } },
        select: { organizationId: true },
      });
      const orgIds = users.map((user) => user.organizationId);
      if (orgIds.length === 0) return;
      await tx.paymentAllocation.deleteMany({ where: { voucher: { organizationId: { in: orgIds } } } });
      await tx.journalEntry.deleteMany({ where: { voucher: { organizationId: { in: orgIds } } } });
      await tx.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.purchaseReturnItem.deleteMany({ where: { returnDoc: { organizationId: { in: orgIds } } } });
      await tx.purchaseReturn.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.voucher.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.purchaseInvoiceItem.deleteMany({ where: { invoice: { organizationId: { in: orgIds } } } });
      await tx.purchaseInvoice.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.stockTransaction.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.item.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.unitOfMeasure.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.party.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.warehouse.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.ledgerGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.financialYear.deleteMany({ where: { company: { organizationId: { in: orgIds } } } });
      await tx.userBranchAssignment.deleteMany({ where: { branch: { organizationId: { in: orgIds } } } });
      await tx.branch.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.company.deleteMany({ where: { organizationId: { in: orgIds } } });
      const orgs = await tx.organization.findMany({ where: { id: { in: orgIds } }, select: { tenantId: true } });
      await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
      await tx.tenant.deleteMany({ where: { id: { in: orgs.map((org) => org.tenantId) } } });
    });

    const register = async (phone: string, name: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          fullName: name,
          phone,
          password: "Password@123",
          organizationName: `${name} Org`,
          tradeName: name,
          stateCode: "24",
        },
      });
      expect(response.statusCode).toBe(201);
      return JSON.parse(response.body);
    };
    const company = await register("9825999044", "Supplier Pay Co");
    tokenA = company.accessToken;
    companyA = company.defaultContext.companyId;
    orgA = company.defaultContext.organizationId;
    const other = await register("9825999045", "Other Pay Co");
    tokenB = other.accessToken;

    expect((await app.inject({ method: "POST", url: "/api/v1/ledger-groups/seed", headers: headersA() })).statusCode).toBe(201);
    const warehouse = JSON.parse((await app.inject({
      method: "POST",
      url: "/api/v1/tenants/warehouses",
      headers: headersA(),
      payload: { name: "Pay Godown", isDefault: true },
    })).body);
    warehouseId = warehouse.id;
    const unit = JSON.parse((await app.inject({
      method: "POST",
      url: "/api/v1/units",
      headers: headersA(),
      payload: { name: "Number", code: "NOS", isDecimalAllowed: false },
    })).body);
    const supplier = JSON.parse((await app.inject({
      method: "POST",
      url: "/api/v1/parties",
      headers: headersA(),
      payload: {
        type: "SUPPLIER",
        name: "Pay Supplier",
        phone: "9825999046",
        gstin: "24ABCDE1234F1Z6",
        stateCode: "24",
        billingAddress: { line1: "Road", city: "Ahmedabad", pincode: "380001" },
      },
    })).body);
    supplierId = supplier.id;
    const item = JSON.parse((await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: headersA(),
      payload: {
        type: "PRODUCT",
        name: "Pay Item",
        sku: "PAY-ITEM",
        hsnCode: "7214",
        primaryUomId: unit.id,
        purchaseRate: 1000,
        retailPrice: 1200,
        taxRate: 18,
      },
    })).body);
    itemId = item.id;

    const auditorUser = await prisma.executeBypassRls(async (tx) => {
      const user = await tx.user.create({
        data: {
          organizationId: orgA,
          phone: "9825999099",
          email: "auditor@pay.com",
          fullName: "Auditor User",
          passwordHash: await bcrypt.hash("Password@123", 10),
          role: "AUDITOR",
          isActive: true,
        },
      });
      const branch = await tx.branch.findFirst({ where: { companyId: companyA } });
      await tx.userBranchAssignment.create({
        data: {
          userId: user.id,
          branchId: branch!.id,
          role: "AUDITOR",
          isDefault: true,
        },
      });
      return user;
    });

    const auditorLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        identifier: "9825999099",
        password: "Password@123",
      },
    });
    expect(auditorLogin.statusCode).toBe(200);
    auditorToken = JSON.parse(auditorLogin.body).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("settles a bill partially, then fully, and rejects a further payment", async () => {
    const bill = await createBill("PAY-PARTIAL");
    expect(Number(bill.balanceAmount)).toBe(1180);
    const supplierBefore = await prisma.executeBypassRls((tx) =>
      tx.ledgerAccount.findFirst({ where: { companyId: companyA, partyId: supplierId } }),
    );

    const partial = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/payments`,
      headers: { ...headersA(), "idempotency-key": "partial-1" },
      payload: { amount: 180, paymentDate: "2026-10-14", paymentMode: "CASH" },
    });
    expect(partial.statusCode).toBe(201);
    const partialBody = JSON.parse(partial.body);
    expect(partialBody.replayed).toBe(false);
    expect(Number(partialBody.bills[0].balanceAmount)).toBe(1000);
    const lines = partialBody.voucher.journalEntries;
    const debit = lines.reduce((sum: number, line: any) => sum + Number(line.debitAmount), 0);
    const credit = lines.reduce((sum: number, line: any) => sum + Number(line.creditAmount), 0);
    expect(debit).toBeCloseTo(credit, 2);

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/payments`,
      headers: { ...headersA(), "idempotency-key": "partial-2" },
      payload: { amount: 1000, paymentDate: "2026-10-14", paymentMode: "CASH" },
    });
    expect(second.statusCode).toBe(201);
    expect(Number(JSON.parse(second.body).bills[0].balanceAmount)).toBe(0);

    const extra = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/payments`,
      headers: { ...headersA(), "idempotency-key": "partial-3" },
      payload: { amount: 1, paymentDate: "2026-10-14" },
    });
    expect(extra.statusCode).toBe(400);

    const supplierAfter = await prisma.executeBypassRls((tx) =>
      tx.ledgerAccount.findFirst({ where: { id: supplierBefore!.id } }),
    );
    expect(Number(supplierBefore!.currentBalance) - Number(supplierAfter!.currentBalance)).toBeCloseTo(1180, 2);
  });

  it("allocates one payment across two bills and replays the same key once", async () => {
    const first = await createBill("PAY-MULTI-1");
    const second = await createBill("PAY-MULTI-2");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/purchases/payments",
      headers: { ...headersA(), "idempotency-key": "multi-bills" },
      payload: {
        paymentDate: "2026-10-14",
        paymentMode: "CASH",
        allocations: [
          { purchaseInvoiceId: first.id, amount: 180 },
          { purchaseInvoiceId: second.id, amount: 200 },
        ],
      },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.allocations).toHaveLength(2);
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/purchases/payments",
      headers: { ...headersA(), "idempotency-key": "multi-bills" },
      payload: {
        paymentDate: "2026-10-14",
        allocations: [
          { purchaseInvoiceId: first.id, amount: 180 },
          { purchaseInvoiceId: second.id, amount: 200 },
        ],
      },
    });
    expect(replay.statusCode).toBe(201);
    expect(JSON.parse(replay.body).replayed).toBe(true);
    const count = await prisma.executeBypassRls((tx) =>
      tx.voucher.count({ where: { companyId: companyA, referenceNo: "multi-bills", sourceDocument: "PURCHASE_PAYMENT" } }),
    );
    expect(count).toBe(1);
    const refreshed = await prisma.executeBypassRls((tx) => tx.purchaseInvoice.findUnique({ where: { id: first.id } }));
    expect(Number(refreshed?.balanceAmount)).toBe(1000);
  });

  it("rejects overpayment, another company, a missing bill, and a locked year", async () => {
    const bill = await createBill("PAY-GUARD");
    const over = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/payments`,
      headers: { ...headersA(), "idempotency-key": "over-1" },
      payload: { amount: 1181, paymentDate: "2026-10-14" },
    });
    expect(over.statusCode).toBe(400);

    const foreign = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/payments`,
      headers: { ...headersB(), "idempotency-key": "foreign-1" },
      payload: { amount: 10, paymentDate: "2026-10-14" },
    });
    expect(foreign.statusCode).toBe(404);

    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/purchases/00000000-0000-0000-0000-000000000000/payments",
      headers: { ...headersA(), "idempotency-key": "missing-1" },
      payload: { amount: 10, paymentDate: "2026-10-14" },
    });
    expect(missing.statusCode).toBe(404);

    const year = await prisma.executeBypassRls((tx) =>
      tx.financialYear.findFirst({ where: { companyId: companyA, isCurrent: true } }),
    );
    await prisma.executeBypassRls((tx) => tx.financialYear.update({ where: { id: year!.id }, data: { isLocked: true } }));
    const locked = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/payments`,
      headers: { ...headersA(), "idempotency-key": "locked-1" },
      payload: { amount: 10, paymentDate: "2026-10-14" },
    });
    await prisma.executeBypassRls((tx) => tx.financialYear.update({ where: { id: year!.id }, data: { isLocked: false } }));
    expect(locked.statusCode).toBe(400);
    const untouched = await prisma.executeBypassRls((tx) => tx.purchaseInvoice.findUnique({ where: { id: bill.id } }));
    expect(Number(untouched?.balanceAmount)).toBe(1180);
  });

  it("serializes two payments so the payable cannot be settled twice", async () => {
    const bill = await createBill("PAY-RACE");
    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/v1/purchases/${bill.id}/payments`,
        headers: { ...headersA(), "idempotency-key": "race-a" },
        payload: { amount: 1180, paymentDate: "2026-10-14" },
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/purchases/${bill.id}/payments`,
        headers: { ...headersA(), "idempotency-key": "race-b" },
        payload: { amount: 1180, paymentDate: "2026-10-14" },
      }),
    ]);
    const codes = [first.statusCode, second.statusCode].sort();
    expect(codes).toEqual([201, 400]);
    const refreshed = await prisma.executeBypassRls((tx) => tx.purchaseInvoice.findUnique({ where: { id: bill.id } }));
    expect(Number(refreshed?.balanceAmount)).toBe(0);
  });

  it("rolls back the bill update when the payment voucher number collides", async () => {
    const bill = await createBill("PAY-ROLLBACK");
    const stored = await prisma.executeBypassRls((tx) =>
      tx.purchaseInvoice.findUnique({ where: { id: bill.id } }),
    );
    await prisma.executeBypassRls((tx) =>
      tx.voucher.create({
        data: {
          organizationId: stored!.organizationId,
          companyId: companyA,
          financialYearId: stored!.financialYearId,
          voucherType: "PAYMENT",
          voucherNumber: "PAY/ROLLBACK1",
          voucherDate: new Date("2026-10-14"),
          totalAmount: "1.00",
          referenceNo: "unrelated-voucher",
        },
      }),
    );
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/payments`,
      headers: { ...headersA(), "idempotency-key": "ROLLBACK1" },
      payload: { amount: 100, paymentDate: "2026-10-14" },
    });
    expect(response.statusCode).toBe(409);
    const refreshed = await prisma.executeBypassRls((tx) => tx.purchaseInvoice.findUnique({ where: { id: bill.id } }));
    expect(Number(refreshed?.paidAmount)).toBe(0);
    expect(Number(refreshed?.balanceAmount)).toBe(1180);
    const allocations = await prisma.executeBypassRls((tx) =>
      tx.paymentAllocation.count({ where: { purchaseInvoiceId: bill.id } }),
    );
    expect(allocations).toBe(0);
  });

  it("rejects a payment after a return has removed the remaining payable", async () => {
    const bill = await createBill("PAY-RETURN");
    const paid = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/payments`,
      headers: { ...headersA(), "idempotency-key": "return-pay" },
      payload: { amount: 1180, paymentDate: "2026-10-14" },
    });
    expect(paid.statusCode).toBe(201);
    const returned = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/returns`,
      headers: headersA(),
      payload: {
        returnDate: "2026-10-14",
        reason: "Supplier took the goods back after payment",
        warehouseId,
        items: [{ purchaseItemId: bill.items[0].id, quantity: 1 }],
      },
    });
    expect(returned.statusCode).toBe(201);
    const credit = await prisma.executeBypassRls((tx) => tx.purchaseInvoice.findUnique({ where: { id: bill.id } }));
    expect(Number(credit?.balanceAmount)).toBeLessThan(0);
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/payments`,
      headers: { ...headersA(), "idempotency-key": "return-pay-2" },
      payload: { amount: 10, paymentDate: "2026-10-14" },
    });
    expect(again.statusCode).toBe(400);
    expect(orgA).toBeTruthy();
  });

  it("rejects payment creation by an AUDITOR (403 Forbidden)", async () => {
    const bill = await createBill("PAY-AUDITOR-TEST");
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/payments`,
      headers: { authorization: `Bearer ${auditorToken}` },
      payload: { amount: 100, paymentDate: "2026-10-14" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("settles a bill for a party initially created as CUSTOMER and upgrades party to BOTH", async () => {
    const custRes = await app.inject({
      method: "POST",
      url: "/api/v1/parties",
      headers: headersA(),
      payload: {
        type: "CUSTOMER",
        name: "Dual Role Customer",
        phone: "9825999088",
        stateCode: "24",
        billingAddress: { line1: "Shop 1", city: "Ahmedabad", pincode: "380001" },
      },
    });
    expect(custRes.statusCode).toBe(201);
    const customer = JSON.parse(custRes.body);
    expect(customer.type).toBe("CUSTOMER");

    const billRes = await app.inject({
      method: "POST",
      url: "/api/v1/purchases",
      headers: headersA(),
      payload: {
        partyId: customer.id,
        vendorInvoiceNumber: "DUAL-ROLE-BILL-1",
        invoiceDate: "2026-10-14",
        warehouseId,
        items: [{ itemId, quantity: 1, unitPrice: 1000, taxRate: 18 }],
      },
    });
    expect(billRes.statusCode).toBe(201);
    const bill = JSON.parse(billRes.body);

    const payRes = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/payments`,
      headers: headersA(),
      payload: { amount: 1180, paymentDate: "2026-10-14" },
    });
    expect(payRes.statusCode).toBe(201);

    const updatedParty = await prisma.executeBypassRls((tx) =>
      tx.party.findUnique({ where: { id: customer.id } }),
    );
    expect(updatedParty?.type).toBe("BOTH");
  });
});
