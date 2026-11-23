// LibreOffice 24.8.7.2 GB18030 mappings, verified over every Unicode scalar
// and every valid-shaped two-/four-byte sequence. All integers are little-endian.
// Ranges contain (Unicode start, Unicode end, four-byte pointer start), sorted
// by both Unicode and pointer. Two-byte encoder records contain (u16, [u8; 2]);
// the decoder is indexed by lead and trail byte, excluding the 0x7f trail.
const RANGES: &[[u8; 12]] = include_bytes!("office_csv_gb18030/ranges.bin")
    .as_chunks::<12>()
    .0;
const ENCODE: &[[u8; 4]] = include_bytes!("office_csv_gb18030/encode-two.bin")
    .as_chunks::<4>()
    .0;
const DECODE: &[[u8; 2]] = include_bytes!("office_csv_gb18030/decode-two.bin")
    .as_chunks::<2>()
    .0;

pub(super) fn encode(text: &str, limit: usize) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    for c in text.chars() {
        let cp = u32::from(c);
        let bytes;
        let encoded = if c.is_ascii() {
            bytes = [c as u8, 0, 0, 0];
            &bytes[..1]
        } else if let Ok(index) =
            ENCODE.binary_search_by_key(&cp, |r| u32::from(u16::from_le_bytes([r[0], r[1]])))
        {
            &ENCODE[index][2..]
        } else {
            let index =
                RANGES.partition_point(|r| u32::from_le_bytes(r[..4].try_into().unwrap()) <= cp);
            let record = RANGES.get(index.checked_sub(1)?)?;
            let start = u32::from_le_bytes(record[..4].try_into().ok()?);
            let end = u32::from_le_bytes(record[4..8].try_into().ok()?);
            let pointer = u32::from_le_bytes(record[8..].try_into().ok()?);
            if cp > end {
                return None;
            }
            let n = pointer + cp - start;
            bytes = [
                (n / 12600) as u8 + 0x81,
                (n / 1260 % 10) as u8 + 0x30,
                (n / 10 % 126) as u8 + 0x81,
                (n % 10) as u8 + 0x30,
            ];
            &bytes[..]
        };
        if out.len().checked_add(encoded.len())? > limit {
            return None;
        }
        out.extend_from_slice(encoded);
    }
    Some(out)
}

pub(super) fn decode(bytes: &[u8], limit: usize) -> Option<String> {
    let mut out = String::new();
    let mut bytes = bytes.iter().copied();
    while let Some(first) = bytes.next() {
        // Native conversion consumes the offending byte with each malformed
        // prefix; an incomplete final prefix also produces one replacement.
        let c = 'character: {
            if first < 0x80 {
                break 'character char::from(first);
            }
            if !(0x81..=0xfe).contains(&first) {
                break 'character '\u{fffd}';
            }
            let Some(second) = bytes.next() else {
                break 'character '\u{fffd}';
            };
            if matches!(second, 0x40..=0x7e | 0x80..=0xfe) {
                let trail = if second < 0x7f {
                    second - 0x40
                } else {
                    second - 0x80 + 63
                };
                let index = usize::from(first - 0x81) * 190 + usize::from(trail);
                break 'character char::from_u32(u32::from(u16::from_le_bytes(DECODE[index])))?;
            }
            if !second.is_ascii_digit() {
                break 'character '\u{fffd}';
            }
            let Some(third) = bytes.next() else {
                break 'character '\u{fffd}';
            };
            if !(0x81..=0xfe).contains(&third) {
                break 'character '\u{fffd}';
            }
            let Some(fourth) = bytes.next() else {
                break 'character '\u{fffd}';
            };
            if !fourth.is_ascii_digit() {
                break 'character '\u{fffd}';
            }
            let n = (u32::from(first - 0x81) * 10 + u32::from(second - 0x30)) * 1260
                + u32::from(third - 0x81) * 10
                + u32::from(fourth - 0x30);
            let index =
                RANGES.partition_point(|r| u32::from_le_bytes(r[8..].try_into().unwrap()) <= n);
            let record = RANGES.get(index.checked_sub(1)?)?;
            let start = u32::from_le_bytes(record[..4].try_into().ok()?);
            let end = u32::from_le_bytes(record[4..8].try_into().ok()?);
            let pointer = u32::from_le_bytes(record[8..].try_into().ok()?);
            let cp = start + n - pointer;
            if cp > end {
                break 'character '\u{fffd}';
            }
            char::from_u32(cp)?
        };
        if out.len().checked_add(c.len_utf8())? > limit {
            return None;
        }
        out.push(c);
    }
    Some(out)
}
