import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  type StoredWalletState,
  type Contact,
  createMobileStore,
  loadWalletState,
  loadContacts,
  saveContacts,
  loadUnlockedSession,
} from "./storage";

// Re-export for convenience
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
  networkPresets: StoredWalletState["networkPresets"];
  watchedAssets: StoredWalletState["watchedAssets"];
  assetBalances: Record<string, string | null>;
  contacts: Contact[];
}

interface WalletContextValue {
  state: WalletState;
  refresh: () => Promise<void>;
  setContacts: (contacts: Contact[]) => Promise<void>;
  // Controller is exposed for screens to call methods directly
  controller: ReturnType<typeof import("./wallet-controller").createWalletController> | null;
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
    contacts: [],
  });

  const [controller, setController] = useState<WalletContextValue["controller"]>(null);

  const refresh = useCallback(async () => {
    const walletState = await loadWalletState();
    const session = await loadUnlockedSession();
    const contacts = await loadContacts();

    const accounts: WalletAccount[] = walletState?.accounts
      ? walletState.accounts.map((a) => ({
          index: a.index,
          publicKey: a.publicKey,
          name: a.name,
        }))
      : walletState
        ? [{ index: 0, publicKey: walletState.publicKey, name: "Account 1" }]
        : [];

    setState({
      loading: false,
      hasWallet: walletState != null,
      unlocked: session != null && session.expiresAt > Date.now(),
      publicKey: walletState?.publicKey,
      accounts,
      activeAccountIndex: walletState?.activeAccountIndex ?? 0,
      seedSource: walletState?.seedSource,
      rpcUrl: walletState?.rpcUrl ?? "http://127.0.0.1:26657",
      dashboardUrl: walletState?.dashboardUrl,
      networkPresets: walletState?.networkPresets ?? [],
      watchedAssets: walletState?.watchedAssets ?? [],
      assetBalances: {},
      contacts,
    });
  }, []);

  const setContactsFn = useCallback(async (contacts: Contact[]) => {
    await saveContacts(contacts);
    setState((prev) => ({ ...prev, contacts }));
  }, []);

  useEffect(() => {
    // Lazy-load controller to ensure crypto polyfill is ready
    import("./wallet-controller").then((mod) => {
      const ctrl = mod.createWalletController();
      setController(ctrl);
    });
    refresh();
  }, [refresh]);

  return (
    <WalletContext.Provider
      value={{ state, refresh, setContacts: setContactsFn, controller }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used within WalletProvider");
  }
  return ctx;
}
