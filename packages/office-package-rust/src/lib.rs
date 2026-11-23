//! Owned Office package parts and deterministic ZIP serialization.
pub mod xml;
use mcp_protocol_rust::cooperate::{block_on, yield_now};
#[derive(Clone, Debug)]
pub struct Part {
    pub name: String,
    pub bytes: Vec<u8>,
}
impl Part {
    pub fn new(name: impl Into<String>, bytes: Vec<u8>) -> Self {
        Self {
            name: name.into(),
            bytes,
        }
    }
}
#[derive(Clone, Debug, Default)]
pub struct Package {
    pub parts: Vec<Part>,
}
impl Package {
    pub fn write(&self) -> Result<Vec<u8>, String> {
        block_on(self.write_async())
    }

    /// Serialize with cancellation opportunities during validation, CRC and copying.
    pub async fn write_async(&self) -> Result<Vec<u8>, String> {
        if self.parts.len() > u16::MAX as usize {
            return Err("Office package has too many parts".into());
        }
        let mut names = std::collections::HashSet::new();
        let mut size = 22usize;
        let mut parts = Vec::with_capacity(self.parts.len());
        for part in &self.parts {
            if part.name.is_empty()
                || part.name.len() > u16::MAX as usize
                || part.name.starts_with('/')
                || part.name.contains(['\\', '\0'])
                || part
                    .name
                    .split('/')
                    .any(|p| p == "." || p == ".." || p.is_empty())
                || !names.insert(&part.name)
            {
                return Err("Invalid or duplicate Office package part name".into());
            }
            size = size
                .checked_add(76 + 2 * part.name.len())
                .and_then(|n| n.checked_add(part.bytes.len()))
                .ok_or("Office package size overflow")?;
            if size > 64 * 1024 * 1024 {
                return Err("Office package exceeds 64 MiB".into());
            }
            parts.push((part.name.as_str(), part.bytes.as_slice()));
            yield_now().await;
        }
        Ok(write_zip_stored_async(&parts).await)
    }
}

async fn crc32_ieee(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for chunk in data.chunks(4096) {
        for &b in chunk {
            crc ^= b as u32;
            for _ in 0..8 {
                if (crc & 1) != 0 {
                    crc = (crc >> 1) ^ 0xEDB8_8320;
                } else {
                    crc >>= 1;
                }
            }
        }
        yield_now().await;
    }
    !crc
}

pub fn write_zip_stored(entries: &[(&str, &[u8])]) -> Vec<u8> {
    block_on(write_zip_stored_async(entries))
}

async fn write_zip_stored_async(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut cd: Vec<u8> = Vec::new();
    for &(name, data) in entries {
        let name_bytes = name.as_bytes();
        let flags: u16 = if name.is_ascii() { 0 } else { 0x800 };
        yield_now().await;
        let crc = crc32_ieee(data).await;
        let len = data.len() as u32;
        let offset = out.len() as u32;

        out.extend_from_slice(b"PK\x03\x04");
        out.extend_from_slice(&20u16.to_le_bytes());
        out.extend_from_slice(&flags.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(name_bytes);
        for chunk in data.chunks(64 * 1024) {
            out.extend_from_slice(chunk);
            yield_now().await;
        }

        cd.extend_from_slice(b"PK\x01\x02");
        cd.extend_from_slice(&20u16.to_le_bytes());
        cd.extend_from_slice(&20u16.to_le_bytes());
        cd.extend_from_slice(&flags.to_le_bytes());
        cd.extend_from_slice(&0u16.to_le_bytes());
        cd.extend_from_slice(&0u16.to_le_bytes());
        cd.extend_from_slice(&0u16.to_le_bytes());
        cd.extend_from_slice(&crc.to_le_bytes());
        cd.extend_from_slice(&len.to_le_bytes());
        cd.extend_from_slice(&len.to_le_bytes());
        cd.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        cd.extend_from_slice(&0u16.to_le_bytes());
        cd.extend_from_slice(&0u16.to_le_bytes());
        cd.extend_from_slice(&0u16.to_le_bytes());
        cd.extend_from_slice(&0u16.to_le_bytes());
        cd.extend_from_slice(&0u32.to_le_bytes());
        cd.extend_from_slice(&offset.to_le_bytes());
        cd.extend_from_slice(name_bytes);
    }

    let cd_offset = out.len() as u32;
    let cd_size = cd.len() as u32;
    let count = entries.len() as u16;
    for chunk in cd.chunks(64 * 1024) {
        out.extend_from_slice(chunk);
        yield_now().await;
    }

    out.extend_from_slice(b"PK\x05\x06");
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&cd_size.to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::write_zip_stored;

    #[test]
    fn zip_names_mark_utf8_in_both_headers_and_preserve_ascii_flags() {
        for (name, flags) in [
            ("sheet.xml", 0u16),
            ("données.xml", 0x800),
            ("工作表.xml", 0x800),
        ] {
            let bytes = write_zip_stored(&[(name, b"content")]);
            let central =
                u32::from_le_bytes(bytes[bytes.len() - 6..bytes.len() - 2].try_into().unwrap())
                    as usize;
            assert_eq!(&bytes[..4], b"PK\x03\x04");
            assert_eq!(&bytes[central..central + 4], b"PK\x01\x02");
            assert_eq!(
                u16::from_le_bytes(bytes[6..8].try_into().unwrap()),
                flags,
                "local: {name}"
            );
            assert_eq!(
                u16::from_le_bytes(bytes[central + 8..central + 10].try_into().unwrap()),
                flags,
                "central: {name}"
            );
            assert_eq!(&bytes[30..30 + name.len()], name.as_bytes());
            assert_eq!(
                &bytes[central + 46..central + 46 + name.len()],
                name.as_bytes()
            );
        }
    }
}
