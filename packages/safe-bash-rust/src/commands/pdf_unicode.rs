//! The 16-bit Identity-H ToUnicode profile emitted by the portable PDF writer.
use super::super::super::{Cursor, Value};
use std::collections::BTreeMap;

pub(super) fn read(
    bytes: &[u8],
    tokens: &mut usize,
    remaining_bytes: &mut usize,
) -> Option<BTreeMap<u16, String>> {
    let mut cursor = Cursor(bytes);
    let mut count = None;
    let (mut started, mut codespace) = (false, false);
    let mut map = BTreeMap::new();
    loop {
        cursor.skip();
        if cursor.0.is_empty() {
            return None;
        }
        let value = cursor.value(0, tokens, false)?;
        match value.word() {
            Some(b"begincmap") if !started => started = true,
            Some(b"begincodespacerange") if started && !codespace && count == Some(1) => {
                let Value::String { bytes: low, .. } = cursor.value(0, tokens, false)? else {
                    return None;
                };
                let Value::String { bytes: high, .. } = cursor.value(0, tokens, false)? else {
                    return None;
                };
                if low != [0, 0]
                    || high != [255, 255]
                    || cursor.value(0, tokens, false)?.word() != Some(b"endcodespacerange")
                {
                    return None;
                }
                codespace = true;
            }
            Some(b"beginbfchar") if started && codespace => {
                let count = count.filter(|&n| n > 0 && n <= 65536)?;
                for _ in 0..count {
                    let Value::String { bytes: source, .. } = cursor.value(0, tokens, false)?
                    else {
                        return None;
                    };
                    let code = u16::from_be_bytes(source.as_slice().try_into().ok()?);
                    let Value::String { bytes: target, .. } = cursor.value(0, tokens, false)?
                    else {
                        return None;
                    };
                    if target.is_empty() || target.len() % 2 != 0 {
                        return None;
                    }
                    // Account for UTF-8 expansion and the retained tree entry before allocation.
                    *remaining_bytes = remaining_bytes
                        .checked_sub(target.len().checked_mul(2)?.checked_add(96)?)?;
                    let unicode = char::decode_utf16(
                        target
                            .chunks_exact(2)
                            .map(|p| u16::from_be_bytes([p[0], p[1]])),
                    )
                    .collect::<Result<String, _>>()
                    .ok()?;
                    if map.insert(code, unicode).is_some() {
                        return None;
                    }
                }
                if cursor.value(0, tokens, false)?.word() != Some(b"endbfchar") {
                    return None;
                }
            }
            Some(b"endcmap") => return (started && codespace && !map.is_empty()).then_some(map),
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
    fn malformed_maps_and_unsupported_ranges_are_not_partially_decoded() {
        for body in [
            "1 beginbfchar <01> <0041> endbfchar",
            "1 beginbfchar <0001> <00> endbfchar",
            "1 beginbfchar <0001> <D800> endbfchar",
            "1 beginbfchar <0001> <DC00> endbfchar",
            "1 beginbfchar <0001> <D8000041> endbfchar",
            "1 beginbfchar <0001> <> endbfchar",
            "2 beginbfchar <0001> <0041> endbfchar",
            "1 beginbfchar <0001> <0041> <0002> <0042> endbfchar",
            "2 beginbfchar <0001> <0041> <0001> <0042> endbfchar",
            "1 beginbfrange <0001> <0002> <0041> endbfrange",
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
