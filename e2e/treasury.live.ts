import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { TEST_TREASURY } from "../src/solana/__fixtures__/treasury-bank";

test("synthetic wallet owner approves, signs once and reconciles a complete live-code payroll", async ({ page, request }) => {
  // Synthetic Ed25519 wallet exists only in this isolated browser. Block all
  // external browser requests; no merchant or mainnet transaction is possible.
  await page.route("**/*", (route) => { const url = new URL(route.request().url()); return url.hostname === "127.0.0.1" ? route.continue() : route.abort(); });
  await page.addInitScript(({ secret, publicBytes, address }) => {
    const key = { toBytes: () => new Uint8Array(publicBytes), toString: () => address, toBase58: () => address };
    const provider = {
      isPhantom: true, isConnected: false, publicKey: key,
      on() {}, off() {},
      async connect() { this.isConnected = true; return { publicKey: key }; },
      async disconnect() { this.isConnected = false; },
      async signMessage(bytes: Uint8Array) {
        const encoded = new Uint8Array(48); encoded.set([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]); encoded.set(secret.slice(0, 32), 16);
        const signingKey = await crypto.subtle.importKey("pkcs8", encoded, "Ed25519", false, ["sign"]);
        return { signature: new Uint8Array(await crypto.subtle.sign("Ed25519", signingKey, new Uint8Array(bytes))) };
      },
      async signTransaction(transaction: { message: { staticAccountKeys: unknown[] }; sign: (signers: unknown[]) => void }) {
        transaction.sign([{ publicKey: transaction.message.staticAccountKeys[0], secretKey: new Uint8Array(secret) }]); return transaction;
      },
    };
    Object.assign(window, { isPhantomInstalled: true, phantom: { solana: provider }, solana: provider });
  }, { secret: [...TEST_TREASURY.secretKey], publicBytes: [...TEST_TREASURY.publicKey.toBytes()], address: TEST_TREASURY.publicKey.toBase58() });
  await page.goto("/login"); await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
  await page.getByRole("button", { name: "Connect Phantom or Solflare", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/$/);
  await page.goto("/settings");
  await expect(page.getByTestId("live-readiness")).toContainText("Live demo setup");
  await expect(page.getByTestId("live-readiness")).toContainText("Action needed: Hosted wallet origin");
  await page.goto("/payroll"); await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
  const panel = page.getByTestId("live-payout-wallet");
  await expect(panel).toBeVisible(); await expect(panel).toContainText(TEST_TREASURY.publicKey.toBase58());
  for (let chunk = 0; chunk < 2; chunk++) {
    await panel.getByRole("button", { name: "Preview next unpaid chunk", exact: true }).click();
    await expect(panel.getByTestId("treasury-review")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Sign exact approval message", exact: true })).toBeDisabled();
    await panel.getByRole("checkbox").check();
    await panel.getByRole("button", { name: "Sign exact approval message", exact: true }).click();
    const sign = panel.getByRole("button", { name: "Sign and submit this transaction once", exact: true });
    await expect(sign).toBeVisible(); await sign.click();
    await expect(panel.getByText(/Submitted once. Settlement is unresolved/)).toBeVisible();
    const settled = page.waitForEvent("load"); await panel.getByRole("button", { name: "Reconcile on Solana", exact: true }).last().click(); await settled;
    await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
    await expect(panel.getByRole("link", { name: /Verified Solscan receipt:/ })).toHaveCount(chunk + 1);
    if (chunk === 0) { await page.reload(); await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true"); }
  }
  const stats = await (await request.get("http://127.0.0.1:3140/stats")).json(); expect(stats).toEqual({ synthetic: true, sends: 2 });
  await page.reload(); await expect(page.getByTestId("live-payout-wallet").getByRole("link", { name: /Verified Solscan receipt:/ })).toHaveCount(2);
  const payoutDownload = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Download verified receipt", exact: true }).first().click();
  const payoutPath = await (await payoutDownload).path(); if (!payoutPath) throw new Error("Missing receipt download");
  const payoutReceipt = JSON.parse(await readFile(payoutPath, "utf8"));
  expect(payoutReceipt).toMatchObject({ kind: "payout", network: "solana-mainnet", commitment: "finalized", treasury: TEST_TREASURY.publicKey.toBase58() });
  expect(payoutReceipt.recipients.length).toBeGreaterThan(0); expect(payoutReceipt.signed_base64).toBeUndefined();
  const bundle = await (await request.get("http://127.0.0.1:3140/swap-bundle")).json();
  await page.goto("/swap"); await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
  const swap = page.getByTestId("live-swap-wallet");
  await swap.locator('input[type="file"]').setInputFiles({ name: "synthetic-build.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bundle)) });
  const preview = swap.getByRole("button", { name: "Preview live swap", exact: true }); await expect(preview).toBeEnabled(); await preview.click();
  await expect(swap.getByTestId("treasury-review")).toBeVisible(); await expect(swap.getByRole("link", { name: "Verified Swap.io API build payment", exact: true })).toBeVisible();
  await page.screenshot({ path: "audit/defi-ui/live-swap-preview.png", fullPage: true });
  await swap.getByRole("checkbox").check(); await swap.getByRole("button", { name: "Sign exact approval message", exact: true }).click();
  const signSwap = swap.getByRole("button", { name: "Sign and submit this transaction once", exact: true }); await expect(signSwap).toBeVisible(); await signSwap.click();
  await expect(swap.getByText(/Submitted once. Settlement is unresolved/)).toBeVisible(); const swapped = page.waitForEvent("load"); await swap.getByRole("button", { name: "Reconcile on Solana", exact: true }).click(); await swapped;
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
  await expect(swap.getByRole("link", { name: /Verified Solscan receipt:/ })).toHaveCount(1);
  const swapDownload = page.waitForEvent("download"); await swap.getByRole("button", { name: "Download verified receipt", exact: true }).click();
  const swapPath = await (await swapDownload).path(); if (!swapPath) throw new Error("Missing swap download");
  expect(JSON.parse(await readFile(swapPath, "utf8"))).toMatchObject({ kind: "swap", commitment: "finalized", authorizedInputAtomic: "1000000" });
  expect(await (await request.get("http://127.0.0.1:3140/stats")).json()).toEqual({ synthetic: true, sends: 3 });
});
