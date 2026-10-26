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

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#F4F6F8;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;margin:0;padding:0;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
          <tr>
            <td style="background:#1E589D;border-radius:16px 16px 0 0;padding:22px 28px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1;font-weight:800;letter-spacing:-0.4px;">
                <span style="color:#FFFFFF;">myown</span><span style="color:#FFB067;">billbook</span>
              </div>
              <div style="font-family:Arial,Helvetica,sans-serif;color:#D6E4F5;font-size:12px;line-height:1.4;margin-top:6px;">
                Indian GST Billing, Inventory &amp; Accounting
              </div>
            </td>
          </tr>
          <tr>
            <td style="height:4px;background:#EA580C;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="background:#FFFFFF;padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif;color:#202124;">
              <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:800;color:#111827;">${escapeHtml(heading)}</h1>
              ${content.intro ? `<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#3F4754;">${escapeHtml(content.intro)}</p>` : ""}
              ${renderCode(content.code, content.codeCaption, content.copyUrl)}
              ${renderDetails(details)}
              ${paragraphs.map((paragraph) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:#3F4754;">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("")}
              ${content.note ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 16px;"><tr><td style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:12px;padding:12px 14px;font-size:13px;line-height:1.5;color:#9A3412;">${escapeHtml(content.note)}</td></tr></table>` : ""}
              ${content.gujaratiNote ? `<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#667085;">${escapeHtml(content.gujaratiNote)}</p>` : ""}
            </td>
          </tr>
          <tr>
            <td style="background:#F8FAFC;border-top:1px solid #E5E7EB;border-radius:0 0 16px 16px;padding:16px 28px 20px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#667085;">
                Sent by <strong style="color:#1E589D;">${escapeHtml(appName)}</strong>.
                If you did not request this message, you can ignore it.
              </p>
              <p style="margin:8px 0 0;font-size:11px;line-height:1.5;color:#98A2B3;">
                આ સંદેશ ${escapeHtml(appName)} તરફથી મોકલાયો છે. જો તમે વિનંતી ન કરી હોય, તો આ ઈમેલ અવગણો.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    appName,
    "",
    heading,
    content.intro || "",
    content.code ? `Copy this code: ${content.code}` : "",
    content.copyUrl ? `Copy button: ${content.copyUrl}` : "",
    content.codeCaption || "",
    ...details.map((row) => `${row.label}: ${row.value}`),
    ...paragraphs,
    content.note || "",
    content.gujaratiNote || "",
    "",
    `Sent by ${appName}. If you did not request this message, you can ignore it.`,
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n")
    .trim();

  return { html, text };
}

function renderCode(code?: string, caption?: string, copyUrl?: string): string {
  const digits = String(code || "").replace(/\D/g, "");
  if (digits.length < 4) return "";
  const cells = digits
    .split("")
    .map(
      (digit) =>
        `<td align="center" valign="middle" width="42" height="52" style="width:42px;height:52px;border:1px solid #FDBA74;border-radius:10px;background:#FFF7ED;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:800;color:#C2410C;">${escapeHtml(digit)}</td>`,
    )
    .join('<td width="8" style="width:8px;font-size:0;">&nbsp;</td>');
  const safeCode = escapeHtml(digits);
  const href = /^https?:\/\//i.test(copyUrl || "") ? escapeHtml(copyUrl || "") : "";
  // Gmail ignores padding on anchors and drops the click target when line-height is 1.
  // A solid border is part of the link box, so the whole orange control stays clickable.
  const button = href
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;">
        <tr>
          <td align="center" bgcolor="#EA580C" style="background-color:#EA580C;border-radius:8px;">
            <a href="${href}" target="_blank" style="background-color:#EA580C;border:16px solid #EA580C;border-radius:8px;color:#FFFFFF;display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:20px;text-align:center;text-decoration:none;">Copy code</a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;">
        <a href="${href}" target="_blank" style="color:#1E589D;text-decoration:underline;">Open the copy page</a>
      </p>`
    : "";
  const codeLink = href
    ? `<a href="${href}" target="_blank" style="color:#C2410C;font-family:Courier New,Courier,monospace;font-size:22px;font-weight:800;letter-spacing:3px;text-decoration:underline;">${safeCode}</a>`
    : safeCode;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 14px;">
    <tr>${cells}</tr>
  </table>
  ${button}
  <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111827;">Code: ${codeLink}</p>
  ${caption ? `<p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#667085;">${escapeHtml(caption)}</p>` : ""}`;
}

function formatValue(value: string): string {
  const safe = escapeHtml(value);
  if (/^https?:\/\/\S+$/i.test(value)) {
    return `<a href="${safe}" style="color:#1E589D;text-decoration:underline;word-break:break-all;">${safe}</a>`;
  }
  return safe;
}

function renderDetails(details: EmailDetail[]): string {
  if (!details.length) return "";
  const rows = details
    .map((row, index) => {
      const emphasize = EMPHASIS.test(row.label);
      const border = index === details.length - 1 ? "" : "border-bottom:1px solid #EEF2F6;";
      return `<tr>
        <td style="padding:11px 0;${border}font-size:12px;color:#667085;width:42%;vertical-align:top;">${escapeHtml(row.label)}</td>
        <td style="padding:11px 0;${border}font-size:${emphasize ? "16px" : "14px"};font-weight:700;color:#111827;text-align:right;vertical-align:top;">${formatValue(row.value)}</td>
      </tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border:1px solid #E5E7EB;border-radius:12px;padding:0 14px;">
    ${rows}
  </table>`;
}
