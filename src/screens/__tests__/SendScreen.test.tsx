import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockUseWallet = jest.fn() as jest.Mock;
const mockLoadUnlockedWalletMaterial = jest.fn() as jest.Mock;

jest.mock("../../lib/wallet-context", () => ({
  useWallet: () => mockUseWallet()
}));

jest.mock("../../lib/wallet-controller", () => ({
  loadUnlockedWalletMaterial: () => mockLoadUnlockedWalletMaterial()
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
  const mockNotifyActivityChanged = jest.fn() as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockUseWallet.mockReturnValue({
      state: {
        publicKey: "sender",
        rpcUrl: "http://127.0.0.1:26657",
        activeNetworkId: "local",
        networkPresets: [{ id: "local", chainId: "local-chain" }, { id: "other", chainId: "other-chain" }],
        watchedAssets: [{ contract: "currency", name: "Xian", symbol: "XIAN" }],
        assetBalances: { currency: "9007199254741993" },
        contacts: [],
        dashboardUrl: "http://127.0.0.1:8080"
      },
      rpc: {
        getChiRate: jest.fn(async () => 20),
        estimateChi: mockEstimateChi,
        sendTransaction: mockSendTransaction
      },
      refreshBalances: mockRefreshBalances,
      showToast: mockShowToast,
      notifyActivityChanged: mockNotifyActivityChanged
    });
    mockLoadUnlockedWalletMaterial.mockImplementation(async () => ({
      state: (mockUseWallet() as { state: Record<string, unknown> }).state,
      privateKey: "11".repeat(32),
      sessionKey: "session-key",
      expiresAt: Date.now() + 60_000
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    { publicKey: "other-account" },
    { rpcUrl: "http://127.0.0.1:27657" },
    { networkPresets: [{ id: "local", chainId: "changed-chain" }, { id: "other", chainId: "other-chain" }] }
  ])(
    "requires a new review when the signing context changes: %j", async (change) => {
      mockEstimateChi.mockImplementation(async () => ({ estimated: 12, supply: 14 }));
      const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof SendScreen>["navigation"];
      const route = { params: { token: "currency" } } as unknown as React.ComponentProps<typeof SendScreen>["route"];
      const screen = await render(<SendScreen navigation={navigation} route={route} />);
      await fireEvent.changeText(screen.getByPlaceholderText("Wallet address"), "ab".repeat(32));
      await fireEvent.changeText(screen.getByPlaceholderText("0.00"), "1");
      await fireEvent.press(screen.getByText("Review"));
      await waitFor(() => expect(screen.getByText("Send Transaction")).toBeTruthy());
      const previous = mockUseWallet() as { state: Record<string, unknown> };
      mockUseWallet.mockReturnValue({ ...previous, state: { ...previous.state, ...change } });
      await screen.rerender(<SendScreen navigation={navigation} route={route} />);
      expect(screen.queryByText("Send Transaction")).toBeNull();
      expect(screen.getByText("Review")).toBeTruthy();
      expect(mockSendTransaction).not.toHaveBeenCalled();
    }
  );

  it("discards a simulation that completes after its reviewed account changed", async () => {
    let finish!: (value: { estimated: number; supply: number }) => void;
    mockEstimateChi.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof SendScreen>["navigation"];
    const route = { params: { token: "currency" } } as unknown as React.ComponentProps<typeof SendScreen>["route"];
    const screen = await render(<SendScreen navigation={navigation} route={route} />);
    await fireEvent.changeText(screen.getByPlaceholderText("Wallet address"), "ab".repeat(32));
    await fireEvent.changeText(screen.getByPlaceholderText("0.00"), "1");
    const pendingReview = fireEvent.press(screen.getByText("Review"));
    await waitFor(() => expect(mockEstimateChi).toHaveBeenCalled());
    const previous = mockUseWallet() as { state: Record<string, unknown> };
    mockUseWallet.mockReturnValue({ ...previous, state: { ...previous.state, publicKey: "other-account" } });
    await screen.rerender(<SendScreen navigation={navigation} route={route} />);
    await act(async () => { finish({ estimated: 12, supply: 14 }); });
    await pendingReview;
    expect(screen.queryByText("Send Transaction")).toBeNull();
    expect(screen.getByText("Review")).toBeTruthy();
  });

  it("does not sign with an account that changes while unlocked material is loaded", async () => {
    mockEstimateChi.mockImplementation(async () => ({ estimated: 12, supply: 14 }));
    const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof SendScreen>["navigation"];
    const route = { params: { token: "currency" } } as unknown as React.ComponentProps<typeof SendScreen>["route"];
    const screen = await render(<SendScreen navigation={navigation} route={route} />);
    await fireEvent.changeText(screen.getByPlaceholderText("Wallet address"), "ab".repeat(32));
    await fireEvent.changeText(screen.getByPlaceholderText("0.00"), "1");
    await fireEvent.press(screen.getByText("Review"));
    await waitFor(() => expect(screen.getByText("Send Transaction")).toBeTruthy());
    mockLoadUnlockedWalletMaterial.mockImplementation(async () => ({
      state: { publicKey: "other-account" }, privateKey: "22".repeat(32)
    }));
    await fireEvent.press(screen.getByText("Send Transaction"));
    expect(mockSendTransaction).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      "Transaction failed.", "danger", expect.objectContaining({
        detail: "Wallet account or network changed. Review the transaction again."
      })
    );
  });

  it("reviews and submits the spendable lowercase spelling of a mixed-case address", async () => {
    mockEstimateChi.mockImplementation(async () => ({ estimated: 12, supply: 14 }));
    mockSendTransaction.mockImplementation(async () => ({
      submitted: true, accepted: true, finalized: true, txHash: "CANONICAL"
    }));
    const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof SendScreen>["navigation"];
    const route = { params: { token: "currency" } } as unknown as React.ComponentProps<typeof SendScreen>["route"];
    const screen = await render(<SendScreen navigation={navigation} route={route} />);
    await fireEvent.changeText(screen.getByPlaceholderText("Wallet address"), "aB".repeat(32));
    await fireEvent.changeText(screen.getByPlaceholderText("0.00"), "1");
    await fireEvent.press(screen.getByText("Review"));
    await waitFor(() => expect(screen.getByText("Send Transaction")).toBeTruthy());
    expect(mockEstimateChi).toHaveBeenCalledWith(expect.objectContaining({
      kwargs: { to: "ab".repeat(32), amount: 1 }
    }));
    await fireEvent.press(screen.getByText("Send Transaction"));
    await waitFor(() => expect(mockSendTransaction).toHaveBeenCalledWith(expect.objectContaining({
      kwargs: { to: "ab".repeat(32), amount: 1 }
    })));
  });

  // Execution reserves the fee from the XIAN balance first; sending the whole
  // balance (MAX) cannot also pay it.
  it("refuses a XIAN send that leaves no balance for the fee, naming the most it can send", async () => {
    // The wallet supplies the estimate plus the SDK margin; the reservation is on the supply.
    mockEstimateChi.mockImplementation(async () => ({ estimated: 12_000, supply: 12_002 }));
    const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof SendScreen>["navigation"];
    const route = { params: { token: "currency" } } as unknown as React.ComponentProps<typeof SendScreen>["route"];
    const screen = await render(<SendScreen navigation={navigation} route={route} />);

    await fireEvent.changeText(screen.getByPlaceholderText("Wallet address"), "ab".repeat(32));
    await fireEvent.press(screen.getByText("MAX"));
    await fireEvent.press(screen.getByText("Review"));

    await waitFor(() =>
      expect(
        screen.getByText(
          "The amount plus the network fee (600.1 XIAN) exceeds your XIAN balance. You can spend at most 9007199254741392.85 XIAN."
        )
      ).toBeTruthy()
    );
    expect(screen.queryByText("Send Transaction")).toBeNull();
  });

  it("reviews and sends a transfer using bigint-safe parsing", async () => {
    mockEstimateChi.mockImplementation(async () => ({
      estimated: 12_000,
      supply: 12_002
    }));
    mockSendTransaction.mockImplementation(async () => ({
      submitted: true,
      accepted: true,
      finalized: true,
      txHash: "ABC123"
    }));

    const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof SendScreen>["navigation"];
    const route = { params: { token: "currency" } } as unknown as React.ComponentProps<typeof SendScreen>["route"];
    const screen = await render(<SendScreen navigation={navigation} route={route} />);

    await fireEvent.changeText(screen.getByPlaceholderText("Wallet address"), "ab".repeat(32));
    await fireEvent.changeText(
      screen.getByPlaceholderText("0.00"),
      "9007199254740993"
    );
    await fireEvent.press(screen.getByText("Review"));

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

    await fireEvent.press(screen.getByText("Send Transaction"));

    await waitFor(() =>
      expect(mockSendTransaction).toHaveBeenCalledWith({
        privateKey: "11".repeat(32),
        contract: "currency",
        function: "transfer",
        kwargs: {
          to: "ab".repeat(32),
          amount: 9007199254740993n
        },
        chi: 12_002
      })
    );
    expect(mockShowToast).toHaveBeenNthCalledWith(
      1,
      "Transaction sent.",
      "info",
      expect.objectContaining({
        icon: "info",
        detail: "ABC123",
        action: {
          label: "View transaction",
          url: "http://127.0.0.1:8080/explorer/tx/ABC123"
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
        detail: "ABC123",
        action: {
          label: "View transaction",
          url: "http://127.0.0.1:8080/explorer/tx/ABC123"
        }
      })
    );
    expect(navigation.navigate).toHaveBeenCalledWith("Main");
    expect(mockNotifyActivityChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        txHash: "ABC123",
        sender: "sender",
        contract: "currency",
        function: "transfer",
        accepted: true,
        finalized: true,
        kwargs: {
          to: "ab".repeat(32),
          amount: 9007199254740993n
        }
      })
    );
  }, 10_000);

  it("reviews and sends decimal transfers as runtime fixed values", async () => {
    mockEstimateChi.mockImplementation(async () => ({
      estimated: 12_000,
      supply: 12_002
    }));
    mockSendTransaction.mockImplementation(async () => ({
      submitted: true,
      accepted: true,
      finalized: true,
      txHash: "DEC123"
    }));

    const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof SendScreen>["navigation"];
    const route = { params: { token: "currency" } } as unknown as React.ComponentProps<typeof SendScreen>["route"];
    const screen = await render(<SendScreen navigation={navigation} route={route} />);

    await fireEvent.changeText(screen.getByPlaceholderText("Wallet address"), "ab".repeat(32));
    await fireEvent.changeText(screen.getByPlaceholderText("0.00"), "12.5");
    await fireEvent.press(screen.getByText("Review"));

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

    await fireEvent.press(screen.getByText("Send Transaction"));

    await waitFor(() =>
      expect(mockSendTransaction).toHaveBeenCalledWith({
        privateKey: "11".repeat(32),
        contract: "currency",
        function: "transfer",
        kwargs: {
          to: "ab".repeat(32),
          amount: { __fixed__: "12.5" }
        },
        chi: 12_002
      })
    );
  });

  it("allows unrecognized recipients after explicit in-app confirmation", async () => {
    mockEstimateChi.mockImplementation(async () => ({
      estimated: 12_000,
      supply: 12_002
    }));

    const navigation = { navigate: jest.fn() } as unknown as React.ComponentProps<typeof SendScreen>["navigation"];
    const route = { params: { token: "currency" } } as unknown as React.ComponentProps<typeof SendScreen>["route"];
    const screen = await render(<SendScreen navigation={navigation} route={route} />);

    await fireEvent.changeText(screen.getByPlaceholderText("Wallet address"), "qwe");
    await fireEvent.changeText(screen.getByPlaceholderText("0.00"), "5");
    await fireEvent.press(screen.getByText("Review"));

    expect(screen.getByText("Confirm recipient")).toBeTruthy();
    expect(mockEstimateChi).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText("Send Anyway"));

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
    const screen = await render(<SendScreen navigation={navigation} route={route} />);

    await fireEvent.changeText(screen.getByPlaceholderText("Wallet address"), "qwe");
    await fireEvent.changeText(screen.getByPlaceholderText("0.00"), "5");
    await fireEvent.press(screen.getByText("Review"));

    expect(screen.getByText("Confirm recipient")).toBeTruthy();
    await fireEvent.press(screen.getByText("Cancel"));

    expect(mockEstimateChi).not.toHaveBeenCalled();
  });
});
