import { expect, test } from "@playwright/test";
import { Keypair } from "@solana/web3.js";

// TEST ONLY: deterministic, unfunded local fixture. No user wallet material.
const owner = Keypair.fromSeed(new Uint8Array(32).fill(232));

test("owner UAT signs in with a message and remains read-only with no API payer", async ({ page, request }) => {
  const before = await (await request.get("http://127.0.0.1:3140/stats")).json();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.addInitScript(({ secret, publicBytes, address }) => {
    const activity = { messages: JSON.parse(sessionStorage.getItem("uat-messages") || "[]") as string[], transactionRequests: Number(sessionStorage.getItem("uat-transaction-requests") || "0") };
    const key = { toBytes: () => new Uint8Array(publicBytes), toString: () => address, toBase58: () => address };
    const provider = {
      isPhantom: true, isConnected: false, publicKey: key,
      on() {}, off() {},
      async connect() { this.isConnected = true; return { publicKey: key }; },
      async disconnect() { this.isConnected = false; },
      async signMessage(bytes: Uint8Array) {
        activity.messages.push(new TextDecoder().decode(bytes));
        sessionStorage.setItem("uat-messages", JSON.stringify(activity.messages));
        const encoded = new Uint8Array(48);
        encoded.set([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
        encoded.set(secret.slice(0, 32), 16);
        const signingKey = await crypto.subtle.importKey("pkcs8", encoded, "Ed25519", false, ["sign"]);
        return { signature: new Uint8Array(await crypto.subtle.sign("Ed25519", signingKey, new Uint8Array(bytes))) };
      },
      async signTransaction() { activity.transactionRequests++; sessionStorage.setItem("uat-transaction-requests", String(activity.transactionRequests)); throw new Error("UAT never signs transactions"); },
    };
    Object.assign(window, { isPhantomInstalled: true, phantom: { solana: provider }, solana: provider, uatWalletActivity: activity });
  }, { secret: [...owner.secretKey], publicBytes: [...owner.publicKey.toBytes()], address: owner.publicKey.toBase58() });

  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
  await page.getByRole("button", { name: "Connect Phantom or Solflare", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("mode-badge")).toHaveText("TEST READ-ONLY");
  await expect(page.getByTestId("uat-notice")).toContainText("Do not fund this throwaway wallet");
  const activity = await page.evaluate(() => (window as unknown as { uatWalletActivity: { messages: string[]; transactionRequests: number } }).uatWalletActivity);
  expect(activity.messages).toHaveLength(1);
  expect(activity.messages[0]).toContain("Domain: 127.0.0.1:3102");
  expect(activity.messages[0]).toContain(owner.publicKey.toBase58());
  expect(activity.messages[0]).toContain("Nonce:");
  expect(activity.transactionRequests).toBe(0);
  await expect(page.getByRole("article").filter({ hasText: "API reserve" })).toContainText("Not configured");

  await page.goto("/treasury");
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
  const payer = page.locator("section.wallet-account").filter({ has: page.getByRole("heading", { name: "x402 API wallet", exact: true }) });
  await expect(payer).toContainText("NOT CONFIGURED");
  await expect(payer).toContainText("Spendable unavailable");
  await expect(payer).toContainText("No RPC observation");
  await expect(payer.locator(".wallet-balance-item .num")).toHaveText(["—", "—"]);
  await expect(payer.getByRole("link")).toHaveCount(0);
  await page.screenshot({ path: "audit/testing-phase/uat-treasury-desktop.png", fullPage: true, animations: "disabled" });
  const refreshed = page.waitForEvent("load");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await refreshed;
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
  await expect(page.getByRole("status")).toContainText("Treasury balances read from RPC");
  await expect(page.getByRole("status")).toContainText("API payer is not configured; its balance was not read");
  await expect(payer).toContainText("No RPC observation");

  await page.goto("/fuel");
  await expect(page.getByRole("article").filter({ hasText: "Payer balance" })).toContainText("Not configured");
  await expect(page.getByRole("article").filter({ hasText: "Spendable" })).toContainText("Unavailable");
  await expect(page.getByRole("heading", { name: "API payer not configured", exact: true })).toBeVisible();
  await expect(page.getByText(/Calls remaining at that price: unavailable/)).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByTestId("uat-settings")).toContainText("cannot be activated for financial execution");
  await expect(page.getByTestId("live-readiness")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save mode", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Register sign-in wallet", exact: true })).toHaveCount(0);

  for (const route of ["/contributors", "/milestones", "/payroll", "/swap"]) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
    await expect(page.getByTestId("mode-badge")).toHaveText("TEST READ-ONLY");
    await expect(page.getByRole("button", { name: /^Sign (exact approval message|and submit this transaction once)$/ })).toHaveCount(0);
  }
  await expect(page.getByTestId("live-swap-wallet")).toContainText("READ-ONLY");
  await expect(page.getByRole("button", { name: "Preview live swap", exact: true })).toBeDisabled();
  for (const route of ["/", "/treasury", "/fuel", "/settings"]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);
    await expect(page.getByTestId("uat-notice")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${route} should fit mobile`).toBe(true);
  }
  await page.screenshot({ path: "audit/testing-phase/uat-settings-mobile.png", fullPage: true, animations: "disabled" });
  expect(await (await request.get("http://127.0.0.1:3140/stats")).json()).toEqual(before);
  expect(await page.evaluate(() => sessionStorage.getItem("uat-transaction-requests"))).toBeNull();
  expect(errors).toEqual([]);
});
