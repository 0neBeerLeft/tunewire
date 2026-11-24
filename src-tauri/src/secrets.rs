//! Secrets in the OS keychain (Secret Service on Linux, Credential Manager on
//! Windows, Keychain on macOS) instead of settings.json. Android has no such
//! keychain for apps like this: there they live in a file in the app's
//! private data folder, which only Tunewire can read.

use crate::error::{AppError, AppResult};

const SERVICE: &str = "app.tunewire.player";

#[cfg(desktop)]
fn entry(name: &str) -> AppResult<keyring::Entry> {
    keyring::Entry::new(SERVICE, name).map_err(|e| AppError::Storage(format!("keychain unavailable: {e}")))
}

pub fn get(name: &str) -> Option<String> {
    #[cfg(test)]
    return fake::get(name);
    #[cfg(mobile)]
    return file_store::get(name);
    #[allow(unreachable_code)]
    #[cfg(desktop)]
    return entry(name).ok()?.get_password().ok().filter(|s| !s.is_empty());
}

pub fn set(name: &str, value: &str) -> AppResult<()> {
    #[cfg(test)]
    return fake::set(name, value);
    #[cfg(mobile)]
    return file_store::set(name, value);
    #[allow(unreachable_code)]
    #[cfg(desktop)]
    return set_keychain(name, value);
}

#[cfg(desktop)]
fn set_keychain(name: &str, value: &str) -> AppResult<()> {
    let e = entry(name)?;
    if value.is_empty() {
        match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(AppError::Storage(format!("keychain: {err}"))),
        }
    } else {
        e.set_password(value).map_err(|err| AppError::Storage(format!("could not save to the system keychain: {err}")))
    }
}

pub const SPOTIFY_SECRET: &str = "spotify_client_secret";

/// Where secrets are kept on Android (set once at startup).
pub fn set_dir(_dir: &std::path::Path) {
    #[cfg(mobile)]
    file_store::set_dir(_dir);
}

/// Android: one JSON file in the app's private data folder.
#[cfg(mobile)]
mod file_store {
    use crate::error::{AppError, AppResult};
    use crate::sync_ext::LockExt;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::Mutex;

    static PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

    pub fn set_dir(dir: &std::path::Path) {
        *PATH.locked() = Some(dir.join("secrets.json"));
    }

    fn load(path: &PathBuf) -> HashMap<String, String> {
        std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    pub fn get(name: &str) -> Option<String> {
        let path = PATH.locked().clone()?;
        load(&path).remove(name).filter(|s| !s.is_empty())
    }

    pub fn set(name: &str, value: &str) -> AppResult<()> {
        let guard = PATH.locked();
        let path = guard.as_ref().ok_or_else(|| AppError::Storage("secrets not ready".into()))?;
        let mut all = load(path);
        if value.is_empty() {
            all.remove(name);
        } else {
            all.insert(name.into(), value.into());
        }
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec(&all).unwrap_or_default()).map_err(|e| AppError::Storage(e.to_string()))?;
        std::fs::rename(&tmp, path).map_err(|e| AppError::Storage(e.to_string()))
    }
}

/// Tests never touch the real keychain: an in-memory one that can be made
/// to fail like a locked or missing keychain.
#[cfg(test)]
pub mod fake {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    use crate::sync_ext::LockExt;

    static STORE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
    pub static BROKEN: AtomicBool = AtomicBool::new(false);

    pub fn get(name: &str) -> Option<String> {
        if BROKEN.load(Ordering::SeqCst) {
            return None;
        }
        STORE.locked().as_ref()?.get(name).cloned().filter(|s| !s.is_empty())
    }

    pub fn set(name: &str, value: &str) -> crate::error::AppResult<()> {
        if BROKEN.load(Ordering::SeqCst) {
            return Err(crate::error::AppError::Storage("keychain locked".into()));
        }
        STORE.locked().get_or_insert_with(HashMap::new).insert(name.into(), value.into());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore]
    fn keychain_roundtrip() {
        // The real keychain (get/set use an in-memory one in tests).
        let e = super::entry("selftest").expect("keychain");
        e.set_password("s3cr3t").expect("set");
        assert_eq!(e.get_password().ok().as_deref(), Some("s3cr3t"));
        e.delete_credential().expect("delete");
        assert!(e.get_password().is_err());
    }
}
