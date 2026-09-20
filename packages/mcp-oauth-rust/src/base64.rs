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
