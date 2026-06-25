import { describe, expect, it } from "vitest";
import { QUOTE_STALE_MS, quoteReviewWarnings } from "./reviewWarnings";
import type { Opportunity, QuoteResult } from "./types";

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    action: "Buy gCOTI on Carbon, sell on Uniswap",
    direction: "buy_on_carbon_sell_on_uniswap",
    estimatedFeesUsd: 2,
    executable: true,
    netProfitAfterFeesUsd: 18,
    netProfitUsd: 20,
    pairId: "coti-gcoti",
    pairLabel: "COTI/gCOTI",
    route: "Carbon -> Uniswap",
    summary: {
      bridgeOutputAmount: 4300,
      bridgeOutputSymbol: "gCOTI",
      gasUsd: 2,
      grossProfitUsd: 20,
      inputAmount: 1000,
      inputSymbol: "COTI",
      outputAmount: 1020,
      outputSymbol: "COTI",
      profitTokenAmount: 20,
      profitTokenSymbol: "COTI",
    },
    warnings: [],
    ...overrides,
  };
}

function quote(displayed: Opportunity, generatedAtUtc = new Date(0).toISOString()): QuoteResult {
  return {
    allowances: {},
    balances: {},
    generatedAtUtc,
    opportunities: [displayed],
    prices: { cotiUsd: null, ethUsd: null },
    rebalance: { executable: false, suggestions: [] },
    wallet: "0xWallet",
  } as unknown as QuoteResult;
}

describe("quote review warnings", () => {
  it("marks displayed quotes stale after ninety seconds", () => {
    const displayed = opportunity();
    const warnings = quoteReviewWarnings(
      quote(displayed, new Date(1_000).toISOString()),
      displayed,
      1_000 + QUOTE_STALE_MS + 1,
    );
    expect(warnings.some((warning) => warning.code === "stale-quote")).toBe(true);
  });

  it("warns when prepared amounts drift by more than one percent", () => {
    const displayed = opportunity();
    const prepared = opportunity({
      summary: {
        ...displayed.summary,
        bridgeOutputAmount: 4350,
      },
    });
    const warnings = quoteReviewWarnings(quote(displayed, new Date(0).toISOString()), prepared, 1_000);
    expect(warnings).toEqual([
      {
        code: "quote-drift",
        message: "Intermediate amount changed by 1.16% since the displayed quote.",
      },
    ]);
  });

  it("does not warn at the one percent drift threshold", () => {
    const displayed = opportunity();
    const prepared = opportunity({
      netProfitAfterFeesUsd: 18.18,
      summary: {
        ...displayed.summary,
        inputAmount: 1010,
      },
    });
    const warnings = quoteReviewWarnings(quote(displayed, new Date(0).toISOString()), prepared, 1_000);
    expect(warnings).toEqual([]);
  });
});
