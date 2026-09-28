use std::collections::{BTreeMap, BTreeSet};

use crate::errors::GitError;
use crate::fs::{discover_gitdir, NodeKind, FileStat, MemoryFs};
use crate::managers::{GitConfigManager, GitIgnoreManager, GitIndexManager, GitRefManager};
use crate::models::{GitObject, TreeEntry};
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
pub struct WalkerEntry {
    entry_type: String,
    mode: Option<u32>,
    oid: Option<String>,
    content: Option<Vec<u8>>,
    stat: Option<FileStat>,
}

impl WalkerEntry {
    pub fn entry_type(&self) -> &str {
        &self.entry_type
    }

    pub fn mode(&self) -> Option<u32> {
        self.mode
    }

    pub fn oid(&self) -> Option<&str> {
        self.oid.as_deref()
    }

    pub fn content(&self) -> Option<&[u8]> {
        self.content.as_deref()
    }

    pub fn stat(&self) -> Option<&FileStat> {
        self.stat.as_ref()
    }
}

fn collect_workdir_map(
    fs: &MemoryFs,
    dir: &str,
    gitdir: &str,
    autocrlf: bool,
) -> Result<BTreeMap<String, WalkerEntry>, GitError> {
    let mut map = BTreeMap::new();
    let root_stat = fs.lstat(dir).ok();
    map.insert(
        ".".to_string(),
        WalkerEntry {
            entry_type: "tree".to_string(),
            mode: Some(0o40000),
            oid: None,
            content: None,
            stat: root_stat,
        },
    );

    fn visit(
        fs: &MemoryFs,
        dir: &str,
        gitdir: &str,
        rel_prefix: &str,
        autocrlf: bool,
        out: &mut BTreeMap<String, WalkerEntry>,
    ) {
        let current_dir = if rel_prefix.is_empty() {
            dir.to_string()
        } else {
            join(&[dir, rel_prefix])
        };
        let Ok(mut children) = fs.readdir(&current_dir) else {
            return;
        };
        children.sort();
        for name in children {
            if name == ".git" {
                continue;
            }
            let rel_path = if rel_prefix.is_empty() {
                name.clone()
            } else {
                format!("{rel_prefix}/{name}")
            };
            if GitIgnoreManager::is_ignored(fs, dir, Some(gitdir), &rel_path) {
                continue;
            }
            let full_path = join(&[dir, &rel_path]);
            let Ok(st) = fs.lstat(&full_path) else {
                continue;
            };
            if st.is_directory() {
                out.insert(
                    rel_path.clone(),
                    WalkerEntry {
                        entry_type: "tree".to_string(),
                        mode: Some(0o40000),
                        oid: None,
                        content: None,
                        stat: Some(st),
                    },
                );
                visit(fs, dir, gitdir, &rel_path, autocrlf, out);
            } else if st.is_symbolic_link() {
                let bytes = fs.readlink(&full_path).unwrap_or_default();
                let oid = shasum(&GitObject::wrap("blob", &bytes));
                out.insert(
                    rel_path,
                    WalkerEntry {
                        entry_type: "blob".to_string(),
                        mode: Some(0o120000),
                        oid: Some(oid),
                        content: Some(bytes),
                        stat: Some(st),
                    },
                );
            } else {
                let raw = fs.read(&full_path).unwrap_or_default();
                let content = if autocrlf {
                    let mut norm = Vec::with_capacity(raw.len());
                    let mut i = 0;
                    while i < raw.len() {
                        if raw[i] == b'\r' && i + 1 < raw.len() && raw[i + 1] == b'\n' {
                            norm.push(b'\n');
                            i += 2;
                        } else {
                            norm.push(raw[i]);
                            i += 1;
                        }
                    }
                    norm
                } else {
                    raw
                };
                let oid = shasum(&GitObject::wrap("blob", &content));
                let mode = if st.mode & 0o111 != 0 {
                    0o100755
                } else {
                    0o100644
                };
                out.insert(
                    rel_path,
                    WalkerEntry {
                        entry_type: "blob".to_string(),
                        mode: Some(mode),
                        oid: Some(oid),
                        content: Some(content),
                        stat: Some(st),
                    },
                );
            }
        }
    }

    visit(fs, dir, gitdir, "", autocrlf, &mut map);
    Ok(map)
}

fn collect_tree_map(
    fs: &MemoryFs,
    gitdir: &str,
    ref_name: &str,
) -> Result<BTreeMap<String, WalkerEntry>, GitError> {
    if ref_name.contains('\n') || ref_name.contains('\r') {
        return Err(GitError::not_found(ref_name));
    }
    let oid = match GitRefManager::resolve(fs, gitdir, ref_name, None) {
        Ok(oid) => oid,
        Err(err) => {
            if GitRefManager::is_unborn_branch(fs, gitdir, ref_name) {
                "4b825dc642cb6eb9a060e54bf8d69288fbee4904".to_string()
            } else {
                return Err(err);
            }
        }
    };
    let (root_tree_oid, root_tree) = resolve_tree(fs, gitdir, &oid)?;
    let mut map = BTreeMap::new();
    map.insert(
        ".".to_string(),
        WalkerEntry {
            entry_type: "tree".to_string(),
            mode: Some(0o40000),
            oid: Some(root_tree_oid),
            content: None,
            stat: None,
        },
    );

    fn visit_tree(
        fs: &MemoryFs,
        gitdir: &str,
        entries: &[TreeEntry],
        prefix: &str,
        out: &mut BTreeMap<String, WalkerEntry>,
    ) -> Result<(), GitError> {
        for entry in entries {
            let rel = if prefix.is_empty() {
                entry.path.clone()
            } else {
                format!("{prefix}/{}", entry.path)
            };
            let mode = u32::from_str_radix(&entry.mode, 8).unwrap_or(0o100644);
            if entry.entry_type == "tree" {
                out.insert(
                    rel.clone(),
                    WalkerEntry {
                        entry_type: "tree".to_string(),
                        mode: Some(0o40000),
                        oid: Some(entry.oid.clone()),
                        content: None,
                        stat: None,
                    },
                );
                let (_, sub) = resolve_tree(fs, gitdir, &entry.oid)?;
                visit_tree(fs, gitdir, sub.entries(), &rel, out)?;
            } else {
                let content = _read_object(fs, gitdir, &entry.oid, "content")
                    .ok()
                    .map(|r| r.object);
                out.insert(
                    rel,
                    WalkerEntry {
                        entry_type: entry.entry_type.clone(),
                        mode: Some(mode),
                        oid: Some(entry.oid.clone()),
                        content,
                        stat: None,
                    },
                );
            }
        }
        Ok(())
    }

    visit_tree(fs, gitdir, root_tree.entries(), "", &mut map)?;
    Ok(map)
}

fn collect_stage_map(
    fs: &MemoryFs,
    gitdir: &str,
) -> Result<BTreeMap<String, WalkerEntry>, GitError> {
    let mut map = BTreeMap::new();
    map.insert(
        ".".to_string(),
        WalkerEntry {
            entry_type: "tree".to_string(),
            mode: None,
            oid: None,
            content: None,
            stat: None,
        },
    );
    GitIndexManager::acquire(fs, gitdir, |index| {
        for entry in index.entries() {
            let parts: Vec<&str> = entry.path.split('/').collect();
            for depth in 1..parts.len() {
                let folder = parts[..depth].join("/");
                map.entry(folder).or_insert_with(|| WalkerEntry {
                    entry_type: "tree".to_string(),
                    mode: None,
                    oid: None,
                    content: None,
                    stat: None,
                });
            }
            let st = FileStat {
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
            let entry_type = if entry.mode == 0o160000 {
                "commit"
            } else {
                "blob"
            };
            map.insert(
                entry.path.clone(),
                WalkerEntry {
                    entry_type: entry_type.to_string(),
                    mode: Some(entry.mode),
                    oid: Some(entry.oid.clone()),
                    content: None,
                    stat: Some(st),
                },
            );
        }
        Ok(())
    })?;
    Ok(map)
}

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

    let mut walker_maps = Vec::with_capacity(trees.len());
    let mut all_paths = BTreeSet::new();
    for walker in trees {
        let m = match walker {
            Walker::Workdir => {
                let d = dir.ok_or_else(|| GitError::missing_parameter("dir"))?;
                collect_workdir_map(fs, d, &gdir, autocrlf)?
            }
            Walker::Tree { ref_name } => collect_tree_map(fs, &gdir, ref_name)?,
            Walker::Stage => collect_stage_map(fs, &gdir)?,
        };
        for k in m.keys() {
            all_paths.insert(k.clone());
        }
        walker_maps.push(m);
    }

    let mut out = Vec::new();
    for path in all_paths {
        let entries: Vec<Option<WalkerEntry>> = walker_maps
            .iter()
            .map(|m| m.get(&path).cloned())
            .collect();
        if let Some(val) = map_fn(&path, entries)? {
            out.push(val);
        }
    }
    Ok(out)
}
