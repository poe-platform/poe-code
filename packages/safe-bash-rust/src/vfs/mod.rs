pub mod memory;
mod mkdir;
pub mod mount;
pub mod overlay;
pub mod path;
#[cfg(not(target_arch = "wasm32"))]
pub mod real;

pub use memory::{MemoryVfs, MemoryVfsLimits};
pub use mount::MountVfs;
pub use overlay::{OverlayVfs,OverlayChmodReceipt};
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
    pub revision: Option<u64>,
    pub nlink: Option<usize>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub io_block_size: Option<u64>,
    pub preferred_io_block_size: Option<u64>,
    pub filesystem_type: Option<&'static str>,
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

impl FileStat {
    pub(crate) fn same_snapshot(&self, other: &Self) -> bool {
        self.identity.is_some() && self.identity == other.identity && self.revision == other.revision
            && self.kind == other.kind && self.mode == other.mode && self.size == other.size
            && self.nlink == other.nlink && self.mtime_ms == other.mtime_ms && self.ctime_ms == other.ctime_ms
            && self.birthtime_ms == other.birthtime_ms && self.uid == other.uid && self.gid == other.gid
    }

    pub(crate) fn check_receipt(&self, expected: &Self, unchanged: bool, path: &str) -> Result<(),String> {
        let changed = || format!("EAGAIN: entry changed, fileStaging '{path}'");
        let Some(EntryIdentity::Memory(scope, _)) = expected.identity else {
            return Err("ENOTSUP: missing filesystem identity".into());
        };
        if !matches!(self.identity, Some(EntryIdentity::Memory(id,_)) if scope == id) {
            return Err("ENOTSUP: different filesystem identity".into());
        }
        if expected.identity != self.identity || expected.kind != self.kind { return Err(changed()); }
        if unchanged {
            if self.revision.is_none() || expected.revision.is_none() {
                return Err("ENOTSUP: missing file revision".into());
            }
            if expected.revision != self.revision || expected.size != self.size || expected.mode != self.mode ||
                expected.nlink != self.nlink || expected.mtime_ms != self.mtime_ms || expected.ctime_ms != self.ctime_ms {
                return Err(changed());
            }
        }
        Ok(())
    }
}

fn validate_chmod_ancestry(path: &str, mode: u32, ancestors: &[(&str, FileStat)]) -> Result<(),String> {
    let dir = dirname_posix_path(path);
    if mode > 0o7777 || path != normalize_posix_path(path) || path.contains('\0')
        || ancestors.last().map(|(p,_)|*p) != Some(dir.as_str()) {
        return Err("EINVAL: invalid chmod receipt".into());
    }
    let mut previous = "";
    for (i, (p, stat)) in ancestors.iter().enumerate() {
        if (i == 0 && *p != "/") || (i > 0 && (*p == "/" || dirname_posix_path(p) != previous))
            || stat.kind != VfsEntryKind::Directory {
            return Err("EINVAL: invalid chmod ancestry".into());
        }
        previous = p;
    }
    Ok(())
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RedirectAccess { Read, Write, Truncate, Append, Exclusive, ReadWrite }

/// An open descriptor. Its operations use the same object even if its name is replaced.
pub trait OpenRedirectFile: std::fmt::Debug {
    /// Stream reads cannot be repeated at an earlier offset.
    fn is_stream(&self) -> bool { false }
    /// None means changes outside this shell cannot be tracked.
    fn revision(&self) -> Option<u64> { None }
    fn read_at(&self, offset: usize, limit: usize) -> Result<Vec<u8>, String>;
    fn write_at(&self, offset: Option<usize>, bytes: &[u8]) -> Result<(), String>;
    fn stat(&self) -> Result<FileStat, String> { Err("ENOTSUP: operation not supported".into()) }
    fn truncate_to(&self, _len: usize) -> Result<(), String> { Err("ENOTSUP: operation not supported".into()) }
}

impl PartialEq for dyn OpenRedirectFile {
    fn eq(&self, other: &Self) -> bool { std::ptr::eq(self, other) }
}
impl Eq for dyn OpenRedirectFile {}

/// Replace the buffer with the next file chunk, or clear it at EOF.
pub type ChunkReader<'a> = Box<dyn FnMut(&mut Vec<u8>) -> Result<(), String> + 'a>;

/// Some writes the next producer chunk, None finishes, and dropping aborts.
pub type ChunkWriter<'a> = Box<dyn FnMut(Option<&[u8]>) -> Result<(), String> + 'a>;

/// Positioned reads and metadata on the same opened object, even after unlink.
pub trait FileReadHandle: Send + Sync {
    fn stat(&self) -> Result<FileStat, String>;
    fn seek_end(&self) -> Result<u64, String> { Err("ENOTSUP: operation not supported".into()) }
    fn read(&self, offset: u64, maximum: usize) -> Result<Vec<u8>, String>;
}

/// Bytes already charged by the shell that produced this redirect's data.
pub struct RedirectCharge(pub(crate) usize);

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RmdirSupport { Available, Unsupported, InspectDirectory }

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PublicationMode { Write, Rollback, Replace }

/// Keep a host's destination and parent observations alive until publication or rollback.
pub struct PublicationStamp {
    pub version:u64,
    release:Option<Box<dyn FnOnce()>>,
}
impl PublicationStamp {
    pub(crate) fn new(version:u64, release:Option<Box<dyn FnOnce()>>) -> Self { Self {version,release} }
}
impl Drop for PublicationStamp {
    fn drop(&mut self) { if let Some(release)=self.release.take() {release();} }
}

pub trait SafeBashFs: Send + Sync {
    /// Resolve and validate parents in traversal order. The final entry may be missing.
    fn access_path(&self, path: &str, follow_final: bool) -> Result<String, String> {
        path::walk_path(path, follow_final, path::WalkPurpose::Access, |p| (None, self, p.to_owned()), |_| false)
    }

    /// Resolve a command descriptor's create-if-missing capability query.
    fn command_create_path(&self, path: &str) -> Result<String, String> {
        if path.is_empty() { return Err("ENOENT: no such file or directory ''".into()); }
        let resolved = if let Some(memory) = self.memory_backend() {
            path::walk_path(path, true, path::WalkPurpose::CommandCreate, |p| (None, memory, p.to_owned()), |_| false)
        } else { self.access_path(path, true) };
        resolved.map_err(|e| {
            if let Some(parent) = e.strip_prefix("ENOENT: no such file or directory, stat ") {
                format!("ENOENT: no such file or directory, lstat {parent}")
            } else if e == "ENOTDIR: not a directory" {
                if path.ends_with('/') { format!("EISDIR: illegal operation on a directory '{path}'") }
                else { format!("{e} '{path}'") }
            } else if e.starts_with("ELOOP:") {
                format!("ELOOP: too many symbolic links encountered '{path}'")
            } else { e }
        })
    }

    /// Whether command capabilities depend on the operand’s filesystem location.
    fn has_path_capabilities(&self) -> bool { false }

    /// Inspect a shell operand without collapsing unsearched ancestors or trailing slashes.
    fn inspect_command_entry(&self, path: &str, follow: bool, _syscall: &str) -> Result<(String, FileStat), String> {
        let entry = self.access_path(path, follow)?;
        self.lstat(&entry).map(|st| (entry, st))
    }

    /// Open unnamed temporary storage in this directory. Dropping the handle releases its bytes.
    fn scratch_file(&self, _directory: &str) -> Result<std::rc::Rc<dyn OpenRedirectFile>, String> {
        Err("ENOTSUP: operation not supported".into())
    }

    /// Whether commands can request positioned descriptors at a resolved entry.
    fn supports_command_descriptor(&self, _entry: &str) -> bool { false }

    fn open_exclusive_redirect(&self, path: &str, mode: u32) -> Result<Option<crate::vfs::ChunkWriter<'static>>, String> {
        self.open_redirect_file(path, RedirectAccess::Exclusive, Some(mode))?;
        Ok(None)
    }

    /// None uses the filesystem’s path-based output or special-device operations.
    fn open_redirect_file(&self, path: &str, access: RedirectAccess, create_mode: Option<u32>) -> Result<Option<std::rc::Rc<dyn OpenRedirectFile>>, String> {
        if matches!(access, RedirectAccess::ReadWrite | RedirectAccess::Write) { Err(format!("ENOTSUP: operation not supported, open '{path}'")) }
        else {
            if access == RedirectAccess::Exclusive { self.create_file(path, &[], create_mode.ok_or("EINVAL: missing creation mode")?)?; }
            Ok(None)
        }
    }

    fn open_command_stream<'a>(&'a self, path: &str, append: bool, exclusive: bool, mode: u32, budget: Option<&'a crate::ExecutionBudget>) -> Result<ChunkWriter<'a>, String> {
        if path.is_empty() { return Err("ENOENT: no such file or directory ''".into()); }
        if let Some(b) = budget {
            // tee and its output adapter each query capabilities before access(W_OK).
            b.tick_fs_op()?; b.tick_fs_op()?; if !exclusive { b.tick_fs_op()?; }
        }
        let access = self.access_path(path, !exclusive);
        let diagnostic = |e: String, syscall: &str| {
            if e.contains(", overlay '") || e.contains(", realpath '") || e.contains(", lstat '") && e.starts_with("EACCES:") {
                e
            } else {
                format!("{}, {syscall} '{path}'", e.split(", ").next().unwrap_or(&e))
            }
        };
        if !exclusive && let Ok(entry) = &access {
            if self.lstat(entry).is_ok_and(|st| st.mode & 0o200 == 0) {
                let syscall = if self.overlay_backend().is_some() { "overlay" } else { "access" };
                return Err(format!("EACCES: permission denied, {syscall} '{entry}'"));
            }
        } else if let Err(e) = &access {
            if !e.starts_with("ENOENT:") { return Err(diagnostic(e.clone(), "access")); }
        }
        if let Some(b) = budget { b.tick_fs_op()?; }
        let entry = access.map_err(|e| diagnostic(e, "writeStream"))?;
        if exclusive && self.lstat(&entry).is_ok() { return Err("EEXIST: file exists".into()); }
        if entry == "/" { return Err(format!("EISDIR: illegal operation on a directory '{path}'")); }
        let mut stream = self.start_command_stream(path, &entry, append, exclusive, mode).map_err(|e| diagnostic(e, "writeStream"))?;
        Ok(Box::new(move |chunk| {
            if let (Some(b), Some(bytes)) = (budget, chunk) { b.add_output_bytes(bytes.len())?; }
            stream(chunk)
        }))
    }

    fn start_command_stream(&self, _path: &str, entry: &str, append: bool, exclusive: bool, mode: u32) -> Result<ChunkWriter<'_>, String> {
        let access = if exclusive { RedirectAccess::Exclusive } else if append { RedirectAccess::Append } else { RedirectAccess::Truncate };
        if let Some(handle) = self.open_redirect_file(entry, access, Some(mode))? {
            let mut cursor = 0;
            return Ok(Box::new(move |chunk| {
                if let Some(bytes) = chunk {
                    for part in bytes.chunks(65536) {
                        handle.write_at(if append { None } else { Some(cursor) }, part)?;
                        cursor += part.len();
                    }
                }
                Ok(())
            }));
        }
        self.write_command_path(entry, &[], append, mode)?;
        let entry = entry.to_owned();
        Ok(Box::new(move |chunk| {
            if let Some(bytes) = chunk { self.append_file(&entry, bytes)?; }
            Ok(())
        }))
    }

    /// A command's named writeFile/appendFile opens the path afresh for each write.
    fn write_command_path(&self, path: &str, bytes: &[u8], append: bool, mode: u32) -> Result<(), String> {
        let entry = self.access_path(path, true)?;
        let access = if append { RedirectAccess::Append } else { RedirectAccess::Truncate };
        if let Some(handle) = self.open_redirect_file(&entry, access, Some(mode))? {
            if !bytes.is_empty() { handle.write_at(if append { None } else { Some(0) }, bytes)?; }
            return Ok(());
        }
        // Path-only filesystems (including overlays) perform the write themselves.
        let create = match self.lstat(&entry) {
            Ok(st) if st.kind == VfsEntryKind::Directory => return Err("EISDIR: illegal operation on a directory".into()),
            Ok(st) if st.mode & 0o200 == 0 => return Err("EACCES: permission denied".into()),
            Ok(_) => false,
            Err(e) if e.starts_with("ENOENT:") => {
                if self.stat(&dirname_posix_path(&entry))?.mode & 0o300 != 0o300 { return Err("EACCES: permission denied".into()); }
                true
            }
            Err(e) => return Err(e),
        };
        if create && mode != 0o644 { return self.create_file(&entry, bytes, mode); }
        if append { self.append_file(&entry, bytes) } else { self.write_file(&entry, bytes) }
    }

    /// Admit an operation on an already-open command descriptor (such as fstat or truncate).
    fn command_descriptor_op(&self) -> Result<(), String> { Ok(()) }

    /// Write to a retained command output; None appends at its current end.
    fn write_command_file_at(&self, file: &dyn OpenRedirectFile, offset: Option<usize>, bytes: &[u8]) -> Result<(), String> {
        file.write_at(offset, bytes)
    }

    /// Write to a path when the filesystem did not supply a retained redirect handle.
    fn write_redirect_path(&self, path: &str, data: &[u8], append: bool, _charge: RedirectCharge) -> Result<(), String> {
        if append { self.append_file(path, data) } else { self.write_file(path, data) }
    }

    fn open_read_file(&self, _path: &str, _allow_directory: bool) -> Result<Box<dyn FileReadHandle>, String> {
        Err("ENOTSUP: retained reads are not supported".into())
    }

    /// Byte source for a ranged stream. Memory pins the allocation; overlays retain the selected file.
    fn open_stream_reader(&self, path: &str) -> Result<Box<dyn FileReadHandle>, String> {
        self.open_read_file(path, false)
    }

    fn read_file(&self, path: &str) -> Result<Vec<u8>, String>;
    fn supplies_single_chunk_input(&self) -> bool { self.memory_backend().is_some() }
    /// Read a command input supplied as a single chunk by a direct memory filesystem.
    fn read_single_chunk_input(&self, path: &str, budget: Option<&crate::ExecutionBudget>) -> Result<Vec<u8>, String> {
        if let Some(budget) = budget { budget.tick_fs_op()?; }
        let entry = self.access_path(path, true)?;
        if let Some(budget) = budget { budget.tick_fs_op()?; }
        self.read_file(&entry)
    }
    fn open_chunks(&self, path: &str) -> Result<ChunkReader<'_>, String> {
        let data = self.read_file(path)?;
        let mut offset = 0usize;
        Ok(Box::new(move |chunk| {
            let end = data.len().min(offset.saturating_add(65536usize));
            chunk.clear();
            chunk.extend_from_slice(&data[offset..end]);
            offset = end;
            Ok(())
        }))
    }
    /// Read chunks of at most `size` bytes, including on backends with a fixed block size.
    fn open_chunks_sized(&self, path: &str, size: std::num::NonZeroUsize) -> Result<ChunkReader<'_>, String> {
        let mut next = self.open_chunks(path)?;
        let mut block = Vec::new();
        let mut pos = 0;
        Ok(Box::new(move |chunk| {
            if pos == block.len() { next(&mut block)?; pos = 0; }
            let end = pos + (block.len() - pos).min(size.get());
            chunk.clear();
            chunk.extend_from_slice(&block[pos..end]);
            pos = end;
            Ok(())
        }))
    }
    /// Deliver successive file chunks until EOF or the consumer returns false.
    fn read_chunks(&self, path: &str, consume: &mut dyn FnMut(&[u8]) -> Result<bool, String>) -> Result<(), String> {
        let mut next = self.open_chunks(path)?;
        let mut chunk = Vec::new();
        loop {
            next(&mut chunk)?;
            if chunk.is_empty() || !consume(&chunk)? { return Ok(()); }
        }
    }
    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String>;
    /// Commit an edit only while the original regular file and its contents still match.
    /// A replacement gets a new inode; an in-place edit keeps existing links and handles.
    fn commit_file_edit(&self, _path: &str, _original: &FileStat, _before: &[u8], _after: &[u8], in_place: bool) -> Result<(), String> {
        Err(if in_place { "VFS atomic in-place publication not supported" }
            else { "VFS atomic replacement publication not supported" }.into())
    }
    /// Create at the resolved entry with the requested mode. An occupied name is never followed or overwritten.
    fn create_file(&self, _path: &str, _data: &[u8], _mode: u32) -> Result<(), String> {
        Err("ENOTSUP: exclusive file creation is unsupported".into())
    }
    /// Filesystem identity and revision covering a patch target and its local ancestors.
    fn patch_revision(&self, _path: &str) -> Result<(u64, u64), String> {
        Err("filesystem does not support race-safe patch mutations".into())
    }
    fn observe_patch(&self,path:&str)->Result<(u64,PublicationStamp),String> {
        self.patch_revision(path).map(|(scope,version)|(scope,PublicationStamp::new(version,None)))
    }
    /// Replace or unlink a regular file only at the inspected revision. Return the revision after this change.
    fn patch_file(&self, _path: &str, _bytes: Option<&[u8]>, _expected: (u64, u64)) -> Result<u64, String> {
        Err("filesystem does not support race-safe patch mutations".into())
    }
    /// Atomically install a fresh regular file, leaving existing descriptors and hard links intact.
    fn replace_file_entry(&self, path: &str, data: &[u8], version: u64) -> Result<(), String> {
        self.replace_file_entry_with_mode(path, data, 0o644, version)
    }
    fn replace_file_entry_with_mode(&self, path: &str, data: &[u8], mode: u32, version: u64) -> Result<(), String> {
        self.replace_file_entry_with_metadata(path, data, mode, (None, None), version)
    }
    /// Install prepared regular files together, after admitting the complete batch.
    fn replace_file_batch(&self, _files: Vec<(String, Vec<u8>, u32)>, _version: u64) -> Result<(), String> {
        Err("ZIP split publication requires atomic owned staging".into())
    }
    /// Run a virtual checker on owned temporary bytes. Return the publication
    /// stamp adjusted only for this stage's own filesystem mutations.
    fn validate_staged_file(&self, _destination: &str, _bytes: &[u8], _stamp: u64,
        _check: &mut dyn FnMut(&str) -> bool) -> Result<(bool, u64), String> {
        Err("ENOTSUP: owned validation staging unavailable".into())
    }
    /// Publish command-private staging bytes without charging them to stdout.
    fn replace_staged_file(&self, path: &str, data: &[u8], version: u64) -> Result<(), String> {
        self.replace_file_entry_with_mode(path, data, 0o600, version)
    }
    fn supports_conditional_removal(&self, _path: &str) -> bool { false }
    fn remove_unchanged_entry(&self, _path: &str, _parent: &FileStat, _expected: &FileStat) -> Result<(), String> {
        Err("ENOTSUP: atomic source removal unavailable (use -k or -c)".into())
    }
    fn remove_unchanged_file(&self, path: &str, parent: &FileStat, expected: &FileStat) -> Result<(), String> {
        if expected.kind != VfsEntryKind::File { return Err(format!("EBUSY: input changed; input retained '{path}'")); }
        self.remove_unchanged_entry(path,parent,expected)
    }
    /// Inspect the extraction destination and bind its replacement to that observation.
    fn inspect_extraction(&self, path: &str, _allow_trusted_ancestry: bool) -> Result<(Option<FileStat>,PublicationStamp),String> {
        let version = self.generation();
        let existing = match self.lstat(path) {
            Ok(stat) => Some(stat),
            Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => None,
            Err(e) => return Err(e),
        };
        Ok((existing,PublicationStamp::new(version,None)))
    }
    fn publish_extraction_symlink(&self,path:&str,target:&str,parent:&FileStat,expected:Option<&FileStat>,_stamp:u64)->Result<(),String> {
        if expected.is_some() {return Err("ENOTSUP: guarded symlink replacement unavailable".into());}
        if parent.identity.is_none() || self.lstat(&dirname_posix_path(path))?.identity!=parent.identity {
            return Err(format!("EAGAIN: extraction parent changed: {path}"));
        }
        self.symlink(target,path)
    }
    fn charge_extraction_bytes(&self,_bytes:usize)->Result<(),String>{Ok(())}
    fn prepare_extraction_directory(&self,path:&str,parent:&FileStat,expected:Option<&FileStat>,mode:u32,times:(Option<f64>,Option<f64>),_stamp:u64)->Result<FileStat,String> {
        if let Some(memory)=self.memory_backend() {
            return memory.prepare_directory(path,parent,expected,Some(mode),times.0,times.1);
        }
        let changed=||format!("EAGAIN: extraction directory changed: {path}");
        if parent.identity.is_none() || self.lstat(&dirname_posix_path(path))?.identity!=parent.identity {return Err(changed());}
        if let Some(expected)=expected {
            let current=self.lstat(path)?;
            if current.kind!=VfsEntryKind::Directory || current.identity.is_none() || current.identity!=expected.identity {return Err(changed());}
        } else {
            self.mkdir_one(path,mode)?;
        }
        if times!=(None,None) { self.set_times(path,times.0,times.1)?; }
        if expected.is_some() { self.chmod(path,mode)?; }
        self.lstat(path)
    }
    fn remove_extraction_entry(&self,path:&str,expected:&FileStat,version:u64)->Result<(),String> {
        if self.generation()!=version {return Err(format!("EAGAIN: extraction destination changed: {path}"));}
        if self.supports_conditional_removal(path) {
            let parent=self.lstat(&dirname_posix_path(path))?;
            self.remove_unchanged_entry(path,&parent,expected)
        } else {
            self.remove_one(path,expected.kind==VfsEntryKind::Directory)
        }
    }
    /// Install mode and optional access/modification times (milliseconds) on the new inode before publication.
    fn replace_file_entry_with_metadata(&self, _path: &str, _data: &[u8], _mode: u32, _times: (Option<f64>, Option<f64>), _version: u64) -> Result<(), String> {
        Err("ENOTSUP: retained file replacement is unsupported".into())
    }
    fn observe_publication(&self, _path:&str, generation:u64, _mode:PublicationMode)->Result<PublicationStamp,String> {
        Ok(PublicationStamp::new(generation,None))
    }
    /// Publish without following a final symlink, replacing an input, or committing after a concurrent mutation.
    fn publish_file(&self, _path: &str, _data: &[u8], _inputs: &[String], _version: u64) -> Result<u64, String> {
        Err("UNSUPPORTED_CAPABILITY: VFS requires conditional file publication".into())
    }
    /// Remove only the file version returned by publish_file. A replacement is left intact.
    fn remove_published(&self, _path: &str, _publication: u64) -> Result<bool, String> {
        Err("UNSUPPORTED_CAPABILITY: VFS requires conditional file removal".into())
    }
    /// Validate a mount namespace before the caller's commit guard may run.
    fn prepare_chmod(&self, _path: &str, _ancestors: &[(&str, FileStat)]) -> Result<(), String> { Ok(()) }

    fn chmod_conditional(&self, path: &str, mode: u32, ancestors: &[(&str, FileStat)], parent: &FileStat, expected: &FileStat) -> Result<(),String> {
        self.memory_backend().ok_or("ENOTSUP: unsupported conditional chmod backend")?.chmod_conditional(path,mode,ancestors,parent,expected)
    }
    fn overlay_backend(&self) -> Option<&OverlayVfs> { None }
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

    /// Preserve the failing operation for device lookups and routed filesystems.
    fn mkdir_with_operation(&self, path: &str, recursive: bool, mode: u32, _try_backing: bool) -> Result<(), (String, &'static str, String)> {
        let syscall = if self.overlay_backend().is_some() { "overlay" } else { "mkdir" };
        self.mkdir(path, recursive, mode).map_err(|(code, at)| (code, syscall, at))
    }

    // Mode selection happens inside the charged mkdir operation.
    fn check_mkdir_creation_mode(&self, path: &str, recursive: bool) -> Result<(), String> {
        mkdir::creation_mode(path, recursive, |candidate| self.command_create_path(candidate))
    }

    /// A missing rmdir capability stops the operand batch before its first mutation.
    fn rmdir_support(&self, path: &str, entry: Option<&str>) -> Result<crate::vfs::RmdirSupport, String> {
        Ok(if entry.unwrap_or(path) == "/dev" && self.default_device_view() { RmdirSupport::Unsupported } else { RmdirSupport::Available })
    }

    fn default_device_view(&self) -> bool { false }
    /// Select a reserved device path for an already admitted host operation.
    fn reserved_device(&self, path: &str, follow: bool) -> Result<Option<&'static str>, String> {
        if !self.default_device_view() { return Ok(None); }
        Ok(match self.access_path(path,follow)?.as_str() {
            "/" => Some("/"), "/dev" => Some("/dev"), "/dev/null" => Some("/dev/null"), _ => None,
        })
    }

    /// Create one new directory. Never change an existing entry's permissions.
    fn mkdir_one(&self, _path: &str, _mode: u32) -> Result<(), String> {
        Err("ENOTSUP: operation not supported".into())
    }
    fn mkdir_all(&self, path: &str) -> Result<(), String>;
    fn exists(&self, path: &str) -> bool;
    fn is_dir(&self, path: &str) -> bool;
    fn link_free_memory(&self) -> bool { false }

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
    fn needs_readlink_lookup(&self, _path: &str) -> bool { self.has_path_capabilities() || self.default_device_view() }
    fn readlink_supported(&self, path: &str) -> Result<bool, String> {
        self.inspect_command_entry(path, true, "capabilitiesFor").map(|(entry, _)| self.supports_symbolic_links(&entry))
    }
    fn supports_symbolic_links(&self, _entry: &str) -> bool { true }
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

    fn limit_error(&self, name: &str, maximum: usize) -> String {
        crate::ShellLimits::limit_error(name, maximum)
    }

    fn remaining_output_bytes(&self) -> usize { self.shell_limits().max_output_bytes }

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
                revision: None,
                nlink: None, uid: None, gid: None, io_block_size: None, preferred_io_block_size: None, filesystem_type: None,
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
                revision: None,
                nlink: None, uid: None, gid: None, io_block_size: None, preferred_io_block_size: None, filesystem_type: None,
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
                revision: None,
                nlink: None, uid: None, gid: None, io_block_size: None, preferred_io_block_size: None, filesystem_type: None,
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
        return shell_text(s).into_owned();
    }
    let mut out = String::with_capacity(bytes.len());
    for chunk in bytes.utf8_chunks() {
        out.push_str(&shell_text(chunk.valid()));
        for &b in chunk.invalid() {
            out.push(char::from_u32(0xE000 + b as u32).unwrap());
        }
    }
    out
}

/// Quote text entering the byte-preserving shell representation.
pub(crate) fn shell_text(s: &str) -> std::borrow::Cow<'_, str> {
    // U+E080..U+E0FF represent individual raw bytes internally. Quote
    // literal occurrences as their UTF-8 bytes so decoding is reversible.
    if s.as_bytes().contains(&0xee) && let Some(start) = s.find(is_stream_byte) {
        let mut out = String::with_capacity(s.len());
        out.push_str(&s[..start]);
        for c in s[start..].chars() {
            if is_stream_byte(c) {
                for b in c.encode_utf8(&mut [0; 4]).bytes() {
                    out.push(char::from_u32(0xE000 + u32::from(b)).unwrap());
                }
            } else {
                out.push(c);
            }
        }
        return out.into();
    }
    s.into()
}

/// Project shell bytes onto the UTF-8 filenames supported by the host FS.
pub(crate) fn host_text(s: &str) -> std::borrow::Cow<'_, str> {
    stream_utf8(s).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned().into())
}

pub(crate) fn stream_utf8(s: &str) -> Result<std::borrow::Cow<'_, str>, std::string::FromUtf8Error> {
    if !s.as_bytes().contains(&0xee) || !s.contains(is_stream_byte) { return Ok(s.into()); }
    String::from_utf8(stream_string_to_bytes(s)).map(Into::into)
}

pub(crate) fn is_stream_byte(c: char) -> bool {
    ('\u{e080}'..='\u{e0ff}').contains(&c)
}

pub(crate) fn stream_byte_len(s: &str) -> usize {
    if !s.as_bytes().contains(&0xee) { return s.len(); }
    // Each encoded raw byte occupies three UTF-8 bytes in the internal string.
    s.len() - 2 * s.chars().filter(|&c| is_stream_byte(c)).count()
}

pub fn stream_string_to_bytes(s: &str) -> Vec<u8> {
    if !s.as_bytes().contains(&0xee) || !s.contains(is_stream_byte) {
        return s.as_bytes().to_vec();
    }
    let mut out = Vec::with_capacity(s.len());
    for c in s.chars() {
        let code = c as u32;
        if is_stream_byte(c) {
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

        let private_use = "é\u{e080}Ā\u{e0ff}🌍";
        let encoded = bytes_to_stream_string(private_use.as_bytes());
        assert_eq!(stream_string_to_bytes(&encoded), private_use.as_bytes());
        assert!(encoded.starts_with('é') && encoded.ends_with('🌍'));

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
    fn valid_utf8_on_either_side_of_a_raw_byte_keeps_its_characters() {
        let bytes = ["é".as_bytes(), &[0xff], "🌍\u{e080}".as_bytes(), &[0xc3]].concat();
        let text = bytes_to_stream_string(&bytes);
        assert!(text.starts_with("é\u{e0ff}🌍"));
        assert_eq!(stream_string_to_bytes(&text), bytes);
        assert_eq!(stream_byte_len(&text), bytes.len());
    }

    #[test]
    fn unit_fs_error_display_and_codes() {
        let e1 = FsError::new(FsErrorCode::PermissionDenied, "Permission denied");
        assert!(format!("{e1:?}").contains("Permission denied"));
        let e2 = FsError::new(FsErrorCode::AlreadyExists, "File exists");
        assert_eq!(e2.code, FsErrorCode::AlreadyExists);
    }
}
