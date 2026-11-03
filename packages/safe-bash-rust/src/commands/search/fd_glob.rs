use super::ZeroRegex;

/// fd uses the same path globs for exclusions and ignore files. A leading
/// slash or an interior slash anchors the match to the rule's directory.
pub(super) struct FdGlob {
    expression: ZeroRegex,
    directory_only: bool,
}

impl FdGlob {
    pub(super) fn compile(source: &str) -> Result<Self, String> {
        let directory_only = source.ends_with('/');
        let pattern = source.strip_suffix('/').unwrap_or(source);
        let mut expression = if source.starts_with('/') || pattern.contains('/') { "^" } else { "(^|/)" }.to_owned();
        let mut chars = pattern.strip_prefix('/').unwrap_or(pattern).chars();
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
                    } else { expression.push_str(r"\["); }
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

    pub(super) fn matches(&self, mut path: &str, directory: bool) -> bool {
        if (!self.directory_only || directory) && self.expression.is_match(path) { return true; }
        while let Some((parent, _)) = path.rsplit_once('/') {
            if self.expression.is_match(parent) { return true; }
            path = parent;
        }
        false
    }
}
