//! System media controls (media keys, the OS "now playing" overlay).
//! Desktop: souvlaki (media_desktop.rs). Android: the media-android plugin's
//! foreground service (notification, lock screen, headset buttons), which
//! also keeps playback going with the screen off.

#[cfg(desktop)]
#[path = "media_desktop.rs"]
mod imp;
#[cfg(desktop)]
pub use imp::*;

#[cfg(mobile)]
mod imp {
    use crate::state::{AppState, PlaybackState};
    use crate::sync_ext::LockExt;
    use std::sync::Mutex;
    use tauri::{AppHandle, Manager};

    #[cfg(target_os = "android")]
    type Np = tauri_plugin_media_android::NowPlaying;
    #[cfg(not(target_os = "android"))]
    #[derive(Clone, Default, PartialEq)]
    struct Np {
        title: String,
        artist: String,
        album: String,
        artwork: Option<String>,
        status: String,
        position_ms: u64,
        duration_ms: u64,
    }

    #[cfg(target_os = "android")]
    static HANDLE: std::sync::OnceLock<tauri_plugin_media_android::Media<tauri::Wry>> = std::sync::OnceLock::new();
    static LAST: Mutex<Option<Np>> = Mutex::new(None);

    pub fn init(app: &tauri::App) {
        #[cfg(target_os = "android")]
        if let Some(m) = app.try_state::<tauri_plugin_media_android::Media<tauri::Wry>>() {
            let _ = HANDLE.set(m.inner().clone());
        }
        let _ = app;
    }

    fn describe(ps: &PlaybackState) -> Np {
        let Some(item) = ps.current.as_ref() else {
            return Np { status: "stopped".into(), ..Default::default() };
        };
        let v = ps.version.as_ref();
        let artwork = v
            .and_then(|v| v.thumbnail.clone())
            .or(item.track.thumbnail.clone())
            .filter(|u| u.starts_with("https://"))
            .map(|u| u.replace("-original.", "-t500x500.").replace("/mqdefault.jpg", "/hqdefault.jpg"));
        Np {
            title: item.track.title.clone(),
            artist: item.track.artist.clone(),
            album: v.and_then(|v| v.album.clone()).unwrap_or_default(),
            artwork,
            status: if ps.status == "playing" { "playing" } else { "paused" }.into(),
            position_ms: (ps.position.max(0.0) * 1000.0) as u64,
            duration_ms: (ps.duration.or(item.track.duration).unwrap_or(0.0).max(0.0) * 1000.0) as u64,
        }
    }

    fn send(np: Np, force: bool) {
        {
            let mut last = LAST.locked();
            // Only when something besides the steadily moving clock changed.
            let same = last.as_ref().is_some_and(|l| {
                l.title == np.title && l.artist == np.artist && l.status == np.status && l.artwork == np.artwork && l.duration_ms == np.duration_ms && l.position_ms.abs_diff(np.position_ms) < 15_000
            });
            if same && !force {
                return;
            }
            *last = Some(np.clone());
        }
        #[cfg(target_os = "android")]
        if let Some(h) = HANDLE.get().cloned() {
            tauri::async_runtime::spawn_blocking(move || {
                let _ = h.update(&np);
            });
        }
        #[cfg(not(target_os = "android"))]
        let _ = np;
    }

    pub fn update(_app: &AppHandle, ps: &PlaybackState) {
        send(describe(ps), false);
    }

    pub fn position_changed(app: &AppHandle) {
        if let Some(st) = app.try_state::<AppState>() {
            send(describe(&st.playback_state()), true);
        }
    }

    /// Open a web link in the browser (Android: through the plugin).
    pub fn open_url(url: &str) -> Result<(), String> {
        #[cfg(target_os = "android")]
        return HANDLE.get().ok_or_else(|| "not ready".to_string())?.open_url(url);
        #[cfg(not(target_os = "android"))]
        {
            let _ = url;
            Err("opening links isn't supported here".into())
        }
    }
}
#[cfg(mobile)]
pub use imp::*;

/// Open a web link in the default browser.
#[cfg(desktop)]
pub fn open_url(url: &str) -> Result<(), String> {
    open::that_detached(url).map_err(|e| e.to_string())
}
