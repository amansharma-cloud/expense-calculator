# Daily Spend (expense-calculator)

A private, free, offline-capable web app that tells you **how much you can safely spend today** after your
savings, investments and fixed bills are protected. It replaces a hand-maintained monthly Excel tracker.

* Runs entirely in the browser. **No server, no account, no API keys, no analytics.**
* Data is stored on your device (IndexedDB). Each person gets their own profile, with an optional PIN that really encrypts it.
* React + TypeScript + Vite + Dexie. Free to build, free to host (GitHub Pages).

## Run it locally (free)

Requires Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 52 automated tests (calculations, importer, backup, encryption)
npm run build      # production build in dist/
```

To try it on your phone while developing, run `npm run dev -- --host` and open the printed network address
on the same Wi-Fi. (Offline/installable mode needs the HTTPS deployment below.)

## Deploy free on Cloudflare Pages (recommended)

Cloudflare Pages gives the app its **own address** (e.g. `expense-calculator.pages.dev`), so browser storage is not shared with
any other site you host. In the Cloudflare dashboard: *Workers & Pages → Create → Pages → Connect to Git*, pick this repo, and set

| Setting | Value |
|---|---|
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION` = `22` |

Every push to `main` redeploys. Leave Web Analytics off. (GitHub Pages also works, but every project under
`<user>.github.io` shares one browser origin, so another page on that account could read this app's stored data unless profiles
use a PIN. Use a PIN either way; never host untrusted scripts on the same origin.)

Never commit real financial files; `.gitignore` already excludes `*.xlsx`, `*.csv` and `backup-*.json`. GitHub Actions (`ci.yml`) runs the tests and build on each push.

## Account balance

The dashboard's **Account balance** card shows carry-over + this cycle's money − what is spent or still to pay, as *in your account now* and *after everything planned* (your old sheet's Balance), with a breakdown and a check against the real bank balance. See [docs/CALCULATIONS.md](docs/CALCULATIONS.md).

## Your own domain

See [docs/CUSTOM-DOMAIN.md](docs/CUSTOM-DOMAIN.md): add the domain to Cloudflare, attach a subdomain to the Worker, extend the Access login to it, then move each person's data (browser storage is per address).

## Variable bills (electricity, recharge)

Amounts that change every month are **expected bills**, not fixed set-asides. The usual amount is reserved from your daily limit each cycle until you tap **Paid** and enter the real amount; the difference lands in your spending. Rent, EMIs and similar fixed amounts stay as set-asides. In Budget, any fixed item can be moved with **Amount varies** or **Make spending** (past cycles keep identical balances).

## Currency, pay frequency and backups

* **Currency:** each profile picks its own (INR, CAD, USD, GBP, EUR, AUD, NZD, SGD, AED). It controls symbols, digit grouping (₹12,34,567 vs $1,234,567.50) and what you can type in quick entry ("Tim Hortons $4.50"). Changing it relabels amounts; it never converts them.
* **Pay frequency:** monthly, twice a month, every 2 weeks, or weekly. Each pay period is one budget cycle, and the daily limit runs to the next payday. Monthly bills can have a due day so they are set aside only in the pay period that contains it.
* **Backups:** *Download/Share backup* makes a **JSON file** that this app can restore (it is not an Excel file; the Excel export on Reports is for reading and sharing). On a phone, Share opens the share sheet so you can email it to yourself or save it to Drive. With cloud sync on, the server also keeps one **encrypted restore point per day for 14 days** (Settings → Account & cloud sync → Restore points), so a mistake that has synced to every device can be undone.

## Optional: login + encrypted cloud sync

Off by default. If you set it up ([docs/SYNC-SETUP.md](docs/SYNC-SETUP.md)), invited people sign in with Cloudflare Access and a PIN-protected profile can keep an
**end-to-end encrypted** copy in Cloudflare D1, restorable on another device. The server stores ciphertext, your email and timestamps only; it rejects plaintext.
Tests cover token verification, per-user isolation, merging between two devices and "no plaintext reaches the server".
Local run: `npm run dev:cloud`.

## Install on your phone

Open the deployed HTTPS address (your `*.pages.dev` link) in the phone's browser.
* **Android (Chrome):** menu → *Install app* / *Add to Home screen*.
* **iPhone (Safari):** Share → *Add to Home Screen*. Installing also makes iOS far less likely to evict stored data.

After the first visit the app opens offline. Your data is **per browser and per device**; it does not sync.
Use *Settings → Download backup* regularly.

## Using it

1. **Create a profile** (one per family member). Optionally set a PIN.
2. **Set up** salary, salary day and your fixed bills/investments, *or* import your old Excel tracker
   (Settings → Import, or from the first-run screen). You get a preview with every problem listed before anything is saved.
3. At each salary day you **start a cycle**: salary, other credits, carry-over, and how much of the carry-over to release.
4. **Add expenses** with the + button: type “Uber 250 yesterday”, review the suggested fields, save. The dashboard updates immediately.
5. Check **Dashboard** for today's limit, **History** to search/edit/delete/export, **Reports** for cycle summaries.

## How the daily limit works (short version)

```
available  = salary + other credits + (carry-over you chose to release)
set aside  = fixed bills + investments + reserved   (never offered as spending)
spendable  = available − set aside
remaining  = spendable − spent so far − upcoming planned bills
today's limit = remaining at the start of today ÷ days left (including today)
```

Underspend today and tomorrow's limit rises; overspend and it falls. Full rules and edge cases: [docs/CALCULATIONS.md](docs/CALCULATIONS.md).
Data model: [docs/SCHEMA.md](docs/SCHEMA.md). Excel migration: [docs/EXCEL-MIGRATION.md](docs/EXCEL-MIGRATION.md).

## Privacy, storage and backups

* Everything lives in this browser's IndexedDB. Nothing is transmitted **unless you turn on cloud sync** (then only encrypted records leave the device). There are no third-party scripts, and a Content-Security-Policy blocks outside connections (`connect-src 'self'`).
* **Not encrypted unless you set a PIN.** With a PIN, record contents are encrypted with AES-256-GCM using a key derived from the PIN (PBKDF2-SHA-256, 250,000 iterations). The key is held in memory only; the profile locks after 5 minutes in the background.
  A forgotten PIN **cannot be recovered**. Table names and record counts are not encrypted.
* Profiles on the same device give **organisation, not strong privacy**: without a PIN, anyone using that browser can open any profile. With a PIN they cannot read the data without it.
* **Data health (Settings):** shows whether the browser has promised not to evict the data, how much space it uses, and when you last backed up. The app asks the browser to protect its storage, and the dashboard reminds you after 14 days without a backup.
* **Backups:** download a JSON file, share it from a phone (Drive, email…), or on Chrome/Edge pick a folder for a daily automatic backup. All backup files are plain, unencrypted JSON.
* **Upgrades never discard data:** stored records have a format version (`DB_SCHEMA_VERSION`); migrations only add fields. Deleted records leave a marker (needed for future sync).
* **Browser storage can be cleared** (clearing site data, uninstalling the browser, private windows, low-storage eviction). **Download a backup regularly.** Backups are plain JSON, not encrypted: keep them private.
* Works offline after the first load. It can't sync devices, and the offline cache only holds the app's own files.

## What it cannot do (and alternatives)

| Not possible here | Why | Alternative |
|---|---|---|
| Read bank accounts, UPI apps, SMS or notifications automatically | A web app has no permission to; bank APIs need paid/regulated access | Quick entry, or import a bank/UPI statement file (planned, Phase 2) |
| Sync between phone and laptop without any setup | Needs a server and a login | Optional encrypted sync (see above), or download a backup and restore it on the other device |
| Recover a forgotten PIN | Encryption keys never leave your device | Restore from a backup into a new profile |
| Receipt scanning, AI categorisation | Not built; would need on-device OCR/models | Local keyword rules and learned merchants are used instead |

## Status

| Phase | Item | State |
|---|---|---|
| 1 | Profiles, optional PIN encryption | Done |
| 1 | Salary, allocations, cycles, daily limit engine + explanation | Done |
| 1 | Add/edit/delete expenses, search/filter, CSV & Excel export | Done |
| 1 | Dashboard, charts, reports | Done |
| 1 | Excel import with preview/reconciliation | Done |
| 1 | JSON backup & restore | Done |
| 2 | Natural-language quick entry, category suggestions, duplicate flagging | Done (basic, rule-based) |
| 2 | PWA offline & installable | Done (simple network-first service worker) |
| 2 | Bank/UPI CSV statement import, recurring-bill forecasts | Not yet built |
| 3 | Receipt OCR, encrypted backups | Not yet built |
| 4 | Login (Cloudflare Access) + end-to-end encrypted sync, daily restore points | Done (needs one-time Cloudflare setup) |
| 4 | Currency selector, pay frequency (monthly / twice a month / 2-weekly / weekly) | Done |

## Known limitations

* Imported history has monthly totals per item only (the old sheet has no dates), so imported records are dated at the end of each cycle.
* The `xlsx` npm package (SheetJS community edition 0.18.5) has known advisories for untrusted files; the app only reads files you choose yourself, in your own browser. Review before opening spreadsheets from others.
* Dates use the device's local time. Salary day 29–31 uses the last day of shorter months.
* The first build is a single ~1.2 MB JavaScript file (charts + spreadsheet library).

## Free tools for building this yourself

| Option | Free tier & limits | Verdict |
|---|---|---|
| **Claude Code / VS Code on your computer** | Code stays local; usage counts against your Claude plan | Best fit: private, can run tests |
| **VS Code + a local model (Ollama)** | Free, fully offline, weaker on multi-file work | Fine for small edits |
| **Google AI Studio** | Free tier with rate limits; prompts may be reviewed/used by Google | OK for UI prototypes; don't paste real finances |
| **StackBlitz / CodeSandbox** | Free tiers with resource/time limits | Demos only |
| **GitHub Pages / Cloudflare Pages / Netlify** | Free for static sites (limits change) | Hosting only the code; your data never goes there |

Free-tier terms change; check each provider's current page before relying on them.
