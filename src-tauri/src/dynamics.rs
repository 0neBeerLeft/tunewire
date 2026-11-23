//! Loudness measurement (for normalization) and the output peak limiter.
//!
//! Loudness is measured like EBU R128 / ReplayGain 2, without the K-weighting:
//! the mean power of 400 ms blocks, gated twice: blocks below -50 dBFS are
//! silence, and blocks more than 10 dB below the loud part are left out. A
//! quiet intro therefore never counts as "this song is quiet". The previous
//! approach (the ungated average of the first 15 s, then frozen) turned songs
//! with a long quiet intro up by +8 dB for their whole length, straight into a
//! clipper, which users heard as heavy "bass boosted" distortion.
//!
//! The limiter replaces a per-sample soft clipper. It looks 5 ms ahead and
//! lowers the gain smoothly before a peak arrives, so loud bass is turned
//! down instead of being squared off.

use std::collections::VecDeque;

/// Loudness target (RMS of the gated loud part), about -18 dBFS.
pub const TARGET_RMS: f32 = 0.125;
/// Most a song is ever turned up: +3 dB.
pub const MAX_BOOST: f32 = 1.413;
/// Most a song is ever turned down: -12 dB.
pub const MAX_CUT: f32 = 0.25;
/// A song is only turned up once this much of its loud part has been heard.
const BOOST_AFTER_SECS: f32 = 10.0;
const BLOCK_SECS: f32 = 0.4;
/// -50 dBFS (power): quieter blocks are silence.
const ABS_GATE: f64 = 1e-5;
/// -10 dB relative to the ungated loud part.
const REL_GATE: f64 = 0.1;

/// Running gated loudness of one track. Fed by the decode thread, which runs
/// up to a few seconds ahead of playback, so the gain usually changes before
/// a loud part is heard.
pub struct Loudness {
    channels: usize,
    block_frames: usize,
    acc: f64,
    n: usize,
    blocks: Vec<f64>,
    gain: f32,
}

impl Loudness {
    pub fn new(rate: u32, channels: u16) -> Self {
        let block_frames = ((rate as f32 * BLOCK_SECS) as usize).max(1);
        Loudness { channels: channels.max(1) as usize, block_frames, acc: 0.0, n: 0, blocks: Vec::new(), gain: 1.0 }
    }

    /// The gain to apply now (1.0 until something was measured).
    pub fn gain(&self) -> f32 {
        self.gain
    }

    /// Feed interleaved samples. Returns true when the gain changed.
    pub fn feed(&mut self, samples: &[f32]) -> bool {
        let ch = self.channels;
        let before = self.gain;
        let had_blocks = self.blocks.len();
        for f in samples.chunks_exact(ch) {
            let p: f32 = f.iter().map(|x| x * x).sum::<f32>() / ch as f32;
            self.acc += p as f64;
            self.n += 1;
            if self.n == self.block_frames {
                self.blocks.push(self.acc / self.n as f64);
                self.acc = 0.0;
                self.n = 0;
            }
        }
        // First blocks: a provisional (cut-only) estimate after 100 ms, so a
        // very loud start isn't played at full level for the first block.
        if self.blocks.len() != had_blocks || (self.blocks.is_empty() && self.n * 4 >= self.block_frames) {
            self.update();
        }
        self.gain != before
    }

    fn update(&mut self) {
        let partial = (self.n > 0).then(|| self.acc / self.n as f64);
        let all = self.blocks.iter().copied().chain(partial);
        let loud: Vec<f64> = all.filter(|p| *p > ABS_GATE).collect();
        if loud.is_empty() {
            return;
        }
        let ungated = loud.iter().sum::<f64>() / loud.len() as f64;
        let gated: Vec<f64> = loud.into_iter().filter(|p| *p >= ungated * REL_GATE).collect();
        let mean = gated.iter().sum::<f64>() / gated.len() as f64;
        let rms = mean.sqrt() as f32;
        let raw = TARGET_RMS / rms.max(1e-6);
        let loud_secs = gated.len() as f32 * BLOCK_SECS;
        self.gain = if raw <= 1.0 {
            raw.max(MAX_CUT)
        } else if loud_secs >= BOOST_AFTER_SECS {
            raw.min(MAX_BOOST)
        } else {
            1.0
        };
    }
}

/// Look-ahead peak limiter over interleaved frames (all channels share one
/// gain, so the stereo image never shifts).
///
/// Gain needed per frame g[n] = min(1, ceiling / peak). The applied gain is
/// a moving average (length W) of a moving minimum (length W) of g, applied
/// to the input delayed by W-1 frames: every average then only contains
/// minima that cover the delayed frame, so the output never exceeds the
/// ceiling, and the gain moves smoothly (no clicks). The gain comes back up
/// with an 80 ms release.
pub struct Limiter {
    ch: usize,
    w: usize,
    ceiling: f32,
    release: f32,
    delay: VecDeque<f32>,
    /// Monotonic deque (frame index, g) for the sliding minimum.
    mins: VecDeque<(u64, f32)>,
    hist: VecDeque<f32>,
    hsum: f64,
    env: f32,
    n: u64,
}

impl Limiter {
    pub fn new(rate: u32, channels: u16) -> Self {
        let w = ((rate as f32 * 0.005) as usize).max(2);
        let release = 1.0 - (-1.0 / (0.08 * rate.max(1) as f32)).exp();
        let mut l = Limiter { ch: channels.max(1) as usize, w, ceiling: 0.98, release, delay: VecDeque::new(), mins: VecDeque::new(), hist: VecDeque::new(), hsum: 0.0, env: 1.0, n: 0 };
        l.reset();
        l
    }

    /// Forget everything (after a seek: the delayed audio is from before it).
    pub fn reset(&mut self) {
        self.delay.clear();
        self.delay.extend(std::iter::repeat_n(0.0, (self.w - 1) * self.ch));
        self.mins.clear();
        self.hist.clear();
        self.hist.extend(std::iter::repeat_n(1.0, self.w));
        self.hsum = self.w as f64;
        self.env = 1.0;
    }

    /// Process interleaved samples in place (output is delayed by W-1 frames).
    pub fn process(&mut self, samples: &mut [f32]) {
        for f in samples.chunks_exact_mut(self.ch) {
            self.frame(f);
        }
    }

    #[inline]
    fn frame(&mut self, f: &mut [f32]) {
        let peak = f.iter().fold(0f32, |m, x| m.max(x.abs()));
        let g = if peak > self.ceiling { self.ceiling / peak } else { 1.0 };
        while self.mins.back().is_some_and(|&(_, v)| v >= g) {
            self.mins.pop_back();
        }
        self.mins.push_back((self.n, g));
        while self.mins.front().is_some_and(|&(i, _)| i + self.w as u64 <= self.n) {
            self.mins.pop_front();
        }
        let h = self.mins.front().map(|m| m.1).unwrap_or(1.0);
        self.hist.push_back(h);
        self.hsum += h as f64;
        if let Some(old) = self.hist.pop_front() {
            self.hsum -= old as f64;
        }
        let s = ((self.hsum / self.w as f64) as f32).min(1.0);
        self.env = if s < self.env {
            s
        } else {
            let e = self.env + (s - self.env) * self.release;
            if e > 0.99999 && s >= 1.0 {
                1.0
            } else {
                e.min(s)
            }
        };
        self.n += 1;
        self.delay.extend(f.iter().copied());
        for x in f.iter_mut() {
            *x = self.delay.pop_front().unwrap_or(0.0) * self.env;
        }
    }

    /// The audio still held back by the look-ahead (at the end of a track).
    pub fn flush(&mut self) -> Vec<f32> {
        let mut tail = vec![0.0; (self.w - 1) * self.ch];
        self.process(&mut tail);
        tail
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const R: u32 = 44_100;

    fn tone(secs: f32, amp: f32, freq: f32) -> Vec<f32> {
        let n = (secs * R as f32) as usize;
        (0..n)
            .flat_map(|i| {
                let v = amp * (std::f32::consts::TAU * freq * i as f32 / R as f32).sin();
                [v, v]
            })
            .collect()
    }

    /// Gain after feeding `x` in decoder-sized chunks.
    fn gain_after(x: &[f32]) -> f32 {
        let mut l = Loudness::new(R, 2);
        for c in x.chunks(4096) {
            l.feed(c);
        }
        l.gain()
    }

    /// The reported bug: a long quiet intro must not turn the loud part up.
    #[test]
    fn quiet_intro_does_not_boost_the_song() {
        for intro in [0.0, 8.0, 16.0, 30.0] {
            let mut x = tone(intro, 0.03, 440.0);
            let at_drop = gain_after(&x);
            assert!(at_drop <= MAX_BOOST, "intro {intro}: {at_drop}");
            x.extend(tone(2.0, 0.6, 50.0));
            let g = gain_after(&x);
            assert!(g < 0.5, "intro {intro}s: loud part played at gain {g}");
        }
    }

    #[test]
    fn quiet_songs_get_a_small_boost_only_after_enough_was_heard() {
        assert_eq!(gain_after(&tone(5.0, 0.05, 440.0)), 1.0);
        let g = gain_after(&tone(20.0, 0.05, 440.0));
        assert!((g - MAX_BOOST).abs() < 1e-3, "{g}");
        assert_eq!(gain_after(&tone(20.0, 0.0, 440.0)), 1.0, "silence is never boosted");
    }

    #[test]
    fn loud_songs_are_turned_down_within_a_block() {
        let g = gain_after(&tone(0.15, 0.9, 100.0));
        assert!(g < 0.3, "{g}");
    }

    #[test]
    fn limiter_never_exceeds_the_ceiling_and_is_transparent_below_it() {
        let mut l = Limiter::new(R, 2);
        let mut quiet = tone(0.5, 0.5, 440.0);
        let orig = quiet.clone();
        l.process(&mut quiet);
        let d = (l.w - 1) * 2;
        assert_eq!(&quiet[d..], &orig[..orig.len() - d], "bit-exact below the ceiling");

        let mut loud = tone(1.0, 2.5, 60.0);
        l.process(&mut loud);
        let tail = l.flush();
        let peak = loud.iter().chain(&tail).fold(0f32, |m, x| m.max(x.abs()));
        assert!(peak <= 0.98 + 1e-4, "peak {peak}");
        // And it isn't just silence.
        assert!(loud[R as usize..].iter().any(|x| x.abs() > 0.9));
    }

    #[test]
    fn limiter_reset_drops_delayed_audio() {
        let mut l = Limiter::new(R, 2);
        let mut a = vec![0.5; 2000];
        l.process(&mut a);
        l.reset();
        let mut z = vec![0.0; 2000];
        l.process(&mut z);
        assert!(z.iter().all(|x| *x == 0.0));
    }
}
