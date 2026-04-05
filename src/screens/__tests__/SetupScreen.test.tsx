import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import * as Clipboard from "expo-clipboard";

const mockUseWallet = jest.fn() as jest.Mock;

jest.mock("../../lib/wallet-context", () => ({
  useWallet: () => mockUseWallet()
}));

import { SetupScreen } from "../SetupScreen";

describe("SetupScreen", () => {
  const mockCreateWallet = jest.fn() as jest.Mock;
  const mockRefresh = jest.fn(async () => undefined) as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseWallet.mockReturnValue({
      refresh: mockRefresh,
      controller: {
        createWallet: mockCreateWallet
      }
    });
  });

  it("shows the generated seed and lets the user copy it", async () => {
    const mnemonic = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu";
    mockCreateWallet.mockImplementation(async () => ({ mnemonic }));

    const screen = render(<SetupScreen />);
    fireEvent.changeText(screen.getByPlaceholderText("Wallet password"), "secret123");
    fireEvent.changeText(screen.getByPlaceholderText("Confirm password"), "secret123");
    fireEvent.press(screen.getByText("Create Wallet"));

    await waitFor(() => expect(screen.getByText("Recovery Seed")).toBeTruthy());
    fireEvent.press(screen.getByText(mnemonic));

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(mnemonic);
  });

  it("passes key imports through to the controller", async () => {
    mockCreateWallet.mockImplementation(async () => ({}));

    const screen = render(<SetupScreen />);
    fireEvent.press(screen.getByText("Key"));
    fireEvent.changeText(screen.getByPlaceholderText("Wallet password"), "secret123");
    fireEvent.changeText(
      screen.getByPlaceholderText("64-character hex key"),
      "11".repeat(32)
    );
    fireEvent.press(screen.getByText("Import from Key"));

    await waitFor(() =>
      expect(mockCreateWallet).toHaveBeenCalledWith({
        password: "secret123",
        privateKey: "11".repeat(32)
      })
    );
  });
});
