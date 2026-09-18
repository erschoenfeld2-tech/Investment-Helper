// Sichtprüfung: rendert die Seite in allen Zuständen und legt Screenshots
// in test/ ab. Prüft zugleich auf JS-Fehler und waagerechtes Überlaufen.
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  // In der Entwicklungsumgebung liegt Chromium an fester Stelle; sonst nimmt
  // Playwright seinen eigenen Download (einmalig: npx playwright install chromium).
  const fixed = "/opt/pw-browsers/chromium";
  const browser = await chromium.launch(
    require("fs").existsSync(fixed) ? { executablePath: fixed } : {},
  );
  const cases = [
    ["ok-light", "?mode=ok", "light", "BMW"],
    ["ok-dark", "?mode=ok", "dark", "BMW"],
    ["empty", "?mode=ok", "light", null],
    ["offline", "?mode=offline", "light", null],
    ["budget", "?mode=budget", "light", "BMW"],
    ["stale", "?mode=stale", "light", "BMW"],
    ["nonotes", "?mode=nonotes", "light", "BMW"],
    ["mobile", "?mode=ok", "light", "BMW", { width: 390, height: 844 }],
    // ETF mit ≥ 3 abgeschlossenen Korrekturen — einziger Fall, in dem
    // Baustein 4 um das Korrekturmuster ergänzt wird.
    ["etf-correction", "?mode=ok", "light", "MSCI"],
  ];
  for (const [name, qs, scheme, query, vp] of cases) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: vp || { width: 1320, height: 1000 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", e => errs.push("PAGEERROR " + e.message));
    page.on("console", m => { if (m.type() === "error") errs.push("CONSOLE " + m.text()); });
    await page.goto("file://" + path.resolve(__dirname, "page.html") + qs, { waitUntil: "load" });
    await page.waitForTimeout(400);
    if (query) {
      await page.fill("#q", query);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(900);
    }
    // horizontal overflow check
    const of = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    await page.screenshot({ path: path.resolve(__dirname, name + ".png"), fullPage: true });
    console.log(`${name}: overflow ${of.sw > of.cw + 1 ? "YES (" + of.sw + ">" + of.cw + ")" : "no"} | errors: ${errs.length ? errs.join(" || ") : "none"}`);
    await ctx.close();
  }
  await browser.close();
})();
