import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockAsyncStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
};

const mockSecureStore = {
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
};

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: (...args: unknown[]) => mockAsyncStorage.getItem(...args),
    setItem: (...args: unknown[]) => mockAsyncStorage.setItem(...args),
    removeItem: (...args: unknown[]) => mockAsyncStorage.removeItem(...args),
  },
  ...mockAsyncStorage,
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: (...args: unknown[]) => mockSecureStore.getItemAsync(...args),
  setItemAsync: (...args: unknown[]) => mockSecureStore.setItemAsync(...args),
  deleteItemAsync: (...args: unknown[]) => mockSecureStore.deleteItemAsync(...args),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
}));
jest.mock(
  "@xian-tech/provider",
  () => ({
    xianDappPoliciesHaveSameScope: (left: any, right: any) => {
      const sameMethods =
        Array.isArray(left.methods) &&
        Array.isArray(right.methods) &&
        left.methods.length === right.methods.length &&
        left.methods.every((method: string) => right.methods.includes(method));
      const leftScope = left.argumentScope === "any" ? "any" : "exact";
      const rightScope = right.argumentScope === "any" ? "any" : "exact";
      return (
        left.origin === right.origin &&
        left.account === right.account &&
        left.chainId === right.chainId &&
        left.contract === right.contract &&
        left.function === right.function &&
        sameMethods &&
        leftScope === rightScope &&
        (leftScope === "any" ||
          JSON.stringify(left.kwargs ?? {}) === JSON.stringify(right.kwargs ?? {}))
      );
    },
  }),
  { virtual: true }
);

import {
  clearUnlockedSession,
  loadDexAvailability,
  loadBiometricSessionKey,
  loadUnlockedSession,
  saveDexAvailability,
  saveUnlockedSession,
} from "../storage";

describe("secure storage adapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("treats SecureStore read failures as an absent unlocked session", async () => {
    rejectSecureStoreGetOnce(new Error("A required entitlement isn't present."));

    await expect(loadUnlockedSession()).resolves.toBeNull();
  });

  it("treats SecureStore read failures as an absent biometric session", async () => {
    rejectSecureStoreGetOnce(new Error("A required entitlement isn't present."));

    await expect(loadBiometricSessionKey()).resolves.toBeNull();
  });

  it("does not fail session clearing when SecureStore delete is unavailable", async () => {
    rejectSecureStoreDelete(new Error("A required entitlement isn't present."));

    await expect(clearUnlockedSession()).resolves.toBeUndefined();
  });

  it("stores only a device-bound versioned unlocked session", async () => {
    const session = {
      version: 2 as const,
      publicKey: "aa".repeat(32),
      sessionKey: "wrapped-session-key",
      expiresAt: Date.now() + 60_000,
    };

    await saveUnlockedSession(session);

    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
      "xian_unlocked_session",
      JSON.stringify(session),
      {
        keychainAccessible: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
        keychainService: "xian_unlocked_session",
      }
    );
  });

  it("deletes legacy unlocked sessions containing raw secrets and stays locked", async () => {
    mockSecureStoreGetOnce(JSON.stringify({
      privateKey: "11".repeat(32),
      mnemonic: "legacy mnemonic",
      sessionKey: "legacy-session-key",
      expiresAt: Date.now() + 60_000,
    }));

    await expect(loadUnlockedSession()).resolves.toBeNull();
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith(
      "xian_unlocked_session",
      {
        keychainAccessible: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
        keychainService: "xian_unlocked_session",
      }
    );
  });

  it("deletes malformed versioned sessions instead of partially restoring them", async () => {
    mockSecureStoreGetOnce(JSON.stringify({
      version: 2,
      publicKey: "not-a-public-key",
      sessionKey: "session-key",
      expiresAt: Date.now() + 60_000,
    }));

    await expect(loadUnlockedSession()).resolves.toBeNull();
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
  });

  it("stores positive DEX availability per network key", async () => {
    mockAsyncStorageGetOnce(JSON.stringify([
      {
        networkKey: "other|http://rpc",
        contract: "con_dex",
        checkedAt: "2026-06-05T00:00:00.000Z",
      },
    ]));

    await saveDexAvailability({
      networkKey: "local|http://127.0.0.1:26657",
      contract: "con_dex",
      checkedAt: "2026-06-05T12:00:00.000Z",
    });

    const stored = JSON.parse(String((mockAsyncStorage.setItem as jest.Mock).mock.calls[0]?.[1]));
    expect(stored).toEqual([
      {
        networkKey: "local|http://127.0.0.1:26657",
        contract: "con_dex",
        checkedAt: "2026-06-05T12:00:00.000Z",
      },
      {
        networkKey: "other|http://rpc",
        contract: "con_dex",
        checkedAt: "2026-06-05T00:00:00.000Z",
      },
    ]);

    mockAsyncStorageGetOnce(JSON.stringify(stored));
    await expect(loadDexAvailability("local|http://127.0.0.1:26657")).resolves.toEqual({
      networkKey: "local|http://127.0.0.1:26657",
      contract: "con_dex",
      checkedAt: "2026-06-05T12:00:00.000Z",
    });
  });
});

function rejectSecureStoreGetOnce(error: Error): void {
  (
    mockSecureStore.getItemAsync as unknown as {
      mockRejectedValueOnce: (value: Error) => void;
    }
  ).mockRejectedValueOnce(error);
}

function mockSecureStoreGetOnce(value: unknown): void {
  (
    mockSecureStore.getItemAsync as unknown as {
      mockResolvedValueOnce: (value: unknown) => void;
    }
  ).mockResolvedValueOnce(value);
}

function rejectSecureStoreDelete(error: Error): void {
  (
    mockSecureStore.deleteItemAsync as unknown as {
      mockRejectedValue: (value: Error) => void;
    }
  ).mockRejectedValue(error);
}

function mockAsyncStorageGetOnce(value: unknown): void {
  (
    mockAsyncStorage.getItem as unknown as {
      mockResolvedValueOnce: (value: unknown) => void;
    }
  ).mockResolvedValueOnce(value);
}
