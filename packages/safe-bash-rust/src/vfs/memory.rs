mod descriptor;
mod transfer;
pub(crate) use descriptor::RetainedFile;

use crate::vfs::path::{normalize_posix_path, parent_posix_path};
use crate::vfs::{EntryIdentity, FileStat, FsError, FsErrorCode, SafeBashFs, VfsEntryKind, VfsFileEntry};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone)]
enum MemoryNode {
    File { ino: u64 },
    Directory {
        ino: u64,
        mode: u32,
        mtime_ms: u64,
    },
    Symlink {
        ino: u64,
        target: Arc<str>,
        mode: u32,
        mtime_ms: u64,
    },
}

impl MemoryNode {
    fn ino(&self) -> u64 {
        match self { Self::File { ino } | Self::Symlink { ino, .. } | Self::Directory { ino, .. } => *ino }
    }
}

#[derive(Debug)]
struct MemoryFile {
    data: Vec<u8>,
    publication: Option<u64>,
    mode: u32,
    mtime_ms: u64,
    opens: usize,
    linked: bool,
}

static NEXT_PUBLICATION: AtomicU64 = AtomicU64::new(1);
// Virtual devices use fixed inode numbers 1 through 6.
static NEXT_INODE: AtomicU64 = AtomicU64::new(7);
static NEXT_FS_ID: AtomicU64 = AtomicU64::new(1);

pub(crate) fn fill_random(bytes: &mut [u8]) -> Result<(), String> {
    #[cfg(target_arch = "wasm32")]
    {
        #[link(wasm_import_module = "safe_bash")]
        unsafe extern "C" {
            fn fill_random_bytes(ptr: *mut u8, len: usize) -> i32;
        }
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
struct MemoryState {
    devices: Devices,
    nodes: BTreeMap<String, MemoryNode>,
    files: HashMap<u64, MemoryFile>,
    extra_links: HashMap<u64, usize>,
    child_dirs: HashMap<String, usize>,
    total_bytes: usize,
    limits: MemoryVfsLimits,
}

impl MemoryState {
    fn insert_directory(&mut self, path: String, node: MemoryNode) {
        if path != "/" && !self.nodes.contains_key(&path) { *self.child_dirs.entry(super::dirname_posix_path(&path)).or_default() += 1; }
        self.nodes.insert(path, node);
    }

    fn removed_directory(&mut self, path: &str) {
        let parent = super::dirname_posix_path(path);
        if let Some(count) = self.child_dirs.get_mut(&parent) {
            *count -= 1;
            if *count == 0 { self.child_dirs.remove(&parent); }
        }
    }
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
            MemoryNode::Directory {
                ino: NEXT_INODE.fetch_add(1, Ordering::Relaxed),
                mode: 0o40755,
                mtime_ms: 1_700_000_000_000,
            },
        );
        Self {
            id: NEXT_FS_ID.fetch_add(1, Ordering::Relaxed),
            state: Arc::new(RwLock::new(MemoryState {
                devices: Devices::Extended,
                nodes,
                files: HashMap::new(), extra_links: HashMap::new(), child_dirs: HashMap::new(),
                total_bytes: 0,
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
        let device = state.devices.entry(&resolved);
        let (kind, size, mode, mtime_ms, ino) = if let Some(name) = device {
            let ino = match name { "" => 1, "null" => 2, "random" => 3, "urandom" => 4, "zero" => 5, "full" => 6, _ => unreachable!() };
            if name.is_empty() { (VfsEntryKind::Directory, 0, if state.devices == Devices::Mounted { 0o40555 } else { 0o40755 }, 0, ino) }
            else { (VfsEntryKind::File, 0, 0o20666, 0, ino) }
        } else {
            match state.nodes.get(&resolved) {
                Some(MemoryNode::File { ino }) => {
                    let file = &state.files[ino];
                    (VfsEntryKind::File, file.data.len(), file.mode, file.mtime_ms, *ino)
                }
                Some(MemoryNode::Directory { ino, mode, mtime_ms }) => (VfsEntryKind::Directory, 0, *mode, *mtime_ms, *ino),
                Some(MemoryNode::Symlink { ino, target, mode, mtime_ms }) => (VfsEntryKind::Symlink, target.len(), *mode, *mtime_ms, *ino),
                None => return Err(format!("ENOENT: no such file or directory, {} '{}'", if follow { "stat" } else { "lstat" }, normalize_posix_path(path))),
            }
        };
        let default_device = device.is_some() && state.devices == Devices::Null;
        Ok(FileStat {
            nlink: if kind == VfsEntryKind::Directory && device.is_none() {
                2 + state.child_dirs.get(&resolved).copied().unwrap_or(0)
            } else { 1 + state.extra_links.get(&ino).copied().unwrap_or(0) },
            identity: Some(EntryIdentity::Memory(if default_device { 0 } else { self.id }, ino)),
            allocated_bytes: default_device.then_some(0),
            kind, size, mode, mtime_ms,
        })
    }

    fn store_file(state: &mut MemoryState, resolved: String, data: &[u8], create_mode: u32, publication: Option<u64>) -> Result<(), String> {
        let existing = match state.nodes.get(&resolved) {
            Some(MemoryNode::Directory { .. }) => return Err(format!("EISDIR: illegal operation on a directory, open '{resolved}'")),
            Some(MemoryNode::File { ino }) => Some(*ino),
            _ => None,
        };
        let old_len = existing.map_or(0, |ino| state.files[&ino].data.len());
        if existing.is_none() && state.nodes.len() >= state.limits.max_entries {
            return Err("ENOSPC: inode limit exceeded".into());
        }
        if data.len() > state.limits.max_file_bytes {
            return Err("EFBIG: file size budget exceeded".to_string());
        }
        let next_total = state.total_bytes.saturating_sub(old_len).saturating_add(data.len());
        if next_total > state.limits.max_total_bytes {
            return Err("ENOSPC: file system byte budget exceeded".to_string());
        }
        state.total_bytes = next_total;
        if let Some(ino) = existing {
            let file = state.files.get_mut(&ino).unwrap();
            file.data = data.to_vec();
            file.publication = publication;
            file.mtime_ms = 1_700_000_000_000;
        } else {
            let ino = NEXT_INODE.fetch_add(1, Ordering::Relaxed);
            state.files.insert(ino, MemoryFile { data: data.to_vec(), publication, mode: create_mode,
                mtime_ms: 1_700_000_000_000, opens: 0, linked: true });
            state.nodes.insert(resolved, MemoryNode::File { ino });
        }
        Ok(())
    }

    fn link_node(state: &mut MemoryState, node: MemoryNode, dst: String) -> Result<(), String> {
        if matches!(node, MemoryNode::Directory { .. }) { return Err("EPERM: operation not permitted".into()); }
        if state.nodes.contains_key(&dst) || state.devices.entry(&dst).is_some() { return Err("EEXIST: file already exists".into()); }
        if state.nodes.len() >= state.limits.max_entries { return Err("ENOSPC: inode limit exceeded".into()); }
        let ino = node.ino();
        if let Some(file) = state.files.get_mut(&ino) { file.publication = None; }
        *state.extra_links.entry(ino).or_default() += 1;
        state.nodes.insert(dst, node);
        Ok(())
    }

    fn remove_one_locked(state: &mut MemoryState, path: &str, directory: bool) -> Result<(), String> {
        let entry = Self::mutation_entry(state, path)?;
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

    pub(super) fn create_overlay_file(&self, lower: &Self, versions: (u64, u64), path: &str, data: &[u8], mode: u32, parents: Vec<(String, u32)>) -> Result<(), String> {
        let (_base, mut upper) = self.overlay_layers(lower, versions)?;
        if upper.nodes.contains_key(path) || upper.devices.entry(path).is_some() { return Err("EEXIST: file already exists".into()); }
        if parents.len() >= upper.limits.max_entries.saturating_sub(upper.nodes.len()) {
            return Err("ENOSPC: inode limit exceeded".into());
        }
        Self::store_file(&mut upper, path.to_owned(), data, 0o100000 | mode, None)?;
        for (parent, mode) in parents {
            upper.insert_directory(parent, MemoryNode::Directory { ino: NEXT_INODE.fetch_add(1, Ordering::Relaxed), mode, mtime_ms: 1_700_000_000_000 });
        }
        self.bump_generation();
        Ok(())
    }

    pub(super) fn remove_overlay_entry(&self, lower: &Self, versions: (u64, u64), path: &str, directory: bool, recursive: bool) -> Result<(), String> {
        let (base, mut upper) = self.overlay_layers(lower, versions)?;
        if path == "/" || upper.devices.entry(path).is_some() || base.devices.entry(path).is_some() {
            return Err("EBUSY: resource busy or locked".into());
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
        Ok(())
    }

    fn mutation_entry(state: &MemoryState, path: &str) -> Result<String, String> {
        super::path::rename_entry(path, state.limits.max_symlink_hops, |parent| {
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
        let resolved = Self::mutation_entry(&guard, path)?;
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
        let Some(node) = guard.nodes.remove(k) else { return };
        if matches!(node, MemoryNode::Directory { .. }) { guard.removed_directory(k); return; }
        let ino = node.ino();
        if let Some(extra) = guard.extra_links.get_mut(&ino) {
            *extra -= 1;
            if *extra == 0 { guard.extra_links.remove(&ino); }
            if let Some(file) = guard.files.get_mut(&ino) { file.publication = None; }
        } else if let Some(file) = guard.files.get_mut(&ino) {
            file.linked = false;
            if file.opens == 0 { guard.total_bytes -= guard.files.remove(&ino).unwrap().data.len(); }
        }
    }

    fn ensure_parent_dirs_locked(state: &mut MemoryState, path: &str) -> Result<(), FsError> {
        let norm = normalize_posix_path(path);
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
                    if state.nodes.len() >= state.limits.max_entries {
                        return Err(FsError::new(
                            FsErrorCode::NoSpace,
                            "ENOSPC: inode limit exceeded",
                        ));
                    }
                    state.insert_directory(
                        resolved,
                        MemoryNode::Directory {
                            ino: NEXT_INODE.fetch_add(1, Ordering::Relaxed),
                            mode: 0o40777,
                            mtime_ms: 1_700_000_000_000,
                        },
                    );
                }
            }
        }
        Ok(())
    }
}

impl SafeBashFs for MemoryVfs {
    fn memory_backend(&self) -> Option<&MemoryVfs> { Some(self) }
    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let norm = normalize_posix_path(path);
        let guard = self.state.read().map_err(|e| e.to_string())?;
        let resolved = Self::resolve_symlinks_locked(&guard, &norm, true).map_err(|e| e.message)?;
        let device = guard.devices.entry(&resolved);
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
            let mut buf = vec![0u8; 4096];
            fill_random(&mut buf)?;
            return Ok(buf);
        }
        match guard.nodes.get(&resolved) {
            Some(MemoryNode::File { ino }) => Ok(guard.files[ino].data.clone()),
            Some(MemoryNode::Directory { .. }) => {
                Err(format!("EISDIR: illegal operation on a directory, read '{norm}'"))
            }
            Some(MemoryNode::Symlink { .. }) => {
                Err(format!("ELOOP: unresolved symlink '{norm}'"))
            }
            None => Err(format!("ENOENT: no such file or directory, open '{norm}'")),
        }
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
        Self::store_file(&mut state, entry, data, 0o100000 | mode, None)?;
        self.bump_generation();
        Ok(())
    }

    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
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
        Self::store_file(&mut guard, resolved, data, 0o100644, None)?;
        self.bump_generation();
        Ok(())
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
            if matches!(state.nodes.get(&dest), Some(MemoryNode::File { ino }) if state.files[ino].data == data) {
                return Ok(expected.1);
            }
            if parent_mode & 0o300 != 0o300 { return Err(format!("EACCES: {path}")); }
            let needed = missing.len() + usize::from(!state.nodes.contains_key(&dest));
            if needed > state.limits.max_entries.saturating_sub(state.nodes.len()) {
                return Err("ENOSPC: inode limit exceeded".into());
            }
            Self::store_file(&mut state, dest, data, 0o100666, None)?;
            for dir in missing {
                state.insert_directory(dir.to_owned(), MemoryNode::Directory { ino: NEXT_INODE.fetch_add(1, Ordering::Relaxed), mode: 0o40777, mtime_ms: 1_700_000_000_000 });
            }
        } else {
            if parent_mode & 0o300 != 0o300 { return Err(format!("EACCES: {path}")); }
            if !state.nodes.contains_key(path) { return Err(format!("missing target: {path}")); }
            Self::unlink_locked(&mut state, path);
        }
        self.bump_generation();
        Ok(self.generation())
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
        Self::store_file(&mut state, dest, data, 0o100666, Some(publication))?;
        self.bump_generation();
        Ok(publication)
    }

    fn rename(&self, source: &str, destination: &str, no_replace: bool) -> Result<(), String> {
        let mut state = self.state.write().map_err(|_| "EIO: input/output error")?;
        let from = Self::mutation_entry(&state, source)?;
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
        let to = Self::mutation_entry(&state, destination)?;
        if from == "/" || to == "/" || state.devices.entry(&to).is_some() {
            return Err("EBUSY: resource busy or locked".into());
        }
        let target = state.nodes.get(&to);
        let target_dir = matches!(target, Some(MemoryNode::Directory { .. }));
        if destination.ends_with('/') && (!is_dir || (target.is_some() && !target_dir)) {
            return Err("ENOTDIR: not a directory".into());
        }
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
            let node = state.nodes.remove(&old).unwrap();
            let new = format!("{to}{}", &old[from.len()..]);
            if matches!(node, MemoryNode::Directory { .. }) {
                state.removed_directory(&old);
                state.insert_directory(new, node);
            } else { state.nodes.insert(new, node); }
        }
        self.bump_generation();
        Ok(())
    }

    fn remove_one(&self, path: &str, directory: bool) -> Result<(), String> {
        let mut state = self.state.write().map_err(|_| "EIO: input/output error")?;
        Self::remove_one_locked(&mut state, path, directory)?;
        self.bump_generation();
        Ok(())
    }

    fn remove_path(&self, path: &str) -> Result<(), String> {
        self.remove_entry(path, None).map(|_| ())
    }

    fn remove_published(&self, path: &str, publication: u64) -> Result<bool, String> {
        self.remove_entry(path, Some(publication))
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
        if state.nodes.len() >= state.limits.max_entries { return Err("ENOSPC: inode limit exceeded".into()); }
        state.insert_directory(path, MemoryNode::Directory { ino: NEXT_INODE.fetch_add(1, Ordering::Relaxed),
            mode: 0o40000 | (mode & 0o7777), mtime_ms: 1_700_000_000_000 });
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
                if guard.nodes.len() >= guard.limits.max_entries {
                    return Err("ENOSPC: inode limit exceeded".to_string());
                }
                guard.insert_directory(
                    resolved,
                    MemoryNode::Directory {
                        ino: NEXT_INODE.fetch_add(1, Ordering::Relaxed),
                        mode: 0o40777,
                        mtime_ms: 1_700_000_000_000,
                    },
                );
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

    fn indexed_directory_entry(&self, path: &str) -> Option<bool> {
        let (prefix, _) = path.trim_end_matches('/').rsplit_once('/')?;
        if prefix.ends_with('/') { return None; }
        let parent = if prefix.is_empty() { "/" } else { prefix };
        if parent == "/dev" || parent.starts_with("/dev/") || normalize_posix_path(parent) != parent {
            return None;
        }
        let state = self.state.read().ok()?;
        if !matches!(state.nodes.get(parent), Some(MemoryNode::Directory { mode, .. }) if mode & 0o500 == 0o500)
            || state.nodes.values().any(|node| matches!(node, MemoryNode::Symlink { .. })) {
            return None;
        }
        Some(state.nodes.contains_key(path.trim_end_matches('/')))
    }

    fn list_dir(&self, path: &str) -> Result<Vec<String>, String> {
        Ok(self.directory_entries(path, usize::MAX)?.into_iter().map(|(n, _)| n).collect())
    }

    fn directory_entries(&self, path: &str, limit: usize) -> Result<Vec<(String, u32)>, String> {
        let norm = normalize_posix_path(path);
        let guard = self.state.read().map_err(|e| e.to_string())?;
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
        Ok(children)
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
        let norm = normalize_posix_path(path);
        let mut guard = self.state.write().map_err(|e| e.to_string())?;
        if guard.devices == Devices::Mounted { return Err(format!("EROFS: read-only device directory '{norm}'")); }
        Self::ensure_parent_dirs_locked(&mut guard, &norm).map_err(|e| e.message)?;
        let resolved = Self::resolve_symlinks_locked(&guard, &norm, false).map_err(|e| e.message)?;
        if guard.nodes.contains_key(&resolved) {
            return Err(format!("EEXIST: file already exists, symlink '{norm}'"));
        }
        if guard.nodes.len() >= guard.limits.max_entries {
            return Err("ENOSPC: inode limit exceeded".to_string());
        }
        guard.nodes.insert(
            resolved,
            MemoryNode::Symlink {
                ino: NEXT_INODE.fetch_add(1, Ordering::Relaxed),
                target: Arc::from(target),
                mode: 0o120777,
                mtime_ms: 1_700_000_000_000,
            },
        );
        self.bump_generation();
        Ok(())
    }

    fn readlink(&self, path: &str) -> Result<String, String> {
        let bytes = self.readlink_bytes(path).map_err(|e| e.message)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
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
        match guard.nodes.get_mut(&resolved) {
            Some(MemoryNode::File { ino }) => {
                let ino = *ino;
                let file = guard.files.get_mut(&ino).unwrap();
                file.publication = None;
                file.mode = 0o100000 | (mode & 0o7777);
            }
            Some(MemoryNode::Directory { mode: m, .. }) => {
                *m = 0o040000 | (mode & 0o7777);
            }
            Some(MemoryNode::Symlink { mode: m, .. }) => {
                *m = 0o120000 | (mode & 0o7777);
            }
            None => return Err(format!("ENOENT: no such file or directory, chmod '{norm}'")),
        }
        self.bump_generation();
        Ok(())
    }

    fn set_mtime(&self, path: &str, mtime_ms: u64) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        let mut guard = self.state.write().map_err(|e| e.to_string())?;
        let resolved = Self::resolve_symlinks_locked(&guard, &norm, true).map_err(|e| e.message)?;
        match guard.nodes.get_mut(&resolved) {
            Some(MemoryNode::File { ino }) => {
                let ino = *ino;
                let file = guard.files.get_mut(&ino).unwrap();
                file.publication = None;
                file.mtime_ms = mtime_ms;
            }
            Some(MemoryNode::Directory { mtime_ms: m, .. })
            | Some(MemoryNode::Symlink { mtime_ms: m, .. }) => {
                *m = mtime_ms;
            }
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
                        link_group: guard.extra_links.contains_key(ino).then_some(*ino),
                        symlink_target: None,
                        mode: file.mode,
                    });
                }
                MemoryNode::Symlink { ino, target, mode, .. } => {
                    out.push(VfsFileEntry {
                        path: path.clone(),
                        kind: VfsEntryKind::Symlink,
                        data: Arc::default(),
                        link_group: guard.extra_links.contains_key(ino).then_some(*ino),
                        symlink_target: Some(target.to_string()),
                        mode: *mode,
                    });
                }
            }
        }
        Ok(out)
    }

    fn replace_entries(&self, entries: &[VfsFileEntry]) -> Result<(), String> {
        let mut current = self.state.write().map_err(|e| e.to_string())?;
        let retained_bytes = current.files.values().filter(|f| f.opens != 0).map(|f| f.data.len()).sum();
        let mut guard = MemoryState { devices: current.devices, nodes: BTreeMap::new(), files: HashMap::new(), extra_links: HashMap::new(), child_dirs: HashMap::new(),
            total_bytes: retained_bytes, limits: current.limits.clone() };
        guard.insert_directory(
            "/".to_string(),
            MemoryNode::Directory {
                ino: NEXT_INODE.fetch_add(1, Ordering::Relaxed),
                mode: 0o40755,
                mtime_ms: 1_700_000_000_000,
            },
        );
        for entry in entries {
            if entry.kind == VfsEntryKind::Directory {
                let norm = normalize_posix_path(&entry.path);
                Self::ensure_parent_dirs_locked(&mut guard, &norm).map_err(|e| e.message)?;
                guard.insert_directory(
                    norm,
                    MemoryNode::Directory {
                        ino: NEXT_INODE.fetch_add(1, Ordering::Relaxed),
                        mode: if entry.mode != 0 { entry.mode } else { 0o40755 },
                        mtime_ms: 1_700_000_000_000,
                    },
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
                Self::store_file(&mut guard, norm.clone(), &entry.data, if entry.mode != 0 { entry.mode } else { 0o100644 }, None)?;
            } else {
                let target = entry.symlink_target.clone().ok_or("EINVAL: missing symlink target")?;
                guard.nodes.insert(norm.clone(), MemoryNode::Symlink { ino: NEXT_INODE.fetch_add(1, Ordering::Relaxed),
                    target: target.into(), mode: if entry.mode != 0 { entry.mode } else { 0o120777 }, mtime_ms: 1_700_000_000_000 });
            }
            if let Some(group) = entry.link_group { groups.insert(group, guard.nodes[&norm].clone()); }
        }
        for (ino, mut file) in current.files.drain().filter(|(_, f)| f.opens != 0) {
            file.linked = false;
            guard.files.insert(ino, file);
        }
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
        assert_eq!(fs.stat("/a").unwrap().nlink, 3);
        fs.rename("/a/dir", "/b/dir", false).unwrap();
        assert_eq!(fs.stat("/a").unwrap().nlink, 2);
        assert_eq!(fs.stat("/b").unwrap().nlink, 3);
        assert_eq!(fs.stat("/b/dir").unwrap().nlink, 3);
        fs.remove_path("/b/dir").unwrap();
        assert_eq!(fs.stat("/b").unwrap().nlink, 2);
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
        vfs.append_file("/logs/app.log", b"line2\n").unwrap();
        assert_eq!(vfs.read_file("/logs/app.log").unwrap(), b"line1\nline2\n");
        let snap = vfs.export_entries().unwrap();
        let vfs2 = MemoryVfs::new();
        vfs2.replace_entries(&snap).unwrap();
        assert_eq!(vfs2.read_file("/logs/app.log").unwrap(), b"line1\nline2\n");
    }
}
