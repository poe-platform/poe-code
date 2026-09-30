use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, RwLock};

use crate::errors::GitError;
use crate::utils::{dirname, join};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FsError {
    pub code: String,
    pub message: String,
}

impl FsError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }

    pub fn enoent(path: &str) -> Self {
        Self::new("ENOENT", format!("ENOENT: no such file or directory '{path}'"))
    }

    pub fn eexist(path: &str) -> Self {
        Self::new("EEXIST", format!("EEXIST: file already exists '{path}'"))
    }

    pub fn enotdir(path: &str) -> Self {
        Self::new("ENOTDIR", format!("ENOTDIR: not a directory '{path}'"))
    }

    pub fn eisdir(path: &str) -> Self {
        Self::new("EISDIR", format!("EISDIR: illegal operation on a directory '{path}'"))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeKind {
    File,
    Directory,
    Symlink,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileStat {
    pub kind: NodeKind,
    pub mode: u32,
    pub size: u64,
    pub ino: u64,
    pub dev: u64,
    pub uid: u32,
    pub gid: u32,
    pub ctime_seconds: u32,
    pub ctime_nanoseconds: u32,
    pub mtime_seconds: u32,
    pub mtime_nanoseconds: u32,
}

impl FileStat {
    pub fn is_file(&self) -> bool {
        self.kind == NodeKind::File
    }

    pub fn is_directory(&self) -> bool {
        self.kind == NodeKind::Directory
    }

    pub fn is_symbolic_link(&self) -> bool {
        self.kind == NodeKind::Symlink
    }
}

#[derive(Debug, Clone)]
enum VfsEntry {
    File {
        data: Vec<u8>,
        mode: u32,
        ino: u64,
        mtime_seconds: u32,
        mtime_nanoseconds: u32,
    },
    HostFile {
        host_path: std::path::PathBuf,
        size: u64,
        mode: u32,
        ino: u64,
        mtime_seconds: u32,
        mtime_nanoseconds: u32,
    },
    Dir {
        mode: u32,
        ino: u64,
    },
    Symlink {
        target: Vec<u8>,
        mode: u32,
        ino: u64,
        mtime_seconds: u32,
        mtime_nanoseconds: u32,
    },
}

#[derive(Debug, Clone)]
struct VfsState {
    entries: BTreeMap<String, VfsEntry>,
    next_ino: u64,
    clock_tick: u32,
}

impl Default for VfsState {
    fn default() -> Self {
        let mut entries = BTreeMap::new();
        entries.insert(
            "/".to_string(),
            VfsEntry::Dir {
                mode: 0o040755,
                ino: 1,
            },
        );
        Self {
            entries,
            next_ino: 2,
            clock_tick: 1_700_000_000,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct MemoryFs {
    state: Arc<RwLock<VfsState>>,
    pub(crate) pack_cache: crate::storage::pack_cache::PackCache,
}

impl MemoryFs {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn deep_clone(&self) -> Self {
        let st = self.state.read().unwrap().clone();
        Self {
            state: Arc::new(RwLock::new(st)),
            pack_cache: Default::default(),
        }
    }

    fn clean_abs_path(path: &str) -> String {
        let p = path.replace('\\', "/");
        let with_leading = if p.starts_with('/') {
            p
        } else {
            format!("/{p}")
        };
        let mut parts: Vec<&str> = Vec::new();
        for seg in with_leading.split('/') {
            if seg.is_empty() || seg == "." {
                continue;
            }
            if seg == ".." {
                parts.pop();
            } else {
                parts.push(seg);
            }
        }
        if parts.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", parts.join("/"))
        }
    }

    fn resolve_path_internal(
        state: &VfsState,
        path: &str,
        follow_final_symlink: bool,
        depth: usize,
    ) -> Result<String, FsError> {
        if depth > 32 {
            return Err(FsError::new("ELOOP", "Too many levels of symbolic links"));
        }
        let cleaned = Self::clean_abs_path(path);
        if cleaned == "/" {
            return Ok("/".to_string());
        }
        let segments: Vec<&str> = cleaned.trim_start_matches('/').split('/').collect();
        let mut current = String::new();
        for (idx, seg) in segments.iter().enumerate() {
            let is_last = idx + 1 == segments.len();
            current = format!("{current}/{seg}");
            if let Some(entry) = state.entries.get(&current) {
                match entry {
                    VfsEntry::Symlink { target, .. } => {
                        if !is_last || follow_final_symlink {
                            let target_str = String::from_utf8_lossy(target);
                            let joined = if target_str.starts_with('/') {
                                target_str.to_string()
                            } else {
                                let parent = dirname(&current);
                                join(&[&parent, &target_str])
                            };
                            let remaining = if is_last {
                                joined
                            } else {
                                let tail = segments[idx + 1..].join("/");
                                format!("{joined}/{tail}")
                            };
                            return Self::resolve_path_internal(
                                state,
                                &remaining,
                                follow_final_symlink,
                                depth + 1,
                            );
                        }
                    }
                    VfsEntry::File { .. } | VfsEntry::HostFile { .. } => {
                        if !is_last {
                            return Err(FsError::enotdir(&current));
                        }
                    }
                    VfsEntry::Dir { .. } => {}
                }
            } else if !is_last {
                // Check if parent does not exist
                return Err(FsError::enoent(&current));
            }
        }
        Ok(current)
    }

    pub fn exists(&self, filepath: &str) -> bool {
        self.stat(filepath).is_ok()
    }

    pub fn stat(&self, filepath: &str) -> Result<FileStat, FsError> {
        let state = self.state.read().unwrap();
        let resolved = Self::resolve_path_internal(&state, filepath, true, 0)?;
        Self::stat_entry(&state, &resolved)
    }

    pub fn lstat(&self, filepath: &str) -> Result<FileStat, FsError> {
        let state = self.state.read().unwrap();
        let resolved = Self::resolve_path_internal(&state, filepath, false, 0)?;
        Self::stat_entry(&state, &resolved)
    }

    fn stat_entry(state: &VfsState, resolved: &str) -> Result<FileStat, FsError> {
        let entry = state
            .entries
            .get(resolved)
            .ok_or_else(|| FsError::enoent(resolved))?;
        Ok(match entry {
            VfsEntry::File {
                data,
                mode,
                ino,
                mtime_seconds,
                mtime_nanoseconds,
            } => FileStat {
                kind: NodeKind::File,
                mode: *mode,
                size: data.len() as u64,
                ino: *ino,
                dev: 1,
                uid: 1000,
                gid: 1000,
                ctime_seconds: *mtime_seconds,
                ctime_nanoseconds: *mtime_nanoseconds,
                mtime_seconds: *mtime_seconds,
                mtime_nanoseconds: *mtime_nanoseconds,
            },
            VfsEntry::HostFile {
                size,
                mode,
                ino,
                mtime_seconds,
                mtime_nanoseconds,
                ..
            } => FileStat {
                kind: NodeKind::File,
                mode: *mode,
                size: *size,
                ino: *ino,
                dev: 1,
                uid: 1000,
                gid: 1000,
                ctime_seconds: *mtime_seconds,
                ctime_nanoseconds: *mtime_nanoseconds,
                mtime_seconds: *mtime_seconds,
                mtime_nanoseconds: *mtime_nanoseconds,
            },
            VfsEntry::Dir { mode, ino } => FileStat {
                kind: NodeKind::Directory,
                mode: *mode,
                size: 0,
                ino: *ino,
                dev: 1,
                uid: 1000,
                gid: 1000,
                ctime_seconds: 1_700_000_000,
                ctime_nanoseconds: 0,
                mtime_seconds: 1_700_000_000,
                mtime_nanoseconds: 0,
            },
            VfsEntry::Symlink {
                target,
                mode,
                ino,
                mtime_seconds,
                mtime_nanoseconds,
            } => FileStat {
                kind: NodeKind::Symlink,
                mode: *mode,
                size: target.len() as u64,
                ino: *ino,
                dev: 1,
                uid: 1000,
                gid: 1000,
                ctime_seconds: *mtime_seconds,
                ctime_nanoseconds: *mtime_nanoseconds,
                mtime_seconds: *mtime_seconds,
                mtime_nanoseconds: *mtime_nanoseconds,
            },
        })
    }

    pub fn read_file(&self, filepath: &str) -> Result<Vec<u8>, FsError> {
        let state = self.state.read().unwrap();
        let resolved = Self::resolve_path_internal(&state, filepath, true, 0)?;
        match state.entries.get(&resolved) {
            Some(VfsEntry::File { data, .. }) => Ok(data.clone()),
            Some(VfsEntry::HostFile { host_path, .. }) => {
                std::fs::read(host_path).map_err(|_| FsError::enoent(filepath))
            }
            Some(VfsEntry::Dir { .. }) => Err(FsError::eisdir(filepath)),
            _ => Err(FsError::enoent(filepath)),
        }
    }

    pub fn read_file_auto_crlf(&self, filepath: &str, autocrlf: bool) -> Option<Vec<u8>> {
        let mut bytes = self.read_file(filepath).ok()?;
        if autocrlf
            && let Ok(text) = std::str::from_utf8(&bytes) {
                bytes = text.replace("\r\n", "\n").into_bytes();
            }
        Some(bytes)
    }

    pub fn read(&self, filepath: &str) -> Option<Vec<u8>> {
        self.read_file(filepath).ok()
    }

    pub fn read_str(&self, filepath: &str) -> Option<String> {
        self.read(filepath)
            .and_then(|b| String::from_utf8(b).ok())
    }

    pub fn write_file_with_mode(
        &self,
        filepath: &str,
        contents: &[u8],
        mode: u32,
    ) -> Result<(), FsError> {
        let mut state = self.state.write().unwrap();
        let resolved = Self::resolve_path_internal(&state, filepath, true, 0)?;
        let parent = dirname(&resolved);
        match state.entries.get(&parent) {
            Some(VfsEntry::Dir { .. }) => {}
            Some(_) => return Err(FsError::enotdir(&parent)),
            None => return Err(FsError::enoent(&parent)),
        }
        if matches!(state.entries.get(&resolved), Some(VfsEntry::Dir { .. })) {
            return Err(FsError::eisdir(&resolved));
        }
        let ino = match state.entries.get(&resolved) {
            Some(VfsEntry::File { ino, .. } | VfsEntry::HostFile { ino, .. }) => *ino,
            _ => {
                let i = state.next_ino;
                state.next_ino += 1;
                i
            }
        };
        state.clock_tick += 1;
        let mtime = state.clock_tick;
        let norm_mode = if (mode & 0o111) != 0 {
            0o100755
        } else {
            0o100644
        };
        state.entries.insert(
            resolved,
            VfsEntry::File {
                data: contents.to_vec(),
                mode: norm_mode,
                ino,
                mtime_seconds: mtime,
                mtime_nanoseconds: 0,
            },
        );
        Ok(())
    }

    pub fn write_file(&self, filepath: &str, contents: &[u8]) -> Result<(), FsError> {
        self.write_file_with_mode(filepath, contents, 0o100644)
    }

    pub fn write(&self, filepath: &str, contents: &[u8]) {
        if self.write_file(filepath, contents).is_err() {
            let parent = dirname(filepath);
            let _ = self.mkdir(&parent);
            let _ = self.write_file(filepath, contents);
        }
    }

    pub fn write_with_mode(&self, filepath: &str, contents: &[u8], mode: u32) {
        if self.write_file_with_mode(filepath, contents, mode).is_err() {
            let parent = dirname(filepath);
            let _ = self.mkdir(&parent);
            let _ = self.write_file_with_mode(filepath, contents, mode);
        }
    }

    pub fn write_str(&self, filepath: &str, contents: &str) {
        self.write(filepath, contents.as_bytes());
    }

    pub fn register_host_file(
        &self,
        filepath: &str,
        host_path: std::path::PathBuf,
        size: u64,
        mode: u32,
    ) {
        let mut state = self.state.write().unwrap();
        let cleaned = Self::clean_abs_path(filepath);
        let norm_mode = if (mode & 0o111) != 0 {
            0o100755
        } else {
            0o100644
        };
        let ino = state.next_ino;
        state.next_ino += 1;
        state.clock_tick += 1;
        let mtime = state.clock_tick;
        state.entries.insert(
            cleaned,
            VfsEntry::HostFile {
                host_path,
                size,
                mode: norm_mode,
                ino,
                mtime_seconds: mtime,
                mtime_nanoseconds: 0,
            },
        );
    }

    pub fn is_modified_file(&self, filepath: &str) -> bool {
        let state = self.state.read().unwrap();
        let Ok(resolved) = Self::resolve_path_internal(&state, filepath, false, 0) else {
            return false;
        };
        matches!(state.entries.get(&resolved), Some(VfsEntry::File { .. }))
    }

    pub fn mkdir_single(&self, filepath: &str) -> Result<(), FsError> {
        let mut state = self.state.write().unwrap();
        let resolved = Self::resolve_path_internal(&state, filepath, false, 0)?;
        if state.entries.contains_key(&resolved) {
            return Err(FsError::eexist(&resolved));
        }
        let parent = dirname(&resolved);
        match state.entries.get(&parent) {
            Some(VfsEntry::Dir { .. }) => {}
            Some(_) => return Err(FsError::enotdir(&parent)),
            None => return Err(FsError::enoent(&parent)),
        }
        let ino = state.next_ino;
        state.next_ino += 1;
        state.entries.insert(
            resolved,
            VfsEntry::Dir {
                mode: 0o040755,
                ino,
            },
        );
        Ok(())
    }

    pub fn mkdir(&self, filepath: &str) -> Result<(), FsError> {
        mkdirp(|p| self.mkdir_single(p), filepath, 64)
    }

    pub fn rmdir(&self, filepath: &str) -> Result<(), FsError> {
        let mut state = self.state.write().unwrap();
        let resolved = Self::resolve_path_internal(&state, filepath, false, 0)?;
        match state.entries.get(&resolved) {
            Some(VfsEntry::Dir { .. }) => {}
            Some(_) => return Err(FsError::enotdir(&resolved)),
            None => return Err(FsError::enoent(&resolved)),
        }
        let prefix = if resolved == "/" {
            "/".to_string()
        } else {
            format!("{resolved}/")
        };
        let has_children = state
            .entries
            .keys()
            .any(|k| k != &resolved && k.starts_with(&prefix));
        if has_children {
            return Err(FsError::new("ENOTEMPTY", "Directory not empty"));
        }
        state.entries.remove(&resolved);
        Ok(())
    }

    pub fn rm_recursive(&self, filepath: &str) -> Result<(), FsError> {
        let mut state = self.state.write().unwrap();
        let resolved = Self::resolve_path_internal(&state, filepath, false, 0)?;
        let prefix = format!("{resolved}/");
        let keys: Vec<String> = state
            .entries
            .keys()
            .filter(|k| *k == &resolved || k.starts_with(&prefix))
            .cloned()
            .collect();
        for k in keys {
            state.entries.remove(&k);
        }
        Ok(())
    }

    pub fn unlink(&self, filepath: &str) -> Result<(), FsError> {
        let mut state = self.state.write().unwrap();
        let resolved = Self::resolve_path_internal(&state, filepath, false, 0)?;
        match state.entries.get(&resolved) {
            Some(VfsEntry::Dir { .. }) => Err(FsError::eisdir(&resolved)),
            Some(_) => {
                state.entries.remove(&resolved);
                Ok(())
            }
            None => Err(FsError::enoent(&resolved)),
        }
    }

    pub fn readdir(&self, filepath: &str) -> Result<Vec<String>, FsError> {
        let state = self.state.read().unwrap();
        let resolved = Self::resolve_path_internal(&state, filepath, true, 0)?;
        match state.entries.get(&resolved) {
            Some(VfsEntry::Dir { .. }) => {}
            Some(_) => return Err(FsError::enotdir(&resolved)),
            None => return Err(FsError::enoent(&resolved)),
        }
        let prefix = if resolved == "/" {
            "/".to_string()
        } else {
            format!("{resolved}/")
        };
        let mut children = BTreeSet::new();
        for key in state.entries.keys() {
            if key != &resolved && key.starts_with(&prefix) {
                let rem = &key[prefix.len()..];
                if let Some(first) = rem.split('/').next()
                    && !first.is_empty() {
                        children.insert(first.to_string());
                    }
            }
        }
        Ok(children.into_iter().collect())
    }

    pub fn symlink(&self, target: &str, filepath: &str) -> Result<(), FsError> {
        let mut state = self.state.write().unwrap();
        let resolved = Self::resolve_path_internal(&state, filepath, false, 0)?;
        let parent = dirname(&resolved);
        if !matches!(state.entries.get(&parent), Some(VfsEntry::Dir { .. })) {
            return Err(FsError::enoent(&parent));
        }
        let ino = state.next_ino;
        state.next_ino += 1;
        state.clock_tick += 1;
        let mtime = state.clock_tick;
        state.entries.insert(
            resolved,
            VfsEntry::Symlink {
                target: target.as_bytes().to_vec(),
                mode: 0o120000,
                ino,
                mtime_seconds: mtime,
                mtime_nanoseconds: 0,
            },
        );
        Ok(())
    }

    pub fn writelink(&self, filepath: &str, target: &[u8]) -> Result<(), FsError> {
        let parent = dirname(filepath);
        let _ = self.mkdir(&parent);
        let target_str = String::from_utf8_lossy(target);
        let _ = self.unlink(filepath);
        self.symlink(&target_str, filepath)
    }

    pub fn readlink(&self, filepath: &str) -> Result<Vec<u8>, FsError> {
        let state = self.state.read().unwrap();
        let resolved = Self::resolve_path_internal(&state, filepath, false, 0)?;
        match state.entries.get(&resolved) {
            Some(VfsEntry::Symlink { target, .. }) => Ok(target.clone()),
            Some(_) => Err(FsError::new("EINVAL", "Not a symbolic link")),
            None => Err(FsError::enoent(filepath)),
        }
    }


    pub fn list_paths_under(&self, prefix: &str) -> Vec<String> {
        let clean = Self::clean_abs_path(prefix);
        let slash = if clean == "/" {
            "/".to_string()
        } else {
            format!("{clean}/")
        };
        let state = self.state.read().unwrap();
        state
            .entries
            .keys()
            .filter(|k| *k == &clean || k.starts_with(&slash))
            .cloned()
            .collect()
    }

    pub fn cp_recursive(&self, src: &str, dst: &str) -> Result<(), FsError> {
        let src_clean = Self::clean_abs_path(src);
        let dst_clean = Self::clean_abs_path(dst);
        let entries_snapshot: Vec<(String, VfsEntry)> = {
            let state = self.state.read().unwrap();
            let prefix = if src_clean == "/" {
                "/".to_string()
            } else {
                format!("{src_clean}/")
            };
            state
                .entries
                .iter()
                .filter(|(k, _)| *k == &src_clean || k.starts_with(&prefix))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect()
        };
        if entries_snapshot.is_empty() {
            return Ok(());
        }
        let _ = self.mkdir(&dirname(&dst_clean));
        let mut state = self.state.write().unwrap();
        for (old_key, mut entry) in entries_snapshot {
            let rel = &old_key[src_clean.len()..];
            let new_key = if rel.is_empty() {
                dst_clean.clone()
            } else {
                format!("{dst_clean}{rel}")
            };
            let new_ino = state.next_ino;
            state.next_ino += 1;
            match &mut entry {
                VfsEntry::File { ino, .. } | VfsEntry::HostFile { ino, .. } => *ino = new_ino,
                VfsEntry::Dir { ino, .. } => *ino = new_ino,
                VfsEntry::Symlink { ino, .. } => *ino = new_ino,
            }
            state.entries.insert(new_key, entry);
        }
        Ok(())
    }
    pub fn rm(&self, filepath: &str) -> Result<(), FsError> {
        self.rm_recursive(filepath)
    }

    pub fn readdir_deep(&self, filepath: &str) -> Vec<String> {
        let state = self.state.read().unwrap();
        let Ok(resolved) = Self::resolve_path_internal(&state, filepath, true, 0) else {
            return Vec::new();
        };
        let prefix = if resolved == "/" {
            "/".to_string()
        } else {
            format!("{resolved}/")
        };
        let mut results = Vec::new();
        for (k, v) in &state.entries {
            if k != &resolved && k.starts_with(&prefix) && matches!(v, VfsEntry::File { .. } | VfsEntry::HostFile { .. } | VfsEntry::Symlink { .. }) {
                let rel = &k[prefix.len()..];
                results.push(format!("{filepath}/{rel}"));
            }
        }
        results
    }
}

pub fn mkdirp<F>(mut mkdir_fn: F, filepath: &str, retries: usize) -> Result<(), FsError>
where
    F: FnMut(&str) -> Result<(), FsError>,
{
    fn inner<F>(mkdir_fn: &mut F, filepath: &str, retries: usize) -> Result<(), FsError>
    where
        F: FnMut(&str) -> Result<(), FsError>,
    {
        match mkdir_fn(filepath) {
            Ok(()) => Ok(()),
            Err(err) => {
                if err.code == "NULL" || err.code == "EEXIST" {
                    return Ok(());
                }
                if err.code != "ENOENT" {
                    return Err(err);
                }
                let parent = dirname(filepath);
                if parent == "." || parent == "/" || parent == filepath {
                    return Err(err);
                }
                inner(mkdir_fn, &parent, retries)?;
                for attempt in 0.. {
                    match mkdir_fn(filepath) {
                        Ok(()) => return Ok(()),
                        Err(err2) => {
                            if err2.code == "NULL" || err2.code == "EEXIST" {
                                return Ok(());
                            }
                            if err2.code == "ENOENT" && attempt < retries {
                                continue;
                            }
                            return Err(err2);
                        }
                    }
                }
                unreachable!()
            }
        }
    }
    inner(&mut mkdir_fn, filepath, retries)
}

pub fn discover_gitdir(fs: &MemoryFs, dotgit: &str) -> String {
    if let Ok(stat) = fs.stat(dotgit) {
        if stat.is_directory() {
            return dotgit.to_string();
        }
        if stat.is_file()
            && let Some(contents) = fs.read_str(dotgit) {
                let trimmed = contents.trim_end();
                if let Some(rest) = trimmed.strip_prefix("gitdir: ") {
                    let is_abs = rest.starts_with('/')
                        || (rest.len() >= 3
                            && rest.as_bytes()[0].is_ascii_alphabetic()
                            && rest.as_bytes()[1] == b':'
                            && (rest.as_bytes()[2] == b'/' || rest.as_bytes()[2] == b'\\'));
                    if is_abs {
                        return rest.to_string();
                    }
                    return join(&[&dirname(dotgit), rest]);
                }
            }
    }
    dotgit.to_string()
}

pub fn assert_no_symlink_in_leading_path(
    fs: &MemoryFs,
    dir: &str,
    fullpath: &str,
) -> Result<(), GitError> {
    let mut parts: Vec<&str> = fullpath.split('/').collect();
    parts.pop();
    let mut current = dir.to_string();
    for part in parts {
        if part.is_empty() || part == "." {
            continue;
        }
        current = format!("{current}/{part}");
        if let Ok(stats) = fs.lstat(&current)
            && stats.is_symbolic_link() {
                return Err(GitError::unsafe_filepath(fullpath));
            }
    }
    Ok(())
}
