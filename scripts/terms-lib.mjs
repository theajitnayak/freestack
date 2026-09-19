/**
 * Pure helpers for check-terms.mjs.
 *
 * Split out for one reason: these are the parts that can be wrong in a way
 * nobody notices. A bad amount comparison does not crash — it quietly files a
 * false alarm every week until the reports get ignored, which is worse than
 * having no check at all. Keeping them here means scripts/terms-lib.test.mjs
 * can exercise them without a Google Cloud token.
 */

const MAX_PAGE_CHARS = 24000;

/** No dependencies in this repo and none needed: we want prose, not structure.
 *  Crude is fine — Gemini reads through the noise better than a parser would. */
export function htmlToText(html, limit = MAX_PAGE_CHARS) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    // Numeric entities before the named ones: vendors write prices as &#36;5,000
    // and &#8377; surprisingly often, and an amount we cannot see is an amount
    // we cannot diff.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&rsquo;|&apos;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, "&") // last, so &amp;lt; does not become a tag
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim()
    .slice(0, limit);
}

/**
 * Pull the credit amounts out of a label, as numbers.
 *
 * Amounts are written a hundred different ways across 80 vendors, so comparing
 * the prose would cry wolf constantly: "Up to $5,000" and "up to $5000 in
 * credits" are the same fact. We compare the numbers instead.
 *
 * lakh and crore are not optional niceties. A third of the India section is
 * denominated that way ("up to Rs 20 crore per startup"), and without them
 * those entries parse to nothing and silently opt out of drift detection
 * entirely — the India listings are exactly the ones nobody else maintains.
 *
 * The 1000 floor is deliberate. Below it we hit years ("founded in 2026"),
 * employee counts and durations far more often than real credit amounts, and a
 * false alarm costs more than missing a $200 programme.
 */
const MULTIPLIER = { k: 1_000, m: 1_000_000, lakh: 100_000, lakhs: 100_000, crore: 10_000_000, crores: 10_000_000 };

export function numbersIn(s) {
  if (!s) return [];
  const out = [];
  const re = /([\d][\d,]*(?:\.\d+)?)\s*(k|m|lakhs?|crores?)?\b/gi;
  for (const m of String(s).matchAll(re)) {
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    n *= MULTIPLIER[(m[2] || "").toLowerCase()] ?? 1;
    if (n >= 1000) out.push(n);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * What kind of claim is this label making?
 *
 * Roughly two thirds of the list does not state a credit amount at all, and
 * that is not a data quality problem — it is three genuinely different kinds of
 * offer that each drift in a different way:
 *
 *   amount      a number we can diff directly
 *   unpublished the vendor deliberately does not say; the day they publish one
 *               is real news for the site, so an amount APPEARING is the signal
 *   free-plan   a free tier, not credits; what matters is whether it still exists
 *   discount    a percentage off, which moves independently of any amount
 *   ended       we already believe this one is closed
 *
 * Running the numeric diff over all of them would compare nothing against
 * nothing 55 times a week and teach us to ignore the report.
 */
export function classifyLabel(label) {
  const t = String(label || "").toLowerCase();
  if (!t.trim()) return "unpublished";
  if (/\b(discontinued|ended|closed|shut down|no longer)\b/.test(t)) return "ended";
  if (/\b(not published|amount not|unpublished|set by your partner)\b/.test(t)) return "unpublished";
  if (numbersIn(label).length) return "amount";
  if (/%\s*off|\bdiscount\b|\boff year\b/.test(t)) return "discount";
  if (/\bfree\b|\bunlimited\b|\blifetime\b|\bno pull rate limits\b/.test(t)) return "free-plan";
  // Credits offered with no figure attached. Same watch as an explicit
  // "amount not published": the day a number appears, that is news.
  if (/\bcredits?\b|\bgrants?\b|\bsponsorship\b|\bplan\b/.test(t)) return "unpublished";
  // Everything left is a real offer that is not credits at all — a tax
  // deduction, a loan guarantee. Amount drift does not apply to these.
  return "other";
}

/**
 * Did the amount actually move?
 *
 * Asymmetric on purpose. A page that states no amount is silence, not drift —
 * plenty of programme pages describe eligibility and make you apply to learn
 * the number. Treating silence as "changed" would flag a third of the list
 * every week.
 */
export function amountChanged(ours, theirs) {
  const a = numbersIn(ours);
  const b = numbersIn(theirs);
  if (!b.length) return false; // page states no amount — silence, not drift
  if (!a.length) return true;  // we publish a number, page now states a different one
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * Find eligibility conditions on the page that look newly ADDED and materially
 * gating — a new funding requirement is the classic one, and the single change
 * most likely to make a listing actively misleading.
 *
 * Requirements drift is noisy by nature (vendors reword constantly), so this is
 * intentionally narrow: only conditions matching the gating vocabulary, and
 * only when they share little wording with what we already publish.
 */
const GATING = /\b(funded|funding|investor|series [a-d]|raised|venture|accelerator|partner|referral|equity)\b/;

export function newGatingRequirements(ourRequirements, theirRequirements) {
  const oursLower = ourRequirements.join(" ").toLowerCase();
  return theirRequirements.filter((req) => {
    const t = String(req).toLowerCase();
    if (!GATING.test(t)) return false;
    const words = t.split(/\W+/).filter((w) => w.length > 4);
    if (!words.length) return false;
    const overlap = words.filter((w) => oursLower.includes(w)).length;
    return overlap / words.length < 0.5;
  });
}

/** Codes that mean "the server is there and refusing robots", not "gone".
 *  Same set as check-links.mjs — Oracle 403s anything automated. */
export const BOT_BLOCKED = new Set([401, 403, 405, 406, 429, 999]);
