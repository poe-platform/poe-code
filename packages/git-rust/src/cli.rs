use crate::commands::network::{clone, fetch, pull, push};
use crate::commands::plumbing::{
    add_remote, annotated_tag, branch, delete_branch, delete_remote, delete_tag, find_root,
    get_config, init, list_remotes, log, read_blob, read_commit, read_tag, read_tree, set_config,
    tag, write_blob,
};
use crate::commands::worktree::{
    abort_merge, add, checkout, cherry_pick, commit, list_files, merge, remove, reset_index, stash,
    status_matrix,
};
use crate::fs::MemoryFs;
use crate::http::{HttpClient, MockHttpServer};
use crate::utils::{join, Author};
use crate::{
    current_branch, discover_gitdir, expand_oid, list_branches, list_tags, resolve_ref, version,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl CliResult {
    pub fn ok(stdout: impl Into<String>) -> Self {
        Self {
            exit_code: 0,
            stdout: stdout.into(),
            stderr: String::new(),
        }
    }

    pub fn err(code: i32, stderr: impl Into<String>) -> Self {
        Self {
            exit_code: code,
            stdout: String::new(),
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
            Ok(()) => CliResult::ok(format!("Initialized empty Git repository in {target_dir}/.git/\n")),
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
            let short = sub_args.contains(&"-s") || sub_args.contains(&"--short");
            match status_matrix(fs, &repo_root, Some(&gitdir), None, None) {
                Ok(rows) => {
                    if short {
                        let mut out = String::new();
                        for (path, head, workdir, stage) in rows {
                            if head == 1 && workdir == 1 && stage == 1 {
                                continue;
                            }
                            let idx_char = match (head, stage) {
                                (0, 2) => 'A',
                                (1, 0) => 'D',
                                (1, 2) => 'M',
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
                    paths.push(a.to_string());
                } else if a == "-A" || a == "--all" {
                    paths.push(".".to_string());
                }
            }
            if paths.is_empty() {
                paths.push(".".to_string());
            }
            match add(fs, &repo_root, Some(&gitdir), &paths, false) {
                Ok(()) => CliResult::ok(""),
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "rm" => {
            for &a in sub_args {
                if !a.starts_with('-') {
                    if let Err(e) = remove(fs, &gitdir, a) {
                        return CliResult::err(128, format!("fatal: {}\n", e.message));
                    }
                    let _ = fs.rm(&join(&[&repo_root, a]));
                }
            }
            CliResult::ok("")
        }
        "reset" => {
            for &a in sub_args {
                if !a.starts_with('-') && a != "HEAD" {
                    let _ = reset_index(fs, Some(&repo_root), &gitdir, a, None);
                }
            }
            CliResult::ok("")
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
        "log" => {
            let oneline = sub_args.contains(&"--oneline");
            match log(fs, &gitdir, Some("HEAD"), None, None, None, false, false) {
                Ok(commits) => {
                    let mut out = String::new();
                    for c in commits {
                        if oneline {
                            let first_line = c.commit.message.lines().next().unwrap_or("");
                            out.push_str(&format!("{} {}\n", &c.oid[..7], first_line));
                        } else {
                            out.push_str(&format!(
                                "commit {}\nAuthor: {} <{}>\n\n    {}\n",
                                c.oid,
                                c.commit.author.name,
                                c.commit.author.email,
                                c.commit.message.trim()
                            ));
                        }
                    }
                    CliResult::ok(out)
                }
                Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
            }
        }
        "branch" => {
            if sub_args.is_empty() {
                let curr = current_branch(fs, &gitdir, false, false).ok().flatten();
                let branches = list_branches(fs, &gitdir, None);
                let mut out = String::new();
                for b in branches {
                    if Some(&b) == curr.as_ref() {
                        out.push_str(&format!("* {b}\n"));
                    } else {
                        out.push_str(&format!("  {b}\n"));
                    }
                }
                CliResult::ok(out)
            } else if (sub_args[0] == "-d" || sub_args[0] == "-D") && sub_args.len() > 1 {
                match delete_branch(fs, &gitdir, sub_args[1]) {
                    Ok(()) => CliResult::ok(format!("Deleted branch {}.\n", sub_args[1])),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            } else {
                let name = sub_args[0];
                let start = sub_args.get(1).copied();
                match branch(fs, &gitdir, name, start, false, false) {
                    Ok(()) => CliResult::ok(""),
                    Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
                }
            }
        }
        "checkout" | "switch" => {
            let mut create_new = false;
            let mut force = false;
            let mut target = None;
            let mut i = 0;
            while i < sub_args.len() {
                match sub_args[i] {
                    "-b" | "-c" => create_new = true,
                    "-f" | "--force" => force = true,
                    arg if !arg.starts_with('-')
                        && target.is_none() => {
                            target = Some(arg);
                        }
                    _ => {}
                }
                i += 1;
            }
            let Some(ref_target) = target else {
                return CliResult::err(128, "fatal: missing branch or commit argument\n");
            };
            if create_new
                && let Err(e) = branch(fs, &gitdir, ref_target, None, true, false) {
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
                match annotated_tag(fs, &gitdir, name, Some(msg), None, Some(tagger), None, false) {
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
                        out.push_str(&format!("{}\t{} (fetch)\n{}\t{} (push)\n", r.remote, r.url, r.remote, r.url));
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
            let non_flags: Vec<&str> = sub_args.iter().copied().filter(|a| !a.starts_with('-')).collect();
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
            let Some(&target) = sub_args.last() else {
                return CliResult::err(128, "fatal: missing revision\n");
            };
            if let Ok(oid) = resolve_ref(fs, &gitdir, target, None) {
                CliResult::ok(format!("{oid}\n"))
            } else if let Ok(oid) = expand_oid(fs, &gitdir, target) {
                CliResult::ok(format!("{oid}\n"))
            } else {
                CliResult::err(128, format!("fatal: ambiguous argument '{target}'\n"))
            }
        }
        "cat-file" => {
            let Some(&oid_arg) = sub_args.last() else {
                return CliResult::err(128, "fatal: missing object\n");
            };
            let oid = resolve_ref(fs, &gitdir, oid_arg, None)
                .or_else(|_| expand_oid(fs, &gitdir, oid_arg))
                .unwrap_or_else(|_| oid_arg.to_string());
            if let Ok(b) = read_blob(fs, &gitdir, &oid, None) {
                CliResult::ok(String::from_utf8_lossy(&b.blob).to_string())
            } else if let Ok(c) = read_commit(fs, &gitdir, &oid) {
                CliResult::ok(format!("tree {}\n\n{}", c.commit.tree, c.commit.message))
            } else if let Ok(t) = read_tree(fs, &gitdir, &oid, None) {
                let mut out = String::new();
                for e in t.tree {
                    out.push_str(&format!("{} {} {}\t{}\n", e.mode, e.entry_type, e.oid, e.path));
                }
                CliResult::ok(out)
            } else if let Ok(tg) = read_tag(fs, &gitdir, &oid) {
                CliResult::ok(format!("object {}\ntag {}\n\n{}", tg.tag.object, tg.tag.tag, tg.tag.message))
            } else {
                CliResult::err(128, format!("fatal: Not a valid object name {oid}\n"))
            }
        }
        "hash-object" => {
            let write_flag = sub_args.contains(&"-w");
            let Some(&file_arg) = sub_args.iter().find(|a| !a.starts_with('-')) else {
                return CliResult::err(128, "fatal: missing file\n");
            };
            let full = join(&[&repo_root, file_arg]);
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
            sub_args.first().copied(),
            sub_args.get(1).copied(),
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
                sub_args.get(1).copied(),
                None,
                sub_args.first().copied(),
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
            sub_args.get(1).copied(),
            None,
            sub_args.first().copied(),
            None,
            sub_args.contains(&"-f") || sub_args.contains(&"--force"),
            sub_args.contains(&"--delete") || sub_args.contains(&"-d"),
            None,
            None,
            None,
        ) {
            Ok(_) => CliResult::ok(""),
            Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
        },
        other => CliResult::err(1, format!("git: '{other}' is not a git command.\n")),
    }
}
