//! Gnumeric text-export conversion, using the production encoder's measured tables.
use std::collections::BTreeMap;

#[path = "ssconvert_encoding_tables.rs"]
pub(super) mod tables;

#[derive(Debug, PartialEq)]
pub(in super::super) enum Error {
    Unavailable,
    Unsupported,
    Limit,
}

pub(in super::super) fn locale(env: &BTreeMap<String, String>) -> Result<&'static str, String> {
    let mut ctype = "C";
    for category in ["LC_NUMERIC", "LC_CTYPE", "LC_TIME"] {
        let name = ["LC_ALL", category, "LANG"]
            .into_iter()
            .filter_map(|key| env.get(key))
            .find(|value| !value.is_empty())
            .map_or("C", String::as_str);
        let resolved = match name {
            "C" | "POSIX" => "C",
            "C.UTF-8" | "C.utf8" => "C.UTF-8",
            "en_US" => "en_US",
            "en_US.UTF-8" | "en_US.utf8" => "en_US.UTF-8",
            _ => {
                return Err(format!(
                    "Unsupported ssconvert feature: uncaptured runtime locale {name}\n"
                ));
            }
        };
        if category == "LC_CTYPE" {
            ctype = resolved;
        }
    }
    Ok(ctype)
}

fn replacement(table: &'static [(u32, &str)], point: u32) -> Option<&'static str> {
    table
        .binary_search_by_key(&point, |row| row.0)
        .ok()
        .map(|i| table[i].1)
}

fn escape(c: char) -> String {
    if c <= '\u{ffff}' {
        format!("\\u{:04x}", c as u32)
    } else {
        format!("\\U{:08x}", c as u32)
    }
}

pub(in super::super) fn encode(
    text: &str,
    charset: &str,
    mut transliterate: bool,
    locale: &str,
    limit: usize,
) -> Result<Vec<u8>, Error> {
    let supplied = charset.to_lowercase();
    let mut parts = supplied.split("//");
    let base = parts.next().unwrap();
    let suffix = supplied.contains("//") && parts.all(|part| part == "translit");
    transliterate |= suffix;
    let base = if suffix { base } else { &supplied };
    let name = if base.is_empty() {
        match locale {
            "C" => "ascii",
            "en_US" => "iso-8859-1",
            _ => "utf-8",
        }
    } else {
        tables::ALIASES
            .binary_search_by_key(&base, |row| row.0)
            .map_or(base, |i| tables::ALIASES[i].1)
    };
    if matches!(name, "utf-8" | "utf8") {
        return if text.len() <= limit {
            Ok(text.as_bytes().to_vec())
        } else {
            Err(Error::Limit)
        };
    }
    let replacements = if locale == "C" {
        tables::C
    } else {
        tables::UTF8
    };
    let mut bytes = Vec::new();
    let mut append = |chunk: &[u8]| {
        if chunk.len() > limit.saturating_sub(bytes.len()) {
            return Err(Error::Limit);
        }
        bytes.extend_from_slice(chunk);
        Ok(())
    };
    if matches!(
        name,
        "utf-16" | "utf-16le" | "utf-16be" | "ucs-2" | "ucs-2le" | "ucs-2be"
    ) {
        let big = name == "utf-16" || name.ends_with("be");
        if name == "utf-16" {
            append(&[0xfe, 0xff])?;
        }
        for c in text.chars() {
            let escaped;
            let mut units = [0; 2];
            let units: &[u16] = if name.starts_with("ucs-2") && c > '\u{ffff}' {
                let replaced = if transliterate {
                    (locale != "C")
                        .then(|| replacement(tables::UCS2, c as u32))
                        .flatten()
                        .or_else(|| replacement(replacements, c as u32))
                        .unwrap_or("?")
                } else {
                    escaped = escape(c);
                    &escaped
                };
                for unit in replaced.encode_utf16() {
                    append(&if big {
                        unit.to_be_bytes()
                    } else {
                        unit.to_le_bytes()
                    })?;
                }
                continue;
            } else {
                c.encode_utf16(&mut units)
            };
            for unit in units {
                append(&if big {
                    unit.to_be_bytes()
                } else {
                    unit.to_le_bytes()
                })?;
            }
        }
    } else if matches!(
        name,
        "utf-32" | "utf-32le" | "utf-32be" | "ucs-4" | "ucs-4le" | "ucs-4be"
    ) {
        let big = matches!(name, "utf-32" | "ucs-4") || name.ends_with("be");
        if name == "utf-32" {
            append(&[0, 0, 0xfe, 0xff])?;
        }
        for c in text.chars() {
            append(&if big {
                (c as u32).to_be_bytes()
            } else {
                (c as u32).to_le_bytes()
            })?;
        }
    } else {
        let mapping = tables::MAPPINGS
            .binary_search_by_key(&name, |row| row.0)
            .map(|i| tables::MAPPINGS[i].1)
            .map_err(|_| {
                if tables::NATIVE
                    .binary_search(&supplied.split("//").next().unwrap())
                    .is_ok()
                {
                    Error::Unsupported
                } else {
                    Error::Unavailable
                }
            })?;
        let targets = if locale == "C" {
            tables::C_TARGETS
        } else {
            tables::UTF8_TARGETS
        };
        let target = targets
            .binary_search_by_key(&name, |row| row.0)
            .map_or(&[][..], |i| targets[i].1);
        for c in text.chars() {
            if let Ok(i) = mapping.binary_search_by_key(&(c as u32), |row| row.0) {
                let value = mapping[i].1;
                if value > 255 {
                    append(&[(value >> 8) as u8])?;
                }
                append(&[value as u8])?;
            } else {
                let escaped;
                let value = if transliterate {
                    replacement(target, c as u32)
                        .or_else(|| replacement(replacements, c as u32))
                        .unwrap_or("?")
                } else {
                    escaped = escape(c);
                    &escaped
                };
                for c in value.chars() {
                    // Production uses the low byte of each code point's first UTF-16 unit.
                    append(&[c.encode_utf16(&mut [0; 2])[0] as u8])?;
                }
            }
        }
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::archive::sha256_bytes;
    use crate::commands::structured::{JVal, parse_json_stream};

    fn field<'a>(value: &'a JVal, key: &str) -> &'a JVal {
        let JVal::Object(fields) = value else {
            panic!("object")
        };
        &fields.iter().find(|(name, _)| name == key).unwrap().1
    }
    fn string(value: &JVal) -> &str {
        let JVal::Str(value) = value else {
            panic!("string")
        };
        value
    }
    fn array(value: &JVal) -> &[JVal] {
        let JVal::Array(value) = value else {
            panic!("array")
        };
        value
    }

    #[test]
    fn encodings_transliterations_and_aliases_match_production() {
        let fixture = parse_json_stream(include_str!(
            "../../tests/fixtures/ssconvert-encoder-production.json"
        ))
        .unwrap();
        let fixture = &fixture[0];
        let input = string(field(fixture, "input"));
        for case in array(field(fixture, "cases")) {
            let charset = string(field(case, "charset"));
            let locale = string(field(case, "locale"));
            let transliterate = matches!(field(case, "transliterate"), JVal::Bool(true));
            let bytes = encode(input, charset, transliterate, locale, 1_000_000).unwrap();
            let JVal::Number(length, _) = field(case, "length") else {
                panic!("length")
            };
            assert_eq!(
                bytes.len(),
                *length as usize,
                "{charset} {locale} {transliterate}"
            );
            let hash: String = sha256_bytes(&bytes)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            assert_eq!(
                hash,
                string(field(case, "sha256")),
                "{charset} {locale} {transliterate}"
            );
        }
        for case in array(field(fixture, "aliases")) {
            let charset = string(field(case, "charset"));
            let actual: String = match encode("é ¥ 𝚨 😀", charset, false, "C", 1024) {
                Ok(bytes) => bytes.iter().map(|b| format!("{b:02x}")).collect(),
                Err(Error::Unavailable) => "unavailable".into(),
                Err(Error::Unsupported) => "unsupported".into(),
                Err(error) => panic!("{charset}: {error:?}"),
            };
            assert_eq!(actual, string(field(case, "expected")), "{charset}");
        }
    }
}
