import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";

@Injectable()
export class CompanyAssetsService {
  private readonly logger = new Logger(CompanyAssetsService.name);
  private readonly baseDir = path.resolve(process.cwd(), "storage/company-assets");

  constructor() {
    fs.mkdir(this.baseDir, { recursive: true }).catch((err) =>
      this.logger.error("Failed to create company assets folder", err),
    );
  }

  async saveImage(
    companyId: string,
    kind: "logo" | "signature",
    buffer: Buffer,
    maxBytes: number,
  ): Promise<{ fileName: string; mimeType: string; storagePath: string }> {
    if (!buffer?.length) {
      throw new BadRequestException("No image file was uploaded.");
    }
    if (buffer.length > maxBytes) {
      throw new BadRequestException(
        `Image must be smaller than ${Math.round(maxBytes / (1024 * 1024))} MB.`,
      );
    }
    const kindInfo = this.detectImage(buffer);
    const dir = path.join(this.baseDir, companyId);
    await fs.mkdir(dir, { recursive: true });
    const fileName = `${kind}.${kindInfo.extension}`;
    const storagePath = path.join(dir, fileName);
    await fs.writeFile(storagePath, buffer);
    return { fileName, mimeType: kindInfo.mimeType, storagePath };
  }

  async readImage(companyId: string, kind: "logo" | "signature") {
    const dir = path.join(this.baseDir, companyId);
    for (const ext of ["png", "jpg", "jpeg"]) {
      const storagePath = path.join(dir, `${kind}.${ext}`);
      try {
        const buffer = await fs.readFile(storagePath);
        return {
          buffer,
          mimeType: ext === "png" ? "image/png" : "image/jpeg",
          fileName: `${kind}.${ext}`,
        };
      } catch {
        // try next extension
      }
    }
    return null;
  }

  async deleteImage(companyId: string, kind: "logo" | "signature") {
    const dir = path.join(this.baseDir, companyId);
    for (const ext of ["png", "jpg", "jpeg"]) {
      await fs.unlink(path.join(dir, `${kind}.${ext}`)).catch(() => undefined);
    }
  }

  private detectImage(buffer: Buffer): { mimeType: string; extension: string } {
    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return { mimeType: "image/png", extension: "png" };
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { mimeType: "image/jpeg", extension: "jpg" };
    }
    throw new BadRequestException("Only PNG or JPG images are allowed.");
  }
}
