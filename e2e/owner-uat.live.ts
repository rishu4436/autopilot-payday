import { expect, test } from "@playwright/test";
import { Keypair } from "@solana/web3.js";

// TEST ONLY: deterministic, unfunded local fixture. No user wallet material.
const owner = Keypair.fromSeed(new Uint8Array(32).fill(232));

test("owner UAT signs in with a message and remains read-only with no API payer", async ({ page, request }) => {
  page.setDefaultTimeout(15_000);
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
  await expect(payer.locator(".wallet-balance-item .num")).toHaveText(["\u2014", "\u2014"]);
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
  // Exercise the reported editing gaps and visible refusal with no money movement.
  async function saveAndReload(button: ReturnType<typeof page.getByRole>) {
    const loaded = page.waitForEvent("load"); await button.click(); await loaded;
    await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
  }
  await page.goto("/contributors");
  const personForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Save", exact: true }) });
  await personForm.getByLabel("Name", { exact: true }).fill("Editing recipient");
  await personForm.getByLabel("Role", { exact: true }).fill("QA");
  await personForm.getByLabel("Wallet", { exact: true }).fill(Keypair.fromSeed(new Uint8Array(32).fill(233)).publicKey.toBase58());
  await saveAndReload(personForm.getByRole("button", { name: "Save", exact: true }));
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await personForm.getByLabel("Notes", { exact: true }).fill("Changed from UI");
  await personForm.getByLabel("Active", { exact: true }).uncheck();
  await saveAndReload(personForm.getByRole("button", { name: "Save", exact: true }));
  await expect(page.getByRole("row").filter({ hasText: "Editing recipient" })).toContainText("Inactive");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await personForm.getByLabel("Active", { exact: true }).check();
  await saveAndReload(personForm.getByRole("button", { name: "Save", exact: true }));
  await page.getByRole("button", { name: "Allowlist", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove allowlist", exact: true })).toBeVisible();
  await page.goto("/milestones");
  const create = page.locator("form").filter({ has: page.getByRole("button", { name: "Create draft", exact: true }) });
  await create.getByLabel("Title", { exact: true }).fill("Editable workflow");
  await create.getByLabel("USDC amount", { exact: true }).fill("0.01");
  await create.getByLabel("Due", { exact: true }).fill("2026-11-13");
  await create.getByLabel("Description", { exact: true }).fill("Initial work");
  await saveAndReload(create.getByRole("button", { name: "Create draft", exact: true }));
  const work = page.getByRole("row").filter({ hasText: "Editable workflow" });
  await work.locator("summary").click();
  await work.getByLabel("USDC amount", { exact: true }).fill("0.02");
  await work.getByLabel("Description", { exact: true }).fill("Revised work");
  await saveAndReload(work.getByRole("button", { name: "Save changes", exact: true }));
  await expect(work).toContainText("0.02 USDC"); await expect(work).toContainText("Revised work");
  for (const name of ["Submit", "Review", "Approve"]) await saveAndReload(work.getByRole("button", { name, exact: true }));
  await page.goto("/payroll"); await page.locator('input[name="milestoneId"]').check();
  await saveAndReload(page.getByRole("button", { name: "Draft batch", exact: true }));
  await page.getByRole("button", { name: "Authorize", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Insufficient treasury USDC" })).toBeVisible();
  await page.getByLabel("Rejection reason", { exact: true }).fill("UI regression completed");
  await saveAndReload(page.getByRole("button", { name: "Reject", exact: true }));
  await expect(page.getByText("Batch rejected. The milestones can be selected again.", { exact: true })).toBeVisible();
  for (const route of ["/", "/treasury", "/fuel", "/settings", "/milestones"]) {
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
