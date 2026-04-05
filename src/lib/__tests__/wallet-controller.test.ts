import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { StoredUnlockedSession, StoredWalletState } from "../storage";

const VALID_PRIVATE_KEY = "11".repeat(32);
const VALID_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

let mockStoredState: StoredWalletState | null = null;
let mockStoredSession: StoredUnlockedSession | null = null;

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
      require("node:crypto").createHash("sha256").update(mnemonic).digest()
    )
  ),
  validateMnemonic: jest.fn(
    (mnemonic: string) =>
      mnemonic ===
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  )
}));

jest.mock("@scure/bip39/wordlists/english", () => ({
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
  isValidEd25519Key: (value: string) => /^[0-9a-f]{64}$/.test(value)
}));

const { __mockStore: mockStore } = jest.requireMock("../storage") as {
  __mockStore: {
    loadState: jest.Mock;
    saveState: jest.Mock;
    clearState: jest.Mock;
    loadUnlockedSession: jest.Mock;
    saveUnlockedSession: jest.Mock;
    clearUnlockedSession: jest.Mock;
  };
};

import { createWalletController } from "../wallet-controller";

describe("wallet-controller", () => {
  beforeEach(() => {
    mockStoredState = null;
    mockStoredSession = null;
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
  });

  it("persists a session key instead of a plaintext password", async () => {
    const controller = createWalletController();

    await controller.createWallet({
      password: "secret123",
      privateKey: VALID_PRIVATE_KEY
    });

    expect(mockStoredState?.walletEncryptionSalt).toEqual(expect.any(String));
    expect(mockStoredSession).toMatchObject({
      privateKey: VALID_PRIVATE_KEY,
      sessionKey: expect.any(String)
    });
    expect("password" in (mockStoredSession as object)).toBe(false);
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

  it("fails unlock with the wrong password", async () => {
    const controller = createWalletController();

    await controller.createWallet({
      password: "secret123",
      privateKey: VALID_PRIVATE_KEY
    });
    await controller.lock();

    await expect(controller.unlock("wrong-password")).rejects.toThrow();
  });
});
