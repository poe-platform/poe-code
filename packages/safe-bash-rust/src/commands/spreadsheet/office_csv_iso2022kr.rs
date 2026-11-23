pub(super) fn encode(text: &str, limit: usize) -> Option<Vec<u8>> {
    // Native LibreOffice 24.8.7.2: sorted (Unicode, masked KS pair) u16 pairs.
    // Extended Hangul mappings can produce invalid ISO-2022 pairs; retain them.
    let table = include_bytes!("office_csv_iso2022kr/encode.bin")
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
    put(b"\x1b$)C")?;
    let mut shifted = false;
    for c in text.chars() {
        let cp = u32::from(c);
        let pair = u16::try_from(cp).ok().and_then(|cp| {
            table
                .binary_search_by_key(&cp, |r| u16::from_le_bytes([r[0], r[1]]))
                .ok()
                .map(|i| u16::from_le_bytes([table[i][2], table[i][3]]))
        });
        if shifted != pair.is_some() {
            put(if shifted { b"\x0f" } else { b"\x0e" })?;
            shifted = !shifted;
        }
        if let Some(pair) = pair {
            put(&pair.to_be_bytes())?;
        } else {
            let byte = match cp {
                0..=13 | 16..=26 | 28..=127 => cp as u8,
                0xe000..=0xf8ff | 0xf0000..=0xffffd | 0x100000..=0x10fffd => 0,
                _ => b'?',
            };
            put(&[byte])?;
        }
    }
    if shifted {
        put(b"\x0f")?;
    }
    Some(out)
}

pub(super) fn decode(bytes: &[u8], limit: usize) -> Option<String> {
    // Invalid pairs reset native decoding to ASCII. Later masked mapping bytes
    // may then become controls or escape sequences, even in our encoder's output.
    enum State {
        Ascii,
        Korean,
        Trail(u8),
        Escape,
        Dollar,
        Paren,
    }
    use State::*;
    let table = include_bytes!("office_csv_iso2022kr/decode.bin");
    let mut out = String::new();
    let mut put = |c: char| {
        if out.len().checked_add(c.len_utf8())? > limit {
            return None;
        }
        out.push(c);
        Some(())
    };
    let mut state = Ascii;
    for &byte in bytes {
        let (next, c) = match state {
            Ascii if byte == 14 => (Korean, None),
            Ascii if byte == 27 => (Escape, None),
            Ascii if byte < 128 => (Ascii, Some(char::from(byte))),
            Korean if byte == 15 => (Ascii, None),
            Korean if (0x21..=0x7e).contains(&byte) => (Trail(byte), None),
            Trail(row) if (0x21..=0x7e).contains(&byte) => {
                let index = (usize::from(row - 0x21) * 94 + usize::from(byte - 0x21)) * 2;
                let unit = u16::from_le_bytes([table[index], table[index + 1]]);
                if unit == 0 {
                    (Ascii, Some('\u{fffd}'))
                } else {
                    (Korean, Some(char::from_u32(u32::from(unit))?))
                }
            }
            Escape if byte == b'$' => (Dollar, None),
            Dollar if byte == b')' => (Paren, None),
            Paren if byte == b'C' => (Ascii, None),
            _ => (Ascii, Some('\u{fffd}')),
        };
        state = next;
        if let Some(c) = c {
            put(c)?;
        }
    }
    if !matches!(state, Ascii | Korean) {
        put('\u{fffd}')?;
    }
    Some(out)
}
