# src

## Purpose

This folder contains the mobile wallet application code: screens, navigation,
shared components, and the wallet domain layer.

## Contents

- `screens/` — top-level screens: `Setup`, `Lock`, `Home`, `Send`, `Trade`
  (swap), `Receive`, `Activity`, `Apps` (WalletConnect), `Networks`,
  `Settings`, `TokenDetail`, `AdvancedTx`.
- `navigation/` — React Navigation stack and tab navigators.
- `components/` — shared UI components.
- `lib/` — wallet domain layer: `wallet-controller.ts` / `wallet-context.tsx`
  state and lifecycle, `storage.ts` encrypted persistence, `rpc-client.ts`
  node access through `@xian-tech/client`, `dex.ts` swap quoting,
  `walletconnect.ts` + `signing-policy.ts` dapp sessions, `biometrics.ts`
  unlock, `wallet-backup.ts` encrypted backups, plus classification,
  input-validation, polyfill, and haptics helpers.
- `theme/` — color and typography tokens.
- `types.ts` — shared app types.

## Notes

- Key derivation and backup encryption must stay compatible with the browser
  wallet (`xian-wallet-browser`); do not change `lib/crypto-polyfill.ts`,
  backup formats, or derivation paths casually.
- Secrets live encrypted in AsyncStorage with short-lived unlocked session
  material in `expo-secure-store`; keep new code on that model.

## Next

- Start with `lib/wallet-controller.ts`, then the screen you are changing.
