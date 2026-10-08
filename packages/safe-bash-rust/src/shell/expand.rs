use crate::vfs::{SafeBashFs, resolve_posix_path};
use std::collections::BTreeMap;

pub fn glob_match(pattern: &str, text: &str) -> bool {
    glob_match_ext(pattern, text, false)
}

pub fn glob_match_ext(pattern: &str, text: &str, nocase: bool) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    glob_match_slice(&p, &t, nocase)
}

fn chars_eq(a: char, b: char, nocase: bool) -> bool {
    if nocase {
        a.to_ascii_lowercase() == b.to_ascii_lowercase()
    } else {
        a == b
    }
}

fn find_extglob_close(p: &[char], open_paren_idx: usize) -> Option<usize> {
    let mut depth = 0i32;
    let mut i = open_paren_idx;
    while i < p.len() {
        if p[i] == '\\' && i + 1 < p.len() {
            i += 2;
            continue;
        }
        if p[i] == '(' {
            depth += 1;
        } else if p[i] == ')' {
            depth -= 1;
            if depth == 0 {
                return Some(i);
            }
        }
        i += 1;
    }
    None
}

fn split_extglob_alts(slice: &[char]) -> Vec<Vec<char>> {
    let mut alts = Vec::new();
    let mut cur = Vec::new();
    let mut depth = 0i32;
    let mut i = 0usize;
    while i < slice.len() {
        let c = slice[i];
        if c == '\\' && i + 1 < slice.len() {
            cur.push(c);
            cur.push(slice[i + 1]);
            i += 2;
            continue;
        }
        if c == '(' {
            depth += 1;
        } else if c == ')' {
            depth -= 1;
        } else if c == '|' && depth == 0 {
            alts.push(std::mem::take(&mut cur));
            i += 1;
            continue;
        }
        cur.push(c);
        i += 1;
    }
    alts.push(cur);
    alts
}

fn match_extglob_plus(alts: &[Vec<char>], rest_p: &[char], t: &[char], nocase: bool) -> bool {
    for split in 1..=t.len() {
        let prefix = &t[..split];
        if alts.iter().any(|alt| glob_match_slice(alt, prefix, nocase)) {
            if glob_match_slice(rest_p, &t[split..], nocase)
                || match_extglob_plus(alts, rest_p, &t[split..], nocase)
            {
                return true;
            }
        }
    }
    false
}

fn glob_match_slice(p: &[char], t: &[char], nocase: bool) -> bool {
    let mut pi = 0usize;
    let mut ti = 0usize;
    let mut star_pi: Option<usize> = None;
    let mut star_ti = 0usize;

    while ti < t.len() || pi < p.len() {
        if pi + 1 < p.len()
            && matches!(p[pi], '?' | '*' | '+' | '@' | '!')
            && p[pi + 1] == '('
            && let Some(close_idx) = find_extglob_close(p, pi + 1)
        {
            let op = p[pi];
            let alts = split_extglob_alts(&p[pi + 2..close_idx]);
            let rest_p = &p[close_idx + 1..];
            let rem_t = &t[ti..];
            let matched = match op {
                '@' => (0..=rem_t.len()).any(|k| {
                    alts.iter().any(|a| glob_match_slice(a, &rem_t[..k], nocase))
                        && glob_match_slice(rest_p, &rem_t[k..], nocase)
                }),
                '?' => {
                    glob_match_slice(rest_p, rem_t, nocase)
                        || (0..=rem_t.len()).any(|k| {
                            alts.iter().any(|a| glob_match_slice(a, &rem_t[..k], nocase))
                                && glob_match_slice(rest_p, &rem_t[k..], nocase)
                        })
                }
                '+' => match_extglob_plus(&alts, rest_p, rem_t, nocase),
                '*' => {
                    glob_match_slice(rest_p, rem_t, nocase)
                        || match_extglob_plus(&alts, rest_p, rem_t, nocase)
                }
                '!' => (0..=rem_t.len()).any(|k| {
                    !alts.iter().any(|a| glob_match_slice(a, &rem_t[..k], nocase))
                        && glob_match_slice(rest_p, &rem_t[k..], nocase)
                }),
                _ => false,
            };
            if matched {
                return true;
            }
            if let Some(sp) = star_pi {
                if star_ti < t.len() {
                    pi = sp + 1;
                    star_ti += 1;
                    ti = star_ti;
                    continue;
                }
            }
            return false;
        }

        if pi < p.len() && p[pi] == '*' {
            star_pi = Some(pi);
            star_ti = ti;
            pi += 1;
            continue;
        }

        if ti < t.len() {
            if pi < p.len() && p[pi] == '\\' && pi + 1 < p.len() {
                if chars_eq(p[pi + 1], t[ti], nocase) {
                    pi += 2;
                    ti += 1;
                    continue;
                }
            } else if pi < p.len() && (p[pi] == '?' || chars_eq(p[pi], t[ti], nocase)) {
                pi += 1;
                ti += 1;
                continue;
            } else if pi < p.len() && p[pi] == '[' {
                if let Some((matched, next_pi)) = match_bracket(&p[pi..], t[ti], nocase) {
                    if matched {
                        pi += next_pi;
                        ti += 1;
                        continue;
                    }
                }
            }
            if let Some(sp) = star_pi {
                pi = sp + 1;
                star_ti += 1;
                ti = star_ti;
                continue;
            }
            return false;
        } else {
            break;
        }
    }

    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len() && ti == t.len()
}

fn match_bracket(p: &[char], ch: char, nocase: bool) -> Option<(bool, usize)> {
    if p.first() != Some(&'[') {
        return None;
    }
    let mut idx = 1usize;
    let mut negate = false;
    if idx < p.len() && (p[idx] == '!' || p[idx] == '^') {
        negate = true;
        idx += 1;
    }
    let mut matched = false;
    let ch_cmp = if nocase { ch.to_ascii_lowercase() } else { ch };
    while idx < p.len() && p[idx] != ']' {
        if idx + 1 < p.len() && p[idx] == '[' && p[idx + 1] == ':' {
            let mut end_col = idx + 2;
            while end_col + 1 < p.len() && !(p[end_col] == ':' && p[end_col + 1] == ']') {
                end_col += 1;
            }
            if end_col + 1 < p.len() {
                let cls: String = p[idx + 2..end_col].iter().collect();
                let cls_match = match cls.as_str() {
                    "space" => ch.is_whitespace(),
                    "blank" => ch == ' ' || ch == '\t',
                    "digit" => ch.is_ascii_digit(),
                    "alpha" => ch.is_ascii_alphabetic(),
                    "alnum" => ch.is_ascii_alphanumeric(),
                    "upper" => ch.is_ascii_uppercase() || (nocase && ch.is_ascii_alphabetic()),
                    "lower" => ch.is_ascii_lowercase() || (nocase && ch.is_ascii_alphabetic()),
                    "xdigit" => ch.is_ascii_hexdigit(),
                    "punct" => ch.is_ascii_punctuation(),
                    "cntrl" => ch.is_ascii_control(),
                    "graph" => ch.is_ascii_graphic(),
                    "print" => ch == ' ' || ch.is_ascii_graphic(),
                    _ => false,
                };
                if cls_match {
                    matched = true;
                }
                idx = end_col + 2;
                continue;
            }
        }
        if idx + 2 < p.len() && p[idx + 1] == '-' && p[idx + 2] != ']' {
            let start = if nocase { p[idx].to_ascii_lowercase() } else { p[idx] };
            let end = if nocase { p[idx + 2].to_ascii_lowercase() } else { p[idx + 2] };
            if ch_cmp >= start && ch_cmp <= end {
                matched = true;
            }
            idx += 3;
        } else {
            if chars_eq(p[idx], ch, nocase) {
                matched = true;
            }
            idx += 1;
        }
    }
    if idx < p.len() && p[idx] == ']' {
        Some((if negate { !matched } else { matched }, idx + 1))
    } else {
        None
    }
}

pub fn decode_ansi_c_escapes(input: &str) -> String {
    decode_c_escapes_inner(input, false)
}

pub fn decode_echo_b_escapes(input: &str) -> String {
    decode_c_escapes_inner(input, true)
}

fn decode_c_escapes_inner(input: &str, leading_zero_octal: bool) -> String {
    let mut out_bytes: Vec<u8> = Vec::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    let push_char = |buf: &mut Vec<u8>, ch: char| {
        let mut tmp = [0u8; 4];
        buf.extend_from_slice(ch.encode_utf8(&mut tmp).as_bytes());
    };
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => out_bytes.push(b'\n'),
                Some('r') => out_bytes.push(b'\r'),
                Some('t') => out_bytes.push(b'\t'),
                Some('a') => out_bytes.push(0x07),
                Some('b') => out_bytes.push(0x08),
                Some('f') => out_bytes.push(0x0c),
                Some('v') => out_bytes.push(0x0b),
                Some('e') | Some('E') => out_bytes.push(0x1b),
                Some('\\') => out_bytes.push(b'\\'),
                Some('\'') => out_bytes.push(b'\''),
                Some('"') => out_bytes.push(b'"'),
                Some('x') => {
                    let mut hex = String::new();
                    for _ in 0..2 {
                        if let Some(&hc) = chars.peek()
                            && hc.is_ascii_hexdigit()
                        {
                            hex.push(chars.next().unwrap());
                        }
                    }
                    if let Ok(val) = u8::from_str_radix(&hex, 16) {
                        out_bytes.push(val);
                    }
                }
                Some('u') => {
                    let mut hex = String::new();
                    for _ in 0..4 {
                        if let Some(&hc) = chars.peek()
                            && hc.is_ascii_hexdigit()
                        {
                            hex.push(chars.next().unwrap());
                        }
                    }
                    if let Ok(val) = u32::from_str_radix(&hex, 16)
                        && let Some(ch) = char::from_u32(val)
                    {
                        push_char(&mut out_bytes, ch);
                    }
                }
                Some('U') => {
                    let mut hex = String::new();
                    for _ in 0..8 {
                        if let Some(&hc) = chars.peek()
                            && hc.is_ascii_hexdigit()
                        {
                            hex.push(chars.next().unwrap());
                        }
                    }
                    if let Ok(val) = u32::from_str_radix(&hex, 16)
                        && let Some(ch) = char::from_u32(val)
                    {
                        push_char(&mut out_bytes, ch);
                    }
                }
                Some(oct) if ('0'..='7').contains(&oct) => {
                    let mut s = String::from(oct);
                    let max_more = if leading_zero_octal && oct == '0' { 3 } else { 2 };
                    for _ in 0..max_more {
                        if let Some(&oc) = chars.peek()
                            && ('0'..='7').contains(&oc)
                        {
                            s.push(chars.next().unwrap());
                        }
                    }
                    if let Ok(val) = u16::from_str_radix(&s, 8) {
                        out_bytes.push((val & 0xff) as u8);
                    }
                }
                Some(other) => {
                    out_bytes.push(b'\\');
                    push_char(&mut out_bytes, other);
                }
                None => out_bytes.push(b'\\'),
            }
        } else {
            push_char(&mut out_bytes, c);
        }
    }
    crate::vfs::bytes_to_stream_string(&out_bytes)
}

pub fn eval_arith(expr: &str, env: &mut BTreeMap<String, String>) -> Result<i64, String> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return Ok(0);
    }
    let tokens = tokenize_arith(trimmed, env)?;
    if tokens.is_empty() {
        return Ok(0);
    }
    let mut pos = 0usize;
    eval_arith_comma(&tokens, &mut pos, env)
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ArithTok {
    Num(i64),
    Ident(String),
    Op(String),
    LParen,
    RParen,
}

fn parse_radix_literal(base: u32, digits: &str) -> i64 {
    let mut acc: i64 = 0;
    for ch in digits.chars() {
        let d = if ch.is_ascii_digit() {
            (ch as u8 - b'0') as u32
        } else if ch.is_ascii_lowercase() {
            (ch as u8 - b'a') as u32 + 10
        } else if ch.is_ascii_uppercase() {
            if base <= 36 {
                (ch as u8 - b'A') as u32 + 10
            } else {
                (ch as u8 - b'A') as u32 + 36
            }
        } else if ch == '@' {
            62
        } else if ch == '_' {
            63
        } else {
            continue;
        };
        acc = acc.wrapping_mul(base as i64).wrapping_add(d as i64);
    }
    acc
}

fn tokenize_arith(expr: &str, env: &BTreeMap<String, String>) -> Result<Vec<ArithTok>, String> {
    let mut expanded = String::new();
    let chars: Vec<char> = expr.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        let c = chars[i];
        if c == '$' {
            i += 1;
            if i < chars.len() && chars[i] == '{' {
                i += 1;
                let mut name = String::new();
                while i < chars.len() && chars[i] != '}' {
                    name.push(chars[i]);
                    i += 1;
                }
                if i < chars.len() {
                    i += 1;
                }
                let val = env.get(&name).cloned().unwrap_or_else(|| "0".to_string());
                expanded.push_str(&val);
            } else {
                let mut name = String::new();
                while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                    name.push(chars[i]);
                    i += 1;
                }
                let val = env.get(&name).cloned().unwrap_or_else(|| "0".to_string());
                expanded.push_str(&val);
            }
        } else {
            expanded.push(c);
            i += 1;
        }
    }

    let mut out = Vec::new();
    let echars: Vec<char> = expanded.chars().collect();
    let mut idx = 0usize;
    while idx < echars.len() {
        let c = echars[idx];
        if c.is_whitespace() {
            idx += 1;
            continue;
        }
        if c == '(' {
            idx += 1;
            out.push(ArithTok::LParen);
            continue;
        }
        if c == ')' {
            idx += 1;
            out.push(ArithTok::RParen);
            continue;
        }
        if c.is_ascii_digit() {
            let mut num_s = String::new();
            while idx < echars.len()
                && (echars[idx].is_ascii_alphanumeric()
                    || echars[idx] == '#'
                    || echars[idx] == '@'
                    || echars[idx] == '_')
            {
                num_s.push(echars[idx]);
                idx += 1;
            }
            let val = if let Some((base_s, digits)) = num_s.split_once('#') {
                let base = base_s.parse::<u32>().unwrap_or(10);
                parse_radix_literal(base, digits)
            } else if let Some(hex) = num_s
                .strip_prefix("0x")
                .or_else(|| num_s.strip_prefix("0X"))
            {
                i64::from_str_radix(hex, 16).unwrap_or(0)
            } else if num_s.starts_with('0')
                && num_s.len() > 1
                && num_s[1..].chars().all(|c| ('0'..='7').contains(&c))
            {
                i64::from_str_radix(&num_s[1..], 8).unwrap_or(0)
            } else {
                num_s.parse::<i64>().unwrap_or(0)
            };
            out.push(ArithTok::Num(val));
            continue;
        }
        if c.is_ascii_alphabetic() || c == '_' {
            let mut id = String::new();
            while idx < echars.len()
                && (echars[idx].is_ascii_alphanumeric() || echars[idx] == '_')
            {
                id.push(echars[idx]);
                idx += 1;
            }
            if idx < echars.len() && echars[idx] == '[' {
                idx += 1;
                let mut sub = String::new();
                let mut depth = 1usize;
                while idx < echars.len() && depth > 0 {
                    if echars[idx] == '[' {
                        depth += 1;
                    } else if echars[idx] == ']' {
                        depth -= 1;
                        if depth == 0 {
                            idx += 1;
                            break;
                        }
                    }
                    sub.push(echars[idx]);
                    idx += 1;
                }
                let clean_sub = sub.trim().trim_matches('"').trim_matches('\'');
                id.push('[');
                id.push_str(clean_sub);
                id.push(']');
            }
            out.push(ArithTok::Ident(id));
            continue;
        }
        let op_ch = echars[idx];
        idx += 1;
        let mut op = String::from(op_ch);
        if idx + 1 < echars.len() {
            let tri = format!("{op_ch}{}{}", echars[idx], echars[idx + 1]);
            if matches!(tri.as_str(), "<<=" | ">>=") {
                idx += 2;
                out.push(ArithTok::Op(tri));
                continue;
            }
        }
        if idx < echars.len() {
            let pair = format!("{op_ch}{}", echars[idx]);
            if matches!(
                pair.as_str(),
                "++" | "--"
                    | "+="
                    | "-="
                    | "*="
                    | "/="
                    | "%="
                    | "&="
                    | "|="
                    | "^="
                    | "=="
                    | "!="
                    | "<="
                    | ">="
                    | "&&"
                    | "||"
                    | "<<"
                    | ">>"
                    | "**"
            ) {
                idx += 1;
                op = pair;
            }
        }
        out.push(ArithTok::Op(op));
    }
    Ok(out)
}

fn resolve_arith_var(name: &str, env: &BTreeMap<String, String>, depth: usize) -> i64 {
    if depth > 16 {
        return 0;
    }
    let resolved = resolve_var_key(name, env);
    let Some(raw) = env.get(&resolved) else {
        return 0;
    };
    let trimmed = raw.trim();
    if let Ok(n) = trimmed.parse::<i64>() {
        return n;
    }
    if !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return resolve_arith_var(trimmed, env, depth + 1);
    }
    let mut tmp = env.clone();
    eval_arith(trimmed, &mut tmp).unwrap_or(0)
}

fn resolve_var_key(name: &str, env: &BTreeMap<String, String>) -> String {
    resolve_var_key_for_lookup(name, env)
}

pub fn sync_array_metadata(base: &str, env: &mut BTreeMap<String, String>) {
    let prefix = format!("{base}[");
    let mut keys: Vec<String> = Vec::new();
    let mut vals: Vec<String> = Vec::new();
    let is_assoc = env.get(&format!("__assoc__{base}")).map(|v| v == "1").unwrap_or(false);

    let mut entries: Vec<(String, String)> = Vec::new();
    for (k, v) in env.iter() {
        if let Some(rest) = k.strip_prefix(&prefix)
            && let Some(sub) = rest.strip_suffix(']')
            && !matches!(sub, "@" | "*" | "#")
        {
            entries.push((sub.to_string(), v.clone()));
        }
    }
    if !is_assoc {
        entries.sort_by_key(|(k, _)| k.parse::<i64>().unwrap_or(0));
    }
    for (k, v) in entries {
        keys.push(k);
        vals.push(v);
    }
    let joined = vals.join(" ");
    env.insert(format!("{base}[#]"), vals.len().to_string());
    env.insert(format!("{base}[*]"), joined.clone());
    env.insert(format!("{base}[@]"), joined);
    env.insert(format!("__keys__{base}"), keys.join("\x1f"));
}

fn set_arith_var(name: &str, val: i64, env: &mut BTreeMap<String, String>) {
    let resolved = resolve_var_key(name, env);
    env.insert(resolved.clone(), val.to_string());
    if let Some((base, _)) = resolved.split_once('[') {
        sync_array_metadata(base, env);
    }
}

fn eval_arith_comma(
    tokens: &[ArithTok],
    pos: &mut usize,
    env: &mut BTreeMap<String, String>,
) -> Result<i64, String> {
    let mut val = eval_arith_assign(tokens, pos, env)?;
    while matches!(tokens.get(*pos), Some(ArithTok::Op(op)) if op == ",") {
        *pos += 1;
        val = eval_arith_assign(tokens, pos, env)?;
    }
    Ok(val)
}

fn eval_arith_assign(
    tokens: &[ArithTok],
    pos: &mut usize,
    env: &mut BTreeMap<String, String>,
) -> Result<i64, String> {
    if let Some(ArithTok::Ident(name)) = tokens.get(*pos)
        && let Some(ArithTok::Op(op)) = tokens.get(*pos + 1)
        && matches!(
            op.as_str(),
            "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "&=" | "|=" | "^=" | "<<=" | ">>="
        )
    {
        let var = name.clone();
        let assign_op = op.clone();
        *pos += 2;
        let rhs = eval_arith_assign(tokens, pos, env)?;
        let cur = resolve_arith_var(&var, env, 0);
        let next = match assign_op.as_str() {
            "=" => rhs,
            "+=" => cur.wrapping_add(rhs),
            "-=" => cur.wrapping_sub(rhs),
            "*=" => cur.wrapping_mul(rhs),
            "/=" => {
                if rhs == 0 {
                    return Err("Division by zero".to_string());
                }
                cur / rhs
            }
            "%=" => {
                if rhs == 0 {
                    return Err("Division by zero".to_string());
                }
                cur % rhs
            }
            "&=" => cur & rhs,
            "|=" => cur | rhs,
            "^=" => cur ^ rhs,
            "<<=" => cur.wrapping_shl(rhs as u32),
            ">>=" => cur.wrapping_shr(rhs as u32),
            _ => rhs,
        };
        set_arith_var(&var, next, env);
        return Ok(next);
    }
    eval_arith_ternary(tokens, pos, env)
}

fn eval_arith_ternary(
    tokens: &[ArithTok],
    pos: &mut usize,
    env: &mut BTreeMap<String, String>,
) -> Result<i64, String> {
    let cond = eval_arith_logical_or(tokens, pos, env)?;
    if matches!(tokens.get(*pos), Some(ArithTok::Op(op)) if op == "?") {
        *pos += 1;
        if cond != 0 {
            let t_val = eval_arith_comma(tokens, pos, env)?;
            if matches!(tokens.get(*pos), Some(ArithTok::Op(op)) if op == ":") {
                *pos += 1;
            }
            let mut dummy = env.clone();
            let _ = eval_arith_ternary(tokens, pos, &mut dummy)?;
            Ok(t_val)
        } else {
            let mut dummy = env.clone();
            let _ = eval_arith_comma(tokens, pos, &mut dummy)?;
            if matches!(tokens.get(*pos), Some(ArithTok::Op(op)) if op == ":") {
                *pos += 1;
            }
            eval_arith_ternary(tokens, pos, env)
        }
    } else {
        Ok(cond)
    }
}

fn eval_arith_logical_or(
    tokens: &[ArithTok],
    pos: &mut usize,
    env: &mut BTreeMap<String, String>,
) -> Result<i64, String> {
    let mut left = eval_arith_logical_and(tokens, pos, env)?;
    while matches!(tokens.get(*pos), Some(ArithTok::Op(op)) if op == "||") {
        *pos += 1;
        if left != 0 {
            let mut dummy = env.clone();
            let _ = eval_arith_logical_and(tokens, pos, &mut dummy)?;
            left = 1;
        } else {
            let right = eval_arith_logical_and(tokens, pos, env)?;
            left = i64::from(right != 0);
        }
    }
    Ok(left)
}

fn eval_arith_logical_and(
    tokens: &[ArithTok],
    pos: &mut usize,
    env: &mut BTreeMap<String, String>,
) -> Result<i64, String> {
    let mut left = eval_arith_bit_or(tokens, pos, env)?;
    while matches!(tokens.get(*pos), Some(ArithTok::Op(op)) if op == "&&") {
        *pos += 1;
        if left == 0 {
            let mut dummy = env.clone();
            let _ = eval_arith_bit_or(tokens, pos, &mut dummy)?;
            left = 0;
        } else {
            let right = eval_arith_bit_or(tokens, pos, env)?;
            left = i64::from(right != 0);
        }
    }
    Ok(left)
}

fn eval_arith_bit_or(
    tokens: &[ArithTok],
    pos: &mut usize,
    env: &mut BTreeMap<String, String>,
) -> Result<i64, String> {
    let mut left = eval_arith_bit_xor(tokens, pos, env)?;
    while matches!(tokens.get(*pos), Some(ArithTok::Op(op)) if op == "|") {
        *pos += 1;
        let right = eval_arith_bit_xor(tokens, pos, env)?;
        left |= right;
    }
    Ok(left)
}

fn eval_arith_bit_xor(
    tokens: &[ArithTok],
    pos: &mut usize,
    env: &mut BTreeMap<String, String>,
) -> Result<i64, String> {
    let mut left = eval_arith_bit_and(tokens, pos, env)?;
    while matches!(tokens.get(*pos), Some(ArithTok::Op(op)) if op == "^") {
        *pos += 1;
        let right = eval_arith_bit_and(tokens, pos, env)?;
        left ^= right;
    }
    Ok(left)
}

fn eval_arith_bit_and(
    tokens: &[ArithTok],
    pos: &mut usize,
    env: &mut BTreeMap<String, String>,
) -> Result<i64, String> {
    let mut left = eval_arith_eq(tokens, pos, env)?;
    while matches!(tokens.get(*pos), Some(ArithTok::Op(op)) if op == "&") {
        *pos += 1;
        let right = eval_arith_eq(tokens, pos, env)?;
        left &= right;
    }
    Ok(left)
}

fn eval_arith_eq(
    tokens: &[ArithTok],
    pos: &mut usize,
    env: &mut BTreeMap<String, String>,
) -> Result<i64, String> {
    let mut left = eval_arith_rel(tokens, pos, env)?;
    while let Some(ArithTok::Op(op)) = tokens.get(*pos) {
        if op != "==" && op != "!=" {
            break;
        }
        let op_s = op.clone();
        *pos += 1;
        let right = eval_arith_rel(tokens, pos, env)?;
        left = match op_s.as_str() {
            "==" => i64::from(left == right),
            "!=" => i64::from(left != right),
            _ => left,
        };
    }
    Ok(left)
}

fn eval_arith_rel(
    tokens: &[ArithTok],
    pos: &mut usize,
    env: &mut BTreeMap<String, String>,
) -> Result<i64, String> {
    let mut left = eval_arith_shift(tokens, pos, env)?;
    while let Some(ArithTok::Op(op)) = tokens.get(*pos) {
        if !matches!(op.as_str(), "<" | "<=" | ">" | ">=") {
            break;
        }
        let op_s = op.clone();
        *pos += 1;
        let right = eval_arith_shift(tokens, pos, env)?;
        left = match op_s.as_str() {
            "<" => i64::from(left < right),
            "<=" => i64::from(left <= right),
            ">" => i64::from(left > right),
            ">=" => i64::from(left >= right),
            _ => left,
        };
    }
    Ok(left)
}

fn eval_arith_shift(
    tokens: &[ArithTok],
    pos: &mut usize,
    env: &mut BTreeMap<String, String>,
) -> Result<i64, String> {
    let mut left = eval_arith_add(tokens, pos, env)?;
    while let Some(ArithTok::Op(op)) = tokens.get(*pos) {
        if op != "<<" && op != ">>" {
            break;
        }
        let op_s = op.clone();
        *pos += 1;
        let right = eval_arith_add(tokens, pos, env)?;
        left = match op_s.as_str() {
            "<<" => left.wrapping_shl(right as u32),
            ">>" => left.wrapping_shr(right as u32),
            _ => left,
        };
    }
    Ok(left)
}

fn eval_arith_add(
    tokens: &[ArithTok],
    pos: &mut usize,
    env: &mut BTreeMap<String, String>,
) -> Result<i64, String> {
    let mut left = eval_arith_mul(tokens, pos, env)?;
    while let Some(ArithTok::Op(op)) = tokens.get(*pos) {
        if op != "+" && op != "-" {
            break;
        }
        let op_s = op.clone();
        *pos += 1;
        let right = eval_arith_mul(tokens, pos, env)?;
        left = if op_s == "+" {
            left.wrapping_add(right)
        } else {
            left.wrapping_sub(right)
        };
    }
    Ok(left)
}

fn eval_arith_mul(
    tokens: &[ArithTok],
    pos: &mut usize,
    env: &mut BTreeMap<String, String>,
) -> Result<i64, String> {
    let mut left = eval_arith_pow(tokens, pos, env)?;
    while let Some(ArithTok::Op(op)) = tokens.get(*pos) {
        if !matches!(op.as_str(), "*" | "/" | "%") {
            break;
        }
        let op_s = op.clone();
        *pos += 1;
        let right = eval_arith_pow(tokens, pos, env)?;
        left = match op_s.as_str() {
            "*" => left.wrapping_mul(right),
            "/" => {
                if right == 0 {
                    return Err("Division by zero".to_string());
                }
                left / right
            }
            "%" => {
                if right == 0 {
                    return Err("Division by zero".to_string());
                }
                left % right
            }
            _ => left,
        };
    }
    Ok(left)
}

fn eval_arith_pow(
    tokens: &[ArithTok],
    pos: &mut usize,
    env: &mut BTreeMap<String, String>,
) -> Result<i64, String> {
    let base = eval_arith_unary(tokens, pos, env)?;
    if matches!(tokens.get(*pos), Some(ArithTok::Op(op)) if op == "**") {
        *pos += 1;
        let exp = eval_arith_pow(tokens, pos, env)?;
        if exp < 0 {
            return Err("exponent less than 0".to_string());
        }
        return Ok(base.wrapping_pow(exp as u32));
    }
    Ok(base)
}

fn eval_arith_unary(
    tokens: &[ArithTok],
    pos: &mut usize,
    env: &mut BTreeMap<String, String>,
) -> Result<i64, String> {
    if let Some(ArithTok::Op(op)) = tokens.get(*pos) {
        match op.as_str() {
            "+" => {
                *pos += 1;
                return eval_arith_unary(tokens, pos, env);
            }
            "-" => {
                *pos += 1;
                return Ok(eval_arith_unary(tokens, pos, env)?.wrapping_neg());
            }
            "!" => {
                *pos += 1;
                return Ok(i64::from(eval_arith_unary(tokens, pos, env)? == 0));
            }
            "~" => {
                *pos += 1;
                return Ok(!eval_arith_unary(tokens, pos, env)?);
            }
            "++" | "--" => {
                let is_inc = op == "++";
                *pos += 1;
                if let Some(ArithTok::Ident(var)) = tokens.get(*pos).cloned() {
                    *pos += 1;
                    let cur = resolve_arith_var(&var, env, 0);
                    let next = if is_inc { cur + 1 } else { cur - 1 };
                    set_arith_var(&var, next, env);
                    return Ok(next);
                }
            }
            _ => {}
        }
    }
    eval_arith_primary(tokens, pos, env)
}

fn eval_arith_primary(
    tokens: &[ArithTok],
    pos: &mut usize,
    env: &mut BTreeMap<String, String>,
) -> Result<i64, String> {
    match tokens.get(*pos).cloned() {
        Some(ArithTok::Num(n)) => {
            *pos += 1;
            Ok(n)
        }
        Some(ArithTok::Ident(var)) => {
            *pos += 1;
            let cur = resolve_arith_var(&var, env, 0);
            if let Some(ArithTok::Op(op)) = tokens.get(*pos)
                && (op == "++" || op == "--")
            {
                let next = if op == "++" { cur + 1 } else { cur - 1 };
                *pos += 1;
                set_arith_var(&var, next, env);
                return Ok(cur);
            }
            Ok(cur)
        }
        Some(ArithTok::LParen) => {
            *pos += 1;
            let val = eval_arith_comma(tokens, pos, env)?;
            if matches!(tokens.get(*pos), Some(ArithTok::RParen)) {
                *pos += 1;
            }
            Ok(val)
        }
        _ => Ok(0),
    }
}

pub fn expand_parameter_expr(
    expr: &str,
    env: &mut BTreeMap<String, String>,
    last_exit: i32,
    pos_args: &[String],
) -> Result<String, String> {
    if expr == "?" {
        return Ok(last_exit.to_string());
    }
    if expr == "!" {
        return Ok(env.get("!").cloned().unwrap_or_default());
    }
    if expr == "$" {
        return Ok(env.get("$").cloned().unwrap_or_else(|| "1000".to_string()));
    }
    if expr == "#" {
        return Ok(pos_args.len().to_string());
    }
    if expr == "@" {
        return Ok(pos_args.join(" "));
    }
    if expr == "*" {
        let sep = env
            .get("IFS")
            .and_then(|s| s.chars().next())
            .map(|c| c.to_string())
            .unwrap_or_else(|| {
                if env.contains_key("IFS") {
                    String::new()
                } else {
                    " ".to_string()
                }
            });
        return Ok(pos_args.join(&sep));
    }

    // Indirect / keys / prefix discovery: ${!var}, ${!prefix*}, ${!prefix@}, ${!arr[@]}, ${!arr[*]}
    if let Some(rest) = expr.strip_prefix('!') {
        if let Some(arr_base) = rest.strip_suffix("[@]").or_else(|| rest.strip_suffix("[*]")) {
            let resolved = resolve_nameref_base(arr_base, env);
            let prefix = format!("{resolved}[");
            let is_assoc = env
                .get(&format!("__assoc__{resolved}"))
                .map(|v| v == "1")
                .unwrap_or(false);
            let mut keys: Vec<String> = env
                .keys()
                .filter_map(|k| {
                    k.strip_prefix(&prefix)
                        .and_then(|s| s.strip_suffix(']'))
                        .filter(|&sub| !matches!(sub, "@" | "*" | "#"))
                        .map(|s| s.to_string())
                })
                .collect();
            if !is_assoc {
                keys.sort_by_key(|k| k.parse::<i64>().unwrap_or(0));
            }
            return Ok(keys.join(" "));
        }
        if let Some(prefix) = rest.strip_suffix('*').or_else(|| rest.strip_suffix('@')) {
            let mut names: Vec<String> = env
                .keys()
                .filter(|k| {
                    k.starts_with(prefix)
                        && !k.starts_with("__")
                        && !k.contains('[')
                })
                .cloned()
                .collect();
            names.sort();
            return Ok(names.join(" "));
        }
        if env.contains_key(&format!("__nameref__{rest}")) {
            return Ok(resolve_nameref_base(rest, env).to_string());
        }
        let target_name = lookup_var(rest, env, last_exit, pos_args);
        if target_name.is_empty() {
            return Ok(String::new());
        }
        return Ok(lookup_var(&target_name, env, last_exit, pos_args));
    }

    if let Some(rest) = expr.strip_prefix('#') {
        if let Some(arr_base) = rest.strip_suffix("[@]").or_else(|| rest.strip_suffix("[*]")) {
            let resolved = resolve_nameref_base(arr_base, env);
            let prefix = format!("{resolved}[");
            let count = env
                .keys()
                .filter(|k| {
                    k.strip_prefix(&prefix)
                        .and_then(|s| s.strip_suffix(']'))
                        .is_some_and(|sub| !matches!(sub, "@" | "*" | "#"))
                })
                .count();
            return Ok(count.to_string());
        }
        let val = lookup_var(rest, env, last_exit, pos_args);
        let lc = env.get("LC_ALL").or_else(|| env.get("LANG")).map(|s| s.as_str());
        if lc == Some("C") || lc == Some("POSIX") {
            return Ok(val.len().to_string());
        }
        return Ok(val.chars().count().to_string());
    }

    // Parameter transforms @E, @Q, @u, @U, @L, @a, @A, @k, @K
    if let Some((var, xform)) = expr.rsplit_once('@')
        && matches!(xform, "E" | "Q" | "u" | "U" | "L" | "a" | "A" | "k" | "K")
    {
        match xform {
            "E" => {
                let val = lookup_var(var, env, last_exit, pos_args);
                return Ok(decode_ansi_c_escapes(&val));
            }
            "Q" => {
                let val = lookup_var(var, env, last_exit, pos_args);
                return Ok(bash_quote_value(&val));
            }
            "U" => {
                let val = lookup_var(var, env, last_exit, pos_args);
                return Ok(bash_uppercase(&val, None, true));
            }
            "u" => {
                let val = lookup_var(var, env, last_exit, pos_args);
                return Ok(bash_uppercase(&val, None, false));
            }
            "L" => {
                let val = lookup_var(var, env, last_exit, pos_args);
                return Ok(bash_lowercase(&val, None, true));
            }
            "a" => {
                let base = var.strip_suffix("[@]").or_else(|| var.strip_suffix("[*]")).unwrap_or(var);
                let resolved = resolve_nameref_base(base, env);
                if let Some(attr) = env.get(&format!("__attr__{resolved}")) {
                    return Ok(attr.clone());
                }
                if env.get(&format!("__assoc__{resolved}")).map(|v| v == "1").unwrap_or(false) {
                    return Ok("A".to_string());
                }
                if env.contains_key(&format!("{resolved}[#]")) {
                    return Ok("a".to_string());
                }
                return Ok(String::new());
            }
            "k" | "K" => {
                let base = var.strip_suffix("[@]").or_else(|| var.strip_suffix("[*]")).unwrap_or(var);
                let resolved = resolve_nameref_base(base, env);
                let prefix = format!("{resolved}[");
                let is_assoc = env.get(&format!("__assoc__{resolved}")).map(|v| v == "1").unwrap_or(false);
                let mut entries: Vec<(String, String)> = env
                    .iter()
                    .filter_map(|(k, v)| {
                        k.strip_prefix(&prefix)
                            .and_then(|s| s.strip_suffix(']'))
                            .filter(|&sub| !matches!(sub, "@" | "*" | "#"))
                            .map(|sub| (sub.to_string(), v.clone()))
                    })
                    .collect();
                if !is_assoc {
                    entries.sort_by_key(|(k, _)| k.parse::<i64>().unwrap_or(0));
                }
                let mut parts = Vec::new();
                for (k, v) in entries {
                    parts.push(k);
                    parts.push(v);
                }
                return Ok(parts.join(" "));
            }
            _ => {}
        }
    }

    // Find top-level operator after variable name (respecting [...] subscript)
    let var_end = find_var_name_end(expr);
    if var_end > 0 && var_end < expr.len() {
        let var = &expr[..var_end];
        let op_rest = &expr[var_end..];

        // Error if unset/empty :?, ?
        if let Some(msg_raw) = op_rest.strip_prefix(":?") {
            let is_set = is_var_set(var, env, pos_args);
            let val = lookup_var(var, env, last_exit, pos_args);
            if !is_set || val.is_empty() {
                let msg = expand_nested_operand(msg_raw, env, last_exit, pos_args)?;
                let err_msg = if msg.is_empty() {
                    "parameter null or not set".to_string()
                } else {
                    msg
                };
                return Err(format!("{var}: {err_msg}"));
            }
            return Ok(val);
        }
        if let Some(msg_raw) = op_rest.strip_prefix('?') {
            if ! is_var_set(var, env, pos_args) {
                let msg = expand_nested_operand(msg_raw, env, last_exit, pos_args)?;
                let err_msg = if msg.is_empty() {
                    "parameter not set".to_string()
                } else {
                    msg
                };
                return Err(format!("{var}: {err_msg}"));
            }
            return Ok(lookup_var(var, env, last_exit, pos_args));
        }

        // Default / assign / alternate operators (colon and non-colon)
        if let Some(def_raw) = op_rest.strip_prefix(":-") {
            let is_set = is_var_set(var, env, pos_args);
            let val = lookup_var(var, env, last_exit, pos_args);
            if !is_set || val.is_empty() {
                return expand_nested_operand(def_raw, env, last_exit, pos_args);
            }
            return Ok(val);
        }
        if let Some(def_raw) = op_rest.strip_prefix('-') {
            if !is_var_set(var, env, pos_args) {
                return expand_nested_operand(def_raw, env, last_exit, pos_args);
            }
            return Ok(lookup_var(var, env, last_exit, pos_args));
        }
        if let Some(def_raw) = op_rest.strip_prefix(":=") {
            let is_set = is_var_set(var, env, pos_args);
            let val = lookup_var(var, env, last_exit, pos_args);
            if !is_set || val.is_empty() {
                let def = expand_nested_operand(def_raw, env, last_exit, pos_args)?;
                let resolved = resolve_var_key(var, env);
                env.insert(resolved, def.clone());
                return Ok(def);
            }
            return Ok(val);
        }
        if let Some(def_raw) = op_rest.strip_prefix('=') {
            if !is_var_set(var, env, pos_args) {
                let def = expand_nested_operand(def_raw, env, last_exit, pos_args)?;
                let resolved = resolve_var_key(var, env);
                env.insert(resolved, def.clone());
                return Ok(def);
            }
            return Ok(lookup_var(var, env, last_exit, pos_args));
        }
        if let Some(alt_raw) = op_rest.strip_prefix(":+") {
            let is_set = is_var_set(var, env, last_exit_or_pos(pos_args));
            let val = lookup_var(var, env, last_exit, pos_args);
            if is_set && !val.is_empty() {
                return expand_nested_operand(alt_raw, env, last_exit, pos_args);
            }
            return Ok(String::new());
        }
        if let Some(alt_raw) = op_rest.strip_prefix('+') {
            if is_var_set(var, env, pos_args) {
                return expand_nested_operand(alt_raw, env, last_exit, pos_args);
            }
            return Ok(String::new());
        }

        // Prefix / suffix stripping ##, #, %%, %
        if let Some(pat_raw) = op_rest.strip_prefix("##") {
            let pat = expand_nested_operand(pat_raw, env, last_exit, pos_args)?;
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems.iter().map(|e| strip_prefix_glob(e, &pat, true)).collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(strip_prefix_glob(&val, &pat, true));
        }
        if let Some(pat_raw) = op_rest.strip_prefix('#') {
            let pat = expand_nested_operand(pat_raw, env, last_exit, pos_args)?;
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems.iter().map(|e| strip_prefix_glob(e, &pat, false)).collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(strip_prefix_glob(&val, &pat, false));
        }
        if let Some(pat_raw) = op_rest.strip_prefix("%%") {
            let pat = expand_nested_operand(pat_raw, env, last_exit, pos_args)?;
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems.iter().map(|e| strip_suffix_glob(e, &pat, true)).collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(strip_suffix_glob(&val, &pat, true));
        }
        if let Some(pat_raw) = op_rest.strip_prefix('%') {
            let pat = expand_nested_operand(pat_raw, env, last_exit, pos_args)?;
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems.iter().map(|e| strip_suffix_glob(e, &pat, false)).collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(strip_suffix_glob(&val, &pat, false));
        }

        // Pattern replacement //, /
        if let Some(rest) = op_rest.strip_prefix("//") {
            let (pat_raw, rep_raw) = split_first_unescaped_slash(rest);
            let pat = expand_nested_operand(pat_raw, env, last_exit, pos_args)?;
            let rep = expand_nested_operand(rep_raw, env, last_exit, pos_args)?;
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems.iter().map(|e| replace_glob_pattern(e, &pat, &rep, true)).collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(replace_glob_pattern(&val, &pat, &rep, true));
        }
        if let Some(rest) = op_rest.strip_prefix('/') {
            let (pat_raw, rep_raw) = split_first_unescaped_slash(rest);
            let pat = expand_nested_operand(pat_raw, env, last_exit, pos_args)?;
            let rep = expand_nested_operand(rep_raw, env, last_exit, pos_args)?;
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems.iter().map(|e| replace_glob_pattern(e, &pat, &rep, false)).collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(replace_glob_pattern(&val, &pat, &rep, false));
        }

        // Case conversion ^^, ^, ,, , (with optional pattern)
        if let Some(pat) = op_rest.strip_prefix("^^") {
            let p = if pat.is_empty() { None } else { Some(pat) };
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems.iter().map(|w| bash_uppercase(w, p, true)).collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(bash_uppercase(&val, p, true));
        }
        if let Some(pat) = op_rest.strip_prefix('^') {
            let p = if pat.is_empty() { None } else { Some(pat) };
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems.iter().map(|w| bash_uppercase(w, p, false)).collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(bash_uppercase(&val, p, false));
        }
        if let Some(pat) = op_rest.strip_prefix(",,") {
            let p = if pat.is_empty() { None } else { Some(pat) };
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems.iter().map(|w| bash_lowercase(w, p, true)).collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(bash_lowercase(&val, p, true));
        }
        if let Some(pat) = op_rest.strip_prefix(',') {
            let p = if pat.is_empty() { None } else { Some(pat) };
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems.iter().map(|w| bash_lowercase(w, p, false)).collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(bash_lowercase(&val, p, false));
        }

        // Substring or array slicing ${var:offset:len}
        if let Some(slice_spec) = op_rest.strip_prefix(':') {
            let (off_s, len_opt) = match slice_spec.split_once(':') {
                Some((o, l)) => (o.trim(), Some(l.trim())),
                None => (slice_spec.trim(), None),
            };
            let off = eval_arith(off_s, env).unwrap_or(0) as isize;
            let len_val = len_opt.map(|ls| eval_arith(ls, env).unwrap_or(0) as isize);

            // Array slicing ${arr[@]:off:len} or ${arr[*]:off:len}
            if let Some(arr_base) = var.strip_suffix("[@]").or_else(|| var.strip_suffix("[*]")) {
                let resolved = resolve_nameref_base(arr_base, env).to_string();
                let prefix = format!("{resolved}[");
                let mut entries: Vec<(isize, String)> = env
                    .iter()
                    .filter_map(|(k, v)| {
                        k.strip_prefix(&prefix)
                            .and_then(|s| s.strip_suffix(']'))
                            .and_then(|sub| sub.parse::<isize>().ok())
                            .map(|idx| (idx, v.clone()))
                    })
                    .collect();
                entries.sort_by_key(|(idx, _)| *idx);
                let start_idx = if off < 0 {
                    let max_idx = entries.last().map(|(i, _)| *i + 1).unwrap_or(0);
                    (max_idx + off).max(0)
                } else {
                    off
                };
                let filtered: Vec<String> = entries
                    .into_iter()
                    .filter(|(idx, _)| *idx >= start_idx)
                    .take(len_val.unwrap_or(isize::MAX).max(0) as usize)
                    .map(|(_, v)| v)
                    .collect();
                return Ok(filtered.join(" "));
            }

            // Positional parameters slicing ${@:off:len} or ${*:off:len}
            if var == "@" || var == "*" {
                let total = pos_args.len() as isize;
                let start = if off < 0 {
                    (total + 1 + off).max(1) as usize - 1
                } else if off <= 1 {
                    0
                } else {
                    (off as usize - 1).min(pos_args.len())
                };
                let count = len_val.unwrap_or(total).max(0) as usize;
                let end = (start + count).min(pos_args.len());
                return Ok(pos_args[start..end].join(" "));
            }

            let val = lookup_var(var, env, last_exit, pos_args);
            let lc = env.get("LC_ALL").or_else(|| env.get("LANG")).map(|s| s.as_str());
            if lc == Some("C") || lc == Some("POSIX") {
                let bytes = crate::vfs::stream_string_to_bytes(&val);
                let total_len = bytes.len();
                let start = if off < 0 {
                    (total_len as isize + off).max(0) as usize
                } else {
                    (off as usize).min(total_len)
                };
                let end = if let Some(l) = len_val {
                    if l < 0 {
                        (total_len as isize + l).max(start as isize) as usize
                    } else {
                        (start + l as usize).min(total_len)
                    }
                } else {
                    total_len
                };
                return Ok(crate::vfs::bytes_to_stream_string(&bytes[start..end]));
            }
            let chars: Vec<char> = val.chars().collect();
            let total_len = chars.len();
            let start = if off < 0 {
                (total_len as isize + off).max(0) as usize
            } else {
                (off as usize).min(total_len)
            };
            let end = if let Some(l) = len_val {
                if l < 0 {
                    (total_len as isize + l).max(start as isize) as usize
                } else {
                    (start + l as usize).min(total_len)
                }
            } else {
                total_len
            };
            return Ok(chars[start..end].iter().collect());
        }
    }

    if env.get("__set_nounset").map(|v| v == "1").unwrap_or(false)
        && !is_var_set(expr, env, pos_args)
        && !expr.ends_with("[@]")
        && !expr.ends_with("[*]")
        && !matches!(expr, "?" | "#" | "@" | "*" | "$" | "!" | "0")
    {
        return Err(format!("{expr}: unbound variable"));
    }
    Ok(lookup_var(expr, env, last_exit, pos_args))
}

pub fn expand_double_quoted_at_expr(
    expr: &str,
    env: &mut BTreeMap<String, String>,
    pos_args: &[String],
) -> Option<Vec<String>> {
    if expr == "@" {
        return Some(pos_args.to_vec());
    }
    if let Some(slice_spec) = expr.strip_prefix("@:") {
        let (off_s, len_opt) = match slice_spec.split_once(':') {
            Some((o, l)) => (o.trim(), Some(l.trim())),
            None => (slice_spec.trim(), None),
        };
        let off = eval_arith(off_s, env).unwrap_or(0) as isize;
        let len_val = len_opt.map(|ls| eval_arith(ls, env).unwrap_or(0) as isize);
        let total = pos_args.len() as isize;
        let start = if off < 0 {
            (total + 1 + off).max(1) as usize - 1
        } else if off <= 1 {
            0
        } else {
            (off as usize - 1).min(pos_args.len())
        };
        let count = len_val.unwrap_or(total).max(0) as usize;
        let end = (start + count).min(pos_args.len());
        return Some(pos_args[start..end].to_vec());
    }
    if let Some(prefix) = expr
        .strip_prefix('!')
        .and_then(|s| s.strip_suffix('@'))
        .filter(|p| !p.ends_with('['))
    {
        let mut names: Vec<String> = env
            .keys()
            .filter(|k| k.starts_with(prefix) && !k.starts_with("__") && !k.contains('['))
            .cloned()
            .collect();
        names.sort();
        return Some(names);
    }
    if let Some(arr_base) = expr.strip_prefix('!').and_then(|s| s.strip_suffix("[@]")) {
        let resolved = resolve_nameref_base(arr_base, env);
        let prefix = format!("{resolved}[");
        let is_assoc = env
            .get(&format!("__assoc__{resolved}"))
            .map(|v| v == "1")
            .unwrap_or(false);
        let mut keys: Vec<String> = env
            .keys()
            .filter_map(|k| {
                k.strip_prefix(&prefix)
                    .and_then(|s| s.strip_suffix(']'))
                    .filter(|&sub| !matches!(sub, "@" | "*" | "#"))
                    .map(|s| s.to_string())
            })
            .collect();
        if !is_assoc {
            keys.sort_by_key(|k| k.parse::<i64>().unwrap_or(0));
        }
        return Some(keys);
    }
    if !expr.starts_with('#') && !expr.starts_with('!') {
        if let Some(arr_base) = expr.strip_suffix("[@]") {
            let resolved = resolve_nameref_base(arr_base, env);
            let prefix = format!("{resolved}[");
            let is_assoc = env
                .get(&format!("__assoc__{resolved}"))
                .map(|v| v == "1")
                .unwrap_or(false);
            let mut entries: Vec<(String, String)> = env
                .iter()
                .filter_map(|(k, v)| {
                    k.strip_prefix(&prefix)
                        .and_then(|s| s.strip_suffix(']'))
                        .filter(|&sub| !matches!(sub, "@" | "*" | "#"))
                        .map(|sub| (sub.to_string(), v.clone()))
                })
                .collect();
            if !is_assoc {
                entries.sort_by_key(|(k, _)| k.parse::<i64>().unwrap_or(0));
            }
            return Some(entries.into_iter().map(|(_, v)| v).collect());
        }
        if let Some((var_part, slice_spec)) = expr.split_once(':')
            && let Some(arr_base) = var_part.strip_suffix("[@]")
        {
            let (off_s, len_opt) = match slice_spec.split_once(':') {
                Some((o, l)) => (o.trim(), Some(l.trim())),
                None => (slice_spec.trim(), None),
            };
            let off = eval_arith(off_s, env).unwrap_or(0) as isize;
            let len_val = len_opt.map(|ls| eval_arith(ls, env).unwrap_or(0) as isize);
            let resolved = resolve_nameref_base(arr_base, env).to_string();
            let prefix = format!("{resolved}[");
            let mut entries: Vec<(isize, String)> = env
                .iter()
                .filter_map(|(k, v)| {
                    k.strip_prefix(&prefix)
                        .and_then(|s| s.strip_suffix(']'))
                        .and_then(|sub| sub.parse::<isize>().ok())
                        .map(|idx| (idx, v.clone()))
                })
                .collect();
            entries.sort_by_key(|(idx, _)| *idx);
            let start_idx = if off < 0 {
                let max_idx = entries.last().map(|(i, _)| *i + 1).unwrap_or(0);
                (max_idx + off).max(0)
            } else {
                off
            };
            let filtered: Vec<String> = entries
                .into_iter()
                .filter(|(idx, _)| *idx >= start_idx)
                .take(len_val.unwrap_or(isize::MAX).max(0) as usize)
                .map(|(_, v)| v)
                .collect();
            return Some(filtered);
        }
        let var_end = find_var_name_end(expr);
        if var_end > 0 && var_end < expr.len() {
            let var = &expr[..var_end];
            let op_rest = &expr[var_end..];
            if (var == "@" || var.ends_with("[@]"))
                && let Some(elems) = lookup_array_elements(var, env, pos_args)
            {
                if let Some(pat_raw) = op_rest.strip_prefix("##") {
                    let pat = expand_nested_operand(pat_raw, env, 0, pos_args).unwrap_or_default();
                    return Some(elems.iter().map(|e| strip_prefix_glob(e, &pat, true)).collect());
                }
                if let Some(pat_raw) = op_rest.strip_prefix('#') {
                    let pat = expand_nested_operand(pat_raw, env, 0, pos_args).unwrap_or_default();
                    return Some(elems.iter().map(|e| strip_prefix_glob(e, &pat, false)).collect());
                }
                if let Some(pat_raw) = op_rest.strip_prefix("%%") {
                    let pat = expand_nested_operand(pat_raw, env, 0, pos_args).unwrap_or_default();
                    return Some(elems.iter().map(|e| strip_suffix_glob(e, &pat, true)).collect());
                }
                if let Some(pat_raw) = op_rest.strip_prefix('%') {
                    let pat = expand_nested_operand(pat_raw, env, 0, pos_args).unwrap_or_default();
                    return Some(elems.iter().map(|e| strip_suffix_glob(e, &pat, false)).collect());
                }
                if let Some(rest) = op_rest.strip_prefix("//") {
                    let (pat_raw, rep_raw) = split_first_unescaped_slash(rest);
                    let pat = expand_nested_operand(pat_raw, env, 0, pos_args).unwrap_or_default();
                    let rep = expand_nested_operand(rep_raw, env, 0, pos_args).unwrap_or_default();
                    return Some(elems.iter().map(|e| replace_glob_pattern(e, &pat, &rep, true)).collect());
                }
                if let Some(rest) = op_rest.strip_prefix('/') {
                    let (pat_raw, rep_raw) = split_first_unescaped_slash(rest);
                    let pat = expand_nested_operand(pat_raw, env, 0, pos_args).unwrap_or_default();
                    let rep = expand_nested_operand(rep_raw, env, 0, pos_args).unwrap_or_default();
                    return Some(elems.iter().map(|e| replace_glob_pattern(e, &pat, &rep, false)).collect());
                }
                if let Some(pat) = op_rest.strip_prefix("^^") {
                    let p = if pat.is_empty() { None } else { Some(pat) };
                    return Some(elems.iter().map(|e| bash_uppercase(e, p, true)).collect());
                }
                if let Some(pat) = op_rest.strip_prefix('^') {
                    let p = if pat.is_empty() { None } else { Some(pat) };
                    return Some(elems.iter().map(|e| bash_uppercase(e, p, false)).collect());
                }
                if let Some(pat) = op_rest.strip_prefix(",,") {
                    let p = if pat.is_empty() { None } else { Some(pat) };
                    return Some(elems.iter().map(|e| bash_lowercase(e, p, true)).collect());
                }
                if let Some(pat) = op_rest.strip_prefix(',') {
                    let p = if pat.is_empty() { None } else { Some(pat) };
                    return Some(elems.iter().map(|e| bash_lowercase(e, p, false)).collect());
                }
                if let Some(op) = op_rest.strip_prefix('@') {
                    match op {
                        "Q" => return Some(elems.iter().map(|e| bash_quote_value(e)).collect()),
                        "U" => return Some(elems.iter().map(|e| e.to_uppercase()).collect()),
                        "u" => {
                            return Some(
                                elems
                                    .iter()
                                    .map(|e| {
                                        let mut c = e.chars();
                                        match c.next() {
                                            Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                                            None => String::new(),
                                        }
                                    })
                                    .collect(),
                            )
                        }
                        "L" => return Some(elems.iter().map(|e| e.to_lowercase()).collect()),
                        _ => {}
                    }
                }
            }
        }
    }
    None
}

fn last_exit_or_pos(pos_args: &[String]) -> &[String] {
    pos_args
}

fn find_var_name_end(expr: &str) -> usize {
    let bytes = expr.as_bytes();
    if bytes.is_empty() {
        return 0;
    }
    if matches!(bytes[0], b'@' | b'*' | b'?' | b'#') {
        return 1;
    }
    let mut i = 0usize;
    while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
        i += 1;
    }
    if i < bytes.len() && bytes[i] == b'[' {
        i += 1;
        let mut depth = 1usize;
        while i < bytes.len() && depth > 0 {
            if bytes[i] == b'[' {
                depth += 1;
            } else if bytes[i] == b']' {
                depth -= 1;
            }
            i += 1;
        }
    }
    i
}

fn is_var_set(name: &str, env: &BTreeMap<String, String>, pos_args: &[String]) -> bool {
    if name == "BASH_SUBSHELL" {
        return true;
    }
    if let Ok(idx) = name.parse::<usize>()
        && idx >= 1
    {
        return idx <= pos_args.len();
    }
    if name == "@" || name == "*" {
        return !pos_args.is_empty();
    }
    let resolved = resolve_var_key_for_lookup(name, env);
    env.contains_key(&resolved) || env.contains_key(&format!("{resolved}[0]"))
}

fn expand_nested_operand(
    raw: &str,
    env: &mut BTreeMap<String, String>,
    last_exit: i32,
    pos_args: &[String],
) -> Result<String, String> {
    let in_dquote = env.get("__in_dquote").map(|v| v == "1").unwrap_or(false);
    let chars: Vec<char> = raw.chars().collect();
    let mut i = 0usize;
    let mut out = String::new();
    while i < chars.len() {
        let c = chars[i];
        if c == '"' {
            i += 1;
            while i < chars.len() && chars[i] != '"' {
                if chars[i] == '\\' && i + 1 < chars.len() {
                    out.push(chars[i + 1]);
                    i += 2;
                    continue;
                }
                if chars[i] == '$' {
                    out.push_str(&expand_nested_dollar(&chars, &mut i, env, last_exit, pos_args)?);
                    continue;
                }
                out.push(chars[i]);
                i += 1;
            }
            if i < chars.len() {
                i += 1;
            }
        } else if c == '\'' && !in_dquote {
            i += 1;
            while i < chars.len() && chars[i] != '\'' {
                out.push(chars[i]);
                i += 1;
            }
            if i < chars.len() {
                i += 1;
            }
        } else if c == '\\' && i + 1 < chars.len() {
            out.push(chars[i + 1]);
            i += 2;
        } else if c == '$' {
            out.push_str(&expand_nested_dollar(&chars, &mut i, env, last_exit, pos_args)?);
        } else {
            out.push(c);
            i += 1;
        }
    }
    Ok(out)
}

fn expand_nested_dollar(
    chars: &[char],
    i: &mut usize,
    env: &mut BTreeMap<String, String>,
    last_exit: i32,
    pos_args: &[String],
) -> Result<String, String> {
    *i += 1;
    if *i >= chars.len() {
        return Ok("$".to_string());
    }
    if chars[*i] == '{' {
        *i += 1;
        let mut depth = 1usize;
        let mut inner = String::new();
        while *i < chars.len() && depth > 0 {
            if chars[*i] == '{' {
                depth += 1;
            } else if chars[*i] == '}' {
                depth -= 1;
                if depth == 0 {
                    *i += 1;
                    break;
                }
            }
            inner.push(chars[*i]);
            *i += 1;
        }
        return expand_parameter_expr(&inner, env, last_exit, pos_args);
    }
    let mut name = String::new();
    while *i < chars.len() && (chars[*i].is_ascii_alphanumeric() || chars[*i] == '_') {
        name.push(chars[*i]);
        *i += 1;
    }
    Ok(lookup_var(&name, env, last_exit, pos_args))
}

fn replace_glob_pattern(val: &str, pat: &str, rep: &str, global: bool) -> String {
    if pat.is_empty() {
        return val.to_string();
    }
    if let Some(anch) = pat.strip_prefix('#') {
        let chars: Vec<char> = val.chars().collect();
        for i in (0..=chars.len()).rev() {
            let prefix: String = chars[..i].iter().collect();
            if glob_match(anch, &prefix) {
                let rest: String = chars[i..].iter().collect();
                return format!("{rep}{rest}");
            }
        }
        return val.to_string();
    }
    if let Some(anch) = pat.strip_prefix('%') {
        let chars: Vec<char> = val.chars().collect();
        for i in 0..=chars.len() {
            let suffix: String = chars[i..].iter().collect();
            if glob_match(anch, &suffix) {
                let head: String = chars[..i].iter().collect();
                return format!("{head}{rep}");
            }
        }
        return val.to_string();
    }
    if !has_glob_meta(pat) {
        return if global {
            val.replace(pat, rep)
        } else {
            val.replacen(pat, rep, 1)
        };
    }
    let chars: Vec<char> = val.chars().collect();
    let mut out = String::new();
    let mut idx = 0usize;
    while idx < chars.len() {
        let mut matched_end = None;
        for end in (idx + 1..=chars.len()).rev() {
            let sub: String = chars[idx..end].iter().collect();
            if glob_match(pat, &sub) {
                matched_end = Some(end);
                break;
            }
        }
        if let Some(end) = matched_end {
            out.push_str(rep);
            idx = end;
            if !global {
                let tail: String = chars[idx..].iter().collect();
                out.push_str(&tail);
                return out;
            }
        } else {
            out.push(chars[idx]);
            idx += 1;
        }
    }
    out
}

pub fn resolve_nameref_base<'a>(base: &'a str, env: &'a BTreeMap<String, String>) -> &'a str {
    let mut cur = base;
    for _ in 0..8 {
        if let Some(target) = env.get(&format!("__nameref__{cur}")) {
            cur = target.as_str();
        } else {
            break;
        }
    }
    cur
}



pub fn bash_quote_value(val: &str) -> String {
    if val.chars().any(|c| c == '\n' || c == '\t' || c == '\r' || (c as u32) < 0x20 || (c as u32) == 0x7f) {
        let mut out = String::new();
        out.push('$');
        out.push('\'');
        for c in val.chars() {
            match c {
                '\n' => out.push_str("\\n"),
                '\t' => out.push_str("\\t"),
                '\r' => out.push_str("\\r"),
                '\\' => out.push_str("\\\\"),
                '\'' => out.push_str("\\'"),
                c if (c as u32) < 0x20 || (c as u32) == 0x7f => {
                    out.push_str(&format!("\\x{:02x}", c as u32));
                }
                _ => out.push(c),
            }
        }
        out.push('\'');
        out
    } else {
        format!("'{}'", val.replace('\'', "'\\''"))
    }
}

fn split_first_unescaped_slash(s: &str) -> (&str, &str) {
    let bytes = s.as_bytes();
    let mut i = 0usize;
    let mut in_sq = false;
    let mut in_dq = false;
    while i < bytes.len() {
        let b = bytes[i];
        if in_sq {
            if b == b'\'' {
                in_sq = false;
            }
            i += 1;
            continue;
        }
        if in_dq {
            if b == b'\\' && i + 1 < bytes.len() {
                i += 2;
                continue;
            }
            if b == b'"' {
                in_dq = false;
            }
            i += 1;
            continue;
        }
        if b == b'\\' && i + 1 < bytes.len() {
            i += 2;
            continue;
        }
        if b == b'\'' {
            in_sq = true;
            i += 1;
            continue;
        }
        if b == b'"' {
            in_dq = true;
            i += 1;
            continue;
        }
        if b == b'/' {
            return (&s[..i], &s[i + 1..]);
        }
        i += 1;
    }
    (s, "")
}

fn lookup_array_elements(
    var: &str,
    env: &BTreeMap<String, String>,
    pos_args: &[String],
) -> Option<Vec<String>> {
    if var == "@" || var == "*" {
        return Some(pos_args.to_vec());
    }
    let arr_base = var.strip_suffix("[@]").or_else(|| var.strip_suffix("[*]"))?;
    let resolved = resolve_nameref_base(arr_base, env);
    let prefix = format!("{resolved}[");
    let is_assoc = env
        .get(&format!("__assoc__{resolved}"))
        .map(|v| v == "1")
        .unwrap_or(false);
    let mut entries: Vec<(String, String)> = env
        .iter()
        .filter_map(|(k, v)| {
            k.strip_prefix(&prefix)
                .and_then(|s| s.strip_suffix(']'))
                .filter(|&sub| !matches!(sub, "@" | "*" | "#"))
                .map(|sub| (sub.to_string(), v.clone()))
        })
        .collect();
    if !is_assoc {
        entries.sort_by_key(|(k, _)| k.parse::<i64>().unwrap_or(0));
    }
    Some(entries.into_iter().map(|(_, v)| v).collect())
}

fn resolve_var_key_for_lookup(name: &str, env: &BTreeMap<String, String>) -> String {
    if let Some((base, sub_rest)) = name.split_once('[')
        && let Some(raw_sub) = sub_rest.strip_suffix(']')
    {
        let resolved_base = resolve_nameref_base(base, env);
        let unq = raw_sub.trim_matches('"').trim_matches('\'');
        let clean_sub = if let Some(var_name) = unq.strip_prefix('$') {
            let vn = var_name
                .strip_prefix('{')
                .and_then(|s| s.strip_suffix('}'))
                .unwrap_or(var_name);
            env.get(vn).cloned().unwrap_or_default()
        } else {
            unq.to_string()
        };
        let is_assoc = env
            .get(&format!("__assoc__{resolved_base}"))
            .map(|v| v == "1")
            .unwrap_or(false);
        if !is_assoc && !matches!(clean_sub.as_str(), "@" | "*" | "#") && !clean_sub.is_empty() {
            let idx = if let Ok(n) = clean_sub.parse::<i64>() {
                n
            } else {
                let mut tmp = env.clone();
                eval_arith(&clean_sub, &mut tmp).unwrap_or(0)
            };
            let final_idx = if idx < 0 {
                let prefix = format!("{resolved_base}[");
                let max_idx = env
                    .keys()
                    .filter_map(|k| {
                        k.strip_prefix(&prefix)
                            .and_then(|s| s.strip_suffix(']'))
                            .and_then(|sub| sub.parse::<i64>().ok())
                    })
                    .max()
                    .unwrap_or(-1);
                max_idx + 1 + idx
            } else {
                idx
            };
            return format!("{resolved_base}[{final_idx}]");
        }
        return format!("{resolved_base}[{clean_sub}]");
    }
    resolve_nameref_base(name, env).to_string()
}


pub fn lookup_var(
    name: &str,
    env: &BTreeMap<String, String>,
    last_exit: i32,
    pos_args: &[String],
) -> String {
    if name == "BASH_SUBSHELL" {
        return env
            .get("BASH_SUBSHELL")
            .cloned()
            .unwrap_or_else(|| "0".to_string());
    }
    if name == "?" {
        return last_exit.to_string();
    }
    if name == "#" {
        return pos_args.len().to_string();
    }
    if name == "@" || name == "*" {
        if name == "*" {
            let sep = env
                .get("IFS")
                .and_then(|s| s.chars().next())
                .map(|c| c.to_string())
                .unwrap_or_else(|| {
                    if env.contains_key("IFS") {
                        String::new()
                    } else {
                        " ".to_string()
                    }
                });
            return pos_args.join(&sep);
        }
        return pos_args.join(" ");
    }
    if let Ok(idx) = name.parse::<usize>()
        && idx >= 1
    {
        return pos_args.get(idx - 1).cloned().unwrap_or_default();
    }
    if let Some(arr_base) = name.strip_suffix("[@]").or_else(|| name.strip_suffix("[*]")) {
        let is_star = name.ends_with("[*]");
        let resolved = resolve_nameref_base(arr_base, env);
        let prefix = format!("{resolved}[");
        let is_assoc = env
            .get(&format!("__assoc__{resolved}"))
            .map(|v| v == "1")
            .unwrap_or(false);
        let mut entries: Vec<(String, String)> = env
            .iter()
            .filter_map(|(k, v)| {
                k.strip_prefix(&prefix)
                    .and_then(|s| s.strip_suffix(']'))
                    .filter(|&sub| !matches!(sub, "@" | "*" | "#"))
                    .map(|sub| (sub.to_string(), v.clone()))
            })
            .collect();
        if !is_assoc {
            entries.sort_by_key(|(k, _)| k.parse::<i64>().unwrap_or(0));
        }
        if entries.is_empty() {
            return env.get(&format!("{resolved}[*]")).cloned().unwrap_or_default();
        }
        let vals: Vec<String> = entries.into_iter().map(|(_, v)| v).collect();
        if is_star {
            let sep = env
                .get("IFS")
                .and_then(|s| s.chars().next())
                .map(|c| c.to_string())
                .unwrap_or_else(|| {
                    if env.contains_key("IFS") {
                        String::new()
                    } else {
                        " ".to_string()
                    }
                });
            return vals.join(&sep);
        }
        return vals.join(" ");
    }
    let key = resolve_var_key_for_lookup(name, env);
    env.get(&key)
        .or_else(|| env.get(&format!("{key}[0]")))
        .cloned()
        .unwrap_or_default()
}

fn strip_prefix_glob(val: &str, pat: &str, longest: bool) -> String {
    let chars: Vec<char> = val.chars().collect();
    if longest {
        for i in (0..=chars.len()).rev() {
            let prefix: String = chars[..i].iter().collect();
            if glob_match(pat, &prefix) {
                return chars[i..].iter().collect();
            }
        }
    } else {
        for i in 0..=chars.len() {
            let prefix: String = chars[..i].iter().collect();
            if glob_match(pat, &prefix) {
                return chars[i..].iter().collect();
            }
        }
    }
    val.to_string()
}

fn strip_suffix_glob(val: &str, pat: &str, longest: bool) -> String {
    let chars: Vec<char> = val.chars().collect();
    if longest {
        for i in 0..=chars.len() {
            let suffix: String = chars[i..].iter().collect();
            if glob_match(pat, &suffix) {
                return chars[..i].iter().collect();
            }
        }
    } else {
        for i in (0..=chars.len()).rev() {
            let suffix: String = chars[i..].iter().collect();
            if glob_match(pat, &suffix) {
                return chars[..i].iter().collect();
            }
        }
    }
    val.to_string()
}

pub fn has_glob_meta(word: &str) -> bool {
    word.contains('*')
        || word.contains('?')
        || word.contains('[')
        || word.contains("@(")
        || word.contains("+(")
        || word.contains("!(")
        || word.contains("?(")
        || word.contains("*(")
}

pub fn expand_globs_in_word(
    word: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
    env: &BTreeMap<String, String>,
) -> Vec<String> {
    if !has_glob_meta(word) {
        return vec![word.to_string()];
    }
    let dotglob = env.get("__shopt_dotglob").map(|v| v == "1").unwrap_or(false);
    let nullglob = env.get("__shopt_nullglob").map(|v| v == "1").unwrap_or(false);
    let nocaseglob = env.get("__shopt_nocaseglob").map(|v| v == "1").unwrap_or(false);
    let globstar = env.get("__shopt_globstar").map(|v| v == "1").unwrap_or(false);

    let is_abs = word.starts_with('/');
    let trimmed = if is_abs { &word[1..] } else { word };
    let segments: Vec<&str> = trimmed.split('/').collect();
    let root_dir = if is_abs { "/" } else { cwd };
    let root_prefix = if is_abs { "/" } else { "" };

    let mut matched = Vec::new();
    expand_glob_segments(
        &segments,
        0,
        root_dir,
        root_prefix,
        fs,
        dotglob,
        nocaseglob,
        globstar,
        &mut matched,
    );
    matched.sort();
    matched.dedup();

    if matched.is_empty() {
        if nullglob {
            Vec::new()
        } else {
            vec![word.to_string()]
        }
    } else {
        matched
    }
}

fn expand_glob_segments(
    segments: &[&str],
    seg_idx: usize,
    cur_dir: &str,
    cur_prefix: &str,
    fs: &dyn SafeBashFs,
    dotglob: bool,
    nocaseglob: bool,
    globstar: bool,
    matched: &mut Vec<String>,
) {
    if seg_idx >= segments.len() {
        return;
    }
    let seg = segments[seg_idx];
    let is_last = seg_idx + 1 == segments.len();

    if globstar && seg == "**" {
        if !is_last {
            expand_glob_segments(
                segments,
                seg_idx + 1,
                cur_dir,
                cur_prefix,
                fs,
                dotglob,
                nocaseglob,
                globstar,
                matched,
            );
        }
        let Ok(mut entries) = fs.list_dir(cur_dir) else {
            return;
        };
        entries.sort();
        for entry in entries {
            if entry.starts_with('.') && !dotglob {
                continue;
            }
            let child_dir = resolve_posix_path(cur_dir, &entry);
            let child_prefix = if cur_prefix.is_empty() {
                entry.clone()
            } else if cur_prefix == "/" {
                format!("/{entry}")
            } else {
                format!("{cur_prefix}/{entry}")
            };
            if is_last {
                matched.push(child_prefix.clone());
            }
            if fs.is_dir(&child_dir) {
                expand_glob_segments(
                    segments,
                    seg_idx,
                    &child_dir,
                    &child_prefix,
                    fs,
                    dotglob,
                    nocaseglob,
                    globstar,
                    matched,
                );
            }
        }
        return;
    }

    if !has_glob_meta(seg) {
        let next_dir = resolve_posix_path(cur_dir, seg);
        let next_prefix = if cur_prefix.is_empty() {
            seg.to_string()
        } else if cur_prefix == "/" {
            format!("/{seg}")
        } else {
            format!("{cur_prefix}/{seg}")
        };
        if is_last {
            if fs.exists(&next_dir) {
                matched.push(next_prefix);
            }
        } else if fs.is_dir(&next_dir) {
            expand_glob_segments(
                segments,
                seg_idx + 1,
                &next_dir,
                &next_prefix,
                fs,
                dotglob,
                nocaseglob,
                globstar,
                matched,
            );
        }
        return;
    }

    let Ok(mut entries) = fs.list_dir(cur_dir) else {
        return;
    };
    entries.sort();
    for entry in entries {
        if entry.starts_with('.') && !seg.starts_with('.') && !dotglob {
            continue;
        }
        if glob_match_ext(seg, &entry, nocaseglob) {
            let child_dir = resolve_posix_path(cur_dir, &entry);
            let child_prefix = if cur_prefix.is_empty() {
                entry.clone()
            } else if cur_prefix == "/" {
                format!("/{entry}")
            } else {
                format!("{cur_prefix}/{entry}")
            };
            if is_last {
                matched.push(child_prefix);
            } else if fs.is_dir(&child_dir) {
                expand_glob_segments(
                    segments,
                    seg_idx + 1,
                    &child_dir,
                    &child_prefix,
                    fs,
                    dotglob,
                    nocaseglob,
                    globstar,
                    matched,
                );
            }
        }
    }
}

fn bash_uppercase(s: &str, pat: Option<&str>, all: bool) -> String {
    let mut out = String::new();
    for (idx, ch) in s.chars().enumerate() {
        if !all && idx > 0 {
            out.push(ch);
            continue;
        }
        let should = match pat {
            Some(p) => glob_match(p, &ch.to_string()),
            None => true,
        };
        if should {
            if ch == 'ß' {
                out.push('ß');
            } else {
                for uc in ch.to_uppercase() {
                    out.push(uc);
                }
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn bash_lowercase(s: &str, pat: Option<&str>, all: bool) -> String {
    let mut out = String::new();
    for (idx, ch) in s.chars().enumerate() {
        if !all && idx > 0 {
            out.push(ch);
            continue;
        }
        let should = match pat {
            Some(p) => glob_match(p, &ch.to_string()),
            None => true,
        };
        if should {
            if ch == 'İ' {
                out.push('i');
            } else {
                for lc in ch.to_lowercase() {
                    out.push(lc);
                }
            }
        } else {
            out.push(ch);
        }
    }
    out
}
