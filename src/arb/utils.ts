import { formatUnits, getAddress, isAddress, parseUnits } from "ethers";
import { APP_CONFIG, NATIVE_COTI } from "./config";

export function sameAddress(left?: string | null, right?: string | null): boolean {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

export function normalizeAddress(value: string, label = "address"): string {
  if (!isAddress(value)) throw new Error(`Invalid ${label}.`);
  return getAddress(value);
}

export function isAllowedWallet(address: string): boolean {
  return sameAddress(address, APP_CONFIG.allowedWallet);
}

export function isNativeToken(address: string): boolean {
  return sameAddress(address, NATIVE_COTI);
}

export function cleanAmount(amount: number, decimals = 12): string {
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  return amount.toFixed(decimals).replace(/\.?0+$/, "");
}

export function parseTokenAmount(amount: number, decimals: number): bigint {
  return parseUnits(cleanAmount(amount), decimals);
}

export function formatToken(raw: bigint, decimals: number, precision = 4): string {
  const [whole, frac = ""] = formatUnits(raw, decimals).split(".");
  const cut = frac.slice(0, precision).replace(/0+$/, "");
  return cut ? `${whole}.${cut}` : whole;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function numberFmt(value: number, precision = 4): string {
  if (!Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: precision,
    minimumFractionDigits: value !== 0 && Math.abs(value) < 1 ? Math.min(precision, 4) : 0,
  }).format(value);
}

export function usdFmt(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

export function hexValue(value: bigint | number | string | undefined | null): string {
  const raw = BigInt(value || 0);
  return `0x${raw.toString(16)}`;
}

export function minOutRaw(raw: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(slippageBps, 10000)));
  return (raw * (10000n - bps)) / 10000n;
}

export function gasWithBuffer(estimate: bigint, bufferBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(bufferBps, 20000)));
  return estimate + (estimate * bps) / 10000n;
}

export function explorerTx(chain: "ethereum" | "coti", hash: string): string {
  return `${chain === "ethereum" ? APP_CONFIG.ethereum.explorer : APP_CONFIG.coti.explorer}/tx/${hash}`;
}
