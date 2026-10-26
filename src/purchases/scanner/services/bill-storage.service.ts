import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";

export interface StoredFileMetadata {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storagePath: string;
}

@Injectable()
export class BillStorageService {
  private readonly logger = new Logger(BillStorageService.name);
  private readonly maxFileSizeBytes = 15 * 1024 * 1024; // 15 MB
  private readonly baseStorageDir = path.resolve(process.cwd(), "storage/bill-scans");

  constructor() {
    this.ensureStorageDir().catch((err) =>
      this.logger.error("Failed to initialize bill storage directory", err),
    );
  }

  private async ensureStorageDir() {
    await fs.mkdir(this.baseStorageDir, { recursive: true });
  }

  /**
   * Computes SHA-256 hash of a file buffer
   */
  computeSha256(buffer: Buffer): string {
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  /**
   * Validates magic bytes to guarantee file signature matches allowed types (PDF, JPEG, PNG)
   */
  validateFileSignature(buffer: Buffer): { mimeType: string; extension: string } {
    if (buffer.length < 4) {
      throw new BadRequestException("File is empty or truncated.");
    }

    // PDF magic bytes: %PDF- (0x25 0x50 0x44 0x46)
    if (
      buffer[0] === 0x25 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x44 &&
      buffer[3] === 0x46
    ) {
      return { mimeType: "application/pdf", extension: "pdf" };
    }

    // PNG magic bytes: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return { mimeType: "image/png", extension: "png" };
    }

    // JPEG magic bytes: 0xFF 0xD8 0xFF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { mimeType: "image/jpeg", extension: "jpg" };
    }

    // WebP magic bytes: RIFF....WEBP
    if (
      buffer.length >= 12 &&
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    ) {
      return { mimeType: "image/webp", extension: "webp" };
    }

    // HEIC/HEIF magic bytes: ISOBMFF box with 'ftyp' at bytes 4-7 and compatible brand
    if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
      const brand = buffer.toString("ascii", 8, 12).toLowerCase();
      const compatibleSlice = buffer.toString("ascii", 8, Math.min(buffer.length, 36)).toLowerCase();
      if (
        brand === "heic" || brand === "heix" || brand === "hevc" ||
        brand === "mif1" || brand === "msf1" || brand === "heim" || brand === "heis" ||
        compatibleSlice.includes("heic") || compatibleSlice.includes("mif1")
      ) {
        return { mimeType: "image/heic", extension: "heic" };
      }
    }

    // CSV, TSV or Plain text invoice data detection (e.g. exported reports or CSV bills uploaded as PDF/CSV)
    const textSample = buffer.slice(0, Math.min(buffer.length, 1024)).toString("utf8");
    const isTextContent = /^[\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]+$/.test(textSample.slice(0, 80));
    if (
      isTextContent &&
      (textSample.toLowerCase().includes("invoice") ||
        textSample.toLowerCase().includes("date") ||
        textSample.toLowerCase().includes("bill") ||
        textSample.toLowerCase().includes("party") ||
        textSample.toLowerCase().includes("customer") ||
        textSample.toLowerCase().includes("taxable") ||
        textSample.includes(",") ||
        textSample.includes("\t"))
    ) {
      return { mimeType: "text/csv", extension: "csv" };
    }

    throw new BadRequestException(
      "Invalid file type. Only standard PDF documents, JPG/JPEG, PNG, WebP, and HEIC image formats are supported.",
    );
  }

  /**
   * Validates and securely saves file inside the tenant-isolated private directory
   */
  async validateAndSaveFile(
    fileBuffer: Buffer,
    originalFileName: string,
    companyId: string,
    scanId: string,
  ): Promise<StoredFileMetadata> {
    if (fileBuffer.length > this.maxFileSizeBytes) {
      throw new BadRequestException(
        `File size exceeds maximum limit of ${this.maxFileSizeBytes / (1024 * 1024)} MB.`,
      );
    }

    // Validate true MIME type and signature
    let { mimeType, extension } = this.validateFileSignature(fileBuffer);

    // Convert HEIC/HEIF to JPEG on the server
    if (mimeType === "image/heic") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const heicConvert = require("heic-convert");
        const converted = await heicConvert({
          buffer: fileBuffer,
          format: "JPEG",
          quality: 0.88,
        });
        fileBuffer = Buffer.from(converted);
        mimeType = "image/jpeg";
        extension = "jpg";
        this.logger.log(`Successfully converted camera HEIC image to JPEG (${fileBuffer.length} bytes) for scan: ${scanId}`);
      } catch (heicErr: any) {
        this.logger.error("HEIC conversion failed:", heicErr);
        throw new BadRequestException(
          `HEIC/HEIF camera photo conversion failed: ${heicErr?.message || "Unsupported HEIC variant"}. Please capture in standard JPEG mode or choose from gallery.`,
        );
      }
    }

    const sha256 = this.computeSha256(fileBuffer);

    // Sanitize companyId and scanId (must be valid UUID format)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(companyId) || !uuidRegex.test(scanId)) {
      throw new BadRequestException("Invalid tenant or document identifier.");
    }

    // Tenant-isolated directory: storage/bill-scans/<companyId>/<scanId>.<ext>
    const tenantDir = path.join(this.baseStorageDir, companyId);
    const safeTargetFilePath = path.join(tenantDir, `${scanId}.${extension}`);

    // Path traversal defense
    const resolvedPath = path.resolve(safeTargetFilePath);
    if (!resolvedPath.startsWith(this.baseStorageDir)) {
      throw new BadRequestException("Path traversal or illegal file location detected.");
    }

    await fs.mkdir(tenantDir, { recursive: true });
    await fs.writeFile(resolvedPath, fileBuffer);

    // Relative storage path stored in DB
    const relativeStoragePath = path.relative(process.cwd(), resolvedPath);

    // Sanitize original filename (prevent XSS / header injection)
    const sanitizedFileName = path
      .basename(originalFileName || `bill.${extension}`)
      .replace(/[^a-zA-Z0-9._-]/g, "_");

    return {
      fileName: sanitizedFileName,
      mimeType,
      sizeBytes: fileBuffer.length,
      sha256,
      storagePath: relativeStoragePath,
    };
  }

  /**
   * Reads a stored bill file from private storage
   */
  async readFile(relativeStoragePath: string): Promise<Buffer> {
    const fullPath = path.resolve(process.cwd(), relativeStoragePath);
    if (!fullPath.startsWith(this.baseStorageDir)) {
      throw new BadRequestException("Access denied: File outside permitted storage root.");
    }

    try {
      return await fs.readFile(fullPath);
    } catch {
      throw new BadRequestException("Bill file not found on storage server.");
    }
  }
}
