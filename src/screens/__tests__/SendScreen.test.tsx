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
  const mockEstimateChi = jest.fn() as jest.Mock;
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
        getChiRate: jest.fn(async () => 20),
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

  it("reviews and sends a transfer using bigint-safe parsing", async () => {
    mockEstimateChi.mockImplementation(async () => ({
      estimated: 12_000
    }));
    mockSendTransaction.mockImplementation(async () => ({
      submitted: true,
      accepted: true,
      finalized: true,
      txHash: "ABC123"
    }));

    const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof SendScreen>["navigation"];
    const route = { params: { token: "currency" } } as unknown as React.ComponentProps<typeof SendScreen>["route"];
    const screen = render(<SendScreen navigation={navigation} route={route} />);

    fireEvent.changeText(screen.getByPlaceholderText("Wallet address"), "ab".repeat(32));
    fireEvent.changeText(
      screen.getByPlaceholderText("0.00"),
      "9007199254740993"
    );
    fireEvent.press(screen.getByText("Review"));

    await waitFor(() =>
      expect(mockEstimateChi).toHaveBeenCalledWith({
        sender: "sender",
        contract: "currency",
        function: "transfer",
        kwargs: {
          to: "ab".repeat(32),
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
          to: "ab".repeat(32),
          amount: 9007199254740993n
        },
        chi: 12_000
      })
    );
    expect(mockShowToast).toHaveBeenCalledWith("Transaction finalized.", "success");
  });

  it("reviews and sends decimal transfers as runtime fixed values", async () => {
    mockEstimateChi.mockImplementation(async () => ({
      estimated: 12_000
    }));
    mockSendTransaction.mockImplementation(async () => ({
      submitted: true,
      accepted: true,
      finalized: true,
      txHash: "DEC123"
    }));

    const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof SendScreen>["navigation"];
    const route = { params: { token: "currency" } } as unknown as React.ComponentProps<typeof SendScreen>["route"];
    const screen = render(<SendScreen navigation={navigation} route={route} />);

    fireEvent.changeText(screen.getByPlaceholderText("Wallet address"), "ab".repeat(32));
    fireEvent.changeText(screen.getByPlaceholderText("0.00"), "12.5");
    fireEvent.press(screen.getByText("Review"));

    await waitFor(() =>
      expect(mockEstimateChi).toHaveBeenCalledWith({
        sender: "sender",
        contract: "currency",
        function: "transfer",
        kwargs: {
          to: "ab".repeat(32),
          amount: { __fixed__: "12.5" }
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
          to: "ab".repeat(32),
          amount: { __fixed__: "12.5" }
        },
        chi: 12_000
      })
    );
  });

  it("allows unrecognized recipients after explicit in-app confirmation", async () => {
    mockEstimateChi.mockImplementation(async () => ({
      estimated: 12_000
    }));

    const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof SendScreen>["navigation"];
    const route = { params: { token: "currency" } } as unknown as React.ComponentProps<typeof SendScreen>["route"];
    const screen = render(<SendScreen navigation={navigation} route={route} />);

    fireEvent.changeText(screen.getByPlaceholderText("Wallet address"), "qwe");
    fireEvent.changeText(screen.getByPlaceholderText("0.00"), "5");
    fireEvent.press(screen.getByText("Review"));

    expect(screen.getByText("Confirm recipient")).toBeTruthy();
    expect(mockEstimateChi).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText("Send Anyway"));

    await waitFor(() =>
      expect(mockEstimateChi).toHaveBeenCalledWith({
        sender: "sender",
        contract: "currency",
        function: "transfer",
        kwargs: {
          to: "qwe",
          amount: 5
        }
      })
    );
  });

  it("does not estimate an unrecognized recipient when confirmation is cancelled", async () => {
    const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof SendScreen>["navigation"];
    const route = { params: { token: "currency" } } as unknown as React.ComponentProps<typeof SendScreen>["route"];
    const screen = render(<SendScreen navigation={navigation} route={route} />);

    fireEvent.changeText(screen.getByPlaceholderText("Wallet address"), "qwe");
    fireEvent.changeText(screen.getByPlaceholderText("0.00"), "5");
    fireEvent.press(screen.getByText("Review"));

    expect(screen.getByText("Confirm recipient")).toBeTruthy();
    fireEvent.press(screen.getByText("Cancel"));

    expect(mockEstimateChi).not.toHaveBeenCalled();
  });
});
