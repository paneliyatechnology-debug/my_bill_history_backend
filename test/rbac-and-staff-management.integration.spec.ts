import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import {
  UserRole,
  DataScope,
  ApprovalStatus,
  InvoiceCategory,
} from "@billing/shared-types";

describe("Staff Management, Multi-User Login & Granular RBAC System (Integration)", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  // Owner credentials & context
  const ownerPhone = "9988776655";
  const ownerPassword = "Password@123";
  let ownerToken: string;
  let ownerOrgId: string;
  let ownerCompanyId: string;
  let ownerBranchId: string;
  let ownerFyId: string;

  // Staff accounts
  const salesmanPhone = "9988776656";
  const salesmanUsername = "sales_ramesh";
  const salesmanPassword = "Sales@123";
  let salesmanId: string;
  let salesmanToken: string;

  const accountantPhone = "9988776657";
  const accountantUsername = "acct_suresh";
  const accountantPassword = "Acct@123";
  let accountantId: string;
  let accountantToken: string;

  // Shared master data
  let customerPartyId: string;
  let testItemId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );

    app.setGlobalPrefix("api/v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(DatabaseService);

    // Clean up test data for phones used in this suite
    const cleanupPhones = [ownerPhone, salesmanPhone, accountantPhone, "9988776658", "9988776659"];
    await prisma.executeBypassRls(async (tx) => {
      const users = await tx.user.findMany({
        where: { phone: { in: cleanupPhones } },
        select: { id: true, organizationId: true },
      });
      const userIds = users.map((u) => u.id);
      const orgIds = users.map((u) => u.organizationId);
      if (userIds.length > 0) {
        await tx.auditLog.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
        await tx.approvalRequest.deleteMany({ where: { requestedById: { in: userIds } } }).catch(() => {});
        await tx.userBranchAssignment.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
        await tx.userPermission.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
      }
      if (orgIds.length > 0) {
        await tx.stockTransaction.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
        await tx.journalEntry.deleteMany({ where: { voucher: { organizationId: { in: orgIds } } } }).catch(() => {});
        await tx.voucher.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
        await tx.salesInvoiceItem.deleteMany({ where: { invoice: { organizationId: { in: orgIds } } } }).catch(() => {});
        await tx.salesInvoice.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
        await tx.rolePermission.deleteMany({ where: { role: { organizationId: { in: orgIds } } } }).catch(() => {});
        await tx.role.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
        await tx.item.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
        await tx.party.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
        await tx.company.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } }).catch(() => {});
      }
      await tx.user.deleteMany({ where: { phone: { in: cleanupPhones } } }).catch(() => {});
      await tx.tenant.deleteMany({ where: { primaryPhone: { in: cleanupPhones } } }).catch(() => {});
    });

    // 1. Register Owner
    const regRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        phone: ownerPhone,
        password: ownerPassword,
        fullName: "Owner Jaydeep Khunt",
        email: "owner@billbook.test",
        organizationName: "RBAC Test Wholesale Corp",
        companyLegalName: "RBAC Test Wholesale Corp",
        companyTradeName: "RBAC Wholesale",
        state: "GUJARAT",
        pincode: "380001",
        city: "Ahmedabad",
      },
    });

    expect(regRes.statusCode).toBe(201);
    const regBody = JSON.parse(regRes.body);
    ownerToken = regBody.accessToken;
    ownerOrgId = regBody.defaultContext.organizationId;
    ownerCompanyId = regBody.defaultContext.companyId;
    ownerBranchId = regBody.defaultContext.branchId;
    ownerFyId = regBody.defaultContext.financialYearId;

    // Enable negative stock on test company so invoices can be created freely during RBAC testing
    await prisma.company.update({
      where: { id: ownerCompanyId },
      data: { allowNegativeStock: true },
    });

    // 2. Create customer party
    const party = await prisma.party.create({
      data: {
        organizationId: ownerOrgId,
        companyId: ownerCompanyId,
        name: "Test Retail Customer",
        phone: "9123456780",
        type: "CUSTOMER",
        stateCode: "24",
        billingAddress: {
          city: "Ahmedabad",
          pincode: "380001",
          state: "GUJARAT",
          stateCode: "24",
        },
      },
    });
    customerPartyId = party.id;

    // 3. Create test item with retailPrice = 1000
    const uom = await prisma.executeBypassRls(async (tx) => {
      let existingUom = await tx.unitOfMeasure.findFirst({
        where: { companyId: ownerCompanyId },
      });
      if (!existingUom) {
        existingUom = await tx.unitOfMeasure.create({
          data: {
            organizationId: ownerOrgId,
            companyId: ownerCompanyId,
            name: "Pieces",
            symbol: "PCS",
            uqcCode: "PCS",
            decimalPlaces: 0,
          },
        });
      }
      return existingUom;
    });

    await prisma.executeBypassRls(async (tx) => {
      const existingWh = await tx.warehouse.findFirst({
        where: { companyId: ownerCompanyId },
      });
      if (!existingWh) {
        await tx.warehouse.create({
          data: {
            organizationId: ownerOrgId,
            company: { connect: { id: ownerCompanyId } },
            branch: { connect: { id: ownerBranchId } },
            name: "Main Godown",
            isDefault: true,
          },
        });
      }
    });

    const item = await prisma.item.create({
      data: {
        organizationId: ownerOrgId,
        companyId: ownerCompanyId,
        name: "Standard RBAC Widget",
        hsnCode: "8471",
        primaryUomId: uom.id,
        taxRate: 18,
        retailPrice: 1000,
        purchaseRate: 700,
      },
    });
    testItemId = item.id;
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. STAFF CREATION & MULTI-USER LOGIN
  // =========================================================================
  describe("Staff Creation & Multi-User Login Flow", () => {
    it("should allow Owner to create Salesman with invoice limits & dataScope", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          fullName: "Ramesh Salesman",
          phone: salesmanPhone,
          username: salesmanUsername,
          password: salesmanPassword,
          role: "SALESMAN",
          branchIds: [ownerBranchId],
          dataScope: "OWN_RECORDS",
          maxInvoiceAmount: 20000,
          maxDiscountPercent: 10,
          canOverridePrice: false,
        },
      });

      if (res.statusCode !== 201) console.log("INVOICE ERROR:", res.statusCode, res.body);
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      salesmanId = body.id;
      expect(body.fullName).toBe("Ramesh Salesman");
      expect(body.role).toBe("SALESMAN");
      expect(body.dataScope).toBe("OWN_RECORDS");
      expect(body.maxInvoiceAmount).toBe(20000);
      expect(body.maxDiscountPercent).toBe(10);
      expect(body.canOverridePrice).toBe(false);
    });

    it("should allow Owner to create Accountant", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          fullName: "Suresh Accountant",
          phone: accountantPhone,
          username: accountantUsername,
          password: accountantPassword,
          role: "ACCOUNTANT",
          branchIds: [ownerBranchId],
          dataScope: "ALL_ORGANIZATION",
        },
      });

      if (res.statusCode !== 201) console.log("INVOICE ERROR:", res.statusCode, res.body);
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      accountantId = body.id;
      expect(body.role).toBe("ACCOUNTANT");
    });

    it("should allow Salesman to login using mobile number", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          identifier: salesmanPhone,
          password: salesmanPassword,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      salesmanToken = body.accessToken;
      expect(body.user.role).toBe("SALESMAN");
      expect(body.user.dataScope).toBe("OWN_RECORDS");
      expect(body.user.permissions.invoices.create).toBe(true);
      expect(body.user.permissions.settings.view).toBe(false); // Salesman cannot access settings
    });

    it("should allow Salesman to login using username", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          identifier: salesmanUsername,
          password: salesmanPassword,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.user.id).toBe(salesmanId);
      expect(body.user.username).toBe(salesmanUsername);
    });

    it("should allow Accountant to login and have access to vouchers & reports", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          identifier: accountantUsername,
          password: accountantPassword,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      accountantToken = body.accessToken;
      expect(body.user.role).toBe("ACCOUNTANT");
      expect(body.user.permissions.accounting.view).toBe(true);
      expect(body.user.permissions.reports.view).toBe(true);
      expect(body.user.permissions.settings.view).toBe(false);
    });
  });

  // =========================================================================
  // 2. PERMISSION ENFORCEMENT & UNAUTHORIZED ACCESS DENIAL (403)
  // =========================================================================
  describe("Granular Permission Enforcement (Guard & Decorator)", () => {
    it("should deny Salesman from accessing staff settings (HTTP 403)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/users",
        headers: {
          authorization: `Bearer ${salesmanToken}`,
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.message).toContain("Permission denied");
    });

    it("should deny Salesman from creating roles (HTTP 403)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/roles",
        headers: {
          authorization: `Bearer ${salesmanToken}`,
        },
        payload: {
          name: "Hacker Role",
          permissions: [],
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it("should allow Owner to view and manage users list", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/users",
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const list = JSON.parse(res.body);
      expect(list.length).toBeGreaterThanOrEqual(3); // Owner + Salesman + Accountant
    });
  });

  // =========================================================================
  // 3. SESSION REVOCATION & STATUS TOGGLING
  // =========================================================================
  describe("Session Revocation & Account Status", () => {
    it("should immediately invalidate Salesman token after session revocation", async () => {
      // 1. Verify token works currently
      const preCheck = await app.inject({
        method: "GET",
        url: "/api/v1/invoices",
        headers: {
          authorization: `Bearer ${salesmanToken}`,
        },
      });
      expect(preCheck.statusCode).toBe(200);

      // 2. Owner revokes Salesman sessions
      const revokeRes = await app.inject({
        method: "POST",
        url: `/api/v1/users/${salesmanId}/revoke-sessions`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });
      expect(revokeRes.statusCode).toBe(200);

      // 3. Next request with previous token must be rejected with 401 Unauthorized
      const postCheck = await app.inject({
        method: "GET",
        url: "/api/v1/users", // Protected by PermissionsGuard
        headers: {
          authorization: `Bearer ${salesmanToken}`,
        },
      });
      expect(postCheck.statusCode).toBe(401);
      const err = JSON.parse(postCheck.body);
      expect(err.message).toContain("revoked");

      // 4. Re-login to get fresh token
      const reLogin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          identifier: salesmanPhone,
          password: salesmanPassword,
        },
      });
      expect(reLogin.statusCode).toBe(200);
      salesmanToken = JSON.parse(reLogin.body).accessToken;
    });

    it("should block deactivated staff from logging in", async () => {
      // 1. Deactivate salesman
      await app.inject({
        method: "PATCH",
        url: `/api/v1/users/${salesmanId}/status`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: { isActive: false },
      });

      // 2. Try login
      const loginAttempt = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          identifier: salesmanPhone,
          password: salesmanPassword,
        },
      });
      expect(loginAttempt.statusCode).toBe(401);

      // 3. Reactivate salesman
      await app.inject({
        method: "PATCH",
        url: `/api/v1/users/${salesmanId}/status`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: { isActive: true },
      });

      // 4. Re-login to refresh salesmanToken
      const reLoginSalesman = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          identifier: salesmanPhone,
          password: salesmanPassword,
        },
      });
      expect(reLoginSalesman.statusCode).toBe(200);
      salesmanToken = JSON.parse(reLoginSalesman.body).accessToken;
    });
  });

  // =========================================================================
  // 4. INVOICE LIMITS & APPROVAL WORKFLOW
  // =========================================================================
  describe("Invoice Limits & Approval Workflow Trigger", () => {
    it("should allow Salesman to create invoice within limit (₹10,000 <= ₹20,000) with APPROVED status", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices",
        headers: {
          authorization: `Bearer ${salesmanToken}`,
        },
        payload: {
          partyId: customerPartyId,
          invoiceDate: new Date().toISOString().split("T")[0],
          paymentMode: "CASH",
          items: [
            {
              itemId: testItemId,
              quantity: 8,
              unitPrice: 1000,
              taxRate: 18,
              discountPercent: 5,
            },
          ],
        },
      });

      if (res.statusCode !== 201) console.log("INVOICE ERROR:", res.statusCode, res.body);
      expect(res.statusCode).toBe(201);
      const inv = JSON.parse(res.body);
      expect(inv.createdById).toBe(salesmanId);
      expect(inv.approvalStatus).toBe("APPROVED");
    });

    it("should trigger PENDING approval status when Salesman exceeds max invoice limit (₹30,000 > ₹20,000)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices",
        headers: {
          authorization: `Bearer ${salesmanToken}`,
        },
        payload: {
          partyId: customerPartyId,
          invoiceDate: new Date().toISOString().split("T")[0],
          paymentMode: "CASH",
          items: [
            {
              itemId: testItemId,
              quantity: 25, // 25 * 1000 + 18% tax = ₹29,500 > ₹20,000
              unitPrice: 1000,
              taxRate: 18,
              discountPercent: 0,
            },
          ],
        },
      });

      if (res.statusCode !== 201) console.log("INVOICE ERROR:", res.statusCode, res.body);
      expect(res.statusCode).toBe(201);
      const inv = JSON.parse(res.body);
      expect(inv.createdById).toBe(salesmanId);
      expect(inv.approvalStatus).toBe("PENDING");

      // Verify approval request was recorded
      const approvalReq = await prisma.approvalRequest.findFirst({
        where: { documentId: inv.id },
      });
      expect(approvalReq).toBeDefined();
      expect(approvalReq!.status).toBe(ApprovalStatus.PENDING);
      expect(approvalReq!.requestedById).toBe(salesmanId);
      expect(approvalReq!.reason).toContain("exceeds staff max invoice limit");

      // Owner approves the request
      const approveRes = await app.inject({
        method: "POST",
        url: `/api/v1/approvals/${approvalReq!.id}/approve`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          comments: "Approved bulk order for special customer.",
        },
      });

      expect(approveRes.statusCode).toBe(200);
      const updatedInv = await prisma.salesInvoice.findUnique({
        where: { id: inv.id },
      });
      expect(updatedInv!.approvalStatus).toBe(ApprovalStatus.APPROVED);
    });

    it("should trigger PENDING approval status when Salesman exceeds max discount limit (15% > 10%)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices",
        headers: {
          authorization: `Bearer ${salesmanToken}`,
        },
        payload: {
          partyId: customerPartyId,
          invoiceDate: new Date().toISOString().split("T")[0],
          paymentMode: "CASH",
          items: [
            {
              itemId: testItemId,
              quantity: 2,
              unitPrice: 1000,
              taxRate: 18,
              discountPercent: 15, // 15% > 10%
            },
          ],
        },
      });

      if (res.statusCode !== 201) console.log("INVOICE ERROR:", res.statusCode, res.body);
      expect(res.statusCode).toBe(201);
      const inv = JSON.parse(res.body);
      expect(inv.approvalStatus).toBe("PENDING");

      const approvalReq = await prisma.approvalRequest.findFirst({
        where: { documentId: inv.id },
      });
      expect(approvalReq!.reason).toContain("exceeds staff maximum allowed discount limit");
    });
  });

  // =========================================================================
  // 5. DATA SCOPE ISOLATION (OWN_RECORDS vs ALL_ORGANIZATION)
  // =========================================================================
  describe("Data Scope Isolation", () => {
    it("should restrict Salesman with OWN_RECORDS to only see invoices they created", async () => {
      // 1. Owner creates an invoice
      const ownerInv = await app.inject({
        method: "POST",
        url: "/api/v1/invoices",
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          partyId: customerPartyId,
          invoiceDate: new Date().toISOString().split("T")[0],
          paymentMode: "CASH",
          items: [
            {
              itemId: testItemId,
              quantity: 1,
              unitPrice: 1000,
              taxRate: 18,
            },
          ],
        },
      });
      expect(ownerInv.statusCode).toBe(201);

      // 2. Salesman lists invoices
      const salesmanListRes = await app.inject({
        method: "GET",
        url: "/api/v1/invoices",
        headers: {
          authorization: `Bearer ${salesmanToken}`,
        },
      });

      expect(salesmanListRes.statusCode).toBe(200);
      const salesmanList = JSON.parse(salesmanListRes.body);
      
      // All returned invoices must have createdById = salesmanId
      for (const inv of salesmanList.items || salesmanList.data || []) {
        expect(inv.createdById).toBe(salesmanId);
      }
    });
  });

  // =========================================================================
  // 6. CUSTOM ROLES & GRANULAR PERMISSION OVERRIDES
  // =========================================================================
  describe("Custom Roles & Granular Permission Overrides", () => {
    let customRoleId: string;

    it("should allow Owner to create a Custom Role with customized permission matrix", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/roles",
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          name: "Warehouse Billing Clerk",
          description: "Can bill and adjust stock, but cannot view profit or reports",
          permissions: [
            { module: "dashboard", action: "view", allowed: true },
            { module: "invoices", action: "view", allowed: true },
            { module: "invoices", action: "create", allowed: true },
            { module: "items", action: "view", allowed: true },
            { module: "items", action: "adjust_stock", allowed: true },
            { module: "reports", action: "view", allowed: false },
          ],
        },
      });

      if (res.statusCode !== 201) console.log("INVOICE ERROR:", res.statusCode, res.body);
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      customRoleId = body.id;
      expect(body.name).toBe("Warehouse Billing Clerk");
    });

    it("should allow Owner to duplicate a custom role", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/roles/${customRoleId}/duplicate`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          name: "Senior Warehouse Billing Clerk",
        },
      });

      if (res.statusCode !== 201) console.log("INVOICE ERROR:", res.statusCode, res.body);
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.name).toBe("Senior Warehouse Billing Clerk");
    });

    it("should allow Owner to grant individual permission override to Salesman", async () => {
      // Grant reports view to Salesman as an override
      const overrideRes = await app.inject({
        method: "PUT",
        url: `/api/v1/users/${salesmanId}/permissions`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          overrides: [
            { module: "reports", action: "view", allowed: true },
          ],
        },
      });

      expect(overrideRes.statusCode).toBe(200);

      // Get effective permissions
      const permsRes = await app.inject({
        method: "GET",
        url: `/api/v1/users/${salesmanId}/permissions`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(permsRes.statusCode).toBe(200);
      const permsBody = JSON.parse(permsRes.body);
      expect(permsBody.effective.reports.view).toBe(true);
    });
  });
});
