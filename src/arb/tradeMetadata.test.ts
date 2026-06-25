import { describe, expect, it } from "vitest";
import { decimalStringToRaw, tokenAmountMetadata, tradeSummaryText } from "./tradeMetadata";

describe("trade metadata", () => {
  it("formats exact raw token amounts without rounding", () => {
    const amount = tokenAmountMetadata("0xToken", "gCOTI", 18, "73246383501819550899525");
    expect(amount.display).toBe("73246.383501819550899525");
    expect(amount.raw).toBe("73246383501819550899525");
  });

  it("converts decimal strings to raw units by token decimals", () => {
    expect(decimalStringToRaw("1.23456789", 6)).toBe(1234567n);
    expect(decimalStringToRaw("16896.141944999999", 18)).toBe(16896141944999999000000n);
  });

  it("renders exact review text for swaps, approvals, and bridge transfers", () => {
    const source = tokenAmountMetadata("0xSource", "gCOTI", 18, "73246383501819550899525");
    const minTarget = tokenAmountMetadata("0xTarget", "COTI", 18, "16896141944999999000000");
    expect(tradeSummaryText({ action: "swap", minTarget, protocol: "Uniswap", source })).toBe(
      "Uniswap sells 73246.383501819550899525 gCOTI, min receives 16896.141944999999 COTI.",
    );
    expect(tradeSummaryText({ action: "approve", protocol: "Carbon", source, spender: "0xSpender" })).toBe(
      "Approve 73246.383501819550899525 gCOTI for Carbon.",
    );
    expect(tradeSummaryText({ action: "bridge", protocol: "Bridge", source: minTarget })).toBe(
      "Bridge 16896.141944999999 COTI.",
    );
  });
});
