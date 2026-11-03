import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NestFastifyApplication, FastifyAdapter } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import {
  calculateNextOccurrence,
  getInitialNextRun,
} from "../src/automated-billing/automated-billing-recurrence.helper";

describe("Automated Billing / Recurring Invoices Integration Test Suite", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  let tenantTokenA: string;
  let tenantTokenB: string;
  let companyIdA: string;
  let customerIdA: string;
  let itemIdA: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    app.setGlobalPrefix("api/v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(DatabaseService);

    // 1. Setup Tenant A
    const phoneA = `9879${Math.floor(100000 + Math.random() * 900000)}`;
    const regResA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Automated Admin A",
        phone: phoneA,
        email: `autobillA_${Date.now()}@test.local`,
        password: "PasswordBilling123#",
        organizationName: "Auto Billing Org A",
        tradeName: "Auto Billing Enterprises A",
        stateCode: "24",
      },
    });
    expect(regResA.statusCode).toBe(201);
    const authA = JSON.parse(regResA.body);
    tenantTokenA = authA.accessToken;
    companyIdA = authA.defaultContext.companyId;

    // 2. Setup Tenant B
    const phoneB = `9879${Math.floor(100000 + Math.random() * 900000)}`;
    const regResB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Automated Admin B",
        phone: phoneB,
        email: `autobillB_${Date.now()}@test.local`,
        password: "PasswordBilling123#",
        organizationName: "Auto Billing Org B",
        tradeName: "Auto Billing Enterprises B",
        stateCode: "24",
      },
    });
    expect(regResB.statusCode).toBe(201);
    const authB = JSON.parse(regResB.body);
    tenantTokenB = authB.accessToken;

    // 3. Create a Customer Party for Tenant A
    const partyRes = await app.inject({
      method: "POST",
      url: "/api/v1/parties",
      headers: { authorization: `Bearer ${tenantTokenA}` },
      payload: {
        name: "Acme Regular Customer",
        phone: "9123456789",
        stateCode: "24",
        type: "CUSTOMER",
        billingAddress: { line1: "101 MG Road", city: "Ahmedabad", state: "Gujarat", pincode: "380001" },
      },
    });
    const partyData = JSON.parse(partyRes.body);
    customerIdA = partyData.id;

    // 4. Create an Item for Tenant A
    const itemRes = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: { authorization: `Bearer ${tenantTokenA}` },
      payload: {
        name: "Monthly AMC Service",
        salePrice: 1500,
        taxRate: 18,
        hsnCode: "998313",
      },
    });
    const itemData = JSON.parse(itemRes.body);
    itemIdA = itemData.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe("1. Recurrence Helper Pure Logic", () => {
    it("should calculate daily recurrence accurately", () => {
      const start = new Date(Date.UTC(2026, 0, 10)); // Jan 10
      const next = calculateNextOccurrence({
        frequency: "DAILY",
        interval: 3,
        startDate: start,
        fromDate: start,
      });
      expect(next).not.toBeNull();
      expect(next!.getUTCDate()).toBe(13);
      expect(next!.getUTCMonth()).toBe(0);
    });

    it("should clamp month-end correctly (e.g. Jan 31 -> Feb 28 on non-leap year)", () => {
      const jan31 = new Date(Date.UTC(2025, 0, 31)); // Jan 31 2025
      const febRun = calculateNextOccurrence({
        frequency: "MONTHLY",
        interval: 1,
        dayOfMonth: 31,
        startDate: jan31,
        fromDate: jan31,
      });
      expect(febRun).not.toBeNull();
      expect(febRun!.getUTCMonth()).toBe(1); // Feb
      expect(febRun!.getUTCDate()).toBe(28); // 2025 is not a leap year
    });

    it("should handle leap year Feb 29 correctly (2028 is leap year)", () => {
      const jan31 = new Date(Date.UTC(2028, 0, 31));
      const febRun = calculateNextOccurrence({
        frequency: "MONTHLY",
        interval: 1,
        dayOfMonth: 31,
        startDate: jan31,
        fromDate: jan31,
      });
      expect(febRun).not.toBeNull();
      expect(febRun!.getUTCMonth()).toBe(1); // Feb
      expect(febRun!.getUTCDate()).toBe(29); // 2028 is leap year
    });

    it("should return null if next run exceeds end date", () => {
      const start = new Date(Date.UTC(2026, 0, 1));
      const end = new Date(Date.UTC(2026, 0, 5));
      const next = calculateNextOccurrence({
        frequency: "DAILY",
        interval: 10,
        startDate: start,
        endDate: end,
        fromDate: start,
      });
      expect(next).toBeNull();
    });
  });

  describe("2. Schedule Lifecycle & State Transitions", () => {
    let scheduleId: string;

    it("should create a monthly automated billing schedule", async () => {
      const today = new Date().toISOString().split("T")[0];
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/sales/automated-billing",
        headers: { authorization: `Bearer ${tenantTokenA}` },
        payload: {
          scheduleName: "Acme Monthly Maintenance",
          partyId: customerIdA,
          startDate: today,
          frequency: "MONTHLY",
          interval: 1,
          dayOfMonth: 1,
          paymentTerms: "Net 15",
          dueDays: 15,
          notes: "Monthly regular billing",
          lines: [
            {
              itemId: itemIdA,
              description: "Monthly AMC Retainer",
              quantity: 1,
              rate: 1500,
              taxRate: 18,
              discountPercent: 0,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.id).toBeDefined();
      expect(data.status).toBe("ACTIVE");
      expect(data.scheduleName).toBe("Acme Monthly Maintenance");
      expect(Number(data.estimatedTotal)).toBe(1770); // 1500 + 18% GST (270)
      scheduleId = data.id;
    });

    it("should list schedules and verify dashboard summary counts", async () => {
      const listRes = await app.inject({
        method: "GET",
        url: "/api/v1/sales/automated-billing?status=ACTIVE",
        headers: { authorization: `Bearer ${tenantTokenA}` },
      });
      expect(listRes.statusCode).toBe(200);
      const listData = JSON.parse(listRes.body);
      expect(listData.items.length).toBeGreaterThan(0);
      expect(listData.items.some((s: any) => s.id === scheduleId)).toBe(true);

      const summaryRes = await app.inject({
        method: "GET",
        url: "/api/v1/sales/automated-billing/summary",
        headers: { authorization: `Bearer ${tenantTokenA}` },
      });
      expect(summaryRes.statusCode).toBe(200);
      const summary = JSON.parse(summaryRes.body);
      expect(summary.activeSchedulesCount).toBeGreaterThanOrEqual(1);
    });

    it("should pause schedule successfully", async () => {
      const pauseRes = await app.inject({
        method: "POST",
        url: `/api/v1/sales/automated-billing/${scheduleId}/pause`,
        headers: { authorization: `Bearer ${tenantTokenA}` },
      });
      expect(pauseRes.statusCode).toBe(201);
      const data = JSON.parse(pauseRes.body);
      expect(data.status).toBe("PAUSED");
    });

    it("should resume paused schedule successfully", async () => {
      const resumeRes = await app.inject({
        method: "POST",
        url: `/api/v1/sales/automated-billing/${scheduleId}/resume`,
        headers: { authorization: `Bearer ${tenantTokenA}` },
      });
      expect(resumeRes.statusCode).toBe(201);
      const data = JSON.parse(resumeRes.body);
      expect(data.status).toBe("ACTIVE");
    });

    it("should execute Run Now and generate a real legal sales invoice", async () => {
      const runRes = await app.inject({
        method: "POST",
        url: `/api/v1/sales/automated-billing/${scheduleId}/run-now`,
        headers: { authorization: `Bearer ${tenantTokenA}` },
      });

      if (runRes.statusCode !== 201) {
        console.error("RUN RES ERROR BODY:", runRes.body);
      }

      expect(runRes.statusCode).toBe(201);
      const data = JSON.parse(runRes.body);
      expect(data.success).toBe(true);
      expect(data.invoice).toBeDefined();
      expect(data.invoice.invoiceNumber).toBeDefined();
      expect(Number(data.invoice.grandTotal)).toBe(1770);

      // Verify the generated invoice is visible in regular Sales Invoice list
      const invCheck = await app.inject({
        method: "GET",
        url: `/api/v1/sales/invoices/${data.invoice.id}`,
        headers: { authorization: `Bearer ${tenantTokenA}` },
      });
      expect(invCheck.statusCode).toBe(200);
      const invData = JSON.parse(invCheck.body);
      expect(invData.invoiceNumber).toBe(data.invoice.invoiceNumber);
      expect(invData.party.name).toBe("Acme Regular Customer");

      // Verify run history record
      const runsRes = await app.inject({
        method: "GET",
        url: `/api/v1/sales/automated-billing/${scheduleId}/runs`,
        headers: { authorization: `Bearer ${tenantTokenA}` },
      });
      expect(runsRes.statusCode).toBe(200);
      const runsData = JSON.parse(runsRes.body);
      expect(runsData.items.length).toBeGreaterThan(0);
      expect(runsData.items[0].status).toBe("SUCCESS");
      expect(runsData.items[0].invoiceId).toBe(data.invoice.id);
    });

    it("should stop schedule and prevent further modifications or runs", async () => {
      const stopRes = await app.inject({
        method: "POST",
        url: `/api/v1/sales/automated-billing/${scheduleId}/stop`,
        headers: { authorization: `Bearer ${tenantTokenA}` },
      });
      expect(stopRes.statusCode).toBe(201);
      const stopData = JSON.parse(stopRes.body);
      expect(stopData.status).toBe("STOPPED");
      expect(stopData.nextRunAt).toBeNull();

      // Trying to run or modify stopped schedule must fail with 400
      const rerunRes = await app.inject({
        method: "POST",
        url: `/api/v1/sales/automated-billing/${scheduleId}/run-now`,
        headers: { authorization: `Bearer ${tenantTokenA}` },
      });
      expect(rerunRes.statusCode).toBe(400);

      const resumeFail = await app.inject({
        method: "POST",
        url: `/api/v1/sales/automated-billing/${scheduleId}/resume`,
        headers: { authorization: `Bearer ${tenantTokenA}` },
      });
      expect(resumeFail.statusCode).toBe(400);
    });

    it("should enforce tenant isolation so Tenant B cannot view or operate on Tenant A schedule", async () => {
      const getRes = await app.inject({
        method: "GET",
        url: `/api/v1/sales/automated-billing/${scheduleId}`,
        headers: { authorization: `Bearer ${tenantTokenB}` },
      });
      expect(getRes.statusCode).toBe(404);

      const listB = await app.inject({
        method: "GET",
        url: "/api/v1/sales/automated-billing",
        headers: { authorization: `Bearer ${tenantTokenB}` },
      });
      expect(listB.statusCode).toBe(200);
      const bData = JSON.parse(listB.body);
      expect(bData.items.some((s: any) => s.id === scheduleId)).toBe(false);
    });
  });
});
