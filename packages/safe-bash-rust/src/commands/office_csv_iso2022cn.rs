pub(super) fn encode(text: &str, limit: usize) -> Option<Vec<u8>> {
    // Native LibreOffice 24.8.7.2: sorted u16 (Unicode, GB, CNS-1, CNS-2).
    let table = include_bytes!("office_csv_iso2022cn/encode.bin")
        .as_chunks::<8>()
        .0;
    let mut out = Vec::new();
    let mut put = |bytes: &[u8]| {
        if out.len().checked_add(bytes.len())? > limit {
            return None;
        }
        out.extend_from_slice(bytes);
        Some(())
    };
    // G1 designation: zero is unset, one is GB2312, two is CNS plane 1.
    let (mut set, mut plane2, mut shifted) = (0, false, false);
    for c in text.chars() {
        let cp = u32::from(c);
        let [gb, cns1, cns2] = u16::try_from(cp)
            .ok()
            .and_then(|cp| {
                table
                    .binary_search_by_key(&cp, |r| u16::from_le_bytes([r[0], r[1]]))
                    .ok()
                    .map(|i| {
                        let r = &table[i];
                        [
                            u16::from_le_bytes([r[2], r[3]]),
                            u16::from_le_bytes([r[4], r[5]]),
                            u16::from_le_bytes([r[6], r[7]]),
                        ]
                    })
            })
            .unwrap_or([0; 3]);
        let choice = if set == 2 && cns1 != 0 {
            Some((2, cns1))
        } else if gb != 0 {
            Some((1, gb))
        } else if cns1 != 0 {
            Some((2, cns1))
        } else {
            None
        };
        if let Some((next, pair)) = choice {
            if next != set {
                if shifted {
                    put(b"\x0f")?;
                    shifted = false;
                }
                put(if next == 1 { b"\x1b$)A" } else { b"\x1b$)G" })?;
                set = next;
            }
            if !shifted {
                put(b"\x0e")?;
                shifted = true;
            }
            put(&pair.to_be_bytes())?;
        } else if cns2 != 0 {
            if !plane2 {
                put(b"\x1b$*H")?;
                plane2 = true;
            }
            put(b"\x1bN")?;
            put(&cns2.to_be_bytes())?;
        } else {
            if shifted {
                put(b"\x0f")?;
                shifted = false;
                // Native resets designations only if CR/LF leaves a shifted run.
                if matches!(cp, 10 | 13) {
                    set = 0;
                    plane2 = false;
                }
            }
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
    // CSV decodes only this encoder's valid streams. Native GB/CNS plane-1/2
    // tables are three 94x94 grids of BMP units, with FFFF for undefined pairs.
    let table = include_bytes!("office_csv_iso2022cn/decode.bin");
    let (mut pos, mut cns1, mut shifted) = (0, false, false);
    let mut out = String::new();
    while pos < bytes.len() {
        let plane = match bytes[pos] {
            14 => {
                shifted = true;
                pos += 1;
                continue;
            }
            15 => {
                shifted = false;
                pos += 1;
                continue;
            }
            27 => {
                let rest = &bytes[pos..];
                if rest.starts_with(b"\x1b$)A") || rest.starts_with(b"\x1b$)G") {
                    cns1 = rest[3] == b'G';
                    pos += 4;
                    continue;
                }
                if rest.starts_with(b"\x1b$*H") {
                    pos += 4;
                    continue;
                }
                if !rest.starts_with(b"\x1bN") {
                    return None;
                }
                pos += 2;
                Some(2)
            }
            _ if shifted => Some(usize::from(cns1)),
            _ => None,
        };
        let c = if let Some(plane) = plane {
            let pair = bytes.get(pos..pos.checked_add(2)?)?;
            if !pair.iter().all(|b| (0x21..=0x7e).contains(b)) {
                return None;
            }
            let index =
                ((plane * 94 + usize::from(pair[0] - 0x21)) * 94 + usize::from(pair[1] - 0x21)) * 2;
            let unit = u16::from_le_bytes([table[index], table[index + 1]]);
            if unit == 0xffff {
                return None;
            }
            pos += 2;
            char::from_u32(u32::from(unit))?
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
