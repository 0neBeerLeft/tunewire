//! The Discover page, built around the listener's taste.
//!
//! Taste = the artists and songs you play most (listening log), your liked
//! songs, what you played recently, and the artists you follow. From it:
//! - "Picked for you": songs that several of your favourite songs' radios
//!   agree on (the same scoring as Discover Weekly, `radio::recommend`);
//! - "Because you listened to …": one song's closest relatives;
//! - "New from artists you like": recent singles/albums of your artists and
//!   of the artists closest to them;
//! - "Artists you might like": related to several of yours ranks first.
//!
//! With no taste yet the page offers popular artists to pick (follows them,
//! which seeds everything above). Each section is its own command so the
//! page fills in as each arrives; results are cached for a few hours.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures_util::future::join_all;
use serde::Serialize;
use tauri::State;

use crate::error::AppResult;
use crate::models::Track;
use crate::search::norm_text;
use crate::state::AppState;
use crate::sync_ext::LockExt;
use crate::ytm::{self, ArtistInfo, Card};

const RELEASES_TTL: Duration = Duration::from_secs(30 * 60);
const PERSONAL_TTL: Duration = Duration::from_secs(6 * 3600);

/// One cached value with the key it was built for.
struct Cached<T> {
    at: Instant,
    key: String,
    value: T,
}

fn cached<T: Clone>(slot: &Mutex<Option<Cached<T>>>, key: &str, ttl: Duration) -> Option<T> {
    slot.locked().as_ref().filter(|c| c.key == key && c.at.elapsed() < ttl).map(|c| c.value.clone())
}

fn store<T>(slot: &Mutex<Option<Cached<T>>>, key: String, value: T) {
    *slot.locked() = Some(Cached { at: Instant::now(), key, value });
}

fn today() -> u64 {
    crate::store::now_ms() / 86_400_000
}

/// The first credited artist, normalized ("A feat. B" / "A & B" → "a").
fn primary(artist: &str) -> String {
    let first = artist.split([',', '&']).next().unwrap_or(artist);
    let first = first.split(" feat").next().unwrap_or(first).split(" ft.").next().unwrap_or(first);
    norm_text(first)
}

// ---------------------------------------------------------------------------
// Taste
// ---------------------------------------------------------------------------

struct Taste {
    /// Favourite artists, strongest first (display names).
    artists: Vec<(String, Option<String>)>,
    /// Songs that represent the taste: most played, then liked, then recent.
    songs: Vec<Track>,
    /// Every artist and song already known (left out of suggestions).
    known_artists: HashSet<String>,
    known_songs: HashSet<String>,
}

fn taste(st: &AppState) -> Taste {
    let lib = st.store.library.locked();
    // Artists: weighted by plays in the last 4 weeks, 6 months, all time,
    // plus follows and liked songs.
    let mut score: HashMap<String, (f64, String, Option<String>)> = HashMap::new();
    let mut add = |name: &str, thumb: Option<String>, w: f64| {
        let k = primary(name);
        if k.is_empty() {
            return;
        }
        let e = score.entry(k).or_insert_with(|| (0.0, name.split([',', '&']).next().unwrap_or(name).trim().to_string(), None));
        e.0 += w;
        if e.2.is_none() {
            e.2 = thumb;
        }
    };
    for (range, w) in [("4w", 3.0), ("6m", 1.5), ("all", 0.5)] {
        for (i, a) in crate::stats::summarize(range, None).top_artists.iter().take(15).enumerate() {
            add(&a.name, a.thumbnail.clone(), w * (1.0 - i as f64 / 20.0) * (a.plays as f64).sqrt());
        }
    }
    for f in &lib.followed {
        add(&f.name, f.thumbnail.clone(), 4.0);
    }
    for t in lib.favorites.iter().take(100) {
        add(&t.artist, None, 0.6);
    }
    let mut artists: Vec<(f64, String, Option<String>)> = score.into_values().collect();
    artists.sort_by(|a, b| b.0.total_cmp(&a.0));

    // Songs: most played lately, liked (newest first), recently played.
    let mut seen = HashSet::new();
    let mut songs = Vec::new();
    let top = crate::stats::summarize("4w", None).top_tracks;
    let top = if top.len() >= 5 { top } else { crate::stats::summarize("all", None).top_tracks };
    for t in top.into_iter().take(20).map(|t| t.track).chain(lib.favorites.iter().take(20).cloned()).chain(lib.history.iter().take(20).map(|h| h.track.clone())) {
        if seen.insert(t.key.clone()) {
            songs.push(t);
        }
    }

    let mut known_artists: HashSet<String> = artists.iter().map(|a| primary(&a.1)).collect();
    known_artists.extend(crate::stats::summarize("all", None).top_artists.iter().map(|a| primary(&a.name)));
    let mut known_songs: HashSet<String> = lib.history.iter().take(300).map(|h| h.track.key.clone()).collect();
    known_songs.extend(lib.favorites.iter().map(|t| t.key.clone()));
    known_songs.extend(songs.iter().map(|t| t.key.clone()));
    Taste { artists: artists.into_iter().map(|a| (a.1, a.2)).collect(), songs, known_artists, known_songs }
}

#[derive(Debug, Clone, Serialize)]
pub struct TasteArtist {
    pub name: String,
    pub thumbnail: Option<String>,
}

/// Your taste at a glance (the page's "Based on …" line). Instant: local only.
#[tauri::command]
pub fn discover_taste(st: State<'_, AppState>) -> Vec<TasteArtist> {
    taste(&st).artists.into_iter().take(8).map(|(name, thumbnail)| TasteArtist { name, thumbnail }).collect()
}

/// Artist pages by name, shared by the sections (each costs two requests).
async fn artist_info(name: &str) -> Option<ArtistInfo> {
    static PAGES: Mutex<Option<HashMap<String, (Instant, ArtistInfo)>>> = Mutex::new(None);
    let key = primary(name);
    if let Some((_, a)) = PAGES.locked().as_ref().and_then(|m| m.get(&key)).filter(|(at, _)| at.elapsed() < PERSONAL_TTL) {
        return Some(a.clone());
    }
    let (id, _) = ytm::find_artist(name).await.ok()?;
    let info = ytm::artist(&id).await.ok()?;
    let mut g = PAGES.locked();
    let m = g.get_or_insert_with(HashMap::new);
    if m.len() > 200 {
        m.clear();
    }
    m.insert(key, (Instant::now(), info.clone()));
    Some(info)
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct Pick {
    pub track: Track,
    /// The song of yours it's most related to.
    pub because: String,
}

/// Songs that fit your taste as a whole: radios of several of your songs,
/// songs several of them agree on first. New ones each day (or on Refresh).
#[tauri::command]
pub async fn discover_picks(st: State<'_, AppState>, force: Option<bool>) -> AppResult<Vec<Pick>> {
    static CACHE: Mutex<Option<Cached<Vec<Pick>>>> = Mutex::new(None);
    static NONCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let force = force.unwrap_or(false);
    if force {
        NONCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
    let t = taste(&st);
    let mut seeds = t.songs.clone();
    // Nothing played or liked yet, but artists followed: their top songs.
    if seeds.is_empty() {
        for (name, _) in t.artists.iter().take(4) {
            if let Some(a) = artist_info(name).await {
                seeds.extend(a.top_songs.into_iter().take(3));
            }
        }
    }
    if seeds.is_empty() {
        return Ok(Vec::new());
    }
    let nonce = today() * 1000 + NONCE.load(std::sync::atomic::Ordering::Relaxed);
    let key = format!("{nonce}|{}", seeds.iter().take(10).map(|s| s.key.as_str()).collect::<Vec<_>>().join("|"));
    if !force {
        if let Some(v) = cached(&CACHE, &key, PERSONAL_TTL) {
            return Ok(v);
        }
    }
    let recs = crate::radio::recommend(seeds, nonce, 60, &st.cache).await?;
    let out: Vec<Pick> = recs.into_iter().filter(|r| !t.known_songs.contains(&r.track.key)).take(24).map(|r| Pick { track: r.track, because: r.because }).collect();
    if !out.is_empty() {
        store(&CACHE, key, out.clone());
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
pub struct BecauseRow {
    pub seed: Track,
    pub tracks: Vec<Track>,
}

/// Rows of songs related to single songs you love (different ones each
/// day), leaving out what you already know.
#[tauri::command]
pub async fn discover_because(st: State<'_, AppState>, force: Option<bool>) -> AppResult<Vec<BecauseRow>> {
    static CACHE: Mutex<Option<Cached<Vec<BecauseRow>>>> = Mutex::new(None);
    let t = taste(&st);
    // One song per artist, then rotate daily through them.
    let mut artists = HashSet::new();
    let mut pool: Vec<Track> = t.songs.iter().filter(|s| artists.insert(primary(&s.artist))).take(10).cloned().collect();
    if pool.is_empty() {
        return Ok(Vec::new());
    }
    let n = pool.len().min(3);
    let start = (today() as usize * n) % pool.len();
    pool.rotate_left(start);
    let seeds: Vec<Track> = pool.into_iter().take(n).collect();
    let key = seeds.iter().map(|s| s.key.as_str()).collect::<Vec<_>>().join("|");
    if !force.unwrap_or(false) {
        if let Some(v) = cached(&CACHE, &key, PERSONAL_TTL) {
            return Ok(v);
        }
    }
    let cache = st.cache.clone();
    let known = &t.known_songs;
    let rows = join_all(seeds.into_iter().map(|seed| {
        let cache = &cache;
        async move {
            let tracks = crate::radio::related(&seed, known, 14, cache).await.ok()?;
            (tracks.len() >= 4).then_some(BecauseRow { seed, tracks })
        }
    }))
    .await;
    let out: Vec<BecauseRow> = rows.into_iter().flatten().collect();
    if !out.is_empty() {
        store(&CACHE, key, out.clone());
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
pub struct ArtistPick {
    pub card: Card,
    /// Your artists this one is related to (strongest first).
    pub because: Vec<String>,
}

/// Rank related artists: related to more of your artists, and to stronger
/// ones, and higher in their lists, first; artists you know are left out.
fn rank_related(lists: &[(String, Vec<Card>)], known: &HashSet<String>, limit: usize) -> Vec<ArtistPick> {
    let mut acc: HashMap<String, (f64, Card, Vec<String>)> = HashMap::new();
    for (si, (seed, cards)) in lists.iter().enumerate() {
        let seed_w = 1.0 / (1.0 + si as f64 * 0.25);
        for (ri, c) in cards.iter().enumerate() {
            let k = primary(&c.title);
            if k.is_empty() || known.contains(&k) || c.browse_id.is_none() {
                continue;
            }
            let e = acc.entry(k).or_insert_with(|| (0.0, c.clone(), Vec::new()));
            e.0 += seed_w * (1.0 - ri as f64 / 20.0).max(0.2);
            if !e.2.contains(seed) {
                e.2.push(seed.clone());
            }
        }
    }
    let mut pool: Vec<(f64, Card, Vec<String>)> = acc.into_values().map(|(s, c, b)| (s + 0.8 * (b.len() as f64 - 1.0), c, b)).collect();
    // Pick greedily, discounting each of your artists a little more every
    // time one of their circle is picked: the row then covers your whole
    // taste instead of filling up with the first artist's neighbours.
    let mut used: HashMap<String, usize> = HashMap::new();
    let mut out = Vec::new();
    while out.len() < limit && !pool.is_empty() {
        let adjusted = |p: &(f64, Card, Vec<String>)| p.0 - 0.35 * p.2.iter().map(|b| used.get(b).copied().unwrap_or(0)).min().unwrap_or(0) as f64;
        let best = (0..pool.len()).max_by(|&i, &j| adjusted(&pool[i]).total_cmp(&adjusted(&pool[j]))).unwrap_or(0);
        let (_, card, because) = pool.swap_remove(best);
        for b in &because {
            *used.entry(b.clone()).or_default() += 1;
        }
        out.push(ArtistPick { card, because });
    }
    out
}

#[tauri::command]
pub async fn discover_artists(st: State<'_, AppState>, force: Option<bool>) -> AppResult<Vec<ArtistPick>> {
    static CACHE: Mutex<Option<Cached<Vec<ArtistPick>>>> = Mutex::new(None);
    let t = taste(&st);
    let seeds: Vec<String> = t.artists.iter().take(6).map(|a| a.0.clone()).collect();
    if seeds.is_empty() {
        return Ok(Vec::new());
    }
    let key = seeds.join("|");
    if !force.unwrap_or(false) {
        if let Some(v) = cached(&CACHE, &key, PERSONAL_TTL) {
            return Ok(v);
        }
    }
    let lists: Vec<(String, Vec<Card>)> = join_all(seeds.iter().map(|name| async move { artist_info(name).await.map(|a| (name.clone(), a.related)) })).await.into_iter().flatten().collect();
    let out = rank_related(&lists, &t.known_artists, 18);
    if !out.is_empty() {
        store(&CACHE, key, out.clone());
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
pub struct Fresh {
    pub card: Card,
    pub artist: String,
    /// One of your artists (not a related one).
    pub yours: bool,
}

/// The year in a release subtitle ("Single • 2026").
fn release_year(c: &Card) -> Option<i32> {
    c.subtitle.split(" • ").filter_map(|p| p.trim().parse::<i32>().ok()).find(|y| (1900..3000).contains(y))
}

/// Versions of a release nobody wants on a discovery page.
fn is_variant(title: &str) -> bool {
    let t = title.to_lowercase();
    ["instrumental", "sped up", "slowed", "karaoke", "extended", "a cappella", "acapella"].iter().any(|v| t.contains(v))
}

/// Recent releases (this year and last), at most two per artist, newest
/// first, alternating your artists with related ones.
fn pick_fresh(pages: &[(String, bool, Vec<Card>)], this_year: i32) -> Vec<Fresh> {
    let mut lists: Vec<Vec<Fresh>> = pages
        .iter()
        .map(|(artist, yours, cards)| {
            let mut seen_titles = HashSet::new();
            let mut l: Vec<(i32, Card)> = cards
                .iter()
                .filter(|c| c.browse_id.is_some() && !is_variant(&c.title))
                .filter_map(|c| release_year(c).filter(|y| *y >= this_year - 1).map(|y| (y, c.clone())))
                // "Song" and "Song (Remix)": keep the first only.
                .filter(|(_, c)| seen_titles.insert(norm_text(c.title.split(" (").next().unwrap_or(&c.title))))
                .collect();
            l.sort_by_key(|x| std::cmp::Reverse(x.0));
            l.into_iter().take(2).map(|(_, card)| Fresh { card, artist: artist.clone(), yours: *yours }).collect()
        })
        .collect();
    let mut out = Vec::new();
    let mut ids = HashSet::new();
    let longest = lists.iter().map(Vec::len).max().unwrap_or(0);
    for i in 0..longest {
        for l in lists.iter_mut() {
            if let Some(f) = l.get(i) {
                if ids.insert(f.card.browse_id.clone()) {
                    out.push(f.clone());
                }
            }
        }
    }
    out
}

#[tauri::command]
pub async fn discover_fresh(st: State<'_, AppState>, force: Option<bool>) -> AppResult<Vec<Fresh>> {
    static CACHE: Mutex<Option<Cached<Vec<Fresh>>>> = Mutex::new(None);
    let t = taste(&st);
    let mine: Vec<String> = t.artists.iter().take(8).map(|a| a.0.clone()).collect();
    if mine.is_empty() {
        return Ok(Vec::new());
    }
    let key = mine.join("|");
    if !force.unwrap_or(false) {
        if let Some(v) = cached(&CACHE, &key, PERSONAL_TTL) {
            return Ok(v);
        }
    }
    let infos: Vec<(String, ArtistInfo)> = join_all(mine.iter().map(|n| async move { artist_info(n).await.map(|a| (n.clone(), a)) })).await.into_iter().flatten().collect();
    // Plus the artists closest to yours (related to several of them).
    let lists: Vec<(String, Vec<Card>)> = infos.iter().map(|(n, a)| (n.clone(), a.related.clone())).collect();
    let near: Vec<String> = rank_related(&lists, &t.known_artists, 6).into_iter().map(|p| p.card.title).collect();
    let near_infos: Vec<(String, ArtistInfo)> = join_all(near.iter().map(|n| async move { artist_info(n).await.map(|a| (n.clone(), a)) })).await.into_iter().flatten().collect();
    let mut pages: Vec<(String, bool, Vec<Card>)> = Vec::new();
    let (mut a, mut b) = (infos.into_iter(), near_infos.into_iter());
    loop {
        let (x, y) = (a.next(), b.next());
        if x.is_none() && y.is_none() {
            break;
        }
        for (info, yours) in [(x, true), (y, false)] {
            if let Some((name, info)) = info {
                pages.push((name, yours, info.singles.into_iter().chain(info.albums).collect()));
            }
        }
    }
    let year = chrono::Datelike::year(&chrono::Local::now());
    let out: Vec<Fresh> = pick_fresh(&pages, year).into_iter().take(24).collect();
    if !out.is_empty() {
        store(&CACHE, key, out.clone());
    }
    Ok(out)
}

/// New albums and singles across YouTube Music (for listeners with no
/// taste yet).
#[tauri::command]
pub async fn discover_new_releases(force: Option<bool>) -> AppResult<Vec<Card>> {
    static CACHE: Mutex<Option<Cached<Vec<Card>>>> = Mutex::new(None);
    if !force.unwrap_or(false) {
        if let Some(v) = cached(&CACHE, "", RELEASES_TTL) {
            return Ok(v);
        }
    }
    let v = ytm::new_releases().await?;
    store(&CACHE, String::new(), v.clone());
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(title: &str, sub: &str, id: &str) -> Card {
        Card { kind: "single".into(), title: title.into(), subtitle: sub.into(), browse_id: Some(id.into()), video_id: None, thumbnail: None, track: None }
    }

    #[test]
    fn related_to_several_of_your_artists_ranks_first() {
        let lists = vec![("A".to_string(), vec![card("X", "", "x"), card("Y", "", "y"), card("Known", "", "k")]), ("B".to_string(), vec![card("Z", "", "z"), card("Y", "", "y")])];
        let known: HashSet<String> = [primary("Known")].into();
        let r = rank_related(&lists, &known, 10);
        assert_eq!(r[0].card.title, "Y");
        assert_eq!(r[0].because, vec!["A".to_string(), "B".to_string()]);
        assert!(r.iter().all(|p| p.card.title != "Known"));
    }

    #[test]
    fn fresh_keeps_recent_non_variant_releases_newest_first() {
        let pages = vec![(
            "A".to_string(),
            true,
            vec![
                card("Old", "Single • 2019", "o"),
                card("Song (Instrumental)", "Single • 2026", "i"),
                card("Song", "Single • 2025", "s"),
                card("Song (Remix)", "Single • 2025", "r"),
                card("New", "EP • 2026", "n"),
            ],
        )];
        let f = pick_fresh(&pages, 2026);
        let titles: Vec<&str> = f.iter().map(|x| x.card.title.as_str()).collect();
        assert_eq!(titles, vec!["New", "Song"]);
    }

    /// `cargo test live_taste -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_taste() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let _g = rt.enter();
        let mine = ["Dua Lipa", "The Weeknd", "Daft Punk"];
        let infos: Vec<(String, ArtistInfo)> = mine.iter().filter_map(|n| rt.block_on(artist_info(n)).map(|a| (n.to_string(), a))).collect();
        for (n, a) in &infos {
            println!("info    {n} -> {} related {} singles {} albums {}", a.name, a.related.len(), a.singles.len(), a.albums.len());
        }
        let known: HashSet<String> = mine.iter().map(|n| primary(n)).collect();
        let lists: Vec<(String, Vec<Card>)> = infos.iter().map(|(n, a)| (n.clone(), a.related.clone())).collect();
        let picks = rank_related(&lists, &known, 10);
        for p in &picks {
            println!("artist  {:<24} because {:?}", p.card.title, p.because);
        }
        let pages: Vec<(String, bool, Vec<Card>)> = infos.into_iter().map(|(n, a)| (n, true, a.singles.into_iter().chain(a.albums).collect())).collect();
        for f in pick_fresh(&pages, 2026) {
            println!("fresh   {:<40} {} ({})", f.card.title, f.card.subtitle, f.artist);
        }
        assert!(picks.len() >= 5);
    }

    #[test]
    fn primary_artist_ignores_features() {
        assert_eq!(primary("Dua Lipa feat. DaBaby"), primary("Dua Lipa"));
        assert_eq!(primary("Daft Punk & Pharrell Williams"), primary("Daft Punk"));
    }
}
