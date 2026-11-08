use std::collections::BTreeMap;
use std::sync::OnceLock;

use crate::errors::GitError;
use crate::fs::{FileStat, MemoryFs, NodeKind, discover_gitdir};
use crate::managers::{GitConfigManager, GitIgnoreManager, GitIndexManager, GitRefManager};
use crate::models::GitObject;
use crate::storage::{_read_object, resolve_tree};
use crate::utils::{join, shasum};

#[derive(Debug, Clone)]
pub enum Walker {
    Workdir,
    Tree { ref_name: String },
    Stage,
}

#[allow(non_snake_case)]
pub fn WORKDIR() -> Walker {
    Walker::Workdir
}

#[allow(non_snake_case)]
pub fn TREE(ref_name: Option<&str>) -> Walker {
    Walker::Tree {
        ref_name: ref_name.unwrap_or("HEAD").to_string(),
    }
}

#[allow(non_snake_case)]
pub fn STAGE() -> Walker {
    Walker::Stage
}

#[derive(Debug, Clone)]
enum ContentSource {
    Workdir {
        fs: MemoryFs,
        path: String,
        autocrlf: bool,
    },
    Object {
        fs: MemoryFs,
        gitdir: String,
    },
}

#[derive(Debug, Clone)]
pub struct WalkerEntry {
    entry_type: String,
    mode: Option<u32>,
    oid: OnceLock<Option<String>>,
    content: OnceLock<Option<Vec<u8>>>,
    stat: Option<FileStat>,
    source: Option<ContentSource>,
}

impl WalkerEntry {
    pub fn entry_type(&self) -> &str {
        &self.entry_type
    }

    pub fn mode(&self) -> Option<u32> {
        self.mode
    }

    pub fn oid(&self) -> Option<&str> {
        self.oid
            .get_or_init(|| {
                self.content()
                    .map(|bytes| shasum(&GitObject::wrap("blob", bytes)))
            })
            .as_deref()
    }

    pub fn content(&self) -> Option<&[u8]> {
        self.content
            .get_or_init(|| match self.source.as_ref()? {
                ContentSource::Workdir { fs, path, autocrlf } => {
                    if self.mode == Some(0o120000) {
                        return fs.readlink(path).ok();
                    }
                    let raw = fs.read(path)?;
                    if !autocrlf {
                        return Some(raw);
                    }
                    let mut normalized = Vec::with_capacity(raw.len());
                    let mut i = 0;
                    while i < raw.len() {
                        if raw[i] == b'\r' && raw.get(i + 1) == Some(&b'\n') {
                            i += 1;
                        }
                        normalized.push(raw[i]);
                        i += 1;
                    }
                    Some(normalized)
                }
                ContentSource::Object { fs, gitdir } => {
                    _read_object(fs, gitdir, self.oid.get()?.as_deref()?, "content")
                        .ok()
                        .map(|object| object.object)
                }
            })
            .as_deref()
    }

    pub fn stat(&self) -> Option<&FileStat> {
        self.stat.as_ref()
    }

    fn directory(mode: Option<u32>, oid: Option<String>, stat: Option<FileStat>) -> Self {
        Self {
            entry_type: "tree".to_string(),
            mode,
            oid: OnceLock::from(oid),
            content: OnceLock::new(),
            stat,
            source: None,
        }
    }
}

fn workdir_children(
    fs: &MemoryFs,
    dir: &str,
    path: &str,
    autocrlf: bool,
) -> BTreeMap<String, WalkerEntry> {
    let full_path = join(&[dir, path]);
    let mut children = BTreeMap::new();
    for name in fs.readdir(&full_path).unwrap_or_default() {
        if name == ".git" {
            continue;
        }
        let path = join(&[&full_path, &name]);
        let Ok(stat) = fs.lstat(&path) else { continue };
        let entry = if stat.is_directory() {
            WalkerEntry::directory(Some(0o40000), None, Some(stat))
        } else {
            let mode = if stat.is_symbolic_link() {
                0o120000
            } else if stat.mode & 0o111 != 0 {
                0o100755
            } else {
                0o100644
            };
            WalkerEntry {
                entry_type: "blob".to_string(),
                mode: Some(mode),
                oid: OnceLock::new(),
                content: OnceLock::new(),
                stat: Some(stat),
                source: Some(ContentSource::Workdir {
                    fs: fs.clone(),
                    path,
                    autocrlf,
                }),
            }
        };
        children.insert(name, entry);
    }
    children
}

fn tree_children(
    fs: &MemoryFs,
    gitdir: &str,
    oid: &str,
) -> Result<BTreeMap<String, WalkerEntry>, GitError> {
    let (_, tree) = resolve_tree(fs, gitdir, oid)?;
    Ok(tree
        .entries()
        .iter()
        .map(|entry| {
            let mode = u32::from_str_radix(&entry.mode, 8).unwrap_or(0o100644);
            let source = (entry.entry_type != "tree").then(|| ContentSource::Object {
                fs: fs.clone(),
                gitdir: gitdir.to_string(),
            });
            (
                entry.path.clone(),
                WalkerEntry {
                    entry_type: entry.entry_type.clone(),
                    mode: Some(mode),
                    oid: OnceLock::from(Some(entry.oid.clone())),
                    content: OnceLock::new(),
                    stat: None,
                    source,
                },
            )
        })
        .collect())
}

type StageDirectories = BTreeMap<String, BTreeMap<String, WalkerEntry>>;

fn stage_directories(fs: &MemoryFs, gitdir: &str) -> Result<StageDirectories, GitError> {
    let mut directories = StageDirectories::new();
    GitIndexManager::acquire(fs, gitdir, |index| {
        for entry in index.entries() {
            let mut parts = entry.path.split('/').peekable();
            let mut parent = ".".to_string();
            while let Some(name) = parts.next() {
                let children = directories.entry(parent.clone()).or_default();
                if parts.peek().is_some() {
                    children
                        .entry(name.to_string())
                        .or_insert_with(|| WalkerEntry::directory(None, None, None));
                    parent = if parent == "." {
                        name.to_string()
                    } else {
                        format!("{parent}/{name}")
                    };
                    continue;
                }
                let stat = FileStat {
                    kind: NodeKind::File,
                    ctime_seconds: entry.ctime_seconds,
                    ctime_nanoseconds: entry.ctime_nanoseconds,
                    mtime_seconds: entry.mtime_seconds,
                    mtime_nanoseconds: entry.mtime_nanoseconds,
                    dev: entry.dev as u64,
                    ino: entry.ino as u64,
                    mode: entry.mode,
                    uid: entry.uid,
                    gid: entry.gid,
                    size: entry.size as u64,
                };
                children.insert(
                    name.to_string(),
                    WalkerEntry {
                        entry_type: if entry.mode == 0o160000 {
                            "commit"
                        } else {
                            "blob"
                        }
                        .to_string(),
                        mode: Some(entry.mode),
                        oid: OnceLock::from(Some(entry.oid.clone())),
                        content: OnceLock::new(),
                        stat: Some(stat),
                        source: None,
                    },
                );
            }
        }
        Ok(())
    })?;
    Ok(directories)
}

/// Walk entries in path order. Returning `None` prunes a directory, including `.`.
/// To omit a directory from the result while descending, return `Some(None)` and
/// flatten the resulting `Vec<Option<T>>`. Blob bytes and workdir OIDs are lazy.
pub fn walk<T, F>(
    fs: &MemoryFs,
    dir: Option<&str>,
    gitdir: &str,
    trees: &[Walker],
    mut map_fn: F,
) -> Result<Vec<T>, GitError>
where
    F: FnMut(&str, Vec<Option<WalkerEntry>>) -> Result<Option<T>, GitError>,
{
    let gdir = discover_gitdir(fs, gitdir);
    let cfg = GitConfigManager::get(fs, &gdir);
    let autocrlf = cfg
        .get("core.autocrlf")
        .map(|v| v.as_bool() == Some(true) || v.as_str().eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let mut roots = Vec::new();
    let mut stages = BTreeMap::new();
    for (i, walker) in trees.iter().enumerate() {
        let root = match walker {
            Walker::Workdir => {
                let dir = dir.ok_or_else(|| GitError::missing_parameter("dir"))?;
                WalkerEntry::directory(Some(0o40000), None, fs.lstat(dir).ok())
            }
            Walker::Tree { ref_name } => {
                if ref_name.contains('\n') || ref_name.contains('\r') {
                    return Err(GitError::not_found(ref_name));
                }
                let oid = match GitRefManager::resolve(fs, &gdir, ref_name, None) {
                    Ok(oid) => oid,
                    Err(_) if GitRefManager::is_unborn_branch(fs, &gdir, ref_name) => {
                        "4b825dc642cb6eb9a060e54bf8d69288fbee4904".to_string()
                    }
                    Err(err) => return Err(err),
                };
                let (oid, _) = resolve_tree(fs, &gdir, &oid)?;
                WalkerEntry::directory(Some(0o40000), Some(oid), None)
            }
            Walker::Stage => {
                stages.insert(i, stage_directories(fs, &gdir)?);
                WalkerEntry::directory(None, None, None)
            }
        };
        roots.push(Some(root));
    }
    let mut pending = BTreeMap::new();
    if !roots.is_empty() {
        pending.insert(".".to_string(), roots);
    }
    let mut out = Vec::new();
    while let Some((path, mut entries)) = pending.pop_first() {
        let tracked = entries
            .iter()
            .zip(trees)
            .any(|(entry, walker)| entry.is_some() && !matches!(walker, Walker::Workdir));
        if !tracked {
            for (entry, walker) in entries.iter_mut().zip(trees) {
                if matches!(walker, Walker::Workdir)
                    && let Some(working) = entry
                {
                    let ignore_path = if working.entry_type() == "tree" && path != "." {
                        format!("{path}/")
                    } else {
                        path.clone()
                    };
                    if GitIgnoreManager::is_ignored(fs, dir.unwrap(), Some(&gdir), &ignore_path) {
                        *entry = None;
                    }
                }
            }
        }
        if entries.iter().all(Option::is_none) {
            continue;
        }
        let directories: Vec<_> = entries
            .iter()
            .enumerate()
            .filter_map(|(i, entry)| {
                let entry = entry.as_ref()?;
                (entry.entry_type() == "tree").then(|| (i, entry.oid().map(str::to_string)))
            })
            .collect();
        let Some(value) = map_fn(&path, entries)? else {
            continue;
        };
        out.push(value);
        for (i, oid) in directories {
            let children = match &trees[i] {
                Walker::Workdir => workdir_children(fs, dir.unwrap(), &path, autocrlf),
                Walker::Tree { .. } => tree_children(fs, &gdir, oid.as_deref().unwrap())?,
                Walker::Stage => stages
                    .get_mut(&i)
                    .unwrap()
                    .remove(&path)
                    .unwrap_or_default(),
            };
            for (name, entry) in children {
                let child_path = if path == "." {
                    name
                } else {
                    format!("{path}/{name}")
                };
                pending
                    .entry(child_path)
                    .or_insert_with(|| vec![None; trees.len()])[i] = Some(entry);
            }
        }
    }
    Ok(out)
}
