use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, RwLock};

use crate::errors::GitError;
use crate::fs::{FileStat, MemoryFs};
use crate::models::GitPackIndex;
use crate::models::git_object::UnwrappedObject;
use crate::utils::{shasum, to_hex};

use super::_read_object;

#[derive(Debug)]
struct CachedPack {
    index_stat: Option<FileStat>,
    pack_stat: Option<FileStat>,
    index: Arc<GitPackIndex>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct PackCache {
    entries: Arc<RwLock<BTreeMap<String, CachedPack>>>,
}

impl PackCache {
    pub(super) fn retain(&self, directory: &str, names: &BTreeSet<String>) {
        let prefix = format!("{directory}/");
        self.entries.write().unwrap().retain(|path, _| {
            path.strip_prefix(&prefix)
                .is_none_or(|name| names.contains(name))
        });
    }

    pub(super) fn index(
        &self,
        fs: &MemoryFs,
        gitdir: &str,
        pack_path: &str,
        load_pack: bool,
    ) -> Result<Option<Arc<GitPackIndex>>, GitError> {
        let index_path = pack_path.trim_end_matches(".pack").to_string() + ".idx";
        let index_stat = fs.stat(&index_path).ok();
        let pack_stat = fs.stat(pack_path).ok();
        let mut index = self
            .entries
            .read()
            .unwrap()
            .get(pack_path)
            .filter(|cached| cached.index_stat == index_stat && cached.pack_stat == pack_stat)
            .map(|cached| cached.index.clone());
        if let Some(index) = &index
            && (!load_pack || index.pack.is_some())
        {
            return Ok(Some(index.clone()));
        }
        if index.is_none() {
            index = fs
                .read(&index_path)
                .map(|bytes| GitPackIndex::from_idx(&bytes))
                .transpose()?
                .flatten()
                .map(Arc::new);
        }
        if index.is_none() || load_pack {
            let Some(bytes) = fs.read(pack_path) else {
                if index.is_none() {
                    return Ok(None);
                }
                return Err(GitError::internal(&format!(
                    "Could not read packfile at {pack_path}. The file may be missing, corrupted, or too large to read into memory."
                )));
            };
            let body_end = bytes
                .len()
                .checked_sub(20)
                .ok_or_else(|| GitError::internal("Truncated packfile trailer"))?;
            let trailer = to_hex(&bytes[body_end..]);
            let expected = index
                .as_ref()
                .map_or(trailer.as_str(), |index| index.packfile_sha.as_str());
            if trailer != expected {
                return Err(GitError::internal(&format!(
                    "Packfile trailer mismatch: expected {expected}, got {trailer}. The packfile may be corrupted."
                )));
            }
            let actual = shasum(&bytes[..body_end]);
            if actual != expected {
                return Err(GitError::internal(&format!(
                    "Packfile payload corrupted: calculated {actual} but expected {expected}. The packfile may have been tampered with."
                )));
            }
            let loaded = if let Some(index) = index {
                let mut loaded = (*index).clone();
                loaded.load(bytes);
                loaded
            } else {
                let external = |oid: &str| {
                    let object = _read_object(fs, gitdir, oid, "content")?;
                    Ok(UnwrappedObject {
                        object_type: object.obj_type,
                        object: object.object,
                    })
                };
                GitPackIndex::from_pack(&bytes, Some(&external))?
            };
            index = Some(Arc::new(loaded));
        }
        if let Some(index) = &index {
            self.entries.write().unwrap().insert(
                pack_path.to_string(),
                CachedPack {
                    index_stat,
                    pack_stat,
                    index: index.clone(),
                },
            );
        }
        Ok(index)
    }
}
