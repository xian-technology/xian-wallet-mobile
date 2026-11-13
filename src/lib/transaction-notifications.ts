import type { ToastIcon, ToastTone, WalletContextValue } from "./wallet-context";

export interface TransactionNotificationResult {
  submitted: boolean;
  accepted: boolean | null;
  finalized: boolean;
  txHash?: string;
  message?: unknown;
}

interface TransactionNotificationLabels {
  sent?: string;
  finalized?: string;
  accepted?: string;
  failed?: string;
}

type ShowToast = WalletContextValue["showToast"];

function transactionExplorerUrl(
  dashboardUrl: string | undefined,
  txHash: string | undefined
): string | undefined {
  const trimmedHash = txHash?.trim();
  const trimmedDashboard = dashboardUrl?.trim();
  if (!trimmedHash || !trimmedDashboard) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmedDashboard);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    const basePath = parsed.pathname.replace(/\/+$/, "");
    parsed.pathname = `${basePath}/explorer/tx/${encodeURIComponent(trimmedHash)}`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function truncateHash(hash: string): string {
  return hash.length > 20 ? `${hash.slice(0, 10)}...${hash.slice(-8)}` : hash;
}

function transactionAction(dashboardUrl: string | undefined, txHash: string | undefined) {
  const url = transactionExplorerUrl(dashboardUrl, txHash);
  return url ? { label: "View transaction", url } : undefined;
}

/** Shown for a transaction that ran out of its exactly estimated chi. */
export const OUT_OF_CHI_MESSAGE =
  "Out of chi: the chain state changed since the estimate. Review the transaction and try again.";

function failureMessage(result: TransactionNotificationResult): string | undefined {
  const message = typeof result.message === "string" ? result.message.trim() : "";
  if (!message) return undefined;
  // Wallets supply exactly the simulated chi, so running out of it means the
  // state moved between the estimate and execution.
  return /out of chi/i.test(message) ? OUT_OF_CHI_MESSAGE : message;
}

function finalStatus(
  result: TransactionNotificationResult,
  labels: TransactionNotificationLabels = {}
): {
  message: string;
  tone: ToastTone;
  icon: ToastIcon;
  detail?: string;
} | null {
  if (result.finalized) {
    return {
      message: labels.finalized ?? "Transaction finalized.",
      tone: "success",
      icon: "success",
    };
  }
  const failedMessage = failureMessage(result);
  if (failedMessage || result.accepted === false || result.submitted === false) {
    return {
      message: labels.failed ?? "Transaction failed.",
      tone: "danger",
      icon: "danger",
      detail: failedMessage,
    };
  }
  if (result.accepted === true) {
    return {
      message: labels.accepted ?? "Transaction accepted.",
      tone: "success",
      icon: "success",
    };
  }
  return null;
}

export function transactionSucceeded(result: TransactionNotificationResult): boolean {
  return result.finalized || (result.accepted === true && !failureMessage(result));
}

export function showTransactionSentToast(
  showToast: ShowToast,
  dashboardUrl: string | undefined,
  result: TransactionNotificationResult,
  labels: TransactionNotificationLabels = {}
): boolean {
  if (!result.submitted) {
    return false;
  }

  showToast(labels.sent ?? "Transaction sent.", "info", {
    icon: "info",
    detail: result.txHash ? truncateHash(result.txHash) : undefined,
    action: transactionAction(dashboardUrl, result.txHash),
    duration: 6000,
  });
  return true;
}

export function scheduleTransactionStatusToast(
  showToast: ShowToast,
  dashboardUrl: string | undefined,
  result: TransactionNotificationResult,
  delayMs: number,
  labels: TransactionNotificationLabels = {}
): ReturnType<typeof setTimeout> | null {
  const status = finalStatus(result, labels);
  if (!status) {
    return null;
  }

  const showStatusToast = () => {
    showToast(status.message, status.tone, {
      icon: status.icon,
      detail: status.detail ?? (result.txHash ? truncateHash(result.txHash) : undefined),
      action: transactionAction(dashboardUrl, result.txHash),
      duration: 6000,
    });
  };

  if (delayMs <= 0) {
    showStatusToast();
    return null;
  }

  return setTimeout(showStatusToast, delayMs);
}
