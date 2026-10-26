import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConfigService } from "@nestjs/config";
import { GstVerificationService } from "../src/gst/gst-verification.service";
import { TenantContext } from "@billing/shared-types";

describe("GstVerificationService (Backend Unit & Security)", () => {
  let service: GstVerificationService;
  let mockConfig: any;
  let mockPrisma: any;

  const sampleTenantCtx: TenantContext = {
    organizationId: "11111111-1111-1111-1111-111111111111",
    companyId: "22222222-2222-2222-2222-222222222222",
    userId: "33333333-3333-3333-3333-333333333333",
  };

  beforeEach(() => {
    mockConfig = {
      get: vi.fn((key: string) => {
        if (key === "GSTIN_PROVIDER") return "mock";
        if (key === "GSTIN_CACHE_TTL_SECONDS") return "86400";
        if (key === "NODE_ENV") return "test";
        return undefined;
      }),
    };

    mockPrisma = {
      executeBypassRls: vi.fn(async (cb) => {
        return cb({
          party: { findFirst: vi.fn().mockResolvedValue(null) },
          company: { findFirst: vi.fn().mockResolvedValue(null) },
        });
      }),
      party: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    service = new GstVerificationService(
      mockConfig as unknown as ConfigService,
      mockPrisma,
    );
  });

  describe("Input Normalization & Format Validation", () => {
    it("should reject non-string or empty GSTIN input with 400 Bad Request", async () => {
      await expect(
        service.verifyGstin(sampleTenantCtx, "" as any),
      ).rejects.toThrow("GSTIN is required");

      await expect(
        service.verifyGstin(sampleTenantCtx, null as any),
      ).rejects.toThrow("GSTIN is required");
    });

    it("should normalize lowercase and trimmed input", async () => {
      // 27AAAAA0000A1Z2 is a mathematically valid GSTIN with checksum '2'
      const res = await service.verifyGstin(
        sampleTenantCtx,
        "  27aaaaa0000a1z2  ",
      );

      expect(res.isValid).toBe(true);
      expect(res.gstin).toBe("27AAAAA0000A1Z2");
    });

    it("should reject GSTIN shorter than 15 characters without calling provider", async () => {
      const res = await service.verifyGstin(sampleTenantCtx, "27AAAAA0000A1");

      expect(res.isValid).toBe(false);
      expect(res.success).toBe(false);
      expect(res.error).toContain("exactly 15 characters");
    });

    it("should reject invalid state code prefix", async () => {
      const res = await service.verifyGstin(sampleTenantCtx, "00AAAAA0000A1Z5");

      expect(res.isValid).toBe(false);
      expect(res.error).toContain("Invalid state code");
    });

    it("should detect invalid checksum and suggest the correct check character", async () => {
      // 24ABCDE1234F1Z has checksum 6. Provide 5 instead.
      const res = await service.verifyGstin(sampleTenantCtx, "24ABCDE1234F1Z5");

      expect(res.isValid).toBe(false);
      expect(res.success).toBe(false);
      expect(res.calculatedChecksum).toBe("6");
      expect(res.actualChecksum).toBe("5");
      expect(res.suggestedGstin).toBe("24ABCDE1234F1Z6");
      expect(res.error).toContain("Invalid GSTIN checksum");
    });
  });

  describe("Provider Integration & Normalization", () => {
    it("should normalize valid provider data for active taxpayer", async () => {
      const res = await service.verifyGstin(sampleTenantCtx, "27AAAAA0000A1Z2");

      expect(res.success).toBe(true);
      expect(res.isValid).toBe(true);
      expect(res.legalName).toBe("EXAMPLE COMPANY PRIVATE LIMITED");
      expect(res.tradeName).toBe("Example Co");
      expect(res.registrationStatus).toBe("ACTIVE");
      expect(res.status).toBe("ACTIVE");
      expect(res.taxpayerType).toBe("Regular");
      expect(res.constitutionOfBusiness).toBe("Private Limited Company");
      expect(res.pan).toBe("AAAAA0000A");
      expect(res.stateCode).toBe("27");
      expect(res.address.city).toBe("Mumbai");
      expect(res.address.pincode).toBe("400001");
      expect(res.source).toBe("LIVE_API");
    });

    it("should accurately reflect CANCELLED status with warning message", async () => {
      const res = await service.verifyGstin(sampleTenantCtx, "24CANCL1234A1Z0");

      expect(res.success).toBe(true);
      expect(res.registrationStatus).toBe("CANCELLED");
      expect(res.message).toContain("CANCELLED");
      expect(res.messageGujarati).toContain("રદ");
    });

    it("should accurately reflect SUSPENDED status with warning message", async () => {
      const res = await service.verifyGstin(sampleTenantCtx, "24SUSPN1234A1ZH");

      expect(res.success).toBe(true);
      expect(res.registrationStatus).toBe("SUSPENDED");
      expect(res.message).toContain("SUSPENDED");
    });

    it("should handle GSTIN not found on provider gracefully", async () => {
      // 27AABCU9603R1ZN has valid checksum 'N' but does not exist in mock registry
      const res = await service.verifyGstin(sampleTenantCtx, "27AABCU9603R1ZN");

      expect(res.success).toBe(false);
      expect(res.isValid).toBe(false);
      expect(res.message).toContain("not found on the GST portal");
    });
  });

  describe("Caching Behavior", () => {
    it("should return cached result on subsequent calls with source CACHE", async () => {
      const firstRes = await service.verifyGstin(
        sampleTenantCtx,
        "27AAAAA0000A1Z2",
      );
      expect(firstRes.source).toBe("LIVE_API");

      const secondRes = await service.verifyGstin(
        sampleTenantCtx,
        "27AAAAA0000A1Z2",
      );
      expect(secondRes.source).toBe("CACHE");
      expect(secondRes.legalName).toBe(firstRes.legalName);
    });

    it("should bypass cache when forceRefresh is true", async () => {
      await service.verifyGstin(sampleTenantCtx, "27AAAAA0000A1Z2");

      const refreshed = await service.verifyGstin(
        sampleTenantCtx,
        "27AAAAA0000A1Z2",
        true, // forceRefresh
      );

      expect(refreshed.source).toBe("LIVE_API");
    });
  });

  describe("Security & Multi-Tenant Boundaries", () => {
    it("should detect if taxpayer already exists within the tenant company", async () => {
      mockPrisma.party.findFirst = vi
        .fn()
        .mockResolvedValueOnce({ id: "party-uuid-99" });

      const res = await service.verifyGstin(
        sampleTenantCtx,
        "27AAAAA0000A1Z2",
        true,
      );

      expect(res.alreadyExistsInCompany).toBe(true);
      expect(mockPrisma.party.findFirst).toHaveBeenCalledWith({
        where: {
          companyId: sampleTenantCtx.companyId,
          gstin: "27AAAAA0000A1Z2",
        },
        select: { id: true },
      });
    });

    it("should never expose internal credentials, tokens or API keys in response", async () => {
      const res = await service.verifyGstin(sampleTenantCtx, "27AAAAA0000A1Z2");

      const jsonStr = JSON.stringify(res);
      expect(jsonStr).not.toContain("api_key");
      expect(jsonStr).not.toContain("apiKey");
      expect(jsonStr).not.toContain("secret");
      expect(jsonStr).not.toContain("token");
    });
  });

  describe("Safe Fallback When Provider Unconfigured", () => {
    it("should not fabricate fake business names when provider key is missing", async () => {
      mockConfig.get = vi.fn((key: string) => {
        if (key === "GSTIN_PROVIDER") return "gstin_cloud";
        if (key === "GSTIN_CLOUD_API_KEY") return undefined;
        if (key === "GSTIN_CACHE_TTL_SECONDS") return "86400";
        if (key === "NODE_ENV") return "production"; // not test registry
        return undefined;
      });

      const unconfiguredService = new GstVerificationService(
        mockConfig as unknown as ConfigService,
        mockPrisma,
      );

      // 24ABCCE1234F1Z8 has valid checksum 8, 4th PAN char 'C' = Company
      const res = await unconfiguredService.verifyGstin(
        sampleTenantCtx,
        "24ABCCE1234F1Z8",
      );

      expect(res.isValid).toBe(true);
      expect(res.source).toBe("STATUTORY_DERIVATION");
      expect(res.legalName).toBeNull();
      expect(res.tradeName).toBeNull();
      expect(res.pan).toBe("ABCCE1234F");
      expect(res.constitutionOfBusiness).toBe("Company (Pvt Ltd / Ltd)");
      expect(res.message).toContain("configure GSTIN_CLOUD_API_KEY");
    });
  });
});
