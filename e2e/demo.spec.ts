import { expect, test, type Page, type Locator } from "@playwright/test";

async function submit(page: Page, button: Locator) {
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
  const reload = await button.locator("xpath=ancestor::form[1]").getAttribute("data-reload-after-submit") === "true";
  const loaded = reload ? page.waitForEvent("load") : Promise.resolve();
  const pending = page.waitForResponse((response) => response.request().method() === "POST" && response.url().startsWith(new URL(page.url()).origin));
  await button.click();
  const response = await pending;
  expect([200, 303]).toContain(response.status());
  await loaded;
  if (reload) await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
}

async function goto(page: Page, path: string) {
  const response = await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
  return response;
}

async function login(page: Page, role = "owner") {
  await goto(page, "/login");
  await submit(page, page.getByTestId(`login-${role}`));
  await expect(page.getByTestId("mode-badge")).toHaveText("DEMO");
}

test("demo owner can see the payroll gap and open presentation", async ({ page }, info) => {
  await login(page);
  await expect(page.getByRole("article").filter({ hasText: "Shortfall" }).first().getByTestId("funding-shortfall")).toContainText("90");
  await expect(page.getByRole("cell", { name: "Maya", exact: true }).first()).toBeVisible();
  await page.screenshot({ path: `audit/mission-${info.project.name}.png`, fullPage: true });
  await goto(page, "/presentation");
  await expect(page.getByTestId("presentation-mode")).toHaveText("DEMO");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: /treasury is short/i })).toBeVisible();
  await page.screenshot({ path: `audit/presentation-${info.project.name}.png` });
});

test("all primary pages render without server or browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  for (const route of ["/", "/treasury", "/contributors", "/milestones", "/payroll", "/agent", "/fuel", "/x402", "/swap", "/proof", "/analytics", "/settings"]) {
    const response = await goto(page, route);
    expect(response?.status(), route).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("mode-badge")).toHaveText("DEMO");
  }
  expect(errors).toEqual([]);
});

test("contributor sees only their milestones and cannot open treasury", async ({ page }) => {
  await login(page, "contributor");
  await expect(page).toHaveURL(/\/milestones$/);
  await expect(page.getByRole("cell", { name: "Leo", exact: true })).toHaveCount(0);
  await goto(page, "/treasury");
  await expect(page).toHaveURL(/\/milestones$/);
  await expect(page.locator('select[name="contributorId"] option')).toHaveCount(1);
});

test("auditor has no policy, allowlist or sharing controls", async ({ page }) => {
  await login(page, "auditor");
  await goto(page, "/settings");
  await expect(page.getByRole("button", { name: "Save policy version" })).toHaveCount(0);
  await goto(page, "/contributors");
  await expect(page.getByRole("button", { name: "Remove allowlist" })).toHaveCount(0);
  await goto(page, "/proof");
  await expect(page.getByRole("button", { name: "Create read-only link" })).toHaveCount(0);
});

test("fixture mode cannot be promoted to live", async ({ page }) => {
  await login(page); await goto(page, "/settings");
  await page.locator('select[name="mode"]').selectOption("live");
  await submit(page, page.getByRole("button", { name: "Save mode", exact: true }));
  await expect(page.getByText("Demo fixtures cannot become live state.", { exact: false })).toBeVisible();
  await expect(page.getByTestId("mode-badge")).toHaveText("DEMO");
  await expect(page.getByRole("button", { name: "Register sign-in wallet" })).toHaveCount(0);
});

test("contributor search and theme controls work", async ({ page }) => {
  await login(page); await goto(page, "/contributors");
  await page.getByRole("textbox", { name: "Search contributors" }).fill("nonexistent-name");
  await expect(page.getByText("No contributors match.")).toBeVisible();
  await page.getByRole("textbox", { name: "Search contributors" }).fill("Maya");
  await expect(page.getByRole("cell", { name: "Maya", exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: /Light|Dark/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
});

test("all presentation scenes stay explicitly simulated", async ({ page }) => {
  await goto(page, "/presentation");
  await expect(page.getByText(/No verified paid quote/)).toBeVisible();
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Contributors get USDC" })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("heading", { name: "The owner authorizes the swap" })).toBeVisible();
  await expect(page.getByText(/fixture, never a market quote/)).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByText(/No paid response has been demonstrated/)).toBeVisible();
});

test("presentation distinguishes the actual unpaid challenge from a paid receipt", async ({ page }) => {
  await goto(page, "/presentation");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText(/Actual Swap.io HTTP 402 captured/)).toBeVisible();
  await expect(page.getByText(/placeholder address. No payment occurred/)).toBeVisible();
  await page.getByText("Actual unpaid request", { exact: true }).click();
  await expect(page.locator("pre")).toContainText('"amount": "1000000"');
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("link", { name: /Solscan/ })).toHaveCount(0);
  await expect(page.getByText(/No paid response has been demonstrated/)).toBeVisible();
});

test("wallet controls explain setup when no extension is installed", async ({ page }) => {
  await goto(page, "/login");
  await page.getByRole("button", { name: "Connect Phantom or Solflare", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Install Phantom or Solflare" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
  await login(page);
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Choose and connect a wallet from the sign-in page" })).toBeVisible();
});

test("cross-origin mutation is rejected before login", async ({ request, baseURL }) => {
  const response = await request.post(`${baseURL}/login`, { headers: { origin: "https://attacker.example", "next-action": "invalid-action" }, data: "[]" });
  expect(response.ok()).toBe(false);
  expect(response.headers()["set-cookie"] || "").not.toContain("ap_session");
});

test("owner can pause and resume the agent", async ({ page }) => {
  await login(page); await goto(page, "/agent");
  await submit(page, page.getByRole("button", { name: "Emergency pause", exact: true }));
  await expect(page.getByRole("button", { name: "Resume agent", exact: true })).toBeVisible();
  await submit(page, page.getByRole("button", { name: "Resume agent", exact: true }));
  await expect(page.getByRole("button", { name: "Emergency pause", exact: true })).toBeVisible();
});

test("milestone draft, submission, review and rejection work", async ({ page }) => {
  await login(page); await goto(page, "/milestones");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Audit workflow milestone");
  await page.getByRole("textbox", { name: "USDC amount" }).fill("1");
  await page.locator('input[name="dueOn"]').filter({ visible: true }).fill("2026-11-30");
  await page.getByRole("textbox", { name: "Description", exact: true }).fill("Deterministic browser regression");
  await submit(page, page.getByRole("button", { name: "Create draft", exact: true }));
  const row = page.getByRole("row").filter({ hasText: "Audit workflow milestone" });
  await submit(page, row.getByRole("button", { name: "Submit", exact: true }));
  await submit(page, row.getByRole("button", { name: "Review", exact: true }));
  await row.getByPlaceholder("Reason").fill("Audit test completed");
  await submit(page, row.getByRole("button", { name: "Reject", exact: true }));
  await expect(row).toContainText("REJECTED");
});

test("complete simulated payroll preserves receipts and public proof labels", async ({ page }, info) => {
  await login(page);
  await page.getByRole("textbox", { name: "SOL to quote" }).fill("1");
  await submit(page, page.getByRole("button", { name: "Run funding analysis", exact: true }));
  await goto(page, "/agent");
  await submit(page, page.getByRole("button", { name: "Authorize simulated quote" }));
  await submit(page, page.getByRole("button", { name: "Authorize this quote" }));
  await submit(page, page.getByRole("button", { name: "Record simulated settlement" }));
  await goto(page, "/");
  await expect(page.getByRole("article").filter({ hasText: "Shortfall" }).first().getByTestId("funding-shortfall")).toHaveText("0 USDC");
  await goto(page, "/swap");
  await expect(page.getByText(/fixture data, never market prices/).filter({ visible: true }).first()).toBeVisible();
  await goto(page, "/payroll");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Draft batch", exact: true }) });
  for (const check of await form.locator('input[type="checkbox"]').all()) await check.check();
  await submit(page, page.getByRole("button", { name: "Draft batch", exact: true }));
  const draft = page.locator("section").filter({ has: page.getByRole("button", { name: "Authorize", exact: true }) });
  await submit(page, draft.getByRole("button", { name: "Authorize", exact: true }));
  await submit(page, page.getByRole("button", { name: "Record simulated payout" }));
  await expect(page.getByRole("button", { name: "Record simulated payout" })).toHaveCount(0);
  await goto(page, "/proof");
  const latest = page.locator("article").filter({ hasText: "125 USDC" }).filter({ visible: true });
  await submit(page, latest.getByRole("button", { name: "Create read-only link" }));
  const share = page.locator('a[href^="/p/"]').last();
  await share.click();
  const proof = page.getByRole("main");
  await expect(proof.getByRole("heading", { name: "Read-only payday record" })).toBeVisible();
  await expect(proof.locator(".badge").first()).toHaveText("SIMULATED");
  await expect(proof).toContainText("125 USDC · CONFIRMED");
  await expect(proof.getByText("Addresses are masked.").first()).toBeVisible();
  await expect(page.locator('a[href*="solscan.io/tx/"]')).toHaveCount(0);
  await page.screenshot({ path: `audit/payroll-${info.project.name}.png`, fullPage: true });
});
