mod descriptor;
mod transfer;
mod staged;
pub(crate) use staged::StagedFile;
use descriptor::DirectoryReadState;
pub(crate) use descriptor::RetainedFile;

use crate::vfs::path::{normalize_posix_path, parent_posix_path};
use crate::vfs::{EntryIdentity, FileStat, FsError, FsErrorCode, SafeBashFs, VfsEntryKind, VfsFileEntry};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone)]
enum MemoryNode {
    File { ino: u64 },
    Directory {
        revision: u64,
        retained: std::sync::Weak<std::sync::Mutex<DirectoryReadState>>,
        ino: u64,
        mode: u32,
        atime_ms: f64,
        mtime_ms: f64,
        ctime_ms: f64,
        birthtime_ms: f64,
    },
    Symlink {
        ino: u64,
        target: Arc<str>,
        status: Arc<SymlinkStatus>,
        atime_ms: f64,
        mtime_ms: f64,
        birthtime_ms: f64,
    },
}

#[derive(Debug)]
struct SymlinkStatus {
    mode: AtomicU32,
    revision: AtomicU64,
    ctime_bits: AtomicU64,
}

impl SymlinkStatus {
    fn new(mode: u32, now: f64) -> Arc<Self> {
        Arc::new(Self { mode: mode.into(), revision: 0.into(), ctime_bits: now.to_bits().into() })
    }
}

impl MemoryNode {
    fn directory(ino: u64, mode: u32, now: f64) -> Self {
        Self::Directory { revision: 0, retained: Default::default(), ino, mode, atime_ms: now, mtime_ms: now, ctime_ms: now, birthtime_ms: now }
    }

    fn status_changed(&mut self, files: &mut HashMap<u64, MemoryFile>, now: f64) {
        match self {
            Self::File { ino } => files.get_mut(ino).unwrap().status_changed(now),
            Self::Directory { ctime_ms, revision, .. } => { *ctime_ms = now; *revision += 1; }
            Self::Symlink { status, .. } => { status.ctime_bits.store(now.to_bits(), Ordering::Relaxed); status.revision.fetch_add(1, Ordering::Relaxed); }
        }
    }

    fn detach_directory_reads(&self) {
        if let Self::Directory { retained, mode, atime_ms, mtime_ms, ctime_ms, revision, .. } = self
            && let Some(handle) = retained.upgrade() {
            let mut state = handle.lock().unwrap();
            state.path = None;
            state.stat.revision = Some(*revision);
            state.stat.mode = *mode;
            state.stat.atime_ms = *atime_ms;
            state.stat.mtime_ms = *mtime_ms;
            state.stat.ctime_ms = Some(*ctime_ms);
            state.stat.nlink = Some(0);
        }
    }

    fn ino(&self) -> u64 {
        match self { Self::File { ino } | Self::Symlink { ino, .. } | Self::Directory { ino, .. } => *ino }
    }
}

#[derive(Debug)]
struct MemoryFile {
    revision: u64,
    data: Arc<Vec<u8>>,
    publication: Option<u64>,
    mode: u32,
    atime_ms: f64,
    mtime_ms: f64,
    ctime_ms: f64,
    birthtime_ms: f64,
    opens: usize,
    linked: bool,
}

impl MemoryFile {
    // An open stream owns its allocation independently of this inode's next contents.
    fn reclaimable_bytes(&self) -> usize {
        if Arc::strong_count(&self.data) == 1 { self.data.len() } else { 0 }
    }

    fn resize_data(&mut self, size: usize) -> Result<&mut Vec<u8>, String> {
        if Arc::get_mut(&mut self.data).is_none() {
            let mut detached = Vec::new();
            detached.try_reserve_exact(size).map_err(|_| "ENOSPC: insufficient memory")?;
            detached.extend_from_slice(&self.data[..size.min(self.data.len())]);
            self.data = Arc::new(detached);
        }
        let data = Arc::get_mut(&mut self.data).unwrap();
        if size > data.len() {
            data.try_reserve(size - data.len()).map_err(|_| "ENOSPC: insufficient memory")?;
        }
        data.resize(size, 0);
        Ok(data)
    }

    fn status_changed(&mut self, now: f64) { self.ctime_ms = now; self.revision += 1; }
    fn set_times(&mut self, (accessed, modified): (Option<f64>, Option<f64>)) {
        if let Some(t) = accessed { self.atime_ms = t; }
        if let Some(t) = modified { self.mtime_ms = t; }
    }
}

struct StreamSnapshot {
    data: Option<Arc<Vec<u8>>>,
    file: RetainedFile,
}

impl super::FileReadHandle for StreamSnapshot {
    fn stat(&self) -> Result<FileStat, String> {
        let mut st = self.file.stat();
        st.size = self.data.as_ref().unwrap().len();
        Ok(st)
    }

    fn read(&self, position: u64, maximum: usize) -> Result<Vec<u8>, String> {
        let data = self.data.as_ref().unwrap();
        let start = position.min(data.len() as u64) as usize;
        Ok(data[start..start.saturating_add(maximum).min(data.len())].to_vec())
    }
}

impl Drop for StreamSnapshot {
    fn drop(&mut self) {
        let mut state = self.file.fs.state.write().unwrap();
        // Release under the same lock used to detach writes so the last owner
        // of an old version returns its bytes to the filesystem exactly once.
        if let Some(data) = Arc::into_inner(self.data.take().unwrap()) {
            state.total_bytes -= data.len();
        }
    }
}

pub(super) static NEXT_PUBLICATION: AtomicU64 = AtomicU64::new(1);
static NEXT_LINK_GROUP: AtomicU64 = AtomicU64::new(1);
static NEXT_FS_ID: AtomicU64 = AtomicU64::new(1);

pub(crate) fn fill_random(bytes: &mut [u8]) -> Result<(), String> {
    #[cfg(target_arch = "wasm32")]
    {
        #[link(wasm_import_module = "safe_bash")]
        unsafe extern "C" {
            fn fill_random_bytes(ptr: *mut u8, len: usize) -> i32;
        }
        let _suspended = crate::commands::suspend_execution_clock();
        // The host writes only to this live slice and never retains its pointer.
        if unsafe { fill_random_bytes(bytes.as_mut_ptr(), bytes.len()) } != 0 {
            return Err("EIO: host entropy source unavailable".into());
        }
        Ok(())
    }
    #[cfg(all(unix, not(target_arch = "wasm32")))]
    {
        use std::io::Read;
        std::fs::File::open("/dev/urandom")
            .and_then(|mut file| file.read_exact(bytes))
            .map_err(|e| format!("EIO: host entropy source: {e}"))
    }
    #[cfg(windows)]
    {
        #[link(name = "bcrypt")]
        unsafe extern "system" {
            fn BCryptGenRandom(algorithm: *mut std::ffi::c_void, buffer: *mut u8, len: u32, flags: u32) -> i32;
        }
        let len = u32::try_from(bytes.len()).map_err(|_| "EFBIG: random read too large")?;
        // BCRYPT_USE_SYSTEM_PREFERRED_RNG requires a null algorithm handle.
        if unsafe { BCryptGenRandom(std::ptr::null_mut(), bytes.as_mut_ptr(), len, 2) } < 0 {
            return Err("EIO: host entropy source unavailable".into());
        }
        Ok(())
    }
    #[cfg(not(any(unix, windows, target_arch = "wasm32")))]
    {
        let _ = bytes;
        Err("ENOTSUP: host entropy source unavailable".into())
    }
}


#[derive(Debug, Clone)]
pub struct MemoryVfsLimits {
    pub max_total_bytes: usize,
    pub max_file_bytes: usize,
    pub max_entries: usize,
    pub max_symlink_hops: usize,
}

impl Default for MemoryVfsLimits {
    fn default() -> Self {
        Self {
            max_total_bytes: 256 * 1024 * 1024,
            max_file_bytes: usize::MAX,
            max_entries: 100_000,
            max_symlink_hops: 32,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Devices {
    Null,
    Extended,
    Mounted,
    None,
}

impl Devices {
    fn protects_hard_link(self, path: &str) -> bool {
        self != Self::None && (path == "/" || self.entry(path).is_some())
    }

    fn entry(self, path: &str) -> Option<&str> {
        let name = match self {
            Self::None => return None,
            Self::Mounted => path.strip_prefix('/')?,
            _ if path == "/dev" => "",
            _ => path.strip_prefix("/dev/")?,
        };
        match name {
            "" | "null" => Some(name),
            "full" if self == Self::Extended => Some(name),
            "zero" | "random" | "urandom" if self != Self::Null => Some(name),
            _ => None,
        }
    }
}

#[derive(Debug)]
struct LinkGroup {
    extra: usize,
    snapshot_id: u64,
}

#[derive(Debug)]
struct MemoryState {
    next_ino: u64,
    devices: Devices,
    nodes: BTreeMap<String, MemoryNode>,
    symlink_entries: usize,
    files: HashMap<u64, MemoryFile>,
    extra_links: HashMap<u64, LinkGroup>,
    child_dirs: HashMap<String, usize>,
    total_bytes: usize,
    staged_entries: usize,
    limits: MemoryVfsLimits,
}

impl MemoryState {
    fn insert_node(&mut self, path: String, node: MemoryNode) {
        self.symlink_entries += usize::from(matches!(node, MemoryNode::Symlink { .. }));
        if matches!(self.nodes.insert(path, node), Some(MemoryNode::Symlink { .. })) { self.symlink_entries -= 1; }
    }

    fn take_node(&mut self, path: &str) -> Option<MemoryNode> {
        let node = self.nodes.remove(path)?;
        self.symlink_entries -= usize::from(matches!(node, MemoryNode::Symlink { .. }));
        Some(node)
    }

    fn entry_count(&self) -> usize { self.nodes.len() + self.staged_entries }

    fn admit_new_file(&self, size: usize) -> Result<(), String> {
        if self.entry_count() >= self.limits.max_entries { return Err("ENOSPC: inode limit exceeded".into()); }
        if size > self.limits.max_file_bytes { return Err("EFBIG: file size budget exceeded".into()); }
        if size > self.limits.max_total_bytes.saturating_sub(self.total_bytes) { return Err("ENOSPC: file system byte budget exceeded".into()); }
        Ok(())
    }

    fn allocate_ino(&mut self) -> u64 {
        let ino = self.next_ino;
        self.next_ino += 1;
        ino
    }

    fn parent_changed(&mut self, path: &str, now: f64) {
        let parent = path.rsplit_once('/').map_or("/", |(p, _)| if p.is_empty() { "/" } else { p });
        self.directory_changed(parent, now);
    }

    fn directory_changed(&mut self, path: &str, now: f64) {
        if let Some(MemoryNode::Directory { mtime_ms, ctime_ms, revision, .. }) = self.nodes.get_mut(path) {
            *revision += 1;
            *mtime_ms = now;
            *ctime_ms = now;
        }
    }

    fn insert_new_file(&mut self, path: String, data: Vec<u8>, mode: u32, publication: Option<u64>) -> u64 {
        let ino = self.allocate_ino();
        let now = super::now_ms();
        self.files.insert(ino, MemoryFile { revision: 0, data: Arc::new(data), publication, mode, atime_ms: now, mtime_ms: now,
            ctime_ms: now, birthtime_ms: now, opens: 0, linked: true });
        self.parent_changed(&path, now);
        self.insert_node(path, MemoryNode::File { ino });
        ino
    }

    fn insert_directory(&mut self, path: String, node: MemoryNode) {
        if path != "/" && !self.nodes.contains_key(&path) { *self.child_dirs.entry(super::dirname_posix_path(&path)).or_default() += 1; }
        if let MemoryNode::Directory { retained, .. } = &node && let Some(handle) = retained.upgrade() {
            handle.lock().unwrap().path = Some(path.clone());
        }
        self.insert_node(path, node);
    }

    fn create_directory(&mut self, path: String, mode: u32) {
        let now = super::now_ms();
        self.parent_changed(&path, now);
        let ino = self.allocate_ino();
        self.insert_directory(path, MemoryNode::directory(ino, mode, now));
    }

    fn removed_directory(&mut self, path: &str) {
        let parent = super::dirname_posix_path(path);
        if let Some(count) = self.child_dirs.get_mut(&parent) {
            *count -= 1;
            if *count == 0 { self.child_dirs.remove(&parent); }
        }
    }
}

pub struct ConditionalFileWrite<'a> {
    pub bytes: &'a [u8],
    pub append: bool,
    pub mode: u32,
    pub atime_ms: Option<f64>,
    pub mtime_ms: Option<f64>,
}

#[derive(Clone)]
pub struct MemoryVfs {
    id: u64,
    state: Arc<RwLock<MemoryState>>,
    generation: Arc<AtomicU64>,
}

impl Default for MemoryVfs {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryVfs {
    fn stream_snapshot(&self, resolved: &str) -> Result<StreamSnapshot, String> {
        let file = self.retain_file(resolved)?;
        let mut state = self.state.write().map_err(|e| e.to_string())?;
        let inode = state.files.get_mut(&file.ino).unwrap();
        if inode.mode & 0o400 == 0 { return Err("EACCES: permission denied".into()); }
        inode.atime_ms = super::now_ms();
        Ok(StreamSnapshot { data: Some(inode.data.clone()), file })
    }

    pub(crate) fn set_devices(&self, devices: Devices) {
        self.state.write().unwrap().devices = devices;
        self.bump_generation();
    }

    pub fn set_max_total_bytes(&self, max_total_bytes: usize) {
        if let Ok(mut guard) = self.state.write() {
            guard.limits.max_total_bytes = max_total_bytes;
        }
    }

    pub fn set_max_file_bytes(&self, max_file_bytes: usize) {
        if let Ok(mut guard) = self.state.write() {
            guard.limits.max_file_bytes = max_file_bytes;
        }
    }

    pub(crate) fn max_entries(&self) -> usize { self.state.read().unwrap().limits.max_entries }

    pub fn set_max_entries(&self, max_entries: usize) {
        if let Ok(mut guard) = self.state.write() {
            guard.limits.max_entries = max_entries;
        }
    }

    pub fn new() -> Self {
        Self::with_limits(MemoryVfsLimits::default())
    }

    pub fn with_limits(limits: MemoryVfsLimits) -> Self {
        let mut nodes = BTreeMap::new();
        nodes.insert(
            "/".to_string(),
            MemoryNode::directory(1, 0o40755, super::now_ms()),
        );
        Self {
            // The built-in device view has its own identity scope.
            id: NEXT_FS_ID.fetch_add(2, Ordering::Relaxed),
            state: Arc::new(RwLock::new(MemoryState {
                next_ino: 2, devices: Devices::Extended,
                nodes, symlink_entries: 0,
                files: HashMap::new(), extra_links: HashMap::new(), child_dirs: HashMap::new(),
                total_bytes: 0, staged_entries: 0,
                limits,
            })),
            generation: Arc::new(AtomicU64::new(1)),
        }
    }

    pub fn as_git_fs(&self) -> GitFsView<'_> {
        GitFsView(self)
    }

    pub fn readlink_bytes(&self, path: &str) -> Result<Vec<u8>, FsError> {
        let norm = normalize_posix_path(path);
        let guard = self.state.read().map_err(|_| FsError::new(FsErrorCode::Io, "lock poisoned"))?;
        let resolved = Self::resolve_symlinks_locked(&guard, &norm, false)?;
        match guard.nodes.get(&resolved) {
            Some(MemoryNode::Symlink { target, .. }) => {
                Ok(target.as_bytes().to_vec())
            }
            Some(_) => Err(FsError::new(FsErrorCode::InvalidInput, format!("EINVAL: not a symlink '{norm}'"))),
            None => Err(FsError::new(FsErrorCode::NotFound, format!("ENOENT: no such file or directory '{norm}'"))),
        }
    }

    fn bump_generation(&self) {
        self.generation.fetch_add(1, Ordering::Relaxed);
    }

    fn resolve_symlinks_locked(
        state: &MemoryState,
        path: &str,
        follow_final: bool,
    ) -> Result<String, FsError> {
        let norm = normalize_posix_path(path);
        if norm == "/" {
            return Ok(norm);
        }
        let mut hops = 0usize;
        let mut queue: std::collections::VecDeque<String> = norm
            .split('/')
            .filter(|p| !p.is_empty())
            .map(String::from)
            .collect();
        let mut current = String::from("/");

        while let Some(part) = queue.pop_front() {
            if part.len() > 255 {
                return Err(FsError::new(FsErrorCode::InvalidInput, "ENAMETOOLONG: name too long"));
            }
            if part == "." || part.is_empty() {
                continue;
            }
            if part == ".." {
                current = parent_posix_path(&current).unwrap_or_else(|| "/".to_string());
                continue;
            }
            let is_last = queue.is_empty();
            let candidate = if current == "/" {
                format!("/{part}")
            } else {
                format!("{current}/{part}")
            };

            if !is_last && state.devices.entry(&candidate).is_some_and(|n| !n.is_empty()) {
                return Err(FsError::new(FsErrorCode::NotDirectory, format!("ENOTDIR: not a directory, '{candidate}'")));
            }
            if is_last && !follow_final {
                current = candidate;
                break;
            }

            if let Some(MemoryNode::Symlink { target, .. }) = state.nodes.get(&candidate) {
                hops += 1;
                if hops > state.limits.max_symlink_hops {
                    return Err(FsError::new(
                        FsErrorCode::Loop,
                        format!("ELOOP: too many symbolic links encountered '{path}'"),
                    ));
                }
                if target.starts_with('/') {
                    current = String::from("/");
                }
                let target_parts: Vec<String> = target
                    .split('/')
                    .filter(|p| !p.is_empty())
                    .map(String::from)
                    .collect();
                for tp in target_parts.into_iter().rev() {
                    queue.push_front(tp);
                }
            } else {
                current = candidate;
            }
        }
        Ok(current)
    }

    fn metadata(&self, path: &str, follow: bool) -> Result<FileStat, String> {
        let state = self.state.read().map_err(|e| e.to_string())?;
        let resolved = Self::resolve_symlinks_locked(&state, path, follow).map_err(|e| e.message)?;
        self.resolved_metadata(&state, &resolved).ok_or_else(|| format!("ENOENT: no such file or directory, {} '{}'", if follow { "stat" } else { "lstat" }, normalize_posix_path(path)))
    }

    fn resolved_metadata(&self, state: &MemoryState, resolved: &str) -> Option<FileStat> {
        let device = state.devices.entry(resolved);
        let (kind, size, mode, atime_ms, mtime_ms, ctime, birth, ino, revision) = if let Some(name) = device {
            let ino = match name { "" if state.devices == Devices::Null => 2, "null" if state.devices == Devices::Null => 1, "" => 1, "null" => 2, "random" => 3, "urandom" => 4, "zero" => 5, "full" => 6, _ => unreachable!() };
            let (kind, mode) = if name.is_empty() {
                (VfsEntryKind::Directory, if state.devices == Devices::Mounted { 0o40555 } else { 0o40755 })
            } else { (VfsEntryKind::File, 0o20666) };
            let created = if state.devices == Devices::Mounted {
                let MemoryNode::Directory { birthtime_ms, .. } = &state.nodes["/"] else { unreachable!() };
                *birthtime_ms
            } else { 0.0 };
            (kind, 0, mode, created, created, created, created, ino, None)
        } else {
            match state.nodes.get(resolved) {
                Some(MemoryNode::File { ino }) => {
                    let file = &state.files[ino];
                    (VfsEntryKind::File, file.data.len(), file.mode, file.atime_ms, file.mtime_ms, file.ctime_ms, file.birthtime_ms, *ino, Some(file.revision))
                }
                Some(MemoryNode::Directory { ino, mode, atime_ms, mtime_ms, ctime_ms, birthtime_ms, revision, .. }) => (VfsEntryKind::Directory, 0, *mode, *atime_ms, *mtime_ms, *ctime_ms, *birthtime_ms, *ino, Some(*revision)),
                Some(MemoryNode::Symlink { ino, target, status, atime_ms, mtime_ms, birthtime_ms }) => (VfsEntryKind::Symlink, target.len(), status.mode.load(Ordering::Relaxed), *atime_ms, *mtime_ms, f64::from_bits(status.ctime_bits.load(Ordering::Relaxed)), *birthtime_ms, *ino, Some(status.revision.load(Ordering::Relaxed))),
                None => return None,
            }
        };
        let default_device = device.is_some() && state.devices == Devices::Null;
        Some(FileStat {
            revision,
            uid: (state.devices != Devices::Mounted).then_some(0), gid: (state.devices != Devices::Mounted).then_some(0),
            preferred_io_block_size: (device.is_none() || default_device && device == Some("null")).then_some(4096),
            io_block_size: device.is_none().then_some(65536), filesystem_type: device.is_none().then_some("memory"),
            nlink: (state.devices != Devices::Mounted).then(|| if device.is_some() { 1 } else if kind == VfsEntryKind::Directory {
                2 + state.child_dirs.get(resolved).copied().unwrap_or(0)
            } else { 1 + state.extra_links.get(&ino).map_or(0, |g| g.extra) }),
            identity: Some(EntryIdentity::Memory(if device.is_some() && state.devices != Devices::Mounted { self.id + 1 } else { self.id }, ino)),
            allocated_bytes: default_device.then_some(0),
            kind, size, mode, atime_ms, mtime_ms, ctime_ms: Some(ctime), birthtime_ms: Some(birth),
        })
    }

    fn write_bytes(&self, path: &str, data: &[u8], append: bool) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        let mut guard = self.state.write().map_err(|e| e.to_string())?;
        let resolved = Self::resolve_symlinks_locked(&guard, &norm, true).map_err(|e| e.message)?;
        if let Some(name) = guard.devices.entry(&resolved) {
            return match name {
                "" => Err(format!("EISDIR: illegal operation on a directory, open '{norm}'")),
                "urandom" if guard.devices == Devices::Mounted => Err(format!("EPERM: operation not permitted, write '{norm}'")),
                "full" => Err("ENOSPC: no space left on device, write '/dev/full'".into()),
                _ => Ok(()),
            };
        }
        if guard.devices == Devices::Mounted { return Err(format!("ENOENT: no such file or directory, write '{norm}'")); }
        Self::ensure_parent_dirs_locked(&mut guard, &norm).map_err(|e| e.message)?;
        let (initial, suffix) = if append { (&[][..], Some(data)) } else { (data, None) };
        Self::store_file(&mut guard, resolved, initial, 0o100644, None, suffix)?;
        self.bump_generation();
        Ok(())
    }

    fn check_edit(&self, state: &MemoryState, path: &str, original: &FileStat, before: &[u8], in_place: bool) -> Result<(), String> {
        let changed = || format!("EAGAIN: resource temporarily unavailable, fileStaging '{path}'");
        let Some(MemoryNode::File { ino }) = state.nodes.get(path) else { return Err(changed()) };
        let mut observed = self.resolved_metadata(state, path).ok_or_else(changed)?;
        // Reading the original may advance atime. All other metadata and the bytes must still match.
        observed.atime_ms = original.atime_ms;
        if observed != *original || state.files[ino].data.as_slice() != before { return Err(changed()); }
        if original.mode & 0o200 == 0 { return Err(format!("EACCES: permission denied, access '{path}'")); }
        if !in_place && original.nlink != Some(1) { return Err("VFS hardlink replacement is not yet supported".into()); }
        Ok(())
    }

    fn replace_inode(state: &mut MemoryState, entry: String, after: &[u8], mode: u32) -> Result<u64, String> {
        // Reserve the new inode and its contents before detaching the old one. Open readers
        // retain the old file and its byte charge until they close their last descriptor.
        state.admit_new_file(after.len())?;
        let mut data = Vec::new();
        data.try_reserve_exact(after.len()).map_err(|_| "ENOSPC: insufficient memory")?;
        data.extend_from_slice(after);
        Self::unlink_locked(state, &entry);
        state.total_bytes += data.len();
        Ok(state.insert_new_file(entry, data, mode, None))
    }

    fn store_file(state: &mut MemoryState, resolved: String, data: &[u8], create_mode: u32, publication: Option<u64>, suffix: Option<&[u8]>) -> Result<(), String> {
        let existing = match state.nodes.get(&resolved) {
            Some(MemoryNode::Directory { .. }) => return Err(format!("EISDIR: illegal operation on a directory, open '{resolved}'")),
            Some(MemoryNode::File { ino }) => Some(*ino),
            _ => None,
        };
        let old_len = existing.map_or(0, |ino| state.files[&ino].data.len());
        if existing.is_none() && state.entry_count() >= state.limits.max_entries {
            return Err("ENOSPC: inode limit exceeded".into());
        }
        let new_len = if let Some(tail) = suffix {
            existing.map_or(data.len(), |_| old_len).checked_add(tail.len()).ok_or("EFBIG: file size overflow")?
        } else { data.len() };
        if new_len > state.limits.max_file_bytes {
            return Err("EFBIG: file size budget exceeded".to_string());
        }
        let reclaimed = existing.map_or(0, |ino| state.files[&ino].reclaimable_bytes());
        let next_total = (state.total_bytes - reclaimed).checked_add(new_len).ok_or("ENOSPC: byte limit exceeded")?;
        if next_total > state.limits.max_total_bytes {
            return Err("ENOSPC: file system byte budget exceeded".to_string());
        }
        if let Some(ino) = existing {
            let file = state.files.get_mut(&ino).unwrap();
            if let Some(tail) = suffix {
                file.resize_data(new_len)?[old_len..].copy_from_slice(tail);
            } else {
                file.data = Arc::new(data.to_vec());
            }
            file.publication = publication;
            file.mtime_ms = super::now_ms();
            file.status_changed(file.mtime_ms);
        } else {
            let mut contents = Vec::new();
            contents.try_reserve_exact(new_len).map_err(|_| "ENOSPC: insufficient memory")?;
            contents.extend_from_slice(data);
            if let Some(tail) = suffix { contents.extend_from_slice(tail); }
            state.insert_new_file(resolved, contents, create_mode, publication);
        }
        state.total_bytes = next_total;
        Ok(())
    }

    fn link_node(state: &mut MemoryState, mut node: MemoryNode, dst: String) -> Result<(), String> {
        if matches!(node, MemoryNode::Directory { .. }) { return Err("EPERM: operation not permitted".into()); }
        if state.nodes.contains_key(&dst) || state.devices.entry(&dst).is_some() { return Err("EEXIST: file already exists".into()); }
        if state.entry_count() >= state.limits.max_entries { return Err("ENOSPC: inode limit exceeded".into()); }
        let ino = node.ino();
        if let Some(file) = state.files.get_mut(&ino) { file.publication = None; }
        state.extra_links.entry(ino).or_insert_with(|| LinkGroup { extra: 0, snapshot_id: NEXT_LINK_GROUP.fetch_add(1, Ordering::Relaxed) }).extra += 1;
        let now = super::now_ms();
        state.parent_changed(&dst, now);
        node.status_changed(&mut state.files, now);
        state.insert_node(dst, node);
        Ok(())
    }

    fn remove_one_locked(state: &mut MemoryState, path: &str, directory: bool) -> Result<(), String> {
        let entry = Self::mutation_entry(state, path)?;
        if state.devices == Devices::Mounted && entry != "/" && state.devices.entry(&entry).is_some() {
            return Err(if directory { "ENOTDIR: not a directory" } else { "ENOTSUP: operation not supported" }.into());
        }
        if entry == "/" || state.devices.entry(&entry).is_some() {
            return Err("EBUSY: resource busy or locked".into());
        }
        let node = state.nodes.get(&entry).ok_or("ENOENT: no such file or directory")?;
        let is_dir = matches!(node, MemoryNode::Directory { .. });
        if !is_dir && (directory || path.ends_with('/')) { return Err("ENOTDIR: not a directory".into()); }
        let parent = super::dirname_posix_path(&entry);
        if !matches!(state.nodes.get(&parent), Some(MemoryNode::Directory { mode, .. }) if mode & 0o300 == 0o300) {
            return Err("EACCES: permission denied".into());
        }
        if is_dir {
            if !directory { return Err("EISDIR: illegal operation on a directory".into()); }
            let prefix = format!("{entry}/");
            if state.nodes.range(prefix.clone()..).next().is_some_and(|(key, _)| key.starts_with(&prefix)) {
                return Err("ENOTEMPTY: directory not empty".into());
            }
        }
        Self::unlink_locked(state, &entry);
        Ok(())
    }

    // The overlay holds its whiteout lock. Pin both layers at the inspected revisions
    // before publishing any change to the merged namespace.
    fn overlay_layers<'a>(&'a self, lower: &'a Self, versions: (u64, u64)) -> Result<(
        std::sync::RwLockReadGuard<'a, MemoryState>, std::sync::RwLockWriteGuard<'a, MemoryState>
    ), String> {
        if self.id == lower.id { return Err("ENOTSUP: aliased overlay layers".into()); }
        let (base, upper) = if lower.id < self.id {
            let base = lower.state.read().map_err(|_| "EIO: input/output error")?;
            (base, self.state.write().map_err(|_| "EIO: input/output error")?)
        } else {
            let upper = self.state.write().map_err(|_| "EIO: input/output error")?;
            (lower.state.read().map_err(|_| "EIO: input/output error")?, upper)
        };
        if versions != (lower.generation(), self.generation()) { return Err("EBUSY: overlay entries changed".into()); }
        Ok((base, upper))
    }

    pub(super) fn install_overlay_batch(&self, lower: &Self, versions: (u64,u64), files: Vec<(String,Vec<u8>,u32)>, parents: Vec<(String,FileStat)>) -> Result<(),String> {
        let (_base, mut upper) = self.overlay_layers(lower,versions)?;
        self.install_file_batch(&mut upper,files,parents)
    }

    fn install_file_batch(&self, state: &mut MemoryState, files: Vec<(String,Vec<u8>,u32)>, parents: Vec<(String,FileStat)>) -> Result<(),String> {
        if files.len().saturating_add(parents.len()) > state.limits.max_entries.saturating_sub(state.entry_count()) { return Err("ENOSPC: inode limit exceeded".into()); }
        let mut remaining = state.limits.max_total_bytes.saturating_sub(state.total_bytes);
        let mut seen = std::collections::HashSet::new();
        for (path, bytes, mode) in &files {
            let safe = match state.nodes.get(path) {
                None => true,
                Some(MemoryNode::File { ino }) => !state.extra_links.contains_key(ino),
                _ => false,
            };
            if !safe || !seen.insert(path.clone()) || state.devices == Devices::Mounted || state.devices.entry(path).is_some() {
                return Err("ZIP split destination is not a safe regular file".into());
            }
            let parent = super::dirname_posix_path(path);
            if !matches!(state.nodes.get(&parent), Some(MemoryNode::Directory { mode, .. }) if mode & 0o300 == 0o300)
                && !parents.iter().any(|(p, st)| p == &parent && st.mode & 0o300 == 0o300) {
                return Err("EACCES: permission denied".into());
            }
            if *mode > 0o7777 { return Err("EINVAL: invalid argument".into()); }
            if bytes.len() > state.limits.max_file_bytes { return Err("EFBIG: file size budget exceeded".into()); }
            remaining = remaining.checked_sub(bytes.len()).ok_or("ENOSPC: file system byte budget exceeded")?;
        }
        for (path, st) in parents.into_iter().rev() {
            let mut node = MemoryNode::directory(state.allocate_ino(), st.mode, st.mtime_ms);
            if let MemoryNode::Directory { atime_ms, .. } = &mut node { *atime_ms = st.atime_ms; }
            state.parent_changed(&path, super::now_ms());
            state.insert_directory(path, node);
        }
        for (path, bytes, mode) in files {
            Self::unlink_locked(state, &path);
            state.total_bytes += bytes.len();
            state.insert_new_file(path, bytes, 0o100000 | mode, None);
        }
        self.bump_generation();
        Ok(())
    }

    pub(super) fn write_overlay_file(&self, lower: &Self, versions: (u64, u64), path: &str, data: &[u8], (mode, atime): (u32, Option<f64>), parents: Vec<(String, FileStat)>, operation: super::overlay::FileWrite<'_>) -> Result<(), String> {
        use super::overlay::FileWrite;
        let append = matches!(operation, FileWrite::Append);
        let publication = match operation { FileWrite::Publish { stamp, .. } => Some(stamp), _ => None };
        let (base, mut upper) = self.overlay_layers(lower, versions)?;
        let creating = !upper.nodes.contains_key(path);
        if creating && parents.len() >= upper.limits.max_entries.saturating_sub(upper.entry_count()) {
            return Err("ENOSPC: inode limit exceeded".into());
        }
        if let FileWrite::Edit { original, before, in_place } = operation {
            if creating { lower.check_edit(&base, path, original, before, in_place)?; }
            else {
                self.check_edit(&upper, path, original, before, in_place)?;
                if !in_place {
                    Self::replace_inode(&mut upper, path.to_owned(), data, original.mode)?;
                    self.bump_generation();
                    return Ok(());
                }
            }
        }
        if let FileWrite::Install { times, .. } = operation && !creating {
            let ino = Self::replace_inode(&mut upper, path.to_owned(), data, 0o100000 | mode)?;
            upper.files.get_mut(&ino).unwrap().set_times(times);
            self.bump_generation();
            return Ok(());
        }
        let initial = if append && creating && atime.is_some() {
            let Some(MemoryNode::File { ino }) = base.nodes.get(path) else { return Err("EBUSY: lower file changed".into()); };
            base.files[ino].data.as_slice()
        } else if append { &[] } else { data };
        Self::store_file(&mut upper, path.to_owned(), initial, 0o100000 | mode, publication, append.then_some(data))?;
        if let FileWrite::Install { times, .. } = operation {
            let ino = upper.nodes[path].ino();
            upper.files.get_mut(&ino).unwrap().set_times(times);
        }
        if creating {
            let now = super::now_ms();
            if let Some(atime) = atime {
                let ino = upper.nodes[path].ino();
                upper.files.get_mut(&ino).unwrap().atime_ms = atime;
            }
            for (parent, st) in parents {
                let mut node = MemoryNode::directory(upper.allocate_ino(), st.mode, now);
                if let MemoryNode::Directory { atime_ms, .. } = &mut node { *atime_ms = st.atime_ms; }
                upper.parent_changed(&parent, now);
                upper.insert_directory(parent, node);
            }
            upper.directory_changed("/", now);
        }
        self.bump_generation();
        Ok(())
    }

    pub(super) fn copy_up_metadata(&self, lower: &Self, versions: (u64, u64), path: &str, st: &FileStat) -> Result<(), String> {
        let (base, mut upper) = self.overlay_layers(lower, versions)?;
        if matches!(upper.nodes.get(path),Some(MemoryNode::Directory {..})) {
            return self.set_mode_locked(&mut upper,path,st.mode);
        }
        let mut directories = Vec::new();
        let mut cursor = path;
        while !upper.nodes.contains_key(cursor) {
            match base.nodes.get(cursor) {
                Some(MemoryNode::Directory { mode, atime_ms, .. }) => directories.push((cursor, *mode, *atime_ms)),
                Some(MemoryNode::File { .. }) if cursor == path => {}
                _ => return Err(format!("ENOTSUP: unsupported copy-up, overlay '{cursor}'")),
            }
            cursor = cursor.rsplit_once('/').map(|(p,_)| if p.is_empty() { "/" } else { p }).unwrap_or("/");
        }
        let file = match base.nodes.get(path) {
            Some(MemoryNode::File { ino }) => Some(&base.files[ino]),
            Some(MemoryNode::Directory { .. }) => None,
            _ => return Err(format!("ENOENT: no such file or directory, overlay '{path}'")),
        };
        if directories.len() + usize::from(file.is_some()) > upper.limits.max_entries.saturating_sub(upper.entry_count()) {
            return Err("ENOSPC: inode limit exceeded".into());
        }
        if let Some(file) = file {
            Self::store_file(&mut upper, path.to_owned(), &file.data, st.mode, None, None)?;
            let ino = upper.nodes[path].ino();
            let copy = upper.files.get_mut(&ino).unwrap();
            copy.atime_ms = st.atime_ms;
            copy.mtime_ms = st.mtime_ms;
        }
        let now = super::now_ms();
        // Publishing a staged copy changes the upper root, even for a nested destination.
        upper.directory_changed("/", now);
        for (parent, mode, previous_atime) in directories {
            upper.parent_changed(parent, now);
            let ino = upper.allocate_ino();
            upper.insert_directory(parent.to_owned(), MemoryNode::Directory {
                revision: 0, retained: Default::default(), ino, mode: if parent == path { st.mode } else { mode },
                atime_ms: if parent == path { st.atime_ms } else { previous_atime },
                mtime_ms: if parent == path { st.mtime_ms } else { now },
                ctime_ms: now, birthtime_ms: now,
            });
        }
        self.bump_generation();
        Ok(())
    }

    pub(super) fn remove_overlay_entry(&self, lower: &Self, versions: (u64, u64), path: &str, directory: bool, recursive: bool, publication: Option<u64>) -> Result<bool, String> {
        let (base, mut upper) = self.overlay_layers(lower, versions)?;
        if path == "/" || upper.devices.entry(path).is_some() || base.devices.entry(path).is_some() {
            return Err("EBUSY: resource busy or locked".into());
        }
        if let Some(stamp) = publication
            && !matches!(upper.nodes.get(path), Some(MemoryNode::File { ino }) if upper.files[ino].publication == Some(stamp)) {
            return Ok(false);
        }
        if upper.nodes.contains_key(path) {
            if recursive {
                // The overlay detaches the upper subtree as a single namespace change.
                let prefix = format!("{path}/");
                let keys: Vec<_> = upper.nodes.range(prefix.clone()..).take_while(|(k, _)| k.starts_with(&prefix)).map(|(k, _)| k.clone()).collect();
                for key in keys { Self::unlink_locked(&mut upper, &key); }
                Self::unlink_locked(&mut upper, path);
            } else {
                Self::remove_one_locked(&mut upper, path, directory)?;
            }
            self.bump_generation();
        }
        Ok(true)
    }

    /// Create or restore a directory while both named identities are held under the namespace lock.
    pub fn prepare_directory(&self, path: &str, parent: &FileStat, expected: Option<&FileStat>,
        mode: Option<u32>, atime: Option<f64>, mtime: Option<f64>) -> Result<FileStat,String> {
        let mut state = self.state.write().map_err(|_| "EIO: input/output error")?;
        if state.devices == Devices::Null { Self::check_device_mutation_operand(&state,path)?; }
        let entry = Self::resolve_mutation_entry(&state,path)?;
        if state.devices.entry(&entry).is_some() { return Err("EBUSY: resource busy or locked".into()); }
        let changed = || format!("EAGAIN: entry changed, fileStaging '{path}'");
        let dir = self.resolved_metadata(&state,&super::dirname_posix_path(&entry)).ok_or_else(changed)?;
        let current = self.resolved_metadata(&state,&entry);
        if path.ends_with('/') && current.as_ref().is_some_and(|s| s.kind != VfsEntryKind::Directory) { return Err("ENOTDIR: not a directory".into()); }
        dir.check_receipt(parent,false,path)?;
        match (&current,expected) {
            (Some(actual),Some(observed)) => actual.check_receipt(observed,false,path)?,
            (None,None) => (),
            _ => return Err(changed()),
        }
        if mode.is_some_and(|m| m > 0o7777) || [atime,mtime].into_iter().flatten().any(|t| !t.is_finite()) { return Err("EINVAL: invalid argument".into()); }
        if current.is_none() {
            if dir.mode & 0o300 != 0o300 { return Err("EACCES: permission denied".into()); }
            if state.entry_count() >= state.limits.max_entries { return Err("ENOSPC: inode limit exceeded".into()); }
            state.create_directory(entry.clone(),0o040000 | mode.unwrap_or(0o777));
        }
        let Some(MemoryNode::Directory {mode:permissions,atime_ms,mtime_ms,ctime_ms,revision,..}) = state.nodes.get_mut(&entry) else { return Err("ENOTDIR: not a directory".into()); };
        if let Some(m) = mode { *permissions = 0o040000 | m; }
        if let Some(t) = atime { *atime_ms = t; }
        if let Some(t) = mtime { *mtime_ms = t; }
        *ctime_ms = super::now_ms();
        *revision += 1;
        self.bump_generation();
        Ok(self.resolved_metadata(&state,&entry).unwrap())
    }

    /// Compare both receipts and mutate the named entry while holding one namespace lock.
    pub fn mutate_file_conditional(&self, path: &str, parent: &FileStat, expected: Option<&FileStat>,
        write: Option<ConditionalFileWrite<'_>>) -> Result<Option<FileStat>,String> {
        let mut state = self.state.write().map_err(|_| "EIO: input/output error")?;
        if state.devices == Devices::Null { Self::check_device_mutation_operand(&state, path)?; }
        let entry = Self::resolve_mutation_entry(&state, path)?;
        let changed = || format!("EAGAIN: entry changed, fileStaging '{path}'");
        if state.devices.entry(&entry).is_some() { return Err("EBUSY: resource busy or locked".into()); }
        let dir = self.resolved_metadata(&state, &super::dirname_posix_path(&entry)).ok_or_else(changed)?;
        let current = self.resolved_metadata(&state,&entry);
        if path.ends_with('/') && current.as_ref().is_some_and(|s| s.kind != VfsEntryKind::Directory) {
            return Err("ENOTDIR: not a directory".into());
        }
        dir.check_receipt(parent, false, path)?;
        match (&current, expected) {
            (Some(s), Some(e)) => s.check_receipt(e, true, path)?,
            (None, None) if write.is_some() => {},
            _ => return Err(changed()),
        }
        if current.as_ref().is_some_and(|s| s.kind != VfsEntryKind::File) { return Err("EINVAL: invalid argument".into()); }
        if let Some(w) = write {
            if w.mode > 0o7777 || [w.atime_ms,w.mtime_ms].into_iter().flatten().any(|n|
                !(0.0..=9_007_199_254_740_991.0).contains(&n) || n.fract() != 0.) { return Err("EINVAL: invalid argument".into()); }
            if current.as_ref().map_or(dir.mode & 0o300 != 0o300, |s| s.mode & 0o200 == 0) {
                return Err("EACCES: permission denied".into());
            }
            if path.ends_with('/') { return Err("ENOENT: no such file or directory".into()); }
            Self::store_file(&mut state, entry.clone(), if w.append { &[] } else { w.bytes },
                0o100000 | w.mode, None, w.append.then_some(w.bytes))?;
            let ino = state.nodes[&entry].ino();
            let file = state.files.get_mut(&ino).unwrap();
            if let Some(time) = w.atime_ms { file.atime_ms = time; }
            if let Some(time) = w.mtime_ms { file.mtime_ms = time; }
            self.bump_generation();
            Ok(self.resolved_metadata(&state,&entry))
        } else {
            if dir.mode & 0o300 != 0o300 { return Err("EACCES: permission denied".into()); }
            Self::unlink_locked(&mut state,&entry);
            self.bump_generation();
            Ok(None)
        }
    }

    /// Change the inspected entry without following a final symbolic link.
    /// Receipts come from lstat on this filesystem. Check every component and
    /// apply the change under one lock, including for hard-linked entries.
    pub fn chmod_conditional(
        &self, path: &str, mode: u32, ancestors: &[(&str, FileStat)],
        parent: &FileStat, expected: &FileStat,
    ) -> Result<(), String> {
        super::validate_chmod_ancestry(path, mode, ancestors)?;
        let dir = super::dirname_posix_path(path);
        let mut state = self.state.write().map_err(|_| "EIO: input/output error")?;
        for (p, expected_dir) in ancestors {
            self.check_chmod_receipt(&state,p,expected_dir,false,true)?;
        }
        self.check_chmod_receipt(&state,&dir,parent,false,false)?;
        self.check_chmod_receipt(&state,path,expected,true,false)?;
        if state.devices.entry(path).is_some() { return Err("ENOTSUP: device chmod".into()); }
        self.set_mode_locked(&mut state, path, mode)
    }

    fn check_chmod_receipt(&self, state: &MemoryState, path: &str, expected: &FileStat, unchanged: bool, searchable: bool) -> Result<(), String> {
        let changed = || format!("EAGAIN: entry changed, fileStaging '{path}'");
        let current = self.resolved_metadata(state,path).ok_or_else(changed)?;
        current.check_receipt(expected, unchanged && current.kind != VfsEntryKind::Directory, path)?;
        if searchable && current.mode & 0o100 == 0 { return Err(format!("EACCES: permission denied, verifyDirectoryAncestry '{path}'")); }
        Ok(())
    }

    pub(super) fn chmod_across_mounts(
        &self, path: &str, mode: u32, ancestors: &[(&Self, String, &FileStat)], parent: &FileStat, expected: &FileStat,
    ) -> Result<(), String> {
        // Keep the entire mounted ancestry pinned until the mode changes. Different
        // mount namespaces can use the same stores in the opposite nesting order.
        let stores: BTreeMap<_,_> = ancestors.iter().map(|(fs,_,_)|(fs.id,*fs)).chain([(self.id,self)]).collect();
        let mut states = BTreeMap::new();
        for (id,fs) in stores {
            states.insert(id, fs.state.write().map_err(|_|"EIO: input/output error")?);
        }
        for (fs,local,receipt) in ancestors {
            fs.check_chmod_receipt(&states[&fs.id], local, receipt, false, true)?;
        }
        let target = states.get_mut(&self.id).unwrap();
        self.check_chmod_receipt(target, &super::dirname_posix_path(path), parent, false,false)?;
        self.check_chmod_receipt(target, path, expected, true,false)?;
        if target.devices.entry(path).is_some() { return Err("ENOTSUP: device chmod".into()); }
        self.set_mode_locked(target, path, mode)
    }

    fn set_mode_locked(&self, guard: &mut MemoryState, path: &str, mode: u32) -> Result<(), String> {
        let now = super::now_ms();
        let node = guard.nodes.get_mut(path).ok_or_else(|| format!("ENOENT: no such file or directory, chmod '{path}'"))?;
        node.status_changed(&mut guard.files, now);
        match node {
            MemoryNode::File { ino } => {
                let file = guard.files.get_mut(ino).unwrap();
                file.publication = None;
                file.mode = 0o100000 | (mode & 0o7777);
            }
            MemoryNode::Directory { mode: m, .. } => *m = 0o040000 | (mode & 0o7777),
            MemoryNode::Symlink { status, .. } => status.mode.store(0o120000 | (mode & 0o7777), Ordering::Relaxed),
        }
        self.bump_generation();
        Ok(())
    }
    /// The default device view protects reserved entries before delegating a mutation.
    /// A final link names the link itself; a trailing slash makes it an ancestor.
    fn check_device_mutation_operand(state: &MemoryState, path: &str) -> Result<(), String> {
        let resolved = Self::device_operand(state, path, false)?;
        if matches!(resolved.as_str(), "/" | "/dev" | "/dev/null") {
            return Err(format!("EBUSY: resource busy or locked '{path}'"));
        }
        Ok(())
    }

    pub(crate) fn device_capability_path(&self, path: &str, follow: bool) -> Result<String,String> {
        let state = self.state.read().map_err(|_| "EIO: input/output error")?;
        Self::device_operand(&state,path,follow)
    }

    fn device_operand(state: &MemoryState, path: &str, follow_final: bool) -> Result<String, String> {
        if path.contains('\0') { return Err("EINVAL: paths must be strings without NUL bytes, resolve".into()); }
        let not_dir = || format!("ENOTDIR: not a directory '{path}'");
        // Device traversal rejects even a lexical /dev/null/.. before looking up links.
        if path.contains("null/") {
            let mut parts = Vec::new();
            for part in path.split('/') {
                if parts.as_slice() == ["dev","null"] { return Err(not_dir()); }
                match part { "" | "." => {}, ".." => { parts.pop(); }, _ => parts.push(part) }
            }
        }
        let mut pending: Vec<_> = path.split('/').rev().collect();
        let mut current = String::from("/");
        let mut failure = None;
        let mut failed_at = usize::MAX;
        let mut links = 0;
        let mut absolute = path.starts_with('/');
        while let Some(part) = pending.pop() {
            if current == "/dev/null" { return Err(not_dir()); }
            match part {
                "" | "." => continue,
                ".." => {
                    current.truncate(current.rfind('/').unwrap_or(0).max(1));
                    if current.len() < failed_at { failed_at = usize::MAX; }
                    continue;
                }
                _ => {}
            }
            let parent_len = current.len();
            if current != "/" { current.push('/'); }
            current.push_str(part);
            if (!follow_final && pending.is_empty()) || parent_len >= failed_at || matches!(current.as_str(),"/dev"|"/dev/null") { continue; }
            let display = |p: &str| if absolute { p.to_owned() } else { p.trim_start_matches('/').to_owned() };
            if matches!(state.nodes.get(&current[..parent_len]),Some(MemoryNode::Directory {mode,..}) if mode & 0o100 == 0) {
                return Err(format!("EACCES: permission denied, lstat '{}'",display(&current)));
            }
            match state.nodes.get(&current) {
                Some(MemoryNode::Directory { .. }) => {}
                Some(MemoryNode::Symlink { target,.. }) => {
                    links += 1;
                    if links > state.limits.max_symlink_hops { return Err(format!("ELOOP: too many symbolic links encountered '{path}'")); }
                    if target.starts_with('/') { current.truncate(1); absolute = true; failed_at = usize::MAX; }
                    else { current.truncate(parent_len); }
                    pending.extend(target.split('/').rev());
                }
                node => {
                    if pending.is_empty() { continue; }
                    failed_at = current.len();
                    failure.get_or_insert_with(|| if node.is_some() { not_dir() } else {
                        format!("ENOENT: no such file or directory, lstat '{}'",display(&current))
                    });
                }
            }
        }
        if matches!(current.as_str(),"/"|"/dev"|"/dev/null") && let Some(error) = failure { return Err(error); }
        Ok(current)
    }

    fn mkdir_nodes(&self, state: &mut MemoryState, path: &str, recursive: bool, mode: u32) -> Result<(), (String, &'static str, String)> {
        if mode > 0o7777 { return Err(("EINVAL".into(), "mkdir", path.to_owned())); }
        super::path::walk_memory_entry(path, state.limits.max_symlink_hops, recursive, |entry, last| {
            match state.nodes.get(entry) {
                Some(_) if last && !recursive => return Err("EEXIST".into()),
                Some(MemoryNode::Symlink { target, .. }) => return Ok(Some(target.to_string())),
                Some(MemoryNode::Directory { mode, .. }) => {
                    if !last && mode & 0o100 == 0 { return Err("EACCES".into()); }
                }
                Some(_) => return Err(if last { "EEXIST" } else { "ENOTDIR" }.into()),
                None if !recursive && !last => return Err("ENOENT".into()),
                None => {
                    let parent = crate::vfs::dirname_posix_path(entry);
                    if !matches!(state.nodes.get(&parent), Some(MemoryNode::Directory {mode, ..}) if mode & 0o300 == 0o300) {
                        return Err("EACCES".into());
                    }
                    if state.entry_count() >= state.limits.max_entries { return Err("ENOSPC".into()); }
                    state.create_directory(entry.to_owned(), 0o40000 | mode);
                    self.bump_generation();
                    if !last && mode & 0o100 == 0 { return Err("EACCES".into()); }
                }
            }
            Ok(None)
        }).map(|_| ()).map_err(|error| {
            let code = error.split(':').next().unwrap();
            let p = if !recursive && matches!(code, "ENOENT" | "ENOTDIR" | "ENAMETOOLONG" | "ELOOP") { path.trim_end_matches('/') } else { path };
            (code.to_owned(), "mkdir", p.to_owned())
        })
    }

    fn terminal_dot(path: &str) -> bool {
        matches!(path.trim_end_matches('/').rsplit('/').next(),Some("." | ".."))
    }

    fn mutation_entry(state: &MemoryState, path: &str) -> Result<String, String> {
        let entry = Self::resolve_mutation_entry(state,path)?;
        if Self::terminal_dot(path) { return Err("EINVAL: invalid argument".into()); }
        Ok(entry)
    }

    fn resolve_mutation_entry(state: &MemoryState, path: &str) -> Result<String, String> {
        super::path::walk_memory_entry(path, state.limits.max_symlink_hops, false, |parent, last| {
            if last { return Ok(None); }
            match state.nodes.get(parent) {
                Some(MemoryNode::Directory { mode, .. }) if mode & 0o100 == 0 => Err("EACCES: permission denied".into()),
                Some(MemoryNode::Directory { .. }) => Ok(None),
                Some(MemoryNode::Symlink { target, .. }) => Ok(Some(target.to_string())),
                Some(_) => Err("ENOTDIR: not a directory".into()),
                None if state.devices.entry(parent).is_some_and(|n| !n.is_empty()) => Err("ENOTDIR: not a directory".into()),
                None => Err("ENOENT: no such file or directory".into()),
            }
        })
    }

    fn remove_entry(&self, path: &str, publication: Option<u64>) -> Result<bool, String> {
        let mut guard = self.state.write().map_err(|e| e.to_string())?;
        if publication.is_none() && guard.devices == Devices::Null { Self::check_device_mutation_operand(&guard, path)?; }
        let resolved = Self::mutation_entry(&guard, path)?;
        if guard.devices == Devices::Mounted && resolved != "/" && guard.devices.entry(&resolved).is_some() {
            return Err("ENOTSUP: operation not supported".into());
        }
        if resolved == "/" || guard.devices.entry(&resolved).is_some() {
            return Err("EBUSY: resource busy or locked".into());
        }
        if let Some(expected) = publication {
            let norm = normalize_posix_path(path);
            if resolved != norm {
                return Ok(false);
            }
            if !matches!(guard.nodes.get(&resolved), Some(MemoryNode::File { ino }) if guard.files[ino].publication == Some(expected)) {
                return Ok(false);
            }
        } else {
            let node = guard.nodes.get(&resolved).ok_or("ENOENT: no such file or directory")?;
            let directory = matches!(node, MemoryNode::Directory { .. });
            if !directory && path.ends_with('/') { return Err("ENOTDIR: not a directory".into()); }
            let parent = super::dirname_posix_path(&resolved);
            if !matches!(guard.nodes.get(&parent), Some(MemoryNode::Directory { mode, .. }) if mode & 0o300 == 0o300) {
                return Err("EACCES: permission denied".into());
            }
            if directory {
                let prefix = format!("{resolved}/");
                let mut children = Vec::new();
                for (child, _) in guard.nodes.range(prefix.clone()..).take_while(|(k, _)| k.starts_with(&prefix)) {
                    let (parent, _) = child.rsplit_once('/').unwrap();
                    if !matches!(guard.nodes.get(parent), Some(MemoryNode::Directory { mode, .. }) if mode & 0o700 == 0o700) {
                        return Err("EACCES: permission denied".into());
                    }
                    children.push(child.clone());
                }
                for child in children { Self::unlink_locked(&mut guard, &child); }
            }
        }
        Self::unlink_locked(&mut guard, &resolved);
        self.bump_generation();
        Ok(true)
    }

    fn unlink_locked(guard: &mut MemoryState, k: &str) {
        let Some(mut node) = guard.take_node(k) else { return };
        let now = super::now_ms();
        guard.parent_changed(k, now);
        node.status_changed(&mut guard.files, now);
        if matches!(node, MemoryNode::Directory { .. }) { node.detach_directory_reads(); guard.removed_directory(k); return; }
        let ino = node.ino();
        if let Some(extra) = guard.extra_links.get_mut(&ino) {
            extra.extra -= 1;
            if extra.extra == 0 { guard.extra_links.remove(&ino); }
            if let Some(file) = guard.files.get_mut(&ino) { file.publication = None; }
        } else if let Some(file) = guard.files.get_mut(&ino) {
            file.linked = false;
            if file.opens == 0 { guard.total_bytes -= guard.files.remove(&ino).unwrap().data.len(); }
        }
    }

    fn ensure_parent_dirs_locked(state: &mut MemoryState, path: &str) -> Result<(), FsError> {
        let norm = normalize_posix_path(path);
        if norm.len() > 255 && norm.split('/').any(|part| part.len() > 255) {
            return Err(FsError::new(FsErrorCode::InvalidInput, "ENAMETOOLONG: name too long"));
        }
        let mut ancestors = Vec::new();
        let mut cur = parent_posix_path(&norm);
        while let Some(p) = cur {
            if p == "/" {
                break;
            }
            ancestors.push(p.clone());
            cur = parent_posix_path(&p);
        }
        ancestors.reverse();
        for dir in ancestors {
            let resolved = Self::resolve_symlinks_locked(state, &dir, true)?;
            match state.nodes.get(&resolved) {
                Some(MemoryNode::Directory { .. }) => {}
                Some(_) => {
                    return Err(FsError::new(
                        FsErrorCode::NotDirectory,
                        format!("ENOTDIR: not a directory '{resolved}'"),
                    ));
                }
                None => {
                    if state.entry_count() >= state.limits.max_entries {
                        return Err(FsError::new(
                            FsErrorCode::NoSpace,
                            "ENOSPC: inode limit exceeded",
                        ));
                    }
                    state.create_directory(resolved, 0o40777);
                }
            }
        }
        Ok(())
    }

    fn read_bytes(&self, path: &str, budget: Option<&crate::ExecutionBudget>) -> Result<Vec<u8>, String> {
        let norm = normalize_posix_path(path);
        let mut guard = self.state.write().map_err(|e| e.to_string())?;
        let resolved = Self::resolve_symlinks_locked(&guard, &norm, true).map_err(|e| e.message);
        let device = resolved.as_ref().ok().and_then(|entry| guard.devices.entry(entry));
        if matches!(device, None | Some("full")) && let Ok(entry) = &resolved && let Some(&MemoryNode::File { ino }) = guard.nodes.get(entry) {
            let file = guard.files.get_mut(&ino).unwrap();
            if file.mode & 0o400 != 0 {
                file.atime_ms = super::now_ms();
                if let Some(budget) = budget {
                    if file.data.len() > budget.limits.max_input_bytes {
                        return Err(budget.record_exceeded(crate::ShellLimits::limit_error("maxInputBytes", budget.limits.max_input_bytes)));
                    }
                    budget.tick_fs_op()?;
                }
                return Ok(file.data.to_vec());
            }
        }
        if let Some(budget) = budget { budget.tick_fs_op()?; }
        if device == Some("") {
            return Err(format!("EISDIR: illegal operation on a directory, read '{norm}'"));
        }
        if device == Some("null") {
            return Ok(Vec::new());
        }
        if device == Some("zero") {
            return Ok(vec![0u8; 65536]);
        }
        if matches!(device, Some("urandom" | "random")) {
            drop(guard);
            let mut buf = vec![0u8; 4096];
            fill_random(&mut buf)?;
            return Ok(buf);
        }
        match guard.nodes.get(&resolved?) {
            Some(MemoryNode::File { .. }) => Err("EACCES: permission denied".into()),
            Some(MemoryNode::Directory { .. }) => {
                Err(format!("EISDIR: illegal operation on a directory, read '{norm}'"))
            }
            Some(MemoryNode::Symlink { .. }) => {
                Err(format!("ELOOP: unresolved symlink '{norm}'"))
            }
            None => Err(format!("ENOENT: no such file or directory, open '{norm}'")),
        }
    }
}

impl SafeBashFs for MemoryVfs {
    fn memory_backend(&self) -> Option<&MemoryVfs> { Some(self) }
    fn scratch_file(&self, directory: &str) -> Result<std::rc::Rc<dyn super::OpenRedirectFile>, String> {
        let mut state = self.state.write().map_err(|e| e.to_string())?;
        let child = Self::mutation_entry(&state, &format!("{}/.storage", directory.trim_end_matches('/')))?;
        let parent = super::dirname_posix_path(&child);
        match state.nodes.get(&parent) {
            Some(MemoryNode::Directory { mode, .. }) if mode & 0o300 == 0o300 && state.devices != Devices::Mounted => {}
            _ => return Err("EACCES: permission denied".into()),
        }
        if state.entry_count() >= state.limits.max_entries { return Err("ENOSPC: inode limit exceeded".into()); }
        let ino = state.allocate_ino();
        let now = super::now_ms();
        state.files.insert(ino, MemoryFile { revision: 0, data: Arc::default(), publication: None, mode: 0o100600,
            atime_ms: now, mtime_ms: now, ctime_ms: now, birthtime_ms: now, opens: 1, linked: false });
        Ok(std::rc::Rc::new(RetainedFile { fs: self.clone(), ino, access: super::RedirectAccess::ReadWrite }))
    }

    fn supports_command_descriptor(&self, _entry: &str) -> bool { true }

    fn open_redirect_file(&self, path: &str, access: crate::vfs::RedirectAccess, create_mode: Option<u32>) -> Result<Option<std::rc::Rc<dyn super::OpenRedirectFile>>, String> {
        let mut state = self.state.write().map_err(|e| e.to_string())?;
        let exclusive = access == super::RedirectAccess::Exclusive;
        let entry = if exclusive { Self::mutation_entry(&state, path)? } else {
            Self::resolve_symlinks_locked(&state, path, true).map_err(|e| e.message)?
        };
        if let Some(name) = state.devices.entry(&entry) {
            if name.is_empty() {
                return Err(if exclusive { "EEXIST: file already exists" } else { "EISDIR: illegal operation on a directory" }.into());
            }
            if matches!(access, super::RedirectAccess::Read | super::RedirectAccess::ReadWrite)
                && matches!(name, "zero" | "random" | "urandom")
            {
                return Ok(Some(std::rc::Rc::new(descriptor::DeviceInput {
                    random: name != "zero", writable: access == super::RedirectAccess::ReadWrite,
                })));
            }
            return Ok(None);
        }
        if exclusive && (state.nodes.contains_key(&entry) || state.devices.entry(&entry).is_some()) {
            return Err("EEXIST: file already exists".into());
        }
        let ino = match state.nodes.get(&entry) {
            Some(&MemoryNode::File { ino }) => {
                let required = match access { super::RedirectAccess::Read => 0o400, super::RedirectAccess::ReadWrite => 0o600, _ => 0o200 };
                if state.files[&ino].mode & required != required { return Err("EACCES: permission denied".into()); }
                ino
            }
            Some(_) => return Err("EISDIR: illegal operation on a directory".into()),
            None => {
                let create_mode = create_mode.ok_or("ENOENT: no such file or directory")?;
                if access == super::RedirectAccess::Read || state.devices == Devices::Mounted { return Err("ENOENT: no such file or directory".into()); }
                let parent = super::dirname_posix_path(&entry);
                match state.nodes.get(&parent) {
                    Some(MemoryNode::Directory { mode, .. }) if mode & 0o300 == 0o300 => {}
                    Some(MemoryNode::Directory { .. }) => return Err("EACCES: permission denied".into()),
                    Some(_) => return Err("ENOTDIR: not a directory".into()),
                    None => return Err("ENOENT: no such file or directory".into()),
                }
                Self::store_file(&mut state, entry.clone(), &[], 0o100000 | (create_mode & 0o7777), None, None)?;
                self.bump_generation();
                let MemoryNode::File { ino } = state.nodes[&entry] else { unreachable!() };
                ino
            }
        };
        state.files.get_mut(&ino).unwrap().opens += 1;
        drop(state);
        let file = RetainedFile { fs: self.clone(), ino, access };
        if access == super::RedirectAccess::Truncate { file.truncate(0)?; }
        Ok(Some(std::rc::Rc::new(file)))
    }

    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        self.read_bytes(&self.access_path(path, true)?, None)
    }

    fn read_single_chunk_input(&self, path: &str, budget: Option<&crate::ExecutionBudget>) -> Result<Vec<u8>, String> {
        match self.access_path(path, true) {
            Ok(entry) => self.read_bytes(&entry, budget),
            Err(e) => {
                if let Some(budget) = budget { budget.tick_fs_op()?; }
                Err(e)
            }
        }
    }

    fn open_read_file(&self, path: &str, allow_directory: bool) -> Result<Box<dyn super::FileReadHandle>, String> {
        let revision = self.generation();
        let path = self.access_path(path, true)?;
        let mut state = self.state.write().map_err(|e| e.to_string())?;
        if self.generation() != revision { return Err("EAGAIN: path changed during open".into()); }
        let st = self.resolved_metadata(&state, &path).ok_or_else(|| format!("ENOENT: no such file or directory, lstat '{path}'"))?;
        if st.kind == VfsEntryKind::Directory {
            if !allow_directory { return Err("EISDIR: illegal operation on a directory".into()); }
            if st.mode & 0o400 == 0 { return Err("EACCES: permission denied".into()); }
            let Some(MemoryNode::Directory { retained, .. }) = state.nodes.get_mut(&path) else {
                return Err("ENOTSUP: operation not supported".into());
            };
            let location = retained.upgrade().unwrap_or_else(|| {
                let handle = Arc::new(std::sync::Mutex::new(DirectoryReadState { path: Some(path), stat: st }));
                *retained = Arc::downgrade(&handle);
                handle
            });
            return Ok(Box::new(descriptor::RetainedDirectory { fs: self.clone(), location }));
        }
        if st.mode & 0o170000 != 0o100000 { return Err("ENOTSUP: operation not supported".into()); }
        if st.mode & 0o400 == 0 { return Err("EACCES: permission denied".into()); }
        let ino = state.nodes[&path].ino();
        state.files.get_mut(&ino).unwrap().opens += 1;
        Ok(Box::new(RetainedFile { fs: self.clone(), ino, access: super::RedirectAccess::Read }))
    }

    fn open_stream_reader(&self, path: &str) -> Result<Box<dyn super::FileReadHandle>, String> {
        Ok(Box::new(self.stream_snapshot(&self.access_path(path,true)?)?))
    }

    fn open_chunks(&self, path: &str) -> Result<super::ChunkReader<'_>, String> {
        self.open_chunks_sized(path, std::num::NonZeroUsize::new(65536).unwrap())
    }

    fn open_chunks_sized(&self, path: &str, size: std::num::NonZeroUsize) -> Result<super::ChunkReader<'_>, String> {
        let size = size.get().min(65536);
        let resolved = self.access_path(path, true)?;
        let devices = self.state.read().map_err(|e| e.to_string())?.devices;
        match devices.entry(&resolved) {
            Some("null") => Ok(Box::new(|chunk| { chunk.clear(); Ok(()) })),
            Some(name @ ("zero" | "random" | "urandom")) => {
                let random = name != "zero";
                Ok(Box::new(move |chunk| {
                    chunk.resize(size, 0);
                    if random { fill_random(chunk)?; } else { chunk.fill(0); }
                    Ok(())
                }))
            }
            Some("") => Err(format!("EISDIR: illegal operation on a directory, read '{path}'")),
            _ => {
                let mut snapshot = Some(self.stream_snapshot(&resolved)?);
                let mut offset = 0;
                Ok(Box::new(move |chunk| {
                    chunk.clear();
                    if let Some(stream) = &snapshot {
                        let data = stream.data.as_ref().unwrap();
                        let end = data.len().min(offset + size);
                        chunk.extend_from_slice(&data[offset..end]);
                        offset = end;
                        if chunk.is_empty() { snapshot = None; }
                    }
                    Ok(())
                }))
            }
        }
    }

    fn commit_file_edit(&self, path: &str, original: &FileStat, before: &[u8], after: &[u8], in_place: bool) -> Result<(), String> {
        let mut state = self.state.write().map_err(|_| "EIO: input/output error")?;
        let entry = Self::mutation_entry(&state, path)?;
        self.check_edit(&state, &entry, original, before, in_place)?;
        if in_place {
            Self::store_file(&mut state, entry, after, original.mode, None, None)?;
        } else {
            let parent = super::dirname_posix_path(&entry);
            if !matches!(state.nodes.get(&parent), Some(MemoryNode::Directory { mode, .. }) if mode & 0o300 == 0o300) {
                return Err("EACCES: permission denied".into());
            }
            Self::replace_inode(&mut state, entry, after, original.mode)?;
        }
        self.bump_generation();
        Ok(())
    }

    fn create_file(&self, path: &str, data: &[u8], mode: u32) -> Result<(), String> {
        let mut state = self.state.write().map_err(|_| "EIO: input/output error")?;
        let entry = Self::mutation_entry(&state, path)?;
        if entry != path { return Err("EAGAIN: resolved entry changed".into()); }
        if state.nodes.contains_key(path) || state.devices.entry(path).is_some() { return Err("EEXIST: file already exists".into()); }
        if state.devices == Devices::Mounted { return Err("EROFS: read-only file system".into()); }
        if mode > 0o7777 { return Err("EINVAL: invalid argument".into()); }
        let parent = super::dirname_posix_path(path);
        if !matches!(state.nodes.get(&parent), Some(MemoryNode::Directory { mode, .. }) if mode & 0o300 == 0o300) {
            return Err("EACCES: permission denied".into());
        }
        Self::store_file(&mut state, entry, data, 0o100000 | mode, None, None)?;
        self.bump_generation();
        Ok(())
    }

    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        self.write_bytes(path, data, false)
    }

    fn append_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        self.write_bytes(path, data, true)
    }

    fn patch_revision(&self, _path: &str) -> Result<(u64, u64), String> {
        Ok((self.id, self.generation()))
    }

    fn patch_file(&self, path: &str, bytes: Option<&[u8]>, expected: (u64, u64)) -> Result<u64, String> {
        let mut state = self.state.write().map_err(|e| e.to_string())?;
        if (self.id, self.generation()) != expected {
            return Err(format!("target changed since preflight: {path}"));
        }
        if path == "/" || !path.starts_with('/') || normalize_posix_path(path) != path
            || state.devices == Devices::Mounted || state.devices.entry(path).is_some() {
            return Err(format!("target is not a regular file: {path}"));
        }
        if path.len() > 255 && path.split('/').any(|part| part.len() > 255) {
            return Err("ENAMETOOLONG: name too long".into());
        }
        let mut parent_mode = match state.nodes.get("/") {
            Some(MemoryNode::Directory { mode, .. }) => *mode,
            _ => return Err("missing VFS root".into()),
        };
        let mut missing = Vec::new();
        for (i, _) in path.match_indices('/').skip(1) {
            let dir = &path[..i];
            match state.nodes.get(dir) {
                Some(MemoryNode::Directory { mode, .. }) => { parent_mode = *mode; }
                Some(_) => return Err(format!("not a directory: {dir}")),
                None if state.devices.entry(dir) == Some("") => {}
                None if state.devices.entry(dir).is_some() => return Err(format!("not a directory: {dir}")),
                None => missing.push(dir),
            }
        }
        let dest = match state.nodes.get(path) {
            Some(MemoryNode::File { .. }) | None => path.to_owned(),
            _ => return Err(format!("target is not a regular file: {path}")),
        };
        if let Some(data) = bytes {
            if matches!(state.nodes.get(&dest), Some(MemoryNode::File { ino }) if state.files[ino].data.as_slice() == data) {
                return Ok(expected.1);
            }
            if parent_mode & 0o300 != 0o300 { return Err(format!("EACCES: {path}")); }
            let needed = missing.len() + usize::from(!state.nodes.contains_key(&dest));
            if needed > state.limits.max_entries.saturating_sub(state.entry_count()) {
                return Err("ENOSPC: inode limit exceeded".into());
            }
            Self::store_file(&mut state, dest, data, 0o100666, None, None)?;
            for dir in missing {
                state.create_directory(dir.to_owned(), 0o40777);
            }
        } else {
            if parent_mode & 0o300 != 0o300 { return Err(format!("EACCES: {path}")); }
            if !state.nodes.contains_key(path) { return Err(format!("missing target: {path}")); }
            Self::unlink_locked(&mut state, path);
        }
        self.bump_generation();
        Ok(self.generation())
    }

    fn replace_file_batch(&self, mut files: Vec<(String, Vec<u8>, u32)>, version: u64) -> Result<(), String> {
        let mut state = self.state.write().map_err(|_| "EIO: input/output error")?;
        if version != self.generation() { return Err("EAGAIN: filesystem changed before replacement".into()); }
        for (path, _, _) in &mut files { *path = Self::mutation_entry(&state,path)?; }
        self.install_file_batch(&mut state, files, Vec::new())
    }

    fn replace_file_entry_with_metadata(&self, path: &str, data: &[u8], mode: u32, times: (Option<f64>, Option<f64>), version: u64) -> Result<(), String> {
        let mut state = self.state.write().map_err(|_| "EIO: input/output error")?;
        if version != self.generation() { return Err("EAGAIN: filesystem changed before replacement".into()); }
        let entry = Self::mutation_entry(&state, path)?;
        if state.devices == Devices::Mounted || state.devices.entry(&entry).is_some()
            || !matches!(state.nodes.get(&entry), None | Some(MemoryNode::File { .. })) {
            return Err("ENOTSUP: destination must be a regular file or absent".into());
        }
        let parent = super::dirname_posix_path(&entry);
        if !matches!(state.nodes.get(&parent), Some(MemoryNode::Directory { mode, .. }) if mode & 0o300 == 0o300) {
            return Err("EACCES: permission denied".into());
        }
        if mode > 0o7777 { return Err("EINVAL: invalid argument".into()); }
        if [times.0, times.1].into_iter().flatten().any(|t| !t.is_finite()) { return Err("EINVAL: invalid file timestamp".into()); }
        let ino = Self::replace_inode(&mut state, entry, data, 0o100000 | mode)?;
        state.files.get_mut(&ino).unwrap().set_times(times);
        self.bump_generation();
        Ok(())
    }

    fn publish_file(&self, path: &str, data: &[u8], inputs: &[String], version: u64) -> Result<u64, String> {
        let mut state = self.state.write().map_err(|e| e.to_string())?;
        if version != self.generation() {
            return Err("EAGAIN: filesystem changed before publication".into());
        }
        let entry = Self::resolve_symlinks_locked(&state, path, false).map_err(|e| e.message)?;
        let parent = parent_posix_path(&entry).unwrap_or_else(|| "/".into());
        if !matches!(state.nodes.get(&parent), Some(MemoryNode::Directory { .. })) {
            return Err(format!("ENOENT: ENOENT: no such file or directory, realpath '{parent}'"));
        }
        let dest = Self::resolve_symlinks_locked(&state, &entry, true).map_err(|e| e.message)?;
        let regular = matches!(state.nodes.get(&entry), None | Some(MemoryNode::File { .. }));
        if !regular || (state.devices == Devices::Mounted || state.devices.entry(&dest).is_some()) {
            return Err("INVALID_VALUE: Output must be a regular VFS file or absent".into());
        }
        for input in inputs {
            let input = Self::resolve_symlinks_locked(&state, input, true).map_err(|e| e.message)?;
            if input == dest || state.nodes.get(&input).is_some_and(|n| state.nodes.get(&dest).is_some_and(|d| d.ino() == n.ino())) {
                return Err("INVALID_VALUE: Input and output VFS identities must be distinct".into());
            }
        }
        let publication = NEXT_PUBLICATION.fetch_add(1, Ordering::Relaxed);
        Self::store_file(&mut state, dest, data, 0o100666, Some(publication), None)?;
        self.bump_generation();
        Ok(publication)
    }

    fn rename(&self, source: &str, destination: &str, no_replace: bool) -> Result<(), String> {
        let mut state = self.state.write().map_err(|_| "EIO: input/output error")?;
        if matches!(state.devices, Devices::Null | Devices::Extended) {
            Self::check_device_mutation_operand(&state,source)?;
            Self::check_device_mutation_operand(&state,destination)?;
        }
        let from = Self::resolve_mutation_entry(&state, source)?;
        if state.devices == Devices::Mounted {
            return Err(if state.devices.entry(&from).is_some() { "ENOTSUP: operation not supported" }
                else { "ENOENT: no such file or directory" }.into());
        }
        if state.devices.entry(&from).is_some() && from != "/" {
            return Err("EBUSY: resource busy or locked".into());
        }
        let node = state.nodes.get(&from).ok_or("ENOENT: no such file or directory")?;
        let is_dir = matches!(node, MemoryNode::Directory { .. });
        if source.ends_with('/') && !is_dir { return Err("ENOTDIR: not a directory".into()); }
        let to = Self::resolve_mutation_entry(&state, destination)?;
        let target = state.nodes.get(&to);
        let target_dir = matches!(target, Some(MemoryNode::Directory { .. }));
        if destination.ends_with('/') && target.is_some() && !target_dir {
            return Err("ENOTDIR: not a directory".into());
        }
        // The backing store resolves both entries (including trailing slash
        // requirements) before refusing dot names or the namespace root.
        if Self::terminal_dot(source) || Self::terminal_dot(destination) { return Err("EINVAL: invalid argument".into()); }
        if from == "/" || to == "/" || state.devices.entry(&to).is_some() {
            return Err("EBUSY: resource busy or locked".into());
        }
        if destination.ends_with('/') && !is_dir { return Err("ENOTDIR: not a directory".into()); }
        if no_replace && target.is_some() { return Err("EEXIST: file already exists".into()); }
        if from == to || target.is_some_and(|other| other.ino() == node.ino()) {
            return Ok(());
        }
        let prefix = format!("{from}/");
        if is_dir && to.starts_with(&prefix) { return Err("EINVAL: invalid argument".into()); }
        for path in [&from, &to] {
            let parent = parent_posix_path(path).unwrap();
            if let Some(MemoryNode::Directory { mode, .. }) = state.nodes.get(&parent)
                && mode & 0o300 != 0o300 { return Err("EACCES: permission denied".into()); }
        }
        if target.is_some() {
            if !is_dir && target_dir { return Err("EISDIR: illegal operation on a directory".into()); }
            if is_dir && !target_dir { return Err("ENOTDIR: not a directory".into()); }
            let children = format!("{to}/");
            if target_dir && state.nodes.range(children.clone()..).next().is_some_and(|(k, _)| k.starts_with(&children)) {
                return Err("ENOTEMPTY: directory not empty".into());
            }
            Self::unlink_locked(&mut state, &to);
        }
        let mut paths = vec![from.clone()];
        if is_dir {
            paths.extend(state.nodes.range(prefix.clone()..).take_while(|(k, _)| k.starts_with(&prefix)).map(|(k, _)| k.clone()));
        }
        for old in paths {
            let mut node = state.take_node(&old).unwrap();
            if old == from {
                let now = super::now_ms();
                state.parent_changed(&from, now);
                state.parent_changed(&to, now);
                node.status_changed(&mut state.files, now);
            }
            let new = format!("{to}{}", &old[from.len()..]);
            if matches!(node, MemoryNode::Directory { .. }) {
                state.removed_directory(&old);
                state.insert_directory(new, node);
            } else { state.insert_node(new, node); }
        }
        self.bump_generation();
        Ok(())
    }

    fn remove_one(&self, path: &str, directory: bool) -> Result<(), String> {
        let mut state = self.state.write().map_err(|_| "EIO: input/output error")?;
        if state.devices == Devices::Null {
            let entry = Self::device_operand(&state, path, false)?;
            if directory && entry == "/dev/null" { return Err(format!("ENOTDIR: not a directory '{path}'")); }
            if matches!(entry.as_str(), "/" | "/dev" | "/dev/null") {
                return Err(format!("EBUSY: resource busy or locked '{path}'"));
            }
        }
        Self::remove_one_locked(&mut state, path, directory).map_err(|e| {
            if directory && path.ends_with('/') && e == "ENOENT: no such file or directory" {
                format!("{e}, rmdir '{}'", path.trim_end_matches('/'))
            } else { e }
        })?;
        self.bump_generation();
        Ok(())
    }

    fn remove_path(&self, path: &str) -> Result<(), String> {
        self.remove_entry(path, None).map(|_| ())
    }

    fn supports_conditional_removal(&self, _path: &str) -> bool { true }
    fn remove_unchanged_entry(&self, path: &str, parent: &FileStat, expected: &FileStat) -> Result<(), String> {
        let mut state = self.state.write().map_err(|e| e.to_string())?;
        let entry = Self::mutation_entry(&state, path)?;
        let dir = self.resolved_metadata(&state, &super::dirname_posix_path(&entry));
        if entry != path || expected.revision.is_none()
            || !self.resolved_metadata(&state, path).is_some_and(|st| st.same_snapshot(expected))
            || !dir.as_ref().is_some_and(|st| st.identity.is_some() && st.identity == parent.identity) {
            return Err(format!("EBUSY: input changed; input retained '{path}'"));
        }
        Self::remove_one_locked(&mut state, path, expected.kind == VfsEntryKind::Directory)?;
        self.bump_generation();
        Ok(())
    }

    fn remove_published(&self, path: &str, publication: u64) -> Result<bool, String> {
        self.remove_entry(path, Some(publication))
    }

    fn mkdir(&self, path: &str, recursive: bool, mode: u32) -> Result<(), (String, String)> {
        self.mkdir_with_operation(path, recursive, mode, false).map_err(|(code, _, at)| (code, at))
    }

    fn rmdir_support(&self, path: &str, entry: Option<&str>) -> Result<crate::vfs::RmdirSupport, String> {
        let state = self.state.read().map_err(|_| "EIO: input/output error")?;
        let resolved;
        let entry = match entry {
            Some(entry) => entry,
            None if state.devices == Devices::Null => { resolved = Self::device_operand(&state, path, true)?; &resolved }
            None => path,
        };
        Ok(match (state.devices, entry) {
            (Devices::Null | Devices::Extended, "/dev") => super::RmdirSupport::Unsupported,
            (Devices::Mounted, _) => super::RmdirSupport::InspectDirectory,
            _ => super::RmdirSupport::Available,
        })
    }

    fn default_device_view(&self) -> bool {
        self.state.read().is_ok_and(|s| s.devices == Devices::Null)
    }

    fn mkdir_with_operation(&self, path: &str, recursive: bool, mode: u32, try_backing: bool) -> Result<(), (String, &'static str, String)> {
        let mut state = self.state.write().map_err(|_| ("EIO".into(), "mkdir", path.to_owned()))?;
        if !matches!(state.devices, Devices::Null | Devices::None) {
            drop(state);
            return super::mkdir::mkdir(path, recursive, mode, super::mkdir::Namespace::Direct, |p| (None, self, p.to_owned()))
                .map_err(|(code, at)| (code, "mkdir", at));
        }
        if state.devices == Devices::Null {
            // The shell can use stock, link-free memory directly for a single plain mkdir.
            // A failed attempt falls through with any parents already created.
            if try_backing && path != "/dev" && !path.starts_with("/dev/")
                && state.symlink_entries == 0
                && self.mkdir_nodes(&mut state, path, recursive, mode).is_ok() { return Ok(()); }
            let resolved = Self::device_operand(&state, path, true).map_err(|error| {
                let failed = error.split_once(" '").filter(|(reason, _)| reason.ends_with(", lstat")).and_then(|(_, p)| p.strip_suffix('\''));
                (error.split(':').next().unwrap().to_owned(), if failed.is_some() { "lstat" } else { "" }, failed.unwrap_or(path).to_owned())
            })?;
            if matches!(resolved.as_str(), "/" | "/dev" | "/dev/null") && !path.is_empty() {
                return if recursive && resolved != "/dev/null" { Ok(()) } else { Err(("EEXIST".into(), "", path.to_owned())) };
            }
        }
        self.mkdir_nodes(&mut state, path, recursive, mode)
    }

    fn mkdir_one(&self, path: &str, mode: u32) -> Result<(), String> {
        let mut state = self.state.write().map_err(|_| "EIO: input/output error")?;
        let path = Self::resolve_symlinks_locked(&state, path, false).map_err(|e| e.message)?;
        if state.devices == Devices::Mounted {
            return Err(if state.devices.entry(&path).is_some() { "EEXIST: file already exists" } else { "ENOTSUP: operation not supported" }.into());
        }
        if mode > 0o7777 { return Err("EINVAL: invalid argument".into()); }
        if state.nodes.contains_key(&path) || state.devices.entry(&path).is_some() {
            return Err("EEXIST: file already exists".into());
        }
        match state.nodes.get(&crate::vfs::dirname_posix_path(&path)) {
            Some(MemoryNode::Directory { mode, .. }) if mode & 0o300 == 0o300 => {}
            Some(MemoryNode::Directory { .. }) => return Err("EACCES: permission denied".into()),
            Some(_) => return Err("ENOTDIR: not a directory".into()),
            None => return Err("ENOENT: no such file or directory".into()),
        }
        if state.entry_count() >= state.limits.max_entries { return Err("ENOSPC: inode limit exceeded".into()); }
        state.create_directory(path, 0o40000 | (mode & 0o7777));
        self.bump_generation();
        Ok(())
    }

    fn mkdir_all(&self, path: &str) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        if norm == "/" {
            return Ok(());
        }
        let mut guard = self.state.write().map_err(|e| e.to_string())?;
        if guard.devices == Devices::Mounted { return Err(format!("EROFS: read-only device directory '{norm}'")); }
        Self::ensure_parent_dirs_locked(&mut guard, &norm).map_err(|e| e.message)?;
        let resolved = Self::resolve_symlinks_locked(&guard, &norm, true).map_err(|e| e.message)?;
        match guard.nodes.get(&resolved) {
            Some(MemoryNode::Directory { .. }) => {}
            Some(_) => {
                return Err(format!("EEXIST: file already exists, mkdir '{norm}'"));
            }
            None => {
                if guard.entry_count() >= guard.limits.max_entries {
                    return Err("ENOSPC: inode limit exceeded".to_string());
                }
                guard.create_directory(resolved, 0o40777);
            }
        }
        self.bump_generation();
        Ok(())
    }

    fn exists(&self, path: &str) -> bool {
        self.stat(path).is_ok()
    }

    fn is_dir(&self, path: &str) -> bool {
        self.stat(path).is_ok_and(|st| st.kind == VfsEntryKind::Directory)
    }

    fn link_free_memory(&self) -> bool {
        self.state.read().is_ok_and(|s| s.symlink_entries == 0)
    }

    fn indexed_directory_entry(&self, path: &str) -> Option<bool> {
        let (prefix, _) = path.trim_end_matches('/').rsplit_once('/')?;
        if prefix.ends_with('/') { return None; }
        let parent = if prefix.is_empty() { "/" } else { prefix };
        if parent == "/dev" || parent.starts_with("/dev/") || normalize_posix_path(parent) != parent {
            return None;
        }
        let state = self.state.read().ok()?;
        if !matches!(state.nodes.get(parent), Some(MemoryNode::Directory { mode, .. }) if mode & 0o500 == 0o500)
            || state.symlink_entries != 0 {
            return None;
        }
        Some(state.nodes.contains_key(path.trim_end_matches('/')))
    }

    fn list_dir(&self, path: &str) -> Result<Vec<String>, String> {
        Ok(self.directory_entries(path, usize::MAX)?.into_iter().map(|(n, _)| n).collect())
    }

    fn directory_entries(&self, path: &str, limit: usize) -> Result<Vec<(String, u32)>, String> {
        let norm = normalize_posix_path(path);
        let mut guard = self.state.write().map_err(|e| e.to_string())?;
        let resolved = Self::resolve_symlinks_locked(&guard, &norm, true).map_err(|e| e.message)?;
        let directory = guard.devices.entry(&resolved) == Some("");
        if matches!(guard.nodes.get(&resolved), Some(MemoryNode::Directory { mode, .. }) if mode & 0o400 == 0) {
            return Err(format!("EACCES: permission denied, readdir '{path}'"));
        }
        if !directory {
            match guard.nodes.get(&resolved) {
                Some(MemoryNode::Directory { .. }) => {}
                Some(_) => return Err(format!("ENOTDIR: not a directory, scandir '{norm}'")),
                None => return Err(format!("ENOENT: no such file or directory, scandir '{norm}'")),
            }
        }
        let prefix = if resolved == "/" { "/".into() } else { format!("{resolved}/") };
        let mut children = Vec::new();
        if directory {
            children.push(("null".into(), 0o020000));
            if matches!(guard.devices, Devices::Extended | Devices::Mounted) {
                children.extend(["random", "urandom", "zero"].map(|n| (n.to_owned(), 0o020000)));
            }
        } else if guard.devices != Devices::None && resolved == "/" {
            children.push(("dev".into(), 0o040000));
        }
        let device_count = children.len();
        if device_count > limit { return Err("EFBIG: directory entry limit exceeded".into()); }
        for (key, node) in guard.nodes.range(prefix.clone()..) {
            let Some(name) = key.strip_prefix(&prefix) else { break };
            if !name.is_empty() && !name.contains('/') && !children[..device_count].iter().any(|(n, _)| n == name) {
                if children.len() == limit { return Err("EFBIG: directory entry limit exceeded".into()); }
                let mode = match node {
                    MemoryNode::File { .. } => 0o100000,
                    MemoryNode::Directory { .. } => 0o040000,
                    MemoryNode::Symlink { .. } => 0o120000,
                };
                children.push((name.to_owned(), mode));
            }
        }
        if let Some(MemoryNode::Directory { atime_ms, .. }) = guard.nodes.get_mut(&resolved) {
            *atime_ms = super::now_ms();
        }
        Ok(children)
    }

    fn needs_readlink_lookup(&self, path: &str) -> bool {
        let Ok(state) = self.state.read() else { return true; };
        if state.devices != Devices::Null { return state.devices != Devices::None; }
        if state.symlink_entries != 0 || !path.starts_with('/') || path == "/dev" || path.starts_with("/dev/") { return true; }
        // The device view skips its capability lookup only for clean paths with searchable ancestors.
        let mut parent = "/";
        for (index, part) in path[1..].split('/').enumerate() {
            if index >= 256 || part.len() > 255 || matches!(part, "" | "." | "..") || part.contains('\0') { return true; }
            match state.nodes.get(parent) {
                Some(MemoryNode::Directory { mode, .. }) if mode & 0o100 != 0 => {}
                None => {}
                _ => return true,
            }
            parent = &path[..parent.trim_end_matches('/').len() + 1 + part.len()];
        }
        false
    }

    fn readlink_supported(&self, path: &str) -> Result<bool, String> {
        let state = self.state.read().map_err(|_| "EIO: input/output error")?;
        let entry = Self::device_operand(&state, path, true)?;
        Ok(state.devices != Devices::Mounted && state.devices.entry(&entry).is_none())
    }

    fn supports_symbolic_links(&self, entry: &str) -> bool {
        self.state.read().is_ok_and(|s| s.devices != Devices::Mounted && s.devices.entry(entry).is_none())
    }

    fn supports_hard_links(&self, path: &str) -> bool {
        self.state.read().is_ok_and(|s| s.devices != Devices::Mounted && !s.devices.protects_hard_link(path))
    }

    fn hard_link(&self, source: &str, destination: &str) -> Result<(), String> {
        let mut state = self.state.write().map_err(|_| "EIO: input/output error")?;
        if state.devices == Devices::Mounted { return Err("ENOTSUP: operation not supported".into()); }
        let src = Self::mutation_entry(&state, source)?;
        if state.devices.protects_hard_link(&src) { return Err("EBUSY: resource busy or locked".into()); }
        let node = state.nodes.get(&src).ok_or("ENOENT: no such file or directory")?.clone();
        if matches!(node, MemoryNode::Directory { .. }) { return Err("EPERM: operation not permitted".into()); }
        let dst = Self::mutation_entry(&state, destination)?;
        if state.devices.protects_hard_link(&dst) { return Err("EBUSY: resource busy or locked".into()); }
        if state.nodes.contains_key(&dst) { return Err("EEXIST: file already exists".into()); }
        if !matches!(state.nodes.get(&super::dirname_posix_path(&dst)), Some(MemoryNode::Directory { mode, .. }) if mode & 0o300 == 0o300) {
            return Err("EACCES: permission denied".into());
        }
        Self::link_node(&mut state, node, dst)?;
        self.bump_generation();
        Ok(())
    }

    fn symlink(&self, target: &str, path: &str) -> Result<(), String> {
        let mut guard = self.state.write().map_err(|e| e.to_string())?;
        if guard.devices == Devices::Null { Self::check_device_mutation_operand(&guard, path)?; }
        if target.is_empty() { return Err("ENOENT: no such file or directory, symlink ''".into()); }
        if target.contains('\0') { return Err(format!("EINVAL: invalid argument, symlink '{target}'")); }
        if guard.devices == Devices::Mounted { return Err(format!("EROFS: read-only device directory '{path}'")); }
        let directory;
        let operand = if path.ends_with('/') { directory = format!("{path}."); &directory } else { path };
        let resolved = Self::resolve_mutation_entry(&guard, operand).map_err(|e| format!("{e}, symlink '{path}'"))?;
        if guard.nodes.contains_key(&resolved) || guard.devices.entry(&resolved).is_some() {
            return Err(format!("EEXIST: file already exists, symlink '{path}'"));
        }
        if !matches!(guard.nodes.get(&super::dirname_posix_path(&resolved)), Some(MemoryNode::Directory { mode, .. }) if mode & 0o300 == 0o300) {
            return Err(format!("EACCES: permission denied, symlink '{path}'"));
        }
        if guard.entry_count() >= guard.limits.max_entries {
            return Err("ENOSPC: inode limit exceeded".to_string());
        }
        let now = super::now_ms();
        guard.parent_changed(&resolved, now);
        let ino = guard.allocate_ino();
        guard.insert_node(
            resolved,
            MemoryNode::Symlink {
                ino,
                target: Arc::from(target),
                status: SymlinkStatus::new(0o120777, now),
                atime_ms: now, mtime_ms: now, birthtime_ms: now,
            },
        );
        self.bump_generation();
        Ok(())
    }

    fn readlink(&self, path: &str) -> Result<String, String> {
        let bytes = self.readlink_bytes(path).map_err(|e| e.message)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    fn inspect_command_entry(&self, path: &str, follow: bool, syscall: &str) -> Result<(String, FileStat), String> {
        if syscall == "readlink" {
            let state = self.state.read().map_err(|e| e.to_string())?;
            if state.devices == Devices::Null && matches!(Self::device_operand(&state, path, false)?.as_str(), "/" | "/dev" | "/dev/null") {
                return Err(format!("EINVAL: invalid argument '{path}'"));
            }
        }
        let entry = self.access_path(path, follow).or_else(|error| {
            if error.starts_with("EACCES:") {
                let state = self.state.read().map_err(|e| e.to_string())?;
                if state.devices == Devices::Null {
                    // Device lookup can resolve a virtual entry without traversing the backing directory's "..".
                    let device = Self::device_operand(&state, path, follow)?;
                    if matches!(device.as_str(), "/dev" | "/dev/null") { return Ok(device); }
                }
            }
            Err(error)
        })?;
        self.lstat(&entry).map(|st| (entry, st)).map_err(|error| {
            if syscall == "readlink" && error.starts_with("ENOENT:") { format!("ENOENT: no such file or directory, readlink '{path}'") }
            else { error }
        })
    }

    fn stat(&self, path: &str) -> Result<FileStat, String> {
        self.metadata(path, true)
    }

    fn lstat(&self, path: &str) -> Result<FileStat, String> {
        self.metadata(path, false)
    }

    fn chmod(&self, path: &str, mode: u32) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        let mut guard = self.state.write().map_err(|e| e.to_string())?;
        let resolved = Self::resolve_symlinks_locked(&guard, &norm, true).map_err(|e| e.message)?;
        self.set_mode_locked(&mut guard, &resolved, mode)
    }

    fn set_times(&self, path: &str, atime_ms: Option<f64>, mtime_ms: Option<f64>) -> Result<(), String> {
        if atime_ms.is_some_and(|t| !t.is_finite()) || mtime_ms.is_some_and(|t| !t.is_finite()) {
            return Err(format!("EINVAL: invalid argument, utimes '{path}'"));
        }
        let norm = normalize_posix_path(path);
        let mut guard = self.state.write().map_err(|e| e.to_string())?;
        let resolved = Self::resolve_symlinks_locked(&guard, &norm, true).map_err(|e| e.message)?;
        match guard.nodes.get_mut(&resolved) {
            Some(MemoryNode::File { ino }) => {
                let ino = *ino;
                let file = guard.files.get_mut(&ino).unwrap();
                file.publication = None;
                file.status_changed(super::now_ms());
                if let Some(value) = atime_ms { file.atime_ms = value; }
                if let Some(value) = mtime_ms { file.mtime_ms = value; }
            }
            Some(MemoryNode::Directory { atime_ms: a, mtime_ms: m, ctime_ms, revision, .. }) => {
                *revision += 1;
                *ctime_ms = super::now_ms();
                if let Some(value) = atime_ms { *a = value; }
                if let Some(value) = mtime_ms { *m = value; }
            }
            Some(MemoryNode::Symlink { .. }) => return Err("ELOOP: unresolved symlink".into()),
            None => return Err(format!("ENOENT: no such file or directory, utime '{norm}'")),
        }
        self.bump_generation();
        Ok(())
    }

    fn generation(&self) -> u64 {
        self.generation.load(Ordering::Relaxed)
    }

    fn fs_id(&self) -> u64 {
        self.id
    }

    fn export_entries(&self) -> Result<Vec<VfsFileEntry>, String> {
        let guard = self.state.read().map_err(|e| e.to_string())?;
        let mut out = Vec::with_capacity(guard.nodes.len());
        let mut shared = HashMap::<u64, Arc<[u8]>>::new();
        for (path, node) in &guard.nodes {
            if path == "/" {
                continue;
            }
            match node {
                MemoryNode::Directory { mode, .. } => {
                    out.push(VfsFileEntry {
                        path: path.clone(),
                        kind: VfsEntryKind::Directory,
                        data: Arc::default(),
                        link_group: None,
                        symlink_target: None,
                        mode: *mode,
                    });
                }
                MemoryNode::File { ino } => {
                    let file = &guard.files[ino];
                    out.push(VfsFileEntry {
                        path: path.clone(),
                        kind: VfsEntryKind::File,
                        data: if guard.extra_links.contains_key(ino) {
                            shared.entry(*ino).or_insert_with(|| Arc::from(file.data.as_slice())).clone()
                        } else { Arc::from(file.data.as_slice()) },
                        link_group: guard.extra_links.get(ino).map(|g| g.snapshot_id),
                        symlink_target: None,
                        mode: file.mode,
                    });
                }
                MemoryNode::Symlink { ino, target, status, .. } => {
                    out.push(VfsFileEntry {
                        path: path.clone(),
                        kind: VfsEntryKind::Symlink,
                        data: Arc::default(),
                        link_group: guard.extra_links.get(ino).map(|g| g.snapshot_id),
                        symlink_target: Some(target.to_string()),
                        mode: status.mode.load(Ordering::Relaxed),
                    });
                }
            }
        }
        Ok(out)
    }

    fn replace_entries(&self, entries: &[VfsFileEntry]) -> Result<(), String> {
        let mut current = self.state.write().map_err(|e| e.to_string())?;
        // Detached versions held by streams also survive replacement of the namespace.
        let released: usize = current.files.values().filter(|f| f.opens == 0).map(|f| f.data.len()).sum();
        let retained_bytes = current.total_bytes - released;
        let mut guard = MemoryState { next_ino: current.next_ino, devices: current.devices, nodes: BTreeMap::new(), symlink_entries: 0, files: HashMap::new(), extra_links: HashMap::new(), child_dirs: HashMap::new(),
            total_bytes: retained_bytes, staged_entries: current.staged_entries, limits: current.limits.clone() };
        let root_ino = guard.allocate_ino();
        guard.insert_directory(
            "/".to_string(),
            MemoryNode::directory(root_ino, 0o40755, super::now_ms()),
        );
        for entry in entries {
            if entry.kind == VfsEntryKind::Directory {
                let norm = normalize_posix_path(&entry.path);
                Self::ensure_parent_dirs_locked(&mut guard, &norm).map_err(|e| e.message)?;
                let ino = guard.allocate_ino();
                guard.insert_directory(
                    norm,
                    MemoryNode::directory(ino, if entry.mode != 0 { entry.mode } else { 0o40755 }, super::now_ms()),
                );
            }
        }
        let mut groups = HashMap::<u64, MemoryNode>::new();
        for entry in entries.iter().filter(|e| e.kind != VfsEntryKind::Directory) {
            let norm = normalize_posix_path(&entry.path);
            Self::ensure_parent_dirs_locked(&mut guard, &norm).map_err(|e| e.message)?;
            if guard.nodes.contains_key(&norm) { return Err("EINVAL: duplicate snapshot entry".into()); }
            if let Some(existing) = entry.link_group.and_then(|id| groups.get(&id)) {
                Self::link_node(&mut guard, existing.clone(), norm)?;
                continue;
            }
            if entry.kind == VfsEntryKind::File {
                Self::store_file(&mut guard, norm.clone(), &entry.data, if entry.mode != 0 { entry.mode } else { 0o100644 }, None, None)?;
            } else {
                let target = entry.symlink_target.clone().ok_or("EINVAL: missing symlink target")?;
                let now = super::now_ms();
                let ino = guard.allocate_ino();
                guard.insert_node(norm.clone(), MemoryNode::Symlink { ino,
                    target: target.into(), status: SymlinkStatus::new(if entry.mode != 0 { entry.mode } else { 0o120777 }, now), atime_ms: now, mtime_ms: now, birthtime_ms: now });
            }
            if let Some(group) = entry.link_group { groups.insert(group, guard.nodes[&norm].clone()); }
        }
        for (ino, mut file) in current.files.drain().filter(|(_, f)| f.opens != 0) {
            file.linked = false;
            guard.files.insert(ino, file);
        }
        for node in current.nodes.values() { node.detach_directory_reads(); }
        *current = guard;
        self.bump_generation();
        Ok(())
    }
}

pub struct GitFsView<'a>(&'a MemoryVfs);
impl GitFsView<'_> {
    pub fn readlink(&self, path: &str) -> Result<Vec<u8>, FsError> {
        self.0.readlink_bytes(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::SafeBashFs;

    #[test]
    fn link_free_paths_require_the_last_symlink_name_to_be_gone() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/d").unwrap();
        fs.symlink("/missing", "/d/link").unwrap();
        fs.hard_link("/d/link", "/second").unwrap();
        let snapshot = fs.export_entries().unwrap();
        fs.rename("/d", "/renamed", false).unwrap();
        fs.remove_path("/renamed").unwrap();
        assert!(!fs.link_free_memory());
        fs.remove_one("/second", false).unwrap();
        assert!(fs.link_free_memory());
        fs.replace_entries(&snapshot).unwrap();
        assert!(!fs.link_free_memory());
        fs.write_file("/ordinary", b"data").unwrap();
        fs.rename("/ordinary", "/second", false).unwrap();
        assert!(!fs.link_free_memory());
        fs.remove_one("/d/link", false).unwrap();
        assert!(fs.link_free_memory());
    }

    #[test]
    fn mkdir_below_virtual_dev_uses_the_backing_directory() {
        let fs = MemoryVfs::new();
        fs.set_devices(Devices::Null);
        assert_eq!(fs.mkdir("/dev/../out", false, 0o755).unwrap_err().0, "ENOENT");
        assert!(!fs.exists("/out"));
        fs.mkdir("/dev/sub", true, 0o700).unwrap();
        assert_eq!(fs.stat("/dev/sub").unwrap().mode & 0o777, 0o700);
        assert_eq!(fs.stat("/dev").unwrap().mode & 0o777, 0o755);
        fs.set_devices(Devices::None);
        assert_eq!(fs.stat("/dev").unwrap().mode & 0o777, 0o700);
    }

    #[test]
    fn rename_inspects_both_entries_before_rejecting_terminal_dots() {
        let fs = MemoryVfs::new();
        fs.set_devices(Devices::None);
        fs.write_file("/d/file",b"keep").unwrap();
        fs.mkdir_all("/locked").unwrap();
        fs.chmod("/locked",0).unwrap();
        fs.symlink("/d","/link").unwrap();
        for (from,to,reason) in [
            ("/.","/missing/child","ENOENT"), ("/d/.","/d/file/","ENOTDIR"),
            ("/","/link/","ENOTDIR"), ("/d/.","/locked/..","EACCES"),
            ("/d/.","/absent","EINVAL"), ("/d/file","/d/..","EINVAL"),
        ] {
            assert_eq!(fs.rename(from,to,false).unwrap_err().split(':').next(),Some(reason),"{from} -> {to}");
        }
        assert_eq!(fs.read_file("/d/file").unwrap(),b"keep");
    }

    #[test]
    fn only_one_publisher_can_use_a_file_revision() {
        let fs = MemoryVfs::new();
        fs.write_file("/out", b"old").unwrap();
        let parent = fs.stat("/").unwrap();
        let expected = fs.stat("/out").unwrap();
        let start = std::sync::Barrier::new(2);
        let publish = |bytes: &'static [u8]| {
            start.wait();
            fs.mutate_file_conditional("/out", &parent, Some(&expected), Some(ConditionalFileWrite {
                bytes, append: false, mode: 0o666, atime_ms: None, mtime_ms: None,
            }))
        };
        let (a,b) = std::thread::scope(|scope| {
            let first = scope.spawn(|| publish(b"first"));
            let second = publish(b"second");
            (first.join().unwrap(), second)
        });
        let (winner, stale, bytes) = if a.is_ok() { (a,b,b"first".as_slice()) } else { (b,a,b"second".as_slice()) };
        assert_eq!(winner.unwrap().unwrap(), fs.stat("/out").unwrap());
        assert!(stale.unwrap_err().starts_with("EAGAIN:"));
        assert_eq!(fs.read_file("/out").unwrap(), bytes);
    }

    #[test]
    fn conditional_chmod_checks_receipts_and_modifies_the_symlink_inode() {
        let fs = MemoryVfs::new();
        fs.mkdir("/d", false, 0o755).unwrap();
        fs.write_file("/d/target", b"data").unwrap();
        fs.symlink("target","/d/link").unwrap();
        fs.hard_link("/d/link","/alias").unwrap();
        let dir = fs.lstat("/d").unwrap();
        let chain = [("/",fs.lstat("/").unwrap()), ("/d",dir.clone())];
        let symlink = fs.lstat("/d/link").unwrap();
        fs.chmod_conditional("/d/link",0o601,&chain,&dir,&symlink).unwrap();
        assert_eq!(fs.lstat("/alias").unwrap().mode,0o120601);
        assert_eq!(fs.stat("/d/link").unwrap().mode,0o100644);
        assert!(fs.chmod_conditional("/d/link",0o777,&chain,&dir,&symlink).unwrap_err().starts_with("EAGAIN:"));
        let target = fs.stat("/d/target").unwrap();
        fs.write_file("/d/target", b"data").unwrap();
        assert!(fs.chmod_conditional("/d/target",0o777,&chain,&dir,&target).unwrap_err().starts_with("EAGAIN:"));
        fs.rename("/d", "/saved", false).unwrap();
        fs.mkdir("/d",false,0o755).unwrap();
        fs.hard_link("/saved/target", "/d/target").unwrap();
        let target = fs.stat("/d/target").unwrap();
        assert!(fs.chmod_conditional("/d/target",0o777,&chain,&dir,&target).unwrap_err().starts_with("EAGAIN:"));
        assert_eq!(fs.stat("/d/target").unwrap().mode,0o100644);
    }

    #[test]
    fn symlink_requires_an_existing_writable_parent_before_publishing() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/real/child").unwrap();
        fs.symlink("/real/child", "/alias").unwrap();
        fs.write_file("/real/file", b"x").unwrap();
        fs.chmod("/real", 0o555).unwrap();
        let generation = fs.generation();
        for (path, reason) in [
            ("/missing/dir/link", "ENOENT: no such file or directory"),
            ("/missing/../link", "ENOENT: no such file or directory"),
            ("/alias/../link", "EACCES: permission denied"),
            ("/alias/../file", "EEXIST: file already exists"),
            ("/real/file/", "ENOTDIR: not a directory"),
            ("/new/", "ENOENT: no such file or directory"),
        ] {
            assert_eq!(fs.symlink("text", path), Err(format!("{reason}, symlink '{path}'")));
            assert_eq!(fs.generation(), generation);
        }
        assert!(!fs.exists("/missing"));
        assert!(fs.lstat("/link").is_err());
        fs.chmod("/real", 0o755).unwrap();
        fs.symlink("text", "/alias/../link").unwrap();
        assert_eq!(fs.readlink("/real/link").unwrap(), "text");
    }

    #[test]
    fn names_are_limited_to_255_bytes_before_publication() {
        let fs = MemoryVfs::new();
        let valid = format!("/{}a", "é".repeat(127));
        let long = format!("/{}", "é".repeat(128));
        fs.write_file(&valid, b"original").unwrap();
        fs.symlink(&long, "/alias").unwrap();
        let rev = fs.patch_revision(&long).unwrap();
        for result in [
            fs.write_file(&long, b"x"),
            fs.write_file("/alias", b"x"),
            fs.create_file(&long, b"x", 0o644),
            fs.rename(&valid, &long, true),
            fs.hard_link(&valid, &long),
            fs.mkdir_all(&long),
            fs.symlink(&valid, &long),
            fs.patch_file(&format!("{long}/child"), Some(b"x"), rev).map(|_| ()),
        ] {
            assert!(result.unwrap_err().starts_with("ENAMETOOLONG:"));
        }
        let mut entries = fs.export_entries().unwrap();
        entries[0].path = long;
        assert!(fs.replace_entries(&entries).unwrap_err().starts_with("ENAMETOOLONG:"));
        assert_eq!(fs.read_file(&valid).unwrap(), b"original");
        assert_eq!(fs.patch_revision(&valid).unwrap(), rev);
    }

    #[test]
    fn reads_refresh_access_times_only_after_admission() {
        let fs = MemoryVfs::new();
        fs.write_file("/d/f", b"hi").unwrap();
        fs.set_times("/d", Some(1.0), Some(7.0)).unwrap();
        fs.set_times("/d/f", Some(2.0), Some(8.0)).unwrap();
        let handle = fs.retain_file("/d/f").unwrap();
        assert!(fs.directory_entries("/d", 0).is_err());
        assert_eq!(fs.stat("/d").unwrap().atime_ms, 1.0);
        fs.directory_entries("/d", 1).unwrap();
        assert!(fs.stat("/d").unwrap().atime_ms > 1.0);
        assert_eq!(fs.stat("/d/f").unwrap().atime_ms, 2.0);
        fs.read_file("/d/f").unwrap();
        assert!(handle.stat().atime_ms > 2.0);
        fs.set_times("/d/f", Some(3.0), None).unwrap();
        fs.remove_one("/d/f", false).unwrap();
        assert_eq!(handle.read(0, 1), b"h");
        assert!(handle.stat().atime_ms > 3.0);
        assert_eq!(handle.stat().mtime_ms, 8.0);
    }

    #[test]
    fn concurrent_exclusive_creates_publish_only_one_writer() {
        let fs = MemoryVfs::new();
        let gate = std::sync::Barrier::new(4);
        let winner = std::thread::scope(|scope| {
            let jobs: Vec<_> = (0..4u8).map(|n| {
                let (fs, gate) = (&fs, &gate);
                scope.spawn(move || { gate.wait(); (n, fs.create_file("/dst", &[n], 0o600)) })
            }).collect();
            let mut winners = Vec::new();
            for job in jobs {
                let (n, result) = job.join().unwrap();
                match result {
                    Ok(()) => winners.push(n),
                    Err(e) => assert!(e.starts_with("EEXIST:")),
                }
            }
            assert_eq!(winners.len(), 1);
            winners[0]
        });
        assert_eq!(fs.read_file("/dst").unwrap(), [winner]);
        assert_eq!(fs.stat("/dst").unwrap().mode & 0o777, 0o600);
    }

    #[test]
    fn directory_link_counts_follow_children_across_moves_and_removal() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/a/dir/sub").unwrap();
        fs.mkdir_all("/b").unwrap();
        assert_eq!(fs.stat("/a").unwrap().nlink, Some(3));
        fs.rename("/a/dir", "/b/dir", false).unwrap();
        assert_eq!(fs.stat("/a").unwrap().nlink, Some(2));
        assert_eq!(fs.stat("/b").unwrap().nlink, Some(3));
        assert_eq!(fs.stat("/b/dir").unwrap().nlink, Some(3));
        fs.remove_path("/b/dir").unwrap();
        assert_eq!(fs.stat("/b").unwrap().nlink, Some(2));
    }

    #[test]
    fn identities_survive_moves_and_hardlink_promotion_but_not_recreation() {
        let fs = MemoryVfs::new();
        fs.write_file("/dir/a", b"data").unwrap();
        fs.symlink("a", "/dir/sym").unwrap();
        fs.hard_link("/dir/a", "/alias").unwrap();
        let id = |path| fs.lstat(path).unwrap().identity.unwrap();
        let original = [id("/dir"), id("/dir/a"), id("/dir/sym")];
        fs.rename("/dir", "/moved", false).unwrap();
        assert_eq!([id("/moved"), id("/moved/a"), id("/moved/sym")], original);
        fs.write_file("/moved/a", b"new").unwrap();
        fs.remove_path("/moved/a").unwrap();
        assert_eq!(id("/alias"), original[1]);
        fs.write_file("/moved/a", b"new").unwrap();
        assert_ne!(id("/moved/a"), original[1]);
    }

    #[test]
    fn patch_publication_cannot_follow_a_replaced_parent_or_unlink_a_replacement() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/original").unwrap();
        fs.write_file("/outside/file", b"keep").unwrap();
        let rev = fs.patch_revision("/original/file").unwrap();
        fs.remove_path("/original").unwrap();
        fs.symlink("/outside", "/original").unwrap();
        assert!(fs.patch_file("/original/file", Some(b"bad"), rev).is_err());
        assert!(fs.patch_file("/original/file", None, rev).is_err());
        assert_eq!(fs.read_file("/outside/file").unwrap(), b"keep");

        let rev = fs.patch_revision("/outside/file").unwrap();
        fs.write_file("/outside/file", b"new").unwrap();
        assert!(fs.patch_file("/outside/file", None, rev).is_err());
        assert_eq!(fs.read_file("/outside/file").unwrap(), b"new");
    }

    #[test]
    fn replacing_a_file_entry_keeps_old_readers_and_links_and_rejects_stale_writes() {
        let fs = MemoryVfs::new();
        fs.write_file("/out", b"old").unwrap();
        let reader = fs.open_read_file("/out", false).unwrap();
        let revision = fs.generation();
        fs.hard_link("/out", "/alias").unwrap();
        assert!(fs.replace_file_entry("/out", b"stale", revision).unwrap_err().starts_with("EAGAIN:"));
        fs.replace_file_entry("/out", b"new", fs.generation()).unwrap();
        assert_eq!(fs.read_file("/alias").unwrap(), b"old");
        fs.remove_one("/alias", false).unwrap();
        assert_eq!(reader.read(0, 3).unwrap(), b"old");
        assert_eq!(fs.read_file("/out").unwrap(), b"new");
    }

    #[test]
    fn publication_cleanup_preserves_replacements_and_unrelated_files() {
        let fs = MemoryVfs::new();
        let a = fs.publish_file("/a", b"same", &[], fs.generation()).unwrap();
        let b = fs.publish_file("/b", b"other", &[], fs.generation()).unwrap();
        fs.remove_path("/a").unwrap();
        fs.write_file("/a", b"same").unwrap();
        assert!(!fs.remove_published("/a", a).unwrap());
        assert!(fs.remove_published("/b", b).unwrap());
        assert_eq!(fs.read_file("/a").unwrap(), b"same");
        assert!(!fs.exists("/b"));
        for change in ["chmod", "mtime", "link"] {
            let stamp = fs.publish_file("/a", b"revision", &[], fs.generation()).unwrap();
            match change {
                "chmod" => fs.chmod("/a", 0o600).unwrap(),
                "mtime" => fs.set_mtime("/a", 10).unwrap(),
                _ => fs.hard_link("/a", "/linked").unwrap(),
            }
            assert!(!fs.remove_published("/a", stamp).unwrap(), "{change}");
        }
    }

    #[test]
    fn conditional_edits_leave_original_on_quota_failure_and_update_hardlinks_in_place() {
        let fs = MemoryVfs::new();
        fs.write_file("/f", b"abc").unwrap();
        let original = fs.stat("/f").unwrap();
        fs.set_max_total_bytes(5);
        assert!(fs.commit_file_edit("/f", &original, b"abc", b"def", false).unwrap_err().starts_with("ENOSPC:"));
        assert_eq!(fs.stat("/f").unwrap().identity, original.identity);
        assert_eq!(fs.read_file("/f").unwrap(), b"abc");
        fs.hard_link("/f", "/alias").unwrap();
        assert!(fs.commit_file_edit("/f", &original, b"abc", b"stale", true).unwrap_err().starts_with("EAGAIN:"));
        let linked = fs.stat("/f").unwrap();
        fs.commit_file_edit("/f", &linked, b"abc", b"def", true).unwrap();
        assert_eq!(fs.read_file("/alias").unwrap(), b"def");
        assert_eq!(fs.stat("/alias").unwrap().identity, original.identity);
    }

    #[test]
    fn file_streams_check_ancestor_search_permissions_before_opening() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/private").unwrap();
        fs.write_file("/private/a", b"hidden").unwrap();
        fs.write_file("/public", b"visible").unwrap();
        fs.chmod("/private", 0o600).unwrap();
        for path in ["/private/a", "/private/../public"] {
            assert!(fs.open_chunks(path).err().is_some_and(|e| e.starts_with("EACCES:")), "{path}");
        }
    }

    #[test]
    fn file_streams_retain_one_version_and_its_quota_until_the_last_reader_closes() {
        let fs = MemoryVfs::new();
        fs.write_file("/file", b"abcd").unwrap();
        fs.hard_link("/file", "/alias").unwrap();
        let mut first = fs.open_chunks_sized("/file", std::num::NonZeroUsize::new(2).unwrap()).unwrap();
        let second = fs.open_chunks("/alias").unwrap();
        let mut chunk = Vec::new();
        first(&mut chunk).unwrap();
        assert_eq!(chunk, b"ab");
        fs.set_max_total_bytes(7);
        assert!(fs.write_file("/alias", b"wxyz").unwrap_err().starts_with("ENOSPC"));
        fs.set_max_total_bytes(8);
        fs.write_file("/alias", b"wxyz").unwrap();
        first(&mut chunk).unwrap();
        assert_eq!(chunk, b"cd");
        assert_eq!(fs.read_file("/file").unwrap(), b"wxyz");
        first(&mut chunk).unwrap(); // EOF releases this reader's allocation.
        assert!(chunk.is_empty());
        assert!(fs.write_file("/new", b"x").unwrap_err().starts_with("ENOSPC"));
        let entries = fs.export_entries().unwrap();
        fs.replace_entries(&[]).unwrap(); // The old inode and snapshot are still pinned.
        assert!(fs.write_file("/new", b"x").unwrap_err().starts_with("ENOSPC"));
        drop(second);
        fs.replace_entries(&entries).unwrap();
        fs.write_file("/new", b"more").unwrap();
    }

    #[test]
    fn descriptor_edits_detach_file_streams_without_changing_descriptor_identity() {
        let fs = MemoryVfs::new();
        fs.write_file("/f", b"abcd").unwrap();
        let descriptor = fs.retain_file("/f").unwrap();
        let mut stream = fs.open_chunks("/f").unwrap();
        fs.set_max_total_bytes(6);
        assert!(descriptor.write(Some(1), b"X").unwrap_err().starts_with("ENOSPC"));
        descriptor.truncate(2).unwrap();
        descriptor.write(Some(1), b"X").unwrap();
        let mut original = Vec::new();
        stream(&mut original).unwrap();
        assert_eq!(original, b"abcd");
        assert_eq!(descriptor.read(0, 10), b"aX");
        drop(stream);
        descriptor.write(None, b"1234").unwrap();
    }

    #[test]
    fn memory_vfs_enforces_max_file_bytes_max_total_bytes_and_max_entries() {
        let vfs = MemoryVfs::with_limits(MemoryVfsLimits {
            max_total_bytes: 16,
            max_file_bytes: 10,
            max_entries: 5,
            max_symlink_hops: 32,
        });
        vfs.mkdir_all("/work").unwrap();

        // Per-file limit (10 bytes)
        let too_big = vfs.write_file("/work/big.txt", b"0123456789A");
        assert!(too_big.unwrap_err().contains("EFBIG"));

        // Within per-file and total limit
        vfs.write_file("/work/a.txt", b"0123456789").unwrap();
        // Exceeds total limit (10 + 8 > 16)
        let no_space = vfs.write_file("/work/b.txt", b"01234567");
        assert!(no_space.unwrap_err().contains("ENOSPC"));

        // Overwriting existing file reclaims its old bytes
        vfs.write_file("/work/a.txt", b"0123").unwrap();
        vfs.write_file("/work/b.txt", b"01234567").unwrap();

        // Unlinking reclaims space and entry count
        vfs.remove("/work/b.txt", false).unwrap();
        vfs.write_file("/work/c.txt", b"0123456789").unwrap();
    }

    #[test]
    fn memory_vfs_dev_virtual_devices_null_zero_random_urandom() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/dev").unwrap();
        vfs.write_file("/dev/null", b"").unwrap();
        vfs.write_file("/dev/zero", b"").unwrap();
        vfs.write_file("/dev/random", b"").unwrap();
        vfs.write_file("/dev/urandom", b"").unwrap();

        // Writing to /dev/null discards bytes
        vfs.write_file("/dev/null", b"discarded payload").unwrap();
        assert_eq!(vfs.read_file("/dev/null").unwrap(), b"");

        // Reading /dev/zero returns NUL bytes
        let zeros = vfs.read_file("/dev/zero").unwrap();
        assert!(!zeros.is_empty());
        assert!(zeros.iter().all(|&b| b == 0));

        // Reading /dev/urandom returns bytes from the host entropy source
        let rand_bytes = vfs.read_file("/dev/urandom").unwrap();
        assert!(!rand_bytes.is_empty());
        assert!(rand_bytes.iter().any(|&b| b != 0));
    }

    #[test]
    fn memory_vfs_symlinks_permissions_rename_and_copy() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/a/b").unwrap();
        vfs.write_file("/a/b/orig.txt", b"hello vfs").unwrap();
        vfs.chmod("/a/b/orig.txt", 0o750).unwrap();
        let st = vfs.stat("/a/b/orig.txt").unwrap();
        assert_eq!(st.mode & 0o777, 0o750);

        vfs.symlink("/a/b/orig.txt", "/a/link.txt").unwrap();
        assert_eq!(SafeBashFs::readlink(&vfs, "/a/link.txt").unwrap(), "/a/b/orig.txt");
        assert_eq!(vfs.read_file("/a/link.txt").unwrap(), b"hello vfs");
        assert_eq!(vfs.list_dir("/a/b").unwrap(), vec!["orig.txt"]);
        let exported = vfs.export_entries().unwrap();
        assert!(exported.iter().any(|e| e.path == "/a/b/orig.txt"));
    }

    #[test]
    fn memory_vfs_append_and_replace_entries_roundtrip() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/logs").unwrap();
        vfs.write_file("/logs/app.log", b"line1\n").unwrap();
        vfs.set_times("/logs/app.log", Some(-123.5), None).unwrap();
        vfs.append_file("/logs/app.log", b"line2\n").unwrap();
        assert_eq!(vfs.stat("/logs/app.log").unwrap().atime_ms, -123.5);
        assert_eq!(vfs.read_file("/logs/app.log").unwrap(), b"line1\nline2\n");
        let snap = vfs.export_entries().unwrap();
        let vfs2 = MemoryVfs::new();
        vfs2.replace_entries(&snap).unwrap();
        assert_eq!(vfs2.read_file("/logs/app.log").unwrap(), b"line1\nline2\n");
    }
}
