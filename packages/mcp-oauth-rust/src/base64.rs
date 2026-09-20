//! Unpadded RFC 4648 base64url encoding used by PKCE and authorization state.
pub fn encode_url(bytes: &[u8]) -> String {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for group in bytes.chunks(3) {
        let word = (u32::from(group[0]) << 16)
            | (u32::from(group.get(1).copied().unwrap_or(0)) << 8)
            | u32::from(group.get(2).copied().unwrap_or(0));
        output.push(alphabet[(word >> 18) as usize] as char);
        output.push(alphabet[((word >> 12) & 63) as usize] as char);
        if group.len() > 1 {
            output.push(alphabet[((word >> 6) & 63) as usize] as char);
        }
        if group.len() > 2 {
            output.push(alphabet[(word & 63) as usize] as char);
        }
    }
    output
}

/// Buffer-compatible decoding: mixed alphabets, ignored junk, early padding and
/// low-byte lookup for UTF-16 code units. This intentionally is not validation.
pub fn decode_lenient(text: &[u16]) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut word = 0u32;
    let mut bits = 0u8;
    for unit in text {
        let byte = *unit as u8;
        if byte == b'=' {
            break;
        }
        let digit = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => continue,
        };
        word = (word << 6) | u32::from(digit);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push((word >> bits) as u8);
        }
    }
    bytes
}
