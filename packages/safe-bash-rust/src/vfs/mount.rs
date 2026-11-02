use crate::vfs::path::{WalkPurpose, normalize_posix_path, walk_path};
use crate::vfs::{FileStat, SafeBashFs, VfsFileEntry};
use std::collections::BTreeMap;
use std::sync::Arc;

#[derive(Clone)]
pub struct MountVfs {
    root: Arc<dyn SafeBashFs>,
    mounts: BTreeMap<String, Arc<dyn SafeBashFs>>,
}

impl MountVfs {
    pub fn new(root: Arc<dyn SafeBashFs>) -> Self {
        Self {
            root,
            mounts: BTreeMap::new(),
        }
    }

    pub fn with_mount(mut self, prefix: &str, fs: Arc<dyn SafeBashFs>) -> Self {
        self.mounts.insert(normalize_posix_path(prefix), fs);
        self
    }

    fn location(&self, norm: &str) -> (&str, &dyn SafeBashFs, String) {
        for (prefix, mounted) in self.mounts.iter().rev() {
            if prefix == "/" {
                continue;
            }
            if norm == prefix {
                return (prefix, mounted.as_ref(), "/".to_string());
            }
            if let Some(rest) = norm.strip_prefix(&format!("{prefix}/")) {
                return (prefix, mounted.as_ref(), format!("/{rest}"));
            }
        }
        ("/", self.root.as_ref(), norm.to_owned())
    }

    fn resolve(&self, path: &str, follow_final: bool, purpose: WalkPurpose) -> Result<String, String> {
        walk_path(path, follow_final, purpose, |p| {
            let (mount, fs, local) = self.location(p);
            (Some(mount), fs, local)
        }, |parent| self.mounts.keys().any(|m| m.strip_prefix(parent).is_some_and(|tail| tail.starts_with('/'))))
    }

    fn route(&self, path: &str, follow_final: bool) -> Result<(&dyn SafeBashFs, String), String> {
        let (_, fs, local) = self.location(&self.resolve(path, follow_final, WalkPurpose::AllowMissingParents)?);
        Ok((fs, local))
    }
}

impl SafeBashFs for MountVfs {
    fn access_path(&self, path: &str, follow_final: bool) -> Result<String, String> {
        self.resolve(path, follow_final, WalkPurpose::Access)
    }

    fn inspect_command_entry(&self, path: &str, follow: bool, syscall: &str) -> Result<(String, FileStat), String> {
        // The mount router reports traversal failures against the original request.
        let entry = self.resolve(path, follow, WalkPurpose::Access).map_err(|e| {
            let reason = if e.starts_with("EACCES:") { "EACCES: permission denied" }
                else if e.starts_with("ENOTDIR:") { "ENOTDIR: not a directory" }
                else if e.starts_with("ELOOP:") { "ELOOP: too many symbolic links encountered" }
                else if syscall == "capabilitiesFor" && e.starts_with("ENOENT:") { "ENOENT: no such file or directory" }
                else { return e };
            format!("{reason}, {syscall} '{path}'")
        })?;
        let (_, fs, local) = self.location(&entry);
        fs.lstat(&local).map(|st| (entry, st))
    }

    fn scratch_file(&self, directory: &str) -> Result<std::rc::Rc<dyn super::OpenRedirectFile>, String> {
        let (fs, local) = self.route(directory, true)?;
        fs.scratch_file(&local)
    }

    fn open_redirect_file(&self, path: &str, access: crate::vfs::RedirectAccess, create_mode: u32) -> Result<Option<std::rc::Rc<dyn crate::vfs::OpenRedirectFile>>, String> {
        let exclusive = access == super::RedirectAccess::Exclusive;
        if exclusive && (path == "/" || self.mounts.contains_key(path)) {
            return Err(format!("EBUSY: resource busy or locked, open '{path}'"));
        }
        let (fs, local) = self.route(path, !exclusive)?;
        fs.open_redirect_file(&local, access, create_mode)
    }

    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let (fs, rel) = self.route(path, true)?;
        fs.read_file(&rel)
    }

    fn open_read_file(&self, path: &str, allow_directory: bool) -> Result<Box<dyn super::FileReadHandle>, String> {
        let (fs, entry) = self.route(path, true)?;
        fs.open_read_file(&entry, allow_directory)
    }

    fn open_chunks(&self, path: &str) -> Result<super::ChunkReader<'_>, String> {
        let (fs, path) = self.route(path, true)?;
        fs.open_chunks(&path)
    }

    fn commit_file_edit(&self, path: &str, original: &FileStat, before: &[u8], after: &[u8], in_place: bool) -> Result<(), String> {
        let (_, fs, entry) = self.location(&self.resolve(path, false, WalkPurpose::Access)?);
        fs.commit_file_edit(&entry, original, before, after, in_place)
    }

    fn create_file(&self, path: &str, data: &[u8], mode: u32) -> Result<(), String> {
        let entry = self.resolve(path, false, WalkPurpose::Rename)?;
        if entry != path { return Err("EAGAIN: resolved entry changed".into()); }
        let (_, fs, rel) = self.location(&entry);
        fs.create_file(&rel, data, mode)
    }

    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        let (fs, rel) = self.route(path, true)?;
        fs.write_file(&rel, data)
    }

    fn append_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        let (fs, rel) = self.route(path, true)?;
        fs.append_file(&rel, data)
    }

    fn patch_revision(&self, path: &str) -> Result<(u64, u64), String> {
        let (_, fs, local) = self.location(path);
        fs.patch_revision(&local)
    }

    fn patch_file(&self, path: &str, bytes: Option<&[u8]>, expected: (u64, u64)) -> Result<u64, String> {
        // A patch never follows symlinks. Route the inspected lexical path, not a newly resolved alias.
        if self.mounts.keys().any(|mount| crate::vfs::is_path_within(path, mount)) {
            return Err("EBUSY: cannot patch a mount or its parent".into());
        }
        let (_, fs, local) = self.location(path);
        fs.patch_file(&local, bytes, expected)
    }

    fn replace_file_entry(&self, path: &str, data: &[u8], version: u64) -> Result<(), String> {
        let (fs, rel) = self.route(path, false)?;
        let local_version = fs.generation();
        if version != self.generation() { return Err("EAGAIN: filesystem changed before replacement".into()); }
        fs.replace_file_entry(&rel, data, local_version)
    }
    fn replace_file_entry_with_mode(&self, path: &str, data: &[u8], mode: u32, version: u64) -> Result<(), String> {
        let (fs, rel) = self.route(path, false)?;
        let local_version = fs.generation();
        if version != self.generation() { return Err("EAGAIN: filesystem changed before replacement".into()); }
        fs.replace_file_entry_with_mode(&rel, data, mode, local_version)
    }

    fn publish_file(
        &self,
        path: &str,
        data: &[u8],
        inputs: &[String],
        version: u64,
    ) -> Result<u64, String> {
        let (fs, rel) = self.route(path, false)?;
        let inner_version = fs.generation();
        if version != self.generation() {
            return Err("EAGAIN: filesystem changed before publication".into());
        }
        let mut local_inputs = Vec::new();
        for input in inputs {
            let (source, local) = self.route(input, true)?;
            if std::ptr::addr_eq(source, fs) {
                local_inputs.push(local);
            }
        }
        fs.publish_file(&rel, data, &local_inputs, inner_version)
    }

    fn remove_published(&self, path: &str, publication: u64) -> Result<bool, String> {
        let (fs, rel) = self.route(path, false)?;
        fs.remove_published(&rel, publication)
    }

    fn move_across_devices(&self, source: &str, destination: &str, budget: Option<&crate::ExecutionBudget>) -> Result<(), String> {
        // Bind path resolution to the two backing-store versions inspected under the transfer locks.
        let versions: BTreeMap<_, _> = std::iter::once(("/", self.root.generation()))
            .chain(self.mounts.iter().map(|(m, fs)| (m.as_str(), fs.generation()))).collect();
        let from = self.resolve(source, false, WalkPurpose::Rename)?;
        let to = self.resolve(destination, false, WalkPurpose::Rename)?;
        if self.mounts.keys().any(|m| [from.as_str(), to.as_str()].iter().any(|p| crate::vfs::is_path_within(p, m))) {
            return Err("EBUSY: resource busy or locked".into());
        }
        let (src_mount, src, src_path) = self.location(&from);
        let (dst_mount, dst, dst_path) = self.location(&to);
        let Some(src) = src.memory_backend() else { return Err(format!("ENOTSUP: operation not supported, removeEntryConditional '{source}'")); };
        let Some(dst) = dst.memory_backend() else { return Err(format!("ENOTSUP: operation not supported, mv '{destination}'")); };
        src.transfer_to(dst, (&src_path, source, versions[src_mount]), (&dst_path, destination, versions[dst_mount]), budget)
    }

    fn rename(&self, source: &str, destination: &str, no_replace: bool) -> Result<(), String> {
        let reason = |e: String| e.split_once(", ").map_or(e.as_str(), |(code, _)| code).to_owned();
        let from = self.resolve(source, false, WalkPurpose::Rename).map_err(reason)?;
        let to = self.resolve(destination, false, WalkPurpose::Rename).map_err(reason)?;
        if self.mounts.keys().any(|m| [from.as_str(), to.as_str()].iter().any(|p| crate::vfs::is_path_within(p, m))) {
            return Err("EBUSY: resource busy or locked".into());
        }
        let (mount, fs, mut src) = self.location(&from);
        let (other, _, mut dest) = self.location(&to);
        if mount != other {
            let st = fs.lstat(&src).map_err(reason)?;
            if source.ends_with('/') && st.kind != crate::vfs::VfsEntryKind::Directory {
                return Err("ENOTDIR: not a directory".into());
            }
            return Err("EXDEV: cross-device link not permitted".into());
        }
        if source.ends_with('/') { src.push('/'); }
        if destination.ends_with('/') { dest.push('/'); }
        fs.rename(&src, &dest, no_replace)
    }

    fn remove_one(&self, path: &str, directory: bool) -> Result<(), String> {
        let entry = self.resolve(path, false, WalkPurpose::Rename)?;
        if self.mounts.keys().any(|m| crate::vfs::is_path_within(&entry, m)) {
            return Err("EBUSY: resource busy or locked".into());
        }
        let (_, fs, mut local) = self.location(&entry);
        if path.ends_with('/') { local.push('/'); }
        fs.remove_one(&local, directory)
    }

    fn remove_path(&self, path: &str) -> Result<(), String> {
        let resolved = self.resolve(path, false, WalkPurpose::Rename)?;
        if self
            .mounts
            .keys()
            .any(|m| crate::vfs::is_path_within(&resolved, m))
        {
            return Err("EBUSY: cannot remove a mount or its parent".into());
        }
        let (_, fs, mut rel) = self.location(&resolved);
        if path.ends_with('/') { rel.push('/'); }
        fs.remove_path(&rel)
    }

    fn mkdir(&self, path: &str, recursive: bool, mode: u32) -> Result<(), (String, String)> {
        super::mkdir::mkdir(path, recursive, mode, super::mkdir::Namespace::Mounted, |p| {
            let (prefix, fs, local) = self.location(p);
            (Some(prefix), fs, local)
        })
    }

    fn mkdir_one(&self, path: &str, mode: u32) -> Result<(), String> {
        let p = self.resolve(path, false, WalkPurpose::Access)?;
        let (_, fs, local) = self.location(&p);
        fs.mkdir_one(&local, mode)
    }

    fn mkdir_all(&self, path: &str) -> Result<(), String> {
        let (fs, rel) = self.route(path, true)?;
        fs.mkdir_all(&rel)
    }

    fn exists(&self, path: &str) -> bool {
        self.route(path, true)
            .is_ok_and(|(fs, rel)| fs.exists(&rel))
    }

    fn is_dir(&self, path: &str) -> bool {
        self.route(path, true)
            .is_ok_and(|(fs, rel)| fs.is_dir(&rel))
    }

    fn list_dir(&self, path: &str) -> Result<Vec<String>, String> {
        let parent = self.resolve(path, true, WalkPurpose::AllowMissingParents)?;
        let (_, fs, rel) = self.location(&parent);
        let mut entries = fs.list_dir(&rel)?;
        for mount in self.mounts.keys() {
            if crate::vfs::parent_posix_path(mount).as_deref() == Some(&parent) {
                let name = crate::vfs::basename_posix_path(mount);
                if !entries.contains(&name) {
                    entries.push(name);
                }
            }
        }
        Ok(entries)
    }

    fn directory_entries(&self, path: &str, limit: usize) -> Result<Vec<(String, u32)>, String> {
        let parent = self.resolve(path, true, WalkPurpose::Access)?;
        let (_, fs, rel) = self.location(&parent);
        let mut entries = fs.directory_entries(&rel, limit)?;
        for mount in self.mounts.keys() {
            if let Some(suffix) = mount.strip_prefix(&format!("{}/", parent.trim_end_matches('/')))
                && let Some(name) = suffix.split('/').next() {
                if let Some((_, mode)) = entries.iter_mut().find(|(n, _)| n == name) { *mode = 0o040000; }
                else if entries.len() == limit { return Err("EFBIG: directory entry limit exceeded".into()); }
                else { entries.push((name.to_owned(), 0o040000)); }
            }
        }
        Ok(entries)
    }

    fn supports_hard_links(&self, path: &str) -> bool {
        self.route(path, false).is_ok_and(|(fs, local)| fs.supports_hard_links(&local))
    }

    fn hard_link(&self, source: &str, destination: &str) -> Result<(), String> {
        let from_path = self.access_path(source, false)?;
        let (mount, fs, from) = self.location(&from_path);
        fs.lstat(&from)?;
        let to_path = self.access_path(destination, false)?;
        if [&from_path, &to_path].into_iter().any(|p| p == "/" || self.mounts.keys().any(|m| super::is_path_within(p, m))) {
            return Err("EBUSY: resource busy or locked".into());
        }
        let (other, _, to) = self.location(&to_path);
        if mount != other { return Err("EXDEV: cross-device link not permitted".into()); }
        fs.hard_link(&from, &to)
    }

    fn symlink(&self, target: &str, path: &str) -> Result<(), String> {
        let (fs, rel) = self.route(path, false)?;
        fs.symlink(target, &rel)
    }

    fn readlink(&self, path: &str) -> Result<String, String> {
        let (fs, rel) = self.route(path, false)?;
        fs.readlink(&rel)
    }

    fn stat(&self, path: &str) -> Result<FileStat, String> {
        let (fs, rel) = self.route(path, true)?;
        fs.stat(&rel)
    }

    fn lstat(&self, path: &str) -> Result<FileStat, String> {
        let (fs, rel) = self.route(path, false)?;
        fs.lstat(&rel)
    }

    fn chmod(&self, path: &str, mode: u32) -> Result<(), String> {
        let (fs, rel) = self.route(path, true)?;
        fs.chmod(&rel, mode)
    }

    fn set_times(&self, path: &str, atime_ms: Option<f64>, mtime_ms: Option<f64>) -> Result<(), String> {
        let (fs, rel) = self.route(path, true)?;
        fs.set_times(&rel, atime_ms, mtime_ms)
    }

    fn generation(&self) -> u64 {
        let mut g = self.root.generation();
        for m in self.mounts.values() {
            g = g.wrapping_mul(31).wrapping_add(m.generation());
        }
        g
    }

    fn export_entries(&self) -> Result<Vec<VfsFileEntry>, String> {
        let mut entries = self.root.export_entries()?;
        entries.retain(|e| self.location(&e.path).0 == "/");
        for (prefix, mounted) in &self.mounts {
            for mut entry in mounted.export_entries()? {
                entry.path = if entry.path == "/" {
                    prefix.clone()
                } else {
                    format!("{prefix}{}", entry.path)
                };
                if self.location(&entry.path).0 == prefix {
                    entries.push(entry);
                }
            }
        }
        Ok(entries)
    }

    fn replace_entries(&self, entries: &[VfsFileEntry]) -> Result<(), String> {
        if !self.mounts.is_empty() {
            return Err("ENOTSUP: cannot replace a mounted namespace with a flat snapshot".into());
        }
        self.root.replace_entries(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::MemoryVfs;

    #[test]
    fn separate_filesystems_allocate_inodes_locally_and_snapshot_links_stay_separate() {
        let root = Arc::new(MemoryVfs::new());
        let mounted = Arc::new(MemoryVfs::new());
        for (fs, bytes) in [(&root, b"A"), (&mounted, b"B")] {
            fs.write_file("/f", bytes).unwrap();
            fs.hard_link("/f", "/alias").unwrap();
            let Some(crate::vfs::EntryIdentity::Memory(_, ino)) = fs.stat("/f").unwrap().identity else { panic!() };
            assert_eq!(ino, 2);
            assert_ne!(fs.stat("/f").unwrap().identity, fs.stat("/dev/null").unwrap().identity);
            assert_eq!(fs.stat("/dev/null").unwrap().nlink, Some(1));
        }
        let fs = MountVfs::new(root).with_mount("/mnt", mounted);
        let restored = MemoryVfs::new();
        restored.replace_entries(&fs.export_entries().unwrap()).unwrap();
        restored.write_file("/alias", b"C").unwrap();
        assert_eq!(restored.read_file("/f").unwrap(), b"C");
        assert_eq!(restored.read_file("/mnt/alias").unwrap(), b"B");
    }

    #[test]
    fn snapshots_exclude_covered_files_and_cannot_overwrite_the_backing_tree() {
        let root = Arc::new(MemoryVfs::new());
        root.write_file("/data/m/covered", b"hidden").unwrap();
        let mounted = Arc::new(MemoryVfs::new());
        mounted.write_file("/shown", b"visible").unwrap();
        let fs = MountVfs::new(root.clone()).with_mount("/data/m", mounted);
        let snapshot = fs.export_entries().unwrap();
        assert!(!snapshot.iter().any(|e| e.path == "/data/m/covered"));
        assert!(snapshot.iter().any(|e| e.path == "/data/m/shown"));
        assert!(fs.replace_entries(&snapshot).is_err());
        assert!(fs.remove_path("/data").is_err());
        assert_eq!(root.read_file("/data/m/covered").unwrap(), b"hidden");
    }

    #[test]
    fn symlinks_cannot_cross_into_covering_or_nested_mounts() {
        let root = Arc::new(MemoryVfs::new());
        let upper = Arc::new(MemoryVfs::new());
        root.write_file("/mnt/private", b"covered").unwrap();
        root.symlink("/mnt", "/alias").unwrap();
        root.symlink("/mnt/private", "/file-link").unwrap();
        upper
            .write_file("/nested/private", b"also covered")
            .unwrap();
        upper.symlink("/nested/private", "/nested-link").unwrap();
        upper.write_file("/visible", b"ok").unwrap();
        upper.symlink("/visible", "/ok").unwrap();
        let fs = MountVfs::new(root.clone())
            .with_mount("/mnt", upper)
            .with_mount("/mnt/nested", Arc::new(MemoryVfs::new()));
        for path in ["/file-link", "/alias/private", "/mnt/nested-link"] {
            assert!(
                fs.read_file(path).unwrap_err().starts_with("EACCES"),
                "{path}"
            );
            assert!(fs.write_file(path, b"overwritten").is_err());
        }
        assert_eq!(fs.read_file("/mnt/ok").unwrap(), b"ok");
        assert_eq!(fs.readlink("/file-link").unwrap(), "/mnt/private");
        fs.remove_path("/file-link").unwrap();
        assert_eq!(root.read_file("/mnt/private").unwrap(), b"covered");
    }

    #[test]
    fn mount_vfs_routes_longest_prefix_and_exports_combined_tree() {
        let root = Arc::new(MemoryVfs::new());
        let mnt = Arc::new(MemoryVfs::new());
        root.mkdir_all("/mnt/data").unwrap();
        let fs = MountVfs::new(root.clone()).with_mount("/mnt/data", mnt.clone());

        fs.write_file("/root.txt", b"in-root").unwrap();
        fs.write_file("/mnt/data/nested.txt", b"in-mount").unwrap();

        assert_eq!(root.read_file("/root.txt").unwrap(), b"in-root");
        assert!(!root.exists("/mnt/data/nested.txt"));
        assert_eq!(mnt.read_file("/nested.txt").unwrap(), b"in-mount");
        assert_eq!(fs.read_file("/mnt/data/nested.txt").unwrap(), b"in-mount");
    }

    #[test]
    fn mount_vfs_nested_mounts_and_directory_listing() {
        let root = Arc::new(MemoryVfs::new());
        let m1 = Arc::new(MemoryVfs::new());
        let m2 = Arc::new(MemoryVfs::new());
        root.mkdir_all("/mnt/a/b").unwrap();
        let fs = MountVfs::new(root.clone())
            .with_mount("/mnt/a", m1.clone())
            .with_mount("/mnt/a/b", m2.clone());

        fs.write_file("/mnt/a/f1.txt", b"m1-val").unwrap();
        fs.write_file("/mnt/a/b/f2.txt", b"m2-val").unwrap();
        assert_eq!(m1.read_file("/f1.txt").unwrap(), b"m1-val");
        assert_eq!(m2.read_file("/f2.txt").unwrap(), b"m2-val");
        let exported = fs.export_entries().unwrap();
        assert!(exported.iter().any(|e| e.path == "/mnt/a/f1.txt"));
        assert!(exported.iter().any(|e| e.path == "/mnt/a/b/f2.txt"));
    }

    #[test]
    fn mount_vfs_stat_and_remove_route_to_mounted_fs() {
        let root = Arc::new(MemoryVfs::new());
        let mnt = Arc::new(MemoryVfs::new());
        root.mkdir_all("/mnt").unwrap();
        let fs = MountVfs::new(root).with_mount("/mnt", mnt.clone());
        fs.write_file("/mnt/temp.txt", b"1234").unwrap();
        assert_eq!(fs.stat("/mnt/temp.txt").unwrap().size, 4);
        fs.remove("/mnt/temp.txt", false).unwrap();
        assert!(!mnt.exists("/temp.txt"));
    }
}
