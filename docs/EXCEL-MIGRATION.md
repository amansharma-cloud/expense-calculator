# Migrating the Excel tracker

The importer reads sheets named `<Month> <Year> Expenses` (all other sheets are ignored, and listed in the preview).

## Sheet layout it understands

* Column A = item, column B = amount. Row "Total Salary" holds the month's money: usually a formula like
  `=<carry-over> + <salary> + <other credits…>`; the cell next to it (column C) is the sheet's own **Balance**.
* Every item below it is deducted from that total; the Balance is carried to the next month's sheet.

## Mapping

| Sheet | App |
|---|---|
| Sheet created on the 1st, with the salary credited on the previous salary day | one **cycle** starting on the salary day of the previous month |
| Terms of the Total Salary formula | carry-over (the term equal to last month's balance, else the first term), salary (largest other term), other credits (the rest) |
| Rent, family transfers, EMIs, electricity, Wi-Fi, recharge, maids | `fixed` allocation + a settling payment |
| Jupiter, mutual funds, digital gold, RD, SIP, LIC | `investment` allocation + a settling payment |
| `Savings` | `reserved` in history; in the starting plan it becomes the default **release from carry-over** (the spendable buffer) |
| Everything else (food, shopping, cash, credit-card bills, unknown labels) | spending categories, one record per item per month |

The grouping of every label can be changed in the preview before importing.

## What the preview checks

* Recomputes each month's balance from its rows and compares it with the sheet's Balance (mismatches are listed, e.g. a formula that counts a row twice or leaves one out). The app uses the recomputed value.
* Checks each month opens with the previous month's closing balance; differences are listed as "unexplained adjustment" and imported as written.
* Never drops a non-zero row. Unknown labels become categories. Non-numeric or negative amounts are reported.
* Re-importing the same file adds nothing (duplicate detection by `importHash`).

## Limits

* The original sheet has monthly totals per item (often `=a+b+c` lists) but **no dates**. Records are dated at the end of the cycle; the original formula is kept in the record's note so no information is lost.
* Reconciliation proves the totals match, not that the sheet itself was right.
