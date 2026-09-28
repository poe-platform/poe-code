use crate::commands::plumbing::{read_blob, read_commit};
use crate::commands::worktree::{collect_tree_map, list_files, reset_index};
use crate::utils::join;
use crate::{GitError, GitIndexManager, MemoryFs};
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
    let oid = crate::cli_history::resolve(fs, gitdir, source)?;
    let mut tree = BTreeMap::new();
    collect_tree_map(fs, gitdir, &oid, "", &mut tree)?;
    tree.into_iter()
        .map(|(p, e)| Ok((p, (e.mode, read_blob(fs, gitdir, &e.oid, None)?.blob))))
        .collect()
}

#[derive(Clone, Copy, Default)]
pub(crate) enum DiffMode {
    #[default]
    Patch,
    Names,
    Status,
    Stat,
    ShortStat,
    NumStat,
    DirStat,
    WordDiff,
}
pub(crate) struct DiffOptions {
    pub mode: DiffMode,
    pub context: usize,
    pub quiet: bool,
    pub exit_code: bool,
    pub reverse: bool,
}
impl Default for DiffOptions {
    fn default() -> Self {
        Self {
            mode: DiffMode::Patch,
            context: 3,
            quiet: false,
            exit_code: false,
            reverse: false,
        }
    }
}

pub fn diff(
    fs: &MemoryFs,
    root: &str,
    gitdir: &str,
    before: &str,
    after: &str,
    paths: &[String],
    options: &DiffOptions,
) -> Result<(String, bool), GitError> {
    let (before, after) = if options.reverse { (after, before) } else { (before, after) };
    let old = snapshot(fs, root, gitdir, before)?;
    let new = snapshot(fs, root, gitdir, after)?;
    let names: BTreeSet<_> = old.keys().chain(new.keys()).collect();
    let mut out = String::new();
    let mut changed = false;
    let mut stats = Vec::new();
    for p in names {
        if !crate::cli_history::matches_path(p, paths) {
            continue;
        }
        if old.get(p) == new.get(p) {
            continue;
        }
        changed = true;
        if options.quiet {
            return Ok((String::new(), true));
        }
        match options.mode {
            DiffMode::Names => {
                out.push_str(&format!("{p}\n"));
                continue;
            }
            DiffMode::Status => {
                let status = if !old.contains_key(p) {
                    'A'
                } else if !new.contains_key(p) {
                    'D'
                } else {
                    'M'
                };
                out.push_str(&format!("{status}\t{p}\n"));
                continue;
            }
            _ => {}
        }
        let left = old.get(p).map(|(_, b)| b.as_slice()).unwrap_or_default();
        let right = new.get(p).map(|(_, b)| b.as_slice()).unwrap_or_default();
        if matches!(
            options.mode,
            DiffMode::Stat | DiffMode::ShortStat | DiffMode::NumStat | DiffMode::DirStat
        ) {
            let binary = left.contains(&0) || right.contains(&0);
            let (added, deleted) = if binary {
                (0, 0)
            } else {
                line_counts(left, right)
            };
            stats.push((
                p.to_string(),
                added,
                deleted,
                binary,
                left.len(),
                right.len(),
            ));
            continue;
        }
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
        if matches!(options.mode, DiffMode::WordDiff) {
            for (ol, nl) in a.lines().zip(b.lines()) {
                if ol == nl {
                    out.push_str(&format!(" {ol}\n"));
                } else {
                    out.push_str(&format!("[-{ol}-]{{+{nl}+}}\n"));
                }
            }
            for ol in a.lines().skip(b.lines().count()) {
                out.push_str(&format!("[-{ol}-]\n"));
            }
            for nl in b.lines().skip(a.lines().count()) {
                out.push_str(&format!("{{+{nl}+}}\n"));
            }
        } else {
            out.push_str(&patch(&a, &b, options.context));
        }
    }
    if matches!(options.mode, DiffMode::NumStat) {
        for (path, a, d, binary, _, _) in &stats {
            if *binary {
                out.push_str(&format!("-\t-\t{path}\n"));
            } else {
                out.push_str(&format!("{a}\t{d}\t{path}\n"));
            }
        }
    } else if matches!(options.mode, DiffMode::ShortStat) && !stats.is_empty() {
        let added: usize = stats.iter().map(|s| s.1).sum();
        let deleted: usize = stats.iter().map(|s| s.2).sum();
        out.push_str(&format!(
            " {} file{} changed",
            stats.len(),
            if stats.len() == 1 { "" } else { "s" }
        ));
        if added > 0 {
            out.push_str(&format!(", {added} insertion{}(+)", if added == 1 { "" } else { "s" }));
        }
        if deleted > 0 {
            out.push_str(&format!(", {deleted} deletion{}(-)", if deleted == 1 { "" } else { "s" }));
        }
        out.push('\n');
    } else if matches!(options.mode, DiffMode::DirStat) && !stats.is_empty() {
        let mut dir_totals: BTreeMap<String, usize> = BTreeMap::new();
        let mut grand_total = 0usize;
        for (path, a, d, _, _, _) in &stats {
            let dir = path.split_once('/').map(|(d, _)| format!("{d}/")).unwrap_or_else(|| "/".to_string());
            let delta = (*a + *d).max(1);
            *dir_totals.entry(dir).or_insert(0) += delta;
            grand_total += delta;
        }
        for (dir, total) in dir_totals {
            let pct = (total as f64 * 100.0) / (grand_total.max(1) as f64);
            out.push_str(&format!("  {pct:4.1}% {dir}\n"));
        }
    }
    if matches!(options.mode, DiffMode::Stat) && !stats.is_empty() {
        let width = stats.iter().map(|s| s.0.len()).max().unwrap_or(0);
        let count_width = stats
            .iter()
            .filter(|s| !s.3)
            .map(|s| (s.1 + s.2).to_string().len())
            .max()
            .unwrap_or(1);
        let mut added = 0;
        let mut deleted = 0;
        for (path, a, d, binary, old_len, new_len) in &stats {
            if *binary {
                out.push_str(&format!(
                    " {path:width$} | Bin {old_len} -> {new_len} bytes\n"
                ));
            } else {
                added += a;
                deleted += d;
                let total = a + d;
                let available = 80usize.saturating_sub(width + count_width + 6).max(1);
                let max = stats.iter().map(|s| s.1 + s.2).max().unwrap_or(0);
                let scaled = if max > available {
                    total * available / max
                } else {
                    total
                };
                let plus = if total == 0 {
                    0
                } else {
                    (a * scaled).div_ceil(total)
                };
                out.push_str(&format!(
                    " {path:width$} | {total:count_width$} {}{}\n",
                    "+".repeat(plus),
                    "-".repeat(scaled.saturating_sub(plus))
                ));
            }
        }
        out.push_str(&format!(
            " {} file{} changed",
            stats.len(),
            if stats.len() == 1 { "" } else { "s" }
        ));
        if added > 0 {
            out.push_str(&format!(
                ", {added} insertion{}(+)",
                if added == 1 { "" } else { "s" }
            ));
        }
        if deleted > 0 {
            out.push_str(&format!(
                ", {deleted} deletion{}(-)",
                if deleted == 1 { "" } else { "s" }
            ));
        }
        out.push('\n');
    }
    Ok((out, changed))
}

fn lcs_row(old: &[&str], new: &[&str]) -> Vec<usize> {
    let mut row = vec![0usize; new.len() + 1];
    for a in old {
        let mut diagonal = 0;
        for (j, b) in new.iter().enumerate() {
            let previous = row[j + 1];
            row[j + 1] = if a == b {
                diagonal + 1
            } else {
                row[j + 1].max(row[j])
            };
            diagonal = previous;
        }
    }
    row
}

// Hirschberg alignment keeps memory linear in line count, including large files.
fn matching_lines(old: &[&str], new: &[&str], a: usize, b: usize, pairs: &mut Vec<(usize, usize)>) {
    let mut prefix = 0;
    while prefix < old.len().min(new.len()) && old[prefix] == new[prefix] {
        pairs.push((a + prefix, b + prefix));
        prefix += 1;
    }
    let old = &old[prefix..];
    let new = &new[prefix..];
    let a = a + prefix;
    let b = b + prefix;
    let mut suffix = 0;
    while suffix < old.len().min(new.len())
        && old[old.len() - 1 - suffix] == new[new.len() - 1 - suffix]
    {
        suffix += 1;
    }
    let left = &old[..old.len() - suffix];
    let right = &new[..new.len() - suffix];
    if left.len() == 1 {
        if let Some(j) = right.iter().position(|line| *line == left[0]) {
            pairs.push((a, b + j));
        }
    } else if !left.is_empty() && !right.is_empty() {
        let midpoint = left.len() / 2;
        let forward = lcs_row(&left[..midpoint], right);
        let reverse_old: Vec<_> = left[midpoint..].iter().rev().copied().collect();
        let reverse_new: Vec<_> = right.iter().rev().copied().collect();
        let backward = lcs_row(&reverse_old, &reverse_new);
        let split = (0..=right.len())
            .max_by_key(|j| forward[*j] + backward[right.len() - *j])
            .unwrap_or(0);
        drop(forward);
        drop(backward);
        drop(reverse_old);
        drop(reverse_new);
        matching_lines(&left[..midpoint], &right[..split], a, b, pairs);
        matching_lines(
            &left[midpoint..],
            &right[split..],
            a + midpoint,
            b + split,
            pairs,
        );
    }
    for i in 0..suffix {
        pairs.push((a + left.len() + i, b + right.len() + i));
    }
}

fn line_counts(left: &[u8], right: &[u8]) -> (usize, usize) {
    let a = String::from_utf8_lossy(left);
    let b = String::from_utf8_lossy(right);
    let old: Vec<_> = a.split_inclusive('\n').collect();
    let new: Vec<_> = b.split_inclusive('\n').collect();
    let mut pairs = Vec::new();
    matching_lines(&old, &new, 0, 0, &mut pairs);
    (new.len() - pairs.len(), old.len() - pairs.len())
}

fn patch(a: &str, b: &str, context: usize) -> String {
    let old: Vec<_> = a.split_inclusive('\n').collect();
    let new: Vec<_> = b.split_inclusive('\n').collect();
    let mut pairs = Vec::new();
    matching_lines(&old, &new, 0, 0, &mut pairs);
    let mut lines = Vec::new();
    let (mut i, mut j) = (0, 0);
    for (x, y) in pairs.into_iter().chain(Some((old.len(), new.len()))) {
        while i < x {
            lines.push(('-', old[i]));
            i += 1;
        }
        while j < y {
            lines.push(('+', new[j]));
            j += 1;
        }
        if x < old.len() {
            lines.push((' ', old[x]));
            i += 1;
            j += 1;
        }
    }
    let mut hunks: Vec<(usize, usize)> = Vec::new();
    for (i, (mark, _)) in lines.iter().enumerate() {
        if *mark == ' ' {
            continue;
        }
        let start = i.saturating_sub(context);
        let end = i.saturating_add(context).saturating_add(1).min(lines.len());
        if let Some(last) = hunks.last_mut()
            && start <= last.1
        {
            last.1 = end;
        } else {
            hunks.push((start, end));
        }
    }
    let mut out = String::new();
    let (mut old_line, mut new_line, mut cursor) = (0, 0, 0);
    for (start, end) in hunks {
        for (mark, _) in &lines[cursor..start] {
            old_line += usize::from(*mark != '+');
            new_line += usize::from(*mark != '-');
        }
        let old_count = lines[start..end]
            .iter()
            .filter(|(mark, _)| *mark != '+')
            .count();
        let new_count = lines[start..end]
            .iter()
            .filter(|(mark, _)| *mark != '-')
            .count();
        let range = |line: usize, count: usize| {
            if count == 1 {
                (line + 1).to_string()
            } else {
                format!("{},{}", if count == 0 { line } else { line + 1 }, count)
            }
        };
        let heading = old[..old_line]
            .iter()
            .rev()
            .find(|line| {
                line.as_bytes()
                    .first()
                    .is_some_and(|c| c.is_ascii_alphabetic() || *c == b'_' || *c == b'$')
            })
            .map(|line| format!(" {}", line.trim_end().chars().take(80).collect::<String>()))
            .unwrap_or_default();
        out.push_str(&format!(
            "@@ -{} +{} @@{heading}\n",
            range(old_line, old_count),
            range(new_line, new_count)
        ));
        for (mark, text) in &lines[start..end] {
            out.push(*mark);
            out.push_str(text);
            if !text.ends_with('\n') {
                out.push_str("\n\\ No newline at end of file\n");
            }
        }
        old_line += old_count;
        new_line += new_count;
        cursor = end;
    }
    out
}

pub fn show(
    fs: &MemoryFs,
    root: &str,
    gitdir: &str,
    target: &str,
    output: &crate::cli_history::HistoryOutput<'_>,
    paths: &[String],
) -> Result<Vec<u8>, GitError> {
    let mut oid = crate::cli_history::resolve(fs, gitdir, target)?;
    let mut out = String::new();
    while crate::_read_object(fs, gitdir, &oid, "content")?.obj_type == "tag" {
        let tag = crate::read_tag(fs, gitdir, &oid)?.tag;
        out.push_str(&format!(
            "tag {}\nTagger: {} <{}>\nDate:   {}\n\n{}\n\n",
            tag.tag,
            tag.tagger.name,
            tag.tagger.email,
            crate::cli_history::date(&tag.tagger),
            tag.message
        ));
        if let Some(signature) = tag.gpgsig {
            out.push_str(&signature);
            out.push('\n');
        }
        oid = tag.object;
    }
    match crate::_read_object(fs, gitdir, &oid, "content")?
        .obj_type
        .as_str()
    {
        "blob" => {
            let mut bytes = out.into_bytes();
            bytes.extend(read_blob(fs, gitdir, &oid, None)?.blob);
            return Ok(bytes);
        }
        "tree" => {
            out.push_str(&format!("tree {target}\n\n"));
            for entry in crate::read_tree(fs, gitdir, &oid, None)?.tree {
                out.push_str(&entry.path);
                if entry.entry_type == "tree" {
                    out.push('/');
                }
                out.push('\n');
            }
            return Ok(out.into_bytes());
        }
        _ => {}
    }
    let commit = read_commit(fs, gitdir, &oid)?;
    out.push_str(&crate::cli_history::render_history(
        fs,
        root,
        gitdir,
        &[commit],
        output,
        paths,
    )?);
    Ok(out.into_bytes())
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
    let resolved;
    let source = if source.starts_with(':') {
        source
    } else {
        resolved = crate::cli_history::resolve(fs, gitdir, source)?;
        &resolved
    };
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

fn directory_can_be_cleaned(
    fs: &MemoryFs,
    root: &str,
    gitdir: &str,
    directory: &str,
    include_ignored: bool,
) -> Result<bool, GitError> {
    let base = format!("{}/", root.trim_end_matches('/'));
    let mut pending = vec![directory.to_string()];
    while let Some(directory) = pending.pop() {
        for name in fs
            .readdir(&directory)
            .map_err(|e| GitError::internal(&e.message))?
        {
            if name == ".git" {
                return Ok(false);
            }
            let full = join(&[&directory, &name]);
            let stat = fs
                .lstat(&full)
                .map_err(|e| GitError::internal(&e.message))?;
            let path = full
                .strip_prefix(&base)
                .ok_or_else(|| GitError::internal("clean path outside repository"))?;
            let ignored_path = if stat.is_directory() {
                format!("{path}/")
            } else {
                path.to_string()
            };
            if !include_ignored
                && crate::GitIgnoreManager::is_ignored(fs, root, Some(gitdir), &ignored_path)
            {
                return Ok(false);
            }
            if stat.is_directory() {
                pending.push(full);
            }
        }
    }
    Ok(true)
}

pub fn clean(
    fs: &MemoryFs,
    root: &str,
    gitdir: &str,
    cwd: &str,
    args: &[&str],
    paths: &[String],
) -> Result<String, GitError> {
    let flag = |short: char, long: &str| {
        args.iter().any(|a| {
            *a == long || (a.starts_with('-') && !a.starts_with("--") && a[1..].contains(short))
        })
    };
    let dry = flag('n', "--dry-run");
    if !dry && !flag('f', "--force") {
        return Err(GitError::internal("clean requires -f or -n"));
    }
    let directories = flag('d', "--directories") || !paths.is_empty();
    let ignored = flag('x', "--ignored");
    let tracked = list_files(fs, gitdir, None)?;
    let base = format!("{}/", root.trim_end_matches('/'));
    let display_base = format!("{}/", cwd.trim_end_matches('/'));
    let mut pending = vec![cwd.to_string()];
    let mut candidates = Vec::new();
    while let Some(directory) = pending.pop() {
        for name in fs
            .readdir(&directory)
            .map_err(|e| GitError::internal(&e.message))?
        {
            if name == ".git" {
                continue;
            }
            let full = join(&[&directory, &name]);
            let Some(path) = full.strip_prefix(&base) else {
                continue;
            };
            let stat = fs
                .lstat(&full)
                .map_err(|e| GitError::internal(&e.message))?;
            let selected = paths.is_empty()
                || paths
                    .iter()
                    .any(|f| f == "." || path == f || path.starts_with(&format!("{f}/")));
            let tracked_entry = tracked
                .iter()
                .any(|p| p == path || p.starts_with(&format!("{path}/")));
            let ignored_path = if stat.is_directory() {
                format!("{path}/")
            } else {
                path.to_string()
            };
            if !tracked_entry
                && !ignored
                && crate::GitIgnoreManager::is_ignored(fs, root, Some(gitdir), &ignored_path)
            {
                continue;
            }
            if stat.is_directory() {
                if fs.exists(&join(&[&full, ".git"])) {
                    continue;
                }
                if !tracked_entry
                    && selected
                    && directories
                    && directory_can_be_cleaned(fs, root, gitdir, &full, ignored)?
                {
                    candidates.push((
                        full.clone(),
                        format!("{}/", full.strip_prefix(&display_base).unwrap_or(path)),
                        true,
                    ));
                } else if tracked_entry || directories {
                    pending.push(full);
                }
            } else if !tracked_entry && selected {
                candidates.push((
                    full.clone(),
                    full.strip_prefix(&display_base).unwrap_or(path).to_string(),
                    false,
                ));
            }
        }
    }
    candidates.sort_by(|a, b| a.1.cmp(&b.1));
    let mut output = String::new();
    for (full, display, directory) in candidates {
        output.push_str(&format!(
            "{} {display}\n",
            if dry { "Would remove" } else { "Removing" }
        ));
        if !dry {
            if directory {
                fs.rm_recursive(&full)
            } else {
                fs.unlink(&full)
            }
            .map_err(|e| GitError::internal(&e.message))?;
        }
    }
    Ok(output)
}
