import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockUseWallet = jest.fn() as jest.Mock;
const mockLoadUnlockedSession = jest.fn() as jest.Mock;
const mockLoadDexAvailability = jest.fn() as jest.Mock;
const mockSaveDexAvailability = jest.fn() as jest.Mock;

jest.mock("../../lib/wallet-context", () => ({
  useWallet: () => mockUseWallet()
}));

jest.mock("../../lib/storage", () => ({
  loadUnlockedSession: () => mockLoadUnlockedSession(),
  loadDexAvailability: (...args: unknown[]) => mockLoadDexAvailability(...args),
  saveDexAvailability: (...args: unknown[]) => mockSaveDexAvailability(...args),
}));

jest.mock("../../lib/haptics", () => ({
  lightTap: jest.fn(),
  successTap: jest.fn(),
  errorTap: jest.fn()
}));

import { TradeScreen } from "../TradeScreen";

describe("TradeScreen", () => {
  const mockGetContractMethods = jest.fn() as jest.Mock;
  const mockGetState = jest.fn() as jest.Mock;
  const mockGetTokenMetadata = jest.fn() as jest.Mock;
  const mockGetBalanceResult = jest.fn() as jest.Mock;
  const mockCall = jest.fn() as jest.Mock;
  const mockEstimateChi = jest.fn() as jest.Mock;
  const mockSendTransaction = jest.fn() as jest.Mock;
  const mockGetChiRate = jest.fn() as jest.Mock;
  const mockRefreshBalances = jest.fn(async () => undefined) as jest.Mock;
  const mockShowToast = jest.fn() as jest.Mock;
  const mockNotifyActivityChanged = jest.fn() as jest.Mock;
  let approved = false;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    approved = false;
    mockLoadDexAvailability.mockImplementation(async () => null);
    mockSaveDexAvailability.mockImplementation(async () => undefined);
    mockLoadUnlockedSession.mockImplementation(async () => ({
      privateKey: "11".repeat(32),
      sessionKey: "session-key",
      expiresAt: Date.now() + 60_000
    }));
    mockGetContractMethods.mockImplementation(async () => [
      { name: "swapExactTokensForTokens", arguments: [] }
    ]);
    mockGetState.mockImplementation(async (...args: unknown[]) => {
      const [contract, variable, keys = []] = args as [string, string, string[]?];
      const key = `${contract}.${variable}:${keys.join(":")}`;
      const values: Record<string, unknown> = {
        "con_pairs.pairs_num:": 1,
        "con_pairs.pairs:1:token0": "currency",
        "con_pairs.pairs:1:token1": "con_wtt",
        "con_pairs.pairs:1:reserve0": "100",
        "con_pairs.pairs:1:reserve1": "200",
        "con_pairs.pairs:1:totalSupply": "100",
        "con_pairs.pairs:1:blockTimestampLast": "123",
        "con_pairs.pairs:1:creationTime": "2026-06-05",
        "currency.metadata:precision": 8,
        "con_wtt.metadata:precision": 8,
        "currency.approvals:sender:con_dex": approved ? "10" : "0",
        "con_wtt.approvals:sender:con_dex": "0",
        "con_dex.fee_on_transfer_tokens:currency": false,
        "con_dex.fee_on_transfer_tokens:con_wtt": false,
      };
      return values[key] ?? null;
    });
    mockGetTokenMetadata.mockImplementation(async (...args: unknown[]) => {
      const [contract] = args as [string];
      return {
      contract,
      name: contract === "currency" ? "Xian" : "Wallet Test Token",
      symbol: contract === "currency" ? "XIAN" : "WTT",
      logoUrl: null,
      logoSvg: null,
      };
    });
    mockGetBalanceResult.mockImplementation(async (...args: unknown[]) => {
      const [, contract] = args as [string, string];
      return {
        contract,
        balance: contract === "currency" ? "10" : "0",
        status: "available",
      };
    });
    mockCall.mockImplementation(async () => 30);
    mockGetChiRate.mockImplementation(async () => 20);
    mockEstimateChi.mockImplementation(async (...args: unknown[]) => {
      const [request] = args as [{ contract: string }];
      return {
        estimated: request.contract === "con_dex" ? 12_000 : 8_000
      };
    });
    mockSendTransaction.mockImplementation(async (...args: unknown[]) => {
      const [request] = args as [{ contract: string }];
      if (request.contract === "currency") {
        approved = true;
        return {
          submitted: true,
          accepted: true,
          finalized: true,
          txHash: "APPROVE123",
        };
      }
      return {
        submitted: true,
        accepted: true,
        finalized: true,
        txHash: "SWAP123",
      };
    });
    mockUseWallet.mockReturnValue({
      state: {
        publicKey: "sender",
        activeNetworkId: "local",
        activeNetworkName: "Local node",
        rpcUrl: "http://127.0.0.1:26657",
        dashboardUrl: "http://127.0.0.1:8080",
        watchedAssets: [{ contract: "currency", name: "Xian", symbol: "XIAN" }],
      },
      rpc: {
        getContractMethods: mockGetContractMethods,
        getState: mockGetState,
        getTokenMetadata: mockGetTokenMetadata,
        getBalanceResult: mockGetBalanceResult,
        call: mockCall,
        estimateChi: mockEstimateChi,
        sendTransaction: mockSendTransaction,
        getChiRate: mockGetChiRate,
      },
      refreshBalances: mockRefreshBalances,
      showToast: mockShowToast,
      notifyActivityChanged: mockNotifyActivityChanged,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("approves the input token and sends the swap through con_dex", async () => {
    const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof TradeScreen>["navigation"];
    const route = {} as unknown as React.ComponentProps<typeof TradeScreen>["route"];
    const screen = render(<TradeScreen navigation={navigation} route={route} />);

    await waitFor(() => expect(screen.getByText("Enter amount")).toBeTruthy());
    fireEvent.changeText(screen.getAllByPlaceholderText("0.00")[0], "1");
    await waitFor(() => expect(screen.getByText("Approve XIAN")).toBeTruthy());
    fireEvent.press(screen.getByText("Approve XIAN"));

    await waitFor(() =>
      expect(mockSendTransaction).toHaveBeenCalledWith({
        privateKey: "11".repeat(32),
        contract: "currency",
        function: "approve",
        kwargs: { amount: { __fixed__: "1" }, to: "con_dex" },
        chi: 8_000,
      })
    );
    await waitFor(() =>
      expect(
        screen.getByText("Approval complete. Review and send the swap to complete the trade.")
      ).toBeTruthy()
    );
    await waitFor(() => expect(screen.getByText("Review Swap")).toBeTruthy());

    fireEvent.press(screen.getByText("Review Swap"));
    await waitFor(() => expect(screen.getByText("Trade summary")).toBeTruthy());
    fireEvent.press(screen.getByText("Send Swap"));

    await waitFor(() =>
      expect(mockSendTransaction).toHaveBeenLastCalledWith({
        privateKey: "11".repeat(32),
        contract: "con_dex",
        function: "swapExactTokensForTokens",
        kwargs: expect.objectContaining({
          amountIn: { __fixed__: "1" },
          amountOutMin: expect.objectContaining({ __fixed__: expect.any(String) }),
          path: [1],
          src: "currency",
          to: "sender",
        }),
        chi: 12_000,
      })
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      "Swap transaction sent.",
      "info",
      expect.objectContaining({
        action: {
          label: "View transaction",
          url: "http://127.0.0.1:8080/explorer/tx/SWAP123"
        }
      })
    );
    act(() => {
      jest.advanceTimersByTime(1600);
    });
    expect(mockNotifyActivityChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        txHash: "SWAP123",
        sender: "sender",
        contract: "con_dex",
        function: "swapExactTokensForTokens",
      })
    );
    expect(navigation.navigate).toHaveBeenCalledWith("Main");
  }, 10_000);
});
