mod chmod;
pub use chmod::OverlayChmodReceipt;
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

#[derive(Clone, Copy)]
pub(super) enum FileWrite<'a> {
    Create(u32), Install { mode: u32, times: (Option<f64>, Option<f64>), version: u64 }, Replace, Append,
    Edit { original: &'a FileStat, before: &'a [u8], in_place: bool },
    Publish { inputs: &'a [String], version: u64, stamp: u64 },
}

enum MetadataChange {
    Mode(u32),
    Times(Option<f64>, Option<f64>),
}

#[derive(Clone)]
pub struct OverlayVfs {
    receipt_owner: u64,
    lower: Arc<dyn SafeBashFs>,
    upper: Arc<dyn SafeBashFs>,
    whiteouts: Arc<RwLock<BTreeSet<String>>>,
    directories: Arc<Mutex<BTreeMap<String, DirectoryObservation>>>,
}

struct OverlayDirectoryRead {
    handle: Box<dyn super::FileReadHandle>,
    identity: Option<EntryIdentity>,
}

impl super::FileReadHandle for OverlayDirectoryRead {
    fn stat(&self) -> Result<FileStat, String> {
        let mut st = self.handle.stat()?;
        st.identity.clone_from(&self.identity);
        Ok(st)
    }
    fn read(&self, offset: u64, maximum: usize) -> Result<Vec<u8>, String> {
        self.handle.read(offset, maximum)
    }
}

impl OverlayVfs {
    fn read_source(&self, path: &str) -> Result<(&dyn SafeBashFs, String), String> {
        let norm = self.access_path(path, true)?;
        let (fs, st) = if let Ok(st) = self.upper.lstat(&norm) {
            (&self.upper, st)
        } else {
            if self.is_deleted(&norm) { return Err(format!("ENOENT: no such file or directory, overlay '{norm}'")); }
            (&self.lower, self.lower.lstat(&norm)?)
        };
        if st.kind == VfsEntryKind::Directory { return Err(format!("EISDIR: illegal operation on a directory, overlay '{norm}'")); }
        if st.mode & 0o400 == 0 { return Err(format!("EACCES: permission denied, overlay '{norm}'")); }
        Ok((fs.as_ref(), norm))
    }

    pub fn new(lower: Arc<dyn SafeBashFs>, upper: Arc<dyn SafeBashFs>) -> Self {
        Self {
            receipt_owner: chmod::new_owner(),
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

    fn check_file_copy_up(&self, path: &str, st: &FileStat) -> Result<(), String> {
        if st.nlink.map_or_else(|| self.lower.supports_hard_links(path), |n| n > 1) {
            return Err(format!("ENOTSUP: copy-up cannot preserve hardlink identity, overlay '{path}'"));
        }
        if st.mode & 0o400 == 0 { return Err(format!("EACCES: permission denied, overlay '{path}'")); }
        Ok(())
    }

    fn change_metadata(&self, path: &str, change: MetadataChange) -> Result<(), String> {
        let whiteout_count = self.whiteouts.read().map_err(|_| "EIO: input/output error")?.len();
        let versions = (self.lower.generation(), self.upper.generation());
        let norm = self.access_path(path, true)?;
        if self.upper.lstat(&norm).is_ok() {
            return match change {
                MetadataChange::Mode(mode) => self.upper.chmod(&norm, mode),
                MetadataChange::Times(atime, mtime) => self.upper.set_times(&norm, atime, mtime),
            };
        }
        let mut st = self.stat(&norm)?;
        let dir = st.kind == VfsEntryKind::Directory;
        let parent = crate::vfs::dirname_posix_path(&norm);
        let mut ancestor = parent.clone();
        loop {
            if self.stat(&ancestor)?.mode & 0o300 != 0o300 {
                return Err(format!("EACCES: permission denied, overlay '{ancestor}'"));
            }
            if ancestor == "/" || self.upper.lstat(&ancestor).is_ok() { break; }
            ancestor = crate::vfs::dirname_posix_path(&ancestor);
        }
        if !dir { self.check_file_copy_up(&norm, &st)?; }
        match change {
            MetadataChange::Mode(mode) => st.mode = (st.mode & !0o7777) | (mode & 0o7777),
            MetadataChange::Times(atime, mtime) => {
                st.atime_ms = atime.unwrap_or(st.atime_ms);
                st.mtime_ms = mtime.unwrap_or(st.mtime_ms);
            }
        }
        if let (Some(lower), Some(upper)) = (self.lower.memory_backend(), self.upper.memory_backend()) {
            let whiteouts = self.whiteouts.read().map_err(|_| "EIO: input/output error")?;
            if whiteouts.len() != whiteout_count { return Err("EBUSY: overlay changed during metadata copy-up".into()); }
            return self.copy_up_directories(if dir { &norm } else { &parent }, || {
                upper.copy_up_metadata(lower, versions, &norm, &st)
            });
        }
        if dir {
            self.copy_up_directories(&norm, || self.upper.mkdir_all(&norm))?;
        } else {
            let bytes = self.lower.read_file(&norm)?;
            self.copy_up_directories(&parent, || self.upper.write_file(&norm, &bytes))?;
        }
        self.upper.chmod(&norm, st.mode)?;
        self.upper.set_times(&norm, Some(st.atime_ms), Some(st.mtime_ms))
    }

    fn write_entry(&self, path: &str, data: &[u8], operation: FileWrite<'_>) -> Result<(), String> {
        let exclusive_mode = match operation { FileWrite::Create(mode) => Some(mode), _ => None };
        let memory_layers = self.lower.memory_backend().zip(self.upper.memory_backend());
        if exclusive_mode.is_some() && memory_layers.is_none() {
            return Err("ENOTSUP: overlay layers do not support exclusive file creation".into());
        }
        if let FileWrite::Edit { in_place, .. } = operation && memory_layers.is_none() {
            return Err(if in_place { "VFS atomic in-place publication not supported" }
                else { "VFS atomic replacement publication not supported" }.into());
        }
        let versions = (self.lower.generation(), self.upper.generation());
        let whiteout_count = self.whiteouts.read().map_err(|_| "EIO: input/output error")?.len();
        if let FileWrite::Publish { version, .. } | FileWrite::Install { version, .. } = operation {
            if memory_layers.is_none() {
                return Err("UNSUPPORTED_CAPABILITY: VFS requires conditional file publication".into());
            }
            if self.generation() != version {
                return Err("EAGAIN: filesystem changed before publication".into());
            }
        }
        let target = self.access_path(path, matches!(operation, FileWrite::Replace | FileWrite::Append))?;
        if exclusive_mode.is_some() && target != path { return Err("EAGAIN: resolved entry changed".into()); }
        let existing = match self.lstat(&target) {
            Ok(_) if exclusive_mode.is_some() => return Err("EEXIST: file already exists".into()),
            Ok(st) => Some(st),
            Err(e) if e.starts_with("ENOENT:") => None,
            Err(e) => return Err(e),
        };
        if let FileWrite::Edit { in_place, .. } = operation {
            if existing.is_none() { return Err(format!("EAGAIN: resource temporarily unavailable, fileStaging '{path}'")); }
            if !in_place && self.stat(&crate::vfs::dirname_posix_path(&target))?.mode & 0o300 != 0o300 {
                return Err("EACCES: permission denied".into());
            }
        }
        if let FileWrite::Publish { inputs, .. } = operation {
            if existing
                .as_ref()
                .is_some_and(|st| st.kind != VfsEntryKind::File || st.mode & 0o170000 != 0o100000)
            {
                return Err("INVALID_VALUE: Output must be a regular VFS file or absent".into());
            }
            for input in inputs {
                let entry = self.access_path(input, true)?;
                let identity = match self.lstat(&entry) {
                    Ok(st) => st.identity,
                    Err(e) if e.starts_with("ENOENT:") => None,
                    Err(e) => return Err(e),
                };
                if entry == target
                    || identity.is_some()
                        && existing.as_ref().and_then(|s| s.identity.as_ref()) == identity.as_ref()
                {
                    return Err(
                        "INVALID_VALUE: Input and output VFS identities must be distinct".into(),
                    );
                }
            }
        }
        let install_mode = match operation { FileWrite::Install { mode, .. } => Some(mode), _ => None };
        if install_mode.is_some() && self.stat(&crate::vfs::dirname_posix_path(&target))?.mode & 0o300 != 0o300 {
            return Err("EACCES: permission denied".into());
        }
        let upper_exists = self.upper.lstat(&target).is_ok();
        if let Some(st) = &existing {
            if st.kind != VfsEntryKind::File || st.mode & 0o170000 != 0o100000 { return Err("EISDIR: illegal operation on a directory".into()); }
            if install_mode.is_none() && st.mode & 0o200 == 0 { return Err("EACCES: permission denied".into()); }
            if install_mode.is_none() && !upper_exists { self.check_file_copy_up(&target, st)?; }
        }
        let Some((lower, upper)) = memory_layers else {
            if matches!(operation, FileWrite::Append) && existing.is_some() {
                let mut contents = self.read_file(&target)?;
                contents.extend_from_slice(data);
                return self.upper.write_file(&target, &contents);
            }
            return self.upper.write_file(&target, data);
        };
        let parent = crate::vfs::dirname_posix_path(&target);
        let mut parents = Vec::new();
        if !upper_exists {
            let mut dir = parent.clone();
            loop {
                let st = self.stat(&dir)?;
                if st.mode & 0o300 != 0o300 { return Err(format!("EACCES: permission denied, overlay '{dir}'")); }
                if upper.exists(&dir) { break; }
                parents.push((dir.clone(), st));
                dir = crate::vfs::dirname_posix_path(&dir);
            }
        }
        let whiteouts = self.whiteouts.read().map_err(|_| "EIO: input/output error")?;
        if whiteouts.len() != whiteout_count { return Err("EBUSY: overlay changed during write".into()); }
        let mode = install_mode.or(exclusive_mode).unwrap_or_else(|| existing.as_ref().map_or(0o644, |st| st.mode & 0o7777));
        let atime = if install_mode.is_some() || matches!(operation, FileWrite::Edit { in_place: false, .. }) { None } else { existing.map(|st| st.atime_ms) };
        self.copy_up_directories(&parent, || upper.write_overlay_file(lower, versions, &target, data, (mode, atime), parents, operation))
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
        upper.remove_overlay_entry(lower, versions, &entry, directory, recursive, None)?;
        if is_dir { self.forget_directory(&entry); }
        whiteouts.insert(entry);
        Ok(())
    }
}

impl SafeBashFs for OverlayVfs {
    fn overlay_backend(&self) -> Option<&Self> { Some(self) }
    fn start_command_stream(&self, path: &str, entry: &str, append: bool, mode: u32) -> Result<super::ChunkWriter<'_>, String> {
        match self.stat(entry) {
            Ok(st) if st.kind == VfsEntryKind::Directory => return Err(format!("EISDIR: illegal operation on a directory, overlay '{entry}'")),
            Err(e) if e.starts_with("ENOENT:") => {
                if self.stat(&super::dirname_posix_path(entry))?.mode & 0o300 != 0o300 { return Err("EACCES: permission denied".into()); }
            }
            Err(e) => return Err(e),
            _ => {}
        }
        let stage = self.upper.scratch_file("/")?;
        let path = path.to_owned();
        Ok(Box::new(move |chunk| match chunk {
            Some(bytes) => stage.write_at(None, bytes),
            None => self.write_command_path(&path, &stage.read_at(0, usize::MAX)?, append, mode).map_err(|e| {
                if e.contains(", ") { e } else { format!("{e}, overlay '{path}'") }
            }),
        }))
    }

    fn open_redirect_file(&self, path: &str, access: super::RedirectAccess, mode: u32) -> Result<Option<std::rc::Rc<dyn super::OpenRedirectFile>>, String> {
        use super::RedirectAccess;
        match access {
            RedirectAccess::Read => {
                let (layer, entry) = self.read_source(path)?;
                layer.open_redirect_file(&entry, access, mode)
            }
            RedirectAccess::ReadWrite | RedirectAccess::Write => Err(format!("ENOTSUP: operation not supported, open '{path}'")),
            RedirectAccess::Exclusive => { self.create_file(path, &[], mode)?; Ok(None) }
            _ => Ok(None),
        }
    }

    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let (fs, path) = self.read_source(path)?;
        fs.read_file(&path)
    }

    fn open_read_file(&self, path: &str, allow_directory: bool) -> Result<Box<dyn super::FileReadHandle>, String> {
        let versions = (self.upper.generation(), self.lower.generation());
        let entry = self.access_path(path, true)?;
        let (layer, st) = match self.upper.lstat(&entry) {
            Ok(st) => (&self.upper, st),
            Err(e) if e.starts_with("ENOENT:") && !self.is_deleted(&entry) =>
                (&self.lower, self.lower.lstat(&entry)?),
            Err(e) => return Err(e),
        };
        if st.kind == VfsEntryKind::Directory && !allow_directory {
            return Err(format!("EISDIR: illegal operation on a directory, overlay '{entry}'"));
        }
        if st.mode & 0o400 == 0 {
            return Err(format!("EACCES: permission denied, overlay '{entry}'"));
        }
        let handle = layer.open_read_file(&entry, allow_directory)?;
        if st.identity.is_none() || handle.stat()?.identity != st.identity {
            return Err("ENOTSUP: overlay reads require stable backend identity".into());
        }
        let opened: Box<dyn super::FileReadHandle> = if st.kind == VfsEntryKind::Directory {
            Box::new(OverlayDirectoryRead { handle, identity: self.stat(&entry)?.identity })
        } else { handle };
        if versions != (self.upper.generation(), self.lower.generation()) {
            return Err("EAGAIN: overlay changed during open".into());
        }
        Ok(opened)
    }

    fn open_chunks(&self, path: &str) -> Result<super::ChunkReader<'_>, String> {
        let (fs, path) = self.read_source(path)?;
        fs.open_chunks(&path)
    }

    fn commit_file_edit(&self, path: &str, original: &FileStat, before: &[u8], after: &[u8], in_place: bool) -> Result<(), String> {
        self.write_entry(path, after, FileWrite::Edit { original, before, in_place })
    }

    fn create_file(&self, path: &str, data: &[u8], mode: u32) -> Result<(), String> {
        if mode > 0o7777 { return Err("EINVAL: invalid argument".into()); }
        self.write_entry(path, data, FileWrite::Create(mode))
    }

    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        self.write_entry(path, data, FileWrite::Replace)
    }

    fn append_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        self.write_entry(path, data, FileWrite::Append)
    }

    fn replace_file_entry_with_metadata(&self, path: &str, data: &[u8], mode: u32, times: (Option<f64>, Option<f64>), version: u64) -> Result<(), String> {
        if mode > 0o7777 { return Err("EINVAL: invalid argument".into()); }
        if [times.0, times.1].into_iter().flatten().any(|t| !t.is_finite()) { return Err("EINVAL: invalid file timestamp".into()); }
        self.write_entry(path, data, FileWrite::Install { mode, times, version })
    }

    fn publish_file(
        &self,
        path: &str,
        data: &[u8],
        inputs: &[String],
        version: u64,
    ) -> Result<u64, String> {
        let stamp = super::memory::NEXT_PUBLICATION.fetch_add(1, Ordering::Relaxed);
        self.write_entry(
            path,
            data,
            FileWrite::Publish {
                inputs,
                version,
                stamp,
            },
        )?;
        Ok(stamp)
    }

    fn remove_published(&self, path: &str, publication: u64) -> Result<bool, String> {
        let (Some(lower), Some(upper)) = (self.lower.memory_backend(), self.upper.memory_backend())
        else {
            return Err("UNSUPPORTED_CAPABILITY: VFS requires conditional file removal".into());
        };
        let count = self
            .whiteouts
            .read()
            .map_err(|_| "EIO: input/output error")?
            .len();
        let versions = (lower.generation(), upper.generation());
        let entry = self.access_path(path, false)?;
        if entry != normalize_posix_path(path) {
            return Ok(false);
        }
        let mut whiteouts = self
            .whiteouts
            .write()
            .map_err(|_| "EIO: input/output error")?;
        if count != whiteouts.len() {
            return Err("EBUSY: overlay changed during removal".into());
        }
        let removed =
            upper.remove_overlay_entry(lower, versions, &entry, false, false, Some(publication))?;
        if removed {
            whiteouts.insert(entry);
        }
        Ok(removed)
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
                    self.upper.set_times(&path, Some(stat.atime_ms), Some(stat.mtime_ms))?;
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
        }, |_| false)
    }

    fn stat(&self, path: &str) -> Result<FileStat, String> { self.metadata(path, true) }

    fn lstat(&self, path: &str) -> Result<FileStat, String> { self.metadata(path, false) }

    fn chmod(&self, path: &str, mode: u32) -> Result<(), String> {
        self.change_metadata(path, MetadataChange::Mode(mode))
    }

    fn set_times(&self, path: &str, atime_ms: Option<f64>, mtime_ms: Option<f64>) -> Result<(), String> {
        if atime_ms.is_some_and(|t| !t.is_finite()) || mtime_ms.is_some_and(|t| !t.is_finite()) {
            return Err(format!("EINVAL: invalid argument, utimes '{path}'"));
        }
        self.change_metadata(path, MetadataChange::Times(atime_ms, mtime_ms))
    }

    fn generation(&self) -> u64 {
        self.lower
            .generation()
            .wrapping_mul(31)
            .wrapping_add(self.upper.generation())
            .wrapping_add(self.whiteouts.read().unwrap().len() as u64)
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
    fn conditional_publications_respect_the_merged_namespace_and_file_version() {
        let lower = Arc::new(MemoryVfs::new());
        lower.write_file("/docs/page", b"source").unwrap();
        lower.write_file("/docs/result", b"prior").unwrap();
        lower.symlink("/docs/page", "/docs/link").unwrap();
        lower.hard_link("/docs/page", "/docs/alias").unwrap();
        let upper = Arc::new(MemoryVfs::new());
        let overlay = OverlayVfs::new(lower.clone(), upper.clone());
        let publish =
            |name: &str, v| SafeBashFs::publish_file(&overlay, name, b"PDF", &["/docs/page".into()], v);
        let v = overlay.generation();
        assert!(
            publish("/docs/link", v)
                .unwrap_err()
                .contains("regular VFS file")
        );
        assert!(
            publish("/docs/alias", v)
                .unwrap_err()
                .contains("identities must be distinct")
        );
        assert!(!upper.exists("/docs"));
        overlay.remove_one("/docs/alias", false).unwrap();
        assert!(publish("/docs/new", v).unwrap_err().starts_with("EAGAIN:"));
        let stamp = publish("/docs/result", overlay.generation()).unwrap();
        assert_eq!(lower.read_file("/docs/result").unwrap(), b"prior");
        assert_eq!(overlay.read_file("/docs/result").unwrap(), b"PDF");
        overlay.write_file("/docs/result", b"newer").unwrap();
        assert!(!overlay.remove_published("/docs/result", stamp).unwrap());
        let stamp = publish("/docs/result", overlay.generation()).unwrap();
        assert!(overlay.remove_published("/docs/result", stamp).unwrap());
        assert!(!overlay.exists("/docs/result"));
        assert_eq!(lower.read_file("/docs/result").unwrap(), b"prior");
    }

    #[test]
    fn installing_an_entry_detaches_aliases_in_both_layers() {
        let lower = Arc::new(MemoryVfs::new());
        lower.write_file("/dir/archive", b"old").unwrap();
        lower.hard_link("/dir/archive", "/alias").unwrap();
        let upper = Arc::new(MemoryVfs::new());
        let fs = OverlayVfs::new(lower.clone(), upper.clone());
        fs.replace_file_entry_with_metadata("/dir/archive", b"first", 0o600, (Some(-500.), Some(1000.)), fs.generation()).unwrap();
        let first = fs.stat("/dir/archive").unwrap();
        assert_eq!((first.atime_ms, first.mtime_ms), (-500., 1000.));
        assert_eq!(fs.read_file("/alias").unwrap(), b"old");
        assert_eq!(lower.read_file("/dir/archive").unwrap(), b"old");
        let version = fs.generation();
        upper.hard_link("/dir/archive", "/second-alias").unwrap();
        assert!(fs.replace_file_entry_with_mode("/dir/archive", b"stale", 0o644, version).is_err());
        fs.replace_file_entry_with_metadata("/dir/archive", b"second", 0o640, (Some(1500.), Some(2500.)), fs.generation()).unwrap();
        let second = fs.stat("/dir/archive").unwrap();
        assert_eq!((second.atime_ms, second.mtime_ms), (1500., 2500.));
        assert_eq!(fs.stat("/second-alias").unwrap().mtime_ms, 1000.);
        assert_eq!(fs.read_file("/second-alias").unwrap(), b"first");
        assert_eq!(fs.read_file("/dir/archive").unwrap(), b"second");
        assert_eq!(fs.stat("/dir/archive").unwrap().mode & 0o7777, 0o640);
    }

    #[test]
    fn copying_up_from_a_mount_rejects_writes_that_would_split_hard_links() {
        let lower = Arc::new(MemoryVfs::new());
        lower.write_file("/f", b"original").unwrap();
        lower.hard_link("/f", "/alias").unwrap();
        let upper = Arc::new(MemoryVfs::new());
        let overlay = OverlayVfs::new(Arc::new(crate::vfs::MountVfs::new(lower)), upper.clone());
        for result in [overlay.write_file("/f", b"new"), overlay.append_file("/f", b"+"), overlay.chmod("/f", 0o600)] {
            assert_eq!(result.unwrap_err(), "ENOTSUP: copy-up cannot preserve hardlink identity, overlay '/f'");
        }
        assert!(!upper.exists("/f"));
        assert_eq!(overlay.stat("/f").unwrap().identity, overlay.stat("/alias").unwrap().identity);
    }

    #[test]
    fn timestamp_copy_up_preserves_parents_and_rejects_unsafe_copies() {
        let lower = Arc::new(MemoryVfs::new());
        let upper = Arc::new(MemoryVfs::new());
        lower.write_file("/dir/file", b"hello").unwrap();
        lower.write_file("/dir/private", b"secret").unwrap();
        lower.write_file("/dir/linked", b"alias").unwrap();
        lower.hard_link("/dir/linked", "/alias").unwrap();
        lower.chmod("/dir/private", 0o200).unwrap();
        lower.chmod("/dir", 0o555).unwrap();
        let fs = OverlayVfs::new(lower.clone(), upper.clone());
        let set = |p| fs.set_times(p, Some(-1.5), Some(123.75));
        lower.mkdir_all("/dir/child").unwrap();
        assert!(set("/dir/child").unwrap_err().starts_with("EACCES:"));
        assert!(!upper.exists("/dir/child"));
        assert_eq!(set("/dir/file").unwrap_err(), "EACCES: permission denied, overlay '/dir'");
        lower.chmod("/dir", 0o751).unwrap();
        assert!(set("/dir/private").unwrap_err().starts_with("EACCES:"));
        assert!(set("/dir/linked").unwrap_err().starts_with("ENOTSUP:"));
        assert!(!upper.exists("/dir/file") && !upper.exists("/dir/private") && !upper.exists("/dir/linked"));
        lower.set_times("/dir", Some(5.0), Some(7.0)).unwrap();
        let dir = fs.stat("/dir").unwrap();
        set("/dir/file").unwrap();
        let after = fs.stat("/dir").unwrap();
        assert_eq!((after.mode, after.identity, after.atime_ms), (dir.mode, dir.identity, 5.0));
        assert_eq!(fs.stat("/dir/file").unwrap().mtime_ms, 123.75);
        assert_ne!(lower.stat("/dir/file").unwrap().mtime_ms, 123.75);
    }

    #[test]
    fn chmod_copies_lower_metadata_and_leaves_unreadable_files_untouched() {
        let lower = Arc::new(MemoryVfs::new());
        let upper = Arc::new(MemoryVfs::new());
        lower.write_file("/private/f", b"x").unwrap();
        lower.chmod("/private", 0o700).unwrap();
        lower.set_times("/private/f", Some(123.0), Some(456.0)).unwrap();
        lower.chmod("/private/f", 0o200).unwrap();
        let fs = OverlayVfs::new(lower.clone(), upper.clone());
        assert!(fs.chmod("/private/f", 0o600).unwrap_err().starts_with("EACCES:"));
        assert!(!upper.exists("/private"));
        lower.chmod("/private/f", 0o400).unwrap();
        fs.chmod("/private/f", 0o600).unwrap();
        let st = fs.stat("/private/f").unwrap();
        assert_eq!((st.mode & 0o777, st.atime_ms, st.mtime_ms), (0o600, 123.0, 456.0));
        assert_eq!(fs.stat("/private").unwrap().mode & 0o777, 0o700);
        assert_eq!(lower.stat("/private/f").unwrap().mode & 0o777, 0o400);
    }

    #[test]
    fn copying_up_timestamps_updates_the_root_and_existing_parent_once() {
        let lower = Arc::new(MemoryVfs::new());
        let upper = Arc::new(MemoryVfs::new());
        lower.write_file("/pre/dir/file", b"x").unwrap();
        upper.mkdir_all("/pre").unwrap();
        let fs = OverlayVfs::new(lower, upper.clone());
        for path in ["/", "/pre"] { upper.set_times(path, None, Some(-1.0)).unwrap(); }
        fs.set_times("/pre/dir/file", Some(10.0), Some(20.0)).unwrap();
        for path in ["/", "/pre"] {
            assert!(fs.stat(path).unwrap().mtime_ms > 0.0, "{path}");
            upper.set_times(path, None, Some(-1.0)).unwrap();
        }
        fs.set_times("/pre/dir/file", None, Some(30.0)).unwrap();
        for path in ["/", "/pre"] { assert_eq!(fs.stat(path).unwrap().mtime_ms, -1.0, "{path}"); }
    }

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
    fn conditional_edits_copy_up_once_and_reject_changed_or_replaced_files() {
        let lower = Arc::new(MemoryVfs::new());
        let upper = Arc::new(MemoryVfs::new());
        lower.write_file("/d/f", b"base").unwrap();
        let fs = OverlayVfs::new(lower.clone(), upper.clone());
        lower.set_times("/d/f", Some(42.0), None).unwrap();
        let base = fs.stat("/d/f").unwrap();
        fs.commit_file_edit("/d/f", &base, b"base", b"copy", false).unwrap();
        assert_eq!(lower.read_file("/d/f").unwrap(), b"base");
        let copy = fs.stat("/d/f").unwrap();
        assert_ne!(base.identity, copy.identity);
        assert_ne!(base.atime_ms, copy.atime_ms);
        assert!(fs.commit_file_edit("/d/f", &base, b"base", b"stale", false).is_err());
        assert!(fs.commit_file_edit("/d/f", &copy, b"wrong", b"stale", true).is_err());
        let held = fs.open_read_file("/d/f", false).unwrap();
        fs.commit_file_edit("/d/f", &copy, b"copy", b"new", false).unwrap();
        assert_eq!(held.read(0, 16).unwrap(), b"copy");
        let edited = fs.stat("/d/f").unwrap();
        fs.commit_file_edit("/d/f", &edited, b"new", b"in place", true).unwrap();
        assert_eq!(fs.stat("/d/f").unwrap().identity, edited.identity);
        assert_eq!(fs.read_file("/d/f").unwrap(), b"in place");
    }

    #[test]
    fn writing_overlay_files_preserves_lower_modes_and_access_times() {
        let lower = Arc::new(MemoryVfs::new());
        let upper = Arc::new(MemoryVfs::new());
        lower.write_file("/private/old", b"old").unwrap();
        lower.chmod("/private", 0o710).unwrap();
        lower.set_times("/private", Some(10.0), None).unwrap();
        lower.chmod("/private/old", 0o600).unwrap();
        lower.set_times("/private/old", Some(20.0), None).unwrap();
        let fs = OverlayVfs::new(lower.clone(), upper.clone());
        fs.write_file("/private/new", b"new").unwrap();
        let parent = fs.stat("/private").unwrap();
        assert_eq!((parent.mode & 0o777, parent.atime_ms), (0o710, 10.0));
        upper.set_times("/", None, Some(-1.0)).unwrap();
        fs.write_file("/private/old", b"replacement").unwrap();
        let file = fs.stat("/private/old").unwrap();
        assert_eq!((file.mode & 0o777, file.atime_ms), (0o600, 20.0));
        assert!(upper.stat("/").unwrap().mtime_ms > 0.0);
        upper.set_times("/", None, Some(-1.0)).unwrap();
        fs.write_file("/private/old", b"second").unwrap();
        assert_eq!(upper.stat("/").unwrap().mtime_ms, -1.0);
        assert_eq!(lower.read_file("/private/old").unwrap(), b"old");
    }

    #[test]
    fn failed_append_does_not_publish_or_read_the_lower_file() {
        let lower = Arc::new(MemoryVfs::new());
        let upper = Arc::new(MemoryVfs::new());
        lower.write_file("/d/f", b"old").unwrap();
        lower.set_times("/d/f", Some(100.0), None).unwrap();
        upper.set_max_total_bytes(4);
        let fs = OverlayVfs::new(lower.clone(), upper.clone());
        assert!(fs.append_file("/d/f", b"!!").unwrap_err().starts_with("ENOSPC:"));
        assert!(!upper.exists("/d"));
        assert_eq!(lower.stat("/d/f").unwrap().atime_ms, 100.0);
        fs.append_file("/d/f", b"!").unwrap();
        assert!(fs.append_file("/d/f", b"?").unwrap_err().starts_with("ENOSPC:"));
        assert_eq!(upper.stat("/d/f").unwrap().atime_ms, 100.0);
        assert_eq!(upper.read_file("/d/f").unwrap(), b"old!");
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
