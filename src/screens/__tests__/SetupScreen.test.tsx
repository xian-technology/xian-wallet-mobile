import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";

const mockUseWallet = jest.fn() as jest.Mock;

jest.mock("../../lib/wallet-context", () => ({
  useWallet: () => mockUseWallet()
}));

import { SetupScreen } from "../SetupScreen";

describe("SetupScreen", () => {
  const mockCreateWallet = jest.fn() as jest.Mock;
  const mockImportWalletBackup = jest.fn() as jest.Mock;
  const mockRefresh = jest.fn(async () => undefined) as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (FileSystem as unknown as { __clearFileText: () => void }).__clearFileText();
    mockUseWallet.mockReturnValue({
      refresh: mockRefresh,
      controller: {
        createWallet: mockCreateWallet,
        importWalletBackup: mockImportWalletBackup
      }
    });
  });

  it("keeps the wallet form full width within the screen padding", () => {
    const screen = render(<SetupScreen />);

    expect(screen.getByTestId("setup-form")).toHaveStyle({
      width: "100%",
      maxWidth: 520,
      alignSelf: "center",
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
    expect(mockRefresh).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText(mnemonic));

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(mnemonic);

    fireEvent.press(screen.getByText("I've saved my seed"));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
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
        privateKey: "11".repeat(32),
        networkName: "Local node",
        chainId: undefined,
        rpcUrl: "http://127.0.0.1:26657",
        dashboardUrl: "http://127.0.0.1:8080",
        allowInsecureHttp: false,
      })
    );
  });

  it("imports a backup JSON file from setup", async () => {
    const backup = {
      version: 2,
      kind: "xian-wallet-backup",
      encryption: {
        algorithm: "AES-256-GCM",
        kdf: "PBKDF2-SHA256",
        iterations: 10_000,
        salt: "salt",
        iv: "iv",
      },
      ciphertext: "ciphertext",
    };
    (
      DocumentPicker.getDocumentAsync as unknown as {
        mockResolvedValueOnce: (value: unknown) => void;
      }
    ).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file://backup.json", name: "backup.json" }],
    });
    (FileSystem as unknown as { __setFileText: (uri: string, text: string) => void })
      .__setFileText("file://backup.json", JSON.stringify(backup));
    mockImportWalletBackup.mockImplementation(async () => undefined);

    const screen = render(<SetupScreen />);
    fireEvent.press(screen.getByText("Backup"));
    fireEvent.changeText(screen.getByPlaceholderText("Backup password"), "backup-pass");
    fireEvent.press(screen.getByText("Import File"));

    await waitFor(() => expect(screen.getByText("Loaded backup.json.")).toBeTruthy());
    fireEvent.press(screen.getByText("Import Backup"));

    await waitFor(() =>
      expect(mockImportWalletBackup).toHaveBeenCalledWith(backup, "backup-pass")
    );
    expect(mockRefresh).toHaveBeenCalled();
  });
});
