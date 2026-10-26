export interface FinancialYearPeriod {
  id: string;
  companyId: string;
  name: string;
  startDate: Date | string;
  endDate: Date | string;
  isLocked: boolean;
}

export interface PeriodValidationResult {
  isAllowed: boolean;
  reason?: string;
  errorCode?:
    "FINANCIAL_YEAR_LOCKED" | "DATE_OUT_OF_PERIOD" | "COMPANY_MISMATCH";
}

/**
 * Validates that a voucher date falls within an unlocked, active financial year period for the specified company.
 */
export function validatePeriodAccess(
  voucherDateInput: Date | string,
  targetCompanyId: string,
  financialYear: FinancialYearPeriod,
): PeriodValidationResult {
  if (financialYear.companyId !== targetCompanyId) {
    return {
      isAllowed: false,
      reason: `Financial year ${financialYear.name} does not belong to company ${targetCompanyId}.`,
      errorCode: "COMPANY_MISMATCH",
    };
  }

  if (financialYear.isLocked) {
    return {
      isAllowed: false,
      reason: `Financial Year ${financialYear.name} is locked. Posting, editing, or deleting vouchers in locked accounting periods is strictly prohibited.`,
      errorCode: "FINANCIAL_YEAR_LOCKED",
    };
  }

  const vDate =
    voucherDateInput instanceof Date
      ? new Date(voucherDateInput.getTime())
      : new Date(voucherDateInput);
  const sDate =
    financialYear.startDate instanceof Date
      ? new Date(financialYear.startDate.getTime())
      : new Date(financialYear.startDate);
  const eDate =
    financialYear.endDate instanceof Date
      ? new Date(financialYear.endDate.getTime())
      : new Date(financialYear.endDate);

  // Normalize time components for pure date comparison
  vDate.setUTCHours(0, 0, 0, 0);
  sDate.setUTCHours(0, 0, 0, 0);
  eDate.setUTCHours(23, 59, 59, 999);

  if (vDate < sDate || vDate > eDate) {
    const sStr = sDate.toISOString().slice(0, 10);
    const eStr = eDate.toISOString().slice(0, 10);
    const vStr = vDate.toISOString().slice(0, 10);
    return {
      isAllowed: false,
      reason: `Voucher date (${vStr}) is outside financial year ${financialYear.name} bounds (${sStr} to ${eStr}).`,
      errorCode: "DATE_OUT_OF_PERIOD",
    };
  }

  return {
    isAllowed: true,
  };
}
