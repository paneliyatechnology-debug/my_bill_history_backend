import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NestFastifyApplication, FastifyAdapter } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("Staff Salary Payment & Accounting Integration Test Suite", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  let tenantTokenA: string;
  let tenantTokenB: string;
  let companyIdA: string;
  let orgIdA: string;
  let companyIdB: string;

  let cashAccountIdA: string;
  let bankAccountIdA: string;
  let salaryExpenseAccountIdA: string;

  let cashAccountIdB: string;

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
    const phoneA = `9825${Math.floor(100000 + Math.random() * 900000)}`;
    const regResA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Salary Test Admin A",
        phone: phoneA,
        email: `salary_admin_a_${Date.now()}@test.local`,
        password: "PasswordBilling123#",
        organizationName: "Salary Test Org A",
        tradeName: "Salary Enterprises A",
        stateCode: "24",
      },
    });
    expect(regResA.statusCode).toBe(201);
    const authA = JSON.parse(regResA.body);
    tenantTokenA = authA.accessToken;
    companyIdA = authA.defaultContext.companyId;
    orgIdA = authA.defaultContext.organizationId;

    // Seed COA for Tenant A
    await app.inject({
      method: "POST",
      url: "/api/v1/ledger-groups/seed",
      headers: { authorization: `Bearer ${tenantTokenA}` },
    });

    // 2. Setup Tenant B (for cross-tenant security tests)
    const phoneB = `9825${Math.floor(100000 + Math.random() * 900000)}`;
    const regResB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Salary Test Admin B",
        phone: phoneB,
        email: `salary_admin_b_${Date.now()}@test.local`,
        password: "PasswordBilling123#",
        organizationName: "Salary Test Org B",
        tradeName: "Salary Enterprises B",
        stateCode: "24",
      },
    });
    expect(regResB.statusCode).toBe(201);
    const authB = JSON.parse(regResB.body);
    tenantTokenB = authB.accessToken;
    companyIdB = authB.defaultContext.companyId;

    // Seed COA for Tenant B
    await app.inject({
      method: "POST",
      url: "/api/v1/ledger-groups/seed",
      headers: { authorization: `Bearer ${tenantTokenB}` },
    });

    // 3. Resolve Tenant A accounts
    const ledgersResA = await app.inject({
      method: "GET",
      url: "/api/v1/accounting/ledgers",
      headers: { authorization: `Bearer ${tenantTokenA}` },
    });
    expect(ledgersResA.statusCode).toBe(200);
    const ledgersA = JSON.parse(ledgersResA.body);
    const listA = Array.isArray(ledgersA) ? ledgersA : ledgersA.data || [];

    const cashA = listA.find((l: any) => l.isCashLedger || l.name.toLowerCase().includes("cash"));
    expect(cashA).toBeDefined();
    cashAccountIdA = cashA.id;

    const salaryA = listA.find((l: any) => l.name.toLowerCase().includes("salary") || l.code === "5220");
    expect(salaryA).toBeDefined();
    salaryExpenseAccountIdA = salaryA.id;

    // Create a Bank Account for Tenant A
    const bankGroupsRes = await app.inject({
      method: "GET",
      url: "/api/v1/accounting/groups",
      headers: { authorization: `Bearer ${tenantTokenA}` },
    });
    const groupsA = JSON.parse(bankGroupsRes.body);
    const gListA = Array.isArray(groupsA) ? groupsA : groupsA.data || [];
    const bankGroupA = gListA.find((g: any) => g.name.toLowerCase().includes("bank")) || gListA[0];

    const createBankRes = await app.inject({
      method: "POST",
      url: "/api/v1/accounting/ledgers",
      headers: { authorization: `Bearer ${tenantTokenA}` },
      payload: {
        name: "HDFC Current Bank Account",
        code: "HDFC-9901",
        groupId: bankGroupA.id,
        isBankLedger: true,
        openingBalance: 100000,
        openingType: "DR",
        isActive: true,
      },
    });
    expect(createBankRes.statusCode).toBe(201);
    const bankData = JSON.parse(createBankRes.body);
    bankAccountIdA = bankData.id;

    // 4. Resolve Tenant B cash account
    const ledgersResB = await app.inject({
      method: "GET",
      url: "/api/v1/accounting/ledgers",
      headers: { authorization: `Bearer ${tenantTokenB}` },
    });
    const ledgersB = JSON.parse(ledgersResB.body);
    const listB = Array.isArray(ledgersB) ? ledgersB : ledgersB.data || [];
    const cashB = listB.find((l: any) => l.isCashLedger || l.name.toLowerCase().includes("cash"));
    cashAccountIdB = cashB.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // --------------------------------------------------------------------------
  // 1. CASH SALARY PAYMENT & CASH BALANCE DEDUCTION
  // --------------------------------------------------------------------------
  it("1. Cash salary payment decreases the correct cash balance and increases salary expense", async () => {
    // Check initial balances
    const cashBeforeRes = await app.inject({
      method: "GET",
      url: `/api/v1/accounting/ledgers/${cashAccountIdA}`,
      headers: { authorization: `Bearer ${tenantTokenA}` },
    });
    const cashBefore = Number(JSON.parse(cashBeforeRes.body).currentBalance || 0);

    const expenseBeforeRes = await app.inject({
      method: "GET",
      url: `/api/v1/accounting/ledgers/${salaryExpenseAccountIdA}`,
      headers: { authorization: `Bearer ${tenantTokenA}` },
    });
    const expenseBefore = Number(JSON.parse(expenseBeforeRes.body).currentBalance || 0);

    const salaryAmount = 20000;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/vouchers/staff-payment",
      headers: { authorization: `Bearer ${tenantTokenA}` },
      payload: {
        staffId: "staff_101",
        staffName: "Rajesh Kumar",
        paymentType: "SALARY",
        amount: salaryAmount,
        paymentMode: "CASH",
        paidFromAccountId: cashAccountIdA,
        note: "October salary payout",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.staffId).toBe("staff_101");
    expect(Number(body.amount)).toBe(salaryAmount);
    expect(body.paymentType).toBe("SALARY");
    expect(body.voucherId).toBeDefined();
    expect(body.voucher.voucherNumber).toMatch(/^PAY-\d{4}-\d{4}$/);

    // Verify Cash Balance DECREASED by ₹20,000
    const cashAfterRes = await app.inject({
      method: "GET",
      url: `/api/v1/accounting/ledgers/${cashAccountIdA}`,
      headers: { authorization: `Bearer ${tenantTokenA}` },
    });
    const cashAfter = Number(JSON.parse(cashAfterRes.body).currentBalance || 0);
    expect(cashAfter).toBe(cashBefore - salaryAmount);

    // Verify Salary Expense Balance INCREASED by ₹20,000
    const expenseAfterRes = await app.inject({
      method: "GET",
      url: `/api/v1/accounting/ledgers/${salaryExpenseAccountIdA}`,
      headers: { authorization: `Bearer ${tenantTokenA}` },
    });
    const expenseAfter = Number(JSON.parse(expenseAfterRes.body).currentBalance || 0);
    expect(expenseAfter).toBe(expenseBefore + salaryAmount);
  });

  // --------------------------------------------------------------------------
  // 2. BANK SALARY PAYMENT & SELECTED BANK BALANCE DEDUCTION
  // --------------------------------------------------------------------------
  it("2. Bank salary payment decreases the selected bank balance", async () => {
    const bankBeforeRes = await app.inject({
      method: "GET",
      url: `/api/v1/accounting/ledgers/${bankAccountIdA}`,
      headers: { authorization: `Bearer ${tenantTokenA}` },
    });
    const bankBefore = Number(JSON.parse(bankBeforeRes.body).currentBalance || 0);

    const salaryAmount = 35000;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/vouchers/staff-payment",
      headers: { authorization: `Bearer ${tenantTokenA}` },
      payload: {
        staffId: "staff_102",
        staffName: "Priya Sharma",
        paymentType: "SALARY",
        amount: salaryAmount,
        paymentMode: "BANK_TRANSFER",
        paidFromAccountId: bankAccountIdA,
        note: "NEFT Salary transfer",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.voucherId).toBeDefined();

    // Verify Bank Balance decreased by ₹35,000
    const bankAfterRes = await app.inject({
      method: "GET",
      url: `/api/v1/accounting/ledgers/${bankAccountIdA}`,
      headers: { authorization: `Bearer ${tenantTokenA}` },
    });
    const bankAfter = Number(JSON.parse(bankAfterRes.body).currentBalance || 0);
    expect(bankAfter).toBe(bankBefore - salaryAmount);
  });

  // --------------------------------------------------------------------------
  // 3. STRICT DOUBLE-ENTRY BALANCING (DEBIT == CREDIT)
  // --------------------------------------------------------------------------
  it("3. Salary expense and payment-account entries balance correctly (Total Debits == Total Credits)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/vouchers/staff-payment",
      headers: { authorization: `Bearer ${tenantTokenA}` },
      payload: {
        staffId: "staff_103",
        staffName: "Amit Patel",
        paymentType: "SALARY",
        amount: 15000,
        paymentMode: "CASH",
        paidFromAccountId: cashAccountIdA,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    // Fetch the created voucher details
    const voucherRes = await app.inject({
      method: "GET",
      url: `/api/v1/vouchers/${body.voucherId}`,
      headers: { authorization: `Bearer ${tenantTokenA}` },
    });
    expect(voucherRes.statusCode).toBe(200);
    const voucher = JSON.parse(voucherRes.body);

    expect(voucher.journalEntries.length).toBe(2);
    const totalDebit = voucher.journalEntries.reduce((sum: number, l: any) => sum + Number(l.debitAmount), 0);
    const totalCredit = voucher.journalEntries.reduce((sum: number, l: any) => sum + Number(l.creditAmount), 0);

    expect(totalDebit).toBe(15000);
    expect(totalCredit).toBe(15000);
    expect(totalDebit).toBe(totalCredit);
  });

  // --------------------------------------------------------------------------
  // 4. STAFF ADVANCE PAYMENT TO ASSET ACCOUNT
  // --------------------------------------------------------------------------
  it("4. Staff advance posts to the correct Staff Advances asset account (not expense)", async () => {
    const advanceAmount = 8000;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/vouchers/staff-payment",
      headers: { authorization: `Bearer ${tenantTokenA}` },
      payload: {
        staffId: "staff_104",
        staffName: "Karan Dave",
        paymentType: "ADVANCE",
        amount: advanceAmount,
        paymentMode: "CASH",
        paidFromAccountId: cashAccountIdA,
        note: "Diwali festival advance",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.debitAccount.name).toMatch(/Staff Advance/i);

    // Verify debit account is an ASSET
    const advanceAccRes = await app.inject({
      method: "GET",
      url: `/api/v1/accounting/ledgers/${body.debitAccount.id}`,
      headers: { authorization: `Bearer ${tenantTokenA}` },
    });
    const advanceAcc = JSON.parse(advanceAccRes.body);
    expect(advanceAcc.group.nature).toBe("ASSET");
    expect(Number(advanceAcc.currentBalance)).toBeGreaterThanOrEqual(advanceAmount);
  });

  // --------------------------------------------------------------------------
  // 5. BONUS PAYMENT
  // --------------------------------------------------------------------------
  it("5. Bonus payment posts correctly as employee expense", async () => {
    const bonusAmount = 5000;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/vouchers/staff-payment",
      headers: { authorization: `Bearer ${tenantTokenA}` },
      payload: {
        staffId: "staff_105",
        staffName: "Neha Vyas",
        paymentType: "BONUS",
        amount: bonusAmount,
        paymentMode: "UPI",
        paidFromAccountId: bankAccountIdA,
        note: "Performance Diwali Bonus",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.voucherId).toBeDefined();
    expect(body.voucher.voucherType).toBe("PAYMENT");
  });

  // --------------------------------------------------------------------------
  // 6. DEDUCTION DOES NOT TOUCH CASH/BANK
  // --------------------------------------------------------------------------
  it("6. Deduction follows existing payroll rules and does NOT deduct cash/bank balance", async () => {
    const cashBeforeRes = await app.inject({
      method: "GET",
      url: `/api/v1/accounting/ledgers/${cashAccountIdA}`,
      headers: { authorization: `Bearer ${tenantTokenA}` },
    });
    const cashBefore = Number(JSON.parse(cashBeforeRes.body).currentBalance || 0);

    const deductionAmount = 2500;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/vouchers/staff-payment",
      headers: { authorization: `Bearer ${tenantTokenA}` },
      payload: {
        staffId: "staff_106",
        staffName: "Sanjay Joshi",
        paymentType: "DEDUCTION",
        amount: deductionAmount,
        paymentMode: "CASH",
        note: "Loan recovery deduction from salary payable",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.paymentType).toBe("DEDUCTION");
    expect(body.voucherId).toBeNull(); // No voucher created for internal offset

    // Cash balance must remain STRICTLY UNCHANGED
    const cashAfterRes = await app.inject({
      method: "GET",
      url: `/api/v1/accounting/ledgers/${cashAccountIdA}`,
      headers: { authorization: `Bearer ${tenantTokenA}` },
    });
    const cashAfter = Number(JSON.parse(cashAfterRes.body).currentBalance || 0);
    expect(cashAfter).toBe(cashBefore);
  });

  // --------------------------------------------------------------------------
  // 7. INVALID AMOUNTS ARE REJECTED
  // --------------------------------------------------------------------------
  it("7. Invalid amounts (zero or negative) are rejected with 400 Bad Request", async () => {
    const resZero = await app.inject({
      method: "POST",
      url: "/api/v1/vouchers/staff-payment",
      headers: { authorization: `Bearer ${tenantTokenA}` },
      payload: {
        staffId: "staff_107",
        staffName: "Test Staff",
        paymentType: "SALARY",
        amount: 0,
        paymentMode: "CASH",
      },
    });
    expect(resZero.statusCode).toBe(400);

    const resNegative = await app.inject({
      method: "POST",
      url: "/api/v1/vouchers/staff-payment",
      headers: { authorization: `Bearer ${tenantTokenA}` },
      payload: {
        staffId: "staff_107",
        staffName: "Test Staff",
        paymentType: "SALARY",
        amount: -500,
        paymentMode: "CASH",
      },
    });
    expect(resNegative.statusCode).toBe(400);
  });

  // --------------------------------------------------------------------------
  // 8. MISSING OR INVALID PAYMENT ACCOUNTS ARE REJECTED
  // --------------------------------------------------------------------------
  it("8. Non-existent payment account is rejected with 404/400", async () => {
    const fakeAccountId = "00000000-0000-0000-0000-000000000000";
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/vouchers/staff-payment",
      headers: { authorization: `Bearer ${tenantTokenA}` },
      payload: {
        staffId: "staff_108",
        staffName: "Test Staff",
        paymentType: "SALARY",
        amount: 1000,
        paymentMode: "CASH",
        paidFromAccountId: fakeAccountId,
      },
    });
    expect(res.statusCode).toBe(404);
  });

  // --------------------------------------------------------------------------
  // 9. ATOMIC TRANSACTION INTEGRITY (ROLLBACK ON FAILURE)
  // --------------------------------------------------------------------------
  it("9. Failed accounting posting rolls back the staff payment transaction", async () => {
    const paymentsCountBefore = await prisma.staffPayment.count({
      where: { companyId: companyIdA },
    });

    // Provide invalid future date outside financial year to trigger domain rollback
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/vouchers/staff-payment",
      headers: { authorization: `Bearer ${tenantTokenA}` },
      payload: {
        staffId: "staff_rollback_test",
        staffName: "Rollback Test",
        paymentType: "SALARY",
        amount: 10000,
        paymentMode: "CASH",
        paymentDate: "2099-12-31", // Far in future outside FY
      },
    });
    expect(res.statusCode).toBe(400);

    // Verify staff_payments record was NOT created
    const paymentsCountAfter = await prisma.staffPayment.count({
      where: { companyId: companyIdA },
    });
    expect(paymentsCountAfter).toBe(paymentsCountBefore);
  });

  // --------------------------------------------------------------------------
  // 10. IDEMPOTENCY / PREVENT DUPLICATE PAYMENTS
  // --------------------------------------------------------------------------
  it("10. Duplicate request with idempotency key does not create duplicate payment or voucher", async () => {
    const idempotencyKey = `idemp_staff_${Date.now()}`;

    const res1 = await app.inject({
      method: "POST",
      url: "/api/v1/vouchers/staff-payment",
      headers: {
        authorization: `Bearer ${tenantTokenA}`,
        "idempotency-key": idempotencyKey,
      },
      payload: {
        staffId: "staff_110",
        staffName: "Idempotent Staff",
        paymentType: "SALARY",
        amount: 12000,
        paymentMode: "CASH",
        idempotencyKey,
      },
    });
    expect(res1.statusCode).toBe(201);
    const body1 = JSON.parse(res1.body);

    // Resubmit exact same request
    const res2 = await app.inject({
      method: "POST",
      url: "/api/v1/vouchers/staff-payment",
      headers: {
        authorization: `Bearer ${tenantTokenA}`,
        "idempotency-key": idempotencyKey,
      },
      payload: {
        staffId: "staff_110",
        staffName: "Idempotent Staff",
        paymentType: "SALARY",
        amount: 12000,
        paymentMode: "CASH",
        idempotencyKey,
      },
    });
    expect(res2.statusCode).toBe(201);
    const body2 = JSON.parse(res2.body);

    // Both requests must return the SAME payment ID and voucher ID
    expect(body2.id).toBe(body1.id);
    expect(body2.voucherId).toBe(body1.voucherId);
  });

  // --------------------------------------------------------------------------
  // 11. CROSS-COMPANY ISOLATION / RLS ENFORCEMENT
  // --------------------------------------------------------------------------
  it("11. Tenant A cannot use Tenant B's cash/bank account (cross-company manipulation rejected)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/vouchers/staff-payment",
      headers: { authorization: `Bearer ${tenantTokenA}` },
      payload: {
        staffId: "staff_attacker",
        staffName: "Attacker Staff",
        paymentType: "SALARY",
        amount: 1000,
        paymentMode: "CASH",
        paidFromAccountId: cashAccountIdB, // Tenant B's cash account!
      },
    });

    expect(res.statusCode).toBe(404); // Account not found in Tenant A's tenant context
  });

  // --------------------------------------------------------------------------
  // 12. CANCELLATION / REVERSAL RESTORES BALANCES
  // --------------------------------------------------------------------------
  it("12. Cancellation/reversal of staff payment restores Cash/Bank balance and creates reversal voucher", async () => {
    // 1. Post payment
    const postRes = await app.inject({
      method: "POST",
      url: "/api/v1/vouchers/staff-payment",
      headers: { authorization: `Bearer ${tenantTokenA}` },
      payload: {
        staffId: "staff_to_cancel",
        staffName: "Cancel Candidate",
        paymentType: "SALARY",
        amount: 18000,
        paymentMode: "CASH",
        paidFromAccountId: cashAccountIdA,
      },
    });
    expect(postRes.statusCode).toBe(201);
    const posted = JSON.parse(postRes.body);

    const cashAfterPayment = Number(posted.paidFromAccount.currentBalance);

    // 2. Cancel payment
    const cancelRes = await app.inject({
      method: "POST",
      url: `/api/v1/vouchers/staff-payment/${posted.id}/cancel`,
      headers: { authorization: `Bearer ${tenantTokenA}` },
      payload: { reason: "Incorrect staff member selected" },
    });
    expect(cancelRes.statusCode).toBe(201);
    const cancelBody = JSON.parse(cancelRes.body);
    expect(cancelBody.isCancelled).toBe(true);
    expect(cancelBody.reversalVoucher).toBeDefined();

    // 3. Verify Cash Balance is restored (+18,000)
    const cashRestoredRes = await app.inject({
      method: "GET",
      url: `/api/v1/accounting/ledgers/${cashAccountIdA}`,
      headers: { authorization: `Bearer ${tenantTokenA}` },
    });
    const cashRestored = Number(JSON.parse(cashRestoredRes.body).currentBalance || 0);
    expect(cashRestored).toBe(cashAfterPayment + 18000);

    // 4. Double cancellation must be rejected
    const doubleCancelRes = await app.inject({
      method: "POST",
      url: `/api/v1/vouchers/staff-payment/${posted.id}/cancel`,
      headers: { authorization: `Bearer ${tenantTokenA}` },
      payload: { reason: "Cancelling again" },
    });
    expect(doubleCancelRes.statusCode).toBe(400);
  });

  // --------------------------------------------------------------------------
  // 13. LIST STAFF PAYMENTS ENDPOINT
  // --------------------------------------------------------------------------
  it("13. List staff payments returns recorded payments with voucher details", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/vouchers/staff-payments?staffId=staff_101",
      headers: { authorization: `Bearer ${tenantTokenA}` },
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.body);
    expect(Array.isArray(listBody.data)).toBe(true);
    expect(listBody.data.length).toBeGreaterThanOrEqual(1);
    expect(listBody.data[0].staffId).toBe("staff_101");
  });

  // --------------------------------------------------------------------------
  // 14. CASHBOOK & BANKBOOK / GENERAL LEDGER INCLUSION
  // --------------------------------------------------------------------------
  it("14. Cashbook / General Ledger statement reflects the staff salary payment voucher", async () => {
    const glRes = await app.inject({
      method: "GET",
      url: `/api/v1/reports/general-ledger?accountId=${cashAccountIdA}`,
      headers: { authorization: `Bearer ${tenantTokenA}` },
    });
    expect(glRes.statusCode).toBe(200);
    const gl = JSON.parse(glRes.body);
    expect(gl.account.id).toBe(cashAccountIdA);
    const ledgerEntries = gl.entries || gl.lines || [];
    expect(Array.isArray(ledgerEntries)).toBe(true);

    const hasStaffSalaryVoucher = ledgerEntries.some(
      (line: any) =>
        line.voucherType === "PAYMENT" &&
        (Number(line.creditAmount || line.credit) > 0 || Number(line.debitAmount || line.debit) > 0),
    );
    expect(hasStaffSalaryVoucher).toBe(true);
  });
});
