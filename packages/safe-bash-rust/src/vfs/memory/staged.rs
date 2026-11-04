use super::*;

/// A replacement inode charged to the upper layer but not yet reachable by name.
pub(crate) struct StagedFile {
    fs: MemoryVfs,
    ino: Option<u64>,
}

impl MemoryVfs {
    pub(crate) fn stage_file(
        &self,
        source: &dyn crate::vfs::FileReadHandle,
        st: &FileStat,
        mode: u32,
    ) -> Result<StagedFile, String> {
        self.state
            .read()
            .map_err(|e| e.to_string())?
            .admit_new_file(st.size)?;
        let pinned = source.stat()?;
        if pinned.identity != st.identity || pinned.revision != st.revision {
            return Err("EAGAIN: source changed during copy-up".into());
        }
        let data = source.read(0, st.size)?;
        if data.len() != st.size || source.stat()?.revision != st.revision {
            return Err("EAGAIN: source changed during copy-up".into());
        }
        let mut state = self.state.write().map_err(|e| e.to_string())?;
        state.admit_new_file(data.len())?;
        let ino = state.allocate_ino();
        let now = crate::vfs::now_ms();
        state.total_bytes += data.len();
        state.staged_entries += 1;
        // Snapshot replacement retains open inodes even when they have no name.
        state.files.insert(
            ino,
            MemoryFile {
                revision: 0,
                data,
                publication: None,
                mode: 0o100000 | mode,
                atime_ms: st.atime_ms,
                mtime_ms: st.mtime_ms,
                ctime_ms: now,
                birthtime_ms: now,
                opens: 1,
                linked: false,
            },
        );
        Ok(StagedFile {
            fs: self.clone(),
            ino: Some(ino),
        })
    }
}

impl StagedFile {
    pub(crate) fn publish(
        mut self,
        lower: &MemoryVfs,
        versions: (u64, u64),
        path: &str,
    ) -> Result<(), String> {
        let (_base, mut state) = self.fs.overlay_layers(lower, versions)?;
        let ino = self.ino.take().unwrap();
        MemoryVfs::unlink_locked(&mut state, path);
        let file = state.files.get_mut(&ino).unwrap();
        file.opens = 0;
        file.linked = true;
        let now = crate::vfs::now_ms();
        file.status_changed(now);
        state.parent_changed(path, now);
        state
            .nodes
            .insert(path.to_owned(), MemoryNode::File { ino });
        state.staged_entries -= 1;
        self.fs.bump_generation();
        Ok(())
    }
}

impl Drop for StagedFile {
    fn drop(&mut self) {
        if let Some(ino) = self.ino {
            let mut state = self.fs.state.write().unwrap();
            state.total_bytes -= state.files.remove(&ino).unwrap().data.len();
            state.staged_entries -= 1;
        }
    }
}
