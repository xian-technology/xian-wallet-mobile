import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  type StoredWalletState,
  type Contact,
  type ShieldedWalletSnapshotSummary,
  loadWalletState,
  loadContacts,
  saveContacts,
  saveWalletState,
} from "./storage";
import { loadUnlockedWalletMaterial } from "./wallet-controller";
import { XianRpcClient } from "./rpc-client";
import { loadPreferences, savePreferences, type Preferences } from "./preferences";
import {
  activityNetworkKey,
  makeLocalActivityTx,
  saveLocalActivityTx,
  type SubmittedActivityTx,
} from "./local-activity";
import type { TxHistoryRecord } from "./rpc-client";
import {
  isMissingContractError,
  messageFromUnknown,
  updateAssetNetworkState,
} from "./assets";
import { activeNetworkAllowsInsecureHttp } from "./network-security";

export type { StoredWalletState, Contact };

export interface WalletAccount {
  index: number;
  publicKey: string;
  name: string;
}

export interface WalletState {
  loading: boolean;
  hasWallet: boolean;
  unlocked: boolean;
  publicKey?: string;
  accounts: WalletAccount[];
  activeAccountIndex: number;
  seedSource?: "privateKey" | "mnemonic";
  rpcUrl: string;
  dashboardUrl?: string;
  activeNetworkId?: string;
  activeNetworkName?: string;
  networkPresets: StoredWalletState["networkPresets"];
  watchedAssets: StoredWalletState["watchedAssets"];
  assetNetworkStates: NonNullable<StoredWalletState["assetNetworkStates"]>;
  trustedDappPolicies: NonNullable<StoredWalletState["trustedDappPolicies"]>;
  assetBalances: Record<string, string | null>;
  balancesLoading: boolean;
  contacts: Contact[];
  shieldedWalletSnapshots: ShieldedWalletSnapshotSummary[];
}

export interface ActivityRefreshRequest {
  id: number;
  txHash?: string;
  localTx?: TxHistoryRecord;
}

export type ToastTone = "success" | "danger" | "warning" | "info";
export type ToastIcon = ToastTone | "none";

export interface ToastAction {
  label: string;
  url: string;
}

export interface ToastOptions {
  detail?: string;
  action?: ToastAction;
  icon?: ToastIcon;
  duration?: number;
}

export type ToastMessage = ({
  message: string;
  tone: ToastTone;
} & ToastOptions) | null;

export interface WalletContextValue {
  state: WalletState;
  refresh: () => Promise<void>;
  refreshBalances: () => Promise<void>;
  setContacts: (contacts: Contact[]) => Promise<void>;
  rpc: XianRpcClient;
  controller: ReturnType<typeof import("./wallet-controller").createWalletController> | null;
  toast: ToastMessage;
  showToast: (message: string, tone?: ToastTone, options?: ToastOptions) => void;
  clearToast: () => void;
  prefs: Preferences;
  updatePrefs: (update: Partial<Preferences>) => Promise<void>;
  activityRefreshRequest: ActivityRefreshRequest;
  notifyActivityChanged: (tx?: SubmittedActivityTx) => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>({
    loading: true,
    hasWallet: false,
    unlocked: false,
    accounts: [],
    activeAccountIndex: 0,
    rpcUrl: "http://127.0.0.1:26657",
    networkPresets: [],
    watchedAssets: [],
    assetNetworkStates: {},
    trustedDappPolicies: [],
    assetBalances: {},
    balancesLoading: false,
    contacts: [],
    shieldedWalletSnapshots: [],
  });

  const [controller, setController] = useState<WalletContextValue["controller"]>(null);
  const [toast, setToast] = useState<ToastMessage>(null);
  const [prefs, setPrefs] = useState<Preferences>({ quickActionsPosition: "top", hideQuickActionLabels: false });
  const [activityRefreshRequest, setActivityRefreshRequest] = useState<ActivityRefreshRequest>({ id: 0 });
  const rpcRef = useRef(new XianRpcClient("http://127.0.0.1:26657"));
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = useCallback(
    (message: string, tone: ToastTone = "info", options: ToastOptions = {}) => {
      setToast({ message, tone, ...options });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      const duration = options.duration ?? (options.action ? 6000 : 3000);
      toastTimer.current = setTimeout(() => setToast(null), duration);
    },
    []
  );

  const clearToast = useCallback(() => {
    setToast(null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const updatePrefs = useCallback(async (update: Partial<Preferences>) => {
    const next = { ...prefs, ...update };
    setPrefs(next);
    await savePreferences(next);
  }, [prefs]);

  const notifyActivityChanged = useCallback((tx?: SubmittedActivityTx) => {
    const normalizedHash = tx?.txHash?.trim();
    const localTx = tx ? makeLocalActivityTx(tx) : null;
    if (localTx) {
      void saveLocalActivityTx(activityNetworkKey(state), localTx);
    }
    setActivityRefreshRequest((prev) => ({
      id: prev.id + 1,
      txHash: normalizedHash || undefined,
      localTx: localTx ?? undefined,
    }));
  }, [state.activeNetworkId, state.publicKey, state.rpcUrl]);

  const hydrateWatchedAssetIcons = useCallback(
    async (walletState: StoredWalletState): Promise<StoredWalletState> => {
      const assetsMissingIcons = walletState.watchedAssets.some(
        (asset) => !asset.icon?.trim()
      );
      if (!assetsMissingIcons) {
        return walletState;
      }

      let changed = false;
      let nextWalletState = walletState;
      const watchedAssets = await Promise.all(
        walletState.watchedAssets.map(async (asset) => {
          if (asset.icon?.trim()) {
            return asset;
          }
          try {
            const metadata = await rpcRef.current.getTokenMetadata(asset.contract);
            const icon = metadata.logoUrl ?? metadata.logoSvg ?? undefined;
            if (!icon) {
              return asset;
            }
            changed = true;
            return {
              ...asset,
              icon,
            };
          } catch (error) {
            if (isMissingContractError(error)) {
              nextWalletState = updateAssetNetworkState(nextWalletState, asset.contract, {
                status: "not_found",
                lastCheckedAt: new Date().toISOString(),
                error: messageFromUnknown(error),
              });
              changed = true;
            }
            return asset;
          }
        })
      );

      if (!changed) {
        return walletState;
      }

      const nextState = {
        ...nextWalletState,
        watchedAssets,
      };
      await saveWalletState(nextState);
      return nextState;
    },
    []
  );

  const refresh = useCallback(async () => {
    let walletState = await loadWalletState();
    const session = await loadUnlockedWalletMaterial();
    const contacts = await loadContacts();

    if (walletState) {
      rpcRef.current.setRpcUrl(walletState.rpcUrl, {
        allowInsecureHttp: activeNetworkAllowsInsecureHttp(walletState),
      });
      walletState = await hydrateWatchedAssetIcons(walletState);
    }

    const activePreset = walletState
      ? walletState.networkPresets.find((p) => p.id === walletState.activeNetworkId) ?? walletState.networkPresets[0]
      : undefined;

    const accounts: WalletAccount[] = walletState?.accounts
      ? walletState.accounts.map((a) => ({
          index: a.index,
          publicKey: a.publicKey,
          name: a.name,
        }))
      : [];

    setState((prev) => ({
      ...prev,
      loading: false,
      hasWallet: walletState != null,
      unlocked: session != null && session.expiresAt > Date.now(),
      publicKey: walletState?.publicKey,
      accounts,
      activeAccountIndex: walletState?.activeAccountIndex ?? 0,
      seedSource: walletState?.seedSource,
      rpcUrl: walletState?.rpcUrl ?? "http://127.0.0.1:26657",
      dashboardUrl: walletState?.dashboardUrl,
      activeNetworkId: walletState?.activeNetworkId,
      activeNetworkName: activePreset?.name,
      networkPresets: walletState?.networkPresets ?? [],
      watchedAssets: walletState?.watchedAssets ?? [],
      assetNetworkStates: walletState?.assetNetworkStates ?? {},
      trustedDappPolicies: walletState?.trustedDappPolicies ?? [],
      contacts,
      shieldedWalletSnapshots: [...(walletState?.shieldedWalletSnapshots ?? [])].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
      ),
    }));
  }, [hydrateWatchedAssetIcons]);

  const refreshBalances = useCallback(async () => {
    const walletState = await loadWalletState();
    if (!walletState) return;

    setState((prev) => ({ ...prev, balancesLoading: true }));

    const balanceResults = await rpcRef.current.getMultipleBalanceResults(
      walletState.publicKey,
      walletState.watchedAssets
    );
    const balances = Object.fromEntries(
      balanceResults.map((result) => [result.contract, result.balance])
    );
    let nextWalletState = walletState;
    const checkedAt = new Date().toISOString();
    for (const result of balanceResults) {
      nextWalletState = updateAssetNetworkState(nextWalletState, result.contract, {
        status: result.status,
        lastCheckedAt: checkedAt,
        error: result.error,
      });
    }
    const latestState = await loadWalletState();
    if (latestState?.publicKey === walletState.publicKey) {
      const networkId = walletState.activeNetworkId;
      const latestStates = latestState.assetNetworkStates ?? {};
      const latestNetworkState = latestStates[networkId] ?? {};
      const fetchedNetworkState = nextWalletState.assetNetworkStates?.[networkId] ?? {};
      nextWalletState = {
        ...latestState,
        assetNetworkStates: {
          ...latestStates,
          [networkId]: {
            ...latestNetworkState,
            ...fetchedNetworkState,
          },
        },
      };
      await saveWalletState(nextWalletState);
    }

    setState((prev) => ({
      ...prev,
      assetBalances: balances,
      assetNetworkStates: nextWalletState.assetNetworkStates ?? {},
      balancesLoading: false,
    }));
  }, []);

  const setContactsFn = useCallback(async (contacts: Contact[]) => {
    await saveContacts(contacts);
    setState((prev) => ({ ...prev, contacts }));
  }, []);

  useEffect(() => {
    import("./wallet-controller").then((mod) => {
      setController(mod.createWalletController());
    });
    loadPreferences().then(setPrefs);
    refresh();
  }, [refresh]);

  // Auto-fetch balances when unlocked
  useEffect(() => {
    if (state.unlocked && state.hasWallet && !state.loading) {
      refreshBalances();
    }
  }, [state.unlocked, state.hasWallet, state.loading, state.publicKey, refreshBalances]);

  return (
    <WalletContext.Provider
      value={{
        state,
        refresh,
        refreshBalances,
        setContacts: setContactsFn,
        rpc: rpcRef.current,
        controller,
        toast,
        showToast,
        clearToast,
        prefs,
        updatePrefs,
        activityRefreshRequest,
        notifyActivityChanged,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
