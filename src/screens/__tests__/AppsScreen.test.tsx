import React from "react";
import { Switch } from "react-native";
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
    const screen = render(<AppsScreen />);

    await waitFor(() => expect(screen.getByText("Scan QR")).toBeTruthy());
    expect(screen.getByText("Paste WalletConnect URI")).toBeTruthy();
    expect(screen.queryByPlaceholderText("wc:...")).toBeNull();

    fireEvent.press(screen.getByText("Paste WalletConnect URI"));

    expect(screen.getByPlaceholderText("wc:...")).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText("wc:..."), "wc:test-topic@2");
    fireEvent.press(screen.getByText("Pair"));

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

    const screen = render(<AppsScreen />);
    await waitFor(() =>
      expect(screen.getByText("Auto-approve any currency.transfer")).toBeTruthy()
    );

    const switches = screen.UNSAFE_getAllByType(Switch);
    fireEvent(switches[1], "valueChange", true);
    fireEvent.press(screen.getByText("Approve"));

    expect(screen.getByText("Enable broad auto-approval?")).toBeTruthy();
    expect(mockApproveWalletConnectRequest).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText("Enable"));

    await waitFor(() =>
      expect(mockApproveWalletConnectRequest).toHaveBeenCalledWith(7, {
        trust: "any",
      })
    );
  });
});
