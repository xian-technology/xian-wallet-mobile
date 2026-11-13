import { describe, expect, it, jest } from "@jest/globals";

import {
  OUT_OF_CHI_MESSAGE,
  scheduleTransactionStatusToast,
  showTransactionSentToast,
} from "../transaction-notifications";

describe("transaction notifications", () => {
  it("builds transaction actions from bracketed IPv6 dashboard URLs", () => {
    const showToast = jest.fn();

    showTransactionSentToast(
      showToast as Parameters<typeof showTransactionSentToast>[0],
      "http://[::1]:8080",
      {
        submitted: true,
        accepted: true,
        finalized: false,
        txHash: "ABC123",
      }
    );

    expect(showToast).toHaveBeenCalledWith(
      "Transaction sent.",
      "info",
      expect.objectContaining({
        action: {
          label: "View transaction",
          url: "http://[::1]:8080/explorer/tx/ABC123",
        },
      })
    );
  });

  it("explains an out-of-chi failure as a state change since the estimate", () => {
    const showToast = jest.fn();
    const failed = { submitted: true, accepted: true, finalized: false, txHash: "ABC123" };

    for (const message of ["Out of chi.", "VmExecutionError('Out of chi.')"]) {
      scheduleTransactionStatusToast(
        showToast as Parameters<typeof scheduleTransactionStatusToast>[0],
        undefined,
        { ...failed, message },
        0,
        { failed: "Swap failed." }
      );
      expect(showToast).toHaveBeenLastCalledWith(
        "Swap failed.",
        "danger",
        expect.objectContaining({ detail: OUT_OF_CHI_MESSAGE })
      );
    }
    expect(OUT_OF_CHI_MESSAGE).toMatch(/state changed since the estimate/i);

    scheduleTransactionStatusToast(
      showToast as Parameters<typeof scheduleTransactionStatusToast>[0],
      undefined,
      { ...failed, message: "AssertionError('Insufficient balance')" },
      0
    );
    expect(showToast).toHaveBeenLastCalledWith(
      "Transaction failed.",
      "danger",
      expect.objectContaining({ detail: "AssertionError('Insufficient balance')" })
    );

    scheduleTransactionStatusToast(
      showToast as Parameters<typeof scheduleTransactionStatusToast>[0],
      undefined,
      { submitted: true, accepted: false, finalized: false, txHash: "ABC123", message: "  " },
      0
    );
    expect(showToast).toHaveBeenLastCalledWith(
      "Transaction failed.",
      "danger",
      expect.objectContaining({ detail: "ABC123" })
    );
  });
});
