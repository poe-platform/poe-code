//! Git pack encoding from caller-owned object storage.
use super::git_object::UnwrappedObject;
use crate::errors::GitError;
use crate::utils::{shasum_bytes, zlib_deflate};

/// Encode objects as a SHA-1 version-2 pack, without requiring a `MemoryFs`.
/// The source is consumed one object at a time; its errors abort the pack.
pub fn encode_pack(
    objects: impl IntoIterator<Item = Result<UnwrappedObject, GitError>>,
) -> Result<Vec<u8>, GitError> {
    let mut pack = b"PACK\0\0\0\x02\0\0\0\0".to_vec();
    let mut count = 0u32;
    for object in objects {
        let object = object?;
        count = count
            .checked_add(1)
            .ok_or_else(|| GitError::internal("Too many pack objects"))?;
        let kind = match object.object_type.as_str() {
            "commit" => 0x10,
            "tree" => 0x20,
            "blob" => 0x30,
            "tag" => 0x40,
            _ => return Err(GitError::internal("Unknown pack object type")),
        };
        let mut length = object.object.len();
        pack.push(kind | (length & 15) as u8 | if length > 15 { 128 } else { 0 });
        length >>= 4;
        while length != 0 {
            pack.push((length & 127) as u8 | if length > 127 { 128 } else { 0 });
            length >>= 7;
        }
        pack.extend_from_slice(&zlib_deflate(&object.object));
    }
    pack[8..12].copy_from_slice(&count.to_be_bytes());
    let checksum = shasum_bytes(&pack);
    pack.extend_from_slice(&checksum);
    Ok(pack)
}
