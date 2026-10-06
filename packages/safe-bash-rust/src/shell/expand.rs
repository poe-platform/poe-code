use crate::vfs::{SafeBashFs, resolve_posix_path};
use std::collections::BTreeMap;

pub fn glob_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    glob_match_slice(&p, &t)
}

fn glob_match_slice(p: &[char], t: &[char]) -> bool {
    let mut pi = 0usize;
    let mut ti = 0usize;
    let mut star_pi: Option<usize> = None;
    let mut star_ti = 0usize;

    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '[' {
            if let Some((matched, next_pi)) = match_bracket(&p[pi..], t[ti]) {
                if matched {
                    pi += next_pi;
                    ti += 1;
                    continue;
                }
            }
            if let Some(sp) = star_pi {
                pi = sp + 1;
                star_ti += 1;
                ti = star_ti;
            } else {
                return false;
            }
        } else if pi < p.len() && p[pi] == '*' {
            star_pi = Some(pi);
            star_ti = ti;
            pi += 1;
        } else if let Some(sp) = star_pi {
            pi = sp + 1;
            star_ti += 1;
            ti = star_ti;
        } else {
            return false;
        }
    }

    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

fn match_bracket(p: &[char], ch: char) -> Option<(bool, usize)> {
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
    while idx < p.len() && p[idx] != ']' {
        if idx + 2 < p.len() && p[idx + 1] == '-' && p[idx + 2] != ']' {
            let start = p[idx];
            let end = p[idx + 2];
            if ch >= start && ch <= end {
                matched = true;
            }
            idx += 3;
        } else {
            if p[idx] == ch {
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
    let mut out = String::new();
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('r') => out.push('\r'),
                Some('t') => out.push('\t'),
                Some('a') => out.push('\x07'),
                Some('b') => out.push('\x08'),
                Some('f') => out.push('\x0c'),
                Some('v') => out.push('\x0b'),
                Some('e') | Some('E') => out.push('\x1b'),
                Some('\\') => out.push('\\'),
                Some('\'') => out.push('\''),
                Some('"') => out.push('"'),
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
                        out.push(val as char);
                    }
                }
                Some(oct) if ('0'..='7').contains(&oct) => {
                    let mut s = String::from(oct);
                    for _ in 0..2 {
                        if let Some(&oc) = chars.peek()
                            && ('0'..='7').contains(&oc)
                        {
                            s.push(chars.next().unwrap());
                        }
                    }
                    if let Ok(val) = u8::from_str_radix(&s, 8) {
                        out.push(val as char);
                    }
                }
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

pub fn eval_arith(expr: &str, env: &mut BTreeMap<String, String>) -> Result<i64, String> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return Ok(0);
    }
    for part in trimmed.split(',') {
        let p = part.trim();
        if p.is_empty() {
            continue;
        }
    }
    let tokens = tokenize_arith(trimmed, env)?;
    let mut pos = 0usize;
    eval_arith_assign(&tokens, &mut pos, env)
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ArithTok {
    Num(i64),
    Ident(String),
    Op(String),
    LParen,
    RParen,
}

fn tokenize_arith(expr: &str, env: &BTreeMap<String, String>) -> Result<Vec<ArithTok>, String> {
    let mut expanded = String::new();
    let mut chars = expr.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '$' {
            if chars.peek() == Some(&'{') {
                chars.next();
                let mut name = String::new();
                for nc in chars.by_ref() {
                    if nc == '}' {
                        break;
                    }
                    name.push(nc);
                }
                let val = env.get(&name).cloned().unwrap_or_else(|| "0".to_string());
                expanded.push_str(&val);
            } else {
                let mut name = String::new();
                while let Some(&nc) = chars.peek() {
                    if nc.is_ascii_alphanumeric() || nc == '_' {
                        name.push(chars.next().unwrap());
                    } else {
                        break;
                    }
                }
                let val = env.get(&name).cloned().unwrap_or_else(|| "0".to_string());
                expanded.push_str(&val);
            }
        } else {
            expanded.push(c);
        }
    }

    let mut out = Vec::new();
    let mut it = expanded.chars().peekable();
    while let Some(&c) = it.peek() {
        if c.is_whitespace() {
            it.next();
            continue;
        }
        if c == '(' {
            it.next();
            out.push(ArithTok::LParen);
            continue;
        }
        if c == ')' {
            it.next();
            out.push(ArithTok::RParen);
            continue;
        }
        if c.is_ascii_digit() {
            let mut num_s = String::new();
            while let Some(&nc) = it.peek() {
                if nc.is_ascii_hexdigit() || nc == 'x' || nc == 'X' {
                    num_s.push(it.next().unwrap());
                } else {
                    break;
                }
            }
            let val = if let Some(hex) = num_s.strip_prefix("0x").or_else(|| num_s.strip_prefix("0X")) {
                i64::from_str_radix(hex, 16).unwrap_or(0)
            } else {
                num_s.parse::<i64>().unwrap_or(0)
            };
            out.push(ArithTok::Num(val));
            continue;
        }
        if c.is_ascii_alphabetic() || c == '_' {
            let mut id = String::new();
            while let Some(&nc) = it.peek() {
                if nc.is_ascii_alphanumeric() || nc == '_' {
                    id.push(it.next().unwrap());
                } else {
                    break;
                }
            }
            out.push(ArithTok::Ident(id));
            continue;
        }
        let op_ch = it.next().unwrap();
        let mut op = String::from(op_ch);
        if let Some(&next_ch) = it.peek() {
            let pair = format!("{op_ch}{next_ch}");
            if matches!(
                pair.as_str(),
                "++" | "--" | "+=" | "-=" | "*=" | "/=" | "%=" | "==" | "!=" | "<=" | ">=" | "&&" | "||" | "<<" | ">>" | "**"
            ) {
                it.next();
                op = pair;
            }
        }
        out.push(ArithTok::Op(op));
    }
    Ok(out)
}

fn eval_arith_assign(
    tokens: &[ArithTok],
    pos: &mut usize,
    env: &mut BTreeMap<String, String>,
) -> Result<i64, String> {
    if let Some(ArithTok::Ident(name)) = tokens.get(*pos)
        && let Some(ArithTok::Op(op)) = tokens.get(*pos + 1)
        && matches!(op.as_str(), "=" | "+=" | "-=" | "*=" | "/=" | "%=")
    {
        let var = name.clone();
        let assign_op = op.clone();
        *pos += 2;
        let rhs = eval_arith_assign(tokens, pos, env)?;
        let cur = env
            .get(&var)
            .and_then(|v| v.trim().parse::<i64>().ok())
            .unwrap_or(0);
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
            _ => rhs,
        };
        env.insert(var, next.to_string());
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
        let t_val = eval_arith_assign(tokens, pos, env)?;
        if matches!(tokens.get(*pos), Some(ArithTok::Op(op)) if op == ":") {
            *pos += 1;
        }
        let f_val = eval_arith_assign(tokens, pos, env)?;
        Ok(if cond != 0 { t_val } else { f_val })
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
        let right = eval_arith_logical_and(tokens, pos, env)?;
        left = if left != 0 || right != 0 { 1 } else { 0 };
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
        let right = eval_arith_bit_or(tokens, pos, env)?;
        left = if left != 0 && right != 0 { 1 } else { 0 };
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
    let mut left = eval_arith_unary(tokens, pos, env)?;
    while let Some(ArithTok::Op(op)) = tokens.get(*pos) {
        if !matches!(op.as_str(), "*" | "/" | "%" | "**") {
            break;
        }
        let op_s = op.clone();
        *pos += 1;
        let right = eval_arith_unary(tokens, pos, env)?;
        left = match op_s.as_str() {
            "*" => left.wrapping_mul(right),
            "**" => left.wrapping_pow(right.max(0) as u32),
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
                    let cur = env
                        .get(&var)
                        .and_then(|v| v.trim().parse::<i64>().ok())
                        .unwrap_or(0);
                    let next = if is_inc { cur + 1 } else { cur - 1 };
                    env.insert(var, next.to_string());
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
            let cur = env
                .get(&var)
                .and_then(|v| v.trim().parse::<i64>().ok())
                .unwrap_or(0);
            if let Some(ArithTok::Op(op)) = tokens.get(*pos)
                && (op == "++" || op == "--")
            {
                let next = if op == "++" { cur + 1 } else { cur - 1 };
                *pos += 1;
                env.insert(var, next.to_string());
                return Ok(cur);
            }
            Ok(cur)
        }
        Some(ArithTok::LParen) => {
            *pos += 1;
            let val = eval_arith_assign(tokens, pos, env)?;
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
    if expr == "#" {
        return Ok(pos_args.len().to_string());
    }
    if expr == "@" || expr == "*" {
        return Ok(pos_args.join(" "));
    }
    if let Some(rest) = expr.strip_prefix('#') {
        if let Some(arr_base) = rest.strip_suffix("[@]").or_else(|| rest.strip_suffix("[*]")) {
            let resolved = resolve_nameref_base(arr_base, env);
            if let Some(cnt) = env.get(&format!("{resolved}[#]")) {
                return Ok(cnt.clone());
            }
            return Ok("0".to_string());
        }
        let val = lookup_var(rest, env, last_exit, pos_args);
        let lc = env.get("LC_ALL").or_else(|| env.get("LANG")).map(|s| s.as_str());
        if lc == Some("C") || lc == Some("POSIX") {
            return Ok(val.len().to_string());
        }
        return Ok(val.chars().count().to_string());
    }

    // Case conversion ^^, ^, ,, ,
    if let Some(var) = expr.strip_suffix("^^") {
        return Ok(lookup_var(var, env, last_exit, pos_args).to_uppercase());
    }
    if let Some(var) = expr.strip_suffix('^') {
        let s = lookup_var(var, env, last_exit, pos_args);
        let mut c = s.chars();
        return Ok(match c.next() {
            Some(first) => first.to_uppercase().collect::<String>() + c.as_str(),
            None => String::new(),
        });
    }
    if let Some(var) = expr.strip_suffix(",,") {
        return Ok(lookup_var(var, env, last_exit, pos_args).to_lowercase());
    }
    if let Some(var) = expr.strip_suffix(',') {
        let s = lookup_var(var, env, last_exit, pos_args);
        let mut c = s.chars();
        return Ok(match c.next() {
            Some(first) => first.to_lowercase().collect::<String>() + c.as_str(),
            None => String::new(),
        });
    }

    // Parameter transforms @E, @Q
    if let Some(var) = expr.strip_suffix("@E") {
        let val = lookup_var(var, env, last_exit, pos_args);
        return Ok(decode_ansi_c_escapes(&val));
    }
    if let Some(var) = expr.strip_suffix("@Q") {
        let val = lookup_var(var, env, last_exit, pos_args);
        return Ok(format!("'{}'", val.replace('\'', "'\\''")));
    }

    // Default / assign / alternate operators
    if let Some((var, def)) = expr.split_once(":-") {
        let val = lookup_var(var, env, last_exit, pos_args);
        return Ok(if val.is_empty() { def.to_string() } else { val });
    }
    if let Some((var, def)) = expr.split_once(":=") {
        let val = lookup_var(var, env, last_exit, pos_args);
        if val.is_empty() {
            env.insert(var.to_string(), def.to_string());
            return Ok(def.to_string());
        }
        return Ok(val);
    }
    if let Some((var, alt)) = expr.split_once(":+") {
        let val = lookup_var(var, env, last_exit, pos_args);
        return Ok(if val.is_empty() { String::new() } else { alt.to_string() });
    }

    // Prefix / suffix stripping ##, #, %%, %
    if let Some((var, pat)) = expr.split_once("##")
        && !var.contains('/')
    {
        let val = lookup_var(var, env, last_exit, pos_args);
        return Ok(strip_prefix_glob(&val, pat, true));
    }
    if let Some((var, pat)) = expr.split_once('#')
        && !var.contains('/')
    {
        let val = lookup_var(var, env, last_exit, pos_args);
        return Ok(strip_prefix_glob(&val, pat, false));
    }
    if let Some((var, pat)) = expr.split_once("%%")
        && !var.contains('/')
    {
        let val = lookup_var(var, env, last_exit, pos_args);
        return Ok(strip_suffix_glob(&val, pat, true));
    }
    if let Some((var, pat)) = expr.split_once('%')
        && !var.contains('/')
    {
        let val = lookup_var(var, env, last_exit, pos_args);
        return Ok(strip_suffix_glob(&val, pat, false));
    }

    // Pattern replacement //, /
    if let Some((var, rest)) = expr.split_once("//") {
        let (pat, rep) = rest.split_once('/').unwrap_or((rest, ""));
        let val = lookup_var(var, env, last_exit, pos_args);
        return Ok(val.replace(pat, rep));
    }
    if let Some((var, rest)) = expr.split_once('/') {
        let (pat, rep) = rest.split_once('/').unwrap_or((rest, ""));
        let val = lookup_var(var, env, last_exit, pos_args);
        if var.ends_with("[*]") || var.ends_with("[@]") {
            let replaced: Vec<String> = val
                .split_whitespace()
                .map(|elem| {
                    if let Some(anch) = pat.strip_prefix('#') {
                        if let Some(stripped) = elem.strip_prefix(anch) {
                            format!("{rep}{stripped}")
                        } else {
                            elem.to_string()
                        }
                    } else if let Some(anch) = pat.strip_suffix('%') {
                        if let Some(stripped) = elem.strip_suffix(anch) {
                            format!("{stripped}{rep}")
                        } else {
                            elem.to_string()
                        }
                    } else {
                        elem.replacen(pat, rep, 1)
                    }
                })
                .collect();
            return Ok(replaced.join(" "));
        }
        if let Some(anch) = pat.strip_prefix('#') {
            if let Some(stripped) = val.strip_prefix(anch) {
                return Ok(format!("{rep}{stripped}"));
            }
            return Ok(val);
        }
        if let Some(anch) = pat.strip_suffix('%') {
            if let Some(stripped) = val.strip_suffix(anch) {
                return Ok(format!("{stripped}{rep}"));
            }
            return Ok(val);
        }
        return Ok(val.replacen(pat, rep, 1));
    }

    // Substring ${var:offset:len}
    if let Some((var, slice_spec)) = expr.split_once(':') {
        let val = lookup_var(var, env, last_exit, pos_args);
        let (off_s, len_opt) = match slice_spec.split_once(':') {
            Some((o, l)) => (o.trim(), Some(l.trim())),
            None => (slice_spec.trim(), None),
        };
        let off = off_s.parse::<isize>().unwrap_or(0);
        let lc = env.get("LC_ALL").or_else(|| env.get("LANG")).map(|s| s.as_str());
        if lc == Some("C") || lc == Some("POSIX") {
            let bytes = val.as_bytes();
            let start = if off < 0 {
                (bytes.len() as isize + off).max(0) as usize
            } else {
                (off as usize).min(bytes.len())
            };
            let end = if let Some(ls) = len_opt {
                let l = ls.parse::<isize>().unwrap_or(0).max(0) as usize;
                (start + l).min(bytes.len())
            } else {
                bytes.len()
            };
            return Ok(String::from_utf8_lossy(&bytes[start..end]).into_owned());
        }
        let chars: Vec<char> = val.chars().collect();
        let start = if off < 0 {
            (chars.len() as isize + off).max(0) as usize
        } else {
            (off as usize).min(chars.len())
        };
        let end = if let Some(ls) = len_opt {
            let l = ls.parse::<isize>().unwrap_or(0).max(0) as usize;
            (start + l).min(chars.len())
        } else {
            chars.len()
        };
        return Ok(chars[start..end].iter().collect());
    }

    Ok(lookup_var(expr, env, last_exit, pos_args))
}

fn resolve_nameref_base<'a>(base: &'a str, env: &'a BTreeMap<String, String>) -> &'a str {
    if let Some(target) = env.get(&format!("__nameref__{base}")) {
        return target.as_str();
    }
    base
}

fn lookup_var(
    name: &str,
    env: &BTreeMap<String, String>,
    last_exit: i32,
    pos_args: &[String],
) -> String {
    if name == "?" {
        return last_exit.to_string();
    }
    if name == "#" {
        return pos_args.len().to_string();
    }
    if name == "@" || name == "*" {
        return pos_args.join(" ");
    }
    if let Ok(idx) = name.parse::<usize>()
        && idx >= 1
    {
        return pos_args.get(idx - 1).cloned().unwrap_or_default();
    }
    if let Some((base, sub)) = name.split_once('[') {
        let resolved = resolve_nameref_base(base, env);
        if resolved != base {
            return env.get(&format!("{resolved}[{sub}")).cloned().unwrap_or_default();
        }
    }
    let resolved = resolve_nameref_base(name, env);
    env.get(resolved).cloned().unwrap_or_default()
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

pub fn expand_globs_in_word(word: &str, cwd: &str, fs: &dyn SafeBashFs) -> Vec<String> {
    if !word.contains('*') && !word.contains('?') && !word.contains('[') {
        return vec![word.to_string()];
    }
    let (dir_part, pat_part, prefix_str) = match word.rsplit_once('/') {
        Some(("", pat)) => ("/".to_string(), pat, "/".to_string()),
        Some((dir, pat)) => (resolve_posix_path(cwd, dir), pat, format!("{dir}/")),
        None => (cwd.to_string(), word, String::new()),
    };
    let Ok(mut entries) = fs.list_dir(&dir_part) else {
        return vec![word.to_string()];
    };
    entries.sort();
    let mut matched = Vec::new();
    for entry in entries {
        if entry.starts_with('.') && !pat_part.starts_with('.') {
            continue;
        }
        if glob_match(pat_part, &entry) {
            matched.push(format!("{prefix_str}{entry}"));
        }
    }
    if matched.is_empty() {
        vec![word.to_string()]
    } else {
        matched
    }
}
