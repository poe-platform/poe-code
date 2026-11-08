use super::plumbing::{get_config, set_config};
use crate::{GitError, GitIndexManager, MemoryFs, utils::join};

fn included(path: &str, patterns: &[&str], cone: bool) -> bool {
    if cone {
        // Cone mode keeps files at the root and in ancestors of selected directories.
        let parent = path.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
        parent.is_empty()
            || patterns.iter().any(|d| {
                let d = d.trim_matches('/');
                path.starts_with(&format!("{d}/"))
                    || d == parent
                    || d.starts_with(&format!("{parent}/"))
            })
    } else {
        let mut keep = false;
        for pattern in patterns {
            let (positive, pattern) = if let Some(p) = pattern.strip_prefix('!') {
                (false, p)
            } else {
                (true, *pattern)
            };
            let pattern = pattern.trim_start_matches('/');
            if glob::Pattern::new(pattern).is_ok_and(|pattern| pattern.matches(path))
                || path.starts_with(&format!("{}/", pattern.trim_end_matches('/')))
            {
                keep = positive;
            }
        }
        keep
    }
}

pub fn execute(fs: &MemoryFs, root: &str, gitdir: &str, args: &[&str]) -> Result<String, GitError> {
    let pos: Vec<_> = args
        .iter()
        .copied()
        .filter(|s| !s.starts_with('-'))
        .collect();
    let action = pos.first().copied().unwrap_or("list");
    let file = join(&[gitdir, "info/sparse-checkout"]);
    if action == "list" {
        return Ok(fs.read_str(&file).unwrap_or_default());
    }
    if !matches!(action, "init" | "set" | "add" | "disable" | "reapply") {
        return Err(GitError::internal("unknown sparse-checkout subcommand"));
    }
    let cone = if args.contains(&"--no-cone") {
        false
    } else if args.contains(&"--cone") {
        true
    } else {
        get_config(fs, gitdir, "core.sparseCheckoutCone")
            .and_then(|v| v.as_bool())
            .unwrap_or(true)
    };
    let old = fs.read_str(&file).unwrap_or_default();
    let body = match action {
        "set" => pos
            .iter()
            .skip(1)
            .map(|p| format!("{p}\n"))
            .collect::<String>(),
        "add" => format!(
            "{old}{}",
            pos.iter()
                .skip(1)
                .map(|p| format!("{p}\n"))
                .collect::<String>()
        ),
        "init" | "reapply" => old,
        _ => String::new(),
    };
    let patterns: Vec<_> = body.lines().filter(|s| !s.is_empty()).collect();
    if cone
        && patterns.iter().any(|p| {
            p.split('/').any(|c| c == ".." || c == ".") || p.contains(['*', '?', '[', '!'])
        })
    {
        return Err(GitError::internal("invalid sparse-checkout directory"));
    }
    GitIndexManager::acquire(fs, gitdir, |index| {
        let entries = index.entries();
        // Validate all removals before making any changes. Preserve local edits and untracked files.
        for e in &entries {
            let full = join(&[root, &e.path]);
            crate::fs::assert_no_symlink_in_leading_path(fs, root, &e.path)?;
            if action != "disable"
                && !included(&e.path, &patterns, cone)
                && fs.exists(&full)
                && e.mode != 0o160000
            {
                let bytes = if e.mode == 0o120000 {
                    fs.readlink(&full).ok()
                } else {
                    fs.read(&full)
                };
                if bytes.is_none_or(|b| crate::hash_object("blob", &b) != e.oid) {
                    return Err(GitError::internal(&format!(
                        "cannot sparsify modified file: {}",
                        e.path
                    )));
                }
            }
        }
        let mut materialize = Vec::new();
        for e in &entries {
            if (action == "disable" || included(&e.path, &patterns, cone))
                && !fs.exists(&join(&[root, &e.path]))
                && e.mode != 0o160000
            {
                let blob = crate::_read_object(fs, gitdir, &e.oid, "content")?;
                materialize.push((e.clone(), blob.object));
            }
        }
        for (e, bytes) in materialize {
            let full = join(&[root, &e.path]);
            if e.mode == 0o120000 {
                fs.writelink(&full, &bytes)
                    .map_err(|e| GitError::internal(&e.message))?;
            } else {
                fs.write_with_mode(&full, &bytes, e.mode);
            }
        }
        for e in entries {
            let keep = action == "disable" || included(&e.path, &patterns, cone);
            if !keep && e.mode != 0o160000 {
                let _ = fs.rm(&join(&[root, &e.path]));
            }
            index.set_skip_worktree(&e.path, !keep);
        }
        Ok(())
    })?;
    set_config(
        fs,
        gitdir,
        "core.sparseCheckout",
        Some(if action == "disable" { "false" } else { "true" }),
        false,
    )?;
    set_config(
        fs,
        gitdir,
        "core.sparseCheckoutCone",
        Some(if cone { "true" } else { "false" }),
        false,
    )?;
    if action == "disable" {
        let _ = fs.rm(&file);
    } else {
        fs.write_str(&file, &body);
    }
    Ok(String::new())
}
