'use strict';

// ===========================================================================
// Charts, new releases (followed artists), search suggestions, cover accent,
// full-screen lyrics, radio, Spotify import
// ===========================================================================

// Charts ----------------------------------------------------------------------

let chartsSeq = 0;
async function renderCharts(country) {
  const seq = ++chartsSeq;
  const body = $('#charts-body');
  if (!state.chartCountries) state.chartCountries = await call('chart_countries').catch(() => [{ code: 'ZZ', name: 'Global' }]);
  const current = country || state.settings?.charts_country || 'ZZ';
  const select = h('select', { class: 'input w-auto' },
    ...state.chartCountries.map((c) => h('option', { value: c.code, selected: c.code === current }, c.name)));
  select.addEventListener('change', () => renderCharts(select.value));
  const head = h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Charts'), h('span', { class: 'meta' }, 'From YouTube Music, updated daily')), h('div', { class: 'actions' }, select));
  body.replaceChildren(head, loadingBox('Loading charts', h('div', { class: 'track-list' }, ...skeletonRows(12))));
  let charts;
  try {
    charts = await call('get_charts', { country: current });
    if (state.settings) state.settings.charts_country = current;
  } catch (e) {
    if (seq === chartsSeq) body.replaceChildren(head, h('div', { class: 'empty is-error' }, h('p', {}, errMsg(e)), h('button', { class: 'btn', onclick: () => renderCharts(current) }, 'Try again')));
    return;
  }
  if (seq !== chartsSeq) return;
  const groups = new Map();
  for (const p of charts.playlists) {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group).push(p);
  }
  const sections = [...groups].map(([group, lists]) => h('div', { class: 'artist-section' },
    h('div', { class: 'section-title' }, group || 'Playlists'),
    albumGrid(lists.map((p) => ({ title: p.title, url: p.url, thumbnail: p.thumbnail })))));
  const artists = charts.artists.length ? h('div', { class: 'artist-section' },
    h('div', { class: 'section-title' }, 'Top artists'),
    h('div', { class: 'chart-artists' }, ...charts.artists.slice(0, 40).map((a) => h('button', { class: 'chart-artist', onclick: () => openArtist(a.name) },
      h('span', { class: 'rank' }, String(a.rank)), thumbEl(a.thumbnail, 'thumb round', a.name || a.title), h('span', { class: 'name' }, a.name))))) : null;
  body.replaceChildren(head, ...sections, artists);
}

// Followed artists + new releases ----------------------------------------------

async function refreshFollowed() {
  state.followed = await call('list_followed').catch(() => []);
  return state.followed;
}

function isFollowing(name) {
  const n = (name || '').toLowerCase();
  return (state.followed || []).some((a) => a.name.toLowerCase() === n);
}

function followButton(name, url, thumbnail) {
  const btn = h('button', { class: 'btn' });
  const paint = () => {
    const on = isFollowing(name);
    btn.innerHTML = on ? `${icon('check')}Following` : `${icon('plus')}Follow`;
    btn.classList.toggle('on', on);
    btn.title = on ? 'Stop following' : 'Get this artist’s new releases under New releases';
  };
  btn.addEventListener('click', async () => {
    try {
      const now = await call('follow_artist', { name, url: url || null, thumbnail: thumbnail || null });
      await refreshFollowed();
      paint();
      toast(now ? `Following ${name}` : `Unfollowed ${name}`, 'ok', 1500);
    } catch (e) { toast(errMsg(e), 'error'); }
  });
  paint();
  return btn;
}

function updateReleaseBadge(feed) {
  const n = (feed || state.releases || []).filter((r) => r.new).length;
  const el = $('#rel-count');
  el.textContent = n ? String(n) : '';
}

let releasesSeq = 0;
async function renderReleases(force = false) {
  const seq = ++releasesSeq;
  const body = $('#releases-body');
  const followed = await refreshFollowed();
  const head = h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'New releases'), h('span', { class: 'meta' }, followed.length ? `Latest from ${followed.length} artist${followed.length === 1 ? '' : 's'} you follow` : '')),
    followed.length ? h('div', { class: 'actions' }, h('button', { class: 'btn', html: `${icon('refresh')}Refresh`, onclick: () => renderReleases(true) })) : null);
  if (!followed.length) {
    body.replaceChildren(head, h('div', { class: 'empty' }, h('span', { class: 'big', html: icon('sparkle') }),
      h('p', {}, 'Follow artists to see their new albums and singles here.'),
      h('p', { class: 'muted small' }, 'Open an artist (click their name on any song) and press Follow. Charts has popular artists to start with.')));
    return;
  }
  const chips = h('div', { class: 'followed-chips' }, ...followed.map((a) => h('span', { class: 'chip' },
    h('button', { class: 'chip-name', onclick: () => openArtist(a.name) }, a.name),
    h('button', { class: 'chip-x', title: `Unfollow ${a.name}`, html: icon('x'), onclick: async () => { await call('follow_artist', { name: a.name }); renderReleases(); } }))));
  body.replaceChildren(head, chips, loadingBox('Checking for new releases', skeletonCards(8)));
  let feed;
  try {
    feed = await call('new_releases', { force });
  } catch (e) {
    if (seq === releasesSeq) body.replaceChildren(head, chips, h('div', { class: 'empty is-error' }, h('p', {}, errMsg(e))));
    return;
  }
  if (seq !== releasesSeq) return;
  state.releases = feed;
  // Newest-first per artist; "new" ones first overall.
  const sorted = [...feed].sort((a, b) => (b.new - a.new));
  const grid = albumGrid(sorted.map((r) => ({ title: r.title, url: r.url, thumbnail: r.thumbnail, subtitle: r.artist, isNew: r.new })));
  body.replaceChildren(head, chips, feed.length ? grid : h('div', { class: 'empty' }, h('p', {}, 'No releases found for these artists.')));
  updateReleaseBadge(feed);
  // Seen once shown; the badges stay until the next visit.
  if (feed.some((r) => r.new)) call('mark_releases_seen').then(() => { $('#rel-count').textContent = ''; }).catch(() => {});
}

/** Background check a little after startup, for the sidebar badge. */
async function checkReleasesQuietly() {
  const followed = await refreshFollowed();
  if (!followed.length) return;
  try { updateReleaseBadge(await call('new_releases', {})); } catch { /* offline */ }
}

// Search suggestions + history -------------------------------------------------
// While typing: your past searches, text suggestions, then songs, videos,
// artists and albums with their pictures (Enter plays or opens one).

const suggest = { items: [], active: -1, seq: 0, timer: null, typed: '' };
const suggestBox = $('#suggest');
const searchInput = $('#search-input');

function closeSuggest() {
  suggestBox.hidden = true;
  suggest.items = [];
  suggest.active = -1;
  searchInput.setAttribute('aria-expanded', 'false');
}

/** "Song · Daft Punk", "Artist", "Album · Daft Punk · 2001" from a card. */
function suggestSub(c) {
  const parts = (c.subtitle || '').split(' • ').map((x) => x.trim()).filter(Boolean);
  const kind = c.kind[0].toUpperCase() + c.kind.slice(1);
  const rest = parts.slice(1).filter((x) => !/\b(views|plays|audience|subscribers)\b/i.test(x));
  if (c.kind === 'artist') return 'Artist';
  if ((c.kind === 'song' || c.kind === 'video') && !rest.length && c.track?.artist) rest.push(c.track.artist);
  return [kind, ...rest.slice(0, 2)].join(' · ');
}

function suggestRow(it, i) {
  const cls = `suggest-item${it.card ? ' rich' : ''}${i === suggest.active ? ' active' : ''}`;
  const down = (e) => { e.preventDefault(); activateSuggestion(it, e); };
  if (it.card) {
    const c = it.card;
    const art = h('div', { class: `s-art${c.kind === 'artist' ? ' round' : ''}` });
    if (c.thumbnail) art.append(h('img', { src: imgUrl(c.thumbnail, 96), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove(), onload: (e) => { if (isYtPlaceholder(e.target)) e.target.remove(); } }));
    return h('div', { class: cls, role: 'option', 'aria-selected': String(i === suggest.active), onmousedown: down }, art,
      h('div', { class: 'txt' }, h('div', { class: 's-title' }, c.title), h('div', { class: 's-sub' }, suggestSub(c))),
      c.track ? h('span', { class: 's-play', 'aria-hidden': 'true', html: icon('play') }) : null);
  }
  return h('div', { class: cls, role: 'option', 'aria-selected': String(i === suggest.active), onmousedown: down },
    h('span', { class: 'ico', html: icon(it.history ? 'clock' : 'search') }), h('span', { class: 'txt' }, it.text),
    it.history ? h('button', { class: 'icon-btn tiny', title: 'Remove from history', html: icon('x'), onmousedown: async (e) => {
      e.preventDefault(); e.stopPropagation();
      await call('clear_search_history', { query: it.text }).catch(() => {});
      state.settings.search_history = (state.settings.search_history || []).filter((q) => q !== it.text);
      suggest.items = suggest.items.filter((x) => x !== it);
      renderSuggest();
    } }) : null);
}

function renderSuggest() {
  if (!suggest.items.length || document.activeElement !== searchInput) { closeSuggest(); return; }
  const rows = [];
  suggest.items.forEach((it, i) => {
    if (it.card && !suggest.items[i - 1]?.card && i > 0) rows.push(h('div', { class: 'suggest-sep', role: 'presentation' }));
    rows.push(suggestRow(it, i));
  });
  suggestBox.replaceChildren(...rows);
  suggestBox.hidden = false;
  searchInput.setAttribute('aria-expanded', 'true');
}

/** A text suggestion searches; a song plays (Ctrl/Shift: adds to the queue); an artist or album opens. */
function activateSuggestion(it, e = {}) {
  closeSuggest();
  if (!it.card) {
    searchInput.value = it.text;
    syncSearchClear();
    doSearch(it.text);
    return;
  }
  const c = it.card;
  if (c.track && (e.ctrlKey || e.metaKey || e.shiftKey)) {
    enqueue([c.track]).then(() => toast(`Added “${c.title}” to the queue`, 'ok', 2000)).catch((err) => toast(errMsg(err), 'error'));
    return;
  }
  searchInput.blur();
  openCard(c);
}

async function updateSuggest() {
  const q = searchInput.value.trim();
  const seq = ++suggest.seq;
  suggest.typed = searchInput.value;
  const history = (state.settings?.search_history || []).filter((x) => !q || x.toLowerCase().includes(q.toLowerCase())).slice(0, q ? 3 : 8);
  // Keep the pictures of the previous answer while the next one loads (no flicker).
  const cards = q ? suggest.items.filter((x) => x.card) : [];
  suggest.items = [...history.map((text) => ({ text, history: true })), ...cards];
  suggest.active = -1;
  renderSuggest();
  if (!q || isUrl(q)) return;
  let remote;
  try { remote = await call('search_preview', { query: q }); } catch { return; }
  if (seq !== suggest.seq) return;
  const seen = new Set(history.map((x) => x.toLowerCase()));
  const queries = (remote.queries || []).filter((x) => !seen.has(x.toLowerCase())).slice(0, Math.max(2, 5 - history.length));
  const found = (remote.items || []).filter((c) => c.title).slice(0, 5);
  suggest.items = [...history.map((text) => ({ text, history: true })), ...queries.map((text) => ({ text })), ...found.map((card) => ({ card, text: card.title }))];
  renderSuggest();
}

searchInput.addEventListener('input', () => {
  clearTimeout(suggest.timer);
  suggest.timer = setTimeout(updateSuggest, 140);
});
searchInput.addEventListener('focus', () => { if (!searchInput.value.trim()) updateSuggest(); });
searchInput.addEventListener('blur', () => setTimeout(closeSuggest, 100));
searchInput.addEventListener('keydown', (e) => {
  if (suggestBox.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = suggest.items.length;
    let a = suggest.active + (e.key === 'ArrowDown' ? 1 : -1);
    if (a < -1) a = n - 1;
    if (a >= n) a = -1;
    suggest.active = a;
    renderSuggest();
    // Text suggestions go into the box; on a song or artist the typed text stays.
    const it = suggest.items[a];
    searchInput.value = it && !it.card ? it.text : suggest.typed;
    $('#suggest .suggest-item.active')?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Escape') {
    e.stopPropagation();
    closeSuggest();
  } else if (e.key === 'Enter') {
    const it = suggest.items[suggest.active];
    if (it?.card) { e.preventDefault(); activateSuggestion(it, e); return; }
    closeSuggest();
  }
});
$('#search-form').addEventListener('submit', () => {
  closeSuggest();
  const q = searchInput.value.trim();
  if (q && !isUrl(q) && state.settings) {
    state.settings.search_history = [q, ...(state.settings.search_history || []).filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 30);
  }
});

// Cover-based accent -----------------------------------------------------------


function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hue * 60, s, l];
}

function hsl(hh, s, l, a = 1) {
  return a === 1 ? `hsl(${hh.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)` : `hsl(${hh.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}% / ${a})`;
}

/** Readable accent from a cover color: bright enough on dark themes, dark enough on light ones. */
function accentVars(hex) {
  const [hh, s0] = hexToHsl(hex);
  const light = document.documentElement.dataset.mode === 'light';
  const s = Math.min(0.85, Math.max(0.45, s0));
  const l = light ? 0.38 : 0.64;
  return { accent: hsl(hh, s, l), soft: hsl(hh, s, l, 0.14), contrast: light ? '#ffffff' : hsl(hh, 0.6, 0.08) };
}

/**
 * The whole app's colors from one background color: surfaces (window,
 * panels, hover, selection, borders) take its hue at a low saturation, text
 * gets a faint tint, and the accent is a readable version of it. Lightness
 * stays where the theme has it (dark or light), so text keeps its contrast.
 */
function paletteVars(hex, surfaces, tone = hex) {
  // Surfaces follow `tone` (the average of the picture you see behind the
  // panels); the accent follows `hex` (its most colorful part; null for a
  // black-and-white picture: the theme's accent stays).
  const [hh, s0] = hexToHsl(tone || hex);
  const vars = {};
  if (hex) {
    const v = accentVars(hex);
    Object.assign(vars, { '--accent': v.accent, '--accent-soft': v.soft, '--accent-contrast': v.contrast, '--warn': v.accent });
  }
  if (surfaces) {
    const light = document.documentElement.dataset.mode === 'light';
    // Muted: enough to belong with the picture, not enough to shout.
    const t = Math.min(0.6, s0) * (light ? 0.55 : 0.78);
    const k = Math.min(1, s0 * 4);
    const L = light
      ? { bg: 0.955, elev: 0.985, elev2: 0.925, hover: 0.94, sel: 0.89, border: 0.86, text: 0.12, dim: 0.38, faint: 0.56 }
      : { bg: 0.07, elev: 0.1, elev2: 0.14, hover: 0.13, sel: 0.19, border: 0.17, text: 0.93, dim: 0.7, faint: 0.47 };
    Object.assign(vars, {
      '--bg': hsl(hh, t, L.bg), '--bg-elev': hsl(hh, t, L.elev), '--bg-elev-2': hsl(hh, t, L.elev2),
      '--surface-hover': hsl(hh, t, L.hover), '--selected': hsl(hh, t * 1.1, L.sel), '--border': hsl(hh, t, L.border),
      // Text tint only as strong as the picture is colorful (grey stays grey).
      '--text': hsl(hh, (light ? 0.25 : 0.14) * k, L.text), '--text-dim': hsl(hh, (light ? 0.18 : 0.11) * k, L.dim), '--text-faint': hsl(hh, 0.1 * k, L.faint),
      '--panel-border': hsl(hh, t * 1.2, light ? 0.82 : 0.2, 0.7),
    });
  }
  return `:root{${Object.entries(vars).map(([k, x]) => `${k}:${x}!important`).join(';')}}`;
}

// What the app's colors currently come from ("cover:<url>", "image:<path>").
const appColors = { key: null, seq: 0 };

function clearCoverAccent() {
  appColors.key = null;
  appColors.seq++;
  $('#accent-css').textContent = '';
}

/**
 * Optionally tint the interface from the playing song's cover.
 */
async function updateAppColors() {
  const s = state.settings || {};
  if (!s.cover_colors) return clearCoverAccent();
  const mode = s.background || 'art';
  const p = state.playback;
  const thumb = p?.version?.thumbnail || p?.current?.track?.thumbnail;
  let source, getAccent, getTone;
  if (!thumb) return clearCoverAccent();
  const url = imgUrl(thumb, 120);
  source = `cover:${thumb}`;
  getAccent = () => call('cover_color', { url });
  getTone = mode === 'art' ? async () => averageColor(await call('cover_wash', { url })) : null;
  const key = `${source}|${mode}|${document.documentElement.dataset.mode || 'dark'}`;
  if (key === appColors.key) return;
  appColors.key = key;
  const seq = ++appColors.seq;
  const [accent, tone] = await Promise.all([getAccent().catch(() => null), getTone ? getTone().catch(() => null) : null]);
  if (seq !== appColors.seq) return;
  if (!accent && !tone) { $('#accent-css').textContent = ''; return; }
  $('#accent-css').textContent = paletteVars(accent, mode !== 'plain', tone);
}

/** Average color of an image (a data: URL), as #rrggbb. */
async function averageColor(src) {
  if (!src) return null;
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  if (!n) return null;
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Kept for callers from before the whole app was colored. */
function updateCoverAccent() { return updateAppColors(); }

// Full-screen lyrics -------------------------------------------------------------

const fullLyrics = { open: false, el: null, translation: null, key: null };

function openFullLyrics() {
  if (fullLyrics.open) return;
  fullLyrics.open = true;
  const overlay = h('div', { class: 'lyrics-full', role: 'dialog', 'aria-label': 'Lyrics' });
  fullLyrics.el = overlay;
  document.body.append(overlay);
  renderFullLyrics();
}

function closeFullLyrics() {
  fullLyrics.open = false;
  fullLyrics.el?.remove();
  fullLyrics.el = null;
}

function lyricTexts() {
  if (lyrics.lines) return lyrics.lines.map((l) => l.text);
  if (lyrics.plain) return lyrics.plain.split('\n');
  return [];
}

/**
 * Full-screen lyrics: the cover, song and controls on the left, big lyrics
 * on the right (the current line lit, the rest dimmed), over a slow-moving
 * wash of the cover's colors. Only the lyrics column scrolls.
 */
function renderFullLyrics() {
  const o = fullLyrics.el;
  if (!o) return;
  const p = state.playback;
  const track = p?.current?.track;
  const thumb = p?.version?.thumbnail || track?.thumbnail;
  if (fullLyrics.key !== track?.key) { fullLyrics.translation = null; fullLyrics.key = track?.key; }
  const tr = fullLyrics.translation;
  const texts = lyricTexts();
  const synced = !!lyrics.lines;
  const lines = texts.map((t, i) => h('button', { class: `lyric${t ? '' : ' gap'}`, dataset: { i }, tabindex: synced ? 0 : -1, onclick: () => synced && seekTo(lyrics.lines[i].t) },
    h('span', {}, t || '♪'), tr && tr.lines[i] && tr.lines[i] !== t ? h('small', { class: 'tr' }, tr.lines[i]) : null));
  const translateBtn = h('button', { class: `lf-pill${tr ? ' on' : ''}`, html: `${icon('translate')}<span>${tr ? 'Original' : 'Translate'}</span>`, disabled: !texts.length, onclick: async (e) => {
    if (fullLyrics.translation) { fullLyrics.translation = null; renderFullLyrics(); return; }
    e.currentTarget.disabled = true;
    try {
      const lang = (navigator.language || 'en').split('-')[0];
      fullLyrics.translation = await call('translate_lyrics', { lines: texts, target: lang });
      if (fullLyrics.translation.source_lang === lang) toast('These lyrics are already in your language', 'info', 2000);
    } catch (err) { toast(errMsg(err), 'error'); }
    renderFullLyrics();
  } });

  // Background: the cover's colors, pre-blurred by the backend (no live blur).
  const bg = h('div', { class: 'lf-bg' }, h('div', { class: 'lf-wash a' }), h('div', { class: 'lf-wash b' }), h('div', { class: 'lf-scrim' }));
  if (thumb) {
    const set = (css) => bg.querySelectorAll('.lf-wash').forEach((w) => { w.style.backgroundImage = css; });
    set(`url("${imgUrl(thumb, 120).replace(/"/g, '%22')}")`);
    bg.classList.add('raw');
    call('cover_wash', { url: imgUrl(thumb, 120) }).then((wash) => { if (wash && fullLyrics.el === o) { set(`url("${wash}")`); bg.classList.remove('raw'); } }).catch(() => {});
  }

  const ctl = (name, label, fn, cls = '') => h('button', { class: `lf-ctl ${cls}`, title: label, 'aria-label': label, html: icon(name), onclick: fn });
  const side = h('aside', { class: 'lf-side' },
    h('div', { class: 'lf-art' }, thumb ? h('img', { src: thumb, 'data-px': 600, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { html: icon('music') })),
    h('div', { class: 'lf-title' }, track?.title || 'Nothing playing'),
    h('button', { class: 'lf-artist', disabled: !track?.artist, onclick: () => { closeFullLyrics(); if (track?.artist) openArtist(track.artist, track); } }, track?.artist || ''),
    h('div', { class: 'lf-progress' },
      h('div', { class: 'lf-bar', role: 'slider', tabindex: 0, 'aria-label': 'Seek', onclick: (e) => { const d = state.playback?.duration; if (!d) return; const r = e.currentTarget.getBoundingClientRect(); seekTo(((e.clientX - r.left) / r.width) * d); } }, h('i', { class: 'lf-fill' })),
      h('div', { class: 'lf-times' }, h('span', { class: 'lf-pos' }, '0:00'), h('span', { class: 'lf-dur' }, fmtTime(p?.duration)))),
    h('div', { class: 'lf-controls' },
      ctl('prev', 'Previous', () => call('previous_track')),
      ctl('play', 'Play / pause', () => call('toggle_pause'), 'lf-play'),
      ctl('next', 'Next', () => call('next_track'))));

  const body = texts.length
    ? h('div', { class: `lf-lines${synced ? ' synced' : ''}` }, h('div', { class: 'lf-pad' }), ...lines, h('div', { class: 'lf-pad' }),
      h('div', { class: 'lf-source' }, lyrics.source ? `Lyrics from ${lyrics.source}` : ''))
    : h('div', { class: 'lf-empty' }, h('p', {}, lyrics.key ? (lyrics.instrumental ? 'Instrumental. Just enjoy it.' : 'No lyrics for this song yet.') : 'Play a song to see its lyrics.'));

  o.replaceChildren(bg,
    h('header', { class: 'lf-top' }, h('span', { class: 'lf-label' }, 'Lyrics'), h('div', { class: 'lf-actions' }, translateBtn,
      h('button', { class: 'lf-pill icon', title: 'Close (Esc)', 'aria-label': 'Close lyrics', html: icon('x'), onclick: closeFullLyrics }))),
    h('div', { class: 'lf-main' }, side, body));
  fullLyrics.active = -1;
  fullLyrics.playIcon = null;
  syncFullLyrics(true);
}

/** Current line, progress and play button (every playback tick). */
function syncFullLyrics(force = false) {
  const o = fullLyrics.el;
  if (!fullLyrics.open || !o) return;
  const p = state.playback;
  const pos = p?.position || 0;
  const dur = p?.duration || 0;
  const fill = o.querySelector('.lf-fill');
  if (fill) fill.style.transform = `scaleX(${dur ? Math.min(1, pos / dur) : 0})`;
  const posEl = o.querySelector('.lf-pos');
  if (posEl) posEl.textContent = fmtTime(pos);
  const durEl = o.querySelector('.lf-dur');
  if (durEl) durEl.textContent = fmtTime(dur);
  const want = p?.status === 'playing' ? 'pause' : 'play';
  if (fullLyrics.playIcon !== want) { const b = o.querySelector('.lf-play'); if (b) { b.innerHTML = icon(want); fullLyrics.playIcon = want; } }
  if (!lyrics.lines) return;
  let i = -1;
  for (let k = 0; k < lyrics.lines.length && lyrics.lines[k].t <= pos + 0.25; k++) i = k;
  if (i === fullLyrics.active && !force) return;
  fullLyrics.active = i;
  const box = o.querySelector('.lf-lines');
  const els = o.querySelectorAll('.lf-lines .lyric');
  els.forEach((el, k) => { el.classList.toggle('current', k === i); el.classList.toggle('past', k < i); el.classList.toggle('near', Math.abs(k - i) === 1); });
  // Scroll only the lyrics column (scrollIntoView moved the whole screen).
  const cur = els[Math.max(0, i)];
  if (box && cur) {
    const top = cur.offsetTop - box.clientHeight * 0.4 + cur.offsetHeight / 2;
    box.scrollTo({ top, behavior: force || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}

$('#lyrics-full').addEventListener('click', async () => {
  if (!lyrics.key) await loadLyrics(true);
  openFullLyrics();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && fullLyrics.open) { e.stopPropagation(); closeFullLyrics(); } }, true);

// Radio ---------------------------------------------------------------------------

async function startRadio(track) {
  try {
    await call('start_radio', { track });
    toast(`Starting radio from “${track.title}”…`, 'info', 2000);
  } catch (e) { toast(errMsg(e), 'error'); }
}

// Spotify profile import ------------------------------------------------------------

/** Someone's public playlists from a profile link (uses the Spotify login). */
async function importSpotifyProfile() {
  const url = await promptModal({ title: 'Import someone’s Spotify playlists', label: 'Paste a profile link (Spotify → profile → ⋯ → Share → Copy link to profile). You’ll log in to Spotify once if you haven’t yet.', placeholder: 'https://open.spotify.com/user/…', okLabel: 'Find playlists' });
  if (!url) return;
  const body = h('div', { class: 'import-box' }, h('div', { class: 'loading-line' }, h('span', { class: 'spinner' }), 'Connecting to Spotify… (log in in your browser if it opens)'));
  const footer = h('div', { class: 'actions' });
  const m = openModal({ title: 'Import from a Spotify profile', wide: true, body, footer: [footer] });
  footer.replaceChildren(h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'));
  try {
    await call('spotify_library_login');
    if (!body.isConnected) return;
    body.replaceChildren(h('div', { class: 'loading-line' }, h('span', { class: 'spinner' }), 'Looking up playlists…'));
    const prof = await call('spotify_profile_playlists', { url });
    if (!body.isConnected) return;
    if (!prof.playlists.length) { body.replaceChildren(h('p', {}, `${prof.name} has no public playlists.`)); return; }
    pickSpotify({ user: prof.name, liked: 0, playlists: prof.playlists }, body, footer, m, { heading: `${prof.name}’s public playlists. Choose what to bring over:` });
  } catch (e) {
    if (body.isConnected) body.replaceChildren(h('p', { class: 'muted' }, errMsg(e)));
  }
}

async function syncPlaylist(id, btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Syncing…'; }
  else toast('Syncing…', 'info', 1500);
  try {
    const n = await call('sync_playlist', { id });
    toast(`Synced: ${songCount(n)}`, 'ok');
  } catch (e) { toast(errMsg(e), 'error'); }
  if (btn) { btn.disabled = false; btn.innerHTML = `${icon('refresh')}Sync`; }
}


// Ambient background ------------------------------------------------------------

const ambient = { cur: 0, css: undefined, seq: 0, swap: 0 };

/** Crossfade to a new background (any CSS background-image value, or none). */
/**
 * Background change: the new picture fades in ON TOP of the old one, and the
 * old one is hidden only once it's covered. (Fading one out while the other
 * fades in made the background dip darker halfway: the flicker.)
 */
function setAmbientLayer(css) {
  if (css === ambient.css) return;
  ambient.css = css;
  const layers = $$('#ambient .amb-layer');
  const token = ++ambient.swap;
  if (!css) { layers.forEach((l) => l.classList.remove('on')); return; }
  const prev = layers[ambient.cur];
  const next = layers[ambient.cur ^ 1];
  ambient.cur ^= 1;
  next.classList.remove('on');
  next.style.zIndex = '2';
  prev.style.zIndex = '1';
  next.style.backgroundImage = css;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (token !== ambient.swap) return;
    next.classList.add('on');
    setTimeout(() => { if (token === ambient.swap) prev.classList.remove('on'); }, 1300);
  }));
}

async function updateAmbient() {
  updateAppColors();
  const s = state.settings || {};
  const mode = s.background || 'art';
  const seq = ++ambient.seq;
  document.documentElement.style.setProperty('--amb-strength', ((s.background_strength ?? 45) / 100).toFixed(2));
  $('#ambient').className = `${mode}${ANIMATED_BACKGROUNDS.includes(mode) ? ' anim' : ''}`;
  particles.set(mode);
  // Animated backgrounds draw their own; Rain on glass shows the cover behind the glass.
  if (ANIMATED_BACKGROUNDS.includes(mode) && mode !== 'rain') return setAmbientLayer(null);
  const p = state.playback;
  const thumb = p?.version?.thumbnail || p?.current?.track?.thumbnail;
  if (!thumb) return setAmbientLayer(null);
  const wash = await call('cover_wash', { url: imgUrl(thumb, 120) }).catch(() => null);
  if (seq !== ambient.seq) return;
  setAmbientLayer(wash ? `url("${wash}")` : null);
}

// Animated backgrounds (Stars, Snow, Rain on glass, Hyperspace, Lava lamp) --------
//
// One canvas behind the app, drawn about 30 times a second (Lava lamp: 24,
// at a quarter of the resolution), mostly from pre-rendered sprites, with
// particle counts that scale with the window and are capped. Everything is
// black and white (the theme's text color on its background). Stops while
// the window is hidden or minimized; one still frame with "reduce motion".
// Hyperspace speeds up with the music, using the audio analyzer.

const ANIMATED_BACKGROUNDS = ['stars', 'snow', 'rain', 'hyperspace', 'lava'];

const particles = (() => {
  let canvas = null, ctx = null, mode = null, raf = 0, last = 0, W = 0, H = 0, items = [], sprites = null;
  let shooting = null, nextShoot = 0, wind = 0, windTarget = 0, energy = 0, energyAt = 0, energyPending = false;
  let streaks = [], slides = [], nextSlide = 0;
  const FRAME_MS = { lava: 42 };
  const SCALE = { lava: 0.25 };
  const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Soft round sprite of `r` px radius (glow fades to transparent).
  function sprite(r, core = 0.35) {
    const c = document.createElement('canvas');
    const s = Math.ceil(r * 2 + 2);
    c.width = c.height = s;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(core, 'rgba(255,255,255,.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    return c;
  }

  // A water drop on glass: dark rim below, a bright highlight above-left.
  function dropSprite(r) {
    const s = Math.ceil(r * 2 + 4);
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const cx = s / 2, cy = s / 2;
    const body = g.createRadialGradient(cx, cy + r * 0.25, r * 0.2, cx, cy, r);
    body.addColorStop(0, 'rgba(255,255,255,.10)');
    body.addColorStop(0.75, 'rgba(255,255,255,.04)');
    body.addColorStop(0.92, 'rgba(0,0,0,.45)');
    body.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = body;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.beginPath(); g.ellipse(cx - r * 0.35, cy - r * 0.4, r * 0.28, r * 0.18, -0.6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.22)';
    g.lineWidth = Math.max(0.6, r * 0.12);
    g.beginPath(); g.arc(cx, cy, r * 0.82, 0.3 * Math.PI, 0.85 * Math.PI); g.stroke();
    return c;
  }

  function makeSprites() {
    return {
      dot: [sprite(1.4, 0.55), sprite(2, 0.45), sprite(2.8, 0.4)],
      glow: sprite(9, 0.08),
      flake: [sprite(1.6, 0.5), sprite(2.6, 0.45), sprite(4, 0.35), sprite(6.5, 0.25)],
      drops: [2, 3, 4.5, 6.5, 9].map(dropSprite),
      blob: sprite(64, 0.45),
    };
  }

  function populate() {
    const area = W * H / ((SCALE[mode] || 1) ** 2);
    items = []; streaks = []; slides = [];
    if (mode === 'stars') {
      const n = Math.min(260, Math.round(area / 6500));
      for (let i = 0; i < n; i++) {
        const depth = Math.random() < 0.6 ? 0 : Math.random() < 0.75 ? 1 : 2;
        items.push({ x: Math.random() * W, y: Math.random() * H, depth, phase: Math.random() * Math.PI * 2, speed: 0.6 + Math.random() * 1.8, base: 0.35 + Math.random() * 0.55, glow: depth === 2 && Math.random() < 0.35 });
      }
    } else if (mode === 'snow') {
      const n = Math.min(230, Math.round(area / 7500));
      for (let i = 0; i < n; i++) {
        const depth = Math.random() < 0.5 ? 0 : Math.random() < 0.7 ? 1 : Math.random() < 0.85 ? 2 : 3;
        items.push({ x: Math.random() * W, y: Math.random() * H, depth, phase: Math.random() * Math.PI * 2, sway: 0.4 + Math.random() * 1.2, fall: [14, 26, 44, 70][depth] * (0.75 + Math.random() * 0.5), alpha: [0.45, 0.6, 0.8, 0.55][depth] * (0.7 + Math.random() * 0.3) });
      }
    } else if (mode === 'rain') {
      // Drops beaded on the glass (still), and rain falling outside it.
      const n = Math.min(320, Math.round(area / 4200));
      for (let i = 0; i < n; i++) {
        const k = Math.random() < 0.55 ? 0 : Math.random() < 0.6 ? 1 : Math.random() < 0.75 ? 2 : 3;
        items.push({ x: Math.random() * W, y: Math.random() * H, k, a: 0.55 + Math.random() * 0.45 });
      }
      const m = Math.min(90, Math.round(area / 22000));
      for (let i = 0; i < m; i++) streaks.push({ x: Math.random() * W, y: Math.random() * H, len: 14 + Math.random() * 26, v: 600 + Math.random() * 500, a: 0.05 + Math.random() * 0.08 });
    } else if (mode === 'hyperspace') {
      const n = Math.min(320, Math.round(area / 4500));
      for (let i = 0; i < n; i++) items.push(newStar(true));
    } else if (mode === 'lava') {
      const n = 8;
      for (let i = 0; i < n; i++) {
        items.push({ x: (0.15 + 0.7 * Math.random()) * W, phase: Math.random() * Math.PI * 2, speed: 0.025 + Math.random() * 0.04, r: (0.07 + Math.random() * 0.09) * Math.max(W, H), sway: 0.04 + Math.random() * 0.06, swayPhase: Math.random() * 6 });
      }
    }
  }

  function newStar(anywhere) {
    // x/y in -1..1 around the centre, z depth 0..1 (1 = far).
    const a = Math.random() * Math.PI * 2, d = 0.05 + Math.random() * 0.95;
    return { x: Math.cos(a) * d, y: Math.sin(a) * d, z: anywhere ? Math.random() : 1, pz: null };
  }

  function resize() {
    if (!canvas) return;
    const s = SCALE[mode] || 1;
    W = Math.max(1, Math.round(window.innerWidth * s)); H = Math.max(1, Math.round(window.innerHeight * s));
    canvas.width = W; canvas.height = H;
    populate();
    draw(performance.now(), 0);
  }

  // Music energy (0..1) for Hyperspace, from the analyzer, about 8 times a second.
  function sampleEnergy(t) {
    if (energyPending || t - energyAt < 120) return;
    energyAt = t; energyPending = true;
    call('audio_spectrum', { bands: 24 }).then((s) => {
      const lows = (s || []).slice(0, 12);
      const e = lows.length ? lows.reduce((a, db) => a + Math.max(0, (db + 70) / 70), 0) / lows.length : 0;
      energy += (e - energy) * 0.5;
    }).catch(() => {}).finally(() => { energyPending = false; });
  }

  function draw(t, dt) {
    if (!ctx) return;
    const s = dt / 1000;
    ctx.clearRect(0, 0, W, H);
    if (mode === 'stars') {
      const drift = [3, 7, 14];
      for (const p of items) {
        p.x -= drift[p.depth] * s;
        p.y += drift[p.depth] * 0.35 * s;
        if (p.x < -10) p.x += W + 20;
        if (p.y > H + 10) p.y -= H + 20;
        const tw = p.base * (0.65 + 0.35 * Math.sin(t / 1000 * p.speed + p.phase));
        ctx.globalAlpha = tw;
        const img = sprites.dot[p.depth];
        ctx.drawImage(img, p.x - img.width / 2, p.y - img.height / 2);
        if (p.glow) { ctx.globalAlpha = tw * 0.35; ctx.drawImage(sprites.glow, p.x - sprites.glow.width / 2, p.y - sprites.glow.height / 2); }
      }
      if (!shooting && t > nextShoot && dt) {
        const fromLeft = Math.random() < 0.5;
        shooting = { x: fromLeft ? Math.random() * W * 0.5 : W * 0.5 + Math.random() * W * 0.5, y: Math.random() * H * 0.4, vx: (fromLeft ? 1 : -1) * (520 + Math.random() * 260), vy: 220 + Math.random() * 140, life: 0 };
      }
      if (shooting) {
        shooting.life += s; shooting.x += shooting.vx * s; shooting.y += shooting.vy * s;
        const a = Math.max(0, 1 - shooting.life / 0.9), len = 0.12;
        const grad = ctx.createLinearGradient(shooting.x, shooting.y, shooting.x - shooting.vx * len, shooting.y - shooting.vy * len);
        grad.addColorStop(0, `rgba(255,255,255,${0.9 * a})`); grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = 1; ctx.strokeStyle = grad; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(shooting.x, shooting.y); ctx.lineTo(shooting.x - shooting.vx * len, shooting.y - shooting.vy * len); ctx.stroke();
        if (a <= 0 || shooting.x < -200 || shooting.x > W + 200 || shooting.y > H + 200) { shooting = null; nextShoot = t + 5000 + Math.random() * 9000; }
      }
    } else if (mode === 'snow') {
      if (Math.random() < s * 0.15) windTarget = (Math.random() - 0.5) * 40;
      wind += (windTarget - wind) * Math.min(1, s * 0.5);
      for (const p of items) {
        const k = [0.4, 0.6, 0.85, 1.1][p.depth];
        p.y += p.fall * s;
        p.x += (wind * k + Math.sin(t / 1000 * p.sway + p.phase) * 12 * k) * s;
        if (p.y > H + 10) { p.y = -10; p.x = Math.random() * W; }
        if (p.x < -12) p.x += W + 24;
        if (p.x > W + 12) p.x -= W + 24;
        ctx.globalAlpha = p.alpha;
        const img = sprites.flake[p.depth];
        ctx.drawImage(img, p.x - img.width / 2, p.y - img.height / 2);
      }
    } else if (mode === 'rain') {
      // Rain outside the window: faint slanted streaks.
      ctx.lineCap = 'round';
      for (const r of streaks) {
        r.y += r.v * s; r.x += r.v * 0.12 * s;
        if (r.y > H + 30) { r.y = -30; r.x = Math.random() * W; }
        ctx.globalAlpha = r.a; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x - r.len * 0.12, r.y - r.len); ctx.stroke();
      }
      // Drops resting on the glass.
      for (const d of items) {
        const img = sprites.drops[d.k];
        ctx.globalAlpha = d.a;
        ctx.drawImage(img, d.x - img.width / 2, d.y - img.height / 2);
      }
      // Now and then a big drop runs down, stopping and starting, leaving a
      // trail of small beads.
      if (dt && t > nextSlide && slides.length < 6) {
        slides.push({ x: Math.random() * W, y: -10, v: 0, k: 3 + (Math.random() < 0.4 ? 1 : 0), stick: 0, trail: 0 });
        nextSlide = t + 900 + Math.random() * 2600;
      }
      for (let i = slides.length - 1; i >= 0; i--) {
        const d = slides[i];
        if (d.stick > 0) d.stick -= s;
        else {
          d.v = Math.min(260, d.v + 420 * s);
          d.y += d.v * s;
          d.x += Math.sin(t / 300 + i) * 6 * s;
          if (Math.random() < s * 0.8) { d.stick = 0.2 + Math.random() * 0.8; d.v = 0; }
          d.trail += d.v * s;
          if (d.trail > 16) { d.trail = 0; items.push({ x: d.x + (Math.random() - 0.5) * 2, y: d.y - 8, k: Math.random() < 0.7 ? 0 : 1, a: 0.5 + Math.random() * 0.3 }); }
        }
        // It wipes up resting drops in its path.
        for (let j = items.length - 1; j >= 0; j--) { const o = items[j]; if (Math.abs(o.x - d.x) < 6 && Math.abs(o.y - d.y) < 6 && o.k < 2) items.splice(j, 1); }
        const img = sprites.drops[d.k];
        ctx.globalAlpha = 0.95;
        ctx.drawImage(img, d.x - img.width / 2, d.y - img.height / 2);
        if (d.y > H + 20) slides.splice(i, 1);
      }
      if (items.length > 520) items.splice(0, items.length - 520);
    } else if (mode === 'hyperspace') {
      if (dt) sampleEnergy(t);
      const playing = state.playback?.status === 'playing';
      const target = playing ? 0.12 + energy * 1.1 : 0.05;
      const cx = W / 2, cy = H / 2, f = Math.min(W, H) * 0.55;
      ctx.lineCap = 'round';
      for (let i = 0; i < items.length; i++) {
        const p = items[i];
        const pz = p.z;
        p.z -= target * s * (0.6 + (1 - p.z) * 0.8);
        if (p.z <= 0.02) { items[i] = newStar(false); continue; }
        const sx = cx + (p.x / p.z) * f, sy = cy + (p.y / p.z) * f;
        const px = cx + (p.x / pz) * f, py = cy + (p.y / pz) * f;
        if (sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50) { items[i] = newStar(false); continue; }
        const near = 1 - p.z;
        ctx.globalAlpha = Math.min(1, 0.15 + near * 0.9);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 0.6 + near * 1.8;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx, sy); ctx.stroke();
      }
    } else if (mode === 'lava') {
      // Blobs rise and fall slowly; drawn soft and additive on a small canvas,
      // the canvas's CSS contrast filter turns their overlap into one gooey
      // shape (see .amb-particles.lava).
      const tt = t / 1000;
      // Opaque black under the blobs: the contrast filter needs it, and the
      // screen blend makes black disappear.
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (const b of items) {
        const y = H * (0.5 + 0.42 * Math.sin(tt * b.speed * 2 * Math.PI + b.phase));
        const x = b.x + Math.sin(tt * b.sway + b.swayPhase) * W * 0.06;
        const r = b.r * (0.9 + 0.1 * Math.sin(tt * 0.7 + b.phase));
        ctx.globalAlpha = 0.9;
        ctx.drawImage(sprites.blob, x - r, y - r, r * 2, r * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  function loop(t) {
    raf = requestAnimationFrame(loop);
    if (document.hidden) { last = t; return; }
    const dt = t - last;
    if (dt < (FRAME_MS[mode] || 33)) return;
    last = t;
    draw(t, Math.min(dt, 100));
  }

  function set(next) {
    const want = ANIMATED_BACKGROUNDS.includes(next) ? next : null;
    if (want === mode) return;
    mode = want;
    cancelAnimationFrame(raf);
    claimAnalyzer('hyperspace', mode === 'hyperspace');
    if (!mode) { canvas?.remove(); canvas = ctx = null; items = []; return; }
    if (!canvas) {
      canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d');
      $('#ambient').append(canvas);
      sprites ||= makeSprites();
    }
    canvas.className = `amb-particles ${mode}`;
    shooting = null;
    nextShoot = performance.now() + 3000;
    nextSlide = 0;
    resize();
    if (!still()) { last = performance.now(); raf = requestAnimationFrame(loop); }
  }

  window.addEventListener('resize', () => { if (mode) resize(); });
  return { set };
})();
