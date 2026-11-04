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
                data: Arc::new(data),
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
        state.insert_node(path.to_owned(), MemoryNode::File { ino });
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

/// Conditions for publishing a visible staging entry into its destination.
pub struct StageDestination<'a> {
    pub path: &'a str,
    pub parent: &'a FileStat,
    pub expected: Option<&'a FileStat>,
    pub ancestors: Option<&'a [(&'a str, FileStat)]>,
}

pub enum StageAction<'a> {
    Publish(StageDestination<'a>),
    Remove { retained: bool },
    Append(&'a [u8]),
    Finish { atime: f64, mtime: f64 },
}

pub enum StageContent<'a> {
    File(&'a [u8]),
    Symlink(&'a str),
}

impl MemoryVfs {
    pub fn create_owned_stage(
        &self,
        directory: &str,
        name: &str,
        content: StageContent<'_>,
        parent: &FileStat,
        mode: u32,
        times: [Option<f64>; 2],
    ) -> Result<[(String, FileStat); 3], String> {
        if name.is_empty()
            || matches!(name, "." | "..")
            || name.contains(['/', '\0'])
            || mode > 0o7777
            || times.iter().flatten().any(|v| !v.is_finite())
        {
            return Err("EINVAL: invalid staging entry".into());
        }
        let mut state = self.state.write().map_err(|_| "EIO: input/output error")?;
        let dir = Self::mutation_entry(&state, directory)?;
        if state.devices == Devices::Mounted {
            return Err("ENOTSUP: device filesystem".into());
        }
        if state.nodes.contains_key(&dir) || state.devices.entry(&dir).is_some() {
            return Err("EEXIST: file already exists".into());
        }
        let parent_path = super::super::dirname_posix_path(&dir);
        let observed = self
            .resolved_metadata(&state, &parent_path)
            .ok_or("ENOENT: parent not found")?;
        observed.check_receipt(parent, false, &parent_path)?;
        if observed.mode & 0o300 != 0o300 {
            return Err("EACCES: permission denied".into());
        }
        if state.limits.max_entries.saturating_sub(state.entry_count()) < 2 {
            return Err("ENOSPC: inode limit exceeded".into());
        }
        let file = format!("{dir}/{name}");
        let [atime, mtime] = times;
        match content {
            StageContent::File(bytes) => {
                state.admit_new_file(bytes.len())?;
                let mut data = Vec::new();
                data.try_reserve_exact(bytes.len())
                    .map_err(|_| "ENOSPC: staging allocation failed")?;
                data.extend_from_slice(bytes);
                state.create_directory(dir.clone(), 0o40700);
                state.total_bytes += data.len();
                let ino = state.insert_new_file(file.clone(), data, 0o100000 | mode, None);
                let node = state.files.get_mut(&ino).unwrap();
                if let Some(time) = atime {
                    node.atime_ms = time;
                }
                if let Some(time) = mtime {
                    node.mtime_ms = time;
                }
            }
            StageContent::Symlink(target) => {
                if target.contains('\0') {
                    return Err("EINVAL: invalid symlink target".into());
                }
                state.create_directory(dir.clone(), 0o40700);
                let now = crate::vfs::now_ms();
                let ino = state.allocate_ino();
                state.insert_node(
                    file.clone(),
                    MemoryNode::Symlink {
                        ino,
                        target: target.into(),
                        status: SymlinkStatus::new(0o120000 | mode, now),
                        atime_ms: atime.unwrap_or(now),
                        mtime_ms: mtime.unwrap_or(now),
                        birthtime_ms: now,
                    },
                );
                state.parent_changed(&file, now);
            }
        }
        self.bump_generation();
        Ok([parent_path, dir, file].map(|path| {
            let stat = self.resolved_metadata(&state, &path).unwrap();
            (path, stat)
        }))
    }

    pub fn finish_owned_stage(
        &self,
        entries: [(&str, &FileStat); 3],
        action: StageAction<'_>,
    ) -> Result<Option<FileStat>, String> {
        let [(parent, pst), (dir, dst), (file, fst)] = entries;
        let changed = "EAGAIN: staging entry changed";
        let dirname = crate::vfs::dirname_posix_path;
        let mut state = self.state.write().map_err(|_| "EIO: input/output error")?;
        if state.devices == Devices::Mounted {
            return Err("ENOTSUP: device filesystem".into());
        }
        if dir == "/"
            || file == "/"
            || dirname(dir) != parent
            || dirname(file) != dir
            || entries
                .iter()
                .any(|(p, _)| normalize_posix_path(p) != *p || p.contains('\0'))
        {
            return Err(changed.into());
        }
        // An inode number is never reused by this store. A retained cleanup may
        // follow its original parent after a rename, but never a replacement.
        let retained = matches!(action, StageAction::Remove { retained: true });
        let moved;
        let (parent, dir, file) = if retained
            && !self
                .resolved_metadata(&state, parent)
                .is_some_and(|s| s.identity == pst.identity)
        {
            let Some(EntryIdentity::Memory(store, ino)) = pst.identity else {
                return Err(changed.into());
            };
            if store != self.id {
                return Err(changed.into());
            }
            let (found, _) = state
                .nodes
                .iter()
                .find(|(_, n)| matches!(n,MemoryNode::Directory{ino:id,..} if *id==ino))
                .ok_or(changed)?;
            let child = format!(
                "{}/{}",
                found.trim_end_matches('/'),
                dir.rsplit('/').next().unwrap()
            );
            let leaf = format!("{}/{}", child, file.rsplit('/').next().unwrap());
            moved = (found.clone(), child, leaf);
            (moved.0.as_str(), moved.1.as_str(), moved.2.as_str())
        } else {
            (parent, dir, file)
        };
        for (p, st) in [(parent, pst), (dir, dst)] {
            if !retained && Self::resolve_mutation_entry(&state, p)? != p {
                return Err(changed.into());
            }
            let actual = self.resolved_metadata(&state, p).ok_or(changed)?;
            actual.check_receipt(st, false, p)?;
            if actual.kind != VfsEntryKind::Directory || p == dir && actual.mode & 0o777 != 0o700 {
                return Err(changed.into());
            }
        }
        if !matches!(fst.kind, VfsEntryKind::File | VfsEntryKind::Symlink) {
            return Err(changed.into());
        }
        let staged = self.resolved_metadata(&state, file);
        if let Some(st) = &staged {
            st.check_receipt(fst, true, file)?;
        }
        match action {
            StageAction::Publish(target) => {
                let source = staged.ok_or(changed)?;
                if let Some(chain) = target.ancestors {
                    crate::vfs::validate_chmod_ancestry(target.path, 0, chain)?;
                    for (p, st) in chain {
                        self.check_chmod_receipt(&state, p, st, false, true)?;
                    }
                }
                let to = Self::mutation_entry(&state, target.path)?;
                if state.devices.entry(&to).is_some() || to == "/" {
                    return Err("EBUSY: resource busy or locked".into());
                }
                if target.path.ends_with('/') {
                    return Err("ENOTDIR: not a directory".into());
                }
                let parent_path = dirname(&to);
                let parent = self
                    .resolved_metadata(&state, &parent_path)
                    .ok_or(changed)?;
                parent.check_receipt(target.parent, false, target.path)?;
                if parent.mode & 0o300 != 0o300 {
                    return Err("EACCES: permission denied".into());
                }
                let existing = self.resolved_metadata(&state, &to);
                match (&existing, target.expected) {
                    (None, None) => (),
                    (Some(actual), Some(expected)) => actual.check_receipt(expected, true, &to)?,
                    _ => return Err(changed.into()),
                }
                if parent_path == dir
                    || to == dir
                    || existing
                        .as_ref()
                        .is_some_and(|s| s.identity == source.identity)
                {
                    return Err("EINVAL: invalid staging destination".into());
                }
                if existing.is_some_and(|s| s.kind != VfsEntryKind::File) {
                    return Err(changed.into());
                }
                Self::unlink_locked(&mut state, &to);
                let mut node = state.take_node(file).unwrap();
                let now = crate::vfs::now_ms();
                node.status_changed(&mut state.files, now);
                state.parent_changed(file, now);
                state.parent_changed(&to, now);
                state.insert_node(to, node);
            }
            StageAction::Remove { .. } => {
                let prefix = format!("{dir}/");
                if state
                    .nodes
                    .range(prefix.clone()..)
                    .take_while(|(p, _)| p.starts_with(&prefix))
                    .any(|(p, _)| p != file)
                {
                    return Err("ENOTEMPTY: directory not empty".into());
                }
                if self.resolved_metadata(&state, parent).unwrap().mode & 0o300 != 0o300 {
                    return Err("EACCES: permission denied".into());
                }
                Self::unlink_locked(&mut state, file);
                Self::unlink_locked(&mut state, dir);
            }
            StageAction::Append(_) | StageAction::Finish { .. } => {
                if staged.is_none() || fst.kind != VfsEntryKind::File {
                    return Err(changed.into());
                }
                if self.resolved_metadata(&state, parent).unwrap().mode & 0o300 != 0o300 {
                    return Err("EACCES: permission denied".into());
                }
                match action {
                    StageAction::Append(bytes) => {
                        Self::store_file(&mut state, file.into(), &[], 0, None, Some(bytes))?
                    }
                    StageAction::Finish { atime, mtime } => {
                        let ino = state.nodes[file].ino();
                        let node = state.files.get_mut(&ino).unwrap();
                        node.status_changed(crate::vfs::now_ms());
                        node.set_times((Some(atime), Some(mtime)));
                    }
                    _ => unreachable!(),
                }
                self.bump_generation();
                return Ok(self.resolved_metadata(&state, file));
            }
        }
        self.bump_generation();
        Ok(None)
    }
}
