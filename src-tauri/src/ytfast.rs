//! YouTube songs without starting yt-dlp.
//!
//! A song's audio link takes two requests: YouTube's player API (as the
//! visionOS app, which gets the HLS audio, format 234, without the
//! JavaScript solver) and the HLS manifest that lists the audio playlist.
//! Done here over the app's open connections that's ~0.25 s; yt-dlp needs
//! 2.5-3 s for the same (Python startup, the watch page, new connections).
//! Anything unexpected returns an error and the caller asks yt-dlp, which
//! knows every other case (age checks, other clients, sign-in prompts).

use std::collections::HashMap;

use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::ytdlp::StreamInfo;

/// The visionOS client, as yt-dlp sends it (extractor/youtube/_base.py).
const CLIENT_NAME: &str = "VISIONOS";
const CLIENT_ID: &str = "101";
const CLIENT_VERSION: &str = "1.02";
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

/// The 11-character video id of a YouTube / YouTube Music link.
pub fn video_id(url: &str) -> Option<String> {
    let ok = |id: &str| (id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')).then(|| id.to_string());
    let (_, rest) = url.split_once("://")?;
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let host = host.to_ascii_lowercase();
    if host == "youtu.be" || host.ends_with(".youtu.be") {
        return ok(path.split(['?', '#', '/']).next()?);
    }
    if !(host == "youtube.com" || host.ends_with(".youtube.com")) {
        return None;
    }
    if let Some(id) = path.strip_prefix("shorts/").or_else(|| path.strip_prefix("embed/")).or_else(|| path.strip_prefix("live/")) {
        return ok(id.split(['?', '#', '/']).next()?);
    }
    let query = path.strip_prefix("watch")?.split_once('?')?.1.split('#').next()?;
    query.split('&').find_map(|kv| kv.strip_prefix("v=")).and_then(ok)
}

fn player(id: &str, visitor: &str) -> AppResult<Value> {
    // A kept-open connection the server has since closed fails at once: one more try.
    player_once(id, visitor).or_else(|e| if matches!(e, AppError::Network(_)) { player_once(id, visitor) } else { Err(e) })
}

fn player_once(id: &str, visitor: &str) -> AppResult<Value> {
    let body = serde_json::json!({
        "context": { "client": {
            "clientName": CLIENT_NAME, "clientVersion": CLIENT_VERSION, "deviceMake": "Apple", "deviceModel": "RealityDevice17,1",
            "userAgent": UA, "osName": "visionOS", "osVersion": "26.5.23O471", "hl": "en", "timeZone": "UTC", "utcOffsetMinutes": 0,
        } },
        "videoId": id,
        "playbackContext": { "contentPlaybackContext": { "html5Preference": "HTML5_PREF_WANTS" } },
        "contentCheckOk": true,
        "racyCheckOk": true,
    });
    let mut resp = crate::http::agent()
        .post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
        .header("Content-Type", "application/json")
        .header("X-Youtube-Client-Name", CLIENT_ID)
        .header("X-Youtube-Client-Version", CLIENT_VERSION)
        .header("Origin", "https://www.youtube.com")
        .header("X-Goog-Visitor-Id", visitor)
        .header("User-Agent", UA)
        .send(body.to_string())
        .map_err(|e| AppError::Network(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(AppError::Extraction(format!("YouTube player: HTTP {}", resp.status().as_u16())));
    }
    let text = resp.body_mut().with_config().limit(8 * 1024 * 1024).read_to_string().map_err(|e| AppError::Network(e.to_string()))?;
    serde_json::from_str(&text).map_err(|e| AppError::Extraction(format!("YouTube player: {e}")))
}

/// The audio playlist of format 234 from an HLS master manifest.
fn audio_playlist(master: &str) -> Option<String> {
    master.lines().filter(|l| l.starts_with("#EXT-X-MEDIA") && l.contains("TYPE=AUDIO")).find_map(|l| {
        let uri = l.split("URI=\"").nth(1)?.split('"').next()?;
        uri.contains("/itag/234/").then(|| uri.to_string())
    })
}

/// Open a connection to the server the audio segments come from (named in
/// the playlist link) while playback reads the playlist, so the first
/// segment doesn't wait for a handshake.
fn preconnect(playlist: &str) {
    let Some(host) = playlist.split("/hls_chunk_host/").nth(1).and_then(|h| h.split('/').next()) else {
        return;
    };
    if !host.ends_with(".googlevideo.com") || !host.bytes().all(|b| b.is_ascii_alphanumeric() || b"-.".contains(&b)) {
        return;
    }
    let url = format!("https://{host}/generate_204");
    std::thread::spawn(move || {
        if let Ok(resp) = crate::http::stream_agent().get(&url).header("User-Agent", UA).call() {
            let _ = resp.into_body().read_to_vec();
        }
    });
}

/// "Artist - Topic" / "ArtistVEVO" channel names → the artist.
fn artist_name(author: &str) -> String {
    let a = author.strip_suffix(" - Topic").unwrap_or(author);
    let a = a.strip_suffix("VEVO").filter(|s| !s.is_empty()).unwrap_or(a);
    a.trim().to_string()
}

/// The song's HLS audio (AAC-LC, ~130 kb/s). Blocking: two requests.
pub fn stream(id: &str, visitor: &str) -> AppResult<StreamInfo> {
    let pr = player(id, visitor)?;
    let status = pr.pointer("/playabilityStatus/status").and_then(Value::as_str).unwrap_or("");
    if status != "OK" {
        let reason = pr.pointer("/playabilityStatus/reason").and_then(Value::as_str).unwrap_or(status);
        return Err(AppError::Extraction(format!("YouTube: {reason}")));
    }
    let manifest = pr.pointer("/streamingData/hlsManifestUrl").and_then(Value::as_str).ok_or_else(|| AppError::Extraction("no HLS manifest".into()))?;
    crate::ytdlp::validate_url(manifest)?;
    // The stream client: playback then fetches the audio playlist from this
    // same server over this connection.
    let get = || crate::http::stream_agent().get(manifest).header("User-Agent", UA).call();
    let mut resp = get().or_else(|_| get()).map_err(|e| AppError::Network(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(AppError::Extraction(format!("HLS manifest: HTTP {}", resp.status().as_u16())));
    }
    let master = resp.body_mut().with_config().limit(4 * 1024 * 1024).read_to_string().map_err(|e| AppError::Network(e.to_string()))?;
    let url = audio_playlist(&master).ok_or_else(|| AppError::Extraction("no HLS audio (234)".into()))?;
    crate::ytdlp::validate_url(&url)?;
    preconnect(&url);

    let d = |p: &str| pr.pointer(p).and_then(Value::as_str).map(str::to_string);
    let thumbnail = pr.pointer("/videoDetails/thumbnail/thumbnails").and_then(Value::as_array).and_then(|t| t.last()).and_then(|t| t.get("url")).and_then(Value::as_str).map(str::to_string);
    Ok(StreamInfo {
        url,
        ext: Some("aac".into()), // packed audio: AAC frames (ADTS), not an MP4 file
        acodec: Some("mp4a.40.2".into()),
        protocol: Some("m3u8_native".into()),
        duration: d("/videoDetails/lengthSeconds").and_then(|s| s.parse().ok()),
        title: d("/videoDetails/title"),
        artist: d("/videoDetails/author").map(|a| artist_name(&a)),
        thumbnail,
        filesize: None,
        headers: HashMap::from([("User-Agent".to_string(), UA.to_string())]),
        refresh: Default::default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids() {
        assert_eq!(video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(video_id("https://music.youtube.com/watch?list=x&v=dQw4w9WgXcQ&t=3").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(video_id("https://youtu.be/dQw4w9WgXcQ?si=abc").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(video_id("https://www.youtube.com/playlist?list=PL123"), None);
        assert_eq!(video_id("https://notyoutube.com/watch?v=dQw4w9WgXcQ"), None);
        assert_eq!(video_id("https://www.youtube.com/watch?v=short"), None);
    }

    #[test]
    fn manifest() {
        let m = "#EXTM3U\n#EXT-X-MEDIA:URI=\"https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/233/x/index.m3u8\",TYPE=AUDIO,GROUP-ID=\"233\"\n#EXT-X-MEDIA:URI=\"https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/234/x/index.m3u8\",TYPE=AUDIO,GROUP-ID=\"234\"\n";
        assert_eq!(audio_playlist(m).as_deref(), Some("https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/234/x/index.m3u8"));
        assert_eq!(audio_playlist("#EXTM3U\n"), None);
    }

    #[test]
    fn artists() {
        assert_eq!(artist_name("Daft Punk - Topic"), "Daft Punk");
        assert_eq!(artist_name("DaftPunkVEVO"), "DaftPunk");
        assert_eq!(artist_name("VEVO"), "VEVO");
    }
}
