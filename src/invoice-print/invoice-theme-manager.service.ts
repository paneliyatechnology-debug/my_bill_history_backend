import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { DatabaseService } from "../database/database.service";

export interface InvoiceThemeRecord {
  id: string;
  name: string;
  category: "festive" | "standard" | "branding";
  festivalName?: string;
  description?: string;
  primaryColor: string;
  badge?: string | null;
  thumbnail: string;
  variants: string[];
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

function cleanThemeUrl(u?: string): string {
  if (!u) return "";
  const t = u.trim();
  if (!t) return "";
  if (
    t.startsWith("/") ||
    t.startsWith("http://") ||
    t.startsWith("https://") ||
    t.startsWith("data:")
  )
    return t;
  return `/${t}`;
}

@Injectable()
export class InvoiceThemeManagerService implements OnModuleInit {
  private readonly logger = new Logger(InvoiceThemeManagerService.name);

  constructor(private readonly prisma: DatabaseService) {}

  /**
   * Access the Prisma InvoiceTheme delegate safely across all IDE TypeScript language server versions
   */
  private get themeModel(): any {
    return (this.prisma as any).invoiceTheme;
  }

  async onModuleInit() {
    try {
      const count = await this.themeModel.count();
      this.logger.log(`InvoiceThemeManager initialized. Total DB themes: ${count}`);
    } catch (err: any) {
      this.logger.error(`Error initializing invoice themes table: ${err?.message}`);
    }
  }

  private mapToRecord(entity: any): InvoiceThemeRecord {
    const rawVariants = Array.isArray(entity.variants)
      ? entity.variants
      : typeof entity.variants === "string"
      ? JSON.parse(entity.variants || "[]")
      : [];

    return {
      id: entity.id,
      name: entity.name,
      category: (entity.category as any) || "festive",
      festivalName: entity.festivalName || undefined,
      description: entity.description || undefined,
      primaryColor: entity.primaryColor || "#F97316",
      badge: entity.badge || null,
      thumbnail: entity.thumbnail || "",
      variants: Array.isArray(rawVariants) ? rawVariants : [],
      isActive: entity.isActive,
      sortOrder: entity.sortOrder,
      createdAt:
        entity.createdAt instanceof Date
          ? entity.createdAt.toISOString()
          : String(entity.createdAt),
      updatedAt:
        entity.updatedAt instanceof Date
          ? entity.updatedAt.toISOString()
          : String(entity.updatedAt),
    };
  }

  async getAllThemes(onlyActive = false): Promise<InvoiceThemeRecord[]> {
    const list = await this.themeModel.findMany({
      where: onlyActive ? { isActive: true } : undefined,
      orderBy: { sortOrder: "asc" },
    });
    return list.map((item: any) => this.mapToRecord(item));
  }

  async getThemeById(id: string): Promise<InvoiceThemeRecord | null> {
    if (!id) return null;
    const found = await this.themeModel.findUnique({
      where: { id },
    });
    if (found) return this.mapToRecord(found);

    const stripped = id.replace(/_\d+$/, "");
    if (stripped !== id) {
      const foundBase = await this.themeModel.findUnique({
        where: { id: stripped },
      });
      if (foundBase) return this.mapToRecord(foundBase);
    }
    return null;
  }

  async createTheme(data: Partial<InvoiceThemeRecord>): Promise<InvoiceThemeRecord> {
    const id =
      data.id?.trim() ||
      (data.name || "theme")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") + `_${Date.now().toString().slice(-4)}`;

    const rawVariants =
      Array.isArray(data.variants) && data.variants.length > 0
        ? data.variants
        : [data.thumbnail || "/themes/navaratri_1.jpg"];
    const variants = rawVariants.map(cleanThemeUrl).filter(Boolean);
    const thumbnail =
      cleanThemeUrl(data.thumbnail) || variants[0] || "/themes/navaratri_1.jpg";

    const count = await this.themeModel.count();
    const created = await this.themeModel.create({
      data: {
        id,
        name: data.name?.trim() || "New Theme",
        category: data.category || "festive",
        festivalName: data.festivalName?.trim() || data.name?.trim() || "Festive",
        description: data.description?.trim() || "",
        primaryColor: data.primaryColor || "#F97316",
        badge: data.badge?.trim() || "NEW",
        thumbnail,
        variants: variants as any,
        isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
        sortOrder: data.sortOrder || count + 1,
      },
    });

    this.logger.log(`Created theme in DB: ${created.name} (${created.id})`);
    return this.mapToRecord(created);
  }

  async updateTheme(
    id: string,
    data: Partial<InvoiceThemeRecord>,
  ): Promise<InvoiceThemeRecord> {
    const existing = await this.themeModel.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Invoice theme "${id}" not found.`);
    }

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name.trim();
    if (data.category !== undefined) updateData.category = data.category;
    if (data.festivalName !== undefined)
      updateData.festivalName = data.festivalName.trim();
    if (data.description !== undefined)
      updateData.description = data.description.trim();
    if (data.primaryColor !== undefined)
      updateData.primaryColor = data.primaryColor;
    if (data.badge !== undefined)
      updateData.badge = data.badge?.trim() || null;
    if (data.isActive !== undefined)
      updateData.isActive = Boolean(data.isActive);
    if (data.sortOrder !== undefined)
      updateData.sortOrder = Number(data.sortOrder);
    if (data.variants !== undefined && Array.isArray(data.variants)) {
      updateData.variants = data.variants.map(cleanThemeUrl).filter(Boolean);
    }
    if (data.thumbnail !== undefined) {
      updateData.thumbnail = cleanThemeUrl(data.thumbnail);
    }

    const updated = await this.themeModel.update({
      where: { id },
      data: updateData,
    });

    this.logger.log(`Updated theme in DB: ${updated.name} (${updated.id})`);
    return this.mapToRecord(updated);
  }

  async deleteTheme(id: string): Promise<boolean> {
    try {
      await this.themeModel.delete({
        where: { id },
      });
      this.logger.log(`Deleted theme from DB: ${id}`);
      return true;
    } catch (err: any) {
      this.logger.warn(`Could not delete theme ${id}: ${err?.message}`);
      return false;
    }
  }

  async resetToDefaults(): Promise<InvoiceThemeRecord[]> {
    // Return all currently active themes from DB
    return this.getAllThemes(false);
  }

  saveUploadedThemeFile(
    originalFilename: string,
    buffer: Buffer,
  ): { url: string; fileName: string } {
    const ext = (path.extname(originalFilename || "") || ".jpg").toLowerCase();
    const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext)
      ? ext
      : ".jpg";
    const baseName = path
      .basename(originalFilename || "theme", ext)
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .substring(0, 40)
      .toLowerCase();
    const fileName = `${baseName || "theme"}_${Date.now()}${safeExt}`;

    // 1. Primary storage: storage/themes (persisted storage outside git tracking)
    const storageDir = path.join(process.cwd(), "storage", "themes");
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    fs.writeFileSync(path.join(storageDir, fileName), buffer);

    // 2. Also keep in public/themes so existing /themes/... URLs continue to serve seamlessly
    const publicDir = path.join(process.cwd(), "public", "themes");
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    fs.writeFileSync(path.join(publicDir, fileName), buffer);

    this.logger.log(
      `Saved theme asset file to storage/themes: ${fileName} (${buffer.length} bytes)`,
    );

    return {
      url: `/themes/${fileName}`,
      fileName,
    };
  }
}
