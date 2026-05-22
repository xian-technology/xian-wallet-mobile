import type { AssetNetworkStates } from "./storage";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  pbkdf2DeriveKey
} from "./crypto-polyfill";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const BACKUP_ITERATIONS = 10_000;

export interface WalletBackupPayload {
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
  version: 2;
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

export type WalletBackup = WalletBackupPayload | EncryptedWalletBackup;

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

function isEncryptedWalletBackup(value: WalletBackup): value is EncryptedWalletBackup {
  return (
    isRecord(value) &&
    value.version === 2 &&
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
  const key = await pbkdf2DeriveKey(ENCODER.encode(password), salt, BACKUP_ITERATIONS);
  const ciphertext = aesGcmEncrypt(key, iv, ENCODER.encode(JSON.stringify(backup)));
  return {
    version: 2,
    kind: "xian-wallet-backup",
    encryption: {
      algorithm: "AES-256-GCM",
      kdf: "PBKDF2-SHA256",
      iterations: BACKUP_ITERATIONS,
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
  if (!isEncryptedWalletBackup(backup)) {
    return assertPlainWalletBackup(backup);
  }
  if (
    !Number.isSafeInteger(backup.encryption.iterations) ||
    backup.encryption.iterations <= 0
  ) {
    throw new Error("invalid wallet backup encryption parameters");
  }
  const key = await pbkdf2DeriveKey(
    ENCODER.encode(password),
    base64ToBytes(backup.encryption.salt),
    backup.encryption.iterations
  );
  let plaintext: Uint8Array;
  try {
    plaintext = aesGcmDecrypt(
      key,
      base64ToBytes(backup.encryption.iv),
      base64ToBytes(backup.ciphertext)
    );
  } catch {
    throw new Error("invalid password");
  }
  try {
    return assertPlainWalletBackup(JSON.parse(DECODER.decode(plaintext)));
  } catch {
    throw new Error("invalid wallet backup");
  }
}
