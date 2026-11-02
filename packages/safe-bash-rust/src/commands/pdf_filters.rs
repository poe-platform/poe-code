// Filters apply in dictionary order. Raw inspection and page copying retain the encoded bytes.
use super::{Objects, Value};
use crate::commands::codecs::{adler32, gzip_decompress_bounded, inflate_raw_bounded};
use std::borrow::Cow;

impl<'a> Objects<'a> {
    fn filter_value(&mut self, mut value: Value<'a>) -> Option<Value<'a>> {
        for _ in 0..100 {
            let Value::Ref(id) = value else {
                return Some(value);
            };
            value = self.object(id)?.0;
        }
        None
    }

    pub(super) fn decode(&mut self, dict: &Value<'a>, stream: &'a [u8]) -> Option<Cow<'a, [u8]>> {
        let mut bytes = Cow::Borrowed(stream);
        if let Some(filter) = dict.get(b"Filter").or_else(|| dict.get(b"F")) {
            let filters = match self.filter_value(filter.clone())? {
                Value::Array(v) => v,
                item => vec![item],
            };
            let params = match dict.get(b"DecodeParms").or_else(|| dict.get(b"DP")) {
                Some(v) => Some(self.filter_value(v.clone())?),
                None => None,
            };
            let mut index = 0;
            for filter in filters {
                let filter = self.filter_value(filter)?;
                let Some(name) = filter.word().and_then(|s| s.strip_prefix(b"/")) else {
                    continue;
                };
                let parms = match &params {
                    Some(Value::Array(items)) => items.get(index),
                    other => other.as_ref(),
                };
                index += 1;
                let limit = self.remaining_bytes;
                let decoded = match name {
                    b"FlateDecode" | b"Fl" => {
                        let mut data = flate(&bytes, limit)?;
                        if let Some(parms) = parms {
                            let inflated = data.len();
                            self.predict(&mut data, parms, limit)?;
                            self.remaining_bytes -= inflated - data.len();
                        }
                        data
                    }
                    b"ASCIIHexDecode" | b"AHx" => ascii_hex(&bytes, limit)?,
                    b"ASCII85Decode" | b"A85" => ascii85(&bytes, limit)?,
                    b"RunLengthDecode" | b"RL" => run_length(&bytes, limit)?,
                    b"DCTDecode" | b"DCT" | b"JPXDecode" | b"JBIG2Decode" | b"Identity"
                    | b"Crypt" => continue,
                    _ => return None,
                };
                self.remaining_bytes = self.remaining_bytes.checked_sub(decoded.len())?;
                bytes = Cow::Owned(decoded);
            }
        }
        if matches!(bytes, Cow::Borrowed(_)) {
            self.remaining_bytes = self.remaining_bytes.checked_sub(bytes.len())?;
        }
        Some(bytes)
    }
    fn predict(&mut self, data: &mut Vec<u8>, parms: &Value<'a>, limit: usize) -> Option<()> {
        let parms = self.filter_value(parms.clone())?;
        let mut num = |key: &[u8], default| {
            let mut entry = parms.get(key);
            if key == b"BitsPerComponent" {
                entry = entry.or_else(|| parms.get(b"BPC"));
            }
            match entry {
                Some(v) => Some(self.filter_value(v.clone())?.number().unwrap_or(default)),
                None => Some(default),
            }
        };
        let predictor = num(b"Predictor", 1.)?;
        if predictor <= 1. {
            return Some(());
        }
        let integer =
            |n: f64| (n >= 1. && n.fract() == 0. && n <= u32::MAX as f64).then_some(n as usize);
        let predictor = integer(predictor)?;
        let colors = integer(num(b"Colors", 1.)?)?;
        let bits = integer(num(b"BitsPerComponent", 8.)?)?;
        let columns = integer(num(b"Columns", 1.)?)?;
        if !matches!(bits, 1 | 2 | 4 | 8 | 16) {
            return None;
        }
        let samples = colors.checked_mul(columns)?;
        let row_bits = samples.checked_mul(bits)?;
        let width = row_bits.div_ceil(8);
        let stride = (colors * bits).div_ceil(8);
        if width > limit {
            return None;
        }
        if predictor == 2 {
            data.truncate(data.len() / width * width);
            for row in data.chunks_exact_mut(width) {
                match bits {
                    8 => {
                        for i in colors..width {
                            row[i] = row[i].wrapping_add(row[i - colors]);
                        }
                    }
                    16 => {
                        for i in (stride..width).step_by(2) {
                            let word = |i: usize| u16::from_be_bytes([row[i], row[i + 1]]);
                            let sample = word(i).wrapping_add(word(i - stride));
                            row[i..i + 2].copy_from_slice(&sample.to_be_bytes());
                        }
                    }
                    _ => {
                        let mask = (1u8 << bits) - 1;
                        for sample in colors..samples {
                            let bit = sample * bits;
                            let shift = 8 - bits - bit % 8;
                            let prior = bit - colors * bits;
                            let delta = row[bit / 8] >> shift;
                            let left = row[prior / 8] >> (8 - bits - prior % 8);
                            row[bit / 8] = (row[bit / 8] & !(mask << shift))
                                | ((delta.wrapping_add(left) & mask) << shift);
                        }
                        if row_bits % 8 != 0 {
                            row[width - 1] &= 255 << (8 - row_bits % 8);
                        }
                    }
                }
            }
        } else if (10..=15).contains(&predictor) {
            // Decode directly in the inflated buffer, then strip the row markers.
            let pitch = width.checked_add(1)?;
            let rows = data.len() / pitch;
            for i in 0..rows {
                let (before, rest) = data.split_at_mut(i * pitch);
                let previous = if i == 0 {
                    &[]
                } else {
                    &before[before.len() - width..]
                };
                let filter = rest[0];
                super::super::png_pixels::unfilter_row(
                    &mut rest[1..pitch],
                    previous,
                    stride,
                    filter,
                )
                .ok()?;
            }
            for i in 0..rows {
                data.copy_within(i * pitch + 1..(i + 1) * pitch, i * width);
            }
            data.truncate(rows * width);
        } else {
            return None;
        }
        Some(())
    }
}

fn flate(bytes: &[u8], limit: usize) -> Option<Vec<u8>> {
    if bytes.starts_with(&[31, 139]) {
        return gzip_decompress_bounded(bytes, limit).ok();
    }
    if let [cmf, flags, payload @ ..] = bytes
        && cmf & 15 == 8
        && u16::from_be_bytes([*cmf, *flags]) % 31 == 0
    {
        if flags & 32 != 0 {
            return None;
        }
        let (decoded, consumed) = inflate_raw_bounded(payload, limit).ok()?;
        return (payload.get(consumed..consumed + 4)? == adler32(&decoded).to_be_bytes())
            .then_some(decoded);
    }
    Some(inflate_raw_bounded(bytes, limit).ok()?.0)
}

fn ascii_hex(bytes: &[u8], limit: usize) -> Option<Vec<u8>> {
    let mut high = None;
    let mut out = Vec::new();
    for &b in bytes {
        if matches!(b, 0 | 9 | 10 | 12 | 13 | 32) {
            continue;
        }
        if b == b'>' {
            break;
        }
        let n = char::from(b).to_digit(16)? as u8;
        if let Some(h) = high.take() {
            out.push(h | n);
        } else {
            if out.len() == limit {
                return None;
            }
            high = Some(n << 4);
        }
    }
    if let Some(h) = high {
        out.push(h);
    }
    Some(out)
}

fn ascii85(bytes: &[u8], limit: usize) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let (mut group, mut digits) = (0u32, 0usize);
    for &b in bytes {
        match b {
            0 | 9 | 10 | 12 | 13 | 32 => continue,
            b'~' => break,
            b'z' if digits == 0 => {
                if limit - out.len() < 4 {
                    return None;
                }
                out.extend_from_slice(&[0; 4]);
            }
            b'!'..=b'u' => {
                group = group.wrapping_mul(85).wrapping_add(u32::from(b - b'!'));
                digits += 1;
                if digits == 5 {
                    if limit - out.len() < 4 {
                        return None;
                    }
                    out.extend_from_slice(&group.to_be_bytes());
                    (group, digits) = (0, 0);
                }
            }
            _ => return None,
        }
    }
    if digits != 0 {
        if digits == 1 || digits - 1 > limit - out.len() {
            return None;
        }
        for _ in digits..5 {
            group = group.wrapping_mul(85).wrapping_add(84);
        }
        out.extend_from_slice(&group.to_be_bytes()[..digits - 1]);
    }
    Some(out)
}

fn run_length(mut bytes: &[u8], limit: usize) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    while let Some((&n, tail)) = bytes.split_first() {
        if n == 128 {
            break;
        }
        if n < 128 {
            let (literal, rest) = tail.split_at(tail.len().min(1 + usize::from(n)));
            if literal.len() > limit - out.len() {
                return None;
            }
            out.extend_from_slice(literal);
            bytes = rest;
        } else {
            let count = 257 - usize::from(n);
            if count > limit - out.len() {
                return None;
            }
            let (&byte, rest) = tail.split_first().unwrap_or((&0, &[]));
            out.resize(out.len() + count, byte);
            bytes = rest;
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_groups_and_repeated_bytes_obey_the_output_limit() {
        assert_eq!(ascii_hex(b"a>ignored", 1), Some(vec![0xa0]));
        assert_eq!(ascii_hex(b"00a>", 1), None);
        assert_eq!(ascii85(b"z~>", 3), None);
        assert_eq!(ascii85(b"!!~>", 0), None);
        assert_eq!(ascii85(b"!~>", 8), None);
        assert_eq!(run_length(&[129, 9], 127), None);
        assert_eq!(run_length(&[0, 1, 254], 4), Some(vec![1, 0, 0, 0]));
    }
}
