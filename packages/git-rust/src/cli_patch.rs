use crate::{
    GitError, MemoryFs,
    commands::plumbing::{ReadCommitResult, log},
};
use std::collections::BTreeSet;

fn history(fs: &MemoryFs, gitdir: &str, rev: &str) -> Result<Vec<ReadCommitResult>, GitError> {
    let oid = crate::cli_history::resolve(fs, gitdir, if rev.is_empty() { "HEAD" } else { rev })?;
    log(fs, gitdir, Some(&oid), None, None, None, false, false)
}
fn range(
    fs: &MemoryFs,
    gitdir: &str,
    base: &str,
    tip: &str,
) -> Result<Vec<ReadCommitResult>, GitError> {
    let excluded: BTreeSet<_> = history(fs, gitdir, base)?
        .into_iter()
        .map(|c| c.oid)
        .collect();
    let mut list: Vec<_> = history(fs, gitdir, tip)?
        .into_iter()
        .filter(|c| !excluded.contains(&c.oid) && c.commit.parent.len() <= 1)
        .collect();
    list.reverse();
    Ok(list)
}
fn patch_id(
    fs: &MemoryFs,
    root: &str,
    gitdir: &str,
    c: &ReadCommitResult,
) -> Result<String, GitError> {
    let (patch, _) = crate::cli_files::diff(
        fs,
        root,
        gitdir,
        c.commit
            .parent
            .first()
            .map(String::as_str)
            .unwrap_or(":empty"),
        &c.oid,
        &[],
        &crate::cli_files::DiffOptions::default(),
    )?;
    let mut canonical = String::new();
    for line in patch.lines().filter(|l| !l.starts_with("@@")) {
        canonical.extend(line.chars().filter(|c| !c.is_whitespace()));
        canonical.push('\n');
    }
    // Binary diffs have no textual hunks: include the changed binary objects.
    if patch.contains("Binary files ") {
        let mut before = std::collections::BTreeMap::new();
        if let Some(p) = c.commit.parent.first() {
            let parent = crate::read_commit(fs, gitdir, p)?;
            crate::commands::worktree::collect_tree_map(
                fs,
                gitdir,
                &parent.commit.tree,
                "",
                &mut before,
            )?;
        }
        let mut after = std::collections::BTreeMap::new();
        crate::commands::worktree::collect_tree_map(fs, gitdir, &c.commit.tree, "", &mut after)?;
        for path in before.keys().chain(after.keys()).collect::<BTreeSet<_>>() {
            let a = before.get(path).map(|e| e.oid.as_str());
            let b = after.get(path).map(|e| e.oid.as_str());
            if a == b {
                continue;
            }
            for oid in [a, b].into_iter().flatten() {
                let obj = crate::_read_object(fs, gitdir, oid, "content")?;
                if obj.object.contains(&0) {
                    canonical.push_str(oid);
                }
            }
        }
    }
    Ok(crate::utils::shasum(canonical.as_bytes()))
}

pub(crate) fn compare(
    fs: &MemoryFs,
    root: &str,
    gitdir: &str,
    command: &str,
    args: &[&str],
) -> Result<String, GitError> {
    let pos: Vec<_> = args
        .iter()
        .copied()
        .filter(|s| !s.starts_with('-'))
        .collect();
    if command == "cherry" {
        let upstream = pos.first().copied().unwrap_or("HEAD~1");
        let head = pos.get(1).copied().unwrap_or("HEAD");
        let head_history = history(fs, gitdir, head)?;
        let head_ids: BTreeSet<_> = head_history.iter().map(|c| c.oid.clone()).collect();
        let up = history(fs, gitdir, upstream)?;
        let ids: BTreeSet<_> = up.iter().map(|c| c.oid.clone()).collect();
        let mut patches = BTreeSet::new();
        for c in up
            .iter()
            .filter(|c| !head_ids.contains(&c.oid) && c.commit.parent.len() <= 1)
        {
            patches.insert(patch_id(fs, root, gitdir, c)?);
        }
        let limit: BTreeSet<_> = if let Some(limit) = pos.get(2) {
            history(fs, gitdir, limit)?
                .into_iter()
                .map(|c| c.oid)
                .collect()
        } else {
            BTreeSet::new()
        };
        let mut list: Vec<_> = head_history
            .into_iter()
            .filter(|c| {
                !ids.contains(&c.oid) && !limit.contains(&c.oid) && c.commit.parent.len() <= 1
            })
            .collect();
        list.reverse();
        let mut out = String::new();
        for c in list {
            let sign = if patches.contains(&patch_id(fs, root, gitdir, &c)?) {
                '-'
            } else {
                '+'
            };
            let subject = if args.contains(&"-v") {
                format!(" {}", crate::cli_history::subject(&c.commit.message))
            } else {
                String::new()
            };
            out.push_str(&format!("{sign} {}{subject}\n", c.oid));
        }
        return Ok(out);
    }
    let (left, right) = match pos.as_slice() {
        [base, a, b] => (range(fs, gitdir, base, a)?, range(fs, gitdir, base, b)?),
        [symmetric] if symmetric.contains("...") => {
            let (a, b) = symmetric.split_once("...").unwrap();
            let ao = crate::cli_history::resolve(fs, gitdir, a)?;
            let bo = crate::cli_history::resolve(fs, gitdir, b)?;
            let base = crate::commands::plumbing::find_merge_base(fs, gitdir, &[ao, bo])?
                .into_iter()
                .next()
                .ok_or_else(|| GitError::internal("no merge base"))?;
            (range(fs, gitdir, &base, a)?, range(fs, gitdir, &base, b)?)
        }
        [a, b] => {
            let (ab, at) = a
                .split_once("..")
                .ok_or_else(|| GitError::internal("two commit ranges required"))?;
            let (bb, bt) = b
                .split_once("..")
                .ok_or_else(|| GitError::internal("two commit ranges required"))?;
            (range(fs, gitdir, ab, at)?, range(fs, gitdir, bb, bt)?)
        }
        _ => {
            return Err(GitError::internal(
                "range-diff requires two ranges, three revisions, or A...B",
            ));
        }
    };
    let lp: Vec<_> = left
        .iter()
        .map(|c| patch_id(fs, root, gitdir, c))
        .collect::<Result<_, _>>()?;
    let rp: Vec<_> = right
        .iter()
        .map(|c| patch_id(fs, root, gitdir, c))
        .collect::<Result<_, _>>()?;
    let mut matches = vec![None; left.len()];
    let mut used = BTreeSet::new();
    // Match patches before considering changed commits, so reordered commits stay paired.
    for (i, id) in lp.iter().enumerate() {
        if let Some(j) = rp
            .iter()
            .enumerate()
            .find_map(|(j, other)| (id == other && !used.contains(&j)).then_some(j))
        {
            matches[i] = Some(j);
            used.insert(j);
        }
    }
    for (i, c) in left.iter().enumerate() {
        if matches[i].is_none()
            && let Some(j) = right.iter().enumerate().find_map(|(j, r)| {
                (!used.contains(&j)
                    && crate::cli_history::subject(&c.commit.message)
                        == crate::cli_history::subject(&r.commit.message))
                .then_some(j)
            })
        {
            matches[i] = Some(j);
            used.insert(j);
        }
    }
    let mut out = String::new();
    for (i, c) in left.iter().enumerate() {
        if let Some(j) = matches[i] {
            let r = &right[j];
            let sign = if lp[i] == rp[j] { '=' } else { '!' };
            out.push_str(&format!(
                "{}:  {} {sign} {}:  {} {}\n",
                i + 1,
                &c.oid[..7],
                j + 1,
                &r.oid[..7],
                crate::cli_history::subject(&r.commit.message)
            ));
        } else {
            out.push_str(&format!(
                "{}:  {} < -:  ------- {}\n",
                i + 1,
                &c.oid[..7],
                crate::cli_history::subject(&c.commit.message)
            ));
        }
    }
    for (j, c) in right.iter().enumerate().filter(|(j, _)| !used.contains(j)) {
        out.push_str(&format!(
            "-:  ------- > {}:  {} {}\n",
            j + 1,
            &c.oid[..7],
            crate::cli_history::subject(&c.commit.message)
        ));
    }
    Ok(out)
}
