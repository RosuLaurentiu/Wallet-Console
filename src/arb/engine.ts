import { ChainCache } from "@bancor/carbon-sdk/chain-cache";
import { ContractsApi } from "@bancor/carbon-sdk/contracts-api";
import { Toolkit } from "@bancor/carbon-sdk/strategy-management";
import { Contract, Interface, JsonRpcProvider, formatEther, formatUnits, getAddress } from "ethers";
import { ERC20_ABI, UNISWAP_FACTORY_ABI, UNISWAP_ROUTER_ABI } from "./abis";
import { APP_CONFIG, NATIVE_COTI, ZERO_ADDRESS } from "./config";
import { assertAllowedPlan } from "./guards";
import type {
  AllowanceState,
  CarbonContext,
  Direction,
  Opportunity,
  PairId,
  PreparedPlan,
  PreparedStep,
  TokenBalance,
  WalletState,
} from "./types";
import {
  cleanAmount,
  gasWithBuffer,
  hexValue,
  isNativeToken,
  minOutRaw,
  normalizeAddress,
  parseTokenAmount,
  sameAddress,
} from "./utils";

const erc20Interface = new Interface(ERC20_ABI);
const routerInterface = new Interface(UNISWAP_ROUTER_ABI);
const ethProvider = new JsonRpcProvider(APP_CONFIG.ethRpcUrl);
const cotiProvider = new JsonRpcProvider(APP_CONFIG.cotiRpcUrl);

function token(provider: JsonRpcProvider, address: string): Contract {
  return new Contract(address, ERC20_ABI, provider);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

function normalizeSeedData(seedData: unknown): { latestBlockNumber: number; pairs: Array<{ fee?: number; pair: [string, string]; strategies: unknown[] }> } {
  const record = seedData as Record<string, unknown>;
  const rawPairs = Array.isArray(record.pairs)
    ? record.pairs
    : Array.isArray(record.data)
      ? record.data
      : Array.isArray(record.results)
        ? record.results
        : [];
  const pairs = rawPairs.flatMap((item): Array<{ fee?: number; pair: [string, string]; strategies: unknown[] }> => {
    const entry = item as Record<string, unknown>;
    const pair = Array.isArray(entry.pair) ? entry.pair : Array.isArray(entry.tokens) ? entry.tokens : null;
    const strategies = Array.isArray(entry.strategies) ? entry.strategies : Array.isArray(entry.orders) ? entry.orders : [];
    if (!pair || pair.length < 2) return [];
    return [{
      fee: Number(entry.fee ?? entry.tradingFeePPM ?? entry.tradingFee),
      pair: [String(pair[0]), String(pair[1])],
      strategies,
    }];
  });
  return {
    latestBlockNumber: Number(record.latestBlockNumber || record.blockNumber || record.block || 0),
    pairs,
  };
}

let carbonContextPromise: Promise<CarbonContext> | null = null;

export async function fetchCarbonContext(): Promise<CarbonContext> {
  if (carbonContextPromise) return carbonContextPromise;
  carbonContextPromise = (async () => {
    const [seedData, tokens] = await Promise.all([
      fetchJson<unknown>(`${APP_CONFIG.carbonApiBase}/v1/${APP_CONFIG.carbonExchangeId}/seed-data?page=0&pageSize=0`),
      fetchJson<Array<{ address: string; decimals: number; symbol: string }>>(`${APP_CONFIG.carbonApiBase}/v1/${APP_CONFIG.carbonExchangeId}/tokens`),
    ]);
    const normalized = normalizeSeedData(seedData);
    const cache = new ChainCache();
    cache.bulkAddPairs(normalized.pairs.map((item) => ({ pair: item.pair, strategies: item.strategies })) as never);
    for (const item of normalized.pairs) {
      if (Number.isFinite(item.fee)) cache.addPairFees(item.pair[0], item.pair[1], Number(item.fee));
    }
    cache.applyEvents([], normalized.latestBlockNumber);

    const decimalsMap = new Map(tokens.map((item) => [item.address.toLowerCase(), Number(item.decimals)]));
    const coti = tokens.find((item) => item.symbol.toLowerCase() === "coti");
    const gcoti = tokens.find((item) => item.symbol.toLowerCase() === "gcoti");
    const usdc = tokens.find((item) => item.symbol.toLowerCase() === "usdce" || sameAddress(item.address, "0xf1Feebc4376c68B7003450ae66343Ae59AB37D3C"));
    if (!coti || !gcoti || !usdc) throw new Error("Carbon token list did not include COTI, gCOTI, and USDCe.");

    const api = new ContractsApi(cotiProvider, { carbonControllerAddress: APP_CONFIG.carbonController });
    const sdk = new Toolkit(api, cache, async (address: string) => {
      const decimals = decimalsMap.get(address.toLowerCase());
      if (decimals === undefined) throw new Error(`Missing Carbon decimals for ${address}`);
      return decimals;
    });
    return {
      sdk,
      cotiAddress: getAddress(coti.address),
      gcotiAddress: getAddress(gcoti.address),
      usdcAddress: getAddress(usdc.address),
    } as unknown as CarbonContext;
  })();
  return carbonContextPromise;
}

async function tokenBalance(provider: JsonRpcProvider, owner: string, address: string, fallbackSymbol: string): Promise<TokenBalance> {
  if (isNativeToken(address)) {
    const raw = await provider.getBalance(owner);
    return { address, decimals: 18, raw: raw.toString(), symbol: fallbackSymbol, value: Number(formatEther(raw)) };
  }
  const contract = token(provider, address);
  const [raw, decimals, symbol] = await Promise.all([
    contract.balanceOf(owner) as Promise<bigint>,
    contract.decimals().then(Number) as Promise<number>,
    contract.symbol().catch(() => fallbackSymbol) as Promise<string>,
  ]);
  return { address, decimals, raw: raw.toString(), symbol, value: Number(formatUnits(raw, decimals)) };
}

async function allowance(provider: JsonRpcProvider, owner: string, tokenAddress: string, spender: string, decimals: number): Promise<AllowanceState> {
  if (isNativeToken(tokenAddress)) return { native: true, raw: null, value: Number.POSITIVE_INFINITY };
  const raw = await token(provider, tokenAddress).allowance(owner, spender) as bigint;
  return { raw: raw.toString(), value: Number(formatUnits(raw, decimals)) };
}

export async function loadWalletState(walletAddress: string): Promise<WalletState> {
  const owner = normalizeAddress(walletAddress, "wallet");
  const carbon = await fetchCarbonContext();
  const [ethNative, ethCoti, ethGcoti, ethUsdc, cotiNative, carbonGcoti, carbonUsdc] = await Promise.all([
    tokenBalance(ethProvider, owner, NATIVE_COTI, "ETH"),
    tokenBalance(ethProvider, owner, APP_CONFIG.uniswap.coti, "COTI"),
    tokenBalance(ethProvider, owner, APP_CONFIG.uniswap.gcoti, "gCOTI"),
    tokenBalance(ethProvider, owner, APP_CONFIG.uniswap.usdc, "USDC"),
    tokenBalance(cotiProvider, owner, NATIVE_COTI, "COTI"),
    tokenBalance(cotiProvider, owner, carbon.gcotiAddress, "gCOTI"),
    tokenBalance(cotiProvider, owner, carbon.usdcAddress, "USDCe"),
  ]);
  const carbonCoti: TokenBalance = { ...cotiNative, address: carbon.cotiAddress, symbol: "COTI" };
  const [ethCotiAllowance, ethGcotiAllowance, ethUsdcAllowance, carbonGcotiAllowance, carbonUsdcAllowance] = await Promise.all([
    allowance(ethProvider, owner, APP_CONFIG.uniswap.coti, APP_CONFIG.uniswap.router, ethCoti.decimals),
    allowance(ethProvider, owner, APP_CONFIG.uniswap.gcoti, APP_CONFIG.uniswap.router, ethGcoti.decimals),
    allowance(ethProvider, owner, APP_CONFIG.uniswap.usdc, APP_CONFIG.uniswap.router, ethUsdc.decimals),
    allowance(cotiProvider, owner, carbon.gcotiAddress, APP_CONFIG.carbonController, carbonGcoti.decimals),
    allowance(cotiProvider, owner, carbon.usdcAddress, APP_CONFIG.carbonController, carbonUsdc.decimals),
  ]);
  return {
    owner,
    balances: {
      ethereum: { native: ethNative, tokens: { coti: ethCoti, gcoti: ethGcoti, usdc: ethUsdc } },
      coti: { native: cotiNative, tokens: { coti: carbonCoti, gcoti: carbonGcoti, usdc: carbonUsdc } },
    },
    allowances: {
      ethereum: { coti: ethCotiAllowance, gcoti: ethGcotiAllowance, usdc: ethUsdcAllowance },
      coti: { coti: { native: true, raw: null, value: Number.POSITIVE_INFINITY }, gcoti: carbonGcotiAllowance, usdc: carbonUsdcAllowance },
    },
    carbon,
  };
}

async function prices(): Promise<{ cotiUsd: number | null; ethUsd: number | null }> {
  const [coti, eth] = await Promise.all([
    fetchJson<{ coti?: { usd?: number } }>(APP_CONFIG.cotiUsdPriceApi).catch(() => null),
    fetchJson<{ ethereum?: { usd?: number } }>(APP_CONFIG.ethUsdPriceApi).catch(() => null),
  ]);
  return {
    cotiUsd: Number(coti?.coti?.usd) || null,
    ethUsd: Number(eth?.ethereum?.usd) || null,
  };
}

async function uniswapPath(pairId: PairId, direction: Direction): Promise<string[]> {
  if (pairId === "coti-gcoti") {
    return direction === "buy_on_uniswap_sell_on_carbon"
      ? [APP_CONFIG.uniswap.coti, APP_CONFIG.uniswap.gcoti]
      : [APP_CONFIG.uniswap.gcoti, APP_CONFIG.uniswap.coti];
  }
  const source = direction === "buy_on_uniswap_sell_on_carbon" ? APP_CONFIG.uniswap.usdc : APP_CONFIG.uniswap.coti;
  const target = direction === "buy_on_uniswap_sell_on_carbon" ? APP_CONFIG.uniswap.coti : APP_CONFIG.uniswap.usdc;
  const factory = new Contract(APP_CONFIG.uniswap.factory, UNISWAP_FACTORY_ABI, ethProvider);
  const direct = await factory.getPair(APP_CONFIG.uniswap.coti, APP_CONFIG.uniswap.usdc) as string;
  if (!sameAddress(direct, ZERO_ADDRESS)) return [source, target];
  return direction === "buy_on_uniswap_sell_on_carbon"
    ? [APP_CONFIG.uniswap.usdc, APP_CONFIG.uniswap.weth, APP_CONFIG.uniswap.coti]
    : [APP_CONFIG.uniswap.coti, APP_CONFIG.uniswap.weth, APP_CONFIG.uniswap.usdc];
}

async function uniswapOut(amount: number, sourceDecimals: number, path: string[]): Promise<number> {
  if (amount <= 0) return 0;
  const router = new Contract(APP_CONFIG.uniswap.router, UNISWAP_ROUTER_ABI, ethProvider);
  const amounts = await router.getAmountsOut(parseTokenAmount(amount, sourceDecimals), path) as bigint[];
  const outputToken = path[path.length - 1];
  const output = sameAddress(outputToken, APP_CONFIG.uniswap.coti)
    ? { decimals: 18 }
    : sameAddress(outputToken, APP_CONFIG.uniswap.gcoti)
      ? { decimals: 18 }
      : { decimals: 6 };
  return Number(formatUnits(amounts[amounts.length - 1], output.decimals));
}

async function carbonOut(carbon: CarbonContext, sourceToken: string, targetToken: string, amount: number): Promise<number> {
  if (amount <= 0) return 0;
  const quote = await carbon.sdk.getTradeData(sourceToken, targetToken, cleanAmount(amount), false);
  return Number(quote.totalTargetAmount || 0);
}

function sourceInfo(state: WalletState, pairId: PairId, direction: Direction) {
  if (pairId === "coti-gcoti") {
    return direction === "buy_on_uniswap_sell_on_carbon"
      ? { source: state.balances.ethereum.tokens.coti, opposite: state.balances.coti.tokens.gcoti }
      : { source: state.balances.coti.tokens.coti, opposite: state.balances.ethereum.tokens.gcoti };
  }
  return direction === "buy_on_uniswap_sell_on_carbon"
    ? { source: state.balances.ethereum.tokens.usdc, opposite: state.balances.coti.tokens.coti }
    : { source: state.balances.coti.tokens.usdc, opposite: state.balances.ethereum.tokens.coti };
}

function uniqueSortedAmounts(values: number[]): number[] {
  return Array.from(new Set(values.map((value) => Number(value.toFixed(6)))))
    .filter((value) => value > 0)
    .sort((a, b) => b - a);
}

function sampleAmounts(max: number, pairId: PairId): number[] {
  const balanceBased = [1, 0.75, 0.5, 0.25, 0.1, 0.05, 0.02].map((fraction) => max * fraction);
  const probes = pairId === "coti-usdc" ? APP_CONFIG.probeUsdcAmounts : APP_CONFIG.probeCotiAmounts;
  return uniqueSortedAmounts([...balanceBased, ...probes]);
}

function balanceBlocker(label: string, required: number, available: number): string | null {
  if (required <= available) return null;
  return `Insufficient ${label}: need ${required.toFixed(4)}, available ${available.toFixed(4)}.`;
}

function firstBlocker(blockers: Array<string | null>, thresholdOk: boolean): string | undefined {
  const balanceIssue = blockers.find((item): item is string => !!item);
  if (balanceIssue) return balanceIssue;
  return thresholdOk ? undefined : "Net profit is below threshold.";
}

async function evaluateCandidate(state: WalletState, pairId: PairId, direction: Direction, amount: number, cotiUsd: number | null, ethUsd: number | null): Promise<Opportunity | null> {
  const route = direction === "buy_on_uniswap_sell_on_carbon" ? "Uniswap -> Carbon" : "Carbon -> Uniswap";
  const path = await uniswapPath(pairId, direction);
  const gasUsd = ethUsd ? (250000 * 20e-9 * ethUsd) + ((cotiUsd || 0) * 350000 * 1e-9) : 0;

  if (pairId === "coti-gcoti") {
    if (direction === "buy_on_uniswap_sell_on_carbon") {
      const gcoti = await uniswapOut(amount, state.balances.ethereum.tokens.coti.decimals, path);
      const out = await carbonOut(state.carbon, state.carbon.gcotiAddress, state.carbon.cotiAddress, gcoti);
      const gross = out - amount;
      const grossUsd = gross * (cotiUsd || 0);
      return makeOpportunity(pairId, direction, route, amount, "COTI", gcoti, "gCOTI", out, "COTI", gross, "COTI", grossUsd, gasUsd, [
        balanceBlocker("Ethereum COTI", amount, state.balances.ethereum.tokens.coti.value),
        balanceBlocker("COTI-chain gCOTI", gcoti, state.balances.coti.tokens.gcoti.value),
      ]);
    }
    const gcoti = await carbonOut(state.carbon, state.carbon.cotiAddress, state.carbon.gcotiAddress, amount);
    const out = await uniswapOut(gcoti, state.balances.ethereum.tokens.gcoti.decimals, path);
    const gross = out - amount;
    const grossUsd = gross * (cotiUsd || 0);
    return makeOpportunity(pairId, direction, route, amount, "COTI", gcoti, "gCOTI", out, "COTI", gross, "COTI", grossUsd, gasUsd, [
      balanceBlocker("COTI-chain COTI", amount, state.balances.coti.tokens.coti.value),
      balanceBlocker("Ethereum gCOTI", gcoti, state.balances.ethereum.tokens.gcoti.value),
    ]);
  }

  if (direction === "buy_on_uniswap_sell_on_carbon") {
    const coti = await uniswapOut(amount, state.balances.ethereum.tokens.usdc.decimals, path);
    const out = await carbonOut(state.carbon, state.carbon.cotiAddress, state.carbon.usdcAddress, coti);
    const gross = out - amount;
    return makeOpportunity(pairId, direction, route, amount, "USDC", coti, "COTI", out, "USDCe", gross, "USDC", gross, gasUsd, [
      balanceBlocker("Ethereum USDC", amount, state.balances.ethereum.tokens.usdc.value),
      balanceBlocker("COTI-chain COTI", coti, state.balances.coti.tokens.coti.value),
    ]);
  }
  const coti = await carbonOut(state.carbon, state.carbon.usdcAddress, state.carbon.cotiAddress, amount);
  const out = await uniswapOut(coti, state.balances.ethereum.tokens.coti.decimals, path);
  const gross = out - amount;
  return makeOpportunity(pairId, direction, route, amount, "USDCe", coti, "COTI", out, "USDC", gross, "USDC", gross, gasUsd, [
    balanceBlocker("COTI-chain USDCe", amount, state.balances.coti.tokens.usdc.value),
    balanceBlocker("Ethereum COTI", coti, state.balances.ethereum.tokens.coti.value),
  ]);
}

function makeOpportunity(
  pairId: PairId,
  direction: Direction,
  route: Opportunity["route"],
  inputAmount: number,
  inputSymbol: string,
  bridgeOutputAmount: number,
  bridgeOutputSymbol: string,
  outputAmount: number,
  outputSymbol: string,
  profitTokenAmount: number,
  profitTokenSymbol: string,
  grossProfitUsd: number,
  gasUsd: number,
  balanceBlockers: Array<string | null> = [],
): Opportunity {
  const netProfitUsd = grossProfitUsd - gasUsd;
  const thresholdOk = netProfitUsd >= APP_CONFIG.minNetProfitUsd;
  const reason = firstBlocker(balanceBlockers, thresholdOk);
  const warnings = [
    "Uniswap executes first. If Carbon fails, the first transaction remains final.",
  ];
  if (!thresholdOk) warnings.unshift(`Net profit is below $${APP_CONFIG.minNetProfitUsd}.`);
  for (const blocker of balanceBlockers.filter((item): item is string => !!item)) warnings.unshift(blocker);
  return {
    action: direction === "buy_on_uniswap_sell_on_carbon" ? `Buy ${bridgeOutputSymbol} on Uniswap, sell on Carbon` : `Buy ${bridgeOutputSymbol} on Carbon, sell on Uniswap`,
    direction,
    executable: !reason && inputAmount > 0 && outputAmount > 0,
    netProfitUsd,
    pairId,
    pairLabel: pairId === "coti-gcoti" ? "COTI/gCOTI" : "COTI/USDC",
    reason,
    route,
    summary: { inputAmount, inputSymbol, bridgeOutputAmount, bridgeOutputSymbol, outputAmount, outputSymbol, grossProfitUsd, gasUsd, profitTokenAmount, profitTokenSymbol },
    warnings,
  };
}

async function bestOpportunity(state: WalletState, pairId: PairId, direction: Direction, cotiUsd: number | null, ethUsd: number | null): Promise<Opportunity | null> {
  const { source } = sourceInfo(state, pairId, direction);
  const max = source.value;
  let best: Opportunity | null = null;
  for (const amount of sampleAmounts(max, pairId)) {
    const candidate = await evaluateCandidate(state, pairId, direction, amount, cotiUsd, ethUsd).catch(() => null);
    if (!candidate) continue;
    if (!best) {
      best = candidate;
      continue;
    }
    if (candidate.executable !== best.executable) {
      if (candidate.executable) best = candidate;
      continue;
    }
    if (candidate.netProfitUsd > best.netProfitUsd) best = candidate;
  }
  return best;
}

export async function buildQuote(walletAddress: string) {
  const state = await loadWalletState(walletAddress);
  const price = await prices();
  const settled = await Promise.all([
    bestOpportunity(state, "coti-gcoti", "buy_on_uniswap_sell_on_carbon", price.cotiUsd, price.ethUsd),
    bestOpportunity(state, "coti-gcoti", "buy_on_carbon_sell_on_uniswap", price.cotiUsd, price.ethUsd),
    bestOpportunity(state, "coti-usdc", "buy_on_uniswap_sell_on_carbon", price.cotiUsd, price.ethUsd),
    bestOpportunity(state, "coti-usdc", "buy_on_carbon_sell_on_uniswap", price.cotiUsd, price.ethUsd),
  ]);
  const byPair: Opportunity[] = (["coti-gcoti", "coti-usdc"] as PairId[]).map((pairId) => {
    const pairBest = settled.filter((item): item is Opportunity => !!item && item.pairId === pairId).sort((a, b) => {
      if (a.executable !== b.executable) return a.executable ? -1 : 1;
      return b.netProfitUsd - a.netProfitUsd;
    })[0];
    return pairBest || {
      action: "No quote",
      direction: "buy_on_uniswap_sell_on_carbon",
      executable: false,
      netProfitUsd: 0,
      pairId,
      pairLabel: pairId === "coti-gcoti" ? "COTI/gCOTI" : "COTI/USDC",
      reason: "No executable route found for current balances.",
      route: "Uniswap -> Carbon",
      summary: { inputAmount: 0, inputSymbol: "-", bridgeOutputAmount: 0, bridgeOutputSymbol: "-", outputAmount: 0, outputSymbol: "-", grossProfitUsd: 0, gasUsd: 0, profitTokenAmount: 0, profitTokenSymbol: "-" },
      warnings: ["No executable route found for current balances."],
    };
  });
  return {
    generatedAtUtc: new Date().toISOString(),
    wallet: state.owner,
    balances: state.balances,
    allowances: state.allowances,
    opportunities: byPair,
    prices: price,
  };
}

async function approvalStep(args: {
  allowance: AllowanceState;
  amountRaw: bigint;
  chain: "ethereum" | "coti";
  from: string;
  label: string;
  provider: JsonRpcProvider;
  spender: string;
  tokenAddress: string;
  tokenSymbol: string;
}): Promise<PreparedStep | null> {
  if (isNativeToken(args.tokenAddress)) return null;
  if (BigInt(args.allowance.raw || 0) >= args.amountRaw) return null;
  const data = erc20Interface.encodeFunctionData("approve", [args.spender, args.amountRaw]);
  const gas = await args.provider.estimateGas({ from: args.from, to: args.tokenAddress, data, value: 0 }).then((estimate) => gasWithBuffer(estimate, APP_CONFIG.gasLimitBufferBps)).catch(() => null);
  return {
    chain: args.chain,
    description: `Allow ${args.label} to spend ${args.tokenSymbol}.`,
    index: 0,
    label: `Approve ${args.tokenSymbol}`,
    token: args.tokenSymbol,
    tx: { from: args.from, to: args.tokenAddress, data, value: "0x0", ...(gas ? { gas: hexValue(gas) } : {}) },
    type: "approval",
  };
}

async function buildUniswapSteps(state: WalletState, opportunity: Opportunity): Promise<PreparedStep[]> {
  const path = await uniswapPath(opportunity.pairId, opportunity.direction);
  const sourceToken = path[0];
  const sourceKey = sameAddress(sourceToken, APP_CONFIG.uniswap.coti) ? "coti" : sameAddress(sourceToken, APP_CONFIG.uniswap.gcoti) ? "gcoti" : "usdc";
  const sourceInfo = state.balances.ethereum.tokens[sourceKey];
  const amountIn = parseTokenAmount(opportunity.summary.inputAmount, sourceInfo.decimals);
  const router = new Contract(APP_CONFIG.uniswap.router, UNISWAP_ROUTER_ABI, ethProvider);
  const amounts = await router.getAmountsOut(amountIn, path) as bigint[];
  const deadline = Math.floor(Date.now() / 1000) + APP_CONFIG.deadlineSec;
  const data = routerInterface.encodeFunctionData("swapExactTokensForTokens", [
    amountIn,
    minOutRaw(amounts[amounts.length - 1], APP_CONFIG.slippageBps),
    path,
    state.owner,
    String(deadline),
  ]);
  const approval = await approvalStep({
    allowance: state.allowances.ethereum[sourceKey],
    amountRaw: amountIn,
    chain: "ethereum",
    from: state.owner,
    label: "Uniswap",
    provider: ethProvider,
    spender: APP_CONFIG.uniswap.router,
    tokenAddress: sourceToken,
    tokenSymbol: sourceInfo.symbol,
  });
  const gas = await ethProvider.estimateGas({ from: state.owner, to: APP_CONFIG.uniswap.router, data, value: 0 }).then((estimate) => gasWithBuffer(estimate, APP_CONFIG.gasLimitBufferBps)).catch(() => null);
  return [approval, {
    chain: "ethereum",
    description: `${opportunity.action}. Minimum output includes ${APP_CONFIG.slippageBps / 100}% slippage.`,
    index: 0,
    label: "Uniswap swap",
    token: sourceInfo.symbol,
    tx: { from: state.owner, to: APP_CONFIG.uniswap.router, data, value: "0x0", ...(gas ? { gas: hexValue(gas) } : {}) },
    type: "uniswap-swap" as const,
  }].filter(Boolean) as PreparedStep[];
}

function carbonLeg(state: WalletState, opportunity: Opportunity) {
  const carbon = state.carbon;
  if (opportunity.pairId === "coti-usdc") {
    return opportunity.direction === "buy_on_uniswap_sell_on_carbon"
      ? { amount: opportunity.summary.bridgeOutputAmount, key: "coti" as const, source: carbon.cotiAddress, target: carbon.usdcAddress, symbol: "COTI" }
      : { amount: opportunity.summary.inputAmount, key: "usdc" as const, source: carbon.usdcAddress, target: carbon.cotiAddress, symbol: "USDCe" };
  }
  return opportunity.direction === "buy_on_uniswap_sell_on_carbon"
    ? { amount: opportunity.summary.bridgeOutputAmount, key: "gcoti" as const, source: carbon.gcotiAddress, target: carbon.cotiAddress, symbol: "gCOTI" }
    : { amount: opportunity.summary.inputAmount, key: "coti" as const, source: carbon.cotiAddress, target: carbon.gcotiAddress, symbol: "COTI" };
}

async function buildCarbonSteps(state: WalletState, opportunity: Opportunity): Promise<PreparedStep[]> {
  const leg = carbonLeg(state, opportunity);
  const sourceInfo = state.balances.coti.tokens[leg.key];
  const amountRaw = parseTokenAmount(leg.amount, sourceInfo.decimals);
  const quote = await state.carbon.sdk.getTradeData(leg.source, leg.target, cleanAmount(leg.amount), false);
  if (!quote.tradeActions?.length || Number(quote.totalTargetAmount) <= 0) throw new Error("Carbon quote returned no trade actions.");
  const minReturn = cleanAmount(Number(quote.totalTargetAmount) * (1 - APP_CONFIG.slippageBps / 10000));
  const deadline = Math.floor(Date.now() / 1000) + APP_CONFIG.deadlineSec;
  const txRequest = await state.carbon.sdk.composeTradeBySourceTransaction(leg.source, leg.target, quote.tradeActions, deadline, minReturn);
  const nativeValue = isNativeToken(leg.source) ? amountRaw : BigInt(txRequest.value || 0);
  const approval = await approvalStep({
    allowance: state.allowances.coti[leg.key],
    amountRaw,
    chain: "coti",
    from: state.owner,
    label: "Carbon",
    provider: cotiProvider,
    spender: APP_CONFIG.carbonController,
    tokenAddress: leg.source,
    tokenSymbol: leg.symbol,
  });
  const data = txRequest.data || "0x";
  const to = getAddress(String(txRequest.to || APP_CONFIG.carbonController));
  const gas = await cotiProvider.estimateGas({ from: state.owner, to, data, value: nativeValue }).then((estimate) => gasWithBuffer(estimate, APP_CONFIG.gasLimitBufferBps)).catch(() => null);
  return [approval, {
    chain: "coti",
    description: `${opportunity.action}. Minimum return includes ${APP_CONFIG.slippageBps / 100}% slippage.`,
    index: 0,
    label: "Carbon swap",
    token: leg.symbol,
    tx: { from: state.owner, to, data, value: hexValue(nativeValue), ...(gas ? { gas: hexValue(gas) } : {}) },
    type: "carbon-swap" as const,
  }].filter(Boolean) as PreparedStep[];
}

export async function preparePlan(walletAddress: string, pairId: PairId): Promise<PreparedPlan> {
  const state = await loadWalletState(walletAddress);
  const quote = await buildQuote(walletAddress);
  const opportunity = quote.opportunities.find((item) => item.pairId === pairId);
  if (!opportunity) throw new Error(`Unknown pair ${pairId}.`);
  if (!opportunity.executable) throw new Error(opportunity.reason || `${opportunity.pairLabel} is not executable.`);
  const [uniswap, carbon] = await Promise.all([
    buildUniswapSteps(state, opportunity),
    buildCarbonSteps(state, opportunity),
  ]);
  const steps = [...uniswap, ...carbon].map((step, index) => ({ ...step, index: index + 1 }));
  assertAllowedPlan(steps, [state.carbon.cotiAddress, state.carbon.gcotiAddress, state.carbon.usdcAddress]);
  return {
    generatedAtUtc: new Date().toISOString(),
    opportunity,
    pairId,
    steps,
    wallet: state.owner,
    warning: "Uniswap signs first. If the Carbon transaction fails or is rejected, the first transaction remains final.",
  };
}

export function assertNoBridge(plan: PreparedPlan): void {
  if (plan.steps.some((step) => !["approval", "uniswap-swap", "carbon-swap"].includes(step.type))) {
    throw new Error("Prepared plan includes an unsupported non-DEX step.");
  }
}
