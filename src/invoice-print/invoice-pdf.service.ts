import { Injectable, Logger } from "@nestjs/common";
import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);
  private readonly pdfDir = path.join(process.cwd(), "storage", "invoice-pdfs");

  constructor() {
    if (!fs.existsSync(this.pdfDir)) {
      try {
        fs.mkdirSync(this.pdfDir, { recursive: true });
      } catch (err: any) {
        this.logger.warn(`Could not create PDF storage directory: ${err?.message}`);
      }
    }
  }

  private resolveChromeBinary(): string | null {
    const candidates = [
      process.env.CHROME_BIN,
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
    ].filter(Boolean) as string[];

    for (const bin of candidates) {
      if (bin.startsWith("/") && fs.existsSync(bin)) {
        return bin;
      }
    }

    // Check system PATH directories
    const pathDirs = (process.env.PATH || "").split(":");
    const binaryNames = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
    for (const dir of pathDirs) {
      for (const name of binaryNames) {
        const fullPath = path.join(dir, name);
        if (fs.existsSync(fullPath)) {
          try {
            fs.accessSync(fullPath, fs.constants.X_OK);
            return fullPath;
          } catch {}
        }
      }
    }

    return null;
  }

  isChromeAvailable(): boolean {
    return this.resolveChromeBinary() !== null;
  }

  async getCachedPdf(invoiceId: string): Promise<Buffer | null> {
    const filePath = path.join(this.pdfDir, `${invoiceId}.pdf`);
    if (fs.existsSync(filePath)) {
      try {
        return fs.readFileSync(filePath);
      } catch {
        return null;
      }
    }
    return null;
  }

  async generatePdf(invoiceId: string, html: string): Promise<Buffer> {
    const chromeBin = this.resolveChromeBinary();
    if (!chromeBin) {
      throw new Error(
        "CHROME_NOT_FOUND: Google Chrome or Chromium executable is not installed on this server. Please install chromium-browser or set CHROME_BIN environment variable."
      );
    }
    const tempHtmlPath = path.join("/tmp", `invoice_${invoiceId}_${Date.now()}.html`);
    const outputPath = path.join(this.pdfDir, `${invoiceId}.pdf`);

    fs.writeFileSync(tempHtmlPath, html, "utf-8");

    return new Promise<Buffer>((resolve, reject) => {
      const args = [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-pdf-header-footer",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=3000",
        `--print-to-pdf=${outputPath}`,
        tempHtmlPath,
      ];

      execFile(chromeBin || "google-chrome", args, { timeout: 30000 }, (error, _stdout, stderr) => {
        // Cleanup temp HTML
        try {
          if (fs.existsSync(tempHtmlPath)) fs.unlinkSync(tempHtmlPath);
        } catch {}

        if (error) {
          this.logger.error(`Chrome headless PDF generation failed: ${error.message} - ${stderr}`);
          // Fallback if chrome error: return simple buffer or reject
          return reject(new Error(`Failed to generate PDF: ${error.message}`));
        }

        if (!fs.existsSync(outputPath)) {
          return reject(new Error("PDF file was not created by the renderer engine."));
        }

        try {
          const pdfBuffer = fs.readFileSync(outputPath);
          resolve(pdfBuffer);
        } catch (readErr: any) {
          reject(readErr);
        }
      });
    });
  }
}
