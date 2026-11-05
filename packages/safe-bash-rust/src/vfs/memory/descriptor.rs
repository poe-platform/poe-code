use super::*;

// Only directories opened for reading track their location. Rename moves
// that location; unlink leaves final metadata without retaining the pathname.
#[derive(Debug)]
pub(super) struct DirectoryReadState {
    pub(super) path: Option<String>,
    pub(super) stat: FileStat,
}

pub(super) struct RetainedDirectory {
    pub(super) fs: MemoryVfs,
    pub(super) location: Arc<std::sync::Mutex<DirectoryReadState>>,
}

impl crate::vfs::FileReadHandle for RetainedDirectory {
    fn stat(&self) -> Result<FileStat, String> {
        let fs = self.fs.state.read().map_err(|e| e.to_string())?;
        let handle = self.location.lock().map_err(|e| e.to_string())?;
        match &handle.path {
            Some(p) => self.fs.resolved_metadata(&fs, p).ok_or_else(|| "ESTALE: directory entry changed".into()),
            None => Ok(handle.stat.clone()),
        }
    }
    // Memory directories use the same end offset as the production ext4 directory model.
    fn seek_end(&self) -> Result<u64, String> { Ok(i64::MAX as u64) }
    fn read(&self, _: u64, _: usize) -> Result<Vec<u8>, String> {
        Err("EISDIR".into())
    }
}

pub(super) struct NullRead(pub(super) FileStat);

impl crate::vfs::FileReadHandle for NullRead {
    fn stat(&self) -> Result<FileStat, String> { Ok(self.0.clone()) }
    fn seek_end(&self) -> Result<u64, String> { Ok(0) }
    fn read(&self, _: u64, _: usize) -> Result<Vec<u8>, String> { Ok(Vec::new()) }
}

#[derive(Debug)]
pub(super) struct DeviceInput {
    pub(super) random: bool,
    pub(super) writable: bool,
}

impl crate::vfs::OpenRedirectFile for DeviceInput {
    fn is_stream(&self) -> bool { true }

    fn read_at(&self, _: usize, limit: usize) -> Result<Vec<u8>, String> {
        let mut bytes = vec![0; limit.min(65536)];
        if self.random { fill_random(&mut bytes)?; }
        Ok(bytes)
    }

    fn write_at(&self, _: Option<usize>, _: &[u8]) -> Result<(), String> {
        if self.writable { Ok(()) } else { Err("EBADF: bad file descriptor".into()) }
    }
}

/// Keeps the inode and its bytes charged to the filesystem after its last name disappears.
pub(crate) struct RetainedFile {
    pub(super) fs: MemoryVfs,
    pub(super) ino: u64,
    pub(super) access: crate::vfs::RedirectAccess,
}

impl std::fmt::Debug for RetainedFile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_tuple("RetainedFile").field(&self.ino).finish()
    }
}

impl crate::vfs::OpenRedirectFile for RetainedFile {
    fn revision(&self) -> Option<u64> { Some(self.fs.generation()) }

    fn stat(&self) -> Result<FileStat, String> { Ok(self.stat()) }

    fn truncate_to(&self, len: usize) -> Result<(), String> {
        if self.access == crate::vfs::RedirectAccess::Read { return Err("EBADF: bad file descriptor".into()); }
        self.truncate(len as u64)
    }

    fn read_at(&self, offset: usize, limit: usize) -> Result<Vec<u8>, String> {
        if !matches!(self.access, crate::vfs::RedirectAccess::Read | crate::vfs::RedirectAccess::ReadWrite) { return Err("EBADF: bad file descriptor".into()); }
        Ok(self.read(offset as u64, limit))
    }

    fn write_at(&self, offset: Option<usize>, bytes: &[u8]) -> Result<(), String> {
        if self.access == crate::vfs::RedirectAccess::Read { return Err("EBADF: bad file descriptor".into()); }
        self.write(offset.map(|n| n as u64), bytes).map(|_| ())
    }
}

impl MemoryVfs {
    pub(crate) fn retain_file(&self, path: &str) -> Result<RetainedFile, String> {
        let mut state = self.state.write().map_err(|e| e.to_string())?;
        let path = Self::resolve_symlinks_locked(&state, path, true).map_err(|e| e.message)?;
        let ino = match state.nodes.get(&path) {
            Some(&MemoryNode::File { ino }) => ino,
            Some(MemoryNode::Directory { .. }) => return Err("EISDIR: illegal operation on a directory".into()),
            _ => return Err("ENOENT: missing regular file".into()),
        };
        state.files.get_mut(&ino).unwrap().opens += 1;
        Ok(RetainedFile { fs: self.clone(), ino, access: crate::vfs::RedirectAccess::ReadWrite })
    }
}

impl crate::vfs::FileReadHandle for RetainedFile {
    fn stat(&self) -> Result<FileStat, String> { Ok(self.stat()) }
    fn seek_end(&self) -> Result<u64, String> { Ok(self.stat().size as u64) }
    fn read(&self, offset: u64, maximum: usize) -> Result<Vec<u8>, String> { Ok(self.read(offset, maximum)) }
}

impl RetainedFile {
    pub(crate) fn stat(&self) -> FileStat {
        let state = self.fs.state.read().unwrap();
        let file = &state.files[&self.ino];
        FileStat {
            revision: Some(file.revision),
            nlink: Some(usize::from(file.linked) + state.extra_links.get(&self.ino).map_or(0, |g| g.extra)),
            uid: Some(0), gid: Some(0), io_block_size: Some(65536), preferred_io_block_size: Some(4096), filesystem_type: Some("memory".into()),
            identity: Some(EntryIdentity::Memory(self.fs.id, self.ino)),
            allocated_bytes: None,
            kind: VfsEntryKind::File,
            size: file.data.len(),
            mode: file.mode,
            atime_ms: file.atime_ms,
            mtime_ms: file.mtime_ms,
            ctime_ms: Some(file.ctime_ms), birthtime_ms: Some(file.birthtime_ms),
        }
    }

    pub(crate) fn read(&self, offset: u64, size: usize) -> Vec<u8> {
        let mut state = self.fs.state.write().unwrap();
        let file = state.files.get_mut(&self.ino).unwrap();
        file.atime_ms = crate::vfs::now_ms();
        let data = &file.data;
        let start = offset.min(data.len() as u64) as usize;
        data[start..start.saturating_add(size).min(data.len())].to_vec()
    }

    pub(crate) fn write(&self, offset: Option<u64>, data: &[u8]) -> Result<usize, String> {
        let mut state = self.fs.state.write().unwrap();
        let size = state.files[&self.ino].data.len();
        let start = offset.unwrap_or(size as u64);
        let end = usize::try_from(start)
            .ok()
            .and_then(|n| n.checked_add(data.len()))
            .ok_or("EFBIG: file too large")?;
        self.resize_locked(&mut state, size.max(end))?;
        Arc::get_mut(&mut state.files.get_mut(&self.ino).unwrap().data).unwrap()[end - data.len()..end].copy_from_slice(data);
        Ok(end)
    }

    pub(crate) fn truncate(&self, size: u64) -> Result<(), String> {
        let mut state = self.fs.state.write().unwrap();
        self.resize_locked(&mut state, usize::try_from(size).map_err(|_| "EFBIG: file too large")?)
    }

    fn resize_locked(&self, state: &mut MemoryState, size: usize) -> Result<(), String> {
        if size > state.limits.max_file_bytes || size > isize::MAX as usize {
            return Err("EFBIG: file too large".into());
        }
        let file = state.files.get_mut(&self.ino).unwrap();
        let old = file.data.len();
        let total = (state.total_bytes - file.reclaimable_bytes())
            .checked_add(size)
            .ok_or("ENOSPC: byte limit exceeded")?;
        if total > state.limits.max_total_bytes {
            return Err("ENOSPC: byte limit exceeded".into());
        }
        let data = file.resize_data(size)?;
        if size < old { data.shrink_to_fit(); }
        file.publication = None;
        file.mtime_ms = crate::vfs::now_ms();
        file.status_changed(file.mtime_ms);
        state.total_bytes = total;
        self.fs.bump_generation();
        Ok(())
    }
}

impl Drop for RetainedFile {
    fn drop(&mut self) {
        let mut state = self.fs.state.write().unwrap();
        let file = state.files.get_mut(&self.ino).unwrap();
        file.opens -= 1;
        if !file.linked && file.opens == 0 {
            state.total_bytes -= state.files.remove(&self.ino).unwrap().data.len();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaced_snapshot_does_not_retarget_a_retained_directory() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/dir").unwrap();
        let handle = fs.open_read_file("/dir", true).unwrap();
        let before = handle.stat().unwrap();
        fs.replace_entries(&fs.export_entries().unwrap()).unwrap();
        fs.chmod("/dir", 0o500).unwrap();
        let after = handle.stat().unwrap();
        assert_eq!((after.identity, after.mode, after.nlink), (before.identity, before.mode, Some(0)));
        assert_ne!(fs.stat("/dir").unwrap().mode, before.mode);
    }

    #[test]
    fn replacing_a_snapshot_preserves_open_files_and_rejects_over_budget_without_changes() {
        let fs = MemoryVfs::new();
        fs.write_file("/old", b"four").unwrap();
        let fd = fs.retain_file("/old").unwrap();
        let mut snapshot = fs.export_entries().unwrap();
        snapshot[0].path = "/new".into();
        fs.set_max_total_bytes(7);
        assert!(fs.replace_entries(&snapshot).unwrap_err().starts_with("ENOSPC"));
        assert_eq!(fs.read_file("/old").unwrap(), b"four");
        fs.set_max_total_bytes(8);
        fs.replace_entries(&snapshot).unwrap();
        fs.write_file("/new", b"five").unwrap();
        assert_eq!(fd.read(0, 4), b"four");
        drop(fd);
        fs.write_file("/another", b"four").unwrap();
    }
    #[test]
    fn exclusive_output_acquisition_cannot_truncate_another_openers_file() {
        use crate::vfs::RedirectAccess;
        let fs = MemoryVfs::new();
        let start = std::sync::Barrier::new(2);
        std::thread::scope(|scope| {
            let open = || {
                start.wait();
                match fs.open_redirect_file("/output", RedirectAccess::Exclusive, Some(0o600)) {
                    Ok(Some(fd)) => { fd.write_at(Some(0), b"winner").unwrap(); true }
                    Err(e) if e.starts_with("EEXIST:") => false,
                    other => panic!("{other:?}"),
                }
            };
            let other = scope.spawn(open);
            assert_ne!(open(), other.join().unwrap());
        });
        assert_eq!(fs.read_file("/output").unwrap(), b"winner");
        fs.symlink("/missing", "/link").unwrap();
        assert!(fs.open_redirect_file("/link", RedirectAccess::Exclusive, Some(0o600)).unwrap_err().starts_with("EEXIST:"));
        assert!(!fs.exists("/missing"));
    }

    #[test]
    fn unlinked_file_remains_charged_until_last_close() {
        let fs = MemoryVfs::new();
        fs.set_max_total_bytes(7);
        fs.write_file("/entry", b"abcd").unwrap();
        let a = fs.retain_file("/entry").unwrap();
        let b = fs.retain_file("/entry").unwrap();
        fs.remove_path("/entry").unwrap();
        fs.write_file("/entry", b"new").unwrap();
        assert!(a.write(None, b"!").unwrap_err().starts_with("ENOSPC"));
        drop(a);
        assert!(fs.write_file("/other", b"x").is_err());
        assert_eq!(b.read(0, 4), b"abcd");
        drop(b);
        fs.write_file("/other", b"1234").unwrap();
    }
}
