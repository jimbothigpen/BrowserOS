# Referral Weekly Bonus — Design

**Status:** Draft, autonomous design via `/sup-loop-design`
**Author:** Claude (self-answered; assumptions flagged)
**Date:** 2026-04-20

## Summary

Extend referral bonus credit validity from **1 day → 7 days** by introducing a per-grant expiration ledger in the AI gateway. Each bonus granted by the referral service gets its own 7-day clock. On each billed request the gateway debits the **soonest-to-expire unexpired bonus** first, then falls back to daily base credits. Frontend surfaces the next-expiring grant in the Usage & Billing page.

## Assumptions (please correct if wrong)

1. The 24h expiration enforcement lives in the **AI gateway** (`llm.browseros.com`), not the referral service. The referral service validates the tweet and POSTs a grant to the gateway. If expiration actually lives in the referral service, this design is in the wrong repo.
2. The gateway currently stores credits as a **single integer** per user. If a base/bonus separation already exists, the migration in §6 is unnecessary.
3. The referral service is the **only** source of bonus credits today. If other flows also grant bonus (e.g., promo codes), they need to be migrated to the same `referral_grants` table (or renamed `bonus_grants`).

## Goals

1. A bonus granted today is spendable for 7 full days.
2. Unused base credits continue to reset daily at midnight UTC (unchanged).
3. Users can see how much bonus they have and when it expires.
4. Burst-submit abuse (3 tweets in 60 seconds) stops increasing unbounded balance.
5. Expiration is observable — we can tell whether 7 days is the right number.

## Non-Goals

- Changing the referral service's tweet-validation logic (tweet must mention `@browserOS_ai`, ≤30 min old, single-use — already shipped).
- Changing daily base credit amount (separate config).
- Purchased / paid credits (different ledger; future work).
- Per-user cap reconfiguration UI (constants stay in code for now).

## Architecture

### Current

```
Extension ─▶ POST /referral/submit (tweet URL)
                │
                ▼
        browseros-referral.fly.dev
                │ validate tweet (browser-use)
                │ shared secret
                ▼
        llm.browseros.com
                │ credits += 200
                ▼
             single `credits` integer
                │
          daily reset at midnight UTC → credits = dailyLimit
```

Bonus dies at the next midnight UTC, producing the observed burst-submit behavior.

### Proposed

```
Extension ─▶ POST /referral/submit (tweet URL)
                │
                ▼
        browseros-referral.fly.dev
                │ validate tweet, rate-limit, enforce per-user unexpired-bonus cap
                │ shared secret
                ▼
        llm.browseros.com
                │ INSERT INTO referral_grants (user_id, granted_at, expires_at=now+7d, amount=200, consumed=0)
                ▼
        Tables:
          - users (base_credits, daily_limit, last_reset_at)
          - referral_grants (user_id, granted_at, expires_at, amount, consumed)

        On billed request:
          1. debit oldest unexpired grant with remaining amount
          2. if still owing, debit next grant
          3. if still owing, decrement base_credits
          4. reject if total insufficient → CREDITS_EXHAUSTED

        Daily cron at 00:00 UTC:
          - reset base_credits = daily_limit (unchanged)
          - grants table untouched (expiration is read-side filter)
```

## Components

### Gateway — ledger & debit (primary change)

**New table:** `referral_grants`

| column | type | notes |
|---|---|---|
| id | uuid | PK |
| user_id | text | browserosId |
| granted_at | timestamptz | server clock at grant |
| expires_at | timestamptz | `granted_at + INTERVAL '7 days'` |
| amount | int | always 200 today |
| consumed | int | debited in place; `consumed ≤ amount` |
| tweet_url | text | audit — same as in the webhook log |

Indexes: `(user_id, expires_at)` for read-time balance sum, `(user_id, expires_at, consumed)` for debit-selection.

**Read path** (`GET /credits/:userId`):

```sql
SELECT amount - consumed AS remaining, expires_at
FROM referral_grants
WHERE user_id = $1 AND expires_at > now() AND consumed < amount
ORDER BY expires_at ASC
LIMIT 10;
```

Response shape:

```ts
{
  credits: baseRemaining + Σ remaining,  // backward-compat
  dailyLimit: number,
  lastResetAt: ISO8601,
  browserosId: string,
  // NEW — optional, ≤10 entries
  bonusGrants?: Array<{ amount: number; expiresAt: string }>
}
```

**Debit path** (middleware that runs before every billed LLM call):

Pseudocode (single transaction, `SELECT ... FOR UPDATE` on the user row):

```
amountOwed = costOfCall
// 1. pay from bonuses, soonest expiry first
for grant in SELECT * FROM referral_grants
             WHERE user_id = $1 AND expires_at > now() AND consumed < amount
             ORDER BY expires_at ASC
             FOR UPDATE:
  take = min(amountOwed, grant.amount - grant.consumed)
  UPDATE referral_grants SET consumed = consumed + take WHERE id = grant.id
  amountOwed -= take
  if amountOwed == 0: break
// 2. pay remainder from base
if amountOwed > 0:
  UPDATE users SET base_credits = base_credits - amountOwed
    WHERE user_id = $1 AND base_credits >= amountOwed
  if no rows updated: RETURN 429 CREDITS_EXHAUSTED
```

**Write path** (referral-service → gateway grant endpoint):

```
POST /internal/grants  (shared secret, unchanged)
Body: { userId, amount, tweetUrl }
```

Before INSERT, enforce per-user unexpired-bonus cap (see §Constants). Reject with `BONUS_CAP_REACHED` if the cap would be exceeded — service returns a friendly message to the extension.

**No cron needed for expiration.** Rows stay forever; the `expires_at > now()` filter on both read and debit paths is authoritative. A separate nightly GC job can TRUNCATE rows where `expires_at < now() - 30d` purely to keep the table small — non-essential.

### Referral service (`browseros-referral.fly.dev`) — small changes

1. Before calling the gateway grant endpoint, first call `GET /internal/bonus-usage/:userId` (new endpoint) to check unexpired bonus total against the cap. Reject with `BONUS_CAP_REACHED` early so we don't grant and then refund.
2. (Optional) Add per-user rate-limit: max 1 accepted tweet per 15 minutes. Pairs with the existing "single-use tweet" rule to stop the burst-submit pattern (Ihsanhamid96899 pattern in the webhook log: 3 tweets in 60 seconds).

### Extension frontend — UI surfacing

**`useCredits.ts` — extend the type** (backward compatible):

```ts
export interface CreditsInfo {
  credits: number
  dailyLimit: number
  lastResetAt?: string
  browserosId?: string
  bonusGrants?: Array<{ amount: number; expiresAt: string }>  // NEW
}
```

**`UsagePage.tsx` — expand the "Bonus credits" stat**

Current (from PR #731):
```
Bonus credits
+194 from referrals
```

Proposed:
```
Bonus credits
+194 from referrals · 50 expire in 2 days
```

The secondary line is computed from the next-expiring `bonusGrant`. When no grants are close to expiring (next one ≥ 6 days out), omit the secondary line to reduce clutter.

**`ShareForCredits.tsx` — no change** other than updating the "earn credits" copy if we want to reflect the new 7-day validity (e.g., footer line "Bonus credits expire in 7 days"). Minor copy, same component.

**`ChatError.tsx` — no change.** Credit-exhausted error already shows the share CTA; expiration detail is not relevant at the "I'm out of credits" moment.

## Data Flow — Walkthroughs

### Grant path (happy)

1. User shares tweet, pastes URL.
2. Extension → `POST browseros-referral.fly.dev/referral/submit {tweetUrl, browserosId}`.
3. Referral service validates (mention, age, not-reused).
4. Referral service checks bonus cap via `GET gateway/internal/bonus-usage/:userId` → `{unexpired: 400}`. Cap is 1000; grant would bring to 600 → OK.
5. Referral service → `POST gateway/internal/grants {userId, amount: 200, tweetUrl}`.
6. Gateway INSERTs `referral_grants` row with `expires_at = now + 7d`.
7. Response bubbles back to extension; `useCredits` is invalidated → next fetch shows `+200` in `bonusGrants` and `credits` total.

### Debit path

1. User asks BrowserOS to summarize a page (1 credit cost).
2. Gateway middleware runs before LLM call.
3. User has base=40, grants=[{amount:200, consumed:180, expires_at=now+2d}, {amount:200, consumed:0, expires_at=now+6d}].
4. Debit 1 credit: take from the first grant (expires soonest) → `consumed=181`.
5. Base untouched (stays 40).
6. LLM call proceeds.

### Expiration path (no action required — all lazy)

1. Grant with `expires_at = now+7d` and `consumed = 150/200` ages out.
2. After `expires_at`, read-side filter `expires_at > now()` excludes it. Balance drops by 50 naturally.
3. Analytics: a nightly job (or the same GC job) emits `referral.bonus.expired_unused` counters for grants where `expires_at < now()` and `consumed < amount`, then marks them (or deletes after 30d).

### Base reset path (unchanged)

Midnight UTC cron sets `base_credits = daily_limit`. Grants table untouched.

## Error Handling

| Case | Handling |
|---|---|
| Tweet already submitted | Existing behavior — `tweet_already_submitted` (unchanged, owned by referral service). |
| Cap reached | Referral service returns `{success: false, reason: "bonus_cap_reached"}`. Extension shows "You already have plenty of bonus credits — share again closer to expiry." |
| Gateway grant endpoint 5xx | Referral service retries 2x with jitter; on final failure returns `{success: false, reason: "grant_failed"}`. Frontend already handles non-`success` result (`submit-referral.ts:22-26`). |
| Race on debit (two concurrent requests) | Transaction with `SELECT ... FOR UPDATE` on user row serializes debits. Tested by fuzzing N concurrent debits on same user and asserting sum(consumed) == N*cost up to remaining total. |
| Clock skew between services | Expirations are read/filtered in SQL using gateway's `now()`. Referral service does not compute expirations; it only grants. |
| Migration fails mid-way | Migration is idempotent — it either finds `credits > dailyLimit` and inserts one grant per user, or skips if a grant was already created for that user in the past 5 minutes (dedup key). |

## Testing

### Gateway tests

- Unit: debit selects the soonest-expiring grant first; crosses grant boundaries correctly; falls through to base; rejects with CREDITS_EXHAUSTED when exhausted.
- Unit: expired grants are not selected for debit even if they have `consumed < amount`.
- Unit: cap rejection — `POST /internal/grants` returns 400 `BONUS_CAP_REACHED` when SUM(unexpired) + amount > 1000.
- Integration: read endpoint returns `credits = base_remaining + Σ unexpired bonus`. Response includes `bonusGrants` sorted by `expires_at ASC`, capped at 10.
- Integration: concurrent debits on same user are serialized (property test: N parallel debits of cost C → sum of effects == N*C).

### Referral service tests

- Unit: pre-grant cap check short-circuits before calling gateway when cap would be exceeded.
- Integration (mocked gateway): grant_failed retries, surfaces reason.

### Frontend tests

- Component: `UsagePage.tsx` renders secondary expiry line only when the next grant expires in <6 days.
- Component: missing `bonusGrants` (old gateway) degrades gracefully — no secondary line, no crash.

### Manual QA

1. Grant a bonus, submit a second, verify both appear in `bonusGrants`.
2. Fast-forward clock (or use a test user with `expires_at = now - 1s`) and verify balance drops.
3. Drain base, verify next request debits bonus; drain bonus, verify next request debits base; drain both, verify CREDITS_EXHAUSTED.

## Migration & Rollout

### Migration

One-shot SQL at deploy:

```sql
-- Snapshot existing surplus as a grandfathered 7-day grant
INSERT INTO referral_grants (id, user_id, granted_at, expires_at, amount, consumed, tweet_url)
SELECT gen_random_uuid(), user_id, now(), now() + INTERVAL '7 days',
       credits - daily_limit, 0, 'grandfathered'
FROM users
WHERE credits > daily_limit;

-- Reset user balances to the base (gateway-side)
UPDATE users SET base_credits = LEAST(credits, daily_limit);
ALTER TABLE users DROP COLUMN credits;  -- if replaced by base_credits
```

If the gateway already has `base_credits` separate from `credits`, drop that last line. If not, rename or recompute — owner of the gateway repo will know.

### Rollout

1. Ship gateway schema + debit logic behind a feature flag `bonus_ledger_enabled` (default off). Old path continues to reset balance daily.
2. Run migration with flag still off. Verify grant rows look right.
3. Flip flag on in canary (e.g., 5% of requests). Watch `referral.bonus.consumed` vs `referral.bonus.expired_unused` counters.
4. Ship referral-service pre-grant cap check.
5. Ship extension UI update.
6. Remove flag after one full expiration cycle (≥7 days stable).

### Rollback

Flip flag off. Debit falls back to old single-integer path. `referral_grants` rows are harmless — they're simply ignored until the flag is re-enabled.

## Constants

Centralize in `packages/shared/src/constants/limits.ts` next to `REFERRAL_LIMITS`:

```ts
export const REFERRAL_LIMITS = {
  CREDITS_PER_REFERRAL: 200,
  BONUS_TTL_DAYS: 7,
  MAX_UNEXPIRED_BONUS_PER_USER: 1000,
  MIN_SECONDS_BETWEEN_SUBMISSIONS: 900,  // 15 min
} as const
```

`MAX_DAILY_CREDITS: 500` is currently consumed in `apps/agent/components/referral/ShareForCredits.tsx` (gates the "Share on Twitter" button and shows a "Daily cap of {X} credits — resets at..." copy line). Under the new model this cap is actually the **unexpired-bonus cap**, not a daily-reset cap. Rename to `MAX_UNEXPIRED_BONUS_PER_USER`, adjust the copy ("You've reached the bonus limit — share again once some credits expire"), and keep the gating logic identical. Same value (1000 per §Q6) — the number is separate from the old 500 because the new model allows accumulation over 7 days.

Gateway reads the same constants if we publish `@browseros/shared` there; otherwise mirror them behind the same names in the gateway repo.

## Observability

New metrics (StatsD / Prometheus / whatever the gateway uses today):

- `referral.bonus.granted` (labels: `user_id_hash`) — counter
- `referral.bonus.consumed{path="bonus"|"base"}` — counter on every debit
- `referral.bonus.expired_unused{amount_bucket}` — counter when a grant passes `expires_at` with `consumed < amount`
- `referral.bonus.cap_rejected` — counter when cap blocks a grant
- `gauge referral.bonus.unexpired_pool_total` — sum across all active grants, sampled every 5 min

The key signal: ratio of `expired_unused` to `granted`. If ≥30% after 2 weeks, 7 days may be too short (or users don't need the bonus). If ≤5%, 7 days is about right.

## Open Questions / Follow-ups

1. **Do we want a per-day submission cap per user?** The webhook log shows `Knindo_Official` submitting 6 tweets across 3 days — that's fine. But the 15-min cooldown won't stop someone from submitting 96 tweets in 24 hours. Could add `MAX_GRANTS_PER_DAY = 3` if the cap alone isn't enough.
2. **Notification when bonus is close to expiring?** E.g., a one-time banner when bonus is within 24h of expiring and > 50. Probably v2.
3. **Per-grant partial-expiry UI?** The current design shows only the next-expiring. If users have >1 grant, a "View all" affordance listing every grant could help power users. Also v2.

---
