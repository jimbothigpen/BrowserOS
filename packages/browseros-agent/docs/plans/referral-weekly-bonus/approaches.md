# Approaches — Referral Weekly Bonus

Three options considered. Picked **Approach B — separate bonus ledger with per-grant TTL**.

---

## Approach A — Single balance with global "next expiry" timestamp

**How it works:** Keep the single `credits` integer. Add a single `bonusExpiresAt` column. Every new grant resets `bonusExpiresAt = now + 7d`. At expiry, drop balance back to `dailyLimit`.

**Pros**
- Smallest data-model change — one new column.
- Gateway debit logic untouched (single decrement).

**Cons**
- "Most recent grant resets the clock for the whole pool" was explicitly rejected in Q5 — a user who tweets on day 6 to extend day-1 credits is the abuse pattern.
- Cannot show per-grant expiration in the UI ("X credits expire in 2 days").
- Cannot tell base from bonus on read, so the "Bonus credits" UI stat (already shipped in PR #731) breaks because the balance can be `dailyLimit + leftover-bonus + new-bonus` without a way to attribute.

---

## Approach B — Separate bonus ledger with per-grant TTL ⭐ chosen

**How it works:** Gateway gets a new `referral_grants` table:

```
user_id, granted_at, expires_at, amount, consumed
```

Plus an existing `base_credits` field per user (already there, equals current `credits` minus historical bonuses). Read endpoint computes `credits = baseRemaining + Σ(amount - consumed) for unexpired grants`. Debit logic burns bonus first (oldest expiry first), then base.

**Pros**
- Honest per-grant TTL (Q5).
- Read API stays a single integer — no frontend change to the basic balance contract; just an additional optional `bonusGrants` array.
- Per-grant expiry surfaceable in UI (Q8).
- `bonus.expired_unused` analytics is a row-level event (Q9).
- Cap on unexpired bonus (Q6) is a trivial SUM check at grant time.

**Cons**
- New table + migration + cron job to mark expired grants (or a "filter by `expires_at > now()`" on read — preferred, no cron needed).
- Slightly more complex debit transaction (FIFO across grants then base).

---

## Approach C — Bonus credits as a separate "wallet" wired through the gateway response

**How it works:** Gateway returns `{baseCredits, bonusCredits, bonusExpiresAt[]}` instead of `credits`. Frontend sums them for display but tracks them separately.

**Pros**
- Cleanest mental model.
- Frontend can render base and bonus as totally distinct UI primitives.

**Cons**
- Breaking API change — every consumer (`useCredits.ts`, `gateway.ts`, side-panel badge, chat-error block) needs to migrate.
- Doesn't materially improve over Approach B, which already exposes bonus separately via the optional `bonusGrants` array while keeping `credits` backward-compatible.
- Extra moving parts for the same outcome violates YAGNI.

---

## Decision

**Approach B**, because:

1. Backward-compatible read API (`credits` integer stays meaningful — it's just `base + Σ unexpired bonus`).
2. Per-grant TTL matches user intent ("the credit you earned today is good for 7 days").
3. FIFO-bonus-first debit naturally minimizes wasted expirations.
4. Migration is mechanical: snapshot `excess = max(0, credits - dailyLimit)` per user, write one `referral_grants` row with `expires_at = now + 7d`. No data loss, no support pain.
5. The `bonusGrants` array on the read response gives the UI everything it needs to show "X credits expire in Y days" without breaking the existing `credits` integer contract.
