//! YouTube / YouTube Music stream links without yt-dlp: rustypipe talks to
//! YouTube's player API directly (Rust, with its own JavaScript solver), so a
//! link takes ~0.3 s instead of ~2 s and needs no Python. yt-dlp stays the
//! fallback for anything this can't do (age-gated, blocked, new YouTube
//! changes); see `ytdlp::extract_stream`.

use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

use rustypipe::client::RustyPipe;
use rustypipe::model::{AudioCodec, AudioFormat, AudioStream};

use crate::error::{AppError, AppResult};
use crate::sync_ext::LockExt;
use crate::ytdlp::StreamInfo;

/// Give up on the native path after this long (yt-dlp then takes over).
const TIMEOUT: Duration = Duration::from_secs(3);

static CLIENT: OnceLock<RustyPipe> = OnceLock::new();
static DIR: std::sync::Mutex<Option<std::path::PathBuf>> = std::sync::Mutex::new(None);

/// Where rustypipe keeps its cache (player code, visitor data). Set at startup.
pub fn init(cache_dir: &std::path::Path) {
    *DIR.locked() = Some(cache_dir.join("rustypipe"));
}

fn client() -> AppResult<&'static RustyPipe> {
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    let dir = DIR.locked().clone().unwrap_or_else(|| std::env::temp_dir().join("tunewire-rustypipe"));
    let _ = std::fs::create_dir_all(&dir);
    let c = RustyPipe::builder()
        .storage_dir(dir)
        .timeout(Duration::from_secs(8))
        .n_http_retries(1)
        .build()
        .map_err(|e| AppError::Extraction(format!("YouTube client: {e}")))?;
    Ok(CLIENT.get_or_init(|| c))
}

/// The 11-character video id of a YouTube / YouTube Music link.
pub fn video_id(url: &str) -> Option<String> {
    let id = if let Some(rest) = url.split_once("youtu.be/").map(|(_, r)| r) {
        rest.split(['?', '&', '#', '/']).next()?
    } else if url.contains("youtube.com/") {
        let q = url.split_once('?')?.1;
        q.split('&').find_map(|kv| kv.strip_prefix("v="))?.split('#').next()?
    } else {
        return None;
    };
    (id.len() == 11 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).then(|| id.to_string())
}

/// Same order as `ytdlp::AUDIO_FORMAT`: AAC-LC, then Opus. Never HE-AAC
/// (mp4a.40.5 / .29): symphonia plays only its low band (muffled, "bass
/// boosted"). Original audio only (no dubbed tracks), no DRM.
fn pick(streams: &[AudioStream]) -> Option<&AudioStream> {
    let usable = |s: &&AudioStream| s.drm_track_type.is_none() && s.track.as_ref().is_none_or(|t| t.is_default) && !s.url.is_empty();
    let aac_lc = |s: &&AudioStream| s.codec == AudioCodec::Mp4a && s.mime.contains("mp4a.40.2");
    let opus = |s: &&AudioStream| s.codec == AudioCodec::Opus;
    streams
        .iter()
        .filter(usable)
        .filter(aac_lc)
        .max_by_key(|s| s.bitrate)
        .or_else(|| streams.iter().filter(usable).filter(opus).max_by_key(|s| s.bitrate))
}

/// Failures in a row; after FAIL_LIMIT the native path rests for REST.
static FAILS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
static RESTING_UNTIL: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);
const FAIL_LIMIT: u32 = 3;
const REST: Duration = Duration::from_secs(10 * 60);

/// Whether to try the native path now (not after repeated failures).
pub fn usable() -> bool {
    RESTING_UNTIL.locked().is_none_or(|t| std::time::Instant::now() >= t)
}

/// `stream`, keeping count of failures (so a broken path is skipped for a while).
pub async fn stream_tracked(url: &str) -> AppResult<StreamInfo> {
    use std::sync::atomic::Ordering;
    let r = stream(url).await;
    match &r {
        Ok(_) => FAILS.store(0, Ordering::SeqCst),
        Err(AppError::Invalid(_) | AppError::Unsupported(_)) => {}
        Err(_) => {
            if FAILS.fetch_add(1, Ordering::SeqCst) + 1 >= FAIL_LIMIT {
                FAILS.store(0, Ordering::SeqCst);
                *RESTING_UNTIL.locked() = Some(std::time::Instant::now() + REST);
            }
        }
    }
    r
}

/// The playable audio of a YouTube / YouTube Music link.
pub async fn stream(url: &str) -> AppResult<StreamInfo> {
    let id = video_id(url).ok_or_else(|| AppError::Invalid("not a YouTube video link".into()))?;
    let rp = client()?;
    let player = tokio::time::timeout(TIMEOUT, rp.query().player(&id))
        .await
        .map_err(|_| AppError::Timeout("YouTube took too long".into()))?
        .map_err(|e| AppError::Extraction(e.to_string()))?;
    if player.details.is_live {
        return Err(AppError::Unsupported("live streams go through yt-dlp".into()));
    }
    let s = pick(&player.audio_streams).ok_or_else(|| AppError::Extraction("no suitable audio format".into()))?;
    // `pick` only returns AAC-LC (in MP4) or Opus (in WebM).
    let (ext, acodec) = if s.codec == AudioCodec::Mp4a || s.format == AudioFormat::M4a { ("m4a", "mp4a.40.2") } else { ("webm", "opus") };
    let thumbnail = player.details.thumbnail.iter().max_by_key(|t| t.width).map(|t| t.url.clone());
    Ok(StreamInfo {
        url: s.url.clone(),
        ext: Some(ext.into()),
        acodec: Some(acodec.into()),
        protocol: Some("https".into()),
        duration: s.duration_ms.map(|ms| f64::from(ms) / 1000.0).or(Some(f64::from(player.details.duration))),
        title: player.details.name.clone(),
        // The channel ("Artist - Topic" on YouTube Music) is cleaned like
        // yt-dlp's uploader.
        artist: player.details.channel_name.clone(),
        thumbnail,
        filesize: (s.size > 0).then_some(s.size),
        headers: HashMap::new(),
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn video_ids() {
        assert_eq!(super::video_id("https://music.youtube.com/watch?v=4NRXx6U8ABQ&si=x").as_deref(), Some("4NRXx6U8ABQ"));
        assert_eq!(super::video_id("https://www.youtube.com/watch?feature=x&v=kJQP7kiw5Fk#t=3").as_deref(), Some("kJQP7kiw5Fk"));
        assert_eq!(super::video_id("https://youtu.be/JGwWNGJdvx8?t=10").as_deref(), Some("JGwWNGJdvx8"));
        assert_eq!(super::video_id("https://soundcloud.com/x/y"), None);
        assert_eq!(super::video_id("https://www.youtube.com/watch?v=short"), None);
    }

    #[test]
    #[ignore]
    fn live_native_stream() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let info = rt.block_on(super::stream("https://music.youtube.com/watch?v=4NRXx6U8ABQ")).expect("stream");
        println!("{:?} {:?} {:?}s", info.acodec, info.title, info.duration);
        assert!(info.url.starts_with("https://"));
    }
}
