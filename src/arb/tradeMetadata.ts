import { formatUnits, parseUnits } from "ethers";
import type { TokenAmountMetadata, TradeStepMetadata } from "./types";

export function exactTokenDisplay(raw: bigint | string, decimals: number): string {
  const formatted = formatUnits(BigInt(raw), decimals);
  return formatted.includes(".") ? formatted.replace(/\.?0+$/, "") : formatted;
}

export function tokenAmountMetadata(address: string, symbol: string, decimals: number, raw: bigint | string): TokenAmountMetadata {
  const rawString = BigInt(raw).toString();
  return {
    address,
    decimals,
    display: exactTokenDisplay(rawString, decimals),
    raw: rawString,
    symbol,
  };
}

export function decimalStringToRaw(value: number | string, decimals: number): bigint {
  const [whole, fraction = ""] = String(value).split(".");
  const normalizedWhole = whole || "0";
  const normalizedFraction = fraction.slice(0, decimals);
  return parseUnits(normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole, decimals);
}

export function tradeSummaryText(trade: TradeStepMetadata): string {
  if (trade.action === "approve") {
    return `Approve ${trade.source.display} ${trade.source.symbol} for ${trade.protocol}.`;
  }
  if (trade.action === "bridge") {
    return `Bridge ${trade.source.display} ${trade.source.symbol}.`;
  }
  const minText = trade.minTarget ? `, min receives ${trade.minTarget.display} ${trade.minTarget.symbol}` : "";
  return `${trade.protocol} sells ${trade.source.display} ${trade.source.symbol}${minText}.`;
}
