"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { LoaderCircle, Wallet } from "lucide-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { walletChallengeAction, walletVerifyAction } from "@/server/actions";

export function WalletLogin() {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nonce, setNonce] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const address = wallet.publicKey?.toBase58() ?? "";
  const [requestedWallet, setRequestedWallet] = useState<string | null>(null);
  const selectedWallet = wallet.wallet;
  const connect = wallet.connect;
  useEffect(() => {
    if (!requestedWallet || selectedWallet?.adapter.name !== requestedWallet) return;
    setRequestedWallet(null);
    void connect().catch(() => setMessage("Wallet connection was rejected."));
  }, [requestedWallet, selectedWallet, connect]);

  async function signIn() {
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      const result = await walletChallengeAction(address, window.location.host);
      if (!result || !("nonce" in result) || !result.ok) {
        setMessage(result && "message" in result ? result.message : "Could not start the challenge."); return;
      }
      setNonce(result.nonce); setText(result.message);
      const signature = await wallet.signMessage?.(new TextEncoder().encode(result.message));
      if (!signature) { setMessage("This wallet cannot sign messages."); return; }
      const bs58 = (await import("bs58")).default;
      const verified = await walletVerifyAction(address, bs58.encode(signature), result.nonce);
      if (verified?.ok) window.location.assign("/");
      else if (verified) setMessage(verified.message);
    } catch { setMessage("Wallet sign-in did not complete. No new session was confirmed. Try again when your wallet and connection are ready."); }
    finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <div className="row">
        <button className="btn" type="button" disabled={busy || wallet.connected || wallet.connecting} onClick={() => {
          const available = wallet.wallets.find((entry) => entry.readyState === WalletReadyState.Installed);
          if (!available) { setMessage("Install Phantom or Solflare in this browser to connect a wallet."); return; }
          setMessage(null);
          wallet.select(available.adapter.name);
          setRequestedWallet(available.adapter.name);
        }}><Wallet size={15} aria-hidden="true" />Connect Phantom or Solflare</button>
        {address && <span className="badge mint" style={{ overflowWrap: "anywhere", width: "100%" }}>{address}</span>}
        {wallet.connected && <button className="btn text-button" disabled={busy} type="button" onClick={() => { void wallet.disconnect().catch(() => setMessage("Wallet disconnect did not complete.")); }}>Disconnect wallet</button>}
      </div>
      <button className="btn primary" type="button" disabled={!address || busy} aria-busy={busy} onClick={() => { void signIn(); }}>{busy && <LoaderCircle className="spin" size={14} aria-hidden="true" />}Sign in</button>
      {text && <details><summary style={{ color: "var(--muted)", fontSize: 10 }}>View the sign-in message</summary><pre style={{ whiteSpace: "pre-wrap" }}>{text}</pre></details>}
      {message && <p role="alert">{message}</p>}
      {nonce && <span className="kicker">Challenge {nonce.slice(0, 8)}</span>}
    </div>
  );
}
