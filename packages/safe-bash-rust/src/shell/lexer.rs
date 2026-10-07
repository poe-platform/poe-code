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
    RedirectOut(u32),
    RedirectAppend(u32),
    RedirectClobber(u32),
    RedirectIn(u32),
    RedirectHereString(u32),
    RedirectHereDoc {
        fd: u32,
        delimiter: String,
        quoted: bool,
        body: String,
    },
    RedirectDupOut(u32),
    RedirectDupIn(u32),
    RedirectBothOut,
    RedirectBothAppend,
}

pub fn tokenize_shell(input: &str) -> Result<Vec<Token>, String> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0usize;
    let mut current = String::new();
    let mut pending_heredocs: Vec<(usize, u32, String, bool, bool)> = Vec::new();
    let mut in_double_bracket = false;
    let mut after_regex_op = false;

    while i < chars.len() {
        let ch = chars[i];
        match ch {
            '\n' => {
                if !current.is_empty() {
                    let w = std::mem::take(&mut current);
                    if w == "[[" {
                        in_double_bracket = true;
                        after_regex_op = false;
                    } else if w == "]]" {
                        in_double_bracket = false;
                        after_regex_op = false;
                    } else {
                        after_regex_op = in_double_bracket && w == "=~";
                    }
                    tokens.push(Token::Word(w));
                }
                i += 1;
                if !pending_heredocs.is_empty() {
                    let drains = std::mem::take(&mut pending_heredocs);
                    for (tok_idx, fd, delim, quoted, strip_tabs) in drains {
                        let mut body = String::new();
                        let mut found = false;
                        while i < chars.len() {
                            let line_start = i;
                            while i < chars.len() && chars[i] != '\n' {
                                i += 1;
                            }
                            let line: String = chars[line_start..i].iter().collect();
                            if i < chars.len() && chars[i] == '\n' {
                                i += 1;
                            }
                            let check = if strip_tabs {
                                line.trim_start_matches('\t')
                            } else {
                                line.as_str()
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
                        tokens[tok_idx] = Token::RedirectHereDoc {
                            fd,
                            delimiter: delim,
                            quoted,
                            body,
                        };
                    }
                }
                tokens.push(Token::Newline);
            }
            '\'' => {
                current.push('\'');
                i += 1;
                let mut closed = false;
                while i < chars.len() {
                    let next = chars[i];
                    current.push(next);
                    i += 1;
                    if next == '\'' {
                        closed = true;
                        break;
                    }
                }
                if !closed {
                    return Err("Syntax error: unclosed single quote".to_string());
                }
            }
            '"' => {
                current.push('"');
                i += 1;
                let mut closed = false;
                while i < chars.len() {
                    let next = chars[i];
                    if next == '\\' {
                        if i + 1 < chars.len() && chars[i + 1] == '\n' {
                            i += 2;
                            continue;
                        }
                        current.push('\\');
                        i += 1;
                        if i < chars.len() {
                            current.push(chars[i]);
                            i += 1;
                        }
                    } else if next == '$' && i + 1 < chars.len() && chars[i + 1] == '(' {
                        read_dollar_paren(&chars, &mut i, &mut current)?;
                    } else if next == '$' && i + 1 < chars.len() && chars[i + 1] == '{' {
                        read_dollar_brace(&chars, &mut i, &mut current)?;
                    } else if next == '"' {
                        current.push('"');
                        i += 1;
                        closed = true;
                        break;
                    } else {
                        current.push(next);
                        i += 1;
                    }
                }
                if !closed {
                    return Err("Syntax error: unclosed double quote".to_string());
                }
            }
            '\\' => {
                if i + 1 < chars.len() && chars[i + 1] == '\n' {
                    i += 2;
                } else if i + 1 < chars.len() {
                    current.push('\\');
                    current.push(chars[i + 1]);
                    i += 2;
                } else {
                    current.push('\\');
                    i += 1;
                }
            }
            '$' if i + 1 < chars.len() && chars[i + 1] == '(' => {
                read_dollar_paren(&chars, &mut i, &mut current)?;
            }
            '$' if i + 1 < chars.len() && chars[i + 1] == '{' => {
                read_dollar_brace(&chars, &mut i, &mut current)?;
            }
            '$' if i + 1 < chars.len() && chars[i + 1] == '\'' => {
                current.push('$');
                current.push('\'');
                i += 2;
                while i < chars.len() {
                    let c = chars[i];
                    current.push(c);
                    i += 1;
                    if c == '\\' && i < chars.len() {
                        current.push(chars[i]);
                        i += 1;
                    } else if c == '\'' {
                        break;
                    }
                }
            }
            '`' => {
                current.push('`');
                i += 1;
                let mut closed = false;
                while i < chars.len() {
                    let c = chars[i];
                    current.push(c);
                    i += 1;
                    if c == '\\' && i < chars.len() {
                        current.push(chars[i]);
                        i += 1;
                    } else if c == '`' {
                        closed = true;
                        break;
                    }
                }
                if !closed {
                    return Err("Syntax error: unclosed backtick".to_string());
                }
            }
            '#' if current.is_empty() => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
            }
            ' ' | '\t' | '\r' => {
                if !current.is_empty() {
                    let w = std::mem::take(&mut current);
                    if w == "[[" {
                        in_double_bracket = true;
                        after_regex_op = false;
                    } else if w == "]]" {
                        in_double_bracket = false;
                        after_regex_op = false;
                    } else {
                        after_regex_op = in_double_bracket && w == "=~";
                    }
                    tokens.push(Token::Word(w));
                }
                i += 1;
            }
            ';' => {
                if !current.is_empty() {
                    let w = std::mem::take(&mut current);
                    if w == "]]" {
                        in_double_bracket = false;
                    }
                    after_regex_op = false;
                    tokens.push(Token::Word(w));
                }
                tokens.push(Token::Semi);
                i += 1;
            }
            '(' | ')' if in_double_bracket && after_regex_op => {
                current.push(ch);
                i += 1;
            }
            '(' | ')' if in_double_bracket && !(ch == '(' && current.ends_with(['?', '*', '+', '@', '!'])) => {
                if !current.is_empty() {
                    tokens.push(Token::Word(std::mem::take(&mut current)));
                }
                tokens.push(Token::Word(ch.to_string()));
                i += 1;
            }
            '(' => {
                if current.ends_with(['=', '?', '*', '+', '@', '!']) {
                    current.push('(');
                    i += 1;
                    let mut depth = 1usize;
                    while i < chars.len() && depth > 0 {
                        let c = chars[i];
                        if c == '\'' {
                            current.push(c);
                            i += 1;
                            while i < chars.len() {
                                let sc = chars[i];
                                current.push(sc);
                                i += 1;
                                if sc == '\'' {
                                    break;
                                }
                            }
                            continue;
                        } else if c == '"' {
                            current.push(c);
                            i += 1;
                            while i < chars.len() {
                                let dc = chars[i];
                                current.push(dc);
                                i += 1;
                                if dc == '\\' && i < chars.len() {
                                    current.push(chars[i]);
                                    i += 1;
                                } else if dc == '"' {
                                    break;
                                }
                            }
                            continue;
                        }
                        current.push(c);
                        i += 1;
                        if c == '(' {
                            depth += 1;
                        } else if c == ')' {
                            depth -= 1;
                        }
                    }
                } else {
                    if !current.is_empty() {
                        tokens.push(Token::Word(std::mem::take(&mut current)));
                    }
                    if i + 1 < chars.len() && chars[i + 1] == '(' {
                        read_arith_command_tokens(&chars, &mut i, &mut tokens)?;
                    } else {
                        tokens.push(Token::LParen);
                        i += 1;
                    }
                }
            }
            ')' => {
                if !current.is_empty() {
                    tokens.push(Token::Word(std::mem::take(&mut current)));
                }
                tokens.push(Token::RParen);
                i += 1;
            }
            '|' if in_double_bracket && after_regex_op && !(i + 1 < chars.len() && chars[i + 1] == '|') => {
                current.push('|');
                i += 1;
            }
            '|' => {
                after_regex_op = false;
                if !current.is_empty() {
                    tokens.push(Token::Word(std::mem::take(&mut current)));
                }
                if i + 1 < chars.len() && chars[i + 1] == '|' {
                    i += 2;
                    if in_double_bracket {
                        tokens.push(Token::Word("||".to_string()));
                    } else {
                        tokens.push(Token::OrIf);
                    }
                } else if i + 1 < chars.len() && chars[i + 1] == '&' {
                    i += 2;
                    tokens.push(Token::RedirectDupOut(2));
                    tokens.push(Token::Word("1".to_string()));
                    tokens.push(Token::Pipe);
                } else {
                    i += 1;
                    tokens.push(Token::Pipe);
                }
            }
            '&' => {
                after_regex_op = false;
                if !current.is_empty() {
                    tokens.push(Token::Word(std::mem::take(&mut current)));
                }
                if i + 1 < chars.len() && chars[i + 1] == '&' {
                    i += 2;
                    if in_double_bracket {
                        tokens.push(Token::Word("&&".to_string()));
                    } else {
                        tokens.push(Token::AndIf);
                    }
                } else if i + 1 < chars.len() && chars[i + 1] == '>' {
                    i += 2;
                    if i < chars.len() && chars[i] == '>' {
                        i += 1;
                        tokens.push(Token::RedirectBothAppend);
                    } else {
                        tokens.push(Token::RedirectBothOut);
                    }
                } else {
                    i += 1;
                    tokens.push(Token::Background);
                }
            }
            '>' | '<' if in_double_bracket && after_regex_op => {
                current.push(ch);
                i += 1;
            }
            '>' | '<' if in_double_bracket => {
                if !current.is_empty() {
                    tokens.push(Token::Word(std::mem::take(&mut current)));
                }
                tokens.push(Token::Word(ch.to_string()));
                i += 1;
            }
            '>' | '<' if i + 1 < chars.len() && chars[i + 1] == '(' => {
                current.push(ch);
                current.push('(');
                i += 2;
                let mut depth = 1usize;
                let mut in_sq = false;
                let mut in_dq = false;
                while i < chars.len() && depth > 0 {
                    let c = chars[i];
                    current.push(c);
                    i += 1;
                    if in_sq {
                        if c == '\'' {
                            in_sq = false;
                        }
                    } else if in_dq {
                        if c == '\\' && i < chars.len() {
                            current.push(chars[i]);
                            i += 1;
                        } else if c == '"' {
                            in_dq = false;
                        }
                    } else if c == '\'' {
                        in_sq = true;
                    } else if c == '"' {
                        in_dq = true;
                    } else if c == '(' {
                        depth += 1;
                    } else if c == ')' {
                        depth -= 1;
                    }
                }
            }
            '>' => {
                let fd = if !current.is_empty() && current.chars().all(|c| c.is_ascii_digit()) {
                    let parsed = current.parse::<u32>().unwrap_or(1);
                    current.clear();
                    parsed
                } else {
                    if !current.is_empty() {
                        tokens.push(Token::Word(std::mem::take(&mut current)));
                    }
                    1
                };
                i += 1;
                if i < chars.len() && chars[i] == '>' {
                    i += 1;
                    tokens.push(Token::RedirectAppend(fd));
                } else if i < chars.len() && chars[i] == '|' {
                    i += 1;
                    tokens.push(Token::RedirectClobber(fd));
                } else if i < chars.len() && chars[i] == '&' {
                    i += 1;
                    tokens.push(Token::RedirectDupOut(fd));
                } else {
                    tokens.push(Token::RedirectOut(fd));
                }
            }
            '<' => {
                let fd = if !current.is_empty() && current.chars().all(|c| c.is_ascii_digit()) {
                    let parsed = current.parse::<u32>().unwrap_or(0);
                    current.clear();
                    parsed
                } else {
                    if !current.is_empty() {
                        tokens.push(Token::Word(std::mem::take(&mut current)));
                    }
                    0
                };
                i += 1;
                if i < chars.len() && chars[i] == '<' {
                    i += 1;
                    if i < chars.len() && chars[i] == '<' {
                        i += 1;
                        tokens.push(Token::RedirectHereString(fd));
                    } else {
                        let strip_tabs = if i < chars.len() && chars[i] == '-' {
                            i += 1;
                            true
                        } else {
                            false
                        };
                        while i < chars.len() && matches!(chars[i], ' ' | '\t') {
                            i += 1;
                        }
                        let mut raw_delim = String::new();
                        while i < chars.len() {
                            let c = chars[i];
                            if c == '\n' || c.is_whitespace() || matches!(c, ';' | '|' | '&' | '>' | '<' | ')') {
                                break;
                            }
                            if c == '\'' || c == '"' {
                                let q = c;
                                raw_delim.push(c);
                                i += 1;
                                while i < chars.len() && chars[i] != q {
                                    raw_delim.push(chars[i]);
                                    i += 1;
                                }
                                if i < chars.len() {
                                    raw_delim.push(chars[i]);
                                    i += 1;
                                }
                            } else {
                                raw_delim.push(c);
                                i += 1;
                            }
                        }
                        let quoted = raw_delim.contains('\'') || raw_delim.contains('"') || raw_delim.contains('\\');
                        let clean_delim: String = raw_delim
                            .chars()
                            .filter(|&c| c != '\'' && c != '"' && c != '\\')
                            .collect();
                        let tok_idx = tokens.len();
                        tokens.push(Token::RedirectHereDoc {
                            fd,
                            delimiter: clean_delim.clone(),
                            quoted,
                            body: String::new(),
                        });
                        pending_heredocs.push((tok_idx, fd, clean_delim, quoted, strip_tabs));
                    }
                } else if i < chars.len() && chars[i] == '&' {
                    i += 1;
                    tokens.push(Token::RedirectDupIn(fd));
                } else if i < chars.len() && chars[i] == '>' {
                    i += 1;
                    tokens.push(Token::RedirectIn(fd));
                } else {
                    tokens.push(Token::RedirectIn(fd));
                }
            }
            '[' if !current.is_empty()
                && current.chars().enumerate().all(|(idx, c)| {
                    if idx == 0 {
                        c.is_ascii_alphabetic() || c == '_'
                    } else {
                        c.is_ascii_alphanumeric() || c == '_'
                    }
                }) =>
            {
                let mut j = i + 1;
                let mut depth = 1usize;
                let mut in_q: Option<char> = None;
                while j < chars.len() && chars[j] != '\n' && depth > 0 {
                    let c = chars[j];
                    if let Some(q) = in_q {
                        if c == '\\' && q == '"' && j + 1 < chars.len() {
                            j += 2;
                            continue;
                        }
                        if c == q {
                            in_q = None;
                        }
                    } else if c == '"' || c == '\'' {
                        in_q = Some(c);
                    } else if c == '[' {
                        depth += 1;
                    } else if c == ']' {
                        depth -= 1;
                    }
                    j += 1;
                }
                let is_assign_sub = depth == 0
                    && j < chars.len()
                    && (chars[j] == '='
                        || (chars[j] == '+' && j + 1 < chars.len() && chars[j + 1] == '='));
                if is_assign_sub {
                    while i < j {
                        current.push(chars[i]);
                        i += 1;
                    }
                } else {
                    current.push('[');
                    i += 1;
                }
            }
            other => {
                current.push(other);
                i += 1;
            }
        }
    }

    if !current.is_empty() {
        tokens.push(Token::Word(current));
    }

    if !pending_heredocs.is_empty() {
        return Err(format!(
            "Syntax error: unclosed here-document `{}`",
            pending_heredocs[0].2
        ));
    }

    tokens.push(Token::Newline);
    Ok(tokens)
}

fn read_dollar_paren(chars: &[char], i: &mut usize, out: &mut String) -> Result<(), String> {
    out.push('$');
    out.push('(');
    *i += 2;
    let is_arith = *i < chars.len() && chars[*i] == '(';
    if is_arith {
        out.push('(');
        *i += 1;
        let mut depth = 2usize;
        while *i < chars.len() && depth > 0 {
            let c = chars[*i];
            if c == '\\' && *i + 1 < chars.len() && chars[*i + 1] == '\n' {
                *i += 2;
                continue;
            }
            out.push(c);
            *i += 1;
            if c == '(' {
                depth += 1;
            } else if c == ')' {
                depth -= 1;
            }
        }
        if depth != 0 {
            return Err("Syntax error: unclosed arithmetic expansion".to_string());
        }
        return Ok(());
    }

    let mut depth = 1usize;
    let mut in_sq = false;
    let mut in_dq = false;
    while *i < chars.len() && depth > 0 {
        let c = chars[*i];
        if in_sq {
            out.push(c);
            *i += 1;
            if c == '\'' {
                in_sq = false;
            }
        } else if in_dq {
            if c == '\\' {
                if *i + 1 < chars.len() && chars[*i + 1] == '\n' {
                    *i += 2;
                    continue;
                }
                out.push('\\');
                *i += 1;
                if *i < chars.len() {
                    out.push(chars[*i]);
                    *i += 1;
                }
            } else if c == '$' && *i + 1 < chars.len() && chars[*i + 1] == '(' {
                read_dollar_paren(chars, i, out)?;
            } else if c == '$' && *i + 1 < chars.len() && chars[*i + 1] == '{' {
                read_dollar_brace(chars, i, out)?;
            } else {
                out.push(c);
                *i += 1;
                if c == '"' {
                    in_dq = false;
                }
            }
        } else {
            if c == '\\' {
                if *i + 1 < chars.len() && chars[*i + 1] == '\n' {
                    *i += 2;
                    continue;
                }
                out.push('\\');
                *i += 1;
                if *i < chars.len() {
                    out.push(chars[*i]);
                    *i += 1;
                }
            } else if c == '\'' {
                out.push(c);
                *i += 1;
                in_sq = true;
            } else if c == '"' {
                out.push(c);
                *i += 1;
                in_dq = true;
            } else if c == '$' && *i + 1 < chars.len() && chars[*i + 1] == '(' {
                read_dollar_paren(chars, i, out)?;
            } else if c == '$' && *i + 1 < chars.len() && chars[*i + 1] == '{' {
                read_dollar_brace(chars, i, out)?;
            } else if c == '(' {
                out.push(c);
                *i += 1;
                depth += 1;
            } else if c == ')' {
                out.push(c);
                *i += 1;
                depth -= 1;
            } else {
                out.push(c);
                *i += 1;
            }
        }
    }
    if depth != 0 {
        return Err("Syntax error: unclosed command substitution".to_string());
    }
    Ok(())
}

fn read_dollar_brace(chars: &[char], i: &mut usize, out: &mut String) -> Result<(), String> {
    out.push('$');
    out.push('{');
    *i += 2;
    let mut depth = 1usize;
    let mut in_sq = false;
    let mut in_dq = false;
    while *i < chars.len() && depth > 0 {
        let c = chars[*i];
        if in_sq {
            out.push(c);
            *i += 1;
            if c == '\'' {
                in_sq = false;
            }
        } else if in_dq {
            if c == '\\' {
                if *i + 1 < chars.len() && chars[*i + 1] == '\n' {
                    *i += 2;
                    continue;
                }
                out.push('\\');
                *i += 1;
                if *i < chars.len() {
                    out.push(chars[*i]);
                    *i += 1;
                }
            } else if c == '$' && *i + 1 < chars.len() && chars[*i + 1] == '(' {
                read_dollar_paren(chars, i, out)?;
            } else if c == '$' && *i + 1 < chars.len() && chars[*i + 1] == '{' {
                read_dollar_brace(chars, i, out)?;
            } else {
                out.push(c);
                *i += 1;
                if c == '"' {
                    in_dq = false;
                }
            }
        } else {
            if c == '\\' {
                if *i + 1 < chars.len() && chars[*i + 1] == '\n' {
                    *i += 2;
                    continue;
                }
                out.push('\\');
                *i += 1;
                if *i < chars.len() {
                    out.push(chars[*i]);
                    *i += 1;
                }
            } else if c == '\'' {
                out.push(c);
                *i += 1;
                in_sq = true;
            } else if c == '"' {
                out.push(c);
                *i += 1;
                in_dq = true;
            } else if c == '$' && *i + 1 < chars.len() && chars[*i + 1] == '(' {
                read_dollar_paren(chars, i, out)?;
            } else if c == '$' && *i + 1 < chars.len() && chars[*i + 1] == '{' {
                read_dollar_brace(chars, i, out)?;
            } else if c == '{' {
                out.push(c);
                *i += 1;
                depth += 1;
            } else if c == '}' {
                out.push(c);
                *i += 1;
                depth -= 1;
            } else {
                out.push(c);
                *i += 1;
            }
        }
    }
    if depth != 0 {
        return Err("Syntax error: unclosed parameter expansion".to_string());
    }
    Ok(())
}

fn read_arith_command_tokens(
    chars: &[char],
    i: &mut usize,
    tokens: &mut Vec<Token>,
) -> Result<(), String> {
    tokens.push(Token::LParen);
    tokens.push(Token::LParen);
    *i += 2;
    let mut depth = 1i32;
    let mut buf = String::new();
    while *i < chars.len() {
        if chars[*i] == ')' && *i + 1 < chars.len() && chars[*i + 1] == ')' && depth == 1 {
            if !buf.trim().is_empty() {
                tokens.push(Token::Word(buf.trim().to_string()));
            }
            tokens.push(Token::RParen);
            tokens.push(Token::RParen);
            *i += 2;
            return Ok(());
        }
        let c = chars[*i];
        if c == '(' {
            depth += 1;
            buf.push(c);
            *i += 1;
        } else if c == ')' {
            depth -= 1;
            buf.push(c);
            *i += 1;
        } else if c == ';' && depth == 1 {
            tokens.push(Token::Word(buf.trim().to_string()));
            buf.clear();
            tokens.push(Token::Semi);
            *i += 1;
        } else {
            buf.push(c);
            *i += 1;
        }
    }
    Err("Syntax error: unclosed `((".to_string())
}
