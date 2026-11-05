use super::ZeroRegex;

/// fd uses the same path globs for exclusions and ignore files. A leading
/// slash or an interior slash anchors the match to the rule's directory.
pub(super) struct FdGlob {
    expression: ZeroRegex,
    directory_only: bool,
}

fn ascii_error(offset: usize) -> String {
    format!("unsupported ERE profile at {offset}: only non-NUL ASCII in the C/POSIX profile")
}

// The glob frontend ends the class fragment at the first closing bracket.
// Backslashes in that fragment are members, not regex escape sequences.
fn append_class(expression: &mut String, contents: &str, start: usize) -> Result<(), String> {
    if let Some(i) = contents.bytes().position(|b| !b.is_ascii() || b == 0) { return Err(ascii_error(i + 1)); }
    let mut members = contents.as_bytes();
    expression.push('[');
    if matches!(members.first(), Some(b'!' | b'^')) {
        expression.push('^');
        members = &members[1..];
    }
    while let Some((&low, rest)) = members.split_first() {
        let offset = start + 1 + contents.len() - members.len();
        if low == b'[' {
            if rest.starts_with(b".") || rest.starts_with(b"=") {
                return Err(format!("unsupported ERE profile at {offset}: collating or equivalence element"));
            }
            if let Some(class) = rest.strip_prefix(b":") {
                let known = class.strip_suffix(b":").and_then(|s| super::posix_class_ranges(std::str::from_utf8(s).unwrap()));
                return Err(if known.is_some() { format!("invalid ERE at {start}: unclosed bracket expression") }
                    else { format!("invalid ERE at {offset}: unknown character class") });
            }
        }
        if low == b'\\' { expression.push('\\'); }
        expression.push(char::from(low));
        if let [b'-', high, tail @ ..] = rest {
            if *high == b'[' { return Err(format!("invalid ERE at {}: nonliteral range endpoint", offset + 2)); }
            if low > *high { return Err(format!("invalid ERE at {offset}: descending range")); }
            expression.push('-');
            if *high == b'\\' { expression.push('\\'); }
            expression.push(char::from(*high));
            members = tail;
        } else { members = rest; }
    }
    expression.push(']');
    Ok(())
}

#[derive(Clone, Copy)]
pub(super) enum GlobSyntax { Search, Ignore, Override { insensitive: bool } }

impl FdGlob {
    pub(super) fn compile(source: &str, syntax: GlobSyntax) -> Result<Self, String> {
        let search_pattern = matches!(syntax, GlobSyntax::Search);
        if source.is_empty() && matches!(syntax, GlobSyntax::Override { .. }) { return Err("invalid glob: empty or excessive glob".into()); }
        let directory_only = source.ends_with('/');
        let pattern = source.strip_suffix('/').unwrap_or(source);
        let mut expression = if search_pattern || source.starts_with('/') || pattern.contains('/') { "^" } else { "(^|/)" }.to_owned();
        let mut chars = if search_pattern { pattern } else { pattern.strip_prefix('/').unwrap_or(pattern) }.chars();
        let mut braces = 0;
        let mut escapes = 0;
        while let Some(c) = chars.next() {
            match c {
                '*' if chars.as_str().starts_with('*') => {
                    while chars.as_str().starts_with('*') { chars.next(); }
                    if chars.as_str().starts_with('/') {
                        chars.next();
                        expression.push_str("(.*/)?");
                    } else { expression.push_str(".*"); }
                }
                '*' => expression.push_str("[^/]*"),
                '?' => expression.push_str("[^/]"),
                '[' => {
                    let rest = chars.as_str();
                    let body = rest.strip_prefix(['!', '^']).unwrap_or(rest);
                    let tail = body.strip_prefix(']').unwrap_or(body);
                    if let Some(end) = tail.find(']') {
                        let contents = &rest[..rest.len() - tail.len() + end];
                        let len = expression.len();
                        append_class(&mut expression, contents, len - escapes)?;
                        escapes += expression.len() - len - contents.len() - 2;
                        chars = tail[end + 1..].chars();
                    } else if !matches!(syntax, GlobSyntax::Ignore) { return Err("invalid glob: unclosed glob character class".into()); }
                    else { expression.push_str(r"\["); escapes += 1; }
                }
                '{' => { braces += 1; expression.push('('); }
                '}' if braces == 0 => return Err("invalid glob: unmatched glob brace".into()),
                '}' => { braces -= 1; expression.push(')'); }
                ',' if braces > 0 => expression.push('|'),
                c => {
                    let literal = if c == '\\' { chars.next().ok_or("invalid glob: trailing glob escape")? } else { c };
                    if !literal.is_ascii() || literal == '\0' { return Err(ascii_error(0)); }
                    if r".^$*+?()[]{}|\".contains(literal) { expression.push('\\'); escapes += 1; }
                    expression.push(literal);
                }
            }
        }
        if braces > 0 { return Err("invalid glob: unclosed glob brace".into()); }
        expression.push('$');
        let branches = super::parse_rx_branches(&expression, false, super::RxDialect::Awk).expect("permissive glob expression parser");
        let insensitive = matches!(syntax, GlobSyntax::Override { insensitive: true });
        Ok(Self { expression: ZeroRegex::from_branches([branches], insensitive, false, false), directory_only })
    }

    pub(super) fn matches_override(&self, path: &str, directory: bool) -> Result<bool, String> {
        if self.expression.ignore_case && !path.is_ascii() {
            return Err("rg: bounded regex unsupported: glob case folding supports ASCII paths only\n".into());
        }
        Ok(self.matches(path, directory, false))
    }

    pub(super) fn matches(&self, mut path: &str, directory: bool, ancestors: bool) -> bool {
        if (!self.directory_only || directory) && self.expression.is_match(path) { return true; }
        while ancestors && let Some((parent, _)) = path.rsplit_once('/') {
            if self.expression.is_match(parent) { return true; }
            path = parent;
        }
        false
    }
}

pub(super) enum RuleError { Read(String), Pattern(String) }

impl RuleError {
    pub(super) fn message(self) -> String {
        match self { Self::Read(e) | Self::Pattern(e) => e }
    }
}

pub(super) struct IgnoreFile {
    base: String,
    pub(super) priority: u8,
    rules: Vec<(FdGlob, bool)>,
}

impl IgnoreFile {
    pub(super) fn read(fs: &dyn super::SafeBashFs, path: &str, base: &str, priority: u8) -> Result<Self, RuleError> {
        let bytes = super::read_search_file(fs, path, "readFile").map_err(RuleError::Read)?;
        let text = String::from_utf8_lossy(bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&bytes));
        Self::parse(text.lines().filter(|line| !line.contains('\u{fffd}')), base, priority).map_err(RuleError::Pattern)
    }

    pub(super) fn parse<'a>(lines: impl Iterator<Item = &'a str>, base: &str, priority: u8) -> Result<Self, String> {
        let mut rules = Vec::new();
        for mut line in lines {
            if line.starts_with('#') { continue; }
            while let Some(before) = line.strip_suffix(' ') {
                if before.bytes().rev().take_while(|b| *b == b'\\').count() % 2 == 1 { break; }
                line = before;
            }
            let (pattern, include) = line.strip_prefix('!').map_or((line, false), |p| (p, true));
            if !pattern.is_empty() { rules.push((FdGlob::compile(pattern, GlobSyntax::Ignore)?, include)); }
        }
        Ok(Self { base: base.to_owned(), priority, rules })
    }

    pub(super) fn include_within(&self, path: &str, directory: bool) -> Option<bool> {
        let relative = path.strip_prefix(self.base.trim_end_matches('/'))?.strip_prefix('/')?;
        self.rules.iter().rev().find(|(glob, _)| glob.matches(relative, directory, false)).map(|(_, include)| *include)
    }

    pub(super) fn ignored(files: &[Self], path: &str, directory: bool, git_start: Option<usize>) -> bool {
        let mut decision = None;
        for (index, file) in files.iter().enumerate() {
            if file.priority == 0 && git_start.is_none_or(|start| index < start) { continue; }
            if decision.is_some_and(|(priority, _)| priority > file.priority) { continue; }
            let outside;
            let relative = if let Some(relative) = path.strip_prefix(file.base.trim_end_matches('/')).and_then(|p| p.strip_prefix('/')) {
                relative
            } else {
                // Explicit rule files use the invocation cwd as their base even
                // for a search root outside it. JS slices by UTF-16 offset.
                let start = file.base.encode_utf16().count() + usize::from(file.base != "/");
                outside = String::from_utf16_lossy(&path.encode_utf16().skip(start).collect::<Vec<_>>());
                &outside
            };
            for (glob, include) in &file.rules {
                if glob.matches(relative, directory, true) { decision = Some((file.priority, !include)); }
            }
        }
        decision.is_some_and(|(_, ignored)| ignored)
    }

    pub(super) fn load(files: &mut Vec<Self>, fs: &dyn super::SafeBashFs, dir: &str, entries: Option<&[String]>, no_vcs: bool) -> Result<(), RuleError> {
        for (priority, name) in [(0, ".gitignore"), (1, ".ignore"), (2, ".fdignore")] {
            if (priority == 0 && no_vcs) || entries.is_some_and(|names| !names.iter().any(|n| n == name)) { continue; }
            let path = format!("{}/{name}", dir.trim_end_matches('/'));
            match Self::read(fs, &path, dir, priority) {
                Ok(file) if !file.rules.is_empty() => files.push(file),
                Ok(_) => {}
                Err(RuleError::Read(e)) if e.starts_with("ENOENT:") || e.starts_with("EISDIR:") => {}
                Err(e) => return Err(e),
            }
        }
        Ok(())
    }
}
