// Makes the key pair that lets your Worker send push notifications.
// Run:  node scripts/gen-vapid.mjs
// It prints ONE secret value. Paste it into Cloudflare (see docs/PUSH-SETUP.md). Never commit it.
import { webcrypto as crypto } from 'node:crypto'

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
const { kty, crv, x, y, d } = jwk
console.log('\nSecret name:  VAPID_PRIVATE_JWK')
console.log('Secret value (one line, keep it private):\n')
console.log(JSON.stringify({ kty, crv, x, y, d }))
console.log('\nThe public key is derived from it automatically; there is nothing else to configure.\n')
