import { describe, expect, it } from "@jest/globals";

import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  pbkdf2DeriveKey,
  sha256Digest
} from "../crypto-polyfill";

function utf8(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "utf8"));
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

describe("crypto polyfill", () => {
  it("matches SHA-256 test vectors", () => {
    expect(hex(sha256Digest(utf8("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("matches PBKDF2-HMAC-SHA256 test vectors", async () => {
    await expect(pbkdf2DeriveKey(utf8("password"), utf8("salt"), 1)).resolves.toEqual(
      Uint8Array.from(Buffer.from("120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b", "hex"))
    );

    await expect(pbkdf2DeriveKey(utf8("password"), utf8("salt"), 2)).resolves.toEqual(
      Uint8Array.from(Buffer.from("ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43", "hex"))
    );
  });

  it("matches AES-256-GCM test vectors", () => {
    const encrypted = aesGcmEncrypt(new Uint8Array(32), new Uint8Array(12), new Uint8Array());

    expect(hex(encrypted)).toBe("530f8afbc74536b9a963b4f1c4cb738b");
    expect(aesGcmDecrypt(new Uint8Array(32), new Uint8Array(12), encrypted)).toEqual(new Uint8Array());
  });

  it("rejects tampered AES-GCM ciphertext", () => {
    const key = new Uint8Array(32);
    const iv = new Uint8Array(12);
    const encrypted = aesGcmEncrypt(key, iv, utf8("wallet-secret"));
    encrypted[0] ^= 1;

    expect(() => aesGcmDecrypt(key, iv, encrypted)).toThrow("authentication failed");
  });
});
