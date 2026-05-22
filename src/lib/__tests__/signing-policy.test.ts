import { isUnsafeMessageToSign } from "../signing-policy";

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
