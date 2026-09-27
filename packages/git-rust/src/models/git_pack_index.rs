use std::collections::BTreeMap;

use crate::errors::GitError;
use crate::models::git_object::{GitObject, UnwrappedObject};
use crate::utils::{
    apply_delta, crc32, from_hex, shasum, shasum_bytes, to_hex, zlib_inflate_with_consumed,
};

#[derive(Debug, Clone)]
pub struct GitPackIndex {
    pub hashes: Vec<String>,
    pub crcs: BTreeMap<String, u32>,
    pub offsets: BTreeMap<String, usize>,
    pub packfile_sha: String,
    pub pack: Option<Vec<u8>>,
    offset_cache: BTreeMap<usize, UnwrappedObject>,
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
            let offset = u32::from_be_bytes([idx[pos], idx[pos + 1], idx[pos + 2], idx[pos + 3]])
                as usize;
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
            offset_cache: BTreeMap::new(),
        }))
    }

    pub fn from_pack<F>(pack: &[u8], external_ref_delta: Option<&F>) -> Result<Self, GitError>
    where
        F: Fn(&str) -> Result<UnwrappedObject, GitError>,
    {
        if pack.len() < 12 || &pack[0..4] != b"PACK" {
            return Err(GitError::internal("Invalid PACK header"));
        }
        let version = u32::from_be_bytes([pack[4], pack[5], pack[6], pack[7]]);
        if version != 2 {
            return Err(GitError::internal(&format!(
                "Invalid packfile version: {version}"
            )));
        }
        let num_objects = u32::from_be_bytes([pack[8], pack[9], pack[10], pack[11]]) as usize;
        let packfile_sha = if pack.len() >= 20 {
            to_hex(&pack[pack.len() - 20..])
        } else {
            String::new()
        };

        if pack.len() <= 12 {
            return Ok(Self {
                hashes: Vec::new(),
                crcs: BTreeMap::new(),
                offsets: BTreeMap::new(),
                packfile_sha,
                pack: Some(pack.to_vec()),
                offset_cache: BTreeMap::new(),
            });
        }

        let mut entry_offsets = Vec::with_capacity(num_objects);
        let mut entry_crcs = BTreeMap::new();
        let mut cursor = 12usize;
        let max_body = pack.len().saturating_sub(20);

        for _ in 0..num_objects {
            if cursor >= max_body {
                break;
            }
            let entry_start = cursor;
            let b0 = pack[cursor];
            cursor += 1;
            let btype = (b0 >> 4) & 0x07;
            let mut b = b0;
            while (b & 0x80) != 0 {
                if cursor >= pack.len() {
                    break;
                }
                b = pack[cursor];
                cursor += 1;
            }
            if btype == 6 {
                // ofs-delta
                let mut ob = pack[cursor];
                cursor += 1;
                while (ob & 0x80) != 0 {
                    ob = pack[cursor];
                    cursor += 1;
                }
            } else if btype == 7 {
                // ref-delta
                cursor += 20;
            }
            let Ok((_inflated, consumed)) = zlib_inflate_with_consumed(&pack[cursor..]) else {
                break;
            };
            let entry_end = cursor + consumed;
            let entry_crc = crc32(&pack[entry_start..entry_end]);
            entry_offsets.push(entry_start);
            entry_crcs.insert(entry_start, entry_crc);
            cursor = entry_end;
        }

        let mut p = Self {
            hashes: Vec::new(),
            crcs: BTreeMap::new(),
            offsets: BTreeMap::new(),
            packfile_sha,
            pack: Some(pack.to_vec()),
            offset_cache: BTreeMap::new(),
        };

        // Pass 1 & 2 (handles forward or backward ref-deltas in thin packs)
        let mut unresolved = entry_offsets;
        for _pass in 0..3 {
            if unresolved.is_empty() {
                break;
            }
            let mut next_unresolved = Vec::new();
            for offset in unresolved {
                match p.read_slice(offset, external_ref_delta) {
                    Ok(unwrapped) => {
                        let wrapped = GitObject::wrap(&unwrapped.object_type, &unwrapped.object);
                        let oid = shasum(&wrapped);
                        if !p.offsets.contains_key(&oid) {
                            p.hashes.push(oid.clone());
                            p.offsets.insert(oid.clone(), offset);
                            if let Some(&c) = entry_crcs.get(&offset) {
                                p.crcs.insert(oid, c);
                            }
                        }
                    }
                    Err(_) => {
                        next_unresolved.push(offset);
                    }
                }
            }
            unresolved = next_unresolved;
        }

        p.hashes.sort();
        Ok(p)
    }

    pub fn load(&mut self, pack: Vec<u8>) {
        self.pack = Some(pack);
    }

    pub fn unload(&mut self) {
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

    pub fn read(&mut self, oid: &str) -> Result<UnwrappedObject, GitError> {
        self.read_with_external::<fn(&str) -> Result<UnwrappedObject, GitError>>(oid, None)
    }

    pub fn read_with_external<F>(
        &mut self,
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
        &mut self,
        start: usize,
        external_ref_delta: Option<&F>,
    ) -> Result<UnwrappedObject, GitError>
    where
        F: Fn(&str) -> Result<UnwrappedObject, GitError>,
    {
        if let Some(cached) = self.offset_cache.get(&start) {
            return Ok(cached.clone());
        }
        let pack = self.pack.as_ref().ok_or_else(|| {
            GitError::internal(
                "Could not read packfile data. The packfile may be missing, corrupted, or too large to read into memory.",
            )
        })?;
        if start >= pack.len() {
            return Err(GitError::internal("Pack offset out of bounds"));
        }
        let mut pos = start;
        let b0 = pack[pos];
        pos += 1;
        let btype = (b0 >> 4) & 0x07;
        let mut length = (b0 & 0x0f) as usize;
        let mut shift = 4usize;
        let mut b = b0;
        while (b & 0x80) != 0 {
            b = pack[pos];
            pos += 1;
            length |= ((b & 0x7f) as usize) << shift;
            shift += 7;
        }

        enum EntryKind {
            Direct(&'static str),
            OfsDelta(usize),
            RefDelta(String),
        }

        let kind = match btype {
            1 => EntryKind::Direct("commit"),
            2 => EntryKind::Direct("tree"),
            3 => EntryKind::Direct("blob"),
            4 => EntryKind::Direct("tag"),
            6 => {
                let mut ob = pack[pos];
                pos += 1;
                let mut neg_offset = (ob & 0x7f) as usize;
                while (ob & 0x80) != 0 {
                    ob = pack[pos];
                    pos += 1;
                    neg_offset = ((neg_offset + 1) << 7) | ((ob & 0x7f) as usize);
                }
                EntryKind::OfsDelta(start - neg_offset)
            }
            7 => {
                let base_oid = to_hex(&pack[pos..pos + 20]);
                pos += 20;
                EntryKind::RefDelta(base_oid)
            }
            _ => {
                return Err(GitError::internal(&format!(
                    "Unrecognized pack object type: {btype}"
                )))
            }
        };

        let (inflated, _) = zlib_inflate_with_consumed(&pack[pos..])?;
        if inflated.len() != length {
            return Err(GitError::internal(&format!(
                "Packfile told us object would have length {length} but it had length {}",
                inflated.len()
            )));
        }

        let result = match kind {
            EntryKind::Direct(t) => UnwrappedObject {
                object_type: t.to_string(),
                object: inflated,
            },
            EntryKind::OfsDelta(base_offset) => {
                let base = self.read_slice(base_offset, external_ref_delta)?;
                let target = apply_delta(&inflated, &base.object)?;
                UnwrappedObject {
                    object_type: base.object_type,
                    object: target,
                }
            }
            EntryKind::RefDelta(base_oid) => {
                let base = self.read_with_external(&base_oid, external_ref_delta)?;
                let target = apply_delta(&inflated, &base.object)?;
                UnwrappedObject {
                    object_type: base.object_type,
                    object: target,
                }
            }
        };

        self.offset_cache.insert(start, result.clone());
        Ok(result)
    }
}
