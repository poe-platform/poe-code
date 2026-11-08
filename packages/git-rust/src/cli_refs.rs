use crate::{GitError, MemoryFs};
use std::cmp::Ordering;

fn version_cmp(a: &str, b: &str) -> Ordering {
    let (mut a, mut b) = (a.as_bytes(), b.as_bytes());
    while !a.is_empty() && !b.is_empty() {
        if a[0].is_ascii_digit() && b[0].is_ascii_digit() {
            let an = a.iter().take_while(|c| c.is_ascii_digit()).count();
            let bn = b.iter().take_while(|c| c.is_ascii_digit()).count();
            let av = a[..an]
                .iter()
                .skip_while(|c| **c == b'0')
                .copied()
                .collect::<Vec<_>>();
            let bv = b[..bn]
                .iter()
                .skip_while(|c| **c == b'0')
                .copied()
                .collect::<Vec<_>>();
            let cmp = av.len().cmp(&bv.len()).then_with(|| av.cmp(&bv));
            if cmp != Ordering::Equal {
                return cmp;
            }
            a = &a[an..];
            b = &b[bn..];
        } else {
            let cmp = a[0].cmp(&b[0]);
            if cmp != Ordering::Equal {
                return cmp;
            }
            a = &a[1..];
            b = &b[1..];
        }
    }
    a.len().cmp(&b.len())
}

pub(crate) fn sort_refs(
    fs: &MemoryFs,
    gitdir: &str,
    refs: &mut [String],
    keys: &[&str],
) -> Result<(), GitError> {
    // Last key is primary, as in Git. Precompute dates before sorting.
    let mut dates = std::collections::BTreeMap::new();
    for r in refs.iter().filter(|_| {
        keys.iter()
            .any(|key| matches!(key.trim_start_matches('-'), "committerdate" | "creatordate"))
    }) {
        let oid = crate::resolve_ref(fs, gitdir, r, None)?;
        let object = crate::_read_object(fs, gitdir, &oid, "content")?;
        let commit_date = if object.obj_type == "commit" {
            crate::models::GitCommit::from_bytes(&object.object)
                .parse()
                .committer
                .timestamp
        } else {
            0
        };
        let creator_date = crate::commands::plumbing::read_tag(fs, gitdir, &oid)
            .map(|t| t.tag.tagger.timestamp)
            .unwrap_or(commit_date);
        dates.insert(r.clone(), (commit_date, creator_date));
    }
    for key in keys {
        let field = key.strip_prefix('-').unwrap_or(key);
        if !matches!(
            field,
            "refname" | "committerdate" | "creatordate" | "version:refname" | "v:refname"
        ) {
            return Err(GitError::internal(&format!("unknown sort field: {field}")));
        }
    }
    refs.sort_by(|a, b| {
        for key in keys.iter().rev() {
            let field = key.strip_prefix('-').unwrap_or(key);
            let cmp = match field {
                "committerdate" => dates[a].0.cmp(&dates[b].0),
                "creatordate" => dates[a].1.cmp(&dates[b].1),
                "version:refname" | "v:refname" => version_cmp(a, b),
                _ => a.cmp(b),
            };
            let cmp = if key.starts_with('-') {
                cmp.reverse()
            } else {
                cmp
            };
            if cmp != Ordering::Equal {
                return cmp;
            }
        }
        a.cmp(b)
    });
    Ok(())
}
