//! Shell policy and bounded UTF16 output; process effects remain in the host.
use mcp_protocol_rust::strings::trim_ecmascript;
use std::collections::VecDeque;
const OUTPUT_LIMIT: usize = 128 * 1024;
#[derive(Default)]
pub struct RetainedOutput {
    value: VecDeque<u16>,
    omitted: u64,
}
impl RetainedOutput {
    pub fn allocated_bytes(&self) -> usize {
        self.value.capacity() * size_of::<u16>()
    }
    pub fn append(&mut self, chunk: &[u16]) {
        let overflow = (self.value.len() + chunk.len()).saturating_sub(OUTPUT_LIMIT);
        self.omitted = self.omitted.saturating_add(overflow as u64);
        if chunk.len() >= OUTPUT_LIMIT {
            self.value.clear();
            self.value.extend(&chunk[chunk.len() - OUTPUT_LIMIT..]);
        } else {
            self.value.drain(..overflow);
            self.value.extend(chunk);
        }
    }
    pub fn format(&self) -> Vec<u16> {
        let mut value = if self.omitted == 0 {
            vec![]
        } else {
            format!("[output truncated: {} characters omitted]\n", self.omitted)
                .encode_utf16()
                .collect()
        };
        value.extend(self.value.iter().copied());
        value
    }
}
pub fn timeout_ms(seconds: Option<f64>) -> Result<f64, &'static str> {
    let seconds = seconds.unwrap_or(120.0);
    if seconds <= 0.0 {
        return Err("Tool argument \"timeout\" must be greater than 0");
    }
    if seconds > 600.0 {
        return Err("Tool argument \"timeout\" must not exceed 600");
    }
    Ok(seconds * 1000.0)
}
#[derive(Debug)]
enum Entry {
    Word(Vec<u16>),
    Op(String),
    Comment,
}
fn whitespace(c: u16) -> bool {
    trim_ecmascript(&[c]).is_empty()
}
fn control(source: &[u16]) -> Option<(&'static str, usize)> {
    [
        "||", "&&", ";;", "|&", "<(", "<<<", ">>", ">&", "<&", "&", ";", "(", ")", "|", "<", ">",
    ]
    .into_iter()
    .find_map(|op| {
        (source.len() >= op.len()
            && source
                .iter()
                .zip(op.bytes())
                .all(|(unit, byte)| *unit == byte as u16))
        .then_some((op, op.len()))
    })
}
fn variable(source: &[u16], cursor: &mut usize) -> Result<Vec<u16>, Vec<u16>> {
    *cursor += 1;
    if source.get(*cursor) == Some(&123) {
        *cursor += 1;
        let start = *cursor;
        if source.get(start) == Some(&125) {
            return Err("Bad substitution: ${}".encode_utf16().collect());
        }
        let mut depth = 1;
        while *cursor < source.len() {
            if source[*cursor] == 123 && *cursor > 0 && source[*cursor - 1] == 36 {
                depth += 1;
            }
            if source[*cursor] == 125 {
                depth -= 1;
            }
            *cursor += 1;
            if depth == 0 {
                return Ok(vec![]);
            }
        }
        let mut error: Vec<_> = "Bad substitution: ".encode_utf16().collect();
        error.extend(&source[start..]);
        return Err(error);
    }
    let start = *cursor;
    if source
        .get(start)
        .is_some_and(|c| [42, 64, 35, 63, 36, 33, 95, 45].contains(c))
    {
        *cursor = (*cursor + 2).min(source.len());
        return Ok(vec![]);
    }
    while source.get(*cursor).is_some_and(|c| {
        (48..=57).contains(c) || (65..=90).contains(c) || (97..=122).contains(c) || *c == 95
    }) {
        *cursor += 1;
    }
    Ok(if *cursor == start { vec![36] } else { vec![] })
}
fn token_end(source: &[u16], mut cursor: usize) -> usize {
    while cursor < source.len() {
        let c = source[cursor];
        if whitespace(c) || control(&source[cursor..]).is_some() {
            break;
        }
        if c == 92 && cursor + 1 < source.len() {
            cursor += 2;
            continue;
        }
        if matches!(c, 34 | 39) {
            let start = cursor;
            cursor += 1;
            while cursor < source.len() && source[cursor] != c {
                if c == 34 && source[cursor] == 92 && source.get(cursor + 1) == Some(&34) {
                    cursor += 1;
                }
                cursor += 1;
            }
            if cursor == source.len() {
                return start;
            }
        }
        cursor += 1;
    }
    cursor
}
fn parse(source: &[u16]) -> Result<Vec<Entry>, Vec<u16>> {
    if source.len() > 1_048_576 {
        return Err("Shell policy input limit exceeded (1048576 UTF16 units)"
            .encode_utf16()
            .collect());
    }
    let mut entries = vec![];
    let mut cursor = 0;
    while cursor < source.len() {
        if whitespace(source[cursor]) {
            cursor += 1;
            continue;
        }
        if let Some((op, count)) = control(&source[cursor..]) {
            entries.push(Entry::Op(op.into()));
            cursor += count;
            continue;
        }
        if matches!(source[cursor], 34 | 39) && !source[cursor + 1..].contains(&source[cursor]) {
            cursor += 1;
            continue;
        }
        let end = token_end(source, cursor);
        let mut word = vec![];
        let mut quote = None;
        let mut glob = false;
        let mut started = false;
        while cursor < end {
            let c = source[cursor];
            if quote.is_none() && (whitespace(c) || control(&source[cursor..]).is_some()) {
                break;
            }
            if quote.is_none() && matches!(c, 34 | 39) && !source[cursor + 1..].contains(&c) {
                break;
            }
            started = true;
            if quote.is_none() && matches!(c, 42 | 63) {
                glob = true;
            }
            if quote == Some(c) {
                quote = None;
                cursor += 1;
            } else if quote == Some(39) {
                word.push(c);
                cursor += 1;
            } else if c == 92 {
                cursor += 1;
                if let Some(next) = source.get(cursor) {
                    if quote == Some(34) && ![34, 92, 36].contains(next) {
                        word.push(92);
                    }
                    if quote.is_none() && matches!(*next, 42 | 63) {
                        glob = true;
                    }
                    word.push(*next);
                    cursor += 1;
                }
            } else if c == 36 {
                word.extend(variable(&source[..end], &mut cursor)?);
            } else if quote.is_none() && matches!(c, 34 | 39) {
                quote = Some(c);
                cursor += 1;
            } else if quote.is_none() && c == 35 {
                if !word.is_empty() {
                    entries.push(Entry::Word(word));
                }
                entries.push(Entry::Comment);
                return Ok(entries);
            } else {
                word.push(c);
                cursor += 1;
            }
        }
        if started {
            entries.push(if glob {
                Entry::Op("glob".into())
            } else {
                Entry::Word(word)
            });
        }
    }
    Ok(entries)
}
fn dedicated(command: &[u16]) -> bool {
    let ascii_word = |c: u16| {
        (48..=57).contains(&c) || (65..=90).contains(&c) || (97..=122).contains(&c) || c == 95
    };
    for name in ["cat", "ls", "find", "grep", "rg"] {
        let units: Vec<_> = name.encode_utf16().collect();
        if command.windows(units.len()).enumerate().any(|(i, w)| {
            w == units
                && (i == 0 || !ascii_word(command[i - 1]))
                && command.get(i + units.len()).is_none_or(|c| !ascii_word(*c))
        }) {
            return true;
        }
    }
    for name in ["open", "read_text", "read_bytes"] {
        let units: Vec<_> = name.encode_utf16().collect();
        for (index, window) in command.windows(units.len()).enumerate() {
            if window == units {
                let mut i = index + units.len();
                while command.get(i).is_some_and(|c| whitespace(*c)) {
                    i += 1;
                }
                if command.get(i) == Some(&40) {
                    return true;
                }
            }
        }
    }
    false
}
fn wrapper(name: &str) -> bool {
    ["bash", "sh", "zsh", "python", "python3"].contains(&name)
}
fn wrapped(args: &[String]) -> Option<String> {
    for (i, arg) in args.iter().enumerate() {
        if arg == "-c" || arg == "-lc" {
            return args.get(i + 1).cloned();
        }
    }
    args.iter()
        .position(|arg| arg.starts_with('-'))
        .map(|i| args[i + 1..].join(" "))
        .filter(|s| !s.is_empty())
}
fn assignment(word: &[u16]) -> bool {
    word.iter().position(|c| *c == 61).is_some_and(|i| i > 0)
        && word.first() != Some(&47)
        && !word.starts_with(&[46, 47])
}
fn words(entries: Vec<Entry>) -> Option<Vec<Vec<u16>>> {
    entries
        .into_iter()
        .map(|e| {
            if let Entry::Word(w) = e {
                Some(w)
            } else {
                None
            }
        })
        .collect()
}
fn readonly(name: &str, args: &[String]) -> bool {
    if [
        "pwd", "ls", "cat", "head", "tail", "grep", "rg", "find", "stat", "wc", "sort", "cut",
        "uniq", "which", "whereis", "basename", "dirname", "true", "false", "test", "[",
        "realpath", "readlink", "du",
    ]
    .contains(&name)
    {
        return true;
    }
    if name != "git" {
        return false;
    }
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if !arg.starts_with('-') {
            return [
                "status",
                "diff",
                "log",
                "show",
                "rev-parse",
                "ls-files",
                "grep",
                "blame",
                "merge-base",
                "cat-file",
                "reflog",
            ]
            .contains(&arg.as_str())
                && !args[i + 1..]
                    .iter()
                    .any(|arg| arg == "--output" || arg.starts_with("--output="));
        }
        i += if [
            "-C",
            "-c",
            "--git-dir",
            "--work-tree",
            "--namespace",
            "--exec-path",
            "--config-env",
        ]
        .contains(&arg.as_str())
        {
            2
        } else {
            1
        };
    }
    false
}
fn http_read(method: &str) -> bool {
    ["GET", "HEAD", "OPTIONS"].contains(&method.trim().to_uppercase().as_str())
}
fn network_write(name: &str, args: &[String]) -> bool {
    for (i, arg) in args.iter().enumerate() {
        let flags = if name == "curl" {
            &[
                "-d",
                "--data",
                "--data-binary",
                "--data-raw",
                "-F",
                "--form",
                "-T",
                "--upload-file",
            ][..]
        } else {
            &["--body-data", "--body-file", "--post-data", "--post-file"][..]
        };
        if flags.contains(&arg.as_str())
            || flags
                .iter()
                .filter(|s| s.starts_with("--"))
                .any(|s| arg.starts_with(&format!("{s}=")))
        {
            return true;
        }
        if name == "curl"
            && (arg == "-X" || arg == "--request")
            && let Some(next) = args.get(i + 1).filter(|s| !s.is_empty())
        {
            return !http_read(next);
        }
        if let Some(method) = arg.strip_prefix(if name == "curl" {
            "--request="
        } else {
            "--method="
        }) {
            return !http_read(method);
        }
    }
    false
}
const DEDICATED: &str = "Use the dedicated file/search/list tools instead of shell wrappers for file reads, searches, or directory listings.";
fn rejection(name: &[u16], mode: &str) -> Vec<u16> {
    let mut out: Vec<_> = "Command \"".encode_utf16().collect();
    out.extend(name);
    out.extend(format!("\" is not allowed in {mode} mode.").encode_utf16());
    out
}
pub fn validate_policy(command: &[u16], mode: &str) -> Option<Vec<u16>> {
    let entries = match parse(command) {
        Ok(entries) => entries,
        Err(error) => {
            let mut out: Vec<_> = format!("Unable to evaluate command policy in {mode} mode: ")
                .encode_utf16()
                .collect();
            out.extend(error);
            return Some(out);
        }
    };
    if entries.is_empty() {
        return Some(
            format!("Command is not allowed in {mode} mode.")
                .encode_utf16()
                .collect(),
        );
    }
    let mut segments = vec![];
    let mut segment = vec![];
    for entry in entries {
        match entry {
            Entry::Word(word) => segment.push(word),
            Entry::Op(op) if ["|", "||", "&&", ";"].contains(&op.as_str()) => {
                if !segment.is_empty() {
                    segments.push(std::mem::take(&mut segment));
                }
            }
            Entry::Op(_) if mode == "read" => {
                return Some(
                    if dedicated(command) {
                        DEDICATED.into()
                    } else {
                        format!("Shell redirection is not allowed in {mode} mode.")
                    }
                    .encode_utf16()
                    .collect(),
                );
            }
            _ => {}
        }
    }
    if !segment.is_empty() {
        segments.push(segment);
    }
    for segment in segments {
        let start = segment.iter().take_while(|word| assignment(word)).count();
        let Some(name_units) = segment.get(start) else {
            continue;
        };
        if name_units.is_empty() {
            continue;
        }
        let name = String::from_utf16_lossy(name_units);
        let args: Vec<_> = segment[start + 1..]
            .iter()
            .map(|word| String::from_utf16_lossy(word))
            .collect();
        let nested = wrapper(&name).then(|| wrapped(&args)).flatten();
        if nested
            .as_ref()
            .is_some_and(|s| dedicated(&s.encode_utf16().collect::<Vec<_>>()))
        {
            return Some(DEDICATED.encode_utf16().collect());
        }
        if name == "cd" || args.first().is_some_and(|arg| arg == "cd") {
            return Some(
                "Use the \"cwd\" argument instead of prefixing commands with \"cd\"."
                    .encode_utf16()
                    .collect(),
            );
        }
        if mode == "read" {
            let reason = match name.as_str() {
                "cat" => Some(
                    "Use the dedicated file/search/list tools instead of \"cat\" for file reads."
                        .into(),
                ),
                "ls" | "find" => Some(format!(
                    "Use the dedicated file/search/list tools instead of \"{name}\" for directory listings."
                )),
                "grep" | "rg" => Some(format!(
                    "Use the dedicated file/search/list tools instead of \"{name}\" for searches."
                )),
                "python" | "python3"
                    if dedicated(
                        &segment[start..]
                            .iter()
                            .flat_map(|s| s.iter().copied().chain([32]))
                            .collect::<Vec<_>>(),
                    ) =>
                {
                    Some(DEDICATED.into())
                }
                _ => None,
            };
            if let Some(reason) = reason {
                return Some(reason.encode_utf16().collect());
            }
            if let Some(nested) = nested
                .and_then(|s| parse(&s.encode_utf16().collect::<Vec<_>>()).ok())
                .and_then(words)
            {
                let start = nested.iter().take_while(|s| assignment(s)).count();
                if let Some(nested_name) = nested.get(start).filter(|s| !s.is_empty()) {
                    let args: Vec<_> = nested[start + 1..]
                        .iter()
                        .map(|s| String::from_utf16_lossy(s))
                        .collect();
                    if !readonly(&String::from_utf16_lossy(nested_name), &args) {
                        return Some(rejection(name_units, mode));
                    }
                    continue;
                }
            }
            if !readonly(&name, &args) {
                return Some(rejection(name_units, mode));
            }
        } else {
            if name == "rm" {
                let recursive = args.iter().any(|a| {
                    a == "--recursive"
                        || a.starts_with('-')
                            && !a.starts_with("--")
                            && (a.contains('r') || a.contains('R'))
                });
                let force = args.iter().any(|a| {
                    a == "--force" || a.starts_with('-') && !a.starts_with("--") && a.contains('f')
                });
                if recursive && force {
                    return Some(
                        "Command \"rm -rf\" is blocked in edit mode."
                            .encode_utf16()
                            .collect(),
                    );
                }
            }
            if name == "git"
                && let Some(sub) = args.iter().find(|arg| !arg.starts_with('-'))
                && [
                    "add",
                    "branch",
                    "checkout",
                    "cherry-pick",
                    "clean",
                    "commit",
                    "merge",
                    "push",
                    "rebase",
                    "reset",
                    "restore",
                    "stash",
                    "switch",
                    "tag",
                ]
                .contains(&sub.as_str())
            {
                return Some(
                    format!("Command \"git {sub}\" is blocked in edit mode.")
                        .encode_utf16()
                        .collect(),
                );
            }
            if ["curl", "wget"].contains(&name.as_str()) && network_write(&name, &args) {
                return Some(format!("Command \"{name}\" is blocked in edit mode because it performs a network write.").encode_utf16().collect());
            }
        }
    }
    None
}
