import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, request, type Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComputeBudgetProgram, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { createX402Client } from "x402-solana/client";
import { HERMES_PAYEE, HERMES_FEE_PAYER, QUOTE_URL, type PaidPlan, validatePlan } from "@/hermes/paid-plan";
import { USDC_MINT, WSOL_MINT } from "@/domain/tokens";
import { createSignerServer } from "../../services/x402-signer/http-server";
import { executePaidQuote, type PaidQuoteDependencies } from "../../services/x402-signer/execute";
import { PaymentJournal } from "../../services/x402-signer/journal";

const payer = Keypair.fromSeed(new Uint8Array(32).fill(21)).publicKey;
const token = "a-synthetic-test-capability-00000000000000";
function plan(): PaidPlan {
  return validatePlan({ id: crypto.randomUUID(), createdAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), payer: payer.toBase58(), url: QUOTE_URL, method: "POST", body: { input: { token: WSOL_MINT, amount: "1000000", chainKey: "sol" }, output: { token: USDC_MINT, chainKey: "sol" }, userAddress: payer.toBase58(), slippageBps: 50 }, terms: { scheme: "exact", network: "solana", asset: USDC_MINT, amount: "3007", payTo: HERMES_PAYEE, feePayer: HERMES_FEE_PAYER, resource: QUOTE_URL }, maxAtomic: "3007", dailyLimitAtomic: "50000", lifetimeLimitAtomic: "100000", reserveAtomic: "100000" });
}
function tx() {
  const mint = new PublicKey(USDC_MINT);
  return new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(HERMES_FEE_PAYER), recentBlockhash: PublicKey.default.toBase58(), instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }), createTransferCheckedInstruction(getAssociatedTokenAddressSync(mint, payer), mint, getAssociatedTokenAddressSync(mint, new PublicKey(HERMES_PAYEE)), payer, 3007n, 6)] }).compileToV0Message());
}
type Config = Parameters<typeof createX402Client>[0];
type HookTerms = Parameters<NonNullable<Config["beforePayment"]>>[0];
// The installed SDK's type exposes CAIP-2 only, while its v1 wire implementation
// explicitly supports legacy "solana". Exercise that actual path below too.
function legacyTerms(p: PaidPlan): HookTerms {
  return { ...p.terms, maxTimeoutSeconds: 60, extra: { feePayer: p.terms.feePayer } } as unknown as HookTerms;
}
function harness(effect?: (config: Config, p: PaidPlan) => Promise<void>) {
  const p = plan(), journal = new PaymentJournal(mkdtempSync(join(tmpdir(), "payday-payer-test-")));
  const deps: PaidQuoteDependencies = {
    rpcUrl: "http://invalid.test", balance: vi.fn(async () => 1_000_000n), simulate: vi.fn(async () => {}),
    // This mock never produces a cryptographic signature or contacts a network.
    sign: vi.fn(async (transaction) => { expect(journal.rows().at(-1)?.state).toBe("prepared"); return transaction; }),
    verify: vi.fn(async (signature) => ({ signature, slot: 123, solscan: `https://solscan.io/tx/${signature}` })), save: vi.fn(async () => {}),
    clientFactory: (config) => ({ fetch: async () => {
      if (effect) await effect(config, p);
      else {
        await config.beforePayment?.(legacyTerms(p), { requestUrl: p.url, responseUrl: p.url, protocolVersion: 1 });
        await config.wallet.signTransaction!(tx());
      }
      return new Response(JSON.stringify({ quotes: [{ provider: { key: "test-provider" }, providerQuote: {}, input: { amount: "1000000" }, output: { amount: "10000" } }] }), { status: 200, headers: { "x-payment-response": Buffer.from(JSON.stringify({ success: true, transaction: "5".repeat(80) })).toString("base64") } });
    } }),
  };
  return { p, journal, deps };
}
describe("payment controller adversarial boundaries", () => {
  it("persists the approved message before signing and the receipt before verifying", async () => {
    const h = harness();
    h.deps.captureResponse = vi.fn(async () => {});
    h.deps.verify = vi.fn(async (signature) => { expect(h.deps.captureResponse).toHaveBeenCalledTimes(1); expect(h.journal.rows().at(-1)?.signature).toBe(signature); return { signature, slot: 1, solscan: `https://solscan.io/tx/${signature}` }; });
    await executePaidQuote(h.p, h.journal, h.deps);
    expect(h.journal.rows().at(-1)?.state).toBe("verified"); expect(h.deps.sign).toHaveBeenCalledTimes(1);
  });
  it("refuses signing callbacks without a validated challenge", async () => {
    const h = harness(async (c) => { await c.wallet.signTransaction!(tx()); });
    await expect(executePaidQuote(h.p, h.journal, h.deps)).rejects.toThrow("Unauthorized"); expect(h.deps.sign).not.toHaveBeenCalled();
  });
  it("rejects SDK request mutations and payment dispatch without an approved signature callback", async () => {
    for (const mutate of [true, false]) {
      const h = harness(async (c, p) => {
        await c.customFetch!(p.url, { method: p.method, body: JSON.stringify(mutate ? { ...p.body, userAddress: HERMES_PAYEE } : p.body), headers: { "X-PAYMENT": "synthetic-invalid-authorization" } });
      });
      await expect(executePaidQuote(h.p, h.journal, h.deps)).rejects.toThrow(mutate ? "request body" : "Unauthorized");
      expect(h.deps.sign).not.toHaveBeenCalled();
    }
  });
  it.each(["network", "asset", "payTo", "amount", "resource"])("rejects malicious %s before signature", async (field) => {
    const h = harness(async (c, p) => { await c.beforePayment?.({ ...legacyTerms(p), [field]: "evil" } as unknown as HookTerms, { requestUrl: p.url, responseUrl: p.url, protocolVersion: 1 }); });
    await expect(executePaidQuote(h.p, h.journal, h.deps)).rejects.toThrow(); expect(h.deps.sign).not.toHaveBeenCalled();
  });
  it("serializes concurrent signing callbacks", async () => {
    const h = harness(async (c, p) => {
      await c.beforePayment?.(legacyTerms(p), { requestUrl: p.url, responseUrl: p.url, protocolVersion: 1 });
      const results = await Promise.allSettled([c.wallet.signTransaction!(tx()), c.wallet.signTransaction!(tx())]);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    });
    await executePaidQuote(h.p, h.journal, h.deps); expect(h.deps.sign).toHaveBeenCalledTimes(1);
  });
  it("blocks replay of the same successful plan", async () => {
    const h = harness(); await executePaidQuote(h.p, h.journal, h.deps);
    await expect(executePaidQuote(h.p, h.journal, h.deps)).rejects.toThrow("already attempted"); expect(h.deps.sign).toHaveBeenCalledTimes(1);
  });
  it("retains uncertain settlement and the original message after an RPC timeout", async () => {
    const h = harness(); h.deps.verify = async () => { throw new Error("RPC timeout"); };
    await expect(executePaidQuote(h.p, h.journal, h.deps)).rejects.toThrow("timeout");
    expect(h.journal.rows().at(-1)).toMatchObject({ state: "unknown", signature: "5".repeat(80) });
    expect(h.journal.rows().at(-1)?.messageBase64).toBeTruthy();
    await expect(executePaidQuote(h.p, h.journal, h.deps)).rejects.toThrow("already attempted");
  });
  it("rechecks the live reserve immediately before signing", async () => {
    const h = harness(); let reads = 0;
    h.deps.balance = async () => ++reads === 1 ? 1_000_000n : 100_001n;
    await expect(executePaidQuote(h.p, h.journal, h.deps)).rejects.toThrow("reserve changed");
    expect(h.deps.sign).not.toHaveBeenCalled(); expect(h.journal.rows().at(-1)?.state).toBe("unknown");
  });
  it("keeps settlement verified if later evidence storage fails", async () => {
    const h = harness(); h.deps.save = async () => { throw new Error("disk failure"); };
    await expect(executePaidQuote(h.p, h.journal, h.deps)).rejects.toThrow("disk failure"); expect(h.journal.rows().at(-1)?.state).toBe("verified");
  });
  it("detects journal corruption and truncation", () => {
    const h = harness(); h.journal.reserve(h.p, 1_000_000n);
    const original = readFileSync(h.journal.path, "utf8");
    writeFileSync(h.journal.path, original.replace("3007", "3008")); expect(() => h.journal.rows()).toThrow("journal");
    writeFileSync(h.journal.path, original.trimEnd()); expect(() => h.journal.rows()).toThrow("Truncated");
  });
  it("enforces a lifetime cap even when UTC daily budget resets", () => {
    const h = harness(), first = { ...h.p, lifetimeLimitAtomic: "5000" };
    const row = h.journal.reserve(first, 1_000_000n); h.journal.append({ ...row, state: "verified" });
    const now = Date.now() + 86_400_000;
    const next = { ...first, id: crypto.randomUUID(), createdAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60_000).toISOString() };
    expect(() => h.journal.reserve(next, 1_000_000n, now)).toThrow("lifetime");
  });
});

const servers: Server[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } });
async function listen(execute = vi.fn(async () => ({ ok: true }))) {
  const p = plan(), server = createSignerServer({ token, plan: p, execute }); servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing loopback port");
  return { p, execute, port: address.port };
}
async function call(port: number, path: string, headers: Record<string, string | undefined> = {}, body?: string) {
  return new Promise<number>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, ...headers } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
    req.on("error", reject); req.end(body);
  });
}
describe("real loopback HTTP service without keys or network payments", () => {
  it("runs the actual x402 SDK against a local JSON-RPC fixture after the jayson upgrade", async () => {
    const h = harness(), methods: string[] = [];
    const rpc = createServer(async (req, res) => {
      let raw = ""; for await (const part of req) raw += part;
      const input = JSON.parse(raw); methods.push(input.method);
      let result: unknown;
      if (input.method === "getLatestBlockhash") result = { context: { slot: 123 }, value: { blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 500 } };
      else if (input.method === "getAccountInfo") {
        const data = Buffer.alloc(input.params[0] === USDC_MINT ? 82 : 165);
        if (data.length === 82) { data[44] = 6; data[45] = 1; }
        result = { context: { slot: 123 }, value: { owner: TOKEN_PROGRAM_ID.toBase58(), lamports: 2039280, executable: false, rentEpoch: 0, data: [data.toString("base64"), "base64"] } };
      } else throw new Error(`Unexpected JSON-RPC method ${input.method}`);
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result }));
    });
    servers.push(rpc); await new Promise<void>((resolve) => rpc.listen(0, "127.0.0.1", resolve));
    const address = rpc.address(); if (!address || typeof address === "string") throw new Error("Missing fixture port");
    const nativeFetch = globalThis.fetch; let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      if (String(url) !== QUOTE_URL) return nativeFetch(url, init);
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ x402Version: 1, accepts: [{ ...legacyTerms(h.p), maxAmountRequired: h.p.terms.amount }] }), { status: 402 });
      expect(new Headers(init?.headers).has("X-PAYMENT")).toBe(true);
      expect(h.journal.rows().at(-1)?.state).toBe("signed");
      return new Response(JSON.stringify({ quotes: [{ provider: { key: "rpc-fixture" }, providerQuote: {}, input: { amount: "1000000" }, output: { amount: "10000" } }] }), { headers: { "x-payment-response": Buffer.from(JSON.stringify({ success: true, transaction: "5".repeat(80) })).toString("base64") } });
    }));
    h.deps.clientFactory = undefined; h.deps.rpcUrl = `http://127.0.0.1:${address.port}`;
    h.deps.sign = async (transaction) => { transaction.sign([Keypair.fromSeed(new Uint8Array(32).fill(21))]); return transaction; };
    const record = await executePaidQuote(h.p, h.journal, h.deps);
    expect(record.quotes[0]?.provider).toBe("rpc-fixture"); expect(calls).toBe(2);
    expect(methods).toContain("getLatestBlockhash"); expect(methods.filter((m) => m === "getAccountInfo")).toHaveLength(4);
  });
  it("authenticates health and rejects browser/proxy/rebinding access", async () => {
    const s = await listen(); expect(await call(s.port, "/health")).toBe(200);
    for (const headers of [{ authorization: "" }, { origin: "null" }, { origin: "https://evil.test" }, { host: "evil.test" }, { "sec-fetch-site": "same-origin" }, { "x-forwarded-for": "127.0.0.1" }, { forwarded: "for=127.0.0.1" }]) expect(await call(s.port, "/health", headers)).toBe(403);
    expect(s.execute).not.toHaveBeenCalled();
  });
  it("rejects malformed, oversized and arbitrary signing requests", async () => {
    const s = await listen();
    for (const input of ["null", "[]", "{", "x".repeat(5000), JSON.stringify({ planId: s.p.id, url: "https://evil.test" }), JSON.stringify({ planId: crypto.randomUUID() })]) expect(await call(s.port, "/v1/paid", {}, input)).toBe(409);
    expect(await call(s.port, "/v1/sign", {}, "{}")).toBe(404); expect(s.execute).not.toHaveBeenCalled();
  });
  it("allows only one concurrent execution", async () => {
    let finish!: () => void, began!: () => void;
    const started = new Promise<void>((r) => { began = r; }), pending = new Promise<void>((r) => { finish = r; });
    const work = vi.fn(async () => { began(); await pending; return { ok: true }; });
    const s = await listen(work), first = call(s.port, "/v1/paid", {}, JSON.stringify({ planId: s.p.id }));
    await started; expect(await call(s.port, "/v1/paid", {}, JSON.stringify({ planId: s.p.id }))).toBe(409);
    finish(); expect(await first).toBe(200); expect(work).toHaveBeenCalledTimes(1);
  });
});
