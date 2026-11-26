'use strict';

// ===========================================================================
// Settings
// ===========================================================================

async function updateSettings(patch) {
  try {
    state.settings = await call('update_settings', { patch });
  } catch (e) { toast(errMsg(e), 'error'); }
}

/** Android has no tray, output picker, spotDL, Discord client, system yt-dlp
 *  or keyboard: these settings don't show there. */
const ANDROID = /Android/i.test(navigator.userAgent);
const ANDROID_HIDDEN = new Set(['Download folder', 'Music folders', 'Close to tray', 'Output device', 'spotDL (optional fallback)', 'Spotify app credentials (spotDL)', 'yt-dlp copy', 'Keyboard shortcuts']);
const hiddenHere = (label) => ANDROID && ANDROID_HIDDEN.has(label);

function settingToggle(label, help, key) {
  if (hiddenHere(label)) return null;
  const input = h('input', { type: 'checkbox', checked: !!state.settings[key] });
  input.addEventListener('change', async () => {
    // Answering here counts as answering the first-run question.
    await updateSettings(key === 'error_reports' ? { error_reports: input.checked, privacy_asked: true } : { [key]: input.checked });
    if (key === 'discord_rpc') toast(input.checked ? 'Discord Rich Presence on' : 'Discord Rich Presence off', 'ok', 1800);
    if (key === 'show_sources') document.body.classList.toggle('show-sources', input.checked);
    if (key === 'cover_colors') {
      if (input.checked) updateAppColors();
      else clearCoverAccent();
    }
  });
  return h('div', { class: 'setting' }, h('div', { class: 'label' }, label, h('small', { html: help })), h('label', { class: 'switch' }, input, h('span')));
}

function settingRow(label, help, control) {
  if (hiddenHere(label)) return null;
  return h('div', { class: 'setting' }, h('div', { class: 'label' }, label, help ? h('small', { html: help }) : null), control);
}

function applyGlassTransparency(value = state.settings?.glass_transparency ?? 58) {
  document.documentElement.style.setProperty('--glass-transparency', `${value}%`);
}

function glassTransparencyControl() {
  const value = state.settings.glass_transparency ?? 58;
  const label = h('span', { class: 'meta w-38 text-right' }, `${value}%`);
  const range = h('input', { class: 'w-160', type: 'range', min: 0, max: 80, step: 5, value });
  range.style.setProperty('--fill', `${(value / 80) * 100}%`);
  range.addEventListener('input', () => {
    label.textContent = `${range.value}%`;
    range.style.setProperty('--fill', `${(Number(range.value) / 80) * 100}%`);
    applyGlassTransparency(Number(range.value));
  });
  range.addEventListener('change', () => updateSettings({ glass_transparency: Number(range.value) }));
  return h('div', { class: 'actions' }, range, label);
}

const GROUP_ICONS = { Account: 'user', Appearance: 'palette', Playback: 'play', Audio: 'sliders', Lyrics: 'mic', 'Downloads & local files': 'download', Scrobbling: 'pulse', Privacy: 'info', Backup: 'save', Tools: 'gear' };
const groupId = (title) => `set-${title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`;

function group(title, brand, ...rows) {
  if (ANDROID && title === 'Discord') return null; // Rich Presence needs the Discord desktop app
  if (!rows.some(Boolean)) return null; // every row left out here
  const ico = brand ? plogo(brand) : icon(GROUP_ICONS[title] || 'sliders');
  return h('section', { class: `group settings-card ${brand || ''}`, id: groupId(title), 'data-title': title },
    h('h2', { html: `<span class="sc-ico">${ico}</span><span>${esc(title)}</span>` }), h('div', { class: 'sc-rows' }, ...rows));
}

/** Chips to jump between sections; the one in view is highlighted. */
function settingsNav(body) {
  const cards = $$('.settings-card', body);
  const scroller = body.closest('.view');
  // Scroll the page itself to the section, below the sticky tab bar.
  // (scrollIntoView from the tab bar's own update below cancelled a smooth
  // page scroll halfway on Android, so neither uses it.)
  const go = (c) => {
    // Where the tab bar sticks: the view's top + its padding + the bar's own `top`.
    const stuck = parseFloat(getComputedStyle(scroller).paddingTop) + (parseFloat(getComputedStyle(nav).top) || 0);
    const top = scroller.scrollTop + c.getBoundingClientRect().top - scroller.getBoundingClientRect().top - stuck - nav.offsetHeight - 8;
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    // The tapped tab stays lit (a short section can't reach the top, so the
    // next one would light up instead).
    for (const b of nav.children) b.classList.toggle('on', b.dataset.for === c.id);
    picked = Date.now();
  };
  let picked = 0;
  const nav = h('nav', { class: 'settings-nav', 'aria-label': 'Settings sections' }, ...cards.map((c) => h('button', { 'data-for': c.id, onclick: () => go(c) }, c.dataset.title)));
  const io = new IntersectionObserver((entries) => {
    const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!top || Date.now() - picked < 1200) return;
    for (const b of nav.children) b.classList.toggle('on', b.dataset.for === top.target.id);
    // Keep the lit tab in view: the tab row scrolls sideways, nothing else.
    const on = nav.querySelector('.on');
    if (on && (on.offsetLeft < nav.scrollLeft || on.offsetLeft + on.offsetWidth > nav.scrollLeft + nav.clientWidth)) {
      nav.scrollTo({ left: on.offsetLeft - 14, behavior: 'smooth' });
    }
  }, { root: scroller, rootMargin: '-60px 0px -60% 0px' });
  cards.forEach((c) => io.observe(c));
  return nav;
}

let discordPoll = null;
function discordStatusRow() {
  const pill = h('span', { class: 'status-pill' }, '…');
  const help = h('small', {});
  const update = async () => {
    if (!pill.isConnected) { clearInterval(discordPoll); discordPoll = null; return; }
    const s = await call('discord_status').catch(() => 'error: unavailable');
    const ok = s === 'connected';
    pill.className = `status-pill ${ok ? 'ok' : s === 'off' ? '' : 'bad'}`;
    pill.textContent = ok ? 'Connected' : s === 'off' ? 'Off' : s.startsWith('waiting') ? 'Not connected' : 'Error';
    help.innerHTML = ok ? 'Your profile shows the current song while something is playing.'
      : s === 'off' ? 'Turn on Rich Presence below.'
      : s.includes('socket') ? 'No Discord client socket found. Start Discord. If you use <b>Vesktop</b>, open its Settings → Vesktop Settings and enable <b>arRPC</b> (Rich Presence); Vesktop only accepts other apps when that is on.'
      : esc(s.replace(/^(waiting|error): /, ''));
  };
  update();
  clearInterval(discordPoll);
  discordPoll = setInterval(update, 2000);
  return h('div', { class: 'setting' }, h('div', { class: 'label' }, 'Status', help), pill);
}

function renderSettings() {
  const s = state.settings;
  const body = $('#settings-body');

  const order = h('div', { class: 'order-list' });
  const move = async (i, d) => {
    const arr = [...s.platform_order];
    [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
    await updateSettings({ platform_order: arr });
    renderSettings();
  };
  order.replaceChildren(...s.platform_order.map((p, i) => h('div', { class: 'order-item' },
    h('span', { class: 'n' }, String(i + 1)), miniLogo(p), h('span', { class: 'name' }, PLATFORMS[p].label),
    h('button', { class: 'icon-btn small', html: icon('up'), disabled: i === 0, title: 'Move up', onclick: () => move(i, -1) }),
    h('button', { class: 'icon-btn small', html: icon('down'), disabled: i === s.platform_order.length - 1, title: 'Move down', onclick: () => move(i, 1) }))));
  const limit = h('input', { class: 'w-70', type: 'number', min: 3, max: 40, value: s.search_limit });
  limit.addEventListener('change', () => updateSettings({ search_limit: Number(limit.value) }));

  const spotdl = state.tools?.spotdl;
  const backend = h('select', {},
    ...[['auto', 'Automatic'], ['embed', 'Spotify web only'], ['spotdl', 'spotDL for links'], ['off', 'Off']]
      .map(([v, l]) => h('option', { value: v, selected: s.spotify_backend === v }, l)));
  backend.addEventListener('change', () => updateSettings({ spotify_backend: backend.value }));
  const credId = h('input', { class: 'w-150', type: 'text', value: s.spotify_client_id || '', placeholder: 'Client ID', spellcheck: 'false' });
  const secretSaved = !!state.tools?.spotify_secret_saved;
  const credSecret = h('input', { class: 'w-150', type: 'password', value: '', placeholder: secretSaved ? 'Saved in keychain' : 'Client secret', spellcheck: 'false', autocomplete: 'off' });
  credId.addEventListener('change', () => updateSettings({ spotify_client_id: credId.value.trim() }).then(() => toast('Client ID saved', 'ok', 1500)));
  credSecret.addEventListener('change', async () => {
    try {
      await call('set_spotify_secret', { secret: credSecret.value.trim() });
      credSecret.value = '';
      await refreshTools();
      toast('Secret saved in your system keychain', 'ok', 2000);
      renderSettings();
    } catch (e) { toast(errMsg(e), 'error'); }
  });
  const user = state.spotifyUser;
  const account = h('div', { class: 'actions' },
    h('span', { class: `status-pill ${user ? 'ok' : ''}` }, user ? `Logged in: ${user}` : 'Not logged in'),
    user
      ? h('button', { class: 'btn small', onclick: async () => { await call('spotify_logout'); state.spotifyUser = null; toast('Logged out of Spotify', 'info', 1500); renderSettings(); } }, 'Log out')
      : h('button', { class: 'btn small primary', onclick: async (e) => {
          e.target.disabled = true;
          e.target.textContent = 'Waiting for browser…';
          try {
            state.spotifyUser = await call('spotify_login');
            toast(`Logged in to Spotify as ${state.spotifyUser}`, 'ok', 2500);
          } catch (err) { toast(errMsg(err), 'error'); }
          renderSettings();
        } }, 'Log in with Spotify'));
  const recheck = (fn) => h('button', { class: 'btn small', onclick: async () => { await fn(); renderSettings(); } }, 'Check again');

  body.replaceChildren(
    group('Account', null, ...accountSettingsRows()),
    group('Appearance', null,
      settingRow('Background', 'The playing song’s cover, or an animated background: stars, snow, rain on glass, hyperspace (moves with the music) or a lava lamp.', backgroundControl()),
      settingRow('Background strength', null, strengthControl()),
      settingRow('Glass transparency', 'Choose how much of the background shows through the panels.', glassTransparencyControl()),
      settingToggle('Colors from the cover', 'Tint the app from the playing song’s cover. Off: keep the black-and-white palette.', 'cover_colors'),
      settingToggle('Show source icons on songs', 'Always show the YouTube Music / SoundCloud / YouTube / Spotify icons on song rows (otherwise only when you hover a song).', 'show_sources')),
    group('Playback', null,
      settingRow('Source priority', 'When a song exists on several platforms, the first available one plays. If it fails, the next one is tried.', order),
      settingRow('Results per source', null, limit),
      settingToggle('Search YouTube in “All”', 'Adds regular YouTube uploads (live versions, covers) to combined searches.', 'include_youtube_in_all'),
      settingToggle('Autoplay', 'When the queue runs out, keep playing similar songs (YouTube Music radio).', 'autoplay'),
      settingToggle('Close to tray', 'Closing the window keeps music playing. Quit from the tray icon.', 'close_to_tray')),
    group('Audio', null,
      settingToggle('Volume normalization', 'Evens out loudness between songs and platforms. Measured from the first seconds of each song, with a soft limiter against clipping.', 'normalize'),
      settingRow('Crossfade', 'Overlap the end of a song with the start of the next. At 0, songs still play back to back without a gap.', crossfadeControl()),
      settingRow('Output device', 'Where the sound goes. Switching continues the current song on the new device.', outputDeviceControl()),
      eqSetting()),
    group('Lyrics', null,
      settingToggle('Show lyrics', 'Fetches synced lyrics from LRCLIB (lrclib.net) for the Lyrics tab next to the queue.', 'lyrics')),
    group('Downloads & local files', null,
      settingRow('Download folder', esc(s.downloads_dir || 'Default (app data folder)'), h('div', { class: 'actions' },
        h('button', { class: 'btn small', onclick: async () => { const d = await pickFolder('Choose download folder'); if (d) { await updateSettings({ downloads_dir: d }); renderSettings(); } } }, 'Change'),
        s.downloads_dir ? h('button', { class: 'btn small', onclick: async () => { await updateSettings({ downloads_dir: '' }); renderSettings(); } }, 'Reset') : null)),
      settingRow('Music folders', (s.local_folders || []).length ? s.local_folders.map(esc).join('<br>') : 'None. Local files are searched together with online sources.', h('button', { class: 'btn small', onclick: () => showView('local') }, 'Manage'))),
    group('Spotify', 'spotify',
      settingRow('Spotify account', 'Log in to play Spotify’s own audio (Ogg Vorbis up to 320 kbps) when you pick Spotify as the source. Needs <b>Spotify Premium</b>; your login opens in the browser and only a reusable token is stored on this computer. Without it, Spotify songs play from the same recording on YouTube Music.', account),
      settingRow('Metadata source', 'Search uses Spotify’s own web search (no account needed); pasted links load from the public embed page. spotDL is only a fallback.', backend),
      settingRow('spotDL (optional fallback)', spotdl ? `Version ${spotdl}` : 'Not installed. Optional: <code>pipx install spotdl</code> or <code>uv tool install spotdl</code>.',
        h('div', { class: 'actions' }, h('span', { class: `status-pill ${spotdl ? 'ok' : 'bad'}` }, spotdl ? 'Installed' : 'Missing'), recheck(refreshTools))),
      settingToggle('Search Spotify in “All”', 'Adds Spotify results to combined searches (about half a second).', 'include_spotify_in_all'),
      settingRow('Spotify app credentials (spotDL)', 'Only used by the spotDL fallback. Its built-in credentials are shared and often rate-limited, which can make it take a minute. A free app from <code>developer.spotify.com/dashboard</code> avoids that (redirect URI: <code>http://127.0.0.1:9900/</code>). The secret is stored in your system keychain, not in a file.', h('div', { class: 'actions' }, credId, credSecret))),
    group('Discord', 'discord',
      discordStatusRow(),
      settingToggle('Rich Presence', 'Shows the current song, artist, cover and progress on your Discord profile while the desktop client is running.', 'discord_rpc'),
      settingToggle('Link button', 'Adds an “Open on YouTube Music” (or SoundCloud, …) button to the status.', 'discord_buttons')),
    group('Scrobbling', null, ...scrobbleSettingsRows()),
    group('Privacy', null,
      settingToggle('Send error reports', 'Off unless you turn it on. When something breaks, Tunewire sends the developer a short report (app version, operating system and the error) so it can be fixed. Your folder paths and stream links are removed first; nothing about your library is sent.', 'error_reports')),
    group('Backup', null, ...backupSettingsRows()),
    group('Tools', null,
      updateSettingsRow(),
      // Android: yt-dlp is only the fallback there (songs play without it), so
      // its status is a calm line, not a raw error with file paths.
      settingRow(ANDROID ? 'yt-dlp (fallback)' : 'yt-dlp', ANDROID
        ? ($('#health').classList.contains('ok') ? `Ready (${esc($('#health .health-text')?.textContent || '')}). Only used when a song can't load the usual way.` : 'Not running on this device. You don’t need it: YouTube, YouTube Music and Spotify songs play without it.')
        : `${esc($('#health').title || '')}<br><code>${esc(state.ytdlpPath || '')}</code>`, recheck(checkHealth)),
      settingRow('yt-dlp copy', 'Use the yt-dlp installed on your system, or let Tunewire keep its own up-to-date copy (official build from GitHub, checksum-verified).', ytdlpControl()),
      settingRow('Clear cache', 'Frees the space Tunewire uses to load things faster: saved song links, search results, cover images and temporary song files. Your library, playlists, history and settings stay. Things load a little slower once afterwards.', clearCacheButton()),
      settingRow('Keyboard shortcuts', null, h('button', { class: 'btn small', onclick: showShortcuts }, 'Show'))));
  body.prepend(settingsNav(body));
}

function clearCacheButton() {
  const btn = h('button', { class: 'btn small' }, 'Clear');
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Clearing…';
    try {
      const bytes = await call('clear_cache');
      const mb = bytes / (1024 * 1024);
      toast(mb >= 1 ? `Cache cleared: ${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB freed` : 'Cache cleared');
    } catch (e) {
      toast(`Couldn't clear the cache: ${errMsg(e)}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Clear';
    }
  };
  return btn;
}

async function refreshTools() {
  state.tools = await call('tools_status').catch(() => ({ spotdl: null }));
  state.spotifyUser = await call('spotify_account').catch(() => null);
  const el = $('#health-spotdl');
  const mode = state.settings?.spotify_backend;
  el.className = `health ${state.tools.spotdl ? 'ok' : mode === 'off' || mode === 'embed' ? 'off' : 'bad'}`;
  $('.health-text', el).textContent = state.tools.spotdl ? `spotDL ${state.tools.spotdl}` : 'spotDL not installed';
  el.title = state.tools.spotdl ? 'Spotify search & playlists available' : 'Install spotDL for Spotify search (pipx install spotdl)';
  if (state.view === 'search' && $('#search-body').hidden) renderHero();
}

async function checkHealth(target) {
  const el = $('#health');
  el.className = 'health';
  $('.health-text', el).textContent = 'Checking yt-dlp…';
  const res = await call('health_check').catch((e) => ({ ok: false, message: errMsg(e) }));
  el.classList.add(res.ok ? 'ok' : 'bad');
  $('.health-text', el).textContent = res.ok ? `yt-dlp ${res.version}` : 'yt-dlp missing';
  el.title = res.message;
  state.ytdlpPath = res.path;
  if (target) target.textContent = res.message;
  return res;
}

function backgroundControl() {
  const s = state.settings;
  const sel = h('select', {},
    ...[['art', 'Playing song’s cover'], ['stars', 'Starfield'], ['snow', 'Snowfall'], ['rain', 'Rain on glass'], ['hyperspace', 'Hyperspace'], ['lava', 'Lava lamp']]
      .map(([v, l]) => h('option', { value: v, selected: (s.background || 'art') === v }, l)));
  sel.addEventListener('change', async () => {
    await updateSettings({ background: sel.value });
    updateAmbient();
  });
  return sel;
}

function strengthControl() {
  const v = state.settings.background_strength ?? 45;
  const label = h('span', { class: 'meta w-38 text-right' }, `${v}%`);
  const range = h('input', { class: 'w-160', type: 'range', min: 0, max: 100, step: 5, value: v });
  range.style.setProperty('--fill', `${v}%`);
  range.addEventListener('input', () => {
    label.textContent = `${range.value}%`;
    range.style.setProperty('--fill', `${range.value}%`);
    document.documentElement.style.setProperty('--amb-strength', (range.value / 100).toFixed(2));
  });
  range.addEventListener('change', () => updateSettings({ background_strength: Number(range.value) }));
  return h('div', { class: 'actions' }, range, label);
}

function outputDeviceControl() {
  const sel = h('select', { class: 'maxw-240' }, h('option', { value: '' }, 'System default'));
  call('list_output_devices').then((devs) => {
    for (const d of devs) sel.append(h('option', { value: d.id, selected: d.id === state.settings.output_device }, d.default ? `${d.name} (default)` : d.name));
    if (state.settings.output_device && !devs.some((d) => d.id === state.settings.output_device)) {
      sel.append(h('option', { value: state.settings.output_device, selected: true }, 'Saved device (not connected)'));
    }
  }).catch(() => {});
  sel.addEventListener('change', () => updateSettings({ output_device: sel.value }).then(() => toast('Output device changed', 'ok', 1500)));
  return sel;
}

const EQ_BANDS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const EQ_PRESETS = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'Treble boost': [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  Vocal: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
  Loudness: [5, 4, 2, 0, -1, 0, 1, 2, 4, 5],
  Electronic: [4, 3, 1, 0, -1, 1, 0, 1, 3, 4],
  Rock: [4, 3, 1, -1, -2, -1, 1, 2, 3, 4],
  Acoustic: [3, 2, 1, 1, 2, 2, 2, 2, 1, 1],
  'Bass cut': [-6, -5, -3, -1, 0, 0, 0, 0, 0, 0],
};

function eqSetting() {
  const s = state.settings;
  const gains = [...(s.eq_gains || EQ_PRESETS.Flat)].map(Number);
  const presetName = () => Object.keys(EQ_PRESETS).find((k) => EQ_PRESETS[k].every((g, i) => g === gains[i])) || 'Custom';
  const preset = h('select', { 'aria-label': 'Equalizer preset' });
  const fillPresets = () => {
    const cur = presetName();
    preset.replaceChildren(...Object.keys(EQ_PRESETS).map((k) => h('option', { value: k, selected: k === cur }, k)),
      ...(cur === 'Custom' ? [h('option', { value: 'Custom', selected: true }, 'Custom')] : []));
  };
  const save = throttle(() => updateSettings({ eq_gains: gains }), 120);
  const enabled = h('input', { type: 'checkbox', checked: !!s.eq_enabled, 'aria-label': 'Enable equalizer' });
  const graph = eqGraph(gains, () => { fillPresets(); save(); }, () => enabled.checked);
  const applyPreset = (values) => {
    values.forEach((g, i) => { gains[i] = g; });
    fillPresets();
    graph.refresh();
    updateSettings({ eq_gains: gains });
  };
  preset.addEventListener('change', () => {
    const values = EQ_PRESETS[preset.value];
    if (values) applyPreset(values);
  });
  const reset = h('button', { class: 'btn small', onclick: () => applyPreset(EQ_PRESETS.Flat) }, 'Reset');
  fillPresets();
  const status = h('span', { class: `eq-status${s.eq_enabled ? ' on' : ''}` }, s.eq_enabled ? 'On' : 'Off');
  graph.el.classList.toggle('off', !s.eq_enabled);
  enabled.addEventListener('change', () => {
    graph.el.classList.toggle('off', !enabled.checked);
    status.classList.toggle('on', enabled.checked);
    status.textContent = enabled.checked ? 'On' : 'Off';
    graph.refresh();
    updateSettings({ eq_enabled: enabled.checked });
  });
  return h('div', { class: 'setting eq-setting' },
    h('div', { class: 'label' }, 'Equalizer', h('small', {}, isMobile ? 'Drag a band up or down, or tap its chip below the graph. While a song plays, its sound moves behind the curve.' : 'Drag a band up or down. Double-click to reset it, scroll to fine-tune, or select the graph and use the arrow keys. While a song plays, its sound moves behind the curve.')),
    h('div', { class: 'actions eq-actions' }, preset, reset, status, h('label', { class: 'switch' }, enabled, h('span'))),
    graph.el);
}

// Parametric-EQ style graph: the EQ's real response (same filters as the
// audio engine, eq.rs), a draggable node per band, and the live spectrum of
// the playing song behind it.
const EQ_HZ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_RANGE = 12; // dB above/below 0 (the bands' limit)

/** Magnitude response (dB) of band `i` at gain `gain` for frequency `f` (RBJ biquads, as in eq.rs). */
function eqBandDb(i, gain, f, rate = 48000) {
  if (Math.abs(gain) < 0.05) return 0;
  const A = 10 ** (gain / 40), w0 = 2 * Math.PI * EQ_HZ[i] / rate, cos = Math.cos(w0), sin = Math.sin(w0);
  let b0, b1, b2, a0, a1, a2;
  if (i === 0 || i === 9) {
    const alpha = sin / 2 * Math.SQRT2, k = 2 * Math.sqrt(A) * alpha;
    if (i === 0) {
      [b0, b1, b2] = [A * ((A + 1) - (A - 1) * cos + k), 2 * A * ((A - 1) - (A + 1) * cos), A * ((A + 1) - (A - 1) * cos - k)];
      [a0, a1, a2] = [(A + 1) + (A - 1) * cos + k, -2 * ((A - 1) + (A + 1) * cos), (A + 1) + (A - 1) * cos - k];
    } else {
      [b0, b1, b2] = [A * ((A + 1) + (A - 1) * cos + k), -2 * A * ((A - 1) + (A + 1) * cos), A * ((A + 1) + (A - 1) * cos - k)];
      [a0, a1, a2] = [(A + 1) - (A - 1) * cos + k, 2 * ((A - 1) - (A + 1) * cos), (A + 1) - (A - 1) * cos - k];
    }
  } else {
    const alpha = sin / (2 * 1.41);
    [b0, b1, b2, a0, a1, a2] = [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A];
  }
  const w = 2 * Math.PI * f / rate;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
  const dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** FL-style band colors, red through violet. */
function eqColor(i) {
  return `hsl(${Math.round(i * 31)} 85% 62%)`;
}

function eqGraph(gains, onChange, isOn) {
  const canvas = h('canvas', { class: 'eq-canvas', tabindex: '0', role: 'application', 'aria-label': 'Equalizer: left and right pick a band, up and down change it' });
  const tip = h('div', { class: 'eq-tip', hidden: true });
  let sel = -1, hover = -1, drag = null;
  const chips = EQ_HZ.map((f, i) => h('button', { class: 'eq-chip', style: `--c:${eqColor(i)}`, onclick: () => { sel = i; canvas.focus(); draw(); } },
    h('span', { class: 'eq-chip-hz' }, f >= 1000 ? `${f / 1000}k` : String(f)), h('span', { class: 'eq-chip-db' })));
  const el = h('div', { class: 'eq-graph' }, h('div', { class: 'eq-stage' }, canvas, tip), h('div', { class: 'eq-chips' }, ...chips));
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, spec = null, raf = 0, pending = false, live = false, last = 0;
  const PAD = { l: 34, r: 12, t: 14, b: 24 };
  const fx = (f) => PAD.l + (Math.log(f / 20) / Math.log(1000)) * (W - PAD.l - PAD.r);
  const gy = (db) => PAD.t + (1 - (db + EQ_RANGE) / (2 * EQ_RANGE)) * (H - PAD.t - PAD.b);
  const yToDb = (y) => ((1 - (y - PAD.t) / (H - PAD.t - PAD.b)) * 2 - 1) * EQ_RANGE;
  // Theme colors as plain rgba() numbers. The canvas on older WebViews
  // (Android 113 and before) can't read color-mix() or color(srgb ...): a
  // gradient then throws, a stroke silently keeps the last color.
  const probe = el.appendChild(h('span', { hidden: true }));
  const rgba = (css) => {
    // Already plain numbers (most calls, every frame): no style lookup.
    const plain = /^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)$/.exec(css);
    if (plain) return [+plain[1], +plain[2], +plain[3], plain[4] === undefined ? 1 : +plain[4]];
    probe.style.color = '';
    probe.style.color = css;
    const v = getComputedStyle(probe).color;
    const n = (v.match(/[\d.]+/g) || ['255', '255', '255']).map(Number);
    const k = v.startsWith('color(') ? 255 : 1; // color(srgb 0.96 0.96 0.96 / 0.5)
    return [n[0] * k, n[1] * k, n[2] * k, n[3] ?? 1];
  };
  const str = ([r, g, b, a]) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${+a.toFixed(3)})`;
  const cssVar = (name, dflt) => str(rgba(`var(${name}, ${dflt})`));
  // The color at pct% of its opacity.
  const mix = (c, pct) => { const [r, g, b, a] = rgba(c); return str([r, g, b, a * pct / 100]); };
  const fmtDb = (g) => `${g > 0 ? '+' : ''}${g.toFixed(1)} dB`;
  const fmtHz = (f) => (f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`);
  const PTS = 240;
  const FREQS = Array.from({ length: PTS }, (_, k) => 20 * 1000 ** (k / (PTS - 1)));
  // The combined curve at `f`; a band's dot sits on it (like FL Studio), so
  // dragging a dot visibly pulls the line along with it.
  const totalAt = (f) => gains.reduce((a, g, i) => a + eqBandDb(i, g, f), 0);
  const nodeY = (i) => gy(Math.max(-EQ_RANGE - 3, Math.min(EQ_RANGE + 3, totalAt(EQ_HZ[i]))));

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    draw();
  }

  function draw() {
    if (!W) return;
    const on = isOn();
    const text = cssVar('--text', '#fff'), faint = cssVar('--text-faint', '#777'), accent = cssVar('--accent', '#fff');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // Grid and scales.
    ctx.font = '10px system-ui, sans-serif';
    ctx.lineWidth = 1;
    for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
      const x = Math.round(fx(f)) + 0.5;
      ctx.strokeStyle = mix(text, f === 100 || f === 1000 || f === 10000 ? 11 : 6);
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, H - PAD.b); ctx.stroke();
      ctx.fillStyle = faint;
      ctx.textAlign = f === 20 ? 'left' : f === 20000 ? 'right' : 'center';
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x, H - 8);
    }
    for (const db of [-12, -6, 0, 6, 12]) {
      const y = Math.round(gy(db)) + 0.5;
      ctx.strokeStyle = mix(text, db === 0 ? 18 : 6);
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
      ctx.fillStyle = faint; ctx.textAlign = 'right';
      ctx.fillText(db > 0 ? `+${db}` : String(db), PAD.l - 7, y + 3);
    }
    // Live spectrum of what's playing (-78..0 dBFS over the full height).
    if (spec && spec.length) {
      const n = spec.length, top = PAD.t, bot = H - PAD.b;
      const sy = (db) => bot - Math.max(0, Math.min(1, (db + 78) / 78)) * (bot - top);
      const sx = (i) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
      ctx.beginPath(); ctx.moveTo(sx(0), bot);
      for (let i = 0; i < n; i++) ctx.lineTo(sx(i), sy(spec[i]));
      ctx.lineTo(sx(n - 1), bot); ctx.closePath();
      const g = ctx.createLinearGradient(0, top, 0, bot);
      g.addColorStop(0, mix(text, 30));
      g.addColorStop(1, mix(text, 3));
      ctx.fillStyle = g; ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < n; i++) { if (i) ctx.lineTo(sx(i), sy(spec[i])); else ctx.moveTo(sx(i), sy(spec[i])); }
      ctx.strokeStyle = mix(text, 40); ctx.lineWidth = 1; ctx.stroke();
    }
    // Each band's own shape, faint in its color.
    {
      gains.forEach((g, i) => {
        if (Math.abs(g) < 0.05) return;
        ctx.beginPath();
        FREQS.forEach((f, k) => { const y = gy(Math.max(-EQ_RANGE, Math.min(EQ_RANGE, eqBandDb(i, g, f)))); if (k) ctx.lineTo(fx(f), y); else ctx.moveTo(fx(f), y); });
        ctx.lineTo(fx(20000), gy(0)); ctx.lineTo(fx(20), gy(0)); ctx.closePath();
        ctx.fillStyle = mix(on ? eqColor(i) : faint, i === sel ? 24 : on ? 11 : 6); ctx.fill();
      });
    }
    // The combined curve.
    ctx.beginPath();
    FREQS.forEach((f, k) => {
      const db = totalAt(f);
      const y = gy(Math.max(-EQ_RANGE - 3, Math.min(EQ_RANGE + 3, db)));
      if (k) ctx.lineTo(fx(f), y); else ctx.moveTo(fx(f), y);
    });
    ctx.strokeStyle = on ? accent : faint; ctx.lineWidth = 2.2;
    ctx.shadowColor = on ? accent : 'transparent'; ctx.shadowBlur = on ? 10 : 0;
    if (!on) ctx.setLineDash([6, 5]);
    ctx.stroke(); ctx.shadowBlur = 0; ctx.setLineDash([]);
    // Band nodes.
    gains.forEach((g, i) => {
      const x = fx(EQ_HZ[i]), y = nodeY(i), big = i === sel || i === hover || drag?.i === i;
      const c = on ? eqColor(i) : faint;
      ctx.beginPath(); ctx.arc(x, y, big ? 8 : 6, 0, Math.PI * 2);
      ctx.fillStyle = c; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0, 0, 0, .55)'; ctx.stroke();
      if (big) { ctx.beginPath(); ctx.arc(x, y, 12.5, 0, Math.PI * 2); ctx.strokeStyle = mix(c, 55); ctx.lineWidth = 1.5; ctx.stroke(); }
    });
    chips.forEach((c, i) => { c.querySelector('.eq-chip-db').textContent = `${gains[i] > 0 ? '+' : ''}${gains[i].toFixed(1)}`; c.classList.toggle('sel', i === sel); });
    const t = drag ? drag.i : hover;
    if (t >= 0) {
      tip.hidden = false;
      tip.textContent = `${fmtHz(EQ_HZ[t])}  ${fmtDb(gains[t])}`;
      tip.style.left = `${fx(EQ_HZ[t])}px`;
      tip.style.top = `${nodeY(t) - 18}px`;
    } else tip.hidden = true;
  }

  const nodeAt = (x, y) => {
    let best = -1, bd = 26;
    EQ_HZ.forEach((f, i) => { const d = Math.hypot(fx(f) - x, (nodeY(i) - y) * 0.35); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const setGain = (i, g) => {
    gains[i] = Math.round(Math.max(-EQ_RANGE, Math.min(EQ_RANGE, g)) * 10) / 10;
    onChange(); draw();
  };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => {
    const [x, y] = pos(e);
    const i = nodeAt(x, y);
    if (i < 0) return;
    sel = i; drag = { i, y0: y, g0: gains[i] };
    canvas.setPointerCapture(e.pointerId);
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = pos(e);
    if (drag) {
      // Shift: fine adjustment.
      const g = drag.g0 + (yToDb(drag.y0 + (y - drag.y0) * (e.shiftKey ? 0.25 : 1)) - yToDb(drag.y0));
      setGain(drag.i, e.shiftKey ? g : Math.round(g * 2) / 2);
      return;
    }
    const hv = nodeAt(x, y);
    if (hv !== hover) { hover = hv; canvas.style.cursor = hv >= 0 ? 'ns-resize' : ''; draw(); }
  });
  const endDrag = () => { if (drag) { drag = null; draw(); } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { if (!drag && hover !== -1) { hover = -1; draw(); } });
  canvas.addEventListener('dblclick', (e) => { const i = nodeAt(...pos(e)); if (i >= 0) setGain(i, 0); });
  canvas.addEventListener('wheel', (e) => {
    const i = hover >= 0 ? hover : sel;
    if (i < 0) return;
    e.preventDefault();
    setGain(i, gains[i] + (e.deltaY < 0 ? 0.5 : -0.5));
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.5;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { sel = Math.max(0, Math.min(9, (sel < 0 ? 0 : sel) + (e.key === 'ArrowLeft' ? -1 : 1))); draw(); }
    else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && sel >= 0) setGain(sel, gains[sel] + (e.key === 'ArrowUp' ? step : -step));
    else if ((e.key === 'Home' || e.key === '0') && sel >= 0) setGain(sel, 0);
    else return;
    // Keep the app's own shortcuts (seek, volume) out of it.
    e.preventDefault(); e.stopPropagation();
  });
  canvas.addEventListener('focus', () => { if (sel < 0) { sel = 0; draw(); } });

  // Spectrum: polled about 30 times a second while the graph is on screen
  // and the window is visible; bands rise fast and fall back smoothly.
  async function tick(t) {
    // Off screen (another page is open): stop; the resize observer below
    // starts it again when the graph shows (it goes from 0 px to its size).
    if (!el.isConnected || !el.offsetParent) { stop(); return; }
    raf = requestAnimationFrame(tick);
    if (document.hidden || pending || t - last < 33) return;
    last = t; pending = true;
    let next = [];
    try { next = await call('audio_spectrum', { bands: 120 }); } catch { /* no backend */ }
    pending = false;
    if (next.length) {
      spec = spec && spec.length === next.length ? spec.map((v, i) => v + (next[i] - v) * (next[i] > v ? 0.6 : 0.18)) : next;
    } else if (spec) {
      spec = spec.map((v) => v - 3);
      if (spec.every((v) => v < -80)) spec = null;
    } else return;
    draw();
  }
  function start() {
    if (live) return;
    live = true;
    claimAnalyzer('eq', true);
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    if (!live) return;
    live = false;
    cancelAnimationFrame(raf);
    claimAnalyzer('eq', false);
  }
  new ResizeObserver(() => { resize(); if (el.isConnected && el.offsetParent) start(); }).observe(canvas);
  return { el, refresh: draw };
}

function crossfadeControl() {
  const s = state.settings;
  const label = h('span', { class: 'meta w-34 text-right' }, `${s.crossfade || 0} s`);
  const range = h('input', { class: 'w-140', type: 'range', min: 0, max: 12, step: 1, value: s.crossfade || 0 });
  range.style.setProperty('--fill', `${((s.crossfade || 0) / 12) * 100}%`);
  range.addEventListener('input', () => { label.textContent = `${range.value} s`; range.style.setProperty('--fill', `${(range.value / 12) * 100}%`); });
  range.addEventListener('change', () => updateSettings({ crossfade: Number(range.value) }));
  return h('div', { class: 'actions' }, range, label);
}

function ytdlpControl() {
  const s = state.settings;
  const sel = h('select', {}, h('option', { value: 'system', selected: s.ytdlp_source === 'system' }, 'System'), h('option', { value: 'bundled', selected: s.ytdlp_source === 'bundled', disabled: !state.tools?.bundled_ytdlp }, 'Tunewire’s copy'));
  sel.addEventListener('change', async () => { await updateSettings({ ytdlp_source: sel.value }); await checkHealth(); renderSettings(); });
  const btn = h('button', { class: 'btn small' }, state.tools?.bundled_ytdlp ? 'Update copy' : 'Install copy');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Downloading…';
    try {
      const hres = await call('ytdlp_install');
      toast(`yt-dlp ${hres.version || ''} installed`, 'ok');
      await refreshTools();
      state.settings = await call('get_settings');
      await checkHealth();
      renderSettings();
    } catch (e) {
      toast(errMsg(e), 'error');
      btn.disabled = false;
      btn.textContent = 'Retry';
    }
  });
  return h('div', { class: 'actions' }, sel, btn);
}
