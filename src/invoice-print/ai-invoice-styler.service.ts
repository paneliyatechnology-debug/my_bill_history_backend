import { Injectable, Logger } from "@nestjs/common";
import { GoogleGenAI } from "@google/genai";

export interface AiStyleRequest {
  prompt: string;
  currentSettings: any;
  selectedElement?: string | null;
  imageBase64?: string | null;
}

export interface AiStyleResult {
  updatedSettings: any;
  explanation: string;
  highlightedElement?: string | null;
}

@Injectable()
export class AiInvoiceStylerService {
  private readonly logger = new Logger(AiInvoiceStylerService.name);

  async styleInvoice(req: AiStyleRequest): Promise<AiStyleResult> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    const prompt = (req.prompt || "").trim();
    const current = req.currentSettings || {};

    if (apiKey && apiKey.trim().length > 0) {
      try {
        return await this.callGemini(apiKey, prompt, current, req.selectedElement, req.imageBase64);
      } catch (err: any) {
        this.logger.warn(`Gemini styling call failed, falling back to heuristic engine: ${err.message}`);
      }
    }

    // Heuristic & Preset Rule Engine (High reliability fallback & fast response)
    return this.applyHeuristicRules(prompt, current, req.selectedElement);
  }

  private async callGemini(
    apiKey: string,
    prompt: string,
    current: any,
    selectedElement?: string | null,
    imageBase64?: string | null,
  ): Promise<AiStyleResult> {
    const ai = new GoogleGenAI({ apiKey });
    const configuredModel = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

    const systemPrompt = `You are an expert Indian GST Invoice Design and Typography Specialist AI.
The user wants to customize or restyle their invoice settings with the following request: "${prompt}".
${selectedElement ? `The user specifically targeted the section: "${selectedElement}".` : ""}

Current invoice settings:
${JSON.stringify(current, null, 2)}

Supported parameters you can modify:
- accentColor: hex string (e.g. "#111111", "#16A34A", "#0284C7", "#7C3AED", "#DC2626", "#4F46E5", "#D97706", "#C2410C", "#0D9488")
- themeId: one of ["stylish", "luxury", "advanced_gst_tally", "advanced_gst", "tallybook", "tallybook_lite", "advanced_compact", "modern", "simple", "billbook", "your_logo", "navratri", "durga_puja", "dussehra", "dhanteras", "diwali", "uttarayan", "independence", "ganesh_chaturthi"]
- festiveTheme: same festival id when a festival theme is chosen, otherwise null
- headerLayout: number 1, 2, or 3
- fontSize: "11", "12", "13", "14"
- showItemDescription: boolean
- showAlternateUnit: boolean
- showPartyBalance: boolean
- enableFreeItemQuantity: boolean
- showPhoneNumber: boolean
- showTimeOnInvoice: boolean
- priceHistory: boolean
- autoApplyLuxuryForSharing: boolean
- showPoNumber: boolean
- showEwayBillNumber: boolean
- showVehicleNumber: boolean
- showTaxBreakup: boolean
- showDiscount: boolean
- showHsn: boolean
- showUpiQr: boolean
- showBankDetails: boolean
- showSignature: boolean
- enableReceiverSignature: boolean
- termsAndConditions: string

Respond ONLY with a JSON object in this format (no markdown, no backticks):
{
  "updatedSettings": { ...key-value pairs of only modified or updated properties... },
  "explanation": "Friendly 1-2 sentence description explaining what styling changes were applied."
}`;

    const contents: any[] = [{ role: "user", parts: [{ text: systemPrompt }] }];
    if (imageBase64) {
      contents[0].parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: imageBase64.replace(/^data:image\/\w+;base64,/, ""),
        },
      });
    }

    const response = await ai.models.generateContent({
      model: configuredModel,
      contents,
    });

    const rawText = response.text?.trim() || "";
    const cleanJson = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanJson);

    return {
      updatedSettings: { ...current, ...(parsed.updatedSettings || {}) },
      explanation: parsed.explanation || "Invoice styling updated successfully.",
      highlightedElement: selectedElement,
    };
  }

  private applyHeuristicRules(prompt: string, current: any, selectedElement?: string | null): AiStyleResult {
    const lower = prompt.toLowerCase();
    const updated = { ...current };
    let explanation = "Invoice styling updated successfully.";

    if (lower.includes("diwali")) {
      updated.themeId = "diwali";
      updated.festiveTheme = "diwali";
      explanation = "Applied the Diwali invoice frame with diya band and festive colours.";
    } else if (lower.includes("navratri") || lower.includes("navaratri") || lower.includes("garba")) {
      updated.themeId = "navratri";
      updated.festiveTheme = "navratri";
      explanation = "Applied the Navratri invoice with a nine-colour garba band.";
    } else if (lower.includes("durga")) {
      updated.themeId = "durga_puja";
      updated.festiveTheme = "durga_puja";
      explanation = "Applied the Durga Puja red-and-gold invoice frame.";
    } else if (lower.includes("easy to read") || lower.includes("clean") || lower.includes("readable") || lower.includes("simple")) {
      updated.themeId = "stylish";
      updated.festiveTheme = null;
      updated.accentColor = "#111111";
      updated.fontSize = "13";
      updated.showItemDescription = true;
      updated.showAlternateUnit = true;
      updated.showTaxBreakup = true;
      updated.stretchItemTable = true;
      explanation = "Applied clean, high-contrast typography and spaced item layout for maximum readability.";
    } else if (lower.includes("brand touch") || lower.includes("luxury") || lower.includes("premium") || lower.includes("corporate")) {
      updated.themeId = "luxury";
      updated.festiveTheme = null;
      updated.accentColor = "#4F46E5";
      updated.headerLayout = 2;
      updated.autoApplyLuxuryForSharing = true;
      updated.showUpiQr = true;
      updated.showBankDetails = true;
      updated.showSignature = true;
      explanation = "Configured premium Luxury layout with prominent company branding, slate indigo accents, and payment QR.";
    } else if (lower.includes("highlight key info") || lower.includes("highlight") || lower.includes("key info") || lower.includes("bold")) {
      updated.themeId = "advanced_gst_tally";
      updated.festiveTheme = null;
      updated.accentColor = "#DC2626";
      updated.showPoNumber = true;
      updated.showDueDate = true;
      updated.showTaxBreakup = true;
      updated.showPartyBalance = true;
      updated.showHsn = true;
      explanation = "Highlighted crucial billing metadata including Due Dates, GST tax breakup, PO Number, and Party Balance.";
    } else if (lower.includes("fix layout") || lower.includes("balance") || lower.includes("compact") || lower.includes("align")) {
      updated.themeId = "advanced_gst_tally";
      updated.festiveTheme = null;
      updated.accentColor = "#0284C7";
      updated.headerLayout = 1;
      updated.fontSize = "12";
      updated.stretchItemTable = true;
      updated.marginTop = 8;
      updated.marginRight = 8;
      updated.marginBottom = 8;
      updated.marginLeft = 8;
      explanation = "Balanced table columns, normalized margins, and optimized header grid alignment.";
    } else if (lower.includes("creative") || lower.includes("festive") || lower.includes("colorful") || lower.includes("vibrant")) {
      updated.themeId = "diwali";
      updated.festiveTheme = "diwali";
      updated.showTimeOnInvoice = true;
      explanation = "Applied the Diwali festival invoice: diya band, purple-gold frame, and a full item table.";
    } else if (lower.includes("green") || lower.includes("organic") || lower.includes("eco")) {
      updated.accentColor = "#16A34A";
      explanation = "Switched invoice accent color to Emerald Green.";
    } else if (lower.includes("blue") || lower.includes("tech")) {
      updated.accentColor = "#0284C7";
      explanation = "Switched invoice accent color to Ocean Blue.";
    } else if (lower.includes("purple") || lower.includes("royal")) {
      updated.accentColor = "#7C3AED";
      explanation = "Switched invoice accent color to Royal Purple.";
    } else if (selectedElement === "items-table" || lower.includes("item") || lower.includes("table")) {
      updated.showItemDescription = true;
      updated.showAlternateUnit = true;
      updated.showHsn = true;
      updated.stretchItemTable = true;
      explanation = "Enhanced item table columns with alternate units, HSN codes, and item descriptions.";
    } else if (selectedElement === "party-details" || lower.includes("party") || lower.includes("customer")) {
      updated.showPartyBalance = true;
      updated.showShippingAddress = true;
      explanation = "Updated customer details section to display current balance and shipping address.";
    } else {
      updated.accentColor = "#4F46E5";
      updated.themeId = "stylish";
      updated.festiveTheme = null;
      explanation = `Customized invoice design according to: "${prompt}".`;
    }

    return {
      updatedSettings: updated,
      explanation,
      highlightedElement: selectedElement,
    };
  }
}
