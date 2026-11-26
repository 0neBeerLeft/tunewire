'use strict';

// ===========================================================================
// Phone layout (Android): bottom tabs, Library and Now playing as sheets.
// Styles: mobile.css (everything there is under body.mobile).
// ===========================================================================

const isMobile = /Android/i.test(navigator.userAgent) || new URLSearchParams(location.search).has('mobile');

(function setupMobile() {
  if (!isMobile) return;
  document.body.classList.add('mobile');
  const app = $('#app');
  // Android draws the app under the status bar and the navigation bar:
  // leave room for them (the WebView doesn't report them to CSS).
  if (/Android/i.test(navigator.userAgent)) {
    const pad = () => call('system_insets').then(({ top, bottom }) => {
      const st = document.body.style;
      if (top > 0) st.setProperty('--safe-t', `${Math.round(top)}px`);
      if (bottom > 0) st.setProperty('--safe-b', `${Math.round(bottom)}px`);
    }).catch(() => {});
    pad();
    window.addEventListener('resize', debounce(pad, 300));
  }
  // The sleep timer lives in the player bar's side controls, which phones
  // don't show: it sits in the Now playing sheet's header instead.
  const sleepBtn = $('#btn-sleep');
  if (sleepBtn) $('#panel-close')?.before(sleepBtn);
  // Start on the page, not with the side panel covering it.
  app.classList.add('queue-hidden');
  app.classList.remove('lib-collapsed'); // the library is a full sheet here
  app.classList.remove('queue-open');

  const tabs = [
    { id: 'home', label: 'Home', icon: 'home', run: () => { closeSheets(); showView('home'); } },
    { id: 'discover', label: 'Discover', icon: 'browse', run: () => { closeSheets(); showView('discover'); } },
    { id: 'library', label: 'Library', icon: 'library', run: () => toggleLibrary() },
    { id: 'together', label: 'Together', icon: 'headphones', run: () => { closeSheets(); showView('together'); } },
  ];
  const nav = h('nav', { class: 'mobile-nav', 'aria-label': 'Main' },
    ...tabs.map((t) => h('button', { 'data-tab': t.id, onclick: t.run, html: `${icon(t.icon)}<span>${t.label}</span>` })));
  app.append(nav);

  function mark(id) {
    for (const b of nav.querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === id);
  }
  function closeSheets() {
    document.body.classList.remove('lib-open');
    if (typeof setPanelOpen === 'function') setPanelOpen(false);
  }
  function toggleLibrary() {
    const open = !document.body.classList.contains('lib-open');
    if (typeof setPanelOpen === 'function') setPanelOpen(false);
    document.body.classList.toggle('lib-open', open);
    mark(open ? 'library' : (state.view || 'home'));
  }

  // Opening something from the library closes the sheet.
  $('#sidebar')?.addEventListener('click', (e) => {
    if (e.target.closest('.lib-item, .nav-item, [data-view], [data-playlist]')) document.body.classList.remove('lib-open');
  });
  // Tapping the mini player opens Now playing full screen.
  for (const el of [$('#np-cover'), $('#np-title')]) {
    el?.addEventListener('click', (e) => {
      e.preventDefault();
      document.body.classList.remove('lib-open');
      if (typeof setPanelOpen === 'function') setPanelOpen(true);
      if (typeof showPanel === 'function') showPanel('now');
    }, true);
  }
  // Now playing open: the mini player grows into the full controls
  // (scrubber with times, shuffle / previous / play / next / repeat).
  const syncFull = () => document.body.classList.toggle('np-full', typeof panelOpen === 'function' && panelOpen() && state.panel === 'now');
  new MutationObserver(syncFull).observe(app, { attributes: true, attributeFilter: ['class'] });
  for (const b of $$('.panel-tabs button')) b.addEventListener('click', () => setTimeout(syncFull, 0));
  syncFull();
  // Android's back gesture: close a sheet first.
  window.addEventListener('popstate', () => {
    if (document.body.classList.contains('lib-open')) document.body.classList.remove('lib-open');
  });

  // Keep the active tab in step with the page shown.
  const views = new Set(tabs.map((t) => t.id));
  // Another page opened (from a menu, a link, a search) closes the Library
  // sheet, or the page would open behind it.
  let shown = state.view;
  const sync = () => {
    if (state.view !== shown) {
      shown = state.view;
      document.body.classList.remove('lib-open');
    }
    if (!document.body.classList.contains('lib-open')) mark(views.has(state.view) ? state.view : '');
  };
  new MutationObserver(sync).observe($('.main') || document.body, { attributes: true, subtree: true, attributeFilter: ['hidden', 'class'] });
  sync();
})();

// Lock screen, notification and headset buttons (media-android plugin).
(function mediaButtons() {
  if (!/Android/i.test(navigator.userAgent)) return;
  const listen = window.__TAURI__?.core?.addPluginListener;
  if (!listen) return;
  listen('media-android', 'action', ({ action }) => {
    const playing = document.body.classList.contains('is-playing');
    if (action === 'next') call('next_track').catch(() => {});
    else if (action === 'prev') call('previous_track').catch(() => {});
    else if (action === 'toggle' || (action === 'play' && !playing) || (action === 'pause' && playing)) call('toggle_pause').catch(() => {});
    else if (action === 'stop' && playing) call('toggle_pause').catch(() => {});
  }).catch(() => {});
})();

// Updates on Android: the app can't replace itself, so it checks the
// download server for a newer APK and offers to download it.
let androidUpdateCheck = null;
(function androidUpdates() {
  if (!/Android/i.test(navigator.userAgent)) return;
  const newer = (a, b) => {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    return false;
  };
  async function check(manual = false) {
    try {
      const rel = await (await fetch('https://dl.yuhron.site/tunewire/release.json', { cache: 'no-cache' })).json();
      const apk = (rel.assets || []).find((a) => /android.*\.apk$/i.test(a.name));
      const mine = await appVersion();
      if (!apk || !newer(rel.version, mine)) {
        if (manual === true) toast(`Tunewire ${mine} is up to date`, 'ok', 2500);
        return;
      }
      const pill = $('#update-pill');
      pill.hidden = false;
      pill.title = `Tunewire ${rel.version} is available`;
      pill.querySelector('span').textContent = 'Update';
      pill.querySelector('em').textContent = rel.version;
      pill.onclick = () => call('open_link', { url: apk.url }).catch((e) => toast(errMsg(e), 'error'));
      toast(`Tunewire ${rel.version} is available. Tap Update to download it.`, 'ok', 6000);
    } catch (e) {
      if (manual === true) toast(`Couldn’t check for updates: ${errMsg(e)}`, 'error');
    }
  }
  androidUpdateCheck = check;
  setTimeout(check, 8000);
  setInterval(check, 6 * 3600 * 1000);
})();
