import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockUseWallet = jest.fn() as jest.Mock;
const mockGetBiometricStatus = jest.fn() as jest.Mock;

jest.mock("../../lib/wallet-context", () => ({
  useWallet: () => mockUseWallet(),
}));

jest.mock("../../lib/biometrics", () => ({
  getBiometricStatus: () => mockGetBiometricStatus(),
}));

jest.mock("../../lib/haptics", () => ({
  successTap: jest.fn(),
  errorTap: jest.fn(),
}));

import { LockScreen } from "../LockScreen";

describe("LockScreen", () => {
  const mockRefresh = jest.fn(async () => undefined) as jest.Mock;
  const mockUnlock = jest.fn() as jest.Mock;
  const mockUnlockWithBiometrics = jest.fn() as jest.Mock;
  const mockIsBiometricUnlockEnabled = jest.fn() as jest.Mock;
  const mockRemoveWallet = jest.fn() as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBiometricStatus.mockImplementation(async () => ({
      available: true,
      enrolled: true,
      label: "Fingerprint",
    }));
    mockIsBiometricUnlockEnabled.mockImplementation(async () => true);
    mockUnlock.mockImplementation(async () => undefined);
    mockUnlockWithBiometrics.mockImplementation(async () => undefined);
    mockRemoveWallet.mockImplementation(async () => undefined);
    mockUseWallet.mockReturnValue({
      refresh: mockRefresh,
      controller: {
        unlock: mockUnlock,
        unlockWithBiometrics: mockUnlockWithBiometrics,
        isBiometricUnlockEnabled: mockIsBiometricUnlockEnabled,
        removeWallet: mockRemoveWallet,
      },
    });
  });

  it("auto-starts fingerprint unlock while biometric unlock is enabled", async () => {
    const screen = render(<LockScreen />);

    expect(screen.getByText("Checking unlock options.")).toBeTruthy();
    await waitFor(() => expect(mockUnlockWithBiometrics).toHaveBeenCalledTimes(1));

    expect(screen.queryByPlaceholderText("Password")).toBeNull();
    expect(screen.queryByText("Unlock")).toBeNull();
    expect(screen.queryByText("Unlock with Fingerprint")).toBeNull();
    expect(mockUnlock).not.toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("reveals password unlock after five consecutive fingerprint failures", async () => {
    mockUnlockWithBiometrics.mockImplementation(async () => {
      throw new Error("biometric failed");
    });

    const screen = render(<LockScreen />);
    await waitFor(() => expect(mockUnlockWithBiometrics).toHaveBeenCalledTimes(1));

    for (let attempt = 2; attempt <= 5; attempt += 1) {
      await waitFor(() => expect(screen.getByText("Try Fingerprint again")).toBeTruthy());
      fireEvent.press(screen.getByText("Try Fingerprint again"));
      await waitFor(() => expect(mockUnlockWithBiometrics).toHaveBeenCalledTimes(attempt));
    }

    await waitFor(() =>
      expect(screen.getByText("Fingerprint unlock failed 5 times. Enter your password to unlock.")).toBeTruthy()
    );
    expect(screen.queryByText("Try Fingerprint again")).toBeNull();

    fireEvent.changeText(screen.getByPlaceholderText("Password"), "secret123");
    fireEvent.press(screen.getByText("Unlock"));

    await waitFor(() => expect(mockUnlock).toHaveBeenCalledWith("secret123"));
  });

  it("shows password unlock when biometric unlock is not enabled", async () => {
    mockIsBiometricUnlockEnabled.mockImplementation(async () => false);

    const screen = render(<LockScreen />);

    await waitFor(() => expect(screen.getByPlaceholderText("Password")).toBeTruthy());
    expect(screen.getByText("Unlock")).toBeTruthy();
    expect(screen.queryByText("Unlock with Fingerprint")).toBeNull();
  });
});
