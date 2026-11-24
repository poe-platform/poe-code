//! ToUnicode character and range mappings for simple and Identity-H fonts.
use super::super::super::{Cursor, Value};
use std::collections::BTreeMap;

pub(super) fn read(
    bytes: &[u8],
    tokens: &mut usize,
    remaining_bytes: &mut usize,
) -> Option<BTreeMap<u16, String>> {
    let mut cursor = Cursor(bytes);
    let mut count = None;
    let (mut started, mut codespace) = (false, 0usize);
    let mut map = BTreeMap::new();
    loop {
        cursor.skip();
        if cursor.0.is_empty() {
            return None;
        }
        let value = cursor.value(0, tokens, false)?;
        match value.word() {
            Some(b"begincmap") if !started => started = true,
            Some(b"begincodespacerange") if started && codespace == 0 && count == Some(1) => {
                let Value::String { bytes: low, .. } = cursor.value(0, tokens, false)? else {
                    return None;
                };
                let Value::String { bytes: high, .. } = cursor.value(0, tokens, false)? else {
                    return None;
                };
                if !matches!(low.as_slice(), [0] | [0, 0])
                    || high.len() != low.len()
                    || high.iter().any(|&byte| byte != 255)
                    || cursor.value(0, tokens, false)?.word() != Some(b"endcodespacerange")
                {
                    return None;
                }
                codespace = low.len();
            }
            Some(kind @ (b"beginbfchar" | b"beginbfrange")) if started && codespace != 0 => {
                let count = count.filter(|&n| n > 0 && n <= 65536)?;
                let range = kind == b"beginbfrange";
                let code = |value: Value<'_>| {
                    let Value::String { bytes, .. } = value else {
                        return None;
                    };
                    if bytes.len() != codespace {
                        return None;
                    }
                    Some(
                        bytes
                            .iter()
                            .fold(0u16, |n, &byte| (n << 8) | u16::from(byte)),
                    )
                };
                for _ in 0..count {
                    let first = code(cursor.value(0, tokens, false)?)?;
                    let last = if range {
                        code(cursor.value(0, tokens, false)?)?
                    } else {
                        first
                    };
                    let length = usize::from(last.checked_sub(first)?) + 1;
                    let mut target = cursor.value(0, tokens, false)?;
                    if let Value::Array(items) = &target {
                        if !range || items.len() != length {
                            return None;
                        }
                    }
                    for (index, source) in (first..=last).enumerate() {
                        let destination = match &target {
                            Value::Array(items) => &items[index],
                            value => value,
                        };
                        let Value::String { bytes, .. } = destination else {
                            return None;
                        };
                        if bytes.is_empty() || bytes.len() % 2 != 0 {
                            return None;
                        }
                        // Account for UTF-8 expansion and the retained tree entry before allocation.
                        *remaining_bytes = remaining_bytes
                            .checked_sub(bytes.len().checked_mul(2)?.checked_add(96)?)?;
                        let unicode = char::decode_utf16(
                            bytes
                                .chunks_exact(2)
                                .map(|p| u16::from_be_bytes([p[0], p[1]])),
                        )
                        .collect::<Result<String, _>>()
                        .ok()?;
                        map.insert(source, unicode);
                        if source != last
                            && let Value::String { bytes, .. } = &mut target
                        {
                            for byte in bytes.iter_mut().rev() {
                                *byte = byte.wrapping_add(1);
                                if *byte != 0 {
                                    break;
                                }
                            }
                        }
                    }
                }
                let end = if range {
                    b"endbfrange".as_slice()
                } else {
                    b"endbfchar"
                };
                if cursor.value(0, tokens, false)?.word() != Some(end) {
                    return None;
                }
            }
            Some(b"endcmap") => {
                return (started && codespace != 0 && !map.is_empty()).then_some(map);
            }
            Some(
                b"begincmap"
                | b"begincodespacerange"
                | b"beginbfchar"
                | b"beginbfrange"
                | b"begincidchar"
                | b"begincidrange"
                | b"usecmap",
            ) => return None,
            _ => {}
        }
        count = value
            .word()
            .and_then(|w| std::str::from_utf8(w).ok()?.parse::<usize>().ok());
    }
}

#[cfg(test)]
mod tests {
    use super::read;
    fn cmap(body: &str) -> Vec<u8> {
        format!("begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange {body} endcmap")
            .into_bytes()
    }
    #[test]
    fn bfchar_decodes_sequences_surrogates_and_full_u16_codes() {
        let map = read(
            &cmap("3 beginbfchar <0001> <00660069> <0100> <D83DDE00> <FFFF> <03A9> endbfchar"),
            &mut 1000,
            &mut 4096,
        )
        .unwrap();
        assert_eq!(map[&1], "fi");
        assert_eq!(map[&256], "😀");
        assert_eq!(map[&65535], "Ω");
    }
    #[test]
    fn simple_font_ranges_support_sequences_arrays_and_later_overrides() {
        let source = b"begincmap 1 begincodespacerange <00> <FF> endcodespacerange 2 beginbfrange <61> <63> <0041> <66> <68> [<00660069> <D83DDE00> <03C0>] endbfrange 1 beginbfchar <63> <005A> endbfchar endcmap";
        let map = read(source, &mut 1000, &mut 4096).unwrap();
        assert_eq!(
            [0x61, 0x62, 0x63, 0x66, 0x67, 0x68].map(|code| map[&code].as_str()),
            ["A", "B", "Z", "fi", "😀", "π"]
        );
        let map = read(&cmap("1 beginbfrange <00FE> <0100> <00FE> endbfrange 1 beginbfchar <00FF> <0041> endbfchar"), &mut 1000, &mut 4096).unwrap();
        assert_eq!(
            [0xfe, 0xff, 0x100].map(|code| map[&code].as_str()),
            ["þ", "A", "Ā"]
        );
    }
    #[test]
    fn malformed_maps_are_not_partially_decoded() {
        for body in [
            "1 beginbfchar <01> <0041> endbfchar",
            "1 beginbfchar <0001> <00> endbfchar",
            "1 beginbfchar <0001> <D800> endbfchar",
            "1 beginbfchar <0001> <DC00> endbfchar",
            "1 beginbfchar <0001> <D8000041> endbfchar",
            "1 beginbfchar <0001> <> endbfchar",
            "2 beginbfchar <0001> <0041> endbfchar",
            "1 beginbfchar <0001> <0041> <0002> <0042> endbfchar",
            "1 beginbfrange <0002> <0001> <0041> endbfrange",
            "1 beginbfrange <0001> <0002> [<0041>] endbfrange",
            "1 beginbfchar <0001> <0041> endbfchar /Other usecmap",
        ] {
            assert!(read(&cmap(body), &mut 1000, &mut 4096).is_none(), "{body}");
        }
        assert!(
            read(
                b"begincmap 1 beginbfchar <0001> <0041> endbfchar endcmap",
                &mut 1000,
                &mut 4096
            )
            .is_none()
        );
    }
    #[test]
    fn cmap_tokens_and_retained_unicode_are_bounded() {
        let source = cmap("1 beginbfchar <0001> <0041> endbfchar");
        assert!(read(&source, &mut 5, &mut 4096).is_none());
        assert!(read(&source, &mut 1000, &mut 99).is_none());
        assert!(read(&source, &mut 1000, &mut 100).is_some());
        assert!(read(&source[..source.len() - 1], &mut 1000, &mut 4096).is_none());
    }
}
