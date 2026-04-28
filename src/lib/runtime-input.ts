export type RuntimeFixed = { __fixed__: string };
export type RuntimeNumeric = number | bigint | RuntimeFixed;

const INTEGER_PATTERN = /^-?\d+$/;
const DECIMAL_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)$/;

function safeBigIntToNumber(value: bigint): number | bigint {
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
  return value >= minSafe && value <= maxSafe ? Number(value) : value;
}

function normalizeDecimalText(value: string): string {
  return value.trim().replace(",", ".");
}

function fixed(value: string): RuntimeFixed {
  return { __fixed__: value };
}

function parseFixedInput(value: string): RuntimeFixed | null {
  const trimmed = normalizeDecimalText(value);
  if (!DECIMAL_PATTERN.test(trimmed)) {
    return null;
  }
  return Number.isFinite(Number(trimmed)) ? fixed(trimmed) : null;
}

export function isRuntimeFixed(value: unknown): value is RuntimeFixed {
  return (
    typeof value === "object" &&
    value != null &&
    typeof (value as { __fixed__?: unknown }).__fixed__ === "string"
  );
}

export function formatRuntimeInput(value: RuntimeNumeric | null): string {
  if (value == null) {
    return "";
  }
  return isRuntimeFixed(value) ? value.__fixed__ : String(value);
}

export function parseIntegerInput(value: string): number | bigint | null {
  const trimmed = value.trim();
  if (!INTEGER_PATTERN.test(trimmed)) {
    return null;
  }
  return safeBigIntToNumber(BigInt(trimmed));
}

export function parsePositiveIntegerInput(value: string): number | bigint | null {
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
  const trimmed = normalizeDecimalText(value);
  if (INTEGER_PATTERN.test(trimmed)) {
    return parsePositiveIntegerInput(trimmed);
  }
  if (!DECIMAL_PATTERN.test(trimmed)) {
    return null;
  }
  const parsed = parseFixedInput(trimmed);
  if (parsed == null || Number(parsed.__fixed__) <= 0) {
    return null;
  }
  return parsed;
}

export function parseTypedInput(value: string, type: string): unknown {
  const trimmed = value.trim();
  switch (type) {
    case "int":
      return parseIntegerInput(trimmed) ?? trimmed;
    case "float": {
      return parseFixedInput(trimmed) ?? trimmed;
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
