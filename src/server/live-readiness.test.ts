import { describe, expect, it } from "vitest";
import { liveReadiness } from "./live-readiness";
import type { Books } from "./books";
import type { Session } from "./session";
import { TREASURY_RELEASE } from "./live-treasury";
import { defaultPolicy } from "../domain/policy-doc";

const books = { org: { mode: "live", liveEnabled: true }, treasury: { address: "treasury" }, payer: { address: "api-payer" }, policy: defaultPolicy() } as Books;
const session = { role: "owner", authMode: "wallet" } as Session;
const env = { APP_ORIGIN: "https://payday.example", VERCEL: "1", DATABASE_URL: "postgres://private", APP_MODE: "live", LIVE_OPERATIONS: "true", TREASURY_EXECUTION_ENABLED: "true", TREASURY_REVIEWED_RELEASE: TREASURY_RELEASE, SOLANA_RPC_URL: "https://primary.example", SOLANA_VERIFICATION_RPC_URL: "https://verifier.example" };
describe("hosted live configuration readiness", () => {
  it("reports configured owner-gated deployment without exposing secrets", () => {
    const result = liveReadiness(books, session, env);
    expect(result.every((check) => check.ok)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("postgres://private");
    expect(JSON.stringify(result)).not.toContain("https://primary.example");
  });
  it("identifies a hosted database omission, preview mode and a stale review marker", () => {
    const result = liveReadiness(books, session, { ...env, DATABASE_URL: "", APP_MODE: "live_readonly", TREASURY_REVIEWED_RELEASE: "old" });
    expect(result.filter((c) => !c.ok).map((c) => c.id)).toEqual(["database", "deployment", "gates"]);
  });
  it.each(["http://payday.example", "https://payday.example/", "https://user:password@payday.example", "invalid"])("rejects noncanonical hosted origin %s", (origin) => {
    expect(liveReadiness(books, session, { ...env, APP_ORIGIN: origin }).find((c) => c.id === "origin")?.ok).toBe(false);
  });
  it("does not label a demo workspace, demo session or paused policy ready", () => {
    const result = liveReadiness({ ...books, org: { ...books.org, mode: "demo", liveEnabled: false }, policy: { ...books.policy, paused: true } }, { ...session, authMode: "demo" }, env);
    expect(result.filter((c) => !c.ok).map((c) => c.id)).toEqual(["organization", "owner", "policy"]);
  });
});
