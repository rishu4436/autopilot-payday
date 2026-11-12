"use client";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { ArrowDown, ArrowUpRight, Clock3, FileCheck2, LoaderCircle, ShieldCheck, Upload } from "lucide-react";
import { TokenIcon } from "./brand";
import { formatAtomic } from "../domain/money";
import type { TreasuryAttemptView, TreasuryPreview } from "../server/live-treasury";
import { approveTreasuryDraftAction, exportTreasuryReceiptAction, listTreasuryTransactionsAction, previewLivePayoutAction, previewLiveSwapAction, reconcileTreasuryTransactionAction, resumeTreasuryTransactionAction, submitSavedTreasuryTransactionAction, submitTreasuryTransactionAction } from "../server/treasury-actions";

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (value) => value.charCodeAt(0));
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
function must<T>(result: { ok: true; data: T } | { ok: false; message: string }): T { if (!result.ok) throw new Error(result.message); return result.data; }
export function TreasuryWallet({ kind, batchId, treasury, submissionEnabled, canPrepare = true }: { kind: "swap" | "payout"; batchId?: string; treasury: string; submissionEnabled: boolean; canPrepare?: boolean }) {
  const wallet = useWallet();
  const [preview, setPreview] = useState<TreasuryPreview | null>(null), [attemptId, setAttemptId] = useState<string | null>(null), [rows, setRows] = useState<TreasuryAttemptView[]>([]);
  const [bundleName, setBundleName] = useState(""), [clock, setClock] = useState(0);
  const [bundle, setBundle] = useState(""), [approved, setApproved] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const refresh = useCallback(async () => { const result = await listTreasuryTransactionsAction(kind, batchId); if (result.ok) setRows(result.data); }, [kind, batchId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const pending = rows.filter((row) => row.state === "UNKNOWN");
    if (!pending.length || busy) return;
    const timer = window.setTimeout(async () => {
      for (const row of pending) {
        const result = await reconcileTreasuryTransactionAction(row.id);
        if (result.ok && ["CONFIRMED", "FAILED"].includes(result.data.state)) { window.location.reload(); return; }
      }
      await refresh();
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [rows, busy, refresh]);
  useEffect(() => {
    if (!preview) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [preview]);
  async function work(task: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await task(); } catch (error) { setMessage(error instanceof Error ? error.message : "Wallet request failed. Inspect the stored attempt before authorizing another transaction."); }
    finally { setBusy(false); await refresh(); }
  }
  async function reconcile(id: string) {
    let terminal = false;
    await work(async () => { const result = must(await reconcileTreasuryTransactionAction(id)); terminal = ["CONFIRMED", "FAILED"].includes(result.state); setMessage(`Independent chain reconciliation: ${result.state}.`); });
    if (terminal) window.location.reload();
  }
  async function downloadReceipt(id: string) {
    await work(async () => {
      const receipt = must(await exportTreasuryReceiptAction(id));
      const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `payday-${kind}-${receipt.signature}.json`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Receipt independently rechecked at finalized commitment and downloaded. It includes the public treasury and recipient addresses.");
    });
  }
  function assertWallet() {
    if (!wallet.connected || wallet.publicKey?.toBase58() !== treasury) throw new Error("Connect the exact treasury owner wallet shown below before approving or signing");
  }
  async function build() {
    await work(async () => {
      const value = must(kind === "payout" ? await previewLivePayoutAction(batchId!) : await previewLiveSwapAction(bundle));
      setPreview(value); setAttemptId(null); setApproved(false);
      setMessage("Unsigned transaction independently inspected and simulated. Review the exact list and costs below.");
    });
  }
  async function authorize() {
    await work(async () => {
      assertWallet();
      if (!preview || !approved || !wallet.signMessage) throw new Error("Review the transaction, check the approval box and use a wallet that supports message signing");
      const signature = await wallet.signMessage(new TextEncoder().encode(preview.approvalMessage));
      const result = must(await approveTreasuryDraftAction(preview.id, bs58.encode(signature)));
      setAttemptId(result.attemptId); setMessage("Exact approval stored. Use the separate signing button to authorize this on-chain transaction.");
    });
  }
  async function sign() {
    await work(async () => {
      assertWallet();
      if (!preview || !attemptId || !wallet.signTransaction || !approved) throw new Error("Approve this exact transaction first");
      const unsigned = VersionedTransaction.deserialize(fromBase64(preview.unsignedBase64));
      const signed = await wallet.signTransaction(unsigned);
      const result = must(await submitTreasuryTransactionAction(attemptId, toBase64(signed.serialize())));
      setMessage(result.state === "CONFIRMED" ? "Finalized settlement verified." : "Submitted once. Settlement is unresolved until independent finality verification; do not create a replacement payment.");
      setPreview(null); setAttemptId(null); setApproved(false);
    });
  }
  async function selectFile(file: File | undefined) {
    setBundle(""); setBundleName("");
    if (!attemptId) { setPreview(null); setApproved(false); }
    if (!file) return;
    try {
      if (file.size > 500_000) throw new Error("Build bundle must be smaller than 500 KB");
      const text = await file.text(), parsed = JSON.parse(text);
      // Reject wallet/keypair files locally, before any network upload.
      if (!parsed || Array.isArray(parsed) || parsed.record?.plan?.url !== "https://hermes.swap.io/v1/swap/build-tx" || typeof parsed.response?.body !== "string") throw new Error("Select the exported Swap.io build bundle. Wallet/keypair files are never accepted");
      setBundle(text); setBundleName(file.name); setMessage("Build bundle selected locally. Preview will verify its API payment receipt and original response.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid bundle"); }
  }
  const p = preview?.manifest.proposal;
  const secondsLeft = p ? Math.max(0, Math.ceil((Date.parse(p.expiresAt) - (clock || Date.now())) / 1000)) : 0;
  const expired = Boolean(p && secondsLeft === 0);
  return <section className={`panel stack swap-terminal ${kind === "swap" ? "swap-terminal-route" : "payout-terminal"}`} data-testid={`live-${kind}-wallet`}>
    <div className="section-heading" style={{ marginBottom: 0 }}><div><span className="kicker">{kind === "swap" ? "Powered by Swap.io" : "Owner-approved transfer"}</span><h2>{kind === "swap" ? "Swap SOL for USDC" : "Pay the next payroll chunk"}</h2></div><ShieldCheck size={20} className="accent-text" aria-hidden="true" /></div>
    <div className="transaction-steps" aria-label="Transaction progress"><span className={!preview ? "active" : ""}><i className="step-index">1</i>Preview</span><span className={preview && !attemptId ? "active" : ""}><i className="step-index">2</i>Approve</span><span className={attemptId ? "active" : ""}><i className="step-index">3</i>Sign & settle</span></div>
    <div className="treasury-address"><span className="kicker">Signing treasury</span><br />{treasury}</div>
    {!submissionEnabled && <div className="inline-notice amber"><span className="badge amber">READ-ONLY</span><p style={{ marginTop: 8 }}>You can inspect a preview. Submission requires an enabled live workspace and the reviewed deployment configuration.</p></div>}
    {kind === "swap" && <>
      <div className="token-pair"><div className="token-amount-box"><div className="kicker">You pay</div><div className="row"><span className="num">{p ? formatAtomic(BigInt(p.maxInputAtomic), 9) : "—"}</span><span className="token-name"><TokenIcon symbol="SOL" small />SOL</span></div></div><div className="swap-direction"><ArrowDown size={16} aria-hidden="true" /></div><div className="token-amount-box"><div className="kicker">Minimum you receive</div><div className="row"><span className="num">{p ? formatAtomic(BigInt(p.minOutputAtomic), 6) : "—"}</span><span className="token-name"><TokenIcon symbol="USDC" small />USDC</span></div></div></div>
      <label className="bundle-upload"><Upload size={20} className="accent-text" aria-hidden="true" /><strong>{bundleName || "Import your Swap.io build"}</strong><span>Verified Swap.io build bundle JSON</span><input type="file" accept=".json,application/json" disabled={busy || Boolean(attemptId) || rows.some((row) => ["PREPARED", "SIGNED", "UNKNOWN"].includes(row.state))} onChange={(event) => { void selectFile(event.target.files?.[0]); }} /><small>Select an exported build bundle. Keypair files are rejected before upload.</small></label>
      <div className="swap-facts"><div className="swap-fact"><span>Supported route</span><span>Direct Raydium CPMM</span></div><div className="swap-fact"><span>Maximum input</span><span>0.01 SOL</span></div><div className="swap-fact"><span>Slippage ceiling</span><span>{p ? `${p.slippageBps} bps` : "50 bps or lower policy"}</span></div></div>
    </>}
    <button className="btn primary" type="button" disabled={busy || !canPrepare || rows.some((row) => ["PREPARED", "SIGNED", "UNKNOWN"].includes(row.state)) || (kind === "swap" && !bundle)} onClick={() => { void build(); }}>{busy && <LoaderCircle className="spin" size={14} aria-hidden="true" />}Preview {kind === "swap" ? "live swap" : "next unpaid chunk"}</button>
    {p && <div className="stack review-card" data-testid="treasury-review">
      <div className="row" style={{ justifyContent: "space-between" }}><strong>Review this exact {p.kind}</strong><span className={`badge ${expired ? "coral" : "amber"}`}><Clock3 size={11} aria-hidden="true" />{expired ? "EXPIRED" : `${secondsLeft}s remaining`}</span></div>
      {preview.apiPaymentSignature && <p style={{ fontSize: 10 }}><a href={`https://solscan.io/tx/${preview.apiPaymentSignature}`} target="_blank" rel="noreferrer">Verified Swap.io API build payment</a> <ArrowUpRight size={11} style={{ display: "inline" }} aria-hidden="true" /><br />This paid for unsigned bytes. It did not execute the swap.</p>}
      <p>{p.kind === "swap" ? "Input" : "Total payroll"}: <strong>{formatAtomic(BigInt(p.maxInputAtomic), p.kind === "swap" ? 9 : 6)} {p.kind === "swap" ? "SOL" : "USDC"}</strong>.{p.kind === "swap" && <> Minimum output: <strong>{formatAtomic(BigInt(p.minOutputAtomic), 6)} USDC</strong>.</>}</p>
      <div className="swap-facts"><div className="swap-fact"><span>Maximum SOL debit</span><span>{formatAtomic(BigInt(p.maxSolDebitLamports), 9)} SOL</span></div><div className="swap-fact"><span>Maximum network fee</span><span>{formatAtomic(BigInt(p.maxFeeLamports), 9)} SOL</span></div><div className="swap-fact"><span>Maximum account rent</span><span>{formatAtomic(BigInt(p.maxRentLamports), 9)} SOL</span></div><div className="swap-fact"><span>SOL reserve preserved</span><span>{formatAtomic(BigInt(p.solReserveLamports), 9)} SOL</span></div><div className="swap-fact"><span>USDC reserve preserved</span><span>{formatAtomic(BigInt(p.usdcReserveAtomic ?? "0"), 6)} USDC</span></div></div>
      {p.allocations.length > 0 && <div className="stack"><div className="kicker">Exact recipients</div>{p.allocations.map((a) => <div key={a.id} className="treasury-address">{a.recipient}<br /><strong>{formatAtomic(BigInt(a.amountAtomic), 6)} USDC</strong> · {a.milestoneId}</div>)}</div>}
      <details><summary>Transaction identity & verification</summary><div className="review-hashes" style={{ overflowWrap: "anywhere", marginTop: 10 }}>Canonical USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v<br />Proposal hash: {preview.manifest.proposalHash}<br />Message hash: {preview.manifest.messageHash}<br />Expires: {p.expiresAt}</div></details>
      <label className="approval-check"><input type="checkbox" checked={approved} disabled={busy || Boolean(attemptId) || expired} onChange={(event) => setApproved(event.target.checked)} /><span>I approve this exact transaction, recipient list, minimum output and fee/reserve limits.</span></label>
      {!attemptId ? <button className="btn amber" type="button" disabled={busy || !approved || expired || !submissionEnabled || !preview.submissionEnabled} onClick={() => { void authorize(); }}>Sign exact approval message</button> : <button className="btn primary" type="button" disabled={busy || !approved || expired || !submissionEnabled} onClick={() => { void sign(); }}>Sign and submit this transaction once</button>}
      {expired && <p style={{ fontSize: 10 }}>{attemptId ? "This approved attempt is held for investigation. Do not create a replacement transaction." : "This unsigned preview expired. Prepare a fresh preview before approving."}</p>}
    </div>}
    {message && <p className="inline-notice" role="alert">{message}</p>}
    {rows.length > 0 && <div className="section-heading" style={{ marginBottom: 0 }}><h2>Transaction history</h2><FileCheck2 size={16} className="muted" aria-hidden="true" /></div>}
    {rows.map((row) => <article key={row.id} className="stack attempt-card" data-testid="treasury-attempt">
      <div className="row" style={{ justifyContent: "space-between" }}><span className={`badge ${row.state === "CONFIRMED" ? "mint" : row.state === "FAILED" ? "coral" : "amber"}`}>{row.state}</span><small>{row.id.slice(0, 8)}</small></div>
      {row.signature && <p style={{ overflowWrap: "anywhere" }}>{row.solscan ? <a href={row.solscan} target="_blank" rel="noreferrer">Verified Solscan receipt: {row.signature}</a> : <>Candidate transaction signature, settlement unverified: {row.signature}</>}</p>}
      {row.state === "CONFIRMED" && <button type="button" className="btn" disabled={busy} onClick={() => { void downloadReceipt(row.id); }}>Download verified receipt</button>}
      {row.resumable && <button type="button" className="btn" disabled={busy || !submissionEnabled} onClick={() => { void work(async () => { const value = must(await resumeTreasuryTransactionAction(row.id)); setPreview(value); setAttemptId(row.id); setApproved(true); setMessage("Resuming the same immutable approved transaction. No replacement transaction was created."); }); }}>Resume same transaction</button>}
      {row.state === "SIGNED" && <button type="button" className="btn" disabled={busy || !submissionEnabled} onClick={() => { void work(async () => { must(await submitSavedTreasuryTransactionAction(row.id)); setMessage("The durably saved transaction was submitted once. Awaiting reconciliation."); }); }}>Submit saved transaction once</button>}
      {["UNKNOWN", "SIGNED"].includes(row.state) && <button type="button" className="btn" disabled={busy} onClick={() => { void reconcile(row.id); }}>Reconcile on Solana</button>}
      {row.state === "PREPARED" && !row.resumable && <p>Expired prepared attempt is held for investigation. It will not be automatically replaced.</p>}
    </article>)}
  </section>;
}
