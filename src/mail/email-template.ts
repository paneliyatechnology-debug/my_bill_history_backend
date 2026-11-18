import { escapeHtml } from "./email.util";

export interface EmailDetail {
  label: string;
  value: string;
}

export interface EmailContent {
  appName?: string;
  heading: string;
  preheader?: string;
  intro?: string;
  code?: string;
  codeCaption?: string;
  copyUrl?: string;
  actionUrl?: string;
  actionLabel?: string;
  companyName?: string;
  details?: EmailDetail[];
  paragraphs?: string[];
  note?: string;
  gujaratiNote?: string;
}

const EMPHASIS = /total|amount|balance|grand/i;

export function structurePlainText(text: string): {
  paragraphs: string[];
  details: EmailDetail[];
} {
  const paragraphs: string[] = [];
  const details: EmailDetail[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const paragraph = buffer.join("\n").trim();
    buffer = [];
    if (paragraph) paragraphs.push(paragraph);
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^([^:]{2,48}):\s+(.+)$/);
    const label = match?.[1]?.trim() || "";
    const value = match?.[2]?.trim() || "";
    const structured =
      Boolean(match) &&
      !/https?:\/\//i.test(line) &&
      !label.includes("http") &&
      value.length > 0 &&
      value.length <= 240;

    if (structured) {
      flush();
      details.push({ label, value });
      continue;
    }
    if (!line) {
      flush();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return { paragraphs, details };
}

export function renderBrandedEmail(content: EmailContent): { html: string; text: string } {
  const appName = content.appName || "myownbillbook";
  const heading = content.heading.trim() || appName;
  const preheader = (content.preheader || content.intro || heading).replace(/\s+/g, " ").slice(0, 140);
  const details = (content.details || []).filter((row) => row.label.trim() && row.value.trim()).slice(0, 20);
  const paragraphs = (content.paragraphs || []).map((item) => item.trim()).filter(Boolean).slice(0, 12);

  // Extract action URL from content or paragraphs if available
  let actionUrl = content.actionUrl || "";
  if (!actionUrl) {
    for (const p of paragraphs) {
      const match = p.match(/https?:\/\/[^\s<>'"]+/i);
      if (match) {
        actionUrl = match[0].replace(/[.,;)]+$/, "");
        break;
      }
    }
  }

  // Determine button label
  let actionLabel = content.actionLabel || "";
  if (!actionLabel) {
    if (/invoice/i.test(heading)) {
      actionLabel = "View & Download Invoice →";
    } else if (/credit\s*note/i.test(heading)) {
      actionLabel = "View Credit Note →";
    } else if (/return/i.test(heading)) {
      actionLabel = "View Return Voucher →";
    } else if (actionUrl) {
      actionLabel = "Open in MyOwn BillBook →";
    }
  }

  // Extract Grand Total and Balance for Hero Metric card if present
  const grandTotalRow = details.find((d) => /grand\s*total|total\s*amount/i.test(d.label)) ||
    details.find((d) => /^total$/i.test(d.label)) ||
    details.find((d) => /amount/i.test(d.label));

  const balanceRow = details.find((d) => /balance/i.test(d.label));

  // Determine sender display name
  const senderName = content.companyName ||
    (content.intro && content.intro.includes(" shared ") ? content.intro.split(" shared ")[0].trim() : "") ||
    appName;

  // Filter out grand total and balance from standard table when rendered in Hero card
  const filteredDetails = grandTotalRow
    ? details.filter((d) => d !== grandTotalRow && d !== balanceRow)
    : details;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F1F5F9;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;">${escapeHtml(preheader)}</div>
  
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F1F5F9;margin:0;padding:28px 12px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background-color:#FFFFFF;border-radius:10px;border:1px solid #E2E8F0;box-shadow:0 2px 8px rgba(15,23,42,0.05);overflow:hidden;">
          
          <!-- Corporate Brand Header Bar -->
          <tr>
            <td style="padding:20px 28px;background-color:#FFFFFF;border-bottom:1px solid #E2E8F0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="middle">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td valign="middle" style="padding-right:12px;">
                          <div style="width:34px;height:34px;border-radius:6px;background-color:#1E3A8A;color:#FFFFFF;font-size:17px;font-weight:700;line-height:34px;text-align:center;">
                            M
                          </div>
                        </td>
                        <td valign="middle">
                          <div style="font-size:18px;font-weight:800;letter-spacing:-0.3px;color:#0F172A;line-height:1.2;">
                            <span style="color:#0F172A;">myown</span><span style="color:#2563EB;">billbook</span>
                          </div>
                          <div style="font-size:11px;color:#64748B;font-weight:500;margin-top:2px;">
                            GST Invoicing, Inventory &amp; Accounting
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" valign="middle">
                    <div style="font-size:12px;font-weight:600;color:#64748B;text-align:right;">
                      ${content.companyName ? escapeHtml(content.companyName) : "Official Notification"}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Body Content -->
          <tr>
            <td style="padding:28px 28px 16px;color:#0F172A;">
              
              <!-- Document Title & Intro -->
              <h1 style="margin:0 0 8px;font-size:20px;line-height:1.4;font-weight:700;color:#0F172A;letter-spacing:-0.2px;">
                ${escapeHtml(heading)}
              </h1>
              ${content.intro ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#475569;">${escapeHtml(content.intro)}</p>` : ""}

              <!-- Featured Hero Amount Card (if Grand Total is present) -->
              ${grandTotalRow ? renderHeroAmountCard(grandTotalRow, balanceRow) : ""}

              <!-- OTP Verification Block (if code is present) -->
              ${renderCode(content.code, content.codeCaption, actionUrl || content.copyUrl, actionLabel)}

              <!-- Structured Details Table -->
              ${renderDetails(filteredDetails)}

              <!-- Primary Action CTA Button (if actionUrl is available and no OTP block already handled it) -->
              ${!content.code && actionUrl ? renderActionButton(actionUrl, actionLabel) : ""}

              <!-- Additional Paragraphs -->
              ${paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:13px;line-height:1.65;color:#475569;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("")}

              <!-- Alert Callout Note -->
              ${content.note ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 20px;"><tr><td style="background-color:#F8FAFC;border-left:4px solid #2563EB;border:1px solid #E2E8F0;border-left-width:4px;border-radius:6px;padding:12px 16px;font-size:13px;line-height:1.5;color:#1E293B;font-weight:500;">${escapeHtml(content.note)}</td></tr></table>` : ""}

            </td>
          </tr>

          <!-- Professional Corporate Footer -->
          <tr>
            <td style="background-color:#F8FAFC;border-top:1px solid #E2E8F0;padding:20px 28px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <div style="font-size:12px;font-weight:600;color:#334155;">
                      myownbillbook &bull; Indian GST Billing &amp; Accounting
                    </div>
                    <div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.5;">
                      Sent on behalf of <strong>${escapeHtml(senderName)}</strong> via ${escapeHtml(appName)}.
                    </div>
                    <div style="font-size:11px;color:#94A3B8;margin-top:4px;line-height:1.4;">
                      This is an automated operational notification. For billing inquiries, please contact the sender directly.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `${appName} - GST Billing & Accounting`,
    "",
    heading,
    content.intro || "",
    grandTotalRow ? `${grandTotalRow.label}: ${grandTotalRow.value}` : "",
    balanceRow ? `${balanceRow.label}: ${balanceRow.value}` : "",
    content.code ? `Verification Code: ${content.code}` : "",
    content.codeCaption || "",
    actionUrl ? `${actionLabel || 'View Document'}: ${actionUrl}` : "",
    ...filteredDetails.map((row) => `${row.label}: ${row.value}`),
    ...paragraphs,
    content.note || "",
    "",
    `Sent by ${appName}. If you did not request this message, you can safely ignore it.`,
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n")
    .trim();

  return { html, text };
}

function renderHeroAmountCard(grandTotalRow: EmailDetail, balanceRow?: EmailDetail): string {
  let balanceCell = "";
  if (balanceRow) {
    const rawVal = balanceRow.value.replace(/[^0-9.]/g, "");
    const num = parseFloat(rawVal);
    const isZero = !isNaN(num) && num === 0;

    if (isZero) {
      balanceCell = `
        <td align="right" valign="middle">
          <div style="font-size:11px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:0.8px;">
            Payment Status
          </div>
          <div style="font-size:14px;font-weight:700;color:#15803D;margin-top:4px;">
            Paid in Full
          </div>
        </td>`;
    } else {
      balanceCell = `
        <td align="right" valign="middle">
          <div style="font-size:11px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:0.8px;">
            Balance Due
          </div>
          <div style="font-size:17px;font-weight:700;color:#DC2626;margin-top:4px;">
            ${escapeHtml(balanceRow.value)}
          </div>
        </td>`;
    }
  }

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;">
    <tr>
      <td style="padding:18px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td valign="middle">
              <div style="font-size:11px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:0.8px;">
                ${escapeHtml(grandTotalRow.label)}
              </div>
              <div style="font-size:26px;font-weight:700;color:#0F172A;margin-top:3px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                ${escapeHtml(grandTotalRow.value)}
              </div>
            </td>
            ${balanceCell}
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

function renderActionButton(url?: string, label?: string): string {
  if (!url || !/^https?:\/\//i.test(url)) return "";
  const safeUrl = escapeHtml(url);
  const text = escapeHtml(label || "View &amp; Print Document &rarr;");

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 24px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr>
            <td align="center" style="background-color:#2563EB;border-radius:6px;">
              <a href="${safeUrl}" target="_blank" style="background-color:#2563EB;border-radius:6px;color:#FFFFFF;display:inline-block;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;line-height:20px;text-align:center;text-decoration:none;padding:12px 28px;letter-spacing:0.2px;">
                ${text}
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

function renderCode(code?: string, caption?: string, actionUrl?: string, actionLabel?: string): string {
  const digits = String(code || "").replace(/\D/g, "");
  if (digits.length < 4) return "";
  const safeCode = escapeHtml(digits);

  // Optional direct continuation button (points to login/action page, NOT to a copy-code page)
  let directBtn = "";
  if (actionUrl && /^https?:\/\//i.test(actionUrl) && !actionUrl.includes("/copy-code")) {
    const safeUrl = escapeHtml(actionUrl);
    const btnText = escapeHtml(actionLabel || "Continue to Login & Verify →");
    directBtn = `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px auto 0;">
        <tr>
          <td align="center" style="background-color:#2563EB;border-radius:6px;">
            <a href="${safeUrl}" target="_blank" style="background-color:#2563EB;border-radius:6px;color:#FFFFFF;display:inline-block;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;line-height:18px;text-align:center;text-decoration:none;padding:10px 22px;">
              ${btnText}
            </a>
          </td>
        </tr>
      </table>`;
  }

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 24px;background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;">
    <tr>
      <td align="center" style="padding:22px 18px;text-align:center;">
        <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:12px;">
          Security Verification Code
        </div>
        
        <!-- Large single-block selectable monospace code for instant on-page copy -->
        <div style="display:inline-block;background-color:#FFFFFF;border:1.5px solid #CBD5E1;border-radius:6px;padding:12px 24px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,Courier,monospace;font-size:30px;font-weight:700;letter-spacing:8px;color:#0F172A;user-select:all;-webkit-user-select:all;">${safeCode}</div>

        <p style="margin:10px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#64748B;">
          Click code to select &bull; Use Ctrl+C or Cmd+C to copy
        </p>

        ${caption ? `<p style="margin:8px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#64748B;">${escapeHtml(caption)}</p>` : ""}

        ${directBtn}
      </td>
    </tr>
  </table>`;
}

function formatValue(value: string): string {
  const safe = escapeHtml(value);
  if (/^https?:\/\/\S+$/i.test(value)) {
    return `<a href="${safe}" target="_blank" style="color:#2563EB;text-decoration:underline;word-break:break-all;">${safe}</a>`;
  }
  return safe;
}

function renderDetails(details: EmailDetail[]): string {
  if (!details.length) return "";
  const rows = details
    .map((row, index) => {
      const emphasize = EMPHASIS.test(row.label);
      const border = index === details.length - 1 ? "" : "border-bottom:1px solid #E2E8F0;";
      return `<tr>
        <td style="padding:10px 16px;${border}font-size:13px;font-weight:600;color:#64748B;width:38%;vertical-align:middle;background-color:#F8FAFC;">
          ${escapeHtml(row.label)}
        </td>
        <td style="padding:10px 16px;${border}font-size:${emphasize ? "14px" : "13px"};font-weight:${emphasize ? "700" : "600"};color:#0F172A;text-align:right;vertical-align:middle;background-color:#FFFFFF;">
          ${formatValue(row.value)}
        </td>
      </tr>`;
    })
    .join("");

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;border-collapse:collapse;">
    <tbody>
      ${rows}
    </tbody>
  </table>`;
}
