import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { TenantContext } from "@billing/shared-types";
import { DatabaseService } from "../database/database.service";
import { UpdateInvoicePrintSettingsDto } from "./dto/update-invoice-settings.dto";
import { renderInvoiceHtml } from "./invoice-print.renderer";
import {
  DEFAULT_DOCUMENT_TITLES,
  INVOICE_COPY_LABELS,
  INVOICE_PAPER_SIZES,
  INVOICE_THEMES,
  buildInvoiceSettingsScreen,
} from "./invoice-themes";

const BOOLEAN_KEYS: (keyof UpdateInvoicePrintSettingsDto)[] = [
  "showPartyBalance",
  "enableFreeItemQuantity",
  "showItemDescription",
  "showAlternateUnit",
  "showPhoneNumber",
  "showGstin",
  "showPan",
  "showEmail",
  "showHsn",
  "showDiscount",
  "showTaxBreakup",
  "showBankDetails",
  "showUpiQr",
  "showSignature",
  "showAmountInWords",
  "showReceivedAmount",
  "showTerms",
  "showNotes",
  "showDueDate",
  "showPlaceOfSupply",
  "showShippingAddress",
  "showSavedAmount",
  "showEmojis",
  "printHistory",
  "autoApplyLuxuryForSharing",
  "showPoNumber",
  "showEwayBillNumber",
  "showVehicleNumber",
  "showTaxColumn",
  "showBatch",
  "showExpiry",
  "showSku",
  "showTimeOnInvoice",
  "showPricePerItem",
  "showQuantity",
  "showMfgDate",
  "enableReceiverSignature",
  "stretchItemTable",
];

const THEME_ALIASES: Record<string, string> = {
  diwali_1: "diwali",
  diwali_2: "diwali",
  dhanteras_1: "dhanteras",
  dhanteras_2: "dhanteras",
  navratri_1: "navratri",
  navratri_2: "navratri",
  durga_puja_1: "durga_puja",
  dussehra_1: "dussehra",
  uttarayan_1: "uttarayan",
  independence_1: "independence",
  ganesh_chaturthi_1: "ganesh_chaturthi",
  navaratri: "navratri",
  logo: "your_logo",
  ganesh: "ganesh_chaturthi",
  compact: "advanced_compact",
  thermal_80: "stylish",
  corporate: "modern",
};

import { InvoicePdfService } from "./invoice-pdf.service";

@Injectable()
export class InvoicePrintService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly invoicePdfService: InvoicePdfService,
  ) {}

  catalog() {
    return {
      ...buildInvoiceSettingsScreen({}),
      paperSizes: INVOICE_PAPER_SIZES,
      copies: Object.entries(INVOICE_COPY_LABELS).map(([id, label]) => ({ id, label })),
      documentTypes: Object.entries(DEFAULT_DOCUMENT_TITLES).map(([id, title]) => ({
        id,
        title,
      })),
    };
  }

  async getSettings(tenant: TenantContext) {
    const row = await this.ensureSettings(tenant);
    return this.present(row);
  }

  async saveSettings(tenant: TenantContext, dto: UpdateInvoicePrintSettingsDto) {
    const existing = await this.ensureSettings(tenant);
    const data: any = {};

    if (dto.themeId !== undefined) {
      const rawThemeId = dto.themeId;
      const themeId = THEME_ALIASES[rawThemeId] || rawThemeId;
      if (!INVOICE_THEMES.some((t) => t.id === themeId)) {
        throw new BadRequestException("Unknown invoice theme.");
      }
      data.themeId = themeId;
      if (rawThemeId.includes("_") && dto.festiveTheme === undefined) {
        data.festiveTheme = rawThemeId;
      }
      const theme = INVOICE_THEMES.find((t) => t.id === themeId);
      if (theme && !dto.paperSize) data.paperSize = theme.paper;
      if (dto.themeId === "thermal_80") data.paperSize = "THERMAL_80";
    }
    if (dto.accentColor !== undefined) {
      if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(dto.accentColor)) {
        throw new BadRequestException("accentColor must be a hex color like #111111.");
      }
      data.accentColor = dto.accentColor;
    }
    if (dto.paperSize !== undefined) {
      if (!INVOICE_PAPER_SIZES.includes(dto.paperSize as any)) {
        throw new BadRequestException("Invalid paper size.");
      }
      data.paperSize = dto.paperSize;
    }
    if (dto.printCopies !== undefined) {
      const copies = dto.printCopies.filter((c) => INVOICE_COPY_LABELS[c]);
      if (!copies.length) {
        throw new BadRequestException("Select at least one print copy type.");
      }
      data.printCopies = copies;
    }
    for (const key of [
      "logoUrl",
      "watermarkUrl",
      "slogan",
      "footerText",
      "fontSize",
      "industryType",
      "festiveTheme",
      "fontFamily",
      "tablePadding",
      "borderStyle",
      "selectedBankAccount",
      "selectedPaymentQr",
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    if (dto.documentTitles !== undefined) data.documentTitles = dto.documentTitles;
    if (dto.invoiceCustomFields !== undefined) data.invoiceCustomFields = dto.invoiceCustomFields;
    if (dto.partyCustomFields !== undefined) data.partyCustomFields = dto.partyCustomFields;
    if (dto.itemColumnOrder !== undefined) data.itemColumnOrder = dto.itemColumnOrder;
    if (dto.itemCustomColumns !== undefined) data.itemCustomColumns = dto.itemCustomColumns;
    if (dto.termsAndConditions !== undefined) data.termsAndConditions = dto.termsAndConditions;
    if (dto.headerLayout !== undefined) {
      data.headerLayout = Math.min(3, Math.max(1, Number(dto.headerLayout) || 1));
    }
    for (const key of ["marginTop", "marginRight", "marginBottom", "marginLeft"] as const) {
      if (dto[key] !== undefined) data[key] = Math.min(40, Math.max(0, Number(dto[key]) || 0));
    }
    for (const key of BOOLEAN_KEYS) {
      if (dto[key] !== undefined) data[key] = Boolean(dto[key]);
    }

    const saved = await this.prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.companyInvoicePrintSettings.update({
        where: { id: existing.id },
        data,
      });
    });
    return this.present(saved);
  }

  async previewHtml(
    tenant: TenantContext | undefined,
    copyType?: string,
    category?: string,
    share?: boolean,
    themeId?: string,
    accentColor?: string,
  ) {
    let effectiveTenant = tenant;
    if (!effectiveTenant?.companyId) {
      const comp = await this.prisma.company.findFirst();
      if (comp) {
        effectiveTenant = {
          organizationId: comp.organizationId,
          companyId: comp.id,
          isSystemBypass: true,
        };
      }
    }
    if (!effectiveTenant?.companyId) {
      throw new BadRequestException("Company context is required.");
    }
    let settings = this.withShareTheme(await this.ensureSettings(effectiveTenant), share);
    if (themeId) {
      if (!INVOICE_THEMES.some((t) => t.id === themeId)) {
        throw new BadRequestException("Unknown invoice theme.");
      }
      settings = { ...settings, themeId };
    }
    if (accentColor) settings = { ...settings, accentColor };
    const company = await this.loadCompany(effectiveTenant);
    const sample = this.sampleInvoice(company, category || "TAX_INVOICE");
    return await renderInvoiceHtml({
      settings,
      company,
      invoice: sample,
      copyType: copyType || "ORIGINAL_FOR_RECIPIENT",
    });
  }

  async printInvoiceHtml(
    tenant: TenantContext | undefined,
    invoiceId: string,
    copyType?: string,
    share?: boolean,
    themeId?: string,
    accentColor?: string,
  ) {
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        party: true,
        branch: true,
        items: {
          include: {
            item: {
              include: {
                primaryUom: true,
                secondaryUom: true,
              },
            },
          },
        },
      },
    });
    if (!invoice) {
      throw new NotFoundException(`Sales invoice ${invoiceId} not found.`);
    }

    const effectiveTenant: TenantContext = tenant?.companyId
      ? tenant
      : {
          organizationId: invoice.organizationId,
          companyId: invoice.companyId,
          branchId: invoice.branchId,
          financialYearId: invoice.financialYearId,
          isSystemBypass: true,
        };

    let settings = this.withShareTheme(await this.ensureSettings(effectiveTenant), share);
    if (themeId) {
      const resolved = THEME_ALIASES[themeId] || themeId;
      settings = { ...settings, themeId: resolved };
    }
    if (accentColor) {
      settings = { ...settings, accentColor };
    }
    const company = await this.loadCompany(effectiveTenant);

    return await renderInvoiceHtml({
      settings,
      company,
      invoice,
      copyType: copyType || "ORIGINAL_FOR_RECIPIENT",
    });
  }

  async generateInvoicePdf(
    tenant: TenantContext | undefined,
    invoiceId: string,
    copyType?: string,
    share?: boolean,
    themeId?: string,
    accentColor?: string,
  ): Promise<{ pdfBuffer: Buffer; invoice: any }> {
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) {
      throw new NotFoundException(`Sales invoice ${invoiceId} not found.`);
    }

    const html = await this.printInvoiceHtml(
      tenant,
      invoiceId,
      copyType,
      share,
      themeId,
      accentColor,
    );
    const pdfBuffer = await this.invoicePdfService.generatePdf(invoiceId, html);
    return { pdfBuffer, invoice };
  }

  private present(row: any) {
    return {
      settings: row,
      screen: buildInvoiceSettingsScreen(row),
    };
  }

  private withShareTheme(settings: any, share?: boolean) {
    if (share && settings.autoApplyLuxuryForSharing) {
      return { ...settings, themeId: "luxury" };
    }
    return settings;
  }

  private async ensureSettings(tenant: TenantContext) {
    if (!tenant.companyId) {
      throw new BadRequestException("Company context is required.");
    }
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const found = await tx.companyInvoicePrintSettings.findUnique({
        where: { companyId: tenant.companyId },
      });
      if (found) return found;
      return tx.companyInvoicePrintSettings.create({
        data: {
          id: randomUUID(),
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
        },
      });
    });
  }

  private async loadCompany(tenant: TenantContext) {
    const company = await this.prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.company.findFirst({
        where: { id: tenant.companyId, organizationId: tenant.organizationId },
      });
    });
    if (!company) throw new NotFoundException("Company not found.");
    return company;
  }

  private sampleInvoice(company: any, category: string) {
    return {
      category,
      invoiceNumber: "AABBCCDD/202",
      invoiceDate: "2023-07-17T15:47:00.000Z",
      dueDate: "2023-02-16",
      poNumber: "PO-1024",
      ewayBillNumber: "351234567890",
      vehicleNumber: "GJ01AB1234",
      placeOfSupply: company.stateCode || "24",
      notes: "Sample Note",
      termsAndConditions:
        "1. Goods once sold will not be taken back or exchanged\n2. All disputes are subject to [ENTER_YOUR_CITY_NAME] jurisdiction only",
      subTotal: 11091.43,
      discountTotal: 1051.43,
      cgstAmount: 881.23,
      sgstAmount: 881.23,
      igstAmount: 0,
      cessAmount: 0,
      roundOff: 0,
      grandTotal: 12853.89,
      paidAmount: 0,
      balanceAmount: 12853.89,
      outstandingBalance: 12853.89,
      billingAddress: {
        line1: "No F2, Outer Circle, Connaught Circus",
        city: "New Delhi",
        state: "DELHI",
        pincode: "110001",
      },
      shippingAddress: {
        line1: "1234123 324574234",
        city: "Bengaluru",
      },
      party: {
        name: "SAMPLE PARTY",
        gstin: "07AABCW2709M4Z7",
        phone: "7400417400",
        currentBalance: 0,
      },
      taxableAmount: 11091.43,
      items: [
        {
          description: "samsung phone",
          hsnCode: "1234",
          quantity: 1,
          unitPrice: 10000,
          discountAmount: 1000,
          discountPercent: 10,
          taxRate: 18,
          cgstAmount: 810,
          sgstAmount: 810,
          igstAmount: 0,
          taxableAmount: 9000,
          totalAmount: 10620,
          item: { name: "Samsung A30", primaryUom: { symbol: "PCS" } },
        },
        {
          description: "best biscuit",
          hsnCode: "40511209",
          quantity: 1,
          unitPrice: 342.86,
          discountAmount: 51.43,
          discountPercent: 15,
          taxRate: 18,
          cgstAmount: 26.23,
          sgstAmount: 26.23,
          igstAmount: 0,
          taxableAmount: 291.43,
          totalAmount: 343.89,
          item: { name: "Perle-G 200g", primaryUom: { symbol: "BOX" } },
        },
        {
          description: "",
          hsnCode: "2032",
          quantity: 2,
          unitPrice: 900,
          discountAmount: 0,
          discountPercent: 0,
          taxRate: 5,
          cgstAmount: 45,
          sgstAmount: 45,
          igstAmount: 0,
          taxableAmount: 1800,
          totalAmount: 1890,
          item: { name: "Puma Blue Round Neck T-Shirt", primaryUom: { symbol: "PCS" } },
        },
      ],
    };
  }
}
