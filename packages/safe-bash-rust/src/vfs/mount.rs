use crate::vfs::path::normalize_posix_path;
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

    fn route<'a>(&'a self, path: &str) -> (&'a dyn SafeBashFs, String) {
        let norm = normalize_posix_path(path);
        for (prefix, mounted) in self.mounts.iter().rev() {
            if prefix == "/" {
                continue;
            }
            if &norm == prefix {
                return (mounted.as_ref(), "/".to_string());
            }
            if let Some(rest) = norm.strip_prefix(&format!("{prefix}/")) {
                return (mounted.as_ref(), format!("/{rest}"));
            }
        }
        (self.root.as_ref(), norm)
    }
}

impl SafeBashFs for MountVfs {
    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let (fs, rel) = self.route(path);
        fs.read_file(&rel)
    }

    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        let (fs, rel) = self.route(path);
        fs.write_file(&rel, data)
    }

    fn remove_path(&self, path: &str) -> Result<(), String> {
        let (fs, rel) = self.route(path);
        fs.remove_path(&rel)
    }

    fn mkdir_all(&self, path: &str) -> Result<(), String> {
        let (fs, rel) = self.route(path);
        fs.mkdir_all(&rel)
    }

    fn exists(&self, path: &str) -> bool {
        let (fs, rel) = self.route(path);
        fs.exists(&rel)
    }

    fn is_dir(&self, path: &str) -> bool {
        let (fs, rel) = self.route(path);
        fs.is_dir(&rel)
    }

    fn list_dir(&self, path: &str) -> Result<Vec<String>, String> {
        let (fs, rel) = self.route(path);
        fs.list_dir(&rel)
    }

    fn symlink(&self, target: &str, path: &str) -> Result<(), String> {
        let (fs, rel) = self.route(path);
        fs.symlink(target, &rel)
    }

    fn readlink(&self, path: &str) -> Result<String, String> {
        let (fs, rel) = self.route(path);
        fs.readlink(&rel)
    }

    fn stat(&self, path: &str) -> Result<FileStat, String> {
        let (fs, rel) = self.route(path);
        fs.stat(&rel)
    }

    fn lstat(&self, path: &str) -> Result<FileStat, String> {
        let (fs, rel) = self.route(path);
        fs.lstat(&rel)
    }

    fn chmod(&self, path: &str, mode: u32) -> Result<(), String> {
        let (fs, rel) = self.route(path);
        fs.chmod(&rel, mode)
    }

    fn set_mtime(&self, path: &str, mtime_ms: u64) -> Result<(), String> {
        let (fs, rel) = self.route(path);
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
        for (prefix, mounted) in &self.mounts {
            for mut entry in mounted.export_entries()? {
                entry.path = if entry.path == "/" {
                    prefix.clone()
                } else {
                    format!("{prefix}{}", entry.path)
                };
                entries.push(entry);
            }
        }
        Ok(entries)
    }

    fn replace_entries(&self, entries: &[VfsFileEntry]) -> Result<(), String> {
        self.root.replace_entries(entries)
    }
}
