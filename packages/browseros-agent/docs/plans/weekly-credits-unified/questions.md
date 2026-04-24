# Clarifying Questions — Unified Weekly Credit Expiry

Self-answered per `/sup-loop-design`. Confidence: `[grounded]` = read from code, `[default]` = sensible default I picked, `[assumption]` = guess that materially affects the design.

Repos read:
- `/Users/felarof01/Workspaces/build/browseros-ai-gateway` (Cloudflare Worker + Durable Object)
- `/Users/felarof01/Workspaces/build/browseros-workers/apps/referral-service` (Hono service that validates tweets and grants bonuses)
- `/Users/felarof01/Workspaces/build/browseros-main.feat-referral-system/packages/browseros-agent` (extension consumer)

---

## Batch 1 — Confirm the simplest change actually works

**Q1. Does the gateway's `CreditTracker` Durable Object already support a weekly reset, or do we have to teach it?**

**Answer:** [grounded] Already supports it. `CreditTracker.ts:30` defines `type ResetInterval = "daily" | "weekly" | "biweekly"`, the constructor reads `RESET_INTERVAL` from env (line 42), and `shouldReset` on lines 103-128 already implements `weekly` (`diffDays >= 7`) and `biweekly` (`diffDays >= 14`). No code change needed in the DO to flip the interval — it's just a `wrangler.toml` env-var change (line 58: `RESET_INTERVAL = "daily"` → `"weekly"`).

**Q2. Does the bonus credit pipeline need any change?**

**Answer:** [grounded] No. Referral service `gateway-client.ts:8-28` POSTs to `/credits/:browserosId/bonus` with `{amount: 200, reason: "twitter_share"}`. Gateway `bonus.ts:31` calls `addCredits(amount)` which simply adds to the single balance. The reset interval governs when the WHOLE balance (base + accrued bonus) resets back to `defaultCredits`. So bonus credits naturally inherit the new weekly TTL with zero referral-service or bonus-handler changes. The yesterday's `referral-weekly-bonus` design (separate per-grant ledger) is **superseded by this simpler model** and should be marked obsolete.

**Q3. Where does the "daily" name leak into the public API contract?**

**Answer:** [grounded] One place: `GetCreditsResult.dailyLimit` in `CreditTracker.ts:13`, returned to clients via `creditGetHandler` (`credits.ts:13`). Extension's `CreditsInfo.dailyLimit` (`useCredits.ts:7`) reads it. We have two options: rename the field (breaking) or keep the misleading name (cosmetic). Default: keep `dailyLimit` in the response for one release cycle, ship a parallel `resetInterval: "weekly"` field, and rename in v2 once the extension version using the new name is widely deployed. This avoids breaking older extension installs.

---

## Batch 2 — Migration, cap, and edge cases

**Q4. What happens to existing user balances at the moment we flip the env var?**

**Answer:** [grounded] DO `ensureReset()` (`CreditTracker.ts:86-101`) checks `now - last_reset_at`. After flip:
- A user whose `last_reset_at` is "today" (just got their daily reset before flip) won't reset for 7 more days from today. They keep their current balance until then. Good — no credit loss.
- A user with bonus credits granted yesterday: their `last_reset_at` is whatever yesterday's date was, so weekly reset triggers ~6 days from now. Bonus stays useful for nearly its full week. Good.
- A user who hasn't logged in in months: their `last_reset_at` is stale. First request after flip triggers a reset (since diff >= 7d) and they start fresh with 50. Same as before, no behavior change.

So **no migration is required**. The transition is naturally rolling over a 7-day period.

**Q5. Is keeping `DEFAULT_CREDITS = 50` correct for a weekly cap?**

**Answer:** [grounded — explicit] The user wrote "the 50 credits I give in the initially can be changed to 50 and move to weekly credits". That's literally "stays at 50 and moves to weekly cadence". So yes, **50 stays**. This is a deliberate downgrade from "50/day" to "50/week" to push more users toward BYOK or the referral bonus loop.

**Q6. Should the per-grant cap on `addCredits` (currently `1 ≤ amount ≤ 1000` per call in `bonus.ts:22`) change?**

**Answer:** [default] No. That's a safety cap on a single grant call, independent of reset cadence. The referral service hard-codes `BONUS_CREDITS = 200` (`referral.ts:9`), well within the cap. No change.

---

## Batch 3 — Frontend copy and naming

**Q7. Should we rename `dailyLimit` in the extension immediately?**

**Answer:** [default] Soft-rename. The extension reads `data?.dailyLimit ?? 50` in `UsagePage.tsx:47`. To avoid breaking older gateway responses (and to roll out incrementally), the extension should:
1. Read `data?.weeklyLimit ?? data?.dailyLimit ?? 50` for one version, then
2. Drop the `dailyLimit` fallback in a later release.

The gateway response should add `weeklyLimit` (or rename `dailyLimit` → `creditLimit`, intervalless) in parallel. **Default pick:** rename to `creditLimit` (interval-neutral) and have the extension prefer it, falling back to `dailyLimit`. Cleanest end state.

**Q8. What extension copy mentions "daily" or "midnight UTC"?**

**Answer:** [grounded] Inventory after grep:
- `UsagePage.tsx:66` — "Daily Credits" heading → **"Weekly Credits"**
- `UsagePage.tsx:92-93` — "Resets daily / Midnight UTC" tile → **"Resets weekly / Mondays UTC"** (or whichever weekday — see Q10 in follow-ups)
- `UsagePage.tsx:99` — "Credits used today" stat → **"Credits used this week"**
- `UsagePage.tsx:101` — `{creditsUsed} of {total}` line — copy unchanged, just shows weekly numbers naturally
- `ChatError.tsx:54` — "Daily credits exhausted. Credits reset at midnight UTC." → **"Weekly credits exhausted. Resets <interval label>."** Source the human-readable label from the gateway response (it already returns `Retry-After` and embeds a label in the error message — see `creditMiddleware.ts:40`).
- `ChatError.tsx:104` — "Daily limit reached" title → **"Weekly limit reached"**
- `ChatError.tsx:99` — `experimentId=daily_limit_${...}` survey URL — keep the experimentId as a stable analytics key (don't break historical buckets), but consider renaming in a follow-up if the survey is being redesigned.
- `ShareForCredits.tsx:66` — "You've reached the daily cap of {X}" → **"You've reached the bonus cap of {X}"** (or **"weekly cap"** — see Q9). The shared constant `MAX_DAILY_CREDITS` should rename to `MAX_BONUS_BALANCE` since it now caps the running balance, not a daily-window thing.
- `ShareForCredits.tsx:87` — "Daily cap of {X} credits — resets at..." → **"Cap of {X} credits — resets weekly"**.

**Q9. Should we keep tracking analytics events under their current names (`credits.deducted`, `credits.bonus_added`, `credits.exhausted`)?**

**Answer:** [default] Yes — keep names so historical PostHog dashboards stay continuous. Add a new property `reset_interval: "weekly"` on every event so dashboards can filter post-flip vs pre-flip. Add one new metric: `credits.reset` fired from `CreditTracker.ensureReset` when an actual reset happens (helpful for "is the new cadence actually behaving the way we expected" debugging). This is cheap to add — one `captureEvent` call inside the `if (this.shouldReset(...))` block.

---

## Assumptions to surface in the spec

1. **Q3** assumes nothing else in the system reads the literal field name `dailyLimit` outside the extension. There's a `gateway.ts` in `apps/server/src/lib/clients/` that also defines `CreditsInfo` with `dailyLimit`. That's the BrowserOS local server reading the same gateway endpoint — needs the same soft-rename treatment. Will surface in the spec.
2. **Q8** assumes the gateway response already includes (or can include) a human-readable reset label so the extension doesn't have to know which weekday/time. If not, extension hardcodes "weekly" and that's fine.
3. **Q4** assumes the gateway DO storage is durable across the env-var flip (no implicit reset on redeploy). Cloudflare Durable Object SQLite storage IS durable across worker code redeploys (this is a documented guarantee), so this is safe.
