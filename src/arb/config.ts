import { getAddress } from "ethers";

export const NATIVE_COTI = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const APP_CONFIG = {
  allowedWallet: getAddress("0x5DFcEe20b5a3FDd3577436A32f62d4C0b39e979d"),
  carbonApiBase: "https://api.carbondefi.xyz",
  carbonExchangeId: "coti",
  carbonController: getAddress(import.meta.env.VITE_CARBON_CONTROLLER_ADDRESS || "0x59f21012B2E9BA67ce6a7605E74F945D0D4C84EA"),
  cotiUsdPriceApi: "https://api.coingecko.com/api/v3/simple/price?ids=coti&vs_currencies=usd",
  ethUsdPriceApi: "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
  ethRpcUrl: import.meta.env.VITE_ETH_RPC_URL || "https://ethereum.publicnode.com",
  cotiRpcUrl: import.meta.env.VITE_COTI_RPC_URL || "https://mainnet.coti.io/rpc",
  slippageBps: Number(import.meta.env.VITE_ARB_SLIPPAGE_BPS || 100),
  minNetProfitUsd: Number(import.meta.env.VITE_ARB_MIN_NET_PROFIT_USD || 10),
  deadlineSec: Number(import.meta.env.VITE_ARB_DEADLINE_SEC || 120),
  gasLimitBufferBps: Number(import.meta.env.VITE_ARB_GAS_LIMIT_BUFFER_BPS || 5000),
  uniswap: {
    router: getAddress("0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"),
    factory: getAddress("0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"),
    coti: getAddress("0xddb3422497e61e13543bea06989c0789117555c5"),
    gcoti: getAddress("0xaf2ca40d3fc4459436d11b94d21fa4b8a89fb51d"),
    usdc: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
    weth: getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
  },
  ethereum: {
    chainId: 1,
    chainIdHex: "0x1",
    label: "Ethereum",
    explorer: "https://etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  coti: {
    chainId: 2632500,
    chainIdHex: "0x282b34",
    label: "COTI Mainnet",
    explorer: "https://mainnet.cotiscan.io",
    nativeCurrency: { name: "COTI", symbol: "COTI", decimals: 18 },
  },
} as const;

export type AppConfig = typeof APP_CONFIG;
