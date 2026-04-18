import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

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

import { AdvancedTxScreen } from "../AdvancedTxScreen";

describe("AdvancedTxScreen", () => {
  const mockGetContractMethods = jest.fn() as jest.Mock;
  const mockEstimateChi = jest.fn() as jest.Mock;
  const mockSendTransaction = jest.fn() as jest.Mock;
  const mockRefreshBalances = jest.fn(async () => undefined) as jest.Mock;
  const mockShowToast = jest.fn() as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockUseWallet.mockReturnValue({
      state: {
        publicKey: "sender",
        rpcUrl: "http://127.0.0.1:26657",
        dashboardUrl: "http://127.0.0.1:8080"
      },
      rpc: {
        getContractMethods: mockGetContractMethods,
        estimateChi: mockEstimateChi,
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

  afterEach(() => {
    jest.useRealTimers();
  });

  it("loads contract methods and preserves typed kwargs and bigint chi", async () => {
    mockGetContractMethods.mockImplementation(async () => [
      {
        name: "mint",
        arguments: [
          { name: "count", type: "int" },
          { name: "config", type: "dict" },
          { name: "flag", type: "bool" }
        ]
      }
    ]);
    mockEstimateChi.mockImplementation(async () => ({
      estimated: 10_000,
      suggested: 12_000
    }));
    mockSendTransaction.mockImplementation(async () => ({
      submitted: true,
      accepted: true,
      finalized: true,
      txHash: "XYZ789"
    }));

    const screen = render(<AdvancedTxScreen />);

    fireEvent.changeText(screen.getByPlaceholderText("e.g. currency"), "con_token");
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => expect(screen.getByText("mint")).toBeTruthy());
    fireEvent.press(screen.getByText("mint"));
    fireEvent.changeText(screen.getByPlaceholderText("int value"), "9007199254740993");
    fireEvent.changeText(
      screen.getByPlaceholderText("dict value"),
      "{\"mode\":\"fast\"}"
    );
    fireEvent.changeText(screen.getByPlaceholderText("bool value"), "true");
    fireEvent.changeText(screen.getByPlaceholderText("Auto-estimate"), "9007199254740995");
    fireEvent.press(screen.getByText("Review Transaction"));

    await waitFor(() =>
      expect(mockEstimateChi).toHaveBeenCalledWith({
        sender: "sender",
        contract: "con_token",
        function: "mint",
        kwargs: {
          count: 9007199254740993n,
          config: { mode: "fast" },
          flag: true
        }
      })
    );

    fireEvent.press(screen.getByText("Send Transaction"));

    await waitFor(() =>
      expect(mockSendTransaction).toHaveBeenCalledWith({
        privateKey: "11".repeat(32),
        contract: "con_token",
        function: "mint",
        kwargs: {
          count: 9007199254740993n,
          config: { mode: "fast" },
          flag: true
        },
        chi: 9007199254740995n
      })
    );
    expect(mockShowToast).toHaveBeenCalledWith("Transaction finalized.", "success");
  });
});
