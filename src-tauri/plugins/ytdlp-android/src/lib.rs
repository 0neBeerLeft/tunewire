//! yt-dlp on Android. Desktop runs yt-dlp as a program; Android can't, so
//! this plugin runs it through youtubedl-android (Python and yt-dlp bundled
//! in the APK, updated on the phone). Same arguments, same JSON out.
use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::Runtime;

/// What one yt-dlp run printed, and how it ended.
#[derive(Debug, Clone, Deserialize)]
pub struct Output {
    pub code: i32,
    #[serde(default)]
    pub stdout: String,
    #[serde(default)]
    pub stderr: String,
}

#[derive(Serialize)]
struct ExecuteArgs<'a> {
    args: &'a [String],
}

/// Handle to the Android side (managed state of the app).
pub struct Ytdlp<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Clone for Ytdlp<R> {
    fn clone(&self) -> Self {
        Ytdlp(self.0.clone())
    }
}

impl<R: Runtime> Ytdlp<R> {
    /// Run yt-dlp with these arguments (blocking; call from a worker thread).
    pub fn execute(&self, args: &[String]) -> Result<Output, String> {
        self.0.run_mobile_plugin::<Output>("execute", ExecuteArgs { args }).map_err(|e| e.to_string())
    }

    /// yt-dlp's version on the phone ("" before it's ready).
    pub fn version(&self) -> String {
        #[derive(Deserialize)]
        struct V {
            #[serde(default)]
            version: String,
        }
        self.0.run_mobile_plugin::<V>("version", ()).map(|v| v.version).unwrap_or_default()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ytdlp-android")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin("app.tunewire.ytdlp", "YtdlpPlugin")?;
                _app.manage(Ytdlp(handle));
            }
            Ok(())
        })
        .build()
}
