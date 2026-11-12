"use client";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { formatAtomic } from "../domain/money";
import type { TreasuryAttemptView, TreasuryPreview } from "../server/live-treasury";
import { approveTreasuryDraftAction, exportTreasuryReceiptAction, listTreasuryTransactionsAction, previewLivePayoutAction, previewLiveSwapAction, reconcileTreasuryTransactionAction, resumeTreasuryTransactionAction, submitSavedTreasuryTransactionAction, submitTreasuryTransactionAction } from "../server/treasury-actions";

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (value) => value.charCodeAt(0));
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
function must<T>(result: { ok: true; data: T } | { ok: false; message: string }): T { if (!result.ok) throw new Error(result.message); return result.data; }
export function TreasuryWallet({ kind, batchId, treasury, submissionEnabled, canPrepare = true }: { kind: "swap" | "payout"; batchId?: string; treasury: string; submissionEnabled: boolean; canPrepare?: boolean }) {
  const wallet = useWallet();
  const [preview, setPreview] = useState<TreasuryPreview | null>(null), [attemptId, setAttemptId] = useState<string | null>(null), [rows, setRows] = useState<TreasuryAttemptView[]>([]);
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
    setBundle("");
    if (!file) return;
    try {
      if (file.size > 500_000) throw new Error("Build bundle must be smaller than 500 KB");
      const text = await file.text(), parsed = JSON.parse(text);
      // Reject wallet/keypair files locally, before any network upload.
      if (!parsed || Array.isArray(parsed) || parsed.record?.plan?.url !== "https://hermes.swap.io/v1/swap/build-tx" || typeof parsed.response?.body !== "string") throw new Error("Select the exported Swap.io build bundle. Wallet/keypair files are never accepted");
      setBundle(text); setMessage("Build bundle selected locally. Preview will verify its API payment receipt and original response.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid bundle"); }
  }
  const p = preview?.manifest.proposal;
  return <section className="panel stack" data-testid={`live-${kind}-wallet`}>
    <div className="row"><strong>{kind === "swap" ? "Live Swap.io route" : "Live USDC payroll chunk"}</strong><span className="badge amber">MAINNET · OWNER SIGNATURE REQUIRED</span></div>
    <p style={{ overflowWrap: "anywhere" }}>Treasury: {treasury}</p>
    {!submissionEnabled && <p>Read-only preview is available. Submission remains disabled until the security-reviewed release and live organization are explicitly enabled.</p>}
    {kind === "swap" && <label>Verified Swap.io build bundle JSON<input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { void selectFile(event.target.files?.[0]); }} /><small>Export the existing paid unsigned build using the local CLI. Select its build bundle, never a wallet or keypair file. Supported route: direct Raydium CPMM SOL to USDC.</small></label>}
    <button className="btn" type="button" disabled={busy || !canPrepare || rows.some((row) => ["PREPARED", "SIGNED", "UNKNOWN"].includes(row.state)) || (kind === "swap" && !bundle)} onClick={() => { void build(); }}>Preview {kind === "swap" ? "live swap" : "next unpaid chunk"}</button>
    {p && <div className="stack" data-testid="treasury-review">
      <strong>Review this exact {p.kind}</strong>
      {preview.apiPaymentSignature && <p><a href={`https://solscan.io/tx/${preview.apiPaymentSignature}`} target="_blank" rel="noreferrer">Verified Swap.io API build payment</a> · This purchased an unsigned build; it did not execute the swap.</p>}
      <p>{p.kind === "swap" ? "Input" : "Total payroll"}: {formatAtomic(BigInt(p.maxInputAtomic), p.kind === "swap" ? 9 : 6)} {p.kind === "swap" ? "SOL" : "USDC"}.{p.kind === "swap" && <> Minimum output: {formatAtomic(BigInt(p.minOutputAtomic), 6)} USDC. Slippage ceiling: {p.slippageBps} bps.</>}</p>
      <p>Maximum SOL debit: {formatAtomic(BigInt(p.maxSolDebitLamports), 9)} SOL, including up to {formatAtomic(BigInt(p.maxFeeLamports), 9)} fee and {formatAtomic(BigInt(p.maxRentLamports), 9)} rent. SOL reserve: {formatAtomic(BigInt(p.solReserveLamports), 9)}. USDC reserve: {formatAtomic(BigInt(p.usdcReserveAtomic ?? "0"), 6)}.</p>
      <ul>{p.allocations.map((a) => <li key={a.id} style={{ overflowWrap: "anywhere" }}>{a.recipient} · {formatAtomic(BigInt(a.amountAtomic), 6)} USDC · {a.milestoneId}</li>)}</ul>
      <p style={{ overflowWrap: "anywhere" }}>Canonical USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v<br />Proposal hash: {preview.manifest.proposalHash}<br />Message hash: {preview.manifest.messageHash}<br />Expires: {p.expiresAt}</p>
      <label><input type="checkbox" checked={approved} disabled={busy || Boolean(attemptId)} onChange={(event) => setApproved(event.target.checked)} /> I approve this exact transaction, recipient list, minimum output and fee/reserve limits.</label>
      {!attemptId ? <button className="btn amber" type="button" disabled={busy || !approved || !submissionEnabled || !preview.submissionEnabled} onClick={() => { void authorize(); }}>Sign exact approval message</button> : <button className="btn primary" type="button" disabled={busy || !approved || !submissionEnabled} onClick={() => { void sign(); }}>Sign and submit this transaction once</button>}
    </div>}
    {message && <p role="alert">{message}</p>}
    {rows.map((row) => <article key={row.id} className="stack" data-testid="treasury-attempt">
      <div className="row"><span className="badge">{row.state}</span><small>{row.id}</small></div>
      {row.signature && <p style={{ overflowWrap: "anywhere" }}>{row.solscan ? <a href={row.solscan} target="_blank" rel="noreferrer">Verified Solscan receipt: {row.signature}</a> : <>Candidate transaction signature, settlement unverified: {row.signature}</>}</p>}
      {row.state === "CONFIRMED" && <button type="button" className="btn" disabled={busy} onClick={() => { void downloadReceipt(row.id); }}>Download verified receipt</button>}
      {row.resumable && <button type="button" className="btn" disabled={busy || !submissionEnabled} onClick={() => { void work(async () => { const value = must(await resumeTreasuryTransactionAction(row.id)); setPreview(value); setAttemptId(row.id); setApproved(true); setMessage("Resuming the same immutable approved transaction. No replacement transaction was created."); }); }}>Resume same transaction</button>}
      {row.state === "SIGNED" && <button type="button" className="btn" disabled={busy || !submissionEnabled} onClick={() => { void work(async () => { must(await submitSavedTreasuryTransactionAction(row.id)); setMessage("The durably saved transaction was submitted once. Awaiting reconciliation."); }); }}>Submit saved transaction once</button>}
      {["UNKNOWN", "SIGNED"].includes(row.state) && <button type="button" className="btn" disabled={busy} onClick={() => { void reconcile(row.id); }}>Reconcile on Solana</button>}
      {row.state === "PREPARED" && !row.resumable && <p>Expired prepared attempt is held for investigation. It will not be automatically replaced.</p>}
    </article>)}
  </section>;
}
