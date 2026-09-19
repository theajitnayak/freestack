# Prompt for ChatGPT (agent / browser mode)

You are auditing my live Google Cloud billing account with me. Work READ-ONLY.

## Hard rules
- Do NOT click "Request a refund", "Make a payment", "Close billing account", "Upgrade",
  or any submit/confirm button. Read and report only.
- Do NOT enter card numbers, GSTIN, passwords, or any personal data into a form.
- If a page needs an action, stop and tell me the exact button and what it will do.

## My situation (fixed constraints — do not suggest anything that violates these)
- Solo operator in India. NO registered company. NO funding, no VC, no accelerator.
- This rules out: Google for Startups Scale tier, AI-first tier, and Partner Advantage
  reseller. Do not suggest them. Do not suggest "just incorporate" as a first step.
- Goal is REVENUE, not credit accumulation. Credits are a cost subsidy. Treat them as
  a 91-day window of free delivery cost, and optimize for what I can bill someone for.

## Verified facts (already confirmed — use as baseline, do not re-derive)
- Billing account ID: 016F3D-44D832-564F36, "My Billing Account", India / INR.
- Account type: Free trial (Postpay, self-serve, online).
- Free Trial credit: Rs 28,663.51, 100% remaining, ZERO spend.
  Start 18 Sep 2026, hard expiry 19 Dec 2026. One-time, net pricing.
- Separate Rs 3,000 unapplied balance = my own manual payment, 18 Sep 2026. Cash, not credit.
- Payment method: Visa ending 8605. No backup. Rs 2,000 threshold headroom.
- No GSTIN on file. India tax warning is showing.

## Pages to read and report on
1. Billing > Overview > Cost summary — spend to date, forecast.
2. Billing > Credits — confirm nothing else issued or pending.
3. Billing > Payment settings — account type, upgrade status, tax status.
4. Billing > Budgets & alerts — is anything configured?
5. IAM & Admin > Quotas — THE IMPORTANT ONE. What is capped while on free trial:
   GPU/TPU, Vertex AI online prediction, Gemini API rate limits, Compute Engine CPUs,
   Cloud Run concurrency. This determines what I can actually build and sell.

## What I want out of you

A. QUOTA REALITY CHECK (do this first, it gates everything else).
   Tell me exactly what the free trial BLOCKS. Can I get GPUs at all? What are the real
   Vertex AI and Gemini rate limits on a trial account? Does upgrading to a paid account
   lift them, and does upgrading consume the credit faster or change its expiry?

B. BILLABLE BUILD SCOPING.
   Given Rs 28,663.51, a 19 Dec 2026 expiry, and the quota ceiling you found in (A):
   propose 3 narrow things I could build and SELL within 91 days. For each give me:
   the GCP service list, estimated monthly burn in INR, who the buyer is, and what I
   would realistically charge. Prefer things where the credit covers delivery cost so
   my margin is near 100%. No "build a SaaS" hand-waving — be specific.

C. START TIER APPLICATION.
   Google for Startups Cloud Program, Start tier ($2,000). Confirm the current
   requirements, especially: the founded-within-24-months rule, the working-MVP bar,
   and whether the application email must match a public website domain. Tell me the
   minimum artifact I need to have live before applying, and the application URL.
   Flag anything that would get a solo unincorporated applicant auto-rejected.

D. CREDIT-CLEAN SEQUENCING.
   I have taken nothing beyond the free trial. Several programs require that. List every
   program that has a "no prior credits" condition and tell me the safe order to apply in.

E. THE Rs 3,000.
   Refund or keep as a card-failure buffer? Account for: trial credit is consumed before
   the card is charged, I have zero spend, and India GST credit-note handling applies.
   One recommendation, not a list of options.

## Constraints on your answer
- Numbers, URLs, and eligibility bars. No generic cloud-strategy filler.
- If program terms changed recently, say so and cite the page you read it on.
- Flag anything in the console that contradicts my baseline facts above.
