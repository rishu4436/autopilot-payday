import { createServer, type IncomingMessage } from "node:http";
import { authorizeLocalRequest } from "./http-policy";
import { type PaymentPlan, planHash } from "../../src/hermes/paid-plan";

export function createSignerServer(input: { token: string; plan: PaymentPlan; execute: () => Promise<unknown> }) {
  let busy = false;
  async function body(req: IncomingMessage) {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4096) throw new Error("Request body too large");
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  }
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store");
    try { authorizeLocalRequest(req.socket.remoteAddress, req.headers, input.token, `127.0.0.1:${req.socket.localPort}`); }
    catch { res.writeHead(403).end(JSON.stringify({ message: "Local authenticated CLI access only" })); return; }
    if (req.url === "/health" && req.method === "GET") {
      res.end(JSON.stringify({ ok: true, address: input.plan.payer, planId: input.plan.id, planHash: planHash(input.plan), busy })); return;
    }
    if (req.url !== "/v1/paid" || req.method !== "POST") { res.writeHead(404).end(); return; }
    if (busy) { res.writeHead(409).end(JSON.stringify({ message: "Another payment is in progress" })); return; }
    busy = true;
    try {
      const value = await body(req);
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || !("planId" in value) || value.planId !== input.plan.id) throw new Error("Only the approved plan ID is accepted");
      const result = await input.execute();
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(409).end(JSON.stringify({ message: "Request refused or settlement requires reconciliation. Inspect the private journal; never retry an attempted plan." }));
    } finally { busy = false; }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 5_000;
  return server;
}
