pub(in super::super) struct Statement {
    pub text: String,
    line: usize,
    column: usize,
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

    pub(super) fn error(&self, code: &str, token: &str, message: &str) -> String {
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

pub(in super::super) fn is_flowchart(mut source: &str) -> bool {
    loop {
        source = source.trim_start();
        if let Some(body) = source.strip_prefix("%%{") {
            let Some((_, tail)) = body.split_once("}%%") else {
                return false;
            };
            source = tail;
        } else if source.starts_with("%%") {
            source = source.trim_start_matches(|c| c != '\r' && c != '\n');
        } else {
            return matches!(
                source.split(|c: char| c.is_whitespace() || c == ';').next(),
                Some("flowchart" | "graph")
            );
        }
    }
}

pub(in super::super) fn scan<'a>(
    source: &'a str,
    directives: &mut Vec<&'a str>,
) -> Result<Vec<Statement>, String> {
    let mut stmts = Vec::new();
    let (mut i, mut line, mut column) = (0, 1, 1);
    let mut start = (1, 1);
    let mut text = String::new();
    let mut quote = None;
    let mut escaped = false;
    let mut depth = 0usize;
    let mut pipe = false;
    while i < source.len() {
        let rest = &source[i..];
        if quote.is_none() && rest.starts_with("%%") {
            if let Some(body) = rest.strip_prefix("%%{") {
                let Some((directive, _)) = body.split_once("}%%") else {
                    return Err(format!(
                        "mmdc: E_SYNTAX (line {line}, column {column}): Unclosed Mermaid directive\n"
                    ));
                };
                directives.push(directive);
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
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
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
                if !text.is_empty() {
                    stmts.push(Statement {
                        text: std::mem::take(&mut text),
                        line: start.0,
                        column: start.1,
                    });
                }
                depth = 0;
                pipe = false;
                continue;
            }
            _ => {}
        }
        if !text.is_empty() || !c.is_whitespace() {
            text.push(c);
        }
    }
    if quote.is_some() {
        return Err(format!(
            "mmdc: E_SYNTAX (line {}, column {}): Unterminated quoted string in diagram source\n",
            start.0, start.1
        ));
    }
    if !text.is_empty() {
        stmts.push(Statement {
            text,
            line: start.0,
            column: start.1,
        });
    }
    Ok(stmts)
}

pub(super) fn label(raw: &str, stmt: &Statement, token: &str) -> Result<String, String> {
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
            return Err(stmt.error(
                "E_UNSUPPORTED",
                token,
                &format!("Unsupported HTML or active content '{forbidden}' in diagram label"),
            ));
        }
    }
    Ok(text)
}
