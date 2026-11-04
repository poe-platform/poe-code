use super::*;
use crate::ExecutionBudget;

impl MemoryVfs {
    /// Publish under both namespace locks. Return the refreshed source directory
    /// snapshot so the mount router can recheck the original path before rmdir.
    pub(in crate::vfs) fn transfer_to(
        &self,
        destination: &Self,
        source: (&str, &str, u64),
        target: (&str, &str, u64),
        plan: &crate::vfs::mount::MovePlan,
        budget: Option<&ExecutionBudget>,
    ) -> Result<Option<FileStat>, String> {
        if self.id == destination.id {
            return Err("ENOTSUP: move between aliases of one mount".into());
        }
        let (mut src, mut dst) = if self.id < destination.id {
            let src = self.state.write().unwrap();
            (src, destination.state.write().unwrap())
        } else {
            let dst = destination.state.write().unwrap();
            (self.state.write().unwrap(), dst)
        };
        let (from, display_from, src_version) = source;
        let (to, display_to, dst_version) = target;
        if self.generation() != src_version || destination.generation() != dst_version {
            return Err(format!(
                "EBUSY: move entries changed during resolution '{display_from}'"
            ));
        }
        // Both locks keep identity, permissions, and the read allocation stable.
        // Coalesce observations under those locks, but admit the same operations
        // as a routed copy before touching access times or unlinking the source.
        let admit = |operations: usize| -> Result<(), String> {
            if let Some(b) = budget {
                b.check_cancelled()?;
                for _ in 0..operations { b.tick_fs_op()?; }
            }
            Ok(())
        };
        let link_retry = |path: &str| -> Result<Option<&String>,String> {
            let error = plan.link_errors.get(path);
            if let Some(e) = error {
                if e.starts_with("ENOENT:") { admit(1)?; } // retry the capability at its parent
                else if e.starts_with("ENOTDIR:") || e.starts_with("ELOOP:") {
                    admit(2)?; // lstat confirms a link before the parent retry
                } else { return Err(e.clone()); }
            }
            Ok(error)
        };
        if src.devices == Devices::Mounted && src.devices.entry(from).is_some_and(|name| !name.is_empty()) {
            admit(2)?; // lstat source and destination before planning the removal
            if destination.resolved_metadata(&dst,to).is_some_and(|st| st.kind == VfsEntryKind::Directory) {
                return Err(format!("EISDIR: illegal operation on a directory '{display_to}'"));
            }
            admit(1)?; // parent snapshot
            admit(2)?; // removal capability and conditional removal support
        }
        if src.devices.entry(from).is_some() {
            return Err(format!(
                "ENOTSUP: operation not supported, removeEntryConditional '{display_from}'"
            ));
        }
        let origin = src
            .nodes
            .get(from)
            .ok_or_else(|| format!("ENOENT: no such file or directory, lstat '{display_from}'"))?;
        let directory = matches!(origin, MemoryNode::Directory { .. });
        let device = dst.devices.entry(to);
        let existing = dst.nodes.get(to);
        if !directory { admit(2)?; } // lstat source and destination; directory inspection already did both
        if existing.is_some() || device.is_some() {
            let target_dir =
                matches!(existing, Some(MemoryNode::Directory { .. })) || device == Some("");
            if directory != target_dir {
                let e = if directory {
                    "ENOTDIR: not a directory"
                } else {
                    "EISDIR: illegal operation on a directory"
                };
                return Err(format!("{e} '{display_to}'"));
            }
            if directory {
                let prefix = format!("{to}/");
                if dst
                    .nodes
                    .range(prefix.clone()..)
                    .next()
                    .is_some_and(|(name, _)| name.starts_with(&prefix))
                {
                    return Err(format!("ENOTEMPTY: directory not empty '{display_to}'"));
                }
            }
        }
        if !directory {
            if matches!(origin, MemoryNode::Symlink { .. }) { admit(1)?; } // readlink
            admit(1)?; // stat source parent for the conditional unlink
        }
        if dst.devices == Devices::Mounted && !directory {
            let writable_parent = matches!(src.nodes.get(&crate::vfs::dirname_posix_path(from)),
                Some(MemoryNode::Directory { mode, .. }) if mode & 0o300 == 0o300);
            admit(1)?; // source mode
            let error = link_retry(display_from)?;
            admit(1)?; // conditional removal capability follows the original operand
            if let Some(e) = error { return Err(e.clone()); }
            let MemoryNode::File { ino } = origin else {
                admit(1)?; // the device mount cannot publish a symbolic link
                return Err(format!("ENOTSUP: operation not supported, mv '{display_to}'"));
            };
            let ino = *ino;
            admit(2)?; // select the destination writer, then admit publication
            let Some(device) = device else {
                return Err(format!("ENOTSUP: operation not supported, mv '{display_to}'"));
            };
            admit(1)?; // admit retained reads
            admit(1)?; // recheck source before copying
            admit(1)?; // openReadFile
            let file = src.files.get_mut(&ino).unwrap();
            if file.mode & 0o400 == 0 {
                return Err(format!("EACCES: permission denied, openReadFile '{display_from}'"));
            }
            admit(1)?; // fstat the retained inode
            admit(2)?; // select its destination writer and open the stream
            let mut consumed = 0;
            loop {
                admit(1)?; // positioned read, including the final EOF
                file.atime_ms = crate::vfs::now_ms();
                let size = (file.data.len() - consumed).min(65536);
                if size == 0 { break; }
                consumed += size;
                if let Some(b) = budget && consumed > b.limits.max_input_bytes {
                    return Err(b.record_exceeded(crate::ShellLimits::limit_error("maxInputBytes", b.limits.max_input_bytes)));
                }
                if device == "urandom" {
                    return Err(format!("EPERM: operation not permitted, writeStream '{display_to}'"));
                }
            }
            admit(1)?; // mounted devices have no permissions or timestamps to preserve
            admit(2)?; // recheck the plan, then the entry about to be removed
            admit(1)?; // removeEntryConditional
            if !writable_parent {
                return Err(format!("EACCES: permission denied, removeEntryConditional '{display_from}'"));
            }
            Self::unlink_locked(&mut src, from);
            self.bump_generation();
            return Ok(None);
        }
        if device.is_none() && dst.devices == Devices::Mounted {
            admit(2)?; // directory removal and conditional removal support
            admit(1)?; // the mount cannot create the destination directory
            return Err(format!(
                "ENOTSUP: operation not supported, mv '{display_to}'"
            ));
        }
        // Listing a directory or reading another name for an inode advances atime.
        // Preserve the snapshot from inspection before any of those reads.
        let children = &plan.children;
        let entries = std::iter::once((from, to, "",plan.atime_ms))
            .chain(children.iter().map(|p| (p.source.as_str(),p.target.as_str(),p.suffix.as_str(),p.atime_ms)));
        let operand = |base: &str, suffix: &str| if suffix.is_empty() { base.to_owned() }
            else { normalize_posix_path(&format!("{base}{suffix}")) };
        // Inspect capabilities for the entire plan before publishing even the root.
        // A target below a not-yet-created directory retries at each missing parent.
        let mut links = HashMap::new();
        let mut readers = 0;
        for (path, target, _, _) in entries.clone() {
            let node = &src.nodes[path];
            let ino = node.ino();
            if src.extra_links.contains_key(&ino) { *links.entry(ino).or_insert(0usize) += 1; }
            if matches!(node, MemoryNode::File { .. }) {
                readers += 1;
                if matches!(dst.nodes.get(target), Some(MemoryNode::File { .. })) {
                    admit(4)?; // staging capability, capture resolution, validate it, and inspect ancestry capability
                }
            }
        }
        for (path, target, suffix, _) in entries.clone() {
            let node = &src.nodes[path];
            if links.get(&node.ino()).is_some_and(|n| *n > 1) {
                admit(1)?; // capability for an atomic hardlink removal receipt
            }
            if matches!(node,MemoryNode::Symlink { .. }) {
                admit(1)?; // source mode may fall back to the parent
                let error = link_retry(&operand(display_from,suffix))?;
                admit(1)?; // conditional removal needs capabilities on the original operand
                if let Some(e) = error { return Err(e.clone()); }
            } else { admit(2)?; } // source mode and conditional removal capability
            let existing = dst.nodes.get(target);
            let queries = match node {
                MemoryNode::Directory { .. } => usize::from(existing.is_none()),
                MemoryNode::Symlink { .. } => 1 + usize::from(existing.is_some()),
                MemoryNode::File { .. } if matches!(existing,Some(MemoryNode::File { .. })) => 0,
                MemoryNode::File { .. } => 2, // writer selection and destination mode
            };
            if queries == 0 { continue; }
            if matches!(node,MemoryNode::Symlink { .. }) && matches!(existing,Some(MemoryNode::Symlink { .. })) {
                let name = operand(display_to,suffix);
                for _ in 0..queries { admit(1)?; link_retry(&name)?; }
                continue;
            }
            let mut candidate = target;
            loop {
                admit(queries)?;
                let parent = candidate.rsplit_once('/').map_or("", |(p,_)| p);
                if parent.is_empty() || dst.nodes.contains_key(parent) { break; }
                candidate = parent;
            }
        }
        admit(readers)?; // retained read capability for each regular file
        let mut metadata = Vec::new();
        for (path, target, suffix, inspected_atime) in entries.clone() {
            let device = dst.devices.entry(target);
            let target_name = operand(display_to,suffix);
            let source_name = operand(display_from,suffix);
            let node = src.nodes.get(path).ok_or_else(|| format!("ENOENT: no such file or directory, lstat '{source_name}'"))?;
            if let Some(b) = budget {
                b.check_cancelled()?;
                b.tick_fs_op()?;
                b.limits.check_path(&target_name)?;
            }
            let existed = dst.nodes.contains_key(target);
            let parent_error = match dst.nodes.get(&crate::vfs::dirname_posix_path(target)) {
                None => Some("ENOENT: no such file or directory"),
                Some(MemoryNode::Directory {mode,..}) if mode & 0o300 == 0o300 => None,
                Some(MemoryNode::Directory {..}) => Some("EACCES: permission denied"),
                Some(_) => Some("ENOTDIR: not a directory"),
            };
            let check_parent = |operation: &str| match parent_error {
                Some(reason) => Err(format!("{reason}, {operation} '{target_name}'")),
                None => Ok(()),
            };
            let storage_error = |err: String, operation: &str, name: &str| {
                let reason = if err.starts_with("EFBIG:") { "EFBIG: file too large" }
                    else if err.starts_with("ENOSPC:") { "ENOSPC: no space left on device" } else { &err };
                format!("{reason}, {operation} '{name}'")
            };
            match node {
                MemoryNode::Directory { mode, mtime_ms, .. } => {
                    if mode & 0o500 != 0o500 { return Err(format!("EACCES: permission denied, readdir '{source_name}'")); }
                    if device.is_some() { return Err(format!("ENOTSUP: operation not supported, mv '{target_name}'")); }
                    if !existed {
                        admit(1)?;
                        check_parent("mkdir")?;
                        dst.admit_new_file(0).map_err(|e| storage_error(e,"mkdir",&target_name))?;
                        dst.create_directory(target.to_owned(),0o40700);
                        destination.bump_generation();
                    }
                    metadata.push((target,*mode,inspected_atime,*mtime_ms));
                }
                MemoryNode::Symlink { target: link, .. } => {
                    if device.is_some() { return Err(format!("ENOTSUP: operation not supported, mv '{target_name}'")); }
                    if existed {
                        admit(1)?;
                        check_parent("rm")?;
                        Self::unlink_locked(&mut dst,target);
                        destination.bump_generation();
                    }
                    admit(1)?;
                    check_parent("symlink")?;
                    dst.admit_new_file(0).map_err(|e| storage_error(e,"symlink",&target_name))?;
                    let now = super::super::now_ms();
                    let ino = dst.allocate_ino();
                    dst.parent_changed(target,now);
                    dst.nodes.insert(target.to_owned(),MemoryNode::Symlink { target:link.clone(), status:SymlinkStatus::new(0o120777,now),
                        ino,atime_ms:now,mtime_ms:now,birthtime_ms:now });
                    destination.bump_generation();
                }
                MemoryNode::File { ino } => {
                    let ino = *ino;
                    if matches!(dst.nodes.get(target),Some(MemoryNode::Symlink { .. })) {
                        admit(1)?;
                        check_parent("rm")?;
                        Self::unlink_locked(&mut dst,target);
                        destination.bump_generation();
                    }
                    let replacing = dst.nodes.contains_key(target);
                    if replacing { admit(1)?; } // validate the captured staging resolution
                    admit(1)?; // openReadFile
                    let file = src.files.get_mut(&ino).unwrap();
                    if file.mode & 0o400 == 0 { return Err(format!("EACCES: permission denied, openReadFile '{source_name}'")); }
                    let atime = inspected_atime;
                    admit(1)?; // stat the retained reader
                    if replacing {
                        if let Some(b) = budget && file.data.len() > b.limits.max_input_bytes {
                            return Err(b.record_exceeded(crate::ShellLimits::limit_error("maxInputBytes", b.limits.max_input_bytes)));
                        }
                        let parent = crate::vfs::dirname_posix_path(target);
                        let mut stage = None;
                        for n in 1..=128 {
                            let candidate = format!("{}/.mv-{n}",parent.trim_end_matches('/'));
                            if candidate == target { continue; }
                            admit(1)?; // createStagedFile
                            if !dst.nodes.contains_key(&candidate) {
                                stage = Some((candidate,n));
                                break;
                            }
                        }
                        let Some((stage,n)) = stage else { return Err(format!("EEXIST: move staging attempt limit exceeded '{target_name}'")); };
                        let name = format!("{}/.mv-{n}",crate::vfs::dirname_posix_path(&target_name).trim_end_matches('/'));
                        if let Some(reason) = parent_error { return Err(format!("{reason}, createStagedFile '{name}'")); }
                        if dst.limits.max_entries.saturating_sub(dst.entry_count()) < 2 {
                            return Err(format!("ENOSPC: no space left on device, createStagedFile '{name}'"));
                        }
                        let entry = format!("{stage}/entry");
                        dst.create_directory(stage.clone(),0o40700);
                        let staged = dst.insert_new_file(entry.clone(),vec![],file.mode,None);
                        dst.files.get_mut(&staged).unwrap().set_times((Some(atime),Some(file.mtime_ms)));
                        destination.bump_generation();
                        let copy = (|| -> Result<(),String> {
                            for chunk in file.data.chunks(65536) {
                                admit(1)?; // retained read
                                file.atime_ms = super::super::now_ms();
                                admit(1)?; // staging write
                                Self::store_file(&mut dst,entry.clone(),&[],file.mode,None,Some(chunk))
                                    .map_err(|e| storage_error(e,"stagedWrite",&format!("{name}/entry")))?;
                            }
                            admit(1)?; // EOF
                            file.atime_ms = super::super::now_ms();
                            admit(1)?; // seal the staging writer and restore metadata
                            dst.files.get_mut(&staged).unwrap().set_times((Some(atime),Some(file.mtime_ms)));
                            admit(4)?; // stat retained reader and original path, publish, validate commit guard
                            Self::unlink_locked(&mut dst,target);
                            let mut node = dst.nodes.remove(&entry).unwrap();
                            let now = super::super::now_ms();
                            node.status_changed(&mut dst.files,now);
                            dst.parent_changed(&entry,now);
                            dst.parent_changed(target,now);
                            dst.nodes.insert(target.to_owned(),node);
                            Ok(())
                        })();
                        // Cleanup itself consumes an operation. If it is refused,
                        // the staged name (and any uncommitted bytes) stays visible.
                        admit(1)?;
                        Self::unlink_locked(&mut dst,&entry);
                        Self::unlink_locked(&mut dst,&stage);
                        copy?;
                        continue;
                    }
                    admit(2)?; // select and open the destination stream
                    if device.is_none() {
                        check_parent("writeStream")?;
                        Self::store_file(&mut dst,target.to_owned(),&[],file.mode,None,None).map_err(|e| storage_error(e,"writeStream",&target_name))?;
                        destination.bump_generation();
                    }
                    let mut consumed = 0;
                    for chunk in file.data.chunks(65536) {
                        admit(1)?; // positioned read
                        file.atime_ms = super::super::now_ms();
                        consumed += chunk.len();
                        if let Some(b) = budget && consumed > b.limits.max_input_bytes {
                            return Err(b.record_exceeded(crate::ShellLimits::limit_error("maxInputBytes", b.limits.max_input_bytes)));
                        }
                        match device {
                            Some("full") => return Err(format!("ENOSPC: no space left on device, writeStream '{target_name}'")),
                            Some("urandom") => return Err(format!("EPERM: operation not permitted, writeStream '{target_name}'")),
                            None => {
                                Self::store_file(&mut dst,target.to_owned(),&[],file.mode,None,Some(chunk)).map_err(|e| storage_error(e,"writeStream",&target_name))?;
                            }
                            _ => {}
                        }
                    }
                    admit(1)?; // final EOF, including empty files
                    file.atime_ms = super::super::now_ms();
                    if device.is_none() { metadata.push((target,file.mode,atime,file.mtime_ms)); }
                }
            }
        }
        if let Some(b) = budget { b.check_cancelled()?; }
        for (path,mode,accessed,modified) in metadata.into_iter().rev() {
            admit(2)?; // target metadata capability and chmod
            destination.set_mode_locked(&mut dst,path,mode)?;
            admit(1)?; // utimes
            match dst.nodes.get_mut(path) {
                Some(MemoryNode::Directory {atime_ms,mtime_ms,..}) => { *atime_ms = accessed; *mtime_ms = modified; }
                Some(MemoryNode::File {ino}) => {
                    let ino = *ino;
                    dst.files.get_mut(&ino).unwrap().set_times((Some(accessed),Some(modified)));
                }
                _ => unreachable!(),
            }
        }
        admit(1 + children.len())?; // recheck every source before the first removal
        for (path, _, suffix, _) in entries.rev() {
            if suffix.is_empty() && directory { break; }
            admit(2)?; // recheck entry and removeEntryConditional
            let is_directory = matches!(src.nodes.get(path), Some(MemoryNode::Directory { .. }));
            Self::remove_one_locked(&mut src,path,is_directory).map_err(|e| {
                let operand = if suffix.is_empty() { display_from.to_owned() }
                    else { normalize_posix_path(&format!("{display_from}{suffix}")) };
                format!("{e}, removeEntryConditional '{operand}'")
            })?;
            self.bump_generation();
        }
        Ok(if directory { self.resolved_metadata(&src, from) } else { None })
    }

    pub(in crate::vfs) fn remove_moved_directory(&self, path: &str, parent: &FileStat, expected: &FileStat, version: u64) -> Result<(),String> {
        let mut state = self.state.write().map_err(|_| "EIO: input/output error")?;
        let actual_parent = self.resolved_metadata(&state, &crate::vfs::dirname_posix_path(path));
        if self.generation() != version
            || !self.resolved_metadata(&state, path).is_some_and(|st| st.same_snapshot(expected))
            || !actual_parent.is_some_and(|st| st.identity.is_some() && st.identity == parent.identity) {
            return Err("EAGAIN: resource temporarily unavailable".into());
        }
        Self::remove_one_locked(&mut state,path,true)?;
        self.bump_generation();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_source_and_destination_generations_refuse_publication_and_removal() {
        let a = MemoryVfs::new();
        let b = MemoryVfs::new();
        a.write_file("/src", b"first").unwrap();
        let old = a.generation();
        a.remove_path("/src").unwrap();
        a.write_file("/src", b"replacement").unwrap();
        assert!(
            a.transfer_to(
                &b,
                ("/src", "/src", old),
                ("/dst", "/mnt/dst", b.generation()),
                &Default::default(), None
            )
            .unwrap_err()
            .starts_with("EBUSY")
        );
        let old = b.generation();
        b.write_file("/dst", b"keep").unwrap();
        assert!(
            a.transfer_to(
                &b,
                ("/src", "/src", a.generation()),
                ("/dst", "/mnt/dst", old),
                &Default::default(), None
            )
            .unwrap_err()
            .starts_with("EBUSY")
        );
        assert_eq!(a.read_file("/src").unwrap(), b"replacement");
        assert_eq!(b.read_file("/dst").unwrap(), b"keep");
    }
}
