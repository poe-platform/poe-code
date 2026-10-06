pub mod memory;
pub mod mount;
pub mod overlay;
pub mod path;
#[cfg(not(target_arch = "wasm32"))]
pub mod real;

pub use memory::{MemoryVfs, MemoryVfsLimits};
pub use mount::MountVfs;
pub use overlay::OverlayVfs;
pub use path::{
    basename_posix_path, dirname_posix_path, is_path_within, normalize_posix_path,
    parent_posix_path, resolve_posix_path,
};
#[cfg(not(target_arch = "wasm32"))]
pub use real::RealVfs;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VfsEntryKind {
    File,
    Directory,
    Symlink,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileStat {
    pub kind: VfsEntryKind,
    pub size: usize,
    pub mode: u32,
    pub mtime_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VfsFileEntry {
    pub path: String,
    pub kind: VfsEntryKind,
    pub data: Vec<u8>,
    pub symlink_target: Option<String>,
    pub mode: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FsErrorCode {
    NotFound,
    AlreadyExists,
    IsDirectory,
    NotDirectory,
    PermissionDenied,
    ReadOnly,
    NoSpace,
    InvalidInput,
    Loop,
    Io,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FsError {
    pub code: FsErrorCode,
    pub message: String,
}

impl FsError {
    pub fn new(code: FsErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
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

    fn read_dir(&self, path: &str) -> Result<Vec<String>, String> {
        self.list_dir(path)
    }

    fn remove(&self, path: &str, _recursive: bool) -> Result<(), String> {
        self.remove_path(path)
    }

    fn append_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        let mut cur = self.read_file(path).unwrap_or_default();
        cur.extend_from_slice(data);
        self.write_file(path, &cur)
    }

    fn stat(&self, path: &str) -> Result<FileStat, String> {
        let norm = normalize_posix_path(path);
        if self.is_dir(&norm) {
            return Ok(FileStat {
                kind: VfsEntryKind::Directory,
                size: 0,
                mode: 0o40755,
                mtime_ms: 1_700_000_000_000,
            });
        }
        if let Ok(data) = self.read_file(&norm) {
            return Ok(FileStat {
                kind: VfsEntryKind::File,
                size: data.len(),
                mode: 0o100644,
                mtime_ms: 1_700_000_000_000,
            });
        }
        Err(format!("ENOENT: no such file or directory, stat '{norm}'"))
    }

    fn lstat(&self, path: &str) -> Result<FileStat, String> {
        let norm = normalize_posix_path(path);
        if let Ok(target) = self.readlink(&norm) {
            return Ok(FileStat {
                kind: VfsEntryKind::Symlink,
                size: target.len(),
                mode: 0o120777,
                mtime_ms: 1_700_000_000_000,
            });
        }
        self.stat(&norm)
    }

    fn chmod(&self, _path: &str, _mode: u32) -> Result<(), String> {
        Ok(())
    }

    fn set_mtime(&self, _path: &str, _mtime_ms: u64) -> Result<(), String> {
        Ok(())
    }

    fn generation(&self) -> u64 {
        0
    }
}

pub fn bytes_to_stream_string(bytes: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        if b < 0x80 {
            out.push(b as char);
        } else {
            out.push(char::from_u32(0xE000 + b as u32).unwrap());
        }
    }
    out
}

pub fn stream_string_to_bytes(s: &str) -> Vec<u8> {
    if !s.chars().any(|c| (0xE080..=0xE0FF).contains(&(c as u32))) {
        return s.as_bytes().to_vec();
    }
    let mut out = Vec::with_capacity(s.len());
    for c in s.chars() {
        let code = c as u32;
        if (0xE080..=0xE0FF).contains(&code) {
            out.push((code - 0xE000) as u8);
        } else {
            let mut buf = [0u8; 4];
            let enc = c.encode_utf8(&mut buf);
            out.extend_from_slice(enc.as_bytes());
        }
    }
    out
}
