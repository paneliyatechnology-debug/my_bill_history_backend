import { describe, it, expect } from "vitest";
import {
  validatePartyGstin,
  isValidGstinChecksum,
  calculateGstinChecksum,
  isValidStateCode,
} from "../src/common/validators/gstin.validator";

describe("Statutory GSTIN & State Code Validation Utility", () => {
  it("should validate official Indian state codes", () => {
    expect(isValidStateCode("24")).toBe(true); // Gujarat
    expect(isValidStateCode("27")).toBe(true); // Maharashtra
    expect(isValidStateCode("29")).toBe(true); // Karnataka
    expect(isValidStateCode("07")).toBe(true); // Delhi
    expect(isValidStateCode("99")).toBe(true); // Centre Jurisdiction
    expect(isValidStateCode("00")).toBe(false);
    expect(isValidStateCode("999")).toBe(false);
    expect(isValidStateCode("XX")).toBe(false);
  });

  it("should calculate accurate Luhn Modulo 36 checksums", () => {
    // 27AABCU9603R1Z -> checksum 'N'
    expect(calculateGstinChecksum("27AABCU9603R1Z")).toBe("N");

    // 29AAACI4150D1Z -> checksum 'X' (Infosys Karnataka)
    expect(calculateGstinChecksum("29AAACI4150D1Z")).toBe("X");

    // 27AAACT2727Q1Z -> checksum 'W' (TCS Maharashtra)
    expect(calculateGstinChecksum("27AAACT2727Q1Z")).toBe("W");

    // 24ABCDE1234F1Z -> checksum '6'
    expect(calculateGstinChecksum("24ABCDE1234F1Z")).toBe("6");
  });

  it("should verify valid GSTIN checksums and reject tampered ones", () => {
    expect(isValidGstinChecksum("27AABCU9603R1ZN")).toBe(true);
    expect(isValidGstinChecksum("29AAACI4150D1ZX")).toBe(true);
    expect(isValidGstinChecksum("27AAACT2727Q1ZW")).toBe(true);
    expect(isValidGstinChecksum("24ABCDE1234F1Z6")).toBe(true);

    // Tampered checksums
    expect(isValidGstinChecksum("24ABCDE1234F1Z5")).toBe(false);
    expect(isValidGstinChecksum("27AABCU9603R1ZA")).toBe(false);
    expect(isValidGstinChecksum("29AAACI4150D1Z9")).toBe(false);
  });

  it("should permit unregistered party with null or empty GSTIN", () => {
    const res1 = validatePartyGstin(null, "24");
    expect(res1.isValid).toBe(true);
    expect(res1.pan).toBeUndefined();

    const res2 = validatePartyGstin("", "24");
    expect(res2.isValid).toBe(true);
  });

  it("should reject invalid state codes", () => {
    const res = validatePartyGstin("24ABCDE1234F1Z6", "98");
    expect(res.isValid).toBe(false);
    expect(res.error).toContain("Invalid state code '98'");
  });

  it("should reject GSTIN when state code prefix mismatches party state", () => {
    // GSTIN begins with 27 (Maharashtra), but party stateCode is 24 (Gujarat)
    const res = validatePartyGstin("27AABCU9603R1ZN", "24");
    expect(res.isValid).toBe(false);
    expect(res.error).toContain(
      "GSTIN state code prefix '27' does not match party's state code '24'",
    );
  });

  it("should reject malformed GSTIN lengths or invalid characters", () => {
    const shortRes = validatePartyGstin("24ABCDE1234", "24");
    expect(shortRes.isValid).toBe(false);
    expect(shortRes.error).toContain("exactly 15 characters");

    const invalidCharRes = validatePartyGstin("24ABCDE1234F1!6", "24");
    expect(invalidCharRes.isValid).toBe(false);
    expect(invalidCharRes.error).toContain(
      "does not conform to statutory format",
    );
  });

  it("should extract correct PAN for valid GSTIN", () => {
    const res = validatePartyGstin("24ABCDE1234F1Z6", "24");
    expect(res.isValid).toBe(true);
    expect(res.pan).toBe("ABCDE1234F");
    expect(res.derivedStateCode).toBe("24");
  });
});
