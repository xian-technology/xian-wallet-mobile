/**
 * Web Crypto polyfill for React Native using react-native-quick-crypto.
 * Must be imported before any wallet-core code.
 */
import QuickCrypto from "react-native-quick-crypto";

// Polyfill globalThis.crypto with react-native-quick-crypto
if (!globalThis.crypto?.subtle) {
  // @ts-expect-error — quick-crypto provides a compatible Crypto interface
  globalThis.crypto = QuickCrypto;
}

// Polyfill randomUUID if not available
if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = (): `${string}-${string}-${string}-${string}-${string}` => {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`;
  };
}

// Polyfill TextEncoder/TextDecoder if needed
if (typeof globalThis.TextEncoder === "undefined") {
  // Basic TextEncoder polyfill for UTF-8
  globalThis.TextEncoder = class TextEncoder {
    readonly encoding = "utf-8";
    encode(input: string): Uint8Array {
      const buf = Buffer.from(input, "utf-8");
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    encodeInto(
      _input: string,
      _dest: Uint8Array
    ): { read: number; written: number } {
      throw new Error("encodeInto not implemented");
    }
  } as unknown as typeof TextEncoder;
}

if (typeof globalThis.TextDecoder === "undefined") {
  globalThis.TextDecoder = class TextDecoder {
    readonly encoding = "utf-8";
    readonly fatal = false;
    readonly ignoreBOM = false;
    decode(input?: ArrayBuffer | ArrayBufferView): string {
      if (!input) return "";
      const bytes =
        input instanceof ArrayBuffer
          ? Buffer.from(input)
          : Buffer.from(
              input.buffer,
              input.byteOffset,
              input.byteLength
            );
      return bytes.toString("utf-8");
    }
  } as unknown as typeof TextDecoder;
}

// Polyfill atob/btoa if needed
if (typeof globalThis.atob === "undefined") {
  globalThis.atob = (data: string): string =>
    Buffer.from(data, "base64").toString("binary");
}
if (typeof globalThis.btoa === "undefined") {
  globalThis.btoa = (data: string): string =>
    Buffer.from(data, "binary").toString("base64");
}
