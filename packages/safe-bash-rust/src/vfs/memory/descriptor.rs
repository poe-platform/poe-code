use super::*;

/// Keeps the inode and its bytes charged to the filesystem after its last name disappears.
pub(crate) struct RetainedFile {
    fs: MemoryVfs,
    ino: u64,
}

impl MemoryVfs {
    pub(crate) fn retain_file(&self, path: &str) -> Result<RetainedFile, String> {
        let mut state = self.state.write().map_err(|e| e.to_string())?;
        let path = Self::resolve_symlinks_locked(&state, path, true).map_err(|e| e.message)?;
        let Some(&MemoryNode::File { ino }) = state.nodes.get(&path) else {
            return Err("ENOENT: missing regular file".into());
        };
        state.files.get_mut(&ino).unwrap().opens += 1;
        Ok(RetainedFile { fs: self.clone(), ino })
    }
}

impl RetainedFile {
    pub(crate) fn stat(&self) -> FileStat {
        let state = self.fs.state.read().unwrap();
        let file = &state.files[&self.ino];
        FileStat {
            nlink: usize::from(file.linked) + state.extra_links.get(&self.ino).copied().unwrap_or(0),
            identity: Some(EntryIdentity::Memory(self.fs.id, self.ino)),
            allocated_bytes: None,
            kind: VfsEntryKind::File,
            size: file.data.len(),
            mode: file.mode,
            mtime_ms: file.mtime_ms,
        }
    }

    pub(crate) fn read(&self, offset: u64, size: usize) -> Vec<u8> {
        let state = self.fs.state.read().unwrap();
        let data = &state.files[&self.ino].data;
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
        state.files.get_mut(&self.ino).unwrap().data[end - data.len()..end].copy_from_slice(data);
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
        let total = (state.total_bytes - old)
            .checked_add(size)
            .ok_or("ENOSPC: byte limit exceeded")?;
        if total > state.limits.max_total_bytes {
            return Err("ENOSPC: byte limit exceeded".into());
        }
        if size > old {
            file.data
                .try_reserve_exact(size - old)
                .map_err(|_| "ENOSPC: insufficient memory")?;
        }
        file.data.resize(size, 0);
        if size < old {
            file.data.shrink_to_fit();
        }
        file.publication = None;
        file.mtime_ms = 1_700_000_000_000;
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
