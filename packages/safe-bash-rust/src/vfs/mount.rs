use crate::vfs::path::{dirname_posix_path, normalize_posix_path};
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

    // Absolute link targets are rooted at their own mount. Once a link is
    // followed, neither ".." nor the remaining path may enter another mount.
    fn resolve(&self, path: &str, follow_final: bool) -> Result<String, String> {
        let mut current = "/".to_string();
        let mut pending: Vec<String> = path
            .split('/')
            .filter(|s| !s.is_empty())
            .rev()
            .map(str::to_owned)
            .collect();
        let mut boundary = None;
        let mut links = 0;
        while let Some(part) = pending.pop() {
            if part == "." {
                continue;
            }
            if part == ".." {
                if boundary == Some(current.as_str()) {
                    return Err("EACCES: Permission denied".into());
                }
                current = dirname_posix_path(&current);
                continue;
            }
            let candidate = format!("{}/{part}", current.trim_end_matches('/'));
            let (prefix, backend, relative) = self.location(&candidate);
            if boundary.is_some_and(|root| root != prefix) {
                return Err("EACCES: Permission denied".into());
            }
            if !follow_final && pending.is_empty() {
                return Ok(candidate);
            }
            match backend.lstat(&relative) {
                Ok(st) if st.kind == crate::vfs::VfsEntryKind::Symlink => {
                    links += 1;
                    if links > 40 {
                        return Err("ELOOP: too many symbolic links".into());
                    }
                    let target = backend.readlink(&relative)?;
                    boundary = Some(prefix);
                    if target.starts_with('/') {
                        current = prefix.to_owned();
                    }
                    pending.extend(
                        target
                            .split('/')
                            .filter(|s| !s.is_empty())
                            .rev()
                            .map(str::to_owned),
                    );
                }
                Ok(_) => current = candidate,
                Err(error) if error.starts_with("ENOENT:") || error.ends_with("(os error 2)") => {
                    current = candidate
                }
                Err(error) => return Err(error),
            }
        }
        Ok(current)
    }

    fn route(&self, path: &str, follow_final: bool) -> Result<(&dyn SafeBashFs, String), String> {
        let (_, fs, local) = self.location(&self.resolve(path, follow_final)?);
        Ok((fs, local))
    }
}

impl SafeBashFs for MountVfs {
    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let (fs, rel) = self.route(path, true)?;
        fs.read_file(&rel)
    }

    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        let (fs, rel) = self.route(path, true)?;
        fs.write_file(&rel, data)
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

    fn remove_path(&self, path: &str) -> Result<(), String> {
        let resolved = self.resolve(path, false)?;
        if self
            .mounts
            .keys()
            .any(|m| crate::vfs::is_path_within(&resolved, m))
        {
            return Err("EBUSY: cannot remove a mount or its parent".into());
        }
        let (_, fs, rel) = self.location(&resolved);
        fs.remove_path(&rel)
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
        let parent = self.resolve(path, true)?;
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

    fn set_mtime(&self, path: &str, mtime_ms: u64) -> Result<(), String> {
        let (fs, rel) = self.route(path, true)?;
        fs.set_mtime(&rel, mtime_ms)
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
