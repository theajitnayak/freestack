/**
 * Generate one static page per programme, plus a sitemap.
 *
 * Why this exists: index.html loads data/programs.json in the browser, so the
 * HTML a search engine receives contains none of the programme text. Eighty
 * programmes, eighteen categories and two countries currently live at a single
 * URL with no indexable content, which means the site cannot rank for the only
 * queries it deserves to win - "AWS Activate eligibility", "ELEVATE grant
 * amount", "BIRAC BIG how much".
 *
 * These are not doorway pages. Each carries something no other directory has:
 * the amount, the eligibility conditions, the date we last read the source, and
 * a verbatim quote from the programme's own page. That is the product.
 *
 * Run: node scripts/build-pages.mjs
 * Output: p/<id>.html, sitemap.xml, robots.txt
 */

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const SITE = "https://startupcredits.online";

const { programs, updated } = JSON.parse(
  await readFile(new URL("data/programs.json", ROOT), "utf8")
);

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Search engines truncate around 155 characters, so lead with the number. */
function metaDescription(p) {
  const amount = p.value_label ? `${p.value_label}. ` : "";
  const gate = p.referral_required ? "Referral required. " : "No referral needed. ";
  const first = (p.requirements || [])[0];
  const who = first ? `${first}. ` : "";
  return `${p.company} ${p.name}: ${amount}${gate}${who}Verified ${p.last_checked}.`
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

function statusNote(p) {
  if (p.status === "ended")
    return `<p class="note dead"><strong>This programme has closed.</strong> It stays listed, and marked, so you do not spend an afternoon rediscovering that it is gone.</p>`;
  if (p.status === "closed")
    return `<p class="note warn"><strong>Applications are not open right now.</strong> The programme itself runs in rounds, so the portal is worth watching rather than writing off.</p>`;
  return "";
}

const CSS = `
:root{--bg:#0c0d10;--panel:#141519;--panel-2:#1a1c21;--line:#25272e;--fg:#e8e9ec;
--muted:#8e919c;--dim:#6b6e78;--accent:#4ade80;--accent-dim:#16341f;--warn:#fbbf24;
--warn-dim:#3a2e0d;--dead:#f87171;--dead-dim:#3a1a1a;--blue:#60a5fa;--radius:12px;
--mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font-family:var(--sans);line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--blue)}
.wrap{max-width:720px;margin:0 auto;padding:0 20px}
header{border-bottom:1px solid var(--line);background:linear-gradient(180deg,#101217,var(--bg))}
.nav{display:flex;align-items:center;gap:9px;padding:16px 0;font-weight:650;font-size:16px}
.nav a{text-decoration:none;color:var(--fg);display:flex;align-items:center;gap:9px}
.dot{width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px var(--accent)}
main{padding:34px 0 64px}
.crumb{font-size:13px;color:var(--dim);margin-bottom:18px}
.crumb a{color:var(--muted);text-decoration:none}.crumb a:hover{color:var(--fg)}
.co{font-family:var(--mono);font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
h1{font-size:30px;line-height:1.2;letter-spacing:-.5px;margin:6px 0 14px}
.amount{font-size:21px;font-weight:650;color:var(--accent);margin:0 0 20px}
.tags{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 24px}
.tag{font-size:12px;border:1px solid var(--line);background:var(--panel);
border-radius:999px;padding:4px 11px;color:var(--muted)}
.tag.ok{border-color:var(--accent-dim);background:var(--accent-dim);color:var(--accent)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:20px 22px;margin:0 0 20px}
.card h2{font-size:13px;font-family:var(--mono);letter-spacing:.09em;text-transform:uppercase;
color:var(--muted);margin:0 0 13px;font-weight:600}
ul{margin:0;padding-left:20px}li{margin:0 0 8px}
blockquote{margin:0;padding:14px 18px;border-left:3px solid var(--accent);
background:var(--panel-2);border-radius:0 8px 8px 0;color:var(--fg);font-size:15px}
.src{display:block;margin-top:10px;font-size:12px;color:var(--dim)}
.cta{display:inline-block;background:var(--accent);color:#08140c;font-weight:650;
text-decoration:none;padding:13px 24px;border-radius:9px;font-size:15px}
.cta:hover{filter:brightness(1.08)}
.after{font-size:13px;color:var(--dim);margin-top:11px}
.note{border-radius:9px;padding:13px 16px;font-size:14px;margin:0 0 20px}
.note.warn{background:var(--warn-dim);border:1px solid #5a4a15;color:#fde68a}
.note.dead{background:var(--dead-dim);border:1px solid #5a2626;color:#fca5a5}
footer{border-top:1px solid var(--line);padding:26px 0;font-size:13px;color:var(--dim)}
footer a{color:var(--muted)}
@media(max-width:600px){h1{font-size:24px}.wrap{padding:0 16px}}
`;

function page(p) {
  const title = `${p.company} ${p.name} — ${p.value_label || "free credits"}`;
  const url = `${SITE}/p/${p.id}.html`;
  const desc = metaDescription(p);

  // Describing the offer, its value and where to claim it, so the entry can be
  // understood by something other than a human reading the page.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Offer",
    name: `${p.company} ${p.name}`,
    description: desc,
    url: p.url,
    seller: { "@type": "Organization", name: p.company },
    category: p.category,
    availability:
      p.status === "ended" ? "https://schema.org/Discontinued" : "https://schema.org/InStock",
    ...(p.value_usd ? { price: p.value_usd, priceCurrency: "USD" } : {}),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎁</text></svg>">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>${CSS}</style>
</head>
<body>
<header><div class="wrap"><div class="nav"><a href="/"><span class="dot"></span>Startup Credits</a></div></div></header>
<main><div class="wrap">
  <div class="crumb"><a href="/">All programmes</a> &rsaquo; ${esc(p.category)}</div>
  <div class="co">${esc(p.company)}</div>
  <h1>${esc(p.name)}</h1>
  <p class="amount">${esc(p.value_label || "Amount not published")}</p>

  <div class="tags">
    <span class="tag${p.referral_required ? "" : " ok"}">${p.referral_required ? "Referral required" : "No referral needed"}</span>
    <span class="tag">${esc(p.difficulty)} to get</span>
    <span class="tag">${esc(p.category)}</span>
    ${p.recurring ? '<span class="tag">Renews</span>' : ""}
    ${p.country === "IN" ? '<span class="tag">India</span>' : ""}
  </div>

  ${statusNote(p)}

  <div class="card">
    <h2>Who qualifies</h2>
    <ul>${(p.requirements || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
  </div>

  ${
    p.source_quote
      ? `<div class="card"><h2>In their own words</h2>
    <blockquote>${esc(p.source_quote)}
    <span class="src">— ${esc(p.company)}, read ${esc(p.last_checked)}</span></blockquote></div>`
      : ""
  }

  ${p.notes ? `<div class="card"><h2>What to know</h2><p style="margin:0">${esc(p.notes)}</p></div>` : ""}

  <p><a class="cta" href="${esc(p.url)}" rel="noopener">Apply at ${esc(p.company)} &rarr;</a></p>
  <p class="after">Goes to ${esc(p.company)}'s own page. We last read it on ${esc(p.last_checked)} and check it again every morning.</p>
</div></main>
<footer><div class="wrap">
  <a href="/">All ${programs.length} programmes</a> &middot;
  <a href="https://github.com/theajitnayak/startupcredits">Source and data</a> &middot;
  Checked daily, corrections in public.
</div></footer>
</body>
</html>`;
}

// Rebuild from scratch so a renamed or deleted programme cannot leave an orphan
// page behind, still indexed and quietly wrong.
await rm(new URL("p/", ROOT), { recursive: true, force: true });
await mkdir(new URL("p/", ROOT), { recursive: true });

for (const p of programs) {
  await writeFile(new URL(`p/${p.id}.html`, ROOT), page(p), "utf8");
}

const urls = [
  { loc: `${SITE}/`, pri: "1.0", mod: updated },
  ...programs.map((p) => ({ loc: `${SITE}/p/${p.id}.html`, pri: "0.8", mod: p.last_checked })),
];

await writeFile(
  new URL("sitemap.xml", ROOT),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${u.loc}</loc><lastmod>${u.mod}</lastmod><priority>${u.pri}</priority></url>`
  )
  .join("\n")}
</urlset>
`,
  "utf8"
);

await writeFile(
  new URL("robots.txt", ROOT),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`,
  "utf8"
);

console.log(`Built ${programs.length} pages, sitemap.xml and robots.txt`);
