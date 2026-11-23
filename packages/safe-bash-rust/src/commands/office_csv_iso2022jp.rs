pub(super) fn encode(text: &str, limit: usize) -> Option<Vec<u8>> {
    // Native LibreOffice 24.8.7.2: sorted (Unicode, JIS X 0208) u16 pairs.
    let table = include_bytes!("office_csv_iso2022jp/encode.bin")
        .as_chunks::<4>()
        .0;
    let mut out = Vec::new();
    let mut put = |bytes: &[u8]| {
        if out.len().checked_add(bytes.len())? > limit {
            return None;
        }
        out.extend_from_slice(bytes);
        Some(())
    };
    let mut shifted = false;
    for c in text.chars() {
        let cp = u32::from(c);
        let jis = u16::try_from(cp).ok().and_then(|cp| {
            table
                .binary_search_by_key(&cp, |r| u16::from_le_bytes([r[0], r[1]]))
                .ok()
                .map(|i| u16::from_le_bytes([table[i][2], table[i][3]]))
        });
        if shifted != jis.is_some() {
            put(if shifted { b"\x1b(B" } else { b"\x1b$B" })?;
            shifted = !shifted;
        }
        if let Some(jis) = jis {
            put(&jis.to_be_bytes())?;
        } else {
            let byte = match cp {
                0..=26 | 28..=127 => cp as u8,
                // Native's default private-use substitution is NUL.
                0xe000..=0xf8ff | 0xf0000..=0xffffd | 0x100000..=0x10fffd => 0,
                _ => b'?',
            };
            put(&[byte])?;
        }
    }
    if shifted {
        put(b"\x1b(B")?;
    }
    Some(out)
}

pub(super) fn decode(bytes: &[u8], limit: usize) -> Option<String> {
    // CSV only decodes this encoder's output: ASCII and JIS X 0208 runs.
    // The native 94x94 table stores decoded UTF-16 units in little-endian order.
    let table = include_bytes!("office_csv_iso2022jp/decode.bin");
    let mut out = String::new();
    let (mut pos, mut shifted) = (0, false);
    while pos < bytes.len() {
        if bytes[pos] == 27 {
            shifted = match bytes.get(pos..pos.checked_add(3)?)? {
                b"\x1b$B" => true,
                b"\x1b(B" => false,
                _ => return None,
            };
            pos += 3;
            continue;
        }
        let c = if shifted {
            let a = bytes[pos];
            let b = *bytes.get(pos + 1)?;
            if !(0x21..=0x7e).contains(&a) || !(0x21..=0x7e).contains(&b) {
                return None;
            }
            let index = (usize::from(a - 0x21) * 94 + usize::from(b - 0x21)) * 2;
            pos += 2;
            char::from_u32(u32::from(u16::from_le_bytes([
                table[index],
                table[index + 1],
            ])))?
        } else {
            let byte = bytes[pos];
            if !byte.is_ascii() {
                return None;
            }
            pos += 1;
            char::from(byte)
        };
        if out.len().checked_add(c.len_utf8())? > limit {
            return None;
        }
        out.push(c);
    }
    Some(out)
}
