import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bridgeTrackingItemFromImport,
  bridgeTrackingItemFromStep,
  cleanupBridgeTrackingItems,
  fetchRecentBridgeTrackingItems,
  loadBridgeTrackingItems,
  mergeBridgeTrackingItems,
  normalizeBridgeStatus,
  saveBridgeTrackingItems,
  type BridgeTrackingItem,
  type BridgeTrackingStorage,
} from "./bridgeTracker";
import { APP_CONFIG } from "./config";
import type { BridgeStepMetadata } from "./types";

class MemoryStorage implements BridgeTrackingStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) || null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function item(overrides: Partial<BridgeTrackingItem> = {}): BridgeTrackingItem {
  return {
    amount: 10,
    destinationNetworkId: "2632500",
    hash: "0xabc",
    id: "1:2632500:0xtoken:0xabc",
    sourceChain: "ethereum",
    sourceNetworkId: "1",
    stages: [],
    status: "unknown",
    submittedAtUtc: "2026-06-24T00:00:00.000Z",
    targetChain: "coti",
    tokenAddress: "0xtoken",
    tokenSymbol: "COTI",
    wallet: "0x5DFcEe20b5a3FDd3577436A32f62d4C0b39e979d",
    ...overrides,
  };
}

describe("bridge tracker status", () => {
  it("normalizes official tracker statuses", () => {
    expect(normalizeBridgeStatus("Done")).toBe("done");
    expect(normalizeBridgeStatus("Failed")).toBe("failed");
    expect(normalizeBridgeStatus("In_Progress")).toBe("in_progress");
    expect(normalizeBridgeStatus("Refunded")).toBe("refunded");
    expect(normalizeBridgeStatus("surprise")).toBe("unknown");
  });
});

describe("bridge tracker storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips valid public tracking items", () => {
    const storage = new MemoryStorage();
    const saved = item({ status: "in_progress" });
    saveBridgeTrackingItems([saved], storage);
    expect(loadBridgeTrackingItems(storage)).toEqual([saved]);
  });

  it("returns an empty list for malformed storage data", () => {
    const storage: BridgeTrackingStorage = {
      getItem: () => "{not json",
      removeItem: () => undefined,
      setItem: () => undefined,
    };
    expect(loadBridgeTrackingItems(storage)).toEqual([]);
  });

  it("merges by route and transaction id", () => {
    const first = item({ status: "unknown" });
    const updated = item({ status: "done", updatedAtUtc: "2026-06-24T00:01:00.000Z" });
    expect(mergeBridgeTrackingItems([first], [updated])).toEqual([updated]);
  });

  it("does not overwrite resolved local status with imported unknown status", () => {
    const resolved = item({ status: "done", updatedAtUtc: "2026-06-24T00:01:00.000Z" });
    const imported = item({ status: "unknown", updatedAtUtc: undefined });
    expect(mergeBridgeTrackingItems([resolved], [imported])).toEqual([resolved]);
  });

  it("keeps unresolved entries while cleaning old resolved entries", () => {
    const now = Date.parse("2026-06-25T00:00:00.000Z");
    const unresolvedOld = item({ status: "in_progress", submittedAtUtc: "2026-06-01T00:00:00.000Z" });
    const resolvedOld = item({
      hash: "0xold",
      id: "1:2632500:0xtoken:0xold",
      status: "done",
      updatedAtUtc: "2026-06-17T00:00:00.000Z",
    });
    const resolvedRecent = item({
      hash: "0xrecent",
      id: "1:2632500:0xtoken:0xrecent",
      status: "failed",
      updatedAtUtc: "2026-06-24T00:00:00.000Z",
    });
    expect(cleanupBridgeTrackingItems([unresolvedOld, resolvedOld, resolvedRecent], now)).toEqual([unresolvedOld, resolvedRecent]);
  });

  it("creates a minimal tracking item from bridge step metadata", () => {
    const bridge: BridgeStepMetadata = {
      amount: 12,
      destinationNetworkId: "2632500",
      sourceChain: "ethereum",
      sourceNetworkId: "1",
      targetChain: "coti",
      token: "coti",
      tokenAddress: "0xToken",
      tokenSymbol: "COTI",
    };
    const tracking = bridgeTrackingItemFromStep("0xWallet", "0xHash", bridge);
    expect(tracking.id).toBe("1:2632500:0xtoken:0xhash");
    expect(tracking.status).toBe("unknown");
    expect(tracking.wallet).toBe("0xWallet");
  });

  it("creates public tracking metadata from imported route transactions", () => {
    const imported = bridgeTrackingItemFromImport("0xWallet", {
      decimals: 18,
      destinationNetworkId: String(APP_CONFIG.coti.chainId),
      formatted_value: "12.5",
      sourceNetworkId: String(APP_CONFIG.ethereum.chainId),
      timestamp: "24 Jun 2026 12:00:00",
      token: "gCOTI",
      token_address: "0xToken",
      tx_hash: "0xImported",
      value: "12500000000000000000",
    }, Date.parse("2026-06-25T00:00:00.000Z"));
    expect(imported).toMatchObject({
      amount: 12.5,
      destinationNetworkId: String(APP_CONFIG.coti.chainId),
      hash: "0xImported",
      sourceChain: "ethereum",
      sourceNetworkId: String(APP_CONFIG.ethereum.chainId),
      targetChain: "coti",
      tokenAddress: "0xToken",
      tokenSymbol: "gCOTI",
      wallet: "0xWallet",
    });
  });

  it("imports only recent bridge history from the all-transactions endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      items: [
        {
          destinationNetworkId: String(APP_CONFIG.coti.chainId),
          formatted_value: "4",
          sourceNetworkId: String(APP_CONFIG.ethereum.chainId),
          timestamp: "24 Jun 2026 12:00:00",
          token: "COTI",
          token_address: "0xToken",
          tx_hash: "0xRecent",
        },
        {
          destinationNetworkId: String(APP_CONFIG.coti.chainId),
          formatted_value: "5",
          sourceNetworkId: String(APP_CONFIG.ethereum.chainId),
          timestamp: "01 Jun 2026 12:00:00",
          token: "COTI",
          token_address: "0xToken",
          tx_hash: "0xOld",
        },
      ],
    }))));
    const imported = await fetchRecentBridgeTrackingItems("0xWallet", 7, Date.parse("2026-06-25T00:00:00.000Z"));
    expect(imported.map((entry) => entry.hash)).toEqual(["0xRecent"]);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/tracking/get-all-transactions?"));
  });
});
