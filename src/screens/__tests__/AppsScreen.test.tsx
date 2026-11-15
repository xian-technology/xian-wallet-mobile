import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockUseWallet = jest.fn() as jest.Mock;
const mockApproveWalletConnectRequest = jest.fn() as jest.Mock;
const mockPairWalletConnectUri = jest.fn() as jest.Mock;
const mockGetWalletConnectState = jest.fn() as jest.Mock;
const mockUseCameraPermissions = jest.fn() as jest.Mock;

jest.mock("../../lib/wallet-context", () => ({
  useWallet: () => mockUseWallet(),
}));

jest.mock("@xian-tech/provider", () => ({
  parseXianDappAction: jest.fn(() => null),
}), { virtual: true });

jest.mock("../../lib/storage", () => ({
  removeTrustedDappPolicy: jest.fn(async () => undefined),
}));

jest.mock("expo-camera", () => {
  const React = require("react");
  return {
    CameraView: ({ children, ...props }: Record<string, unknown>) =>
      React.createElement("CameraView", props, children),
    useCameraPermissions: () => mockUseCameraPermissions(),
  };
});

jest.mock("../../lib/walletconnect", () => ({
  approveWalletConnectProposal: jest.fn(),
  approveWalletConnectRequest: (...args: unknown[]) =>
    mockApproveWalletConnectRequest(...args),
  disconnectWalletConnectSession: jest.fn(),
  extractWalletConnectUri: (value: string) => value.trim().startsWith("wc:") ? value.trim() : null,
  getWalletConnectState: () => mockGetWalletConnectState(),
  initializeWalletConnect: jest.fn(async () => undefined),
  pairWalletConnectUri: (uri: string) => mockPairWalletConnectUri(uri),
  rejectWalletConnectProposal: jest.fn(),
  rejectWalletConnectRequest: jest.fn(),
  startWalletConnectLinking: jest.fn(() => undefined),
  subscribeWalletConnect: jest.fn(() => () => undefined),
}));

import { AppsScreen } from "../AppsScreen";

describe("AppsScreen", () => {
  const mockRefresh = jest.fn(async () => undefined) as jest.Mock;
  const mockShowToast = jest.fn() as jest.Mock;
  const mockRequestCameraPermission = jest.fn() as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetWalletConnectState.mockImplementation(() => ({
      configured: true,
      sessions: [],
      proposals: [],
      requests: [],
    }));
    mockRequestCameraPermission.mockImplementation(async () => ({ granted: true }));
    mockUseCameraPermissions.mockReturnValue([
      { granted: true },
      mockRequestCameraPermission,
    ]);
    mockApproveWalletConnectRequest.mockImplementation(async () => undefined);
    mockPairWalletConnectUri.mockImplementation(async () => undefined);
    mockUseWallet.mockReturnValue({
      state: {
        trustedDappPolicies: [],
      },
      refresh: mockRefresh,
      showToast: mockShowToast,
    });
  });

  it("prioritizes QR scanning and hides manual URI entry until requested", async () => {
    const screen = await render(<AppsScreen />);

    await waitFor(() => expect(screen.getByText("Scan QR")).toBeTruthy());
    expect(screen.getByText("Paste WalletConnect URI")).toBeTruthy();
    expect(screen.queryByPlaceholderText("wc:...")).toBeNull();

    await fireEvent.press(screen.getByText("Paste WalletConnect URI"));

    expect(screen.getByPlaceholderText("wc:...")).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText("wc:..."), "wc:test-topic@2");
    await fireEvent.press(screen.getByText("Pair"));

    await waitFor(() => expect(mockPairWalletConnectUri).toHaveBeenCalledWith("wc:test-topic@2"));
  });

  it("requires an in-app confirmation before broad auto-approval", async () => {
    mockGetWalletConnectState.mockImplementation(() => ({
      configured: true,
      sessions: [],
      proposals: [],
      requests: [
        {
          id: 7,
          topic: "topic-1",
          origin: "wc:topic-1",
          sessionName: "Swap dapp",
          chainId: "xian-local",
          request: { method: "xian_sendCall", params: [] },
          trustSuggestion: {
            label: "Auto-approve this exact currency.transfer",
            description: "Repeat this request with the same arguments.",
            broadLabel: "Auto-approve any currency.transfer",
            broadDescription: "Allow changed arguments.",
            broadWarning: "Broad auto-approval can move funds.",
            exactScope: "exact",
            broadScope: "any",
          },
        },
      ],
    }));

    const screen = await render(<AppsScreen />);
    await waitFor(() =>
      expect(screen.getByText("Auto-approve any currency.transfer")).toBeTruthy()
    );

    const switches = screen.getAllByRole("switch");
    await fireEvent(switches[1], "valueChange", true);
    await fireEvent.press(screen.getByText("Approve"));

    expect(screen.getByText("Enable broad auto-approval?")).toBeTruthy();
    expect(mockApproveWalletConnectRequest).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText("Enable"));

    await waitFor(() =>
      expect(mockApproveWalletConnectRequest).toHaveBeenCalledWith(7, {
        trust: "any",
      })
    );
  });

  function stateWith(partial: Record<string, unknown>) {
    mockGetWalletConnectState.mockImplementation(() => ({
      configured: true,
      sessions: [],
      proposals: [],
      requests: [],
      ...partial,
    }));
  }

  it.each([
    [{ status: "scam", origin: "https://evil.example" }, "Known scam domain: https://evil.example. Do not connect."],
    [{ status: "mismatch", origin: "https://evil.example" }, "Domain mismatch: this request came from https://evil.example, not the site the app claims to be."],
    [{ status: "unverified" }, "Unverified domain: WalletConnect could not confirm which site this is."],
    [{ status: "verified", origin: "https://app.example" }, "Verified domain: https://app.example"],
  ])("shows the proposal domain check %j", async (verification, notice) => {
    stateWith({
      proposals: [{
        id: 3,
        name: "Dapp",
        url: "https://app.example",
        requiredChains: ["xian:xian-local"],
        requiredMethods: ["xian_sendCall"],
        verification,
      }],
    });

    const screen = await render(<AppsScreen />);

    await waitFor(() => expect(screen.getByText(notice)).toBeTruthy());
  });

  it("shows the request domain check, chi and revealed hidden characters", async () => {
    stateWith({
      requests: [{
        id: 8,
        topic: "topic-1",
        origin: "wc:topic-1",
        sessionName: "Swap dapp",
        chainId: "xian-local",
        chi: null,
        verification: { status: "mismatch", origin: "https://evil.example" },
        request: { method: "xian_signMessage", params: { message: "pay alice\u202Eecilab" } },
      }],
    });

    const screen = await render(<AppsScreen />);

    await waitFor(() => expect(screen.getByText("Not estimated")).toBeTruthy());
    expect(screen.getByText(/pay alice\[U\+202E\]ecilab/)).toBeTruthy();
    expect(
      screen.getByText("This request contains invisible or text-direction characters. They are shown as [U+XXXX] markers.")
    ).toBeTruthy();
    expect(
      screen.getByText("Domain mismatch: this request came from https://evil.example, not the site the app claims to be.")
    ).toBeTruthy();
  });

  it("shows the chi a transaction request will use", async () => {
    stateWith({
      requests: [{
        id: 9,
        topic: "topic-1",
        origin: "wc:topic-1",
        sessionName: "Swap dapp",
        chainId: "xian-local",
        chi: "777",
        verification: { status: "verified", origin: "https://app.example" },
        request: { method: "xian_sendCall", params: { intent: {} } },
      }],
    });

    const screen = await render(<AppsScreen />);

    await waitFor(() => expect(screen.getByText("777")).toBeTruthy());
    expect(screen.queryByText(/invisible or text-direction/)).toBeNull();
  });
});

