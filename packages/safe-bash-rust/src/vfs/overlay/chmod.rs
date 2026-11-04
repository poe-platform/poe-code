use super::{EntryIdentity, FileStat, OverlayVfs, SafeBashFs, VfsEntryKind};
use crate::vfs::memory::StagedFile;
use crate::vfs::{dirname_posix_path, normalize_posix_path};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_OWNER: AtomicU64 = AtomicU64::new(1);

pub(super) fn new_owner() -> u64 {
    NEXT_OWNER.fetch_add(1, Ordering::Relaxed)
}

/// The path and both backing entries at the time of inspection. A directory's
/// logical identity survives a copy made by this overlay.
#[derive(Clone, Debug)]
pub struct OverlayChmodReceipt {
    pub(crate) path: String,
    pub(crate) stamp: [u64; 6],
}

impl OverlayVfs {
    pub fn observe_chmod(&self, path: &str) -> Result<(FileStat, OverlayChmodReceipt), String> {
        if self.lower.memory_backend().is_none() || self.upper.memory_backend().is_none() {
            return Err("ENOTSUP: chmod requires memory-backed overlay layers".into());
        }
        let version = self.generation();
        let path = self.access_path(path, false)?;
        let visible = self.lstat(&path)?;
        let mut stamp = [0; 6];
        stamp[0] = self.receipt_owner;
        stamp[1] = match visible.identity {
            Some(EntryIdentity::OverlayDirectory { scope, .. }) => scope,
            _ => 0,
        };
        for (index, layer) in [(2, &self.upper), (4, &self.lower)] {
            if index == 4 && self.is_deleted(&path) {
                continue;
            }
            match layer.lstat(&path) {
                Ok(st) => {
                    let Some(EntryIdentity::Memory(_, ino)) = st.identity else {
                        return Err("ENOTSUP: missing overlay identity".into());
                    };
                    stamp[index] = ino;
                    stamp[index + 1] = st.revision.unwrap_or(u64::MAX);
                }
                Err(e) if e.starts_with("ENOENT:") || e.starts_with("ENOTDIR:") => {}
                Err(e) => return Err(e),
            }
        }
        if self.generation() != version {
            return Err(format!("EAGAIN: changed during stat, overlay '{path}'"));
        }
        Ok((visible, OverlayChmodReceipt { path, stamp }))
    }

    pub(crate) fn check_observed_chmod(
        &self,
        path: &str,
        receipts: &[OverlayChmodReceipt],
    ) -> Result<FileStat, String> {
        if path.contains('\0') || path != normalize_posix_path(path) {
            return Err("EINVAL: invalid overlay path".into());
        }
        let parents =
            std::iter::once("/").chain(path.match_indices('/').skip(1).map(|(i, _)| &path[..i]));
        if parents.clone().count() + 2 != receipts.len() {
            return Err("EINVAL: incomplete overlay ancestry".into());
        }
        let mut result = None;
        for (i, (p, r)) in parents
            .chain([dirname_posix_path(path).as_str(), path])
            .zip(receipts)
            .enumerate()
        {
            if r.path != p || r.stamp[0] != self.receipt_owner {
                return Err(format!("ENOTSUP: unowned receipt, receipt '{p}'"));
            }
            let (st, now) = self.observe_chmod(p).map_err(|e| {
                if e.starts_with("ENOENT:") || e.starts_with("ENOTDIR:") {
                    format!("EAGAIN: entry changed, receipt '{p}'")
                } else {
                    e
                }
            })?;
            if r.stamp[1] != 0 {
                if now.stamp[1] != r.stamp[1] {
                    return Err(format!("EAGAIN: directory changed, receipt '{p}'"));
                }
            } else if r.stamp != now.stamp {
                return Err(format!("EAGAIN: entry changed, receipt '{p}'"));
            }
            if i + 1 < receipts.len() {
                if st.kind != VfsEntryKind::Directory {
                    return Err(format!("ENOTDIR: not a directory, receipt '{p}'"));
                }
                if st.mode & 0o100 == 0 {
                    return Err(format!("EACCES: permission denied, receipt '{p}'"));
                }
            } else {
                result = Some(st);
            }
        }
        result.ok_or_else(|| "EINVAL: incomplete overlay ancestry".into())
    }

    pub(crate) fn stage_observed_chmod(
        &self,
        path: &str,
        mode: u32,
        receipts: &[OverlayChmodReceipt],
    ) -> Result<Option<StagedFile>, String> {
        let whiteout_count = self
            .whiteouts
            .read()
            .map_err(|_| "EIO: input/output error")?
            .len();
        let versions = (self.lower.generation(), self.upper.generation());
        let mut st = self.check_observed_chmod(path, receipts)?;
        let directory = st.kind == VfsEntryKind::Directory;
        let upper = self.upper.memory_backend().unwrap();
        let lower = self.lower.memory_backend().unwrap();
        if directory && upper.lstat(path).is_ok() {
            return Ok(None);
        }

        let parent = dirname_posix_path(path);
        let mut dir = parent.clone();
        loop {
            if self.stat(&dir)?.mode & 0o300 != 0o300 {
                return Err(format!("EACCES: permission denied, overlay '{dir}'"));
            }
            if dir == "/" || upper.lstat(&dir).is_ok() {
                break;
            }
            dir = dirname_posix_path(&dir);
        }
        if upper.stat("/")?.mode & 0o300 != 0o300 {
            return Err("EACCES: permission denied, overlay '/'".into());
        }
        if directory || upper.lstat(&parent).is_err() {
            let dest = if directory { path } else { &parent };
            if !directory {
                st = self.stat(dest)?;
            }
            let whiteouts = self
                .whiteouts
                .read()
                .map_err(|_| "EIO: input/output error")?;
            if whiteouts.len() != whiteout_count {
                return Err(format!("EAGAIN: entry changed, overlay '{dest}'"));
            }
            self.copy_up_directories(dest, || upper.copy_up_metadata(lower, versions, dest, &st))?;
            if directory {
                return Ok(None);
            }
            drop(whiteouts);
            st = self.check_observed_chmod(path, receipts)?;
        }
        if st.nlink != Some(1) {
            return Err(format!(
                "ENOTSUP: copy-up cannot preserve hardlink identity, overlay '{path}'"
            ));
        }
        if st.kind != VfsEntryKind::File || st.mode & 0o170000 != 0o100000 {
            return Err(format!(
                "ENOTSUP: unsupported overlay entry, overlay '{path}'"
            ));
        }
        if st.mode & 0o400 == 0 {
            return Err(format!("EACCES: permission denied, overlay '{path}'"));
        }
        let source = self.open_read_file(path, false)?;
        upper.stage_file(source.as_ref(), &st, mode).map(Some)
    }

    pub(crate) fn finish_observed_chmod(
        &self,
        path: &str,
        mode: u32,
        receipts: &[OverlayChmodReceipt],
        staged: Option<StagedFile>,
    ) -> Result<(), String> {
        let count = self
            .whiteouts
            .read()
            .map_err(|_| "EIO: input/output error")?
            .len();
        let versions = (self.lower.generation(), self.upper.generation());
        let mut st = self.check_observed_chmod(path, receipts)?;
        if staged.is_some() {
            let parent = dirname_posix_path(path);
            if self.stat(&parent)?.mode & 0o300 != 0o300 {
                return Err(format!("EACCES: permission denied, overlay '{parent}'"));
            }
        }
        let whiteouts = self
            .whiteouts
            .read()
            .map_err(|_| "EIO: input/output error")?;
        if whiteouts.len() != count {
            return Err(format!("EAGAIN: entry changed, overlay '{path}'"));
        }
        let lower = self.lower.memory_backend().unwrap();
        if let Some(file) = staged {
            return file.publish(lower, versions, path);
        }
        let upper = self.upper.memory_backend().unwrap();
        st.mode = 0o040000 | mode;
        upper.copy_up_metadata(lower, versions, path, &st)
    }

    /// The ordered receipts are for the root through the parent, the parent
    /// again, and the target (as in the filesystem chmod contract).
    pub fn chmod_observed(
        &self,
        path: &str,
        mode: u32,
        receipts: &[OverlayChmodReceipt],
        mut guard: impl FnMut() -> Result<(), String>,
    ) -> Result<(), String> {
        if mode > 0o7777 {
            return Err("EINVAL: invalid chmod mode".into());
        }
        if receipts.iter().any(|r| r.stamp[0] != self.receipt_owner) {
            return Err(format!("ENOTSUP: unowned receipt, receipt '{path}'"));
        }
        guard()?;
        self.check_observed_chmod(path, receipts)?;
        guard()?;
        let file = self.stage_observed_chmod(path, mode, receipts)?;
        guard()?;
        self.finish_observed_chmod(path, mode, receipts, file)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::MemoryVfs;
    use std::sync::Arc;

    fn receipts(fs: &OverlayVfs) -> Vec<OverlayChmodReceipt> {
        ["/", "/d", "/d", "/d/f"]
            .map(|p| fs.observe_chmod(p).unwrap().1)
            .into()
    }
    #[test]
    fn overlay_chmod_charges_staged_bytes_before_the_last_guard_and_releases_on_refusal() {
        let lower = Arc::new(MemoryVfs::new());
        let upper = Arc::new(MemoryVfs::new());
        lower.write_file("/d/f", b"ab").unwrap();
        let fs = OverlayVfs::new(lower, upper.clone());
        let observed = receipts(&fs);
        let original = fs.stat("/d/f").unwrap();
        for (bytes, file_bytes, code) in [(1, 2, "ENOSPC"), (2, 1, "EFBIG")] {
            upper.set_max_total_bytes(bytes);
            upper.set_max_file_bytes(file_bytes);
            let mut calls = 0;
            let err = fs
                .chmod_observed("/d/f", 0o700, &observed, || {
                    calls += 1;
                    Ok(())
                })
                .unwrap_err();
            assert!(err.starts_with(code), "{err}");
            assert_eq!(calls, 2);
        }
        upper.set_max_file_bytes(2);
        let mut calls = 0;
        let err = fs
            .chmod_observed("/d/f", 0o700, &observed, || {
                calls += 1;
                if calls == 3 {
                    assert!(
                        upper
                            .write_file("/other", b"x")
                            .unwrap_err()
                            .starts_with("ENOSPC")
                    );
                    return Err("refused".into());
                }
                Ok(())
            })
            .unwrap_err();
        assert_eq!(err, "refused");
        assert_eq!(fs.stat("/d/f").unwrap().identity, original.identity);
        upper.write_file("/other", b"ok").unwrap();
    }

    #[test]
    fn overlay_chmod_reserves_an_entry_and_discards_stale_stages_after_snapshot_restore() {
        let lower = Arc::new(MemoryVfs::new());
        let upper = Arc::new(MemoryVfs::new());
        lower.write_file("/d/f", b"ab").unwrap();
        let fs = OverlayVfs::new(lower, upper.clone());
        upper.set_max_entries(3); // root, copied directory, staged file
        upper.set_max_total_bytes(2);
        let mut calls = 0;
        let err = fs
            .chmod_observed("/d/f", 0o700, &receipts(&fs), || {
                calls += 1;
                if calls == 3 {
                    assert!(
                        upper
                            .create_file("/other", b"", 0o600)
                            .unwrap_err()
                            .starts_with("ENOSPC")
                    );
                    upper.replace_entries(&[])?;
                }
                Ok(())
            })
            .unwrap_err();
        assert!(err.starts_with("EAGAIN"), "{err}");
        assert_eq!(fs.read_file("/d/f").unwrap(), b"ab");
        upper.write_file("/other", b"ok").unwrap();
        upper.mkdir_all("/last").unwrap();
    }

    #[test]
    fn overlay_chmod_replaces_only_the_upper_file_and_checks_both_layers() {
        let lower = Arc::new(MemoryVfs::new());
        let upper = Arc::new(MemoryVfs::new());
        lower.write_file("/d/f", b"lower").unwrap();
        let fs = OverlayVfs::new(lower.clone(), upper.clone());
        let first = receipts(&fs);
        fs.chmod_observed("/d/f", 0o600, &first, || Ok(())).unwrap();
        assert_eq!(lower.stat("/d/f").unwrap().mode, 0o100644);
        assert_eq!(upper.read_file("/d/f").unwrap(), b"lower");
        let old = upper.open_read_file("/d/f", false).unwrap();
        let second = receipts(&fs);
        fs.chmod_observed("/d/f", 0o640, &second, || Ok(()))
            .unwrap();
        assert_eq!(old.stat().unwrap().mode, 0o100600);
        assert_ne!(
            upper.stat("/d/f").unwrap().identity,
            old.stat().unwrap().identity
        );
        let third = receipts(&fs);
        let mut calls = 0;
        assert!(
            fs.chmod_observed("/d/f", 0o777, &third, || {
                calls += 1;
                if calls == 3 {
                    lower.write_file("/d/f", b"other")?;
                }
                Ok(())
            })
            .unwrap_err()
            .starts_with("EAGAIN:")
        );
        assert_eq!(calls, 3);
        assert_eq!(upper.stat("/d/f").unwrap().mode, 0o100640);
    }
}
