"use client";

import { useState } from "react";
import type { FlowVisual } from "@/domain/machine";

const NODES = [
  ["sol", "Treasury SOL", 70, 70],
  ["swap", "Swap", 250, 70],
  ["usdc", "Treasury USDC", 450, 70],
  ["pay", "Payroll", 650, 70],
  ["people", "Contributors", 820, 70],
  ["reserve", "API reserve", 250, 210],
  ["x402", "Swap.io x402", 450, 210],
] as const;

export function FlowMap({ tones, demo }: { tones: FlowVisual; demo: boolean }) {
  const edges = [
    [tones.solToSwap, 110, 70, 210, 70],
    [tones.swapToUsdc, 290, 70, 410, 70],
    [tones.usdcToPayroll, 510, 70, 610, 70],
    [tones.payrollToPeople, 690, 70, 780, 70],
    [tones.reserveToX402, 290, 210, 410, 210],
  ] as const;
  return (
    <section className="panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="kicker">Treasury flow</div>
          <strong>Funds and obligations</strong>
        </div>
        {demo && <span className="badge amber">DEMO LEDGER</span>}
      </div>
      <svg viewBox="0 0 920 280" role="img" aria-label="Treasury flow map" style={{ width: "100%", height: "auto" }}>
        {edges.map(([tone, x1, y1, x2, y2]) => (
          <line key={`${x1}-${y1}`} className={`edge ${tone}`} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
        {NODES.map(([id, label, x, y]) => (
          <g key={id}>
            <rect x={x - 58} y={y - 28} width="116" height="56" rx="14" fill="var(--bg-elev-2)" stroke="var(--line)" />
            <text x={x} y={y + 4} textAnchor="middle" fill="var(--text)" fontSize="12">{label}</text>
          </g>
        ))}
      </svg>
      <p style={{ color: "var(--muted)" }}>Edges turn complete only after the recorded state says so. A quote is not a payout.</p>
    </section>
  );
}

export function Replay({ items }: { items: { id: string; at: string; kind: string; code: string; reason: string; next: string; observed: string }[] }) {
  const [index, setIndex] = useState(0);
  const item = items[index];
  if (!item) return <section className="panel">No decisions yet. Run a funding analysis.</section>;
  return (
    <section className="panel stack">
      <div className="kicker">Decision replay</div>
      <div className="row">
        {items.slice(0, 8).map((row, rowIndex) => (
          <button key={row.id} className={rowIndex === index ? "btn primary" : "btn"} type="button" onClick={() => setIndex(rowIndex)}>
            {rowIndex + 1}
          </button>
        ))}
      </div>
      <strong>{item.reason}</strong>
      <p>{item.next}</p>
      <div className="row"><span className="badge">{item.kind}</span><span className="badge">{item.code}</span><span className="kicker">{item.at}</span></div>
      <details>
        <summary>Inputs the rule used</summary>
        <pre style={{ whiteSpace: "pre-wrap" }}>{item.observed}</pre>
      </details>
    </section>
  );
}

export function Microscope({
  request,
  challenge,
  payment,
  retry,
  response,
}: {
  request: string;
  challenge: string;
  payment: string;
  retry: string;
  response: string;
}) {
  const steps = [
    ["Request", request],
    ["HTTP 402", challenge],
    ["Payment", payment],
    ["Retry", retry],
    ["Response", response],
  ];
  const [open, setOpen] = useState(0);
  const current = steps[open] ?? steps[0];
  return (
    <section className="panel stack">
      <div className="kicker">x402 microscope</div>
      <div className="row">
        {steps.map(([label], index) => (
          <button key={label} className={index === open ? "btn primary" : "btn"} type="button" onClick={() => setOpen(index)}>{label}</button>
        ))}
      </div>
      <h3 style={{ margin: 0 }}>{current?.[0]}</h3>
      <pre style={{ whiteSpace: "pre-wrap" }}>{current?.[1]}</pre>
    </section>
  );
}
