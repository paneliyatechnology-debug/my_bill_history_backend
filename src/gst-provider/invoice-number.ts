/**
 * Invoice numbers are compared after a documented normalization:
 * uppercase, then remove spaces and the separators `/`, `-`, `.`, and `_`.
 * Leading zeros are preserved so that `001` and `1` do not collapse into one key.
 */
export function normalizeInvoiceNumber(value: string): string {
  return value.toUpperCase().replace(/[\s/.\-_]/g, "");
}

export function returnPeriodBounds(period: string): { from: string; to: string } {
  if (!/^(0[1-9]|1[0-2])\d{4}$/.test(period)) {
    throw new Error(
      `Return period '${period}' must be MMYYYY, for example 042026.`,
    );
  }
  const month = Number(period.slice(0, 2));
  const year = Number(period.slice(2));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = period.slice(0, 2);
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function resolveReportPeriod(query: {
  fromDate?: string;
  toDate?: string;
  month?: number | string;
  year?: number | string;
}): { from?: string; to?: string } {
  if (query.month !== undefined && query.month !== "" && query.year) {
    const month = Number(query.month);
    const year = Number(query.year);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
      throw new Error("GSTR period month must be 1-12 and year must be a four-digit year.");
    }
    const mm = String(month).padStart(2, "0");
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      from: `${year}-${mm}-01`,
      to: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
    };
  }
  return {
    from: query.fromDate || undefined,
    to: query.toDate || undefined,
  };
}

export function isWithinPeriod(
  isoDate: string,
  bounds: { from?: string; to?: string },
): boolean {
  const day = isoDate.slice(0, 10);
  if (bounds.from && day < bounds.from) return false;
  if (bounds.to && day > bounds.to) return false;
  return true;
}
