/**
 * Drives the real dashboard against the live API: waits for vaults to load,
 * selects one, switches window/benchmarks/amount, and reports what rendered.
 * Run the app on :3000 (the API's CORS allowlist includes localhost:3000).
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:3000/dashboard";
mkdirSync("review-shots", { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("requestfailed", (r) => errors.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`));

const api = [];
page.on("response", (r) => {
  if (r.url().includes("railway.app")) api.push(`${r.status()} ${r.url().replace(/^https:\/\/[^/]+/, "")}`);
});

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".vault-table tbody tr", { timeout: 20000 });
await page.waitForTimeout(600);

const rowCount = await page.locator(".vault-table tbody tr").count();
const heading = await page.locator(".dash-section-title").first().textContent();
const firstRow = await page.locator(".vault-table tbody tr").first().innerText();

await page.screenshot({ path: "review-shots/dash-list.png", fullPage: false });

// Select a vault -> comparison should appear
await page.locator(".vault-table tbody tr").first().click();
await page.waitForSelector(".compare-panel", { timeout: 20000 });
await page.waitForSelector(".chart-svg", { timeout: 20000 });
await page.waitForTimeout(900);
const verdict = await page.locator(".compare-verdict").first().textContent().catch(() => null);
const title = await page.locator(".compare-title").first().innerText().catch(() => null);
const coverage = await page.locator(".coverage-row").first().innerText().catch(() => null);
await page.screenshot({ path: "review-shots/dash-compare.png" });

// Change amount -> the headline money should change
await page.fill("#amount", "25000");
await page.waitForTimeout(700);
const titleAfterAmount = await page.locator(".compare-title").first().innerText().catch(() => null);

// Switch window to 30d -> triggers a refetch of both list and compare
await page.getByRole("button", { name: "30d", exact: true }).click();
await page.waitForTimeout(2500);
const titleAfterWindow = await page.locator(".compare-title").first().innerText().catch(() => null);
const seriesCount = await page.locator(".chart-svg path").count();

// Add ETH benchmark
await page.getByRole("button", { name: "ETH", exact: true }).click();
await page.waitForTimeout(2200);
const seriesAfterEth = await page.locator(".chart-svg path").count();
await page.screenshot({ path: "review-shots/dash-final.png" });

console.log(
  JSON.stringify(
    {
      rowCount,
      heading: heading?.trim(),
      firstRow: firstRow?.split("\n").slice(0, 6),
      title,
      verdict: verdict?.trim().slice(0, 140),
      coverage: coverage?.replace(/\n/g, " | "),
      titleAfterAmount,
      titleAfterWindow,
      chartPaths: { at90: seriesCount, afterEth: seriesAfterEth },
      apiCalls: api,
      errors,
    },
    null,
    2
  )
);
await browser.close();
