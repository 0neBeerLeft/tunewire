//! Locks that survive a panic elsewhere.
//!
//! Release builds unwind on panic (see Cargo.toml), so a bug in one background
//! thread ends that thread instead of the whole app. A thread that panicked
//! while holding a `Mutex` poisons it, though, and `lock().unwrap()` would
//! then take every later user down with it. The data behind our locks is
//! always left consistent between statements, so the poison flag is ignored.

use std::sync::{Mutex, MutexGuard, PoisonError};

pub trait LockExt<T: ?Sized> {
    /// `lock()` that ignores poisoning.
    fn locked(&self) -> MutexGuard<'_, T>;
}

impl<T: ?Sized> LockExt<T> for Mutex<T> {
    #[inline]
    fn locked(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
