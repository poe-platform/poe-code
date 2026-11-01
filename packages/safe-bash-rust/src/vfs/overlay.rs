use crate::vfs::path::normalize_posix_path;
use crate::vfs::{EntryIdentity, FileStat, SafeBashFs, VfsEntryKind, VfsFileEntry};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, RwLock};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_DIRECTORY_SCOPE: AtomicU64 = AtomicU64::new(1);

struct DirectoryObservation {
    upper: Option<EntryIdentity>,
    lower: Option<EntryIdentity>,
    logical: EntryIdentity,
}

#[derive(Clone)]
pub struct OverlayVfs {
    lower: Arc<dyn SafeBashFs>,
    upper: Arc<dyn SafeBashFs>,
    whiteouts: Arc<RwLock<BTreeSet<String>>>,
    directories: Arc<Mutex<BTreeMap<String, DirectoryObservation>>>,
}

impl OverlayVfs {
    pub fn new(lower: Arc<dyn SafeBashFs>, upper: Arc<dyn SafeBashFs>) -> Self {
        Self {
            lower,
            upper,
            whiteouts: Arc::new(RwLock::new(BTreeSet::new())),
            directories: Default::default(),
        }
    }

    pub fn lower(&self) -> &Arc<dyn SafeBashFs> {
        &self.lower
    }

    pub fn upper(&self) -> &Arc<dyn SafeBashFs> {
        &self.upper
    }

    fn is_deleted(&self, norm: &str) -> bool {
        let Ok(guard) = self.whiteouts.read() else {
            return false;
        };
        if guard.contains(norm) {
            return true;
        }
        for w in guard.iter() {
            if norm.starts_with(&format!("{w}/")) {
                return true;
            }
        }
        false
    }

    fn metadata(&self, path: &str, follow: bool) -> Result<FileStat, String> {
        let norm = self.access_path(path, follow)?;
        let versions = (self.upper.generation(), self.lower.generation());
        let upper = self.upper.lstat(&norm).ok();
        let upper_id = upper.as_ref().and_then(|st| st.identity.clone());
        let mut st = match upper {
            Some(st) => st,
            None if self.is_deleted(&norm) => return Err(format!("ENOENT: no such file or directory, overlay '{norm}'")),
            None => self.lower.lstat(&norm).map_err(|e| if e.starts_with("ENOENT:") {
                format!("ENOENT: no such file or directory, overlay '{norm}'")
            } else { e })?,
        };
        if st.kind == VfsEntryKind::Directory && self.upper.memory_backend().is_some() && self.lower.memory_backend().is_some()
            && let Some(EntryIdentity::Memory(dev, ino)) = st.identity {
            let lower_id = if upper_id.is_none() { st.identity.clone() }
                else if self.is_deleted(&norm) { None } else { self.lower.lstat(&norm).ok().and_then(|s| s.identity) };
            let mut dirs = self.directories.lock().map_err(|_| "EIO: input/output error")?;
            if versions != (self.upper.generation(), self.lower.generation()) { return Err("EAGAIN: directory changed during stat".into()); }
            if let Some(d) = dirs.get(&norm) && d.upper == upper_id && d.lower == lower_id {
                st.identity = Some(d.logical.clone());
            } else {
                let logical = EntryIdentity::OverlayDirectory { scope: NEXT_DIRECTORY_SCOPE.fetch_add(1, Ordering::Relaxed), dev, ino };
                st.identity = Some(logical.clone());
                dirs.insert(norm, DirectoryObservation { upper: upper_id, lower: lower_id, logical });
            }
        }
        Ok(st)
    }

    // A successful write to stock memory advances its generation once. Carry an
    // existing directory observation across the upper parents created by that write.
    // Independent layer edits cannot certify a copy-up.
    fn copy_up_directories(&self, dir: &str, write: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
        if self.upper.memory_backend().is_none() || self.lower.memory_backend().is_none() { return write(); }
        let mut dirs = self.directories.lock().map_err(|_| "EIO: input/output error")?;
        if dirs.is_empty() { drop(dirs); return write(); }
        let versions = (self.upper.generation(), self.lower.generation());
        let mut watched = Vec::new();
        let mut path = dir;
        while !path.is_empty() && path != "/" && self.upper.lstat(path).is_err() {
            if let Some(d) = dirs.get(path) && d.upper.is_none() && d.lower.is_some() { watched.push(path); }
            path = path.rsplit_once('/').map_or("", |(parent, _)| parent);
        }
        if watched.is_empty() { drop(dirs); return write(); }
        write()?;
        for path in watched {
            let upper = self.upper.lstat(path).ok().filter(|s| s.kind == VfsEntryKind::Directory).and_then(|s| s.identity);
            let lower = self.lower.lstat(path).ok().and_then(|s| s.identity);
            if versions.0.checked_add(1) != Some(self.upper.generation()) || versions.1 != self.lower.generation() { break; }
            if let Some(d) = dirs.get_mut(path) && d.lower == lower { d.upper = upper; }
        }
        Ok(())
    }

    fn forget_directory(&self, path: &str) {
        let mut dirs = self.directories.lock().unwrap();
        dirs.remove(path);
        let prefix = format!("{path}/");
        let descendants: Vec<_> = dirs.range(prefix.clone()..).map(|(p, _)| p)
            .take_while(|p| p.starts_with(&prefix)).cloned().collect();
        for p in descendants { dirs.remove(&p); }
    }

    fn remove_entry(&self, path: &str, directory: bool, recursive: bool) -> Result<(), String> {
        // Whiteouts are only inserted, so their count also identifies the visible namespace.
        let whiteout_count = self.whiteouts.read().map_err(|_| "EIO: input/output error")?.len();
        let versions = (self.lower.generation(), self.upper.generation());
        if path.is_empty() { return Err("ENOENT: no such file or directory".into()); }
        let trimmed = path.trim_end_matches('/');
        if !recursive && matches!(trimmed.rsplit('/').next(), Some("." | "..")) { return Err("EINVAL: invalid argument".into()); }
        if trimmed.is_empty() { return Err("EBUSY: resource busy or locked".into()); }
        let entry = self.access_path(if recursive { path } else { trimmed }, false)?;
        if entry == "/" { return Err("EBUSY: resource busy or locked".into()); }
        let st = self.lstat(&entry)?;
        if st.mode & 0o170000 == 0o020000 {
            return Err("EBUSY: resource busy or locked".into());
        }
        let is_dir = st.kind == VfsEntryKind::Directory;
        if !is_dir && (directory || path.ends_with('/')) { return Err("ENOTDIR: not a directory".into()); }
        if self.stat(&crate::vfs::dirname_posix_path(&entry))?.mode & 0o300 != 0o300 { return Err("EACCES: permission denied".into()); }
        if is_dir && !recursive {
            if !directory { return Err("EISDIR: illegal operation on a directory".into()); }
            if !self.list_dir(&entry)?.is_empty() { return Err("ENOTEMPTY: directory not empty".into()); }
        }
        let (Some(lower), Some(upper)) = (self.lower.memory_backend(), self.upper.memory_backend()) else {
            return Err("ENOTSUP: overlay layers do not support conditional removal".into());
        };
        let mut whiteouts = self.whiteouts.write().map_err(|_| "EIO: input/output error")?;
        if whiteouts.len() != whiteout_count { return Err("EBUSY: overlay changed during removal".into()); }
        upper.remove_overlay_entry(lower, versions, &entry, directory, recursive)?;
        if is_dir { self.forget_directory(&entry); }
        whiteouts.insert(entry);
        Ok(())
    }
}

impl SafeBashFs for OverlayVfs {
    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let norm = self.access_path(path, true)?;
        if self.upper.lstat(&norm).is_ok() {
            return self.upper.read_file(&norm);
        }
        if self.is_deleted(&norm) {
            return Err(format!("ENOENT: no such file or directory, open '{norm}'"));
        }
        self.lower.read_file(&norm)
    }

    fn create_file(&self, path: &str, data: &[u8], mode: u32) -> Result<(), String> {
        let (Some(lower), Some(upper)) = (self.lower.memory_backend(), self.upper.memory_backend()) else {
            return Err("ENOTSUP: overlay layers do not support exclusive file creation".into());
        };
        if mode > 0o7777 { return Err("EINVAL: invalid argument".into()); }
        let whiteout_count = self.whiteouts.read().map_err(|_| "EIO: input/output error")?.len();
        let versions = (lower.generation(), upper.generation());
        if self.access_path(path, false)? != path { return Err("EAGAIN: resolved entry changed".into()); }
        match self.lstat(path) {
            Ok(_) => return Err("EEXIST: file already exists".into()),
            Err(e) if e.starts_with("ENOENT:") => {}
            Err(e) => return Err(e),
        }
        let mut parent = crate::vfs::dirname_posix_path(path);
        if self.stat(&parent)?.mode & 0o300 != 0o300 { return Err("EACCES: permission denied".into()); }
        let mut parents = Vec::new();
        while !upper.exists(&parent) {
            parents.push((parent.clone(), self.stat(&parent)?.mode));
            parent = crate::vfs::dirname_posix_path(&parent);
        }
        let whiteouts = self.whiteouts.read().map_err(|_| "EIO: input/output error")?;
        if whiteouts.len() != whiteout_count { return Err("EBUSY: overlay changed during creation".into()); }
        self.copy_up_directories(&crate::vfs::dirname_posix_path(path), || upper.create_overlay_file(lower, versions, path, data, mode, parents))
    }

    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        self.copy_up_directories(&crate::vfs::dirname_posix_path(&norm), || self.upper.write_file(&norm, data))
    }

    fn rename(&self, source: &str, destination: &str, no_replace: bool) -> Result<(), String> {
        let entry = |path| super::path::rename_entry(path, 40, |parent| {
            let stat = self.lstat(parent)?;
            match stat.kind {
                VfsEntryKind::Directory if stat.mode & 0o100 == 0 => Err("EACCES: permission denied".into()),
                VfsEntryKind::Directory => Ok(None),
                VfsEntryKind::Symlink => self.readlink(parent).map(Some),
                VfsEntryKind::File => Err("ENOTDIR: not a directory".into()),
            }
        });
        let from = entry(source)?;
        let original = self.lstat(&from)?;
        let to = entry(destination)?;
        let target = match self.lstat(&to) {
            Ok(st) => Some(st),
            Err(e) if e.starts_with("ENOENT:") => None,
            Err(e) => return Err(e),
        };
        if from == "/" || to == "/" || original.mode & 0o170000 == 0o020000
            || target.as_ref().is_some_and(|t| t.mode & 0o170000 == 0o020000)
        { return Err("EBUSY: resource busy or locked".into()); }
        if (source.ends_with('/') || destination.ends_with('/')) && original.kind != VfsEntryKind::Directory {
            return Err("ENOTDIR: not a directory".into());
        }
        if no_replace && target.is_some() { return Err("EEXIST: file already exists".into()); }
        if from == to || target.as_ref().is_some_and(|t| original.identity.is_some() && t.identity == original.identity) {
            return Ok(());
        }
        if original.kind == VfsEntryKind::Directory && crate::vfs::is_path_within(&from, &to) {
            return Err("EINVAL: invalid argument".into());
        }
        for p in [&from, &to] {
            if self.stat(&crate::vfs::dirname_posix_path(p))?.mode & 0o300 != 0o300 {
                return Err("EACCES: permission denied".into());
            }
        }
        if let Some(target) = target {
            match (original.kind, target.kind) {
                (VfsEntryKind::Directory, VfsEntryKind::Directory) => {
                    if !self.list_dir(&to)?.is_empty() { return Err("ENOTEMPTY: directory not empty".into()); }
                }
                (VfsEntryKind::Directory, _) => return Err("ENOTDIR: not a directory".into()),
                (_, VfsEntryKind::Directory) => return Err("EISDIR: illegal operation on a directory".into()),
                _ => {}
            }
        }

        // Bring only the visible source subtree into the writable layer. A
        // lower file must remain readable through the original path until commit.
        let mut pending = vec![from.clone()];
        while let Some(path) = pending.pop() {
            let stat = self.lstat(&path)?;
            if self.upper.lstat(&path).is_err() {
                match stat.kind {
                    VfsEntryKind::File => self.upper.write_file(&path, &self.lower.read_file(&path)?)?,
                    VfsEntryKind::Directory => self.upper.mkdir_all(&path)?,
                    VfsEntryKind::Symlink => self.upper.symlink(&self.lower.readlink(&path)?, &path)?,
                }
                if stat.kind != VfsEntryKind::Symlink {
                    self.upper.chmod(&path, stat.mode)?;
                    self.upper.set_mtime(&path, stat.mtime_ms)?;
                }
            }
            if stat.kind == VfsEntryKind::Directory {
                for child in self.list_dir(&path)? {
                    pending.push(format!("{path}/{child}"));
                }
            }
        }
        let parent = crate::vfs::dirname_posix_path(&to);
        self.copy_up_directories(&parent, || self.upper.mkdir_all(&parent))?;
        let mut whiteouts = self.whiteouts.write().map_err(|_| "EIO: input/output error")?;
        self.upper.rename(&from, &to, no_replace)?;
        if original.kind == VfsEntryKind::Directory { self.forget_directory(&from); self.forget_directory(&to); }
        whiteouts.insert(from);
        whiteouts.insert(to);
        Ok(())
    }

    fn remove_one(&self, path: &str, directory: bool) -> Result<(), String> {
        self.remove_entry(path, directory, false)
    }

    fn remove_path(&self, path: &str) -> Result<(), String> {
        self.remove_entry(path, false, true)
    }

    fn mkdir(&self, path: &str, recursive: bool, mode: u32) -> Result<(), (String, String)> {
        super::mkdir::mkdir(path, recursive, mode, super::mkdir::Namespace::Overlay, |p| (None, self, p.to_owned()))
    }

    fn mkdir_one(&self, path: &str, mode: u32) -> Result<(), String> {
        let path = self.access_path(path, false)?;
        if self.lstat(&path).is_ok() { return Err("EEXIST: file already exists".into()); }
        let mut parent = crate::vfs::dirname_posix_path(&path);
        let st = self.stat(&parent)?;
        if st.mode & 0o300 != 0o300 { return Err("EACCES: permission denied".into()); }
        let mut missing = Vec::new();
        while !self.upper.exists(&parent) {
            let mode = self.stat(&parent)?.mode;
            missing.push((parent.clone(), mode));
            parent = crate::vfs::dirname_posix_path(&parent);
        }
        for (dir, mode) in missing.into_iter().rev() { self.copy_up_directories(&dir, || self.upper.mkdir_one(&dir, mode & 0o7777))?; }
        self.upper.mkdir_one(&path, mode)
    }

    fn mkdir_all(&self, path: &str) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        self.copy_up_directories(&norm, || self.upper.mkdir_all(&norm))
    }

    fn exists(&self, path: &str) -> bool {
        self.stat(path).is_ok()
    }

    fn is_dir(&self, path: &str) -> bool {
        let norm = normalize_posix_path(path);
        if self.upper.lstat(&norm).is_ok() {
            return self.upper.is_dir(&norm);
        }
        if self.is_deleted(&norm) {
            return false;
        }
        self.lower.is_dir(&norm)
    }

    fn list_dir(&self, path: &str) -> Result<Vec<String>, String> {
        let norm = self.access_path(path, true)?;
        if !self.is_dir(&norm) {
            return Err(format!("ENOENT: no such file or directory, scandir '{norm}'"));
        }
        let mut names = BTreeSet::new();
        if !self.is_deleted(&norm) && self.lower.is_dir(&norm) {
            for name in self.lower.list_dir(&norm)? {
                let child = if norm == "/" {
                    format!("/{name}")
                } else {
                    format!("{norm}/{name}")
                };
                if !self.is_deleted(&child) {
                    names.insert(name);
                }
            }
        }
        if self.upper.is_dir(&norm) {
            for name in self.upper.list_dir(&norm)? {
                names.insert(name);
            }
        }
        Ok(names.into_iter().collect())
    }

    fn directory_entries(&self, path: &str, limit: usize) -> Result<Vec<(String, u32)>, String> {
        let mut entries = BTreeMap::new();
        if self.upper.is_dir(path) { entries.extend(self.upper.directory_entries(path, limit)?); }
        if !self.is_deleted(path) && self.lower.is_dir(path) {
            for (name, mode) in self.lower.directory_entries(path, limit)? {
                if !entries.contains_key(&name) && entries.len() == limit { return Err("EFBIG: directory entry limit exceeded".into()); }
                entries.entry(name).or_insert(mode);
            }
        }
        entries.retain(|name, _| {
            let p = format!("{}/{name}", path.trim_end_matches('/'));
            !self.is_deleted(&p) || self.upper.lstat(&p).is_ok()
        });
        if !entries.is_empty() && self.stat(path)?.mode & 0o100 == 0 {
            let name = entries.keys().min_by(|a,b| a.encode_utf16().cmp(b.encode_utf16())).unwrap();
            return Err(format!("EACCES: permission denied, lstat '{}/{name}'", path.trim_end_matches('/')));
        }
        Ok(entries.into_iter().collect())
    }

    fn symlink(&self, target: &str, path: &str) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        self.copy_up_directories(&crate::vfs::dirname_posix_path(&norm), || self.upper.symlink(target, &norm))
    }

    fn readlink(&self, path: &str) -> Result<String, String> {
        let norm = normalize_posix_path(path);
        if self.upper.lstat(&norm).is_ok() {
            return self.upper.readlink(&norm);
        }
        if self.is_deleted(&norm) {
            return Err(format!("ENOENT: no such file or directory, readlink '{norm}'"));
        }
        self.lower.readlink(&norm)
    }

    fn access_path(&self, path: &str, follow_final: bool) -> Result<String, String> {
        super::path::walk_path(path, follow_final, super::path::WalkPurpose::OverlayAccess, |p| {
            let layer = if self.upper.lstat(p).is_ok() || self.is_deleted(p) { &self.upper } else { &self.lower };
            (None, layer.as_ref(), p.to_owned())
        })
    }

    fn stat(&self, path: &str) -> Result<FileStat, String> { self.metadata(path, true) }

    fn lstat(&self, path: &str) -> Result<FileStat, String> { self.metadata(path, false) }

    fn chmod(&self, path: &str, mode: u32) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        if !self.upper.lstat(&norm).is_ok() {
            if self.is_deleted(&norm) || !self.lower.exists(&norm) {
                return Err(format!("ENOENT: no such file or directory, chmod '{norm}'"));
            }
            if self.lower.is_dir(&norm) {
                self.copy_up_directories(&norm, || self.upper.mkdir_all(&norm))?;
            } else {
                let bytes = self.lower.read_file(&norm)?;
                self.upper.write_file(&norm, &bytes)?;
            }
        }
        self.upper.chmod(&norm, mode)
    }

    fn set_mtime(&self, path: &str, mtime_ms: u64) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        if !self.upper.lstat(&norm).is_ok() {
            if self.is_deleted(&norm) || !self.lower.exists(&norm) {
                return Err(format!("ENOENT: no such file or directory, utime '{norm}'"));
            }
            if self.lower.is_dir(&norm) {
                self.copy_up_directories(&norm, || self.upper.mkdir_all(&norm))?;
            } else {
                let bytes = self.lower.read_file(&norm)?;
                self.upper.write_file(&norm, &bytes)?;
            }
        }
        self.upper.set_mtime(&norm, mtime_ms)
    }

    fn generation(&self) -> u64 {
        self.lower
            .generation()
            .wrapping_mul(31)
            .wrapping_add(self.upper.generation())
    }

    fn fs_id(&self) -> u64 {
        self.upper.fs_id()
    }

    fn export_entries(&self) -> Result<Vec<VfsFileEntry>, String> {
        let mut merged = BTreeMap::new();
        for entry in self.lower.export_entries()? {
            if !self.is_deleted(&entry.path) {
                merged.insert(entry.path.clone(), entry);
            }
        }
        for entry in self.upper.export_entries()? {
            merged.insert(entry.path.clone(), entry);
        }
        Ok(merged.into_values().collect())
    }

    fn replace_entries(&self, entries: &[VfsFileEntry]) -> Result<(), String> {
        if let Ok(mut guard) = self.whiteouts.write() {
            for lower_entry in self.lower.export_entries().unwrap_or_default() {
                guard.insert(lower_entry.path);
            }
        }
        self.upper.replace_entries(entries)?;
        self.directories.lock().unwrap().clear();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::MemoryVfs;

    #[test]
    fn direct_reads_through_a_confirmed_lower_link_use_the_visible_file_and_directory() {
        let lower = Arc::new(MemoryVfs::new());
        lower.write_file("/dir/file", b"lower").unwrap();
        lower.symlink("dir", "/alias").unwrap();
        let fs = OverlayVfs::new(lower, Arc::new(MemoryVfs::new()));
        fs.write_file("/dir/file", b"upper").unwrap();
        fs.write_file("/dir/new", b"new").unwrap();
        assert_eq!(fs.read_file("/alias/file").unwrap(), b"upper");
        assert_eq!(fs.list_dir("/alias").unwrap(), ["file", "new"]);
    }

    #[test]
    fn directory_scope_preserves_owned_copy_up_but_not_external_layer_replacements() {
        let lower = Arc::new(MemoryVfs::new());
        lower.mkdir_all("/a/b").unwrap();
        let upper = Arc::new(MemoryVfs::new());
        let fs = OverlayVfs::new(lower.clone(), upper.clone());
        let a = fs.stat("/a").unwrap().identity;
        let b = fs.stat("/a/b").unwrap().identity;
        fs.create_file("/a/b/new", b"data", 0o600).unwrap();
        assert_eq!(fs.stat("/a").unwrap().identity, a);
        assert_eq!(fs.stat("/a/b").unwrap().identity, b);
        upper.remove_path("/a").unwrap();
        upper.mkdir_all("/a/b").unwrap();
        let replacement = fs.stat("/a").unwrap().identity;
        assert_ne!(replacement, a);
        assert_ne!(fs.stat("/a/b").unwrap().identity, b);
        lower.remove_path("/a").unwrap();
        assert_ne!(fs.stat("/a").unwrap().identity, replacement);
    }

    #[test]
    fn exclusive_copy_creation_keeps_lower_entries_and_copies_parent_modes() {
        let lower = Arc::new(MemoryVfs::new());
        lower.write_file("/private/old", b"lower").unwrap();
        lower.chmod("/private", 0o710).unwrap();
        let upper = Arc::new(MemoryVfs::new());
        let overlay = OverlayVfs::new(lower.clone(), upper.clone());
        assert!(overlay.create_file("/private/old", b"no", 0o600).unwrap_err().starts_with("EEXIST"));
        overlay.create_file("/private/new", b"new", 0o640).unwrap();
        assert_eq!(upper.stat("/private").unwrap().mode & 0o777, 0o710);
        assert_eq!(upper.stat("/private/new").unwrap().mode & 0o777, 0o640);
        assert_eq!(overlay.read_file("/private/old").unwrap(), b"lower");
        assert!(!lower.exists("/private/new"));
    }

    #[test]
    fn overlay_vfs_isolates_upper_writes_and_tracks_whiteouts() {
        let lower = Arc::new(MemoryVfs::new());
        lower.mkdir_all("/app").unwrap();
        lower.write_file("/app/base.txt", b"original").unwrap();
        lower.write_file("/app/keep.txt", b"unchanged").unwrap();

        let upper = Arc::new(MemoryVfs::new());
        let overlay = OverlayVfs::new(lower.clone(), upper.clone());

        overlay.write_file("/app/base.txt", b"modified").unwrap();
        assert_eq!(overlay.read_file("/app/base.txt").unwrap(), b"modified");
        assert_eq!(lower.read_file("/app/base.txt").unwrap(), b"original");

        overlay.remove_path("/app/keep.txt").unwrap();
        assert!(!overlay.exists("/app/keep.txt"));
        assert!(lower.exists("/app/keep.txt"));
    }

    #[test]
    fn mkdir_copies_parent_modes_without_exposing_private_ancestors() {
        let lower = Arc::new(MemoryVfs::new());
        lower.mkdir_all("/private/shared").unwrap();
        lower.chmod("/private", 0o700).unwrap();
        lower.chmod("/private/shared", 0o750).unwrap();
        let overlay = OverlayVfs::new(lower.clone(), Arc::new(MemoryVfs::new()));
        overlay.mkdir_one("/private/shared/new", 0o711).unwrap();
        assert_eq!(overlay.stat("/private").unwrap().mode & 0o777, 0o700);
        assert_eq!(overlay.stat("/private/shared").unwrap().mode & 0o777, 0o750);
        assert_eq!(overlay.stat("/private/shared/new").unwrap().mode & 0o777, 0o711);
        assert!(!lower.exists("/private/shared/new"));
    }

    #[test]
    fn removing_one_overlay_entry_respects_children_in_both_layers() {
        let lower = Arc::new(MemoryVfs::new());
        lower.write_file("/dir/lower", b"keep").unwrap();
        let upper = Arc::new(MemoryVfs::new());
        upper.write_file("/dir/upper", b"keep").unwrap();
        let fs = OverlayVfs::new(lower.clone(), upper.clone());
        assert!(fs.remove_one("/dir", true).unwrap_err().starts_with("ENOTEMPTY"));
        fs.remove_one("/dir/upper", false).unwrap();
        assert!(fs.remove_one("/dir", true).unwrap_err().starts_with("ENOTEMPTY"));
        fs.remove_one("/dir/lower", false).unwrap();
        fs.remove_one("/dir", true).unwrap();
        assert!(!fs.exists("/dir"));
        assert!(!upper.exists("/dir"));
        assert_eq!(lower.read_file("/dir/lower").unwrap(), b"keep");
    }

    #[test]
    fn listing_an_upper_directory_cannot_disclose_unreadable_lower_names() {
        let lower = Arc::new(MemoryVfs::new());
        lower.write_file("/private/secret", b"data").unwrap();
        lower.chmod("/private", 0o100).unwrap();
        let upper = Arc::new(MemoryVfs::new());
        upper.mkdir_all("/private").unwrap();
        let overlay = OverlayVfs::new(lower, upper);
        assert!(overlay.list_dir("/private").unwrap_err().starts_with("EACCES"));
    }

    #[test]
    fn overlay_vfs_recreating_deleted_lower_file_clears_whiteout() {
        let lower = Arc::new(MemoryVfs::new());
        lower.mkdir_all("/cfg").unwrap();
        lower.write_file("/cfg/item.conf", b"v1").unwrap();

        let upper = Arc::new(MemoryVfs::new());
        let overlay = OverlayVfs::new(lower.clone(), upper.clone());

        overlay.remove_path("/cfg/item.conf").unwrap();
        assert!(!overlay.exists("/cfg/item.conf"));

        overlay.write_file("/cfg/item.conf", b"v2").unwrap();
        assert!(overlay.exists("/cfg/item.conf"));
        assert_eq!(overlay.read_file("/cfg/item.conf").unwrap(), b"v2");
        assert_eq!(lower.read_file("/cfg/item.conf").unwrap(), b"v1");
    }

    #[test]
    fn overlay_vfs_merges_directory_listings_and_hides_whiteouts() {
        let lower = Arc::new(MemoryVfs::new());
        lower.mkdir_all("/dir").unwrap();
        lower.write_file("/dir/a.txt", b"a").unwrap();
        lower.write_file("/dir/b.txt", b"b").unwrap();

        let upper = Arc::new(MemoryVfs::new());
        let overlay = OverlayVfs::new(lower, upper);
        overlay.write_file("/dir/c.txt", b"c").unwrap();
        overlay.remove_path("/dir/a.txt").unwrap();

        let mut entries = overlay.list_dir("/dir").unwrap();
        entries.sort();
        assert_eq!(entries, vec!["b.txt".to_string(), "c.txt".to_string()]);
    }
}
