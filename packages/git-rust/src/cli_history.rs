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
    let mut oid = resolve_ref(fs, gitdir, base, None).or_else(|_| expand_oid(fs, gitdir, base))?;
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
        out.push_str(&render(
            std::slice::from_ref(c),
            output.format,
            output.abbrev,
        ));
        for (mode_index, mode) in output.modes.iter().enumerate() {
            if output.no_patch {
                break;
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
                let oneline = matches!(output.format, "oneline" | "%h %s");
                if mode_index == 0
                    && !oneline
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
    };
    let mut reverse = false;
    let mut patch = None;
    let mut paths = Vec::new();
    let mut separator = false;
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
        } else if arg == "--abbrev-commit" {
            output.abbrev = true;
        } else if matches!(arg, "-s" | "--no-patch") {
            output.no_patch = true;
        } else if matches!(arg, "-p" | "--patch") {
            patch = Some(true);
            output.no_patch = false;
        } else if matches!(arg, "--name-only" | "--name-status" | "--stat") {
            output.modes.push(match arg {
                "--name-only" => crate::cli_files::DiffMode::Names,
                "--name-status" => crate::cli_files::DiffMode::Status,
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
            Ok(out) => CliResult::ok(out),
            Err(e) => CliResult::err(128, format!("fatal: {}\n", e.message)),
        };
    }
    let result = (|| {
        let history = |rev: &str| {
            log(
                fs,
                gitdir,
                Some(&resolve(
                    fs,
                    gitdir,
                    if rev.is_empty() { "HEAD" } else { rev },
                )?),
                None,
                None,
                None,
                false,
                false,
            )
        };
        let mut commits = if let Some((left, right)) = revision.split_once("...") {
            let a = history(left)?;
            let b = history(right)?;
            let a_ids: BTreeSet<_> = a.iter().map(|c| &c.oid).collect();
            let b_ids: BTreeSet<_> = b.iter().map(|c| &c.oid).collect();
            let common: BTreeSet<_> = a_ids.intersection(&b_ids).map(|id| (*id).clone()).collect();
            let mut commits: Vec<_> = a
                .into_iter()
                .chain(b)
                .filter(|c| !common.contains(&c.oid))
                .collect();
            commits.sort_by(|a, b| {
                b.commit
                    .committer
                    .timestamp
                    .cmp(&a.commit.committer.timestamp)
            });
            commits
        } else if let Some((left, right)) = revision.split_once("..") {
            let excluded: BTreeSet<_> = history(left)?.into_iter().map(|c| c.oid).collect();
            history(right)?
                .into_iter()
                .filter(|c| !excluded.contains(&c.oid))
                .collect()
        } else {
            log(
                fs,
                gitdir,
                Some(&resolve(fs, gitdir, revision)?),
                None,
                if paths.is_empty() { depth } else { None },
                None,
                false,
                false,
            )?
        };
        let mut seen = BTreeSet::new();
        commits.retain(|c| seen.insert(c.oid.clone()));
        let mut selected = Vec::new();
        for c in commits {
            if depth.is_some_and(|n| selected.len() >= n) {
                break;
            }
            if paths.is_empty() || touches_paths(fs, gitdir, &c, &paths)? {
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
                    c.commit.message.lines().next().unwrap_or("")
                ));
                continue;
            }
            if i > 0 {
                out.push('\n');
            }
            out.push_str(&format!(
                "commit {}\nAuthor: {} <{}>\n",
                if abbrev { &c.oid[..7] } else { &c.oid },
                c.commit.author.name,
                c.commit.author.email
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
pub(crate) fn date(author: &crate::utils::Author) -> String {
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
