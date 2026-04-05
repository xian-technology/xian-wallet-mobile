export type RuntimeNumeric = number | bigint;

const INTEGER_PATTERN = /^-?\d+$/;
const DECIMAL_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)$/;

function safeBigIntToNumber(value: bigint): number | bigint {
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
  return value >= minSafe && value <= maxSafe ? Number(value) : value;
}

export function parseIntegerInput(value: string): RuntimeNumeric | null {
  const trimmed = value.trim();
  if (!INTEGER_PATTERN.test(trimmed)) {
    return null;
  }
  return safeBigIntToNumber(BigInt(trimmed));
}

export function parsePositiveIntegerInput(value: string): RuntimeNumeric | null {
  const parsed = parseIntegerInput(value);
  if (parsed == null) {
    return null;
  }
  if (typeof parsed === "bigint") {
    return parsed > 0n ? parsed : null;
  }
  return parsed > 0 ? parsed : null;
}

export function parseAmountInput(value: string): RuntimeNumeric | null {
  const trimmed = value.trim();
  if (INTEGER_PATTERN.test(trimmed)) {
    return parsePositiveIntegerInput(trimmed);
  }
  if (!DECIMAL_PATTERN.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseTypedInput(value: string, type: string): unknown {
  const trimmed = value.trim();
  switch (type) {
    case "int":
      return parseIntegerInput(trimmed) ?? trimmed;
    case "float": {
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : trimmed;
    }
    case "bool":
      return trimmed === "true";
    case "dict":
    case "list":
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    default:
      return trimmed;
  }
}
