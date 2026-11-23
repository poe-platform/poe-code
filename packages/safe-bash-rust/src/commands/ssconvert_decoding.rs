//! GOffice text decoding: override, detected Unicode, UTF-8, then Latin-1.
use super::encoding::{Error, tables};

fn utf16(mut units: impl Iterator<Item = u16>, streaming: bool) -> Option<String> {
    let mut out = String::new();
    while let Some(unit) = units.next() {
        let point = if (0xd800..=0xdbff).contains(&unit) {
            let low = match units.next() {
                Some(low) if (0xdc00..=0xdfff).contains(&low) => low,
                None if streaming => break,
                _ => return None,
            };
            0x10000 + (u32::from(unit) - 0xd800) * 1024 + u32::from(low) - 0xdc00
        } else {
            u32::from(unit)
        };
        out.push(char::from_u32(point)?);
    }
    Some(out)
}

fn utf7(bytes: &[u8]) -> Option<String> {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    let mut at = 0;
    while let Some(&byte) = bytes.get(at) {
        at += 1;
        if byte > 127 {
            return None;
        }
        if byte != b'+' {
            out.push(char::from(byte));
            continue;
        }
        if bytes.get(at) == Some(&b'-') {
            out.push('+');
            at += 1;
            continue;
        }
        let start = at;
        let (mut accumulator, mut bits) = (0u32, 0);
        let mut units = Vec::new();
        while let Some(value) = bytes
            .get(at)
            .and_then(|b| alphabet.iter().position(|a| a == b))
        {
            at += 1;
            accumulator = accumulator * 64 + value as u32;
            bits += 6;
            if bits >= 16 {
                bits -= 16;
                units.push((accumulator >> bits) as u16);
                accumulator &= (1 << bits) - 1;
            }
        }
        let complete = at < bytes.len();
        if complete && (at == start || bits > 4 || accumulator != 0) {
            return None;
        }
        out.push_str(&utf16(units.into_iter(), !complete)?);
        if bytes.get(at) == Some(&b'-') {
            at += 1;
        }
    }
    Some(out)
}

fn attempt(bytes: &[u8], name: &str) -> Option<String> {
    if let Ok(index) = tables::DECODING.binary_search_by_key(&name, |row| row.0) {
        let table = tables::DECODING[index].1;
        let mut out = String::new();
        for &b in bytes {
            let unit = table[usize::from(b)];
            if unit == 0xffff {
                return None;
            }
            out.push(char::from_u32(u32::from(unit))?);
        }
        return Some(out);
    }
    if name == "shift_jis" {
        let mut out = String::new();
        let mut bytes = bytes.iter();
        while let Some(&byte) = bytes.next() {
            let point = match byte {
                0x5c => 0xa5,
                0x7e => 0x203e,
                0..=0x7f => u32::from(byte),
                0xa1..=0xdf => u32::from(byte) + 0xfec0,
                0x81..=0x9f | 0xe0..=0xea => {
                    let Some(&trail) = bytes.next() else { break };
                    let pair = u16::from_be_bytes([byte, trail]);
                    let index = tables::SHIFT_JIS_DECODING
                        .binary_search_by_key(&pair, |row| row.0)
                        .ok()?;
                    u32::from(tables::SHIFT_JIS_DECODING[index].1)
                }
                _ => return None,
            };
            out.push(char::from_u32(point)?);
        }
        return Some(out);
    }
    if matches!(name, "utf-7" | "utf7") {
        return utf7(bytes);
    }
    if matches!(
        name,
        "utf-32" | "utf-32le" | "utf-32be" | "ucs-4" | "ucs-4le" | "ucs-4be"
    ) {
        let little =
            name.ends_with("le") || name == "utf-32" && !bytes.starts_with(&[0, 0, 254, 255]);
        let mut out = String::new();
        for (i, bytes) in bytes.chunks_exact(4).enumerate() {
            let bytes = bytes.try_into().ok()?;
            let point = if little {
                u32::from_le_bytes(bytes)
            } else {
                u32::from_be_bytes(bytes)
            };
            let c = char::from_u32(point)?;
            if i > 0 || c != '\u{feff}' {
                out.push(c);
            }
        }
        return Some(out);
    }
    if name == "utf-8" {
        let text = match std::str::from_utf8(bytes) {
            Ok(text) => text,
            Err(error) if error.error_len().is_none() => {
                std::str::from_utf8(&bytes[..error.valid_up_to()]).ok()?
            }
            Err(_) => return None,
        };
        return Some(text.strip_prefix('\u{feff}').unwrap_or(text).to_owned());
    }
    if matches!(
        name,
        "utf-16" | "utf-16le" | "utf-16be" | "ucs-2" | "ucs-2le" | "ucs-2be"
    ) {
        let big = name.ends_with("be") || name == "utf-16" && bytes.starts_with(&[254, 255]);
        let units = bytes.chunks_exact(2).map(|bytes| {
            let pair = [bytes[0], bytes[1]];
            if big {
                u16::from_be_bytes(pair)
            } else {
                u16::from_le_bytes(pair)
            }
        });
        if name.starts_with("ucs-2") && units.clone().any(|u| (0xd800..=0xdfff).contains(&u)) {
            return None;
        }
        let mut text = utf16(units, true)?;
        if text.starts_with('\u{feff}') {
            text.drain(..3);
        }
        return Some(text);
    }
    None
}

pub(in super::super) fn decode(bytes: &[u8], encoding: Option<&str>) -> Result<String, Error> {
    let supplied = encoding.map(str::to_lowercase);
    let name = supplied.as_deref().map(|name| {
        tables::ALIASES
            .binary_search_by_key(&name, |row| row.0)
            .map_or(name, |i| tables::ALIASES[i].1)
    });
    if let Some(name) = name
        && tables::DECODING
            .binary_search_by_key(&name, |row| row.0)
            .is_err()
        && !matches!(
            name,
            "utf-8"
                | "utf-16"
                | "utf-16le"
                | "utf-16be"
                | "utf-32"
                | "utf-32le"
                | "utf-32be"
                | "ucs-2"
                | "ucs-2le"
                | "ucs-2be"
                | "ucs-4"
                | "ucs-4le"
                | "ucs-4be"
                | "utf-7"
                | "shift_jis"
        )
        && tables::NATIVE
            .binary_search(&supplied.as_deref().unwrap().split("//").next().unwrap())
            .is_ok()
    {
        return Err(Error::Unsupported);
    }
    let detected = if bytes.starts_with(&[255, 254]) || bytes.starts_with(&[60, 0, 63, 0]) {
        Some("utf-16le")
    } else if bytes.starts_with(&[254, 255]) || bytes.starts_with(&[0, 60, 0, 63]) {
        Some("utf-16be")
    } else {
        None
    };
    let text = [name, detected, Some("utf-8")]
        .into_iter()
        .flatten()
        .find_map(|guess| attempt(bytes, guess))
        .unwrap_or_else(|| bytes.iter().map(|&b| char::from(b)).collect());
    Ok(text)
}

pub(in super::super) fn probe(bytes: &[u8], filename: &str) -> bool {
    if bytes.starts_with(b"ID;") {
        return false;
    }
    if bytes.is_empty() {
        return filename.rsplit_once('.').is_some_and(|(_, ext)| {
            matches!(ext.to_ascii_lowercase().as_str(), "csv" | "tsv" | "txt")
        });
    }
    let text = decode(&bytes[..bytes.len().min(512)], None).unwrap();
    for (i, c) in text.chars().take_while(|&c| c != '\0').enumerate() {
        if matches!(c, '\n' | '\t' | '\r') || i == 0 && c == '\u{feff}' {
            continue;
        }
        let point = c as u32;
        let at = tables::NONPRINTING.partition_point(|&(start, _)| start <= point);
        if at > 0 && point <= tables::NONPRINTING[at - 1].1 {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{
        archive::sha256_bytes,
        structured::{JVal, parse_json_stream},
    };

    fn field<'a>(value: &'a JVal, key: &str) -> &'a JVal {
        let JVal::Object(fields) = value else {
            panic!("object")
        };
        &fields.iter().find(|(name, _)| name == key).unwrap().1
    }
    fn string(value: &JVal) -> &str {
        let JVal::Str(s) = value else {
            panic!("string")
        };
        s
    }
    fn array(value: &JVal) -> &[JVal] {
        let JVal::Array(a) = value else {
            panic!("array")
        };
        a
    }
    fn bytes(value: &JVal) -> Vec<u8> {
        string(value)
            .as_bytes()
            .chunks_exact(2)
            .map(|b| u8::from_str_radix(std::str::from_utf8(b).unwrap(), 16).unwrap())
            .collect()
    }

    #[test]
    fn decoded_bytes_pairs_unicode_and_aliases_match_production() {
        let data = parse_json_stream(include_str!(
            "../../tests/fixtures/ssconvert-decoder-production.json"
        ))
        .unwrap();
        let data = &data[0];
        for case in array(field(data, "cases")) {
            let charset = string(field(case, "charset"));
            let corpus = string(field(case, "corpus"));
            let mut output = Vec::new();
            let mut length = 0;
            for input in array(field(field(data, "corpora"), corpus)) {
                let decoded = decode(&bytes(input), Some(charset)).unwrap();
                length += decoded.len();
                output.extend_from_slice(&(decoded.len() as u32).to_le_bytes());
                output.extend_from_slice(decoded.as_bytes());
            }
            let JVal::Number(expected_length, _) = field(case, "length") else {
                panic!("length")
            };
            assert_eq!(length, *expected_length as usize, "{charset} {corpus}");
            let hash: String = sha256_bytes(&output)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            assert_eq!(hash, string(field(case, "sha256")), "{charset} {corpus}");
        }
        for case in array(field(data, "aliases")) {
            let charset = string(field(case, "charset"));
            let result = decode(&[0x41, 0xe9, 0x82, 0xa0, 0xff, 0xfe, 0, 0], Some(charset));
            match field(case, "expected") {
                JVal::Str(expected) => assert_eq!(result.unwrap(), *expected, "{charset}"),
                expected => {
                    assert_eq!(result, Err(Error::Unsupported), "{charset}");
                    assert_eq!(
                        string(field(expected, "error")),
                        "Unsupported ssconvert feature: uncaptured import charset",
                        "{charset}"
                    );
                }
            }
        }
    }
}
