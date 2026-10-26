import { Injectable, Logger } from "@nestjs/common";
import { TenantContext } from "@billing/shared-types";
import { DatabaseService } from "../../../database/database.service";
import { ExtractedBillDataDto, ExtractedBillItemInput } from "../schemas/bill-extraction.schema";

export interface SupplierMatchResult {
  matchedPartyId: string | null;
  matchedPartyName: string | null;
  matchedPartyGstin: string | null;
  matchedPartyScore: number;
  isNewSupplier: boolean;
}

export interface ItemMatchResult {
  matchedItemId: string | null;
  matchedItemName: string | null;
  matchedItemScore: number;
  matchType: "BARCODE" | "SKU" | "EXACT_NAME" | "FUZZY_NAME" | "NEW_PRODUCT";
  suggestedItems: Array<{
    id: string;
    name: string;
    sku?: string | null;
    score: number;
  }>;
}

@Injectable()
export class BillMatcherService {
  private readonly logger = new Logger(BillMatcherService.name);

  constructor(private readonly prisma: DatabaseService) {}

  /**
   * Tokenizes text into lowercase alphanumeric tokens for word-level matching
   */
  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/([0-9]+)([a-z]+)/gi, "$1 $2")
        .replace(/([a-z]+)([0-9]+)/gi, "$1 $2")
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 0),
    );
  }

  private getBigrams(str: string): Set<string> {
    const s = str.toLowerCase().replace(/[^a-z0-9]/g, "");
    const bigrams = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) {
      bigrams.add(s.slice(i, i + 2));
    }
    return bigrams;
  }

  /**
   * Calculates similarity between two strings (0.0 to 1.0) using token Jaccard and character bigrams
   */
  calculateSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    const cleanA = a.trim().toLowerCase();
    const cleanB = b.trim().toLowerCase();
    if (cleanA === cleanB) return 1.0;

    // 1. Token-level Jaccard
    const tokensA = this.tokenize(cleanA);
    const tokensB = this.tokenize(cleanB);
    let tokenScore = 0;
    if (tokensA.size > 0 && tokensB.size > 0) {
      let intersection = 0;
      for (const token of tokensA) {
        if (tokensB.has(token)) {
          intersection++;
        }
      }
      const union = new Set([...tokensA, ...tokensB]).size;
      tokenScore = union === 0 ? 0 : intersection / union;
    }

    // 2. Character-level bigram Dice coefficient
    const bgA = this.getBigrams(cleanA);
    const bgB = this.getBigrams(cleanB);
    let bigramScore = 0;
    if (bgA.size > 0 && bgB.size > 0) {
      let common = 0;
      for (const bg of bgA) {
        if (bgB.has(bg)) common++;
      }
      bigramScore = (2 * common) / (bgA.size + bgB.size);
    }

    return Math.max(tokenScore, bigramScore);
  }

  /**
   * Matches supplier from extracted bill against existing company Parties (tenant-scoped)
   */
  async matchSupplier(
    extractedSupplier: ExtractedBillDataDto["supplier"],
    tenant: TenantContext,
  ): Promise<SupplierMatchResult> {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const parties = await tx.party.findMany({
        where: {
          companyId: tenant.companyId,
          type: { in: ["SUPPLIER", "BOTH", "CUSTOMER"] },
        },
        select: {
          id: true,
          name: true,
          gstin: true,
          phone: true,
        },
      });

      if (!parties || parties.length === 0) {
        return {
          matchedPartyId: null,
          matchedPartyName: null,
          matchedPartyGstin: null,
          matchedPartyScore: 0,
          isNewSupplier: true,
        };
      }

      const extractedGstin = extractedSupplier?.gstin?.trim().toUpperCase();
      const extractedPhone = extractedSupplier?.phone?.trim().replace(/\D/g, "");
      const extractedName = extractedSupplier?.name?.trim() || "";

      // 1. Priority 1: Exact GSTIN match
      if (extractedGstin) {
        const gstinMatch = parties.find(
          (p) => p.gstin && p.gstin.trim().toUpperCase() === extractedGstin,
        );
        if (gstinMatch) {
          return {
            matchedPartyId: gstinMatch.id,
            matchedPartyName: gstinMatch.name,
            matchedPartyGstin: gstinMatch.gstin,
            matchedPartyScore: 100,
            isNewSupplier: false,
          };
        }
      }

      // 2. Priority 2: Phone number match (Only if supplier name is compatible, avoiding customer phone false matches)
      if (extractedPhone && extractedPhone.length >= 10) {
        const phoneMatch = parties.find(
          (p) =>
            p.phone &&
            p.phone.replace(/\D/g, "").endsWith(extractedPhone.slice(-10)),
        );
        if (phoneMatch) {
          const sim = extractedName ? this.calculateSimilarity(phoneMatch.name, extractedName) : 1.0;
          const pLower = phoneMatch.name.toLowerCase();
          const eLower = extractedName.toLowerCase();
          const nameRelates = !extractedName || sim >= 0.35 || pLower.includes(eLower) || eLower.includes(pLower);

          if (nameRelates) {
            return {
              matchedPartyId: phoneMatch.id,
              matchedPartyName: phoneMatch.name,
              matchedPartyGstin: phoneMatch.gstin,
              matchedPartyScore: 90,
              isNewSupplier: false,
            };
          }
        }
      }

      // 3. Priority 3: Fuzzy Name Similarity
      let bestMatch: any = null;
      let highestScore = 0;

      for (const party of parties) {
        const sim = this.calculateSimilarity(party.name, extractedName);
        if (sim > highestScore) {
          highestScore = sim;
          bestMatch = party;
        }
      }

      const scorePercent = Math.round(highestScore * 100);
      if (highestScore >= 0.65 && bestMatch) {
        return {
          matchedPartyId: bestMatch.id,
          matchedPartyName: bestMatch.name,
          matchedPartyGstin: bestMatch.gstin,
          matchedPartyScore: scorePercent,
          isNewSupplier: false,
        };
      }

      return {
        matchedPartyId: null,
        matchedPartyName: null,
        matchedPartyGstin: null,
        matchedPartyScore: scorePercent,
        isNewSupplier: true,
      };
    });
  }

  /**
   * Matches customer/buyer from extracted bill against existing company Parties (tenant-scoped)
   */
  async matchCustomer(
    extractedBuyer: ExtractedBillDataDto["buyer"],
    tenant: TenantContext,
  ): Promise<SupplierMatchResult> {
    if (!extractedBuyer) {
      return {
        matchedPartyId: null,
        matchedPartyName: null,
        matchedPartyGstin: null,
        matchedPartyScore: 0,
        isNewSupplier: true,
      };
    }
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const parties = await tx.party.findMany({
        where: {
          companyId: tenant.companyId,
          type: { in: ["CUSTOMER", "BOTH", "SUPPLIER"] },
        },
        select: {
          id: true,
          name: true,
          gstin: true,
          phone: true,
        },
      });

      if (!parties || parties.length === 0) {
        return {
          matchedPartyId: null,
          matchedPartyName: null,
          matchedPartyGstin: null,
          matchedPartyScore: 0,
          isNewSupplier: true,
        };
      }

      const extractedGstin = extractedBuyer?.gstin?.trim().toUpperCase();
      const extractedPhone = extractedBuyer?.phone?.trim().replace(/\D/g, "");
      const extractedName = extractedBuyer?.name?.trim() || "";

      // 1. Priority 1: Exact GSTIN match
      if (extractedGstin) {
        const gstinMatch = parties.find(
          (p) => p.gstin && p.gstin.trim().toUpperCase() === extractedGstin,
        );
        if (gstinMatch) {
          return {
            matchedPartyId: gstinMatch.id,
            matchedPartyName: gstinMatch.name,
            matchedPartyGstin: gstinMatch.gstin,
            matchedPartyScore: 100,
            isNewSupplier: false,
          };
        }
      }

      // 2. Priority 2: Phone number match
      if (extractedPhone && extractedPhone.length >= 10) {
        const phoneMatch = parties.find(
          (p) =>
            p.phone &&
            p.phone.replace(/\D/g, "").endsWith(extractedPhone.slice(-10)),
        );
        if (phoneMatch) {
          return {
            matchedPartyId: phoneMatch.id,
            matchedPartyName: phoneMatch.name,
            matchedPartyGstin: phoneMatch.gstin,
            matchedPartyScore: 90,
            isNewSupplier: false,
          };
        }
      }

      // 3. Priority 3: Fuzzy Name Similarity
      let bestMatch: any = null;
      let highestScore = 0;

      for (const p of parties) {
        const sim = this.calculateSimilarity(p.name, extractedName);
        if (sim > highestScore) {
          highestScore = sim;
          bestMatch = p;
        }
      }

      if (bestMatch && highestScore >= 0.65) {
        return {
          matchedPartyId: bestMatch.id,
          matchedPartyName: bestMatch.name,
          matchedPartyGstin: bestMatch.gstin,
          matchedPartyScore: Math.round(highestScore * 100),
          isNewSupplier: false,
        };
      }

      return {
        matchedPartyId: null,
        matchedPartyName: null,
        matchedPartyGstin: null,
        matchedPartyScore: Math.round(highestScore * 100),
        isNewSupplier: true,
      };
    });
  }

  /**
   * Matches an individual purchase line item against existing company Items (tenant-scoped)
   */
  async matchLineItem(
    item: Partial<ExtractedBillItemInput> & { description: string },
    companyItems: Array<{
      id: string;
      name: string;
      sku: string | null;
      barcode: string | null;
      hsnCode: string;
    }>,
  ): Promise<ItemMatchResult> {
    const rawText = (item.rawText || item.description || "").trim();
    const cleanDesc = item.description.trim().toLowerCase();
    const itemHsn = item.hsnCode?.trim();

    // 1. Exact Barcode Match
    if (item.rawText) {
      const barcodeMatch = companyItems.find(
        (it) => it.barcode && rawText.includes(it.barcode.trim()),
      );
      if (barcodeMatch) {
        return {
          matchedItemId: barcodeMatch.id,
          matchedItemName: barcodeMatch.name,
          matchedItemScore: 100,
          matchType: "BARCODE",
          suggestedItems: [],
        };
      }
    }

    // 2. Exact SKU Match
    const skuMatch = companyItems.find(
      (it) =>
        it.sku &&
        (cleanDesc.includes(it.sku.trim().toLowerCase()) ||
          rawText.toLowerCase().includes(it.sku.trim().toLowerCase())),
    );
    if (skuMatch) {
      return {
        matchedItemId: skuMatch.id,
        matchedItemName: skuMatch.name,
        matchedItemScore: 98,
        matchType: "SKU",
        suggestedItems: [],
      };
    }

    // 3. Exact Name Match
    const exactNameMatch = companyItems.find(
      (it) => it.name.trim().toLowerCase() === cleanDesc,
    );
    if (exactNameMatch) {
      return {
        matchedItemId: exactNameMatch.id,
        matchedItemName: exactNameMatch.name,
        matchedItemScore: 95,
        matchType: "EXACT_NAME",
        suggestedItems: [],
      };
    }

    // 4. Scored Similarity across Catalog
    const candidates: Array<{
      id: string;
      name: string;
      sku: string | null;
      score: number;
    }> = [];

    for (const it of companyItems) {
      let sim = this.calculateSimilarity(it.name, item.description);
      // Boost if HSN matches
      if (itemHsn && it.hsnCode && it.hsnCode.startsWith(itemHsn.slice(0, 4))) {
        sim = Math.min(1.0, sim + 0.15);
      }
      const score = Math.round(sim * 100);
      if (score >= 40) {
        candidates.push({
          id: it.id,
          name: it.name,
          sku: it.sku,
          score,
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    // If top candidate is confident (>= 75%)
    if (candidates.length > 0 && candidates[0].score >= 75) {
      return {
        matchedItemId: candidates[0].id,
        matchedItemName: candidates[0].name,
        matchedItemScore: candidates[0].score,
        matchType: "FUZZY_NAME",
        suggestedItems: candidates.slice(1, 4),
      };
    }

    // No confident match: Propose as NEW_PRODUCT, but provide close suggestions
    return {
      matchedItemId: null,
      matchedItemName: null,
      matchedItemScore: candidates[0]?.score || 0,
      matchType: "NEW_PRODUCT",
      suggestedItems: candidates.slice(0, 3),
    };
  }

  /**
   * Matches all line items in an extracted bill against the company's Item catalog
   */
  async matchAllItems(
    items: ExtractedBillItemInput[],
    tenant: TenantContext,
  ): Promise<ExtractedBillItemInput[]> {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const companyItems = await tx.item.findMany({
        where: { companyId: tenant.companyId, isActive: true },
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          hsnCode: true,
        },
      });

      const matchedResults: ExtractedBillItemInput[] = [];

      for (const item of items) {
        const match = await this.matchLineItem(
          { ...item, description: item.description || item.rawText || "Item" },
          companyItems,
        );
        matchedResults.push({
          ...item,
          matchedItemId: match.matchedItemId,
          matchedItemName: match.matchedItemName,
          matchedItemScore: match.matchedItemScore,
          matchType: match.matchType,
          suggestedItems: match.suggestedItems,
        });
      }

      return matchedResults;
    });
  }
}
