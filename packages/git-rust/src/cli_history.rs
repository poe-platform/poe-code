use crate::cli::{CliResult, format_commit, repository_path};
use crate::commands::plumbing::{ReadCommitResult, log};
use crate::commands::worktree::collect_tree_map;
use crate::{GitError, MemoryFs, expand_oid, resolve_ref};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) fn resolve(fs: &MemoryFs, gitdir: &str, revision: &str) -> Result<String, GitError> {
    if let Some((rev, path)) = revision.split_once(':') {
        if rev.is_empty() {
            let (stage, path) = if let Some((stage, path)) = path.split_once(':') {
                (
                    stage
                        .parse::<u8>()
                        .map_err(|_| GitError::not_found(revision))?,
                    path,
                )
            } else {
                (0, path)
            };
            return crate::GitIndexManager::acquire(fs, gitdir, |index| {
                index
                    .entries_flat()
                    .into_iter()
                    .find(|entry| entry.path == path && entry.flags.stage == stage)
                    .map(|entry| entry.oid)
                    .ok_or_else(|| GitError::not_found(revision))
            });
        }
        return crate::resolve_filepath(fs, gitdir, &resolve(fs, gitdir, rev)?, path);
    }
    let split = revision.find(['~', '^']).unwrap_or(revision.len());
    let base = &revision[..split];
    let base = if base == "@" { "HEAD" } else { base };
    let mut oid = if let Some((ref_part, brace_rest)) = base.split_once("@{")
        && let Some(inner) = brace_rest.strip_suffix('}')
    {
        let rname = if ref_part.is_empty() || ref_part == "@" { "HEAD" } else { ref_part };
        if inner == "u" || inner == "upstream" {
            let branch_short = if rname == "HEAD" {
                crate::current_branch(fs, gitdir, false, false).ok().flatten().unwrap_or_default()
            } else {
                rname.strip_prefix("refs/heads/").unwrap_or(rname).to_string()
            };
            let remote = crate::commands::plumbing::get_config(fs, gitdir, &format!("branch.{branch_short}.remote"))
                .map(|v| v.as_str().to_string())
                .unwrap_or_else(|| "origin".to_string());
            let merge_ref = crate::commands::plumbing::get_config(fs, gitdir, &format!("branch.{branch_short}.merge"))
                .map(|v| v.as_str().to_string())
                .unwrap_or_else(|| format!("refs/heads/{branch_short}"));
            let remote_branch = merge_ref.strip_prefix("refs/heads/").unwrap_or(&branch_short);
            resolve_ref(fs, gitdir, &format!("refs/remotes/{remote}/{remote_branch}"), None)?
        } else if let Some(neg) = inner.strip_prefix('-')
            && let Ok(nth_prev) = neg.parse::<usize>()
        {
            let prev = previous_branch(fs, gitdir, nth_prev).ok_or_else(|| GitError::not_found(revision))?;
            resolve_ref(fs, gitdir, &prev, None).or_else(|_| expand_oid(fs, gitdir, &prev))?
        } else if let Ok(nth) = inner.parse::<usize>() {
            let log_rel = if rname == "HEAD" || rname.starts_with("refs/") {
                format!("logs/{rname}")
            } else if rname == "stash" {
                "logs/refs/stash".to_string()
            } else {
                format!("logs/refs/heads/{rname}")
            };
            let log_path = format!("{gitdir}/{log_rel}");
            if let Some(text) = fs.read_str(&log_path) {
                let mut lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
                if rname != "stash" {
                    lines.reverse();
                }
                let line = lines.get(nth).ok_or_else(|| GitError::not_found(revision))?;
                let (meta, _) = line.split_once('\t').unwrap_or((line, ""));
                meta.split_whitespace().nth(1).ok_or_else(|| GitError::not_found(revision))?.to_string()
            } else {
                let commits = log(fs, gitdir, Some(rname), None, None, None, false, false)?;
                commits.get(nth).map(|c| c.oid.clone()).ok_or_else(|| GitError::not_found(revision))?
            }
        } else {
            return Err(GitError::not_found(revision));
        }
    } else {
        resolve_ref(fs, gitdir, base, None).or_else(|_| expand_oid(fs, gitdir, base))?
    };
    let mut suffix = &revision[split..];
    while !suffix.is_empty() {
        let operator = suffix.as_bytes()[0];
        suffix = &suffix[1..];
        if operator == b'^' && suffix.starts_with('{') {
            let end = suffix
                .find('}')
                .ok_or_else(|| GitError::not_found(revision))?;
            let kind = &suffix[1..end];
            loop {
                let object = crate::_read_object(fs, gitdir, &oid, "content")?;
                if object.obj_type == "tag" {
                    oid = crate::read_tag(fs, gitdir, &oid)?.tag.object;
                    continue;
                }
                if kind == "tree" {
                    oid = crate::resolve_tree(fs, gitdir, &oid)?.0;
                } else if !kind.is_empty() && kind != object.obj_type {
                    return Err(GitError::not_found(revision));
                }
                break;
            }
            suffix = &suffix[end + 1..];
            if !suffix.is_empty() && !suffix.starts_with(['~', '^']) {
                return Err(GitError::not_found(revision));
            }
            continue;
        }
        if operator != b'^' && operator != b'~' {
            return Err(GitError::not_found(revision));
        }
        let digits = suffix.bytes().take_while(u8::is_ascii_digit).count();
        let count = if digits == 0 {
            1
        } else {
            suffix[..digits]
                .parse::<usize>()
                .map_err(|_| GitError::not_found(revision))?
        };
        suffix = &suffix[digits..];
        if !suffix.is_empty() && !suffix.starts_with(['~', '^']) {
            return Err(GitError::not_found(revision));
        }
        oid = resolve_commit(fs, gitdir, &oid)?;
        if operator == b'^' {
            if count > 0 {
                oid = crate::read_commit(fs, gitdir, &oid)?
                    .commit
                    .parent
                    .get(count - 1)
                    .cloned()
                    .ok_or_else(|| GitError::not_found(revision))?;
            } else {
                crate::read_commit(fs, gitdir, &oid)?;
            }
        } else {
            for _ in 0..count {
                oid = crate::read_commit(fs, gitdir, &oid)?
                    .commit
                    .parent
                    .first()
                    .cloned()
                    .ok_or_else(|| GitError::not_found(revision))?;
            }
        }
    }
    Ok(oid)
}

// Object inspection preserves tag OIDs; commands that update commit refs must peel them.
pub(crate) fn resolve_commit(
    fs: &MemoryFs,
    gitdir: &str,
    revision: &str,
) -> Result<String, GitError> {
    let mut oid = resolve(fs, gitdir, revision)?;
    let mut visited = BTreeSet::new();
    while visited.insert(oid.clone()) {
        let object = crate::_read_object(fs, gitdir, &oid, "content")?;
        match object.obj_type.as_str() {
            "commit" => return Ok(oid),
            "tag" => oid = crate::read_tag(fs, gitdir, &oid)?.tag.object,
            _ => return Err(GitError::not_found(revision)),
        }
    }
    Err(GitError::not_found(revision))
}

pub(crate) fn matches_path(path: &str, paths: &[String]) -> bool {
    paths.is_empty()
        || paths
            .iter()
            .any(|p| p == "." || p == path || path.starts_with(&format!("{p}/")))
}

pub(crate) fn historical_path(fs: &MemoryFs, gitdir: &str, path: &str) -> bool {
    let paths = [path.to_string()];
    if crate::list_files(fs, gitdir, None)
        .unwrap_or_default()
        .iter()
        .any(|p| matches_path(p, &paths))
    {
        return true;
    }
    log(fs, gitdir, Some("HEAD"), None, None, None, false, false)
        .unwrap_or_default()
        .iter()
        .any(|c| {
            crate::list_files(fs, gitdir, Some(&c.oid))
                .unwrap_or_default()
                .iter()
                .any(|p| matches_path(p, &paths))
        })
}

fn touches_paths(
    fs: &MemoryFs,
    gitdir: &str,
    c: &ReadCommitResult,
    paths: &[String],
) -> Result<bool, GitError> {
    let mut current = BTreeMap::new();
    collect_tree_map(fs, gitdir, &c.oid, "", &mut current)?;
    // Git simplifies path-limited merges when any parent has an identical selected tree.
    for parent in c
        .commit
        .parent
        .iter()
        .map(Some)
        .chain(if c.commit.parent.is_empty() {
            Some(None)
        } else {
            None
        })
    {
        let mut previous = BTreeMap::new();
        if let Some(parent) = parent {
            collect_tree_map(fs, gitdir, parent, "", &mut previous)?;
        }
        let changed = current.keys().chain(previous.keys()).any(|p| {
            matches_path(p, paths)
                && current.get(p).map(|e| (&e.mode, &e.oid))
                    != previous.get(p).map(|e| (&e.mode, &e.oid))
        });
        if !changed {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(crate) struct HistoryOutput<'a> {
    pub format: &'a str,
    pub abbrev: bool,
    pub modes: Vec<crate::cli_files::DiffMode>,
    pub no_patch: bool,
    pub skip_merge_diff: bool,
    pub graph: bool,
    pub show_signature: bool,
}

pub(crate) fn render_history(
    fs: &MemoryFs,
    root: &str,
    gitdir: &str,
    commits: &[ReadCommitResult],
    output: &HistoryOutput<'_>,
    paths: &[String],
) -> Result<String, GitError> {
    let mut out = String::new();
    for (i, c) in commits.iter().enumerate() {
        if i > 0
            && (matches!(output.format, "short" | "medium" | "full")
                || output.format.starts_with("format:"))
        {
            out.push('\n');
        }
        let rendered = render(
            std::slice::from_ref(c),
            output.format,
            output.abbrev,
        );
        let rendered = if output.show_signature && let Some(ref sig) = c.commit.gpgsig {
            let allowed = crate::commands::plumbing::get_config(fs, gitdir, "gpg.ssh.allowedSignersFile")
                .map(|v| v.as_str().to_string());
            let sig_status = crate::crypto::verify_git_signature(fs, root, sig, &c.payload, allowed.as_deref())
                .unwrap_or_else(|e| e);
            if let Some(first_nl) = rendered.find('\n') {
                format!("{}\n{sig_status}{}", &rendered[..first_nl], &rendered[first_nl..])
            } else {
                format!("{rendered}\n{sig_status}\n")
            }
        } else {
            rendered
        };
        if output.graph {
            for (li, line) in rendered.lines().enumerate() {
                if li == 0 {
                    out.push_str(&format!("* {line}\n"));
                } else {
                    out.push_str(&format!("| {line}\n"));
                }
            }
        } else {
            out.push_str(&rendered);
        }
        for (mode_index, mode) in output.modes.iter().enumerate() {
            if output.no_patch || (output.skip_merge_diff && c.commit.parent.len() > 1) {
                break;
            }
            // Show's default combined output omits clean merge patches and names.
            // Diffstat still compares against the first parent, as in Git.
            if c.commit.parent.len() > 1 && !matches!(mode, crate::cli_files::DiffMode::Stat) {
                continue;
            }
            let options = crate::cli_files::DiffOptions {
                mode: *mode,
                ..Default::default()
            };
            let diff = crate::cli_files::diff(
                fs,
                root,
                gitdir,
                c.commit
                    .parent
                    .first()
                    .map(String::as_str)
                    .unwrap_or(":empty"),
                &c.oid,
                paths,
                &options,
            )?
            .0;
            if !diff.is_empty() {
                if !out.ends_with('\n') {
                    out.push('\n');
                }
                let oneline = matches!(output.format, "oneline" | "%h %s")
                    || output.format.starts_with("format:");
                if mode_index == 0
                    && c.commit.parent.len() < 2
                    && !matches!(output.format, "oneline" | "%h %s")
                    && matches!(mode, crate::cli_files::DiffMode::Stat)
                    && output
                        .modes
                        .iter()
                        .any(|m| matches!(m, crate::cli_files::DiffMode::Patch))
                {
                    out.push_str("---\n");
                } else if mode_index > 0 || !oneline {
                    out.push('\n');
                }
                out.push_str(&diff);
            }
        }
    }
    Ok(out)
}

pub(crate) fn execute(
    fs: &MemoryFs,
    root: &str,
    gitdir: &str,
    cwd: &str,
    args: &[&str],
    show: bool,
) -> CliResult {
    let mut depth = None;
    let mut revision = "HEAD";
    let mut output = HistoryOutput {
        format: "medium",
        abbrev: false,
        modes: Vec::new(),
        no_patch: false,
        skip_merge_diff: !show,
        graph: false,
        show_signature: false,
    };
    let mut reverse = false;
    let mut patch = None;
    let mut paths = Vec::new();
    let mut separator = false;
    let mut author_filters = Vec::new();
    let mut grep_filters = Vec::new();
    let mut all_match = false;
    let mut fixed_strings = false;
    let mut grep_ignore_case = false;
    let mut no_merges = false;
    let mut merges_only = false;
    let mut first_parent = false;
    let mut all_refs = false;
    let mut skip_count = 0usize;
    let mut follow = false;
    let mut i = 0;
    while i < args.len() {
        let arg = args[i];
        if separator {
            paths.push(repository_path(root, cwd, arg));
        } else if arg == "--" {
            separator = true;
        } else if arg == "--oneline" {
            output.format = "%h %s";
            output.abbrev = true;
        } else if matches!(arg, "--format" | "--pretty") {
            i += 1;
            let Some(value) = args.get(i) else {
                return CliResult::err(129, "error: missing format\n");
            };
            output.format = value;
        } else if let Some(value) = arg
            .strip_prefix("--format=")
            .or_else(|| arg.strip_prefix("--pretty="))
        {
            output.format = value;
        } else if arg == "-n"
            || arg == "--max-count"
            || arg.starts_with("--max-count=")
            || arg.starts_with("-n")
            || arg
                .strip_prefix('-')
                .is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        {
            let value = if arg == "-n" || arg == "--max-count" {
                i += 1;
                args.get(i).copied().unwrap_or("")
            } else {
                arg.strip_prefix("--max-count=")
                    .or_else(|| arg.strip_prefix("-n"))
                    .unwrap_or(&arg[1..])
            };
            let Ok(count) = value.parse::<usize>() else {
                return CliResult::err(129, "error: invalid maximum commit count\n");
            };
            depth = Some(count);
        } else if arg == "--reverse" {
            reverse = true;
        } else if let Some(val) = arg.strip_prefix("--author=") {
            author_filters.push(val);
        } else if arg == "--author" && i + 1 < args.len() {
            i += 1;
            author_filters.push(args[i]);
        } else if let Some(val) = arg.strip_prefix("--grep=") {
            grep_filters.push(val);
        } else if arg == "--grep" && i + 1 < args.len() {
            i += 1;
            grep_filters.push(args[i]);
        } else if arg == "--all-match" {
            all_match = true;
        } else if matches!(arg, "-F" | "--fixed-strings") {
            fixed_strings = true;
        } else if matches!(arg, "-E" | "--extended-regexp" | "--basic-regexp") {
            // Accept Git's regex modes. The engine supports alternation and anchors.
        } else if matches!(arg, "-i" | "--regexp-ignore-case") {
            grep_ignore_case = true;
        } else if arg == "--no-merges" {
            no_merges = true;
        } else if arg == "--merges" {
            merges_only = true;
        } else if arg == "--first-parent" {
            first_parent = true;
        } else if arg == "--all" {
            all_refs = true;
        } else if arg == "--follow" {
            follow = true;
        } else if let Some(val) = arg.strip_prefix("--skip=") {
            skip_count = val.parse::<usize>().unwrap_or(0);
        } else if arg == "--skip" && i + 1 < args.len() {
            i += 1;
            skip_count = args[i].parse::<usize>().unwrap_or(0);
        } else if arg == "--graph" {
            output.graph = true;
        } else if arg == "--show-signature" {
            output.show_signature = true;
        } else if arg == "--abbrev-commit" {
            output.abbrev = true;
        } else if matches!(arg, "-s" | "--no-patch") {
            output.no_patch = true;
            output.modes.clear();
            patch = Some(false);
        } else if matches!(arg, "-p" | "--patch") {
            patch = Some(true);
            output.no_patch = false;
        } else if matches!(arg, "--name-only" | "--name-status" | "--stat" | "--shortstat" | "--numstat") {
            if output.no_patch && !matches!(arg, "--stat" | "--shortstat" | "--numstat") {
                return CliResult::err(
                    128,
                    "fatal: options '--name-only', '--name-status', '--check', and '-s' cannot be used together\n",
                );
            }
            if matches!(arg, "--stat" | "--shortstat" | "--numstat") {
                output.no_patch = false;
            }
            output.modes.push(match arg {
                "--name-only" => crate::cli_files::DiffMode::Names,
                "--name-status" => crate::cli_files::DiffMode::Status,
                "--shortstat" => crate::cli_files::DiffMode::ShortStat,
                "--numstat" => crate::cli_files::DiffMode::NumStat,
                _ => crate::cli_files::DiffMode::Stat,
            });
        } else if arg.starts_with('-') {
            return CliResult::err(129, format!("error: unknown option '{arg}'\n"));
        } else if paths.is_empty() && (arg.contains("..") || resolve(fs, gitdir, arg).is_ok()) {
            revision = arg;
        } else if fs.exists(&crate::utils::join(&[cwd, arg]))
            || historical_path(fs, gitdir, &repository_path(root, cwd, arg))
        {
            paths.push(repository_path(root, cwd, arg));
        } else {
            return CliResult::err(
                128,
                format!("fatal: ambiguous argument '{arg}': unknown revision or path\n"),
            );
        }
        i += 1;
    }
    if depth == Some(0) {
        return CliResult::ok("");
    }
    let names_only = output.modes.iter().any(|m| {
        matches!(
            m,
            crate::cli_files::DiffMode::Names | crate::cli_files::DiffMode::Status
        )
    });
    if !names_only && patch.unwrap_or(show && output.modes.is_empty()) {
        output.modes.push(crate::cli_files::DiffMode::Patch);
    }
    if show {
        return match crate::cli_files::show(fs, root, gitdir, revision, &output, &paths) {
            Ok(out) => CliResult::ok_bytes(out),
            Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
        };
    }
    let result = (|| {
        let compile = |patterns: &[&str]| -> Result<Vec<regex::Regex>, GitError> {
            patterns.iter().map(|p| {
                let pattern = if fixed_strings { regex::escape(p) } else { p.to_string() };
                regex::RegexBuilder::new(&pattern).case_insensitive(grep_ignore_case).multi_line(true).build()
                    .map_err(|e| GitError::internal(&format!("invalid pattern: {e}")))
            }).collect()
        };
        let authors = compile(&author_filters)?;
        let greps = compile(&grep_filters)?;
        let unfiltered_depth = if !reverse
            && !no_merges
            && !merges_only
            && authors.is_empty()
            && greps.is_empty()
            && paths.is_empty()
            && !all_refs
            && !revision.contains("..")
        {
            depth.map(|d| d.saturating_add(skip_count))
        } else {
            None
        };
        let history = |rev: &str| -> Result<Vec<ReadCommitResult>, GitError> {
            let oid = resolve(fs, gitdir, if rev.is_empty() { "HEAD" } else { rev })?;
            if first_parent {
                let shallow = crate::GitShallowManager::read(fs, gitdir);
                let mut list = Vec::new();
                let mut cur = Some(oid);
                let mut seen = BTreeSet::new();
                while let Some(oid) = cur {
                    if unfiltered_depth.is_some_and(|max| list.len() >= max) {
                        break;
                    }
                    if !seen.insert(oid.clone()) { break; }
                    let c = crate::read_commit(fs, gitdir, &oid)?;
                    cur = if shallow.contains(&oid) { None } else { c.commit.parent.first().cloned() };
                    list.push(c);
                }
                Ok(list)
            } else {
                log(fs, gitdir, Some(&oid), None, unfiltered_depth, None, false, false)
            }
        };
        let ancestors = |rev: &str| -> Result<BTreeSet<String>, GitError> {
            Ok(log(fs, gitdir, Some(&resolve(fs, gitdir, if rev.is_empty() { "HEAD" } else { rev })?), None, None, None, false, false)?.into_iter().map(|c| c.oid).collect())
        };
        let mut excluded = BTreeSet::new();
        let mut tips = Vec::new();
        let walk_range = !first_parent && !all_refs && revision.contains("..");
        if !walk_range {
            if let Some((left, right)) = revision.split_once("...") {
                let a = ancestors(left)?;
                let b = ancestors(right)?;
                excluded.extend(a.intersection(&b).cloned());
                tips.extend([left, right]);
            } else if let Some((left, right)) = revision.split_once("..") {
                excluded = ancestors(left)?;
                tips.push(right);
            } else {
                tips.push(revision);
            }
        }
        let mut commits = Vec::new();
        if all_refs {
            for r in crate::list_refs(fs, gitdir, "refs") {
                if let Ok(list) = history(&format!("refs/{r}")) { commits.extend(list); }
            }
        }
        if walk_range {
            commits.extend(log_revision_range(fs, gitdir, revision, None)?);
        } else {
            for tip in tips {
                if !first_parent && !all_refs && !revision.contains("..") {
                    let follow_path = if follow && paths.len() == 1 { Some(paths[0].as_str()) } else { None };
                    commits.extend(log(fs, gitdir, Some(&resolve(fs, gitdir, tip)?), follow_path, unfiltered_depth, None, false, follow && follow_path.is_some())?);
                } else {
                    commits.extend(history(tip)?);
                }
            }
        }
        commits.retain(|c| !excluded.contains(&c.oid));
        if all_refs || (!walk_range && revision.contains("...")) {
            commits.sort_by_key(|c| std::cmp::Reverse(c.commit.committer.timestamp));
        }
        let mut seen = BTreeSet::new();
        commits.retain(|c| seen.insert(c.oid.clone()));
        let mut selected = Vec::new();
        let mut matched_so_far = 0usize;
        for c in commits {
            if depth.is_some_and(|n| selected.len() >= n) {
                break;
            }
            if no_merges && c.commit.parent.len() > 1 {
                continue;
            }
            if merges_only && c.commit.parent.len() <= 1 {
                continue;
            }
            if !authors.is_empty() && !authors.iter().any(|r| r.is_match(&format!("{} <{}>", c.commit.author.name, c.commit.author.email))) { continue; }
            if !greps.is_empty() {
                let matched = if all_match { greps.iter().all(|r| r.is_match(&c.commit.message)) } else { greps.iter().any(|r| r.is_match(&c.commit.message)) };
                if !matched { continue; }
            }
            let path_ok = (follow && paths.len() == 1) || paths.is_empty() || touches_paths(fs, gitdir, &c, &paths)?;
            if path_ok {
                if matched_so_far < skip_count {
                    matched_so_far += 1;
                    continue;
                }
                matched_so_far += 1;
                selected.push(c);
            }
        }
        if reverse {
            selected.reverse();
        }
        render_history(fs, root, gitdir, &selected, &output, &paths)
    })();
    match result {
        Ok(out) => CliResult::ok(out),
        Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
    }
}

fn render(commits: &[ReadCommitResult], format: &str, abbrev: bool) -> String {
    let mut out = String::new();
    let preset = matches!(format, "oneline" | "short" | "medium" | "full");
    for (i, c) in commits.iter().enumerate() {
        if preset {
            if format == "oneline" {
                out.push_str(&format!(
                    "{} {}\n",
                    if abbrev { &c.oid[..7] } else { &c.oid },
                    subject(&c.commit.message)
                ));
                continue;
            }
            if i > 0 {
                out.push('\n');
            }
            out.push_str(&format!(
                "commit {}\n",
                if abbrev { &c.oid[..7] } else { &c.oid },
            ));
            if c.commit.parent.len() > 1 {
                out.push_str(&format!(
                    "Merge: {}\n",
                    c.commit
                        .parent
                        .iter()
                        .map(|oid| &oid[..7])
                        .collect::<Vec<_>>()
                        .join(" ")
                ));
            }
            out.push_str(&format!(
                "Author: {} <{}>\n",
                c.commit.author.name, c.commit.author.email
            ));
            if format == "medium" {
                out.push_str(&format!("Date:   {}\n", date(&c.commit.author)));
            }
            if format == "full" {
                out.push_str(&format!(
                    "Commit: {} <{}>\n",
                    c.commit.committer.name, c.commit.committer.email
                ));
            }
            out.push('\n');
            let message = if format == "short" {
                c.commit.message.split("\n\n").next().unwrap_or("")
            } else {
                c.commit.message.trim_end()
            };
            for line in message.lines() {
                out.push_str(&format!("    {line}\n"));
            }
        } else {
            let terminate = !format.starts_with("format:");
            if i > 0 && !terminate {
                out.push('\n');
            }
            let template = format
                .strip_prefix("format:")
                .or_else(|| format.strip_prefix("tformat:"))
                .unwrap_or(format);
            out.push_str(&format_commit(c, template));
            if terminate {
                out.push('\n');
            }
        }
    }
    out
}

// Civil date conversion uses integer arithmetic so native and WASM builds agree.
fn calendar(author: &crate::utils::Author) -> (i64, i64, i64, i64, i64, i64) {
    let offset = -(author.timezone_offset as i64);
    let seconds = author.timestamp + offset * 60;
    let days = seconds.div_euclid(86400);
    let time = seconds.rem_euclid(86400);
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + i64::from(month <= 2);
    (year, month, day, days, time, offset)
}

pub(crate) fn iso_date(author: &crate::utils::Author) -> String {
    let (year, month, day, _, time, offset) = calendar(author);
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02} {}{:02}{:02}",
        time / 3600,
        time / 60 % 60,
        time % 60,
        if offset < 0 { '-' } else { '+' },
        offset.abs() / 60,
        offset.abs() % 60
    )
}

pub(crate) fn body(message: &str) -> &str {
    let mut lines = message.split_inclusive('\n');
    // Ignore leading blank lines and consume the entire subject paragraph.
    for line in lines.by_ref().skip_while(|line| line.trim().is_empty()) {
        if line.trim().is_empty() {
            break;
        }
    }
    let mut offset = message.len();
    for line in lines {
        offset -= line.len();
    }
    let remainder = &message[offset..];
    let blanks = remainder
        .split_inclusive('\n')
        .take_while(|line| line.trim().is_empty())
        .map(str::len)
        .sum::<usize>();
    &remainder[blanks..]
}

pub(crate) fn subject(message: &str) -> String {
    message
        .lines()
        .skip_while(|line| line.trim().is_empty())
        .take_while(|line| !line.trim().is_empty())
        .map(str::trim)
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn date(author: &crate::utils::Author) -> String {
    let (year, month, day, days, time, offset) = calendar(author);
    let weekdays = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
    let months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    format!(
        "{} {} {} {:02}:{:02}:{:02} {} {}{:02}{:02}",
        weekdays[days.rem_euclid(7) as usize],
        months[(month - 1) as usize],
        day,
        time / 3600,
        time / 60 % 60,
        time % 60,
        year,
        if offset < 0 { '-' } else { '+' },
        offset.abs() / 60,
        offset.abs() % 60
    )
}


pub(crate) fn previous_branch(fs: &MemoryFs, gitdir: &str, nth: usize) -> Option<String> {
    if nth == 0 {
        return None;
    }
    let log_path = format!("{gitdir}/logs/HEAD");
    let text = fs.read_str(&log_path)?;
    let mut found = 0usize;
    for line in text.lines().rev() {
        if let Some((_, msg)) = line.split_once("\tcheckout: moving from ")
            && let Some((from, _)) = msg.split_once(" to ")
        {
            found += 1;
            if found == nth {
                return Some(from.trim().to_string());
            }
        }
    }
    None
}

// Empty range endpoints name HEAD, as in Git's revision syntax.
fn revision_range(revision: &str) -> Option<(&str, &str, bool)> {
    let (left, right, symmetric) = if let Some((left, right)) = revision.split_once("...") {
        (left, right, true)
    } else {
        let (left, right) = revision.split_once("..")?;
        (left, right, false)
    };
    Some((
        if left.is_empty() { "HEAD" } else { left },
        if right.is_empty() { "HEAD" } else { right },
        symmetric,
    ))
}

fn log_revision_range(
    fs: &MemoryFs,
    gitdir: &str,
    revision: &str,
    depth: Option<usize>,
) -> Result<Vec<crate::commands::plumbing::ReadCommitResult>, crate::GitError> {
    let Some((left, right, symmetric)) = revision_range(revision) else {
        return log(fs, gitdir, Some(revision), None, depth, None, false, false);
    };
    let left = resolve(fs, gitdir, left)?;
    let right = resolve(fs, gitdir, right)?;
    let shallow = crate::GitShallowManager::read(fs, gitdir);
    let mut left_history = std::collections::BTreeMap::new();
    let mut right_history = std::collections::BTreeMap::new();
    for (tip, history) in [(&left, &mut left_history), (&right, &mut right_history)] {
        let mut pending = vec![tip.clone()];
        while let Some(oid) = pending.pop() {
            if history.contains_key(&oid) {
                continue;
            }
            let c = crate::commands::plumbing::read_commit(fs, gitdir, &oid)?;
            if !shallow.contains(&oid) {
                pending.extend(c.commit.parent.iter().cloned());
            }
            history.insert(oid, c);
        }
    }
    let tips = if symmetric {
        vec![left, right]
    } else {
        vec![right]
    };
    let left_ids: std::collections::BTreeSet<_> = left_history.keys().cloned().collect();
    let right_ids: std::collections::BTreeSet<_> = right_history.keys().cloned().collect();
    let mut remaining: std::collections::BTreeMap<_, _> = right_history
        .into_iter()
        .filter(|(oid, _)| !left_ids.contains(oid))
        .collect();
    if symmetric {
        remaining.extend(
            left_history
                .into_iter()
                .filter(|(oid, _)| !right_ids.contains(oid)),
        );
    }
    let mut pending = std::collections::BinaryHeap::new();
    let mut scheduled = std::collections::BTreeSet::new();
    for oid in tips {
        if let Some(c) = remaining.get(&oid)
            && scheduled.insert(oid.clone())
        {
            pending.push((
                c.commit.committer.timestamp,
                std::cmp::Reverse(scheduled.len()),
                oid,
            ));
        }
    }
    let mut commits = Vec::new();
    while let Some((_, _, oid)) = pending.pop() {
        let c = remaining.remove(&oid).expect("scheduled commits exist");
        if !shallow.contains(&oid) {
            for parent in &c.commit.parent {
                if let Some(p) = remaining.get(parent)
                    && scheduled.insert(parent.clone())
                {
                    pending.push((
                        p.commit.committer.timestamp,
                        std::cmp::Reverse(scheduled.len()),
                        parent.clone(),
                    ));
                }
            }
        }
        commits.push(c);
        if depth.is_some_and(|depth| commits.len() >= depth) {
            break;
        }
    }
    Ok(commits)
}
