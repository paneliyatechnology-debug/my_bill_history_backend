import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI } from "@google/genai";
import {
  CallConversationContext,
  ConversationTurnItem,
} from "./conversation-context.interface";
import {
  AiConversationTurn,
  AiConversationTurnSchema,
} from "./extraction-schema";

@Injectable()
export class AiVoiceEngineService {
  private readonly logger = new Logger(AiVoiceEngineService.name);
  private readonly genAI: GoogleGenAI | null = null;
  private readonly modelName: string;

  constructor(private readonly config: ConfigService) {
    const apiKey =
      this.config.get<string>("GEMINI_API_KEY") ||
      process.env.GEMINI_API_KEY ||
      this.config.get<string>("GOOGLE_AI_API_KEY") ||
      process.env.GOOGLE_AI_API_KEY;

    this.modelName =
      this.config.get<string>("GEMINI_MODEL") ||
      process.env.GEMINI_MODEL ||
      "gemini-2.5-flash";

    if (apiKey && apiKey.trim().length > 0) {
      this.genAI = new GoogleGenAI({ apiKey });
      this.logger.log(`AiVoiceEngineService initialized with model: ${this.modelName}`);
    } else {
      this.logger.warn("GEMINI_API_KEY not configured. Falling back to local NLP heuristics.");
    }
  }

  /**
   * Generates the opening greeting when the customer answers the call.
   */
  generateInitialGreeting(ctx: CallConversationContext): string {
    const lang = (ctx.preferredLanguage || "gujarati").toLowerCase();
    const primaryInvoice = ctx.invoices[0];
    const invNum = primaryInvoice ? primaryInvoice.invoiceNumber : "બાકી બિલ";
    const amountStr = `₹${ctx.totalOutstanding.toLocaleString("en-IN")}`;

    if (lang.includes("guj")) {
      return `નમસ્તે, હું ${ctx.businessName} તરફથી એક ઓટોમેટેડ પેમેન્ટ રિમાઇન્ડર આસિસ્ટન્ટ બોલું છું. શું હું ${ctx.customerName} સાથે વાત કરી રહ્યો છું? તમારું ઇન્વોઇસ ${invNum} નું ${amountStr} પેમેન્ટ પેન્ડિંગ છે. આપ ક્યારે પેમેન્ટ કરી શકશો?`;
    } else if (lang.includes("hin")) {
      return `नमस्ते, मैं ${ctx.businessName} की तरफ से ऑटोमेटेड पेमेंट रिमाइंडर असिस्टेंट बोल रहा हूँ। क्या मेरी बात ${ctx.customerName} से हो रही है? आपका बिल ${invNum} का ${amountStr} पेमेंट बाकी है। आप कब तक पेमेंट कर पाएंगे?`;
    } else {
      return `Hello, this is an automated payment reminder assistant calling on behalf of ${ctx.businessName}. Am I speaking with ${ctx.customerName}? You have a pending payment of ${amountStr} for invoice ${invNum}. When can we expect this payment?`;
    }
  }

  /**
   * Processes a customer's spoken speech turn and returns the next conversation turn.
   */
  async processCustomerSpeech(
    userInput: string,
    ctx: CallConversationContext,
  ): Promise<AiConversationTurn> {
    const currentDate = new Date().toISOString().split("T")[0]; // Reference current date e.g. 2026-11-17

    if (!this.genAI) {
      return this.fallbackNlpProcess(userInput, ctx, currentDate);
    }

    try {
      const prompt = this.buildPrompt(userInput, ctx, currentDate);

      const response = await this.genAI.models.generateContent({
        model: this.modelName,
        contents: prompt,
      });

      const responseText = response.text ? response.text.trim() : "";
      return this.parseAndValidateResponse(responseText, userInput, ctx, currentDate);
    } catch (err: any) {
      this.logger.error(`Gemini generation error: ${err.message}. Using fallback.`);
      return this.fallbackNlpProcess(userInput, ctx, currentDate);
    }
  }

  private buildPrompt(
    userInput: string,
    ctx: CallConversationContext,
    currentDate: string,
  ): string {
    const invoicesSummary = ctx.invoices
      .map(
        (inv) =>
          `• Invoice ${inv.invoiceNumber}: Outstanding ₹${inv.balanceAmount} (Grand Total: ₹${inv.grandTotal}, Due: ${inv.dueDate || "N/A"})`,
      )
      .join("\n");

    const historySummary = ctx.history
      .map((h) => `${h.role === "assistant" ? "AI" : "Customer"}: "${h.content}"`)
      .join("\n");

    const verifiedBank = ctx.verifiedPaymentDetails;
    const bankDetailsText = `
Bank: ${verifiedBank.bankName || "Not configured"}
Account No: ${verifiedBank.bankAccountNumber || "Not configured"}
IFSC: ${verifiedBank.bankIfsc || "Not configured"}
Account Holder: ${verifiedBank.bankAccountHolder || ctx.businessName}
UPI ID: ${verifiedBank.upiId || "Not configured"}`;

    return `You are an expert, polite, and professional AI Voice Payment Collection Assistant for Indian SMEs in MyOwnBillBook.
You are calling a customer on behalf of "${ctx.businessName}" regarding their pending invoices.

CURRENT DATE (TODAY): ${currentDate}
BUSINESS NAME: ${ctx.businessName}
CUSTOMER NAME: ${ctx.customerName}
CUSTOMER PHONE: ${ctx.customerPhone}
PREFERRED LANGUAGE: ${ctx.preferredLanguage} (Support Gujarati, Hindi, or English naturally based on user language)
TOTAL OUTSTANDING DUE: ₹${ctx.totalOutstanding}

PENDING INVOICES:
${invoicesSummary}

VERIFIED BUSINESS BANK & UPI DETAILS (Only share these verified details; NEVER make up false bank numbers or IFSC):
${bankDetailsText}

PRIOR CONVERSATION TRANSCRIPT:
${historySummary.length > 0 ? historySummary : "(Call just initiated with initial greeting)"}

LATEST CUSTOMER SPEECH:
"${userInput}"

TASK:
Analyze the customer's response, determine their intent, extract all promised amounts and dates, and generate a polite spoken reply.
Recognize the following core scenarios:
1. PROMISE_TO_PAY:
   Customer promises to pay on a specific day/date (e.g. "કાલે કરી દઈશ", "शुक्रवार को कर दूंगा", "will pay on 20th").
   - Extract the promised date as YYYY-MM-DD relative to today (${currentDate}).
   - Confirm the date verbally: "બરાબર. શું હું [Date] સુધી payment કરવાની તમારી commitment નોંધું?" or "धन्यवाद, मैंने [Date] का प्रॉमिस नोट कर लिया है।"
   - Next action: "SCHEDULE_FOLLOWUP" or "CONFIRM_DATE" (or "END_CALL_RESOLVED" if confirmed).

2. ALREADY_PAID:
   Customer says they already paid (e.g. "Payment થઈ ગયું છે", "मैंने पेमेंट कर दिया है", "Already paid").
   - Ask for payment date and reference or UTR number.
   - Next action: "CONTINUE_CONVERSATION" or "CREATE_STAFF_TASK" to verify records.

3. REQUEST_MORE_TIME:
   Customer needs more time (e.g. "હાલ પૈસા નથી, થોડા દિવસ પછી કરીશ", "अभी दिक्कत है, कुछ दिन बाद", "tight on cash").
   - Politely ask when they expect to be able to pay.
   - Next action: "CONTINUE_CONVERSATION".

4. REQUEST_BANK_DETAILS:
   Customer asks for bank details (e.g. "bank details મોકલો", "खाता नंबर भेजो", "send bank details").
   - State the verified bank details and inform them you are sending an SMS/WhatsApp with the bank information.
   - Next action: "SHARE_BANK_DETAILS".

5. REQUEST_UPI:
   Customer asks to pay via UPI (e.g. "UPI થી payment કરવું છે", "GPay/PhonePe नंबर दो", "send UPI QR").
   - Mention the business UPI ID (${verifiedBank.upiId || "Registered UPI"}).
   - Next action: "SHARE_UPI".

6. DISPUTED:
   Customer disputes the invoice (e.g. "આ invoice ખોટું છે", "मैंने यह माल नहीं लिया", "amount is wrong").
   - Do NOT argue. Politely apologize and say you are recording the dispute for the accounting manager to review.
   - Next action: "CREATE_STAFF_TASK", is_final_turn: true.

7. HUMAN_ASSISTANCE:
   Customer wants to speak to a person (e.g. "કોઈ માણસ સાથે વાત કરાવો", "किसी स्टाफ से बात कराओ", "talk to human").
   - Politely accept and arrange a staff callback.
   - Next action: "CREATE_STAFF_TASK", is_final_turn: true.

8. OPT_OUT:
   Customer demands no further calls (e.g. "ફોન ના કરો", "कॉल मत करना", "stop calling me").
   - Respectfully apologize and confirm they will be removed from automated calling reminders.
   - Next action: "OPT_OUT_CUSTOMER", is_final_turn: true.

9. WRONG_NUMBER:
   Customer says wrong number or person is not available.
   - Next action: "END_CALL_UNRESOLVED", is_final_turn: true.

OUTPUT SPECIFICATION:
Respond with ONLY valid JSON (no markdown formatting, no backticks, no explanatory text) conforming strictly to this schema:
{
  "intent": "PROMISE_TO_PAY" | "ALREADY_PAID" | "PAYMENT_REPORTED_UNVERIFIED" | "REQUEST_MORE_TIME" | "REQUEST_BANK_DETAILS" | "REQUEST_UPI" | "DISPUTED" | "HUMAN_ASSISTANCE" | "WRONG_NUMBER" | "UNAVAILABLE" | "OPT_OUT" | "GENERAL_QUERY",
  "spokenReply": "Spoken text to the customer in natural Gujarati, Hindi, or English",
  "promised_amount": number or null,
  "promised_date": "YYYY-MM-DD" or null,
  "payment_method": string or null,
  "payment_reference": string or null,
  "customer_confirmed": boolean,
  "dispute_reason": string or null,
  "needs_human_followup": boolean,
  "next_action": "CONTINUE_CONVERSATION" | "CONFIRM_DATE" | "SHARE_BANK_DETAILS" | "SHARE_UPI" | "SCHEDULE_FOLLOWUP" | "CREATE_STAFF_TASK" | "OPT_OUT_CUSTOMER" | "END_CALL_RESOLVED" | "END_CALL_UNRESOLVED",
  "is_final_turn": boolean,
  "conversation_summary": "1-2 sentence English summary of what happened in this call",
  "detected_language": "gujarati" | "hindi" | "english"
}`;
  }

  private parseAndValidateResponse(
    rawText: string,
    userInput: string,
    ctx: CallConversationContext,
    currentDate: string,
  ): AiConversationTurn {
    let cleanJson = rawText.trim();
    // Remove markdown code fences if present
    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
    }

    try {
      const parsed = JSON.parse(cleanJson);

      if (typeof parsed.intent === "string") {
        const normIntent = parsed.intent.toUpperCase().replace(/[\s-]/g, "_");
        if (normIntent.includes("PROMISE")) parsed.intent = "PROMISE_TO_PAY";
        else if (normIntent.includes("ALREADY") || normIntent.includes("PAID")) parsed.intent = "ALREADY_PAID";
        else if (normIntent.includes("TIME")) parsed.intent = "REQUEST_MORE_TIME";
        else if (normIntent.includes("BANK")) parsed.intent = "REQUEST_BANK_DETAILS";
        else if (normIntent.includes("UPI")) parsed.intent = "REQUEST_UPI";
        else if (normIntent.includes("DISPUT")) parsed.intent = "DISPUTED";
        else if (normIntent.includes("HUMAN")) parsed.intent = "HUMAN_ASSISTANCE";
        else if (normIntent.includes("OPT")) parsed.intent = "OPT_OUT";
        else parsed.intent = normIntent;
      }

      if (typeof parsed.next_action === "string") {
        const normAction = parsed.next_action.toUpperCase().replace(/[\s-]/g, "_");
        if (normAction.includes("CONFIRM")) parsed.next_action = "CONFIRM_DATE";
        else if (normAction.includes("FOLLOWUP")) parsed.next_action = "SCHEDULE_FOLLOWUP";
        else if (normAction.includes("STAFF") || normAction.includes("TASK")) parsed.next_action = "CREATE_STAFF_TASK";
        else if (normAction.includes("OPT")) parsed.next_action = "OPT_OUT_CUSTOMER";
        else if (normAction.includes("BANK")) parsed.next_action = "SHARE_BANK_DETAILS";
        else if (normAction.includes("UPI")) parsed.next_action = "SHARE_UPI";
        else if (normAction.includes("RESOLVED")) parsed.next_action = "END_CALL_RESOLVED";
        else if (normAction.includes("UNRESOLVED") || normAction.includes("END")) parsed.next_action = "END_CALL_UNRESOLVED";
        else parsed.next_action = "CONTINUE_CONVERSATION";
      }

      if (typeof parsed.detected_language === "string") {
        const dl = parsed.detected_language.toLowerCase();
        if (dl.includes("guj") || dl.includes("ગુજરાતી")) parsed.detected_language = "gujarati";
        else if (dl.includes("hin") || dl.includes("हिन्दी")) parsed.detected_language = "hindi";
        else parsed.detected_language = "english";
      }

      const validated = AiConversationTurnSchema.parse(parsed);
      return validated;
    } catch (err: any) {
      this.logger.warn(`Failed to parse AI structured response: ${err.message}. Raw: ${cleanJson}`);
      return this.fallbackNlpProcess(userInput, ctx, currentDate);
    }
  }

  /**
   * High-accuracy heuristic NLP parser when Gemini is unavailable or rate-limited.
   */
  fallbackNlpProcess(
    input: string,
    ctx: CallConversationContext,
    currentDate: string,
  ): AiConversationTurn {
    const text = (input || "").toLowerCase().trim();
    const lang = (ctx.preferredLanguage || "gujarati").toLowerCase();

    // 1. Opt out
    if (
      text.includes("ફોન ના") ||
      text.includes("ડોન્ટ કોલ") ||
      text.includes("કૉલ મત") ||
      text.includes("call mat") ||
      text.includes("stop call") ||
      text.includes("don't call")
    ) {
      const reply = lang.includes("hin")
        ? "माफ कीजिएगा। हमने आपका नंबर ऑटोमेटेड कॉल लिस्ट से हटा दिया है। धन्यवाद।"
        : lang.includes("eng")
          ? "We apologize. We have removed your number from our automated call reminder list. Thank you."
          : "માફ કરશો. અમે તમારો નંબર ઓટોમેટેડ રિમાઇન્ડર લિસ્ટમાંથી દૂર કરી દીધો છે. તમારો દિવસ શુભ રહે.";
      return {
        intent: "OPT_OUT",
        spokenReply: reply,
        customer_confirmed: true,
        needs_human_followup: false,
        next_action: "OPT_OUT_CUSTOMER",
        is_final_turn: true,
        conversation_summary: "Customer requested to opt out of automated calls.",
        detected_language: lang.includes("hin") ? "hindi" : lang.includes("eng") ? "english" : "gujarati",
      };
    }

    // 2. Disputed
    if (
      text.includes("ખોટું છે") ||
      text.includes("ખોટો") ||
      text.includes("ગલત") ||
      text.includes("dispute") ||
      text.includes("wrong bill") ||
      text.includes("not correct")
    ) {
      const reply = lang.includes("hin")
        ? "मैंने आपका बिल डिस्प्यूट दर्ज कर लिया है। हमारे अकाउंट्स टीम के अधिकारी आपसे जल्द संपर्क करेंगे।"
        : lang.includes("eng")
          ? "I have recorded your dispute regarding this invoice. Our accounts manager will review this and contact you directly."
          : "મેં તમારો બિલ વિવાદ નોંધ્યો છે. અમારા એકાઉન્ટ્સ ટીમ અધિકારી તમારી સાથે ટૂંક સમયમાં વાત કરશે.";
      return {
        intent: "DISPUTED",
        spokenReply: reply,
        dispute_reason: input,
        customer_confirmed: false,
        needs_human_followup: true,
        next_action: "CREATE_STAFF_TASK",
        is_final_turn: true,
        conversation_summary: `Customer disputed invoice: ${input}`,
        detected_language: lang.includes("hin") ? "hindi" : lang.includes("eng") ? "english" : "gujarati",
      };
    }

    // 3. Human assistance
    if (
      text.includes("માણસ") ||
      text.includes("સાહેબ") ||
      text.includes("बात कराओ") ||
      text.includes("human") ||
      text.includes("person") ||
      text.includes("staff")
    ) {
      const reply = lang.includes("hin")
        ? "बिल्कुल, मैं आपके लिए स्टाफ कॉलबैक का अनुरोध नोट कर रहा हूँ। आपको जल्द कॉल आएगा।"
        : lang.includes("eng")
          ? "Certainly, I am noting a callback request for our staff to contact you shortly."
          : "ચોક્કસ, હું અમારા સ્ટાફ માટે કૉલબેક વિનંતી નોંધું છું. તમને ટૂંક સમયમાં કૉલ આવશે.";
      return {
        intent: "HUMAN_ASSISTANCE",
        spokenReply: reply,
        customer_confirmed: false,
        needs_human_followup: true,
        next_action: "CREATE_STAFF_TASK",
        is_final_turn: true,
        conversation_summary: "Customer requested to speak with a human representative.",
        detected_language: lang.includes("hin") ? "hindi" : lang.includes("eng") ? "english" : "gujarati",
      };
    }

    // 4. Bank details requested
    if (
      text.includes("bank") ||
      text.includes("બેંક") ||
      text.includes("खाता") ||
      text.includes("account details")
    ) {
      const bank = ctx.verifiedPaymentDetails;
      const bankMsg = bank.bankAccountNumber
        ? `અમારો બેંક એકાઉન્ટ નંબર ${bank.bankAccountNumber} અને IFSC કોડ ${bank.bankIfsc || ""} છે.`
        : "અમે અમારા વેરિફાઇડ બેંક વિગતો વોટ્સએપ પર મોકલી રહ્યા છીએ.";
      return {
        intent: "REQUEST_BANK_DETAILS",
        spokenReply: `${bankMsg} અમે તમને મેસેજ પણ મોકલી રહ્યા છીએ.`,
        customer_confirmed: false,
        needs_human_followup: false,
        next_action: "SHARE_BANK_DETAILS",
        is_final_turn: false,
        conversation_summary: "Customer requested verified bank account details.",
        detected_language: "gujarati",
      };
    }

    // 5. UPI requested
    if (text.includes("upi") || text.includes("gpay") || text.includes("phonepe") || text.includes("paytm")) {
      const upi = ctx.verifiedPaymentDetails.upiId || "અમારા રજિસ્ટર્ડ UPI આઈડી";
      return {
        intent: "REQUEST_UPI",
        spokenReply: `આપ ${upi} પર UPI પેમેન્ટ કરી શકો છો. અમે તમને લિંક પણ મોકલી રહ્યા છીએ.`,
        customer_confirmed: false,
        needs_human_followup: false,
        next_action: "SHARE_UPI",
        is_final_turn: false,
        conversation_summary: `Customer requested UPI details: ${upi}`,
        detected_language: "gujarati",
      };
    }

    // 6. Already paid
    if (
      text.includes("payment થઈ ગયું") ||
      text.includes("આપી દીધા") ||
      text.includes("પેમેન્ટ કરી દીધું") ||
      text.includes("हो गया") ||
      text.includes("दे दिया") ||
      text.includes("already paid") ||
      text.includes("paid already")
    ) {
      const reply = lang.includes("hin")
        ? "जानकारी के लिए धन्यवाद। मैं हमारे रिकॉर्ड्स में चेक करवाता हूँ। क्या आपके पास पेमेंट का यूटीआर या संदर्भ नंबर है?"
        : lang.includes("eng")
          ? "Thank you for the update. Let me verify this against our records. Do you have a payment reference or UTR number?"
          : "માહિતી બદલ આભાર. હું અમારા એકાઉન્ટ્સમાં તપાસ કરાવું છું. શું આપની પાસે પેમેન્ટ રેફરન્સ કે UTR નંબર છે?";
      return {
        intent: "ALREADY_PAID",
        spokenReply: reply,
        customer_confirmed: false,
        needs_human_followup: true,
        next_action: "CREATE_STAFF_TASK",
        is_final_turn: false,
        conversation_summary: "Customer stated payment was already made; verification requested.",
        detected_language: lang.includes("hin") ? "hindi" : lang.includes("eng") ? "english" : "gujarati",
      };
    }

    // 7. Promise to pay (days / dates)
    const promisedDate = this.estimateDateFromText(text, currentDate);
    const reply = lang.includes("hin")
      ? `बहुत अच्छा। मैंने ${promisedDate} की पेमेंट कमिटमेंट नोट कर ली है। समय पर भुगतान करने पर आपको दोबारा रिमाइंडर नहीं आएगा। धन्यवाद।`
      : lang.includes("eng")
        ? `Thank you. I have recorded your payment commitment for ${promisedDate}. Have a pleasant day.`
        : `આભાર. મેં ${promisedDate} ની પેમેન્ટ કમિટમેન્ટ નોંધેલી છે. જો પેમેન્ટ કરવામાં આવે તો ફરીથી રિમાઇન્ડર આપવામાં આવશે નહીં. તમારો દિવસ શુભ રહે.`;

    return {
      intent: "PROMISE_TO_PAY",
      spokenReply: reply,
      promised_amount: ctx.totalOutstanding,
      promised_date: promisedDate,
      customer_confirmed: true,
      needs_human_followup: false,
      next_action: "SCHEDULE_FOLLOWUP",
      is_final_turn: true,
      conversation_summary: `Customer promised payment on ${promisedDate}.`,
      detected_language: lang.includes("hin") ? "hindi" : lang.includes("eng") ? "english" : "gujarati",
    };
  }

  private estimateDateFromText(text: string, baseDateStr: string): string {
    const base = new Date(baseDateStr);
    const t = text.toLowerCase();

    let addDays = 3; // Default 3 days
    if (t.includes("કાલે") || t.includes("કલ") || t.includes("tomorrow")) {
      addDays = 1;
    } else if (t.includes("પરમદિવસે") || t.includes("પરસો") || t.includes("day after")) {
      addDays = 2;
    } else if (t.includes("સોમવાર") || t.includes("monday")) {
      addDays = (1 + 7 - base.getDay()) % 7 || 7;
    } else if (t.includes("શુક્રવાર") || t.includes("friday")) {
      addDays = (5 + 7 - base.getDay()) % 7 || 7;
    } else if (t.includes("શનિવાર") || t.includes("saturday")) {
      addDays = (6 + 7 - base.getDay()) % 7 || 7;
    } else if (t.includes("રવિવાર") || t.includes("sunday")) {
      addDays = (0 + 7 - base.getDay()) % 7 || 7;
    } else if (t.includes("બે દિવસ") || t.includes("2 days")) {
      addDays = 2;
    } else if (t.includes("અઠવાડિયું") || t.includes("week")) {
      addDays = 7;
    }

    base.setDate(base.getDate() + addDays);
    return base.toISOString().split("T")[0];
  }
}

