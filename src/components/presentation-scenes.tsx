"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { PublicPaidEvidence } from "../hermes/evidence";
const SCENES = [
  ["Work is approved", "Maya, Leo, and Aria finished the launch work. The owner approved 40, 50, and 35 USDC. The agent did not approve its own milestones."],
  ["The treasury is short", "Approved payroll is 125 USDC. Payroll-available USDC is 35. The gap is 90 USDC. SOL is still in the treasury. No exchange rate is assumed."],
  ["The quote asks to be paid", "Swap.io answers with HTTP 402 before it prices the route. The captured challenge on 2026-11-10 asked for 3007 atomic USDC, about a third of a cent. Nothing was spent to see that price."],
  ["A route comes back", "Paid integration is pending owner authorization. No paid response has been demonstrated. A demo route is labeled SIMULATED. A live route needs a settlement receipt before it can be trusted."],
  ["The owner authorizes the swap", "Live swaps require security review, explicit live opt-in and exact treasury-wallet approval. All demo funding is SIMULATED; 1 SOL to 90 USDC is a fixture, never a market quote."],
  ["Contributors get USDC", "The demo records SIMULATED payroll only. No live swap or payout has been executed. Chain evidence is required before claiming live settlement."],
];
export default function PresentationScenes({ unpaid, paid, evidenceStatus }: { unpaid: { at: string; chargeAtomic: string; request: unknown } | null; paid: PublicPaidEvidence | null; evidenceStatus: string }) {
  const scenes = SCENES.map((scene) => [...scene]);
  scenes[2] = ["The quote asks to be paid", unpaid ? `Actual Swap.io HTTP 402 captured ${unpaid.at}. The request quotes 0.001 SOL into USDC at 50 bps slippage and asks for ${unpaid.chargeAtomic} atomic USDC (${(Number(unpaid.chargeAtomic) / 1_000_000).toFixed(6)} USDC). This public capture uses a placeholder address. No payment occurred. x402 advertises a price; an approved payer signs that exact charge, and the API returns a quote after settlement.` : "No validated unpaid HTTP 402 capture is available. Run the read-only challenge capture before presenting live evidence."];
  scenes[3] = ["A route comes back", paid ? `A genuine paid quote is recorded at ${paid.at}: ${paid.quotes.length} route(s), verified API payment of ${paid.plan.terms.amount} atomic USDC at Solana slot ${paid.evidence.slot}. This payment purchased an API response. No swap or contributor payout occurred.` : `Paid integration is pending owner authorization. ${evidenceStatus} No paid response has been demonstrated. A demo route is labeled SIMULATED.`];
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") setIndex((value) => Math.min(SCENES.length - 1, value + 1));
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(0, value - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const scene = scenes[index] ?? scenes[0];
  return (
    <main className="scene">
      <div className="row no-print">
        <span className="badge amber" data-testid="presentation-mode">DEMO</span>
        <span className="kicker">Scene {index + 1} of {SCENES.length}</span>
        <Link href="/">Exit</Link>
      </div>
      <p className="badge amber">SIMULATED PAYROLL | {paid ? "Verified API payment available" : "No verified paid quote"} | No live swap or payout evidence</p>
      <p className="kicker">Autopilot Payday</p>
      <h1 className="num" style={{ fontSize: "clamp(40px, 7vw, 88px)", margin: 0 }}>{scene?.[0]}</h1>
      <p style={{ fontSize: "clamp(18px, 2vw, 28px)", maxWidth: 900 }}>{scene?.[1]}</p>
      {index === 2 && unpaid && <details><summary>Actual unpaid request</summary><pre style={{ fontSize: 14, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>POST https://hermes.swap.io/v1/swap/quote{"\n"}{JSON.stringify(unpaid.request, null, 2)}</pre></details>}
      {index === 3 && paid && <div><p><a href={paid.evidence.solscan} target="_blank" rel="noreferrer">Verified Solscan API payment receipt</a></p><p style={{ overflowWrap: "anywhere", fontSize: 14 }}>{paid.evidence.signature}</p><ul>{paid.quotes.map((quote, i) => <li key={`${quote.provider}:${i}`}>{quote.provider}: {quote.inputAtomic ?? "unreported"} input atomic / {quote.outputAtomic ?? "unreported"} output atomic</li>)}</ul></div>}
      <div className="row">
        <button className="btn" type="button" onClick={() => setIndex((value) => Math.max(0, value - 1))}>Back</button>
        <button className="btn primary" type="button" onClick={() => setIndex((value) => Math.min(SCENES.length - 1, value + 1))}>Next</button>
      </div>
    </main>
  );
}
