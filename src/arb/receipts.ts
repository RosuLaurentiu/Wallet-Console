import { JsonRpcProvider } from "ethers";
import { APP_CONFIG } from "./config";
import type { ChainKey } from "./types";

const ethReceiptProvider = new JsonRpcProvider(APP_CONFIG.ethRpcUrl);
const cotiReceiptProvider = new JsonRpcProvider(APP_CONFIG.cotiRpcUrl);

export interface ReceiptProvider {
  getTransactionReceipt(hash: string): Promise<{ blockNumber?: number | null; status?: number | null } | null>;
}

export interface WaitReceiptOptions {
  intervalMs?: number;
  provider?: ReceiptProvider;
  timeoutMs?: number;
}

export interface WaitedReceipt {
  blockNumber?: number | null;
  status: "success" | "failed";
}

function providerForChain(chain: ChainKey): ReceiptProvider {
  return chain === "ethereum" ? ethReceiptProvider : cotiReceiptProvider;
}

function delay(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

export async function waitForTransactionReceipt(chain: ChainKey, hash: string, options: WaitReceiptOptions = {}): Promise<WaitedReceipt> {
  const provider = options.provider || providerForChain(chain);
  const timeoutMs = options.timeoutMs ?? 600_000;
  const intervalMs = options.intervalMs ?? 4_000;
  const started = Date.now();
  for (;;) {
    const receipt = await provider.getTransactionReceipt(hash);
    if (receipt) {
      if (receipt.status === 0) return { blockNumber: receipt.blockNumber, status: "failed" };
      return { blockNumber: receipt.blockNumber, status: "success" };
    }
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`${hash} was not mined within ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    await delay(intervalMs);
  }
}
