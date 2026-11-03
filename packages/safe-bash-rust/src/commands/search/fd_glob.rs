use super::ZeroRegex;

/// fd uses the same path globs for exclusions and ignore files. A leading
/// slash or an interior slash anchors the match to the rule's directory.
pub(super) struct FdGlob {
    expression: ZeroRegex,
    directory_only: bool,
}

impl FdGlob {
    pub(super) fn compile(source: &str, search_pattern: bool) -> Result<Self, String> {
        let directory_only = source.ends_with('/');
        let pattern = source.strip_suffix('/').unwrap_or(source);
        let mut expression = if search_pattern || source.starts_with('/') || pattern.contains('/') { "^" } else { "(^|/)" }.to_owned();
        let mut chars = if search_pattern { pattern } else { pattern.strip_prefix('/').unwrap_or(pattern) }.chars();
        let mut braces = 0;
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
                        expression.push('[');
                        if let Some(negated) = contents.strip_prefix('!') {
                            expression.push('^');
                            expression.push_str(negated);
                        } else { expression.push_str(contents); }
                        expression.push(']');
                        chars = tail[end + 1..].chars();
                    } else if search_pattern { return Err("invalid glob: unclosed glob character class".into()); }
                    else { expression.push_str(r"\["); }
                }
                '{' => { braces += 1; expression.push('('); }
                '}' if braces == 0 => return Err("invalid glob: unmatched glob brace".into()),
                '}' => { braces -= 1; expression.push(')'); }
                ',' if braces > 0 => expression.push('|'),
                c => {
                    let literal = if c == '\\' { chars.next().ok_or("invalid glob: trailing glob escape")? } else { c };
                    if r".^$*+?()[]{}|\".contains(literal) { expression.push('\\'); }
                    expression.push(literal);
                }
            }
        }
        if braces > 0 { return Err("invalid glob: unclosed glob brace".into()); }
        expression.push('$');
        Ok(Self { expression: ZeroRegex::awk(&expression), directory_only })
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
    priority: u8,
    rules: Vec<(FdGlob, bool)>,
}

impl IgnoreFile {
    pub(super) fn read(fs: &dyn super::SafeBashFs, path: &str, base: &str, priority: u8) -> Result<Self, RuleError> {
        let bytes = super::read_search_file(fs, path, "readFile").map_err(RuleError::Read)?;
        let text = String::from_utf8_lossy(bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&bytes));
        let mut rules = Vec::new();
        for mut line in text.lines() {
            if line.starts_with('#') || line.contains('\u{fffd}') { continue; }
            while let Some(before) = line.strip_suffix(' ') {
                if before.bytes().rev().take_while(|b| *b == b'\\').count() % 2 == 1 { break; }
                line = before;
            }
            let (pattern, include) = line.strip_prefix('!').map_or((line, false), |p| (p, true));
            if !pattern.is_empty() { rules.push((FdGlob::compile(pattern, false).map_err(RuleError::Pattern)?, include)); }
        }
        Ok(Self { base: base.to_owned(), priority, rules })
    }

    pub(super) fn ignored(files: &[Self], path: &str, directory: bool) -> bool {
        let mut decision = None;
        for file in files {
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
