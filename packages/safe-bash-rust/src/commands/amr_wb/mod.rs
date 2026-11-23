/*
 * AMR-WB decoding adapted from FFmpeg, modified November 14, 2026.
 * Copyright (c) 2010 Marcelo Galvao Povoa
 * Copyright (c) 2008 Michael Niedermayer
 * Copyright (c) 2008 Vladimir Voroshilov
 * Copyright (c) 2007 Reynaldo H. Verdejo Pinochet
 * Licensed under LGPL-2.1-or-later. See LICENSE.AMR.
 */
mod tables;
use super::amr_nb::{dot, synthesis_filter};
use tables::*;
const HISTORY: usize = 231 + 16 + 1;
const ORDERS: [&[u16]; 9] = [
    &ORDER_MODE_6K60,
    &ORDER_MODE_8K85,
    &ORDER_MODE_12K65,
    &ORDER_MODE_14K25,
    &ORDER_MODE_15K85,
    &ORDER_MODE_18K25,
    &ORDER_MODE_19K85,
    &ORDER_MODE_23K05,
    &ORDER_MODE_23K85,
];
struct Decoder {
    isf_past: [f32; 16],
    isf_final: [f32; 16],
    isp_past: [f64; 16],
    first: bool,
    base_lag: i32,
    lag: usize,
    excitation: [f32; HISTORY + 65],
    pitch: [f32; 64],
    error: [f32; 4],
    pitch_gain: [f32; 6],
    fixed_gain: [f32; 2],
    tilt: f32,
    prev_filter: usize,
    threshold: f32,
    low: [f32; 80],
    up: [f32; 88],
    high: [f32; 100],
    hpf31: [f32; 2],
    hpf400: [f32; 2],
    deemphasis: f32,
    bandpass: [f32; 30],
    lowpass: [f32; 30],
    noise: [u32; 64],
    noise_index: usize,
}
impl Decoder {
    fn new() -> Self {
        Self {
            isf_past: [0.; 16],
            isf_final: std::array::from_fn(|i| f32::from(ISF_INIT[i]) / 32768.),
            isp_past: [0.; 16],
            first: true,
            base_lag: 0,
            lag: 0,
            excitation: [0.; HISTORY + 65],
            pitch: [0.; 64],
            error: [-14.; 4],
            pitch_gain: [0.; 6],
            fixed_gain: [0.; 2],
            tilt: 0.,
            prev_filter: 0,
            threshold: 0.,
            low: [0.; 80],
            up: [0.; 88],
            high: [0.; 100],
            hpf31: [0.; 2],
            hpf400: [0.; 2],
            deemphasis: 0.,
            bandpass: [0.; 30],
            lowpass: [0.; 30],
            noise: NOISE_INIT,
            noise_index: 0,
        }
    }
    fn isf(&mut self, mode: usize, indices: &[u16]) -> [f32; 16] {
        let mut result = std::array::from_fn(|i| {
            if i < 9 {
                f32::from(DICO1_ISF[usize::from(indices[0]) * 9 + i]) / 32768.
            } else {
                f32::from(DICO2_ISF[usize::from(indices[1]) * 7 + i - 9]) / 32768.
            }
        });
        let books: &[(&[i16], usize)] = if mode == 0 {
            &[
                (&DICO21_ISF_36B, 5),
                (&DICO22_ISF_36B, 4),
                (&DICO23_ISF_36B, 7),
            ]
        } else {
            &[
                (&DICO21_ISF, 3),
                (&DICO22_ISF, 3),
                (&DICO23_ISF, 3),
                (&DICO24_ISF, 3),
                (&DICO25_ISF, 4),
            ]
        };
        let mut at = 0;
        for (i, &(book, width)) in books.iter().enumerate() {
            for j in 0..width {
                result[at + j] += f32::from(book[usize::from(indices[i + 2]) * width + j]) / 32768.;
            }
            at += width;
        }
        for i in 0..16 {
            let residual = result[i];
            result[i] += f32::from(ISF_MEAN[i]) / 32768.;
            result[i] = (f64::from(result[i]) + f64::from(self.isf_past[i]) * (1. / 3.)) as f32;
            self.isf_past[i] = residual;
        }
        let mut previous = 0.;
        for value in &mut result[..15] {
            *value = value.max(previous + 128. / 32768.);
            previous = *value;
        }
        result
    }
    fn pitch(&mut self, index: i32, mode: usize, sub: usize, ltp: bool) {
        let (mut lag, fraction);
        if mode <= 1 {
            if sub == 0 || sub == 2 && mode != 0 {
                if index < 116 {
                    lag = (index + 69) >> 1;
                    fraction = (index - 2 * lag + 68) * 2;
                } else {
                    lag = index - 24;
                    fraction = 0;
                }
                self.base_lag = (lag - 8 - i32::from(fraction < 0)).clamp(34, 216);
            } else {
                lag = (index + 1) >> 1;
                fraction = (index - 2 * lag) * 2;
                lag += self.base_lag;
            }
        } else if sub == 0 || sub == 2 {
            if index < 376 {
                lag = (index + 137) >> 2;
                fraction = index - 4 * lag + 136;
            } else if index < 440 {
                lag = (index + 257 - 376) >> 1;
                fraction = (index - 2 * lag + 256 - 376) * 2;
            } else {
                lag = index - 280;
                fraction = 0;
            }
            self.base_lag = (lag - 8 - i32::from(fraction < 0)).clamp(34, 216);
        } else {
            lag = (index + 1) >> 2;
            fraction = index - 4 * lag;
            lag += self.base_lag;
        }
        self.lag = lag as usize;
        let adjusted = lag + i32::from(fraction > 0);
        let phase = (fraction + if fraction > 0 { 0 } else { 4 }) as usize;
        let start = HISTORY + 1 - adjusted as usize;
        for n in 0..65 {
            let mut value = 0.;
            for i in 0..16 {
                value += self.excitation[start + n + i] * AC_INTER[i * 4 + phase];
                value += self.excitation[start + n - i - 1] * AC_INTER[(i + 1) * 4 - phase];
            }
            self.excitation[HISTORY + n] = value;
        }
        if ltp {
            self.pitch
                .copy_from_slice(&self.excitation[HISTORY..HISTORY + 64]);
        } else {
            for i in 0..64 {
                self.pitch[i] = (0.18 * f64::from(self.excitation[HISTORY + i - 1])
                    + 0.64 * f64::from(self.excitation[HISTORY + i])
                    + 0.18 * f64::from(self.excitation[HISTORY + i + 1]))
                    as f32;
            }
            self.excitation[HISTORY..HISTORY + 64].copy_from_slice(&self.pitch);
        }
    }
    fn disperse(&mut self, fixed: &[f32; 64], mode: usize) -> [f32; 64] {
        if mode > 1 {
            return *fixed;
        }
        let mut filter = if self.pitch_gain[0] < 0.6 {
            0
        } else if self.pitch_gain[0] < 0.9 {
            1
        } else {
            2
        };
        if f64::from(self.fixed_gain[0]) > 3. * f64::from(self.fixed_gain[1]) {
            filter = (filter + 1).min(2);
        } else {
            if self.pitch_gain.iter().filter(|&&v| v < 0.6).count() > 2 {
                filter = 0;
            }
            if filter > self.prev_filter + 1 {
                filter -= 1;
            }
        }
        self.prev_filter = filter;
        filter += usize::from(mode == 1);
        if filter >= 2 {
            return *fixed;
        }
        let coef = if filter == 0 {
            &IR_FILTER_STR
        } else {
            &IR_FILTER_MID
        };
        let mut out = [0.; 64];
        for i in 0..64 {
            if fixed[i] != 0. {
                for n in 0..64 {
                    out[n] += fixed[i] * coef[(n + 64 - i) % 64];
                }
            }
        }
        out
    }
    fn frame(&mut self, packet: &[u8], mode: usize) -> Result<[f32; 320], &'static str> {
        // FFmpeg conceals bad-quality/no-data frames without advancing speech state.
        if mode == 15 || packet[0] & 4 == 0 {
            return Ok([0.; 320]);
        }
        if mode >= 9 {
            return Err("AMR-WB comfort noise and reserved modes are not supported");
        }
        let mut frame = [0u16; 56];
        let mut order = ORDERS[mode];
        while order[0] != 0 {
            let count = usize::from(order[0]);
            let field = usize::from(order[1]) / 2;
            let mut value = 0;
            for &bit in &order[2..2 + count] {
                value = value << 1 | u16::from(packet[1 + usize::from(bit / 8)] >> (bit % 8) & 1);
            }
            frame[field] = value;
            order = &order[2 + count..];
        }
        let mut isf = self.isf(mode, &frame[1..8]);
        let mut distance = 0.;
        for i in 0..15 {
            distance += (isf[i] - self.isf_final[i]) * (isf[i] - self.isf_final[i]);
        }
        let stability = (1.25 - f64::from(distance) * 0.8 * 512.).max(0.) as f32;
        isf[15] *= 2.;
        let isp =
            std::array::from_fn::<_, 16, _>(|i| (std::f64::consts::TAU * f64::from(isf[i])).cos());
        if self.first {
            self.isp_past = isp;
            self.first = false;
        }
        let mut output = [0.; 320];
        for sub in 0..4 {
            let interpolation = f64::from(ISFP_INTER[sub]);
            let intermediate = std::array::from_fn::<_, 16, _>(|i| {
                if sub == 3 {
                    isp[i]
                } else {
                    (1. - interpolation) * self.isp_past[i] + interpolation * isp[i]
                }
            });
            let mut lpc = [0.; 16];
            isp_to_lpc(&intermediate, &mut lpc);
            let params = &frame[8 + sub * 12..8 + (sub + 1) * 12];
            self.pitch(i32::from(params[0]), mode, sub, params[1] != 0);
            let mut fixed = fixed_vector(&params[4..8], &params[8..12], mode);
            for i in (1..64).rev() {
                fixed[i] -= fixed[i - 1] * self.tilt;
            }
            for i in self.lag..64 {
                fixed[i] = (f64::from(fixed[i]) + f64::from(fixed[i - self.lag]) * 0.85) as f32;
            }
            let gains = if mode <= 1 {
                &QUA_GAIN_6B[..]
            } else {
                &QUA_GAIN_7B[..]
            };
            let index = usize::from(params[2]) * 2;
            self.pitch_gain[0] = f32::from(gains[index]) / 16384.;
            let factor = f32::from(gains[index + 1]) / 2048.;
            let energy = dot(&fixed, &fixed) / 64.;
            let prediction = dot(&ENERGY_PRED_FAC, &self.error) + 30.;
            self.fixed_gain[0] = (f64::from(factor) * 10f64.powf(0.05 * f64::from(prediction))
                / f64::from(if energy != 0. { energy.sqrt() } else { 1. }))
                as f32;
            self.error.copy_within(1..4, 0);
            self.error[3] = if mode <= 1 {
                GAIN_ERROR_6B[usize::from(params[2])]
            } else {
                GAIN_ERROR_7B[usize::from(params[2])]
            };
            let pitch_energy = f64::from(dot(&self.pitch, &self.pitch))
                * f64::from(self.pitch_gain[0])
                * f64::from(self.pitch_gain[0]);
            let fixed_energy = f64::from(dot(&fixed, &fixed))
                * f64::from(self.fixed_gain[0])
                * f64::from(self.fixed_gain[0]);
            let voice =
                ((pitch_energy - fixed_energy) / (pitch_energy + fixed_energy + 0.01)) as f32;
            self.tilt = (f64::from(voice) * 0.25 + 0.25) as f32;
            for i in 0..64 {
                self.excitation[HISTORY + i] *= self.pitch_gain[0];
                self.excitation[HISTORY + i] += self.fixed_gain[0] * fixed[i];
                self.excitation[HISTORY + i] = self.excitation[HISTORY + i].trunc();
            }
            let smoothing = (0.5 * f64::from(1. - voice) * f64::from(stability)) as f32;
            let gain = self.fixed_gain[0];
            self.threshold = if gain < self.threshold {
                self.threshold.min(gain + gain * (6226f32 / 32768.))
            } else {
                self.threshold.max(gain * (27536f32 / 32768.))
            };
            let gain = smoothing * self.threshold + (1. - smoothing) * gain;
            let mut fixed = self.disperse(&fixed, mode);
            let cpe = (0.125 * f64::from(1. + voice)) as f32;
            let mut last = fixed[0];
            fixed[0] -= cpe * fixed[1];
            for i in 1..63 {
                let current = fixed[i];
                fixed[i] -= cpe * (last + fixed[i + 1]);
                last = current;
            }
            fixed[63] -= cpe * last;
            let mut excitation = std::array::from_fn::<_, 64, _>(|i| {
                self.pitch_gain[0] * self.pitch[i] + gain * fixed[i]
            });
            if self.pitch_gain[0] > 0.5 && mode <= 1 {
                let energy = dot(&excitation, &excitation);
                let factor =
                    (0.25 * f64::from(self.pitch_gain[0]) * f64::from(self.pitch_gain[0])) as f32;
                for i in 0..64 {
                    excitation[i] += factor * self.pitch[i];
                }
                normalize(&mut excitation, energy);
            }
            synthesis_filter(&mut self.low, &lpc, &excitation);
            for i in 0..64 {
                self.up[24 + i] = self.low[16 + i] + self.deemphasis * 0.68f32;
                self.deemphasis = self.up[24 + i];
            }
            highpass(
                &mut self.up[24..],
                &HPF_31_POLES,
                HPF_31_GAIN[0],
                &mut self.hpf31,
            );
            let mut low = [0.; 80];
            let mut integer = 0;
            for chunk in low.chunks_exact_mut(5) {
                chunk[0] = self.up[12 + integer];
                for i in 0..4 {
                    chunk[i + 1] = dot(
                        &self.up[1 + integer..25 + integer],
                        &UPSAMPLE_FIR[i * 24..(i + 1) * 24],
                    );
                    integer += 1;
                }
            }
            let mut high = [0.; 80];
            high[..64].copy_from_slice(&self.up[24..]);
            highpass(
                &mut high[..64],
                &HPF_400_POLES,
                HPF_400_GAIN[0],
                &mut self.hpf400,
            );
            let hb_gain = if mode == 8 {
                f32::from(QUA_HB_GAIN[usize::from(params[3])]) / 16384.
            } else {
                let numerator = dot(&high[..63], &high[1..64]);
                let tilt = if numerator > 0. {
                    numerator / dot(&high[..64], &high[..64])
                } else {
                    0.
                };
                ((1. - f64::from(tilt)) * (1.25 - 0.25 * f64::from(frame[0] > 0))).clamp(0.1, 1.)
                    as f32
            };
            for value in &mut high {
                let i = self.noise_index;
                let n = self.noise[(i + 40) & 63].wrapping_add(self.noise[(i + 9) & 63]);
                self.noise[i] = n;
                self.noise_index = (i + 1) & 63;
                *value = 32768. - f32::from(n as u16);
            }
            normalize(&mut high, dot(&excitation, &excitation) * hb_gain * hb_gain);
            if mode == 0 {
                let mut extended = [0.; 20];
                let a = ISFP_INTER[sub];
                let b = (1. - f64::from(a)) as f32;
                for i in 0..16 {
                    extended[i] = a * self.isf_final[i] + b * isf[i];
                }
                extrapolate(&mut extended);
                extended[19] *= 2.;
                let isp = std::array::from_fn::<_, 20, _>(|i| {
                    (std::f64::consts::TAU * f64::from(extended[i])).cos()
                });
                let mut coeffs = [0.; 20];
                isp_to_lpc(&isp, &mut coeffs);
                weight(&mut coeffs, 0.9);
                synthesis_filter(&mut self.high, &coeffs, &high);
            } else {
                let mut coeffs = lpc;
                weight(&mut coeffs, 0.6);
                synthesis_filter(&mut self.high[4..], &coeffs, &high);
            }
            high.copy_from_slice(&self.high[20..]);
            fir(&mut high, &BPF_6_7_COEF, &mut self.bandpass);
            if mode == 8 {
                fir(&mut high, &LPF_7_COEF, &mut self.lowpass);
            }
            for i in 0..80 {
                output[sub * 80 + i] = (low[i] + high[i]) / 32768.;
            }
            self.excitation.copy_within(64..64 + HISTORY, 0);
            self.pitch_gain.copy_within(0..5, 1);
            self.fixed_gain[1] = self.fixed_gain[0];
            self.low.copy_within(64..80, 0);
            self.up.copy_within(64..88, 0);
            self.high.copy_within(80..100, 0);
        }
        self.isp_past = isp;
        self.isf_final = isf;
        if output.iter().any(|v| !v.is_finite()) {
            return Err("Invalid AMR-WB synthesis");
        }
        Ok(output)
    }
}
fn normalize(values: &mut [f32], energy: f32) {
    let norm = dot(values, values);
    let factor = if norm != 0. {
        f64::from(energy / norm).sqrt() as f32
    } else {
        0.
    };
    for value in values {
        *value *= factor;
    }
}
fn highpass(values: &mut [f32], poles: &[f32; 2], gain: f32, memory: &mut [f32; 2]) {
    for value in values {
        let tmp = gain * *value - poles[0] * memory[0] - poles[1] * memory[1];
        *value = tmp + HPF_ZEROS[0] * memory[0] + HPF_ZEROS[1] * memory[1];
        memory[1] = memory[0];
        memory[0] = tmp;
    }
}
fn fir(values: &mut [f32; 80], coeffs: &[f32; 31], memory: &mut [f32; 30]) {
    let mut data = [0.; 110];
    data[..30].copy_from_slice(memory);
    data[30..].copy_from_slice(values);
    for i in 0..80 {
        values[i] = dot(&data[i..i + 31], coeffs);
    }
    memory.copy_from_slice(&data[80..]);
}
fn weight(coeffs: &mut [f32], gamma: f32) {
    let mut factor = gamma;
    for value in coeffs {
        *value *= factor;
        factor *= gamma;
    }
}
fn polynomial(isp: &[f64], out: &mut [f64]) {
    out[0] = 1.;
    out[1] = -2. * isp[0];
    for i in 2..out.len() {
        let value = -2. * isp[2 * i - 2];
        out[i] = value * out[i - 1] + 2. * out[i - 2];
        for j in (2..i).rev() {
            out[j] += out[j - 1] * value + out[j - 2];
        }
        out[1] += value;
    }
}
fn isp_to_lpc(isp: &[f64], out: &mut [f32]) {
    let half = out.len() / 2;
    let mut pa = [0.; 11];
    let mut qa = [0.; 11];
    polynomial(isp, &mut pa[..half + 1]);
    polynomial(&isp[1..], &mut qa[1..half + 1]);
    let last = isp[isp.len() - 1];
    for i in 1..half {
        let p = pa[i] * (1. + last);
        let q = (qa[i + 1] - qa[i - 1]) * (1. - last);
        out[i - 1] = ((p + q) * 0.5) as f32;
        out[out.len() - i - 1] = ((p - q) * 0.5) as f32;
    }
    out[half - 1] = ((1. + last) * pa[half] * 0.5) as f32;
    out[out.len() - 1] = last as f32;
}
fn extrapolate(isf: &mut [f32; 20]) {
    isf[19] = isf[15];
    let mut diff = [0.; 14];
    for i in 0..14 {
        diff[i] = isf[i + 1] - isf[i];
    }
    let mut mean = 0.;
    for value in &diff[2..] {
        mean += *value * (1f32 / 12.);
    }
    let mut correlations = [0.; 3];
    let mut best = 0;
    for i in 0..3 {
        for j in 7..14 {
            let product = (diff[j] - mean) * (diff[j - i - 2] - mean);
            correlations[i] += product * product;
        }
        if correlations[i] > correlations[best] {
            best = i;
        }
    }
    best += 1;
    for i in 15..19 {
        isf[i] = isf[i - 1] + isf[i - 1 - best] - isf[i - 2 - best];
    }
    let estimate = (7965. + f64::from(isf[2] - isf[3] - isf[4]) / 6.) as f32;
    let scale =
        (0.5 * f64::from(estimate.min(7600.) - isf[14]) / f64::from(isf[18] - isf[14])) as f32;
    for i in 15..19 {
        diff[i - 15] = scale * (isf[i] - isf[i - 1]);
    }
    for i in 1..4 {
        if diff[i] + diff[i - 1] < 5. {
            if diff[i] > diff[i - 1] {
                diff[i - 1] = 5. - diff[i];
            } else {
                diff[i] = 5. - diff[i - 1];
            }
        }
    }
    for i in 15..19 {
        isf[i] = isf[i - 1] + diff[i - 15] / 32768.;
    }
    for value in &mut isf[..19] {
        *value = (f64::from(*value) * 0.8) as f32;
    }
}
fn bits(code: i32, start: i32, len: i32) -> i32 {
    (code >> start) & ((1 << len) - 1)
}
fn pulses(out: &mut [i32], code: i32, m: i32, off: i32) {
    match out.len() {
        1 => {
            let pos = bits(code, 0, m) + off;
            out[0] = if bits(code, m, 1) != 0 { -pos } else { pos };
        }
        2 => {
            let a = bits(code, m, m) + off;
            let b = bits(code, 0, m) + off;
            let sign = if bits(code, 2 * m, 1) != 0 { -1 } else { 1 };
            out[0] = a * sign;
            out[1] = b * sign * if a > b { -1 } else { 1 };
        }
        3 => {
            let half = bits(code, 2 * m - 1, 1) << (m - 1);
            pulses(&mut out[..2], bits(code, 0, 2 * m - 1), m - 1, off + half);
            pulses(&mut out[2..], bits(code, 2 * m, m + 1), m, off);
        }
        4 => {
            let offset = 1 << (m - 1);
            match bits(code, 4 * m - 2, 2) {
                0 => {
                    let half = bits(code, 4 * m - 3, 1) << (m - 1);
                    let quarter = bits(code, 2 * m - 3, 1) << (m - 2);
                    pulses(
                        &mut out[..2],
                        bits(code, 0, 2 * m - 3),
                        m - 2,
                        off + half + quarter,
                    );
                    pulses(
                        &mut out[2..],
                        bits(code, 2 * m - 2, 2 * m - 1),
                        m - 1,
                        off + half,
                    );
                }
                1 => {
                    pulses(&mut out[..1], bits(code, 3 * m - 2, m), m - 1, off);
                    pulses(&mut out[1..], bits(code, 0, 3 * m - 2), m - 1, off + offset);
                }
                2 => {
                    pulses(&mut out[..2], bits(code, 2 * m - 1, 2 * m - 1), m - 1, off);
                    pulses(&mut out[2..], bits(code, 0, 2 * m - 1), m - 1, off + offset);
                }
                _ => {
                    pulses(&mut out[..3], bits(code, m, 3 * m - 2), m - 1, off);
                    pulses(&mut out[3..], bits(code, 0, m), m - 1, off + offset);
                }
            }
        }
        5 => {
            let half = bits(code, 5 * m - 1, 1) << (m - 1);
            pulses(
                &mut out[..3],
                bits(code, 2 * m + 1, 3 * m - 2),
                m - 1,
                off + half,
            );
            pulses(&mut out[3..], bits(code, 0, 2 * m + 1), m, off);
        }
        6 => {
            let offset = 1 << (m - 1);
            let more = bits(code, 6 * m - 5, 1) << (m - 1);
            let other = offset - more;
            match bits(code, 6 * m - 4, 2) {
                case @ (0 | 1) => {
                    pulses(
                        &mut out[..1],
                        bits(code, 0, m),
                        m - 1,
                        off + if case == 0 { more } else { other },
                    );
                    pulses(&mut out[1..], bits(code, m, 5 * m - 5), m - 1, off + more);
                }
                2 => {
                    pulses(&mut out[..2], bits(code, 0, 2 * m - 1), m - 1, off + other);
                    pulses(
                        &mut out[2..],
                        bits(code, 2 * m - 1, 4 * m - 4),
                        m - 1,
                        off + more,
                    );
                }
                _ => {
                    pulses(&mut out[..3], bits(code, 3 * m - 2, 3 * m - 2), m - 1, off);
                    pulses(&mut out[3..], bits(code, 0, 3 * m - 2), m - 1, off + offset);
                }
            }
        }
        _ => unreachable!(),
    }
}
fn fixed_vector(high: &[u16], low: &[u16], mode: usize) -> [f32; 64] {
    let mut output = [0.; 64];
    for i in 0..4 {
        let count = usize::from(PULSES_NB_PER_MODE_TR[mode * 4 + i]);
        if count == 0 {
            continue;
        }
        let code = i32::from(low[i])
            + (i32::from(high[i])
                << if mode == 5 || mode == 6 && i >= 2 {
                    14
                } else if mode == 6 {
                    10
                } else {
                    11
                });
        let mut positions = [0; 6];
        pulses(
            &mut positions[..count],
            code,
            if mode == 0 { 5 } else { 4 },
            1,
        );
        for &pos in &positions[..count] {
            output[(pos.unsigned_abs() as usize - 1) * if mode == 0 { 2 } else { 4 } + i] +=
                if pos < 0 { -1. } else { 1. };
        }
    }
    output
}
pub(super) fn decode<'a>(
    packets: impl Iterator<Item = &'a [u8]>,
    limit: usize,
) -> Result<Vec<u8>, &'static str> {
    let available = limit
        .checked_sub(size_of::<Decoder>() + 8192)
        .ok_or("AMR-WB decoder exceeds memory budget")?;
    let mut decoder = Decoder::new();
    let mut output = Vec::new();
    for packet in packets {
        let mut at = 0;
        while at < packet.len() {
            let mode = usize::from(packet[at] >> 3 & 15);
            let len = (usize::from(CF_SIZES_WB[mode]) + 7) / 8 + 1;
            let frame = packet.get(at..at + len).ok_or("Truncated AMR-WB frame")?;
            if 1280 > available.saturating_sub(output.len()) {
                return Err("AMR-WB PCM exceeds memory budget");
            }
            let samples = decoder.frame(frame, mode)?;
            output
                .try_reserve_exact(1280)
                .map_err(|_| "AMR-WB PCM exceeds memory budget")?;
            for value in samples {
                output.extend_from_slice(&value.to_le_bytes());
            }
            at += len;
        }
    }
    Ok(output)
}
