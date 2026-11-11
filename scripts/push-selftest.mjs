// push-selftest.mjs
// Proves src/push.ts encrypts Web Push payloads correctly: the Worker code
// (WebCrypto) encrypts, an independent implementation written with node:crypto
// decrypts. Also verifies the VAPID JWT signature.
//
//   node scripts/push-selftest.mjs

import { build } from 'esbuild';
import { createECDH, createDecipheriv, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'push-selftest-'));
const out = join(tmp, 'push.mjs');
await build({ entryPoints: [join(root, 'src/push.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'silent' });
const push = await import(pathToFileURL(out).href);
rmSync(tmp, { recursive: true, force: true });

let failed = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failed++;
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');

// Independent RFC 8291 decryptor (node:crypto only, no code shared with push.ts).
function decryptAes128gcm(body, uaPrivateKey /* Buffer */, uaPublicKey /* Buffer */, authSecret /* Buffer */) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const cipher = body.subarray(21 + idlen);
  if (rs < cipher.length) throw new Error('record larger than rs');
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivateKey);
  const shared = ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublicKey, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  // Strip padding: last record ends with 0x02 after the data (zeros may precede it).
  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) end--;
  if (plain[end - 1] !== 2) throw new Error('missing 0x02 delimiter');
  return plain.subarray(0, end - 1);
}

function newSubscriber() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const authSecret = randomBytes(16);
  return {
    priv: ecdh.getPrivateKey(),
    pub: ecdh.getPublicKey(),
    auth: authSecret,
    p256dh: b64u(ecdh.getPublicKey()),
    authB64: b64u(authSecret),
  };
}

// 1. Round trips with random keys and several payload sizes ------------------
for (const size of [0, 1, 80, 1000, 4000, 4079]) {
  const sub = newSubscriber();
  const plain = size === 0 ? Buffer.alloc(0) : Buffer.from('x'.repeat(size));
  const body = Buffer.from(await push.encryptPayload(new Uint8Array(plain), sub.p256dh, sub.authB64));
  let ok = false;
  let extra = `body=${body.length}B`;
  try {
    ok = decryptAes128gcm(body, sub.priv, sub.pub, sub.auth).equals(plain);
  } catch (e) {
    extra += ' ' + e.message;
  }
  check(`round trip, payload ${size} bytes`, ok, extra);
}

// 2. Realistic JSON payload with UTF-8 ------------------------------------------
{
  const sub = newSubscriber();
  const msg = { title: '💬 Nueva conversación', body: 'Colombia · ¿Cuánto cuesta Yammbo POS?', url: '/panel/#/c/abc12345' };
  const body = Buffer.from(await push.encryptPayload(new TextEncoder().encode(JSON.stringify(msg)), sub.p256dh, sub.authB64));
  const got = JSON.parse(decryptAes128gcm(body, sub.priv, sub.pub, sub.auth).toString('utf8'));
  check('JSON/UTF-8 payload decrypts to the original object', JSON.stringify(got) === JSON.stringify(msg));
  check('header: rs = 4096, idlen = 65', body.readUInt32BE(16) === 4096 && body[20] === 65);
}

// 3. Tampering and oversize must fail --------------------------------------------
{
  const sub = newSubscriber();
  const body = Buffer.from(await push.encryptPayload(new TextEncoder().encode('secret'), sub.p256dh, sub.authB64));
  const bad = Buffer.from(body);
  bad[bad.length - 5] ^= 1;
  let threw = false;
  try { decryptAes128gcm(bad, sub.priv, sub.pub, sub.auth); } catch { threw = true; }
  check('flipped ciphertext byte is rejected (GCM tag)', threw);
  const other = newSubscriber();
  threw = false;
  try { decryptAes128gcm(body, other.priv, other.pub, other.auth); } catch { threw = true; }
  check('another subscriber cannot decrypt', threw);
  threw = false;
  try { await push.encryptPayload(new Uint8Array(4080), sub.p256dh, sub.authB64); } catch { threw = true; }
  check('payload > 4079 bytes is refused', threw);
}

// 4. VAPID JWT verifies with the public key, using node:crypto -----------------------
{
  const keys = await push.generateVapidKeys();
  const aud = 'https://fcm.googleapis.com';
  const now = 1_800_000_000;
  const jwt = await push.signVapidJwt(aud, keys.privateJwk, now);
  const [h, c, s] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const pub = Buffer.from(keys.publicKey, 'base64url');
  const pubKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
  const sigOk = verify('sha256', Buffer.from(`${h}.${c}`), { key: pubKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  check('VAPID JWT signature verifies (ES256, r||s)', sigOk);
  check('VAPID claims', claims.aud === aud && claims.exp === now + 12 * 3600 && claims.sub === 'mailto:support@yammbo.com' && header.alg === 'ES256');
  check('public key is a 65-byte uncompressed point', pub.length === 65 && pub[0] === 4);
  check('Authorization header shape', push.vapidAuthHeader(jwt, keys.publicKey) === `vapid t=${jwt}, k=${keys.publicKey}`);
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
