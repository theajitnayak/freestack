/**
 * Tests for the parts of the terms check that fail silently.
 *
 * Run: node --test scripts/
 *
 * The cases below are taken from real value_label strings in data/programs.json.
 * That matters — the point is not that the regex works in the abstract, it is
 * that it does not cry wolf on the 80 entries we actually publish.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { htmlToText, numbersIn, amountChanged, newGatingRequirements, classifyLabel } from "./terms-lib.mjs";

test("numbersIn reads the amounts we actually publish", () => {
  assert.deepEqual(numbersIn("Up to $5,000 self-serve"), [5000]);
  assert.deepEqual(numbersIn("$10k bootstrapped / $100k / $350k max"), [10000, 100000, 350000]);
  assert.deepEqual(numbersIn("Up to $150,000 Azure credits, unlocked over time"), [150000]);
  assert.deepEqual(numbersIn("~$3,600/yr credits + third-party starter pack"), [3600]);
  assert.deepEqual(numbersIn("$50,000 credits for 12 months + $12,000 partner benefits"), [12000, 50000]);
});

test("numbersIn ignores years, durations and small counts", () => {
  // "founded in 2026" must not read as a $2,026 credit
  assert.deepEqual(numbersIn("Founded within the last 10 years"), []);
  assert.deepEqual(numbersIn("Fewer than 25 employees"), []);
  assert.deepEqual(numbersIn("6 months Claude Max 20x"), []);
  assert.deepEqual(numbersIn("Rolling review, up to 10,000 maintainers accepted"), [10000]);
});

test("amountChanged treats rewording as unchanged", () => {
  assert.equal(amountChanged("Up to $5,000", "up to $5000 in credits"), false);
  assert.equal(amountChanged("$10k bootstrapped / $100k / $350k max", "$350k / $100k / $10k"), false);
});

test("amountChanged catches a real cut", () => {
  assert.equal(amountChanged("Up to $10,000", "Up to $5,000"), true);
  assert.equal(amountChanged("$50,000 credits", "$25,000 credits"), true);
});

test("amountChanged treats a silent page as silence, not drift", () => {
  // Most gated programme pages describe eligibility and never print a number.
  assert.equal(amountChanged("Up to $5,000", ""), false);
  assert.equal(amountChanged("Up to $5,000", "Apply to find out what you qualify for"), false);
});

test("newGatingRequirements flags an added funding bar", () => {
  const ours = ["Under $1M raised, early product or MVP, no investor needed"];
  const theirs = ["Must have raised a priced seed round from an institutional investor"];
  assert.equal(newGatingRequirements(ours, theirs).length, 1);
});

test("newGatingRequirements ignores a reworded version of what we already say", () => {
  const ours = ["Self-funded track: under $1M raised, early product or MVP, no investor needed"];
  const theirs = ["Self-funded track: under $1M raised, no investor needed"];
  assert.deepEqual(newGatingRequirements(ours, theirs), []);
});

test("newGatingRequirements ignores non-gating copy", () => {
  const ours = ["Public GitHub repo"];
  const theirs = ["Build something people love", "Join our Discord community"];
  assert.deepEqual(newGatingRequirements(ours, theirs), []);
});

test("htmlToText strips scripts, styles and tags but keeps the prose", () => {
  const html = `
    <html><head><style>.a{color:red}</style><script>var x=1;</script></head>
    <body><h1>Cloudflare for Startups</h1>
    <p>Up to &#36;10,000 in credits.</p>
    <!-- a comment --><div>Under &lt;$1M&gt; raised &amp; bootstrapped</div></body></html>`;
  const text = htmlToText(html);
  assert.match(text, /Cloudflare for Startups/);
  assert.match(text, /Up to \$10,000 in credits\./);
  assert.match(text, /Under <\$1M> raised & bootstrapped/);
  assert.doesNotMatch(text, /var x=1/);
  assert.doesNotMatch(text, /color:red/);
  assert.doesNotMatch(text, /a comment/);
});

test("htmlToText respects the character cap", () => {
  assert.equal(htmlToText("<p>" + "x".repeat(50000) + "</p>", 100).length, 100);
});

test("numbersIn reads Indian denominations", () => {
  // A third of the India section is written this way. Without lakh/crore these
  // parse to nothing and drop out of drift detection without a word.
  assert.deepEqual(numbersIn("Up to ₹100 lakh per startup"), [10_000_000]);
  assert.deepEqual(numbersIn("Government guarantee on borrowing, up to ₹20 crore per startup"), [200_000_000]);
  assert.deepEqual(numbersIn("₹10 lakh early stage, ₹50 lakh pilot, up to ₹1 crore deeptech"), [1_000_000, 5_000_000, 10_000_000]);
  assert.deepEqual(numbersIn("Matching funding up to ₹40 lakh"), [4_000_000]);
});

test("classifyLabel separates the kinds of offer that drift differently", () => {
  assert.equal(classifyLabel("Up to $5,000 self-serve"), "amount");
  assert.equal(classifyLabel("₹50 lakh grant-in-aid over up to 18 months"), "amount");
  assert.equal(classifyLabel("Credits - amount not published"), "unpublished");
  assert.equal(classifyLabel("Amount not published - set by your partner"), "unpublished");
  assert.equal(classifyLabel("Discontinued"), "ended");
  assert.equal(classifyLabel("93% off year 1, 50% year 2, 25% year 3"), "discount");
  assert.equal(classifyLabel("Free Teams account"), "free-plan");
  assert.equal(classifyLabel("Unlimited CI/CD minutes, 4 Linux + 1 macOS parallel"), "free-plan");
  assert.equal(classifyLabel(""), "unpublished");
});

test("every published value_label classifies, and every 'amount' one parses", async () => {
  // A label that classifies as "amount" but parses to nothing would silently
  // opt out of drift detection — that is the failure this guards against.
  const { programs } = JSON.parse(await readFile(new URL("../data/programs.json", import.meta.url), "utf8"));

  const broken = programs
    .filter((p) => classifyLabel(p.value_label) === "amount" && !numbersIn(p.value_label).length)
    .map((p) => `${p.id}: "${p.value_label}"`);
  assert.deepEqual(broken, [], `classified as an amount but unparseable:\n${broken.join("\n")}`);

  // "other" is legitimate but should stay rare — it means an offer that is not
  // credits at all (a tax deduction, a loan guarantee). If it grows, the
  // classifier has stopped keeping up with what we list.
  const other = programs
    .filter((p) => classifyLabel(p.value_label) === "other")
    .map((p) => `${p.id}: "${p.value_label}"`);
  assert.ok(other.length <= 3, `too many uncategorised offers (${other.length}):\n${other.join("\n")}`);
});

test("classifyLabel treats credits with no figure as unpublished, not uncategorised", () => {
  assert.equal(classifyLabel("Annual recurring credits (Workers, R2, Pages, Zero Trust)"), "unpublished");
  assert.equal(classifyLabel("Monthly credit grants + co-marketing"), "unpublished");
  assert.equal(classifyLabel("Direct cash sponsorship via engineer nominations"), "unpublished");
  // A tax deduction is genuinely not a credit offer — amount drift cannot apply.
  assert.equal(classifyLabel("100% income-tax deduction for 3 financial years"), "other");
});

test("amountChanged ignores a page that just states its headline figure", () => {
  // Cloudflare's page says "up to $350k"; we break out the $10k bootstrapped
  // tier because that is the part a reader actually needs. Not drift.
  assert.equal(amountChanged("$10k bootstrapped / $100k / $350k max", "Up to $350k in credits"), false);
  assert.equal(amountChanged("Up to $5,000 self-serve / up to $200,000 with a partner", "Up to $200,000"), false);
});

test("amountChanged still catches a page whose ceiling moved", () => {
  // Subset of our figures, but the top tier is gone — that is worth a look.
  assert.equal(amountChanged("$10k / $100k / $350k max", "Up to $100k in credits"), true);
  // A figure we do not list at all.
  assert.equal(amountChanged("$10k / $100k / $350k max", "Up to $500k in credits"), true);
});
