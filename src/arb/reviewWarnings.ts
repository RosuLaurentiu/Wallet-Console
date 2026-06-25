import type { Opportunity, PreparedPlanWarning, QuoteResult } from "./types";

export const QUOTE_STALE_MS = 90_000;
export const QUOTE_DRIFT_BPS = 100;

function relativeDriftBps(previous: number, current: number): number {
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return 0;
  if (previous === 0) return current === 0 ? 0 : Number.POSITIVE_INFINITY;
  return Math.abs((current - previous) / previous) * 10000;
}

function driftWarning(label: string, previous: number, current: number): PreparedPlanWarning | null {
  const driftBps = relativeDriftBps(previous, current);
  if (driftBps <= QUOTE_DRIFT_BPS) return null;
  const driftPct = Number.isFinite(driftBps) ? (driftBps / 100).toFixed(2) : "new";
  return {
    code: "quote-drift",
    message: `${label} changed by ${driftPct}% since the displayed quote.`,
  };
}

export function quoteReviewWarnings(quote: QuoteResult | null, preparedOpportunity: Opportunity, nowMs = Date.now()): PreparedPlanWarning[] {
  if (!quote) return [];
  const warnings: PreparedPlanWarning[] = [];
  const ageMs = nowMs - Date.parse(quote.generatedAtUtc);
  if (Number.isFinite(ageMs) && ageMs > QUOTE_STALE_MS) {
    warnings.push({
      code: "stale-quote",
      message: `Displayed quote is ${Math.floor(ageMs / 1000)} seconds old.`,
    });
  }
  const displayed = quote.opportunities.find((item) => item.pairId === preparedOpportunity.pairId);
  if (!displayed) return warnings;
  const comparisons: Array<[string, number, number]> = [
    ["Input amount", displayed.summary.inputAmount, preparedOpportunity.summary.inputAmount],
    ["Intermediate amount", displayed.summary.bridgeOutputAmount, preparedOpportunity.summary.bridgeOutputAmount],
    ["Output amount", displayed.summary.outputAmount, preparedOpportunity.summary.outputAmount],
    ["Net after fees", displayed.netProfitAfterFeesUsd, preparedOpportunity.netProfitAfterFeesUsd],
  ];
  for (const [label, previous, current] of comparisons) {
    const warning = driftWarning(label, previous, current);
    if (warning) warnings.push(warning);
  }
  return warnings;
}
