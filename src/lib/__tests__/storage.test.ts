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
  default: mockAsyncStorage,
  ...mockAsyncStorage,
}));
jest.mock("expo-secure-store", () => mockSecureStore);

import {
  clearUnlockedSession,
  loadBiometricSessionKey,
  loadUnlockedSession,
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
});

function rejectSecureStoreGetOnce(error: Error): void {
  (
    mockSecureStore.getItemAsync as unknown as {
      mockRejectedValueOnce: (value: Error) => void;
    }
  ).mockRejectedValueOnce(error);
}

function rejectSecureStoreDelete(error: Error): void {
  (
    mockSecureStore.deleteItemAsync as unknown as {
      mockRejectedValue: (value: Error) => void;
    }
  ).mockRejectedValue(error);
}
