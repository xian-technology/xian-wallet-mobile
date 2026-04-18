import type { TxHistoryRecord } from "./rpc-client";

export type TxCategory =
  | "send"
  | "receive"
  | "buy"
  | "sell"
  | "swap"
  | "add_liquidity"
  | "remove_liquidity"
  | "create_token"
  | "approve"
  | "contract";

export interface TxClassification {
  category: TxCategory;
  label: string;
  /** Feather icon name */
  icon:
    | "arrow-up-right"
    | "arrow-down-left"
    | "trending-up"
    | "trending-down"
    | "repeat"
    | "plus-square"
    | "minus-square"
    | "star"
    | "shield"
    | "zap";
  accent: "success" | "danger" | "info" | "warning" | "accent" | "neutral";
}

const DEX_CONTRACT = "con_dex";
const TOKEN_FACTORY_CONTRACT = "token_factory";

export function classifyTx(tx: TxHistoryRecord): TxClassification {
  const contract = tx.contract ?? "";
  const fn = tx.function ?? "";
  const kwargs = (tx.payload?.kwargs ?? tx.kwargs ?? {}) as Record<string, unknown>;

  if (contract === TOKEN_FACTORY_CONTRACT && fn === "create_token") {
    return { category: "create_token", label: "Create token", icon: "star", accent: "accent" };
  }

  if (contract === DEX_CONTRACT) {
    if (fn === "addLiquidity") {
      return { category: "add_liquidity", label: "Add liquidity", icon: "plus-square", accent: "info" };
    }
    if (fn === "removeLiquidity") {
      return { category: "remove_liquidity", label: "Remove liquidity", icon: "minus-square", accent: "warning" };
    }
    if (fn.startsWith("swap")) {
      const src = typeof kwargs.src === "string" ? (kwargs.src as string) : null;
      const path = Array.isArray(kwargs.path) ? (kwargs.path as unknown[]) : null;
      const last = path && path.length > 0 ? path[path.length - 1] : null;
      if (src === "currency") {
        return { category: "buy", label: "Buy", icon: "trending-up", accent: "success" };
      }
      if (typeof last === "string" && last === "currency") {
        return { category: "sell", label: "Sell", icon: "trending-down", accent: "danger" };
      }
      return { category: "swap", label: "Swap", icon: "repeat", accent: "info" };
    }
  }

  if (fn === "transfer" || fn === "transfer_from") {
    return { category: "send", label: fn === "transfer_from" ? "Transfer from" : "Send", icon: "arrow-up-right", accent: "danger" };
  }
  if (fn === "approve") {
    return { category: "approve", label: "Approve", icon: "shield", accent: "warning" };
  }

  return { category: "contract", label: "Contract call", icon: "zap", accent: "neutral" };
}
