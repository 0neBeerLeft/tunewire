//! System media controls (media keys, the OS "now playing" overlay).
//! Desktop: souvlaki (media_desktop.rs). Android: not yet (no-ops).

#[cfg(desktop)]
#[path = "media_desktop.rs"]
mod imp;
#[cfg(desktop)]
pub use imp::*;

#[cfg(mobile)]
mod imp {
    use crate::state::PlaybackState;
    use tauri::AppHandle;
    pub fn init(_app: &tauri::App) {}
    pub fn update(_app: &AppHandle, _ps: &PlaybackState) {}
    pub fn position_changed(_app: &AppHandle) {}
}
#[cfg(mobile)]
pub use imp::*;
