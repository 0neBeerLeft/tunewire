'use strict';

// ===========================================================================
// Social: account, privacy, sharing, shared & collaborative playlists (with
// sync status), Listen Together, friends and follow requests, notifications,
// profiles, comparing Wrapped. Accounts are Discord only.
// ===========================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const me = () => cloud.session?.user_id;

// Account ---------------------------------------------------------------------------
function avatarEl(src, name, cls = 'avatar') {
  const el = h('span', { class: cls, title: name || '' });
  const url = mediaUrl(src);
  if (url) el.append(h('img', { src: url, alt: '', 'data-px': 96, referrerpolicy: 'no-referrer', onerror: (e) => { e.target.remove(); el.textContent = (name || '?')[0].toUpperCase(); } }));
  else el.textContent = (name || '?')[0].toUpperCase();
  return el;
}

function paintAccountButton() {
  const b = $('#nav-account');
  if (!b) return;
  b.hidden = !cloudOn();
  b.replaceChildren(signedIn() ? avatarEl(cloud.session.avatar, cloud.session.name, 'avatar tb-avatar') : h('span', { html: icon('user') }));
  b.title = signedIn() ? `${cloud.session.name} · account` : 'Sign in';
  b.setAttribute('aria-label', b.title);
  // The bell: notifications while signed in, new releases otherwise.
  const bell = $('#nav-releases');
  const count = $('#notif-count');
  const on = signedIn();
  bell.classList.toggle('notif-mode', on);
  count.hidden = !(on && notif.unread);
  count.textContent = notif.unread ? String(Math.min(99, notif.unread)) : '';
  bell.title = on ? (notif.unread ? `Notifications · ${notif.unread} new` : 'Notifications') : 'New releases';
  bell.setAttribute('aria-label', bell.title);
}
onCloudChange(paintAccountButton);
onCloudChange(() => {
  if (state.view === 'settings') renderSettings();
  renderFriends();
  startNotifications();
  if (!signedIn() && jam.code) leaveJam({ silent: true });
});

$('#nav-account')?.addEventListener('click', (e) => {
  const anchor = e.currentTarget;
  if (!signedIn()) return requireAccount({ why: 'Sign in to Tunewire' });
  openMenu(anchor, [
    { label: cloud.session.name, heading: true },
    { label: notif.unread ? `Notifications (${notif.unread})` : 'Notifications', icon: 'bell', onClick: () => openNotifications() },
    { label: 'Your profile', icon: 'user', onClick: () => openProfile(cloud.session.user_id) },
    { label: 'Friends', icon: 'friends', onClick: () => showView('friends') },
    { label: 'Listen together', icon: 'headphones', onClick: () => showView('together') },
    'sep',
    { label: 'Sign out', icon: 'x', onClick: () => signOut() },
  ]);
});

async function signOut() {
  if (jam.code) await leaveJam({ silent: true });
  await call('cloud_sign_out').catch(() => {});
  cloud.session = null;
  cloud.profile = null;
  cloudChanged();
  toast('Signed out', 'info', 1500);
}

// Privacy ------------------------------------------------------------------------------
/** First run: ask before any error report is sent. */
function askPrivacyFirstRun() {
  if (!state.settings || state.settings.privacy_asked) return;
  const reports = h('input', { type: 'checkbox', checked: false });
  const cont = h('button', { class: 'btn primary countdown', onclick: async () => { if (cont.disabled) return; await updateSettings({ privacy_asked: true, error_reports: reports.checked }); m.close(); } }, 'Continue');
  const m = openModal({
    title: 'Before you start',
    closable: false,
    subtitle: 'Tunewire keeps your music and listening on this device. One question:',
    body: h('div', { class: 'privacy-list' },
      h('label', { class: 'setting' },
        h('div', { class: 'label' }, 'Send error reports', h('small', {}, 'When something breaks, send the developer the app version, operating system and the error, with your folder names and links removed. Nothing about your music is sent.')),
        h('span', { class: 'switch' }, reports, h('span')))),
    footer: [cont],
    onClose: () => { clearInterval(timer); if (!state.settings.privacy_asked) updateSettings({ privacy_asked: true, error_reports: false }); },
  });
  // Continue unlocks after a short countdown, so the question actually gets read.
  let left = 10;
  const paint = () => { cont.disabled = left > 0; cont.textContent = left > 0 ? `Continue (${left})` : 'Continue'; };
  paint();
  const timer = setInterval(() => { left--; paint(); if (left <= 0) clearInterval(timer); }, 1000);
}

/** After signing in (once): what friends may see. Everything starts private. */
function askCloudPrivacy(force = false) {
  if (!signedIn() || (!force && state.settings?.cloud_privacy_asked)) return;
  const activity = h('input', { type: 'checkbox', checked: !!cloud.profile?.share_activity });
  const wrapped = h('input', { type: 'checkbox', checked: cloud.profile?.share_wrapped !== false });
  const stats = h('input', { type: 'checkbox', checked: !!cloud.profile?.share_stats });
  const library = h('input', { type: 'checkbox', checked: state.settings?.sync_asked ? !!state.settings.sync_library : true });
  const page = h('input', { type: 'checkbox', checked: !!cloud.profile?.public_page });
  const row = (label, help, input) => h('label', { class: 'setting' }, h('div', { class: 'label' }, label, h('small', {}, help)), h('span', { class: 'switch' }, input, h('span')));
  const save = async () => {
    await saveCloudPrivacy({ share_activity: activity.checked, share_wrapped: wrapped.checked, share_stats: stats.checked, public_page: page.checked });
    await updateSettings({ cloud_privacy_asked: true });
    m.close();
    if (library.checked !== !!state.settings.sync_library || !state.settings.sync_asked) await setLibrarySync(library.checked);
  };
  const m = openModal({
    title: 'What friends can see',
    subtitle: 'People need your approval to follow you. Choose what approved followers see; you can change this any time in Settings → Account.',
    body: h('div', { class: 'privacy-list' },
      row('Share what I’m playing', 'Approved followers see your current song in their Friends panel.', activity),
      row('Share my listening', 'Your top artists and songs, recently played and minutes this week show on your profile for approved followers, and you join the friends’ leaderboard.', stats),
      row('Compare Wrapped with friends', 'Approved friends can compare their year in music with yours (only after you press “Compare”).', wrapped),
      row('Sync my library', 'Your playlists, Liked Songs, followed artists, look-and-sound settings and listening history on every device you sign in to, as private copies only you can see.', library),
      row('Public profile page', 'Anyone with your profile link sees a web page with your name, picture, bio, pinned songs, badges and public playlists (and top artists if you share your listening). Nice for a Discord bio.', page)),
    footer: [h('button', { class: 'btn primary', onclick: save }, 'Save')],
    onClose: () => { if (!state.settings.cloud_privacy_asked) updateSettings({ cloud_privacy_asked: true }); },
  });
}

async function saveCloudPrivacy(patch) {
  try {
    await db('PATCH', `profiles?id=eq.${me()}`, patch);
    cloud.profile = { ...(cloud.profile || {}), ...patch };
    if ('share_activity' in patch) {
      await updateSettings({ share_activity: patch.share_activity });
      if (!patch.share_activity) db('DELETE', `now_playing?user_id=eq.${me()}`).catch(() => {});
      else publishActivity(true);
    }
    if (patch.share_wrapped === false) db('DELETE', `wrapped?user_id=eq.${me()}`).catch(() => {});
    if (patch.share_stats === false) db('DELETE', `profile_stats?user_id=eq.${me()}`).catch(() => {});
    if (patch.share_stats) publishStats(true);
  } catch (e) { toast(errMsg(e), 'error'); }
}

function accountSettingsRows() {
  if (!cloudOn()) return [settingRow('Account', 'Online features (sharing, Listen Together, friends) aren’t available in this build.', h('span'))];
  if (!signedIn()) {
    return [settingRow('Account', 'Sign in with Discord to share playlists, make collaborative playlists, listen together and see what friends play. Everything else works without an account.',
      h('button', { class: 'btn small primary', onclick: () => requireAccount({ why: 'Sign in to Tunewire' }) }, 'Sign in with Discord'))];
  }
  const s = cloud.session;
  const toggle = (label, help, key) => {
    const input = h('input', { type: 'checkbox', checked: key === 'share_wrapped' ? cloud.profile?.share_wrapped !== false : !!cloud.profile?.[key] });
    input.addEventListener('change', () => saveCloudPrivacy({ [key]: input.checked }));
    return h('div', { class: 'setting' }, h('div', { class: 'label' }, label, h('small', {}, help)), h('label', { class: 'switch' }, input, h('span')));
  };
  const syncInput = h('input', { type: 'checkbox', checked: !!state.settings?.sync_library });
  syncInput.addEventListener('change', () => setLibrarySync(syncInput.checked));
  return [
    settingRow(h('span', { class: 'row-gap' }, avatarEl(s.avatar, s.name), s.name), 'Signed in with Discord.',
      h('div', { class: 'actions' },
        h('button', { class: 'btn small', onclick: async () => {
          const name = await promptModal({ title: 'Your name', label: 'Friends see this name.', value: s.name, okLabel: 'Save' });
          if (!name) return;
          try { await db('PATCH', `profiles?id=eq.${s.user_id}`, { name: name.slice(0, 40) }); cloud.session.name = name.slice(0, 40); cloudChanged(); toast('Name saved', 'ok', 1500); } catch (e) { toast(errMsg(e), 'error'); }
        } }, 'Change name'),
        h('button', { class: 'btn small', onclick: () => openProfile(s.user_id) }, 'Profile'), h('button', { class: 'btn small', onclick: signOut }, 'Sign out'))),
    h('div', { class: 'setting' }, h('div', { class: 'label' }, 'Sync my library', h('small', {}, 'Your playlists, Liked Songs, followed artists, look-and-sound settings and listening history on every device you sign in to. The online copies are private: only you can see them.')), h('label', { class: 'switch' }, syncInput, h('span'))),
    toggle('Share what I’m listening to', 'Approved followers see the song you’re playing in their Friends panel.', 'share_activity'),
    toggle('Share my listening', 'Top artists and songs, recently played and minutes this week on your profile (approved followers only), and the friends’ leaderboard.', 'share_stats'),
    toggle('Compare Wrapped with friends', 'Approved friends can compare their year with yours. Turning this off removes what you shared.', 'share_wrapped'),
    settingRow('Followers', 'Everyone who follows you needed your approval. See and remove followers on your profile.', h('button', { class: 'btn small', onclick: () => openProfile(s.user_id) }, 'Manage')),
  ];
}

// Sharing ---------------------------------------------------------------------------
function shareSong(track) {
  copyText(songLink(track));
  toast('Song link copied. Anyone can open it, even without Tunewire.', 'ok', 2500);
}

const PL_LINK = (id) => shareLink('p', id);
const INVITE_LINK = (code) => shareLink('c', code);
const JAM_LINK = (code) => shareLink('j', code);
const PROFILE_LINK = (id) => shareLink('u', id);

/**
 * Share a playlist (or change who can open it) and return its online id.
 * With library sync it's online already (private): this only opens it up.
 */
async function publishPlaylist(pl, { visibility, collaborative } = {}) {
  if (!(await requireAccount({ why: 'Sign in to share playlists' }))) return null;
  return syncTask(async () => {
    // Ask the backend: the page's copy may not know about a link made a moment ago.
    try { pl = (await call('list_playlists')).find((p) => p.id === pl.id) || pl; } catch { /* keep */ }
    if (pl.cloud_id && pl.cloud_role === 'owner') {
      const m = cloudMeta.get(pl.cloud_id) || {};
      const patch = {};
      if (visibility) patch.visibility = visibility;
      else if (m.visibility === 'private' && !m.collaborative && !collaborative) patch.visibility = 'unlisted';
      if (collaborative !== undefined) patch.collaborative = collaborative;
      if (collaborative && m.visibility === 'private' && !m.collaborative && !visibility) patch.visibility = 'unlisted';
      if (Object.keys(patch).length) {
        const row = await patchRow(pl.cloud_id, patch);
        if (row) rememberRow(row);
      }
      syncLocalSoon(0); // anything not sent yet
      return pl.cloud_id;
    }
    const row = await uploadPlaylist(pl, { visibility: visibility || 'unlisted', collaborative: !!collaborative });
    setSync(pl.id, 'synced');
    return row.id;
  });
}

async function sharePlaylist(pl) {
  try {
    const id = await publishPlaylist(pl);
    if (!id) return;
    copyText(PL_LINK(id));
    toast(`Link to “${pl.name}” copied. Changes you make are shared automatically.`, 'ok', 3500);
  } catch (e) { toast(errMsg(e), 'error'); }
}

async function makeCollaborative(pl) {
  try {
    const id = await publishPlaylist(pl, { collaborative: true });
    if (!id) return;
    const code = await rpc('playlist_invite', { pid: id });
    copyText(INVITE_LINK(code));
    toast('Invite link copied. Friends who open it can add, remove and reorder songs with you. Only send it to people you trust.', 'ok', 5000);
  } catch (e) { toast(errMsg(e), 'error'); }
}

async function resetInvite(pl) {
  if (!(await confirmModal({ title: 'Make a new invite link?', message: 'The old link stops working. People who already joined stay collaborators.', okLabel: 'New link' }))) return;
  try {
    copyText(INVITE_LINK(await rpc('rotate_playlist_invite', { pid: pl.cloud_id })));
    toast('New invite link copied', 'ok', 2500);
  } catch (e) { toast(errMsg(e), 'error'); }
}

async function setVisibility(pl, visibility) {
  try { await publishPlaylist(pl, { visibility }); toast({ public: 'Shown on your profile', unlisted: 'Anyone with the link can open it', private: 'Only you and collaborators can open it' }[visibility], 'ok', 2200); } catch (e) { toast(errMsg(e), 'error'); }
}

async function unsharePlaylist(pl) {
  if (!(await confirmModal({ title: 'Stop sharing?', message: 'The link stops working and collaborators lose access. Your playlist stays in Your Library.', okLabel: 'Stop sharing', danger: true }))) return;
  try {
    await syncTask(async () => {
      if (libSyncOn()) {
        // Still your synced copy: just private again, without the others.
        const row = await patchRow(pl.cloud_id, { visibility: 'private', collaborative: false });
        if (row) rememberRow(row);
        await db('DELETE', `playlist_members?playlist_id=eq.${pl.cloud_id}`);
        await rpc('rotate_playlist_invite', { pid: pl.cloud_id }).catch(() => {});
        paintSyncBadges(pl.id);
        return;
      }
      await db('DELETE', `playlists?id=eq.${pl.cloud_id}`);
      delete bases().pl[pl.cloud_id];
      syncSave();
      await call('set_playlist_cloud', { id: pl.id, cloudId: null, role: null });
      syncInfo.delete(pl.id);
    });
    if (state.view === 'playlist') renderPlaylistDetail();
    toast('No longer shared', 'info', 1800);
  } catch (e) { toast(errMsg(e), 'error'); }
}

/** Extra items for a playlist's ⋯ menu. */
function shareMenuItems(pl) {
  if (!cloudOn()) return [];
  // A private sync copy isn't shared: the menu offers sharing it.
  const linked = isShared(pl) ? pl.cloud_id : null;
  if (linked && pl.cloud_role !== 'owner') {
    return ['sep', { label: 'Copy link', icon: 'link', onClick: () => { copyText(PL_LINK(pl.cloud_id)); toast('Link copied', 'ok', 1500); } },
      { label: pl.cloud_role === 'editor' ? 'Leave collaborative playlist' : 'Unfollow', icon: 'x', onClick: () => leaveCloudPlaylist(pl) }];
  }
  const meta = cloudMeta.get(pl.cloud_id) || {};
  return ['sep',
    { label: linked ? 'Copy link' : 'Share link', icon: 'link', onClick: () => sharePlaylist(pl) },
    { label: meta.collaborative ? 'Copy invite link' : 'Make collaborative', icon: 'friends', onClick: () => makeCollaborative(pl) },
    meta.collaborative ? { label: 'New invite link (old one stops)', icon: 'refresh', onClick: () => resetInvite(pl) } : null,
    linked ? { label: 'Who can open it', heading: true } : null,
    linked ? { label: `${meta.visibility === 'public' ? '✓ ' : ''}Public (on your profile)`, onClick: () => setVisibility(pl, 'public') } : null,
    linked ? { label: `${!meta.visibility || meta.visibility === 'unlisted' ? '✓ ' : ''}Anyone with the link`, onClick: () => setVisibility(pl, 'unlisted') } : null,
    linked ? { label: `${meta.visibility === 'private' ? '✓ ' : ''}Only collaborators`, onClick: () => setVisibility(pl, 'private') } : null,
    linked ? { label: 'Stop sharing', icon: 'x', onClick: () => unsharePlaylist(pl) } : null,
  ].filter(Boolean);
}

// Leaving someone else's playlist (sync itself lives in sync.js).
async function leaveCloudPlaylist(pl) {
  try {
    await syncTask(async () => {
      await db('DELETE', `playlist_members?playlist_id=eq.${pl.cloud_id}&user_id=eq.${me()}`);
      delete bases().pl[pl.cloud_id];
      syncSave();
      await call('set_playlist_cloud', { id: pl.id, cloudId: null, role: null });
      syncInfo.delete(pl.id);
    });
    toast('Left. Your copy stays in Your Library.', 'info', 2200);
  } catch (e) { toast(errMsg(e), 'error'); }
}

// Opening links ---------------------------------------------------------------------
// Every kind of code has a fixed shape; anything else is refused before it
// gets near a database query. Links that change something (join a playlist
// or a session, play a song) ask first.
const LINK_CODES = {
  p: UUID_RE,
  u: UUID_RE,
  c: /^[0-9a-f]{24,64}$/,
  j: /^[a-z0-9]{8,24}$/,
  s: /^[A-Za-z0-9_-]{4,4000}$/,
};

/** tunewire://p/<id>, https://…/tunewire/#p=<id>, <share server>/p/<id> → {kind, code}. */
function parseShareLink(url) {
  const u = String(url).trim();
  let m = u.match(/^tunewire:\/\/([pcsju])\/([^?#\s/]+)\/?$/) || u.match(/^https:\/\/(?:0nebeerleft|worldcnc)\.github\.io\/tunewire\/?#([pcsju])=([^&\s]+)$/);
  const base = cloud.cfg?.share_url;
  if (!m && base && u.startsWith(`${base}/`)) m = u.slice(base.length).match(/^\/([pcsju])\/([^?#\s/]+)$/);
  if (!m) return null;
  let code = m[2];
  try { code = decodeURIComponent(code); } catch { return { kind: m[1], code: null }; }
  return { kind: m[1], code: LINK_CODES[m[1]].test(code) ? code : null };
}

// The same link can arrive more than once (the start-up link and the
// running-app event, a double click in the browser): handle it once.
const recentLinks = new Map();

/** Handled (true), or not one of our links (false). */
function handleShareLink(url) {
  const link = parseShareLink(url);
  if (!link) return false;
  const key = `${link.kind}:${link.code}`;
  const now = Date.now();
  if (now - (recentLinks.get(key) || 0) < 15000) return true;
  recentLinks.set(key, now);
  if (!link.code) { toast('That Tunewire link is broken or incomplete', 'error'); return true; }
  const { kind, code } = link;
  if (kind === 's') confirmSongLink(code);
  if (kind === 'p') openSharedPlaylist(code);
  if (kind === 'c') confirmJoinCollaborative(code);
  if (kind === 'j') confirmJoinJam(code);
  if (kind === 'u') openProfile(code);
  return true;
}
listen('deep-link', (e) => handleShareLink(e.payload));

function confirmSongLink(code) {
  let t;
  try { t = trackFromSongLink(code); } catch { toast('That song link is broken', 'error'); return; }
  const m = openModal({
    title: 'Play a shared song?',
    body: h('div', { class: 'link-sheet' },
      thumbEl(t.thumbnail, 'thumb big', t.key || t.title),
      h('div', {}, h('b', {}, t.title), h('div', { class: 'meta' }, t.artist || 'Unknown artist'),
        h('div', { class: 'link-sources' }, ...t.versions.map((v) => badge(v.platform, { short: true }))))),
    footer: [
      h('button', { class: 'btn', onclick: () => m.close() }, 'Not now'),
      h('button', { class: 'btn', onclick: () => { m.close(); enqueue([t]); } }, 'Add to queue'),
      h('button', { class: 'btn primary', autofocus: true, onclick: () => { m.close(); playTrack(t); } }, 'Play'),
    ],
  });
}

async function confirmJoinCollaborative(code) {
  const ok = await confirmModal({
    title: 'Join a collaborative playlist?',
    message: 'You were invited to edit a playlist together. Once you join, you can add, remove and reorder its songs, everyone in it sees your changes and your name, and it’s added to Your Library.',
    okLabel: 'Join playlist',
  });
  if (ok) joinCollaborative(code);
}

async function openSharedPlaylist(id) {
  const local = state.playlists.find((p) => p.cloud_id === id);
  if (local) return openPlaylist(local.id);
  if (!cloudOn()) return toast('Online features aren’t available in this build', 'warn');
  try {
    const rows = await db('GET', `playlists?id=eq.${id}&deleted_at=is.null&select=id,title,description,cover,tracks,owner,collaborative,visibility,version,profiles!playlists_owner_fkey(name,avatar)`);
    const row = rows[0];
    if (!row) return toast('This playlist isn’t shared anymore, or it’s private', 'warn');
    rememberRow(row);
    state.remote = { title: row.title, url: PL_LINK(row.id), platform: null, tracks: (row.tracks || []).map(fromCloudTrack), cloud: { id: row.id, owner: row.owner, ownerName: row.profiles?.name, ownerAvatar: row.profiles?.avatar, description: row.description, cover: row.cover } };
    state.remote.tracks = await call('apply_matches', { tracks: state.remote.tracks }).catch(() => state.remote.tracks);
    openPlaylist('remote');
  } catch (e) { toast(errMsg(e), 'error'); }
}

/** Follow a shared playlist: a local copy that keeps getting its updates. */
async function followShared(remote) {
  if (!(await requireAccount({ why: 'Sign in to follow playlists' }))) return;
  try {
    if (remote.cloud.owner !== me()) await db('POST', 'playlist_members', { playlist_id: remote.cloud.id, role: 'follower' }, { prefer: 'resolution=ignore-duplicates' }).catch(() => {});
    const pl = await call('create_playlist', { name: remote.title, tracks: remote.tracks, sourceUrl: null });
    await call('set_playlist_cloud', { id: pl.id, cloudId: remote.cloud.id, role: remote.cloud.owner === me() ? 'owner' : 'follower' });
    await refreshPlaylists({ silent: true });
    syncOneSoon(remote.cloud.id, 0);
    state.remote = null;
    openPlaylist(pl.id, { push: false });
    toast(`Following “${pl.name}”. You’ll get its updates.`, 'ok', 2500);
  } catch (e) { toast(errMsg(e), 'error'); }
}

let joiningPlaylist = null;
async function joinCollaborative(code) {
  if (joiningPlaylist === code) return;
  if (!(await requireAccount({ why: 'Sign in to join this playlist' }))) return;
  joiningPlaylist = code;
  try {
    const id = await rpc('join_playlist', { code });
    const existing = state.playlists.find((p) => p.cloud_id === id);
    if (existing) return openPlaylist(existing.id);
    const [row] = await db('GET', `playlists?id=eq.${id}&select=id,title,description,cover,tracks,owner,collaborative,visibility,version`);
    rememberRow(row);
    const pl = await call('create_playlist', { name: row.title, tracks: (row.tracks || []).map(fromCloudTrack), sourceUrl: null });
    await call('update_playlist_meta', { id: pl.id, patch: { description: row.description || '', cover: row.cover || '' } }).catch(() => {});
    await call('set_playlist_cloud', { id: pl.id, cloudId: id, role: 'editor' });
    await refreshPlaylists({ silent: true });
    syncOneSoon(id, 0);
    openPlaylist(pl.id);
    toast(`You joined “${row.title}”. Your changes show up for everyone.`, 'ok', 3000);
  } catch (e) { toast(errMsg(e), 'error'); } finally { joiningPlaylist = null; }
}

// Listen Together -----------------------------------------------------------------------
// The session is a database row only its host can change, so guests can't
// take over playback. Members are checked by the server; the host can hand
// over, remove people and approve suggested songs. Presence and reactions
// use a private Realtime channel only members can join.
const REACTIONS = ['🔥', '❤️', '😂', '🕺', '👏', '😮'];
const REACTION_NAMES = { '🔥': 'Fire', '❤️': 'Love', '😂': 'Haha', '🕺': 'Dance', '👏': 'Clap', '😮': 'Wow' };
const freshJam = () => ({
  code: null, row: null, host: false, channel: null, live: null, people: [], names: new Map(),
  chat: [], suggestions: [], votes: new Map(), remote: null, remoteAt: 0, applying: false,
  quality: 'waiting', lastSig: '', timers: [], reactedAt: new Map(),
  upvotes: new Map(),   // song key -> Set of who upvoted it
  addedBy: new Map(),   // host: song key -> who added it to the session
  joinedAt: new Map(),  // user id -> when they joined (ms)
  // Guest, out of step on purpose: 'paused' (paused just here) or 'other'
  // (playing something else). The session leaves them be until "Back in sync".
  away: null,
  pausedByUs: false, expectKey: null, nudge: 0, prefetched: '', lastSeek: 0, lastBroadcast: 0, lastError: 0,
  hostGoneSince: 0, claiming: false, peopleReady: false, sharedQ: '', ticking: false, publishing: false,
});
let jam = freshJam();
// The session you're in, so a restart (or a crash) brings you back to it.
const JAM_SAVED = 'tw-jam';
const jamWait = (ms) => new Promise((r) => setTimeout(r, ms));

function jamCode() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map((x) => a[x % a.length]).join('');
}

async function startJam() {
  if (jam.code) { openJamDock(); return; }
  if (!(await requireAccount({ why: 'Listen together' }))) return;
  const room = h('input', { type: 'checkbox', checked: false });
  const friends = h('input', { type: 'checkbox', checked: false });
  const approve = h('input', { type: 'checkbox', checked: true });
  const row = (label, help, input) => h('label', { class: 'setting' }, h('div', { class: 'label' }, label, h('small', {}, help)), h('span', { class: 'switch' }, input, h('span')));
  const m = openModal({
    title: 'Start listening together',
    subtitle: 'Everyone hears the same song at the same moment. You control playback; others can chat, suggest songs and vote to skip.',
    body: h('div', { class: 'privacy-list' },
      row('Use my room', 'Your own session link that stays the same every time.', room),
      row('Approve suggested songs', 'Songs guests suggest wait for you instead of going straight into your queue.', approve),
      row('Tell my followers', 'Approved followers get a notification and can join.', friends)),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', autofocus: true, onclick: async (e) => {
      e.target.disabled = true;
      try {
        const code = await rpc('open_jam', { new_code: jamCode(), make_persistent: room.checked, room_title: '', friends: friends.checked });
        if (!approve.checked) await db('PATCH', `jams?code=eq.${code}`, { approve_adds: false });
        m.close();
        await openJam(code);
        copyText(JAM_LINK(code));
        toast('Session started. Invite link copied: send it to friends.', 'ok', 4000);
      } catch (err) { e.target.disabled = false; toast(errMsg(err), 'error'); }
    } }, 'Start')],
  });
}

async function confirmJoinJam(code) {
  if (jam.code === code) { openJamDock(); return; }
  const ok = await confirmModal({
    title: 'Join a listening session?',
    message: 'Your player will follow what the host plays (your current song and queue stop). Others in the session see your Discord name. You can leave at any time.',
    okLabel: 'Join',
  });
  if (ok) joinJam(code);
}

async function joinJam(code) {
  if (!LINK_CODES.j.test(code)) { toast('That session code isn’t valid', 'error'); return; }
  if (!(await requireAccount({ why: 'Join the listening session' }))) return;
  if (jam.code) await leaveJam({ silent: true });
  try {
    await rpc('join_jam', { jam_code: code });
    await openJam(code);
    toast('Joined. You’ll hear what the host plays.', 'ok', 2500);
  } catch (e) { toast(errMsg(e), 'error'); }
}

async function openJam(code, { dock = true } = {}) {
  const [row] = await db('GET', `jams?code=eq.${code}&select=*`);
  if (!row || !row.active) throw { message: 'This session has ended' };
  jam = freshJam();
  jam.code = code;
  jam.row = row;
  jam.host = row.host === me();
  // A guest whose own song is paused: the first sync starts it, it isn't "paused for me".
  jam.pausedByUs = true;
  try { localStorage.setItem(JAM_SAVED, code); } catch { /* storage off */ }
  syncServerClock(3); // everyone lines up by this clock: measure it fresh
  jam.channel = new Channel(`jam:${code}`, { private: true, presenceKey: me() });
  jam.channel.track(myJamPresence());
  jam.channel.on('presence', (p) => {
    const before = jam.people.length;
    jam.people = presenceList(p);
    jam.peopleReady = true;
    for (const x of jam.people) if (x.name) jam.names.set(x.key, { name: x.name, avatar: x.avatar });
    if (jam.host && jam.people.length > before) publishJamState(true);
    paintJamButton(); // people count on the button and dock; re-renders the session
  });
  jam.channel.on('b:react', (m) => {
    // Only known reactions, at most a few a second per person.
    if (!REACTIONS.includes(m?.emoji)) return;
    const from = String(m.from || '').slice(0, 40);
    const last = jam.reactedAt.get(from) || 0;
    if (Date.now() - last < 300) return;
    jam.reactedAt.set(from, Date.now());
    floatReaction(m.emoji, from);
  });
  // The host's position, many times a minute (the database copy is the backup).
  jam.channel.on('b:st', onHostBroadcast);
  jam.channel.on('b:resync', (m) => {
    if (jam.host || jam.away || m?.from !== jam.row?.host) return;
    jam.lastSeek = 0;
    guestSync(true);
  });
  jam.live = new Channel(`jamdb:${code}`, { changes: [
    { event: '*', schema: 'public', table: 'jams', filter: `code=eq.${code}` },
    { event: '*', schema: 'public', table: 'jam_events', filter: `code=eq.${code}` },
    { event: 'DELETE', schema: 'public', table: 'jam_members', filter: `code=eq.${code}` },
  ] });
  jam.live.on('change', onJamChange);
  jam.live.on('status', (s) => { if (s === 'live') refreshJam(); });
  await refreshJam();
  jam.timers.push(setInterval(jamTick, 1000));
  paintJamButton();
  if (dock) openJamDock();
}

/** Back into the session this app was in when it closed. */
let jamRejoinTried = false;
onCloudChange(() => {
  if (jamRejoinTried || jam.code || !signedIn()) return;
  let code = null;
  try { code = localStorage.getItem(JAM_SAVED); } catch { /* storage off */ }
  if (!code || !LINK_CODES.j.test(code)) return;
  jamRejoinTried = true;
  (async () => {
    try {
      await rpc('join_jam', { jam_code: code });
      await openJam(code, { dock: false });
      toast('You’re back in your listening session', 'ok', 3000);
    } catch (e) {
      // Ended, or you were removed: forget it. Offline: try at the next start.
      if (e?.kind !== 'network' && e?.kind !== 'timeout') { try { localStorage.removeItem(JAM_SAVED); } catch { /* storage off */ } }
    }
  })();
});

/** Everything about the session, fetched (start, reconnect). */
async function refreshJam() {
  if (!jam.code) return;
  try {
    const [[row], members, events] = await Promise.all([
      db('GET', `jams?code=eq.${jam.code}&select=*`),
      db('GET', `jam_members?code=eq.${jam.code}&select=user_id,joined_at,profiles(name,avatar)`),
      db('GET', `jam_events?code=eq.${jam.code}&select=*&order=id.desc&limit=200`),
    ]);
    if (!row || !row.active) { endedByHost(); return; }
    if (!members.some((m) => m.user_id === me())) { removedFromJam(); return; }
    for (const m of members) {
      if (m.profiles) jam.names.set(m.user_id, m.profiles);
      jam.joinedAt.set(m.user_id, Date.parse(m.joined_at) || 0);
    }
    jam.chat = [];
    jam.suggestions = [];
    jam.votes = new Map();
    jam.upvotes = new Map();
    for (const e of events.reverse()) addJamEvent(e, false);
    applyJamRow(row);
  } catch { /* offline: the channel reconnects and calls this again */ }
  renderTogether();
}

function onJamChange(d) {
  if (!d || !jam.code) return;
  if (d.table === 'jams') {
    if (d.type === 'DELETE' || d.record?.active === false) { endedByHost(); return; }
    applyJamRow(d.record);
  }
  if (d.table === 'jam_events' && d.type === 'INSERT') addJamEvent(d.record, true);
  if (d.table === 'jam_events' && d.type === 'UPDATE') updateSuggestion(d.record);
  if (d.table === 'jam_members' && d.type === 'DELETE' && d.old_record?.user_id === me()) removedFromJam();
  renderTogether();
}

function applyJamRow(row) {
  if (!row) return;
  const wasHost = jam.host;
  jam.row = row;
  jam.host = row.host === me();
  if (jam.host && !wasHost) {
    jam.away = null;
    setNudge(0);
    toast('You’re the host now: the session follows what you play', 'info', 3500);
    publishJamState(true);
  }
  if (!jam.host && wasHost) toast('Someone else is hosting now', 'info', 2500);
  if (!jam.host && row.state) takeRemote(row.state, row.state_at);
  else if (!jam.host) { jam.remote = null; jam.quality = 'waiting'; }
  shareMyQuality(false);
  paintJamButton();
}

/** Guest: the host's state, from the database (or the live channel). */
function takeRemote(st, stateAt) {
  if (!st || typeof st !== 'object') return;
  // Hosts from before 2.5 don't stamp the time themselves: the server's stamp.
  const at = typeof st.at === 'number' ? st.at : stateAt ? Date.parse(stateAt) : serverNow();
  const cur = jam.remote;
  if (cur?.track && st.track && cur.track.key === st.track.key && (cur.at || 0) > at) {
    // A newer position came over the live channel: keep it, take the rest.
    jam.remote = { ...st, playing: cur.playing, loading: cur.loading, position: cur.position, at: cur.at };
  } else {
    jam.remote = { ...st, at };
  }
  jam.remoteAt = jam.remote.at;
  if (!jam.applying) guestSync();
  renderTogether();
}

function onHostBroadcast(m) {
  if (!jam.code || jam.host || !m || m.from !== jam.row?.host) return;
  if (typeof m.position !== 'number' || typeof m.at !== 'number' || !Number.isFinite(m.position)) return;
  const base = jam.remote || {};
  const timing = { playing: !!m.playing, loading: !!m.loading, position: Math.max(0, m.position), at: m.at };
  if (m.track && typeof m.track === 'object' && typeof m.track.key === 'string') {
    // A new song: start loading it now instead of waiting for the database.
    jam.remote = { ...base, ...timing, track: m.track, next: m.next || null };
  } else if (base.track && m.key === base.track.key) {
    if ((base.at || 0) > m.at) return; // older than what we have
    jam.remote = { ...base, ...timing };
  } else return;
  jam.remoteAt = jam.remote.at;
  if (!jam.applying) guestSync();
}

function nameOf(uid) {
  if (uid === me()) return 'You';
  const n = jam.names.get(uid);
  if (!n) fetchName(uid);
  return n?.name || 'Someone';
}
async function fetchName(uid) {
  if (!UUID_RE.test(uid) || jam.names.has(uid)) return;
  jam.names.set(uid, null);
  try { const [p] = await db('GET', `profiles?id=eq.${uid}&select=name,avatar`); if (p) { jam.names.set(uid, p); renderTogether(); } } catch { /* later */ }
}

function addJamEvent(e, live) {
  if (e.kind === 'chat') {
    jam.chat.push(e);
    if (jam.chat.length > 100) jam.chat.shift();
    if (live && e.user_id !== me() && state.panel !== 'together') toast(`${nameOf(e.user_id)}: ${e.payload.text}`, 'info', 3500);
  }
  if (e.kind === 'suggest') {
    jam.suggestions.push(e);
    if (live && jam.host && e.status === 'pending') {
      if (jam.row?.approve_adds === false) answerSuggestion(e, true);
      else toast(`${nameOf(e.user_id)} suggested “${e.payload?.track?.title || 'a song'}”`, 'info', 4000, { action: { label: 'Add', onClick: () => answerSuggestion(e, true) } });
    }
  }
  if (e.kind === 'vote_skip') {
    jam.votes.set(e.user_id, e.payload?.key);
    if (jam.host && live) checkSkipVotes();
  }
  if (e.kind === 'upvote') {
    const k = e.payload?.key;
    if (typeof k !== 'string' || !k) return;
    if (!jam.upvotes.has(k)) jam.upvotes.set(k, new Set());
    jam.upvotes.get(k).add(e.user_id);
    if (live && jam.host) applyUpvotes();
  }
  if (e.kind === 'control' && live && jam.host) runQueueControl(e);
}

function updateSuggestion(rec) {
  const s = jam.suggestions.find((x) => x.id === rec.id);
  if (s) s.status = rec.status;
  if (rec.user_id === me() && !jam.host) toast(rec.status === 'approved' ? `“${rec.payload?.track?.title || 'Your song'}” was added to the session` : `The host passed on “${rec.payload?.track?.title || 'your song'}”`, rec.status === 'approved' ? 'ok' : 'info', 2500);
}

async function answerSuggestion(e, approve) {
  try {
    if (approve) await addToSession(fromCloudTrack(e.payload.track), e.user_id);
    await db('PATCH', `jam_events?id=eq.${e.id}`, { status: approve ? 'approved' : 'rejected' });
    e.status = approve ? 'approved' : 'rejected';
    renderTogether();
  } catch (err) { toast(errMsg(err), 'error'); }
}

// The shared queue (host) ------------------------------------------------------------------

/** Host: add a song to the session's queue; taking turns, after the songs of people with fewer turns. */
async function addToSession(track, by) {
  jam.addedBy.set(track.key, by);
  await call('add_to_queue', { tracks: [track], next: false });
  if (jam.row?.take_turns) await placeByTurns(track.key, by).catch(() => {});
  publishJamState(true);
}

/**
 * Taking turns: each upcoming song has a round (how many songs its adder
 * already has ahead of it). A new song goes after the last song of a round
 * no later than its own, so everyone's picks alternate.
 */
async function placeByTurns(key, by) {
  const q = await call('get_queue');
  const cur = q.current ?? -1;
  const from = q.items.map((i) => i.track.key).lastIndexOf(key);
  if (from <= cur) return;
  const who = (i) => jam.addedBy.get(i.track.key) || jam.row?.host;
  const counts = new Map();
  const rounds = [];
  for (let i = cur + 1; i < from; i++) {
    const w = who(q.items[i]);
    const r = counts.get(w) || 0;
    counts.set(w, r + 1);
    rounds.push([i, r]);
  }
  const mine = counts.get(by) || 0;
  let at = cur + 1;
  for (const [i, r] of rounds) if (r <= mine) at = i + 1;
  if (at < from) await call('reorder_queue', { from, to: at });
}

/** Host: the most-upvoted song plays next (not while taking turns). */
let upvoteBusy = false;
async function applyUpvotes() {
  if (!jam.host || jam.row?.take_turns || upvoteBusy) return;
  upvoteBusy = true;
  try {
    const q = await call('get_queue');
    const cur = q.current ?? -1;
    const ups = q.items.slice(cur + 1);
    const n = (i) => jam.upvotes.get(ups[i].track.key)?.size || 0;
    let best = 0;
    for (let i = 1; i < ups.length; i++) if (n(i) > n(best)) best = i;
    if (best > 0) await call('reorder_queue', { from: cur + 1 + best, to: cur + 1 });
    publishJamState(true);
  } catch { /* the queue changed meanwhile */ }
  upvoteBusy = false;
}

/**
 * Host: change the queue for a guest (guest controls on) or for yourself.
 * Songs are named by key: indexes differ between apps.
 */
async function runQueueControl(e, own = false) {
  if (!own && !jam.row?.guest_controls) return;
  const { op, key, to } = e.payload || {};
  try {
    if (op === 'skip') {
      await call('next_track');
      if (!own) toast(`${nameOf(e.user_id)} skipped the song`, 'info', 2000);
    } else {
      const q = await call('get_queue');
      const cur = q.current ?? -1;
      const idx = q.items.findIndex((it, i) => i > cur && it.track.key === key);
      if (idx < 0) return;
      if (op === 'remove') await call('remove_from_queue', { uid: q.items[idx].uid });
      if (op === 'play') await call('play_index_cmd', { index: idx });
      if (op === 'move' && Number.isInteger(to)) await call('reorder_queue', { from: idx, to: Math.min(q.items.length - 1, cur + 1 + to) });
    }
    publishJamState(true);
  } catch { /* the queue changed meanwhile */ }
}

/** A queue change: done here by the host, asked for by a guest. */
function queueControl(op, key, to) {
  if (jam.host) { runQueueControl({ user_id: me(), payload: { op, key, to } }, true); return; }
  db('POST', 'jam_events', { code: jam.code, kind: 'control', payload: { op, ...(key ? { key } : {}), ...(Number.isInteger(to) ? { to } : {}) } })
    .catch((e) => toast(errMsg(e), 'error'));
}

function upvote(key) {
  if (!jam.code || jam.upvotes.get(key)?.has(me())) return;
  if (!jam.upvotes.has(key)) jam.upvotes.set(key, new Set());
  jam.upvotes.get(key).add(me());
  renderTogether();
  db('POST', 'jam_events', { code: jam.code, kind: 'upvote', payload: { key } })
    .catch((e) => { jam.upvotes.get(key)?.delete(me()); renderTogether(); toast(errMsg(e), 'error'); });
}

/** Guests other than the host who are here now. */
function jamGuests() { return jam.people.filter((p) => p.key !== jam.row?.host); }

function skipVotes() {
  const key = jam.host ? state.playback?.current?.track?.key : jam.remote?.track?.key;
  const n = [...jam.votes.entries()].filter(([uid, k]) => k === key && jamGuests().some((p) => p.key === uid)).length;
  const need = Math.max(1, Math.ceil(jamGuests().length / 2));
  return { key, n, need };
}
function checkSkipVotes() {
  const v = skipVotes();
  if (v.key && v.n >= v.need) {
    jam.votes.clear();
    call('next_track').catch(() => {});
    toast('Skipped by vote', 'info', 2000);
  }
}
async function voteSkip() {
  const key = jam.remote?.track?.key;
  if (!key) return;
  try { await db('POST', 'jam_events', { code: jam.code, kind: 'vote_skip', payload: { key } }); } catch (e) { toast(errMsg(e), 'error'); }
}

/** The songs coming up in the session (the host's queue). */
function sessionUpcoming() {
  if (jam.host) {
    const cur = state.queue.current ?? -1;
    return state.queue.items.slice(cur + 1, cur + 26).map((i) => ({ key: i.track.key, title: i.track.title, artist: i.track.artist, by: jam.addedBy.get(i.track.key) || null }));
  }
  const ups = Array.isArray(jam.remote?.upcoming) ? jam.remote.upcoming : [];
  return ups.filter((u) => u && typeof u.title === 'string').slice(0, 25)
    .map((u) => ({ key: typeof u.key === 'string' ? u.key : '', title: u.title, artist: typeof u.artist === 'string' ? u.artist : '', by: UUID_RE.test(u.by || '') ? u.by : null }));
}

// Playback sync -----------------------------------------------------------------------------
// The host publishes its song, position and the time (by the server's clock)
// over the live channel on every change and every 2 s, and into the database
// on every change and every 10 s (late joiners, and the host's heartbeat).
// Guests aim at host position + time since; small gaps close by playing up
// to 3 % faster or slower, big ones with a seek.

/** The song playing, with the exact recording first (everyone plays the same audio). */
function slimExact(t, ver) {
  const s = slimTrack(t);
  const i = ver?.url ? s.versions.findIndex((v) => v.url === ver.url) : -1;
  if (i > 0) s.versions.unshift(...s.versions.splice(i, 1));
  return s;
}

async function jamSnapshot() {
  let p = state.playback;
  try { p = await call('get_playback_state'); } catch { /* the last one we have */ }
  const t = p?.current?.track;
  const cur = state.queue.current ?? -1;
  const next = state.queue.items[cur + 1]?.track;
  const st = {
    v: 2,
    track: t ? slimExact(t, p.version) : null,
    playing: p?.status === 'playing',
    loading: p?.status === 'loading',
    position: p?.position || 0,
    at: serverNow(),
    upcoming: sessionUpcoming().map((u) => ({ ...u, votes: jam.upvotes.get(u.key)?.size || 0 })),
    next: next ? slimTrack(next) : null,
  };
  // The server keeps a state under 20 kB.
  if (JSON.stringify(st).length > 18000) { st.upcoming = st.upcoming.slice(0, 8); st.next = null; }
  return st;
}

let jamLastWrite = 0;
async function publishJamState(force) {
  if (!jam.code || !jam.host || jam.publishing) return;
  jam.publishing = true;
  try {
    const st = await jamSnapshot();
    if (!jam.code || !jam.host) return;
    const sig = `${st.track?.key}|${st.playing}|${st.loading}|${st.upcoming.map((u) => `${u.key}:${u.votes}:${u.by || ''}`).join(',')}`;
    const changed = sig !== jam.lastSig;
    if (changed || force) broadcastJamState(st, true);
    else if (st.playing && Date.now() - jam.lastBroadcast > 2000) broadcastJamState(st, false);
    if (!force && !changed && Date.now() - jamLastWrite < 10000) return;
    jam.lastSig = sig;
    jamLastWrite = Date.now();
    try { await db('PATCH', `jams?code=eq.${jam.code}`, { state: st }); } catch { jam.lastSig = ''; }
  } finally { jam.publishing = false; }
}

function broadcastJamState(st, full) {
  jam.channel?.broadcast('st', {
    from: me(), key: st.track?.key || null, playing: st.playing, loading: st.loading, position: st.position, at: st.at,
    ...(full ? { track: st.track, next: st.next } : {}),
  });
  jam.lastBroadcast = Date.now();
}

// Host: share every real change right away.
let jamLastPlay = '';
function onPlaybackForJam() {
  if (!jam.code || !jam.host) return;
  const p = state.playback;
  const key = p?.current?.track?.key;
  const sig = `${key}|${p?.status}`;
  if (sig === jamLastPlay) return;
  // A song that starts playing has had its upvotes.
  if (key && !jamLastPlay.startsWith(`${key}|`)) jam.upvotes.delete(key);
  jamLastPlay = sig;
  publishJamState(true);
}

async function jamTick() {
  if (!jam.code || jam.ticking) return;
  const j = jam;
  j.ticking = true;
  try {
    if (j.host) await publishJamState(false);
    else { await guestSync(); watchHost(); }
    shareMyQuality(false);
  } finally { j.ticking = false; }
}

/** Where the host's song is now, by the server's clock. */
function jamTarget() {
  const st = jam.remote;
  if (!st) return null;
  return st.position + (st.playing && !st.loading ? Math.max(0, serverNow() - jam.remoteAt) / 1000 : 0);
}

function setNudge(n) {
  if (n === jam.nudge) return;
  jam.nudge = n;
  call('set_sync_nudge', { thousandths: n }).catch(() => {});
}

function setQuality(q) {
  if (q === jam.quality) return;
  jam.quality = q;
  renderTogether();
}

async function jamSeek(target) {
  setNudge(0);
  setQuality('catching');
  jam.lastSeek = Date.now();
  // A seek takes a moment to sound: aim a little ahead.
  await call('seek', { position: Math.max(0, target + 0.15) }).catch(() => {});
}

/** Guest: follow the host. `force` resyncs even a small gap at once. */
async function guestSync(force = false) {
  if (!jam.code || jam.host || jam.applying) return;
  const st = jam.remote;
  if (!st?.track) { setNudge(0); setQuality('waiting'); return; }
  let p;
  try { p = await call('get_playback_state'); } catch { return; }
  if (!jam.code || jam.host || jam.applying || jam.remote?.track?.key !== st.track.key) return;
  const cur = p.current?.track?.key;
  const busy = p.status === 'playing' || p.status === 'loading';
  if (jam.away) {
    // Pressed play again on the session's song: back in sync by itself.
    if (jam.away === 'paused' && cur === st.track.key && p.status === 'playing') { jam.away = null; renderTogether(); }
    else { setNudge(0); setQuality('away'); return; }
  }
  if (cur !== st.track.key) {
    // Something else, picked here: leave them be.
    if (cur && busy && jam.expectKey && cur !== jam.expectKey) { goAway('other'); return; }
    if (Date.now() - jam.lastError < 5000) return;
    await applyTrack(jam.remote);
    return;
  }
  // On the session's song: anything else that starts here was picked by hand.
  jam.expectKey = cur;
  if (p.status === 'loading') { setQuality('catching'); return; }
  if (p.status === 'error' || p.status === 'idle') {
    if (Date.now() - jam.lastError < 5000) return;
    jam.lastError = Date.now();
    await applyTrack(jam.remote, true); // any recording, if the host's one won't play here
    return;
  }
  const target = jamTarget();
  const hostPlays = jam.remote.playing && !jam.remote.loading;
  if (!hostPlays) {
    setNudge(0);
    if (p.status === 'playing') { jam.pausedByUs = true; await call('pause').catch(() => {}); }
    if (Math.abs(p.position - target) > 0.5) await call('seek', { position: target }).catch(() => {});
    setQuality('sync');
    return;
  }
  if (p.status === 'paused') {
    if (!jam.pausedByUs) { goAway('paused'); return; }
    jam.pausedByUs = false;
    await call('resume').catch(() => {});
    if (Math.abs(p.position - target) > 1) await jamSeek(target);
    return;
  }
  const d = target - p.position;
  // Over half a second: one seek is quicker than speeding up for long.
  if (Math.abs(d) > 0.5 || (force && Math.abs(d) > 0.25)) {
    if (force || Date.now() - jam.lastSeek > 2500) await jamSeek(target);
    return;
  }
  // Less: play up to 3 % faster or slower (not something you hear for a few
  // seconds); stop within 20 ms, start again past 50 ms.
  const start = jam.nudge ? 0.02 : 0.05;
  setNudge(Math.abs(d) < start ? 0 : Math.sign(d) * Math.min(30, Math.max(8, Math.round(Math.abs(d) * 120))));
  setQuality(Math.abs(d) < 0.12 ? 'sync' : Math.abs(d) < 0.6 ? 'close' : 'catching');
  prefetchNext(jam.remote);
}

/** Guest: play the host's song (its exact recording, unless `any`), at the host's position. */
async function applyTrack(st, any = false) {
  jam.applying = true;
  setNudge(0);
  setQuality('catching');
  try {
    const track = fromCloudTrack(st.track);
    const exact = !any ? track.versions[0] : null;
    jam.expectKey = track.key;
    // Only the session's song in the queue: when it ends nothing else starts here.
    await call('clear_queue', { keepCurrent: false });
    await call('play_track', { track: exact ? { ...track, versions: [exact] } : track, platform: exact ? exact.platform : null });
    for (let i = 0; i < 80; i++) {
      await jamWait(150);
      const p = state.playback;
      if (!jam.code || jam.host) return;
      // An error left over from the last try doesn't count for the first moments.
      if (p?.current?.track?.key === track.key && (['playing', 'paused'].includes(p.status) || (p.status === 'error' && i >= 10))) break;
    }
    if (!jam.code || jam.host || jam.remote?.track?.key !== track.key) return;
    if (state.playback?.status === 'error') { jam.lastError = Date.now(); return; }
    if (!jam.remote.playing || jam.remote.loading) { jam.pausedByUs = true; await call('pause'); } else jam.pausedByUs = false;
    const now = jamTarget();
    if (now > 1) await jamSeek(now);
  } catch { /* the next tick tries again */ } finally { jam.applying = false; }
}

/** Guest: get the next song ready while this one plays. */
function prefetchNext(st) {
  const n = st?.next;
  if (!n?.key || n.key === jam.prefetched) return;
  jam.prefetched = n.key;
  const t = fromCloudTrack(n);
  call('prefetch_track', { track: t, platform: t.versions[0]?.platform ?? null }).catch(() => {});
}

function goAway(kind) {
  jam.away = kind;
  setNudge(0);
  setQuality('away');
  shareMyQuality(true);
  renderTogether();
}

function backInSync() {
  jam.away = null;
  jam.pausedByUs = true;
  jam.expectKey = null;
  jam.lastSeek = 0;
  jam.lastError = 0;
  setQuality('catching');
  shareMyQuality(true);
  guestSync(true);
}

function myJamPresence() {
  return { name: cloud.session.name, avatar: cloud.session.avatar || null, q: jam.host ? 'host' : jam.away ? 'away' : jam.quality === 'close' ? 'sync' : jam.quality };
}
/** Tell the others (the host's list) how in step this player is. */
function shareMyQuality(force) {
  if (!jam.channel) return;
  const q = myJamPresence().q;
  if (!force && q === jam.sharedQ) return;
  jam.sharedQ = q;
  jam.channel.track(myJamPresence());
}

/**
 * Guest: the host's app has gone (closed, crashed, no network). After ~25 s
 * of silence the longest-present guest takes over (then the next, 5 s later,
 * if that one's gone too). The server checks the silence.
 */
function watchHost() {
  const hostId = jam.row?.host;
  if (!hostId || jam.claiming || !jam.peopleReady) return;
  if (jam.people.some((p) => p.key === hostId)) { jam.hostGoneSince = 0; return; }
  if (!jam.hostGoneSince) jam.hostGoneSince = Date.now();
  const guests = jamGuests().map((p) => p.key)
    .sort((a, b) => (jam.joinedAt.get(a) || 0) - (jam.joinedAt.get(b) || 0) || a.localeCompare(b));
  const wait = 20000 + Math.max(0, guests.indexOf(me())) * 5000;
  const seen = jam.row.host_seen ? Date.parse(jam.row.host_seen) : 0;
  if (Date.now() - jam.hostGoneSince > wait && serverNow() - seen > wait + 5000) claimHost();
}
async function claimHost() {
  const j = jam;
  j.claiming = true;
  try {
    if (await rpc('jam_claim_host', { jam_code: j.code })) {
      toast('The host left, so you’re hosting now. Add songs to keep it going.', 'info', 5000);
      await refreshJam();
    }
  } catch { /* someone else was first, or the host is back */ }
  setTimeout(() => { j.claiming = false; }, 10000);
}

function jamAdd(track) {
  if (!jam.code) return;
  if (jam.host) {
    if (jam.row?.take_turns) addToSession(track, me()).then(() => toast(`Added “${track.title}” to the session`, 'ok', 2000)).catch((e) => toast(errMsg(e), 'error'));
    else enqueue([track]);
    return;
  }
  db('POST', 'jam_events', { code: jam.code, kind: 'suggest', status: 'pending', payload: { track: slimTrack(track) } })
    .then(() => toast(jam.row?.approve_adds === false ? `Added “${track.title}” to the session` : `Suggested “${track.title}”: the host decides`, 'ok', 2200))
    .catch((e) => toast(errMsg(e), 'error'));
}

async function sendChat(text) {
  const t = text.trim().slice(0, 300);
  if (!t || !jam.code) return;
  try { await db('POST', 'jam_events', { code: jam.code, kind: 'chat', payload: { text: t } }); } catch (e) { toast(errMsg(e), 'error'); }
}

function sendReaction(emoji, btn) {
  if (!REACTIONS.includes(emoji)) return;
  jam.channel?.broadcast('react', { emoji, from: cloud.session.name.slice(0, 40) });
  if (btn) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
  floatReaction(emoji, 'You', btn);
}

/**
 * A reaction rising from where it was sent (your button, or the session panel
 * for other people's), swaying and tilting, with a small burst of mini copies
 * and the sender's name. Transform/opacity only; removed when done.
 */
function floatReaction(emoji, from, origin = null) {
  const src = origin || $('#jam-dock:not([hidden])') || $('#btn-jam');
  const r = src?.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 + (origin ? 0 : (Math.random() - 0.5) * Math.min(160, r.width * 0.6)) : window.innerWidth * 0.75;
  const y = r ? (origin ? r.top : r.top + Math.min(r.height * 0.5, 160)) : window.innerHeight - 140;
  const el = h('div', { class: 'reaction', 'aria-hidden': 'true' }, emojiEl(emoji), h('small', {}, from));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.setProperty('--dx', `${(Math.random() - 0.5) * 90}px`);
  el.style.setProperty('--rot', `${(Math.random() - 0.5) * 30}deg`);
  document.body.append(el);
  for (let i = 0; i < 4; i++) {
    const m = h('span', { class: 'reaction-mini', 'aria-hidden': 'true' }, emojiEl(emoji));
    m.style.left = `${x}px`;
    m.style.top = `${y}px`;
    const a = (-Math.PI / 2) + (i - 1.5) * 0.55 + (Math.random() - 0.5) * 0.3;
    m.style.setProperty('--mx', `${Math.cos(a) * (46 + Math.random() * 26)}px`);
    m.style.setProperty('--my', `${Math.sin(a) * (46 + Math.random() * 26)}px`);
    document.body.append(m);
    setTimeout(() => m.remove(), 900);
  }
  setTimeout(() => el.remove(), 2600);
}

async function handOff(uid) {
  try { await rpc('jam_handoff', { jam_code: jam.code, new_host: uid }); } catch (e) { toast(errMsg(e), 'error'); }
}
async function kick(uid) {
  if (!(await confirmModal({ title: `Remove ${nameOf(uid)}?`, message: 'They leave the session and can’t join it again with this link.', okLabel: 'Remove', danger: true }))) return;
  try { await rpc('jam_kick', { jam_code: jam.code, who: uid }); toast(`${nameOf(uid)} was removed`, 'info', 2000); } catch (e) { toast(errMsg(e), 'error'); }
}

function endedByHost() {
  if (!jam.code) return;
  leaveJam({ silent: true, server: false });
  toast('The host ended the session', 'info', 2500);
}
function removedFromJam() {
  if (!jam.code) return;
  leaveJam({ silent: true, server: false });
  toast('The host removed you from the session', 'warn', 3000);
}

/**
 * Leave (or, with `end`, end for everyone). The channels are taken from the
 * session before it's cleared, so they really close.
 */
async function leaveJam({ end = false, silent = false, server = true } = {}) {
  const { code, channel, live, timers, host, nudge } = jam;
  for (const t of timers) clearInterval(t);
  jam = freshJam();
  if (nudge) call('set_sync_nudge', { thousandths: 0 }).catch(() => {});
  try { localStorage.removeItem(JAM_SAVED); } catch { /* storage off */ }
  channel?.close();
  live?.close();
  if (code && server && signedIn()) {
    try {
      if (end && host) await rpc('end_jam', { jam_code: code });
      else await db('DELETE', `jam_members?code=eq.${code}&user_id=eq.${me()}`);
    } catch { /* gone already */ }
  }
  renderTogether();
  paintJamButton();
  if (!silent) toast(end ? 'Session ended' : 'You left the session', 'info', 1800);
}

function hostLeaveMenu(anchor) {
  const guests = jamGuests();
  openMenu(anchor, [
    { label: 'End for everyone', icon: 'x', onClick: () => leaveJam({ end: true }) },
    ...(guests.length ? [{ label: 'Hand over and leave', heading: true }, ...guests.map((g) => ({ label: g.name || 'Someone', icon: 'user', onClick: async () => { await handOff(g.key); leaveJam(); } }))] : []),
  ]);
}

function paintJamButton() {
  const b = $('#btn-jam');
  if (b) {
    const n = jam.code ? Math.max(1, jam.people.length) : 0;
    b.classList.toggle('on', !!jam.code);
    b.hidden = !cloudOn();
    b.setAttribute('aria-pressed', String(!!jam.code));
    b.querySelector('.jp-label').textContent = jam.code ? (jam.host ? 'Hosting' : 'Together') : 'Together';
    const c = b.querySelector('.jp-count');
    c.hidden = !jam.code;
    c.textContent = String(n);
    b.title = jam.code ? `Listening together · ${n} ${n === 1 ? 'person' : 'people'}` : 'Listen together';
  }
  dockJam();
}

// The session lives in the right panel, under the song, while you're in one;
// the page then shows a summary. Out of a session the page is a landing.
function dockJam() {
  const panel = $('#together-panel'), dock = $('#jam-dock');
  if (!panel || !dock) return;
  if (jam.code) {
    if (panel.parentElement !== dock) dock.append(panel);
    panel.hidden = false;
    dock.hidden = false;
    $('#jam-dock-count').textContent = `· ${Math.max(1, jam.people.length)}`;
    renderTogether();
  } else {
    const home = $('#view-together');
    if (panel.parentElement !== home) home.append(panel);
    panel.hidden = true;
    dock.hidden = true;
    $('#app').classList.remove('jam-open');
  }
  if (state.view === 'together') renderTogetherLanding();
}

/** Show the session panel in the right column (in place of the song panel). */
function openJamDock() {
  if (!jam.code) return;
  setPanelOpen(true);
  $('#app').classList.add('jam-open');
  renderTogether();
}
function closeJamDock() { $('#app').classList.remove('jam-open'); }

/** The Listen together page: a landing, or your session's summary. */
async function renderTogetherLanding() {
  const box = $('#together-landing');
  if (!box) return;
  if (!cloudOn()) { box.replaceChildren(h('div', { class: 'empty' }, h('p', {}, 'Not available in this build.'))); return; }
  if (jam.code) {
    const n = Math.max(1, jam.people.length);
    box.replaceChildren(h('div', { class: 'jt-live' },
      h('div', { class: 'jt-live-top' }, h('span', { class: 'live-dot' }), h('b', {}, jam.host ? 'You’re hosting a session' : 'You’re in a session'), h('span', { class: 'meta' }, `${n} ${n === 1 ? 'person' : 'people'}`)),
      h('div', { class: 'jt-faces' }, ...jam.people.slice(0, 8).map((p) => avatarEl(p.avatar, p.name, 'avatar'))),
      h('p', { class: 'muted' }, 'Chat, suggestions and votes are in the session panel on the right.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', html: `${icon('expand')}Show the session`, onclick: openJamDock }),
        h('button', { class: 'btn', html: `${icon('link')}Copy invite link`, onclick: () => { copyText(JAM_LINK(jam.code)); toast('Invite link copied', 'ok', 1500); } }),
        h('button', { class: 'btn danger-ghost', onclick: (e) => (jam.host ? hostLeaveMenu(e.currentTarget) : leaveJam()) }, jam.host ? 'End or hand over' : 'Leave'))));
    return;
  }
  const code = h('input', { class: 'input', placeholder: 'Paste an invite link or code', spellcheck: 'false' });
  const join = () => {
    const v = code.value.trim();
    const m = v.match(/[a-z0-9]{8,24}$/i);
    if (!m) { toast('That doesn’t look like a session link', 'error'); return; }
    confirmJoinJam(m[0].toLowerCase());
  };
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  const live = h('div', { class: 'jt-friends' });
  box.replaceChildren(
    h('div', { class: 'jt-hero' },
      h('div', { class: 'jt-hero-art', html: icon('headphones') }),
      h('div', {},
        h('h2', {}, 'Same song, same moment'),
        h('p', { class: 'muted' }, 'Start a session and send the link. Everyone hears what the host plays, in sync, and can chat, react, suggest songs and vote to skip.'),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary big', html: `${icon('play')}Start a session`, onclick: startJam })))),
    h('div', { class: 'jt-join' }, h('b', {}, 'Have a link?'), h('div', { class: 'jt-join-row' }, code, h('button', { class: 'btn', onclick: join }, 'Join'))),
    h('div', { class: 'section-title' }, 'Friends listening now'), live);
  if (!signedIn()) { live.replaceChildren(h('p', { class: 'muted' }, 'Sign in to see your friends’ sessions.')); return; }
  live.replaceChildren(h('div', { class: 'loading-line' }, h('span', { class: 'spinner' }), 'Looking…'));
  try {
    const follows = await db('GET', `follows?follower=eq.${me()}&status=eq.accepted&select=followee`);
    const ids = follows.map((f) => f.followee);
    const jams = ids.length ? await db('GET', `jams?active=eq.true&host=in.(${ids.join(',')})&select=code,title,host`) : [];
    if (!jams.length) { live.replaceChildren(h('p', { class: 'muted' }, 'Nobody’s in a session right now. Start one and they’ll get a notification if you choose.')); return; }
    const people = await db('GET', `profiles?id=in.(${jams.map((j) => j.host).join(',')})&select=id,name,avatar`);
    live.replaceChildren(...jams.map((j) => {
      const p = people.find((x) => x.id === j.host) || {};
      return h('div', { class: 'jt-friend' }, avatarEl(p.avatar, p.name, 'avatar'),
        h('div', { class: 'grow min-w-0' }, h('b', {}, p.name || 'A friend'), h('div', { class: 'meta' }, j.title || 'Listening session')),
        h('button', { class: 'btn small primary', onclick: () => confirmJoinJam(j.code) }, 'Join'));
    }));
  } catch (e) { live.replaceChildren(h('p', { class: 'muted' }, errMsg(e))); }
}

$('#btn-jam')?.addEventListener('click', () => (!jam.code ? startJam() : $('#app').classList.contains('jam-open') ? closeJamDock() : openJamDock()));
$('#jam-dock-page')?.addEventListener('click', () => showView('together'));
$('#jam-dock-close')?.addEventListener('click', closeJamDock);

const QUALITY = {
  waiting: ['Waiting for the host to play something…', ''],
  catching: ['Catching up…', 'warn'],
  sync: ['In sync', 'ok'],
  close: ['Almost in sync', 'ok'],
  off: ['Out of sync · fixing', 'bad'],
  away: ['Out of step, on purpose', ''],
};
// How each guest is doing, from their presence (the host sees it).
const SYNC_BADGE = { sync: ['in sync', 'ok'], catching: ['catching up', 'warn'], away: ['away', ''], waiting: ['waiting', ''] };

/** A host option switch in the session panel. */
function jamOption(label, help, field, on) {
  const i = h('input', { type: 'checkbox', checked: on });
  i.addEventListener('change', () => {
    const want = i.checked;
    db('PATCH', `jams?code=eq.${jam.code}`, { [field]: want })
      .then(() => { jam.row = { ...jam.row, [field]: want }; renderTogether(); publishJamState(true); })
      .catch((e) => { i.checked = !want; toast(errMsg(e), 'error'); });
  });
  return h('label', { class: 'setting compact' }, h('div', { class: 'label' }, label, help ? h('small', {}, help) : null), h('span', { class: 'switch' }, i, h('span')));
}

/** The session's queue: who added what, upvotes, and (host, or guests with guest controls) changes. */
function jamQueueCard() {
  const ups = sessionUpcoming();
  if (!ups.length) return null;
  const canChange = jam.host || !!jam.row?.guest_controls;
  const votesOn = !jam.row?.take_turns;
  return h('div', { class: 'npv-card jam-queue' },
    h('h4', {}, jam.row?.take_turns ? 'Up next · taking turns' : 'Up next'),
    ...ups.map((u, i) => {
      const voters = jam.upvotes.get(u.key);
      const mine = !!voters?.has(me());
      const n = voters?.size || 0;
      return h('div', { class: 'jq-row' },
        h('div', { class: 'grow min-w-0' },
          h('div', { class: 'jq-title' }, u.title),
          h('div', { class: 'meta' }, [u.artist, u.by ? `added by ${nameOf(u.by)}` : null].filter(Boolean).join(' · '))),
        votesOn && u.key ? h('button', { class: `jq-vote${mine ? ' on' : ''}`, disabled: mine, title: mine ? 'You upvoted this' : 'Upvote: the most-voted song plays next', 'aria-label': `Upvote ${u.title}${n ? `, ${n} votes` : ''}`, onclick: () => upvote(u.key) }, h('span', { html: icon('up') }), n ? String(n) : '') : null,
        canChange && u.key ? h('button', { class: 'icon-btn small', title: 'Play now', 'aria-label': `Play ${u.title} now`, html: icon('play'), onclick: () => queueControl('play', u.key) }) : null,
        canChange && u.key && i > 0 ? h('button', { class: 'icon-btn small', title: 'Play next', 'aria-label': `Play ${u.title} next`, html: icon('playNext'), onclick: () => queueControl('move', u.key, 0) }) : null,
        canChange && u.key ? h('button', { class: 'icon-btn small', title: 'Remove', 'aria-label': `Remove ${u.title}`, html: icon('x'), onclick: () => queueControl('remove', u.key) }) : null);
    }));
}

function renderTogether() {
  const box = $('#together-panel');
  // Only where it's visible: the session panel.
  if (!box || box.hidden || !box.closest('#jam-dock') || !$('#app').classList.contains('jam-open')) return;
  if (!jam.code) {
    box.replaceChildren(h('div', { class: 'empty' },
      h('p', {}, 'Listen together'),
      h('p', { class: 'small' }, 'Start a session and send the link: everyone hears the same song at the same moment, can chat, suggest songs and vote to skip.'),
      h('div', { class: 'actions center mt-12' },
        h('button', { class: 'btn primary', onclick: startJam }, 'Start a session'),
        h('button', { class: 'btn', onclick: async () => {
          const c = await promptModal({ title: 'Join a session', placeholder: 'Code or link', okLabel: 'Join' });
          if (!c) return;
          if (!handleShareLink(c)) joinJam(c.trim().toLowerCase());
        } }, 'Join'))));
    return;
  }
  const st = jam.remote;
  const hostId = jam.row?.host;
  // Until presence arrives, at least show yourself.
  const people = jam.people.some((p) => p.key === me()) ? jam.people : [{ key: me(), name: cloud.session.name, avatar: cloud.session.avatar }, ...jam.people];
  const [qText, qCls] = jam.host ? ['You control playback', 'ok']
    : jam.away === 'paused' ? ['Paused just for you', ''] : jam.away === 'other' ? ['Playing something else', ''] : QUALITY[jam.quality] || QUALITY.waiting;
  const votes = skipVotes();

  const chatList = h('div', { class: 'jam-chat', role: 'log', 'aria-live': 'polite', 'aria-label': 'Session chat' },
    ...jam.chat.slice(-50).map((c) => h('div', { class: `chat-line${c.user_id === me() ? ' mine' : ''}` }, h('b', {}, nameOf(c.user_id)), ' ', ...emojify(c.payload?.text || ''))));
  // One input per session: re-rendering the panel keeps what's being typed.
  if (!jam.input) {
    jam.input = h('input', { class: 'input', placeholder: 'Say something…', maxlength: 300, 'aria-label': 'Chat message' });
    jam.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && jam.input.value.trim()) { sendChat(jam.input.value); jam.input.value = ''; } });
  }
  const input = jam.input;
  const hadFocus = document.activeElement === input;
  const pending = jam.suggestions.filter((s) => s.status === 'pending');

  box.replaceChildren(...[
    h('div', { class: 'jam-head' },
      h('div', {}, h('b', {}, jam.host ? 'You’re hosting' : `Listening with ${nameOf(hostId)}`), h('div', { class: `jam-quality ${qCls}`, role: 'status' }, h('span', { class: 'sync-dot' }), qText)),
      h('span', { class: 'meta' }, `${people.length} ${people.length === 1 ? 'person' : 'people'}`)),
    !jam.host && jam.away ? h('div', { class: 'jam-away' },
      h('span', {}, jam.away === 'paused' ? 'You paused: the others keep listening.' : 'You’re playing something else.'),
      h('button', { class: 'btn small primary', onclick: backInSync }, 'Back in sync')) : null,
    h('div', { class: 'jam-people' }, ...people.map((p) => h('div', { class: 'jam-person' }, avatarEl(p.avatar, p.name), h('span', {}, p.key === me() ? `${p.name} (you)` : p.name), p.key === hostId ? h('em', {}, 'host') : null,
      p.key !== hostId && p.key !== me() && SYNC_BADGE[p.q] ? h('small', { class: `jam-badge ${SYNC_BADGE[p.q][1]}` }, SYNC_BADGE[p.q][0]) : null,
      jam.host && p.key !== me() ? h('button', { class: 'icon-btn small', title: `Options for ${p.name}`, html: icon('dots'), onclick: (e) => openMenu(e.currentTarget, [
        { label: 'Make host', icon: 'user', onClick: () => handOff(p.key) },
        { label: 'Remove from session', icon: 'x', onClick: () => kick(p.key) }]) }) : null))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn small', html: `${icon('link')}Copy invite link`, onclick: () => { copyText(JAM_LINK(jam.code)); toast('Invite link copied', 'ok', 1500); } }),
      jam.host ? h('button', { class: 'btn small', html: `${icon('refresh')}Resync everyone`, title: 'Bring every guest back to your exact position', onclick: () => { jam.channel?.broadcast('resync', { from: me() }); publishJamState(true); toast('Resyncing everyone', 'ok', 1500); } }) : null,
      jam.host
        ? h('button', { class: 'btn small danger-ghost', onclick: (e) => hostLeaveMenu(e.currentTarget) }, 'End or hand over')
        : h('button', { class: 'btn small danger-ghost', onclick: () => leaveJam() }, 'Leave')),
    jam.host ? h('div', { class: 'jam-options' },
      jamOption('Approve suggested songs', null, 'approve_adds', jam.row?.approve_adds !== false),
      jamOption('Guests control the queue', 'Skip, reorder and remove songs', 'guest_controls', !!jam.row?.guest_controls),
      jamOption('Take turns', 'Everyone’s songs play in rotation', 'take_turns', !!jam.row?.take_turns)) : null,
    !jam.host && st?.track ? h('div', { class: 'npv-card' }, h('h4', {}, 'Now playing'), h('div', { class: 'npv-source' }, `${st.track.title} — ${st.track.artist}`),
      h('div', { class: 'actions mt-8' },
        jam.row?.guest_controls
          ? h('button', { class: 'btn small', html: `${icon('next')}Skip`, onclick: () => queueControl('skip') })
          : h('button', { class: 'btn small', disabled: votes.n && jam.votes.get(me()) === votes.key, onclick: voteSkip }, jam.votes.get(me()) === votes.key ? 'You voted to skip' : 'Vote to skip'),
        !jam.row?.guest_controls && votes.n ? h('span', { class: 'meta' }, `${votes.n} of ${votes.need} votes`) : null)) : null,
    jam.host && votes.n ? h('div', { class: 'meta' }, `${votes.n} of ${votes.need} votes to skip this song`) : null,
    jamQueueCard(),
    jam.host && pending.length ? h('div', { class: 'npv-card' }, h('h4', {}, `Suggestions (${pending.length})`),
      ...pending.map((s) => h('div', { class: 'suggestion' },
        h('div', { class: 'grow' }, h('b', {}, s.payload?.track?.title || 'Song'), h('div', { class: 'meta' }, `${s.payload?.track?.artist || ''} · from ${nameOf(s.user_id)}`)),
        h('button', { class: 'btn small primary', onclick: () => answerSuggestion(s, true) }, 'Add'),
        h('button', { class: 'btn small', onclick: () => answerSuggestion(s, false) }, 'Pass')))) : null,
    h('div', { class: 'jam-hint meta' }, jam.host ? 'Guests follow what you play. Songs they suggest show up here.' : 'Suggest songs with ⋯ → Suggest for the session. The host controls playback.'),
    h('div', { class: 'reactions-bar', role: 'group', 'aria-label': 'Reactions' }, ...REACTIONS.map((e) => h('button', { class: 'react-btn', title: REACTION_NAMES[e], 'aria-label': `React: ${REACTION_NAMES[e]}`, onclick: (ev) => sendReaction(e, ev.currentTarget) }, emojiEl(e)))),
    chatList,
    input].filter(Boolean));
  chatList.scrollTop = chatList.scrollHeight;
  if (hadFocus) input.focus();
}

// Friends & follow requests ----------------------------------------------------------------
const friends = { lastPublished: '', lastPos: null, lastPlaying: false, lastAt: 0, tab: 'friends' };

async function follow(uid) {
  if (!(await requireAccount({ why: 'Sign in to follow people' }))) return false;
  try { await db('POST', 'follows', { followee: uid }, { prefer: 'resolution=ignore-duplicates' }); return true; } catch (e) { toast(errMsg(e), 'error'); return false; }
}
async function unfollow(uid) {
  try { await db('DELETE', `follows?follower=eq.${me()}&followee=eq.${uid}`); return true; } catch (e) { toast(errMsg(e), 'error'); return false; }
}
async function answerRequest(uid, accept) {
  try {
    if (accept) await db('PATCH', `follows?follower=eq.${uid}&followee=eq.${me()}`, { status: 'accepted' });
    else await db('DELETE', `follows?follower=eq.${uid}&followee=eq.${me()}`);
    db('PATCH', `notifications?user_id=eq.${me()}&kind=eq.follow_request&actor=eq.${uid}`, { read: true }).catch(() => {});
    toast(accept ? 'Request accepted' : 'Request declined', 'ok', 1500);
    refreshNotifications();
    renderFriends();
  } catch (e) { toast(errMsg(e), 'error'); }
}

async function renderFriends() {
  const box = $('#friends-panel');
  // Only while its page is the one on screen.
  if (!box || !box.closest('.view')?.classList.contains('active')) return;
  clearInterval(friends.liveTimer);
  if (!cloudOn()) { box.replaceChildren(h('div', { class: 'empty' }, h('p', {}, 'Not available in this build.'))); return; }
  if (!signedIn()) {
    box.replaceChildren(h('div', { class: 'empty' }, h('p', {}, 'See what your friends are listening to'), h('p', { class: 'small' }, 'Follow friends (they approve it) and their current song shows up here.'),
      h('button', { class: 'btn primary mt-12', onclick: () => requireAccount({ why: 'Sign in to see friends' }) }, 'Sign in with Discord')));
    return;
  }
  const unread = notif.list.filter((n) => n.kind === 'song_shared' && !n.read).length;
  const tab = (id, label) => h('button', { role: 'tab', 'aria-selected': String(friends.tab === id), class: friends.tab === id ? 'active' : '', onclick: () => { friends.tab = id; renderFriends(); } }, label);
  const tabs = h('div', { class: 'friends-tabs', role: 'tablist' }, tab('friends', 'Friends'), tab('inbox', unread ? `Inbox · ${unread}` : 'Inbox'), tab('board', 'This week'));
  const content = h('div', { class: 'friends-content' });
  box.replaceChildren(tabs, content);
  if (friends.tab === 'inbox') {
    renderInbox(content);
    // Song notes count as seen once the inbox is open.
    const ids = notif.list.filter((n) => n.kind === 'song_shared' && !n.read);
    if (ids.length) { db('PATCH', `notifications?user_id=eq.${me()}&kind=eq.song_shared&read=eq.false`, { read: true }).catch(() => {}); ids.forEach((n) => { n.read = true; }); notif.unread = notif.list.filter((n) => !n.read).length; paintAccountButton(); }
    return;
  }
  if (friends.tab === 'board') { renderLeaderboard(content); return; }

  const search = h('input', { class: 'input', placeholder: 'Find people by name', spellcheck: 'false', 'aria-label': 'Find people by name' });
  const results = h('div', { class: 'people-results' });
  search.addEventListener('input', debounce(async () => {
    const q = search.value.trim();
    if (q.length < 2) { results.replaceChildren(); return; }
    try {
      const rows = (await rpc('search_profiles', { q })).slice(0, 8);
      results.replaceChildren(...rows.filter((r) => r.id !== me()).map((r) => personRow(r)));
    } catch { /* offline */ }
  }, 300));
  const requests = h('div', { class: 'friend-requests' });
  const list = h('div', { class: 'friends-list' }, ...skeletonFriends(3));
  content.replaceChildren(h('div', { class: 'friends-tools' }, search, h('button', { class: 'icon-btn', title: 'Copy link to your profile', 'aria-label': 'Copy link to your profile', html: icon('link'), onclick: () => { copyText(PROFILE_LINK(me())); toast('Profile link copied', 'ok', 1500); } })), results, requests, list);
  try {
    const [incoming, follows] = await Promise.all([
      db('GET', `follows?followee=eq.${me()}&status=eq.pending&select=follower,profiles!follows_follower_fkey(*)`),
      db('GET', `follows?follower=eq.${me()}&select=followee,status,profiles!follows_followee_fkey(*)`),
    ]);
    if (incoming.length) {
      requests.replaceChildren(h('div', { class: 'section-mini' }, `Follow requests (${incoming.length})`), ...incoming.map((r) => h('div', { class: 'friend' }, decoratedAvatar(r.profiles?.avatar, r.profiles?.name, r.profiles?.decoration),
        h('button', { class: 'friend-name', onclick: () => openProfile(r.follower) }, r.profiles?.name || 'Someone'),
        h('button', { class: 'btn small primary', onclick: () => answerRequest(r.follower, true) }, 'Accept'),
        h('button', { class: 'btn small', onclick: () => answerRequest(r.follower, false) }, 'Decline'))));
    }
    const accepted = follows.filter((f) => f.status === 'accepted');
    const asked = follows.filter((f) => f.status === 'pending');
    const ids = accepted.map((f) => f.followee);
    const playing = ids.length ? await db('GET', `now_playing?user_id=in.(${ids.join(',')})&select=*`) : [];
    const byUser = new Map(playing.map((p) => [p.user_id, p]));
    const order = { listening: 0, online: 1, offline: 2 };
    const rows = accepted.map((f) => ({ ...f.profiles, np: byUser.get(f.followee) }))
      .sort((a, b) => (order[presenceOf(a.np)] - order[presenceOf(b.np)]) || (b.np?.updated_at || '').localeCompare(a.np?.updated_at || ''));
    const out = [];
    if (!rows.length && !asked.length) out.push(h('p', { class: 'meta pad-12' }, 'You don’t follow anyone yet. Search above, or send friends your profile link.'));
    out.push(...rows.map((r) => friendRow(r)));
    if (asked.length) out.push(h('div', { class: 'section-mini' }, 'Waiting for approval'), ...asked.map((f) => h('div', { class: 'friend' }, decoratedAvatar(f.profiles?.avatar, f.profiles?.name, f.profiles?.decoration),
      h('button', { class: 'friend-name', onclick: () => openProfile(f.followee) }, f.profiles?.name || 'Someone'),
      h('button', { class: 'btn small', onclick: async () => { if (await unfollow(f.followee)) renderFriends(); } }, 'Cancel'))));
    list.replaceChildren(...out);
    // Live progress bars move on their own between updates.
    friends.liveTimer = setInterval(() => {
      if (box.hidden || !list.isConnected) { clearInterval(friends.liveTimer); return; }
      for (const bar of list.querySelectorAll('.friend-progress[data-uid]')) {
        const np = byUser.get(bar.dataset.uid);
        const pos = livePosition(np);
        if (pos != null && np.duration) bar.firstChild.style.transform = `scaleX(${Math.min(1, pos / np.duration)})`;
      }
    }, 1000);
  } catch (e) { list.replaceChildren(h('p', { class: 'meta' }, errMsg(e))); }
}

function skeletonFriends(n) {
  return Array.from({ length: n }, () => h('div', { class: 'friend skeleton' }, h('span', { class: 'avatar sk' }), h('div', { class: 'grow' }, h('div', { class: 'sk w-60' }), h('div', { class: 'sk w-40' }))));
}

function personRow(r) {
  const btn = h('button', { class: 'btn small' }, 'Follow');
  btn.addEventListener('click', async () => {
    if (await follow(r.id)) { btn.textContent = 'Requested'; btn.disabled = true; renderFriends(); }
  });
  return h('div', { class: 'friend' }, decoratedAvatar(r.avatar, r.name, r.decoration), h('button', { class: 'friend-name', onclick: () => openProfile(r.id) }, r.name), btn);
}

const PRESENCE_TEXT = { listening: 'Listening now', online: 'Online', offline: 'Offline' };
function friendRow(r) {
  const np = r.np;
  const pres = presenceOf(np);
  const t = np?.track;
  const live = pres === 'listening' && t;
  const pos = livePosition(np);
  const av = h('span', { class: `presence ${pres}`, title: PRESENCE_TEXT[pres] }, decoratedAvatar(r.avatar, r.name, r.decoration), h('i', { class: 'p-dot', 'aria-label': PRESENCE_TEXT[pres] }));
  const tools = h('div', { class: 'friend-tools' },
    live ? h('button', { class: 'icon-btn small', title: `Listen along with ${r.name}`, html: icon('headphones'), onclick: () => listenAlong(r.id, r.name) }) : null,
    t ? h('button', { class: 'icon-btn small', title: 'Play this song', html: icon('play'), onclick: () => playTrack(fromCloudTrack(t)) }) : null);
  return h('div', { class: `friend${along.uid === r.id ? ' along' : ''}` }, av,
    h('div', { class: 'friend-main' },
      h('button', { class: 'friend-name', onclick: () => openProfile(r.id) }, r.name),
      t ? h('div', { class: 'friend-track', title: `${t.title} · ${t.artist}` }, `${t.title} · ${t.artist}`) : h('span', { class: 'meta' }, pres === 'offline' ? 'Nothing played lately' : 'Online, not playing'),
      live && np.duration ? h('div', { class: 'friend-progress', dataset: { uid: r.id } }, h('i', { style: `transform:scaleX(${Math.min(1, (pos || 0) / np.duration)})` })) : null),
    np && !live ? h('span', { class: 'meta friend-when' }, pres === 'online' ? 'online' : timeAgo(Date.parse(np.updated_at))) : null,
    tools);
}

/** Tell approved followers what's playing, where in the song, and that the
 * app is open (only if sharing is on). Real changes go out right away,
 * seeks too; `force` (the minute heartbeat) refreshes position and presence. */
function publishActivity(force = false) {
  if (!signedIn() || !state.settings?.share_activity || !cloud.profile?.share_activity) return;
  const p = state.playback;
  const t = p?.current?.track;
  if (p?.status === 'loading') return;
  const playing = p?.status === 'playing';
  const pos = p?.position || 0;
  // Where followers think we are, from the last update.
  const expected = friends.lastPos == null ? null : friends.lastPos + (friends.lastPlaying ? (Date.now() - friends.lastAt) / 1000 : 0);
  const seeked = expected != null && Math.abs(pos - expected) > 4;
  const sig = `${t?.key}|${playing}`;
  if (!force && sig === friends.lastPublished && !seeked) return;
  friends.lastPublished = sig;
  Object.assign(friends, { lastPos: pos, lastPlaying: playing, lastAt: Date.now() });
  const now = new Date().toISOString();
  return db('POST', 'now_playing?on_conflict=user_id', {
    user_id: me(), track: t ? slimTrack(t) : null, playing, position: t ? Math.round(pos * 10) / 10 : null,
    duration: t ? p.duration || t.duration || null : null, updated_at: now, online_at: now,
  }, { prefer: 'resolution=merge-duplicates' })
    .catch(() => { friends.lastPublished = ''; }); // try again on the next update
}

// Notifications ---------------------------------------------------------------------------------
const notif = { list: [], unread: 0, channel: null, user: null };
const NOTIF_SELECT = 'select=*,actor_profile:profiles!notifications_actor_fkey(name,avatar)';

async function startNotifications() {
  if (!signedIn()) {
    notif.channel?.close();
    Object.assign(notif, { list: [], unread: 0, channel: null, user: null });
    paintAccountButton();
    return;
  }
  if (notif.user === me()) return;
  notif.channel?.close();
  notif.user = me();
  notif.channel = new Channel(`notes:${me()}`, { changes: [{ event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me()}` }] });
  notif.channel.on('change', async (d) => {
    if (!d?.record) return;
    const [n] = await db('GET', `notifications?id=eq.${d.record.id}&${NOTIF_SELECT}`).catch(() => [d.record]);
    if (!n) return;
    notif.list.unshift(n);
    notif.unread++;
    paintAccountButton();
    const a = notifAction(n);
    toast(notifText(n), 'info', a ? 8000 : 4000, a ? { action: a } : undefined);
  });
  // After a reconnect: whatever arrived while the connection was down.
  let first = true;
  notif.channel.on('status', (s) => { if (s === 'live' && !first) refreshNotifications(); if (s === 'live') first = false; });
  refreshNotifications();
}

async function refreshNotifications() {
  if (!signedIn()) return;
  try {
    notif.list = await db('GET', `notifications?${NOTIF_SELECT}&order=created_at.desc&limit=50`);
    notif.unread = notif.list.filter((n) => !n.read).length;
  } catch { /* offline */ }
  paintAccountButton();
}

function notifText(n) {
  const who = n.actor_profile?.name || 'Someone';
  switch (n.kind) {
    case 'follow_request': return `${who} wants to follow you`;
    case 'follow_accepted': return `${who} accepted your follow request`;
    case 'playlist_activity': return `${who} changed “${n.data?.title || 'a playlist'}”`;
    case 'jam_started': return `${who} started a listening session`;
    case 'song_shared': return `${who} sent you “${n.data?.title || 'a song'}”`;
    case 'share_reply': return `${who} replied about “${n.data?.title || 'your song'}”: ${String(n.data?.reply || '').slice(0, 200)}`;
    default: return 'Something happened';
  }
}
function notifAction(n) {
  if (n.kind === 'follow_request') return { label: 'Accept', onClick: () => answerRequest(n.actor, true) };
  if (n.kind === 'jam_started' && LINK_CODES.j.test(n.data?.code || '')) return { label: 'Join', onClick: () => confirmJoinJam(n.data.code) };
  if (n.kind === 'playlist_activity' && n.data?.playlist) return { label: 'Open', onClick: () => openSharedPlaylist(n.data.playlist) };
  if (n.kind === 'follow_accepted') return { label: 'View', onClick: () => openProfile(n.actor) };
  if (n.kind === 'share_reply' && UUID_RE.test(n.actor || '')) return { label: 'Profile', onClick: () => openProfile(n.actor) };
  if (n.kind === 'song_shared') return { label: 'Open', onClick: () => { friends.tab = 'inbox'; setPanelOpen(true); showPanel('friends'); renderFriends(); } };
  return null;
}

function openNotifications() {
  const list = h('div', { class: 'notif-list' });
  const paint = () => {
    if (!notif.list.length) { list.replaceChildren(h('p', { class: 'meta pad-12' }, 'Nothing yet. Follow requests, friends’ sessions and changes to your shared playlists show up here.')); return; }
    list.replaceChildren(...notif.list.map((n) => {
      const a = notifAction(n);
      return h('div', { class: `notif${n.read ? '' : ' unread'}` }, avatarEl(n.actor_profile?.avatar, n.actor_profile?.name),
        h('div', { class: 'grow' }, h('div', {}, notifText(n)), h('div', { class: 'meta' }, timeAgo(Date.parse(n.created_at)))),
        n.kind === 'follow_request' ? h('button', { class: 'btn small', onclick: () => { answerRequest(n.actor, false); m.close(); } }, 'Decline') : null,
        a ? h('button', { class: `btn small${n.kind === 'follow_request' ? ' primary' : ''}`, onclick: () => { m.close(); a.onClick(); } }, a.label) : null);
    }));
  };
  paint();
  const m = openModal({
    title: 'Notifications',
    body: list,
    footer: [
      notif.list.length ? h('button', { class: 'btn', onclick: async () => { await db('DELETE', `notifications?user_id=eq.${me()}`).catch(() => {}); notif.list = []; notif.unread = 0; paint(); paintAccountButton(); } }, 'Clear all') : null,
      h('button', { class: 'btn primary', onclick: () => m.close() }, 'Done')].filter(Boolean),
  });
  if (notif.unread) {
    db('PATCH', `notifications?user_id=eq.${me()}&read=eq.false`, { read: true }).catch(() => {});
    notif.unread = 0;
    for (const n of notif.list) n.read = true;
    paintAccountButton();
  }
}

// Profiles ------------------------------------------------------------------------------------
// A Discord-style header (their banner, or their accent color), and
// tabs for public playlists, followers and following.
const DISCORD_BANNER = /^https:\/\/cdn\.discordapp\.com\/banners\/[0-9]+\/(a_)?[0-9a-f]+\.(png|gif|webp)(\?size=[0-9]+)?$/;
const hexColor = (n) => `#${Number(n).toString(16).padStart(6, '0')}`;

let profileSeq = 0;
const PUBLIC_PROFILE = 'id,name,avatar,banner,accent_color,decoration';
async function openProfile(userId, { push = true, tab = 'playlists' } = {}) {
  if (!cloudOn() || !UUID_RE.test(userId)) return;
  const seq = ++profileSeq;
  showView('profile', { push, reopen: () => openProfile(userId, { push: false, tab }) });
  const body = $('#profile-body');
  body.replaceChildren(loadingBox('Loading profile', h('div', { class: 'profile-head' }, h('div', { class: 'profile-banner sk' }), h('div', { class: 'profile-id' }, h('div', { class: 'profile-avatar sk' }), h('div', { class: 'grow' }, h('div', { class: 'sk sk-title w-40' }), h('div', { class: 'sk w-20' }))))));
  try {
    const signed = signedIn();
    const [[p], lists, followers, following, mine, stats, nps, badges, followsMe] = await Promise.all([
      // Signed out, only a profile's public fields are readable.
      db('GET', `profiles?id=eq.${userId}&select=${signed ? '*' : PUBLIC_PROFILE}`),
      db('GET', `playlists?owner=eq.${userId}&visibility=eq.public&deleted_at=is.null&select=id,title,cover,tracks->0->thumbnail&order=updated_at.desc`),
      db('GET', `follows?followee=eq.${userId}&select=follower,status,created_at,profiles!follows_follower_fkey(id,name,avatar,decoration)&order=created_at.desc`),
      db('GET', `follows?follower=eq.${userId}&status=eq.accepted&select=followee,created_at,profiles!follows_followee_fkey(id,name,avatar,decoration)&order=created_at.desc`),
      signed ? db('GET', `follows?follower=eq.${me()}&select=followee,status`) : Promise.resolve([]),
      signed ? db('GET', `profile_stats?user_id=eq.${userId}&select=*`).catch(() => []) : Promise.resolve([]),
      signed ? db('GET', `now_playing?user_id=eq.${userId}&select=*`).catch(() => []) : Promise.resolve([]),
      badgesOf(userId),
      signed && userId !== me() ? db('GET', `follows?follower=eq.${userId}&followee=eq.${me()}&status=eq.accepted&select=follower`).catch(() => []) : Promise.resolve([]),
    ]);
    if (seq !== profileSeq) return;
    if (!p) { body.replaceChildren(h('div', { class: 'empty' }, h('p', {}, 'This profile doesn’t exist.'))); return; }
    const isMe = signed && p.id === me();
    const accepted = followers.filter((f) => f.status === 'accepted');
    const myStatus = new Map(mine.map((f) => [f.followee, f.status]));
    const st = stats[0] || null;
    const np = nps[0] || null;
    // People you follow who also follow them.
    const mutuals = accepted.filter((f) => myStatus.get(f.follower) === 'accepted').map((f) => f.profiles).filter(Boolean);
    let match = null;
    const matchEl = h('span', { class: 'match-chip', hidden: true });
    if (!isMe && st?.top_artists?.length) tasteMatch(st.top_artists).then((m) => { if (m != null) { match = m; matchEl.textContent = `${m}% taste match`; matchEl.hidden = false; } });

    // Header: banner, decorated avatar, name, pronouns, badges, bio, counts.
    const banner = h('div', { class: 'profile-banner' });
    const accent = p.accent_color != null ? hexColor(p.accent_color) : null;
    // Their upload (a GIF moves) or their Discord banner.
    if (typeof p.banner === 'string' && (DISCORD_BANNER.test(p.banner) || MEDIA_RE.test(p.banner))) banner.style.backgroundImage = `url("${mediaUrl(p.banner)}")`;
    else banner.classList.add('no-image');
    if (accent) banner.style.setProperty('--accent-c', accent);
    const avatar = h('div', { class: 'profile-avatar' });
    if (mediaUrl(p.avatar)) avatar.append(h('img', { src: mediaUrl(p.avatar), 'data-px': 300, alt: '', referrerpolicy: 'no-referrer' }));
    else { avatar.textContent = (p.name || '?')[0].toUpperCase(); if (accent) avatar.style.background = accent; }
    const avatarBox = h('div', { class: 'profile-avatar-box' }, avatar);
    if (typeof p.decoration === 'string' && DECORATION_RE.test(p.decoration)) avatarBox.append(h('img', { class: 'profile-deco', src: p.decoration, alt: '', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() }));

    const followBtn = (uid, name) => {
      if (!signedIn() || uid === me()) return null;
      const stt = myStatus.get(uid);
      const b = h('button', { class: `btn small${stt ? '' : ' primary'}` }, !stt ? (uid === p.id && followsMe.length ? 'Follow back' : 'Follow') : stt === 'accepted' ? 'Following' : 'Requested');
      b.addEventListener('click', async () => {
        b.disabled = true;
        if (stt) { if (await unfollow(uid)) myStatus.delete(uid); }
        else if (await follow(uid)) { myStatus.set(uid, 'pending'); toast(`Request sent to ${name}`, 'ok', 2000); }
        render();
      });
      return b;
    };
    const tabBtn = (id, label) => h('button', { role: 'tab', 'aria-selected': String(tab === id), class: tab === id ? 'active' : '', onclick: () => { tab = id; render(); } }, label);
    const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const personList = (rows, empty) => (rows.length
      ? h('div', { class: 'people-grid' }, ...rows.map((r) => h('div', { class: 'person-card' },
        h('button', { class: 'person-open', onclick: () => openProfile(r.id) }, decoratedAvatar(r.avatar, r.name, r.decoration, 'avatar lg'), h('b', {}, r.name || 'Someone'), r.id === me() ? h('span', { class: 'meta' }, 'You') : null),
        followBtn(r.id, r.name))))
      : h('p', { class: 'meta' }, empty));

    // Listening now (approved followers, when they share what they play).
    const nowCard = () => {
      if (!np?.track || presenceOf(np) !== 'listening') return null;
      const t = fromCloudTrack(np.track);
      const pos = livePosition(np);
      return h('div', { class: 'now-card' },
        thumbEl(t.thumbnail, 'thumb big', t.key || t.title),
        h('div', { class: 'grow min-w-0' },
          h('div', { class: 'now-kicker' }, h('span', { class: 'sync-dot' }), 'Listening now'),
          h('b', { class: 'ellipsis' }, t.title), h('div', { class: 'meta ellipsis' }, t.artist || ''),
          np.duration ? h('div', { class: 'friend-progress' }, h('i', { style: `transform:scaleX(${Math.min(1, (pos || 0) / np.duration)})` })) : null),
        isMe ? null : h('button', { class: 'btn small primary', html: `${icon('headphones')}Listen along`, onclick: () => listenAlong(p.id, p.name) }));
    };

    const listening = () => {
      if (!st) return h('p', { class: 'meta' }, isMe ? 'Turn on “Share my listening” in Settings → Account to show your top artists and songs here.' : `${p.name} doesn’t share their listening${signedIn() ? ' with you' : ''}.`);
      const artistTiles = (st.top_artists || []).map((a, i) => h('button', { class: 'top-artist', style: `--i:${i}`, onclick: () => openArtist(a.name) },
        h('div', { class: 'ta-img' }, a.thumbnail ? h('img', { src: a.thumbnail, 'data-px': 200, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { html: icon('user') })), h('b', {}, a.name)));
      const songList = (arr, label) => (arr?.length ? h('div', {}, h('div', { class: 'section-title' }, label),
        h('div', { class: 'track-list', role: 'listbox', 'aria-label': label }, ...arr.map((t, i) => trackRow(fromCloudTrack(t), i, { onPlay: () => playList(arr.map(fromCloudTrack), i) })))) : null);
      return h('div', {},
        h('div', { class: 'stat-strip' },
          h('div', { class: 'stat-pill' }, h('b', {}, (st.week_minutes || 0).toLocaleString()), ' min this week'),
          h('div', { class: 'stat-pill' }, h('b', {}, (st.month_minutes || 0).toLocaleString()), ' min in 4 weeks'),
          st.streak ? h('div', { class: 'stat-pill' }, h('b', {}, `🔥 ${st.streak}`), ' day streak') : null),
        artistTiles.length ? h('div', {}, h('div', { class: 'section-title' }, 'Top artists · last 4 weeks'), h('div', { class: 'top-artists' }, ...artistTiles)) : null,
        songList(st.top_tracks, 'Top songs · last 4 weeks'),
        songList(st.recent, 'Recently played'));
    };

    const pinnedCard = () => {
      const pins = (Array.isArray(p.pinned) ? p.pinned : []).filter((t) => t && typeof t.key === 'string').map(fromCloudTrack);
      if (!pins.length) return null;
      return h('div', { class: 'profile-pinned' }, h('div', { class: 'section-title' }, h('span', { html: icon('pin') }), 'Pinned'),
        h('div', { class: 'track-list', role: 'listbox', 'aria-label': 'Pinned songs' }, ...pins.map((t, i) => trackRow(t, i, { onPlay: () => playList(pins, i) }))));
    };

    const render = () => {
      const facts = [
        followsMe.length ? h('span', { class: 'follows-you' }, 'Follows you') : null,
        matchEl,
      ];
      const head = h('div', { class: 'profile-head' }, banner,
        h('div', { class: 'profile-id' }, avatarBox,
          h('div', { class: 'grow min-w-0' },
            h('div', { class: 'hero-kicker' }, 'Profile', ...facts.filter(Boolean)),
            h('h1', { class: 'profile-name', title: p.name }, p.name, p.pronouns ? h('span', { class: 'pronouns' }, p.pronouns) : null),
            h('div', { class: 'profile-counts' },
              h('button', { onclick: () => { tab = 'followers'; render(); } }, h('b', {}, String(accepted.length)), accepted.length === 1 ? ' follower' : ' followers'),
              h('button', { onclick: () => { tab = 'following'; render(); } }, h('b', {}, String(following.length)), ' following'),
              h('span', {}, count(lists.length, 'public playlist', 'public playlists')))),
          h('div', { class: 'profile-actions' },
            isMe ? h('button', { class: 'btn small', onclick: () => editProfile(p, () => openProfile(userId, { push: false, tab })) }, 'Edit profile') : followBtn(p.id, p.name),
            !isMe && st?.top_tracks?.length ? h('button', { class: 'btn small', html: `${icon('sparkle')}Blend`, title: `A mix of your taste and ${p.name}’s`, onclick: () => openBlend(p, st) }) : null,
            !isMe && signedIn() ? h('button', { class: 'ab-icon', title: 'Send a song: use ⋯ → Send to a friend on any song', html: icon('send'), onclick: () => { const t = state.playback?.current?.track; if (t) sendSongToFriend(t); else toast('Play a song, then send it with ⋯ → Send to a friend', 'info', 3000); } }) : null,
            isMe ? h('button', { class: 'btn small', onclick: () => askCloudPrivacy(true) }, 'Privacy') : null,
            h('button', { class: 'ab-icon', title: 'Copy profile link', html: icon('link'), onclick: () => { copyText(PROFILE_LINK(p.id)); toast('Profile link copied', 'ok', 1500); } }))),
        (() => { const b = badgeRow(badges); if (b) b.classList.add('profile-badges'); return b; })(),
        p.bio ? h('p', { class: 'profile-bio' }, p.bio) : null,
        mutuals.length ? h('div', { class: 'mutuals' }, h('span', { class: 'avatar-stack' }, ...mutuals.slice(0, 3).map((m) => avatarEl(m.avatar, m.name, 'avatar xs'))),
          h('span', {}, `Followed by ${mutuals.slice(0, 2).map((m) => m.name).join(', ')}${mutuals.length > 2 ? ` and ${mutuals.length - 2} other${mutuals.length - 2 === 1 ? '' : 's'} you follow` : ''}`)) : null,
        nowCard(),
        pinnedCard());
      const tabs = h('div', { class: 'profile-tabs chips', role: 'tablist' },
        tabBtn('playlists', `Playlists · ${lists.length}`), tabBtn('listening', 'Listening'), tabBtn('followers', `Followers · ${accepted.length}`), tabBtn('following', `Following · ${following.length}`));

      let content;
      if (tab === 'playlists') {
        content = lists.length
          ? h('div', { class: 'card-row' }, ...lists.map((l, i) => cardTile({ kind: 'playlist', title: l.title, subtitle: `Playlist · ${p.name}`, thumbnail: l.cover || l.thumbnail, browse_id: null, track: null, _cloud: l.id }, i)))
          : h('p', { class: 'meta' }, isMe ? 'Make a playlist public (⋯ → Share link → Public) to show it here.' : 'No public playlists yet.');
      } else if (tab === 'listening') {
        content = listening();
      } else if (tab === 'followers') {
        const rows = accepted.map((f) => ({ ...f.profiles, id: f.follower }));
        content = h('div', {}, personList(rows, isMe ? 'Nobody follows you yet. Send friends your profile link.' : 'No followers yet.'),
          isMe && rows.length ? h('details', { class: 'manage-followers' }, h('summary', {}, 'Remove followers'),
            ...rows.map((r) => h('div', { class: 'friend' }, avatarEl(r.avatar, r.name), h('span', { class: 'grow' }, r.name || 'Someone'),
              h('button', { class: 'btn small', onclick: async () => {
                if (!(await confirmModal({ title: `Remove ${r.name || 'this follower'}?`, message: 'They stop seeing what you play and your Wrapped. They aren’t told.', okLabel: 'Remove', danger: true }))) return;
                try { await db('DELETE', `follows?follower=eq.${r.id}&followee=eq.${me()}`); openProfile(userId, { push: false, tab: 'followers' }); } catch (e) { toast(errMsg(e), 'error'); }
              } }, 'Remove')))) : null);
      } else {
        content = personList(following.map((f) => ({ ...f.profiles, id: f.followee })), isMe ? 'You don’t follow anyone yet. Find people in the Friends panel.' : 'Not following anyone yet.');
      }
      body.replaceChildren(head, tabs, h('div', { class: 'profile-tab' }, content));
      if (tab === 'playlists') {
        $$('#profile-body .tile').forEach((tile, i) => { tile.onclick = (e) => { e.stopPropagation(); openSharedPlaylist(lists[i].id); }; const pb = tile.querySelector('.tile-play'); if (pb) pb.onclick = async (e) => { e.stopPropagation(); const [row] = await db('GET', `playlists?id=eq.${lists[i].id}&select=tracks`); playList(row.tracks.map(fromCloudTrack), 0); }; });
      }
      markPlaying();
    };
    render();
    heroColor(body, mediaUrl(p.avatar));
  } catch (e) { if (seq === profileSeq) body.replaceChildren(h('div', { class: 'empty is-error' }, h('p', {}, errMsg(e)))); }
}

// Wrapped: compare with approved friends ------------------------------------------------------------
async function compareWrapped(s, year) {
  if (!(await requireAccount({ why: 'Sign in to compare with friends' }))) return;
  if (cloud.profile?.share_wrapped === false) {
    if (!(await confirmModal({ title: 'Share your Wrapped with friends?', message: 'Comparing shares your top artists, songs and minutes with approved followers and people you follow. You can turn it off again in Settings → Account.', okLabel: 'Share and compare' }))) return;
    await saveCloudPrivacy({ share_wrapped: true });
  }
  const mine = { artists: s.top_artists.slice(0, 30).map((a) => a.name), songs: s.top_tracks.slice(0, 30).map((t) => `${t.track.artist} — ${t.track.title}`), minutes: Math.round(s.minutes) };
  try {
    await db('POST', 'wrapped', { user_id: me(), year, data: mine, updated_at: new Date().toISOString() }, { prefer: 'resolution=merge-duplicates' });
    const follows = await db('GET', `follows?follower=eq.${me()}&status=eq.accepted&select=followee,profiles!follows_followee_fkey(id,name,avatar)`);
    const theirs = follows.length ? await db('GET', `wrapped?year=eq.${year}&user_id=in.(${follows.map((f) => f.followee).join(',')})`) : [];
    const m = openModal({
      title: `Compare your ${year}`,
      wide: true,
      body: theirs.length ? h('div', { class: 'import-list' }, ...theirs.map((w) => {
        const who = follows.find((f) => f.followee === w.user_id)?.profiles;
        const common = mine.artists.filter((a) => w.data.artists?.includes(a));
        const score = Math.round((common.length / Math.max(1, Math.min(mine.artists.length, w.data.artists?.length || 0))) * 100);
        return h('div', { class: 'import-row align-start' }, avatarEl(who?.avatar, who?.name),
          h('div', { class: 'grow' }, h('b', {}, `${who?.name || 'Friend'} · ${score}% match`),
            h('div', { class: 'meta' }, common.length ? `You both love ${common.slice(0, 5).join(', ')}${common.length > 5 ? ` and ${common.length - 5} more` : ''}` : 'Totally different taste this year'),
            h('div', { class: 'meta' }, `${w.data.minutes?.toLocaleString() || 0} minutes vs your ${mine.minutes.toLocaleString()}`)));
      })) : h('p', {}, 'None of the people you follow have shared their Wrapped yet. Yours is shared now, so they can compare with you.'),
      footer: [h('button', { class: 'btn primary', onclick: () => m.close() }, 'Done')],
    });
  } catch (e) { toast(errMsg(e), 'error'); }
}
