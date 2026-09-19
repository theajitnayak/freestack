/**
 * Weekly terms-drift check for data/programs.json.
 *
 * check-links.mjs answers "does the URL still resolve". This answers the harder
 * and more important question: does the page still SAY what we claim it says.
 *
 * That gap is where every other credit directory rots. A programme quietly
 * halves its amount or adds a funding requirement, the link keeps returning
 * 200, and the listing is confidently wrong for a year. Our one promise is the
 * date next to each entry, so re-reading terms is not a nice-to-have — it is
 * the product.
 *
 * Like check-links.mjs, this deliberately does NOT edit the data. It reads each
 * page, extracts the facts, diffs them against what we published, and reports
 * only the fields that moved — each with a verbatim quote so a human can judge
 * in seconds instead of re-reading the whole page. An LLM is good at "this
 * sentence now says $5,000"; it is not good at deciding what we publish.
 *
 * Billing: extraction runs on Vertex AI in your own Google Cloud project, so
 * usage draws on that project's credit rather than a personal API key.
 *
 *   GOOGLE_CLOUD_PROJECT   required, e.g. project-432db1bb-a8a3-4cf6-a6b6
 *   GOOGLE_CLOUD_LOCATION  optional, defaults to us-central1
 *   GOOGLE_ACCESS_TOKEN    optional, falls back to `gcloud auth print-access-token`
 *   REPORT_PATH            optional, defaults to terms-report.md
 *   ONLY                   optional, comma-separated programme ids, for testing
 *
 * Cost note: 80 pages a week on Gemini Flash is cents per month. This workload
 * is not going to consume a $300 credit — see the note at the bottom of the
 * report. The credit is for what comes next (discovery), not for this.
 */

import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  htmlToText,
  amountChanged,
  numbersIn,
  newGatingRequirements,
  classifyLabel,
  BOT_BLOCKED,
} from "./terms-lib.mjs";

const execFileAsync = promisify(execFile);

const MODEL = "gemini-2.5-flash";
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
const TIMEOUT_MS = 30000;
const CONCURRENCY = 4; // Vertex is fine with more; the marketing sites are not.

if (!PROJECT) {
  console.error("GOOGLE_CLOUD_PROJECT is not set. Nothing to bill extraction to.");
  process.exit(2);
}

async function accessToken() {
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN;
  try {
    const { stdout } = await execFileAsync("gcloud", ["auth", "print-access-token"], {
      shell: process.platform === "win32",
    });
    return stdout.trim();
  } catch {
    console.error(
      "No GOOGLE_ACCESS_TOKEN and `gcloud auth print-access-token` failed.\n" +
        "Run `gcloud auth application-default login`, or set GOOGLE_ACCESS_TOKEN."
    );
    process.exit(2);
  }
}

async function fetchText(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctl.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; startupcredits-termscheck/1.0; +https://startupcredits.online)",
        accept: "text/html,application/xhtml+xml,*/*",
      },
    });
    if (BOT_BLOCKED.has(res.status)) return { blocked: true, status: res.status };
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const html = await res.text();
    return { text: htmlToText(html), finalUrl: res.url };
  } catch (err) {
    return { error: err.name === "AbortError" ? "timeout" : err.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Structured output so we get facts back, not an essay about the facts. */
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    page_is_about_this_programme: {
      type: "BOOLEAN",
      description:
        "False if the page is a generic marketing/login/404 page rather than this specific programme.",
    },
    programme_status: {
      type: "STRING",
      enum: ["open", "ended", "unclear"],
      description: "'ended' only if the page explicitly says the programme is closed or paused.",
    },
    value_label: {
      type: "STRING",
      description:
        "The credit amount exactly as the page states it, e.g. 'Up to $5,000'. Empty string if the page does not state an amount.",
    },
    requirements: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Eligibility conditions the page states. One short sentence each. Omit marketing copy.",
    },
    source_quote: {
      type: "STRING",
      description:
        "One verbatim sentence from the page that best evidences the amount or the main eligibility bar. Must appear on the page word for word.",
    },
    confidence: {
      type: "STRING",
      enum: ["high", "medium", "low"],
      description: "low if the page is vague, gated, or you are inferring rather than reading.",
    },
  },
  required: [
    "page_is_about_this_programme",
    "programme_status",
    "value_label",
    "requirements",
    "source_quote",
    "confidence",
  ],
};

const SYSTEM = `You read a company's own startup/open-source credit programme page and report
what it currently says. You are auditing a public directory for accuracy.

Rules:
- Report only what the page states. Never fill gaps from prior knowledge about the programme.
- If the page does not state an amount, return an empty value_label. Do not guess.
- source_quote must be copied verbatim from the page text you were given.
- Mark confidence "low" rather than inventing structure from a vague page.
- A page behind a login wall or a generic product page is page_is_about_this_programme: false.`;

async function extract(token, program, pageText) {
  const url =
    `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}` +
    `/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `Programme we have listed: ${program.company} — ${program.name}\n` +
              `Page URL: ${program.url}\n\n` +
              `--- PAGE TEXT ---\n${pageText}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Vertex ${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Vertex returned no content");
  return JSON.parse(text);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

// ---------------------------------------------------------------------------

const raw = await readFile(new URL("../data/programs.json", import.meta.url), "utf8");
const all = JSON.parse(raw).programs;

const only = process.env.ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
const programs = only ? all.filter((p) => only.includes(p.id)) : all;

const token = await accessToken();
console.log(`Checking terms for ${programs.length} programmes via ${MODEL} on ${PROJECT}...`);

const results = await mapLimit(programs, CONCURRENCY, async (p) => {
  const page = await fetchText(p.url);
  if (page.blocked) return { p, kind: "blocked", status: page.status };
  if (page.error) return { p, kind: "unreadable", error: page.error };
  if (!page.text || page.text.length < 200) return { p, kind: "unreadable", error: "page had almost no text" };

  try {
    const found = await extract(token, p, page.text);
    return { p, kind: "read", found };
  } catch (err) {
    return { p, kind: "error", error: err.message };
  }
});

const drift = [];
const confirmed = [];
const needsEyes = [];

for (const r of results) {
  if (r.kind !== "read") {
    needsEyes.push(r);
    continue;
  }
  const { p, found } = r;

  if (!found.page_is_about_this_programme || found.confidence === "low") {
    needsEyes.push({ ...r, kind: "unclear" });
    continue;
  }

  const changes = [];

  if (found.programme_status === "ended" && p.status !== "ended") {
    changes.push({
      field: "status",
      ours: p.status,
      theirs: "ended",
      note: "Page says the programme has closed.",
    });
  }

  // Only about a quarter of the list states a figure we can diff. Running the
  // numeric comparison over the rest would compare nothing against nothing
  // every week and train us to skim past the report.
  const kind = classifyLabel(p.value_label);

  if (kind === "amount" && amountChanged(p.value_label, found.value_label)) {
    changes.push({ field: "value_label", ours: p.value_label, theirs: found.value_label });
  }

  // The inverse case, and the one worth actually chasing: we list a programme
  // as "amount not published" and the vendor has since published one. That is
  // a listing we can improve, not a problem to fix.
  if (kind === "unpublished" && numbersIn(found.value_label).length) {
    changes.push({
      field: "value_label",
      ours: p.value_label,
      theirs: found.value_label,
      note: "Amount is now published — this entry can be upgraded.",
    });
  }

  const gating = newGatingRequirements(p.requirements, found.requirements);
  if (gating.length) {
    changes.push({
      field: "requirements",
      ours: "(not listed by us)",
      theirs: gating.join(" · "),
      note: "Possible new eligibility bar.",
    });
  }

  if (changes.length) drift.push({ p, found, changes });
  else confirmed.push({ p, found });
}

const today = new Date().toISOString().slice(0, 10);

let md = `# Terms check — ${today}\n\n`;
md += `Read ${results.length} programme pages with \`${MODEL}\`. `;
md += `${confirmed.length} still match what we publish, ${drift.length} may have drifted, `;
md += `${needsEyes.length} could not be read automatically.\n\n`;
md += `Nothing here has been applied to \`data/programs.json\`. Each item is a proposal with a quote — confirm it on the page before editing.\n\n`;

if (drift.length) {
  md += `## Possible drift (${drift.length})\n\n`;
  for (const { p, found, changes } of drift) {
    md += `### ${p.company} — ${p.name}\n`;
    md += `\`${p.id}\` · last checked ${p.last_checked} · ${p.url}\n\n`;
    for (const c of changes) {
      md += `- **${c.field}**${c.note ? ` — ${c.note}` : ""}\n`;
      md += `  - we publish: \`${c.ours}\`\n`;
      md += `  - page says: \`${c.theirs}\`\n`;
    }
    if (found.source_quote) md += `\n> ${found.source_quote}\n`;
    md += `\n`;
  }
}

if (needsEyes.length) {
  md += `## Could not read automatically (${needsEyes.length})\n\n`;
  md += `Expected for login walls and bot-blocked sites. Not evidence of a problem.\n\n`;
  for (const r of needsEyes) {
    const why =
      r.kind === "blocked" ? `bot-blocked (${r.status})`
      : r.kind === "unclear" ? "page too vague or not programme-specific"
      : r.error;
    md += `- [ ] **${r.p.company} — ${r.p.name}** · \`${r.p.id}\` · ${why}\n`;
  }
  md += `\n`;
}

if (confirmed.length) {
  md += `## Confirmed unchanged (${confirmed.length})\n\n`;
  md += `<details><summary>Show</summary>\n\n`;
  for (const { p, found } of confirmed) {
    md += `- **${p.company} — ${p.name}** · \`${p.id}\``;
    if (found.source_quote) md += `\n  > ${found.source_quote}`;
    md += `\n`;
  }
  md += `\n</details>\n\n`;
}

// Entries missing source_quote are the ones a reader has least reason to trust.
// The check produces quotes for free, so surface where they can be backfilled.
const backfill = confirmed.filter((c) => !c.p.source_quote && c.found.source_quote);
if (backfill.length) {
  md += `## Quotes available to backfill (${backfill.length})\n\n`;
  md += `These entries have no \`source_quote\` in \`programs.json\`, but the page gave us one:\n\n`;
  for (const { p, found } of backfill) {
    md += `- \`${p.id}\` — "${found.source_quote}"\n`;
  }
  md += `\n`;
}

await writeFile(process.env.REPORT_PATH || "terms-report.md", md);
console.log(md);
console.log(
  `::notice::${confirmed.length} confirmed, ${drift.length} drifted, ${needsEyes.length} unreadable`
);

// Drift is the signal worth interrupting a human for. Unreadable pages are normal.
if (drift.length > 0) process.exitCode = 1;
