use std::collections::BTreeMap;
use std::sync::{Arc, RwLock};

use crate::errors::GitError;
use crate::models::git_object::{GitObject, UnwrappedObject};
use crate::utils::{apply_delta, crc32, from_hex, shasum, shasum_bytes, to_hex};

use crate::utils::zlib::zlib_inflate_bounded;

const MAX_OBJECT_BYTES: usize = 64 * 1024 * 1024;
const MAX_PACK_BYTES: usize = 256 * 1024 * 1024;
const MAX_OBJECTS: usize = 1_000_000;
const MAX_DELTA_DEPTH: usize = 64;

#[derive(Debug, Default)]
struct ObjectCache {
    bytes: usize,
    objects: BTreeMap<usize, UnwrappedObject>,
}

#[derive(Debug, Clone)]
pub struct GitPackIndex {
    pub hashes: Vec<String>,
    pub crcs: BTreeMap<String, u32>,
    pub offsets: BTreeMap<String, usize>,
    pub packfile_sha: String,
    pub pack: Option<Vec<u8>>,
    offset_cache: Arc<RwLock<ObjectCache>>,
}

impl GitPackIndex {
    pub fn from_idx(idx: &[u8]) -> Result<Option<Self>, GitError> {
        if idx.len() < 8 {
            return Ok(None);
        }
        if idx[0..4] != [0xff, 0x74, 0x4f, 0x63] {
            return Ok(None);
        }
        let version = u32::from_be_bytes([idx[4], idx[5], idx[6], idx[7]]);
        if version != 2 {
            return Err(GitError::internal(&format!(
                "Unable to read version {version} packfile IDX. (Only version 2 supported)"
            )));
        }
        let fanout_end = 8 + 256 * 4;
        if idx.len() < fanout_end + 40 {
            return Err(GitError::internal("Truncated packfile IDX"));
        }
        let size = u32::from_be_bytes([
            idx[fanout_end - 4],
            idx[fanout_end - 3],
            idx[fanout_end - 2],
            idx[fanout_end - 1],
        ]) as usize;

        if size > MAX_OBJECTS || size > (idx.len() - fanout_end - 40) / 28 {
            return Err(GitError::internal("Truncated or oversized packfile IDX"));
        }
        let mut pos = fanout_end;
        let mut hashes = Vec::with_capacity(size);
        for _ in 0..size {
            hashes.push(to_hex(&idx[pos..pos + 20]));
            pos += 20;
        }
        let mut crcs = BTreeMap::new();
        for hash in &hashes {
            let crc = u32::from_be_bytes([idx[pos], idx[pos + 1], idx[pos + 2], idx[pos + 3]]);
            crcs.insert(hash.clone(), crc);
            pos += 4;
        }
        let mut offsets = BTreeMap::new();
        for hash in &hashes {
            let offset =
                u32::from_be_bytes([idx[pos], idx[pos + 1], idx[pos + 2], idx[pos + 3]]) as usize;
            offsets.insert(hash.clone(), offset);
            pos += 4;
        }
        let packfile_sha = to_hex(&idx[pos..pos + 20]);
        Ok(Some(Self {
            hashes,
            crcs,
            offsets,
            packfile_sha,
            pack: None,
            offset_cache: Default::default(),
        }))
    }

    pub fn from_pack<F>(pack: &[u8], external_ref_delta: Option<&F>) -> Result<Self, GitError>
    where
        F: Fn(&str) -> Result<UnwrappedObject, GitError>,
    {
        if pack.len() < 32 || pack.len() > MAX_PACK_BYTES || &pack[..4] != b"PACK" {
            return Err(GitError::internal("Invalid or oversized PACK"));
        }
        let version = u32::from_be_bytes(pack[4..8].try_into().unwrap());
        if version != 2 && version != 3 {
            return Err(GitError::internal("Unsupported packfile version"));
        }
        let count = u32::from_be_bytes(pack[8..12].try_into().unwrap()) as usize;
        let body_end = pack.len() - 20;
        if count > MAX_OBJECTS || count > body_end - 12 {
            return Err(GitError::internal("Invalid pack object count"));
        }
        if shasum_bytes(&pack[..body_end]).as_slice() != &pack[body_end..] {
            return Err(GitError::internal("Invalid pack checksum"));
        }
        let mut cursor = 12;
        let mut inflated_bytes = 0usize;
        let mut offsets = Vec::with_capacity(count);
        let mut crcs = BTreeMap::new();
        for _ in 0..count {
            let start = cursor;
            let (kind, length, payload) = entry_header(&pack[..body_end], start)?;
            inflated_bytes = inflated_bytes.saturating_add(length);
            if inflated_bytes > MAX_PACK_BYTES {
                return Err(GitError::internal("Inflated pack exceeds byte limit"));
            }
            if let EntryKind::OfsDelta(base) = kind
                && offsets.binary_search(&base).is_err()
            {
                return Err(GitError::internal("Delta base is not an object boundary"));
            }
            let (inflated, consumed) = zlib_inflate_bounded(&pack[payload..body_end], length)?;
            if inflated.len() != length {
                return Err(GitError::internal("Pack object length mismatch"));
            }
            cursor = payload + consumed;
            offsets.push(start);
            crcs.insert(start, crc32(&pack[start..cursor]));
        }
        if cursor != body_end {
            return Err(GitError::internal(
                "Pack object count or trailing data mismatch",
            ));
        }
        let mut index = Self {
            hashes: Vec::new(),
            crcs: BTreeMap::new(),
            offsets: BTreeMap::new(),
            packfile_sha: to_hex(&pack[body_end..]),
            pack: Some(pack.to_vec()),
            offset_cache: Default::default(),
        };
        let mut unresolved = offsets;
        let mut total_bytes = 0usize;
        for _ in 0..=MAX_DELTA_DEPTH {
            if unresolved.is_empty() {
                break;
            }
            let before = unresolved.len();
            let mut next = Vec::new();
            for offset in unresolved {
                match index.read_slice(offset, external_ref_delta) {
                    Ok(object) => {
                        total_bytes = total_bytes.saturating_add(object.object.len());
                        if total_bytes > MAX_PACK_BYTES {
                            return Err(GitError::internal("Decoded pack exceeds byte limit"));
                        }
                        let oid = shasum(&GitObject::wrap(&object.object_type, &object.object));
                        if !index.offsets.contains_key(&oid) {
                            index.hashes.push(oid.clone());
                            index.offsets.insert(oid.clone(), offset);
                            index.crcs.insert(oid, crcs[&offset]);
                        }
                    }
                    Err(_) => next.push(offset),
                }
            }
            unresolved = next;
            if unresolved.len() == before {
                break;
            }
        }
        if !unresolved.is_empty() {
            return Err(GitError::internal(
                "Pack contains invalid objects, unresolved bases, or excessive delta depth",
            ));
        }
        index.hashes.sort();
        Ok(index)
    }

    pub fn load(&mut self, pack: Vec<u8>) {
        self.offset_cache = Default::default();
        self.pack = Some(pack);
    }

    pub fn unload(&mut self) {
        self.offset_cache = Default::default();
        self.pack = None;
    }

    pub fn to_buffer(&self) -> Result<Vec<u8>, GitError> {
        let mut out = Vec::new();
        out.extend_from_slice(&[0xff, 0x74, 0x4f, 0x63]);
        out.extend_from_slice(&2u32.to_be_bytes());

        for i in 0u32..256 {
            let count = self
                .hashes
                .iter()
                .filter(|h| u8::from_str_radix(&h[0..2], 16).unwrap_or(0) as u32 <= i)
                .count() as u32;
            out.extend_from_slice(&count.to_be_bytes());
        }
        for hash in &self.hashes {
            out.extend_from_slice(&from_hex(hash)?);
        }
        for hash in &self.hashes {
            let crc = self.crcs.get(hash).copied().unwrap_or(0);
            out.extend_from_slice(&crc.to_be_bytes());
        }
        for hash in &self.hashes {
            let offset = self.offsets.get(hash).copied().unwrap_or(0) as u32;
            out.extend_from_slice(&offset.to_be_bytes());
        }
        out.extend_from_slice(&from_hex(&self.packfile_sha)?);
        let idx_sha = shasum_bytes(&out);
        out.extend_from_slice(&idx_sha);
        Ok(out)
    }

    pub fn read(&self, oid: &str) -> Result<UnwrappedObject, GitError> {
        self.read_with_external::<fn(&str) -> Result<UnwrappedObject, GitError>>(oid, None)
    }

    pub fn read_with_external<F>(
        &self,
        oid: &str,
        external_ref_delta: Option<&F>,
    ) -> Result<UnwrappedObject, GitError>
    where
        F: Fn(&str) -> Result<UnwrappedObject, GitError>,
    {
        if let Some(&start) = self.offsets.get(oid) {
            return self.read_slice(start, external_ref_delta);
        }
        if let Some(ext) = external_ref_delta {
            return ext(oid);
        }
        Err(GitError::internal(&format!(
            "Could not read object {oid} from packfile"
        )))
    }

    pub fn read_slice<F>(
        &self,
        start: usize,
        external_ref_delta: Option<&F>,
    ) -> Result<UnwrappedObject, GitError>
    where
        F: Fn(&str) -> Result<UnwrappedObject, GitError>,
    {
        self.read_slice_inner(start, external_ref_delta, 0)
    }

    fn read_slice_inner<F>(
        &self,
        start: usize,
        external_ref_delta: Option<&F>,
        depth: usize,
    ) -> Result<UnwrappedObject, GitError>
    where
        F: Fn(&str) -> Result<UnwrappedObject, GitError>,
    {
        if depth > MAX_DELTA_DEPTH {
            return Err(GitError::internal("Excessive pack delta depth"));
        }
        if let Some(cached) = self.offset_cache.read().unwrap().objects.get(&start) {
            return Ok(cached.clone());
        }
        let pack = self
            .pack
            .as_ref()
            .ok_or_else(|| GitError::internal("Pack data is not loaded"))?;
        let body = pack
            .get(..pack.len().saturating_sub(20))
            .ok_or_else(|| GitError::internal("Truncated pack"))?;
        let (kind, length, pos) = entry_header(body, start)?;
        // Resolve the base before inflating this delta, bounding live recursion memory.
        let (object_type, base) = match kind {
            EntryKind::Direct(kind) => (kind.to_string(), None),
            EntryKind::OfsDelta(offset) => {
                let base = self.read_slice_inner(offset, external_ref_delta, depth + 1)?;
                (base.object_type, Some(base.object))
            }
            EntryKind::RefDelta(oid) => {
                let base = if let Some(offset) = self.offsets.get(&oid) {
                    self.read_slice_inner(*offset, external_ref_delta, depth + 1)?
                } else if let Some(external) = external_ref_delta {
                    external(&oid)?
                } else {
                    return Err(GitError::internal("Missing delta base"));
                };
                if base.object.len() > MAX_OBJECT_BYTES
                    || shasum(&GitObject::wrap(&base.object_type, &base.object)) != oid
                {
                    return Err(GitError::internal("Invalid external delta base"));
                }
                (base.object_type, Some(base.object))
            }
        };
        let (inflated, _) = zlib_inflate_bounded(&body[pos..], length)?;
        if inflated.len() != length {
            return Err(GitError::internal("Pack object length mismatch"));
        }
        let object = if let Some(base) = base {
            apply_delta(&inflated, &base)?
        } else {
            inflated
        };
        let result = UnwrappedObject {
            object_type,
            object,
        };
        let mut cache = self.offset_cache.write().unwrap();
        if !cache.objects.contains_key(&start) {
            if result.object.len() > MAX_OBJECT_BYTES.saturating_sub(cache.bytes) {
                cache.objects.clear();
                cache.bytes = 0;
            }
            cache.bytes += result.object.len();
            cache.objects.insert(start, result.clone());
        }
        Ok(result)
    }
}

enum EntryKind {
    Direct(&'static str),
    OfsDelta(usize),
    RefDelta(String),
}

fn entry_header(body: &[u8], start: usize) -> Result<(EntryKind, usize, usize), GitError> {
    let invalid = || GitError::internal("Invalid pack object header");
    if start < 12 {
        return Err(invalid());
    }
    let mut pos = start;
    let mut byte = *body.get(pos).ok_or_else(invalid)?;
    pos += 1;
    let kind = (byte >> 4) & 7;
    let mut length = (byte & 15) as usize;
    let mut shift = 4;
    while byte & 128 != 0 {
        byte = *body.get(pos).ok_or_else(invalid)?;
        pos += 1;
        if shift >= usize::BITS as usize || (byte & 127) as usize > usize::MAX >> shift {
            return Err(invalid());
        }
        length |= ((byte & 127) as usize) << shift;
        shift += 7;
    }
    if length > MAX_OBJECT_BYTES {
        return Err(GitError::internal("Pack object exceeds byte limit"));
    }
    let kind = match kind {
        1 => EntryKind::Direct("commit"),
        2 => EntryKind::Direct("tree"),
        3 => EntryKind::Direct("blob"),
        4 => EntryKind::Direct("tag"),
        6 => {
            let mut byte = *body.get(pos).ok_or_else(invalid)?;
            pos += 1;
            let mut distance = (byte & 127) as usize;
            while byte & 128 != 0 {
                byte = *body.get(pos).ok_or_else(invalid)?;
                pos += 1;
                distance = distance
                    .checked_add(1)
                    .and_then(|n| n.checked_mul(128))
                    .and_then(|n| n.checked_add((byte & 127) as usize))
                    .ok_or_else(invalid)?;
            }
            if distance == 0 || distance > start - 12 {
                return Err(invalid());
            }
            EntryKind::OfsDelta(start - distance)
        }
        7 => {
            let oid = body.get(pos..pos + 20).ok_or_else(invalid)?;
            pos += 20;
            EntryKind::RefDelta(to_hex(oid))
        }
        _ => return Err(invalid()),
    };
    Ok((kind, length, pos))
}
