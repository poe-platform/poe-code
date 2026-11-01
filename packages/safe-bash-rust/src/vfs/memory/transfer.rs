use super::*;
use crate::ExecutionBudget;

impl MemoryVfs {
    /// Both namespace locks stay held from receipt validation through destination
    /// publication and source removal. Take them in device order for opposing moves.
    pub(crate) fn transfer_to(
        &self,
        destination: &Self,
        source: (&str, &str, u64),
        target: (&str, &str, u64),
        budget: Option<&ExecutionBudget>,
    ) -> Result<(), String> {
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
        if device.is_none() && dst.devices == Devices::Mounted {
            return Err(format!(
                "ENOTSUP: operation not supported, mv '{display_to}'"
            ));
        }
        if device.is_none() {
            let parent = crate::vfs::dirname_posix_path(to);
            match dst.nodes.get(&parent) {
                Some(MemoryNode::Directory { mode, .. }) if mode & 0o300 == 0o300 => {}
                Some(MemoryNode::Directory { .. }) => {
                    return Err(format!("EACCES: permission denied, mv '{display_to}'"));
                }
                _ => {
                    return Err(format!(
                        "ENOENT: no such file or directory, mv '{display_to}'"
                    ));
                }
            }
        }
        // Stage only the moved entries. No published name or open file changes
        // if any descendant fails admission, including a quota or cancellation.
        let mut staged = MemoryState {
            nodes: BTreeMap::new(),
            files: HashMap::new(),
            extra_links: HashMap::new(), child_dirs: HashMap::new(),
            devices: Devices::None,
            total_bytes: dst.total_bytes,
            limits: dst.limits.clone(),
        };
        let available = dst.limits.max_entries.saturating_sub(dst.nodes.len())
            + usize::from(existing.is_some());
        let mut removals = Vec::new();
        let prefix = format!("{from}/");
        for (path, node) in std::iter::once((from, origin)).chain(
            src.nodes
                .range(prefix.clone()..)
                .take_while(|(p, _)| directory && p.starts_with(&prefix))
                .map(|(p, n)| (p.as_str(), n)),
        ) {
            let suffix = &path[from.len()..];
            let new_path = format!("{to}{suffix}");
            if let Some(b) = budget {
                b.check_cancelled()?;
                b.tick_fs_op()?;
                b.limits.check_path(&format!("{display_to}{suffix}"))?;
            }
            if !matches!(src.nodes.get(&crate::vfs::dirname_posix_path(path)), Some(MemoryNode::Directory {mode,..}) if mode & 0o300 == 0o300)
            {
                return Err(format!(
                    "EACCES: permission denied, removeEntryConditional '{display_from}{suffix}'"
                ));
            }
            if device.is_none() && staged.nodes.len() >= available {
                return Err("ENOSPC: inode limit exceeded".into());
            }
            match node {
                MemoryNode::File { ino } => {
                    let file = &src.files[ino];
                    if file.mode & 0o400 == 0 {
                        return Err(format!(
                            "EACCES: permission denied, openReadFile '{display_from}{suffix}'"
                        ));
                    }
                    if let Some(b) = budget {
                        b.add_output_bytes(file.data.len())?;
                    }
                    match device {
                        Some("urandom") => {
                            return Err(format!(
                                "EPERM: operation not permitted, writeStream '{display_to}'"
                            ));
                        }
                        Some("full") => {
                            return Err(format!(
                                "ENOSPC: no space left on device, writeStream '{display_to}'"
                            ));
                        }
                        Some(_) => {}
                        None => {
                            Self::store_file(
                                &mut staged,
                                new_path.clone(),
                                &file.data,
                                file.mode,
                                None,
                            )?;
                            let MemoryNode::File { ino } = staged.nodes[&new_path] else {
                                unreachable!()
                            };
                            let copy = staged.files.get_mut(&ino).unwrap();
                            copy.atime_ms = file.atime_ms;
                            copy.mtime_ms = file.mtime_ms;
                        }
                    }
                }
                MemoryNode::Symlink {
                    target,
                    mode,
                    atime_ms, mtime_ms,
                    ..
                } => {
                    if device.is_some() {
                        return Err(format!(
                            "ENOTSUP: operation not supported, mv '{display_to}'"
                        ));
                    }
                    let now = super::super::now_ms();
                    staged.nodes.insert(
                        new_path,
                        MemoryNode::Symlink {
                            target: target.clone(),
                            ctime_bits: Arc::new(AtomicU64::new(now.to_bits())), birthtime_ms: now,
                            ino: NEXT_INODE.fetch_add(1, Ordering::Relaxed),
                            mode: *mode,
                            atime_ms: *atime_ms,
                            mtime_ms: *mtime_ms,
                        },
                    );
                }
                MemoryNode::Directory { mode, atime_ms, mtime_ms, .. } => {
                    if mode & 0o500 != 0o500 {
                        return Err(format!(
                            "EACCES: permission denied, readdir '{display_from}{suffix}'"
                        ));
                    }
                    let ino = match existing {
                        Some(MemoryNode::Directory { ino, .. }) if suffix.is_empty() => *ino,
                        _ => NEXT_INODE.fetch_add(1, Ordering::Relaxed),
                    };
                    let now = super::super::now_ms();
                    staged.insert_directory(
                        new_path,
                        MemoryNode::Directory {
                            ino,
                            ctime_ms: now, birthtime_ms: now,
                            mode: *mode,
                            atime_ms: *atime_ms,
                            mtime_ms: *mtime_ms,
                        },
                    );
                }
            }
            removals.push(path.to_owned());
        }
        if let Some(b) = budget {
            b.check_cancelled()?;
        }
        if device.is_none() {
            let added = staged.total_bytes - dst.total_bytes;
            if existing.is_some() {
                Self::unlink_locked(&mut dst, to);
            }
            for (parent, count) in staged.child_dirs { *dst.child_dirs.entry(parent).or_default() += count; }
            dst.parent_changed(to, super::super::now_ms());
            dst.nodes.append(&mut staged.nodes);
            dst.files.extend(staged.files);
            dst.total_bytes += added;
            destination.bump_generation();
        }
        for path in removals.into_iter().rev() {
            Self::unlink_locked(&mut src, &path);
        }
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
                None
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
                None
            )
            .unwrap_err()
            .starts_with("EBUSY")
        );
        assert_eq!(a.read_file("/src").unwrap(), b"replacement");
        assert_eq!(b.read_file("/dst").unwrap(), b"keep");
    }
}
