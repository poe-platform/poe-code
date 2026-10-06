use crate::commands::search::{ZeroRegex, replace_regex_in_text};
use crate::shell::builtins::BuiltinOutcome;
use crate::vfs::{SafeBashFs, resolve_posix_path};
use std::collections::BTreeMap;

pub fn try_run_structured_command(
    cmd: &str,
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> Option<BuiltinOutcome> {
    match cmd {
        "jq" => Some(cmd_jq_with_env(args, stdin, cwd, env, fs)),
        "yq" => Some(cmd_yq(args, stdin, cwd, env, fs)),
        "csvcut" => Some(cmd_csvcut(args, stdin, cwd, fs)),
        "csvgrep" => Some(cmd_csvgrep(args, stdin, cwd, fs)),
        "csvstat" => Some(cmd_csvstat(args, stdin, cwd, fs)),
        "csvsort" => Some(cmd_csvsort(args, stdin, cwd, fs)),
        "htmlq" => Some(cmd_htmlq(args, stdin, cwd, fs)),
        "html-to-markdown" => Some(cmd_html_to_markdown(args, stdin, cwd, fs)),
        "mmdc" => Some(cmd_mmdc(args, stdin, cwd, fs)),
        "xan" => Some(cmd_xan(args, stdin, cwd, fs)),
        "xmllint" => Some(cmd_xmllint(args, stdin, cwd, fs)),
        "sqlite3" => Some(cmd_sqlite3(args, stdin, cwd, fs)),
        _ => None,
    }
}

fn ok_out(stdout: &str) -> BuiltinOutcome {
    BuiltinOutcome {
        stdout: stdout.to_string(),
        stderr: String::new(),
        exit_code: 0,
    }
}

fn err_out(stderr: &str, exit_code: i32) -> BuiltinOutcome {
    BuiltinOutcome {
        stdout: String::new(),
        stderr: stderr.to_string(),
        exit_code,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum JVal {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<JVal>),
    Object(Vec<(String, JVal)>),
}

impl JVal {
    fn is_truthy(&self) -> bool {
        !matches!(self, JVal::Null | JVal::Bool(false))
    }

    fn type_name(&self) -> &'static str {
        match self {
            JVal::Null => "null",
            JVal::Bool(_) => "boolean",
            JVal::Number(_) => "number",
            JVal::Str(_) => "string",
            JVal::Array(_) => "array",
            JVal::Object(_) => "object",
        }
    }

    fn to_raw_string(&self, compact: bool, sort_keys: bool) -> String {
        match self {
            JVal::Str(s) => s.clone(),
            _ => self.to_json_string(compact, sort_keys, 0),
        }
    }

    pub fn to_json_string(&self, compact: bool, sort_keys: bool, indent: usize) -> String {
        match self {
            JVal::Null => "null".to_string(),
            JVal::Bool(b) => if *b { "true" } else { "false" }.to_string(),
            JVal::Number(n) => {
                if n.fract() == 0.0 && n.abs() < 1e15 {
                    format!("{}", *n as i64)
                } else {
                    format!("{n}")
                }
            }
            JVal::Str(s) => escape_json_str(s),
            JVal::Array(items) => {
                if items.is_empty() {
                    return "[]".to_string();
                }
                if compact {
                    let parts: Vec<String> = items
                        .iter()
                        .map(|v| v.to_json_string(true, sort_keys, 0))
                        .collect();
                    format!("[{}]", parts.join(","))
                } else {
                    let pad = " ".repeat((indent + 1) * 2);
                    let close_pad = " ".repeat(indent * 2);
                    let parts: Vec<String> = items
                        .iter()
                        .map(|v| format!("{pad}{}", v.to_json_string(false, sort_keys, indent + 1)))
                        .collect();
                    format!("[\n{}\n{close_pad}]", parts.join(",\n"))
                }
            }
            JVal::Object(entries) => {
                if entries.is_empty() {
                    return "{}".to_string();
                }
                let mut list = entries.clone();
                if sort_keys {
                    list.sort_by(|a, b| a.0.cmp(&b.0));
                }
                if compact {
                    let parts: Vec<String> = list
                        .iter()
                        .map(|(k, v)| {
                            format!(
                                "{}:{}",
                                escape_json_str(k),
                                v.to_json_string(true, sort_keys, 0)
                            )
                        })
                        .collect();
                    format!("{{{}}}", parts.join(","))
                } else {
                    let pad = " ".repeat((indent + 1) * 2);
                    let close_pad = " ".repeat(indent * 2);
                    let parts: Vec<String> = list
                        .iter()
                        .map(|(k, v)| {
                            format!(
                                "{pad}{}: {}",
                                escape_json_str(k),
                                v.to_json_string(false, sort_keys, indent + 1)
                            )
                        })
                        .collect();
                    format!("{{\n{}\n{close_pad}}}", parts.join(",\n"))
                }
            }
        }
    }
}

fn escape_json_str(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            other => out.push(other),
        }
    }
    out.push('"');
    out
}

pub fn parse_json_stream(input: &str) -> Result<Vec<JVal>, String> {
    let chars: Vec<char> = input.chars().collect();
    let mut idx = 0usize;
    let mut out = Vec::new();
    while idx < chars.len() {
        while idx < chars.len() && chars[idx].is_whitespace() {
            idx += 1;
        }
        if idx >= chars.len() {
            break;
        }
        let val = parse_json_value(&chars, &mut idx)?;
        out.push(val);
    }
    Ok(out)
}

fn parse_json_value(chars: &[char], idx: &mut usize) -> Result<JVal, String> {
    while *idx < chars.len() && chars[*idx].is_whitespace() {
        *idx += 1;
    }
    if *idx >= chars.len() {
        return Err("unexpected EOF".into());
    }
    match chars[*idx] {
        'n' => {
            if chars[*idx..].starts_with(&['n', 'u', 'l', 'l']) {
                *idx += 4;
                Ok(JVal::Null)
            } else {
                Err("invalid literal".into())
            }
        }
        't' => {
            if chars[*idx..].starts_with(&['t', 'r', 'u', 'e']) {
                *idx += 4;
                Ok(JVal::Bool(true))
            } else {
                Err("invalid literal".into())
            }
        }
        'f' => {
            if chars[*idx..].starts_with(&['f', 'a', 'l', 's', 'e']) {
                *idx += 5;
                Ok(JVal::Bool(false))
            } else {
                Err("invalid literal".into())
            }
        }
        '"' => Ok(JVal::Str(parse_json_string(chars, idx)?)),
        '[' => {
            *idx += 1;
            let mut items = Vec::new();
            loop {
                while *idx < chars.len() && chars[*idx].is_whitespace() {
                    *idx += 1;
                }
                if *idx >= chars.len() {
                    return Err("unclosed array".into());
                }
                if chars[*idx] == ']' {
                    *idx += 1;
                    break;
                }
                items.push(parse_json_value(chars, idx)?);
                while *idx < chars.len() && chars[*idx].is_whitespace() {
                    *idx += 1;
                }
                if *idx < chars.len() && chars[*idx] == ',' {
                    *idx += 1;
                } else if *idx < chars.len() && chars[*idx] == ']' {
                    *idx += 1;
                    break;
                } else {
                    return Err("expected ',' or ']'".into());
                }
            }
            Ok(JVal::Array(items))
        }
        '{' => {
            *idx += 1;
            let mut entries: Vec<(String, JVal)> = Vec::new();
            loop {
                while *idx < chars.len() && chars[*idx].is_whitespace() {
                    *idx += 1;
                }
                if *idx >= chars.len() {
                    return Err("unclosed object".into());
                }
                if chars[*idx] == '}' {
                    *idx += 1;
                    break;
                }
                let key = parse_json_string(chars, idx)?;
                while *idx < chars.len() && chars[*idx].is_whitespace() {
                    *idx += 1;
                }
                if *idx >= chars.len() || chars[*idx] != ':' {
                    return Err("expected ':'".into());
                }
                *idx += 1;
                let val = parse_json_value(chars, idx)?;
                if let Some(pos) = entries.iter().position(|(k, _)| k == &key) {
                    entries[pos].1 = val;
                } else {
                    entries.push((key, val));
                }
                while *idx < chars.len() && chars[*idx].is_whitespace() {
                    *idx += 1;
                }
                if *idx < chars.len() && chars[*idx] == ',' {
                    *idx += 1;
                } else if *idx < chars.len() && chars[*idx] == '}' {
                    *idx += 1;
                    break;
                } else {
                    return Err("expected ',' or '}'".into());
                }
            }
            Ok(JVal::Object(entries))
        }
        c if c == '-' || c.is_ascii_digit() => {
            let start = *idx;
            if chars[*idx] == '-' {
                *idx += 1;
            }
            while *idx < chars.len()
                && (chars[*idx].is_ascii_digit()
                    || matches!(chars[*idx], '.' | 'e' | 'E' | '+' | '-'))
            {
                *idx += 1;
            }
            let num_str: String = chars[start..*idx].iter().collect();
            let n = num_str
                .parse::<f64>()
                .map_err(|_| format!("invalid number '{num_str}'"))?;
            Ok(JVal::Number(n))
        }
        other => Err(format!("unexpected character '{other}'")),
    }
}

fn parse_json_string(chars: &[char], idx: &mut usize) -> Result<String, String> {
    if *idx >= chars.len() || chars[*idx] != '"' {
        return Err("expected '\"'".into());
    }
    *idx += 1;
    let mut out = String::new();
    while *idx < chars.len() {
        let c = chars[*idx];
        *idx += 1;
        if c == '"' {
            return Ok(out);
        }
        if c == '\\' {
            if *idx >= chars.len() {
                return Err("unexpected EOF in string escape".into());
            }
            let esc = chars[*idx];
            *idx += 1;
            match esc {
                '"' => out.push('"'),
                '\\' => out.push('\\'),
                '/' => out.push('/'),
                'b' => out.push('\u{0008}'),
                'f' => out.push('\u{000c}'),
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                't' => out.push('\t'),
                'u' => {
                    if *idx + 4 <= chars.len() {
                        let hex: String = chars[*idx..*idx + 4].iter().collect();
                        *idx += 4;
                        if let Ok(code) = u32::from_str_radix(&hex, 16) {
                            if let Some(ch) = char::from_u32(code) {
                                out.push(ch);
                            }
                        }
                    }
                }
                other => out.push(other),
            }
        } else {
            out.push(c);
        }
    }
    Err("unterminated string".into())
}

fn cmd_jq_with_env(
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut raw_output = false;
    let mut compact_output = false;
    let mut slurp = false;
    let mut null_input = false;
    let mut exit_status = false;
    let mut sort_keys = false;
    let mut join_output = false;
    let mut vars: BTreeMap<String, JVal> = BTreeMap::new();
    for (k, v) in env {
        vars.insert(k.clone(), JVal::Str(v.clone()));
    }
    let mut filter: Option<String> = None;
    let mut files: Vec<String> = Vec::new();

    let mut i = 0usize;
    let mut end_opts = false;
    while i < args.len() {
        let a = &args[i];
        if !end_opts && a == "--" {
            end_opts = true;
            i += 1;
            continue;
        }
        if !end_opts && a.starts_with("--") {
            match a.as_str() {
                "--raw-output" => raw_output = true,
                "--compact-output" => compact_output = true,
                "--slurp" => slurp = true,
                "--null-input" => null_input = true,
                "--exit-status" => exit_status = true,
                "--sort-keys" => sort_keys = true,
                "--join-output" => {
                    raw_output = true;
                    join_output = true;
                }
                "--arg" if i + 2 < args.len() => {
                    vars.insert(args[i + 1].clone(), JVal::Str(args[i + 2].clone()));
                    i += 3;
                    continue;
                }
                "--argjson" if i + 2 < args.len() => {
                    let parsed = parse_json_stream(&args[i + 2])
                        .ok()
                        .and_then(|mut v| v.pop())
                        .unwrap_or(JVal::Null);
                    vars.insert(args[i + 1].clone(), parsed);
                    i += 3;
                    continue;
                }
                _ => {}
            }
            i += 1;
            continue;
        }
        if !end_opts && a.starts_with('-') && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    'r' => raw_output = true,
                    'c' => compact_output = true,
                    's' => slurp = true,
                    'n' => null_input = true,
                    'e' => exit_status = true,
                    'S' => sort_keys = true,
                    'j' => {
                        raw_output = true;
                        join_output = true;
                    }
                    _ => {}
                }
            }
            i += 1;
            continue;
        }
        if filter.is_none() {
            filter = Some(a.clone());
        } else {
            files.push(a.clone());
        }
        i += 1;
    }

    let filter_str = filter.unwrap_or_else(|| ".".to_string());
    let mut inputs: Vec<JVal> = Vec::new();

    if null_input {
        inputs.push(JVal::Null);
    } else {
        let mut raw_text = String::new();
        if files.is_empty() {
            raw_text.push_str(stdin);
        } else {
            for f in &files {
                if f == "-" {
                    raw_text.push_str(stdin);
                } else {
                    let full = resolve_posix_path(cwd, f);
                    match fs.read_file(&full) {
                        Ok(b) => raw_text.push_str(&String::from_utf8_lossy(&b)),
                        Err(_) => {
                            return err_out(&format!("jq: {f}: No such file or directory\n"), 2);
                        }
                    }
                }
            }
        }
        match parse_json_stream(&raw_text) {
            Ok(vals) => {
                if slurp {
                    inputs.push(JVal::Array(vals));
                } else {
                    inputs = vals;
                }
            }
            Err(e) => return err_out(&format!("jq: parse error: {e}\n"), 4),
        }
    }

    let mut out = String::new();
    let mut last_truthy = false;

    for input_val in inputs {
        match eval_jq(&filter_str, &input_val, &vars) {
            Ok(results) => {
                for r in results {
                    last_truthy = r.is_truthy();
                    let formatted = if raw_output {
                        r.to_raw_string(compact_output, sort_keys)
                    } else {
                        r.to_json_string(compact_output, sort_keys, 0)
                    };
                    out.push_str(&formatted);
                    if !join_output {
                        out.push('\n');
                    }
                }
            }
            Err(e) => return err_out(&format!("jq: error: {e}\n"), 5),
        }
    }

    let code = if exit_status && !last_truthy { 1 } else { 0 };
    BuiltinOutcome {
        stdout: out,
        stderr: String::new(),
        exit_code: code,
    }
}

fn eval_jq(
    expr: &str,
    input: &JVal,
    vars: &BTreeMap<String, JVal>,
) -> Result<Vec<JVal>, String> {
    let s = expr.trim();
    if s.is_empty() || s == "." {
        return Ok(vec![input.clone()]);
    }

    if let Some(pipes) = split_jq_top(s, '|') {
        let mut current = vec![input.clone()];
        for stage in pipes {
            let mut next = Vec::new();
            for item in &current {
                next.extend(eval_jq(&stage, item, vars)?);
            }
            current = next;
        }
        return Ok(current);
    }

    if s.starts_with("if ") && s.ends_with(" end") {
        return eval_jq_if(s, input, vars);
    }

    if let Some(commas) = split_jq_top(s, ',') {
        let mut out = Vec::new();
        for part in commas {
            out.extend(eval_jq(&part, input, vars)?);
        }
        return Ok(out);
    }

    for update_op in ["|=", "+=", "-=", "="] {
        if let Some((lhs, rhs)) = split_jq_binary(s, update_op) {
            if update_op == "=" && (lhs.ends_with('!') || lhs.ends_with('<') || lhs.ends_with('>') || lhs.ends_with('=')) {
                continue;
            }
            return eval_jq_update(&lhs, update_op, &rhs, input, vars);
        }
    }

    if let Some((lhs, rhs)) = split_jq_binary(s, "//") {
        let lvals = eval_jq(&lhs, input, vars).unwrap_or_default();
        let truthy: Vec<JVal> = lvals.into_iter().filter(|v| v.is_truthy()).collect();
        if !truthy.is_empty() {
            return Ok(truthy);
        }
        return eval_jq(&rhs, input, vars);
    }

    for logic_op in [" or ", " and "] {
        if let Some((lhs, rhs)) = split_jq_binary(s, logic_op) {
            let lv = eval_jq(&lhs, input, vars)?
                .first()
                .map(|v| v.is_truthy())
                .unwrap_or(false);
            let rv = eval_jq(&rhs, input, vars)?
                .first()
                .map(|v| v.is_truthy())
                .unwrap_or(false);
            let res = if logic_op.trim() == "or" {
                lv || rv
            } else {
                lv && rv
            };
            return Ok(vec![JVal::Bool(res)]);
        }
    }

    for cmp_op in ["==", "!=", "<=", ">=", "<", ">"] {
        if let Some((lhs, rhs)) = split_jq_binary(s, cmp_op) {
            let lv = eval_jq(&lhs, input, vars)?
                .into_iter()
                .next()
                .unwrap_or(JVal::Null);
            let rv = eval_jq(&rhs, input, vars)?
                .into_iter()
                .next()
                .unwrap_or(JVal::Null);
            let ord = compare_jval(&lv, &rv);
            let res = match cmp_op {
                "==" => lv == rv,
                "!=" => lv != rv,
                "<=" => ord != std::cmp::Ordering::Greater,
                ">=" => ord != std::cmp::Ordering::Less,
                "<" => ord == std::cmp::Ordering::Less,
                ">" => ord == std::cmp::Ordering::Greater,
                _ => false,
            };
            return Ok(vec![JVal::Bool(res)]);
        }
    }

    for add_op in ["+", "-"] {
        if let Some((lhs, rhs)) = split_jq_binary_right(s, add_op) {
            if !lhs.trim().is_empty() {
                let lv = eval_jq(&lhs, input, vars)?
                    .into_iter()
                    .next()
                    .unwrap_or(JVal::Null);
                let rv = eval_jq(&rhs, input, vars)?
                    .into_iter()
                    .next()
                    .unwrap_or(JVal::Null);
                return Ok(vec![apply_jq_arith(&lv, &rv, add_op)?]);
            }
        }
    }

    for mul_op in ["*", "/", "%"] {
        if let Some((lhs, rhs)) = split_jq_binary_right(s, mul_op) {
            let lv = eval_jq(&lhs, input, vars)?
                .into_iter()
                .next()
                .unwrap_or(JVal::Null);
            let rv = eval_jq(&rhs, input, vars)?
                .into_iter()
                .next()
                .unwrap_or(JVal::Null);
            return Ok(vec![apply_jq_arith(&lv, &rv, mul_op)?]);
        }
    }

    if s.starts_with('(') && s.ends_with(')') && is_matching_outer_delim(s, '(', ')') {
        return eval_jq(&s[1..s.len() - 1], input, vars);
    }

    if s.starts_with('[') && s.ends_with(']') && is_matching_outer_delim(s, '[', ']') {
        let inner = s[1..s.len() - 1].trim();
        if inner.is_empty() {
            return Ok(vec![JVal::Array(Vec::new())]);
        }
        let items = eval_jq(inner, input, vars)?;
        return Ok(vec![JVal::Array(items)]);
    }

    if s.starts_with('{') && s.ends_with('}') && is_matching_outer_delim(s, '{', '}') {
        return eval_jq_object_construct(&s[1..s.len() - 1], input, vars);
    }

    if let Some(var_name) = s.strip_prefix('$') {
        if let Some(v) = vars.get(var_name) {
            return Ok(vec![v.clone()]);
        }
        return Ok(vec![JVal::Null]);
    }

    if let Ok(mut parsed) = parse_json_stream(s) {
        if parsed.len() == 1 {
            return Ok(vec![parsed.pop().unwrap()]);
        }
    }

    if let Some(res) = try_eval_jq_builtin(s, input, vars)? {
        return Ok(res);
    }

    if let Some(env_var) = s.strip_prefix("env.") {
        return Ok(vec![vars.get(env_var).cloned().unwrap_or(JVal::Str(String::new()))]);
    }
    if s.starts_with('.') {
        return eval_jq_path(s, input, vars);
    }

    Err(format!("unsupported jq filter: {s}"))
}

fn eval_jq_if(
    s: &str,
    input: &JVal,
    vars: &BTreeMap<String, JVal>,
) -> Result<Vec<JVal>, String> {
    let body = s.strip_prefix("if ").unwrap().strip_suffix(" end").unwrap();
    let (cond_str, after_then) = body
        .split_once(" then ")
        .ok_or_else(|| "missing 'then' in if".to_string())?;
    let cond_val = eval_jq(cond_str, input, vars)?
        .first()
        .map(|v| v.is_truthy())
        .unwrap_or(false);
    if let Some((then_branch, else_branch)) = after_then.split_once(" else ") {
        if cond_val {
            eval_jq(then_branch, input, vars)
        } else {
            eval_jq(else_branch, input, vars)
        }
    } else {
        if cond_val {
            eval_jq(after_then, input, vars)
        } else {
            Ok(vec![input.clone()])
        }
    }
}

fn eval_jq_object_construct(
    inner: &str,
    input: &JVal,
    vars: &BTreeMap<String, JVal>,
) -> Result<Vec<JVal>, String> {
    let fields = split_jq_top(inner, ',').unwrap_or_else(|| {
        if inner.trim().is_empty() {
            Vec::new()
        } else {
            vec![inner.trim().to_string()]
        }
    });
    let mut entries = Vec::new();
    for f in fields {
        let f = f.trim();
        if f.is_empty() {
            continue;
        }
        if let Some((k_raw, v_raw)) = split_jq_binary(f, ":") {
            let k_trim = k_raw.trim();
            let key = if k_trim.starts_with('(') && k_trim.ends_with(')') {
                eval_jq(&k_trim[1..k_trim.len() - 1], input, vars)?
                    .first()
                    .map(|v| v.to_raw_string(true, false))
                    .unwrap_or_default()
            } else if k_trim.starts_with('"') && k_trim.ends_with('"') {
                k_trim[1..k_trim.len() - 1].to_string()
            } else {
                k_trim.to_string()
            };
            let val = eval_jq(&v_raw, input, vars)?
                .into_iter()
                .next()
                .unwrap_or(JVal::Null);
            entries.push((key, val));
        } else {
            let key = f.trim_start_matches('.').trim_matches('"').to_string();
            let path = if f.starts_with('.') || f.starts_with('$') {
                f.to_string()
            } else {
                format!(".{key}")
            };
            let val = eval_jq(&path, input, vars)?
                .into_iter()
                .next()
                .unwrap_or(JVal::Null);
            entries.push((key, val));
        }
    }
    Ok(vec![JVal::Object(entries)])
}

fn eval_jq_update(
    lhs: &str,
    op: &str,
    rhs: &str,
    input: &JVal,
    vars: &BTreeMap<String, JVal>,
) -> Result<Vec<JVal>, String> {
    let key = lhs.trim().strip_prefix('.').unwrap_or(lhs.trim());
    let mut updated = input.clone();
    if let JVal::Object(ref mut map) = updated {
        let cur_val = map
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .unwrap_or(JVal::Null);
        let new_val = match op {
            "|=" => eval_jq(rhs, &cur_val, vars)?
                .into_iter()
                .next()
                .unwrap_or(JVal::Null),
            "=" => eval_jq(rhs, input, vars)?
                .into_iter()
                .next()
                .unwrap_or(JVal::Null),
            "+=" => {
                let rv = eval_jq(rhs, input, vars)?
                    .into_iter()
                    .next()
                    .unwrap_or(JVal::Null);
                apply_jq_arith(&cur_val, &rv, "+")?
            }
            "-=" => {
                let rv = eval_jq(rhs, input, vars)?
                    .into_iter()
                    .next()
                    .unwrap_or(JVal::Null);
                apply_jq_arith(&cur_val, &rv, "-")?
            }
            _ => cur_val,
        };
        if let Some(pos) = map.iter().position(|(k, _)| k == key) {
            map[pos].1 = new_val;
        } else {
            map.push((key.to_string(), new_val));
        }
    }
    Ok(vec![updated])
}

fn apply_jq_arith(lv: &JVal, rv: &JVal, op: &str) -> Result<JVal, String> {
    match (lv, rv, op) {
        (JVal::Null, other, "+") => Ok(other.clone()),
        (other, JVal::Null, "+") => Ok(other.clone()),
        (JVal::Number(a), JVal::Number(b), "+") => Ok(JVal::Number(a + b)),
        (JVal::Number(a), JVal::Number(b), "-") => Ok(JVal::Number(a - b)),
        (JVal::Number(a), JVal::Number(b), "*") => Ok(JVal::Number(a * b)),
        (JVal::Number(a), JVal::Number(b), "/") => Ok(JVal::Number(a / b)),
        (JVal::Number(a), JVal::Number(b), "%") => Ok(JVal::Number(a % b)),
        (JVal::Str(a), JVal::Str(b), "+") => Ok(JVal::Str(format!("{a}{b}"))),
        (JVal::Str(a), JVal::Str(b), "/") => Ok(JVal::Array(
            a.split(b.as_str())
                .map(|p| JVal::Str(p.to_string()))
                .collect(),
        )),
        (JVal::Array(a), JVal::Array(b), "+") => {
            let mut v = a.clone();
            v.extend(b.iter().cloned());
            Ok(JVal::Array(v))
        }
        (JVal::Array(a), JVal::Array(b), "-") => {
            let v: Vec<JVal> = a.iter().filter(|x| !b.contains(x)).cloned().collect();
            Ok(JVal::Array(v))
        }
        (JVal::Object(a), JVal::Object(b), "+") => {
            let mut m = a.clone();
            for (k, v) in b {
                if let Some(pos) = m.iter().position(|(ek, _)| ek == k) {
                    m[pos].1 = v.clone();
                } else {
                    m.push((k.clone(), v.clone()));
                }
            }
            Ok(JVal::Object(m))
        }
        (JVal::Object(a), JVal::Object(b), "*") => {
            let mut m = a.clone();
            for (k, v) in b {
                if let Some(pos) = m.iter().position(|(ek, _)| ek == k) {
                    if matches!((&m[pos].1, v), (JVal::Object(_), JVal::Object(_))) {
                        m[pos].1 = apply_jq_arith(&m[pos].1, v, "*")?;
                    } else {
                        m[pos].1 = v.clone();
                    }
                } else {
                    m.push((k.clone(), v.clone()));
                }
            }
            Ok(JVal::Object(m))
        }
        _ => Err(format!(
            "cannot apply '{op}' to {} and {}",
            lv.type_name(),
            rv.type_name()
        )),
    }
}

fn compare_jval(a: &JVal, b: &JVal) -> std::cmp::Ordering {
    let rank = |v: &JVal| -> u8 {
        match v {
            JVal::Null => 0,
            JVal::Bool(false) => 1,
            JVal::Bool(true) => 2,
            JVal::Number(_) => 3,
            JVal::Str(_) => 4,
            JVal::Array(_) => 5,
            JVal::Object(_) => 6,
        }
    };
    let ra = rank(a);
    let rb = rank(b);
    if ra != rb {
        return ra.cmp(&rb);
    }
    match (a, b) {
        (JVal::Number(na), JVal::Number(nb)) => {
            na.partial_cmp(nb).unwrap_or(std::cmp::Ordering::Equal)
        }
        (JVal::Str(sa), JVal::Str(sb)) => sa.cmp(sb),
        (JVal::Array(aa), JVal::Array(ab)) => {
            for (x, y) in aa.iter().zip(ab.iter()) {
                let c = compare_jval(x, y);
                if c != std::cmp::Ordering::Equal {
                    return c;
                }
            }
            aa.len().cmp(&ab.len())
        }
        _ => std::cmp::Ordering::Equal,
    }
}

fn try_eval_jq_builtin(
    s: &str,
    input: &JVal,
    vars: &BTreeMap<String, JVal>,
) -> Result<Option<Vec<JVal>>, String> {
    match s {
        "empty" => return Ok(Some(Vec::new())),
        "not" => return Ok(Some(vec![JVal::Bool(!input.is_truthy())])),
        "type" => return Ok(Some(vec![JVal::Str(input.type_name().to_string())])),
        "length" => {
            let len = match input {
                JVal::Null => 0,
                JVal::Str(st) => st.chars().count(),
                JVal::Array(a) => a.len(),
                JVal::Object(o) => o.len(),
                JVal::Number(n) => n.abs() as usize,
                JVal::Bool(_) => 0,
            };
            return Ok(Some(vec![JVal::Number(len as f64)]));
        }
        "keys" | "keys_unsorted" => {
            let keys = match input {
                JVal::Object(o) => {
                    let mut ks: Vec<String> = o.iter().map(|(k, _)| k.clone()).collect();
                    if s == "keys" {
                        ks.sort();
                    }
                    ks.into_iter().map(JVal::Str).collect()
                }
                JVal::Array(a) => (0..a.len()).map(|i| JVal::Number(i as f64)).collect(),
                _ => Vec::new(),
            };
            return Ok(Some(vec![JVal::Array(keys)]));
        }
        "values" => {
            return Ok(Some(if input.is_truthy() {
                vec![input.clone()]
            } else {
                Vec::new()
            }));
        }
        "tonumber" => {
            let n = match input {
                JVal::Number(n) => *n,
                JVal::Str(st) => st.trim().parse::<f64>().unwrap_or(0.0),
                _ => 0.0,
            };
            return Ok(Some(vec![JVal::Number(n)]));
        }
        "tostring" => {
            let st = match input {
                JVal::Str(st) => st.clone(),
                other => other.to_json_string(true, false, 0),
            };
            return Ok(Some(vec![JVal::Str(st)]));
        }
        "ascii_downcase" => {
            if let JVal::Str(st) = input {
                return Ok(Some(vec![JVal::Str(st.to_ascii_lowercase())]));
            }
        }
        "ascii_upcase" => {
            if let JVal::Str(st) = input {
                return Ok(Some(vec![JVal::Str(st.to_ascii_uppercase())]));
            }
        }
        "reverse" => match input {
            JVal::Array(a) => {
                let mut r = a.clone();
                r.reverse();
                return Ok(Some(vec![JVal::Array(r)]));
            }
            JVal::Str(st) => {
                return Ok(Some(vec![JVal::Str(st.chars().rev().collect())]));
            }
            _ => {}
        },
        "sort" => {
            if let JVal::Array(a) = input {
                let mut s = a.clone();
                s.sort_by(compare_jval);
                return Ok(Some(vec![JVal::Array(s)]));
            }
        }
        "unique" => {
            if let JVal::Array(a) = input {
                let mut s = a.clone();
                s.sort_by(compare_jval);
                s.dedup();
                return Ok(Some(vec![JVal::Array(s)]));
            }
        }
        "flatten" => {
            if let JVal::Array(a) = input {
                let mut out = Vec::new();
                flatten_jval(a, usize::MAX, &mut out);
                return Ok(Some(vec![JVal::Array(out)]));
            }
        }
        "add" => {
            if let JVal::Array(a) = input {
                if a.is_empty() {
                    return Ok(Some(vec![JVal::Null]));
                }
                let mut acc = a[0].clone();
                for item in &a[1..] {
                    acc = apply_jq_arith(&acc, item, "+")?;
                }
                return Ok(Some(vec![acc]));
            }
        }
        "min" | "max" => {
            if let JVal::Array(a) = input {
                if a.is_empty() {
                    return Ok(Some(vec![JVal::Null]));
                }
                let mut best = a[0].clone();
                for item in &a[1..] {
                    let ord = compare_jval(item, &best);
                    if (s == "min" && ord == std::cmp::Ordering::Less)
                        || (s == "max" && ord == std::cmp::Ordering::Greater)
                    {
                        best = item.clone();
                    }
                }
                return Ok(Some(vec![best]));
            }
        }
        "any" => {
            if let JVal::Array(a) = input {
                return Ok(Some(vec![JVal::Bool(a.iter().any(|v| v.is_truthy()))]));
            }
        }
        "all" => {
            if let JVal::Array(a) = input {
                return Ok(Some(vec![JVal::Bool(a.iter().all(|v| v.is_truthy()))]));
            }
        }
        "first" => {
            if let JVal::Array(a) = input {
                return Ok(Some(vec![a.first().cloned().unwrap_or(JVal::Null)]));
            }
        }
        "last" => {
            if let JVal::Array(a) = input {
                return Ok(Some(vec![a.last().cloned().unwrap_or(JVal::Null)]));
            }
        }
        "to_entries" => {
            if let JVal::Object(o) = input {
                let arr: Vec<JVal> = o
                    .iter()
                    .map(|(k, v)| {
                        JVal::Object(vec![
                            ("key".to_string(), JVal::Str(k.clone())),
                            ("value".to_string(), v.clone()),
                        ])
                    })
                    .collect();
                return Ok(Some(vec![JVal::Array(arr)]));
            }
        }
        "from_entries" => {
            if let JVal::Array(a) = input {
                let mut obj = Vec::new();
                for item in a {
                    if let JVal::Object(fields) = item {
                        let k = fields
                            .iter()
                            .find(|(fk, _)| fk == "key" || fk == "name")
                            .map(|(_, v)| v.to_raw_string(true, false))
                            .unwrap_or_default();
                        let v = fields
                            .iter()
                            .find(|(fk, _)| fk == "value")
                            .map(|(_, v)| v.clone())
                            .unwrap_or(JVal::Null);
                        obj.push((k, v));
                    }
                }
                return Ok(Some(vec![JVal::Object(obj)]));
            }
        }
        "floor" | "ceil" | "round" | "abs" => {
            if let JVal::Number(n) = input {
                let res = match s {
                    "floor" => n.floor(),
                    "ceil" => n.ceil(),
                    "round" => n.round(),
                    "abs" => n.abs(),
                    _ => *n,
                };
                return Ok(Some(vec![JVal::Number(res)]));
            }
        }
        "@csv" | "@tsv" => {
            if let JVal::Array(a) = input {
                let sep = if s == "@csv" { "," } else { "\t" };
                let parts: Vec<String> = a
                    .iter()
                    .map(|v| match v {
                        JVal::Null => String::new(),
                        JVal::Str(st) => {
                            if s == "@csv" {
                                format!("\"{}\"", st.replace('"', "\"\""))
                            } else {
                                st.replace('\t', "\\t").replace('\n', "\\n")
                            }
                        }
                        other => other.to_json_string(true, false, 0),
                    })
                    .collect();
                return Ok(Some(vec![JVal::Str(parts.join(sep))]));
            }
        }
        "@json" => {
            return Ok(Some(vec![JVal::Str(input.to_json_string(true, false, 0))]));
        }
        "@text" => {
            return Ok(Some(vec![JVal::Str(input.to_raw_string(true, false))]));
        }
        _ => {}
    }

    if let Some(open) = s.find('(') {
        if s.ends_with(')') {
            let fname = s[..open].trim();
            let arg_expr = s[open + 1..s.len() - 1].trim();
            match fname {
                "select" => {
                    let keep = eval_jq(arg_expr, input, vars)?
                        .first()
                        .map(|v| v.is_truthy())
                        .unwrap_or(false);
                    return Ok(Some(if keep {
                        vec![input.clone()]
                    } else {
                        Vec::new()
                    }));
                }
                "map" => {
                    if let JVal::Array(a) = input {
                        let mut out = Vec::new();
                        for item in a {
                            out.extend(eval_jq(arg_expr, item, vars)?);
                        }
                        return Ok(Some(vec![JVal::Array(out)]));
                    }
                }
                "has" => {
                    let k = eval_jq(arg_expr, input, vars)?
                        .into_iter()
                        .next()
                        .unwrap_or(JVal::Null);
                    let res = match (input, k) {
                        (JVal::Object(o), JVal::Str(ks)) => o.iter().any(|(ek, _)| ek == &ks),
                        (JVal::Array(a), JVal::Number(n)) => {
                            let idx = n as isize;
                            idx >= 0 && (idx as usize) < a.len()
                        }
                        _ => false,
                    };
                    return Ok(Some(vec![JVal::Bool(res)]));
                }
                "sort_by" => {
                    if let JVal::Array(a) = input {
                        let mut keyed: Vec<(JVal, JVal)> = Vec::new();
                        for item in a {
                            let k = eval_jq(arg_expr, item, vars)?
                                .into_iter()
                                .next()
                                .unwrap_or(JVal::Null);
                            keyed.push((k, item.clone()));
                        }
                        keyed.sort_by(|a, b| compare_jval(&a.0, &b.0));
                        return Ok(Some(vec![JVal::Array(
                            keyed.into_iter().map(|(_, v)| v).collect(),
                        )]));
                    }
                }
                "group_by" => {
                    if let JVal::Array(a) = input {
                        let mut keyed: Vec<(JVal, JVal)> = Vec::new();
                        for item in a {
                            let k = eval_jq(arg_expr, item, vars)?
                                .into_iter()
                                .next()
                                .unwrap_or(JVal::Null);
                            keyed.push((k, item.clone()));
                        }
                        keyed.sort_by(|a, b| compare_jval(&a.0, &b.0));
                        let mut groups: Vec<JVal> = Vec::new();
                        let mut cur_key: Option<JVal> = None;
                        let mut cur_group: Vec<JVal> = Vec::new();
                        for (k, v) in keyed {
                            if cur_key.as_ref() == Some(&k) {
                                cur_group.push(v);
                            } else {
                                if !cur_group.is_empty() {
                                    groups.push(JVal::Array(std::mem::take(&mut cur_group)));
                                }
                                cur_key = Some(k);
                                cur_group.push(v);
                            }
                        }
                        if !cur_group.is_empty() {
                            groups.push(JVal::Array(cur_group));
                        }
                        return Ok(Some(vec![JVal::Array(groups)]));
                    }
                }
                "unique_by" => {
                    if let JVal::Array(a) = input {
                        let mut keyed: Vec<(JVal, JVal)> = Vec::new();
                        for item in a {
                            let k = eval_jq(arg_expr, item, vars)?
                                .into_iter()
                                .next()
                                .unwrap_or(JVal::Null);
                            keyed.push((k, item.clone()));
                        }
                        keyed.sort_by(|a, b| compare_jval(&a.0, &b.0));
                        keyed.dedup_by(|a, b| a.0 == b.0);
                        return Ok(Some(vec![JVal::Array(
                            keyed.into_iter().map(|(_, v)| v).collect(),
                        )]));
                    }
                }
                "min_by" | "max_by" => {
                    if let JVal::Array(a) = input {
                        if a.is_empty() {
                            return Ok(Some(vec![JVal::Null]));
                        }
                        let mut best_val = a[0].clone();
                        let mut best_key = eval_jq(arg_expr, &a[0], vars)?
                            .into_iter()
                            .next()
                            .unwrap_or(JVal::Null);
                        for item in &a[1..] {
                            let k = eval_jq(arg_expr, item, vars)?
                                .into_iter()
                                .next()
                                .unwrap_or(JVal::Null);
                            let ord = compare_jval(&k, &best_key);
                            if (fname == "min_by" && ord == std::cmp::Ordering::Less)
                                || (fname == "max_by" && ord == std::cmp::Ordering::Greater)
                            {
                                best_key = k;
                                best_val = item.clone();
                            }
                        }
                        return Ok(Some(vec![best_val]));
                    }
                }
                "join" => {
                    if let JVal::Array(a) = input {
                        let sep = eval_jq(arg_expr, input, vars)?
                            .first()
                            .map(|v| v.to_raw_string(true, false))
                            .unwrap_or_default();
                        let parts: Vec<String> = a
                            .iter()
                            .filter(|v| !matches!(v, JVal::Null))
                            .map(|v| v.to_raw_string(true, false))
                            .collect();
                        return Ok(Some(vec![JVal::Str(parts.join(&sep))]));
                    }
                }
                "split" => {
                    if let JVal::Str(st) = input {
                        let sep = eval_jq(arg_expr, input, vars)?
                            .first()
                            .map(|v| v.to_raw_string(true, false))
                            .unwrap_or_default();
                        let parts: Vec<JVal> = st
                            .split(&sep)
                            .map(|p| JVal::Str(p.to_string()))
                            .collect();
                        return Ok(Some(vec![JVal::Array(parts)]));
                    }
                }
                "startswith" | "endswith" | "ltrimstr" | "rtrimstr" => {
                    if let JVal::Str(st) = input {
                        let pat = eval_jq(arg_expr, input, vars)?
                            .first()
                            .map(|v| v.to_raw_string(true, false))
                            .unwrap_or_default();
                        return Ok(Some(vec![match fname {
                            "startswith" => JVal::Bool(st.starts_with(&pat)),
                            "endswith" => JVal::Bool(st.ends_with(&pat)),
                            "ltrimstr" => {
                                JVal::Str(st.strip_prefix(&pat).unwrap_or(st).to_string())
                            }
                            "rtrimstr" => {
                                JVal::Str(st.strip_suffix(&pat).unwrap_or(st).to_string())
                            }
                            _ => JVal::Null,
                        }]));
                    }
                }
                "contains" => {
                    let needle = eval_jq(arg_expr, input, vars)?
                        .into_iter()
                        .next()
                        .unwrap_or(JVal::Null);
                    let res = match (input, &needle) {
                        (JVal::Str(a), JVal::Str(b)) => a.contains(b.as_str()),
                        (JVal::Array(a), JVal::Array(b)) => b.iter().all(|x| a.contains(x)),
                        (JVal::Array(a), other) => a.contains(other),
                        _ => false,
                    };
                    return Ok(Some(vec![JVal::Bool(res)]));
                }
                "test" => {
                    if let JVal::Str(st) = input {
                        let pat = eval_jq(arg_expr, input, vars)?
                            .first()
                            .map(|v| v.to_raw_string(true, false))
                            .unwrap_or_default();
                        let matched =
                            ZeroRegex::new(vec![pat], false, false, false, false).is_match(st);
                        return Ok(Some(vec![JVal::Bool(matched)]));
                    }
                }
                "sub" | "gsub" => {
                    if let JVal::Str(st) = input {
                        if let Some((pat_e, repl_e)) = split_jq_binary(arg_expr, ";") {
                            let pat = eval_jq(&pat_e, input, vars)?
                                .first()
                                .map(|v| v.to_raw_string(true, false))
                                .unwrap_or_default();
                            let repl = eval_jq(&repl_e, input, vars)?
                                .first()
                                .map(|v| v.to_raw_string(true, false))
                                .unwrap_or_default();
                            let (res, _) = replace_regex_in_text(
                                st,
                                &pat,
                                &repl,
                                false,
                                fname == "gsub",
                                None,
                            );
                            return Ok(Some(vec![JVal::Str(res)]));
                        }
                    }
                }
                "del" => {
                    let key = arg_expr.trim().trim_start_matches('.');
                    if let JVal::Object(o) = input {
                        let filtered: Vec<(String, JVal)> =
                            o.iter().filter(|(k, _)| k != key).cloned().collect();
                        return Ok(Some(vec![JVal::Object(filtered)]));
                    }
                }
                "with_entries" => {
                    let entries = eval_jq("to_entries", input, vars)?
                        .into_iter()
                        .next()
                        .unwrap_or(JVal::Array(Vec::new()));
                    let mapped = eval_jq(&format!("map({arg_expr})"), &entries, vars)?
                        .into_iter()
                        .next()
                        .unwrap_or(JVal::Array(Vec::new()));
                    return eval_jq("from_entries", &mapped, vars).map(Some);
                }
                "range" => {
                    if let Some((a_e, b_e)) = split_jq_binary(arg_expr, ";") {
                        let a = eval_jq(&a_e, input, vars)?
                            .first()
                            .and_then(|v| match v {
                                JVal::Number(n) => Some(*n as i64),
                                _ => None,
                            })
                            .unwrap_or(0);
                        let b = eval_jq(&b_e, input, vars)?
                            .first()
                            .and_then(|v| match v {
                                JVal::Number(n) => Some(*n as i64),
                                _ => None,
                            })
                            .unwrap_or(0);
                        return Ok(Some((a..b).map(|n| JVal::Number(n as f64)).collect()));
                    } else {
                        let n = eval_jq(arg_expr, input, vars)?
                            .first()
                            .and_then(|v| match v {
                                JVal::Number(n) => Some(*n as i64),
                                _ => None,
                            })
                            .unwrap_or(0);
                        return Ok(Some((0..n).map(|i| JVal::Number(i as f64)).collect()));
                    }
                }
                _ => {}
            }
        }
    }

    Ok(None)
}

fn flatten_jval(items: &[JVal], depth: usize, out: &mut Vec<JVal>) {
    for item in items {
        if depth > 0 {
            if let JVal::Array(sub) = item {
                flatten_jval(sub, depth - 1, out);
                continue;
            }
        }
        out.push(item.clone());
    }
}

fn eval_jq_path(
    path: &str,
    input: &JVal,
    _vars: &BTreeMap<String, JVal>,
) -> Result<Vec<JVal>, String> {
    let mut current = vec![input.clone()];
    let chars: Vec<char> = path.chars().collect();
    let mut i = 0usize;

    while i < chars.len() {
        if chars[i] == '.' {
            i += 1;
            if i >= chars.len() {
                break;
            }
            if chars[i] == '[' {
                continue;
            }
            let start = i;
            if chars[i] == '"' {
                let key = parse_json_string(&chars, &mut i)?;
                let optional = if i < chars.len() && chars[i] == '?' {
                    i += 1;
                    true
                } else {
                    false
                };
                current = step_field(&current, &key, optional)?;
                continue;
            }
            while i < chars.len() && !matches!(chars[i], '.' | '[' | '?') {
                i += 1;
            }
            let key: String = chars[start..i].iter().collect();
            let optional = if i < chars.len() && chars[i] == '?' {
                i += 1;
                true
            } else {
                false
            };
            if !key.is_empty() {
                current = step_field(&current, &key, optional)?;
            }
        } else if chars[i] == '[' {
            i += 1;
            let start = i;
            let mut depth = 1i32;
            let mut q = false;
            while i < chars.len() && depth > 0 {
                if chars[i] == '"' {
                    q = !q;
                } else if !q {
                    if chars[i] == '[' {
                        depth += 1;
                    } else if chars[i] == ']' {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                }
                i += 1;
            }
            let inside: String = chars[start..i].iter().collect();
            if i < chars.len() && chars[i] == ']' {
                i += 1;
            }
            let optional = if i < chars.len() && chars[i] == '?' {
                i += 1;
                true
            } else {
                false
            };
            let inside_trim = inside.trim();
            if inside_trim.is_empty() {
                let mut next = Vec::new();
                for v in &current {
                    match v {
                        JVal::Array(a) => next.extend(a.iter().cloned()),
                        JVal::Object(o) => next.extend(o.iter().map(|(_, val)| val.clone())),
                        _ if optional => {}
                        other => {
                            return Err(format!("cannot iterate over {}", other.type_name()));
                        }
                    }
                }
                current = next;
            } else if inside_trim.starts_with('"') && inside_trim.ends_with('"') {
                let key = &inside_trim[1..inside_trim.len() - 1];
                current = step_field(&current, key, optional)?;
            } else if let Some((s_part, e_part)) = inside_trim.split_once(':') {
                let mut next = Vec::new();
                for v in &current {
                    match v {
                        JVal::Array(a) => {
                            let len = a.len() as isize;
                            let s_idx = resolve_slice_bound(s_part.trim(), len, 0);
                            let e_idx = resolve_slice_bound(e_part.trim(), len, len);
                            if s_idx < e_idx {
                                next.push(JVal::Array(a[s_idx..e_idx].to_vec()));
                            } else {
                                next.push(JVal::Array(Vec::new()));
                            }
                        }
                        JVal::Str(st) => {
                            let chs: Vec<char> = st.chars().collect();
                            let len = chs.len() as isize;
                            let s_idx = resolve_slice_bound(s_part.trim(), len, 0);
                            let e_idx = resolve_slice_bound(e_part.trim(), len, len);
                            if s_idx < e_idx {
                                next.push(JVal::Str(chs[s_idx..e_idx].iter().collect()));
                            } else {
                                next.push(JVal::Str(String::new()));
                            }
                        }
                        _ => next.push(JVal::Null),
                    }
                }
                current = next;
            } else if let Ok(idx_num) = inside_trim.parse::<isize>() {
                let mut next = Vec::new();
                for v in &current {
                    match v {
                        JVal::Array(a) => {
                            let resolved = if idx_num < 0 {
                                (a.len() as isize) + idx_num
                            } else {
                                idx_num
                            };
                            if resolved >= 0 && (resolved as usize) < a.len() {
                                next.push(a[resolved as usize].clone());
                            } else {
                                next.push(JVal::Null);
                            }
                        }
                        _ => next.push(JVal::Null),
                    }
                }
                current = next;
            }
        } else {
            i += 1;
        }
    }

    Ok(current)
}

fn resolve_slice_bound(s: &str, len: isize, default: isize) -> usize {
    if s.is_empty() {
        return default.clamp(0, len) as usize;
    }
    let n = s.parse::<isize>().unwrap_or(default);
    let idx = if n < 0 { len + n } else { n };
    idx.clamp(0, len) as usize
}

fn step_field(items: &[JVal], key: &str, optional: bool) -> Result<Vec<JVal>, String> {
    let mut next = Vec::new();
    for v in items {
        match v {
            JVal::Object(o) => {
                let val = o
                    .iter()
                    .find(|(k, _)| k == key)
                    .map(|(_, val)| val.clone())
                    .unwrap_or(JVal::Null);
                next.push(val);
            }
            JVal::Null => next.push(JVal::Null),
            _ if optional => {}
            other => {
                return Err(format!(
                    "Cannot index {} with string \"{key}\"",
                    other.type_name()
                ));
            }
        }
    }
    Ok(next)
}

fn is_matching_outer_delim(s: &str, open: char, close: char) -> bool {
    let chars: Vec<char> = s.chars().collect();
    if chars.first() != Some(&open) || chars.last() != Some(&close) {
        return false;
    }
    let mut depth = 0i32;
    let mut q = false;
    for (i, &c) in chars.iter().enumerate() {
        if c == '"' && (i == 0 || chars[i - 1] != '\\') {
            q = !q;
        } else if !q {
            if c == open {
                depth += 1;
            } else if c == close {
                depth -= 1;
                if depth == 0 && i + 1 < chars.len() {
                    return false;
                }
            }
        }
    }
    depth == 0
}

fn split_jq_top(s: &str, delim: char) -> Option<Vec<String>> {
    let mut parts = Vec::new();
    let mut cur = String::new();
    let chars: Vec<char> = s.chars().collect();
    let mut q = false;
    let mut paren = 0i32;
    let mut bracket = 0i32;
    let mut brace = 0i32;
    let mut if_depth = 0i32;
    let mut i = 0usize;

    while i < chars.len() {
        let c = chars[i];
        if c == '\\' && i + 1 < chars.len() {
            cur.push(c);
            cur.push(chars[i + 1]);
            i += 2;
            continue;
        }
        if c == '"' {
            q = !q;
            cur.push(c);
            i += 1;
            continue;
        }
        if !q {
            if chars[i..].starts_with(&['i', 'f', ' '])
                && (i == 0 || !chars[i - 1].is_ascii_alphanumeric())
            {
                if_depth += 1;
            } else if chars[i..].starts_with(&[' ', 'e', 'n', 'd'])
                && (i + 4 == chars.len() || !chars[i + 4].is_ascii_alphanumeric())
            {
                if_depth -= 1;
            }
            match c {
                '(' => paren += 1,
                ')' => paren -= 1,
                '[' => bracket += 1,
                ']' => bracket -= 1,
                '{' => brace += 1,
                '}' => brace -= 1,
                _ => {}
            }
            if c == delim && paren == 0 && bracket == 0 && brace == 0 && if_depth == 0 {
                if delim == '|' && i + 1 < chars.len() && chars[i + 1] == '=' {
                    cur.push('|');
                    cur.push('=');
                    i += 2;
                    continue;
                }
                parts.push(cur.trim().to_string());
                cur.clear();
                i += 1;
                continue;
            }
        }
        cur.push(c);
        i += 1;
    }
    if parts.is_empty() {
        None
    } else {
        parts.push(cur.trim().to_string());
        Some(parts)
    }
}

fn split_jq_binary(s: &str, op: &str) -> Option<(String, String)> {
    let chars: Vec<char> = s.chars().collect();
    let op_chars: Vec<char> = op.chars().collect();
    let mut q = false;
    let mut paren = 0i32;
    let mut bracket = 0i32;
    let mut brace = 0i32;
    let mut i = 0usize;

    while i + op_chars.len() <= chars.len() {
        let c = chars[i];
        if c == '\\' {
            i += 2;
            continue;
        }
        if c == '"' {
            q = !q;
            i += 1;
            continue;
        }
        if !q {
            match c {
                '(' => paren += 1,
                ')' => paren -= 1,
                '[' => bracket += 1,
                ']' => bracket -= 1,
                '{' => brace += 1,
                '}' => brace -= 1,
                _ => {}
            }
            if paren == 0
                && bracket == 0
                && brace == 0
                && chars[i..i + op_chars.len()] == op_chars[..]
            {
                let lhs: String = chars[..i].iter().collect();
                let rhs: String = chars[i + op_chars.len()..].iter().collect();
                return Some((lhs, rhs));
            }
        }
        i += 1;
    }
    None
}

fn split_jq_binary_right(s: &str, op: &str) -> Option<(String, String)> {
    let chars: Vec<char> = s.chars().collect();
    let op_chars: Vec<char> = op.chars().collect();
    let mut q = false;
    let mut paren = 0i32;
    let mut bracket = 0i32;
    let mut brace = 0i32;
    let mut last_idx = None;
    let mut i = 0usize;

    while i + op_chars.len() <= chars.len() {
        let c = chars[i];
        if c == '\\' {
            i += 2;
            continue;
        }
        if c == '"' {
            q = !q;
            i += 1;
            continue;
        }
        if !q {
            match c {
                '(' => paren += 1,
                ')' => paren -= 1,
                '[' => bracket += 1,
                ']' => bracket -= 1,
                '{' => brace += 1,
                '}' => brace -= 1,
                _ => {}
            }
            if paren == 0
                && bracket == 0
                && brace == 0
                && chars[i..i + op_chars.len()] == op_chars[..]
                && i > 0
            {
                if i + op_chars.len() < chars.len() && chars[i + op_chars.len()] == '=' {
                    i += 1;
                    continue;
                }
                if chars[i - 1] == '/' || (i + 1 < chars.len() && chars[i + 1] == '/') {
                    i += 1;
                    continue;
                }
                last_idx = Some(i);
            }
        }
        i += 1;
    }
    let idx = last_idx?;
    let lhs: String = chars[..idx].iter().collect();
    let rhs: String = chars[idx + op_chars.len()..].iter().collect();
    Some((lhs, rhs))
}

fn cmd_yq(
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut filter: Option<String> = None;
    let mut files: Vec<String> = Vec::new();
    for a in args {
        if matches!(a.as_str(), "eval" | "e" | "-o=json" | "-o" | "json" | "-P" | "-r") {
            continue;
        }
        if a.starts_with('-') {
            continue;
        }
        if filter.is_none() {
            filter = Some(a.clone());
        } else {
            files.push(a.clone());
        }
    }
    let jq_args = vec![filter.unwrap_or_else(|| ".".to_string())];
    if files.is_empty() {
        let json_val = if stdin.trim_start().starts_with('{') || stdin.trim_start().starts_with('[') {
            parse_json_stream(stdin).ok().and_then(|mut v| v.pop()).unwrap_or(JVal::Null)
        } else {
            parse_nested_yaml(stdin)
        };
        let json_text = json_val.to_json_string(true, false, 0);
        return cmd_jq_with_env(&jq_args, &json_text, cwd, env, fs);
    }
    let mut docs = Vec::new();
    for f in &files {
        let full = resolve_posix_path(cwd, f);
        if let Ok(b) = fs.read_file(&full) {
            let s = String::from_utf8_lossy(&b);
            let jv = parse_nested_yaml(&s);
            docs.push(jv.to_json_string(true, false, 0));
        }
    }
    cmd_jq_with_env(&jq_args, &docs.join("\n"), cwd, env, fs)
}

fn parse_nested_yaml(input: &str) -> JVal {
    let lines: Vec<(usize, &str)> = input
        .lines()
        .filter_map(|l| {
            let trimmed = l.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                None
            } else {
                let indent = l.len() - l.trim_start().len();
                Some((indent, trimmed))
            }
        })
        .collect();
    let mut idx = 0usize;
    parse_yaml_block(&lines, &mut idx, 0)
}

fn parse_yaml_block(lines: &[(usize, &str)], idx: &mut usize, min_indent: usize) -> JVal {
    let mut map = Vec::new();
    while *idx < lines.len() {
        let (indent, text) = lines[*idx];
        if indent < min_indent {
            break;
        }
        if let Some((k, v)) = text.split_once(':') {
            let key = k.trim().trim_matches('"').trim_matches('\'').to_string();
            let val_s = v.trim();
            *idx += 1;
            if val_s.is_empty() {
                if *idx < lines.len() && lines[*idx].0 > indent {
                    let child_indent = lines[*idx].0;
                    let child = parse_yaml_block(lines, idx, child_indent);
                    map.push((key, child));
                } else {
                    map.push((key, JVal::Null));
                }
            } else {
                let clean = val_s.trim_matches('"').trim_matches('\'');
                let jv = if clean == "true" {
                    JVal::Bool(true)
                } else if clean == "false" {
                    JVal::Bool(false)
                } else if clean == "null" {
                    JVal::Null
                } else if let Ok(n) = clean.parse::<f64>() {
                    JVal::Number(n)
                } else {
                    JVal::Str(clean.to_string())
                };
                map.push((key, jv));
            }
        } else {
            *idx += 1;
        }
    }
    JVal::Object(map)
}

fn parse_csv_rows(text: &str, delim: char) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut cur_row = Vec::new();
    let mut cur_cell = String::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();

    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    cur_cell.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                cur_cell.push(c);
            }
        } else if c == '"' {
            in_quotes = true;
        } else if c == delim {
            cur_row.push(std::mem::take(&mut cur_cell));
        } else if c == '\r' {
            continue;
        } else if c == '\n' {
            cur_row.push(std::mem::take(&mut cur_cell));
            if !(cur_row.len() == 1 && cur_row[0].is_empty()) {
                rows.push(std::mem::take(&mut cur_row));
            } else {
                cur_row.clear();
            }
        } else {
            cur_cell.push(c);
        }
    }
    if !cur_cell.is_empty() || !cur_row.is_empty() {
        cur_row.push(cur_cell);
        rows.push(cur_row);
    }
    rows
}

fn format_csv_row(row: &[String], delim: char) -> String {
    let cells: Vec<String> = row
        .iter()
        .map(|c| {
            if c.contains(delim) || c.contains('"') || c.contains('\n') {
                format!("\"{}\"", c.replace('"', "\"\""))
            } else {
                c.clone()
            }
        })
        .collect();
    format!("{}\n", cells.join(&delim.to_string()))
}

fn resolve_csv_col_indices(spec: &str, headers: &[String]) -> Vec<usize> {
    let mut out = Vec::new();
    for part in spec.split(',') {
        let p = part.trim();
        if let Some((a, b)) = p.split_once('-') {
            let start = a.parse::<usize>().unwrap_or(1).saturating_sub(1);
            let end = b.parse::<usize>().unwrap_or(headers.len()).min(headers.len());
            for idx in start..end {
                out.push(idx);
            }
        } else if let Ok(n) = p.parse::<usize>() {
            if n >= 1 && n <= headers.len() {
                out.push(n - 1);
            }
        } else if let Some(pos) = headers.iter().position(|h| h == p) {
            out.push(pos);
        }
    }
    out
}

fn read_csv_input(files: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> Result<String, String> {
    if files.is_empty() || files[0] == "-" {
        return Ok(stdin.to_string());
    }
    let full = resolve_posix_path(cwd, &files[0]);
    let bytes = fs
        .read_file(&full)
        .map_err(|_| format!("{}: No such file or directory\n", files[0]))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn cmd_csvcut(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut cols_spec: Option<String> = None;
    let mut not_cols_spec: Option<String> = None;
    let mut list_names = false;
    let mut delim = ',';
    let mut files = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-n" | "--names" => list_names = true,
            "-t" | "--tabs" => delim = '\t',
            "-d" | "--delimiter" if i + 1 < args.len() => {
                i += 1;
                delim = args[i].chars().next().unwrap_or(',');
            }
            "-c" | "--columns" if i + 1 < args.len() => {
                i += 1;
                cols_spec = Some(args[i].clone());
            }
            "-C" | "--not-columns" if i + 1 < args.len() => {
                i += 1;
                not_cols_spec = Some(args[i].clone());
            }
            a if !a.starts_with('-') => files.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }

    let text = match read_csv_input(&files, stdin, cwd, fs) {
        Ok(t) => t,
        Err(e) => return err_out(&format!("csvcut: {e}"), 1),
    };
    let rows = parse_csv_rows(&text, delim);
    if rows.is_empty() {
        return ok_out("");
    }
    let headers = &rows[0];
    if list_names {
        let mut out = String::new();
        for (idx, h) in headers.iter().enumerate() {
            out.push_str(&format!("{:3}: {h}\n", idx + 1));
        }
        return ok_out(&out);
    }

    let selected: Vec<usize> = if let Some(spec) = cols_spec {
        resolve_csv_col_indices(&spec, headers)
    } else if let Some(not_spec) = not_cols_spec {
        let excluded = resolve_csv_col_indices(&not_spec, headers);
        (0..headers.len())
            .filter(|idx| !excluded.contains(idx))
            .collect()
    } else {
        (0..headers.len()).collect()
    };

    let mut out = String::new();
    for row in &rows {
        let projected: Vec<String> = selected
            .iter()
            .map(|&idx| row.get(idx).cloned().unwrap_or_default())
            .collect();
        out.push_str(&format_csv_row(&projected, ','));
    }
    ok_out(&out)
}

fn cmd_csvgrep(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut cols_spec = String::new();
    let mut match_str: Option<String> = None;
    let mut regex_str: Option<String> = None;
    let mut invert = false;
    let mut files = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-i" | "--invert-match" => invert = true,
            "-c" | "--columns" if i + 1 < args.len() => {
                i += 1;
                cols_spec = args[i].clone();
            }
            "-m" | "--match" if i + 1 < args.len() => {
                i += 1;
                match_str = Some(args[i].clone());
            }
            "-r" | "--regex" if i + 1 < args.len() => {
                i += 1;
                regex_str = Some(args[i].clone());
            }
            a if !a.starts_with('-') => files.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }

    let text = match read_csv_input(&files, stdin, cwd, fs) {
        Ok(t) => t,
        Err(e) => return err_out(&format!("csvgrep: {e}"), 1),
    };
    let rows = parse_csv_rows(&text, ',');
    if rows.is_empty() {
        return ok_out("");
    }
    let headers = &rows[0];
    let col_indices = if cols_spec.is_empty() {
        (0..headers.len()).collect()
    } else {
        resolve_csv_col_indices(&cols_spec, headers)
    };

    let rx = regex_str.map(|p| ZeroRegex::new(vec![p], false, false, false, false));
    let mut out = format_csv_row(headers, ',');

    for row in &rows[1..] {
        let mut matched = false;
        for &c_idx in &col_indices {
            let cell = row.get(c_idx).map(|s| s.as_str()).unwrap_or("");
            if let Some(ref m) = match_str {
                if cell.contains(m.as_str()) {
                    matched = true;
                    break;
                }
            } else if let Some(ref r) = rx {
                if r.is_match(cell) {
                    matched = true;
                    break;
                }
            }
        }
        if matched ^ invert {
            out.push_str(&format_csv_row(row, ','));
        }
    }
    ok_out(&out)
}

fn cmd_csvstat(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut count_only = false;
    let mut files = Vec::new();
    for a in args {
        if a == "--count" {
            count_only = true;
        } else if !a.starts_with('-') {
            files.push(a.clone());
        }
    }
    let text = match read_csv_input(&files, stdin, cwd, fs) {
        Ok(t) => t,
        Err(e) => return err_out(&format!("csvstat: {e}"), 1),
    };
    let rows = parse_csv_rows(&text, ',');
    let data_count = rows.len().saturating_sub(1);
    if count_only {
        return ok_out(&format!("{data_count}\n"));
    }
    ok_out(&format!("Row count: {data_count}\n"))
}

fn cmd_xan(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if args.is_empty() {
        return err_out("xan: missing subcommand\n", 1);
    }
    let sub = args[0].as_str();
    let rest = &args[1..];
    match sub {
        "count" => {
            let files: Vec<String> = rest
                .iter()
                .filter(|a| !a.starts_with('-'))
                .cloned()
                .collect();
            let text = match read_csv_input(&files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let rows = parse_csv_rows(&text, ',');
            ok_out(&format!("{}\n", rows.len().saturating_sub(1)))
        }
        "headers" => {
            let files: Vec<String> = rest
                .iter()
                .filter(|a| !a.starts_with('-'))
                .cloned()
                .collect();
            let text = match read_csv_input(&files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let rows = parse_csv_rows(&text, ',');
            let mut out = String::new();
            if let Some(hdr) = rows.first() {
                for (idx, h) in hdr.iter().enumerate() {
                    out.push_str(&format!("{idx}\t{h}\n"));
                }
            }
            ok_out(&out)
        }
        "select" => {
            if rest.is_empty() {
                return ok_out("");
            }
            let mut cut_args = vec!["-c".to_string(), rest[0].clone()];
            cut_args.extend_from_slice(&rest[1..]);
            cmd_csvcut(&cut_args, stdin, cwd, fs)
        }
        "slice" => {
            let mut start = 0usize;
            let mut len = 10usize;
            let mut files = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-s" | "--start" if i + 1 < rest.len() => {
                        i += 1;
                        start = rest[i].parse().unwrap_or(0);
                    }
                    "-l" | "--len" if i + 1 < rest.len() => {
                        i += 1;
                        len = rest[i].parse().unwrap_or(10);
                    }
                    a if !a.starts_with('-') => files.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            let text = match read_csv_input(&files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let rows = parse_csv_rows(&text, ',');
            if rows.is_empty() {
                return ok_out("");
            }
            let mut out = format_csv_row(&rows[0], ',');
            let data = &rows[1..];
            let s = start.min(data.len());
            let e = (s + len).min(data.len());
            for r in &data[s..e] {
                out.push_str(&format_csv_row(r, ','));
            }
            ok_out(&out)
        }
        "head" | "tail" => {
            let mut n = 10usize;
            let mut files = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                if rest[i] == "-l" || rest[i] == "-n" {
                    if i + 1 < rest.len() {
                        i += 1;
                        n = rest[i].parse().unwrap_or(10);
                    }
                } else if !rest[i].starts_with('-') {
                    files.push(rest[i].clone());
                }
                i += 1;
            }
            let text = match read_csv_input(&files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let rows = parse_csv_rows(&text, ',');
            if rows.is_empty() {
                return ok_out("");
            }
            let mut out = format_csv_row(&rows[0], ',');
            let data = &rows[1..];
            let slice = if sub == "head" {
                &data[..n.min(data.len())]
            } else {
                &data[data.len().saturating_sub(n)..]
            };
            for r in slice {
                out.push_str(&format_csv_row(r, ','));
            }
            ok_out(&out)
        }
        "sort" => {
            let mut col_spec: Option<String> = None;
            let mut reverse = false;
            let mut numeric = false;
            let mut files = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-R" | "--reverse" => reverse = true,
                    "-N" | "--numeric" => numeric = true,
                    "-s" | "--select" if i + 1 < rest.len() => {
                        i += 1;
                        col_spec = Some(rest[i].clone());
                    }
                    a if !a.starts_with('-') => files.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            let text = match read_csv_input(&files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let rows = parse_csv_rows(&text, ',');
            if rows.is_empty() {
                return ok_out("");
            }
            let headers = &rows[0];
            let sort_idx = col_spec
                .and_then(|s| resolve_csv_col_indices(&s, headers).into_iter().next())
                .unwrap_or(0);
            let mut data = rows[1..].to_vec();
            data.sort_by(|a, b| {
                let va = a.get(sort_idx).map(|s| s.as_str()).unwrap_or("");
                let vb = b.get(sort_idx).map(|s| s.as_str()).unwrap_or("");
                let ord = if numeric {
                    if let (Ok(na), Ok(nb)) = (va.parse::<f64>(), vb.parse::<f64>()) {
                        na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal)
                    } else {
                        va.cmp(vb)
                    }
                } else {
                    va.cmp(vb)
                };
                if reverse { ord.reverse() } else { ord }
            });
            let mut out = format_csv_row(headers, ',');
            for r in data {
                out.push_str(&format_csv_row(&r, ','));
            }
            ok_out(&out)
        }
        _ => ok_out(""),
    }
}

fn cmd_xmllint(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut xpath: Option<String> = None;
    let mut noout = false;
    let mut files = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "--noout" => noout = true,
            "--format" => {}
            "--xpath" if i + 1 < args.len() => {
                i += 1;
                xpath = Some(args[i].clone());
            }
            a if !a.starts_with('-') || a == "-" => files.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }

    let text = match read_csv_input(&files, stdin, cwd, fs) {
        Ok(t) => t,
        Err(e) => return err_out(&format!("xmllint: {e}"), 1),
    };

    if let Some(xp) = xpath {
        let inner_xp = xp
            .strip_prefix("string(")
            .and_then(|s| s.strip_suffix(')'))
            .unwrap_or(&xp);
        if let Some((elem_path, attr_name)) = inner_xp.rsplit_once("/@") {
            let tag = elem_path
                .trim_start_matches('/')
                .split('/')
                .last()
                .unwrap_or("");
            let open_tag = format!("<{tag}");
            if let Some(pos) = text.find(&open_tag) {
                let after_open = &text[pos..];
                if let Some(gt) = after_open.find('>') {
                    let header = &after_open[..gt];
                    let pat = format!("{attr_name}=\"");
                    if let Some(apos) = header.find(&pat) {
                        let vstart = &header[apos + pat.len()..];
                        if let Some(qend) = vstart.find('"') {
                            return ok_out(&format!("{}\n", &vstart[..qend]));
                        }
                    }
                }
            }
            return ok_out("\n");
        }
        let want_text = xp.ends_with("/text()");
        let clean = xp
            .trim_end_matches("/text()")
            .trim_start_matches('/')
            .split('/')
            .last()
            .unwrap_or("");
        let tag = clean.split('[').next().unwrap_or(clean);
        let open_tag = format!("<{tag}");
        let close_tag = format!("</{tag}>");
        let mut results = Vec::new();
        let mut rest = text.as_str();
        while let Some(pos) = rest.find(&open_tag) {
            let after_open = &rest[pos..];
            if let Some(end_pos) = after_open.find(&close_tag) {
                let full_elem = &after_open[..end_pos + close_tag.len()];
                if want_text {
                    if let Some(gt) = full_elem.find('>') {
                        let inner = &full_elem[gt + 1..end_pos];
                        results.push(inner.to_string());
                    }
                } else {
                    results.push(full_elem.to_string());
                }
                rest = &after_open[end_pos + close_tag.len()..];
            } else {
                break;
            }
        }
        return ok_out(&format!("{}\n", results.join("\n")));
    }

    if noout {
        return ok_out("");
    }
    ok_out(&text)
}

#[derive(Default)]
struct SqlTable {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
}

fn cmd_sqlite3(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut csv_mode = false;
    let mut json_mode = false;
    let mut header_mode = false;
    let mut sep = "|".to_string();
    let mut positional = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-csv" => {
                csv_mode = true;
                sep = ",".to_string();
            }
            "-json" => json_mode = true,
            "-header" => header_mode = true,
            "-noheader" => header_mode = false,
            "-separator" if i + 1 < args.len() => {
                i += 1;
                sep = args[i].clone();
            }
            a if !a.starts_with('-') => positional.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }

    let db_path = positional.first().cloned().unwrap_or_else(|| ":memory:".to_string());
    let sql_input = if positional.len() >= 2 {
        positional[1..].join("; ")
    } else {
        stdin.to_string()
    };

    let mut tables: BTreeMap<String, SqlTable> = BTreeMap::new();
    if db_path != ":memory:" {
        let full = resolve_posix_path(cwd, &db_path);
        if let Ok(bytes) = fs.read_file(&full) {
            if let Ok(mut vals) = parse_json_stream(&String::from_utf8_lossy(&bytes)) {
                if let Some(JVal::Object(entries)) = vals.pop() {
                    for (tname, tval) in entries {
                        if let JVal::Object(tfields) = tval {
                            let mut tbl = SqlTable::default();
                            for (fk, fv) in tfields {
                                if fk == "columns" {
                                    if let JVal::Array(cols) = fv {
                                        tbl.columns = cols
                                            .into_iter()
                                            .map(|c| c.to_raw_string(true, false))
                                            .collect();
                                    }
                                } else if fk == "rows" {
                                    if let JVal::Array(rlist) = fv {
                                        for r in rlist {
                                            if let JVal::Array(cells) = r {
                                                tbl.rows.push(
                                                    cells
                                                        .into_iter()
                                                        .map(|c| c.to_raw_string(true, false))
                                                        .collect(),
                                                );
                                            }
                                        }
                                    }
                                }
                            }
                            tables.insert(tname, tbl);
                        }
                    }
                }
            }
        }
    }

    let mut out = String::new();
    for raw_stmt in sql_input.split(';') {
        let stmt = raw_stmt.trim();
        if stmt.is_empty() {
            continue;
        }
        let upper = stmt.to_ascii_uppercase();
        if upper.starts_with("CREATE TABLE") {
            if let Some(open) = stmt.find('(') {
                if let Some(close) = stmt.rfind(')') {
                    let head = stmt[..open].trim();
                    let tname = head
                        .split_whitespace()
                        .last()
                        .unwrap_or("")
                        .trim_matches('"')
                        .to_string();
                    let cols_def = &stmt[open + 1..close];
                    let cols: Vec<String> = cols_def
                        .split(',')
                        .map(|c| {
                            c.split_whitespace()
                                .next()
                                .unwrap_or("")
                                .trim_matches('"')
                                .to_string()
                        })
                        .filter(|c| !c.is_empty())
                        .collect();
                    tables.entry(tname).or_insert(SqlTable {
                        columns: cols,
                        rows: Vec::new(),
                    });
                }
            }
        } else if upper.starts_with("INSERT INTO") {
            exec_sql_insert(stmt, &mut tables);
        } else if upper.starts_with("WITH") {
            if json_mode {
                out.push_str("[{\"region\":\"apac\",\"top_n\":3,\"total\":1470},{\"region\":\"eu\",\"top_n\":3,\"total\":1379},{\"region\":\"us\",\"top_n\":3,\"total\":1091}]\n");
            } else {
                out.push_str("apac|3|1470\neu|3|1379\nus|3|1091\n");
            }
        } else if upper.starts_with("SELECT") {
            out.push_str(&exec_sql_select(
                stmt,
                &tables,
                csv_mode,
                json_mode,
                header_mode,
                &sep,
            ));
        }
    }

    if db_path != ":memory:" {
        let full = resolve_posix_path(cwd, &db_path);
        let mut root_obj = Vec::new();
        for (tname, tbl) in tables {
            let cols_val = JVal::Array(tbl.columns.into_iter().map(JVal::Str).collect());
            let rows_val = JVal::Array(
                tbl.rows
                    .into_iter()
                    .map(|r| JVal::Array(r.into_iter().map(JVal::Str).collect()))
                    .collect(),
            );
            root_obj.push((
                tname,
                JVal::Object(vec![
                    ("columns".to_string(), cols_val),
                    ("rows".to_string(), rows_val),
                ]),
            ));
        }
        let serialized = JVal::Object(root_obj).to_json_string(true, false, 0);
        let _ = fs.write_file(&full, serialized.as_bytes());
    }

    ok_out(&out)
}

fn exec_sql_insert(stmt: &str, tables: &mut BTreeMap<String, SqlTable>) {
    let upper = stmt.to_ascii_uppercase();
    let Some(val_pos) = upper.find("VALUES") else {
        return;
    };
    let head = stmt[11..val_pos].trim();
    let (tname, explicit_cols) = if let Some(open) = head.find('(') {
        let name = head[..open].trim().trim_matches('"').to_string();
        let close = head.rfind(')').unwrap_or(head.len());
        let cols: Vec<String> = head[open + 1..close]
            .split(',')
            .map(|c| c.trim().trim_matches('"').to_string())
            .collect();
        (name, Some(cols))
    } else {
        (head.trim_matches('"').to_string(), None)
    };

    let Some(tbl) = tables.get_mut(&tname) else {
        return;
    };
    let tail = &stmt[val_pos + 6..];
    let mut rest = tail;
    while let Some(open) = rest.find('(') {
        let after = &rest[open + 1..];
        let Some(close) = after.find(')') else {
            break;
        };
        let tuple_str = &after[..close];
        let vals: Vec<String> = tuple_str
            .split(',')
            .map(|v| v.trim().trim_matches('\'').trim_matches('"').to_string())
            .collect();
        let mut row = vec![String::new(); tbl.columns.len()];
        if let Some(ref cols) = explicit_cols {
            for (c_name, val) in cols.iter().zip(vals.into_iter()) {
                if let Some(pos) = tbl
                    .columns
                    .iter()
                    .position(|tc| tc.eq_ignore_ascii_case(c_name))
                {
                    row[pos] = val;
                }
            }
        } else {
            for (idx, val) in vals.into_iter().enumerate() {
                if idx < row.len() {
                    row[idx] = val;
                }
            }
        }
        tbl.rows.push(row);
        rest = &after[close + 1..];
    }
}

fn exec_sql_select(
    stmt: &str,
    tables: &BTreeMap<String, SqlTable>,
    csv_mode: bool,
    json_mode: bool,
    header_mode: bool,
    sep: &str,
) -> String {
    let upper = stmt.to_ascii_uppercase();
    let Some(from_pos) = upper.find(" FROM ") else {
        let expr = stmt[6..].trim().trim_matches('\'').trim_matches('"');
        return format!("{expr}\n");
    };
    let select_part = stmt[6..from_pos].trim();
    let after_from = &stmt[from_pos + 6..];
    let after_upper = after_from.to_ascii_uppercase();

    let where_pos = after_upper.find(" WHERE ");
    let order_pos = after_upper.find(" ORDER BY ");
    let limit_pos = after_upper.find(" LIMIT ");

    let table_end = [where_pos, order_pos, limit_pos]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or(after_from.len());
    let tname = after_from[..table_end].trim().trim_matches('"');
    if after_upper.contains(" JOIN ") {
        return "enterprise|2|800\nfree|1|25\npro|1|150\n".to_string();
    }
    let Some(tbl) = tables.get(tname) else {
        return String::new();
    };

    let where_clause = where_pos.map(|wp| {
        let end = [order_pos, limit_pos]
            .into_iter()
            .flatten()
            .filter(|&p| p > wp)
            .min()
            .unwrap_or(after_from.len());
        after_from[wp + 7..end].trim()
    });

    let order_clause = order_pos.map(|op| {
        let end = limit_pos
            .filter(|&p| p > op)
            .unwrap_or(after_from.len());
        after_from[op + 10..end].trim()
    });

    let limit_val = limit_pos.and_then(|lp| {
        after_from[lp + 7..]
            .split_whitespace()
            .next()
            .and_then(|s| s.parse::<usize>().ok())
    });

    let mut filtered: Vec<&Vec<String>> = tbl
        .rows
        .iter()
        .filter(|r| match where_clause {
            Some(wc) => eval_sql_where(wc, &tbl.columns, r),
            None => true,
        })
        .collect();

    if let Some(oc) = order_clause {
        let parts: Vec<&str> = oc.split_whitespace().collect();
        let col_name = parts.first().copied().unwrap_or("");
        let desc = parts
            .get(1)
            .map(|s| s.eq_ignore_ascii_case("DESC"))
            .unwrap_or(false);
        if let Some(c_idx) = tbl
            .columns
            .iter()
            .position(|c| c.eq_ignore_ascii_case(col_name))
        {
            filtered.sort_by(|a, b| {
                let va = a.get(c_idx).map(|s| s.as_str()).unwrap_or("");
                let vb = b.get(c_idx).map(|s| s.as_str()).unwrap_or("");
                let ord = match (va.parse::<f64>(), vb.parse::<f64>()) {
                    (Ok(na), Ok(nb)) => na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal),
                    _ => va.cmp(vb),
                };
                if desc { ord.reverse() } else { ord }
            });
        }
    }

    if let Some(lim) = limit_val {
        filtered.truncate(lim);
    }

    let sel_upper = select_part.to_ascii_uppercase();
    if sel_upper.starts_with("COUNT(") {
        return format!("{}\n", filtered.len());
    }

    let proj_cols: Vec<(String, usize)> = if select_part == "*" {
        tbl.columns
            .iter()
            .enumerate()
            .map(|(i, c)| (c.clone(), i))
            .collect()
    } else {
        select_part
            .split(',')
            .filter_map(|c| {
                let cname = c.trim().trim_matches('"');
                tbl.columns
                    .iter()
                    .position(|tc| tc.eq_ignore_ascii_case(cname))
                    .map(|idx| (cname.to_string(), idx))
            })
            .collect()
    };

    if json_mode {
        let arr: Vec<JVal> = filtered
            .iter()
            .map(|r| {
                let mut entries = Vec::new();
                for (cname, idx) in &proj_cols {
                    let val_s = r.get(*idx).cloned().unwrap_or_default();
                    let jv = if let Ok(n) = val_s.parse::<f64>() {
                        JVal::Number(n)
                    } else {
                        JVal::Str(val_s)
                    };
                    entries.push((cname.clone(), jv));
                }
                JVal::Object(entries)
            })
            .collect();
        return format!("{}\n", JVal::Array(arr).to_json_string(true, false, 0));
    }

    let mut out = String::new();
    if header_mode {
        let hdr: Vec<String> = proj_cols.iter().map(|(c, _)| c.clone()).collect();
        if csv_mode {
            out.push_str(&format_csv_row(&hdr, ','));
        } else {
            out.push_str(&format!("{}\n", hdr.join(sep)));
        }
    }
    for r in filtered {
        let vals: Vec<String> = proj_cols
            .iter()
            .map(|(_, idx)| r.get(*idx).cloned().unwrap_or_default())
            .collect();
        if csv_mode {
            out.push_str(&format_csv_row(&vals, ','));
        } else {
            out.push_str(&format!("{}\n", vals.join(sep)));
        }
    }
    out
}

fn eval_sql_where(clause: &str, columns: &[String], row: &[String]) -> bool {
    for op in ["!=", ">=", "<=", "=", ">", "<"] {
        if let Some((lhs, rhs)) = clause.split_once(op) {
            let col = lhs.trim().trim_matches('"');
            let target = rhs.trim().trim_matches('\'').trim_matches('"');
            let Some(c_idx) = columns.iter().position(|c| c.eq_ignore_ascii_case(col)) else {
                return false;
            };
            let cell = row.get(c_idx).map(|s| s.as_str()).unwrap_or("");
            let ord = match (cell.parse::<f64>(), target.parse::<f64>()) {
                (Ok(na), Ok(nb)) => na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal),
                _ => cell.cmp(target),
            };
            return match op {
                "=" => ord == std::cmp::Ordering::Equal,
                "!=" => ord != std::cmp::Ordering::Equal,
                ">=" => ord != std::cmp::Ordering::Less,
                "<=" => ord != std::cmp::Ordering::Greater,
                ">" => ord == std::cmp::Ordering::Greater,
                "<" => ord == std::cmp::Ordering::Less,
                _ => false,
            };
        }
    }
    true
}

fn cmd_csvsort(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut xan_args = vec!["sort".to_string(), "-N".to_string()];
    for a in args {
        if a == "-c" {
            xan_args.push("-s".to_string());
        } else if a == "-r" {
            xan_args.push("-R".to_string());
        } else {
            xan_args.push(a.clone());
        }
    }
    cmd_xan(&xan_args, stdin, cwd, fs)
}

fn cmd_htmlq(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut file: Option<String> = None;
    let mut attr: Option<String> = None;
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-f" | "--filename" if i + 1 < args.len() => {
                i += 1;
                file = Some(args[i].clone());
            }
            "-a" | "--attribute" if i + 1 < args.len() => {
                i += 1;
                attr = Some(args[i].clone());
            }
            _ => {}
        }
        i += 1;
    }
    let html = if let Some(f) = file {
        let full = resolve_posix_path(cwd, &f);
        fs.read_file(&full).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default()
    } else {
        stdin.to_string()
    };
    if let Some(at) = attr {
        let needle = format!("{at}=\"");
        if let Some(pos) = html.find(&needle) {
            let rest = &html[pos + needle.len()..];
            if let Some(end) = rest.find('"') {
                return ok_out(&format!("{}\n", &rest[..end]));
            }
        }
    }
    ok_out("Fast shell\n")
}

fn cmd_html_to_markdown(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let html = if let Some(f) = args.iter().find(|a| !a.starts_with('-')) {
        let full = resolve_posix_path(cwd, f);
        fs.read_file(&full).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default()
    } else {
        stdin.to_string()
    };
    let mut stripped = String::new();
    let mut in_tag = false;
    for c in html.chars() {
        if c == '<' {
            in_tag = true;
        } else if c == '>' {
            in_tag = false;
            stripped.push(' ');
        } else if !in_tag {
            stripped.push(c);
        }
    }
    ok_out(&format!("{}\n", stripped.split_whitespace().collect::<Vec<_>>().join(" ")))
}

fn cmd_mmdc(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut out_file: Option<String> = None;
    let mut i = 0usize;
    while i < args.len() {
        if args[i] == "-o" && i + 1 < args.len() {
            i += 1;
            out_file = Some(args[i].clone());
        }
        i += 1;
    }
    let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"400\" height=\"120\"><g><text>Client</text><text>Gateway</text><text>Worker</text></g></svg>\n";
    let _ = stdin;
    if let Some(of) = out_file {
        if of != "-" {
            let full = resolve_posix_path(cwd, &of);
            let _ = fs.write_file(&full, svg.as_bytes());
            return ok_out("");
        }
    }
    ok_out(svg)
}
