import { escapeHtml } from "./email.util";

export type EmailCategory =
  | "invoice"
  | "credit_note"
  | "return"
  | "report"
  | "ca_invite"
  | "referral"
  | "support"
  | "otp"
  | "general";

export interface EmailDetail {
  label: string;
  value: string;
}

export interface EmailContent {
  appName?: string;
  category?: EmailCategory;
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
  attachmentNames?: string[];
}

interface CategoryTheme {
  badge: string;
  accent: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
}

const CATEGORY_THEMES: Record<EmailCategory, CategoryTheme> = {
  invoice: {
    badge: "TAX INVOICE",
    accent: "#2563EB",
    badgeBg: "#EFF6FF",
    badgeText: "#1D4ED8",
    badgeBorder: "#BFDBFE",
  },
  credit_note: {
    badge: "CREDIT NOTE",
    accent: "#059669",
    badgeBg: "#ECFDF5",
    badgeText: "#047857",
    badgeBorder: "#A7F3D0",
  },
  return: {
    badge: "SALES RETURN",
    accent: "#D97706",
    badgeBg: "#FFFBEB",
    badgeText: "#B45309",
    badgeBorder: "#FDE68A",
  },
  report: {
    badge: "FINANCIAL REPORT",
    accent: "#4F46E5",
    badgeBg: "#EEF2FF",
    badgeText: "#4338CA",
    badgeBorder: "#C7D2FE",
  },
  ca_invite: {
    badge: "CA AUDIT ACCESS",
    accent: "#0D9488",
    badgeBg: "#F0FDFA",
    badgeText: "#0F766E",
    badgeBorder: "#99F6E4",
  },
  referral: {
    badge: "PARTNER INVITE",
    accent: "#7C3AED",
    badgeBg: "#F5F3FF",
    badgeText: "#6D28D9",
    badgeBorder: "#DDD6FE",
  },
  support: {
    badge: "SUPPORT REQUEST",
    accent: "#0F172A",
    badgeBg: "#F1F5F9",
    badgeText: "#334155",
    badgeBorder: "#CBD5E1",
  },
  otp: {
    badge: "SECURITY CODE",
    accent: "#2563EB",
    badgeBg: "#EFF6FF",
    badgeText: "#1D4ED8",
    badgeBorder: "#BFDBFE",
  },
  general: {
    badge: "NOTIFICATION",
    accent: "#2563EB",
    badgeBg: "#F8FAFC",
    badgeText: "#475569",
    badgeBorder: "#E2E8F0",
  },
};

const EMPHASIS = /total|amount|balance|grand|reward/i;

function resolveCategory(content: EmailContent, heading: string): EmailCategory {
  if (content.category && CATEGORY_THEMES[content.category]) {
    return content.category;
  }
  if (content.code) return "otp";
  if (/credit\s*note/i.test(heading)) return "credit_note";
  if (/return/i.test(heading)) return "return";
  if (/invoice/i.test(heading)) return "invoice";
  if (/audit|chartered|books ready|ca\b/i.test(heading)) return "ca_invite";
  if (/refer|invited to/i.test(heading)) return "referral";
  if (/report|summary|register|gstr|ledger|trial balance|profit/i.test(heading)) return "report";
  if (/support|callback|suggestion/i.test(heading)) return "support";
  return "general";
}

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
  const category = resolveCategory(content, heading);
  const theme = CATEGORY_THEMES[category];
  const preheader = (content.preheader || content.intro || heading).replace(/\s+/g, " ").slice(0, 150);
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
    if (category === "invoice") {
      actionLabel = "View & Download Invoice →";
    } else if (category === "credit_note") {
      actionLabel = "View Credit Note →";
    } else if (category === "return") {
      actionLabel = "View Return Voucher →";
    } else if (category === "report") {
      actionLabel = "Open Report in myownbillbook →";
    } else if (category === "ca_invite") {
      actionLabel = "Open Audit Portal →";
    } else if (category === "referral") {
      actionLabel = "Accept Invitation →";
    } else if (actionUrl) {
      actionLabel = "Open in myownbillbook →";
    }
  }

  // Extract Grand Total and Balance for Hero Metric card if present
  const grandTotalRow =
    details.find((d) => /grand\s*total|total\s*amount/i.test(d.label)) ||
    details.find((d) => /^total$/i.test(d.label)) ||
    details.find((d) => /^amount$/i.test(d.label));

  const balanceRow = details.find((d) => /balance/i.test(d.label));

  // Determine sender display name
  const senderName =
    content.companyName ||
    (content.intro && content.intro.includes(" shared ") ? content.intro.split(" shared ")[0].trim() : "") ||
    appName;

  // Filter out grand total and balance from standard table when rendered in Hero card
  const filteredDetails = grandTotalRow
    ? details.filter((d) => d !== grandTotalRow && d !== balanceRow)
    : details;

  // Remove redundant raw URL or duplicate intro/note text from paragraphs
  const introNorm = (content.intro || "").trim().toLowerCase();
  const noteNorm = (content.note || "").trim().toLowerCase();
  const cleanedParagraphs = paragraphs.filter((p) => {
    const pNorm = p.trim().toLowerCase();
    if (actionUrl && pNorm === actionUrl.trim().toLowerCase()) return false;
    if (introNorm && pNorm === introNorm) return false;
    if (noteNorm && pNorm === noteNorm) return false;
    return true;
  });

  const attachmentNames = (content.attachmentNames || []).filter(Boolean);
  const year = new Date().getFullYear();

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#EEF2F6;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:transparent;">${escapeHtml(preheader)}&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EEF2F6;margin:0;padding:32px 12px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#FFFFFF;border-radius:14px;border:1px solid #E2E8F0;border-collapse:separate;border-spacing:0;overflow:hidden;">

          <!-- Top Accent Bar -->
          <tr>
            <td style="height:5px;background-color:${theme.accent};font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Corporate Brand Header Bar -->
          <tr>
            <td style="padding:20px 28px;background-color:#FFFFFF;border-bottom:1px solid #E2E8F0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="middle">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="middle" style="padding-right:12px;">
                          <div style="width:38px;height:38px;border-radius:10px;background-color:#1677E8;color:#FFFFFF;font-size:18px;font-weight:800;line-height:38px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                            M
                          </div>
                        </td>
                        <td valign="middle">
                          <div style="font-size:18px;font-weight:800;letter-spacing:-0.4px;color:#0F172A;line-height:1.15;">
                            <span style="color:#0F172A;">myown</span><span style="color:#1677E8;">billbook</span>
                          </div>
                          <div style="font-size:11px;color:#64748B;font-weight:500;margin-top:2px;">
                            GST Invoicing, Inventory &amp; Accounting
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" valign="middle">
                    <span style="display:inline-block;padding:4px 11px;border-radius:999px;background-color:${theme.badgeBg};border:1px solid ${theme.badgeBorder};color:${theme.badgeText};font-size:10px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">
                      ${escapeHtml(theme.badge)}
                    </span>
                    ${
                      content.companyName
                        ? `<div style="font-size:11px;font-weight:600;color:#475569;margin-top:5px;text-align:right;">${escapeHtml(content.companyName)}</div>`
                        : ""
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Body Content -->
          <tr>
            <td style="padding:28px 28px 22px;color:#0F172A;">

              <!-- Document Title & Intro -->
              <h1 style="margin:0 0 8px;font-size:21px;line-height:1.35;font-weight:700;color:#0F172A;letter-spacing:-0.3px;">
                ${escapeHtml(heading)}
              </h1>
              ${
                content.intro
                  ? `<p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#475569;">${escapeHtml(content.intro)}</p>`
                  : `<div style="height:12px;"></div>`
              }

              <!-- Featured Hero Amount Card (if Grand Total is present) -->
              ${grandTotalRow ? renderHeroAmountCard(grandTotalRow, balanceRow, theme.accent) : ""}

              <!-- OTP Verification Block (if code is present) -->
              ${renderCode(content.code, content.codeCaption, actionUrl || content.copyUrl, actionLabel, theme.accent)}

              <!-- Structured Details Table -->
              ${renderDetails(filteredDetails)}

              <!-- Attached PDF / Files Badge -->
              ${
                attachmentNames.length > 0
                  ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background-color:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;border-collapse:separate;border-spacing:0;">
                      <tr>
                        <td style="padding:11px 16px;font-size:12px;font-weight:600;color:#1D4ED8;">
                          &#128206; Attached Document: ${attachmentNames.map((n) => `<span style="color:#0F172A;">${escapeHtml(n)}</span>`).join(", ")}
                        </td>
                      </tr>
                    </table>`
                  : ""
              }

              <!-- Primary Action CTA Button (if actionUrl is available and no OTP block already handled it) -->
              ${!content.code && actionUrl ? renderActionButton(actionUrl, actionLabel, theme.accent) : ""}

              <!-- Additional Paragraphs -->
              ${cleanedParagraphs
                .map(
                  (p) =>
                    `<p style="margin:0 0 14px;font-size:13px;line-height:1.65;color:#475569;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`,
                )
                .join("")}

              <!-- Alert Callout Note -->
              ${
                content.note
                  ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 4px;border-collapse:separate;border-spacing:0;">
                      <tr>
                        <td style="background-color:#F8FAFC;border:1px solid #E2E8F0;border-left:4px solid ${theme.accent};border-radius:8px;padding:13px 16px;font-size:13px;line-height:1.55;color:#1E293B;font-weight:500;">
                          ${escapeHtml(content.note)}
                        </td>
                      </tr>
                    </table>`
                  : ""
              }

            </td>
          </tr>

          <!-- Professional Corporate Footer -->
          <tr>
            <td style="background-color:#F8FAFC;border-top:1px solid #E2E8F0;padding:20px 28px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <div style="font-size:12px;font-weight:700;color:#1E293B;">
                      myownbillbook &bull; Indian GST Billing &amp; Accounting
                    </div>
                    <div style="font-size:11px;color:#64748B;margin-top:5px;line-height:1.55;">
                      Sent on behalf of <strong style="color:#334155;">${escapeHtml(senderName)}</strong> via ${escapeHtml(appName)}.
                    </div>
                    <div style="font-size:11px;color:#94A3B8;margin-top:6px;line-height:1.45;">
                      &copy; ${year} ${escapeHtml(appName)}. This is an automated transactional email. For billing or account inquiries, please reply to the sender directly.
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
    `[${theme.badge}]`,
    "",
    heading,
    content.intro || "",
    grandTotalRow ? `${grandTotalRow.label}: ${grandTotalRow.value}` : "",
    balanceRow ? `${balanceRow.label}: ${balanceRow.value}` : "",
    content.code ? `Verification Code: ${content.code}` : "",
    content.codeCaption || "",
    actionUrl ? `${actionLabel || "View Document"}: ${actionUrl}` : "",
    ...filteredDetails.map((row) => `${row.label}: ${row.value}`),
    ...cleanedParagraphs,
    content.note || "",
    "",
    `Sent on behalf of ${senderName} via ${appName}.`,
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n")
    .trim();

  return { html, text };
}

function renderHeroAmountCard(
  grandTotalRow: EmailDetail,
  balanceRow?: EmailDetail,
  accentColor = "#2563EB",
): string {
  let balanceCell = "";
  if (balanceRow) {
    const rawVal = balanceRow.value.replace(/[^0-9.-]/g, "");
    const num = parseFloat(rawVal);
    const isZero = !isNaN(num) && num <= 0;

    if (isZero) {
      balanceCell = `
        <td align="right" valign="middle">
          <div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">
            Payment Status
          </div>
          <span style="display:inline-block;padding:4px 10px;border-radius:999px;background-color:#DCFCE7;color:#15803D;font-size:12px;font-weight:700;">
            &#10003; Paid in Full
          </span>
        </td>`;
    } else {
      balanceCell = `
        <td align="right" valign="middle">
          <div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.8px;">
            Balance Due
          </div>
          <div style="font-size:18px;font-weight:700;color:#DC2626;margin-top:4px;font-variant-numeric:tabular-nums;">
            ${escapeHtml(balanceRow.value)}
          </div>
        </td>`;
    }
  }

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;background-color:#F8FAFC;border:1px solid #E2E8F0;border-left:4px solid ${accentColor};border-radius:10px;">
    <tr>
      <td style="padding:18px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td valign="middle">
              <div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.8px;">
                ${escapeHtml(grandTotalRow.label)}
              </div>
              <div style="font-size:26px;font-weight:800;color:#0F172A;margin-top:4px;font-variant-numeric:tabular-nums;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
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

function renderActionButton(url?: string, label?: string, accentColor = "#2563EB"): string {
  if (!url || !/^https?:\/\//i.test(url)) return "";
  const safeUrl = escapeHtml(url);
  const text = escapeHtml(label || "View & Print Document →");

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 20px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
          <tr>
            <td align="center" style="background-color:${accentColor};border-radius:8px;">
              <a href="${safeUrl}" target="_blank" style="background-color:${accentColor};border-radius:8px;color:#FFFFFF;display:inline-block;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;line-height:20px;text-align:center;text-decoration:none;padding:12px 28px;letter-spacing:0.2px;">
                ${text}
              </a>
            </td>
          </tr>
        </table>
        <div style="margin-top:10px;font-size:11px;color:#94A3B8;line-height:1.4;word-break:break-all;">
          If the button doesn&rsquo;t work, open: <a href="${safeUrl}" target="_blank" style="color:#64748B;text-decoration:underline;">${safeUrl}</a>
        </div>
      </td>
    </tr>
  </table>`;
}

function renderCode(
  code?: string,
  caption?: string,
  actionUrl?: string,
  actionLabel?: string,
  accentColor = "#2563EB",
): string {
  const digits = String(code || "").replace(/\D/g, "");
  if (digits.length < 4) return "";
  const safeCode = escapeHtml(digits);

  let directBtn = "";
  if (actionUrl && /^https?:\/\//i.test(actionUrl) && !actionUrl.includes("/copy-code")) {
    const safeUrl = escapeHtml(actionUrl);
    const btnText = escapeHtml(actionLabel || "Continue to Login & Verify →");
    directBtn = `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px auto 0;">
        <tr>
          <td align="center" style="background-color:${accentColor};border-radius:8px;">
            <a href="${safeUrl}" target="_blank" style="background-color:${accentColor};border-radius:8px;color:#FFFFFF;display:inline-block;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;line-height:18px;text-align:center;text-decoration:none;padding:11px 24px;">
              ${btnText}
            </a>
          </td>
        </tr>
      </table>`;
  }

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 22px;background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;">
    <tr>
      <td align="center" style="padding:24px 20px;text-align:center;">
        <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.9px;margin-bottom:14px;">
          Security Verification Code
        </div>

        <div style="display:inline-block;background-color:#FFFFFF;border:1.5px solid #CBD5E1;border-radius:8px;padding:14px 28px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,Courier,monospace;font-size:32px;font-weight:800;letter-spacing:8px;color:#0F172A;user-select:all;-webkit-user-select:all;box-shadow:0 1px 3px rgba(15,23,42,0.05);">${safeCode}</div>

        <p style="margin:12px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#64748B;">
          Click code to select &bull; Use Ctrl+C or Cmd+C to copy
        </p>

        ${
          caption
            ? `<p style="margin:8px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#475569;font-weight:500;">${escapeHtml(caption)}</p>`
            : ""
        }

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
      const valueBg = index % 2 === 1 ? "#FAFCFF" : "#FFFFFF";
      return `<tr>
        <td style="padding:11px 16px;${border}font-size:12px;font-weight:600;color:#64748B;width:38%;vertical-align:middle;background-color:#F8FAFC;">
          ${escapeHtml(row.label)}
        </td>
        <td style="padding:11px 16px;${border}font-size:${emphasize ? "14px" : "13px"};font-weight:${emphasize ? "700" : "600"};color:#0F172A;text-align:right;vertical-align:middle;background-color:${valueBg};font-variant-numeric:tabular-nums;">
          ${formatValue(row.value)}
        </td>
      </tr>`;
    })
    .join("");

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;border-collapse:separate;border-spacing:0;">
    <tbody>
      ${rows}
    </tbody>
  </table>`;
}
