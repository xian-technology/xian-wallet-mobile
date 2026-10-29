/**
 * Mobile wallet controller — portable business logic.
 * This keeps wallet storage semantics aligned with wallet-core while using
 * the React Native crypto polyfill for encryption and derivation.
 */
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  Ed25519Signer,
  isValidEd25519Key,
  shieldedSyncHintFromViewingPrivateKey,
} from "@xian-tech/client";

import {
  type StoredWalletState,
  type StoredWalletEncryption,
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
import {
  decryptWalletBackup,
  encryptWalletBackupPayload,
  type WalletBackup,
  type WalletBackupPayload
} from "./wallet-backup";
import { assertRpcTransportAllowed } from "./network-security";
import { OperationQueue } from "./operation-queue";
import { WALLET_KDF_ITERATIONS, assertWalletKdfIterations } from "./wallet-kdf";

const ENCODER = new TextEncoder();
export const WALLET_STATE_KDF_ITERATIONS = WALLET_KDF_ITERATIONS;

const WALLET_STATE_KDF_ALGORITHM = "PBKDF2-SHA256";
const WALLET_STATE_KDF_VERSION = 1;
const WALLET_STATE_KDF_SALT_BYTES = 16;
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

const store = createMobileStore();

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function createWalletEncryptionParams(): StoredWalletEncryption {
  const salt = bytesToBase64(
    crypto.getRandomValues(new Uint8Array(WALLET_STATE_KDF_SALT_BYTES))
  );
  return {
    version: WALLET_STATE_KDF_VERSION,
    algorithm: WALLET_STATE_KDF_ALGORITHM,
    iterations: WALLET_STATE_KDF_ITERATIONS,
    salt,
  };
}

async function createWalletSessionKey(password: string): Promise<{
  walletEncryption: StoredWalletEncryption;
  sessionKey: string;
}> {
  const walletEncryption = createWalletEncryptionParams();
  return {
    walletEncryption,
    sessionKey: await deriveWalletSessionKey(password, walletEncryption)
  };
}

function decodeWalletEncryptionSalt(walletEncryption: unknown): Uint8Array {
  if (!isRecord(walletEncryption)) {
    throw new Error("invalid wallet encryption parameters");
  }

  const { version, algorithm, iterations, salt: saltValue } = walletEncryption;
  assertWalletKdfIterations(iterations);
  if (
    version !== WALLET_STATE_KDF_VERSION ||
    algorithm !== WALLET_STATE_KDF_ALGORITHM ||
    typeof saltValue !== "string"
  ) {
    throw new Error("invalid wallet encryption parameters");
  }

  let salt: Uint8Array;
  try {
    salt = base64ToBytes(saltValue);
  } catch {
    throw new Error("invalid wallet encryption parameters");
  }
  if (salt.length !== WALLET_STATE_KDF_SALT_BYTES) {
    throw new Error("invalid wallet encryption parameters");
  }
  return salt;
}

async function deriveWalletSessionKey(
  password: string,
  walletEncryption: StoredWalletEncryption
): Promise<string> {
  const key = await pbkdf2DeriveKey(
    ENCODER.encode(password),
    decodeWalletEncryptionSalt(walletEncryption),
    walletEncryption.iterations
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
  if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex > 0xffffffff) {
    throw new Error("account index must be an integer between 0 and 4294967295");
  }
  const normalized = normalizeMnemonic(mnemonic);
  if (!normalized) {
    throw new Error("invalid BIP39 mnemonic");
  }

  const seed = await mnemonicToSeed(normalized);
  const context = ENCODER.encode("xian-wallet-seed-v2");
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

/** Prepare every replacement ciphertext before the caller writes the wallet once. */
function reencryptWalletState(
  state: StoredWalletState,
  previousSessionKey: string,
  material: { walletEncryption: StoredWalletEncryption; sessionKey: string }
): StoredWalletState {
  const previousKey = sessionKeyBytes(previousSessionKey);
  const nextKey = sessionKeyBytes(material.sessionKey);
  const reencrypt = (value: string) => encryptWithKey(decryptWithKey(value, previousKey), nextKey);
  return {
    ...state,
    walletEncryption: material.walletEncryption,
    encryptedPrivateKey: reencrypt(state.encryptedPrivateKey),
    encryptedMnemonic: state.encryptedMnemonic ? reencrypt(state.encryptedMnemonic) : undefined,
    accounts: state.accounts?.map(account => ({
      ...account,
      encryptedPrivateKey: reencrypt(account.encryptedPrivateKey)
    })),
    shieldedWalletSnapshots: state.shieldedWalletSnapshots?.map(snapshot => ({
      ...snapshot,
      encryptedStateSnapshot: reencrypt(snapshot.encryptedStateSnapshot)
    }))
  };
}

export interface UnlockedWalletMaterial {
  state: StoredWalletState;
  privateKey: string;
  mnemonic?: string;
  sessionKey: string;
  expiresAt: number;
}

// Shared across controller instances so a lock invalidates every pending reader.
let sessionGeneration = 0;
const sessionOperations = new OperationQueue();

async function clearStoredSession(generation: number): Promise<void> {
  await sessionOperations.run(async () => {
    if (generation === sessionGeneration) {
      await store.clearUnlockedSession();
    }
  });
}

async function decryptUnlockedWalletMaterial(
  state: StoredWalletState,
  session: StoredUnlockedSession
): Promise<UnlockedWalletMaterial> {
  if (session.publicKey !== state.publicKey) {
    throw new Error("unlocked session belongs to a different account");
  }
  const privateKey = await decryptPrivateKeyWithSessionKey(state.encryptedPrivateKey, session.sessionKey);
  if (getPublicKey(privateKey) !== state.publicKey) {
    throw new Error("unlocked session does not match stored wallet");
  }
  const mnemonic = state.encryptedMnemonic
    ? await decryptMnemonicWithSessionKey(state.encryptedMnemonic, session.sessionKey)
    : undefined;
  return { state, privateKey, mnemonic, sessionKey: session.sessionKey, expiresAt: session.expiresAt };
}

export async function loadUnlockedWalletMaterial(): Promise<UnlockedWalletMaterial | null> {
  const generation = sessionGeneration;
  await sessionOperations.settled();
  if (generation !== sessionGeneration) return null;
  const [state, session] = await Promise.all([
    store.loadState(),
    store.loadUnlockedSession(),
  ]);
  if (generation !== sessionGeneration) return null;
  if (!state || !session || session.expiresAt <= Date.now()) {
    if (session) {
      await clearStoredSession(generation);
    }
    return null;
  }

  try {
    const material = await decryptUnlockedWalletMaterial(state, session);
    if (generation !== sessionGeneration) return null;
    return material;
  } catch {
    await clearStoredSession(generation);
    return null;
  }
}

export function createWalletController() {
  let unlockedPrivateKey: string | null = null;
  let unlockedMnemonic: string | null = null;
  let unlockedSessionKey: string | null = null;

  async function persistSession(): Promise<void> {
    if (!unlockedPrivateKey || !unlockedSessionKey) {
      throw new Error("cannot persist a locked wallet session");
    }
    const generation = sessionGeneration;
    const privateKey = unlockedPrivateKey;
    const sessionKey = unlockedSessionKey;
    const isCurrent = () =>
      generation === sessionGeneration &&
      unlockedPrivateKey === privateKey &&
      unlockedSessionKey === sessionKey;
    await sessionOperations.run(async () => {
      if (!isCurrent()) throw new Error("wallet locked or changed during session save");
      await store.saveUnlockedSession({
        version: 2,
        publicKey: getPublicKey(privateKey),
        sessionKey,
        expiresAt: Date.now() + SESSION_TIMEOUT_MS
      });
      if (!isCurrent()) {
        await store.clearUnlockedSession();
        throw new Error("wallet locked or changed during session save");
      }
    });
  }

  async function restoreSession(): Promise<boolean> {
    const generation = sessionGeneration;
    // In-memory secrets do not extend a persisted session's authorization.
    const material = await loadUnlockedWalletMaterial();
    if (generation !== sessionGeneration) return false;
    if (!material) {
      await clearSession();
      return false;
    }
    unlockedPrivateKey = material.privateKey;
    unlockedMnemonic = material.mnemonic ?? null;
    unlockedSessionKey = material.sessionKey;
    return true;
  }

  async function clearSession(): Promise<void> {
    sessionGeneration++;
    unlockedPrivateKey = null;
    unlockedMnemonic = null;
    unlockedSessionKey = null;
    await sessionOperations.run(() => store.clearUnlockedSession());
  }

  async function sessionKeyForState(
    state: StoredWalletState,
    password: string
  ): Promise<string> {
    return deriveWalletSessionKey(password, state.walletEncryption);
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

  async function unlockWithSessionKeyForState(
    state: StoredWalletState,
    sessionKey: string,
    generation = sessionGeneration
  ): Promise<void> {
    const privateKey = await decryptPrivateKeyWithSessionKey(
      state.encryptedPrivateKey,
      sessionKey
    );

    if (getPublicKey(privateKey) !== state.publicKey) {
      throw new Error("decrypted key does not match stored wallet");
    }

    let mnemonic: string | null = null;
    if (state.encryptedMnemonic) {
      try {
        mnemonic = await decryptMnemonicWithSessionKey(
          state.encryptedMnemonic,
          sessionKey
        );
      } catch {
        mnemonic = null;
      }
    } else {
      mnemonic = null;
    }

    if (generation !== sessionGeneration) throw new Error("wallet locked during unlock");
    unlockedPrivateKey = privateKey;
    unlockedSessionKey = sessionKey;
    unlockedMnemonic = mnemonic;
    await persistSession();
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
  ): Promise<NonNullable<WalletBackupPayload["shieldedStateSnapshots"]>> {
    const exported: NonNullable<WalletBackupPayload["shieldedStateSnapshots"]> = [];
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
    snapshots: WalletBackupPayload["shieldedStateSnapshots"] | undefined,
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
      allowInsecureHttp?: boolean;
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
      const { walletEncryption, sessionKey } = await createWalletSessionKey(
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
      const setupAllowInsecureHttp = opts.allowInsecureHttp === true;
      assertRpcTransportAllowed(setupRpcUrl, setupAllowInsecureHttp);

      const localPreset = {
        id: "xian-local",
        name: "Local node",
        rpcUrl: DEFAULT_RPC_URL,
        dashboardUrl: DEFAULT_DASHBOARD_URL,
        allowInsecureHttp: false,
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
            allowInsecureHttp: setupAllowInsecureHttp,
          };

      const activePreset = customPreset ?? localPreset;
      const networkPresets = customPreset
        ? [localPreset, customPreset]
        : [localPreset];

      const state: StoredWalletState = {
        publicKey,
        encryptedPrivateKey,
        encryptedMnemonic,
        walletEncryption,
        seedSource: mnemonic ? "mnemonic" : "privateKey",
        mnemonicWordCount: mnemonic ? mnemonic.split(" ").length : undefined,
        accounts: [account],
        activeAccountIndex: 0,
        rpcUrl: activePreset.rpcUrl,
        dashboardUrl: activePreset.dashboardUrl,
        activeNetworkId: activePreset.id,
        networkPresets,
        watchedAssets: [{ contract: "currency", name: "Xian", symbol: "XIAN", decimals: 8 }],
        assetNetworkStates: {
          [activePreset.id]: {
            currency: {
              status: "available"
            }
          }
        },
        trustedDappPolicies: [],
        shieldedWalletSnapshots: [],
        connectedOrigins: [],
        createdAt: new Date().toISOString()
      };

      await store.clearBiometricSessionKey();
      await store.replaceState(state);

      unlockedPrivateKey = privateKey;
      unlockedMnemonic = mnemonic ?? null;
      unlockedSessionKey = sessionKey;
      await persistSession();

      return { mnemonic };
    },

    async unlock(password: string): Promise<void> {
      let generation = sessionGeneration;
      let state = await store.loadState();
      if (!state) {
        throw new Error("no wallet configured");
      }
      const originalState = JSON.stringify(state);
      let sessionKey = await sessionKeyForState(state, password);
      const privateKey = await decryptPrivateKeyWithSessionKey(state.encryptedPrivateKey, sessionKey);
      if (getPublicKey(privateKey) !== state.publicKey) {
        throw new Error("decrypted key does not match stored wallet");
      }
      if (state.walletEncryption.iterations < WALLET_STATE_KDF_ITERATIONS) {
        const material = await createWalletSessionKey(password);
        const nextState = reencryptWalletState(state, sessionKey, material);
        if (JSON.stringify(await store.loadState()) !== originalState) {
          throw new Error("wallet changed during unlock; please retry");
        }
        if (generation !== sessionGeneration) throw new Error("wallet locked during unlock");
        generation++;
        await clearSession();
        // A biometric record contains the old key. Password unlock remains the
        // recovery path if persistence is interrupted; biometrics can be re-enabled.
        await store.clearBiometricSessionKey();
        if (generation !== sessionGeneration) throw new Error("wallet locked during unlock");
        if (!(await store.replaceStateIfUnchanged(originalState, nextState))) {
          throw new Error("wallet changed during unlock; please retry");
        }
        state = nextState;
        sessionKey = material.sessionKey;
      }
      await unlockWithSessionKeyForState(state, sessionKey, generation);
    },

    async unlockWithBiometrics(): Promise<void> {
      const generation = sessionGeneration;
      const state = await store.loadState();
      if (!state) {
        throw new Error("no wallet configured");
      }
      const biometricSession = await store.loadBiometricSessionKey();
      if (!biometricSession || biometricSession.publicKey !== state.publicKey) {
        throw new Error("biometric unlock is not enabled");
      }
      await unlockWithSessionKeyForState(state, biometricSession.sessionKey, generation);
    },

    async isBiometricUnlockEnabled(): Promise<boolean> {
      return store.isBiometricUnlockEnabled();
    },

    async enableBiometricUnlock(): Promise<void> {
      const state = await store.loadState();
      if (!state) {
        throw new Error("no wallet configured");
      }
      if (!(await restoreSession()) || !unlockedSessionKey) {
        throw new Error("wallet must be unlocked");
      }
      await store.saveBiometricSessionKey({
        publicKey: state.publicKey,
        sessionKey: unlockedSessionKey,
        enabledAt: Date.now(),
      });
    },

    async disableBiometricUnlock(): Promise<void> {
      await store.clearBiometricSessionKey();
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
      await persistSession();
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
        await persistSession();
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
          await persistSession();
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
      await restoreSession();
      const sessionKey = unlockedSessionKey;
      if (!sessionKey) {
        throw new Error("wallet is locked");
      }

      const backup: WalletBackupPayload = {
        version: 1,
        type: state.seedSource,
        accounts: (state.accounts ?? []).map((account) => ({
          index: account.index,
          name: account.name
        })),
        activeAccountIndex: state.activeAccountIndex ?? 0,
        activeNetworkId: state.activeNetworkId,
        networkPresets: state.networkPresets.filter((preset) => !preset.builtin),
        watchedAssets: state.watchedAssets,
        assetNetworkStates: state.assetNetworkStates
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

      return encryptWalletBackupPayload(backup, password);
    },

    async importWalletBackup(backup: WalletBackup, password: string): Promise<void> {
      const decryptedBackup = await decryptWalletBackup(backup, password);
      let mnemonic: string | undefined;
      let primaryKey: string;

      if (decryptedBackup.type === "mnemonic" && decryptedBackup.mnemonic) {
        mnemonic = normalizeMnemonic(decryptedBackup.mnemonic) ?? undefined;
        if (!mnemonic) {
          throw new Error("invalid BIP39 mnemonic");
        }
        primaryKey = await derivePrivateKeyFromMnemonic(mnemonic, 0);
      } else if (decryptedBackup.privateKey) {
        primaryKey = normalizePrivateKeyInput(decryptedBackup.privateKey) as string;
      } else {
        throw new Error("backup must contain a mnemonic or private key");
      }

      const { walletEncryption, sessionKey } = await createWalletSessionKey(
        password
      );
      const nowIso = new Date().toISOString();
      const encryptedMnemonic = mnemonic
        ? await encryptMnemonicWithSessionKey(mnemonic, sessionKey)
        : undefined;

      const accountEntries = decryptedBackup.accounts;
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
        accounts.find((account) => account.index === decryptedBackup.activeAccountIndex) ??
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
        allowInsecureHttp: false,
        builtin: true,
      };
      const networkPresets: StoredWalletState["networkPresets"] = [localPreset];
      for (const preset of decryptedBackup.networkPresets ?? []) {
        if (!networkPresets.some((existing) => existing.id === preset.id)) {
          assertRpcTransportAllowed(preset.rpcUrl, preset.allowInsecureHttp);
          networkPresets.push({
            ...preset,
            allowInsecureHttp: preset.allowInsecureHttp === true,
          });
        }
      }
      const activePreset =
        networkPresets.find((preset) => preset.id === decryptedBackup.activeNetworkId) ??
        networkPresets[0];
      if (!activePreset) {
        throw new Error("backup must contain at least one network preset");
      }

      const watchedAssets =
        decryptedBackup.watchedAssets && decryptedBackup.watchedAssets.length > 0
          ? decryptedBackup.watchedAssets
          : [{ contract: "currency", name: "Xian", symbol: "XIAN", decimals: 8 }];
      const shieldedWalletSnapshots = await importShieldedWalletSnapshots(
        decryptedBackup.shieldedStateSnapshots,
        sessionKey,
        nowIso
      );

      await clearSession();
      await store.clearBiometricSessionKey();
      await store.replaceState({
        publicKey: activeAccount.publicKey,
        encryptedPrivateKey: activeAccount.encryptedPrivateKey,
        encryptedMnemonic,
        walletEncryption,
        seedSource: decryptedBackup.type,
        mnemonicWordCount: mnemonic ? mnemonic.split(" ").length : undefined,
        accounts,
        activeAccountIndex: activeAccount.index,
        rpcUrl: activePreset.rpcUrl,
        dashboardUrl: activePreset.dashboardUrl,
        activeNetworkId: activePreset.id,
        networkPresets,
        watchedAssets,
        assetNetworkStates: decryptedBackup.assetNetworkStates,
        trustedDappPolicies: [],
        shieldedWalletSnapshots,
        connectedOrigins: [],
        createdAt: nowIso,
      });

      unlockedPrivateKey = activePrivateKey;
      unlockedMnemonic = mnemonic ?? null;
      unlockedSessionKey = sessionKey;
      await persistSession();
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
      void password;
      await restoreSession();
      const sessionKey = unlockedSessionKey;
      if (!sessionKey) {
        throw new Error("wallet is locked");
      }
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
      await store.clearBiometricSessionKey();
      await store.clearState();
    },

    getPublicKey,
    derivePrivateKeyFromMnemonic
  };
}
