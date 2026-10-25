# Local data schema

## Databases (IndexedDB, via Dexie)

| Database | Contents |
|---|---|
| `ds-registry` | table `profiles`: `{ id, name, createdAt, locked, salt?, check? }`. `salt` and `check` (an encrypted known string used to verify a PIN) exist only when `locked` |
| `ds-profile-<id>` | one database **per profile**; single table `records`: `{ k, t, d? , iv?, ct? }` |

`k` = `"<table>:<id>"`, `t` = table name. Without a PIN the payload is `d` (JSON). With a PIN it is `iv` + `ct`
(AES-256-GCM, base64). No other place stores financial data (`localStorage` holds only the last-opened profile id).

## Logical tables (payload shapes, see `src/engine/types.ts`)

* **plan** (`id: "plan"`): `{ salaryDay, takeHomePaise, releasedCarryPaise, allocations[], categories[], theme }`: the template for new cycles.
* **cycles** (`id: start date`): `{ start, end (exclusive), takeHomePaise, extraCreditsPaise, openingCarryPaise, releasedCarryPaise, allocations[] (snapshot), label?, source: app|import, sheetBalancePaise? }`.
* **transactions** (`id: uuid`): `{ date, time, amountPaise (> 0), type: expense|refund|income|transfer, category, merchant, method, card?, note, allocationId?, plannedId?, source: manual|quick|import, importHash?, createdAt }`.
* **planned** (`id: uuid`): `{ title, amountPaise, dueDate, done, category? }`.
* **allocation**: `{ id, name, kind: fixed|investment|reserved, amountPaise }`.

## Rules

* Amounts are integers in paise, never floats. Validation rejects negatives, > 2 decimals and non-numbers.
* A transaction belongs to the cycle whose `[start, end)` contains its `date`.
* `importHash` (`xlsx|<sheet>|<item>|<amount>`) makes re-importing the same file a no-op.

## Backup file

`{ app: "daily-spend", schema: 1, exportedAt, profileName, data: { plan, cycles[], transactions[], planned[] } }`: plain,
unencrypted JSON. `parseBackup()` validates dates, integer paise, types and duplicate ids before anything is written.
