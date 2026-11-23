'use strict';

// ===========================================================================
// Discover: music like what you listen to. Everything personal is built
// from your taste (most played artists and songs, liked songs, recent plays
// and followed artists): songs picked for you, "because you listened to…",
// new releases from your artists and their circle, and artists you might
// like. With no taste yet, it asks for a few artists you like first.
// Each section loads on its own; results are kept for the session and
// Refresh asks for new ones.
// ===========================================================================

const disc = { seq: 0, taste: null, picks: null, because: null, fresh: null, artists: null, releases: null, charts: null };

/** A track as a card (cardTile plays it on click). */
function trackCard(t) {
  return { kind: 'song', title: t.title, subtitle: t.artist || '', thumbnail: t.thumbnail, browse_id: null, video_id: null, track: t };
}

function discSkeleton(n = 7) {
  return h('div', { class: 'card-row one-line' }, ...Array.from({ length: n }, (_, i) => h('div', { class: 'tile skeleton', style: `--i:${i}` }, h('div', { class: 'tile-art' }), h('div', { class: 'sk', style: 'width:70%' }), h('div', { class: 'sk', style: 'width:45%' }))));
}

function discSection(title, meta) {
  const titleEl = h('div', { class: 'section-title' }, h('span', {}, title), meta ? h('span', { class: 'meta ml-8' }, meta) : null);
  const content = h('div', {}, discSkeleton());
  return { el: h('div', { class: 'artist-section disc-section' }, titleEl, content), titleEl, content };
}

/** Load one section: a cached value, else `fetch`; `fill` renders it. */
async function discLoad(key, fetch, sec, fill) {
  const seq = disc.seq;
  try {
    if (!disc[key]) disc[key] = await fetch();
    if (seq !== disc.seq) return;
    await fill(disc[key]);
  } catch (e) {
    if (seq !== disc.seq) return;
    sec.content.replaceChildren(h('div', { class: 'disc-error' }, h('span', { class: 'muted' }, errMsg(e)),
      h('button', { class: 'btn small', onclick: () => { disc[key] = null; sec.content.replaceChildren(discSkeleton()); discLoad(key, fetch, sec, fill); } }, 'Try again')));
  }
}

/** "A", "A and B", "A, B and C". */
function andList(names) {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function playAllBtn(tracks) {
  return h('button', { class: 'btn small', html: `${icon('play')}Play all`, onclick: () => playList(tracks, 0) });
}

async function renderDiscover(force = false) {
  const seq = ++disc.seq;
  const body = $('#discover-body');
  if (force) Object.assign(disc, { taste: null, picks: null, because: null, fresh: null, artists: null, releases: null, charts: null });

  const refreshBtn = h('button', { class: 'btn', html: `${icon('refresh')}Refresh`, title: 'New picks', onclick: () => renderDiscover(true) });
  const surpriseBtn = h('button', { class: 'btn primary', html: `${icon('shuffle')}Surprise me`, title: 'Play something new that fits your taste', onclick: () => surpriseMe(surpriseBtn) });
  const head = h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Discover'), h('span', { class: 'meta' }, 'Music like what you listen to')),
    h('div', { class: 'actions' }, refreshBtn, surpriseBtn));

  if (!disc.taste) disc.taste = await call('discover_taste').catch(() => []);
  if (seq !== disc.seq) return;
  if (!disc.taste.length) { renderDiscoverOnboarding(body, head); return; }

  // Based on: your artists, so it's clear where the picks come from.
  const basis = h('div', { class: 'disc-basis' }, h('span', { class: 'muted' }, 'Based on'),
    ...disc.taste.map((a) => h('button', { class: 'disc-basis-artist', title: `Open ${a.name}`, onclick: () => openArtist(a.name, null, { thumbnail: a.thumbnail }) },
      thumbEl(a.thumbnail, 'thumb round'), h('span', {}, a.name))));

  const picks = discSection('Picked for you', 'Songs that fit everything you like');
  const because = h('div', {});
  const fresh = discSection('New from artists you like');
  const artists = discSection('Artists you might like');
  const moods = h('div', { class: 'artist-section disc-section' }, h('div', { class: 'section-title' }, 'Explore moods & genres'), h('div', { class: 'disc-moods' }));
  body.replaceChildren(head, basis, picks.el, because, fresh.el, artists.el, moods);

  discLoad('picks', () => call('discover_picks', { force }), picks, (list) => {
    if (!list.length) { picks.el.remove(); return; }
    const tracks = list.map((p) => p.track);
    picks.titleEl.append(h('span', { class: 'ml-auto' }), playAllBtn(tracks));
    picks.content.replaceChildren(h('div', { class: 'card-row disc-two-lines' }, ...list.map((p, i) => {
      const tile = cardTile(trackCard(p.track), i);
      if (p.because) tile.title = `${p.track.title} · because you like “${p.because}”`;
      return tile;
    })));
  });

  discLoad('because', () => call('discover_because', { force }), { content: because }, (rows) => {
    because.replaceChildren(...rows.map((r) => h('div', { class: 'artist-section disc-section' },
      h('div', { class: 'section-title' }, h('span', { class: 'disc-because' }, 'Because you listened to ', h('b', {}, r.seed.title)),
        h('span', { class: 'ml-auto' }), playAllBtn(r.tracks),
        h('button', { class: 'btn small', html: `${icon('radio')}Radio`, title: `Endless radio from “${r.seed.title}”`, onclick: () => startRadio(r.seed) })),
      h('div', { class: 'card-row one-line' }, ...r.tracks.map((t, i) => cardTile(trackCard(t), i))))));
  });

  discLoad('fresh', () => call('discover_fresh', { force }), fresh, (list) => {
    if (!list.length) { fresh.el.remove(); return; }
    fresh.content.replaceChildren(h('div', { class: 'card-row one-line' }, ...list.map((f, i) => {
      const tile = cardTile(f.card, i);
      const kind = cardSub(f.card);
      tile.querySelector('.tile-sub').textContent = f.yours ? `${f.artist} • ${kind}` : `${f.artist} • ${kind} • New to you`;
      return tile;
    })));
  });

  discLoad('artists', () => call('discover_artists', { force }), artists, (list) => {
    if (!list.length) { artists.el.remove(); return; }
    artists.content.replaceChildren(h('div', { class: 'card-row one-line' }, ...list.map((p, i) => {
      const tile = cardTile(p.card, i);
      tile.querySelector('.tile-sub').textContent = `Like ${andList(p.because.slice(0, 2))}`;
      tile.title = `${p.card.title} · fans of ${andList(p.because)} listen to them`;
      return tile;
    })));
  });

  fillMoodChips(moods.querySelector('.disc-moods'), seq).catch(() => moods.remove());
}

async function fillMoodChips(box, seq) {
  if (!state.moods) state.moods = await call('ytm_moods');
  if (seq !== disc.seq) return;
  const all = state.moods.flatMap((s) => s.items);
  const chips = all.slice(0, 16).map((m, i) => h('button', { class: 'disc-mood', style: `--c:${saturate(m.color)};--i:${i}`, onclick: () => openMood(m) }, m.title));
  if (all.length > 16) chips.push(h('button', { class: 'disc-mood more', onclick: () => showView('search') }, 'All moods & genres'));
  box.replaceChildren(...chips);
}

/** No taste yet: pick a few artists (they're followed, which seeds the
 *  personal sections), with what's new and popular below meanwhile. */
function renderDiscoverOnboarding(body, head) {
  const seq = disc.seq;
  const chosen = new Set();
  const done = h('button', { class: 'btn primary', disabled: true, onclick: async () => {
    done.disabled = true;
    for (const a of chosen) await call('follow_artist', { name: a.name, url: null, thumbnail: a.thumbnail || null }).catch(() => {});
    if (typeof refreshFollowed === 'function') refreshFollowed();
    renderDiscover(true);
  } }, 'Show my picks');
  const grid = h('div', { class: 'disc-pick-grid' }, h('div', { class: 'loading-line' }, h('span', { class: 'spinner' }), 'Loading artists…'));
  const intro = h('div', { class: 'disc-onboard' },
    h('h2', {}, 'What do you like?'),
    h('p', { class: 'muted' }, 'Pick a few artists and Discover fills up with songs, artists and new releases like them. It also learns from what you play and like.'),
    grid, h('div', { class: 'actions' }, done));
  const releases = discSection('New releases', 'Albums and singles out now');
  const moods = h('div', { class: 'artist-section disc-section' }, h('div', { class: 'section-title' }, 'Explore moods & genres'), h('div', { class: 'disc-moods' }));
  body.replaceChildren(head, intro, releases.el, moods);

  (async () => {
    if (!disc.charts) disc.charts = await call('get_charts', { country: state.settings?.charts_country || 'ZZ' }).catch(() => null);
    if (seq !== disc.seq) return;
    const list = (disc.charts?.artists || []).slice(0, 30);
    if (!list.length) { grid.replaceChildren(h('p', { class: 'muted' }, 'Search for an artist you like and follow them, or just play some music.')); return; }
    grid.replaceChildren(...list.map((a, i) => {
      const b = h('button', { class: 'disc-pick', style: `--i:${i}`, 'aria-pressed': 'false', onclick: () => {
        const on = !chosen.has(a);
        if (on) chosen.add(a); else chosen.delete(a);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
        done.disabled = !chosen.size;
        done.textContent = chosen.size ? `Show my picks (${chosen.size})` : 'Show my picks';
      } }, thumbEl(a.thumbnail, 'thumb round'), h('span', {}, a.name), h('span', { class: 'disc-pick-check', html: icon('check') }));
      return b;
    }));
  })();

  discLoad('releases', () => call('discover_new_releases', {}), releases, (cards) => {
    if (!cards.length) { releases.el.remove(); return; }
    releases.content.replaceChildren(h('div', { class: 'card-row disc-two-lines' }, ...cards.slice(0, 24).map((c, i) => cardTile(c, i))));
  });
  fillMoodChips(moods.querySelector('.disc-moods'), seq).catch(() => moods.remove());
}

/** Play something new that fits: a pick's radio, a related artist's top
 *  songs, or a new release from your circle. */
async function surpriseMe(btn) {
  const pool = [];
  for (const p of disc.picks || []) pool.push(() => startRadio(p.track));
  for (const p of disc.artists || []) pool.push(() => playCard(p.card));
  for (const f of disc.fresh || []) pool.push(() => playCard(f.card));
  for (const r of disc.because || []) for (const t of r.tracks) pool.push(() => startRadio(t));
  if (!pool.length) for (const c of (disc.releases || []).slice(0, 12)) pool.push(() => playCard(c));
  if (!pool.length) { toast('Still looking for something. Try again in a moment.', 'info', 2000); return; }
  btn.disabled = true;
  try { await pool[Math.floor(Math.random() * pool.length)](); } finally { btn.disabled = false; }
}
