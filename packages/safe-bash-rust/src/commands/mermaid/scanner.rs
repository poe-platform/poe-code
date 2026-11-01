pub(in super::super) struct Statement {
    pub text: String,
    line: usize,
    pub(super) column: usize,
}

impl Statement {
    pub(in super::super) fn read_metadata(
        &self,
        title: &mut Option<String>,
        description: &mut Option<String>,
    ) -> Result<bool, String> {
        let text = self.text.trim_end();
        let keyword = text.split_ascii_whitespace().next().unwrap_or("");
        let slot = match keyword {
            "title" | "accTitle:" => title,
            "accDescr:" => description,
            _ => return Ok(false),
        };
        let value = label(&text[keyword.len()..], self, text)?;
        *slot = (!value.is_empty()).then_some(value);
        Ok(true)
    }

    pub(in super::super) fn error(&self, code: &str, token: &str, message: &str) -> String {
        let offset = if token.is_empty() {
            self.text.trim_end().len()
        } else {
            token.as_ptr() as usize - self.text.as_ptr() as usize
        };
        let column = self.column + self.text[..offset].encode_utf16().count();
        format!(
            "mmdc: {code} (line {}, column {column}): {message}\n",
            self.line
        )
    }
}

pub(in super::super) fn scan(
    source: &str,
    metadata: &mut super::source::Metadata,
    mut work: usize,
) -> Result<Vec<Statement>, String> {
    let mut stmts = Vec::new();
    let (mut i, mut line, mut column) = (0, 1, 1);
    let mut start = (1, 1);
    let mut text = String::new();
    let mut quote = None;

    let mut depth = 0usize;
    let mut pipe = false;
    let mut flush = |text: &mut String, (line, column)| {
        // JavaScript trims the text, but keeps the column of the first non-ASCII-space token.
        let whitespace = |c: char| (c.is_whitespace() && c != '\u{0085}') || c == '\u{feff}';
        let end = text.trim_end_matches(whitespace).len();
        text.truncate(end);
        if !text.is_empty() {
            let start = text.len() - text.trim_start_matches(whitespace).len();
            text.drain(..start);
            stmts.push(Statement {
                text: std::mem::take(text),
                line,
                column,
            });
        }
    };
    while i < source.len() {
        let rest = &source[i..];
        if quote.is_none() && rest.starts_with("%%") {
            if let Some(body) = rest.strip_prefix("%%{") {
                let Some((directive, _)) = body.split_once("}%%") else {
                    return Err(format!(
                        "mmdc: E_SYNTAX (line {line}, column {column}): Unclosed Mermaid directive\n"
                    ));
                };
                metadata.directive(directive, &mut work)?;
                let len = directive.len() + 6;
                for c in rest[..len].chars() {
                    if c == '\n' {
                        line += 1;
                        column = 1;
                    } else {
                        column += c.len_utf16();
                    }
                }
                i += len;
            } else {
                let len = rest.find(['\r', '\n']).unwrap_or(rest.len());
                column += rest[..len].encode_utf16().count();
                i += len;
            }
            continue;
        }
        let mut c = rest.chars().next().unwrap();
        i += c.len_utf8();
        if c == '\r' {
            if source[i..].starts_with('\n') {
                i += 1;
            }
            c = '\n';
        }
        if text.is_empty() {
            start = (line, column);
        }
        if c == '\n' {
            line += 1;
            column = 1;
        } else {
            column += c.len_utf16();
        }
        if let Some(q) = quote {
            text.push(c);
            if c == '\\'
                && let Some(next) = source[i..].chars().next()
            {
                text.push(next);
                i += next.len_utf8();
                column += next.len_utf16();
            } else if q == c {
                quote = None;
            }
            continue;
        }
        match c {
            '\'' | '"' => quote = Some(c),
            '|' if depth == 0 => pipe = !pipe,
            '[' | '(' | '{' if !pipe => depth += 1,
            ']' | ')' | '}' if !pipe => depth = depth.saturating_sub(1),
            '\n' | ';' if c == '\n' || (depth == 0 && !pipe) => {
                flush(&mut text, start);
                depth = 0;
                pipe = false;
                continue;
            }
            _ => {}
        }
        if !text.is_empty() || !matches!(c, ' ' | '\t' | '\r' | '\n') {
            text.push(c);
        }
    }
    if quote.is_some() {
        return Err(format!(
            "mmdc: E_SYNTAX (line {}, column {}): Unterminated quoted string in diagram source\n",
            start.0, start.1
        ));
    }
    flush(&mut text, start);
    Ok(stmts)
}

pub(super) fn label(raw: &str, stmt: &Statement, token: &str) -> Result<String, String> {
    let text = unquote(raw);
    check_label(&text, stmt, token)?;
    Ok(text)
}

pub(super) fn unquote(raw: &str) -> String {
    let raw = raw.trim();
    let mut text = String::new();
    if let Some(q) = raw.chars().next().filter(|q| matches!(q, '\'' | '"'))
        && let Some(inner) = raw[1..].strip_suffix(q)
    {
        let mut chars = inner.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '\\' {
                match chars.peek() {
                    Some('n') => {
                        chars.next();
                        text.push('\n');
                        continue;
                    }
                    Some('\'' | '"' | '\\') => {
                        text.push(chars.next().unwrap());
                        continue;
                    }
                    _ => {}
                }
            }
            text.push(c);
        }
    } else {
        text.push_str(raw);
    }
    text
}

pub(super) fn check_label(text: &str, stmt: &Statement, token: &str) -> Result<(), String> {
    if let Some(message) = unsafe_label(text) {
        return Err(stmt.error("E_UNSUPPORTED", token, &message));
    }
    Ok(())
}

pub(super) fn unsafe_label(text: &str) -> Option<String> {
    let lower = text.to_ascii_lowercase();
    for forbidden in [
        "<script",
        "</script",
        "<iframe",
        "<object",
        "<embed",
        "<svg",
        "<img",
        "<a ",
        "javascript:",
        "onerror=",
        "onload=",
    ] {
        if lower.contains(forbidden) {
            return Some(format!(
                "Unsupported HTML or active content '{forbidden}' in diagram label"
            ));
        }
    }
    None
}

pub(super) fn strip_quotes(value: &str) -> &str {
    let s = value.trim_ascii();
    match s.as_bytes() {
        [a @ (b'\'' | b'"'), .., b] if a == b => &s[1..s.len() - 1],
        _ => s,
    }
}

pub(super) fn outside<'a>(s: &'a str, mut token: impl FnMut(&'a str) -> bool) -> Option<usize> {
    let mut quote = None;
    for (i, c) in s.char_indices() {
        if let Some(q) = quote {
            if c == q && !s[..i].ends_with('\\') {
                quote = None;
            }
        } else if matches!(c, '\'' | '"') {
            quote = Some(c);
        } else if token(&s[i..]) {
            return Some(i);
        }
    }
    None
}
