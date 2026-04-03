// @ts-nocheck — Pure JS crypto; ArrayBufferLike noise
/**
 * Self-contained crypto polyfill for React Native.
 * No external crypto dependencies — just react-native-get-random-values for RNG.
 *
 * Provides: SHA-256, PBKDF2-SHA256, AES-256-GCM, getRandomValues, randomUUID
 */
import "react-native-get-random-values";
import * as ExpoCrypto from "expo-crypto";

// ─── randomUUID ──────────────────────────────────────────────

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

// ─── SHA-256 (FIPS 180-4) ────────────────────────────────────

const K256 = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

export function sha256Digest(data: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const bitLen = data.length * 8;
  // Padding: append 1 bit, zeros, then 64-bit length
  const padLen = 64 - ((data.length + 9) % 64);
  const totalLen = data.length + 1 + (padLen === 64 ? 0 : padLen) + 8;
  const padded = new Uint8Array(totalLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(totalLen - 4, bitLen >>> 0, false);
  dv.setUint32(totalLen - 8, (bitLen / 0x100000000) >>> 0, false);

  const w = new Uint32Array(64);

  for (let off = 0; off < totalLen; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = dv.getUint32(off + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i-15], 7) ^ rotr(w[i-15], 18) ^ (w[i-15] >>> 3);
      const s1 = rotr(w[i-2], 17) ^ rotr(w[i-2], 19) ^ (w[i-2] >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, h0); odv.setUint32(4, h1); odv.setUint32(8, h2); odv.setUint32(12, h3);
  odv.setUint32(16, h4); odv.setUint32(20, h5); odv.setUint32(24, h6); odv.setUint32(28, h7);
  return out;
}

// ─── Native SHA-256 via expo-crypto ──────────────────────────

async function nativeSha256(data: Uint8Array): Promise<Uint8Array> {
  const ab = await ExpoCrypto.digest(
    ExpoCrypto.CryptoDigestAlgorithm.SHA256,
    data
  );
  return new Uint8Array(ab);
}

// ─── HMAC-SHA256 (using native SHA-256) ──────────────────────

async function hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const blockSize = 64;
  let k = key.length > blockSize ? await nativeSha256(key) : key;
  const padded = new Uint8Array(blockSize);
  padded.set(k);

  const ipad = new Uint8Array(blockSize);
  const opad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    ipad[i] = padded[i] ^ 0x36;
    opad[i] = padded[i] ^ 0x5c;
  }

  const inner = new Uint8Array(blockSize + message.length);
  inner.set(ipad);
  inner.set(message, blockSize);
  const innerHash = await nativeSha256(inner);

  const outer = new Uint8Array(blockSize + 32);
  outer.set(opad);
  outer.set(innerHash, blockSize);
  return nativeSha256(outer);
}

// ─── PBKDF2-SHA256 (async, using native HMAC) ───────────────

export async function pbkdf2DeriveKey(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  // PBKDF2 with SHA-256, 32-byte output (single block, i=1)
  const u1Input = new Uint8Array(salt.length + 4);
  u1Input.set(salt);
  u1Input[salt.length + 3] = 1;

  let u = await hmacSha256(password, u1Input);
  const result = new Uint8Array(u);

  for (let i = 1; i < iterations; i++) {
    u = await hmacSha256(password, u);
    for (let j = 0; j < 32; j++) {
      result[j] ^= u[j];
    }
  }
  return result;
}

// ─── AES-256 block cipher ───────────────────────────────────

const SBOX = new Uint8Array([
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16,
]);

const RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];

function aesExpandKey(key: Uint8Array): Uint8Array[] {
  const nk = key.length / 4;
  const nr = nk + 6;
  const w: number[] = [];
  for (let i = 0; i < nk * 4; i++) w.push(key[i]);

  for (let i = nk; i < 4 * (nr + 1); i++) {
    let t = w.slice((i - 1) * 4, i * 4);
    if (i % nk === 0) {
      t = [SBOX[t[1]], SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]];
      t[0] ^= RCON[(i / nk) - 1];
    } else if (nk > 6 && i % nk === 4) {
      t = t.map((b) => SBOX[b]);
    }
    for (let j = 0; j < 4; j++) {
      w.push(w[(i - nk) * 4 + j] ^ t[j]);
    }
  }

  const roundKeys: Uint8Array[] = [];
  for (let r = 0; r <= nr; r++) {
    roundKeys.push(new Uint8Array(w.slice(r * 16, r * 16 + 16)));
  }
  return roundKeys;
}

function xtime(a: number): number {
  return (a << 1) ^ ((a & 0x80) ? 0x1b : 0);
}

function aesBlock(key: Uint8Array, input: Uint8Array): Uint8Array {
  const rk = aesExpandKey(key);
  const nr = rk.length - 1;
  const s = new Uint8Array(input);
  for (let i = 0; i < 16; i++) s[i] ^= rk[0][i];
  for (let r = 1; r <= nr; r++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    const t1 = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t1;
    const t2a = s[2]; const t2b = s[6]; s[2] = s[10]; s[6] = s[14]; s[10] = t2a; s[14] = t2b;
    const t3 = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t3;
    if (r < nr) {
      for (let c = 0; c < 4; c++) {
        const i = c * 4;
        const a0 = s[i], a1 = s[i+1], a2 = s[i+2], a3 = s[i+3];
        s[i]   = xtime(a0) ^ xtime(a1) ^ a1 ^ a2 ^ a3;
        s[i+1] = a0 ^ xtime(a1) ^ xtime(a2) ^ a2 ^ a3;
        s[i+2] = a0 ^ a1 ^ xtime(a2) ^ xtime(a3) ^ a3;
        s[i+3] = xtime(a0) ^ a0 ^ a1 ^ a2 ^ xtime(a3);
      }
    }
    for (let i = 0; i < 16; i++) s[i] ^= rk[r][i];
  }
  return s;
}

// ─── AES-GCM ─────────────────────────────────────────────────

function xorBlocks(a: Uint8Array, b: Uint8Array): Uint8Array {
  const r = new Uint8Array(16);
  for (let i = 0; i < 16; i++) r[i] = a[i] ^ b[i];
  return r;
}

function ghashMul(h: Uint8Array, x: Uint8Array): Uint8Array {
  let z = new Uint8Array(16);
  let v = new Uint8Array(h);
  for (let i = 0; i < 128; i++) {
    if ((x[i >> 3] >> (7 - (i & 7))) & 1) z = xorBlocks(z, v);
    const lsb = v[15] & 1;
    for (let j = 15; j > 0; j--) v[j] = ((v[j-1] & 1) << 7) | (v[j] >> 1);
    v[0] = v[0] >> 1;
    if (lsb) v[0] ^= 0xe1;
  }
  return z;
}

function incCounter(c: Uint8Array): Uint8Array {
  const r = new Uint8Array(c);
  for (let i = 15; i >= 12; i--) { r[i] = (r[i] + 1) & 0xff; if (r[i]) break; }
  return r;
}

function gctr(key: Uint8Array, icb: Uint8Array, input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  let cb = new Uint8Array(icb);
  for (let i = 0; i < input.length; i += 16) {
    const block = aesBlock(key, cb);
    const rem = Math.min(16, input.length - i);
    for (let j = 0; j < rem; j++) out[i+j] = input[i+j] ^ block[j];
    cb = incCounter(cb);
  }
  return out;
}

function ghashBlocks(h: Uint8Array, x: Uint8Array, data: Uint8Array): Uint8Array {
  let r = x;
  for (let i = 0; i < data.length; i += 16) {
    const block = new Uint8Array(16);
    block.set(data.slice(i, Math.min(i + 16, data.length)));
    r = ghashMul(h, xorBlocks(r, block));
  }
  return r;
}

function gcmTag(key: Uint8Array, h: Uint8Array, j0: Uint8Array, ct: Uint8Array): Uint8Array {
  let x = ghashBlocks(h, new Uint8Array(16), ct);
  const len = new Uint8Array(16);
  const dv = new DataView(len.buffer);
  dv.setUint32(8, (ct.length * 8) >>> 0);
  x = ghashMul(h, xorBlocks(x, len));
  const enc = aesBlock(key, j0);
  return xorBlocks(enc, x);
}

export function aesGcmEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const h = aesBlock(key, new Uint8Array(16));
  const j0 = new Uint8Array(16); j0.set(iv); j0[15] = 1;
  const ct = gctr(key, incCounter(j0), plaintext);
  const tag = gcmTag(key, h, j0, ct);
  const result = new Uint8Array(ct.length + 16);
  result.set(ct); result.set(tag, ct.length);
  return result;
}

export function aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length < 16) throw new Error("invalid ciphertext");
  const ct = data.slice(0, data.length - 16);
  const tag = data.slice(data.length - 16);
  const h = aesBlock(key, new Uint8Array(16));
  const j0 = new Uint8Array(16); j0.set(iv); j0[15] = 1;
  const computedTag = gcmTag(key, h, j0, ct);
  let diff = 0;
  for (let i = 0; i < 16; i++) diff |= tag[i] ^ computedTag[i];
  if (diff !== 0) throw new Error("authentication failed");
  return gctr(key, incCounter(j0), ct);
}
