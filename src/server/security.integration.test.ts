import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { getDb } from "@/db/client";
import { seedIfEmpty } from "@/db/seed";
import { loadBooks } from "./books";
import * as schema from "@/db/schema";
import { getSession } from "./session";
import type { Session } from "./session";
import { requestDomain } from "./request-security";
import { analyze, approveSwap, buyQuote, decideBatch, finishChallenge, loginDemo, makeBatch, markPartial, registerWallet, reviewMilestone, saveContributor, saveMilestone, setAllowlist, setMode, setPaused, settleDemoPayout, settleDemoSwap, shareProof, startChallenge, submitSignedSwap, prepareLivePayout } from "./mutate";

const state = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (key: string) => state.cookies.has(key) ? { value: state.cookies.get(key) } : undefined, set: (key: string, value: string) => state.cookies.set(key, value), delete: (key: string) => state.cookies.delete(key) }),
  headers: async () => ({ get: (key: string) => state.headers.get(key) ?? null }),
}));
const owner: Session = { id: "test", userId: "user_owner", orgId: "org_northstar", role: "owner", authMode: "demo", displayName: "Owner" };
const approver: Session = { ...owner, userId: "user_approver", role: "approver" };
const auditor: Session = { ...owner, userId: "user_auditor", role: "auditor" };
const contributor: Session = { ...owner, userId: "user_maya", role: "contributor" };
const books = async () => loadBooks(await getDb(), owner.orgId);
async function funded() {
  for (const work of [() => analyze(owner, "1"), () => buyQuote(owner), () => approveSwap(owner), () => settleDemoSwap(owner)]) expect((await work())?.ok).toBe(true);
}
async function batch(approve = true) {
  expect((await makeBatch(owner, ["ms_brand", "ms_eng", "ms_film"]))?.ok).toBe(true);
  const row = (await books()).batchRows.find((row) => row.status === "DRAFT")!;
  if (approve) expect((await decideBatch(owner, row.id, "approved"))?.ok).toBe(true);
  return row.id;
}
beforeAll(() => {
  process.env.PGLITE_DIR = mkdtempSync(join(tmpdir(), "payday-security-verify-"));
  process.env.DATABASE_URL = ""; process.env.APP_MODE = "demo"; process.env.LIVE_OPERATIONS = "false";
});
beforeEach(async () => {
  process.env.APP_MODE = "demo";
  const db = await getDb();
  const tables = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
  for (const row of tables.rows) await db.execute(sql.raw(`truncate table "${row.tablename.replaceAll('"', '""')}" cascade`));
  await seedIfEmpty(db);
  state.cookies.clear(); state.headers.clear();
  state.headers.set("host", "127.0.0.1:3100"); state.headers.set("origin", "http://127.0.0.1:3100");
  process.env.APP_MODE = "demo"; process.env.APP_ORIGIN = "http://127.0.0.1:3100";
}, 60_000);

describe("real database authorization and payroll regressions", () => {
  it("requires HTTPS for hosted financial origins while accepting the configured secure host", async () => {
    state.headers.set("host", "payday.example"); state.headers.set("origin", "http://payday.example"); process.env.APP_ORIGIN = "http://payday.example";
    await expect(requestDomain()).rejects.toThrow("HTTPS");
    state.headers.set("origin", "https://payday.example"); process.env.APP_ORIGIN = "https://payday.example";
    await expect(requestDomain()).resolves.toBe("payday.example");
  });
  it("signs into a provisioned non-demo organization without assuming Northstar membership", async () => {
    const db = await getDb(), key = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(99)), address = bs58.encode(key.publicKey);
    await db.insert(schema.organizations).values({ id: "org_live_provisioned", name: "Real workspace fixture", slug: "live-auth-fixture", projectName: "Payroll", mode: "live_readonly", liveEnabled: false, createdAt: new Date() });
    await db.insert(schema.users).values({ id: "user_live_fixture", displayName: "Live fixture owner", walletAddress: address, createdAt: new Date() });
    await db.insert(schema.members).values({ id: "member_live_fixture", orgId: "org_live_provisioned", userId: "user_live_fixture", role: "owner", createdAt: new Date() });
    process.env.APP_MODE = "live_readonly";
    const challenge = await startChallenge(address, "127.0.0.1:3100");
    if (!challenge || !("nonce" in challenge)) throw new Error("Expected challenge");
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), key.secretKey));
    expect((await finishChallenge(address, signature, challenge.nonce, "127.0.0.1:3100"))?.ok).toBe(true);
    expect((await getSession())?.orgId).toBe("org_live_provisioned");
  });
  it("uses one database initialization promise for concurrent requests", async () => {
    const values = await Promise.all(Array.from({ length: 8 }, () => getDb()));
    expect(new Set(values).size).toBe(1);
  });
  it("reproduces exact shortfall and complete simulated payroll", async () => {
    const before = await books();
    expect(before.ledger.shortfallAtomic).toBe(90_000_000n);
    expect(before.ledger.availableUsdcAtomic).toBe(35_000_000n);
    expect(before.obligations.reduce((n, task) => n + BigInt(task.amountAtomic), 0n)).toBe(125_000_000n);
    await funded(); const id = await batch();
    expect((await settleDemoPayout(owner, id))?.ok).toBe(true);
    expect((await books()).tasks.filter((task) => ["ms_brand", "ms_eng", "ms_film"].includes(task.id)).every((task) => task.paymentStatus === "PAID")).toBe(true);
    await expect((await getDb()).select().from(schema.payoutTxs).where(eq(schema.payoutTxs.batchId, id)).then((rows) => rows.every((row) => row.evidenceClass === "simulated"))).resolves.toBe(true);
  });
  it("rejects concurrent duplicate payout execution", async () => {
    await funded(); const id = await batch(); const before = (await books()).treasury.usdcAtomic;
    const results = await Promise.all([settleDemoPayout(owner, id), settleDemoPayout(owner, id)]);
    expect(results.filter((r) => r?.ok).length).toBe(1);
    expect(BigInt(before) - BigInt((await books()).treasury.usdcAtomic)).toBe(125_000_000n);
  });
  it("serializes concurrent duplicate milestone allocation", async () => {
    const results = await Promise.all([makeBatch(owner, ["ms_brand"]), makeBatch(owner, ["ms_brand"])]);
    expect(results.filter((r) => r?.ok).length).toBe(1);
  });
  it("rejects repeated IDs and unknown organization IDs", async () => {
    expect((await makeBatch(owner, ["ms_brand", "ms_brand"]))?.ok).toBe(false);
    expect((await makeBatch(owner, ["ms_brand", "other-org-task"]))?.ok).toBe(false);
  });
  it("does not approve an unfunded batch", async () => {
    const id = await batch(false);
    expect((await decideBatch(owner, id, "approved"))?.code).toBe("INSUFFICIENT_USDC");
  });
  it("does not pay a draft or another organization's batch", async () => {
    const id = await batch(false);
    expect((await settleDemoPayout(owner, id))?.ok).toBe(false);
    await expect(settleDemoPayout({ ...owner, orgId: "other" }, id)).rejects.toThrow("Organization not found");
  });
  it("rejects non-owner allowlisting and public sharing", async () => {
    expect((await setAllowlist(approver, "person_maya", true))?.ok).toBe(false);
    expect((await shareProof(auditor, "any", true))?.ok).toBe(false);
  });
  it("invalidates allowlisting when a recipient address changes", async () => {
    const person = (await books()).people[0]!;
    const address = bs58.encode(nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(8)).publicKey);
    expect((await saveContributor(approver, { id: person.id, displayName: person.displayName, roleTitle: "Test", address, notes: "", active: true }))?.ok).toBe(true);
    expect((await books()).people.find((p) => p.id === person.id)?.allowlisted).toBe(false);
  });
  it("rechecks recipient approval immediately before payout", async () => {
    await funded(); const id = await batch();
    const b = await books();
    const person = b.people.find((p) => p.id === b.tasks.find((t) => t.id === "ms_brand")?.contributorId)!;
    await setAllowlist(owner, person.id, false);
    expect((await settleDemoPayout(owner, id))?.code).toBe("RECIPIENT_CHANGED");
  });
  it("blocks amendments of allocated milestones", async () => {
    await batch(false);
    expect((await reviewMilestone(owner, "ms_brand", "amend"))?.ok).toBe(false);
  });
  it("locks approved milestone contents", async () => {
    const task = (await books()).tasks.find((t) => t.id === "ms_brand")!;
    expect((await saveMilestone(owner, { id: task.id, contributorId: task.contributorId, title: "Changed", description: "", amount: "999", dueOn: task.dueOn, evidence: "" }))?.ok).toBe(false);
  });
  it("enforces a lowered approver limit without a hardcoded bypass", async () => {
    const db = await getDb(), b = await books();
    await db.insert(schema.policies).values({ id: crypto.randomUUID(), orgId: owner.orgId, version: 2, body: JSON.stringify({ ...b.policy, version: 2, approverMaxAtomic: "1" }), createdAt: new Date() });
    await db.update(schema.milestones).set({ workStatus: "UNDER_REVIEW" }).where(eq(schema.milestones.id, "ms_brand"));
    expect((await reviewMilestone(approver, "ms_brand", "approve"))?.ok).toBe(false);
  });
  it("rejects role escalation and disables fixture promotion", async () => {
    expect((await setMode(owner, "live", true))?.code).toBe("DEMO_ISOLATION");
    expect((await registerWallet(owner, "user_owner", (await books()).treasury.address))?.ok).toBe(false);
    await expect(analyze(auditor, "1")).rejects.toThrow("cannot");
    await expect(prepareLivePayout(contributor, "any")).rejects.toThrow("cannot");
    expect((await submitSignedSwap(owner, "malicious"))?.code).toBe("LIVE_QUARANTINED");
    await (await getDb()).insert(schema.members).values({ id: "foreign-membership", orgId: "other", userId: "user_maya", role: "owner", createdAt: new Date() });
    expect((await registerWallet({ ...owner, authMode: "wallet" }, "user_maya", (await books()).treasury.address))?.ok).toBe(false);
  });
  it("rejects expired quotes", async () => {
    await analyze(owner, "1"); await buyQuote(owner);
    await (await getDb()).update(schema.quotes).set({ expiresAt: new Date(0) });
    expect((await approveSwap(owner))?.code).toBe("QUOTE_EXPIRED");
  });
  it("emergency pause blocks new spending and settlement", async () => {
    await analyze(owner, "1"); await setPaused(owner, true);
    expect((await buyQuote(owner))?.code).toBe("AGENT_PAUSED");
    expect((await settleDemoSwap(owner))?.code).toBe("AGENT_PAUSED");
    expect((await makeBatch(owner, ["ms_brand"]))?.code).toBe("AGENT_PAUSED");
  });
  it("records partial payout once and holds it for reconciliation", async () => {
    await funded(); const id = await batch(); const before = BigInt((await books()).treasury.usdcAtomic);
    expect((await markPartial(owner, id))?.ok).toBe(true);
    const after = BigInt((await books()).treasury.usdcAtomic);
    expect(after).toBeLessThan(before);
    expect((await markPartial(owner, id))?.ok).toBe(false);
    expect((await settleDemoPayout(owner, id))?.ok).toBe(false);
    expect(BigInt((await books()).treasury.usdcAtomic)).toBe(after);
  });
  it("rolls back all payout writes on a database failure and can safely resume", async () => {
    await funded(); const id = await batch(); const db = await getDb(); const before = (await books()).treasury.usdcAtomic;
    await db.execute(sql.raw("create function audit_fail() returns trigger language plpgsql as $$ begin raise exception 'injected crash'; end $$"));
    await db.execute(sql.raw("create trigger fail_payout before insert on payout_transactions for each row execute function audit_fail()"));
    await expect(settleDemoPayout(owner, id)).rejects.toThrow();
    expect((await books()).treasury.usdcAtomic).toBe(before);
    expect((await books()).batchRows.find((b) => b.id === id)?.status).toBe("APPROVED");
    await db.execute(sql.raw("drop trigger fail_payout on payout_transactions")); await db.execute(sql.raw("drop function audit_fail()"));
    expect((await settleDemoPayout(owner, id))?.ok).toBe(true);
  });
});

describe("sessions, nonces and origins", () => {
  it("caps persisted challenge creation independently of caller-supplied addresses", async () => {
    const db = await getDb();
    await db.insert(schema.authChallenges).values(Array.from({ length: 30 }, () => ({ id: crypto.randomUUID(), nonce: crypto.randomUUID(), domain: "127.0.0.1:3100", address: "11111111111111111111111111111111", message: "rate-test", expiresAt: new Date(Date.now() + 60_000), usedAt: null, createdAt: new Date() })));
    expect((await startChallenge("11111111111111111111111111111111", "127.0.0.1:3100"))?.ok).toBe(false);
  });
  it("accepts only the configured origin", async () => {
    expect(await requestDomain()).toBe("127.0.0.1:3100");
    state.headers.set("origin", "https://attacker.example"); await expect(requestDomain()).rejects.toThrow("Cross-origin");
    state.headers.delete("origin"); await expect(requestDomain()).rejects.toThrow("Cross-origin");
  });
  it("rejects host confusion and cross-site requests", async () => {
    state.headers.set("host", "localhost:3100"); await expect(requestDomain()).rejects.toThrow("host");
    state.headers.set("host", "127.0.0.1:3100"); state.headers.set("sec-fetch-site", "cross-site"); await expect(requestDomain()).rejects.toThrow("Cross-site");
  });
  it("refuses demo login outside a demo deployment", async () => {
    process.env.APP_MODE = "live"; expect((await loginDemo("owner"))?.ok).toBe(false);
  });
  it("expires sessions and respects membership revocation", async () => {
    await loginDemo("owner"); expect((await getSession())?.role).toBe("owner");
    const db = await getDb(); await db.update(schema.sessions).set({ expiresAt: new Date(0) }); expect(await getSession()).toBeNull();
    await loginDemo("owner"); await db.delete(schema.members).where(and(eq(schema.members.userId, "user_owner"), eq(schema.members.orgId, owner.orgId))); expect(await getSession()).toBeNull();
  });
  it("atomically consumes a signed nonce exactly once", async () => {
    const pair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(3)), address = bs58.encode(pair.publicKey);
    await (await getDb()).update(schema.users).set({ walletAddress: address }).where(eq(schema.users.id, "user_owner"));
    const challenge = await startChallenge(address, "127.0.0.1:3100");
    if (!challenge || !("nonce" in challenge)) throw new Error("Missing challenge");
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), pair.secretKey));
    expect((await finishChallenge(address, signature, challenge.nonce, "wrong.example"))?.ok).toBe(false);
    const results = await Promise.all([finishChallenge(address, signature, challenge.nonce, "127.0.0.1:3100"), finishChallenge(address, signature, challenge.nonce, "127.0.0.1:3100")]);
    expect(results.filter((r) => r?.ok).length).toBe(1);
  });
  it("rejects expired, unknown and invalidly signed challenges", async () => {
    const pair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(4)), address = bs58.encode(pair.publicKey);
    const challenge = await startChallenge(address, "127.0.0.1:3100");
    if (!challenge || !("nonce" in challenge)) throw new Error("Missing challenge");
    expect((await finishChallenge(address, "invalid", challenge.nonce, "127.0.0.1:3100"))?.ok).toBe(false);
    await (await getDb()).update(schema.authChallenges).set({ expiresAt: new Date(0) });
    const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), pair.secretKey));
    expect((await finishChallenge(address, sig, challenge.nonce, "127.0.0.1:3100"))?.ok).toBe(false);
  });
});
