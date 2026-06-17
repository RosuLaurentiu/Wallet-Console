# Wallet Console Agent Notes

## Project

This repo is a private-use browser wallet app for COTI arbitrage execution and inventory rebalancing.
The public-facing project name is intentionally neutral: `Wallet Console`.

- Local folder: `C:\Users\rosu_\Desktop\COTI Projects\PrivateVaults\COTIArbSigner`
- Package name: `wallet-console`
- GitHub Pages app: static Vite React app
- No backend, no VPS API, no server secrets
- The connected wallet signs every transaction through `eth_sendTransaction`

## Core Rules

- Never ask for, store, print, or transmit private keys or seed phrases.
- Keep the allowed-wallet gate enforced:
  `0x5DFcEe20b5a3FDd3577436A32f62d4C0b39e979d`
- Keep arbitrage execution separate from bridge/rebalance execution.
- Arb plans must remain DEX-only:
  Uniswap approval/swap first, Carbon approval/swap second.
- Rebalance plans may contain only official COTI bridge transfers for COTI/gCOTI.
- Never add arbitrary recipient, arbitrary calldata, arbitrary contract, or custom token inputs.

## Main Files

- `src/App.tsx`: main UI and wallet signing flow.
- `src/arb/config.ts`: public addresses, RPCs, app constants.
- `src/arb/engine.ts`: quote building, arb transaction preparation, rebalance preparation.
- `src/arb/guards.ts`: transaction safety guards.
- `src/arb/guards.test.ts`: safety tests.
- `.github/workflows/deploy-pages.yml`: GitHub Pages deploy.

## Current Features

- Quotes:
  - `COTI/gCOTI`
  - `COTI/USDC`
- Arb execution:
  - Uniswap leg always signs first.
  - Carbon leg signs second.
  - No bridge action is allowed inside arb execution.
- Rebalance:
  - `Rebalance 50/50` checks both COTI and gCOTI.
  - It prepares one bridge transfer per token that needs rebalancing.
  - It uses only official COTI bridge recipients.

## Commands

```bash
npm ci
npm test
npm run lint
VITE_BASE_PATH=/private-vault-app/ npm run build
npm run dev
```

On Windows PowerShell:

```powershell
npm ci
npm test
npm run lint
$env:VITE_BASE_PATH='/private-vault-app/'; npm run build
npm run dev
```

## Deployment Notes

The GitHub repository name controls the GitHub Pages base path. If the repo name changes, update:

- `.github/workflows/deploy-pages.yml`
- `README.md`
- any local build command examples

Current GitHub Pages path:

```text
https://rosulaurentiu.github.io/private-vault-app/
```

Intended neutral repository/Page name when GitHub settings are updated: `wallet-console`.

## Things To Avoid

- Do not reintroduce old Private Vault contract logic into this app.
- Do not move archived contracts back into the active app.
- Do not weaken `assertAllowedPlan` or `assertAllowedRebalancePlan`.
- Do not add bridge steps to arb plans.
- Do not remove tests around transaction guards when changing signing logic.
- Do not rename the public-facing project back to anything containing `arb`, `arbitrage`, `trade`, `trader`, or token pair names unless the user explicitly asks.
