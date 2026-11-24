//! Source health: remembers which platforms keep failing (YouTube blocking,
//! SoundCloud rotating keys, Spotify down) so the app stops waiting on them.
//!
//! Three failures in a row mark a source as down for a while: searches skip
//! it (or give it only a moment) and playback tries its other versions first.
//! Every so often one request is let through to see whether it's back; a
//! single success clears the record. "No results" is not a failure.

use crate::models::Platform;
use crate::sync_ext::LockExt;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Failures in a row before a source counts as down.
const DOWN_AFTER: u32 = 3;
/// How long a source stays down after its last failure.
const DOWN_FOR: Duration = Duration::from_secs(120);
/// While down, one request is let through this often to check on it.
const PROBE_EVERY: Duration = Duration::from_secs(30);

#[derive(Default, Clone, Copy)]
struct State {
    fails: u32,
    last_fail: Option<Instant>,
    last_probe: Option<Instant>,
}

static HEALTH: Mutex<Option<HashMap<Platform, State>>> = Mutex::new(None);

fn with<T>(p: Platform, f: impl FnOnce(&mut State) -> T) -> T {
    let mut g = HEALTH.locked();
    f(g.get_or_insert_with(HashMap::new).entry(p).or_default())
}

/// The source answered (with or without results).
pub fn ok(p: Platform) {
    with(p, |s| *s = State::default());
}

/// The source failed (network, timeout, blocked, broken extractor).
pub fn failed(p: Platform) {
    with(p, |s| {
        s.fails = s.fails.saturating_add(1);
        s.last_fail = Some(Instant::now());
    });
}

/// Record a result: errors that mean "nothing found" don't count.
pub fn record<T>(p: Platform, r: &crate::error::AppResult<T>) {
    match r {
        Ok(_) | Err(crate::error::AppError::EmptyResults | crate::error::AppError::Cancelled | crate::error::AppError::Invalid(_)) => ok(p),
        Err(_) => failed(p),
    }
}

/// Whether to avoid this source right now. While it's down, one caller every
/// PROBE_EVERY gets `false` so the source can show it's back.
pub fn is_down(p: Platform) -> bool {
    with(p, |s| {
        let down = s.fails >= DOWN_AFTER && s.last_fail.is_some_and(|t| t.elapsed() < DOWN_FOR);
        if !down {
            return false;
        }
        if s.last_probe.is_none_or(|t| t.elapsed() >= PROBE_EVERY) {
            s.last_probe = Some(Instant::now());
            return false;
        }
        true
    })
}

/// Down right now, without using up a probe (for ordering, not gating).
pub fn looks_down(p: Platform) -> bool {
    with(p, |s| s.fails >= DOWN_AFTER && s.last_fail.is_some_and(|t| t.elapsed() < DOWN_FOR))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn down_after_three_failures_and_back_after_success() {
        let p = Platform::Soundcloud;
        ok(p);
        failed(p);
        failed(p);
        assert!(!looks_down(p));
        failed(p);
        assert!(looks_down(p));
        // First check is a probe (let through), the next is skipped.
        assert!(!is_down(p));
        assert!(is_down(p));
        ok(p);
        assert!(!looks_down(p) && !is_down(p));
    }

    #[test]
    fn no_results_is_not_a_failure() {
        let p = Platform::Youtube;
        ok(p);
        for _ in 0..5 {
            record::<()>(p, &Err(crate::error::AppError::EmptyResults));
        }
        assert!(!looks_down(p));
    }
}
