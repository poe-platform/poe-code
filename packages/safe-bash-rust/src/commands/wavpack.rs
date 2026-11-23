/*
 * WavPack codec adapted from David Bryant’s BSD-licensed reference implementation.
 *                   Copyright (c) 1998 - 2025 David Bryant
 *                           All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 *     * Redistributions of source code must retain the above copyright notice,
 *       this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright notice,
 *       this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of the copyright holder nor the names of its
 *       contributors may be used to endorse or promote products derived from
 *       this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE REGENTS OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
use super::{
    InputTime,
    ffmpeg_pcm::Format,
    ffmpeg_wave::{Input, Wave},
    mp4::mux::Remux,
};

const RATES: [u32; 15] = [
    6000, 8000, 9600, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000, 88200, 96000,
    192000,
];
fn word(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap())
}
pub(super) fn finish(
    out: &mut Vec<u8>,
    frames: u32,
    source: &[(String, String)],
    opts: &Remux,
) -> Result<(), &'static str> {
    let count = (if opts.strip_metadata { 0 } else { source.len() })
        .checked_add(opts.metadata.len())
        .and_then(|n| n.checked_add(usize::from(!opts.bitexact)))
        .filter(|n| *n <= opts.limit.saturating_sub(out.capacity()) / size_of::<(&str, &str)>())
        .ok_or("WavPack metadata exceeds memory budget")?;
    let mut tags: Vec<(&str, &str)> = Vec::new();
    tags.try_reserve_exact(count)
        .map_err(|_| "WavPack metadata exceeds memory budget")?;
    for (key, value) in source
        .iter()
        .filter(|_| !opts.strip_metadata)
        .chain(opts.metadata)
    {
        if let Some(index) = tags.iter().position(|(k, _)| k.eq_ignore_ascii_case(key)) {
            tags.swap_remove(index);
        }
        if !value.is_empty() {
            tags.push((key, value));
        }
    }
    if let Some(index) = tags
        .iter()
        .position(|(k, _)| k.eq_ignore_ascii_case("encoder"))
    {
        tags.swap_remove(index);
    }
    if !opts.bitexact {
        tags.push(("encoder", "Lavf61.7.100"));
    }
    tags.retain(|(key, _)| !key.is_empty() && key.bytes().all(|b| (32..127).contains(&b)));
    if !opts.stdout && out.starts_with(b"wvpk") {
        out[12..16].copy_from_slice(&frames.to_le_bytes());
    }
    if tags.is_empty() {
        return Ok(());
    }
    let size = tags
        .iter()
        .try_fold(64usize, |size, (key, value)| {
            size.checked_add(9)?
                .checked_add(key.len())?
                .checked_add(value.len())
        })
        .filter(|n| {
            *n <= opts
                .limit
                .saturating_sub(out.capacity())
                .saturating_sub(tags.capacity() * size_of::<(&str, &str)>())
        })
        .ok_or("WavPack metadata exceeds memory budget")?;
    let tag_size = u32::try_from(size - 32).map_err(|_| "WavPack metadata exceeds size limit")?;
    out.try_reserve_exact(size)
        .map_err(|_| "WavPack metadata exceeds memory budget")?;
    let mut header = [0u8; 32];
    header[..8].copy_from_slice(b"APETAGEX");
    header[8..12].copy_from_slice(&2000u32.to_le_bytes());
    header[12..16].copy_from_slice(&tag_size.to_le_bytes());
    header[16..20].copy_from_slice(&(tags.len() as u32).to_le_bytes());
    header[20..24].copy_from_slice(&0xa0000000u32.to_le_bytes());
    out.extend_from_slice(&header);
    for (key, value) in tags {
        out.extend_from_slice(&(value.len() as u32).to_le_bytes());
        out.extend_from_slice(&[0; 4]);
        out.extend_from_slice(key.as_bytes());
        out.push(0);
        out.extend_from_slice(value.as_bytes());
    }
    header[20..24].copy_from_slice(&0x80000000u32.to_le_bytes());
    out.extend_from_slice(&header);
    Ok(())
}

pub(super) fn unpack_matroska(
    packet: &[u8],
    private: &[u8],
    out: &mut Vec<u8>,
    limit: usize,
) -> Result<u32, &'static str> {
    if private.len() != 2
        || !(0x402..=0x410).contains(&u16::from_le_bytes([private[0], private[1]]))
    {
        return Err("Invalid Matroska WavPack version");
    }
    if packet.len() < 12 || word(packet, 0) == 0 {
        return Err("Invalid Matroska WavPack packet");
    }
    let frames = word(packet, 0);
    let multiple = word(packet, 4) & 0x1800 != 0x1800;
    let mut pos = 4;
    let begin = out.len();
    loop {
        if packet.len() - pos < if multiple { 12 } else { 8 } {
            return Err("Truncated Matroska WavPack block");
        }
        let flags = word(packet, pos);
        if (flags & 0x800 != 0) != (out.len() == begin) {
            return Err("Invalid Matroska WavPack block group");
        }
        let checksum = word(packet, pos + 4);
        pos += 8;
        let size = if multiple {
            let n = word(packet, pos) as usize;
            pos += 4;
            n
        } else {
            packet.len() - pos
        };
        if size > packet.len() - pos {
            return Err("Truncated Matroska WavPack data");
        }
        let length = size
            .checked_add(32)
            .filter(|&n| n <= limit.saturating_sub(out.len()))
            .ok_or("WavPack packets exceed memory budget")?;
        let at = out.len();
        out.try_reserve_exact(length)
            .map_err(|_| "WavPack packets exceed memory budget")?;
        out.resize(at + length, 0);
        out[at..at + 4].copy_from_slice(b"wvpk");
        out[at + 4..at + 8].copy_from_slice(
            &u32::try_from(length - 8)
                .map_err(|_| "WavPack packet exceeds size limit")?
                .to_le_bytes(),
        );
        out[at + 8..at + 10].copy_from_slice(private);
        out[at + 20..at + 24].copy_from_slice(&frames.to_le_bytes());
        out[at + 24..at + 28].copy_from_slice(&flags.to_le_bytes());
        out[at + 28..at + 32].copy_from_slice(&checksum.to_le_bytes());
        out[at + 32..].copy_from_slice(&packet[pos..pos + size]);
        pos += size;
        if flags & 0x1000 != 0 {
            if pos != packet.len() {
                return Err("Trailing Matroska WavPack block data");
            }
            return Ok(frames);
        }
        if pos == packet.len() {
            return Err("Incomplete Matroska WavPack block group");
        }
    }
}

pub(super) fn pack_matroska(
    packet: &[u8],
    limit: usize,
) -> Result<std::borrow::Cow<'_, [u8]>, &'static str> {
    use std::borrow::Cow;
    if packet.len() < 32 || &packet[..4] != b"wvpk" {
        return Err("Invalid WavPack packet");
    }
    if word(packet, 24) & 0x1800 == 0x1800 {
        if u64::from(word(packet, 4)) + 8 != packet.len() as u64 {
            return Err("Invalid WavPack packet size");
        }
        return Ok(Cow::Borrowed(&packet[20..]));
    }
    let mut out = Vec::new();
    if packet.len() > limit {
        return Err("WavPack packets exceed memory budget");
    }
    out.try_reserve_exact(packet.len())
        .map_err(|_| "WavPack packets exceed memory budget")?;
    out.extend_from_slice(&packet[20..24]);
    let mut pos = 0;
    while pos < packet.len() {
        let block = &packet[pos..];
        if block.len() < 32 || &block[..4] != b"wvpk" {
            return Err("Invalid WavPack packet");
        }
        let size = (u64::from(word(block, 4)) + 8)
            .try_into()
            .map_err(|_| "Invalid WavPack packet size")?;
        if size < 32 || size > block.len() {
            return Err("Invalid WavPack packet size");
        }
        let flags = word(block, 24);
        if word(block, 20) != word(packet, 20)
            || (flags & 0x800 != 0) != (pos == 0)
            || (flags & 0x1000 != 0) != (pos + size == packet.len())
        {
            return Err("Invalid WavPack block group");
        }
        out.extend_from_slice(&block[24..32]);
        out.extend_from_slice(&((size - 32) as u32).to_le_bytes());
        out.extend_from_slice(&block[32..size]);
        pos += size;
    }
    Ok(Cow::Owned(out))
}

fn metadata(block: &[u8]) -> Result<[Option<&[u8]>; 64], &'static str> {
    let mut parts = [None; 64];
    let mut pos = 32;
    while pos < block.len() {
        let head = block
            .get(pos..pos + 2)
            .ok_or("Truncated WavPack metadata")?;
        let id = head[0];
        let mut size = usize::from(head[1]) * 2;
        pos += 2;
        if id & 0x80 != 0 {
            let large = block
                .get(pos..pos + 2)
                .ok_or("Truncated WavPack metadata length")?;
            size += usize::from(large[0]) * 512 + usize::from(large[1]) * 131072;
            pos += 2;
        }
        let length = size
            .checked_sub(usize::from(id & 0x40 != 0))
            .ok_or("Invalid WavPack metadata size")?;
        if size > block.len() - pos {
            return Err("Invalid WavPack metadata size");
        }
        parts[usize::from(id & 0x3f)] = Some(&block[pos..pos + length]);
        pos += size;
    }
    Ok(parts)
}
fn exp2(value: i32) -> Result<i64, &'static str> {
    let log = value.unsigned_abs();
    let mantissa = (256. * 2f64.powf(f64::from(log & 255) / 256.)).round();
    let magnitude = (mantissa * 2f64.powi((log >> 8) as i32 - 9)).floor();
    if magnitude > f64::from(u32::MAX) {
        return Err("Invalid WavPack logarithmic value");
    }
    Ok(if value < 0 {
        -(magnitude as i64)
    } else {
        magnitude as i64
    })
}
struct Bits<'a> {
    bytes: &'a [u8],
    pos: usize,
}
impl Bits<'_> {
    fn read(&mut self, width: u32) -> Result<u32, &'static str> {
        if width > 32
            || self.bytes.len().saturating_mul(8).saturating_sub(self.pos) < width as usize
        {
            return Err("Truncated WavPack bitstream");
        }
        let mut v = 0;
        for i in 0..width {
            v |= u32::from((self.bytes[self.pos / 8] >> (self.pos % 8)) & 1) << i;
            self.pos += 1;
        }
        Ok(v)
    }
    fn unary(&mut self, limit: u32) -> Result<u32, &'static str> {
        let mut value = 0;
        while self.read(1)? != 0 {
            value += 1;
            if value > limit {
                return Err("Invalid WavPack unary code");
            }
        }
        Ok(value)
    }
    fn gamma(&mut self) -> Result<u32, &'static str> {
        let width = self.unary(32)?;
        if width < 2 {
            Ok(width)
        } else {
            Ok((1 << (width - 1)) + self.read(width - 1)?)
        }
    }
}
struct Entropy<'a> {
    bits: Bits<'a>,
    medians: [[i64; 3]; 2],
    one: u32,
    zero: bool,
    zeros: u32,
}
impl Entropy<'_> {
    fn word(&mut self, ch: usize) -> Result<i32, &'static str> {
        if self.medians[0][0] < 2 && self.medians[1][0] < 2 && self.one == 0 && !self.zero {
            if self.zeros != 0 {
                self.zeros -= 1;
                if self.zeros != 0 {
                    return Ok(0);
                }
            } else {
                self.zeros = self.bits.gamma()?;
                if self.zeros != 0 {
                    self.medians = [[0; 3]; 2];
                    return Ok(0);
                }
            }
        }
        let mut ones = 0u64;
        if self.zero {
            self.zero = false;
        } else {
            ones = u64::from(self.bits.unary(16)?);
            if ones == 16 {
                ones += u64::from(self.bits.gamma()?);
            }
            let previous = self.one;
            self.one = (ones & 1) as u32;
            ones = ones / 2 + u64::from(previous);
            self.zero = self.one == 0;
        }
        let (mut low, mut high) = (0i64, 0i64);
        for j in 0..3 {
            let median = &mut self.medians[ch][j];
            let width = *median / 16 + 1;
            let divisor = 128 >> j;
            if ones == j as u64 {
                high = low + width - 1;
                *median -= ((*median + divisor - 2) / divisor) * 2;
                break;
            }
            low = low
                .checked_add(
                    width
                        .checked_mul(if j == 2 { ones as i64 - 2 } else { 1 })
                        .ok_or("Invalid WavPack residual range")?,
                )
                .ok_or("Invalid WavPack residual range")?;
            high = low + width - 1;
            *median += ((*median + divisor) / divisor) * 5;
            if *median > i64::from(u32::MAX) {
                return Err("Invalid WavPack residual range");
            }
        }
        if high > i64::from(i32::MAX) {
            return Err("Invalid WavPack residual range");
        }
        let max = (high - low) as u32;
        let width = 32 - max.leading_zeros();
        let extras = (1u64 << width) - u64::from(max) - 1;
        let mut code = if width != 0 {
            u64::from(self.bits.read(width - 1)?)
        } else {
            0
        };
        if width != 0 && code >= extras {
            code = code * 2 - extras + u64::from(self.bits.read(1)?);
        }
        let value = (low + code as i64) as i32;
        Ok(if self.bits.read(1)? != 0 {
            !value
        } else {
            value
        })
    }
}
struct Pass {
    term: i32,
    delta: i32,
    weights: [i32; 2],
    history: [[i32; 8]; 2],
}
impl Pass {
    fn apply(&mut self, values: &mut [i32; 2], ch: usize, predicted: i32) {
        let residual = values[ch];
        values[ch] = residual.wrapping_add(
            ((i64::from(self.weights[ch]) * i64::from(predicted) + 512) >> 10) as i32,
        );
        if predicted != 0 && residual != 0 {
            self.weights[ch] = self.weights[ch].wrapping_add(if predicted ^ residual < 0 {
                -self.delta
            } else {
                self.delta
            });
            if self.term < 0 {
                self.weights[ch] = self.weights[ch].clamp(-1024, 1024);
            }
        }
    }
}
fn float_sample(
    mut value: i32,
    info: &[u8],
    extra: &mut Bits,
    crc: &mut u32,
) -> Result<u32, &'static str> {
    let flags = info[0];
    let mut exponent = u32::from(info[2]);
    let (mut sign, mut mantissa) = (0u32, 0u32);
    if value == 0 {
        if flags & 8 != 0 && extra.read(1)? != 0 {
            mantissa = extra.read(23)?;
            exponent = if exponent >= 25 { extra.read(8)? } else { 0 };
            sign = extra.read(1)?;
        } else {
            exponent = 0;
            if flags & 24 == 24 {
                sign = extra.read(1)?;
            }
        }
    } else {
        value = value.wrapping_shl(u32::from(info[1] & 31));
        let mut magnitude = if value < 0 {
            sign = 1;
            value.unsigned_abs()
        } else {
            value as u32
        };
        if magnitude == 0x1000000 {
            if extra.read(1)? != 0 {
                mantissa = extra.read(23)?;
            }
            exponent = 255;
        } else {
            let mut shifted = 0;
            if exponent != 0 {
                while magnitude & 0x800000 == 0 {
                    exponent -= 1;
                    if exponent == 0 {
                        break;
                    }
                    magnitude = magnitude.wrapping_shl(1);
                    shifted += 1;
                }
            }
            shifted &= 31;
            if shifted != 0 {
                if flags & 1 != 0 || flags & 2 != 0 && extra.read(1)? != 0 {
                    magnitude |= (1u32 << shifted) - 1;
                } else if flags & 4 != 0 {
                    magnitude |= extra.read(shifted)?;
                }
            }
            mantissa = magnitude & 0x7fffff;
        }
    }
    *crc = crc
        .wrapping_mul(27)
        .wrapping_add(mantissa * 9 + exponent * 3 + sign);
    Ok(sign << 31 | exponent << 23 | mantissa)
}
fn decode_block(block: &[u8], limit: usize) -> Result<Vec<u64>, &'static str> {
    let count = word(block, 20) as usize;
    let flags = word(block, 24);
    if flags & (4 | 0x40000000) == 4 | 0x40000000 {
        return Err("Invalid WavPack channel flags");
    }
    if flags & (0x8 | 0x80000000) != 0 {
        return Err("Unsupported hybrid or DSD WavPack audio");
    }
    let mono = flags & (4 | 0x40000000) != 0;
    let channels = if mono { 1 } else { 2 };
    let parts = metadata(block)?;
    let terms = parts[2]
        .filter(|p| p.len() <= 16)
        .ok_or("Missing or invalid WavPack decoder metadata")?;
    let entropy = parts[5]
        .filter(|p| p.len() == channels * 6)
        .ok_or("Missing or invalid WavPack decoder metadata")?;
    let stream = parts[10].ok_or("Missing or invalid WavPack decoder metadata")?;
    let mut passes = Vec::with_capacity(terms.len());
    for &v in terms {
        let term = i32::from(v & 31) - 5;
        if term == 0 || !(-3..=18).contains(&term) || (9..=16).contains(&term) || mono && term < 0 {
            return Err("Invalid WavPack decorrelation term");
        }
        passes.push(Pass {
            term,
            delta: i32::from(v >> 5),
            weights: [0; 2],
            history: [[0; 8]; 2],
        });
    }
    if let Some(weights) = parts[3] {
        if weights.len() % channels != 0 || weights.len() > passes.len() * channels {
            return Err("Invalid WavPack weights");
        }
        for (i, &v) in weights.iter().enumerate() {
            let mut weight = i32::from(v as i8) * 8;
            if weight > 0 {
                weight += (weight + 64) >> 7;
            }
            passes[i / channels].weights[i % channels] = weight;
        }
    }
    if let Some(history) = parts[4] {
        let mut values = history.chunks_exact(2);
        if !values.remainder().is_empty() {
            return Err("Invalid WavPack history size");
        }
        for pass in &mut passes {
            if values.len() == 0 {
                break;
            }
            let mut read = || {
                let v = values.next().ok_or("Truncated WavPack history")?;
                Ok::<_, &'static str>(
                    exp2(i32::from(i16::from_le_bytes(v.try_into().unwrap())))? as i32
                )
            };
            if pass.term > 8 {
                for ch in 0..channels {
                    for j in 0..2 {
                        pass.history[ch][j] = read()?;
                    }
                }
            } else if pass.term < 0 {
                pass.history[0][0] = read()?;
                pass.history[1][0] = read()?;
            } else {
                for j in 0..pass.term as usize {
                    for ch in 0..channels {
                        pass.history[ch][j] = read()?;
                    }
                }
            }
        }
        if values.len() != 0 {
            return Err("Invalid WavPack history size");
        }
    }
    let mut reader = Entropy {
        bits: Bits {
            bytes: stream,
            pos: 0,
        },
        medians: [[0; 3]; 2],
        one: 0,
        zero: false,
        zeros: 0,
    };
    for ch in 0..channels {
        for j in 0..3 {
            let at = ch * 6 + j * 2;
            reader.medians[ch][j] = exp2(i32::from(u16::from_le_bytes(
                entropy[at..at + 2].try_into().unwrap(),
            )))?;
        }
    }
    let extended = if flags & 0x100 != 0 {
        parts[9]
            .filter(|p| p.len() == 4)
            .ok_or("Invalid WavPack extended integer metadata")?
    } else {
        &[0; 4]
    };
    let extra_bits = u32::from(extended[0]);
    if extra_bits > 31 {
        return Err("Invalid WavPack extended integer width");
    }
    if extended[1..].iter().any(|&v| v > 31) {
        return Err("Invalid WavPack integer shift");
    }
    let float = if flags & 0x80 != 0 {
        Some(
            parts[8]
                .filter(|p| p.len() == 4)
                .ok_or("Missing or invalid WavPack float metadata")?,
        )
    } else {
        None
    };
    let extra = parts[12];
    if float.is_some() && extra.is_some_and(|p| p.len() <= 4 || p.len() % 2 != 0) {
        return Err("Invalid WavPack float bitstream");
    }
    if extra_bits != 0
        && extra.is_none_or(|p| {
            p.len() as u64 * 8 < 32 + count as u64 * channels as u64 * u64::from(extra_bits)
        })
    {
        return Err("Missing or truncated WavPack extended integer bitstream");
    }
    let mut extra_reader = Bits {
        bytes: extra.unwrap_or_default(),
        pos: 32,
    };
    let out_channels = if flags & 0x40000000 != 0 { 2 } else { channels };
    let size = count
        .checked_mul(out_channels)
        .filter(|n| *n <= limit.saturating_sub(passes.capacity() * size_of::<Pass>()) / 8)
        .ok_or("WavPack exceeds memory budget")?;
    let mut output = Vec::new();
    output
        .try_reserve_exact(size)
        .map_err(|_| "WavPack exceeds memory budget")?;
    let (mut crc, mut extra_crc, mut float_crc) = (u32::MAX, u32::MAX, u32::MAX);
    let shift = (flags >> 13) & 31;
    let scale = 2f64.powi((((flags & 3) + 1) * 8 - 1) as i32);
    for i in 0..count {
        let mut values = [reader.word(0)?, if mono { 0 } else { reader.word(1)? }];
        for pass in passes.iter_mut().rev() {
            if pass.term > 0 {
                for ch in 0..channels {
                    let h = pass.history[ch];
                    let predicted = match pass.term {
                        17 => h[0].wrapping_mul(2).wrapping_sub(h[1]),
                        18 => h[0].wrapping_mul(3).wrapping_sub(h[1]) >> 1,
                        _ => h[i & 7],
                    };
                    pass.apply(&mut values, ch, predicted);
                    if pass.term > 8 {
                        pass.history[ch][1] = h[0];
                        pass.history[ch][0] = values[ch];
                    } else {
                        pass.history[ch][(i + pass.term as usize) & 7] = values[ch];
                    }
                }
            } else if pass.term == -1 {
                pass.apply(&mut values, 0, pass.history[0][0]);
                let v = values[0];
                pass.apply(&mut values, 1, v);
                pass.history[0][0] = values[1];
            } else if pass.term == -2 {
                pass.apply(&mut values, 1, pass.history[1][0]);
                let v = values[1];
                pass.apply(&mut values, 0, v);
                pass.history[1][0] = values[0];
            } else {
                pass.apply(&mut values, 0, pass.history[0][0]);
                pass.apply(&mut values, 1, pass.history[1][0]);
                pass.history[0][0] = values[1];
                pass.history[1][0] = values[0];
            }
        }
        if !mono && flags & 0x10 != 0 {
            values[1] = values[1].wrapping_sub(values[0] >> 1);
            values[0] = values[0].wrapping_add(values[1]);
        }
        for &value in &values[..channels] {
            crc = crc.wrapping_mul(3).wrapping_add(value as u32);
            let mut value = value;
            if extra_bits != 0 {
                value = value.wrapping_shl(extra_bits) | extra_reader.read(extra_bits)? as i32;
                extra_crc = extra_crc
                    .wrapping_mul(9)
                    .wrapping_add((value as u32 & 0xffff) * 3 + (value as u32 >> 16));
            }
            let (zeros, ones, dups) = (
                u32::from(extended[1]),
                u32::from(extended[2]),
                u32::from(extended[3]),
            );
            if zeros != 0 {
                value = value.wrapping_shl(zeros);
            } else if ones != 0 {
                value = value.wrapping_add(1).wrapping_shl(ones).wrapping_sub(1);
            } else if dups != 0 {
                value = value
                    .wrapping_add(value & 1)
                    .wrapping_shl(dups)
                    .wrapping_sub(value & 1);
            }
            // Keep float32 words intact: promoting a signaling NaN changes its bits.
            let sample = if let Some(info) = float {
                u64::from(float_sample(value, info, &mut extra_reader, &mut float_crc)?)
            } else {
                (f64::from(value.wrapping_shl(shift)) / scale).to_bits()
            };
            output.push(sample);
            if flags & 0x40000000 != 0 {
                output.push(sample);
            }
        }
    }
    if crc != word(block, 28) {
        return Err("WavPack audio checksum mismatch");
    }
    if float.is_some() && extra.is_some_and(|e| word(e, 0) != float_crc) {
        return Err("WavPack float checksum mismatch");
    }
    if extra_bits != 0 && word(extra.unwrap(), 0) != extra_crc {
        return Err("WavPack extended integer checksum mismatch");
    }
    Ok(output)
}

pub(super) struct Packet<'a> {
    pub data: &'a [u8],
    pub pts: u32,
    pub frames: u32,
}
pub(super) struct Document<'a> {
    data: &'a [u8],
    pub rate: u32,
    pub channels: u32,
    pub channel_mask: u32,
    pub bits: u32,
    pub frames: u32,
    pub tags: Vec<(String, String)>,
    pub packets: Vec<Packet<'a>>,
    pub floating: bool,
    memory_bytes: usize,
}
impl<'a> Document<'a> {
    pub fn read(bytes: &'a [u8], limit: usize) -> Result<Self, &'static str> {
        if bytes.len() > limit {
            return Err("input byte limit exceeded");
        }
        let mut doc = Self {
            data: &[],
            rate: 0,
            channels: 0,
            channel_mask: 0,
            bits: 0,
            frames: 0,
            tags: Vec::new(),
            packets: Vec::new(),
            floating: false,
            memory_bytes: 0,
        };
        let mut remaining = limit;
        let mut audio_end = bytes.len();
        if bytes.len() >= 32 && &bytes[bytes.len() - 32..bytes.len() - 24] == b"APETAGEX" {
            let footer = bytes.len() - 32;
            let size = word(bytes, footer + 12) as usize;
            let count = word(bytes, footer + 16);
            if size < 32 || size > bytes.len() {
                return Err("Invalid APE tag size");
            }
            let mut pos = bytes.len() - size;
            audio_end = pos;
            if pos >= 32 && &bytes[pos - 32..pos - 24] == b"APETAGEX" {
                audio_end -= 32;
            }
            for _ in 0..count {
                if footer.saturating_sub(pos) < 8 {
                    return Err("Truncated APE tag item");
                }
                let length = word(bytes, pos) as usize;
                let flags = word(bytes, pos + 4);
                pos += 8;
                let key_end = bytes[pos..footer]
                    .iter()
                    .position(|&b| b == 0)
                    .map(|n| pos + n)
                    .ok_or("Invalid APE tag item")?;
                if length > footer - key_end - 1 {
                    return Err("Invalid APE tag item");
                }
                if flags & 6 == 0 {
                    let used = (key_end - pos + length)
                        .saturating_mul(3)
                        .saturating_add(size_of::<(String, String)>());
                    remaining = remaining
                        .checked_sub(used)
                        .ok_or("WavPack metadata exceeds memory budget")?;
                    let key = String::from_utf8_lossy(&bytes[pos..key_end]).into_owned();
                    let value = String::from_utf8_lossy(&bytes[key_end + 1..key_end + 1 + length])
                        .into_owned();
                    if let Some(index) = doc
                        .tags
                        .iter()
                        .position(|(k, _)| k.eq_ignore_ascii_case(&key))
                    {
                        doc.tags.swap_remove(index);
                    }
                    doc.tags
                        .try_reserve_exact(1)
                        .map_err(|_| "WavPack metadata exceeds memory budget")?;
                    doc.tags.push((key, value));
                }
                pos = key_end + 1 + length;
            }
        }
        let mut at = 0;
        let mut version = 0;
        let mut group: Option<(usize, u32, u32)> = None;
        while at < audio_end {
            if bytes.get(at..at + 4) == Some(b"APET") || bytes.get(at..at + 3) == Some(b"TAG") {
                break;
            }
            if audio_end - at < 32 || &bytes[at..at + 4] != b"wvpk" {
                return Err("Invalid WavPack block header");
            }
            let size: usize = (u64::from(word(bytes, at + 4)) + 8)
                .try_into()
                .map_err(|_| "Invalid WavPack block size or version")?;
            let block_version = u16::from_le_bytes(bytes[at + 8..at + 10].try_into().unwrap());
            if size < 32 || size > audio_end - at || !(0x402..=0x410).contains(&block_version) {
                return Err("Invalid WavPack block size or version");
            }
            let block = &bytes[at..at + size];
            let parts = metadata(block)?;
            let count = word(block, 20);
            let flags = word(block, 24);
            if count != 0 {
                if flags & 0x800 != 0 {
                    if group.is_some() {
                        return Err("Inconsistent WavPack block group start");
                    }
                    group = Some((at, count, 0));
                }
                let current = group
                    .as_mut()
                    .filter(|(_, n, _)| *n == count)
                    .ok_or("Inconsistent WavPack block group")?;
                let rate = RATES
                    .get(((flags >> 23) & 15) as usize)
                    .copied()
                    .unwrap_or_else(|| {
                        parts[0x27].filter(|p| p.len() == 3).map_or(0, |p| {
                            u32::from(p[0]) | u32::from(p[1]) << 8 | u32::from(p[2]) << 16
                        })
                    });
                let bits = ((flags & 3) + 1) * 8;
                // Copies retain source indices; only blocks in the same group must agree.
                if rate == 0
                    || word(block, 16) != word(bytes, current.0 + 16)
                    || doc.rate != 0
                        && (doc.rate != rate
                            || doc.bits != bits
                            || block_version != version
                            || doc.floating != (flags & 0x80 != 0))
                {
                    return Err("Inconsistent WavPack audio blocks");
                }
                doc.rate = rate;
                doc.bits = bits;
                version = block_version;
                doc.floating = flags & 0x80 != 0;
                if let Some(info) = parts[0x0d] {
                    if !(2..=7).contains(&info.len()) {
                        return Err("Invalid WavPack channel information");
                    }
                    let channels = if info.len() < 6 {
                        u32::from(info[0])
                    } else {
                        1 + u32::from(info[0]) + (u32::from(info[2] & 15) << 8)
                    };
                    if channels == 0 || doc.channels != 0 && doc.channels != channels {
                        return Err("Inconsistent WavPack channel count");
                    }
                    doc.channels = channels;
                    let mask = if info.len() < 6 {
                        &info[1..]
                    } else {
                        &info[3..]
                    };
                    doc.channel_mask = mask
                        .iter()
                        .enumerate()
                        .fold(0, |mask, (i, &b)| mask | u32::from(b) << (i * 8));
                }
                current.2 = current
                    .2
                    .checked_add(if flags & 4 != 0 { 1 } else { 2 })
                    .filter(|n| *n <= 4096)
                    .ok_or("Invalid WavPack channel count")?;
                if doc.channels != 0 && current.2 > doc.channels {
                    return Err("Inconsistent WavPack channel count");
                }
                if flags & 0x1000 != 0 {
                    if doc.channels != 0 && current.2 != doc.channels {
                        return Err("Inconsistent WavPack channel count");
                    }
                    doc.channels = current.2;
                    remaining = remaining
                        .checked_sub(size_of::<Packet>())
                        .ok_or("WavPack packets exceed memory budget")?;
                    doc.packets
                        .try_reserve_exact(1)
                        .map_err(|_| "WavPack packets exceed memory budget")?;
                    doc.packets.push(Packet {
                        data: &bytes[current.0..at + size],
                        pts: doc.frames,
                        frames: count,
                    });
                    doc.frames = doc
                        .frames
                        .checked_add(count)
                        .ok_or("Invalid WavPack sample count")?;
                    group = None;
                }
            }
            at += size;
        }
        if group.is_some() {
            return Err("Incomplete WavPack block group");
        }
        if doc.packets.is_empty() {
            return Err("WavPack input has no audio blocks");
        }
        // Native demuxing skips metadata before the first audio block, but full
        // copies retain metadata blocks between and after the audio packets.
        let start = doc.packets[0].data.as_ptr() as usize - bytes.as_ptr() as usize;
        doc.data = &bytes[start..at];
        doc.memory_bytes = limit - remaining;
        Ok(doc)
    }
    pub(super) fn channel_layout(&self) -> Option<&'static str> {
        let mask = match self.channels {
            1 => 4,
            2 => 3,
            _ => self.channel_mask,
        };
        super::audio_remix::layout_name(mask)
    }
    pub fn decode(&self, limit: usize, format: Format) -> Result<Vec<u8>, &'static str> {
        let limit = limit
            .checked_sub(self.memory_bytes)
            .ok_or("WavPack exceeds memory budget")?;
        let width=usize::from(format.bits()/8);
        let size = (self.frames as usize)
            .checked_mul(self.channels as usize)
            .and_then(|n| n.checked_mul(width))
            .filter(|&n| n <= limit)
            .ok_or("WavPack exceeds memory budget")?;
        let mut out = Vec::new();
        out.try_reserve_exact(size)
            .map_err(|_| "WavPack exceeds memory budget")?;
        out.resize(size, 0);
        for packet in &self.packets {
            let mut pos = 0;
            let mut channel = 0;
            while pos < packet.data.len() {
                let block = &packet.data[pos..];
                let size = word(block, 4) as usize + 8;
                if word(block, 20) != 0 {
                    let decoded =
                        decode_block(&block[..size], limit.saturating_sub(out.capacity()))?;
                    let channels = if word(block, 24) & 4 != 0 { 1 } else { 2 };
                    if channel + channels > self.channels as usize {
                        return Err("Inconsistent WavPack channel count");
                    }
                    for (i, value) in decoded.iter().enumerate() {
                        let offset = ((packet.pts as usize + i / channels)
                            * self.channels as usize
                            + channel
                            + i % channels)
                            * width;
                        if self.floating {
                            format.convert(Format::Float(32,false),&(*value as u32).to_le_bytes(),false,&mut out[offset..offset+width]);
                        } else {
                            format.write_float(f64::from_bits(*value),&mut out[offset..offset+width]);
                        }
                    }
                    channel += channels;
                }
                pos += size;
            }
        }
        Ok(out)
    }
    pub fn render(&self, seek: InputTime, opts: &Remux) -> Result<Vec<u8>, String> {
        if opts.audio_codec == Some("copy") {
            if opts.format != "wv" {
                return Err("WavPack packet copy to this container is not supported".into());
            }
            let clock = |v: f64| (v.max(0.) * f64::from(self.rate)).round() as u64;
            let start = seek.start.map_or(0, clock);
            let end = seek.end().map_or(u64::MAX, clock);
            let from = opts.start.map_or(0, clock);
            let until = opts.end.map_or(u64::MAX, clock);
            let copies = seek
                .loops
                .checked_add(1)
                .ok_or("WavPack packet traversal exceeds memory budget")?;
            copies
                .checked_mul(self.packets.len())
                .filter(|n| *n <= opts.limit / size_of::<Packet>())
                .ok_or("WavPack packet traversal exceeds memory budget")?;
            let mut base = 0u64;
            let mut frames = 0u32;
            let mut out = Vec::new();
            let full = [Packet {
                data: self.data,
                pts: 0,
                frames: self.frames,
            }];
            let packets = if copies == 1
                && seek.start.is_none()
                && seek.end().is_none()
                && from == 0
                && opts.end.is_none()
            {
                &full[..]
            } else {
                &self.packets
            };
            for _ in 0..copies {
                for p in packets {
                    if u64::from(p.pts) + u64::from(p.frames) <= start || u64::from(p.pts) >= end {
                        continue;
                    }
                    let tick = base.saturating_add(u64::from(p.pts));
                    if (opts.start.is_none() || tick >= start.saturating_add(from))
                        && tick < start.saturating_add(until)
                    {
                        if p.data.len()
                            > opts
                                .limit
                                .saturating_sub(self.memory_bytes)
                                .saturating_sub(out.len())
                        {
                            return Err("WavPack output exceeds memory budget".into());
                        }
                        out.try_reserve_exact(p.data.len())
                            .map_err(|_| "WavPack output exceeds memory budget")?;
                        out.extend_from_slice(p.data);
                        frames = frames
                            .checked_add(p.frames)
                            .ok_or("WavPack sample count exceeds limit")?;
                    }
                }
                base = base.saturating_add(u64::from(self.frames));
            }
            finish(
                &mut out,
                frames,
                &self.tags,
                &Remux {
                    hls: None,
                    concat: None,
                    limit: opts.limit.saturating_sub(self.memory_bytes),
                    ..*opts
                },
            )?;
            return Ok(out);
        }
        if opts.format == "wv" {
            return Err("WavPack encoding is not supported".into());
        }
        let format=if self.floating {Format::Float(32,false)} else {Format::Signed(if self.bits<=16 {16} else {32},false)};
        let pcm = self.decode(opts.limit,format)?;
        let mut tags = if opts.strip_metadata {
            Vec::new()
        } else {
            self.tags
                .iter()
                .filter(|(k, _)| opts.format != "wav" || k != "encoder")
                .cloned()
                .collect()
        };
        if opts.format == "wav" && !opts.bitexact {
            tags.push(("encoder".into(), "Lavf61.7.100".into()));
        }
        tags.extend_from_slice(opts.metadata);
        let mut wave = Wave::raw(format, &pcm, self.rate, self.channels)?;
        wave.channel_mask=if self.channels>2 {self.channel_mask} else {super::audio_remix::default_mask(self.channels as usize)};
        Input::Wave(wave).render(
            seek,
            &Remux {
                metadata: &tags,
                hls: None,
                concat: None,
                limit: opts
                    .limit
                    .saturating_sub(self.memory_bytes)
                    .saturating_sub(pcm.capacity()),
                ..*opts
            },
        )
    }
}

impl Document<'_> {
    pub fn report(
        &self,
        filename: &str,
        bytes: &[u8],
        score: u8,
        mut opts: super::media_probe::ProbeOptions<'_>,
    ) -> Result<String, &'static str> {
        use super::super::structured::JVal::{Number, Object, Str};
        use super::media_probe::{format_row, report, selected};
        let counts = (
            opts.counts.0 || opts.show.contains("frame"),
            opts.counts.1 || opts.show.contains("packet"),
        );
        if opts.show.contains("frame") && opts.show.contains("packet") {
            opts.show.remove("frame");
            opts.show.remove("packet");
            opts.show.insert("packet_frame");
        }
        let optional = !matches!(opts.writer, "json" | "xml");
        let enabled = selected(opts.select, "audio", 0, 0);
        let total = word(bytes, 12);
        let duration = f64::from(total) / f64::from(self.rate);
        let micros = (duration * 1_000_000.).round() as u64;
        let sample_fmt = if self.floating {
            "fltp"
        } else if self.bits <= 16 {
            "s16p"
        } else {
            "s32p"
        };
        let layout = self.channel_layout().map(str::to_owned).or_else(|| {
            if self.channel_mask == 0 {
                return None;
            }
            let names = [
                "FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC", "BC", "SL", "SR", "TC", "TFL",
                "TFC", "TFR", "TBL", "TBC", "TBR",
            ];
            let speakers = (0..32)
                .filter(|&bit| self.channel_mask & (1 << bit) != 0)
                .map(|bit| match bit {
                    29 => "DL".into(),
                    30 => "DR".into(),
                    31 => "WL".into(),
                    _ => names
                        .get(bit)
                        .map_or_else(|| format!("USR{bit}"), |name| (*name).to_owned()),
                })
                .collect::<Vec<_>>();
            Some(format!(
                "{} channels ({})",
                self.channels,
                speakers.join("+")
            ))
        });
        let pipe = matches!(filename, "-" | "pipe:" | "pipe:0");
        // Metadata-only blocks after the initial audio header are demuxed packets,
        // but produce no decoded frames. Retain their real byte positions.
        let packets = || {
            let mut audio = self.packets.iter().peekable();
            let mut at = self.packets[0].data.as_ptr() as usize - bytes.as_ptr() as usize;
            std::iter::from_fn(move || {
                if bytes.get(at..at + 4) != Some(b"wvpk") {
                    return None;
                }
                let size = if audio
                    .peek()
                    .is_some_and(|p| p.data.as_ptr() == bytes[at..].as_ptr())
                {
                    audio.next().unwrap().data.len()
                } else {
                    word(bytes, at + 4) as usize + 8
                };
                let packet = &bytes[at..at + size];
                at += size;
                Some(packet)
            })
        };
        report(opts, |section| match section {
            "stream" if enabled => {
                let mut disposition = super::media_probe::disposition(false);
                disposition.extend(
                    [
                        "non_diegetic",
                        "captions",
                        "descriptions",
                        "metadata",
                        "dependent",
                        "still_image",
                    ]
                    .map(|key| (key.into(), Number(0., None))),
                );
                let mut row = vec![
                    ("index", Number(0., None)),
                    ("codec_name", Str("wavpack".into())),
                    ("codec_long_name", Str("WavPack".into())),
                    ("codec_type", Str("audio".into())),
                    ("codec_tag_string", Str("[0][0][0][0]".into())),
                    ("codec_tag", Str("0x0000".into())),
                    ("sample_fmt", Str(sample_fmt.into())),
                    ("sample_rate", Str(self.rate.to_string())),
                    ("channels", Number(f64::from(self.channels), None)),
                    ("bits_per_sample", Number(0., None)),
                    ("initial_padding", Number(0., None)),
                    ("r_frame_rate", Str("0/0".into())),
                    ("avg_frame_rate", Str("0/0".into())),
                    ("time_base", Str(format!("1/{}", self.rate))),
                    ("start_pts", Number(0., None)),
                    ("start_time", Str("0.000000".into())),
                ];
                if let Some(layout) = &layout {
                    row.insert(9, ("channel_layout", Str(layout.clone())));
                } else if optional {
                    row.insert(9, ("channel_layout", Str("unknown".into())));
                }
                if optional {
                    row.insert(3, ("profile", Str("unknown".into())));
                    let at = row
                        .iter()
                        .position(|(key, _)| *key == "r_frame_rate")
                        .unwrap();
                    row.insert(at, ("id", Str("N/A".into())));
                }
                if total != u32::MAX {
                    row.push(("duration_ts", Number(f64::from(total), None)));
                    row.push(("duration", Str(format!("{duration:.6}"))));
                } else if optional {
                    row.push(("duration_ts", Str("N/A".into())));
                    row.push(("duration", Str("N/A".into())));
                }
                if optional {
                    row.push(("bit_rate", Str("N/A".into())));
                    row.push(("max_bit_rate", Str("N/A".into())));
                }
                row.push(("bits_per_raw_sample", Str(self.bits.to_string())));
                if optional {
                    row.push(("nb_frames", Str("N/A".into())));
                }
                if counts.0 {
                    row.push(("nb_read_frames", Str(self.packets.len().to_string())));
                } else if optional {
                    row.push(("nb_read_frames", Str("N/A".into())));
                }
                if counts.1 {
                    row.push(("nb_read_packets", Str(packets().count().to_string())));
                } else if optional {
                    row.push(("nb_read_packets", Str("N/A".into())));
                }
                row.push(("extradata_size", Number(2., None)));
                row.push(("disposition", Object(disposition)));
                Box::new(std::iter::once(row))
            }
            "format" => {
                let mut row = format_row(
                    if filename == "-" { "fd:" } else { filename },
                    bytes.len(),
                    ("wv", "WavPack"),
                    1,
                    duration,
                    self.tags
                        .iter()
                        .filter(|_| !pipe)
                        .map(|(k, v)| (k.clone(), Str(v.clone())))
                        .collect(),
                );
                row.insert(3, ("nb_stream_groups", Number(0., None)));
                row.retain_mut(|(key, value)| {
                    let known = match *key {
                        "size" => !pipe || filename == "-",
                        "bit_rate" => !pipe && micros != 0 && total != u32::MAX,
                        "duration" => micros != 0 && total != u32::MAX,
                        "tags" => return !pipe && !self.tags.is_empty(),
                        _ => true,
                    };
                    if !known {
                        *value = Str("N/A".into());
                        return optional;
                    }
                    if *key == "size" && filename == "-" {
                        *value = Str("0".into());
                    }
                    if *key == "bit_rate" {
                        *value =
                            Str((bytes.len() as u128 * 8_000_000 / u128::from(micros)).to_string());
                    }
                    if *key == "probe_score" {
                        *value = Number(f64::from(score), None);
                    }
                    true
                });
                Box::new(std::iter::once(row))
            }
            "packet" | "frame" | "packet_frame" if enabled => {
                let combined = section == "packet_frame";
                let layout = &layout;
                Box::new(packets().flat_map(move |p| {
                    (0..if combined { 2 } else { 1 }).filter_map(move |index| {
                        let frame = section == "frame" || combined && index == 1;
                        let frames = word(p, 20);
                        if frame && frames == 0 {
                            return None;
                        }
                        let pts = word(p, 16);
                        let pos = p.as_ptr() as usize - bytes.as_ptr() as usize;
                        let time = format!("{:.6}", f64::from(pts) / f64::from(self.rate));
                        let duration = format!("{:.6}", f64::from(frames) / f64::from(self.rate));
                        let mut row = if frame {
                            vec![
                                ("media_type", Str("audio".into())),
                                ("stream_index", Number(0., None)),
                                ("key_frame", Number(1., None)),
                                ("pts", Number(f64::from(pts), None)),
                                ("pts_time", Str(time.clone())),
                                ("pkt_dts", Number(f64::from(pts), None)),
                                ("pkt_dts_time", Str(time.clone())),
                                ("best_effort_timestamp", Number(f64::from(pts), None)),
                                ("best_effort_timestamp_time", Str(time)),
                                ("duration", Number(f64::from(frames), None)),
                                ("duration_time", Str(duration)),
                                ("pkt_pos", Str(pos.to_string())),
                                ("pkt_size", Str(p.len().to_string())),
                                ("sample_fmt", Str(sample_fmt.into())),
                                ("nb_samples", Number(f64::from(frames), None)),
                                ("channels", Number(f64::from(self.channels), None)),
                            ]
                        } else {
                            vec![
                                ("codec_type", Str("audio".into())),
                                ("stream_index", Number(0., None)),
                                ("pts", Number(f64::from(pts), None)),
                                ("pts_time", Str(time.clone())),
                                ("dts", Number(f64::from(pts), None)),
                                ("dts_time", Str(time)),
                                ("duration", Number(f64::from(frames), None)),
                                ("duration_time", Str(duration)),
                                ("size", Str(p.len().to_string())),
                                ("pos", Str(pos.to_string())),
                                ("flags", Str("K__".into())),
                            ]
                        };
                        if frames == 0 {
                            row.retain_mut(|(key, value)| {
                                if !matches!(*key, "duration" | "duration_time") {
                                    return true;
                                }
                                *value = Str("N/A".into());
                                optional
                            });
                        }
                        if frame {
                            if let Some(layout) = &layout {
                                row.push(("channel_layout", Str(layout.clone())));
                            } else if optional {
                                row.push(("channel_layout", Str("unknown".into())));
                            }
                        }
                        if combined {
                            row.insert(
                                0,
                                ("type", Str(if frame { "frame" } else { "packet" }.into())),
                            );
                        }
                        Some(row)
                    })
                }))
            }
            _ => Box::new(std::iter::empty()),
        })
    }
}

struct BitWriter<'a> {
    bytes: &'a mut [u8],
    pos: usize,
}
impl BitWriter<'_> {
    fn write(&mut self, value: u32, width: u32) -> Result<(), &'static str> {
        if width > 32
            || self.bytes.len().saturating_mul(8).saturating_sub(self.pos) < width as usize
        {
            return Err("WavPack encoding exceeds memory budget");
        }
        for i in 0..width {
            self.bytes[self.pos / 8] |= (((value >> i) & 1) as u8) << (self.pos % 8);
            self.pos += 1;
        }
        Ok(())
    }
    fn unary(&mut self, value: u32) -> Result<(), &'static str> {
        for _ in 0..value {
            self.write(1, 1)?;
        }
        self.write(0, 1)
    }
    fn gamma(&mut self, value: u32) -> Result<(), &'static str> {
        let width = 32 - value.leading_zeros();
        self.unary(width)?;
        if width > 1 {
            self.write(value - (1 << (width - 1)), width - 1)?;
        }
        Ok(())
    }
}
fn float_integer(word: u32, max_exp: u32) -> i32 {
    let exponent = (word >> 23) & 255;
    let magnitude = if exponent == 255 {
        0x1000000
    } else {
        let mantissa = (word & 0x7fffff) | if exponent != 0 { 0x800000 } else { 0 };
        let shift = max_exp.saturating_sub(exponent.max(1));
        mantissa.checked_shr(shift).unwrap_or(0)
    };
    if word >> 31 != 0 {
        -(magnitude as i32)
    } else {
        magnitude as i32
    }
}

pub(super) fn encode(
    wave: Wave<'_>,
    source_bits: u16,
    limit: usize,
) -> Result<Vec<Vec<u8>>, &'static str> {
    if wave.channels == 0 || wave.channels > 64 {
        return Err("Invalid WavPack channel count");
    }
    let floating = matches!(wave.format(), Format::Float(..));
    if source_bits > 32 && !floating {
        return Err("WavPack encoding supports integer PCM up to 32 bits");
    }
    if wave.rate == 0 || wave.rate > 0xffffff {
        return Err("Invalid WavPack sample rate");
    }
    let bits = if source_bits > 16 { 24 } else { 16 };
    let stored_bits = if floating || source_bits > 24 {
        32
    } else {
        bits
    };
    let extended = stored_bits == 32 && !floating;
    let groups = wave.channels.div_ceil(2);
    let channel_info =
        wave.channels > 2 || !matches!((wave.channels, wave.channel_mask), (1, 0 | 4) | (2, 0 | 3));
    let info_size = if channel_info { 8 } else { 0 };
    let frames = wave.data.len() / wave.stride();
    if frames > u32::MAX as usize || frames.div_ceil(256) > limit / size_of::<Vec<u8>>() {
        return Err("WavPack encoding exceeds memory budget");
    }
    let mut packets = Vec::new();
    packets
        .try_reserve_exact(frames.div_ceil(256))
        .map_err(|_| "WavPack encoding exceeds memory budget")?;
    let mut remaining = limit - packets.capacity() * size_of::<Vec<u8>>();
    let rate_index = RATES.iter().position(|&r| r == wave.rate).unwrap_or(15);
    let scale = 1i64 << (stored_bits - 1);
    let format = wave.format();
    let sample_bytes = usize::from(wave.bits / 8);
    for start in (0..frames).step_by(256) {
        let count = (frames - start).min(256);
        let overhead = 64 + usize::from(stored_bits == 32) * 16;
        let capacity =
            groups * overhead + info_size + (count * wave.channels * (bits + 80)).div_ceil(8);
        if capacity > remaining {
            return Err("WavPack encoding exceeds memory budget");
        }
        let mut packet = vec![0u8; capacity];
        let mut packet_length = 0;
        for first_channel in (0..wave.channels).step_by(2) {
            let channels = (wave.channels - first_channel).min(2);
            let capacity = overhead
                + if first_channel == 0 { info_size } else { 0 }
                + (count * channels * (bits + 80)).div_ceil(8);
            let float_word = |index: usize| {
                let at = (start + index / channels) * wave.stride()
                    + (first_channel + index % channels) * sample_bytes;
                let data = &wave.data[at..at + sample_bytes];
                match format {
                    Format::Float(32, true) => u32::from_be_bytes(data.try_into().unwrap()),
                    Format::Float(32, false) => u32::from_le_bytes(data.try_into().unwrap()),
                    _ => (format.sample(data) as f32).to_bits(),
                }
            };
            let maximum = if floating {
                (0..count * channels)
                    .map(float_word)
                    .map(|v| v & 0x7fffffff)
                    .filter(|&v| v >> 23 < 255)
                    .max()
                    .unwrap_or(0)
            } else {
                0
            };
            let max_exp = if maximum >> 23 != 0 {
                (maximum + 0x7f0000) >> 23
            } else {
                0
            };
            let buffer = &mut packet[packet_length..packet_length + capacity];
            buffer[..4].copy_from_slice(b"wvpk");
            buffer[8..10].copy_from_slice(&0x410u16.to_le_bytes());
            buffer[12..16].copy_from_slice(&(frames as u32).to_le_bytes());
            buffer[16..20].copy_from_slice(&(start as u32).to_le_bytes());
            buffer[20..24].copy_from_slice(&(count as u32).to_le_bytes());
            let flags = (stored_bits as u32 / 8 - 1)
                | if floating {
                    0x80
                } else if extended {
                    0x100
                } else {
                    0
                }
                | if channels == 1 { 4 } else { 0 }
                | if first_channel == 0 { 0x800 } else { 0 }
                | if first_channel + channels == wave.channels {
                    0x1000
                } else {
                    0
                }
                | ((if floating { 25 } else { bits as u32 - 1 }) << 18)
                | ((rate_index as u32) << 23);
            buffer[24..28].copy_from_slice(&flags.to_le_bytes());
            buffer[32..42].copy_from_slice(&[0x42, 1, 6, 0, 3, 0, 4, 0, 5, (channels * 3) as u8]);
            let mut offset = 42;
            for _ in 0..channels * 3 {
                buffer[offset..offset + 2]
                    .copy_from_slice(&(((bits + 4) * 256) as u16).to_le_bytes());
                offset += 2;
            }
            if rate_index == 15 {
                buffer[offset..offset + 6].copy_from_slice(&[
                    0x67,
                    2,
                    wave.rate as u8,
                    (wave.rate >> 8) as u8,
                    (wave.rate >> 16) as u8,
                    0,
                ]);
                offset += 6;
            }
            if floating {
                // Send shifted bits, false/negative zeros and exceptional values literally.
                buffer[offset..offset + 6].copy_from_slice(&[8, 2, 0x3c, 0, max_exp as u8, 127]);
                offset += 6;
            } else if extended {
                buffer[offset..offset + 6].copy_from_slice(&[9, 2, 8, 0, 0, 0]);
                offset += 6;
            }
            if first_channel == 0 && channel_info {
                buffer[offset] = 0x4d;
                buffer[offset + 1] = ((info_size - 2) / 2) as u8;
                buffer[offset + 2] = wave.channels as u8;
                let at = offset + info_size - 5;
                buffer[at..at + 4].copy_from_slice(&wave.channel_mask.to_le_bytes());
                offset += info_size;
            }
            let header = offset;
            buffer[header] = 0x8a;
            offset += 4;
            let mut writer = BitWriter {
                bytes: buffer,
                pos: offset * 8,
            };
            let mut medians = [[1u32 << (bits + 3); 3]; 2];
            let mut crc = u32::MAX;
            let integer = |index: usize| {
                if floating {
                    return float_integer(float_word(index), max_exp);
                }
                let at = (start + index / channels) * wave.stride()
                    + (first_channel + index % channels) * sample_bytes;
                (format.sample(&wave.data[at..]) * scale as f64)
                    .round_ties_even()
                    .clamp(-(scale as f64), (scale - 1) as f64) as i32
            };
            let mut residual = |index: usize| {
                let ch = index % channels;
                let value = integer(index) >> if extended { 8 } else { 0 };
                crc = crc.wrapping_mul(3).wrapping_add(value as u32);
                let magnitude = if value < 0 {
                    !value as u32
                } else {
                    value as u32
                };
                let (mut low, mut high, mut ones) = (0, 0, 0);
                for j in 0..3 {
                    let median = &mut medians[ch][j];
                    let width = *median / 16 + 1;
                    let divisor = 128 >> j;
                    if magnitude < low + width {
                        high = low + width - 1;
                        *median -= ((*median + divisor - 2) / divisor) * 2;
                        break;
                    }
                    let steps = if j == 2 { (magnitude - low) / width } else { 1 };
                    ones += steps;
                    low += width * steps;
                    high = low + width - 1;
                    *median += ((*median + divisor) / divisor) * 5;
                }
                (ones, magnitude - low, high - low, u32::from(value < 0))
            };
            let mut current = residual(0);
            let (mut one, mut zero) = (0, false);
            for i in 0..count * channels {
                let next = (i + 1 < count * channels).then(|| residual(i + 1));
                let (ones, code, max, sign) = current;
                if zero {
                    zero = false;
                } else {
                    let next_one = u32::from(next.is_some_and(|n| n.0 > 0));
                    let unary = 2 * (ones - one) + next_one;
                    writer.unary(unary.min(16))?;
                    if unary >= 16 {
                        writer.gamma(unary - 16)?;
                    }
                    one = next_one;
                    zero = next_one == 0;
                }
                let width = 32 - max.leading_zeros();
                let extras = (1u32 << width) - max - 1;
                if width != 0 {
                    if code < extras {
                        writer.write(code, width - 1)?;
                    } else {
                        writer.write((code + extras) / 2, width - 1)?;
                        writer.write((code + extras) & 1, 1)?;
                    }
                }
                writer.write(sign, 1)?;
                if let Some(next) = next {
                    current = next;
                }
            }
            while writer.pos % 16 != 0 {
                writer.write(1, 1)?;
            }
            let mut length = writer.pos / 8;
            let words = (length - offset) / 2;
            buffer[header + 1] = words as u8;
            buffer[header + 2] = (words >> 8) as u8;
            buffer[header + 3] = (words >> 16) as u8;
            if floating {
                let header = length;
                let mut writer = BitWriter {
                    bytes: buffer,
                    pos: (header + 8) * 8,
                };
                let mut extra_crc = u32::MAX;
                for i in 0..count * channels {
                    let word = float_word(i);
                    let exponent = (word >> 23) & 255;
                    let mantissa = word & 0x7fffff;
                    let sign = word >> 31;
                    extra_crc = extra_crc
                        .wrapping_mul(27)
                        .wrapping_add(mantissa * 9 + exponent * 3 + sign);
                    if exponent == 255 {
                        writer.write(u32::from(mantissa != 0), 1)?;
                        if mantissa != 0 {
                            writer.write(mantissa, 23)?;
                        }
                    } else if float_integer(word, max_exp) == 0 {
                        writer.write(u32::from(word & 0x7fffffff != 0), 1)?;
                        if word & 0x7fffffff != 0 {
                            writer.write(mantissa, 23)?;
                            if max_exp >= 25 {
                                writer.write(exponent, 8)?;
                            }
                        }
                        writer.write(sign, 1)?;
                    } else {
                        let shift = max_exp.saturating_sub(exponent.max(1));
                        if shift != 0 {
                            writer.write(mantissa, shift)?;
                        }
                    }
                }
                if writer.pos == (header + 8) * 8 {
                    writer.write(0xffff, 16)?;
                }
                while writer.pos % 16 != 0 {
                    writer.write(1, 1)?;
                }
                length = writer.pos / 8;
                let words = (length - header - 4) / 2;
                buffer[header..header + 4].copy_from_slice(&[
                    0x8c,
                    words as u8,
                    (words >> 8) as u8,
                    (words >> 16) as u8,
                ]);
                buffer[header + 4..header + 8].copy_from_slice(&extra_crc.to_le_bytes());
            } else if extended {
                let samples = count * channels;
                let words = (4 + samples).div_ceil(2);
                buffer[length..length + 4].copy_from_slice(&[
                    0x8c,
                    words as u8,
                    (words >> 8) as u8,
                    (words >> 16) as u8,
                ]);
                let mut extra_crc = u32::MAX;
                for i in 0..samples {
                    let value = integer(i) as u32;
                    buffer[length + 8 + i] = value as u8;
                    extra_crc = extra_crc
                        .wrapping_mul(9)
                        .wrapping_add((value & 0xffff) * 3 + (value >> 16));
                }
                buffer[length + 4..length + 8].copy_from_slice(&extra_crc.to_le_bytes());
                length += 4 + words * 2;
            }
            buffer[4..8].copy_from_slice(&((length - 8) as u32).to_le_bytes());
            buffer[28..32].copy_from_slice(&crc.to_le_bytes());
            packet_length += length;
        }
        remaining -= packet.capacity();
        packet.truncate(packet_length);
        packets.push(packet);
    }
    Ok(packets)
}

#[cfg(test)]
mod tests {
    use super::*;
    const LIMIT: usize = 1024 * 1024;
    #[test]
    fn multichannel_encoding_accounts_for_all_blocks_and_bounds_channel_count() {
        let input = vec![0; 64 * 2 * 259];
        let wave = Wave::raw(Format::Signed(16, false), &input, 8000, 64).unwrap();
        assert!(encode(wave, 16, 4096).unwrap_err().contains("memory budget"));
        let packets = encode(wave, 16, LIMIT).unwrap();
        assert_eq!(packets.len(), 2);
        for packet in packets {
            let mut offset = 0;
            let mut blocks = 0;
            while offset < packet.len() {
                let size = word(&packet, offset + 4) as usize + 8;
                let flags = word(&packet, offset + 24);
                assert_eq!(flags & 0x800 != 0, offset == 0);
                assert_eq!(flags & 0x1000 != 0, offset + size == packet.len());
                offset += size;
                blocks += 1;
            }
            assert_eq!(blocks, 32);
        }
        let wave = Wave::raw(Format::Signed(16, false), &input, 8000, 65).unwrap();
        assert_eq!(encode(wave, 16, LIMIT).unwrap_err(), "Invalid WavPack channel count");
    }

    #[test]
    fn encodes_full_width_signed_integer_samples_without_losing_auxiliary_bits() {
        let values=[i32::MIN,i32::MAX,-1,0,1,-2147483647,0x12345678,-0x12345678];
        let input=values.into_iter().cycle().take(530).flat_map(i32::to_le_bytes).collect::<Vec<_>>();
        for channels in [1,2] {
            let wave=Wave::raw(Format::Signed(32,false),&input,8000,channels).unwrap();
            let encoded=encode(wave,32,LIMIT).unwrap().concat();
            let doc=Document::read(&encoded,LIMIT).unwrap();
            assert_eq!(doc.bits,32);
            let pcm=doc.decode(LIMIT,Format::Float(64,false)).unwrap();
            for (i,sample) in pcm.chunks_exact(8).enumerate() {
                assert_eq!(f64::from_le_bytes(sample.try_into().unwrap()),f64::from(values[i%values.len()])/2147483648.);
            }
        }
    }
    #[test]
    fn matroska_packets_preserve_multichannel_audio_and_enforce_bounds() {
        for bytes in [
            include_bytes!(
                "../../../safe-bash-command-ffmpeg/src/fixtures/wavpack-int16-stereo.wv"
            )
            .as_slice(),
            include_bytes!("../../../safe-bash-command-ffmpeg/src/fixtures/wavpack-6ch.wv")
                .as_slice(),
        ] {
            let doc = Document::read(bytes, LIMIT).unwrap();
            let pcm = doc.decode(LIMIT,Format::Float(64,false)).unwrap();
            let mut restored = Vec::new();
            for p in &doc.packets {
                let (packet, frames) = (p.data, p.frames);
                let packed = pack_matroska(packet, LIMIT).unwrap();
                let mut bounded = vec![0; 7];
                assert!(
                    unpack_matroska(&packed, &bytes[8..10], &mut bounded, packet.len() + 6)
                        .is_err()
                );
                let frames_out =
                    unpack_matroska(&packed, &bytes[8..10], &mut restored, LIMIT).unwrap();
                assert_eq!(frames_out, frames);
                for version in [&[][..], &[0x10][..], &[1, 4][..], &[0x11, 4][..]] {
                    assert!(unpack_matroska(&packed, version, &mut Vec::new(), LIMIT).is_err());
                }
                for size in 0..12 {
                    assert!(
                        unpack_matroska(&packed[..size], &bytes[8..10], &mut Vec::new(), LIMIT)
                            .is_err()
                    );
                }
                let mut broken = packed.to_vec();
                broken[..4].fill(0);
                assert!(unpack_matroska(&broken, &bytes[8..10], &mut Vec::new(), LIMIT).is_err());
                broken.copy_from_slice(&packed);
                broken[5] &= !8;
                assert!(unpack_matroska(&broken, &bytes[8..10], &mut Vec::new(), LIMIT).is_err());
                let mut broken = packet.to_vec();
                broken[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
                assert!(pack_matroska(&broken, LIMIT).is_err());
                if word(packet, 24) & 0x1800 != 0x1800 {
                    assert!(pack_matroska(packet, packet.len() - 1).is_err());
                    let mut broken = packed.to_vec();
                    broken[12..16].copy_from_slice(&u32::MAX.to_le_bytes());
                    assert!(
                        unpack_matroska(&broken, &bytes[8..10], &mut Vec::new(), LIMIT).is_err()
                    );
                    let mut broken = packed.to_vec();
                    broken.push(0);
                    assert!(
                        unpack_matroska(&broken, &bytes[8..10], &mut Vec::new(), LIMIT).is_err()
                    );
                }
            }
            assert_eq!(
                Document::read(&restored, LIMIT)
                    .unwrap()
                    .decode(LIMIT,Format::Float(64,false))
                    .unwrap(),
                pcm
            );
        }
    }
    #[test]
    fn encodes_native_lossless_blocks_matching_production_packets() {
        use super::super::super::structured::{JVal, parse_json_stream};
        use super::super::{hex_dec, hex_enc, sha256_bytes};
        let JVal::Object(fixture) =
            parse_json_stream(include_str!("../../tests/fixtures/wavpack-encoding.json"))
                .unwrap()
                .remove(0)
        else {
            panic!("fixture")
        };
        let JVal::Array(cases) = &fixture.iter().find(|(k, _)| k == "cases").unwrap().1 else {
            panic!("cases")
        };
        for case in cases {
            let JVal::Object(fields) = case else {
                panic!("case")
            };
            let field = |key| &fields.iter().find(|(k, _)| k == key).unwrap().1;
            let number = |key| match field(key) {
                JVal::Number(n, _) => *n as u32,
                _ => panic!("number"),
            };
            let JVal::Str(input) = field("input") else {
                panic!("input")
            };
            let bytes = hex_dec(input);
            let bits = number("bits") as u16;
            let wave = Wave::raw(
                Format::Signed(bits, false),
                &bytes,
                number("rate"),
                number("channels"),
            )
            .unwrap();
            let packets = encode(wave, bits, LIMIT).unwrap();
            let JVal::Array(expected) = field("packets") else {
                panic!("packets")
            };
            assert_eq!(packets.len(), expected.len());
            for (packet, reference) in packets.iter().zip(expected) {
                let JVal::Object(fields) = reference else {
                    panic!("packet")
                };
                let JVal::Str(hash) = &fields.iter().find(|(k, _)| k == "sha256").unwrap().1 else {
                    panic!("hash")
                };
                assert_eq!(hex_enc(&sha256_bytes(packet)), *hash);
            }
            let encoded = packets.concat();
            let doc = Document::read(&encoded, LIMIT).unwrap();
            let decoded = doc.decode(LIMIT,Format::Float(64,false)).unwrap();
            for (i, sample) in decoded.chunks_exact(8).enumerate() {
                assert_eq!(
                    f64::from_le_bytes(sample.try_into().unwrap()),
                    wave.format().sample(&bytes[i * usize::from(bits / 8)..])
                );
            }
            assert!(encode(wave, bits, 10).is_err());
        }
    }
    #[test]
    fn decodes_native_integer_samples_and_block_groups() {
        for (bytes, bits, channels, frames) in [
            (
                include_bytes!(
                    "../../../safe-bash-command-ffmpeg/src/fixtures/wavpack-int16-stereo.wv"
                )
                .as_slice(),
                16,
                2,
                256,
            ),
            (
                include_bytes!(
                    "../../../safe-bash-command-ffmpeg/src/fixtures/wavpack-int24-stereo.wv"
                )
                .as_slice(),
                24,
                2,
                256,
            ),
            (
                include_bytes!(
                    "../../../safe-bash-command-ffmpeg/src/fixtures/wavpack-int32-stereo.wv"
                )
                .as_slice(),
                32,
                2,
                256,
            ),
            (
                include_bytes!(
                    "../../../safe-bash-command-ffmpeg/src/fixtures/wavpack-int32-mono.wv"
                )
                .as_slice(),
                32,
                1,
                256,
            ),
            (
                include_bytes!(
                    "../../../safe-bash-command-ffmpeg/src/fixtures/wavpack-int32-stereo-blocks.wv"
                )
                .as_slice(),
                32,
                2,
                529,
            ),
        ] {
            let doc = Document::read(bytes, LIMIT).unwrap();
            assert_eq!(
                (doc.rate, doc.channels, doc.bits, doc.frames),
                (8000, channels, if bits == 24 { 32 } else { bits }, frames)
            );
            let pcm = doc.decode(LIMIT,Format::Float(64,false)).unwrap();
            assert_eq!(pcm.len(), frames as usize * channels as usize * 8);
            for (i, sample) in pcm.chunks_exact(8).enumerate() {
                let frame = i / channels as usize;
                let channel = i % channels as usize;
                let base = ((frame * 31337 + channel * 997) % 65536) as i64 - 32768;
                let mut expected = match bits {
                    16 => base,
                    24 => base * 255 + 3,
                    _ => base * 65535 + 3,
                };
                if frames == 529 && i < 6 {
                    expected = [-2147483648, 2147483647, -1, 0, 1, -2147483647][i];
                }
                assert_eq!(
                    f64::from_le_bytes(sample.try_into().unwrap()),
                    expected as f64 / 2f64.powi(bits as i32 - 1),
                    "{bits}-bit sample {i}"
                );
            }
        }
    }
    #[test]
    fn decodes_native_multichannel_samples() {
        for (bytes, channels) in [
            (
                include_bytes!("../../../safe-bash-command-ffmpeg/src/fixtures/wavpack-2ch.wv")
                    .as_slice(),
                2,
            ),
            (
                include_bytes!("../../../safe-bash-command-ffmpeg/src/fixtures/wavpack-4ch.wv")
                    .as_slice(),
                4,
            ),
            (
                include_bytes!("../../../safe-bash-command-ffmpeg/src/fixtures/wavpack-6ch.wv")
                    .as_slice(),
                6,
            ),
        ] {
            let doc = Document::read(bytes, LIMIT).unwrap();
            assert_eq!(
                (doc.channels, doc.frames, doc.packets.len()),
                (channels, 300, 3)
            );
            let pcm = doc.decode(LIMIT,Format::Float(64,false)).unwrap();
            for (i, sample) in pcm.chunks_exact(8).enumerate() {
                let value = ((i / channels as usize * 131 + i % channels as usize * 999) % 24000)
                    as i32
                    - 10000;
                assert_eq!(
                    f64::from_le_bytes(sample.try_into().unwrap()),
                    f64::from(value) / 32768.
                );
            }
        }
    }
    #[test]
    fn preserves_float_extra_bits_and_signed_zero() {
        let doc = Document::read(
            include_bytes!("../../../safe-bash-command-ffmpeg/src/fixtures/wavpack-float-extra.wv"),
            LIMIT,
        )
        .unwrap();
        let pcm = doc.decode(LIMIT,Format::Float(64,false)).unwrap();
        let bits = [
            0, 0x80000000, 1, 0x80000001, 0x007fffff, 0x00800000, 0x3f800001, 0xbeaaaaab,
            0x3f7fffff, 0x00800001, 0x40000001, 0xc0400000,
        ];
        assert_eq!(pcm.len(), bits.len() * 32 * 8);
        for (i, sample) in pcm.chunks_exact(8).enumerate() {
            assert_eq!(
                (f64::from_le_bytes(sample.try_into().unwrap()) as f32).to_bits(),
                bits[i % bits.len()]
            );
        }
    }
    #[test]
    fn rejects_truncated_blocks_and_inconsistent_multichannel_groups() {
        let bytes = include_bytes!("../../../safe-bash-command-ffmpeg/src/fixtures/wavpack-6ch.wv");
        let second = word(bytes, 4) as usize + 8;
        let third = second + word(bytes, second + 4) as usize + 8;
        assert!(Document::read(&bytes[..third], LIMIT).is_err());
        assert!(Document::read(&bytes[second..], LIMIT).is_err());
        for (at, value) in [
            (second + 16, 1),
            (second + 20, 127),
            (second + 24, word(bytes, second + 24) | 0x800),
            (4, u32::MAX),
            (20, u32::MAX),
        ] {
            let mut broken = bytes.to_vec();
            broken[at..at + 4].copy_from_slice(&value.to_le_bytes());
            assert!(
                Document::read(&broken, LIMIT)
                    .and_then(|d| d.decode(LIMIT,Format::Float(64,false)))
                    .is_err()
            );
        }
        for length in (0..third).step_by(97) {
            assert!(Document::read(&bytes[..length], LIMIT).is_err());
        }
    }
    #[test]
    fn rejects_missing_and_corrupt_auxiliary_bits_and_bounds_ape_items() {
        for (bytes, id) in [
            (
                include_bytes!(
                    "../../../safe-bash-command-ffmpeg/src/fixtures/wavpack-int32-stereo.wv"
                )
                .as_slice(),
                9,
            ),
            (
                include_bytes!(
                    "../../../safe-bash-command-ffmpeg/src/fixtures/wavpack-float-extra.wv"
                )
                .as_slice(),
                8,
            ),
        ] {
            let block = &bytes[..word(bytes, 4) as usize + 8];
            let parts = metadata(block).unwrap();
            let extra = parts[12].unwrap().as_ptr() as usize - bytes.as_ptr() as usize;
            let info = parts[id].unwrap().as_ptr() as usize - bytes.as_ptr() as usize;
            for (at, value) in [(extra, bytes[extra] ^ 1), (info - 2, 0x20 | id as u8)] {
                let mut broken = bytes.to_vec();
                broken[at] = value;
                assert!(
                    Document::read(&broken, LIMIT)
                        .unwrap()
                        .decode(LIMIT,Format::Float(64,false))
                        .is_err()
                );
            }
        }
        let bytes =
            include_bytes!("../../../safe-bash-command-ffmpeg/src/fixtures/wavpack-metadata.wv");
        for (at, value) in [
            (bytes.len() - 20, 31),
            (bytes.len() - 20, u32::MAX),
            (bytes.len() - 16, u32::MAX),
            (word(bytes, 4) as usize + 40, u32::MAX),
        ] {
            let mut broken = bytes.to_vec();
            broken[at..at + 4].copy_from_slice(&value.to_le_bytes());
            assert!(Document::read(&broken, LIMIT).is_err());
        }
    }
    #[test]
    fn rejects_conflicting_mono_and_false_stereo_flags() {
        let mut bytes =
            include_bytes!("../../../safe-bash-command-ffmpeg/src/fixtures/wavpack-int32-mono.wv")
                .to_vec();
        let flags = word(&bytes, 24) | 0x40000000;
        bytes[24..28].copy_from_slice(&flags.to_le_bytes());
        assert!(
            Document::read(&bytes, LIMIT)
                .and_then(|doc| doc.decode(LIMIT,Format::Float(64,false)))
                .is_err()
        );
    }
    #[test]
    fn bounds_decoding_and_checks_audio_checksums_without_blocking_probe() {
        let mut bytes = include_bytes!(
            "../../../safe-bash-command-ffmpeg/src/fixtures/wavpack-int32-stereo.wv"
        )
        .to_vec();
        let doc = Document::read(&bytes, LIMIT).unwrap();
        assert!(doc.decode(4096,Format::Float(64,false)).is_err());
        bytes[28] ^= 1;
        let doc = Document::read(&bytes, LIMIT).unwrap();
        assert_eq!(
            doc.decode(LIMIT,Format::Float(64,false)).unwrap_err(),
            "WavPack audio checksum mismatch"
        );
    }
}
