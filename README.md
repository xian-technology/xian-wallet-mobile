# xian-wallet-mobile

`xian-wallet-mobile` is the official mobile wallet app for Xian. It is an
Expo / React Native app (Android first, iOS supported) that talks to Xian
nodes through `@xian-tech/client`, signs transactions locally with
Ed25519, and stores secrets in the platform secure store.

This repo is the *mobile product*. It depends on the `xian-js` SDK
workspace as a sibling checkout. The browser wallet product lives in the
sibling [`xian-wallet-browser`](../xian-wallet-browser) repo.

## Quick Start

This repo consumes `@xian-tech/client` from the sibling `xian-js`
checkout. The expected local layout is:

```text
.../xian/
  xian-js/
  xian-wallet-mobile/
```

Build the SDK workspace first, then the mobile app:

```bash
cd ../xian-js
npm install
npm run build

cd ../xian-wallet-mobile
npm install
npm run start            # Expo dev server
npm run android          # build and run on a connected Android device or emulator
npm run ios              # build and run on the iOS simulator
```

## Product Workflows

The mobile wallet is a full wallet product, not a thin SDK demo. The current
app covers:

| Flow | Screen / layer | Notes |
| --- | --- | --- |
| Create or restore wallet | `Setup` | generates or restores mnemonic-backed wallet state |
| Lock / unlock | `Lock`, wallet controller | keeps private key access behind the local session boundary |
| Receive funds | `Receive` | shows the public address and QR code |
| Send token transfer | `Send` | estimates chi, submits transfer, refreshes balances |
| Inspect balances | `Home`, `TokenDetail` | reads token balances through `@xian-tech/client` |
| Review activity | `Activity` | pulls indexed transaction history where available |
| Manage networks | `Networks`, `Settings` | stores RPC / dashboard presets and switches active network |
| Advanced contract call | `AdvancedTx` | loads contract methods, validates kwargs JSON, estimates chi, sends tx |
| Apps / watched assets | `Apps`, wallet context | tracks dapp-requested or user-added assets |

The default network preset points at `http://127.0.0.1:26657`, which is
convenient for local desktop testing but not always reachable from a device:

- iOS simulator usually reaches the Mac host through `http://127.0.0.1:26657`
- Android emulator usually needs `http://10.0.2.2:26657`
- physical devices need the host machine's LAN IP, for example
  `http://192.168.1.50:26657`

When testing against `xian-stack`, start the node first and then update the
wallet network preset to the RPC URL reachable from the simulator or device:

```bash
cd ../xian-stack
python3 ./scripts/backend.py start --no-service-node --dashboard
python3 ./scripts/backend.py endpoints --no-service-node --dashboard
```

For local development, keep Metro running in one terminal and use a second
terminal for tests or native rebuilds:

```bash
npm run start
npm run typecheck
npm run test
```

## Principles

- **Mobile-first product code.** The repo is a wallet app, not an SDK
  example. UX, recovery, secure storage, and approval flows live here.
- **Secrets stay on-device.** Mnemonics and private keys are stored via
  `expo-secure-store`. Networking and signing happen in the app process.
- **SDK lives elsewhere.** Wire formats, RPC contracts, and signing
  primitives live in `xian-js` and are consumed from
  `@xian-tech/client`. Changes to that contract land in `xian-js` first.
- **Expo + React Native.** The app uses Expo Router for navigation and
  `react-native-get-random-values` plus `expo-crypto` to provide secure
  random material on platforms that lack `crypto.getRandomValues`.
- **Independent release cadence.** Mobile releases are shipped
  independently from `xian-js` and `xian-wallet-browser`.

## Key Directories

- `App.tsx`, `index.ts` — Expo entrypoint and root component.
- `src/screens/` — top-level screens: `Setup`, `Home`, `Send`,
  `Receive`, `Activity`, `Apps`, `Networks`, `Settings`,
  `TokenDetail`, `AdvancedTx`, `Lock`.
- `src/navigation/` — React Navigation stack and tab navigators.
- `src/components/` — shared UI components.
- `src/lib/` — wallet domain layer:
  - `wallet-context.tsx`, `wallet-controller.ts` — wallet state, lock /
    unlock, account selection, network switching.
  - `storage.ts`, `preferences.ts` — secure-store wrappers and user
    preferences.
  - `rpc-client.ts` — RPC client wired through `@xian-tech/client`.
  - `tx-classify.ts`, `runtime-input.ts` — transaction classification
    and input validation helpers.
  - `crypto-polyfill.ts`, `haptics.ts` — platform polyfills and haptic
    helpers.
- `src/theme/` — theme tokens and styling primitives.
- `android/` — native Android project produced by Expo prebuild.
- `assets/` — app icons, splash images, fonts.
- `app.json` — Expo configuration.

## Validation

```bash
npm install
npm run typecheck         # tsc --noEmit
npm run test              # Jest (jest-expo, react-test-renderer)
```

For full mobile validation, run the Expo dev server and exercise the app
on a real device or emulator:

```bash
npm run start
npm run android
npm run ios
```

## Release Artifacts

- Android APKs are checked in alongside the source for convenience
  (e.g. `xian-wallet-mobile-v0.1.0.apk`).
- Production releases follow Expo's standard build flow against the
  configuration in `app.json`.

## Related Repos

- [`../xian-js/README.md`](../xian-js/README.md) — official JS / TS SDK consumed by this app
- [`../xian-wallet-browser/README.md`](../xian-wallet-browser/README.md) — browser wallet product workspace
