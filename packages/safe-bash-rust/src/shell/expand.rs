use crate::vfs::{SafeBashFs, resolve_posix_path};
use std::collections::{BTreeMap, BTreeSet};

pub fn glob_match(pattern: &str, text: &str) -> bool {
    glob_match_full(pattern, text, false, true)
}

pub fn glob_match_ext(pattern: &str, text: &str, nocase: bool) -> bool {
    glob_match_full(pattern, text, nocase, true)
}

pub fn glob_match_full(pattern: &str, text: &str, nocase: bool, extglob: bool) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    glob_match_slice(&p, &t, nocase, extglob)
}

fn chars_eq(a: char, b: char, nocase: bool) -> bool {
    if nocase {
        a.to_ascii_lowercase() == b.to_ascii_lowercase()
    } else {
        a == b
    }
}

fn skip_bracket_in_pattern(p: &[char], open_bracket_idx: usize) -> Option<usize> {
    let mut i = open_bracket_idx + 1;
    if i < p.len() && matches!(p[i], '!' | '^') {
        i += 1;
    }
    if i < p.len() && p[i] == ']' {
        i += 1;
    }
    while i < p.len() {
        if p[i] == '\\' && i + 1 < p.len() {
            i += 2;
            continue;
        }
        if p[i] == '[' && p.get(i + 1) == Some(&':') {
            let mut j = i + 2;
            while j + 1 < p.len() && !(p[j] == ':' && p[j + 1] == ']') {
                j += 1;
            }
            if j + 1 < p.len() {
                i = j + 2;
                continue;
            }
        }
        if p[i] == ']' {
            return Some(i + 1);
        }
        i += 1;
    }
    None
}

fn find_extglob_close(p: &[char], open_paren_idx: usize) -> Option<usize> {
    let mut depth = 0i32;
    let mut i = open_paren_idx;
    while i < p.len() {
        if p[i] == '\\' && i + 1 < p.len() {
            i += 2;
            continue;
        }
        if p[i] == '[' && i > open_paren_idx {
            if let Some(next_i) = skip_bracket_in_pattern(p, i) {
                i = next_i;
                continue;
            }
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
        if c == '[' {
            if let Some(next_i) = skip_bracket_in_pattern(slice, i) {
                cur.extend_from_slice(&slice[i..next_i]);
                i = next_i;
                continue;
            }
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

fn match_extglob_plus(
    alts: &[Vec<char>],
    rest_p: &[char],
    t: &[char],
    nocase: bool,
    extglob: bool,
) -> bool {
    for split in 1..=t.len() {
        let prefix = &t[..split];
        if alts
            .iter()
            .any(|alt| glob_match_slice(alt, prefix, nocase, extglob))
        {
            if glob_match_slice(rest_p, &t[split..], nocase, extglob)
                || match_extglob_plus(alts, rest_p, &t[split..], nocase, extglob)
            {
                return true;
            }
        }
    }
    false
}

fn glob_match_slice(p: &[char], t: &[char], nocase: bool, extglob: bool) -> bool {
    let mut pi = 0usize;
    let mut ti = 0usize;
    let mut star_pi: Option<usize> = None;
    let mut star_ti = 0usize;

    while ti < t.len() || pi < p.len() {
        if extglob
            && pi + 1 < p.len()
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
                    alts.iter()
                        .any(|a| glob_match_slice(a, &rem_t[..k], nocase, extglob))
                        && glob_match_slice(rest_p, &rem_t[k..], nocase, extglob)
                }),
                '?' => {
                    glob_match_slice(rest_p, rem_t, nocase, extglob)
                        || (0..=rem_t.len()).any(|k| {
                            alts.iter()
                                .any(|a| glob_match_slice(a, &rem_t[..k], nocase, extglob))
                                && glob_match_slice(rest_p, &rem_t[k..], nocase, extglob)
                        })
                }
                '+' => match_extglob_plus(&alts, rest_p, rem_t, nocase, extglob),
                '*' => {
                    glob_match_slice(rest_p, rem_t, nocase, extglob)
                        || match_extglob_plus(&alts, rest_p, rem_t, nocase, extglob)
                }
                '!' => (0..=rem_t.len()).any(|k| {
                    !alts
                        .iter()
                        .any(|a| glob_match_slice(a, &rem_t[..k], nocase, extglob))
                        && glob_match_slice(rest_p, &rem_t[k..], nocase, extglob)
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
                match match_bracket(&p[pi..], t[ti], nocase) {
                    Some((true, next_pi)) => {
                        pi += next_pi;
                        ti += 1;
                        continue;
                    }
                    Some((false, _)) => {}
                    None => {
                        if chars_eq('[', t[ti], nocase) {
                            pi += 1;
                            ti += 1;
                            continue;
                        }
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
    let mut invalid_class = false;
    let mut first = true;
    while idx < p.len() && (first || p[idx] != ']') {
        first = false;
        if idx + 1 < p.len() && p[idx] == '[' && p[idx + 1] == ':' {
            let mut end_col = idx + 2;
            while end_col + 1 < p.len() && !(p[end_col] == ':' && p[end_col + 1] == ']') {
                end_col += 1;
            }
            if end_col + 1 < p.len() {
                let cls: String = p[idx + 2..end_col].iter().collect();
                let cls_match = match cls.as_str() {
                    "space" => Some(ch.is_ascii_whitespace()),
                    "blank" => Some(ch == ' ' || ch == '\t'),
                    "digit" => Some(ch.is_ascii_digit()),
                    "alpha" => Some(ch.is_ascii_alphabetic()),
                    "alnum" => Some(ch.is_ascii_alphanumeric()),
                    "ascii" => Some(ch.is_ascii()),
                    "word" => Some(ch.is_ascii_alphanumeric() || ch == '_'),
                    "upper" => Some(ch.is_ascii_uppercase() || (nocase && ch.is_ascii_alphabetic())),
                    "lower" => Some(ch.is_ascii_lowercase() || (nocase && ch.is_ascii_alphabetic())),
                    "xdigit" => Some(ch.is_ascii_hexdigit()),
                    "punct" => Some(ch.is_ascii_punctuation()),
                    "cntrl" => Some(ch.is_ascii_control()),
                    "graph" => Some(ch.is_ascii_graphic()),
                    "print" => Some(ch == ' ' || ch.is_ascii_graphic()),
                    _ => None,
                };
                match cls_match {
                    Some(true) => matched = true,
                    Some(false) => {}
                    None => invalid_class = true,
                }
                idx = end_col + 2;
                continue;
            }
        }
        let (cur_ch, next_idx) = if p[idx] == '\\' && idx + 1 < p.len() {
            (p[idx + 1], idx + 2)
        } else {
            (p[idx], idx + 1)
        };
        let next_is_posix_class =
            p.get(next_idx + 1) == Some(&'[') && p.get(next_idx + 2) == Some(&':');
        if next_idx + 1 < p.len()
            && p[next_idx] == '-'
            && p[next_idx + 1] != ']'
            && !next_is_posix_class
        {
            let (end_raw, after_end) = if p[next_idx + 1] == '\\' && next_idx + 2 < p.len() {
                (p[next_idx + 2], next_idx + 3)
            } else {
                (p[next_idx + 1], next_idx + 2)
            };
            if cur_ch <= end_raw {
                let in_range = (ch >= cur_ch && ch <= end_raw)
                    || (nocase
                        && ((ch.to_ascii_lowercase() >= cur_ch
                            && ch.to_ascii_lowercase() <= end_raw)
                            || (ch.to_ascii_uppercase() >= cur_ch
                                && ch.to_ascii_uppercase() <= end_raw)));
                if in_range {
                    matched = true;
                }
            }
            idx = after_end;
        } else {
            if chars_eq(cur_ch, ch, nocase) {
                matched = true;
            }
            idx = next_idx;
        }
    }
    if idx < p.len() && p[idx] == ']' {
        if invalid_class {
            Some((false, idx + 1))
        } else {
            Some((if negate { !matched } else { matched }, idx + 1))
        }
    } else {
        None
    }
}

pub fn decode_ansi_c_escapes(input: &str) -> String {
    decode_c_escapes_inner(input, false, true)
}

pub fn decode_echo_b_escapes(input: &str) -> String {
    decode_c_escapes_inner(input, true, false)
}

pub fn decode_printf_escapes(input: &str) -> String {
    decode_c_escapes_inner(input, false, false)
}

fn decode_c_escapes_inner(
    input: &str,
    leading_zero_octal: bool,
    truncate_on_nul: bool,
) -> String {
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
                Some('?') => out_bytes.push(b'?'),
                Some('c') => {
                    if let Some(ctrl) = chars.next() {
                        if ctrl == '\\' && chars.peek() == Some(&'\\') {
                            chars.next();
                        }
                        let b = if ctrl == '?' { 0x7f } else { (ctrl as u8) & 0x1f };
                        if b == 0 && truncate_on_nul {
                            break;
                        }
                        out_bytes.push(b);
                    } else {
                        out_bytes.push(b'\\');
                        out_bytes.push(b'c');
                    }
                }
                Some('x') => {
                    let mut hex = String::new();
                    for _ in 0..2 {
                        if let Some(&hc) = chars.peek()
                            && hc.is_ascii_hexdigit()
                        {
                            hex.push(chars.next().unwrap());
                        }
                    }
                    if hex.is_empty() {
                        out_bytes.push(b'\\');
                        out_bytes.push(b'x');
                    } else if let Ok(val) = u8::from_str_radix(&hex, 16) {
                        if val == 0 && truncate_on_nul {
                            break;
                        }
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
                    if hex.is_empty() {
                        out_bytes.push(b'\\');
                        out_bytes.push(b'u');
                    } else if let Ok(val) = u32::from_str_radix(&hex, 16) {
                        if val == 0 && truncate_on_nul {
                            break;
                        }
                        if let Some(ch) = char::from_u32(val) {
                            push_char(&mut out_bytes, ch);
                        }
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
                    if hex.is_empty() {
                        out_bytes.push(b'\\');
                        out_bytes.push(b'U');
                    } else if let Ok(val) = u32::from_str_radix(&hex, 16) {
                        if val == 0 && truncate_on_nul {
                            break;
                        }
                        if let Some(ch) = char::from_u32(val) {
                            push_char(&mut out_bytes, ch);
                        }
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
                        let b = (val & 0xff) as u8;
                        if b == 0 && truncate_on_nul {
                            break;
                        }
                        out_bytes.push(b);
                    }
                }
                Some(other) => {
                    out_bytes.push(b'\\');
                    push_char(&mut out_bytes, other);
                }
                None => out_bytes.push(b'\\'),
            }
        } else {
            if c == '\0' && truncate_on_nul {
                break;
            }
            push_char(&mut out_bytes, c);
        }
    }
    crate::vfs::bytes_to_stream_string(&out_bytes)
}

pub fn eval_arith(expr: &str, env: &mut BTreeMap<String, String>) -> Result<i64, String> {
    let mut visiting = BTreeSet::new();
    eval_arith_with_visiting(expr, env, &mut visiting)
}

fn eval_arith_with_visiting(
    expr: &str,
    env: &mut BTreeMap<String, String>,
    visiting: &mut BTreeSet<String>,
) -> Result<i64, String> {
    let joined = expr.replace("\\\n", "");
    let trimmed = joined.trim();
    if trimmed.is_empty() {
        return Ok(0);
    }
    let tokens = tokenize_arith(trimmed, env)?;
    if tokens.is_empty() {
        return Ok(0);
    }
    let mut pos = 0usize;
    let ast = parse_arith_expr(&tokens, &mut pos, 1)?;
    if pos < tokens.len() {
        return Err(format!("Unexpected arithmetic token {:?}", tokens[pos]));
    }
    eval_arith_ast(&ast, env, visiting)
}

fn parse_js_int10(value: &str) -> i64 {
    let s = value.trim_start();
    if s.is_empty() {
        return 0;
    }
    let (neg, rest) = if let Some(r) = s.strip_prefix('-') {
        (true, r)
    } else if let Some(r) = s.strip_prefix('+') {
        (false, r)
    } else {
        (false, s)
    };
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return 0;
    }
    let val = digits.parse::<i64>().unwrap_or(0);
    if neg { -val } else { val }
}

pub fn read_dynamic_random(env: &mut BTreeMap<String, String>) -> Option<String> {
    if env.get("__random_disabled").map(|v| v == "1").unwrap_or(false) {
        return env.get("RANDOM").cloned();
    }
    let cur_seed = env
        .get("__random_seed")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(1);
    let seed = (cur_seed.wrapping_mul(16807)) % 2147483647;
    env.insert("__random_seed".to_string(), seed.to_string());
    let val = (seed ^ (seed >> 16)) & 0x7fff;
    Some(val.to_string())
}

pub fn read_dynamic_seconds(env: &BTreeMap<String, String>) -> Option<String> {
    if env.get("__seconds_disabled").map(|v| v == "1").unwrap_or(false) {
        return env.get("SECONDS").cloned();
    }
    let origin_ms = env
        .get("__seconds_origin_ms")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    let now_ms = crate::commands::virtual_clock_elapsed_ms().floor() as i64;
    let secs = (now_ms - origin_ms).div_euclid(1000);
    Some(secs.to_string())
}

pub fn write_dynamic_variable(name: &str, value: &str, env: &mut BTreeMap<String, String>) -> bool {
    if name == "RANDOM" && !env.get("__random_disabled").map(|v| v == "1").unwrap_or(false) {
        let parsed = parse_js_int10(value) as i32;
        let u = parsed as u32 as u64;
        let seed = (u % 2147483647).max(1);
        env.insert("__random_seed".to_string(), seed.to_string());
        env.insert("RANDOM".to_string(), value.to_string());
        return true;
    }
    if name == "SECONDS" && !env.get("__seconds_disabled").map(|v| v == "1").unwrap_or(false) {
        let parsed = parse_js_int10(value);
        let now_ms = crate::commands::virtual_clock_elapsed_ms().floor() as i64;
        let origin = now_ms - parsed.saturating_mul(1000);
        env.insert("__seconds_origin_ms".to_string(), origin.to_string());
        env.insert("SECONDS".to_string(), value.to_string());
        return true;
    }
    false
}

pub fn ensure_dirstack_populated(env: &mut BTreeMap<String, String>) {
    let cwd = env.get("PWD").cloned().unwrap_or_else(|| "/".to_string());
    let tail: Vec<String> = env
        .get("__dirstack")
        .filter(|s| !s.is_empty())
        .map(|s| s.split('\x1f').map(|p| p.to_string()).collect())
        .unwrap_or_default();
    let old: Vec<String> = env
        .keys()
        .filter(|k| k.starts_with("DIRSTACK["))
        .cloned()
        .collect();
    for k in old {
        env.remove(&k);
    }
    env.insert("DIRSTACK[0]".to_string(), cwd);
    for (idx, d) in tail.iter().enumerate() {
        env.insert(format!("DIRSTACK[{}]", idx + 1), d.clone());
    }
    sync_array_metadata("DIRSTACK", env);
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ArithTok {
    Num(i64),
    Ident(String),
    Op(String),
    LParen,
    RParen,
}

fn parse_radix_literal(base: u32, digits: &str) -> Result<i64, String> {
    if !(2..=64).contains(&base) {
        return Err("Invalid arithmetic base".to_string());
    }
    if digits.is_empty() {
        return Err("Invalid arithmetic base".to_string());
    }
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
            return Err("Digit exceeds arithmetic base".to_string());
        };
        if d >= base {
            return Err("Digit exceeds arithmetic base".to_string());
        }
        acc = acc.wrapping_mul(base as i64).wrapping_add(d as i64);
    }
    Ok(acc)
}

fn parse_arith_number_token(num_s: &str) -> Result<i64, String> {
    if let Some((base_s, digits)) = num_s.split_once('#') {
        if base_s.is_empty() || !base_s.chars().all(|c| c.is_ascii_digit()) {
            return Err(format!("Invalid arithmetic constant: {num_s}"));
        }
        let base = base_s
            .parse::<u32>()
            .map_err(|_| "Invalid arithmetic base".to_string())?;
        return parse_radix_literal(base, digits);
    }
    if let Some(hex) = num_s
        .strip_prefix("0x")
        .or_else(|| num_s.strip_prefix("0X"))
    {
        if hex.is_empty() || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!("Invalid arithmetic constant: {num_s}"));
        }
        let mut acc: i64 = 0;
        for ch in hex.chars() {
            let d = ch.to_digit(16).unwrap_or(0) as i64;
            acc = acc.wrapping_mul(16).wrapping_add(d);
        }
        return Ok(acc);
    }
    if num_s.starts_with('0') && num_s.len() > 1 {
        if !num_s[1..].chars().all(|c| c.is_ascii_digit()) {
            return Err(format!("Invalid arithmetic constant: {num_s}"));
        }
        if !num_s[1..].chars().all(|c| ('0'..='7').contains(&c)) {
            return Err(format!("Invalid octal constant: {num_s}"));
        }
        let mut acc: i64 = 0;
        for ch in num_s[1..].chars() {
            let d = (ch as u8 - b'0') as i64;
            acc = acc.wrapping_mul(8).wrapping_add(d);
        }
        return Ok(acc);
    }
    if !num_s.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("Invalid arithmetic constant: {num_s}"));
    }
    let mut acc: i64 = 0;
    for ch in num_s.chars() {
        let d = (ch as u8 - b'0') as i64;
        acc = acc.wrapping_mul(10).wrapping_add(d);
    }
    Ok(acc)
}

fn tokenize_arith(expr: &str, env: &mut BTreeMap<String, String>) -> Result<Vec<ArithTok>, String> {
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
                let val = lookup_var(&name, env, 0, &[]);
                let val = if val.is_empty() { "0".to_string() } else { val };
                expanded.push_str(&val);
            } else {
                let mut name = String::new();
                while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                    name.push(chars[i]);
                    i += 1;
                }
                let val = lookup_var(&name, env, 0, &[]);
                let val = if val.is_empty() { "0".to_string() } else { val };
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
            let val = parse_arith_number_token(&num_s)?;
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
                if depth != 0 {
                    return Err("Unclosed arithmetic array subscript".to_string());
                }
                let clean_sub = sub.trim().trim_matches('"').trim_matches('\'');
                if clean_sub.is_empty() {
                    return Err("Empty arithmetic array subscript".to_string());
                }
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

pub fn sync_array_metadata(base: &str, env: &mut BTreeMap<String, String>) {
    let prefix = format!("{base}[");
    let mut entries: Vec<(String, String)> = Vec::new();
    for (k, v) in env.iter() {
        if let Some(rest) = k.strip_prefix(&prefix)
            && let Some(sub) = rest.strip_suffix(']')
            && !matches!(sub, "@" | "*" | "#")
        {
            entries.push((sub.to_string(), v.clone()));
        }
    }
    sort_array_entries(base, env, &mut entries);
    let mut keys: Vec<String> = Vec::with_capacity(entries.len());
    let mut vals: Vec<String> = Vec::with_capacity(entries.len());
    for (k, v) in entries {
        keys.push(k);
        vals.push(v);
    }
    let joined = vals.join(" ");
    env.insert(format!("{base}[#]"), vals.len().to_string());
    env.insert(format!("{base}[*]"), joined.clone());
    env.insert(format!("{base}[@]"), joined);
    env.insert(format!("__keys__{base}"), keys.join("\x1f"));
    if let Some(zero) = env.get(&format!("{base}[0]")).cloned() {
        env.insert(base.to_string(), zero);
    } else {
        env.remove(base);
    }
}

pub fn sort_array_entries(
    base: &str,
    env: &BTreeMap<String, String>,
    entries: &mut [(String, String)],
) {
    let is_assoc = env
        .get(&format!("__assoc__{base}"))
        .map(|v| v == "1")
        .unwrap_or(false)
        || env
            .get(&format!("__attr__{base}"))
            .is_some_and(|a| a.contains('A'));
    if !is_assoc {
        entries.sort_by_key(|(k, _)| k.parse::<i64>().unwrap_or(0));
    } else if let Some(order_str) = env.get(&format!("__keys__{base}")) {
        let order: Vec<&str> = if order_str.is_empty() {
            Vec::new()
        } else {
            order_str.split('\x1f').collect()
        };
        entries.sort_by_key(|(k, _)| {
            order
                .iter()
                .position(|&ok| ok == k.as_str())
                .unwrap_or(usize::MAX)
        });
    }
}

fn resolve_arith_var_resolved(
    orig_ref: &str,
    resolved: &str,
    env: &mut BTreeMap<String, String>,
    visiting: &mut BTreeSet<String>,
) -> Result<i64, String> {
    let base = resolved
        .split_once('[')
        .map(|(b, _)| b)
        .unwrap_or(resolved);
    let raw_opt = if resolved == "RANDOM" {
        read_dynamic_random(env)
    } else if resolved == "SECONDS" {
        read_dynamic_seconds(env)
    } else if resolved == "LINENO" {
        env.get("LINENO").or_else(|| env.get("__lineno")).cloned()
    } else if resolved == "_" {
        env.get("_").or_else(|| env.get("__last_arg")).cloned()
    } else if resolved == "$" || resolved == "BASHPID" {
        Some(env.get(resolved).cloned().unwrap_or_else(|| "1".to_string()))
    } else if resolved == "BASH_SUBSHELL" {
        Some(env.get("BASH_SUBSHELL").cloned().unwrap_or_else(|| "0".to_string()))
    } else {
        env.get(resolved).cloned().or_else(|| {
            if !resolved.contains('[') {
                env.get(&format!("{resolved}[0]")).cloned()
            } else if let Some(b) = resolved.strip_suffix("[0]")
                && !env.contains_key(&format!("{b}[#]"))
                && !env.contains_key(&format!("__assoc__{b}"))
            {
                env.get(b).cloned()
            } else {
                None
            }
        })
    };
    let Some(raw) = raw_opt else {
        if env.get("__set_nounset").map(|v| v == "1").unwrap_or(false) {
            return Err(format!("__nounset__{orig_ref}: unbound variable"));
        }
        return Ok(0);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(0);
    }
    if let Ok(n) = trimmed.parse::<i64>() {
        return Ok(n);
    }
    if visiting.contains(base) {
        return Err(format!("Arithmetic variable recursion: {base}"));
    }
    visiting.insert(base.to_string());
    let res = eval_arith_with_visiting(trimmed, env, visiting);
    visiting.remove(base);
    res
}

fn set_arith_var_resolved(
    resolved: String,
    val: i64,
    env: &mut BTreeMap<String, String>,
) -> Result<(), String> {
    let base = resolved
        .split_once('[')
        .map(|(b, _)| b)
        .unwrap_or(&resolved);
    if env
        .get(&format!("__attr__{base}"))
        .is_some_and(|a| a.contains('r'))
    {
        return Err(format!("{base}: readonly variable"));
    }
    let val_s = val.to_string();
    if write_dynamic_variable(&resolved, &val_s, env) {
        return Ok(());
    }
    if env.get("__set_allexport").map(|v| v == "1").unwrap_or(false) {
        let attr_key = format!("__attr__{base}");
        let mut attr = env.get(&attr_key).cloned().unwrap_or_default();
        if !attr.contains('x') {
            attr.push('x');
            env.insert(attr_key, attr);
        }
        env.remove(&format!("__unexported__{base}"));
    }
    let is_array = !resolved.contains('[')
        && (env.contains_key(&format!("{resolved}[#]"))
            || env.contains_key(&format!("__assoc__{resolved}"))
            || env
                .get(&format!("__attr__{resolved}"))
                .is_some_and(|a| a.contains('a') || a.contains('A')));
    if is_array {
        env.insert(format!("{resolved}[0]"), val_s);
        sync_array_metadata(&resolved, env);
        return Ok(());
    }
    env.insert(resolved.clone(), val_s);
    if resolved == "OPTIND" {
        sync_getopts_env(env);
    }
    if let Some((base, _)) = resolved.split_once('[') {
        sync_array_metadata(base, env);
    }
    Ok(())
}

pub fn decimal_index(value: &str) -> i32 {
    let bytes = value.as_bytes();
    let mut cursor = 0usize;
    while cursor < bytes.len()
        && matches!(bytes[cursor], b'\t' | b'\n' | 0x0b | 0x0c | b'\r' | b' ')
    {
        cursor += 1;
    }
    let mut sign = 1i32;
    if cursor < bytes.len() && (bytes[cursor] == b'+' || bytes[cursor] == b'-') {
        if bytes[cursor] == b'-' {
            sign = -1;
        }
        cursor += 1;
    }
    let mut parsed = 0i32;
    while cursor < bytes.len() && bytes[cursor].is_ascii_digit() {
        parsed = parsed
            .wrapping_mul(10)
            .wrapping_add((bytes[cursor] - b'0') as i32);
        cursor += 1;
    }
    parsed.wrapping_mul(sign)
}

pub fn sync_getopts_env(env: &mut BTreeMap<String, String>) {
    if let Some(val) = env.get("OPTIND").cloned() {
        let idx = decimal_index(&val);
        if idx <= 1 {
            env.insert("__getopts_index".to_string(), "0".to_string());
            env.remove("__getopts_active_arg");
            env.remove("__getopts_active_off");
        } else {
            env.insert("__getopts_index".to_string(), idx.to_string());
        }
    } else {
        env.insert("__getopts_int".to_string(), "0".to_string());
        env.insert("__getopts_index".to_string(), "0".to_string());
        env.remove("__getopts_active_arg");
        env.remove("__getopts_active_off");
    }
}

#[derive(Debug, Clone)]
enum ArithNode {
    Num(i64),
    Var(String),
    Unary {
        op: String,
        arg: Box<ArithNode>,
        prefix: bool,
    },
    Binary {
        op: String,
        left: Box<ArithNode>,
        right: Box<ArithNode>,
    },
    Ternary {
        cond: Box<ArithNode>,
        yes: Box<ArithNode>,
        no: Box<ArithNode>,
    },
    Assign {
        op: String,
        target: String,
        right: Box<ArithNode>,
    },
}

fn arith_op_info(op: &str) -> Option<(u8, bool)> {
    match op {
        "," => Some((1, false)),
        "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "<<=" | ">>=" | "&=" | "^=" | "|=" => {
            Some((2, true))
        }
        "?" => Some((3, true)),
        "||" => Some((4, false)),
        "&&" => Some((5, false)),
        "|" => Some((6, false)),
        "^" => Some((7, false)),
        "&" => Some((8, false)),
        "==" | "!=" => Some((9, false)),
        "<" | "<=" | ">" | ">=" => Some((10, false)),
        "<<" | ">>" => Some((11, false)),
        "+" | "-" => Some((12, false)),
        "*" | "/" | "%" => Some((13, false)),
        "**" => Some((14, true)),
        _ => None,
    }
}

fn is_arith_assign_op(op: &str) -> bool {
    matches!(
        op,
        "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "<<=" | ">>=" | "&=" | "^=" | "|="
    )
}

fn parse_arith_prefix(tokens: &[ArithTok], pos: &mut usize) -> Result<ArithNode, String> {
    let Some(tok) = tokens.get(*pos).cloned() else {
        return Err("Unexpected end of arithmetic expression".to_string());
    };
    match tok {
        ArithTok::Num(n) => {
            *pos += 1;
            Ok(ArithNode::Num(n))
        }
        ArithTok::Ident(name) => {
            *pos += 1;
            if let Some(ArithTok::Op(op)) = tokens.get(*pos)
                && (op == "++" || op == "--")
            {
                let op_s = op.clone();
                *pos += 1;
                return Ok(ArithNode::Unary {
                    op: op_s,
                    arg: Box::new(ArithNode::Var(name)),
                    prefix: false,
                });
            }
            Ok(ArithNode::Var(name))
        }
        ArithTok::LParen => {
            *pos += 1;
            if matches!(tokens.get(*pos), Some(ArithTok::RParen)) {
                return Err("Empty arithmetic parentheses".to_string());
            }
            let inner = parse_arith_expr(tokens, pos, 1)?;
            if !matches!(tokens.get(*pos), Some(ArithTok::RParen)) {
                return Err("Expected ')' in arithmetic expression".to_string());
            }
            *pos += 1;
            if let Some(ArithTok::Op(op)) = tokens.get(*pos)
                && (op == "++" || op == "--")
            {
                return Err("Arithmetic increment/decrement requires a variable".to_string());
            }
            Ok(inner)
        }
        ArithTok::Op(op) if matches!(op.as_str(), "+" | "-" | "!" | "~" | "++" | "--") => {
            *pos += 1;
            let arg = parse_arith_expr(tokens, pos, 15)?;
            if (op == "++" || op == "--") && !matches!(arg, ArithNode::Var(_)) {
                return Err("Arithmetic increment/decrement requires a variable".to_string());
            }
            Ok(ArithNode::Unary {
                op,
                arg: Box::new(arg),
                prefix: true,
            })
        }
        other => Err(format!("Unexpected arithmetic token {other:?}")),
    }
}

fn parse_arith_expr(
    tokens: &[ArithTok],
    pos: &mut usize,
    min_prec: u8,
) -> Result<ArithNode, String> {
    let mut left = parse_arith_prefix(tokens, pos)?;
    while let Some(ArithTok::Op(op)) = tokens.get(*pos) {
        if op == "++" || op == "--" {
            return Err("Arithmetic increment/decrement requires a variable".to_string());
        }
        let Some((prec, right_assoc)) = arith_op_info(op.as_str()) else {
            break;
        };
        if prec < min_prec {
            break;
        }
        let op_s = op.clone();
        *pos += 1;
        if op_s == "?" {
            let yes = parse_arith_expr(tokens, pos, 1)?;
            if !matches!(tokens.get(*pos), Some(ArithTok::Op(colon)) if colon == ":") {
                return Err("Expected ':' in ternary arithmetic expression".to_string());
            }
            *pos += 1;
            let no = parse_arith_expr(tokens, pos, 3)?;
            left = ArithNode::Ternary {
                cond: Box::new(left),
                yes: Box::new(yes),
                no: Box::new(no),
            };
            continue;
        }
        let next_min = if right_assoc { prec } else { prec + 1 };
        let right = parse_arith_expr(tokens, pos, next_min)?;
        if is_arith_assign_op(&op_s) {
            let ArithNode::Var(target) = left else {
                return Err("Arithmetic assignment requires a variable".to_string());
            };
            left = ArithNode::Assign {
                op: op_s,
                target,
                right: Box::new(right),
            };
            continue;
        }
        left = ArithNode::Binary {
            op: op_s,
            left: Box::new(left),
            right: Box::new(right),
        };
    }
    Ok(left)
}

fn eval_arith_ast(
    node: &ArithNode,
    env: &mut BTreeMap<String, String>,
    visiting: &mut BTreeSet<String>,
) -> Result<i64, String> {
    match node {
        ArithNode::Num(n) => Ok(*n),
        ArithNode::Var(name) => {
            let resolved_key = resolve_var_key_mut(name, env);
            resolve_arith_var_resolved(name, &resolved_key, env, visiting)
        }
        ArithNode::Unary { op, arg, prefix } => {
            if op == "++" || op == "--" {
                let ArithNode::Var(var) = arg.as_ref() else {
                    return Err("Arithmetic increment/decrement requires a variable".to_string());
                };
                let resolved_key = resolve_var_key_mut(var, env);
                let cur = resolve_arith_var_resolved(var, &resolved_key, env, visiting)?;
                let next = if op == "++" {
                    cur.wrapping_add(1)
                } else {
                    cur.wrapping_sub(1)
                };
                set_arith_var_resolved(resolved_key, next, env)?;
                return Ok(if *prefix { next } else { cur });
            }
            let val = eval_arith_ast(arg, env, visiting)?;
            match op.as_str() {
                "+" => Ok(val),
                "-" => Ok(val.wrapping_neg()),
                "!" => Ok(i64::from(val == 0)),
                "~" => Ok(!val),
                _ => Err(format!("Unsupported unary operator {op}")),
            }
        }
        ArithNode::Ternary { cond, yes, no } => {
            let c = eval_arith_ast(cond, env, visiting)?;
            if c != 0 {
                eval_arith_ast(yes, env, visiting)
            } else {
                eval_arith_ast(no, env, visiting)
            }
        }
        ArithNode::Assign { op, target, right } => {
            if op == "=" {
                let rhs = eval_arith_ast(right, env, visiting)?;
                let resolved_key = resolve_var_key_mut(target, env);
                set_arith_var_resolved(resolved_key, rhs, env)?;
                return Ok(rhs);
            }
            let resolved_key = resolve_var_key_mut(target, env);
            let cur = resolve_arith_var_resolved(target, &resolved_key, env, visiting)?;
            let rhs = eval_arith_ast(right, env, visiting)?;
            let next = apply_arith_binary(op.trim_end_matches('='), cur, rhs)?;
            set_arith_var_resolved(resolved_key, next, env)?;
            Ok(next)
        }
        ArithNode::Binary { op, left, right } => {
            if op == "," {
                let _ = eval_arith_ast(left, env, visiting)?;
                return eval_arith_ast(right, env, visiting);
            }
            if op == "&&" {
                let l = eval_arith_ast(left, env, visiting)?;
                if l == 0 {
                    return Ok(0);
                }
                let r = eval_arith_ast(right, env, visiting)?;
                return Ok(i64::from(r != 0));
            }
            if op == "||" {
                let l = eval_arith_ast(left, env, visiting)?;
                if l != 0 {
                    return Ok(1);
                }
                let r = eval_arith_ast(right, env, visiting)?;
                return Ok(i64::from(r != 0));
            }
            let l = eval_arith_ast(left, env, visiting)?;
            let r = eval_arith_ast(right, env, visiting)?;
            apply_arith_binary(op, l, r)
        }
    }
}

fn apply_arith_binary(op: &str, left: i64, right: i64) -> Result<i64, String> {
    match op {
        "+" => Ok(left.wrapping_add(right)),
        "-" => Ok(left.wrapping_sub(right)),
        "*" => Ok(left.wrapping_mul(right)),
        "/" => {
            if right == 0 {
                return Err("Division by zero".to_string());
            }
            Ok(left.wrapping_div(right))
        }
        "%" => {
            if right == 0 {
                return Err("Division by zero".to_string());
            }
            Ok(left.wrapping_rem(right))
        }
        "**" => {
            if right < 0 {
                return Err("exponent less than 0".to_string());
            }
            Ok(left.wrapping_pow(right as u32))
        }
        "<<" => {
            if !(0..64).contains(&right) {
                Ok(0)
            } else {
                Ok(left.wrapping_shl(right as u32))
            }
        }
        ">>" => {
            if right < 0 {
                Ok(if left < 0 { -1 } else { 0 })
            } else if right >= 64 {
                Ok(if left < 0 { -1 } else { 0 })
            } else {
                Ok(left.wrapping_shr(right as u32))
            }
        }
        "<" => Ok(i64::from(left < right)),
        "<=" => Ok(i64::from(left <= right)),
        ">" => Ok(i64::from(left > right)),
        ">=" => Ok(i64::from(left >= right)),
        "==" => Ok(i64::from(left == right)),
        "!=" => Ok(i64::from(left != right)),
        "&" => Ok(left & right),
        "^" => Ok(left ^ right),
        "|" => Ok(left | right),
        _ => Err(format!("Unsupported binary operator {op}")),
    }
}

pub fn apply_var_attributes(
    base: &str,
    raw_val: &str,
    env: &mut BTreeMap<String, String>,
) -> Result<String, String> {
    let attr = env.get(&format!("__attr__{base}")).cloned().unwrap_or_default();
    let mut final_val = raw_val.to_string();
    if attr.contains('i') {
        let trimmed = final_val.trim();
        final_val = if trimmed.is_empty() {
            "0".to_string()
        } else {
            eval_arith(trimmed, env)?.to_string()
        };
    }
    if attr.contains('l') {
        final_val = final_val.to_lowercase();
    } else if attr.contains('u') {
        final_val = final_val.to_uppercase();
    }
    Ok(final_val)
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
    if expr == "$" || expr == "BASHPID" {
        return Ok(env.get(expr).cloned().unwrap_or_else(|| "1".to_string()));
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

    // Parameter transforms @E, @Q, @P, @u, @U, @L, @a, @A, @k, @K
    if let Some((var, xform)) = expr.rsplit_once('@')
        && matches!(xform, "E" | "Q" | "P" | "u" | "U" | "L" | "a" | "A" | "k" | "K")
    {
        let eff_var = if let Some(ptr) = var.strip_prefix('!') {
            let target = lookup_var(ptr, env, last_exit, pos_args);
            if target.is_empty() {
                return Ok(String::new());
            }
            target
        } else {
            var.to_string()
        };
        match xform {
            "E" | "Q" | "P" | "U" | "u" | "L" => {
                if let Some(elems) = lookup_array_elements(&eff_var, env, pos_args) {
                    let mut out = Vec::with_capacity(elems.len());
                    for el in &elems {
                        out.push(apply_value_transform(el, xform, env, last_exit, pos_args)?);
                    }
                    let sep = if eff_var.ends_with("[*]") || eff_var == "*" {
                        env.get("IFS")
                            .and_then(|s| s.chars().next())
                            .map(|c| c.to_string())
                            .unwrap_or_else(|| {
                                if env.contains_key("IFS") {
                                    String::new()
                                } else {
                                    " ".to_string()
                                }
                            })
                    } else {
                        " ".to_string()
                    };
                    return Ok(out.join(&sep));
                }
                if !is_var_set(&eff_var, env, pos_args) {
                    return Ok(String::new());
                }
                let val = lookup_var(&eff_var, env, last_exit, pos_args);
                return apply_value_transform(&val, xform, env, last_exit, pos_args);
            }
            "a" => {
                let base = eff_var
                    .strip_suffix("[@]")
                    .or_else(|| eff_var.strip_suffix("[*]"))
                    .unwrap_or(&eff_var);
                let resolved = resolve_nameref_base(base, env).to_string();
                let (has_var, _, _, _, flags) = get_var_meta_info(&resolved, env);
                return Ok(if has_var { flags } else { String::new() });
            }
            "A" => {
                let base = eff_var
                    .strip_suffix("[@]")
                    .or_else(|| eff_var.strip_suffix("[*]"))
                    .unwrap_or(&eff_var);
                let resolved = resolve_nameref_base(base, env).to_string();
                let (has_var, is_assoc, is_array, entries, flags) = get_var_meta_info(&resolved, env);
                if !has_var {
                    return Ok(String::new());
                }
                if is_array {
                    let mut pairs = Vec::with_capacity(entries.len());
                    for (k, v) in entries {
                        let qk = if is_assoc { bash_quote_double(&k) } else { k };
                        let qv = bash_quote_double(&v);
                        pairs.push(format!("[{qk}]={qv}"));
                    }
                    let fl = if flags.is_empty() { "a".to_string() } else { flags };
                    return Ok(format!("declare -{fl} {resolved}=({})", pairs.join(" ")));
                }
                if let Some(raw_val) = env.get(&resolved) {
                    let quoted = bash_quote_value(raw_val);
                    if flags.is_empty() {
                        return Ok(format!("{resolved}={quoted}"));
                    }
                    return Ok(format!("declare -{flags} {resolved}={quoted}"));
                }
                return Ok(if flags.is_empty() {
                    String::new()
                } else {
                    format!("declare -{flags} {resolved}")
                });
            }
            "k" | "K" => {
                let base = eff_var
                    .strip_suffix("[@]")
                    .or_else(|| eff_var.strip_suffix("[*]"))
                    .unwrap_or(&eff_var);
                let resolved = resolve_nameref_base(base, env).to_string();
                let (_, is_assoc, is_array, entries, _) = get_var_meta_info(&resolved, env);
                if is_array {
                    let mut parts = Vec::new();
                    for (k, v) in entries {
                        if xform == "K" {
                            let qk = if is_assoc { bash_quote_value(&k) } else { k };
                            let qv = bash_quote_double(&v);
                            parts.push(format!("{qk} {qv}"));
                        } else {
                            parts.push(k);
                            parts.push(v);
                        }
                    }
                    return Ok(parts.join(" "));
                }
                let Some(raw_val) = env.get(&resolved) else {
                    return Ok(String::new());
                };
                if xform == "K" {
                    return Ok(bash_quote_value(raw_val));
                }
                return Ok(raw_val.clone());
            }
            _ => {}
        }
    }

    // Indirect / keys / prefix discovery: ${!var}, ${!prefix*}, ${!prefix@}, ${!arr[@]}, ${!arr[*]}
    if let Some(rest) = expr.strip_prefix('!') {
        let iv_end = find_var_name_end(rest);
        let iv_var = &rest[..iv_end];
        let iv_tail = &rest[iv_end..];

        if let Some(arr_base) = iv_var.strip_suffix("[@]").or_else(|| iv_var.strip_suffix("[*]")) {
            if !iv_tail.is_empty() {
                return Err("Syntax error: Unsupported array-key operator".to_string());
            }
            let resolved = resolve_nameref_base(arr_base, env).to_string();
            if resolved == "DIRSTACK" {
                ensure_dirstack_populated(env);
            }
            let prefix = format!("{resolved}[");
            let is_assoc = env
                .get(&format!("__assoc__{resolved}"))
                .map(|v| v == "1")
                .unwrap_or(false);
            let mut entries: Vec<(String, String)> = env
                .keys()
                .filter_map(|k| {
                    k.strip_prefix(&prefix)
                        .and_then(|s| s.strip_suffix(']'))
                        .filter(|&sub| !matches!(sub, "@" | "*" | "#"))
                        .map(|s| (s.to_string(), String::new()))
                })
                .collect();
            sort_array_entries(&resolved, env, &mut entries);
            let mut keys: Vec<String> = entries.into_iter().map(|(k, _)| k).collect();
            if keys.is_empty()
                && !is_assoc
                && !env.contains_key(&format!("{resolved}[#]"))
                && is_var_set(&resolved, env, pos_args)
            {
                keys.push("0".to_string());
            }
            return Ok(keys.join(" "));
        }
        if !iv_var.is_empty() && !iv_var.contains('[') && (iv_tail == "*" || iv_tail == "@") {
            let names = collect_prefix_var_names(iv_var, env);
            if iv_tail == "*" && env.get("__in_dquote").map(|v| v == "1").unwrap_or(false) {
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
                return Ok(names.join(&sep));
            }
            return Ok(names.join(" "));
        }
        if iv_tail.is_empty() && env.contains_key(&format!("__nameref__{rest}")) {
            return Ok(resolve_nameref_base(rest, env).to_string());
        }
        if iv_var.is_empty() {
            return Err(format!("{expr}: bad substitution"));
        }
        let target_name = if env.contains_key(&format!("__nameref__{iv_var}")) {
            resolve_nameref_base(iv_var, env).to_string()
        } else {
            expand_parameter_expr(iv_var, env, last_exit, pos_args)?
        };
        if !is_valid_indirect_target(&target_name) {
            let bad = if target_name.is_empty() { iv_var } else { &target_name };
            return Err(format!("{bad}: invalid variable name"));
        }
        return expand_parameter_expr(&format!("{target_name}{iv_tail}"), env, last_exit, pos_args);
    }

    if let Some(rest) = expr.strip_prefix('#') {
        if let Some(arr_base) = rest.strip_suffix("[@]").or_else(|| rest.strip_suffix("[*]")) {
            let resolved = resolve_nameref_base(arr_base, env).to_string();
            if resolved == "DIRSTACK" {
                ensure_dirstack_populated(env);
            }
            let prefix = format!("{resolved}[");
            let count = env
                .keys()
                .filter(|k| {
                    k.strip_prefix(&prefix)
                        .and_then(|s| s.strip_suffix(']'))
                        .is_some_and(|sub| !matches!(sub, "@" | "*" | "#"))
                })
                .count();
            if count == 0
                && !env.contains_key(&format!("{resolved}[#]"))
                && !env.contains_key(&format!("__assoc__{resolved}"))
                && is_var_set(&resolved, env, pos_args)
            {
                return Ok("1".to_string());
            }
            return Ok(count.to_string());
        }
        let val = lookup_var(rest, env, last_exit, pos_args);
        let lc = env.get("LC_ALL").or_else(|| env.get("LANG")).map(|s| s.as_str());
        if lc == Some("C") || lc == Some("POSIX") {
            return Ok(val.len().to_string());
        }
        return Ok(val.chars().count().to_string());
    }

    // Find top-level operator after variable name (respecting [...] subscript)
    let var_end = find_var_name_end(expr);
    if var_end > 0 && var_end < expr.len() {
        let var = &expr[..var_end];
        let op_rest = &expr[var_end..];

        if let Some(base) = var.strip_suffix("[]") {
            let resolved = resolve_nameref_base(base, env);
            let is_assoc = env
                .get(&format!("__assoc__{resolved}"))
                .map(|v| v == "1")
                .unwrap_or(false);
            if !is_assoc {
                return Err(format!("{var}: bad array subscript"));
            }
        }

        let in_dquote = env.get("__in_dquote").map(|v| v == "1").unwrap_or(false);
        let is_array_members = var.ends_with("[@]") || var.ends_with("[*]");

        // Error if unset/empty :?, ?
        if let Some(msg_raw) = op_rest.strip_prefix(":?") {
            let is_set = is_var_set(var, env, pos_args);
            let val = lookup_var(var, env, last_exit, pos_args);
            let missing = if is_array_members {
                !is_set
            } else if var == "@" || var == "*" {
                pos_args.is_empty() || (pos_args.len() == 1 && pos_args[0].is_empty())
            } else {
                !is_set || val.is_empty()
            };
            if missing {
                let tilded = if in_dquote {
                    msg_raw.to_string()
                } else {
                    expand_tilde_prefix(msg_raw, env, false, false)
                };
                let msg = expand_nested_operand(&tilded, env, last_exit, pos_args)?;
                let err_msg = if msg.is_empty() {
                    if is_array_members {
                        "parameter not set".to_string()
                    } else {
                        "parameter null or not set".to_string()
                    }
                } else {
                    msg
                };
                let err_var = var
                    .strip_suffix("[@]")
                    .or_else(|| var.strip_suffix("[*]"))
                    .unwrap_or(var);
                return Err(format!("__param_err__{err_var}: {err_msg}"));
            }
            return Ok(val);
        }
        if let Some(msg_raw) = op_rest.strip_prefix('?') {
            if !is_var_set(var, env, pos_args) {
                let tilded = if in_dquote {
                    msg_raw.to_string()
                } else {
                    expand_tilde_prefix(msg_raw, env, false, false)
                };
                let msg = expand_nested_operand(&tilded, env, last_exit, pos_args)?;
                let err_msg = if msg.is_empty() {
                    "parameter not set".to_string()
                } else {
                    msg
                };
                let err_var = var
                    .strip_suffix("[@]")
                    .or_else(|| var.strip_suffix("[*]"))
                    .unwrap_or(var);
                return Err(format!("__param_err__{err_var}: {err_msg}"));
            }
            return Ok(lookup_var(var, env, last_exit, pos_args));
        }

        // Default / assign / alternate operators (colon and non-colon)
        if let Some(def_raw) = op_rest.strip_prefix(":-") {
            let is_set = is_var_set(var, env, pos_args);
            let val = lookup_var(var, env, last_exit, pos_args);
            let missing = if is_array_members {
                !is_set
            } else if var == "@" || var == "*" {
                pos_args.is_empty() || (pos_args.len() == 1 && pos_args[0].is_empty())
            } else {
                !is_set || val.is_empty()
            };
            if missing {
                let tilded = if in_dquote {
                    def_raw.to_string()
                } else {
                    expand_tilde_prefix(def_raw, env, false, false)
                };
                return expand_nested_operand(&tilded, env, last_exit, pos_args);
            }
            return Ok(val);
        }
        if let Some(def_raw) = op_rest.strip_prefix('-') {
            if !is_var_set(var, env, pos_args) {
                let tilded = if in_dquote {
                    def_raw.to_string()
                } else {
                    expand_tilde_prefix(def_raw, env, false, false)
                };
                return expand_nested_operand(&tilded, env, last_exit, pos_args);
            }
            return Ok(lookup_var(var, env, last_exit, pos_args));
        }
        if let Some(def_raw) = op_rest.strip_prefix(":=") {
            if var.ends_with("[@]") || var.ends_with("[*]") {
                return Err(format!("{var}: bad array subscript"));
            }
            if is_special_or_positional_param(var) {
                return Err("Cannot assign special parameter".to_string());
            }
            let is_set = is_var_set(var, env, pos_args);
            let val = lookup_var(var, env, last_exit, pos_args);
            if !is_set || val.is_empty() {
                let tilded = if in_dquote {
                    def_raw.to_string()
                } else {
                    expand_tilde_prefix(def_raw, env, false, true)
                };
                let def = expand_nested_operand(&tilded, env, last_exit, pos_args)?;
                let resolved = resolve_var_key_mut(var, env);
                let base = resolved
                    .split_once('[')
                    .map(|(b, _)| b)
                    .unwrap_or(&resolved)
                    .to_string();
                if env
                    .get(&format!("__attr__{base}"))
                    .is_some_and(|a| a.contains('r'))
                {
                    return Err(format!("__param_ro__{base}: readonly variable"));
                }
                let transformed_def = apply_var_attributes(&base, &def, env)?;
                if env.get("__set_allexport").map(|v| v == "1").unwrap_or(false) {
                    let attr_key = format!("__attr__{base}");
                    let mut attr = env.get(&attr_key).cloned().unwrap_or_default();
                    if !attr.contains('x') {
                        attr.push('x');
                        env.insert(attr_key, attr);
                    }
                    env.remove(&format!("__unexported__{base}"));
                }
                if !write_dynamic_variable(&resolved, &transformed_def, env) {
                    let is_array = !resolved.contains('[')
                        && (env.contains_key(&format!("{resolved}[#]"))
                            || env.contains_key(&format!("__assoc__{resolved}"))
                            || env
                                .get(&format!("__attr__{resolved}"))
                                .is_some_and(|a| a.contains('a') || a.contains('A')));
                    if is_array {
                        env.insert(format!("{resolved}[0]"), transformed_def.clone());
                        sync_array_metadata(&resolved, env);
                    } else {
                        env.insert(resolved.clone(), transformed_def.clone());
                        if resolved == "OPTIND" {
                            sync_getopts_env(env);
                        }
                        if let Some((arr_b, _)) = resolved.split_once('[') {
                            sync_array_metadata(arr_b, env);
                        }
                    }
                }
                return Ok(if resolved.contains('[') {
                    transformed_def
                } else {
                    def
                });
            }
            return Ok(val);
        }
        if let Some(def_raw) = op_rest.strip_prefix('=') {
            if var.ends_with("[@]") || var.ends_with("[*]") {
                return Err(format!("{var}: bad array subscript"));
            }
            if is_special_or_positional_param(var) {
                return Err("Cannot assign special parameter".to_string());
            }
            if !is_var_set(var, env, pos_args) {
                let tilded = if in_dquote {
                    def_raw.to_string()
                } else {
                    expand_tilde_prefix(def_raw, env, false, true)
                };
                let def = expand_nested_operand(&tilded, env, last_exit, pos_args)?;
                let resolved = resolve_var_key_mut(var, env);
                let base = resolved
                    .split_once('[')
                    .map(|(b, _)| b)
                    .unwrap_or(&resolved)
                    .to_string();
                if env
                    .get(&format!("__attr__{base}"))
                    .is_some_and(|a| a.contains('r'))
                {
                    return Err(format!("__param_ro__{base}: readonly variable"));
                }
                let transformed_def = apply_var_attributes(&base, &def, env)?;
                if env.get("__set_allexport").map(|v| v == "1").unwrap_or(false) {
                    let attr_key = format!("__attr__{base}");
                    let mut attr = env.get(&attr_key).cloned().unwrap_or_default();
                    if !attr.contains('x') {
                        attr.push('x');
                        env.insert(attr_key, attr);
                    }
                    env.remove(&format!("__unexported__{base}"));
                }
                if !write_dynamic_variable(&resolved, &transformed_def, env) {
                    let is_array = !resolved.contains('[')
                        && (env.contains_key(&format!("{resolved}[#]"))
                            || env.contains_key(&format!("__assoc__{resolved}"))
                            || env
                                .get(&format!("__attr__{resolved}"))
                                .is_some_and(|a| a.contains('a') || a.contains('A')));
                    if is_array {
                        env.insert(format!("{resolved}[0]"), transformed_def.clone());
                        sync_array_metadata(&resolved, env);
                    } else {
                        env.insert(resolved.clone(), transformed_def.clone());
                        if resolved == "OPTIND" {
                            sync_getopts_env(env);
                        }
                        if let Some((arr_b, _)) = resolved.split_once('[') {
                            sync_array_metadata(arr_b, env);
                        }
                    }
                }
                return Ok(if resolved.contains('[') {
                    transformed_def
                } else {
                    def
                });
            }
            return Ok(lookup_var(var, env, last_exit, pos_args));
        }
        if let Some(alt_raw) = op_rest.strip_prefix(":+") {
            let is_set = is_var_set(var, env, last_exit_or_pos(pos_args));
            let val = lookup_var(var, env, last_exit, pos_args);
            let has_val = if is_array_members {
                is_set
            } else if var == "@" || var == "*" {
                !pos_args.is_empty() && !(pos_args.len() == 1 && pos_args[0].is_empty())
            } else {
                is_set && !val.is_empty()
            };
            if has_val {
                let tilded = if in_dquote {
                    alt_raw.to_string()
                } else {
                    expand_tilde_prefix(alt_raw, env, false, false)
                };
                return expand_nested_operand(&tilded, env, last_exit, pos_args);
            }
            return Ok(String::new());
        }
        if let Some(alt_raw) = op_rest.strip_prefix('+') {
            if is_var_set(var, env, pos_args) {
                let tilded = if in_dquote {
                    alt_raw.to_string()
                } else {
                    expand_tilde_prefix(alt_raw, env, false, false)
                };
                return expand_nested_operand(&tilded, env, last_exit, pos_args);
            }
            return Ok(String::new());
        }

        // Prefix / suffix stripping ##, #, %%, %
        let extglob = env
            .get("__shopt_extglob")
            .map(|v| v == "1")
            .unwrap_or(false);
        if let Some(pat_raw) = op_rest.strip_prefix("##") {
            let tilded = expand_tilde_prefix(pat_raw, env, false, false);
            let pat = expand_pattern_operand(&tilded, env, last_exit, pos_args)?;
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems
                    .iter()
                    .map(|e| strip_prefix_glob(e, &pat, true, extglob))
                    .collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(strip_prefix_glob(&val, &pat, true, extglob));
        }
        if let Some(pat_raw) = op_rest.strip_prefix('#') {
            let tilded = expand_tilde_prefix(pat_raw, env, false, false);
            let pat = expand_pattern_operand(&tilded, env, last_exit, pos_args)?;
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems
                    .iter()
                    .map(|e| strip_prefix_glob(e, &pat, false, extglob))
                    .collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(strip_prefix_glob(&val, &pat, false, extglob));
        }
        if let Some(pat_raw) = op_rest.strip_prefix("%%") {
            let tilded = expand_tilde_prefix(pat_raw, env, false, false);
            let pat = expand_pattern_operand(&tilded, env, last_exit, pos_args)?;
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems
                    .iter()
                    .map(|e| strip_suffix_glob(e, &pat, true, extglob))
                    .collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(strip_suffix_glob(&val, &pat, true, extglob));
        }
        if let Some(pat_raw) = op_rest.strip_prefix('%') {
            let tilded = expand_tilde_prefix(pat_raw, env, false, false);
            let pat = expand_pattern_operand(&tilded, env, last_exit, pos_args)?;
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems
                    .iter()
                    .map(|e| strip_suffix_glob(e, &pat, false, extglob))
                    .collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(strip_suffix_glob(&val, &pat, false, extglob));
        }

        // Pattern replacement //, /
        if let Some(rest) = op_rest.strip_prefix("//") {
            let (pat_raw, rep_raw) = split_first_unescaped_slash(rest);
            let tilded_pat = expand_tilde_prefix(pat_raw, env, false, false);
            let tilded_rep = expand_tilde_prefix(rep_raw, env, false, false);
            let pat = expand_pattern_operand(&tilded_pat, env, last_exit, pos_args)?;
            let rep = expand_replacement_operand_ext(&tilded_rep, env, last_exit, pos_args)?;
            let nocase = env.get("__shopt_nocasematch").map(|v| v == "1").unwrap_or(false);
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems
                    .iter()
                    .map(|e| replace_glob_pattern_full(e, &pat, &rep, true, None, nocase, extglob))
                    .collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(replace_glob_pattern_full(
                &val, &pat, &rep, true, None, nocase, extglob,
            ));
        }
        if let Some(rest) = op_rest.strip_prefix('/') {
            let (anchor, pat_and_rep) = if let Some(after_hash) = rest.strip_prefix('#') {
                (Some('#'), after_hash)
            } else if let Some(after_pct) = rest.strip_prefix('%') {
                (Some('%'), after_pct)
            } else {
                (None, rest)
            };
            let (pat_raw, rep_raw) = split_first_unescaped_slash(pat_and_rep);
            let tilded_pat = expand_tilde_prefix(pat_raw, env, false, false);
            let tilded_rep = expand_tilde_prefix(rep_raw, env, false, false);
            let pat = expand_pattern_operand(&tilded_pat, env, last_exit, pos_args)?;
            let rep = expand_replacement_operand_ext(&tilded_rep, env, last_exit, pos_args)?;
            let nocase = env.get("__shopt_nocasematch").map(|v| v == "1").unwrap_or(false);
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems
                    .iter()
                    .map(|e| {
                        replace_glob_pattern_full(e, &pat, &rep, false, anchor, nocase, extglob)
                    })
                    .collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(replace_glob_pattern_full(
                &val, &pat, &rep, false, anchor, nocase, extglob,
            ));
        }

        // Case conversion ^^, ^, ,, , (with optional pattern)
        if let Some(pat) = op_rest.strip_prefix("^^") {
            let pat_exp = if pat.is_empty() {
                None
            } else {
                let tilded = expand_tilde_prefix(pat, env, false, false);
                Some(expand_pattern_operand(&tilded, env, last_exit, pos_args)?)
            };
            let p = pat_exp.as_deref();
            let c_mode = is_c_locale(env);
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems
                    .iter()
                    .map(|w| bash_uppercase_mode(w, p, true, c_mode, extglob))
                    .collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(bash_uppercase_mode(&val, p, true, c_mode, extglob));
        }
        if let Some(pat) = op_rest.strip_prefix('^') {
            let pat_exp = if pat.is_empty() {
                None
            } else {
                let tilded = expand_tilde_prefix(pat, env, false, false);
                Some(expand_pattern_operand(&tilded, env, last_exit, pos_args)?)
            };
            let p = pat_exp.as_deref();
            let c_mode = is_c_locale(env);
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems
                    .iter()
                    .map(|w| bash_uppercase_mode(w, p, false, c_mode, extglob))
                    .collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(bash_uppercase_mode(&val, p, false, c_mode, extglob));
        }
        if let Some(pat) = op_rest.strip_prefix(",,") {
            let pat_exp = if pat.is_empty() {
                None
            } else {
                let tilded = expand_tilde_prefix(pat, env, false, false);
                Some(expand_pattern_operand(&tilded, env, last_exit, pos_args)?)
            };
            let p = pat_exp.as_deref();
            let c_mode = is_c_locale(env);
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems
                    .iter()
                    .map(|w| bash_lowercase_mode(w, p, true, c_mode, extglob))
                    .collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(bash_lowercase_mode(&val, p, true, c_mode, extglob));
        }
        if let Some(pat) = op_rest.strip_prefix(',') {
            let pat_exp = if pat.is_empty() {
                None
            } else {
                let tilded = expand_tilde_prefix(pat, env, false, false);
                Some(expand_pattern_operand(&tilded, env, last_exit, pos_args)?)
            };
            let p = pat_exp.as_deref();
            let c_mode = is_c_locale(env);
            if let Some(elems) = lookup_array_elements(var, env, pos_args) {
                let items: Vec<String> = elems
                    .iter()
                    .map(|w| bash_lowercase_mode(w, p, false, c_mode, extglob))
                    .collect();
                return Ok(items.join(" "));
            }
            let val = lookup_var(var, env, last_exit, pos_args);
            return Ok(bash_lowercase_mode(&val, p, false, c_mode, extglob));
        }

        // Substring or array slicing ${var:offset:len}
        if let Some(slice_spec) = op_rest.strip_prefix(':') {
            let (off, len_val) = parse_slice_spec(slice_spec, env)?;

            // Array slicing ${arr[@]:off:len} or ${arr[*]:off:len}
            if let Some(arr_base) = var.strip_suffix("[@]").or_else(|| var.strip_suffix("[*]")) {
                if let Some(l) = len_val
                    && l < 0
                {
                    return Err("substring expression < 0".to_string());
                }
                let resolved = resolve_nameref_base(arr_base, env).to_string();
                if resolved == "DIRSTACK" {
                    ensure_dirstack_populated(env);
                }
                let is_assoc = env
                    .get(&format!("__assoc__{resolved}"))
                    .map(|v| v == "1")
                    .unwrap_or(false)
                    || env
                        .get(&format!("__attr__{resolved}"))
                        .is_some_and(|a| a.contains('A'));
                if is_assoc {
                    let prefix = format!("{resolved}[");
                    let mut assoc_entries: Vec<(String, String)> = env
                        .iter()
                        .filter_map(|(k, v)| {
                            k.strip_prefix(&prefix)
                                .and_then(|s| s.strip_suffix(']'))
                                .filter(|&sub| !matches!(sub, "@" | "*" | "#"))
                                .map(|sub| (sub.to_string(), v.clone()))
                        })
                        .collect();
                    sort_array_entries(&resolved, env, &mut assoc_entries);
                    let vals: Vec<String> = assoc_entries.into_iter().map(|(_, v)| v).collect();
                    let total = vals.len() as isize;
                    let start = if off < 0 {
                        if total + off < 0 {
                            vals.len()
                        } else {
                            (total + off) as usize
                        }
                    } else {
                        (off as usize).min(vals.len())
                    };
                    let count = len_val.unwrap_or(total).max(0) as usize;
                    let end = (start + count).min(vals.len());
                    return Ok(vals[start..end].join(" "));
                }
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
                if entries.is_empty()
                    && !env.contains_key(&format!("{resolved}[#]"))
                    && is_var_set(&resolved, env, pos_args)
                {
                    entries.push((0, lookup_var(&resolved, env, 0, pos_args)));
                }
                entries.sort_by_key(|(idx, _)| *idx);
                let start_idx = if off < 0 {
                    let max_idx = entries.last().map(|(i, _)| *i + 1).unwrap_or(0);
                    if max_idx + off < 0 {
                        isize::MAX
                    } else {
                        max_idx + off
                    }
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
                if let Some(l) = len_val
                    && l < 0
                {
                    return Err("substring expression < 0".to_string());
                }
                let arg0 = env
                    .get("0")
                    .cloned()
                    .unwrap_or_else(|| "virtual-bash".to_string());
                let mut all_pos = Vec::with_capacity(pos_args.len() + 1);
                all_pos.push(arg0);
                all_pos.extend_from_slice(pos_args);
                let total = pos_args.len() as isize;
                let start = if off < 0 {
                    let idx = total + 1 + off;
                    if idx < 0 {
                        return Ok(String::new());
                    }
                    idx as usize
                } else if off == 0 {
                    0
                } else {
                    (off as usize).min(all_pos.len())
                };
                let count = len_val.unwrap_or(all_pos.len() as isize).max(0) as usize;
                let end = (start + count).min(all_pos.len());
                return Ok(all_pos[start..end].join(" "));
            }

            let val = lookup_var(var, env, last_exit, pos_args);
            let lc = env.get("LC_ALL").or_else(|| env.get("LANG")).map(|s| s.as_str());
            if lc == Some("C") || lc == Some("POSIX") {
                let bytes = crate::vfs::stream_string_to_bytes(&val);
                let total_len = bytes.len();
                let start = if off < 0 {
                    if total_len as isize + off < 0 {
                        return Ok(String::new());
                    }
                    (total_len as isize + off) as usize
                } else {
                    (off as usize).min(total_len)
                };
                let end = if let Some(l) = len_val {
                    if l < 0 {
                        let e = total_len as isize + l;
                        if e < start as isize {
                            return Err(format!("{l}: substring expression < 0"));
                        }
                        e as usize
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
                if total_len as isize + off < 0 {
                    return Ok(String::new());
                }
                (total_len as isize + off) as usize
            } else {
                (off as usize).min(total_len)
            };
            let end = if let Some(l) = len_val {
                if l < 0 {
                    let e = total_len as isize + l;
                    if e < start as isize {
                        return Err(format!("{l}: substring expression < 0"));
                    }
                    e as usize
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
        && !matches!(expr, "?" | "#" | "@" | "*" | "$" | "!" | "0" | "-" | "BASHPID" | "LINENO" | "DIRSTACK")
        && !(expr.chars().all(|c| c == '0') && !expr.is_empty())
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
        if let Some(l) = len_val
            && l < 0
        {
            return None;
        }
        let arg0 = env
            .get("0")
            .cloned()
            .unwrap_or_else(|| "virtual-bash".to_string());
        let mut all_pos = Vec::with_capacity(pos_args.len() + 1);
        all_pos.push(arg0);
        all_pos.extend_from_slice(pos_args);
        let total = pos_args.len() as isize;
        let start = if off < 0 {
            let idx = total + 1 + off;
            if idx < 0 {
                return Some(Vec::new());
            }
            idx as usize
        } else if off == 0 {
            0
        } else {
            (off as usize).min(all_pos.len())
        };
        let count = len_val.unwrap_or(all_pos.len() as isize).max(0) as usize;
        let end = (start + count).min(all_pos.len());
        return Some(all_pos[start..end].to_vec());
    }
    if let Some(prefix) = expr
        .strip_prefix('!')
        .and_then(|s| s.strip_suffix('@'))
        .filter(|p| !p.ends_with('['))
    {
        return Some(collect_prefix_var_names(prefix, env));
    }
    if let Some(rest) = expr.strip_prefix('!') {
        let iv_end = find_var_name_end(rest);
        let iv_var = &rest[..iv_end];
        let iv_tail = &rest[iv_end..];
        if let Some(arr_base) = iv_var.strip_suffix("[@]") {
            if !iv_tail.is_empty() {
                return None;
            }
            let resolved = resolve_nameref_base(arr_base, env).to_string();
            if resolved == "DIRSTACK" {
                ensure_dirstack_populated(env);
            }
            let prefix = format!("{resolved}[");
            let is_assoc = env
                .get(&format!("__assoc__{resolved}"))
                .map(|v| v == "1")
                .unwrap_or(false)
                || env
                    .get(&format!("__attr__{resolved}"))
                    .is_some_and(|a| a.contains('A'));
            let mut entries: Vec<(String, String)> = env
                .keys()
                .filter_map(|k| {
                    k.strip_prefix(&prefix)
                        .and_then(|s| s.strip_suffix(']'))
                        .filter(|&sub| !matches!(sub, "@" | "*" | "#"))
                        .map(|s| (s.to_string(), String::new()))
                })
                .collect();
            sort_array_entries(&resolved, env, &mut entries);
            let mut keys: Vec<String> = entries.into_iter().map(|(k, _)| k).collect();
            if keys.is_empty()
                && !is_assoc
                && !env.contains_key(&format!("{resolved}[#]"))
                && is_var_set(&resolved, env, pos_args)
            {
                keys.push("0".to_string());
            }
            return Some(keys);
        }
    }
    if !expr.starts_with('#') && !expr.starts_with('!') {
        if let Some(arr_base) = expr.strip_suffix("[@]") {
            let resolved = resolve_nameref_base(arr_base, env).to_string();
            if resolved == "DIRSTACK" {
                ensure_dirstack_populated(env);
            }
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
            sort_array_entries(&resolved, env, &mut entries);
            if entries.is_empty()
                && !is_assoc
                && !env.contains_key(&format!("{resolved}[#]"))
                && is_var_set(&resolved, env, pos_args)
            {
                let single = lookup_var(&resolved, env, 0, pos_args);
                return Some(vec![single]);
            }
            return Some(entries.into_iter().map(|(_, v)| v).collect());
        }
        if let Some((var_part, slice_spec)) = expr.split_once(':')
            && let Some(arr_base) = var_part.strip_suffix("[@]")
        {
            let Ok((off, len_val)) = parse_slice_spec(slice_spec, env) else {
                return None;
            };
            if let Some(l) = len_val
                && l < 0
            {
                return None;
            }
            let resolved = resolve_nameref_base(arr_base, env).to_string();
            if resolved == "DIRSTACK" {
                ensure_dirstack_populated(env);
            }
            let is_assoc = env
                .get(&format!("__assoc__{resolved}"))
                .map(|v| v == "1")
                .unwrap_or(false)
                || env
                    .get(&format!("__attr__{resolved}"))
                    .is_some_and(|a| a.contains('A'));
            if is_assoc {
                let prefix = format!("{resolved}[");
                let mut assoc_entries: Vec<(String, String)> = env
                    .iter()
                    .filter_map(|(k, v)| {
                        k.strip_prefix(&prefix)
                            .and_then(|s| s.strip_suffix(']'))
                            .filter(|&sub| !matches!(sub, "@" | "*" | "#"))
                            .map(|sub| (sub.to_string(), v.clone()))
                    })
                    .collect();
                sort_array_entries(&resolved, env, &mut assoc_entries);
                let vals: Vec<String> = assoc_entries.into_iter().map(|(_, v)| v).collect();
                let total = vals.len() as isize;
                let start = if off < 0 {
                    if total + off < 0 {
                        vals.len()
                    } else {
                        (total + off) as usize
                    }
                } else {
                    (off as usize).min(vals.len())
                };
                let count = len_val.unwrap_or(total).max(0) as usize;
                let end = (start + count).min(vals.len());
                return Some(vals[start..end].to_vec());
            }
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
            if entries.is_empty()
                && !env.contains_key(&format!("{resolved}[#]"))
                && !env.contains_key(&format!("__assoc__{resolved}"))
                && is_var_set(&resolved, env, pos_args)
            {
                entries.push((0, lookup_var(&resolved, env, 0, pos_args)));
            }
            entries.sort_by_key(|(idx, _)| *idx);
            let start_idx = if off < 0 {
                let max_idx = entries.last().map(|(i, _)| *i + 1).unwrap_or(0);
                if max_idx + off < 0 {
                    isize::MAX
                } else {
                    max_idx + off
                }
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
                let extglob = env
                    .get("__shopt_extglob")
                    .map(|v| v == "1")
                    .unwrap_or(false);
                if let Some(pat_raw) = op_rest.strip_prefix("##") {
                    let tilded = expand_tilde_prefix(pat_raw, env, false, false);
                    let pat = expand_pattern_operand(&tilded, env, 0, pos_args).unwrap_or_default();
                    return Some(
                        elems
                            .iter()
                            .map(|e| strip_prefix_glob(e, &pat, true, extglob))
                            .collect(),
                    );
                }
                if let Some(pat_raw) = op_rest.strip_prefix('#') {
                    let tilded = expand_tilde_prefix(pat_raw, env, false, false);
                    let pat = expand_pattern_operand(&tilded, env, 0, pos_args).unwrap_or_default();
                    return Some(
                        elems
                            .iter()
                            .map(|e| strip_prefix_glob(e, &pat, false, extglob))
                            .collect(),
                    );
                }
                if let Some(pat_raw) = op_rest.strip_prefix("%%") {
                    let tilded = expand_tilde_prefix(pat_raw, env, false, false);
                    let pat = expand_pattern_operand(&tilded, env, 0, pos_args).unwrap_or_default();
                    return Some(
                        elems
                            .iter()
                            .map(|e| strip_suffix_glob(e, &pat, true, extglob))
                            .collect(),
                    );
                }
                if let Some(pat_raw) = op_rest.strip_prefix('%') {
                    let tilded = expand_tilde_prefix(pat_raw, env, false, false);
                    let pat = expand_pattern_operand(&tilded, env, 0, pos_args).unwrap_or_default();
                    return Some(
                        elems
                            .iter()
                            .map(|e| strip_suffix_glob(e, &pat, false, extglob))
                            .collect(),
                    );
                }
                if let Some(rest) = op_rest.strip_prefix("//") {
                    let (pat_raw, rep_raw) = split_first_unescaped_slash(rest);
                    let tilded_pat = expand_tilde_prefix(pat_raw, env, false, false);
                    let tilded_rep = expand_tilde_prefix(rep_raw, env, false, false);
                    let pat =
                        expand_pattern_operand(&tilded_pat, env, 0, pos_args).unwrap_or_default();
                    let rep = expand_replacement_operand_ext(&tilded_rep, env, 0, pos_args)
                        .unwrap_or_default();
                    let nocase = env.get("__shopt_nocasematch").map(|v| v == "1").unwrap_or(false);
                    return Some(
                        elems
                            .iter()
                            .map(|e| {
                                replace_glob_pattern_full(
                                    e, &pat, &rep, true, None, nocase, extglob,
                                )
                            })
                            .collect(),
                    );
                }
                if let Some(rest) = op_rest.strip_prefix('/') {
                    let (anchor, pat_and_rep) = if let Some(after_hash) = rest.strip_prefix('#') {
                        (Some('#'), after_hash)
                    } else if let Some(after_pct) = rest.strip_prefix('%') {
                        (Some('%'), after_pct)
                    } else {
                        (None, rest)
                    };
                    let (pat_raw, rep_raw) = split_first_unescaped_slash(pat_and_rep);
                    let tilded_pat = expand_tilde_prefix(pat_raw, env, false, false);
                    let tilded_rep = expand_tilde_prefix(rep_raw, env, false, false);
                    let pat =
                        expand_pattern_operand(&tilded_pat, env, 0, pos_args).unwrap_or_default();
                    let rep = expand_replacement_operand_ext(&tilded_rep, env, 0, pos_args)
                        .unwrap_or_default();
                    let nocase = env.get("__shopt_nocasematch").map(|v| v == "1").unwrap_or(false);
                    return Some(
                        elems
                            .iter()
                            .map(|e| {
                                replace_glob_pattern_full(
                                    e, &pat, &rep, false, anchor, nocase, extglob,
                                )
                            })
                            .collect(),
                    );
                }
                if let Some(pat) = op_rest.strip_prefix("^^") {
                    let pat_exp = if pat.is_empty() {
                        None
                    } else {
                        let tilded = expand_tilde_prefix(pat, env, false, false);
                        expand_pattern_operand(&tilded, env, 0, pos_args).ok()
                    };
                    let p = pat_exp.as_deref();
                    let c_mode = is_c_locale(env);
                    return Some(
                        elems
                            .iter()
                            .map(|e| bash_uppercase_mode(e, p, true, c_mode, extglob))
                            .collect(),
                    );
                }
                if let Some(pat) = op_rest.strip_prefix('^') {
                    let pat_exp = if pat.is_empty() {
                        None
                    } else {
                        let tilded = expand_tilde_prefix(pat, env, false, false);
                        expand_pattern_operand(&tilded, env, 0, pos_args).ok()
                    };
                    let p = pat_exp.as_deref();
                    let c_mode = is_c_locale(env);
                    return Some(
                        elems
                            .iter()
                            .map(|e| bash_uppercase_mode(e, p, false, c_mode, extglob))
                            .collect(),
                    );
                }
                if let Some(pat) = op_rest.strip_prefix(",,") {
                    let pat_exp = if pat.is_empty() {
                        None
                    } else {
                        let tilded = expand_tilde_prefix(pat, env, false, false);
                        expand_pattern_operand(&tilded, env, 0, pos_args).ok()
                    };
                    let p = pat_exp.as_deref();
                    let c_mode = is_c_locale(env);
                    return Some(
                        elems
                            .iter()
                            .map(|e| bash_lowercase_mode(e, p, true, c_mode, extglob))
                            .collect(),
                    );
                }
                if let Some(pat) = op_rest.strip_prefix(',') {
                    let pat_exp = if pat.is_empty() {
                        None
                    } else {
                        let tilded = expand_tilde_prefix(pat, env, false, false);
                        expand_pattern_operand(&tilded, env, 0, pos_args).ok()
                    };
                    let p = pat_exp.as_deref();
                    let c_mode = is_c_locale(env);
                    return Some(
                        elems
                            .iter()
                            .map(|e| bash_lowercase_mode(e, p, false, c_mode, extglob))
                            .collect(),
                    );
                }
                if let Some(op) = op_rest.strip_prefix('@') {
                    let c_mode = is_c_locale(env);
                    match op {
                        "Q" => return Some(elems.iter().map(|e| bash_quote_value(e)).collect()),
                        "E" => return Some(elems.iter().map(|e| decode_ansi_c_escapes(e)).collect()),
                        "P" => {
                            return Some(
                                elems
                                    .iter()
                                    .map(|e| apply_value_transform(e, "P", env, 0, pos_args).unwrap_or_default())
                                    .collect(),
                            )
                        }
                        "U" => return Some(elems.iter().map(|e| bash_uppercase_mode(e, None, true, c_mode, extglob)).collect()),
                        "u" => return Some(elems.iter().map(|e| bash_uppercase_mode(e, None, false, c_mode, extglob)).collect()),
                        "L" => return Some(elems.iter().map(|e| bash_lowercase_mode(e, None, true, c_mode, extglob)).collect()),
                        "k" if var.ends_with("[@]") => {
                            let arr_base = var.strip_suffix("[@]").unwrap();
                            let resolved = resolve_nameref_base(arr_base, env).to_string();
                            let (_, _, is_array, entries, _) = get_var_meta_info(&resolved, env);
                            if is_array {
                                let mut tokens = Vec::new();
                                for (k, v) in entries {
                                    tokens.push(k);
                                    tokens.push(v);
                                }
                                return Some(tokens);
                            }
                        }
                        _ => {}
                    }
                }
                if op_rest.starts_with(":-") || op_rest.starts_with('-') {
                    let is_colon = op_rest.starts_with(":-");
                    let has_val = if var == "@" {
                        !elems.is_empty() && !(is_colon && elems.len() == 1 && elems[0].is_empty())
                    } else {
                        !elems.is_empty()
                    };
                    if has_val {
                        return Some(elems);
                    }
                    let def_raw = if is_colon { &op_rest[2..] } else { &op_rest[1..] };
                    let def = expand_nested_operand(def_raw, env, 0, pos_args).unwrap_or_default();
                    return Some(vec![def]);
                }
                if op_rest.starts_with(":+") || op_rest.starts_with('+') {
                    let is_colon = op_rest.starts_with(":+");
                    let has_val = if var == "@" {
                        !elems.is_empty() && !(is_colon && elems.len() == 1 && elems[0].is_empty())
                    } else {
                        !elems.is_empty()
                    };
                    if !has_val {
                        return Some(vec![String::new()]);
                    }
                    let alt_raw = if is_colon { &op_rest[2..] } else { &op_rest[1..] };
                    let alt = expand_nested_operand(alt_raw, env, 0, pos_args).unwrap_or_default();
                    return Some(vec![alt]);
                }
            }
        }
    }
    None
}

fn last_exit_or_pos(pos_args: &[String]) -> &[String] {
    pos_args
}

pub fn find_var_name_end(expr: &str) -> usize {
    let bytes = expr.as_bytes();
    if bytes.is_empty() {
        return 0;
    }
    if matches!(bytes[0], b'@' | b'*' | b'?' | b'#' | b'$' | b'!' | b'-') {
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

pub fn is_param_operand_active(
    var: &str,
    op: &str,
    env: &mut BTreeMap<String, String>,
    last_exit: i32,
    pos_args: &[String],
) -> bool {
    let is_array_members = var.ends_with("[@]") || var.ends_with("[*]");
    let is_set = is_var_set(var, env, pos_args);
    match op {
        ":-" | ":=" | ":?" => {
            if is_array_members {
                !is_set
            } else if var == "@" || var == "*" {
                pos_args.is_empty() || (pos_args.len() == 1 && pos_args[0].is_empty())
            } else {
                !is_set || lookup_var(var, env, last_exit, pos_args).is_empty()
            }
        }
        "-" | "=" | "?" => !is_set,
        ":+" => {
            if is_array_members {
                is_set
            } else if var == "@" || var == "*" {
                !pos_args.is_empty() && !(pos_args.len() == 1 && pos_args[0].is_empty())
            } else {
                is_set && !lookup_var(var, env, last_exit, pos_args).is_empty()
            }
        }
        "+" => is_set,
        _ => true,
    }
}

fn is_valid_var_ident(s: &str) -> bool {
    let mut chars = s.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_alphabetic() || first == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn is_valid_indirect_target(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    if matches!(s, "?" | "@" | "*" | "#" | "$" | "!" | "_" | "-") {
        return true;
    }
    if s.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    if let Some((base, sub_rest)) = s.split_once('[') {
        return is_valid_var_ident(base)
            && sub_rest.ends_with(']')
            && sub_rest.len() > 1;
    }
    is_valid_var_ident(s)
}

fn is_special_or_positional_param(var: &str) -> bool {
    matches!(var, "?" | "@" | "*" | "#" | "$" | "!" | "-")
        || (!var.is_empty() && var.chars().all(|c| c.is_ascii_digit()))
}

fn parse_slice_spec(
    slice_spec: &str,
    env: &mut BTreeMap<String, String>,
) -> Result<(isize, Option<isize>), String> {
    let (off_s, len_opt) = match slice_spec.split_once(':') {
        Some((o, l)) => (o.trim(), Some(l.trim())),
        None => (slice_spec.trim(), None),
    };
    if off_s.is_empty() && len_opt.is_none() {
        return Err(format!("{slice_spec}: bad substitution"));
    }
    let off = if off_s.is_empty() {
        0
    } else {
        eval_arith(off_s, env)? as isize
    };
    let len_val = match len_opt {
        Some("") => Some(0),
        Some(ls) => Some(eval_arith(ls, env)? as isize),
        None => None,
    };
    Ok((off, len_val))
}

fn collect_prefix_var_names(prefix: &str, env: &BTreeMap<String, String>) -> Vec<String> {
    let mut names = std::collections::BTreeSet::new();
    if "DIRSTACK".starts_with(prefix) {
        names.insert("DIRSTACK".to_string());
    }
    if "FUNCNAME".starts_with(prefix) && env.contains_key("FUNCNAME[0]") {
        names.insert("FUNCNAME".to_string());
    }
    for k in env.keys() {
        if k.starts_with("__") {
            continue;
        }
        let base = k.split_once('[').map(|(b, _)| b).unwrap_or(k.as_str());
        if base.starts_with(prefix) && is_valid_var_ident(base) {
            names.insert(base.to_string());
        }
    }
    names.into_iter().collect()
}

fn is_var_set(name: &str, env: &BTreeMap<String, String>, pos_args: &[String]) -> bool {
    if matches!(
        name,
        "BASH_SUBSHELL" | "BASHPID" | "$" | "?" | "#" | "-" | "LINENO" | "DIRSTACK" | "DIRSTACK[0]"
    ) {
        return true;
    }
    if !name.is_empty() && name.chars().all(|c| c == '0') {
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
    if let Some(arr_base) = name.strip_suffix("[@]").or_else(|| name.strip_suffix("[*]")) {
        let resolved = resolve_nameref_base(arr_base, env);
        if resolved == "DIRSTACK" {
            return true;
        }
        let prefix = format!("{resolved}[");
        let has_elem = env.keys().any(|k| {
            k.strip_prefix(&prefix)
                .and_then(|s| s.strip_suffix(']'))
                .is_some_and(|sub| !matches!(sub, "@" | "*" | "#"))
        });
        if has_elem {
            return true;
        }
        let is_assoc = env
            .get(&format!("__assoc__{resolved}"))
            .map(|v| v == "1")
            .unwrap_or(false)
            || env
                .get(&format!("__attr__{resolved}"))
                .is_some_and(|a| a.contains('A'));
        if !is_assoc && !env.contains_key(&format!("{resolved}[#]")) {
            return env.contains_key(resolved);
        }
        return false;
    }
    let resolved = resolve_var_key_for_lookup(name, env);
    if resolved == "RANDOM" {
        return !env.get("__random_disabled").map(|v| v == "1").unwrap_or(false)
            || env.contains_key("RANDOM");
    }
    if resolved == "SECONDS" {
        return !env.get("__seconds_disabled").map(|v| v == "1").unwrap_or(false)
            || env.contains_key("SECONDS");
    }
    if resolved == "_" {
        return env.contains_key("_") || env.contains_key("__last_arg");
    }
    if resolved == "DIRSTACK" || resolved == "DIRSTACK[0]" {
        return true;
    }
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
    if chars[*i] == '\'' {
        *i += 1;
        let mut raw = String::new();
        while *i < chars.len() && chars[*i] != '\'' {
            if chars[*i] == '\\' && *i + 1 < chars.len() {
                raw.push(chars[*i]);
                raw.push(chars[*i + 1]);
                *i += 2;
                continue;
            }
            raw.push(chars[*i]);
            *i += 1;
        }
        if *i < chars.len() {
            *i += 1;
        }
        return Ok(decode_ansi_c_escapes(&raw));
    }
    if chars[*i] == '(' && chars.get(*i + 1) == Some(&'(') {
        if let Some((expr_end, after_close)) =
            crate::shell::lexer::find_arithmetic_end(chars, *i + 2, true)?
        {
            let inner: String = chars[*i + 2..expr_end].iter().collect();
            *i = after_close;
            let expanded = expand_nested_operand(&inner, env, last_exit, pos_args)?;
            let val = eval_arith(&expanded, env)?;
            return Ok(val.to_string());
        }
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
    let first = chars[*i];
    if matches!(first, '?' | '#' | '@' | '*' | '$' | '!' | '-') || first.is_ascii_digit() {
        *i += 1;
        return Ok(lookup_var(&first.to_string(), env, last_exit, pos_args));
    }
    let mut name = String::new();
    while *i < chars.len() && (chars[*i].is_ascii_alphanumeric() || chars[*i] == '_') {
        name.push(chars[*i]);
        *i += 1;
    }
    if name.is_empty() {
        return Ok("$".to_string());
    }
    Ok(lookup_var(&name, env, last_exit, pos_args))
}

fn expand_replacement_operand(
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
                    let esc = chars[i + 1];
                    out.push(if esc == '&' { '\x01' } else { esc });
                    i += 2;
                    continue;
                }
                if chars[i] == '$' {
                    let exp = expand_nested_dollar(&chars, &mut i, env, last_exit, pos_args)?;
                    out.push_str(&exp.replace('&', "\x01"));
                    continue;
                }
                out.push(if chars[i] == '&' { '\x01' } else { chars[i] });
                i += 1;
            }
            if i < chars.len() {
                i += 1;
            }
        } else if c == '\'' && !in_dquote {
            i += 1;
            while i < chars.len() && chars[i] != '\'' {
                out.push(if chars[i] == '&' { '\x01' } else { chars[i] });
                i += 1;
            }
            if i < chars.len() {
                i += 1;
            }
        } else if c == '\\' && i + 1 < chars.len() {
            let esc = chars[i + 1];
            out.push(if esc == '&' { '\x01' } else { esc });
            i += 2;
        } else if c == '$' && chars.get(i + 1) == Some(&'\'') && !in_dquote {
            let exp = expand_nested_dollar(&chars, &mut i, env, last_exit, pos_args)?;
            out.push_str(&exp.replace('&', "\x01"));
        } else if c == '$' {
            let exp = expand_nested_dollar(&chars, &mut i, env, last_exit, pos_args)?;
            let exp_chars: Vec<char> = exp.chars().collect();
            let mut ei = 0usize;
            while ei < exp_chars.len() {
                if exp_chars[ei] == '\\'
                    && ei + 1 < exp_chars.len()
                    && matches!(exp_chars[ei + 1], '&' | '\\')
                {
                    out.push(if exp_chars[ei + 1] == '&' { '\x01' } else { '\\' });
                    ei += 2;
                } else {
                    out.push(exp_chars[ei]);
                    ei += 1;
                }
            }
        } else {
            out.push(c);
            i += 1;
        }
    }
    Ok(out)
}

fn render_replacement_with_match(rep: &str, matched: &str) -> String {
    let mut out = String::with_capacity(rep.len() + matched.len());
    for ch in rep.chars() {
        if ch == '&' {
            out.push_str(matched);
        } else if ch == '\x01' {
            out.push('&');
        } else {
            out.push(ch);
        }
    }
    out
}

fn replace_glob_pattern_full(
    val: &str,
    pat: &str,
    rep: &str,
    global: bool,
    anchor: Option<char>,
    nocase: bool,
    extglob: bool,
) -> String {
    if pat.is_empty() {
        return val.to_string();
    }
    if anchor == Some('#') {
        let chars: Vec<char> = val.chars().collect();
        for i in (0..=chars.len()).rev() {
            let prefix: String = chars[..i].iter().collect();
            if glob_match_full(pat, &prefix, nocase, extglob) {
                let rest: String = chars[i..].iter().collect();
                let rendered = render_replacement_with_match(rep, &prefix);
                return format!("{rendered}{rest}");
            }
        }
        return val.to_string();
    }
    if anchor == Some('%') {
        let chars: Vec<char> = val.chars().collect();
        for i in 0..=chars.len() {
            let suffix: String = chars[i..].iter().collect();
            if glob_match_full(pat, &suffix, nocase, extglob) {
                let head: String = chars[..i].iter().collect();
                let rendered = render_replacement_with_match(rep, &suffix);
                return format!("{head}{rendered}");
            }
        }
        return val.to_string();
    }
    if val.is_empty() {
        if glob_match_full(pat, "", nocase, extglob) {
            return render_replacement_with_match(rep, "");
        }
        return String::new();
    }
    let chars: Vec<char> = val.chars().collect();
    let mut out = String::new();
    let mut idx = 0usize;
    while idx < chars.len() {
        let mut matched_end = None;
        for end in (idx..=chars.len()).rev() {
            let sub: String = chars[idx..end].iter().collect();
            if glob_match_full(pat, &sub, nocase, extglob) {
                matched_end = Some(end);
                break;
            }
        }
        if let Some(end) = matched_end {
            let matched_str: String = chars[idx..end].iter().collect();
            out.push_str(&render_replacement_with_match(rep, &matched_str));
            if !global {
                let tail: String = chars[end..].iter().collect();
                out.push_str(&tail);
                return out;
            }
            if end == idx {
                out.push(chars[idx]);
                idx += 1;
            } else {
                idx = end;
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
    bash_quote_value_mode(val, false)
}

pub fn bash_quote_double(val: &str) -> String {
    bash_quote_value_mode(val, true)
}

pub fn bash_quote_value_mode(val: &str, double_quoted: bool) -> String {
    if val.chars().any(|c| (c as u32) < 0x20 || (c as u32) == 0x7f || c.is_control()) {
        let mut out = String::new();
        out.push('$');
        out.push('\'');
        for c in val.chars() {
            match c {
                '\x07' => out.push_str("\\a"),
                '\x08' => out.push_str("\\b"),
                '\t' => out.push_str("\\t"),
                '\n' => out.push_str("\\n"),
                '\x0b' => out.push_str("\\v"),
                '\x0c' => out.push_str("\\f"),
                '\r' => out.push_str("\\r"),
                '\x1b' => out.push_str("\\E"),
                '\\' => out.push_str("\\\\"),
                '\'' => out.push_str("\\'"),
                c if (c as u32) < 0x20 || (c as u32) == 0x7f => {
                    out.push_str(&format!("\\{:03o}", c as u32));
                }
                c if c.is_control() => {
                    let mut buf = [0u8; 4];
                    for &b in c.encode_utf8(&mut buf).as_bytes() {
                        out.push_str(&format!("\\{:03o}", b));
                    }
                }
                _ => out.push(c),
            }
        }
        out.push('\'');
        out
    } else if double_quoted {
        let mut out = String::with_capacity(val.len() + 2);
        out.push('"');
        for c in val.chars() {
            if matches!(c, '"' | '\\' | '$' | '`') {
                out.push('\\');
            }
            out.push(c);
        }
        out.push('"');
        out
    } else {
        format!("'{}'", val.replace('\'', "'\\''"))
    }
}

pub fn get_var_meta_info(
    resolved: &str,
    env: &BTreeMap<String, String>,
) -> (bool, bool, bool, Vec<(String, String)>, String) {
    let attr = env.get(&format!("__attr__{resolved}")).cloned().unwrap_or_default();
    let is_assoc = env
        .get(&format!("__assoc__{resolved}"))
        .map(|v| v == "1")
        .unwrap_or(false)
        || attr.contains('A');
    let prefix = format!("{resolved}[");
    let mut entries: Vec<(String, String)> = env
        .iter()
        .filter_map(|(k, v)| {
            k.strip_prefix(&prefix)
                .and_then(|s| s.strip_suffix(']'))
                .filter(|&sub| !matches!(sub, "@" | "*" | "#"))
                .map(|sub| (sub.to_string(), v.clone()))
        })
        .collect();
    sort_array_entries(resolved, env, &mut entries);
    let is_indexed = !is_assoc
        && (!entries.is_empty()
            || env.contains_key(&format!("{resolved}[#]"))
            || attr.contains('a'));
    let is_array = is_assoc || is_indexed;
    let has_var = is_array
        || env.contains_key(resolved)
        || !attr.is_empty()
        || env.contains_key(&format!("__declared__{resolved}"))
        || env.contains_key(&format!("__nameref__{resolved}"));
    let mut flags = String::new();
    if is_indexed {
        flags.push('a');
    }
    if is_assoc {
        flags.push('A');
    }
    if attr.contains('i') {
        flags.push('i');
    }
    if attr.contains('l') {
        flags.push('l');
    }
    if attr.contains('n') || env.contains_key(&format!("__nameref__{resolved}")) {
        flags.push('n');
    }
    if attr.contains('r') {
        flags.push('r');
    }
    if attr.contains('u') {
        flags.push('u');
    }
    if attr.contains('x') {
        flags.push('x');
    }
    (has_var, is_assoc, is_array, entries, flags)
}

fn apply_value_transform(
    val: &str,
    xform: &str,
    env: &mut BTreeMap<String, String>,
    last_exit: i32,
    pos_args: &[String],
) -> Result<String, String> {
    let c_mode = is_c_locale(env);
    let extglob = env
        .get("__shopt_extglob")
        .map(|v| v == "1")
        .unwrap_or(false);
    match xform {
        "E" => Ok(decode_ansi_c_escapes(val)),
        "Q" => Ok(bash_quote_value(val)),
        "U" => Ok(bash_uppercase_mode(val, None, true, c_mode, extglob)),
        "u" => Ok(bash_uppercase_mode(val, None, false, c_mode, extglob)),
        "L" => Ok(bash_lowercase_mode(val, None, true, c_mode, extglob)),
        "P" => {
            let chars: Vec<char> = val.chars().collect();
            let mut decoded = String::new();
            let mut i = 0usize;
            while i < chars.len() {
                if chars[i] == '\\' && i + 1 < chars.len() {
                    let esc = chars[i + 1];
                    i += 2;
                    match esc {
                        'n' => decoded.push('\n'),
                        'r' => decoded.push('\r'),
                        't' => decoded.push('\t'),
                        'e' | 'E' => decoded.push('\x1b'),
                        'a' => decoded.push('\x07'),
                        '\\' => decoded.push_str("\\\\"),
                        other => {
                            decoded.push('\\');
                            decoded.push(other);
                        }
                    }
                } else {
                    decoded.push(chars[i]);
                    i += 1;
                }
            }
            expand_nested_operand(&decoded, env, last_exit, pos_args)
        }
        _ => Ok(val.to_string()),
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
    env: &mut BTreeMap<String, String>,
    pos_args: &[String],
) -> Option<Vec<String>> {
    if var == "@" || var == "*" {
        return Some(pos_args.to_vec());
    }
    let arr_base = var.strip_suffix("[@]").or_else(|| var.strip_suffix("[*]"))?;
    let resolved = resolve_nameref_base(arr_base, env).to_string();
    if resolved == "DIRSTACK" {
        ensure_dirstack_populated(env);
    }
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
    sort_array_entries(&resolved, env, &mut entries);
    if entries.is_empty()
        && !is_assoc
        && !env.contains_key(&format!("{resolved}[#]"))
        && is_var_set(&resolved, env, pos_args)
    {
        let single = lookup_var(&resolved, env, 0, pos_args);
        return Some(vec![single]);
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

pub fn resolve_var_key_mut(name: &str, env: &mut BTreeMap<String, String>) -> String {
    if let Some((base, sub_rest)) = name.split_once('[')
        && let Some(raw_sub) = sub_rest.strip_suffix(']')
    {
        let resolved_base = resolve_nameref_base(base, env).to_string();
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
                eval_arith(&clean_sub, env).unwrap_or(0)
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
    env: &mut BTreeMap<String, String>,
    last_exit: i32,
    pos_args: &[String],
) -> String {
    if name == "BASH_SUBSHELL" {
        return env
            .get("BASH_SUBSHELL")
            .cloned()
            .unwrap_or_else(|| "0".to_string());
    }
    if name == "$" || name == "BASHPID" {
        return env
            .get(name)
            .cloned()
            .unwrap_or_else(|| "1".to_string());
    }
    if !name.is_empty() && name.chars().all(|c| c == '0') {
        return env
            .get("0")
            .cloned()
            .unwrap_or_else(|| "virtual-bash".to_string());
    }
    if name == "?" {
        return last_exit.to_string();
    }
    if name == "-" {
        let mut flags = String::new();
        if env.get("__set_allexport").map(|v| v == "1").unwrap_or(false) {
            flags.push('a');
        }
        if env.get("__set_errexit").map(|v| v == "1").unwrap_or(false) {
            flags.push('e');
        }
        if env.get("__set_noglob").map(|v| v == "1").unwrap_or(false) {
            flags.push('f');
        }
        if env.get("__set_noexec").map(|v| v == "1").unwrap_or(false) {
            flags.push('n');
        }
        if env.get("__set_nounset").map(|v| v == "1").unwrap_or(false) {
            flags.push('u');
        }
        if env.get("__set_braceexpand").map(|v| v != "0").unwrap_or(true) {
            flags.push('B');
        }
        if env.get("__set_noclobber").map(|v| v == "1").unwrap_or(false) {
            flags.push('C');
        }
        return flags;
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
        let resolved = resolve_nameref_base(arr_base, env).to_string();
        if resolved == "DIRSTACK" {
            ensure_dirstack_populated(env);
        }
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
        sort_array_entries(&resolved, env, &mut entries);
        if entries.is_empty() {
            if !is_assoc
                && !env.contains_key(&format!("{resolved}[#]"))
                && is_var_set(&resolved, env, pos_args)
            {
                return lookup_var(&resolved, env, last_exit, pos_args);
            }
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
    if key == "RANDOM" || key == "RANDOM[0]" {
        return read_dynamic_random(env).unwrap_or_default();
    }
    if key == "SECONDS" || key == "SECONDS[0]" {
        return read_dynamic_seconds(env).unwrap_or_default();
    }
    if key == "LINENO" || key == "LINENO[0]" {
        return env
            .get("LINENO")
            .or_else(|| env.get("__lineno"))
            .cloned()
            .unwrap_or_else(|| "1".to_string());
    }
    if key == "_" || key == "_[0]" {
        return env
            .get("_")
            .or_else(|| env.get("__last_arg"))
            .cloned()
            .unwrap_or_default();
    }
    if key.starts_with("DIRSTACK") {
        ensure_dirstack_populated(env);
    }
    if let Some(base) = key.strip_suffix("[0]")
        && !env.contains_key(&key)
        && !env.contains_key(&format!("{base}[#]"))
        && !env.contains_key(&format!("__assoc__{base}"))
        && let Some(sv) = env.get(base)
    {
        return sv.clone();
    }
    env.get(&key)
        .or_else(|| env.get(&format!("{key}[0]")))
        .cloned()
        .unwrap_or_default()
}

fn strip_prefix_glob(val: &str, pat: &str, longest: bool, extglob: bool) -> String {
    let chars: Vec<char> = val.chars().collect();
    if longest {
        for i in (0..=chars.len()).rev() {
            let prefix: String = chars[..i].iter().collect();
            if glob_match_full(pat, &prefix, false, extglob) {
                return chars[i..].iter().collect();
            }
        }
    } else {
        for i in 0..=chars.len() {
            let prefix: String = chars[..i].iter().collect();
            if glob_match_full(pat, &prefix, false, extglob) {
                return chars[i..].iter().collect();
            }
        }
    }
    val.to_string()
}

fn strip_suffix_glob(val: &str, pat: &str, longest: bool, extglob: bool) -> String {
    let chars: Vec<char> = val.chars().collect();
    if longest {
        for i in 0..=chars.len() {
            let suffix: String = chars[i..].iter().collect();
            if glob_match_full(pat, &suffix, false, extglob) {
                return chars[..i].iter().collect();
            }
        }
    } else {
        for i in (0..=chars.len()).rev() {
            let suffix: String = chars[i..].iter().collect();
            if glob_match_full(pat, &suffix, false, extglob) {
                return chars[..i].iter().collect();
            }
        }
    }
    val.to_string()
}

pub fn expand_tilde_prefix(
    word: &str,
    env: &BTreeMap<String, String>,
    allow_after_colon: bool,
    colon_ends_initial: bool,
) -> String {
    let chars: Vec<char> = word.chars().collect();
    let mut out = String::new();
    let mut i = 0usize;
    let mut at_tilde_pos = true;
    while i < chars.len() {
        let c = chars[i];
        if c == '\'' {
            out.push(c);
            i += 1;
            while i < chars.len() {
                let nc = chars[i];
                out.push(nc);
                i += 1;
                if nc == '\'' {
                    break;
                }
            }
            at_tilde_pos = false;
            continue;
        }
        if c == '$' && chars.get(i + 1) == Some(&'\'') {
            out.push('$');
            out.push('\'');
            i += 2;
            while i < chars.len() {
                let nc = chars[i];
                out.push(nc);
                i += 1;
                if nc == '\\' && i < chars.len() {
                    out.push(chars[i]);
                    i += 1;
                } else if nc == '\'' {
                    break;
                }
            }
            at_tilde_pos = false;
            continue;
        }
        if c == '"' {
            out.push(c);
            i += 1;
            while i < chars.len() {
                let nc = chars[i];
                out.push(nc);
                i += 1;
                if nc == '\\' && i < chars.len() {
                    out.push(chars[i]);
                    i += 1;
                } else if nc == '"' {
                    break;
                }
            }
            at_tilde_pos = false;
            continue;
        }
        if c == '\\' {
            out.push('\\');
            i += 1;
            if i < chars.len() {
                out.push(chars[i]);
                i += 1;
            }
            at_tilde_pos = false;
            continue;
        }
        if c == '~' && at_tilde_pos {
            let initial = i == 0;
            let colon_delim = allow_after_colon || (colon_ends_initial && initial);
            if i + 1 < chars.len() && (chars[i + 1] == '+' || chars[i + 1] == '-') {
                let next_after = chars.get(i + 2).copied();
                if next_after.is_none()
                    || next_after == Some('/')
                    || (colon_delim && next_after == Some(':'))
                {
                    let replacement = if chars[i + 1] == '+' {
                        env.get("PWD").cloned()
                    } else {
                        env.get("OLDPWD").cloned()
                    };
                    if let Some(val) = replacement {
                        out.push_str(&format!("'{}'", val.replace('\'', "'\\''")));
                        i += 2;
                        at_tilde_pos = false;
                        continue;
                    }
                }
            } else {
                let next_after = chars.get(i + 1).copied();
                if next_after.is_none()
                    || next_after == Some('/')
                    || (colon_delim && next_after == Some(':'))
                {
                    if let Some(home) = env.get("HOME") {
                        out.push_str(&format!("'{}'", home.replace('\'', "'\\''")));
                        i += 1;
                        at_tilde_pos = false;
                        continue;
                    }
                }
            }
        }
        out.push(c);
        at_tilde_pos = allow_after_colon && c == ':';
        i += 1;
    }
    out
}

pub fn try_resolve_unquoted_alternate_operand<'a>(
    expr: &'a str,
    env: &mut BTreeMap<String, String>,
    last_exit: i32,
    pos_args: &[String],
) -> Option<&'a str> {
    if expr.starts_with('!') || expr.starts_with('#') {
        return None;
    }
    let var_end = find_var_name_end(expr);
    if var_end == 0 || var_end >= expr.len() {
        return None;
    }
    let var = &expr[..var_end];
    let op_rest = &expr[var_end..];
    if var == "*" || var.ends_with("[@]") || var.ends_with("[*]") || var.contains("$(") || var.contains('`') {
        return None;
    }
    if let Some(def_raw) = op_rest.strip_prefix(":-") {
        let is_set = is_var_set(var, env, pos_args);
        let val = lookup_var(var, env, last_exit, pos_args);
        if !is_set || val.is_empty() {
            return Some(def_raw);
        }
        return None;
    }
    if let Some(def_raw) = op_rest.strip_prefix('-') {
        if !is_var_set(var, env, pos_args) {
            return Some(def_raw);
        }
        return None;
    }
    if let Some(alt_raw) = op_rest.strip_prefix(":+") {
        let is_set = is_var_set(var, env, pos_args);
        let val = lookup_var(var, env, last_exit, pos_args);
        if is_set && !val.is_empty() {
            return Some(alt_raw);
        }
        return None;
    }
    if let Some(alt_raw) = op_rest.strip_prefix('+') {
        if is_var_set(var, env, pos_args) {
            return Some(alt_raw);
        }
        return None;
    }
    None
}

fn is_glob_pattern_meta(c: char) -> bool {
    matches!(
        c,
        '\\' | '*' | '?' | '[' | ']' | '-' | '^' | '(' | ')' | '|' | '+' | '!' | '@' | ':'
    )
}

fn escape_glob_pattern_str(s: &str, out: &mut String) {
    for c in s.chars() {
        if is_glob_pattern_meta(c) {
            out.push('\\');
        }
        out.push(c);
    }
}

fn expand_pattern_operand(
    raw: &str,
    env: &mut BTreeMap<String, String>,
    last_exit: i32,
    pos_args: &[String],
) -> Result<String, String> {
    let prev = env.remove("__in_dquote");
    let res = (|| {
        let chars: Vec<char> = raw.chars().collect();
        let mut i = 0usize;
        let mut out = String::new();
        while i < chars.len() {
            let c = chars[i];
            if c == '"' {
                i += 1;
                while i < chars.len() && chars[i] != '"' {
                    if chars[i] == '\\' && i + 1 < chars.len() {
                        let nc = chars[i + 1];
                        if matches!(nc, '"' | '\\' | '$' | '`') {
                            escape_glob_pattern_str(&nc.to_string(), &mut out);
                            i += 2;
                            continue;
                        }
                    }
                    if chars[i] == '$' {
                        let prev_dq = env.insert("__in_dquote".to_string(), "1".to_string());
                        let exp = expand_nested_dollar(&chars, &mut i, env, last_exit, pos_args);
                        match prev_dq {
                            Some(v) => {
                                env.insert("__in_dquote".to_string(), v);
                            }
                            None => {
                                env.remove("__in_dquote");
                            }
                        }
                        escape_glob_pattern_str(&exp?, &mut out);
                        continue;
                    }
                    escape_glob_pattern_str(&chars[i].to_string(), &mut out);
                    i += 1;
                }
                if i < chars.len() {
                    i += 1;
                }
            } else if c == '\'' {
                i += 1;
                while i < chars.len() && chars[i] != '\'' {
                    escape_glob_pattern_str(&chars[i].to_string(), &mut out);
                    i += 1;
                }
                if i < chars.len() {
                    i += 1;
                }
            } else if c == '$' && chars.get(i + 1) == Some(&'\'') {
                let exp = expand_nested_dollar(&chars, &mut i, env, last_exit, pos_args)?;
                escape_glob_pattern_str(&exp, &mut out);
            } else if c == '\\' && i + 1 < chars.len() {
                escape_glob_pattern_str(&chars[i + 1].to_string(), &mut out);
                i += 2;
            } else if c == '$' {
                out.push_str(&expand_nested_dollar(&chars, &mut i, env, last_exit, pos_args)?);
            } else {
                out.push(c);
                i += 1;
            }
        }
        Ok(out)
    })();
    if let Some(v) = prev {
        env.insert("__in_dquote".to_string(), v);
    }
    res
}

fn expand_replacement_operand_ext(
    raw: &str,
    env: &mut BTreeMap<String, String>,
    last_exit: i32,
    pos_args: &[String],
) -> Result<String, String> {
    let prev = env.remove("__in_dquote");
    let res = expand_replacement_operand(raw, env, last_exit, pos_args);
    if let Some(v) = prev {
        env.insert("__in_dquote".to_string(), v);
    }
    res
}

pub fn has_glob_meta(word: &str) -> bool {
    has_glob_meta_ext(word, true)
}

pub fn has_glob_meta_ext(word: &str, extglob: bool) -> bool {
    let chars: Vec<char> = word.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '\\' {
            i += 2;
            continue;
        }
        if matches!(chars[i], '*' | '?' | '[') {
            return true;
        }
        if extglob
            && matches!(chars[i], '@' | '+' | '!' | '?' | '*')
            && chars.get(i + 1) == Some(&'(')
            && find_extglob_close(&chars, i + 1).is_some()
        {
            return true;
        }
        i += 1;
    }
    false
}

fn unescape_glob_segment(seg: &str) -> String {
    let mut out = String::with_capacity(seg.len());
    let mut chars = seg.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(nc) = chars.next() {
                out.push(nc);
            } else {
                out.push('\\');
            }
        } else {
            out.push(c);
        }
    }
    out
}

pub fn expand_globs_in_word(
    word: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
    env: &BTreeMap<String, String>,
) -> Vec<String> {
    expand_globs_in_word_with_projection(word, word, cwd, fs, env)
}

pub fn expand_globs_in_word_with_projection(
    pattern: &str,
    projection: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
    env: &BTreeMap<String, String>,
) -> Vec<String> {
    let extglob = env
        .get("__shopt_extglob")
        .map(|v| v == "1")
        .unwrap_or(false);
    if !has_glob_meta_ext(pattern, extglob) {
        return vec![projection.to_string()];
    }
    let globignore_raw = env.get("GLOBIGNORE").map(|s| s.as_str()).unwrap_or("");
    let has_globignore = !globignore_raw.is_empty();
    let raw_dotglob = env.get("__shopt_dotglob").map(|v| v == "1").unwrap_or(false);
    let dotglob = raw_dotglob || has_globignore;
    let nullglob = env.get("__shopt_nullglob").map(|v| v == "1").unwrap_or(false);
    let failglob = env.get("__shopt_failglob").map(|v| v == "1").unwrap_or(false);
    let nocaseglob = env.get("__shopt_nocaseglob").map(|v| v == "1").unwrap_or(false);
    let globstar = env.get("__shopt_globstar").map(|v| v == "1").unwrap_or(false);
    let want_dir = projection.ends_with('/');

    let is_abs = pattern.starts_with('/');
    let trimmed = pattern.trim_start_matches('/').trim_end_matches('/');
    let segments: Vec<&str> = trimmed.split('/').filter(|s| !s.is_empty()).collect();
    let root_dir = if is_abs { "/" } else { cwd };
    let root_prefix = if is_abs { "/" } else { "" };

    let mut matched = Vec::new();
    let mut visited = BTreeSet::new();
    expand_glob_segments(
        &segments,
        0,
        root_dir,
        root_prefix,
        fs,
        dotglob,
        raw_dotglob,
        nocaseglob,
        globstar,
        extglob,
        want_dir,
        &mut visited,
        &mut matched,
    );
    if has_globignore && !matched.is_empty() {
        let ignore_pats: Vec<&str> = globignore_raw
            .split(':')
            .filter(|p| !p.is_empty())
            .collect();
        if !ignore_pats.is_empty() {
            matched.retain(|cand| {
                !ignore_pats
                    .iter()
                    .any(|ig| glob_match_full(ig, cand, nocaseglob, extglob))
            });
        }
    }
    matched.sort();
    matched.dedup();

    if matched.is_empty() {
        if nullglob || failglob {
            Vec::new()
        } else {
            vec![projection.to_string()]
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
    raw_dotglob: bool,
    nocaseglob: bool,
    globstar: bool,
    extglob: bool,
    want_dir: bool,
    visited: &mut BTreeSet<(usize, String)>,
    matched: &mut Vec<String>,
) {
    if seg_idx >= segments.len() {
        return;
    }
    let seg = segments[seg_idx];
    let is_last = seg_idx + 1 == segments.len();

    if globstar && seg == "**" {
        if !fs.is_dir(cur_dir) {
            return;
        }
        if !is_last {
            expand_glob_segments(
                segments,
                seg_idx + 1,
                cur_dir,
                cur_prefix,
                fs,
                dotglob,
                raw_dotglob,
                nocaseglob,
                globstar,
                extglob,
                want_dir,
                visited,
                matched,
            );
        } else if !cur_prefix.is_empty() {
            let has_wildcard_before = segments[..seg_idx].iter().any(|s| {
                *s == "**"
                    || has_glob_meta_ext(s, extglob)
                    || (nocaseglob && *s != "." && *s != "..")
            });
            if cur_prefix == "/" {
                matched.push("/".to_string());
            } else if !has_wildcard_before || want_dir {
                matched.push(format!("{cur_prefix}/"));
            } else {
                matched.push(cur_prefix.to_string());
            }
        }
        if !visited.insert((seg_idx, cur_dir.to_string())) {
            return;
        }
        let Ok(mut entries) = fs.list_dir(cur_dir) else {
            return;
        };
        entries.sort();
        for entry in entries {
            if entry.starts_with('.') && !raw_dotglob {
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
                if !want_dir || fs.is_dir(&child_dir) {
                    matched.push(if want_dir {
                        format!("{child_prefix}/")
                    } else {
                        child_prefix.clone()
                    });
                }
            }
            if fs
                .lstat(&child_dir)
                .is_ok_and(|st| st.kind == crate::vfs::VfsEntryKind::Directory)
            {
                expand_glob_segments(
                    segments,
                    seg_idx,
                    &child_dir,
                    &child_prefix,
                    fs,
                    dotglob,
                    raw_dotglob,
                    nocaseglob,
                    globstar,
                    extglob,
                    want_dir,
                    visited,
                    matched,
                );
            }
        }
        return;
    }

    if seg == "." || seg == ".." || (!nocaseglob && !has_glob_meta_ext(seg, extglob)) {
        let literal_seg = unescape_glob_segment(seg);
        let next_dir = resolve_posix_path(cur_dir, &literal_seg);
        let next_prefix = if cur_prefix.is_empty() {
            literal_seg
        } else if cur_prefix == "/" {
            format!("/{literal_seg}")
        } else {
            format!("{cur_prefix}/{literal_seg}")
        };
        if is_last {
            if want_dir {
                if fs.is_dir(&next_dir) {
                    matched.push(format!("{next_prefix}/"));
                }
            } else if fs.lstat(&next_dir).is_ok() {
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
                raw_dotglob,
                nocaseglob,
                globstar,
                extglob,
                want_dir,
                visited,
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
        if glob_match_full(seg, &entry, nocaseglob, extglob) {
            let child_dir = resolve_posix_path(cur_dir, &entry);
            let child_prefix = if cur_prefix.is_empty() {
                entry.clone()
            } else if cur_prefix == "/" {
                format!("/{entry}")
            } else {
                format!("{cur_prefix}/{entry}")
            };
            if is_last {
                if want_dir {
                    if fs.is_dir(&child_dir) {
                        matched.push(format!("{child_prefix}/"));
                    }
                } else if fs.lstat(&child_dir).is_ok() {
                    matched.push(child_prefix);
                }
            } else if fs.is_dir(&child_dir) {
                expand_glob_segments(
                    segments,
                    seg_idx + 1,
                    &child_dir,
                    &child_prefix,
                    fs,
                    dotglob,
                    raw_dotglob,
                    nocaseglob,
                    globstar,
                    extglob,
                    want_dir,
                    visited,
                    matched,
                );
            }
        }
    }
}

fn is_c_locale(env: &BTreeMap<String, String>) -> bool {
    matches!(
        env.get("LC_ALL")
            .filter(|s| !s.is_empty())
            .or_else(|| env.get("LC_CTYPE").filter(|s| !s.is_empty()))
            .or_else(|| env.get("LANG").filter(|s| !s.is_empty()))
            .map(|s| s.as_str()),
        Some("C") | Some("POSIX")
    )
}

fn bash_uppercase_mode(
    s: &str,
    pat: Option<&str>,
    all: bool,
    c_mode: bool,
    extglob: bool,
) -> String {
    if c_mode {
        let bytes = crate::vfs::stream_string_to_bytes(s);
        let mut out_bytes = Vec::with_capacity(bytes.len());
        for (idx, &b) in bytes.iter().enumerate() {
            if !all && idx > 0 {
                out_bytes.push(b);
                continue;
            }
            let ch_s = crate::vfs::bytes_to_stream_string(&[b]);
            let should = match pat {
                Some(p) => glob_match_full(p, &ch_s, false, extglob),
                None => true,
            };
            if should && b.is_ascii_lowercase() {
                out_bytes.push(b.to_ascii_uppercase());
            } else {
                out_bytes.push(b);
            }
        }
        return crate::vfs::bytes_to_stream_string(&out_bytes);
    }
    let mut out = String::new();
    for (idx, ch) in s.chars().enumerate() {
        if !all && idx > 0 {
            out.push(ch);
            continue;
        }
        let should = match pat {
            Some(p) => glob_match_full(p, &ch.to_string(), false, extglob),
            None => true,
        };
        if should {
            let upper: Vec<char> = ch.to_uppercase().collect();
            if upper.len() == 1 {
                out.push(upper[0]);
            } else {
                out.push(ch);
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn bash_lowercase_mode(
    s: &str,
    pat: Option<&str>,
    all: bool,
    c_mode: bool,
    extglob: bool,
) -> String {
    if c_mode {
        let bytes = crate::vfs::stream_string_to_bytes(s);
        let mut out_bytes = Vec::with_capacity(bytes.len());
        for (idx, &b) in bytes.iter().enumerate() {
            if !all && idx > 0 {
                out_bytes.push(b);
                continue;
            }
            let ch_s = crate::vfs::bytes_to_stream_string(&[b]);
            let should = match pat {
                Some(p) => glob_match_full(p, &ch_s, false, extglob),
                None => true,
            };
            if should && b.is_ascii_uppercase() {
                out_bytes.push(b.to_ascii_lowercase());
            } else {
                out_bytes.push(b);
            }
        }
        return crate::vfs::bytes_to_stream_string(&out_bytes);
    }
    let mut out = String::new();
    for (idx, ch) in s.chars().enumerate() {
        if !all && idx > 0 {
            out.push(ch);
            continue;
        }
        let should = match pat {
            Some(p) => glob_match_full(p, &ch.to_string(), false, extglob),
            None => true,
        };
        if should {
            if ch == 'İ' {
                out.push('i');
            } else {
                let lower: Vec<char> = ch.to_lowercase().collect();
                if lower.len() == 1 {
                    out.push(lower[0]);
                } else {
                    out.push(ch);
                }
            }
        } else {
            out.push(ch);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_arithmetic_parameter_expansion_and_glob_matching() {
        let mut env = BTreeMap::new();
        env.insert("X".to_string(), "6".to_string());
        let val = eval_arith("X * 7 + (1 << 3) - 8", &mut env).unwrap();
        assert_eq!(val, 42);
        let _ = eval_arith("X += 4", &mut env).unwrap();
        assert_eq!(env.get("X").map(String::as_str), Some("10"));

        env.insert("WORD".to_string(), "hello_world_rust".to_string());
        assert_eq!(
            expand_parameter_expr("WORD#hello_", &mut env, 0, &[]).unwrap(),
            "world_rust"
        );
        assert_eq!(
            expand_parameter_expr("WORD%%_*", &mut env, 0, &[]).unwrap(),
            "hello"
        );
        assert_eq!(
            expand_parameter_expr("WORD//_/:", &mut env, 0, &[]).unwrap(),
            "hello:world:rust"
        );
        assert_eq!(
            expand_parameter_expr("WORD^^", &mut env, 0, &[]).unwrap(),
            "HELLO_WORLD_RUST"
        );

        assert!(glob_match("*.rs", "main.rs"));
        assert!(!glob_match("*.rs", "main.ts"));
        assert!(glob_match_ext("@(foo|bar)-[0-9].txt", "BAR-7.TXT", true));
    }

    #[test]
    fn unit_ansi_c_escapes_tilde_and_associative_array_expansion() {
        let decoded = decode_ansi_c_escapes(r"line1\nline2\t\x41\u0042");
        assert_eq!(decoded, "line1\nline2\tAB");

        let mut env = BTreeMap::new();
        env.insert("HOME".to_string(), "/home/tester".to_string());
        assert_eq!(expand_parameter_expr("HOME#/home/", &mut env, 0, &[]).unwrap(), "tester");

        let mut a = eval_arith("2 ** 8 - 6", &mut env).unwrap();
        assert_eq!(a, 250);
        a = eval_arith("15 & 7 | 8", &mut env).unwrap();
        assert_eq!(a, 15);
    }

    #[test]
    fn unit_parameter_transforms_substrings_and_ternary_arithmetic() {
        let mut env = BTreeMap::new();
        env.insert("STR".to_string(), "archive.tar.gz".to_string());
        assert_eq!(
            expand_parameter_expr("STR:8:3", &mut env, 0, &[]).unwrap(),
            "tar"
        );
        assert_eq!(
            expand_parameter_expr("STR: -6:3", &mut env, 0, &[]).unwrap(),
            "tar"
        );
        assert_eq!(
            expand_parameter_expr("STR@U", &mut env, 0, &[]).unwrap(),
            "ARCHIVE.TAR.GZ"
        );
        let v = eval_arith("10 > 5 ? (1 << 4) : 0", &mut env).unwrap();
        assert_eq!(v, 16);
    }

    #[test]
    fn unit_parameter_length_default_and_alternate_expansions() {
        let mut env = BTreeMap::new();
        env.insert("SET_VAR".to_string(), "value".to_string());
        env.insert("EMPTY_VAR".to_string(), String::new());
        assert_eq!(expand_parameter_expr("#SET_VAR", &mut env, 0, &[]).unwrap(), "5");
        assert_eq!(expand_parameter_expr("EMPTY_VAR:-fallback", &mut env, 0, &[]).unwrap(), "fallback");
        assert_eq!(expand_parameter_expr("SET_VAR:+alt", &mut env, 0, &[]).unwrap(), "alt");
    }

    #[test]
    fn unit_arith_array_subscript_side_effects_persist_in_order() {
        let mut env = BTreeMap::new();
        env.insert("arr[0]".to_string(), "10".to_string());
        env.insert("arr[1]".to_string(), "20".to_string());
        env.insert("arr[2]".to_string(), "30".to_string());
        sync_array_metadata("arr", &mut env);
        env.insert("i".to_string(), "1".to_string());

        let v = eval_arith("arr[i++] += 5, arr[i] *= 2", &mut env).unwrap();
        assert_eq!(v, 60);
        assert_eq!(env.get("i").map(String::as_str), Some("2"));
        assert_eq!(env.get("arr[0]").map(String::as_str), Some("10"));
        assert_eq!(env.get("arr[1]").map(String::as_str), Some("25"));
        assert_eq!(env.get("arr[2]").map(String::as_str), Some("60"));
    }

    #[test]
    fn unit_arith_and_parameter_default_reject_readonly_variables() {
        let mut env = BTreeMap::new();
        env.insert("RO".to_string(), String::new());
        env.insert("__attr__RO".to_string(), "r".to_string());

        let err = eval_arith("RO = 5", &mut env).unwrap_err();
        assert_eq!(err, "RO: readonly variable");
        let err_inc = eval_arith("++RO", &mut env).unwrap_err();
        assert_eq!(err_inc, "RO: readonly variable");

        let err_param = expand_parameter_expr("RO:=fallback", &mut env, 0, &[]).unwrap_err();
        assert_eq!(err_param, "__param_ro__RO: readonly variable");
    }

    #[test]
    fn unit_dynamic_random_seconds_and_deep_parameter_expansions() {
        let mut env = BTreeMap::new();
        write_dynamic_variable("RANDOM", "42", &mut env);
        let r1 = expand_parameter_expr("RANDOM", &mut env, 0, &[]).unwrap();
        let r2 = expand_parameter_expr("RANDOM", &mut env, 0, &[]).unwrap();
        write_dynamic_variable("RANDOM", "42", &mut env);
        let r1_again = expand_parameter_expr("RANDOM", &mut env, 0, &[]).unwrap();
        assert_eq!(r1, r1_again);
        assert_ne!(r1, r2);

        env.insert("TARGET".to_string(), "hello-123-world".to_string());
        env.insert("PTR".to_string(), "TARGET".to_string());
        env.insert("__shopt_extglob".to_string(), "1".to_string());
        assert_eq!(
            expand_parameter_expr("!PTR#hello-", &mut env, 0, &[]).unwrap(),
            "123-world"
        );
        assert_eq!(
            expand_parameter_expr("TARGET/+([0-9])/[&]", &mut env, 0, &[]).unwrap(),
            "hello-[123]-world"
        );
        assert_eq!(
            expand_parameter_expr("!TARGET[@]", &mut env, 0, &[]).unwrap(),
            "0"
        );
        assert_eq!(
            expand_parameter_expr("TARGET: -99", &mut env, 0, &[]).unwrap(),
            ""
        );
        assert!(
            expand_parameter_expr("TARGET:5:-20", &mut env, 0, &[])
                .unwrap_err()
                .contains("substring expression < 0")
        );
        assert_eq!(
            expand_parameter_expr("1:=bad", &mut env, 0, &[]).unwrap_err(),
            "Cannot assign special parameter"
        );
        assert_eq!(
            expand_parameter_expr("arr[@]:=bad", &mut env, 0, &[]).unwrap_err(),
            "arr[@]: bad array subscript"
        );
    }

    #[test]
    fn unit_arith_ast_short_circuit_radix_validation_and_recursion() {
        let mut env = BTreeMap::new();
        // Short-circuiting must not evaluate untaken branch errors or side effects
        assert_eq!(eval_arith("0 && (1 / 0)", &mut env).unwrap(), 0);
        assert_eq!(eval_arith("1 || (2 ** -3)", &mut env).unwrap(), 1);
        assert_eq!(eval_arith("1 ? 42 : (1 / 0)", &mut env).unwrap(), 42);
        assert_eq!(eval_arith("0 ? (1 / 0) : 99", &mut env).unwrap(), 99);

        // Radix / octal / hex validation
        assert!(eval_arith("08", &mut env).unwrap_err().contains("Invalid octal constant"));
        assert!(eval_arith("65#1", &mut env).unwrap_err().contains("Invalid arithmetic base"));
        assert!(eval_arith("1#0", &mut env).unwrap_err().contains("Invalid arithmetic base"));
        assert!(eval_arith("2#2", &mut env).unwrap_err().contains("Digit exceeds arithmetic base"));
        assert!(eval_arith("8#8", &mut env).unwrap_err().contains("Digit exceeds arithmetic base"));
        assert!(eval_arith("16#g", &mut env).unwrap_err().contains("Digit exceeds arithmetic base"));
        assert!(eval_arith("0x", &mut env).unwrap_err().contains("Invalid arithmetic constant"));
        assert_eq!(
            eval_arith("64#aA@_", &mut env).unwrap(),
            10 * 64 * 64 * 64 + 36 * 64 * 64 + 62 * 64 + 63
        );

        // Recursive variable evaluation and cycle detection
        env.insert("A".to_string(), "B".to_string());
        env.insert("B".to_string(), "C + 5".to_string());
        env.insert("C".to_string(), "37".to_string());
        assert_eq!(eval_arith("A", &mut env).unwrap(), 42);
        env.insert("CYC1".to_string(), "CYC2 + 1".to_string());
        env.insert("CYC2".to_string(), "CYC1 + 1".to_string());
        assert!(
            eval_arith("CYC1", &mut env)
                .unwrap_err()
                .contains("Arithmetic variable recursion")
        );

        // Simple assignment evaluates RHS before resolving LHS subscript
        env.insert("i".to_string(), "0".to_string());
        assert_eq!(eval_arith("arr[i] = (i = 2, 77)", &mut env).unwrap(), 77);
        assert_eq!(env.get("arr[2]").map(String::as_str), Some("77"));
        assert!(!env.contains_key("arr[0]"));

        // set -u in arithmetic
        env.insert("__set_nounset".to_string(), "1".to_string());
        assert_eq!(
            eval_arith("MISSING_VAR + 1", &mut env).unwrap_err(),
            "__nounset__MISSING_VAR: unbound variable"
        );
        assert_eq!(eval_arith("NEW_ASSIGNED = 15", &mut env).unwrap(), 15);
        assert_eq!(env.get("NEW_ASSIGNED").map(String::as_str), Some("15"));
        env.remove("__set_nounset");

        // NUL truncation in decode_ansi_c_escapes
        assert_eq!(decode_ansi_c_escapes(r"hello\0world"), "hello");
        assert_eq!(decode_ansi_c_escapes(r"abc\x00def"), "abc");
        assert_eq!(decode_ansi_c_escapes(r"uv\u0000wx"), "uv");
        assert_eq!(decode_ansi_c_escapes(r"ctrl\c@tail"), "ctrl");
        assert_eq!(decode_ansi_c_escapes(r"\u-\U"), r"\u-\U");
    }

    #[test]
    fn unit_posix_bracket_classes_extglob_quoting_and_replacement_anchors() {
        // POSIX classes [:ascii:], [:word:], invalid classes, range-before-class, and nocase ranges
        assert!(glob_match("[[:ascii:]]", "A"));
        assert!(!glob_match("[[:ascii:]]", "é"));
        assert!(glob_match("[[:word:]]", "_"));
        assert!(glob_match("[[:word:]]", "9"));
        assert!(!glob_match("[[:word:]]", "-"));
        assert!(!glob_match("[[:bogus:]]", "a"));
        assert!(!glob_match("[![:bogus:]]", "a"));
        assert!(glob_match("[a-[:digit:]]", "a"));
        assert!(glob_match("[a-[:digit:]]", "-"));
        assert!(glob_match("[a-[:digit:]]", "7"));
        assert!(!glob_match("[a-[:digit:]]", "b"));
        assert!(glob_match_ext("[Z-a]", "z", true));
        assert!(glob_match_ext("[Z-a]", "A", true));
        assert!(!glob_match_ext("[Z-a]", "m", true));
        assert!(!glob_match("[z-a]", "m"));
        assert!(glob_match("[!z-a]", "m"));

        // Bracket-aware extglob and extglob gating
        assert!(glob_match_full("@([)|]|foo)", ")", false, true));
        assert!(glob_match_full("@([)|]|foo)", "|", false, true));
        assert!(glob_match_full("@([)|]|foo)", "foo", false, true));
        assert!(!glob_match_full("@(a|b)", "a", false, false));
        assert!(glob_match_full("@(a|b)", "@(a|b)", false, false));

        let mut env = BTreeMap::new();
        env.insert("V".to_string(), "a*b*c".to_string());
        env.insert("PAT".to_string(), "*".to_string());
        assert_eq!(
            expand_parameter_expr("V#\"$PAT\"", &mut env, 0, &[]).unwrap(),
            "a*b*c"
        );
        assert_eq!(
            expand_parameter_expr("V#$PAT", &mut env, 0, &[]).unwrap(),
            "a*b*c"
        );
        env.insert("STAR".to_string(), "*b".to_string());
        assert_eq!(
            expand_parameter_expr("V#a\"$STAR\"", &mut env, 0, &[]).unwrap(),
            "*c"
        );
        assert_eq!(
            expand_parameter_expr("V#a$STAR", &mut env, 0, &[]).unwrap(),
            "*c"
        );

        // Quoted #foo vs unquoted /#foo anchor, and zero-length replacement
        env.insert("HASHED".to_string(), "xx#fooyy#foo".to_string());
        assert_eq!(
            expand_parameter_expr("HASHED/#\"#foo\"/BAR", &mut env, 0, &[]).unwrap(),
            "xx#fooyy#foo"
        );
        assert_eq!(
            expand_parameter_expr("HASHED/\"#foo\"/BAR", &mut env, 0, &[]).unwrap(),
            "xxBARyy#foo"
        );
        env.insert("AB".to_string(), "ab".to_string());
        env.insert("__shopt_extglob".to_string(), "1".to_string());
        assert_eq!(
            expand_parameter_expr("AB/?(z)/X", &mut env, 0, &[]).unwrap(),
            "Xab"
        );
        assert_eq!(
            expand_parameter_expr("AB//?(z)/X", &mut env, 0, &[]).unwrap(),
            "XaXb"
        );

        // Unquoted $rep with \& and \\ vs quoted "$rep"
        env.insert("REP".to_string(), r"[\&:\\:&]".to_string());
        assert_eq!(
            expand_parameter_expr("AB/a/$REP", &mut env, 0, &[]).unwrap(),
            r"[&:\:a]b"
        );
        assert_eq!(
            expand_parameter_expr("AB/a/\"$REP\"", &mut env, 0, &[]).unwrap(),
            r"[\&:\\:&]b"
        );
    }
}
