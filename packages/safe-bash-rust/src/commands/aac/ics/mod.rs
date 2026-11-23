// Symphonia
// Copyright (c) 2019-2022 The Project Symphonia Developers.
//
// Previous Author: Kostya Shishkov <kostya.shiskov@gmail.com>
//
// This source file includes code originally written for the NihAV
// project. With the author's permission, it has been relicensed for,
// and ported to the Symphonia project.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

use super::{Bits, Result};

use super::codebooks;
use super::common::*;
use super::dsp;

mod pulse;
mod tns;

const ZERO_HCB: u8 = 0;
const RESERVED_HCB: u8 = 12;
const NOISE_HCB: u8 = 13;
const INTENSITY_HCB2: u8 = 14;
const INTENSITY_HCB: u8 = 15;

const INTENSITY_SCALE_MIN: i16 = -155;
const NORMAL_SCALE_MIN: i16 = -100;

static POW43_TABLE: std::sync::LazyLock<[f32; 8192]> = std::sync::LazyLock::new(|| {
    let mut pow43 = [0f32; 8192];
    for (i, pow43) in pow43.iter_mut().enumerate() {
        *pow43 = f32::powf(i as f32, 4.0 / 3.0);
    }
    pow43
});

static NORMAL_SCF_TABLE: std::sync::LazyLock<[f32; 256]> = std::sync::LazyLock::new(|| {
    let mut table = [0f32; 256];
    for (i, table) in table.iter_mut().enumerate() {
        *table = 2.0f32.powf(0.25 * f32::from(i as i16 - 56 + NORMAL_SCALE_MIN))
    }
    table
});

static INTENSITY_SCF_TABLE: std::sync::LazyLock<[f32; 256]> = std::sync::LazyLock::new(|| {
    let mut table = [0f32; 256];
    for (i, table) in table.iter_mut().enumerate() {
        *table = 0.5f32.powf(0.25 * f32::from(i as i16 + INTENSITY_SCALE_MIN));
    }
    table
});

#[derive(Clone)]
pub struct IcsInfo {
    pub window_sequence: u8,
    pub prev_window_sequence: u8,
    pub window_shape: bool,
    pub prev_window_shape: bool,
    pub scale_factor_grouping: [bool; MAX_WINDOWS],
    pub group_start: [usize; MAX_WINDOWS],
    pub window_groups: usize,
    pub num_windows: usize,
    pub max_sfb: usize,
    pub long_win: bool,
}

impl IcsInfo {
    fn new() -> Self {
        Self {
            window_sequence: 0,
            prev_window_sequence: 0,
            window_shape: false,
            prev_window_shape: false,
            scale_factor_grouping: [false; MAX_WINDOWS],
            group_start: [0; MAX_WINDOWS],
            num_windows: 0,
            window_groups: 0,
            max_sfb: 0,
            long_win: true,
        }
    }

    pub fn decode(&mut self, bs: &mut Bits<'_>) -> Result<()> {
        self.prev_window_sequence = self.window_sequence;
        self.prev_window_shape = self.window_shape;

        if bs.read_bool()? {
            return Err("aac: ics reserved bit set");
        }

        self.window_sequence = bs.read_bits_leq32(2)? as u8;

        self.window_shape = bs.read_bool()?;
        self.window_groups = 1;

        if self.window_sequence == EIGHT_SHORT_SEQUENCE {
            self.long_win = false;
            self.num_windows = 8;
            self.max_sfb = bs.read_bits_leq32(4)? as usize;

            for i in 0..MAX_WINDOWS - 1 {
                self.scale_factor_grouping[i] = bs.read_bool()?;

                if !self.scale_factor_grouping[i] {
                    self.group_start[self.window_groups] = i + 1;
                    self.window_groups += 1;
                }
            }
        } else {
            self.long_win = true;
            self.num_windows = 1;
            self.max_sfb = bs.read_bits_leq32(6)? as usize;
            if bs.read_bool()? {
                return Err("AAC-LC prediction is not supported");
            }
        }
        Ok(())
    }

    pub fn copy_from_common(&mut self, other: &IcsInfo) {
        // Maintain the previous window sequence and shape.
        let prev_window_sequence = self.window_sequence;
        let prev_window_shape = self.window_shape;

        *self = other.clone();

        self.prev_window_sequence = prev_window_sequence;
        self.prev_window_shape = prev_window_shape;
    }

    fn get_group_start(&self, g: usize) -> usize {
        if g == 0 {
            0
        } else if g >= self.window_groups {
            if self.long_win { 1 } else { 8 }
        } else {
            self.group_start[g]
        }
    }
}

#[derive(Clone)]
pub struct Ics {
    global_gain: u8,
    pub info: IcsInfo,
    pulse: Option<pulse::Pulse>,
    tns: Option<tns::Tns>,
    sect_cb: [[u8; MAX_SFBS]; MAX_WINDOWS],
    sect_len: [[usize; MAX_SFBS]; MAX_WINDOWS],
    sfb_cb: [[u8; MAX_SFBS]; MAX_WINDOWS],
    num_sec: [usize; MAX_WINDOWS],
    pub scales: [[f32; MAX_SFBS]; MAX_WINDOWS],
    sbinfo: GASubbandInfo,
    pub coeffs: [f32; 1024],
    pub delay: [f32; 1024],
}

impl Ics {
    pub fn new(sbinfo: GASubbandInfo) -> Self {
        Self {
            global_gain: 0,
            info: IcsInfo::new(),
            pulse: None,
            tns: None,
            sect_cb: [[0; MAX_SFBS]; MAX_WINDOWS],
            sect_len: [[0; MAX_SFBS]; MAX_WINDOWS],
            sfb_cb: [[0; MAX_SFBS]; MAX_WINDOWS],
            scales: [[0.0; MAX_SFBS]; MAX_WINDOWS],
            num_sec: [0; MAX_WINDOWS],
            sbinfo,
            coeffs: [0.0; 1024],
            delay: [0.0; 1024],
        }
    }

    fn decode_section_data(&mut self, bs: &mut Bits<'_>) -> Result<()> {
        let sect_bits = if self.info.long_win { 5 } else { 3 };
        let sect_esc_val = (1 << sect_bits) - 1;

        for g in 0..self.info.window_groups {
            let mut k = 0;
            let mut l = 0;

            while k < self.info.max_sfb {
                self.sect_cb[g][l] = bs.read_bits_leq32(4)? as u8;
                self.sect_len[g][l] = 0;

                if self.sect_cb[g][l] == RESERVED_HCB {
                    return Err("aac: invalid band type");
                }

                loop {
                    let sect_len_incr = bs.read_bits_leq32(sect_bits)? as usize;

                    self.sect_len[g][l] += sect_len_incr;

                    if sect_len_incr < sect_esc_val {
                        break;
                    }
                }

                validate!(self.sect_len[g][l] > 0 && k + self.sect_len[g][l] <= self.info.max_sfb);

                for sfb in k..k + self.sect_len[g][l] {
                    self.sfb_cb[g][sfb] = self.sect_cb[g][l];
                }

                k += self.sect_len[g][l];
                l += 1;
            }

            self.num_sec[g] = l;
        }
        Ok(())
    }

    #[inline(always)]
    pub fn is_zero(&self, g: usize, sfb: usize) -> bool {
        self.sfb_cb[g][sfb] == ZERO_HCB
    }

    #[inline(always)]
    pub fn is_intensity(&self, g: usize, sfb: usize) -> bool {
        (self.sfb_cb[g][sfb] == INTENSITY_HCB) || (self.sfb_cb[g][sfb] == INTENSITY_HCB2)
    }

    #[inline(always)]
    pub fn is_noise(&self, g: usize, sfb: usize) -> bool {
        self.sfb_cb[g][sfb] == NOISE_HCB
    }

    #[inline(always)]
    pub fn get_intensity_dir(&self, g: usize, sfb: usize) -> bool {
        self.sfb_cb[g][sfb] == INTENSITY_HCB
    }

    fn decode_scale_factor_data(&mut self, bs: &mut Bits<'_>) -> Result<()> {
        let mut noise_pcm_flag = true;
        let mut scf_intensity = -INTENSITY_SCALE_MIN;
        let mut scf_noise = i16::from(self.global_gain) - 90 - NORMAL_SCALE_MIN;
        let mut scf_normal = i16::from(self.global_gain);

        let table_normal_scf: &[f32; 256] = &NORMAL_SCF_TABLE;
        let table_intensity_scf: &[f32; 256] = &INTENSITY_SCF_TABLE;

        for g in 0..self.info.window_groups {
            for sfb in 0..self.info.max_sfb {
                self.scales[g][sfb] = if self.is_zero(g, sfb) {
                    0.0
                } else if self.is_intensity(g, sfb) {
                    scf_intensity += i16::from(codebooks::read(11, bs)? as u8) - 60;

                    // Valid range is -155 to 100. Value offset by 155 for lookup table indexing.
                    validate!((scf_intensity >= 0) && (scf_intensity < 256));

                    table_intensity_scf[scf_intensity as usize]
                } else if self.is_noise(g, sfb) {
                    if noise_pcm_flag {
                        noise_pcm_flag = false;
                        scf_noise += (bs.read_bits_leq32(9)? as i16) - 256;
                    } else {
                        scf_noise += i16::from(codebooks::read(11, bs)? as u8) - 60;
                    }

                    // Valid range is -100 to 155. Value offset by 100 for lookup table indexing.
                    validate!((scf_noise >= 0) && (scf_noise < 256));

                    table_normal_scf[scf_noise as usize]
                } else {
                    scf_normal += i16::from(codebooks::read(11, bs)? as u8) - 60;

                    // Valid range is -100 to 155. Value offset by 100 for lookup table indexing.
                    validate!((scf_normal >= 0) && (scf_normal < 256));

                    table_normal_scf[scf_normal as usize]
                }
            }
        }
        Ok(())
    }

    pub fn get_bands(&self) -> &'static [usize] {
        if self.info.long_win {
            self.sbinfo.long_bands
        } else {
            self.sbinfo.short_bands
        }
    }

    fn decode_spectrum(&mut self, bs: &mut Bits<'_>, lcg: &mut Lcg) -> Result<()> {
        // Zero all spectral coefficients.
        self.coeffs.fill(0.0);

        let bands = self.get_bands();

        for g in 0..self.info.window_groups {
            let cur_w = self.info.get_group_start(g);
            let next_w = self.info.get_group_start(g + 1);
            for sfb in 0..self.info.max_sfb {
                let start = bands[sfb];
                let end = bands[sfb + 1];

                let cb_idx = self.sfb_cb[g][sfb];
                let scale = self.scales[g][sfb];

                for w in cur_w..next_w {
                    let dst = &mut self.coeffs[start + w * 128..end + w * 128];

                    // Derived from ISO/IEC-14496-3 Table 4.151.
                    match cb_idx {
                        ZERO_HCB => (),
                        RESERVED_HCB => (),
                        NOISE_HCB => decode_noise(lcg, scale, dst),
                        INTENSITY_HCB2 => (),
                        INTENSITY_HCB => (),
                        1 => decode_quads_signed(bs, &codebooks::QUADS[0], scale, dst)?,
                        2 => decode_quads_signed(bs, &codebooks::QUADS[1], scale, dst)?,
                        3 => decode_quads_unsigned(bs, &codebooks::QUADS[2], scale, dst)?,
                        4 => decode_quads_unsigned(bs, &codebooks::QUADS[3], scale, dst)?,
                        5 => decode_pairs_signed(bs, &codebooks::PAIRS[0], scale, dst)?,
                        6 => decode_pairs_signed(bs, &codebooks::PAIRS[1], scale, dst)?,
                        7 => decode_pairs_unsigned(bs, &codebooks::PAIRS[2], scale, dst)?,
                        8 => decode_pairs_unsigned(bs, &codebooks::PAIRS[3], scale, dst)?,
                        9 => decode_pairs_unsigned(bs, &codebooks::PAIRS[4], scale, dst)?,
                        10 => decode_pairs_unsigned(bs, &codebooks::PAIRS[5], scale, dst)?,
                        11 => decode_pairs_unsigned_escape(bs, &codebooks::ESC, scale, dst)?,
                        _ => unreachable!(),
                    }
                }
            }
        }
        Ok(())
    }

    pub fn decode(&mut self, bs: &mut Bits<'_>, lcg: &mut Lcg, common_window: bool) -> Result<()> {
        self.global_gain = bs.read_bits_leq32(8)? as u8;

        // If a common window is used, a common ICS info was decoded previously.
        if !common_window {
            self.info.decode(bs)?;
        }

        validate!(self.info.max_sfb < self.get_bands().len());
        self.decode_section_data(bs)?;

        self.decode_scale_factor_data(bs)?;

        self.pulse = pulse::Pulse::read(bs)?;

        validate!(self.pulse.is_none() || self.info.long_win);

        self.tns = tns::Tns::read(bs, &self.info, true)?;
        if bs.read_bool()? {
            return Err("AAC-LC gain control is not supported");
        }

        self.decode_spectrum(bs, lcg)?;
        Ok(())
    }

    pub fn synth_channel(&mut self, dsp: &mut dsp::Dsp, rate_idx: usize, dst: &mut [f32]) {
        let bands = self.get_bands();

        if let Some(pulse) = &self.pulse {
            pulse.synth(bands, &self.scales, &mut self.coeffs);
        }

        if let Some(tns) = &self.tns {
            tns.synth(&self.info, bands, rate_idx, &mut self.coeffs);
        }

        dsp.synth(
            &self.coeffs,
            &mut self.delay,
            &self.info,
            dst,
        );
    }
}

/// Perceptual noise substitution decode step. Section 4.6.13.3.
fn decode_noise(lcg: &mut Lcg, sf: f32, dst: &mut [f32]) {
    let mut energy = 0.0;

    for spec in dst.iter_mut() {
        *spec = lcg.next() as f32;
        energy += *spec * *spec;
    }

    let scale = sf / energy.sqrt();

    for spec in dst.iter_mut() {
        *spec *= scale;
    }
}

#[inline(always)]
fn decode_sign(val: u32) -> f32 {
    1.0 - 2.0 * val as f32
}

fn decode_quads_unsigned(
    bs: &mut Bits<'_>,
    cb: &codebooks::QuadsCodebook,
    scale: f32,
    dst: &mut [f32],
) -> Result<()> {
    // Table of dequantized samples for all possible quantized values.
    let iquant = [0.0, scale, 2.519_842_1 * scale];

    for out in dst.chunks_exact_mut(4) {
        let (a, b, c, d) = cb.read_quant(bs)?;

        if a != 0 {
            out[0] = decode_sign(bs.read_bits_leq32(1)?) * iquant[a as usize];
        }
        if b != 0 {
            out[1] = decode_sign(bs.read_bits_leq32(1)?) * iquant[b as usize];
        }
        if c != 0 {
            out[2] = decode_sign(bs.read_bits_leq32(1)?) * iquant[c as usize];
        }
        if d != 0 {
            out[3] = decode_sign(bs.read_bits_leq32(1)?) * iquant[d as usize];
        }
    }

    Ok(())
}

fn decode_quads_signed(
    bs: &mut Bits<'_>,
    cb: &codebooks::QuadsCodebook,
    scale: f32,
    dst: &mut [f32],
) -> Result<()> {
    // Table of dequantized samples for all possible quantized values.
    let iquant = [-scale, 0.0, scale];

    for out in dst.chunks_exact_mut(4) {
        let (a, b, c, d) = cb.read_quant(bs)?;

        out[0] = iquant[a as usize];
        out[1] = iquant[b as usize];
        out[2] = iquant[c as usize];
        out[3] = iquant[d as usize];
    }
    Ok(())
}

fn decode_pairs_signed(
    bs: &mut Bits<'_>,
    cb: &codebooks::PairsCodebook,
    scale: f32,
    dst: &mut [f32],
) -> Result<()> {
    for out in dst.chunks_exact_mut(2) {
        let (x, y) = cb.read_dequant(bs)?;

        out[0] = x * scale;
        out[1] = y * scale;
    }
    Ok(())
}

fn decode_pairs_unsigned(
    bs: &mut Bits<'_>,
    cb: &codebooks::PairsCodebook,
    scale: f32,
    dst: &mut [f32],
) -> Result<()> {
    for out in dst.chunks_exact_mut(2) {
        let (x, y) = cb.read_dequant(bs)?;

        let sign_x = if x != 0.0 {
            decode_sign(bs.read_bits_leq32(1)?)
        } else {
            1.0
        };
        let sign_y = if y != 0.0 {
            decode_sign(bs.read_bits_leq32(1)?)
        } else {
            1.0
        };

        out[0] = sign_x * x * scale;
        out[1] = sign_y * y * scale;
    }

    Ok(())
}

fn decode_pairs_unsigned_escape(
    bs: &mut Bits<'_>,
    cb: &codebooks::EscapeCodebook,
    scale: f32,
    dst: &mut [f32],
) -> Result<()> {
    let iquant: &[f32; 8192] = &POW43_TABLE;

    for out in dst.chunks_exact_mut(2) {
        let (a, b) = cb.read_quant(bs)?;

        // Read the signs of the dequantized samples.
        let sign_x = if a != 0 {
            decode_sign(bs.read_bits_leq32(1)?)
        } else {
            1.0
        };
        let sign_y = if b != 0 {
            decode_sign(bs.read_bits_leq32(1)?)
        } else {
            1.0
        };

        let x = iquant[if a == 16 { read_escape(bs)? } else { a } as usize];
        let y = iquant[if b == 16 { read_escape(bs)? } else { b } as usize];

        out[0] = sign_x * x * scale;
        out[1] = sign_y * y * scale;
    }
    Ok(())
}

fn read_escape(bs: &mut Bits<'_>) -> Result<u16> {
    let n = bs.read_unary_ones()?;

    validate!(n < 9);

    // The escape word is added to 2^(n + 4) to yield the unsigned value.
    let word = (1 << (n + 4)) + bs.read_bits_leq32(n + 4)? as u16;

    Ok(word)
}
