use crate::vfs::{SafeBashFs, VfsEntryKind, resolve_posix_path};
use std::collections::{HashSet, VecDeque};

fn whitespace(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\r' | '\x0b' | '\x0c')
}

fn physical_line(line: &str) -> Option<String> {
    let line = line.trim_end_matches('\r');
    if let Some(value) = line.strip_prefix("#[CSTR]") {
        let mut result = String::with_capacity(value.len());
        let mut chars = value.chars();
        while let Some(c) = chars.next() {
            if c != '\\' {
                result.push(c);
                continue;
            }
            let Some(next) = chars.next() else {
                result.push(c);
                break;
            };
            let decoded = match next {
                'a' => '\x07',
                'b' => '\x08',
                'f' => '\x0c',
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                '"' | '\\' => next,
                _ => {
                    result.push('\\');
                    next
                }
            };
            result.push(decoded);
        }
        return Some(result);
    }
    if line.starts_with('#') {
        return None;
    }
    let line = line.trim_start_matches(whitespace);
    if line.is_empty() {
        return None;
    }
    if let Some(rest) = line.strip_prefix('-') {
        let n = rest
            .bytes()
            .take_while(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':'))
            .count();
        if n > 0 {
            let end = 1 + n + usize::from(rest[n..].starts_with('#'));
            let rest = line[end..].trim_start_matches(whitespace);
            for op in ["+=", "-=", "<=", "="] {
                if let Some(value) = rest.strip_prefix(op) {
                    return Some(format!(
                        "{}{op}{}",
                        &line[..end],
                        value.strip_prefix(' ').unwrap_or(value)
                    ));
                }
            }
        }
    }
    Some(line.to_owned())
}

pub(super) fn expand(
    args: &[String],
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> Result<Vec<String>, String> {
    let mut frames = vec![(None, args.iter().cloned().collect::<VecDeque<_>>())];
    let mut active = HashSet::new();
    let mut result = Vec::new();
    let (mut literal, mut takes_value) = (false, false);
    let limits = fs.shell_limits();
    let (mut input_bytes, mut fields) = (0usize, 0usize);
    while let Some((source, args)) = frames.last_mut() {
        let Some(arg) = args.pop_front() else {
            if let Some(path) = source {
                active.remove(path);
            }
            frames.pop();
            continue;
        };
        let option = arg.to_ascii_lowercase();
        if !literal && !takes_value {
            if source.is_some() && matches!(option.as_str(), "-config" | "-common_args") {
                return Err(
                    "Configuration/common arguments are not allowed in argument files".into(),
                );
            }
            if option == "-@" {
                // A filename can come from the caller when an included file ends in -@.
                let input = loop {
                    let Some((source, owner)) = frames.last_mut() else {
                        return Err("Missing argument for -@".into());
                    };
                    if let Some(input) = owner.pop_front() {
                        break input;
                    }
                    if let Some(path) = source {
                        active.remove(path);
                    }
                    frames.pop();
                };
                if input == "-" || input.contains('\0') {
                    return Err("Argument-file stdin/invalid paths are not supported".into());
                }
                let path = resolve_posix_path(cwd, &input);
                if !active.insert(path.clone()) {
                    return Err("Argument-file cycle is not supported".into());
                }
                let (entry, stat) =
                    fs.inspect_command_entry(&path, false, "lstat")
                        .map_err(|e| {
                            if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") {
                                format!("ENOENT: no such file or directory, lstat '{path}'")
                            } else {
                                e
                            }
                        })?;
                if stat.kind != VfsEntryKind::File {
                    return Err("Only regular VFS argument files are admitted".into());
                }
                if stat.mode & 0o400 == 0 {
                    return Err(format!("EACCES: permission denied, readStream '{path}'"));
                }
                input_bytes = input_bytes.saturating_add(stat.size);
                if input_bytes > limits.max_input_bytes {
                    return Err(fs.limit_error("maxInputBytes", limits.max_input_bytes));
                }
                let mut bytes = Vec::new();
                fs.read_chunks(&entry, &mut |chunk| {
                    if chunk.len() > stat.size.saturating_sub(bytes.len()) {
                        return Err("Argument file grew beyond admitted size".into());
                    }
                    bytes.extend_from_slice(chunk);
                    Ok(true)
                })?;
                let text = std::str::from_utf8(&bytes)
                    .map_err(|_| "Only UTF-8 argument files are currently supported")?;
                let mut expanded = VecDeque::new();
                for line in text
                    .strip_prefix('\u{feff}')
                    .unwrap_or(text)
                    .split('\n')
                    .filter_map(physical_line)
                {
                    fields += 1;
                    if fields > limits.max_expansion_fields {
                        return Err(
                            fs.limit_error("maxExpansionFields", limits.max_expansion_fields)
                        );
                    }
                    expanded.push_back(line);
                }
                frames.push((Some(path), expanded));
                continue;
            }
            if arg == "--" {
                literal = true;
            }
        }
        takes_value = !literal
            && !takes_value
            && matches!(
                option.as_str(),
                "-config"
                    | "-charset"
                    | "-api"
                    | "-o"
                    | "-if"
                    | "-p"
                    | "-stay_open"
                    | "-tagsfromfile"
            );
        result.push(arg);
    }
    Ok(result)
}
