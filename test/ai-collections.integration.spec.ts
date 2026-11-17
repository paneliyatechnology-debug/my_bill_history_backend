import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { AiCollectionsService } from "../src/ai-collections/ai-collections.service";
import { AiVoiceEngineService } from "../src/ai-collections/ai-voice/ai-voice-engine.service";
import { CredentialCryptoService } from "../src/ai-collections/security/credential-crypto.service";
import { CollectionReconciliationService } from "../src/ai-collections/reconciliation/collection-reconciliation.service";
import { AiCollectionSchedulerService } from "../src/ai-collections/scheduler/ai-collection-scheduler.service";
import { TenantContext } from "@billing/shared-types";

describe("AI Collections & Automated Voice Calling Integration Test Suite", () => {
  let prisma: DatabaseService;
  let service: AiCollectionsService;
  let crypto: CredentialCryptoService;
  let aiVoiceEngine: AiVoiceEngineService;
  let reconciliation: CollectionReconciliationService;
  let scheduler: AiCollectionSchedulerService;

  // Real company in the database: JK
  const companyId = "92967a06-d488-4794-bae1-e6188e8fb47d";
  const organizationId = "3127cc52-2797-4dc2-a9d3-55ba236c8d55";
  const branchId = "96ceb02c-5439-4144-b323-e0d7748c3db0";
  const userId = "ec46866d-7d8e-4119-bba5-0044d0fce8de";

  const tenantA: TenantContext = {
    userId,
    organizationId,
    companyId,
    branchId,
  };

  const tenantB: TenantContext = {
    userId: "00000000-0000-0000-0000-000000000099",
    organizationId: "2348e012-0a53-47fa-9814-7c39ae6cd2c2",
    companyId: "d8aec598-010b-4678-a35b-bb65bd49c43c",
    branchId: "00000000-0000-0000-0000-000000000096",
  };

  let testPartyId: string;
  let testInvoiceId: string;
  let testCallId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = moduleRef.get(DatabaseService);
    service = moduleRef.get(AiCollectionsService);
    crypto = moduleRef.get(CredentialCryptoService);
    aiVoiceEngine = moduleRef.get(AiVoiceEngineService);
    reconciliation = moduleRef.get(CollectionReconciliationService);
    scheduler = moduleRef.get(AiCollectionSchedulerService);

    // Clean up test collections data for company
    await prisma.aiCollectionQueue.deleteMany({ where: { companyId } });
    await prisma.aiCollectionCall.deleteMany({ where: { companyId } });
    await prisma.aiCollectionCommitment.deleteMany({ where: { companyId } });
    await prisma.aiCollectionFollowUp.deleteMany({ where: { companyId } });
    await prisma.aiCollectionStaffTask.deleteMany({ where: { companyId } });

    // Ensure a test party exists
    let party = await prisma.party.findFirst({
      where: { companyId, type: "CUSTOMER" },
    });
    if (!party) {
      party = await prisma.party.create({
        data: {
          organizationId,
          companyId,
          name: "Sharma Traders Test",
          nameGujarati: "શર્મા ટ્રેડર્સ",
          phone: "9898990001",
          stateCode: "24",
          billingAddress: { city: "Surat", state: "Gujarat" },
          type: "CUSTOMER",
        },
      });
    }
    testPartyId = party.id;

    // Reset customer calling preference
    await prisma.customerCallingPreference.upsert({
      where: { partyId: testPartyId },
      create: {
        organizationId,
        companyId,
        partyId: testPartyId,
        isOptedOut: false,
        preferredLanguage: "gujarati",
      },
      update: {
        isOptedOut: false,
        preferredLanguage: "gujarati",
      },
    });

    // Ensure a test unpaid sales invoice exists for testParty
    let invoice = await prisma.salesInvoice.findFirst({
      where: { companyId, partyId: testPartyId, balanceAmount: { gt: 0 } },
    });
    if (!invoice) {
      const fy = await prisma.financialYear.findFirst({ where: { companyId } });
      invoice = await prisma.salesInvoice.create({
        data: {
          organizationId,
          companyId,
          branchId,
          financialYearId: fy!.id,
          partyId: testPartyId,
          invoiceNumber: `TEST-INV-${Date.now()}`,
          invoiceDate: new Date(),
          dueDate: new Date(Date.now() + 86400000 * 3),
          placeOfSupply: "24",
          billingAddress: { city: "Surat" },
          subTotal: 25000,
          taxableAmount: 25000,
          grandTotal: 25000,
          paidAmount: 0,
          balanceAmount: 25000,
          status: "ISSUED",
        },
      });
    }
    testInvoiceId = invoice.id;
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.aiCollectionQueue.deleteMany({ where: { companyId } });
    await prisma.aiCollectionCall.deleteMany({ where: { companyId } });
    await prisma.aiCollectionCommitment.deleteMany({ where: { companyId } });
    await prisma.aiCollectionFollowUp.deleteMany({ where: { companyId } });
    await prisma.aiCollectionStaffTask.deleteMany({ where: { companyId } });
  });

  // ==========================================================================
  // 1. Security & Credential Protection
  // ==========================================================================
  describe("1. Security & Credential Protection", () => {
    it("should securely encrypt and decrypt provider credentials using AES-256-GCM", () => {
      const secret = "live_sk_test_api_secret_key_123456789";
      const encrypted = crypto.encrypt(secret);

      expect(encrypted).not.toBeNull();
      expect(encrypted).not.toBe(secret);
      expect(encrypted?.split(":").length).toBe(3); // iv:tag:ciphertext

      const decrypted = crypto.decrypt(encrypted);
      expect(decrypted).toBe(secret);
    });

    it("should mask secrets properly for safe frontend display", () => {
      const secret = "TEST_SECRET_KEY_1234567890cdef";
      const masked = crypto.maskSecret(secret);
      expect(masked).toBe("TE••••••••cdef");
      expect(masked).not.toContain("1234567890");
    });

    it("should safely update settings and ignore virtual or read-only properties from frontend", async () => {
      const res = await service.updateSettings(tenantA, {
        assistantName: "Maya Production",
        voiceProvider: "simulator",
        providerAccountSid: "MOCK_ACCOUNT_SID_FOR_TEST",
        providerVirtualNumber: "+917900000000",
        // Extra/virtual properties from frontend:
        hasConfiguredApiKey: true,
        hasConfiguredApiSecret: false,
        id: "dummy-id",
        organizationId: "dummy-org",
        companyId: "dummy-comp",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any);

      expect(res.success).toBe(true);
      expect(res.settings.assistantName).toBe("Maya Production");
      expect(res.settings.hasConfiguredApiKey).toBeDefined();
    });

    it("should enforce tenant-level isolation for settings and calls", async () => {
      // Configure settings for Tenant A
      await service.updateSettings(tenantA, {
        assistantName: "Maya Tenant A",
        defaultLanguage: "gujarati",
      });

      const settingsA = await service.getSettings(tenantA);
      expect(settingsA.assistantName).toBe("Maya Tenant A");

      // Tenant B queries settings: should not see Tenant A's settings
      const settingsB = await service.getSettings(tenantB);
      expect(settingsB.companyId).toBe(tenantB.companyId);
      expect(settingsB.companyId).not.toBe(settingsA.companyId);
    });

    it("should verify webhook signature tokens securely", () => {
      const secret = "my_webhook_secret_token_abc123";
      expect(crypto.verifyWebhookToken("my_webhook_secret_token_abc123", secret)).toBe(true);
      expect(crypto.verifyWebhookToken("invalid_attacker_token", secret)).toBe(false);
    });
  });

  // ==========================================================================
  // 2. AI Voice Conversation Scenarios
  // ==========================================================================
  describe("2. AI Voice Conversation Scenarios (Gujarati, Hindi, English)", () => {
    const dummyCtx = {
      callId: "call_test_01",
      tenantId: organizationId,
      companyId: companyId,
      businessName: "JK Enterprises",
      customerName: "Sharma Traders",
      customerPhone: "9898990001",
      preferredLanguage: "gujarati",
      invoices: [
        {
          id: "inv_01",
          invoiceNumber: "INV/26-27/0012",
          invoiceDate: "2026-11-10",
          dueDate: "2026-11-15",
          grandTotal: 25000,
          paidAmount: 0,
          balanceAmount: 25000,
        },
      ],
      totalOutstanding: 25000,
      verifiedPaymentDetails: {
        bankName: "HDFC Bank",
        bankAccountNumber: "50200012345678",
        bankIfsc: "HDFC0000123",
        upiId: "jkenterprises@hdfcbank",
      },
      history: [],
      turnIndex: 1,
    };

    it("Scenario A: Customer Promises Payment (extracts date & structured outcome)", async () => {
      const res = await aiVoiceEngine.processCustomerSpeech("હું શુક્રવારે payment કરી દઈશ", dummyCtx);

      expect(res.intent).toBe("PROMISE_TO_PAY");
      expect(res.promised_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(res.spokenReply.length).toBeGreaterThan(5);
    });

    it("Scenario B: Customer Already Paid (flags unverified payment and requests reference)", async () => {
      const res = await aiVoiceEngine.processCustomerSpeech("Payment થઈ ગયું છે, કાલ આપી દીધા હતા", dummyCtx);

      expect(["ALREADY_PAID", "PAYMENT_REPORTED_UNVERIFIED"]).toContain(res.intent);
      expect(res.spokenReply.length).toBeGreaterThan(5);
    });

    it("Scenario C: Customer Requests More Time (handles delay gracefully)", async () => {
      const res = await aiVoiceEngine.processCustomerSpeech("હાલ પૈસા નથી, થોડા દિવસ પછી કરીશ", dummyCtx);

      expect(["REQUEST_MORE_TIME", "PROMISE_TO_PAY"]).toContain(res.intent);
      expect(res.spokenReply.length).toBeGreaterThan(5);
    });

    it("Scenario D: Customer Requests Bank Details (shares verified details)", async () => {
      const res = await aiVoiceEngine.processCustomerSpeech("તમારા bank details મોકલો", dummyCtx);

      expect(res.intent).toBe("REQUEST_BANK_DETAILS");
      expect(res.spokenReply).toContain("50200012345678");
    });

    it("Scenario E: Customer Requests UPI Payment (shares verified UPI ID)", async () => {
      const res = await aiVoiceEngine.processCustomerSpeech("UPI થી payment કરવું છે, GPay નંબર આપો", dummyCtx);

      expect(res.intent).toBe("REQUEST_UPI");
      expect(res.spokenReply).toContain("jkenterprises@hdfcbank");
    });

    it("Scenario F: Customer Disputes the Invoice (creates staff task without arguing)", async () => {
      const res = await aiVoiceEngine.processCustomerSpeech("આ invoice ખોટું છે, મેં માલ લીધો જ નથી", dummyCtx);

      expect(res.intent).toBe("DISPUTED");
      expect(res.needs_human_followup).toBe(true);
      expect(res.next_action).toBe("CREATE_STAFF_TASK");
    });

    it("Scenario G: Customer Requests Human Assistance (stops AI conversation, requests staff)", async () => {
      const res = await aiVoiceEngine.processCustomerSpeech("કોઈ માણસ સાથે વાત કરાવો", dummyCtx);

      expect(res.intent).toBe("HUMAN_ASSISTANCE");
      expect(res.needs_human_followup).toBe(true);
      expect(res.is_final_turn).toBe(true);
    });

    it("Scenario I: Customer Demands Opt-Out (stops calling and respects preferences)", async () => {
      const res = await aiVoiceEngine.processCustomerSpeech("હવે પછી ક્યારેય ફોન ના કરતા, stop calling", dummyCtx);

      expect(res.intent).toBe("OPT_OUT");
      expect(res.next_action).toBe("OPT_OUT_CUSTOMER");
      expect(res.is_final_turn).toBe(true);
    });
  });

  // ==========================================================================
  // 3. Scheduling, Queueing & Background Scheduler
  // ==========================================================================
  describe("3. Scheduling & Background Scheduler", () => {
    it("should fetch eligible pending customers with outstanding dues", async () => {
      const result = await service.getPendingDues(tenantA, {});

      expect(result.data.length).toBeGreaterThan(0);
      const testCustomer = result.data.find((c) => c.partyId === testPartyId);
      expect(testCustomer).toBeDefined();
      expect(testCustomer?.outstandingAmount).toBeGreaterThan(0);
    });

    it("should schedule calls and place them in the durable queue", async () => {
      const res = await service.scheduleCalls(tenantA, {
        partyIds: [testPartyId],
        campaignName: "Test Automation Campaign",
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      });

      expect(res.success).toBe(true);
      expect(res.scheduledCount).toBe(1);

      const queue = await service.getQueue(tenantA);
      expect(queue.length).toBeGreaterThan(0);
      expect(queue.some((q) => q.partyId === testPartyId)).toBe(true);
    });

    it("should prevent duplicate call scheduling for the same customer while in queue", async () => {
      const duplicateRes = await service.scheduleCalls(tenantA, {
        partyIds: [testPartyId],
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      });

      expect(duplicateRes.scheduledCount).toBe(0);
      expect(duplicateRes.skippedCount).toBe(1);
    });

    it("should process the queue and dispatch the call via the configured voice provider", async () => {
      // Set provider to simulator for safe test dispatch
      await service.updateSettings(tenantA, {
        voiceProvider: "simulator",
      });

      // Advance scheduledAt to now so worker claims it
      await prisma.aiCollectionQueue.updateMany({
        where: { partyId: testPartyId, status: "QUEUED" },
        data: { scheduledAt: new Date(Date.now() - 1000) },
      });

      const queueRun = await scheduler.processCollectionQueue(5);
      expect(queueRun.processed).toBeGreaterThan(0);
      expect(queueRun.dispatched).toBeGreaterThan(0);

      // Verify call record created in database
      const call = await prisma.aiCollectionCall.findFirst({
        where: { companyId, partyId: testPartyId },
        orderBy: { createdAt: "desc" },
      });

      expect(call).toBeDefined();
      expect(call?.partyName).toBeDefined();
      expect(call?.provider).toBe("simulator");
      testCallId = call!.id;
    });

    it("should process two-way webhook speech turns and record commitments", async () => {
      const twimlResponse = await service.handleSpeechTurn(
        "simulator",
        {
          speechResult: "હું શુક્રવારે ₹25,000 પેમેન્ટ કરી દઈશ",
          confidence: 0.95,
        },
        testCallId,
      );

      expect(twimlResponse).toBeDefined();

      // Verify conversation turns stored in database
      const turns = await prisma.aiCollectionConversation.findMany({
        where: { callId: testCallId },
        orderBy: { turnIndex: "asc" },
      });

      expect(turns.length).toBeGreaterThanOrEqual(2);
      expect(turns.some((t) => t.role === "user")).toBe(true);
      expect(turns.some((t) => t.role === "assistant")).toBe(true);

      // Verify call outcome and commitment record in database
      const updatedCall = await prisma.aiCollectionCall.findUnique({
        where: { id: testCallId },
      });
      expect(updatedCall?.customerIntent).toBe("PROMISE_TO_PAY");

      const commitment = await prisma.aiCollectionCommitment.findFirst({
        where: { callId: testCallId },
      });
      expect(commitment).toBeDefined();
      expect(commitment?.status).toBe("PENDING");
    });
  });

  // ==========================================================================
  // 4. Payment Reconciliation & Accounting Invariants
  // ==========================================================================
  describe("4. Payment Reconciliation & Accounting Invariants", () => {
    it("INVARIANT: Verbal claim of payment must NEVER mark invoice as paid", async () => {
      // Customer says they already paid in a speech turn
      await service.handleSpeechTurn(
        "simulator",
        { speechResult: "મેં કાલ પેમેન્ટ કરી દીધું છે" },
        testCallId,
      );

      // Verify invoice balance remains unchanged in PostgreSQL
      const invoice = await prisma.salesInvoice.findUnique({
        where: { id: testInvoiceId },
      });

      expect(Number(invoice?.balanceAmount)).toBe(25000);
      expect(invoice?.status).toBe("ISSUED");
    });

    it("should automatically cancel reminders and fulfill commitments when real payment clears", async () => {
      // Simulate real invoice settlement
      await prisma.salesInvoice.update({
        where: { id: testInvoiceId },
        data: {
          paidAmount: 25000,
          balanceAmount: 0,
          status: "PAID",
        },
      });

      // Run collection reconciliation
      const rec = await reconciliation.reconcilePartyCollections(tenantA, testPartyId);

      expect(rec.totalOutstanding).toBe(0);

      // Verify pending commitments marked FULFILLED
      const commitment = await prisma.aiCollectionCommitment.findFirst({
        where: { partyId: testPartyId },
      });
      expect(commitment?.status).toBe("FULFILLED");

      // Verify queue items marked CANCELLED
      const remainingQueue = await prisma.aiCollectionQueue.findMany({
        where: { companyId, partyId: testPartyId, status: "QUEUED" },
      });
      expect(remainingQueue.length).toBe(0);
    });
  });

  // ==========================================================================
  // 5. Customer Calling Preference & Opt-Out Enforcement
  // ==========================================================================
  describe("5. Customer Calling Preference & Opt-Out Enforcement", () => {
    it("should respect customer opt-out and prevent any future calls", async () => {
      await service.updateCustomerPreference(tenantA, testPartyId, {
        isOptedOut: true,
        optOutReason: "Customer requested do not call",
      });

      const pref = await service.getCustomerPreference(tenantA, testPartyId);
      expect(pref.isOptedOut).toBe(true);

      // Try scheduling a call for opted-out customer
      const scheduleRes = await service.scheduleCalls(tenantA, {
        partyIds: [testPartyId],
      });

      expect(scheduleRes.scheduledCount).toBe(0);
      expect(scheduleRes.skippedCount).toBe(1);
    });
  });

  // ==========================================================================
  // 6. Overview & Call Details Drawer
  // ==========================================================================
  describe("6. Overview & Call Details Drawer", () => {
    it("should return comprehensive overview metrics from real database records", async () => {
      const overview = await service.getOverview(tenantA);

      expect(overview.summary).toBeDefined();
      expect(typeof overview.summary.totalOutstanding).toBe("number");
      expect(typeof overview.summary.callsCompleted).toBe("number");
      expect(overview.performance).toBeDefined();
      expect(typeof overview.performance.totalCalls).toBe("number");
      expect(Array.isArray(overview.recentActivity)).toBe(true);
    });

    it("should return full call details drawer data including conversation transcript", async () => {
      const details = await service.getCallById(tenantA, testCallId);

      expect(details.id).toBe(testCallId);
      expect(details.customer.name).toBeDefined();
      expect(details.conversation.transcript.length).toBeGreaterThan(0);
      expect(details.metadata.status).toBeDefined();
    });
  });

  // ============================================================================
  // 7. Telephony Diagnostics & Real Outbound Test Call Flow
  // ============================================================================
  describe("7. Telephony Diagnostics & Outbound Test Call Flow", () => {
    it("should perform comprehensive telephony connection test and return diagnostics", async () => {
      const testRes = await service.testTelephonyConnection(tenantA);

      expect(testRes).toBeDefined();
      expect(typeof testRes.success).toBe("boolean");
      expect(testRes.provider).toBeDefined();
      expect(testRes.message).toBeDefined();
      expect(testRes.timestamp).toBeDefined();
    });

    it("should initiate an outbound test call and generate initial AI greeting on answer", async () => {
      // Configure simulator for reproducible integration test
      await prisma.aiCollectionSettings.update({
        where: { companyId: tenantA.companyId },
        data: { voiceProvider: "simulator", defaultLanguage: "gujarati" },
      });

      const testCallResult = await service.initiateTestCall(tenantA, {
        phoneNumber: "+919876543210",
        language: "gujarati",
        scenario: "scenario_a_promise",
      });

      expect(testCallResult.success).toBe(true);
      expect(testCallResult.callId).toBeDefined();
      expect(testCallResult.providerCallSid).toBeDefined();

      // Verify Turn 0: When call is first answered and speech is empty, it returns initial AI greeting
      const turn0Response = await service.handleSpeechTurn(
        "simulator",
        { CallSid: testCallResult.providerCallSid, status: "in-progress" },
        testCallResult.callId,
      );

      expect(turn0Response).toBeDefined();
      const parsedTurn0 = JSON.parse(turn0Response);
      expect(parsedTurn0.speechText).toContain("નમસ્તે");
      expect(parsedTurn0.isFinalTurn).toBe(false);

      // Verify call record transitioned to IN_PROGRESS
      const callInDb = await prisma.aiCollectionCall.findUnique({
        where: { id: testCallResult.callId },
        include: { conversations: true },
      });

      expect(callInDb?.status).toBe("IN_PROGRESS");
      expect(callInDb?.conversations.length).toBe(1);
      expect(callInDb?.conversations[0].role).toBe("assistant");
    });
  });
});
