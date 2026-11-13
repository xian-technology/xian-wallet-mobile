import { isUnsafeMessageToSign, revealHiddenCharacters } from "../signing-policy";

describe("message signing policy", () => {
  it("allows ordinary text messages", () => {
    expect(isUnsafeMessageToSign("hello world")).toBe(false);
  });

  it("rejects empty and oversized messages", () => {
    expect(isUnsafeMessageToSign("")).toBe(true);
    expect(isUnsafeMessageToSign("x".repeat(10_001))).toBe(true);
  });

  it("rejects transaction-like JSON payloads", () => {
    expect(
      isUnsafeMessageToSign(
        JSON.stringify({
          payload: {
            chain_id: "xian-local",
            contract: "currency",
            function: "transfer",
            kwargs: { to: "bob", amount: 1 },
          },
        })
      )
    ).toBe(true);
    expect(isUnsafeMessageToSign(JSON.stringify({ contract: "currency" }))).toBe(true);
  });

  it("allows non-object JSON values", () => {
    expect(isUnsafeMessageToSign(JSON.stringify("hello"))).toBe(false);
  });
});

describe("hidden character reveal", () => {
  it("marks invisible and direction-changing characters", () => {
    expect(revealHiddenCharacters("pay alice\u202Eecilab\u200B\u2066")).toEqual({
      text: "pay alice[U+202E]ecilab[U+200B][U+2066]",
      revealed: true,
    });
  });

  it("labels control and astral tag characters by code point", () => {
    expect(revealHiddenCharacters("a\u0000b\u{E0041}")).toEqual({
      text: "a[U+0000]b[U+E0041]",
      revealed: true,
    });
  });

  it("keeps ordinary text, line breaks and tabs", () => {
    expect(revealHiddenCharacters("line one\nline two\ttabbed — ünïcode")).toEqual({
      text: "line one\nline two\ttabbed — ünïcode",
      revealed: false,
    });
  });
});
