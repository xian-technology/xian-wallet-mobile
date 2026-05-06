import type {
  AssetNetworkState,
  AssetNetworkStates,
  StoredWalletState,
} from "./storage";

export type WalletAsset = StoredWalletState["watchedAssets"][number];

interface NetworkAssetState {
  activeNetworkId?: string;
  activeNetworkName?: string;
  watchedAssets: WalletAsset[];
  assetNetworkStates?: AssetNetworkStates;
}

export function messageFromUnknown(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function isMissingContractError(value: unknown): boolean {
  const message = messageFromUnknown(value);
  return /ImportError\(['"]Module\s+[^'"]+\s+not found['"]\)/i.test(message) ||
    /Module\s+\S+\s+not found/i.test(message);
}

export function activeAssetNetworkState(
  state: NetworkAssetState,
  contract: string
): AssetNetworkState | undefined {
  const networkId = state.activeNetworkId ?? "";
  return state.assetNetworkStates?.[networkId]?.[contract];
}

export function isAssetUnavailableOnActiveNetwork(
  state: NetworkAssetState,
  asset: WalletAsset
): boolean {
  if (asset.contract === "currency") {
    return false;
  }
  return activeAssetNetworkState(state, asset.contract)?.status === "not_found";
}

export function isAssetHiddenOnActiveNetwork(
  state: NetworkAssetState,
  asset: WalletAsset
): boolean {
  return activeAssetNetworkState(state, asset.contract)?.hidden ?? asset.hidden === true;
}

export function sortAssets(assets: WalletAsset[]): WalletAsset[] {
  return [...assets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function visibleAssetsForActiveNetwork(state: NetworkAssetState): WalletAsset[] {
  return sortAssets(state.watchedAssets).filter(
    (asset) =>
      !isAssetHiddenOnActiveNetwork(state, asset) &&
      !isAssetUnavailableOnActiveNetwork(state, asset)
  );
}

export function hiddenAssetCount(state: NetworkAssetState): number {
  return state.watchedAssets.filter((asset) =>
    isAssetHiddenOnActiveNetwork(state, asset)
  ).length;
}

export function unavailableAssetCount(state: NetworkAssetState): number {
  return state.watchedAssets.filter((asset) =>
    isAssetUnavailableOnActiveNetwork(state, asset)
  ).length;
}

export function unavailableAssetLabel(state: NetworkAssetState): string {
  return state.activeNetworkName
    ? `Unavailable on ${state.activeNetworkName}`
    : "Unavailable on this network";
}

export function updateAssetNetworkState(
  state: StoredWalletState,
  contract: string,
  update: AssetNetworkState
): StoredWalletState {
  const networkId = state.activeNetworkId;
  const currentStates = state.assetNetworkStates ?? {};
  const currentNetwork = currentStates[networkId] ?? {};
  const currentAsset = currentNetwork[contract] ?? {};
  const nextAsset = { ...currentAsset, ...update };

  if (nextAsset.status === "available" || nextAsset.status === "unknown") {
    delete nextAsset.error;
  }

  return {
    ...state,
    assetNetworkStates: {
      ...currentStates,
      [networkId]: {
        ...currentNetwork,
        [contract]: nextAsset,
      },
    },
  };
}

export function removeAssetNetworkState(
  state: StoredWalletState,
  contract: string
): StoredWalletState {
  const currentStates = state.assetNetworkStates ?? {};
  const assetNetworkStates = Object.fromEntries(
    Object.entries(currentStates).flatMap(([networkId, networkState]) => {
      if (!(contract in networkState)) {
        return [[networkId, networkState]];
      }
      const nextNetworkState = { ...networkState };
      delete nextNetworkState[contract];
      return Object.keys(nextNetworkState).length > 0
        ? [[networkId, nextNetworkState]]
        : [];
    })
  );

  return {
    ...state,
    assetNetworkStates,
  };
}
