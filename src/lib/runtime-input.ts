import { fixed, parseContractJson } from "@xian-tech/client";

export type RuntimeFixed = { __fixed__: string };
export type RuntimeNumeric = number | bigint | RuntimeFixed;

const INTEGER_PATTERN = /^-?\d+$/;
const XIAN_ADDRESS_PATTERN = /^[0-9a-fA-F]{64}$/;
const XIAN_CONTRACT_NAME_PATTERN = /^(?:currency|con_[a-z0-9_]+)$/;

function safeBigIntToNumber(value: bigint): number | bigint {
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
  return value >= minSafe && value <= maxSafe ? Number(value) : value;
}

function normalizeDecimalText(value: string): string {
  return value.trim().replace(",", ".");
}

function parseFixedInput(value: string): RuntimeFixed | null {
  try {
    return fixed(normalizeDecimalText(value));
  } catch {
    return null;
  }
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

export function isRecognizedXianRecipient(value: string): boolean {
  return (
    XIAN_ADDRESS_PATTERN.test(value) || XIAN_CONTRACT_NAME_PATTERN.test(value)
  );
}

export function parseIntegerInput(value: string): number | bigint | null {
  const trimmed = value.trim();
  if (!INTEGER_PATTERN.test(trimmed)) {
    return null;
  }
  const parsed = BigInt(trimmed);
  return parsed <= -(1n << 512n) || parsed >= (1n << 512n) ? null : safeBigIntToNumber(parsed);
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
  const parsed = parseFixedInput(trimmed);
  if (parsed == null || parsed.__fixed__ === "0" || parsed.__fixed__.startsWith("-")) {
    return null;
  }
  return parsed;
}

export function parseTypedInput(value: string, type: string): unknown {
  const trimmed = value.trim();
  switch (type) {
    case "int": {
      const integer = parseIntegerInput(trimmed);
      if (integer == null) throw new Error("Enter an integer within the 512-bit limit.");
      return integer;
    }
    case "decimal": {
      return fixed(normalizeDecimalText(trimmed));
    }
    case "bool":
      return trimmed === "true";
    case "dict":
    case "list":
      return parseContractJson(trimmed);
    default:
      return trimmed;
  }
}
