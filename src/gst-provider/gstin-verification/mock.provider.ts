import {
  GstinVerificationResult,
  GstRegistrationStatus,
  IGstVerificationProvider,
} from "./types";

export interface MockRegistryEntry {
  legalName: string;
  tradeName?: string;
  status?: string;
  constitution?: string;
  taxpayerType?: string;
  registrationDate?: string;
  address?: string;
  city?: string;
  district?: string;
  state?: string;
  stateCode?: string;
  pincode?: string;
}

export class MockGstVerificationProvider implements IGstVerificationProvider {
  readonly providerName = "mock";
  private readonly registry: Record<string, MockRegistryEntry>;

  constructor(customRegistry?: Record<string, MockRegistryEntry>) {
    this.registry = {
      "27AAAAA0000A1Z2": {
        legalName: "EXAMPLE COMPANY PRIVATE LIMITED",
        tradeName: "Example Co",
        status: "Active",
        constitution: "Private Limited Company",
        taxpayerType: "Regular",
        registrationDate: "01/07/2017",
        address: "123 Business Park, Andheri East, Mumbai, 400001",
        city: "Mumbai",
        district: "Mumbai",
        state: "Maharashtra",
        stateCode: "27",
        pincode: "400001",
      },
      "27AAAAA0000A1Z5": {
        legalName: "EXAMPLE COMPANY PRIVATE LIMITED",
        tradeName: "Example Co",
        status: "Active",
        constitution: "Private Limited Company",
        taxpayerType: "Regular",
        registrationDate: "01/07/2017",
        address: "123 Business Park, Andheri East, Mumbai, 400001",
        city: "Mumbai",
        district: "Mumbai",
        state: "Maharashtra",
        stateCode: "27",
        pincode: "400001",
      },
      "24CANCL1234A1Z0": {
        legalName: "Cancelled Trader Enterprises",
        tradeName: "Cancelled Trader",
        status: "Cancelled",
        constitution: "Proprietorship",
        taxpayerType: "Regular",
        registrationDate: "15/03/2018",
        address: "Old Industrial Area",
        city: "Surat",
        district: "Surat",
        state: "Gujarat",
        stateCode: "24",
        pincode: "395003",
      },
      "24SUSPN1234A1ZH": {
        legalName: "Suspended Vendor Private Limited",
        tradeName: "Suspended Vendor",
        status: "Suspended",
        constitution: "Private Limited Company",
        taxpayerType: "Regular",
        registrationDate: "10/01/2019",
        address: "Ring Road",
        city: "Vadodara",
        district: "Vadodara",
        state: "Gujarat",
        stateCode: "24",
        pincode: "390001",
      },
      ...(customRegistry || {}),
    };
  }

  async verifyGstin(gstin: string): Promise<GstinVerificationResult> {
    const clean = gstin.trim().toUpperCase();
    const entry = this.registry[clean];

    if (!entry) {
      return {
        success: false,
        isValid: false,
        gstin: clean,
        legalName: null,
        tradeName: null,
        registrationStatus: "UNKNOWN",
        registrationDate: null,
        taxpayerType: null,
        constitutionOfBusiness: null,
        pan: clean.length >= 12 ? clean.substring(2, 12) : null,
        stateCode: clean.length >= 2 ? clean.substring(0, 2) : null,
        stateName: null,
        address: {
          line1: null,
          city: null,
          district: null,
          state: null,
          stateCode: null,
          pincode: null,
        },
        verifiedAt: new Date().toISOString(),
        source: "LIVE_API",
        message: `Taxpayer with GSTIN '${clean}' was not found on the GST portal.`,
        messageGujarati: `GST પોર્ટલ પર GSTIN '${clean}' વાળો કરદાતા મળ્યો નથી.`,
        errorCode: "GSTIN_NOT_FOUND",
      };
    }

    const normalizedStatus = this.normalizeStatus(entry.status);
    let warningMessage = "";
    let warningMessageGujarati = "";
    if (normalizedStatus === "CANCELLED") {
      warningMessage = "Warning: This GSTIN registration has been CANCELLED.";
      warningMessageGujarati =
        "ચેતવણી: આ GSTIN રજીસ્ટ્રેશન રદ (Cancelled) કરવામાં આવ્યું છે.";
    } else if (normalizedStatus === "SUSPENDED") {
      warningMessage =
        "Warning: This GSTIN registration is currently SUSPENDED.";
      warningMessageGujarati =
        "ચેતવણી: આ GSTIN રજીસ્ટ્રેશન હાલમાં સ્થગિત (Suspended) છે.";
    }

    return {
      success: true,
      isValid: true,
      gstin: clean,
      legalName: entry.legalName,
      tradeName: entry.tradeName || entry.legalName,
      registrationStatus: normalizedStatus,
      registrationDate: entry.registrationDate || null,
      taxpayerType: entry.taxpayerType || "Regular",
      constitutionOfBusiness: entry.constitution || null,
      pan: clean.length >= 12 ? clean.substring(2, 12) : null,
      stateCode:
        entry.stateCode || (clean.length >= 2 ? clean.substring(0, 2) : null),
      stateName: entry.state || null,
      address: {
        line1: entry.address || null,
        city: entry.city || entry.district || null,
        district: entry.district || null,
        state: entry.state || null,
        stateCode:
          entry.stateCode || (clean.length >= 2 ? clean.substring(0, 2) : null),
        pincode: entry.pincode || null,
      },
      verifiedAt: new Date().toISOString(),
      source: "LIVE_API",
      rawStatusText: entry.status,
      message: warningMessage || "Taxpayer details verified successfully.",
      messageGujarati:
        warningMessageGujarati || "કરદાતાની વિગતો સફળતાપૂર્વક મેળવવામાં આવી.",
      creditsRemaining: 499,
    };
  }

  private normalizeStatus(rawStatus?: string): GstRegistrationStatus {
    if (!rawStatus) return "UNKNOWN";
    const clean = rawStatus.trim().toUpperCase();
    if (clean === "ACTIVE") return "ACTIVE";
    if (clean.includes("CANCEL")) return "CANCELLED";
    if (clean.includes("SUSPEND")) return "SUSPENDED";
    if (clean.includes("INACTIVE")) return "INACTIVE";
    return "UNKNOWN";
  }
}
