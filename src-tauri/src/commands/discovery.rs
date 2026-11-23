//! The Discover page: new releases everywhere, artists like the ones you
//! play, and "because you listened to…" rows built from your listening log.
//! Every section is its own command so the page fills in as each arrives,
//! and each is cached for a while (they cost several requests).

use std::collections::HashSet;
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
use crate::ytm::{self, Card};

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

/// Your most played artists lately (falling back to longer ranges), and every
/// artist you already know (played or followed), normalized.
fn taste(st: &AppState) -> (Vec<String>, HashSet<String>) {
    let mut seeds = Vec::new();
    for range in ["4w", "6m", "all"] {
        for a in crate::stats::summarize(range, None).top_artists {
            if !seeds.iter().any(|s: &String| norm_text(s) == norm_text(&a.name)) {
                seeds.push(a.name);
            }
        }
        if seeds.len() >= 5 {
            break;
        }
    }
    seeds.truncate(5);
    let mut known: HashSet<String> = crate::stats::summarize("all", None).top_artists.iter().map(|a| norm_text(&a.name)).collect();
    known.extend(st.store.library.locked().followed.iter().map(|f| norm_text(&f.name)));
    (seeds, known)
}

#[derive(Debug, Clone, Serialize)]
pub struct ArtistPick {
    pub card: Card,
    /// The artist of yours this one is related to.
    pub because: String,
}

/// Artists related to your top artists that you don't listen to yet.
/// Empty when there's no listening history (the page shows chart artists).
#[tauri::command]
pub async fn discover_artists(st: State<'_, AppState>, force: Option<bool>) -> AppResult<Vec<ArtistPick>> {
    static CACHE: Mutex<Option<Cached<Vec<ArtistPick>>>> = Mutex::new(None);
    let (seeds, known) = taste(&st);
    if seeds.is_empty() {
        return Ok(Vec::new());
    }
    let key = seeds.join("|");
    if !force.unwrap_or(false) {
        if let Some(v) = cached(&CACHE, &key, PERSONAL_TTL) {
            return Ok(v);
        }
    }
    let pages = join_all(seeds.iter().map(|name| async move {
        let (id, _) = ytm::find_artist(name).await.ok()?;
        let info = ytm::artist(&id).await.ok()?;
        Some((name.clone(), info.related))
    }))
    .await;
    // Round-robin over the seeds, so the first row isn't all one artist's circle.
    let lists: Vec<(String, Vec<Card>)> = pages.into_iter().flatten().collect();
    let mut seen_ids = HashSet::new();
    let mut seen_names = known;
    let mut out = Vec::new();
    let longest = lists.iter().map(|(_, l)| l.len()).max().unwrap_or(0);
    for i in 0..longest {
        for (because, cards) in &lists {
            let Some(c) = cards.get(i) else { continue };
            let Some(id) = c.browse_id.clone() else { continue };
            if seen_ids.insert(id) && seen_names.insert(norm_text(&c.title)) {
                out.push(ArtistPick { card: c.clone(), because: because.clone() });
            }
        }
    }
    out.truncate(18);
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

/// Two rows of songs related to songs you've been playing (different ones
/// each day), leaving out what's in your recent history.
#[tauri::command]
pub async fn discover_because(st: State<'_, AppState>, force: Option<bool>) -> AppResult<Vec<BecauseRow>> {
    static CACHE: Mutex<Option<Cached<Vec<BecauseRow>>>> = Mutex::new(None);
    let mut top: Vec<Track> = crate::stats::summarize("4w", None).top_tracks.into_iter().map(|t| t.track).collect();
    if top.len() < 2 {
        top = crate::stats::summarize("all", None).top_tracks.into_iter().map(|t| t.track).collect();
    }
    // One song per artist, then rotate daily through the top ones.
    let mut artists = HashSet::new();
    top.retain(|t| artists.insert(norm_text(&t.artist)));
    top.truncate(8);
    if top.is_empty() {
        return Ok(Vec::new());
    }
    let day = (crate::store::now_ms() / 86_400_000) as usize;
    let seeds: Vec<Track> = (0..top.len().min(2)).map(|i| top[(day * 2 + i) % top.len()].clone()).collect();
    let key = seeds.iter().map(|t| t.key.as_str()).collect::<Vec<_>>().join("|");
    if !force.unwrap_or(false) {
        if let Some(v) = cached(&CACHE, &key, PERSONAL_TTL) {
            return Ok(v);
        }
    }
    let exclude: HashSet<String> = st.store.library.locked().history.iter().take(150).map(|h| h.track.key.clone()).collect();
    let cache = st.cache.clone();
    let rows = join_all(seeds.into_iter().map(|seed| {
        let (exclude, cache) = (&exclude, &cache);
        async move {
            let tracks = crate::radio::related(&seed, exclude, 12, cache).await.ok()?;
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
