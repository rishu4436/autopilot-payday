"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { useEffect, useMemo, useState } from "react";
import type { Adapter } from "@solana/wallet-adapter-base";

export function Providers({ children }: { children: React.ReactNode }) {
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const [wallets, setWallets] = useState<Adapter[]>([]);
  useEffect(() => {
    setWallets([new PhantomWalletAdapter(), new SolflareWalletAdapter()]);
    document.documentElement.dataset.hydrated = "true";
  }, []);
  const list = useMemo(() => wallets, [wallets]);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={list} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
