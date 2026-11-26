// Drives the real Listen together code (src/js/social.js) against a simulated
// player and session: sync, the shared queue, guest controls, taking turns,
// upvotes, host take-over and what the host publishes. Run: node scripts/jam_test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(join(repo, 'src/js/social.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

// ---- a simulated player -------------------------------------------------
const ME = '00000000-0000-0000-0000-0000000000b0';
const HOST = '00000000-0000-0000-0000-0000000000a0';
const player = { key: null, status: 'idle', pos: 0, t: Date.now(), nudge: 0, loadMs: 300, seekMs: 150, log: [], queue: [], current: null, uid: 1, fail: false };
function ppos() { return player.status === 'playing' ? player.pos + ((Date.now() - player.t) / 1000) * (1 + player.nudge / 1000) : player.pos; }
function settle() { player.pos = ppos(); player.t = Date.now(); }
const mk = (t) => ({ uid: player.uid++, track: t, platform: null });
const calls = {
  get_playback_state: () => ({ status: player.status, position: ppos(), current: player.key ? { track: { key: player.key, title: player.key, versions: [{ platform: 'soundcloud', url: `s:${player.key}` }, { platform: 'youtube', url: `u:${player.key}` }] } } : null, version: player.key ? { url: `u:${player.key}` } : null }),
  set_sync_nudge: ({ thousandths }) => { settle(); player.nudge = thousandths; },
  clear_queue: () => { player.queue = []; player.current = null; },
  play_track: ({ track }) => {
    player.log.push(`play ${track.key} v=${track.versions.length}`);
    settle(); player.key = track.key; player.status = 'loading'; player.pos = 0;
    setTimeout(() => { if (player.key === track.key) { if (player.fail) { player.status = 'error'; } else { player.status = 'playing'; player.pos = 0; player.t = Date.now(); } } }, player.loadMs);
  },
  pause: () => { settle(); if (player.status === 'playing') player.status = 'paused'; player.log.push('pause'); },
  resume: () => { settle(); if (player.status === 'paused') { player.status = 'playing'; player.t = Date.now(); } player.log.push('resume'); },
  seek: ({ position }) => { player.log.push(`seek ${position.toFixed(2)}`); settle(); const was = player.status; player.pos = position; if (was === 'playing') { player.status = 'playing'; player.t = Date.now() + player.seekMs; player.pos = position; } },
  prefetch_track: ({ track }) => { player.log.push(`prefetch ${track.key}`); return true; },
  get_queue: () => ({ items: player.queue, current: player.current }),
  add_to_queue: ({ tracks }) => { for (const t of tracks) player.queue.push(mk(t)); },
  reorder_queue: ({ from, to }) => { const [it] = player.queue.splice(from, 1); player.queue.splice(to, 0, it); },
  remove_from_queue: ({ uid }) => { player.queue = player.queue.filter((i) => i.uid !== uid); },
  play_index_cmd: ({ index }) => { player.log.push(`playindex ${index}`); player.current = index; },
  next_track: () => { player.log.push('next'); },
};
const dbLog = [];
const env = {
  cloud: { session: { user_id: ME, name: 'Me', avatar: null }, clockOffset: 0, cfg: {} },
  state: { queue: { items: [], current: null }, panel: 'together' },
  call: async (cmd, args) => { if (!calls[cmd]) throw new Error(`no ${cmd}`); return calls[cmd](args || {}); },
  db: async (method, path, body) => { dbLog.push([method, path, body]); return method === 'GET' ? [] : null; },
  rpc: async (fn, args) => { dbLog.push(['RPC', fn, args]); return env.rpcResult; },
  rpcResult: true,
  serverNow: () => Date.now(),
  syncServerClock: () => {},
  toast: (m) => { env.toasts.push(m); },
  toasts: [],
  $: () => null,
  onCloudChange: () => {},
  listen: () => {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  UUID_RE: /^[0-9a-f-]{36}$/,
  fromCloudTrack: (t) => ({ ...t, versions: t.versions || [] }),
  slimTrack: (t) => ({ key: t.key, title: t.title, artist: t.artist || '', versions: t.versions || [] }),
  errMsg: (e) => String(e?.message || e),
};
Object.defineProperty(env.state, 'playback', { get: () => ({ status: player.status, position: ppos(), current: player.key ? { track: { key: player.key } } : null }) });
const passthrough = new Set(['Math', 'JSON', 'Date', 'Promise', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Number', 'String', 'Array', 'Object', 'Map', 'Set', 'Error', 'console', 'crypto', 'Uint8Array', 'Boolean', 'RegExp', 'encodeURIComponent', 'decodeURIComponent', 'isFinite', 'parseInt', 'parseFloat', 'performance', 'undefined', 'NaN', 'Infinity', 'Symbol', 'Reflect', 'WeakMap', 'Intl', 'escape', 'unescape', 'btoa', 'atob']);
const stub = () => stub;
const scope = new Proxy(env, {
  has: (t, k) => typeof k === 'string' && !passthrough.has(k),
  get: (t, k) => (k in t ? t[k] : k === Symbol.unscopables ? undefined : stub),
  set: (t, k, v) => { t[k] = v; return true; },
});
const exportsList = 'jam,freshJam,takeRemote,onHostBroadcast,guestSync,backInSync,placeByTurns,applyUpvotes,runQueueControl,addJamEvent,watchHost,jamTarget,sessionUpcoming,publishJamState';
const wrapped = new Function('scope', `with (scope) { return (function () { ${code}\n; return { get jam() { return jam; }, set jam(v) { jam = v; }, ${exportsList.split(',').slice(1).join(',')} }; })(); }`);
// renderTogether/paintJamButton touch the DOM: no-ops here.
const S = wrapped(scope);

// ---- helpers --------------------------------------------------------------
const track = (key) => ({ key, title: key, artist: 'A', versions: [{ platform: 'youtube', url: `u:${key}` }, { platform: 'soundcloud', url: `s:${key}` }] });
function guestSession() {
  const j = S.freshJam();
  j.code = 'testcode123'; j.row = { host: HOST, guest_controls: false, take_turns: false }; j.host = false;
  j.channel = { broadcast() {}, track() {}, close() {} };
  S.jam = j;
  return j;
}
function hostState(key, position, playing = true, extra = {}) { return { v: 2, track: track(key), playing, loading: false, position, at: Date.now(), upcoming: [], next: null, ...extra }; }
async function ticks(n, ms = 1000) { for (let i = 0; i < n; i++) { await S.guestSync(); await sleep(ms); } }
const drift = () => Math.abs(S.jamTarget() - ppos());

// ---- 1. join: plays the exact recording, lands at the host's position -----
{
  guestSession();
  Object.assign(player, { key: 'mine', status: 'playing', pos: 50, t: Date.now(), nudge: 0, log: [] });
  S.jam.expectKey = null;
  S.takeRemote(hostState('song1', 30), null);
  await sleep(1500);
  ok(player.key === 'song1', `join: plays the host's song (${player.key})`);
  ok(player.log.some((l) => l === 'play song1 v=1'), 'join: exact recording only (1 version sent)');
  await ticks(2, 300);
  ok(drift() < 0.35, `join: close after loading (gap ${drift().toFixed(3)} s)`);
}
// ---- 2. a small gap closes by nudging, without a seek --------------------
{
  settle(); player.pos -= 0.4; // 400 ms behind
  player.log = [];
  await S.guestSync();
  ok(player.nudge > 0, `behind by 0.4 s: plays faster (nudge ${player.nudge}‰)`);
  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && drift() > 0.03) await ticks(1, 500);
  ok(drift() <= 0.03, `gap closed by nudging in ${((Date.now() - t0) / 1000).toFixed(1)} s (gap ${(drift() * 1000).toFixed(0)} ms)`);
  ok(!player.log.some((l) => l.startsWith('seek')), 'no seek for a small gap');
  for (let i = 0; i < 10 && player.nudge !== 0; i++) await ticks(1, 500);
  ok(player.nudge === 0 && drift() < 0.03, `back to normal speed once in sync (${player.nudge}, ${(drift() * 1000).toFixed(0)} ms)`);
  settle(); player.pos += 0.3; // ahead
  await S.guestSync();
  ok(player.nudge < 0, `ahead by 0.3 s: plays slower (${player.nudge}‰)`);
}
// ---- 3. a big gap: one seek ------------------------------------------------
{
  settle(); player.pos -= 3; player.log = [];
  await S.guestSync();
  ok(player.log.filter((l) => l.startsWith('seek')).length === 1, 'behind by 3 s: one seek');
  await S.guestSync();
  ok(player.log.filter((l) => l.startsWith('seek')).length === 1, 'no second seek straight after');
  await ticks(3, 400);
  ok(drift() < 0.3, `after the seek: close (${drift().toFixed(3)} s)`);
}
// ---- 4. host pauses / resumes: guest follows, not "away" -------------------
{
  S.takeRemote({ ...S.jam.remote, playing: false, position: S.jamTarget(), at: Date.now() }, null);
  await sleep(50); await S.guestSync();
  ok(player.status === 'paused', 'host paused: guest paused');
  S.takeRemote({ ...S.jam.remote, playing: true, at: Date.now() }, null);
  await sleep(50); await S.guestSync(); await S.guestSync();
  ok(player.status === 'playing' && !S.jam.away, `host resumed: guest plays, not away (${player.status}, away=${S.jam.away})`);
}
// ---- 5. guest pauses: paused just for them; back in sync -------------------
{
  calls.pause();
  await S.guestSync();
  ok(S.jam.away === 'paused', 'guest pressed pause: paused just for them');
  await ticks(2, 200);
  ok(player.status === 'paused', 'the session leaves them paused');
  S.backInSync();
  await sleep(200); await ticks(2, 300);
  ok(!S.jam.away && player.status === 'playing' && drift() < 0.5, `Back in sync: playing again near the host (${drift().toFixed(3)} s)`);
}
// ---- 6. guest plays something else: left alone ----------------------------
{
  calls.play_track({ track: { key: 'other', versions: [] } });
  await sleep(400);
  await S.guestSync();
  ok(S.jam.away === 'other', 'guest picked another song: left alone');
  await ticks(2, 200);
  ok(player.key === 'other', 'their song keeps playing');
  S.backInSync(); await sleep(1500); await ticks(1, 200);
  ok(player.key === 'song1' && !S.jam.away, 'Back in sync: the session song again');
}
// ---- 7. host changes song over the live channel ---------------------------
{
  player.log = [];
  S.onHostBroadcast({ from: HOST, key: 'song2', playing: true, loading: false, position: 0.5, at: Date.now(), track: track('song2'), next: track('song3') });
  await sleep(1300); await ticks(2, 300);
  ok(player.key === 'song2', 'new song from the live channel, before the database');
  ok(player.log.includes('prefetch song3'), 'the next song is prepared ahead');
  S.onHostBroadcast({ from: 'someone-else', key: 'evil', playing: true, position: 0, at: Date.now(), track: track('evil') });
  await sleep(100);
  ok(S.jam.remote.track.key === 'song2', 'a broadcast not from the host is ignored');
  // An older database row doesn't move the position back.
  const newer = S.jam.remote.at;
  S.takeRemote({ ...hostState('song2', 0.1), at: newer - 5000 }, null);
  ok(S.jam.remote.at === newer, 'an older database copy keeps the newer live position');
}
// ---- 8. a recording that won't play here: any other one -------------------
{
  player.fail = true; player.log = [];
  S.takeRemote(hostState('song4', 10), null);
  await sleep(14000);
  player.fail = false;
  await sleep(6000); await ticks(1, 1500);
  ok(player.log.some((l) => l === 'play song4 v=1') && player.log.some((l) => l === 'play song4 v=2'), `exact recording failed: retried with every recording (${player.log.filter((l) => l.startsWith('play')).join(', ')})`);
  ok(player.status === 'playing' && player.key === 'song4', 'and it plays');
}
// ---- 9. take turns ----------------------------------------------------------
{
  const j = S.freshJam(); j.code = 'x'; j.host = true; j.row = { host: ME, take_turns: true }; j.channel = { broadcast() {}, track() {}, close() {} }; S.jam = j;
  const A = 'aaaaaaaa-0000-0000-0000-000000000000', B = 'bbbbbbbb-0000-0000-0000-000000000000';
  player.queue = [mk(track('now'))]; player.current = 0;
  const add = async (k, by) => { j.addedBy.set(k, by); player.queue.push(mk(track(k))); await S.placeByTurns(k, by); };
  await add('a1', A); await add('a2', A); await add('a3', A); await add('b1', B); await add('b2', B); await add('m1', ME);
  const order = player.queue.slice(1).map((i) => i.track.key).join(' ');
  ok(order === 'a1 b1 m1 a2 b2 a3', `take turns interleaves: ${order}`);
}
// ---- 10. upvotes: most votes plays next -------------------------------------
{
  const j = S.freshJam(); j.code = 'x'; j.host = true; j.row = { host: ME, take_turns: false }; j.channel = { broadcast() {}, track() {}, close() {} }; S.jam = j;
  player.queue = [mk(track('now')), mk(track('x1')), mk(track('x2')), mk(track('x3'))]; player.current = 0;
  S.addJamEvent({ kind: 'upvote', user_id: 'u1', payload: { key: 'x3' } }, true);
  await sleep(100);
  ok(player.queue[1].track.key === 'x3', `upvoted song moves up next (${player.queue.map((i) => i.track.key).join(' ')})`);
  S.addJamEvent({ kind: 'upvote', user_id: 'u2', payload: { key: 'x2' } }, true);
  await sleep(100);
  ok(player.queue[1].track.key === 'x3', 'a tie keeps the current next song');
}
// ---- 11. guest controls only when allowed -----------------------------------
{
  const j = S.jam; player.log = [];
  player.queue = [mk(track('now')), mk(track('y1')), mk(track('y2'))]; player.current = 0;
  await S.runQueueControl({ user_id: 'g', payload: { op: 'remove', key: 'y1' } });
  ok(player.queue.length === 3, 'guest controls off: a guest can’t remove');
  j.row.guest_controls = true;
  await S.runQueueControl({ user_id: 'g', payload: { op: 'remove', key: 'y1' } });
  ok(player.queue.map((i) => i.track.key).join(' ') === 'now y2', 'guest controls on: removed');
  await S.runQueueControl({ user_id: 'g', payload: { op: 'skip' } });
  ok(player.log.includes('next'), 'guest skip');
  await S.runQueueControl({ user_id: 'g', payload: { op: 'remove', key: 'now' } });
  ok(player.queue.length === 2, 'the playing song can’t be removed');
}
// ---- 12. the host vanishes: the longest-present guest takes over ------------
{
  const j = guestSession();
  j.peopleReady = true;
  j.people = [{ key: ME }, { key: 'zzzzzzzz-0000-0000-0000-000000000000' }];
  j.joinedAt.set(ME, 1000); j.joinedAt.set('zzzzzzzz-0000-0000-0000-000000000000', 2000);
  j.row.host_seen = new Date(Date.now() - 60000).toISOString();
  dbLog.length = 0;
  S.watchHost();
  ok(!dbLog.some((d) => d[1] === 'jam_claim_host'), 'host gone just now: wait');
  j.hostGoneSince = Date.now() - 21000;
  S.watchHost();
  await sleep(20);
  ok(dbLog.some((d) => d[1] === 'jam_claim_host'), 'host gone 21 s, silent 60 s: the first guest claims');
  const k = guestSession(); k.peopleReady = true;
  k.people = [{ key: ME }, { key: 'aaaaaaaa-0000-0000-0000-000000000001' }];
  k.joinedAt.set(ME, 5000); k.joinedAt.set('aaaaaaaa-0000-0000-0000-000000000001', 1000);
  k.row.host_seen = new Date(Date.now() - 60000).toISOString();
  k.hostGoneSince = Date.now() - 21000; dbLog.length = 0;
  S.watchHost();
  ok(!dbLog.some((d) => d[1] === 'jam_claim_host'), 'the second guest waits 5 s longer');
  k.people.push({ key: HOST }); k.hostGoneSince = Date.now() - 60000;
  S.watchHost();
  ok(!dbLog.some((d) => d[1] === 'jam_claim_host') && k.hostGoneSince === 0, 'host back: nobody claims');
}

// ---- 13. the host publishes: live every 2 s, database on changes and every 10 s ----
{
  const sent = [];
  const j = S.freshJam(); j.code = 'hostcode1'; j.host = true; j.row = { host: ME }; S.jam = j;
  j.channel = { broadcast: (ev, m) => sent.push([ev, m]), track() {}, close() {} };
  Object.assign(player, { key: 'h1', status: 'playing', pos: 12, t: Date.now(), nudge: 0 });
  env.state.queue = { items: [{ uid: 1, track: track('h1') }, { uid: 2, track: track('h2') }], current: 0 };
  j.addedBy.set('h2', 'cccccccc-0000-0000-0000-000000000000');
  j.upvotes.set('h2', new Set(['x', 'y']));
  dbLog.length = 0;
  await S.publishJamState(false);
  const w = dbLog.filter((d) => d[0] === 'PATCH');
  ok(w.length === 1 && w[0][2].state.track.key === 'h1' && w[0][2].state.v === 2, 'first publish: written to the session');
  const st = w[0][2].state;
  ok(st.upcoming[0].key === 'h2' && st.upcoming[0].votes === 2 && st.upcoming[0].by === 'cccccccc-0000-0000-0000-000000000000', 'the shared queue carries who added it and its votes');
  ok(st.track.versions[0].url === 'u:h1', 'the exact recording goes first');
  ok(Math.abs(st.position - 12) < 0.1 && Math.abs(st.at - Date.now()) < 500, 'position stamped with the time it was read');
  ok(sent.length === 1 && sent[0][0] === 'st' && sent[0][1].track, 'live channel: the full song on a change');
  dbLog.length = 0; sent.length = 0;
  await S.publishJamState(false);
  ok(dbLog.length === 0 && sent.length === 0, 'nothing new straight after: nothing sent');
  await sleep(2100);
  await S.publishJamState(false);
  ok(sent.length === 1 && !sent[0][1].track && dbLog.length === 0, 'after 2 s: a position over the live channel only');
  player.status = 'paused'; settle();
  await S.publishJamState(false);
  ok(dbLog.length === 1 && sent.some((m) => m[1].playing === false), 'a pause goes out at once, both ways');
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
