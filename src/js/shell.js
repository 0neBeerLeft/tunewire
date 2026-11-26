'use strict';

// ===========================================================================
// App shell: title bar & window controls, Your Library controls, the right
// panel's Now playing view, full screen player, sleep timer, shuffle, device.
// ===========================================================================

const appWindow = window.__TAURI__?.window?.getCurrentWindow?.() || null;

// Title bar ---------------------------------------------------------------------
$('#nav-back').addEventListener('click', goBack);
$('#nav-fwd').addEventListener('click', goForward);
$('#nav-home').addEventListener('click', () => showView('home'));
$('#search-browse').addEventListener('click', () => {
  $('#search-input').value = '';
  syncSearchClear();
  showView('search');
  showSearchBody(false);
  renderHero();
});
$('#nav-releases').addEventListener('click', () => (typeof signedIn === 'function' && signedIn() ? openNotifications() : showView('releases')));
$('#nav-menu').addEventListener('click', (e) => openMenu(e.currentTarget, [
  { label: 'Settings', icon: 'gear', onClick: () => showView('settings') },
  { label: 'Themes', icon: 'palette', onClick: () => showView('themes') },
  { label: 'Plugins', icon: 'puzzle', onClick: () => showView('plugins') },
  'sep',
  { label: 'Import playlists', icon: 'importIcon', onClick: () => openImport() },
  { label: 'Downloads', icon: 'download', onClick: () => showView('downloads') },
  { label: 'Local files', icon: 'folder', onClick: () => showView('local') },
  'sep',
  // Phones have no keyboard shortcuts.
  isMobile ? null : { label: 'Keyboard shortcuts', icon: 'keyboard', onClick: showShortcuts },
  { label: 'Check for updates', icon: 'refresh', onClick: () => checkForUpdate(true) },
]));

if (appWindow) {
  $('#win-min').addEventListener('click', () => appWindow.minimize());
  $('#win-max').addEventListener('click', () => appWindow.toggleMaximize());
  $('#win-close').addEventListener('click', () => appWindow.close());
  const syncMax = async () => {
    try {
      const max = await appWindow.isMaximized();
      $('#win-max').innerHTML = icon(max ? 'winRestore' : 'winMax');
      $('#win-max').title = max ? 'Restore' : 'Maximize';
      document.documentElement.classList.toggle('maximized', max);
    } catch { /* not available */ }
  };
  appWindow.onResized?.(syncMax);
  syncMax();
} else {
  $('#win-controls').hidden = true; // browser preview
}

// Your Library controls -----------------------------------------------------------
(() => {
  try {
    if (localStorage.getItem('tw-lib-collapsed') === '1') $('#app').classList.add('lib-collapsed');
    state.libSort = localStorage.getItem('tw-lib-sort') || 'recents';
  } catch { /* optional */ }
})();
$('#lib-collapse').addEventListener('click', () => {
  const on = $('#app').classList.toggle('lib-collapsed');
  $('#lib-collapse').title = on ? 'Expand Your Library' : 'Collapse Your Library';
  try { localStorage.setItem('tw-lib-collapsed', on ? '1' : '0'); } catch { /* optional */ }
});
$('#lib-create').addEventListener('click', (e) => openMenu(e.currentTarget, [
  { label: 'Create a new playlist', icon: 'plus', onClick: () => createPlaylist() },
  { label: 'Create a playlist folder', icon: 'folderPlus', onClick: async () => {
    const name = await promptModal({ title: 'New folder', okLabel: 'Create', placeholder: 'Folder name' });
    if (name) createPlaylist({ folder: name });
  } },
  'sep',
  { label: 'Import from Spotify', icon: 'importIcon', onClick: () => openSpotifyImport() },
  { label: 'Import a link or file', icon: 'link', onClick: () => openImport() },
]));
$('#lib-chips').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-filter]');
  if (!b) return;
  state.libFilter = state.libFilter === b.dataset.filter ? null : b.dataset.filter;
  renderLibrary();
});
$('#lib-search-btn').addEventListener('click', () => { $('#lib-search').classList.add('open'); $('#lib-search-input').focus(); });
$('#lib-search-input').addEventListener('input', (e) => { state.libQuery = e.target.value; renderLibrary(); });
$('#lib-search-input').addEventListener('blur', (e) => { if (!e.target.value) $('#lib-search').classList.remove('open'); });
$('#lib-sort').addEventListener('click', (e) => openMenu(e.currentTarget, [
  { label: 'Sort by', heading: true },
  ...Object.entries(LIB_SORTS).map(([k, l]) => ({ label: `${state.libSort === k ? '✓ ' : ''}${l}`, onClick: () => {
    state.libSort = k;
    try { localStorage.setItem('tw-lib-sort', k); } catch { /* optional */ }
    renderLibrary();
  } })),
]));

// Right panel ----------------------------------------------------------------------
$('#panel-close').addEventListener('click', () => setPanelOpen(false));
$('#btn-np').addEventListener('click', () => togglePanel('now'));
$('#btn-lyrics').addEventListener('click', () => togglePanel('lyrics'));
$('#np-cover').addEventListener('click', () => togglePanel('now'));
$('#np-title').addEventListener('click', () => { if (state.playingFrom && state.playingFrom !== 'liked') openPlaylist(state.playingFrom); else if (state.playingFrom === 'liked') showView('favorites'); });
(() => {
  try { if (localStorage.getItem('tw-panel-open') === '0') $('#app').classList.add('queue-hidden'); } catch { /* optional */ }
})();

// Now playing view: big cover, artist card, next in queue.
const npv = { key: null, artistCache: new Map(), seq: 0 };

function renderNowPlaying(force = false) {
  const box = $('#np-panel');
  if (!box || box.hidden) return;
  const p = state.playback;
  const track = p?.current?.track;
  if (!track) {
    npv.key = null;
    box.replaceChildren(h('div', { class: 'empty' }, h('p', {}, 'Nothing playing'), h('p', { class: 'small' }, 'Play a song and it shows up here.')));
    return;
  }
  const nextItem = state.queue.items[(state.queue.current ?? -1) + 1];
  const key = `${track.key}|${nextItem?.uid}|${state.favKeys.has(track.key)}`;
  if (!force && npv.key === key) return;
  npv.key = key;
  const thumb = p.version?.thumbnail || track.thumbnail;
  const big = thumb ? thumb.replace(/=w\d+-h\d+/, '=w800-h800').replace('/mqdefault.jpg', '/maxresdefault.jpg').replace('-t500x500.', '-t500x500.') : null;
  const cover = h('div', { class: 'npv-cover' });
  if (big) cover.append(h('img', { src: big, 'data-px': 640, alt: '', referrerpolicy: 'no-referrer', onerror: (e) => { if (thumb && e.target.src !== thumb) e.target.src = thumb; else e.target.remove(); } }));
  else cover.innerHTML = icon('music');
  const liked = state.favKeys.has(track.key);
  const head = h('div', { class: 'npv-head' },
    h('div', {},
      h('div', { class: 'npv-title' }, track.title),
      track.artist ? h('button', { class: 'npv-artist', onclick: () => openArtist(track.artist, track) }, track.artist) : null),
    h('button', { class: `icon-btn like${liked ? ' on' : ''}`, title: liked ? 'Remove from Liked Songs' : 'Save to Liked Songs', html: icon(liked ? 'heartFill' : 'heart'), onclick: () => toggleFavorite(track) }));

  const about = h('div', { class: 'npv-card npv-about' });
  const nextCard = nextItem ? h('div', { class: 'npv-card' },
    h('h4', {}, 'Next in queue', h('button', { onclick: () => showPanel('queue') }, 'Open queue')),
    (() => {
      const row = h('div', { class: 'npv-next' }, thumbEl(nextItem.track.thumbnail, 'thumb', nextItem.track.key || nextItem.track.title),
        h('div', { class: 't-main' }, h('div', { class: 't-title' }, nextItem.track.title), h('div', { class: 't-sub' }, nextItem.track.artist || '')));
      row.addEventListener('click', () => call('play_index_cmd', { index: (state.queue.current ?? -1) + 1 }));
      return row;
    })()) : null;
  const via = $('#np-via').cloneNode(true);
  via.removeAttribute('id');
  const source = h('div', { class: 'npv-card' }, h('h4', {}, 'Playing from', h('button', { onclick: () => openVersions(track, { queueUid: p.current.uid, current: p.version?.platform }) }, 'Change source')),
    h('div', { class: 'npv-source' }, via, p.version?.album ? h('div', {}, `Album: ${p.version.album}`) : null));
  box.replaceChildren(...[cover, head, about, nextCard, source].filter(Boolean));
  if (track.artist) fillArtistCard(about, track);
  else about.remove();
}

async function fillArtistCard(el, track) {
  const name = track.artist.split(/, | & | feat\.? /i)[0].trim();
  const seq = ++npv.seq;
  let info = npv.artistCache.get(name);
  if (!info) {
    try {
      info = await call('ytm_artist', { name, browseId: artistBrowseId(track) });
      if (npv.artistCache.size > 30) npv.artistCache.delete(npv.artistCache.keys().next().value);
      npv.artistCache.set(name, info);
    } catch { el.remove(); return; }
  }
  if (seq !== npv.seq || !el.isConnected) return;
  const banner = h('div', { class: 'npv-banner' });
  if (info.banner || info.thumbnail) banner.style.backgroundImage = `url("${bannerUrl(info.banner || info.thumbnail, 640).replace(/"/g, '%22')}")`;
  el.replaceChildren(banner, h('div', { class: 'npv-about-body' },
    h('div', { class: 'npv-about-name' }, info.name),
    h('div', { class: 'npv-about-row' }, h('span', {}, info.audience || info.subscribers || ''), followButton(info.name, `https://www.youtube.com/channel/${info.browse_id}`, info.thumbnail)),
    info.description ? h('div', { class: 'npv-about-desc' }, info.description) : null));
  el.onclick = (e) => { if (!e.target.closest('button')) openArtist(info.name, track, { browseId: info.browse_id }); };
}

/** The YouTube Music channel id from a track's artist link, if any. */
function artistBrowseId(track) {
  const u = track?.versions?.map((v) => v.artist_url).find((x) => x && /\/channel\/UC/.test(x));
  return u ? u.match(/channel\/(UC[\w-]+)/)[1] : null;
}

// Player bar extras -----------------------------------------------------------------
$('#btn-shuffle').addEventListener('click', async () => {
  const on = !state.settings?.shuffle;
  try {
    await call('set_shuffle', { on });
    state.settings.shuffle = on;
    paintShuffle();
  } catch (e) { toast(errMsg(e), 'error'); }
});
function paintShuffle() {
  const on = !!(state.playback?.shuffle ?? state.settings?.shuffle);
  $('#btn-shuffle').classList.toggle('on', on);
  $('#btn-shuffle').title = on ? 'Disable shuffle' : 'Enable shuffle';
}

$('#btn-device').addEventListener('click', async (e) => {
  const anchor = e.currentTarget;
  let devs = [];
  try { devs = (await call('list_output_devices')) || []; } catch { /* none */ }
  const cur = state.settings?.output_device || '';
  const sysName = devs.find((d) => d.default)?.name;
  openMenu(anchor, [
    { label: 'Connect to a device', heading: true },
    { label: 'System default', sub: sysName ? `Now: ${sysName}` : 'Follows Windows sound settings', icon: 'speaker', checked: cur === '', onClick: () => setDevice('') },
    ...(devs.length ? ['sep'] : []),
    ...devs.map((d) => ({ label: d.name, sub: d.default ? 'Default output' : null, icon: 'speaker', checked: cur === d.id, onClick: () => setDevice(d.id) })),
  ]);
  openMenuEl?.classList.add('device-menu');
});
async function setDevice(id) {
  await updateSettings({ output_device: id });
  $('#btn-device').classList.toggle('on', !!id);
  toast('Output device changed', 'ok', 1500);
}

/// Sleep timer
// A popover built once (only the countdown text updates, so buttons never
// flicker or miss clicks): a ring with the time left and +15 min / Turn off
// while a timer runs, preset chips, and a slider for any length. It opens
// upwards from the moon button, so it never covers the player bar.
let sleepTotal = 0;
$('#btn-sleep').addEventListener('click', (e) => openSleepTimer(e.currentTarget));
function openSleepTimer(anchor) {
  if (openMenuEl?.classList.contains('sleep-pop')) { closeMenu(); return; }
  closeMenu();
  const fmtLen = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
  const set = (minutes, endOfTrack = false, { close = false } = {}) => call('set_sleep_timer', { minutes, endOfTrack }).then((r) => {
    if (state.playback) state.playback.sleep_at = r == null ? null : r === 0 ? 0 : Date.now() + minutes * 60000;
    sleepTotal = r > 0 ? minutes * 60000 : 0;
    toast(r == null ? 'Sleep timer off' : r === 0 ? 'The music stops at the end of this song' : `The music stops in ${fmtLen(minutes)}`, 'ok', 2000);
    paintSleep();
    if (close) closeMenu(); else paint(true);
  }).catch((err) => toast(errMsg(err), 'error'));

  // Running: a ring with the time left, and +15 min / Turn off.
  const R = 34, C = 2 * Math.PI * R;
  const ring = h('div', { class: 'sp-ring', html: `<svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="${R}" class="sp-ring-bg"/><circle cx="40" cy="40" r="${R}" class="sp-ring-fg" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg>` });
  const fg = ring.querySelector('.sp-ring-fg');
  const time = h('span', { class: 'sp-time' });
  const sub = h('span', { class: 'sp-sub' });
  const plus = h('button', { class: 'sp-btn', onclick: () => { const at = state.playback?.sleep_at; set((at > 0 ? Math.ceil((at - Date.now()) / 60000) : 0) + 15); } }, '+15 min');
  const off = h('button', { class: 'sp-btn', onclick: () => set(null) }, 'Turn off');
  const running = h('div', { class: 'sp-running' },
    h('div', { class: 'sp-dial' }, ring, h('div', { class: 'sp-readout' }, time, sub)),
    h('div', { class: 'sp-actions' }, plus, off));
  const idle = h('p', { class: 'sp-hint' }, 'Fall asleep to your music. It pauses on its own.');

  const chip = (label, onClick) => h('button', { class: 'sp-chip', onclick: onClick }, label);
  const chips = h('div', { class: 'sp-chips' },
    ...[15, 30, 45, 60, 90].map((m) => chip(fmtLen(m), () => set(m, false, { close: true }))),
    chip('End of song', () => set(null, true, { close: true })));

  const val = h('b', { class: 'sp-val' });
  const range = h('input', { type: 'range', min: 5, max: 180, step: 5, value: 20, 'aria-label': 'Minutes' });
  const fill = () => { val.textContent = fmtLen(Number(range.value)); range.style.setProperty('--fill', `${((range.value - 5) / 175) * 100}%`); };
  range.addEventListener('input', fill);
  fill();
  const custom = h('div', { class: 'sp-custom' },
    h('div', { class: 'sp-custom-top' }, h('span', {}, 'Custom'), val),
    h('div', { class: 'sp-custom-row' }, range, h('button', { class: 'sp-start', onclick: () => set(Number(range.value), false, { close: true }) }, 'Start')));

  const pop = h('div', { class: 'menu sleep-pop', role: 'dialog', 'aria-label': 'Sleep timer' },
    h('div', { class: 'sp-head' }, h('span', { class: 'sp-ico', html: icon('moon') }), h('b', {}, 'Sleep timer')),
    running, idle, chips, custom);

  let mode = '';
  function paint(force = false) {
    const at = state.playback?.sleep_at;
    const m = at == null ? 'idle' : at === 0 ? 'song' : 'time';
    if (m !== mode || force) {
      mode = m;
      running.hidden = m === 'idle';
      idle.hidden = m !== 'idle';
      plus.hidden = m === 'song';
    }
    if (m === 'song') {
      time.textContent = '♪';
      sub.textContent = 'after this song';
      fg.style.strokeDashoffset = '0';
    } else if (m === 'time') {
      const left = Math.max(0, at - Date.now());
      const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
      time.textContent = mm >= 60 ? `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
      sub.textContent = 'left';
      if (!sleepTotal || sleepTotal < left) sleepTotal = Math.ceil(left / 300000) * 300000;
      fg.style.strokeDashoffset = String(C * (1 - left / sleepTotal));
    }
  }
  paint(true);
  const tick = setInterval(() => { if (!pop.isConnected) { clearInterval(tick); return; } paint(); }, 1000);
  document.body.append(pop);
  // Anchored by its bottom edge: it grows upwards when the countdown appears.
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - pop.offsetWidth / 2, window.innerWidth - pop.offsetWidth - 8))}px`;
  // Above the button; below it when there's no room (a button at the top).
  if (r.top - 10 >= pop.offsetHeight + 8) {
    pop.style.top = 'auto';
    pop.style.bottom = `${Math.max(8, window.innerHeight - r.top + 10)}px`;
  } else {
    pop.style.bottom = 'auto';
    pop.style.top = `${Math.min(r.bottom + 10, window.innerHeight - pop.offsetHeight - 8)}px`;
  }
  pop.onClose = () => clearInterval(tick);
  openMenuEl = pop;
}
function paintSleep() {
  const btn = $('#btn-sleep');
  const at = state.playback?.sleep_at;
  btn.classList.toggle('on', at != null);
  const mins = at > 0 ? Math.max(1, Math.round((at - Date.now()) / 60000)) : 0;
  btn.title = at == null ? 'Sleep timer' : at === 0 ? 'Sleep timer: stops after this song' : `Sleep timer: ${mins} min left`;
  const label = at == null ? '' : at === 0 ? '♪' : String(mins);
  let badge = btn.querySelector('.sleep-left');
  if (!label) { badge?.remove(); return; }
  if (!badge) { badge = h('span', { class: 'sleep-left' }); btn.append(badge); }
  if (badge.textContent !== label) badge.textContent = label;
}
setInterval(paintSleep, 15000);

// Full screen player
const fsp = { el: null };
$('#btn-full').addEventListener('click', () => (fsp.el ? closeFullscreen() : openFullscreen()));
function openFullscreen() {
  const bg = h('div', { class: 'fs-bg' });
  const el = h('div', { class: 'fs-player', role: 'dialog', 'aria-label': 'Full screen' }, bg,
    h('button', { class: 'fs-close', title: 'Exit full screen (Esc)', html: icon('x'), onclick: closeFullscreen }),
    h('div', { class: 'fs-main' }, h('div', { class: 'fs-cover' }), h('div', { class: 'fs-meta' }, h('div', { class: 'fs-title' }), h('div', { class: 'fs-artist' }))),
    h('div', { class: 'fs-bottom' },
      h('div', { class: 'fs-progress' }, h('i')),
      h('div', { class: 'fs-row' }, h('span', { class: 'fs-pos' }), h('span', { class: 'fs-dur' })),
      h('div', { class: 'fs-controls' },
        h('button', { title: 'Previous', html: icon('prev'), onclick: () => call('previous_track') }),
        h('button', { class: 'fs-play', title: 'Play / pause', html: icon('play'), onclick: () => call('toggle_pause') }),
        h('button', { title: 'Next', html: icon('next'), onclick: () => call('next_track') }))));
  document.body.append(el);
  fsp.el = el;
  appWindow?.setFullscreen?.(true).catch(() => {});
  paintFullscreen();
}
function closeFullscreen() {
  fsp.el?.remove();
  fsp.el = null;
  appWindow?.setFullscreen?.(false).catch(() => {});
}
function paintFullscreen() {
  const el = fsp.el;
  if (!el) return;
  const p = state.playback;
  const t = p?.current?.track;
  const thumb = p?.version?.thumbnail || t?.thumbnail;
  const big = thumb ? thumb.replace(/=w\d+-h\d+/, '=w1200-h1200') : null;
  const cover = $('.fs-cover', el);
  if (cover.dataset.src !== (big || '')) {
    cover.dataset.src = big || '';
    cover.replaceChildren(...(big ? [h('img', { src: big, 'data-px': 1000, alt: '', referrerpolicy: 'no-referrer', onerror: (e) => { if (thumb) e.target.src = thumb; } })] : []));
    el.style.setProperty('--fs-art', big ? `url("${big.replace(/"/g, '%22')}")` : 'none');
  }
  $('.fs-title', el).textContent = t?.title || 'Nothing playing';
  $('.fs-artist', el).textContent = t?.artist || '';
  $('.fs-play', el).innerHTML = icon(p?.status === 'playing' ? 'pause' : 'play');
  const dur = p?.duration || 0;
  $('.fs-progress i', el).style.width = `${dur ? Math.min(100, (p.position / dur) * 100) : 0}%`;
  $('.fs-pos', el).textContent = fmtTime(p?.position || 0);
  $('.fs-dur', el).textContent = fmtTime(dur);
}

// Problems with yt-dlp show up as a red pill in the title bar (otherwise hidden).
function paintHealth() {
  // Android: yt-dlp is only the fallback (see boot.js), so no red pill.
  const bad = $('#health').classList.contains('bad') && !/Android/i.test(navigator.userAgent);
  const pill = $('#health-bad');
  pill.hidden = !bad;
  if (bad) {
    pill.textContent = /Android/i.test(navigator.userAgent) ? 'Can’t play' : 'yt-dlp missing';
    pill.title = $('#health').title;
    pill.onclick = () => offerYtdlpInstall($('#health').title);
  }
}

/** Shown when yt-dlp isn't found: one click installs Tunewire's own copy. */
function offerYtdlpInstall(message) {
  // Android: yt-dlp is built into the app (there's nothing to download);
  // it can only be started again.
  if (/Android/i.test(navigator.userAgent)) {
    const status = h('p', { class: 'muted small min-h-18' });
    const retry = h('button', { class: 'btn primary' }, 'Try again');
    const m = openModal({
      title: 'Songs can’t play right now',
      subtitle: message,
      body: h('div', {}, h('p', {}, 'Tunewire’s built-in player (yt-dlp) didn’t start. Trying again usually fixes it; if not, close Tunewire completely and open it again.'), status),
      footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Not now'), retry],
    });
    retry.addEventListener('click', async () => {
      retry.disabled = true;
      status.innerHTML = '<span class="spinner"></span> Starting yt-dlp…';
      const health = await checkHealth().catch((e) => ({ ok: false, message: errMsg(e) }));
      paintHealth();
      if (health.ok) { m.close(); toast('Ready to play', 'ok', 2000); }
      else { status.textContent = health.message; retry.disabled = false; }
    });
    return;
  }
  const status = h('p', { class: 'muted small min-h-18' });
  const install = h('button', { class: 'btn primary' }, 'Install it for me');
  const m = openModal({
    title: 'yt-dlp is needed to play music',
    subtitle: message,
    body: h('div', {},
      h('p', {}, 'Tunewire uses yt-dlp to find and stream songs. It can download its own up-to-date copy (the official build from GitHub, checksum-verified). Nothing else on your computer is changed.'),
      h('details', {}, h('summary', { class: 'muted small pointer' }, 'Prefer to install it yourself?'),
        h('pre', { class: 'card fs-12 prewrap mt-8'}, 'Windows: winget install yt-dlp\nmacOS:   brew install yt-dlp\nLinux:   pipx install yt-dlp')),
      status),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Not now'), install],
  });
  install.addEventListener('click', async () => {
    install.disabled = true;
    status.innerHTML = '<span class="spinner"></span> Downloading yt-dlp…';
    try {
      const r = await call('ytdlp_install');
      state.settings = await call('get_settings');
      const health = await checkHealth();
      paintHealth();
      if (health.ok) { m.close(); toast(`yt-dlp ${r.version || ''} installed. You’re ready to go.`, 'ok'); }
      else status.textContent = health.message;
    } catch (e) {
      status.textContent = errMsg(e);
      install.disabled = false;
      install.textContent = 'Try again';
    }
  });
}

// Player bar, right side: the buttons in tidy groups (views · Together ·
// output and sleep · volume · full screen) instead of a loose row.
(function groupSideControls() {
  const bar = $('.side-controls');
  if (!bar) return;
  const group = (cls, ids) => {
    const box = h('div', { class: `sc-group ${cls}` });
    for (const id of ids) { const el = document.getElementById(id); if (el) box.append(el); }
    return box;
  };
  const views = group('views', ['btn-np', 'btn-lyrics', 'toggle-queue']);
  const out = group('out', ['btn-device', 'btn-sleep']);
  const vol = group('vol', ['btn-mute', 'volume']);
  bar.replaceChildren(...[$('#plugin-player-slot'), views, $('#btn-jam'), out, vol, $('#btn-full'), $('#btn-more')].filter(Boolean));
})();
