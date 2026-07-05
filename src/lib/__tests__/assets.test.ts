import { describe, expect, it } from "@jest/globals";

import {
  hiddenAssetCount,
  isMissingContractError,
  unavailableAssetCount,
  updateAssetNetworkState,
  visibleAssetsForActiveNetwork,
} from "../assets";
import type { StoredWalletState } from "../storage";

function walletState(): StoredWalletState {
  return {
    publicKey: "sender",
    encryptedPrivateKey: "encrypted",
    walletEncryption: {
      version: 1,
      algorithm: "PBKDF2-SHA256",
      iterations: 250_000,
      salt: "salt",
    },
    seedSource: "privateKey",
    rpcUrl: "http://local",
    activeNetworkId: "local",
    networkPresets: [
      {
        id: "local",
        name: "Local",
        rpcUrl: "http://local",
      },
    ],
    watchedAssets: [
      { contract: "currency", name: "Xian", symbol: "XIAN" },
      { contract: "con_missing", name: "Missing", symbol: "MISS" },
      { contract: "con_hidden", name: "Hidden", symbol: "HID" },
    ],
    connectedOrigins: [],
    createdAt: new Date(0).toISOString(),
  };
}

describe("asset network state", () => {
  it("filters unavailable and hidden assets without removing them", () => {
    let state = walletState();
    state = updateAssetNetworkState(state, "con_missing", {
      status: "not_found",
    });
    state = updateAssetNetworkState(state, "con_hidden", {
      hidden: true,
    });

    expect(visibleAssetsForActiveNetwork(state).map((asset) => asset.contract)).toEqual([
      "currency",
    ]);
    expect(unavailableAssetCount(state)).toBe(1);
    expect(hiddenAssetCount(state)).toBe(1);
    expect(state.watchedAssets.map((asset) => asset.contract)).toEqual([
      "currency",
      "con_missing",
      "con_hidden",
    ]);
  });

  it("recognizes missing-module contract errors", () => {
    expect(isMissingContractError("ImportError('Module con_token not found')")).toBe(true);
    expect(isMissingContractError(new Error("RPC error: 500"))).toBe(false);
  });
});
