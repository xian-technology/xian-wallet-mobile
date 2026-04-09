/**
 * Mobile wallet controller — portable business logic.
 * This keeps wallet storage semantics aligned with wallet-core while using
 * the React Native crypto polyfill for encryption and derivation.
 */
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from "@scure/bip39";
// @ts-expect-error — wordlist export works at runtime
import { wordlist } from "@scure/bip39/wordlists/english";
import { Ed25519Signer, isValidEd25519Key } from "@xian-tech/client";

import {
  type StoredWalletState,
  type StoredUnlockedSession,
  createMobileStore
} from "./storage";
import {
  sha256Digest,
  pbkdf2DeriveKey,
  aesGcmEncrypt,
  aesGcmDecrypt
} from "./crypto-polyfill";

const ENCODER = new TextEncoder();
// Lower than browser (250k) because each HMAC iteration crosses the
// JS↔native bridge. Wallets exported from mobile therefore remain
// mobile-specific and should not be treated as browser-compatible blobs.
const ITERATIONS = 10_000;
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

const store = createMobileStore();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function normalizeMnemonic(mnemonic: string): string | null {
  const normalized = mnemonic.trim().replace(/\s+/g, " ").toLowerCase();
  return validateMnemonic(normalized, wordlist) ? normalized : null;
}

function normalizePrivateKeyInput(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().replace(/^0x/i, "").toLowerCase();
  if (!isValidEd25519Key(normalized)) {
    throw new Error("private key must be a 32-byte hex seed");
  }
  return normalized;
}

function requirePrivateKey(value: string | undefined): string {
  if (!value) {
    throw new Error("missing private key after decryption");
  }
  return value;
}

function encryptWithKey(plaintext: string, key: Uint8Array): string {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = aesGcmEncrypt(key, iv, ENCODER.encode(plaintext));
  return JSON.stringify({
    algorithm: "AES-GCM",
    keySource: "wallet-session-key",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext)
  });
}

function decryptWithKey(payload: string, key: Uint8Array): string {
  const parsed = JSON.parse(payload) as {
    keySource?: string;
    iv: string;
    ciphertext: string;
  };
  if (parsed.keySource !== "wallet-session-key") {
    throw new Error("payload is not encrypted with a wallet session key");
  }
  const plaintext = aesGcmDecrypt(
    key,
    base64ToBytes(parsed.iv),
    base64ToBytes(parsed.ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}

async function createWalletSessionKey(password: string): Promise<{
  walletEncryptionSalt: string;
  sessionKey: string;
}> {
  const walletEncryptionSalt = bytesToBase64(
    crypto.getRandomValues(new Uint8Array(16))
  );
  return {
    walletEncryptionSalt,
    sessionKey: await deriveWalletSessionKey(password, walletEncryptionSalt)
  };
}

async function deriveWalletSessionKey(
  password: string,
  walletEncryptionSalt: string
): Promise<string> {
  const key = await pbkdf2DeriveKey(
    ENCODER.encode(password),
    base64ToBytes(walletEncryptionSalt),
    ITERATIONS
  );
  return bytesToBase64(key);
}

function sessionKeyBytes(sessionKey: string): Uint8Array {
  const bytes = base64ToBytes(sessionKey);
  if (bytes.length !== 32) {
    throw new Error("wallet session key must be 32 bytes");
  }
  return bytes;
}

async function derivePrivateKeyFromMnemonic(
  mnemonic: string,
  accountIndex: number = 0
): Promise<string> {
  const normalized = normalizeMnemonic(mnemonic);
  if (!normalized) {
    throw new Error("invalid BIP39 mnemonic");
  }

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
  return new Ed25519Signer(privateKeyHex).address;
}

async function encryptPrivateKeyWithSessionKey(
  privateKey: string,
  sessionKey: string
): Promise<string> {
  const normalized = normalizePrivateKeyInput(privateKey);
  if (!normalized) {
    throw new Error("private key must be a 32-byte hex seed");
  }
  return encryptWithKey(normalized, sessionKeyBytes(sessionKey));
}

async function decryptPrivateKeyWithSessionKey(
  payload: string,
  sessionKey: string
): Promise<string> {
  const normalized = normalizePrivateKeyInput(
    decryptWithKey(payload, sessionKeyBytes(sessionKey))
  );
  if (!normalized) {
    throw new Error("missing private key after decryption");
  }
  return normalized;
}

async function encryptMnemonicWithSessionKey(
  mnemonic: string,
  sessionKey: string
): Promise<string> {
  const normalized = normalizeMnemonic(mnemonic);
  if (!normalized) {
    throw new Error("invalid BIP39 mnemonic");
  }
  return encryptWithKey(normalized, sessionKeyBytes(sessionKey));
}

async function decryptMnemonicWithSessionKey(
  payload: string,
  sessionKey: string
): Promise<string> {
  const normalized = normalizeMnemonic(
    decryptWithKey(payload, sessionKeyBytes(sessionKey))
  );
  if (!normalized) {
    throw new Error("missing mnemonic after decryption");
  }
  return normalized;
}

export function createWalletController() {
  let unlockedPrivateKey: string | null = null;
  let unlockedMnemonic: string | null = null;
  let unlockedSessionKey: string | null = null;

  async function persistSession(privateKey: string): Promise<void> {
    const session: StoredUnlockedSession = {
      privateKey,
      mnemonic: unlockedMnemonic ?? undefined,
      sessionKey: unlockedSessionKey as string,
      expiresAt: Date.now() + SESSION_TIMEOUT_MS
    };
    await store.saveUnlockedSession(session);
  }

  async function restoreSession(): Promise<boolean> {
    if (unlockedPrivateKey) {
      return true;
    }
    const session = await store.loadUnlockedSession();
    if (!session || session.expiresAt <= Date.now()) {
      if (session) {
        await store.clearUnlockedSession();
      }
      return false;
    }
    unlockedPrivateKey = session.privateKey;
    unlockedMnemonic = session.mnemonic ?? null;
    unlockedSessionKey = session.sessionKey;
    return true;
  }

  async function clearSession(): Promise<void> {
    unlockedPrivateKey = null;
    unlockedMnemonic = null;
    unlockedSessionKey = null;
    await store.clearUnlockedSession();
  }

  async function sessionKeyForState(
    state: StoredWalletState,
    password: string
  ): Promise<string> {
    return deriveWalletSessionKey(password, state.walletEncryptionSalt);
  }

  async function decryptPrivateKeyForState(
    state: StoredWalletState,
    password: string
  ): Promise<string> {
    return decryptPrivateKeyWithSessionKey(
      state.encryptedPrivateKey,
      await sessionKeyForState(state, password)
    );
  }

  async function decryptMnemonicForState(
    state: StoredWalletState,
    password: string
  ): Promise<string> {
    if (!state.encryptedMnemonic) {
      throw new Error("no mnemonic stored");
    }
    return decryptMnemonicWithSessionKey(
      state.encryptedMnemonic,
      await sessionKeyForState(state, password)
    );
  }

  return {
    async createWallet(opts: {
      password: string;
      mnemonic?: string;
      privateKey?: string;
      networkName?: string;
      chainId?: string;
      rpcUrl?: string;
      dashboardUrl?: string;
    }): Promise<{ mnemonic?: string }> {
      let mnemonic: string | undefined;
      let privateKey: string;

      if (opts.privateKey) {
        privateKey = normalizePrivateKeyInput(opts.privateKey) as string;
      } else if (opts.mnemonic) {
        mnemonic = normalizeMnemonic(opts.mnemonic) ?? undefined;
        if (!mnemonic) {
          throw new Error("invalid BIP39 mnemonic");
        }
        privateKey = await derivePrivateKeyFromMnemonic(mnemonic);
      } else {
        mnemonic = generateMnemonic(wordlist, 128);
        privateKey = await derivePrivateKeyFromMnemonic(mnemonic);
      }

      const publicKey = getPublicKey(privateKey);
      const { walletEncryptionSalt, sessionKey } = await createWalletSessionKey(
        opts.password
      );
      const encryptedPrivateKey = await encryptPrivateKeyWithSessionKey(
        privateKey,
        sessionKey
      );
      const encryptedMnemonic = mnemonic
        ? await encryptMnemonicWithSessionKey(mnemonic, sessionKey)
        : undefined;

      const account = {
        index: 0,
        publicKey,
        encryptedPrivateKey,
        name: "Account 1"
      };

      const DEFAULT_RPC_URL = "http://127.0.0.1:26657";
      const DEFAULT_DASHBOARD_URL = "http://127.0.0.1:8080";

      const setupRpcUrl = opts.rpcUrl?.trim() || DEFAULT_RPC_URL;
      const setupDashboardUrl = opts.dashboardUrl?.trim() || DEFAULT_DASHBOARD_URL;

      const localPreset = {
        id: "xian-local",
        name: "Local node",
        rpcUrl: DEFAULT_RPC_URL,
        dashboardUrl: DEFAULT_DASHBOARD_URL,
        builtin: true
      };

      const useLocalPreset =
        setupRpcUrl === localPreset.rpcUrl &&
        setupDashboardUrl === (localPreset.dashboardUrl ?? "");

      const customPreset = useLocalPreset
        ? undefined
        : {
            id: `custom-${Date.now()}`,
            name: opts.networkName?.trim() || "Custom network",
            rpcUrl: setupRpcUrl,
            dashboardUrl: setupDashboardUrl,
            chainId: opts.chainId?.trim() || undefined,
          };

      const activePreset = customPreset ?? localPreset;
      const networkPresets = customPreset
        ? [localPreset, customPreset]
        : [localPreset];

      const state: StoredWalletState = {
        publicKey,
        encryptedPrivateKey,
        encryptedMnemonic,
        walletEncryptionSalt,
        seedSource: mnemonic ? "mnemonic" : "privateKey",
        mnemonicWordCount: mnemonic ? mnemonic.split(" ").length : undefined,
        accounts: [account],
        activeAccountIndex: 0,
        rpcUrl: activePreset.rpcUrl,
        dashboardUrl: activePreset.dashboardUrl,
        activeNetworkId: activePreset.id,
        networkPresets,
        watchedAssets: [{ contract: "currency", name: "Xian", symbol: "XIAN", decimals: 8 }],
        connectedOrigins: [],
        createdAt: new Date().toISOString()
      };

      await store.saveState(state);

      unlockedPrivateKey = privateKey;
      unlockedMnemonic = mnemonic ?? null;
      unlockedSessionKey = sessionKey;
      await persistSession(privateKey);

      return { mnemonic };
    },

    async unlock(password: string): Promise<void> {
      const state = await store.loadState();
      if (!state) {
        throw new Error("no wallet configured");
      }

      const sessionKey = await sessionKeyForState(state, password);
      const privateKey = await decryptPrivateKeyWithSessionKey(
        state.encryptedPrivateKey,
        sessionKey
      );

      const pubKey = getPublicKey(privateKey);
      if (pubKey !== state.publicKey) {
        throw new Error("decrypted key does not match stored wallet");
      }

      unlockedPrivateKey = privateKey;
      unlockedSessionKey = sessionKey;

      if (state.encryptedMnemonic) {
        try {
          unlockedMnemonic = await decryptMnemonicWithSessionKey(
            state.encryptedMnemonic,
            sessionKey
          );
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
      if (!unlockedMnemonic || !unlockedSessionKey) {
        throw new Error("wallet must be unlocked");
      }
      const state = await store.loadState();
      if (!state) {
        throw new Error("no wallet");
      }

      const accounts = state.accounts ?? [];
      const nextIndex =
        accounts.length > 0 ? Math.max(...accounts.map((account) => account.index)) + 1 : 1;
      const privateKey = await derivePrivateKeyFromMnemonic(unlockedMnemonic, nextIndex);
      const publicKey = getPublicKey(privateKey);
      const encryptedPrivateKey = await encryptPrivateKeyWithSessionKey(
        privateKey,
        unlockedSessionKey
      );

      accounts.push({
        index: nextIndex,
        publicKey,
        encryptedPrivateKey,
        name: `Account ${accounts.length + 1}`
      });

      state.publicKey = publicKey;
      state.encryptedPrivateKey = encryptedPrivateKey;
      state.activeAccountIndex = nextIndex;
      state.accounts = accounts;
      await store.saveState(state);

      unlockedPrivateKey = privateKey;
      await persistSession(privateKey);
    },

    async switchAccount(index: number): Promise<void> {
      const state = await store.loadState();
      if (!state?.accounts) {
        throw new Error("no accounts");
      }

      const target = state.accounts.find((account) => account.index === index);
      if (!target) {
        throw new Error("account not found");
      }

      if (unlockedMnemonic) {
        const privateKey = await derivePrivateKeyFromMnemonic(unlockedMnemonic, index);
        unlockedPrivateKey = privateKey;
        state.publicKey = target.publicKey;
        state.encryptedPrivateKey = target.encryptedPrivateKey;
        state.activeAccountIndex = index;
        await store.saveState(state);
        await persistSession(privateKey);
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
      if (!state?.accounts) {
        throw new Error("no accounts");
      }
      const target = state.accounts.find((account) => account.index === index);
      if (!target) {
        throw new Error("account not found");
      }
      const duplicate = state.accounts.find(
        (account) =>
          account.index !== index && account.name.toLowerCase() === name.toLowerCase()
      );
      if (duplicate) {
        throw new Error(`An account named "${name}" already exists`);
      }
      target.name = name;
      await store.saveState(state);
    },

    async removeAccount(index: number): Promise<void> {
      if (index === 0) {
        throw new Error("cannot remove primary account");
      }
      const state = await store.loadState();
      if (!state?.accounts) {
        throw new Error("no accounts");
      }
      state.accounts = state.accounts.filter((account) => account.index !== index);
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
      if (!state?.encryptedMnemonic) {
        throw new Error("no mnemonic stored");
      }
      return decryptMnemonicForState(state, password);
    },

    async revealPrivateKey(password: string): Promise<string> {
      const state = await store.loadState();
      if (!state) {
        throw new Error("no wallet");
      }
      return decryptPrivateKeyForState(state, password);
    },

    async exportWallet(password: string): Promise<Record<string, unknown>> {
      const state = await store.loadState();
      if (!state) {
        throw new Error("no wallet");
      }

      const backup: Record<string, unknown> = {
        version: 1,
        type: state.seedSource,
        accounts: (state.accounts ?? []).map((account) => ({
          index: account.index,
          name: account.name
        })),
        activeAccountIndex: state.activeAccountIndex ?? 0,
        activeNetworkId: state.activeNetworkId,
        networkPresets: state.networkPresets.filter((preset) => !preset.builtin),
        watchedAssets: state.watchedAssets
      };

      if (state.encryptedMnemonic) {
        backup.mnemonic = await decryptMnemonicForState(state, password);
      } else {
        backup.privateKey = await decryptPrivateKeyForState(state, password);
      }

      return backup;
    },

    async removeWallet(): Promise<void> {
      await clearSession();
      await store.clearState();
    },

    getPublicKey,
    derivePrivateKeyFromMnemonic
  };
}
