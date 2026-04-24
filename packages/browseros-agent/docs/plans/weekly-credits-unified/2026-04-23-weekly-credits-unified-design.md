# Unified Weekly Credit Expiry — Design

**Status:** Draft, autonomous design via `/sup-loop-design`
**Date:** 2026-04-23
**Supersedes:** `docs/plans/referral-weekly-bonus/2026-04-20-referral-weekly-bonus-design.md` (yesterday's per-grant TTL ledger — over-engineered for the simpler weekly-everything model)

## Summary

Move BrowserOS credits from a daily reset cadence to a weekly reset cadence. Both base credits (50, unchanged) and bonus credits earned via Twitter referrals will reset together on a per-user weekly window. Implemented as a single `RESET_INTERVAL` env-var flip in the gateway, plus copy and field-name updates in the extension. Yesterday's per-grant-TTL ledger design is superseded — a single unified weekly bucket is what the user actually asked for and what the gateway already supports.

## Assumptions (please correct if wrong)

1. The `DEFAULT_CREDITS = 50` value stays at 50 even though it's now weekly (user confirmed: "the 50 credits I give in the initially can be changed to 50 and move to weekly credits").
2. No separate paid-credits flow exists today; if it does, it should be designed to live alongside the weekly bucket separately (out of scope).
3. The extension's `dailyLimit` field consumers can absorb a soft-rename to `creditLimit` over one release cycle.

## Goals

1. All credits — base and bonus — reset on a weekly cadence per user.
2. Zero data migration required; existing balances roll into the new cadence naturally.
3. Extension copy reflects "weekly" everywhere a user sees credit reset language.
4. Backward compatible: older extension installs continue to function on the new gateway.

## Non-Goals

- Changing the credit cost per request (stays `1`).
- Building a per-grant TTL ledger (yesterday's design — explicitly superseded).
- Building a credit purchase / top-up flow (separate workstream).
- Adjusting the bonus amount per tweet (stays `200`).
- Reset-day customization per user.

## Repos Touched

| Repo | Path | Change Scale |
|---|---|---|
| `browseros-ai-gateway` | `wrangler.toml`, `src/durable-objects/CreditTracker.ts`, `src/middleware/creditMiddleware.ts` | Small — env-var flip + response field rename + analytics property |
| `browseros-workers` | `apps/referral-service/*` | **None** — bonus grant API is interval-agnostic |
| `browseros-agent` (extension) | `apps/agent/lib/credits/useCredits.ts`, `apps/agent/entrypoints/app/usage/UsagePage.tsx`, `apps/agent/entrypoints/sidepanel/index/ChatError.tsx`, `apps/agent/components/referral/ShareForCredits.tsx`, `packages/shared/src/constants/limits.ts`, `apps/server/src/lib/clients/gateway.ts` | Small — copy + field-name dual-read |

## Architecture

### Current

```
Extension ──GET /credits/:id──▶ Gateway (Cloudflare Worker)
                                       │
                                       ▼
                              CreditTracker DO (per-user SQLite row)
                                       │
                                       │ RESET_INTERVAL = "daily"
                                       │ defaultCredits = 50
                                       ▼
                              { credits, dailyLimit: 50, lastResetAt }

Referral service ──POST /credits/:id/bonus──▶ Gateway
                                                  │
                                                  ▼
                                       addCredits(200) — tops up balance
                                                  │
                                                  │ at next 00:00 UTC the entire balance
                                                  │ resets to 50, wiping unused base + bonus
                                                  ▼
                                       (this is the 24h "use it or lose it" cliff)
```

### Proposed

```
Extension ──GET /credits/:id──▶ Gateway
                                       │
                                       ▼
                              CreditTracker DO
                                       │
                                       │ RESET_INTERVAL = "weekly"   ◀── flipped
                                       │ defaultCredits = 50         ◀── unchanged
                                       ▼
                              { credits, creditLimit: 50, dailyLimit: 50, resetInterval: "weekly", lastResetAt }
                                                                ▲
                                                                │
                                              creditLimit is the new canonical name;
                                              dailyLimit kept as alias for one release.

Referral service ──POST /credits/:id/bonus──▶ Gateway   (UNCHANGED)
                                                  │
                                                  ▼
                                       addCredits(200) — tops up balance
                                                  │
                                                  │ at lastResetAt + 7d the balance
                                                  │ resets to 50.
                                                  ▼
                                       (weekly cliff — 7x more forgiving than today)
```

The DO's reset logic (`CreditTracker.ts:103-128`) already implements the weekly branch (`diffDays >= 7`). No DO code change required for the reset itself — only response shape and an analytics emission.

## Components

### Gateway — `browseros-ai-gateway`

#### Change 1: env-var flip (`wrangler.toml:58`)

```diff
- RESET_INTERVAL = "daily"
+ RESET_INTERVAL = "weekly"
```

That's the entire functional change for the reset cadence.

#### Change 2: response shape (`src/durable-objects/CreditTracker.ts`)

Update the `GetCreditsResult` interface and the `getCredits()` return:

```ts
// Before
export interface GetCreditsResult {
  credits: number;
  dailyLimit: number;
  lastResetAt: string;
}

// After
export interface GetCreditsResult {
  credits: number;
  creditLimit: number;       // NEW canonical
  dailyLimit: number;        // Alias of creditLimit for one release; remove in v2
  resetInterval: "daily" | "weekly" | "biweekly";  // NEW
  lastResetAt: string;
}
```

`getCredits()` populates `creditLimit` and `dailyLimit` with the same `defaultCredits` value, plus the active `resetInterval` from env.

#### Change 3: error label (`src/middleware/creditMiddleware.ts:38-45`)

Currently:
```ts
const resetLabel = resetInterval === "daily" ? "midnight UTC" : `next ${resetInterval} reset`;
```

Update to a more user-friendly weekly label. The reset is per-user (7d from each user's `lastResetAt`), so wording must avoid implying a global weekday:
```ts
const resetLabel =
  resetInterval === "daily"  ? "midnight UTC" :
  resetInterval === "weekly" ? "your next weekly reset" :
  `next ${resetInterval} reset`;
```

If we want a precise time, include it from the DO state in the error body — the middleware can compute `lastResetAt + 7d` once it has access to the per-user state. Defer until users ask for precision; "your next weekly reset" combined with the existing `Retry-After` seconds header is enough for v1.

`getSecondsUntilReset` already supports weekly (`creditMiddleware.ts:82-83`), no change there.

#### Change 4: analytics property (`src/middleware/creditMiddleware.ts`, `src/handlers/credits/bonus.ts`)

Add `reset_interval` to all PostHog events emitted from credit code so dashboards can filter pre/post-flip:

```ts
captureEvent(c.executionCtx, c.env, {
  event: "credits.deducted",
  distinctId: browserOsId,
  properties: { credits_remaining: result.credits, reset_interval: c.env.RESET_INTERVAL },
});
```

Same for `credits.exhausted`, `credits.bonus_added`.

#### Change 5: emit `credits.reset` (`CreditTracker.ts`)

Inside the `if (this.shouldReset(...))` branch in `ensureReset()`, fire-and-forget POST to the PostHog ingestion endpoint with `event: "credits.reset"` and properties `{interval, previous_balance, new_balance}`. This lets us see in real time that the new cadence is firing as expected. Use `ctx.waitUntil` so it doesn't block the request.

### Workers / Referral Service — `browseros-workers/apps/referral-service`

**No changes required.** The bonus grant call is interval-agnostic. Confirmed by reading `lib/gateway-client.ts:8-28` and `routes/referral.ts:77-99`.

The referral service might want to update Slack-notifier copy ("Bonus granted (resets weekly)") but that's optional polish.

### Extension — `browseros-agent`

#### Change A: dual-read the new field (`apps/agent/lib/credits/useCredits.ts`)

```ts
export interface CreditsInfo {
  credits: number
  creditLimit?: number       // NEW — preferred
  dailyLimit?: number        // legacy fallback
  resetInterval?: 'daily' | 'weekly' | 'biweekly'  // NEW
  lastResetAt?: string
  browserosId?: string
}
```

Mirror the same dual-read in `apps/server/src/lib/clients/gateway.ts:20-24`.

#### Change B: usage page copy (`apps/agent/entrypoints/app/usage/UsagePage.tsx`)

| Line | Before | After |
|---|---|---|
| `47` | `const total = data?.dailyLimit ?? 50` | `const total = data?.creditLimit ?? data?.dailyLimit ?? 50` |
| `66` | `Daily Credits` | `Weekly Credits` |
| `92-93` | `Resets daily / Midnight UTC` | `Resets weekly / 7 days after last reset` — personal weekly clock, not a global Monday cron (see Open Questions §1). Render the actual next-reset date if the gateway exposes `lastResetAt + 7d`. |
| `99` | `Credits used today` | `Credits used this week` |
| `101` | `{creditsUsed} of {total}` | unchanged (numbers are weekly naturally) |

#### Change C: chat error copy (`apps/agent/entrypoints/sidepanel/index/ChatError.tsx`)

| Line | Before | After |
|---|---|---|
| `54` | `Daily credits exhausted. Credits reset at midnight UTC.` | Use the gateway's error message verbatim — it already contains the new reset label from Gateway Change 3. The local hardcoded string in `parseErrorMessage` should be removed in favor of trusting the gateway's `error.message`. |
| `64` | `message.includes('BrowserOS LLM daily limit reached')` | Add `message.includes('Weekly limit reached')` as a parallel match in case any old code paths emit that wording. Keep the daily check during the deprecation window. |
| `99` | `experimentId=daily_limit_${...}` | Keep — analytics-stable identifier. Don't rename. |
| `104` | `Daily limit reached` | `Weekly limit reached` |

#### Change D: share-for-credits copy (`apps/agent/components/referral/ShareForCredits.tsx`)

| Line | Before | After |
|---|---|---|
| `66` | `You've reached the daily cap of {REFERRAL_LIMITS.MAX_DAILY_CREDITS}` | `You've reached the bonus cap of {REFERRAL_LIMITS.MAX_BONUS_BALANCE}` |
| `87` | `Daily cap of {X} credits — resets at midnight UTC` | `Cap of {X} credits — resets weekly` |
| `29` | `credits >= REFERRAL_LIMITS.MAX_DAILY_CREDITS` | `credits >= REFERRAL_LIMITS.MAX_BONUS_BALANCE` (renamed constant) |

#### Change E: shared constants (`packages/shared/src/constants/limits.ts:84-87`)

Rename `MAX_DAILY_CREDITS` → `MAX_BONUS_BALANCE` (semantic — it's a balance cap, not a daily-window cap). Keep value `500` for now.

```ts
export const REFERRAL_LIMITS = {
  MAX_BONUS_BALANCE: 500,
  CREDITS_PER_REFERRAL: 200,
} as const
```

Provide a one-release deprecation alias if other code consumes the old name (grep showed only `ShareForCredits.tsx` consumes it, so a clean rename is fine).

## Data Flow

### Read path (extension fetches credits)

1. Extension calls `GET https://llm.browseros.com/credits/{browserosId}`.
2. Gateway DO `getCredits()` → returns `{credits, creditLimit, dailyLimit, resetInterval, lastResetAt}`.
3. Extension prefers `creditLimit`, falls back to `dailyLimit` for backward compat.
4. UI renders "Weekly Credits" using `creditLimit` (currently 50) as the denominator.

### Bonus grant path

1. User pastes tweet URL → extension POSTs to `browseros-referral.fly.dev/referral/submit`.
2. Referral service validates tweet (mention + age + dedup), calls gateway `/credits/:id/bonus` with amount=200.
3. Gateway DO `addCredits(200)` → balance goes from N to N+200.
4. Bonus is now part of the weekly bucket — it lives until next weekly reset (next `lastResetAt + 7d`).

### Reset path

1. Any DO method calls `ensureReset()`.
2. `shouldReset` returns true when `now - lastResetAt >= 7d` (weekly mode).
3. Balance resets to `defaultCredits = 50`. Whatever was in there (base + accrued bonus) is wiped.
4. New `credits.reset` analytics event fires.

### Error path (credits exhausted)

1. Gateway middleware deducts 1 credit. If balance < 1, returns 429 with `error.message = "Credits exhausted. Credits reset at the start of next week (UTC)."`.
2. Extension `ChatError.tsx` matches `CREDITS_EXHAUSTED` code and displays the gateway-provided message. The Twitter share CTA stays embedded in the error.

## Migration & Rollout

### Step 1 — Gateway response shape (deploy first)

Ship the gateway response with both `creditLimit` and `dailyLimit` populated, `resetInterval: "daily"` still. Old extension installs see no change. New extension code can start reading `creditLimit` safely.

### Step 2 — Extension dual-read (deploy second)

Ship extension changes A-E with the gateway still on `daily`. UI still says "Daily" because `resetInterval` from gateway is `daily`. No user-visible change yet.

### Step 3 — Flip the env var (cutover)

Change `RESET_INTERVAL = "weekly"` in `wrangler.toml`, run `wrangler deploy`. Within 60 seconds:
- Gateway response now reports `resetInterval: "weekly"`.
- Extension copy switches to "Weekly" (since the rendered label is gateway-derived for the chat error, and we should make the same change for the usage page — see follow-ups).
- Existing user balances are unchanged at the moment of deploy. Each user's weekly clock starts from their existing `last_reset_at`.

### Step 4 — Drop `dailyLimit` alias (next release after Step 3)

Remove the alias from gateway response and extension. One-release deprecation window.

### Rollback

Flip env var back to `daily`. Existing weekly-window users will get a daily reset on their next request (because `diffDays !== lastResetAt` under daily logic). No data loss.

## Error Handling

| Case | Handling |
|---|---|
| Gateway DO unavailable | `creditMiddleware` already fails open (`creditMiddleware.ts:24-27`). Unchanged. |
| Bonus grant arrives after a reset | `addCredits` is interval-agnostic. The bonus simply tops up the post-reset balance. Unchanged. |
| Old extension reads gateway after dailyLimit removal | UI shows fallback `?? 50`. Functionally fine. Will be addressed by extension auto-update. |
| Clock skew between DO instances | Reset uses `new Date().toISOString()` from the DO's own runtime clock. Cloudflare clocks are tightly synced; ≤1s skew is irrelevant for weekly cadence. |
| User reinstall (new browserosId) | New DO row created with current date as `last_reset_at`, balance starts at 50. Unchanged behavior. |

## Testing

### Gateway unit tests (`browseros-ai-gateway/tests/`)

- `CreditTracker.test.ts` — already covers the daily branch. Add weekly cases:
  - `lastResetAt = today - 6d` → no reset.
  - `lastResetAt = today - 7d` → reset to 50.
  - `lastResetAt = today - 14d` → reset to 50 (single reset, not multiple).
- `creditMiddleware.test.ts` — verify `error.message` for `weekly` mode says "your next weekly reset".
- `bonus.test.ts` — verify bonus addition is unchanged in weekly mode.

### Extension unit tests

- `useCredits.test.ts` (new) — given gateway response with both `creditLimit` and `dailyLimit`, prefers `creditLimit`. Given response with only `dailyLimit` (old gateway), uses it.
- `UsagePage.test.tsx` — given `resetInterval: "weekly"`, renders "Weekly Credits" header.

### Manual QA

1. Pre-flip: open Usage page, see "Daily Credits 50/50".
2. Apply Step 1 (gateway response). Re-open, still "Daily Credits 50/50" (extension still on old code).
3. Apply Step 2 (extension). Re-open, still "Daily Credits 50/50" because gateway still says `daily`.
4. Apply Step 3 (env-var flip). Re-open, should show "Weekly Credits 50/50". Submit a tweet → balance goes to 250 → reset doesn't fire for 7 days. Verify by inspecting `lastResetAt` via a debug endpoint or log line.
5. Force a reset by manually editing the DO state (or wait 7d) → balance returns to 50.
6. Trigger CREDITS_EXHAUSTED → confirm error reads "your next weekly reset".

## Observability

Existing PostHog events keep their names; add `reset_interval` property to all of them for filtering. New event:

- `credits.reset` — emitted whenever a reset actually fires. Properties: `{interval, previous_balance, new_balance}`. This is the key signal that the cadence change is working.

Dashboard to add (PostHog):
- "credits.reset by interval over time" — should show daily resets dropping to ~0 and weekly resets ramping up over the week post-flip.
- "credits.exhausted by interval" — expect to drop sharply post-flip, since users have 7x the runway before exhaustion.

## Open Questions / Follow-ups

1. **Reset day-of-week:** The current weekly logic resets exactly 7 days after `lastResetAt`. That means each user gets a **personal weekly clock** based on when they first installed. Alternative: cron-like reset every Monday 00:00 UTC for everyone. The personal-clock model is simpler (no cron, no thundering herd) and what the DO already implements. Default: keep personal-clock; revisit if support wants a predictable global reset.
2. **Should bonus be capped at 50 instead of 500?** A weekly cap of 500 (vs the daily floor of 50) means a user can earn 10x their weekly base via referrals. That's likely the intended generosity. Keep 500. Adjust later if data shows abuse.
3. **`dailyLimit` field deprecation horizon:** Ship Step 4 (remove alias) only after we see <1% of `/credits/:id` request user-agents are on the pre-Step-2 extension version. Track via PostHog.

---
