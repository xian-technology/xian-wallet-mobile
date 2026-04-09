import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockUseWallet = jest.fn() as jest.Mock;
const mockLoadUnlockedSession = jest.fn() as jest.Mock;

jest.mock("../../lib/wallet-context", () => ({
  useWallet: () => mockUseWallet()
}));

jest.mock("../../lib/storage", () => ({
  loadUnlockedSession: () => mockLoadUnlockedSession()
}));

jest.mock("../../lib/haptics", () => ({
  lightTap: jest.fn(),
  successTap: jest.fn(),
  errorTap: jest.fn()
}));

import { SendScreen } from "../SendScreen";

describe("SendScreen", () => {
  const mockEstimateStamps = jest.fn() as jest.Mock;
  const mockSendTransaction = jest.fn() as jest.Mock;
  const mockRefreshBalances = jest.fn(async () => undefined) as jest.Mock;
  const mockShowToast = jest.fn() as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseWallet.mockReturnValue({
      state: {
        publicKey: "sender",
        watchedAssets: [{ contract: "currency", name: "Xian", symbol: "XIAN" }],
        assetBalances: { currency: "9007199254740993" },
        contacts: [],
        dashboardUrl: "http://127.0.0.1:8080"
      },
      rpc: {
        getStampRate: jest.fn(async () => 20),
        estimateStamps: mockEstimateStamps,
        sendTransaction: mockSendTransaction
      },
      refreshBalances: mockRefreshBalances,
      showToast: mockShowToast
    });
    mockLoadUnlockedSession.mockImplementation(async () => ({
      privateKey: "11".repeat(32),
      sessionKey: "session-key",
      expiresAt: Date.now() + 60_000
    }));
  });

  it("reviews and sends a transfer using bigint-safe parsing", async () => {
    mockEstimateStamps.mockImplementation(async () => ({
      estimated: 12_000,
      suggested: 14_400
    }));
    mockSendTransaction.mockImplementation(async () => ({
      submitted: true,
      accepted: true,
      finalized: true,
      txHash: "ABC123"
    }));

    const screen = render(
      <SendScreen navigation={{ navigate: jest.fn() }} route={{ params: { token: "currency" } }} />
    );

    fireEvent.changeText(screen.getByPlaceholderText("Wallet address"), "receiver");
    fireEvent.changeText(
      screen.getByPlaceholderText("0.00"),
      "9007199254740993"
    );
    fireEvent.press(screen.getByText("Review"));

    await waitFor(() =>
      expect(mockEstimateStamps).toHaveBeenCalledWith({
        sender: "sender",
        contract: "currency",
        function: "transfer",
        kwargs: {
          to: "receiver",
          amount: 9007199254740993n
        }
      })
    );

    fireEvent.press(screen.getByText("Send Transaction"));

    await waitFor(() =>
      expect(mockSendTransaction).toHaveBeenCalledWith({
        privateKey: "11".repeat(32),
        contract: "currency",
        function: "transfer",
        kwargs: {
          to: "receiver",
          amount: 9007199254740993n
        },
        stamps: 12_000
      })
    );
    expect(mockShowToast).toHaveBeenCalledWith("Transaction finalized.", "success");
  });
});
