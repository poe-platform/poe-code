// qpdf takes one argument per physical line. In particular, quotes, spaces
// and a leading @ in the file are literal parts of the argument.
use crate::vfs::{SafeBashFs, VfsEntryKind, resolve_posix_path};
use std::borrow::Cow;

pub(super) fn expand<'a>(
    args: &'a [String],
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> Result<(Cow<'a, [String]>, usize), String> {
    let limits = fs.shell_limits();
    let mut remaining = limits.max_input_bytes;
    if !args.iter().any(|arg| arg.starts_with('@')) {
        return Ok((Cow::Borrowed(args), remaining));
    }
    let mut result = Vec::new();
    let mut budget = limits.max_expansion_bytes;
    let mut push = |arg: &str| -> Result<(), String> {
        budget = budget
            .checked_sub(arg.len() + 1)
            .ok_or_else(|| fs.limit_error("maxExpansionBytes", limits.max_expansion_bytes))?;
        if result.len() >= limits.max_expansion_fields {
            return Err(fs.limit_error("maxExpansionFields", limits.max_expansion_fields));
        }
        result.push(arg.to_owned());
        Ok(())
    };
    for arg in args {
        let Some(file) = arg.strip_prefix('@') else {
            push(arg)?;
            continue;
        };
        let path = resolve_posix_path(cwd, file);
        let missing = || format!("qpdf: cannot open {file}\n");
        let (entry, stat) = fs
            .inspect_command_entry(&path, true, "stat")
            .map_err(|_| missing())?;
        if stat.kind != VfsEntryKind::File {
            return Err(missing());
        }
        if stat.size > remaining {
            return Err(fs.limit_error("maxInputBytes", limits.max_input_bytes));
        }
        let mut pending = vec![];
        let mut first = true;
        let mut accept = |bytes: &[u8]| -> Result<(), String> {
            let bytes = if first {
                first = false;
                bytes.strip_prefix(&[239, 187, 191]).unwrap_or(bytes)
            } else {
                bytes
            };
            let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
            if !bytes.is_empty() {
                push(&String::from_utf8_lossy(bytes))?
            }
            Ok(())
        };
        fs.read_chunks(&entry, &mut |chunk| {
            remaining = remaining
                .checked_sub(chunk.len())
                .ok_or_else(|| fs.limit_error("maxInputBytes", limits.max_input_bytes))?;
            for part in chunk.split_inclusive(|&c| c == b'\n') {
                if let Some(line) = part.strip_suffix(b"\n") {
                    if pending.is_empty() {
                        accept(line)?
                    } else {
                        pending.extend_from_slice(line);
                        accept(&pending)?;
                        pending.clear()
                    }
                } else {
                    pending.extend_from_slice(part)
                }
            }
            Ok(true)
        })
        .map_err(|e| {
            if e.starts_with("Execution aborted:") {
                e
            } else {
                missing()
            }
        })?;
        accept(&pending)?;
    }
    Ok((Cow::Owned(result), remaining))
}
