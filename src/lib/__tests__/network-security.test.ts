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

it.each(["file:///tmp/rpc", "ftp://node.example", "ws://localhost:26657", "javascript:alert(1)", "data:application/json,{}"])("rejects unsupported RPC protocol %s even with HTTP opt-in", rpcUrl => {
  expect(() => assertRpcTransportAllowed(rpcUrl, true)).toThrow(/HTTP or HTTPS/);
  expect(() => assertRpcTransportAllowed(rpcUrl, false)).toThrow(/HTTP or HTTPS/);
});
it("accepts HTTPS endpoints", () => {
  expect(() => assertRpcTransportAllowed("https://node.example", false)).not.toThrow();
});
