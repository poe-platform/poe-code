use super::{AwkCond, AwkFuncMap, AwkRule, awk_decimal_len, split_awk_statements, split_awk_top_args};

// Read the complete source before handing any actions to the evaluator. Only
// structural braces and separators outside literals delimit rules.
pub(super) fn parse_rules(source: &str) -> Result<(Vec<AwkRule>, AwkFuncMap), String> {
    let (mut rules, mut funcs) = (Vec::new(), AwkFuncMap::new());
    let mut head = String::new();
    let mut part = String::new();
    let mut braces = 0usize;
    let mut operand = false;
    let mut control = false;
    let mut parens = Vec::new();
    let bytes = source.as_bytes();
    let mut at = 0;
    while at < bytes.len() {
        let start = at;
        let c = bytes[at];
        at += 1;
        match c {
            b' ' | b'\t' | b'\r' => {},
            b'#' => {
                at += bytes[at..].iter().position(|&b| b == b'\n').unwrap_or(bytes.len() - at);
                continue;
            }
            b'\\' if bytes.get(at) == Some(&b'\n') => {
                at += 1;
                part.push(' ');
                continue;
            }
            b'"' | b'/' if c == b'"' || !operand => {
                let string = c == b'"';
                let mut bracket = false;
                let mut from = start;
                loop {
                    let Some(&b) = bytes.get(at) else {
                        return Err(if string { "unterminated string literal" } else { "unterminated regular expression literal" }.into());
                    };
                    at += 1;
                    if b == b'\\' {
                        if let Some(&next) = bytes.get(at) {
                            at += 1;
                            if string && next == b'\n' {
                                part.push_str(&source[from..at-2]); from = at;
                            }
                        }
                    } else if b == c && !bracket { break; }
                    else if b == b'\n' {
                        return Err(if string { "newline in string literal" } else { "newline in regular expression literal" }.into());
                    } else if !string {
                        match b {
                            b'[' => bracket = true,
                            b']' => bracket = false,
                            // The evaluator also scans slash-delimited expressions.
                            // Quote a class slash so it can't be mistaken for the end.
                            b'/' => { part.push_str(&source[from..at-1]); part.push('\\'); from = at-1; },
                            _ => {},
                        }
                    }
                }
                part.push_str(&source[from..at]);
                operand = true;
                control = false;
                continue;
            }
            b'a'..=b'z' | b'A'..=b'Z' | b'_' => {
                while bytes.get(at).is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_') { at += 1; }
                let word = &source[start..at];
                control = matches!(word, "if" | "for" | "while");
                operand = !control && !matches!(word, "print" | "printf" | "return" | "exit" | "in" | "else" | "do");
            }
            b'0'..=b'9' | b'.' if c != b'.' || bytes.get(at).is_some_and(u8::is_ascii_digit) => {
                at = start + awk_decimal_len(&bytes[start..]);
                if !source[start..at].parse::<f64>().is_ok_and(f64::is_finite) {
                    return Err("non-finite numeric literal".into());
                }
                operand = true; control = false;
            }
            b'(' => { parens.push(control); control = false; operand = false; }
            b')' => { operand = !parens.pop().unwrap_or(false); control = false; }
            b']' => { operand = true; control = false; }
            b'+' | b'-' if bytes.get(at) == Some(&c) => { at += 1; control = false; }
            b'{' => {
                braces += 1; operand = false; control = false;
                if braces == 1 { std::mem::swap(&mut head, &mut part); continue; }
            }
            b'}' => {
                if braces == 0 { return Err(format!("unsupported expression '}}' at byte {}", crate::vfs::stream_byte_len(&source[..start]))); }
                braces -= 1; operand = false; control = false;
                if braces == 0 {
                    add_rule(head.trim(), &part, &mut rules, &mut funcs);
                    head.clear(); part.clear(); continue;
                }
            }
            b'\n' | b';' => {
                operand = false; control = false;
                if braces == 0 {
                    let rule = part.trim();
                    if c == b'\n' && (matches!(rule, "BEGIN" | "END") || rule.strip_prefix("function").is_some_and(|s| s.starts_with(char::is_whitespace))) {
                        part.push(' '); continue;
                    }
                    if !rule.is_empty() { add_rule(rule, "print", &mut rules, &mut funcs); }
                    part.clear(); continue;
                }
            }
            b'&' if bytes.get(at) == Some(&b'&') => { at += 1; operand = false; control = false; }
            b'[' | b',' | b'$' | b'+' | b'-' | b'*' | b'/' | b'%' | b'^' | b'=' | b'!' | b'<' | b'>' | b'~' | b'?' | b':' | b'|' => {
                operand = false; control = false;
            }
            _ => {
                let offset = crate::vfs::stream_byte_len(&source[..start]);
                let byte = crate::vfs::stream_string_to_bytes(&source[start..]).first().copied().unwrap_or(c);
                return Err(format!("unsupported token '{}' at byte {offset}", char::from(byte)));
            }
        }
        part.push_str(&source[start..at]);
    }
    if braces != 0 {
        if !part.trim_end_matches([' ', '\t', '\r']).ends_with([';', '\n', '{', '}']) && !part.trim().is_empty() {
            return Err(format!("expected statement separator at byte {}", crate::vfs::stream_byte_len(source)));
        }
        return Err("unterminated action block".into());
    }
    let rule = part.trim();
    if matches!(rule, "BEGIN" | "END") { return Err(format!("expected '{{' at byte {}", crate::vfs::stream_byte_len(source))); }
    if !rule.is_empty() { add_rule(rule, "print", &mut rules, &mut funcs); }
    Ok((rules, funcs))
}

fn add_rule(head: &str, body: &str, rules: &mut Vec<AwkRule>, funcs: &mut AwkFuncMap) {
    if let Some(fn_sig) = head.strip_prefix("function").filter(|s| s.starts_with(char::is_whitespace)) {
        let fn_sig = fn_sig.trim();
        if let Some(open) = fn_sig.find('(')
            && let Some(close) = fn_sig.rfind(')')
        {
            let fn_name = fn_sig[..open].trim().to_string();
            let params: Vec<String> = fn_sig[open + 1..close]
                .split(',')
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty())
                .collect();
            funcs.insert(fn_name, (params, body.to_string()));
            return;
        }
    }

    let cond = match head {
        "" => AwkCond::Constant(true),
        "BEGIN" => AwkCond::Begin,
        "END" => AwkCond::End,
        other => {
            if other.trim_start_matches(['+', '-']).starts_with(|c: char| c.is_ascii_digit() || c == '.')
                && let Ok(n) = other.parse::<f64>() && n.is_finite() {
                AwkCond::Constant(n != 0.0)
            } else {
                let parts = split_awk_top_args(other);
                if parts.len() == 2 { AwkCond::Range(parts[0].clone(), parts[1].clone()) }
                else { AwkCond::Expr(other.to_string()) }
            }
        }
    };
    rules.push(AwkRule {
        cond,
        body: split_awk_statements(body),
        in_range: false,
    });
}
