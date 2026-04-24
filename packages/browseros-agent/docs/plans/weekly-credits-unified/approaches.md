# Approaches — Unified Weekly Credit Expiry

Three options considered. Picked **Approach A — config-flip with rolling cutover**.

---

## Approach A — Config-flip with rolling cutover ⭐ chosen

**How it works:**
1. Flip `RESET_INTERVAL = "weekly"` in the gateway's `wrangler.toml`.
2. Keep `DEFAULT_CREDITS = 50` (per user's instruction).
3. Add a parallel `creditLimit` field to the gateway `GET /credits/:id` response. Keep `dailyLimit` for one release as an alias.
4. Update extension copy: "Daily Credits" → "Weekly Credits", "Resets daily" → "Resets weekly", etc.
5. Mark yesterday's `referral-weekly-bonus` design as superseded — bonus credits naturally inherit the weekly TTL because they live in the same balance bucket that resets weekly.

**Pros**
- Smallest possible change. The DO already supports weekly (`CreditTracker.ts:103-128`); we just flip the env var. Gateway code change is ~10 lines (response field rename + analytics property).
- Zero referral-service changes. The bonus grant path (`bonus.ts` → `addCredits`) is interval-agnostic.
- No DB migration. Each user transitions to weekly the next time their `last_reset_at` expires under the new rule. Worst case: a user gets one final daily-window of 7 days before the new cadence kicks in. That's an upgrade, not a regression.
- Backward compatible. Old extension installs reading `dailyLimit` keep working until they update.
- Replaces the more complex per-grant-TTL design from yesterday with a much simpler model.

**Cons**
- Bonus credits still vaporize at the weekly boundary (the "use it or lose it" pattern moves from a 24h cliff to a 7d cliff). For most users this is fine, but power-users who burst-tweet at the start of the week and then take credits to the end might still hit it.
- Field rename `dailyLimit` → `creditLimit` is a soft-deprecation that requires a follow-up to fully clean up.

---

## Approach B — Per-grant TTL ledger (yesterday's design)

**How it works:** Separate `referral_grants` table in the gateway with per-row `expires_at`. Debit oldest unexpired grant first, then base. Base credits still reset on a daily cron.

**Pros**
- Per-grant fairness — credit you earn today is good for 7 days from today, not 7 days from week-start.
- Surfaceable per-grant expiration UI ("X credits expire in Y days").

**Cons**
- New table + migration + FIFO debit transaction logic in the gateway DO.
- Doesn't match the user's actual ask. They explicitly said "everything moves to weekly" — they want the simplest unified model, not separate base/bonus tracks.
- 90% of the engineering work for ~10% additional UX win that the user didn't ask for.

**Verdict:** Over-engineered for the actual ask. The yesterday-spec gets superseded.

---

## Approach C — Per-user lazy reset using a sliding window from first-grant

**How it works:** Track an `expires_at` column per user that's set at the moment of any reset/grant. Each grant or reset extends the window to `now + 7d` (sliding). When `expires_at` passes, balance resets to `defaultCredits` and the window restarts at `now`.

**Pros**
- Bonus credits effectively live "rolling 7 days from your latest activity."
- More forgiving of users who tweet on Friday — they don't lose credits at midnight Sunday like a fixed week boundary would.

**Cons**
- New column + new logic. Doesn't reuse the DO's already-implemented weekly mode.
- "Sliding window from latest activity" creates a perverse incentive: tweet a tiny amount weekly to keep credits alive forever.
- Strictly more complex than the env-var flip. No clear win over Approach A given user's explicit "weekly" framing.

---

## Decision

**Approach A**, because:

1. The infrastructure already supports it (`CreditTracker.ts` has weekly mode wired in and tested via the type system).
2. It's the literal interpretation of the user's request ("move to weekly credit expiry for everything").
3. It supersedes a more complex prior design without losing meaningful user value.
4. It's safely reversible by flipping the env var back to `daily` if we discover the weekly cap of 50 is too restrictive.

**Trade-off accepted:** Bonus credits granted late in the week may be wiped at the weekly boundary. We can add a "view recent reset history" UI later if support pings make this a real problem; YAGNI for now.
