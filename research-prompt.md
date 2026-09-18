# Research prompt — paste into ChatGPT (or Gemini / Perplexity)

Run it **one country at a time**. Replace `INDIA` with the country you want.
Depth per country beats a shallow sweep of twenty.

Suggested order, by number of new founders: **India → United States → United Kingdom → UAE → Singapore → Nigeria → Brazil → Indonesia → Germany → Canada.**

---

```
You are a research assistant helping build a public, free directory of funding and
credit programmes for startup founders. Accuracy matters far more than volume — a
wrong number costs a founder a wasted day, and one wrong entry destroys the
credibility of the whole list.

COUNTRY: INDIA

Find every programme a founder based in this country can apply to, across all five
categories below. For each one, give me ONLY what you can confirm on the
organisation's own official website. Never take a figure from a blog post, a
listicle, a "top 10 startup credits" article, or another directory.

CATEGORY 1 — Cloud and AI credits available specifically in this country
  Include country-specific variants of global programmes (for example, whether AWS
  Activate, Google for Startups or Microsoft Founders Hub run a separate local
  track, a local partner, or different amounts here).

CATEGORY 2 — Government and public schemes
  Grants, subsidies, tax credits, soft loans, incubation schemes. In India this
  would include things like Startup India, MeitY schemes, state-level programmes.
  These are usually CASH, not credits, and founders almost never know about them.
  This is the category I care most about.

CATEGORY 3 — Accelerators and incubators based in or actively funding this country
  For each, tell me specifically: does joining it give the founder access to a
  partner cloud credit tier (an AWS Activate Provider Org ID, a Google Cloud
  partner referral, a Microsoft partner code, or similar)? This is the single most
  useful fact you can give me, because those partner tiers are where the $100,000+
  amounts actually live. If you cannot confirm it, say so explicitly.

CATEGORY 4 — Local banks, telcos and corporates running founder programmes
  Anything offering credits, cash, office space or free services to early companies.

CATEGORY 5 — Eligibility traps specific to this country
  Things that disqualify a founder here without warning. Examples of what I mean:
  programmes that require a US or Delaware entity; programmes unavailable due to
  sanctions or payment restrictions; ones needing a local business bank account, a
  registered local address, or a specific company type; ones where the local
  currency or card is rejected at signup.

OUTPUT FORMAT
Return a JSON array. One object per programme, exactly these fields:

[
  {
    "company": "Organisation name",
    "name": "Official programme name",
    "country": "IN",
    "category": "cloud | government | accelerator | corporate",
    "value_usd": 50000,
    "value_label": "Up to $50,000 in credits",
    "url": "https://the-official-page-you-actually-read",
    "requirements": ["one short line per requirement"],
    "referral_required": true,
    "unlocks_partner_tier": "AWS Activate Provider Org ID",
    "confidence": "official",
    "notes": "Anything a founder would want to know before spending an hour applying",
    "source_quote": "A short quote from the official page proving the amount"
  }
]

RULES, IN ORDER OF IMPORTANCE

1. If the official page does not publish an amount, set "value_usd" to null and
   "confidence" to "unpublished". Do NOT substitute a number you found elsewhere.
   I would much rather have an honest null than a confident guess.
2. "confidence" must be exactly one of: "official" (you read it on their own site),
   "reported" (only third parties state it), "unpublished" (no figure exists
   publicly).
3. "source_quote" is required whenever confidence is "official".
4. If a programme has ended, still include it, with "notes" explaining that it
   closed and roughly when. Dead programmes that other lists still show are
   genuinely valuable to flag.
5. If you are unsure whether something is still running, mark it "reported" and say
   so in the notes. Never resolve uncertainty by picking the more impressive answer.
6. Prefer 15 entries you have actually verified over 60 you have assembled from
   memory.

Finish with a short plain-text list titled UNVERIFIED, naming any programme you
have heard of for this country but could not confirm from an official source, so I
can check those by hand.
```

---

## What to do with the output

Paste the JSON back into the session. It maps almost directly onto
`data/programs.json` — the only new fields are `country`, `unlocks_partner_tier`
and `source_quote`, and those are all additions we want anyway.

`unlocks_partner_tier` is the important one. Right now the site tells a founder
"this tier needs a referral" and stops there, which is a dead end. Knowing *which
accelerators hand out those partner codes* turns it into a route they can actually
take.
