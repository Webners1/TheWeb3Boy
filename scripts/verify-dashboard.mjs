/**
 * Drives the real dashboard against the live API: waits for vaults to load,
 * pins one, switches window/benchmarks/amount, and reports what rendered.
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
await page.waitForSelector(".yv-row, .yv-dash", { timeout: 25000 });
await page.waitForTimeout(600);

const rowCount = await page.locator(".yv-row").count();
const heading = await page.getByRole("heading", { name: "Ranked vaults" }).textContent();
const firstRow = await page.locator(".yv-row").first().innerText();
const challenger = await page.getByRole("heading", { level: 1 }).first().textContent();

await page.screenshot({ path: "review-shots/dash-list.png", fullPage: false });

await page.getByRole("button", { name: "Share verdict" }).click();
await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
await page.screenshot({ path: "review-shots/dash-share.png" });
await page.getByRole("button", { name: "Close" }).click();

await page.getByRole("button", { name: /Filters/ }).click();
await page.getByRole("button", { name: "ETH", exact: false }).first().click();
await page.waitForTimeout(1200);

const stake = page.getByLabel("Amount invested");
await stake.fill("25000");
await page.waitForTimeout(500);

await page.getByRole("button", { name: "30d", exact: true }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: "review-shots/dash-final.png" });

const chartPolylines = await page.locator("svg polyline").count();

console.log(
  JSON.stringify(
    {
      rowCount,
      heading: heading?.trim(),
      challenger: challenger?.trim(),
      firstRow: firstRow?.split("\n").slice(0, 6),
      chartPolylines,
      apiCalls: api,
      errors,
    },
    null,
    2
  )
);
await browser.close();
