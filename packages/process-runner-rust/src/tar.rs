//! Deterministic USTAR encoding for workspace transfers, with borrowed payloads.
pub struct Entry<'a> {
    pub path: &'a [u16],
    pub content: &'a [u8],
}
fn error(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn split_path(path: &[u16]) -> Result<(String, String), Vec<u16>> {
    let name = String::from_utf16_lossy(path);
    if name.len() <= 100 {
        return Ok((name, String::new()));
    }
    for (index, _) in name.match_indices('/').rev() {
        let prefix = &name[..index];
        let leaf = &name[index + 1..];
        if prefix.len() <= 155 && leaf.len() <= 100 {
            return Ok((leaf.to_owned(), prefix.to_owned()));
        }
    }
    let mut message = error("Workspace tar path is too long to represent: ");
    message.extend(path);
    Err(message)
}
fn octal(buffer: &mut [u8], value: usize) {
    let text = format!("{:0width$o}", value, width = buffer.len() - 1);
    let count = (buffer.len() - 1).min(text.len());
    buffer[..count].copy_from_slice(&text.as_bytes()[..count]);
    buffer[buffer.len() - 1] = 0;
}
pub fn header(path: &[u16], size: usize) -> Result<[u8; 512], Vec<u16>> {
    let (name, prefix) = split_path(path)?;
    let mut header = [0u8; 512];
    header[..name.len()].copy_from_slice(name.as_bytes());
    octal(&mut header[100..108], 0o644);
    octal(&mut header[108..116], 0);
    octal(&mut header[116..124], 0);
    octal(&mut header[124..136], size);
    octal(&mut header[136..148], 0);
    header[148..156].fill(32);
    header[156] = b'0';
    header[257..262].copy_from_slice(b"ustar");
    header[263..265].copy_from_slice(b"00");
    header[345..345 + prefix.len()].copy_from_slice(prefix.as_bytes());
    let checksum = header.iter().map(|byte| *byte as usize).sum();
    octal(&mut header[148..156], checksum);
    Ok(header)
}
pub fn create(entries: &[Entry<'_>]) -> Result<Vec<u8>, Vec<u16>> {
    let headers = entries
        .iter()
        .map(|entry| header(entry.path, entry.content.len()))
        .collect::<Result<Vec<_>, _>>()?;
    let mut size = 1024usize;
    for entry in entries {
        let padded = entry
            .content
            .len()
            .checked_add(511)
            .map(|bytes| bytes / 512 * 512);
        size = padded
            .and_then(|padded| size.checked_add(512)?.checked_add(padded))
            .ok_or_else(|| error("Workspace tar archive is too large to represent."))?;
    }
    let mut archive = Vec::new();
    archive
        .try_reserve_exact(size)
        .map_err(|_| error("Workspace tar archive is too large to represent."))?;
    for (entry, header) in entries.iter().zip(headers) {
        archive.extend(header);
        archive.extend(entry.content);
        let padding = (512 - entry.content.len() % 512) % 512;
        archive.resize(archive.len() + padding, 0);
    }
    archive.resize(size, 0);
    Ok(archive)
}
