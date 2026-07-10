import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { TokenAvatar } from "../components/TokenAvatar";
import { colors } from "../theme/colors";
import {
  blockedIntermediateToken,
  buildDexQuote,
  deadlineFromNow,
  DEFAULT_DEADLINE_MINUTES,
  DEFAULT_SLIPPAGE_BPS,
  DEX_ROUTER,
  dexNetworkKey,
  type DexQuote,
  loadDexSnapshot,
  minReceived,
  runtimeFixedFromNumber,
  runtimeFixedFromString,
  sortedDexTokens,
  tokenByContract,
  tokenSymbol,
  useSupportingFeeRoute,
  type WalletDexSnapshot,
  type WalletDexTokenInfo,
} from "../lib/dex";
import { useWallet } from "../lib/wallet-context";
import {
  loadDexAvailability,
  saveDexAvailability,
} from "../lib/storage";
import { loadUnlockedWalletMaterial } from "../lib/wallet-controller";
import {
  scheduleTransactionStatusToast,
  showTransactionSentToast,
  transactionSucceeded,
  type TransactionNotificationResult,
} from "../lib/transaction-notifications";
import { errorTap, lightTap, successTap } from "../lib/haptics";
import type { RootStackScreenProps } from "../navigation/types";

type Step = "draft" | "review" | "approving" | "swapping";
type PickerKind = "from" | "to";

const SLIPPAGE_OPTIONS = [50, 100, 300, 500];
const DEADLINE_OPTIONS = [10, 20, 30, 60];

function formatTradeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  const normalized = Object.is(value, -0) ? 0 : value;
  const abs = Math.abs(normalized);
  const maximumFractionDigits = abs >= 1 ? 6 : 8;
  return normalized.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString(undefined, {
    minimumFractionDigits: bps % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}%`;
}

function formatPriceImpact(value: number): string {
  return `${value >= 0 ? "-" : ""}${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}%`;
}

function formatChi(estimated: number | null, chiRate: number | null): string {
  if (estimated == null) {
    return "-";
  }
  if (!chiRate || chiRate <= 0) {
    return estimated.toLocaleString();
  }
  return `${estimated.toLocaleString()} (~${(estimated / chiRate).toLocaleString(undefined, {
    maximumFractionDigits: 8,
  })} XIAN)`;
}

function unavailableSnapshot(reason: string): WalletDexSnapshot {
  return {
    available: false,
    contract: DEX_ROUTER,
    pairsContract: "con_pairs",
    reason,
    tradeFeeBps: 30,
    maxHops: 3,
    pairs: [],
    tokens: [],
  };
}

function routeContracts(quote: DexQuote): string[] {
  return [
    quote.hops[0]?.fromToken,
    ...quote.hops.map((hop) => hop.toToken),
  ].filter((contract): contract is string => Boolean(contract));
}

function tradeSwapFunction(snapshot: WalletDexSnapshot, quote: DexQuote): string {
  return useSupportingFeeRoute(snapshot, quote)
    ? "swapExactTokensForTokensSupportingFeeOnTransferTokens"
    : "swapExactTokensForTokens";
}

export function TradeScreen({ navigation }: RootStackScreenProps<"Trade">) {
  const { state, rpc, refreshBalances, showToast, notifyActivityChanged } = useWallet();
  const [step, setStep] = useState<Step>("draft");
  const [snapshot, setSnapshot] = useState<WalletDexSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [fromToken, setFromToken] = useState("currency");
  const [toToken, setToToken] = useState("");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [deadlineMinutes, setDeadlineMinutes] = useState(DEFAULT_DEADLINE_MINUTES);
  const [pickerKind, setPickerKind] = useState<PickerKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<{ estimated: number } | null>(null);
  const [chiRate, setChiRate] = useState<number | null>(null);
  const [reviewQuote, setReviewQuote] = useState<DexQuote | null>(null);
  const [reviewKwargs, setReviewKwargs] = useState<Record<string, unknown> | null>(null);
  const [approvalNotice, setApprovalNotice] = useState<string | null>(null);

  const networkKey = dexNetworkKey(state);

  const refreshSnapshot = useCallback(async (force = false) => {
    setSnapshotLoading(true);
    setSnapshotError(null);
    setError(null);
    try {
      if (!force) {
        const cached = await loadDexAvailability(networkKey).catch(() => null);
        if (cached?.contract !== DEX_ROUTER) {
          setSnapshot(null);
        }
      }
      const next = await loadDexSnapshot(state, rpc);
      setSnapshot(next);
      if (next.available) {
        await saveDexAvailability({
          networkKey,
          contract: DEX_ROUTER,
          checkedAt: new Date().toISOString(),
        });
      } else {
        setSnapshotError(next.reason ?? "DEX is not deployed on this network.");
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Couldn't load DEX markets.";
      setSnapshot(unavailableSnapshot(message));
      setSnapshotError(message);
    } finally {
      setSnapshotLoading(false);
    }
  }, [networkKey, rpc, state]);

  useEffect(() => {
    void refreshSnapshot(true);
  }, [refreshSnapshot]);

  const tokens = useMemo(() => sortedDexTokens(snapshot), [snapshot]);

  useEffect(() => {
    if (tokens.length === 0) {
      return;
    }
    const nextFrom = tokens.some((token) => token.contract === fromToken)
      ? fromToken
      : tokens.find((token) => token.contract === "currency")?.contract ?? tokens[0]!.contract;
    const nextTo =
      toToken &&
      toToken !== nextFrom &&
      tokens.some((token) => token.contract === toToken)
        ? toToken
        : tokens.find((token) => token.contract !== nextFrom)?.contract ?? "";
    if (nextFrom !== fromToken) {
      setFromToken(nextFrom);
    }
    if (nextTo !== toToken) {
      setToToken(nextTo);
    }
  }, [fromToken, toToken, tokens]);

  const quoteState = useMemo(() => {
    if (!snapshot?.available) {
      return { quote: null as DexQuote | null, error: null as string | null };
    }
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { quote: null, error: null };
    }
    if (!fromToken || !toToken) {
      return { quote: null, error: "Select both tokens." };
    }
    if (fromToken === toToken) {
      return { quote: null, error: "Tokens must differ." };
    }
    const quote = buildDexQuote(snapshot, fromToken, toToken, parsed);
    return quote
      ? { quote, error: null }
      : { quote: null, error: "No route exists between these tokens." };
  }, [amount, fromToken, snapshot, toToken]);

  const from = tokenByContract(snapshot, fromToken);
  const to = tokenByContract(snapshot, toToken);
  const blocked = snapshot && quoteState.quote
    ? blockedIntermediateToken(snapshot, quoteState.quote)
    : null;
  const needsApproval = Boolean(from && quoteState.quote && from.allowance < quoteState.quote.amountIn);
  const insufficient = Boolean(from && quoteState.quote && from.balance < quoteState.quote.amountIn);
  const canReview = Boolean(quoteState.quote && !blocked && !needsApproval && !insufficient);

  const buildSwapKwargs = (quote: DexQuote): Record<string, unknown> => ({
    amountIn:
      runtimeFixedFromString(amount) ??
      runtimeFixedFromNumber(quote.amountIn),
    amountOutMin: runtimeFixedFromNumber(
      minReceived(quote, slippageBps),
      { floor: true }
    ),
    path: quote.path,
    src: fromToken,
    to: state.publicKey,
    deadline: deadlineFromNow(deadlineMinutes),
  });

  const handleMax = () => {
    lightTap();
    setAmount(from ? String(from.balance) : "0");
    setEstimate(null);
    setReviewQuote(null);
    setReviewKwargs(null);
    setApprovalNotice(null);
  };

  const handleFlip = () => {
    lightTap();
    setFromToken(toToken);
    setToToken(fromToken);
    setAmount("");
    setEstimate(null);
    setReviewQuote(null);
    setReviewKwargs(null);
    setApprovalNotice(null);
  };

  const handleApprove = async () => {
    if (!from || !quoteState.quote) {
      setError("Enter a valid trade amount.");
      return;
    }
    setStep("approving");
    setError(null);
    try {
      const material = await loadUnlockedWalletMaterial();
      if (!material) throw new Error("Wallet is locked");
      const kwargs = {
        amount:
          runtimeFixedFromString(amount) ??
          runtimeFixedFromNumber(quoteState.quote.amountIn),
        to: DEX_ROUTER,
      };
      const approvalEstimate = await rpc.estimateChi({
        sender: state.publicKey!,
        contract: from.contract,
        function: "approve",
        kwargs,
      });
      const result = await rpc.sendTransaction({
        privateKey: material.privateKey,
        contract: from.contract,
        function: "approve",
        kwargs,
        chi: approvalEstimate.estimated,
      });
      const sentShown = showTransactionSentToast(showToast, state.dashboardUrl, result, {
        sent: "Approval transaction sent.",
      });
      scheduleTransactionStatusToast(
        showToast,
        state.dashboardUrl,
        result,
        sentShown ? 1600 : 0,
        {
          finalized: "Approval finalized. Review and send the swap.",
          accepted: "Approval accepted. Review and send the swap.",
          failed: "Approval failed.",
        }
      );
      if (transactionSucceeded(result)) {
        successTap();
        notifyActivityChanged({
          txHash: result.txHash,
          sender: state.publicKey!,
          contract: from.contract,
          function: "approve",
          kwargs,
          accepted: result.accepted,
          finalized: result.finalized,
          message: result.message,
        });
        await refreshSnapshot(true);
        setApprovalNotice("Approval complete. Review and send the swap.");
        void refreshBalances();
      } else {
        errorTap();
        setApprovalNotice(null);
      }
    } catch (caught) {
      errorTap();
      const result: TransactionNotificationResult = {
        submitted: false,
        accepted: false,
        finalized: false,
        message: caught instanceof Error ? caught.message : "Approval failed",
      };
      scheduleTransactionStatusToast(showToast, state.dashboardUrl, result, 0, {
        failed: "Approval failed.",
      });
      setError(caught instanceof Error ? caught.message : "Approval failed");
      setApprovalNotice(null);
    } finally {
      setStep("draft");
    }
  };

  const handleReview = async () => {
    if (!snapshot?.available) {
      await refreshSnapshot(true);
    }
    if (!snapshot?.available) {
      setError(snapshotError ?? "DEX market data is not loaded.");
      return;
    }
    const quote = quoteState.quote;
    if (!quote) {
      setError(quoteState.error ?? "Enter a valid trade amount.");
      return;
    }
    if (from && from.balance < quote.amountIn) {
      setError(`Insufficient ${tokenSymbol(from)} balance.`);
      return;
    }
    if (from && from.allowance < quote.amountIn) {
      setError(`Approve ${tokenSymbol(from)} first.`);
      return;
    }
    const blockedToken = blockedIntermediateToken(snapshot, quote);
    if (blockedToken) {
      setError(`Route unavailable: ${blockedToken} is fee-on-transfer.`);
      return;
    }

    const fn = tradeSwapFunction(snapshot, quote);
    const kwargs = buildSwapKwargs(quote);
    setError(null);
    try {
      const [nextEstimate, nextChiRate] = await Promise.all([
        rpc.estimateChi({
          sender: state.publicKey!,
          contract: DEX_ROUTER,
          function: fn,
          kwargs,
        }),
        rpc.getChiRate(),
      ]);
      setReviewQuote(quote);
      setReviewKwargs(kwargs);
      setEstimate(nextEstimate);
      setChiRate(nextChiRate);
      lightTap();
      setStep("review");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Estimation failed.");
    }
  };

  const handleSend = async () => {
    if (!snapshot || !reviewQuote || !reviewKwargs) {
      setStep("draft");
      return;
    }
    setStep("swapping");
    try {
      const material = await loadUnlockedWalletMaterial();
      if (!material) throw new Error("Wallet is locked");
      const fn = tradeSwapFunction(snapshot, reviewQuote);
      const result = await rpc.sendTransaction({
        privateKey: material.privateKey,
        contract: DEX_ROUTER,
        function: fn,
        kwargs: reviewKwargs,
        chi: estimate?.estimated ?? 50_000,
      });
      const sentShown = showTransactionSentToast(showToast, state.dashboardUrl, result, {
        sent: "Swap transaction sent.",
      });
      scheduleTransactionStatusToast(
        showToast,
        state.dashboardUrl,
        result,
        sentShown ? 1600 : 0,
        {
          finalized: "Swap finalized.",
          accepted: "Swap accepted.",
          failed: "Swap failed.",
        }
      );
      if (transactionSucceeded(result)) {
        successTap();
        notifyActivityChanged({
          txHash: result.txHash,
          sender: state.publicKey!,
          contract: DEX_ROUTER,
          function: fn,
          kwargs: reviewKwargs,
          accepted: result.accepted,
          finalized: result.finalized,
          message: result.message,
        });
        void refreshBalances();
        setAmount("");
        setEstimate(null);
        setReviewQuote(null);
        setReviewKwargs(null);
        setApprovalNotice(null);
        setStep("draft");
        navigation.navigate("Main");
      } else {
        errorTap();
        setStep("review");
      }
    } catch (caught) {
      errorTap();
      const result: TransactionNotificationResult = {
        submitted: false,
        accepted: false,
        finalized: false,
        message: caught instanceof Error ? caught.message : "Swap failed",
      };
      scheduleTransactionStatusToast(showToast, state.dashboardUrl, result, 0, {
        failed: "Swap failed.",
      });
      setError(caught instanceof Error ? caught.message : "Swap failed");
      setStep("review");
    }
  };

  const selectToken = (token: WalletDexTokenInfo) => {
    lightTap();
    if (pickerKind === "from") {
      setFromToken(token.contract);
      if (token.contract === toToken) {
        setToToken(fromToken);
      }
      setAmount("");
    } else {
      setToToken(token.contract);
      if (token.contract === fromToken) {
        setFromToken(toToken);
      }
    }
    setEstimate(null);
    setReviewQuote(null);
    setReviewKwargs(null);
    setApprovalNotice(null);
    setPickerKind(null);
  };

  const tokenPickerModal = (
    <Modal visible={pickerKind != null} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Token</Text>
            <TouchableOpacity onPress={() => setPickerKind(null)}>
              <Feather name="x" size={22} color={colors.fg} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={tokens.filter((token) =>
              pickerKind === "from" ? token.contract !== toToken : token.contract !== fromToken
            )}
            keyExtractor={(token) => token.contract}
            renderItem={({ item }) => {
              const symbol = tokenSymbol(item);
              const isActive = item.contract === (pickerKind === "from" ? fromToken : toToken);
              return (
                <TouchableOpacity
                  style={[styles.tokenPickerItem, isActive && styles.tokenPickerActive]}
                  onPress={() => selectToken(item)}
                >
                  <TokenAvatar
                    contract={item.contract}
                    symbol={symbol}
                    icon={item.logoUrl ?? item.logoSvg ?? undefined}
                    size={32}
                    textSize={14}
                    backgroundColor={item.contract === "currency" ? colors.accentDim : colors.bg2}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tokenPickerSym}>{symbol}</Text>
                    <Text style={styles.tokenPickerName} numberOfLines={1}>
                      {item.name ?? item.contract}
                    </Text>
                  </View>
                  <Text style={styles.tokenPickerBalance}>{formatTradeNumber(item.balance)}</Text>
                  {isActive && <Feather name="check" size={18} color={colors.accent} />}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );

  if (step === "approving" || step === "swapping") {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.busyText}>
          {step === "approving" ? "Approving token..." : "Sending swap..."}
        </Text>
      </View>
    );
  }

  if (step === "review" && reviewQuote && reviewKwargs && snapshot) {
    const reviewFrom = tokenByContract(snapshot, fromToken);
    const reviewTo = tokenByContract(snapshot, toToken);
    const minOut = Number(reviewKwargs.amountOutMin);
    const fn = tradeSwapFunction(snapshot, reviewQuote);
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Card title="Swap summary">
            <Row label="From" value={`${formatTradeNumber(reviewQuote.amountIn)} ${tokenSymbol(reviewFrom)}`} />
            <Row label="To" value={`~${formatTradeNumber(reviewQuote.amountOut)} ${tokenSymbol(reviewTo)}`} />
            <Row label="Minimum received" value={`${formatTradeNumber(minOut)} ${tokenSymbol(reviewTo)}`} />
            <Row label="Price impact" value={formatPriceImpact(reviewQuote.priceImpact * 100)} tone={reviewQuote.priceImpact >= 0.05 ? "danger" : undefined} />
            <View style={styles.sectionLabelWrap}>
              <Text style={styles.sectionLabel}>Route</Text>
            </View>
            <View style={styles.routeWrap}>
              {routeContracts(reviewQuote).map((contract, index, contracts) => {
                const token = tokenByContract(snapshot, contract);
                return (
                  <React.Fragment key={`${contract}-${index}`}>
                    <Text style={styles.routeToken}>{tokenSymbol(token) || contract.slice(0, 6)}</Text>
                    {index < contracts.length - 1 && <Feather name="chevron-right" size={14} color={colors.muted} />}
                  </React.Fragment>
                );
              })}
            </View>
            <View style={styles.sectionLabelWrap}>
              <Text style={styles.sectionLabel}>Transaction</Text>
            </View>
            <Row label="Contract" value={DEX_ROUTER} mono />
            <Row label="Function" value={fn} />
          </Card>

          <Card title="Transaction fee">
            <Row label="Chi" value={formatChi(estimate?.estimated ?? null, chiRate)} />
          </Card>

          {error && <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View>}
        </ScrollView>
        <View style={styles.stickyBottom}>
          <Button title="Send Swap" onPress={handleSend} />
          <Button title="Edit" variant="ghost" onPress={() => setStep("draft")} />
        </View>
      </View>
    );
  }

  const primaryLabel = snapshotLoading
    ? "Loading markets..."
    : tokens.length < 2
      ? "No swap tokens"
      : !quoteState.quote
        ? "Enter amount"
        : insufficient
          ? `Insufficient ${tokenSymbol(from)}`
          : blocked
            ? "Route unavailable"
            : needsApproval
              ? `Approve ${tokenSymbol(from)}`
              : "Review Swap";

  const quote = quoteState.quote;
  const priceImpact = quote ? quote.priceImpact * 100 : 0;
  const useSupporting = snapshot && quote ? useSupportingFeeRoute(snapshot, quote) : false;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {tokenPickerModal}
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card
          title="Swap"
          subtitle={`Swap through ${DEX_ROUTER} on ${state.activeNetworkName ?? "this network"}.`}
        >
          {snapshotLoading && (
            <View style={styles.inlineLoading}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.loadingText}>Loading markets...</Text>
            </View>
          )}

          {snapshotError && (
            <View style={styles.warningBanner}>
              <Text style={styles.warningText}>{snapshotError}</Text>
            </View>
          )}

          {approvalNotice && canReview && (
            <InlineBanner tone="success" text={approvalNotice} />
          )}

          <TradePanel
            label="From"
            token={from}
            amount={amount}
            editable
            balanceAction={handleMax}
            onAmountChange={(value) => {
              setAmount(value);
              setEstimate(null);
              setReviewQuote(null);
              setReviewKwargs(null);
              setApprovalNotice(null);
            }}
            onSelectToken={() => {
              lightTap();
              Keyboard.dismiss();
              setPickerKind("from");
            }}
          />

          <TouchableOpacity style={styles.flipButton} onPress={handleFlip}>
            <Feather name="repeat" size={18} color={colors.accent} />
          </TouchableOpacity>

          <TradePanel
            label="To"
            token={to}
            amount={quote ? formatTradeNumber(quote.amountOut) : ""}
            onSelectToken={() => {
              lightTap();
              Keyboard.dismiss();
              setPickerKind("to");
            }}
          />

          <View style={styles.settingsGrid}>
            <OptionGroup
              label="Slippage"
              options={SLIPPAGE_OPTIONS}
              value={slippageBps}
              format={formatBps}
              onChange={(next) => {
                lightTap();
                setSlippageBps(next);
                setEstimate(null);
                setReviewQuote(null);
                setReviewKwargs(null);
              }}
            />
            <OptionGroup
              label="Deadline"
              options={DEADLINE_OPTIONS}
              value={deadlineMinutes}
              format={(minutes) => `${minutes} min`}
              onChange={(next) => {
                lightTap();
                setDeadlineMinutes(next);
                setEstimate(null);
                setReviewQuote(null);
                setReviewKwargs(null);
              }}
            />
          </View>

          {quoteState.error && <InlineBanner tone="warning" text={quoteState.error} />}
          {quote && (
            <View style={styles.quoteBox}>
              <Row label="Rate" value={`1 ${tokenSymbol(from)} ~ ${formatTradeNumber(quote.amountOut / Math.max(quote.amountIn, 1e-12))} ${tokenSymbol(to)}`} />
              <Row label={`Min received (${formatBps(slippageBps)})`} value={`${formatTradeNumber(minReceived(quote, slippageBps))} ${tokenSymbol(to)}`} />
              <Row label="Price impact" value={formatPriceImpact(priceImpact)} tone={priceImpact >= 5 ? "danger" : priceImpact >= 1.5 ? "warning" : undefined} />
              <Row label="DEX fee" value={formatBps(quote.feeBps)} />
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Route</Text>
                <View style={styles.routeWrapCompact}>
                  {routeContracts(quote).map((contract, index, contracts) => {
                    const token = tokenByContract(snapshot, contract);
                    return (
                      <React.Fragment key={`${contract}-${index}`}>
                        <Text style={styles.routeTokenCompact}>{tokenSymbol(token) || contract.slice(0, 6)}</Text>
                        {index < contracts.length - 1 && <Feather name="chevron-right" size={12} color={colors.muted} />}
                      </React.Fragment>
                    );
                  })}
                </View>
              </View>
              {quote.hops.length > 1 && <InlineBanner tone="info" text={`${quote.hops.length} hops. Best route auto-selected.`} />}
              {useSupporting && <InlineBanner tone="warning" text="Using fee-on-transfer compatible route." />}
              {blocked && <InlineBanner tone="danger" text={`Route unavailable: ${blocked} is fee-on-transfer.`} />}
              {priceImpact >= 5 && <InlineBanner tone="danger" text="Price impact is high. Consider a smaller trade." />}
            </View>
          )}
        </Card>

        {error && <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View>}
      </ScrollView>

      <View style={styles.stickyBottom}>
        <Button
          title={primaryLabel}
          onPress={needsApproval ? handleApprove : handleReview}
          loading={snapshotLoading}
          disabled={snapshotLoading || (!canReview && !needsApproval)}
        />
        <Button title="Refresh Markets" variant="ghost" onPress={() => { lightTap(); void refreshSnapshot(true); }} />
      </View>
    </KeyboardAvoidingView>
  );
}

function TradePanel({
  label,
  token,
  amount,
  editable = false,
  balanceAction,
  onAmountChange,
  onSelectToken,
}: {
  label: string;
  token: WalletDexTokenInfo | null;
  amount: string;
  editable?: boolean;
  balanceAction?: () => void;
  onAmountChange?: (value: string) => void;
  onSelectToken: () => void;
}) {
  const symbol = tokenSymbol(token);
  return (
    <View style={styles.tradePanel}>
      <View style={styles.tradePanelTop}>
        <Text style={styles.panelLabel}>{label}</Text>
        {token && (
          <View style={styles.balanceRow}>
            <Text style={styles.panelBalance}>Balance: {formatTradeNumber(token.balance)}</Text>
            {balanceAction && (
              <TouchableOpacity onPress={balanceAction}>
                <Text style={styles.maxText}>MAX</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
      <View style={styles.tradePanelBody}>
        <TextInput
          value={amount}
          onChangeText={onAmountChange}
          editable={editable}
          placeholder="0.00"
          placeholderTextColor={colors.muted}
          keyboardType="decimal-pad"
          style={styles.amountInput}
        />
        <TouchableOpacity style={styles.tokenSelector} onPress={onSelectToken}>
          <Text style={styles.tokenSelectorText} numberOfLines={1}>{symbol || "Token"}</Text>
          <Feather name="chevron-down" size={15} color={colors.muted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function OptionGroup({
  label,
  options,
  value,
  format,
  onChange,
}: {
  label: string;
  options: number[];
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <View style={styles.optionGroup}>
      <Text style={styles.optionLabel}>{label}</Text>
      <View style={styles.optionRow}>
        {options.map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.optionChip, option === value && styles.optionChipActive]}
            onPress={() => onChange(option)}
          >
            <Text style={[styles.optionText, option === value && styles.optionTextActive]}>
              {format(option)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function InlineBanner({ tone, text }: { tone: "info" | "success" | "warning" | "danger"; text: string }) {
  return (
    <View style={[
      styles.inlineBanner,
      tone === "success" && styles.successBanner,
      tone === "warning" && styles.warningBanner,
      tone === "danger" && styles.errorBanner,
    ]}>
      <Text style={[
        styles.inlineBannerText,
        tone === "success" && styles.successText,
        tone === "warning" && styles.warningText,
        tone === "danger" && styles.errorText,
      ]}>
        {text}
      </Text>
    </View>
  );
}

function Row({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "warning" | "danger";
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        style={[
          styles.detailValue,
          mono && styles.mono,
          tone === "warning" && styles.warningText,
          tone === "danger" && styles.errorText,
        ]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg0 },
  centered: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: 16, gap: 16, paddingBottom: 132 },
  stickyBottom: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, paddingBottom: 24, backgroundColor: colors.bg0, borderTopWidth: 1, borderTopColor: colors.line, gap: 8 },
  busyText: { color: colors.muted, marginTop: 16, fontSize: 14 },
  inlineLoading: { flexDirection: "row", alignItems: "center", gap: 8, padding: 8 },
  loadingText: { fontSize: 13, color: colors.muted },
  tradePanel: { padding: 12, borderRadius: 14, backgroundColor: colors.bg2, gap: 8 },
  tradePanelTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  panelLabel: { fontSize: 12, color: colors.muted, fontWeight: "500" },
  balanceRow: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  panelBalance: { fontSize: 12, color: colors.muted },
  maxText: { fontSize: 10, fontWeight: "700", color: colors.accent, letterSpacing: 0.5 },
  tradePanelBody: { flexDirection: "row", alignItems: "center", gap: 12 },
  amountInput: { flex: 1, height: 52, color: colors.fg, fontSize: 26, fontWeight: "600", padding: 0 },
  tokenSelector: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, width: 132, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.bg1 },
  tokenSelectorText: { color: colors.fg, fontSize: 26, fontWeight: "600", maxWidth: 86 },
  flipButton: { alignSelf: "center", width: 42, height: 42, borderRadius: 21, backgroundColor: colors.bg2, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", marginVertical: -2 },
  settingsGrid: { gap: 12 },
  optionGroup: { gap: 7 },
  optionLabel: { color: colors.muted, fontSize: 12, fontWeight: "500" },
  optionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionChip: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.bg2, borderWidth: 1, borderColor: colors.line },
  optionChipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accentDim },
  optionText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  optionTextActive: { color: colors.accent },
  quoteBox: { padding: 12, borderRadius: 14, backgroundColor: colors.bg2, gap: 4 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, gap: 12 },
  detailLabel: { fontSize: 13, color: colors.muted, flexShrink: 1 },
  detailValue: { fontSize: 13, color: colors.fg, fontWeight: "600", maxWidth: "62%", textAlign: "right" },
  mono: { fontFamily: "monospace" },
  sectionLabelWrap: { paddingTop: 8 },
  sectionLabel: { color: colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  routeWrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, paddingVertical: 4 },
  routeToken: { color: colors.fg, fontSize: 13, fontWeight: "600", backgroundColor: colors.bg2, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 9 },
  routeWrapCompact: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 4, maxWidth: "62%" },
  routeTokenCompact: { color: colors.fg, fontSize: 12, fontWeight: "600" },
  inlineBanner: { backgroundColor: colors.accentSoft, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.accentDim, marginTop: 6 },
  inlineBannerText: { fontSize: 12, color: colors.fg },
  successBanner: { backgroundColor: colors.successSoft, borderColor: "rgba(34, 197, 94, 0.28)" },
  successText: { fontSize: 12, color: colors.success },
  warningBanner: { backgroundColor: colors.warningSoft, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: "rgba(250, 173, 20, 0.28)" },
  warningText: { fontSize: 12, color: colors.warning },
  errorBanner: { backgroundColor: colors.dangerSoft, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255, 77, 79, 0.32)" },
  errorText: { fontSize: 12, color: colors.danger },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: colors.bg1, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "58%", padding: 16 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  modalTitle: { fontSize: 16, fontWeight: "700", color: colors.fg },
  tokenPickerItem: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  tokenPickerActive: { backgroundColor: colors.accentSoft },
  tokenPickerSym: { fontSize: 14, fontWeight: "600", color: colors.fg },
  tokenPickerName: { fontSize: 11, color: colors.muted },
  tokenPickerBalance: { fontSize: 12, color: colors.muted, fontWeight: "600" },
});
