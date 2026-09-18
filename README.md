# FreeStack

**An open directory of free cloud, AI and developer-tool credits — for open source maintainers and startup founders.**

Every entry is dated. Dead programmes are flagged, not quietly left up. The data is one JSON file you can send a pull request to.

🔗 **[freestack.dev](https://freestack.dev)** *(replace with your real URL)*

---

## Why another list

There are plenty of "free startup credits" pages. Almost all of them share three problems:

1. **They go stale.** OpenAI ended its general startup credits programme, and a lot of directories still list it. A programme that no longer exists is worse than no entry at all — it wastes an afternoon.
2. **They quote you the headline number.** "Up to $350,000!" is real, but it's the top tier, and it needs a warm introduction from a VC or an accelerator. A bootstrapped solo founder reading that page is being sold a number they will never see.
3. **They're closed.** You can't correct them. They're affiliate funnels with a CMS behind them, and nobody outside the company can fix a wrong figure.

FreeStack does three things differently:

| | |
|---|---|
| **Dated entries** | Every programme carries a `last_checked` date, shown on the card. You can see exactly how stale the claim is. |
| **Dead programmes stay visible** | Marked `status: "ended"` with a red badge and a "do not apply" note, so you stop hunting for something that's gone. |
| **Two numbers, not one** | The eligibility checker shows what you can realistically get *today with no referral* alongside the headline maximum. The gap between those two numbers is usually enormous, and it's the most useful thing on the page. |
| **Every card says where its figures came from** | `✓ official page` means someone read it off the company's own site on the date shown. `⚠ reported only` means the company publishes nothing and the number comes from third-party directories. You should treat those two very differently. |

### What checking all 14 startup programmes actually turned up

On 2026-09-19 every startup entry was checked against the company's own page. More than half were wrong on the figures the other directories repeat:

- **AWS Activate** — the Portfolio ceiling is **$200,000**, not the $100,000 everyone quotes, and the self-serve Founders tier goes to **$5,000**, not $1,000.
- **Cloudflare** — the maximum is **$350,000**, not $250,000, and there's a **$10,000 tier explicitly for bootstrapped founders with no partner** that almost nobody lists.
- **Databricks** — relaunched as a joint programme with Neon at **$200,000 combined**, up from the $50,000 still listed elsewhere. The URL moved too.
- **DigitalOcean** — publishes **no award amounts at all**, so the $100,000 figure in circulation is unsourced.
- **Anthropic** — its own page contradicts itself, listing institutional equity funding as a requirement and then saying the programme is open with or without VC backing.
- **Google, Microsoft, IBM, Oracle, Together, Mistral** — publish no verifiable tier amounts on any public page. Six of fourteen.

Only **three** programmes publish a self-serve tier you can get with no investor: Cloudflare ($10,000), AWS ($5,000) and Neon ($1,000). A bootstrapped founder's realistic total is around **$16,000** — against a headline of **$950,000**.

## The eligibility checker

Six clicks — are you a maintainer or a founder, how big is your project, how old is your company, who backs you. It then filters 60+ programmes down to the ones whose published criteria you actually meet, and gives you two totals.

It runs entirely in your browser. Nothing is sent anywhere, there's no email gate, and there's no account.

## Adding or fixing a programme

The whole dataset is [`data/programs.json`](data/programs.json). One entry, one pull request.

**Flagging a dead programme is as valuable as adding a live one.** That's the entire point of this list — please open a PR or an issue when you find one.

```jsonc
{
  "id": "company-track",              // unique slug, kebab-case
  "company": "Company Name",
  "name": "Official Programme Name",
  "track": "oss",                     // "oss" | "startup"
  "category": "AI & ML",              // see existing categories
  "value_usd": 5000,                  // headline max in USD, or null if not published
  "entry_usd": 500,                   // OPTIONAL: documented self-serve tier, no referral.
                                      //   Omit unless the company publishes it — we count
                                      //   zero rather than guess.
  "value_label": "Up to $5,000/yr credits",   // what the card shows
  "url": "https://example.com/apply",
  "difficulty": "easy",               // "easy" | "moderate" | "hard"
  "referral_required": false,         // does the top tier need a VC/accelerator intro?
  "recurring": true,                  // renews annually, vs a one-off grant
  "status": "open",                   // "open" | "ended" | "unverified"
  "requirements": ["Public repo", "OSI-approved licence"],
  "notes": "Anything a applicant would want to know before spending an hour on this.",
  "last_checked": "2026-09-19"        // YYYY-MM-DD, the day you verified it on the official page
}
```

### House rules for data

- **Verify on the official page**, not on another directory. Second-hand figures are how lists rot.
- **Set `last_checked` to the day you actually looked.** Don't copy the date from a neighbouring entry.
- **`entry_usd` is for documented tiers only.** If a company says "$1,000 self-serve, up to $100,000 with a VC", set `value_usd: 100000` and `entry_usd: 1000`. If they only publish the maximum, leave `entry_usd` out entirely. Guessing here defeats the purpose.
- **`status: "unverified"`** is fine and honest for a programme you know exists but whose terms aren't public. It shows an amber badge.

If you add an eligibility rule for a new programme, it goes in the `RULES` map in `index.html` — a single function taking the checker's answers and returning a boolean. No rule means "anyone on that track plausibly qualifies", which is the right default for the many perks that just need a public repo.

## Running it locally

There's no build step and no dependencies. It's one HTML file and one JSON file.

Because the page fetches the JSON, you need a server rather than opening the file directly:

```bash
npx serve
```

or, with Python:

```bash
python -m http.server 8000
```

## Deploying

Any static host works. Point it at the repo root; there is nothing to build.

- **Vercel / Netlify / Cloudflare Pages** — import the repo, leave the build command empty, set the output directory to `/`.
- **GitHub Pages** — Settings → Pages → deploy from `main`, root.

## Licence

MIT for the code. The data in `data/programs.json` is public information compiled from the companies' own pages, free to reuse.

Not affiliated with, endorsed by, or sponsored by any listed company. **Always verify terms on the official page before applying** — programmes change without notice, and that's exactly why this list has dates on it.
