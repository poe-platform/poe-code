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
            for filter in filters {
                let filter = self.filter_value(filter)?;
                let Some(name) = filter.word().and_then(|s| s.strip_prefix(b"/")) else {
                    continue;
                };
                let limit = self.remaining_bytes;
                let decoded = match name {
                    b"FlateDecode" | b"Fl" => flate(&bytes, limit)?,
                    b"ASCIIHexDecode" | b"AHx" => ascii_hex(&bytes, limit)?,
                    b"ASCII85Decode" | b"A85" => ascii85(&bytes, limit)?,
                    b"RunLengthDecode" | b"RL" => run_length(&bytes, limit)?,
                    b"DCTDecode" | b"DCT" | b"JPXDecode" | b"JBIG2Decode" | b"Identity"
                    | b"Crypt" => continue,
                    _ => return None,
                };
                self.remaining_bytes = limit.checked_sub(decoded.len())?;
                bytes = Cow::Owned(decoded);
            }
        }
        if matches!(bytes, Cow::Borrowed(_)) {
            self.remaining_bytes = self.remaining_bytes.checked_sub(bytes.len())?;
        }
        Some(bytes)
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
