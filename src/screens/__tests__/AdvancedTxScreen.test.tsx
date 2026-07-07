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
  const mockGetChiRate = jest.fn() as jest.Mock;
  const mockEstimateChi = jest.fn() as jest.Mock;
  const mockSendTransaction = jest.fn() as jest.Mock;
  const mockRefreshBalances = jest.fn(async () => undefined) as jest.Mock;
  const mockShowToast = jest.fn() as jest.Mock;
  const mockNotifyActivityChanged = jest.fn() as jest.Mock;

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
        getChiRate: mockGetChiRate,
        estimateChi: mockEstimateChi,
        sendTransaction: mockSendTransaction
      },
      refreshBalances: mockRefreshBalances,
      showToast: mockShowToast,
      notifyActivityChanged: mockNotifyActivityChanged
    });
    mockLoadUnlockedSession.mockImplementation(async () => ({
      privateKey: "11".repeat(32),
      sessionKey: "session-key",
      expiresAt: Date.now() + 60_000
    }));
    mockGetChiRate.mockImplementation(async () => 20);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("loads contract methods and preserves typed kwargs with manual bigint chi", async () => {
    mockGetContractMethods.mockImplementation(async () => [
      {
        name: "mint",
        arguments: [
          { name: "count", type: "int" },
          { name: "amount", type: "float" },
          { name: "config", type: "dict" },
          { name: "flag", type: "bool" }
        ]
      }
    ]);
    mockEstimateChi.mockImplementation(async () => ({
      estimated: 10_000
    }));
    mockSendTransaction.mockImplementation(async () => ({
      submitted: true,
      accepted: true,
      finalized: true,
      txHash: "XYZ789"
    }));

    const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof AdvancedTxScreen>["navigation"];
    const route = {} as unknown as React.ComponentProps<typeof AdvancedTxScreen>["route"];
    const screen = await render(<AdvancedTxScreen navigation={navigation} route={route} />);

    await fireEvent.changeText(screen.getByPlaceholderText("e.g. currency"), "con_token");
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => expect(screen.getByText("mint")).toBeTruthy());
    await fireEvent.press(screen.getByText("mint"));
    await fireEvent.changeText(screen.getByPlaceholderText("int value"), "9007199254740993");
    await fireEvent.changeText(screen.getByPlaceholderText("float value"), "12.5");
    await fireEvent.changeText(
      screen.getByPlaceholderText("dict value"),
      "{\"mode\":\"fast\"}"
    );
    await fireEvent.changeText(screen.getByPlaceholderText("bool value"), "true");
    await fireEvent.changeText(screen.getByPlaceholderText("Auto-estimate"), "9007199254740995");
    await fireEvent.press(screen.getByText("Review Transaction"));

    expect(mockEstimateChi).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Send Transaction")).toBeTruthy());

    await fireEvent.press(screen.getByText("Send Transaction"));

    await waitFor(() =>
      expect(mockSendTransaction).toHaveBeenCalledWith({
        privateKey: "11".repeat(32),
        contract: "con_token",
        function: "mint",
        kwargs: {
          count: 9007199254740993n,
          amount: { __fixed__: "12.5" },
          config: { mode: "fast" },
          flag: true
        },
        chi: 9007199254740995n
      })
    );
    expect(mockShowToast).toHaveBeenNthCalledWith(
      1,
      "Transaction sent.",
      "info",
      expect.objectContaining({
        icon: "info",
        detail: "XYZ789",
        action: {
          label: "View transaction",
          url: "http://127.0.0.1:8080/explorer/tx/XYZ789"
        }
      })
    );
    await act(() => {
      jest.advanceTimersByTime(1600);
    });
    expect(mockShowToast).toHaveBeenNthCalledWith(
      2,
      "Transaction finalized.",
      "success",
      expect.objectContaining({
        icon: "success",
        detail: "XYZ789",
        action: {
          label: "View transaction",
          url: "http://127.0.0.1:8080/explorer/tx/XYZ789"
        }
      })
    );
    expect(navigation.navigate).toHaveBeenCalledWith("Main");
    expect(mockNotifyActivityChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        txHash: "XYZ789",
        sender: "sender",
        contract: "con_token",
        function: "mint",
        accepted: true,
        finalized: true,
        kwargs: {
          count: 9007199254740993n,
          amount: { __fixed__: "12.5" },
          config: { mode: "fast" },
          flag: true
        }
      })
    );
  });

  it("uses the exact simulated chi when chi is auto-estimated", async () => {
    mockGetContractMethods.mockImplementation(async () => []);
    mockEstimateChi.mockImplementation(async () => ({
      estimated: 10_000
    }));
    mockSendTransaction.mockImplementation(async () => ({
      submitted: true,
      accepted: true,
      finalized: true,
      txHash: "AUTO123"
    }));

    const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof AdvancedTxScreen>["navigation"];
    const route = {} as unknown as React.ComponentProps<typeof AdvancedTxScreen>["route"];
    const screen = await render(<AdvancedTxScreen navigation={navigation} route={route} />);

    await fireEvent.changeText(screen.getByPlaceholderText("e.g. currency"), "currency");
    await fireEvent.changeText(screen.getByPlaceholderText("e.g. transfer"), "approve");
    await fireEvent.press(screen.getByText("Review Transaction"));

    await waitFor(() =>
      expect(mockEstimateChi).toHaveBeenCalledWith({
        sender: "sender",
        contract: "currency",
        function: "approve",
        kwargs: {}
      })
    );

    await fireEvent.press(screen.getByText("Send Transaction"));

    await waitFor(() =>
      expect(mockSendTransaction).toHaveBeenCalledWith({
        privateKey: "11".repeat(32),
        contract: "currency",
        function: "approve",
        kwargs: {},
        chi: 10_000
      })
    );
  });
});
