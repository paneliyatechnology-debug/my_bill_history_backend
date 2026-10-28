import {
  DEFAULT_DOCUMENT_TITLES,
  INVOICE_COPY_LABELS,
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

function wrapPage(css: string, body: string, title: string) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(title)}</title>
<style>
@page { size: A4 portrait; margin: 8mm; }
* { box-sizing: border-box; }
body { margin: 0; background: #eceff3; font-family: Arial, Helvetica, sans-serif; color: #111; }
.sheet { width: 210mm; min-height: 297mm; margin: 16px auto; background: #fff; }
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
  const layout = themeLayout(s.themeId);
  const ctx = buildCtx(input);
  if (layout === "luxury") return wrapPage(luxuryCss(s), luxuryBody(ctx), ctx.docTitle);
  if (layout === "stylish") return wrapPage(stylishCss(s), stylishBody(ctx), ctx.docTitle);
  return wrapPage(tallyCss(s), tallyBody(ctx), ctx.docTitle);
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
  };
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

function itemRowsTally(ctx: any) {
  return ctx.items
    .map((row: any, idx: number) => {
      const disc = Number(row.discountAmount || 0);
      const discPct = Number(row.discountPercent || 0);
      return `<tr>
        <td class="c">${idx + 1}</td>
        <td>${itemName(ctx, row)}</td>
        ${ctx.s.showHsn ? `<td class="c">${esc(row.hsnCode || row.item?.hsnCode || "")}</td>` : ""}
        <td class="r">${qtyCell(ctx, row)}</td>
        ${ctx.s.enableFreeItemQuantity ? `<td class="r">${qty(row.freeQuantity || 0)}</td>` : ""}
        <td class="r">${money(row.unitPrice)}</td>
        ${ctx.s.showDiscount ? `<td class="r">${disc ? `${money(disc)}<div class="muted">(${discPct}%)</div>` : "0"}</td>` : ""}
        ${ctx.s.showTaxColumn ? `<td class="r">${money(lineTax(row))}</td>` : ""}
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
        <td class="r">${qtyCell(ctx, row)}</td>
        <td class="r">${money(row.unitPrice)}</td>
        ${ctx.s.showDiscount ? `<td class="r">${disc ? `${money(disc)}<div class="muted">(${discPct}%)</div>` : "0 <div class='muted'>(0%)</div>"}</td>` : ""}
        ${ctx.s.showTaxColumn ? `<td class="r">${money(taxAmt)}<div class="muted">(${taxPct}%)</div></td>` : ""}
        <td class="r">${money(Number(row.totalAmount || 0) + (ctx.s.showTaxColumn ? 0 : 0))}</td>
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

function hsnTable(ctx: any) {
  const rows = ctx.hsnRows
    .map(
      (r: any) => `<tr>
        <td>${esc(r.hsn)}</td>
        <td class="r">${money(r.taxable)}</td>
        <td class="c">${r.rate}%</td>
        <td class="r">${money(r.tax)}</td>
        <td class="r">${money(r.tax)}</td>
      </tr>`,
    )
    .join("");
  const totT = ctx.hsnRows.reduce((a: number, r: any) => a + r.taxable, 0);
  const totX = ctx.hsnRows.reduce((a: number, r: any) => a + r.tax, 0);
  return `<table class="hsn">
    <thead><tr><th>HSN/SAC</th><th>Taxable Value</th><th>Rate</th><th>Tax Amount</th><th>Total Tax Amount</th></tr></thead>
    <tbody>${rows}
      <tr><td><b>Total</b></td><td class="r"><b>${money(totT)}</b></td><td></td><td class="r"><b>${money(totX)}</b></td><td class="r"><b>${money(totX)}</b></td></tr>
    </tbody>
  </table>`;
}

function tallyCss(s: any) {
  const color = s.accentColor || "#111";
  return `
  .sheet { border: 1px solid #222; }
  .topbar { display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #222; padding:6px 10px; font-weight:700; }
  .copy { font-weight:500; font-size:12px; }
  .grid2 { display:grid; grid-template-columns: 1.15fr 1fr; }
  .cell { padding:10px 12px; border-bottom:1px solid #222; }
  .cell + .cell { border-left:1px solid #222; }
  .name { font-size:20px; font-weight:800; }
  table.items, table.hsn { width:100%; border-collapse:collapse; }
  table.items th, table.items td, table.hsn th, table.hsn td { border:1px solid #222; padding:6px 7px; }
  table.items th, table.hsn th { background:${color}; color:#fff; font-size:11px; }
  .r { text-align:right; } .c { text-align:center; } .muted { color:#555; font-size:11px; }
  .split { display:grid; grid-template-columns: 1.2fr 0.8fr; }
  .split > div { padding:10px 12px; border-top:1px solid #222; }
  .split > div + div { border-left:1px solid #222; }
  `;
}

function tallyBody(ctx: any) {
  const c = ctx.c;
  const inv = ctx.inv;
  const party = ctx.party;
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
        <th>QTY.</th>
        ${ctx.s.enableFreeItemQuantity ? "<th>FREE</th>" : ""}
        <th>RATE</th>
        ${ctx.s.showDiscount ? "<th>DISC.</th>" : ""}
        ${ctx.s.showTaxColumn ? "<th>TAX</th>" : ""}
        <th>AMOUNT</th>
      </tr></thead>
      <tbody>${itemRowsTally(ctx)}
        <tr>
          <td colspan="${2 + (ctx.s.showHsn ? 1 : 0)}"></td>
          <td class="r"><b>${qty(ctx.totalQty)}</b></td>
          ${ctx.s.enableFreeItemQuantity ? "<td></td>" : ""}
          <td></td>
          ${ctx.s.showDiscount ? `<td class="r">${money(inv.discountTotal)}</td>` : ""}
          ${ctx.s.showTaxColumn ? `<td class="r">${money(Number(inv.cgstAmount)+Number(inv.sgstAmount)+Number(inv.igstAmount))}</td>` : ""}
          <td class="r"><b>₹ ${money(inv.grandTotal)}</b></td>
        </tr>
      </tbody>
    </table>
    ${ctx.s.showTaxBreakup ? hsnTable(ctx) : ""}
    <div class="split">
      <div>
        ${ctx.s.showAmountInWords ? `<div><b>Total Amount (in words):</b><br/>${esc(amountInWords(Number(inv.grandTotal || 0)))}</div>` : ""}
        ${ctx.s.showNotes && inv.notes ? `<div style="margin-top:8px"><b>Notes</b><br/>${esc(inv.notes)}</div>` : ""}
      </div>
      <div>
        ${ctx.s.showTerms && inv.termsAndConditions ? `<div><b>Terms and Conditions</b><br/>${esc(inv.termsAndConditions)}</div>` : ""}
        ${ctx.s.showReceivedAmount ? `<div style="margin-top:8px">Received Amount: ₹ ${money(ctx.received)}</div>` : ""}
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
        <th class="r">Qty</th><th class="r">Rate</th>
        ${ctx.s.showDiscount ? '<th class="r">Disc.</th>' : ""}
        ${ctx.s.showTaxColumn ? '<th class="r">Tax</th>' : ""}
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
        ${ctx.s.showTerms && inv.termsAndConditions ? `<div style="margin-top:10px"><b>Terms &amp; Conditions</b><br/>${esc(inv.termsAndConditions)}</div>` : ""}
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

function stylishCss(s: any) {
  const color = s.accentColor || "#111";
  return `
  .sheet { padding: 22px 26px; }
  .stamp { display:inline-block; border:1px solid #222; padding:3px 8px; font-size:11px; font-weight:700; }
  .name { font-size:22px; font-weight:800; margin-top:10px; color:${color}; }
  .meta { display:flex; gap:28px; margin:14px 0; font-size:13px; }
  .party { display:flex; justify-content:space-between; margin-bottom:8px; }
  table.items { width:100%; border-collapse:collapse; }
  table.items th { border-bottom:2px solid #111; text-align:left; padding:8px 4px; font-size:11px; }
  table.items td { padding:10px 4px; border-bottom:1px solid #e5e5e5; vertical-align:top; }
  .r { text-align:right; } .c { text-align:center; } .muted { color:#777; font-size:11px; }
  .sub { display:flex; justify-content:flex-end; gap:22px; border-top:1px solid #111; padding:10px 0; font-weight:700; }
  .bottom { display:grid; grid-template-columns: 1fr 1fr; gap:24px; margin-top:16px; }
  .words { margin-top:20px; text-align:right; }
  `;
}

function stylishBody(ctx: any) {
  const c = ctx.c;
  const inv = ctx.inv;
  const party = ctx.party;
  const taxTotal = Number(inv.cgstAmount || 0) + Number(inv.sgstAmount || 0) + Number(inv.igstAmount || 0);
  return `<div class="sheet">
    <div class="stamp">${esc(ctx.docTitle)} &nbsp; ${esc(ctx.copyLabel)}</div>
    <div class="name">${esc(c.tradeName || c.legalName)}</div>
    <div class="muted">${esc(c.city || "")}${c.stateCode ? " · " + esc(c.stateCode) : ""}</div>
    ${ctx.s.showPhoneNumber ? `<div>Mobile: ${esc(c.phone || "")}</div>` : ""}
    <div class="meta">
      <div><b>Invoice No :</b> ${esc(inv.invoiceNumber || "-")}</div>
      <div><b>Invoice Date :</b> ${esc(formatDate(inv.invoiceDate))}</div>
      ${ctx.s.showDueDate && inv.dueDate ? `<div><b>Due Date :</b> ${esc(formatDate(inv.dueDate))}</div>` : ""}
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
        <th class="r">QTY.</th><th class="r">RATE</th>
        ${ctx.s.showDiscount ? '<th class="r">DISC.</th>' : ""}
        ${ctx.s.showTaxColumn ? '<th class="r">TAX</th>' : ""}
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
        ${ctx.s.showTerms && inv.termsAndConditions ? `<div style="margin-top:10px"><b>TERMS AND CONDITIONS</b><br/>${esc(inv.termsAndConditions)}</div>` : ""}
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
