// Shared policy for password-protected vaults and portable backups.
export const WALLET_KDF_ITERATIONS = 600_000;
export const MIN_WALLET_KDF_ITERATIONS = 250_000;
export const MAX_WALLET_KDF_ITERATIONS = 2_000_000;

export function assertWalletKdfIterations(
  iterations: unknown,
  message = "invalid wallet encryption parameters"
): asserts iterations is number {
  if (
    typeof iterations !== "number" ||
    !Number.isSafeInteger(iterations) ||
    iterations < MIN_WALLET_KDF_ITERATIONS ||
    iterations > MAX_WALLET_KDF_ITERATIONS
  ) {
    throw new Error(message);
  }
}
