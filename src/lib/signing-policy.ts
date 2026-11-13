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

// Characters that render as nothing or reorder surrounding text, so a reviewer
// could read something other than the bytes being signed. Tab, newline and
// carriage return stay as ordinary layout.
const HIDDEN_CHARACTER =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜ᅟᅠ᠎​-‏‪-‮⁠-⁤⁦-⁯ㅤ﻿ﾠ￹-￻\u{E0000}-\u{E007F}]/gu;

// Called only with a HIDDEN_CHARACTER match, which is never empty.
function codePointLabel(character: string): string {
  const codePoint = character.codePointAt(0)!;
  return `[U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}]`;
}

/** Replace hidden characters with visible [U+XXXX] markers for review. */
export function revealHiddenCharacters(text: string): { text: string; revealed: boolean } {
  const revealedText = text.replace(HIDDEN_CHARACTER, codePointLabel);
  return { text: revealedText, revealed: revealedText !== text };
}
