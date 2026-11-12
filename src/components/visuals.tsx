"use client";

import { useState } from "react";
import { ArrowDownUp, Cpu, Fuel, Send, Users } from "lucide-react";
import { TokenIcon } from "./brand";
import type { FlowVisual } from "@/domain/machine";

export function FlowMap({ tones, demo }: { tones: FlowVisual; demo: boolean }) {
  const steps = [
    { label: "Treasury SOL", tone: tones.solToSwap, icon: <TokenIcon symbol="SOL" /> },
    { label: "Swap.io route", tone: tones.swapToUsdc, icon: <span className="flow-symbol"><ArrowDownUp size={19} aria-hidden="true" /></span> },
    { label: "Treasury USDC", tone: tones.usdcToPayroll, icon: <TokenIcon symbol="USDC" /> },
    { label: "Payroll", tone: tones.payrollToPeople, icon: <span className="flow-symbol"><Send size={18} aria-hidden="true" /></span> },
    { label: "Contributors", tone: tones.payrollToPeople, icon: <span className="flow-symbol"><Users size={19} aria-hidden="true" /></span> },
  ];
  return <section className="panel flow-panel" aria-label="Treasury flow map">
    <div className="section-heading" style={{ marginBottom: 0 }}><div><div className="kicker">From treasury to team</div><h2>One flow. Explicit approvals.</h2></div><span className={demo ? "badge amber" : "badge cyan"}>{demo ? "DEMO LEDGER" : "RECORDED WORKFLOW"}</span></div>
    <div className="flow-track">{steps.map((step, i) => <div key={step.label} className={`flow-step ${step.tone}`}><span className="step-number">0{i + 1}</span>{step.icon}<strong>{step.label}</strong></div>)}</div>
    <div className="flow-caption"><span><Fuel size={13} aria-hidden="true" />Separate x402 reserve · {tones.reserveToX402 === "done" ? "API payment recorded" : "API payment needs separate verification"}</span><span>Quote ≠ swap ≠ payout</span></div>
  </section>;
}

export function Replay({ items }: { items: { id: string; at: string; kind: string; code: string; reason: string; next: string; observed: string }[] }) {
  const [index, setIndex] = useState(0);
  const item = items[index];
  if (!item) return <section className="panel"><div className="section-heading"><h2>Agent activity</h2><Cpu size={17} className="muted" aria-hidden="true" /></div><div className="empty-state"><Cpu size={25} aria-hidden="true" /><strong>Ready when you are</strong><p>No decisions yet. Run a funding analysis to see the inputs, checks and next action here.</p></div></section>;
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
