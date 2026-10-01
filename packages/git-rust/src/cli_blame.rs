use crate::{GitError, MemoryFs, utils::Author};

pub(crate) fn run(
    fs: &MemoryFs,
    root: &str,
    cwd: &str,
    gitdir: &str,
    args: &[&str],
) -> Result<String, GitError> {
    let mut long = false;
    let mut range = None;
    let mut positional = Vec::new();
    let mut i = 0;
    while i < args.len() {
        match args[i] {
            "-l" => long = true,
            "--" => {
                positional.extend_from_slice(&args[i + 1..]);
                break;
            }
            "-L" => {
                i += 1;
                let value = args
                    .get(i)
                    .ok_or_else(|| GitError::internal("-L requires a range"))?;
                let (a, b) = value
                    .split_once(',')
                    .ok_or_else(|| GitError::internal("invalid line range"))?;
                let start: usize = a
                    .parse()
                    .map_err(|_| GitError::internal("invalid line range"))?;
                let end: usize = b
                    .parse()
                    .map_err(|_| GitError::internal("invalid line range"))?;
                if start == 0 || end < start {
                    return Err(GitError::internal("invalid line range"));
                }
                range = Some((start, end));
            }
            arg if arg.starts_with('-') => {
                return Err(GitError::internal(&format!(
                    "unsupported blame option: {arg}"
                )));
            }
            arg => positional.push(arg),
        }
        i += 1;
    }
    if positional.is_empty() || positional.len() > 2 {
        return Err(GitError::internal("blame requires [revision] file"));
    }
    let path = crate::cli::repository_path(root, cwd, positional.last().unwrap());
    let oid = crate::cli_history::resolve_commit(
        fs,
        gitdir,
        if positional.len() == 2 {
            positional[0]
        } else {
            "HEAD"
        },
    )?;
    let head_text = content(fs, gitdir, &oid, &path)?;
    let text = if positional.len() == 2 {
        head_text.clone()
    } else {
        fs.read_str(&crate::utils::join(&[root, &path]))
            .ok_or_else(|| GitError::internal(&format!("no such path: {path}")))?
    };
    let lines: Vec<_> = text.lines().collect();
    let head_lines: Vec<_> = head_text.lines().collect();
    let mut pairs = Vec::new();
    crate::cli_files::matching_lines(&head_lines, &lines, 0, 0, &mut pairs);
    let uncommitted = Author {
        name: "Not Committed Yet".into(),
        email: String::new(),
        timestamp: crate::environment::timestamp(),
        timezone_offset: 0.0,
    };
    let mut attribution = vec![("0".repeat(40), uncommitted, false); lines.len()];
    let mut pending = vec![(oid, pairs)];
    while let Some((oid, mut mapping)) = pending.pop() {
        if mapping.is_empty() {
            continue;
        }
        let commit = crate::read_commit(fs, gitdir, &oid)?.commit;
        let current_text = content(fs, gitdir, &oid, &path)?;
        let current_lines: Vec<_> = current_text.lines().collect();
        for parent in &commit.parent {
            let Ok(parent_text) = content(fs, gitdir, parent, &path) else {
                continue;
            };
            let parent_lines: Vec<_> = parent_text.lines().collect();
            let mut aligned = Vec::new();
            crate::cli_files::matching_lines(&parent_lines, &current_lines, 0, 0, &mut aligned);
            let lookup: std::collections::HashMap<_, _> =
                aligned.into_iter().map(|(a, b)| (b, a)).collect();
            let mut inherited = Vec::new();
            mapping.retain(|(current, final_line)| {
                if let Some(previous) = lookup.get(current) {
                    inherited.push((*previous, *final_line));
                    false
                } else {
                    true
                }
            });
            if !inherited.is_empty() {
                pending.push((parent.clone(), inherited));
            }
        }
        for (_, final_line) in mapping {
            attribution[final_line] =
                (oid.clone(), commit.author.clone(), commit.parent.is_empty());
        }
    }
    let width = attribution
        .iter()
        .map(|(_, author, _)| author.name.chars().count())
        .max()
        .unwrap_or(0);
    let line_width = lines.len().max(1).to_string().len();
    let mut output = String::new();
    for (i, (line, (oid, author, boundary))) in lines.iter().zip(attribution).enumerate() {
        let number = i + 1;
        if range.is_some_and(|(start, end)| number < start || number > end) {
            continue;
        }
        let revision = if long {
            oid
        } else if boundary {
            format!("^{}", &oid[..7])
        } else {
            oid[..8].into()
        };
        let date = crate::cli_history::iso_date(&author);
        output.push_str(&format!(
            "{revision} ({:width$} {} {number:line_width$}) {line}\n",
            author.name,
            &date[..10]
        ));
    }
    Ok(output)
}
fn content(fs: &MemoryFs, gitdir: &str, oid: &str, path: &str) -> Result<String, GitError> {
    let blob = crate::commands::plumbing::read_blob(fs, gitdir, oid, Some(path))?;
    String::from_utf8(blob.blob).map_err(|_| GitError::internal("cannot blame non-UTF-8 file"))
}
