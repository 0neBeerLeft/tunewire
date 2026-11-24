//! Android playback service: keeps Tunewire playing with the screen off (a
//! foreground media service), and shows the song with previous / play-pause /
//! next on the notification, the lock screen and headset buttons. Button
//! presses arrive in the app as the `action` plugin event.
use serde::Serialize;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::Runtime;

/// What the notification shows.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub artwork: Option<String>,
    /// "playing", "paused" or "stopped" (stopped ends the service).
    pub status: String,
    pub position_ms: u64,
    pub duration_ms: u64,
}

pub struct Media<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Clone for Media<R> {
    fn clone(&self) -> Self {
        Media(self.0.clone())
    }
}

#[derive(Serialize)]
struct Url<'a> {
    url: &'a str,
}

impl<R: Runtime> Media<R> {
    /// Show (or update, or end) the playback notification. Blocking.
    pub fn update(&self, np: &NowPlaying) -> Result<(), String> {
        self.0.run_mobile_plugin::<serde_json::Value>("update", np).map(|_| ()).map_err(|e| e.to_string())
    }

    /// Open a link in the browser (or the APK installer). Blocking.
    pub fn open_url(&self, url: &str) -> Result<(), String> {
        self.0.run_mobile_plugin::<serde_json::Value>("openUrl", Url { url }).map(|_| ()).map_err(|e| e.to_string())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("media-android")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin("app.tunewire.media", "MediaPlugin")?;
                _app.manage(Media(handle));
            }
            Ok(())
        })
        .build()
}
