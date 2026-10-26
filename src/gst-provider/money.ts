/** Integer paise arithmetic for statutory totals that are already stored at 2 decimal places. */
export function toPaise(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Amount is not a finite number.");
    }
    return Math.round(value * 100);
  }
  const trimmed = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Amount '${value}' is not a decimal number.`);
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ""] = unsigned.split(".");
  const paise =
    Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return negative ? -paise : paise;
}

export function fromPaise(paise: number): string {
  const negative = paise < 0;
  const absolute = Math.abs(paise);
  const whole = Math.floor(absolute / 100);
  const fraction = absolute % 100;
  return `${negative ? "-" : ""}${whole}.${String(fraction).padStart(2, "0")}`;
}

export function addPaise(values: Array<string | number>): number {
  return values.reduce<number>((sum, value) => sum + toPaise(value), 0);
}
