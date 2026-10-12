import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import type {
  StoredBiometricSessionKey,
  StoredUnlockedSession,
  StoredWalletState
} from "../storage";

const VALID_PRIVATE_KEY = "11".repeat(32);
const VALID_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const SHIELDED_STATE_SNAPSHOT = JSON.stringify({
  asset_id: "con_private",
  owner_secret: "0x" + "22".repeat(32),
  viewing_private_key: "33".repeat(32),
  notes: [],
  commitments: [],
  last_scanned_index: 0
});

let mockStoredState: StoredWalletState | null = null;
let mockStoredSession: StoredUnlockedSession | null = null;
let mockStoredBiometricSession: StoredBiometricSessionKey | null = null;

jest.mock("../storage", () => {
  const mockStore = {
    loadState: jest.fn(async () => mockStoredState),
    saveState: jest.fn(async (state: StoredWalletState) => {
      mockStoredState = state;
    }),
    clearState: jest.fn(async () => {
      mockStoredState = null;
    }),
    loadUnlockedSession: jest.fn(async () => mockStoredSession),
    saveUnlockedSession: jest.fn(async (session: StoredUnlockedSession) => {
      mockStoredSession = session;
    }),
    clearUnlockedSession: jest.fn(async () => {
      mockStoredSession = null;
    }),
    isBiometricUnlockEnabled: jest.fn(async () => mockStoredBiometricSession != null),
    loadBiometricSessionKey: jest.fn(async () => mockStoredBiometricSession),
    saveBiometricSessionKey: jest.fn(async (session: StoredBiometricSessionKey) => {
      mockStoredBiometricSession = session;
    }),
    clearBiometricSessionKey: jest.fn(async () => {
      mockStoredBiometricSession = null;
    }),
    loadRequestState: jest.fn(async () => null),
    saveRequestState: jest.fn(async () => undefined),
    deleteRequestState: jest.fn(async () => undefined),
    listRequestStates: jest.fn(async () => []),
    loadApprovalState: jest.fn(async () => null),
    saveApprovalState: jest.fn(async () => undefined),
    deleteApprovalState: jest.fn(async () => undefined),
    listApprovalStates: jest.fn(async () => [])
  };

  return {
    __esModule: true,
    createMobileStore: jest.fn(() => mockStore),
    __mockStore: mockStore
  };
});

jest.mock("@scure/bip39", () => ({
  generateMnemonic: jest.fn(
    () =>
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  ),
  mnemonicToSeed: jest.fn(
    async (mnemonic: string) =>
      new Uint8Array(
        require("node:crypto").pbkdf2Sync(
          Buffer.from(mnemonic, "utf8"),
          Buffer.from("mnemonic", "utf8"),
          2048,
          64,
          "sha512"
        )
      )
  ),
  validateMnemonic: jest.fn(
    (mnemonic: string) =>
      mnemonic ===
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  )
}));

jest.mock(
  "@scure/bip39/wordlists/english.js",
  () => ({
    wordlist: []
  }),
  { virtual: true }
);

jest.mock("../crypto-polyfill", () => ({
  sha256Digest: (data: Uint8Array) =>
    new Uint8Array(require("node:crypto").createHash("sha256").update(Buffer.from(data)).digest()),
  pbkdf2DeriveKey: async (password: Uint8Array, salt: Uint8Array, iterations: number) =>
    new Uint8Array(
      require("node:crypto").pbkdf2Sync(
        Buffer.from(password),
        Buffer.from(salt),
        iterations,
        32,
        "sha256"
      )
    ),
  aesGcmEncrypt: (key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array) => {
    const { createCipheriv } = require("node:crypto");
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(iv));
    const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
    const tag = cipher.getAuthTag();
    return new Uint8Array(Buffer.concat([encrypted, tag]));
  },
  aesGcmDecrypt: (key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array) => {
    const { createDecipheriv } = require("node:crypto");
    const payload = Buffer.from(ciphertext);
    const encrypted = payload.subarray(0, payload.length - 16);
    const tag = payload.subarray(payload.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(iv));
    decipher.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([decipher.update(encrypted), decipher.final()]));
  }
}));

import { XianClient, importAccountMaster, MasterAccountTransitionDraft } from "@xian-tech/client";
import {
  createWalletController,
  loadUnlockedWalletMaterial,
  signWalletTransaction
} from "../wallet-controller";

describe("mobile hybrid custody with real SDK cryptography", () => {
  it("restores a fresh account, preserves its identity through backup, and signs hybrid transactions", async () => {
    mockStoredState = null;
    mockStoredSession = null;
    let record: unknown = null;
    jest.spyOn(XianClient.prototype, "getChainId").mockResolvedValue("local-test");
    jest.spyOn(XianClient.prototype, "getNonce").mockResolvedValue(0);
    jest
      .spyOn(XianClient.prototype, "getState")
      .mockImplementation(async (_, variable) =>
        variable === "policy" ? { version: 1, enrollment_open: true, transition_chi: 1000 } : record
      );
    const broadcast = jest
      .spyOn(XianClient.prototype, "broadcastTx")
      .mockImplementation(async (tx) => {
        expect(mockStoredState!.encryptedAccountVault).toBeTruthy();
        record = tx.payload.kwargs.record;
        return {
          submitted: true,
          accepted: true,
          finalized: false,
          mode: "checktx",
          nonce: tx.payload.nonce,
          chiSupplied: tx.payload.chi_supplied,
          response: {}
        };
      });
    const controller = createWalletController();
    await controller.createWallet({ password: "wallet-password", privateKey: VALID_PRIVATE_KEY });
    const sender = mockStoredState!.publicKey,
      password = "";
    await controller.accountSecurity({ action: "begin", operation: "enroll" });
    const active = (await controller.accountSecurity({
      action: "export",
      role: "active",
      password
    })) as string;
    const recovery = active; // One master restores either role.
    await controller.accountSecurity({ action: "verify", role: "active", file: active, password });
    expect(broadcast).not.toHaveBeenCalled();
    await controller.accountSecurity({ action: "submit" });
    expect(mockStoredState!.publicKey).toBe(sender);
    // New device: unrelated seed. The offline recovery file is the only authority.
    mockStoredState = null;
    mockStoredSession = null;
    const fresh = createWalletController();
    await fresh.createWallet({ password: "fresh-password", privateKey: "44".repeat(32) });
    await fresh.accountSecurity({ action: "restore", file: active, password });
    expect(mockStoredState!.publicKey).toBe(sender);
    await fresh.accountSecurity({
      action: "begin",
      operation: "recover",
      file: recovery,
      password
    });
    const nextActive = (await fresh.accountSecurity({
      action: "export",
      role: "active",
      password
    })) as string;
    await fresh.accountSecurity({ action: "verify", role: "active", file: nextActive, password });
    await fresh.accountSecurity({ action: "submit" });
    await fresh.accountSecurity({ action: "activate", sender });
    expect(mockStoredState!.publicKey).toBe(sender);
    await fresh.lock();
    await fresh.unlock("fresh-password");
    expect((await loadUnlockedWalletMaterial())!.state.publicKey).toBe(sender);
    // Reconcile before locking: the next epoch must not orphan the local identity anchor.
    await fresh.accountSecurity({ action: "begin", operation: "rotate" });
    for (const role of ["active"] as const) {
      const file = await fresh.accountSecurity({ action: "export", role, password }) as string;
      await fresh.accountSecurity({ action: "verify", role, file, password });
    }
    await fresh.accountSecurity({ action: "submit" });
    await fresh.accountSecurity({ action: "status" });
    await fresh.lock();
    await fresh.unlock("fresh-password");
    expect((await loadUnlockedWalletMaterial())!.state.publicKey).toBe(sender);
    const full = await fresh.exportWallet("full-backup-password");
    expect(full.version).toBe(3);
    const restored = createWalletController();
    await restored.importWalletBackup(full, "full-backup-password");
    await restored.lock();
    await restored.unlock("full-backup-password");
    const material = (await loadUnlockedWalletMaterial())!;
    expect(material.state.publicKey).toBe(sender);
    const tx = await signWalletTransaction(
      new XianClient({ rpcUrl: "http://127.0.0.1:26657" }),
      material.privateKey,
      {
        payload: {
          sender,
          chain_id: "local-test",
          contract: "currency",
          function: "transfer",
          kwargs: { to: "aa".repeat(32), amount: 1 },
          nonce: 2,
          chi_supplied: 10000
        }
      }
    );
    expect(tx.metadata.tx_format).toBe("xian_account_v1");
    expect(tx.payload.sender).toBe(sender);
    expect((await importAccountMaster(nextActive, password)).sender).toBe(sender);
    await restored.accountSecurity({ action: "begin", operation: "rotate" });
    for (const role of ["active"] as const) {
      const file = await restored.accountSecurity({ action: "export", role, password }) as string;
      await restored.accountSecurity({ action: "verify", role, file, password });
    }
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    jest.spyOn(XianClient.prototype, "getNonce").mockImplementationOnce(async () => { entered(); await gate; return 3; });
    const callsBefore = broadcast.mock.calls.length;
    const submission = restored.accountSecurity({ action: "submit" });
    const rejected = expect(submission).rejects.toThrow(/locked|changed/);
    await waiting;
    await restored.lock();
    release();
    await rejected;
    expect(broadcast).toHaveBeenCalledTimes(callsBefore);
    await restored.unlock("full-backup-password");
    expect(await restored.accountSecurity({ action: "status" })).toEqual({ sender, status: "active" });
    await restored.accountSecurity({ action: "begin", operation: "rotate" });
    let releaseExport!: (file: string) => void, enteredExport!: () => void;
    const exportingStarted = new Promise<void>(resolve => { enteredExport = resolve; });
    const exportSpy = jest.spyOn(MasterAccountTransitionDraft.prototype, "exportMasterBackup").mockImplementation(() => {
      enteredExport(); return new Promise<string>(resolve => { releaseExport = resolve; });
    });
    const exporting = restored.accountSecurity({ action: "export" });
    const exportRejected = expect(exporting).rejects.toThrow(/locked|changed/);
    await exportingStarted; await restored.lock(); releaseExport("secret backup must not escape");
    await exportRejected; exportSpy.mockRestore();
    await restored.unlock("full-backup-password");
    // An expired session must not export the vault using leftover in-memory keys.
    mockStoredSession!.expiresAt = Date.now() - 1;
    await expect(restored.exportWallet("new-export-password")).rejects.toThrow(/locked/);
    expect(await loadUnlockedWalletMaterial()).toBeNull();
    jest.restoreAllMocks();
  }, 60000);
});
