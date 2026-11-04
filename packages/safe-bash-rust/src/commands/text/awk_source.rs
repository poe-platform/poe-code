use super::{AwkCond, AwkFuncMap, AwkRule, awk_decimal_len, split_awk_statements, split_awk_top_args};

fn builtin(name: &str, ordchr: bool) -> Option<(usize, usize)> {
    Some(match name {
        "length" | "srand" | "fflush" => (0, 1),
        "rand" | "systime" => (0, 0),
        "strftime" => (0, 3),
        "substr" | "match" | "sub" | "gsub" => (2, 3),
        "split" => (2, 4),
        "gensub" => (3, 4),
        "index" | "atan2" | "lshift" | "rshift" => (2, 2),
        "mktime" | "asort" | "asorti" => (1, 2),
        "sprintf" => (1, usize::MAX),
        "and" | "or" | "xor" => (2, usize::MAX),
        "int" | "sqrt" | "exp" | "log" | "sin" | "cos" | "close" | "strtonum" |
        "tolower" | "toupper" | "compl" => (1, 1),
        "chr" | "ord" if ordchr => (1, 1),
        _ => return None,
    })
}

fn keyword(name: &str) -> bool {
    matches!(name, "BEGIN" | "END" | "function" | "if" | "else" | "while" | "do" |
        "for" | "break" | "continue" | "next" | "nextfile" | "return" | "exit" |
        "delete" | "print" | "printf" | "getline" | "in")
}

fn skip_space(bytes: &[u8], mut pos: usize) -> usize {
    loop {
        match bytes.get(pos) {
            Some(b' ' | b'\t' | b'\r') => pos += 1,
            Some(b'\\') if bytes.get(pos + 1) == Some(&b'\n') => pos += 2,
            Some(b'#') => return pos + bytes[pos..].iter().position(|&b| b == b'\n').unwrap_or(bytes.len() - pos),
            _ => return pos,
        }
    }
}

fn name_at<'a>(source: &'a str, at: &mut usize) -> Result<&'a str, String> {
    let start = skip_space(source.as_bytes(), *at);
    *at = start;
    if source.as_bytes().get(start).is_some_and(|b| b.is_ascii_alphabetic() || *b == b'_') {
        while source.as_bytes().get(*at).is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_') { *at += 1; }
        let name = &source[start..*at];
        if !keyword(name) { return Ok(name); }
    }
    Err(format!("expected an identifier at byte {}", crate::vfs::stream_byte_len(&source[..start])))
}

struct Group<'a> {
    close: u8,
    control: bool,
    awaiting_close: bool,
    call: Option<&'a str>,
    commas: usize,
    has_arg: bool,
}

impl Group<'_> {
    fn error(&self, source: &str, at: usize) -> String {
        let offset = crate::vfs::stream_byte_len(&source[..at]);
        if self.has_arg {
            format!("expected '{}' at byte {offset}", char::from(self.close))
        } else {
            let token = source[at..].chars().next().map(String::from).unwrap_or_default();
            format!("unsupported expression '{token}' at byte {offset}")
        }
    }
}

// Read the complete source before handing any actions to the evaluator. Only
// structural braces and separators outside literals delimit rules.
pub(super) fn parse_rules(source: &str, ordchr: bool) -> Result<(Vec<AwkRule>, AwkFuncMap), String> {
    let (mut rules, mut funcs) = (Vec::new(), AwkFuncMap::new());
    let mut head = String::new();
    let mut part = String::new();
    let mut braces = 0usize;
    let mut operand = false;
    let mut control = false;
    let mut groups: Vec<Group<'_>> = Vec::new();
    let mut calls = Vec::new();
    let mut next_call = None;
    let mut definition = None;
    let bytes = source.as_bytes();
    let mut at = 0;
    while at < bytes.len() {
        let start = at;
        let c = bytes[at];
        at += 1;
        if definition.is_some() && braces == 0 && !matches!(c, b'{' | b' ' | b'\t' | b'\r' | b'\n' | b'#')
            && !(c == b'\\' && bytes.get(at) == Some(&b'\n')) {
            return Err(format!("expected '{{' at byte {}", crate::vfs::stream_byte_len(&source[..start])));
        }
        if let Some(group) = groups.last_mut() {
            match c {
                b' ' | b'\t' | b'\r' | b'#' | b'\\' => {},
                b'\n' => {
                    if group.call.is_some() && operand { group.awaiting_close = true; }
                }
                _ if group.awaiting_close && c != group.close => return Err(group.error(source, start)),
                b',' if !group.has_arg => return Err(group.error(source, start)),
                b',' => { group.commas += 1; group.has_arg = false; }
                b')' | b']' if c != group.close || !(group.has_arg || group.call.is_some() && group.commas == 0) => {
                    return Err(group.error(source, start));
                }
                b')' | b']' => {},
                b'}' | b';' if !group.control => return Err(group.error(source, start)),
                _ => group.has_arg = true,
            }
        }
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
                if word == "function" && braces == 0 && part.trim().is_empty() {
                    let name = name_at(source, &mut at)?;
                    if funcs.contains_key(name) || builtin(name, ordchr).is_some() {
                        return Err(format!("duplicate or reserved function '{name}'"));
                    }
                    at = skip_space(bytes, at);
                    if bytes.get(at) != Some(&b'(') {
                        return Err(format!("expected '(' at byte {}", crate::vfs::stream_byte_len(&source[..at])));
                    }
                    at = skip_space(bytes, at + 1);
                    let mut params = Vec::new();
                    if bytes.get(at) != Some(&b')') {
                        loop {
                            params.push(name_at(source, &mut at)?.to_owned());
                            at = skip_space(bytes, at);
                            if bytes.get(at) != Some(&b',') { break; }
                            at += 1;
                        }
                    }
                    if bytes.get(at) != Some(&b')') {
                        return Err(format!("expected ')' at byte {}", crate::vfs::stream_byte_len(&source[..at])));
                    }
                    if params.iter().collect::<std::collections::BTreeSet<_>>().len() != params.len() {
                        return Err("duplicate function parameter".into());
                    }
                    if params.iter().any(|p| builtin(p, ordchr).is_some()) {
                        return Err("reserved function parameter".into());
                    }
                    at += 1;
                    definition = Some((name, params));
                    continue;
                }
                if !keyword(word) {
                    let builtin = builtin(word, ordchr).is_some();
                    let next = if builtin { skip_space(bytes, at) } else { at };
                    if bytes.get(next) == Some(&b'(') {
                        next_call = Some(word);
                        part.push_str(word);
                        at = next;
                        control = false; operand = true;
                        continue;
                    } else if builtin && word != "length" {
                        return Err(format!("reserved variable '{word}'"));
                    } else if word == "length" && bytes.get(next) != Some(&b'[') {
                        part.push_str("length()");
                        control = false; operand = true;
                        continue;
                    }
                }
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
            b'(' | b'[' => {
                groups.push(Group { close: if c == b'(' { b')' } else { b']' }, control, awaiting_close: false, call: next_call.take(), commas: 0, has_arg: false });
                control = false; operand = false;
            }
            b',' => {
                control = false; operand = false;
            }
            b')' | b']' => {
                let group = groups.pop();
                operand = !group.as_ref().is_some_and(|g| g.control);
                if let Some(group) = group && let Some(name) = group.call {
                    calls.push((name, group.commas + usize::from(group.has_arg)));
                }
                control = false;
            }
            b'+' | b'-' if bytes.get(at) == Some(&c) => { at += 1; control = false; }
            b'{' => {
                braces += 1; operand = false; control = false;
                if braces == 1 { std::mem::swap(&mut head, &mut part); continue; }
            }
            b'}' => {
                if braces == 0 { return Err(format!("unsupported expression '}}' at byte {}", crate::vfs::stream_byte_len(&source[..start]))); }
                braces -= 1; operand = false; control = false;
                if braces == 0 {
                    if let Some((name, params)) = definition.take() {
                        funcs.insert(name.to_owned(), (params, std::mem::take(&mut part)));
                    } else {
                        add_rule(head.trim(), &part, &mut rules);
                    }
                    head.clear(); part.clear(); continue;
                }
            }
            b'\n' | b';' => {
                operand = false; control = false;
                if braces == 0 && groups.is_empty() {
                    let rule = part.trim();
                    if c == b'\n' && (matches!(rule, "BEGIN" | "END") || definition.is_some()) {
                        part.push(' '); continue;
                    }
                    if !rule.is_empty() { add_rule(rule, "print", &mut rules); }
                    part.clear(); continue;
                }
            }
            b'&' if bytes.get(at) == Some(&b'&') => { at += 1; operand = false; control = false; }
            b'$' | b'+' | b'-' | b'*' | b'/' | b'%' | b'^' | b'=' | b'!' | b'<' | b'>' | b'~' | b'?' | b':' | b'|' => {
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
    if let Some(group) = groups.last() { return Err(group.error(source, source.len())); }
    if braces != 0 {
        if !part.trim_end_matches([' ', '\t', '\r']).ends_with([';', '\n', '{', '}']) && !part.trim().is_empty() {
            return Err(format!("expected statement separator at byte {}", crate::vfs::stream_byte_len(source)));
        }
        return Err("unterminated action block".into());
    }
    let rule = part.trim();
    if matches!(rule, "BEGIN" | "END") { return Err(format!("expected '{{' at byte {}", crate::vfs::stream_byte_len(source))); }
    if !rule.is_empty() { add_rule(rule, "print", &mut rules); }
    if definition.is_some() { return Err(format!("expected '{{' at byte {}", crate::vfs::stream_byte_len(source))); }
    for (name, count) in calls {
        let (min, max) = builtin(name, ordchr).or_else(|| funcs.get(name).map(|(params, _)| (0, params.len())))
            .ok_or_else(|| format!("unsupported function '{name}'"))?;
        if !(min..=max).contains(&count) { return Err(format!("invalid argument count for '{name}'")); }
    }
    Ok((rules, funcs))
}

fn add_rule(head: &str, body: &str, rules: &mut Vec<AwkRule>) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_missing_call_arguments_and_delimiters_at_the_offending_byte() {
        for (source, error) in [
            ("BEGIN{f(,1)}", "unsupported expression ',' at byte 8"),
            ("BEGIN{f(1,,2)}", "unsupported expression ',' at byte 10"),
            ("BEGIN{f(1,)}", "unsupported expression ')' at byte 10"),
            ("BEGIN{f(1", "expected ')' at byte 9"),
            ("BEGIN{f(1,", "unsupported expression '' at byte 10"),
            ("BEGIN{f(}", "unsupported expression '}' at byte 8"),
            ("BEGIN{f(1]}", "expected ')' at byte 9"),
            ("BEGIN{f(1;2)}", "expected ')' at byte 9"),
            ("BEGIN{f(1\n,2)}", "expected ')' at byte 10"),
            ("BEGIN{x ()}", "unsupported expression ')' at byte 9"),
            ("BEGIN{a[]}", "unsupported expression ']' at byte 8"),
        ] {
            assert_eq!(parse_rules(source, false).err().as_deref(), Some(error), "{source}");
        }
        for source in [
            "function f(a,b){} BEGIN{f(\n# comment\n)}",
            "function f(a,b){} BEGIN{f(1 +\n 2,\n a[1,2]\n)}",
            "BEGIN{for(;;)break}",
        ] {
            assert_eq!(parse_rules(source, false).err(), None, "{source}");
        }
    }
}
