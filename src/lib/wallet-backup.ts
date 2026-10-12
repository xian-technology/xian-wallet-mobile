import {
  WALLET_KDF_ITERATIONS,
  MIN_WALLET_KDF_ITERATIONS,
  MAX_WALLET_KDF_ITERATIONS
} from "./wallet-kdf";
import type { AssetNetworkStates } from "./storage";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  pbkdf2DeriveKey
} from "./crypto-polyfill";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
export const WALLET_BACKUP_KDF_ITERATIONS = WALLET_KDF_ITERATIONS;
export const MIN_WALLET_BACKUP_KDF_ITERATIONS = MIN_WALLET_KDF_ITERATIONS;

export interface WalletBackupPayload {
  accountVault?: import("@xian-tech/client").AccountVaultState;
  version: 1;
  type: "privateKey" | "mnemonic";
  mnemonic?: string;
  privateKey?: string;
  accounts?: Array<{ index: number; name: string; publicKey?: string; privateKey?: string }>;
  activeAccountIndex?: number;
  activeNetworkId?: string;
  networkPresets?: Array<{
    id: string;
    name: string;
    chainId?: string;
    rpcUrl: string;
    dashboardUrl?: string;
    allowInsecureHttp?: boolean;
    builtin?: boolean;
  }>;
  watchedAssets?: Array<{
    contract: string;
    name?: string;
    symbol?: string;
    icon?: string;
    decimals?: number;
  }>;
  assetNetworkStates?: AssetNetworkStates;
  shieldedStateSnapshots?: Array<{
    label: string;
    stateSnapshot: string;
  }>;
}

export interface EncryptedWalletBackup {
  version: 2 | 3;
  kind: "xian-wallet-backup";
  encryption: {
    algorithm: "AES-256-GCM";
    kdf: "PBKDF2-SHA256";
    iterations: number;
    salt: string;
    iv: string;
  };
  ciphertext: string;
}

export type WalletBackup = EncryptedWalletBackup;

export function parseWalletBackupJson(text: string): WalletBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("invalid wallet backup");
  }
  if (isEncryptedWalletBackup(parsed)) {
    return parsed;
  }
  throw new Error("invalid wallet backup");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEncryptedWalletBackup(value: unknown): value is EncryptedWalletBackup {
  return (
    isRecord(value) &&
    (value.version === 2 || value.version === 3) &&
    value.kind === "xian-wallet-backup" &&
    isRecord(value.encryption) &&
    value.encryption.algorithm === "AES-256-GCM" &&
    value.encryption.kdf === "PBKDF2-SHA256" &&
    typeof value.encryption.iterations === "number" &&
    typeof value.encryption.salt === "string" &&
    typeof value.encryption.iv === "string" &&
    typeof value.ciphertext === "string"
  );
}

function assertPlainWalletBackup(value: unknown): WalletBackupPayload {
  if (!isRecord(value) || value.version !== 1 || typeof value.type !== "string") {
    throw new Error("invalid wallet backup");
  }
  if (value.type !== "mnemonic" && value.type !== "privateKey") {
    throw new Error("invalid wallet backup seed type");
  }
  return value as unknown as WalletBackupPayload;
}

export async function encryptWalletBackupPayload(
  backup: WalletBackupPayload,
  password: string
): Promise<EncryptedWalletBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await pbkdf2DeriveKey(
    ENCODER.encode(password),
    salt,
    WALLET_BACKUP_KDF_ITERATIONS
  );
  const ciphertext = aesGcmEncrypt(key, iv, ENCODER.encode(JSON.stringify(backup, (_key, value) => typeof value === "bigint" ? { __big_int__: value.toString() } : value)));
  return {
    version: backup.accountVault ? 3 : 2,
    kind: "xian-wallet-backup",
    encryption: {
      algorithm: "AES-256-GCM",
      kdf: "PBKDF2-SHA256",
      iterations: WALLET_BACKUP_KDF_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv)
    },
    ciphertext: bytesToBase64(ciphertext)
  };
}

export async function decryptWalletBackup(
  backup: WalletBackup,
  password: string
): Promise<WalletBackupPayload> {
  if (
    !isEncryptedWalletBackup(backup) ||
    !Number.isSafeInteger(backup.encryption.iterations) ||
    backup.encryption.iterations < MIN_WALLET_BACKUP_KDF_ITERATIONS ||
    backup.encryption.iterations > MAX_WALLET_KDF_ITERATIONS
  ) {
    throw new Error("invalid wallet backup encryption parameters");
  }
  const salt = base64ToBytes(backup.encryption.salt);
  const iv = base64ToBytes(backup.encryption.iv);
  const ciphertext = base64ToBytes(backup.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) {
    throw new Error("invalid wallet backup encryption parameters");
  }
  const key = await pbkdf2DeriveKey(
    ENCODER.encode(password),
    salt,
    backup.encryption.iterations
  );
  let plaintext: Uint8Array;
  try {
    plaintext = aesGcmDecrypt(
      key,
      iv,
      ciphertext
    );
  } catch {
    throw new Error("invalid password");
  }
  try {
    const payload = assertPlainWalletBackup(JSON.parse(DECODER.decode(plaintext), (_key, value) => value && typeof value === "object" && Object.keys(value).length === 1 && typeof value.__big_int__ === "string" ? BigInt(value.__big_int__) : value));
    if ((backup.version === 3) !== Boolean(payload.accountVault)) throw new Error("wallet backup version does not match account custody data");
    return payload;
  } catch {
    throw new Error("invalid wallet backup");
  }
}
