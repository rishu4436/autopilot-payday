"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { walletChallengeAction, walletVerifyAction } from "@/server/actions";

export function WalletLogin() {
  const wallet = useWallet();
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

  return (
    <div className="stack">
      <div className="row">
        <button className="btn" type="button" onClick={() => {
          const available = wallet.wallets.find((entry) => entry.readyState === WalletReadyState.Installed);
          if (!available) { setMessage("Install Phantom or Solflare in this browser to connect a wallet."); return; }
          setMessage(null);
          wallet.select(available.adapter.name);
          setRequestedWallet(available.adapter.name);
        }}>Connect Phantom or Solflare</button>
        {address && <span className="badge">{address.slice(0, 4)}…{address.slice(-4)}</span>}
      </div>
      <button className="btn primary" type="button" disabled={!address} onClick={async () => {
        const result = await walletChallengeAction(address, window.location.host);
        if (!result || !("nonce" in result) || !result.ok) {
          setMessage(result && "message" in result ? result.message : "Could not start the challenge.");
          return;
        }
        setNonce(result.nonce);
        setText(result.message);
        try {
          const encoded = new TextEncoder().encode(result.message);
          const signature = await wallet.signMessage?.(encoded);
          if (!signature) {
            setMessage("This wallet cannot sign messages.");
            return;
          }
          const bs58 = (await import("bs58")).default;
          const verified = await walletVerifyAction(address, bs58.encode(signature), result.nonce);
          if (verified?.ok) window.location.assign("/");
          else if (verified) setMessage(verified.message);
        } catch {
          setMessage("The wallet rejected the sign-in message. No session was created.");
        }
      }}>Sign in</button>
      {text && <pre style={{ whiteSpace: "pre-wrap" }}>{text}</pre>}
      {message && <p role="alert">{message}</p>}
      {nonce && <span className="kicker">Challenge {nonce.slice(0, 8)}</span>}
    </div>
  );
}
