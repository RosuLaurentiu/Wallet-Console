export type PairId = "coti-gcoti" | "coti-usdc";
export type ChainKey = "ethereum" | "coti";
export type StepType = "approval" | "uniswap-swap" | "carbon-swap";
export type Direction = "buy_on_uniswap_sell_on_carbon" | "buy_on_carbon_sell_on_uniswap";

export interface TokenBalance {
  address: string;
  decimals: number;
  raw: string;
  symbol: string;
  value: number;
}

export interface AllowanceState {
  native?: boolean;
  raw: string | null;
  value: number;
}

export interface WalletBalances {
  ethereum: {
    native: TokenBalance;
    tokens: Record<"coti" | "gcoti" | "usdc", TokenBalance>;
  };
  coti: {
    native: TokenBalance;
    tokens: Record<"coti" | "gcoti" | "usdc", TokenBalance>;
  };
}

export interface WalletAllowances {
  ethereum: Record<"coti" | "gcoti" | "usdc", AllowanceState>;
  coti: Record<"coti" | "gcoti" | "usdc", AllowanceState>;
}

export interface CarbonContext {
  sdk: {
    getTradeData(sourceToken: string, targetToken: string, amount: string, byTarget?: boolean): Promise<{
      tradeActions?: unknown[];
      totalSourceAmount: string;
      totalTargetAmount: string;
    }>;
    composeTradeBySourceTransaction(
      sourceToken: string,
      targetToken: string,
      tradeActions: unknown[],
      deadline: number | string,
      minReturn: string
    ): Promise<{ to?: string; data?: string; value?: bigint | string | number }>;
  };
  cotiAddress: string;
  gcotiAddress: string;
  usdcAddress: string;
}

export interface WalletState {
  owner: string;
  balances: WalletBalances;
  allowances: WalletAllowances;
  carbon: CarbonContext;
}

export interface Opportunity {
  action: string;
  direction: Direction;
  executable: boolean;
  netProfitUsd: number;
  pairId: PairId;
  pairLabel: string;
  reason?: string;
  route: "Uniswap -> Carbon" | "Carbon -> Uniswap";
  summary: {
    inputSymbol: string;
    inputAmount: number;
    bridgeOutputSymbol: string;
    bridgeOutputAmount: number;
    outputSymbol: string;
    outputAmount: number;
    grossProfitUsd: number;
    gasUsd: number;
    profitTokenAmount: number;
    profitTokenSymbol: string;
  };
  warnings: string[];
}

export interface QuoteResult {
  generatedAtUtc: string;
  wallet: string;
  balances: WalletBalances;
  allowances: WalletAllowances;
  opportunities: Opportunity[];
  prices: { cotiUsd: number | null; ethUsd: number | null };
}

export interface PreparedStep {
  chain: ChainKey;
  description: string;
  index: number;
  label: string;
  token: string;
  tx: { data: string; from: string; gas?: string; to: string; value: string };
  type: StepType;
}

export interface PreparedPlan {
  generatedAtUtc: string;
  opportunity: Opportunity;
  pairId: PairId;
  steps: PreparedStep[];
  wallet: string;
  warning: string;
}

export interface WalletProvider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
  isBraveWallet?: boolean;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isTrust?: boolean;
}
