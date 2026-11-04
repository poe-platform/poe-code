use super::{EntryIdentity, FileStat, OverlayVfs, SafeBashFs, VfsEntryKind};
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

    pub(crate) fn apply_observed_chmod(
        &self,
        path: &str,
        mode: u32,
        receipts: &[OverlayChmodReceipt],
        stage: bool,
    ) -> Result<(), String> {
        if mode > 0o7777 {
            return Err("EINVAL: invalid chmod mode".into());
        }
        let whiteout_count = self
            .whiteouts
            .read()
            .map_err(|_| "EIO: input/output error")?
            .len();
        let versions = (self.lower.generation(), self.upper.generation());
        let version = self.generation();
        let mut st = self.check_observed_chmod(path, receipts)?;
        let directory = st.kind == VfsEntryKind::Directory;
        let parent = dirname_posix_path(path);
        let upper = self.upper.memory_backend().unwrap();
        let lower = self.lower.memory_backend().unwrap();
        if !directory && self.stat(&parent)?.mode & 0o300 != 0o300 {
            return Err(format!("EACCES: permission denied, overlay '{parent}'"));
        }
        if stage {
            if directory && upper.lstat(path).is_ok() {
                return Ok(());
            }
            // TypeScript stages the copy in the upper root, and publishes each
            // missing directory into a writable parent before the final guard.
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
        }
        if directory || (stage && upper.lstat(&parent).is_err()) {
            let dest = if directory { path } else { &parent };
            if !directory {
                st = self.stat(dest)?;
            } else if !stage {
                st.mode = 0o040000 | mode;
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
                return Ok(());
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
        if stage {
            return Ok(());
        }
        let bytes = self.read_file(path)?;
        self.replace_file_entry_with_metadata(
            path,
            &bytes,
            mode,
            (Some(st.atime_ms), Some(st.mtime_ms)),
            version,
        )
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
        self.apply_observed_chmod(path, mode, receipts, true)?;
        guard()?;
        self.apply_observed_chmod(path, mode, receipts, false)
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
