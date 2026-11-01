pub mod memory;
mod mkdir;
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

pub(crate) fn now_ms() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        #[link(wasm_import_module = "safe_bash")]
        unsafe extern "C" { fn wall_clock_ms() -> f64; }
        unsafe { wall_clock_ms() }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now().duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as f64).unwrap_or_else(|e| -(e.duration().as_millis() as f64))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VfsEntryKind {
    File,
    Directory,
    Symlink,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum EntryIdentity {
    Memory(u64, u64),
    Unix(u64, u64),
    OverlayDirectory { scope: u64, dev: u64, ino: u64 },
}

impl EntryIdentity {
    pub(crate) fn same_filesystem(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Memory(a, _), Self::Memory(b, _)) | (Self::Unix(a, _), Self::Unix(b, _)) => a == b,
            (Self::OverlayDirectory { scope: a, .. }, Self::OverlayDirectory { scope: b, .. }) => a == b,
            _ => false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct FileStat {
    pub nlink: usize,
    pub allocated_bytes: Option<u64>,
    pub identity: Option<EntryIdentity>,
    pub kind: VfsEntryKind,
    pub size: usize,
    pub mode: u32,
    pub atime_ms: f64,
    pub mtime_ms: f64,
    pub ctime_ms: Option<f64>,
    pub birthtime_ms: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VfsFileEntry {
    pub path: String,
    pub kind: VfsEntryKind,
    pub data: std::sync::Arc<[u8]>,
    /// Names with the same group in one snapshot share an inode.
    pub link_group: Option<u64>,
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
    /// Resolve and validate parents in traversal order. The final entry may be missing.
    fn access_path(&self, path: &str, follow_final: bool) -> Result<String, String> {
        path::walk_path(path, follow_final, path::WalkPurpose::Access, |p| (None, self, p.to_owned()))
    }

    /// Inspect a shell operand without collapsing unsearched ancestors or trailing slashes.
    fn inspect_command_entry(&self, path: &str, follow: bool, _syscall: &str) -> Result<(String, FileStat), String> {
        let entry = self.access_path(path, follow)?;
        self.lstat(&entry).map(|st| (entry, st))
    }

    fn read_file(&self, path: &str) -> Result<Vec<u8>, String>;
    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String>;
    /// Create at the resolved entry with the requested mode. An occupied name is never followed or overwritten.
    fn create_file(&self, _path: &str, _data: &[u8], _mode: u32) -> Result<(), String> {
        Err("ENOTSUP: exclusive file creation is unsupported".into())
    }
    /// Filesystem identity and revision covering a patch target and its local ancestors.
    fn patch_revision(&self, _path: &str) -> Result<(u64, u64), String> {
        Err("filesystem does not support race-safe patch mutations".into())
    }
    /// Replace or unlink a regular file only at the inspected revision. Return the revision after this change.
    fn patch_file(&self, _path: &str, _bytes: Option<&[u8]>, _expected: (u64, u64)) -> Result<u64, String> {
        Err("filesystem does not support race-safe patch mutations".into())
    }
    /// Publish without following a final symlink, replacing an input, or committing after a concurrent mutation.
    fn publish_file(&self, _path: &str, _data: &[u8], _inputs: &[String], _version: u64) -> Result<u64, String> {
        Err("UNSUPPORTED_CAPABILITY: VFS requires conditional file publication".into())
    }
    /// Remove only the file version returned by publish_file. A replacement is left intact.
    fn remove_published(&self, _path: &str, _publication: u64) -> Result<bool, String> {
        Err("UNSUPPORTED_CAPABILITY: VFS requires conditional file removal".into())
    }
    fn memory_backend(&self) -> Option<&MemoryVfs> { None }

    fn move_across_devices(&self, source: &str, _destination: &str, _budget: Option<&crate::ExecutionBudget>) -> Result<(), String> {
        Err(format!("ENOTSUP: operation not supported, removeEntryConditional '{source}'"))
    }

    fn rename(&self, _source: &str, _destination: &str, _no_replace: bool) -> Result<(), String> {
        Err("ENOTSUP: operation not supported".into())
    }
    fn remove_path(&self, path: &str) -> Result<(), String>;
    /// Unlink one file or remove one empty directory, without following the final entry.
    fn remove_one(&self, _path: &str, _directory: bool) -> Result<(), String> {
        Err("ENOTSUP: operation not supported".into())
    }
    fn mkdir(&self, path: &str, recursive: bool, mode: u32) -> Result<(), (String, String)> {
        mkdir::mkdir(path, recursive, mode, mkdir::Namespace::Direct, |p| (None, self, p.to_owned()))
    }

    /// Create one new directory. Never change an existing entry's permissions.
    fn mkdir_one(&self, _path: &str, _mode: u32) -> Result<(), String> {
        Err("ENOTSUP: operation not supported".into())
    }
    fn mkdir_all(&self, path: &str) -> Result<(), String>;
    fn exists(&self, path: &str) -> bool;
    fn is_dir(&self, path: &str) -> bool;
    /// Literal directory-entry lookup when a link-free memory index is available.
    /// The caller has already resolved the parent and checked traversal access.
    fn indexed_directory_entry(&self, _path: &str) -> Option<bool> { None }
    fn list_dir(&self, path: &str) -> Result<Vec<String>, String>;
    /// Read names and no-follow file type bits from a resolved, readable directory.
    fn directory_entries(&self, path: &str, limit: usize) -> Result<Vec<(String, u32)>, String> {
        let names = self.list_dir(path)?;
        if names.len() > limit { return Err("EFBIG: directory entry limit exceeded".into()); }
        names.into_iter().map(|name| {
            let mode = self.lstat(&format!("{}/{name}", path.trim_end_matches('/')))?.mode;
            Ok((name, mode & 0o170000))
        }).collect()
    }
    fn supports_hard_links(&self, _path: &str) -> bool { false }
    /// Create a second name for the source inode without following its final symlink.
    fn hard_link(&self, _source: &str, _destination: &str) -> Result<(), String> {
        Err("ENOTSUP: operation not supported".into())
    }
    fn symlink(&self, target: &str, path: &str) -> Result<(), String>;
    fn readlink(&self, path: &str) -> Result<String, String>;
    fn export_entries(&self) -> Result<Vec<VfsFileEntry>, String>;
    fn replace_entries(&self, entries: &[VfsFileEntry]) -> Result<(), String>;

    fn shell_limits(&self) -> crate::budget::ShellLimits {
        crate::budget::ShellLimits::default()
    }

    fn max_input_bytes(&self) -> usize {
        crate::budget::ShellLimits::default().max_input_bytes
    }

    fn read_dir(&self, path: &str) -> Result<Vec<String>, String> {
        self.list_dir(path)
    }

    fn remove(&self, path: &str, recursive: bool) -> Result<(), String> {
        if recursive { self.remove_path(path) } else { self.remove_one(path, false) }
    }

    fn append_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        let mut cur = match self.read_file(path) {
            Ok(bytes) => bytes,
            Err(e) if e.starts_with("ENOENT:") => Vec::new(),
            Err(e) => return Err(e),
        };
        cur.extend_from_slice(data);
        self.write_file(path, &cur)
    }

    fn stat(&self, path: &str) -> Result<FileStat, String> {
        let norm = normalize_posix_path(path);
        if self.is_dir(&norm) {
            return Ok(FileStat {
                nlink: 1,
                identity: None,
                allocated_bytes: None,
                kind: VfsEntryKind::Directory,
                size: 0,
                mode: 0o40755,
                atime_ms: 1_700_000_000_000.0,
                mtime_ms: 1_700_000_000_000.0,
                ctime_ms: None, birthtime_ms: None,
            });
        }
        if let Ok(data) = self.read_file(&norm) {
            return Ok(FileStat {
                nlink: 1,
                identity: None,
                allocated_bytes: None,
                kind: VfsEntryKind::File,
                size: data.len(),
                mode: 0o100644,
                atime_ms: 1_700_000_000_000.0,
                mtime_ms: 1_700_000_000_000.0,
                ctime_ms: None, birthtime_ms: None,
            });
        }
        Err(format!("ENOENT: no such file or directory, stat '{norm}'"))
    }

    fn lstat(&self, path: &str) -> Result<FileStat, String> {
        let norm = normalize_posix_path(path);
        if let Ok(target) = self.readlink(&norm) {
            return Ok(FileStat {
                nlink: 1,
                identity: None,
                allocated_bytes: None,
                kind: VfsEntryKind::Symlink,
                size: target.len(),
                mode: 0o120777,
                atime_ms: 1_700_000_000_000.0,
                mtime_ms: 1_700_000_000_000.0,
                ctime_ms: None, birthtime_ms: None,
            });
        }
        self.stat(&norm)
    }

    fn chmod(&self, _path: &str, _mode: u32) -> Result<(), String> {
        Ok(())
    }

    fn set_mtime(&self, path: &str, mtime_ms: u64) -> Result<(), String> {
        self.set_times(path, None, Some(mtime_ms as f64))
    }

    fn set_times(&self, _path: &str, _atime_ms: Option<f64>, _mtime_ms: Option<f64>) -> Result<(), String> {
        Err("ENOTSUP: setting timestamps is unsupported".into())
    }

    fn generation(&self) -> u64 {
        0
    }

    fn fs_id(&self) -> u64 {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unreadable_file_cannot_be_replaced_by_a_fallback_append() {
        struct WriteOnly;
        impl SafeBashFs for WriteOnly {
            fn read_file(&self, _: &str) -> Result<Vec<u8>, String> { Err("EACCES: permission denied".into()) }
            fn write_file(&self, _: &str, _: &[u8]) -> Result<(), String> { panic!("append overwrote unreadable bytes") }
            fn mkdir_all(&self, _: &str) -> Result<(), String> { unreachable!() }
            fn remove_path(&self, _: &str) -> Result<(), String> { unreachable!() }
            fn exists(&self, _: &str) -> bool { true }
            fn is_dir(&self, _: &str) -> bool { false }
            fn list_dir(&self, _: &str) -> Result<Vec<String>, String> { unreachable!() }
            fn symlink(&self, _: &str, _: &str) -> Result<(), String> { unreachable!() }
            fn readlink(&self, _: &str) -> Result<String, String> { unreachable!() }
            fn export_entries(&self) -> Result<Vec<VfsFileEntry>, String> { unreachable!() }
            fn replace_entries(&self, _: &[VfsFileEntry]) -> Result<(), String> { unreachable!() }
        }
        assert_eq!(WriteOnly.append_file("/log", b"tail").unwrap_err(), "EACCES: permission denied");
    }

    #[test]
    fn unit_stream_string_arbitrary_byte_roundtrip_and_fs_error() {
        let all_bytes: Vec<u8> = (0u8..=255u8).collect();
        let encoded = bytes_to_stream_string(&all_bytes);
        let decoded = stream_string_to_bytes(&encoded);
        assert_eq!(decoded, all_bytes);

        let utf8_bytes = "hello 🌍".as_bytes();
        let utf8_str = bytes_to_stream_string(utf8_bytes);
        assert_eq!(utf8_str, "hello 🌍");
        assert_eq!(stream_string_to_bytes(&utf8_str), utf8_bytes);

        let err = FsError::new(FsErrorCode::NotFound, "No such file");
        assert_eq!(err.code, FsErrorCode::NotFound);
        assert_eq!(err.message, "No such file");
    }

    #[test]
    fn unit_mixed_ascii_and_high_byte_stream_string_preservation() {
        let mixed = b"header\x00\x7f\x80\xfe\xfftrailer\n";
        let s = bytes_to_stream_string(mixed);
        let roundtrip = stream_string_to_bytes(&s);
        assert_eq!(roundtrip, mixed);
    }

    #[test]
    fn unit_fs_error_display_and_codes() {
        let e1 = FsError::new(FsErrorCode::PermissionDenied, "Permission denied");
        assert!(format!("{e1:?}").contains("Permission denied"));
        let e2 = FsError::new(FsErrorCode::AlreadyExists, "File exists");
        assert_eq!(e2.code, FsErrorCode::AlreadyExists);
    }
}
