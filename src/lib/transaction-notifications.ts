import type { ToastIcon, ToastTone, WalletContextValue } from "./wallet-context";

export interface TransactionNotificationResult {
  submitted: boolean;
  accepted: boolean | null;
  finalized: boolean;
  txHash?: string;
  message?: unknown;
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
  } catch {
    return undefined;
  }

  return `${trimmedDashboard.replace(/\/+$/, "")}/explorer/tx/${encodeURIComponent(trimmedHash)}`;
}

function truncateHash(hash: string): string {
  return hash.length > 20 ? `${hash.slice(0, 10)}...${hash.slice(-8)}` : hash;
}

function transactionAction(dashboardUrl: string | undefined, txHash: string | undefined) {
  const url = transactionExplorerUrl(dashboardUrl, txHash);
  return url ? { label: "View transaction", url } : undefined;
}

function failureMessage(result: TransactionNotificationResult): string | undefined {
  return typeof result.message === "string" && result.message.trim()
    ? result.message.trim()
    : undefined;
}

function finalStatus(result: TransactionNotificationResult): {
  message: string;
  tone: ToastTone;
  icon: ToastIcon;
  detail?: string;
} | null {
  if (result.finalized) {
    return { message: "Transaction finalized.", tone: "success", icon: "success" };
  }
  const failedMessage = failureMessage(result);
  if (failedMessage || result.accepted === false || result.submitted === false) {
    return {
      message: "Transaction failed.",
      tone: "danger",
      icon: "danger",
      detail: failedMessage,
    };
  }
  if (result.accepted === true) {
    return { message: "Transaction accepted.", tone: "success", icon: "success" };
  }
  return null;
}

export function transactionSucceeded(result: TransactionNotificationResult): boolean {
  return result.finalized || (result.accepted === true && !failureMessage(result));
}

export function showTransactionSentToast(
  showToast: ShowToast,
  dashboardUrl: string | undefined,
  result: TransactionNotificationResult
): boolean {
  if (!result.submitted) {
    return false;
  }

  showToast("Transaction sent.", "info", {
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
  delayMs: number
): ReturnType<typeof setTimeout> | null {
  const status = finalStatus(result);
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
