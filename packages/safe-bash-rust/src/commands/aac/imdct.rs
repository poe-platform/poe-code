// Adapted from Symphonia's IMDCT, Copyright (c) 2019-2023 The Project Symphonia Developers.
// This Source Code Form is subject to the Mozilla Public License, v. 2.0.
// See LICENSE.AAC or https://mozilla.org/MPL/2.0/.
pub struct Imdct {
    twiddle: Vec<(f32, f32)>,
    fft_twiddle: Vec<(f32, f32)>,
    buffer: Vec<(f32, f32)>,
}
impl Imdct {
    pub fn new_scaled(n: usize, scale: f64) -> Self {
        let twiddle = (0..n / 2)
            .map(|i| {
                let a = std::f64::consts::PI / n as f64 * (i as f64 + 0.125);
                (
                    (a.cos() * scale.sqrt()) as f32,
                    (a.sin() * scale.sqrt()) as f32,
                )
            })
            .collect();
        let fft_twiddle = (0..n / 4)
            .map(|i| {
                let a = -std::f64::consts::TAU * i as f64 / (n / 2) as f64;
                (a.cos() as f32, a.sin() as f32)
            })
            .collect();
        Self {
            twiddle,
            fft_twiddle,
            buffer: vec![(0., 0.); n / 2],
        }
    }
    pub fn imdct(&mut self, spec: &[f32], out: &mut [f32]) {
        let n = spec.len();
        let half = n / 2;
        let bits = half.trailing_zeros();
        for (i, &(wr, wi)) in self.twiddle.iter().enumerate() {
            let even = spec[i * 2];
            let odd = -spec[n - 1 - i * 2];
            self.buffer[i.reverse_bits() >> (usize::BITS - bits)] =
                (odd * wi - even * wr, odd * wr + even * wi);
        }
        let mut size = 2;
        while size <= half {
            for start in (0..half).step_by(size) {
                for j in 0..size / 2 {
                    let (wr, wi) = self.fft_twiddle[j * half / size];
                    let (br, bi) = self.buffer[start + j + size / 2];
                    let (ar, ai) = self.buffer[start + j];
                    let (tr, ti) = (br * wr - bi * wi, br * wi + bi * wr);
                    self.buffer[start + j] = (ar + tr, ai + ti);
                    self.buffer[start + j + size / 2] = (ar - tr, ai - ti);
                }
            }
            size *= 2;
        }
        for i in 0..half {
            let (xr, xi) = self.buffer[i];
            let (wr, wi) = self.twiddle[i];
            let (re, im) = (wr * xr + wi * xi, wi * xr - wr * xi);
            let j = i % (half / 2);
            let forward = 2 * j;
            let reverse = half - 1 - 2 * j;
            if i < half / 2 {
                out[reverse] = -im;
                out[half + forward] = im;
                out[n + reverse] = re;
                out[n + half + forward] = re;
            } else {
                out[forward] = -re;
                out[half + reverse] = re;
                out[n + forward] = im;
                out[n + half + reverse] = im;
            }
        }
    }
}
