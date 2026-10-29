import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";

export interface InvoiceThemeRecord {
  id: string;
  name: string;
  category: "festive" | "standard" | "branding";
  festivalName?: string;
  description?: string;
  primaryColor: string;
  badge?: string; // "NEW" | "FESTIVE" | "POPULAR" | null
  thumbnail: string;
  variants: string[]; // background image URLs
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export const INITIAL_DEFAULT_THEMES: InvoiceThemeRecord[] = [
  {
    id: "logo",
    name: "Your logo",
    category: "branding",
    festivalName: "Your Logo",
    description: "Display your prominent company watermark and clean brand framing.",
    primaryColor: "#111827",
    badge: "BRAND",
    thumbnail: "/themes/navaratri_1.jpg",
    variants: [],
    isActive: true,
    sortOrder: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "navratri",
    name: "Navaratri",
    category: "festive",
    festivalName: "Navaratri",
    description: "Auspicious hanging temple bells, marigold genda phool toran & warm celebratory watercolor artwork.",
    primaryColor: "#F97316",
    badge: "FESTIVE",
    thumbnail: "/themes/navaratri_1.jpg",
    variants: ["/themes/navaratri_1.jpg", "/themes/navaratri_2.jpg"],
    isActive: true,
    sortOrder: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "durga_puja",
    name: "Durga Puja",
    category: "festive",
    festivalName: "Durga Puja",
    description: "Auspicious crimson red drapes, golden trishul, conch watermark and festive lotus motifs.",
    primaryColor: "#DC2626",
    badge: "FESTIVE",
    thumbnail: "/themes/durga_puja_1.jpg",
    variants: ["/themes/durga_puja_1.jpg"],
    isActive: true,
    sortOrder: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "dussehra",
    name: "Dussehra",
    category: "festive",
    festivalName: "Dussehra",
    description: "Vijayadashami royal palace silhouette, golden bow & arrow victory frame and saffron toran.",
    primaryColor: "#EA580C",
    badge: "FESTIVE",
    thumbnail: "/themes/dussehra_1.jpg",
    variants: ["/themes/dussehra_1.jpg"],
    isActive: true,
    sortOrder: 4,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "dhanteras",
    name: "Dhanteras",
    category: "festive",
    festivalName: "Dhanteras",
    description: "Golden kalash, overflowing gold coins and auspicious Lakshmi Puja festive letterhead stationery.",
    primaryColor: "#CA8A04",
    badge: "FESTIVE",
    thumbnail: "/themes/dhanteras_1.jpg",
    variants: ["/themes/dhanteras_1.jpg"],
    isActive: true,
    sortOrder: 5,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "diwali",
    name: "Diwali",
    category: "festive",
    festivalName: "Diwali",
    description: "Row of glowing golden clay diyas, fairy light sparkles and magnificent warm festive atmosphere.",
    primaryColor: "#7C3AED",
    badge: "POPULAR",
    thumbnail: "/themes/diwali_1.jpg",
    variants: ["/themes/diwali_1.jpg"],
    isActive: true,
    sortOrder: 6,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "stylish",
    name: "Stylish",
    category: "standard",
    description: "Clean modern bill without heavy boxes.",
    primaryColor: "#111827",
    badge: null,
    thumbnail: "/themes/navaratri_1.jpg",
    variants: [],
    isActive: true,
    sortOrder: 10,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "luxury",
    name: "Luxury",
    category: "standard",
    description: "Ornate double border, premium header and gold accent rules.",
    primaryColor: "#D97706",
    badge: "NEW",
    thumbnail: "/themes/navaratri_1.jpg",
    variants: [],
    isActive: true,
    sortOrder: 11,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "advanced_gst_tally",
    name: "Advanced GST (Tally)",
    category: "standard",
    description: "Full-height ruled GST invoice with rate lines and HSN summary, like Tally.",
    primaryColor: "#111827",
    badge: null,
    thumbnail: "/themes/navaratri_1.jpg",
    variants: [],
    isActive: true,
    sortOrder: 12,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

@Injectable()
export class InvoiceThemeManagerService {
  private readonly logger = new Logger(InvoiceThemeManagerService.name);
  private readonly dataFilePath = path.join(process.cwd(), "data", "invoice-themes.json");
  private themes: InvoiceThemeRecord[] = [];

  constructor() {
    this.loadThemes();
  }

  private loadThemes() {
    try {
      const dataDir = path.dirname(this.dataFilePath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (fs.existsSync(this.dataFilePath)) {
        const raw = fs.readFileSync(this.dataFilePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.themes = parsed;
          this.logger.log(`Loaded ${this.themes.length} invoice themes from file.`);
          return;
        }
      }
    } catch (err: any) {
      this.logger.warn(`Failed reading theme file, fallback to defaults: ${err?.message}`);
    }

    this.themes = [...INITIAL_DEFAULT_THEMES];
    this.persist();
  }

  private persist() {
    try {
      const dataDir = path.dirname(this.dataFilePath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(this.dataFilePath, JSON.stringify(this.themes, null, 2), "utf-8");
    } catch (err: any) {
      this.logger.error(`Failed persisting themes to file: ${err?.message}`);
    }
  }

  getAllThemes(onlyActive = false): InvoiceThemeRecord[] {
    const list = onlyActive ? this.themes.filter((t) => t.isActive) : this.themes;
    return [...list].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  getThemeById(id: string): InvoiceThemeRecord | undefined {
    return this.themes.find((t) => t.id === id);
  }

  createTheme(data: Partial<InvoiceThemeRecord>): InvoiceThemeRecord {
    const id =
      data.id?.trim() ||
      (data.name || "theme")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") + `_${Date.now().toString().slice(-4)}`;

    const newRecord: InvoiceThemeRecord = {
      id,
      name: data.name?.trim() || "New Theme",
      category: data.category || "festive",
      festivalName: data.festivalName || data.name || "Festive",
      description: data.description || "",
      primaryColor: data.primaryColor || "#F97316",
      badge: data.badge || "NEW",
      thumbnail: data.thumbnail || data.variants?.[0] || "/themes/navaratri_1.jpg",
      variants: Array.isArray(data.variants) && data.variants.length > 0 ? data.variants : [data.thumbnail || "/themes/navaratri_1.jpg"],
      isActive: data.isActive !== undefined ? data.isActive : true,
      sortOrder: data.sortOrder || this.themes.length + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // check if id already exists
    const idx = this.themes.findIndex((t) => t.id === id);
    if (idx >= 0) {
      this.themes[idx] = { ...this.themes[idx], ...newRecord, updatedAt: new Date().toISOString() };
    } else {
      this.themes.push(newRecord);
    }

    this.persist();
    return newRecord;
  }

  updateTheme(id: string, updates: Partial<InvoiceThemeRecord>): InvoiceThemeRecord {
    const idx = this.themes.findIndex((t) => t.id === id);
    if (idx === -1) {
      throw new Error(`Theme with id "${id}" not found`);
    }

    const current = this.themes[idx];
    const updated: InvoiceThemeRecord = {
      ...current,
      ...updates,
      id: current.id, // don't mutate primary id
      variants: Array.isArray(updates.variants) ? updates.variants : current.variants,
      updatedAt: new Date().toISOString(),
    };

    this.themes[idx] = updated;
    this.persist();
    return updated;
  }

  deleteTheme(id: string): boolean {
    const prevLen = this.themes.length;
    this.themes = this.themes.filter((t) => t.id !== id);
    if (this.themes.length !== prevLen) {
      this.persist();
      return true;
    }
    return false;
  }

  resetToDefaults(): InvoiceThemeRecord[] {
    this.themes = [...INITIAL_DEFAULT_THEMES];
    this.persist();
    return this.themes;
  }
}
