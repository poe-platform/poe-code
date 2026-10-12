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
    RedirectReadWrite(u32),
    RedirectHereString(u32),
    RedirectHereDoc {
        fd: u32,
        delimiter: String,
        quoted: bool,
        body: String,
        eof_warning: Option<String>,
    },
    RedirectDupOut(u32, bool),
    RedirectDupIn(u32),
    RedirectBothOut,
    RedirectBothAppend,
}

pub fn find_arithmetic_end(
    chars: &[char],
    start: usize,
    allow_subshell: bool,
) -> Result<Option<(usize, usize)>, String> {
    let mut depth: i32 = 0;
    let mut quote: Option<char> = None;
    let mut ansi_quote = false;
    let mut quoted_subs: Vec<i32> = Vec::new();
    let mut pos = start;
    while pos < chars.len() {
        let ch = chars[pos];
        if allow_subshell {
            if ch == '\\' && (quote != Some('\'') || ansi_quote) {
                pos += 2;
                continue;
            }
            if quote == Some('"') && ch == '$' && chars.get(pos + 1) == Some(&'(') {
                quoted_subs.push(depth);
                depth += 1;
                pos += 2;
                quote = None;
                continue;
            }
            if let Some(q) = quote {
                if ch == q {
                    quote = None;
                    ansi_quote = false;
                }
                pos += 1;
                continue;
            }
            if ch == '\'' || ch == '"' || ch == '`' {
                quote = Some(ch);
                ansi_quote = ch == '\'' && pos > start && chars[pos - 1] == '$';
                pos += 1;
                continue;
            }
        }
        if ch == '(' {
            depth += 1;
        }
        if ch == ')' {
            if depth == 0 {
                let mut next_close = pos + 1;
                while next_close + 1 < chars.len()
                    && chars[next_close] == '\\'
                    && chars[next_close + 1] == '\n'
                {
                    next_close += 2;
                }
                if chars.get(next_close) == Some(&')') {
                    return Ok(Some((pos, next_close + 1)));
                }
            }
            depth -= 1;
            if depth < 0 {
                if allow_subshell {
                    return Ok(None);
                }
                break;
            }
            if quoted_subs.last() == Some(&depth) {
                quoted_subs.pop();
                quote = Some('"');
            }
        }
        pos += 1;
    }
    Err("Syntax error: Unterminated arithmetic expression".to_string())
}

pub fn unquote_heredoc_delimiter(raw_delim: &str) -> (String, bool) {
    let dchars: Vec<char> = raw_delim.chars().collect();
    let mut di = 0usize;
    let mut clean = String::new();
    let mut quoted = false;
    while di < dchars.len() {
        if dchars[di] == '$' && di + 1 < dchars.len() && dchars[di + 1] == '\'' {
            quoted = true;
            di += 2;
            let mut inner = String::new();
            while di < dchars.len() && dchars[di] != '\'' {
                if dchars[di] == '\\' && di + 1 < dchars.len() {
                    inner.push(dchars[di]);
                    inner.push(dchars[di + 1]);
                    di += 2;
                } else {
                    inner.push(dchars[di]);
                    di += 1;
                }
            }
            if di < dchars.len() {
                di += 1;
            }
            clean.push_str(&crate::shell::expand::decode_ansi_c_escapes(&inner));
        } else if (dchars[di] == '$' && di + 1 < dchars.len() && dchars[di + 1] == '"')
            || dchars[di] == '"'
        {
            quoted = true;
            di += if dchars[di] == '$' { 2 } else { 1 };
            while di < dchars.len() && dchars[di] != '"' {
                if dchars[di] == '\\'
                    && di + 1 < dchars.len()
                    && matches!(dchars[di + 1], '$' | '`' | '"' | '\\' | '\n')
                {
                    if dchars[di + 1] != '\n' {
                        clean.push(dchars[di + 1]);
                    }
                    di += 2;
                } else {
                    clean.push(dchars[di]);
                    di += 1;
                }
            }
            if di < dchars.len() {
                di += 1;
            }
        } else if dchars[di] == '\'' {
            quoted = true;
            di += 1;
            while di < dchars.len() && dchars[di] != '\'' {
                clean.push(dchars[di]);
                di += 1;
            }
            if di < dchars.len() {
                di += 1;
            }
        } else if dchars[di] == '\\' && di + 1 < dchars.len() {
            if dchars[di + 1] == '\n' {
                di += 2;
            } else {
                quoted = true;
                clean.push(dchars[di + 1]);
                di += 2;
            }
        } else {
            clean.push(dchars[di]);
            di += 1;
        }
    }
    (clean, quoted)
}

pub fn read_heredoc_raw_delim(chars: &[char], i: &mut usize) -> Result<String, String> {
    let mut raw_delim = String::new();
    while *i < chars.len() {
        let c = chars[*i];
        if c == '\\' && *i + 1 < chars.len() && chars[*i + 1] == '\n' {
            *i += 2;
            continue;
        }
        if c == '\n' || c.is_whitespace() || matches!(c, ';' | '|' | '&' | '>' | '<' | '(' | ')') {
            break;
        }
        if c == '\\' && *i + 1 < chars.len() {
            raw_delim.push('\\');
            raw_delim.push(chars[*i + 1]);
            *i += 2;
        } else if c == '$' && *i + 1 < chars.len() && (chars[*i + 1] == '\'' || chars[*i + 1] == '"') {
            let q = chars[*i + 1];
            raw_delim.push('$');
            raw_delim.push(q);
            *i += 2;
            let mut closed = false;
            while *i < chars.len() {
                let ch = chars[*i];
                if ch == '\\' && *i + 1 < chars.len() {
                    if q == '"' && chars[*i + 1] == '\n' {
                        *i += 2;
                        continue;
                    }
                    raw_delim.push('\\');
                    raw_delim.push(chars[*i + 1]);
                    *i += 2;
                } else if ch == q {
                    raw_delim.push(q);
                    *i += 1;
                    closed = true;
                    break;
                } else {
                    raw_delim.push(ch);
                    *i += 1;
                }
            }
            if !closed {
                return Err("Syntax error: unclosed quote in here-document delimiter".to_string());
            }
        } else if c == '\'' {
            raw_delim.push('\'');
            *i += 1;
            let mut closed = false;
            while *i < chars.len() {
                let ch = chars[*i];
                raw_delim.push(ch);
                *i += 1;
                if ch == '\'' {
                    closed = true;
                    break;
                }
            }
            if !closed {
                return Err("Syntax error: unclosed single quote".to_string());
            }
        } else if c == '"' {
            raw_delim.push('"');
            *i += 1;
            let mut closed = false;
            while *i < chars.len() {
                let ch = chars[*i];
                if ch == '\\' && *i + 1 < chars.len() {
                    if chars[*i + 1] == '\n' {
                        *i += 2;
                        continue;
                    }
                    raw_delim.push('\\');
                    raw_delim.push(chars[*i + 1]);
                    *i += 2;
                } else if ch == '"' {
                    raw_delim.push('"');
                    *i += 1;
                    closed = true;
                    break;
                } else {
                    raw_delim.push(ch);
                    *i += 1;
                }
            }
            if !closed {
                return Err("Syntax error: unclosed double quote".to_string());
            }
        } else {
            raw_delim.push(c);
            *i += 1;
        }
    }
    Ok(raw_delim)
}

pub fn tokenize_shell(input: &str) -> Result<Vec<Token>, String> {
    tokenize_shell_with_extglob(input, true)
}

pub fn tokenize_shell_with_extglob(input: &str, extglob: bool) -> Result<Vec<Token>, String> {
    fn ends_with_unescaped_extglob_op(s: &str) -> bool {
        let Some(last) = s.chars().last() else {
            return false;
        };
        if !matches!(last, '?' | '*' | '+' | '@' | '!') {
            return false;
        }
        let prefix = &s[..s.len() - last.len_utf8()];
        let backslashes = prefix.bytes().rev().take_while(|&b| b == b'\\').count();
        backslashes % 2 == 0
    }

    fn is_lexer_cmd_position(tokens: &[Token]) -> bool {
        match tokens.last() {
            None => true,
            Some(
                Token::Newline
                | Token::Semi
                | Token::Pipe
                | Token::AndIf
                | Token::OrIf
                | Token::Background
                | Token::LParen,
            ) => true,
            Some(Token::Word(prev)) => matches!(
                prev.as_str(),
                "if" | "then" | "elif" | "else" | "while" | "until" | "do" | "{" | "!" | "time"
            ),
            _ => false,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn flush_current_word(
        current: &mut String,
        tokens: &mut Vec<Token>,
        in_double_bracket: &mut bool,
        after_regex_op: &mut bool,
        after_pat_op: &mut bool,
        regex_paren_depth: &mut usize,
        regex_bracket: &mut bool,
        regex_bracket_first: &mut bool,
        regex_bracket_negation: &mut bool,
        regex_class: &mut Option<char>,
        db_group_depth: &mut usize,
    ) -> Result<(), String> {
        if *in_double_bracket && *after_regex_op && *regex_paren_depth > 0 {
            return Err(
                "Syntax error: Unterminated conditional regular expression group".to_string(),
            );
        }
        *regex_paren_depth = 0;
        *regex_bracket = false;
        *regex_bracket_first = false;
        *regex_bracket_negation = false;
        *regex_class = None;
        if !current.is_empty() {
            let w = std::mem::take(current);
            if !*in_double_bracket && w == "[[" && is_lexer_cmd_position(tokens) {
                *in_double_bracket = true;
                *after_regex_op = false;
                *after_pat_op = false;
                *db_group_depth = 0;
            } else if *in_double_bracket && w == "]]" {
                *in_double_bracket = false;
                *after_regex_op = false;
                *after_pat_op = false;
                *db_group_depth = 0;
            } else if *in_double_bracket {
                *after_regex_op = w == "=~";
                *after_pat_op = matches!(w.as_str(), "=" | "==" | "!=");
            } else {
                *after_regex_op = false;
                *after_pat_op = false;
            }
            tokens.push(Token::Word(w));
        } else {
            *after_regex_op = false;
            *after_pat_op = false;
        }
        Ok(())
    }

    let mut tokens = Vec::new();
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0usize;
    let mut current = String::new();
    let mut pending_heredocs: Vec<(usize, u32, String, bool, bool, usize)> = Vec::new();
    let mut in_double_bracket = false;
    let mut after_regex_op = false;
    let mut after_pat_op = false;
    let mut regex_paren_depth = 0usize;
    let mut regex_bracket = false;
    let mut regex_bracket_first = false;
    let mut regex_bracket_negation = false;
    let mut regex_class: Option<char> = None;
    let mut db_group_depth = 0usize;

    while i < chars.len() {
        let ch = chars[i];
        if in_double_bracket
            && current == "]]"
            && matches!(ch, ';' | '|' | '&' | '(' | ')' | '<' | '>')
        {
            flush_current_word(
                &mut current,
                &mut tokens,
                &mut in_double_bracket,
                &mut after_regex_op,
                &mut after_pat_op,
                &mut regex_paren_depth,
                &mut regex_bracket,
                &mut regex_bracket_first,
                &mut regex_bracket_negation,
                &mut regex_class,
                &mut db_group_depth,
            )?;
        }
        if in_double_bracket
            && after_regex_op
            && (regex_bracket || ch == '[')
            && ch != '\n'
            && !(regex_paren_depth == 0 && matches!(ch, ' ' | '\t' | '\r' | ';'))
            && !matches!(ch, '\'' | '"' | '\\' | '$' | '`')
        {
            if !regex_bracket {
                regex_bracket = true;
                regex_bracket_first = true;
                regex_bracket_negation = true;
            } else if let Some(cls) = regex_class {
                if ch == ']' && current.ends_with(cls) {
                    regex_class = None;
                }
            } else if ch == '[' && matches!(chars.get(i + 1), Some(':' | '.' | '=')) {
                regex_class = chars.get(i + 1).copied();
                regex_bracket_first = false;
            } else if ch == ']' && !regex_bracket_first {
                regex_bracket = false;
            } else if ch == '^' && regex_bracket_first && regex_bracket_negation {
                regex_bracket_negation = false;
            } else {
                regex_bracket_first = false;
                regex_bracket_negation = false;
            }
            current.push(ch);
            i += 1;
            continue;
        }
        match ch {
            '\n' => {
                if !current.is_empty() || (in_double_bracket && after_regex_op && regex_paren_depth > 0) {
                    flush_current_word(
                        &mut current,
                        &mut tokens,
                        &mut in_double_bracket,
                        &mut after_regex_op,
                        &mut after_pat_op,
                        &mut regex_paren_depth,
                        &mut regex_bracket,
                        &mut regex_bracket_first,
                        &mut regex_bracket_negation,
                        &mut regex_class,
                        &mut db_group_depth,
                    )?;
                }
                i += 1;
                if !pending_heredocs.is_empty() {
                    let drains = std::mem::take(&mut pending_heredocs);
                    for (tok_idx, fd, delim, quoted, strip_tabs, delim_offset) in drains {
                        let mut body = String::new();
                        let mut found = false;
                        while i < chars.len() {
                            let mut line = String::new();
                            while i < chars.len() {
                                let cur_c = chars[i];
                                i += 1;
                                if !quoted && cur_c == '\\' && i < chars.len() {
                                    let next_c = chars[i];
                                    i += 1;
                                    if next_c != '\n' {
                                        line.push(cur_c);
                                        line.push(next_c);
                                    }
                                } else if cur_c == '\n' {
                                    break;
                                } else {
                                    line.push(cur_c);
                                }
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
                        let eof_warning = if !found {
                            Some(format!(
                                "here-document at offset {delim_offset} delimited by end-of-file (wanted {delim:?})"
                            ))
                        } else {
                            None
                        };
                        tokens[tok_idx] = Token::RedirectHereDoc {
                            fd,
                            delimiter: delim,
                            quoted,
                            body,
                            eof_warning,
                        };
                    }
                }
                if !in_double_bracket {
                    tokens.push(Token::Newline);
                }
            }
            '\'' => {
                if in_double_bracket && after_regex_op && regex_bracket {
                    regex_bracket_first = false;
                    regex_bracket_negation = false;
                }
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
                if in_double_bracket && after_regex_op && regex_bracket {
                    regex_bracket_first = false;
                    regex_bracket_negation = false;
                }
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
                        read_dollar_paren(&chars, &mut i, &mut current, extglob)?;
                    } else if next == '$' && i + 1 < chars.len() && chars[i + 1] == '{' {
                        read_dollar_brace(&chars, &mut i, &mut current, extglob)?;
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
                    if in_double_bracket && after_regex_op && regex_bracket {
                        regex_bracket_first = false;
                        regex_bracket_negation = false;
                    }
                    current.push('\\');
                    current.push(chars[i + 1]);
                    i += 2;
                } else {
                    if in_double_bracket && after_regex_op && regex_bracket {
                        regex_bracket_first = false;
                        regex_bracket_negation = false;
                    }
                    current.push('\\');
                    i += 1;
                }
            }
            '$' if i + 1 < chars.len() && chars[i + 1] == '(' => {
                if in_double_bracket && after_regex_op && regex_bracket {
                    regex_bracket_first = false;
                    regex_bracket_negation = false;
                }
                read_dollar_paren(&chars, &mut i, &mut current, extglob)?;
            }
            '$' if i + 1 < chars.len() && chars[i + 1] == '{' => {
                if in_double_bracket && after_regex_op && regex_bracket {
                    regex_bracket_first = false;
                    regex_bracket_negation = false;
                }
                read_dollar_brace(&chars, &mut i, &mut current, extglob)?;
            }
            '$' if i + 1 < chars.len() && chars[i + 1] == '\'' => {
                if in_double_bracket && after_regex_op && regex_bracket {
                    regex_bracket_first = false;
                    regex_bracket_negation = false;
                }
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
                if in_double_bracket && after_regex_op && regex_bracket {
                    regex_bracket_first = false;
                    regex_bracket_negation = false;
                }
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
                if in_double_bracket
                    && (after_regex_op || after_pat_op)
                    && regex_paren_depth > 0
                    && ch != '\r'
                {
                    current.push(ch);
                    i += 1;
                    continue;
                }
                if !current.is_empty() {
                    flush_current_word(
                        &mut current,
                        &mut tokens,
                        &mut in_double_bracket,
                        &mut after_regex_op,
                        &mut after_pat_op,
                        &mut regex_paren_depth,
                        &mut regex_bracket,
                        &mut regex_bracket_first,
                        &mut regex_bracket_negation,
                        &mut regex_class,
                        &mut db_group_depth,
                    )?;
                }
                i += 1;
            }
            ';' => {
                if in_double_bracket && (after_regex_op || after_pat_op) && regex_paren_depth > 0 {
                    current.push(';');
                    i += 1;
                    continue;
                }
                flush_current_word(
                    &mut current,
                    &mut tokens,
                    &mut in_double_bracket,
                    &mut after_regex_op,
                    &mut after_pat_op,
                    &mut regex_paren_depth,
                    &mut regex_bracket,
                    &mut regex_bracket_first,
                    &mut regex_bracket_negation,
                    &mut regex_class,
                    &mut db_group_depth,
                )?;
                tokens.push(Token::Semi);
                i += 1;
            }
            '(' | ')' if in_double_bracket && after_regex_op => {
                if ch == '(' {
                    regex_paren_depth += 1;
                    current.push(ch);
                } else if regex_paren_depth > 0 {
                    regex_paren_depth -= 1;
                    current.push(ch);
                } else {
                    flush_current_word(
                        &mut current,
                        &mut tokens,
                        &mut in_double_bracket,
                        &mut after_regex_op,
                        &mut after_pat_op,
                        &mut regex_paren_depth,
                        &mut regex_bracket,
                        &mut regex_bracket_first,
                        &mut regex_bracket_negation,
                        &mut regex_class,
                        &mut db_group_depth,
                    )?;
                    db_group_depth = db_group_depth.saturating_sub(1);
                    tokens.push(Token::Word(")".to_string()));
                }
                i += 1;
            }
            '(' | ')' if in_double_bracket && after_pat_op && (regex_paren_depth > 0 || (ch == '(' && current.ends_with(['?', '*', '+', '@', '!']))) => {
                if ch == '(' {
                    regex_paren_depth += 1;
                } else {
                    regex_paren_depth = regex_paren_depth.saturating_sub(1);
                }
                current.push(ch);
                i += 1;
            }
            '(' | ')' if in_double_bracket => {
                flush_current_word(
                    &mut current,
                    &mut tokens,
                    &mut in_double_bracket,
                    &mut after_regex_op,
                    &mut after_pat_op,
                    &mut regex_paren_depth,
                    &mut regex_bracket,
                    &mut regex_bracket_first,
                    &mut regex_bracket_negation,
                    &mut regex_class,
                    &mut db_group_depth,
                )?;
                if ch == '(' {
                    db_group_depth += 1;
                } else {
                    db_group_depth = db_group_depth.saturating_sub(1);
                }
                tokens.push(Token::Word(ch.to_string()));
                i += 1;
            }
            '(' => {
                let is_extglob_prefix = ends_with_unescaped_extglob_op(&current);
                if is_extglob_prefix && !extglob {
                    return Err("Syntax error: unexpected `(`".to_string());
                }
                if current.ends_with('=') || (is_extglob_prefix && extglob) {
                    current.push('(');
                    i += 1;
                    let mut depth = 1usize;
                    while i < chars.len() && depth > 0 {
                        let c = chars[i];
                        if c == '\\' && i + 1 < chars.len() {
                            current.push(c);
                            current.push(chars[i + 1]);
                            i += 2;
                            continue;
                        } else if c == '\'' {
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
                        } else if c == '[' {
                            current.push(c);
                            i += 1;
                            if i < chars.len() && matches!(chars[i], '!' | '^') {
                                current.push(chars[i]);
                                i += 1;
                            }
                            if i < chars.len() && chars[i] == ']' {
                                current.push(chars[i]);
                                i += 1;
                            }
                            while i < chars.len() && chars[i] != ']' {
                                if chars[i] == '\\' && i + 1 < chars.len() {
                                    current.push(chars[i]);
                                    current.push(chars[i + 1]);
                                    i += 2;
                                    continue;
                                }
                                if chars[i] == '[' && chars.get(i + 1) == Some(&':') {
                                    current.push('[');
                                    current.push(':');
                                    i += 2;
                                    while i + 1 < chars.len()
                                        && !(chars[i] == ':' && chars[i + 1] == ']')
                                    {
                                        current.push(chars[i]);
                                        i += 1;
                                    }
                                    if i + 1 < chars.len() {
                                        current.push(':');
                                        current.push(']');
                                        i += 2;
                                    }
                                    continue;
                                }
                                current.push(chars[i]);
                                i += 1;
                            }
                            if i < chars.len() && chars[i] == ']' {
                                current.push(']');
                                i += 1;
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
                        let is_for_arith = tokens
                            .iter()
                            .rev()
                            .find(|t| !matches!(t, Token::Newline))
                            .is_some_and(|t| matches!(t, Token::Word(w) if w == "for"));
                        if is_for_arith {
                            read_arith_command_tokens(&chars, &mut i, &mut tokens)?;
                        } else if let Some((expr_end, after_close)) =
                            find_arithmetic_end(&chars, i + 2, true)?
                        {
                            let expr: String = chars[i + 2..expr_end].iter().collect();
                            tokens.push(Token::LParen);
                            tokens.push(Token::LParen);
                            tokens.push(Token::Word(format!("\x00__ARITH_EXPR__{expr}")));
                            tokens.push(Token::RParen);
                            tokens.push(Token::RParen);
                            i = after_close;
                        } else {
                            tokens.push(Token::LParen);
                            i += 1;
                        }
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
            '|' if in_double_bracket
                && (after_regex_op || after_pat_op)
                && (regex_paren_depth > 0 || !(i + 1 < chars.len() && chars[i + 1] == '|')) =>
            {
                current.push('|');
                i += 1;
            }
            '|' => {
                flush_current_word(
                    &mut current,
                    &mut tokens,
                    &mut in_double_bracket,
                    &mut after_regex_op,
                    &mut after_pat_op,
                    &mut regex_paren_depth,
                    &mut regex_bracket,
                    &mut regex_bracket_first,
                    &mut regex_bracket_negation,
                    &mut regex_class,
                    &mut db_group_depth,
                )?;
                if i + 1 < chars.len() && chars[i + 1] == '|' {
                    i += 2;
                    if in_double_bracket {
                        tokens.push(Token::Word("||".to_string()));
                    } else {
                        tokens.push(Token::OrIf);
                    }
                } else if i + 1 < chars.len() && chars[i + 1] == '&' {
                    i += 2;
                    tokens.push(Token::RedirectDupOut(2, true));
                    tokens.push(Token::Word("1".to_string()));
                    tokens.push(Token::Pipe);
                } else {
                    i += 1;
                    tokens.push(Token::Pipe);
                }
            }
            '&' if in_double_bracket
                && (after_regex_op || after_pat_op)
                && (regex_paren_depth > 0 || !(i + 1 < chars.len() && chars[i + 1] == '&')) =>
            {
                current.push('&');
                i += 1;
            }
            '&' => {
                flush_current_word(
                    &mut current,
                    &mut tokens,
                    &mut in_double_bracket,
                    &mut after_regex_op,
                    &mut after_pat_op,
                    &mut regex_paren_depth,
                    &mut regex_bracket,
                    &mut regex_bracket_first,
                    &mut regex_bracket_negation,
                    &mut regex_class,
                    &mut db_group_depth,
                )?;
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
            '>' | '<' if i + 1 < chars.len() && chars[i + 1] == '(' => {
                current.push(ch);
                i += 1;
                read_paren_sub_body(&chars, &mut i, &mut current, "process substitution", extglob)?;
            }
            '>' | '<' if in_double_bracket => {
                flush_current_word(
                    &mut current,
                    &mut tokens,
                    &mut in_double_bracket,
                    &mut after_regex_op,
                    &mut after_pat_op,
                    &mut regex_paren_depth,
                    &mut regex_bracket,
                    &mut regex_bracket_first,
                    &mut regex_bracket_negation,
                    &mut regex_class,
                    &mut db_group_depth,
                )?;
                tokens.push(Token::Word(ch.to_string()));
                i += 1;
            }
            '>' => {
                let (fd, explicit_fd) = if !current.is_empty() && current.chars().all(|c| c.is_ascii_digit()) {
                    let parsed = current.parse::<u32>().unwrap_or(1);
                    current.clear();
                    (parsed, true)
                } else {
                    if !current.is_empty() {
                        tokens.push(Token::Word(std::mem::take(&mut current)));
                    }
                    (1, false)
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
                    tokens.push(Token::RedirectDupOut(fd, explicit_fd));
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
                        let delim_offset = i;
                        let raw_delim = read_heredoc_raw_delim(&chars, &mut i)?;
                        if raw_delim.is_empty() {
                            return Err("Syntax error: expected here-document delimiter".to_string());
                        }
                        let (clean_delim, quoted) = unquote_heredoc_delimiter(&raw_delim);
                        let tok_idx = tokens.len();
                        tokens.push(Token::RedirectHereDoc {
                            fd,
                            delimiter: clean_delim.clone(),
                            quoted,
                            body: String::new(),
                            eof_warning: None,
                        });
                        pending_heredocs.push((
                            tok_idx,
                            fd,
                            clean_delim,
                            quoted,
                            strip_tabs,
                            delim_offset,
                        ));
                    }
                } else if i < chars.len() && chars[i] == '&' {
                    i += 1;
                    tokens.push(Token::RedirectDupIn(fd));
                } else if i < chars.len() && chars[i] == '>' {
                    i += 1;
                    tokens.push(Token::RedirectReadWrite(fd));
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

    if !current.is_empty() || (in_double_bracket && after_regex_op && regex_paren_depth > 0) {
        flush_current_word(
            &mut current,
            &mut tokens,
            &mut in_double_bracket,
            &mut after_regex_op,
            &mut after_pat_op,
            &mut regex_paren_depth,
            &mut regex_bracket,
            &mut regex_bracket_first,
            &mut regex_bracket_negation,
            &mut regex_class,
            &mut db_group_depth,
        )?;
    }

    if !pending_heredocs.is_empty() {
        for (tok_idx, fd, delim, quoted, _strip_tabs, delim_offset) in pending_heredocs {
            tokens[tok_idx] = Token::RedirectHereDoc {
                fd,
                delimiter: delim.clone(),
                quoted,
                body: String::new(),
                eof_warning: Some(format!(
                    "here-document at offset {delim_offset} delimited by end-of-file (wanted {delim:?})"
                )),
            };
        }
    }

    tokens.push(Token::Newline);
    Ok(tokens)
}

fn read_dollar_paren(
    chars: &[char],
    i: &mut usize,
    out: &mut String,
    extglob: bool,
) -> Result<(), String> {
    out.push('$');
    *i += 1;
    if *i + 1 < chars.len() && chars[*i] == '(' && chars[*i + 1] == '(' {
        if let Some((expr_end, after_close)) = find_arithmetic_end(chars, *i + 2, true)? {
            out.push_str("((");
            for &c in &chars[*i + 2..expr_end] {
                out.push(c);
            }
            out.push_str("))");
            *i = after_close;
            return Ok(());
        }
    }
    read_paren_sub_body(chars, i, out, "command substitution", extglob)
}

fn read_paren_sub_body(
    chars: &[char],
    i: &mut usize,
    out: &mut String,
    construct_name: &str,
    extglob: bool,
) -> Result<(), String> {
    out.push('(');
    let body_start = out.len();
    *i += 1;

    let mut depth = 1usize;
    let mut in_sq = false;
    let mut in_dq = false;
    let mut sub_heredocs: Vec<(String, bool, bool)> = Vec::new();
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
                read_dollar_paren(chars, i, out, extglob)?;
            } else if c == '$' && *i + 1 < chars.len() && chars[*i + 1] == '{' {
                read_dollar_brace(chars, i, out, extglob)?;
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
                read_dollar_paren(chars, i, out, extglob)?;
            } else if c == '$' && *i + 1 < chars.len() && chars[*i + 1] == '{' {
                read_dollar_brace(chars, i, out, extglob)?;
            } else if c == '<' && *i + 1 < chars.len() && chars[*i + 1] == '<' {
                if chars.get(*i + 2) == Some(&'<') {
                    out.push_str("<<<");
                    *i += 3;
                } else {
                    out.push_str("<<");
                    *i += 2;
                    let strip_tabs = if *i < chars.len() && chars[*i] == '-' {
                        out.push('-');
                        *i += 1;
                        true
                    } else {
                        false
                    };
                    while *i < chars.len() && matches!(chars[*i], ' ' | '\t') {
                        out.push(chars[*i]);
                        *i += 1;
                    }
                    let raw_delim = read_heredoc_raw_delim(chars, i)?;
                    if raw_delim.is_empty() {
                        return Err("Syntax error: expected here-document delimiter".to_string());
                    }
                    out.push_str(&raw_delim);
                    let (clean_delim, quoted) = unquote_heredoc_delimiter(&raw_delim);
                    sub_heredocs.push((clean_delim, quoted, strip_tabs));
                }
            } else if c == '\n' {
                out.push('\n');
                *i += 1;
                if !sub_heredocs.is_empty() {
                    let drains = std::mem::take(&mut sub_heredocs);
                    for (delim, quoted, strip_tabs) in drains {
                        let mut found = false;
                        while *i < chars.len() {
                            let mut line = String::new();
                            while *i < chars.len() {
                                let cur_c = chars[*i];
                                out.push(cur_c);
                                *i += 1;
                                if !quoted && cur_c == '\\' && *i < chars.len() {
                                    let next_c = chars[*i];
                                    out.push(next_c);
                                    *i += 1;
                                    if next_c != '\n' {
                                        line.push(cur_c);
                                        line.push(next_c);
                                    }
                                } else if cur_c == '\n' {
                                    break;
                                } else {
                                    line.push(cur_c);
                                }
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
                        }
                        if !found {
                            return Err(format!("Syntax error: unclosed {construct_name}"));
                        }
                    }
                }
            } else if c == '(' {
                out.push(c);
                *i += 1;
                depth += 1;
            } else if c == ')' {
                if depth == 1 && !sub_heredocs.is_empty() {
                    return Err(format!(
                        "Syntax error: Here-document requires a newline before closing {construct_name}"
                    ));
                }
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
        return Err(format!("Syntax error: unclosed {construct_name}"));
    }
    let inner_body = &out[body_start..out.len() - 1];
    if let Err(err) = crate::shell::parser::parse_script_with_extglob(inner_body, extglob) {
        let clean = err.strip_prefix("__exit127__").unwrap_or(&err);
        if clean.contains("unexpected end of file") {
            return Err("__exit127__Syntax error: unexpected `)`".to_string());
        }
        return Err(format!("__exit127__{clean}"));
    }
    Ok(())
}

fn read_dollar_brace(
    chars: &[char],
    i: &mut usize,
    out: &mut String,
    extglob: bool,
) -> Result<(), String> {
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
                read_dollar_paren(chars, i, out, extglob)?;
            } else if c == '$' && *i + 1 < chars.len() && chars[*i + 1] == '{' {
                read_dollar_brace(chars, i, out, extglob)?;
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
                read_dollar_paren(chars, i, out, extglob)?;
            } else if c == '$' && *i + 1 < chars.len() && chars[*i + 1] == '{' {
                read_dollar_brace(chars, i, out, extglob)?;
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
    let mut saw_semi = false;
    let mut buf = String::new();
    while *i < chars.len() {
        if chars[*i] == ')' && *i + 1 < chars.len() && chars[*i + 1] == ')' && depth == 1 {
            if !buf.trim().is_empty() {
                let word = if saw_semi {
                    buf.trim().to_string()
                } else {
                    buf
                };
                tokens.push(Token::Word(word));
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
            saw_semi = true;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_tokenize_heredoc_redirections_and_operators() {
        let script = "cat <<'EOF' | grep foo >> out.txt 2>&1\nhello $WORLD\nfoo bar\nEOF\n";
        let tokens = tokenize_shell(script).unwrap();
        assert!(tokens.iter().any(|t| matches!(
            t,
            Token::RedirectHereDoc {
                fd: 0,
                delimiter,
                quoted: true,
                body,
                ..
            } if delimiter == "EOF" && body == "hello $WORLD\nfoo bar\n"
        )));
        assert!(tokens.contains(&Token::Pipe));
        assert!(tokens.contains(&Token::RedirectAppend(1)));
        assert!(tokens.contains(&Token::RedirectDupOut(2, true)));
    }

    #[test]
    fn unit_tokenize_here_string_arithmetic_for_and_fd_redirections() {
        let tokens = tokenize_shell("for ((i=0; i<3; i++)); do cat <<< \"val=$i\" 3>&2 2>/dev/null; done").unwrap();
        assert!(tokens.iter().any(|t| matches!(t, Token::RedirectHereString(0))));
        assert!(tokens.contains(&Token::RedirectDupOut(3, true)));
        assert!(tokens.contains(&Token::RedirectOut(2)));
        assert!(tokens.contains(&Token::LParen));
        assert!(tokens.contains(&Token::RParen));
    }

    #[test]
    fn unit_tokenize_heredoc_tab_strip_and_compound_operators() {
        let script = "cat <<-EOF && echo ok || echo fail\n\tindented\n\t\tdeep\n\tEOF\n";
        let tokens = tokenize_shell(script).unwrap();
        assert!(tokens.iter().any(|t| matches!(
            t,
            Token::RedirectHereDoc {
                fd: 0,
                delimiter,
                quoted: false,
                body,
                ..
            } if delimiter == "EOF" && body == "indented\ndeep\n"
        )));
        assert!(tokens.contains(&Token::AndIf));
        assert!(tokens.contains(&Token::OrIf));
    }

    #[test]
    fn unit_tokenize_quoted_heredoc_and_background_semicolon_operators() {
        let script = "cat <<'RAW'\n$NO_EXPAND\nRAW\necho bg &\n";
        let tokens = tokenize_shell(script).unwrap();
        assert!(tokens.iter().any(|t| matches!(
            t,
            Token::RedirectHereDoc {
                fd: 0,
                delimiter,
                quoted: true,
                body,
                ..
            } if delimiter == "RAW" && body == "$NO_EXPAND\n"
        )));
        assert!(tokens.contains(&Token::Background));
    }
}
