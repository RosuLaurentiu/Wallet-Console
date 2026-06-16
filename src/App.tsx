import { useCallback, useEffect, useMemo, useState } from "react";
import { APP_CONFIG } from "./arb/config";
import { buildQuote, preparePlan } from "./arb/engine";
import type { PairId, PreparedPlan, QuoteResult } from "./arb/types";
import { connectProvider, currentAccount, discoverProviders, switchChain, type ProviderEntry } from "./arb/wallet";
import { explorerTx, isAllowedWallet, numberFmt, shortAddress, usdFmt } from "./arb/utils";
import "./index.css";

type FlowState = "idle" | "loading" | "ready" | "signing" | "success" | "error";

interface TxProgress {
  hash?: string;
  index: number;
  label: string;
  message: string;
  status: "pending" | "success" | "error" | "waiting";
  chain?: "ethereum" | "coti";
}

function stepName(index: number): string {
  return ["Connect wallet", "Quote", "Review", "Sign"][index] || "";
}

function parseError(error: unknown): string {
  if (typeof error === "object" && error) {
    const record = error as { message?: string; reason?: string; shortMessage?: string };
    return record.shortMessage || record.reason || record.message || "Operation failed.";
  }
  return String(error || "Operation failed.");
}

function pairTitle(pairId: PairId): string {
  return pairId === "coti-gcoti" ? "COTI/gCOTI" : "COTI/USDC";
}

function App() {
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [providerId, setProviderId] = useState("");
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [selectedPair, setSelectedPair] = useState<PairId>("coti-gcoti");
  const [prepared, setPrepared] = useState<PreparedPlan | null>(null);
  const [progress, setProgress] = useState<TxProgress[]>([]);
  const [flow, setFlow] = useState<FlowState>("idle");
  const [message, setMessage] = useState("Connect the allowed wallet to calculate browser-signed arbitrage.");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const selectedProvider = useMemo(
    () => providers.find((entry) => entry.id === providerId) || providers[0] || null,
    [providerId, providers],
  );
  const allowed = account ? isAllowedWallet(account) : false;
  const selectedOpportunity = quote?.opportunities.find((item) => item.pairId === selectedPair) || null;

  useEffect(() => {
    discoverProviders().then((items) => {
      setProviders(items);
      setProviderId((current) => current || items[0]?.id || "");
    });
  }, []);

  const connect = useCallback(async () => {
    if (!selectedProvider) {
      setFlow("error");
      setMessage("No supported wallet provider detected. Open this page inside MetaMask or CipherTrade.");
      return;
    }
    try {
      setFlow("loading");
      setMessage("Requesting wallet connection...");
      const result = await connectProvider(selectedProvider);
      setAccount(result.address);
      setChainId(result.chainId);
      setPrepared(null);
      setQuote(null);
      setProgress([]);
      if (!isAllowedWallet(result.address)) {
        setFlow("error");
        setMessage(`Wallet ${shortAddress(result.address)} is not allowed to use this tool.`);
        return;
      }
      setFlow("ready");
      setMessage("Wallet connected. Refresh quotes when ready.");
    } catch (error) {
      setFlow("error");
      setMessage(parseError(error));
    }
  }, [selectedProvider]);

  const forget = useCallback(() => {
    setAccount("");
    setChainId(null);
    setQuote(null);
    setPrepared(null);
    setProgress([]);
    setFlow("idle");
    setMessage("Wallet forgotten locally. Browser wallet permissions were not changed.");
  }, []);

  const refreshQuote = useCallback(async () => {
    if (!account || !allowed) {
      setMessage("Connect the allowed wallet first.");
      return;
    }
    try {
      setFlow("loading");
      setPrepared(null);
      setProgress([]);
      setMessage("Calculating both arbitrage pairs from public RPC data...");
      const result = await buildQuote(account);
      setQuote(result);
      const best = result.opportunities.slice().sort((a, b) => b.netProfitAfterFeesUsd - a.netProfitAfterFeesUsd)[0];
      if (best) setSelectedPair(best.pairId);
      setFlow("ready");
      setMessage("Quote refreshed.");
    } catch (error) {
      setFlow("error");
      setMessage(parseError(error));
    }
  }, [account, allowed]);

  const review = useCallback(async () => {
    if (!account || !allowed || !selectedOpportunity?.executable) {
      setMessage(selectedOpportunity?.reason || "Selected opportunity is blocked.");
      return;
    }
    try {
      setFlow("loading");
      setProgress([]);
      setMessage("Preparing unsigned DEX-only wallet transactions...");
      const plan = await preparePlan(account, selectedPair);
      setPrepared(plan);
      setProgress(plan.steps.map((step) => ({
        chain: step.chain,
        index: step.index,
        label: step.label,
        message: "Waiting for signature",
        status: "waiting",
      })));
      setFlow("ready");
      setMessage("Review complete. Start signatures only if the route and amounts look correct.");
    } catch (error) {
      setFlow("error");
      setMessage(parseError(error));
    }
  }, [account, allowed, selectedOpportunity, selectedPair]);

  const sign = useCallback(async () => {
    if (!selectedProvider || !prepared) return;
    try {
      setFlow("signing");
      setMessage("Wallet signature flow started. Do not change accounts until all steps finish.");
      const current = await currentAccount(selectedProvider);
      if (!current || current.toLowerCase() !== prepared.wallet.toLowerCase()) {
        throw new Error("Wallet account changed before signing.");
      }
      const nextProgress = prepared.steps.map((step) => ({
        chain: step.chain,
        index: step.index,
        label: step.label,
        message: "Waiting for signature",
        status: "waiting" as const,
      }));
      setProgress(nextProgress);
      for (const step of prepared.steps) {
        await switchChain(selectedProvider, {
          blockExplorerUrls: [step.chain === "ethereum" ? APP_CONFIG.ethereum.explorer : APP_CONFIG.coti.explorer],
          chainIdHex: step.chain === "ethereum" ? APP_CONFIG.ethereum.chainIdHex : APP_CONFIG.coti.chainIdHex,
          label: step.chain === "ethereum" ? APP_CONFIG.ethereum.label : APP_CONFIG.coti.label,
          nativeCurrency: step.chain === "ethereum" ? APP_CONFIG.ethereum.nativeCurrency : APP_CONFIG.coti.nativeCurrency,
          rpcUrl: step.chain === "ethereum" ? APP_CONFIG.ethRpcUrl : APP_CONFIG.cotiRpcUrl,
        });
        setProgress((items) => items.map((item) => item.index === step.index ? { ...item, message: "Confirm in wallet", status: "pending" } : item));
        const hash = await selectedProvider.provider.request({
          method: "eth_sendTransaction",
          params: [step.tx],
        });
        if (typeof hash !== "string") throw new Error(`${step.label} did not return a transaction hash.`);
        setProgress((items) => items.map((item) => item.index === step.index ? { ...item, hash, message: "Submitted", status: "success" } : item));
      }
      setFlow("success");
      setMessage("All prepared transactions were submitted. Refresh quotes before trading again.");
    } catch (error) {
      setFlow("error");
      setMessage(parseError(error));
      setProgress((items) => items.map((item) => item.status === "pending" ? { ...item, message: "Failed or rejected", status: "error" } : item));
    }
  }, [prepared, selectedProvider]);

  const activeStep = account ? quote ? prepared ? 3 : 2 : 1 : 0;

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <div className="eyebrow">Private browser-wallet tool</div>
          <h1>COTI Arbitrage Signer</h1>
          <p>Quotes COTI/gCOTI and COTI/USDC, then prepares DEX-only transactions for your wallet.</p>
        </div>
        <div className={`status ${flow}`}>{flow}</div>
      </header>

      <section className="notice">
        <strong>Wallet gate:</strong> only {shortAddress(APP_CONFIG.allowedWallet)} can quote or sign. The page is public on GitHub Pages; your private key never leaves your wallet.
        <br />
        <strong>No bridge:</strong> every prepared action is a DEX approval or swap. Uniswap signs first, then Carbon.
      </section>

      <section className="steps">
        {[0, 1, 2, 3].map((step) => (
          <div className={`step ${activeStep >= step ? "active" : ""}`} key={step}>
            <span>{step + 1}</span>
            <strong>{stepName(step)}</strong>
          </div>
        ))}
      </section>

      <section className="grid">
        <aside className="panel wallet-panel">
          <h2>Wallet</h2>
          <label>
            Provider
            <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
              {providers.length === 0 ? <option>No wallet detected</option> : providers.map((provider) => (
                <option value={provider.id} key={provider.id}>{provider.label}</option>
              ))}
            </select>
          </label>
          <div className="wallet-card">
            <span>Address</span>
            <strong>{account ? shortAddress(account) : "not connected"}</strong>
          </div>
          <div className="wallet-card">
            <span>Network</span>
            <strong>{chainId === null ? "n/a" : chainId}</strong>
          </div>
          {account && !allowed ? <div className="blocked">This wallet is not allowed.</div> : null}
          <div className="button-row">
            <button className="primary" type="button" onClick={connect}>{account ? "Change wallet" : "Connect wallet"}</button>
            <button type="button" onClick={forget} disabled={!account}>Forget</button>
          </div>
          <button type="button" onClick={refreshQuote} disabled={!account || !allowed || flow === "loading" || flow === "signing"}>Refresh quote</button>
        </aside>

        <section className="panel main-panel">
          <div className="panel-head">
            <div>
              <h2>Opportunities</h2>
              <p>{message}</p>
            </div>
            {quote ? <span className="fresh">Updated {new Date(quote.generatedAtUtc).toLocaleTimeString()}</span> : null}
          </div>

          <div className="opportunities">
            {(quote?.opportunities || [
              { pairId: "coti-gcoti" as PairId, pairLabel: "COTI/gCOTI" },
              { pairId: "coti-usdc" as PairId, pairLabel: "COTI/USDC" },
            ]).map((item) => {
              const opportunity = "summary" in item ? item : null;
              const pairId = item.pairId;
              return (
                <button className={`opportunity ${selectedPair === pairId ? "selected" : ""} ${opportunity?.executable ? "ok" : "blocked"}`} type="button" key={pairId} onClick={() => setSelectedPair(pairId)}>
                  <span>{pairTitle(pairId)}</span>
                  <strong>{opportunity ? usdFmt(opportunity.netProfitUsd) : "not quoted"}</strong>
                  <small>{opportunity ? `${opportunity.route} · net ${usdFmt(opportunity.netProfitAfterFeesUsd)}` : "Refresh quote"}</small>
                </button>
              );
            })}
          </div>

          {selectedOpportunity ? (
            <div className="review-card">
              <div className="review-head">
                <div>
                  <h3>{selectedOpportunity.pairLabel}</h3>
                  <p>{selectedOpportunity.action}</p>
                </div>
                <span className={selectedOpportunity.executable ? "pill ok" : "pill blocked"}>{selectedOpportunity.executable ? "executable" : "blocked"}</span>
              </div>
              <div className="numbers">
                <div><span>Input</span><strong>{numberFmt(selectedOpportunity.summary.inputAmount)} {selectedOpportunity.summary.inputSymbol}</strong></div>
                <div><span>Intermediate</span><strong>{numberFmt(selectedOpportunity.summary.bridgeOutputAmount)} {selectedOpportunity.summary.bridgeOutputSymbol}</strong></div>
                <div><span>Output</span><strong>{numberFmt(selectedOpportunity.summary.outputAmount)} {selectedOpportunity.summary.outputSymbol}</strong></div>
                <div><span>Profit</span><strong>{usdFmt(selectedOpportunity.netProfitUsd)}</strong></div>
                <div><span>Estimated fees</span><strong>{usdFmt(selectedOpportunity.estimatedFeesUsd)}</strong></div>
                <div><span>Net after fees</span><strong>{usdFmt(selectedOpportunity.netProfitAfterFeesUsd)}</strong></div>
              </div>
              <div className="route-note">Uniswap signs first, Carbon signs second. No bridge transaction is prepared.</div>
              {selectedOpportunity.warnings.map((warning) => <div className="warning" key={warning}>{warning}</div>)}
              <div className="button-row">
                <button className="primary" type="button" onClick={review} disabled={!selectedOpportunity.executable || flow === "loading" || flow === "signing"}>Review transactions</button>
                <button type="button" onClick={() => setShowAdvanced((value) => !value)}>{showAdvanced ? "Hide details" : "Advanced details"}</button>
              </div>
            </div>
          ) : (
            <div className="empty">Connect wallet and refresh quotes.</div>
          )}

          {prepared ? (
            <div className="sign-card">
              <div className="review-head">
                <div>
                  <h3>Signature steps</h3>
                  <p>{prepared.warning}</p>
                </div>
                <button className="danger" type="button" onClick={sign} disabled={flow === "signing"}>Start signatures</button>
              </div>
              <div className="tx-list">
                {progress.map((item) => (
                  <div className={`tx-row ${item.status}`} key={item.index}>
                    <span>{item.index}</span>
                    <div>
                      <strong>{item.label}</strong>
                      <small>{item.message}</small>
                      {item.hash && item.chain ? <a href={explorerTx(item.chain, item.hash)} target="_blank" rel="noreferrer">{shortAddress(item.hash)}</a> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {showAdvanced ? (
            <pre className="advanced">{JSON.stringify({ quote, prepared }, null, 2)}</pre>
          ) : null}
        </section>

        <aside className="panel balances-panel">
          <h2>Balances</h2>
          {quote ? (
            <>
              <h3>Ethereum</h3>
              <Balance label="COTI" value={quote.balances.ethereum.tokens.coti.value} />
              <Balance label="gCOTI" value={quote.balances.ethereum.tokens.gcoti.value} />
              <Balance label="USDC" value={quote.balances.ethereum.tokens.usdc.value} />
              <Balance label="ETH gas" value={quote.balances.ethereum.native.value} />
              <h3>COTI</h3>
              <Balance label="COTI" value={quote.balances.coti.tokens.coti.value} />
              <Balance label="gCOTI" value={quote.balances.coti.tokens.gcoti.value} />
              <Balance label="USDCe" value={quote.balances.coti.tokens.usdc.value} />
              <Balance label="COTI gas" value={quote.balances.coti.native.value} />
            </>
          ) : (
            <p className="muted">Balances appear after quoting.</p>
          )}
        </aside>
      </section>
    </main>
  );
}

function Balance({ label, value }: { label: string; value: number }) {
  return (
    <div className="balance">
      <span>{label}</span>
      <strong>{numberFmt(value)}</strong>
    </div>
  );
}

export default App;
