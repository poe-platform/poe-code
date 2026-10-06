use crate::vfs::path::normalize_posix_path;
use crate::vfs::{FileStat, SafeBashFs, VfsFileEntry};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, RwLock};

#[derive(Clone)]
pub struct OverlayVfs {
    lower: Arc<dyn SafeBashFs>,
    upper: Arc<dyn SafeBashFs>,
    whiteouts: Arc<RwLock<BTreeSet<String>>>,
}

impl OverlayVfs {
    pub fn new(lower: Arc<dyn SafeBashFs>, upper: Arc<dyn SafeBashFs>) -> Self {
        Self {
            lower,
            upper,
            whiteouts: Arc::new(RwLock::new(BTreeSet::new())),
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

    fn clear_whiteout(&self, norm: &str) {
        if let Ok(mut guard) = self.whiteouts.write() {
            guard.remove(norm);
        }
    }
}

impl SafeBashFs for OverlayVfs {
    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let norm = normalize_posix_path(path);
        if self.upper.exists(&norm) {
            return self.upper.read_file(&norm);
        }
        if self.is_deleted(&norm) {
            return Err(format!("ENOENT: no such file or directory, open '{norm}'"));
        }
        self.lower.read_file(&norm)
    }

    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        self.clear_whiteout(&norm);
        self.upper.write_file(&norm, data)
    }

    fn remove_path(&self, path: &str) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        let existed = self.exists(&norm);
        if !existed {
            return Err(format!("ENOENT: no such file or directory, unlink '{norm}'"));
        }
        let _ = self.upper.remove_path(&norm);
        if let Ok(mut guard) = self.whiteouts.write() {
            guard.insert(norm);
        }
        Ok(())
    }

    fn mkdir_all(&self, path: &str) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        self.clear_whiteout(&norm);
        self.upper.mkdir_all(&norm)
    }

    fn exists(&self, path: &str) -> bool {
        let norm = normalize_posix_path(path);
        if self.upper.exists(&norm) {
            return true;
        }
        if self.is_deleted(&norm) {
            return false;
        }
        self.lower.exists(&norm)
    }

    fn is_dir(&self, path: &str) -> bool {
        let norm = normalize_posix_path(path);
        if self.upper.exists(&norm) {
            return self.upper.is_dir(&norm);
        }
        if self.is_deleted(&norm) {
            return false;
        }
        self.lower.is_dir(&norm)
    }

    fn list_dir(&self, path: &str) -> Result<Vec<String>, String> {
        let norm = normalize_posix_path(path);
        if !self.is_dir(&norm) {
            return Err(format!("ENOENT: no such file or directory, scandir '{norm}'"));
        }
        let mut names = BTreeSet::new();
        if !self.is_deleted(&norm)
            && let Ok(lower_entries) = self.lower.list_dir(&norm)
        {
            for name in lower_entries {
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
        if let Ok(upper_entries) = self.upper.list_dir(&norm) {
            for name in upper_entries {
                names.insert(name);
            }
        }
        Ok(names.into_iter().collect())
    }

    fn symlink(&self, target: &str, path: &str) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        self.clear_whiteout(&norm);
        self.upper.symlink(target, &norm)
    }

    fn readlink(&self, path: &str) -> Result<String, String> {
        let norm = normalize_posix_path(path);
        if self.upper.exists(&norm) {
            return self.upper.readlink(&norm);
        }
        if self.is_deleted(&norm) {
            return Err(format!("ENOENT: no such file or directory, readlink '{norm}'"));
        }
        self.lower.readlink(&norm)
    }

    fn stat(&self, path: &str) -> Result<FileStat, String> {
        let norm = normalize_posix_path(path);
        if self.upper.exists(&norm) {
            return self.upper.stat(&norm);
        }
        if self.is_deleted(&norm) {
            return Err(format!("ENOENT: no such file or directory, stat '{norm}'"));
        }
        self.lower.stat(&norm)
    }

    fn lstat(&self, path: &str) -> Result<FileStat, String> {
        let norm = normalize_posix_path(path);
        if self.upper.exists(&norm) {
            return self.upper.lstat(&norm);
        }
        if self.is_deleted(&norm) {
            return Err(format!("ENOENT: no such file or directory, lstat '{norm}'"));
        }
        self.lower.lstat(&norm)
    }

    fn chmod(&self, path: &str, mode: u32) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        if !self.upper.exists(&norm) {
            if self.is_deleted(&norm) || !self.lower.exists(&norm) {
                return Err(format!("ENOENT: no such file or directory, chmod '{norm}'"));
            }
            if self.lower.is_dir(&norm) {
                self.upper.mkdir_all(&norm)?;
            } else {
                let bytes = self.lower.read_file(&norm)?;
                self.upper.write_file(&norm, &bytes)?;
            }
        }
        self.upper.chmod(&norm, mode)
    }

    fn generation(&self) -> u64 {
        self.lower
            .generation()
            .wrapping_mul(31)
            .wrapping_add(self.upper.generation())
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
        self.upper.replace_entries(entries)
    }
}
