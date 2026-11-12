import { headers } from "next/headers";

export async function requestDomain(): Promise<string> {
  const h = await headers();
  const host = h.get("host");
  if (!host) throw new Error("Missing request host");
  const configured = process.env.APP_ORIGIN;
  if (!configured && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
    throw new Error("APP_ORIGIN is required for a non-loopback deployment");
  }
  const expected = new URL(configured || `http://${host}`);
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(expected.host) && expected.protocol !== "https:") throw new Error("Non-loopback deployments require HTTPS");
  if (host !== expected.host) throw new Error("Unexpected request host");
  if (h.get("origin") !== expected.origin) throw new Error("Cross-origin mutation rejected");
  const site = h.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new Error("Cross-site mutation rejected");
  return expected.host;
}
