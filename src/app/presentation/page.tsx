"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
const SCENES = [
  ["Work is approved", "Maya, Leo, and Aria finished the launch work. The owner approved 40, 50, and 35 USDC. The agent did not approve its own milestones."],
  ["The treasury is short", "Approved payroll is 125 USDC. Payroll-available USDC is 35. The gap is 90 USDC. SOL is still in the treasury. No exchange rate is assumed."],
  ["The quote asks to be paid", "Swap.io answers with HTTP 402 before it prices the route. The captured challenge on 2026-11-10 asked for 3007 atomic USDC, about a third of a cent. Nothing was spent to see that price."],
  ["A route comes back", "Paid integration is pending owner authorization. No paid response has been demonstrated. A demo route is labeled SIMULATED. A live route needs a settlement receipt before it can be trusted."],
  ["The owner authorizes the swap", "This scene describes the intended workflow. Live swaps are disabled pending instruction validation. All demo funding is SIMULATED; 1 SOL to 90 USDC is a fixture, never a market quote."],
  ["Contributors get USDC", "The demo records SIMULATED payroll only. No live swap or payout has been executed. Chain evidence is required before claiming live settlement."],
];
export default function PresentationPage() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") setIndex((value) => Math.min(SCENES.length - 1, value + 1));
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(0, value - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const scene = SCENES[index] ?? SCENES[0];
  return (
    <main className="scene">
      <div className="row no-print">
        <span className="badge amber" data-testid="presentation-mode">DEMO</span>
        <span className="kicker">Scene {index + 1} of {SCENES.length}</span>
        <Link href="/">Exit</Link>
      </div>
      <p className="badge amber">SIMULATED PAYROLL ' No paid quote, live swap or live payout evidence</p>
      <p className="kicker">Autopilot Payday</p>
      <h1 className="num" style={{ fontSize: "clamp(40px, 7vw, 88px)", margin: 0 }}>{scene?.[0]}</h1>
      <p style={{ fontSize: "clamp(18px, 2vw, 28px)", maxWidth: 900 }}>{scene?.[1]}</p>
      <div className="row">
        <button className="btn" type="button" onClick={() => setIndex((value) => Math.max(0, value - 1))}>Back</button>
        <button className="btn primary" type="button" onClick={() => setIndex((value) => Math.min(SCENES.length - 1, value + 1))}>Next</button>
      </div>
    </main>
  );
}
