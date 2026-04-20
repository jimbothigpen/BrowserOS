# Clarifying Questions — Referral Weekly Bonus

Self-answered per `/sup-loop-design`. Confidence: `[grounded]` = read from code, `[default]` = sensible default, `[assumption]` = guess that materially affects the design and should be confirmed.

---

## Batch 1 — Scope and ledger model

**Q1. Where does the current 24h expiration enforcement live — inside the AI gateway (`llm.browseros.com`), inside the referral service (`browseros-referral.fly.dev`), or both?**

**Answer:** [assumption] The gateway. The frontend has no expiration logic — `useCredits.ts:14-23` simply reads `{credits, dailyLimit, lastResetAt, browserosId}` from `${CREDITS_GATEWAY}/credits/{browserosId}`, and `lastResetAt` strongly implies the gateway owns a daily reset. The referral service only validates tweets and asks the gateway to grant the bonus (per memory S128, S129 — referral service POSTs a credit grant to the gateway behind a shared secret). Today, the granted bonus appears to land in the same balance bucket that gets wiped at midnight UTC, which is why "24h validity" is the current behavior.

**Q2. Are base credits and bonus credits stored as one number, or already separated?**

**Answer:** [grounded for frontend, assumption for backend] One number from the frontend's perspective: `CreditsInfo.credits` is a single integer (`useCredits.ts:5-10`, `gateway.ts:20-24`). The current "24h bonus" behavior is consistent with the gateway holding a single balance: at midnight UTC it resets to `dailyLimit`, blowing away any unused bonus along with any unused base. So the gateway needs to learn the distinction between base and bonus going forward. The single-integer API contract on the read side can stay — we just compute `credits = baseRemaining + Σ unexpired bonuses` server-side.

**Q3. Is the goal "make the same pool last 7 days" or "keep base credits resetting daily but only let bonus credits live 7 days"?**

**Answer:** [default] The latter. The user explicitly framed the request as "bonus credits to have 1 week validity instead of 1 day" — base credits resetting daily at the gateway-configured cap (currently 50 per the in-progress server change) is the existing free-tier model and there's no signal to change it. So we keep the daily reset for base, and add a 7-day rolling TTL only for credits granted by the referral service.

---

## Batch 2 — Deduction order, cap, and edge cases

**Q4. When a request is billed, do we burn base credits first or bonus first?**

**Answer:** [default] Bonus first. Two reasons: (a) bonus credits have a TTL, so consuming them first reduces wasted/expired bonus; (b) the user has earned them through a real action (tweet) — burning the perishable thing before the renewable thing is the standard "use FIFO on perishables" pattern from loyalty/promo systems (airline miles, Stripe credit grants, Shopify gift cards). Base credits are renewable at midnight UTC anyway, so deferring them costs nothing.

**Q5. Should the per-grant TTL stack (each tweet gets its own 7-day clock) or share a single rolling window (most recent grant resets the clock for the whole bonus pool)?**

**Answer:** [default] Per-grant TTL. Each `referralGrant` row has its own `expiresAt = grantedAt + 7d`. Why: (a) it is the most user-honest model — the credit you earned today is good for 7 days, period; (b) it makes a "shared rolling window" feel exploitative when the user submits one tweet on day 6 to "save" 12 unused credits from day 1; (c) the implementation is identical complexity (we already track each grant in the webhook log shown by the user). Cost: SUM-and-filter query on read instead of single column, but credit-balance reads are cheap and not hot.

**Q6. Is there a maximum unexpired bonus we want to allow per user? Today the prior `MAX_DAILY_CREDITS = 500` constant is in `packages/shared/src/constants/limits.ts:84-87`.**

**Answer:** [grounded for current cap, default for proposal] Yes — keep a cap. From the webhook log the user pasted, `Knindo_Official` and `ChinKimYoon` each hit balances of 621 and 650 by burst-submitting 3 tweets within ~1 minute, indicating the existing `MAX_DAILY_CREDITS = 500` cap is being exceeded (or isn't enforced server-side, or applies only to base). Without a cap on unexpired bonus, a 7-day window lets a single user accumulate 7×N×200 credits trivially. Recommendation: cap unexpired bonus at **1000 credits per user** (5 tweets worth). Anything beyond that is rejected with a friendly "you already have plenty of bonus credits — come back when they're closer to expiring" message. This keeps the feature feeling generous without becoming free unlimited LLM.

---

## Batch 3 — Migration, expiration UX, and observability

**Q7. What happens to the in-flight 24h bonuses already in users' balances when the change ships?**

**Answer:** [default] Treat them as a one-time grandfathered grant with the new 7-day TTL starting from deploy time. Concretely: at deploy, the gateway runs a migration that for every user with `credits > dailyLimit`, the excess (`credits - dailyLimit`) is recorded as a `referralGrant` with `expiresAt = now + 7d`. This is the most user-friendly path (nobody loses credits) and the simplest (no per-user grant history to backfill). The alternative — wiping current bonus and starting fresh — would generate support pain on day 1.

**Q8. Where should the expiration date be surfaced in the UI?**

**Answer:** [default] On the Usage & Billing page only. `apps/agent/entrypoints/app/usage/UsagePage.tsx` already shows a "Bonus credits" stat (added in PR #731). Expand it to show "+X bonus credits · Y expire in Z days" where Y is the next-expiring grant amount and Z is days until that grant expires. Don't surface in the side-panel badge (too noisy) or in `ChatError.tsx` (focus there is on getting more credits, not managing existing ones). Reading the next-expiring grant requires the gateway response to include a small `bonusGrants: [{amount, expiresAt}]` array — keep it bounded to ≤10 entries to cap payload.

**Q9. Do we need new analytics/observability beyond the existing webhook log?**

**Answer:** [default] Add three counters: (a) `referral.bonus.granted` (already implicit in webhook), (b) `referral.bonus.expired_unused` — fires when a grant TTL elapses with `consumed < amount`, (c) `referral.bonus.consumed` — fires per debit. The expiration counter is the key new signal: if it stays high after the move from 1d → 7d, users still aren't using their bonus and 7d isn't long enough; if it drops to ~0, 7d is correctly sized. This is the metric that tells us whether to revisit the TTL later.

---

## Assumptions to surface in the spec

The following answers were `[assumption]` and materially affect the design. They should be called out at the top of the spec so the user can correct if wrong:

1. **Q1**: The 24h expiration enforcement lives in the AI gateway (`llm.browseros.com`), not in the referral service. The referral service grants; the gateway debits and resets. If this is wrong (e.g., expiration is a TTL on a referral-service row), the entire ledger surface moves and the design needs to be rewritten against the referral-service repo.
2. **Q2**: Today's gateway stores credits as a single integer (no base/bonus separation). If a separation already exists, the migration in Q7 is unnecessary and we just change the bonus TTL constant.
