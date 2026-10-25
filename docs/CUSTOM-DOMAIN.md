# Putting the app on your own domain

Your domain is registered with another company, so the plan is: add the domain to Cloudflare (free), point the app at a subdomain
(for example `money.yourdomain.com`), and move everyone's data across. Take it in this order.

> **Why the order matters.** Browser storage belongs to a web address. The app at `…workers.dev` and the app at
> `money.yourdomain.com` are different addresses, so the new one starts **empty**. Move the data (step 5) before you stop using the old address.

## If your domain is a free name such as `something.work.gd`

Free-domain services (freedomain.one and similar) give you a *name under a shared domain*. Cloudflare's free plan normally only accepts a
domain you fully own (`example.com`), not a name under someone else's domain, so the **Add a domain** step below may be refused. Try it; nothing is lost if it is.
- **If Cloudflare accepts it:** continue as written, and in step 2 use the provider's "custom name servers" option for the two Cloudflare nameservers.
  Because the zone *is* `something.work.gd`, step 3 can attach that exact name (no extra subdomain needed).
- **If Cloudflare refuses it** (a message that it is not a registrable/root domain): the app cannot use that name. A CNAME to `workers.dev` does **not** work for a Worker.
  Options: a real domain (around US$10 a year, cheapest at registrars such as Cloudflare Registrar), or keep the `workers.dev` address.
- **Risks of a free shared-suffix name:** the provider can suspend it, some office networks and security tools block these suffixes, and if the name is lost, the browser storage for that address is unreachable.
  Keep the `workers.dev` address working as a fallback and keep backups or cloud sync on.

## 1. Add the domain to Cloudflare
1. Cloudflare dashboard → **Domains → Onboard a domain** (older layout: **Add a site**). Enter your domain, choose the **Free** plan.
2. Cloudflare scans your current DNS and imports the records. **Compare the list with your registrar's DNS page** and add anything missing
   (especially `MX` and `TXT` records if the domain handles email, and any records for an existing website).
3. Cloudflare shows **two nameservers** (for example `xxx.ns.cloudflare.com`). Keep that page open.

## 2. Point the domain at Cloudflare (at your registrar)
1. If the registrar has **DNSSEC** turned on, turn it off first (it breaks the switch); Cloudflare can re-enable it afterwards.
2. In the registrar's DNS/nameserver settings choose **custom nameservers** and replace the existing ones with the two from Cloudflare.
3. Wait. Cloudflare emails you when the domain is **Active** (usually minutes, sometimes up to a day). Nothing breaks meanwhile.

## 3. Attach a hostname to the app
1. Workers & Pages → **expense-calculator → Settings → Domains & Routes → Add → Custom domain**.
2. Enter a **subdomain** such as `money.yourdomain.com` (recommended: your main domain stays free for other uses). Cloudflare creates the DNS record and the HTTPS certificate.

## 4. Extend the login to the new hostname
1. Zero Trust → **Access controls → Applications →** `expense-calculator – Cloudflare Workers` → edit.
2. Under **Destinations** choose **Add public hostname** (or "Add destination") and enter the same hostname (`money.yourdomain.com`).
3. Save. It keeps the same policy (your allowed emails) and the same AUD tag, so **no code or config change is needed**.

## 5. Move the data, one person at a time
Do this *before* anyone stops using the old address.
- **With cloud sync on (easiest):** open the new address → sign in → **Restore from the cloud** → enter your PIN. Your data appears.
- **Without sync:** on the old address go to Settings → **Download backup**; on the new address use **Restore from a backup file** on the first screen.
- Phone users: remove the old home-screen icon and "Add to Home Screen" again from the new address.
- Everyone signs in again on the new address with their email code (the login is per address).

## 6. Check, then retire the old address (optional)
- On the new address confirm: the app loads over HTTPS, you can sign in, your data is there, an expense you add syncs to a second device.
- When **everyone** has moved, you can send the old address to the new one. In `wrangler.jsonc` set
  `"run_worker_first": true` inside `assets` and add `"CANONICAL_HOST": "money.yourdomain.com"` under `vars`, then push.
  (The old address then redirects page loads; `/api` keeps working until old installs update.) **Do not do this early:** people who haven't moved yet would no longer be able to reach their old storage to back it up.

## If something goes wrong
- **"Not secure" / certificate pending:** wait a few minutes after step 3; the certificate is issued automatically.
- **Login page says the account has no access:** the email isn't in the Access policy, or the hostname wasn't added in step 4.
- **Sync says "not configured" on the new address:** the hostname isn't covered by the Access application (step 4), so the API gets no login token.
- **The custom domain vanishes after a later deploy:** move it into `wrangler.jsonc` as `"routes": [{ "pattern": "money.yourdomain.com", "custom_domain": true }]` and redeploy.
- **Email on the domain stopped working:** an `MX`/`TXT` record was missed in step 1; add it in Cloudflare's DNS page exactly as it was at the registrar.
