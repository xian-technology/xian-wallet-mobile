/**
 * Mobile wallet controller — portable business logic.
 * This is a simplified version of the browser wallet-core controller,
 * using the same crypto primitives and key derivation.
 */
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from "@scure/bip39";
// @ts-expect-error — wordlist export works at runtime
import { wordlist } from "@scure/bip39/wordlists/english";
import nacl from "tweetnacl";

import {
  type StoredWalletState,
  type StoredUnlockedSession,
  createMobileStore,
} from "./storage";
import {
  sha256Digest,
  pbkdf2DeriveKey,
  aesGcmEncrypt,
  aesGcmDecrypt,
} from "./crypto-polyfill";

const ENCODER = new TextEncoder();
// Lower than browser (250k) because each HMAC iteration crosses the
// JS↔native bridge. 10k iterations with AES-256-GCM is still strong
// for local device encryption. Wallets exported from mobile use this
// count and are NOT interchangeable with browser exports.
const ITERATIONS = 10_000;
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

const store = createMobileStore();

// ─── Crypto helpers ──────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function normalizeMnemonic(mnemonic: string): string | null {
  const normalized = mnemonic.trim().replace(/\s+/g, " ").toLowerCase();
  return validateMnemonic(normalized, wordlist) ? normalized : null;
}

// Key derivation — matches wallet-core exactly
async function derivePrivateKeyFromMnemonic(
  mnemonic: string,
  accountIndex: number = 0
): Promise<string> {
  const normalized = normalizeMnemonic(mnemonic);
  if (!normalized) throw new Error("invalid BIP39 mnemonic");

  const seed = await mnemonicToSeed(normalized);
  const context = ENCODER.encode("xian-wallet-seed-v1");

  if (accountIndex === 0) {
    const buffer = new Uint8Array(seed.length + context.length);
    buffer.set(seed, 0);
    buffer.set(context, seed.length);
    return bytesToHex(sha256Digest(buffer));
  }

  const indexBytes = new Uint8Array(4);
  new DataView(indexBytes.buffer).setUint32(0, accountIndex, false);
  const buffer = new Uint8Array(seed.length + context.length + 4);
  buffer.set(seed, 0);
  buffer.set(context, seed.length);
  buffer.set(indexBytes, seed.length + context.length);
  return bytesToHex(sha256Digest(buffer));
}

function getPublicKey(privateKeyHex: string): string {
  const seed = hexToBytes(privateKeyHex);
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  return bytesToHex(keyPair.publicKey);
}

// AES-GCM encryption (matches wallet-core format: salt(16) + iv(12) + ciphertext+tag)
async function encrypt(plaintext: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await pbkdf2DeriveKey(ENCODER.encode(password), salt, ITERATIONS);
  const data = ENCODER.encode(plaintext);
  const ct = aesGcmEncrypt(key, iv, data);
  // Pack: salt(16) + iv(12) + ciphertext+tag
  const packed = new Uint8Array(16 + 12 + ct.length);
  packed.set(salt, 0);
  packed.set(iv, 16);
  packed.set(ct, 28);
  return btoa(String.fromCharCode(...packed));
}

async function decrypt(encoded: string, password: string): Promise<string> {
  const packed = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const salt = packed.slice(0, 16);
  const iv = packed.slice(16, 28);
  const ct = packed.slice(28);
  const key = await pbkdf2DeriveKey(ENCODER.encode(password), salt, ITERATIONS);
  const plainBytes = aesGcmDecrypt(key, iv, ct);
  return new TextDecoder().decode(plainBytes);
}

// ─── Controller ──────────────────────────────────────────────

export function createWalletController() {
  let unlockedPrivateKey: string | null = null;
  let unlockedMnemonic: string | null = null;
  let unlockedPassword: string | null = null;

  async function persistSession(privateKey: string): Promise<void> {
    const session: StoredUnlockedSession = {
      privateKey,
      mnemonic: unlockedMnemonic ?? undefined,
      password: unlockedPassword ?? undefined,
      expiresAt: Date.now() + SESSION_TIMEOUT_MS,
    };
    await store.saveUnlockedSession(session);
  }

  async function restoreSession(): Promise<boolean> {
    if (unlockedPrivateKey) return true;
    const session = await store.loadUnlockedSession();
    if (!session || session.expiresAt <= Date.now()) {
      if (session) await store.clearUnlockedSession();
      return false;
    }
    unlockedPrivateKey = session.privateKey;
    unlockedMnemonic = session.mnemonic ?? null;
    unlockedPassword = session.password ?? null;
    return true;
  }

  async function clearSession(): Promise<void> {
    unlockedPrivateKey = null;
    unlockedMnemonic = null;
    unlockedPassword = null;
    await store.clearUnlockedSession();
  }

  return {
    async createWallet(opts: {
      password: string;
      mnemonic?: string;
      privateKey?: string;
    }): Promise<{ mnemonic?: string }> {
      let mnemonic: string | undefined;
      let privateKey: string;

      if (opts.privateKey) {
        privateKey = opts.privateKey;
      } else if (opts.mnemonic) {
        mnemonic = opts.mnemonic;
        privateKey = await derivePrivateKeyFromMnemonic(mnemonic);
      } else {
        mnemonic = generateMnemonic(wordlist, 128);
        privateKey = await derivePrivateKeyFromMnemonic(mnemonic);
      }

      const publicKey = getPublicKey(privateKey);
      const encryptedPrivateKey = await encrypt(privateKey, opts.password);
      const encryptedMnemonic = mnemonic
        ? await encrypt(mnemonic, opts.password)
        : undefined;

      const account = {
        index: 0,
        publicKey,
        encryptedPrivateKey,
        name: "Account 1",
      };

      const state: StoredWalletState = {
        publicKey,
        encryptedPrivateKey,
        encryptedMnemonic,
        seedSource: mnemonic ? "mnemonic" : "privateKey",
        mnemonicWordCount: mnemonic ? mnemonic.split(" ").length : undefined,
        accounts: [account],
        activeAccountIndex: 0,
        rpcUrl: "http://127.0.0.1:26657",
        dashboardUrl: "http://127.0.0.1:8080",
        activeNetworkId: "xian-local",
        networkPresets: [
          {
            id: "xian-local",
            name: "Local node",
            rpcUrl: "http://127.0.0.1:26657",
            dashboardUrl: "http://127.0.0.1:8080",
            builtin: true,
          },
        ],
        watchedAssets: [
          { contract: "currency", name: "Xian", symbol: "XIAN" },
        ],
        connectedOrigins: [],
        createdAt: new Date().toISOString(),
      };

      await store.saveState(state);

      unlockedPrivateKey = privateKey;
      unlockedMnemonic = mnemonic ?? null;
      unlockedPassword = opts.password;
      await persistSession(privateKey);

      return { mnemonic: mnemonic };
    },

    async unlock(password: string): Promise<void> {
      const state = await store.loadState();
      if (!state) throw new Error("no wallet configured");

      const privateKey = await decrypt(state.encryptedPrivateKey, password);
      const pubKey = getPublicKey(privateKey);
      if (pubKey !== state.publicKey) {
        throw new Error("decrypted key does not match stored wallet");
      }

      unlockedPrivateKey = privateKey;
      unlockedPassword = password;

      if (state.encryptedMnemonic) {
        try {
          unlockedMnemonic = await decrypt(state.encryptedMnemonic, password);
        } catch {
          unlockedMnemonic = null;
        }
      }

      await persistSession(privateKey);
    },

    async lock(): Promise<void> {
      await clearSession();
    },

    async isUnlocked(): Promise<boolean> {
      return restoreSession();
    },

    async addAccount(): Promise<void> {
      await restoreSession();
      if (!unlockedMnemonic || !unlockedPassword) {
        throw new Error("wallet must be unlocked");
      }
      const state = await store.loadState();
      if (!state) throw new Error("no wallet");

      const accounts = state.accounts ?? [];
      const nextIndex = accounts.length > 0
        ? Math.max(...accounts.map((a) => a.index)) + 1
        : 1;
      const pk = await derivePrivateKeyFromMnemonic(unlockedMnemonic, nextIndex);
      const pub = getPublicKey(pk);
      const enc = await encrypt(pk, unlockedPassword);

      accounts.push({
        index: nextIndex,
        publicKey: pub,
        encryptedPrivateKey: enc,
        name: `Account ${accounts.length + 1}`,
      });

      state.publicKey = pub;
      state.encryptedPrivateKey = enc;
      state.activeAccountIndex = nextIndex;
      state.accounts = accounts;
      await store.saveState(state);

      unlockedPrivateKey = pk;
      await persistSession(pk);
    },

    async switchAccount(index: number): Promise<void> {
      const state = await store.loadState();
      if (!state?.accounts) throw new Error("no accounts");

      const target = state.accounts.find((a) => a.index === index);
      if (!target) throw new Error("account not found");

      if (unlockedMnemonic) {
        const pk = await derivePrivateKeyFromMnemonic(unlockedMnemonic, index);
        unlockedPrivateKey = pk;
        state.publicKey = target.publicKey;
        state.encryptedPrivateKey = target.encryptedPrivateKey;
        state.activeAccountIndex = index;
        await store.saveState(state);
        await persistSession(pk);
      } else {
        state.publicKey = target.publicKey;
        state.encryptedPrivateKey = target.encryptedPrivateKey;
        state.activeAccountIndex = index;
        await store.saveState(state);
        await clearSession();
      }
    },

    async renameAccount(index: number, name: string): Promise<void> {
      const state = await store.loadState();
      if (!state?.accounts) throw new Error("no accounts");
      const target = state.accounts.find((a) => a.index === index);
      if (!target) throw new Error("account not found");
      target.name = name;
      await store.saveState(state);
    },

    async removeAccount(index: number): Promise<void> {
      if (index === 0) throw new Error("cannot remove primary account");
      const state = await store.loadState();
      if (!state?.accounts) throw new Error("no accounts");
      state.accounts = state.accounts.filter((a) => a.index !== index);
      if (state.activeAccountIndex === index && state.accounts.length > 0) {
        const primary = state.accounts[0]!;
        state.publicKey = primary.publicKey;
        state.encryptedPrivateKey = primary.encryptedPrivateKey;
        state.activeAccountIndex = primary.index;
      }
      await store.saveState(state);
    },

    async revealMnemonic(password: string): Promise<string> {
      const state = await store.loadState();
      if (!state?.encryptedMnemonic) throw new Error("no mnemonic stored");
      return decrypt(state.encryptedMnemonic, password);
    },

    async revealPrivateKey(password: string): Promise<string> {
      const state = await store.loadState();
      if (!state) throw new Error("no wallet");
      return decrypt(state.encryptedPrivateKey, password);
    },

    async exportWallet(password: string): Promise<Record<string, unknown>> {
      const state = await store.loadState();
      if (!state) throw new Error("no wallet");

      const backup: Record<string, unknown> = {
        version: 1,
        type: state.seedSource,
        accounts: (state.accounts ?? []).map((a) => ({ index: a.index, name: a.name })),
        activeAccountIndex: state.activeAccountIndex ?? 0,
        activeNetworkId: state.activeNetworkId,
        networkPresets: state.networkPresets.filter((p) => !p.builtin),
        watchedAssets: state.watchedAssets,
      };

      if (state.encryptedMnemonic) {
        backup.mnemonic = await decrypt(state.encryptedMnemonic, password);
      } else {
        backup.privateKey = await decrypt(state.encryptedPrivateKey, password);
      }

      return backup;
    },

    async removeWallet(): Promise<void> {
      await clearSession();
      await store.clearState();
    },

    getPublicKey,
    derivePrivateKeyFromMnemonic,
    encrypt,
    decrypt,
  };
}
