/**
 * Weekly link check for data/programs.json.
 *
 * The whole promise of this site is that its entries are current. That promise
 * decays on its own: application pages move, programmes quietly close, and a
 * date in a JSON file does not notice. This script is what keeps the promise
 * honest between manual reviews.
 *
 * It deliberately does NOT edit the data. A 404 means "a human should look",
 * not "mark it dead" — plenty of live programmes sit behind redirects, login
 * walls and bot blocks. Guessing here would reintroduce exactly the rot we
 * exist to correct.
 */

import { readFile, writeFile } from "node:fs/promises";

const TIMEOUT_MS = 20000;
const CONCURRENCY = 6;

/** Codes that mean "the server is there and refusing robots", not "gone".
 *  Oracle returns 403 to anything automated; plenty of sites 405 a HEAD. */
const BOT_BLOCKED = new Set([401, 403, 405, 406, 429, 999]);

async function probe(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const opts = {
    redirect: "follow",
    signal: ctl.signal,
    headers: {
      // Without a real UA a lot of marketing sites return 403 and we'd cry wolf.
      "user-agent":
        "Mozilla/5.0 (compatible; startupcredits-linkcheck/1.0; +https://startupcredits.online)",
      accept: "text/html,application/xhtml+xml,*/*",
    },
  };

  try {
    let res = await fetch(url, { ...opts, method: "HEAD" });
    // Many servers mishandle HEAD; retry properly before calling anything broken.
    if (res.status >= 400) res = await fetch(url, { ...opts, method: "GET" });
    return { status: res.status, finalUrl: res.url };
  } catch (err) {
    clearTimeout(timer);
    try {
      const res = await fetch(url, { ...opts, method: "GET" });
      return { status: res.status, finalUrl: res.url };
    } catch (err2) {
      return { status: 0, error: err2.name === "AbortError" ? "timeout" : err2.message };
    }
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

const raw = await readFile(new URL("../data/programs.json", import.meta.url), "utf8");
const programs = JSON.parse(raw).programs;

const results = await mapLimit(programs, CONCURRENCY, async (p) => {
  const r = await probe(p.url);
  return { ...p, ...r };
});

const dead = results.filter((r) => r.status === 404 || r.status === 410);
const unreachable = results.filter((r) => r.status === 0);
const blocked = results.filter((r) => BOT_BLOCKED.has(r.status));
const ok = results.filter(
  (r) => r.status >= 200 && r.status < 400
);

const today = new Date().toISOString().slice(0, 10);
const stale = results.filter((r) => {
  const days = (Date.now() - Date.parse(r.last_checked)) / 86400000;
  return days > 90;
});

const line = (r) => `- [ ] **${r.company} — ${r.name}** · \`${r.id}\` · ${r.status || r.error} · ${r.url}`;

let md = `# Link check — ${today}\n\n`;
md += `${results.length} programmes checked. `;
md += `${ok.length} reachable, ${blocked.length} bot-blocked, ${dead.length} not found, ${unreachable.length} unreachable.\n\n`;

if (dead.length) {
  md += `## Page not found (${dead.length})\n\nThese returned 404 or 410. Check whether the programme moved or closed, then update \`data/programs.json\` — set \`status: "ended"\` if it is genuinely gone.\n\n${dead.map(line).join("\n")}\n\n`;
}
if (unreachable.length) {
  md += `## Could not reach (${unreachable.length})\n\nTimed out or DNS failed. Often temporary — confirm by hand before changing anything.\n\n${unreachable.map(line).join("\n")}\n\n`;
}
if (blocked.length) {
  md += `## Bot-blocked (${blocked.length})\n\nExpected and not a problem: these refuse automated requests. Listed only so the numbers add up.\n\n${blocked.map(line).join("\n")}\n\n`;
}
if (stale.length) {
  md += `## Not verified in 90+ days (${stale.length})\n\nThe link works, but nobody has re-read the terms in a while. Amounts and eligibility change silently — this is how other directories rot.\n\n${stale.map((r) => `- [ ] **${r.company} — ${r.name}** · last checked ${r.last_checked}`).join("\n")}\n\n`;
}
if (!dead.length && !unreachable.length && !stale.length) {
  md += `Every link resolves and nothing is over 90 days old. No action needed.\n`;
}

await writeFile(process.env.REPORT_PATH || "link-report.md", md);

// Fail the run only for genuinely broken links, so a red badge means something.
const problems = dead.length + unreachable.length;
console.log(md);
console.log(`::notice::${ok.length}/${results.length} reachable, ${problems} needing attention`);
if (problems > 0) process.exitCode = 1;
