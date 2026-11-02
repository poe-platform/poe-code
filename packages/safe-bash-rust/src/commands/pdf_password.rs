// PDF.js SASLprep mappings followed by Unicode NFKC, truncated to 127 UTF-8 bytes.
use std::collections::BTreeMap;
#[path = "pdf_normalization_data.rs"]
mod data;
use data::{CLASSES, COMPOSE, DECOMPOSE, SCALARS};

fn composition(a: char, b: char) -> Option<char> {
    let (a, b) = (a as u32, b as u32);
    let scalar = if (0x1100..0x1113).contains(&a) && (0x1161..0x1176).contains(&b) {
        0xac00 + (a - 0x1100) * 588 + (b - 0x1161) * 28
    } else if (0xac00..0xd7a4).contains(&a)
        && (a - 0xac00).is_multiple_of(28)
        && (0x11a8..0x11c3).contains(&b)
    {
        a + b - 0x11a7
    } else {
        COMPOSE[COMPOSE
            .binary_search_by_key(&(a, b), |&(x, y, _)| (x, y))
            .ok()?]
        .2
    };
    char::from_u32(scalar)
}

pub(super) fn prepared(password: &str) -> Vec<u8> {
    let decomposed = password
        .chars()
        .filter_map(|c| match c as u32 {
            0xa0 | 0x1680 | 0x2000..=0x200b | 0x202f | 0x205f | 0x3000 => Some(' '),
            0xad
            | 0x34f
            | 0x1806
            | 0x180b..=0x180d
            | 0x200c..=0x200d
            | 0x2060
            | 0xfe00..=0xfe0f
            | 0xfeff => None,
            _ => Some(c),
        })
        .flat_map(|c| {
            let (single, slice) =
                if let Ok(i) = DECOMPOSE.binary_search_by_key(&(c as u32), |v| v.0) {
                    let (_, offset, len) = DECOMPOSE[i];
                    (
                        None,
                        &SCALARS[offset as usize..offset as usize + len as usize],
                    )
                } else {
                    // Precomposed Hangul syllables are already NFKC. An LV can still combine with a T.
                    (Some(c), &[][..])
                };
            single.into_iter().chain(slice.iter().copied())
        });
    let mut out = Vec::with_capacity(127);
    let mut starter = None;
    let mut marks = BTreeMap::<u8, Vec<char>>::new();
    for next in decomposed.map(Some).chain([None]) {
        if let Some(c) = next
            && let Ok(i) = CLASSES.binary_search_by_key(&(c as u32), |v| v >> 8)
        {
            let bucket = marks.entry(CLASSES[i] as u8).or_default();
            // Fewer than 128 marks can compose into one Unicode scalar. After
            // 127 more uncomposed bytes, later marks of this class cannot affect the password.
            if bucket.len() < 255 {
                bucket.push(c);
            }
            continue;
        }
        let mut tail = Vec::new();
        for (_, group) in std::mem::take(&mut marks) {
            let mut blocked = false;
            for c in group {
                if !blocked && let Some(v) = starter.and_then(|s| composition(s, c)) {
                    starter = Some(v);
                } else {
                    blocked = true;
                    if tail.len() < 127 {
                        tail.push(c);
                    }
                }
            }
        }
        if tail.is_empty()
            && let Some(v) = starter.zip(next).and_then(|(a, b)| composition(a, b))
        {
            starter = Some(v);
            continue;
        }
        for c in starter.into_iter().chain(tail) {
            out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
            if out.len() >= 127 {
                out.truncate(127);
                return out;
            }
        }
        starter = next;
    }
    out
}
