// Pure-function self-test for the live features: no Worker, no network.
//   node scripts/live-selftest.mjs
// - groupBySimilarity (Help Center gaps) with synthetic unit vectors
// - deviceLabel / clientSummary (Spanish device names in the team alerts, no "Otro · Otro")
// - normalizePattern / matchPattern (proactive rules) and parity of the widget's copy of the matcher
// - acceptProactive / purgeLive against a real (in-memory, local) D1 from miniflare
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
const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', d1Databases: { DB: 'selftest' } });
try {
  const DB = await mf.getD1Database('DB');
  for (const f of ['0001_init', '0002_panel', '0003_inbox', '0004_live']) {
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
} catch (e) {
  failed++; console.log('FAIL presence/D1 section -> ' + (e && e.stack || e));
} finally {
  await mf.dispose();
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
process.exit(failed ? 1 : 0);
