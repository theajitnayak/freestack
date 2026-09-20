/**
 * Render a page in a real browser, for sites that ship an empty shell to fetch().
 *
 * This exists because of three specific entries. Startup India Seed Fund, MeitY
 * GENESIS and MeitY SAMRIDH are the highest-value central schemes we list, and
 * all three returned almost no text to a plain fetch: they are client-rendered,
 * so the HTML that arrives over the wire is a loading spinner. A terms check
 * that silently skips the biggest schemes is not a terms check.
 *
 * It is deliberately a FALLBACK, not the default path. Rendering costs a second
 * or two and a lot of memory per page; 77 of our 80 pages are plain HTML and do
 * not need it. check-terms.mjs only reaches for this when fetch() comes back
 * with too little text to be a real page.
 *
 * Playwright is a devDependency. If it is missing, callers get null and degrade
 * to the old behaviour rather than crashing — the weekly link check and the
 * rest of the terms check should not die because a browser is not installed.
 */

let browserPromise = null;
let playwrightMissing = false;

const NAV_TIMEOUT_MS = 45000;
const SETTLE_MS = 2500;

async function getBrowser() {
  if (playwrightMissing) return null;
  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        const { chromium } = await import("playwright");
        return await chromium.launch({ args: ["--disable-dev-shm-usage"] });
      } catch (err) {
        playwrightMissing = true;
        console.warn(
          `Browser rendering unavailable (${err.message.split("\n")[0]}). ` +
            `Run: npm install && npx playwright install chromium`
        );
        return null;
      }
    })();
  }
  return browserPromise;
}

/**
 * Returns the rendered page's visible text, or null if rendering is unavailable
 * or the page could not be loaded.
 */
export async function renderText(url) {
  const browser = await getBrowser();
  if (!browser) return null;

  let context;
  try {
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/140.0.0.0 Safari/537.36 startupcredits-termscheck/1.0",
      viewport: { width: 1280, height: 2000 },
      // Several .gov.in portals serve a certificate chain that Node rejects but
      // browsers accept. We are reading public policy pages, not sending data.
      ignoreHTTPSErrors: true,
    });

    const page = await context.newPage();

    // Images and fonts are pure cost here — we only ever read the text.
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (type === "image" || type === "font" || type === "media") return route.abort();
      return route.continue();
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

    // domcontentloaded fires before the client-side render finishes, which is
    // the whole problem we are solving. Wait for the network to go quiet, then
    // give the framework a moment to paint. networkidle times out on pages with
    // long-polling or analytics beacons, so a timeout here is not fatal.
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);

    const text = await page.evaluate(() => document.body?.innerText || "");
    return text.replace(/[ \t ]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  } catch (err) {
    console.warn(`  render failed for ${url}: ${err.message.split("\n")[0]}`);
    return null;
  } finally {
    await context?.close().catch(() => {});
  }
}

/** Callers must invoke this or the process will not exit. */
export async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser?.close().catch(() => {});
}
