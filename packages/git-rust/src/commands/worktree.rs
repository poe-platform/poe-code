use std::collections::{BTreeMap, BTreeSet};

use crate::commands::plumbing::{
    find_merge_base, is_descendent, read_blob, read_commit, read_tree, write_blob, write_commit,
};
use crate::errors::{ErrorCode, GitError};
use crate::fs::{assert_no_symlink_in_leading_path, discover_gitdir, FileStat, MemoryFs, NodeKind};
use crate::managers::{
    GitConfigManager, GitIgnoreManager, GitIndexManager, GitRefManager, GitStashManager,
};
use crate::models::{CommitObject, GitIndex, GitTree, TreeEntry};
use crate::storage::{_write_object, hash_object, resolve_filepath_entry};
use crate::utils::{
    is_binary, join, merge_file, Author,
};

const EMPTY_TREE_OID: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

pub fn list_files(
    fs: &MemoryFs,
    gitdir: &str,
    ref_name: Option<&str>,
) -> Result<Vec<String>, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    if let Some(r) = ref_name {
        let oid = GitRefManager::resolve(fs, &gdir, r, None)?;
        let mut filenames = Vec::new();
        accumulate_files_from_oid(fs, &gdir, &oid, "", &mut filenames)?;
        Ok(filenames)
    } else {
        GitIndexManager::acquire(fs, &gdir, |index| {
            Ok(index.entries().into_iter().map(|e| e.path).collect())
        })
    }
}

fn accumulate_files_from_oid(
    fs: &MemoryFs,
    gitdir: &str,
    oid: &str,
    prefix: &str,
    filenames: &mut Vec<String>,
) -> Result<(), GitError> {
    let res = read_tree(fs, gitdir, oid, None)?;
    for entry in res.tree {
        let path = if prefix.is_empty() {
            entry.path
        } else {
            join(&[prefix, &entry.path])
        };
        if entry.entry_type == "tree" {
            accumulate_files_from_oid(fs, gitdir, &entry.oid, &path, filenames)?;
        } else {
            filenames.push(path);
        }
    }
    Ok(())
}

pub fn collect_tree_map(
    fs: &MemoryFs,
    gitdir: &str,
    oid: &str,
    prefix: &str,
    map: &mut BTreeMap<String, TreeEntry>,
) -> Result<(), GitError> {
    let res = read_tree(fs, gitdir, oid, None)?;
    for mut entry in res.tree {
        let full_path = if prefix.is_empty() {
            entry.path.clone()
        } else {
            join(&[prefix, &entry.path])
        };
        if entry.entry_type == "tree" {
            collect_tree_map(fs, gitdir, &entry.oid, &full_path, map)?;
        } else {
            entry.path = full_path.clone();
            map.insert(full_path, entry);
        }
    }
    Ok(())
}

fn get_head_tree_map(fs: &MemoryFs, gitdir: &str, ref_name: &str) -> Result<BTreeMap<String, TreeEntry>, GitError> {
    let mut map = BTreeMap::new();
    let Ok(oid) = GitRefManager::resolve(fs, gitdir, ref_name, None) else {
        return Ok(map);
    };
    collect_tree_map(fs, gitdir, &oid, "", &mut map)?;
    Ok(map)
}

fn compute_workdir_oid(fs: &MemoryFs, dir: &str, gitdir: &str, filepath: &str) -> Option<(String, FileStat)> {
    let full = join(&[dir, filepath]);
    let stat = fs.lstat(&full).ok()?;
    if stat.is_directory() {
        return None;
    }
    let bytes = if stat.is_symbolic_link() {
        fs.readlink(&full).ok()?
    } else {
        let cfg = GitConfigManager::get(fs, gitdir);
        let autocrlf = cfg.get("core.autocrlf").and_then(|v| v.as_bool()).unwrap_or(false);
        fs.read_file_auto_crlf(&full, autocrlf)?
    };
    Some((hash_object("blob", &bytes), stat))
}

pub fn status(
    fs: &MemoryFs,
    dir: &str,
    gitdir: Option<&str>,
    filepath: &str,
) -> Result<String, GitError> {
    let raw_gdir = gitdir
        .map(|s| s.to_string())
        .unwrap_or_else(|| join(&[dir, ".git"]));
    let gdir = discover_gitdir(fs, &raw_gdir);

    let head_map = get_head_tree_map(fs, &gdir, "HEAD")?;
    let tree_oid = head_map.get(filepath).map(|e| e.oid.clone());

    let index_oid = GitIndexManager::acquire(fs, &gdir, |index| {
        Ok(index
            .entries()
            .into_iter()
            .find(|e| e.path == filepath)
            .map(|e| e.oid))
    })?;

    if tree_oid.is_none() && index_oid.is_none()
        && GitIgnoreManager::is_ignored(fs, dir, Some(&gdir), filepath) {
            return Ok("ignored".to_string());
        }

    let workdir_info = compute_workdir_oid(fs, dir, &gdir, filepath);
    let h = tree_oid.is_some();
    let i = index_oid.is_some();
    let w = workdir_info.is_some();

    match (h, w, i) {
        (false, false, false) => Ok("absent".to_string()),
        (false, false, true) => Ok("*absent".to_string()),
        (false, true, false) => Ok("*added".to_string()),
        (false, true, true) => {
            let (w_oid, _) = workdir_info.unwrap();
            if Some(&w_oid) == index_oid.as_ref() {
                Ok("added".to_string())
            } else {
                Ok("*added".to_string())
            }
        }
        (true, false, false) => Ok("deleted".to_string()),
        (true, false, true) => Ok("*deleted".to_string()),
        (true, true, false) => {
            let (w_oid, _) = workdir_info.unwrap();
            if Some(&w_oid) == tree_oid.as_ref() {
                Ok("*undeleted".to_string())
            } else {
                Ok("*undeletemodified".to_string())
            }
        }
        (true, true, true) => {
            let (w_oid, _) = workdir_info.unwrap();
            if Some(&w_oid) == tree_oid.as_ref() {
                if Some(&w_oid) == index_oid.as_ref() {
                    Ok("unmodified".to_string())
                } else {
                    Ok("*unmodified".to_string())
                }
            } else if Some(&w_oid) == index_oid.as_ref() {
                Ok("modified".to_string())
            } else {
                Ok("*modified".to_string())
            }
        }
    }
}

pub type StatusRow = (String, u8, u8, u8);

pub fn status_matrix(
    fs: &MemoryFs,
    dir: &str,
    gitdir: Option<&str>,
    ref_name: Option<&str>,
    filepaths: Option<&[String]>,
) -> Result<Vec<StatusRow>, GitError> {
    let raw_gdir = gitdir
        .map(|s| s.to_string())
        .unwrap_or_else(|| join(&[dir, ".git"]));
    let gdir = discover_gitdir(fs, &raw_gdir);
    let target_ref = ref_name.unwrap_or("HEAD");

    let head_map = get_head_tree_map(fs, &gdir, target_ref)?;
    let index_map: BTreeMap<String, String> = GitIndexManager::acquire(fs, &gdir, |index| {
        Ok(index
            .entries()
            .into_iter()
            .map(|e| (e.path, e.oid))
            .collect())
    })?;

    let skipped: BTreeSet<String> = GitIndexManager::acquire(fs, &gdir, |index| {
        Ok(index.entries().into_iter().filter(|e| e.flags.skip_worktree).map(|e| e.path).collect())
    })?;
    let prefix = format!("{dir}/");
    let mut all_paths: BTreeSet<String> = BTreeSet::new();
    for k in head_map.keys() {
        all_paths.insert(k.clone());
    }
    for k in index_map.keys() {
        all_paths.insert(k.clone());
    }
    for abs in fs.readdir_deep(dir) {
        if let Some(rel) = abs.strip_prefix(&prefix) {
            if rel == ".git" || rel.starts_with(".git/") {
                continue;
            }
            if !head_map.contains_key(rel)
                && !index_map.contains_key(rel)
                && GitIgnoreManager::is_ignored(fs, dir, Some(&gdir), rel)
            {
                continue;
            }
            all_paths.insert(rel.to_string());
        }
    }

    let mut rows = Vec::new();
    for path in all_paths {
        if let Some(filters) = filepaths {
            let matched = filters.iter().any(|f| {
                let fc = f.trim_end_matches('/');
                fc.is_empty() || fc == "." || path == fc || path.starts_with(&format!("{fc}/"))
            });
            if !matched {
                continue;
            }
        }

        let h_oid = head_map.get(&path).map(|e| e.oid.clone());
        let i_oid = index_map.get(&path).cloned();
        let w_oid = compute_workdir_oid(fs, dir, &gdir, &path).map(|(oid, _)| oid)
            .or_else(|| if skipped.contains(&path) { i_oid.clone() } else { None });

        let h_val = if h_oid.is_some() { 1 } else { 0 };
        let w_val = match (&h_oid, &w_oid, &i_oid) {
            (_, None, _) => 0,
            (Some(ho), Some(wo), _) if ho == wo => 1,
            (None, Some(wo), Some(io)) if wo == io => 2,
            _ => 2,
        };
        let s_val = match (&h_oid, &w_oid, &i_oid) {
            (_, _, None) => 0,
            (Some(ho), _, Some(io)) if ho == io => 1,
            (_, Some(wo), Some(io)) if wo == io => 2,
            (_, None, Some(_)) => 2,
            _ => 3,
        };

        rows.push((path, h_val, w_val, s_val));
    }

    Ok(rows)
}

pub fn add(
    fs: &MemoryFs,
    dir: &str,
    gitdir: Option<&str>,
    filepaths: &[String],
    force: bool,
) -> Result<(), GitError> {
    let raw_gdir = gitdir
        .map(|s| s.to_string())
        .unwrap_or_else(|| join(&[dir, ".git"]));
    let gdir = discover_gitdir(fs, &raw_gdir);
    let cfg = GitConfigManager::get(fs, &gdir);
    let autocrlf = cfg.get("core.autocrlf").and_then(|v| v.as_bool()).unwrap_or(false);

    GitIndexManager::acquire(fs, &gdir, |index| {
        let mut errors = Vec::new();
        for fp in filepaths {
            if let Err(e) = add_path_to_index(fs, dir, &gdir, fp, index, force, autocrlf) {
                errors.push(e);
            }
        }
        if errors.len() > 1 {
            return Err(GitError::multiple(errors));
        }
        if let Some(err) = errors.into_iter().next() {
            return Err(err);
        }
        Ok(())
    })
}

fn add_path_to_index(
    fs: &MemoryFs,
    dir: &str,
    gitdir: &str,
    current_filepath: &str,
    index: &mut GitIndex,
    force: bool,
    autocrlf: bool,
) -> Result<(), GitError> {
    if !force && GitIgnoreManager::is_ignored(fs, dir, Some(gitdir), current_filepath) {
        return Ok(());
    }
    let full = if current_filepath == "." || current_filepath.is_empty() {
        dir.to_string()
    } else {
        join(&[dir, current_filepath])
    };
    let Ok(stats) = fs.lstat(&full) else {
        return Err(GitError::not_found(current_filepath));
    };
    if stats.is_directory() {
        let children = fs.readdir(&full).unwrap_or_default();
        for child in children {
            if child == ".git" {
                continue;
            }
            let child_rel = if current_filepath == "." || current_filepath.is_empty() {
                child
            } else {
                join(&[current_filepath, &child])
            };
            add_path_to_index(fs, dir, gitdir, &child_rel, index, force, autocrlf)?;
        }
    } else {
        let bytes = if stats.is_symbolic_link() {
            fs.readlink(&full).map_err(|_| GitError::not_found(current_filepath))?
        } else {
            fs.read_file_auto_crlf(&full, autocrlf)
                .ok_or_else(|| GitError::not_found(current_filepath))?
        };
        let oid = _write_object(fs, gitdir, "blob", &bytes, "content", None, false)?;
        index.insert(current_filepath, Some(&stats), &oid, 0);
    }
    Ok(())
}

pub fn remove(
    fs: &MemoryFs,
    gitdir: &str,
    filepath: &str,
) -> Result<(), GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    GitIndexManager::acquire(fs, &gdir, |index| {
        index.delete(filepath);
        Ok(())
    })
}

pub fn reset_index(
    fs: &MemoryFs,
    dir: Option<&str>,
    gitdir: &str,
    filepath: &str,
    ref_name: Option<&str>,
) -> Result<(), GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let commit_oid = match GitRefManager::resolve(fs, &gdir, ref_name.unwrap_or("HEAD"), None) {
        Ok(o) => Some(o),
        Err(e) => {
            if ref_name.is_some() {
                return Err(e);
            }
            None
        }
    };
    let entry = commit_oid.as_ref().and_then(|oid| resolve_filepath_entry(fs, &gdir, oid, filepath).ok());
    let blob_oid = entry.as_ref().map(|entry| entry.oid.clone());

    let mut stat = FileStat {
        kind: NodeKind::File,
        mode: 0o100644,
        size: 0,
        ino: 0,
        dev: 0,
        uid: 0,
        gid: 0,
        ctime_seconds: 0,
        ctime_nanoseconds: 0,
        mtime_seconds: 0,
        mtime_nanoseconds: 0,
    };

    if let (Some(d), Some(target_oid)) = (dir, blob_oid.as_ref())
        && let Some((w_oid, w_stat)) = compute_workdir_oid(fs, d, &gdir, filepath)
            && &w_oid == target_oid {
                stat = w_stat;
            }

    if let Some(entry) = entry {
        stat.mode = u32::from_str_radix(&entry.mode, 8).map_err(|_| GitError::internal("invalid tree mode"))?;
    }

    GitIndexManager::acquire(fs, &gdir, |index| {
        index.delete(filepath);
        if let Some(ref oid) = blob_oid {
            index.insert(filepath, Some(&stat), oid, 0);
        }
        Ok(())
    })
}

#[allow(clippy::too_many_arguments)]
pub fn update_index(
    fs: &MemoryFs,
    dir: &str,
    gitdir: &str,
    filepath: &str,
    oid: Option<&str>,
    mode: Option<u32>,
    add: bool,
    remove: bool,
    force: bool,
) -> Result<Option<String>, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    if remove {
        return GitIndexManager::acquire(fs, &gdir, |index| {
            if !force
                && let Ok(st) = fs.lstat(&join(&[dir, filepath])) {
                    if st.is_directory() {
                        return Err(GitError::invalid_filepath(Some("directory")));
                    }
                    return Ok(None);
                }
            index.delete(filepath);
            Ok(None)
        });
    }

    let disk_stat = if oid.is_none() {
        let st = fs.lstat(&join(&[dir, filepath])).map_err(|_| {
            GitError::not_found(&format!("file at \"{filepath}\" on disk and \"remove\" not set"))
        })?;
        if st.is_directory() {
            return Err(GitError::invalid_filepath(Some("directory")));
        }
        Some(st)
    } else {
        None
    };

    GitIndexManager::acquire(fs, &gdir, |index| {
        let exists_in_index = index.entries_map().contains_key(filepath);
        if !add && !exists_in_index {
            return Err(GitError::not_found(&format!(
                "file at \"{filepath}\" in index and \"add\" not set"
            )));
        }

        let (final_oid, final_stat) = if let Some(explicit_oid) = oid {
            (
                explicit_oid.to_string(),
                FileStat {
                    kind: NodeKind::File,
                    mode: mode.unwrap_or(0o100644),
                    size: 0,
                    ino: 0,
                    dev: 0,
                    uid: 0,
                    gid: 0,
                    ctime_seconds: 0,
                    ctime_nanoseconds: 0,
                    mtime_seconds: 0,
                    mtime_nanoseconds: 0,
                },
            )
        } else {
            let st = disk_stat.unwrap();
            let full = join(&[dir, filepath]);
            let bytes = if st.is_symbolic_link() {
                fs.readlink(&full).unwrap_or_default()
            } else {
                fs.read(&full).unwrap_or_default()
            };
            let written_oid = _write_object(fs, &gdir, "blob", &bytes, "content", None, false)?;
            (written_oid, st)
        };

        index.insert(filepath, Some(&final_stat), &final_oid, 0);
        Ok(Some(final_oid))
    })
}

pub fn construct_index_tree(fs: &MemoryFs, gitdir: &str, index: &GitIndex, dry_run: bool) -> Result<String, GitError> {
    let entries: Vec<(String, TreeEntry)> = index
        .entries()
        .into_iter()
        .map(|e| {
            let mode_str = format!("{:06o}", e.mode);
            let entry_type = if e.mode == 0o160000 {
                "commit"
            } else {
                "blob"
            };
            (
                e.path.clone(),
                TreeEntry {
                    mode: mode_str,
                    path: e.path,
                    oid: e.oid,
                    entry_type: entry_type.to_string(),
                },
            )
        })
        .collect();
    write_directory_tree_recursive(fs, gitdir, &entries, "", dry_run)
}

fn write_directory_tree_recursive(
    fs: &MemoryFs,
    gitdir: &str,
    entries: &[(String, TreeEntry)],
    prefix: &str,
    dry_run: bool,
) -> Result<String, GitError> {
    let mut tree_entries: Vec<TreeEntry> = Vec::new();
    let mut subdirs: BTreeMap<String, Vec<(String, TreeEntry)>> = BTreeMap::new();

    for (rel_path, entry) in entries {
        if let Some((first, rest)) = rel_path.split_once('/') {
            subdirs
                .entry(first.to_string())
                .or_default()
                .push((rest.to_string(), entry.clone()));
        } else {
            let mut leaf = entry.clone();
            leaf.path = rel_path.clone();
            tree_entries.push(leaf);
        }
    }

    for (subdir_name, sub_entries) in subdirs {
        let sub_prefix = if prefix.is_empty() {
            subdir_name.clone()
        } else {
            join(&[prefix, &subdir_name])
        };
        let sub_oid = write_directory_tree_recursive(fs, gitdir, &sub_entries, &sub_prefix, dry_run)?;
        tree_entries.push(TreeEntry {
            mode: "040000".to_string(),
            path: subdir_name,
            oid: sub_oid,
            entry_type: "tree".to_string(),
        });
    }

    let tree_bytes = GitTree::from_entries(tree_entries)?.to_object()?;
    _write_object(fs, gitdir, "tree", &tree_bytes, "content", None, dry_run)
}

#[allow(clippy::too_many_arguments)]
pub fn commit(
    fs: &MemoryFs,
    gitdir: &str,
    message: Option<&str>,
    author: Option<Author>,
    committer: Option<Author>,
    amend: bool,
    dry_run: bool,
    no_update_branch: bool,
    disallow_empty: bool,
    ref_name: Option<&str>,
    parent: Option<&[String]>,
    tree: Option<&str>,
) -> Result<String, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let mut detached_head = false;
    let target_ref = if let Some(r) = ref_name {
        r.to_string()
    } else {
        let head_content = fs.read_str(&format!("{gdir}/HEAD")).unwrap_or_default();
        detached_head = !head_content.starts_with("ref:");
        GitRefManager::resolve(fs, &gdir, "HEAD", Some(2)).unwrap_or_else(|_| "HEAD".to_string())
    };

    let ref_oid = GitRefManager::resolve(fs, &gdir, &target_ref, None).ok();
    let ref_commit = ref_oid
        .as_ref()
        .and_then(|oid| read_commit(fs, &gdir, oid).ok());
    let initial_commit = ref_commit.is_none();

    if amend && initial_commit {
        return Err(GitError::no_commit(&target_ref));
    }

    let cfg = GitConfigManager::get(fs, &gdir);
    let final_author = match author {
        Some(a) => a,
        None => {
            if amend {
                if let Some(ref rc) = ref_commit {
                    rc.commit.author.clone()
                } else {
                    return Err(GitError::missing_name("author"));
                }
            } else {
                let name = cfg.get("user.name").map(|v| v.as_str().to_string()).unwrap_or_default();
                let email = cfg.get("user.email").map(|v| v.as_str().to_string()).unwrap_or_default();
                if name.is_empty() {
                    return Err(GitError::missing_name("author"));
                }
                Author {
                    name,
                    email,
                    timestamp: 1502484200,
                    timezone_offset: 0.0,
                }
            }
        }
    };
    let final_committer = committer.unwrap_or_else(|| final_author.clone());

    GitIndexManager::acquire(fs, &gdir, |index| {
        if !index.unmerged_paths().is_empty() {
            return Err(GitError::unmerged_paths(index.unmerged_paths()));
        }

        let tree_oid = if let Some(t) = tree {
            t.to_string()
        } else {
            construct_index_tree(fs, &gdir, index, dry_run)?
        };

        let parents: Vec<String> = if let Some(explicit_parents) = parent {
            let mut resolved = Vec::new();
            for p in explicit_parents {
                resolved.push(GitRefManager::resolve(fs, &gdir, p, None)?);
            }
            resolved
        } else if amend {
            ref_commit
                .as_ref()
                .map(|rc| rc.commit.parent.clone())
                .unwrap_or_default()
        } else {
            ref_oid.clone().into_iter().collect()
        };

        if disallow_empty && !amend {
            let is_empty = if initial_commit {
                tree_oid == EMPTY_TREE_OID
            } else {
                ref_commit
                    .as_ref()
                    .map(|rc| rc.commit.tree == tree_oid)
                    .unwrap_or(false)
            };
            if is_empty {
                return Err(GitError::empty_commit());
            }
        }

        let final_message = match message {
            Some(m) => m.to_string(),
            None => {
                if amend {
                    ref_commit
                        .as_ref()
                        .map(|rc| rc.commit.message.clone())
                        .unwrap_or_default()
                } else {
                    return Err(GitError::missing_parameter("message"));
                }
            }
        };

        let comm_obj = CommitObject {
            message: final_message,
            tree: tree_oid,
            parent: parents,
            author: final_author,
            committer: final_committer,
            gpgsig: None,
        };
        let bytes = crate::models::GitCommit::from_object(&comm_obj).to_object();
        let oid = _write_object(fs, &gdir, "commit", &bytes, "content", None, dry_run)?;
        if !no_update_branch && !dry_run {
            let update_ref = if detached_head { "HEAD" } else { &target_ref };
            let old_oid = ref_oid.as_deref().unwrap_or("0000000000000000000000000000000000000000");
            let subj = comm_obj.message.lines().next().unwrap_or("");
            let action_prefix = if initial_commit {
                "commit (initial)"
            } else if amend {
                "commit (amend)"
            } else {
                "commit"
            };
            let entry_line = format!(
                "{} {} {} <{}> {} +0000\t{}: {}\n",
                old_oid,
                oid,
                comm_obj.committer.name,
                comm_obj.committer.email,
                comm_obj.committer.timestamp,
                action_prefix,
                subj
            );
            let head_log = format!("{gdir}/logs/HEAD");
            let prev_head_log = fs.read_str(&head_log).unwrap_or_default();
            fs.write_str(&head_log, &format!("{prev_head_log}{entry_line}"));
            if update_ref != "HEAD" {
                let ref_log = format!("{gdir}/logs/{update_ref}");
                let prev_ref_log = fs.read_str(&ref_log).unwrap_or_default();
                fs.write_str(&ref_log, &format!("{prev_ref_log}{entry_line}"));
            }
            GitRefManager::write_ref(fs, &gdir, update_ref, &oid)?;
        }
        Ok(oid)
    })
}

#[allow(clippy::too_many_arguments)]
pub fn checkout(
    fs: &MemoryFs,
    dir: &str,
    gitdir: Option<&str>,
    ref_name: Option<&str>,
    filepaths: Option<&[String]>,
    remote: Option<&str>,
    no_checkout: bool,
    no_update_head: bool,
    dry_run: bool,
    force: bool,
    track: bool,
) -> Result<(), GitError> {
    let raw_gdir = gitdir
        .map(|s| s.to_string())
        .unwrap_or_else(|| join(&[dir, ".git"]));
    let gdir = discover_gitdir(fs, &raw_gdir);
    let r = ref_name.unwrap_or("HEAD");
    let rem = remote.unwrap_or("origin");

    let oid = match GitRefManager::resolve(fs, &gdir, r, None) {
        Ok(o) => o,
        Err(e) => {
            if r == "HEAD" {
                return Err(e);
            }
            let remote_ref = format!("{rem}/{r}");
            let remote_oid = GitRefManager::resolve(fs, &gdir, &remote_ref, None)?;
            if track {
                let mut cfg = GitConfigManager::get(fs, &gdir);
                cfg.set(&format!("branch.{r}.remote"), Some(rem));
                cfg.set(&format!("branch.{r}.merge"), Some(&format!("refs/heads/{r}")));
                GitConfigManager::save(fs, &gdir, &cfg);
            }
            GitRefManager::write_ref(fs, &gdir, &format!("refs/heads/{r}"), &remote_oid)?;
            remote_oid
        }
    };

    if !no_checkout {
        let mut target_map = BTreeMap::new();
        if let Err(e) = collect_tree_map(fs, &gdir, &oid, "", &mut target_map) {
            if e.code == ErrorCode::NotFoundError {
                return Err(GitError::commit_not_fetched(r, &oid));
            }
            return Err(e);
        }
        let head_map = get_head_tree_map(fs, &gdir, "HEAD")?;

        if !force {
            let mut conflicts = Vec::new();
            for (path, target_entry) in &target_map {
                if let Some(filters) = filepaths
                    && !filters.iter().any(|f| path == f || path.starts_with(&format!("{f}/"))) {
                        continue;
                    }
                if let Some((w_oid, _)) = compute_workdir_oid(fs, dir, &gdir, path) {
                    let h_oid = head_map.get(path).map(|e| e.oid.as_str());
                    if Some(w_oid.as_str()) != h_oid && w_oid != target_entry.oid {
                        conflicts.push(path.clone());
                    }
                }
            }
            for (path, h_entry) in &head_map {
                if !target_map.contains_key(path)
                    && let Some((w_oid, _)) = compute_workdir_oid(fs, dir, &gdir, path)
                        && w_oid != h_entry.oid {
                            conflicts.push(path.clone());
                        }
            }
            if !conflicts.is_empty() {
                conflicts.sort();
                conflicts.dedup();
                return Err(GitError::checkout_conflict(conflicts));
            }
        }

        if !dry_run {
            for target_entry in target_map.values() {
                assert_no_symlink_in_leading_path(fs, dir, &target_entry.path)?;
            }

            if filepaths.is_none() {
                for (path, h_entry) in &head_map {
                    if !target_map.contains_key(path)
                        && h_entry.entry_type != "commit"
                        && h_entry.mode != "160000"
                    {
                        let _ = fs.unlink(&join(&[dir, path]));
                    }
                }
            }

            GitIndexManager::acquire(fs, &gdir, |index| {
                if filepaths.is_none() {
                    index.clear();
                }
                for (path, entry) in &target_map {
                    if let Some(filters) = filepaths
                        && !filters.iter().any(|f| path == f || path.starts_with(&format!("{f}/"))) {
                            continue;
                        }
                    let full_path = join(&[dir, path]);
                    if entry.entry_type == "commit" || entry.mode == "160000" {
                        let _ = fs.mkdir(&full_path);
                        if let Ok(mut st) = fs.lstat(&full_path) {
                            st.mode = 0o160000;
                            st.size = 0;
                            index.insert(path, Some(&st), &entry.oid, 0);
                        }
                        continue;
                    }
                    let blob = read_blob(fs, &gdir, &entry.oid, None)?.blob;
                    if entry.mode == "120000" {
                        let _ = fs.writelink(&full_path, &blob);
                    } else {
                        let mode_num = u32::from_str_radix(&entry.mode, 8).unwrap_or(0o100644);
                        fs.write_with_mode(&full_path, &blob, mode_num);
                    }
                    if let Ok(st) = fs.lstat(&full_path) {
                        index.insert(path, Some(&st), &entry.oid, 0);
                    }
                }
                Ok(())
            })?;
        }
    }

    if !no_update_head && !dry_run && filepaths.is_none() {
        let full_ref = GitRefManager::expand(fs, &gdir, r).unwrap_or_else(|_| r.to_string());
        if full_ref.starts_with("refs/heads") {
            GitRefManager::write_symbolic_ref(fs, &gdir, "HEAD", &full_ref)?;
        } else {
            GitRefManager::write_ref(fs, &gdir, "HEAD", &oid)?;
        }
    }

    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeReport {
    pub oid: Option<String>,
    pub already_merged: bool,
    pub fast_forward: bool,
    pub merge_commit: bool,
    pub tree: Option<String>,
}

#[allow(clippy::too_many_arguments)]
pub fn merge(
    fs: &MemoryFs,
    dir: Option<&str>,
    gitdir: &str,
    ours: Option<&str>,
    theirs: &str,
    fast_forward: bool,
    fast_forward_only: bool,
    dry_run: bool,
    no_update_branch: bool,
    abort_on_conflict: bool,
    message: Option<&str>,
    author: Option<Author>,
    committer: Option<Author>,
) -> Result<MergeReport, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    GitIndexManager::acquire(fs, &gdir, |index| {
        if !index.unmerged_paths().is_empty() {
            return Err(GitError::unmerged_paths(index.unmerged_paths()));
        }
        Ok(())
    })?;
    let our_ref = match ours {
        Some(o) => o.to_string(),
        None => crate::current_branch(fs, &gdir, false, false)?
            .ok_or_else(|| GitError::missing_parameter("ours"))?,
    };
    let our_full = GitRefManager::expand(fs, &gdir, &our_ref)?;
    let their_full = GitRefManager::expand(fs, &gdir, theirs)?;
    let our_oid = GitRefManager::resolve(fs, &gdir, &our_full, None)?;
    let their_oid = GitRefManager::resolve(fs, &gdir, &their_full, None)?;

    if our_oid == their_oid {
        return Ok(MergeReport {
            oid: Some(our_oid),
            already_merged: true,
            fast_forward: false,
            merge_commit: false,
            tree: None,
        });
    }

    let bases = find_merge_base(fs, &gdir, &[our_oid.clone(), their_oid.clone()])?;
    if bases.len() != 1 {
        if bases.is_empty() {
            // Treat empty tree as virtual ancestor
        } else {
            return Err(GitError::merge_not_supported());
        }
    }
    let base_oid = bases.first().cloned();

    if base_oid.as_deref() == Some(their_oid.as_str()) {
        return Ok(MergeReport {
            oid: Some(our_oid),
            already_merged: true,
            fast_forward: false,
            merge_commit: false,
            tree: None,
        });
    }

    if fast_forward && base_oid.as_deref() == Some(our_oid.as_str()) {
        if !dry_run && !no_update_branch {
            GitRefManager::write_ref(fs, &gdir, &our_full, &their_oid)?;
        }
        return Ok(MergeReport {
            oid: Some(their_oid),
            already_merged: false,
            fast_forward: true,
            merge_commit: false,
            tree: None,
        });
    }

    if fast_forward_only {
        return Err(GitError::fast_forward());
    }

    let our_name = our_full.trim_start_matches("refs/heads/");
    let their_name = their_full.trim_start_matches("refs/heads/").trim_start_matches("refs/remotes/");

    let (merged_tree_oid, conflict_paths) = merge_trees_3way(
        fs,
        dir,
        &gdir,
        &our_oid,
        base_oid.as_deref(),
        &their_oid,
        our_name,
        "base",
        their_name,
        abort_on_conflict,
        dry_run,
    )?;

    if !conflict_paths.is_empty() {
        if !abort_on_conflict && !dry_run {
            fs.write_str(&join(&[&gdir, "MERGE_HEAD"]), &format!("{their_oid}\n"));
            fs.write_str(&join(&[&gdir, "MERGE_MODE"]), "");
            let msg = message
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("Merge branch '{their_name}' into {our_name}\n"));
            fs.write_str(&join(&[&gdir, "MERGE_MSG"]), &msg);
        }
        return Err(GitError::merge_conflict(
            conflict_paths,
            Vec::new(),
            Vec::new(),
            Vec::new(),
        ));
    }

    let final_msg = message
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Merge branch '{their_name}' into {our_name}\n"));

    if no_update_branch {
        return Ok(MergeReport { oid: None, already_merged: false, fast_forward: false, merge_commit: false, tree: Some(merged_tree_oid) });
    }

    let merge_commit_oid = commit(
        fs,
        &gdir,
        Some(&final_msg),
        author,
        committer,
        false,
        dry_run,
        no_update_branch,
        false,
        Some(&our_full),
        Some(&[our_oid, their_oid]),
        Some(&merged_tree_oid),
    )?;

    Ok(MergeReport {
        oid: Some(merge_commit_oid),
        already_merged: false,
        fast_forward: false,
        merge_commit: true,
        tree: Some(merged_tree_oid),
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn merge_trees_3way(
    fs: &MemoryFs,
    dir: Option<&str>,
    gitdir: &str,
    our_commit_oid: &str,
    base_commit_oid: Option<&str>,
    their_commit_oid: &str,
    our_label: &str,
    base_label: &str,
    their_label: &str,
    abort_on_conflict: bool,
    dry_run: bool,
) -> Result<(String, Vec<String>), GitError> {
    let mut our_map = BTreeMap::new();
    collect_tree_map(fs, gitdir, our_commit_oid, "", &mut our_map)?;
    let mut their_map = BTreeMap::new();
    collect_tree_map(fs, gitdir, their_commit_oid, "", &mut their_map)?;
    let mut base_map = BTreeMap::new();
    if let Some(b_oid) = base_commit_oid {
        collect_tree_map(fs, gitdir, b_oid, "", &mut base_map)?;
    }

    let mut all_paths = BTreeSet::new();
    for k in our_map.keys().chain(their_map.keys()).chain(base_map.keys()) {
        all_paths.insert(k.clone());
    }

    let mut final_entries: Vec<(String, TreeEntry)> = Vec::new();
    let mut conflicts: Vec<String> = Vec::new();

    for path in all_paths {
        let o = our_map.get(&path);
        let b = base_map.get(&path);
        let t = their_map.get(&path);

        let o_oid = o.map(|e| e.oid.as_str());
        let b_oid = b.map(|e| e.oid.as_str());
        let t_oid = t.map(|e| e.oid.as_str());

        if o_oid == t_oid {
            if let Some(entry) = o {
                final_entries.push((path, entry.clone()));
            }
        } else if o_oid == b_oid {
            if let Some(entry) = t {
                final_entries.push((path, entry.clone()));
            }
        } else if t_oid == b_oid {
            if let Some(entry) = o {
                final_entries.push((path, entry.clone()));
            }
        } else {
            // Both modified or modify/delete conflict
            match (o, t) {
                (Some(o_ent), Some(t_ent)) => {
                    let o_bytes = read_blob(fs, gitdir, &o_ent.oid, None)?.blob;
                    let t_bytes = read_blob(fs, gitdir, &t_ent.oid, None)?.blob;
                    let b_bytes = if let Some(b_ent) = b {
                        read_blob(fs, gitdir, &b_ent.oid, None)?.blob
                    } else {
                        Vec::new()
                    };
                    if is_binary(&o_bytes) || is_binary(&t_bytes) || is_binary(&b_bytes) {
                        conflicts.push(path.clone());
                    } else {
                        let o_str = String::from_utf8_lossy(&o_bytes);
                        let b_str = String::from_utf8_lossy(&b_bytes);
                        let t_str = String::from_utf8_lossy(&t_bytes);
                        let merged = merge_file(
                            [base_label, our_label, their_label],
                            [b_str.as_ref(), o_str.as_ref(), t_str.as_ref()],
                        );
                        if merged.clean_merge {
                            let merged_oid = _write_object(
                                fs,
                                gitdir,
                                "blob",
                                merged.merged_text.as_bytes(),
                                "content",
                                None,
                                dry_run,
                            )?;
                            final_entries.push((
                                path.clone(),
                                TreeEntry {
                                    mode: o_ent.mode.clone(),
                                    path: path.clone(),
                                    oid: merged_oid,
                                    entry_type: "blob".to_string(),
                                },
                            ));
                        } else {
                            conflicts.push(path.clone());
                            if !abort_on_conflict && !dry_run {
                                if let Some(d) = dir {
                                    fs.write_str(&join(&[d, &path]), &merged.merged_text);
                                }
                                GitIndexManager::acquire(fs, gitdir, |index| {
                                    let dummy_stat = FileStat {
                                        kind: NodeKind::File,
                                        mode: 0o100644,
                                        size: 0,
                                        ino: 0,
                                        dev: 0,
                                        uid: 0,
                                        gid: 0,
                                        ctime_seconds: 0,
                                        ctime_nanoseconds: 0,
                                        mtime_seconds: 0,
                                        mtime_nanoseconds: 0,
                                    };
                                    if let Some(b_ent) = b {
                                        index.insert(&path, Some(&dummy_stat), &b_ent.oid, 1);
                                    }
                                    index.insert(&path, Some(&dummy_stat), &o_ent.oid, 2);
                                    index.insert(&path, Some(&dummy_stat), &t_ent.oid, 3);
                                    Ok(())
                                })?;
                            }
                        }
                    }
                }
                _ => {
                    conflicts.push(path.clone());
                }
            }
        }
    }

    if !conflicts.is_empty() {
        if !abort_on_conflict && !dry_run
            && let Some(d) = dir {
                GitIndexManager::acquire(fs, gitdir, |index| {
                    for (path, entry) in &final_entries {
                        if entry.entry_type == "blob" {
                            let full = join(&[d, path]);
                            let blob = read_blob(fs, gitdir, &entry.oid, None)?.blob;
                            let mode_num = u32::from_str_radix(&entry.mode, 8).unwrap_or(0o100644);
                            fs.write_with_mode(&full, &blob, mode_num);
                            let st = fs.lstat(&full).ok();
                            index.insert(path, st.as_ref(), &entry.oid, 0);
                        }
                    }
                    Ok(())
                })?;
            }
        return Ok((EMPTY_TREE_OID.to_string(), conflicts));
    }

    let merged_tree_oid = write_directory_tree_recursive(fs, gitdir, &final_entries, "", dry_run)?;
    if !dry_run
        && let Some(d) = dir {
            GitIndexManager::acquire(fs, gitdir, |index| {
                index.clear();
                let kept: std::collections::BTreeSet<_> = final_entries.iter().map(|(path, _)| path).collect();
                for path in our_map.keys() {
                    if !kept.contains(path) { let _ = fs.unlink(&join(&[d, path])); }
                }
                for (path, entry) in &final_entries {
                    let full = join(&[d, path]);
                    let blob = read_blob(fs, gitdir, &entry.oid, None)?.blob;
                    let mode_num = u32::from_str_radix(&entry.mode, 8).unwrap_or(0o100644);
                    fs.write_with_mode(&full, &blob, mode_num);
                    if let Ok(st) = fs.lstat(&full) {
                        index.insert(path, Some(&st), &entry.oid, 0);
                    }
                }
                Ok(())
            })?;
        }

    Ok((merged_tree_oid, Vec::new()))
}

pub fn fast_forward(
    fs: &MemoryFs,
    dir: &str,
    gitdir: Option<&str>,
    ref_name: Option<&str>,
    their_ref: &str,
    force: bool,
) -> Result<String, GitError> {
    let raw_gdir = gitdir
        .map(|s| s.to_string())
        .unwrap_or_else(|| join(&[dir, ".git"]));
    let gdir = discover_gitdir(fs, &raw_gdir);
    let our_branch = match ref_name {
        Some(r) => r.to_string(),
        None => crate::current_branch(fs, &gdir, false, false)?
            .ok_or_else(|| GitError::missing_parameter("ref"))?,
    };
    let our_full = GitRefManager::expand(fs, &gdir, &our_branch)?;
    let our_oid = GitRefManager::resolve(fs, &gdir, &our_full, None)?;
    let their_oid = GitRefManager::resolve(fs, &gdir, their_ref, None)?;
    if our_oid != their_oid && !is_descendent(fs, &gdir, &their_oid, &our_oid, None)? {
        return Err(GitError::fast_forward());
    }
    GitRefManager::write_ref(fs, &gdir, &our_full, &their_oid)?;
    checkout(
        fs,
        dir,
        Some(&gdir),
        Some(&our_branch),
        None,
        None,
        false,
        false,
        false,
        force,
        false,
    )?;
    Ok(their_oid)
}

pub fn abort_merge(
    fs: &MemoryFs,
    dir: &str,
    gitdir: Option<&str>,
    commit_ref: Option<&str>,
) -> Result<(), GitError> {
    let raw_gdir = gitdir
        .map(|s| s.to_string())
        .unwrap_or_else(|| join(&[dir, ".git"]));
    let gdir = discover_gitdir(fs, &raw_gdir);
    let target = commit_ref.unwrap_or("HEAD");

    let mut head_map = BTreeMap::new();
    if let Ok(head_oid) = GitRefManager::resolve(fs, &gdir, target, None) {
        let _ = collect_tree_map(fs, &gdir, &head_oid, "", &mut head_map);
    }

    let mut workdir_files = BTreeSet::new();
    let prefix = format!("{dir}/");
    for abs in fs.readdir_deep(dir) {
        if let Some(rel) = abs.strip_prefix(&prefix) {
            if rel == ".git" || rel.starts_with(".git/") {
                continue;
            }
            workdir_files.insert(rel.to_string());
        }
    }

    let (index_map, unmerged_paths) = GitIndexManager::acquire(fs, &gdir, |index| {
        let mut m = BTreeMap::new();
        for e in index.entries() {
            m.insert(e.path.clone(), e.oid.clone());
        }
        let u: BTreeSet<String> = index.unmerged_paths().into_iter().collect();
        Ok((m, u))
    })?;

    let mut all_paths = BTreeSet::new();
    for k in head_map
        .keys()
        .chain(workdir_files.iter())
        .chain(index_map.keys())
        .chain(unmerged_paths.iter())
    {
        all_paths.insert(k.clone());
    }

    let mut resets: Vec<(String, Option<TreeEntry>)> = Vec::new();
    for path in all_paths {
        let h_oid = head_map.get(&path).map(|e| e.oid.clone());
        let s_oid = index_map.get(&path).cloned();
        let w_oid = if workdir_files.contains(&path) {
            compute_workdir_oid(fs, dir, &gdir, &path).map(|(oid, _)| oid)
        } else {
            None
        };

        let staged = w_oid == s_oid;
        let unmerged = unmerged_paths.contains(&path);
        let unmodified = s_oid == h_oid;

        if staged || unmerged {
            resets.push((path.clone(), head_map.get(&path).cloned()));
        } else if unmodified {
            continue;
        } else {
            return Err(GitError::index_reset(&path));
        }
    }

    for f in ["MERGE_HEAD", "MERGE_MSG", "MERGE_MODE"] {
        let _ = fs.rm(&join(&[&gdir, f]));
    }

    GitIndexManager::acquire(fs, &gdir, |index| {
        for (path, head_entry) in resets {
            let full = join(&[dir, &path]);
            match head_entry {
                None => {
                    let _ = fs.rm(&full);
                    index.delete(&path);
                }
                Some(entry) => {
                    if entry.entry_type == "blob" {
                        let blob = read_blob(fs, &gdir, &entry.oid, None)?.blob;
                        let mode_num = u32::from_str_radix(&entry.mode, 8).unwrap_or(0o100644);
                        fs.write_with_mode(&full, &blob, mode_num);
                        let st = fs.lstat(&full).ok();
                        index.delete(&path);
                        index.insert(&path, st.as_ref(), &entry.oid, 0);
                    }
                }
            }
        }
        Ok(())
    })
}

#[allow(clippy::too_many_arguments)]
pub fn cherry_pick(
    fs: &MemoryFs,
    dir: Option<&str>,
    gitdir: &str,
    oid: &str,
    no_update_branch: bool,
    dry_run: bool,
    abort_on_conflict: bool,
    message: Option<&str>,
    author: Option<Author>,
    committer: Option<Author>,
) -> Result<String, GitError> {
    let gdir = discover_gitdir(fs, gitdir);
    let cp_commit = read_commit(fs, &gdir, oid)?;
    if cp_commit.commit.parent.is_empty() {
        return Err(GitError::cherry_pick_root_commit(oid));
    }
    if cp_commit.commit.parent.len() > 1 {
        return Err(GitError::cherry_pick_merge_commit(
            oid,
            cp_commit.commit.parent.len(),
        ));
    }
    let parent_oid = &cp_commit.commit.parent[0];
    let head_oid = GitRefManager::resolve(fs, &gdir, "HEAD", None)?;

    // No-commit picks apply to the current index, including earlier picks and staged changes.
    let our_tree = if no_update_branch {
        GitIndexManager::acquire(fs, &gdir, |index| {
            if !index.unmerged_paths().is_empty() {
                return Err(GitError::unmerged_paths(index.unmerged_paths()));
            }
            construct_index_tree(fs, &gdir, index, dry_run)
        })?
    } else {
        head_oid.clone()
    };

    let (merged_tree_oid, conflicts) = merge_trees_3way(
        fs,
        dir,
        &gdir,
        &our_tree,
        Some(parent_oid),
        oid,
        "HEAD",
        "parent",
        oid,
        abort_on_conflict,
        dry_run,
    )?;

    if !conflicts.is_empty() {
        return Err(GitError::merge_conflict(
            conflicts,
            Vec::new(),
            Vec::new(),
            Vec::new(),
        ));
    }

    let final_msg = message.unwrap_or(&cp_commit.commit.message);
    let final_author = author.or(Some(cp_commit.commit.author));
    commit(
        fs,
        &gdir,
        Some(final_msg),
        final_author,
        committer,
        false,
        dry_run,
        no_update_branch,
        false,
        None,
        Some(&[head_oid]),
        Some(&merged_tree_oid),
    )
}

pub fn stash(
    fs: &MemoryFs,
    dir: &str,
    gitdir: Option<&str>,
    op: Option<&str>,
    message: Option<&str>,
    ref_idx: usize,
) -> Result<Option<String>, GitError> {
    let raw_gdir = gitdir
        .map(|s| s.to_string())
        .unwrap_or_else(|| join(&[dir, ".git"]));
    let gdir = discover_gitdir(fs, &raw_gdir);
    let stash_mgr = GitStashManager::new(dir, Some(&gdir));
    let operation = op.unwrap_or("push");

    match operation {
        "push" | "create" => {
            let author = stash_mgr.get_author(fs)?;
            let branch = crate::current_branch(fs, &gdir, false, false)?
                .unwrap_or_else(|| "HEAD".to_string());
            let head_oid = GitRefManager::resolve(fs, &gdir, "HEAD", None)?;
            let head_commit = read_commit(fs, &gdir, &head_oid)?;

            let matrix = status_matrix(fs, dir, Some(&gdir), None, None)?;
            let has_changes = matrix.iter().any(|(_, h, w, s)| !(*h == 1 && *w == 1 && *s == 1));
            if !has_changes {
                return Err(GitError::not_found("changes, nothing to stash"));
            }

            let mut workdir_entries = Vec::new();
            for (path, _, w, _) in &matrix {
                if *w != 0
                    && let Some((_, st)) = compute_workdir_oid(fs, dir, &gdir, path) {
                        let bytes = fs.read(&join(&[dir, path])).unwrap_or_default();
                        let b_oid = write_blob(fs, &gdir, &bytes)?;
                        workdir_entries.push((
                            path.clone(),
                            TreeEntry {
                                mode: format!("{:06o}", st.mode),
                                path: path.clone(),
                                oid: b_oid,
                                entry_type: "blob".to_string(),
                            },
                        ));
                    }
            }
            let stash_tree = write_directory_tree_recursive(fs, &gdir, &workdir_entries, "", false)?;
            let msg_prefix = message.unwrap_or("").trim();
            let stash_msg = format!(
                "{}: {} {}",
                if msg_prefix.is_empty() {
                    format!("WIP on {branch}")
                } else {
                    msg_prefix.to_string()
                },
                &head_oid[0..7],
                head_commit.commit.message.lines().next().unwrap_or("")
            );
            let stash_commit_obj = CommitObject {
                message: format!("{stash_msg}\n"),
                tree: stash_tree,
                parent: vec![head_oid],
                author: author.clone(),
                committer: author,
                gpgsig: None,
            };
            let stash_commit_oid = write_commit(fs, &gdir, &stash_commit_obj)?;
            if operation == "push" {
                stash_mgr.write_stash_ref(fs, &stash_commit_oid)?;
                stash_mgr.write_stash_reflog_entry(fs, &stash_commit_oid, &stash_msg)?;
                checkout(
                    fs,
                    dir,
                    Some(&gdir),
                    Some(&branch),
                    None,
                    None,
                    false,
                    false,
                    false,
                    true,
                    false,
                )?;
            }
            Ok(Some(stash_commit_oid))
        }
        "list" => {
            let entries = stash_mgr.read_stash_reflogs(fs, true);
            Ok(Some(entries.join("\n")))
        }
        "apply" => {
            let entries = stash_mgr.read_stash_reflogs(fs, false);
            if ref_idx >= entries.len() {
                return Err(GitError::invalid_ref_name(&format!("stash@{{{ref_idx}}}"), "stash@{0}"));
            }
            let line = &entries[ref_idx];
            if let Some(sha) = line.split_whitespace().nth(1) {
                checkout(
                    fs,
                    dir,
                    Some(&gdir),
                    Some(sha),
                    None,
                    None,
                    false,
                    true,
                    false,
                    true,
                    false,
                )?;
            }
            Ok(None)
        }
        "drop" => {
            let mut entries = stash_mgr.read_stash_reflogs(fs, false);
            if ref_idx >= entries.len() {
                return Err(GitError::invalid_ref_name(&format!("stash@{{{ref_idx}}}"), "stash@{0}"));
            }
            entries.remove(ref_idx);
            let reflog_path = stash_mgr.ref_logs_stash_path();
            if entries.is_empty() {
                let _ = fs.rm(&reflog_path);
                let _ = fs.rm(&join(&[&gdir, "refs/stash"]));
            } else {
                let next_sha = entries[0].split_whitespace().nth(1).unwrap_or("").to_string();
                fs.write_str(&reflog_path, &format!("{}\n", entries.join("\n")));
                if !next_sha.is_empty() {
                    let _ = stash_mgr.write_stash_ref(fs, &next_sha);
                }
            }
            Ok(None)
        }
        "pop" => {
            stash(fs, dir, Some(&gdir), Some("apply"), None, ref_idx)?;
            stash(fs, dir, Some(&gdir), Some("drop"), None, ref_idx)?;
            Ok(None)
        }
        "clear" => {
            let _ = fs.rm(&stash_mgr.ref_logs_stash_path());
            let _ = fs.rm(&join(&[&gdir, "refs/stash"]));
            Ok(None)
        }
        other => Err(GitError::internal(&format!("Unknown stash op: {other}"))),
    }
}
