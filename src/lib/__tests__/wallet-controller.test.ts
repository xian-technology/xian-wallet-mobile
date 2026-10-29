import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import type {
  StoredBiometricSessionKey,
  StoredUnlockedSession,
  StoredWalletState,
} from "../storage";

const VALID_PRIVATE_KEY = "11".repeat(32);
const VALID_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const SHIELDED_STATE_SNAPSHOT = JSON.stringify({
  asset_id: "con_private",
  owner_secret: "0x" + "22".repeat(32),
  viewing_private_key: "33".repeat(32),
  notes: [],
  commitments: [],
  last_scanned_index: 0,
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
    replaceState: jest.fn(async (state: StoredWalletState) => {
      mockStoredState = state;
    }),
    replaceStateIfUnchanged: jest.fn(async (expected: string, state: StoredWalletState): Promise<boolean> => {
      if (JSON.stringify(mockStoredState) !== expected) return false;
      await mockStore.saveState(state);
      return true;
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
    saveBiometricSessionKey: jest.fn(
      async (session: StoredBiometricSessionKey) => {
        mockStoredBiometricSession = session;
      }
    ),
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
  generateMnemonic: jest.fn(() =>
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  ),
  mnemonicToSeed: jest.fn(async (mnemonic: string) =>
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

jest.mock("@scure/bip39/wordlists/english.js", () => ({
  wordlist: []
}), { virtual: true });

jest.mock("../crypto-polyfill", () => ({
  sha256Digest: (data: Uint8Array) =>
    new Uint8Array(require("node:crypto").createHash("sha256").update(Buffer.from(data)).digest()),
  pbkdf2DeriveKey: async (
    password: Uint8Array,
    salt: Uint8Array,
    iterations: number
  ) =>
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

jest.mock("@xian-tech/client", () => ({
  Ed25519Signer: class {
    address: string;

    constructor(privateKey: string) {
      this.address = require("node:crypto")
        .createHash("sha256")
        .update(privateKey)
        .digest("hex")
        .slice(0, 64);
    }
  },
  isValidEd25519Key: (value: string) => /^[0-9a-f]{64}$/.test(value),
  shieldedSyncHintFromViewingPrivateKey: () => "0xsync"
}));

const { __mockStore: mockStore } = jest.requireMock("../storage") as {
  __mockStore: {
    loadState: jest.Mock;
    saveState: jest.Mock;
    clearState: jest.Mock;
    loadUnlockedSession: jest.Mock;
    saveUnlockedSession: jest.Mock;
    clearUnlockedSession: jest.Mock;
    isBiometricUnlockEnabled: jest.Mock;
    loadBiometricSessionKey: jest.Mock;
    saveBiometricSessionKey: jest.Mock;
    clearBiometricSessionKey: jest.Mock;
  };
};

import {
  createWalletController,
  loadUnlockedWalletMaterial,
  WALLET_STATE_KDF_ITERATIONS,
} from "../wallet-controller";
import {
  decryptWalletBackup,
  parseWalletBackupJson,
  WALLET_BACKUP_KDF_ITERATIONS,
} from "../wallet-backup";

describe("wallet-controller", () => {
  beforeEach(() => {
    mockStoredState = null;
    mockStoredSession = null;
    mockStoredBiometricSession = null;
    jest.clearAllMocks();

    mockStore.loadState.mockImplementation(async () => mockStoredState);
    mockStore.saveState.mockImplementation(async (...args: unknown[]) => {
      const [state] = args as [StoredWalletState];
      mockStoredState = state;
    });
    mockStore.clearState.mockImplementation(async () => {
      mockStoredState = null;
    });
    mockStore.loadUnlockedSession.mockImplementation(async () => mockStoredSession);
    mockStore.saveUnlockedSession.mockImplementation(async (...args: unknown[]) => {
      const [session] = args as [StoredUnlockedSession];
      mockStoredSession = session;
    });
    mockStore.clearUnlockedSession.mockImplementation(async () => {
      mockStoredSession = null;
    });
    mockStore.isBiometricUnlockEnabled.mockImplementation(
      async () => mockStoredBiometricSession != null
    );
    mockStore.loadBiometricSessionKey.mockImplementation(
      async () => mockStoredBiometricSession
    );
    mockStore.saveBiometricSessionKey.mockImplementation(async (...args: unknown[]) => {
      const [session] = args as [StoredBiometricSessionKey];
      mockStoredBiometricSession = session;
    });
    mockStore.clearBiometricSessionKey.mockImplementation(async () => {
      mockStoredBiometricSession = null;
    });
  });

  it("keeps a lock effective when an older session save finishes late", async () => {
    const controller = createWalletController();
    await controller.createWallet({ password: "secret123", privateKey: VALID_PRIVATE_KEY });
    await controller.lock();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    mockStore.saveUnlockedSession.mockImplementationOnce(async (...args: unknown[]) => {
      entered(); await gate; mockStoredSession = args[0] as StoredUnlockedSession;
    });
    const unlocking = controller.unlock("secret123");
    const rejected = expect(unlocking).rejects.toThrow(/locked|changed/);
    await waiting;
    const locking = controller.lock();
    release();
    await Promise.all([rejected, locking]);
    expect(mockStoredSession).toBeNull();
    await expect(loadUnlockedWalletMaterial()).resolves.toBeNull();
    await controller.unlock("secret123");
    expect(await loadUnlockedWalletMaterial()).not.toBeNull();
  });

  it("rejects a stale session read after another controller locks the wallet", async () => {
    const controller = createWalletController();
    await controller.createWallet({ password: "secret123", privateKey: VALID_PRIVATE_KEY });
    const stale = mockStoredSession;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    mockStore.loadUnlockedSession.mockImplementationOnce(async () => {
      entered(); await gate; return stale;
    });
    const restoring = loadUnlockedWalletMaterial();
    await waiting;
    await createWalletController().lock();
    release();
    await expect(restoring).resolves.toBeNull();
    expect(mockStoredSession).toBeNull();
  });

  it("persists only versioned session material, never raw wallet secrets", async () => {
    const controller = createWalletController();

    await controller.createWallet({
      password: "secret123",
      privateKey: VALID_PRIVATE_KEY
    });

    expect(mockStoredState?.walletEncryption).toMatchObject({
      version: 1,
      algorithm: "PBKDF2-SHA256",
      iterations: WALLET_STATE_KDF_ITERATIONS,
      salt: expect.any(String)
    });
    expect(mockStoredSession).toMatchObject({
      version: 2,
      publicKey: mockStoredState?.publicKey,
      sessionKey: expect.any(String)
    });
    expect(JSON.stringify(mockStoredSession)).not.toContain(VALID_PRIVATE_KEY);
    expect(JSON.stringify(mockStoredSession)).not.toContain(VALID_MNEMONIC);
    expect("password" in (mockStoredSession as object)).toBe(false);
  });

  it("expires an in-memory session at its persisted deadline", async () => {
    const controller = createWalletController();
    await controller.createWallet({ password: "secret123", privateKey: VALID_PRIVATE_KEY });
    mockStoredSession!.expiresAt = Date.now();
    await expect(controller.isUnlocked()).resolves.toBe(false);
    await expect(loadUnlockedWalletMaterial()).resolves.toBeNull();
    expect(mockStoredSession).toBeNull();
  });

  it("deletes an orphaned unlocked session when wallet state is missing", async () => {
    mockStoredSession = {
      version: 2,
      publicKey: "aa".repeat(32),
      sessionKey: "orphaned-session-key",
      expiresAt: Date.now() + 60_000,
    };

    await expect(loadUnlockedWalletMaterial()).resolves.toBeNull();
    expect(mockStore.clearUnlockedSession).toHaveBeenCalledTimes(1);
    expect(mockStoredSession).toBeNull();
  });

  it("restores an unlocked mnemonic session after an app restart", async () => {
    const controller = createWalletController();
    await controller.createWallet({
      password: "secret123",
      mnemonic: VALID_MNEMONIC
    });

    const persisted = JSON.stringify(mockStoredSession);
    expect(persisted).not.toContain(VALID_MNEMONIC);
    expect(persisted).not.toContain(
      "b3aee0ed179a18a754136d3d134c03e9c1ad97eb2e9912401dc2d9ffc96882e0"
    );

    const resumedController = createWalletController();
    await expect(resumedController.isUnlocked()).resolves.toBe(true);
    await expect(resumedController.addAccount()).resolves.toBeUndefined();
    expect(mockStoredState?.accounts).toHaveLength(2);
  });

  it("rejects malformed private-key imports", async () => {
    const controller = createWalletController();

    await expect(
      controller.createWallet({
        password: "secret123",
        privateKey: `${"11".repeat(31)}zz`
      })
    ).rejects.toThrow("private key must be a 32-byte hex seed");
  });

  it("adds a derived account while unlocked without re-entering the password", async () => {
    const controller = createWalletController();

    await controller.createWallet({
      password: "secret123",
      mnemonic: VALID_MNEMONIC
    });
    await controller.addAccount();

    expect(mockStoredState?.accounts).toHaveLength(2);
    expect(mockStoredState?.activeAccountIndex).toBe(1);
    expect(mockStoredSession?.sessionKey).toEqual(expect.any(String));
  });

  it("derives canonical indexed mnemonic private keys", async () => {
    const controller = createWalletController();

    await controller.createWallet({
      password: "secret123",
      mnemonic: VALID_MNEMONIC
    });
    await expect(controller.revealPrivateKey("secret123")).resolves.toBe(
      "b3aee0ed179a18a754136d3d134c03e9c1ad97eb2e9912401dc2d9ffc96882e0"
    );

    await controller.addAccount();
    await expect(controller.revealPrivateKey("secret123")).resolves.toBe(
      "f1f4674448f4d17a78af6b150a7fa45a752d0014fb0235604a339a898695ce69"
    );
  });

  it("refreshes the unlocked session when removing the active derived account", async () => {
    const controller = createWalletController();

    await controller.createWallet({
      password: "secret123",
      mnemonic: VALID_MNEMONIC
    });
    const primaryPrivateKey = await controller.revealPrivateKey("secret123");

    await controller.addAccount();
    expect(mockStoredState?.activeAccountIndex).toBe(1);
    await expect(controller.revealPrivateKey("secret123")).resolves.not.toBe(
      primaryPrivateKey
    );

    const resumedController = createWalletController();
    await resumedController.removeAccount(1);

    expect(mockStoredState?.activeAccountIndex).toBe(0);
    expect(mockStoredState?.publicKey).toBe(mockStoredState?.accounts?.[0]?.publicKey);
    await expect(resumedController.revealPrivateKey("secret123")).resolves.toBe(
      primaryPrivateKey
    );
    expect(mockStore.clearUnlockedSession).not.toHaveBeenCalled();
  });

  it("fails unlock with the wrong password", async () => {
    const controller = createWalletController();

    await controller.createWallet({
      password: "secret123",
      privateKey: VALID_PRIVATE_KEY
    });
    await controller.lock();

    await expect(controller.unlock("wrong-password")).rejects.toThrow();
  });

  it("supports opt-in biometric unlock without storing the password", async () => {
    const controller = createWalletController();

    await controller.createWallet({
      password: "secret123",
      privateKey: VALID_PRIVATE_KEY
    });
    await controller.enableBiometricUnlock();

    expect(mockStoredBiometricSession).toMatchObject({
      publicKey: mockStoredState?.publicKey,
      sessionKey: mockStoredSession?.sessionKey
    });
    expect(JSON.stringify(mockStoredBiometricSession)).not.toContain("secret123");

    await controller.lock();
    expect(mockStoredSession).toBeNull();

    const resumedController = createWalletController();
    await resumedController.unlockWithBiometrics();

    await expect(resumedController.revealPrivateKey("secret123")).resolves.toBe(
      VALID_PRIVATE_KEY
    );
    expect(await resumedController.isBiometricUnlockEnabled()).toBe(true);

    await resumedController.disableBiometricUnlock();
    expect(mockStoredBiometricSession).toBeNull();
  });

  it("clears biometric unlock material when removing a wallet", async () => {
    const controller = createWalletController();

    await controller.createWallet({
      password: "secret123",
      privateKey: VALID_PRIVATE_KEY
    });
    await controller.enableBiometricUnlock();
    await controller.removeWallet();

    expect(mockStoredState).toBeNull();
    expect(mockStoredBiometricSession).toBeNull();
  });

  it("rejects stored wallets with weak encryption parameters", async () => {
    const controller = createWalletController();

    await controller.createWallet({
      password: "secret123",
      privateKey: VALID_PRIVATE_KEY
    });
    await controller.lock();
    (mockStoredState as StoredWalletState).walletEncryption.iterations = 10_000;

    await expect(controller.unlock("secret123")).rejects.toThrow(
      "invalid wallet encryption parameters"
    );
  });

  it("stores shielded snapshots, includes them in wallet backups, and restores them on import", async () => {
    const controller = createWalletController();

    await controller.createWallet({
      password: "secret123",
      privateKey: VALID_PRIVATE_KEY
    });

    await controller.saveShieldedWalletSnapshot(
      SHIELDED_STATE_SNAPSHOT,
      "Treasury shielded"
    );
    expect(mockStoredState?.shieldedWalletSnapshots).toEqual([
      expect.objectContaining({
        label: "Treasury shielded",
        assetId: "con_private",
        noteCount: 0,
        commitmentCount: 0
      })
    ]);

    const backup = await controller.exportWallet("backup-pass");
    expect(backup.version).toBe(2);
    if (backup.version === 2) {
      expect(backup.encryption.iterations).toBe(WALLET_BACKUP_KDF_ITERATIONS);
    }
    expect(JSON.stringify(backup)).not.toContain(VALID_PRIVATE_KEY);
    expect(JSON.stringify(backup)).not.toContain(SHIELDED_STATE_SNAPSHOT);
    await expect(decryptWalletBackup(backup, "wrong-pass")).rejects.toThrow(
      "invalid password"
    );

    const decryptedBackup = await decryptWalletBackup(backup, "backup-pass");
    expect(decryptedBackup.shieldedStateSnapshots).toEqual([
      {
        label: "Treasury shielded",
        stateSnapshot: JSON.stringify(JSON.parse(SHIELDED_STATE_SNAPSHOT))
      }
    ]);

    mockStoredState = null;
    mockStoredSession = null;

    await controller.importWalletBackup(backup, "backup-pass");

    expect((mockStoredState as StoredWalletState | null)?.shieldedWalletSnapshots).toEqual([
      expect.objectContaining({
        label: "Treasury shielded",
        assetId: "con_private"
      })
    ]);
    expect((mockStoredState as StoredWalletState | null)?.walletEncryption).toMatchObject({
      version: 1,
      algorithm: "PBKDF2-SHA256",
      iterations: WALLET_STATE_KDF_ITERATIONS,
      salt: expect.any(String)
    });

    const snapshotId = (mockStoredState as StoredWalletState | null)?.shieldedWalletSnapshots?.[0]?.id;
    expect(snapshotId).toEqual(expect.any(String));

    const exportedSnapshot = await controller.exportShieldedWalletSnapshot(
      snapshotId as string,
      "restored123"
    );
    expect(exportedSnapshot).toEqual({
      label: "Treasury shielded",
      stateSnapshot: JSON.stringify(JSON.parse(SHIELDED_STATE_SNAPSHOT))
    });

    await controller.removeShieldedWalletSnapshot(snapshotId as string);
    expect((mockStoredState as StoredWalletState | null)?.shieldedWalletSnapshots).toEqual([]);
  });

  it("requires explicit opt-in for remote HTTP RPC URLs", async () => {
    const controller = createWalletController();

    await expect(
      controller.createWallet({
        password: "secret123",
        privateKey: VALID_PRIVATE_KEY,
        rpcUrl: "http://192.168.1.10:26657"
      })
    ).rejects.toThrow("HTTP RPC URLs are disabled");

    await controller.createWallet({
      password: "secret123",
      privateKey: VALID_PRIVATE_KEY,
      networkName: "LAN node",
      rpcUrl: "http://192.168.1.10:26657",
      allowInsecureHttp: true
    });

    expect(mockStoredState?.networkPresets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "LAN node",
          rpcUrl: "http://192.168.1.10:26657",
          allowInsecureHttp: true
        })
      ])
    );
  });

  it("rejects encrypted wallet backups with weak KDF parameters", async () => {
    await expect(
      decryptWalletBackup(
        {
          version: 2,
          kind: "xian-wallet-backup",
          encryption: {
            algorithm: "AES-256-GCM",
            kdf: "PBKDF2-SHA256",
            iterations: 10_000,
            salt: "salt",
            iv: "iv"
          },
          ciphertext: "ciphertext"
        },
        "backup-pass"
      )
    ).rejects.toThrow("invalid wallet backup encryption parameters");
  });

  it("rejects plaintext wallet backup JSON", () => {
    expect(() =>
      parseWalletBackupJson(
        JSON.stringify({
          version: 1,
          type: "privateKey",
          privateKey: VALID_PRIVATE_KEY
        })
      )
    ).toThrow("invalid wallet backup");
  });
});


describe("vault work factor migration", () => {
  async function legacyWallet() {
    mockStoredState = null;
    mockStoredSession = null;
    mockStoredBiometricSession = null;
    const controller = createWalletController();
    await controller.createWallet({ password: "secret123", mnemonic: VALID_MNEMONIC });
    await controller.addAccount();
    await controller.saveShieldedWalletSnapshot(SHIELDED_STATE_SNAPSHOT);
    const state = JSON.parse(JSON.stringify(mockStoredState)) as StoredWalletState;
    const currentKey = Buffer.from(mockStoredSession!.sessionKey, "base64");
    const { pbkdf2Sync, createCipheriv, createDecipheriv, randomBytes } = require("node:crypto");
    const legacyKey = pbkdf2Sync("secret123", Buffer.from(state.walletEncryption.salt, "base64"), 250_000, 32, "sha256");
    function reencrypt(value: string): string {
      const payload = JSON.parse(value);
      const ciphertext = Buffer.from(payload.ciphertext, "base64");
      const decipher = createDecipheriv("aes-256-gcm", currentKey, Buffer.from(payload.iv, "base64"));
      decipher.setAuthTag(ciphertext.subarray(-16));
      const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", legacyKey, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
      return JSON.stringify({ algorithm: "AES-GCM", keySource: "wallet-session-key", iv: iv.toString("base64"), ciphertext: encrypted.toString("base64") });
    }
    state.encryptedPrivateKey = reencrypt(state.encryptedPrivateKey);
    state.encryptedMnemonic = reencrypt(state.encryptedMnemonic!);
    for (const account of state.accounts!) account.encryptedPrivateKey = reencrypt(account.encryptedPrivateKey);
    for (const snapshot of state.shieldedWalletSnapshots!) snapshot.encryptedStateSnapshot = reencrypt(snapshot.encryptedStateSnapshot);
    state.walletEncryption.iterations = 250_000;
    await controller.lock();
    mockStoredState = state;
    mockStoredBiometricSession = { publicKey: state.publicKey, sessionKey: legacyKey.toString("base64"), enabledAt: Date.now() };
    return { controller, state };
  }

  it("migrates accounts, mnemonic and snapshots, then unlocks again", async () => {
    const { controller, state } = await legacyWallet();
    await controller.unlock("secret123");
    expect(mockStoredState!.walletEncryption.iterations).toBe(600_000);
    expect(mockStoredState!.publicKey).toBe(state.publicKey);
    expect(mockStoredBiometricSession).toBeNull();
    await expect(controller.revealMnemonic("secret123")).resolves.toBe(VALID_MNEMONIC);
    const backup = await controller.exportWallet("backup-pass");
    const { decryptWalletBackup } = require("../wallet-backup");
    const payload = await decryptWalletBackup(backup, "backup-pass");
    expect(payload.shieldedStateSnapshots).toHaveLength(1);
    expect(payload.accounts).toHaveLength(2);
    await controller.switchAccount(0);
    await expect(controller.revealPrivateKey("secret123")).resolves.toBe("b3aee0ed179a18a754136d3d134c03e9c1ad97eb2e9912401dc2d9ffc96882e0");
    await controller.lock();
    await controller.unlock("secret123");
  });

  it("keeps the stored vault intact on authentication or secondary ciphertext failure", async () => {
    const { controller, state } = await legacyWallet();
    await expect(controller.unlock("wrong")).rejects.toThrow();
    expect(mockStoredState).toEqual(state);
    state.accounts![0]!.encryptedPrivateKey = "corrupt";
    const before = JSON.parse(JSON.stringify(state));
    await expect(controller.unlock("secret123")).rejects.toThrow();
    expect(mockStoredState).toEqual(before);
    expect(mockStoredSession).toBeNull();
  });

  it("preserves legacy ciphertext after a failed save and permits retry", async () => {
    const { controller, state } = await legacyWallet();
    mockStore.saveState.mockImplementationOnce(async () => { throw new Error("disk full"); });
    await expect(controller.unlock("secret123")).rejects.toThrow("disk full");
    expect(mockStoredState).toEqual(state);
    expect(mockStoredSession).toBeNull();
    await controller.unlock("secret123");
    expect(mockStoredState!.walletEncryption.iterations).toBe(600_000);
  });

  it("does not absorb a user lock into the internal KDF migration session reset", async () => {
    const { controller } = await legacyWallet();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    mockStore.clearUnlockedSession.mockImplementationOnce(async () => {
      entered(); await gate; mockStoredSession = null;
    });
    const unlocking = controller.unlock("secret123");
    const rejected = expect(unlocking).rejects.toThrow(/locked|changed/);
    await waiting;
    const locking = controller.lock();
    release();
    await Promise.all([rejected, locking]);
    expect(mockStoredSession).toBeNull();
    await expect(loadUnlockedWalletMaterial()).resolves.toBeNull();
    await controller.unlock("secret123");
    expect(await loadUnlockedWalletMaterial()).not.toBeNull();
  });

  it("rejects excessive work and malformed salts in imported backups", async () => {
    const { controller } = await legacyWallet();
    await controller.unlock("secret123");
    const backup = await controller.exportWallet("backup-pass");
    backup.encryption.iterations = 2_000_001;
    await expect(controller.importWalletBackup(backup, "backup-pass")).rejects.toThrow("invalid wallet backup encryption parameters");
    backup.encryption.iterations = 600_000;
    backup.encryption.salt = "AA==";
    await expect(controller.importWalletBackup(backup, "backup-pass")).rejects.toThrow("invalid wallet backup encryption parameters");
  });

  it.each(["settings", "replacement", "removal"])("preserves %s during migration cleanup", async (change) => {
    const { controller } = await legacyWallet();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    mockStore.clearBiometricSessionKey.mockImplementationOnce(async () => {
      entered(); await gate; mockStoredBiometricSession = null;
    });
    const unlocking = controller.unlock("secret123");
    const rejected = expect(unlocking).rejects.toThrow(/locked|changed/);
    await waiting;
    if (change === "settings") {
      mockStoredState = { ...mockStoredState!, rpcUrl: "http://127.0.0.1:26658" };
    } else if (change === "replacement") {
      await createWalletController().createWallet({ password: "replacement", privateKey: "22".repeat(32) });
    } else {
      await createWalletController().removeWallet();
    }
    const expected = JSON.parse(JSON.stringify(mockStoredState));
    release();
    await rejected;
    expect(mockStoredState).toEqual(expected);
  });

  it.each([2_000_001, 1.5, Infinity])("rejects an excessive or malformed stored work factor %s", async (iterations) => {
    const { controller, state } = await legacyWallet();
    state.walletEncryption.iterations = iterations;
    await expect(controller.unlock("secret123")).rejects.toThrow("invalid wallet encryption parameters");
  });
});

describe("portable backup encryption parameters", () => {
  const validEnvelope = {
    version: 2,
    kind: "xian-wallet-backup",
    encryption: {
      algorithm: "AES-256-GCM", kdf: "PBKDF2-SHA256", iterations: 600_000,
      salt: Buffer.alloc(16).toString("base64"), iv: Buffer.alloc(12).toString("base64")
    },
    ciphertext: Buffer.alloc(16).toString("base64")
  };

  it.each([
    { iterations: 249_999 }, { iterations: 2_000_001 }, { iterations: 1.5 },
    { iterations: "600000" }, { iterations: NaN }, { iterations: Infinity },
    { salt: Buffer.alloc(15).toString("base64") },
    { salt: Buffer.alloc(17).toString("base64") },
    { iv: Buffer.alloc(11).toString("base64") },
    { iv: Buffer.alloc(13).toString("base64") },
    { algorithm: "AES-CBC" }, { kdf: "PBKDF2-SHA1" }
  ])("rejects invalid parameters before deriving a key: %j", async (encryption) => {
    const crypto = require("../crypto-polyfill");
    const derive = jest.spyOn(crypto, "pbkdf2DeriveKey");
    const { decryptWalletBackup } = require("../wallet-backup");
    try {
      await expect(decryptWalletBackup({
        ...validEnvelope, encryption: { ...validEnvelope.encryption, ...encryption }
      }, "password")).rejects.toThrow("invalid wallet backup encryption parameters");
      expect(derive).not.toHaveBeenCalled();
    } finally {
      derive.mockRestore();
    }
  });

  it.each([250_000, 2_000_000])("imports a valid version-2 backup at %s iterations", async (iterations) => {
    const { pbkdf2Sync, createCipheriv } = require("node:crypto");
    const { decryptWalletBackup } = require("../wallet-backup");
    const payload = { version: 1, type: "privateKey", privateKey: VALID_PRIVATE_KEY };
    const key = pbkdf2Sync("password", Buffer.alloc(16), iterations, 32, "sha256");
    const cipher = createCipheriv("aes-256-gcm", key, Buffer.alloc(12));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload)), cipher.final(), cipher.getAuthTag()
    ]).toString("base64");
    await expect(decryptWalletBackup({
      ...validEnvelope, ciphertext,
      encryption: { ...validEnvelope.encryption, iterations }
    }, "password")).resolves.toEqual(payload);
  });
});
