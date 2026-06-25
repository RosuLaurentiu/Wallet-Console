import { describe, expect, it } from "vitest";
import { APP_CONFIG, ZERO_ADDRESS } from "./config";
import { arbLegAmounts, bridgeRouteMetadata } from "./engine";
import type { Opportunity, RebalanceSuggestion } from "./types";

function opportunity(direction: Opportunity["direction"], inputAmount: number, bridgeOutputAmount: number): Pick<Opportunity, "direction" | "summary"> {
  return {
    direction,
    summary: {
      bridgeOutputAmount,
      bridgeOutputSymbol: "gCOTI",
      gasUsd: 0,
      grossProfitUsd: 0,
      inputAmount,
      inputSymbol: "COTI",
      outputAmount: 0,
      outputSymbol: "COTI",
      profitTokenAmount: 0,
      profitTokenSymbol: "COTI",
    },
  };
}

function suggestion(overrides: Partial<RebalanceSuggestion>): RebalanceSuggestion {
  return {
    amount: 10,
    direction: "coti-to-ethereum",
    executable: true,
    sourceBalance: 20,
    sourceChain: "coti",
    targetBalance: 0,
    targetChain: "ethereum",
    token: "coti",
    tokenSymbol: "COTI",
    ...overrides,
  };
}

describe("arb leg amounts", () => {
  it("uses the intermediate amount for COTI/gCOTI Carbon -> Uniswap", () => {
    const amounts = arbLegAmounts(opportunity("buy_on_carbon_sell_on_uniswap", 1000, 4300));
    expect(amounts.carbonSourceAmount).toBe(1000);
    expect(amounts.uniswapSourceAmount).toBe(4300);
  });

  it("uses the intermediate amount for COTI/USDC Carbon -> Uniswap", () => {
    const amounts = arbLegAmounts(opportunity("buy_on_carbon_sell_on_uniswap", 250, 9100));
    expect(amounts.carbonSourceAmount).toBe(250);
    expect(amounts.uniswapSourceAmount).toBe(9100);
  });

  it("covers the observed gCOTI amount regression", () => {
    const amounts = arbLegAmounts(opportunity("buy_on_carbon_sell_on_uniswap", 16896.141944999999, 73246.38350181955));
    expect(amounts.carbonSourceAmount).toBe(16896.141944999999);
    expect(amounts.uniswapSourceAmount).toBe(73246.38350181955);
  });

  it("keeps Uniswap -> Carbon source amounts unchanged", () => {
    const amounts = arbLegAmounts(opportunity("buy_on_uniswap_sell_on_carbon", 500, 1200));
    expect(amounts.uniswapSourceAmount).toBe(500);
    expect(amounts.carbonSourceAmount).toBe(1200);
  });
});

describe("bridge route metadata", () => {
  const carbonGcoti = "0x7637C7838EC4Ec6b85080F28A678F8E234bB83D1";

  it("uses zero address for native COTI from COTI to Ethereum", () => {
    const route = bridgeRouteMetadata(suggestion({ token: "coti", tokenSymbol: "COTI" }), carbonGcoti);
    expect(route.sourceNetworkId).toBe(String(APP_CONFIG.coti.chainId));
    expect(route.destinationNetworkId).toBe(String(APP_CONFIG.ethereum.chainId));
    expect(route.tokenAddress).toBe(ZERO_ADDRESS);
  });

  it("uses the COTI-chain gCOTI address from COTI to Ethereum", () => {
    const route = bridgeRouteMetadata(suggestion({ token: "gcoti", tokenSymbol: "gCOTI" }), carbonGcoti);
    expect(route.tokenAddress).toBe(carbonGcoti);
  });

  it("uses Ethereum token addresses from Ethereum to COTI", () => {
    const route = bridgeRouteMetadata(suggestion({
      direction: "ethereum-to-coti",
      sourceChain: "ethereum",
      targetChain: "coti",
      token: "gcoti",
      tokenSymbol: "gCOTI",
    }), carbonGcoti);
    expect(route.sourceNetworkId).toBe(String(APP_CONFIG.ethereum.chainId));
    expect(route.destinationNetworkId).toBe(String(APP_CONFIG.coti.chainId));
    expect(route.tokenAddress).toBe(APP_CONFIG.uniswap.gcoti);
  });
});
