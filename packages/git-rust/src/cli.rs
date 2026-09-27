use crate::commands::network::{clone, fetch, pull, push};
use crate::commands::plumbing::{
    add_remote, annotated_tag, branch, delete_branch, delete_remote, delete_tag, find_root,
    get_config, init, list_remotes, read_tree, rename_branch, set_config, tag, write_blob,
};
use crate::commands::worktree::{
    abort_merge, add, checkout, cherry_pick, commit, list_files, merge, remove, reset_index, stash,
    status_matrix,
};
use crate::fs::MemoryFs;
use crate::http::{HttpClient, MockHttpServer};
use crate::utils::{Author, join};
use crate::{
    current_branch, discover_gitdir, expand_oid, list_branches, list_tags, resolve_ref, version,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliResult {
    pub exit_code: i32,
    pub stdout: String,
    /// Exact output when stdout contains non-UTF-8 bytes.
    pub stdout_bytes: Option<Vec<u8>>,
    pub stderr: String,
}

impl CliResult {
    pub fn ok(stdout: impl Into<String>) -> Self {
        Self {
            exit_code: 0,
            stdout: stdout.into(),
            stdout_bytes: None,
            stderr: String::new(),
        }
    }

    pub fn ok_bytes(stdout: Vec<u8>) -> Self {
        match String::from_utf8(stdout) {
            Ok(stdout) => Self::ok(stdout),
            Err(error) => {
                let bytes = error.into_bytes();
                Self {
                    exit_code: 0,
                    stdout: String::from_utf8_lossy(&bytes).into_owned(),
                    stdout_bytes: Some(bytes),
                    stderr: String::new(),
                }
            }
        }
    }

    pub fn err(code: i32, stderr: impl Into<String>) -> Self {
        Self {
            exit_code: code,
            stdout: String::new(),
            stdout_bytes: None,
            stderr: stderr.into(),
        }
    }
}

pub fn execute_git_cli(fs: &MemoryFs, cwd: &str, args: &[&str]) -> CliResult {
    let default_server = MockHttpServer::new();
    execute_git_cli_with_http(fs, cwd, args, &default_server)
}

pub fn execute_git_cli_with_http(
    fs: &MemoryFs,
    cwd: &str,
    args: &[&str],
    http: &dyn HttpClient,
) -> CliResult {
    let mut filtered: Vec<&str> = Vec::new();
    let mut effective_cwd = cwd.to_string();
    let mut idx = 0;
    while idx < args.len() {
        if args[idx] == "-C" && idx + 1 < args.len() {
            effective_cwd = if args[idx + 1].starts_with('/') {
                args[idx + 1].to_string()
            } else {
                join(&[&effective_cwd, args[idx + 1]])
            };
            idx += 2;
            continue;
        }
        filtered.push(args[idx]);
        idx += 1;
    }

    let Some(&subcmd) = filtered.first() else {
        return CliResult::err(1, "usage: git <command> [<args>]\n");
    };
    let sub_args = &filtered[1..];
    let positionals: Vec<&str> = sub_args
        .iter()
        .copied()
        .filter(|a| !a.starts_with('-'))
        .collect();

    if subcmd == "--version" || subcmd == "version" {
        return CliResult::ok(format!("git version {}\n", version()));
    }

    if subcmd == "init" {
        let mut bare = false;
        let mut default_branch = "master";
        let mut target_dir = effective_cwd.clone();
        let mut i = 0;
        while i < sub_args.len() {
            match sub_args[i] {
                "--bare" => bare = true,
                "-b" | "--initial-branch" if i + 1 < sub_args.len() => {
                    default_branch = sub_args[i + 1];
                    i += 1;
                }
                arg if !arg.starts_with('-') => {
                    target_dir = if arg.starts_with('/') {
                        arg.to_string()
                    } else {
                        join(&[&effective_cwd, arg])
                    };
                }
                _ => {}
            }
            i += 1;
        }
        return match init(fs, Some(&target_dir), None, bare, Some(default_branch)) {
            Ok(()) => CliResult::ok(format!(
                "Initialized empty Git repository in {target_dir}/.git/\n"
            )),
            Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
        };
    }

    if subcmd == "clone" {
        let mut url = None;
        let mut dest = None;
        let mut branch_name = None;
        let mut i = 0;
        while i < sub_args.len() {
            match sub_args[i] {
                "-b" | "--branch" if i + 1 < sub_args.len() => {
                    branch_name = Some(sub_args[i + 1]);
                    i += 1;
                }
                arg if !arg.starts_with('-') => {
                    if url.is_none() {
                        url = Some(arg);
                    } else if dest.is_none() {
                        dest = Some(arg);
                    }
                }
                _ => {}
            }
            i += 1;
        }
        let Some(u) = url else {
            return CliResult::err(129, "fatal: You must specify a repository to clone.\n");
        };
        let target_dir = match dest {
            Some(d) if d.starts_with('/') => d.to_string(),
            Some(d) => join(&[&effective_cwd, d]),
            None => {
                let repo_base = u
                    .trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .unwrap_or("repo")
                    .trim_end_matches(".git");
                join(&[&effective_cwd, repo_base])
            }
        };
        return match clone(
            fs,
            http,
            &target_dir,
            None,
            u,
            None,
            branch_name,
            false,
            false,
            false,
            Some("origin"),
            None,
            None,
        ) {
            Ok(()) => CliResult::ok(format!("Cloning into '{target_dir}'...\n")),
            Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
        };
    }

    let repo_root = find_root(fs, &effective_cwd).unwrap_or_else(|_| effective_cwd.clone());
    let gitdir = discover_gitdir(fs, &join(&[&repo_root, ".git"]));

    match subcmd {
        "status" => {
            let mut short = false;
            let mut branch = false;
            let mut untracked = true;
            let mut paths = Vec::new();
            let mut separator = false;
            for &arg in sub_args {
                if separator {
                    paths.push(repository_path(&repo_root, &effective_cwd, arg));
                } else {
                    match arg {
                        "--" => separator = true,
                        "--short" | "--porcelain" | "--porcelain=v1" => short = true,
                        "--branch" => branch = true,
                        "-uno" | "--untracked-files=no" => untracked = false,
                        "-u"
                        | "-uall"
                        | "-unormal"
                        | "--untracked-files"
                        | "--untracked-files=all"
                        | "--untracked-files=normal" => untracked = true,
                        a if a.starts_with('-')
                            && !a.starts_with("--")
                            && a[1..].chars().all(|c| c == 's' || c == 'b') =>
                        {
                            short |= a.contains('s');
                            branch |= a.contains('b');
                        }
                        a if a.starts_with('-') => {
                            return CliResult::err(129, format!("error: unknown option '{a}'\n"));
                        }
                        _ => paths.push(repository_path(&repo_root, &effective_cwd, arg)),
                    }
                }
            }
            match status_matrix(
                fs,
                &repo_root,
                Some(&gitdir),
                None,
                if paths.is_empty() { None } else { Some(&paths) },
            ) {
                Ok(rows) => {
                    let rows: Vec<_> = rows
                        .into_iter()
                        .filter(|(_, h, _, s)| untracked || *h != 0 || *s != 0)
                        .collect();
                    if short {
                        let mut out = String::new();
                        if branch {
                            let name = current_branch(fs, &gitdir, false, false).ok().flatten();
                            let label = match name {
                                Some(name) if resolve_ref(fs, &gitdir, "HEAD", None).is_err() => {
                                    format!("No commits yet on {name}")
                                }
                                Some(name) => name,
                                None => "HEAD (no branch)".to_string(),
                            };
                            out.push_str(&format!("## {label}\n"));
                        }
                        for (path, head, workdir, stage) in rows {
                            if head == 1 && workdir == 1 && stage == 1 {
                                continue;
                            }
                            let idx_char = match (head, stage) {
                                (0, 2 | 3) => 'A',
                                (1, 0) => 'D',
                                (1, 2 | 3) => 'M',
                                (0, 0) => '?',
                                _ => ' ',
                            };
                            let wt_char = match (stage, workdir) {
                                (0, 2) => '?',
                                (_, 0) => 'D',
                                (s, w) if s != w => 'M',
                                _ => ' ',
                            };
                            out.push_str(&format!("{idx_char}{wt_char} {path}\n"));
                        }
                        CliResult::ok(out)
                    } else {
                        let branch_str = current_branch(fs, &gitdir, false, false)
                            .ok()
                            .flatten()
                            .unwrap_or_else(|| "HEAD detached".to_string());
                        let mut out = format!("On branch {branch_str}\n");
                        let dirty: Vec<_> = rows
                            .into_iter()
                            .filter(|(_, h, w, s)| !(*h == 1 && *w == 1 && *s == 1))
                            .collect();
                        if dirty.is_empty() {
                            out.push_str("nothing to commit, working tree clean\n");
                        } else {
                            for (p, _, _, _) in dirty {
                                out.push_str(&format!("\t{p}\n"));
                            }
                        }
                        CliResult::ok(out)
                    }
                }
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "add" => {
            let mut paths = Vec::new();
            for &a in sub_args {
                if !a.starts_with('-') {
                    paths.push(repository_path(&repo_root, &effective_cwd, a));
                } else if a == "-A" || a == "--all" {
                    paths.push(".".to_string());
                }
            }
            if paths.is_empty() && (sub_args.contains(&"-u") || sub_args.contains(&"--update")) {
                paths.push(".".to_string());
            }
            if paths.is_empty() {
                return CliResult::ok("");
            }
            let force = sub_args.contains(&"-f") || sub_args.contains(&"--force");
            if sub_args.contains(&"-u") || sub_args.contains(&"--update") {
                let tracked = list_files(fs, &gitdir, None).unwrap_or_default();
                paths = tracked
                    .into_iter()
                    .filter(|p| {
                        paths
                            .iter()
                            .any(|f| f == "." || p == f || p.starts_with(&format!("{f}/")))
                    })
                    .collect();
            }
            let tracked = list_files(fs, &gitdir, None).unwrap_or_default();
            for path in &tracked {
                if paths
                    .iter()
                    .any(|f| f == "." || path == f || path.starts_with(&format!("{f}/")))
                    && !fs.exists(&join(&[&repo_root, path]))
                    && let Err(e) = remove(fs, &gitdir, path)
                {
                    return CliResult::err(128, format!("fatal: {}\n", e.message));
                }
            }
            for path in &paths {
                if !fs.exists(&join(&[&repo_root, path])) && !tracked.contains(path) {
                    return CliResult::err(
                        128,
                        format!("fatal: pathspec '{path}' did not match any files\n"),
                    );
                }
            }
            paths.retain(|p| fs.exists(&join(&[&repo_root, p])));
            match add(fs, &repo_root, Some(&gitdir), &paths, force) {
                Ok(()) => CliResult::ok(""),
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "rm" => {
            let files = list_files(fs, &gitdir, None).unwrap_or_default();
            let mut selected = Vec::new();
            for &arg in &positionals {
                let path = repository_path(&repo_root, &effective_cwd, arg);
                let matches: Vec<_> = files
                    .iter()
                    .filter(|p| **p == path || p.starts_with(&format!("{path}/")))
                    .cloned()
                    .collect();
                if matches.is_empty() {
                    return CliResult::err(
                        128,
                        format!("fatal: pathspec '{arg}' did not match any files\n"),
                    );
                }
                if matches.iter().any(|p| p != &path) && !sub_args.contains(&"-r") {
                    return CliResult::err(
                        128,
                        format!("fatal: not removing '{arg}' recursively without -r\n"),
                    );
                }
                selected.extend(matches);
            }
            for path in selected {
                if let Err(e) = remove(fs, &gitdir, &path) {
                    return CliResult::err(128, format!("fatal: {}\n", e.message));
                }
                if !sub_args.contains(&"--cached") {
                    let _ = fs.unlink(&join(&[&repo_root, &path]));
                }
            }
            CliResult::ok("")
        }
        "reset" => {
            let separator = sub_args.iter().position(|a| *a == "--");
            let target = positionals.first().copied().filter(|a| {
                resolve_ref(fs, &gitdir, a, None)
                    .or_else(|_| expand_oid(fs, &gitdir, a))
                    .is_ok()
            });
            if target.is_none()
                && !positionals.is_empty()
                && separator.is_none()
                && sub_args
                    .iter()
                    .any(|a| matches!(*a, "--hard" | "--soft" | "--mixed"))
            {
                return CliResult::err(
                    128,
                    format!("fatal: invalid revision '{}'\n", positionals[0]),
                );
            }
            let paths: Vec<String> = if let Some(i) = separator {
                sub_args[i + 1..]
                    .iter()
                    .map(|p| repository_path(&repo_root, &effective_cwd, p))
                    .collect()
            } else {
                positionals
                    .iter()
                    .skip(usize::from(target.is_some()))
                    .map(|p| repository_path(&repo_root, &effective_cwd, p))
                    .collect()
            };
            let result = if !paths.is_empty() {
                let files: std::collections::BTreeSet<_> = list_files(fs, &gitdir, None)
                    .unwrap_or_default()
                    .into_iter()
                    .chain(
                        list_files(fs, &gitdir, Some(target.unwrap_or("HEAD"))).unwrap_or_default(),
                    )
                    .collect();
                files
                    .into_iter()
                    .filter(|p| {
                        paths
                            .iter()
                            .any(|f| f == "." || p == f || p.starts_with(&format!("{f}/")))
                    })
                    .try_for_each(|p| reset_index(fs, Some(&repo_root), &gitdir, &p, target))
            } else {
                reset_repository(
                    fs,
                    &repo_root,
                    &gitdir,
                    target.unwrap_or("HEAD"),
                    sub_args.contains(&"--hard"),
                    sub_args.contains(&"--soft"),
                )
            };
            match result {
                Ok(()) => CliResult::ok(""),
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "commit" => {
            let mut msg = None;
            let mut amend = false;
            let mut i = 0;
            while i < sub_args.len() {
                match sub_args[i] {
                    "-m" | "--message" if i + 1 < sub_args.len() => {
                        msg = Some(sub_args[i + 1]);
                        i += 1;
                    }
                    "--amend" => amend = true,
                    _ => {}
                }
                i += 1;
            }
            let author = Author {
                name: get_config(fs, &gitdir, "user.name")
                    .map(|v| v.as_str().to_string())
                    .unwrap_or_else(|| "Git User".to_string()),
                email: get_config(fs, &gitdir, "user.email")
                    .map(|v| v.as_str().to_string())
                    .unwrap_or_else(|| "user@example.com".to_string()),
                timestamp: 1502484200,
                timezone_offset: 0.0,
            };
            match commit(
                fs,
                &gitdir,
                msg,
                Some(author),
                None,
                amend,
                false,
                false,
                false,
                None,
                None,
                None,
            ) {
                Ok(oid) => CliResult::ok(format!("[{}] {}\n", &oid[..7], msg.unwrap_or(""))),
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "log" => crate::cli_history::execute(fs, &repo_root, &gitdir, &effective_cwd, sub_args),
        "branch" => {
            let mut remote = false;
            let mut all = false;
            let mut rename = false;
            let mut force = false;
            let mut delete = false;
            let mut show_current = false;
            let mut names = Vec::new();
            for &arg in sub_args {
                match arg {
                    "--show-current" => show_current = true,
                    "-a" | "--all" => all = true,
                    "-r" | "--remotes" => remote = true,
                    "-m" | "--move" => rename = true,
                    "-M" => {
                        rename = true;
                        force = true;
                    }
                    "-d" | "--delete" => delete = true,
                    "-D" => {
                        delete = true;
                        force = true;
                    }
                    "-f" | "--force" => force = true,
                    arg if !arg.starts_with('-') => names.push(arg),
                    _ => return CliResult::err(129, format!("error: unknown option '{arg}'\n")),
                }
            }
            let curr = current_branch(fs, &gitdir, false, false).ok().flatten();
            if show_current {
                return CliResult::ok(curr.map(|b| format!("{b}\n")).unwrap_or_default());
            }
            if rename {
                let (old, new) = match names.as_slice() {
                    [new] if curr.is_some() => (curr.as_deref().unwrap(), *new),
                    [old, new] => (*old, *new),
                    _ => return CliResult::err(129, "usage: git branch -m [<old>] <new>\n"),
                };
                // Validate both names and source before a forced replacement changes refs.
                if !crate::utils::is_valid_ref(old, true) || !crate::utils::is_valid_ref(new, true)
                {
                    return CliResult::err(128, "fatal: invalid branch name\n");
                }
                if old == new {
                    return CliResult::ok("");
                }
                let old_ref = format!("refs/heads/{old}");
                let new_ref = format!("refs/heads/{new}");
                if let Err(e) = resolve_ref(fs, &gitdir, &old_ref, None) {
                    if curr.as_deref() == Some(old)
                        && !crate::GitRefManager::exists(fs, &gitdir, &old_ref)
                        && !crate::GitRefManager::exists(fs, &gitdir, &new_ref)
                    {
                        return match crate::GitRefManager::write_symbolic_ref(
                            fs, &gitdir, "HEAD", &new_ref,
                        ) {
                            Ok(()) => CliResult::ok(""),
                            Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                        };
                    }
                    return CliResult::err(128, format!("fatal: {}\n", e.message));
                }
                if force
                    && crate::GitRefManager::exists(fs, &gitdir, &new_ref)
                    && let Err(e) = crate::GitRefManager::delete_ref(fs, &gitdir, &new_ref)
                {
                    return CliResult::err(128, format!("fatal: {}\n", e.message));
                }
                return match rename_branch(fs, &gitdir, old, new, false) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                };
            }
            if delete {
                if names.is_empty() {
                    return CliResult::err(129, "fatal: branch name required\n");
                }
                let mut out = String::new();
                for name in names {
                    if let Err(e) = delete_branch(fs, &gitdir, name) {
                        return CliResult::err(128, format!("fatal: {}\n", e.message));
                    }
                    out.push_str(&format!("Deleted branch {name}.\n"));
                }
                return CliResult::ok(out);
            }
            if names.is_empty() || all || remote {
                let mut out = String::new();
                if !remote || all {
                    for b in list_branches(fs, &gitdir, None) {
                        out.push_str(&format!(
                            "{} {b}\n",
                            if Some(&b) == curr.as_ref() { "*" } else { " " }
                        ));
                    }
                }
                if remote || all {
                    for b in crate::GitRefManager::list_refs(fs, &gitdir, "refs/remotes") {
                        out.push_str(&format!("  {}{b}\n", if all { "remotes/" } else { "" }));
                    }
                }
                CliResult::ok(out)
            } else if names.len() <= 2 {
                match branch(fs, &gitdir, names[0], names.get(1).copied(), false, force) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            } else {
                CliResult::err(129, "usage: git branch <name> [<start-point>]\n")
            }
        }
        "diff" | "show" | "restore" | "clean" | "mv" => {
            let result = match subcmd {
                "diff" => {
                    let cached = sub_args.contains(&"--cached") || sub_args.contains(&"--staged");
                    let mut options = crate::cli_files::DiffOptions::default();
                    let sep = sub_args.iter().position(|a| *a == "--");
                    let mut revisions: Vec<String> = Vec::new();
                    let mut paths = Vec::new();
                    let args = &sub_args[..sep.unwrap_or(sub_args.len())];
                    let mut i = 0;
                    while i < args.len() {
                        let arg = args[i];
                        i += 1;
                        match arg {
                            "--cached" | "--staged" | "--no-color" | "--no-ext-diff" => continue,
                            "--name-only" => {
                                options.mode = crate::cli_files::DiffMode::Names;
                                continue;
                            }
                            "--name-status" => {
                                options.mode = crate::cli_files::DiffMode::Status;
                                continue;
                            }
                            "--stat" => {
                                options.mode = crate::cli_files::DiffMode::Stat;
                                continue;
                            }
                            "-q" | "--quiet" => {
                                options.quiet = true;
                                continue;
                            }
                            "--exit-code" => {
                                options.exit_code = true;
                                continue;
                            }
                            _ => {}
                        }
                        if let Some(value) = arg
                            .strip_prefix("--unified=")
                            .or_else(|| arg.strip_prefix("-U"))
                        {
                            let value = if value.is_empty() {
                                let v = args.get(i).copied().unwrap_or("");
                                i += 1;
                                v
                            } else {
                                value
                            };
                            let Ok(context) = value.parse() else {
                                return CliResult::err(129, "error: invalid context count\n");
                            };
                            options.context = context;
                            continue;
                        }
                        if arg == "--unified" {
                            let Some(value) = args.get(i).and_then(|v| v.parse().ok()) else {
                                return CliResult::err(129, "error: invalid context count\n");
                            };
                            i += 1;
                            options.context = value;
                            continue;
                        }
                        if arg.starts_with('-') {
                            return CliResult::err(129, format!("error: unknown option '{arg}'\n"));
                        }
                        if paths.is_empty()
                            && let Some((left, right)) =
                                arg.split_once("...").or_else(|| arg.split_once(".."))
                        {
                            if !revisions.is_empty() {
                                return CliResult::err(
                                    129,
                                    "error: range cannot be combined with revisions\n",
                                );
                            }
                            let left = if left.is_empty() { "HEAD" } else { left };
                            let right = if right.is_empty() { "HEAD" } else { right };
                            let range = (|| {
                                let a = crate::cli_history::resolve(fs, &gitdir, left)?;
                                let b = crate::cli_history::resolve(fs, &gitdir, right)?;
                                let a = if arg.contains("...") {
                                    crate::commands::plumbing::find_merge_base(
                                        fs,
                                        &gitdir,
                                        &[a, b.clone()],
                                    )?
                                    .into_iter()
                                    .next()
                                    .ok_or_else(|| crate::GitError::internal("no merge base"))?
                                } else {
                                    a
                                };
                                Ok::<_, crate::GitError>((a, b))
                            })();
                            match range {
                                Ok((a, b)) => {
                                    revisions.push(a);
                                    revisions.push(b);
                                }
                                Err(e) => {
                                    return CliResult::err(128, format!("fatal: {}\n", e.message));
                                }
                            }
                            continue;
                        }
                        let path = repository_path(&repo_root, &effective_cwd, arg);
                        if paths.is_empty() && crate::cli_history::resolve(fs, &gitdir, arg).is_ok()
                        {
                            revisions.push(arg.to_string());
                        } else if sep.is_none()
                            && (fs.exists(&absolute_path(&effective_cwd, arg))
                                || list_files(fs, &gitdir, None)
                                    .unwrap_or_default()
                                    .contains(&path))
                        {
                            paths.push(path);
                        } else {
                            return CliResult::err(
                                128,
                                format!(
                                    "fatal: ambiguous argument '{arg}': unknown revision or path\n"
                                ),
                            );
                        }
                    }
                    if revisions.len() > 2 {
                        return CliResult::err(
                            129,
                            "usage: git diff [<rev> [<rev>]] [--] [<path>...]\n",
                        );
                    }
                    if let Some(i) = sep {
                        paths.extend(
                            sub_args[i + 1..]
                                .iter()
                                .map(|p| repository_path(&repo_root, &effective_cwd, p)),
                        );
                    }
                    let revision = revisions.first().map(String::as_str);
                    let before = match revision {
                        Some(revision) => revision,
                        None if !cached => ":index",
                        None if current_branch(fs, &gitdir, false, false)
                            .ok()
                            .flatten()
                            .is_some()
                            && resolve_ref(fs, &gitdir, "HEAD", None).is_err() =>
                        {
                            ":empty"
                        }
                        None => "HEAD",
                    };
                    return match crate::cli_files::diff(
                        fs,
                        &repo_root,
                        &gitdir,
                        before,
                        revisions.get(1).map(String::as_str).unwrap_or(if cached {
                            ":index"
                        } else {
                            ":worktree"
                        }),
                        &paths,
                        &options,
                    ) {
                        Ok((out, changed)) => {
                            let mut result = CliResult::ok(out);
                            if changed && (options.quiet || options.exit_code) {
                                result.exit_code = 1;
                            }
                            result
                        }
                        Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                    };
                }
                "show" => crate::cli_files::show(
                    fs,
                    &repo_root,
                    &gitdir,
                    positionals.first().copied().unwrap_or("HEAD"),
                ),
                "restore" => {
                    let source = sub_args
                        .windows(2)
                        .find(|w| w[0] == "--source" || w[0] == "-s")
                        .map(|w| w[1]);
                    let staged = sub_args.contains(&"--staged") || sub_args.contains(&"-S");
                    let paths: Vec<_> = positionals
                        .iter()
                        .filter(|p| Some(**p) != source)
                        .map(|p| repository_path(&repo_root, &effective_cwd, p))
                        .collect();
                    crate::cli_files::restore(
                        fs,
                        &repo_root,
                        &gitdir,
                        &paths,
                        source.unwrap_or(if staged { "HEAD" } else { ":index" }),
                        staged,
                        !staged || sub_args.contains(&"--worktree") || sub_args.contains(&"-W"),
                    )
                    .map(|_| String::new())
                }
                "mv" => {
                    if positionals.len() != 2 {
                        return CliResult::err(129, "usage: git mv <source> <destination>\n");
                    }
                    let src = repository_path(&repo_root, &effective_cwd, positionals[0]);
                    let mut dst = repository_path(&repo_root, &effective_cwd, positionals[1]);
                    if fs
                        .stat(&join(&[&repo_root, &dst]))
                        .is_ok_and(|s| s.is_directory())
                    {
                        dst = join(&[&dst, src.rsplit('/').next().unwrap_or(&src)]);
                    }
                    let full_src = join(&[&repo_root, &src]);
                    let full_dst = join(&[&repo_root, &dst]);
                    if fs.exists(&full_dst) && !sub_args.contains(&"-f") {
                        return CliResult::err(128, "fatal: destination exists\n");
                    }
                    let files = list_files(fs, &gitdir, None).unwrap_or_default();
                    if !files
                        .iter()
                        .any(|p| p == &src || p.starts_with(&format!("{src}/")))
                    {
                        return CliResult::err(128, "fatal: source is not tracked\n");
                    }
                    fs.cp_recursive(&full_src, &full_dst)
                        .map_err(|e| crate::GitError::internal(&e.message))
                        .and_then(|_| {
                            fs.rm(&full_src)
                                .map_err(|e| crate::GitError::internal(&e.message))?;
                            crate::GitIndexManager::acquire(fs, &gitdir, |index| {
                                let moved: Vec<_> = index
                                    .entries()
                                    .into_iter()
                                    .filter(|e| {
                                        e.path == src || e.path.starts_with(&format!("{src}/"))
                                    })
                                    .collect();
                                for entry in moved {
                                    let path = format!("{}{}", dst, &entry.path[src.len()..]);
                                    let mut stat = fs
                                        .lstat(&join(&[&repo_root, &path]))
                                        .map_err(|e| crate::GitError::internal(&e.message))?;
                                    stat.mode = entry.mode;
                                    index.delete(&entry.path);
                                    index.insert(&path, Some(&stat), &entry.oid, 0);
                                }
                                Ok(())
                            })
                        })
                        .map(|_| String::new())
                }
                _ => {
                    let paths: Vec<_> = positionals
                        .iter()
                        .map(|p| repository_path(&repo_root, &effective_cwd, p))
                        .collect();
                    crate::cli_files::clean(
                        fs,
                        &repo_root,
                        &gitdir,
                        &effective_cwd,
                        sub_args,
                        &paths,
                    )
                }
            };
            match result {
                Ok(out) => CliResult::ok(out),
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "checkout" | "switch" => {
            if subcmd == "checkout"
                && let Some(i) = sub_args.iter().position(|a| *a == "--")
            {
                let paths: Vec<_> = sub_args[i + 1..]
                    .iter()
                    .map(|p| repository_path(&repo_root, &effective_cwd, p))
                    .collect();
                let source = sub_args[..i].iter().find(|p| !p.starts_with('-')).copied();
                return match crate::cli_files::restore(
                    fs,
                    &repo_root,
                    &gitdir,
                    &paths,
                    source.unwrap_or(":index"),
                    source.is_some(),
                    true,
                ) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                };
            }
            let mut create_new = false;
            let mut force = false;
            let mut target = None;
            let mut i = 0;
            while i < sub_args.len() {
                match sub_args[i] {
                    "-b" | "-c" => create_new = true,
                    "-f" | "--force" => force = true,
                    arg if !arg.starts_with('-') && target.is_none() => {
                        target = Some(arg);
                    }
                    _ => {}
                }
                i += 1;
            }
            let Some(ref_target) = target else {
                return CliResult::err(128, "fatal: missing branch or commit argument\n");
            };
            if create_new && let Err(e) = branch(fs, &gitdir, ref_target, None, true, false) {
                return CliResult::err(128, format!("fatal: {}\n", e.message));
            }
            match checkout(
                fs,
                &repo_root,
                Some(&gitdir),
                Some(ref_target),
                None,
                None,
                false,
                false,
                false,
                force,
                true,
            ) {
                Ok(()) => CliResult::ok(format!("Switched to branch '{ref_target}'\n")),
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "tag" => {
            if sub_args.is_empty() {
                let tags = list_tags(fs, &gitdir);
                let mut out = String::new();
                for t in tags {
                    out.push_str(&format!("{t}\n"));
                }
                CliResult::ok(out)
            } else if sub_args[0] == "-d" && sub_args.len() > 1 {
                match delete_tag(fs, &gitdir, sub_args[1]) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            } else if sub_args[0] == "-a" && sub_args.len() > 1 {
                let name = sub_args[1];
                let msg = sub_args
                    .windows(2)
                    .find(|w| w[0] == "-m")
                    .map(|w| w[1])
                    .unwrap_or(name);
                let tagger = Author {
                    name: "Git User".to_string(),
                    email: "user@example.com".to_string(),
                    timestamp: 1502484200,
                    timezone_offset: 0.0,
                };
                match annotated_tag(
                    fs,
                    &gitdir,
                    name,
                    Some(msg),
                    None,
                    Some(tagger),
                    None,
                    false,
                ) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            } else {
                match tag(fs, &gitdir, sub_args[0], sub_args.get(1).copied(), false) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            }
        }
        "merge" => {
            if sub_args.contains(&"--abort") {
                return match abort_merge(fs, &repo_root, Some(&gitdir), None) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                };
            }
            let Some(&theirs) = sub_args.iter().find(|a| !a.starts_with('-')) else {
                return CliResult::err(128, "fatal: No commit specified\n");
            };
            let author = Author {
                name: "Git User".to_string(),
                email: "user@example.com".to_string(),
                timestamp: 1502484200,
                timezone_offset: 0.0,
            };
            match merge(
                fs,
                Some(&repo_root),
                &gitdir,
                None,
                theirs,
                true,
                sub_args.contains(&"--ff-only"),
                false,
                false,
                false,
                None,
                Some(author),
                None,
            ) {
                Ok(r) => {
                    if r.fast_forward {
                        let _ = checkout(
                            fs,
                            &repo_root,
                            Some(&gitdir),
                            Some("HEAD"),
                            None,
                            None,
                            false,
                            false,
                            false,
                            true,
                            false,
                        );
                    }
                    CliResult::ok(format!("Merged {}\n", r.oid.unwrap_or_default()))
                }
                Err(e) => CliResult::err(1, format!("CONFLICT: {}\n", e.message)),
            }
        }
        "cherry-pick" => {
            let Some(&theirs) = sub_args.iter().find(|a| !a.starts_with('-')) else {
                return CliResult::err(128, "fatal: No commit specified\n");
            };
            let author = Author {
                name: "Git User".to_string(),
                email: "user@example.com".to_string(),
                timestamp: 1502484200,
                timezone_offset: 0.0,
            };
            match cherry_pick(
                fs,
                Some(&repo_root),
                &gitdir,
                theirs,
                false,
                false,
                false,
                None,
                Some(author),
                None,
            ) {
                Ok(oid) => CliResult::ok(format!("[{}]\n", &oid[..7])),
                Err(e) => CliResult::err(1, format!("error: {}\n", e.message)),
            }
        }
        "stash" => {
            let op = match sub_args.first().copied() {
                None | Some("push") => Some("push"),
                Some("pop") => Some("pop"),
                Some("apply") => Some("apply"),
                Some("drop") => Some("drop"),
                Some("list") => Some("list"),
                Some("clear") => Some("clear"),
                _ => Some("push"),
            };
            match stash(fs, &repo_root, Some(&gitdir), op, None, 0) {
                Ok(Some(out)) => CliResult::ok(format!("{out}\n")),
                Ok(None) => CliResult::ok(""),
                Err(e) => CliResult::err(1, format!("error: {}\n", e.message)),
            }
        }
        "remote" => match sub_args.first().copied() {
            None | Some("-v") => {
                let remotes = list_remotes(fs, &gitdir);
                let mut out = String::new();
                for r in remotes {
                    if sub_args.contains(&"-v") {
                        out.push_str(&format!(
                            "{}\t{} (fetch)\n{}\t{} (push)\n",
                            r.remote, r.url, r.remote, r.url
                        ));
                    } else {
                        out.push_str(&format!("{}\n", r.remote));
                    }
                }
                CliResult::ok(out)
            }
            Some("add") if sub_args.len() >= 3 => {
                match add_remote(fs, &gitdir, sub_args[1], sub_args[2], false) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            }
            Some("remove") | Some("rm") if sub_args.len() >= 2 => {
                match delete_remote(fs, &gitdir, sub_args[1]) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            }
            _ => CliResult::ok(""),
        },
        "config" => {
            let non_flags: Vec<&str> = sub_args
                .iter()
                .copied()
                .filter(|a| !a.starts_with('-'))
                .collect();
            if non_flags.len() == 1 {
                match get_config(fs, &gitdir, non_flags[0]) {
                    Some(v) => CliResult::ok(format!("{}\n", v.as_str())),
                    None => CliResult::err(1, ""),
                }
            } else if non_flags.len() >= 2 {
                match set_config(fs, &gitdir, non_flags[0], Some(non_flags[1]), false) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            } else {
                CliResult::ok("")
            }
        }
        "rev-parse" => {
            if sub_args.contains(&"--show-toplevel") {
                return CliResult::ok(format!("{repo_root}\n"));
            }
            if sub_args.contains(&"--git-dir") {
                return CliResult::ok(format!(
                    "{}\n",
                    if effective_cwd == repo_root {
                        ".git"
                    } else {
                        &gitdir
                    }
                ));
            }
            if sub_args.contains(&"--is-inside-work-tree") {
                return CliResult::ok(format!("{}\n", fs.exists(&gitdir)));
            }
            let Some(&target) = positionals.last() else {
                return CliResult::err(128, "fatal: missing revision\n");
            };
            if sub_args.contains(&"--abbrev-ref") {
                return match current_branch(fs, &gitdir, false, false) {
                    Ok(branch) if target == "HEAD" => CliResult::ok(format!(
                        "{}\n",
                        branch.unwrap_or_else(|| "HEAD".to_string())
                    )),
                    _ => CliResult::ok(format!("{}\n", target.trim_start_matches("refs/heads/"))),
                };
            }
            match resolve_ref(fs, &gitdir, target, None)
                .or_else(|_| expand_oid(fs, &gitdir, target))
            {
                Ok(oid) => CliResult::ok(format!(
                    "{}\n",
                    if sub_args.contains(&"--short") {
                        &oid[..7]
                    } else {
                        &oid
                    }
                )),
                Err(_) => CliResult::err(128, format!("fatal: ambiguous argument '{target}'\n")),
            }
        }
        "cat-file" => {
            let Some(&target) = positionals.last() else {
                return CliResult::err(128, "fatal: missing object\n");
            };
            let result = resolve_ref(fs, &gitdir, target, None)
                .or_else(|_| expand_oid(fs, &gitdir, target))
                .and_then(|oid| crate::read_object(fs, &gitdir, &oid, Some("content"), None, None));
            match result {
                Ok(obj) if sub_args.contains(&"-t") => CliResult::ok(format!("{}\n", obj.obj_type)),
                Ok(obj) if sub_args.contains(&"-s") => {
                    CliResult::ok(format!("{}\n", obj.object.len()))
                }
                Ok(obj) if obj.obj_type == "tree" => match read_tree(fs, &gitdir, &obj.oid, None) {
                    Ok(tree) => CliResult::ok(
                        tree.tree
                            .into_iter()
                            .map(|e| format!("{} {} {}\t{}\n", e.mode, e.entry_type, e.oid, e.path))
                            .collect::<String>(),
                    ),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                },
                Ok(obj) => CliResult::ok_bytes(obj.object),
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "hash-object" => {
            let write_flag = sub_args.contains(&"-w");
            let Some(&file_arg) = sub_args.iter().find(|a| !a.starts_with('-')) else {
                return CliResult::err(128, "fatal: missing file\n");
            };
            let full = absolute_path(&effective_cwd, file_arg);
            let Some(bytes) = fs.read(&full) else {
                return CliResult::err(128, format!("fatal: Cannot open '{file_arg}'\n"));
            };
            if write_flag {
                match write_blob(fs, &gitdir, &bytes) {
                    Ok(oid) => CliResult::ok(format!("{oid}\n")),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            } else {
                let res = crate::commands::plumbing::hash_blob(&bytes);
                CliResult::ok(format!("{}\n", res.oid))
            }
        }
        "ls-files" => match list_files(fs, &gitdir, None) {
            Ok(files) => CliResult::ok(files.join("\n") + if files.is_empty() { "" } else { "\n" }),
            Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
        },
        "fetch" => match fetch(
            fs,
            http,
            Some(&repo_root),
            Some(&gitdir),
            None,
            positionals.first().copied(),
            positionals.get(1).copied(),
            false,
            true,
            None,
            sub_args.contains(&"--prune") || sub_args.contains(&"-p"),
            None,
            None,
        ) {
            Ok(_) => CliResult::ok(""),
            Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
        },
        "pull" => {
            let author = Author {
                name: "Git User".to_string(),
                email: "user@example.com".to_string(),
                timestamp: 1502484200,
                timezone_offset: 0.0,
            };
            match pull(
                fs,
                http,
                &repo_root,
                Some(&gitdir),
                positionals.get(1).copied(),
                None,
                positionals.first().copied(),
                false,
                true,
                sub_args.contains(&"--ff-only"),
                None,
                Some(author),
                None,
                None,
            ) {
                Ok(()) => CliResult::ok(""),
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "push" => match push(
            fs,
            http,
            Some(&repo_root),
            Some(&gitdir),
            positionals.get(1).copied(),
            None,
            positionals.first().copied(),
            None,
            sub_args.contains(&"-f") || sub_args.contains(&"--force"),
            sub_args.contains(&"--delete") || sub_args.contains(&"-d"),
            None,
            None,
            None,
        ) {
            Ok(_) => {
                if sub_args.contains(&"-u") || sub_args.contains(&"--set-upstream") {
                    let remote = positionals.first().copied().unwrap_or("origin");
                    let branch = positionals
                        .get(1)
                        .map(|s| s.to_string())
                        .or_else(|| current_branch(fs, &gitdir, false, false).ok().flatten());
                    if let Some(branch) = branch {
                        let name = branch.trim_start_matches("refs/heads/");
                        for (key, value) in [
                            (format!("branch.{name}.remote"), remote.to_string()),
                            (format!("branch.{name}.merge"), format!("refs/heads/{name}")),
                        ] {
                            if let Err(e) = set_config(fs, &gitdir, &key, Some(&value), false) {
                                return CliResult::err(128, format!("fatal: {}\n", e.message));
                            }
                        }
                    }
                }
                CliResult::ok("")
            }
            Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
        },
        other => CliResult::err(1, format!("git: '{other}' is not a git command.\n")),
    }
}

fn absolute_path(cwd: &str, path: &str) -> String {
    if path.starts_with('/') {
        crate::utils::normalize_path(path)
    } else {
        join(&[cwd, path])
    }
}

pub(crate) fn repository_path(root: &str, cwd: &str, path: &str) -> String {
    let full = absolute_path(cwd, path);
    if full == root {
        ".".to_string()
    } else {
        full.strip_prefix(&format!("{}/", root.trim_end_matches('/')))
            .unwrap_or(&full)
            .to_string()
    }
}

fn reset_repository(
    fs: &MemoryFs,
    root: &str,
    gitdir: &str,
    target: &str,
    hard: bool,
    soft: bool,
) -> Result<(), crate::GitError> {
    let oid = resolve_ref(fs, gitdir, target, None).or_else(|_| expand_oid(fs, gitdir, target))?;
    if hard {
        let tracked = list_files(fs, gitdir, None)?;
        let target_files = list_files(fs, gitdir, Some(&oid))?;
        checkout(
            fs,
            root,
            Some(gitdir),
            Some(&oid),
            None,
            None,
            false,
            true,
            false,
            true,
            false,
        )?;
        for path in tracked {
            if !target_files.contains(&path) {
                let _ = fs.unlink(&join(&[root, &path]));
            }
        }
    } else if !soft {
        let mut tree = std::collections::BTreeMap::new();
        crate::commands::worktree::collect_tree_map(fs, gitdir, &oid, "", &mut tree)?;
        crate::GitIndexManager::acquire(fs, gitdir, |index| {
            index.clear();
            for (path, entry) in tree {
                let stat = crate::fs::FileStat {
                    kind: crate::fs::NodeKind::File,
                    mode: u32::from_str_radix(&entry.mode, 8)
                        .map_err(|_| crate::GitError::internal("invalid tree mode"))?,
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
                index.insert(&path, Some(&stat), &entry.oid, 0);
            }
            Ok(())
        })?;
    }
    let head = fs.read_str(&join(&[gitdir, "HEAD"])).unwrap_or_default();
    let ref_name = head.trim().strip_prefix("ref: ").unwrap_or("HEAD");
    crate::GitRefManager::write_ref(fs, gitdir, ref_name, &oid)
}

pub(crate) fn format_commit(
    c: &crate::commands::plumbing::ReadCommitResult,
    format: &str,
) -> String {
    let mut out = String::new();
    let mut chars = format.chars();
    while let Some(ch) = chars.next() {
        if ch != '%' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('%') => out.push('%'),
            Some('n') => out.push('\n'),
            Some('H') => out.push_str(&c.oid),
            Some('h') => out.push_str(&c.oid[..7]),
            Some('s') => out.push_str(c.commit.message.lines().next().unwrap_or("")),
            Some('B') => out.push_str(&c.commit.message),
            Some('b') => out.push_str(
                c.commit
                    .message
                    .split_once("\n\n")
                    .map(|(_, b)| b)
                    .unwrap_or(""),
            ),
            Some(selector @ ('a' | 'c')) => {
                let who = if selector == 'a' {
                    &c.commit.author
                } else {
                    &c.commit.committer
                };
                match chars.next() {
                    Some('n') => out.push_str(&who.name),
                    Some('e') => out.push_str(&who.email),
                    Some(other) => {
                        out.push('%');
                        out.push(selector);
                        out.push(other);
                    }
                    None => {
                        out.push('%');
                        out.push(selector);
                    }
                }
            }
            Some(other) => {
                out.push('%');
                out.push(other);
            }
            None => out.push('%'),
        }
    }
    out
}
