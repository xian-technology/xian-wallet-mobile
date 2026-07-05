import { describe, expect, it, jest } from "@jest/globals";

import { showTransactionSentToast } from "../transaction-notifications";

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
});
