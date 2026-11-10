"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { logoutAction, readAction } from "@/server/actions";

const LINKS = [
  ["/", "Mission"],
  ["/treasury", "Treasury"],
  ["/contributors", "Contributors"],
  ["/milestones", "Milestones"],
  ["/payroll", "Payroll"],
  ["/agent", "Agent"],
  ["/fuel", "Agent fuel"],
  ["/x402", "x402"],
  ["/swap", "Swap"],
  ["/proof", "Proof"],
  ["/analytics", "Analytics"],
  ["/settings", "Settings"],
];

export function Shell({
  flash,
  role,
  name,
  authMode,
  orgMode,
  paused,
  pending,
  unread,
  children,
}: {
  flash: string | null;
  role: string;
  name: string;
  authMode: string;
  orgMode: string;
  paused: boolean;
  pending: number;
  unread: number;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [walletError, setWalletError] = useState<string | null>(null);
  const wallet = useWallet();
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme ?? "dark");
    if (flash) document.cookie = "ap_flash=; Max-Age=0; path=/";
  }, [flash]);
  const links = role === "contributor" ? LINKS.filter((entry) => entry[0] === "/milestones" || entry[0] === "/proof") : LINKS;
  return (
    <div className={collapsed ? "shell collapsed" : "shell"}>
      <aside className={open ? "side open" : "side"}>
        <div className="brand">
          <div className="mark">A</div>
          {!collapsed && <div><strong>Autopilot</strong><div className="kicker">Payday</div></div>}
        </div>
        <nav className="stack">
          {links.map((entry) => {
            const href = entry[0];
            const label = entry[1];
            if (!href || !label) return null;
            return (
              <Link key={href} href={href} className={path === href ? "nav-link active" : "nav-link"} onClick={() => setOpen(false)}>
                <span>{label.slice(0, 1)}</span>
                {!collapsed && label}
              </Link>
            );
          })}
          {role !== "contributor" && <Link className="nav-link" href="/presentation">Presentation</Link>}
        </nav>
        <div style={{ marginTop: "auto" }} className="stack">
          <button className="btn" type="button" onClick={() => setCollapsed((value) => !value)}>Collapse</button>
        </div>
      </aside>
      <div className="main">
        <header className="top">
          <div className="row">
            <button className="btn" type="button" onClick={() => setOpen((value) => !value)}>Menu</button>
            <div>
              <div className="kicker">Northstar Studio</div>
              <strong>{name}</strong>
            </div>
          </div>
          <div className="row">
            <span className={orgMode === "demo" ? "badge amber" : orgMode === "live" ? "badge mint" : "badge cyan"} data-testid="mode-badge">
              {orgMode === "demo" ? "DEMO" : orgMode === "live" ? "LIVE" : "LIVE READ-ONLY"}
            </span>
            <span className="badge">{authMode === "demo" ? "Demo sign-in" : "Wallet sign-in"} · {role}</span>
            {paused && <span className="badge coral">Paused</span>}
            {pending > 0 && <Link className="badge amber" href="/agent">Pending {pending}</Link>}
            <form action={readAction}><button className="btn" type="submit">Alerts {unread}</button></form>
            <button className="btn" type="button" onClick={() => {
              const next = theme === "dark" ? "light" : "dark";
              document.documentElement.dataset.theme = next;
              localStorage.setItem("ap-theme", next);
              setTheme(next);
            }}>{theme === "dark" ? "Light" : "Dark"}</button>
            <WalletChip connected={wallet.connected} address={wallet.publicKey?.toBase58() ?? null} onConnect={() => { void wallet.connect().catch(() => setWalletError("Choose and connect a wallet from the sign-in page first.")); }} onDisconnect={() => { void wallet.disconnect().catch(() => setWalletError("Wallet disconnect did not complete.")); }} />
            <form action={logoutAction}><button className="btn" type="submit">Sign out</button></form>
          </div>
        </header>
        {flash && <div className="flash" role="status">{flash}</div>}
        {walletError && <div className="flash" role="alert">{walletError} <Link href="/login">Wallet sign-in</Link></div>}
        {children}
      </div>
    </div>
  );
}

function WalletChip({ connected, address, onConnect, onDisconnect }: { connected: boolean; address: string | null; onConnect: () => void; onDisconnect: () => void }) {
  if (!connected || !address) return <button className="btn" type="button" onClick={onConnect}>Connect wallet</button>;
  return <button className="btn" type="button" onClick={onDisconnect}>{address.slice(0, 4)}…{address.slice(-4)}</button>;
}
