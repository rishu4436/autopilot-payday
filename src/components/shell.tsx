"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { ArrowDownUp, AudioLines, Bell, ChevronRight, Cpu, Fuel, LayoutDashboard, LogOut, Menu, Moon, Network, PanelLeftClose, Presentation, ReceiptText, Settings2, ShieldCheck, Sun, Users, Wallet, X, ListChecks, ChartNoAxesCombined } from "lucide-react";
import { logoutAction, readAction } from "@/server/actions";
import { BrandMark } from "./brand";

const LINKS = [
  { href: "/", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
  { href: "/treasury", label: "Treasury", icon: Wallet, group: "Workspace" },
  { href: "/swap", label: "Swap", icon: ArrowDownUp, group: "Workspace" },
  { href: "/payroll", label: "Payroll", icon: AudioLines, group: "Workspace" },
  { href: "/contributors", label: "Contributors", icon: Users, group: "Team & activity" },
  { href: "/milestones", label: "Milestones", icon: ListChecks, group: "Team & activity" },
  { href: "/agent", label: "Agent", icon: Cpu, group: "Team & activity" },
  { href: "/fuel", label: "Agent fuel", icon: Fuel, group: "Team & activity" },
  { href: "/x402", label: "x402", icon: Network, group: "Team & activity" },
  { href: "/proof", label: "Proof", icon: ReceiptText, group: "Manage" },
  { href: "/analytics", label: "Analytics", icon: ChartNoAxesCombined, group: "Manage" },
  { href: "/settings", label: "Settings", icon: Settings2, group: "Manage" },
];

export function Shell({ flash, role, name, authMode, orgMode, orgName, paused, pending, unread, children }: {
  flash: string | null; role: string; name: string; authMode: string; orgMode: string; orgName: string; paused: boolean; pending: number; unread: number; children: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false), [collapsed, setCollapsed] = useState(false), [theme, setTheme] = useState("dark");
  const [walletError, setWalletError] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const wallet = useWallet();
  useEffect(() => { setTheme(document.documentElement.dataset.theme ?? "dark"); if (flash) document.cookie = "ap_flash=; Max-Age=0; path=/"; }, [flash]);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1000px)");
    const update = () => setNarrow(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); menuButton.current?.focus(); } };
    document.addEventListener("keydown", dismiss); return () => document.removeEventListener("keydown", dismiss);
  }, [open]);
  const links = role === "contributor" ? LINKS.filter((entry) => entry.href === "/milestones" || entry.href === "/proof") : LINKS;
  const current = LINKS.find((entry) => entry.href === path)?.label ?? "Workspace";
  return <div className={collapsed ? "shell collapsed" : "shell"}>
    <a className="skip-link" href="#workspace-content">Skip to content</a>
    {open && <button className="nav-backdrop" type="button" aria-label="Close navigation" onClick={() => { setOpen(false); menuButton.current?.focus(); }} />}
    <aside id="workspace-navigation" inert={narrow && !open} className={open ? "side open" : "side"} aria-label="Workspace navigation">
      <Link className="brand" href="/" aria-label="Autopilot Payday home"><BrandMark /><span className="brand-wordmark">payday<span className="brand-dot">.</span><small>by Autopilot</small></span></Link>
      <div className="workspace-card"><span className="workspace-avatar">{orgName.slice(0, 1)}</span><div className="workspace-copy"><strong>{orgName}</strong><small>{orgMode === "demo" ? "Demo workspace" : orgMode === "uat_readonly" ? "Test-only workspace" : "Treasury workspace"}</small></div></div>
      <nav aria-label="Main navigation">
        {["Workspace", "Team & activity", "Manage"].map((group) => {
          const entries = links.filter((entry) => entry.group === group);
          if (!entries.length) return null;
          return <div className="nav-group" key={group}><div className="nav-group-label">{group}</div>{entries.map(({ href, label, icon: Icon }) => <Link key={href} href={href} title={collapsed ? label : undefined} aria-label={label} aria-current={path === href ? "page" : undefined} className={path === href ? "nav-link active" : "nav-link"} onClick={() => setOpen(false)}><Icon size={18} strokeWidth={1.6} aria-hidden="true" /><span className="nav-label">{label}</span>{href === "/agent" && pending > 0 && <span className="nav-count">{pending}</span>}</Link>)}</div>;
        })}
      </nav>
      <div className="sidebar-bottom">
        {role !== "contributor" && <Link className="nav-link" href="/presentation" aria-label="Presentation"><Presentation size={18} aria-hidden="true" /><span className="nav-label">Presentation</span><ChevronRight className="nav-trailing" size={14} aria-hidden="true" /></Link>}
        <div className="sidebar-assurance"><ShieldCheck size={17} aria-hidden="true" /><span>Treasury keys stay<br />in your wallet.</span></div>
        <button className="collapse-control" type="button" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} onClick={() => setCollapsed((value) => !value)}><PanelLeftClose size={17} aria-hidden="true" /><span className="nav-label">Collapse</span></button>
      </div>
    </aside>
    <div className="main">
      <header className="top">
        <div className="top-location"><button ref={menuButton} className="icon-button mobile-menu" type="button" aria-label={open ? "Close menu" : "Menu"} aria-expanded={open} aria-controls="workspace-navigation" onClick={() => setOpen((value) => !value)}>{open ? <X size={20} /> : <Menu size={20} />}</button><span className="breadcrumb-root">Workspace</span><ChevronRight size={14} className="muted" aria-hidden="true" /><strong>{current}</strong></div>
        <div className="top-actions">
          <span className={orgMode === "demo" ? "badge amber" : orgMode === "live" ? "badge mint" : "badge cyan"} data-testid="mode-badge">{orgMode === "demo" ? "DEMO" : orgMode === "live" ? "LIVE" : orgMode === "uat_readonly" ? "TEST READ-ONLY" : "LIVE READ-ONLY"}</span>
          {paused && <span className="badge coral">Paused</span>}
          <button className="icon-button theme-control" type="button" aria-label={theme === "dark" ? "Light theme" : "Dark theme"} title={theme === "dark" ? "Light theme" : "Dark theme"} onClick={() => { const next = theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; try { localStorage.setItem("ap-theme", next); } catch { /* Theme still applies without storage. */ } setTheme(next); }}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
          <form action={readAction}><button className="icon-button notification-control" type="submit" aria-label={`Alerts ${unread}`} title={`Alerts ${unread}`}><Bell size={18} aria-hidden="true" />{unread > 0 && <span className="notification-dot" />}</button></form>
          <WalletChip connected={wallet.connected} address={wallet.publicKey?.toBase58() ?? null} onConnect={() => { void wallet.connect().catch(() => setWalletError("Choose and connect a wallet from the sign-in page first.")); }} onDisconnect={() => { void wallet.disconnect().catch(() => setWalletError("Wallet disconnect did not complete.")); }} />
          <form action={logoutAction}><button className="icon-button" type="submit" aria-label="Sign out" title={`Sign out ${name}`}><LogOut size={17} aria-hidden="true" /></button></form>
        </div>
      </header>
      <main className="workspace-content" id="workspace-content">
        {flash && <div className="flash" role="status">{flash}</div>}
        {walletError && <div className="flash" role="alert">{walletError} <Link href="/login">Wallet sign-in</Link></div>}
        {orgMode === "uat_readonly" && <div className="flash" role="note" data-testid="uat-notice"><strong>Test-only workspace.</strong> Do not fund this throwaway wallet. Financial execution cannot be enabled for this workspace. Balances are read from Solana mainnet.</div>}
        {children}
        <footer className="workspace-footer"><span><span className="status-dot" />{orgMode === "demo" ? "Simulated ledger" : "Solana mainnet"}</span><span>{authMode === "demo" ? "Demo sign-in" : "Wallet sign-in"} · {role}<span className="footer-separator">/</span>Autopilot Payday</span></footer>
      </main>
    </div>
  </div>;
}

function WalletChip({ connected, address, onConnect, onDisconnect }: { connected: boolean; address: string | null; onConnect: () => void; onDisconnect: () => void }) {
  return <button className={`btn wallet-chip${connected ? " connected" : ""}`} type="button" onClick={connected && address ? onDisconnect : onConnect}><Wallet size={16} aria-hidden="true" />{connected && address ? `${address.slice(0, 4)}…${address.slice(-4)}` : "Connect wallet"}{connected && <span className="status-dot" />}</button>;
}
