#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Token {
    Word(String),
    Semi,
    Newline,
    Pipe,
    AndIf,
    OrIf,
    Background,
    LParen,
    RParen,
    RedirectOut,
    RedirectAppend,
    RedirectClobber,
    RedirectIn,
    RedirectHereString,
    RedirectHereDoc { delimiter: String, quoted: bool, body: String },
    RedirectErrOut,
    RedirectErrAppend,
    RedirectErrToOut,
    RedirectOutToErr,
    RedirectBothOut,
}

pub fn tokenize_shell(input: &str) -> Result<Vec<Token>, String> {
    let mut tokens = Vec::new();
    let lines: Vec<&str> = input.split('\n').collect();
    let mut line_idx = 0usize;

    while line_idx < lines.len() {
        let line = lines[line_idx];
        let mut chars = line.chars().peekable();
        let mut current = String::new();
        let mut pending_heredocs: Vec<(String, bool, bool)> = Vec::new();

        while let Some(ch) = chars.next() {
            match ch {
                '\'' => {
                    current.push('\'');
                    let mut closed = false;
                    loop {
                        for next in chars.by_ref() {
                            current.push(next);
                            if next == '\'' {
                                closed = true;
                                break;
                            }
                        }
                        if closed || !pending_heredocs.is_empty() || line_idx + 1 >= lines.len() {
                            break;
                        }
                        line_idx += 1;
                        current.push('\n');
                        chars = lines[line_idx].chars().peekable();
                    }
                    if !closed {
                        return Err("Syntax error: unclosed single quote".to_string());
                    }
                }
                '"' => {
                    current.push('"');
                    let mut closed = false;
                    loop {
                        while let Some(next) = chars.next() {
                            current.push(next);
                            if next == '\\' {
                                if let Some(esc) = chars.next() {
                                    current.push(esc);
                                }
                            } else if next == '"' {
                                closed = true;
                                break;
                            }
                        }
                        if closed || !pending_heredocs.is_empty() || line_idx + 1 >= lines.len() {
                            break;
                        }
                        line_idx += 1;
                        current.push('\n');
                        chars = lines[line_idx].chars().peekable();
                    }
                    if !closed {
                        return Err("Syntax error: unclosed double quote".to_string());
                    }
                }
                '\\' => {
                    if let Some(esc) = chars.next() {
                        current.push('\\');
                        current.push(esc);
                    } else {
                        current.push('\\');
                    }
                }
                '$' if chars.peek() == Some(&'(') => {
                    current.push('$');
                    current.push(chars.next().unwrap());
                    let mut depth = 1usize;
                    let mut in_sq = false;
                    let mut in_dq = false;
                    while let Some(c) = chars.next() {
                        current.push(c);
                        if in_sq {
                            if c == '\'' {
                                in_sq = false;
                            }
                        } else if in_dq {
                            if c == '\\' {
                                if let Some(esc) = chars.next() {
                                    current.push(esc);
                                }
                            } else if c == '"' {
                                in_dq = false;
                            }
                        } else {
                            match c {
                                '\'' => in_sq = true,
                                '"' => in_dq = true,
                                '\\' => {
                                    if let Some(esc) = chars.next() {
                                        current.push(esc);
                                    }
                                }
                                '(' => depth += 1,
                                ')' => {
                                    depth -= 1;
                                    if depth == 0 {
                                        break;
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    if depth != 0 {
                        return Err("Syntax error: unclosed command/arithmetic substitution".to_string());
                    }
                }
                '$' if chars.peek() == Some(&'{') => {
                    current.push('$');
                    current.push(chars.next().unwrap());
                    let mut depth = 1usize;
                    while let Some(c) = chars.next() {
                        current.push(c);
                        if c == '\\' {
                            if let Some(esc) = chars.next() {
                                current.push(esc);
                            }
                        } else if c == '{' {
                            depth += 1;
                        } else if c == '}' {
                            depth -= 1;
                            if depth == 0 {
                                break;
                            }
                        }
                    }
                    if depth != 0 {
                        return Err("Syntax error: unclosed parameter expansion".to_string());
                    }
                }
                '#' if current.is_empty() => {
                    break;
                }
                ' ' | '\t' | '\r' => {
                    if !current.is_empty() {
                        tokens.push(Token::Word(std::mem::take(&mut current)));
                    }
                }
                ';' => {
                    if !current.is_empty() {
                        tokens.push(Token::Word(std::mem::take(&mut current)));
                    }
                    tokens.push(Token::Semi);
                }
                '(' => {
                    if current.ends_with('=') {
                        current.push('(');
                        let mut depth = 1i32;
                        let mut in_q: Option<char> = None;
                        while let Some(nc) = chars.next() {
                            current.push(nc);
                            if let Some(qc) = in_q {
                                if nc == qc {
                                    in_q = None;
                                } else if nc == '\\' && qc == '"' {
                                    if let Some(esc) = chars.next() {
                                        current.push(esc);
                                    }
                                }
                            } else if nc == '\'' || nc == '"' {
                                in_q = Some(nc);
                            } else if nc == '(' {
                                depth += 1;
                            } else if nc == ')' {
                                depth -= 1;
                                if depth == 0 {
                                    break;
                                }
                            }
                        }
                    } else {
                        if !current.is_empty() {
                            tokens.push(Token::Word(std::mem::take(&mut current)));
                        }
                        tokens.push(Token::LParen);
                    }
                }
                ')' => {
                    if !current.is_empty() {
                        tokens.push(Token::Word(std::mem::take(&mut current)));
                    }
                    tokens.push(Token::RParen);
                }
                '|' => {
                    if !current.is_empty() {
                        tokens.push(Token::Word(std::mem::take(&mut current)));
                    }
                    if chars.peek() == Some(&'|') {
                        chars.next();
                        tokens.push(Token::OrIf);
                    } else {
                        tokens.push(Token::Pipe);
                    }
                }
                '&' => {
                    if !current.is_empty() {
                        tokens.push(Token::Word(std::mem::take(&mut current)));
                    }
                    if chars.peek() == Some(&'&') {
                        chars.next();
                        tokens.push(Token::AndIf);
                    } else if chars.peek() == Some(&'>') {
                        chars.next();
                        tokens.push(Token::RedirectBothOut);
                    } else {
                        tokens.push(Token::Background);
                    }
                }
                '2' if current.is_empty() && chars.peek() == Some(&'>') => {
                    chars.next();
                    if chars.peek() == Some(&'>') {
                        chars.next();
                        tokens.push(Token::RedirectErrAppend);
                    } else if chars.peek() == Some(&'&') {
                        let mut clone = chars.clone();
                        clone.next();
                        if clone.peek() == Some(&'1') {
                            chars.next();
                            chars.next();
                            tokens.push(Token::RedirectErrToOut);
                        } else {
                            tokens.push(Token::RedirectErrOut);
                        }
                    } else {
                        tokens.push(Token::RedirectErrOut);
                    }
                }
                '>' => {
                    if !current.is_empty() {
                        tokens.push(Token::Word(std::mem::take(&mut current)));
                    }
                    if chars.peek() == Some(&'>') {
                        chars.next();
                        tokens.push(Token::RedirectAppend);
                    } else if chars.peek() == Some(&'|') {
                        chars.next();
                        tokens.push(Token::RedirectClobber);
                    } else if chars.peek() == Some(&'&') {
                        let mut clone = chars.clone();
                        clone.next();
                        if clone.peek() == Some(&'2') {
                            chars.next();
                            chars.next();
                            tokens.push(Token::RedirectOutToErr);
                        } else {
                            tokens.push(Token::RedirectOut);
                        }
                    } else {
                        tokens.push(Token::RedirectOut);
                    }
                }
                '<' => {
                    if !current.is_empty() {
                        tokens.push(Token::Word(std::mem::take(&mut current)));
                    }
                    if chars.peek() == Some(&'<') {
                        chars.next();
                        if chars.peek() == Some(&'<') {
                            chars.next();
                            tokens.push(Token::RedirectHereString);
                        } else {
                            let strip_tabs = if chars.peek() == Some(&'-') {
                                chars.next();
                                true
                            } else {
                                false
                            };
                            while matches!(chars.peek(), Some(' ' | '\t')) {
                                chars.next();
                            }
                            let mut raw_delim = String::new();
                            while let Some(&c) = chars.peek() {
                                if c.is_whitespace() || matches!(c, ';' | '|' | '&' | '>' | '<') {
                                    break;
                                }
                                raw_delim.push(chars.next().unwrap());
                            }
                            let quoted = raw_delim.contains('\'') || raw_delim.contains('"') || raw_delim.contains('\\');
                            let clean_delim: String = raw_delim
                                .chars()
                                .filter(|&c| c != '\'' && c != '"' && c != '\\')
                                .collect();
                            pending_heredocs.push((clean_delim, quoted, strip_tabs));
                        }
                    } else {
                        tokens.push(Token::RedirectIn);
                    }
                }
                other => current.push(other),
            }
        }

        if !current.is_empty() {
            tokens.push(Token::Word(current));
        }

        for (delim, quoted, strip_tabs) in pending_heredocs {
            let mut body = String::new();
            let mut found = false;
            while line_idx + 1 < lines.len() {
                line_idx += 1;
                let hline = lines[line_idx];
                let check = if strip_tabs {
                    hline.trim_start_matches('\t')
                } else {
                    hline
                };
                if check == delim {
                    found = true;
                    break;
                }
                body.push_str(check);
                body.push('\n');
            }
            if !found {
                return Err(format!("Syntax error: unclosed here-document `{delim}`"));
            }
            tokens.push(Token::RedirectHereDoc {
                delimiter: delim,
                quoted,
                body,
            });
        }

        tokens.push(Token::Newline);
        line_idx += 1;
    }

    Ok(tokens)
}
