/**
 * Local visual review harness. Loads the running app in a real Chrome,
 * drives the cursor over the hero hotspots, and dumps screenshots plus
 * computed styles so layout/colour bugs can be inspected directly.
 *
 * Usage: node scripts/review.mjs [url]
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4180";
const OUT = "review-shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

await page.screenshot({ path: `${OUT}/01-hero-rest.png` });

// Hover over the middle of the hero to trigger the lens.
const hero = await page.locator("#hero").boundingBox();
await page.mouse.move(hero.x + hero.width * 0.55, hero.y + hero.height * 0.5);
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/02-hero-lens.png` });

// Walk each hotspot, screenshot the tooltip, and report where each box is.
const spots = await page.locator(".hero-hotspots > div").all();
const report = [];
for (let i = 0; i < spots.length; i++) {
  const box = await spots[i].boundingBox();
  const label = await spots[i].locator("span, div").first().textContent().catch(() => null);
  if (!box) {
    report.push({ i, box: null });
    continue;
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/hotspot-${i}.png` });

  const tip = page.locator(".pointer-events-none.absolute.z-30").first();
  const tipInfo = await tip
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        text: el.textContent,
        color: cs.color,
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        background: cs.backgroundColor,
        padding: cs.padding,
        borderRadius: cs.borderRadius,
        border: cs.border,
      };
    })
    .catch(() => null);

  report.push({ i, label, box, tip: tipInfo });
}

// Overflow / layout diagnostics
const layout = await page.evaluate(() => {
  const de = document.documentElement;
  const h1 = document.querySelector(".headline-kinetic");
  const sub = document.querySelector(".sub");
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const subCs = cs(sub);
  return {
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    horizontalOverflow: de.scrollWidth > de.clientWidth,
    h1Text: h1?.textContent,
    h1Rect: h1?.getBoundingClientRect(),
    subColor: subCs?.color,
    subFontSize: subCs?.fontSize,
  };
});

console.log(JSON.stringify({ consoleErrors, report, layout }, null, 2));
await browser.close();
