import { useCallback, useEffect, useMemo, useState } from "react";
import { APP_CONFIG } from "./arb/config";
import { buildQuote, preparePlan, prepareRebalancePlan } from "./arb/engine";
import type { PairId, PreparedWalletPlan, QuoteResult, RebalanceSuggestion } from "./arb/types";
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
  return ["Connect", "Quote", "Review", "Sign"][index] || "";
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

function rebalanceText(rebalance: RebalanceSuggestion | null): string {
  if (!rebalance) return "Quote first.";
  if (!rebalance.executable) return rebalance.reason || "No rebalance needed.";
  return `Bridge ${numberFmt(rebalance.amount)} ${rebalance.tokenSymbol}.`;
}

function chainLabel(chainId: number | null): string {
  if (chainId === APP_CONFIG.ethereum.chainId) return "Ethereum";
  if (chainId === APP_CONFIG.coti.chainId) return "COTI";
  return chainId === null ? "n/a" : String(chainId);
}

function App() {
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [providerId, setProviderId] = useState("");
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [selectedPair, setSelectedPair] = useState<PairId>("coti-gcoti");
  const [prepared, setPrepared] = useState<PreparedWalletPlan | null>(null);
  const [progress, setProgress] = useState<TxProgress[]>([]);
  const [flow, setFlow] = useState<FlowState>("idle");
  const [message, setMessage] = useState("Connect wallet.");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showBalances, setShowBalances] = useState(false);

  const selectedProvider = useMemo(
    () => providers.find((entry) => entry.id === providerId) || providers[0] || null,
    [providerId, providers],
  );
  const allowed = account ? isAllowedWallet(account) : false;
  const selectedOpportunity = quote?.opportunities.find((item) => item.pairId === selectedPair) || null;
  const rebalance = quote?.rebalance || null;

  useEffect(() => {
    discoverProviders().then((items) => {
      setProviders(items);
      setProviderId((current) => current || items[0]?.id || "");
    });
  }, []);

  const connect = useCallback(async () => {
    if (!selectedProvider) {
      setFlow("error");
      setMessage("No wallet detected.");
      return;
    }
    try {
      setFlow("loading");
      setMessage("Connecting...");
      const result = await connectProvider(selectedProvider);
      setAccount(result.address);
      setChainId(result.chainId);
      setPrepared(null);
      setQuote(null);
      setProgress([]);
      if (!isAllowedWallet(result.address)) {
        setFlow("error");
        setMessage(`${shortAddress(result.address)} not allowed.`);
        return;
      }
      setFlow("ready");
      setMessage("Ready.");
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
    setMessage("Wallet forgotten.");
  }, []);

  const refreshQuote = useCallback(async () => {
    if (!account || !allowed) {
      setMessage("Connect wallet first.");
      return;
    }
    try {
      setFlow("loading");
      setPrepared(null);
      setProgress([]);
      setMessage("Quoting...");
      const result = await buildQuote(account);
      setQuote(result);
      const best = result.opportunities.slice().sort((a, b) => b.netProfitAfterFeesUsd - a.netProfitAfterFeesUsd)[0];
      if (best) setSelectedPair(best.pairId);
      setFlow("ready");
      setMessage("Quote updated.");
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
      setMessage("Preparing txs...");
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
      setMessage("Review prepared.");
    } catch (error) {
      setFlow("error");
      setMessage(parseError(error));
    }
  }, [account, allowed, selectedOpportunity, selectedPair]);

  const reviewRebalance = useCallback(async () => {
    if (!account || !allowed) {
      setMessage("Connect wallet first.");
      return;
    }
    try {
      setFlow("loading");
      setProgress([]);
      setMessage("Preparing rebalance...");
      const plan = await prepareRebalancePlan(account);
      setPrepared(plan);
      setProgress(plan.steps.map((step) => ({
        chain: step.chain,
        index: step.index,
        label: step.label,
        message: "Waiting for signature",
        status: "waiting",
      })));
      setFlow("ready");
      setMessage("Rebalance prepared.");
    } catch (error) {
      setFlow("error");
      setMessage(parseError(error));
    }
  }, [account, allowed]);

  const sign = useCallback(async () => {
    if (!selectedProvider || !prepared) return;
    try {
      setFlow("signing");
      setMessage("Signing...");
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
      setMessage(prepared.kind === "rebalance" ? "Bridge submitted. Track before rebalancing again." : "Submitted. Refresh before trading again.");
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
          <h1>COTI Arb</h1>
        </div>
        <div className="top-status">
          <div className={`status ${flow}`}>{flow}</div>
          <small>{account ? `${shortAddress(account)} - ${chainLabel(chainId)}` : "wallet not connected"}</small>
        </div>
      </header>

      <section className="steps">
        {[0, 1, 2, 3].map((step) => (
          <div className={`step ${activeStep >= step ? "active" : ""}`} key={step}>
            <span>{step + 1}</span>
            <strong>{stepName(step)}</strong>
          </div>
        ))}
      </section>

      <section className="workflow">
        <section className="panel action-strip">
          <label className="field provider-field">
            <span>Provider</span>
            <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
              {providers.length === 0 ? <option>No wallet detected</option> : providers.map((provider) => (
                <option value={provider.id} key={provider.id}>{provider.label}</option>
              ))}
            </select>
          </label>
          <Info label="Wallet" value={account ? shortAddress(account) : "not connected"} />
          <Info label="Network" value={chainLabel(chainId)} />
          {account && !allowed ? <div className="blocked">This wallet is not allowed.</div> : null}
          <div className="action-buttons">
            <button className="primary" type="button" onClick={connect}>{account ? "Change" : "Connect"}</button>
            <button type="button" onClick={forget} disabled={!account}>Forget</button>
            <button type="button" onClick={refreshQuote} disabled={!account || !allowed || flow === "loading" || flow === "signing"}>Quote</button>
          </div>
        </section>

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
                  <small>{opportunity ? `${opportunity.route} - net ${usdFmt(opportunity.netProfitAfterFeesUsd)}` : "Quote"}</small>
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
              </div>
              <div className="fee-summary">
                <div><span>Profit</span><strong>{usdFmt(selectedOpportunity.netProfitUsd)}</strong></div>
                <div><span>Estimated fees</span><strong>{usdFmt(selectedOpportunity.estimatedFeesUsd)}</strong></div>
                <div><span>Net after fees</span><strong>{usdFmt(selectedOpportunity.netProfitAfterFeesUsd)}</strong></div>
              </div>
              <div className="route-note">Uniswap first. Carbon second. No bridge.</div>
              {selectedOpportunity.reason ? <div className="warning">{selectedOpportunity.reason}</div> : null}
              <div className="button-row">
                <button className="primary" type="button" onClick={review} disabled={!selectedOpportunity.executable || flow === "loading" || flow === "signing"}>Review</button>
                <button type="button" onClick={() => setShowAdvanced((value) => !value)}>{showAdvanced ? "Hide details" : "Details"}</button>
              </div>
            </div>
          ) : (
            <div className="empty">Connect wallet and quote.</div>
          )}

          <section className="rebalance-card">
            <div className="review-head">
              <div>
                <h3>Rebalance 50/50</h3>
                <p>{rebalanceText(rebalance)}</p>
              </div>
              {rebalance ? <span className={rebalance.executable ? "pill ok" : "pill blocked"}>{rebalance.executable ? "ready" : "blocked"}</span> : null}
            </div>
            {rebalance?.executable ? (
              <div className="rebalance-details">
                <span>{rebalance.sourceChain} -&gt; {rebalance.targetChain}</span>
                <strong>{numberFmt(rebalance.amount)} {rebalance.tokenSymbol}</strong>
                <small>{rebalance.cappedByTestMode ? `test cap ${numberFmt(rebalance.testCap)} ${rebalance.tokenSymbol}` : "full 50/50 amount"}</small>
              </div>
            ) : null}
            <div className="button-row">
              <button className="primary" type="button" onClick={reviewRebalance} disabled={!account || !allowed || !rebalance?.executable || flow === "loading" || flow === "signing"}>Rebalance</button>
              <button type="button" onClick={refreshQuote} disabled={!account || !allowed || flow === "loading" || flow === "signing"}>Refresh</button>
            </div>
          </section>

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

          <section className="balances-collapse">
            <button type="button" onClick={() => setShowBalances((value) => !value)}>
              {showBalances ? "Hide balances" : "Show balances"}
            </button>
            {showBalances ? (
              quote ? (
                <div className="balances-grid">
                  <div>
                    <h3>Ethereum</h3>
                    <Balance label="COTI" value={quote.balances.ethereum.tokens.coti.value} />
                    <Balance label="gCOTI" value={quote.balances.ethereum.tokens.gcoti.value} />
                    <Balance label="USDC" value={quote.balances.ethereum.tokens.usdc.value} />
                    <Balance label="ETH gas" value={quote.balances.ethereum.native.value} />
                  </div>
                  <div>
                    <h3>COTI</h3>
                    <Balance label="COTI" value={quote.balances.coti.tokens.coti.value} />
                    <Balance label="gCOTI" value={quote.balances.coti.tokens.gcoti.value} />
                    <Balance label="USDCe" value={quote.balances.coti.tokens.usdc.value} />
                    <Balance label="COTI gas" value={quote.balances.coti.native.value} />
                  </div>
                </div>
              ) : (
                <p className="muted">Balances appear after quoting.</p>
              )
            ) : null}
          </section>
        </section>
      </section>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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
