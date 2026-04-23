/**
 * Mobile wallet controller — portable business logic.
 * This keeps wallet storage semantics aligned with wallet-core while using
 * the React Native crypto polyfill for encryption and derivation.
 */
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from "@scure/bip39";
// @ts-expect-error — wordlist export works at runtime
import { wordlist } from "@scure/bip39/wordlists/english";
import {
  Ed25519Signer,
  isValidEd25519Key,
  shieldedSyncHintFromViewingPrivateKey,
} from "@xian-tech/client";

import {
  type StoredWalletState,
  type StoredShieldedWalletSnapshot,
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

interface WalletBackup {
  version: 1;
  type: "privateKey" | "mnemonic";
  mnemonic?: string;
  privateKey?: string;
  accounts?: Array<{ index: number; name: string }>;
  activeAccountIndex?: number;
  activeNetworkId?: string;
  networkPresets?: Array<{
    id: string;
    name: string;
    chainId?: string;
    rpcUrl: string;
    dashboardUrl?: string;
    builtin?: boolean;
  }>;
  watchedAssets?: Array<{
    contract: string;
    name?: string;
    symbol?: string;
    icon?: string;
    decimals?: number;
  }>;
  shieldedStateSnapshots?: Array<{
    label: string;
    stateSnapshot: string;
  }>;
}

interface ParsedShieldedWalletSnapshot {
  normalizedSnapshot: string;
  assetId: string;
  syncHint: string;
  noteCount: number;
  commitmentCount: number;
  lastScannedIndex: number;
}

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

function trimOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseShieldedWalletSnapshot(
  stateSnapshot: string
): ParsedShieldedWalletSnapshot {
  let decoded: unknown;
  try {
    decoded = JSON.parse(stateSnapshot);
  } catch {
    throw new Error("shielded wallet snapshot must be valid JSON");
  }

  if (typeof decoded !== "object" || decoded == null || Array.isArray(decoded)) {
    throw new Error("shielded wallet snapshot must be a JSON object");
  }

  const record = decoded as Record<string, unknown>;
  const assetId =
    typeof record.asset_id === "string" ? trimOptionalString(record.asset_id) : undefined;
  if (!assetId) {
    throw new Error("shielded wallet snapshot must contain asset_id");
  }
  if (typeof record.owner_secret !== "string" || record.owner_secret.length === 0) {
    throw new Error("shielded wallet snapshot must contain owner_secret");
  }
  if (
    typeof record.viewing_private_key !== "string" ||
    record.viewing_private_key.length === 0
  ) {
    throw new Error(
      "shielded wallet snapshot must contain viewing_private_key"
    );
  }

  const notes = record.notes ?? [];
  if (!Array.isArray(notes)) {
    throw new Error("shielded wallet snapshot notes must be an array");
  }

  const commitments = record.commitments ?? [];
  if (!Array.isArray(commitments) || commitments.some((value) => typeof value !== "string")) {
    throw new Error(
      "shielded wallet snapshot commitments must be an array of strings"
    );
  }

  const lastScannedValue = record.last_scanned_index;
  const lastScannedIndex =
    typeof lastScannedValue === "number" &&
    Number.isInteger(lastScannedValue) &&
    lastScannedValue >= 0
      ? lastScannedValue
      : commitments.length;

  return {
    normalizedSnapshot: JSON.stringify(record),
    assetId,
    syncHint: shieldedSyncHintFromViewingPrivateKey(record.viewing_private_key),
    noteCount: notes.length,
    commitmentCount: commitments.length,
    lastScannedIndex,
  };
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

  function storedShieldedWalletSnapshots(
    state: StoredWalletState
  ): StoredShieldedWalletSnapshot[] {
    return [...(state.shieldedWalletSnapshots ?? [])].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    );
  }

  async function exportShieldedWalletSnapshots(
    state: StoredWalletState,
    sessionKey: string
  ): Promise<NonNullable<WalletBackup["shieldedStateSnapshots"]>> {
    const exported: NonNullable<WalletBackup["shieldedStateSnapshots"]> = [];
    for (const record of storedShieldedWalletSnapshots(state)) {
      exported.push({
        label: record.label,
        stateSnapshot: decryptWithKey(
          record.encryptedStateSnapshot,
          sessionKeyBytes(sessionKey)
        ),
      });
    }
    return exported;
  }

  async function importShieldedWalletSnapshots(
    snapshots: WalletBackup["shieldedStateSnapshots"] | undefined,
    sessionKey: string,
    nowIso: string
  ): Promise<StoredShieldedWalletSnapshot[]> {
    const imported: StoredShieldedWalletSnapshot[] = [];
    for (const item of snapshots ?? []) {
      if (
        typeof item !== "object" ||
        item == null ||
        typeof item.label !== "string" ||
        typeof item.stateSnapshot !== "string"
      ) {
        throw new Error(
          "backup shieldedStateSnapshots must contain label and stateSnapshot"
        );
      }
      const parsed = parseShieldedWalletSnapshot(item.stateSnapshot);
      imported.push({
        id: globalThis.crypto.randomUUID(),
        label: trimOptionalString(item.label) ?? parsed.assetId,
        assetId: parsed.assetId,
        syncHint: parsed.syncHint,
        encryptedStateSnapshot: encryptWithKey(
          parsed.normalizedSnapshot,
          sessionKeyBytes(sessionKey)
        ),
        noteCount: parsed.noteCount,
        commitmentCount: parsed.commitmentCount,
        lastScannedIndex: parsed.lastScannedIndex,
        updatedAt: nowIso,
      });
    }
    return imported;
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
        shieldedWalletSnapshots: [],
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
      await restoreSession();
      const state = await store.loadState();
      if (!state?.accounts) {
        throw new Error("no accounts");
      }
      const removedActiveAccount = state.activeAccountIndex === index;
      state.accounts = state.accounts.filter((account) => account.index !== index);
      if (removedActiveAccount && state.accounts.length > 0) {
        const primary = state.accounts[0]!;
        state.publicKey = primary.publicKey;
        state.encryptedPrivateKey = primary.encryptedPrivateKey;
        state.activeAccountIndex = primary.index;

        if (unlockedMnemonic && unlockedSessionKey) {
          const privateKey = await derivePrivateKeyFromMnemonic(
            unlockedMnemonic,
            primary.index
          );
          unlockedPrivateKey = privateKey;
          await persistSession(privateKey);
        } else if (unlockedPrivateKey) {
          await clearSession();
        }
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

    async exportWallet(password: string): Promise<WalletBackup> {
      const state = await store.loadState();
      if (!state) {
        throw new Error("no wallet");
      }
      const sessionKey = await sessionKeyForState(state, password);

      const backup: WalletBackup = {
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
        backup.mnemonic = await decryptMnemonicWithSessionKey(
          state.encryptedMnemonic,
          sessionKey
        );
      } else {
        backup.privateKey = await decryptPrivateKeyWithSessionKey(
          state.encryptedPrivateKey,
          sessionKey
        );
      }

      const shieldedStateSnapshots = await exportShieldedWalletSnapshots(
        state,
        sessionKey
      );
      if (shieldedStateSnapshots.length > 0) {
        backup.shieldedStateSnapshots = shieldedStateSnapshots;
      }

      return backup;
    },

    async importWalletBackup(backup: WalletBackup, password: string): Promise<void> {
      let mnemonic: string | undefined;
      let primaryKey: string;

      if (backup.type === "mnemonic" && backup.mnemonic) {
        mnemonic = normalizeMnemonic(backup.mnemonic) ?? undefined;
        if (!mnemonic) {
          throw new Error("invalid BIP39 mnemonic");
        }
        primaryKey = await derivePrivateKeyFromMnemonic(mnemonic, 0);
      } else if (backup.privateKey) {
        primaryKey = normalizePrivateKeyInput(backup.privateKey) as string;
      } else {
        throw new Error("backup must contain a mnemonic or private key");
      }

      const { walletEncryptionSalt, sessionKey } = await createWalletSessionKey(
        password
      );
      const nowIso = new Date().toISOString();
      const encryptedMnemonic = mnemonic
        ? await encryptMnemonicWithSessionKey(mnemonic, sessionKey)
        : undefined;

      const accountEntries = backup.accounts;
      if (!accountEntries || accountEntries.length === 0) {
        throw new Error("backup must contain at least one account");
      }

      const accounts: StoredWalletState["accounts"] = [];
      const privateKeysByIndex = new Map<number, string>();
      for (const entry of accountEntries) {
        const key = mnemonic
          ? await derivePrivateKeyFromMnemonic(mnemonic, entry.index)
          : primaryKey;
        privateKeysByIndex.set(entry.index, key);
        accounts.push({
          index: entry.index,
          publicKey: getPublicKey(key),
          encryptedPrivateKey: await encryptPrivateKeyWithSessionKey(
            key,
            sessionKey
          ),
          name: entry.name,
        });
      }

      const activeAccount =
        accounts.find((account) => account.index === backup.activeAccountIndex) ??
        accounts[0];
      if (!activeAccount) {
        throw new Error("backup must contain at least one account");
      }

      const activePrivateKey =
        privateKeysByIndex.get(activeAccount.index) ?? primaryKey;

      const localPreset = {
        id: "xian-local",
        name: "Local node",
        rpcUrl: "http://127.0.0.1:26657",
        dashboardUrl: "http://127.0.0.1:8080",
        builtin: true,
      };
      const networkPresets: StoredWalletState["networkPresets"] = [localPreset];
      for (const preset of backup.networkPresets ?? []) {
        if (!networkPresets.some((existing) => existing.id === preset.id)) {
          networkPresets.push(preset);
        }
      }
      const activePreset =
        networkPresets.find((preset) => preset.id === backup.activeNetworkId) ??
        networkPresets[0];
      if (!activePreset) {
        throw new Error("backup must contain at least one network preset");
      }

      const watchedAssets =
        backup.watchedAssets && backup.watchedAssets.length > 0
          ? backup.watchedAssets
          : [{ contract: "currency", name: "Xian", symbol: "XIAN", decimals: 8 }];
      const shieldedWalletSnapshots = await importShieldedWalletSnapshots(
        backup.shieldedStateSnapshots,
        sessionKey,
        nowIso
      );

      await clearSession();
      await store.saveState({
        publicKey: activeAccount.publicKey,
        encryptedPrivateKey: activeAccount.encryptedPrivateKey,
        encryptedMnemonic,
        walletEncryptionSalt,
        seedSource: backup.type,
        mnemonicWordCount: mnemonic ? mnemonic.split(" ").length : undefined,
        accounts,
        activeAccountIndex: activeAccount.index,
        rpcUrl: activePreset.rpcUrl,
        dashboardUrl: activePreset.dashboardUrl,
        activeNetworkId: activePreset.id,
        networkPresets,
        watchedAssets,
        shieldedWalletSnapshots,
        connectedOrigins: [],
        createdAt: nowIso,
      });

      unlockedPrivateKey = activePrivateKey;
      unlockedMnemonic = mnemonic ?? null;
      unlockedSessionKey = sessionKey;
      await persistSession(activePrivateKey);
    },

    async saveShieldedWalletSnapshot(
      stateSnapshot: string,
      label?: string
    ): Promise<void> {
      if (!(await restoreSession()) || !unlockedSessionKey) {
        throw new Error("wallet must be unlocked");
      }
      const state = await store.loadState();
      if (!state) {
        throw new Error("no wallet");
      }
      const parsed = parseShieldedWalletSnapshot(stateSnapshot);
      const resolvedLabel = trimOptionalString(label) ?? parsed.assetId;
      const existing = storedShieldedWalletSnapshots(state).find(
        (record) =>
          record.assetId === parsed.assetId && record.label === resolvedLabel
      );
      const nextRecord: StoredShieldedWalletSnapshot = {
        id: existing?.id ?? globalThis.crypto.randomUUID(),
        label: resolvedLabel,
        assetId: parsed.assetId,
        syncHint: parsed.syncHint,
        encryptedStateSnapshot: encryptWithKey(
          parsed.normalizedSnapshot,
          sessionKeyBytes(unlockedSessionKey)
        ),
        noteCount: parsed.noteCount,
        commitmentCount: parsed.commitmentCount,
        lastScannedIndex: parsed.lastScannedIndex,
        updatedAt: new Date().toISOString(),
      };

      state.shieldedWalletSnapshots = [
        nextRecord,
        ...storedShieldedWalletSnapshots(state).filter(
          (record) => record.id !== nextRecord.id
        ),
      ];
      await store.saveState(state);
    },

    async exportShieldedWalletSnapshot(
      snapshotId: string,
      password: string
    ): Promise<{ label: string; stateSnapshot: string }> {
      const state = await store.loadState();
      if (!state) {
        throw new Error("no wallet");
      }
      const record = storedShieldedWalletSnapshots(state).find(
        (item) => item.id === snapshotId
      );
      if (!record) {
        throw new Error("shielded wallet snapshot not found");
      }
      const sessionKey = await sessionKeyForState(state, password);
      return {
        label: record.label,
        stateSnapshot: decryptWithKey(
          record.encryptedStateSnapshot,
          sessionKeyBytes(sessionKey)
        ),
      };
    },

    async removeShieldedWalletSnapshot(snapshotId: string): Promise<void> {
      const state = await store.loadState();
      if (!state) {
        throw new Error("no wallet");
      }
      const nextSnapshots = storedShieldedWalletSnapshots(state).filter(
        (record) => record.id !== snapshotId
      );
      if (nextSnapshots.length === storedShieldedWalletSnapshots(state).length) {
        throw new Error("shielded wallet snapshot not found");
      }
      state.shieldedWalletSnapshots = nextSnapshots;
      await store.saveState(state);
    },

    async removeWallet(): Promise<void> {
      await clearSession();
      await store.clearState();
    },

    getPublicKey,
    derivePrivateKeyFromMnemonic
  };
}
