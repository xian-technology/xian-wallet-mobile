import "react-native-get-random-values";

import { gcm } from "@noble/ciphers/aes";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

const AES_GCM_IV_BYTES = 12;
const AES_256_KEY_BYTES = 32;
const PBKDF2_KEY_BYTES = 32;

if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = () => {
    const b = new Uint8Array(16);
    globalThis.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
}

export function sha256Digest(data: Uint8Array): Uint8Array {
  return sha256(data);
}

export async function pbkdf2DeriveKey(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  return pbkdf2Async(sha256, password, salt, {
    c: iterations,
    dkLen: PBKDF2_KEY_BYTES,
    asyncTick: 10
  });
}

export function aesGcmEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Uint8Array {
  assertAesGcmParams(key, iv);
  return gcm(key, iv).encrypt(plaintext);
}

export function aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  assertAesGcmParams(key, iv);
  try {
    return gcm(key, iv).decrypt(data);
  } catch {
    throw new Error("authentication failed");
  }
}

function assertAesGcmParams(key: Uint8Array, iv: Uint8Array): void {
  if (key.length !== AES_256_KEY_BYTES) {
    throw new Error("AES-GCM key must be 32 bytes");
  }
  if (iv.length !== AES_GCM_IV_BYTES) {
    throw new Error("AES-GCM IV must be 12 bytes");
  }
}
