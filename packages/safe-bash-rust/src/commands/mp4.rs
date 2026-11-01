// Atom lengths include their own header. A zero length occupies the remainder of
// its parent; extended lengths include the extra eight bytes used for the size.
fn atoms(mut bytes: &[u8]) -> impl Iterator<Item = (&[u8; 4], &[u8])> {
    std::iter::from_fn(move || {
        let kind: &[u8; 4] = bytes.get(4..8)?.try_into().ok()?;
        let (len, mut header) = match u32::from_be_bytes(bytes[..4].try_into().ok()?) {
            0 => (bytes.len() as u64, 8),
            1 => (u64::from_be_bytes(bytes.get(8..16)?.try_into().ok()?), 16),
            n => (u64::from(n), 8),
        };
        let end = if len < header as u64 || len > bytes.len() as u64 {
            bytes.len()
        } else {
            len as usize
        };
        if kind == b"uuid" && end >= header + 16 {
            header += 16;
        }
        let payload = &bytes[header..end];
        bytes = &bytes[end..];
        Some((kind, payload))
    })
}

pub(super) fn movie(input: &[u8]) -> Result<&[u8], &'static str> {
    atoms(input)
        .find_map(|(kind, payload)| (kind == b"moov").then_some(payload))
        .ok_or("Invalid MP4/ISOBMFF file: missing 'moov' atom")
}
