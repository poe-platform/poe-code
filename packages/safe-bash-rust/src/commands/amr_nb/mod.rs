/*
 * AMR-NB decoding adapted from FFmpeg.
 * Copyright (c) 2006-2007 Robert Swain
 * Copyright (c) 2009 Colin McQuillan
 * Copyright (c) 2008 Vladimir Voroshilov
 * Copyright (c) 2010 Marcelo Galvao Povoa
 * Copyright (c) 2007 Reynaldo H. Verdejo Pinochet
 * Copyright (c) 2005 Balatoni Denes
 * Copyright (c) 2006 Loren Merritt
 *
 * This source is licensed under LGPL-2.1-or-later. See LICENSE.AMR.
 */
mod tables;
use tables::*;

const ORDERS: [&[u8]; 8] = [
    &ORDER_MODE_4K75,
    &ORDER_MODE_5K15,
    &ORDER_MODE_5K9,
    &ORDER_MODE_6K7,
    &ORDER_MODE_7K4,
    &ORDER_MODE_7K95,
    &ORDER_MODE_10K2,
    &ORDER_MODE_12K2,
];
const HISTORY: usize = 143 + 10 + 1;
const SHARP_MAX: f32 = 0.794_494_6;

struct Decoder {
    prev_lsf: [i16; 10],
    lsp: [[f64; 10]; 4],
    prev_lsp: [f64; 10],
    lsf: [[f32; 10]; 4],
    lsf_avg: [f32; 10],
    lpc: [[f32; 10]; 4],
    lag: i32,
    excitation: [f32; HISTORY + 40],
    pitch: [f32; 40],
    error: [f32; 4],
    pitch_gain: [f32; 5],
    fixed_gain: [f32; 5],
    beta: f32,
    diff_count: u8,
    hang_count: u8,
    prev_sparse_gain: f32,
    prev_filter: u8,
    onset: u8,
    post_mem: [f32; 10],
    tilt_mem: f32,
    agc: f32,
    high_mem: [f32; 2],
    samples: [f32; 50],
}
impl Decoder {
    fn new() -> Self {
        let mut state = Self {
            prev_lsf: [0; 10],
            lsp: [[0.; 10]; 4],
            prev_lsp: [0.; 10],
            lsf: [[0.; 10]; 4],
            lsf_avg: [0.; 10],
            lpc: [[0.; 10]; 4],
            lag: 0,
            excitation: [0.; HISTORY + 40],
            pitch: [0.; 40],
            error: [-14.; 4],
            pitch_gain: [0.; 5],
            fixed_gain: [0.; 5],
            beta: 0.,
            diff_count: 0,
            hang_count: 0,
            prev_sparse_gain: 0.,
            prev_filter: 0,
            onset: 0,
            post_mem: [0.; 10],
            tilt_mem: 0.,
            agc: 0.,
            high_mem: [0.; 2],
            samples: [0.; 50],
        };
        for i in 0..10 {
            state.prev_lsp[i] = f64::from(f32::from(LSP_SUB4_INIT[i]) * 1000. / 32768.);
            state.lsf_avg[i] = f32::from(LSP_AVG_INIT[i]) / 32768.;
            state.lsf[3][i] = state.lsf_avg[i];
        }
        state
    }
    fn lsf(&mut self, mode: usize, frame: &[u16; 57]) {
        if mode == 7 {
            let codebooks = [
                &LSF_5_1[usize::from(frame[0]) * 4..],
                &LSF_5_2[usize::from(frame[1]) * 4..],
                &LSF_5_3[usize::from(frame[2] >> 1) * 4..],
                &LSF_5_4[usize::from(frame[3]) * 4..],
                &LSF_5_5[usize::from(frame[4]) * 4..],
            ];
            let base = std::array::from_fn::<_, 10, _>(|i| {
                (f64::from(self.prev_lsf[i]) * (8000. / 32768.) * 0.65 + f64::from(LSF_5_MEAN[i]))
                    as f32
            });
            for half in 0..2 {
                let mut residual = [0i16; 10];
                let mut lsf = [0f32; 10];
                for i in 0..10 {
                    residual[i] = codebooks[i / 2][half * 2 + i % 2];
                }
                if frame[2] & 1 != 0 {
                    residual[4] = -residual[4];
                    residual[5] = -residual[5];
                }
                for i in 0..10 {
                    lsf[i] = (f64::from(residual[i]) / 32768. + f64::from(base[i]) / 8000.) as f32;
                }
                stabilize(&mut lsf);
                if half == 1 {
                    self.prev_lsf = residual;
                    self.interpolate_lsf(&lsf);
                }
                for (i, &value) in lsf.iter().enumerate() {
                    self.lsp[half * 2 + 1][i] = (std::f64::consts::TAU * f64::from(value)).cos();
                }
            }
            for i in 0..10 {
                self.lsp[0][i] = 0.5 * self.prev_lsp[i] + 0.5 * self.lsp[1][i];
                self.lsp[2][i] = 0.5 * self.lsp[1][i] + 0.5 * self.lsp[3][i];
            }
        } else {
            let mut residual = [0i16; 10];
            let first = if mode == 5 {
                &LSF_3_1_MODE_7K95[..]
            } else {
                &LSF_3_1[..]
            };
            let last = if mode <= 1 {
                &LSF_3_3_MODE_5K15[..]
            } else {
                &LSF_3_3[..]
            };
            let a = usize::from(frame[0]) * 3;
            let b = (usize::from(frame[1]) << usize::from(mode <= 1)) * 3;
            let c = usize::from(frame[2]) * 4;
            residual[..3].copy_from_slice(&first[a..a + 3]);
            residual[3..6].copy_from_slice(&LSF_3_2[b..b + 3]);
            residual[6..].copy_from_slice(&last[c..c + 4]);
            let mut lsf = std::array::from_fn(|i| {
                (f64::from(f32::from(residual[i]) + f32::from(self.prev_lsf[i]) * PRED_FAC[i])
                    / 32768.
                    + f64::from(LSF_3_MEAN[i]) / 8000.) as f32
            });
            stabilize(&mut lsf);
            self.interpolate_lsf(&lsf);
            self.prev_lsf = residual;
            for (i, &value) in lsf.iter().enumerate() {
                self.lsp[3][i] = (std::f64::consts::TAU * f64::from(value)).cos();
            }
            for sub in 0..3 {
                for i in 0..10 {
                    self.lsp[sub][i] = self.prev_lsp[i]
                        + (self.lsp[3][i] - self.prev_lsp[i]) * 0.25 * (sub + 1) as f64;
                }
            }
        }
        for i in 0..4 {
            self.lpc[i] = lpc(&self.lsp[i]);
        }
    }
    fn interpolate_lsf(&mut self, new: &[f32; 10]) {
        let previous = self.lsf[3];
        for sub in 0..4 {
            for i in 0..10 {
                self.lsf[sub][i] =
                    0.25 * (3 - sub) as f32 * previous[i] + 0.25 * (sub + 1) as f32 * new[i];
            }
        }
    }
    fn pitch(&mut self, index: i32, mode: usize, sub: usize) -> Result<(), &'static str> {
        let (lag, fraction) = if mode == 7 {
            if sub == 0 || sub == 2 {
                if index < 463 {
                    let lag = ((index + 107) * 10923) >> 16;
                    (lag, index - lag * 6 + 105)
                } else {
                    (index - 368, 0)
                }
            } else {
                let lag = (((index + 5) * 10923) >> 16) - 1;
                (lag + (self.lag - 5).clamp(18, 134), index - lag * 6 - 3)
            }
        } else {
            let resolution = if mode <= 3 {
                4
            } else if mode == 5 {
                5
            } else {
                6
            };
            let index = if sub == 0 || sub == 2 && mode > 1 {
                if index < 197 {
                    index + 59
                } else {
                    3 * index - 335
                }
            } else if resolution == 4 {
                let low = (self.lag - 5).clamp(20, 134);
                if index < 4 {
                    3 * (index + low) + 1
                } else if index < 12 {
                    index + 3 * low + 7
                } else {
                    3 * (index + low - 6) + 1
                }
            } else if resolution == 5 {
                index - 1 + 3 * (self.lag - 10).clamp(20, 124)
            } else {
                index - 1 + 3 * (self.lag - 5).clamp(20, 134)
            };
            let lag = (index * 10923) >> 15;
            (lag, (index - 3 * lag - 1) * 2)
        };
        if !(1..=143).contains(&lag) {
            return Err("Invalid AMR-NB pitch lag");
        }
        self.lag = lag;
        let adjusted = lag + i32::from(fraction > 0);
        let fraction = (fraction + 6 - 6 * i32::from(fraction > 0)) as usize;
        let start = HISTORY + 1 - adjusted as usize;
        for n in 0..40 {
            let mut value = 0.;
            for i in 0..10 {
                value += self.excitation[start + n + i] * FF_B60_SINC[i * 6 + fraction];
                value += self.excitation[start + n - i - 1] * FF_B60_SINC[(i + 1) * 6 - fraction];
            }
            self.excitation[HISTORY + n] = value;
            self.pitch[n] = value;
        }
        Ok(())
    }
    fn smooth_gain(&mut self, sub: usize, mode: usize) -> f32 {
        let mut diff = 0.;
        for i in 0..10 {
            diff += (self.lsf_avg[i] - self.lsf[sub][i]).abs() / self.lsf_avg[i];
        }
        self.diff_count += 1;
        if diff <= 0.65 {
            self.diff_count = 0;
        }
        if self.diff_count > 10 {
            self.hang_count = 0;
            self.diff_count -= 1;
        }
        if self.hang_count < 40 {
            self.hang_count += 1;
        } else if mode < 4 || mode == 6 {
            let smoothing = (4. * f64::from(diff) - 1.6).clamp(0., 1.) as f32;
            let mean = ((self.fixed_gain[0]
                + self.fixed_gain[1]
                + self.fixed_gain[2]
                + self.fixed_gain[3]
                + self.fixed_gain[4]) as f64
                * 0.2) as f32;
            return (f64::from(smoothing * self.fixed_gain[4])
                + (1. - f64::from(smoothing)) * f64::from(mean)) as f32;
        }
        self.fixed_gain[4]
    }
    fn disperse(
        &mut self,
        sparse: &Sparse,
        fixed: &[f32; 40],
        gain: f32,
        mode: usize,
    ) -> [f32; 40] {
        let mut filter = if self.pitch_gain[4] < 0.6 {
            0
        } else if self.pitch_gain[4] < 0.9 {
            1
        } else {
            2
        };
        if gain > 2. * self.prev_sparse_gain {
            self.onset = 2;
        } else {
            self.onset = self.onset.saturating_sub(1);
        }
        if self.onset == 0 {
            if self.pitch_gain.iter().filter(|&&g| g < 0.6).count() > 2 {
                filter = 0;
            }
            if filter > self.prev_filter + 1 {
                filter -= 1;
            }
        } else if filter < 2 {
            filter += 1;
        }
        if gain < 5. {
            filter = 2;
        }
        self.prev_filter = filter;
        self.prev_sparse_gain = gain;
        if mode == 4 || mode >= 6 || filter == 2 {
            return *fixed;
        }
        let impulse = if filter == 1 {
            &IR_FILTER_MEDIUM
        } else if mode == 5 {
            &IR_FILTER_STRONG_MODE_7K95
        } else {
            &IR_FILTER_STRONG
        };
        let lag = sparse.lag;
        let mut first = [0f32; 40];
        let mut second = [0f32; 40];
        if lag < 40 {
            for i in 0..40 {
                first[i] = impulse[i] + sparse.factor * impulse[(40 + i - lag) % 40];
            }
            if lag < 20 {
                for i in 0..40 {
                    second[i] = impulse[i] + sparse.factor * first[(40 + i - lag) % 40];
                }
            }
        }
        let mut out = [0f32; 40];
        for i in 0..sparse.count {
            let x = sparse.positions[i];
            let y = sparse.signs[i];
            let filter = if x as i32 >= 40 - lag as i32 {
                impulse
            } else if x as i32 >= 40 - 2 * lag as i32 {
                &first
            } else {
                &second
            };
            for k in 0..40 {
                out[k] += y * filter[(40 + k - x) % 40];
            }
        }
        out
    }
    fn synthesize(
        &mut self,
        lpc: &[f32; 10],
        gain: f32,
        fixed: &[f32; 40],
        mode: usize,
        overflow: bool,
    ) -> bool {
        if overflow {
            for value in &mut self.pitch {
                *value *= 0.25;
            }
        }
        let mut excitation = std::array::from_fn::<_, 40, _>(|i| {
            self.pitch_gain[4] * self.pitch[i] + gain * fixed[i]
        });
        if self.pitch_gain[4] > 0.5 && !overflow {
            let energy = dot(&excitation, &excitation);
            let pitch_factor = (f64::from(self.pitch_gain[4])
                * if mode == 7 {
                    0.25 * f64::from(self.pitch_gain[4].min(1.))
                } else {
                    0.5 * f64::from(self.pitch_gain[4].min(SHARP_MAX))
                }) as f32;
            for (i, value) in excitation.iter_mut().enumerate() {
                *value += pitch_factor * self.pitch[i];
            }
            let norm = dot(&excitation, &excitation);
            let scale = if norm != 0. {
                f64::from(energy / norm).sqrt() as f32
            } else {
                0.
            };
            for value in &mut excitation {
                *value *= scale;
            }
        }
        synthesis_filter(&mut self.samples, lpc, &excitation);
        self.samples[10..].iter().any(|v| v.abs() > 32768.)
    }
    fn postfilter(&mut self, lpc: &[f32; 10], mode: usize) -> [f32; 40] {
        let speech_energy = dot(&self.samples[10..], &self.samples[10..]);
        let (gamma_n, gamma_d) = if mode >= 6 {
            (&FF_POW_0_7, &FF_POW_0_75)
        } else {
            (&FF_POW_0_55, &FF_POW_0_7)
        };
        let numerator: [f32; 10] = std::array::from_fn(|i| lpc[i] * gamma_n[i]);
        let denominator: [f32; 10] = std::array::from_fn(|i| lpc[i] * gamma_d[i]);
        let mut pole = [0f32; 50];
        pole[..10].copy_from_slice(&self.post_mem);
        synthesis_filter(&mut pole, &denominator, &self.samples[10..]);
        self.post_mem.copy_from_slice(&pole[40..]);
        let mut out = [0f32; 40];
        for n in 0..40 {
            out[n] = pole[10 + n];
            for i in 0..10 {
                out[n] += numerator[i] * pole[10 + n - i - 1];
            }
        }
        let mut impulse = [0f32; 32];
        let mut input = [0f32; 22];
        input[0] = 1.;
        input[1..11].copy_from_slice(&numerator);
        synthesis_filter(&mut impulse, &denominator, &input);
        let rh0 = dot(&impulse[10..], &impulse[10..]);
        let rh1 = dot(&impulse[10..31], &impulse[11..]);
        let tilt = if rh1 >= 0. {
            (f64::from(rh1 / rh0) * 0.8) as f32
        } else {
            0.
        };
        let last = out[39];
        for i in (1..40).rev() {
            out[i] -= tilt * out[i - 1];
        }
        out[0] -= tilt * self.tilt_mem;
        self.tilt_mem = last;
        let energy = dot(&out, &out);
        let mut scale = if energy != 0. {
            f64::from(speech_energy / energy).sqrt() as f32
        } else {
            1.
        };
        scale = (f64::from(scale) * (1. - f64::from(0.9f32))) as f32;
        for value in &mut out {
            self.agc = 0.9 * self.agc + scale;
            *value *= self.agc;
        }
        out
    }
    fn frame(&mut self, packet: &[u8]) -> Result<[f32; 160], &'static str> {
        let mode = usize::from(packet[0] >> 3 & 15);
        if mode >= 8 {
            return Err("AMR-NB comfort noise and no-data frames are not supported");
        }
        let mut frame = [0u16; 57];
        let mut order = ORDERS[mode];
        while order[0] != 0 {
            let count = usize::from(order[0]);
            let field = usize::from(order[1] / 2);
            let mut value = 0;
            for &bit in &order[2..2 + count] {
                value = value << 1 | u16::from(packet[1 + usize::from(bit / 8)] >> (bit % 8) & 1);
            }
            frame[field] = value;
            order = &order[2 + count..];
        }
        self.lsf(mode, &frame);
        let mut out = [0f32; 160];
        for sub in 0..4 {
            let params = &frame[5 + sub * 13..5 + (sub + 1) * 13];
            self.pitch(i32::from(params[0]), mode, sub)?;
            let mut sparse = Sparse::decode(&params[3..], mode, sub);
            let gain_factor = if mode == 7 || mode == 5 {
                self.pitch_gain[4] = f32::from(QUA_GAIN_PIT[usize::from(params[1])]) / 16384.;
                f32::from(QUA_GAIN_CODE[usize::from(params[2])]) / 2048.
            } else {
                let gains = if mode >= 3 {
                    &GAINS_HIGH[usize::from(params[1]) * 2..]
                } else if mode >= 1 {
                    &GAINS_LOW[usize::from(params[1]) * 2..]
                } else {
                    &GAINS_MODE_4K75
                        [((usize::from(frame[5 + (sub & 2) * 13 + 1]) << 1) + (sub & 1)) * 2..]
                };
                self.pitch_gain[4] = f32::from(gains[0]) / 16384.;
                f32::from(gains[1]) / 4096.
            };
            if mode == 7 {
                self.beta = self.pitch_gain[4].min(1.);
            }
            sparse.lag = self.lag as usize;
            sparse.factor = self.beta;
            if mode != 0 || sub & 1 != 0 {
                self.beta = self.pitch_gain[4].clamp(0., SHARP_MAX);
            }
            let mut fixed = [0f32; 40];
            sparse.add(&mut fixed, 1.);
            let energy = dot(&fixed, &fixed) / 40.;
            let prediction = dot(&ENERGY_PRED_FAC, &self.error) + ENERGY_MEAN[mode];
            self.fixed_gain[4] = (f64::from(gain_factor) * 10f64.powf(0.05 * f64::from(prediction))
                / f64::from(if energy != 0. { energy.sqrt() } else { 1. }))
                as f32;
            self.error.copy_within(1..4, 0);
            self.error[3] = (20. * f64::from(gain_factor.log10())) as f32;
            for value in &mut self.excitation[HISTORY..] {
                *value *= self.pitch_gain[4];
            }
            sparse.add(&mut self.excitation[HISTORY..], self.fixed_gain[4]);
            for value in &mut self.excitation[HISTORY..] {
                *value = value.trunc();
            }
            let gain = self.smooth_gain(sub, mode);
            let fixed = self.disperse(&sparse, &fixed, gain, mode);
            let lpc = self.lpc[sub];
            if self.synthesize(&lpc, gain, &fixed, mode, false) {
                self.synthesize(&lpc, gain, &fixed, mode, true);
            }
            out[sub * 40..(sub + 1) * 40].copy_from_slice(&self.postfilter(&lpc, mode));
            self.prev_lsp = self.lsp[3];
            self.excitation.copy_within(40..40 + HISTORY, 0);
            self.pitch_gain.copy_within(1..5, 0);
            self.fixed_gain.copy_within(1..5, 0);
            self.samples.copy_within(40..50, 0);
        }
        let gain = (f64::from(HIGHPASS_GAIN[0]) * (2. / 32768.)) as f32;
        for sample in &mut out {
            let tmp = gain * *sample
                - HIGHPASS_POLES[0] * self.high_mem[0]
                - HIGHPASS_POLES[1] * self.high_mem[1];
            *sample =
                tmp + HIGHPASS_ZEROS[0] * self.high_mem[0] + HIGHPASS_ZEROS[1] * self.high_mem[1];
            self.high_mem[1] = self.high_mem[0];
            self.high_mem[0] = tmp;
            if !sample.is_finite() {
                return Err("Invalid AMR-NB synthesis");
            }
        }
        for i in 0..10 {
            self.lsf_avg[i] = 0.84 * self.lsf_avg[i] + 0.16 * self.lsf[3][i];
        }
        Ok(out)
    }
}
struct Sparse {
    positions: [usize; 10],
    signs: [f32; 10],
    count: usize,
    lag: usize,
    factor: f32,
}
impl Sparse {
    fn decode(pulses: &[u16], mode: usize, sub: usize) -> Self {
        let mut out = Self {
            positions: [0; 10],
            signs: [0.; 10],
            count: 0,
            lag: 0,
            factor: 0.,
        };
        if mode == 7 {
            out.count = 10;
            for i in 0..5 {
                let a = usize::from(GRAY_DECODE[usize::from(pulses[2 * i + 1] & 7)]) + i;
                let b = usize::from(GRAY_DECODE[usize::from(pulses[2 * i] & 7)]) + i;
                let sign = if pulses[2 * i + 1] & 8 != 0 { -1. } else { 1. };
                out.positions[2 * i + 1] = a;
                out.positions[2 * i] = b;
                out.signs[2 * i + 1] = sign;
                out.signs[2 * i] = if b < a { -sign } else { sign };
            }
        } else if mode == 6 {
            let mut positions = [0usize; 8];
            for (code, i1, i2, i3) in [
                (usize::from(pulses[4]), 0, 4, 1),
                (usize::from(pulses[5]), 2, 6, 5),
            ] {
                let p = &BASE_FIVE_TABLE[(code >> 3) * 3..];
                positions[i1] = (usize::from(p[2]) << 1) + (code & 1);
                positions[i2] = (usize::from(p[1]) << 1) + ((code >> 1) & 1);
                positions[i3] = (usize::from(p[0]) << 1) + ((code >> 2) & 1);
            }
            let code = usize::from(pulses[6]);
            let temp = ((code >> 2) * 25 + 12) >> 5;
            positions[3] = temp % 5;
            positions[7] = temp / 5;
            if positions[7] & 1 != 0 {
                positions[3] = 4 - positions[3];
            }
            positions[3] = (positions[3] << 1) + (code & 1);
            positions[7] = (positions[7] << 1) + ((code >> 1) & 1);
            out.count = 8;
            for i in 0..4 {
                let a = (positions[i] << 2) + i;
                let b = (positions[i + 4] << 2) + i;
                let sign = if pulses[i] != 0 { -1. } else { 1. };
                out.positions[i] = a;
                out.positions[i + 4] = b;
                out.signs[i] = sign;
                out.signs[i + 4] = if b < a { -sign } else { sign };
            }
        } else {
            let code = usize::from(pulses[0]);
            let p = &mut out.positions;
            match mode {
                0 | 1 => {
                    let subset = ((code >> 3) & 8) + (sub << 1);
                    p[0] = (code & 7) * 5 + usize::from(TRACK_POSITION[subset]);
                    p[1] = ((code >> 3) & 7) * 5 + usize::from(TRACK_POSITION[subset + 1]);
                    out.count = 2;
                }
                2 => {
                    p[0] = ((code >> 1) & 7) * 5 + ((code & 1) << 1) + 1;
                    let subset = (code >> 4) & 3;
                    p[1] = ((code >> 6) & 7) * 5 + subset + usize::from(subset == 3);
                    out.count = if p[0] == p[1] { 1 } else { 2 };
                }
                3 => {
                    p[0] = (code & 7) * 5;
                    p[1] = ((code >> 4) & 7) * 5 + ((code >> 2) & 2) + 1;
                    p[2] = ((code >> 8) & 7) * 5 + ((code >> 6) & 2) + 2;
                    out.count = 3;
                }
                _ => {
                    p[0] = usize::from(GRAY_DECODE[code & 7]);
                    p[1] = usize::from(GRAY_DECODE[(code >> 3) & 7]) + 1;
                    p[2] = usize::from(GRAY_DECODE[(code >> 6) & 7]) + 2;
                    p[3] = usize::from(GRAY_DECODE[(code >> 10) & 7]) + ((code >> 9) & 1) + 3;
                    out.count = 4;
                }
            }
            for i in 0..out.count {
                out.signs[i] = if pulses[1] >> i & 1 != 0 { 1. } else { -1. };
            }
        }
        out
    }
    fn add(&self, out: &mut [f32], scale: f32) {
        for i in 0..self.count {
            let mut value = self.signs[i] * scale;
            for index in (self.positions[i]..40).step_by(self.lag) {
                out[index] += value;
                value *= self.factor;
            }
        }
    }
}
fn stabilize(lsf: &mut [f32; 10]) {
    let mut previous = 0f32;
    for value in lsf {
        previous = f64::from(*value).max(f64::from(previous) + 50.0488 / 8000.) as f32;
        *value = previous;
    }
}
fn lpc(lsp: &[f64; 10]) -> [f32; 10] {
    let mut polynomials = [[0f64; 6]; 2];
    for (offset, p) in polynomials.iter_mut().enumerate() {
        p[0] = 1.;
        p[1] = -2. * lsp[offset];
        for i in 2..=5 {
            let value = -2. * lsp[offset + (i - 1) * 2];
            p[i] = value * p[i - 1] + 2. * p[i - 2];
            for j in (2..i).rev() {
                p[j] += p[j - 1] * value + p[j - 2];
            }
            p[1] += value;
        }
    }
    let [pa, qa] = polynomials;
    let mut out = [0f32; 10];
    for i in 0..5 {
        let a = pa[i + 1] + pa[i];
        let b = qa[i + 1] - qa[i];
        out[i] = (0.5 * (a + b)) as f32;
        out[9 - i] = (0.5 * (a - b)) as f32;
    }
    out
}
pub(super) fn dot(a: &[f32], b: &[f32]) -> f32 {
    let mut sum = 0f32;
    for (&a, &b) in a.iter().zip(b) {
        sum += a * b;
    }
    sum
}
pub(super) fn synthesis_filter(out: &mut [f32], coeffs: &[f32], input: &[f32]) {
    let order = coeffs.len();
    let a = coeffs[0];
    let b = coeffs[1] - coeffs[0] * coeffs[0];
    let c = (coeffs[2] - coeffs[1] * coeffs[0]) - coeffs[0] * b;
    let mut previous: [f32; 4] = out[order - 4..order].try_into().unwrap();
    let mut n = 0;
    while n + 4 <= input.len() {
        let mut values: [f32; 4] = input[n..n + 4].try_into().unwrap();
        for i in 0..3 {
            values[i] -= coeffs[2] * previous[i + 1];
        }
        for i in 0..2 {
            values[i] -= coeffs[1] * previous[i + 2];
        }
        values[0] -= coeffs[0] * previous[3];
        for i in 0..4 {
            values[i] -= coeffs[3] * previous[i];
        }
        for i in (5..order).step_by(2) {
            previous[3] = out[order + n - i];
            let value = coeffs[i - 1];
            values[0] -= value * previous[3];
            values[1] -= value * previous[0];
            values[2] -= value * previous[1];
            values[3] -= value * previous[2];
            previous[2] = out[order + n - i - 1];
            let value = coeffs[i];
            values[0] -= value * previous[2];
            values[1] -= value * previous[3];
            values[2] -= value * previous[0];
            values[3] -= value * previous[1];
            previous.swap(0, 2);
            previous[1] = previous[3];
        }
        let [v0, v1, v2, _] = values;
        values[3] -= a * v2;
        values[2] -= a * v1;
        values[1] -= a * v0;
        values[3] -= b * v1;
        values[2] -= b * v0;
        values[3] -= c * v0;
        out[order + n..order + n + 4].copy_from_slice(&values);
        previous = values;
        n += 4;
    }
    for n in n..input.len() {
        out[order + n] = input[n];
        for i in 0..order {
            out[order + n] -= coeffs[i] * out[order + n - i - 1];
        }
    }
}
pub(super) fn decode<'a>(
    packets: impl Iterator<Item = &'a [u8]>,
    limit: usize,
) -> Result<Vec<u8>, &'static str> {
    let available = limit
        .checked_sub(size_of::<Decoder>() + 4096)
        .ok_or("AMR-NB decoder exceeds memory budget")?;
    let mut decoder = Decoder::new();
    let mut output = Vec::new();
    for packet in packets {
        let mut at = 0;
        while at < packet.len() {
            let mode = usize::from(packet[at] >> 3 & 15);
            if mode >= 8 {
                return Err("AMR-NB comfort noise and no-data frames are not supported");
            }
            let len = usize::from(FRAME_SIZES_NB[mode]) + 1;
            let frame = packet.get(at..at + len).ok_or("Truncated AMR-NB frame")?;
            if 640 > available.saturating_sub(output.len()) {
                return Err("AMR-NB PCM exceeds memory budget");
            }
            let samples = decoder.frame(frame)?;
            output
                .try_reserve_exact(640)
                .map_err(|_| "AMR-NB PCM exceeds memory budget")?;
            for value in samples {
                output.extend_from_slice(&value.to_le_bytes());
            }
            at += len;
        }
    }
    Ok(output)
}
