use std::{borrow::Cow, collections::BTreeMap};

const NAMES: &[(&str, &str)] = &[
    ("TIT2", "title"),
    ("TPE1", "artist"),
    ("TPE2", "albumArtist"),
    ("TALB", "album"),
    ("TRCK", "track"),
    ("TPOS", "disc"),
    ("TCON", "genre"),
    ("TDRC", "date"),
    ("TYER", "date"),
    ("TCOP", "copyright"),
    ("TSSE", "encoder"),
    ("TT2", "title"),
    ("TP1", "artist"),
    ("TP2", "albumArtist"),
    ("TAL", "album"),
    ("TRK", "track"),
    ("TPA", "disc"),
    ("TCO", "genre"),
    ("TYE", "date"),
    ("TCR", "copyright"),
    ("TEN", "encoder"),
];
// Includes tag storage, the ordered index, and spare collection capacity.
const TAG_OVERHEAD: usize = 256;
const TRUNCATED: &str = "Truncated or invalid audio structure";

fn sync(bytes: &[u8]) -> Result<usize, &'static str> {
    let bytes = bytes.get(..4).ok_or(TRUNCATED)?;
    if bytes.iter().any(|b| b & 128 != 0) {
        return Err("Invalid ID3 synchsafe size");
    }
    Ok(bytes.iter().fold(0, |n, b| n * 128 + usize::from(*b)))
}
fn unsync(bytes: &[u8], limit: usize) -> Result<Vec<u8>, &'static str> {
    if bytes.len() > limit {
        return Err("ID3 exceeds memory budget");
    }
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while let Some(&b) = bytes.get(at) {
        out.push(b);
        at += 1;
        if b == 255 && bytes.get(at) == Some(&0) {
            at += 1;
        }
    }
    Ok(out)
}
fn text(bytes: &[u8], encoding: u8, limit: usize) -> Result<String, &'static str> {
    if bytes.len() > limit / 3 {
        return Err("ID3 text exceeds memory budget");
    }
    let text = match encoding {
        0 => bytes.iter().map(|&b| char::from(b)).collect(),
        3 => String::from_utf8_lossy(bytes.strip_prefix(&[239, 187, 191]).unwrap_or(bytes))
            .into_owned(),
        1 | 2 => {
            let big = encoding == 2 || bytes.starts_with(&[254, 255]);
            let bytes = if bytes.starts_with(if big { &[254, 255] } else { &[255, 254] }) {
                &bytes[2..]
            } else {
                bytes
            };
            let words = bytes.chunks_exact(2).map(|b| {
                if big {
                    u16::from_be_bytes([b[0], b[1]])
                } else {
                    u16::from_le_bytes([b[0], b[1]])
                }
            });
            let mut out: String = char::decode_utf16(words)
                .map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER))
                .collect();
            if bytes.len() % 2 != 0 {
                out.push(char::REPLACEMENT_CHARACTER);
            }
            out
        }
        _ => return Err("Invalid ID3 text encoding"),
    };
    Ok(text
        .split('\0')
        .next()
        .unwrap_or("")
        .trim_end_matches(|c: char| matches!(c, '\u{9}'..='\u{d}'|' '|'\u{a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}'))
        .to_owned())
}
fn terminated(bytes: &[u8], start: usize, encoding: u8) -> Result<usize, &'static str> {
    let width = if matches!(encoding, 1 | 2) { 2 } else { 1 };
    (start..bytes.len())
        .step_by(width)
        .find(|&i| {
            bytes
                .get(i..i + width)
                .is_some_and(|s| s.iter().all(|&b| b == 0))
        })
        .ok_or("Unterminated ID3 text field")
}
pub(super) fn read(
    bytes: &[u8],
    tags: &mut Vec<(String, String)>,
    limit: usize,
) -> Result<(), &'static str> {
    let header = bytes.get(..10).ok_or(TRUNCATED)?;
    let version = header[3];
    let flags = header[5];
    let length = sync(&header[6..])?;
    if !matches!(version, 2..=4) {
        return Err("Unsupported ID3 version");
    }
    if version == 2 && flags & 64 != 0 {
        return Err("Compressed ID3v2.2 tag unsupported");
    }
    let footer = version == 4 && flags & 16 != 0;
    let end = 10 + length;
    if bytes.len() < end + if footer { 10 } else { 0 } {
        return Err(TRUNCATED);
    }
    let payload = &bytes[10..end];
    let data = if flags & 128 != 0 && version < 4 {
        Cow::Owned(unsync(payload, limit)?)
    } else {
        Cow::Borrowed(payload)
    };
    let mut at = 0;
    if version >= 3 && flags & 64 != 0 {
        at = if version == 4 {
            sync(&data)?
        } else {
            (u32::from_be_bytes(data.get(..4).ok_or(TRUNCATED)?.try_into().unwrap()) as usize)
                .checked_add(4)
                .ok_or(TRUNCATED)?
        };
        if at > data.len() {
            return Err(TRUNCATED);
        }
        if at < if version == 3 { 10 } else { 6 } {
            return Err("Invalid ID3 extended header");
        }
    }
    frames(&data[at..], version, flags, tags, true, limit)?;
    if footer && bytes.get(end..end + 3) != Some(b"3DI") {
        return Err("Missing ID3 footer");
    }
    Ok(())
}
fn frames(
    mut bytes: &[u8],
    version: u8,
    flags: u8,
    tags: &mut Vec<(String, String)>,
    chapters: bool,
    limit: usize,
) -> Result<(), &'static str> {
    let mut used = tags
        .iter()
        .map(|(k, v)| k.len() * 2 + v.len() + TAG_OVERHEAD)
        .sum::<usize>();
    if used > limit {
        return Err("ID3 metadata exceeds memory budget");
    }
    let mut indices: BTreeMap<String, usize> = tags
        .iter()
        .enumerate()
        .map(|(i, (k, _))| (k.clone(), i))
        .collect();
    while bytes.first().is_some_and(|&b| b != 0) {
        let head = if version == 2 { 6 } else { 10 };
        let header = bytes.get(..head).ok_or(TRUNCATED)?;
        let id = header[..if version == 2 { 3 } else { 4 }]
            .iter()
            .map(|&b| char::from(b))
            .collect::<String>();
        let size = if version == 2 {
            usize::from(header[3]) * 65536 + usize::from(header[4]) * 256 + usize::from(header[5])
        } else if version == 4 {
            sync(&header[4..])?
        } else {
            u32::from_be_bytes(header[4..8].try_into().unwrap()) as usize
        };
        let frame_flags = if version == 2 {
            0
        } else {
            u16::from_be_bytes(header[8..10].try_into().unwrap())
        };
        let end = head.checked_add(size).ok_or(TRUNCATED)?;
        let data = bytes.get(head..end).ok_or(TRUNCATED)?;
        bytes = &bytes[end..];
        let data = if version == 4 && (flags & 128 != 0 || frame_flags & 2 != 0) {
            Cow::Owned(unsync(data, limit)?)
        } else {
            Cow::Borrowed(data)
        };
        let unsupported = frame_flags & if version == 3 { 0xc0 } else { 0x0c };
        if unsupported != 0 || data.is_empty() {
            continue;
        }
        let prefix = usize::from(
            version == 3 && frame_flags & 32 != 0 || version == 4 && frame_flags & 64 != 0,
        ) + if version == 4 && frame_flags & 1 != 0 {
            4
        } else {
            0
        };
        let data = data.get(prefix..).unwrap_or_default();
        let encoding = data.first().copied().unwrap_or(255);
        let pair = if id.starts_with('T') && !matches!(id.as_str(), "TXXX" | "TXX") {
            let name = NAMES
                .iter()
                .find(|&&(key, _)| key == id)
                .map_or(id.as_str(), |&(_, name)| name);
            Some((
                name.to_owned(),
                text(data.get(1..).unwrap_or_default(), encoding, limit)?,
            ))
        } else if matches!(id.as_str(), "TXXX" | "TXX") {
            let end = terminated(data, 1, encoding)?;
            let width = if matches!(encoding, 1 | 2) { 2 } else { 1 };
            Some((
                text(&data[1..end], encoding, limit)?,
                text(data.get(end + width..).unwrap_or_default(), encoding, limit)?,
            ))
        } else if matches!(id.as_str(), "COMM" | "COM") {
            let end = terminated(data, 4, encoding)?;
            let width = if matches!(encoding, 1 | 2) { 2 } else { 1 };
            Some((
                "comment".into(),
                text(data.get(end + width..).unwrap_or_default(), encoding, limit)?,
            ))
        } else if id == "PRIV" {
            use std::fmt::Write;
            let end = terminated(data, 0, 0)?;
            if data.len() > limit / 4 {
                return Err("ID3 private text exceeds memory budget");
            }
            let owner: String = data[..end].iter().map(|&b| char::from(b)).collect();
            let mut value = String::new();
            for &b in &data[end + 1..] {
                if !(32..=126).contains(&b) || b == 92 {
                    write!(value, "\\x{b:02x}").unwrap();
                } else {
                    value.push(char::from(b));
                }
            }
            Some((format!("id3v2_priv.{owner}"), value))
        } else {
            if id == "CHAP" && chapters {
                let start = terminated(data, 0, 0)? + 1;
                frames(
                    data.get(start + 16..).ok_or(TRUNCATED)?,
                    version,
                    0,
                    &mut Vec::new(),
                    false,
                    limit,
                )?;
            } else if matches!(id.as_str(), "APIC" | "PIC") {
                let mime_end = if id == "PIC" {
                    4
                } else {
                    terminated(data, 1, 0)?
                };
                if id == "PIC" {
                    data.get(1..4).ok_or(TRUNCATED)?;
                } else {
                    text(&data[1..mime_end], 0, limit)?;
                }
                let start = if id == "PIC" { 5 } else { mime_end + 2 };
                let end = terminated(data, start, encoding)?;
                text(&data[start..end], encoding, limit)?;
            }
            None
        };
        if let Some((key, value)) = pair {
            let index = indices.get(&key).copied();
            let next = if let Some(i) = index {
                used.saturating_sub(tags[i].1.len())
                    .saturating_add(value.len())
            } else {
                used.saturating_add(key.len().saturating_mul(2))
                    .saturating_add(value.len())
                    .saturating_add(TAG_OVERHEAD)
            };
            if next > limit {
                return Err("ID3 metadata exceeds memory budget");
            }
            used = next;
            if let Some(i) = index {
                tags[i].1 = value;
            } else {
                indices.insert(key.clone(), tags.len());
                tags.push((key, value));
            }
        }
    }
    Ok(())
}
fn encode_text(value: &str, version: u8, out: &mut Vec<u8>) {
    if version == 4 {
        out.extend_from_slice(value.as_bytes());
    } else {
        out.extend_from_slice(&[255, 254]);
        for word in value.encode_utf16() {
            out.extend_from_slice(&word.to_le_bytes());
        }
    }
}
fn sync_bytes(value: usize) -> Result<[u8; 4], &'static str> {
    if value > 0x0fffffff {
        return Err("ID3 tag too large");
    }
    Ok([
        (value >> 21) as u8 & 127,
        (value >> 14) as u8 & 127,
        (value >> 7) as u8 & 127,
        value as u8 & 127,
    ])
}
pub(super) fn write(
    tags: &[(String, String)],
    version: u8,
    limit: usize,
) -> Result<Vec<u8>, &'static str> {
    if !matches!(version, 3 | 4) {
        return Err("Unsupported ID3 version");
    }
    if limit < 10 {
        return Err("ID3 exceeds memory budget");
    }
    let mut out = vec![73, 68, 51, version, 0, 0, 0, 0, 0, 0];
    if tags.len() > limit / TAG_OVERHEAD {
        return Err("ID3 metadata exceeds memory budget");
    }
    let mut values: BTreeMap<&str, (&str, usize)> = BTreeMap::new();
    for (i, (key, value)) in tags.iter().enumerate() {
        values
            .entry(key)
            .and_modify(|(v, _)| *v = value)
            .or_insert((value, i));
    }
    for (i, (key, _)) in tags.iter().enumerate() {
        let &(value, first) = values.get(key.as_str()).unwrap();
        if first != i {
            continue;
        }
        if value.is_empty() {
            continue;
        }
        let id = if version == 3 && key == "date" {
            "TYER"
        } else {
            NAMES
                .iter()
                .find(|&&(id, name)| id.len() == 4 && name == key)
                .map_or(key.as_str(), |&(id, _)| id)
        };
        let ordinary = id.len() == 4 && id.starts_with('T') && id != "TXXX";
        let width = if version == 3 { 2 } else { 1 };
        let encoded_len = |s: &str| {
            if version == 3 {
                2 + s.encode_utf16().count() * 2
            } else {
                s.len()
            }
        };
        let size = 1
            + encoded_len(value)
            + if key == "comment" {
                3 + width
            } else if ordinary {
                0
            } else {
                encoded_len(key) + width
            };
        if out.len().saturating_add(10).saturating_add(size) > limit {
            return Err("ID3 exceeds memory budget");
        }
        out.extend_from_slice(if key == "comment" {
            b"COMM"
        } else if ordinary {
            id.as_bytes()
        } else {
            b"TXXX"
        });
        out.extend_from_slice(&if version == 4 {
            sync_bytes(size)?
        } else {
            u32::try_from(size)
                .map_err(|_| "ID3 tag too large")?
                .to_be_bytes()
        });
        out.extend_from_slice(&[0, 0, if version == 3 { 1 } else { 3 }]);
        if key == "comment" {
            out.extend_from_slice(b"eng");
            out.resize(out.len() + width, 0);
        } else if !ordinary {
            encode_text(key, version, &mut out);
            out.resize(out.len() + width, 0);
        }
        encode_text(value, version, &mut out);
    }
    let size = sync_bytes(out.len() - 10)?;
    out[6..10].copy_from_slice(&size);
    Ok(out)
}
