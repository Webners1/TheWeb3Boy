import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4183";
const OUT = "review-shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const results = { hotspots: [], viewports: [], consoleErrors: [] };

// --- hotspot sweep at desktop ---
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => results.consoleErrors.push(e.message));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const spots = await page.locator("#hero .isolate > div.z-10 > div").all();
  for (let i = 0; i < spots.length; i++) {
    const box = await spots[i].boundingBox();
    if (!box || box.width < 2 || box.height < 2) {
      results.hotspots.push({ i, box, tooltip: null, note: "degenerate box" });
      continue;
    }
    // Aim at the middle of the on-screen portion of the box.
    const cx = Math.min(Math.max(box.x + box.width / 2, 5), 1435);
    const cy = Math.min(Math.max(box.y + box.height / 2, 60), 895);
    await page.mouse.move(cx - 30, cy - 30);
    await page.mouse.move(cx, cy, { steps: 6 });
    await page.waitForTimeout(650);
    const tooltip = await page
      .locator("#hero .isolate > .z-30")
      .first()
      .textContent()
      .catch(() => null);
    results.hotspots.push({ i, at: { cx, cy }, w: Math.round(box.width), h: Math.round(box.height), tooltip });
  }
  await page.screenshot({ path: `${OUT}/desktop-final.png` });
  await page.close();
}

// --- responsive text check ---
for (const vp of [
  { width: 700, height: 900, name: "narrow-700" },
  { width: 390, height: 844, name: "phone-390" },
]) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(2600); // let the word cycle land on a long word
  const info = await page.evaluate(() => {
    const de = document.documentElement;
    const h1 = document.querySelector(".headline-kinetic");
    const sub = document.querySelector(".sub");
    const r = h1.getBoundingClientRect();
    return {
      overflow: de.scrollWidth > de.clientWidth,
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      h1Right: Math.round(r.right),
      h1Width: Math.round(r.width),
      h1Text: h1.textContent.slice(0, 40),
      h1FontSize: getComputedStyle(h1).fontSize,
      subFontSize: getComputedStyle(sub).fontSize,
      subColor: getComputedStyle(sub).color,
    };
  });
  results.viewports.push({ ...vp, ...info });
  await page.screenshot({ path: `${OUT}/${vp.name}.png` });
  await page.close();
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
