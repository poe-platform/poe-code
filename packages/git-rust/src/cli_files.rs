use crate::commands::plumbing::{read_blob, read_commit};
use crate::commands::worktree::{collect_tree_map, list_files, reset_index};
use crate::utils::join;
use crate::{GitError, GitIndexManager, GitRefManager, MemoryFs};
use std::collections::{BTreeMap, BTreeSet};

type Snapshot = BTreeMap<String, (String, Vec<u8>)>;

fn snapshot(fs: &MemoryFs, root: &str, gitdir: &str, source: &str) -> Result<Snapshot, GitError> {
    if source == ":index" {
        return GitIndexManager::acquire(fs, gitdir, |index| {
            index
                .entries()
                .into_iter()
                .map(|e| {
                    Ok((
                        e.path,
                        (
                            format!("{:06o}", e.mode),
                            read_blob(fs, gitdir, &e.oid, None)?.blob,
                        ),
                    ))
                })
                .collect()
        });
    }
    if source == ":worktree" {
        return list_files(fs, gitdir, None)?
            .into_iter()
            .filter_map(|p| {
                let full = join(&[root, &p]);
                let stat = fs.lstat(&full).ok()?;
                let bytes = if stat.is_symbolic_link() {
                    fs.readlink(&full).ok()?
                } else {
                    fs.read(&full)?
                };
                Some(Ok((p, (format!("{:06o}", stat.mode), bytes))))
            })
            .collect();
    }
    if source == ":empty" {
        return Ok(BTreeMap::new());
    }
    let oid = GitRefManager::resolve(fs, gitdir, source, None)
        .or_else(|_| crate::expand_oid(fs, gitdir, source))?;
    let mut tree = BTreeMap::new();
    collect_tree_map(fs, gitdir, &oid, "", &mut tree)?;
    tree.into_iter()
        .map(|(p, e)| Ok((p, (e.mode, read_blob(fs, gitdir, &e.oid, None)?.blob))))
        .collect()
}

pub fn diff(
    fs: &MemoryFs,
    root: &str,
    gitdir: &str,
    before: &str,
    after: &str,
    paths: &[String],
) -> Result<String, GitError> {
    let old = snapshot(fs, root, gitdir, before)?;
    let new = snapshot(fs, root, gitdir, after)?;
    let names: BTreeSet<_> = old.keys().chain(new.keys()).collect();
    let mut out = String::new();
    for p in names {
        if !paths.is_empty()
            && !paths
                .iter()
                .any(|f| f == "." || p == f || p.starts_with(&format!("{f}/")))
        {
            continue;
        }
        if old.get(p) == new.get(p) {
            continue;
        }
        let left = old.get(p).map(|(_, b)| b.as_slice()).unwrap_or_default();
        let right = new.get(p).map(|(_, b)| b.as_slice()).unwrap_or_default();
        out.push_str(&format!("diff --git a/{p} b/{p}\n"));
        match (old.get(p), new.get(p)) {
            (None, Some((mode, _))) => out.push_str(&format!("new file mode {mode}\n")),
            (Some((mode, _)), None) => out.push_str(&format!("deleted file mode {mode}\n")),
            (Some((a, _)), Some((b, _))) if a != b => {
                out.push_str(&format!("old mode {a}\nnew mode {b}\n"))
            }
            _ => {}
        }
        if left == right {
            continue;
        }
        if left.contains(&0) || right.contains(&0) {
            out.push_str(&format!("Binary files a/{p} and b/{p} differ\n"));
            continue;
        }
        let a = String::from_utf8_lossy(left);
        let b = String::from_utf8_lossy(right);
        out.push_str(&format!(
            "--- {}\n+++ {}\n",
            if old.contains_key(p) {
                format!("a/{p}")
            } else {
                "/dev/null".into()
            },
            if new.contains_key(p) {
                format!("b/{p}")
            } else {
                "/dev/null".into()
            }
        ));
        out.push_str(&patch(&a, &b));
    }
    Ok(out)
}

fn patch(a: &str, b: &str) -> String {
    let old: Vec<_> = a.split_inclusive('\n').collect();
    let new: Vec<_> = b.split_inclusive('\n').collect();
    let mut prefix = 0;
    while prefix < old.len().min(new.len()) && old[prefix] == new[prefix] {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < old.len().min(new.len()) - prefix
        && old[old.len() - 1 - suffix] == new[new.len() - 1 - suffix]
    {
        suffix += 1;
    }
    let start = prefix.saturating_sub(3);
    let old_end = (old.len() - suffix + 3).min(old.len());
    let new_end = (new.len() - suffix + 3).min(new.len());
    let range = |count: usize| {
        if count == 1 {
            (start + 1).to_string()
        } else {
            format!("{},{}", if count == 0 { start } else { start + 1 }, count)
        }
    };
    let mut out = format!(
        "@@ -{} +{} @@\n",
        range(old_end - start),
        range(new_end - start)
    );
    let mut line = |mark: char, text: &str| {
        out.push(mark);
        out.push_str(text);
        if !text.ends_with('\n') {
            out.push_str("\n\\ No newline at end of file\n");
        }
    };
    for text in &old[start..prefix] {
        line(' ', text);
    }
    for text in &old[prefix..old.len() - suffix] {
        line('-', text);
    }
    for text in &new[prefix..new.len() - suffix] {
        line('+', text);
    }
    for text in &old[old.len() - suffix..old_end] {
        line(' ', text);
    }
    out
}

pub fn show(fs: &MemoryFs, root: &str, gitdir: &str, target: &str) -> Result<String, GitError> {
    if let Some((rev, path)) = target.split_once(':') {
        let oid = GitRefManager::resolve(fs, gitdir, rev, None)?;
        return Ok(
            String::from_utf8_lossy(&read_blob(fs, gitdir, &oid, Some(path))?.blob).to_string(),
        );
    }
    let oid = GitRefManager::resolve(fs, gitdir, target, None)
        .or_else(|_| crate::expand_oid(fs, gitdir, target))?;
    let commit = read_commit(fs, gitdir, &oid)?.commit;
    let mut out = format!(
        "commit {oid}\nAuthor: {} <{}>\n\n    {}\n\n",
        commit.author.name,
        commit.author.email,
        commit.message.trim()
    );
    out.push_str(&diff(
        fs,
        root,
        gitdir,
        commit
            .parent
            .first()
            .map(String::as_str)
            .unwrap_or(":empty"),
        &oid,
        &[],
    )?);
    Ok(out)
}

pub fn restore(
    fs: &MemoryFs,
    root: &str,
    gitdir: &str,
    paths: &[String],
    source: &str,
    staged: bool,
    worktree: bool,
) -> Result<(), GitError> {
    let tree = snapshot(fs, root, gitdir, source)?;
    let tracked = list_files(fs, gitdir, None)?;
    let names: BTreeSet<_> = tree.keys().cloned().chain(tracked).collect();
    let selected: Vec<_> = names
        .into_iter()
        .filter(|p| {
            paths
                .iter()
                .any(|f| f == "." || p == f || p.starts_with(&format!("{f}/")))
        })
        .collect();
    if selected.is_empty() {
        return Err(GitError::not_found("pathspec"));
    }
    for p in selected {
        if staged {
            reset_index(fs, Some(root), gitdir, &p, Some(source))?;
        }
        if worktree {
            let full = join(&[root, &p]);
            match tree.get(&p) {
                Some((mode, bytes)) => {
                    crate::assert_no_symlink_in_leading_path(fs, root, &p)?;
                    if mode == "120000" {
                        fs.writelink(&full, bytes)
                            .map_err(|e| GitError::internal(&e.message))?;
                    } else {
                        fs.write_with_mode(
                            &full,
                            bytes,
                            u32::from_str_radix(mode, 8).unwrap_or(0o100644),
                        );
                    }
                }
                None => {
                    let _ = fs.unlink(&full);
                }
            }
        }
    }
    Ok(())
}
