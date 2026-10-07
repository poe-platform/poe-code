use crate::vfs::path::{normalize_posix_path, parent_posix_path};
use crate::vfs::{FileStat, FsError, FsErrorCode, SafeBashFs, VfsEntryKind, VfsFileEntry};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone)]
enum MemoryNode {
    File {
        data: Vec<u8>,
        mode: u32,
        mtime_ms: u64,
    },
    Directory {
        mode: u32,
        mtime_ms: u64,
    },
    Symlink {
        target: String,
        mode: u32,
        mtime_ms: u64,
    },
}

#[derive(Debug, Clone)]
pub struct MemoryVfsLimits {
    pub max_total_bytes: usize,
    pub max_entries: usize,
    pub max_symlink_hops: usize,
}

impl Default for MemoryVfsLimits {
    fn default() -> Self {
        Self {
            max_total_bytes: 256 * 1024 * 1024,
            max_entries: 100_000,
            max_symlink_hops: 32,
        }
    }
}

#[derive(Debug)]
struct MemoryState {
    nodes: BTreeMap<String, MemoryNode>,
    total_bytes: usize,
    limits: MemoryVfsLimits,
}

#[derive(Clone)]
pub struct MemoryVfs {
    state: Arc<RwLock<MemoryState>>,
    generation: Arc<AtomicU64>,
}

impl Default for MemoryVfs {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryVfs {
    pub fn set_max_total_bytes(&self, max_total_bytes: usize) {
        if let Ok(mut guard) = self.state.write() {
            guard.limits.max_total_bytes = max_total_bytes;
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
                mode: 0o40755,
                mtime_ms: 1_700_000_000_000,
            },
        );
        Self {
            state: Arc::new(RwLock::new(MemoryState {
                nodes,
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
        match guard.nodes.get(&norm) {
            Some(MemoryNode::Symlink { target, .. }) if !target.starts_with("__hardlink__:") => {
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
                let clean_target = target.strip_prefix("__hardlink__:").unwrap_or(target);
                if clean_target.starts_with('/') {
                    current = String::from("/");
                }
                let target_parts: Vec<String> = clean_target
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
                    state.nodes.insert(
                        resolved,
                        MemoryNode::Directory {
                            mode: 0o40755,
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
    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let norm = normalize_posix_path(path);
        if norm == "/dev/null" {
            return Ok(Vec::new());
        }
        if norm == "/dev/zero" {
            return Ok(vec![0u8; 65536]);
        }
        let guard = self.state.read().map_err(|e| e.to_string())?;
        let resolved = Self::resolve_symlinks_locked(&guard, &norm, true).map_err(|e| e.message)?;
        match guard.nodes.get(&resolved) {
            Some(MemoryNode::File { data, .. }) => Ok(data.clone()),
            Some(MemoryNode::Directory { .. }) => {
                Err(format!("EISDIR: illegal operation on a directory, read '{norm}'"))
            }
            Some(MemoryNode::Symlink { .. }) => {
                Err(format!("ELOOP: unresolved symlink '{norm}'"))
            }
            None => Err(format!("ENOENT: no such file or directory, open '{norm}'")),
        }
    }

    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        if norm == "/dev/null" {
            return Ok(());
        }
        if norm == "/dev/full" {
            return Err("ENOSPC: no space left on device, write '/dev/full'".to_string());
        }
        let mut guard = self.state.write().map_err(|e| e.to_string())?;
        Self::ensure_parent_dirs_locked(&mut guard, &norm).map_err(|e| e.message)?;
        let resolved = Self::resolve_symlinks_locked(&guard, &norm, true).map_err(|e| e.message)?;

        let existing_info = match guard.nodes.get(&resolved) {
            Some(MemoryNode::Directory { .. }) => {
                return Err(format!(
                    "EISDIR: illegal operation on a directory, open '{norm}'"
                ));
            }
            Some(MemoryNode::File { data: old, mode, .. }) => Some((old.len(), *mode)),
            _ => None,
        };

        let old_len = existing_info.map(|(l, _)| l).unwrap_or(0);
        let mode = existing_info.map(|(_, m)| m).unwrap_or(0o100644);
        if existing_info.is_none() && guard.nodes.len() >= guard.limits.max_entries {
            return Err("ENOSPC: inode limit exceeded".to_string());
        }
        let next_total = guard.total_bytes.saturating_sub(old_len).saturating_add(data.len());
        if next_total > guard.limits.max_total_bytes {
            return Err("ENOSPC: file system byte budget exceeded".to_string());
        }
        guard.total_bytes = next_total;
        guard.nodes.insert(
            resolved,
            MemoryNode::File {
                data: data.to_vec(),
                mode,
                mtime_ms: 1_700_000_000_000,
            },
        );
        drop(guard);
        self.bump_generation();
        Ok(())
    }

    fn remove_path(&self, path: &str) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        if norm == "/" {
            return Err("EBUSY: cannot remove root directory '/'".to_string());
        }
        let mut guard = self.state.write().map_err(|e| e.to_string())?;
        let resolved = Self::resolve_symlinks_locked(&guard, &norm, false).map_err(|e| e.message)?;
        let prefix = format!("{resolved}/");
        let keys: Vec<String> = guard
            .nodes
            .keys()
            .filter(|k| **k == resolved || k.starts_with(&prefix))
            .cloned()
            .collect();
        if keys.is_empty() {
            return Err(format!(
                "ENOENT: no such file or directory, unlink '{norm}'"
            ));
        }
        for k in keys {
            if let Some(MemoryNode::File { data, mode, mtime_ms }) = guard.nodes.remove(&k) {
                let hl_marker = format!("__hardlink__:{k}");
                let survivor = guard
                    .nodes
                    .iter()
                    .find_map(|(nk, nv)| match nv {
                        MemoryNode::Symlink { target, .. } if target == &hl_marker => {
                            Some(nk.clone())
                        }
                        _ => None,
                    });
                if let Some(surv_key) = survivor {
                    guard.nodes.insert(
                        surv_key,
                        MemoryNode::File {
                            data,
                            mode,
                            mtime_ms,
                        },
                    );
                } else {
                    guard.total_bytes = guard.total_bytes.saturating_sub(data.len());
                }
            }
        }
        drop(guard);
        self.bump_generation();
        Ok(())
    }

    fn mkdir_all(&self, path: &str) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        if norm == "/" {
            return Ok(());
        }
        let mut guard = self.state.write().map_err(|e| e.to_string())?;
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
                guard.nodes.insert(
                    resolved,
                    MemoryNode::Directory {
                        mode: 0o40755,
                        mtime_ms: 1_700_000_000_000,
                    },
                );
            }
        }
        drop(guard);
        self.bump_generation();
        Ok(())
    }

    fn exists(&self, path: &str) -> bool {
        let norm = normalize_posix_path(path);
        if matches!(norm.as_str(), "/dev/null" | "/dev/zero" | "/dev/full" | "/dev/urandom") {
            return true;
        }
        let Ok(guard) = self.state.read() else {
            return false;
        };
        if guard.nodes.contains_key(&norm) {
            return true;
        }
        match Self::resolve_symlinks_locked(&guard, &norm, true) {
            Ok(resolved) => guard.nodes.contains_key(&resolved),
            Err(_) => false,
        }
    }

    fn is_dir(&self, path: &str) -> bool {
        let norm = normalize_posix_path(path);
        if norm == "/dev" {
            return true;
        }
        let Ok(guard) = self.state.read() else {
            return false;
        };
        let Ok(resolved) = Self::resolve_symlinks_locked(&guard, &norm, true) else {
            return false;
        };
        matches!(guard.nodes.get(&resolved), Some(MemoryNode::Directory { .. }))
    }

    fn list_dir(&self, path: &str) -> Result<Vec<String>, String> {
        let norm = normalize_posix_path(path);
        let guard = self.state.read().map_err(|e| e.to_string())?;
        let resolved = Self::resolve_symlinks_locked(&guard, &norm, true).map_err(|e| e.message)?;
        match guard.nodes.get(&resolved) {
            Some(MemoryNode::Directory { .. }) => {}
            Some(_) => return Err(format!("ENOTDIR: not a directory, scandir '{norm}'")),
            None => return Err(format!("ENOENT: no such file or directory, scandir '{norm}'")),
        }
        let prefix = if resolved == "/" {
            "/".to_string()
        } else {
            format!("{resolved}/")
        };
        let mut children = Vec::new();
        for key in guard.nodes.keys() {
            if key == &resolved {
                continue;
            }
            if let Some(rest) = key.strip_prefix(&prefix)
                && !rest.is_empty()
                && !rest.contains('/')
            {
                children.push(rest.to_string());
            }
        }
        Ok(children)
    }

    fn symlink(&self, target: &str, path: &str) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        let mut guard = self.state.write().map_err(|e| e.to_string())?;
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
                target: target.to_string(),
                mode: 0o120777,
                mtime_ms: 1_700_000_000_000,
            },
        );
        drop(guard);
        self.bump_generation();
        Ok(())
    }

    fn readlink(&self, path: &str) -> Result<String, String> {
        let bytes = self.readlink_bytes(path).map_err(|e| e.message)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    fn stat(&self, path: &str) -> Result<FileStat, String> {
        let norm = normalize_posix_path(path);
        if matches!(norm.as_str(), "/dev/null" | "/dev/zero" | "/dev/full" | "/dev/urandom") {
            return Ok(FileStat {
                kind: VfsEntryKind::File,
                size: 0,
                mode: 0o20666,
                mtime_ms: 1_700_000_000_000,
            });
        }
        let guard = self.state.read().map_err(|e| e.to_string())?;
        let resolved = Self::resolve_symlinks_locked(&guard, &norm, true).map_err(|e| e.message)?;
        match guard.nodes.get(&resolved) {
            Some(MemoryNode::File { data, mode, mtime_ms }) => Ok(FileStat {
                kind: VfsEntryKind::File,
                size: data.len(),
                mode: *mode,
                mtime_ms: *mtime_ms,
            }),
            Some(MemoryNode::Directory { mode, mtime_ms }) => Ok(FileStat {
                kind: VfsEntryKind::Directory,
                size: 0,
                mode: *mode,
                mtime_ms: *mtime_ms,
            }),
            Some(MemoryNode::Symlink { target, mode, mtime_ms }) => Ok(FileStat {
                kind: VfsEntryKind::Symlink,
                size: target.len(),
                mode: *mode,
                mtime_ms: *mtime_ms,
            }),
            None => Err(format!("ENOENT: no such file or directory, stat '{norm}'")),
        }
    }

    fn lstat(&self, path: &str) -> Result<FileStat, String> {
        let norm = normalize_posix_path(path);
        let guard = self.state.read().map_err(|e| e.to_string())?;
        let resolved = Self::resolve_symlinks_locked(&guard, &norm, false).map_err(|e| e.message)?;
        match guard.nodes.get(&resolved) {
            Some(MemoryNode::File { data, mode, mtime_ms }) => Ok(FileStat {
                kind: VfsEntryKind::File,
                size: data.len(),
                mode: *mode,
                mtime_ms: *mtime_ms,
            }),
            Some(MemoryNode::Directory { mode, mtime_ms }) => Ok(FileStat {
                kind: VfsEntryKind::Directory,
                size: 0,
                mode: *mode,
                mtime_ms: *mtime_ms,
            }),
            Some(MemoryNode::Symlink { target, .. }) if target.starts_with("__hardlink__:") => {
                drop(guard);
                self.stat(&norm)
            }
            Some(MemoryNode::Symlink { target, mode, mtime_ms }) => Ok(FileStat {
                kind: VfsEntryKind::Symlink,
                size: target.len(),
                mode: *mode,
                mtime_ms: *mtime_ms,
            }),
            None => Err(format!("ENOENT: no such file or directory, lstat '{norm}'")),
        }
    }

    fn chmod(&self, path: &str, mode: u32) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        let mut guard = self.state.write().map_err(|e| e.to_string())?;
        let resolved = Self::resolve_symlinks_locked(&guard, &norm, true).map_err(|e| e.message)?;
        match guard.nodes.get_mut(&resolved) {
            Some(MemoryNode::File { mode: m, .. }) => {
                *m = 0o100000 | (mode & 0o7777);
            }
            Some(MemoryNode::Directory { mode: m, .. }) => {
                *m = 0o040000 | (mode & 0o7777);
            }
            Some(MemoryNode::Symlink { mode: m, .. }) => {
                *m = 0o120000 | (mode & 0o7777);
            }
            None => return Err(format!("ENOENT: no such file or directory, chmod '{norm}'")),
        }
        drop(guard);
        self.bump_generation();
        Ok(())
    }

    fn set_mtime(&self, path: &str, mtime_ms: u64) -> Result<(), String> {
        let norm = normalize_posix_path(path);
        let mut guard = self.state.write().map_err(|e| e.to_string())?;
        let resolved = Self::resolve_symlinks_locked(&guard, &norm, true).map_err(|e| e.message)?;
        match guard.nodes.get_mut(&resolved) {
            Some(MemoryNode::File { mtime_ms: m, .. })
            | Some(MemoryNode::Directory { mtime_ms: m, .. })
            | Some(MemoryNode::Symlink { mtime_ms: m, .. }) => {
                *m = mtime_ms;
            }
            None => return Err(format!("ENOENT: no such file or directory, utime '{norm}'")),
        }
        drop(guard);
        self.bump_generation();
        Ok(())
    }

    fn generation(&self) -> u64 {
        self.generation.load(Ordering::Relaxed)
    }

    fn export_entries(&self) -> Result<Vec<VfsFileEntry>, String> {
        let guard = self.state.read().map_err(|e| e.to_string())?;
        let mut out = Vec::with_capacity(guard.nodes.len());
        for (path, node) in &guard.nodes {
            if path == "/" {
                continue;
            }
            match node {
                MemoryNode::Directory { mode, .. } => {
                    out.push(VfsFileEntry {
                        path: path.clone(),
                        kind: VfsEntryKind::Directory,
                        data: Vec::new(),
                        symlink_target: None,
                        mode: *mode,
                    });
                }
                MemoryNode::File { data, mode, .. } => {
                    out.push(VfsFileEntry {
                        path: path.clone(),
                        kind: VfsEntryKind::File,
                        data: data.clone(),
                        symlink_target: None,
                        mode: *mode,
                    });
                }
                MemoryNode::Symlink { target, mode, .. } => {
                    out.push(VfsFileEntry {
                        path: path.clone(),
                        kind: VfsEntryKind::Symlink,
                        data: Vec::new(),
                        symlink_target: Some(target.clone()),
                        mode: *mode,
                    });
                }
            }
        }
        Ok(out)
    }

    fn replace_entries(&self, entries: &[VfsFileEntry]) -> Result<(), String> {
        let mut guard = self.state.write().map_err(|e| e.to_string())?;
        guard.nodes.clear();
        guard.total_bytes = 0;
        guard.nodes.insert(
            "/".to_string(),
            MemoryNode::Directory {
                mode: 0o40755,
                mtime_ms: 1_700_000_000_000,
            },
        );
        for entry in entries {
            if entry.kind == VfsEntryKind::Directory {
                let norm = normalize_posix_path(&entry.path);
                let _ = Self::ensure_parent_dirs_locked(&mut guard, &norm);
                guard.nodes.insert(
                    norm,
                    MemoryNode::Directory {
                        mode: if entry.mode != 0 { entry.mode } else { 0o40755 },
                        mtime_ms: 1_700_000_000_000,
                    },
                );
            }
        }
        for entry in entries {
            if entry.kind == VfsEntryKind::File {
                let norm = normalize_posix_path(&entry.path);
                let _ = Self::ensure_parent_dirs_locked(&mut guard, &norm);
                guard.total_bytes = guard.total_bytes.saturating_add(entry.data.len());
                guard.nodes.insert(
                    norm,
                    MemoryNode::File {
                        data: entry.data.clone(),
                        mode: if entry.mode != 0 { entry.mode } else { 0o100644 },
                        mtime_ms: 1_700_000_000_000,
                    },
                );
            }
        }
        for entry in entries {
            if entry.kind == VfsEntryKind::Symlink
                && let Some(target) = entry.symlink_target.as_deref()
            {
                let norm = normalize_posix_path(&entry.path);
                let _ = Self::ensure_parent_dirs_locked(&mut guard, &norm);
                guard.nodes.insert(
                    norm,
                    MemoryNode::Symlink {
                        target: target.to_string(),
                        mode: if entry.mode != 0 { entry.mode } else { 0o120777 },
                        mtime_ms: 1_700_000_000_000,
                    },
                );
            }
        }
        drop(guard);
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
