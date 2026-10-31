import * as fs from "fs";
import * as path from "path";
import * as QRCode from "qrcode";
import {
  DEFAULT_DOCUMENT_TITLES,
  INVOICE_COPY_LABELS,
  InvoiceLayout,
  festiveSkin,
  themeLayout,
} from "./invoice-themes";

const THEME_IMAGE_CACHE = new Map<string, string>();

export function getThemeBase64Image(filename?: string): string {
  if (!filename) return "";
  if (THEME_IMAGE_CACHE.has(filename)) return THEME_IMAGE_CACHE.get(filename)!;
  const candidates = [
    path.join(process.cwd(), "public", "themes", filename),
    path.join(process.cwd(), "..", "Billing_backend", "public", "themes", filename),
    path.join(__dirname, "..", "..", "public", "themes", filename),
    path.join(__dirname, "..", "public", "themes", filename),
    path.join("/home/dell/Jaydeep/Billing_backend/public/themes", filename),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const b64 = fs.readFileSync(c).toString("base64");
      const mime = filename.endsWith(".png") ? "image/png" : "image/jpeg";
      const uri = `data:${mime};base64,${b64}`;
      THEME_IMAGE_CACHE.set(filename, uri);
      return uri;
    }
  }
  return "";
}

export async function generateUpiQrDataUrl(c: any, inv: any): Promise<string> {
  const vpa = c?.upiVpa || c?.upiId;
  if (!vpa) return "";
  try {
    const companyName = c.tradeName || c.legalName || "Merchant";
    const amount = Number(inv.balanceAmount ?? inv.grandTotal ?? 0).toFixed(2);
    const upiUrl = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(companyName)}&am=${amount}&cu=INR`;
    return await QRCode.toDataURL(upiUrl, { width: 88, margin: 1 });
  } catch {
    return "";
  }
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value: unknown): string {
  const n = Number(value || 0);
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function qty(value: unknown): string {
  const n = Number(value || 0);
  return n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function formatDate(value?: string | Date | null): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function amountInWords(amount: number): string {
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n: number) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? " " + ones[n % 10] : ""}`.trim());
  const three = (n: number) => {
    const h = Math.floor(n / 100);
    return `${h ? ones[h] + " Hundred " : ""}${two(n % 100)}`.trim();
  };
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  if (!rupees) return paise ? `Zero Rupees and ${two(paise)} Paise Only` : "Zero Rupees Only";
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;
  const parts = [
    crore ? `${three(crore)} Crore` : "",
    lakh ? `${three(lakh)} Lakh` : "",
    thousand ? `${three(thousand)} Thousand` : "",
    rest ? three(rest) : "",
  ].filter(Boolean);
  return `${parts.join(" ")}${paise ? ` and ${two(paise)} Paise` : ""} Only`;
}

function addr(obj: any): string {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  return [obj.line1, obj.line2, obj.city, obj.district, obj.state, obj.pincode]
    .filter(Boolean)
    .join(", ");
}

function lineTax(row: any): number {
  return Number(row.cgstAmount || 0) + Number(row.sgstAmount || 0) + Number(row.igstAmount || 0) + Number(row.cessAmount || 0);
}

function hsnSummary(items: any[]) {
  const map = new Map<string, { hsn: string; taxable: number; tax: number; rate: number }>();
  for (const row of items) {
    const hsn = String(row.hsnCode || row.item?.hsnCode || "");
    const taxable = Number(row.taxableAmount ?? Number(row.totalAmount || 0) - lineTax(row));
    const tax = lineTax(row);
    const rate = Number(row.taxRate || row.item?.taxRate || 0);
    const cur = map.get(hsn) || { hsn, taxable: 0, tax: 0, rate };
    cur.taxable += taxable;
    cur.tax += tax;
    cur.rate = rate;
    map.set(hsn, cur);
  }
  return [...map.values()];
}

function wrapPage(css: string, body: string, title: string, s: any) {
  const isThermal = s?.paperSize?.startsWith("THERMAL");
  const isA5 = s?.paperSize === "A5";
  const paper = isA5
    ? "A5 portrait"
    : isThermal
    ? s?.paperSize === "THERMAL_58"
      ? "58mm auto"
      : "80mm auto"
    : "A4 portrait";
  const width = isA5 ? "148mm" : isThermal ? (s?.paperSize === "THERMAL_58" ? "58mm" : "80mm") : "210mm";
  const minHeight = isA5 ? "210mm" : isThermal ? "auto" : "297mm";
  const baseFamily = s?.fontFamily || "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const fontStack = `${baseFamily}, 'Noto Sans Devanagari', 'Noto Sans Gujarati', 'Noto Sans', 'Lohit Devanagari', 'Lohit Gujarati', 'Mangal', 'Shruti', 'Gargi', sans-serif`;
  const fontSize = `${s?.fontSize || 12}px`;

  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700;800;900&family=Noto+Sans+Gujarati:wght@400;600;700;800;900&family=Noto+Sans:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700;800;900&family=Noto+Sans+Gujarati:wght@400;600;700;800;900&family=Noto+Sans:wght@400;600;700;800;900&display=swap');
@page {
  size: ${paper};
  margin: 0;
}
*, *:before, *:after { box-sizing: border-box; }
html, body, table, td, th, div, span, b, p {
  font-family: ${fontStack};
}
html, body {
  margin: 0;
  padding: 0;
  font-size: ${fontSize};
  color: #111;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
@media screen {
  body {
    background: #eceff3;
    padding: 16px 0;
    display: flex;
    justify-content: center;
  }
  .sheet {
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  }
}
@media print {
  body {
    background: #fff;
    margin: 0;
    padding: 0;
  }
  .sheet {
    margin: 0 !important;
    border: none !important;
    box-shadow: none !important;
  }
}
.sheet {
  width: ${width};
  min-height: ${minHeight};
  ${!isThermal ? `height: ${minHeight}; max-height: ${minHeight};` : ""}
  position: relative;
  background: #fff;
  margin: 0 auto;
  overflow: hidden;
  box-sizing: border-box;
}
${css}
</style></head><body>${body}</body></html>`;
}

export async function renderInvoiceHtml(input: {
  settings: any;
  company: any;
  invoice: any;
  copyType: string;
}): Promise<string> {
  const s = input.settings;
  const layout = themeLayout(s.themeId || s.festiveTheme);
  const upiQrDataUrl = await generateUpiQrDataUrl(input.company, input.invoice);
  const ctx = buildCtx({ ...input, upiQrDataUrl });
  if (layout === "luxury") return wrapPage(luxuryCss(s), luxuryBody(ctx), ctx.docTitle, s);
  if (layout === "festival") return wrapPage(festivalCss(s), festivalBody(ctx), ctx.docTitle, s);
  if (layout === "stylish" || layout === "modern" || layout === "simple" || layout === "billbook") {
    return wrapPage(stylishCss(s, layout), stylishBody(ctx, layout), ctx.docTitle, s);
  }
  return wrapPage(tallyCss(s, layout), tallyBody(ctx, layout), ctx.docTitle, s);
}

function buildCtx(input: { settings: any; company: any; invoice: any; copyType: string; upiQrDataUrl?: string }) {
  const s = input.settings;
  const c = input.company || {};
  const inv = input.invoice || {};
  const party = inv.party || {};
  const items: any[] = inv.items || [];
  const titles = { ...DEFAULT_DOCUMENT_TITLES, ...(s.documentTitles || {}) };
  const category = inv.category || "TAX_INVOICE";
  const color = s.accentColor || "#111111";
  const phoneIcon = s.showEmojis ? "📞 " : "";
  const locIcon = s.showEmojis ? "📍 " : "";
  return {
    s,
    c,
    inv,
    party,
    items,
    color,
    copyLabel: INVOICE_COPY_LABELS[input.copyType] || INVOICE_COPY_LABELS.ORIGINAL_FOR_RECIPIENT,
    docTitle: titles[category] || "TAX INVOICE",
    billing: inv.billingAddress || party.billingAddress,
    shipping: inv.shippingAddress || party.shippingAddress,
    intra: Number(inv.igstAmount || 0) <= 0,
    totalQty: items.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    received: Number(inv.paidAmount || 0),
    balance: Number(inv.balanceAmount ?? inv.outstandingBalance ?? 0),
    hsnRows: hsnSummary(items),
    phoneIcon,
    locIcon,
    upiQrDataUrl: input.upiQrDataUrl,
    terms:
      inv.termsAndConditions ||
      (typeof s.termsAndConditions === "object" && s.termsAndConditions?.sales) ||
      "",
  };
}

function invoiceMetaExtras(ctx: any) {
  const inv = ctx.inv;
  const fields = Array.isArray(ctx.s.invoiceCustomFields) ? ctx.s.invoiceCustomFields : [];
  const time =
    ctx.s.showTimeOnInvoice && inv.invoiceDate
      ? `<div style="margin-top:8px"><b>Time</b><br/>${esc(formatTime(inv.invoiceDate))}</div>`
      : "";
  const custom = fields
    .filter((f: any) => f && f.enabled !== false && (f.label || f.name))
    .map(
      (f: any) =>
        `<div style="margin-top:8px"><b>${esc(f.label || f.name)}</b><br/>${esc(f.value || "-")}</div>`,
    )
    .join("");
  return `${time}${custom}`;
}

function formatTime(value?: string | Date | null): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function partyCustomHtml(ctx: any) {
  const fields = Array.isArray(ctx.s.partyCustomFields) ? ctx.s.partyCustomFields : [];
  return fields
    .filter((f: any) => f && f.enabled !== false && (f.label || f.name))
    .map((f: any) => `<div>${esc(f.label || f.name)}: ${esc(f.value || "-")}</div>`)
    .join("");
}

function extraItemHeaders(ctx: any) {
  const s = ctx.s;
  return `${s.showBatch ? "<th>BATCH</th>" : ""}${s.showExpiry ? "<th>EXP.</th>" : ""}${s.showMfgDate ? "<th>MFG</th>" : ""}${(Array.isArray(s.itemCustomColumns) ? s.itemCustomColumns : [])
    .filter((c: any) => c && c.enabled !== false)
    .map((c: any) => `<th>${esc(c.name)}</th>`)
    .join("")}`;
}

function extraItemCells(ctx: any, row: any) {
  const s = ctx.s;
  const custom = (Array.isArray(s.itemCustomColumns) ? s.itemCustomColumns : [])
    .filter((c: any) => c && c.enabled !== false)
    .map((c: any) => `<td class="c">${esc(row[c.id] || row.customValues?.[c.name] || c.sampleValue || "")}</td>`)
    .join("");
  return `${s.showBatch ? `<td class="c">${esc(row.batchNumber || row.batch || "")}</td>` : ""}${s.showExpiry ? `<td class="c">${esc(row.expiryDate || row.exp || "")}</td>` : ""}${s.showMfgDate ? `<td class="c">${esc(row.mfgDate || row.mfg || "")}</td>` : ""}${custom}`;
}

function footerBlocks(ctx: any) {
  const c = ctx.c;
  const qrHtml = ctx.upiQrDataUrl
    ? `<div style="text-align:center;margin-left:14px;"><img src="${ctx.upiQrDataUrl}" alt="UPI QR" style="width:72px;height:72px;"/><div class="muted" style="font-size:8px;">Scan to Pay UPI</div></div>`
    : "";
  const bank =
    ctx.s.showBankDetails && (c.bankName || c.bankAccountNo)
      ? `<div style="display:flex;align-items:center;gap:12px;"><div><b>Bank Details</b><br/>${esc(c.bankName || "")}<br/>A/C: ${esc(c.bankAccountNo || "")}<br/>IFSC: ${esc(c.bankIfsc || "")}${c.upiVpa && ctx.s.showUpiQr ? `<br/>UPI: ${esc(c.upiVpa)}` : ""}</div>${qrHtml}</div>`
      : "";
  const sign = ctx.s.showSignature
    ? `<div style="text-align:right;margin-top:18px">${c.signatureUrl ? `<img src="${esc(c.signatureUrl)}" alt="sign" style="height:48px"/><br/>` : ""}${esc(c.signatoryName || "")}<div class="muted">${esc(c.signatoryDesignation || "Authorised Signatory")}</div></div>`
    : "";
  const receiver = ctx.s.enableReceiverSignature
    ? `<div style="margin-top:24px">Receiver's Signature ________________</div>`
    : "";
  return `${bank}${sign}${receiver}`;
}

function itemName(ctx: any, row: any) {
  const item = row.item || {};
  const desc =
    ctx.s.showItemDescription && row.description && row.description !== item.name
      ? `<div class="muted">${esc(row.description)}</div>`
      : "";
  return `${esc(item.name || row.description || "Item")}${desc}`;
}

function qtyCell(ctx: any, row: any) {
  const item = row.item || {};
  const uom = item.primaryUom?.symbol || "PCS";
  const alt = item.secondaryUom?.symbol;
  const extra =
    ctx.s.showAlternateUnit && alt && item.conversionFactor
      ? ` / ${qty(Number(row.quantity) / Number(item.conversionFactor))} ${esc(alt)}`
      : "";
  return `${qty(row.quantity)} ${esc(uom)}${extra}`;
}

function itemRowsTally(ctx: any, showLineTax = false) {
  return ctx.items
    .map((row: any, idx: number) => {
      const disc = Number(row.discountAmount || 0);
      const discPct = Number(row.discountPercent || 0);
      return `<tr>
        <td class="c">${idx + 1}</td>
        <td>${itemName(ctx, row)}</td>
        ${ctx.s.showHsn ? `<td class="c">${esc(row.hsnCode || row.item?.hsnCode || "")}</td>` : ""}
        ${ctx.s.showQuantity !== false ? `<td class="r">${qtyCell(ctx, row)}</td>` : ""}
        ${ctx.s.enableFreeItemQuantity ? `<td class="r">${qty(row.freeQuantity || 0)}</td>` : ""}
        ${ctx.s.showPricePerItem !== false ? `<td class="r">${money(row.unitPrice)}</td>` : ""}
        ${ctx.s.showDiscount ? `<td class="r">${disc ? `${money(disc)}<div class="muted">(${discPct}%)</div>` : "0"}</td>` : ""}
        ${showLineTax && ctx.s.showTaxColumn ? `<td class="r">${money(lineTax(row))}</td>` : ""}
        ${extraItemCells(ctx, row)}
        <td class="r">${money(row.totalAmount)}</td>
      </tr>`;
    })
    .join("");
}

function itemRowsOpen(ctx: any) {
  return ctx.items
    .map((row: any, idx: number) => {
      const disc = Number(row.discountAmount || 0);
      const discPct = Number(row.discountPercent || 0);
      const taxAmt = lineTax(row);
      const taxPct = Number(row.taxRate || 0);
      return `<tr>
        <td class="c">${idx + 1}</td>
        <td>${itemName(ctx, row)}</td>
        ${ctx.s.showHsn ? `<td class="c">${esc(row.hsnCode || row.item?.hsnCode || "")}</td>` : ""}
        ${ctx.s.showQuantity !== false ? `<td class="r">${qtyCell(ctx, row)}</td>` : ""}
        ${ctx.s.showPricePerItem !== false ? `<td class="r">${money(row.unitPrice)}</td>` : ""}
        ${ctx.s.showDiscount ? `<td class="r">${disc ? `${money(disc)}<div class="muted">(${discPct}%)</div>` : "0 <div class='muted'>(0%)</div>"}</td>` : ""}
        ${ctx.s.showTaxColumn ? `<td class="r">${money(taxAmt)}<div class="muted">(${taxPct}%)</div></td>` : ""}
        ${extraItemCells(ctx, row)}
        <td class="r">${money(Number(row.totalAmount || 0))}</td>
      </tr>`;
    })
    .join("");
}

function taxLines(ctx: any) {
  if (!ctx.s.showTaxBreakup) return "";
  if (ctx.intra) {
    return `<tr><td>SGST</td><td class="r">₹ ${money(ctx.inv.sgstAmount)}</td></tr>
            <tr><td>CGST</td><td class="r">₹ ${money(ctx.inv.cgstAmount)}</td></tr>`;
  }
  return `<tr><td>IGST</td><td class="r">₹ ${money(ctx.inv.igstAmount)}</td></tr>`;
}

function hsnTable(ctx: any, accent?: string) {
  const rows = ctx.hsnRows
    .map(
      (r: any) => `<tr>
        <td>${esc(r.hsn || "-")}</td>
        <td class="r">${money(r.taxable)}</td>
        <td class="c">${r.rate}%</td>
        <td class="r">${money(r.tax)}</td>
        <td class="r">${money(r.tax)}</td>
      </tr>`,
    )
    .join("");
  const totT = ctx.hsnRows.reduce((a: number, r: any) => a + r.taxable, 0);
  const totX = ctx.hsnRows.reduce((a: number, r: any) => a + r.tax, 0);
  const head = accent ? ` style="background:${accent};color:#fff"` : "";
  return `<table class="hsn">
    <thead><tr>
      <th${head}>HSN/SAC</th><th${head}>Taxable Value</th><th${head}>Rate</th><th${head}>Tax Amount</th><th${head}>Total Tax Amount</th>
    </tr></thead>
    <tbody>${rows}
      <tr class="tot"><td><b>Total</b></td><td class="r"><b>${money(totT)}</b></td><td></td><td class="r"><b>${money(totX)}</b></td><td class="r"><b>${money(totX)}</b></td></tr>
    </tbody>
  </table>`;
}

function rateBuckets(ctx: any) {
  const map = new Map<string, { label: string; tax: number }>();
  for (const row of ctx.items) {
    const rate = Number(row.taxRate || row.item?.taxRate || 0);
    const tax = lineTax(row);
    const label = ctx.intra ? `CGST + SGST @${rate}%` : `IGST @${rate}%`;
    const cur = map.get(label) || { label, tax: 0 };
    cur.tax += tax;
    map.set(label, cur);
  }
  return [...map.values()];
}

function tallyCss(s: any, layout: InvoiceLayout = "tally") {
  const color = s.accentColor || "#111111";
  const book = layout === "tallybook";
  const lite = layout === "lite";
  const gst = layout === "gst";
  const compact = layout === "compact";
  const border = lite ? "#c5ced9" : "#222";
  const headerBg = book || lite ? "#f4f4f5" : color;
  const headerFg = book || lite ? "#111" : "#fff";
  const pad = compact ? "3px 4px" : "6px 7px";
  return `
  .sheet { border: 1px solid ${border}; ${compact ? "font-size:11px;" : ""} }
  .topbar { display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid ${border}; padding:${compact ? "4px 8px" : "6px 10px"}; font-weight:700; ${gst ? `background:${color};color:#fff;` : ""} }
  .copy { font-weight:500; font-size:11px; letter-spacing:.04em; }
  .grid2 { display:grid; grid-template-columns: 1.15fr 1fr; }
  .cell { padding:${compact ? "6px 8px" : "10px 12px"}; border-bottom:1px solid ${border}; }
  .cell + .cell { border-left:1px solid ${border}; }
  .name { font-size:${compact ? "15px" : "20px"}; font-weight:800; }
  table.items, table.hsn { width:100%; border-collapse:collapse; }
  table.items th, table.items td, table.hsn th, table.hsn td { border:1px solid ${border}; padding:${pad}; vertical-align:top; }
  table.items th, table.hsn th { background:${headerBg}; color:${headerFg}; font-size:${compact ? "9px" : "11px"}; font-weight:700; }
  table.items tr.empty td { height:${compact ? "16px" : "26px"}; }
  table.items tr.rate td { font-size:11px; }
  table.hsn tr.tot td { background:#f8fafc; }
  .r { text-align:right; } .c { text-align:center; } .muted { color:#555; font-size:11px; }
  .split { display:grid; grid-template-columns: 1.2fr 0.8fr; }
  .split > div { padding:10px 12px; border-top:1px solid ${border}; }
  .split > div + div { border-left:1px solid ${border}; }
  ${lite ? `table.items td, table.items th { border-left:none; border-right:none; } table.items { border-top:1px solid ${border}; }` : ""}
  `;
}

function tallyColumnCount(ctx: any, showLineTax: boolean) {
  let n = 2;
  if (ctx.s.showHsn) n += 1;
  if (ctx.s.showQuantity !== false) n += 1;
  if (ctx.s.enableFreeItemQuantity) n += 1;
  if (ctx.s.showPricePerItem !== false) n += 1;
  if (ctx.s.showDiscount) n += 1;
  if (showLineTax && ctx.s.showTaxColumn) n += 1;
  if (ctx.s.showBatch) n += 1;
  if (ctx.s.showExpiry) n += 1;
  if (ctx.s.showMfgDate) n += 1;
  n += Array.isArray(ctx.s.itemCustomColumns)
    ? ctx.s.itemCustomColumns.filter((col: any) => col && col.enabled !== false).length
    : 0;
  return n + 1;
}

function tallyBody(ctx: any, layout: InvoiceLayout = "tally") {
  const c = ctx.c;
  const inv = ctx.inv;
  const party = ctx.party;
  const showLineTax = layout === "gst" || layout === "lite" || layout === "compact";
  const stretch =
    layout === "tally" ||
    layout === "tallybook" ||
    layout === "compact" ||
    (layout === "gst" && ctx.s.stretchItemTable);
  const cols = tallyColumnCount(ctx, showLineTax);
  const empty = stretch
    ? Array.from({ length: layout === "compact" ? 3 : 7 })
        .map(() => `<tr class="empty">${Array.from({ length: cols }, () => "<td></td>").join("")}</tr>`)
        .join("")
    : "";
  const rates = (ctx.s.showTaxBreakup !== false ? rateBuckets(ctx) : [])
    .map(
      (r) => `<tr class="rate"><td colspan="${cols - 1}" class="r">${esc(r.label)}</td><td class="r">${money(r.tax)}</td></tr>`,
    )
    .join("");
  const taxTotal = Number(inv.cgstAmount || 0) + Number(inv.sgstAmount || 0) + Number(inv.igstAmount || 0);
  return `<div class="sheet">
    <div class="topbar"><span>${esc(ctx.docTitle)}</span><span class="copy">${esc(ctx.copyLabel)}</span></div>
    <div class="grid2">
      <div class="cell">
        <div class="name">${esc(c.tradeName || c.legalName)}</div>
        <div>${esc([c.addressLine1, c.city, c.pincode].filter(Boolean).join(", "))}</div>
        ${ctx.s.showPhoneNumber ? `<div>Mobile: ${esc(c.phone || "")}</div>` : ""}
        ${ctx.s.showGstin && c.gstin ? `<div>GSTIN: ${esc(c.gstin)}</div>` : ""}
      </div>
      <div class="cell">
        <div><b>Invoice No.</b><br/>${esc(inv.invoiceNumber || "-")}</div>
        <div style="margin-top:8px"><b>Invoice Date</b><br/>${esc(formatDate(inv.invoiceDate))}</div>
        ${ctx.s.showDueDate && inv.dueDate ? `<div style="margin-top:8px"><b>Due Date</b><br/>${esc(formatDate(inv.dueDate))}</div>` : ""}
        ${ctx.s.showPoNumber && inv.poNumber ? `<div style="margin-top:8px"><b>PO No.</b><br/>${esc(inv.poNumber)}</div>` : ""}
        ${ctx.s.showEwayBillNumber && inv.ewayBillNumber ? `<div style="margin-top:8px"><b>e-Way Bill</b><br/>${esc(inv.ewayBillNumber)}</div>` : ""}
        ${ctx.s.showVehicleNumber && inv.vehicleNumber ? `<div style="margin-top:8px"><b>Vehicle</b><br/>${esc(inv.vehicleNumber)}</div>` : ""}
        ${invoiceMetaExtras(ctx)}
      </div>
    </div>
    <div class="grid2">
      <div class="cell">
        <b>BILL TO</b>
        <div>${esc(party.name || "Cash Customer")}</div>
        <div>${esc(addr(ctx.billing))}</div>
        ${ctx.s.showGstin && party.gstin ? `<div>GSTIN: ${esc(party.gstin)}</div>` : ""}
        ${ctx.s.showPhoneNumber && party.phone ? `<div>Mobile: ${esc(party.phone)}</div>` : ""}
        ${ctx.s.showPartyBalance ? `<div>Balance: ₹ ${money(party.currentBalance ?? ctx.balance)}</div>` : ""}
        ${partyCustomHtml(ctx)}
      </div>
      <div class="cell">
        <b>Address</b>
        <div>${esc(ctx.s.showShippingAddress ? addr(ctx.shipping) || addr(ctx.billing) : addr(ctx.billing))}</div>
        ${ctx.s.showPlaceOfSupply ? `<div>Place of Supply: ${esc(inv.placeOfSupply || c.stateCode || "")}</div>` : ""}
      </div>
    </div>
    <table class="items">
      <thead><tr>
        <th>S.NO.</th><th>ITEMS</th>
        ${ctx.s.showHsn ? "<th>HSN</th>" : ""}
        ${ctx.s.showQuantity !== false ? "<th>QTY.</th>" : ""}
        ${ctx.s.enableFreeItemQuantity ? "<th>FREE</th>" : ""}
        ${ctx.s.showPricePerItem !== false ? "<th>RATE</th>" : ""}
        ${ctx.s.showDiscount ? "<th>DISC.</th>" : ""}
        ${showLineTax && ctx.s.showTaxColumn ? "<th>TAX</th>" : ""}
        ${extraItemHeaders(ctx)}
        <th>AMOUNT</th>
      </tr></thead>
      <tbody>${itemRowsTally(ctx, showLineTax)}
        ${empty}
        ${rates}
        <tr>
          <td colspan="${2 + (ctx.s.showHsn ? 1 : 0)}"><b>TOTAL</b></td>
          ${ctx.s.showQuantity !== false ? `<td class="r"><b>${qty(ctx.totalQty)}</b></td>` : ""}
          ${ctx.s.enableFreeItemQuantity ? "<td></td>" : ""}
          ${ctx.s.showPricePerItem !== false ? "<td></td>" : ""}
          ${ctx.s.showDiscount ? `<td class="r">${money(inv.discountTotal)}</td>` : ""}
          ${showLineTax && ctx.s.showTaxColumn ? `<td class="r">${money(taxTotal)}</td>` : ""}
          ${extraItemHeaders(ctx).replace(/<th>[^<]*<\/th>/g, "<td></td>")}
          <td class="r"><b>₹ ${money(inv.grandTotal)}</b></td>
        </tr>
      </tbody>
    </table>
    ${ctx.s.showTaxBreakup ? hsnTable(ctx, layout === "tallybook" || layout === "lite" ? undefined : ctx.color) : ""}
    <div class="split">
      <div>
        ${ctx.s.showAmountInWords ? `<div><b>Total Amount (in words):</b><br/>${esc(amountInWords(Number(inv.grandTotal || 0)))}</div>` : ""}
        ${ctx.s.showNotes && inv.notes ? `<div style="margin-top:8px"><b>Notes</b><br/>${esc(inv.notes)}</div>` : ""}
      </div>
      <div>
        ${ctx.s.showTerms && ctx.terms ? `<div><b>Terms and Conditions</b><br/>${esc(ctx.terms)}</div>` : ""}
        ${ctx.s.showReceivedAmount ? `<div style="margin-top:8px">Received Amount: ₹ ${money(ctx.received)}</div>` : ""}
        ${footerBlocks(ctx)}
      </div>
    </div>
  </div>`;
}

function luxuryCss(s: any) {
  const color = s.accentColor || "#C9A227";
  return `
  .sheet { border: 10px double ${color}; padding: 18px 22px; position: relative; }
  .lux-head { display:flex; justify-content:space-between; align-items:flex-start; }
  .name { font-family: Georgia, serif; font-size: 28px; color:${color}; font-weight:700; }
  .badge { text-align:right; }
  .badge .title { font-size:18px; font-weight:800; letter-spacing:1px; }
  .badge .copy { font-size:10px; color:#888; }
  .meta { display:flex; gap:28px; margin:18px 0 10px; font-size:13px; }
  .party { display:flex; justify-content:space-between; margin-bottom:12px; }
  table.items { width:100%; border-collapse:collapse; }
  table.items th { border-bottom:1px solid ${color}; text-align:left; padding:8px 4px; font-size:12px; color:${color}; }
  table.items td { padding:10px 4px; border-bottom:1px solid #eee; vertical-align:top; }
  .r { text-align:right; } .c { text-align:center; } .muted { color:#777; font-size:11px; }
  .sub { display:flex; justify-content:flex-end; gap:24px; padding:10px 0; font-weight:700; }
  .bottom { display:grid; grid-template-columns: 1.1fr 0.9fr; gap:20px; margin-top:16px; }
  .words { margin-top:18px; color:${color}; }
  `;
}

function luxuryBody(ctx: any) {
  const c = ctx.c;
  const inv = ctx.inv;
  const party = ctx.party;
  const taxTotal = Number(inv.cgstAmount || 0) + Number(inv.sgstAmount || 0) + Number(inv.igstAmount || 0);
  return `<div class="sheet">
    <div class="lux-head">
      <div>
        <div class="name">${esc(c.tradeName || c.legalName)}</div>
        ${ctx.s.showPhoneNumber ? `<div>${ctx.phoneIcon}${esc(c.phone || "")}</div>` : ""}
        <div>${ctx.locIcon}${esc(c.city || "")}${c.stateCode ? ", " + esc(c.stateCode) : ""}</div>
      </div>
      <div class="badge">
        <div class="title">${esc(ctx.docTitle)}</div>
        <div class="copy">${esc(ctx.copyLabel)}</div>
      </div>
    </div>
    <div class="meta">
      <div><b>Invoice No.</b><br/>${esc(inv.invoiceNumber || "-")}</div>
      <div><b>Invoice Date</b><br/>${esc(formatDate(inv.invoiceDate))}</div>
      ${ctx.s.showDueDate && inv.dueDate ? `<div><b>Due Date</b><br/>${esc(formatDate(inv.dueDate))}</div>` : ""}
      ${ctx.s.showPoNumber && inv.poNumber ? `<div><b>PO No.</b><br/>${esc(inv.poNumber)}</div>` : ""}
      ${invoiceMetaExtras(ctx)}
    </div>
    <div class="party">
      <div>
        <b>Bill To</b>
        <div>${esc(party.name || "Cash Customer")}</div>
        <div class="muted">${esc(addr(ctx.billing))}</div>
        ${ctx.s.showPhoneNumber && party.phone ? `<div>Mobile : ${esc(party.phone)}</div>` : ""}
        ${ctx.s.showGstin && party.gstin ? `<div>GSTIN : ${esc(party.gstin)}</div>` : ""}
      </div>
      <div class="muted" style="text-align:right">${esc(ctx.s.showShippingAddress ? addr(ctx.shipping) || addr(ctx.billing) : "")}</div>
    </div>
    <table class="items">
      <thead><tr>
        <th>#</th><th>Items</th>
        ${ctx.s.showHsn ? "<th>HSN No.</th>" : ""}
        ${ctx.s.showQuantity !== false ? '<th class="r">Qty</th>' : ""}
        ${ctx.s.showPricePerItem !== false ? '<th class="r">Rate</th>' : ""}
        ${ctx.s.showDiscount ? '<th class="r">Disc.</th>' : ""}
        ${ctx.s.showTaxColumn ? '<th class="r">Tax</th>' : ""}
        ${extraItemHeaders(ctx)}
        <th class="r">Total</th>
      </tr></thead>
      <tbody>${itemRowsOpen(ctx)}</tbody>
    </table>
    <div class="sub">
      <span>SUBTOTAL &nbsp; ${qty(ctx.totalQty)}</span>
      <span>₹ ${money(inv.subTotal)}</span>
      <span>₹ ${money(taxTotal)}</span>
      <span>₹ ${money(inv.grandTotal)}</span>
    </div>
    <div class="bottom">
      <div>
        ${ctx.s.showNotes && inv.notes ? `<div><b>Notes:</b> ${esc(inv.notes)}</div>` : ""}
        ${ctx.s.showTerms && ctx.terms ? `<div style="margin-top:10px"><b>Terms &amp; Conditions</b><br/>${esc(ctx.terms)}</div>` : ""}
      </div>
      <div>
        <div>Taxable Amount <span style="float:right">₹ ${money(inv.taxableAmount || inv.subTotal)}</span></div>
        ${taxLines(ctx)}
        <div style="margin-top:8px"><b>Total Amount</b> <span style="float:right"><b>₹ ${money(inv.grandTotal)}</b></span></div>
        ${ctx.s.showReceivedAmount ? `<div>Received Amount <span style="float:right">₹ ${money(ctx.received)}</span></div>` : ""}
      </div>
    </div>
    ${ctx.s.showAmountInWords ? `<div class="words"><b>Total Amount (in words)</b><br/>${esc(amountInWords(Number(inv.grandTotal || 0)))}</div>` : ""}
  </div>`;
}

function stylishCss(s: any, layout: InvoiceLayout = "stylish") {
  const color = s.accentColor || "#111";
  const simple = layout === "simple";
  const modern = layout === "modern";
  const bill = layout === "billbook";
  return `
  .sheet { padding: 22px 26px; position:relative; ${modern ? `border-left:10px solid ${color};` : ""} ${bill ? "padding-bottom:64px;" : ""} }
  .stamp { display:inline-block; border:1px solid #222; padding:3px 8px; font-size:11px; font-weight:700; }
  .name { font-size:${simple ? "18px" : bill ? "30px" : "22px"}; font-weight:${simple ? "600" : "800"}; margin-top:10px; color:${simple ? "#111" : color}; ${bill ? "letter-spacing:-0.03em;" : ""} }
  .meta { display:flex; gap:28px; margin:14px 0; font-size:13px; ${modern ? `background:${color};color:#fff;border-radius:10px;padding:10px 14px;` : ""} }
  .party { display:flex; justify-content:space-between; margin-bottom:8px; }
  table.items { width:100%; border-collapse:collapse; }
  table.items th { border-bottom:${simple ? "1px solid #d4d4d8" : "2px solid #111"}; text-align:left; padding:8px 4px; font-size:11px; color:${simple ? "#52525b" : "#111"}; font-weight:${simple ? "600" : "700"}; }
  table.items td { padding:${simple ? "7px 4px" : "10px 4px"}; border-bottom:1px solid ${simple ? "#f4f4f5" : "#e5e5e5"}; vertical-align:top; }
  .r { text-align:right; } .c { text-align:center; } .muted { color:#777; font-size:11px; }
  .sub { display:flex; justify-content:flex-end; gap:22px; border-top:1px solid #111; padding:10px 0; font-weight:700; }
  .bottom { display:grid; grid-template-columns: 1fr 1fr; gap:24px; margin-top:16px; }
  .words { margin-top:20px; text-align:right; }
  .footbar { position:absolute; left:0; right:0; bottom:0; background:${color}; color:#fff; text-align:center; padding:10px 12px; font-size:11px; letter-spacing:.08em; }
  .logo-mark { width:42px; height:42px; border-radius:10px; background:${color}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; margin-bottom:6px; }
  `;
}

function stylishBody(ctx: any, layout: InvoiceLayout = "stylish") {
  const c = ctx.c;
  const inv = ctx.inv;
  const party = ctx.party;
  const taxTotal = Number(inv.cgstAmount || 0) + Number(inv.sgstAmount || 0) + Number(inv.igstAmount || 0);
  const initial = esc(String(c.tradeName || c.legalName || "B").slice(0, 1));
  const logo =
    layout === "billbook"
      ? ctx.s.logoUrl
        ? `<img class="logo-mark" src="${esc(ctx.s.logoUrl)}" alt="logo" style="object-fit:cover"/>`
        : `<div class="logo-mark">${initial}</div>`
      : "";
  return `<div class="sheet ${esc(layout)}">
    ${logo}
    ${layout === "simple" ? "" : `<div class="stamp">${esc(ctx.docTitle)} &nbsp; ${esc(ctx.copyLabel)}</div>`}
    <div class="name">${esc(c.tradeName || c.legalName)}</div>
    <div class="muted">${esc(c.city || "")}${c.stateCode ? " · " + esc(c.stateCode) : ""}</div>
    ${ctx.s.showPhoneNumber ? `<div>Mobile: ${esc(c.phone || "")}</div>` : ""}
    <div class="meta">
      <div><b>Invoice No :</b> ${esc(inv.invoiceNumber || "-")}</div>
      <div><b>Invoice Date :</b> ${esc(formatDate(inv.invoiceDate))}</div>
      ${ctx.s.showDueDate && inv.dueDate ? `<div><b>Due Date :</b> ${esc(formatDate(inv.dueDate))}</div>` : ""}
      ${ctx.s.showPoNumber && inv.poNumber ? `<div><b>PO No :</b> ${esc(inv.poNumber)}</div>` : ""}
      ${invoiceMetaExtras(ctx)}
    </div>
    <div class="party">
      <div>
        <b>BILL TO</b>
        <div>${esc(party.name || "Cash Customer")}</div>
        <div class="muted">${esc(addr(ctx.billing))}</div>
        ${ctx.s.showPhoneNumber && party.phone ? `<div>Mobile: ${esc(party.phone)}</div>` : ""}
        ${ctx.s.showGstin && party.gstin ? `<div>GSTIN: ${esc(party.gstin)}</div>` : ""}
      </div>
      <div class="muted">${esc(ctx.s.showShippingAddress ? addr(ctx.shipping) || addr(ctx.billing) : "")}</div>
    </div>
    <table class="items">
      <thead><tr>
        <th></th><th>ITEMS</th>
        ${ctx.s.showHsn ? "<th>HSN</th>" : ""}
        ${ctx.s.showQuantity !== false ? '<th class="r">QTY.</th>' : ""}
        ${ctx.s.showPricePerItem !== false ? '<th class="r">RATE</th>' : ""}
        ${ctx.s.showDiscount ? '<th class="r">DISC.</th>' : ""}
        ${ctx.s.showTaxColumn ? '<th class="r">TAX</th>' : ""}
        ${extraItemHeaders(ctx)}
        <th class="r">AMOUNT</th>
      </tr></thead>
      <tbody>${itemRowsOpen(ctx)}</tbody>
    </table>
    <div class="sub">
      <span>SUBTOTAL</span><span>${qty(ctx.totalQty)}</span>
      <span>₹ ${money(inv.subTotal)}</span>
      <span>₹ ${money(taxTotal)}</span>
      <span>₹ ${money(inv.grandTotal)}</span>
    </div>
    <div class="bottom">
      <div>
        ${ctx.s.showNotes && inv.notes ? `<div><b>NOTES</b><br/>${esc(inv.notes)}</div>` : ""}
        ${ctx.s.showTerms && ctx.terms ? `<div style="margin-top:10px"><b>TERMS AND CONDITIONS</b><br/>${esc(ctx.terms)}</div>` : ""}
      </div>
      <div>
        <div>Taxable Amount <span style="float:right">₹ ${money(inv.taxableAmount || inv.subTotal)}</span></div>
        ${taxLines(ctx)}
        <div style="margin-top:8px"><b>Total Amount</b> <span style="float:right"><b>₹ ${money(inv.grandTotal)}</b></span></div>
        ${ctx.s.showReceivedAmount ? `<div>Received Amount <span style="float:right">₹ ${money(ctx.received)}</span></div>` : ""}
      </div>
    </div>
    ${ctx.s.showAmountInWords ? `<div class="words"><b>Total Amount (in words)</b><br/>${esc(amountInWords(Number(inv.grandTotal || 0)))}</div>` : ""}
    ${layout === "billbook" ? `<div class="footbar">TAX INVOICE · ${esc(c.tradeName || c.legalName || "")}</div>` : ""}
  </div>`;
}

function festivalMotif(motif: string, ink: string) {
  if (motif === "dots") {
    return `<div class="band">${["#E11D48", "#F97316", "#EAB308", "#22C55E", "#0EA5E9", "#6366F1", "#A855F7", "#EC4899", "#F43F5E"].map((c) => `<span style="background:${c}"></span>`).join("")}</div>`;
  }
  if (motif === "diya") {
    return `<div class="diyas">${Array.from({ length: 7 }, () => `<i style="border-color:${ink}"></i>`).join("")}</div>`;
  }
  if (motif === "kites") {
    return `<div class="kites"><b></b><b></b><b></b><b></b></div>`;
  }
  if (motif === "coins") {
    return `<div class="coins"><b>₹</b><b>₹</b><b>₹</b><b>₹</b><b>₹</b></div>`;
  }
  if (motif === "arch") {
    return `<div class="arch" style="border-color:${ink}"></div>`;
  }
  if (motif === "bow") {
    return `<div class="bow">🏹</div>`;
  }
  if (motif === "flag") {
    return `<div class="flag"><span></span><span></span><span></span></div>`;
  }
  if (motif === "modak") {
    return `<div class="coins"><b>ॐ</b><b>ॐ</b><b>ॐ</b></div>`;
  }
  return "";
}

function festiveTaxLines(ctx: any) {
  if (ctx.intra) {
    return `<div class="fest-total-line"><span>SGST</span> <b>₹ ${money(ctx.inv.sgstAmount)}</b></div>
            <div class="fest-total-line"><span>CGST</span> <b>₹ ${money(ctx.inv.cgstAmount)}</b></div>`;
  }
  return `<div class="fest-total-line"><span>IGST</span> <b>₹ ${money(ctx.inv.igstAmount)}</b></div>`;
}

function festivalCss(s: any) {
  const skin = festiveSkin(s.themeId || s.festiveTheme || "navratri");
  const accent = s.accentColor && s.accentColor !== "#111111" ? s.accentColor : skin.ink;
  return `
  .sheet {
    position: relative;
    width: 210mm;
    height: 297mm;
    min-height: 297mm;
    max-height: 297mm;
    margin: 0 auto;
    padding: 6mm 8mm 4mm 8mm;
    background: #ffffff;
    box-sizing: border-box;
    overflow: hidden;
  }
  @media print {
    body { background: #fff; margin: 0; padding: 0; }
    .sheet { margin: 0 !important; border: none !important; padding: 6mm 8mm 4mm 8mm !important; box-shadow: none !important; width: 210mm !important; height: 297mm !important; min-height: 297mm !important; max-height: 297mm !important; }
  }
  .festive-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 210mm;
    height: 297mm;
    pointer-events: none;
    overflow: hidden;
    z-index: 0;
  }
  .festive-bg img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center top;
    opacity: 0.18;
  }
  .festive-content {
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    height: 100%;
    min-height: calc(297mm - 10mm);
    max-height: calc(297mm - 10mm);
  }
  .fest-top-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }
  .fest-doc-title {
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 0.04em;
  }
  .fest-copy-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 2px 6px;
    border: 1px solid #64748b;
    border-radius: 2px;
    background: rgba(255,255,255,0.9);
    margin-left: 6px;
    text-transform: uppercase;
  }
  .fest-status-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 2px;
    margin-left: 4px;
    text-transform: uppercase;
  }
  .fest-status-badge.paid { background: #dcfce7; color: #15803d; }
  .fest-status-badge.partially_paid { background: #fef3c7; color: #b45309; }
  .fest-status-badge.issued { background: #e0f2fe; color: #0369a1; }
  .fest-subgreeting {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #78350f;
  }
  .fest-outer-box {
    border: 1px solid #111111;
    border-radius: 1px;
    background: transparent;
    display: flex;
    flex-direction: column;
    flex: 1;
    justify-content: space-between;
    margin-bottom: 3px;
  }
  .fest-grid-2 {
    display: grid;
    grid-template-columns: 1.15fr 0.85fr;
  }
  .fest-border-b { border-bottom: 1px solid #111111; }
  .fest-border-t { border-top: 1px solid #111111; }
  .fest-border-r { border-right: 1px solid #111111; }
  .fest-cell-left, .fest-cell-right {
    padding: 7px 10px;
    font-size: 11px;
    line-height: 1.35;
  }
  .fest-company-name {
    font-size: 18px;
    font-weight: 900;
    color: #0f172a;
    letter-spacing: -0.01em;
  }
  .fest-section-label {
    font-size: 9px;
    font-weight: 800;
    text-transform: uppercase;
    color: #475569;
    letter-spacing: 0.05em;
    margin-bottom: 2px;
  }
  .fest-party-name {
    font-size: 13px;
    font-weight: 800;
    color: #0f172a;
  }
  .fest-meta-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 2px;
  }
  table.fest-items-table {
    width: 100%;
    border-collapse: collapse;
    background: transparent;
  }
  table.fest-items-table th {
    padding: 5px 6px;
    font-size: 10px;
    font-weight: 800;
    border-right: 1px solid rgba(255,255,255,0.3);
    border-bottom: 1px solid #111;
    text-align: left;
  }
  table.fest-items-table th:last-child { border-right: none; }
  table.fest-items-table td {
    padding: 5px 6px;
    font-size: 11px;
    border-bottom: 1px solid #e2e8f0;
    border-right: 1px solid #cbd5e1;
    background: transparent;
    vertical-align: top;
  }
  table.fest-items-table td:last-child { border-right: none; }
  table.fest-tax-table {
    width: 100%;
    border-collapse: collapse;
    border-top: 1px solid #111111;
    background: transparent;
  }
  table.fest-tax-table th {
    padding: 4px 6px;
    font-size: 9px;
    font-weight: 700;
    text-align: left;
    background: rgba(0,0,0,0.04);
    border-bottom: 1px solid #cbd5e1;
  }
  table.fest-tax-table td {
    padding: 3px 6px;
    font-size: 10px;
    border-bottom: 1px solid #e2e8f0;
  }
  table.fest-tax-table tr.total-row td {
    font-weight: 800;
    border-top: 1px solid #cbd5e1;
    border-bottom: none;
    background: rgba(0,0,0,0.02);
  }
  .fest-total-line {
    display: flex;
    justify-content: space-between;
    padding: 1.5px 0;
    font-size: 11px;
  }
  .fest-total-line.grand-total {
    font-size: 13px;
    font-weight: 800;
    border-top: 1px solid #111111;
    border-bottom: 1px solid #111111;
    padding: 4px 0;
    margin: 3px 0;
  }
  .fest-sign-block {
    text-align: right;
    margin-top: 14px;
    padding-top: 4px;
    font-size: 11px;
  }
  .fest-footer-wish {
    text-align: center;
    font-size: 11px;
    font-weight: 700;
    padding: 8px 4px 2px;
    letter-spacing: 0.02em;
  }
  .fest-qr-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px dashed #cbd5e1;
  }
  `;
}

function festiveFillerRows(ctx: any) {
  const hasHsn = ctx.s.showTaxBreakup !== false && (ctx.hsnRows || []).length > 0;
  const targetRows = hasHsn ? 15 : 17;
  const count = (ctx.items || []).length;
  const needed = Math.max(0, targetRows - count);
  if (needed === 0) return "";
  let cols = 2; // #, ITEMS
  if (ctx.s.showHsn !== false) cols++;
  if (ctx.s.showQuantity !== false) cols++;
  if (ctx.s.showPricePerItem !== false) cols++;
  if (ctx.s.showDiscount) cols++;
  if (ctx.s.showTaxColumn !== false) cols++;
  if (ctx.s.showBatch) cols++;
  if (ctx.s.showExpiry) cols++;
  if (ctx.s.showMfgDate) cols++;
  if (Array.isArray(ctx.s.itemCustomColumns)) {
    cols += ctx.s.itemCustomColumns.filter((c: any) => c && c.enabled !== false).length;
  }
  cols++; // AMOUNT

  return Array.from({ length: needed })
    .map(
      () =>
        `<tr style="height:27px;"><td class="c" style="border-bottom:1px solid #e2e8f0; border-right:1px solid #cbd5e1; background:transparent;">&nbsp;</td>${Array.from({ length: cols - 1 }, (_, i) => `<td style="border-bottom:1px solid #e2e8f0; border-right:${i === cols - 2 ? "none" : "1px solid #cbd5e1"}; background:transparent;">&nbsp;</td>`).join("")}</tr>`,
    )
    .join("");
}

function festivalBody(ctx: any) {
  const themeKey = ctx.s.themeId || ctx.s.festiveTheme || "navratri";
  const skin = festiveSkin(themeKey);
  const accent = ctx.s.accentColor && ctx.s.accentColor !== "#111111" ? ctx.s.accentColor : skin.ink;
  const bgFile = skin.bgFile || "navaratri_1.jpg";
  const bgDataUri = getThemeBase64Image(bgFile);

  const c = ctx.c;
  const inv = ctx.inv;
  const party = ctx.party;

  const logo = ctx.s.logoUrl
    ? `<div style="margin-bottom:6px;"><img src="${esc(ctx.s.logoUrl)}" alt="logo" style="max-height:48px;max-width:120px;"/></div>`
    : "";

  const bankHtml =
    ctx.s.showBankDetails !== false && (c.bankName || c.bankAccountNo || c.upiVpa)
      ? `<div class="fest-qr-row">
          <div>
            <div class="fest-section-label">BANK & PAYMENT DETAILS:</div>
            ${c.bankName ? `<div><b>Bank:</b> ${esc(c.bankName)}</div>` : ""}
            ${c.bankAccountNo ? `<div><b>A/C No:</b> ${esc(c.bankAccountNo)}</div>` : ""}
            ${c.bankIfsc ? `<div><b>IFSC:</b> ${esc(c.bankIfsc)}</div>` : ""}
            ${c.upiVpa ? `<div><b>UPI:</b> ${esc(c.upiVpa)}</div>` : ""}
          </div>
          ${ctx.upiQrDataUrl ? `
            <div style="text-align:center; margin-left:auto;">
              <img src="${ctx.upiQrDataUrl}" alt="UPI QR" style="width:72px;height:72px;border:1px solid #cbd5e1;padding:2px;background:#fff;"/><br/>
              <span class="muted" style="font-size:8px;font-weight:bold;">Scan to Pay UPI</span>
            </div>
          ` : ""}
        </div>`
      : "";

  return `<div class="sheet">
    ${bgDataUri ? `<div class="festive-bg"><img src="${bgDataUri}" alt="Festive Theme"/></div>` : ""}

    <div class="festive-content">
      <!-- Top Header Row -->
      <div class="fest-top-bar">
        <div>
          <span class="fest-doc-title" style="color:${accent};">${esc(ctx.docTitle)}</span>
          <span class="fest-copy-badge">${esc(ctx.copyLabel)}</span>
          ${inv.status ? `<span class="fest-status-badge ${String(inv.status).toLowerCase()}">${esc(inv.status)}</span>` : ""}
        </div>
        <div class="fest-subgreeting">${esc(skin.subGreeting || skin.title)}</div>
      </div>

      <!-- Outer Boxed Table Container matching myBillBook -->
      <div class="fest-outer-box">
          <!-- Row 1: Company Details & Invoice Metadata -->
          <div class="fest-grid-2 fest-border-b">
            <div class="fest-cell-left fest-border-r">
              ${logo}
              <div class="fest-company-name">${esc(c.tradeName || c.legalName || "My Company")}</div>
              <div>${esc([c.addressLine1, c.addressLine2, c.city, c.pincode].filter(Boolean).join(", "))}</div>
              ${ctx.s.showPhoneNumber !== false && c.phone ? `<div>Mobile: <b>${esc(c.phone)}</b></div>` : ""}
              ${ctx.s.showGstin !== false && c.gstin ? `<div>GSTIN: <b>${esc(c.gstin)}</b></div>` : ""}
              ${c.pan ? `<div>PAN: <b>${esc(c.pan)}</b></div>` : ""}
              <div>State: ${esc(c.state || "Gujarat")} (Code: ${esc(c.stateCode || "24")})</div>
            </div>

            <div class="fest-cell-right">
              <div class="fest-meta-row"><span class="muted">Invoice No.:</span> <b style="font-family:monospace;">#${esc(inv.invoiceNumber || "-")}</b></div>
              <div class="fest-meta-row"><span class="muted">Invoice Date:</span> <b>${esc(formatDate(inv.invoiceDate))}</b></div>
              ${ctx.s.showDueDate !== false && inv.dueDate ? `<div class="fest-meta-row"><span class="muted">Due Date:</span> <b>${esc(formatDate(inv.dueDate))}</b></div>` : ""}
              ${ctx.s.showPlaceOfSupply !== false ? `<div class="fest-meta-row"><span class="muted">Place of Supply:</span> <b>${esc(inv.placeOfSupply || c.stateCode || "24")}</b></div>` : ""}
              ${ctx.s.showPoNumber && inv.poNumber ? `<div class="fest-meta-row"><span class="muted">PO No.:</span> <b>${esc(inv.poNumber)}</b></div>` : ""}
              ${ctx.s.showEwayBillNumber && inv.ewayBillNumber ? `<div class="fest-meta-row"><span class="muted">e-Way Bill:</span> <b>${esc(inv.ewayBillNumber)}</b></div>` : ""}
              ${ctx.s.showVehicleNumber && inv.vehicleNumber ? `<div class="fest-meta-row"><span class="muted">Vehicle:</span> <b>${esc(inv.vehicleNumber)}</b></div>` : ""}
              ${invoiceMetaExtras(ctx)}
            </div>
          </div>

          <!-- Row 2: DETAILS OF RECEIVER (BILLED TO) & SHIP TO / DELIVERY -->
          <div class="fest-grid-2 fest-border-b">
            <div class="fest-cell-left fest-border-r">
              <div class="fest-section-label">DETAILS OF RECEIVER (BILLED TO)</div>
              <div class="fest-party-name">${esc(party.name || "Cash Customer")}</div>
              <div>${esc(addr(ctx.billing))}</div>
              ${ctx.s.showPhoneNumber !== false && party.phone ? `<div>Mobile: <b>${esc(party.phone)}</b></div>` : ""}
              ${ctx.s.showGstin !== false && party.gstin ? `<div>GSTIN: <b>${esc(party.gstin)}</b></div>` : ""}
              ${party.stateCode ? `<div>State: ${esc(party.state || "")} (Code: ${esc(party.stateCode)})</div>` : ""}
              ${ctx.s.showPartyBalance ? `<div>Balance: ₹ ${money(party.currentBalance ?? ctx.balance)}</div>` : ""}
              ${partyCustomHtml(ctx)}
            </div>

            <div class="fest-cell-right">
              <div class="fest-section-label">SHIP TO / DELIVERY</div>
              <div>${esc(ctx.s.showShippingAddress ? addr(ctx.shipping) || addr(ctx.billing) : addr(ctx.billing))}</div>
              ${inv.paymentMode ? `<div style="margin-top:4px;"><span class="muted">Payment Mode:</span> <b>${esc(inv.paymentMode)}</b></div>` : ""}
            </div>
          </div>

          <!-- Row 3: Items Table -->
          <table class="fest-items-table">
            <thead>
              <tr style="background:${skin.ink}; color:#ffffff;">
                <th class="c" style="width:36px;">#</th>
                <th>ITEMS</th>
                ${ctx.s.showHsn !== false ? '<th class="c" style="width:70px;">HSN</th>' : ""}
                ${ctx.s.showQuantity !== false ? '<th class="r" style="width:80px;">QTY</th>' : ""}
                ${ctx.s.showPricePerItem !== false ? '<th class="r" style="width:80px;">RATE</th>' : ""}
                ${ctx.s.showDiscount ? '<th class="r" style="width:70px;">DISC</th>' : ""}
                ${ctx.s.showTaxColumn !== false ? '<th class="r" style="width:90px;">TAX</th>' : ""}
                ${extraItemHeaders(ctx)}
                <th class="r" style="width:95px;">AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              ${itemRowsOpen(ctx)}
              ${festiveFillerRows(ctx)}
            </tbody>
          </table>

          <!-- Row 4: Statutory GST Tax Summary Table -->
          ${ctx.s.showTaxBreakup !== false ? hsnTable(ctx, skin.ink) : ""}

          <!-- Row 5: Bottom Split (Notes, Bank & Totals) -->
          <div class="fest-grid-2 fest-border-t">
            <div class="fest-cell-left fest-border-r" style="display:flex; flex-direction:column; justify-content:space-between;">
              <div>
                ${ctx.s.showAmountInWords !== false ? `<div><span class="fest-section-label">Amount in words:</span><br/><b>${esc(amountInWords(Number(inv.grandTotal || 0)))}</b></div>` : ""}
                ${ctx.s.showNotes !== false && inv.notes ? `<div style="margin-top:8px;"><span class="fest-section-label">Notes:</span><br/>${esc(inv.notes)}</div>` : ""}
                ${ctx.s.showTerms !== false && ctx.terms ? `<div style="margin-top:8px;"><span class="fest-section-label">Terms and Conditions:</span><br/><span style="font-size:10px;color:#334155;">${esc(ctx.terms)}</span></div>` : ""}
              </div>

              ${bankHtml}
            </div>

            <div class="fest-cell-right" style="display:flex; flex-direction:column; justify-content:space-between;">
              <div>
                <div class="fest-total-line"><span>Taxable Amount</span> <b>₹ ${money(inv.taxableAmount || inv.subTotal)}</b></div>
                ${festiveTaxLines(ctx)}
                ${Number(inv.roundOff || 0) !== 0 ? `<div class="fest-total-line"><span>Round Off</span> <b>₹ ${money(inv.roundOff)}</b></div>` : ""}
                <div class="fest-total-line grand-total" style="color:${accent};">
                  <span>Invoice Grand Total</span>
                  <span>₹ ${money(inv.grandTotal)}</span>
                </div>
                ${ctx.s.showReceivedAmount !== false ? `
                  <div class="fest-total-line"><span>Amount Received</span> <b>₹ ${money(ctx.received)}</b></div>
                  <div class="fest-total-line"><span>Balance Due</span> <b style="color:${ctx.balance > 0 ? '#b91c1c' : '#15803d'};">₹ ${money(ctx.balance)}</b></div>
                ` : ""}
              </div>

              <div class="fest-sign-block">
                ${c.signatureUrl ? `<img src="${esc(c.signatureUrl)}" alt="Signature" style="height:44px;margin-bottom:4px;"/><br/>` : `<div style="height:36px;"></div>`}
                <div>For <b>${esc(c.tradeName || c.legalName || "Authorised Signatory")}</b></div>
                <div class="muted" style="border-top:1px dashed #64748b; display:inline-block; padding-top:2px; margin-top:4px;">
                  ${esc(c.signatoryDesignation || "Authorised Signatory")}
                </div>
              </div>
            </div>
          </div>
        </div>

      <!-- Festive Footer Wish -->
      <div class="fest-footer-wish" style="color:${skin.ink};">
        ${esc(skin.footerWish || "Wishing you and your family joy and prosperity!")}
      </div>
    </div>
  </div>`;
}
