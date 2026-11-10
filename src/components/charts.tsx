"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function FuelChart({ points }: { points: { day: string; usdc: number; evidence: string }[] }) {
  if (points.length === 0) return <section className="panel">No API spend recorded.</section>;
  return (
    <section className="panel">
      <div className="kicker">Spending history</div>
      <p>Display scale only. Exact amounts stay in the table. Simulated rows are labeled in the evidence column.</p>
      <div style={{ width: "100%", height: 240 }}>
        <ResponsiveContainer>
          <BarChart data={points}>
            <XAxis dataKey="day" stroke="currentColor" />
            <YAxis stroke="currentColor" />
            <Tooltip />
            <Bar dataKey="usdc" fill="var(--cyan)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function VolumeChart({ points }: { points: { day: string; usdc: number }[] }) {
  if (points.length === 0) return <p>No payment volume recorded.</p>;
  return (
    <div style={{ width: "100%", height: 240 }}>
      <ResponsiveContainer>
        <BarChart data={points}>
          <XAxis dataKey="day" stroke="currentColor" />
          <YAxis stroke="currentColor" />
          <Tooltip />
          <Bar dataKey="usdc" fill="var(--mint)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
