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
  loadWalletState,
  loadContacts,
  saveContacts,
  loadUnlockedSession,
} from "./storage";
import { XianRpcClient } from "./rpc-client";

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
  assetBalances: Record<string, string | null>;
  balancesLoading: boolean;
  contacts: Contact[];
}

type ToastMessage = { message: string; tone: "success" | "danger" | "warning" | "info" } | null;

interface WalletContextValue {
  state: WalletState;
  refresh: () => Promise<void>;
  refreshBalances: () => Promise<void>;
  setContacts: (contacts: Contact[]) => Promise<void>;
  rpc: XianRpcClient;
  controller: ReturnType<typeof import("./wallet-controller").createWalletController> | null;
  toast: ToastMessage;
  showToast: (message: string, tone?: "success" | "danger" | "warning" | "info") => void;
  clearToast: () => void;
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
    assetBalances: {},
    balancesLoading: false,
    contacts: [],
  });

  const [controller, setController] = useState<WalletContextValue["controller"]>(null);
  const [toast, setToast] = useState<ToastMessage>(null);
  const rpcRef = useRef(new XianRpcClient("http://127.0.0.1:26657"));
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = useCallback(
    (message: string, tone: "success" | "danger" | "warning" | "info" = "info") => {
      setToast({ message, tone });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 3000);
    },
    []
  );

  const clearToast = useCallback(() => {
    setToast(null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const refresh = useCallback(async () => {
    const walletState = await loadWalletState();
    const session = await loadUnlockedSession();
    const contacts = await loadContacts();

    if (walletState) {
      rpcRef.current.setRpcUrl(walletState.rpcUrl);
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
      : walletState
        ? [{ index: 0, publicKey: walletState.publicKey, name: "Account 1" }]
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
      contacts,
    }));
  }, []);

  const refreshBalances = useCallback(async () => {
    const walletState = await loadWalletState();
    if (!walletState) return;

    setState((prev) => ({ ...prev, balancesLoading: true }));

    const contracts = walletState.watchedAssets.map((a) => a.contract);
    const balances = await rpcRef.current.getMultipleBalances(
      walletState.publicKey,
      contracts
    );

    setState((prev) => ({
      ...prev,
      assetBalances: balances,
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
