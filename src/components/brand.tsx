export function BrandMark({ className = "" }: { className?: string }) {
  return <span className={`brand-mark ${className}`} aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M6 22 16 5l10 17M10 16h12M6 27h20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>;
}

export function TokenIcon({ symbol, small = false }: { symbol: "SOL" | "USDC"; small?: boolean }) {
  return <span className={`token-icon ${symbol.toLowerCase()}${small ? " small" : ""}`} aria-hidden="true">{symbol === "SOL" ? <span className="sol-bars"><i /><i /><i /></span> : "$"}</span>;
}
