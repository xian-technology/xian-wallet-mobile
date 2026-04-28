import { describe, expect, it } from "@jest/globals";

import {
  isRecognizedXianRecipient,
  parseAmountInput,
  parseIntegerInput,
  parsePositiveIntegerInput,
  parseTypedInput
} from "../runtime-input";

describe("runtime-input", () => {
  it("parses large integers as bigint", () => {
    expect(parseIntegerInput("9007199254740993")).toBe(9007199254740993n);
    expect(parsePositiveIntegerInput("42")).toBe(42);
    expect(parsePositiveIntegerInput("0")).toBeNull();
  });

  it("parses amounts without forcing oversized integers through Number", () => {
    expect(parseAmountInput("12.5")).toEqual({ __fixed__: "12.5" });
    expect(parseAmountInput("12,5")).toEqual({ __fixed__: "12.5" });
    expect(parseAmountInput("9007199254740993")).toBe(9007199254740993n);
    expect(parseAmountInput("-1")).toBeNull();
    expect(parseAmountInput("nope")).toBeNull();
  });

  it("parses typed contract inputs conservatively", () => {
    expect(parseTypedInput("9007199254740993", "int")).toBe(9007199254740993n);
    expect(parseTypedInput("0.5", "float")).toEqual({ __fixed__: "0.5" });
    expect(parseTypedInput("5", "float")).toEqual({ __fixed__: "5" });
    expect(parseTypedInput("true", "bool")).toBe(true);
    expect(parseTypedInput("{\"mode\":\"fast\"}", "dict")).toEqual({ mode: "fast" });
    expect(parseTypedInput("[1,2,3]", "list")).toEqual([1, 2, 3]);
    expect(parseTypedInput("hello", "str")).toBe("hello");
  });

  it("recognizes normal Xian recipients without requiring extra confirmation", () => {
    expect(isRecognizedXianRecipient("ab".repeat(32))).toBe(true);
    expect(isRecognizedXianRecipient("currency")).toBe(true);
    expect(isRecognizedXianRecipient("con_bridge_1")).toBe(true);
    expect(isRecognizedXianRecipient("qwe")).toBe(false);
    expect(isRecognizedXianRecipient("external:abc123")).toBe(false);
    expect(isRecognizedXianRecipient("0xabc123")).toBe(false);
  });
});
