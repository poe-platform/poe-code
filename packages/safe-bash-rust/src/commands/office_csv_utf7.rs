pub(in crate::commands) fn encode(
    units: impl IntoIterator<Item = u16>,
    limit: usize,
) -> Option<Vec<u8>> {
    const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let mut put = |byte| {
        if out.len() >= limit {
            return None;
        }
        out.push(byte);
        Some(())
    };
    let (mut shifted, mut buffer, mut bits) = (false, 0u32, 0u32);
    for unit in units.into_iter().map(Some).chain([None]) {
        // Native's direct set includes form feed, but shifts CR and hyphen.
        let direct = unit.is_none_or(|unit| {
            matches!(unit, 9 | 10 | 12 | 32 | 39..=41 | 44 | 46..=58 | 63 | 65..=90 | 97..=122)
        });
        if direct {
            if shifted {
                if bits != 0 {
                    put(BASE64[((buffer << (6 - bits)) & 63) as usize])?;
                }
                put(b'-')?;
                shifted = false;
                buffer = 0;
                bits = 0;
            }
            if let Some(unit) = unit {
                put(unit as u8)?;
            }
        } else {
            let unit = unit?;
            if !shifted {
                put(b'+')?;
                if unit == u16::from(b'+') {
                    put(b'-')?;
                    continue;
                }
                shifted = true;
            }
            buffer = (buffer << 16) | u32::from(unit);
            bits += 16;
            while bits >= 6 {
                bits -= 6;
                put(BASE64[((buffer >> bits) & 63) as usize])?;
            }
            buffer &= (1 << bits) - 1;
        }
    }
    Some(out)
}
