import { describe, expect, it } from "vitest";
import { waitForTransactionReceipt, type ReceiptProvider } from "./receipts";

describe("receipt polling", () => {
  it("returns success when the receipt is mined successfully", async () => {
    const provider: ReceiptProvider = {
      getTransactionReceipt: async () => ({ blockNumber: 123, status: 1 }),
    };
    await expect(waitForTransactionReceipt("ethereum", "0xabc", { provider, timeoutMs: 0 })).resolves.toEqual({
      blockNumber: 123,
      status: "success",
    });
  });

  it("returns failed when the receipt status is reverted", async () => {
    const provider: ReceiptProvider = {
      getTransactionReceipt: async () => ({ blockNumber: 124, status: 0 }),
    };
    await expect(waitForTransactionReceipt("coti", "0xabc", { provider, timeoutMs: 0 })).resolves.toEqual({
      blockNumber: 124,
      status: "failed",
    });
  });

  it("times out when no receipt is available", async () => {
    const provider: ReceiptProvider = {
      getTransactionReceipt: async () => null,
    };
    await expect(waitForTransactionReceipt("ethereum", "0xabc", {
      intervalMs: 0,
      provider,
      timeoutMs: 0,
    })).rejects.toThrow("was not mined");
  });
});
