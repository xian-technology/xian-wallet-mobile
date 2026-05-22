export function isUnsafeMessageToSign(message: string): boolean {
  if (message.length === 0 || message.length > 10_000) {
    return true;
  }
  try {
    const parsed = JSON.parse(message) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed == null) {
      return false;
    }
    return ["payload", "metadata", "chain_id", "contract", "function", "kwargs"].some(
      (key) => key in parsed
    );
  } catch {
    return false;
  }
}
