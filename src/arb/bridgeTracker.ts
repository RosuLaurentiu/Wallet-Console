import { APP_CONFIG } from "./config";
import type { BridgeStepMetadata, ChainKey } from "./types";

const STORAGE_KEY = "wallet-console:bridge-tracking:v1";
const RESOLVED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type BridgeTrackingStatus = "done" | "failed" | "in_progress" | "refunded" | "unknown";

export interface BridgeTrackingStage {
  completed: boolean;
  currentStep?: string;
  description: string;
  errorDetails?: string;
  eta?: string;
  label?: string;
  status: string;
  stepId: number;
  systemName: string;
}

export interface BridgeTrackingItem {
  amount: number;
  destinationHash?: string;
  destinationNetworkId: string;
  error?: string;
  hash: string;
  id: string;
  overallStatus?: string;
  sourceChain: ChainKey;
  sourceNetworkId: string;
  stages: BridgeTrackingStage[];
  status: BridgeTrackingStatus;
  submittedAtUtc: string;
  targetChain: ChainKey;
  tokenAddress: string;
  tokenSymbol: "COTI" | "gCOTI";
  updatedAtUtc?: string;
  wallet: string;
}

export interface BridgeTrackingStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

interface TrackingResponse {
  overall_status?: string;
  stages?: Array<{
    completed?: boolean;
    current_step?: string | null;
    description?: string;
    error_details?: string | null;
    label?: string | null;
    raw_response?: unknown;
    status?: string;
    step_id?: number;
    system_name?: string;
  }>;
}

export interface ImportedBridgeTransaction {
  decimals?: number | null;
  destinationNetwork?: string | null;
  destinationNetworkId?: string | null;
  formatted_value?: string | null;
  id?: number;
  overall_status?: string | null;
  sourceNetwork?: string | null;
  sourceNetworkId?: string | null;
  status?: string | null;
  timestamp?: string | null;
  token?: string | null;
  token_address?: string | null;
  transaction_id?: number | null;
  tx_hash?: string;
  value?: string | null;
}

interface AllRoutesTransactionsResponse {
  items?: ImportedBridgeTransaction[];
}

function currentStorage(): BridgeTrackingStorage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function parseError(error: unknown): string {
  if (typeof error === "object" && error) {
    const record = error as { message?: string; reason?: string; shortMessage?: string };
    return record.shortMessage || record.reason || record.message || "Bridge tracking failed.";
  }
  return String(error || "Bridge tracking failed.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function trackingAllTransactionsUrl(): string {
  return APP_CONFIG.bridge.trackingByTxHash.replace(/\/by-tx-hash(?:\?.*)?$/, "/get-all-transactions");
}

function parseBridgeTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  const normalized = trimmed.replace(/(\.\d{3})\d+(Z)?$/, "$1$2");
  const parsed = Date.parse(normalized);
  if (Number.isFinite(parsed)) return parsed;
  const parsedUtc = Date.parse(`${trimmed} UTC`);
  return Number.isFinite(parsedUtc) ? parsedUtc : null;
}

function chainFromNetworkId(networkId: string | null | undefined): ChainKey | null {
  if (networkId === String(APP_CONFIG.ethereum.chainId)) return "ethereum";
  if (networkId === String(APP_CONFIG.coti.chainId)) return "coti";
  return null;
}

function tokenSymbolFromImport(item: ImportedBridgeTransaction): "COTI" | "gCOTI" | null {
  const token = String(item.token || "").toLowerCase();
  if (token === "gcoti" || token.includes("gcoti")) return "gCOTI";
  if (token === "coti" || token.includes("coti")) return "COTI";
  return null;
}

function amountFromImport(item: ImportedBridgeTransaction): number {
  const formatted = Number(item.formatted_value);
  if (Number.isFinite(formatted)) return formatted;
  const raw = Number(item.value);
  const decimals = Number(item.decimals);
  if (Number.isFinite(raw) && Number.isFinite(decimals)) return raw / (10 ** decimals);
  return 0;
}

function isBridgeTrackingItem(value: unknown): value is BridgeTrackingItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.amount === "number"
    && typeof value.destinationNetworkId === "string"
    && typeof value.hash === "string"
    && typeof value.id === "string"
    && typeof value.sourceChain === "string"
    && typeof value.sourceNetworkId === "string"
    && typeof value.status === "string"
    && typeof value.submittedAtUtc === "string"
    && typeof value.targetChain === "string"
    && typeof value.tokenAddress === "string"
    && typeof value.tokenSymbol === "string"
    && typeof value.wallet === "string"
    && Array.isArray(value.stages)
  );
}

export function normalizeBridgeStatus(value: unknown): BridgeTrackingStatus {
  const status = String(value || "").toLowerCase();
  if (status === "done") return "done";
  if (status === "failed") return "failed";
  if (status === "in_progress") return "in_progress";
  if (status === "refunded") return "refunded";
  return "unknown";
}

export function isBridgeResolved(item: BridgeTrackingItem): boolean {
  return item.status === "done" || item.status === "failed" || item.status === "refunded";
}

export function cleanupBridgeTrackingItems(items: BridgeTrackingItem[], nowMs = Date.now(), retentionMs = RESOLVED_RETENTION_MS): BridgeTrackingItem[] {
  return items.filter((item) => {
    if (!isBridgeResolved(item)) return true;
    const resolvedAt = parseBridgeTimestamp(item.updatedAtUtc || item.submittedAtUtc);
    if (resolvedAt === null) return true;
    return nowMs - resolvedAt <= retentionMs;
  });
}

export function loadBridgeTrackingItems(storage = currentStorage()): BridgeTrackingItem[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? cleanupBridgeTrackingItems(parsed.filter(isBridgeTrackingItem)) : [];
  } catch {
    return [];
  }
}

export function saveBridgeTrackingItems(items: BridgeTrackingItem[], storage = currentStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // localStorage may be disabled or full; tracking is best-effort only.
  }
}

export function mergeBridgeTrackingItems(existing: BridgeTrackingItem[], incoming: BridgeTrackingItem[]): BridgeTrackingItem[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    const current = byId.get(item.id);
    if (current && item.status === "unknown" && current.status !== "unknown") {
      byId.set(item.id, { ...item, ...current });
    } else {
      byId.set(item.id, current ? { ...current, ...item } : item);
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.submittedAtUtc.localeCompare(a.submittedAtUtc));
}

export function bridgeTrackingItemFromStep(wallet: string, hash: string, bridge: BridgeStepMetadata): BridgeTrackingItem {
  return {
    amount: bridge.amount,
    destinationNetworkId: bridge.destinationNetworkId,
    hash,
    id: `${bridge.sourceNetworkId}:${bridge.destinationNetworkId}:${bridge.tokenAddress.toLowerCase()}:${hash.toLowerCase()}`,
    sourceChain: bridge.sourceChain,
    sourceNetworkId: bridge.sourceNetworkId,
    stages: [],
    status: "unknown",
    submittedAtUtc: new Date().toISOString(),
    targetChain: bridge.targetChain,
    tokenAddress: bridge.tokenAddress,
    tokenSymbol: bridge.tokenSymbol,
    wallet,
  };
}

export function bridgeTrackingItemFromImport(wallet: string, item: ImportedBridgeTransaction, nowMs = Date.now()): BridgeTrackingItem | null {
  const hash = stringValue(item.tx_hash);
  const sourceNetworkId = stringValue(item.sourceNetworkId);
  const destinationNetworkId = stringValue(item.destinationNetworkId);
  const tokenAddress = stringValue(item.token_address);
  const tokenSymbol = tokenSymbolFromImport(item);
  const sourceChain = chainFromNetworkId(sourceNetworkId);
  const targetChain = chainFromNetworkId(destinationNetworkId);
  if (!hash || !sourceNetworkId || !destinationNetworkId || !tokenAddress || !tokenSymbol || !sourceChain || !targetChain) return null;
  const submittedMs = parseBridgeTimestamp(item.timestamp) || nowMs;
  const importedStatus = normalizeBridgeStatus(item.overall_status || item.status);
  return {
    amount: amountFromImport(item),
    destinationNetworkId,
    hash,
    id: `${sourceNetworkId}:${destinationNetworkId}:${tokenAddress.toLowerCase()}:${hash.toLowerCase()}`,
    overallStatus: item.overall_status || item.status || undefined,
    sourceChain,
    sourceNetworkId,
    stages: [],
    status: importedStatus,
    submittedAtUtc: new Date(submittedMs).toISOString(),
    targetChain,
    tokenAddress,
    tokenSymbol,
    updatedAtUtc: importedStatus === "unknown" ? undefined : new Date(submittedMs).toISOString(),
    wallet,
  };
}

export async function fetchRecentBridgeTrackingItems(wallet: string, days = 7, nowMs = Date.now()): Promise<BridgeTrackingItem[]> {
  const url = new URL(trackingAllTransactionsUrl());
  url.searchParams.set("wallet_address", wallet);
  url.searchParams.set("page", "1");
  url.searchParams.set("page_size", "1000");
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const data = await response.json() as AllRoutesTransactionsResponse;
  const cutoff = nowMs - Math.max(1, days) * 24 * 60 * 60 * 1000;
  return (data.items || []).flatMap((transaction) => {
    const submittedMs = parseBridgeTimestamp(transaction.timestamp);
    if (submittedMs === null || submittedMs < cutoff) return [];
    const item = bridgeTrackingItemFromImport(wallet, transaction, nowMs);
    return item ? [item] : [];
  });
}

function txHashFromRawResponse(rawResponse: unknown): string | undefined {
  if (!isRecord(rawResponse)) return undefined;
  const direct = stringValue(rawResponse.transaction_hash);
  if (direct) return direct;
  const transactions = Array.isArray(rawResponse.transactions) ? rawResponse.transactions : [];
  for (let i = transactions.length - 1; i >= 0; i -= 1) {
    const transaction = transactions[i];
    if (!isRecord(transaction)) continue;
    const hash = stringValue(transaction.transaction_hash);
    if (hash) return hash;
  }
  return undefined;
}

function destinationHashFromStages(stages: TrackingResponse["stages"]): string | undefined {
  if (!stages?.length) return undefined;
  for (let i = stages.length - 1; i >= 0; i -= 1) {
    const hash = txHashFromRawResponse(stages[i]?.raw_response);
    if (hash) return hash;
  }
  return undefined;
}

function hasExplicitStageError(stages: TrackingResponse["stages"]): boolean {
  return (stages || []).some((stage) => Boolean(stage.error_details) || String(stage.status || "").toLowerCase() === "error");
}

function normalizedTrackingStatus(data: TrackingResponse, destinationHash: string | undefined): BridgeTrackingStatus {
  const status = normalizeBridgeStatus(data.overall_status);
  if (status !== "refunded" && destinationHash && !hasExplicitStageError(data.stages)) return "done";
  return status;
}

function normalizeStages(stages: TrackingResponse["stages"]): BridgeTrackingStage[] {
  return (stages || []).map((stage, index) => ({
    completed: Boolean(stage.completed),
    currentStep: stage.current_step || undefined,
    description: String(stage.description || ""),
    errorDetails: stage.error_details || undefined,
    label: stage.label || undefined,
    status: String(stage.status || "unknown"),
    stepId: Number(stage.step_id || index + 1),
    systemName: String(stage.system_name || "Bridge"),
  }));
}

export function markBridgeTrackingError(item: BridgeTrackingItem, error: unknown): BridgeTrackingItem {
  return {
    ...item,
    error: parseError(error),
    status: isBridgeResolved(item) ? item.status : "unknown",
    updatedAtUtc: new Date().toISOString(),
  };
}

export function markBridgeTrackingFailed(item: BridgeTrackingItem, error: unknown): BridgeTrackingItem {
  const message = parseError(error);
  return {
    ...item,
    error: message,
    overallStatus: "Failed",
    stages: item.stages.length ? item.stages : [
      {
        completed: true,
        description: "Source transaction was submitted.",
        label: "Detected",
        status: "Done",
        stepId: 1,
        systemName: "Wallet",
      },
      {
        completed: false,
        description: message,
        errorDetails: message,
        label: "Source transaction",
        status: "Failed",
        stepId: 2,
        systemName: "Wallet",
      },
    ],
    status: "failed",
    updatedAtUtc: new Date().toISOString(),
  };
}

export async function fetchBridgeTrackingItem(item: BridgeTrackingItem): Promise<BridgeTrackingItem> {
  const url = new URL(APP_CONFIG.bridge.trackingByTxHash);
  url.searchParams.set("tx_hash", item.hash);
  url.searchParams.set("sourceNetworkId", item.sourceNetworkId);
  url.searchParams.set("destinationNetworkId", item.destinationNetworkId);
  url.searchParams.set("token_address", item.tokenAddress);
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const data = await response.json() as TrackingResponse;
  const stages = normalizeStages(data.stages);
  const destinationHash = destinationHashFromStages(data.stages) || item.destinationHash;
  return {
    ...item,
    destinationHash,
    error: undefined,
    overallStatus: data.overall_status,
    stages,
    status: normalizedTrackingStatus(data, destinationHash),
    updatedAtUtc: new Date().toISOString(),
  };
}
