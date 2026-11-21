// Makes the key pair that lets your Worker send push notifications.
// Run:  node scripts/gen-vapid.mjs
// It prints ONE secret value. Paste it into Cloudflare (see docs/PUSH-SETUP.md). Never commit it.
import { webcrypto as crypto } from 'node:crypto'

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
const { kty, crv, x, y, d } = jwk
if (process.argv.includes('--raw')) {
  // Only the JSON, so it can be piped:  node scripts/gen-vapid.mjs --raw | npx wrangler secret put VAPID_PRIVATE_JWK
  process.stdout.write(JSON.stringify({ kty, crv, x, y, d }))
  process.exit(0)
}
console.log('\nSecret name:  VAPID_PRIVATE_JWK')
console.log('Secret value (one line, keep it private):\n')
console.log(JSON.stringify({ kty, crv, x, y, d }))
console.log('\nThe public key is derived from it automatically; there is nothing else to configure.\n')
