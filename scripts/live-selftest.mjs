// Pure-function self-test for the live features: no Worker, no network.
//   node scripts/live-selftest.mjs
// - groupBySimilarity (Help Center gaps) with synthetic unit vectors
// - deviceLabel / clientSummary (Spanish device names in the team alerts, no "Otro · Otro")
// - normalizePattern / matchPattern (proactive rules) and parity of the widget's copy of the matcher
// - acceptProactive / purgeLive / heartbeat (session_id) / listLiveMessages (visitor_seen_at) / shouldEmailVisitor / unseenReplies against a real (in-memory, local) D1 from miniflare
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

async function load(entry) {
  const out = await build({ entryPoints: [path.join(root, entry)], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log('ok   ' + name);
  else { failed++; console.log('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}

const gaps = await load('src/gaps.ts');
const trig = await load('src/triggers.ts');
const { WIDGET_JS } = await load('src/widget.ts');
const dev = await load('src/device.ts');

// --- alert wording (Telegram) ------------------------------------------------------------------
check('deviceLabel mobile/tablet/desktop', dev.deviceLabel('mobile') === 'Móvil' && dev.deviceLabel('tablet') === 'Tableta' && dev.deviceLabel('desktop') === 'Escritorio');
check('deviceLabel null/unknown', dev.deviceLabel(null) === null && dev.deviceLabel('tv') === 'tv');
check('clientSummary full', dev.clientSummary({ device: 'mobile', os: 'iOS', browser: 'Safari' }) === 'Móvil · iOS · Safari');
check('clientSummary omits "Otro"', dev.clientSummary({ device: 'desktop', os: 'Otro', browser: 'Otro' }) === 'Escritorio', dev.clientSummary({ device: 'desktop', os: 'Otro', browser: 'Otro' }));
check('clientSummary omits missing OS/browser', dev.clientSummary({ device: 'tablet', os: null, browser: 'Chrome' }) === 'Tableta · Chrome');
check('clientSummary all empty', dev.clientSummary({ device: null, os: null, browser: null }) === '');

// --- groupBySimilarity -------------------------------------------------------------------
// Three directions in 4-D; small noise inside each direction.
const dirs = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
const jitter = (v, k) => v.map((x, i) => x + (i === (k % 4) ? 0.05 * ((k % 3) - 1) : 0));
const vecs = [];
for (let k = 0; k < 4; k++) vecs.push(jitter(dirs[0], k + 1)); // 0..3 -> A
for (let k = 0; k < 3; k++) vecs.push(jitter(dirs[1], k + 1)); // 4..6 -> B
vecs.push(jitter(dirs[2], 1)); // 7 -> C (alone)
const g = gaps.groupBySimilarity(vecs, 0.82);
const sets = g.map((x) => x.indexes.slice().sort().join(','));
check('groups: 3 groups', g.length === 3, JSON.stringify(sets));
check('groups: A = 0,1,2,3', sets.includes('0,1,2,3'), JSON.stringify(sets));
check('groups: B = 4,5,6', sets.includes('4,5,6'), JSON.stringify(sets));
check('groups: C alone', sets.includes('7'), JSON.stringify(sets));
check('groups: every index exactly once', g.flatMap((x) => x.indexes).sort((a, b) => a - b).join(',') === '0,1,2,3,4,5,6,7');
check('groups: empty input', gaps.groupBySimilarity([], 0.82).length === 0);
const loose = gaps.groupBySimilarity([[1, 0], [0.8, 0.6]], 0.7); // cosine 0.8
const strict = gaps.groupBySimilarity([[1, 0], [0.8, 0.6]], 0.9);
check('groups: threshold decides (0.8 vs 0.7 / 0.9)', loose.length === 1 && strict.length === 2, loose.length + '/' + strict.length);
check('clampThreshold bounds', gaps.clampThreshold('0.1') === 0.6 && gaps.clampThreshold('2') === 0.95 && gaps.clampThreshold('x') === 0.82 && gaps.clampThreshold('0.855') === 0.86);
check('normalizeQuestion folds case/punctuation', gaps.normalizeQuestion('¿Cómo   pago?!') === gaps.normalizeQuestion('cómo pago'));

// --- pattern syntax ---------------------------------------------------------------------------
const N = trig.normalizePattern;
const canon = [
  ['yammbo.com/pos/', 'yammbo.com/pos'], ['YAMMBO.com/POS', 'yammbo.com/pos'], ['*/precios', '*/precios'],
  ['/precios', '*/precios'], ['web.yammbo.com', 'web.yammbo.com/'], ['www.yammbo.com/pos', 'yammbo.com/pos'], ['*', '*/'],
];
for (const [i, o] of canon) check('normalize ' + JSON.stringify(i) + ' -> ' + o, N(i) === o, String(N(i)));
const bad = ['example.com/pos', 'yammbo.com.evil.com', 'a*b.yammbo.com', '/pos/../x', '/pos?x=1', '/a b', '', '  ', 'yammbo.com/pos/*', 'https://yammbo.com/pos', 'x'.repeat(200), 5, null, 'yammbo.com/./a'];
for (const b of bad) check('reject ' + JSON.stringify(typeof b === 'string' ? b.slice(0, 30) : b), N(b) === null);

const cases = [
  ['yammbo.com/pos', 'https://yammbo.com/pos', true], ['yammbo.com/pos', 'https://yammbo.com/pos/', true],
  ['yammbo.com/pos', 'https://www.yammbo.com/pos/precios', true], ['yammbo.com/pos', 'https://yammbo.com/posts', false],
  ['yammbo.com/pos', 'https://yammbo.com/', false], ['yammbo.com/pos', 'https://web.yammbo.com/pos', false],
  ['*/precios', 'https://store.yammbo.com/precios/x', true], ['*/precios', 'https://store.yammbo.com/', false],
  ['web.yammbo.com/', 'https://web.yammbo.com/a/b', true], ['*/', 'https://tv.yammbo.com/x', true],
  ['*/pos', 'https://yammbo.com/POS', true], ['yammbo.com/pos/precios', 'https://yammbo.com/pos', false],
];
for (const [p, u, want] of cases) check('server match ' + p + ' vs ' + u, trig.matchPattern(p, u) === want);

// Parity: run the widget's own copy of the matcher on the same cases.
const a = WIDGET_JS.indexOf('function ruleMatch');
const b = WIDGET_JS.indexOf('function ruleText');
check('widget matcher found in WIDGET_JS', a > 0 && b > a);
const ruleMatch = new Function(WIDGET_JS.slice(a, b) + '\nreturn ruleMatch;')();
let parity = true;
for (const [p, u, want] of cases) {
  const url = new URL(u);
  if (ruleMatch(p, { hostname: url.hostname, pathname: url.pathname }) !== want) { parity = false; console.log('  widget differs on', p, u); }
}
check('widget matcher agrees with server on every case', parity);

// --- presence: accept + retention against a local D1 ----------------------------------------------
const presence = await load('src/presence.ts');
const inbox = await load('src/panel-inbox.ts');
const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', d1Databases: { DB: 'selftest' } });
try {
  const DB = await mf.getD1Database('DB');
  for (const f of ['0001_init', '0002_panel', '0003_inbox', '0004_live', '0005_visitor_seen']) {
    const sql = readFileSync(path.join(root, 'migrations', f + '.sql'), 'utf8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    for (const st of sql.split(';').map((x) => x.trim()).filter(Boolean)) await DB.prepare(st).run();
  }
  const env = { DB, IP_SALT: 'test-salt' };
  const req = () => new Request('https://chat.yammbo.com/api/proactive/accept', { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', 'cf-connecting-ip': '203.0.113.9' } });
  const now = 1_800_000_000_000;
  const PID = 'A'.repeat(22), PID2 = 'B'.repeat(22), SID = 's'.repeat(40), SID2 = 't'.repeat(40);
  const idx = await DB.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='presence'").all();
  check('no index on presence.last_seen (only the primary-key autoindex)', !(idx.results || []).some((r) => /last_seen/.test(r.name)), JSON.stringify(idx.results));

  // accept with the presence row gone and a live proactive_inbox row
  await DB.prepare('INSERT INTO proactive_inbox (id, presence_id, text, created_at, delivered_at) VALUES (?, ?, ?, ?, ?)').bind('m1', PID, 'Hola, soy del equipo', now - 600_000, now - 590_000).run();
  const gone = await DB.prepare('SELECT COUNT(*) AS n FROM presence WHERE presence_id = ?').bind(PID).first();
  const r1 = await presence.acceptProactive(env, req(), PID, SID, now);
  check('accept with presence row deleted -> 200', gone.n === 0 && r1.status === 200 && r1.data.messages.some((m) => m.role === 'agent' && m.content === 'Hola, soy del equipo'), JSON.stringify(r1));
  const conv1 = await DB.prepare('SELECT mode, status, unread FROM conversations WHERE id = ?').bind(SID).first();
  check('accept creates the conversation (human, open, unread 0)', conv1 && conv1.mode === 'human' && conv1.status === 'open' && conv1.unread === 0, JSON.stringify(conv1));
  const r1b = await presence.acceptProactive(env, req(), PID, SID, now + 1000);
  check('second accept of the same presence id -> 404', r1b.status === 404);
  const r1c = await presence.acceptProactive(env, req(), PID2, SID2, now);
  check('accept for an unknown presence id -> 404, no conversation made', r1c.status === 404 && !(await DB.prepare('SELECT 1 AS x FROM conversations WHERE id = ?').bind(SID2).first()));

  // unread is kept on an existing conversation
  await DB.prepare('UPDATE conversations SET unread = 3 WHERE id = ?').bind(SID).run();
  await DB.prepare('INSERT INTO proactive_inbox (id, presence_id, text, created_at) VALUES (?, ?, ?, ?)').bind('m2', PID, 'Otro mensaje', now + 5000).run();
  const r2 = await presence.acceptProactive(env, req(), PID, SID, now + 6000);
  const conv2 = await DB.prepare('SELECT unread, msg_count FROM conversations WHERE id = ?').bind(SID).first();
  check('accept on an existing conversation keeps unread (3 stays 3)', r2.status === 200 && conv2.unread === 3, JSON.stringify(conv2));

  // purgeLive: presence by last_seen, inbox 1 h after creation OR delivery, independent of presence
  await DB.prepare('DELETE FROM proactive_inbox').run();
  const ins = DB.prepare('INSERT INTO proactive_inbox (id, presence_id, text, created_at, delivered_at) VALUES (?, ?, ?, ?, ?)');
  await DB.batch([
    ins.bind('keep-new', PID2, 'x', now - 30 * 60_000, null),
    ins.bind('keep-delivered', PID2, 'x', now - 2 * 3600_000, now - 30 * 60_000),
    ins.bind('drop-old', PID2, 'x', now - 2 * 3600_000, null),
    ins.bind('drop-old-delivered', PID2, 'x', now - 3 * 3600_000, now - 90 * 60_000),
  ]);
  await DB.prepare("INSERT INTO presence (presence_id, url, first_seen, last_seen) VALUES ('stale', 'https://yammbo.com/', ?, ?), ('fresh', 'https://yammbo.com/', ?, ?)").bind(now - 3600_000, now - 16 * 60_000, now - 60_000, now - 10_000).run();
  await presence.purgeLive(env, now);
  const left = (await DB.prepare('SELECT id FROM proactive_inbox ORDER BY id').all()).results.map((r) => r.id);
  check('purgeLive keeps inbox < 1 h (created or delivered) without any presence row', left.join(',') === 'keep-delivered,keep-new', left.join(','));
  const pl = (await DB.prepare('SELECT presence_id FROM presence ORDER BY presence_id').all()).results.map((r) => r.presence_id);
  check('purgeLive drops presence older than 15 min, keeps the fresh one', pl.join(',') === 'fresh', pl.join(','));
  // heartbeat: session_id follows the conversation of the LAST beat (no stale link)
  const hbReq = () => new Request('https://chat.yammbo.com/api/presence', { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36' } });
  const HB = 'H'.repeat(22), HB2 = 'I'.repeat(22), HB3 = 'J'.repeat(22);
  const page = { url: 'https://yammbo.com/pos', title: 'POS' };
  const row = (pid) => DB.prepare('SELECT session_id, last_seen FROM presence WHERE presence_id = ?').bind(pid).first();
  const t0 = now + 10 * 60_000;
  await DB.prepare('INSERT INTO conversations (id, created_at, updated_at, mode, status) VALUES (?, ?, ?, ?, ?)').bind(SID2, t0, t0, 'human', 'open').run();
  await presence.heartbeat(env, hbReq(), { presenceId: HB, sessionId: SID2, ...page }, t0);
  let r = await row(HB);
  check('heartbeat with an existing sessionId (insert) -> session linked', r.session_id === SID2, JSON.stringify(r));
  await presence.heartbeat(env, hbReq(), { presenceId: HB, sessionId: SID2, ...page }, t0 + 30_000);
  r = await row(HB);
  check('heartbeat with the same sessionId (update) -> still linked', r.session_id === SID2, JSON.stringify(r));
  await presence.heartbeat(env, hbReq(), { presenceId: HB, ...page }, t0 + 60_000);
  r = await row(HB);
  check('heartbeat without sessionId (after "New conversation") -> session_id NULL, no stale link', r.session_id === null, JSON.stringify(r));
  await presence.heartbeat(env, hbReq(), { presenceId: HB2, sessionId: 'z'.repeat(40), ...page }, t0);
  r = await row(HB2);
  check('heartbeat with a made-up sessionId -> session_id NULL', r.session_id === null, JSON.stringify(r));
  const online = await presence.listOnline(env, t0 + 2000);
  check('listOnline still lists the visitors', online.status === 200 && online.data.items.length === 2 && online.data.items.some((i) => i.id === HB && i.sessionId === null), JSON.stringify(online.data.items.map((i) => i.id)));
  const SID3 = 'u'.repeat(40);
  await DB.prepare('INSERT INTO proactive_inbox (id, presence_id, text, created_at) VALUES (?, ?, ?, ?)').bind('m3', HB3, 'Hola de nuevo', t0).run();
  await presence.heartbeat(env, hbReq(), { presenceId: HB3, ...page }, t0);
  const r3 = await presence.acceptProactive(env, req(), HB3, SID3, t0 + 3000);
  r = await row(HB3);
  check('acceptProactive sets session_id on the presence row', r3.status === 200 && r.session_id === SID3, JSON.stringify(r));
  await presence.heartbeat(env, hbReq(), { presenceId: HB3, sessionId: SID3, ...page }, t0 + 33_000);
  r = await row(HB3);
  check('the next beat after accepting carries the sessionId and keeps the link', r.session_id === SID3, JSON.stringify(r));

  // visitor_seen_at: GET /api/messages?open=1 records what an open chat showed
  const live = await load('src/inbox.ts');
  await DB.exec('CREATE TABLE seen_writes (n INTEGER)');
  await DB.exec('CREATE TRIGGER seen_w AFTER UPDATE OF visitor_seen_at ON conversations BEGIN INSERT INTO seen_writes VALUES (1); END');
  const writes = async () => (await DB.prepare('SELECT COUNT(*) AS n FROM seen_writes').first()).n;
  const seenAt = async (id) => (await DB.prepare('SELECT visitor_seen_at AS v FROM conversations WHERE id = ?').bind(id).first()).v;
  const SP = 'p'.repeat(40), T = t0 + 3600_000;
  await DB.prepare('INSERT INTO conversations (id, created_at, updated_at, mode, status) VALUES (?, ?, ?, ?, ?)').bind(SP, T, T, 'human', 'open').run();
  const msg = DB.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)');
  await msg.bind('p-u0', SP, 'user', 'hola', T).run();
  await msg.bind('p-a1', SP, 'agent', 'primera', T + 1000).run();
  await msg.bind('p-sys', SP, 'system', 'sys', T + 1500).run();
  check('visitor_seen_at starts NULL', (await seenAt(SP)) === null);
  let w = await writes();
  let pl1 = await live.listLiveMessages(env, SP, 0, false);
  check('poll WITHOUT open returns the messages and does not change visitor_seen_at', pl1.messages.length === 2 && (await seenAt(SP)) === null && (await writes()) === w);
  pl1 = await live.listLiveMessages(env, SP, 0, true);
  check('poll with open=1 returning an agent message -> visitor_seen_at = its created_at', (await seenAt(SP)) === T + 1000, String(await seenAt(SP)));
  w = await writes();
  await live.listLiveMessages(env, SP, T + 1000 - 1500, true); // the 1.5 s overlap re-sends p-a1
  check('poll with open=1 re-sending an already seen message -> no write', (await writes()) === w && (await seenAt(SP)) === T + 1000);
  await live.listLiveMessages(env, SP, T + 5000, true);
  check('empty poll with open=1 -> no write', (await writes()) === w);
  await msg.bind('p-sys2', SP, 'system', 'sys2', T + 6000).run();
  await live.listLiveMessages(env, SP, T + 5000, true);
  check('poll with open=1 returning only a system line -> no write', (await writes()) === w && (await seenAt(SP)) === T + 1000);
  await msg.bind('p-a2', SP, 'agent', 'segunda', T + 8000).run();
  await live.listLiveMessages(env, SP, T + 7000, false);
  check('new agent message polled WITHOUT open -> visitor_seen_at unchanged', (await seenAt(SP)) === T + 1000);
  await live.listLiveMessages(env, SP, T + 7000, true);
  check('same message polled with open=1 -> visitor_seen_at moves to it (one write)', (await seenAt(SP)) === T + 8000 && (await writes()) === w + 1, String(await seenAt(SP)));
  check('unknown conversation -> null (open=1 changes nothing)', (await live.listLiveMessages(env, 'x'.repeat(40), 0, true)) === null);

  // shouldEmailVisitor(db, id, agentAt): seen / not seen / newer team message
  const SE = 'e'.repeat(40), E = T + 3600_000;
  await DB.prepare('INSERT INTO conversations (id, created_at, updated_at, mode, status) VALUES (?, ?, ?, ?, ?)').bind(SE, E, E, 'human', 'open').run();
  await msg.bind('e-a1', SE, 'agent', 'primera', E + 1000).run();
  const should = (agentAt) => inbox.shouldEmailVisitor(DB, SE, agentAt);
  check('shouldEmailVisitor: not seen (visitor_seen_at NULL) -> true', (await should(E + 1000)) === true);
  await DB.prepare('UPDATE conversations SET visitor_seen_at = ? WHERE id = ?').bind(E + 500, SE).run();
  check('shouldEmailVisitor: seen an older reply only -> true', (await should(E + 1000)) === true);
  await DB.prepare('UPDATE conversations SET visitor_seen_at = ? WHERE id = ?').bind(E + 1000, SE).run();
  check('shouldEmailVisitor: seen this reply (visitor_seen_at >= agentAt) -> false', (await should(E + 1000)) === false);
  await DB.prepare('UPDATE conversations SET visitor_seen_at = NULL WHERE id = ?').bind(SE).run();
  await msg.bind('e-a2', SE, 'agent', 'segunda', E + 9000).run();
  check('shouldEmailVisitor: a newer team message exists -> false (the last of the burst sends)', (await should(E + 1000)) === false);
  check('shouldEmailVisitor: the newest message of the burst, not seen -> true', (await should(E + 9000)) === true);

  // unseenReplies: only the replies after the visitor's last message and after visitor_seen_at
  const SR = 'r'.repeat(40), R = E + 3600_000;
  await DB.prepare('INSERT INTO conversations (id, created_at, updated_at, mode, status) VALUES (?, ?, ?, ?, ?)').bind(SR, R, R, 'human', 'open').run();
  await msg.bind('r-u', SR, 'user', 'q', R).run();
  for (let i = 1; i <= 3; i++) await msg.bind('r-a' + i, SR, 'agent', 'resp' + i, R + i * 1000).run();
  const ur = () => inbox.unseenReplies(DB, SR);
  check('unseenReplies: nothing seen -> all three, oldest first', (await ur()).join(',') === 'resp1,resp2,resp3', (await ur()).join(','));
  await DB.prepare('UPDATE conversations SET visitor_seen_at = ? WHERE id = ?').bind(R + 2000, SR).run();
  check('unseenReplies: the open chat showed up to resp2 -> only resp3', (await ur()).join(',') === 'resp3', (await ur()).join(','));
  await msg.bind('r-u2', SR, 'user', 'q2', R + 2500).run();
  check('unseenReplies: a visitor message (R+2500) after seen (R+2000) -> still only resp3', (await ur()).join(',') === 'resp3', (await ur()).join(','));
  await DB.prepare('UPDATE conversations SET visitor_seen_at = NULL WHERE id = ?').bind(SR).run();
  check('unseenReplies: no visitor_seen_at -> counted from the last visitor message (resp3 only)', (await ur()).join(',') === 'resp3', (await ur()).join(','));
  const SC = 'c'.repeat(40), C = R + 3600_000;
  await DB.prepare('INSERT INTO conversations (id, created_at, updated_at, mode, status) VALUES (?, ?, ?, ?, ?)').bind(SC, C, C, 'human', 'open').run();
  for (let i = 1; i <= 12; i++) await msg.bind('c-a' + i, SC, 'agent', 'r' + String(i).padStart(2, '0'), C + i * 1000).run();
  const capped = await inbox.unseenReplies(DB, SC);
  check('unseenReplies: at most 10, the newest, oldest first', capped.length === 10 && capped[0] === 'r03' && capped[9] === 'r12', capped.join(','));
} catch (e) {
  failed++; console.log('FAIL presence/D1 section -> ' + (e && e.stack || e));
} finally {
  await mf.dispose();
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
process.exit(failed ? 1 : 0);
