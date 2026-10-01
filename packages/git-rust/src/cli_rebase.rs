use crate::{
    GitError, MemoryFs,
    commands::worktree::{cherry_pick, commit, status_matrix},
    utils::join,
};

pub(crate) fn run(
    fs: &MemoryFs,
    root: &str,
    gitdir: &str,
    args: &[&str],
) -> Result<String, GitError> {
    let state = join(&[gitdir, "rebase-merge"]);
    let key = |name: &str| join(&[&state, name]);
    let active = fs.exists(&key("orig-head"));
    let abort = args.contains(&"--abort");
    let resume = args.contains(&"--continue");
    let skip = args.contains(&"--skip");
    if abort || resume || skip {
        if !active {
            return Err(GitError::internal("no rebase in progress"));
        }
        if abort {
            let original = fs.read_str(&key("orig-head")).unwrap_or_default();
            crate::cli::reset_repository(fs, root, gitdir, original.trim(), true, false)?;
            finish(fs, gitdir, &state)?;
            return Ok(String::new());
        }
        if skip {
            crate::cli::reset_repository(fs, root, gitdir, "HEAD", true, false)?;
        } else {
            let oid = fs
                .read_str(&key("current"))
                .ok_or_else(|| GitError::internal("no pending rebase commit"))?;
            let original = crate::read_commit(fs, gitdir, oid.trim())?.commit;
            let committer = crate::environment::configured_identity(fs, gitdir, "COMMITTER")?;
            let rewritten = commit(
                fs,
                gitdir,
                Some(&original.message),
                Some(original.author),
                Some(committer),
                false,
                false,
                false,
                false,
                None,
                None,
                None,
            )?;
            record(fs, &state, oid.trim(), &rewritten);
        }
        let _ = fs.unlink(&key("current"));
    } else {
        if active {
            return Err(GitError::internal("a rebase is already in progress"));
        }
        let mut onto = None;
        let mut positional = Vec::new();
        let mut i = 0;
        while i < args.len() {
            match args[i] {
                "--onto" => {
                    i += 1;
                    onto = Some(
                        *args
                            .get(i)
                            .ok_or_else(|| GitError::internal("--onto requires a revision"))?,
                    );
                }
                "--" => {
                    positional.extend_from_slice(&args[i + 1..]);
                    break;
                }
                value if value.starts_with('-') => {
                    return Err(GitError::internal(&format!(
                        "unsupported rebase option: {value}"
                    )));
                }
                value => positional.push(value),
            }
            i += 1;
        }
        if positional.len() > 2 {
            return Err(GitError::internal("too many rebase arguments"));
        }
        if status_matrix(fs, root, Some(gitdir), None, None)?
            .iter()
            .any(|(_, h, w, s)| *h != 0 && !(*h == 1 && *w == 1 && *s == 1) || *s != 0 && *h == 0)
        {
            return Err(GitError::internal("cannot rebase with uncommitted changes"));
        }
        let upstream = positional.first().copied().unwrap_or("@{upstream}");
        let upstream_oid = crate::cli_history::resolve_commit(fs, gitdir, upstream)?;
        let onto_oid = crate::cli_history::resolve_commit(fs, gitdir, onto.unwrap_or(upstream))?;
        let hook = crate::hooks::run_hook(fs, root, gitdir, "pre-rebase", &positional, None);
        if hook.ran && hook.exit_code != 0 {
            return Err(GitError::internal(&format!(
                "{}{}",
                hook.stdout, hook.stderr
            )));
        }
        if let Some(branch) = positional.get(1) {
            crate::commands::worktree::checkout(
                fs,
                root,
                Some(gitdir),
                Some(branch),
                None,
                None,
                false,
                false,
                false,
                true,
                false,
            )?;
        }
        let original = crate::resolve_ref(fs, gitdir, "HEAD", None)?;
        let branch = crate::current_branch(fs, gitdir, true, false)?.unwrap_or_default();
        let upstream_history = crate::commands::plumbing::log(
            fs,
            gitdir,
            Some(&upstream_oid),
            None,
            None,
            None,
            false,
            false,
        )?;
        let excluded: std::collections::HashSet<_> =
            upstream_history.into_iter().map(|c| c.oid).collect();
        let history = crate::commands::plumbing::log(
            fs,
            gitdir,
            Some(&original),
            None,
            None,
            None,
            false,
            false,
        )?;
        let mut todo: Vec<_> = history
            .into_iter()
            .filter(|c| !excluded.contains(&c.oid) && c.commit.parent.len() <= 1)
            .map(|c| c.oid)
            .collect();
        todo.reverse();
        fs.mkdir(&state)
            .map_err(|e| GitError::internal(&e.message))?;
        fs.write_str(&key("orig-head"), &original);
        fs.write_str(&key("head-name"), &branch);
        fs.write_str(&key("todo"), &todo.join("\n"));
        fs.write_str(&join(&[gitdir, "ORIG_HEAD"]), &format!("{original}\n"));
        // Keep the branch untouched until every commit has been replayed.
        fs.write_str(&join(&[gitdir, "HEAD"]), &format!("{original}\n"));
        crate::cli::reset_repository(fs, root, gitdir, &onto_oid, true, false)?;
    }
    let todo = fs.read_str(&key("todo")).unwrap_or_default();
    let commits: Vec<_> = todo.lines().filter(|line| !line.is_empty()).collect();
    for (i, oid) in commits.iter().enumerate() {
        fs.write_str(&key("current"), oid);
        fs.write_str(&key("todo"), &commits[i + 1..].join("\n"));
        let committer = crate::environment::configured_identity(fs, gitdir, "COMMITTER")?;
        let new_oid = cherry_pick(
            fs,
            Some(root),
            gitdir,
            oid,
            false,
            false,
            false,
            None,
            None,
            Some(committer),
        )?;
        record(fs, &state, oid, &new_oid);
        let _ = fs.unlink(&key("current"));
    }
    let rewritten = fs.read_str(&key("rewritten")).unwrap_or_default();
    if !rewritten.is_empty() {
        crate::hooks::run_hook(
            fs,
            root,
            gitdir,
            "post-rewrite",
            &["rebase"],
            Some(&rewritten),
        );
    }
    finish(fs, gitdir, &state)?;
    Ok("Successfully rebased.\n".into())
}
fn record(fs: &MemoryFs, state: &str, old: &str, new: &str) {
    let path = join(&[state, "rewritten"]);
    let previous = fs.read_str(&path).unwrap_or_default();
    fs.write_str(&path, &format!("{previous}{old} {new}\n"));
}
fn finish(fs: &MemoryFs, gitdir: &str, state: &str) -> Result<(), GitError> {
    let branch = fs
        .read_str(&join(&[state, "head-name"]))
        .unwrap_or_default();
    if !branch.trim().is_empty() {
        let oid = crate::resolve_ref(fs, gitdir, "HEAD", None)?;
        crate::write_ref(fs, gitdir, branch.trim(), &oid, true, false)?;
        fs.write_str(
            &join(&[gitdir, "HEAD"]),
            &format!("ref: {}\n", branch.trim()),
        );
    }
    for name in fs
        .readdir(state)
        .map_err(|e| GitError::internal(&e.message))?
    {
        fs.unlink(&join(&[state, &name]))
            .map_err(|e| GitError::internal(&e.message))?;
    }
    fs.rmdir(state)
        .map_err(|e| GitError::internal(&e.message))?;
    Ok(())
}
