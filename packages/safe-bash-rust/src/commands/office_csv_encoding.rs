#[path = "office_csv_codepages.rs"]
mod codepages;
#[path = "office_csv_gb18030.rs"]
mod gb18030;
#[path = "office_csv_iso2022cn.rs"]
mod iso2022cn;
#[path = "office_csv_iso2022jp.rs"]
mod iso2022jp;
#[path = "office_csv_iso2022kr.rs"]
mod iso2022kr;
#[path = "office_csv_utf7.rs"]
pub(super) mod utf7;

pub(in crate::commands) enum Encoding {
    Utf8,
    Utf7,
    JavaUtf8,
    Utf16,
    Utf16LowByte,
    Gb18030,
    Iso2022Cn,
    Iso2022Jp,
    Iso2022Kr,
    Page(&'static [(u16, u16)]),
    // The final flag selects native recovery that consumes an invalid pair.
    Multibyte(&'static [[u8; 12]], Option<&'static [u8]>, bool),
}

// Native converters either consume or retry the unit after an unmatched high
// surrogate. Raw-unit encodings bypass this conversion.
pub(in super::super) fn text_from_units(
    units: impl Iterator<Item = u16>,
    consume_after_high: bool,
    limit: usize,
) -> Option<String> {
    let mut units = units.peekable();
    let mut text = String::new();
    while let Some(unit) = units.next() {
        let c = if (0xd800..=0xdbff).contains(&unit) {
            let Some(&low) = units.peek() else { break };
            if (0xdc00..=0xdfff).contains(&low) {
                units.next();
                char::from_u32(
                    0x10000 + (u32::from(unit) - 0xd800) * 1024 + u32::from(low) - 0xdc00,
                )?
            } else {
                if consume_after_high {
                    units.next();
                }
                '?'
            }
        } else {
            char::from_u32(u32::from(unit)).unwrap_or('?')
        };
        if text.len().checked_add(c.len_utf8())? > limit {
            return None;
        }
        text.push(c);
    }
    Some(text)
}

impl Encoding {
    pub(super) fn decode(&self, bytes: &[u8], limit: usize) -> Option<String> {
        if matches!(self, Self::Iso2022Cn) {
            return iso2022cn::decode(bytes, limit);
        }
        if matches!(self, Self::Iso2022Kr) {
            return iso2022kr::decode(bytes, limit);
        }
        if matches!(self, Self::Iso2022Jp) {
            return iso2022jp::decode(bytes, limit);
        }
        if matches!(self, Self::Gb18030) {
            return gb18030::decode(bytes, limit);
        }
        let Self::Multibyte(_, Some(data), _) = self else {
            return None;
        };
        // The first 512 bytes hold end-of-input results for each single byte.
        // Remaining records are (u16 pair-range start, u16 Unicode, u16 consumed).
        // Native decoder steps emit one BMP character and consume one or two bytes.
        let pairs = data[512..].as_chunks::<6>().0;
        let mut out = String::new();
        let mut pos = 0;
        while pos < bytes.len() {
            let (cp, consumed) = if pos + 1 == bytes.len() {
                let index = usize::from(bytes[pos]) * 2;
                (
                    u16::from_le_bytes(data[index..index + 2].try_into().ok()?),
                    1,
                )
            } else {
                let key = u16::from_be_bytes([bytes[pos], bytes[pos + 1]]);
                let index = pairs
                    .partition_point(|r| u16::from_le_bytes(r[..2].try_into().unwrap()) <= key);
                let record = pairs.get(index.checked_sub(1)?)?;
                (
                    u16::from_le_bytes(record[2..4].try_into().ok()?),
                    usize::from(u16::from_le_bytes(record[4..6].try_into().ok()?)),
                )
            };
            let c = char::from_u32(u32::from(cp))?;
            if out.len().checked_add(c.len_utf8())? > limit {
                return None;
            }
            out.push(c);
            pos += consumed;
        }
        Some(out)
    }

    pub(super) fn parse(name: &str) -> Result<Self, &'static str> {
        let id = if name.bytes().all(|b| b.is_ascii_digit()) {
            let value = name.parse::<i32>().unwrap_or(0);
            // Native resolves zero to the default encoding before narrowing.
            // A nonzero value that wraps to zero keeps the missing-converter path.
            if value == 0 { 76 } else { value as u16 }
        } else {
            match name.to_ascii_uppercase().as_str() {
                "ANSI" => 1,
                "MAC" => 2,
                "IBMPC_437" => 3,
                "IBMPC" | "IBMPC_850" => 4,
                "IBMPC_860" => 5,
                "IBMPC_861" => 6,
                "IBMPC_863" => 7,
                "IBMPC_865" => 8,
                _ => 76,
            }
        };
        // These native encodings only provide encoders. Calc always decodes
        // delimiters during CSV setup, so all three fail even with no quotes.
        if matches!(id, 81..=83) {
            return Err("CSV encoding does not support decoding");
        }
        // Native CSV passes null contexts when converting delimiters. ISCII
        // requires a context and fails during setup, including disabled quotes.
        if id == 89 {
            return Err("CSV encoding cannot be exported");
        }
        Ok(Self::from_id(id))
    }

    fn from_id(id: u16) -> Self {
        if id == 65535 {
            Self::Utf16
        } else if matches!(id, 0 | 9 | 41 | 45 | 46 | 48..=50 | 53 | 97..=65534) {
            Self::Utf16LowByte
        } else if id == 72 {
            Self::Iso2022Jp
        } else if id == 73 {
            Self::Iso2022Cn
        } else if id == 80 {
            Self::Iso2022Kr
        } else if id == 75 {
            Self::Utf7
        } else if id == 90 {
            Self::JavaUtf8
        } else if id == 85 {
            Self::Gb18030
        } else if let Some(page) = codepages::page(id) {
            Self::Page(page)
        } else {
            // Native LibreOffice 24.8.7.2 mappings, including default substitutions.
            // Each sorted record contains a Unicode range start, (end << 3 | byte
            // length), and up to four output bytes. Integers are little-endian.
            let (table, decoder): (&[u8], Option<&[u8]>) = match id {
                81 => (include_bytes!("office_csv_multibyte/jis-81.bin"), None),
                82 => (include_bytes!("office_csv_multibyte/jis-82.bin"), None),
                83 => (include_bytes!("office_csv_multibyte/jis-83.bin"), None),
                10 => (
                    include_bytes!("office_csv_symbols/10-encode.bin"),
                    Some(include_bytes!("office_csv_symbols/10-decode.bin")),
                ),
                91 => (
                    include_bytes!("office_csv_symbols/91-encode.bin"),
                    Some(include_bytes!("office_csv_symbols/91-decode.bin")),
                ),
                92 => (
                    include_bytes!("office_csv_symbols/92-encode.bin"),
                    Some(include_bytes!("office_csv_symbols/92-decode.bin")),
                ),
                94 => (
                    include_bytes!("office_csv_symbols/94-encode.bin"),
                    Some(include_bytes!("office_csv_symbols/94-decode.bin")),
                ),
                56 => (
                    include_bytes!("office_csv_multibyte/mac-chinese-simplified.bin"),
                    None,
                ),
                65 | 70 => (include_bytes!("office_csv_multibyte/gb2312.bin"), None),
                66 => (include_bytes!("office_csv_multibyte/gbt12345.bin"), None),
                69 => (include_bytes!("office_csv_multibyte/euc-jp.bin"), None),
                71 => (include_bytes!("office_csv_multibyte/euc-tw.bin"), None),
                79 => (include_bytes!("office_csv_multibyte/euc-kr.bin"), None),
                57 => (
                    include_bytes!("office_csv_dbcs/57-encode.bin"),
                    Some(include_bytes!("office_csv_dbcs/57-decode.bin")),
                ),
                58 => (
                    include_bytes!("office_csv_dbcs/58-encode.bin"),
                    Some(include_bytes!("office_csv_dbcs/58-decode.bin")),
                ),
                59 | 62 => (
                    include_bytes!("office_csv_dbcs/59-encode.bin"),
                    Some(include_bytes!("office_csv_dbcs/59-decode.bin")),
                ),
                60 | 64 => (
                    include_bytes!("office_csv_dbcs/60-encode.bin"),
                    Some(include_bytes!("office_csv_dbcs/60-decode.bin")),
                ),
                61 => (
                    include_bytes!("office_csv_dbcs/61-encode.bin"),
                    Some(include_bytes!("office_csv_dbcs/61-decode.bin")),
                ),
                63 => (
                    include_bytes!("office_csv_dbcs/63-encode.bin"),
                    Some(include_bytes!("office_csv_dbcs/63-decode.bin")),
                ),
                67 => (
                    include_bytes!("office_csv_dbcs/67-encode.bin"),
                    Some(include_bytes!("office_csv_dbcs/67-decode.bin")),
                ),
                68 => (
                    include_bytes!("office_csv_dbcs/63-encode.bin"),
                    Some(include_bytes!("office_csv_dbcs/68-decode.bin")),
                ),
                84 => (
                    include_bytes!("office_csv_dbcs/84-encode.bin"),
                    Some(include_bytes!("office_csv_dbcs/84-decode.bin")),
                ),
                86 => (
                    include_bytes!("office_csv_dbcs/86-encode.bin"),
                    Some(include_bytes!("office_csv_dbcs/86-decode.bin")),
                ),
                _ => return Self::Utf8,
            };
            Self::Multibyte(
                table.as_chunks::<12>().0,
                decoder,
                matches!(id, 71 | 86 | 91 | 92 | 94),
            )
        }
    }

    pub(super) fn encode_unit(&self, unit: u16, limit: usize) -> Option<Vec<u8>> {
        if matches!(self, Self::Utf7) {
            return utf7::encode([unit], limit);
        }
        if let Some(c) = char::from_u32(u32::from(unit)) {
            return self.encode(c.encode_utf8(&mut [0; 4]), limit);
        }
        if matches!(self, Self::Iso2022Kr) {
            // Even a dropped high surrogate emits the native Korean header.
            return iso2022kr::encode(if unit < 0xdc00 { "" } else { "?" }, limit);
        }
        // Delimiters are individual UTF-16 units, including lone surrogates.
        // Most native converters drop a trailing high surrogate and replace a
        // low surrogate. Java UTF-8 encodes either unit in three bytes; UTF-16
        // streams and missing converters preserve raw units.
        let raw = unit.to_le_bytes();
        let java = [
            0xe0 | (unit >> 12) as u8,
            0x80 | ((unit >> 6) & 63) as u8,
            0x80 | (unit & 63) as u8,
        ];
        let bytes: &[u8] = match self {
            Self::JavaUtf8 => &java,
            Self::Utf16 => &raw,
            Self::Utf16LowByte => &raw[..1],
            _ if unit < 0xdc00 => &[],
            _ => b"?",
        };
        (bytes.len() <= limit).then(|| bytes.to_vec())
    }

    pub(super) fn encode_units(
        &self,
        units: impl Iterator<Item = u16>,
        limit: usize,
    ) -> Option<Vec<u8>> {
        let mut out = Vec::new();
        match self {
            Self::Utf7 => return utf7::encode(units, limit),
            Self::JavaUtf8 => {
                for unit in units {
                    let (bytes, size) = match unit {
                        1..=127 => ([unit as u8, 0, 0], 1),
                        0..=2047 => ([0xc0 | (unit >> 6) as u8, 0x80 | (unit & 63) as u8, 0], 2),
                        _ => (
                            [
                                0xe0 | (unit >> 12) as u8,
                                0x80 | ((unit >> 6) & 63) as u8,
                                0x80 | (unit & 63) as u8,
                            ],
                            3,
                        ),
                    };
                    if out.len().checked_add(size)? > limit {
                        return None;
                    }
                    out.extend_from_slice(&bytes[..size]);
                }
            }
            Self::Utf16 | Self::Utf16LowByte => {
                let size = if matches!(self, Self::Utf16) { 2 } else { 1 };
                for unit in units {
                    if out.len().checked_add(size)? > limit {
                        return None;
                    }
                    out.extend_from_slice(&unit.to_le_bytes()[..size]);
                }
            }
            Self::Utf8 => return Some(text_from_units(units, true, limit)?.into_bytes()),
            _ => {
                let text = text_from_units(
                    units,
                    !matches!(self, Self::Page(_) | Self::Multibyte(_, _, false)),
                    limit.saturating_mul(4),
                )?;
                return self.encode(&text, limit);
            }
        }
        Some(out)
    }

    pub(in crate::commands) fn encode(&self, text: &str, limit: usize) -> Option<Vec<u8>> {
        if matches!(self, Self::Utf8) {
            return (text.len() <= limit).then(|| text.as_bytes().to_vec());
        }
        let mut out = Vec::new();
        match self {
            Self::Iso2022Cn => return iso2022cn::encode(text, limit),
            Self::Iso2022Kr => return iso2022kr::encode(text, limit),
            Self::Iso2022Jp => return iso2022jp::encode(text, limit),
            Self::Gb18030 => return gb18030::encode(text, limit),
            Self::Utf7 => return utf7::encode(text.encode_utf16(), limit),
            Self::JavaUtf8 | Self::Utf16 | Self::Utf16LowByte => {
                return self.encode_units(text.encode_utf16(), limit);
            }
            Self::Page(page) => {
                for c in text.chars() {
                    if c.is_ascii() {
                        if out.len() >= limit {
                            return None;
                        }
                        out.push(c as u8);
                        continue;
                    }
                    let encoded = u16::try_from(u32::from(c))
                        .ok()
                        .and_then(|cp| {
                            page.binary_search_by_key(&cp, |(c, _)| *c)
                                .ok()
                                .map(|i| page[i].1)
                                .or_else(|| {
                                    codepages::COMMON
                                        .binary_search_by_key(&cp, |(c, _)| *c)
                                        .ok()
                                        .map(|i| codepages::COMMON[i].1)
                                })
                        })
                        .unwrap_or(u16::from(b'?'));
                    let size = if encoded > 255 { 2 } else { 1 };
                    if out.len().checked_add(size)? > limit {
                        return None;
                    }
                    if size == 2 {
                        out.push((encoded >> 8) as u8);
                    }
                    out.push(encoded as u8);
                }
            }
            Self::Multibyte(table, _, _) => {
                for c in text.chars() {
                    let cp = u32::from(c);
                    let index = table
                        .partition_point(|r| u32::from_le_bytes(r[..4].try_into().unwrap()) <= cp);
                    let record = index.checked_sub(1).map(|i| &table[i]);
                    let fallback = [if c.is_ascii() { c as u8 } else { b'?' }];
                    let bytes = record
                        .and_then(|r| {
                            let end = u32::from_le_bytes(r[4..8].try_into().unwrap());
                            (cp <= end >> 3).then_some(&r[8..8 + (end & 7) as usize])
                        })
                        .unwrap_or(&fallback);
                    if out.len().checked_add(bytes.len())? > limit {
                        return None;
                    }
                    out.extend_from_slice(bytes);
                }
            }
            Self::Utf8 => unreachable!(),
        }
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::Encoding;
    use crate::commands::structured::{JVal, parse_json_stream};

    #[test]
    fn delimiter_units_match_native_surrogate_conversions() {
        let JVal::Object(fixture) = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-csv-delimiters-native.json"
        ))
        .unwrap()
        .remove(0) else {
            panic!("fixture")
        };
        let JVal::Array(ids) = &fixture
            .iter()
            .find(|(k, _)| k == "surrogate_encodings")
            .unwrap()
            .1
        else {
            panic!("encoding IDs")
        };
        for id in ids {
            let JVal::Number(id, _) = id else {
                panic!("encoding ID")
            };
            let encoding = Encoding::parse(&id.to_string()).unwrap();
            for unit in 0xd800u16..=0xdfff {
                let raw = unit.to_le_bytes();
                let expected: &[u8] = if *id == 9.0 || *id == 97.0 {
                    &raw[..1]
                } else if unit < 0xdc00 {
                    &[]
                } else {
                    b"?"
                };
                assert_eq!(
                    encoding.encode_unit(unit, expected.len()).as_deref(),
                    Some(expected),
                    "{id}: {unit}"
                );
                if !expected.is_empty() {
                    assert!(encoding.encode_unit(unit, expected.len() - 1).is_none());
                }
                assert_eq!(
                    Encoding::Utf16.encode_unit(unit, 2).as_deref(),
                    Some(raw.as_slice())
                );
                assert!(Encoding::Utf16.encode_unit(unit, 1).is_none());
            }
        }
    }

    #[test]
    fn symbol_codecs_match_native_streams_and_byte_pairs() {
        let JVal::Object(fixture) = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-symbol-codec-native.json"
        ))
        .unwrap()
        .remove(0) else {
            panic!("fixture")
        };
        for (kind, cases) in fixture {
            let JVal::Array(cases) = cases else { continue };
            if kind == "surrogates" {
                continue;
            }
            for case in cases {
                let JVal::Array(fields) = case else {
                    panic!("case")
                };
                let JVal::Str(id) = &fields[0] else {
                    panic!("encoding")
                };
                let JVal::Str(text) = &fields[1] else {
                    panic!("text")
                };
                let encoding = Encoding::parse(id).unwrap();
                if kind == "encode" {
                    let JVal::Str(hex) = &fields[2] else {
                        panic!("hex")
                    };
                    let bytes: Vec<u8> = hex
                        .as_bytes()
                        .chunks_exact(2)
                        .map(|s| u8::from_str_radix(std::str::from_utf8(s).unwrap(), 16).unwrap())
                        .collect();
                    assert_eq!(
                        encoding.encode(text, bytes.len()).as_deref(),
                        Some(bytes.as_slice()),
                        "{id}: {text:?}"
                    );
                    if !bytes.is_empty() {
                        assert!(encoding.encode(text, bytes.len() - 1).is_none());
                    }
                } else {
                    let chars: Vec<_> = text.chars().collect();
                    assert_eq!(chars.len(), 256);
                    for a in 0..=255u8 {
                        let expected = chars[usize::from(a)].to_string();
                        assert_eq!(
                            encoding.decode(&[a], expected.len()).as_deref(),
                            Some(expected.as_str()),
                            "{id}: {a}"
                        );
                        assert!(encoding.decode(&[a], expected.len() - 1).is_none());
                        for b in 0..=255u8 {
                            let expected =
                                format!("{}{}", chars[usize::from(a)], chars[usize::from(b)]);
                            assert_eq!(
                                encoding.decode(&[a, b], expected.len()).as_deref(),
                                Some(expected.as_str()),
                                "{id}: {a} {b}"
                            );
                            assert!(encoding.decode(&[a, b], expected.len() - 1).is_none());
                        }
                    }
                    for unit in 0xd800..=0xdfff {
                        let expected: &[u8] = if unit < 0xdc00 { &[] } else { b"?" };
                        assert_eq!(
                            encoding.encode_unit(unit, expected.len()).as_deref(),
                            Some(expected)
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn iso2022_matches_native_units_and_complete_streams() {
        for (id, mut expected, source) in [
            (
                "72",
                include_bytes!("../../tests/fixtures/soffice-iso2022jp-units-native.bin")
                    .as_slice(),
                include_str!("../../tests/fixtures/soffice-iso2022jp-codec-native.json"),
            ),
            (
                "73",
                include_bytes!("../../tests/fixtures/soffice-iso2022cn-units-native.bin")
                    .as_slice(),
                include_str!("../../tests/fixtures/soffice-iso2022cn-codec-native.json"),
            ),
            (
                "80",
                include_bytes!("../../tests/fixtures/soffice-iso2022kr-units-native.bin")
                    .as_slice(),
                include_str!("../../tests/fixtures/soffice-iso2022kr-codec-native.json"),
            ),
        ] {
            let encoding = Encoding::parse(id).unwrap();
            for unit in 0..=u16::MAX {
                let size = usize::from(expected[0]);
                let (bytes, rest) = expected[1..].split_at(size);
                assert_eq!(
                    encoding.encode_unit(unit, size).as_deref(),
                    Some(bytes),
                    "{unit}"
                );
                if size != 0 {
                    assert!(encoding.encode_unit(unit, size - 1).is_none(), "{unit}");
                }
                expected = rest;
            }
            assert!(expected.is_empty());
            let JVal::Object(fixture) = parse_json_stream(source).unwrap().remove(0) else {
                panic!("fixture")
            };
            let JVal::Array(cases) = &fixture.iter().find(|(k, _)| k == "cases").unwrap().1 else {
                panic!("cases")
            };
            for case in cases {
                let JVal::Array(case) = case else {
                    panic!("case")
                };
                let [JVal::Str(text), JVal::Str(hex), JVal::Str(decoded)] = case.as_slice() else {
                    panic!("case")
                };
                let bytes: Vec<u8> = hex
                    .as_bytes()
                    .chunks_exact(2)
                    .map(|p| u8::from_str_radix(std::str::from_utf8(p).unwrap(), 16).unwrap())
                    .collect();
                assert_eq!(
                    encoding.encode(text, bytes.len()).as_deref(),
                    Some(bytes.as_slice()),
                    "{text:?}"
                );
                assert_eq!(
                    encoding.decode(&bytes, decoded.len()).as_deref(),
                    Some(decoded.as_str()),
                    "{text:?}"
                );
                if !bytes.is_empty() {
                    assert!(encoding.encode(text, bytes.len() - 1).is_none());
                }
                if !decoded.is_empty() {
                    assert!(encoding.decode(&bytes, decoded.len() - 1).is_none());
                }
            }
        }
    }

    #[test]
    fn utf7_matches_native_units_and_complete_streams() {
        let encoding = Encoding::parse("75").unwrap();
        let mut expected =
            include_bytes!("../../tests/fixtures/soffice-utf7-units-native.bin").as_slice();
        for unit in 0..=u16::MAX {
            let size = usize::from(expected[0]);
            let (bytes, rest) = expected[1..].split_at(size);
            assert_eq!(
                encoding.encode_unit(unit, size).as_deref(),
                Some(bytes),
                "unit {unit}"
            );
            assert!(
                encoding.encode_unit(unit, size - 1).is_none(),
                "unit {unit}"
            );
            expected = rest;
        }
        assert!(expected.is_empty());
        let JVal::Object(fixture) = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-utf7-codec-native.json"
        ))
        .unwrap()
        .remove(0) else {
            panic!("fixture")
        };
        let JVal::Array(cases) = &fixture.iter().find(|(k, _)| k == "encode").unwrap().1 else {
            panic!("cases")
        };
        for case in cases {
            let JVal::Array(pair) = case else {
                panic!("case")
            };
            let [JVal::Str(text), JVal::Str(expected)] = pair.as_slice() else {
                panic!("pair")
            };
            assert_eq!(
                encoding.encode(text, expected.len()).as_deref(),
                Some(expected.as_bytes()),
                "{text:?}"
            );
            if !expected.is_empty() {
                assert!(encoding.encode(text, expected.len() - 1).is_none());
            }
        }
    }

    #[test]
    fn utf7_matches_native_raw_unit_streams() {
        let JVal::Object(fixture) = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-utf7-codec-native.json"
        ))
        .unwrap()
        .remove(0) else {
            panic!("fixture")
        };
        let JVal::Array(cases) = &fixture.iter().find(|(k, _)| k == "units").unwrap().1 else {
            panic!("cases")
        };
        for case in cases {
            let JVal::Array(pair) = case else {
                panic!("case")
            };
            let [JVal::Array(units), JVal::Str(expected)] = pair.as_slice() else {
                panic!("pair")
            };
            let units = units.iter().map(|unit| {
                let JVal::Number(unit, _) = unit else {
                    panic!("unit")
                };
                *unit as u16
            });
            assert_eq!(
                super::utf7::encode(units.clone(), expected.len()).as_deref(),
                Some(expected.as_bytes())
            );
            assert!(super::utf7::encode(units, expected.len() - 1).is_none());
        }
    }

    #[test]
    fn java_utf8_matches_native_units_and_complete_streams() {
        let encoding = Encoding::parse("90").unwrap();
        let mut expected =
            include_bytes!("../../tests/fixtures/soffice-java-utf8-units-native.bin").as_slice();
        for unit in 0..=u16::MAX {
            let size = match expected[0] {
                0..=127 => 1,
                128..=223 => 2,
                _ => 3,
            };
            let (bytes, rest) = expected.split_at(size);
            assert_eq!(
                encoding.encode_unit(unit, size).as_deref(),
                Some(bytes),
                "unit {unit}"
            );
            assert!(
                encoding.encode_unit(unit, size - 1).is_none(),
                "unit {unit}"
            );
            expected = rest;
        }
        assert!(expected.is_empty());
        let JVal::Object(fixture) = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-java-utf8-codec-native.json"
        ))
        .unwrap()
        .remove(0) else {
            panic!("fixture")
        };
        let JVal::Array(cases) = &fixture.iter().find(|(k, _)| k == "encode").unwrap().1 else {
            panic!("cases")
        };
        for case in cases {
            let JVal::Array(pair) = case else {
                panic!("case")
            };
            let [JVal::Str(text), JVal::Str(hex)] = pair.as_slice() else {
                panic!("pair")
            };
            let bytes: Vec<u8> = hex
                .as_bytes()
                .chunks_exact(2)
                .map(|s| u8::from_str_radix(std::str::from_utf8(s).unwrap(), 16).unwrap())
                .collect();
            assert_eq!(
                encoding.encode(text, bytes.len()).as_deref(),
                Some(bytes.as_slice()),
                "{text:?}"
            );
            if !bytes.is_empty() {
                assert!(encoding.encode(text, bytes.len() - 1).is_none());
            }
        }
    }

    #[test]
    fn missing_converter_matches_native_utf16_low_bytes() {
        let JVal::Object(fixture) = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-csv-encoding-ids-native.json"
        ))
        .unwrap()
        .remove(0) else {
            panic!("fixture")
        };
        let JVal::Array(cases) = &fixture.iter().find(|(k, _)| k == "encode").unwrap().1 else {
            panic!("cases")
        };
        let encoding = Encoding::parse("9").unwrap();
        for case in cases {
            let JVal::Array(pair) = case else {
                panic!("case")
            };
            let [JVal::Str(text), JVal::Str(hex)] = pair.as_slice() else {
                panic!("pair")
            };
            let expected: Vec<u8> = hex
                .as_bytes()
                .chunks_exact(2)
                .map(|s| u8::from_str_radix(std::str::from_utf8(s).unwrap(), 16).unwrap())
                .collect();
            assert_eq!(
                encoding.encode(text, expected.len()).as_ref(),
                Some(&expected),
                "{text:?}"
            );
            if !expected.is_empty() {
                assert!(encoding.encode(text, expected.len() - 1).is_none());
            }
        }
    }

    #[test]
    fn gb18030_matches_native_complete_streams() {
        let JVal::Object(fixture) = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-gb18030-codec-native.json"
        ))
        .unwrap()
        .remove(0) else {
            panic!("fixture")
        };
        let encoding = Encoding::parse("85").unwrap();
        for (kind, cases) in fixture {
            let JVal::Array(cases) = cases else { continue };
            for case in cases {
                let JVal::Array(pair) = case else {
                    panic!("case")
                };
                let [JVal::Str(a), JVal::Str(b)] = pair.as_slice() else {
                    panic!("pair")
                };
                let (text, hex) = if kind == "encode" { (a, b) } else { (b, a) };
                let bytes: Vec<u8> = hex
                    .as_bytes()
                    .chunks_exact(2)
                    .map(|s| u8::from_str_radix(std::str::from_utf8(s).unwrap(), 16).unwrap())
                    .collect();
                if kind == "encode" {
                    assert_eq!(
                        encoding.encode(text, bytes.len()).as_ref(),
                        Some(&bytes),
                        "{text:?}"
                    );
                    if !bytes.is_empty() {
                        assert!(encoding.encode(text, bytes.len() - 1).is_none());
                    }
                } else {
                    assert_eq!(
                        encoding.decode(&bytes, text.len()).as_ref(),
                        Some(text),
                        "{hex}"
                    );
                    if !text.is_empty() {
                        assert!(encoding.decode(&bytes, text.len() - 1).is_none());
                    }
                }
            }
        }
    }

    #[test]
    fn dbcs_decoding_matches_native_complete_streams() {
        let JVal::Object(fixture) = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-dbcs-decoding-native.json"
        ))
        .unwrap()
        .remove(0) else {
            panic!("fixture")
        };
        let JVal::Array(cases) = &fixture.iter().find(|(k, _)| k == "cases").unwrap().1 else {
            panic!("cases")
        };
        for case in cases {
            let JVal::Object(fields) = case else {
                panic!("case")
            };
            let field = |name: &str| {
                let JVal::Str(value) = &fields.iter().find(|(k, _)| k == name).unwrap().1 else {
                    panic!("field")
                };
                value.as_str()
            };
            let bytes: Vec<u8> = field("hex")
                .as_bytes()
                .chunks_exact(2)
                .map(|s| u8::from_str_radix(std::str::from_utf8(s).unwrap(), 16).unwrap())
                .collect();
            let expected = field("text");
            let encoding = Encoding::parse(field("encoding")).unwrap();
            assert_eq!(
                encoding.decode(&bytes, expected.len()).as_deref(),
                Some(expected),
                "{}: {}",
                field("encoding"),
                field("hex")
            );
            if !expected.is_empty() {
                assert!(encoding.decode(&bytes, expected.len() - 1).is_none());
            }
        }
    }
}
