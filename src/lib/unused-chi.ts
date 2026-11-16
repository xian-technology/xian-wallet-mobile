/**
 * What a chi limit costs beyond what the call needs. Since execution revision
 * 14 a paid transaction pays the chi it uses plus half of the chi it supplies
 * but leaves unused (rounded down, burned).
 */

export type UnusedChiSeverity = "none" | "caution" | "high";

export interface UnusedChiCost {
  supplied: number;
  estimated: number;
  /** Supplied chi the call leaves unused. */
  unused: number;
  /** What the unused chi costs: half of it, rounded down. */
  extraChi: number;
  /** none: at most the SDK margin's 1 chi; high: the extra at least doubles the fee. */
  severity: UnusedChiSeverity;
}

function isChiCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function unusedChiCost(input: { supplied: number; estimated: number }): UnusedChiCost | null {
  const { supplied, estimated } = input;
  if (!isChiCount(supplied) || !isChiCount(estimated)) {
    return null;
  }
  const unused = Math.max(supplied - estimated, 0);
  const extraChi = Math.floor(unused / 2);
  const severity = extraChi <= 1 ? "none" : extraChi >= estimated ? "high" : "caution";
  return { supplied, estimated, unused, extraChi, severity };
}

/** A chi amount with its approximate XIAN cost at `chiRate` chi per XIAN. */
export function formatChiWithXian(value: number | bigint | null, chiRate: number | null): string {
  if (value == null) return "Not provided";
  const formatted = value.toLocaleString();
  if (typeof value !== "number" || !chiRate) return formatted;
  return `${formatted} (~${(value / chiRate).toLocaleString(undefined, { maximumFractionDigits: 8 })} XIAN)`;
}

/** The sentence that tells the user what the unused chi costs, or null when nothing does. */
export function unusedChiWarning(cost: UnusedChiCost, chiRate: number | null): string | null {
  if (cost.severity === "none") {
    return null;
  }
  const extra = formatChiWithXian(cost.extraChi, chiRate);
  const needed = `${cost.estimated.toLocaleString()} chi`;
  if (cost.severity === "high") {
    const multiple = Math.round(cost.supplied / cost.estimated).toLocaleString();
    return `This chi limit is ${multiple}x what the call needs (${needed}). Half of unused chi is charged: about ${extra} extra.`;
  }
  return `This chi limit leaves ${cost.unused.toLocaleString()} chi unused. Half of unused chi is charged: about ${extra} more than the call needs (${needed}).`;
}
