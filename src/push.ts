// push.ts
// Web Push without libraries (WebCrypto only):
//   - VAPID (RFC 8292): ES256 JWT + the Authorization header.
//   - Message encryption (RFC 8291, aes128gcm content coding of RFC 8188):
//     ephemeral ECDH P-256 + HKDF-SHA256 + AES-128-GCM, one record, 4096 bytes.
//
// The crypto functions are pure (bytes in, bytes out) so scripts/push-selftest.mjs
// can check them against an independent node:crypto implementation. Delivery
// (sendPushToAll) is best-effort: it never throws, so it can run in waitUntil.

const VAPID_SETTING_KEY = 'vapid_jwk';
const VAPID_SUBJECT = 'mailto:support@yammbo.com';
const RECORD_SIZE = 4096;
const PUSH_TTL_SECONDS = 3600;
const JWT_LIFETIME_SECONDS = 12 * 3600;
// 16 (salt) + 4 (rs) + 1 (idlen) + 65 (keyid) header, 16 GCM tag, 1 delimiter byte.
const MAX_PLAINTEXT = RECORD_SIZE - 16 - 1;

const enc = new TextEncoder();

export interface PushEnv {
  DB?: D1Database;
  CHAT_SESSIONS?: KVNamespace;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  // 'high' asks the push service to deliver at once (used for "wants a person").
  // It travels as an HTTP header, not inside the encrypted payload.
  urgency?: 'high';
}

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidKeys {
  privateJwk: JsonWebKey;
  publicKey: string; // raw uncompressed P-256 point, base64url (the applicationServerKey)
}

// base64url ------------------------------------------------------------------

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// VAPID ----------------------------------------------------------------------

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  return { privateJwk, publicKey: b64urlEncode(raw) };
}

// ES256 JWT. WebCrypto's ECDSA signature is already the raw r||s form JWS wants.
export async function signVapidJwt(audience: string, privateJwk: JsonWebKey, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud: audience, exp: nowSec + JWT_LIFETIME_SECONDS, sub: VAPID_SUBJECT })));
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)));
  return `${header}.${claims}.${b64urlEncode(sig)}`;
}

export function vapidAuthHeader(jwt: string, publicKey: string): string {
  return `vapid t=${jwt}, k=${publicKey}`;
}

// RFC 8291 encryption -------------------------------------------------------

export interface EncryptOptions {
  // Test hooks: production leaves both undefined (random salt, fresh ephemeral key).
  salt?: Uint8Array;
  ephemeral?: CryptoKeyPair;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

// Returns the complete request body: salt(16) | rs(4, BE) | idlen(1) | keyid(65) | ciphertext.
export async function encryptPayload(
  plaintext: Uint8Array,
  p256dh: string,
  auth: string,
  opts: EncryptOptions = {},
): Promise<Uint8Array> {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error('push payload too large');
  const uaPublic = b64urlDecode(p256dh);
  const authSecret = b64urlDecode(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('invalid p256dh');
  if (authSecret.length !== 16) throw new Error('invalid auth secret');

  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const eph = opts.ephemeral ?? ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', eph.publicKey)) as ArrayBuffer);

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // The runtime property is `public`; workers-types spells it `$public`, hence the cast.
  const ecdhParams = { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams, eph.privateKey, 256));

  // IKM = HKDF(salt=auth_secret, ikm=ecdh, info="WebPush: info\0" || ua_public || as_public)
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // Single, last record: data || 0x02 (padding delimiter of the final record).
  const record = concat(plaintext, new Uint8Array([2]));
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, record));

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE, false);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

// Delivery ----------------------------------------------------------------------

let vapidCache: VapidKeys | null = null;

// The key pair is created the first time anything needs it and kept in D1
// (settings table), so subscriptions (bound to the public key) survive deploys.
// Two isolates can race here: both generate, INSERT OR IGNORE keeps the first
// row, and everybody then uses what D1 holds, never their own fresh pair.
export async function getVapidKeys(db: D1Database | undefined): Promise<VapidKeys | null> {
  if (vapidCache) return vapidCache;
  if (!db) return null;
  const read = async () =>
    (await db.prepare('SELECT value FROM settings WHERE key = ?').bind(VAPID_SETTING_KEY).first<{ value: string }>())?.value ?? null;
  let raw = await read();
  if (!raw) {
    await db
      .prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
      .bind(VAPID_SETTING_KEY, JSON.stringify(await generateVapidKeys()))
      .run();
    raw = await read();
  }
  if (!raw) return null;
  const stored = JSON.parse(raw) as VapidKeys;
  if (!stored.privateJwk || !stored.publicKey) throw new Error('stored VAPID keys are malformed');
  vapidCache = stored;
  return stored;
}

export interface PushSendResult {
  status: number; // HTTP status of the push service, 0 on network/encryption failure
  gone: boolean; // 404/410: the subscription is dead
}

export async function sendWebPush(sub: PushSubscriptionRow, payload: PushPayload, vapid: VapidKeys): Promise<PushSendResult> {
  try {
    const { urgency, ...message } = payload;
    const body = await encryptPayload(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
    const audience = new URL(sub.endpoint).origin;
    const jwt = await signVapidJwt(audience, vapid.privateJwk);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization: vapidAuthHeader(jwt, vapid.publicKey),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(PUSH_TTL_SECONDS),
        ...(urgency ? { urgency } : {}),
      },
      body,
    });
    await res.body?.cancel().catch(() => {});
    return { status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch (e) {
    console.error('web push failed:', (e as Error)?.message);
    return { status: 0, gone: false };
  }
}

// Sends to every stored subscription and drops the ones the push service says
// are gone. Never throws.
export async function sendPushToAll(env: PushEnv, payload: PushPayload): Promise<void> {
  try {
    if (!env.DB) return;
    const subs = (await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subs LIMIT 50').all<PushSubscriptionRow>()).results;
    if (!subs.length) return;
    const vapid = await getVapidKeys(env.DB);
    if (!vapid) return;
    const safe: PushPayload = { title: payload.title.slice(0, 100), body: payload.body.slice(0, 240), url: payload.url.slice(0, 200), urgency: payload.urgency };
    const results = await Promise.all(subs.map((s) => sendWebPush(s, safe, vapid)));
    const dead = subs.filter((_, i) => results[i].gone);
    if (dead.length) {
      await env.DB.batch(dead.map((s) => env.DB!.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(s.endpoint)));
    }
  } catch (e) {
    console.error('sendPushToAll failed:', (e as Error)?.message);
  }
}
