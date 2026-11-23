/*
 * This source code is a product of Sun Microsystems, Inc. and is provided
 * for unrestricted use.  Users may copy or modify this source code without
 * charge.
 *
 * SUN SOURCE CODE IS PROVIDED AS IS WITH NO WARRANTIES OF ANY KIND INCLUDING
 * THE WARRANTIES OF DESIGN, MERCHANTIBILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE, OR ARISING FROM A COURSE OF DEALING, USAGE OR TRADE PRACTICE.
 *
 * Sun source code is provided with no support and without any obligation on
 * the part of Sun Microsystems, Inc. to assist in its use, correction,
 * modification or enhancement.
 *
 * SUN MICROSYSTEMS, INC. SHALL HAVE NO LIABILITY WITH RESPECT TO THE
 * INFRINGEMENT OF COPYRIGHTS, TRADE SECRETS OR ANY PATENTS BY THIS SOFTWARE
 * OR ANY PART THEREOF.
 *
 * In no event will Sun Microsystems, Inc. be liable for any lost revenue
 * or profits or other special, indirect and consequential damages, even if
 * Sun has been advised of the possibility of such damages.
 *
 * Sun Microsystems, Inc.
 * 2550 Garcia Avenue
 * Mountain View, California  94043
 */

const INVERSE2: &[i32] = &[116, 365, 365, 116];
const SCALE2: &[i32] = &[-22, 439, 439, -22];
const SPEED2: &[i32] = &[0, 7, 7, 0];
const QUANTIZE2: &[i32] = &[260];
const QUANTIZE3: &[i32] = &[7, 217, 330];
const QUANTIZE5: &[i32] = &[
    -122, -16, 67, 138, 197, 249, 297, 338, 377, 412, 444, 474, 501, 527, 552,
];
const INVERSE3: &[i32] = &[-32768, 135, 273, 373, 373, 273, 135, -32768];
const SCALE3: &[i32] = &[-4, 30, 137, 582, 582, 137, 30, -4];
const SPEED3: &[i32] = &[0, 1, 2, 7, 7, 2, 1, 0];
const QUANTIZE4: &[i32] = &[-125, 79, 177, 245, 299, 348, 399];
const INVERSE4: &[i32] = &[
    -32768, 4, 135, 213, 273, 323, 373, 425, 425, 373, 323, 273, 213, 135, 4, -32768,
];
const SCALE4: &[i32] = &[
    -12, 18, 41, 64, 112, 198, 355, 1122, 1122, 355, 198, 112, 64, 41, 18, -12,
];
const SPEED4: &[i32] = &[0, 0, 0, 1, 1, 1, 3, 7, 7, 3, 1, 1, 1, 0, 0, 0];
const INVERSE5: &[i32] = &[
    -32768, -66, 28, 104, 169, 224, 274, 318, 358, 395, 429, 459, 488, 514, 539, 566, 566, 539,
    514, 488, 459, 429, 395, 358, 318, 274, 224, 169, 104, 28, -66, -32768,
];
const SCALE5: &[i32] = &[
    14, 14, 24, 39, 40, 41, 58, 100, 141, 179, 219, 280, 358, 440, 529, 696, 696, 529, 440, 358,
    280, 219, 179, 141, 100, 58, 41, 40, 39, 24, 14, 14,
];
const SPEED5: &[i32] = &[
    0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 3, 4, 5, 6, 6, 6, 6, 5, 4, 3, 2, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
];

struct State {
    poles: [i32; 2],
    zeros: [i32; 6],
    signals: [i32; 2],
    differences: [i32; 6],
    signs: [i32; 2],
    slow_scale: i32,
    step: i32,
    adaptation: i32,
    short_energy: i32,
    long_energy: i32,
    estimate: i32,
    zero_estimate: i32,
    tone: bool,
}
impl State {
    fn new() -> Self {
        Self {
            poles: [0; 2],
            zeros: [0; 6],
            signals: [32; 2],
            differences: [32; 6],
            signs: [1; 2],
            slow_scale: 34816,
            step: 544,
            adaptation: 0,
            short_energy: 0,
            long_energy: 0,
            estimate: 0,
            zero_estimate: 0,
            tone: false,
        }
    }
    fn update(&mut self, code: usize, bits: u8) -> i16 {
        let (inverse, scale, speed) = match bits {
            2 => (INVERSE2, SCALE2, SPEED2),
            3 => (INVERSE3, SCALE3, SPEED3),
            4 => (INVERSE4, SCALE4, SPEED4),
            5 => (INVERSE5, SCALE5, SPEED5),
            _ => unreachable!(),
        };
        let negative = code as i32 >> (bits - 1);
        let logarithm = inverse[code] + (self.step >> 2);
        let magnitude = if logarithm < 0 {
            0
        } else {
            ((128 + (logarithm & 127)) << ((logarithm >> 7) & 15)) >> 7
        };
        let threshold = if self.slow_scale >> 15 > 9 {
            31 << 10
        } else {
            (32 + ((self.slow_scale >> 10) & 31)) << (self.slow_scale >> 15)
        };
        let transition = self.tone && magnitude > ((3 * threshold) >> 2);
        let difference = if negative != 0 { -magnitude } else { magnitude };
        let signal = (self.estimate + difference) as i16 as i32;
        let sign = (self.zero_estimate + difference).signum();
        if transition {
            self.poles.fill(0);
            self.zeros.fill(0);
        } else {
            let correction = ((-self.poles[0] * self.signs[0] * sign) >> 5).clamp(-256, 255);
            self.poles[1] = (self.poles[1] + 128 * sign * self.signs[1] + correction
                - (self.poles[1] >> 7))
                .clamp(-12288, 12288);
            let limit = 15360 - self.poles[1];
            self.poles[0] = (self.poles[0] + 192 * sign * self.signs[0] - (self.poles[0] >> 8))
                .clamp(-limit, limit);
            for i in 0..6 {
                self.zeros[i] += 128
                    * difference.signum()
                    * if self.differences[i] & 2048 != 0 {
                        -1
                    } else {
                        1
                    }
                    - (self.zeros[i] >> 8);
            }
        }
        self.signs[1] = self.signs[0];
        self.signs[0] = if sign == 0 { 1 } else { sign };
        self.signals[1] = self.signals[0];
        self.signals[0] = floating(signal);
        self.differences.copy_within(0..5, 1);
        self.differences[0] = (floating(difference) & 2047) | (negative << 11);
        self.tone = self.poles[1] < -11776;
        self.short_energy += (speed[code] << 4) + (-self.short_energy >> 5);
        self.long_energy += (speed[code] << 4) + (-self.long_energy >> 7);
        self.adaptation = if transition {
            256
        } else {
            self.adaptation
                + (-self.adaptation >> 4)
                + if self.step <= 1535
                    || self.tone
                    || ((self.short_energy << 2) - self.long_energy).abs()
                        >= (self.long_energy >> 3)
                {
                    32
                } else {
                    0
                }
        };
        let fast_scale = (self.step + scale[code] + (-self.step >> 5)).clamp(544, 5120);
        self.slow_scale += fast_scale + (-self.slow_scale >> 6);
        self.step = (self.slow_scale
            + (fast_scale - (self.slow_scale >> 6))
                * if self.adaptation >= 256 {
                    64
                } else {
                    self.adaptation >> 2
                })
            >> 6;
        self.estimate = self
            .zeros
            .iter()
            .zip(self.differences)
            .map(|(&v, h)| multiply(v >> 2, h))
            .sum();
        self.zero_estimate = self.estimate >> 1;
        self.estimate = (self.estimate
            + self
                .poles
                .iter()
                .zip(self.signals)
                .map(|(&v, h)| multiply(v >> 2, h))
                .sum::<i32>())
            >> 1;
        (signal * 4).clamp(-65535, 65535) as i16
    }
}
fn floating(value: i32) -> i32 {
    let magnitude = value.abs();
    let exponent = if magnitude == 0 {
        0
    } else {
        32 - magnitude.leading_zeros()
    };
    (if value < 0 { 2048 } else { 0 })
        | (exponent as i32) << 6
        | if magnitude != 0 {
            (magnitude << 6) >> exponent
        } else {
            32
        }
}
fn multiply(coefficient: i32, history: i32) -> i32 {
    let packed = floating(coefficient);
    let exponent = ((packed >> 6) & 31) + ((history >> 6) & 31) - 19;
    let mantissa = (((packed & 63) * (history & 63)) + 48) >> 4;
    let magnitude = if exponent >= 0 {
        mantissa << exponent
    } else {
        mantissa >> -exponent
    };
    (if (packed ^ history) & 2048 != 0 {
        -magnitude
    } else {
        magnitude
    }) as i16 as i32
}
pub(super) fn decode(
    data: &[u8],
    bits: u8,
    little_endian: bool,
    packet_size: usize,
    loops: usize,
    start: usize,
    limit: usize,
) -> Result<Vec<u8>, &'static str> {
    if !(2..=5).contains(&bits) || packet_size == 0 {
        return Err("Invalid G.726 code or packet size");
    }
    if data.is_empty() {
        return Ok(Vec::new());
    }
    let frames = data
        .len()
        .checked_mul(8)
        .ok_or("audio exceeds memory budget")?
        / usize::from(bits);
    let size = loops
        .checked_add(1)
        .and_then(|n| frames.checked_mul(n))
        .and_then(|n| n.checked_mul(2))
        .filter(|&n| n <= limit)
        .ok_or("audio exceeds memory budget")?;
    let mut out = Vec::with_capacity(size);
    let mut state = State::new();
    for pass in 0..=loops {
        if pass > 0 {
            // FFmpeg's decoder flush resets scales and mantissas, retaining
            // predictor coefficients, exponents, signs and energy history.
            state.signs.fill(1);
            for value in state.signals.iter_mut().chain(&mut state.differences) {
                *value = (*value & !63) | 32;
            }
            state.slow_scale = 34816;
            state.step = 544;
        }
        let data = if pass == 0 {
            &data[start.min(data.len())..]
        } else {
            data
        };
        for packet in data.chunks(packet_size) {
            for frame in 0..packet.len() * 8 / usize::from(bits) {
                let mut code = 0;
                for i in 0..usize::from(bits) {
                    let bit = frame * usize::from(bits) + i;
                    let shift = if little_endian { bit % 8 } else { 7 - bit % 8 };
                    let target = if little_endian {
                        i
                    } else {
                        usize::from(bits) - 1 - i
                    };
                    code |= usize::from((packet[bit / 8] >> shift) & 1) << target;
                }
                out.extend_from_slice(&state.update(code, bits).to_le_bytes());
            }
        }
    }
    Ok(out)
}
pub(super) fn encode(
    pcm: &[u8],
    bits: u8,
    little_endian: bool,
    limit: usize,
) -> Result<Vec<u8>, &'static str> {
    let thresholds = match bits {
        2 => QUANTIZE2,
        3 => QUANTIZE3,
        4 => QUANTIZE4,
        5 => QUANTIZE5,
        _ => return Err("Invalid G.726 code size"),
    };
    let size = (pcm.len() / 2)
        .checked_mul(usize::from(bits))
        .ok_or("audio exceeds memory budget")?
        .div_ceil(8);
    if size > limit {
        return Err("audio exceeds memory budget");
    }
    let mut out = vec![0; size];
    let mut state = State::new();
    for (i, bytes) in pcm.chunks_exact(2).enumerate() {
        let difference =
            i32::from(i16::from_le_bytes(bytes.try_into().unwrap())) / 4 - state.estimate;
        let magnitude = difference.abs();
        let exponent = if magnitude == 0 {
            0
        } else {
            31 - magnitude.leading_zeros()
        };
        let logarithm =
            ((exponent as i32) << 7) + (((magnitude << 7) >> exponent) & 127) - (state.step >> 2);
        let mut code = thresholds.iter().take_while(|&&v| logarithm > v).count();
        let mask = (1 << bits) - 1;
        if difference < 0 {
            code = mask - code;
        } else if code == 0 && bits != 2 {
            code = mask;
        }
        for j in 0..usize::from(bits) {
            let bit = i * usize::from(bits) + j;
            let shift = if little_endian { bit % 8 } else { 7 - bit % 8 };
            let source = if little_endian {
                j
            } else {
                usize::from(bits) - 1 - j
            };
            out[bit / 8] |= (((code >> source) & 1) as u8) << shift;
        }
        state.update(code, bits);
    }
    Ok(out)
}

pub(super) fn encode_wav(
    pcm: &[u8],
    rate: u32,
    channels: usize,
    opts: &super::mp4::mux::Remux<'_>,
) -> Result<Vec<u8>, String> {
    if channels != 1 || rate != 8000 {
        return Err("G.726 requires mono audio at 8000 Hz".into());
    }
    let mut bits = 4u8;
    if let Some(bitrate) = opts.audio_bitrate {
        let (value, multiplier) = if let Some(v) = bitrate.strip_suffix(['k', 'K']) {
            (v, 1000.)
        } else if let Some(v) = bitrate.strip_suffix(['m', 'M']) {
            (v, 1_000_000.)
        } else {
            (bitrate, 1.)
        };
        let value = value.parse::<f64>().map_err(|_| "Invalid G.726 bitrate")? * multiplier;
        if !value.is_finite() || value < 0. || value > i64::MAX as f64 {
            return Err("Invalid G.726 bitrate".into());
        }
        if value > 0. {
            bits = ((value + f64::from(rate) / 2.) / f64::from(rate))
                .floor()
                .clamp(2., 5.) as u8;
        }
    }
    let data = encode(pcm, bits, false, opts.limit)?;
    let mut fmt = Vec::with_capacity(18);
    fmt.extend_from_slice(&69u16.to_le_bytes());
    fmt.extend_from_slice(&1u16.to_le_bytes());
    fmt.extend_from_slice(&rate.to_le_bytes());
    fmt.extend_from_slice(&(rate * u32::from(bits) / 8).to_le_bytes());
    fmt.extend_from_slice(
        &(if bits.is_multiple_of(2) {
            1u16
        } else {
            u16::from(bits)
        })
        .to_le_bytes(),
    );
    fmt.extend_from_slice(&u16::from(bits).to_le_bytes());
    fmt.extend_from_slice(&0u16.to_le_bytes());
    super::adpcm_wav::write(
        &fmt,
        &data,
        (pcm.len() / 2) as u64,
        &super::mp4::mux::Remux {
            limit: opts.limit.saturating_sub(data.capacity() + fmt.capacity()),
            hls: None,
            concat: None,
            ..*opts
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn g726_little_endian_matches_native_at_every_code_size() {
        use super::super::super::structured::{JVal, parse_json_stream};
        let JVal::Object(f) = parse_json_stream(include_str!("../../tests/fixtures/g726.json"))
            .unwrap()
            .remove(0)
        else {
            panic!("fixture")
        };
        let JVal::Array(cases) = &f.iter().find(|(k, _)| k == "cases").unwrap().1 else {
            panic!("cases")
        };
        for case in cases {
            let JVal::Object(fields) = case else {
                panic!("case")
            };
            let field = |key| &fields.iter().find(|(k, _)| k == key).unwrap().1;
            let bytes = |key| {
                if let JVal::Str(s) = field(key) {
                    super::super::hex_dec(s)
                } else {
                    panic!("hex")
                }
            };
            let JVal::Number(bits, _) = field("bits") else {
                panic!("bits")
            };
            assert_eq!(
                encode(&bytes("input"), *bits as u8, true, 1 << 20).unwrap(),
                bytes("le"),
                "{:?}",
                field("name")
            );
            assert_eq!(
                decode(&bytes("le"), *bits as u8, true, 1020, 0, 0, 1 << 20).unwrap(),
                bytes("leDecoded"),
                "{:?}",
                field("name")
            );
        }
    }
    #[test]
    fn g726_rejects_invalid_code_sizes_and_limits() {
        for bits in [0, 1, 6, 255] {
            assert!(decode(&[0; 4], bits, false, 4, 0, 0, 100).is_err());
            assert!(encode(&[0; 4], bits, false, 100).is_err());
        }
        assert!(decode(&[0; 4], 4, false, 0, 0, 0, 100).is_err());
        assert!(decode(&[0; 4], 2, false, 4, 0, 0, 31).is_err());
        assert!(encode(&[0; 16], 5, false, 4).is_err());
        assert!(
            decode(&[], 2, false, 1, usize::MAX - 1, 0, 0)
                .unwrap()
                .is_empty()
        );
        assert!(decode(&[0], 2, false, 1, usize::MAX, 0, 100).is_err());
    }
}
