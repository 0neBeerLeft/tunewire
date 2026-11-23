//! Live spectrum of what's playing, for the equalizer's analyzer display.
//!
//! The engine's FeedSource hands every processed chunk (after the EQ and the
//! limiter: what you hear) to `push`, which keeps the latest few thousand
//! samples, mixed to mono. Nothing is kept unless the equalizer is on screen
//! (`set_enabled`), and the audio thread never waits for the lock: a frame
//! the display misses doesn't matter, a glitch in the audio would.
//! `spectrum` windows the newest 2048 samples, runs an FFT and reduces it to
//! log-spaced bands in dBFS.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const N: usize = 2048;
/// Older audio than this (paused, stopped): no spectrum.
const STALE: Duration = Duration::from_millis(250);
pub const FLOOR_DB: f32 = -90.0;
pub const MIN_HZ: f32 = 20.0;
pub const MAX_HZ: f32 = 20_000.0;

static ENABLED: AtomicBool = AtomicBool::new(false);

struct Ring {
    buf: Vec<f32>,
    pos: usize,
    filled: bool,
    rate: u32,
    at: Option<Instant>,
}

static RING: Mutex<Ring> = Mutex::new(Ring { buf: Vec::new(), pos: 0, filled: false, rate: 44_100, at: None });

pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
}

/// Called from the audio thread with interleaved samples.
#[inline]
pub fn push(samples: &[f32], channels: usize, rate: u32) {
    if !ENABLED.load(Ordering::Relaxed) || channels == 0 {
        return;
    }
    let Ok(mut r) = RING.try_lock() else { return };
    if r.buf.len() != N {
        r.buf = vec![0.0; N];
        r.pos = 0;
        r.filled = false;
    }
    for f in samples.chunks_exact(channels) {
        let m = f.iter().sum::<f32>() / channels as f32;
        let p = r.pos;
        r.buf[p] = m;
        r.pos = (p + 1) % N;
        if r.pos == 0 {
            r.filled = true;
        }
    }
    r.rate = rate;
    r.at = Some(Instant::now());
}

/// `bands` log-spaced levels (dBFS, FLOOR_DB..0) from MIN_HZ to MAX_HZ, or
/// empty when nothing is playing.
pub fn spectrum(bands: usize) -> Vec<f32> {
    let (frame, rate) = {
        let r = RING.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if !r.filled || r.at.is_none_or(|t| t.elapsed() > STALE) {
            return Vec::new();
        }
        // Oldest to newest.
        let mut f = Vec::with_capacity(N);
        f.extend_from_slice(&r.buf[r.pos..]);
        f.extend_from_slice(&r.buf[..r.pos]);
        (f, r.rate)
    };
    analyze(&frame, rate, bands)
}

fn analyze(frame: &[f32], rate: u32, bands: usize) -> Vec<f32> {
    let n = frame.len();
    // Hann window; its coherent gain (0.5) is undone below.
    let mut re: Vec<f32> = frame.iter().enumerate().map(|(i, x)| x * (0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / n as f32).cos())).collect();
    let mut im = vec![0.0f32; n];
    fft(&mut re, &mut im);
    let half = n / 2;
    // Amplitude of a full-scale sine = 1.0 → 0 dBFS.
    let mags: Vec<f32> = (0..half).map(|k| (re[k] * re[k] + im[k] * im[k]).sqrt() * 4.0 / n as f32).collect();
    let bin_hz = rate as f32 / n as f32;
    let top = MAX_HZ.min(rate as f32 / 2.0);
    let ratio = (top / MIN_HZ).ln();
    (0..bands)
        .map(|b| {
            let lo = MIN_HZ * (ratio * b as f32 / bands as f32).exp();
            let hi = MIN_HZ * (ratio * (b + 1) as f32 / bands as f32).exp();
            // Narrower than a bin (bass): interpolate at the band's centre.
            let (k0, k1) = ((lo / bin_hz).floor() as usize, (hi / bin_hz).ceil() as usize);
            let peak = if k1 <= k0 + 1 {
                let c = ((lo * hi).sqrt() / bin_hz).min(half as f32 - 1.0);
                let (i, t) = (c.floor() as usize, c.fract());
                mags[i] * (1.0 - t) + mags[(i + 1).min(half - 1)] * t
            } else {
                mags[k0.min(half - 1)..k1.min(half)].iter().copied().fold(0.0, f32::max)
            };
            (20.0 * peak.max(1e-9).log10()).clamp(FLOOR_DB, 0.0)
        })
        .collect()
}

/// In-place radix-2 FFT (length a power of two).
fn fft(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -std::f32::consts::TAU / len as f32;
        let (wr, wi) = (ang.cos(), ang.sin());
        for start in (0..n).step_by(len) {
            let (mut cr, mut ci) = (1.0f32, 0.0f32);
            for k in 0..len / 2 {
                let (a, b) = (start + k, start + k + len / 2);
                let (tr, ti) = (re[b] * cr - im[b] * ci, re[b] * ci + im[b] * cr);
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                let ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = ncr;
            }
        }
        len <<= 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, amp: f32, rate: u32) -> Vec<f32> {
        (0..N).map(|i| amp * (std::f32::consts::TAU * freq * i as f32 / rate as f32).sin()).collect()
    }

    fn band_of(freq: f32, bands: usize, rate: u32) -> usize {
        let top = MAX_HZ.min(rate as f32 / 2.0);
        ((freq / MIN_HZ).ln() / (top / MIN_HZ).ln() * bands as f32) as usize
    }

    #[test]
    fn a_sine_peaks_in_its_band_at_its_level() {
        let rate = 44_100;
        for (freq, amp) in [(1000.0, 0.5), (100.0, 1.0), (8000.0, 0.1)] {
            let s = analyze(&sine(freq, amp, rate), rate, 96);
            let (peak_band, peak) = s.iter().enumerate().fold((0, FLOOR_DB), |m, (i, v)| if *v > m.1 { (i, *v) } else { m });
            assert!((peak_band as i64 - band_of(freq, 96, rate) as i64).abs() <= 1, "{freq} Hz peaked in band {peak_band}");
            let want = 20.0 * amp.log10();
            assert!((peak - want).abs() < 1.5, "{freq} Hz: {peak} dB, want {want}");
        }
    }

    #[test]
    fn silence_is_the_floor_and_nothing_without_audio() {
        let s = analyze(&vec![0.0; N], 44_100, 48);
        assert!(s.iter().all(|v| *v == FLOOR_DB));
        set_enabled(false);
        push(&[0.5; 64], 2, 44_100); // ignored while off
        assert!(spectrum(48).is_empty());
    }
}
