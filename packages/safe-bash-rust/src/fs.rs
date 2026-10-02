use git_rust::{MemoryFs, mkdirp};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VfsEntryKind {
    File,
    Directory,
    Symlink,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VfsFileEntry {
    pub path: String,
    pub kind: VfsEntryKind,
    pub data: Vec<u8>,
    pub symlink_target: Option<String>,
    pub mode: u32,
}

pub trait SafeBashFs: Send + Sync {
    fn read_file(&self, path: &str) -> Result<Vec<u8>, String>;
    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String>;
    fn remove_path(&self, path: &str) -> Result<(), String>;
    fn mkdir_all(&self, path: &str) -> Result<(), String>;
    fn exists(&self, path: &str) -> bool;
    fn is_dir(&self, path: &str) -> bool;
    fn list_dir(&self, path: &str) -> Result<Vec<String>, String>;
    fn symlink(&self, target: &str, path: &str) -> Result<(), String>;
    fn readlink(&self, path: &str) -> Result<String, String>;
    fn export_entries(&self) -> Result<Vec<VfsFileEntry>, String>;
    fn replace_entries(&self, entries: &[VfsFileEntry]) -> Result<(), String>;
}

#[derive(Clone, Default)]
pub struct MemoryVfs {
    inner: MemoryFs,
}

pub fn normalize_posix_path(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    if parts.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", parts.join("/"))
    }
}

pub fn resolve_posix_path(cwd: &str, target: &str) -> String {
    if target.starts_with('/') {
        normalize_posix_path(target)
    } else if cwd == "/" {
        normalize_posix_path(&format!("/{target}"))
    } else {
        normalize_posix_path(&format!("{cwd}/{target}"))
    }
}

impl MemoryVfs {
    pub fn new() -> Self {
        Self {
            inner: MemoryFs::new(),
        }
    }

    pub fn from_git_fs(inner: MemoryFs) -> Self {
        Self { inner }
    }

    pub fn as_git_fs(&self) -> &MemoryFs {
        &self.inner
    }

    fn collect_entries_recursive(
        &self,
        dir: &str,
        out: &mut Vec<VfsFileEntry>,
    ) -> Result<(), String> {
        let names = self.inner.readdir(dir).map_err(|e| e.message)?;
        for name in names {
            let full = if dir == "/" {
                format!("/{name}")
            } else {
                format!("{dir}/{name}")
            };
            let stat = self.inner.lstat(&full).map_err(|e| e.message)?;
            if stat.is_directory() {
                out.push(VfsFileEntry {
                    path: full.clone(),
                    kind: VfsEntryKind::Directory,
                    data: Vec::new(),
                    symlink_target: None,
                    mode: stat.mode,
                });
                self.collect_entries_recursive(&full, out)?;
            } else if stat.is_symbolic_link() {
                let target_bytes = self.inner.readlink(&full).map_err(|e| e.message)?;
                out.push(VfsFileEntry {
                    path: full,
                    kind: VfsEntryKind::Symlink,
                    data: Vec::new(),
                    symlink_target: Some(String::from_utf8_lossy(&target_bytes).into_owned()),
                    mode: stat.mode,
                });
            } else if stat.is_file() {
                let data = self.inner.read_file(&full).map_err(|e| e.message)?;
                out.push(VfsFileEntry {
                    path: full,
                    kind: VfsEntryKind::File,
                    data,
                    symlink_target: None,
                    mode: stat.mode,
                });
            }
        }
        Ok(())
    }
}

impl SafeBashFs for MemoryVfs {
    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let norm = normalize_posix_path(path);
        self.inner.read_file(&norm).map_err(|e| e.message)
    }

    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        if let Some((parent, _)) = norm.rsplit_once('/')
            && !parent.is_empty()
        {
            mkdirp(|p| self.inner.mkdir(p), parent, 16).map_err(|e| e.message)?;
        }
        self.inner.write_file(&norm, data).map_err(|e| e.message)
    }

    fn remove_path(&self, path: &str) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        self.inner.rm(&norm).map_err(|e| e.message)
    }

    fn mkdir_all(&self, path: &str) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        mkdirp(|p| self.inner.mkdir(p), &norm, 16).map_err(|e| e.message)
    }

    fn exists(&self, path: &str) -> bool {
        let norm = normalize_posix_path(path);
        self.inner.exists(&norm)
    }

    fn is_dir(&self, path: &str) -> bool {
        let norm = normalize_posix_path(path);
        self.inner
            .stat(&norm)
            .map(|s| s.is_directory())
            .unwrap_or(false)
    }

    fn list_dir(&self, path: &str) -> Result<Vec<String>, String> {
        let norm = normalize_posix_path(path);
        self.inner.readdir(&norm).map_err(|e| e.message)
    }

    fn symlink(&self, target: &str, path: &str) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        if let Some((parent, _)) = norm.rsplit_once('/')
            && !parent.is_empty()
        {
            mkdirp(|p| self.inner.mkdir(p), parent, 16).map_err(|e| e.message)?;
        }
        self.inner.symlink(target, &norm).map_err(|e| e.message)
    }

    fn readlink(&self, path: &str) -> Result<String, String> {
        let norm = normalize_posix_path(path);
        let bytes = self.inner.readlink(&norm).map_err(|e| e.message)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    fn export_entries(&self) -> Result<Vec<VfsFileEntry>, String> {
        let mut out = Vec::new();
        self.collect_entries_recursive("/", &mut out)?;
        Ok(out)
    }

    fn replace_entries(&self, entries: &[VfsFileEntry]) -> Result<(), String> {
        let mut existing = self.export_entries()?;
        existing.sort_by_key(|a| std::cmp::Reverse(a.path.len()));
        for item in existing {
            match item.kind {
                VfsEntryKind::Directory => {
                    let _ = self.inner.rmdir(&item.path);
                }
                VfsEntryKind::File | VfsEntryKind::Symlink => {
                    let _ = self.remove_path(&item.path);
                }
            }
        }
        for entry in entries {
            if entry.kind == VfsEntryKind::Directory {
                self.mkdir_all(&entry.path)?;
            }
        }
        for entry in entries {
            if entry.kind == VfsEntryKind::File {
                self.write_file(&entry.path, &entry.data)?;
            }
        }
        for entry in entries {
            if entry.kind == VfsEntryKind::Symlink
                && let Some(target) = entry.symlink_target.as_deref()
            {
                self.symlink(target, &entry.path)?;
            }
        }
        Ok(())
    }
}
