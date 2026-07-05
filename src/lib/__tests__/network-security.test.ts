import { describe, expect, it } from "@jest/globals";

import {
  assertRpcTransportAllowed,
  isLoopbackHttpUrl,
} from "../network-security";

describe("network security", () => {
  it("accepts bracketed IPv6 loopback HTTP RPC URLs", () => {
    expect(isLoopbackHttpUrl("http://[::1]:26657")).toBe(true);
    expect(() =>
      assertRpcTransportAllowed("http://[::1]:26657", false)
    ).not.toThrow();
  });

  it("rejects non-loopback IPv6 HTTP RPC URLs unless explicitly allowed", () => {
    const rpcUrl = "http://[2001:db8::1]:26657";

    expect(isLoopbackHttpUrl(rpcUrl)).toBe(false);
    expect(() => assertRpcTransportAllowed(rpcUrl, false)).toThrow(
      "HTTP RPC URLs are disabled"
    );
    expect(() => assertRpcTransportAllowed(rpcUrl, true)).not.toThrow();
  });
});
