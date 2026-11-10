import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

export function authorizeLocalRequest(remote: string | undefined, headers: IncomingHttpHeaders, token: string, expectedHost = "127.0.0.1:8787"): void {
  if (remote !== "127.0.0.1" || headers.host !== expectedHost) throw new Error("Loopback host required");
  if (headers.origin || headers["sec-fetch-site"] || Object.keys(headers).some((key) => key === "forwarded" || key.startsWith("x-forwarded-"))) throw new Error("Browser and proxy access rejected");
  const expected = Buffer.from(`Bearer ${token}`), actual = Buffer.from(headers.authorization || "");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("Signer authentication rejected");
}
