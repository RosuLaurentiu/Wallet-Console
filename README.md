# COTI Arbitrage Signer

Private browser-wallet tool for manually signing COTI arbitrage transactions.

The app is static and deploys to GitHub Pages. It does not use a VPS API, does not receive private keys, and does not sign anything itself. The connected wallet signs every transaction through `eth_sendTransaction`.

## What It Does

- Connects MetaMask or CipherTrade/CypherTrade injected wallets.
- Allows only wallet `0x5DFcEe20b5a3FDd3577436A32f62d4C0b39e979d`.
- Quotes both:
  - `COTI/gCOTI`
  - `COTI/USDC`
- Caps opportunities by balances already present on Ethereum and COTI.
- Prepares DEX-only transaction steps:
  - Uniswap approval if needed
  - Uniswap swap
  - Carbon approval if needed
  - Carbon swap
- Never prepares bridge transactions.

## Security Notes

GitHub Pages makes the page publicly reachable if someone knows the URL. The wallet gate blocks use by other wallets, but this is not true private hosting. Use Cloudflare Access or another authenticated host later if the page itself must be private.

The app validates prepared transactions before signing:

- Ethereum swaps must target the configured Uniswap V2 router.
- Ethereum approvals must approve only the Uniswap router.
- COTI swaps must target the configured Carbon controller.
- COTI approvals must approve only the Carbon controller.
- Direct transfers, unknown tokens, unknown spenders, and unexpected native value are rejected.

## Run

```bash
npm install
npm run dev
```

## Checks

```bash
npm run lint
npm test
npm run build
```

## GitHub Pages

Deploy is automated by `.github/workflows/deploy-pages.yml`.

Expected URL:

```text
https://rosulaurentiu.github.io/private-vault-app/
```
