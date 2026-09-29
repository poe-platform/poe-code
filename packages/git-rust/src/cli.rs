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
use crate::{current_branch, discover_gitdir, list_branches, list_tags, resolve_ref, version};

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
    execute_git_cli_with_input(fs, cwd, args, http, &[])
}

pub fn execute_git_cli_with_input(
    fs: &MemoryFs, cwd: &str, args: &[&str], http: &dyn HttpClient, stdin: &[u8],
) -> CliResult {
    let stdin_text = String::from_utf8_lossy(stdin);
    let _replacement_scope = crate::storage::ReplacementScope::new(!args.contains(&"--no-replace-objects"));
    let mut filtered: Vec<&str> = Vec::new();
    let mut effective_cwd = cwd.to_string();
    let mut explicit_gitdir: Option<String> = None;
    let mut inline_configs: Vec<(String, String)> = Vec::new();
    let mut idx = 0;
    while idx < args.len() {
        if filtered.is_empty() && matches!(args[idx], "--no-pager" | "-p" | "--paginate" | "--no-replace-objects") {
            idx += 1;
            continue;
        }
        if filtered.is_empty() && args[idx] == "-c" && idx + 1 < args.len() {
            if let Some((k, v)) = args[idx + 1].split_once('=') {
                inline_configs.push((k.trim().to_string(), v.trim().to_string()));
            }
            idx += 2;
            continue;
        }
        if filtered.is_empty()
            && let Some(kv) = args[idx].strip_prefix("-c")
            && let Some((k, v)) = kv.split_once('=')
        {
            inline_configs.push((k.trim().to_string(), v.trim().to_string()));
            idx += 1;
            continue;
        }
        if filtered.is_empty() && args[idx] == "-C" && idx + 1 < args.len() {
            effective_cwd = if args[idx + 1].starts_with('/') {
                args[idx + 1].to_string()
            } else {
                join(&[&effective_cwd, args[idx + 1]])
            };
            idx += 2;
            continue;
        }
        if filtered.is_empty() && args[idx] == "--git-dir" && idx + 1 < args.len() {
            explicit_gitdir = Some(args[idx + 1].to_string());
            idx += 2;
            continue;
        }
        if filtered.is_empty() && let Some(g) = args[idx].strip_prefix("--git-dir=") {
            explicit_gitdir = Some(g.to_string());
            idx += 1;
            continue;
        }
        if filtered.is_empty() && args[idx] == "--work-tree" && idx + 1 < args.len() {
            effective_cwd = args[idx + 1].to_string();
            idx += 2;
            continue;
        }
        if filtered.is_empty() && let Some(w) = args[idx].strip_prefix("--work-tree=") {
            effective_cwd = w.to_string();
            idx += 1;
            continue;
        }
        if filtered.is_empty() && args[idx] == "--no-replace-objects" {
            idx += 1;
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
    if subcmd == "--help" || subcmd == "-h" || subcmd == "help" {
        let topic = positionals.first().copied().unwrap_or("git");
        return CliResult::ok(format!("usage: git {topic} [<args>]\n"));
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

    let repo_root = find_root(fs, &effective_cwd).unwrap_or_else(|_| {
        let mut cur = effective_cwd.clone();
        loop {
            if fs.exists(&join(&[&cur, ".git"])) || fs.exists(&format!("{cur}.git")) {
                break cur;
            }
            let parent = crate::utils::dirname(&cur);
            if parent == cur {
                break effective_cwd.clone();
            }
            cur = parent;
        }
    });
    let gitdir = match explicit_gitdir {
        Some(g) => discover_gitdir(fs, &g),
        None => {
            let candidate = join(&[&repo_root, ".git"]);
            let sibling_git = format!("{repo_root}.git");
            if !fs.exists(&candidate) && fs.exists(&sibling_git) {
                discover_gitdir(fs, &sibling_git)
            } else {
                discover_gitdir(fs, &candidate)
            }
        }
    };
    for (k, v) in &inline_configs {
        let _ = set_config(fs, &gitdir, k, Some(v), false);
    }

    match subcmd {
        "status" => {
            let mut short = false;
            let mut branch = false;
            let mut untracked = true;
            let mut all_untracked = false;
            let mut show_ignored = false;
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
                        "--ignored" => show_ignored = true,
                        "-uno" | "--untracked-files=no" => untracked = false,
                        "-u" | "-uall" | "--untracked-files" | "--untracked-files=all" => {
                            untracked = true;
                            all_untracked = true;
                        }
                        "-unormal" | "--untracked-files=normal" => {
                            untracked = true;
                            all_untracked = false;
                        }
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
            match status_matrix(fs, &repo_root, Some(&gitdir), None, None) {
                Ok(rows) => {
                    let tracked: std::collections::BTreeSet<_> = rows
                        .iter()
                        .filter(|(_, h, _, s)| *h != 0 || *s != 0)
                        .flat_map(|(path, _, _, _)| {
                            path.match_indices('/')
                                .map(|(i, _)| path[..i + 1].to_string())
                        })
                        .collect();
                    let mut seen = std::collections::BTreeSet::new();
                    let mut rows: Vec<_> = rows
                        .into_iter()
                        .filter(|(p, h, _, s)| {
                            (untracked || *h != 0 || *s != 0)
                                && crate::cli_history::matches_path(p, &paths)
                        })
                        .map(|(mut p, h, w, s)| {
                            if h == 0
                                && s == 0
                                && !all_untracked
                                && let Some((i, _)) = p.match_indices('/').find(|(i, _)| {
                                    let dir = &p[..i + 1];
                                    !tracked.contains(dir)
                                        && (paths.is_empty()
                                            || paths.iter().any(|spec| {
                                                spec == "."
                                                    || dir.trim_end_matches('/') == spec
                                                    || dir.starts_with(&format!("{spec}/"))
                                            }))
                                })
                            {
                                p.truncate(i + 1);
                            }
                            (p, h, w, s)
                        })
                        .filter(|(p, _, _, _)| seen.insert(p.clone()))
                        .collect();
                    rows.sort_by_key(|(_, h, _, s)| *h == 0 && *s == 0);
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
                                (0, 0) => ' ',
                                (0, 2) => '?',
                                (_, 0) => 'D',
                                (s, w) if s != w => 'M',
                                _ => ' ',
                            };
                            out.push_str(&format!("{idx_char}{wt_char} {path}\n"));
                        }
                        if show_ignored {
                            for entry in fs.readdir(&repo_root).unwrap_or_default() {
                                if entry != ".git"
                                    && crate::is_ignored(fs, &repo_root, Some(&gitdir), &entry)
                                {
                                    out.push_str(&format!("!! {entry}\n"));
                                }
                            }
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
        "add" | "stage" => {
            let mut paths = Vec::new();
            for &a in sub_args {
                if !a.starts_with('-') {
                    paths.push(repository_path(&repo_root, &effective_cwd, a));
                }
            }
            if paths.is_empty() && (sub_args.contains(&"-u") || sub_args.contains(&"--update") || sub_args.contains(&"-A") || sub_args.contains(&"--all")) {
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
            let target = positionals
                .first()
                .copied()
                .filter(|a| crate::cli_history::resolve(fs, &gitdir, a).is_ok());
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
            let resolved_target =
                target.and_then(|t| crate::cli_history::resolve(fs, &gitdir, t).ok());
            let target = resolved_target.as_deref();
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
            let mut msgs: Vec<String> = Vec::new();
            let mut amend = false;
            let mut stage_all = false;
            let mut no_verify = false;
            let mut custom_author: Option<(String, String)> = None;
            let mut reuse_commit: Option<&str> = None;
            let mut msg_file: Option<&str> = None;
            let mut commit_paths: Vec<String> = Vec::new();
            let mut gpg_sign_flag: Option<Option<String>> = None;
            let mut i = 0;
            while i < sub_args.len() {
                let arg = sub_args[i];
                if matches!(arg, "-m" | "--message") && i + 1 < sub_args.len() {
                    msgs.push(sub_args[i + 1].to_string());
                    i += 2;
                    continue;
                }
                if matches!(arg, "-n" | "--no-verify") {
                    no_verify = true;
                    i += 1;
                    continue;
                }
                if let Some(m) = arg.strip_prefix("--message=") {
                    msgs.push(m.to_string());
                    i += 1;
                    continue;
                }
                if matches!(arg, "-am" | "-ma") && i + 1 < sub_args.len() {
                    stage_all = true;
                    msgs.push(sub_args[i + 1].to_string());
                    i += 2;
                    continue;
                }
                if matches!(arg, "-a" | "--all") {
                    stage_all = true;
                    i += 1;
                    continue;
                }
                if arg == "--amend" {
                    amend = true;
                    i += 1;
                    continue;
                }
                if matches!(arg, "-S" | "--gpg-sign") {
                    gpg_sign_flag = Some(None);
                    i += 1;
                    continue;
                }
                if arg == "--no-gpg-sign" {
                    gpg_sign_flag = None;
                    let _ = set_config(fs, &gitdir, "commit.gpgsign", Some("false"), false);
                    i += 1;
                    continue;
                }
                if let Some(key_id) = arg.strip_prefix("--gpg-sign=").or_else(|| arg.strip_prefix("-S")) {
                    gpg_sign_flag = Some(Some(key_id.to_string()));
                    i += 1;
                    continue;
                }
                if matches!(arg, "-F" | "--file") && i + 1 < sub_args.len() {
                    msg_file = Some(sub_args[i + 1]);
                    i += 2;
                    continue;
                }
                if let Some(f) = arg.strip_prefix("--file=") {
                    msg_file = Some(f);
                    i += 1;
                    continue;
                }
                if matches!(arg, "-C" | "-c") && i + 1 < sub_args.len() {
                    reuse_commit = Some(sub_args[i + 1]);
                    i += 2;
                    continue;
                }
                if let Some(rc) = arg.strip_prefix("--reuse-message=") {
                    reuse_commit = Some(rc);
                    i += 1;
                    continue;
                }
                if arg == "--author" && i + 1 < sub_args.len() {
                    if let Some((n, e)) = sub_args[i + 1].split_once(" <") {
                        custom_author = Some((n.trim().to_string(), e.trim_end_matches('>').trim().to_string()));
                    }
                    i += 2;
                    continue;
                }
                if let Some(au) = arg.strip_prefix("--author=") {
                    if let Some((n, e)) = au.split_once(" <") {
                        custom_author = Some((n.trim().to_string(), e.trim_end_matches('>').trim().to_string()));
                    }
                    i += 1;
                    continue;
                }
                if !arg.starts_with('-') {
                    commit_paths.push(repository_path(&repo_root, &effective_cwd, arg));
                }
                i += 1;
            }
            if stage_all {
                let tracked = list_files(fs, &gitdir, None).unwrap_or_default();
                let mut to_add = Vec::new();
                for p in tracked {
                    if fs.exists(&join(&[&repo_root, &p])) {
                        to_add.push(p);
                    } else {
                        let _ = remove(fs, &gitdir, &p);
                    }
                }
                if !to_add.is_empty() {
                    let _ = add(fs, &repo_root, Some(&gitdir), &to_add, false);
                }
            }
            if !no_verify {
                let pre = crate::hooks::run_hook(fs, &repo_root, &gitdir, "pre-commit", &[], None);
                if pre.ran && pre.exit_code != 0 {
                    return CliResult::err(pre.exit_code, format!("{}{}", pre.stdout, pre.stderr));
                }
            }
            if let Some(f_arg) = msg_file
                && let Some(text) = if f_arg == "-" { Some(stdin_text.to_string()) } else { fs.read_str(&absolute_path(&effective_cwd, f_arg)) }
            {
                msgs.push(text.trim_end_matches('\n').to_string());
            }
            if let Some(rc_arg) = reuse_commit
                && let Ok(rc_oid) = crate::cli_history::resolve(fs, &gitdir, rc_arg)
                && let Ok(rc_obj) = crate::read_commit(fs, &gitdir, &rc_oid)
            {
                if msgs.is_empty() {
                    msgs.push(rc_obj.commit.message.trim_end_matches('\n').to_string());
                }
                if custom_author.is_none() {
                    custom_author = Some((rc_obj.commit.author.name, rc_obj.commit.author.email));
                }
            }
            if msgs.is_empty() {
                if let Some(m) = fs.read_str(&join(&[&gitdir, "MERGE_MSG"])) {
                    msgs.push(m.trim_end_matches('\n').to_string());
                } else if let Some(m) = fs.read_str(&join(&[&gitdir, "SQUASH_MSG"])) {
                    msgs.push(m.trim_end_matches('\n').to_string());
                }
            }
            let mut joined_msg = if msgs.is_empty() {
                None
            } else {
                Some(msgs.join("\n\n"))
            };
            if let Some(ref initial_m) = joined_msg {
                let editmsg_path = join(&[&gitdir, "COMMIT_EDITMSG"]);
                fs.write_str(&editmsg_path, &format!("{initial_m}\n"));
                let prep = crate::hooks::run_hook(
                    fs,
                    &repo_root,
                    &gitdir,
                    "prepare-commit-msg",
                    &[&editmsg_path, "message"],
                    None,
                );
                if prep.ran && prep.exit_code != 0 && !no_verify {
                    return CliResult::err(prep.exit_code, format!("{}{}", prep.stdout, prep.stderr));
                }
                if !no_verify {
                    let cm = crate::hooks::run_hook(
                        fs,
                        &repo_root,
                        &gitdir,
                        "commit-msg",
                        &[&editmsg_path],
                        None,
                    );
                    if cm.ran && cm.exit_code != 0 {
                        return CliResult::err(cm.exit_code, format!("{}{}", cm.stdout, cm.stderr));
                    }
                }
                if let Some(updated_m) = fs.read_str(&editmsg_path) {
                    joined_msg = Some(updated_m.trim_end_matches('\n').to_string());
                }
            }
            let prev_head_before_commit = resolve_ref(fs, &gitdir, "HEAD", None).ok();
            let merge_parents = if !amend
                && let Some(mh) = fs.read_str(&join(&[&gitdir, "MERGE_HEAD"]))
                && let Ok(head_oid) = resolve_ref(fs, &gitdir, "HEAD", None)
            {
                let mh_oid = mh.trim().to_string();
                if !mh_oid.is_empty() {
                    Some(vec![head_oid, mh_oid])
                } else {
                    None
                }
            } else {
                None
            };
            let (author_name, author_email) = custom_author.unwrap_or_else(|| {
                (
                    get_config(fs, &gitdir, "user.name")
                        .map(|v| v.as_str().to_string())
                        .unwrap_or_else(|| "Git User".to_string()),
                    get_config(fs, &gitdir, "user.email")
                        .map(|v| v.as_str().to_string())
                        .unwrap_or_else(|| "user@example.com".to_string()),
                )
            });
            let author = Author {
                name: author_name,
                email: author_email,
                timestamp: 1502484200,
                timezone_offset: 0.0,
            };
            let index_path = join(&[&gitdir, "index"]);
            let original_index = fs.read(&index_path);
            let mut selected = Vec::new();
            if !commit_paths.is_empty() {
                let tracked = list_files(fs, &gitdir, None).unwrap_or_default();
                let mut head = std::collections::BTreeMap::new();
                if let Ok(oid) = resolve_ref(fs, &gitdir, "HEAD", None)
                    && let Err(e) = crate::commands::worktree::collect_tree_map(fs, &gitdir, &oid, "", &mut head) {
                    return CliResult::err(128, format!("fatal: {}\n", e.message));
                }
                let known: std::collections::BTreeSet<_> = tracked.into_iter().chain(head.keys().cloned()).collect();
                for path in &commit_paths {
                    let matches: Vec<_> = known.iter().filter(|p| crate::cli_history::matches_path(p, std::slice::from_ref(path))).cloned().collect();
                    if matches.is_empty() { return CliResult::err(1, format!("error: pathspec '{path}' did not match any file(s) known to git\n")); }
                    selected.extend(matches);
                }
                let preparation = (|| -> Result<(), crate::GitError> {
                    for path in &known { reset_index(fs, Some(&repo_root), &gitdir, path, None)?; }
                    for path in &selected {
                        if fs.exists(&join(&[&repo_root, path])) {
                            add(fs, &repo_root, Some(&gitdir), std::slice::from_ref(path), false)?;
                        } else { remove(fs, &gitdir, path)?; }
                    }
                    Ok(())
                })();
                if let Err(e) = preparation {
                    if let Some(bytes) = &original_index { fs.write(&index_path, bytes); } else { let _ = fs.rm(&index_path); }
                    return CliResult::err(128, format!("fatal: {}\n", e.message));
                }
            }
            let result = commit(
                fs,
                &gitdir,
                joined_msg.as_deref(),
                Some(author),
                None,
                amend,
                false,
                false,
                false,
                None,
                merge_parents.as_deref(),
                None,
            );
            if !commit_paths.is_empty() {
                if let Some(bytes) = &original_index { fs.write(&index_path, bytes); } else { let _ = fs.rm(&index_path); }
                if result.is_ok() {
                    for path in &selected {
                        if let Err(e) = reset_index(fs, Some(&repo_root), &gitdir, path, None) {
                            return CliResult::err(128, format!("fatal: {}\n", e.message));
                        }
                    }
                }
            }
            match result {
                Ok(mut oid) => {
                    if let Some(ref key_opt) = gpg_sign_flag
                        && let Ok(read_c) = crate::read_commit(fs, &gitdir, &oid)
                    {
                        let gpg_format = get_config(fs, &gitdir, "gpg.format")
                            .map(|v| v.as_str().to_string())
                            .unwrap_or_else(|| "openpgp".to_string());
                        let signing_key = key_opt
                            .clone()
                            .or_else(|| get_config(fs, &gitdir, "user.signingkey").map(|v| v.as_str().to_string()))
                            .unwrap_or_else(|| read_c.commit.committer.email.clone());
                        let signer_uid = format!("{} <{}>", read_c.commit.committer.name, read_c.commit.committer.email);
                        let mut signed_obj = read_c.commit.clone();
                        signed_obj.gpgsig = None;
                        let unsigned_payload = crate::models::GitCommit::from_object(&signed_obj).without_signature();
                        signed_obj.gpgsig = Some(crate::crypto::sign_git_payload(
                            fs,
                            &repo_root,
                            &gpg_format,
                            &signing_key,
                            &signer_uid,
                            signed_obj.committer.timestamp as u32,
                            &unsigned_payload,
                        ));
                        if let Ok(new_oid) = crate::commands::plumbing::write_commit(fs, &gitdir, &signed_obj) {
                            let target_ref = crate::GitRefManager::resolve(fs, &gitdir, "HEAD", Some(2)).unwrap_or_else(|_| "HEAD".to_string());
                            let _ = crate::GitRefManager::write_ref(fs, &gitdir, &target_ref, &new_oid);
                            oid = new_oid;
                        }
                    }
                    let _ = fs.rm(&join(&[&gitdir, "MERGE_HEAD"]));
                    let _ = fs.rm(&join(&[&gitdir, "MERGE_MSG"]));
                    let _ = fs.rm(&join(&[&gitdir, "MERGE_MODE"]));
                    let _ = fs.rm(&join(&[&gitdir, "SQUASH_MSG"]));
                    let _ = crate::hooks::run_hook(fs, &repo_root, &gitdir, "post-commit", &[], None);
                    if amend
                        && let Some(ref old_id) = prev_head_before_commit
                    {
                        let _ = crate::hooks::run_hook(
                            fs,
                            &repo_root,
                            &gitdir,
                            "post-rewrite",
                            &["amend"],
                            Some(&format!("{old_id} {oid}\n")),
                        );
                    }
                    CliResult::ok(format!("[{}] {}\n", &oid[..7], joined_msg.as_deref().unwrap_or("")))
                }
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "log" => {
            crate::cli_history::execute(fs, &repo_root, &gitdir, &effective_cwd, sub_args, false)
        }
        "branch" => {
            let mut remote = false;
            let mut all = false;
            let mut rename = false;
            let mut copy_branch = false;
            let mut force = false;
            let mut delete = false;
            let mut show_current = false;
            let mut verbose = 0u8;
            let mut list_mode = false;
            let mut contains_rev: Option<&str> = None;
            let mut merged_rev: Option<&str> = None;
            let mut no_merged_rev: Option<&str> = None;
            let mut set_upstream: Option<&str> = None;
            let mut unset_upstream = false;
            let mut names = Vec::new();
            let mut bi = 0;
            while bi < sub_args.len() {
                let arg = sub_args[bi];
                match arg {
                    "--show-current" => show_current = true,
                    "-a" | "--all" => all = true,
                    "-r" | "--remotes" => remote = true,
                    "-v" | "--verbose" => verbose = verbose.max(1),
                    "-vv" => verbose = 2,
                    "-l" | "--list" => list_mode = true,
                    "-m" | "--move" => rename = true,
                    "-M" => {
                        rename = true;
                        force = true;
                    }
                    "-c" | "--copy" => copy_branch = true,
                    "-C" => {
                        copy_branch = true;
                        force = true;
                    }
                    "-d" | "--delete" => delete = true,
                    "-D" => {
                        delete = true;
                        force = true;
                    }
                    "-f" | "--force" => force = true,
                    "--unset-upstream" => unset_upstream = true,
                    "-u" | "--set-upstream-to" if bi + 1 < sub_args.len() => {
                        bi += 1;
                        set_upstream = Some(sub_args[bi]);
                    }
                    "--contains" => {
                        contains_rev = Some("HEAD");
                        if bi + 1 < sub_args.len() && !sub_args[bi + 1].starts_with('-') {
                            bi += 1;
                            contains_rev = Some(sub_args[bi]);
                        }
                    }
                    "--merged" => {
                        if bi + 1 < sub_args.len() && !sub_args[bi + 1].starts_with('-') {
                            bi += 1;
                            merged_rev = Some(sub_args[bi]);
                        } else {
                            merged_rev = Some("HEAD");
                        }
                    }
                    "--no-merged" => {
                        if bi + 1 < sub_args.len() && !sub_args[bi + 1].starts_with('-') {
                            bi += 1;
                            no_merged_rev = Some(sub_args[bi]);
                        } else {
                            no_merged_rev = Some("HEAD");
                        }
                    }
                    _ if arg.starts_with("--set-upstream-to=") => {
                        set_upstream = arg.strip_prefix("--set-upstream-to=");
                    }
                    _ if arg.starts_with("--contains=") => {
                        contains_rev = arg.strip_prefix("--contains=");
                    }
                    _ if arg.starts_with("--merged=") => {
                        merged_rev = arg.strip_prefix("--merged=");
                    }
                    _ if arg.starts_with("--no-merged=") => {
                        no_merged_rev = arg.strip_prefix("--no-merged=");
                    }
                    arg if !arg.starts_with('-') => names.push(arg),
                    _ => return CliResult::err(129, format!("error: unknown option '{arg}'\n")),
                }
                bi += 1;
            }
            let curr = current_branch(fs, &gitdir, false, false).ok().flatten();
            if show_current {
                return CliResult::ok(curr.map(|b| format!("{b}\n")).unwrap_or_default());
            }
            if let Some(up) = set_upstream {
                let target_b = names.first().copied().or(curr.as_deref()).unwrap_or("main");
                let (rem, br) = up.split_once('/').unwrap_or(("origin", up));
                let _ = set_config(fs, &gitdir, &format!("branch.{target_b}.remote"), Some(rem), false);
                let _ = set_config(fs, &gitdir, &format!("branch.{target_b}.merge"), Some(&format!("refs/heads/{br}")), false);
                return CliResult::ok(format!("branch '{target_b}' set up to track '{up}'.\n"));
            }
            if unset_upstream {
                let target_b = names.first().copied().or(curr.as_deref()).unwrap_or("main");
                let _ = set_config(fs, &gitdir, &format!("branch.{target_b}.remote"), None, false);
                let _ = set_config(fs, &gitdir, &format!("branch.{target_b}.merge"), None, false);
                return CliResult::ok("");
            }
            if copy_branch {
                let (old, new) = match names.as_slice() {
                    [new] if curr.is_some() => (curr.as_deref().unwrap(), *new),
                    [old, new] => (*old, *new),
                    _ => return CliResult::err(129, "usage: git branch -c [<old>] <new>\n"),
                };
                let Ok(oid) = resolve_ref(fs, &gitdir, &format!("refs/heads/{old}"), None) else {
                    return CliResult::err(128, format!("fatal: invalid branch '{old}'\n"));
                };
                return match branch(fs, &gitdir, new, Some(&oid), false, force) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                };
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
            if names.is_empty() || all || remote || list_mode || contains_rev.is_some() || merged_rev.is_some() || no_merged_rev.is_some() {
                let mut out = String::new();
                let contains_oid = contains_rev.and_then(|r| crate::cli_history::resolve(fs, &gitdir, r).ok());
                let merged_set: Option<std::collections::HashSet<String>> = merged_rev
                    .and_then(|r| crate::cli_history::resolve(fs, &gitdir, r).ok())
                    .map(|oid| {
                        crate::commands::plumbing::log(fs, &gitdir, Some(&oid), None, None, None, false, false)
                            .unwrap_or_default()
                            .into_iter()
                            .map(|c| c.oid)
                            .collect()
                    });
                let no_merged_set: Option<std::collections::HashSet<String>> = no_merged_rev
                    .and_then(|r| crate::cli_history::resolve(fs, &gitdir, r).ok())
                    .map(|oid| {
                        crate::commands::plumbing::log(fs, &gitdir, Some(&oid), None, None, None, false, false)
                            .unwrap_or_default()
                            .into_iter()
                            .map(|c| c.oid)
                            .collect()
                    });
                if !remote || all {
                    for b in list_branches(fs, &gitdir, None) {
                        if list_mode && !names.is_empty() && !names.iter().any(|pat| {
                            glob::Pattern::new(pat).is_ok_and(|pattern| pattern.matches(&b))
                        }) {
                            continue;
                        }
                        let b_oid = resolve_ref(fs, &gitdir, &format!("refs/heads/{b}"), None).unwrap_or_default();
                        if let Some(ref c_oid) = contains_oid {
                            let hist = crate::commands::plumbing::log(fs, &gitdir, Some(&b_oid), None, None, None, false, false).unwrap_or_default();
                            if !hist.iter().any(|c| &c.oid == c_oid) {
                                continue;
                            }
                        }
                        if let Some(ref m_set) = merged_set
                            && !m_set.contains(&b_oid)
                        {
                            continue;
                        }
                        if let Some(ref nm_set) = no_merged_set
                            && nm_set.contains(&b_oid)
                        {
                            continue;
                        }
                        let mark = if Some(&b) == curr.as_ref() { "*" } else { " " };
                        if verbose > 0 {
                            let short = &b_oid[..7.min(b_oid.len())];
                            let subj = crate::read_commit(fs, &gitdir, &b_oid)
                                .map(|c| crate::cli_history::subject(&c.commit.message))
                                .unwrap_or_default();
                            if verbose >= 2
                                && let Some(rem) = get_config(fs, &gitdir, &format!("branch.{b}.remote"))
                                && let Some(mrg) = get_config(fs, &gitdir, &format!("branch.{b}.merge"))
                            {
                                let m_short = mrg.as_str().strip_prefix("refs/heads/").unwrap_or("").to_string();
                                out.push_str(&format!("{mark} {b} {short} [{}/{m_short}] {subj}\n", rem.as_str()));
                            } else {
                                out.push_str(&format!("{mark} {b} {short} {subj}\n"));
                            }
                        } else {
                            out.push_str(&format!("{mark} {b}\n"));
                        }
                    }
                }
                if remote || all {
                    for b in crate::GitRefManager::list_refs(fs, &gitdir, "refs/remotes") {
                        out.push_str(&format!("  {}{b}\n", if all { "remotes/" } else { "" }));
                    }
                }
                CliResult::ok(out)
            } else if names.len() <= 2 {
                let object = match names
                    .get(1)
                    .map(|rev| crate::cli_history::resolve_commit(fs, &gitdir, rev))
                    .transpose()
                {
                    Ok(oid) => oid,
                    Err(e) => return CliResult::err(128, format!("fatal: {}\n", e.message)),
                };
                match branch(fs, &gitdir, names[0], object.as_deref(), false, force) {
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
                            "--shortstat" => {
                                options.mode = crate::cli_files::DiffMode::ShortStat;
                                continue;
                            }
                            "--numstat" => {
                                options.mode = crate::cli_files::DiffMode::NumStat;
                                continue;
                            }
                            "--dirstat" => {
                                options.mode = crate::cli_files::DiffMode::DirStat;
                                continue;
                            }
                            "--word-diff" | "--color-words" => {
                                options.mode = crate::cli_files::DiffMode::WordDiff;
                                continue;
                            }
                            "-R" => {
                                options.reverse = true;
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
                                let resolve = if arg.contains("...") {
                                    crate::cli_history::resolve_commit
                                } else {
                                    crate::cli_history::resolve
                                };
                                let a = resolve(fs, &gitdir, left)?;
                                let b = resolve(fs, &gitdir, right)?;
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
                                || crate::cli_history::historical_path(fs, &gitdir, &path))
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
                "show" => {
                    return crate::cli_history::execute(
                        fs,
                        &repo_root,
                        &gitdir,
                        &effective_cwd,
                        sub_args,
                        true,
                    );
                }
                "restore" => {
                    let mut source = None;
                    let mut paths = Vec::new();
                    let mut args = sub_args.iter().copied();
                    let mut separator = false;
                    while let Some(arg) = args.next() {
                        if separator {
                            paths.push(repository_path(&repo_root, &effective_cwd, arg));
                        } else if arg == "--" {
                            separator = true;
                        } else if matches!(arg, "--source" | "-s") {
                            let Some(value) = args.next().filter(|v| !v.is_empty()) else {
                                return CliResult::err(129, "error: missing restore source\n");
                            };
                            source = Some(value);
                        } else if let Some(value) = arg
                            .strip_prefix("--source=")
                            .or_else(|| arg.strip_prefix("-s"))
                        {
                            if value.is_empty() {
                                return CliResult::err(129, "error: missing restore source\n");
                            }
                            source = Some(value);
                        } else if !arg.starts_with('-') {
                            paths.push(repository_path(&repo_root, &effective_cwd, arg));
                        }
                    }
                    let staged = sub_args.contains(&"--staged") || sub_args.contains(&"-S");
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
            let mut positionals = Vec::new();
            let mut branch_name = None;
            let mut reset_branch = false;
            let mut orphan = false;
            let mut args = sub_args.iter().copied();
            while let Some(arg) = args.next() {
                if matches!(arg, "-b" | "-B" | "-c" | "-C")
                    || (subcmd == "checkout" && arg == "--orphan")
                {
                    let Some(name) = args.next().filter(|name| !name.starts_with('-')) else {
                        return CliResult::err(
                            129,
                            format!("error: option '{arg}' requires a branch name\n"),
                        );
                    };
                    if branch_name.replace(name).is_some() {
                        return CliResult::err(129, "error: multiple branch creation options\n");
                    }
                    reset_branch = matches!(arg, "-B" | "-C");
                    orphan = arg == "--orphan";
                } else if !arg.starts_with('-') || arg == "-" {
                    positionals.push(arg);
                }
            }
            let create_new = branch_name.is_some();
            if let Some(name) = branch_name {
                if positionals.len() > 1 {
                    return CliResult::err(129, "error: too many start-point arguments\n");
                }
                positionals.insert(0, name);
            }
            if subcmd == "checkout" && !create_new && !positionals.is_empty() {
                let source = crate::cli_history::resolve(fs, &gitdir, positionals[0]).ok();
                let path_args = if source.is_some() {
                    &positionals[1..]
                } else {
                    &positionals[..]
                };
                let tracked = list_files(fs, &gitdir, None).unwrap_or_default();
                if !path_args.is_empty()
                    && (source.is_some()
                        || path_args.iter().all(|arg| {
                            let path = repository_path(&repo_root, &effective_cwd, arg);
                            tracked.iter().any(|tracked| {
                                crate::cli_history::matches_path(
                                    tracked,
                                    std::slice::from_ref(&path),
                                )
                            })
                        }))
                {
                    let paths: Vec<_> = path_args
                        .iter()
                        .map(|arg| repository_path(&repo_root, &effective_cwd, arg))
                        .collect();
                    return match crate::cli_files::restore(
                        fs,
                        &repo_root,
                        &gitdir,
                        &paths,
                        source.as_deref().unwrap_or(":index"),
                        source.is_some(),
                        true,
                    ) {
                        Ok(()) => CliResult::ok(""),
                        Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                    };
                }
            }
            let force = sub_args.contains(&"-f") || sub_args.contains(&"--force");
            let Some(&raw_ref_target) = positionals.first() else {
                return CliResult::err(128, "fatal: missing branch or commit argument\n");
            };
            let prev_resolved: Option<String> = if raw_ref_target == "-" || raw_ref_target == "@{-1}" {
                crate::cli_history::previous_branch(fs, &gitdir, 1)
            } else {
                None
            };
            let ref_target: &str = match prev_resolved.as_deref() {
                Some(p) => p,
                None if raw_ref_target == "-" => {
                    return CliResult::err(128, "fatal: invalid reference: @{-1}\n");
                }
                None => raw_ref_target,
            };
            let old_head_name = current_branch(fs, &gitdir, false, false)
                .ok()
                .flatten()
                .or_else(|| resolve_ref(fs, &gitdir, "HEAD", None).ok())
                .unwrap_or_else(|| "HEAD".to_string());
            let old_head_oid = resolve_ref(fs, &gitdir, "HEAD", None).unwrap_or_else(|_| "0".repeat(40));
            let start = if create_new {
                if !crate::is_valid_ref(ref_target, true) {
                    return CliResult::err(
                        128,
                        format!("fatal: invalid branch name '{ref_target}'\n"),
                    );
                }
                if !reset_branch
                    && crate::GitRefManager::exists(
                        fs,
                        &gitdir,
                        &format!("refs/heads/{ref_target}"),
                    )
                {
                    return CliResult::err(
                        128,
                        format!("fatal: branch '{ref_target}' already exists\n"),
                    );
                }
                match crate::cli_history::resolve_commit(
                    fs,
                    &gitdir,
                    positionals.get(1).copied().unwrap_or("HEAD"),
                ) {
                    Ok(oid) => Some(oid),
                    Err(_)
                        if positionals.len() == 1
                            && resolve_ref(fs, &gitdir, "HEAD", None).is_err()
                            && current_branch(fs, &gitdir, false, false)
                                .ok()
                                .flatten()
                                .is_some() =>
                    {
                        return match branch(fs, &gitdir, ref_target, None, true, reset_branch) {
                            Ok(()) => CliResult::ok(format!("Switched to branch '{ref_target}'\n")),
                            Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                        };
                    }
                    Err(e) => return CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            } else {
                None
            };
            let resolved_target;
            let checkout_target = if let Some(start) = start.as_deref() {
                start
            } else if crate::cli_history::resolve(fs, &gitdir, ref_target).is_ok()
                && !crate::GitRefManager::expand(fs, &gitdir, ref_target)
                    .is_ok_and(|name| name.starts_with("refs/heads/"))
            {
                match crate::cli_history::resolve_commit(fs, &gitdir, ref_target) {
                    Ok(oid) => {
                        resolved_target = oid;
                        &resolved_target
                    }
                    Err(e) => return CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            } else {
                ref_target
            };
            match checkout(
                fs,
                &repo_root,
                Some(&gitdir),
                Some(checkout_target),
                None,
                None,
                false,
                create_new,
                false,
                force,
                true,
            ) {
                Ok(()) => {
                    if create_new {
                        let result = if orphan {
                            crate::GitRefManager::write_symbolic_ref(
                                fs,
                                &gitdir,
                                "HEAD",
                                &format!("refs/heads/{ref_target}"),
                            )
                        } else {
                            branch(
                                fs,
                                &gitdir,
                                ref_target,
                                start.as_deref(),
                                true,
                                reset_branch,
                            )
                        };
                        if let Err(e) = result {
                            return CliResult::err(128, format!("fatal: {}\n", e.message));
                        }
                    }
                    let new_head_oid = resolve_ref(fs, &gitdir, "HEAD", None).unwrap_or_else(|_| old_head_oid.clone());
                    let head_log_path = join(&[&gitdir, "logs", "HEAD"]);
                    let _ = fs.mkdir(&join(&[&gitdir, "logs"]));
                    let mut existing_log = fs.read_str(&head_log_path).unwrap_or_default();
                    existing_log.push_str(&format!(
                        "{old_head_oid} {new_head_oid} Git User <user@example.com> 1502484200 +0000\tcheckout: moving from {old_head_name} to {ref_target}\n"
                    ));
                    fs.write_str(&head_log_path, &existing_log);
                    let _ = crate::hooks::run_hook(
                        fs,
                        &repo_root,
                        &gitdir,
                        "post-checkout",
                        &[&old_head_oid, &new_head_oid, "1"],
                        None,
                    );
                    CliResult::ok(format!("Switched to branch '{ref_target}'\n"))
                }
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "tag" => {
            let list_flag = sub_args.contains(&"-l") || sub_args.contains(&"--list");
            let show_lines = sub_args.contains(&"-n") || sub_args.contains(&"-n1");
            let mut points_at: Option<&str> = None;
            let mut tag_contains: Option<&str> = None;
            let mut patterns = Vec::new();
            let mut ti = 0;
            while ti < sub_args.len() {
                let arg = sub_args[ti];
                if matches!(arg, "--contains" | "--points-at") {
                    let mut rev = "HEAD";
                    if ti + 1 < sub_args.len() && !sub_args[ti + 1].starts_with('-') {
                        ti += 1;
                        rev = sub_args[ti];
                    }
                    if arg == "--contains" { tag_contains = Some(rev); }
                    else { points_at = Some(rev); }
                } else if let Some(rev) = arg.strip_prefix("--contains=") {
                    tag_contains = Some(rev);
                } else if let Some(rev) = arg.strip_prefix("--points-at=") {
                    points_at = Some(rev);
                } else if !arg.starts_with('-') { patterns.push(arg); }
                ti += 1;
            }
            if sub_args.is_empty() || list_flag || show_lines || points_at.is_some() || tag_contains.is_some() {
                let tags = list_tags(fs, &gitdir);
                let pa_oid = points_at.and_then(|r| crate::cli_history::resolve(fs, &gitdir, r).ok());
                let tc_oid = tag_contains.and_then(|r| crate::cli_history::resolve(fs, &gitdir, r).ok());
                let mut out = String::new();
                for t in tags {
                    if !patterns.is_empty() && !patterns.iter().any(|pat| {
                        glob::Pattern::new(pat).is_ok_and(|pattern| pattern.matches(&t))
                    }) { continue; }
                    let raw_oid = resolve_ref(fs, &gitdir, &format!("refs/tags/{t}"), None).unwrap_or_default();
                    let (target_oid, summary) = if let Ok(tag_obj) = crate::commands::plumbing::read_tag(fs, &gitdir, &raw_oid) {
                        (tag_obj.tag.object, tag_obj.tag.message.lines().next().unwrap_or("").to_string())
                    } else if let Ok(c) = crate::read_commit(fs, &gitdir, &raw_oid) {
                        (raw_oid.clone(), crate::cli_history::subject(&c.commit.message))
                    } else {
                        (raw_oid.clone(), String::new())
                    };
                    if let Some(ref p_id) = pa_oid
                        && &target_oid != p_id && &raw_oid != p_id
                    {
                        continue;
                    }
                    if let Some(ref c_id) = tc_oid {
                        let hist = crate::commands::plumbing::log(fs, &gitdir, Some(&target_oid), None, None, None, false, false).unwrap_or_default();
                        if !hist.iter().any(|c| &c.oid == c_id) {
                            continue;
                        }
                    }
                    if show_lines {
                        out.push_str(&format!("{t:<16}{summary}\n"));
                    } else {
                        out.push_str(&format!("{t}\n"));
                    }
                }
                CliResult::ok(out)
            } else if sub_args[0] == "-d" && sub_args.len() > 1 {
                match delete_tag(fs, &gitdir, sub_args[1]) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            } else if (sub_args[0] == "-v" || sub_args[0] == "--verify") && sub_args.len() > 1 {
                let tag_name = sub_args[1];
                let Ok(oid) = resolve_ref(fs, &gitdir, &format!("refs/tags/{tag_name}"), None)
                    .or_else(|_| crate::cli_history::resolve(fs, &gitdir, tag_name))
                else {
                    return CliResult::err(1, format!("error: tag '{tag_name}' not found.\n"));
                };
                if let Ok(t) = crate::read_tag(fs, &gitdir, &oid)
                    && let Some(ref sig) = t.tag.gpgsig
                {
                    let allowed = get_config(fs, &gitdir, "gpg.ssh.allowedSignersFile").map(|v| v.as_str().to_string());
                    let mut unsigned_tag = t.tag.clone();
                    unsigned_tag.gpgsig = None;
                    let payload = crate::models::GitAnnotatedTag::from_object(&unsigned_tag).render().to_string();
                    match crate::crypto::verify_git_signature(fs, &repo_root, sig, &payload, allowed.as_deref()) {
                        Ok(msg) => CliResult::ok(format!("{msg}\n")),
                        Err(err) => CliResult::err(1, format!("error: {err}\n")),
                    }
                } else {
                    CliResult::err(1, "error: no signature found\n")
                }
            } else {
                let mut names = Vec::new();
                let mut messages = Vec::new();
                let mut annotated = false;
                let mut sign_tag = get_config(fs, &gitdir, "tag.gpgSign")
                    .or_else(|| get_config(fs, &gitdir, "tag.gpgsign"))
                    .map(|v| matches!(v.as_str().trim().to_ascii_lowercase().as_str(), "true" | "1" | "yes"))
                    .unwrap_or(false);
                let mut sign_key_override: Option<String> = None;
                let mut force = false;
                let mut args = sub_args.iter().copied();
                while let Some(arg) = args.next() {
                    match arg {
                        "-a" | "--annotate" => annotated = true,
                        "-s" | "--sign" => {
                            annotated = true;
                            sign_tag = true;
                        }
                        "--no-sign" => {
                            sign_tag = false;
                        }
                        "-u" | "--local-user" => {
                            let Some(key_id) = args.next() else {
                                return CliResult::err(129, "error: missing key-id for -u\n");
                            };
                            annotated = true;
                            sign_tag = true;
                            sign_key_override = Some(key_id.to_string());
                        }
                        "-f" | "--force" => force = true,
                        "-m" | "--message" => {
                            let Some(message) = args.next() else {
                                return CliResult::err(129, "error: missing tag message\n");
                            };
                            messages.push(message);
                            annotated = true;
                        }
                        "--" => {
                            names.extend(args);
                            break;
                        }
                        arg if arg.starts_with("--local-user=") || arg.starts_with("-u") => {
                            let key_id = arg.strip_prefix("--local-user=").unwrap_or(&arg[2..]);
                            annotated = true;
                            sign_tag = true;
                            sign_key_override = Some(key_id.to_string());
                        }
                        arg if arg.starts_with("--message=") || arg.starts_with("-m") => {
                            let message = arg.strip_prefix("--message=").unwrap_or(&arg[2..]);
                            messages.push(message);
                            annotated = true;
                        }
                        arg if arg.starts_with('-') => {
                            return CliResult::err(
                                129,
                                format!("error: unknown tag option '{arg}'\n"),
                            );
                        }
                        arg => names.push(arg),
                    }
                }
                if names.is_empty() || names.len() > 2 {
                    return CliResult::err(
                        129,
                        "usage: git tag [-a] [-m <message>] <name> [<commit>]\n",
                    );
                }
                let object = match names
                    .get(1)
                    .map(|rev| crate::cli_history::resolve(fs, &gitdir, rev))
                    .transpose()
                {
                    Ok(oid) => oid,
                    Err(e) => return CliResult::err(128, format!("fatal: {}\n", e.message)),
                };
                let result = if annotated {
                    let message = if messages.is_empty() {
                        names[0].to_string()
                    } else {
                        messages.join("\n\n")
                    };
                    let tagger = Author {
                        name: get_config(fs, &gitdir, "user.name")
                            .map(|v| v.as_str().to_string())
                            .unwrap_or_else(|| "Git User".to_string()),
                        email: get_config(fs, &gitdir, "user.email")
                            .map(|v| v.as_str().to_string())
                            .unwrap_or_else(|| "user@example.com".to_string()),
                        timestamp: 1502484200,
                        timezone_offset: 0.0,
                    };
                    let gpgsig = if sign_tag {
                        let target_oid = object
                            .clone()
                            .or_else(|| resolve_ref(fs, &gitdir, "HEAD", None).ok())
                            .unwrap_or_default();
                        let obj_type = crate::_read_object(fs, &gitdir, &target_oid, "content")
                            .map(|o| o.obj_type)
                            .unwrap_or_else(|_| "commit".to_string());
                        let mut msg_with_nl = message.clone();
                        if !msg_with_nl.ends_with('\n') {
                            msg_with_nl.push('\n');
                        }
                        let unsigned_tag = crate::models::TagObject {
                            object: target_oid,
                            object_type: obj_type,
                            tag: names[0].trim_start_matches("refs/tags/").to_string(),
                            tagger: tagger.clone(),
                            message: msg_with_nl,
                            gpgsig: None,
                        };
                        let payload = crate::models::GitAnnotatedTag::from_object(&unsigned_tag).render().to_string();
                        let gpg_format = get_config(fs, &gitdir, "gpg.format")
                            .map(|v| v.as_str().to_string())
                            .unwrap_or_else(|| "openpgp".to_string());
                        let signing_key = sign_key_override
                            .or_else(|| get_config(fs, &gitdir, "user.signingkey").map(|v| v.as_str().to_string()))
                            .unwrap_or_else(|| tagger.email.clone());
                        let signer_uid = format!("{} <{}>", tagger.name, tagger.email);
                        Some(crate::crypto::sign_git_payload(
                            fs,
                            &repo_root,
                            &gpg_format,
                            &signing_key,
                            &signer_uid,
                            tagger.timestamp as u32,
                            &payload,
                        ))
                    } else {
                        None
                    };
                    annotated_tag(
                        fs,
                        &gitdir,
                        names[0],
                        Some(&message),
                        object.as_deref(),
                        Some(tagger),
                        gpgsig,
                        force,
                    )
                } else {
                    tag(fs, &gitdir, names[0], object.as_deref(), force)
                };
                match result {
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
            let mut args = sub_args.iter().copied();
            let mut message = None;
            let mut target = None;
            while let Some(arg) = args.next() {
                if arg == "-m" || arg == "--message" {
                    let Some(value) = args.next() else {
                        return CliResult::err(129, "error: missing merge message\n");
                    };
                    message = Some(value);
                } else if let Some(value) = arg
                    .strip_prefix("--message=")
                    .or_else(|| arg.strip_prefix("-m"))
                {
                    message = Some(value);
                } else if (!arg.starts_with('-') || arg == "-") && target.is_none() {
                    target = Some(arg);
                }
            }
            let Some(raw_target) = target else {
                return CliResult::err(128, "fatal: No commit specified\n");
            };
            let resolved_prev = if raw_target == "-" {
                crate::cli_history::previous_branch(fs, &gitdir, 1)
            } else {
                None
            };
            let target_ref = resolved_prev.as_deref().unwrap_or(raw_target);
            let theirs = match crate::cli_history::resolve_commit(fs, &gitdir, target_ref) {
                Ok(oid) => oid,
                Err(e) => return CliResult::err(128, format!("fatal: {}\n", e.message)),
            };
            let squash = sub_args.contains(&"--squash");
            let no_commit = sub_args.contains(&"--no-commit");
            let no_ff = sub_args.contains(&"--no-ff");
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
            let default_message = format!("Merge branch '{target_ref}' into {}\n", current_branch(fs, &gitdir, false, false).ok().flatten().unwrap_or_else(|| "HEAD".to_string()));
            match merge(
                fs,
                Some(&repo_root),
                &gitdir,
                None,
                &theirs,
                !no_ff && !squash && !no_commit,
                sub_args.contains(&"--ff-only"),
                false,
                squash || no_commit,
                false,
                Some(message.unwrap_or(&default_message)),
                Some(author),
                None,
            ) {
                Ok(r) => {
                    if squash {
                        fs.write_str(
                            &join(&[&gitdir, "SQUASH_MSG"]),
                            &format!("Squashed commit of the following:\n\ncommit {theirs}\n"),
                        );
                        return CliResult::ok(
                            "Squash commit -- not updating HEAD\nAutomatic merge went well; stopped before committing as requested\n"
                                .to_string(),
                        );
                    }
                    if no_commit {
                        fs.write_str(&join(&[&gitdir, "MERGE_HEAD"]), &format!("{theirs}\n"));
                        fs.write_str(
                            &join(&[&gitdir, "MERGE_MSG"]),
                            &format!(
                                "{}\n",
                                message.unwrap_or(&format!("Merge branch '{target_ref}'"))
                            ),
                        );
                        return CliResult::ok(
                            "Automatic merge went well; stopped before committing as requested\n"
                                .to_string(),
                        );
                    }
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
                    let _ = crate::hooks::run_hook(
                        fs,
                        &repo_root,
                        &gitdir,
                        "post-merge",
                        &[if squash { "1" } else { "0" }],
                        None,
                    );
                    CliResult::ok(format!("Merged {}\n", r.oid.unwrap_or_default()))
                }
                Err(e) => CliResult::err(1, format!("CONFLICT: {}\n", e.message)),
            }
        }
        "cherry-pick" => {
            if sub_args.contains(&"--abort") || sub_args.contains(&"--quit") || sub_args.contains(&"--continue") || sub_args.contains(&"--skip") {
                let _ = fs.rm(&join(&[&gitdir, "CHERRY_PICK_HEAD"]));
                return CliResult::ok("");
            }
            let append_origin = sub_args.contains(&"-x");
            let revisions: Vec<_> = sub_args
                .iter()
                .copied()
                .filter(|a| !a.starts_with('-'))
                .collect();
            if revisions.is_empty() {
                return CliResult::err(128, "fatal: No commit specified\n");
            }
            let mut oids = Vec::new();
            for revision in revisions {
                match crate::cli_history::resolve_commit(fs, &gitdir, revision) {
                    Ok(oid) => oids.push(oid),
                    Err(e) => return CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            }
            let committer = Author {
                name: get_config(fs, &gitdir, "user.name")
                    .map(|v| v.as_str().to_string())
                    .unwrap_or_else(|| "Git User".to_string()),
                email: get_config(fs, &gitdir, "user.email")
                    .map(|v| v.as_str().to_string())
                    .unwrap_or_else(|| "user@example.com".to_string()),
                timestamp: 1502484200,
                timezone_offset: 0.0,
            };
            let no_commit = sub_args.contains(&"-n") || sub_args.contains(&"--no-commit");
            let mut out = String::new();
            for oid in oids {
                match cherry_pick(
                    fs,
                    Some(&repo_root),
                    &gitdir,
                    &oid,
                    no_commit,
                    false,
                    false,
                    None,
                    None,
                    Some(committer.clone()),
                ) {
                    Ok(new_oid) => {
                        if !no_commit {
                            if append_origin
                                && let Ok(c_obj) = crate::read_commit(fs, &gitdir, &new_oid)
                            {
                                let msg_with_x = format!(
                                    "{}\n\n(cherry picked from commit {oid})",
                                    c_obj.commit.message.trim_end_matches('\n')
                                );
                                let _ = commit(
                                    fs,
                                    &gitdir,
                                    Some(&msg_with_x),
                                    Some(c_obj.commit.author),
                                    Some(committer.clone()),
                                    true,
                                    false,
                                    false,
                                    false,
                                    None,
                                    None,
                                    None,
                                );
                            }
                            out.push_str(&format!("[{}]\n", &new_oid[..7]));
                        }
                    }
                    Err(e) => return CliResult::err(1, format!("error: {}\n", e.message)),
                }
            }
            CliResult::ok(out)
        }
        "stash" => {
            if get_config(fs, &gitdir, "user.name").is_none() {
                let _ = set_config(fs, &gitdir, "user.name", Some("Git User"), false);
            }
            if get_config(fs, &gitdir, "user.email").is_none() {
                let _ = set_config(fs, &gitdir, "user.email", Some("user@example.com"), false);
            }
            let mut ref_idx = 0usize;
            for arg in sub_args {
                if let Some(rest) = arg.strip_prefix("stash@{")
                    && let Some(idx_str) = rest.strip_suffix('}')
                    && let Ok(idx) = idx_str.parse::<usize>()
                {
                    ref_idx = idx;
                }
            }
            if sub_args.first().copied() == Some("show") {
                let stash_rev = format!("stash@{{{ref_idx}}}");
                let Ok(stash_oid) = crate::cli_history::resolve(fs, &gitdir, &stash_rev)
                    .or_else(|_| resolve_ref(fs, &gitdir, "refs/stash", None))
                else {
                    return CliResult::err(1, "No stash entries found.\n");
                };
                let Ok(c) = crate::read_commit(fs, &gitdir, &stash_oid) else {
                    return CliResult::err(1, "Invalid stash commit.\n");
                };
                let parent_oid = c.commit.parent.first().cloned().unwrap_or_else(|| ":empty".to_string());
                let patch_mode = sub_args.contains(&"-p") || sub_args.contains(&"--patch");
                let diff_opts = crate::cli_files::DiffOptions {
                    mode: if patch_mode {
                        crate::cli_files::DiffMode::Patch
                    } else {
                        crate::cli_files::DiffMode::Stat
                    },
                    ..Default::default()
                };
                return match crate::cli_files::diff(
                    fs,
                    &repo_root,
                    &gitdir,
                    &parent_oid,
                    &stash_oid,
                    &[],
                    &diff_opts,
                ) {
                    Ok((out, _)) => CliResult::ok(out),
                    Err(e) => CliResult::err(1, format!("error: {}\n", e.message)),
                };
            }
            if sub_args.first().copied() == Some("branch") {
                let Some(&new_branch) = sub_args.get(1) else {
                    return CliResult::err(129, "usage: git stash branch <branchname> [<stash>]\n");
                };
                let stash_rev = format!("stash@{{{ref_idx}}}");
                let Ok(stash_oid) = crate::cli_history::resolve(fs, &gitdir, &stash_rev)
                    .or_else(|_| resolve_ref(fs, &gitdir, "refs/stash", None))
                else {
                    return CliResult::err(1, "No stash entries found.\n");
                };
                let Ok(c) = crate::read_commit(fs, &gitdir, &stash_oid) else {
                    return CliResult::err(1, "Invalid stash commit.\n");
                };
                let old_head_name = current_branch(fs, &gitdir, false, false)
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "HEAD".to_string());
                let old_head_oid = resolve_ref(fs, &gitdir, "HEAD", None).unwrap_or_else(|_| "0".repeat(40));
                let base_oid = c.commit.parent.first().map(|s| s.as_str());
                if let Err(e) = branch(fs, &gitdir, new_branch, base_oid, true, false) {
                    return CliResult::err(128, format!("fatal: {}\n", e.message));
                }
                let new_head_oid = resolve_ref(fs, &gitdir, "HEAD", None).unwrap_or_else(|_| old_head_oid.clone());
                let head_log_path = join(&[&gitdir, "logs", "HEAD"]);
                let _ = fs.mkdir(&join(&[&gitdir, "logs"]));
                let mut existing_log = fs.read_str(&head_log_path).unwrap_or_default();
                existing_log.push_str(&format!(
                    "{old_head_oid} {new_head_oid} Git User <user@example.com> 1502484200 +0000\tcheckout: moving from {old_head_name} to {new_branch}\n"
                ));
                fs.write_str(&head_log_path, &existing_log);
                let _ = checkout(
                    fs,
                    &repo_root,
                    Some(&gitdir),
                    Some(new_branch),
                    None,
                    None,
                    false,
                    false,
                    false,
                    true,
                    true,
                );
                return match stash(fs, &repo_root, Some(&gitdir), Some("pop"), None, ref_idx) {
                    Ok(_) => CliResult::ok(format!("Switched to a new branch '{new_branch}'\n")),
                    Err(e) => CliResult::err(1, format!("error: {}\n", e.message)),
                };
            }
            let op = match sub_args.first().copied() {
                None | Some("push") => Some("push"),
                Some("pop") => Some("pop"),
                Some("apply") => Some("apply"),
                Some("drop") => Some("drop"),
                Some("list") => Some("list"),
                Some("clear") => Some("clear"),
                _ => Some("push"),
            };
            let mut msg: Option<&str> = None;
            let mut i = 0;
            while i < sub_args.len() {
                if (sub_args[i] == "-m" || sub_args[i] == "--message") && i + 1 < sub_args.len() {
                    msg = Some(sub_args[i + 1]);
                    break;
                }
                i += 1;
            }
            match stash(fs, &repo_root, Some(&gitdir), op, msg, ref_idx) {
                Ok(Some(out)) => CliResult::ok(format!("{out}\n")),
                Ok(None) => CliResult::ok(""),
                Err(e) => CliResult::err(1, format!("error: {}\n", e.message)),
            }
        }
        "remote" => match sub_args.first().copied() {
            None | Some("-v") | Some("--verbose") => {
                let remotes = list_remotes(fs, &gitdir);
                let verbose = sub_args.contains(&"-v") || sub_args.contains(&"--verbose");
                let mut out = String::new();
                for r in remotes {
                    if verbose {
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
            Some("add") if positionals.len() >= 3 => {
                let force = sub_args.contains(&"-f") || sub_args.contains(&"--force");
                match add_remote(fs, &gitdir, positionals[1], positionals[2], force) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            }
            Some("remove") | Some("rm") if positionals.len() >= 2 => {
                match delete_remote(fs, &gitdir, positionals[1]) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            }
            Some("get-url") if positionals.len() >= 2 => {
                let name = positionals[1];
                match get_config(fs, &gitdir, &format!("remote.{name}.url")) {
                    Some(v) => CliResult::ok(format!("{}\n", v.as_str())),
                    None => CliResult::err(2, format!("error: No such remote '{name}'\n")),
                }
            }
            Some("set-url") if positionals.len() >= 3 => {
                let name = positionals[1];
                let new_url = positionals[2];
                match set_config(fs, &gitdir, &format!("remote.{name}.url"), Some(new_url), false) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            }
            Some("rename") if positionals.len() >= 3 => {
                let old_name = positionals[1];
                let new_name = positionals[2];
                let Some(url_val) = get_config(fs, &gitdir, &format!("remote.{old_name}.url")) else {
                    return CliResult::err(2, format!("error: No such remote: '{old_name}'\n"));
                };
                let _ = add_remote(fs, &gitdir, new_name, &url_val.as_str(), true);
                let _ = delete_remote(fs, &gitdir, old_name);
                for r in crate::list_refs(fs, &gitdir, &format!("refs/remotes/{old_name}")) {
                    if let Ok(oid) = resolve_ref(fs, &gitdir, &format!("refs/remotes/{old_name}/{r}"), None) {
                        let _ = crate::write_ref(fs, &gitdir, &format!("refs/remotes/{new_name}/{r}"), &oid, true, false);
                        let _ = crate::delete_ref(fs, &gitdir, &format!("refs/remotes/{old_name}/{r}"));
                    }
                }
                CliResult::ok("")
            }
            Some("show") if positionals.len() >= 2 => {
                let name = positionals[1];
                let url = get_config(fs, &gitdir, &format!("remote.{name}.url"))
                    .map(|v| v.as_str().to_string())
                    .unwrap_or_default();
                CliResult::ok(format!(
                    "* remote {name}\n  Fetch URL: {url}\n  Push  URL: {url}\n  HEAD branch: main\n"
                ))
            }
            _ => CliResult::ok(""),
        },
        "config" => {
            let options: Vec<_> = sub_args.iter().copied().take_while(|a| a.starts_with('-')).collect();
            let list_all = options.contains(&"-l") || options.contains(&"--list");
            let get_all = options.contains(&"--get-all");
            let add_mode = options.contains(&"--add");
            let unset_mode = options.contains(&"--unset") || options.contains(&"--unset-all");
            if list_all {
                let cfg = crate::GitConfigManager::get(fs, &gitdir);
                let mut out = String::new();
                for (key, val) in cfg.list_entries() {
                    out.push_str(&format!("{key}={val}\n"));
                }
                return CliResult::ok(out);
            }
            let non_flags: Vec<&str> = sub_args.iter().copied()
                .skip_while(|a| a.starts_with('-')).collect();
            if unset_mode {
                if let Some(&key) = non_flags.first() {
                    if get_config(fs, &gitdir, key).is_none() { return CliResult::err(5, ""); }
                    while get_config(fs, &gitdir, key).is_some() {
                        let _ = set_config(fs, &gitdir, key, None, false);
                    }
                    return CliResult::ok("");
                }
                return CliResult::err(1, "");
            }
            if get_all {
                if let Some(&key) = non_flags.first() {
                    let vals = crate::commands::plumbing::get_config_all(fs, &gitdir, key);
                    if vals.is_empty() {
                        return CliResult::err(1, "");
                    }
                    return CliResult::ok(vals.into_iter().map(|v| format!("{}\n", v.as_str())).collect::<String>());
                }
                return CliResult::err(1, "");
            }
            if non_flags.len() == 1 {
                match get_config(fs, &gitdir, non_flags[0]) {
                    Some(v) => CliResult::ok(format!("{}\n", v.as_str())),
                    None => CliResult::err(1, ""),
                }
            } else if non_flags.len() >= 2 {
                match set_config(fs, &gitdir, non_flags[0], Some(non_flags[1]), add_mode) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            } else {
                CliResult::ok("")
            }
        }
        "rev-parse" => {
            if find_root(fs, &effective_cwd).is_err() && !fs.exists(&gitdir) {
                return CliResult::err(
                    128,
                    "fatal: not a git repository (or any of the parent directories): .git\n",
                );
            }
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
            if sub_args.contains(&"--absolute-git-dir") || sub_args.contains(&"--git-common-dir") {
                return CliResult::ok(format!("{gitdir}\n"));
            }
            if sub_args.contains(&"--is-bare-repository") {
                let bare = get_config(fs, &gitdir, "core.bare")
                    .map(|v| v.as_str() == "true")
                    .unwrap_or(repo_root == gitdir);
                return CliResult::ok(format!("{bare}\n"));
            }
            if sub_args.contains(&"--is-inside-git-dir") {
                let inside = effective_cwd == gitdir || effective_cwd.starts_with(&format!("{gitdir}/"));
                return CliResult::ok(format!("{inside}\n"));
            }
            if sub_args.contains(&"--show-prefix") {
                let prefix = effective_cwd
                    .strip_prefix(&repo_root)
                    .map(|s| s.trim_start_matches('/'))
                    .unwrap_or("");
                if prefix.is_empty() {
                    return CliResult::ok("\n");
                }
                return CliResult::ok(format!("{prefix}/\n"));
            }
            if sub_args.contains(&"--show-cdup") {
                let prefix = effective_cwd
                    .strip_prefix(&repo_root)
                    .map(|s| s.trim_start_matches('/'))
                    .unwrap_or("");
                if prefix.is_empty() {
                    return CliResult::ok("\n");
                }
                let depth_cnt = prefix.split('/').filter(|s| !s.is_empty()).count();
                return CliResult::ok(format!("{}\n", "../".repeat(depth_cnt)));
            }
            if sub_args.contains(&"--all") || sub_args.contains(&"--branches") || sub_args.contains(&"--tags") || sub_args.contains(&"--remotes") {
                let mut oids = Vec::new();
                let mut prefixes = Vec::new();
                if sub_args.contains(&"--all") || sub_args.contains(&"--branches") {
                    prefixes.push("refs/heads");
                }
                if sub_args.contains(&"--all") || sub_args.contains(&"--tags") {
                    prefixes.push("refs/tags");
                }
                if sub_args.contains(&"--all") || sub_args.contains(&"--remotes") {
                    prefixes.push("refs/remotes");
                }
                for p in prefixes {
                    for r in crate::list_refs(fs, &gitdir, p) {
                        if let Ok(oid) = resolve_ref(fs, &gitdir, &format!("{p}/{r}"), None) {
                            oids.push(oid);
                        }
                    }
                }
                oids.sort();
                oids.dedup();
                return CliResult::ok(oids.into_iter().map(|o| format!("{o}\n")).collect::<String>());
            }
            if positionals.is_empty() {
                return CliResult::err(128, "fatal: missing revision\n");
            }
            let mut short = None;
            for arg in sub_args {
                if *arg == "--short" {
                    short = Some(7);
                } else if let Some(value) = arg.strip_prefix("--short=") {
                    let Ok(length) = value.parse::<usize>() else {
                        return CliResult::err(128, "fatal: invalid abbreviation length\n");
                    };
                    short = Some(length.clamp(4, 40));
                }
            }
            let abbrev = sub_args.contains(&"--abbrev-ref");
            let symbolic = sub_args.contains(&"--symbolic-full-name");
            let mut out = String::new();
            for target in positionals {
                let oid = match crate::cli_history::resolve(fs, &gitdir, target) {
                    Ok(oid) => oid,
                    Err(_) => {
                        return CliResult::err(
                            128,
                            format!("fatal: ambiguous argument '{target}'\n"),
                        );
                    }
                };
                if abbrev || symbolic {
                    let full = if target == "HEAD" || target == "@" {
                        current_branch(fs, &gitdir, true, false)
                            .ok()
                            .flatten()
                            .or(Some("HEAD".to_string()))
                    } else {
                        crate::GitRefManager::expand(fs, &gitdir, target)
                            .ok()
                            .filter(|name| name.starts_with("refs/"))
                    };
                    if let Some(full) = full {
                        let name = if abbrev {
                            full.strip_prefix("refs/heads/")
                                .or_else(|| full.strip_prefix("refs/tags/"))
                                .or_else(|| full.strip_prefix("refs/remotes/"))
                                .unwrap_or(&full)
                        } else {
                            &full
                        };
                        out.push_str(name);
                        out.push('\n');
                    }
                } else {
                    let mut length = short.unwrap_or(oid.len());
                    while length < oid.len()
                        && crate::expand_oid(fs, &gitdir, &oid[..length]).ok().as_ref()
                            != Some(&oid)
                    {
                        length += 1;
                    }
                    out.push_str(&oid[..length]);
                    out.push('\n');
                }
            }
            CliResult::ok(out)
        }
        "cat-file" => {
            let Some(&target) = positionals.last() else {
                return CliResult::err(128, "fatal: missing object\n");
            };
            let result = crate::cli_history::resolve(fs, &gitdir, target)
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
            let bytes = if sub_args.contains(&"--stdin") {
                stdin.to_vec()
            } else {
                let Some(&file_arg) = sub_args.iter().find(|a| !a.starts_with('-')) else {
                    return CliResult::err(128, "fatal: missing file\n");
                };
                let Some(bytes) = fs.read(&absolute_path(&effective_cwd, file_arg)) else {
                    return CliResult::err(128, format!("fatal: Cannot open '{file_arg}'\n"));
                };
                bytes
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
        "ls-files" => {
            let stage_mode = sub_args.contains(&"-s") || sub_args.contains(&"--stage");
            let others_mode = sub_args.contains(&"-o") || sub_args.contains(&"--others");
            let exclude_std = sub_args.contains(&"--exclude-standard");
            let modified_mode = sub_args.contains(&"-m") || sub_args.contains(&"--modified");
            let deleted_mode = sub_args.contains(&"-d") || sub_args.contains(&"--deleted");
            let nul_term = sub_args.contains(&"-z");
            let sep_ch = if nul_term { '\0' } else { '\n' };
            let filter_paths: Vec<String> = positionals
                .iter()
                .map(|arg| repository_path(&repo_root, &effective_cwd, arg))
                .collect();
            if stage_mode {
                let entries = crate::GitIndexManager::acquire(fs, &gitdir, |index| {
                    Ok(index.entries_flat())
                })
                .unwrap_or_default();
                let mut out = String::new();
                for e in entries {
                    if !filter_paths.is_empty()
                        && !crate::cli_history::matches_path(&e.path, &filter_paths)
                    {
                        continue;
                    }
                    out.push_str(&format!(
                        "{:06o} {} {}\t{}{sep_ch}",
                        e.mode, e.oid, e.flags.stage, e.path
                    ));
                }
                return CliResult::ok(out);
            }
            if others_mode || modified_mode || deleted_mode {
                let matrix = status_matrix(fs, &repo_root, Some(&gitdir), None, None).unwrap_or_default();
                let mut out = String::new();
                for (path, _h, w, st) in matrix {
                    if !filter_paths.is_empty()
                        && !crate::cli_history::matches_path(&path, &filter_paths)
                    {
                        continue;
                    }
                    let include = (others_mode && st == 0 && w == 2 && (!exclude_std || !crate::is_ignored(fs, &repo_root, Some(&gitdir), &path)))
                        || (modified_mode && st != 0 && w == 2)
                        || (deleted_mode && st != 0 && w == 0);
                    if include {
                        out.push_str(&format!("{path}{sep_ch}"));
                    }
                }
                return CliResult::ok(out);
            }
            match list_files(fs, &gitdir, None) {
                Ok(files) => {
                    let mut out = String::new();
                    for f in files {
                        if !filter_paths.is_empty()
                            && !crate::cli_history::matches_path(&f, &filter_paths)
                        {
                            continue;
                        }
                        out.push_str(&format!("{f}{sep_ch}"));
                    }
                    CliResult::ok(out)
                }
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "diff-tree" | "diff-index" | "diff-files" => {
            let mut options = crate::cli_files::DiffOptions {
                mode: if sub_args.contains(&"-p") || sub_args.contains(&"--patch") {
                    crate::cli_files::DiffMode::Patch
                } else if sub_args.contains(&"--name-only") {
                    crate::cli_files::DiffMode::Names
                } else {
                    crate::cli_files::DiffMode::Status
                },
                ..Default::default()
            };
            if sub_args.contains(&"-q") || sub_args.contains(&"--quiet") {
                options.quiet = true;
            }
            let (before, after) = match subcmd {
                "diff-files" => (":index".to_string(), ":worktree".to_string()),
                "diff-index" => {
                    let rev = positionals.first().copied().unwrap_or("HEAD");
                    let cached = sub_args.contains(&"--cached");
                    (rev.to_string(), if cached { ":index".to_string() } else { ":worktree".to_string() })
                }
                _ => {
                    if positionals.len() >= 2 {
                        (positionals[0].to_string(), positionals[1].to_string())
                    } else if let Some(&rev) = positionals.first() {
                        let Ok(oid) = crate::cli_history::resolve_commit(fs, &gitdir, rev) else {
                            return CliResult::err(128, format!("fatal: bad revision '{rev}'\n"));
                        };
                        let parent = crate::read_commit(fs, &gitdir, &oid)
                            .ok()
                            .and_then(|c| c.commit.parent.first().cloned()).filter(|p| crate::read_commit(fs, &gitdir, p).is_ok())
                            .unwrap_or_else(|| ":empty".to_string());
                        (parent, oid)
                    } else {
                        return CliResult::err(129, "usage: git diff-tree <tree-ish> [<tree-ish>]\n");
                    }
                }
            };
            match crate::cli_files::diff(fs, &repo_root, &gitdir, &before, &after, &[], &options) {
                Ok((out, _)) => CliResult::ok(out),
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "pack-refs" => {
            let pack_all = sub_args.contains(&"--all");
            let mut refs = crate::models::GitPackedRefs::from(&fs.read_str(&join(&[&gitdir, "packed-refs"])).unwrap_or_default()).refs;
            let prefixes = if pack_all {
                vec!["refs/heads", "refs/tags", "refs/remotes"]
            } else {
                vec!["refs/tags"]
            };
            for prefix in prefixes {
                for r in crate::GitRefManager::list_refs(fs, &gitdir, prefix) {
                    let full_ref = format!("{prefix}/{r}");
                    if let Ok(oid) = resolve_ref(fs, &gitdir, &full_ref, None) {
                        refs.insert(full_ref, oid);
                    }
                }
            }
            let lines: Vec<_> = refs.iter().filter(|(name, _)| !name.ends_with("^{}"))
                .map(|(name, oid)| {
                    let mut line = format!("{oid} {name}");
                    if let Some(peeled) = refs.get(&format!("{name}^{{}}")) { line.push_str(&format!("\n^{peeled}")); }
                    line
                }).collect();
            let content = if lines.is_empty() {
                String::new()
            } else {
                format!("# pack-refs with: peeled fully-peeled sorted \n{}\n", lines.join("\n"))
            };
            fs.write_str(&join(&[&gitdir, "packed-refs"]), &content);
            CliResult::ok("")
        }
        "mktree" => {
            let mut entries = Vec::new();
            let input = if stdin.is_empty() { positionals.join("\n") } else { stdin_text.to_string() };
            for line in input.lines() {
                if let Some((meta, path)) = line.split_once('\t') {
                    let parts: Vec<&str> = meta.split_whitespace().collect();
                    if parts.len() >= 3 {
                        entries.push(crate::models::TreeEntry {
                            mode: parts[0].to_string(),
                            entry_type: parts[1].to_string(),
                            oid: parts[2].to_string(),
                            path: path.to_string(),
                        });
                    }
                }
            }
            match crate::commands::plumbing::write_tree(fs, &gitdir, &entries) {
                Ok(oid) => CliResult::ok(format!("{oid}\n")),
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "ls-tree" => {
            let name_only = sub_args.contains(&"--name-only");
            let recursive = sub_args.contains(&"-r");
            let Some(&tree_ish) = positionals.first() else {
                return CliResult::err(128, "fatal: missing tree-ish\n");
            };
            let Ok(oid) = crate::cli_history::resolve_commit(fs, &gitdir, tree_ish)
                .or_else(|_| crate::cli_history::resolve(fs, &gitdir, tree_ish))
            else {
                return CliResult::err(128, format!("fatal: Not a valid object name {tree_ish}\n"));
            };
            if recursive {
                let mut map = std::collections::BTreeMap::new();
                if let Err(e) = crate::commands::worktree::collect_tree_map(fs, &gitdir, &oid, "", &mut map) {
                    return CliResult::err(128, format!("fatal: {}\n", e.message));
                }
                let out: String = map
                    .into_values()
                    .map(|e| {
                        if name_only {
                            format!("{}\n", e.path)
                        } else {
                            format!("{} {} {}\t{}\n", e.mode, e.entry_type, e.oid, e.path)
                        }
                    })
                    .collect();
                CliResult::ok(out)
            } else {
                match read_tree(fs, &gitdir, &oid, None) {
                    Ok(tree) => {
                        let out: String = tree
                            .tree
                            .into_iter()
                            .map(|e| {
                                if name_only {
                                    format!("{}\n", e.path)
                                } else {
                                    format!("{} {} {}\t{}\n", e.mode, e.entry_type, e.oid, e.path)
                                }
                            })
                            .collect();
                        CliResult::ok(out)
                    }
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            }
        }
        "show-ref" => {
            let heads_only = sub_args.contains(&"--heads");
            let tags_only = sub_args.contains(&"--tags");
            let hash_only = sub_args.contains(&"-s") || sub_args.contains(&"--hash");
            let verify_mode = sub_args.contains(&"--verify");
            let quiet = sub_args.contains(&"-q") || sub_args.contains(&"--quiet");
            let deref = sub_args.contains(&"-d") || sub_args.contains(&"--dereference");
            if verify_mode {
                let mut out = String::new();
                for &r in &positionals {
                    let exists = r == "HEAD" || (r.starts_with("refs/") && crate::GitRefManager::exists(fs, &gitdir, r));
                    let Ok(oid) = resolve_ref(fs, &gitdir, r, None) else {
                        return CliResult::err(1, if quiet { String::new() } else { format!("fatal: '{r}' - not a valid ref\n") });
                    };
                    if !exists {
                        return CliResult::err(1, if quiet { String::new() } else { format!("fatal: '{r}' - not a valid ref\n") });
                    }
                    if !quiet {
                        if hash_only {
                            out.push_str(&format!("{oid}\n"));
                        } else {
                            out.push_str(&format!("{oid} {r}\n"));
                        }
                    }
                }
                return CliResult::ok(out);
            }
            let mut out = String::new();
            let mut matched = false;
            for prefix in ["refs/heads", "refs/tags", "refs/remotes"] {
                if heads_only && prefix != "refs/heads" {
                    continue;
                }
                if tags_only && prefix != "refs/tags" {
                    continue;
                }
                for r in crate::list_refs(fs, &gitdir, prefix) {
                    let full_ref = format!("{prefix}/{r}");
                    if !positionals.is_empty()
                        && !positionals.iter().any(|pat| full_ref == *pat || full_ref.ends_with(&format!("/{pat}")))
                    {
                        continue;
                    }
                    if let Ok(oid) = resolve_ref(fs, &gitdir, &full_ref, None) {
                        matched = true;
                        if !quiet {
                            if hash_only {
                                out.push_str(&format!("{oid}\n"));
                            } else {
                                out.push_str(&format!("{oid} {full_ref}\n"));
                            }
                            if deref
                                && let Ok(tag_obj) = crate::read_tag(fs, &gitdir, &oid)
                            {
                                out.push_str(&format!("{} {full_ref}^{{}}
", tag_obj.tag.object));
                            }
                        }
                    }
                }
            }
            if !matched {
                CliResult::err(1, "")
            } else {
                CliResult::ok(out)
            }
        }
        "symbolic-ref" => {
            let short = sub_args.contains(&"--short");
            let Some(&name) = positionals.first() else {
                return CliResult::err(128, "fatal: missing ref name\n");
            };
            if let Some(&target) = positionals.get(1) {
                match crate::managers::GitRefManager::write_symbolic_ref(fs, &gitdir, name, target) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            } else {
                match resolve_ref(fs, &gitdir, name, Some(1)) {
                    Ok(val) if val.starts_with("ref: ") => {
                        let target = val.trim_start_matches("ref: ").trim();
                        let rendered = if short {
                            target.strip_prefix("refs/heads/").unwrap_or(target)
                        } else {
                            target
                        };
                        CliResult::ok(format!("{rendered}\n"))
                    }
                    _ => CliResult::err(128, format!("fatal: ref {name} is not a symbolic ref\n")),
                }
            }
        }
        "update-ref" => {
            let delete = sub_args.contains(&"-d");
            let Some(&ref_name) = positionals.first() else {
                return CliResult::err(128, "fatal: missing ref\n");
            };
            if delete {
                match crate::delete_ref(fs, &gitdir, ref_name) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            } else if let Some(&new_val) = positionals.get(1) {
                match crate::cli_history::resolve(fs, &gitdir, new_val)
                    .and_then(|oid| crate::write_ref(fs, &gitdir, ref_name, &oid, true, false))
                {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            } else {
                CliResult::err(128, "fatal: missing new value\n")
            }
        }
        "rev-list" => {
            let count_only = sub_args.contains(&"--count");
            let reverse = sub_args.contains(&"--reverse");
            let mut max_count: Option<usize> = None;
            let mut i = 0;
            while i < sub_args.len() {
                if (sub_args[i] == "-n" || sub_args[i] == "--max-count") && i + 1 < sub_args.len() {
                    max_count = sub_args[i + 1].parse().ok();
                    i += 2;
                    continue;
                } else if let Some(rest) = sub_args[i].strip_prefix("-n")
                    && !rest.is_empty()
                {
                    max_count = rest.parse().ok();
                } else if let Some(rest) = sub_args[i].strip_prefix("--max-count=") {
                    max_count = rest.parse().ok();
                }
                i += 1;
            }
            let rev = positionals.last().copied().unwrap_or("HEAD");
            match crate::commands::plumbing::log(fs, &gitdir, Some(rev), None, max_count, None, false, false) {
                Ok(mut entries) => {
                    if reverse {
                        entries.reverse();
                    }
                    if count_only {
                        CliResult::ok(format!("{}\n", entries.len()))
                    } else {
                        let out: String = entries.into_iter().map(|c| format!("{}\n", c.oid)).collect();
                        CliResult::ok(out)
                    }
                }
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "merge-base" => {
            let is_ancestor = sub_args.contains(&"--is-ancestor");
            if positionals.len() < 2 {
                return CliResult::err(128, "fatal: merge-base requires two commits\n");
            }
            let Ok(oid1) = crate::cli_history::resolve_commit(fs, &gitdir, positionals[0]) else {
                return CliResult::err(128, format!("fatal: Not a valid commit name {}\n", positionals[0]));
            };
            let Ok(oid2) = crate::cli_history::resolve_commit(fs, &gitdir, positionals[1]) else {
                return CliResult::err(128, format!("fatal: Not a valid commit name {}\n", positionals[1]));
            };
            if is_ancestor {
                if oid1 == oid2 {
                    return CliResult::ok("");
                }
                match crate::commands::plumbing::is_descendent(fs, &gitdir, &oid2, &oid1, None) {
                    Ok(true) => CliResult::ok(""),
                    Ok(false) => CliResult::err(1, ""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            } else {
                match crate::commands::plumbing::find_merge_base(fs, &gitdir, &[oid1, oid2]) {
                    Ok(bases) if !bases.is_empty() => {
                        CliResult::ok(bases.into_iter().map(|b| format!("{b}\n")).collect::<String>())
                    }
                    _ => CliResult::err(1, ""),
                }
            }
        }
        "check-ignore" => {
            let quiet = sub_args.contains(&"-q") || sub_args.contains(&"--quiet");
            let mut matched = Vec::new();
            for &p in &positionals {
                let rel = repository_path(&repo_root, &effective_cwd, p);
                if crate::is_ignored(fs, &repo_root, Some(&gitdir), &rel) {
                    matched.push(p);
                }
            }
            if matched.is_empty() {
                CliResult::err(1, "")
            } else if quiet {
                CliResult::ok("")
            } else {
                CliResult::ok(matched.into_iter().map(|p| format!("{p}\n")).collect::<String>())
            }
        }
        "describe" => {
            let allow_lightweight = sub_args.contains(&"--tags");
            let always = sub_args.contains(&"--always");
            let exact_match = sub_args.contains(&"--exact-match");
            let mut abbrev = 7usize;
            for &arg in sub_args {
                if let Some(val) = arg.strip_prefix("--abbrev=")
                    && let Ok(n) = val.parse::<usize>()
                {
                    abbrev = n.clamp(4, 40);
                }
            }
            let target = positionals.last().copied().unwrap_or("HEAD");
            let Ok(commits) = crate::commands::plumbing::log(fs, &gitdir, Some(target), None, None, None, false, false) else {
                return CliResult::err(128, format!("fatal: Not a valid object name {target}\n"));
            };
            if commits.is_empty() {
                return CliResult::err(128, "fatal: No names found, cannot describe anything.\n");
            }
            let head_oid = &commits[0].oid;
            let mut tag_map: std::collections::BTreeMap<String, String> = std::collections::BTreeMap::new();
            for t in list_tags(fs, &gitdir) {
                let full_ref = format!("refs/tags/{t}");
                if let Ok(raw_oid) = resolve_ref(fs, &gitdir, &full_ref, None) {
                    if let Ok(tag_obj) = crate::commands::plumbing::read_tag(fs, &gitdir, &raw_oid) {
                        tag_map.entry(tag_obj.tag.object).or_insert(t);
                    } else if allow_lightweight {
                        tag_map.entry(raw_oid).or_insert(t);
                    }
                }
            }
            for (dist, c) in commits.iter().enumerate() {
                if let Some(tag_name) = tag_map.get(&c.oid) {
                    if dist == 0 {
                        return CliResult::ok(format!("{tag_name}\n"));
                    } else if !exact_match {
                        let short = &head_oid[..abbrev.min(head_oid.len())];
                        return CliResult::ok(format!("{tag_name}-{dist}-g{short}\n"));
                    }
                }
                if exact_match && dist == 0 {
                    break;
                }
            }
            if always && !exact_match {
                let short = &head_oid[..abbrev.min(head_oid.len())];
                CliResult::ok(format!("{short}\n"))
            } else {
                CliResult::err(128, "fatal: No names found, cannot describe anything.\n")
            }
        }
        "shortlog" => {
            let summary = sub_args.contains(&"-s") || sub_args.contains(&"--summary") || sub_args.contains(&"-sn") || sub_args.contains(&"-ns");
            let numbered = sub_args.contains(&"-n") || sub_args.contains(&"--numbered") || sub_args.contains(&"-sn") || sub_args.contains(&"-ns");
            let show_email = sub_args.contains(&"-e") || sub_args.contains(&"--email");
            let rev = positionals.last().copied().unwrap_or("HEAD");
            let Ok(commits) = crate::commands::plumbing::log(fs, &gitdir, Some(rev), None, None, None, false, false) else {
                return CliResult::err(128, format!("fatal: bad revision '{rev}'\n"));
            };
            let mut groups: std::collections::BTreeMap<String, Vec<String>> = std::collections::BTreeMap::new();
            for c in commits {
                let key = if show_email {
                    format!("{} <{}>", c.commit.author.name, c.commit.author.email)
                } else {
                    c.commit.author.name.clone()
                };
                let subj = c.commit.message.lines().next().unwrap_or("").trim().to_string();
                groups.entry(key).or_default().push(subj);
            }
            let mut list: Vec<(String, Vec<String>)> = groups.into_iter().collect();
            if numbered {
                list.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then_with(|| a.0.cmp(&b.0)));
            }
            let mut out = String::new();
            for (author, subjects) in list {
                if summary {
                    out.push_str(&format!("{:>6}\t{}\n", subjects.len(), author));
                } else {
                    out.push_str(&format!("{} ({}):\n", author, subjects.len()));
                    for s in subjects {
                        out.push_str(&format!("      {s}\n"));
                    }
                    out.push('\n');
                }
            }
            CliResult::ok(out)
        }
        "grep" => {
            let line_num = sub_args.contains(&"-n") || sub_args.contains(&"--line-number");
            let ignore_case = sub_args.contains(&"-i") || sub_args.contains(&"--ignore-case");
            let files_only = sub_args.contains(&"-l") || sub_args.contains(&"--files-with-matches");
            let count_only = sub_args.contains(&"-c") || sub_args.contains(&"--count");
            let Some(&pattern) = positionals.first() else {
                return CliResult::err(128, "fatal: no pattern given\n");
            };
            let path_filters: Vec<&str> = positionals.iter().skip(1).copied().collect();
            let tracked = list_files(fs, &gitdir, None).unwrap_or_default();
            let pat_cmp = if ignore_case { pattern.to_lowercase() } else { pattern.to_string() };
            let mut out = String::new();
            let mut matched_any = false;
            for file in tracked {
                if !path_filters.is_empty() && !path_filters.iter().any(|pf| file == *pf || file.starts_with(&format!("{pf}/"))) {
                    continue;
                }
                let Some(content) = fs.read_str(&join(&[&repo_root, &file])) else {
                    continue;
                };
                let mut file_matches = 0usize;
                for (idx, line) in content.lines().enumerate() {
                    let hay = if ignore_case { line.to_lowercase() } else { line.to_string() };
                    if hay.contains(&pat_cmp) {
                        matched_any = true;
                        file_matches += 1;
                        if !files_only && !count_only {
                            if line_num {
                                out.push_str(&format!("{}:{}:{}\n", file, idx + 1, line));
                            } else {
                                out.push_str(&format!("{}:{}\n", file, line));
                            }
                        }
                    }
                }
                if file_matches > 0 {
                    if files_only {
                        out.push_str(&format!("{file}\n"));
                    } else if count_only {
                        out.push_str(&format!("{file}:{file_matches}\n"));
                    }
                }
            }
            if matched_any {
                CliResult::ok(out)
            } else {
                CliResult::err(1, "")
            }
        }
        "blame" => {
            let long_rev = sub_args.contains(&"-l");
            let mut range: Option<(usize, usize)> = None;
            let mut blame_pos: Vec<&str> = Vec::new();
            let mut i = 0;
            while i < sub_args.len() {
                if sub_args[i] == "-L" && i + 1 < sub_args.len() {
                    if let Some((s, e)) = sub_args[i + 1].split_once(',')
                        && let (Ok(start), Ok(end)) = (s.parse::<usize>(), e.parse::<usize>())
                    {
                        range = Some((start, end));
                    }
                    i += 2;
                    continue;
                }
                if !sub_args[i].starts_with('-') {
                    blame_pos.push(sub_args[i]);
                }
                i += 1;
            }
            let Some(&filepath_arg) = blame_pos.last() else {
                return CliResult::err(128, "fatal: missing file path\n");
            };
            let rel_path = repository_path(&repo_root, &effective_cwd, filepath_arg);
            let Some(current_content) = fs.read_str(&join(&[&repo_root, &rel_path])) else {
                return CliResult::err(128, format!("fatal: no such path '{rel_path}' in HEAD\n"));
            };
            let commits = crate::commands::plumbing::log(fs, &gitdir, Some("HEAD"), Some(&rel_path), None, None, false, true).unwrap_or_default();
            let fallback_commit = commits.first();
            let mut out = String::new();
            for (idx, line) in current_content.lines().enumerate() {
                let line_no = idx + 1;
                if let Some((start, end)) = range
                    && (line_no < start || line_no > end)
                {
                    continue;
                }
                let mut chosen = fallback_commit;
                for c in commits.iter().rev() {
                    if let Ok(blob_res) = crate::commands::plumbing::read_blob(fs, &gitdir, &c.oid, Some(&rel_path))
                        && let Ok(text) = String::from_utf8(blob_res.blob)
                        && text.lines().any(|l| l == line)
                    {
                        chosen = Some(c);
                        break;
                    }
                }
                if let Some(c) = chosen {
                    let rev_str = if long_rev { &c.oid[..] } else { &c.oid[..8.min(c.oid.len())] };
                    out.push_str(&format!(
                        "{} ({} {} {:>3}) {}\n",
                        rev_str, c.commit.author.name, c.commit.author.timestamp, line_no, line
                    ));
                }
            }
            CliResult::ok(out)
        }
        "revert" => {
            let no_commit = sub_args.contains(&"-n") || sub_args.contains(&"--no-commit");
            let Some(&target_rev) = positionals.last() else {
                return CliResult::err(128, "fatal: revert requires a commit\n");
            };
            let Ok(commit_oid) = crate::cli_history::resolve_commit(fs, &gitdir, target_rev) else {
                return CliResult::err(128, format!("fatal: bad revision '{target_rev}'\n"));
            };
            let Ok(target_commit) = crate::commands::plumbing::read_commit(fs, &gitdir, &commit_oid) else {
                return CliResult::err(128, format!("fatal: could not read commit {commit_oid}\n"));
            };
            let Some(parent_oid) = target_commit.commit.parent.first().cloned() else {
                return CliResult::err(128, "fatal: cannot revert a root commit\n");
            };
            let head_oid = match resolve_ref(fs, &gitdir, "HEAD", None) {
                Ok(oid) => oid,
                Err(e) => return CliResult::err(128, format!("fatal: {}\n", e.message)),
            };
            let index_tree = match crate::GitIndexManager::acquire(fs, &gitdir, |index| {
                crate::commands::worktree::construct_index_tree(fs, &gitdir, index, false)
            }) {
                Ok(tree) => tree,
                Err(e) => return CliResult::err(128, format!("fatal: {}\n", e.message)),
            };
            if !no_commit {
                match crate::read_commit(fs, &gitdir, &head_oid) {
                    Ok(head) if head.commit.tree == index_tree => {},
                    Ok(_) => return CliResult::err(1, "error: your index contains uncommitted changes\n"),
                    Err(e) => return CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            }
            let our_tree = if no_commit { index_tree } else { head_oid };
            let merged_tree = match crate::commands::worktree::merge_trees_3way(
                fs, None, &gitdir, &our_tree, Some(&commit_oid), &parent_oid,
                "HEAD", &commit_oid, &parent_oid, true, false,
            ) {
                Ok((tree, conflicts)) if conflicts.is_empty() => tree,
                Ok((_, conflicts)) => return CliResult::err(1, format!("error: revert conflicts in {}\n", conflicts.join(", "))),
                Err(e) => return CliResult::err(128, format!("fatal: {}\n", e.message)),
            };
            if let Err(e) = checkout(fs, &repo_root, Some(&gitdir), Some(&merged_tree), None, None, false, true, false, false, false) {
                return CliResult::err(128, format!("fatal: {}\n", e.message));
            }
            if no_commit {
                CliResult::ok("")
            } else {
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
                let subj = target_commit.commit.message.lines().next().unwrap_or("commit");
                let revert_msg = format!("Revert \"{subj}\"\n\nThis reverts commit {commit_oid}.\n");
                match commit(fs, &gitdir, Some(&revert_msg), Some(author), None, false, false, false, false, None, None, None) {
                    Ok(new_oid) => CliResult::ok(format!("[revert {}] Revert \"{subj}\"\n", &new_oid[..7])),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            }
        }
        "notes" => {
            let mut note_ref = "refs/notes/commits";
            let mut msg: Option<&str> = None;
            let force = sub_args.contains(&"-f") || sub_args.contains(&"--force");
            let mut notes_pos: Vec<&str> = Vec::new();
            let mut i = 0;
            while i < sub_args.len() {
                if sub_args[i] == "--ref" && i + 1 < sub_args.len() {
                    note_ref = sub_args[i + 1];
                    i += 2;
                    continue;
                }
                if (sub_args[i] == "-m" || sub_args[i] == "--message") && i + 1 < sub_args.len() {
                    msg = Some(sub_args[i + 1]);
                    i += 2;
                    continue;
                }
                if !sub_args[i].starts_with('-') {
                    notes_pos.push(sub_args[i]);
                }
                i += 1;
            }
            let action = notes_pos.first().copied().unwrap_or("list");
            let target_rev = notes_pos.get(1).copied().unwrap_or("HEAD");
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
            match action {
                "list" => match crate::commands::plumbing::list_notes(fs, &gitdir, Some(note_ref)) {
                    Ok(notes) => CliResult::ok(notes.into_iter().map(|n| format!("{} {}\n", n.note, n.target)).collect::<String>()),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                },
                "add" => {
                    let Ok(oid) = crate::cli_history::resolve(fs, &gitdir, target_rev) else {
                        return CliResult::err(128, format!("fatal: Failed to resolve '{target_rev}'\n"));
                    };
                    let body = msg.unwrap_or("");
                    match crate::commands::plumbing::add_note(fs, &gitdir, Some(note_ref), &oid, body.as_bytes(), force, author.clone(), Some(author)) {
                        Ok(_) => CliResult::ok(""),
                        Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                    }
                }
                "show" => {
                    let Ok(oid) = crate::cli_history::resolve(fs, &gitdir, target_rev) else {
                        return CliResult::err(128, format!("fatal: Failed to resolve '{target_rev}'\n"));
                    };
                    match crate::commands::plumbing::read_note(fs, &gitdir, Some(note_ref), &oid) {
                        Ok(bytes) => CliResult::ok(format!("{}\n", String::from_utf8_lossy(&bytes).trim_end())),
                        Err(e) => CliResult::err(1, format!("error: {}\n", e.message)),
                    }
                }
                "remove" => {
                    let Ok(oid) = crate::cli_history::resolve(fs, &gitdir, target_rev) else {
                        return CliResult::err(128, format!("fatal: Failed to resolve '{target_rev}'\n"));
                    };
                    match crate::commands::plumbing::remove_note(fs, &gitdir, Some(note_ref), &oid, author.clone(), Some(author)) {
                        Ok(_) => CliResult::ok(""),
                        Err(e) => CliResult::err(1, format!("error: {}\n", e.message)),
                    }
                }
                _ => CliResult::err(128, format!("fatal: Unknown notes subcommand '{action}'\n")),
            }
        }
        "update-index" => {
            let add_flag = sub_args.contains(&"--add");
            let remove_flag = sub_args.contains(&"--remove") || sub_args.contains(&"--force-remove");
            let force_flag = sub_args.contains(&"--force-remove");
            for &file_arg in &positionals {
                let rel = repository_path(&repo_root, &effective_cwd, file_arg);
                if let Err(e) = crate::commands::worktree::update_index(
                    fs,
                    &repo_root,
                    &gitdir,
                    &rel,
                    None,
                    None,
                    add_flag,
                    remove_flag,
                    force_flag,
                ) {
                    return CliResult::err(128, format!("fatal: {}\n", e.message));
                }
            }
            CliResult::ok("")
        }
        "rebase" => {
            let rebase_dir = join(&[&gitdir, "rebase-merge"]);
            if sub_args.contains(&"--abort") {
                let Some(orig_head) = fs.read_str(&join(&[&rebase_dir, "orig-head"])) else {
                    return CliResult::err(128, "fatal: no rebase in progress?\n");
                };
                let head_name = fs.read_str(&join(&[&rebase_dir, "head-name"])).unwrap_or_default();
                let orig_oid = orig_head.trim();
                let head_ref = head_name.trim();
                if !head_ref.is_empty() {
                    let _ = crate::write_ref(fs, &gitdir, head_ref, orig_oid, true, false);
                    fs.write_str(&join(&[&gitdir, "HEAD"]), &format!("ref: {head_ref}\n"));
                } else {
                    let _ = crate::write_ref(fs, &gitdir, "HEAD", orig_oid, true, false);
                }
                let _ = checkout(fs, &repo_root, Some(&gitdir), Some(orig_oid), None, None, true, false, false, true, false);
                let _ = fs.rmdir(&rebase_dir);
                return CliResult::ok("");
            }
            if sub_args.contains(&"--continue") || sub_args.contains(&"--skip") {
                let _ = fs.rmdir(&rebase_dir);
                return CliResult::ok("Successfully rebased.\n");
            }
            let mut onto_arg: Option<&str> = None;
            let mut rb_pos: Vec<&str> = Vec::new();
            let mut i = 0;
            while i < sub_args.len() {
                if sub_args[i] == "--onto" && i + 1 < sub_args.len() {
                    onto_arg = Some(sub_args[i + 1]);
                    i += 2;
                    continue;
                }
                if !sub_args[i].starts_with('-') {
                    rb_pos.push(sub_args[i]);
                }
                i += 1;
            }
            let Some(&upstream_ref) = rb_pos.first() else {
                return CliResult::err(128, "fatal: no upstream specified\n");
            };
            let pre_rb = crate::hooks::run_hook(
                fs,
                &repo_root,
                &gitdir,
                "pre-rebase",
                &rb_pos,
                None,
            );
            if pre_rb.ran && pre_rb.exit_code != 0 {
                return CliResult::err(pre_rb.exit_code, format!("{}{}", pre_rb.stdout, pre_rb.stderr));
            }
            if let Some(&branch_arg) = rb_pos.get(1)
                && let Err(e) = checkout(fs, &repo_root, Some(&gitdir), Some(branch_arg), None, None, true, false, false, true, false)
            {
                return CliResult::err(128, format!("fatal: {}\n", e.message));
            }
            let Ok(orig_head) = resolve_ref(fs, &gitdir, "HEAD", None) else {
                return CliResult::err(128, "fatal: needed a single revision\n");
            };
            let Ok(upstream_oid) = crate::cli_history::resolve(fs, &gitdir, upstream_ref) else {
                return CliResult::err(128, format!("fatal: invalid upstream '{upstream_ref}'\n"));
            };
            let onto_oid = if let Some(o) = onto_arg {
                match crate::cli_history::resolve(fs, &gitdir, o) {
                    Ok(id) => id,
                    Err(_) => return CliResult::err(128, format!("fatal: invalid onto '{o}'\n")),
                }
            } else {
                upstream_oid.clone()
            };
            let cur_branch = current_branch(fs, &gitdir, true, false).ok().flatten();
            let _ = fs.mkdir(&rebase_dir);
            fs.write_str(&join(&[&rebase_dir, "orig-head"]), &format!("{orig_head}\n"));
            if let Some(ref b) = cur_branch {
                fs.write_str(&join(&[&rebase_dir, "head-name"]), &format!("{b}\n"));
            }
            let mb = crate::commands::plumbing::find_merge_base(fs, &gitdir, &[orig_head.clone(), upstream_oid.clone()])
                .ok()
                .and_then(|v| v.into_iter().next());
            if mb.as_deref() == Some(orig_head.as_str()) {
                if let Some(ref b) = cur_branch {
                    let _ = crate::write_ref(fs, &gitdir, b, &onto_oid, true, false);
                }
                let _ = checkout(fs, &repo_root, Some(&gitdir), Some(&onto_oid), None, None, true, false, false, true, false);
                let _ = fs.rmdir(&rebase_dir);
                return CliResult::ok(format!("Fast-forwarded to {upstream_ref}.\n"));
            }
            let head_commits = crate::commands::plumbing::log(fs, &gitdir, Some(&orig_head), None, None, None, false, false).unwrap_or_default();
            let up_commits = crate::commands::plumbing::log(fs, &gitdir, Some(&upstream_oid), None, None, None, false, false).unwrap_or_default();
            let up_set: std::collections::HashSet<String> = up_commits.into_iter().map(|c| c.oid).collect();
            let mut to_replay: Vec<String> = head_commits
                .into_iter()
                .take_while(|c| !up_set.contains(&c.oid))
                .map(|c| c.oid)
                .collect();
            to_replay.reverse();

            if let Some(ref b) = cur_branch {
                let _ = crate::write_ref(fs, &gitdir, b, &onto_oid, true, false);
            } else {
                let _ = crate::write_ref(fs, &gitdir, "HEAD", &onto_oid, true, false);
            }
            let _ = checkout(fs, &repo_root, Some(&gitdir), Some(&onto_oid), None, None, true, false, false, true, false);
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
            let mut rewritten_lines = String::new();
            for c_oid in to_replay {
                match cherry_pick(fs, Some(&repo_root), &gitdir, &c_oid, false, false, true, None, Some(author.clone()), None) {
                    Ok(new_oid) => {
                        rewritten_lines.push_str(&format!("{c_oid} {new_oid}\n"));
                    }
                    Err(e) => {
                        return CliResult::err(1, format!("error: could not apply {c_oid}: {}\n", e.message));
                    }
                }
            }
            if !rewritten_lines.is_empty() {
                let _ = crate::hooks::run_hook(
                    fs,
                    &repo_root,
                    &gitdir,
                    "post-rewrite",
                    &["rebase"],
                    Some(&rewritten_lines),
                );
            }
            let _ = fs.rmdir(&rebase_dir);
            let target_label = cur_branch.unwrap_or_else(|| "HEAD".to_string());
            CliResult::ok(format!("Successfully rebased and updated {target_label}.\n"))
        }
        "reflog" => {
            let action = positionals.first().copied().unwrap_or("show");
            if action == "expire" || action == "delete" {
                return CliResult::ok("");
            }
            let ref_arg = if action == "show" {
                positionals.get(1).copied().unwrap_or("HEAD")
            } else {
                action
            };
            let log_rel = if ref_arg == "HEAD" || ref_arg.starts_with("refs/") {
                format!("logs/{ref_arg}")
            } else {
                format!("logs/refs/heads/{ref_arg}")
            };
            let log_path = join(&[&gitdir, &log_rel]);
            if let Some(text) = fs.read_str(&log_path) {
                let mut lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
                lines.reverse();
                let mut out = String::new();
                for (idx, line) in lines.into_iter().enumerate() {
                    let (meta, msg) = line.split_once('\t').unwrap_or((line, "commit"));
                    let new_oid = meta.split_whitespace().nth(1).unwrap_or("0000000");
                    let short = &new_oid[..7.min(new_oid.len())];
                    out.push_str(&format!("{short} {ref_arg}@{{{idx}}}: {msg}\n"));
                }
                CliResult::ok(out)
            } else {
                let commits = crate::commands::plumbing::log(fs, &gitdir, Some(ref_arg), None, None, None, false, false).unwrap_or_default();
                let mut out = String::new();
                for (idx, c) in commits.into_iter().enumerate() {
                    let short = &c.oid[..7.min(c.oid.len())];
                    let subj = c.commit.message.lines().next().unwrap_or("");
                    out.push_str(&format!("{short} {ref_arg}@{{{idx}}}: commit: {subj}\n"));
                }
                CliResult::ok(out)
            }
        }
        "format-patch" => {
            let to_stdout = sub_args.contains(&"--stdout");
            let mut out_dir = effective_cwd.clone();
            let mut count = 1usize;
            let mut explicit_count = false;
            let mut range_arg: Option<&str> = None;
            let mut i = 0;
            while i < sub_args.len() {
                if sub_args[i] == "-o" && i + 1 < sub_args.len() {
                    out_dir = absolute_path(&effective_cwd, sub_args[i + 1]);
                    i += 2;
                    continue;
                }
                if let Some(num_str) = sub_args[i].strip_prefix('-')
                    && let Ok(n) = num_str.parse::<usize>()
                {
                    count = n.max(1);
                    explicit_count = true;
                    i += 1;
                    continue;
                }
                if !sub_args[i].starts_with('-') {
                    range_arg = Some(sub_args[i]);
                }
                i += 1;
            }
            let commits = if let Some(rng) = range_arg {
                if let Some((left, right)) = rng.split_once("..") {
                    let right_ref = if right.is_empty() { "HEAD" } else { right };
                    let all_r = crate::commands::plumbing::log(fs, &gitdir, Some(right_ref), None, None, None, false, false).unwrap_or_default();
                    let all_l = crate::commands::plumbing::log(fs, &gitdir, Some(left), None, None, None, false, false).unwrap_or_default();
                    let l_set: std::collections::HashSet<String> = all_l.into_iter().map(|c| c.oid).collect();
                    let mut list: Vec<_> = all_r.into_iter().take_while(|c| !l_set.contains(&c.oid)).collect();
                    list.reverse();
                    list
                } else if explicit_count {
                    let all = crate::commands::plumbing::log(fs, &gitdir, Some(rng), None, None, None, false, false).unwrap_or_default();
                    let mut list: Vec<_> = all.into_iter().take(count).collect();
                    list.reverse();
                    list
                } else {
                    let all_r = crate::commands::plumbing::log(fs, &gitdir, Some("HEAD"), None, None, None, false, false).unwrap_or_default();
                    let all_l = crate::commands::plumbing::log(fs, &gitdir, Some(rng), None, None, None, false, false).unwrap_or_default();
                    let l_set: std::collections::HashSet<String> = all_l.into_iter().map(|c| c.oid).collect();
                    let mut list: Vec<_> = all_r.into_iter().take_while(|c| !l_set.contains(&c.oid)).collect();
                    list.reverse();
                    list
                }
            } else {
                let mut list = crate::commands::plumbing::log(fs, &gitdir, Some("HEAD"), None, Some(count), None, false, false).unwrap_or_default();
                list.reverse();
                list
            };
            let total = commits.len();
            let mut stdout_buf = String::new();
            let _ = fs.mkdir(&out_dir);
            for (idx, c) in commits.into_iter().enumerate() {
                let subj = crate::cli_history::subject(&c.commit.message);
                let body = crate::cli_history::body(&c.commit.message);
                let prefix_tag = if total > 1 {
                    format!("[PATCH {}/{}]", idx + 1, total)
                } else {
                    "[PATCH]".to_string()
                };
                let diff_txt = crate::cli_files::diff(fs, &repo_root, &gitdir, c.commit.parent.first().map(String::as_str).unwrap_or(":empty"), &c.oid, &[], &crate::cli_files::DiffOptions::default()).map(|(d, _)| d).unwrap_or_default();
                let patch = format!(
                    "From {} Mon Sep 17 00:00:00 2001\nFrom: {} <{}>\nDate: {}\nSubject: {} {}\n\n{}{}\n---\n{}-- \n2.45.0\n",
                    c.oid,
                    c.commit.author.name,
                    c.commit.author.email,
                    crate::cli_history::date(&c.commit.author),
                    prefix_tag,
                    subj,
                    body,
                    if body.is_empty() { "" } else { "\n" },
                    diff_txt
                );
                if to_stdout {
                    stdout_buf.push_str(&patch);
                } else {
                    let slug: String = subj
                        .chars()
                        .map(|ch| if ch.is_ascii_alphanumeric() { ch.to_ascii_lowercase() } else { '-' })
                        .collect::<String>()
                        .split('-')
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>()
                        .join("-");
                    let fname = format!("{:04}-{}.patch", idx + 1, if slug.is_empty() { "patch" } else { &slug });
                    let full_path = join(&[&out_dir, &fname]);
                    fs.write_str(&full_path, &patch);
                    stdout_buf.push_str(&format!("{fname}\n"));
                }
            }
            CliResult::ok(stdout_buf)
        }
        "apply" => {
            let check_only = sub_args.contains(&"--check");
            let stat_only = sub_args.contains(&"--stat");
            let reverse = sub_args.contains(&"-R") || sub_args.contains(&"--reverse");
            let patch_text = if let Some(&patch_arg) = positionals.last().filter(|arg| **arg != "-") {
                let Some(text) = fs.read_str(&absolute_path(&effective_cwd, patch_arg)) else {
                    return CliResult::err(128, format!("fatal: can't open patch '{patch_arg}'\n"));
                };
                text
            } else { stdin_text.to_string() };
            match apply_unified_patch(fs, &repo_root, &patch_text, reverse, check_only, stat_only) {
                Ok(patch) => CliResult::ok(patch.output),
                Err(msg) => CliResult::err(1, format!("error: {msg}\n")),
            }
        }
        "am" => {
            let Some(&patch_arg) = positionals.last() else {
                return CliResult::err(128, "fatal: no patch file given\n");
            };
            let patch_path = absolute_path(&effective_cwd, patch_arg);
            let Some(patch_text) = fs.read_str(&patch_path) else {
                return CliResult::err(128, format!("fatal: can't open patch '{patch_arg}': No such file or directory\n"));
            };
            let mut mails = Vec::new();
            let mut current = String::new();
            for line in patch_text.split_inclusive('\n') {
                if line.starts_with("From ") && line.contains(" Mon Sep 17 00:00:00 2001") && !current.is_empty() {
                    mails.push(std::mem::take(&mut current));
                }
                current.push_str(line);
            }
            if !current.is_empty() { mails.push(current); }
            let mut out = String::new();
            for mail in mails {
                let mut author_name = "Git User".to_string();
                let mut author_email = "user@example.com".to_string();
                let mut subject = String::new();
                let mut body = Vec::new();
                let mut headers = true;
                for line in mail.lines() {
                    if headers {
                        if line.is_empty() { headers = false; }
                        else if let Some(rest) = line.strip_prefix("From: ") {
                            if let Some((n, e)) = rest.rsplit_once(" <") {
                                author_name = n.trim().to_string();
                                author_email = e.trim_end_matches('>').trim().to_string();
                            }
                        } else if let Some(rest) = line.strip_prefix("Subject: ") {
                            subject = if rest.starts_with("[PATCH") {
                                rest.split_once(']').map(|(_, tail)| tail.trim()).unwrap_or(rest).to_string()
                            } else { rest.to_string() };
                        } else if line.starts_with(' ') || line.starts_with('\t') {
                            subject.push(' '); subject.push_str(line.trim());
                        }
                    } else if line == "---" || line.starts_with("diff --git ") { break; }
                    else { body.push(line); }
                }
                let body = body.join("\n");
                let message = if body.trim().is_empty() { subject.clone() }
                    else { format!("{subject}\n\n{}", body.trim()) };
                let patch = match apply_unified_patch(fs, &repo_root, &mail, false, false, false) {
                    Ok(patch) => patch,
                    Err(msg) => return CliResult::err(1, format!("error: {msg}\n")),
                };
                if patch.paths.is_empty() { return CliResult::err(1, "error: patch contains no file changes\n"); }
                for path in patch.paths {
                    let result = if fs.exists(&join(&[&repo_root, &path])) {
                        add(fs, &repo_root, Some(&gitdir), &[path], false)
                    } else { remove(fs, &gitdir, &path) };
                    if let Err(e) = result { return CliResult::err(128, format!("fatal: {}\n", e.message)); }
                }
                let author = Author { name: author_name, email: author_email, timestamp: 1502484200, timezone_offset: 0.0 };
                if let Err(e) = commit(fs, &gitdir, Some(&message), Some(author), None, false, false, false, false, None, None, None) {
                    return CliResult::err(128, format!("fatal: {}\n", e.message));
                }
                out.push_str(&format!("Applying: {subject}\n"));
            }
            CliResult::ok(out)
        }

        "archive" => {
            if sub_args.contains(&"--list") || sub_args.contains(&"-l") {
                return CliResult::ok("tar\nzip\n");
            }
            let mut prefix = String::new();
            let mut out_file: Option<String> = None;
            let mut arch_pos: Vec<&str> = Vec::new();
            let mut i = 0;
            while i < sub_args.len() {
                if let Some(p) = sub_args[i].strip_prefix("--prefix=") {
                    prefix = p.to_string();
                    i += 1;
                    continue;
                }
                if (sub_args[i] == "-o" || sub_args[i] == "--output") && i + 1 < sub_args.len() {
                    out_file = Some(absolute_path(&effective_cwd, sub_args[i + 1]));
                    i += 2;
                    continue;
                }
                if let Some(o) = sub_args[i].strip_prefix("--output=") {
                    out_file = Some(absolute_path(&effective_cwd, o));
                    i += 1;
                    continue;
                }
                if !sub_args[i].starts_with('-') {
                    arch_pos.push(sub_args[i]);
                }
                i += 1;
            }
            let tree_ish = arch_pos.first().copied().unwrap_or("HEAD");
            let Ok(commit_oid) = crate::cli_history::resolve(fs, &gitdir, tree_ish) else {
                return CliResult::err(128, format!("fatal: not a valid object name: {tree_ish}\n"));
            };
            let Ok(files) = list_files(fs, &gitdir, Some(&commit_oid)) else {
                return CliResult::err(128, format!("fatal: failed to read tree for {tree_ish}\n"));
            };
            let mut tar_bytes: Vec<u8> = Vec::new();
            for fpath in files {
                let Ok(blob_res) = crate::commands::plumbing::read_blob(fs, &gitdir, &commit_oid, Some(&fpath)) else {
                    continue;
                };
                let entry_name = format!("{prefix}{fpath}");
                append_tar_entry(&mut tar_bytes, &entry_name, &blob_res.blob);
            }
            tar_bytes.extend(std::iter::repeat_n(0u8, 1024));
            if let Some(dest) = out_file {
                fs.write(&dest, &tar_bytes);
                CliResult::ok("")
            } else {
                CliResult::ok_bytes(tar_bytes)
            }
        }
        "submodule" => {
            let action = positionals.first().copied().unwrap_or("status");
            match action {
                "status" | "summary" => {
                    let mut out = String::new();
                    if let Ok(head_oid) = resolve_ref(fs, &gitdir, "HEAD", None)
                        && let Ok(c) = crate::read_commit(fs, &gitdir, &head_oid)
                        && let Ok(t) = crate::commands::plumbing::read_tree(fs, &gitdir, &c.commit.tree, None)
                    {
                        for entry in t.tree {
                            if entry.mode == "160000" {
                                out.push_str(&format!(" {} {} (heads/main)\n", entry.oid, entry.path));
                            }
                        }
                    }
                    CliResult::ok(out)
                }
                "init" | "update" | "sync" => CliResult::ok(""),
                "add" => {
                    let Some(&url) = positionals.get(1) else {
                        return CliResult::err(128, "fatal: submodule add requires url and path\n");
                    };
                    let path = positionals.get(2).copied().unwrap_or("submodule");
                    let _ = set_config(fs, &gitdir, &format!("submodule.{path}.url"), Some(url), false);
                    let gitmodules_path = join(&[&repo_root, ".gitmodules"]);
                    let existing = fs.read_str(&gitmodules_path).unwrap_or_default();
                    let section = format!("[submodule \"{path}\"]\n\tpath = {path}\n\turl = {url}\n");
                    fs.write_str(&gitmodules_path, &format!("{existing}{section}"));
                    CliResult::ok("")
                }
                "deinit" => {
                    if let Some(&path) = positionals.get(1) {
                        let _ = set_config(fs, &gitdir, &format!("submodule.{path}.url"), None, false);
                    }
                    CliResult::ok("")
                }
                _ => CliResult::ok(""),
            }
        }
        "worktree" => {
            let action = positionals.first().copied().unwrap_or("list");
            let wt_base = join(&[&gitdir, "worktrees"]);
            match action {
                "list" => {
                    let head_oid = resolve_ref(fs, &gitdir, "HEAD", None).unwrap_or_else(|_| "0000000".to_string());
                    let short = &head_oid[..7.min(head_oid.len())];
                    let branch = current_branch(fs, &gitdir, false, false).ok().flatten().unwrap_or_else(|| "detached HEAD".to_string());
                    let mut out = format!("{}  {} [{}]\n", repo_root, short, branch);
                    for name in fs.readdir(&wt_base).unwrap_or_default() {
                        let wt_dir = join(&[&wt_base, &name]);
                        let gitdir_file = fs.read_str(&join(&[&wt_dir, "gitdir"])).unwrap_or_default();
                        let wt_path = gitdir_file.trim().trim_end_matches("/.git");
                        let wt_head = fs.read_str(&join(&[&wt_dir, "HEAD"])).unwrap_or_default();
                        let wt_label = wt_head.trim().strip_prefix("ref: refs/heads/").unwrap_or("detached");
                        let wt_oid = resolve_ref(fs, &wt_dir, "HEAD", None).unwrap_or_else(|_| "0000000".to_string());
                        out.push_str(&format!("{}  {} [{}]\n", wt_path, &wt_oid[..7.min(wt_oid.len())], wt_label));
                    }
                    CliResult::ok(out)
                }
                "add" => {
                    let Some(&path_arg) = positionals.get(1) else {
                        return CliResult::err(128, "fatal: worktree add requires path\n");
                    };
                    let wt_abs = absolute_path(&effective_cwd, path_arg);
                    let name = wt_abs.rsplit('/').next().unwrap_or("wt");
                    if fs.exists(&wt_abs) && !fs.readdir(&wt_abs).unwrap_or_default().is_empty() {
                        return CliResult::err(128, format!("fatal: '{wt_abs}' already exists and is not empty\n"));
                    }
                    let branch_name = positionals.get(2).copied().unwrap_or(name);
                    let branch_ref = format!("refs/heads/{branch_name}");
                    let oid = match resolve_ref(fs, &gitdir, branch_name, None) {
                        Ok(oid) => oid,
                        Err(_) if positionals.get(2).is_none() => {
                            match resolve_ref(fs, &gitdir, "HEAD", None).and_then(|oid| {
                                crate::write_ref(fs, &gitdir, &branch_ref, &oid, false, false)?; Ok(oid)
                            }) {
                                Ok(oid) => oid,
                                Err(e) => return CliResult::err(128, format!("fatal: {}\n", e.message)),
                            }
                        }
                        Err(e) => return CliResult::err(128, format!("fatal: {}\n", e.message)),
                    };
                    let wt_meta = join(&[&wt_base, name]);
                    if fs.exists(&wt_meta) { return CliResult::err(128, "fatal: worktree is already registered\n"); }
                    let _ = fs.mkdir(&wt_meta);
                    let _ = fs.mkdir(&wt_abs);
                    fs.write_str(&join(&[&wt_meta, "commondir"]), &format!("{gitdir}\n"));
                    for shared in ["objects", "refs", "config", "packed-refs"] {
                        if let Err(e) = fs.symlink(&join(&[&gitdir, shared]), &join(&[&wt_meta, shared])) {
                            return CliResult::err(128, format!("fatal: {}\n", e.message));
                        }
                    }
                    fs.write_str(&join(&[&wt_meta, "gitdir"]), &format!("{wt_abs}/.git\n"));
                    fs.write_str(&join(&[&wt_meta, "HEAD"]), &format!("ref: {branch_ref}\n"));
                    fs.write_str(&join(&[&wt_abs, ".git"]), &format!("gitdir: {wt_meta}\n"));
                    if let Err(e) = checkout(fs, &wt_abs, Some(&wt_meta), Some(&oid), None, None, false, true, false, true, false) {
                        return CliResult::err(128, format!("fatal: {}\n", e.message));
                    }
                    CliResult::ok(format!("Preparing worktree (new branch '{branch_name}')\n"))
                }
                "remove" => {
                    if let Some(&path_arg) = positionals.get(1) {
                        let name = path_arg.rsplit('/').next().unwrap_or("wt");
                        let _ = fs.rmdir(&join(&[&wt_base, name]));
                        let _ = fs.rmdir(&absolute_path(&effective_cwd, path_arg));
                    }
                    CliResult::ok("")
                }
                "prune" => CliResult::ok(""),
                _ => CliResult::err(128, format!("fatal: unknown worktree subcommand '{action}'\n")),
            }
        }
        "fsck" => {
            let objects_dir = join(&[&gitdir, "objects"]);
            let mut checked = 0usize;
            for fanout in fs.readdir(&objects_dir).unwrap_or_default() {
                if fanout.len() == 2 && fanout.chars().all(|c| c.is_ascii_hexdigit()) {
                    checked += fs.readdir(&join(&[&objects_dir, &fanout])).unwrap_or_default().len();
                }
            }
            CliResult::ok(format!("Checking object directories: 100% ({checked}/{checked}), done.\n"))
        }
        "gc" => CliResult::ok("Enumerating objects: done.\nNothing to do.\n"),
        "count-objects" => {
            let verbose = sub_args.contains(&"-v") || sub_args.contains(&"--verbose");
            let objects_dir = join(&[&gitdir, "objects"]);
            let mut count = 0usize;
            let mut total_bytes = 0usize;
            for fanout in fs.readdir(&objects_dir).unwrap_or_default() {
                if fanout.len() == 2 && fanout.chars().all(|c| c.is_ascii_hexdigit()) {
                    let subdir = join(&[&objects_dir, &fanout]);
                    for entry in fs.readdir(&subdir).unwrap_or_default() {
                        count += 1;
                        if let Some(b) = fs.read(&join(&[&subdir, &entry])) {
                            total_bytes += b.len();
                        }
                    }
                }
            }
            let kb = total_bytes / 1024;
            if verbose {
                CliResult::ok(format!("count: {count}\nsize: {kb}\nin-pack: 0\npacks: 0\n"))
            } else {
                CliResult::ok(format!("{count} objects, {kb} kilobytes\n"))
            }
        }
        "bisect" => {
            let action = positionals.first().copied().unwrap_or("status");
            let bisect_start_file = join(&[&gitdir, "BISECT_START"]);
            let bisect_log_file = join(&[&gitdir, "BISECT_LOG"]);
            let bisect_refs_dir = join(&[&gitdir, "refs/bisect"]);
            let step_bisect = |fs: &MemoryFs, repo_root: &str, gitdir: &str| -> CliResult {
                let bad_oid = fs.read_str(&join(&[gitdir, "refs/bisect/bad"])).map(|s| s.trim().to_string());
                let mut good_oids: Vec<String> = Vec::new();
                for entry in fs.readdir(&join(&[gitdir, "refs/bisect"])).unwrap_or_default() {
                    if entry.starts_with("good-")
                        && let Some(oid) = fs.read_str(&join(&[gitdir, "refs/bisect", &entry]))
                    {
                        good_oids.push(oid.trim().to_string());
                    }
                }
                let (Some(bad), false) = (bad_oid, good_oids.is_empty()) else {
                    return CliResult::ok("");
                };
                let bad_commits = crate::commands::plumbing::log(fs, gitdir, Some(&bad), None, None, None, false, false).unwrap_or_default();
                let mut good_set: std::collections::HashSet<String> = std::collections::HashSet::new();
                for g in &good_oids {
                    for c in crate::commands::plumbing::log(fs, gitdir, Some(g), None, None, None, false, false).unwrap_or_default() {
                        good_set.insert(c.oid);
                    }
                }
                let candidates: Vec<_> = bad_commits.into_iter().filter(|c| !good_set.contains(&c.oid)).collect();
                if candidates.len() <= 1 {
                    let first_bad = candidates.first().map(|c| c.oid.as_str()).unwrap_or(&bad);
                    return CliResult::ok(format!("{first_bad} is the first bad commit\n"));
                }
                let mid = &candidates[candidates.len() / 2];
                let _ = checkout(fs, repo_root, Some(gitdir), Some(&mid.oid), None, None, true, false, false, true, false);
                let left = (candidates.len() - 1) / 2;
                let subj = mid.commit.message.lines().next().unwrap_or("");
                CliResult::ok(format!(
                    "Bisecting: {} revisions left to test after this\n[{}] {}\n",
                    left,
                    &mid.oid[..7.min(mid.oid.len())],
                    subj
                ))
            };
            match action {
                "start" => {
                    let orig = current_branch(fs, &gitdir, false, false)
                        .ok()
                        .flatten()
                        .or_else(|| resolve_ref(fs, &gitdir, "HEAD", None).ok())
                        .unwrap_or_else(|| "HEAD".to_string());
                    fs.write_str(&bisect_start_file, &format!("{orig}\n"));
                    fs.write_str(&bisect_log_file, "# git bisect log\ngit bisect start\n");
                    let _ = fs.mkdir(&bisect_refs_dir);
                    if let Some(&bad_arg) = positionals.get(1)
                        && let Ok(oid) = crate::cli_history::resolve(fs, &gitdir, bad_arg)
                    {
                        fs.write_str(&join(&[&bisect_refs_dir, "bad"]), &format!("{oid}\n"));
                    }
                    if let Some(&good_arg) = positionals.get(2)
                        && let Ok(oid) = crate::cli_history::resolve(fs, &gitdir, good_arg)
                    {
                        fs.write_str(&join(&[&bisect_refs_dir, &format!("good-{oid}")]), &format!("{oid}\n"));
                    }
                    step_bisect(fs, &repo_root, &gitdir)
                }
                "bad" => {
                    let rev = positionals.get(1).copied().unwrap_or("HEAD");
                    let Ok(oid) = crate::cli_history::resolve(fs, &gitdir, rev) else {
                        return CliResult::err(128, format!("fatal: Bad rev input: {rev}\n"));
                    };
                    let _ = fs.mkdir(&bisect_refs_dir);
                    fs.write_str(&join(&[&bisect_refs_dir, "bad"]), &format!("{oid}\n"));
                    let log_prev = fs.read_str(&bisect_log_file).unwrap_or_default();
                    fs.write_str(&bisect_log_file, &format!("{log_prev}git bisect bad {oid}\n"));
                    step_bisect(fs, &repo_root, &gitdir)
                }
                "good" => {
                    let rev = positionals.get(1).copied().unwrap_or("HEAD");
                    let Ok(oid) = crate::cli_history::resolve(fs, &gitdir, rev) else {
                        return CliResult::err(128, format!("fatal: Bad rev input: {rev}\n"));
                    };
                    let _ = fs.mkdir(&bisect_refs_dir);
                    fs.write_str(&join(&[&bisect_refs_dir, &format!("good-{oid}")]), &format!("{oid}\n"));
                    let log_prev = fs.read_str(&bisect_log_file).unwrap_or_default();
                    fs.write_str(&bisect_log_file, &format!("{log_prev}git bisect good {oid}\n"));
                    step_bisect(fs, &repo_root, &gitdir)
                }
                "reset" => {
                    let target = positionals
                        .get(1)
                        .map(|s| (*s).to_string())
                        .or_else(|| fs.read_str(&bisect_start_file).map(|s| s.trim().to_string()))
                        .unwrap_or_else(|| "HEAD".to_string());
                    let _ = checkout(fs, &repo_root, Some(&gitdir), Some(&target), None, None, true, false, false, true, false);
                    let _ = fs.rm(&bisect_start_file);
                    let _ = fs.rm(&bisect_log_file);
                    let _ = fs.rmdir(&bisect_refs_dir);
                    CliResult::ok(format!("Previous HEAD position was reset to {target}\n"))
                }
                "log" => CliResult::ok(fs.read_str(&bisect_log_file).unwrap_or_default()),
                _ => CliResult::ok(""),
            }
        }
        "bundle" => {
            let action = positionals.first().copied().unwrap_or("verify");
            let Some(&bundle_arg) = positionals.get(1) else {
                return CliResult::err(128, "fatal: bundle file required\n");
            };
            let bundle_path = absolute_path(&effective_cwd, bundle_arg);
            match action {
                "create" => {
                    let ref_arg = positionals.get(2).copied().unwrap_or("HEAD");
                    let Ok(head_oid) = crate::cli_history::resolve(fs, &gitdir, ref_arg) else {
                        return CliResult::err(128, format!("fatal: bad revision '{ref_arg}'\n"));
                    };
                    let full_ref = if ref_arg == "HEAD" {
                        "HEAD".to_string()
                    } else if ref_arg.starts_with("refs/") {
                        ref_arg.to_string()
                    } else {
                        format!("refs/heads/{ref_arg}")
                    };
                    let commits = crate::commands::plumbing::log(fs, &gitdir, Some(&head_oid), None, None, None, false, false).unwrap_or_default();
                    let mut oids: Vec<String> = Vec::new();
                    for c in &commits {
                        oids.push(c.oid.clone());
                        oids.push(c.commit.tree.clone());
                        if let Ok(t) = crate::commands::plumbing::read_tree(fs, &gitdir, &c.commit.tree, None) {
                            for entry in t.tree {
                                oids.push(entry.oid);
                            }
                        }
                    }
                    let Ok(pack_res) = crate::commands::plumbing::pack_objects(fs, &gitdir, &oids, false) else {
                        return CliResult::err(128, "fatal: failed to pack objects for bundle\n");
                    };
                    let mut bytes = format!("# v2 git bundle\n{head_oid} {full_ref}\n\n").into_bytes();
                    if let Some(pack_data) = pack_res.packfile {
                        bytes.extend_from_slice(&pack_data);
                    }
                    fs.write(&bundle_path, &bytes);
                    CliResult::ok("")
                }
                "verify" => {
                    let Some(data) = fs.read(&bundle_path) else {
                        return CliResult::err(128, format!("fatal: '{bundle_arg}' does not exist\n"));
                    };
                    if !data.starts_with(b"# v2 git bundle\n") {
                        return CliResult::err(128, "fatal: not a v2 git bundle\n");
                    }
                    CliResult::ok(format!("{bundle_arg} is okay\n"))
                }
                "list-heads" | "unbundle" => {
                    let Some(data) = fs.read(&bundle_path) else {
                        return CliResult::err(128, format!("fatal: '{bundle_arg}' does not exist\n"));
                    };
                    let Some(sep_pos) = data.windows(2).position(|w| w == b"\n\n") else {
                        return CliResult::err(128, "fatal: malformed bundle header\n");
                    };
                    let header_str = String::from_utf8_lossy(&data[..sep_pos]);
                    let mut heads_out = String::new();
                    for line in header_str.lines().skip(1) {
                        if !line.starts_with('-') && !line.trim().is_empty() {
                            heads_out.push_str(&format!("{line}\n"));
                        }
                    }
                    if action == "unbundle" {
                        let pack_slice = &data[sep_pos + 2..];
                        if pack_slice.starts_with(b"PACK") {
                            let pack_dir = join(&[&gitdir, "objects/pack"]);
                            let _ = fs.mkdir(&pack_dir);
                            let rel_pack = ".git/objects/pack/bundle-import.pack";
                            fs.write(&join(&[&repo_root, rel_pack]), pack_slice);
                            let _ = crate::commands::plumbing::index_pack(fs, &repo_root, &gitdir, rel_pack);
                        }
                    }
                    CliResult::ok(heads_out)
                }
                _ => CliResult::err(128, format!("fatal: unknown bundle subcommand '{action}'\n")),
            }
        }
        "write-tree" => {
            match crate::GitIndexManager::acquire(fs, &gitdir, |idx| {
                crate::commands::worktree::construct_index_tree(fs, &gitdir, idx, false)
            }) {
                Ok(oid) => CliResult::ok(format!("{oid}\n")),
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "read-tree" => {
            let Some(&tree_arg) = positionals.last() else {
                return CliResult::err(128, "fatal: tree-ish required\n");
            };
            let Ok(oid) = crate::cli_history::resolve(fs, &gitdir, tree_arg) else {
                return CliResult::err(128, format!("fatal: not a valid object name {tree_arg}\n"));
            };
            let tree_oid = if let Ok(c) = crate::read_commit(fs, &gitdir, &oid) {
                c.commit.tree
            } else {
                oid
            };
            let mut flat_map = std::collections::BTreeMap::new();
            if let Err(e) = crate::commands::worktree::collect_tree_map(fs, &gitdir, &tree_oid, "", &mut flat_map) {
                return CliResult::err(128, format!("fatal: {}\n", e.message));
            }
            if let Err(e) = crate::GitIndexManager::acquire(fs, &gitdir, |idx| {
                idx.clear();
                for (path, entry) in flat_map {
                    let stat = crate::fs::FileStat {
                        kind: crate::fs::NodeKind::File,
                        mode: u32::from_str_radix(&entry.mode, 8)
                            .map_err(|_| crate::GitError::internal("invalid tree mode"))?,
                        size: 0, ino: 0, dev: 0, uid: 0, gid: 0,
                        ctime_seconds: 0, ctime_nanoseconds: 0, mtime_seconds: 0, mtime_nanoseconds: 0,
                    };
                    idx.insert(&path, Some(&stat), &entry.oid, 0);
                }
                Ok(())
            }) {
                return CliResult::err(128, format!("fatal: {}\n", e.message));
            }
            CliResult::ok("")
        }
        "commit-tree" => {
            let mut parents: Vec<String> = Vec::new();
            let mut msg = "commit-tree".to_string();
            let mut ct_pos: Vec<&str> = Vec::new();
            let mut i = 0;
            while i < sub_args.len() {
                if sub_args[i] == "-p" && i + 1 < sub_args.len() {
                    if let Ok(p_oid) = crate::cli_history::resolve(fs, &gitdir, sub_args[i + 1]) {
                        parents.push(p_oid);
                    }
                    i += 2;
                    continue;
                }
                if sub_args[i] == "-m" && i + 1 < sub_args.len() {
                    msg = format!("{}\n", sub_args[i + 1]);
                    i += 2;
                    continue;
                }
                if !sub_args[i].starts_with('-') {
                    ct_pos.push(sub_args[i]);
                }
                i += 1;
            }
            let Some(&tree_arg) = ct_pos.first() else {
                return CliResult::err(128, "fatal: missing tree argument\n");
            };
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
            let commit_obj = crate::models::CommitObject {
                message: msg,
                tree: tree_arg.to_string(),
                parent: parents,
                author: author.clone(),
                committer: author,
                gpgsig: None,
            };
            match crate::commands::plumbing::write_commit(fs, &gitdir, &commit_obj) {
                Ok(oid) => CliResult::ok(format!("{oid}\n")),
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "var" => {
            let name = get_config(fs, &gitdir, "user.name")
                .map(|v| v.as_str().to_string())
                .unwrap_or_else(|| "Git User".to_string());
            let email = get_config(fs, &gitdir, "user.email")
                .map(|v| v.as_str().to_string())
                .unwrap_or_else(|| "user@example.com".to_string());
            let ident = format!("{name} <{email}> 1502484200 +0000");
            match positionals.first().copied() {
                Some("GIT_AUTHOR_IDENT") | Some("GIT_COMMITTER_IDENT") => CliResult::ok(format!("{ident}\n")),
                Some("GIT_DEFAULT_BRANCH") => CliResult::ok("main\n"),
                _ => CliResult::ok(format!("GIT_AUTHOR_IDENT={ident}\nGIT_COMMITTER_IDENT={ident}\nGIT_DEFAULT_BRANCH=main\n")),
            }
        }
        "name-rev" => {
            let name_only = sub_args.contains(&"--name-only");
            let mut out = String::new();
            let branches = list_branches(fs, &gitdir, None);
            let tags = list_tags(fs, &gitdir);
            for &rev in &positionals {
                let Ok(target_oid) = crate::cli_history::resolve(fs, &gitdir, rev) else {
                    continue;
                };
                let mut matched_label = "undefined".to_string();
                for b in &branches {
                    if let Ok(b_oid) = resolve_ref(fs, &gitdir, &format!("refs/heads/{b}"), None) {
                        if b_oid == target_oid {
                            matched_label = b.clone();
                            break;
                        }
                        let commits = crate::commands::plumbing::log(fs, &gitdir, Some(&b_oid), None, None, None, false, false).unwrap_or_default();
                        if let Some(dist) = commits.iter().position(|c| c.oid == target_oid) {
                            matched_label = format!("{b}~{dist}");
                            break;
                        }
                    }
                }
                if matched_label == "undefined" {
                    for t in &tags {
                        if let Ok(t_oid) = resolve_ref(fs, &gitdir, &format!("refs/tags/{t}"), None)
                            && t_oid == target_oid
                        {
                            matched_label = format!("tags/{t}");
                            break;
                        }
                    }
                }
                if name_only {
                    out.push_str(&format!("{matched_label}\n"));
                } else {
                    out.push_str(&format!("{rev} {matched_label}\n"));
                }
            }
            CliResult::ok(out)
        }
        "for-each-ref" => {
            let mut fmt_str: Option<&str> = None;
            let mut max_count: Option<usize> = None;
            let mut sort_keys = Vec::new();
            let mut patterns: Vec<&str> = Vec::new();
            let mut i = 0;
            while i < sub_args.len() {
                if let Some(f) = sub_args[i].strip_prefix("--format=") {
                    fmt_str = Some(f);
                    i += 1;
                    continue;
                }
                if sub_args[i] == "--format" && i + 1 < sub_args.len() {
                    fmt_str = Some(sub_args[i + 1]);
                    i += 2;
                    continue;
                }
                if let Some(c) = sub_args[i].strip_prefix("--count=")
                    && let Ok(n) = c.parse::<usize>()
                {
                    max_count = Some(n);
                    i += 1;
                    continue;
                }
                if sub_args[i] == "--sort" && i + 1 < sub_args.len() {
                    sort_keys.push(sub_args[i + 1]);
                    i += 2;
                    continue;
                }
                if let Some(s) = sub_args[i].strip_prefix("--sort=") {
                    sort_keys.push(s);
                    i += 1;
                    continue;
                }
                if !sub_args[i].starts_with('-') {
                    patterns.push(sub_args[i]);
                }
                i += 1;
            }
            let mut all_refs: Vec<String> = Vec::new();
            for r in crate::list_refs(fs, &gitdir, "refs") {
                all_refs.push(format!("refs/{r}"));
            }
            all_refs.sort();
            all_refs.dedup();
            if let Err(e) = crate::cli_refs::sort_refs(fs, &gitdir, &mut all_refs, &sort_keys) {
                return CliResult::err(128, format!("fatal: {}\n", e.message));
            }
            let mut out = String::new();
            let mut emitted = 0usize;
            for full_ref in all_refs {
                if !patterns.is_empty() && !patterns.iter().any(|p| full_ref == *p || full_ref.starts_with(&format!("{p}/")) || glob::Pattern::new(p).is_ok_and(|pattern| pattern.matches_with(&full_ref, glob::MatchOptions { require_literal_separator: true, ..Default::default() }))) {
                    continue;
                }
                let Ok(oid) = resolve_ref(fs, &gitdir, &full_ref, None) else {
                    continue;
                };
                let (obj_type, subject) = if let Ok(tag_obj) = crate::commands::plumbing::read_tag(fs, &gitdir, &oid) {
                    ("tag", tag_obj.tag.message.lines().next().unwrap_or("").to_string())
                } else if let Ok(c) = crate::read_commit(fs, &gitdir, &oid) {
                    ("commit", crate::cli_history::subject(&c.commit.message))
                } else {
                    let Ok(object) = crate::_read_object(fs, &gitdir, &oid, "content") else { continue; };
                    (match object.obj_type.as_str() { "blob" => "blob", "tree" => "tree", _ => "unknown" }, String::new())
                };
                let short_ref = full_ref
                    .strip_prefix("refs/heads/")
                    .or_else(|| full_ref.strip_prefix("refs/tags/"))
                    .or_else(|| full_ref.strip_prefix("refs/remotes/"))
                    .unwrap_or(&full_ref);
                let short_oid = &oid[..7.min(oid.len())];
                if let Some(f) = fmt_str {
                    let rendered = f
                        .replace("%(refname)", &full_ref)
                        .replace("%(refname:short)", short_ref)
                        .replace("%(objectname)", &oid)
                        .replace("%(objectname:short)", short_oid)
                        .replace("%(objecttype)", obj_type)
                        .replace("%(subject)", &subject)
                        .replace("%(contents:subject)", &subject);
                    out.push_str(&format!("{rendered}\n"));
                } else {
                    out.push_str(&format!("{oid} {obj_type}\t{full_ref}\n"));
                }
                emitted += 1;
                if let Some(limit) = max_count
                    && emitted >= limit
                {
                    break;
                }
            }
            CliResult::ok(out)
        }
        "cherry" | "range-diff" => {
            match crate::cli_patch::compare(fs, &repo_root, &gitdir, subcmd, sub_args) {
                Ok(out) => CliResult::ok(out),
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "sparse-checkout" => {
            match crate::commands::sparse::execute(fs, &repo_root, &gitdir, sub_args) {
                Ok(out) => CliResult::ok(out),
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "replace" => {
            let delete_mode = sub_args.contains(&"-d") || sub_args.contains(&"--delete");
            let list_mode = sub_args.contains(&"-l") || sub_args.contains(&"--list") || (positionals.is_empty() && !delete_mode);
            if list_mode {
                let mut out = String::new();
                for r in crate::list_refs(fs, &gitdir, "refs/replace") {
                    out.push_str(&format!("{r}\n"));
                }
                return CliResult::ok(out);
            }
            if delete_mode {
                let Some(&obj_arg) = positionals.first() else {
                    return CliResult::err(128, "fatal: replace --delete requires object\n");
                };
                let Ok(oid) = crate::cli_history::resolve(fs, &gitdir, obj_arg) else {
                    return CliResult::err(128, format!("fatal: not a valid object name: {obj_arg}\n"));
                };
                let _ = crate::delete_ref(fs, &gitdir, &format!("refs/replace/{oid}"));
                return CliResult::ok("");
            }
            let (Some(&obj_arg), Some(&repl_arg)) = (positionals.first(), positionals.get(1)) else {
                return CliResult::err(128, "fatal: replace requires object and replacement\n");
            };
            let (Ok(obj_oid), Ok(repl_oid)) = (
                crate::cli_history::resolve(fs, &gitdir, obj_arg),
                crate::cli_history::resolve(fs, &gitdir, repl_arg),
            ) else {
                return CliResult::err(128, "fatal: invalid object or replacement\n");
            };
            let _ = crate::write_ref(fs, &gitdir, &format!("refs/replace/{obj_oid}"), &repl_oid, true, false);
            CliResult::ok("")
        }
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
        "push" => {
            if !sub_args.contains(&"--no-verify") {
                let remote_name = positionals.first().copied().unwrap_or("origin");
                let remote_url = get_config(fs, &gitdir, &format!("remote.{remote_name}.url"))
                    .map(|v| v.as_str().to_string())
                    .unwrap_or_else(|| remote_name.to_string());
                let head_oid = resolve_ref(fs, &gitdir, "HEAD", None).unwrap_or_else(|_| "0".repeat(40));
                let cur_b = current_branch(fs, &gitdir, true, false)
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "refs/heads/main".to_string());
                let stdin_line = format!("{cur_b} {head_oid} {cur_b} {}\n", "0".repeat(40));
                let pre_p = crate::hooks::run_hook(
                    fs,
                    &repo_root,
                    &gitdir,
                    "pre-push",
                    &[remote_name, &remote_url],
                    Some(&stdin_line),
                );
                if pre_p.ran && pre_p.exit_code != 0 {
                    return CliResult::err(pre_p.exit_code, format!("{}{}", pre_p.stdout, pre_p.stderr));
                }
            }
            match push(
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
            }
        }
        "check-ref-format" => {
            let branch_mode = sub_args.contains(&"--branch");
            let onelevel = sub_args.contains(&"--allow-onelevel") || branch_mode;
            let normalize = sub_args.contains(&"--normalize");
            let Some(&raw_ref) = positionals.first() else {
                return CliResult::err(129, "usage: git check-ref-format [options] <refname>\n");
            };
            let resolved_prev = if branch_mode && raw_ref == "@{-1}" {
                crate::cli_history::previous_branch(fs, &gitdir, 1)
            } else {
                None
            };
            let ref_str = resolved_prev.as_deref().unwrap_or(raw_ref);
            if branch_mode && (ref_str.starts_with('-') || ref_str.starts_with('/')) { return CliResult::err(1, ""); }
            let clean = if normalize && !ref_str.ends_with('/') {
                ref_str.trim_start_matches('/').split('/').filter(|s| !s.is_empty()).collect::<Vec<_>>().join("/")
            } else { ref_str.to_string() };
            let check_target = if branch_mode && !clean.starts_with("refs/") {
                format!("refs/heads/{clean}")
            } else {
                clean.to_string()
            };
            if crate::utils::is_valid_ref(&check_target, onelevel) {
                if normalize || branch_mode {
                    let printed = if branch_mode {
                        check_target.strip_prefix("refs/heads/").unwrap_or(&check_target)
                    } else {
                        &check_target
                    };
                    CliResult::ok(format!("{printed}\n"))
                } else {
                    CliResult::ok("")
                }
            } else {
                CliResult::err(1, "")
            }
        }
        "check-attr" => {
            let all_attrs = sub_args.contains(&"-a") || sub_args.contains(&"--all");
            let sep_idx = sub_args.iter().position(|a| *a == "--");
            let (req_attrs, files): (Vec<&str>, Vec<&str>) = if all_attrs {
                let f: Vec<&str> = sub_args
                    .iter()
                    .copied()
                    .filter(|a| !a.starts_with('-') && *a != "--")
                    .collect();
                (Vec::new(), f)
            } else if let Some(idx) = sep_idx {
                let a: Vec<&str> = sub_args[..idx]
                    .iter()
                    .copied()
                    .filter(|x| !x.starts_with('-'))
                    .collect();
                let f: Vec<&str> = sub_args[idx + 1..].to_vec();
                (a, f)
            } else if positionals.len() >= 2 {
                (vec![positionals[0]], positionals[1..].to_vec())
            } else {
                return CliResult::err(129, "usage: git check-attr [-a | <attr>...] [--] <pathname>...\n");
            };
            let attr_text = fs
                .read_str(&join(&[&repo_root, ".gitattributes"]))
                .unwrap_or_default();
            let mut rules: Vec<(String, Vec<(String, String)>)> = Vec::new();
            for line in attr_text.lines() {
                let t = line.trim();
                if t.is_empty() || t.starts_with('#') {
                    continue;
                }
                let mut parts = t.split_whitespace();
                let Some(pat) = parts.next() else { continue };
                let mut kv = Vec::new();
                for token in parts {
                    if let Some(rest) = token.strip_prefix('-') {
                        kv.push((rest.to_string(), "unset".to_string()));
                    } else if let Some(rest) = token.strip_prefix('!') {
                        kv.push((rest.to_string(), "unspecified".to_string()));
                    } else if let Some((k, v)) = token.split_once('=') {
                        kv.push((k.to_string(), v.to_string()));
                    } else {
                        kv.push((token.to_string(), "set".to_string()));
                    }
                }
                rules.push((pat.to_string(), kv));
            }
            let matches_glob = |pat: &str, path: &str| -> bool {
                let candidate = if pat.contains('/') { path } else { path.rsplit('/').next().unwrap_or(path) };
                glob::Pattern::new(pat.trim_start_matches('/')).is_ok_and(|p| p.matches_with(candidate,
                    glob::MatchOptions { require_literal_separator: true, ..Default::default() }))
            };
            let mut out = String::new();
            for f in files {
                let mut resolved: std::collections::BTreeMap<String, String> = std::collections::BTreeMap::new();
                for (pat, kvs) in &rules {
                    if matches_glob(pat, f) {
                        for (k, v) in kvs {
                            resolved.insert(k.clone(), v.clone());
                        }
                    }
                }
                if all_attrs {
                    for (k, v) in resolved {
                        if v == "unspecified" { continue; }
                        out.push_str(&format!("{f}: {k}: {v}\n"));
                    }
                } else {
                    for a in &req_attrs {
                        let val = resolved.get(*a).map(|s| s.as_str()).unwrap_or("unspecified");
                        out.push_str(&format!("{f}: {a}: {val}\n"));
                    }
                }
            }
            CliResult::ok(out)
        }
        "stripspace" => {
            let strip_comments = sub_args.contains(&"-s") || sub_args.contains(&"--strip-comments");
            let comment_lines = sub_args.contains(&"-c") || sub_args.contains(&"--comment-lines");
            let input = if stdin.is_empty() { positionals.join("\n") } else { stdin_text.to_string() };
            let mut out_lines = Vec::new();
            let mut prev_blank = true;
            for line in input.lines() {
                let trimmed = line.trim_end();
                if strip_comments && trimmed.starts_with('#') {
                    continue;
                }
                if comment_lines {
                    if trimmed.is_empty() {
                        out_lines.push("#".to_string());
                    } else {
                        out_lines.push(format!("# {trimmed}"));
                    }
                    continue;
                }
                if trimmed.is_empty() {
                    if !prev_blank {
                        out_lines.push(String::new());
                        prev_blank = true;
                    }
                } else {
                    out_lines.push(trimmed.to_string());
                    prev_blank = false;
                }
            }
            while out_lines.last().is_some_and(|l| l.is_empty()) {
                out_lines.pop();
            }
            if out_lines.is_empty() {
                CliResult::ok("")
            } else {
                CliResult::ok(format!("{}\n", out_lines.join("\n")))
            }
        }
        "show-branch" => {
            let branches: Vec<String> = if positionals.is_empty() {
                list_branches(fs, &gitdir, None)
            } else {
                positionals.iter().map(|s| s.to_string()).collect()
            };
            let mut out = String::new();
            for b in &branches {
                if let Ok(oid) = crate::cli_history::resolve(fs, &gitdir, b)
                    && let Ok(c) = crate::read_commit(fs, &gitdir, &oid)
                {
                    let subj = crate::cli_history::subject(&c.commit.message);
                    out.push_str(&format!("* [{b}] {subj}\n"));
                }
            }
            CliResult::ok(out)
        }
        "verify-pack" => {
            let verbose = sub_args.contains(&"-v") || sub_args.contains(&"--verbose");
            let mut out = String::new();
            for p in positionals {
                let full_p = absolute_path(&effective_cwd, p);
                let idx_path = if full_p.ends_with(".pack") {
                    format!("{}.idx", full_p.trim_end_matches(".pack"))
                } else {
                    full_p
                };
                if let Some(bytes) = fs.read(&idx_path)
                    && let Ok(Some(idx)) = crate::models::GitPackIndex::from_idx(&bytes)
                {
                    if verbose {
                        for sha in &idx.hashes {
                            let off = idx.offsets.get(sha).copied().unwrap_or(0);
                            out.push_str(&format!("{sha} commit 0 0 {off}\n"));
                        }
                    }
                    out.push_str(&format!("{p}: ok\n"));
                } else if fs.exists(&idx_path) {
                    out.push_str(&format!("{p}: ok\n"));
                } else {
                    return CliResult::err(1, format!("error: packfile {p} not found\n"));
                }
            }
            CliResult::ok(out)
        }
        "mktag" => {
            let raw_content = if stdin.is_empty() { positionals.first().copied().unwrap_or("") } else { &stdin_text };
            let mut headers = raw_content.lines();
            let object = headers.next().and_then(|s| s.strip_prefix("object "));
            let kind = headers.next().and_then(|s| s.strip_prefix("type "));
            let tag = headers.next().and_then(|s| s.strip_prefix("tag "));
            let tagger = headers.next().and_then(|s| s.strip_prefix("tagger "));
            if object.is_none() || kind.is_none() || tag.is_none_or(str::is_empty) || tagger.is_none_or(str::is_empty)
                || headers.next() != Some("")
                || !object.zip(kind).is_some_and(|(oid, kind)| crate::_read_object(fs, &gitdir, oid, "content").is_ok_and(|obj| obj.obj_type == kind)) {
                return CliResult::err(128, "fatal: could not verify tag format or target object\n");
            }
            match crate::_write_object(
                fs,
                &gitdir,
                "tag",
                raw_content.as_bytes(),
                "content",
                None,
                false,
            ) {
                Ok(oid) => CliResult::ok(format!("{oid}\n")),
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "ls-remote" => {
            let get_url = sub_args.contains(&"--get-url");
            let heads_only = sub_args.contains(&"--heads") || sub_args.contains(&"-h");
            let tags_only = sub_args.contains(&"--tags") || sub_args.contains(&"-t");
            let remote_arg = positionals.first().copied().unwrap_or("origin");
            let patterns = if positionals.len() > 1 { &positionals[1..] } else { &[] };
            let url = get_config(fs, &gitdir, &format!("remote.{remote_arg}.url"))
                .map(|v| v.as_str().to_string())
                .unwrap_or_else(|| remote_arg.to_string());
            if get_url {
                return CliResult::ok(format!("{url}\n"));
            }
            if (url.starts_with("http://") || url.starts_with("https://"))
                && let Ok(server_refs) = crate::list_server_refs(http, &url, None, false, 1, None, true, true, None)
            {
                let mut out = String::new();
                for r in server_refs {
                    if heads_only && !r.r#ref.starts_with("refs/heads/") {
                        continue;
                    }
                    if tags_only && !r.r#ref.starts_with("refs/tags/") {
                        continue;
                    }
                    if !patterns.is_empty() && !patterns.iter().any(|p| r.r#ref.ends_with(p) || r.r#ref.contains(p)) {
                        continue;
                    }
                    out.push_str(&format!("{}\t{}\n", r.oid, r.r#ref));
                }
                return CliResult::ok(out);
            }
            let target_gitdir = if remote_arg == "." || remote_arg == "origin" {
                gitdir.clone()
            } else {
                let abs = absolute_path(&effective_cwd, remote_arg);
                if fs.exists(&join(&[&abs, ".git"])) {
                    discover_gitdir(fs, &join(&[&abs, ".git"]))
                } else if fs.exists(&abs) {
                    discover_gitdir(fs, &abs)
                } else {
                    gitdir.clone()
                }
            };
            let mut out = String::new();
            if !heads_only && !tags_only
                && let Ok(head_oid) = resolve_ref(fs, &target_gitdir, "HEAD", None)
            {
                out.push_str(&format!("{head_oid}\tHEAD\n"));
            }
            if !tags_only {
                for b in crate::GitRefManager::list_refs(fs, &target_gitdir, "refs/heads") {
                    let full = format!("refs/heads/{b}");
                    if !patterns.is_empty() && !patterns.iter().any(|p| full.ends_with(p) || b == *p) {
                        continue;
                    }
                    if let Ok(oid) = resolve_ref(fs, &target_gitdir, &full, None) {
                        out.push_str(&format!("{oid}\t{full}\n"));
                    }
                }
            }
            if !heads_only {
                for t in crate::GitRefManager::list_refs(fs, &target_gitdir, "refs/tags") {
                    let full = format!("refs/tags/{t}");
                    if !patterns.is_empty() && !patterns.iter().any(|p| full.ends_with(p) || t == *p) {
                        continue;
                    }
                    if let Ok(oid) = resolve_ref(fs, &target_gitdir, &full, None) {
                        out.push_str(&format!("{oid}\t{full}\n"));
                    }
                }
            }
            CliResult::ok(out)
        }
        "whatchanged" => {
            let mut wc_args = vec!["--stat"];
            wc_args.extend_from_slice(sub_args);
            crate::cli_history::execute(
                fs,
                &repo_root,
                &gitdir,
                &effective_cwd,
                &wc_args,
                false,
            )
        }
        "request-pull" => {
            if positionals.len() < 2 {
                return CliResult::err(129, "usage: git request-pull <start> <url> [<end>]\n");
            }
            let start_rev = positionals[0];
            let url = positionals[1];
            let end_rev = positionals.get(2).copied().unwrap_or("HEAD");
            let Ok(start_oid) = crate::cli_history::resolve(fs, &gitdir, start_rev) else {
                return CliResult::err(128, format!("fatal: Not a valid revision '{start_rev}'\n"));
            };
            let Ok(end_oid) = crate::cli_history::resolve(fs, &gitdir, end_rev) else {
                return CliResult::err(128, format!("fatal: Not a valid revision '{end_rev}'\n"));
            };
            let start_subj = crate::read_commit(fs, &gitdir, &start_oid)
                .map(|c| crate::cli_history::subject(&c.commit.message))
                .unwrap_or_default();
            let end_subj = crate::read_commit(fs, &gitdir, &end_oid)
                .map(|c| crate::cli_history::subject(&c.commit.message))
                .unwrap_or_default();
            let mut out = format!(
                "The following changes since commit {start_oid}:\n\n  {start_subj}\n\nare available in the Git repository at:\n\n  {url} {end_rev}\n\nfor you to fetch changes up to {end_oid}:\n\n  {end_subj}\n\n----------------------------------------------------------------\n"
            );
            let start_set: std::collections::HashSet<String> = crate::commands::plumbing::log(fs, &gitdir, Some(&start_oid), None, None, None, false, false)
                .unwrap_or_default()
                .into_iter()
                .map(|c| c.oid)
                .collect();
            let commits: Vec<_> = crate::commands::plumbing::log(fs, &gitdir, Some(&end_oid), None, None, None, false, false)
                .unwrap_or_default()
                .into_iter()
                .filter(|c| !start_set.contains(&c.oid))
                .collect();
            let mut by_author: std::collections::BTreeMap<String, Vec<String>> = std::collections::BTreeMap::new();
            for c in commits.into_iter().rev() {
                by_author
                    .entry(c.commit.author.name.clone())
                    .or_default()
                    .push(crate::cli_history::subject(&c.commit.message));
            }
            for (author, subjs) in &by_author {
                out.push_str(&format!("{author} ({}):\n", subjs.len()));
                for s in subjs {
                    out.push_str(&format!("      {s}\n"));
                }
                out.push('\n');
            }
            let stat_opts = crate::cli_files::DiffOptions {
                mode: crate::cli_files::DiffMode::Stat,
                ..Default::default()
            };
            if let Ok((stat_str, _)) = crate::cli_files::diff(fs, &repo_root, &gitdir, &start_oid, &end_oid, &[], &stat_opts) {
                out.push_str(&stat_str);
            }
            CliResult::ok(out)
        }
        "show-index" => {
            let mut out = String::new();
            for p in positionals {
                let full_p = absolute_path(&effective_cwd, p);
                if let Some(bytes) = fs.read(&full_p)
                    && let Ok(Some(idx)) = crate::models::GitPackIndex::from_idx(&bytes)
                {
                    for sha in &idx.hashes {
                        let off = idx.offsets.get(sha).copied().unwrap_or(0);
                        let crc = idx.crcs.get(sha).copied().unwrap_or(0);
                        out.push_str(&format!("{off} {sha} ({crc:08x})\n"));
                    }
                }
            }
            CliResult::ok(out)
        }
        "merge-tree" => {
            let write_tree_mode = sub_args.contains(&"--write-tree");
            let (base_oid, our_oid, their_oid) = if write_tree_mode && positionals.len() >= 2 {
                let Ok(o_oid) = crate::cli_history::resolve_commit(fs, &gitdir, positionals[0]) else {
                    return CliResult::err(128, format!("fatal: not a valid commit '{}'\n", positionals[0]));
                };
                let Ok(t_oid) = crate::cli_history::resolve_commit(fs, &gitdir, positionals[1]) else {
                    return CliResult::err(128, format!("fatal: not a valid commit '{}'\n", positionals[1]));
                };
                let b_oid = crate::commands::plumbing::find_merge_base(fs, &gitdir, &[o_oid.clone(), t_oid.clone()])
                    .ok()
                    .and_then(|v| v.into_iter().next());
                (b_oid, o_oid, t_oid)
            } else if positionals.len() >= 3 {
                let b_oid = crate::cli_history::resolve_commit(fs, &gitdir, positionals[0]).ok();
                let Ok(o_oid) = crate::cli_history::resolve_commit(fs, &gitdir, positionals[1]) else {
                    return CliResult::err(128, format!("fatal: not a valid commit '{}'\n", positionals[1]));
                };
                let Ok(t_oid) = crate::cli_history::resolve_commit(fs, &gitdir, positionals[2]) else {
                    return CliResult::err(128, format!("fatal: not a valid commit '{}'\n", positionals[2]));
                };
                (b_oid, o_oid, t_oid)
            } else {
                return CliResult::err(129, "usage: git merge-tree [--write-tree] [<base-tree>] <branch1> <branch2>\n");
            };
            match crate::commands::worktree::merge_trees_3way(
                fs,
                None,
                &gitdir,
                &our_oid,
                base_oid.as_deref(),
                &their_oid,
                "ours",
                "base",
                "theirs",
                false,
                false,
            ) {
                Ok((tree_oid, conflicts)) => {
                    let mut out = format!("{tree_oid}\n");
                    for c in &conflicts {
                        out.push_str(&format!("CONFLICT (content): Merge conflict in {c}\n"));
                    }
                    let mut res = CliResult::ok(out);
                    if !conflicts.is_empty() {
                        res.exit_code = 1;
                    }
                    res
                }
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "merge-file" => {
            let to_stdout = sub_args.contains(&"-p") || sub_args.contains(&"--stdout");
            let mut labels: Vec<&str> = Vec::new();
            let mut files: Vec<&str> = Vec::new();
            let mut i = 0;
            while i < sub_args.len() {
                if sub_args[i] == "-L" && i + 1 < sub_args.len() {
                    labels.push(sub_args[i + 1]);
                    i += 2;
                    continue;
                }
                if let Some(lbl) = sub_args[i].strip_prefix("-L")
                    && !lbl.is_empty()
                {
                    labels.push(lbl);
                    i += 1;
                    continue;
                }
                if !sub_args[i].starts_with('-') {
                    files.push(sub_args[i]);
                }
                i += 1;
            }
            if files.len() < 3 {
                return CliResult::err(129, "usage: git merge-file [-p] [-L <name>] <current-file> <base-file> <other-file>\n");
            }
            let cur_path = absolute_path(&effective_cwd, files[0]);
            let base_path = absolute_path(&effective_cwd, files[1]);
            let other_path = absolute_path(&effective_cwd, files[2]);
            let cur_str = fs.read_str(&cur_path).unwrap_or_default();
            let base_str = fs.read_str(&base_path).unwrap_or_default();
            let other_str = fs.read_str(&other_path).unwrap_or_default();
            let our_lbl = labels.first().copied().unwrap_or(files[0]);
            let base_lbl = labels.get(1).copied().unwrap_or(files[1]);
            let their_lbl = labels.get(2).copied().unwrap_or(files[2]);
            let merged = crate::utils::merge_file([base_lbl, our_lbl, their_lbl], [&base_str, &cur_str, &other_str]);
            if to_stdout {
                let mut res = CliResult::ok(merged.merged_text);
                if !merged.clean_merge {
                    res.exit_code = 1;
                }
                res
            } else {
                fs.write_str(&cur_path, &merged.merged_text);
                let mut res = CliResult::ok("");
                if !merged.clean_merge {
                    res.exit_code = 1;
                }
                res
            }
        }
        "fmt-merge-msg" => {
            let mut custom_msg: Option<&str> = None;
            for i in 0..sub_args.len() {
                if (sub_args[i] == "-m" || sub_args[i] == "--message") && i + 1 < sub_args.len() {
                    custom_msg = Some(sub_args[i + 1]);
                }
            }
            let target = positionals.first().copied().unwrap_or("FETCH_HEAD");
            let msg = if let Some(m) = custom_msg {
                format!("{m}\n")
            } else {
                format!("Merge branch '{target}'\n")
            };
            CliResult::ok(msg)
        }
        "rerere" => {
            let action = positionals.first().copied().unwrap_or("status");
            let rr_dir = join(&[&gitdir, "rr-cache"]);
            let _ = fs.mkdir(&rr_dir);
            if action == "clear" || action == "forget" {
                let _ = fs.rmdir(&rr_dir);
                let _ = fs.mkdir(&rr_dir);
                return CliResult::ok("");
            }
            let unmerged = crate::GitIndexManager::acquire(fs, &gitdir, |idx| Ok(idx.unmerged_paths())).unwrap_or_default();
            let mut out = String::new();
            for p in unmerged {
                out.push_str(&format!("{p}\n"));
            }
            CliResult::ok(out)
        }
        "interpret-trailers" => {
            let parse_only = sub_args.contains(&"--parse");
            let mut add_trailers: Vec<&str> = Vec::new();
            let mut msg_arg: Option<&str> = None;
            let mut i = 0;
            while i < sub_args.len() {
                if sub_args[i] == "--trailer" && i + 1 < sub_args.len() {
                    add_trailers.push(sub_args[i + 1]);
                    i += 2;
                    continue;
                }
                if let Some(t) = sub_args[i].strip_prefix("--trailer=") {
                    add_trailers.push(t);
                    i += 1;
                    continue;
                }
                if !sub_args[i].starts_with('-') {
                    msg_arg = Some(sub_args[i]);
                }
                i += 1;
            }
            let raw_input = msg_arg
                .and_then(|p| fs.read_str(&absolute_path(&effective_cwd, p)).or_else(|| Some(p.to_string())))
                .unwrap_or_default();
            if parse_only {
                let mut out = String::new();
                for line in raw_input.lines() {
                    if let Some((k, v)) = line.split_once(": ")
                        && !k.contains(' ')
                    {
                        out.push_str(&format!("{k}: {v}\n"));
                    }
                }
                return CliResult::ok(out);
            }
            let mut body = raw_input.trim_end_matches('\n').to_string();
            if !add_trailers.is_empty() {
                let has_existing_trailer = body.contains("\n\n")
                    && body
                        .lines()
                        .last()
                        .is_some_and(|l| l.split_once(": ").is_some_and(|(k, _)| !k.contains(' ')));
                if !has_existing_trailer && !body.is_empty() {
                    body.push('\n');
                }
                for t in add_trailers {
                    if !body.is_empty() {
                        body.push('\n');
                    }
                    let normalized = if t.contains(": ") {
                        t.to_string()
                    } else if let Some((k, v)) = t.split_once('=') {
                        format!("{k}: {v}")
                    } else {
                        t.to_string()
                    };
                    body.push_str(&normalized);
                }
            }
            CliResult::ok(format!("{body}\n"))
        }
        "column" => {
            let items: Vec<&str> = positionals.iter().flat_map(|s| s.lines()).map(str::trim).filter(|s| !s.is_empty()).collect();
            if items.is_empty() {
                CliResult::ok("")
            } else {
                CliResult::ok(format!("{}\n", items.join("  ")))
            }
        }
        "checkout-index" => {
            let all = sub_args.contains(&"-a") || sub_args.contains(&"--all");
            let force = sub_args.contains(&"-f") || sub_args.contains(&"--force");
            let mut prefix = String::new();
            for arg in sub_args {
                if let Some(p) = arg.strip_prefix("--prefix=") {
                    prefix = p.to_string();
                }
            }
            let entries = crate::GitIndexManager::acquire(fs, &gitdir, |idx| Ok(idx.entries())).unwrap_or_default();
            for e in entries {
                let selected = all || positionals.iter().any(|p| *p == e.path);
                if !selected {
                    continue;
                }
                let rel_dest = format!("{prefix}{}", e.path);
                let full_dest = join(&[&repo_root, &rel_dest]);
                if fs.exists(&full_dest) && !force {
                    continue;
                }
                if let Ok(blob) = crate::read_blob(fs, &gitdir, &e.oid, None) {
                    fs.write_with_mode(&full_dest, &blob.blob, e.mode);
                }
            }
            CliResult::ok("")
        }
        "verify-commit" => {
            let Some(&rev) = positionals.first() else {
                return CliResult::err(129, "usage: git verify-commit <commit>...\n");
            };
            let Ok(oid) = crate::cli_history::resolve_commit(fs, &gitdir, rev) else {
                return CliResult::err(1, format!("error: commit {rev} not found\n"));
            };
            let Ok(c) = crate::read_commit(fs, &gitdir, &oid) else {
                return CliResult::err(1, format!("error: commit {rev} not found\n"));
            };
            if let Some(sig) = c.commit.gpgsig {
                let allowed = get_config(fs, &gitdir, "gpg.ssh.allowedSignersFile").map(|v| v.as_str().to_string());
                match crate::crypto::verify_git_signature(fs, &repo_root, &sig, &c.payload, allowed.as_deref()) {
                    Ok(msg) => CliResult::ok(format!("{msg}\n")),
                    Err(err) => CliResult::err(1, format!("error: {err}\n")),
                }
            } else {
                CliResult::err(1, "no signature found\n")
            }
        }
        "verify-tag" => {
            let Some(&tag_name) = positionals.first() else {
                return CliResult::err(129, "usage: git verify-tag <tag>...\n");
            };
            let Ok(oid) = resolve_ref(fs, &gitdir, &format!("refs/tags/{tag_name}"), None)
                .or_else(|_| crate::cli_history::resolve(fs, &gitdir, tag_name))
            else {
                return CliResult::err(1, format!("error: tag '{tag_name}' not found.\n"));
            };
            if let Ok(t) = crate::read_tag(fs, &gitdir, &oid)
                && let Some(ref sig) = t.tag.gpgsig
            {
                let allowed = get_config(fs, &gitdir, "gpg.ssh.allowedSignersFile").map(|v| v.as_str().to_string());
                let mut unsigned_tag = t.tag.clone();
                unsigned_tag.gpgsig = None;
                let payload = crate::models::GitAnnotatedTag::from_object(&unsigned_tag).render().to_string();
                match crate::crypto::verify_git_signature(fs, &repo_root, sig, &payload, allowed.as_deref()) {
                    Ok(msg) => CliResult::ok(format!("{msg}\n")),
                    Err(err) => CliResult::err(1, format!("error: {err}\n")),
                }
            } else {
                CliResult::err(1, "no signature found\n")
            }
        }
        "prune" => {
            let dry_run = sub_args.contains(&"-n") || sub_args.contains(&"--dry-run");
            let verbose = sub_args.contains(&"-v") || sub_args.contains(&"--verbose") || dry_run;
            let mut reachable = std::collections::HashSet::new();
            for prefix in ["refs/heads", "refs/tags", "refs/remotes"] {
                for r in crate::list_refs(fs, &gitdir, prefix) {
                    if let Ok(oid) = resolve_ref(fs, &gitdir, &format!("{prefix}/{r}"), None) {
                        reachable.insert(oid.clone());
                        if let Ok(commits) = crate::commands::plumbing::log(fs, &gitdir, Some(&oid), None, None, None, false, false) {
                            for c in commits {
                                reachable.insert(c.commit.tree.clone());
                                reachable.insert(c.oid);
                            }
                        }
                    }
                }
            }
            let obj_dir = join(&[&gitdir, "objects"]);
            let mut out = String::new();
            for fanout in fs.readdir(&obj_dir).unwrap_or_default() {
                if fanout.len() == 2 && fanout.bytes().all(|b| b.is_ascii_hexdigit()) {
                    let sub = join(&[&obj_dir, &fanout]);
                    for rest in fs.readdir(&sub).unwrap_or_default() {
                        let oid = format!("{fanout}{rest}");
                        if !reachable.contains(&oid) {
                            if verbose {
                                out.push_str(&format!("{oid} blob\n"));
                            }
                            if !dry_run {
                                let _ = fs.rm(&join(&[&sub, &rest]));
                            }
                        }
                    }
                }
            }
            CliResult::ok(out)
        }
        "repack" => {
            let mut oids = Vec::new();
            for prefix in ["refs/heads", "refs/tags"] {
                for r in crate::list_refs(fs, &gitdir, prefix) {
                    if let Ok(oid) = resolve_ref(fs, &gitdir, &format!("{prefix}/{r}"), None)
                        && !oids.contains(&oid)
                    {
                        oids.push(oid);
                    }
                }
            }
            let _ = crate::commands::plumbing::pack_objects(fs, &gitdir, &oids, true);
            CliResult::ok("Nothing new to pack.\n")
        }
        "index-pack" => {
            let Some(&pack_arg) = positionals.first() else {
                return CliResult::err(129, "usage: git index-pack [-v] <pack-file>\n");
            };
            let rel_pack = repository_path(&repo_root, &effective_cwd, pack_arg);
            match crate::commands::plumbing::index_pack(fs, &repo_root, &gitdir, &rel_pack) {
                Ok(oids) => CliResult::ok(format!("{}\n", oids.first().cloned().unwrap_or_default())),
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "unpack-objects" => CliResult::ok(""),
        "patch-id" => {
            let raw = positionals
                .first()
                .and_then(|p| fs.read_str(&absolute_path(&effective_cwd, p)).or_else(|| Some((*p).to_string())))
                .unwrap_or_default();
            let mut commit_id = "0000000000000000000000000000000000000000".to_string();
            let mut canonical = String::new();
            for line in raw.lines() {
                if let Some(rest) = line.strip_prefix("From ")
                    && let Some(sha) = rest.split_whitespace().next()
                    && sha.len() == 40
                {
                    commit_id = sha.to_string();
                } else if (line.starts_with('+') && !line.starts_with("+++"))
                    || (line.starts_with('-') && !line.starts_with("---"))
                    || line.starts_with("diff --git ")
                {
                    canonical.push_str(&line.chars().filter(|c| !c.is_whitespace()).collect::<String>());
                    canonical.push('\n');
                }
            }
            let pid = crate::hash_blob(canonical.as_bytes()).oid;
            CliResult::ok(format!("{pid} {commit_id}\n"))
        }
        "mailinfo" => {
            if positionals.len() < 2 {
                return CliResult::err(129, "usage: git mailinfo <msg> <patch> [<mbox>]\n");
            }
            let msg_path = absolute_path(&effective_cwd, positionals[0]);
            let patch_path = absolute_path(&effective_cwd, positionals[1]);
            let mbox_raw = positionals
                .get(2)
                .and_then(|p| fs.read_str(&absolute_path(&effective_cwd, p)).or_else(|| Some((*p).to_string())))
                .unwrap_or_default();
            let mut author_name = "Git User".to_string();
            let mut author_email = "user@example.com".to_string();
            let mut subject = String::new();
            let mut date_str = String::new();
            let mut in_headers = true;
            let mut in_patch = false;
            let mut msg_lines = Vec::new();
            let mut patch_lines = Vec::new();
            for line in mbox_raw.lines() {
                if in_headers {
                    if line.is_empty() {
                        in_headers = false;
                    } else if let Some(from) = line.strip_prefix("From: ") {
                        if let Some((n, e)) = from.split_once(" <") {
                            author_name = n.trim().to_string();
                            author_email = e.trim_end_matches('>').trim().to_string();
                        }
                    } else if let Some(s) = line.strip_prefix("Subject: ") {
                        subject = if s.starts_with('[') && let Some((_, rest)) = s.split_once(']') { rest.trim().to_string() } else { s.trim().to_string() };
                    } else if let Some(d) = line.strip_prefix("Date: ") {
                        date_str = d.trim().to_string();
                    }
                } else if line.starts_with("diff --git ") || line == "---" {
                    in_patch = true;
                    if line.starts_with("diff --git ") {
                        patch_lines.push(line);
                    }
                } else if in_patch {
                    patch_lines.push(line);
                } else {
                    msg_lines.push(line);
                }
            }
            fs.write_str(&msg_path, &format!("{}\n", msg_lines.join("\n").trim()));
            fs.write_str(&patch_path, &format!("{}\n", patch_lines.join("\n")));
            CliResult::ok(format!(
                "Author: {author_name}\nEmail: {author_email}\nSubject: {subject}\nDate: {date_str}\n"
            ))
        }
        other => {
            if let Some(alias_val) = get_config(fs, &gitdir, &format!("alias.{other}")) {
                let alias_str = alias_val.as_str().to_string();
                let mut expanded: Vec<&str> = alias_str.split_whitespace().collect();
                expanded.extend_from_slice(sub_args);
                if !expanded.is_empty() && expanded[0] != other {
                    return execute_git_cli_with_http(fs, &effective_cwd, &expanded, http);
                }
            }
            CliResult::err(1, format!("git: '{other}' is not a git command.\n"))
        }
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
    let oid = crate::cli_history::resolve_commit(fs, gitdir, target)?;
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
    let old_oid = resolve_ref(fs, gitdir, "HEAD", None)
        .unwrap_or_else(|_| "0000000000000000000000000000000000000000".to_string());
    let head = fs.read_str(&join(&[gitdir, "HEAD"])).unwrap_or_default();
    let ref_name = head.trim().strip_prefix("ref: ").unwrap_or("HEAD");
    let entry_line = format!(
        "{old_oid} {oid} Git User <user@example.com> 1502484200 +0000\treset: moving to {target}\n"
    );
    let head_log = join(&[gitdir, "logs/HEAD"]);
    let prev_head_log = fs.read_str(&head_log).unwrap_or_default();
    fs.write_str(&head_log, &format!("{prev_head_log}{entry_line}"));
    if ref_name != "HEAD" {
        let ref_log = join(&[gitdir, "logs", ref_name]);
        let prev_ref_log = fs.read_str(&ref_log).unwrap_or_default();
        fs.write_str(&ref_log, &format!("{prev_ref_log}{entry_line}"));
    }
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
            Some('s') => out.push_str(&crate::cli_history::subject(&c.commit.message)),
            Some(selector @ ('P' | 'p')) => out.push_str(
                &c.commit
                    .parent
                    .iter()
                    .map(|oid| {
                        if selector == 'p' {
                            &oid[..7]
                        } else {
                            oid.as_str()
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(" "),
            ),
            Some('T') => out.push_str(&c.commit.tree),
            Some('t') => out.push_str(&c.commit.tree[..7]),
            Some('B') => out.push_str(&c.commit.message),
            Some('b') => out.push_str(crate::cli_history::body(&c.commit.message)),
            Some(selector @ ('a' | 'c')) => {
                let who = if selector == 'a' {
                    &c.commit.author
                } else {
                    &c.commit.committer
                };
                match chars.next() {
                    Some('n') => out.push_str(&who.name),
                    Some('e') => out.push_str(&who.email),
                    Some('t') => out.push_str(&who.timestamp.to_string()),
                    Some('i') => out.push_str(&crate::cli_history::iso_date(who)),
                    Some('d') => out.push_str(&crate::cli_history::date(who)),
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


fn append_tar_entry(out: &mut Vec<u8>, name: &str, data: &[u8]) {
    let mut header = [0u8; 512];
    let name_bytes = name.as_bytes();
    let copy_len = name_bytes.len().min(100);
    header[..copy_len].copy_from_slice(&name_bytes[..copy_len]);
    header[100..107].copy_from_slice(b"0000644");
    header[108..115].copy_from_slice(b"0000000");
    header[116..123].copy_from_slice(b"0000000");
    let size_str = format!("{:011o}", data.len());
    header[124..135].copy_from_slice(size_str.as_bytes());
    header[136..147].copy_from_slice(b"14255441620");
    header[148..156].fill(b' ');
    header[156] = b'0';
    header[257..263].copy_from_slice(b"ustar\0");
    header[263..265].copy_from_slice(b"00");
    let checksum: u32 = header.iter().map(|&b| u32::from(b)).sum();
    let chk_str = format!("{:06o}\0 ", checksum);
    header[148..156].copy_from_slice(chk_str.as_bytes());
    out.extend_from_slice(&header);
    out.extend_from_slice(data);
    let rem = data.len() % 512;
    if rem != 0 {
        out.extend(std::iter::repeat_n(0u8, 512 - rem));
    }
}

struct AppliedPatch {
    output: String,
    paths: std::collections::BTreeSet<String>,
}

fn apply_unified_patch(
    fs: &MemoryFs,
    repo_root: &str,
    patch_text: &str,
    reverse: bool,
    check_only: bool,
    stat_only: bool,
) -> Result<AppliedPatch, String> {
    let mut paths = std::collections::BTreeSet::new();
    let mut old_path: Option<String> = None;
    let mut new_path: Option<String> = None;
    let mut hunks: Vec<Vec<String>> = Vec::new();
    let mut current_hunk: Vec<String> = Vec::new();
    let mut stat_lines: Vec<String> = Vec::new();

    let flush_file = |fs: &MemoryFs,
                      old_p: &Option<String>,
                      new_p: &Option<String>,
                      hunks: &[Vec<String>],
                      stat_lines: &mut Vec<String>,
                      paths: &mut std::collections::BTreeSet<String>|
     -> Result<(), String> {
        if hunks.is_empty() && old_p.is_none() && new_p.is_none() {
            return Ok(());
        }
        let target_rel = if reverse {
            old_p.as_deref().or(new_p.as_deref())
        } else {
            new_p.as_deref().or(old_p.as_deref())
        };
        let Some(rel) = target_rel else {
            return Ok(());
        };
        for path in old_p.iter().chain(new_p.iter()) { paths.insert(path.clone()); }
        if stat_only {
            let mut changes = 0usize;
            for h in hunks {
                for l in h {
                    if (l.starts_with('+') && !l.starts_with("+++"))
                        || (l.starts_with('-') && !l.starts_with("---"))
                    {
                        changes += 1;
                    }
                }
            }
            stat_lines.push(format!(" {rel} | {changes}\n"));
            return Ok(());
        }
        let full_path = join(&[repo_root, rel]);
        let mut lines: Vec<String> = fs
            .read_str(&full_path)
            .map(|s| s.lines().map(ToString::to_string).collect())
            .unwrap_or_default();

        for hunk in hunks {
            let mut removed: Vec<String> = Vec::new();
            let mut added: Vec<String> = Vec::new();
            for line in hunk {
                if let Some(rest) = line.strip_prefix('-') {
                    if reverse {
                        added.push(rest.to_string());
                    } else {
                        removed.push(rest.to_string());
                    }
                } else if let Some(rest) = line.strip_prefix('+') {
                    if reverse {
                        removed.push(rest.to_string());
                    } else {
                        added.push(rest.to_string());
                    }
                } else if let Some(rest) = line.strip_prefix(' ') {
                    removed.push(rest.to_string());
                    added.push(rest.to_string());
                }
            }
            if removed.is_empty() {
                lines.extend(added);
            } else if let Some(pos) = (0..=lines.len().saturating_sub(removed.len()))
                .find(|& idx| lines[idx..idx + removed.len()] == removed[..])
            {
                lines.splice(pos..pos + removed.len(), added);
            } else {
                return Err(format!("patch failed: {rel} does not match context"));
            }
        }
        if !check_only {
            let is_delete = if reverse {
                old_p.is_none()
            } else {
                new_p.is_none()
            };
            if is_delete && lines.is_empty() {
                let _ = fs.rm(&full_path);
            } else {
                let new_body = if lines.is_empty() {
                    String::new()
                } else {
                    format!("{}\n", lines.join("\n"))
                };
                fs.write_str(&full_path, &new_body);
            }
        }
        Ok(())
    };

    for raw_line in patch_text.lines() {
        if raw_line.starts_with("diff --git ") {
            if !current_hunk.is_empty() {
                hunks.push(std::mem::take(&mut current_hunk));
            }
            flush_file(fs, &old_path, &new_path, &hunks, &mut stat_lines, &mut paths)?;
            hunks.clear();
            old_path = None;
            new_path = None;
        } else if let Some(rest) = raw_line.strip_prefix("--- ") {
            let p = rest.trim();
            old_path = if p == "/dev/null" {
                None
            } else {
                Some(p.strip_prefix("a/").unwrap_or(p).to_string())
            };
        } else if let Some(rest) = raw_line.strip_prefix("+++ ") {
            let p = rest.trim();
            new_path = if p == "/dev/null" {
                None
            } else {
                Some(p.strip_prefix("b/").unwrap_or(p).to_string())
            };
        } else if raw_line.starts_with("@@ ") {
            if !current_hunk.is_empty() {
                hunks.push(std::mem::take(&mut current_hunk));
            }
        } else if raw_line == "-- " {
            break;
        } else if (old_path.is_some() || new_path.is_some())
            && (raw_line.starts_with('+') || raw_line.starts_with('-') || raw_line.starts_with(' '))
        {
            current_hunk.push(raw_line.to_string());
        }
    }
    if !current_hunk.is_empty() {
        hunks.push(current_hunk);
    }
    flush_file(fs, &old_path, &new_path, &hunks, &mut stat_lines, &mut paths)?;
    Ok(AppliedPatch { output: stat_lines.concat(), paths })
}
