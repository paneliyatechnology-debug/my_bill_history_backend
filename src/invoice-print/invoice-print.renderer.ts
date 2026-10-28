import {
  DEFAULT_DOCUMENT_TITLES,
  INVOICE_COPY_LABELS,
  InvoiceLayout,
  festiveSkin,
  themeLayout,
} from "./invoice-themes";

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
  const paper = s?.paperSize === "A5" ? "A5 portrait" : s?.paperSize === "THERMAL_80" ? "80mm auto" : s?.paperSize === "THERMAL_58" ? "58mm auto" : "A4 portrait";
  const width = s?.paperSize === "A5" ? "148mm" : s?.paperSize?.startsWith("THERMAL") ? "80mm" : "210mm";
  const mt = Number(s?.marginTop ?? 8);
  const mr = Number(s?.marginRight ?? 8);
  const mb = Number(s?.marginBottom ?? 8);
  const ml = Number(s?.marginLeft ?? 8);
  const family = s?.fontFamily || "Arial, Helvetica, sans-serif";
  const fontSize = `${s?.fontSize || 13}px`;
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(title)}</title>
<style>
@page { size: ${paper}; margin: ${mt}mm ${mr}mm ${mb}mm ${ml}mm; }
* { box-sizing: border-box; }
body { margin: 0; background: #eceff3; font-family: ${family}; font-size: ${fontSize}; color: #111; }
.sheet { width: ${width}; min-height: ${s?.paperSize === "A5" ? "210mm" : "297mm"}; margin: 16px auto; background: #fff; }
@media print { body { background: #fff; } .sheet { margin: 0; } }
${css}
</style></head><body>${body}</body></html>`;
}

export function renderInvoiceHtml(input: {
  settings: any;
  company: any;
  invoice: any;
  copyType: string;
}): string {
  const s = input.settings;
  const layout = themeLayout(s.themeId || s.festiveTheme);
  const ctx = buildCtx(input);
  if (layout === "luxury") return wrapPage(luxuryCss(s), luxuryBody(ctx), ctx.docTitle, s);
  if (layout === "festival") return wrapPage(festivalCss(s), festivalBody(ctx), ctx.docTitle, s);
  if (layout === "stylish" || layout === "modern" || layout === "simple" || layout === "billbook") {
    return wrapPage(stylishCss(s, layout), stylishBody(ctx, layout), ctx.docTitle, s);
  }
  return wrapPage(tallyCss(s, layout), tallyBody(ctx, layout), ctx.docTitle, s);
}

function buildCtx(input: { settings: any; company: any; invoice: any; copyType: string }) {
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
  const bank =
    ctx.s.showBankDetails && (c.bankName || c.bankAccountNo)
      ? `<div><b>Bank Details</b><br/>${esc(c.bankName || "")}<br/>A/C: ${esc(c.bankAccountNo || "")}<br/>IFSC: ${esc(c.bankIfsc || "")}${c.upiVpa && ctx.s.showUpiQr ? `<br/>UPI: ${esc(c.upiVpa)}` : ""}</div>`
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

function festivalCss(s: any) {
  const skin = festiveSkin(s.themeId || s.festiveTheme || "navratri");
  const accent = s.accentColor && s.accentColor !== "#111111" ? s.accentColor : skin.ink;
  return `
  .sheet { background:${skin.wash}; border:12px solid ${skin.border}; padding:16px 18px 20px; position:relative; }
  .sheet:before { content:""; position:absolute; inset:6px; border:1px dashed ${skin.border}; pointer-events:none; }
  .greet { text-align:center; letter-spacing:.22em; font-size:12px; font-weight:800; color:${skin.ink}; margin:4px 0 8px; }
  .band { display:flex; gap:4px; justify-content:center; margin-bottom:8px; }
  .band span { width:18px; height:8px; border-radius:99px; display:inline-block; }
  .diyas { display:flex; justify-content:center; gap:10px; margin-bottom:6px; }
  .diyas i { width:14px; height:10px; border:2px solid; border-radius:0 0 10px 10px; display:inline-block; }
  .kites { display:flex; justify-content:center; gap:8px; margin-bottom:6px; }
  .kites b { width:12px; height:12px; background:${skin.band[0]}; transform:rotate(45deg); display:inline-block; }
  .kites b:nth-child(2){ background:${skin.band[1] || skin.ink}; }
  .kites b:nth-child(3){ background:${skin.band[2] || skin.ink}; }
  .kites b:nth-child(4){ background:${skin.band[3] || skin.ink}; }
  .coins { display:flex; justify-content:center; gap:6px; margin-bottom:6px; }
  .coins b { width:18px; height:18px; border-radius:50%; border:1px solid ${skin.border}; display:inline-flex; align-items:center; justify-content:center; font-size:10px; color:${skin.ink}; }
  .arch { width:72px; height:28px; border:3px solid; border-bottom:none; border-radius:40px 40px 0 0; margin:0 auto 6px; }
  .bow, .flag { text-align:center; margin-bottom:4px; }
  .flag { display:flex; width:84px; margin:0 auto 8px; height:8px; }
  .flag span { flex:1; display:block; }
  .flag span:nth-child(1){ background:#FF9933; } .flag span:nth-child(2){ background:#fff; } .flag span:nth-child(3){ background:#138808; }
  .logo-slot { width:86px; height:54px; border:1px dashed ${skin.border}; display:flex; align-items:center; justify-content:center; font-size:10px; letter-spacing:.08em; color:${skin.ink}; margin-bottom:6px; background:#fff; }
  .logo-slot img { max-width:80px; max-height:48px; }
  .fest-head { display:flex; justify-content:space-between; align-items:flex-start; }
  .name { font-size:24px; font-weight:800; color:${accent}; }
  .badge { text-align:right; font-weight:800; letter-spacing:.06em; }
  .meta { display:flex; gap:22px; margin:12px 0; font-size:12px; }
  .party { display:flex; justify-content:space-between; margin-bottom:8px; }
  table.items, table.hsn { width:100%; border-collapse:collapse; background:#fff; }
  table.items th, table.hsn th { background:${skin.ink}; color:#fff; text-align:left; padding:6px; font-size:11px; }
  table.items td, table.hsn td { padding:7px 6px; border-bottom:1px solid #f1e7d4; vertical-align:top; }
  .r { text-align:right; } .c { text-align:center; } .muted { color:#666; font-size:11px; }
  .bottom { display:grid; grid-template-columns: 1.1fr .9fr; gap:16px; margin-top:12px; background:#fff; padding:10px; }
  `;
}

function festivalBody(ctx: any) {
  const skin = festiveSkin(ctx.s.themeId || ctx.s.festiveTheme || "navratri");
  const c = ctx.c;
  const inv = ctx.inv;
  const party = ctx.party;
  const taxTotal = Number(inv.cgstAmount || 0) + Number(inv.sgstAmount || 0) + Number(inv.igstAmount || 0);
  const logo = ctx.s.logoUrl
    ? `<div class="logo-slot"><img src="${esc(ctx.s.logoUrl)}" alt="logo"/></div>`
    : skin.motif === "logo"
      ? `<div class="logo-slot">YOUR LOGO</div>`
      : "";
  return `<div class="sheet">
    ${festivalMotif(skin.motif, skin.ink)}
    <div class="greet">${esc(skin.title)}</div>
    <div class="fest-head">
      <div>
        ${logo}
        <div class="name">${esc(c.tradeName || c.legalName)}</div>
        ${ctx.s.showPhoneNumber ? `<div>${esc(c.phone || "")}</div>` : ""}
        <div class="muted">${esc([c.addressLine1, c.city].filter(Boolean).join(", "))}</div>
        ${ctx.s.showGstin && c.gstin ? `<div>GSTIN ${esc(c.gstin)}</div>` : ""}
      </div>
      <div class="badge">
        <div>${esc(ctx.docTitle)}</div>
        <div class="muted">${esc(ctx.copyLabel)}</div>
      </div>
    </div>
    <div class="meta">
      <div><b>Invoice No.</b><br/>${esc(inv.invoiceNumber || "-")}</div>
      <div><b>Invoice Date</b><br/>${esc(formatDate(inv.invoiceDate))}</div>
      ${ctx.s.showDueDate && inv.dueDate ? `<div><b>Due Date</b><br/>${esc(formatDate(inv.dueDate))}</div>` : ""}
      ${invoiceMetaExtras(ctx)}
    </div>
    <div class="party">
      <div>
        <b>Bill To</b>
        <div>${esc(party.name || "Cash Customer")}</div>
        <div class="muted">${esc(addr(ctx.billing))}</div>
        ${ctx.s.showGstin && party.gstin ? `<div>GSTIN ${esc(party.gstin)}</div>` : ""}
      </div>
      <div class="muted">${esc(ctx.s.showShippingAddress ? addr(ctx.shipping) || "" : "")}</div>
    </div>
    <table class="items">
      <thead><tr>
        <th>#</th><th>Items</th>
        ${ctx.s.showHsn ? "<th>HSN</th>" : ""}
        ${ctx.s.showQuantity !== false ? '<th class="r">Qty</th>' : ""}
        ${ctx.s.showPricePerItem !== false ? '<th class="r">Rate</th>' : ""}
        ${ctx.s.showDiscount ? '<th class="r">Disc.</th>' : ""}
        ${ctx.s.showTaxColumn ? '<th class="r">Tax</th>' : ""}
        ${extraItemHeaders(ctx)}
        <th class="r">Amount</th>
      </tr></thead>
      <tbody>${itemRowsOpen(ctx)}</tbody>
    </table>
    <div class="bottom">
      <div>
        ${ctx.s.showAmountInWords ? `<div><b>Amount in words</b><br/>${esc(amountInWords(Number(inv.grandTotal || 0)))}</div>` : ""}
        ${ctx.s.showNotes && inv.notes ? `<div style="margin-top:8px"><b>Notes</b><br/>${esc(inv.notes)}</div>` : ""}
      </div>
      <div>
        <div>Taxable <span style="float:right">₹ ${money(inv.taxableAmount || inv.subTotal)}</span></div>
        ${taxLines(ctx)}
        <div style="margin-top:6px"><b>Total</b> <span style="float:right"><b>₹ ${money(inv.grandTotal)}</b></span></div>
        <div class="muted">Tax ₹ ${money(taxTotal)}</div>
      </div>
    </div>
    ${ctx.s.showTaxBreakup ? hsnTable(ctx, skin.ink) : ""}
  </div>`;
}
