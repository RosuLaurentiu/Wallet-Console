import { BrowserProvider } from "ethers";
import type { WalletProvider } from "./types";

declare global {
  interface Window {
    ethereum?: WalletProvider & { providers?: WalletProvider[] };
  }
}

interface Eip6963Detail {
  info?: { name?: string; rdns?: string; uuid?: string };
  provider?: WalletProvider;
}

export interface ProviderEntry {
  id: string;
  label: string;
  provider: WalletProvider;
  rdns?: string;
}

function providerLabel(provider: WalletProvider, fallback = "Injected wallet"): string {
  if (provider.isMetaMask) return "MetaMask";
  return fallback;
}

function isSupportedProvider(entry: ProviderEntry): boolean {
  const name = `${entry.label} ${entry.rdns || ""}`.toLowerCase();
  if (entry.provider.isBraveWallet || name.includes("brave")) return false;
  return (
    entry.provider.isMetaMask ||
    name.includes("metamask") ||
    name.includes("cipher") ||
    name.includes("cypher")
  );
}

function dedupe(entries: ProviderEntry[]): ProviderEntry[] {
  const seen = new Set<WalletProvider>();
  return entries.filter((entry) => {
    if (!entry.provider || seen.has(entry.provider)) return false;
    seen.add(entry.provider);
    return true;
  });
}

export async function discoverProviders(): Promise<ProviderEntry[]> {
  const entries: ProviderEntry[] = [];
  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963Detail>).detail;
    if (!detail?.provider) return;
    entries.push({
      id: detail.info?.uuid || detail.info?.rdns || detail.info?.name || `wallet-${entries.length}`,
      label: detail.info?.name || providerLabel(detail.provider),
      provider: detail.provider,
      rdns: detail.info?.rdns,
    });
  };

  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((resolve) => window.setTimeout(resolve, 250));
  window.removeEventListener("eip6963:announceProvider", onAnnounce);

  if (window.ethereum?.providers?.length) {
    for (const provider of window.ethereum.providers) {
      entries.push({
        id: providerLabel(provider, `injected-${entries.length}`),
        label: providerLabel(provider),
        provider,
      });
    }
  } else if (window.ethereum) {
    entries.push({
      id: "window.ethereum",
      label: providerLabel(window.ethereum),
      provider: window.ethereum,
    });
  }

  const supported = dedupe(entries).filter(isSupportedProvider);
  return supported.length ? supported : dedupe(entries).filter((entry) => !entry.provider.isBraveWallet);
}

export async function connectProvider(entry: ProviderEntry): Promise<{ address: string; chainId: number }> {
  await entry.provider.request({ method: "eth_requestAccounts" });
  const browserProvider = new BrowserProvider(entry.provider);
  const signer = await browserProvider.getSigner();
  const network = await browserProvider.getNetwork();
  return { address: await signer.getAddress(), chainId: Number(network.chainId) };
}

export async function switchChain(entry: ProviderEntry, chain: {
  blockExplorerUrls?: string[];
  chainIdHex: string;
  label: string;
  nativeCurrency: { decimals: number; name: string; symbol: string };
  rpcUrl: string;
}): Promise<void> {
  try {
    await entry.provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chain.chainIdHex }],
    });
  } catch (error) {
    const code = typeof error === "object" && error ? (error as { code?: number }).code : undefined;
    if (code !== 4902) throw error;
    await entry.provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        blockExplorerUrls: chain.blockExplorerUrls || [],
        chainId: chain.chainIdHex,
        chainName: chain.label,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: [chain.rpcUrl],
      }],
    });
  }
}

export async function currentAccount(entry: ProviderEntry): Promise<string | null> {
  const accounts = await entry.provider.request({ method: "eth_accounts" });
  return Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
}
