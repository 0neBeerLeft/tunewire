'use strict';

// ===========================================================================
// Discover: moods, "because you listened to…", artists like yours, new
// releases and what's trending. Each section loads on its own (some take a
// few requests), and the results are kept for the session; Refresh asks for
// new ones.
// ===========================================================================

const disc = { seq: 0, releases: null, artists: null, because: null, charts: null };

/** A track as a card (cardTile plays it on click). */
function trackCard(t) {
  return { kind: 'song', title: t.title, subtitle: t.artist || '', thumbnail: t.thumbnail, browse_id: null, video_id: null, track: t };
}

function discSkeleton(n = 7, round = false) {
  return h('div', { class: 'card-row one-line' }, ...Array.from({ length: n }, (_, i) => h('div', { class: `tile skeleton${round ? ' round' : ''}`, style: `--i:${i}` }, h('div', { class: 'tile-art' }), h('div', { class: 'sk', style: 'width:70%' }), h('div', { class: 'sk', style: 'width:45%' }))));
}

function discSection(title, meta) {
  const titleEl = h('div', { class: 'section-title' }, title, meta ? h('span', { class: 'meta ml-8' }, meta) : null);
  const content = h('div', {}, discSkeleton());
  return { el: h('div', { class: 'artist-section disc-section' }, titleEl, content), titleEl, content };
}

/** Load one section: a cached value, else `fetch`; `fill` renders it. */
async function discLoad(key, fetch, sec, fill) {
  const seq = disc.seq;
  try {
    if (!disc[key]) disc[key] = await fetch();
    if (seq !== disc.seq) return;
    fill(disc[key]);
  } catch (e) {
    if (seq !== disc.seq) return;
    sec.content.replaceChildren(h('div', { class: 'disc-error' }, h('span', { class: 'muted' }, errMsg(e)),
      h('button', { class: 'btn small', onclick: () => { disc[key] = null; sec.content.replaceChildren(discSkeleton()); discLoad(key, fetch, sec, fill); } }, 'Try again')));
  }
}

async function renderDiscover(force = false) {
  const seq = ++disc.seq;
  const body = $('#discover-body');
  if (force) Object.assign(disc, { releases: null, artists: null, because: null, charts: null });

  const refreshBtn = h('button', { class: 'btn', html: `${icon('refresh')}Refresh`, title: 'Find new picks', onclick: () => renderDiscover(true) });
  const surpriseBtn = h('button', { class: 'btn primary', html: `${icon('shuffle')}Surprise me`, title: 'Play something new to you', onclick: () => surpriseMe(surpriseBtn) });
  const head = h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Discover'), h('span', { class: 'meta' }, 'New music, picked from what you play')),
    h('div', { class: 'actions' }, refreshBtn, surpriseBtn));

  const moods = h('div', { class: 'disc-moods' });
  const because = h('div', {});
  const artists = discSection('Artists you might like');
  const releases = discSection('New releases', 'Albums and singles out now');
  const trending = discSection('Trending now');
  body.replaceChildren(head, moods, because, artists.el, releases.el, trending.el);

  // Moods & genres as a row of colored chips (the full grid is in Search).
  (async () => {
    try {
      if (!state.moods) state.moods = await call('ytm_moods');
      if (seq !== disc.seq) return;
      const all = state.moods.flatMap((s) => s.items);
      moods.replaceChildren(...all.slice(0, 16).map((m, i) => h('button', { class: 'disc-mood', style: `--c:${saturate(m.color)};--i:${i}`, onclick: () => openMood(m) }, m.title)),
        all.length > 16 ? h('button', { class: 'disc-mood more', onclick: () => { showView('search'); } }, 'All moods & genres') : null);
    } catch { moods.remove(); }
  })();

  // Because you listened to… (up to two rows from your recent favourites).
  discLoad('because', () => call('discover_because', { force }), { content: because }, (rows) => {
    if (!rows.length) {
      because.replaceChildren(h('div', { class: 'disc-hint' }, h('span', { html: icon('sparkle') }),
        h('span', {}, 'Play a few songs and this page gets personal: songs and artists like the ones you listen to show up here.')));
      return;
    }
    because.replaceChildren(...rows.map((r) => h('div', { class: 'artist-section disc-section' },
      h('div', { class: 'section-title' }, h('span', { class: 'disc-because' }, 'Because you listened to ', h('b', {}, r.seed.title)),
        h('span', { class: 'ml-auto' }),
        h('button', { class: 'btn small', html: `${icon('play')}Play all`, onclick: () => playList(r.tracks, 0) }),
        h('button', { class: 'btn small', html: `${icon('radio')}Radio`, title: `Endless radio from “${r.seed.title}”`, onclick: () => startRadio(r.seed) })),
      cardRow(r.tracks.map(trackCard), 14))));
    for (const row of because.querySelectorAll('.card-row')) row.classList.add('one-line');
  });

  // Artists related to yours (chart artists when there's no history yet).
  discLoad('artists', () => call('discover_artists', { force }), artists, async (picks) => {
    let cards = picks.map((p) => ({ ...p.card, because: p.because }));
    if (!cards.length) {
      artists.titleEl.firstChild.textContent = 'Popular artists right now';
      if (!disc.charts) disc.charts = await call('get_charts', { country: state.settings?.charts_country || 'ZZ' }).catch(() => null);
      cards = (disc.charts?.artists || []).slice(0, 14).map((a) => ({ kind: 'artist', title: a.name, subtitle: '', thumbnail: a.thumbnail, browse_id: null }));
    }
    if (!cards.length) { artists.el.remove(); return; }
    const row = h('div', { class: 'card-row one-line' }, ...cards.map((c, i) => {
      const tile = cardTile(c, i);
      if (c.because) {
        tile.querySelector('.tile-sub').textContent = `Like ${c.because}`;
        tile.title = `${c.title} · fans of ${c.because} listen to them`;
      }
      return tile;
    }));
    artists.content.replaceChildren(row);
  });

  discLoad('releases', () => call('discover_new_releases', { force }), releases, (cards) => {
    if (!cards.length) { releases.el.remove(); return; }
    releases.content.replaceChildren(h('div', { class: 'card-row disc-two-lines' }, ...cards.slice(0, 24).map((c, i) => cardTile(c, i))));
  });

  discLoad('charts', () => call('get_charts', { country: state.settings?.charts_country || 'ZZ' }), trending, (charts) => {
    const lists = (charts?.playlists || []).slice(0, 7);
    if (!lists.length) { trending.el.remove(); return; }
    trending.titleEl.append(h('span', { class: 'ml-auto' }), h('button', { class: 'btn small', onclick: () => showView('charts') }, 'All charts'));
    trending.content.replaceChildren(albumGrid(lists.map((p) => ({ title: p.title, url: p.url, thumbnail: p.thumbnail }))));
  });
}

/** Play something new: a related artist's top songs, a radio from a
 *  "because" pick, or a new release. */
async function surpriseMe(btn) {
  const pool = [];
  for (const p of disc.artists || []) pool.push(() => playCard(p.card));
  for (const r of disc.because || []) for (const t of r.tracks) pool.push(() => startRadio(t));
  for (const c of (disc.releases || []).slice(0, 12)) pool.push(() => playCard(c));
  if (!pool.length) { toast('Still looking for something. Try again in a moment.', 'info', 2000); return; }
  btn.disabled = true;
  try { await pool[Math.floor(Math.random() * pool.length)](); } finally { btn.disabled = false; }
}
