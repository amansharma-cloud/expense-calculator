# Calculation rules

All logic is in `src/engine/` (pure TypeScript, no UI imports). Screens only read results from
`computeBudget()`, `closingBalance()`, `dailySeries()`, `spendByCategory()`. Money is an **integer in minor units** (paise, cents…); the currency only affects display and input, never the stored number; dates are
local `YYYY-MM-DD` strings (no time-zone arithmetic).

## Cycle

A cycle runs from one payday to the day before the next. Pay can be monthly (`cycleBounds`), twice a month, or every 7/14 days (`cycleBoundsFor` in `dates.ts`; the 2-weekly rhythm counts from a payday you enter). A set-aside with a due day of the month applies only in the cycle that contains that day (`allocationsForCycle`); with monthly pay everything applies each cycle. After a pay-frequency change the next cycle starts where the previous one ended, so no day is counted twice (`nextCycleBounds`). A salary day that does not exist in a
month (29/30/31) uses that month's last day. A cycle stores its own snapshot of salary, credits, carry-over and
allocations, so later changes to settings never alter closed cycles. Changing the plan edits only the *current*
cycle and the template for future ones.

## Money in

```
available = take-home salary + other credits (cycle field) + one-off "income" transactions + released carry-over
```

* **Carry-over** from the previous cycle is a *reserve*. Only the amount you release is added to `available`.
* One-off income (interest, a refund paid into your account, a payout) is a transaction of type *income*.

## Set aside (never spendable)

`fixed` (rent, EMIs, bills), `investment` (SIPs, RD, gold, LIC) and `reserved` (goals, emergency fund) amounts are
subtracted from `available` first. A payment tagged to one of them (`allocationId`) **settles** it and is *not*
spending, so nothing is counted twice. If you pay more than planned, only the excess is taken from the spendable budget.

## Expected bills

Bills whose amount changes (electricity, recharge) are listed under Budget → Expected bills. Each cycle they become planned items with the usual amount, reserved from the daily limit until paid. Paying records the **real** amount as an ordinary expense, so the difference from the estimate moves into spending (or back into the remaining budget). Converting a fixed set-aside into an expected bill or plain spending never changes a closed cycle's closing balance.

## Spending

```
spent = Σ expenses − Σ refunds     (transactions with no allocationId; transfers ignored)
spendable = available − set aside
remaining = spendable − spent − overrun − planned items not yet paid
```

| Event | Effect |
|---|---|
| Expense | increases `spent` |
| Refund | decreases `spent` (gives budget back) |
| Transfer (own accounts, **credit-card bill payment**) | ignored. Count card *purchases* when you make them, not the bill |
| One-off income | adds to `available` |
| Savings withdrawal | ordinary carry-over; only counts if you release it |
| Planned bill / purchase | reserved from the daily limit until marked paid, then becomes a normal expense (no double count) |
| Deleted / edited transaction | everything is recomputed from the records, so figures always agree |

## Daily limit

```
daysLeft           = days from today to the next salary date (today included)
remainingAtDayStart = remaining + today's spending
today's limit      = max(0, floor(remainingAtDayStart / daysLeft))
original daily     = floor((spendable − all planned items) / cycle length)
left today         = today's limit − today's spending
```

The limit is recomputed from what is *left*, not stored. So underspending raises later days, overspending lowers them,
and an upcoming planned bill lowers today's limit right away. The UI shows limits rounded **down** to whole rupees.
The original daily budget, today's limit, spent today and left today are always shown separately.

## Status & warnings

* `on-track`, `watch` (≥ 80% used, or limit under half the original, or pace runs out early), `over` (today over the limit),
  `exhausted` (remaining ≤ 0), `not-started`, `ended`.
* A warning appears when no spending has been recorded for 3+ days: the engine does **not** assume records are complete.

## Account balance (dashboard card)

```
in your account now   = carry-over + salary & credits + one-off income − set-asides paid − spending
after everything planned = in your account now − set-asides still to pay − expected/planned bills not yet paid
```
The second number is what the old sheet's *Balance* column showed (it subtracted every row at once). Paying a set-aside moves it from "still to pay" to "paid" without changing the after-plan balance; paying an expected bill replaces its estimate with the real amount. Released carry-over is not extra money, transfers are ignored, refunds add back.
**Bank check:** enter the balance your bank shows; the app compares it with *in your account now* and can record the gap as an editable "Balance adjustment" transaction (spending if the bank is lower, money in if higher).

## Closing balance (carry-over)

`closing = opening carry + salary + credits + income − max(planned, paid) per allocation − spent`.
Released carry-over is not subtracted (it was never spent). This is what the next cycle suggests as its opening carry-over.

## Tests

`tests/engine.test.ts` covers paise parsing, Indian grouping, 28/30/31-day and leap-year cycles, salary day 31, the
worked example (₹35,000 over 30 days), under/overspend redistribution, planned items, refunds, transfers, income,
allocation settlement and overrun, last-day limit, exhausted/over status, closing balance, categories, duplicates,
and quick-entry parsing.
