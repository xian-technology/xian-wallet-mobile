import { useEffect, useRef } from "react";
import { loadUnlockedWalletMaterial } from "./wallet-controller";

interface ReviewWalletState {
  publicKey?: string;
  rpcUrl?: string;
  activeNetworkId?: string;
  unlocked?: boolean;
  networkPresets?: ReadonlyArray<{ id: string; chainId?: string }>;
}

function contextKey(state: ReviewWalletState): string {
  const preset = state.networkPresets?.find((entry) => entry.id === state.activeNetworkId);
  return JSON.stringify([state.publicKey, state.rpcUrl, state.activeNetworkId, preset?.chainId]);
}

function requireContext(expected: string | null, current: string): void {
  if (expected === null || expected !== current) {
    throw new Error("Wallet account or network changed. Review the transaction again.");
  }
}

/** A review and its eventual signing key must belong to the same wallet context. */
export function useTransactionReview(state: ReviewWalletState, reset: () => void) {
  const key = contextKey(state);
  const current = useRef(key);
  const reviewed = useRef<string | null>(null);
  const resetReview = useRef(reset);
  current.current = key;
  resetReview.current = reset;
  useEffect(() => {
    reviewed.current = null;
    resetReview.current();
  }, [key, state.unlocked]);
  return {
    capture: () => key,
    confirm: (captured: string) => {
      if (captured !== current.current) return false;
      reviewed.current = captured;
      return true;
    },
    loadMaterial: async () => {
      const expected = reviewed.current;
      requireContext(expected, current.current);
      const material = await loadUnlockedWalletMaterial();
      if (!material) throw new Error("Wallet is locked");
      requireContext(expected, contextKey(material.state));
      requireContext(expected, current.current);
      return material;
    }
  };
}
