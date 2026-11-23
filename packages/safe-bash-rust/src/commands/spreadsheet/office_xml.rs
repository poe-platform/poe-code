const INVALID: &str = "Invalid XML lexical structure.";
pub(super) fn decode(bytes: &[u8]) -> Result<String, String> {
    let text = if bytes.starts_with(&[255, 254])
        || bytes.starts_with(&[60, 0])
        || bytes.starts_with(&[254, 255])
        || bytes.starts_with(&[0, 60])
    {
        if bytes.len() % 2 != 0 {
            return Err(INVALID.into());
        }
        let little = bytes.starts_with(&[255, 254]) || bytes.starts_with(&[60, 0]);
        let units: Vec<_> = bytes
            .chunks_exact(2)
            .map(|b| {
                if little {
                    u16::from_le_bytes([b[0], b[1]])
                } else {
                    u16::from_be_bytes([b[0], b[1]])
                }
            })
            .collect();
        String::from_utf16(&units).map_err(|_| INVALID)?
    } else {
        std::str::from_utf8(bytes).map_err(|_| INVALID)?.to_owned()
    };
    if !text.chars().all(|c| matches!(c,'\t'|'\n'|'\r'|' '..='\u{d7ff}'|'\u{e000}'..='\u{fffd}'|'\u{10000}'..='\u{10ffff}')) { return Err(INVALID.into()); }
    Ok(text.strip_prefix('\u{feff}').unwrap_or(&text).to_owned())
}
