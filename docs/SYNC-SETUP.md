# Setting up login + encrypted cloud sync (optional)

The app works fully without this. Sync only turns on when the Worker has **a D1 database** and **Cloudflare Access** configured.
Until then `/api/*` answers "not configured" and the Settings page says cloud sync isn't set up.

## What it does

* **Login:** Cloudflare Access (Zero Trust) asks invited email addresses for a one-time code before the site opens. The Worker checks the signed
  token Access adds to each request (signature, issuer, audience, expiry) and uses the email as the account.
* **Sync:** a profile with a PIN can upload its records. They are encrypted on the device first (AES-256-GCM, key from the PIN), so the server stores
  ciphertext only. The API refuses any record that is not ciphertext. Records merge per item: the newer change wins, deletes included.
* **What Cloudflare can see:** your email, how many records, when they changed, the profile name, and the (non-secret) salt used for the PIN. Not amounts, merchants or notes.
* **Restore points:** the first time a profile syncs on a new (UTC) day, the server copies its current encrypted records as that day's restore point (14 days kept, newest first). Restore one from Settings to rewind a profile on every device. They are ciphertext too, so they need the PIN. No scheduled job or extra setup is needed.
* **Forgotten PIN:** the cloud copy cannot be decrypted either. Keep backups.

## One-time setup (about 15 minutes)

Screens change over time; if a button has moved, search the dashboard for the name in **bold**.

### 1. Create the database
1. Cloudflare dashboard → **Storage & databases → D1 SQL database → Create database**.
2. Name it `expense-calculator`. Open it and copy the **Database ID** (a UUID). No tables need to be created: the Worker creates them on first use.

### 2. Put the site behind Access (invited people only)
1. Dashboard → **Workers & Pages → expense-calculator → Settings → Domains & Routes**.
2. On the `workers.dev` row choose **Enable Cloudflare Access** (and, if shown, enable it for preview URLs too).
3. If this is your first time, Cloudflare asks you to set up **Zero Trust**: pick a team name (this becomes `<team>.cloudflareaccess.com`) and the **Free** plan
   (free up to 50 users). Cloudflare may ask for a payment method even for the free plan; it is not charged.
4. Choose **Manage Cloudflare Access** to open the policy. Edit the policy so that **Include → Emails** lists the people you invite (you, your partner, …).
   Login method **One-time PIN** is the default and needs nothing else.
5. Copy two values:
   * **Team domain:** Zero Trust → **Settings → General → Team domain** (looks like `myteam.cloudflareaccess.com`).
   * **AUD tag:** Zero Trust → **Access → Applications →** your application → **Overview → Application Audience (AUD) Tag**.

> This makes the *whole site* invited-only, which is the point. To let anyone use the app locally and only protect sync, you would instead need your own domain and an Access application scoped to `/api/*` and `/login`.

### 3. Give the values to the repo
In `wrangler.jsonc` fill in the two commented blocks (these are not secrets; the AUD tag and team name only identify your Access app):

```jsonc
"d1_databases": [{ "binding": "DB", "database_name": "expense-calculator", "database_id": "<Database ID>" }],
"vars": { "ACCESS_TEAM_DOMAIN": "<team>.cloudflareaccess.com", "ACCESS_AUD": "<AUD tag>" }
```

Commit and push; Cloudflare redeploys automatically. (Variables set only in the dashboard are overwritten by the next deploy, so keep them in this file.)

### 4. Check it
1. Open the site: Cloudflare asks for your email and a code.
2. Create a profile **with a PIN**, add an expense, then **Settings → Account & cloud sync → Turn on sync**.
3. On a second device (or browser) open the site, sign in, **Restore from the cloud**, enter the PIN: the data appears. Add an expense on either side; the other gets it within a few seconds of opening/focusing the app.
4. Remove an email from the Access policy: that person can no longer open the site or reach the API.

## Running it locally

```bash
npm run dev:cloud     # builds, then runs the real Worker with a local on-disk D1 at http://localhost:8787
```
Create a `.dev.vars` file (git-ignored, never deployed) containing:
```
ALLOW_DEV_AUTH=1
DEV_AUTH_EMAIL=you@example.com
```
This simulates the Access login for local testing only. Production ignores it unless `ALLOW_DEV_AUTH` is set, which it never is in `wrangler.jsonc`.
To test two devices locally, open `http://localhost:8787` and `http://127.0.0.1:8787` (separate browser storage).

## Security notes

* All API calls act on the email from the verified Access token; the request cannot choose another user. Tests prove user A cannot read, write or delete user B's data.
* Writes must be same-site JSON (`Origin` check), at most 400 rows / 1 MB per request, 20,000 records and 5 profiles per user.
* Changing the PIN while sync is on is blocked (the cloud copy is encrypted with the old key): turn sync off, change the PIN, turn it on again.
* Erasing a profile while sync is on erases it on your other devices too (it is a synced delete).
* Cloudflare's free-tier limits and the Zero Trust free plan terms can change; check them before relying on this.
