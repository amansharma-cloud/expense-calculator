# Bill reminders (push notifications): one-time setup

Reminders arrive as phone notifications ("2 bills due tomorrow"), even when the app is closed.

**What the server can see:** your browser's push address, the times to send, and one generic line per time.
It never sees bill names, amounts or transactions (those stay encrypted on your devices).

## 1. Make the key (on your Mac, 10 seconds)

```bash
node scripts/gen-vapid.mjs
```

It prints one line of JSON. That is the secret. Do not commit it or paste it in chat.

## 2. Give it to Cloudflare

Cloudflare dashboard → **Workers & Pages** → `expense-calculator` → **Settings** → **Variables and Secrets** → **Add**:

| Type | Name | Value |
|---|---|---|
| Secret | `VAPID_PRIVATE_JWK` | the JSON line from step 1 |

Save and deploy. The every-10-minutes timer is declared in `wrangler.jsonc` (`triggers.crons`) and is created by the normal deploy.

## 3. Turn it on in the app

Settings → **Bill reminders** → **Turn on reminders** → Allow. Tap **Send a test**; a notification should arrive within seconds.

* **Android:** use Chrome, ideally with the app installed (Install app / Add to Home screen).
* **iPhone:** iOS 16.4 or later, and the app must be added to the Home Screen first.
* Reminders are per device: turn them on on each phone you want them on.

## How it works

1. The app works out which dates have unpaid bills or set-asides in the next 45 days.
2. It uploads only those send times and a line like "2 bills due tomorrow" (no names).
3. A Cloudflare cron wakes every 10 minutes, sends an empty push for anything due, and the phone's service worker shows the line.
4. Paying a bill updates the schedule the next time the app is open. A reminder for something you already paid can still arrive if you pay while the app is closed; open the app and it self-corrects.

Rotating the key: make a new one, replace the secret, then turn reminders off and on again on each device.
