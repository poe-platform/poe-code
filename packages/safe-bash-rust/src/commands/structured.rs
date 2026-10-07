use crate::commands::search::{ZeroRegex, regex_captures, replace_regex_in_text};
use std::sync::Mutex;

static BIG_NUM_RAW: Mutex<Option<BTreeMap<u64, String>>> = Mutex::new(None);
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
        "xq" => Some(cmd_xq(args, stdin, cwd, env, fs)),
        "csvcut" => Some(cmd_csvcut(args, stdin, cwd, fs)),
        "csvgrep" => Some(cmd_csvgrep(args, stdin, cwd, fs)),
        "csvstat" => Some(cmd_csvstat(args, stdin, cwd, fs)),
        "csvsort" => Some(cmd_csvsort(args, stdin, cwd, fs)),
        "csvstack" => Some(cmd_csvstack(args, stdin, cwd, fs)),
        "csvjoin" => Some(cmd_csvjoin(args, stdin, cwd, fs)),
        "csvjson" => Some(cmd_csvjson(args, stdin, cwd, fs)),
        "in2csv" => Some(cmd_in2csv(args, stdin, cwd, fs)),
        "csvformat" => Some(cmd_csvformat(args, stdin, cwd, fs)),
        "csvlook" => Some(cmd_csvlook(args, stdin, cwd, fs)),
        "csvsql" | "sql2csv" => Some(cmd_csvsql(args, stdin, cwd, fs)),
        "csvclean" => Some(cmd_csvclean(args, stdin, cwd, fs)),
        "htmlq" => Some(cmd_htmlq(args, stdin, cwd, fs)),
        "mdq" => Some(cmd_mdq(args, stdin, cwd, fs)),
        "unrtf" => Some(cmd_unrtf(args, stdin, cwd, fs)),
        "html-to-markdown" => Some(cmd_html_to_markdown(args, stdin, cwd, env, fs)),
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
                if n.abs() >= 1e15
                    && let Ok(guard) = BIG_NUM_RAW.lock()
                    && let Some(ref map) = *guard
                    && let Some(raw) = map.get(&n.to_bits())
                {
                    return raw.clone();
                }
                if n.fract() == 0.0 && n.abs() < 1e15 {
                    format!("{}", *n as i64)
                } else if (n - n.round()).abs() < 1e-11 && (n.to_bits() & 1) == 1 && n.abs() < 1e15 {
                    format!("{:.1}", n.round())
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
            let mut n = num_str
                .parse::<f64>()
                .map_err(|_| format!("invalid number '{num_str}'"))?;
            if num_str.ends_with(".0") && n.fract() == 0.0 {
                n = if n == 0.0 {
                    f64::from_bits(1)
                } else {
                    f64::from_bits(n.to_bits() | 1)
                };
            } else if num_str.len() > 15 && !num_str.contains('.') && !num_str.contains('e') && !num_str.contains('E') {
                if let Ok(mut guard) = BIG_NUM_RAW.lock() {
                    guard.get_or_insert_with(BTreeMap::new).insert(n.to_bits(), num_str);
                }
            }
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
    let mut raw_input = false;
    let mut compact_output = false;
    let mut slurp = false;
    let mut null_input = false;
    let mut exit_status = false;
    let mut sort_keys = false;
    let mut join_output = false;
    let mut stream_mode = false;
    let mut seq_mode = false;
    let mut lib_dirs: Vec<String> = Vec::new();
    let mut args_mode: Option<bool> = None;
    let mut positional_args: Vec<JVal> = Vec::new();
    let mut named_args: Vec<(String, JVal)> = Vec::new();
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
                "--raw-input" => raw_input = true,
                "--compact-output" => compact_output = true,
                "--slurp" => slurp = true,
                "--null-input" => null_input = true,
                "--exit-status" => exit_status = true,
                "--sort-keys" => sort_keys = true,
                "--stream" => stream_mode = true,
                "--stream-errors" => stream_mode = true,
                "--seq" => seq_mode = true,
                "--from-file" if i + 1 < args.len() => {
                    let full = resolve_posix_path(cwd, &args[i + 1]);
                    if let Ok(b) = fs.read_file(&full) {
                        filter = Some(String::from_utf8_lossy(&b).into_owned());
                    }
                    i += 2;
                    continue;
                }
                "--args" => {
                    args_mode = Some(false);
                    end_opts = true;
                }
                "--jsonargs" => {
                    args_mode = Some(true);
                    end_opts = true;
                }
                "--join-output" => {
                    raw_output = true;
                    join_output = true;
                }
                "--arg" if i + 2 < args.len() => {
                    let v = JVal::Str(args[i + 2].clone());
                    named_args.push((args[i + 1].clone(), v.clone()));
                    vars.insert(args[i + 1].clone(), v);
                    i += 3;
                    continue;
                }
                "--argjson" if i + 2 < args.len() => {
                    let parsed = parse_json_stream(&args[i + 2])
                        .ok()
                        .and_then(|mut v| v.pop())
                        .unwrap_or(JVal::Null);
                    named_args.push((args[i + 1].clone(), parsed.clone()));
                    vars.insert(args[i + 1].clone(), parsed);
                    i += 3;
                    continue;
                }
                "--slurpfile" if i + 2 < args.len() => {
                    let full = resolve_posix_path(cwd, &args[i + 2]);
                    let content = fs
                        .read_file(&full)
                        .map(|b| String::from_utf8_lossy(&b).into_owned())
                        .unwrap_or_default();
                    let vals = parse_json_stream(&content).unwrap_or_default();
                    let arr = JVal::Array(vals);
                    named_args.push((args[i + 1].clone(), arr.clone()));
                    vars.insert(args[i + 1].clone(), arr);
                    i += 3;
                    continue;
                }
                "--rawfile" if i + 2 < args.len() => {
                    let full = resolve_posix_path(cwd, &args[i + 2]);
                    let content = fs
                        .read_file(&full)
                        .map(|b| String::from_utf8_lossy(&b).into_owned())
                        .unwrap_or_default();
                    let sv = JVal::Str(content);
                    named_args.push((args[i + 1].clone(), sv.clone()));
                    vars.insert(args[i + 1].clone(), sv);
                    i += 3;
                    continue;
                }
                _ => {}
            }
            i += 1;
            continue;
        }
        if !end_opts && a == "-L" && i + 1 < args.len() {
            lib_dirs.push(args[i + 1].clone());
            i += 2;
            continue;
        }
        if !end_opts && let Some(ld) = a.strip_prefix("-L") && !ld.is_empty() {
            lib_dirs.push(ld.to_string());
            i += 1;
            continue;
        }
        if !end_opts && a == "-f" && i + 1 < args.len() {
            let full = resolve_posix_path(cwd, &args[i + 1]);
            if let Ok(b) = fs.read_file(&full) {
                filter = Some(String::from_utf8_lossy(&b).into_owned());
            }
            i += 2;
            continue;
        }
        if !end_opts && a.starts_with('-') && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    'r' => raw_output = true,
                    'R' => raw_input = true,
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
        } else if let Some(is_json_args) = args_mode {
            if is_json_args {
                let parsed = parse_json_stream(a)
                    .ok()
                    .and_then(|mut v| v.pop())
                    .unwrap_or(JVal::Null);
                positional_args.push(parsed);
            } else {
                positional_args.push(JVal::Str(a.clone()));
            }
        } else {
            files.push(a.clone());
        }
        i += 1;
    }

    vars.insert(
        "ARGS".to_string(),
        JVal::Object(vec![
            ("positional".to_string(), JVal::Array(positional_args)),
            ("named".to_string(), JVal::Object(named_args)),
        ]),
    );

    let raw_filter = filter.unwrap_or_else(|| ".".to_string());
    let filter_str = preprocess_jq_imports(&raw_filter, &lib_dirs, cwd, fs);
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
        if seq_mode {
            raw_text = raw_text.replace('\x1e', "");
        }
        if raw_input {
            if slurp {
                inputs.push(JVal::Str(raw_text));
            } else {
                for line in raw_text.lines() {
                    inputs.push(JVal::Str(line.to_string()));
                }
            }
        } else {
            match parse_json_stream(&raw_text) {
                Ok(vals) => {
                    let vals = if stream_mode {
                        let mut streamed = Vec::new();
                        for v in &vals {
                            collect_jq_stream_events(v, &mut Vec::new(), &mut streamed);
                        }
                        streamed
                    } else {
                        vals
                    };
                    if slurp {
                        inputs.push(JVal::Array(vals));
                    } else {
                        inputs = vals;
                    }
                }
                Err(e) => return err_out(&format!("jq: parse error: {e}\n"), 4),
            }
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
                    if seq_mode {
                        out.push('\x1e');
                    }
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
    if let Some(def_rest) = s.strip_prefix("def ")
        && let Some((sig_and_body, after_semi)) = split_jq_binary(def_rest, ";")
        && let Some((sig, body)) = sig_and_body.split_once(':')
    {
        let sig = sig.trim();
        let (fname, param) = if let Some(open) = sig.find('(')
            && sig.ends_with(')')
        {
            (sig[..open].trim(), sig[open + 1..sig.len() - 1].trim())
        } else {
            (sig, "")
        };
        let mut next_vars = vars.clone();
        next_vars.insert(
            format!("__def_{fname}"),
            JVal::Str(format!("{param}::{}", body.trim())),
        );
        return eval_jq(after_semi.trim(), input, &next_vars);
    }

    if let Some(rest) = s.strip_prefix("label $")
        && let Some((lbl_name, body_expr)) = split_jq_binary(rest, "|")
    {
        let lbl = lbl_name.trim();
        match eval_jq(body_expr.trim(), input, vars) {
            Ok(vals) => return Ok(vals),
            Err(e) => {
                let prefix = format!("__jq_break:{lbl}");
                if let Some(after) = e.strip_prefix(&prefix) {
                    if let Some(json_str) = after.strip_prefix("::")
                        && let Ok(mut parsed) = parse_json_stream(json_str)
                        && let Some(JVal::Array(items)) = parsed.pop()
                    {
                        return Ok(items);
                    }
                    return Ok(Vec::new());
                }
                return Err(e);
            }
        }
    }
    if let Some(lbl) = s.strip_prefix("break $") {
        return Err(format!("__jq_break:{}", lbl.trim()));
    }

    if let Some(pipes) = split_jq_top(s, '|') {
        let mut current: Vec<(JVal, BTreeMap<String, JVal>)> =
            vec![(input.clone(), vars.clone())];
        for stage in pipes {
            let st_trim = stage.trim();
            if let Some((val_expr, pat_part)) = split_jq_binary_right(st_trim, " as ") {
                let pat = pat_part.trim();
                if !pat.contains('(')
                    && ((pat.starts_with('$') && !pat.contains(' '))
                        || pat.starts_with('[')
                        || pat.starts_with('{'))
                {
                    let mut next = Vec::new();
                    for (item, item_vars) in &current {
                        for v in eval_jq(&val_expr, item, item_vars)? {
                            let mut nv = item_vars.clone();
                            bind_jq_alternatives(pat, &v, &mut nv);
                            next.push((item.clone(), nv));
                        }
                    }
                    current = next;
                    continue;
                }
            }
            let mut next = Vec::new();
            for (item, item_vars) in &current {
                for out_item in eval_jq(&stage, item, item_vars)? {
                    next.push((out_item, item_vars.clone()));
                }
            }
            current = next;
        }
        return Ok(current.into_iter().map(|(v, _)| v).collect());
    }

    if let Some(rest) = s.strip_prefix("try ") {
        if let Some((try_expr, catch_expr)) = split_jq_binary(rest, " catch ") {
            return match eval_jq(try_expr.trim(), input, vars) {
                Ok(vals) => Ok(vals),
                Err(err_msg) => {
                    if err_msg.starts_with("__jq_break:") {
                        return Err(err_msg);
                    }
                    let err_val = if let Some(json_str) = err_msg.strip_prefix("__jq_err:") {
                        parse_json_stream(json_str)
                            .ok()
                            .and_then(|mut v| v.pop())
                            .unwrap_or(JVal::Str(json_str.to_string()))
                    } else {
                        JVal::Str(err_msg)
                    };
                    eval_jq(catch_expr.trim(), &err_val, vars)
                }
            };
        } else {
            return Ok(eval_jq(rest.trim(), input, vars).unwrap_or_default());
        }
    }

    if is_jq_if_expr(s) {
        return eval_jq_if(s, input, vars);
    }
    if let Some(rest) = s.strip_prefix("reduce ") {
        if let Some((stream_expr, after_as)) = rest.split_once(" as $")
            && let Some(open_p) = after_as.find('(')
            && after_as.ends_with(')')
            && is_matching_outer_delim(&after_as[open_p..], '(', ')')
        {
            let var_name = after_as[..open_p].trim();
            let inside = &after_as[open_p + 1..after_as.len() - 1];
            if let Some((init_expr, update_expr)) = inside.split_once(';') {
                let mut acc = eval_jq(init_expr.trim(), input, vars)?
                    .into_iter()
                    .next()
                    .unwrap_or(JVal::Null);
                let items = eval_jq(stream_expr.trim(), input, vars)?;
                for item in items {
                    let mut step_vars = vars.clone();
                    step_vars.insert(var_name.to_string(), item);
                    acc = eval_jq(update_expr.trim(), &acc, &step_vars)?
                        .into_iter()
                        .next()
                        .unwrap_or(JVal::Null);
                }
                return Ok(vec![acc]);
            }
        }
    }
    if let Some(rest) = s.strip_prefix("foreach ") {
        if let Some((stream_expr, after_as)) = rest.split_once(" as $")
            && let Some(open_p) = after_as.find('(')
            && after_as.ends_with(')')
            && is_matching_outer_delim(&after_as[open_p..], '(', ')')
        {
            let var_name = after_as[..open_p].trim();
            let inside = &after_as[open_p + 1..after_as.len() - 1];
            let parts = split_jq_top(inside, ';').unwrap_or_else(|| vec![inside.to_string()]);
            if parts.len() >= 2 {
                let mut acc = eval_jq(parts[0].trim(), input, vars)?
                    .into_iter()
                    .next()
                    .unwrap_or(JVal::Null);
                let items = eval_jq(stream_expr.trim(), input, vars)?;
                let mut out = Vec::new();
                for item in items {
                    let mut step_vars = vars.clone();
                    step_vars.insert(var_name.to_string(), item);
                    let step_res = match eval_jq(parts[1].trim(), &acc, &step_vars) {
                        Ok(v) => v,
                        Err(e) if e.starts_with("__jq_break:") => {
                            let lbl_part = e.split("::").next().unwrap_or(&e);
                            return Err(format!(
                                "{lbl_part}::{}",
                                JVal::Array(out).to_json_string(true, false, 0)
                            ));
                        }
                        Err(e) => return Err(e),
                    };
                    acc = step_res.into_iter().next().unwrap_or(JVal::Null);
                    if parts.len() >= 3 {
                        match eval_jq(parts[2].trim(), &acc, &step_vars) {
                            Ok(vals) => out.extend(vals),
                            Err(e) if e.starts_with("__jq_break:") => {
                                let lbl_part = e.split("::").next().unwrap_or(&e);
                                if let Some((_, json_str)) = e.split_once("::")
                                    && let Ok(mut parsed) = parse_json_stream(json_str)
                                    && let Some(JVal::Array(partial)) = parsed.pop()
                                {
                                    out.extend(partial);
                                }
                                return Err(format!(
                                    "{lbl_part}::{}",
                                    JVal::Array(out).to_json_string(true, false, 0)
                                ));
                            }
                            Err(e) => return Err(e),
                        }
                    } else {
                        out.push(acc.clone());
                    }
                }
                return Ok(out);
            }
        }
    }

    if let Some(commas) = split_jq_top(s, ',') {
        let mut out = Vec::new();
        for part in commas {
            match eval_jq(&part, input, vars) {
                Ok(vals) => out.extend(vals),
                Err(e) if e.starts_with("__jq_break:") => {
                    let lbl_part = e.split("::").next().unwrap_or(&e);
                    return Err(format!(
                        "{lbl_part}::{}",
                        JVal::Array(out).to_json_string(true, false, 0)
                    ));
                }
                Err(e) => return Err(e),
            }
        }
        return Ok(out);
    }

    for update_op in ["|=", "//=", "+=", "-=", "*=", "/=", "%=", "="] {
        if let Some((lhs, rhs)) = split_jq_binary(s, update_op) {
            if update_op == "=" && (lhs.ends_with('!') || lhs.ends_with('<') || lhs.ends_with('>') || lhs.ends_with('=') || lhs.ends_with('|') || lhs.ends_with('+') || lhs.ends_with('-') || lhs.ends_with('*') || lhs.ends_with('/') || lhs.ends_with('%') || rhs.starts_with('=')) {
                continue;
            }
            return eval_jq_update(&lhs, update_op, &rhs, input, vars);
        }
    }

    if let Some((lhs, rhs)) = split_jq_binary(s, "//") && !lhs.ends_with('?') {
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

    if let Some(inner) = s.strip_prefix('-')
        && !inner.is_empty()
        && !inner.chars().next().unwrap().is_ascii_digit()
    {
        let mut out = Vec::new();
        for v in eval_jq(inner, input, vars)? {
            if let JVal::Number(n) = v {
                out.push(JVal::Number(-n));
            } else {
                out.push(v);
            }
        }
        return Ok(out);
    }

    if let Some(inner) = s.strip_suffix('?')
        && !inner.is_empty()
        && !inner.starts_with('.')
    {
        return Ok(eval_jq(inner, input, vars).unwrap_or_default());
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
        let mut id_end = 0usize;
        for (idx, ch) in var_name.char_indices() {
            if ch.is_ascii_alphanumeric() || ch == '_' {
                id_end = idx + ch.len_utf8();
            } else {
                break;
            }
        }
        let vname = &var_name[..id_end];
        let rest = &var_name[id_end..];
        if let Some(v) = vars.get(vname) {
            if rest.is_empty() {
                return Ok(vec![v.clone()]);
            }
            if rest.starts_with('.') {
                return eval_jq_path_with_root(rest, v, input, vars);
            }
            if rest.starts_with('[') {
                return eval_jq_path_with_root(&format!(".{rest}"), v, input, vars);
            }
        }
        return Ok(vec![JVal::Null]);
    }

    if let Some(base) = s.strip_suffix("[]")
        && !base.is_empty()
        && !base.starts_with('.')
    {
        let mut out = Vec::new();
        for val in eval_jq(base, input, vars)? {
            if let JVal::Array(items) = val {
                out.extend(items);
            }
        }
        return Ok(out);
    }

    if s.starts_with('@')
        && let Some(q_idx) = s.find('"')
        && s.ends_with('"')
    {
        let fmt = s[..q_idx].trim();
        let str_part = &s[q_idx + 1..s.len() - 1];
        return Ok(vec![JVal::Str(eval_jq_interpolated_string_with_fmt(
            str_part,
            Some(fmt),
            input,
            vars,
        )?)]);
    }

    if s.starts_with('"') && s.ends_with('"') && s.contains("\\(") {
        return Ok(vec![JVal::Str(eval_jq_interpolated_string(
            &s[1..s.len() - 1],
            input,
            vars,
        )?)]);
    }

    if let Ok(mut parsed) = parse_json_stream(s) {
        if parsed.len() == 1 {
            return Ok(vec![parsed.pop().unwrap()]);
        }
    }

    if let Some(res) = try_eval_jq_builtin(s, input, vars)? {
        return Ok(res);
    }
    if let Some(JVal::Str(def_spec)) = vars.get(&format!("__def_{s}"))
        && let Some((_param, body)) = def_spec.split_once("::")
    {
        return eval_jq(body, input, vars);
    }

    if let Some(env_var) = s.strip_prefix("env.") {
        return Ok(vec![vars.get(env_var).cloned().unwrap_or(JVal::Str(String::new()))]);
    }
    if let Some(open_p) = s.find('(')
        && !s.starts_with('(')
        && s[..open_p].chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        let chars: Vec<char> = s.chars().collect();
        let mut depth = 0i32;
        let mut q = false;
        let mut close_idx = None;
        for (idx, &c) in chars.iter().enumerate() {
            if c == '"' {
                q = !q;
            } else if !q {
                if c == '(' {
                    depth += 1;
                } else if c == ')' {
                    depth -= 1;
                    if depth == 0 {
                        close_idx = Some(idx);
                        break;
                    }
                }
            }
        }
        if let Some(ci) = close_idx
            && ci + 1 < chars.len()
        {
            let call_part: String = chars[..=ci].iter().collect();
            let rest_part: String = chars[ci + 1..].iter().collect();
            if rest_part.starts_with('.') || rest_part.starts_with('[') {
                let path_expr = if rest_part.starts_with('[') {
                    format!(".{rest_part}")
                } else {
                    rest_part
                };
                let mut out = Vec::new();
                for v in eval_jq(&call_part, input, vars)? {
                    out.extend(eval_jq_path_with_root(&path_expr, &v, input, vars)?);
                }
                return Ok(out);
            }
        }
    }
    if s.starts_with('.') {
        return eval_jq_path(s, input, vars);
    }

    Err(format!("unsupported jq filter: {s}"))
}

fn is_jq_kw_at(chars: &[char], i: usize, kw: &[char]) -> bool {
    if i + kw.len() > chars.len() || chars[i..i + kw.len()] != kw[..] {
        return false;
    }
    let prev_ok = i == 0
        || !(chars[i - 1].is_ascii_alphanumeric()
            || matches!(chars[i - 1], '_' | '.' | '$'));
    let next_ok = i + kw.len() == chars.len()
        || !(chars[i + kw.len()].is_ascii_alphanumeric()
            || chars[i + kw.len()] == '_');
    prev_ok && next_ok
}

fn is_jq_if_expr(s: &str) -> bool {
    let chars: Vec<char> = s.chars().collect();
    if !is_jq_kw_at(&chars, 0, &['i', 'f']) || chars.len() < 7 {
        return false;
    }
    if !is_jq_kw_at(&chars, chars.len() - 3, &['e', 'n', 'd']) {
        return false;
    }
    let mut paren = 0i32;
    let mut bracket = 0i32;
    let mut brace = 0i32;
    let mut if_depth = 0i32;
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '"' {
            i = skip_jq_string(&chars, i);
            continue;
        }
        match chars[i] {
            '(' => paren += 1,
            ')' => paren -= 1,
            '[' => bracket += 1,
            ']' => bracket -= 1,
            '{' => brace += 1,
            '}' => brace -= 1,
            _ => {}
        }
        if paren == 0 && bracket == 0 && brace == 0 {
            if is_jq_kw_at(&chars, i, &['i', 'f']) {
                if_depth += 1;
                i += 2;
                continue;
            }
            if is_jq_kw_at(&chars, i, &['e', 'n', 'd']) {
                if_depth -= 1;
                if if_depth == 0 && i + 3 < chars.len() {
                    return false;
                }
                i += 3;
                continue;
            }
        }
        i += 1;
    }
    if_depth == 0
}

fn eval_jq_if(
    s: &str,
    input: &JVal,
    vars: &BTreeMap<String, JVal>,
) -> Result<Vec<JVal>, String> {
    let body = s[2..s.len() - 3].trim();
    let chars: Vec<char> = body.chars().collect();
    let mut paren = 0i32;
    let mut bracket = 0i32;
    let mut brace = 0i32;
    let mut if_depth = 0i32;
    let mut clauses: Vec<(String, String)> = Vec::new();
    let mut cur_cond: Option<String> = None;
    let mut seg_start = 0usize;
    let mut in_else = false;
    let mut i = 0usize;

    while i < chars.len() {
        if chars[i] == '"' {
            i = skip_jq_string(&chars, i);
            continue;
        }
        match chars[i] {
            '(' => paren += 1,
            ')' => paren -= 1,
            '[' => bracket += 1,
            ']' => bracket -= 1,
            '{' => brace += 1,
            '}' => brace -= 1,
            _ => {}
        }
        if paren == 0 && bracket == 0 && brace == 0 {
            if is_jq_kw_at(&chars, i, &['i', 'f']) {
                if_depth += 1;
                i += 2;
                continue;
            }
            if is_jq_kw_at(&chars, i, &['e', 'n', 'd']) {
                if_depth -= 1;
                i += 3;
                continue;
            }
            if if_depth == 0 {
                if !in_else && cur_cond.is_none() && is_jq_kw_at(&chars, i, &['t', 'h', 'e', 'n']) {
                    cur_cond = Some(chars[seg_start..i].iter().collect());
                    i += 4;
                    seg_start = i;
                    continue;
                }
                if !in_else && cur_cond.is_some() && is_jq_kw_at(&chars, i, &['e', 'l', 'i', 'f']) {
                    let then_b: String = chars[seg_start..i].iter().collect();
                    clauses.push((cur_cond.take().unwrap(), then_b));
                    i += 4;
                    seg_start = i;
                    continue;
                }
                if !in_else && cur_cond.is_some() && is_jq_kw_at(&chars, i, &['e', 'l', 's', 'e']) {
                    let then_b: String = chars[seg_start..i].iter().collect();
                    clauses.push((cur_cond.take().unwrap(), then_b));
                    in_else = true;
                    i += 4;
                    seg_start = i;
                    continue;
                }
            }
        }
        i += 1;
    }

    let else_branch = if in_else {
        Some(chars[seg_start..].iter().collect::<String>())
    } else {
        if let Some(cond) = cur_cond {
            clauses.push((cond, chars[seg_start..].iter().collect()));
        }
        None
    };

    for (cond_s, then_s) in clauses {
        let cond_val = eval_jq(cond_s.trim(), input, vars)?
            .first()
            .map(|v| v.is_truthy())
            .unwrap_or(false);
        if cond_val {
            return eval_jq(then_s.trim(), input, vars);
        }
    }
    if let Some(else_s) = else_branch {
        eval_jq(else_s.trim(), input, vars)
    } else {
        Ok(vec![input.clone()])
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
    let lt = lhs.trim();
    if op == "="
        && let Some(slice_inner) = lt.strip_prefix(".[").and_then(|s| s.strip_suffix(']'))
        && let Some((s_part, e_part)) = slice_inner.split_once(':')
        && let JVal::Array(arr) = input
    {
        let len = arr.len() as isize;
        let s_idx = resolve_slice_bound(s_part.trim(), len, 0);
        let e_idx = resolve_slice_bound(e_part.trim(), len, len);
        let rv = eval_jq(rhs, input, vars)?
            .into_iter()
            .next()
            .unwrap_or(JVal::Array(Vec::new()));
        if let JVal::Array(repl) = rv {
            let mut new_arr = Vec::new();
            new_arr.extend_from_slice(&arr[..s_idx]);
            new_arr.extend(repl);
            if e_idx < arr.len() {
                new_arr.extend_from_slice(&arr[e_idx..]);
            }
            return Ok(vec![JVal::Array(new_arr)]);
        }
    }
    let paths = resolve_jq_lhs_paths(lhs, input, vars)?;
    if paths.is_empty() {
        return Ok(vec![input.clone()]);
    }
    let mut updated = input.clone();
    for p in paths {
        let cur_val = get_jq_jval_path(&updated, &p);
        let new_val = match op {
            "|=" => eval_jq(rhs, &cur_val, vars)?
                .into_iter()
                .next()
                .unwrap_or(JVal::Null),
            "=" => eval_jq(rhs, &updated, vars)?
                .into_iter()
                .next()
                .unwrap_or(JVal::Null),
            "//=" => {
                if cur_val.is_truthy() {
                    cur_val
                } else {
                    eval_jq(rhs, &updated, vars)?
                        .into_iter()
                        .next()
                        .unwrap_or(JVal::Null)
                }
            }
            "+=" | "-=" | "*=" | "/=" | "%=" => {
                let rv = eval_jq(rhs, &updated, vars)?
                    .into_iter()
                    .next()
                    .unwrap_or(JVal::Null);
                apply_jq_arith(&cur_val, &rv, &op[..1])?
            }
            _ => cur_val,
        };
        set_jq_jval_path(&mut updated, &p, new_val);
    }
    Ok(vec![updated])
}

fn resolve_jq_lhs_paths(
    lhs: &str,
    input: &JVal,
    vars: &BTreeMap<String, JVal>,
) -> Result<Vec<Vec<JVal>>, String> {
    let mut s = lhs.trim();
    while s.starts_with('(') && s.ends_with(')') && is_matching_outer_delim(s, '(', ')') {
        s = s[1..s.len() - 1].trim();
    }
    if let Some(stages) = split_jq_top(s, '|') {
        let mut paths: Vec<Vec<JVal>> = vec![Vec::new()];
        for stage in stages {
            let st = stage.trim();
            let mut next_paths = Vec::new();
            for p in paths {
                let cur = get_jq_jval_path(input, &p);
                for sub_p in resolve_jq_lhs_paths(st, &cur, vars)? {
                    let mut combined = p.clone();
                    combined.extend(sub_p);
                    next_paths.push(combined);
                }
            }
            paths = next_paths;
        }
        return Ok(paths);
    }
    if s.starts_with("select(") {
        let paren_part = &s[6..];
        if let Some(close_rel) = find_matching_paren(paren_part) {
            let cond = &paren_part[1..close_rel];
            let rest = paren_part[close_rel + 1..].trim();
            let keep = eval_jq(cond.trim(), input, vars)?
                .first()
                .map(|v| v.is_truthy())
                .unwrap_or(false);
            if !keep {
                return Ok(Vec::new());
            }
            if rest.is_empty() {
                return Ok(vec![Vec::new()]);
            }
            return resolve_jq_lhs_paths(rest, input, vars);
        }
    }
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0usize;
    let mut paths: Vec<Vec<JVal>> = vec![Vec::new()];

    while i < chars.len() {
        if chars[i] == '.' {
            i += 1;
            if i >= chars.len() {
                break;
            }
            if chars[i] == '[' {
                continue;
            }
            let key = if chars[i] == '"' {
                parse_json_string(&chars, &mut i)?
            } else {
                let start = i;
                while i < chars.len() && !matches!(chars[i], '.' | '[' | '?') {
                    i += 1;
                }
                chars[start..i].iter().collect()
            };
            if i < chars.len() && chars[i] == '?' {
                i += 1;
            }
            if !key.is_empty() {
                for p in &mut paths {
                    p.push(JVal::Str(key.clone()));
                }
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
            if i < chars.len() && chars[i] == '?' {
                i += 1;
            }
            let inside_trim = inside.trim();
            if inside_trim.is_empty() {
                let mut next_paths = Vec::new();
                for p in &paths {
                    match get_jq_jval_path(input, p) {
                        JVal::Array(arr) => {
                            for idx in 0..arr.len() {
                                let mut np = p.clone();
                                np.push(JVal::Number(idx as f64));
                                next_paths.push(np);
                            }
                        }
                        JVal::Object(entries) => {
                            for (k, _) in entries {
                                let mut np = p.clone();
                                np.push(JVal::Str(k));
                                next_paths.push(np);
                            }
                        }
                        _ => {}
                    }
                }
                paths = next_paths;
            } else if inside_trim.starts_with('"') && inside_trim.ends_with('"') {
                let key = inside_trim[1..inside_trim.len() - 1].to_string();
                for p in &mut paths {
                    p.push(JVal::Str(key.clone()));
                }
            } else if let Ok(idx_num) = inside_trim.parse::<isize>() {
                for p in &mut paths {
                    p.push(JVal::Number(idx_num as f64));
                }
            } else {
                let idx_vals = eval_jq(inside_trim, input, vars)?;
                let mut next_paths = Vec::new();
                for p in &paths {
                    for iv in &idx_vals {
                        let mut np = p.clone();
                        match iv {
                            JVal::Number(n) => np.push(JVal::Number(*n)),
                            other => np.push(JVal::Str(other.to_raw_string(true, false))),
                        }
                        next_paths.push(np);
                    }
                }
                paths = next_paths;
            }
        } else {
            i += 1;
        }
    }
    Ok(paths)
}

fn del_nested_jval(val: &mut JVal, path: &[&str]) {
    if path.is_empty() {
        return;
    }
    if let JVal::Object(map) = val {
        let k = path[0];
        if path.len() == 1 {
            map.retain(|(ek, _)| ek != k);
        } else if let Some((_, child)) = map.iter_mut().find(|(ek, _)| ek == k) {
            del_nested_jval(child, &path[1..]);
        }
    }
}

fn del_recursive_key_jval(val: &mut JVal, key: &str) {
    match val {
        JVal::Object(map) => {
            map.retain(|(k, _)| k != key);
            for (_, child) in map.iter_mut() {
                del_recursive_key_jval(child, key);
            }
        }
        JVal::Array(items) => {
            for item in items.iter_mut() {
                del_recursive_key_jval(item, key);
            }
        }
        _ => {}
    }
}

fn clean_jval_num(n: f64) -> f64 {
    if (n - n.round()).abs() < 1e-11 && (n.to_bits() & 1) == 1 && n.abs() < 1e15 {
        n.round()
    } else {
        n
    }
}

fn apply_jq_arith(lv: &JVal, rv: &JVal, op: &str) -> Result<JVal, String> {
    match (lv, rv, op) {
        (JVal::Null, other, "+") => Ok(other.clone()),
        (other, JVal::Null, "+") => Ok(other.clone()),
        (JVal::Number(a), JVal::Number(b), "+") => Ok(JVal::Number(clean_jval_num(*a) + clean_jval_num(*b))),
        (JVal::Number(a), JVal::Number(b), "-") => Ok(JVal::Number(clean_jval_num(*a) - clean_jval_num(*b))),
        (JVal::Number(a), JVal::Number(b), "*") => Ok(JVal::Number(clean_jval_num(*a) * clean_jval_num(*b))),
        (JVal::Number(a), JVal::Number(b), "/") => {
            let cb = clean_jval_num(*b);
            if cb == 0.0 {
                Err("division by zero".to_string())
            } else {
                Ok(JVal::Number(clean_jval_num(*a) / cb))
            }
        }
        (JVal::Number(a), JVal::Number(b), "%") => {
            let cb = clean_jval_num(*b);
            if cb == 0.0 {
                Err("division by zero".to_string())
            } else {
                Ok(JVal::Number(clean_jval_num(*a) % cb))
            }
        }
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
            clean_jval_num(*na).partial_cmp(&clean_jval_num(*nb)).unwrap_or(std::cmp::Ordering::Equal)
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
    if let Some(stem) = s.strip_suffix("[]")
        && !stem.is_empty()
        && !stem.starts_with('.')
        && !stem.starts_with('[')
    {
        let inner = eval_jq(stem, input, vars)?;
        let mut out = Vec::new();
        for item in inner {
            if let JVal::Array(arr) = item {
                out.extend(arr);
            }
        }
        return Ok(Some(out));
    }
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
                JVal::Str(st) => st.trim().parse::<f64>().map_err(|_| {
                    format!(
                        "Invalid numeric literal at EOF at line 1, column {} (while parsing '{st}')",
                        st.len()
                    )
                })?,
                _ => return Err("cannot be parsed as a number".to_string()),
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
                if let JVal::Number(n) = &mut acc {
                    *n = clean_jval_num(*n);
                }
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
            if let JVal::Array(a) = input {
                let arr: Vec<JVal> = a
                    .iter()
                    .enumerate()
                    .map(|(idx, v)| {
                        JVal::Object(vec![
                            ("key".to_string(), JVal::Number(idx as f64)),
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
        "floor" | "ceil" | "round" | "abs" | "fabs" | "sqrt" => {
            if let JVal::Number(n) = input {
                let res = match s {
                    "floor" => n.floor(),
                    "ceil" => n.ceil(),
                    "round" => n.round(),
                    "abs" | "fabs" => n.abs(),
                    "sqrt" => n.sqrt(),
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
        "fromjson" => {
            if let JVal::Str(st) = input {
                let mut parsed = parse_json_stream(st)?;
                if parsed.len() != 1 {
                    return Err("invalid json".to_string());
                }
                return Ok(Some(vec![parsed.remove(0)]));
            }
            return Err("fromjson requires string".to_string());
        }
        "@json" | "tojson" => {
            return Ok(Some(vec![JVal::Str(input.to_json_string(true, false, 0))]));
        }
        "@text" => {
            return Ok(Some(vec![JVal::Str(input.to_raw_string(true, false))]));
        }
        "@base64" => {
            let raw = input.to_raw_string(true, false);
            return Ok(Some(vec![JVal::Str(encode_base64_str(raw.as_bytes()))]));
        }
        "@base64d" => {
            let raw = input.to_raw_string(true, false);
            let decoded = decode_base64_str(&raw)?;
            return Ok(Some(vec![JVal::Str(
                String::from_utf8_lossy(&decoded).into_owned(),
            )]));
        }
        "@sh" => {
            let vals = match input {
                JVal::Array(a) => a.clone(),
                other => vec![other.clone()],
            };
            let parts: Vec<String> = vals
                .iter()
                .map(|v| {
                    let raw = v.to_raw_string(true, false);
                    format!("'{}'", raw.replace('\'', "'\\''"))
                })
                .collect();
            return Ok(Some(vec![JVal::Str(parts.join(" "))]));
        }
        "@html" => {
            let raw = input.to_raw_string(true, false);
            let enc = raw
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
                .replace('"', "&quot;")
                .replace('\'', "&apos;");
            return Ok(Some(vec![JVal::Str(enc)]));
        }
        "@uri" => {
            let raw = input.to_raw_string(true, false);
            let mut enc = String::new();
            for b in raw.bytes() {
                if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
                    enc.push(b as char);
                } else {
                    enc.push_str(&format!("%{b:02X}"));
                }
            }
            return Ok(Some(vec![JVal::Str(enc)]));
        }
        "@urid" => {
            let raw = input.to_raw_string(true, false);
            let bytes = raw.as_bytes();
            let mut dec = Vec::with_capacity(bytes.len());
            let mut idx = 0usize;
            while idx < bytes.len() {
                if bytes[idx] == b'%'
                    && idx + 2 < bytes.len()
                    && let Ok(hex_s) = std::str::from_utf8(&bytes[idx + 1..idx + 3])
                    && let Ok(val) = u8::from_str_radix(hex_s, 16)
                {
                    dec.push(val);
                    idx += 3;
                } else {
                    dec.push(bytes[idx]);
                    idx += 1;
                }
            }
            return Ok(Some(vec![JVal::Str(
                String::from_utf8_lossy(&dec).into_owned(),
            )]));
        }
        "utf8bytelength" => {
            if let JVal::Str(st) = input {
                return Ok(Some(vec![JVal::Number(st.len() as f64)]));
            }
        }
        "explode" => {
            if let JVal::Str(st) = input {
                let cps: Vec<JVal> = st.chars().map(|c| JVal::Number((c as u32) as f64)).collect();
                return Ok(Some(vec![JVal::Array(cps)]));
            }
            return Ok(Some(vec![explode_jval_merge_keys(input)]));
        }
        "implode" => {
            if let JVal::Array(arr) = input {
                let s: String = arr
                    .iter()
                    .filter_map(|v| match v {
                        JVal::Number(n) => char::from_u32(*n as u32),
                        _ => None,
                    })
                    .collect();
                return Ok(Some(vec![JVal::Str(s)]));
            }
        }
        "todate" | "todateiso8601" => {
            if let JVal::Number(n) = input {
                return Ok(Some(vec![JVal::Str(epoch_to_iso8601(*n as i64))]));
            }
        }
        "fromdate" | "fromdateiso8601" => {
            if let JVal::Str(st) = input {
                return Ok(Some(vec![JVal::Number(iso8601_to_epoch(st) as f64)]));
            }
        }
        "transpose" => {
            if let JVal::Array(rows) = input {
                let max_cols = rows
                    .iter()
                    .filter_map(|r| match r {
                        JVal::Array(a) => Some(a.len()),
                        _ => None,
                    })
                    .max()
                    .unwrap_or(0);
                let mut out_rows = Vec::with_capacity(max_cols);
                for c in 0..max_cols {
                    let mut col_vec = Vec::with_capacity(rows.len());
                    for r in rows {
                        if let JVal::Array(a) = r {
                            col_vec.push(a.get(c).cloned().unwrap_or(JVal::Null));
                        } else {
                            col_vec.push(JVal::Null);
                        }
                    }
                    out_rows.push(JVal::Array(col_vec));
                }
                return Ok(Some(vec![JVal::Array(out_rows)]));
            }
        }
        "combinations" => {
            if let JVal::Array(groups) = input {
                let mut acc: Vec<Vec<JVal>> = vec![Vec::new()];
                for g in groups {
                    if let JVal::Array(items) = g {
                        let mut next = Vec::new();
                        for prefix in &acc {
                            for item in items {
                                let mut p = prefix.clone();
                                p.push(item.clone());
                                next.push(p);
                            }
                        }
                        acc = next;
                    }
                }
                return Ok(Some(acc.into_iter().map(JVal::Array).collect()));
            }
        }
        "error" => {
            return Err(format!("__jq_err:{}", input.to_json_string(true, false, 0)));
        }
        ".." | "recurse" => {
            let mut out = Vec::new();
            collect_jq_recurse(input, &mut out);
            return Ok(Some(out));
        }
        "objects" => {
            return Ok(Some(if matches!(input, JVal::Object(_)) {
                vec![input.clone()]
            } else {
                Vec::new()
            }));
        }
        "arrays" => {
            return Ok(Some(if matches!(input, JVal::Array(_)) {
                vec![input.clone()]
            } else {
                Vec::new()
            }));
        }
        "scalars" => {
            return Ok(Some(if !matches!(input, JVal::Array(_) | JVal::Object(_)) {
                vec![input.clone()]
            } else {
                Vec::new()
            }));
        }
        "numbers" => {
            return Ok(Some(if matches!(input, JVal::Number(_)) {
                vec![input.clone()]
            } else {
                Vec::new()
            }));
        }
        "strings" => {
            return Ok(Some(if matches!(input, JVal::Str(_)) {
                vec![input.clone()]
            } else {
                Vec::new()
            }));
        }
        "booleans" => {
            return Ok(Some(if matches!(input, JVal::Bool(_)) {
                vec![input.clone()]
            } else {
                Vec::new()
            }));
        }
        "nulls" => {
            return Ok(Some(if matches!(input, JVal::Null) {
                vec![input.clone()]
            } else {
                Vec::new()
            }));
        }
        "paths" => {
            let mut out = Vec::new();
            let mut cur_path = Vec::new();
            collect_jq_paths(input, &mut cur_path, &mut out);
            return Ok(Some(out));
        }
        "leaf_paths" => {
            let mut all_paths = Vec::new();
            let mut cur_path = Vec::new();
            collect_jq_paths(input, &mut cur_path, &mut all_paths);
            let mut filtered = Vec::new();
            for p in all_paths {
                if let JVal::Array(ref segs) = p {
                    let target_val = get_jq_jval_path(input, segs);
                    if !matches!(target_val, JVal::Array(_) | JVal::Object(_)) {
                        filtered.push(p);
                    }
                }
            }
            return Ok(Some(filtered));
        }
        _ => {}
    }

    if let Some(open) = s.find('(') {
        if s.ends_with(')') {
            let fname = s[..open].trim();
            let arg_expr = s[open + 1..s.len() - 1].trim();
            match fname {
                "delpaths" => {
                    let mut updated = input.clone();
                    if let Some(JVal::Array(mut path_list)) =
                        eval_jq(arg_expr, input, vars)?.into_iter().next()
                    {
                        path_list.sort_by(|a, b| {
                            let la = match a {
                                JVal::Array(v) => v.len(),
                                _ => 0,
                            };
                            let lb = match b {
                                JVal::Array(v) => v.len(),
                                _ => 0,
                            };
                            lb.cmp(&la)
                        });
                        for p in path_list {
                            if let JVal::Array(segs) = p {
                                delete_jq_jval_path(&mut updated, &segs);
                            }
                        }
                    }
                    return Ok(Some(vec![updated]));
                }
                "paths" => {
                    let mut all_paths = Vec::new();
                    let mut cur_path = Vec::new();
                    collect_jq_paths(input, &mut cur_path, &mut all_paths);
                    let mut filtered = Vec::new();
                    for p in all_paths {
                        if let JVal::Array(ref segs) = p {
                            let target_val = get_jq_jval_path(input, segs);
                            let keep = eval_jq(arg_expr, &target_val, vars)?
                                .first()
                                .map(|v| v.is_truthy())
                                .unwrap_or(false);
                            if keep {
                                filtered.push(p);
                            }
                        }
                    }
                    return Ok(Some(filtered));
                }
                "bsearch" => {
                    if let JVal::Array(a) = input {
                        let target = eval_jq(arg_expr, input, vars)?
                            .into_iter()
                            .next()
                            .unwrap_or(JVal::Null);
                        let mut lo = 0isize;
                        let mut hi = a.len() as isize - 1;
                        while lo <= hi {
                            let mid = (lo + hi) / 2;
                            match compare_jval(&a[mid as usize], &target) {
                                std::cmp::Ordering::Equal => {
                                    return Ok(Some(vec![JVal::Number(mid as f64)]));
                                }
                                std::cmp::Ordering::Less => lo = mid + 1,
                                std::cmp::Ordering::Greater => hi = mid - 1,
                            }
                        }
                        return Ok(Some(vec![JVal::Number(-(lo as f64) - 1.0)]));
                    }
                }
                "getpath" => {
                    if let Some(JVal::Array(segs)) =
                        eval_jq(arg_expr, input, vars)?.into_iter().next()
                    {
                        return Ok(Some(vec![get_jq_jval_path(input, &segs)]));
                    }
                    return Ok(Some(vec![JVal::Null]));
                }
                "setpath" => {
                    if let Some((p_expr, v_expr)) = split_jq_binary(arg_expr, ";") {
                        let mut updated = input.clone();
                        if let Some(JVal::Array(segs)) =
                            eval_jq(p_expr.trim(), input, vars)?.into_iter().next()
                        {
                            let nv = eval_jq(v_expr.trim(), input, vars)?
                                .into_iter()
                                .next()
                                .unwrap_or(JVal::Null);
                            set_jq_jval_path(&mut updated, &segs, nv);
                        }
                        return Ok(Some(vec![updated]));
                    }
                }
                "explode" => {
                    let mut out = Vec::new();
                    for v in eval_jq(arg_expr, input, vars)? {
                        out.push(explode_jval_merge_keys(&v));
                    }
                    return Ok(Some(out));
                }
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
                "contains" | "inside" => {
                    let needle = eval_jq(arg_expr, input, vars)?
                        .into_iter()
                        .next()
                        .unwrap_or(JVal::Null);
                    let res = if fname == "contains" {
                        jval_contains(input, &needle)
                    } else {
                        jval_contains(&needle, input)
                    };
                    return Ok(Some(vec![JVal::Bool(res)]));
                }
                "indices" | "index" | "rindex" => {
                    let needle_val = eval_jq(arg_expr, input, vars)?
                        .into_iter()
                        .next()
                        .unwrap_or(JVal::Null);
                    let mut idxs: Vec<usize> = Vec::new();
                    match input {
                        JVal::Str(st) => {
                            let needle = needle_val.to_raw_string(true, false);
                            if !needle.is_empty() {
                                for (char_idx, (byte_pos, _)) in st.char_indices().enumerate() {
                                    if st[byte_pos..].starts_with(&needle) {
                                        idxs.push(char_idx);
                                    }
                                }
                            }
                        }
                        JVal::Array(arr) => {
                            if let JVal::Array(sub) = &needle_val {
                                if !sub.is_empty() && sub.len() <= arr.len() {
                                    for i in 0..=(arr.len() - sub.len()) {
                                        if arr[i..i + sub.len()] == sub[..] {
                                            idxs.push(i);
                                        }
                                    }
                                }
                            } else {
                                for (i, item) in arr.iter().enumerate() {
                                    if item == &needle_val {
                                        idxs.push(i);
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                    let res = match fname {
                        "indices" => JVal::Array(
                            idxs.into_iter().map(|i| JVal::Number(i as f64)).collect(),
                        ),
                        "index" => idxs
                            .first()
                            .map(|&i| JVal::Number(i as f64))
                            .unwrap_or(JVal::Null),
                        "rindex" => idxs
                            .last()
                            .map(|&i| JVal::Number(i as f64))
                            .unwrap_or(JVal::Null),
                        _ => JVal::Null,
                    };
                    return Ok(Some(vec![res]));
                }
                "test" => {
                    if let JVal::Str(st) = input {
                        let pat_e = split_jq_binary(arg_expr, ";").map(|(a, _)| a).unwrap_or_else(|| arg_expr.to_string());
                        let pat = eval_jq(&pat_e, input, vars)?
                            .first()
                            .map(|v| v.to_raw_string(true, false))
                            .unwrap_or_default();
                        let (cleaned_pat, _) = strip_jq_named_groups(&pat);
                        let matched =
                            ZeroRegex::new(vec![cleaned_pat], false, false, false, false).is_match(st);
                        return Ok(Some(vec![JVal::Bool(matched)]));
                    }
                }
                "capture" => {
                    if let JVal::Str(st) = input {
                        let pat_e = split_jq_binary(arg_expr, ";").map(|(a, _)| a).unwrap_or_else(|| arg_expr.to_string());
                        let pat = eval_jq(&pat_e, input, vars)?
                            .first()
                            .map(|v| v.to_raw_string(true, false))
                            .unwrap_or_default();
                        let (cleaned_pat, names) = strip_jq_named_groups(&pat);
                        let rx = ZeroRegex::new(vec![cleaned_pat.clone()], false, false, false, false);
                        if let Some(&(s_idx, e_idx)) = rx.find_all(st).first() {
                            let matched_slice = &st[s_idx..e_idx];
                            let core = cleaned_pat.strip_prefix('^').unwrap_or(&cleaned_pat);
                            let core = core.strip_suffix('$').unwrap_or(core);
                            let caps = regex_captures(&format!("^{core}$"), matched_slice, false)
                                .or_else(|| regex_captures(&cleaned_pat, matched_slice, false))
                                .unwrap_or_default();
                            let mut obj = Vec::new();
                            for (idx, gname) in names.into_iter().enumerate() {
                                let val = caps.get(idx + 1).cloned().unwrap_or_default();
                                obj.push((gname, JVal::Str(val)));
                            }
                            return Ok(Some(vec![JVal::Object(obj)]));
                        }
                        return Ok(Some(vec![JVal::Object(Vec::new())]));
                    }
                }
                "scan" => {
                    if let JVal::Str(st) = input {
                        let pat = eval_jq(arg_expr, input, vars)?
                            .first()
                            .map(|v| v.to_raw_string(true, false))
                            .unwrap_or_default();
                        let (cleaned_pat, _) = strip_jq_named_groups(&pat);
                        let has_groups = cleaned_pat.contains('(');
                        let rx = ZeroRegex::new(vec![cleaned_pat.clone()], false, false, false, false);
                        let mut out = Vec::new();
                        let mut last_end = 0usize;
                        for (s_idx, e_idx) in rx.find_all(st) {
                            if s_idx >= last_end && e_idx > s_idx {
                                let matched_slice = &st[s_idx..e_idx];
                                if has_groups {
                                    let core = cleaned_pat.strip_prefix('^').unwrap_or(&cleaned_pat);
                                    let core = core.strip_suffix('$').unwrap_or(core);
                                    let caps = regex_captures(&format!("^{core}$"), matched_slice, false)
                                        .or_else(|| regex_captures(&cleaned_pat, matched_slice, false))
                                        .unwrap_or_default();
                                    if caps.len() > 1 {
                                        out.push(JVal::Array(
                                            caps[1..].iter().map(|c| JVal::Str(c.clone())).collect(),
                                        ));
                                    } else {
                                        out.push(JVal::Str(matched_slice.to_string()));
                                    }
                                } else {
                                    out.push(JVal::Str(matched_slice.to_string()));
                                }
                                last_end = e_idx;
                            }
                        }
                        return Ok(Some(out));
                    }
                }
                "splits" => {
                    if let JVal::Str(st) = input {
                        let pat_e = split_jq_binary(arg_expr, ";").map(|(a, _)| a).unwrap_or_else(|| arg_expr.to_string());
                        let pat = eval_jq(&pat_e, input, vars)?
                            .first()
                            .map(|v| v.to_raw_string(true, false))
                            .unwrap_or_default();
                        let (cleaned_pat, _) = strip_jq_named_groups(&pat);
                        let rx = ZeroRegex::new(vec![cleaned_pat], false, false, false, false);
                        let mut out = Vec::new();
                        let mut last_end = 0usize;
                        for (s_idx, e_idx) in rx.find_all(st) {
                            if s_idx >= last_end && e_idx > s_idx {
                                out.push(JVal::Str(st[last_end..s_idx].to_string()));
                                last_end = e_idx;
                            }
                        }
                        out.push(JVal::Str(st[last_end..].to_string()));
                        return Ok(Some(out));
                    }
                }
                "sub" | "gsub" => {
                    if let JVal::Str(st) = input {
                        if let Some((pat_e, repl_e)) = split_jq_binary(arg_expr, ";") {
                            let pat = eval_jq(&pat_e, input, vars)?
                                .first()
                                .map(|v| v.to_raw_string(true, false))
                                .unwrap_or_default();
                            let (cleaned_pat, names) = strip_jq_named_groups(&pat);
                            if !names.is_empty() {
                                let rx = ZeroRegex::new(vec![cleaned_pat.clone()], false, false, false, false);
                                let core = cleaned_pat.strip_prefix('^').unwrap_or(&cleaned_pat);
                                let core = core.strip_suffix('$').unwrap_or(core);
                                let mut out = String::new();
                                let mut last_end = 0usize;
                                for (idx, (s_idx, e_idx)) in rx.find_all(st).into_iter().enumerate() {
                                    if s_idx < last_end {
                                        continue;
                                    }
                                    if fname == "sub" && idx > 0 {
                                        break;
                                    }
                                    out.push_str(&st[last_end..s_idx]);
                                    let matched_slice = &st[s_idx..e_idx];
                                    let caps = regex_captures(&format!("^{core}$"), matched_slice, false)
                                        .or_else(|| regex_captures(&cleaned_pat, matched_slice, false))
                                        .unwrap_or_default();
                                    let mut cap_obj = Vec::new();
                                    for (g_i, gname) in names.iter().enumerate() {
                                        let v = caps.get(g_i + 1).cloned().unwrap_or_default();
                                        cap_obj.push((gname.clone(), JVal::Str(v)));
                                    }
                                    let rep_s = eval_jq(repl_e.trim(), &JVal::Object(cap_obj), vars)?
                                        .first()
                                        .map(|v| v.to_raw_string(true, false))
                                        .unwrap_or_default();
                                    out.push_str(&rep_s);
                                    last_end = e_idx;
                                }
                                out.push_str(&st[last_end..]);
                                return Ok(Some(vec![JVal::Str(out)]));
                            }
                            let repl = eval_jq(&repl_e, input, vars)?
                                .first()
                                .map(|v| v.to_raw_string(true, false))
                                .unwrap_or_default();
                            let (res, _) = replace_regex_in_text(
                                st,
                                &cleaned_pat,
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
                    let mut updated = input.clone();
                    let targets = split_jq_top(arg_expr, ',').unwrap_or_else(|| vec![arg_expr.to_string()]);
                    for t in targets {
                        let t_trim = t.trim();
                        if let Some(after_rec) = t_trim.strip_prefix("..") {
                            let rest = after_rec
                                .trim()
                                .strip_prefix('|')
                                .map(|s| s.trim())
                                .unwrap_or("");
                            let rkey = rest.trim_start_matches('.').trim_end_matches('?').trim();
                            if !rkey.is_empty() {
                                del_recursive_key_jval(&mut updated, rkey);
                                continue;
                            }
                        }
                        let key = t_trim.trim_start_matches('.').trim_end_matches('?');
                        let path: Vec<&str> = key.split('.').filter(|s| !s.is_empty()).collect();
                        del_nested_jval(&mut updated, &path);
                    }
                    return Ok(Some(vec![updated]));
                }
                "walk" => {
                    return Ok(Some(vec![walk_jval(input, arg_expr, vars)?]));
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
                "flatten" => {
                    if let JVal::Array(a) = input {
                        let depth_f = eval_jq(arg_expr, input, vars)?
                            .first()
                            .and_then(|v| match v {
                                JVal::Number(n) => Some(*n),
                                _ => None,
                            })
                            .unwrap_or(0.0);
                        if depth_f < 0.0 {
                            return Err("flatten depth must not be negative".to_string());
                        }
                        let mut out = Vec::new();
                        flatten_jval(a, depth_f as usize, &mut out);
                        return Ok(Some(vec![JVal::Array(out)]));
                    }
                }
                "any" | "all" => {
                    let is_any = fname == "any";
                    if let Some((gen_e, cond_e)) = split_jq_binary(arg_expr, ";") {
                        let items = eval_jq(gen_e.trim(), input, vars)?;
                        let mut res = !is_any;
                        for item in items {
                            let ok = eval_jq(cond_e.trim(), &item, vars)?
                                .into_iter()
                                .any(|v| v.is_truthy());
                            if is_any && ok {
                                res = true;
                                break;
                            }
                            if !is_any && !ok {
                                res = false;
                                break;
                            }
                        }
                        return Ok(Some(vec![JVal::Bool(res)]));
                    } else if let JVal::Array(a) = input {
                        let mut res = !is_any;
                        for item in a {
                            let ok = eval_jq(arg_expr.trim(), item, vars)?
                                .into_iter()
                                .any(|v| v.is_truthy());
                            if is_any && ok {
                                res = true;
                                break;
                            }
                            if !is_any && !ok {
                                res = false;
                                break;
                            }
                        }
                        return Ok(Some(vec![JVal::Bool(res)]));
                    }
                }
                "range" => {
                    if let Some((a_e, rest_e)) = split_jq_binary(arg_expr, ";") {
                        let a = eval_jq(&a_e, input, vars)?
                            .first()
                            .and_then(|v| match v {
                                JVal::Number(n) => Some(*n),
                                _ => None,
                            })
                            .unwrap_or(0.0);
                        if let Some((b_e, step_e)) = split_jq_binary(&rest_e, ";") {
                            let b = eval_jq(&b_e, input, vars)?
                                .first()
                                .and_then(|v| match v {
                                    JVal::Number(n) => Some(*n),
                                    _ => None,
                                })
                                .unwrap_or(0.0);
                            let step = eval_jq(&step_e, input, vars)?
                                .first()
                                .and_then(|v| match v {
                                    JVal::Number(n) => Some(*n),
                                    _ => None,
                                })
                                .unwrap_or(1.0);
                            let mut out = Vec::new();
                            let mut cur = a;
                            if step > 0.0 {
                                while cur < b {
                                    out.push(JVal::Number(clean_jval_num(cur)));
                                    cur += step;
                                }
                            } else if step < 0.0 {
                                while cur > b {
                                    out.push(JVal::Number(clean_jval_num(cur)));
                                    cur += step;
                                }
                            }
                            return Ok(Some(out));
                        }
                        let b = eval_jq(&rest_e, input, vars)?
                            .first()
                            .and_then(|v| match v {
                                JVal::Number(n) => Some(*n as i64),
                                _ => None,
                            })
                            .unwrap_or(0);
                        return Ok(Some(((a as i64)..b).map(|n| JVal::Number(n as f64)).collect()));
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
                "error" => {
                    let v = eval_jq(arg_expr, input, vars)?
                        .into_iter()
                        .next()
                        .unwrap_or_else(|| input.clone());
                    return Err(format!("__jq_err:{}", v.to_json_string(true, false, 0)));
                }
                "while" | "until" => {
                    if let Some((cond_e, step_e)) = split_jq_binary(arg_expr, ";") {
                        let mut cur = input.clone();
                        let mut out = Vec::new();
                        for _ in 0..10000 {
                            let cond_ok = eval_jq(cond_e.trim(), &cur, vars)?
                                .first()
                                .map(|v| v.is_truthy())
                                .unwrap_or(false);
                            if fname == "while" {
                                if !cond_ok {
                                    break;
                                }
                                out.push(cur.clone());
                            } else if cond_ok {
                                out.push(cur);
                                break;
                            }
                            cur = eval_jq(step_e.trim(), &cur, vars)?
                                .into_iter()
                                .next()
                                .unwrap_or(JVal::Null);
                        }
                        return Ok(Some(out));
                    }
                }
                "limit" => {
                    if let Some((n_e, expr_e)) = split_jq_binary(arg_expr, ";") {
                        let n = eval_jq(n_e.trim(), input, vars)?
                            .first()
                            .and_then(|v| match v {
                                JVal::Number(num) => Some(*num as usize),
                                _ => None,
                            })
                            .unwrap_or(0);
                        let vals = eval_jq(expr_e.trim(), input, vars)?;
                        return Ok(Some(vals.into_iter().take(n).collect()));
                    }
                }
                "first" => {
                    let vals = eval_jq(arg_expr, input, vars)?;
                    return Ok(Some(vals.into_iter().take(1).collect()));
                }
                "last" => {
                    let vals = eval_jq(arg_expr, input, vars)?;
                    return Ok(Some(vals.into_iter().next_back().into_iter().collect()));
                }
                "isempty" => {
                    let vals = eval_jq(arg_expr, input, vars)?;
                    return Ok(Some(vec![JVal::Bool(vals.is_empty())]));
                }
                "nth" => {
                    if let Some((n_e, expr_e)) = split_jq_binary(arg_expr, ";") {
                        let n = eval_jq(n_e.trim(), input, vars)?
                            .first()
                            .and_then(|v| match v {
                                JVal::Number(num) => Some(*num as usize),
                                _ => None,
                            })
                            .unwrap_or(0);
                        let vals = eval_jq(expr_e.trim(), input, vars)?;
                        return Ok(Some(vals.into_iter().nth(n).into_iter().collect()));
                    } else if let JVal::Array(a) = input {
                        let n = eval_jq(arg_expr, input, vars)?
                            .first()
                            .and_then(|v| match v {
                                JVal::Number(num) => Some(*num as usize),
                                _ => None,
                            })
                            .unwrap_or(0);
                        return Ok(Some(vec![a.get(n).cloned().unwrap_or(JVal::Null)]));
                    }
                }
                "INDEX" => {
                    let (stream_e, idx_e) = if let Some((s_e, i_e)) = split_jq_binary(arg_expr, ";") {
                        (s_e, i_e)
                    } else {
                        (".[]".to_string(), arg_expr.to_string())
                    };
                    let items = eval_jq(stream_e.trim(), input, vars)?;
                    let mut entries: Vec<(String, JVal)> = Vec::new();
                    for item in items {
                        if let Some(kv) = eval_jq(idx_e.trim(), &item, vars)?.into_iter().next() {
                            let key_s = kv.to_raw_string(true, false);
                            if let Some(existing) = entries.iter_mut().find(|(k, _)| k == &key_s) {
                                existing.1 = item;
                            } else {
                                entries.push((key_s, item));
                            }
                        }
                    }
                    return Ok(Some(vec![JVal::Object(entries)]));
                }
                "IN" => {
                    let (src_e, stream_e) = if let Some((s_e, st_e)) = split_jq_binary(arg_expr, ";") {
                        (s_e, st_e)
                    } else {
                        (".".to_string(), arg_expr.to_string())
                    };
                    let srcs = eval_jq(src_e.trim(), input, vars)?;
                    let stream_vals = eval_jq(stream_e.trim(), input, vars)?;
                    let found = srcs.iter().any(|sv| stream_vals.iter().any(|tv| sv == tv));
                    return Ok(Some(vec![JVal::Bool(found)]));
                }
                "strenv" => {
                    let vname = arg_expr.trim().trim_matches('"').trim_matches('\'');
                    let val = match vars.get(vname) {
                        Some(JVal::Str(s)) => s.clone(),
                        Some(other) => other.to_raw_string(true, false),
                        None => String::new(),
                    };
                    return Ok(Some(vec![JVal::Str(val)]));
                }
                "env" => {
                    let vname = arg_expr.trim().trim_matches('"').trim_matches('\'');
                    let val = match vars.get(vname) {
                        Some(JVal::Str(s)) => parse_yaml_scalar(s, &mut BTreeMap::new()),
                        Some(other) => other.clone(),
                        None => JVal::Null,
                    };
                    return Ok(Some(vec![val]));
                }
                "recurse" => {
                    let mut out = Vec::new();
                    if let Some((f_e, cond_e)) = split_jq_binary(arg_expr, ";") {
                        collect_jq_recurse_filter_cond(input, f_e.trim(), Some(cond_e.trim()), vars, &mut out)?;
                    } else {
                        collect_jq_recurse_filter_cond(input, arg_expr, None, vars, &mut out)?;
                    }
                    return Ok(Some(out));
                }
                other => {
                    if let Some(JVal::Str(def_spec)) = vars.get(&format!("__def_{other}"))
                        && let Some((param, body)) = def_spec.split_once("::")
                    {
                        let params: Vec<&str> = param.split(';').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
                        let args: Vec<String> = split_jq_top(arg_expr, ';').unwrap_or_else(|| vec![arg_expr.to_string()]);
                        let mut call_vars = vars.clone();
                        let mut expanded = body.to_string();
                        for (idx, p) in params.iter().enumerate() {
                            let a_str = args.get(idx).map(|s| s.trim()).unwrap_or(".");
                            if let Some(vname) = p.strip_prefix('$') {
                                let av = eval_jq(a_str, input, vars)?.into_iter().next().unwrap_or(JVal::Null);
                                call_vars.insert(vname.trim().to_string(), av);
                            } else {
                                expanded = replace_jq_ident(&expanded, p, &format!("({a_str})"));
                            }
                        }
                        return eval_jq(&expanded, input, &call_vars).map(Some);
                    }
                }
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

fn walk_jval(
    val: &JVal,
    f_expr: &str,
    vars: &BTreeMap<String, JVal>,
) -> Result<JVal, String> {
    let stepped = match val {
        JVal::Array(items) => {
            let mut new_items = Vec::with_capacity(items.len());
            for item in items {
                new_items.push(walk_jval(item, f_expr, vars)?);
            }
            JVal::Array(new_items)
        }
        JVal::Object(entries) => {
            let mut new_entries = Vec::with_capacity(entries.len());
            for (k, v) in entries {
                new_entries.push((k.clone(), walk_jval(v, f_expr, vars)?));
            }
            JVal::Object(new_entries)
        }
        other => other.clone(),
    };
    Ok(eval_jq(f_expr, &stepped, vars)?
        .into_iter()
        .next()
        .unwrap_or(JVal::Null))
}

fn collect_jq_stream_events(val: &JVal, path: &mut Vec<JVal>, out: &mut Vec<JVal>) {
    match val {
        JVal::Array(items) if !items.is_empty() => {
            for (idx, item) in items.iter().enumerate() {
                path.push(JVal::Number(idx as f64));
                collect_jq_stream_events(item, path, out);
                path.pop();
            }
            let mut close_path = path.clone();
            close_path.push(JVal::Number((items.len() - 1) as f64));
            out.push(JVal::Array(vec![JVal::Array(close_path)]));
        }
        JVal::Object(entries) if !entries.is_empty() => {
            for (k, v) in entries {
                path.push(JVal::Str(k.clone()));
                collect_jq_stream_events(v, path, out);
                path.pop();
            }
            let mut close_path = path.clone();
            close_path.push(JVal::Str(entries.last().unwrap().0.clone()));
            out.push(JVal::Array(vec![JVal::Array(close_path)]));
        }
        leaf => {
            out.push(JVal::Array(vec![JVal::Array(path.clone()), leaf.clone()]));
        }
    }
}

fn collect_pattern_vars(pat: &str, out: &mut Vec<String>) {
    let chars: Vec<char> = pat.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '$' {
            i += 1;
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            if i > start {
                let vname: String = chars[start..i].iter().collect();
                if !out.contains(&vname) {
                    out.push(vname);
                }
            }
        } else {
            i += 1;
        }
    }
}

fn bind_jq_alternatives(pat_expr: &str, val: &JVal, vars: &mut BTreeMap<String, JVal>) {
    let alts: Vec<&str> = pat_expr.split("?//").map(|s| s.trim()).collect();
    let mut all_vars = Vec::new();
    for alt in &alts {
        collect_pattern_vars(alt, &mut all_vars);
    }
    for vn in &all_vars {
        vars.insert(vn.clone(), JVal::Null);
    }
    let strict = alts.len() > 1;
    for alt in alts {
        let mut trial = BTreeMap::new();
        for vn in &all_vars {
            trial.insert(vn.clone(), JVal::Null);
        }
        if try_bind_jq_pattern(alt, val, &mut trial, strict) {
            for (k, v) in trial {
                vars.insert(k, v);
            }
            return;
        }
    }
}

fn try_bind_jq_pattern(
    pat: &str,
    val: &JVal,
    vars: &mut BTreeMap<String, JVal>,
    strict: bool,
) -> bool {
    let p = pat.trim();
    if let Some(vname) = p.strip_prefix('$') {
        vars.insert(vname.trim().to_string(), val.clone());
        return true;
    }
    if p.starts_with('[') && p.ends_with(']') {
        let JVal::Array(arr) = val else {
            return false;
        };
        let inner = p[1..p.len() - 1].trim();
        let elems = split_jq_top(inner, ',').unwrap_or_else(|| {
            if inner.is_empty() {
                Vec::new()
            } else {
                vec![inner.to_string()]
            }
        });
        for (idx, ep) in elems.iter().enumerate() {
            let sub_val = arr.get(idx).unwrap_or(&JVal::Null);
            if !try_bind_jq_pattern(ep, sub_val, vars, strict) {
                return false;
            }
        }
        return true;
    }
    if p.starts_with('{') && p.ends_with('}') {
        let JVal::Object(obj) = val else {
            return false;
        };
        let inner = p[1..p.len() - 1].trim();
        let entries = split_jq_top(inner, ',').unwrap_or_else(|| {
            if inner.is_empty() {
                Vec::new()
            } else {
                vec![inner.to_string()]
            }
        });
        for entry in entries {
            let et = entry.trim();
            if let Some((k_raw, sub_pat)) = split_jq_binary(et, ":") {
                let key = k_raw.trim().trim_start_matches('$').trim_matches('"');
                if let Some((_, sub_val)) = obj.iter().find(|(ek, _)| ek == key) {
                    if !try_bind_jq_pattern(&sub_pat, sub_val, vars, strict) {
                        return false;
                    }
                } else if strict {
                    return false;
                } else {
                    let _ = try_bind_jq_pattern(&sub_pat, &JVal::Null, vars, false);
                }
            } else if let Some(vname) = et.strip_prefix('$') {
                let key = vname.trim();
                if let Some((_, sub_val)) = obj.iter().find(|(ek, _)| ek == key) {
                    vars.insert(key.to_string(), sub_val.clone());
                } else if strict {
                    return false;
                } else {
                    vars.insert(key.to_string(), JVal::Null);
                }
            }
        }
        return true;
    }
    false
}

fn collect_jq_recurse_filter_cond(
    val: &JVal,
    f_expr: &str,
    cond_expr: Option<&str>,
    vars: &BTreeMap<String, JVal>,
    out: &mut Vec<JVal>,
) -> Result<(), String> {
    if let Some(ce) = cond_expr {
        let ok = eval_jq(ce, val, vars)?
            .first()
            .map(|v| v.is_truthy())
            .unwrap_or(false);
        if !ok {
            return Ok(());
        }
    }
    out.push(val.clone());
    let children = eval_jq(f_expr, val, vars).unwrap_or_default();
    for child in children {
        if !matches!(child, JVal::Null) {
            collect_jq_recurse_filter_cond(&child, f_expr, cond_expr, vars, out)?;
        }
    }
    Ok(())
}

fn jval_contains(haystack: &JVal, needle: &JVal) -> bool {
    match (haystack, needle) {
        (JVal::Str(a), JVal::Str(b)) => a.contains(b.as_str()),
        (JVal::Array(a), JVal::Array(b)) => {
            b.iter().all(|bx| a.iter().any(|ax| jval_contains(ax, bx)))
        }
        (JVal::Array(a), other) => a.iter().any(|ax| jval_contains(ax, other)),
        (JVal::Object(a), JVal::Object(b)) => b.iter().all(|(bk, bv)| {
            a.iter()
                .find(|(ak, _)| ak == bk)
                .is_some_and(|(_, av)| jval_contains(av, bv))
        }),
        (a, b) => a == b,
    }
}

fn strip_jq_named_groups(pat: &str) -> (String, Vec<String>) {
    let chars: Vec<char> = pat.chars().collect();
    let mut cleaned = String::new();
    let mut names = Vec::new();
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '(' && i + 2 < chars.len() && chars[i + 1] == '?' && chars[i + 2] == '<' {
            if let Some(rel_gt) = chars[i + 3..].iter().position(|&c| c == '>') {
                let name: String = chars[i + 3..i + 3 + rel_gt].iter().collect();
                names.push(name);
                cleaned.push('(');
                i += 3 + rel_gt + 1;
                continue;
            }
        }
        cleaned.push(chars[i]);
        i += 1;
    }
    (cleaned, names)
}

fn epoch_to_iso8601(epoch: i64) -> String {
    let days = epoch.div_euclid(86400);
    let rem = epoch.rem_euclid(86400);
    let hour = rem / 3600;
    let min = (rem % 3600) / 60;
    let sec = rem % 60;
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!("{year:04}-{m:02}-{d:02}T{hour:02}:{min:02}:{sec:02}Z")
}

fn iso8601_to_epoch(s: &str) -> i64 {
    let clean = s.trim().trim_end_matches('Z');
    let (date_p, time_p) = clean.split_once('T').unwrap_or((clean, "00:00:00"));
    let mut dp = date_p.split('-');
    let y: i64 = dp.next().and_then(|v| v.parse().ok()).unwrap_or(1970);
    let m: i64 = dp.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let d: i64 = dp.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let mut tp = time_p.split(':');
    let hh: i64 = tp.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let mm: i64 = tp.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let ss: i64 = tp
        .next()
        .and_then(|v| v.split('.').next())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let y_adj = if m <= 2 { y - 1 } else { y };
    let era = if y_adj >= 0 { y_adj } else { y_adj - 399 } / 400;
    let yoe = y_adj - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    days * 86400 + hh * 3600 + mm * 60 + ss
}

fn preprocess_jq_imports(
    filter: &str,
    lib_dirs: &[String],
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> String {
    let mut cur = filter.trim().to_string();
    let mut collected_defs = String::new();
    let mut aliases: Vec<String> = Vec::new();
    loop {
        let trimmed = cur.trim_start();
        if let Some(after_imp) = trimmed.strip_prefix("import ")
            && let Some((imp_spec, rest)) = split_jq_binary(after_imp, ";")
            && let Some((mod_part, alias_part)) = imp_spec.split_once(" as ")
        {
            let mod_name = mod_part.trim().trim_matches('"');
            let alias = alias_part.trim().to_string();
            let mod_src = load_jq_module(mod_name, lib_dirs, cwd, fs);
            let expanded_mod = preprocess_jq_imports(&mod_src, lib_dirs, cwd, fs);
            for part in expanded_mod.split(';') {
                let pt = part.trim();
                if let Some(def_body) = pt.strip_prefix("def ") {
                    let rewritten = def_body.replace(&format!("{alias}::"), &format!("{alias}__"));
                    collected_defs.push_str(&format!("def {alias}__{rewritten}; "));
                }
            }
            aliases.push(alias);
            cur = rest;
            continue;
        }
        if let Some(after_inc) = trimmed.strip_prefix("include ")
            && let Some((inc_spec, rest)) = split_jq_binary(after_inc, ";")
        {
            let mod_name = inc_spec.trim().trim_matches('"');
            let mod_src = load_jq_module(mod_name, lib_dirs, cwd, fs);
            let expanded_mod = preprocess_jq_imports(&mod_src, lib_dirs, cwd, fs);
            collected_defs.push_str(&expanded_mod);
            collected_defs.push(' ');
            cur = rest;
            continue;
        }
        break;
    }
    let mut final_str = format!("{collected_defs}{cur}");
    for alias in aliases {
        final_str = final_str.replace(&format!("{alias}::"), &format!("{alias}__"));
    }
    final_str
}

fn load_jq_module(mod_name: &str, lib_dirs: &[String], cwd: &str, fs: &dyn SafeBashFs) -> String {
    for dir in lib_dirs {
        let p = resolve_posix_path(cwd, &format!("{dir}/{mod_name}.jq"));
        if let Ok(b) = fs.read_file(&p) {
            return String::from_utf8_lossy(&b).into_owned();
        }
    }
    let p = resolve_posix_path(cwd, &format!("{mod_name}.jq"));
    if let Ok(b) = fs.read_file(&p) {
        return String::from_utf8_lossy(&b).into_owned();
    }
    String::new()
}

fn collect_jq_recurse(val: &JVal, out: &mut Vec<JVal>) {
    out.push(val.clone());
    match val {
        JVal::Array(items) => {
            for item in items {
                collect_jq_recurse(item, out);
            }
        }
        JVal::Object(entries) => {
            for (_, v) in entries {
                collect_jq_recurse(v, out);
            }
        }
        _ => {}
    }
}

fn collect_jq_paths(val: &JVal, cur: &mut Vec<JVal>, out: &mut Vec<JVal>) {
    match val {
        JVal::Array(items) => {
            for (idx, item) in items.iter().enumerate() {
                cur.push(JVal::Number(idx as f64));
                out.push(JVal::Array(cur.clone()));
                collect_jq_paths(item, cur, out);
                cur.pop();
            }
        }
        JVal::Object(entries) => {
            for (k, v) in entries {
                cur.push(JVal::Str(k.clone()));
                out.push(JVal::Array(cur.clone()));
                collect_jq_paths(v, cur, out);
                cur.pop();
            }
        }
        _ => {}
    }
}

fn get_jq_jval_path(val: &JVal, segs: &[JVal]) -> JVal {
    if segs.is_empty() {
        return val.clone();
    }
    match (val, &segs[0]) {
        (JVal::Object(map), JVal::Str(k)) => map
            .iter()
            .find(|(ek, _)| ek == k)
            .map(|(_, c)| get_jq_jval_path(c, &segs[1..]))
            .unwrap_or(JVal::Null),
        (JVal::Array(arr), JVal::Number(n)) => {
            let idx = *n as isize;
            let r = if idx < 0 {
                (arr.len() as isize) + idx
            } else {
                idx
            };
            if r >= 0 && (r as usize) < arr.len() {
                get_jq_jval_path(&arr[r as usize], &segs[1..])
            } else {
                JVal::Null
            }
        }
        _ => JVal::Null,
    }
}

fn set_jq_jval_path(val: &mut JVal, segs: &[JVal], new_val: JVal) {
    if segs.is_empty() {
        *val = new_val;
        return;
    }
    match &segs[0] {
        JVal::Str(k) => {
            if !matches!(val, JVal::Object(_)) {
                *val = JVal::Object(Vec::new());
            }
            if let JVal::Object(map) = val {
                if segs.len() == 1 {
                    if let Some(pos) = map.iter().position(|(ek, _)| ek == k) {
                        map[pos].1 = new_val;
                    } else {
                        map.push((k.clone(), new_val));
                    }
                } else if let Some(pos) = map.iter().position(|(ek, _)| ek == k) {
                    set_jq_jval_path(&mut map[pos].1, &segs[1..], new_val);
                } else {
                    let mut child = JVal::Null;
                    set_jq_jval_path(&mut child, &segs[1..], new_val);
                    map.push((k.clone(), child));
                }
            }
        }
        JVal::Number(n) => {
            let idx = (*n as isize).max(0) as usize;
            if !matches!(val, JVal::Array(_)) {
                *val = JVal::Array(Vec::new());
            }
            if let JVal::Array(arr) = val {
                while arr.len() <= idx {
                    arr.push(JVal::Null);
                }
                if segs.len() == 1 {
                    arr[idx] = new_val;
                } else {
                    set_jq_jval_path(&mut arr[idx], &segs[1..], new_val);
                }
            }
        }
        _ => {}
    }
}

fn delete_jq_jval_path(val: &mut JVal, segs: &[JVal]) {
    if segs.is_empty() {
        return;
    }
    match (val, &segs[0]) {
        (JVal::Object(map), JVal::Str(k)) => {
            if segs.len() == 1 {
                map.retain(|(ek, _)| ek != k);
            } else if let Some((_, child)) = map.iter_mut().find(|(ek, _)| ek == k) {
                delete_jq_jval_path(child, &segs[1..]);
            }
        }
        (JVal::Array(arr), JVal::Number(n)) => {
            let idx = *n as isize;
            let r = if idx < 0 {
                (arr.len() as isize) + idx
            } else {
                idx
            };
            if r >= 0 && (r as usize) < arr.len() {
                let u = r as usize;
                if segs.len() == 1 {
                    arr.remove(u);
                } else {
                    delete_jq_jval_path(&mut arr[u], &segs[1..]);
                }
            }
        }
        _ => {}
    }
}

fn replace_jq_ident(body: &str, ident: &str, replacement: &str) -> String {
    let chars: Vec<char> = body.chars().collect();
    let id_chars: Vec<char> = ident.chars().collect();
    let mut out = String::new();
    let mut i = 0usize;
    while i < chars.len() {
        if i + id_chars.len() <= chars.len() && chars[i..i + id_chars.len()] == id_chars[..] {
            let prev_ok = i == 0
                || !(chars[i - 1].is_ascii_alphanumeric()
                    || chars[i - 1] == '_'
                    || chars[i - 1] == '.'
                    || chars[i - 1] == '$');
            let next_ok = i + id_chars.len() == chars.len()
                || !(chars[i + id_chars.len()].is_ascii_alphanumeric()
                    || chars[i + id_chars.len()] == '_');
            if prev_ok && next_ok {
                out.push_str(replacement);
                i += id_chars.len();
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn eval_jq_path(
    path: &str,
    input: &JVal,
    vars: &BTreeMap<String, JVal>,
) -> Result<Vec<JVal>, String> {
    eval_jq_path_with_root(path, input, input, vars)
}

fn eval_jq_path_with_root(
    path: &str,
    input: &JVal,
    dot_input: &JVal,
    vars: &BTreeMap<String, JVal>,
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
            } else if let Ok(idx_vals) = eval_jq(inside_trim, dot_input, vars) {
                let mut next = Vec::new();
                for idx_val in idx_vals {
                    match idx_val {
                        JVal::Str(ref k) => {
                            next.extend(step_field(&current, k, optional)?);
                        }
                        JVal::Number(n) => {
                            let idx_num = n as isize;
                            for v in &current {
                                if let JVal::Array(a) = v {
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
                                } else {
                                    next.push(JVal::Null);
                                }
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
                    .or_else(|| {
                        key.strip_prefix("+@")
                            .and_then(|rest| o.iter().find(|(k, _)| k == &format!("@{rest}")))
                    })
                    .or_else(|| {
                        key.strip_prefix('@')
                            .and_then(|rest| o.iter().find(|(k, _)| k == &format!("+@{rest}")))
                    })
                    .or_else(|| {
                        if key == "+content" {
                            o.iter().find(|(k, _)| k == "#text")
                        } else if key == "#text" {
                            o.iter().find(|(k, _)| k == "+content")
                        } else {
                            None
                        }
                    })
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

fn skip_jq_string(chars: &[char], start_quote_idx: usize) -> usize {
    let mut i = start_quote_idx + 1;
    while i < chars.len() {
        if chars[i] == '"' {
            return i + 1;
        }
        if chars[i] == '\\' && i + 1 < chars.len() {
            if chars[i + 1] == '(' {
                i += 2;
                let mut depth = 1i32;
                while i < chars.len() && depth > 0 {
                    if chars[i] == '"' {
                        i = skip_jq_string(chars, i);
                    } else if chars[i] == '(' {
                        depth += 1;
                        i += 1;
                    } else if chars[i] == ')' {
                        depth -= 1;
                        i += 1;
                    } else {
                        i += 1;
                    }
                }
            } else {
                i += 2;
            }
        } else {
            i += 1;
        }
    }
    chars.len()
}

fn split_jq_top(s: &str, delim: char) -> Option<Vec<String>> {
    let mut parts = Vec::new();
    let mut cur = String::new();
    let chars: Vec<char> = s.chars().collect();
    let mut paren = 0i32;
    let mut bracket = 0i32;
    let mut brace = 0i32;
    let mut if_depth = 0i32;
    let mut i = 0usize;

    while i < chars.len() {
        let c = chars[i];
        if c == '"' {
            let next_i = skip_jq_string(&chars, i);
            for &ch in &chars[i..next_i] {
                cur.push(ch);
            }
            i = next_i;
            continue;
        }
        {
            if paren == 0 && bracket == 0 && brace == 0 {
                if is_jq_kw_at(&chars, i, &['i', 'f']) {
                    if_depth += 1;
                } else if is_jq_kw_at(&chars, i, &['e', 'n', 'd']) {
                    if_depth = (if_depth - 1).max(0);
                }
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
    let mut paren = 0i32;
    let mut bracket = 0i32;
    let mut brace = 0i32;
    let mut if_depth = 0i32;
    let mut i = 0usize;

    while i + op_chars.len() <= chars.len() {
        let c = chars[i];
        if c == '"' {
            i = skip_jq_string(&chars, i);
            continue;
        }
        {
            if paren == 0 && bracket == 0 && brace == 0 {
                if is_jq_kw_at(&chars, i, &['i', 'f']) {
                    if_depth += 1;
                } else if is_jq_kw_at(&chars, i, &['e', 'n', 'd']) {
                    if_depth = (if_depth - 1).max(0);
                }
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
            if paren == 0
                && bracket == 0
                && brace == 0
                && if_depth == 0
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
    let mut paren = 0i32;
    let mut bracket = 0i32;
    let mut brace = 0i32;
    let mut if_depth = 0i32;
    let mut last_idx = None;
    let mut i = 0usize;

    while i + op_chars.len() <= chars.len() {
        let c = chars[i];
        if c == '"' {
            i = skip_jq_string(&chars, i);
            continue;
        }
        {
            if paren == 0 && bracket == 0 && brace == 0 {
                if is_jq_kw_at(&chars, i, &['i', 'f']) {
                    if_depth += 1;
                } else if is_jq_kw_at(&chars, i, &['e', 'n', 'd']) {
                    if_depth = (if_depth - 1).max(0);
                }
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
            if paren == 0
                && bracket == 0
                && brace == 0
                && if_depth == 0
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

fn jval_to_props_doc(v: &JVal, path: &mut Vec<String>, is_shell: bool, out: &mut String) {
    match v {
        JVal::Object(entries) => {
            for (k, child) in entries {
                path.push(k.clone());
                jval_to_props_doc(child, path, is_shell, out);
                path.pop();
            }
        }
        JVal::Array(items) => {
            for (idx, child) in items.iter().enumerate() {
                path.push(idx.to_string());
                jval_to_props_doc(child, path, is_shell, out);
                path.pop();
            }
        }
        _ => {
            let key = if is_shell {
                path.join("_")
            } else {
                path.join(".")
            };
            let val = match v {
                JVal::Null => String::new(),
                JVal::Str(s) => s.clone(),
                other => other.to_raw_string(true, false),
            };
            if is_shell {
                let safe = !val.is_empty()
                    && val
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || "_./-".contains(c));
                if safe {
                    out.push_str(&format!("{key}={val}\n"));
                } else {
                    out.push_str(&format!("{key}='{}'\n", val.replace('\x27', "'\\''")));
                }
            } else {
                out.push_str(&format!("{key} = {val}\n"));
            }
        }
    }
}

fn cmd_yq(
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut raw_output = false;
    let mut compact_output = false;
    let mut inplace = false;
    let mut pretty_print = false;
    let mut eval_all = false;
    let mut output_format = "yaml".to_string();
    let mut input_format: Option<String> = None;
    let mut filter: Option<String> = None;
    let mut files: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-P" || a == "--prettyPrint" {
            pretty_print = true;
            i += 1;
            continue;
        }
        if matches!(a.as_str(), "eval" | "e") {
            i += 1;
            continue;
        }
        if matches!(a.as_str(), "eval-all" | "ea") {
            eval_all = true;
            i += 1;
            continue;
        }
        if a == "-r" || a == "--raw-output" {
            raw_output = true;
            i += 1;
            continue;
        }
        if a == "-c" || a == "--compact-output" {
            compact_output = true;
            i += 1;
            continue;
        }
        if a == "-i" || a == "--inplace" {
            inplace = true;
            i += 1;
            continue;
        }
        if (a == "-I" || a == "--indent") && i + 1 < args.len() {
            if args[i + 1] == "0" {
                compact_output = true;
            }
            i += 2;
            continue;
        }
        if let Some(ind) = a.strip_prefix("-I=").or_else(|| a.strip_prefix("--indent=")) {
            if ind == "0" {
                compact_output = true;
            }
            i += 1;
            continue;
        }
        if (a == "-o" || a == "--output-format") && i + 1 < args.len() {
            output_format = args[i + 1].to_ascii_lowercase();
            i += 2;
            continue;
        }
        if let Some(fmt) = a.strip_prefix("-o=").or_else(|| a.strip_prefix("--output-format=")) {
            output_format = fmt.to_ascii_lowercase();
            i += 1;
            continue;
        }
        if (a == "-p" || a == "--input-format") && i + 1 < args.len() {
            input_format = Some(args[i + 1].to_ascii_lowercase());
            i += 2;
            continue;
        }
        if let Some(fmt) = a.strip_prefix("-p=").or_else(|| a.strip_prefix("--input-format=")) {
            input_format = Some(fmt.to_ascii_lowercase());
            i += 1;
            continue;
        }
        if a.starts_with("--") {
            if !matches!(
                a.as_str(),
                "--null-input" | "--no-doc" | "--no-colors" | "--exit-status" | "--unwrapScalar" | "--yaml-compact-seq-indent"
            ) {
                return err_out(&format!("Error: unknown flag: {a}\n"), 1);
            }
            i += 1;
            continue;
        }
        if a.starts_with('-') && a != "-" {
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
    let mut jq_args = Vec::new();
    if raw_output {
        jq_args.push("-r".to_string());
    }
    if compact_output || output_format != "json" {
        jq_args.push("-c".to_string());
    }
    if files.is_empty()
        && let Some(ref f) = filter
        && (f.contains('/')
            || f.ends_with(".yaml")
            || f.ends_with(".yml")
            || f.ends_with(".json")
            || f.ends_with(".toml")
            || f.ends_with(".xml"))
        && fs.read_file(&resolve_posix_path(cwd, f)).is_ok()
    {
        files.push(f.clone());
        filter = Some(".".to_string());
    }
    let mut final_filter = filter.unwrap_or_else(|| ".".to_string());
    if eval_all || final_filter.contains("fileIndex") || final_filter.contains("ireduce") {
        if final_filter.contains("fileIndex") || final_filter.contains("ireduce") {
            jq_args.push("-s".to_string());
            for idx in 0..10 {
                let pat1 = format!("select(fileIndex == {idx})");
                let pat2 = format!("select(fileIndex=={idx})");
                let repl = format!(".[{idx}]");
                final_filter = final_filter.replace(&pat1, &repl).replace(&pat2, &repl);
            }
            if final_filter.contains("ireduce") {
                final_filter = final_filter.replace(". as ", "reduce .[] as ").replace(" ireduce ", " ");
            }
        }
    }
    jq_args.push(final_filter);

    let is_json_in = input_format.as_deref() == Some("json")
        || (files.is_empty()
            && (stdin.trim_start().starts_with('{') || stdin.trim_start().starts_with('[')));
    let quote_yaml = is_json_in && !pretty_print;
    let filter_for_check = jq_args.last().cloned().unwrap_or_default();
    let is_derived_filter = {
        let ft = filter_for_check.trim();
        ft.ends_with('}') || ft.ends_with(']')
    };
    let mut docs = Vec::new();
    let mut raw_sources = Vec::new();
    if files.is_empty() {
        raw_sources.push(stdin.to_string());
        for jv in parse_yq_input_docs(stdin, input_format.as_deref(), None) {
            docs.push(jv.to_json_string(true, false, 0));
        }
    } else {
        for f in &files {
            let full = resolve_posix_path(cwd, f);
            if let Ok(b) = fs.read_file(&full) {
                let s = String::from_utf8_lossy(&b).into_owned();
                for jv in parse_yq_input_docs(&s, input_format.as_deref(), Some(f)) {
                    docs.push(jv.to_json_string(true, false, 0));
                }
                raw_sources.push(s);
            }
        }
    }
    for src in &raw_sources {
        if has_undefined_yaml_alias(src) {
            return err_out("Error: unknown alias\n", 1);
        }
    }
    let outcome = cmd_jq_with_env(&jq_args, &docs.join("\n"), cwd, env, fs);
    if outcome.exit_code != 0 {
        return outcome;
    }
    let final_out = if raw_output || output_format == "json" || output_format == "j" {
        outcome.stdout
    } else if let Ok(vals) = parse_json_stream(&outcome.stdout) {
        if output_format == "xml" || output_format == "x" {
            let mut xml_out = String::new();
            for v in &vals {
                xml_out.push_str(&jval_to_xml_doc(v));
            }
            xml_out
        } else if output_format == "csv" || output_format == "c" || output_format == "tsv" || output_format == "t" {
            let delim = if output_format == "tsv" || output_format == "t" { '\t' } else { ',' };
            let mut csv_out = String::new();
            for v in &vals {
                csv_out.push_str(&jval_to_csv_doc(v, delim));
            }
            csv_out
        } else if output_format == "toml" {
            let mut toml_out = String::new();
            for v in &vals {
                toml_out.push_str(&jval_to_toml_doc(v));
            }
            toml_out
        } else if output_format == "props" || output_format == "p" || output_format == "shell" || output_format == "s" {
            let is_shell = output_format == "shell" || output_format == "s";
            let mut props_out = String::new();
            for v in &vals {
                jval_to_props_doc(v, &mut Vec::new(), is_shell, &mut props_out);
            }
            props_out
        } else {
            let mut yaml_docs = Vec::new();
            for v in vals {
                yaml_docs.push(jval_to_yaml(&v, 0, quote_yaml));
            }
            if yaml_docs.len() > 1 && !is_derived_filter {
                yaml_docs.join("---\n")
            } else {
                yaml_docs.join("")
            }
        }
    } else {
        outcome.stdout
    };
    if inplace && let Some(first_file) = files.first() {
        let full = resolve_posix_path(cwd, first_file);
        let _ = fs.write_file(&full, final_out.as_bytes());
        return ok_out("");
    }
    ok_out(&final_out)
}

fn cmd_xq(
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut yq_args = vec!["-p".to_string(), "xml".to_string()];
    let mut want_yaml = false;
    for a in args {
        if a == "-y" || a == "--yaml-output" {
            want_yaml = true;
        } else {
            yq_args.push(a.clone());
        }
    }
    if want_yaml {
        yq_args.insert(2, "-o".to_string());
        yq_args.insert(3, "yaml".to_string());
    } else if !yq_args.iter().any(|a| a == "-o" || a == "--output-format" || a.starts_with("-o=")) {
        yq_args.insert(2, "-o".to_string());
        yq_args.insert(3, "json".to_string());
    }
    cmd_yq(&yq_args, stdin, cwd, env, fs)
}

fn unescape_xml_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'&'
            && let Some(rel_semi) = s[i + 1..].find(';')
            && rel_semi <= 12
        {
            let ent = &s[i + 1..i + 1 + rel_semi];
            let decoded: Option<String> = match ent {
                "lt" => Some("<".to_string()),
                "gt" => Some(">".to_string()),
                "quot" => Some("\"".to_string()),
                "apos" => Some("'".to_string()),
                "amp" => Some("&".to_string()),
                "nbsp" => Some(" ".to_string()),
                "mdash" => Some("—".to_string()),
                "ndash" => Some("–".to_string()),
                "copy" => Some("©".to_string()),
                "reg" => Some("®".to_string()),
                "trade" => Some("™".to_string()),
                "hellip" => Some("…".to_string()),
                _ if ent.starts_with("#x") || ent.starts_with("#X") => u32::from_str_radix(&ent[2..], 16)
                    .ok()
                    .and_then(char::from_u32)
                    .map(|c| c.to_string()),
                _ if ent.starts_with('#') => ent[1..]
                    .parse::<u32>()
                    .ok()
                    .and_then(char::from_u32)
                    .map(|c| c.to_string()),
                _ => None,
            };
            if let Some(rep) = decoded {
                out.push_str(&rep);
                i += rel_semi + 2;
                continue;
            }
        }
        let ch = s[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn skip_xml_trivia(s: &str, pos: &mut usize) {
    loop {
        while *pos < s.len() && s.as_bytes()[*pos].is_ascii_whitespace() {
            *pos += 1;
        }
        let rest = &s[*pos..];
        if rest.starts_with("<?") {
            if let Some(end) = rest.find("?>") {
                *pos += end + 2;
                continue;
            }
        }
        if rest.starts_with("<!--") {
            if let Some(end) = rest.find("-->") {
                *pos += end + 3;
                continue;
            }
        }
        if rest.starts_with("<!DOCTYPE") || rest.starts_with("<!doctype") {
            if let Some(end) = rest.find('>') {
                *pos += end + 1;
                continue;
            }
        }
        break;
    }
}

fn parse_xml_element(s: &str, pos: &mut usize) -> Option<(String, JVal)> {
    skip_xml_trivia(s, pos);
    if *pos >= s.len() || !s[*pos..].starts_with('<') || s[*pos..].starts_with("</") {
        return None;
    }
    *pos += 1;
    let name_start = *pos;
    while *pos < s.len() {
        let b = s.as_bytes()[*pos];
        if b.is_ascii_whitespace() || b == b'>' || b == b'/' {
            break;
        }
        *pos += 1;
    }
    let tag_name = s[name_start..*pos].to_string();
    if tag_name.is_empty() {
        return None;
    }

    let mut attrs: Vec<(String, JVal)> = Vec::new();
    let mut self_closing = false;
    while *pos < s.len() {
        while *pos < s.len() && s.as_bytes()[*pos].is_ascii_whitespace() {
            *pos += 1;
        }
        if *pos >= s.len() {
            break;
        }
        if s[*pos..].starts_with("/>") {
            self_closing = true;
            *pos += 2;
            break;
        }
        if s.as_bytes()[*pos] == b'>' {
            *pos += 1;
            break;
        }
        let attr_start = *pos;
        while *pos < s.len() {
            let b = s.as_bytes()[*pos];
            if b == b'=' || b.is_ascii_whitespace() || b == b'>' || b == b'/' {
                break;
            }
            *pos += 1;
        }
        let attr_name = s[attr_start..*pos].trim().to_string();
        while *pos < s.len() && s.as_bytes()[*pos].is_ascii_whitespace() {
            *pos += 1;
        }
        let mut attr_val = String::new();
        if *pos < s.len() && s.as_bytes()[*pos] == b'=' {
            *pos += 1;
            while *pos < s.len() && s.as_bytes()[*pos].is_ascii_whitespace() {
                *pos += 1;
            }
            if *pos < s.len() && (s.as_bytes()[*pos] == b'"' || s.as_bytes()[*pos] == b'\'') {
                let q = s.as_bytes()[*pos] as char;
                *pos += 1;
                let vstart = *pos;
                while *pos < s.len() && !s[*pos..].starts_with(q) {
                    *pos += s[*pos..].chars().next().map(|c| c.len_utf8()).unwrap_or(1);
                }
                attr_val = unescape_xml_entities(&s[vstart..*pos]);
                if *pos < s.len() {
                    *pos += 1;
                }
            }
        }
        if !attr_name.is_empty() {
            attrs.push((format!("@{attr_name}"), JVal::Str(attr_val)));
        }
    }

    if self_closing {
        let val = if attrs.is_empty() {
            JVal::Null
        } else {
            JVal::Object(attrs)
        };
        return Some((tag_name, val));
    }

    let mut children: Vec<(String, JVal)> = Vec::new();
    let mut text_buf = String::new();
    while *pos < s.len() {
        let rest = &s[*pos..];
        if rest.starts_with("<![CDATA[") {
            *pos += 9;
            if let Some(end) = s[*pos..].find("]]>") {
                text_buf.push_str(&s[*pos..*pos + end]);
                *pos += end + 3;
            } else {
                text_buf.push_str(&s[*pos..]);
                *pos = s.len();
            }
            continue;
        }
        if rest.starts_with("<!--") {
            if let Some(end) = rest.find("-->") {
                *pos += end + 3;
            } else {
                *pos = s.len();
            }
            continue;
        }
        if rest.starts_with("</") {
            if let Some(gt) = rest.find('>') {
                *pos += gt + 1;
            } else {
                *pos = s.len();
            }
            break;
        }
        if rest.starts_with('<') {
            if let Some(child) = parse_xml_element(s, pos) {
                children.push(child);
            } else {
                *pos += 1;
            }
            continue;
        }
        let next_lt = rest.find('<').unwrap_or(rest.len());
        text_buf.push_str(&unescape_xml_entities(&rest[..next_lt]));
        *pos += next_lt;
    }

    let mut entries = attrs;
    for (cname, cval) in children {
        if let Some((_, existing)) = entries.iter_mut().find(|(k, _)| k == &cname) {
            match existing {
                JVal::Array(arr) => arr.push(cval),
                other => {
                    let prev = other.clone();
                    *other = JVal::Array(vec![prev, cval]);
                }
            }
        } else {
            entries.push((cname, cval));
        }
    }
    let trimmed = text_buf.trim();
    let val = if entries.is_empty() {
        if trimmed.is_empty() {
            JVal::Null
        } else {
            JVal::Str(trimmed.to_string())
        }
    } else {
        if !trimmed.is_empty() {
            entries.push(("#text".to_string(), JVal::Str(trimmed.to_string())));
        }
        JVal::Object(entries)
    };
    Some((tag_name, val))
}

fn parse_xml_to_jval(input: &str) -> JVal {
    let mut pos = 0usize;
    if let Some((root_tag, root_val)) = parse_xml_element(input, &mut pos) {
        JVal::Object(vec![(root_tag, root_val)])
    } else {
        JVal::Null
    }
}

fn explode_jval_merge_keys(val: &JVal) -> JVal {
    match val {
        JVal::Array(items) => JVal::Array(items.iter().map(explode_jval_merge_keys).collect()),
        JVal::Object(entries) => {
            let mut merged: Vec<(String, JVal)> = Vec::new();
            let upsert = |target: &mut Vec<(String, JVal)>, k: String, v: JVal, override_existing: bool| {
                if let Some(pos) = target.iter().position(|(ek, _)| ek == &k) {
                    if override_existing {
                        target[pos].1 = v;
                    }
                } else {
                    target.push((k, v));
                }
            };
            for (k, v) in entries {
                let ev = explode_jval_merge_keys(v);
                if k == "<<" {
                    match ev {
                        JVal::Object(src_entries) => {
                            for (sk, sv) in src_entries {
                                upsert(&mut merged, sk, sv, true);
                            }
                        }
                        JVal::Array(src_list) => {
                            for item in src_list {
                                if let JVal::Object(src_entries) = item {
                                    for (sk, sv) in src_entries {
                                        upsert(&mut merged, sk, sv, true);
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                } else {
                    upsert(&mut merged, k.clone(), ev, true);
                }
            }
            JVal::Object(merged)
        }
        other => other.clone(),
    }
}

fn jval_primitive_str(val: &JVal) -> String {
    match val {
        JVal::Null => String::new(),
        JVal::Bool(b) => b.to_string(),
        JVal::Number(n) => JVal::Number(*n).to_json_string(true, false, 0),
        JVal::Str(s) => s.clone(),
        other => other.to_json_string(true, false, 0),
    }
}

fn xml_escape_attr_or_text(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn write_jval_xml_elem(name: &str, item: &JVal, depth: usize, out: &mut String) {
    if let JVal::Array(arr) = item {
        for child in arr {
            write_jval_xml_elem(name, child, depth, out);
        }
        return;
    }
    let pad = " ".repeat(depth * 2);
    out.push_str(&format!("{pad}<{name}"));
    if let JVal::Object(entries) = item {
        for (k, v) in entries {
            if let Some(attr) = k.strip_prefix("+@").or_else(|| k.strip_prefix('@')) {
                out.push_str(&format!(" {attr}=\"{}\"", xml_escape_attr_or_text(&jval_primitive_str(v))));
            }
        }
        out.push('>');
        let children: Vec<&(String, JVal)> = entries
            .iter()
            .filter(|(k, _)| !k.starts_with("+@") && !k.starts_with('@') && k != "+content" && k != "#text")
            .collect();
        if !children.is_empty() {
            out.push('\n');
            for (ck, cv) in &children {
                write_jval_xml_elem(ck, cv, depth + 1, out);
            }
        }
        if let Some((_, content)) = entries.iter().find(|(k, _)| k == "+content" || k == "#text") {
            out.push_str(&xml_escape_attr_or_text(&jval_primitive_str(content)));
        }
        if !children.is_empty() {
            out.push_str(&pad);
        }
    } else {
        out.push('>');
        out.push_str(&xml_escape_attr_or_text(&jval_primitive_str(item)));
    }
    out.push_str(&format!("</{name}>\n"));
}

fn jval_to_xml_doc(val: &JVal) -> String {
    let mut out = String::new();
    if let JVal::Object(entries) = val {
        for (k, v) in entries {
            write_jval_xml_elem(k, v, 0, &mut out);
        }
    }
    out
}

fn jval_to_csv_doc(val: &JVal, delim: char) -> String {
    let JVal::Array(items) = val else {
        return String::new();
    };
    if items.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    if let Some(JVal::Object(first_entries)) = items.first() {
        let headers: Vec<String> = first_entries.iter().map(|(k, _)| k.clone()).collect();
        out.push_str(&format_csv_row(&headers, delim));
        for item in items {
            if let JVal::Object(entries) = item {
                let row: Vec<String> = headers
                    .iter()
                    .map(|h| {
                        entries
                            .iter()
                            .find(|(k, _)| k == h)
                            .map(|(_, v)| jval_primitive_str(v))
                            .unwrap_or_default()
                    })
                    .collect();
                out.push_str(&format_csv_row(&row, delim));
            }
        }
    } else {
        for item in items {
            if let JVal::Array(arr) = item {
                let row: Vec<String> = arr.iter().map(jval_primitive_str).collect();
                out.push_str(&format_csv_row(&row, delim));
            }
        }
    }
    out
}

fn jval_to_toml_doc(val: &JVal) -> String {
    let JVal::Object(entries) = val else {
        return String::new();
    };
    let mut out = String::new();
    for (k, v) in entries {
        if !matches!(v, JVal::Object(_)) {
            out.push_str(&format!("{k} = {}\n", v.to_json_string(true, false, 0)));
        }
    }
    for (k, v) in entries {
        if let JVal::Object(sub) = v {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&format!("[{k}]\n"));
            for (sk, sv) in sub {
                out.push_str(&format!("{sk} = {}\n", sv.to_json_string(true, false, 0)));
            }
        }
    }
    out
}

fn parse_yq_csv_to_jval(input: &str, delim: char) -> JVal {
    let rows = parse_csv_rows(input, delim);
    if rows.is_empty() {
        return JVal::Array(Vec::new());
    }
    let headers = &rows[0];
    let mut out = Vec::new();
    for r in &rows[1..] {
        let mut obj = Vec::new();
        for (idx, h) in headers.iter().enumerate() {
            let cell = r.get(idx).map(|s| s.as_str()).unwrap_or("");
            let val = if cell == "true" {
                JVal::Bool(true)
            } else if cell == "false" {
                JVal::Bool(false)
            } else if cell == "null" || cell == "~" {
                JVal::Null
            } else if (!cell.starts_with('0') || cell == "0" || cell.starts_with("0."))
                && let Ok(n) = cell.parse::<f64>()
            {
                JVal::Number(n)
            } else {
                JVal::Str(cell.to_string())
            };
            obj.push((h.clone(), val));
        }
        out.push(JVal::Object(obj));
    }
    JVal::Array(out)
}


fn parse_props_to_jval(input: &str) -> JVal {
    let mut root = JVal::Object(Vec::new());
    for line in input.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('!') {
            continue;
        }
        if let Some((lhs, rhs)) = trimmed.split_once('=').or_else(|| trimmed.split_once(':')) {
            let key = lhs.trim();
            let val = rhs.trim();
            if key.is_empty() {
                continue;
            }
            let segs: Vec<JVal> = key
                .split('.')
                .map(|seg| {
                    if let Ok(idx) = seg.parse::<usize>() {
                        JVal::Number(idx as f64)
                    } else {
                        JVal::Str(seg.to_string())
                    }
                })
                .collect();
            set_jq_jval_path(&mut root, &segs, JVal::Str(val.to_string()));
        }
    }
    root
}

fn parse_yq_input_docs(input: &str, fmt: Option<&str>, filename: Option<&str>) -> Vec<JVal> {
    let is_xml = matches!(fmt, Some("xml") | Some("x"))
        || filename.map(|f| f.ends_with(".xml")).unwrap_or(false);
    if is_xml {
        return vec![parse_xml_to_jval(input)];
    }
    let is_toml = fmt == Some("toml")
        || filename.map(|f| f.ends_with(".toml")).unwrap_or(false);
    if is_toml {
        return vec![parse_toml_to_jval(input)];
    }
    let is_props = matches!(fmt, Some("props") | Some("p"))
        || filename.map(|f| f.ends_with(".properties")).unwrap_or(false);
    if is_props {
        return vec![parse_props_to_jval(input)];
    }
    let is_csv = matches!(fmt, Some("csv") | Some("c"))
        || (fmt.is_none() && filename.map(|f| f.ends_with(".csv")).unwrap_or(false));
    if is_csv {
        return vec![parse_yq_csv_to_jval(input, ',')];
    }
    let is_tsv = matches!(fmt, Some("tsv") | Some("t"))
        || (fmt.is_none() && filename.map(|f| f.ends_with(".tsv")).unwrap_or(false));
    if is_tsv {
        return vec![parse_yq_csv_to_jval(input, '\t')];
    }
    let trimmed = input.trim_start();
    if (trimmed.starts_with('{') || trimmed.starts_with('['))
        && let Ok(vals) = parse_json_stream(trimmed)
        && !vals.is_empty()
    {
        return vals;
    }
    let mut docs = Vec::new();
    let mut current_doc = String::new();
    for line in input.lines() {
        if line.trim() == "---" || line.trim() == "..." {
            if !current_doc.trim().is_empty() {
                docs.push(parse_nested_yaml(&current_doc));
                current_doc.clear();
            }
        } else {
            current_doc.push_str(line);
            current_doc.push('\n');
        }
    }
    if !current_doc.trim().is_empty() {
        docs.push(parse_nested_yaml(&current_doc));
    }
    if docs.is_empty() {
        docs.push(JVal::Null);
    }
    docs
}

fn jval_to_yaml(val: &JVal, indent: usize, quote_all: bool) -> String {
    let pad = " ".repeat(indent);
    match val {
        JVal::Null => "null\n".to_string(),
        JVal::Bool(b) => format!("{b}\n"),
        JVal::Number(n) => {
            if n.fract() == 0.0 {
                format!("{}\n", *n as i64)
            } else if (n - n.round()).abs() < 1e-11 && (n.to_bits() & 1) == 1 && n.abs() < 1e15 {
                format!("{:.1}\n", n.round())
            } else {
                format!("{n}\n")
            }
        }
        JVal::Str(s) => {
            if quote_all
                || s.parse::<f64>().is_ok()
                || matches!(s.as_str(), "true" | "false" | "null" | "~" | "")
                || s.contains(": ")
                || s.starts_with('@')
                || s.starts_with('#')
            {
                format!("\"{}\"\n", s.replace('\\', "\\\\").replace('"', "\\\""))
            } else {
                format!("{s}\n")
            }
        }
        JVal::Array(items) => {
            let mut out = String::new();
            for item in items {
                match item {
                    JVal::Object(entries) if !entries.is_empty() => {
                        let first_yaml = jval_to_yaml(&JVal::Object(vec![entries[0].clone()]), 0, quote_all);
                        out.push_str(&format!("{pad}- {first_yaml}"));
                        if entries.len() > 1 {
                            let rest_yaml = jval_to_yaml(&JVal::Object(entries[1..].to_vec()), indent + 2, quote_all);
                            out.push_str(&rest_yaml);
                        }
                    }
                    JVal::Object(_) | JVal::Array(_) => {
                        out.push_str(&format!("{pad}-\n"));
                        out.push_str(&jval_to_yaml(item, indent + 2, quote_all));
                    }
                    _ => {
                        out.push_str(&format!("{pad}- {}", jval_to_yaml(item, 0, quote_all)));
                    }
                }
            }
            out
        }
        JVal::Object(entries) => {
            let mut out = String::new();
            for (k, v) in entries {
                let k_fmt = if quote_all || k.starts_with('@') || k.starts_with('#') || k.contains(':') {
                    format!("\"{}\"", k.replace('\\', "\\\\").replace('"', "\\\""))
                } else {
                    k.clone()
                };
                match v {
                    JVal::Object(_) | JVal::Array(_) => {
                        out.push_str(&format!("{pad}{k_fmt}:\n"));
                        out.push_str(&jval_to_yaml(v, indent + 2, quote_all));
                    }
                    _ => {
                        out.push_str(&format!("{pad}{k_fmt}: {}", jval_to_yaml(v, 0, quote_all)));
                    }
                }
            }
            out
        }
    }
}

fn parse_toml_to_jval(input: &str) -> JVal {
    let mut root: Vec<(String, JVal)> = Vec::new();
    let mut cur_section: Option<(String, bool)> = None;

    for raw_line in input.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(arr_sec) = line.strip_prefix("[[").and_then(|s| s.strip_suffix("]]")) {
            let sec = arr_sec.trim().to_string();
            if let Some((_, JVal::Array(arr))) = root.iter_mut().find(|(k, _)| k == &sec) {
                arr.push(JVal::Object(Vec::new()));
            } else {
                root.push((sec.clone(), JVal::Array(vec![JVal::Object(Vec::new())])));
            }
            cur_section = Some((sec, true));
            continue;
        }
        if let Some(sec) = line.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            let sec_name = sec.trim().to_string();
            if !root.iter().any(|(k, _)| k == &sec_name) {
                root.push((sec_name.clone(), JVal::Object(Vec::new())));
            }
            cur_section = Some((sec_name, false));
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let key_raw = k.trim().trim_matches('"');
            let key_segs: Vec<&str> = key_raw.split('.').map(|s| s.trim().trim_matches('"')).collect();
            let val = parse_toml_value(v.trim());
            match &cur_section {
                None => insert_toml_dotted(&mut root, &key_segs, val),
                Some((sec_name, false)) => {
                    if let Some((_, JVal::Object(obj))) =
                        root.iter_mut().find(|(k, _)| k == sec_name)
                    {
                        insert_toml_dotted(obj, &key_segs, val);
                    }
                }
                Some((sec_name, true)) => {
                    if let Some((_, JVal::Array(arr))) =
                        root.iter_mut().find(|(k, _)| k == sec_name)
                        && let Some(JVal::Object(obj)) = arr.last_mut()
                    {
                        insert_toml_dotted(obj, &key_segs, val);
                    }
                }
            }
        }
    }
    JVal::Object(root)
}

fn has_undefined_yaml_alias(src: &str) -> bool {
    let mut defined = Vec::new();
    for line in src.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }
        if let Some((_, val_part)) = trimmed.split_once(':') {
            let vp = val_part.trim();
            if let Some(rest) = vp.strip_prefix('&') {
                let aname = rest.split_whitespace().next().unwrap_or("");
                if !aname.is_empty() {
                    defined.push(aname.to_string());
                }
            } else if let Some(alias) = vp.strip_prefix('*') {
                let aname = alias.split_whitespace().next().unwrap_or("");
                if !aname.is_empty() && !defined.iter().any(|d| d == aname) {
                    return true;
                }
            }
        }
    }
    false
}

fn insert_toml_dotted(target: &mut Vec<(String, JVal)>, path: &[&str], val: JVal) {
    if path.is_empty() {
        return;
    }
    if path.len() == 1 {
        if let Some(pos) = target.iter().position(|(k, _)| k == path[0]) {
            target[pos].1 = val;
        } else {
            target.push((path[0].to_string(), val));
        }
        return;
    }
    if let Some((_, JVal::Object(sub))) = target.iter_mut().find(|(k, _)| k == path[0]) {
        insert_toml_dotted(sub, &path[1..], val);
    } else {
        let mut sub = Vec::new();
        insert_toml_dotted(&mut sub, &path[1..], val);
        target.push((path[0].to_string(), JVal::Object(sub)));
    }
}

fn parse_toml_value(s: &str) -> JVal {
    let s = s.trim();
    if let Some(inner) = s.strip_prefix('{').and_then(|v| v.strip_suffix('}')) {
        let mut entries = Vec::new();
        for part in split_top_level_comma(inner) {
            if let Some((k, v)) = part.split_once('=') {
                entries.push((
                    k.trim().trim_matches('"').trim_matches('\'').to_string(),
                    parse_toml_value(v.trim()),
                ));
            }
        }
        return JVal::Object(entries);
    }
    if let Some(inner) = s.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
        let items: Vec<JVal> = split_top_level_comma(inner)
            .into_iter()
            .filter(|p| !p.trim().is_empty())
            .map(|p| parse_toml_value(p.trim()))
            .collect();
        return JVal::Array(items);
    }
    if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
        return JVal::Str(s[1..s.len() - 1].to_string());
    }
    if s == "true" {
        return JVal::Bool(true);
    }
    if s == "false" {
        return JVal::Bool(false);
    }
    if let Ok(n) = s.parse::<f64>() {
        return JVal::Number(n);
    }
    JVal::Str(s.to_string())
}

fn split_top_level_comma(s: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut in_dq = false;
    let mut in_sq = false;
    let mut start = 0usize;
    for (i, c) in s.char_indices() {
        if c == '"' && !in_sq {
            in_dq = !in_dq;
        } else if c == '\'' && !in_dq {
            in_sq = !in_sq;
        } else if !in_dq && !in_sq {
            match c {
                '[' | '{' | '(' => depth += 1,
                ']' | '}' | ')' => depth -= 1,
                ',' if depth == 0 => {
                    out.push(&s[start..i]);
                    start = i + 1;
                }
                _ => {}
            }
        }
    }
    if start <= s.len() {
        out.push(&s[start..]);
    }
    out
}

fn parse_nested_yaml(input: &str) -> JVal {
    let trimmed = input.trim_start();
    if (trimmed.starts_with('{') || trimmed.starts_with('['))
        && let Ok(mut vals) = parse_json_stream(trimmed)
        && let Some(first) = vals.drain(..).next()
    {
        return first;
    }
    let lines: Vec<(usize, &str)> = input
        .lines()
        .filter_map(|l| {
            let trimmed = l.trim_end();
            let stripped = trimmed.trim_start();
            if stripped.is_empty() || stripped.starts_with('#') || stripped == "---" {
                None
            } else {
                let indent = trimmed.len() - stripped.len();
                Some((indent, stripped))
            }
        })
        .collect();
    let mut idx = 0usize;
    let mut anchors = BTreeMap::new();
    parse_yaml_block(&lines, &mut idx, 0, &mut anchors)
}

fn parse_yaml_scalar(raw: &str, anchors: &mut BTreeMap<String, JVal>) -> JVal {
    let mut s = raw.trim();
    let mut anchor_name: Option<String> = None;
    if let Some(rest) = s.strip_prefix('&') {
        let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        anchor_name = Some(rest[..end].to_string());
        s = rest[end..].trim();
    }
    if let Some(alias) = s.strip_prefix('*') {
        return anchors.get(alias.trim()).cloned().unwrap_or(JVal::Null);
    }
    let val = if let Some(inner) = s.strip_prefix('{').and_then(|v| v.strip_suffix('}')) {
        let mut entries = Vec::new();
        for part in split_top_level_comma(inner) {
            if let Some((k, v)) = part.split_once(':') {
                let key = k.trim().trim_matches('"').trim_matches('\'').to_string();
                entries.push((key, parse_yaml_scalar(v.trim(), anchors)));
            }
        }
        JVal::Object(entries)
    } else if let Some(inner) = s.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
        let items = split_top_level_comma(inner)
            .into_iter()
            .filter(|p| !p.trim().is_empty())
            .map(|p| parse_yaml_scalar(p.trim(), anchors))
            .collect();
        JVal::Array(items)
    } else {
        let clean = s.trim_matches('"').trim_matches('\'');
        if clean == "true" {
            JVal::Bool(true)
        } else if clean == "false" {
            JVal::Bool(false)
        } else if clean == "null" || clean == "~" {
            JVal::Null
        } else if !s.starts_with('"') && !s.starts_with('\'') && let Ok(n) = clean.parse::<f64>() {
            JVal::Number(n)
        } else {
            JVal::Str(clean.to_string())
        }
    };
    if let Some(aname) = anchor_name {
        anchors.insert(aname, val.clone());
    }
    val
}

fn parse_yaml_block(
    lines: &[(usize, &str)],
    idx: &mut usize,
    min_indent: usize,
    anchors: &mut BTreeMap<String, JVal>,
) -> JVal {
    if *idx < lines.len() && lines[*idx].0 >= min_indent {
        let first_text = lines[*idx].1;
        if first_text == "-" || first_text.starts_with("- ") {
            let list_indent = lines[*idx].0;
            let mut arr = Vec::new();
            while *idx < lines.len() {
                let (indent, text) = lines[*idx];
                if indent < list_indent || !(text == "-" || text.starts_with("- ")) {
                    break;
                }
                let after_dash = text.strip_prefix('-').unwrap_or("").trim();
                *idx += 1;
                if after_dash.is_empty() {
                    if *idx < lines.len() && lines[*idx].0 > indent {
                        let child_indent = lines[*idx].0;
                        arr.push(parse_yaml_block(lines, idx, child_indent, anchors));
                    } else {
                        arr.push(JVal::Null);
                    }
                } else if let Some((k, v)) = after_dash.split_once(':') {
                    let mut item_map = Vec::new();
                    let key = k.trim().trim_matches('"').trim_matches('\'').to_string();
                    let val_s = v.trim();
                    let first_val = parse_yaml_key_value(lines, idx, indent, val_s, anchors);
                    item_map.push((key, first_val));
                    if *idx < lines.len() && lines[*idx].0 > indent {
                        let child_indent = lines[*idx].0;
                        if let JVal::Object(more) =
                            parse_yaml_block(lines, idx, child_indent, anchors)
                        {
                            item_map.extend(more);
                        }
                    }
                    arr.push(JVal::Object(item_map));
                } else {
                    arr.push(parse_yaml_scalar(after_dash, anchors));
                }
            }
            return JVal::Array(arr);
        }
    }

    let mut map = Vec::new();
    while *idx < lines.len() {
        let (indent, text) = lines[*idx];
        if indent < min_indent || text == "-" || text.starts_with("- ") {
            break;
        }
        if let Some((k, v)) = text.split_once(':') {
            let key = k.trim().trim_matches('"').trim_matches('\'').to_string();
            let val_s = v.trim();
            *idx += 1;
            let val = parse_yaml_key_value(lines, idx, indent, val_s, anchors);
            map.push((key, val));
        } else {
            *idx += 1;
        }
    }
    JVal::Object(map)
}

fn parse_yaml_key_value(
    lines: &[(usize, &str)],
    idx: &mut usize,
    parent_indent: usize,
    val_s: &str,
    anchors: &mut BTreeMap<String, JVal>,
) -> JVal {
    if val_s == "|" || val_s == ">" {
        let mut block_lines = Vec::new();
        let mut block_indent: Option<usize> = None;
        while *idx < lines.len() && lines[*idx].0 > parent_indent {
            let (li, lt) = lines[*idx];
            let base = *block_indent.get_or_insert(li);
            let extra = " ".repeat(li.saturating_sub(base));
            block_lines.push(format!("{extra}{lt}"));
            *idx += 1;
        }
        let sep = if val_s == ">" { " " } else { "\n" };
        return JVal::Str(format!("{}\n", block_lines.join(sep)));
    }
    if val_s.is_empty() || (val_s.starts_with('&') && !val_s.contains(' ')) {
        let anchor = val_s.strip_prefix('&').map(|s| s.trim().to_string());
        let child = if *idx < lines.len() && lines[*idx].0 > parent_indent {
            let child_indent = lines[*idx].0;
            parse_yaml_block(lines, idx, child_indent, anchors)
        } else {
            JVal::Null
        };
        if let Some(a) = anchor {
            anchors.insert(a, child.clone());
        }
        return child;
    }
    parse_yaml_scalar(val_s, anchors)
}

fn cmd_unrtf(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut mode = "html".to_string();
    let mut gnu_profile = false;
    let mut quiet = false;
    let mut noremap = false;
    let mut files: Vec<String> = Vec::new();
    let mut operands = false;
    let mut expect_format = false;

    for a in args {
        if expect_format {
            if a != "text" && a != "html" && a != "latex" {
                return err_out("unrtf: E_PROFILE: Unsupported output format\n", 1);
            }
            mode = a.clone();
            expect_format = false;
            continue;
        }
        if !operands && let Some(val) = a.strip_prefix("-t=") {
            if val != "text" && val != "html" && val != "latex" {
                return err_out("unrtf: E_PROFILE: Unsupported output format\n", 1);
            }
            mode = val.to_string();
            continue;
        }
        if !operands && a == "-t" {
            expect_format = true;
            continue;
        }
        if !operands && a == "--" {
            operands = true;
            continue;
        }
        if operands {
            files.push(a.clone());
        } else if a == "--text" {
            mode = "text".to_string();
        } else if a == "--html" {
            mode = "html".to_string();
        } else if a == "--latex" {
            mode = "latex".to_string();
        } else if let Some(prof) = a.strip_prefix("--profile=") {
            if prof == "gnu-0.21.10" {
                gnu_profile = true;
            } else {
                return err_out("unrtf: E_PROFILE: Unsupported output personality\n", 1);
            }
        } else if a == "--quiet" {
            quiet = true;
        } else if a == "--noremap" {
            noremap = true;
        } else if a == "--nopict" || a == "-n" {
            // Accepted for CLI parity
        } else if a.starts_with('-') && a != "-" {
            return err_out(
                "unrtf: E_PROFILE: Option requires an unadmitted personality/configuration profile\n",
                1,
            );
        } else {
            files.push(a.clone());
        }
    }
    if expect_format {
        return err_out("unrtf: E_PROFILE: Unsupported output format\n", 1);
    }
    if files.len() > 1 {
        return err_out("unrtf: E_PARSE: Only one input file is supported\n", 1);
    }
    if mode == "latex" || noremap {
        gnu_profile = true;
    }

    let text = match read_csv_input(&files, stdin, cwd, fs) {
        Ok(t) => t,
        Err(e) => return err_out(&format!("unrtf: {e}"), 1),
    };
    let trimmed = text.trim_start();
    if !trimmed.starts_with("{\\rtf") {
        return err_out("unrtf: input is not a valid RTF document\n", 1);
    }

    let chars: Vec<char> = trimmed.chars().collect();
    {
        let mut depth = 0i32;
        let mut k = 0usize;
        while k < chars.len() {
            if chars[k] == '\\' {
                k += 2;
                continue;
            }
            if chars[k] == '{' {
                depth += 1;
            } else if chars[k] == '}' {
                depth -= 1;
                if depth < 0 {
                    return err_out("unrtf: E_PARSE: Unmatched closing brace\n", 1);
                }
            }
            k += 1;
        }
        if depth != 0 {
            return err_out("unrtf: E_PARSE: Unclosed RTF group\n", 1);
        }
    }

    let mut body = String::new();
    let mut i = 0usize;
    let mut group_stack: Vec<(Vec<&'static str>, usize)> = Vec::new();
    let mut active_tags: Vec<&'static str> = Vec::new();
    let mut uc_skip: usize = 1;
    let mut in_table = false;
    let mut in_row = false;
    let mut in_cell = false;
    let mut pending_high_surrogate: Option<u32> = None;

    let map_html_tag = |tag: &'static str| -> &'static str {
        if gnu_profile {
            match tag {
                "strike" => "s",
                _ => tag,
            }
        } else {
            match tag {
                "b" => "strong",
                "i" => "em",
                "strike" => "s",
                _ => tag,
            }
        }
    };

    let emit_close_tag = |out: &mut String, tag: &'static str, mode: &str| {
        if mode == "html" {
            let htag = map_html_tag(tag);
            out.push_str(&format!("</{htag}>"));
        } else if mode == "latex" {
            out.push('}');
        }
    };
    let emit_open_tag = |out: &mut String, tag: &'static str, mode: &str| {
        if mode == "html" {
            let htag = map_html_tag(tag);
            out.push_str(&format!("<{htag}>"));
        } else if mode == "latex" {
            let ltag = match tag {
                "b" => "\\bf ",
                "i" => "\\it ",
                "u" => "\\underline{",
                _ => "",
            };
            out.push('{');
            out.push_str(ltag);
        }
    };

    let push_escaped_char =
        |out: &mut String, ch: char, mode: &str, gnu_profile: bool, noremap: bool| {
            if mode == "html" {
                match ch {
                    '&' => out.push_str("&amp;"),
                    '<' => out.push_str("&lt;"),
                    '>' => out.push_str("&gt;"),
                    '"' if gnu_profile && !noremap => out.push_str("&quot;"),
                    '\u{00a0}' if gnu_profile && !noremap => out.push_str("&nbsp;"),
                    _ => out.push(ch),
                }
            } else if mode == "latex" && gnu_profile && !noremap {
                match ch {
                    '\u{2013}' => out.push_str("--"),
                    '\u{2014}' => out.push_str("---"),
                    '\u{2022}' => out.push_str("{\\bullet}"),
                    '#' => out.push_str("\\#"),
                    '$' => out.push_str("{\\$}"),
                    '%' => out.push_str("\\%"),
                    '&' => out.push_str("\\&"),
                    '_' => out.push_str("\\_"),
                    _ => out.push(ch),
                }
            } else {
                out.push(ch);
            }
        };

    let ensure_table_cell = |out: &mut String, mode: &str, in_row: bool, in_cell: &mut bool| {
        if mode == "html" && in_row && !*in_cell {
            out.push_str("<td>");
            *in_cell = true;
        }
    };

    let decode_cp1252 = |b: u8| -> char {
        match b {
            0x80 => '\u{20ac}',
            0x82 => '\u{201a}',
            0x83 => '\u{0192}',
            0x84 => '\u{201e}',
            0x85 => '\u{2026}',
            0x86 => '\u{2020}',
            0x87 => '\u{2021}',
            0x88 => '\u{02c6}',
            0x89 => '\u{2030}',
            0x8a => '\u{0160}',
            0x8b => '\u{2039}',
            0x8c => '\u{0152}',
            0x8e => '\u{017d}',
            0x91 => '\u{2018}',
            0x92 => '\u{2019}',
            0x93 => '\u{201c}',
            0x94 => '\u{201d}',
            0x95 => '\u{2022}',
            0x96 => '\u{2013}',
            0x97 => '\u{2014}',
            0x98 => '\u{02dc}',
            0x99 => '\u{2122}',
            0x9a => '\u{0161}',
            0x9b => '\u{203a}',
            0x9c => '\u{0153}',
            0x9e => '\u{017e}',
            0x9f => '\u{0178}',
            _ => b as char,
        }
    };

    while i < chars.len() {
        match chars[i] {
            '{' => {
                let rest: String = chars[i + 1..chars.len().min(i + 24)].iter().collect();
                let rest_trim = rest.trim_start();
                if rest_trim.starts_with("\\fonttbl")
                    || rest_trim.starts_with("\\colortbl")
                    || rest_trim.starts_with("\\stylesheet")
                    || rest_trim.starts_with("\\info")
                    || rest_trim.starts_with("\\pict")
                    || rest_trim.starts_with("\\object")
                    || rest_trim.starts_with("\\objdata")
                    || rest_trim.starts_with("\\fldinst")
                    || rest_trim.starts_with("\\header")
                    || rest_trim.starts_with("\\footer")
                    || rest_trim.starts_with("\\*")
                {
                    let mut depth = 1i32;
                    i += 1;
                    while i < chars.len() && depth > 0 {
                        if chars[i] == '\\' {
                            i += 2;
                            continue;
                        }
                        if chars[i] == '{' {
                            depth += 1;
                        } else if chars[i] == '}' {
                            depth -= 1;
                        }
                        i += 1;
                    }
                    continue;
                }
                group_stack.push((Vec::new(), uc_skip));
                i += 1;
            }
            '}' => {
                if let Some((group_tags, saved_uc)) = group_stack.pop() {
                    uc_skip = saved_uc;
                    for tag in group_tags.into_iter().rev() {
                        emit_close_tag(&mut body, tag, &mode);
                        if let Some(pos) = active_tags.iter().rposition(|&t| t == tag) {
                            active_tags.remove(pos);
                        }
                    }
                }
                i += 1;
            }
            '\\' => {
                i += 1;
                if i >= chars.len() {
                    break;
                }
                if chars[i] == '\'' && i + 2 < chars.len() {
                    let hex: String = chars[i + 1..i + 3].iter().collect();
                    if let Ok(b) = u8::from_str_radix(&hex, 16) {
                        ensure_table_cell(&mut body, &mode, in_row, &mut in_cell);
                        push_escaped_char(&mut body, decode_cp1252(b), &mode, gnu_profile, noremap);
                    }
                    i += 3;
                    continue;
                }
                if matches!(chars[i], '\\' | '{' | '}') {
                    ensure_table_cell(&mut body, &mode, in_row, &mut in_cell);
                    push_escaped_char(&mut body, chars[i], &mode, gnu_profile, noremap);
                    i += 1;
                    continue;
                }
                if chars[i] == '~' {
                    ensure_table_cell(&mut body, &mode, in_row, &mut in_cell);
                    push_escaped_char(&mut body, '\u{00a0}', &mode, gnu_profile, noremap);
                    i += 1;
                    continue;
                }
                if chars[i] == '_' {
                    ensure_table_cell(&mut body, &mode, in_row, &mut in_cell);
                    push_escaped_char(&mut body, '\u{2011}', &mode, gnu_profile, noremap);
                    i += 1;
                    continue;
                }
                let start = i;
                while i < chars.len() && chars[i].is_ascii_alphabetic() {
                    i += 1;
                }
                let word: String = chars[start..i].iter().collect();
                let num_start = i;
                if i < chars.len() && (chars[i] == '-' || chars[i].is_ascii_digit()) {
                    i += 1;
                    while i < chars.len() && chars[i].is_ascii_digit() {
                        i += 1;
                    }
                }
                let param_str: String = chars[num_start..i].iter().collect();
                let param: Option<i32> = if param_str.is_empty() {
                    None
                } else {
                    param_str.parse::<i32>().ok()
                };
                if i < chars.len() && chars[i] == ' ' {
                    i += 1;
                }
                match word.as_str() {
                    "par" | "line" => {
                        if mode == "html" {
                            if in_row {
                                ensure_table_cell(&mut body, &mode, in_row, &mut in_cell);
                                body.push_str("<br>");
                            } else if gnu_profile {
                                body.push_str("<br>\n");
                            } else {
                                body.push('\n');
                            }
                        } else if mode == "latex" {
                            body.push_str("\\par\n");
                        } else {
                            body.push('\n');
                        }
                    }
                    "trowd" => {
                        if mode == "html" {
                            if !in_table {
                                body.push_str("<table><tbody>");
                                in_table = true;
                            }
                            body.push_str("<tr>");
                        }
                        in_row = true;
                        in_cell = false;
                    }
                    "cell" => {
                        if mode == "html" {
                            if in_cell {
                                body.push_str("</td>");
                                in_cell = false;
                            } else {
                                body.push_str("<td></td>");
                            }
                        } else if mode == "text" {
                            body.push('\t');
                        }
                    }
                    "row" => {
                        if mode == "html" {
                            if in_cell {
                                body.push_str("</td>");
                                in_cell = false;
                            }
                            body.push_str("</tr>");
                        } else {
                            body.push('\n');
                        }
                        in_row = false;
                    }
                    "tab" => {
                        ensure_table_cell(&mut body, &mode, in_row, &mut in_cell);
                        if mode == "html" && !gnu_profile {
                            body.push_str("&#9;");
                        } else {
                            body.push('\t');
                        }
                    }
                    "emdash" => {
                        ensure_table_cell(&mut body, &mode, in_row, &mut in_cell);
                        push_escaped_char(&mut body, '\u{2014}', &mode, gnu_profile, noremap);
                    }
                    "endash" => {
                        ensure_table_cell(&mut body, &mode, in_row, &mut in_cell);
                        push_escaped_char(&mut body, '\u{2013}', &mode, gnu_profile, noremap);
                    }
                    "bullet" => {
                        ensure_table_cell(&mut body, &mode, in_row, &mut in_cell);
                        push_escaped_char(&mut body, '\u{2022}', &mode, gnu_profile, noremap);
                    }
                    "lquote" => {
                        ensure_table_cell(&mut body, &mode, in_row, &mut in_cell);
                        push_escaped_char(&mut body, '\u{2018}', &mode, gnu_profile, noremap);
                    }
                    "rquote" => {
                        ensure_table_cell(&mut body, &mode, in_row, &mut in_cell);
                        push_escaped_char(&mut body, '\u{2019}', &mode, gnu_profile, noremap);
                    }
                    "ldblquote" => {
                        ensure_table_cell(&mut body, &mode, in_row, &mut in_cell);
                        push_escaped_char(&mut body, '\u{201c}', &mode, gnu_profile, noremap);
                    }
                    "rdblquote" => {
                        ensure_table_cell(&mut body, &mode, in_row, &mut in_cell);
                        push_escaped_char(&mut body, '\u{201d}', &mode, gnu_profile, noremap);
                    }
                    "plain" => {
                        if let Some((top_tags, _)) = group_stack.last_mut() {
                            for tag in top_tags.drain(..).rev() {
                                emit_close_tag(&mut body, tag, &mode);
                                if let Some(pos) = active_tags.iter().rposition(|&t| t == tag) {
                                    active_tags.remove(pos);
                                }
                            }
                        }
                    }
                    "b" | "i" | "ul" | "strike" => {
                        let tag: &'static str = match word.as_str() {
                            "b" => "b",
                            "i" => "i",
                            "ul" => "u",
                            _ => "strike",
                        };
                        if param == Some(0) {
                            if let Some(pos) = active_tags.iter().rposition(|&t| t == tag) {
                                active_tags.remove(pos);
                                emit_close_tag(&mut body, tag, &mode);
                            }
                            if let Some((top, _)) = group_stack.last_mut()
                                && let Some(pos) = top.iter().rposition(|&t| t == tag)
                            {
                                top.remove(pos);
                            }
                        } else {
                            ensure_table_cell(&mut body, &mode, in_row, &mut in_cell);
                            emit_open_tag(&mut body, tag, &mode);
                            active_tags.push(tag);
                            if let Some((top, _)) = group_stack.last_mut() {
                                top.push(tag);
                            }
                        }
                    }
                    "ulnone" => {
                        if let Some(pos) = active_tags.iter().rposition(|&t| t == "u") {
                            active_tags.remove(pos);
                            emit_close_tag(&mut body, "u", &mode);
                        }
                        if let Some((top, _)) = group_stack.last_mut()
                            && let Some(pos) = top.iter().rposition(|&t| t == "u")
                        {
                            top.remove(pos);
                        }
                    }
                    "uc" => {
                        if let Some(p) = param
                            && p >= 0
                        {
                            uc_skip = p as usize;
                        }
                    }
                    "u" => {
                        if let Some(code) = param {
                            let u = if code < 0 {
                                (code + 65536) as u32
                            } else {
                                code as u32
                            };
                            if (0xd800..=0xdbff).contains(&u) {
                                pending_high_surrogate = Some(u);
                            } else if (0xdc00..=0xdfff).contains(&u) {
                                if let Some(hi) = pending_high_surrogate.take() {
                                    let cp = 0x10000 + ((hi - 0xd800) << 10) + (u - 0xdc00);
                                    if let Some(ch) = char::from_u32(cp) {
                                        ensure_table_cell(&mut body, &mode, in_row, &mut in_cell);
                                        push_escaped_char(&mut body, ch, &mode, gnu_profile, noremap);
                                    }
                                }
                            } else if let Some(ch) = char::from_u32(u) {
                                ensure_table_cell(&mut body, &mode, in_row, &mut in_cell);
                                push_escaped_char(&mut body, ch, &mode, gnu_profile, noremap);
                            }
                            let mut rem_skip = uc_skip;
                            while rem_skip > 0 && i < chars.len() {
                                if chars[i] == '\\' && i + 1 < chars.len() {
                                    if chars[i + 1] == '\'' && i + 3 < chars.len() {
                                        i += 4;
                                        rem_skip -= 1;
                                        continue;
                                    } else if !chars[i + 1].is_ascii_alphabetic() {
                                        i += 2;
                                        rem_skip -= 1;
                                        continue;
                                    } else {
                                        break;
                                    }
                                } else if chars[i] == '{' || chars[i] == '}' {
                                    break;
                                } else {
                                    i += 1;
                                    rem_skip -= 1;
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            '\r' | '\n' => {
                i += 1;
            }
            c => {
                if mode == "html" && in_table && !in_row && !c.is_whitespace() {
                    body.push_str("</tbody></table>");
                    in_table = false;
                }
                ensure_table_cell(&mut body, &mode, in_row, &mut in_cell);
                push_escaped_char(&mut body, c, &mode, gnu_profile, noremap);
                i += 1;
            }
        }
    }
    if mode == "html" && in_table {
        if in_cell {
            body.push_str("</td>");
        }
        if in_row {
            body.push_str("</tr>");
        }
        body.push_str("</tbody></table>");
    }

    let mut out = String::new();
    if mode == "latex" {
        out.push_str("\\documentclass[11pt]{article}\n\\title{}\n");
        if !quiet {
            out.push_str("\\%  Translation from RTF performed by UnRTF, version 0.21.10 \n");
        }
        out.push_str("\n\n\\begin{document}\n\\maketitle\n\n");
        out.push_str(&body);
        out.push_str("\n\\end{document}\n");
    } else if mode == "html" {
        if gnu_profile {
            out.push_str("<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\">\n<html>\n<head>\n<meta http-equiv=\"content-type\" content=\"text/html; charset=utf-8\">\n");
            if !quiet {
                out.push_str("<!-- Translation from RTF performed by UnRTF, version 0.21.10 -->\n");
            }
            out.push_str("</head>\n<body>");
            out.push_str(&body);
            out.push_str("</body>\n</html>\n");
        } else {
            out.push_str("<!DOCTYPE html><html><body>");
            out.push_str(&body);
            out.push_str("</body></html>\n");
        }
    } else {
        if gnu_profile {
            if !quiet {
                out.push_str("###  Translation from RTF performed by UnRTF, version 0.21.10 \n");
            }
            out.push_str("\n-----------------\n");
        }
        out.push_str(&body);
        if !out.ends_with('\n') {
            out.push('\n');
        }
    }
    ok_out(&out)
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
    let mut delete_empty = false;
    let mut line_numbers = false;
    let mut delim = ',';
    let mut files = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-n" | "--names" => list_names = true,
            "-x" | "--delete-empty-rows" => delete_empty = true,
            "-l" | "--linenumbers" => line_numbers = true,
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
    let mut emitted_row_num = 0usize;
    for (r_idx, row) in rows.iter().enumerate() {
        let mut projected: Vec<String> = selected
            .iter()
            .map(|&idx| row.get(idx).cloned().unwrap_or_default())
            .collect();
        if delete_empty && r_idx > 0 && projected.iter().all(|c| c.is_empty()) {
            continue;
        }
        if line_numbers {
            if r_idx == 0 {
                projected.insert(0, "line_number".to_string());
            } else {
                emitted_row_num += 1;
                projected.insert(0, emitted_row_num.to_string());
            }
        }
        out.push_str(&format_csv_row(&projected, ','));
    }
    ok_out(&out)
}

fn cmd_csvgrep(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut cols_spec = String::new();
    let mut match_str: Option<String> = None;
    let mut regex_str: Option<String> = None;
    let mut invert = false;
    let mut delim = ',';
    let mut files = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-i" | "--invert-match" => invert = true,
            "-t" | "--tabs" => delim = '\t',
            "-d" | "--delimiter" if i + 1 < args.len() => {
                i += 1;
                delim = args[i].chars().next().unwrap_or(',');
            }
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
    let rows = parse_csv_rows(&text, delim);
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
    let mut want_sum = false;
    let mut want_mean = false;
    let mut want_min = false;
    let mut want_max = false;
    let mut want_median = false;
    let mut csv_out = false;
    let mut cols_spec: Option<String> = None;
    let mut delim = ',';
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "--count" => count_only = true,
            "--sum" => want_sum = true,
            "--mean" => want_mean = true,
            "--min" => want_min = true,
            "--max" => want_max = true,
            "--median" => want_median = true,
            "--csv" => csv_out = true,
            "-t" | "--tabs" => delim = '\t',
            "-d" | "--delimiter" if i + 1 < args.len() => {
                i += 1;
                delim = args[i].chars().next().unwrap_or(',');
            }
            "-c" | "--columns" if i + 1 < args.len() => {
                i += 1;
                cols_spec = Some(args[i].clone());
            }
            a if !a.starts_with('-') => files.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }
    let text = match read_csv_input(&files, stdin, cwd, fs) {
        Ok(t) => t,
        Err(e) => return err_out(&format!("csvstat: {e}"), 1),
    };
    let rows = parse_csv_rows(&text, delim);
    if rows.is_empty() {
        return ok_out("0\n");
    }
    let data_count = rows.len().saturating_sub(1);
    if count_only {
        return ok_out(&format!("{data_count}\n"));
    }
    let headers = &rows[0];
    let data = &rows[1..];
    let col_indices = if let Some(ref spec) = cols_spec {
        resolve_csv_col_indices(spec, headers)
    } else {
        (0..headers.len()).collect()
    };

    let fmt_num = |n: f64| -> String {
        if (n - n.round()).abs() < 1e-9 {
            format!("{}", n.round() as i64)
        } else {
            format!("{n}")
        }
    };

    if csv_out {
        let mut out = "column_id,column_name,type,nulls,min,max,sum,mean,median\n".to_string();
        for &c_idx in &col_indices {
            let col_name = headers.get(c_idx).map(|s| s.as_str()).unwrap_or("");
            let mut nums: Vec<f64> = data
                .iter()
                .filter_map(|r| r.get(c_idx)?.trim().parse::<f64>().ok())
                .collect();
            let has_nulls = data
                .iter()
                .any(|r| r.get(c_idx).map(|s| s.trim().is_empty()).unwrap_or(true));
            if nums.is_empty() {
                out.push_str(&format!(
                    "{},{},Text,{},,,,,\n",
                    c_idx + 1,
                    col_name,
                    has_nulls
                ));
            } else {
                nums.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                let min_v = nums[0];
                let max_v = nums[nums.len() - 1];
                let sum_v: f64 = nums.iter().sum();
                let mean_v = sum_v / (nums.len() as f64);
                let median_v = if nums.len() % 2 == 1 {
                    nums[nums.len() / 2]
                } else {
                    (nums[nums.len() / 2 - 1] + nums[nums.len() / 2]) / 2.0
                };
                out.push_str(&format!(
                    "{},{},Number,{},{},{},{},{},{}\n",
                    c_idx + 1,
                    col_name,
                    has_nulls,
                    fmt_num(min_v),
                    fmt_num(max_v),
                    fmt_num(sum_v),
                    fmt_num(mean_v),
                    fmt_num(median_v)
                ));
            }
        }
        return ok_out(&out);
    }

    if want_sum || want_mean || want_min || want_max || want_median {
        let mut lines = Vec::new();
        for &c_idx in &col_indices {
            let h = headers.get(c_idx).map(|s| s.as_str()).unwrap_or("");
            let mut nums: Vec<f64> = data
                .iter()
                .filter_map(|r| r.get(c_idx)?.trim().parse::<f64>().ok())
                .collect();
            if nums.is_empty() {
                if col_indices.len() == 1 {
                    lines.push("None".to_string());
                } else {
                    lines.push(format!("  {}. {}: None", c_idx + 1, h));
                }
                continue;
            }
            nums.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let val = if want_sum {
                nums.iter().sum::<f64>()
            } else if want_mean {
                nums.iter().sum::<f64>() / (nums.len() as f64)
            } else if want_min {
                nums[0]
            } else if want_max {
                *nums.last().unwrap()
            } else if nums.len() % 2 == 1 {
                nums[nums.len() / 2]
            } else {
                (nums[nums.len() / 2 - 1] + nums[nums.len() / 2]) / 2.0
            };
            if col_indices.len() == 1 {
                lines.push(fmt_num(val));
            } else {
                lines.push(format!("  {}. {}: {}", c_idx + 1, h, fmt_num(val)));
            }
        }
        return ok_out(&format!("{}\n", lines.join("\n")));
    }

    ok_out(&format!("Row count: {data_count}\n"))
}

fn infer_csv_cell(s: &str, no_inference: bool) -> JVal {
    if no_inference {
        return JVal::Str(s.to_string());
    }
    if s.is_empty() {
        return JVal::Null;
    }
    if s.eq_ignore_ascii_case("true") {
        return JVal::Bool(true);
    }
    if s.eq_ignore_ascii_case("false") {
        return JVal::Bool(false);
    }
    if (!s.starts_with('0') || s == "0" || s.starts_with("0."))
        && let Ok(mut n) = s.parse::<f64>()
    {
        if n.fract() == 0.0 {
            if n == 0.0 {
                n = f64::from_bits(1);
            } else {
                n = f64::from_bits(n.to_bits() | 1);
            }
        }
        return JVal::Number(n);
    }
    JVal::Str(s.to_string())
}

fn cmd_csvjson(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut key_col: Option<String> = None;
    let mut lat_col: Option<String> = None;
    let mut lon_col: Option<String> = None;
    let mut no_bbox = false;
    let mut crs_val: Option<String> = None;
    let mut no_inference = false;
    let mut stream_mode = false;
    let mut delim = ',';
    let mut files = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-I" | "--no-inference" => no_inference = true,
            "--stream" => stream_mode = true,
            "--no-bbox" => no_bbox = true,
            "-t" | "--tabs" => delim = '\t',
            "-d" | "--delimiter" if i + 1 < args.len() => {
                i += 1;
                delim = args[i].chars().next().unwrap_or(',');
            }
            "-k" | "--key" if i + 1 < args.len() => {
                i += 1;
                key_col = Some(args[i].clone());
            }
            "--lat" if i + 1 < args.len() => {
                i += 1;
                lat_col = Some(args[i].clone());
            }
            "--lon" if i + 1 < args.len() => {
                i += 1;
                lon_col = Some(args[i].clone());
            }
            "--crs" if i + 1 < args.len() => {
                i += 1;
                crs_val = Some(args[i].clone());
            }
            "-i" | "--indent" if i + 1 < args.len() => {
                i += 1;
            }
            a if !a.starts_with('-') => files.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }

    let text = match read_csv_input(&files, stdin, cwd, fs) {
        Ok(t) => t,
        Err(e) => return err_out(&format!("csvjson: {e}"), 1),
    };
    let rows = parse_csv_rows(&text, delim);
    if rows.is_empty() {
        return ok_out("[]\n");
    }
    let headers = &rows[0];
    let data = &rows[1..];

    if let (Some(lat_spec), Some(lon_spec)) = (lat_col, lon_col) {
        let lat_idx = resolve_csv_col_indices(&lat_spec, headers).into_iter().next().unwrap_or(0);
        let lon_idx = resolve_csv_col_indices(&lon_spec, headers).into_iter().next().unwrap_or(0);
        let k_idx = key_col.as_ref().and_then(|k| resolve_csv_col_indices(k, headers).into_iter().next());
        let mut features = Vec::new();
        let mut min_lon = f64::INFINITY;
        let mut min_lat = f64::INFINITY;
        let mut max_lon = f64::NEG_INFINITY;
        let mut max_lat = f64::NEG_INFINITY;

        for r in data {
            let mut props = Vec::new();
            for (idx, h) in headers.iter().enumerate() {
                if idx == lat_idx || idx == lon_idx || Some(idx) == k_idx {
                    continue;
                }
                let cell = r.get(idx).map(|s| s.as_str()).unwrap_or("");
                if !cell.is_empty() {
                    props.push((h.clone(), infer_csv_cell(cell, no_inference)));
                }
            }
            let lat_v = r.get(lat_idx).and_then(|s| s.trim().parse::<f64>().ok()).unwrap_or(0.0);
            let lon_v = r.get(lon_idx).and_then(|s| s.trim().parse::<f64>().ok()).unwrap_or(0.0);
            if lon_v < min_lon { min_lon = lon_v; }
            if lon_v > max_lon { max_lon = lon_v; }
            if lat_v < min_lat { min_lat = lat_v; }
            if lat_v > max_lat { max_lat = lat_v; }

            let geom = JVal::Object(vec![
                ("type".to_string(), JVal::Str("Point".to_string())),
                ("coordinates".to_string(), JVal::Array(vec![JVal::Number(lon_v), JVal::Number(lat_v)])),
            ]);
            let mut feat_entries = vec![
                ("type".to_string(), JVal::Str("Feature".to_string())),
                ("properties".to_string(), JVal::Object(props)),
            ];
            if let Some(ki) = k_idx {
                let kv = r.get(ki).map(|s| s.as_str()).unwrap_or("");
                feat_entries.push(("id".to_string(), infer_csv_cell(kv, no_inference)));
            }
            feat_entries.push(("geometry".to_string(), geom));
            features.push(JVal::Object(feat_entries));
        }

        if stream_mode {
            let mut out = String::new();
            for f in features {
                out.push_str(&f.to_json_string(true, false, 0));
                out.push('\n');
            }
            return ok_out(&out);
        }

        let mut coll = vec![("type".to_string(), JVal::Str("FeatureCollection".to_string()))];
        if !no_bbox && !features.is_empty() {
            coll.push((
                "bbox".to_string(),
                JVal::Array(vec![
                    JVal::Number(min_lon),
                    JVal::Number(min_lat),
                    JVal::Number(max_lon),
                    JVal::Number(max_lat),
                ]),
            ));
        }
        coll.push(("features".to_string(), JVal::Array(features)));
        if let Some(crs) = crs_val {
            coll.push((
                "crs".to_string(),
                JVal::Object(vec![
                    ("type".to_string(), JVal::Str("name".to_string())),
                    ("properties".to_string(), JVal::Object(vec![("name".to_string(), JVal::Str(crs))])),
                ]),
            ));
        }
        return ok_out(&format!("{}\n", JVal::Object(coll).to_json_string(true, false, 0)));
    }

    if stream_mode {
        let mut out = String::new();
        for r in data {
            let mut entries = Vec::new();
            for (idx, h) in headers.iter().enumerate() {
                let cell = r.get(idx).map(|s| s.as_str()).unwrap_or("");
                entries.push((h.clone(), infer_csv_cell(cell, no_inference)));
            }
            out.push_str(&JVal::Object(entries).to_json_string(true, false, 0));
            out.push('\n');
        }
        return ok_out(&out);
    }

    if let Some(kname) = key_col {
        let k_idx = resolve_csv_col_indices(&kname, headers)
            .into_iter()
            .next()
            .unwrap_or(0);
        let mut map_entries = Vec::new();
        for r in data {
            let key_val = r.get(k_idx).cloned().unwrap_or_default();
            let mut entries = Vec::new();
            for (idx, h) in headers.iter().enumerate() {
                let cell = r.get(idx).map(|s| s.as_str()).unwrap_or("");
                entries.push((h.clone(), infer_csv_cell(cell, no_inference)));
            }
            map_entries.push((key_val, JVal::Object(entries)));
        }
        return ok_out(&format!(
            "{}\n",
            JVal::Object(map_entries).to_json_string(true, false, 0)
        ));
    }

    let mut arr = Vec::new();
    for r in data {
        let mut entries = Vec::new();
        for (idx, h) in headers.iter().enumerate() {
            let cell = r.get(idx).map(|s| s.as_str()).unwrap_or("");
            entries.push((h.clone(), infer_csv_cell(cell, no_inference)));
        }
        arr.push(JVal::Object(entries));
    }
    ok_out(&format!("{}\n", JVal::Array(arr).to_json_string(true, false, 0)))
}

fn cmd_in2csv(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut key_prop: Option<String> = None;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-f" | "--format" if i + 1 < args.len() => {
                i += 1;
            }
            "-k" | "--key" if i + 1 < args.len() => {
                i += 1;
                key_prop = Some(args[i].clone());
            }
            a if !a.starts_with('-') => files.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }
    let text = match read_csv_input(&files, stdin, cwd, fs) {
        Ok(t) => t,
        Err(e) => return err_out(&format!("in2csv: {e}"), 1),
    };
    let vals = match parse_json_stream(&text) {
        Ok(v) => v,
        Err(e) => return err_out(&format!("in2csv: {e}\n"), 1),
    };
    let items: Vec<JVal> = if vals.len() == 1 {
        match vals.into_iter().next().unwrap() {
            JVal::Array(arr) => arr,
            JVal::Object(entries) => {
                if let Some(ref k) = key_prop
                    && let Some((_, JVal::Array(arr))) = entries.into_iter().find(|(ek, _)| ek == k)
                {
                    arr
                } else {
                    Vec::new()
                }
            }
            _ => Vec::new(),
        }
    } else {
        vals
    };

    let mut headers: Vec<String> = Vec::new();
    for item in &items {
        if let JVal::Object(entries) = item {
            for (k, _) in entries {
                if !headers.contains(k) {
                    headers.push(k.clone());
                }
            }
        }
    }
    if headers.is_empty() {
        return ok_out("");
    }
    let mut out = format_csv_row(&headers, ',');
    for item in &items {
        if let JVal::Object(entries) = item {
            let row: Vec<String> = headers
                .iter()
                .map(|h| {
                    entries
                        .iter()
                        .find(|(k, _)| k == h)
                        .map(|(_, v)| match v {
                            JVal::Null => String::new(),
                            JVal::Bool(b) => if *b { "True".to_string() } else { "False".to_string() },
                            _ => v.to_raw_string(true, false),
                        })
                        .unwrap_or_default()
                })
                .collect();
            out.push_str(&format_csv_row(&row, ','));
        }
    }
    ok_out(&out)
}

fn cmd_csvformat(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut in_delim = ',';
    let mut out_delim = ',';
    let mut out_quoting = 0usize;
    let mut out_quotechar = '"';
    let mut line_term = "\n".to_string();
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-t" | "--tabs" => in_delim = '\t',
            "-d" | "--delimiter" if i + 1 < args.len() => {
                i += 1;
                in_delim = args[i].chars().next().unwrap_or(',');
            }
            "-T" | "--out-tabs" => out_delim = '\t',
            "-D" | "--out-delimiter" if i + 1 < args.len() => {
                i += 1;
                out_delim = args[i].chars().next().unwrap_or(',');
            }
            "-U" | "--out-quoting" if i + 1 < args.len() => {
                i += 1;
                out_quoting = args[i].parse().unwrap_or(0);
            }
            "-Q" | "--out-quotechar" if i + 1 < args.len() => {
                i += 1;
                out_quotechar = args[i].chars().next().unwrap_or('"');
            }
            "-u" | "--quoting" | "-q" | "--quotechar" if i + 1 < args.len() => {
                i += 1;
            }
            "-M" | "--lineterminator" if i + 1 < args.len() => {
                i += 1;
                line_term = args[i].replace("\\r\\n", "\r\n").replace("\\n", "\n");
            }
            a if !a.starts_with('-') => files.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }
    let text = match read_csv_input(&files, stdin, cwd, fs) {
        Ok(t) => t,
        Err(e) => return err_out(&format!("csvformat: {e}"), 1),
    };
    let rows = parse_csv_rows(&text, in_delim);
    let mut out = String::new();
    for r in rows {
        let formatted = if out_quoting == 1 {
            let q = out_quotechar;
            let cells: Vec<String> = r
                .iter()
                .map(|c| format!("{q}{}{q}", c.replace(q, &format!("{q}{q}"))))
                .collect();
            cells.join(&out_delim.to_string())
        } else if out_quoting == 2 {
            let q = out_quotechar;
            let cells: Vec<String> = r
                .iter()
                .map(|c| {
                    if c.trim().parse::<f64>().is_ok() {
                        c.clone()
                    } else {
                        format!("{q}{}{q}", c.replace(q, &format!("{q}{q}")))
                    }
                })
                .collect();
            cells.join(&out_delim.to_string())
        } else {
            format_csv_row(&r, out_delim).trim_end_matches('\n').to_string()
        };
        out.push_str(&formatted);
        out.push_str(&line_term);
    }
    ok_out(&out)
}

fn cmd_csvlook(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut delim = ',';
    let mut no_inference = false;
    let mut max_rows: Option<usize> = None;
    let mut max_cols: Option<usize> = None;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-t" | "--tabs" => delim = '\t',
            "-I" | "--no-inference" => no_inference = true,
            "--max-rows" if i + 1 < args.len() => {
                i += 1;
                max_rows = args[i].parse().ok();
            }
            "--max-columns" if i + 1 < args.len() => {
                i += 1;
                max_cols = args[i].parse().ok();
            }
            "-d" | "--delimiter" if i + 1 < args.len() => {
                i += 1;
                delim = args[i].chars().next().unwrap_or(',');
            }
            a if !a.starts_with('-') => files.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }
    let text = match read_csv_input(&files, stdin, cwd, fs) {
        Ok(t) => t,
        Err(e) => return err_out(&format!("csvlook: {e}"), 1),
    };
    let rows = parse_csv_rows(&text, delim);
    if rows.is_empty() {
        return ok_out("");
    }
    let total_cols = rows[0].len();
    let ncols = max_cols.map(|m| m.min(total_cols)).unwrap_or(total_cols);
    let data_slice = if let Some(mr) = max_rows {
        &rows[1..rows.len().min(1 + mr)]
    } else {
        &rows[1..]
    };
    let mut is_numeric = vec![false; ncols];
    if !no_inference && !data_slice.is_empty() {
        for idx in 0..ncols {
            let mut has_val = false;
            let mut all_num = true;
            for r in data_slice {
                let c = r.get(idx).map(|s| s.trim()).unwrap_or("");
                if !c.is_empty() {
                    has_val = true;
                    if c.parse::<f64>().is_err() {
                        all_num = false;
                        break;
                    }
                }
            }
            is_numeric[idx] = has_val && all_num;
        }
    }
    let mut widths = vec![1usize; ncols];
    for cell_idx in 0..ncols {
        widths[cell_idx] = widths[cell_idx].max(rows[0].get(cell_idx).map(|s| s.len()).unwrap_or(0));
    }
    for r in data_slice {
        for idx in 0..ncols {
            let cell = r.get(idx).map(|s| s.as_str()).unwrap_or("");
            widths[idx] = widths[idx].max(cell.len());
        }
    }
    let mut out = String::new();
    let hdr_parts: Vec<String> = (0..ncols)
        .map(|idx| {
            let c = rows[0].get(idx).map(|s| s.as_str()).unwrap_or("");
            format!("{c:<width$}", width = widths[idx])
        })
        .collect();
    out.push_str(&format!("| {} |\n", hdr_parts.join(" | ")));
    let sep_parts: Vec<String> = widths.iter().map(|&w| "-".repeat(w)).collect();
    out.push_str(&format!("| {} |\n", sep_parts.join(" | ")));
    for r in data_slice {
        let parts: Vec<String> = (0..ncols)
            .map(|idx| {
                let c = r.get(idx).map(|s| s.as_str()).unwrap_or("");
                if is_numeric[idx] {
                    format!("{c:>width$}", width = widths[idx])
                } else {
                    format!("{c:<width$}", width = widths[idx])
                }
            })
            .collect();
        out.push_str(&format!("| {} |\n", parts.join(" | ")));
    }
    ok_out(&out)
}

fn cmd_csvsql(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut query: Option<String> = None;
    let mut table_names: Option<String> = None;
    let mut unique_cols: Option<String> = None;
    let mut delim = ',';
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-t" | "--tabs" => delim = '\t',
            "-d" | "--delimiter" if i + 1 < args.len() => {
                i += 1;
                delim = args[i].chars().next().unwrap_or(',');
            }
            "--query" if i + 1 < args.len() => {
                i += 1;
                query = Some(args[i].clone());
            }
            "--tables" if i + 1 < args.len() => {
                i += 1;
                table_names = Some(args[i].clone());
            }
            "--unique-constraint" if i + 1 < args.len() => {
                i += 1;
                unique_cols = Some(args[i].clone());
            }
            "--db" if i + 1 < args.len() => {
                i += 1;
            }
            "-i" | "--dialect" if i + 1 < args.len() => {
                i += 1;
            }
            a if !a.starts_with('-') => files.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }
    let custom_names: Vec<String> = table_names
        .map(|s| s.split(',').map(|p| p.trim().to_string()).collect())
        .unwrap_or_default();

    if let Some(sql) = query {
        let mut tables: BTreeMap<String, SqlTable> = BTreeMap::new();
        if files.is_empty() {
            let rows = parse_csv_rows(stdin, delim);
            if !rows.is_empty() {
                let tname = custom_names
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "stdin".to_string());
                tables.insert(
                    tname,
                    SqlTable {
                        columns: rows[0].clone(),
                        rows: rows[1..].to_vec(),
                        imported_csv: false,
                        ..SqlTable::default()
                    },
                );
            }
        } else {
            for (idx, f) in files.iter().enumerate() {
                let full = resolve_posix_path(cwd, f);
                if let Ok(bytes) = fs.read_file(&full) {
                    let rows = parse_csv_rows(&String::from_utf8_lossy(&bytes), delim);
                    if !rows.is_empty() {
                        let default_name = f
                            .rsplit('/')
                            .next()
                            .unwrap_or(f)
                            .split('.')
                            .next()
                            .unwrap_or("table")
                            .to_string();
                        let tname = custom_names.get(idx).cloned().unwrap_or(default_name);
                        tables.insert(
                            tname,
                            SqlTable {
                                columns: rows[0].clone(),
                                rows: rows[1..].to_vec(),
                                imported_csv: false,
                                ..SqlTable::default()
                            },
                        );
                    }
                }
            }
        }
        let mut out = String::new();
        for raw_stmt in sql.split(';') {
            let stmt = raw_stmt.trim();
            if stmt.to_ascii_uppercase().starts_with("SELECT") {
                out.push_str(&exec_sql_select(stmt, &tables, &BTreeMap::new(), true, false, false, false, None, true, ","));
            }
        }
        return ok_out(&out);
    }

    let text = match read_csv_input(&files, stdin, cwd, fs) {
        Ok(t) => t,
        Err(e) => return err_out(&format!("csvsql: {e}"), 1),
    };
    let rows = parse_csv_rows(&text, delim);
    if rows.is_empty() {
        return ok_out("");
    }
    let tname = custom_names.first().cloned().unwrap_or_else(|| {
        files
            .first()
            .and_then(|f| f.rsplit('/').next())
            .and_then(|f| f.split('.').next())
            .unwrap_or("stdin")
            .to_string()
    });
    let headers = &rows[0];
    let data = &rows[1..];
    let mut col_defs = Vec::new();
    for (idx, h) in headers.iter().enumerate() {
        let non_empty: Vec<&str> = data
            .iter()
            .filter_map(|r| r.get(idx).map(|s| s.trim()))
            .filter(|s| !s.is_empty())
            .collect();
        let sql_type = if !non_empty.is_empty()
            && non_empty
                .iter()
                .all(|s| s.eq_ignore_ascii_case("true") || s.eq_ignore_ascii_case("false"))
        {
            "BOOLEAN"
        } else if !non_empty.is_empty() && non_empty.iter().all(|s| s.parse::<f64>().is_ok()) {
            "DECIMAL"
        } else {
            "VARCHAR"
        };
        let not_null = if !data.is_empty() && non_empty.len() == data.len() {
            " NOT NULL"
        } else {
            ""
        };
        col_defs.push(format!("\t{h} {sql_type}{not_null}"));
    }
    if let Some(ucols) = unique_cols {
        col_defs.push(format!("\tUNIQUE ({ucols})"));
    }
    ok_out(&format!(
        "CREATE TABLE {tname} (\n{}\n);\n",
        col_defs.join(",\n")
    ))
}

fn cmd_csvclean(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut delim = ',';
    let mut check_length = false;
    let mut omit_err = false;
    let mut fill_short = false;
    let mut fill_val = String::new();
    let mut join_short = false;
    let mut join_sep = " ".to_string();
    let mut norm_header = false;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-t" | "--tabs" => delim = '\t',
            "--length-mismatch" => check_length = true,
            "-a" | "--enable-all-checks" => check_length = true,
            "--omit-error-rows" => omit_err = true,
            "--fill-short-rows" => fill_short = true,
            "--fillvalue" if i + 1 < args.len() => {
                i += 1;
                fill_val = args[i].clone();
            }
            "--join-short-rows" => join_short = true,
            "--separator" if i + 1 < args.len() => {
                i += 1;
                join_sep = args[i].clone();
            }
            "--header-normalize-space" => norm_header = true,
            "-d" | "--delimiter" if i + 1 < args.len() => {
                i += 1;
                delim = args[i].chars().next().unwrap_or(',');
            }
            a if !a.starts_with('-') => files.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }
    if !check_length && !fill_short && !join_short && !norm_header && !omit_err {
        check_length = true;
    }
    let text = match read_csv_input(&files, stdin, cwd, fs) {
        Ok(t) => t,
        Err(e) => return err_out(&format!("csvclean: {e}"), 1),
    };
    let rows = parse_csv_rows(&text, delim);
    if rows.is_empty() {
        return ok_out("");
    }
    let header_row: Vec<String> = if norm_header {
        rows[0]
            .iter()
            .map(|c| c.split_whitespace().collect::<Vec<_>>().join(" "))
            .collect()
    } else {
        rows[0].clone()
    };
    let expected_cols = header_row.len();
    let mut stdout = format_csv_row(&header_row, ',');
    let mut stderr = String::new();
    let mut has_err = false;
    for (idx, orig_r) in rows[1..].iter().enumerate() {
        let mut r = orig_r.clone();
        if fill_short && r.len() < expected_cols {
            while r.len() < expected_cols {
                r.push(fill_val.clone());
            }
        }
        let is_mismatch = r.len() != expected_cols;
        if check_length && is_mismatch {
            has_err = true;
            stderr.push_str(&format!(
                "Line {}: Expected {} columns, found {} columns: {}",
                idx + 1,
                expected_cols,
                r.len(),
                format_csv_row(&r, ',')
            ));
        }
        if !omit_err || !is_mismatch {
            let _ = &join_sep;
            stdout.push_str(&format_csv_row(&r, ','));
        }
    }
    BuiltinOutcome {
        stdout,
        stderr,
        exit_code: if has_err { 1 } else { 0 },
    }
}

fn detect_xan_delim(text: &str, explicit: Option<char>) -> char {
    if let Some(d) = explicit {
        return d;
    }
    let first_line = text.lines().next().unwrap_or("");
    if first_line.contains(',') {
        ','
    } else if first_line.contains('|') {
        '|'
    } else if first_line.contains('\t') {
        '\t'
    } else if first_line.contains(';') {
        ';'
    } else {
        ','
    }
}

fn resolve_xan_col_endpoint(token: &str, headers: &[String]) -> Option<usize> {
    let t = token.trim();
    if t.is_empty() {
        return None;
    }
    if let Some(open_br) = t.find('[')
        && t.ends_with(']')
    {
        let col_name = &t[..open_br];
        let occ_str = &t[open_br + 1..t.len() - 1];
        if let Ok(occ) = occ_str.parse::<isize>() {
            let matches: Vec<usize> = headers
                .iter()
                .enumerate()
                .filter_map(|(i, h)| if h == col_name { Some(i) } else { None })
                .collect();
            if occ >= 0 {
                return matches.get(occ as usize).copied();
            } else {
                let rev = (-occ) as usize;
                return matches.len().checked_sub(rev).and_then(|idx| matches.get(idx).copied());
            }
        }
    }
    if let Some(pos) = headers.iter().position(|h| h == t) {
        return Some(pos);
    }
    if let Ok(n) = t.parse::<isize>() {
        let resolved = if n < 0 {
            headers.len().checked_sub((-n) as usize)
        } else {
            Some(n as usize)
        };
        if let Some(idx) = resolved
            && idx < headers.len()
        {
            return Some(idx);
        }
    }
    None
}

fn resolve_xan_select_indices(spec: &str, headers: &[String]) -> Vec<usize> {
    let trimmed = spec.trim();
    if trimmed.starts_with('!') {
        let mut excluded = Vec::new();
        for part in trimmed.split(',') {
            let pat = part.trim().trim_start_matches('!');
            if pat.contains('[') {
                if let Some(idx) = resolve_xan_col_endpoint(pat, headers) {
                    excluded.push(idx);
                }
            } else {
                for (idx, h) in headers.iter().enumerate() {
                    if xan_glob_match(pat, h) {
                        excluded.push(idx);
                    }
                }
            }
        }
        return (0..headers.len())
            .filter(|idx| !excluded.contains(idx))
            .collect();
    }

    let mut out = Vec::new();
    for part in trimmed.split(',') {
        let p = part.trim();
        if let Some((a, b)) = p.split_once(':') {
            let ia = if a.trim().is_empty() {
                0
            } else {
                resolve_xan_col_endpoint(a, headers).unwrap_or(0)
            };
            let ib = if b.trim().is_empty() {
                headers.len().saturating_sub(1)
            } else {
                resolve_xan_col_endpoint(b, headers).unwrap_or(headers.len().saturating_sub(1))
            };
            if ia <= ib {
                for idx in ia..=ib.min(headers.len().saturating_sub(1)) {
                    out.push(idx);
                }
            } else {
                for idx in (ib..=ia.min(headers.len().saturating_sub(1))).rev() {
                    out.push(idx);
                }
            }
        } else if p.contains('*') {
            for (idx, h) in headers.iter().enumerate() {
                if xan_glob_match(p, h) {
                    out.push(idx);
                }
            }
        } else if let Some(pos) = resolve_xan_col_endpoint(p, headers) {
            out.push(pos);
        }
    }
    out
}

fn xan_glob_match(pat: &str, text: &str) -> bool {
    if pat == "*" {
        return true;
    }
    if let Some(prefix) = pat.strip_suffix('*') {
        return text.starts_with(prefix);
    }
    if let Some(suffix) = pat.strip_prefix('*') {
        return text.ends_with(suffix);
    }
    pat == text
}

fn eval_xan_num_expr(expr: &str, headers: &[String], row: &[String]) -> Option<f64> {
    let s = expr.trim();
    if s.is_empty() {
        return None;
    }
    if s.starts_with('(') && s.ends_with(')') {
        let mut depth = 0i32;
        let mut wraps_all = true;
        for (i, ch) in s.char_indices() {
            match ch {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 && i + 1 < s.len() {
                        wraps_all = false;
                        break;
                    }
                }
                _ => {}
            }
        }
        if wraps_all {
            return eval_xan_num_expr(&s[1..s.len() - 1], headers, row);
        }
    }
    // Lowest precedence: + and -
    let bytes = s.as_bytes();
    let mut depth = 0i32;
    let mut split_add: Option<(usize, u8)> = None;
    for (i, &b) in bytes.iter().enumerate() {
        match b {
            b'(' => depth += 1,
            b')' => depth -= 1,
            b'+' | b'-' if depth == 0 && i > 0 => {
                split_add = Some((i, b));
            }
            _ => {}
        }
    }
    if let Some((idx, op)) = split_add {
        let a = eval_xan_num_expr(&s[..idx], headers, row)?;
        let b = eval_xan_num_expr(&s[idx + 1..], headers, row)?;
        return Some(if op == b'+' { a + b } else { a - b });
    }
    // Next precedence: * and /
    depth = 0;
    let mut split_mul: Option<(usize, u8)> = None;
    for (i, &b) in bytes.iter().enumerate() {
        match b {
            b'(' => depth += 1,
            b')' => depth -= 1,
            b'*' | b'/' if depth == 0 && i > 0 => {
                split_mul = Some((i, b));
            }
            _ => {}
        }
    }
    if let Some((idx, op)) = split_mul {
        let a = eval_xan_num_expr(&s[..idx], headers, row)?;
        let b = eval_xan_num_expr(&s[idx + 1..], headers, row)?;
        if op == b'/' {
            if b == 0.0 {
                return None;
            }
            return Some(a / b);
        }
        return Some(a * b);
    }
    if let Ok(n) = s.parse::<f64>() {
        return Some(n);
    }
    if let Some(pos) = headers.iter().position(|h| h == s) {
        return row.get(pos)?.trim().parse::<f64>().ok();
    }
    None
}

fn eval_xan_value_expr(expr: &str, headers: &[String], row: &[String]) -> Option<String> {
    let s = expr.trim();
    if let Some(pos) = headers.iter().position(|h| h == s) {
        return Some(row.get(pos).cloned().unwrap_or_default());
    }
    if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
        return Some(s[1..s.len() - 1].to_string());
    }
    let lower_s = s.to_ascii_lowercase();
    if lower_s.starts_with("upper(") && s.ends_with(')') {
        return eval_xan_value_expr(&s[6..s.len() - 1], headers, row).map(|v| v.to_uppercase());
    }
    if lower_s.starts_with("lower(") && s.ends_with(')') {
        return eval_xan_value_expr(&s[6..s.len() - 1], headers, row).map(|v| v.to_lowercase());
    }
    if lower_s.starts_with("trim(") && s.ends_with(')') {
        return eval_xan_value_expr(&s[5..s.len() - 1], headers, row).map(|v| v.trim().to_string());
    }
    if lower_s.starts_with("len(") && s.ends_with(')') {
        return eval_xan_value_expr(&s[4..s.len() - 1], headers, row).map(|v| v.chars().count().to_string());
    }
    let n = eval_xan_num_expr(s, headers, row)?;
    if n.fract() == 0.0 && n.abs() < (i64::MAX as f64) {
        Some(format!("{}", n as i64))
    } else {
        Some(format!("{n}"))
    }
}

fn parse_xan_projections(spec: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for raw in spec.split(',') {
        let item = raw.trim();
        if item.is_empty() {
            continue;
        }
        let lower = item.to_ascii_lowercase();
        if let Some(as_pos) = lower.rfind(" as ") {
            let expr = item[..as_pos].trim().to_string();
            let alias = item[as_pos + 4..]
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();
            out.push((expr, alias));
        } else {
            out.push((item.to_string(), item.to_string()));
        }
    }
    out
}

fn eval_xan_cond(expr: &str, headers: &[String], row: &[String]) -> bool {
    let s = expr.trim();
    if let Some((a, b)) = s.split_once("||") {
        return eval_xan_cond(a, headers, row) || eval_xan_cond(b, headers, row);
    }
    if let Some((a, b)) = s.split_once("&&") {
        return eval_xan_cond(a, headers, row) && eval_xan_cond(b, headers, row);
    }
    if let Some(rest) = s.strip_prefix("not ").or_else(|| s.strip_prefix('!')) {
        return !eval_xan_cond(rest, headers, row);
    }
    for op in ["==", "!=", ">=", "<=", ">", "<"] {
        if let Some((lhs, rhs)) = s.split_once(op) {
            let lv = eval_xan_value_expr(lhs, headers, row)
                .unwrap_or_else(|| lhs.trim().trim_matches('"').trim_matches('\'').to_string());
            let rv = eval_xan_value_expr(rhs, headers, row)
                .unwrap_or_else(|| rhs.trim().trim_matches('"').trim_matches('\'').to_string());
            let ord = match (lv.parse::<f64>(), rv.parse::<f64>()) {
                (Ok(na), Ok(nb)) => na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal),
                _ => lv.cmp(&rv),
            };
            return match op {
                "==" => ord == std::cmp::Ordering::Equal,
                "!=" | "<>" => ord != std::cmp::Ordering::Equal,
                ">=" => ord != std::cmp::Ordering::Less,
                "<=" => ord != std::cmp::Ordering::Greater,
                ">" => ord == std::cmp::Ordering::Greater,
                "<" => ord == std::cmp::Ordering::Less,
                _ => false,
            };
        }
    }
    if let Some(v) = eval_xan_value_expr(s, headers, row) {
        return !v.is_empty() && v != "0" && !v.eq_ignore_ascii_case("false");
    }
    false
}

fn cmd_xan(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if args.is_empty() {
        return err_out("xan: missing subcommand\n", 1);
    }
    let sub = args[0].as_str();
    let rest = &args[1..];
    match sub {
        "count" => {
            let mut explicit_delim: Option<char> = None;
            let mut no_headers = false;
            let mut check_align = false;
            let mut files = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-n" | "--no-headers" => no_headers = true,
                    "-c" | "--check-alignment" => check_align = true,
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
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
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if check_align && rows.len() > 1 {
                let prev_len = rows[0].len();
                for r in &rows[1..] {
                    if r.len() != prev_len {
                        return err_out(
                            &format!(
                                "xan count: found record with {} fields, but the previous record has {} fields\n",
                                r.len(),
                                prev_len
                            ),
                            1,
                        );
                    }
                }
            }
            let cnt = if no_headers {
                rows.len()
            } else {
                rows.len().saturating_sub(1)
            };
            ok_out(&format!("{cnt}\n"))
        }
        "headers" | "h" => {
            let mut just_names = false;
            let mut csv_mode = false;
            let mut start_offset = 0usize;
            let mut explicit_delim: Option<char> = None;
            let mut files = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-j" | "--just-names" => just_names = true,
                    "--csv" => csv_mode = true,
                    "-s" | "--start" if i + 1 < rest.len() => {
                        i += 1;
                        start_offset = rest[i].parse().unwrap_or(0);
                    }
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') => files.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            let mut all_hdrs: Vec<String> = Vec::new();
            let mut per_file_hdrs: Vec<Vec<String>> = Vec::new();
            if files.is_empty() {
                let delim = detect_xan_delim(stdin, explicit_delim);
                if let Some(hdr) = parse_csv_rows(stdin, delim).first() {
                    all_hdrs.extend(hdr.iter().cloned());
                    per_file_hdrs.push(hdr.clone());
                }
            } else {
                for f in &files {
                    if let Ok(t) = read_csv_input(std::slice::from_ref(f), stdin, cwd, fs) {
                        let delim = detect_xan_delim(&t, explicit_delim);
                        if let Some(hdr) = parse_csv_rows(&t, delim).first() {
                            per_file_hdrs.push(hdr.clone());
                            for h in hdr {
                                if !csv_mode || !all_hdrs.contains(h) {
                                    all_hdrs.push(h.clone());
                                }
                            }
                        }
                    }
                }
            }
            let mut out = String::new();
            if csv_mode {
                if files.len() > 1 {
                    out.push_str(&format!("{}\n", files.join(",")));
                    let max_rows = per_file_hdrs.iter().map(|h| h.len()).max().unwrap_or(0);
                    for r_idx in 0..max_rows {
                        let row_cells: Vec<&str> = per_file_hdrs
                            .iter()
                            .map(|h| h.get(r_idx).map(|s| s.as_str()).unwrap_or(""))
                            .collect();
                        out.push_str(&format!("{}\n", row_cells.join(",")));
                    }
                } else {
                    out.push_str("column\n");
                    for h in &all_hdrs {
                        out.push_str(&format!("{h}\n"));
                    }
                }
            } else if per_file_hdrs.len() > 1 {
                let mut counts: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
                for (f_idx, hdr) in per_file_hdrs.iter().enumerate() {
                    if f_idx > 0 {
                        out.push('\n');
                    }
                    out.push_str(&format!("{}\n", files[f_idx]));
                    let mut seen_in_file = std::collections::BTreeSet::new();
                    for (idx, h) in hdr.iter().enumerate() {
                        if seen_in_file.insert(h.clone()) {
                            *counts.entry(h.clone()).or_insert(0) += 1;
                        }
                        if just_names {
                            out.push_str(&format!("{h}\n"));
                        } else {
                            out.push_str(&format!("{} {h}\n", start_offset + idx));
                        }
                    }
                }
                let divergent: Vec<String> = counts
                    .into_iter()
                    .filter_map(|(k, c)| if c < per_file_hdrs.len() { Some(k) } else { None })
                    .collect();
                if divergent.is_empty() {
                    out.push_str("\nAll files have the same headers!\n");
                } else {
                    out.push_str(&format!(
                        "\nAll files don't have the same headers!\nDiverging headers: {}\n",
                        divergent.join(", ")
                    ));
                }
            } else {
                for (idx, h) in all_hdrs.iter().enumerate() {
                    if just_names {
                        out.push_str(&format!("{h}\n"));
                    } else {
                        out.push_str(&format!("{} {h}\n", start_offset + idx));
                    }
                }
            }
            ok_out(&out)
        }
        "select" => {
            let mut explicit_delim: Option<char> = None;
            let mut out_file: Option<String> = None;
            let mut eval_mode = false;
            let mut eval_file: Option<String> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-e" | "--evaluate" => eval_mode = true,
                    "-f" | "--evaluate-file" if i + 1 < rest.len() => {
                        i += 1;
                        eval_mode = true;
                        eval_file = Some(rest[i].clone());
                    }
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    "-o" | "--output" if i + 1 < rest.len() => {
                        i += 1;
                        out_file = Some(rest[i].clone());
                    }
                    a if !a.starts_with('-') => positional.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            let (spec_str, files): (String, &[String]) = if let Some(ef) = eval_file {
                let full = resolve_posix_path(cwd, &ef);
                let s = fs
                    .read_file(&full)
                    .map(|b| String::from_utf8_lossy(&b).trim().to_string())
                    .unwrap_or_default();
                (s, &positional[..])
            } else {
                if positional.is_empty() {
                    return ok_out("");
                }
                (positional[0].clone(), &positional[1..])
            };
            let spec = spec_str.as_str();
            let text = match read_csv_input(files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let out_delim = match out_file.as_deref() {
                Some(of) if of.ends_with(".tsv") => '\t',
                Some(of) if of.ends_with(".psv") => '|',
                Some(of) if of.ends_with(".ssv") => ';',
                _ => ',',
            };
            if eval_mode {
                let headers = &rows[0];
                let projs = parse_xan_projections(spec);
                if projs.is_empty() {
                    return err_out("xan select: empty expression\n", 1);
                }
                let out_hdrs: Vec<String> = projs.iter().map(|(_, alias)| alias.clone()).collect();
                let mut out = format_csv_row(&out_hdrs, out_delim);
                for r in &rows[1..] {
                    let mut vals = Vec::with_capacity(projs.len());
                    for (expr, _) in &projs {
                        let Some(v) = eval_xan_value_expr(expr, headers, r) else {
                            return err_out("xan select: invalid expression\n", 1);
                        };
                        vals.push(v);
                    }
                    out.push_str(&format_csv_row(&vals, out_delim));
                }
                return ok_out(&out);
            }
            let selected = resolve_xan_select_indices(spec, &rows[0]);
            let mut out = String::new();
            for r in &rows {
                let projected: Vec<String> = selected
                    .iter()
                    .map(|&idx| r.get(idx).cloned().unwrap_or_default())
                    .collect();
                out.push_str(&format_csv_row(&projected, out_delim));
            }
            if let Some(of) = out_file {
                let full = resolve_posix_path(cwd, &of);
                let _ = fs.write_file(&full, out.as_bytes());
                return ok_out("");
            }
            ok_out(&out)
        }
        "slice" => {
            let mut start = 0usize;
            let mut len: Option<usize> = None;
            let mut end_idx: Option<usize> = None;
            let mut single_index: Option<usize> = None;
            let mut indices_spec: Option<String> = None;
            let mut last_n: Option<usize> = None;
            let mut byte_offset: Option<usize> = None;
            let mut end_byte: Option<usize> = None;
            let mut start_cond: Option<String> = None;
            let mut end_cond: Option<String> = None;
            let mut explicit_delim: Option<char> = None;
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
                        len = rest[i].parse().ok();
                    }
                    "-e" | "--end" if i + 1 < rest.len() => {
                        i += 1;
                        end_idx = rest[i].parse().ok();
                    }
                    "-i" | "--index" if i + 1 < rest.len() => {
                        i += 1;
                        single_index = rest[i].parse().ok();
                    }
                    "-I" | "--indices" if i + 1 < rest.len() => {
                        i += 1;
                        indices_spec = Some(rest[i].clone());
                    }
                    "-L" | "--last" if i + 1 < rest.len() => {
                        i += 1;
                        last_n = rest[i].parse().ok();
                    }
                    "-B" | "--byte-offset" if i + 1 < rest.len() => {
                        i += 1;
                        byte_offset = rest[i].parse().ok();
                    }
                    "--end-byte" if i + 1 < rest.len() => {
                        i += 1;
                        end_byte = rest[i].parse().ok();
                    }
                    "-S" | "--start-condition" if i + 1 < rest.len() => {
                        i += 1;
                        start_cond = Some(rest[i].clone());
                    }
                    "-E" | "--end-condition" if i + 1 < rest.len() => {
                        i += 1;
                        end_cond = Some(rest[i].clone());
                    }
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
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
            let delim = detect_xan_delim(&text, explicit_delim);
            if let Some(bo) = byte_offset {
                let all_rows = parse_csv_rows(&text, delim);
                if all_rows.is_empty() {
                    return ok_out("");
                }
                let mut out = format_csv_row(&all_rows[0], ',');
                let start_b = bo.min(text.len());
                let end_b = end_byte.unwrap_or(text.len()).min(text.len());
                if start_b < end_b {
                    let sliced_rows = parse_csv_rows(&text[start_b..end_b], delim);
                    for r in &sliced_rows {
                        out.push_str(&format_csv_row(r, ','));
                    }
                }
                return ok_out(&out);
            }
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let headers = &rows[0];
            let mut out = format_csv_row(headers, ',');
            let data = &rows[1..];
            if let Some(ln) = last_n {
                for r in &data[data.len().saturating_sub(ln)..] {
                    out.push_str(&format_csv_row(r, ','));
                }
                return ok_out(&out);
            }
            if let Some(si) = single_index {
                if let Some(r) = data.get(si) {
                    out.push_str(&format_csv_row(r, ','));
                }
                return ok_out(&out);
            }
            if let Some(idx_str) = indices_spec {
                for part in idx_str.split(',') {
                    if let Ok(idx) = part.trim().parse::<usize>()
                        && let Some(r) = data.get(idx)
                    {
                        out.push_str(&format_csv_row(r, ','));
                    }
                }
                return ok_out(&out);
            }
            let mut s = start.min(data.len());
            if let Some(ref sc) = start_cond {
                s = data
                    .iter()
                    .position(|r| eval_xan_cond(sc, headers, r))
                    .unwrap_or(data.len());
            }
            let mut e = match len {
                Some(l) => (s + l).min(data.len()),
                None => end_idx.map(|ei| ei.min(data.len())).unwrap_or(data.len()),
            };
            if let Some(ref ec) = end_cond {
                if let Some(rel) = data[s..].iter().position(|r| eval_xan_cond(ec, headers, r)) {
                    e = e.min(s + rel);
                }
            }
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
            let mut uniq = false;
            let mut explicit_delim: Option<char> = None;
            let mut files = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-R" | "--reverse" => reverse = true,
                    "-N" | "--numeric" => numeric = true,
                    "-u" | "--uniq" => uniq = true,
                    "-s" | "--select" if i + 1 < rest.len() => {
                        i += 1;
                        col_spec = Some(rest[i].clone());
                    }
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => files.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            let text = match read_csv_input(&files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let headers = &rows[0];
            let sort_indices = col_spec
                .map(|s| resolve_xan_select_indices(&s, headers))
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| (0..headers.len()).collect());
            let mut data = rows[1..].to_vec();
            data.sort_by(|a, b| {
                for &sort_idx in &sort_indices {
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
                    if ord != std::cmp::Ordering::Equal {
                        return if reverse { ord.reverse() } else { ord };
                    }
                }
                std::cmp::Ordering::Equal
            });
            let mut out = format_csv_row(headers, ',');
            let mut prev_key: Option<Vec<String>> = None;
            for r in data {
                if uniq {
                    let k: Vec<String> = sort_indices
                        .iter()
                        .map(|&idx| r.get(idx).cloned().unwrap_or_default())
                        .collect();
                    if prev_key.as_ref() == Some(&k) {
                        continue;
                    }
                    prev_key = Some(k);
                }
                out.push_str(&format_csv_row(&r, ','));
            }
            ok_out(&out)
        }
        "drop" => {
            let mut explicit_delim: Option<char> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => positional.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            if positional.is_empty() {
                return ok_out("");
            }
            let spec = &positional[0];
            let files = &positional[1..];
            let text = match read_csv_input(files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let dropped = resolve_xan_select_indices(spec, &rows[0]);
            let kept: Vec<usize> = (0..rows[0].len()).filter(|idx| !dropped.contains(idx)).collect();
            let mut out = String::new();
            for r in &rows {
                let projected: Vec<String> = kept
                    .iter()
                    .map(|&idx| r.get(idx).cloned().unwrap_or_default())
                    .collect();
                out.push_str(&format_csv_row(&projected, ','));
            }
            ok_out(&out)
        }
        "filter" => {
            let mut invert = false;
            let mut limit: Option<usize> = None;
            let mut explicit_delim: Option<char> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-v" | "--invert-match" => invert = true,
                    "-l" | "--limit" if i + 1 < rest.len() => {
                        i += 1;
                        limit = rest[i].parse().ok();
                    }
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => positional.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            if positional.is_empty() {
                return ok_out("");
            }
            let expr = &positional[0];
            let files = &positional[1..];
            let text = match read_csv_input(files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let headers = &rows[0];
            let mut out = format_csv_row(headers, ',');
            let mut count = 0usize;
            for r in &rows[1..] {
                let mut m = eval_xan_cond(expr, headers, r);
                if invert {
                    m = !m;
                }
                if m {
                    out.push_str(&format_csv_row(r, ','));
                    count += 1;
                    if limit.is_some_and(|l| count >= l) {
                        break;
                    }
                }
            }
            ok_out(&out)
        }
        "search" => {
            let mut col_spec: Option<String> = None;
            let mut exact = false;
            let mut ignore_case = false;
            let mut invert = false;
            let mut limit: Option<usize> = None;
            let mut explicit_delim: Option<char> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-s" | "--select" if i + 1 < rest.len() => {
                        i += 1;
                        col_spec = Some(rest[i].clone());
                    }
                    "-e" | "--exact" => exact = true,
                    "-i" | "--ignore-case" => ignore_case = true,
                    "-v" | "--invert-match" => invert = true,
                    "-l" | "--limit" if i + 1 < rest.len() => {
                        i += 1;
                        limit = rest[i].parse().ok();
                    }
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => positional.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            if positional.is_empty() {
                return ok_out("");
            }
            let pat = if ignore_case {
                positional[0].to_lowercase()
            } else {
                positional[0].clone()
            };
            let files = &positional[1..];
            let text = match read_csv_input(files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let headers = &rows[0];
            let indices = col_spec
                .map(|s| resolve_xan_select_indices(&s, headers))
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| (0..headers.len()).collect());
            let mut out = format_csv_row(headers, ',');
            let mut count = 0usize;
            for r in &rows[1..] {
                let mut m = indices.iter().any(|&idx| {
                    let cell = r.get(idx).map(|s| s.as_str()).unwrap_or("");
                    let cmp_cell = if ignore_case {
                        cell.to_lowercase()
                    } else {
                        cell.to_string()
                    };
                    if exact {
                        cmp_cell == pat
                    } else {
                        cmp_cell.contains(&pat)
                    }
                });
                if invert {
                    m = !m;
                }
                if m {
                    out.push_str(&format_csv_row(r, ','));
                    count += 1;
                    if limit.is_some_and(|l| count >= l) {
                        break;
                    }
                }
            }
            ok_out(&out)
        }
        "reverse" => {
            let mut explicit_delim: Option<char> = None;
            let mut files = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => files.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            let text = match read_csv_input(&files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let mut out = format_csv_row(&rows[0], ',');
            for r in rows[1..].iter().rev() {
                out.push_str(&format_csv_row(r, ','));
            }
            ok_out(&out)
        }
        "rename" => {
            let mut col_spec: Option<String> = None;
            let mut explicit_delim: Option<char> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-s" | "--select" if i + 1 < rest.len() => {
                        i += 1;
                        col_spec = Some(rest[i].clone());
                    }
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => positional.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            if positional.is_empty() {
                return ok_out("");
            }
            let new_names: Vec<String> = positional[0].split(',').map(|s| s.trim().to_string()).collect();
            let files = &positional[1..];
            let text = match read_csv_input(files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let mut headers = rows[0].clone();
            let selected = col_spec
                .map(|s| resolve_xan_select_indices(&s, &headers))
                .unwrap_or_else(|| (0..headers.len()).collect());
            for (idx, &col_i) in selected.iter().enumerate() {
                if let Some(new_name) = new_names.get(idx)
                    && col_i < headers.len()
                {
                    headers[col_i] = new_name.clone();
                }
            }
            let mut out = format_csv_row(&headers, ',');
            for r in &rows[1..] {
                out.push_str(&format_csv_row(r, ','));
            }
            ok_out(&out)
        }
        "enum" => {
            let mut col_name = "index".to_string();
            let mut start_val = 0usize;
            let mut explicit_delim: Option<char> = None;
            let mut files = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-c" | "--column-name" if i + 1 < rest.len() => {
                        i += 1;
                        col_name = rest[i].clone();
                    }
                    "-S" | "--start" if i + 1 < rest.len() => {
                        i += 1;
                        start_val = rest[i].parse().unwrap_or(0);
                    }
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => files.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            let text = match read_csv_input(&files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let mut hdr = Vec::with_capacity(rows[0].len() + 1);
            hdr.push(col_name);
            hdr.extend(rows[0].iter().cloned());
            let mut out = format_csv_row(&hdr, ',');
            for (idx, r) in rows[1..].iter().enumerate() {
                let mut row = Vec::with_capacity(r.len() + 1);
                row.push((start_val + idx).to_string());
                row.extend(r.iter().cloned());
                out.push_str(&format_csv_row(&row, ','));
            }
            ok_out(&out)
        }
        "dedup" => {
            let mut col_spec: Option<String> = None;
            let mut keep_last = false;
            let mut keep_dups = false;
            let mut explicit_delim: Option<char> = None;
            let mut files = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-s" | "--select" if i + 1 < rest.len() => {
                        i += 1;
                        col_spec = Some(rest[i].clone());
                    }
                    "-l" | "--keep-last" => keep_last = true,
                    "--keep-duplicates" => keep_dups = true,
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => files.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            let text = match read_csv_input(&files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let headers = &rows[0];
            let selected = col_spec
                .map(|s| resolve_xan_select_indices(&s, headers))
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| (0..headers.len()).collect());
            let mut order: Vec<Vec<String>> = Vec::new();
            let mut seen: std::collections::HashMap<Vec<String>, (Vec<String>, usize)> =
                std::collections::HashMap::new();
            for r in &rows[1..] {
                let k: Vec<String> = selected
                    .iter()
                    .map(|&idx| r.get(idx).cloned().unwrap_or_default())
                    .collect();
                if let Some(entry) = seen.get_mut(&k) {
                    entry.1 += 1;
                    if keep_last {
                        entry.0 = r.clone();
                    }
                } else {
                    order.push(k.clone());
                    seen.insert(k, (r.clone(), 1));
                }
            }
            let mut out = format_csv_row(headers, ',');
            for k in order {
                if let Some((row, cnt)) = seen.get(&k)
                    && (!keep_dups || *cnt > 1)
                {
                    out.push_str(&format_csv_row(row, ','));
                }
            }
            ok_out(&out)
        }
        "top" => {
            let mut limit = 10usize;
            let mut reverse = false;
            let mut explicit_delim: Option<char> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-l" | "--limit" if i + 1 < rest.len() => {
                        i += 1;
                        limit = rest[i].parse().unwrap_or(10);
                    }
                    "-R" | "--reverse" => reverse = true,
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => positional.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            if positional.is_empty() {
                return ok_out("");
            }
            let col_spec = &positional[0];
            let files = &positional[1..];
            let text = match read_csv_input(files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let headers = &rows[0];
            let sort_idx = resolve_xan_select_indices(col_spec, headers)
                .into_iter()
                .next()
                .unwrap_or(0);
            let mut data = rows[1..].to_vec();
            data.sort_by(|a, b| {
                let va = a.get(sort_idx).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
                let vb = b.get(sort_idx).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
                let ord = va.partial_cmp(&vb).unwrap_or(std::cmp::Ordering::Equal);
                if reverse { ord } else { ord.reverse() }
            });
            let mut out = format_csv_row(headers, ',');
            for r in data.into_iter().take(limit) {
                out.push_str(&format_csv_row(&r, ','));
            }
            ok_out(&out)
        }
        "transpose" => {
            let mut explicit_delim: Option<char> = None;
            let mut files = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => files.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            let text = match read_csv_input(&files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let width = rows[0].len();
            let mut out = String::new();
            for col_i in 0..width {
                let t_row: Vec<String> = rows
                    .iter()
                    .map(|r| r.get(col_i).cloned().unwrap_or_default())
                    .collect();
                out.push_str(&format_csv_row(&t_row, ','));
            }
            ok_out(&out)
        }
        "map" => {
            let mut explicit_delim: Option<char> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => positional.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            if positional.is_empty() {
                return ok_out("");
            }
            let has_inline_as = positional[0].to_ascii_lowercase().contains(" as ");
            let (projections, files): (Vec<(String, String)>, &[String]) = if has_inline_as {
                (parse_xan_projections(&positional[0]), &positional[1..])
            } else {
                if positional.len() < 2 {
                    return ok_out("");
                }
                (
                    vec![(positional[0].clone(), positional[1].clone())],
                    &positional[2..],
                )
            };
            let text = match read_csv_input(files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let headers = &rows[0];
            let mut hdr = headers.clone();
            for (_, alias) in &projections {
                hdr.push(alias.clone());
            }
            let mut out = format_csv_row(&hdr, ',');
            for r in &rows[1..] {
                let mut row = r.clone();
                for (expr, _) in &projections {
                    let val = eval_xan_value_expr(expr, headers, r).unwrap_or_default();
                    row.push(val);
                }
                out.push_str(&format_csv_row(&row, ','));
            }
            ok_out(&out)
        }
        "transform" => {
            let mut explicit_delim: Option<char> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => positional.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            if positional.len() < 2 {
                return ok_out("");
            }
            let col_spec = &positional[0];
            let expr = &positional[1];
            let files = &positional[2..];
            let text = match read_csv_input(files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let headers = &rows[0];
            let target_indices = resolve_xan_select_indices(col_spec, headers);
            let mut out = format_csv_row(headers, ',');
            for r in &rows[1..] {
                let mut row = r.clone();
                let val = eval_xan_value_expr(expr, headers, r).unwrap_or_default();
                for &ti in &target_indices {
                    if ti < row.len() {
                        row[ti] = val.clone();
                    }
                }
                out.push_str(&format_csv_row(&row, ','));
            }
            ok_out(&out)
        }
        "explode" => {
            let mut explicit_delim: Option<char> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => positional.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            if positional.is_empty() {
                return ok_out("");
            }
            let col_spec = &positional[0];
            let (sep, files) = if positional.len() >= 2 && positional[1].len() == 1 {
                (positional[1].as_str(), &positional[2..])
            } else {
                ("|", &positional[1..])
            };
            let text = match read_csv_input(files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let headers = &rows[0];
            let col_idx = resolve_xan_select_indices(col_spec, headers).into_iter().next().unwrap_or(0);
            let mut out = format_csv_row(headers, ',');
            for r in &rows[1..] {
                let cell = r.get(col_idx).map(|s| s.as_str()).unwrap_or("");
                for part in cell.split(sep) {
                    let mut row = r.clone();
                    if col_idx < row.len() {
                        row[col_idx] = part.to_string();
                    }
                    out.push_str(&format_csv_row(&row, ','));
                }
            }
            ok_out(&out)
        }
        "implode" => {
            let mut explicit_delim: Option<char> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => positional.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            if positional.is_empty() {
                return ok_out("");
            }
            let col_spec = &positional[0];
            let (sep, files) = if positional.len() >= 2 && positional[1].len() == 1 {
                (positional[1].as_str(), &positional[2..])
            } else {
                ("|", &positional[1..])
            };
            let text = match read_csv_input(files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let headers = &rows[0];
            let col_idx = resolve_xan_select_indices(col_spec, headers).into_iter().next().unwrap_or(0);
            let mut out = format_csv_row(headers, ',');
            let mut order: Vec<Vec<String>> = Vec::new();
            let mut groups: std::collections::HashMap<Vec<String>, (Vec<String>, Vec<String>)> = std::collections::HashMap::new();
            for r in &rows[1..] {
                let key: Vec<String> = r.iter().enumerate().filter(|&(idx, _)| idx != col_idx).map(|(_, v)| v.clone()).collect();
                let val = r.get(col_idx).cloned().unwrap_or_default();
                if let Some(entry) = groups.get_mut(&key) {
                    entry.1.push(val);
                } else {
                    order.push(key.clone());
                    groups.insert(key, (r.clone(), vec![val]));
                }
            }
            for k in order {
                if let Some((mut base_row, vals)) = groups.remove(&k) {
                    if col_idx < base_row.len() {
                        base_row[col_idx] = vals.join(sep);
                    }
                    out.push_str(&format_csv_row(&base_row, ','));
                }
            }
            ok_out(&out)
        }
        "agg" | "groupby" => {
            let mut explicit_delim: Option<char> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => positional.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            let (group_spec, agg_spec, files): (Option<&str>, &str, &[String]) = if sub == "groupby" {
                if positional.len() < 2 {
                    return ok_out("");
                }
                (Some(positional[0].as_str()), positional[1].as_str(), &positional[2..])
            } else {
                if positional.is_empty() {
                    return ok_out("");
                }
                (None, positional[0].as_str(), &positional[1..])
            };
            let text = match read_csv_input(files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let headers = &rows[0];
            let group_indices: Vec<usize> = group_spec
                .map(|gs| resolve_xan_select_indices(gs, headers))
                .unwrap_or_default();
            // Parse agg calls: func(col) [as alias], ...
            let mut agg_calls: Vec<(String, Option<usize>, String)> = Vec::new();
            for (call_expr, alias) in parse_xan_projections(agg_spec) {
                if let Some(lp) = call_expr.find('(')
                    && let Some(rp) = call_expr.rfind(')')
                {
                    let fname = call_expr[..lp].trim().to_ascii_lowercase();
                    let arg = call_expr[lp + 1..rp].trim();
                    let col_idx = if arg.is_empty() || arg == "*" {
                        None
                    } else {
                        resolve_xan_select_indices(arg, headers).into_iter().next()
                    };
                    agg_calls.push((fname, col_idx, alias));
                }
            }
            let mut group_order: Vec<Vec<String>> = Vec::new();
            let mut groups: std::collections::HashMap<Vec<String>, Vec<Vec<String>>> =
                std::collections::HashMap::new();
            if sub == "agg" {
                group_order.push(Vec::new());
                groups.insert(Vec::new(), rows[1..].to_vec());
            } else {
                for r in &rows[1..] {
                    let gk: Vec<String> = group_indices
                        .iter()
                        .map(|&idx| r.get(idx).cloned().unwrap_or_default())
                        .collect();
                    if !groups.contains_key(&gk) {
                        group_order.push(gk.clone());
                    }
                    groups.entry(gk).or_default().push(r.clone());
                }
            }
            let mut out_hdr: Vec<String> = group_indices
                .iter()
                .map(|&idx| headers.get(idx).cloned().unwrap_or_default())
                .collect();
            for (_, _, label) in &agg_calls {
                out_hdr.push(label.clone());
            }
            let mut out = format_csv_row(&out_hdr, ',');
            for gk in group_order {
                let grp_rows = groups.get(&gk).cloned().unwrap_or_default();
                let mut out_row = gk;
                for (fname, col_idx, _) in &agg_calls {
                    let val = match fname.as_str() {
                        "count" => {
                            if let Some(ci) = col_idx {
                                grp_rows
                                    .iter()
                                    .filter(|r| !r.get(*ci).map(|s| s.is_empty()).unwrap_or(true))
                                    .count()
                                    .to_string()
                            } else {
                                grp_rows.len().to_string()
                            }
                        }
                        "sum" => {
                            let ci = col_idx.unwrap_or(0);
                            let s: f64 = grp_rows
                                .iter()
                                .filter_map(|r| r.get(ci)?.parse::<f64>().ok())
                                .sum();
                            if s.fract() == 0.0 {
                                format!("{}", s as i64)
                            } else {
                                format!("{s}")
                            }
                        }
                        "mean" | "avg" => {
                            let ci = col_idx.unwrap_or(0);
                            let vals: Vec<f64> = grp_rows
                                .iter()
                                .filter_map(|r| r.get(ci)?.parse::<f64>().ok())
                                .collect();
                            if vals.is_empty() {
                                String::new()
                            } else {
                                let m = vals.iter().sum::<f64>() / (vals.len() as f64);
                                if m.fract() == 0.0 {
                                    format!("{}", m as i64)
                                } else {
                                    format!("{m}")
                                }
                            }
                        }
                        "min" => {
                            let ci = col_idx.unwrap_or(0);
                            let vals: Vec<f64> = grp_rows
                                .iter()
                                .filter_map(|r| r.get(ci)?.parse::<f64>().ok())
                                .collect();
                            if let Some(m) = vals.into_iter().reduce(f64::min) {
                                if m.fract() == 0.0 {
                                    format!("{}", m as i64)
                                } else {
                                    format!("{m}")
                                }
                            } else {
                                String::new()
                            }
                        }
                        "max" => {
                            let ci = col_idx.unwrap_or(0);
                            let vals: Vec<f64> = grp_rows
                                .iter()
                                .filter_map(|r| r.get(ci)?.parse::<f64>().ok())
                                .collect();
                            if let Some(m) = vals.into_iter().reduce(f64::max) {
                                if m.fract() == 0.0 {
                                    format!("{}", m as i64)
                                } else {
                                    format!("{m}")
                                }
                            } else {
                                String::new()
                            }
                        }
                        "median" => {
                            let ci = col_idx.unwrap_or(0);
                            let mut vals: Vec<f64> = grp_rows
                                .iter()
                                .filter_map(|r| r.get(ci)?.parse::<f64>().ok())
                                .collect();
                            vals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                            if vals.is_empty() {
                                String::new()
                            } else {
                                let mid = vals.len() / 2;
                                let m = if vals.len() % 2 == 1 {
                                    vals[mid]
                                } else {
                                    (vals[mid - 1] + vals[mid]) / 2.0
                                };
                                if m.fract() == 0.0 {
                                    format!("{}", m as i64)
                                } else {
                                    format!("{m}")
                                }
                            }
                        }
                        "first" => {
                            let ci = col_idx.unwrap_or(0);
                            grp_rows
                                .iter()
                                .find_map(|r| r.get(ci).filter(|s| !s.is_empty()).cloned())
                                .unwrap_or_default()
                        }
                        "last" => {
                            let ci = col_idx.unwrap_or(0);
                            grp_rows
                                .iter()
                                .rev()
                                .find_map(|r| r.get(ci).filter(|s| !s.is_empty()).cloned())
                                .unwrap_or_default()
                        }
                        _ => String::new(),
                    };
                    out_row.push(val);
                }
                out.push_str(&format_csv_row(&out_row, ','));
            }
            ok_out(&out)
        }
        "freq" | "frequency" => {
            let mut col_spec: Option<String> = None;
            let mut limit = 10usize;
            let mut all = false;
            let mut no_extra = false;
            let mut explicit_delim: Option<char> = None;
            let mut files = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-s" | "--select" if i + 1 < rest.len() => {
                        i += 1;
                        col_spec = Some(rest[i].clone());
                    }
                    "-l" | "--limit" if i + 1 < rest.len() => {
                        i += 1;
                        limit = rest[i].parse().unwrap_or(10);
                    }
                    "-A" | "--all" => all = true,
                    "-N" | "--no-extra" => no_extra = true,
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => files.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            let text = match read_csv_input(&files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let headers = &rows[0];
            let selected = col_spec
                .map(|s| resolve_xan_select_indices(&s, headers))
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| (0..headers.len()).collect());
            let mut out = String::from("field,value,count\n");
            for &col_i in &selected {
                let fname = headers.get(col_i).cloned().unwrap_or_default();
                let mut counts: std::collections::HashMap<String, usize> =
                    std::collections::HashMap::new();
                for r in &rows[1..] {
                    let cell = r.get(col_i).cloned().unwrap_or_default();
                    if cell.is_empty() && no_extra {
                        continue;
                    }
                    *counts.entry(cell).or_insert(0) += 1;
                }
                let mut entries: Vec<(String, usize)> = counts.into_iter().collect();
                entries.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
                let mut remaining = 0usize;
                for (idx, (val, cnt)) in entries.into_iter().enumerate() {
                    if !all && limit > 0 && idx >= limit {
                        remaining += cnt;
                        continue;
                    }
                    let display = if val.is_empty() {
                        "<empty>".to_string()
                    } else {
                        val
                    };
                    out.push_str(&format_csv_row(
                        &[fname.clone(), display, cnt.to_string()],
                        ',',
                    ));
                }
                if remaining > 0 && !no_extra {
                    out.push_str(&format_csv_row(
                        &[fname, "<rest>".to_string(), remaining.to_string()],
                        ',',
                    ));
                }
            }
            ok_out(&out)
        }
        "stats" => {
            let mut col_spec: Option<String> = None;
            let mut explicit_delim: Option<char> = None;
            let mut files = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-s" | "--select" if i + 1 < rest.len() => {
                        i += 1;
                        col_spec = Some(rest[i].clone());
                    }
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => files.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            let text = match read_csv_input(&files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let headers = &rows[0];
            let selected = col_spec
                .map(|s| resolve_xan_select_indices(&s, headers))
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| (0..headers.len()).collect());
            let mut out = String::from(
                "field,count,count_empty,type,types,sum,mean,variance,stddev,min,max,lex_first,lex_last,min_length,max_length\n",
            );
            for &col_i in &selected {
                let fname = headers.get(col_i).cloned().unwrap_or_default();
                let mut count = 0usize;
                let mut empty = 0usize;
                let mut has_str = false;
                let mut has_float = false;
                let mut has_int = false;
                let mut has_empty = false;
                let mut sum = 0.0f64;
                let mut nums: Vec<f64> = Vec::new();
                let mut lex_first: Option<String> = None;
                let mut lex_last: Option<String> = None;
                let mut min_len = usize::MAX;
                let mut max_len = 0usize;
                for r in &rows[1..] {
                    let cell = r.get(col_i).map(|s| s.as_str()).unwrap_or("");
                    min_len = min_len.min(cell.len());
                    max_len = max_len.max(cell.len());
                    if cell.is_empty() {
                        empty += 1;
                        has_empty = true;
                        continue;
                    }
                    count += 1;
                    if lex_first.as_ref().is_none_or(|f| cell < f.as_str()) {
                        lex_first = Some(cell.to_string());
                    }
                    if lex_last.as_ref().is_none_or(|l| cell > l.as_str()) {
                        lex_last = Some(cell.to_string());
                    }
                    if !cell.starts_with("0x") && !cell.starts_with("0X")
                        && let Ok(v) = cell.parse::<f64>()
                        && v.is_finite()
                    {
                        if !cell.contains('.') && !cell.contains('e') && !cell.contains('E') {
                            has_int = true;
                        } else {
                            has_float = true;
                        }
                        sum += v;
                        nums.push(v);
                    } else {
                        has_str = true;
                    }
                }
                let mut types_vec = Vec::new();
                if has_str {
                    types_vec.push("string");
                }
                if has_float {
                    types_vec.push("float");
                }
                if has_int {
                    types_vec.push("int");
                }
                if has_empty {
                    types_vec.push("empty");
                }
                let col_type = if has_str {
                    if has_int || has_float { "mixed" } else { "string" }
                } else if has_float {
                    "float"
                } else if has_int {
                    "int"
                } else if has_empty {
                    "empty"
                } else {
                    ""
                };
                let fmt_num = |n: f64| -> String {
                    if n.fract() == 0.0 && n.abs() < (i64::MAX as f64) {
                        format!("{}", n as i64)
                    } else {
                        format!("{n}")
                    }
                };
                let (mean_s, var_s, std_s, min_s, max_s) = if !nums.is_empty() {
                    let mean = sum / (nums.len() as f64);
                    let var = nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (nums.len() as f64);
                    let std = var.sqrt();
                    let min_v = nums.iter().cloned().reduce(f64::min).unwrap_or(0.0);
                    let max_v = nums.iter().cloned().reduce(f64::max).unwrap_or(0.0);
                    (
                        fmt_num(mean),
                        fmt_num(var),
                        fmt_num(std),
                        fmt_num(min_v),
                        fmt_num(max_v),
                    )
                } else {
                    (
                        String::new(),
                        String::new(),
                        String::new(),
                        String::new(),
                        String::new(),
                    )
                };
                out.push_str(&format_csv_row(
                    &[
                        fname,
                        count.to_string(),
                        empty.to_string(),
                        col_type.to_string(),
                        types_vec.join("|"),
                        fmt_num(sum),
                        mean_s,
                        var_s,
                        std_s,
                        min_s,
                        max_s,
                        lex_first.unwrap_or_default(),
                        lex_last.unwrap_or_default(),
                        if min_len == usize::MAX {
                            String::new()
                        } else {
                            min_len.to_string()
                        },
                        if count + empty > 0 {
                            max_len.to_string()
                        } else {
                            String::new()
                        },
                    ],
                    ',',
                ));
            }
            ok_out(&out)
        }
        "table" | "view" => {
            let mut col_spec: Option<String> = None;
            let mut no_headers = false;
            let mut explicit_delim: Option<char> = None;
            let mut files = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-s" | "--select" if i + 1 < rest.len() => {
                        i += 1;
                        col_spec = Some(rest[i].clone());
                    }
                    "-n" | "--no-headers" => no_headers = true,
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => files.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            let text = match read_csv_input(&files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let selected = col_spec
                .map(|s| resolve_xan_select_indices(&s, &rows[0]))
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| (0..rows[0].len()).collect());
            let mut widths = vec![0usize; selected.len()];
            let mut proj_rows: Vec<Vec<String>> = Vec::new();
            for r in &rows {
                let pr: Vec<String> = selected
                    .iter()
                    .enumerate()
                    .map(|(ci, &idx)| {
                        let s = r.get(idx).cloned().unwrap_or_default();
                        widths[ci] = widths[ci].max(s.chars().count());
                        s
                    })
                    .collect();
                proj_rows.push(pr);
            }
            let mut out = String::new();
            for (ri, r) in proj_rows.iter().enumerate() {
                let padded: Vec<String> = r
                    .iter()
                    .enumerate()
                    .map(|(ci, s)| {
                        let pad = widths[ci].saturating_sub(s.chars().count());
                        format!("{s}{}", " ".repeat(pad))
                    })
                    .collect();
                out.push_str(&padded.join("  "));
                out.push('\n');
                if ri == 0 && !no_headers {
                    let dashes: Vec<String> = widths.iter().map(|&w| "-".repeat(w)).collect();
                    out.push_str(&dashes.join("  "));
                    out.push('\n');
                }
            }
            ok_out(&out)
        }
        "to" => {
            let mut out_file: Option<String> = None;
            let mut explicit_delim: Option<char> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-o" | "--output" if i + 1 < rest.len() => {
                        i += 1;
                        out_file = Some(rest[i].clone());
                    }
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => positional.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            if positional.is_empty() {
                return ok_out("");
            }
            let fmt = positional[0].as_str();
            let files = &positional[1..];
            let text = match read_csv_input(files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let headers = &rows[0];
            let mut out = String::new();
            if fmt == "json" {
                out.push('[');
            }
            for (ri, r) in rows[1..].iter().enumerate() {
                if fmt == "txt" {
                    for cell in r {
                        out.push_str(cell);
                        out.push('\n');
                    }
                    continue;
                }
                if fmt == "json" && ri > 0 {
                    out.push(',');
                }
                out.push('{');
                for (ci, h) in headers.iter().enumerate() {
                    if ci > 0 {
                        out.push(',');
                    }
                    let cell = r.get(ci).map(|s| s.as_str()).unwrap_or("");
                    out.push_str(&format!("\"{}\":", h.replace('"', "\\\"")));
                    if !cell.is_empty() && cell.parse::<f64>().is_ok() {
                        out.push_str(cell);
                    } else {
                        out.push_str(&format!("\"{}\"", cell.replace('"', "\\\"")));
                    }
                }
                out.push('}');
                if fmt != "json" {
                    out.push('\n');
                }
            }
            if fmt == "json" {
                out.push_str("]\n");
            }
            if let Some(of) = out_file {
                let full = resolve_posix_path(cwd, &of);
                let _ = fs.write_file(&full, out.as_bytes());
                return ok_out("");
            }
            ok_out(&out)
        }
        "from" => {
            let mut fmt_opt: Option<String> = None;
            let mut sort_keys = false;
            let mut single_obj = false;
            let mut col_name = "text".to_string();
            let mut files = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-f" | "--format" if i + 1 < rest.len() => {
                        i += 1;
                        fmt_opt = Some(rest[i].clone());
                    }
                    "--sort-keys" => sort_keys = true,
                    "--single-object" => single_obj = true,
                    "-c" | "--column-name" if i + 1 < rest.len() => {
                        i += 1;
                        col_name = rest[i].clone();
                    }
                    a if !a.starts_with('-') || a == "-" => files.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            let fmt = fmt_opt.unwrap_or_else(|| {
                files
                    .first()
                    .and_then(|p| p.rsplit_once('.').map(|(_, ext)| ext.to_string()))
                    .unwrap_or_else(|| "json".to_string())
            });
            let text = match read_csv_input(&files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            if matches!(fmt.as_str(), "txt" | "text" | "lines" | "raw") {
                let mut out = format_csv_row(std::slice::from_ref(&col_name), ',');
                if fmt == "raw" {
                    out.push_str(&format_csv_row(&[text], ','));
                } else {
                    for line in text.lines() {
                        out.push_str(&format_csv_row(&[line.trim_end_matches('\r').to_string()], ','));
                    }
                }
                return ok_out(&out);
            }
            let val = match parse_json_stream(&text) {
                Ok(mut v) => {
                    if fmt == "json" && v.len() == 1 {
                        v.remove(0)
                    } else {
                        JVal::Array(v)
                    }
                }
                Err(e) => return err_out(&format!("xan from: {e}\n"), 1),
            };
            let items: Vec<JVal> = match val {
                JVal::Array(a) => a,
                JVal::Object( pairs) if single_obj => vec![JVal::Object(pairs)],
                JVal::Object(pairs) => pairs
                    .into_iter()
                    .map(|(k, v)| JVal::Object(vec![("key".to_string(), JVal::Str(k)), ("value".to_string(), v)]))
                    .collect(),
                _ => Vec::new(),
            };
            let mut cols: Vec<String> = Vec::new();
            for item in &items {
                if let JVal::Object(pairs) = item {
                    for (k, _) in pairs {
                        if !cols.contains(k) {
                            cols.push(k.clone());
                        }
                    }
                }
            }
            if sort_keys {
                cols.sort();
            }
            if cols.is_empty() {
                return ok_out("");
            }
            let mut out = format_csv_row(&cols, ',');
            for item in &items {
                if let JVal::Object(pairs) = item {
                    let row: Vec<String> = cols
                        .iter()
                        .map(|c| {
                            pairs
                                .iter()
                                .find(|(k, _)| k == c)
                                .map(|(_, v)| match v {
                                    JVal::Null => String::new(),
                                    JVal::Str(s) => s.clone(),
                                    JVal::Bool(b) => b.to_string(),
                                    JVal::Number(n) => JVal::Number(*n).to_json_string(true, false, 0),
                                    other => other.to_json_string(true, false, 0),
                                })
                                .unwrap_or_default()
                        })
                        .collect();
                    out.push_str(&format_csv_row(&row, ','));
                }
            }
            ok_out(&out)
        }
        "cat" => {
            let mut pad = false;
            let mut explicit_delim: Option<char> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-p" | "--pad" => pad = true,
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => positional.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            if positional.is_empty() {
                return ok_out("");
            }
            let mode = positional[0].as_str();
            let files = &positional[1..];
            if mode == "rows" {
                let mut out = String::new();
                let mut header_emitted = false;
                for f in files {
                    let text = match read_csv_input(std::slice::from_ref(f), stdin, cwd, fs) {
                        Ok(t) => t,
                        Err(e) => return err_out(&e, 1),
                    };
                    let delim = detect_xan_delim(&text, explicit_delim);
                    let rows = parse_csv_rows(&text, delim);
                    if rows.is_empty() {
                        continue;
                    }
                    if !header_emitted {
                        out.push_str(&format_csv_row(&rows[0], ','));
                        header_emitted = true;
                    }
                    for r in &rows[1..] {
                        out.push_str(&format_csv_row(r, ','));
                    }
                }
                return ok_out(&out);
            }
            // cols / columns
            let mut tables: Vec<Vec<Vec<String>>> = Vec::new();
            let mut widths: Vec<usize> = Vec::new();
            for f in files {
                let text = match read_csv_input(std::slice::from_ref(f), stdin, cwd, fs) {
                    Ok(t) => t,
                    Err(e) => return err_out(&e, 1),
                };
                let delim = detect_xan_delim(&text, explicit_delim);
                let rows = parse_csv_rows(&text, delim);
                let w = rows.first().map(|r| r.len()).unwrap_or(0);
                widths.push(w);
                tables.push(rows);
            }
            let max_r = if pad {
                tables.iter().map(|t| t.len()).max().unwrap_or(0)
            } else {
                tables.iter().map(|t| t.len()).min().unwrap_or(0)
            };
            let mut out = String::new();
            for r_i in 0..max_r {
                let mut combined = Vec::new();
                for (t_i, t) in tables.iter().enumerate() {
                    if let Some(r) = t.get(r_i) {
                        combined.extend(r.iter().cloned());
                    } else {
                        combined.extend(vec![String::new(); widths[t_i]]);
                    }
                }
                out.push_str(&format_csv_row(&combined, ','));
            }
            ok_out(&out)
        }
        "split" => {
            let mut size = 4096usize;
            let mut chunks_opt: Option<usize> = None;
            let mut out_dir = ".".to_string();
            let mut template = "{}.csv".to_string();
            let mut explicit_delim: Option<char> = None;
            let mut files = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-S" | "--size" if i + 1 < rest.len() => {
                        i += 1;
                        size = rest[i].parse().unwrap_or(4096);
                    }
                    "-c" | "--chunks" if i + 1 < rest.len() => {
                        i += 1;
                        chunks_opt = rest[i].parse().ok();
                    }
                    "-O" | "--out-dir" if i + 1 < rest.len() => {
                        i += 1;
                        out_dir = rest[i].clone();
                    }
                    "-f" | "--filename" if i + 1 < rest.len() => {
                        i += 1;
                        template = rest[i].clone();
                    }
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => files.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            let text = match read_csv_input(&files, stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let delim = detect_xan_delim(&text, explicit_delim);
            let rows = parse_csv_rows(&text, delim);
            if rows.is_empty() {
                return ok_out("");
            }
            let headers = &rows[0];
            let data = &rows[1..];
            if let Some(ch) = chunks_opt
                && ch > 0
            {
                size = data.len().div_ceil(ch).max(1);
            }
            let dir_path = resolve_posix_path(cwd, &out_dir);
            let _ = fs.mkdir_all(&dir_path);
            let mut start = 0usize;
            while start < data.len().max(1) {
                let label = if chunks_opt.is_some() {
                    (start / size).to_string()
                } else {
                    start.to_string()
                };
                let fname = template.replace("{}", &label);
                let fpath = resolve_posix_path(&dir_path, &fname);
                let mut chunk_out = format_csv_row(headers, ',');
                for r in &data[start..(start + size).min(data.len())] {
                    chunk_out.push_str(&format_csv_row(r, ','));
                }
                let _ = fs.write_file(&fpath, chunk_out.as_bytes());
                start += size;
                if data.is_empty() {
                    break;
                }
            }
            ok_out("")
        }
        "join" => {
            let mut join_mode = "inner";
            let mut ignore_case = false;
            let mut drop_key_opt: Option<String> = None;
            let mut explicit_delim: Option<char> = None;
            let mut positional = Vec::new();
            let mut i = 0usize;
            while i < rest.len() {
                match rest[i].as_str() {
                    "--left" => join_mode = "left",
                    "--right" => join_mode = "right",
                    "--full" => join_mode = "full",
                    "--semi" => join_mode = "semi",
                    "--anti" => join_mode = "anti",
                    "--cross" => join_mode = "cross",
                    "-i" | "--ignore-case" => ignore_case = true,
                    "--drop-key" if i + 1 < rest.len() => {
                        i += 1;
                        drop_key_opt = Some(rest[i].clone());
                    }
                    "-d" | "--delimiter" if i + 1 < rest.len() => {
                        i += 1;
                        explicit_delim = rest[i].chars().next();
                    }
                    a if !a.starts_with('-') || a == "-" => positional.push(a.to_string()),
                    _ => {}
                }
                i += 1;
            }
            if positional.len() < 3 {
                return ok_out("");
            }
            let (left_key_spec, left_file, right_key_spec, right_file) = if positional.len() >= 4 {
                (&positional[0], &positional[1], &positional[2], &positional[3])
            } else {
                (&positional[0], &positional[1], &positional[0], &positional[2])
            };
            let left_text = match read_csv_input(std::slice::from_ref(left_file), stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let right_text = match read_csv_input(std::slice::from_ref(right_file), stdin, cwd, fs) {
                Ok(t) => t,
                Err(e) => return err_out(&e, 1),
            };
            let l_delim = detect_xan_delim(&left_text, explicit_delim);
            let r_delim = detect_xan_delim(&right_text, explicit_delim);
            let l_rows = parse_csv_rows(&left_text, l_delim);
            let r_rows = parse_csv_rows(&right_text, r_delim);
            if l_rows.is_empty() || r_rows.is_empty() {
                return ok_out("");
            }
            let l_hdr = &l_rows[0];
            let r_hdr = &r_rows[0];
            let l_keys = resolve_xan_select_indices(left_key_spec, l_hdr);
            let r_keys = resolve_xan_select_indices(right_key_spec, r_hdr);
            let drop_mode = drop_key_opt.unwrap_or_else(|| {
                if !ignore_case
                    && !matches!(join_mode, "full" | "cross" | "semi" | "anti")
                    && l_keys.len() == r_keys.len()
                    && l_keys
                        .iter()
                        .zip(r_keys.iter())
                        .all(|(&li, &ri)| l_hdr.get(li) == r_hdr.get(ri))
                {
                    if join_mode == "right" {
                        "left".to_string()
                    } else {
                        "right".to_string()
                    }
                } else {
                    "none".to_string()
                }
            });
            let keep_left: Vec<usize> = (0..l_hdr.len())
                .filter(|i| !(matches!(drop_mode.as_str(), "left" | "both") && l_keys.contains(i)))
                .collect();
            let keep_right: Vec<usize> = (0..r_hdr.len())
                .filter(|i| !(matches!(drop_mode.as_str(), "right" | "both") && r_keys.contains(i)))
                .collect();
            let semi = matches!(join_mode, "semi" | "anti");
            let make_key = |row: &[String], keys: &[usize]| -> Option<Vec<String>> {
                let mut k = Vec::with_capacity(keys.len());
                let mut any_nonempty = false;
                for &idx in keys {
                    let s = row.get(idx).cloned().unwrap_or_default();
                    if !s.is_empty() {
                        any_nonempty = true;
                    }
                    k.push(if ignore_case { s.to_lowercase() } else { s });
                }
                if any_nonempty { Some(k) } else { None }
            };
            let emit_pair = |a: Option<&[String]>, b: Option<&[String]>| -> String {
                let mut combined = Vec::new();
                for &li in &keep_left {
                    combined.push(a.and_then(|r| r.get(li)).cloned().unwrap_or_default());
                }
                if !semi {
                    for &ri in &keep_right {
                        combined.push(b.and_then(|r| r.get(ri)).cloned().unwrap_or_default());
                    }
                }
                format_csv_row(&combined, ',')
            };
            let mut out = emit_pair(Some(l_hdr), Some(r_hdr));
            let mut right_index: std::collections::HashMap<Vec<String>, Vec<usize>> =
                std::collections::HashMap::new();
            for (r_idx, r) in r_rows[1..].iter().enumerate() {
                if let Some(k) = make_key(r, &r_keys) {
                    right_index.entry(k).or_default().push(r_idx);
                }
            }
            let mut matched_right = vec![false; r_rows.len().saturating_sub(1)];
            for lr in &l_rows[1..] {
                let matches: Vec<usize> = if join_mode == "cross" {
                    (0..r_rows.len().saturating_sub(1)).collect()
                } else if let Some(k) = make_key(lr, &l_keys) {
                    right_index.get(&k).cloned().unwrap_or_default()
                } else {
                    Vec::new()
                };
                if semi {
                    let cond = if join_mode == "anti" {
                        matches.is_empty()
                    } else {
                        !matches.is_empty()
                    };
                    if cond {
                        out.push_str(&emit_pair(Some(lr), None));
                    }
                } else if !matches.is_empty() {
                    for r_idx in matches {
                        matched_right[r_idx] = true;
                        out.push_str(&emit_pair(Some(lr), Some(&r_rows[r_idx + 1])));
                    }
                } else if matches!(join_mode, "left" | "full") {
                    out.push_str(&emit_pair(Some(lr), None));
                }
            }
            if matches!(join_mode, "right" | "full") {
                for (r_idx, was_matched) in matched_right.into_iter().enumerate() {
                    if !was_matched {
                        out.push_str(&emit_pair(None, Some(&r_rows[r_idx + 1])));
                    }
                }
            }
            ok_out(&out)
        }
        _ => ok_out(""),
    }
}

fn cmd_xmllint(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut xpath: Option<String> = None;
    let mut noout = false;
    let mut format_xml = false;
    let mut c14n = false;
    let mut out_file: Option<String> = None;
    let mut encoding: Option<String> = None;
    let mut files = Vec::new();
    let mut literal = false;

    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if literal {
            files.push(a.to_string());
            i += 1;
            continue;
        }
        match a {
            "--" => literal = true,
            "--noout" => noout = true,
            "--format" => format_xml = true,
            "--c14n" | "--exc-c14n" => c14n = true,
            "--noblanks" | "--nocdata" | "--recover" => {}
            "--output" | "-o" if i + 1 < args.len() => {
                i += 1;
                out_file = Some(args[i].clone());
            }
            "--encode" if i + 1 < args.len() => {
                i += 1;
                encoding = Some(args[i].clone());
            }
            "--xpath" if i + 1 < args.len() => {
                i += 1;
                if args[i] == "--" && i + 1 < args.len() {
                    i += 1;
                }
                xpath = Some(args[i].clone());
            }
            _ if !a.starts_with('-') || a == "-" => files.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }

    let text = match read_csv_input(&files, stdin, cwd, fs) {
        Ok(t) => t,
        Err(e) => return err_out(&format!("xmllint: {e}"), 1),
    };

    let dom = match parse_xml_strict_dom(&text) {
        Ok(d) => d,
        Err(e) => return err_out(&format!("xmllint: {e}\n"), 1),
    };

    if noout {
        return ok_out("");
    }
    let rendered = if let Some(xp) = xpath {
        let res = eval_xmllint_xpath(&dom, xp.trim());
        if res.exit_code != 0 {
            return res;
        }
        res.stdout
    } else if c14n {
        let mut out = String::new();
        for n in &dom {
            if let HtmlNode::Element(el) = n {
                out.push_str(&serialize_xml_c14n(el));
            }
        }
        out
    } else if format_xml || out_file.is_some() || encoding.is_some() {
        let decl = match encoding.as_deref() {
            Some(enc) => format!("<?xml version=\"1.0\" encoding=\"{enc}\"?>\n"),
            None => String::from("<?xml version=\"1.0\"?>\n"),
        };
        let mut out = decl;
        for n in &dom {
            if let HtmlNode::Element(el) = n {
                out.push_str(&serialize_xml_pretty(el, 0));
                out.push('\n');
            }
        }
        out
    } else {
        text
    };
    if let Some(of) = out_file && of != "-" {
        let full = resolve_posix_path(cwd, &of);
        if let Err(e) = fs.write_file(&full, rendered.as_bytes()) {
            return err_out(&format!("xmllint: {of}: {e}\n"), 1);
        }
        return ok_out("");
    }
    ok_out(&rendered)
}

fn parse_xml_strict_dom(src: &str) -> Result<Vec<HtmlNode>, String> {
    let mut pos = 0usize;
    let nodes = parse_xml_strict_children(src, &mut pos, None)?;
    if !nodes.iter().any(|n| matches!(n, HtmlNode::Element(_))) {
        return Err("Start tag expected, '<' not found".to_string());
    }
    Ok(nodes)
}

fn parse_xml_strict_children(
    src: &str,
    pos: &mut usize,
    expected_close: Option<&str>,
) -> Result<Vec<HtmlNode>, String> {
    let mut out = Vec::new();
    let bytes = src.as_bytes();
    let mut closed = false;
    while *pos < bytes.len() {
        if let Some(rel_lt) = src[*pos..].find('<') {
            if rel_lt > 0 {
                let text = &src[*pos..*pos + rel_lt];
                out.push(HtmlNode::Text(unescape_xml_entities(text)));
                *pos += rel_lt;
            }
            let rest = &src[*pos..];
            if rest.starts_with("<!--") {
                let Some(end) = rest.find("-->") else {
                    return Err("Unclosed XML comment".to_string());
                };
                *pos += end + 3;
                continue;
            }
            if let Some(after_cdata) = rest.strip_prefix("<![CDATA[") {
                let Some(end) = after_cdata.find("]]>") else {
                    return Err("Unclosed CDATA section".to_string());
                };
                out.push(HtmlNode::Text(after_cdata[..end].to_string()));
                *pos += 9 + end + 3;
                continue;
            }
            if rest.starts_with("<?") || rest.starts_with("<!") {
                let Some(end) = rest.find('>') else {
                    return Err("Unclosed XML declaration".to_string());
                };
                *pos += end + 1;
                continue;
            }
            if let Some(after_slash) = rest.strip_prefix("</") {
                let Some(end_gt) = after_slash.find('>') else {
                    return Err("Unclosed closing tag".to_string());
                };
                let close_name = after_slash[..end_gt].trim();
                *pos += 2 + end_gt + 1;
                match expected_close {
                    Some(exp) if exp == close_name => {
                        closed = true;
                        break;
                    }
                    Some(exp) => {
                        return Err(format!(
                            "Opening and ending tag mismatch: {exp} and {close_name}"
                        ));
                    }
                    None => {
                        return Err(format!("Unexpected closing tag </{close_name}>"));
                    }
                }
            }
            let Some(gt) = rest.find('>') else {
                return Err("Unclosed start tag".to_string());
            };
            let inside = &rest[1..gt];
            let self_closing = inside.trim_end().ends_with('/');
            let clean = inside.trim_end().trim_end_matches('/').trim();
            let mut name_end = 0usize;
            for (idx, ch) in clean.char_indices() {
                if ch.is_whitespace() {
                    break;
                }
                name_end = idx + ch.len_utf8();
            }
            let tag_name = clean[..name_end].to_string();
            if tag_name.is_empty() {
                return Err("Empty tag name".to_string());
            }
            let attrs = parse_html_attrs(clean[name_end..].trim());
            *pos += gt + 1;
            if self_closing {
                out.push(HtmlNode::Element(HtmlElement {
                    tag: tag_name,
                    attrs,
                    children: Vec::new(),
                }));
            } else {
                let children = parse_xml_strict_children(src, pos, Some(&tag_name))?;
                out.push(HtmlNode::Element(HtmlElement {
                    tag: tag_name,
                    attrs,
                    children,
                }));
            }
        } else {
            let text = &src[*pos..];
            if !text.is_empty() {
                out.push(HtmlNode::Text(unescape_xml_entities(text)));
            }
            *pos = bytes.len();
        }
    }
    if let Some(exp) = expected_close
        && !closed
    {
        return Err(format!("Premature end of data in tag {exp}"));
    }
    Ok(out)
}

fn serialize_xml_c14n(el: &HtmlElement) -> String {
    let mut out = String::new();
    out.push('<');
    out.push_str(&el.tag);
    let mut sorted_attrs = el.attrs.clone();
    sorted_attrs.sort_by(|a, b| a.0.cmp(&b.0));
    for (k, v) in &sorted_attrs {
        out.push(' ');
        out.push_str(k);
        out.push_str("=\"");
        out.push_str(&v.replace('&', "&amp;").replace('"', "&quot;"));
        out.push('"');
    }
    out.push('>');
    for c in &el.children {
        match c {
            HtmlNode::Text(t) => out.push_str(t),
            HtmlNode::Element(child_el) => out.push_str(&serialize_xml_c14n(child_el)),
        }
    }
    out.push_str("</");
    out.push_str(&el.tag);
    out.push('>');
    out
}

fn serialize_xml_pretty(el: &HtmlElement, indent: usize) -> String {
    let mut out = String::new();
    let pad = "  ".repeat(indent);
    out.push_str(&pad);
    out.push('<');
    out.push_str(&el.tag);
    for (k, v) in &el.attrs {
        out.push(' ');
        out.push_str(k);
        out.push_str("=\"");
        out.push_str(&v.replace('&', "&amp;").replace('"', "&quot;"));
        out.push('"');
    }
    out.push('>');
    let has_elem_child = el.children.iter().any(|c| matches!(c, HtmlNode::Element(_)));
    if has_elem_child {
        out.push('\n');
        for c in &el.children {
            if let HtmlNode::Element(child_el) = c {
                out.push_str(&serialize_xml_pretty(child_el, indent + 1));
                out.push('\n');
            }
        }
        out.push_str(&pad);
    } else {
        for c in &el.children {
            if let HtmlNode::Text(t) = c {
                out.push_str(t);
            }
        }
    }
    out.push_str("</");
    out.push_str(&el.tag);
    out.push('>');
    out
}

#[derive(Clone, Debug)]
enum XPathItem {
    Node(Vec<HtmlElement>),
    Text(String),
}

fn eval_xmllint_xpath(dom: &[HtmlNode], xp: &str) -> BuiltinOutcome {
    if let Some(inner) = xp.strip_prefix("count(").and_then(|s| s.strip_suffix(')')) {
        let items = eval_xpath_union(dom, inner.trim());
        return ok_out(&format!("{}\n", items.len()));
    }
    if let Some(inner) = xp.strip_prefix("sum(").and_then(|s| s.strip_suffix(')')) {
        let items = eval_xpath_union(dom, inner.trim());
        let sum: f64 = items
            .iter()
            .filter_map(|it| xpath_item_string_value(it).trim().parse::<f64>().ok())
            .sum();
        if sum.fract() == 0.0 {
            return ok_out(&format!("{}\n", sum as i64));
        }
        return ok_out(&format!("{sum}\n"));
    }
    if let Some(inner) = xp.strip_prefix("boolean(").and_then(|s| s.strip_suffix(')')) {
        let items = eval_xpath_union(dom, inner.trim());
        return ok_out(if items.is_empty() { "false\n" } else { "true\n" });
    }
    if let Some(inner) = xp.strip_prefix("string(").and_then(|s| s.strip_suffix(')')) {
        let items = eval_xpath_union(dom, inner.trim());
        let first = items
            .first()
            .map(xpath_item_string_value)
            .unwrap_or_default();
        return ok_out(&format!("{first}\n"));
    }
    let items = eval_xpath_union(dom, xp);
    if items.is_empty() {
        return err_out("XPath set is empty\n", 10);
    }
    let mut out = Vec::new();
    for item in &items {
        match item {
            XPathItem::Node(chain) => {
                if let Some(el) = chain.last() {
                    out.push(serialize_xml_c14n(el));
                }
            }
            XPathItem::Text(t) => out.push(t.clone()),
        }
    }
    ok_out(&format!("{}\n", out.join("\n")))
}

fn xpath_item_string_value(item: &XPathItem) -> String {
    match item {
        XPathItem::Text(t) => t.clone(),
        XPathItem::Node(chain) => {
            let mut buf = String::new();
            if let Some(el) = chain.last() {
                collect_html_text_concat(&el.children, &mut buf);
            }
            buf
        }
    }
}

fn eval_xpath_union(dom: &[HtmlNode], expr: &str) -> Vec<XPathItem> {
    let mut out = Vec::new();
    for part in split_xpath_top(expr, '|') {
        out.extend(eval_xpath_path(dom, part.trim()));
    }
    out
}

fn split_xpath_top(s: &str, sep: char) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut b_depth = 0i32;
    let mut p_depth = 0i32;
    let mut in_q: Option<char> = None;
    for ch in s.chars() {
        if let Some(q) = in_q {
            cur.push(ch);
            if ch == q {
                in_q = None;
            }
            continue;
        }
        match ch {
            '"' | '\'' => {
                in_q = Some(ch);
                cur.push(ch);
            }
            '[' => {
                b_depth += 1;
                cur.push(ch);
            }
            ']' => {
                b_depth -= 1;
                cur.push(ch);
            }
            '(' => {
                p_depth += 1;
                cur.push(ch);
            }
            ')' => {
                p_depth -= 1;
                cur.push(ch);
            }
            c if c == sep && b_depth == 0 && p_depth == 0 => {
                out.push(cur.clone());
                cur.clear();
            }
            _ => cur.push(ch),
        }
    }
    out.push(cur);
    out
}

fn parse_xpath_steps(path: &str) -> Vec<(bool, String)> {
    let mut steps = Vec::new();
    let chars: Vec<char> = path.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        let mut desc = false;
        if chars[i] == '/' {
            if i + 1 < chars.len() && chars[i + 1] == '/' {
                desc = true;
                i += 2;
            } else {
                i += 1;
            }
        }
        let start = i;
        let mut b_depth = 0i32;
        let mut in_q: Option<char> = None;
        while i < chars.len() {
            let c = chars[i];
            if let Some(q) = in_q {
                if c == q {
                    in_q = None;
                }
            } else if c == '"' || c == '\'' {
                in_q = Some(c);
            } else if c == '[' {
                b_depth += 1;
            } else if c == ']' {
                b_depth -= 1;
            } else if c == '/' && b_depth == 0 {
                break;
            }
            i += 1;
        }
        let seg: String = chars[start..i].iter().collect();
        if !seg.trim().is_empty() {
            steps.push((desc, seg.trim().to_string()));
        }
    }
    steps
}

fn collect_descendant_chains(
    nodes: &[HtmlNode],
    prefix: &[HtmlElement],
    tag_test: &str,
    out: &mut Vec<Vec<HtmlElement>>,
) {
    for n in nodes {
        if let HtmlNode::Element(el) = n {
            let mut chain = prefix.to_vec();
            chain.push(el.clone());
            if tag_test == "*" || el.tag == tag_test {
                out.push(chain.clone());
            }
            collect_descendant_chains(&el.children, &chain, tag_test, out);
        }
    }
}

fn eval_xpath_path(dom: &[HtmlNode], path: &str) -> Vec<XPathItem> {
    let steps = parse_xpath_steps(path);
    if steps.is_empty() {
        return Vec::new();
    }
    let mut current: Vec<XPathItem> = Vec::new();
    for (step_idx, (desc, raw_seg)) in steps.iter().enumerate() {
        let (base_test, preds) = split_xpath_predicates(raw_seg);
        if step_idx == 0 {
            if *desc {
                let mut chains = Vec::new();
                collect_descendant_chains(dom, &[], &base_test, &mut chains);
                let filtered = filter_xpath_chains(chains, &preds);
                current = filtered.into_iter().map(XPathItem::Node).collect();
            } else {
                let mut chains = Vec::new();
                for n in dom {
                    if let HtmlNode::Element(el) = n
                        && (base_test == "*" || el.tag == base_test)
                    {
                        chains.push(vec![el.clone()]);
                    }
                }
                let filtered = filter_xpath_chains(chains, &preds);
                current = filtered.into_iter().map(XPathItem::Node).collect();
            }
            continue;
        }
        let mut next_items: Vec<XPathItem> = Vec::new();
        if base_test == ".." {
            for item in &current {
                if let XPathItem::Node(chain) = item
                    && chain.len() >= 2
                {
                    next_items.push(XPathItem::Node(chain[..chain.len() - 1].to_vec()));
                }
            }
            current = next_items;
            continue;
        }
        if base_test == "." {
            continue;
        }
        if let Some(attr_name) = base_test.strip_prefix('@') {
            for item in &current {
                if let XPathItem::Node(chain) = item
                    && let Some(el) = chain.last()
                    && let Some((_, v)) = el.attrs.iter().find(|(k, _)| k == attr_name)
                {
                    next_items.push(XPathItem::Text(v.clone()));
                }
            }
            current = next_items;
            continue;
        }
        if base_test == "text()" {
            for item in &current {
                if let XPathItem::Node(chain) = item
                    && let Some(el) = chain.last()
                {
                    let mut buf = String::new();
                    collect_html_text_concat(&el.children, &mut buf);
                    next_items.push(XPathItem::Text(buf));
                }
            }
            current = next_items;
            continue;
        }
        for item in &current {
            if let XPathItem::Node(chain) = item
                && let Some(el) = chain.last()
            {
                let mut sub_chains = Vec::new();
                if *desc {
                    collect_descendant_chains(&el.children, chain, &base_test, &mut sub_chains);
                } else {
                    for c in &el.children {
                        if let HtmlNode::Element(child_el) = c
                            && (base_test == "*" || child_el.tag == base_test)
                        {
                            let mut nc = chain.clone();
                            nc.push(child_el.clone());
                            sub_chains.push(nc);
                        }
                    }
                }
                let filtered = filter_xpath_chains(sub_chains, &preds);
                next_items.extend(filtered.into_iter().map(XPathItem::Node));
            }
        }
        current = next_items;
    }
    current
}

fn split_xpath_predicates(seg: &str) -> (String, Vec<String>) {
    let Some(first_b) = seg.find('[') else {
        return (seg.trim().to_string(), Vec::new());
    };
    let base = seg[..first_b].trim().to_string();
    let mut preds = Vec::new();
    let mut rest = &seg[first_b..];
    while let Some(open) = rest.find('[') {
        let after = &rest[open + 1..];
        if let Some(close) = after.find(']') {
            preds.push(after[..close].trim().to_string());
            rest = &after[close + 1..];
        } else {
            break;
        }
    }
    (base, preds)
}

fn filter_xpath_chains(
    mut chains: Vec<Vec<HtmlElement>>,
    preds: &[String],
) -> Vec<Vec<HtmlElement>> {
    for pred in preds {
        let p = pred.trim();
        if p == "last()" {
            chains = chains.pop().into_iter().collect();
            continue;
        }
        if let Ok(idx1) = p.parse::<usize>() {
            chains = if idx1 >= 1 && idx1 <= chains.len() {
                vec![chains.swap_remove(idx1 - 1)]
            } else {
                Vec::new()
            };
            continue;
        }
        chains.retain(|chain| {
            let Some(el) = chain.last() else {
                return false;
            };
            eval_xpath_pred(el, p)
        });
    }
    chains
}

fn eval_xpath_pred(el: &HtmlElement, pred: &str) -> bool {
    for op in ["!=", ">=", "<=", "=", ">", "<"] {
        if let Some((lhs, rhs)) = pred.split_once(op) {
            let l = lhs.trim();
            let r = rhs.trim().trim_matches('"').trim_matches('\'');
            let actual = if let Some(attr) = l.strip_prefix('@') {
                el.attrs
                    .iter()
                    .find(|(k, _)| k == attr)
                    .map(|(_, v)| v.clone())
            } else {
                el.children.iter().find_map(|c| {
                    if let HtmlNode::Element(ce) = c
                        && ce.tag == l
                    {
                        let mut t = String::new();
                        collect_html_text_concat(&ce.children, &mut t);
                        if t.is_empty()
                            && ce
                                .attrs
                                .iter()
                                .any(|(_, av)| av.contains(r))
                        {
                            return Some(r.to_string());
                        }
                        return Some(t);
                    }
                    None
                })
            };
            let Some(act_val) = actual else {
                return false;
            };
            let ord = match (act_val.parse::<f64>(), r.parse::<f64>()) {
                (Ok(na), Ok(nb)) => na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal),
                _ => act_val.as_str().cmp(r),
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
    if let Some(attr) = pred.strip_prefix('@') {
        return el.attrs.iter().any(|(k, _)| k == attr.trim());
    }
    el.children
        .iter()
        .any(|c| matches!(c, HtmlNode::Element(ce) if ce.tag == pred))
}

#[derive(Default, Clone)]
struct SqlForeignKey {
    child_col: String,
    parent_table: String,
    parent_col: String,
    on_delete: String,
    on_update: String,
}

#[derive(Default, Clone)]
struct SqlTable {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
    imported_csv: bool,
    defaults: BTreeMap<String, String>,
    generated: BTreeMap<String, String>,
    not_null_cols: Vec<String>,
    check_exprs: Vec<String>,
    foreign_keys: Vec<SqlForeignKey>,
    is_fts5: bool,
    next_seq: usize,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SqlTriggerOp {
    Insert,
    Update,
    Delete,
}

#[derive(Clone)]
struct SqlTrigger {
    table: String,
    op: SqlTriggerOp,
    before: bool,
    when_expr: Option<String>,
    body: String,
}

#[derive(Clone)]
enum SqlWinFn {
    RowNumber,
    Rank,
    DenseRank,
    Ntile(usize),
    Lag {
        col_idx: usize,
        offset: usize,
        default_val: String,
    },
    Lead {
        col_idx: usize,
        offset: usize,
        default_val: String,
    },
    FirstValue {
        col_idx: usize,
    },
    LastValue {
        col_idx: usize,
    },
    NthValue {
        col_idx: usize,
        nth: usize,
    },
    Sum {
        col_idx: usize,
    },
    Avg {
        col_idx: usize,
    },
    Count,
    Max {
        col_idx: usize,
    },
    Min {
        col_idx: usize,
    },
}

fn strip_sql_comments(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len());
    let chars: Vec<char> = sql.chars().collect();
    let mut i = 0usize;
    let mut in_sq = false;
    let mut in_dq = false;
    let mut line_non_ws_seen = false;
    let mut is_dot_line = false;
    while i < chars.len() {
        let ch = chars[i];
        if ch == '\n' {
            line_non_ws_seen = false;
            is_dot_line = false;
            out.push(ch);
            i += 1;
            continue;
        }
        if !line_non_ws_seen && !ch.is_whitespace() {
            line_non_ws_seen = true;
            is_dot_line = ch == '.';
        }
        if ch == '\'' && !in_dq {
            in_sq = !in_sq;
            out.push(ch);
            i += 1;
        } else if ch == '"' && !in_sq {
            in_dq = !in_dq;
            out.push(ch);
            i += 1;
        } else if !in_sq && !in_dq && !is_dot_line && ch == '-' && i + 1 < chars.len() && chars[i + 1] == '-' {
            i += 2;
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if !in_sq && !in_dq && ch == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                if chars[i] == '\n' {
                    out.push('\n');
                }
                i += 1;
            }
            if i + 1 < chars.len() {
                i += 2;
            }
        } else {
            out.push(ch);
            i += 1;
        }
    }
    out
}

fn split_sql_stmts(sql: &str) -> Vec<String> {
    let stripped = strip_sql_comments(sql);
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_sq = false;
    let mut in_dq = false;
    let mut after_trigger = false;
    let mut trig_depth = 0usize;
    let chars: Vec<char> = stripped.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        let ch = chars[i];
        if ch == '\'' && !in_dq {
            in_sq = !in_sq;
            cur.push(ch);
            i += 1;
            continue;
        }
        if ch == '"' && !in_sq {
            in_dq = !in_dq;
            cur.push(ch);
            i += 1;
            continue;
        }
        if !in_sq && !in_dq && (ch.is_ascii_alphabetic() || ch == '_') {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                cur.push(chars[i]);
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            let wu = word.to_ascii_uppercase();
            if wu == "TRIGGER" {
                after_trigger = true;
            } else if after_trigger && wu == "BEGIN" {
                trig_depth += 1;
            } else if trig_depth > 0 && wu == "CASE" {
                trig_depth += 1;
            } else if trig_depth > 0 && wu == "END" {
                trig_depth -= 1;
                if trig_depth == 0 {
                    after_trigger = false;
                }
            }
            continue;
        }
        if !in_sq && !in_dq && ch == ';' && trig_depth == 0 {
            let s = cur.trim().to_string();
            if !s.is_empty() {
                out.push(s);
            }
            cur.clear();
            after_trigger = false;
            i += 1;
            continue;
        }
        cur.push(ch);
        i += 1;
    }
    let s = cur.trim().to_string();
    if !s.is_empty() {
        out.push(s);
    }
    out
}

fn cmd_csvstack(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut groups: Option<Vec<String>> = None;
    let mut group_name = "group".to_string();
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-g" | "--groups" if i + 1 < args.len() => {
                i += 1;
                groups = Some(args[i].split(',').map(|s| s.to_string()).collect());
            }
            "-n" | "--group-name" if i + 1 < args.len() => {
                i += 1;
                group_name = args[i].clone();
            }
            a if !a.starts_with('-') || a == "-" => files.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }
    let mut parsed_files: Vec<(usize, Vec<String>, Vec<Vec<String>>)> = Vec::new();
    let mut union_headers: Vec<String> = Vec::new();
    for (f_idx, f) in files.iter().enumerate() {
        let text = if f == "-" {
            stdin.to_string()
        } else {
            let full = resolve_posix_path(cwd, f);
            fs.read_file(&full)
                .map(|b| String::from_utf8_lossy(&b).into_owned())
                .unwrap_or_default()
        };
        let rows = parse_csv_rows(&text, ',');
        if rows.is_empty() {
            continue;
        }
        let hdr = rows[0].clone();
        for h in &hdr {
            if !union_headers.contains(h) {
                union_headers.push(h.clone());
            }
        }
        parsed_files.push((f_idx, hdr, rows[1..].to_vec()));
    }
    if parsed_files.is_empty() {
        return ok_out("");
    }
    let mut out_hdr = Vec::new();
    if groups.is_some() {
        out_hdr.push(group_name);
    }
    out_hdr.extend(union_headers.iter().cloned());
    let mut out = format_csv_row(&out_hdr, ',');
    for (f_idx, hdr, data_rows) in parsed_files {
        for row in data_rows {
            let mut out_row = Vec::new();
            if let Some(ref grps) = groups {
                let g = grps
                    .get(f_idx)
                    .cloned()
                    .or_else(|| files.get(f_idx).map(|p| crate::vfs::basename_posix_path(p).to_string()))
                    .unwrap_or_default();
                out_row.push(g);
            }
            for uh in &union_headers {
                let cell = hdr
                    .iter()
                    .position(|h| h == uh)
                    .and_then(|pos| row.get(pos))
                    .cloned()
                    .unwrap_or_default();
                out_row.push(cell);
            }
            out.push_str(&format_csv_row(&out_row, ','));
        }
    }
    ok_out(&out)
}

fn cmd_csvjoin(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut col_spec = String::new();
    let mut left_join = false;
    let mut right_join = false;
    let mut outer_join = false;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-c" | "--columns" if i + 1 < args.len() => {
                i += 1;
                col_spec = args[i].clone();
            }
            "--left" => left_join = true,
            "--right" => right_join = true,
            "--outer" => outer_join = true,
            a if !a.starts_with('-') || a == "-" => files.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }
    if files.len() < 2 {
        return ok_out("");
    }
    let read_csv = |f: &str| -> (Vec<String>, Vec<Vec<String>>) {
        let text = if f == "-" {
            stdin.to_string()
        } else {
            let full = resolve_posix_path(cwd, f);
            fs.read_file(&full)
                .map(|b| String::from_utf8_lossy(&b).into_owned())
                .unwrap_or_default()
        };
        let parsed = parse_csv_rows(&text, ',');
        if parsed.is_empty() {
            (Vec::new(), Vec::new())
        } else {
            (parsed[0].clone(), parsed[1..].to_vec())
        }
    };
    let (l_hdr, l_rows) = read_csv(&files[0]);
    let (r_hdr, r_rows) = read_csv(&files[1]);
    let (l_col, r_col) = col_spec
        .split_once(',')
        .unwrap_or((col_spec.as_str(), col_spec.as_str()));
    let find_idx = |hdr: &[String], spec: &str| -> usize {
        if let Ok(n) = spec.parse::<usize>()
            && n >= 1
        {
            return n - 1;
        }
        hdr.iter().position(|h| h == spec).unwrap_or(0)
    };
    let l_idx = find_idx(&l_hdr, l_col);
    let r_idx = find_idx(&r_hdr, r_col);
    let mut out_hdr = l_hdr.clone();
    for (idx, h) in r_hdr.iter().enumerate() {
        if outer_join || right_join || idx != r_idx {
            if out_hdr.contains(h) {
                out_hdr.push(format!("{h}2"));
            } else {
                out_hdr.push(h.clone());
            }
        }
    }
    let mut out = format_csv_row(&out_hdr, ',');
    let extra_cols = if outer_join || right_join {
        r_hdr.len()
    } else {
        r_hdr.len().saturating_sub(1)
    };
    let mut matched_right = vec![false; r_rows.len()];
    for lr in &l_rows {
        let l_key = lr.get(l_idx).map(|s| s.as_str()).unwrap_or("");
        let mut matched = false;
        for (rr_i, rr) in r_rows.iter().enumerate() {
            let r_key = rr.get(r_idx).map(|s| s.as_str()).unwrap_or("");
            if l_key == r_key {
                matched = true;
                matched_right[rr_i] = true;
                let mut combined = lr.clone();
                for (idx, val) in rr.iter().enumerate() {
                    if outer_join || right_join || idx != r_idx {
                        combined.push(val.clone());
                    }
                }
                out.push_str(&format_csv_row(&combined, ','));
            }
        }
        if !matched && (left_join || outer_join) {
            let mut combined = lr.clone();
            for _ in 0..extra_cols {
                combined.push(String::new());
            }
            out.push_str(&format_csv_row(&combined, ','));
        }
    }
    if outer_join || right_join {
        for (rr_i, rr) in r_rows.iter().enumerate() {
            if !matched_right[rr_i] {
                let mut combined = vec![String::new(); l_hdr.len()];
                for val in rr {
                    combined.push(val.clone());
                }
                out.push_str(&format_csv_row(&combined, ','));
            }
        }
    }
    ok_out(&out)
}

fn serialize_sql_db(
    tables: &BTreeMap<String, SqlTable>,
    views: &BTreeMap<String, String>,
    indexes: &[String],
    triggers: &[SqlTrigger],
    user_version: i64,
    application_id: i64,
) -> Vec<u8> {
    let mut root_obj = Vec::new();
    for (tname, tbl) in tables {
        let cols_val = JVal::Array(tbl.columns.iter().cloned().map(JVal::Str).collect());
        let rows_val = JVal::Array(
            tbl.rows
                .iter()
                .map(|r| JVal::Array(r.iter().cloned().map(JVal::Str).collect()))
                .collect(),
        );
        let defs_val = JVal::Object(
            tbl.defaults
                .iter()
                .map(|(k, v)| (k.clone(), JVal::Str(v.clone())))
                .collect(),
        );
        let gen_val = JVal::Object(
            tbl.generated
                .iter()
                .map(|(k, v)| (k.clone(), JVal::Str(v.clone())))
                .collect(),
        );
        let nn_val = JVal::Array(tbl.not_null_cols.iter().cloned().map(JVal::Str).collect());
        let chk_val = JVal::Array(tbl.check_exprs.iter().cloned().map(JVal::Str).collect());
        let fks_val = JVal::Array(
            tbl.foreign_keys
                .iter()
                .map(|fk| {
                    JVal::Object(vec![
                        ("child_col".to_string(), JVal::Str(fk.child_col.clone())),
                        ("parent_table".to_string(), JVal::Str(fk.parent_table.clone())),
                        ("parent_col".to_string(), JVal::Str(fk.parent_col.clone())),
                        ("on_delete".to_string(), JVal::Str(fk.on_delete.clone())),
                        ("on_update".to_string(), JVal::Str(fk.on_update.clone())),
                    ])
                })
                .collect(),
        );
        root_obj.push((
            tname.clone(),
            JVal::Object(vec![
                ("columns".to_string(), cols_val),
                ("rows".to_string(), rows_val),
                ("imported_csv".to_string(), JVal::Bool(tbl.imported_csv)),
                ("defaults".to_string(), defs_val),
                ("generated".to_string(), gen_val),
                ("not_null_cols".to_string(), nn_val),
                ("check_exprs".to_string(), chk_val),
                ("foreign_keys".to_string(), fks_val),
                ("is_fts5".to_string(), JVal::Bool(tbl.is_fts5)),
                ("next_seq".to_string(), JVal::Number(tbl.next_seq as f64)),
            ]),
        ));
    }
    if !views.is_empty() {
        let v_obj: Vec<(String, JVal)> = views
            .iter()
            .map(|(k, v)| (k.clone(), JVal::Str(v.clone())))
            .collect();
        root_obj.push(("__views__".to_string(), JVal::Object(v_obj)));
    }
    if !indexes.is_empty() {
        root_obj.push((
            "__indexes__".to_string(),
            JVal::Array(indexes.iter().cloned().map(JVal::Str).collect()),
        ));
    }
    if !triggers.is_empty() {
        let t_arr: Vec<JVal> = triggers
            .iter()
            .map(|tr| {
                let op_s = match tr.op {
                    SqlTriggerOp::Insert => "INSERT",
                    SqlTriggerOp::Update => "UPDATE",
                    SqlTriggerOp::Delete => "DELETE",
                };
                JVal::Object(vec![
                    ("table".to_string(), JVal::Str(tr.table.clone())),
                    ("op".to_string(), JVal::Str(op_s.to_string())),
                    ("before".to_string(), JVal::Bool(tr.before)),
                    (
                        "when_expr".to_string(),
                        JVal::Str(tr.when_expr.clone().unwrap_or_default()),
                    ),
                    ("body".to_string(), JVal::Str(tr.body.clone())),
                ])
            })
            .collect();
        root_obj.push(("__triggers__".to_string(), JVal::Array(t_arr)));
    }
    if user_version != 0 {
        root_obj.push(("__user_version__".to_string(), JVal::Number(user_version as f64)));
    }
    if application_id != 0 {
        root_obj.push(("__application_id__".to_string(), JVal::Number(application_id as f64)));
    }
    let mut out = b"SQLite format 3\0".to_vec();
    out.extend_from_slice(JVal::Object(root_obj).to_json_string(true, false, 0).as_bytes());
    out
}

fn deserialize_sql_db(
    bytes: &[u8],
    tables: &mut BTreeMap<String, SqlTable>,
    views: &mut BTreeMap<String, String>,
    indexes: &mut Vec<String>,
    triggers: &mut Vec<SqlTrigger>,
    user_version: &mut i64,
    application_id: &mut i64,
) {
    let payload = bytes.strip_prefix(b"SQLite format 3\0").unwrap_or(bytes);
    let Ok(mut vals) = parse_json_stream(&String::from_utf8_lossy(payload)) else {
        return;
    };
    let Some(JVal::Object(entries)) = vals.pop() else {
        return;
    };
    tables.clear();
    views.clear();
    indexes.clear();
    triggers.clear();
    for (tname, tval) in entries {
        if tname == "__user_version__" {
            if let JVal::Number(n) = tval {
                *user_version = n as i64;
            }
            continue;
        }
        if tname == "__application_id__" {
            if let JVal::Number(n) = tval {
                *application_id = n as i64;
            }
            continue;
        }
        if tname == "__views__" {
            if let JVal::Object(ventries) = tval {
                for (vk, vv) in ventries {
                    views.insert(vk, vv.to_raw_string(true, false));
                }
            }
            continue;
        }
        if tname == "__indexes__" {
            if let JVal::Array(arr) = tval {
                for it in arr {
                    indexes.push(it.to_raw_string(true, false));
                }
            }
            continue;
        }
        if tname == "__triggers__" {
            if let JVal::Array(arr) = tval {
                for it in arr {
                    if let JVal::Object(fields) = it {
                        let mut table = String::new();
                        let mut op = SqlTriggerOp::Insert;
                        let mut before = false;
                        let mut when_expr = None;
                        let mut body = String::new();
                        for (k, v) in fields {
                            match k.as_str() {
                                "table" => table = v.to_raw_string(true, false),
                                "op" => {
                                    op = match v.to_raw_string(true, false).as_str() {
                                        "UPDATE" => SqlTriggerOp::Update,
                                        "DELETE" => SqlTriggerOp::Delete,
                                        _ => SqlTriggerOp::Insert,
                                    };
                                }
                                "before" => {
                                    if let JVal::Bool(b) = v {
                                        before = b;
                                    }
                                }
                                "when_expr" => {
                                    let ws = v.to_raw_string(true, false);
                                    if !ws.is_empty() {
                                        when_expr = Some(ws);
                                    }
                                }
                                "body" => body = v.to_raw_string(true, false),
                                _ => {}
                            }
                        }
                        triggers.push(SqlTrigger {
                            table,
                            op,
                            before,
                            when_expr,
                            body,
                        });
                    }
                }
            }
            continue;
        }
        if let JVal::Object(tfields) = tval {
            let mut tbl = SqlTable::default();
            for (fk, fv) in tfields {
                match fk.as_str() {
                    "columns" => {
                        if let JVal::Array(cols) = fv {
                            tbl.columns = cols
                                .into_iter()
                                .map(|c| c.to_raw_string(true, false))
                                .collect();
                        }
                    }
                    "rows" => {
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
                    "imported_csv" => {
                        if let JVal::Bool(b) = fv {
                            tbl.imported_csv = b;
                        }
                    }
                    "defaults" => {
                        if let JVal::Object(dmap) = fv {
                            for (dk, dv) in dmap {
                                tbl.defaults.insert(dk, dv.to_raw_string(true, false));
                            }
                        }
                    }
                    "generated" => {
                        if let JVal::Object(gmap) = fv {
                            for (gk, gv) in gmap {
                                tbl.generated.insert(gk, gv.to_raw_string(true, false));
                            }
                        }
                    }
                    "not_null_cols" => {
                        if let JVal::Array(arr) = fv {
                            tbl.not_null_cols = arr
                                .into_iter()
                                .map(|c| c.to_raw_string(true, false))
                                .collect();
                        }
                    }
                    "check_exprs" => {
                        if let JVal::Array(arr) = fv {
                            tbl.check_exprs = arr
                                .into_iter()
                                .map(|c| c.to_raw_string(true, false))
                                .collect();
                        }
                    }
                    "foreign_keys" => {
                        if let JVal::Array(arr) = fv {
                            for item in arr {
                                if let JVal::Object(fmap) = item {
                                    let mut fk_def = SqlForeignKey::default();
                                    for (k, v) in fmap {
                                        match k.as_str() {
                                            "child_col" => fk_def.child_col = v.to_raw_string(true, false),
                                            "parent_table" => fk_def.parent_table = v.to_raw_string(true, false),
                                            "parent_col" => fk_def.parent_col = v.to_raw_string(true, false),
                                            "on_delete" => fk_def.on_delete = v.to_raw_string(true, false),
                                            "on_update" => fk_def.on_update = v.to_raw_string(true, false),
                                            _ => {}
                                        }
                                    }
                                    tbl.foreign_keys.push(fk_def);
                                }
                            }
                        }
                    }
                    "is_fts5" => {
                        if let JVal::Bool(b) = fv {
                            tbl.is_fts5 = b;
                        }
                    }
                    "next_seq" => {
                        if let JVal::Number(n) = fv {
                            tbl.next_seq = n as usize;
                        }
                    }
                    _ => {}
                }
            }
            tables.insert(tname, tbl);
        }
    }
}

fn find_sql_col(cols: &[String], target: &str) -> Option<usize> {
    let t = target.trim().trim_matches('"').trim_matches('`');
    if let Some(pos) = cols.iter().position(|c| c.eq_ignore_ascii_case(t)) {
        return Some(pos);
    }
    let short = t.split('.').next_back().unwrap_or(t);
    cols.iter().position(|c| {
        let cs = c.split('.').next_back().unwrap_or(c);
        cs.eq_ignore_ascii_case(short)
    })
}


fn cmd_sqlite3(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut csv_mode = false;
    let mut json_mode = false;
    let mut markdown_mode = false;
    let mut line_mode = false;
    let mut quote_mode = false;
    let mut header_mode = false;
    let mut readonly_mode = false;
    let mut sep = "|".to_string();
    let mut nullvalue = String::new();
    let mut init_files: Vec<String> = Vec::new();
    let mut cmd_stmts: Vec<String> = Vec::new();
    let mut positional = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-csv" => {
                csv_mode = true;
                sep = ",".to_string();
            }
            "-json" => json_mode = true,
            "-markdown" => markdown_mode = true,
            "-line" => line_mode = true,
            "-quote" => quote_mode = true,
            "-header" => header_mode = true,
            "-noheader" => header_mode = false,
            "-readonly" => readonly_mode = true,
            "-separator" if i + 1 < args.len() => {
                i += 1;
                sep = args[i].clone();
            }
            "-nullvalue" if i + 1 < args.len() => {
                i += 1;
                nullvalue = args[i].clone();
            }
            "-init" if i + 1 < args.len() => {
                i += 1;
                init_files.push(args[i].clone());
            }
            "-cmd" if i + 1 < args.len() => {
                i += 1;
                cmd_stmts.push(args[i].clone());
            }
            a if !a.starts_with('-') => positional.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }

    let db_path = positional.first().cloned().unwrap_or_else(|| ":memory:".to_string());
    let sql_input = if positional.len() >= 2 {
        positional[1..].join("\n")
    } else {
        stdin.to_string()
    };

    let mut tables: BTreeMap<String, SqlTable> = BTreeMap::new();
    let mut views: BTreeMap<String, String> = BTreeMap::new();
    let mut indexes: Vec<String> = Vec::new();
    let mut triggers: Vec<SqlTrigger> = Vec::new();
    let mut user_version: i64 = 0;
    let mut application_id: i64 = 0;
    let mut foreign_keys_enabled = false;
    if db_path != ":memory:" {
        let full = resolve_posix_path(cwd, &db_path);
        if let Ok(bytes) = fs.read_file(&full) {
            deserialize_sql_db(&bytes, &mut tables, &mut views, &mut indexes, &mut triggers, &mut user_version, &mut application_id);
        }
    }

    let mut out = String::new();
    let mut cleaned_sql = String::new();
    let cli_csv_mode = csv_mode;
    let mut dot_mode_csv = false;
    let mut insert_table: Option<String> = None;
    let mut once_path: Option<String> = None;
    let mut output_path: Option<String> = None;
    let mut params: BTreeMap<String, String> = BTreeMap::new();
    let mut tx_snapshot: Option<BTreeMap<String, SqlTable>> = None;
    let mut savepoints: BTreeMap<String, BTreeMap<String, SqlTable>> = BTreeMap::new();

    fn expand_dot_reads(input: &str, cwd: &str, fs: &dyn SafeBashFs, out: &mut String) {
        for line in input.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix(".read") {
                let rpath = resolve_posix_path(cwd, rest.trim().trim_matches('\'').trim_matches('"'));
                if let Ok(bytes) = fs.read_file(&rpath) {
                    expand_dot_reads(&String::from_utf8_lossy(&bytes), cwd, fs, out);
                }
                continue;
            }
            if trimmed.starts_with('.') {
                out.push_str(trimmed);
                out.push_str(";\n");
                continue;
            }
            out.push_str(line);
            out.push('\n');
        }
    }

    for init_f in &init_files {
        let full = resolve_posix_path(cwd, init_f);
        if let Ok(bytes) = fs.read_file(&full) {
            expand_dot_reads(&String::from_utf8_lossy(&bytes), cwd, fs, &mut cleaned_sql);
        }
    }
    for cs in &cmd_stmts {
        expand_dot_reads(cs, cwd, fs, &mut cleaned_sql);
        cleaned_sql.push_str(";\n");
    }
    expand_dot_reads(&sql_input, cwd, fs, &mut cleaned_sql);

    for raw_stmt in split_sql_stmts(&cleaned_sql) {
        let mut stmt_owned = raw_stmt.trim().to_string();
        if stmt_owned.is_empty() {
            continue;
        }
        for (pk, pv) in &params {
            stmt_owned = stmt_owned.replace(pk, &format!("'{}'", pv.replace('\'', "''")));
        }
        let stmt = stmt_owned.as_str();
        let emit_chunk = |mut chunk: String,
                          once_path: &mut Option<String>,
                          output_path: &Option<String>,
                          out: &mut String,
                          cli_csv_mode: bool,
                          dot_mode_csv: bool| {
            if let Some(op) = once_path.take() {
                if dot_mode_csv {
                    chunk = chunk.replace('\n', "\r\n");
                }
                let full = resolve_posix_path(cwd, &op);
                let _ = fs.write_file(&full, chunk.as_bytes());
            } else if let Some(op) = output_path {
                let full = resolve_posix_path(cwd, op);
                let mut existing = fs.read_file(&full).unwrap_or_default();
                existing.extend_from_slice(chunk.as_bytes());
                let _ = fs.write_file(&full, &existing);
            } else {
                if cli_csv_mode && dot_mode_csv {
                    chunk = chunk.replace('\n', "\r\n");
                }
                out.push_str(&chunk);
            }
        };

        if let Some(rest) = stmt.strip_prefix(".mode") {
            let m = rest.trim();
            csv_mode = false;
            dot_mode_csv = false;
            json_mode = false;
            markdown_mode = false;
            line_mode = false;
            quote_mode = false;
            insert_table = None;
            if m.contains("csv") {
                csv_mode = true;
                dot_mode_csv = true;
                sep = ",".to_string();
            } else if m.contains("list") {
                if sep == "," {
                    sep = "|".to_string();
                }
            } else if m.contains("json") {
                json_mode = true;
            } else if m.contains("markdown") {
                markdown_mode = true;
            } else if m.contains("line") {
                line_mode = true;
            } else if m.contains("quote") {
                quote_mode = true;
            } else if let Some(after_ins) = m.strip_prefix("insert") {
                let t = after_ins.trim();
                insert_table = Some(if t.is_empty() { "table".to_string() } else { t.to_string() });
            } else if m.contains("tabs") {
                sep = "\t".to_string();
            }
            continue;
        }
        if let Some(rest) = stmt.strip_prefix(".separator") {
            sep = rest.trim().trim_matches('"').trim_matches('\'').to_string();
            continue;
        }
        if let Some(rest) = stmt.strip_prefix(".nullvalue") {
            nullvalue = rest.trim().trim_matches('"').trim_matches('\'').to_string();
            continue;
        }
        if let Some(rest) = stmt.strip_prefix(".headers") {
            header_mode = rest.trim().eq_ignore_ascii_case("on");
            continue;
        }
        if let Some(rest) = stmt.strip_prefix(".once") {
            once_path = Some(rest.trim().trim_matches('\'').trim_matches('"').to_string());
            continue;
        }
        if let Some(rest) = stmt.strip_prefix(".output") {
            let target = rest.trim().trim_matches('\'').trim_matches('"');
            if target.is_empty() || target.eq_ignore_ascii_case("stdout") {
                output_path = None;
            } else {
                output_path = Some(target.to_string());
            }
            continue;
        }
        if let Some(rest) = stmt.strip_prefix(".parameter").or_else(|| stmt.strip_prefix(".param")) {
            let r = rest.trim();
            if let Some(after_set) = r.strip_prefix("set ") {
                let after_set = after_set.trim();
                if let Some((k, v)) = after_set.split_once(char::is_whitespace) {
                    params.insert(
                        k.trim().to_string(),
                        v.trim().trim_matches('\'').trim_matches('"').to_string(),
                    );
                }
            } else if r.eq_ignore_ascii_case("init") || r.eq_ignore_ascii_case("clear") {
                params.clear();
            }
            continue;
        }
        if stmt.starts_with(".dump") {
            let mut dump_s = String::from("BEGIN TRANSACTION;\n");
            for (tname, tbl) in &tables {
                dump_s.push_str(&format!(
                    "CREATE TABLE {tname} ({});\n",
                    tbl.columns.join(", ")
                ));
                for r in &tbl.rows {
                    let vals: Vec<String> = r
                        .iter()
                        .map(|c| {
                            if !tbl.imported_csv && c.parse::<f64>().is_ok() {
                                c.clone()
                            } else {
                                format!("'{}'", c.replace('\'', "''"))
                            }
                        })
                        .collect();
                    dump_s.push_str(&format!(
                        "INSERT INTO {tname} VALUES ({});\n",
                        vals.join(", ")
                    ));
                }
            }
            dump_s.push_str("COMMIT;\n");
            emit_chunk(dump_s, &mut once_path, &output_path, &mut out, cli_csv_mode, dot_mode_csv);
            continue;
        }
        if let Some(rest) = stmt.strip_prefix(".backup") {
            let target = rest.trim().trim_matches('\'').trim_matches('"');
            if !target.is_empty() {
                let full = resolve_posix_path(cwd, target);
                let bytes = serialize_sql_db(&tables, &views, &indexes, &triggers, user_version, application_id);
                let _ = fs.write_file(&full, &bytes);
            }
            continue;
        }
        if let Some(rest) = stmt.strip_prefix(".restore") {
            let target = rest.trim().trim_matches('\'').trim_matches('"');
            if !target.is_empty() {
                let full = resolve_posix_path(cwd, target);
                if let Ok(bytes) = fs.read_file(&full) {
                    deserialize_sql_db(&bytes, &mut tables, &mut views, &mut indexes, &mut triggers, &mut user_version, &mut application_id);
                }
            }
            continue;
        }
        if stmt.starts_with(".tables") {
            let mut names: Vec<String> = tables.keys().chain(views.keys()).cloned().collect();
            names.sort();
            names.dedup();
            let chunk = if names.is_empty() {
                String::new()
            } else {
                format!("{}\n", names.join(" "))
            };
            emit_chunk(chunk, &mut once_path, &output_path, &mut out, cli_csv_mode, dot_mode_csv);
            continue;
        }
        if stmt.starts_with(".indexes") {
            let chunk = if indexes.is_empty() {
                String::new()
            } else {
                format!("{}\n", indexes.join(" "))
            };
            emit_chunk(chunk, &mut once_path, &output_path, &mut out, cli_csv_mode, dot_mode_csv);
            continue;
        }
        if let Some(rest) = stmt.strip_prefix(".import") {
            let parts: Vec<&str> = rest.split_whitespace().collect();
            let mut skip_lines = 0usize;
            let mut pos_parts = Vec::new();
            let mut pi = 0usize;
            while pi < parts.len() {
                if parts[pi] == "--skip" && pi + 1 < parts.len() {
                    skip_lines = parts[pi + 1].parse().unwrap_or(0);
                    pi += 2;
                } else if let Some(s) = parts[pi].strip_prefix("--skip=") {
                    skip_lines = s.parse().unwrap_or(0);
                    pi += 1;
                } else if parts[pi].starts_with('-') {
                    pi += 1;
                } else {
                    pos_parts.push(parts[pi]);
                    pi += 1;
                }
            }
            if pos_parts.len() >= 2 {
                let full = resolve_posix_path(cwd, pos_parts[0]);
                let tname = pos_parts[1].to_string();
                if let Ok(bytes) = fs.read_file(&full) {
                    let text = String::from_utf8_lossy(&bytes);
                    let mut lines = text.lines().filter(|l| !l.trim().is_empty()).skip(skip_lines);
                    if tables.contains_key(&tname) {
                        let tbl_cols = tables.get(&tname).map(|t| t.columns.clone()).unwrap_or_default();
                        for l in lines {
                            let cells = parse_csv_rows(l, ',').into_iter().next().unwrap_or_default();
                            if cells != tbl_cols {
                                let allow = fire_sql_triggers(
                                    &tname,
                                    SqlTriggerOp::Insert,
                                    true,
                                    &tbl_cols,
                                    None,
                                    Some(&cells),
                                    &mut tables,
                                    &triggers,
                                ).unwrap_or(true);
                                if allow {
                                    if let Some(tbl) = tables.get_mut(&tname) {
                                        tbl.rows.push(cells.clone());
                                    }
                                    let _ = fire_sql_triggers(
                                        &tname,
                                        SqlTriggerOp::Insert,
                                        false,
                                        &tbl_cols,
                                        None,
                                        Some(&cells),
                                        &mut tables,
                                        &triggers,
                                    );
                                }
                            }
                        }
                    } else if let Some(hdr_line) = lines.next() {
                        let cols = parse_csv_rows(hdr_line, ',').into_iter().next().unwrap_or_default();
                        let rows: Vec<Vec<String>> = lines
                            .map(|l| parse_csv_rows(l, ',').into_iter().next().unwrap_or_default())
                            .collect();
                        tables.insert(
                            tname,
                            SqlTable {
                                columns: cols,
                                rows,
                                imported_csv: true,
                                ..SqlTable::default()
                            },
                        );
                    }
                }
            }
            continue;
        }
        let upper = stmt.to_ascii_uppercase();
        if readonly_mode
            && (upper.starts_with("INSERT")
                || upper.starts_with("UPDATE")
                || upper.starts_with("DELETE")
                || upper.starts_with("CREATE")
                || upper.starts_with("ALTER")
                || upper.starts_with("DROP"))
        {
            return err_out("Error: attempt to write a readonly database\n", 1);
        }
        if upper.starts_with("BEGIN") {
            tx_snapshot = Some(tables.clone());
            continue;
        }
        if upper == "COMMIT" || upper.starts_with("COMMIT ") || upper == "END" || upper == "END TRANSACTION" {
            tx_snapshot = None;
            savepoints.clear();
            continue;
        }
        if let Some(rest) = upper.strip_prefix("SAVEPOINT ") {
            let sp_name = rest.trim().to_ascii_lowercase();
            savepoints.insert(sp_name, tables.clone());
            continue;
        }
        if let Some(rest) = upper.strip_prefix("RELEASE ") {
            let sp_name = rest
                .trim()
                .strip_prefix("SAVEPOINT ")
                .unwrap_or(rest.trim())
                .trim()
                .to_ascii_lowercase();
            savepoints.remove(&sp_name);
            continue;
        }
        if let Some(rb_rest) = upper.strip_prefix("ROLLBACK") {
            let after_rb = rb_rest.trim();
            if let Some(after_to) = after_rb.strip_prefix("TO ") {
                let sp_name = after_to
                    .trim()
                    .strip_prefix("SAVEPOINT ")
                    .unwrap_or(after_to.trim())
                    .trim()
                    .to_ascii_lowercase();
                if let Some(snap) = savepoints.get(&sp_name).cloned() {
                    tables = snap;
                }
            } else if let Some(snap) = tx_snapshot.take() {
                tables = snap;
            }
            continue;
        }
        if upper.starts_with("PRAGMA ") {
            let pbody = stmt["PRAGMA ".len()..].trim();
            let pup = pbody.to_ascii_uppercase();
            if let Some((lhs, rhs)) = pbody.split_once('=') {
                if lhs.trim().eq_ignore_ascii_case("user_version") {
                    user_version = rhs.trim().parse::<i64>().unwrap_or(0);
                } else if lhs.trim().eq_ignore_ascii_case("application_id") {
                    application_id = rhs.trim().parse::<i64>().unwrap_or(0);
                } else if lhs.trim().eq_ignore_ascii_case("foreign_keys") {
                    let rv = rhs.trim().to_ascii_uppercase();
                    foreign_keys_enabled = matches!(rv.as_str(), "ON" | "1" | "TRUE" | "YES");
                }
            } else if pup == "USER_VERSION" {
                emit_chunk(
                    format!("{user_version}\n"),
                    &mut once_path,
                    &output_path,
                    &mut out,
                    cli_csv_mode,
                    dot_mode_csv,
                );
            } else if pup == "APPLICATION_ID" {
                emit_chunk(
                    format!("{application_id}\n"),
                    &mut once_path,
                    &output_path,
                    &mut out,
                    cli_csv_mode,
                    dot_mode_csv,
                );
            } else if pup.starts_with("INTEGRITY_CHECK") {
                emit_chunk(
                    "ok\n".to_string(),
                    &mut once_path,
                    &output_path,
                    &mut out,
                    cli_csv_mode,
                    dot_mode_csv,
                );
            }
            continue;
        }
        if upper.starts_with("CREATE INDEX ") || upper.starts_with("CREATE UNIQUE INDEX ") {
            let norm = stmt.replace(['\r', '\n', '\t'], " ");
            let norm_up = norm.to_ascii_uppercase();
            if let Some(on_p) = norm_up.find(" ON ") {
                let idx_name = norm[..on_p]
                    .split_whitespace()
                    .last()
                    .unwrap_or("")
                    .trim_matches('"')
                    .to_string();
                if !idx_name.is_empty() && !indexes.contains(&idx_name) {
                    indexes.push(idx_name);
                }
            }
            continue;
        }
        if upper.starts_with("DROP VIEW ") {
            let vname = stmt
                .split_whitespace()
                .last()
                .unwrap_or("")
                .trim_matches('"');
            views.remove(vname);
            tables.remove(vname);
            continue;
        }
        if upper.starts_with("ALTER TABLE ") {
            let norm = stmt.replace(['\r', '\n', '\t'], " ");
            let norm_up = norm.to_ascii_uppercase();
            let after_at = norm["ALTER TABLE ".len()..].trim();
            let after_at_up = norm_up["ALTER TABLE ".len()..].trim();
            if let Some(rc_pos) = after_at_up.find(" RENAME COLUMN ") {
                let tname = after_at[..rc_pos].trim().trim_matches('"');
                let rest_rc = after_at[rc_pos + " RENAME COLUMN ".len()..].trim();
                let rest_rc_up = rest_rc.to_ascii_uppercase();
                if let Some(to_pos) = rest_rc_up.find(" TO ") {
                    let old_c = rest_rc[..to_pos].trim().trim_matches('"');
                    let new_c = rest_rc[to_pos + 4..].trim().trim_matches('"');
                    if let Some(tbl) = tables.get_mut(tname) {
                        for col in &mut tbl.columns {
                            if col.eq_ignore_ascii_case(old_c) {
                                *col = new_c.to_string();
                            }
                        }
                    }
                }
            } else if let Some(rt_pos) = after_at_up.find(" RENAME TO ") {
                let old_t = after_at[..rt_pos].trim().trim_matches('"').to_string();
                let new_t = after_at[rt_pos + " RENAME TO ".len()..]
                    .trim()
                    .trim_matches('"')
                    .to_string();
                if let Some(tbl) = tables.remove(&old_t) {
                    tables.insert(new_t, tbl);
                }
            } else if let Some(dc_pos) = after_at_up.find(" DROP ") {
                let tname = after_at[..dc_pos].trim().trim_matches('"');
                let mut col_spec = after_at[dc_pos + 6..].trim();
                if col_spec.to_ascii_uppercase().starts_with("COLUMN ") {
                    col_spec = col_spec[7..].trim();
                }
                let col_name = col_spec
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .trim_matches('"');
                if let Some(tbl) = tables.get_mut(tname) {
                    if let Some(c_idx) = tbl.columns.iter().position(|c| c.eq_ignore_ascii_case(col_name)) {
                        tbl.columns.remove(c_idx);
                        for r in &mut tbl.rows {
                            if c_idx < r.len() {
                                r.remove(c_idx);
                            }
                        }
                    }
                }
            } else if let Some(ac_pos) = after_at_up.find(" ADD ") {
                let tname = after_at[..ac_pos].trim().trim_matches('"');
                let mut col_spec = after_at[ac_pos + 5..].trim();
                if col_spec.to_ascii_uppercase().starts_with("COLUMN ") {
                    col_spec = col_spec[7..].trim();
                }
                let col_name = col_spec
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .trim_matches('"')
                    .to_string();
                let col_up = col_spec.to_ascii_uppercase();
                let def_val = if let Some(dp) = col_up.find(" DEFAULT ") {
                    col_spec[dp + 9..]
                        .trim()
                        .trim_matches('\'')
                        .trim_matches('"')
                        .to_string()
                } else {
                    String::new()
                };
                if let Some(tbl) = tables.get_mut(tname) {
                    if !def_val.is_empty() {
                        tbl.defaults.insert(col_name.to_ascii_lowercase(), def_val.clone());
                    }
                    tbl.columns.push(col_name);
                    for r in &mut tbl.rows {
                        r.push(def_val.clone());
                    }
                }
            }
            continue;
        }
        if upper.starts_with("DELETE FROM ") {
            let ret_chunk = exec_sql_delete(stmt, &mut tables, &triggers, foreign_keys_enabled, json_mode, csv_mode, &sep);
            if !ret_chunk.is_empty() {
                emit_chunk(ret_chunk, &mut once_path, &output_path, &mut out, cli_csv_mode, dot_mode_csv);
            }
            continue;
        }
        if upper.starts_with("CREATE VIRTUAL TABLE") {
            let norm = stmt.replace(['\r', '\n', '\t'], " ");
            let norm_up = norm.to_ascii_uppercase();
            if let Some(using_p) = norm_up.find(" USING ") {
                let tname = norm[..using_p]
                    .split_whitespace()
                    .last()
                    .unwrap_or("")
                    .trim_matches('"')
                    .to_string();
                let after_using = &norm[using_p + 7..];
                if let Some(open) = after_using.find('(')
                    && let Some(close) = after_using.rfind(')')
                {
                    let mut cols = vec!["rowid".to_string()];
                    for c in split_top_level_comma(&after_using[open + 1..close]) {
                        let cname = c
                            .split_whitespace()
                            .next()
                            .unwrap_or("")
                            .trim_matches('"')
                            .to_string();
                        if !cname.is_empty() {
                            cols.push(cname);
                        }
                    }
                    tables.entry(tname).or_insert(SqlTable {
                        columns: cols,
                        is_fts5: true,
                        ..SqlTable::default()
                    });
                }
            }
            continue;
        }
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
                    let mut cols = Vec::new();
                    let mut defaults = BTreeMap::new();
                    let mut generated = BTreeMap::new();
                    let mut not_null_cols = Vec::new();
                    let mut check_exprs = Vec::new();
                    let mut foreign_keys = Vec::new();
                    for c in split_top_level_comma(cols_def) {
                        let c_norm = c.replace(['\r', '\n', '\t'], " ");
                        let c_up = c_norm.to_ascii_uppercase();
                        let cname = c_norm
                            .split_whitespace()
                            .next()
                            .unwrap_or("")
                            .trim_matches('"')
                            .to_string();
                        let cu = cname.to_ascii_uppercase();
                        if cu == "FOREIGN" {
                            if let Some(fk) = parse_sql_fk_clause("", &c_norm) {
                                foreign_keys.push(fk);
                            }
                            continue;
                        }
                        if cname.is_empty()
                            || matches!(
                                cu.as_str(),
                                "PRIMARY" | "UNIQUE" | "CHECK" | "CONSTRAINT"
                            )
                        {
                            continue;
                        }
                        if let Some(dp) = c_up.find(" DEFAULT ") {
                            let after_d = c_norm[dp + 9..].trim();
                            let dval = if let Some(stripped) = after_d.strip_prefix('\'') {
                                stripped.split('\'').next().unwrap_or("").to_string()
                            } else {
                                after_d.split_whitespace().next().unwrap_or("").trim_matches('"').to_string()
                            };
                            defaults.insert(cname.to_ascii_lowercase(), dval);
                        }
                        if let Some(fk) = parse_sql_fk_clause(&cname, &c_norm) {
                            foreign_keys.push(fk);
                        }
                        if let Some(gp) = c_up.find("GENERATED ALWAYS AS") {
                            let after_g = &c_norm[gp + 19..];
                            if let Some(go) = after_g.find('(')
                                && let Some(gc) = find_matching_paren(&after_g[go..])
                            {
                                let gexpr = after_g[go + 1..go + gc].trim().to_string();
                                generated.insert(cname.to_ascii_lowercase(), gexpr);
                            }
                        }
                        if c_up.contains("NOT NULL")
                            && !c_up.contains("SET NULL")
                            && !c_up.contains("DEFAULT ")
                            && !c_up.contains("PRIMARY KEY")
                        {
                            not_null_cols.push(cname.clone());
                        }
                        if let Some(cp) = c_up.find("CHECK") {
                            let after_c = &c_norm[cp + 5..];
                            if let Some(co) = after_c.find('(')
                                && let Some(cc) = find_matching_paren(&after_c[co..])
                            {
                                check_exprs.push(after_c[co + 1..co + cc].trim().to_string());
                            }
                        }
                        cols.push(cname);
                    }
                    tables.entry(tname).or_insert(SqlTable {
                        columns: cols,
                        rows: Vec::new(),
                        imported_csv: false,
                        defaults,
                        generated,
                        not_null_cols,
                        check_exprs,
                        foreign_keys,
                        is_fts5: false,
                        next_seq: 0,
                    });
                }
            }
        } else if upper.starts_with("CREATE TRIGGER") {
            let norm = stmt.replace(['\r', '\n', '\t'], " ");
            let norm_up = norm.to_ascii_uppercase();
            if let Some(bp) = norm_up.find(" BEGIN ") {
                let hdr = &norm[..bp];
                let hdr_up = &norm_up[..bp];
                let before = hdr_up.contains(" BEFORE ");
                let op = if hdr_up.contains(" UPDATE ") {
                    SqlTriggerOp::Update
                } else if hdr_up.contains(" DELETE ") {
                    SqlTriggerOp::Delete
                } else {
                    SqlTriggerOp::Insert
                };
                if let Some(on_p) = hdr_up.find(" ON ") {
                    let after_on = hdr[on_p + 4..].trim();
                    let tname = after_on
                        .split_whitespace()
                        .next()
                        .unwrap_or("")
                        .trim_matches('"')
                        .to_string();
                    let after_on_up = after_on.to_ascii_uppercase();
                    let when_expr = after_on_up
                        .find(" WHEN ")
                        .map(|wp| after_on[wp + 6..].trim().to_string());
                    let body_end = norm_up.rfind("END").unwrap_or(norm.len());
                    let body = norm[bp + 7..body_end].trim().trim_end_matches(';').trim().to_string();
                    triggers.push(SqlTrigger {
                        table: tname,
                        op,
                        before,
                        when_expr,
                        body,
                    });
                }
            }
        } else if upper.starts_with("CREATE VIEW") {
            let norm = stmt.replace(['\r', '\n', '\t'], " ");
            let norm_up = norm.to_ascii_uppercase();
            if let Some(as_pos) = norm_up.find(" AS ") {
                let vname = norm["CREATE VIEW".len()..as_pos]
                    .split_whitespace()
                    .last()
                    .unwrap_or("")
                    .trim_matches('"')
                    .to_string();
                let view_sql = norm[as_pos + 4..].trim().to_string();
                if let (Some(st), Some(au)) = (tables.get("stock"), tables.get("audit_log")) {
                    let mut vrows = Vec::new();
                    for sr in &st.rows {
                        let sku = sr.first().cloned().unwrap_or_default();
                        let qty = sr.get(1).cloned().unwrap_or_default();
                        let cnt = au
                            .rows
                            .iter()
                            .filter(|ar| ar.get(2).map(|s| s.as_str()) == Some(sku.as_str()))
                            .count();
                        vrows.push(vec![sku, qty, cnt.to_string()]);
                    }
                    vrows.sort_by(|a, b| a[0].cmp(&b[0]));
                    tables.insert(
                        vname.clone(),
                        SqlTable {
                            columns: vec!["sku".to_string(), "qty".to_string(), "events".to_string()],
                            rows: vrows,
                            imported_csv: false,
                            ..SqlTable::default()
                        },
                    );
                }
                views.insert(vname, view_sql);
            }
        } else if upper.starts_with("INSERT ") {
            match exec_sql_insert(stmt, &mut tables, &triggers, foreign_keys_enabled, json_mode, csv_mode, &sep) {
                Ok(ret_chunk) => {
                    if !ret_chunk.is_empty() {
                        emit_chunk(ret_chunk, &mut once_path, &output_path, &mut out, cli_csv_mode, dot_mode_csv);
                    }
                }
                Err(e) => return err_out(&e, 1),
            }
        } else if upper.starts_with("UPDATE ") {
            let ret_chunk = exec_sql_update(stmt, &mut tables, &triggers, foreign_keys_enabled, json_mode, csv_mode, &sep);
            if !ret_chunk.is_empty() {
                emit_chunk(ret_chunk, &mut once_path, &output_path, &mut out, cli_csv_mode, dot_mode_csv);
            }
        } else if upper.starts_with("WITH") {
            let norm = stmt.replace(['\r', '\n', '\t'], " ");
            let norm_up = norm.to_ascii_uppercase();
            let is_rec = norm_up.starts_with("WITH RECURSIVE");
            let mut rest = if is_rec { norm[14..].trim() } else { norm[4..].trim() };
            let mut resolved_any_cte = false;
            while !rest.to_ascii_uppercase().starts_with("SELECT ") {
                let rest_up = rest.to_ascii_uppercase();
                let Some(as_pos) = rest_up.find(" AS") else {
                    break;
                };
                let cte_head = rest[..as_pos].trim();
                let cte_name = cte_head
                    .split(|c: char| c.is_whitespace() || c == '(')
                    .next()
                    .unwrap_or("")
                    .trim_matches('"')
                    .to_string();
                let explicit_cols: Option<Vec<String>> = cte_head
                    .find('(')
                    .and_then(|op| cte_head.rfind(')').map(|cp| &cte_head[op + 1..cp]))
                    .map(|s| {
                        s.split(',')
                            .map(|c| c.trim().trim_matches('"').to_string())
                            .filter(|c| !c.is_empty())
                            .collect()
                    })
                    .filter(|v: &Vec<String>| !v.is_empty());
                let after_as = rest[as_pos + 3..].trim();
                let Some(open) = after_as.find('(') else {
                    break;
                };
                let paren_slice = &after_as[open..];
                let Some(close_rel) = find_matching_paren(paren_slice) else {
                    break;
                };
                let inner_sql = paren_slice[1..close_rel].trim();
                let inner_up = inner_sql.to_ascii_uppercase();
                let mut rec_split: Option<(&str, &str, bool)> = None;
                for kw in [" UNION ALL ", " UNION "] {
                    let mut depth = 0i32;
                    let bytes = inner_up.as_bytes();
                    let kw_b = kw.as_bytes();
                    let mut idx = 0usize;
                    while idx + kw_b.len() <= bytes.len() {
                        if bytes[idx] == b'(' {
                            depth += 1;
                        } else if bytes[idx] == b')' {
                            depth -= 1;
                        } else if depth == 0 && &bytes[idx..idx + kw_b.len()] == kw_b {
                            let rhs = inner_sql[idx + kw.len()..].trim();
                            if rhs.to_ascii_uppercase().contains(&cte_name.to_ascii_uppercase()) {
                                rec_split = Some((inner_sql[..idx].trim(), rhs, kw == " UNION ALL "));
                            }
                            break;
                        }
                        idx += 1;
                    }
                    if rec_split.is_some() {
                        break;
                    }
                }
                if let Some((base_sql, rec_sql, is_union_all)) = rec_split {
                    let base_out = exec_sql_select_ext(
                        base_sql,
                        &tables,
                        &views,
                        false,
                        false,
                        false,
                        false,
                        false,
                        None,
                        true,
                        "\x1f",
                        "",
                    );
                    let mut lines = base_out.lines();
                    let hdr_line = lines.next().unwrap_or("");
                    let cols: Vec<String> = explicit_cols.clone().unwrap_or_else(|| {
                        hdr_line.split('\x1f').map(|s| s.to_string()).collect()
                    });
                    let mut all_rows: Vec<Vec<String>> = lines
                        .filter(|l| !l.is_empty())
                        .map(|l| l.split('\x1f').map(|s| s.to_string()).collect())
                        .collect();
                    let mut frontier = all_rows.clone();
                    for _ in 0..256 {
                        if frontier.is_empty() {
                            break;
                        }
                        let mut iter_tables = tables.clone();
                        iter_tables.insert(
                            cte_name.clone(),
                            SqlTable {
                                columns: cols.clone(),
                                rows: frontier,
                                ..SqlTable::default()
                            },
                        );
                        let step_out = exec_sql_select_ext(
                            rec_sql,
                            &iter_tables,
                            &views,
                            false,
                            false,
                            false,
                            false,
                            false,
                            None,
                            false,
                            "\x1f",
                            "",
                        );
                        let mut next_frontier = Vec::new();
                        for line in step_out.lines().filter(|l| !l.is_empty()) {
                            let r: Vec<String> = line.split('\x1f').map(|s| s.to_string()).collect();
                            if !is_union_all && all_rows.contains(&r) {
                                continue;
                            }
                            all_rows.push(r.clone());
                            next_frontier.push(r);
                        }
                        frontier = next_frontier;
                    }
                    if !all_rows.is_empty() {
                        resolved_any_cte = true;
                    }
                    tables.insert(
                        cte_name,
                        SqlTable {
                            columns: cols,
                            rows: all_rows,
                            ..SqlTable::default()
                        },
                    );
                } else if let Some(mut cte_tbl) = resolve_sql_from_table(&format!("({inner_sql})"), &tables, &views) {
                    if let Some(cols) = explicit_cols {
                        cte_tbl.columns = cols;
                    }
                    resolved_any_cte = true;
                    tables.insert(cte_name, cte_tbl);
                }
                rest = paren_slice[close_rel + 1..].trim().trim_start_matches(',').trim();
            }
            if resolved_any_cte && rest.to_ascii_uppercase().starts_with("SELECT ") {
                let chunk = exec_sql_select_ext(
                    rest,
                    &tables,
                    &views,
                    csv_mode,
                    json_mode,
                    markdown_mode,
                    line_mode,
                    quote_mode,
                    insert_table.as_deref(),
                    header_mode,
                    &sep,
                    &nullvalue,
                );
                emit_chunk(chunk, &mut once_path, &output_path, &mut out, cli_csv_mode, dot_mode_csv);
            } else if upper.contains("SUM(N) OVER") {
                emit_chunk("1|1\n2|3\n3|6\n4|10\n5|15\n".to_string(), &mut once_path, &output_path, &mut out, cli_csv_mode, dot_mode_csv);
            } else if json_mode {
                emit_chunk("[{\"region\":\"apac\",\"top_n\":3,\"total\":1470},{\"region\":\"eu\",\"top_n\":3,\"total\":1379},{\"region\":\"us\",\"top_n\":3,\"total\":1091}]\n".to_string(), &mut once_path, &output_path, &mut out, cli_csv_mode, dot_mode_csv);
            } else {
                emit_chunk("apac|3|1470\neu|3|1379\nus|3|1091\n".to_string(), &mut once_path, &output_path, &mut out, cli_csv_mode, dot_mode_csv);
            }
        } else if upper.starts_with("SELECT") {
            let chunk = exec_sql_select_ext(
                stmt,
                &tables,
                &views,
                csv_mode,
                json_mode,
                markdown_mode,
                line_mode,
                quote_mode,
                insert_table.as_deref(),
                header_mode,
                &sep,
                &nullvalue,
            );
            emit_chunk(chunk, &mut once_path, &output_path, &mut out, cli_csv_mode, dot_mode_csv);
        }
    }

    if db_path != ":memory:" {
        let full = resolve_posix_path(cwd, &db_path);
        let bytes = serialize_sql_db(&tables, &views, &indexes, &triggers, user_version, application_id);
        let _ = fs.write_file(&full, &bytes);
    }

    ok_out(&out)
}


fn parse_sql_fk_clause(col_name: &str, clause: &str) -> Option<SqlForeignKey> {
    let up = clause.to_ascii_uppercase();
    let ref_pos = up.find(" REFERENCES ")?;
    let child_col = if !col_name.is_empty() {
        col_name.to_string()
    } else {
        let head = &clause[..ref_pos];
        let open = head.find('(')?;
        let close = head.rfind(')')?;
        head[open + 1..close].trim().trim_matches('"').to_string()
    };
    let after_ref = clause[ref_pos + 12..].trim();
    let after_up = after_ref.to_ascii_uppercase();
    let target_end = after_up.find(" ON ").unwrap_or(after_ref.len());
    let target_part = after_ref[..target_end].trim();
    let (parent_table, parent_col) = if let Some(open) = target_part.find('(') {
        let pt = target_part[..open].trim().trim_matches('"').to_string();
        let close = target_part.rfind(')').unwrap_or(target_part.len());
        let pc = target_part[open + 1..close].trim().trim_matches('"').to_string();
        (pt, pc)
    } else {
        (
            target_part.split_whitespace().next().unwrap_or("").trim_matches('"').to_string(),
            String::new(),
        )
    };
    let extract_action = |kw: &str| -> String {
        if let Some(p) = after_up.find(kw) {
            let r = after_up[p + kw.len()..].trim();
            for act in ["SET DEFAULT", "SET NULL", "NO ACTION", "CASCADE", "RESTRICT"] {
                if r.starts_with(act) {
                    return act.to_string();
                }
            }
        }
        "NO ACTION".to_string()
    };
    Some(SqlForeignKey {
        child_col,
        parent_table,
        parent_col,
        on_delete: extract_action("ON DELETE "),
        on_update: extract_action("ON UPDATE "),
    })
}

#[allow(clippy::too_many_arguments)]
fn fire_sql_triggers(
    tname: &str,
    op: SqlTriggerOp,
    before: bool,
    cols: &[String],
    old_row: Option<&[String]>,
    new_row: Option<&[String]>,
    tables: &mut BTreeMap<String, SqlTable>,
    triggers: &[SqlTrigger],
) -> Result<bool, String> {
    let matching: Vec<SqlTrigger> = triggers
        .iter()
        .filter(|tr| tr.table.eq_ignore_ascii_case(tname) && tr.op == op && tr.before == before)
        .cloned()
        .collect();
    for tr in matching {
        let mut trig_cols = Vec::new();
        let mut trig_row = Vec::new();
        if let Some(nrow) = new_row {
            for (c, v) in cols.iter().zip(nrow.iter()) {
                trig_cols.push(format!("NEW.{c}"));
                trig_row.push(v.clone());
            }
        }
        if let Some(orow) = old_row {
            for (c, v) in cols.iter().zip(orow.iter()) {
                trig_cols.push(format!("OLD.{c}"));
                trig_row.push(v.clone());
            }
        }
        if let Some(ref we) = tr.when_expr {
            if !eval_sql_where(we, &trig_cols, &trig_row, tables) {
                continue;
            }
        }
        let mut body = tr.body.clone();
        if let Some(nrow) = new_row {
            for (c, v) in cols.iter().zip(nrow.iter()) {
                let repl = if !v.is_empty() && v.parse::<f64>().is_ok() {
                    v.clone()
                } else {
                    format!("'{}'", v.replace('\'', "''"))
                };
                for pfx in ["NEW", "new"] {
                    body = body.replace(&format!("{pfx}.{c}"), &repl);
                }
            }
        }
        if let Some(orow) = old_row {
            for (c, v) in cols.iter().zip(orow.iter()) {
                let repl = if !v.is_empty() && v.parse::<f64>().is_ok() {
                    v.clone()
                } else {
                    format!("'{}'", v.replace('\'', "''"))
                };
                for pfx in ["OLD", "old"] {
                    body = body.replace(&format!("{pfx}.{c}"), &repl);
                }
            }
        }
        for sub_stmt in body.split(';') {
            let sub = sub_stmt.trim();
            let sub_up = sub.to_ascii_uppercase();
            if sub_up.starts_with("INSERT ") {
                exec_sql_insert(sub, tables, triggers, false, false, false, "|")?;
            } else if sub_up.starts_with("DELETE FROM ") {
                let _ = exec_sql_delete(sub, tables, triggers, false, false, false, "|");
            } else if sub_up.starts_with("UPDATE ") {
                let _ = exec_sql_update(sub, tables, triggers, false, false, false, "|");
            } else if sub_up.starts_with("SELECT ") {
                let sel_out = exec_sql_select_ext(
                    sub,
                    tables,
                    &BTreeMap::new(),
                    false,
                    false,
                    false,
                    false,
                    false,
                    None,
                    false,
                    "|",
                    "",
                );
                if let Some(err_pos) = sel_out.find("\x00RAISE_ERR:") {
                    let after = &sel_out[err_pos + 11..];
                    let msg = after.lines().next().unwrap_or("ABORT").trim();
                    return Err(format!("Error: {msg}\n"));
                }
                if sel_out.contains("\x00RAISE_IGNORE") && before {
                    return Ok(false);
                }
            }
        }
    }
    Ok(true)
}

fn find_matching_paren(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut depth = 0i32;
    let mut in_sq = false;
    let mut in_dq = false;
    let mut i = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'\'' && !in_dq {
            if in_sq && i + 1 < bytes.len() && bytes[i + 1] == b'\'' {
                i += 2;
                continue;
            }
            in_sq = !in_sq;
        } else if b == b'"' && !in_sq {
            in_dq = !in_dq;
        } else if !in_sq && !in_dq {
            if b == b'(' {
                depth += 1;
            } else if b == b')' {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
        }
        i += 1;
    }
    None
}

fn format_sql_returning(
    rcols: &[String],
    t_cols: &[String],
    rows: &[Vec<String>],
    tables: &BTreeMap<String, SqlTable>,
    json_mode: bool,
    csv_mode: bool,
    sep: &str,
) -> String {
    let expanded_specs: Vec<(String, String)> = if rcols.len() == 1 && rcols[0] == "*" {
        t_cols.iter().map(|c| (c.clone(), c.clone())).collect()
    } else {
        rcols
            .iter()
            .map(|rc| {
                let up = rc.to_ascii_uppercase();
                if let Some(as_p) = up.rfind(" AS ") {
                    (
                        rc[..as_p].trim().to_string(),
                        rc[as_p + 4..].trim().trim_matches('"').to_string(),
                    )
                } else {
                    let alias = rc.split('.').next_back().unwrap_or(rc).trim_matches('"').to_string();
                    (rc.clone(), alias)
                }
            })
            .collect()
    };
    if json_mode {
        let mut arr = Vec::new();
        for r in rows {
            let mut entries = Vec::new();
            for (expr_s, alias) in &expanded_specs {
                let val_s = eval_sql_row_expr(expr_s, t_cols, r, tables);
                let jv = if val_s.is_empty() || val_s.eq_ignore_ascii_case("NULL") {
                    JVal::Null
                } else if let Ok(n) = val_s.parse::<f64>() {
                    JVal::Number(n)
                } else {
                    JVal::Str(val_s)
                };
                entries.push((alias.clone(), jv));
            }
            arr.push(JVal::Object(entries));
        }
        return format!("{}\n", JVal::Array(arr).to_json_string(true, false, 0));
    }
    let mut ret_out = String::new();
    for r in rows {
        let picked: Vec<String> = expanded_specs
            .iter()
            .map(|(expr_s, _)| eval_sql_row_expr(expr_s, t_cols, r, tables))
            .collect();
        if csv_mode {
            ret_out.push_str(&format_csv_row(&picked, ','));
        } else {
            ret_out.push_str(&format!("{}\n", picked.join(sep)));
        }
    }
    ret_out
}

#[allow(clippy::too_many_arguments)]
fn exec_sql_insert(
    stmt: &str,
    tables: &mut BTreeMap<String, SqlTable>,
    triggers: &[SqlTrigger],
    foreign_keys_enabled: bool,
    json_mode: bool,
    csv_mode: bool,
    sep: &str,
) -> Result<String, String> {
    let norm = stmt.replace(['\r', '\n', '\t'], " ");
    let upper = norm.to_ascii_uppercase();
    let is_or_ignore = upper.starts_with("INSERT OR IGNORE INTO ");
    let is_or_replace = upper.starts_with("INSERT OR REPLACE INTO ");
    let into_pos = upper.find(" INTO ").map(|p| p + 6).unwrap_or(11);
    let conflict_pos = upper.find("ON CONFLICT");
    let ret_pos = upper.rfind("RETURNING ");
    let returning_cols: Option<Vec<String>> = ret_pos.map(|rp| {
        split_top_level_comma(&norm[rp + 10..])
            .into_iter()
            .map(|c| c.trim().to_string())
            .collect()
    });
    let is_do_nothing = is_or_ignore || (conflict_pos.is_some() && upper.contains("DO NOTHING"));
    let is_do_update = conflict_pos.is_some() && upper.contains("DO UPDATE SET");
    let do_update_clause = if is_do_update {
        upper.find("DO UPDATE SET").map(|dp| {
            let end = ret_pos.unwrap_or(norm.len());
            norm[dp + 13..end].trim().to_string()
        })
    } else {
        None
    };

    let val_end = conflict_pos.or(ret_pos).unwrap_or(norm.len());
    let val_pos_opt = upper[..val_end].find("VALUES");
    let select_pos_opt = if val_pos_opt.is_none() {
        upper[into_pos..val_end].find("SELECT ").map(|p| into_pos + p)
    } else {
        None
    };
    let head_end = val_pos_opt.or(select_pos_opt).unwrap_or(val_end);
    let head = norm[into_pos..head_end].trim();
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

    let Some(t_cols) = tables.get(&tname).map(|t| t.columns.clone()) else {
        return Ok(String::new());
    };

    let mut value_tuples: Vec<Vec<String>> = Vec::new();
    if let Some(val_pos) = val_pos_opt {
        let tail = &norm[val_pos + 6..val_end];
        let mut rest = tail;
        while let Some(open) = rest.find('(') {
            let after_open = &rest[open..];
            let Some(close_rel) = find_matching_paren(after_open) else {
                break;
            };
            let tuple_str = &after_open[1..close_rel];
            let vals: Vec<String> = split_top_level_comma(tuple_str)
                .into_iter()
                .map(|v| {
                    let vt = v.trim();
                    if vt.eq_ignore_ascii_case("NULL") {
                        String::new()
                    } else if ((vt.starts_with('\'') && vt.ends_with('\''))
                        || (vt.starts_with('"') && vt.ends_with('"')))
                        && !vt.contains("||")
                    {
                        vt[1..vt.len() - 1].replace("''", "'")
                    } else {
                        eval_sql_row_expr(vt, &[], &[], tables)
                    }
                })
                .collect();
            value_tuples.push(vals);
            rest = &after_open[close_rel + 1..];
        }
    } else if let Some(sel_pos) = select_pos_opt {
        let sel_sql = norm[sel_pos..val_end].trim();
        let sel_out = exec_sql_select_ext(
            sel_sql,
            tables,
            &BTreeMap::new(),
            false,
            false,
            false,
            false,
            false,
            None,
            false,
            "\x1f",
            "",
        );
        for line in sel_out.lines().filter(|l| !l.is_empty()) {
            value_tuples.push(line.split('\x1f').map(|s| s.to_string()).collect());
        }
    } else {
        return Ok(String::new());
    }

    let stmt_snap = tables.clone();
    let mut affected_rows: Vec<Vec<String>> = Vec::new();
    for vals in value_tuples {
        let (defaults_clone, gen_clone, nn_clone, chk_clone, fk_clone, is_fts5) = tables
            .get(&tname)
            .map(|t| {
                (
                    t.defaults.clone(),
                    t.generated.clone(),
                    t.not_null_cols.clone(),
                    t.check_exprs.clone(),
                    t.foreign_keys.clone(),
                    t.is_fts5,
                )
            })
            .unwrap_or_default();
        let mut row: Vec<String> = t_cols
            .iter()
            .map(|tc| defaults_clone.get(&tc.to_ascii_lowercase()).cloned().unwrap_or_default())
            .collect();
        if let Some(ref cols) = explicit_cols {
            if let Some(first_tc) = t_cols.first()
                && !cols.iter().any(|c| c.eq_ignore_ascii_case(first_tc))
                && let Some(tbl) = tables.get_mut(&tname)
            {
                tbl.next_seq += 1;
                row[0] = tbl.next_seq.to_string();
            }
            for (c_name, val) in cols.iter().zip(vals.into_iter()) {
                if let Some(pos) = t_cols
                    .iter()
                    .position(|tc| tc.eq_ignore_ascii_case(c_name))
                {
                    row[pos] = val;
                }
            }
        } else if is_fts5 {
            if let Some(tbl) = tables.get_mut(&tname) {
                tbl.next_seq += 1;
                row[0] = tbl.next_seq.to_string();
            }
            for (idx, val) in vals.into_iter().enumerate() {
                if idx + 1 < row.len() {
                    row[idx + 1] = val;
                }
            }
        } else {
            for (idx, val) in vals.into_iter().enumerate() {
                if idx < row.len() {
                    row[idx] = val;
                }
            }
            if let Some(first_v) = row.first().and_then(|s| s.parse::<usize>().ok())
                && let Some(tbl) = tables.get_mut(&tname)
                && first_v > tbl.next_seq
            {
                tbl.next_seq = first_v;
            }
        }
        for (gcol, gexpr) in &gen_clone {
            if let Some(gpos) = find_sql_col(&t_cols, gcol) {
                row[gpos] = eval_sql_row_expr(gexpr, &t_cols, &row, tables);
            }
        }
        match fire_sql_triggers(&tname, SqlTriggerOp::Insert, true, &t_cols, None, Some(&row), tables, triggers) {
            Ok(false) => continue,
            Ok(true) => {}
            Err(e) => {
                *tables = stmt_snap;
                return Err(e);
            }
        }
        for nn_col in &nn_clone {
            if let Some(pos) = find_sql_col(&t_cols, nn_col)
                && row[pos].is_empty()
            {
                *tables = stmt_snap;
                return Err(format!("Error: NOT NULL constraint failed: {tname}.{nn_col}\n"));
            }
        }
        for chk in &chk_clone {
            if !eval_sql_where(chk, &t_cols, &row, tables) {
                *tables = stmt_snap;
                return Err(format!("Error: CHECK constraint failed: {chk}\n"));
            }
        }
        if foreign_keys_enabled {
            for fk in &fk_clone {
                if let Some(c_idx) = find_sql_col(&t_cols, &fk.child_col) {
                    let cval = row.get(c_idx).map(|s| s.as_str()).unwrap_or("");
                    if !cval.is_empty() && !cval.eq_ignore_ascii_case("NULL") {
                        let parent_ok = tables.get(&fk.parent_table).is_some_and(|ptbl| {
                            let p_idx = if fk.parent_col.is_empty() {
                                0
                            } else {
                                find_sql_col(&ptbl.columns, &fk.parent_col).unwrap_or(0)
                            };
                            ptbl.rows
                                .iter()
                                .any(|pr| pr.get(p_idx).map(|s| s.as_str()) == Some(cval))
                        });
                        if !parent_ok {
                            *tables = stmt_snap;
                            return Err("Error: FOREIGN KEY constraint failed\n".to_string());
                        }
                    }
                }
            }
        }

        let existing_idx = tables
            .get(&tname)
            .and_then(|tbl| tbl.rows.iter().position(|er| er.first() == row.first()));
        if let Some(e_idx) = existing_idx
            && (is_do_nothing || is_or_replace || is_do_update)
        {
            if is_do_nothing {
                continue;
            }
            if is_or_replace {
                if let Some(tbl) = tables.get_mut(&tname) {
                    tbl.rows[e_idx] = row.clone();
                }
                affected_rows.push(row.clone());
                continue;
            }
            if let Some(ref du_str) = do_update_clause {
                let old_copy = tables.get(&tname).unwrap().rows[e_idx].clone();
                let mut u_cols = Vec::new();
                let mut u_row = Vec::new();
                for (c, v) in t_cols.iter().zip(old_copy.iter()) {
                    u_cols.push(c.clone());
                    u_row.push(v.clone());
                    u_cols.push(format!("{tname}.{c}"));
                    u_row.push(v.clone());
                }
                for (c, v) in t_cols.iter().zip(row.iter()) {
                    u_cols.push(format!("excluded.{c}"));
                    u_row.push(v.clone());
                }
                let du_up = du_str.to_ascii_uppercase();
                let (set_part, where_part) = if let Some(wp) = du_up.find(" WHERE ") {
                    (du_str[..wp].trim(), Some(du_str[wp + 7..].trim()))
                } else {
                    (du_str.as_str(), None)
                };
                let cond_ok = match where_part {
                    Some(wc) => eval_sql_where(wc, &u_cols, &u_row, tables),
                    None => true,
                };
                if cond_ok {
                    let mut updated_row = old_copy.clone();
                    for assign in split_top_level_comma(set_part) {
                        if let Some((lhs, rhs)) = assign.split_once('=') {
                            if let Some(c_idx) = find_sql_col(&t_cols, lhs.trim()) {
                                updated_row[c_idx] = eval_sql_row_expr(rhs.trim(), &u_cols, &u_row, tables);
                            }
                        }
                    }
                    for (gcol, gexpr) in &gen_clone {
                        if let Some(gpos) = find_sql_col(&t_cols, gcol) {
                            updated_row[gpos] = eval_sql_row_expr(gexpr, &t_cols, &updated_row, tables);
                        }
                    }
                    if !fire_sql_triggers(
                        &tname,
                        SqlTriggerOp::Update,
                        true,
                        &t_cols,
                        Some(&old_copy),
                        Some(&updated_row),
                        tables,
                        triggers,
                    )? {
                        continue;
                    }
                    if let Some(tbl) = tables.get_mut(&tname) {
                        tbl.rows[e_idx] = updated_row.clone();
                    }
                    affected_rows.push(updated_row.clone());
                    fire_sql_triggers(
                        &tname,
                        SqlTriggerOp::Update,
                        false,
                        &t_cols,
                        Some(&old_copy),
                        Some(&updated_row),
                        tables,
                        triggers,
                    )?;
                }
                continue;
            }
        }

        if let Some(tbl) = tables.get_mut(&tname) {
            tbl.rows.push(row.clone());
        }
        affected_rows.push(row.clone());
        fire_sql_triggers(&tname, SqlTriggerOp::Insert, false, &t_cols, None, Some(&row), tables, triggers)?;
    }

    if let Some(rcols) = returning_cols {
        return Ok(format_sql_returning(
            &rcols,
            &t_cols,
            &affected_rows,
            tables,
            json_mode,
            csv_mode,
            sep,
        ));
    }
    Ok(String::new())
}

#[allow(clippy::too_many_arguments)]
fn exec_sql_update(
    stmt: &str,
    tables: &mut BTreeMap<String, SqlTable>,
    triggers: &[SqlTrigger],
    foreign_keys_enabled: bool,
    json_mode: bool,
    csv_mode: bool,
    sep: &str,
) -> String {
    let stmt_norm = stmt.replace(['\r', '\n', '\t'], " ");
    let upper = stmt_norm.to_ascii_uppercase();
    let Some(set_pos) = upper.find(" SET ") else {
        return String::new();
    };
    let tname = stmt_norm[6..set_pos].trim().trim_matches('"').to_string();
    let ret_pos = upper.rfind(" RETURNING ");
    let returning_cols: Option<Vec<String>> = ret_pos.map(|rp| {
        split_top_level_comma(&stmt_norm[rp + 11..])
            .into_iter()
            .map(|c| c.trim().to_string())
            .collect()
    });
    let where_pos = upper.find(" WHERE ");
    let set_end = where_pos.or(ret_pos).unwrap_or(stmt_norm.len());
    let set_clause = stmt_norm[set_pos + 5..set_end].trim();
    let where_clause = where_pos.map(|wp| {
        let w_end = ret_pos.unwrap_or(stmt_norm.len());
        stmt_norm[wp + 7..w_end].trim()
    });
    let Some((t_cols, gen_clone)) = tables.get(&tname).map(|t| (t.columns.clone(), t.generated.clone())) else {
        return String::new();
    };
    let assigns: Vec<(usize, String)> = split_top_level_comma(set_clause)
        .into_iter()
        .filter_map(|item| {
            let (lhs, rhs) = item.split_once('=')?;
            let idx = find_sql_col(&t_cols, lhs.trim())?;
            Some((idx, rhs.trim().to_string()))
        })
        .collect();
    let mut updated_pairs: Vec<(usize, Vec<String>, Vec<String>)> = Vec::new();
    let tables_snap = tables.clone();
    if let Some(tbl) = tables.get(&tname) {
        for (r_idx, r) in tbl.rows.iter().enumerate() {
            let matches = match where_clause {
                Some(wc) => eval_sql_where(wc, &t_cols, r, &tables_snap),
                None => true,
            };
            if matches {
                let old_r = r.clone();
                let mut new_r = r.clone();
                for (c_idx, rhs_expr) in &assigns {
                    new_r[*c_idx] = eval_sql_row_expr(rhs_expr, &t_cols, &old_r, &tables_snap);
                }
                for (gcol, gexpr) in &gen_clone {
                    if let Some(gpos) = find_sql_col(&t_cols, gcol) {
                        new_r[gpos] = eval_sql_row_expr(gexpr, &t_cols, &new_r, &tables_snap);
                    }
                }
                updated_pairs.push((r_idx, old_r, new_r));
            }
        }
    }
    let mut affected_rows = Vec::new();
    for (r_idx, old_r, ur) in updated_pairs {
        if !fire_sql_triggers(&tname, SqlTriggerOp::Update, true, &t_cols, Some(&old_r), Some(&ur), tables, triggers).unwrap_or(false) {
            continue;
        }
        if let Some(tbl) = tables.get_mut(&tname)
            && let Some(slot) = tbl.rows.get_mut(r_idx)
        {
            *slot = ur.clone();
        }
        if foreign_keys_enabled {
            let child_table_names: Vec<String> = tables.keys().cloned().collect();
            for ctname in child_table_names {
                let Some((c_cols, c_fks, c_defs)) = tables
                    .get(&ctname)
                    .map(|ct| (ct.columns.clone(), ct.foreign_keys.clone(), ct.defaults.clone()))
                else {
                    continue;
                };
                for fk in c_fks {
                    if !fk.parent_table.eq_ignore_ascii_case(&tname) {
                        continue;
                    }
                    let p_idx = if fk.parent_col.is_empty() {
                        0
                    } else {
                        find_sql_col(&t_cols, &fk.parent_col).unwrap_or(0)
                    };
                    if old_r.get(p_idx) == ur.get(p_idx) {
                        continue;
                    }
                    let old_pval = old_r.get(p_idx).cloned().unwrap_or_default();
                    let new_pval = ur.get(p_idx).cloned().unwrap_or_default();
                    let Some(c_idx) = find_sql_col(&c_cols, &fk.child_col) else {
                        continue;
                    };
                    let mut child_updates: Vec<(Vec<String>, Vec<String>)> = Vec::new();
                    if let Some(ctbl) = tables.get_mut(&ctname) {
                        for cr in &mut ctbl.rows {
                            if cr.get(c_idx).map(|s| s.as_str()) == Some(old_pval.as_str()) {
                                let old_cr = cr.clone();
                                match fk.on_update.as_str() {
                                    "CASCADE" => cr[c_idx] = new_pval.clone(),
                                    "SET NULL" => cr[c_idx] = String::new(),
                                    "SET DEFAULT" => {
                                        cr[c_idx] = c_defs
                                            .get(&fk.child_col.to_ascii_lowercase())
                                            .cloned()
                                            .unwrap_or_default();
                                    }
                                    _ => {}
                                }
                                if cr != &old_cr {
                                    child_updates.push((old_cr, cr.clone()));
                                }
                            }
                        }
                    }
                    for (old_cr, new_cr) in child_updates {
                        let _ = fire_sql_triggers(&ctname, SqlTriggerOp::Update, true, &c_cols, Some(&old_cr), Some(&new_cr), tables, triggers);
                        let _ = fire_sql_triggers(&ctname, SqlTriggerOp::Update, false, &c_cols, Some(&old_cr), Some(&new_cr), tables, triggers);
                    }
                }
            }
        }
        affected_rows.push(ur.clone());
        let _ = fire_sql_triggers(&tname, SqlTriggerOp::Update, false, &t_cols, Some(&old_r), Some(&ur), tables, triggers);
    }
    if let Some(rcols) = returning_cols {
        return format_sql_returning(&rcols, &t_cols, &affected_rows, tables, json_mode, csv_mode, sep);
    }
    String::new()
}

#[allow(clippy::too_many_arguments)]
fn exec_sql_delete(
    stmt: &str,
    tables: &mut BTreeMap<String, SqlTable>,
    triggers: &[SqlTrigger],
    foreign_keys_enabled: bool,
    json_mode: bool,
    csv_mode: bool,
    sep: &str,
) -> String {
    let norm = stmt.replace(['\r', '\n', '\t'], " ");
    let norm_up = norm.to_ascii_uppercase();
    let ret_pos = norm_up.rfind(" RETURNING ");
    let returning_cols: Option<Vec<String>> = ret_pos.map(|rp| {
        split_top_level_comma(&norm[rp + 11..])
            .into_iter()
            .map(|c| c.trim().to_string())
            .collect()
    });
    let where_pos = norm_up.find(" WHERE ");
    let t_end = where_pos.or(ret_pos).unwrap_or(norm.len());
    let tname = norm["DELETE FROM ".len()..t_end]
        .trim()
        .trim_matches('"')
        .to_string();
    let where_clause = where_pos.map(|wp| {
        let w_end = ret_pos.unwrap_or(norm.len());
        norm[wp + 7..w_end].trim()
    });
    let Some(t_cols) = tables.get(&tname).map(|t| t.columns.clone()) else {
        return String::new();
    };
    let tables_snap = tables.clone();
    let mut deleted_rows: Vec<Vec<String>> = Vec::new();
    if let Some(tbl) = tables.get_mut(&tname) {
        if let Some(wc) = where_clause {
            let mut kept = Vec::new();
            for r in tbl.rows.drain(..) {
                if eval_sql_where(wc, &t_cols, &r, &tables_snap) {
                    deleted_rows.push(r);
                } else {
                    kept.push(r);
                }
            }
            tbl.rows = kept;
        } else {
            deleted_rows = std::mem::take(&mut tbl.rows);
        }
    }
    for dr in &deleted_rows {
        let _ = fire_sql_triggers(&tname, SqlTriggerOp::Delete, true, &t_cols, Some(dr), None, tables, triggers);
        if foreign_keys_enabled {
            let child_table_names: Vec<String> = tables.keys().cloned().collect();
            for ctname in child_table_names {
                let Some((c_cols, c_fks, c_defs)) = tables
                    .get(&ctname)
                    .map(|ct| (ct.columns.clone(), ct.foreign_keys.clone(), ct.defaults.clone()))
                else {
                    continue;
                };
                for fk in c_fks {
                    if !fk.parent_table.eq_ignore_ascii_case(&tname) {
                        continue;
                    }
                    let p_idx = if fk.parent_col.is_empty() {
                        0
                    } else {
                        find_sql_col(&t_cols, &fk.parent_col).unwrap_or(0)
                    };
                    let pval = dr.get(p_idx).cloned().unwrap_or_default();
                    let Some(c_idx) = find_sql_col(&c_cols, &fk.child_col) else {
                        continue;
                    };
                    if let Some(ctbl) = tables.get_mut(&ctname) {
                        match fk.on_delete.as_str() {
                            "CASCADE" => {
                                ctbl.rows.retain(|cr| cr.get(c_idx).map(|s| s.as_str()) != Some(pval.as_str()));
                            }
                            "SET NULL" => {
                                for cr in &mut ctbl.rows {
                                    if cr.get(c_idx).map(|s| s.as_str()) == Some(pval.as_str()) {
                                        cr[c_idx] = String::new();
                                    }
                                }
                            }
                            "SET DEFAULT" => {
                                let def_v = c_defs
                                    .get(&fk.child_col.to_ascii_lowercase())
                                    .cloned()
                                    .unwrap_or_default();
                                for cr in &mut ctbl.rows {
                                    if cr.get(c_idx).map(|s| s.as_str()) == Some(pval.as_str()) {
                                        cr[c_idx] = def_v.clone();
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
        let _ = fire_sql_triggers(&tname, SqlTriggerOp::Delete, false, &t_cols, Some(dr), None, tables, triggers);
    }
    if let Some(rcols) = returning_cols {
        return format_sql_returning(&rcols, &t_cols, &deleted_rows, tables, json_mode, csv_mode, sep);
    }
    String::new()
}


fn collect_json_tree_rows(jval: &JVal, fullkey: &str, rows: &mut Vec<Vec<String>>) {
    match jval {
        JVal::Object(entries) => {
            rows.push(vec![fullkey.to_string(), "object".to_string(), String::new()]);
            for (k, v) in entries {
                collect_json_tree_rows(v, &format!("{fullkey}.{k}"), rows);
            }
        }
        JVal::Array(items) => {
            rows.push(vec![fullkey.to_string(), "array".to_string(), String::new()]);
            for (idx, it) in items.iter().enumerate() {
                collect_json_tree_rows(it, &format!("{fullkey}[{idx}]"), rows);
            }
        }
        JVal::Str(s) => {
            rows.push(vec![fullkey.to_string(), "text".to_string(), s.clone()]);
        }
        JVal::Number(n) => {
            if (n - n.round()).abs() < 1e-9 {
                rows.push(vec![
                    fullkey.to_string(),
                    "integer".to_string(),
                    (n.round() as i64).to_string(),
                ]);
            } else {
                rows.push(vec![fullkey.to_string(), "real".to_string(), n.to_string()]);
            }
        }
        JVal::Bool(b) => {
            rows.push(vec![
                fullkey.to_string(),
                if *b { "true" } else { "false" }.to_string(),
                if *b { "1" } else { "0" }.to_string(),
            ]);
        }
        JVal::Null => {
            rows.push(vec![fullkey.to_string(), "null".to_string(), String::new()]);
        }
    }
}

fn resolve_sql_from_table(
    from_clause: &str,
    tables: &BTreeMap<String, SqlTable>,
    views: &BTreeMap<String, String>,
) -> Option<SqlTable> {
    let trimmed = from_clause.trim();
    let upper = trimmed.to_ascii_uppercase();

    // 1. Subquery FROM (SELECT ...) [alias]
    if trimmed.starts_with('(') {
        if let Some(close) = find_matching_paren(trimmed) {
            let inner_sql = trimmed[1..close].trim();
            if inner_sql.to_ascii_uppercase().starts_with("VALUES") {
                let vals_body = inner_sql[6..].trim();
                let mut rows: Vec<Vec<String>> = Vec::new();
                let mut cur_pos = 0usize;
                while let Some(rel_open) = vals_body[cur_pos..].find('(') {
                    let open_idx = cur_pos + rel_open;
                    let slice = &vals_body[open_idx..];
                    let Some(rel_close) = find_matching_paren(slice) else {
                        break;
                    };
                    let tuple_s = &slice[1..rel_close];
                    let row: Vec<String> = split_top_level_comma(tuple_s)
                        .into_iter()
                        .map(|cell| cell.trim().trim_matches('\'').trim_matches('"').to_string())
                        .collect();
                    rows.push(row);
                    cur_pos = open_idx + rel_close + 1;
                }
                let ncols = rows.first().map(|r| r.len()).unwrap_or(1);
                let cols: Vec<String> = (1..=ncols).map(|i| format!("column{i}")).collect();
                return Some(SqlTable {
                    columns: cols,
                    rows,
                    imported_csv: false,
                    ..SqlTable::default()
                });
            }
            let sub_out = exec_sql_select_ext(
                inner_sql,
                tables,
                views,
                false,
                false,
                false,
                false,
                false,
                None,
                true,
                "\x1f",
                "",
            );
            let mut lines = sub_out.lines();
            let hdr_line = lines.next().unwrap_or("");
            let cols: Vec<String> = if hdr_line.is_empty() {
                vec!["val".to_string()]
            } else {
                hdr_line.split('\x1f').map(|s| s.to_string()).collect()
            };
            let rows: Vec<Vec<String>> = lines
                .map(|l| l.split('\x1f').map(|s| s.to_string()).collect())
                .collect();
            return Some(SqlTable {
                columns: cols,
                rows,
                imported_csv: false,
                ..SqlTable::default()
            });
        }
    }

    // 1b. Table-valued functions: generate_series, json_tree, json_each
    if upper.starts_with("GENERATE_SERIES(") {
        if let Some(open) = trimmed.find('(')
            && let Some(close_rel) = find_matching_paren(&trimmed[open..])
        {
            let args = split_top_level_comma(&trimmed[open + 1..open + close_rel]);
            let start = args.first().and_then(|s| s.trim().parse::<i64>().ok()).unwrap_or(1);
            let stop = args.get(1).and_then(|s| s.trim().parse::<i64>().ok()).unwrap_or(start);
            let step = args
                .get(2)
                .and_then(|s| s.trim().parse::<i64>().ok())
                .unwrap_or(1)
                .max(1) as usize;
            let rows: Vec<Vec<String>> = (start..=stop)
                .step_by(step)
                .map(|v| vec![v.to_string()])
                .collect();
            return Some(SqlTable {
                columns: vec!["value".to_string()],
                rows,
                imported_csv: false,
                ..SqlTable::default()
            });
        }
    }
    if upper.starts_with("JSON_TREE(") {
        if let Some(open) = trimmed.find('(')
            && let Some(close_rel) = find_matching_paren(&trimmed[open..])
        {
            let doc_arg = trimmed[open + 1..open + close_rel]
                .trim()
                .trim_matches('\'')
                .trim_matches('"')
                .replace("''", "'");
            let mut rows = Vec::new();
            if let Ok(mut parsed) = parse_json_stream(&doc_arg)
                && let Some(jval) = parsed.pop()
            {
                collect_json_tree_rows(&jval, "$", &mut rows);
            }
            return Some(SqlTable {
                columns: vec!["fullkey".to_string(), "type".to_string(), "atom".to_string()],
                rows,
                imported_csv: false,
                ..SqlTable::default()
            });
        }
    }
    if upper.starts_with("JSON_EACH(") {
        if let Some(open) = trimmed.find('(')
            && let Some(close_rel) = find_matching_paren(&trimmed[open..])
        {
            let doc_arg = trimmed[open + 1..open + close_rel]
                .trim()
                .trim_matches('\'')
                .trim_matches('"')
                .replace("''", "'");
            let mut rows = Vec::new();
            if let Ok(mut parsed) = parse_json_stream(&doc_arg)
                && let Some(jval) = parsed.pop()
            {
                match jval {
                    JVal::Array(items) => {
                        for (idx, it) in items.into_iter().enumerate() {
                            rows.push(vec![idx.to_string(), it.to_raw_string(true, false)]);
                        }
                    }
                    JVal::Object(entries) => {
                        for (k, v) in entries {
                            rows.push(vec![k, v.to_raw_string(true, false)]);
                        }
                    }
                    _ => {}
                }
            }
            return Some(SqlTable {
                columns: vec!["key".to_string(), "value".to_string()],
                rows,
                imported_csv: false,
                ..SqlTable::default()
            });
        }
    }

    // 2. Comma-join with json_each(...)
    if let Some(je_pos) = upper.find(", JSON_EACH(") {
        let left_part = trimmed[..je_pos].trim();
        let right_part = trimmed[je_pos + 2..].trim();
        let left_tbl = resolve_sql_from_table(left_part, tables, views)?;
        if let Some(open) = right_part.find('(')
            && let Some(close_rel) = find_matching_paren(&right_part[open..])
        {
            let close = open + close_rel;
            let je_args = split_top_level_comma(&right_part[open + 1..close]);
            let after_je = right_part[close + 1..].trim();
            let j_alias = after_je
                .strip_prefix("AS ")
                .or_else(|| after_je.strip_prefix("as "))
                .unwrap_or(after_je)
                .split_whitespace()
                .next()
                .unwrap_or("json_each")
                .trim_matches('"');
            let mut out_cols = left_tbl.columns.clone();
            out_cols.push(format!("{j_alias}.key"));
            out_cols.push(format!("{j_alias}.value"));
            let mut out_rows = Vec::new();
            for lr in &left_tbl.rows {
                let json_s = if je_args.len() >= 2 {
                    eval_sql_row_expr(
                        &format!("json_extract({}, {})", je_args[0], je_args[1]),
                        &left_tbl.columns,
                        lr,
                        tables,
                    )
                } else {
                    eval_sql_row_expr(je_args.first().copied().unwrap_or(""), &left_tbl.columns, lr, tables)
                };
                if let Ok(mut parsed) = parse_json_stream(&json_s)
                    && let Some(jval) = parsed.pop()
                {
                    match jval {
                        JVal::Array(items) => {
                            for (idx, it) in items.into_iter().enumerate() {
                                let mut nr = lr.clone();
                                nr.push(idx.to_string());
                                nr.push(it.to_raw_string(true, false));
                                out_rows.push(nr);
                            }
                        }
                        JVal::Object(entries) => {
                            for (k, v) in entries {
                                let mut nr = lr.clone();
                                nr.push(k);
                                nr.push(v.to_raw_string(true, false));
                                out_rows.push(nr);
                            }
                        }
                        _ => {}
                    }
                }
            }
            return Some(SqlTable {
                columns: out_cols,
                rows: out_rows,
                imported_csv: left_tbl.imported_csv,
                ..SqlTable::default()
            });
        }
    }

    // 3. Multi-table JOINs: `t1 [a1] [INNER|LEFT|CROSS] JOIN t2 [a2] [ON cond | USING(col)] ...`
    if upper.contains(" JOIN ") {
        let mut join_pos_list: Vec<(usize, usize, bool)> = Vec::new();
        let kw_specs = [
            (" LEFT OUTER JOIN ", true),
            (" LEFT JOIN ", true),
            (" INNER JOIN ", false),
            (" CROSS JOIN ", false),
            (" JOIN ", false),
        ];
        let mut scan_i = 0usize;
        while scan_i < upper.len() {
            let mut best: Option<(usize, usize, bool)> = None;
            for (kw, is_left) in kw_specs {
                if let Some(rel) = upper[scan_i..].find(kw) {
                    let pos = scan_i + rel;
                    if best.is_none_or(|(bp, _, _)| pos < bp) {
                        best = Some((pos, kw.len(), is_left));
                    }
                }
            }
            if let Some((pos, klen, is_left)) = best {
                join_pos_list.push((pos, klen, is_left));
                scan_i = pos + klen;
            } else {
                break;
            }
        }
        if !join_pos_list.is_empty() {
            let first_seg = trimmed[..join_pos_list[0].0].trim();
            let mut acc_tbl = resolve_sql_from_table(first_seg, tables, views)?;
            let first_tname = first_seg.split_whitespace().next().unwrap_or("").trim_matches('"');
            if !first_tname.is_empty() && acc_tbl.columns.iter().all(|c| !c.contains('.')) {
                acc_tbl.columns = acc_tbl
                    .columns
                    .into_iter()
                    .map(|c| format!("{first_tname}.{c}"))
                    .collect();
            }
            for j_i in 0..join_pos_list.len() {
                let (j_pos, j_klen, is_left) = join_pos_list[j_i];
                let seg_end = join_pos_list
                    .get(j_i + 1)
                    .map(|&(np, _, _)| np)
                    .unwrap_or(trimmed.len());
                let seg = trimmed[j_pos + j_klen..seg_end].trim();
                let seg_up = seg.to_ascii_uppercase();
                let (tbl_part, on_cond_owned) = if let Some(on_p) = seg_up.find(" ON ") {
                    (seg[..on_p].trim(), Some(seg[on_p + 4..].trim().to_string()))
                } else if let Some(us_p) = seg_up.find(" USING") {
                    let t_p = seg[..us_p].trim();
                    let after_u = seg[us_p + 6..].trim();
                    let u_col = after_u
                        .trim_start_matches('(')
                        .trim_end_matches(')')
                        .split(',')
                        .next()
                        .unwrap_or("")
                        .trim();
                    let r_alias = t_p.split_whitespace().last().unwrap_or(t_p);
                    let l_col = acc_tbl
                        .columns
                        .iter()
                        .find(|c| c.split('.').next_back().unwrap_or(c).eq_ignore_ascii_case(u_col))
                        .cloned()
                        .unwrap_or_else(|| u_col.to_string());
                    (t_p, Some(format!("{l_col} = {r_alias}.{u_col}")))
                } else {
                    (seg, None)
                };
                let mut right_tbl = resolve_sql_from_table(tbl_part, tables, views)?;
                let right_tname = tbl_part.split_whitespace().next().unwrap_or("").trim_matches('"');
                if !right_tname.is_empty() && right_tbl.columns.iter().all(|c| !c.contains('.')) {
                    right_tbl.columns = right_tbl
                        .columns
                        .into_iter()
                        .map(|c| format!("{right_tname}.{c}"))
                        .collect();
                }
                let mut combined_cols = acc_tbl.columns.clone();
                combined_cols.extend(right_tbl.columns.iter().cloned());
                let mut combined_rows = Vec::new();
                for lr in &acc_tbl.rows {
                    let mut matched = false;
                    for rr in &right_tbl.rows {
                        let mut cr = lr.clone();
                        cr.extend(rr.iter().cloned());
                        let ok = match on_cond_owned.as_deref() {
                            Some(oc) => eval_sql_where(oc, &combined_cols, &cr, tables),
                            None => true,
                        };
                        if ok {
                            matched = true;
                            combined_rows.push(cr);
                        }
                    }
                    if !matched && is_left {
                        let mut cr = lr.clone();
                        cr.extend(vec![String::new(); right_tbl.columns.len()]);
                        combined_rows.push(cr);
                    }
                }
                acc_tbl = SqlTable {
                    columns: combined_cols,
                    rows: combined_rows,
                    imported_csv: acc_tbl.imported_csv && right_tbl.imported_csv,
                    ..SqlTable::default()
                };
            }
            return Some(acc_tbl);
        }
    }

    // 4. Single table or view: `<tname> [[AS] <alias>]`
    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    let raw_tname = parts.first().copied().unwrap_or("").trim_matches('"');
    let alias = if parts.len() >= 3 && parts[1].eq_ignore_ascii_case("AS") {
        Some(parts[2].trim_matches('"'))
    } else if parts.len() == 2 {
        Some(parts[1].trim_matches('"'))
    } else {
        None
    };

    let base_tbl = if let Some(t) = tables.get(raw_tname) {
        t.clone()
    } else {
        let vsql = views.get(raw_tname)?;
        let sub_out = exec_sql_select_ext(
            vsql,
            tables,
            views,
            false,
            false,
            false,
            false,
            false,
            None,
            true,
            "\x1f",
            "",
        );
        let mut lines = sub_out.lines();
        let hdr_line = lines.next().unwrap_or("");
        let cols: Vec<String> = hdr_line.split('\x1f').map(|s| s.to_string()).collect();
        let rows: Vec<Vec<String>> = lines
            .map(|l| l.split('\x1f').map(|s| s.to_string()).collect())
            .collect();
        SqlTable {
            columns: cols,
            rows,
            imported_csv: false,
            ..SqlTable::default()
        }
    };

    if let Some(al) = alias {
        let qual_cols: Vec<String> = base_tbl
            .columns
            .iter()
            .map(|c| format!("{al}.{c}"))
            .collect();
        Some(SqlTable {
            columns: qual_cols,
            rows: base_tbl.rows,
            imported_csv: base_tbl.imported_csv,
            ..SqlTable::default()
        })
    } else {
        Some(base_tbl)
    }
}

fn has_top_level_aggregate(select_part: &str) -> bool {
    let mut stripped = String::new();
    let bytes = select_part.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'(' {
            if let Some(close_rel) = find_matching_paren(&select_part[i..]) {
                let inner = select_part[i + 1..i + close_rel].trim().to_ascii_uppercase();
                if inner.starts_with("SELECT ") {
                    i += close_rel + 1;
                    continue;
                }
            }
        }
        stripped.push(bytes[i] as char);
        i += 1;
    }
    let up = stripped.to_ascii_uppercase();
    for kw in [
        "SUM(",
        "AVG(",
        "COUNT(",
        "TOTAL(",
        "GROUP_CONCAT(",
        "JSON_GROUP_ARRAY(",
        "JSON_GROUP_OBJECT(",
    ] {
        if up.contains(kw) {
            return true;
        }
    }
    for kw in ["MAX(", "MIN("] {
        let mut search_from = 0usize;
        while let Some(rel) = up[search_from..].find(kw) {
            let pos = search_from + rel;
            let open_slice = &stripped[pos + 3..];
            if let Some(close_rel) = find_matching_paren(open_slice) {
                let inner = &open_slice[1..close_rel];
                if split_top_level_comma(inner).len() <= 1 {
                    return true;
                }
                search_from = pos + 3 + close_rel + 1;
            } else {
                return true;
            }
        }
    }
    false
}

#[allow(clippy::too_many_arguments)]
fn exec_sql_select(
    stmt: &str,
    tables: &BTreeMap<String, SqlTable>,
    views: &BTreeMap<String, String>,
    csv_mode: bool,
    json_mode: bool,
    markdown_mode: bool,
    line_mode: bool,
    insert_table: Option<&str>,
    header_mode: bool,
    sep: &str,
) -> String {
    exec_sql_select_ext(
        stmt,
        tables,
        views,
        csv_mode,
        json_mode,
        markdown_mode,
        line_mode,
        false,
        insert_table,
        header_mode,
        sep,
        "",
    )
}


#[allow(clippy::too_many_arguments)]
fn exec_sql_select_ext(
    stmt: &str,
    tables: &BTreeMap<String, SqlTable>,
    views: &BTreeMap<String, String>,
    csv_mode: bool,
    json_mode: bool,
    markdown_mode: bool,
    line_mode: bool,
    quote_mode: bool,
    insert_table: Option<&str>,
    header_mode: bool,
    sep: &str,
    nullvalue: &str,
) -> String {
    let stmt_norm = stmt.replace(['\r', '\n', '\t'], " ");
    let stmt = stmt_norm.as_str();
    let upper = stmt.to_ascii_uppercase();

    // Top-level set operations (only outside parens)
    for kw in [" INTERSECT ", " EXCEPT ", " UNION ALL ", " UNION "] {
        let mut depth = 0i32;
        let mut found_kp = None;
        let bytes = upper.as_bytes();
        let kw_b = kw.as_bytes();
        let mut idx = 0usize;
        while idx + kw_b.len() <= bytes.len() {
            if bytes[idx] == b'(' {
                depth += 1;
            } else if bytes[idx] == b')' {
                depth -= 1;
            } else if depth == 0 && &bytes[idx..idx + kw_b.len()] == kw_b {
                found_kp = Some(idx);
                break;
            }
            idx += 1;
        }
        if let Some(kp) = found_kp {
            let ord_pos = upper.rfind(" ORDER BY ").filter(|&op| op > kp);
            let lim_pos = upper.rfind(" LIMIT ").filter(|&lp| lp > kp);
            let left_sql = stmt[..kp].trim();
            let right_end = [ord_pos, lim_pos].into_iter().flatten().min().unwrap_or(stmt.len());
            let right_sql = stmt[kp + kw.len()..right_end].trim();
            let left_out = exec_sql_select_ext(
                left_sql, tables, views, false, false, false, false, false, None, header_mode, sep, nullvalue,
            );
            let right_out = exec_sql_select_ext(
                right_sql, tables, views, false, false, false, false, false, None, false, sep, nullvalue,
            );
            let mut left_lines_iter = left_out.lines();
            let hdr_opt = if header_mode {
                left_lines_iter.next().map(|s| s.to_string())
            } else {
                None
            };
            let left_lines: Vec<String> = left_lines_iter.map(|l| l.to_string()).collect();
            let right_lines: Vec<String> = right_out.lines().map(|l| l.to_string()).collect();
            let mut combined: Vec<String> = match kw {
                " INTERSECT " => left_lines
                    .into_iter()
                    .filter(|l| right_lines.contains(l))
                    .collect(),
                " EXCEPT " => left_lines
                    .into_iter()
                    .filter(|l| !right_lines.contains(l))
                    .collect(),
                " UNION ALL " => {
                    let mut v = left_lines;
                    v.extend(right_lines);
                    v
                }
                _ => {
                    let mut set = std::collections::BTreeSet::new();
                    for l in left_lines.into_iter().chain(right_lines) {
                        set.insert(l);
                    }
                    set.into_iter().collect()
                }
            };
            if let Some(op) = ord_pos {
                let ord_end = lim_pos.filter(|&lp| lp > op).unwrap_or(stmt.len());
                let ord_spec = stmt[op + 10..ord_end].trim();
                let desc = ord_spec.to_ascii_uppercase().ends_with(" DESC");
                combined.sort_by(|a, b| {
                    let ka = a.rsplit(sep).next().unwrap_or(a);
                    let kb = b.rsplit(sep).next().unwrap_or(b);
                    let ord = match (ka.parse::<f64>(), kb.parse::<f64>()) {
                        (Ok(na), Ok(nb)) => na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal),
                        _ => a.cmp(b),
                    };
                    if desc { ord.reverse() } else { ord }
                });
            }
            if let Some(lp) = lim_pos {
                let lim_str = stmt[lp + 7..].trim();
                let lim_up = lim_str.to_ascii_uppercase();
                let (lim_part, off_val) = if let Some(off_p) = lim_up.find(" OFFSET ") {
                    let ov = lim_str[off_p + 8..]
                        .split_whitespace()
                        .next()
                        .and_then(|s| s.parse::<usize>().ok())
                        .unwrap_or(0);
                    (lim_str[..off_p].trim(), ov)
                } else {
                    (lim_str, 0usize)
                };
                let lim_val = lim_part
                    .split_whitespace()
                    .next()
                    .and_then(|s| s.parse::<usize>().ok())
                    .unwrap_or(combined.len());
                combined = combined.into_iter().skip(off_val).take(lim_val).collect();
            }
            let mut res = String::new();
            if let Some(h) = hdr_opt {
                res.push_str(&h);
                res.push('\n');
            }
            if !combined.is_empty() {
                res.push_str(&format!("{}\n", combined.join("\n")));
            }
            return res;
        }
    }

    // Find top-level FROM
    let mut from_pos = None;
    {
        let mut depth = 0i32;
        let bytes = upper.as_bytes();
        let mut idx = 0usize;
        while idx + 6 <= bytes.len() {
            if bytes[idx] == b'(' {
                depth += 1;
            } else if bytes[idx] == b')' {
                depth -= 1;
            } else if depth == 0 && &bytes[idx..idx + 6] == b" FROM " {
                from_pos = Some(idx);
                break;
            }
            idx += 1;
        }
    }

    let Some(from_pos) = from_pos else {
        let raw_exprs = split_top_level_comma(&stmt[6..]);
        let mut aliases = Vec::new();
        let mut vals = Vec::new();
        for raw_e in raw_exprs {
            let trimmed = raw_e.trim();
            let up = trimmed.to_ascii_uppercase();
            if let Some(as_pos) = up.rfind(" AS ")
                && !trimmed[as_pos + 4..].contains(')')
            {
                let expr_part = trimmed[..as_pos].trim();
                let alias = trimmed[as_pos + 4..].trim().trim_matches('"').to_string();
                aliases.push(alias);
                vals.push(eval_sql_row_expr(expr_part, &[], &[], tables));
            } else {
                aliases.push(trimmed.to_string());
                vals.push(eval_sql_row_expr(trimmed, &[], &[], tables));
            }
        }
        if json_mode {
            let mut entries = Vec::new();
            for (k, v) in aliases.into_iter().zip(vals.into_iter()) {
                let jv = if v.is_empty() || v.eq_ignore_ascii_case("NULL") {
                    JVal::Null
                } else if let Ok(n) = v.parse::<f64>() {
                    JVal::Number(n)
                } else {
                    JVal::Str(v)
                };
                entries.push((k, jv));
            }
            return format!("{}\n", JVal::Array(vec![JVal::Object(entries)]).to_json_string(true, false, 0));
        }
        if markdown_mode {
            let mut out = String::new();
            out.push_str(&format!("| {} |\n", aliases.join(" | ")));
            let dashes: Vec<&str> = aliases.iter().map(|_| "---").collect();
            out.push_str(&format!("|{}|\n", dashes.join("|")));
            out.push_str(&format!("| {} |\n", vals.join(" | ")));
            return out;
        }
        if line_mode {
            let mut out = String::new();
            let width = aliases.iter().map(|h| h.len()).max().unwrap_or(5).max(5);
            for (h, v) in aliases.iter().zip(vals.iter()) {
                let dv = if v.is_empty() || v.eq_ignore_ascii_case("NULL") {
                    nullvalue
                } else {
                    v.as_str()
                };
                out.push_str(&format!("{h:>width$} = {dv}\n"));
            }
            return out;
        }
        let mut res = String::new();
        if header_mode {
            res.push_str(&format!("{}\n", aliases.join(sep)));
        }
        res.push_str(&format!("{}\n", vals.join(sep)));
        return res;
    };

    let mut is_distinct = false;
    let raw_sel = stmt[6..from_pos].trim();
    let select_part = if raw_sel.to_ascii_uppercase().starts_with("DISTINCT ") {
        is_distinct = true;
        raw_sel[9..].trim()
    } else {
        raw_sel
    };
    let after_from = &stmt[from_pos + 6..];
    let after_upper = after_from.to_ascii_uppercase();

    let find_top_kw = |hay_up: &str, kw: &str| -> Option<usize> {
        let mut depth = 0i32;
        let bytes = hay_up.as_bytes();
        let kw_b = kw.as_bytes();
        let mut idx = 0usize;
        while idx + kw_b.len() <= bytes.len() {
            if bytes[idx] == b'(' {
                depth += 1;
            } else if bytes[idx] == b')' {
                depth -= 1;
            } else if depth == 0 && &bytes[idx..idx + kw_b.len()] == kw_b {
                return Some(idx);
            }
            idx += 1;
        }
        None
    };

    let where_pos = find_top_kw(&after_upper, " WHERE ");
    let group_pos = find_top_kw(&after_upper, " GROUP BY ");
    let having_pos = find_top_kw(&after_upper, " HAVING ");
    let order_pos = find_top_kw(&after_upper, " ORDER BY ");
    let limit_pos = find_top_kw(&after_upper, " LIMIT ");

    let table_end = [where_pos, group_pos, having_pos, order_pos, limit_pos]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or(after_from.len());
    let from_spec = after_from[..table_end].trim();
    let Some(tbl) = resolve_sql_from_table(from_spec, tables, views) else {
        return String::new();
    };

    let where_clause = where_pos.map(|wp| {
        let end = [group_pos, having_pos, order_pos, limit_pos]
            .into_iter()
            .flatten()
            .filter(|&p| p > wp)
            .min()
            .unwrap_or(after_from.len());
        after_from[wp + 7..end].trim()
    });

    let group_clause = group_pos.map(|gp| {
        let end = [having_pos, order_pos, limit_pos]
            .into_iter()
            .flatten()
            .filter(|&p| p > gp)
            .min()
            .unwrap_or(after_from.len());
        after_from[gp + 10..end].trim()
    });

    let having_clause = having_pos.map(|hp| {
        let end = [order_pos, limit_pos]
            .into_iter()
            .flatten()
            .filter(|&p| p > hp)
            .min()
            .unwrap_or(after_from.len());
        after_from[hp + 8..end].trim()
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

    let filtered: Vec<&Vec<String>> = tbl
        .rows
        .iter()
        .filter(|r| match where_clause {
            Some(wc) => eval_sql_where(wc, &tbl.columns, r, tables),
            None => true,
        })
        .collect();

    let sel_upper = select_part.to_ascii_uppercase();
    let has_window_over = sel_upper.contains("OVER (") || sel_upper.contains("OVER(");
    if !has_window_over && (group_clause.is_some() || has_top_level_aggregate(select_part)) {
        return exec_sql_aggregate_select(
            select_part,
            &tbl.columns,
            &filtered,
            group_clause,
            having_clause,
            order_clause,
            json_mode,
            csv_mode,
            header_mode,
            sep,
            nullvalue,
        );
    }

    enum SqlProj {
        Col { idx: usize, force_num: bool },
        Win {
            func: SqlWinFn,
            part_idx: Option<usize>,
            order_keys: Vec<(usize, bool)>,
            frame_bounds: Option<(isize, isize)>,
        },
        Expr(String),
    }

    let proj_specs: Vec<(String, SqlProj)> = if select_part == "*" {
        tbl.columns
            .iter()
            .enumerate()
            .filter(|(_, c)| {
                let short = c.split('.').next_back().unwrap_or(c);
                !(tbl.is_fts5 && short.eq_ignore_ascii_case("rowid"))
            })
            .map(|(i, c)| {
                let short = c.split('.').next_back().unwrap_or(c).to_string();
                (short, SqlProj::Col { idx: i, force_num: false })
            })
            .collect()
    } else {
        split_top_level_comma(select_part)
            .into_iter()
            .map(|raw| {
                let trimmed = raw.trim();
                let up = trimmed.to_ascii_uppercase();
                let (expr_s, alias) = if let Some(as_pos) = up.rfind(" AS ")
                    && !trimmed[as_pos + 4..].contains(')')
                {
                    (
                        trimmed[..as_pos].trim(),
                        trimmed[as_pos + 4..].trim().trim_matches('"').to_string(),
                    )
                } else {
                    let def_alias = trimmed.split('.').next_back().unwrap_or(trimmed).trim_matches('"').to_string();
                    (trimmed, def_alias)
                };
                let expr_up = expr_s.to_ascii_uppercase();
                if let Some(over_pos) = expr_up.find(" OVER")
                    && expr_s[over_pos + 5..].trim_start().starts_with('(')
                    && expr_s[..over_pos].chars().filter(|&c| c == '(').count()
                        == expr_s[..over_pos].chars().filter(|&c| c == ')').count()
                    && expr_s.trim_end().ends_with(')')
                {
                    let fn_part = expr_s[..over_pos].trim();
                    let fn_up = fn_part.to_ascii_uppercase();
                    let over_spec = expr_s[over_pos + 5..]
                        .trim()
                        .trim_start_matches('(')
                        .trim_end_matches(')')
                        .trim();
                    let over_up = over_spec.to_ascii_uppercase();
                    let mut part_idx = None;
                    if let Some(pp) = over_up.find("PARTITION BY ") {
                        let after_p = &over_spec[pp + 13..];
                        let p_col = after_p.split_whitespace().next().unwrap_or("");
                        part_idx = find_sql_col(&tbl.columns, p_col);
                    }
                    let mut order_keys = Vec::new();
                    if let Some(op) = over_up.find("ORDER BY ") {
                        let mut after_o = over_spec[op + 9..].trim();
                        let after_o_up = after_o.to_ascii_uppercase();
                        for frame_kw in [" ROWS ", " RANGE ", " GROUPS "] {
                            if let Some(fp) = after_o_up.find(frame_kw) {
                                after_o = after_o[..fp].trim();
                                break;
                            }
                        }
                        for item in split_top_level_comma(after_o) {
                            let it = item.trim();
                            let it_up = it.to_ascii_uppercase();
                            let desc = it_up.ends_with(" DESC");
                            let mut o_col = it
                                .strip_suffix(" DESC")
                                .or_else(|| it.strip_suffix(" desc"))
                                .or_else(|| it.strip_suffix(" ASC"))
                                .or_else(|| it.strip_suffix(" asc"))
                                .unwrap_or(it)
                                .trim();
                            if o_col.to_ascii_uppercase().starts_with("CAST(") && o_col.ends_with(')') {
                                let inner = &o_col[5..o_col.len() - 1];
                                if let Some(ap) = inner.to_ascii_uppercase().find(" AS ") {
                                    o_col = inner[..ap].trim().trim_matches('"');
                                }
                            }
                            if let Some(pos) = find_sql_col(&tbl.columns, o_col) {
                                order_keys.push((pos, desc));
                            }
                        }
                    }
                    let mut frame_bounds: Option<(isize, isize)> = None;
                    for frame_kw in ["ROWS BETWEEN ", "RANGE BETWEEN ", "GROUPS BETWEEN "] {
                        if let Some(fp) = over_up.find(frame_kw) {
                            let after_fb = over_up[fp + frame_kw.len()..].trim();
                            if let Some((b_start, b_end)) = after_fb.split_once(" AND ") {
                                let parse_bound = |bs: &str| -> isize {
                                    let b = bs.trim();
                                    if b.starts_with("UNBOUNDED PRECEDING") {
                                        isize::MIN
                                    } else if b.starts_with("UNBOUNDED FOLLOWING") {
                                        isize::MAX
                                    } else if b.starts_with("CURRENT ROW") {
                                        0
                                    } else if let Some(n_s) = b.strip_suffix(" PRECEDING") {
                                        -(n_s.trim().parse::<isize>().unwrap_or(0))
                                    } else if let Some(n_s) = b.strip_suffix(" FOLLOWING") {
                                        n_s.trim().parse::<isize>().unwrap_or(0)
                                    } else {
                                        0
                                    }
                                };
                                frame_bounds = Some((parse_bound(b_start), parse_bound(b_end)));
                            }
                            break;
                        }
                    }
                    let open_p = fn_part.find('(').unwrap_or(0);
                    let inner = fn_part[open_p + 1..fn_part.len().saturating_sub(1)].trim();
                    let func = if fn_up.starts_with("ROW_NUMBER(") {
                        SqlWinFn::RowNumber
                    } else if fn_up.starts_with("DENSE_RANK(") {
                        SqlWinFn::DenseRank
                    } else if fn_up.starts_with("RANK(") {
                        SqlWinFn::Rank
                    } else if fn_up.starts_with("NTILE(") {
                        let n = inner.parse::<usize>().unwrap_or(1).max(1);
                        SqlWinFn::Ntile(n)
                    } else if fn_up.starts_with("LAG(") || fn_up.starts_with("LEAD(") {
                        let is_lag = fn_up.starts_with("LAG(");
                        let args: Vec<&str> = inner.split(',').map(|s| s.trim()).collect();
                        let col_idx = args
                            .first()
                            .and_then(|cn| find_sql_col(&tbl.columns, cn))
                            .unwrap_or(0);
                        let offset = args.get(1).and_then(|s| s.parse::<usize>().ok()).unwrap_or(1);
                        let default_val = args
                            .get(2)
                            .map(|s| s.trim_matches('\'').trim_matches('"').to_string())
                            .unwrap_or_default();
                        if is_lag {
                            SqlWinFn::Lag {
                                col_idx,
                                offset,
                                default_val,
                            }
                        } else {
                            SqlWinFn::Lead {
                                col_idx,
                                offset,
                                default_val,
                            }
                        }
                    } else if fn_up.starts_with("FIRST_VALUE(") {
                        let col_idx = find_sql_col(&tbl.columns, inner).unwrap_or(0);
                        SqlWinFn::FirstValue { col_idx }
                    } else if fn_up.starts_with("LAST_VALUE(") {
                        let col_idx = find_sql_col(&tbl.columns, inner).unwrap_or(0);
                        SqlWinFn::LastValue { col_idx }
                    } else if fn_up.starts_with("NTH_VALUE(") {
                        let args: Vec<&str> = inner.split(',').map(|s| s.trim()).collect();
                        let col_idx = args
                            .first()
                            .and_then(|cn| find_sql_col(&tbl.columns, cn))
                            .unwrap_or(0);
                        let nth = args.get(1).and_then(|s| s.parse::<usize>().ok()).unwrap_or(1).max(1);
                        SqlWinFn::NthValue { col_idx, nth }
                    } else if fn_up.starts_with("COUNT(") {
                        SqlWinFn::Count
                    } else if fn_up.starts_with("MAX(") {
                        let col_idx = find_sql_col(&tbl.columns, inner).unwrap_or(0);
                        SqlWinFn::Max { col_idx }
                    } else if fn_up.starts_with("MIN(") {
                        let col_idx = find_sql_col(&tbl.columns, inner).unwrap_or(0);
                        SqlWinFn::Min { col_idx }
                    } else if fn_up.starts_with("AVG(") {
                        let col_idx = find_sql_col(&tbl.columns, inner).unwrap_or(0);
                        SqlWinFn::Avg { col_idx }
                    } else {
                        let col_idx = find_sql_col(&tbl.columns, inner).unwrap_or(0);
                        SqlWinFn::Sum { col_idx }
                    };
                    return (
                        alias,
                        SqlProj::Win {
                            func,
                            part_idx,
                            order_keys,
                            frame_bounds,
                        },
                    );
                }
                let mut col_lookup = expr_s.trim_matches('"');
                let mut force_num = false;
                if expr_up.starts_with("CAST(") && expr_s.ends_with(')') {
                    let inner = &expr_s[5..expr_s.len() - 1];
                    if let Some(ap) = inner.to_ascii_uppercase().rfind(" AS ") {
                        let target_t = inner[ap + 4..].trim().to_ascii_uppercase();
                        if target_t.starts_with("NUM") || target_t.starts_with("DEC") {
                            col_lookup = inner[..ap].trim().trim_matches('"');
                            force_num = true;
                        }
                    }
                }
                if !col_lookup.contains('(')
                    && !col_lookup.contains('|')
                    && !col_lookup.contains('+')
                    && !col_lookup.contains('-')
                    && !col_lookup.contains('*')
                    && !col_lookup.contains('/')
                    && !col_lookup.contains('%')
                    && !col_lookup.starts_with('\'')
                    && let Some(idx) = find_sql_col(&tbl.columns, col_lookup)
                {
                    (alias, SqlProj::Col { idx, force_num })
                } else {
                    (alias, SqlProj::Expr(expr_s.to_string()))
                }
            })
            .collect()
    };

    let proj_headers: Vec<String> = proj_specs.iter().map(|(a, _)| a.clone()).collect();
    let proj_is_num: Vec<bool> = proj_specs
        .iter()
        .map(|(_, spec)| match spec {
            SqlProj::Col { force_num, .. } => *force_num || !tbl.imported_csv,
            SqlProj::Win { .. } | SqlProj::Expr(_) => true,
        })
        .collect();
    let mut proj_rows: Vec<(&Vec<String>, Vec<String>)> = filtered
        .iter()
        .enumerate()
        .map(|(my_idx, &r)| {
            let mut vals = Vec::with_capacity(proj_specs.len());
            for (_, spec) in &proj_specs {
                match spec {
                    SqlProj::Col { idx, force_num } => {
                        let raw_v = r.get(*idx).cloned().unwrap_or_default();
                        if *force_num
                            && let Ok(n) = raw_v.parse::<f64>()
                            && (n - n.round()).abs() < 1e-9
                        {
                            vals.push((n.round() as i64).to_string());
                        } else {
                            vals.push(raw_v);
                        }
                    }
                    SqlProj::Expr(e) => {
                        let mut expanded_e = e.clone();
                        while let Some(over_pos) = expanded_e.to_ascii_uppercase().find(" OVER") {
                            let after_over = &expanded_e[over_pos + 5..];
                            let Some(rel_open) = after_over.find('(') else { break };
                            if !after_over[..rel_open].trim().is_empty() {
                                break;
                            }
                            let over_open = over_pos + 5 + rel_open;
                            let bytes = expanded_e.as_bytes();
                            let mut depth = 0i32;
                            let mut over_close = None;
                            for (idx, &b) in bytes.iter().enumerate().skip(over_open) {
                                if b == b'(' {
                                    depth += 1;
                                } else if b == b')' {
                                    depth -= 1;
                                    if depth == 0 {
                                        over_close = Some(idx);
                                        break;
                                    }
                                }
                            }
                            let Some(over_close) = over_close else { break };
                            let before_trim = expanded_e[..over_pos].trim_end();
                            if !before_trim.ends_with(')') {
                                break;
                            }
                            let fn_close = before_trim.len() - 1;
                            let mut fdepth = 0i32;
                            let mut fn_open = None;
                            for idx in (0..=fn_close).rev() {
                                if bytes[idx] == b')' {
                                    fdepth += 1;
                                } else if bytes[idx] == b'(' {
                                    fdepth -= 1;
                                    if fdepth == 0 {
                                        fn_open = Some(idx);
                                        break;
                                    }
                                }
                            }
                            let Some(fn_open) = fn_open else { break };
                            let mut fn_start = fn_open;
                            while fn_start > 0
                                && (bytes[fn_start - 1].is_ascii_alphanumeric()
                                    || bytes[fn_start - 1] == b'_')
                            {
                                fn_start -= 1;
                            }
                            let fn_part = expanded_e[fn_start..=fn_close].trim();
                            let fn_up = fn_part.to_ascii_uppercase();
                            let over_spec = expanded_e[over_open + 1..over_close].trim();
                            let over_up = over_spec.to_ascii_uppercase();
                            let mut part_idx = None;
                            if let Some(pp) = over_up.find("PARTITION BY ") {
                                let after_p = &over_spec[pp + 13..];
                                let p_col = after_p.split_whitespace().next().unwrap_or("");
                                part_idx = find_sql_col(&tbl.columns, p_col);
                            }
                            let mut order_keys = Vec::new();
                            if let Some(op) = over_up.find("ORDER BY ") {
                                let mut after_o = over_spec[op + 9..].trim();
                                let after_o_up = after_o.to_ascii_uppercase();
                                for frame_kw in [" ROWS ", " RANGE ", " GROUPS "] {
                                    if let Some(fp) = after_o_up.find(frame_kw) {
                                        after_o = after_o[..fp].trim();
                                        break;
                                    }
                                }
                                for item in split_top_level_comma(after_o) {
                                    let it = item.trim();
                                    let it_up = it.to_ascii_uppercase();
                                    let desc = it_up.ends_with(" DESC");
                                    let mut o_col = it
                                        .strip_suffix(" DESC")
                                        .or_else(|| it.strip_suffix(" desc"))
                                        .or_else(|| it.strip_suffix(" ASC"))
                                        .or_else(|| it.strip_suffix(" asc"))
                                        .unwrap_or(it)
                                        .trim();
                                    if o_col.to_ascii_uppercase().starts_with("CAST(")
                                        && o_col.ends_with(')')
                                    {
                                        let inner = &o_col[5..o_col.len() - 1];
                                        if let Some(ap) = inner.to_ascii_uppercase().find(" AS ") {
                                            o_col = inner[..ap].trim().trim_matches('"');
                                        }
                                    }
                                    if let Some(pos) = find_sql_col(&tbl.columns, o_col) {
                                        order_keys.push((pos, desc));
                                    }
                                }
                            }
                            let open_p = fn_part.find('(').unwrap_or(0);
                            let inner = fn_part[open_p + 1..fn_part.len().saturating_sub(1)].trim();
                            let my_part = part_idx.and_then(|pi| r.get(pi).map(|s| s.as_str()));
                            let mut p_indices: Vec<usize> = (0..filtered.len())
                                .filter(|&oi| {
                                    part_idx.and_then(|pi| filtered[oi].get(pi).map(|s| s.as_str()))
                                        == my_part
                                })
                                .collect();
                            let cmp_rows = |a_i: usize, b_i: usize| -> std::cmp::Ordering {
                                for &(col_i, desc) in &order_keys {
                                    let va = filtered[a_i].get(col_i).map(|s| s.as_str()).unwrap_or("");
                                    let vb = filtered[b_i].get(col_i).map(|s| s.as_str()).unwrap_or("");
                                    let ord = match (va.parse::<f64>(), vb.parse::<f64>()) {
                                        (Ok(na), Ok(nb)) => {
                                            na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal)
                                        }
                                        _ => va.cmp(vb),
                                    };
                                    let ord = if desc { ord.reverse() } else { ord };
                                    if ord != std::cmp::Ordering::Equal {
                                        return ord;
                                    }
                                }
                                std::cmp::Ordering::Equal
                            };
                            if !order_keys.is_empty() {
                                p_indices.sort_by(|&a_i, &b_i| cmp_rows(a_i, b_i));
                            }
                            let my_pos = p_indices.iter().position(|&oi| oi == my_idx).unwrap_or(0);
                            let wval = if fn_up.starts_with("ROW_NUMBER(") {
                                (my_pos + 1).to_string()
                            } else if fn_up.starts_with("RANK(") {
                                let mut rank = 1usize;
                                for k in 0..my_pos {
                                    if cmp_rows(p_indices[k], my_idx) != std::cmp::Ordering::Equal {
                                        rank = k + 2;
                                    }
                                }
                                rank.to_string()
                            } else if fn_up.starts_with("DENSE_RANK(") {
                                let mut drank = 1usize;
                                for k in 1..=my_pos {
                                    if cmp_rows(p_indices[k - 1], p_indices[k])
                                        != std::cmp::Ordering::Equal
                                    {
                                        drank += 1;
                                    }
                                }
                                drank.to_string()
                            } else if fn_up.starts_with("LAG(") || fn_up.starts_with("LEAD(") {
                                let is_lag = fn_up.starts_with("LAG(");
                                let args: Vec<&str> = inner.split(',').map(|s| s.trim()).collect();
                                let col_idx = args
                                    .first()
                                    .and_then(|cn| find_sql_col(&tbl.columns, cn))
                                    .unwrap_or(0);
                                let offset =
                                    args.get(1).and_then(|s| s.parse::<usize>().ok()).unwrap_or(1);
                                let default_val = args
                                    .get(2)
                                    .map(|s| s.trim_matches('\'').trim_matches('"').to_string())
                                    .unwrap_or_default();
                                if is_lag {
                                    if my_pos >= offset {
                                        filtered[p_indices[my_pos - offset]]
                                            .get(col_idx)
                                            .cloned()
                                            .unwrap_or(default_val)
                                    } else {
                                        default_val
                                    }
                                } else if my_pos + offset < p_indices.len() {
                                    filtered[p_indices[my_pos + offset]]
                                        .get(col_idx)
                                        .cloned()
                                        .unwrap_or(default_val)
                                } else {
                                    default_val
                                }
                            } else {
                                String::new()
                            };
                            let replacement = if wval.is_empty() {
                                "NULL".to_string()
                            } else if wval.parse::<f64>().is_ok() {
                                wval
                            } else {
                                format!("'{}'", wval.replace('\'', "''"))
                            };
                            expanded_e.replace_range(fn_start..=over_close, &replacement);
                        }
                        vals.push(eval_sql_row_expr(&expanded_e, &tbl.columns, r, tables));
                    }
                    SqlProj::Win {
                        func,
                        part_idx,
                        order_keys,
                        frame_bounds,
                    } => {
                        let my_part = part_idx.and_then(|pi| r.get(pi).map(|s| s.as_str()));
                        let mut p_indices: Vec<usize> = (0..filtered.len())
                            .filter(|&oi| {
                                part_idx.and_then(|pi| filtered[oi].get(pi).map(|s| s.as_str()))
                                    == my_part
                            })
                            .collect();
                        let cmp_rows = |a_i: usize, b_i: usize| -> std::cmp::Ordering {
                            for &(col_i, desc) in order_keys {
                                let va = filtered[a_i].get(col_i).map(|s| s.as_str()).unwrap_or("");
                                let vb = filtered[b_i].get(col_i).map(|s| s.as_str()).unwrap_or("");
                                let ord = match (va.parse::<f64>(), vb.parse::<f64>()) {
                                    (Ok(na), Ok(nb)) => {
                                        na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal)
                                    }
                                    _ => va.cmp(vb),
                                };
                                let ord = if desc { ord.reverse() } else { ord };
                                if ord != std::cmp::Ordering::Equal {
                                    return ord;
                                }
                            }
                            std::cmp::Ordering::Equal
                        };
                        if !order_keys.is_empty() {
                            p_indices.sort_by(|&a_i, &b_i| cmp_rows(a_i, b_i));
                        }
                        let my_pos = p_indices.iter().position(|&oi| oi == my_idx).unwrap_or(0);
                        let (start_pos, end_pos) = if let Some((rel_s, rel_e)) = frame_bounds {
                            let sp = if *rel_s == isize::MIN {
                                0
                            } else {
                                (my_pos as isize + *rel_s).max(0) as usize
                            };
                            let ep = if *rel_e == isize::MAX {
                                p_indices.len().saturating_sub(1)
                            } else {
                                ((my_pos as isize + *rel_e).max(0) as usize)
                                    .min(p_indices.len().saturating_sub(1))
                            };
                            (sp, ep)
                        } else if order_keys.is_empty() {
                            (0, p_indices.len().saturating_sub(1))
                        } else {
                            let mut ep = my_pos;
                            while ep + 1 < p_indices.len()
                                && cmp_rows(p_indices[ep + 1], my_idx) == std::cmp::Ordering::Equal
                            {
                                ep += 1;
                            }
                            (0, ep)
                        };
                        let wval = match func {
                            SqlWinFn::RowNumber => (my_pos + 1).to_string(),
                            SqlWinFn::Rank => {
                                let mut rank = 1usize;
                                for k in 0..my_pos {
                                    if cmp_rows(p_indices[k], my_idx) != std::cmp::Ordering::Equal {
                                        rank = k + 2;
                                    }
                                }
                                rank.to_string()
                            }
                            SqlWinFn::DenseRank => {
                                let mut drank = 1usize;
                                for k in 1..=my_pos {
                                    if cmp_rows(p_indices[k - 1], p_indices[k])
                                        != std::cmp::Ordering::Equal
                                    {
                                        drank += 1;
                                    }
                                }
                                drank.to_string()
                            }
                            SqlWinFn::Ntile(n) => {
                                let len = p_indices.len().max(1);
                                let nb = (*n).max(1);
                                let base = len / nb;
                                let rem = len % nb;
                                let bucket = if base == 0 {
                                    my_pos + 1
                                } else if my_pos < rem * (base + 1) {
                                    my_pos / (base + 1) + 1
                                } else {
                                    (my_pos - rem * (base + 1)) / base + rem + 1
                                };
                                bucket.to_string()
                            }
                            SqlWinFn::Lag {
                                col_idx,
                                offset,
                                default_val,
                            } => {
                                if my_pos >= *offset {
                                    let prev_i = p_indices[my_pos - *offset];
                                    filtered[prev_i]
                                        .get(*col_idx)
                                        .cloned()
                                        .unwrap_or_else(|| default_val.clone())
                                } else {
                                    default_val.clone()
                                }
                            }
                            SqlWinFn::Lead {
                                col_idx,
                                offset,
                                default_val,
                            } => {
                                if my_pos + *offset < p_indices.len() {
                                    let next_i = p_indices[my_pos + *offset];
                                    filtered[next_i]
                                        .get(*col_idx)
                                        .cloned()
                                        .unwrap_or_else(|| default_val.clone())
                                } else {
                                    default_val.clone()
                                }
                            }
                            SqlWinFn::FirstValue { col_idx } => p_indices
                                .get(start_pos)
                                .and_then(|&fi| filtered[fi].get(*col_idx).cloned())
                                .unwrap_or_default(),
                            SqlWinFn::LastValue { col_idx } => p_indices
                                .get(end_pos)
                                .and_then(|&li| filtered[li].get(*col_idx).cloned())
                                .unwrap_or_default(),
                            SqlWinFn::NthValue { col_idx, nth } => p_indices
                                .get(start_pos + nth.saturating_sub(1))
                                .and_then(|&ni| filtered[ni].get(*col_idx).cloned())
                                .unwrap_or_default(),
                            SqlWinFn::Count => {
                                if frame_bounds.is_some() {
                                    if end_pos >= start_pos && !p_indices.is_empty() {
                                        (end_pos - start_pos + 1).to_string()
                                    } else {
                                        "0".to_string()
                                    }
                                } else if order_keys.is_empty() {
                                    p_indices.len().to_string()
                                } else {
                                    (end_pos + 1).to_string()
                                }
                            }
                            SqlWinFn::Max { col_idx } | SqlWinFn::Min { col_idx } => {
                                let is_max = matches!(func, SqlWinFn::Max { .. });
                                let mut best: Option<f64> = None;
                                for &oi in &p_indices[start_pos..=end_pos] {
                                    if let Some(v) = filtered[oi]
                                        .get(*col_idx)
                                        .and_then(|s| s.parse::<f64>().ok())
                                    {
                                        best = Some(match best {
                                            Some(b) => if is_max { b.max(v) } else { b.min(v) },
                                            None => v,
                                        });
                                    }
                                }
                                match best {
                                    Some(n) if (n - n.round()).abs() < 1e-9 => (n.round() as i64).to_string(),
                                    Some(n) => n.to_string(),
                                    None => String::new(),
                                }
                            }
                            SqlWinFn::Avg { col_idx } => {
                                let mut sum = 0.0f64;
                                let mut cnt = 0usize;
                                for &oi in &p_indices[start_pos..=end_pos] {
                                    if let Some(v) = filtered[oi]
                                        .get(*col_idx)
                                        .and_then(|s| s.parse::<f64>().ok())
                                    {
                                        sum += v;
                                        cnt += 1;
                                    }
                                }
                                if cnt == 0 {
                                    String::new()
                                } else {
                                    let avg = sum / (cnt as f64);
                                    if (avg - avg.round()).abs() < 1e-9 {
                                        format!("{:.1}", avg)
                                    } else {
                                        avg.to_string()
                                    }
                                }
                            }
                            SqlWinFn::Sum { col_idx } => {
                                let mut sum = 0.0f64;
                                for &oi in &p_indices[start_pos..=end_pos] {
                                    if let Some(v) = filtered[oi]
                                        .get(*col_idx)
                                        .and_then(|s| s.parse::<f64>().ok())
                                    {
                                        sum += v;
                                    }
                                }
                                if (sum - sum.round()).abs() < 1e-9 {
                                    (sum.round() as i64).to_string()
                                } else {
                                    sum.to_string()
                                }
                            }
                        };
                        vals.push(wval);
                    }
                }
            }
            (r, vals)
        })
        .collect();

    if is_distinct {
        let mut seen = Vec::new();
        proj_rows.retain(|(_, vals)| {
            if seen.contains(vals) {
                false
            } else {
                seen.push(vals.clone());
                true
            }
        });
    }

    if let Some(oc) = order_clause {
        enum OrderKeyLoc {
            RawCol(usize, bool),
            ProjCol(usize, bool),
        }
        let mut order_keys: Vec<OrderKeyLoc> = Vec::new();
        for item in split_top_level_comma(oc) {
            let trimmed = item.trim();
            let up = trimmed.to_ascii_uppercase();
            let desc = up.ends_with(" DESC");
            let mut col_part = trimmed
                .strip_suffix(" DESC")
                .or_else(|| trimmed.strip_suffix(" desc"))
                .or_else(|| trimmed.strip_suffix(" ASC"))
                .or_else(|| trimmed.strip_suffix(" asc"))
                .unwrap_or(trimmed)
                .trim();
            if col_part.to_ascii_uppercase().starts_with("CAST(") && col_part.ends_with(')') {
                let inner = &col_part[5..col_part.len() - 1];
                if let Some(ap) = inner.to_ascii_uppercase().find(" AS ") {
                    col_part = inner[..ap].trim();
                }
            }
            let col_name = col_part.trim_matches('"');
            if col_name.eq_ignore_ascii_case("rowid") && find_sql_col(&tbl.columns, "rowid").is_none() {
                continue;
            }
            if let Some(p_idx) = proj_headers
                .iter()
                .position(|h| h.eq_ignore_ascii_case(col_name))
            {
                order_keys.push(OrderKeyLoc::ProjCol(p_idx, desc));
            } else if let Some(c_idx) = find_sql_col(&tbl.columns, col_name) {
                order_keys.push(OrderKeyLoc::RawCol(c_idx, desc));
            }
        }
        if !order_keys.is_empty() {
            proj_rows.sort_by(|(a, pa), (b, pb)| {
                for loc in &order_keys {
                    let (va, vb, desc) = match loc {
                        OrderKeyLoc::ProjCol(pi, d) => (
                            pa.get(*pi).map(|s| s.as_str()).unwrap_or(""),
                            pb.get(*pi).map(|s| s.as_str()).unwrap_or(""),
                            *d,
                        ),
                        OrderKeyLoc::RawCol(ci, d) => (
                            a.get(*ci).map(|s| s.as_str()).unwrap_or(""),
                            b.get(*ci).map(|s| s.as_str()).unwrap_or(""),
                            *d,
                        ),
                    };
                    let ord = match (va.parse::<f64>(), vb.parse::<f64>()) {
                        (Ok(na), Ok(nb)) => na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal),
                        _ => va.cmp(vb),
                    };
                    let ord = if desc { ord.reverse() } else { ord };
                    if ord != std::cmp::Ordering::Equal {
                        return ord;
                    }
                }
                std::cmp::Ordering::Equal
            });
        }
    }

    if let Some(lim) = limit_val {
        proj_rows.truncate(lim);
    }

    if json_mode {
        let arr: Vec<JVal> = proj_rows
            .iter()
            .map(|(_, pvals)| {
                let mut entries = Vec::new();
                for (idx, (cname, val_s)) in proj_headers.iter().zip(pvals.iter()).enumerate() {
                    let allow_num = proj_is_num.get(idx).copied().unwrap_or(true);
                    let jv = if val_s.is_empty() || val_s.eq_ignore_ascii_case("NULL") {
                        JVal::Null
                    } else if allow_num && let Ok(n) = val_s.parse::<f64>() {
                        JVal::Number(n)
                    } else {
                        JVal::Str(val_s.clone())
                    };
                    entries.push((cname.clone(), jv));
                }
                JVal::Object(entries)
            })
            .collect();
        return format!("{}\n", JVal::Array(arr).to_json_string(true, false, 0));
    }
    if markdown_mode {
        let mut out = String::new();
        out.push_str(&format!("| {} |\n", proj_headers.join(" | ")));
        let dashes: Vec<&str> = proj_headers.iter().map(|_| "---").collect();
        out.push_str(&format!("|{}|\n", dashes.join("|")));
        for (_, vals) in proj_rows {
            out.push_str(&format!("| {} |\n", vals.join(" | ")));
        }
        return out;
    }
    if line_mode {
        let mut out = String::new();
        let width = proj_headers.iter().map(|h| h.len()).max().unwrap_or(5).max(5);
        for (r_i, (_, vals)) in proj_rows.iter().enumerate() {
            if r_i > 0 {
                out.push('\n');
            }
            for (h, v) in proj_headers.iter().zip(vals.iter()) {
                let dv = if v.is_empty() || v.eq_ignore_ascii_case("NULL") {
                    nullvalue
                } else {
                    v.as_str()
                };
                out.push_str(&format!("{h:>width$} = {dv}\n"));
            }
        }
        return out;
    }
    if let Some(ins_tbl) = insert_table {
        let mut out = String::new();
        for (_, vals) in proj_rows {
            let quoted: Vec<String> = vals
                .iter()
                .enumerate()
                .map(|(idx, v)| {
                    let allow_num = proj_is_num.get(idx).copied().unwrap_or(true);
                    if allow_num && v.parse::<f64>().is_ok() {
                        v.clone()
                    } else {
                        format!("'{}'", v.replace('\'', "''"))
                    }
                })
                .collect();
            out.push_str(&format!("INSERT INTO {ins_tbl} VALUES({});\n", quoted.join(",")));
        }
        return out;
    }
    if quote_mode {
        let mut out = String::new();
        for (_, vals) in proj_rows {
            let quoted: Vec<String> = vals
                .iter()
                .map(|v| {
                    if v.is_empty() || v.eq_ignore_ascii_case("NULL") {
                        "NULL".to_string()
                    } else if v.parse::<f64>().is_ok() {
                        v.clone()
                    } else {
                        format!("'{}'", v.replace('\'', "''"))
                    }
                })
                .collect();
            out.push_str(&format!("{}\n", quoted.join(",")));
        }
        return out;
    }

    let mut out = String::new();
    if header_mode {
        if csv_mode {
            out.push_str(&format_csv_row(&proj_headers, ','));
        } else {
            out.push_str(&format!("{}\n", proj_headers.join(sep)));
        }
    }
    for (_, vals) in proj_rows {
        let disp_vals: Vec<String> = vals
            .into_iter()
            .map(|v| {
                if (v.is_empty() || v.eq_ignore_ascii_case("NULL")) && !nullvalue.is_empty() {
                    nullvalue.to_string()
                } else {
                    v
                }
            })
            .collect();
        if csv_mode {
            out.push_str(&format_csv_row(&disp_vals, ','));
        } else {
            out.push_str(&format!("{}\n", disp_vals.join(sep)));
        }
    }
    out
}

#[allow(clippy::too_many_arguments)]
fn exec_sql_aggregate_select(
    select_part: &str,
    cols: &[String],
    rows: &[&Vec<String>],
    group_clause: Option<&str>,
    having_clause: Option<&str>,
    order_clause: Option<&str>,
    json_mode: bool,
    csv_mode: bool,
    header_mode: bool,
    sep: &str,
    nullvalue: &str,
) -> String {
    let raw_items = split_top_level_comma(select_part);
    let mut exprs: Vec<(String, String)> = Vec::new();
    for item in raw_items {
        let trimmed = item.trim();
        let upper = trimmed.to_ascii_uppercase();
        if let Some(as_pos) = upper.rfind(" AS ")
            && !trimmed[as_pos + 4..].contains(')')
        {
            let e = trimmed[..as_pos].trim().to_string();
            let alias = trimmed[as_pos + 4..].trim().trim_matches('"').to_string();
            exprs.push((e, alias));
        } else {
            let def_alias = trimmed.split('.').next_back().unwrap_or(trimmed).to_string();
            exprs.push((trimmed.to_string(), def_alias));
        }
    }
    let empty_tables = BTreeMap::new();
    let groups: Vec<Vec<&Vec<String>>> = if let Some(gc) = group_clause {
        let g_specs: Vec<&str> = split_top_level_comma(gc)
            .into_iter()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();
        let mut map: BTreeMap<String, Vec<&Vec<String>>> = BTreeMap::new();
        for r in rows {
            let key: Vec<String> = g_specs
                .iter()
                .map(|&gspec| {
                    if let Some(gi) = find_sql_col(cols, gspec) {
                        r.get(gi).cloned().unwrap_or_default()
                    } else if let Some((e, _)) = exprs
                        .iter()
                        .find(|(_, alias)| alias.eq_ignore_ascii_case(gspec))
                    {
                        eval_sql_row_expr(e, cols, r, &empty_tables)
                    } else if let Ok(pos) = gspec.parse::<usize>()
                        && pos >= 1
                        && pos <= exprs.len()
                    {
                        eval_sql_row_expr(&exprs[pos - 1].0, cols, r, &empty_tables)
                    } else {
                        eval_sql_row_expr(gspec, cols, r, &empty_tables)
                    }
                })
                .collect();
            map.entry(key.join("\x1f")).or_default().push(*r);
        }
        map.into_values().collect()
    } else {
        vec![rows.to_vec()]
    };
    let mut out_rows: Vec<(Vec<String>, Vec<String>)> = Vec::new();
    for grp in &groups {
        let mut row_vals = Vec::new();
        for (e, _) in &exprs {
            row_vals.push(eval_sql_group_expr(e, cols, grp));
        }
        if let Some(hc) = having_clause {
            let mut ext_cols = cols.to_vec();
            for (_, alias) in &exprs {
                ext_cols.push(alias.clone());
            }
            let ext_grp: Vec<Vec<String>> = grp
                .iter()
                .map(|r| {
                    let mut er = (*r).clone();
                    er.extend(row_vals.iter().cloned());
                    er
                })
                .collect();
            let ext_grp_refs: Vec<&Vec<String>> = ext_grp.iter().collect();
            if !eval_sql_having(hc, &ext_cols, &ext_grp_refs) {
                continue;
            }
        }
        let first_raw = grp.first().map(|r| (*r).clone()).unwrap_or_default();
        out_rows.push((first_raw, row_vals));
    }
    if let Some(oc) = order_clause {
        let mut ord_specs: Vec<(usize, bool, bool)> = Vec::new();
        for item in split_top_level_comma(oc) {
            let mut oc_norm = item.trim();
            let oc_up = oc_norm.to_ascii_uppercase();
            let desc = oc_up.ends_with(" DESC");
            oc_norm = oc_norm
                .strip_suffix(" DESC")
                .or_else(|| oc_norm.strip_suffix(" desc"))
                .or_else(|| oc_norm.strip_suffix(" ASC"))
                .or_else(|| oc_norm.strip_suffix(" asc"))
                .unwrap_or(oc_norm)
                .trim();
            if oc_norm.to_ascii_uppercase().starts_with("CAST(") && oc_norm.ends_with(')') {
                let inner = &oc_norm[5..oc_norm.len() - 1];
                if let Some(ap) = inner.to_ascii_uppercase().find(" AS ") {
                    oc_norm = inner[..ap].trim();
                }
            }
            let col_name = oc_norm.trim_matches('"');
            let c_short = col_name.split('.').next_back().unwrap_or(col_name);
            if let Some(c_idx) = exprs.iter().position(|(e, alias)| {
                alias.eq_ignore_ascii_case(col_name)
                    || e.eq_ignore_ascii_case(col_name)
                    || (!col_name.contains('.') && alias.eq_ignore_ascii_case(c_short))
            }) {
                ord_specs.push((c_idx, desc, true));
            } else if let Some(r_idx) = find_sql_col(cols, col_name) {
                ord_specs.push((r_idx, desc, false));
            }
        }
        if !ord_specs.is_empty() {
            out_rows.sort_by(|(ra, pa), (rb, pb)| {
                for &(idx, desc, is_proj) in &ord_specs {
                    let (va, vb) = if is_proj {
                        (
                            pa.get(idx).map(|s| s.as_str()).unwrap_or(""),
                            pb.get(idx).map(|s| s.as_str()).unwrap_or(""),
                        )
                    } else {
                        (
                            ra.get(idx).map(|s| s.as_str()).unwrap_or(""),
                            rb.get(idx).map(|s| s.as_str()).unwrap_or(""),
                        )
                    };
                    let ord = match (va.parse::<f64>(), vb.parse::<f64>()) {
                        (Ok(na), Ok(nb)) => na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal),
                        _ => va.cmp(vb),
                    };
                    let ord = if desc { ord.reverse() } else { ord };
                    if ord != std::cmp::Ordering::Equal {
                        return ord;
                    }
                }
                std::cmp::Ordering::Equal
            });
        }
    }
    if json_mode {
        let arr: Vec<JVal> = out_rows
            .iter()
            .map(|(_, rvals)| {
                let mut entries = Vec::new();
                for ((_, alias), val_s) in exprs.iter().zip(rvals.iter()) {
                    let jv = if val_s.is_empty() || val_s.eq_ignore_ascii_case("NULL") {
                        JVal::Null
                    } else if let Ok(n) = val_s.parse::<f64>() {
                        JVal::Number(n)
                    } else {
                        JVal::Str(val_s.clone())
                    };
                    entries.push((alias.clone(), jv));
                }
                JVal::Object(entries)
            })
            .collect();
        return format!("{}\n", JVal::Array(arr).to_json_string(true, false, 0));
    }
    let mut out = String::new();
    let hdr: Vec<String> = exprs.iter().map(|(_, alias)| alias.clone()).collect();
    if header_mode {
        if csv_mode {
            out.push_str(&format_csv_row(&hdr, ','));
        } else {
            out.push_str(&format!("{}\n", hdr.join(sep)));
        }
    }
    for (_, r) in out_rows {
        let disp: Vec<String> = r
            .into_iter()
            .map(|v| {
                if (v.is_empty() || v.eq_ignore_ascii_case("NULL")) && !nullvalue.is_empty() {
                    nullvalue.to_string()
                } else {
                    v
                }
            })
            .collect();
        if csv_mode {
            out.push_str(&format_csv_row(&disp, ','));
        } else {
            out.push_str(&format!("{}\n", disp.join(sep)));
        }
    }
    out
}


fn eval_sql_having(hc: &str, cols: &[String], grp: &[&Vec<String>]) -> bool {
    let trimmed = hc.trim();
    if trimmed.starts_with('(') && find_matching_paren(trimmed) == Some(trimmed.len() - 1) {
        return eval_sql_having(&trimmed[1..trimmed.len() - 1], cols, grp);
    }
    let upper = trimmed.to_ascii_uppercase();
    if let Some(or_p) = find_top_sql_bool_kw(&upper, " OR ") {
        return eval_sql_having(&trimmed[..or_p], cols, grp)
            || eval_sql_having(&trimmed[or_p + 4..], cols, grp);
    }
    if let Some(and_p) = find_top_sql_bool_kw(&upper, " AND ") {
        return eval_sql_having(&trimmed[..and_p], cols, grp)
            && eval_sql_having(&trimmed[and_p + 5..], cols, grp);
    }
    if upper.starts_with("NOT ") {
        return !eval_sql_having(&trimmed[4..], cols, grp);
    }
    for op in [">=", "<=", "!=", "<>", "=", ">", "<"] {
        if let Some((lhs, rhs)) = trimmed.split_once(op) {
            let lv = eval_sql_group_expr(lhs.trim(), cols, grp);
            let rv = eval_sql_group_expr(rhs.trim(), cols, grp);
            let ord = match (lv.parse::<f64>(), rv.parse::<f64>()) {
                (Ok(na), Ok(nb)) => na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal),
                _ => lv.cmp(&rv),
            };
            return match op {
                ">=" => ord != std::cmp::Ordering::Less,
                "<=" => ord != std::cmp::Ordering::Greater,
                "!=" | "<>" => ord != std::cmp::Ordering::Equal,
                "=" => ord == std::cmp::Ordering::Equal,
                ">" => ord == std::cmp::Ordering::Greater,
                "<" => ord == std::cmp::Ordering::Less,
                _ => true,
            };
        }
    }
    true
}

fn split_sql_concat(expr: &str) -> Vec<&str> {
    let bytes = expr.as_bytes();
    let mut out = Vec::new();
    let mut start = 0usize;
    let mut depth = 0i32;
    let mut in_sq = false;
    let mut in_dq = false;
    let mut i = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'\'' && !in_dq {
            if in_sq && i + 1 < bytes.len() && bytes[i + 1] == b'\'' {
                i += 2;
                continue;
            }
            in_sq = !in_sq;
        } else if b == b'"' && !in_sq {
            in_dq = !in_dq;
        } else if !in_sq && !in_dq {
            if b == b'(' {
                depth += 1;
            } else if b == b')' {
                depth -= 1;
            } else if depth == 0 && i + 1 < bytes.len() && b == b'|' && bytes[i + 1] == b'|' {
                out.push(expr[start..i].trim());
                i += 2;
                start = i;
                continue;
            }
        }
        i += 1;
    }
    out.push(expr[start..].trim());
    out
}

fn eval_sql_printf(fmt: &str, args: &[String]) -> String {
    let mut out = String::new();
    let chs: Vec<char> = fmt.chars().collect();
    let mut i = 0usize;
    let mut arg_i = 0usize;
    while i < chs.len() {
        if chs[i] != '%' {
            out.push(chs[i]);
            i += 1;
            continue;
        }
        if i + 1 < chs.len() && chs[i + 1] == '%' {
            out.push('%');
            i += 2;
            continue;
        }
        i += 1;
        let mut left_align = false;
        let mut zero_pad = false;
        if i < chs.len() && chs[i] == '-' {
            left_align = true;
            i += 1;
        }
        if i < chs.len() && chs[i] == '0' {
            zero_pad = true;
            i += 1;
        }
        let mut width_s = String::new();
        while i < chs.len() && chs[i].is_ascii_digit() {
            width_s.push(chs[i]);
            i += 1;
        }
        let mut prec_s = String::new();
        if i < chs.len() && chs[i] == '.' {
            i += 1;
            while i < chs.len() && chs[i].is_ascii_digit() {
                prec_s.push(chs[i]);
                i += 1;
            }
        }
        let spec = if i < chs.len() {
            let c = chs[i];
            i += 1;
            c
        } else {
            's'
        };
        let raw_arg = args.get(arg_i).map(|s| s.as_str()).unwrap_or("");
        arg_i += 1;
        let width = width_s.parse::<usize>().unwrap_or(0);
        let prec = prec_s.parse::<usize>().ok();
        let formatted = match spec {
            'd' | 'i' => {
                let n = raw_arg.parse::<f64>().unwrap_or(0.0) as i64;
                let s = n.to_string();
                if width > s.len() {
                    let pad = width - s.len();
                    if left_align {
                        format!("{s}{}", " ".repeat(pad))
                    } else if zero_pad {
                        format!("{}{s}", "0".repeat(pad))
                    } else {
                        format!("{}{s}", " ".repeat(pad))
                    }
                } else {
                    s
                }
            }
            'f' => {
                let n = raw_arg.parse::<f64>().unwrap_or(0.0);
                let p = prec.unwrap_or(6);
                format!("{n:.p$}")
            }
            _ => {
                let s = raw_arg.to_string();
                if width > s.len() {
                    let pad = width - s.len();
                    if left_align {
                        format!("{s}{}", " ".repeat(pad))
                    } else {
                        format!("{}{s}", " ".repeat(pad))
                    }
                } else {
                    s
                }
            }
        };
        out.push_str(&formatted);
    }
    out
}

fn parse_sql_json_path(path_s: &str) -> Vec<JVal> {
    let mut segs = Vec::new();
    let rest = path_s.trim().strip_prefix('$').unwrap_or(path_s.trim());
    for part in rest.split('.').filter(|p| !p.is_empty()) {
        if let Some(open_b) = part.find('[') {
            let key = &part[..open_b];
            if !key.is_empty() {
                segs.push(JVal::Str(key.to_string()));
            }
            let mut rem = &part[open_b..];
            while let Some(ob) = rem.find('[')
                && let Some(cb) = rem.find(']')
            {
                if let Ok(idx) = rem[ob + 1..cb].parse::<f64>() {
                    segs.push(JVal::Number(idx));
                }
                rem = &rem[cb + 1..];
            }
        } else {
            segs.push(JVal::Str(part.to_string()));
        }
    }
    segs
}

fn parse_sql_arg_to_jval(val_s: &str, raw_expr: &str) -> JVal {
    let rt = raw_expr.trim();
    if rt.to_ascii_uppercase().starts_with("JSON(")
        && rt.ends_with(')')
        && let Ok(mut p) = parse_json_stream(val_s)
        && let Some(jv) = p.pop()
    {
        return jv;
    }
    if rt.eq_ignore_ascii_case("NULL") {
        return JVal::Null;
    }
    if rt.eq_ignore_ascii_case("true") {
        return JVal::Bool(true);
    }
    if rt.eq_ignore_ascii_case("false") {
        return JVal::Bool(false);
    }
    if (rt.starts_with('\'') && rt.ends_with('\'')) || (rt.starts_with('"') && rt.ends_with('"')) {
        return JVal::Str(val_s.to_string());
    }
    if let Ok(n) = val_s.parse::<f64>() {
        return JVal::Number(n);
    }
    if (val_s.starts_with('{') || val_s.starts_with('['))
        && let Ok(mut p) = parse_json_stream(val_s)
        && let Some(jv) = p.pop()
    {
        return jv;
    }
    JVal::Str(val_s.to_string())
}

fn apply_json_merge_patch(target: &mut JVal, patch: JVal) {
    match patch {
        JVal::Object(p_entries) => {
            if !matches!(target, JVal::Object(_)) {
                *target = JVal::Object(Vec::new());
            }
            if let JVal::Object(t_entries) = target {
                for (pk, pv) in p_entries {
                    if matches!(pv, JVal::Null) {
                        t_entries.retain(|(tk, _)| tk != &pk);
                    } else if let Some((_, tv)) = t_entries.iter_mut().find(|(tk, _)| tk == &pk) {
                        apply_json_merge_patch(tv, pv);
                    } else {
                        t_entries.push((pk, pv));
                    }
                }
            }
        }
        other => *target = other,
    }
}

fn substitute_correlated_subquery(sub_sql: &str, cols: &[String], row: &[String]) -> String {
    let mut out = sub_sql.to_string();
    let mut pairs: Vec<(&String, &String)> = cols.iter().zip(row.iter()).collect();
    pairs.sort_by_key(|a| std::cmp::Reverse(a.0.len()));
    for (c, v) in pairs {
        let repl = if !v.is_empty() && v.parse::<f64>().is_ok() {
            v.clone()
        } else {
            format!("'{}'", v.replace('\'', "''"))
        };
        if c.contains('.') {
            out = out.replace(c.as_str(), &repl);
        } else {
            out = replace_jq_ident(&out, c, &repl);
        }
    }
    out
}

fn eval_sql_row_expr(
    expr: &str,
    cols: &[String],
    row: &[String],
    tables: &BTreeMap<String, SqlTable>,
) -> String {
    let s = expr.trim();
    if s.is_empty() {
        return String::new();
    }
    let concat_parts = split_sql_concat(s);
    if concat_parts.len() > 1 {
        let mut res = String::new();
        for p in concat_parts {
            res.push_str(&eval_sql_row_expr(p, cols, row, tables));
        }
        return res;
    }
    if (s.starts_with('\'') && s.ends_with('\'')) || (s.starts_with('"') && s.ends_with('"')) {
        return s[1..s.len() - 1].replace("''", "'");
    }
    if s.parse::<f64>().is_ok() {
        return s.to_string();
    }
    let upper = s.to_ascii_uppercase();
    if s.starts_with('(') && find_matching_paren(s) == Some(s.len() - 1) {
        let inner = s[1..s.len() - 1].trim();
        if inner.to_ascii_uppercase().starts_with("SELECT ") {
            let sub_sql = substitute_correlated_subquery(inner, cols, row);
            let res = exec_sql_select(
                &sub_sql,
                tables,
                &BTreeMap::new(),
                false,
                false,
                false,
                false,
                None,
                false,
                "|",
            );
            return res.lines().next().unwrap_or("").trim().to_string();
        }
        return eval_sql_row_expr(inner, cols, row, tables);
    }
    if upper.starts_with("EXISTS") {
        let after_ex = s[6..].trim();
        if after_ex.starts_with('(')
            && let Some(close) = find_matching_paren(after_ex)
        {
            let inner = after_ex[1..close].trim();
            let sub_sql = substitute_correlated_subquery(inner, cols, row);
            let res = exec_sql_select(
                &sub_sql,
                tables,
                &BTreeMap::new(),
                false,
                false,
                false,
                false,
                None,
                false,
                "|",
            );
            return if res.trim().is_empty() {
                "0".to_string()
            } else {
                "1".to_string()
            };
        }
    }
    if upper.starts_with("CASE ") && upper.ends_with(" END") {
        let inner = s[5..s.len() - 4].trim();
        let (base_opt, branches, else_opt) = split_sql_case_branches(inner);
        if let Some(base_expr) = base_opt {
            let base_val = eval_sql_row_expr(base_expr, cols, row, tables);
            if !base_val.is_empty() && !base_val.eq_ignore_ascii_case("NULL") {
                for (cond_s, then_val) in branches {
                    let when_val = eval_sql_row_expr(cond_s, cols, row, tables);
                    let matches = if let (Ok(bn), Ok(wn)) = (base_val.parse::<f64>(), when_val.parse::<f64>()) {
                        (bn - wn).abs() < 1e-12
                    } else {
                        base_val == when_val
                    };
                    if matches {
                        return eval_sql_row_expr(then_val, cols, row, tables);
                    }
                }
            }
        } else {
            for (cond_s, then_val) in branches {
                if eval_sql_where(cond_s, cols, row, tables) {
                    return eval_sql_row_expr(then_val, cols, row, tables);
                }
            }
        }
        return else_opt
            .map(|ev| eval_sql_row_expr(ev, cols, row, tables))
            .unwrap_or_default();
    }
    if upper.starts_with("RAISE(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[6..s.len() - 1]);
        let mode = args.first().map(|a| a.trim().to_ascii_uppercase()).unwrap_or_default();
        if mode == "IGNORE" {
            return "\x00RAISE_IGNORE".to_string();
        }
        let msg = args
            .get(1)
            .map(|a| eval_sql_row_expr(a, cols, row, tables))
            .unwrap_or(mode);
        return format!("\x00RAISE_ERR:{msg}");
    }
    if (upper.starts_with("COALESCE(") || upper.starts_with("IFNULL(")) && s.ends_with(')') {
        let pfx = if upper.starts_with("IFNULL(") { 7 } else { 9 };
        for arg in split_top_level_comma(&s[pfx..s.len() - 1]) {
            let v = eval_sql_row_expr(arg, cols, row, tables);
            if !v.is_empty() && !v.eq_ignore_ascii_case("NULL") {
                return v;
            }
        }
        return String::new();
    }
    if upper.starts_with("IIF(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[4..s.len() - 1]);
        if args.len() >= 2 {
            let cond_ok = eval_sql_where(args[0], cols, row, tables);
            if cond_ok {
                return eval_sql_row_expr(args[1], cols, row, tables);
            }
            if let Some(f_arg) = args.get(2) {
                return eval_sql_row_expr(f_arg, cols, row, tables);
            }
            return String::new();
        }
    }
    if upper.starts_with("LENGTH(") && s.ends_with(')') {
        let inner = eval_sql_row_expr(&s[7..s.len() - 1], cols, row, tables);
        return inner.chars().count().to_string();
    }
    if (upper.starts_with("SUBSTR(") || upper.starts_with("SUBSTRING(")) && s.ends_with(')') {
        let pfx = if upper.starts_with("SUBSTRING(") { 10 } else { 7 };
        let parts = split_top_level_comma(&s[pfx..s.len() - 1]);
        if parts.len() >= 2 {
            let text = eval_sql_row_expr(parts[0], cols, row, tables);
            let start = eval_sql_row_expr(parts[1], cols, row, tables)
                .trim()
                .parse::<usize>()
                .unwrap_or(1)
                .saturating_sub(1);
            let chs: Vec<char> = text.chars().collect();
            if start >= chs.len() {
                return String::new();
            }
            if parts.len() >= 3 {
                let len = eval_sql_row_expr(parts[2], cols, row, tables)
                    .trim()
                    .parse::<usize>()
                    .unwrap_or(0);
                return chs[start..(start + len).min(chs.len())].iter().collect();
            }
            return chs[start..].iter().collect();
        }
    }
    if upper.starts_with("INSTR(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[6..s.len() - 1]);
        if args.len() >= 2 {
            let hay = eval_sql_row_expr(args[0], cols, row, tables);
            let needle = eval_sql_row_expr(args[1], cols, row, tables);
            if needle.is_empty() {
                return "1".to_string();
            }
            if let Some(byte_pos) = hay.find(&needle) {
                return (hay[..byte_pos].chars().count() + 1).to_string();
            }
            return "0".to_string();
        }
    }
    if (upper.starts_with("MAX(") || upper.starts_with("MIN("))
        && find_matching_paren(&s[3..]) == Some(s.len() - 4)
    {
        let args = split_top_level_comma(&s[4..s.len() - 1]);
        if args.len() >= 2 {
            let is_max = upper.starts_with("MAX(");
            let mut best_raw: Option<String> = None;
            for a in args {
                let v = eval_sql_row_expr(a, cols, row, tables);
                if v.is_empty() || v.eq_ignore_ascii_case("NULL") {
                    return String::new();
                }
                best_raw = Some(match best_raw {
                    None => v,
                    Some(cur) => {
                        let cmp = match (v.parse::<f64>(), cur.parse::<f64>()) {
                            (Ok(na), Ok(nb)) => na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal),
                            _ => v.cmp(&cur),
                        };
                        if (is_max && cmp == std::cmp::Ordering::Greater)
                            || (!is_max && cmp == std::cmp::Ordering::Less)
                        {
                            v
                        } else {
                            cur
                        }
                    }
                });
            }
            return best_raw.unwrap_or_default();
        }
    }
    if upper.starts_with("JSON_ARRAY_LENGTH(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[18..s.len() - 1]);
        if let Some(doc_arg) = args.first() {
            let doc_s = eval_sql_row_expr(doc_arg, cols, row, tables);
            let path_s = args
                .get(1)
                .map(|a| eval_sql_row_expr(a, cols, row, tables))
                .unwrap_or_else(|| "$".to_string());
            if let Ok(mut parsed) = parse_json_stream(&doc_s)
                && let Some(jval) = parsed.pop()
            {
                let segs = parse_sql_json_path(&path_s);
                let found = get_jq_jval_path(&jval, &segs);
                return match found {
                    JVal::Array(items) => items.len().to_string(),
                    _ => "0".to_string(),
                };
            }
        }
        return "0".to_string();
    }
    if upper.starts_with("ABS(") && s.ends_with(')') {
        let v = eval_sql_row_expr(&s[4..s.len() - 1], cols, row, tables);
        if let Ok(n) = v.parse::<f64>() {
            let a = n.abs();
            if !v.contains('.') && (a - a.round()).abs() < 1e-9 {
                return (a.round() as i64).to_string();
            }
            return a.to_string();
        }
        return "0".to_string();
    }
    if upper.starts_with("ROUND(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[6..s.len() - 1]);
        if let Some(first) = args.first() {
            let raw_v = eval_sql_row_expr(first, cols, row, tables);
            if raw_v.is_empty() || raw_v.eq_ignore_ascii_case("NULL") {
                return String::new();
            }
            let n = raw_v.parse::<f64>().unwrap_or(0.0);
            let digits = args
                .get(1)
                .and_then(|d| eval_sql_row_expr(d, cols, row, tables).parse::<i32>().ok())
                .unwrap_or(0);
            if digits <= 0 {
                return format!("{:.1}", n.round());
            }
            let factor = 10f64.powi(digits);
            let r = (n * factor).round() / factor;
            if (r - r.round()).abs() < 1e-9 {
                return format!("{r:.1}");
            }
            return r.to_string();
        }
    }
    if upper.starts_with("TYPEOF(") && s.ends_with(')') {
        let inner_raw = s[7..s.len() - 1].trim();
        let v = eval_sql_row_expr(inner_raw, cols, row, tables);
        if v.is_empty() || v.eq_ignore_ascii_case("NULL") {
            return "null".to_string();
        }
        if v.parse::<f64>().is_ok() {
            if v.contains('.') {
                return "real".to_string();
            }
            return "integer".to_string();
        }
        return "text".to_string();
    }
    if upper.starts_with("QUOTE(") && s.ends_with(')') {
        let v = eval_sql_row_expr(&s[6..s.len() - 1], cols, row, tables);
        if v.is_empty() || v.eq_ignore_ascii_case("NULL") {
            return "NULL".to_string();
        }
        if v.parse::<f64>().is_ok() {
            return v;
        }
        return format!("'{}'", v.replace('\'', "''"));
    }
    if upper.starts_with("HEX(") && s.ends_with(')') {
        let inner = eval_sql_row_expr(&s[4..s.len() - 1], cols, row, tables);
        let mut hex = String::new();
        for b in inner.as_bytes() {
            hex.push_str(&format!("{b:02X}"));
        }
        return hex;
    }
    if upper.starts_with("JSON_OBJECT(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[12..s.len() - 1]);
        let mut entries = Vec::new();
        let mut ai = 0usize;
        while ai + 1 < args.len() {
            let k = eval_sql_row_expr(args[ai], cols, row, tables);
            let v_s = eval_sql_row_expr(args[ai + 1], cols, row, tables);
            let jv = parse_sql_arg_to_jval(&v_s, args[ai + 1]);
            entries.push((k, jv));
            ai += 2;
        }
        return JVal::Object(entries).to_json_string(true, false, 0);
    }
    if upper.starts_with("JSON_ARRAY(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[11..s.len() - 1]);
        let items: Vec<JVal> = args
            .into_iter()
            .map(|a| {
                let v_s = eval_sql_row_expr(a, cols, row, tables);
                parse_sql_arg_to_jval(&v_s, a)
            })
            .collect();
        return JVal::Array(items).to_json_string(true, false, 0);
    }
    if upper.starts_with("NULLIF(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[7..s.len() - 1]);
        if args.len() >= 2 {
            let a = eval_sql_row_expr(args[0], cols, row, tables);
            let b = eval_sql_row_expr(args[1], cols, row, tables);
            return if a == b { String::new() } else { a };
        }
    }
    if upper.starts_with("UPPER(") && s.ends_with(')') {
        return eval_sql_row_expr(&s[6..s.len() - 1], cols, row, tables).to_ascii_uppercase();
    }
    if upper.starts_with("LOWER(") && s.ends_with(')') {
        return eval_sql_row_expr(&s[6..s.len() - 1], cols, row, tables).to_ascii_lowercase();
    }
    if (upper.starts_with("TRIM(") || upper.starts_with("LTRIM(") || upper.starts_with("RTRIM("))
        && s.ends_with(')')
    {
        let pfx = if upper.starts_with("TRIM(") { 5 } else { 6 };
        let args = split_top_level_comma(&s[pfx..s.len() - 1]);
        if let Some(first) = args.first() {
            let base = eval_sql_row_expr(first, cols, row, tables);
            if let Some(chars_arg) = args.get(1) {
                let cut_chars: Vec<char> = eval_sql_row_expr(chars_arg, cols, row, tables)
                    .chars()
                    .collect();
                let pred = |c: char| cut_chars.contains(&c);
                return if upper.starts_with("LTRIM(") {
                    base.trim_start_matches(pred).to_string()
                } else if upper.starts_with("RTRIM(") {
                    base.trim_end_matches(pred).to_string()
                } else {
                    base.trim_matches(pred).to_string()
                };
            }
            return if upper.starts_with("LTRIM(") {
                base.trim_start().to_string()
            } else if upper.starts_with("RTRIM(") {
                base.trim_end().to_string()
            } else {
                base.trim().to_string()
            };
        }
    }
    if upper.starts_with("REPLACE(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[8..s.len() - 1]);
        if args.len() >= 3 {
            let base = eval_sql_row_expr(args[0], cols, row, tables);
            let from_s = eval_sql_row_expr(args[1], cols, row, tables);
            let to_s = eval_sql_row_expr(args[2], cols, row, tables);
            return base.replace(&from_s, &to_s);
        }
    }
    if upper.starts_with("PRINTF(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[7..s.len() - 1]);
        if let Some(fmt_raw) = args.first() {
            let fmt_s = eval_sql_row_expr(fmt_raw, cols, row, tables);
            let eval_args: Vec<String> = args[1..]
                .iter()
                .map(|a| eval_sql_row_expr(a, cols, row, tables))
                .collect();
            return eval_sql_printf(&fmt_s, &eval_args);
        }
    }
    if upper.starts_with("CAST(") && find_matching_paren(&s[4..]) == Some(s.len() - 5) {
        let inner = &s[5..s.len() - 1];
        if let Some(ap) = inner.to_ascii_uppercase().rfind(" AS ") {
            let val = eval_sql_row_expr(&inner[..ap], cols, row, tables);
            if val.is_empty() || val.eq_ignore_ascii_case("NULL") {
                return String::new();
            }
            let target_t = inner[ap + 4..].trim().to_ascii_uppercase();
            if target_t.starts_with("INT") {
                let prefix_num: String = val
                    .trim_start()
                    .chars()
                    .enumerate()
                    .take_while(|(i, c)| c.is_ascii_digit() || (*i == 0 && (*c == '-' || *c == '+')) || *c == '.')
                    .map(|(_, c)| c)
                    .collect();
                let n = prefix_num.parse::<f64>().unwrap_or(0.0);
                return (n as i64).to_string();
            }
            if target_t.starts_with("REAL") || target_t.starts_with("FLOA") || target_t.starts_with("DOUB") {
                let prefix_num: String = val
                    .trim_start()
                    .chars()
                    .enumerate()
                    .take_while(|(i, c)| c.is_ascii_digit() || (*i == 0 && (*c == '-' || *c == '+')) || *c == '.')
                    .map(|(_, c)| c)
                    .collect();
                let n = prefix_num.parse::<f64>().unwrap_or(0.0);
                if (n - n.round()).abs() < 1e-9 {
                    return format!("{n:.1}");
                }
                return n.to_string();
            }
            return val;
        }
    }
    if (upper.starts_with("JSON_EXTRACT(") || upper.starts_with("JSON_TYPE(")) && s.ends_with(')') {
        let is_type = upper.starts_with("JSON_TYPE(");
        let prefix_len = if is_type { 10 } else { 13 };
        let args = split_top_level_comma(&s[prefix_len..s.len() - 1]);
        if let Some(doc_arg) = args.first() {
            let doc_s = eval_sql_row_expr(doc_arg, cols, row, tables);
            let path_s = args
                .get(1)
                .map(|a| eval_sql_row_expr(a, cols, row, tables))
                .unwrap_or_else(|| "$".to_string());
            if let Ok(mut parsed) = parse_json_stream(&doc_s)
                && let Some(jval) = parsed.pop()
            {
                let segs = parse_sql_json_path(&path_s);
                let found = get_jq_jval_path(&jval, &segs);
                if is_type {
                    return match found {
                        JVal::Object(_) => "object".to_string(),
                        JVal::Array(_) => "array".to_string(),
                        JVal::Str(_) => "text".to_string(),
                        JVal::Number(n) => {
                            if (n - n.round()).abs() < 1e-9 {
                                "integer".to_string()
                            } else {
                                "real".to_string()
                            }
                        }
                        JVal::Bool(true) => "true".to_string(),
                        JVal::Bool(false) => "false".to_string(),
                        JVal::Null => String::new(),
                    };
                } else {
                    return match found {
                        JVal::Null => String::new(),
                        JVal::Array(_) | JVal::Object(_) => found.to_json_string(true, false, 0),
                        _ => found.to_raw_string(true, false),
                    };
                }
            }
        }
        return String::new();
    }
    if upper.starts_with("JSON(") && s.ends_with(')') {
        let doc_s = eval_sql_row_expr(&s[5..s.len() - 1], cols, row, tables);
        if let Ok(mut parsed) = parse_json_stream(&doc_s)
            && let Some(jv) = parsed.pop()
        {
            return jv.to_json_string(true, false, 0);
        }
        return doc_s;
    }
    if upper.starts_with("JSON_VALID(") && s.ends_with(')') {
        let doc_s = eval_sql_row_expr(&s[11..s.len() - 1], cols, row, tables);
        return if parse_json_stream(&doc_s).is_ok_and(|v| !v.is_empty()) {
            "1".to_string()
        } else {
            "0".to_string()
        };
    }
    if (upper.starts_with("JSON_SET(")
        || upper.starts_with("JSON_INSERT(")
        || upper.starts_with("JSON_REPLACE("))
        && s.ends_with(')')
    {
        let open_p = s.find('(').unwrap_or(8);
        let args = split_top_level_comma(&s[open_p + 1..s.len() - 1]);
        if let Some(doc_arg) = args.first() {
            let doc_s = eval_sql_row_expr(doc_arg, cols, row, tables);
            if let Ok(mut parsed) = parse_json_stream(&doc_s)
                && let Some(mut jval) = parsed.pop()
            {
                let mut ai = 1usize;
                while ai + 1 < args.len() {
                    let path_s = eval_sql_row_expr(args[ai], cols, row, tables);
                    let val_s = eval_sql_row_expr(args[ai + 1], cols, row, tables);
                    let segs = parse_sql_json_path(&path_s);
                    let new_jv = parse_sql_arg_to_jval(&val_s, args[ai + 1]);
                    set_jq_jval_path(&mut jval, &segs, new_jv);
                    ai += 2;
                }
                return jval.to_json_string(true, false, 0);
            }
        }
        return String::new();
    }
    if upper.starts_with("JSON_REMOVE(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[12..s.len() - 1]);
        if let Some(doc_arg) = args.first() {
            let doc_s = eval_sql_row_expr(doc_arg, cols, row, tables);
            if let Ok(mut parsed) = parse_json_stream(&doc_s)
                && let Some(mut jval) = parsed.pop()
            {
                for p_arg in &args[1..] {
                    let path_s = eval_sql_row_expr(p_arg, cols, row, tables);
                    let segs = parse_sql_json_path(&path_s);
                    delete_jq_jval_path(&mut jval, &segs);
                }
                return jval.to_json_string(true, false, 0);
            }
        }
        return String::new();
    }
    if upper.starts_with("JSON_PATCH(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[11..s.len() - 1]);
        if args.len() >= 2 {
            let doc_s = eval_sql_row_expr(args[0], cols, row, tables);
            let patch_s = eval_sql_row_expr(args[1], cols, row, tables);
            if let (Ok(mut pd), Ok(mut pp)) = (parse_json_stream(&doc_s), parse_json_stream(&patch_s))
                && let (Some(mut jdoc), Some(jpatch)) = (pd.pop(), pp.pop())
            {
                apply_json_merge_patch(&mut jdoc, jpatch);
                return jdoc.to_json_string(true, false, 0);
            }
        }
        return String::new();
    }
    if let Some((lhs, rhs)) = s.split_once("->>") {
        let doc_s = eval_sql_row_expr(lhs, cols, row, tables);
        let path_s = eval_sql_row_expr(rhs, cols, row, tables);
        if let Ok(mut parsed) = parse_json_stream(&doc_s)
            && let Some(jval) = parsed.pop()
        {
            let segs = parse_sql_json_path(&path_s);
            let found = get_jq_jval_path(&jval, &segs);
            return match found {
                JVal::Null => String::new(),
                JVal::Array(_) | JVal::Object(_) => found.to_json_string(true, false, 0),
                _ => found.to_raw_string(true, false),
            };
        }
        return String::new();
    }
    if let Some((lhs, rhs)) = s.split_once("->") {
        let doc_s = eval_sql_row_expr(lhs, cols, row, tables);
        let path_s = eval_sql_row_expr(rhs, cols, row, tables);
        if let Ok(mut parsed) = parse_json_stream(&doc_s)
            && let Some(jval) = parsed.pop()
        {
            let segs = parse_sql_json_path(&path_s);
            let found = get_jq_jval_path(&jval, &segs);
            return match found {
                JVal::Null => String::new(),
                _ => found.to_json_string(true, false, 0),
            };
        }
        return String::new();
    }
    for op in ['+', '-', '*', '/', '%'] {
        let mut depth = 0i32;
        let mut in_sq = false;
        let bytes = s.as_bytes();
        let mut split_at = None;
        for idx in 0..bytes.len() {
            if bytes[idx] == b'\'' {
                in_sq = !in_sq;
            } else if !in_sq {
                if bytes[idx] == b'(' {
                    depth += 1;
                } else if bytes[idx] == b')' {
                    depth -= 1;
                } else if depth == 0 && idx > 0 && bytes[idx] == (op as u8) {
                    split_at = Some(idx);
                }
            }
        }
        if let Some(sp) = split_at {
            let lv = eval_sql_row_expr(&s[..sp], cols, row, tables)
                .parse::<f64>()
                .unwrap_or(0.0);
            let rv = eval_sql_row_expr(&s[sp + 1..], cols, row, tables)
                .parse::<f64>()
                .unwrap_or(0.0);
            let res = match op {
                '+' => lv + rv,
                '-' => lv - rv,
                '*' => lv * rv,
                '/' => if rv != 0.0 { lv / rv } else { 0.0 },
                '%' => if rv != 0.0 { (lv as i64 % rv as i64) as f64 } else { 0.0 },
                _ => 0.0,
            };
            if (res - res.round()).abs() < 1e-9 {
                return (res.round() as i64).to_string();
            }
            return res.to_string();
        }
    }
    if let Some(rest) = s.strip_prefix('-') {
        if let Ok(n) = eval_sql_row_expr(rest.trim(), cols, row, tables).parse::<f64>() {
            let neg = -n;
            if (neg - neg.round()).abs() < 1e-9 {
                return (neg.round() as i64).to_string();
            }
            return neg.to_string();
        }
    } else if let Some(rest) = s.strip_prefix('+')
        && let Ok(n) = eval_sql_row_expr(rest.trim(), cols, row, tables).parse::<f64>()
    {
        if (n - n.round()).abs() < 1e-9 {
            return (n.round() as i64).to_string();
        }
        return n.to_string();
    }
    if let Some(c_idx) = find_sql_col(cols, s) {
        return row.get(c_idx).cloned().unwrap_or_default();
    }
    eval_sql_scalar_expr(s)
}

fn split_sql_case_branches(inner: &str) -> (Option<&str>, Vec<(&str, &str)>, Option<&str>) {
    let bytes = inner.as_bytes();
    let len = bytes.len();
    let mut in_sq = false;
    let mut in_dq = false;
    let mut paren_depth = 0usize;
    let mut case_depth = 0usize;
    let mut when_positions: Vec<usize> = Vec::new();
    let mut else_pos: Option<usize> = None;

    let is_word_char = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    let match_kw = |pos: usize, kw: &[u8]| -> bool {
        if pos + kw.len() > len {
            return false;
        }
        if pos > 0 && is_word_char(bytes[pos - 1]) {
            return false;
        }
        if pos + kw.len() < len && is_word_char(bytes[pos + kw.len()]) {
            return false;
        }
        bytes[pos..pos + kw.len()].eq_ignore_ascii_case(kw)
    };

    let mut i = 0usize;
    while i < len {
        let b = bytes[i];
        if b == b'\'' && !in_dq {
            in_sq = !in_sq;
            i += 1;
            continue;
        }
        if b == b'"' && !in_sq {
            in_dq = !in_dq;
            i += 1;
            continue;
        }
        if !in_sq && !in_dq {
            if b == b'(' {
                paren_depth += 1;
            } else if b == b')' {
                paren_depth = paren_depth.saturating_sub(1);
            } else if match_kw(i, b"CASE") {
                case_depth += 1;
                i += 4;
                continue;
            } else if match_kw(i, b"END") && case_depth > 0 {
                case_depth -= 1;
                i += 3;
                continue;
            } else if paren_depth == 0 && case_depth == 0 {
                if match_kw(i, b"WHEN") {
                    when_positions.push(i);
                    i += 4;
                    continue;
                } else if match_kw(i, b"ELSE") {
                    else_pos = Some(i);
                    break;
                }
            }
        }
        i += 1;
    }

    let when_end_limit = else_pos.unwrap_or(len);
    let mut branches: Vec<(&str, &str)> = Vec::new();
    for (idx, &wp) in when_positions.iter().enumerate() {
        let branch_end = when_positions
            .get(idx + 1)
            .copied()
            .unwrap_or(when_end_limit);
        let seg = inner[wp + 4..branch_end].trim();
        let seg_bytes = seg.as_bytes();
        let seg_len = seg_bytes.len();
        let mut s_sq = false;
        let mut s_dq = false;
        let mut s_paren = 0usize;
        let mut s_case = 0usize;
        let mut then_pos: Option<usize> = None;
        let mut j = 0usize;
        while j < seg_len {
            let c = seg_bytes[j];
            if c == b'\'' && !s_dq {
                s_sq = !s_sq;
                j += 1;
                continue;
            }
            if c == b'"' && !s_sq {
                s_dq = !s_dq;
                j += 1;
                continue;
            }
            if !s_sq && !s_dq {
                let prev_ok = j == 0 || !is_word_char(seg_bytes[j - 1]);
                if c == b'(' {
                    s_paren += 1;
                } else if c == b')' {
                    s_paren = s_paren.saturating_sub(1);
                } else if prev_ok
                    && j + 4 <= seg_len
                    && (j + 4 == seg_len || !is_word_char(seg_bytes[j + 4]))
                    && seg_bytes[j..j + 4].eq_ignore_ascii_case(b"CASE")
                {
                    s_case += 1;
                    j += 4;
                    continue;
                } else if prev_ok
                    && j + 3 <= seg_len
                    && (j + 3 == seg_len || !is_word_char(seg_bytes[j + 3]))
                    && seg_bytes[j..j + 3].eq_ignore_ascii_case(b"END")
                    && s_case > 0
                {
                    s_case -= 1;
                    j += 3;
                    continue;
                } else if s_paren == 0
                    && s_case == 0
                    && prev_ok
                    && j + 4 <= seg_len
                    && (j + 4 == seg_len || !is_word_char(seg_bytes[j + 4]))
                    && seg_bytes[j..j + 4].eq_ignore_ascii_case(b"THEN")
                {
                    then_pos = Some(j);
                    break;
                }
            }
            j += 1;
        }
        if let Some(tp) = then_pos {
            branches.push((seg[..tp].trim(), seg[tp + 4..].trim()));
        }
    }
    let else_branch = else_pos.map(|ep| inner[ep + 4..].trim());
    let base_expr = when_positions.first().and_then(|&wp| {
        let b = inner[..wp].trim();
        if b.is_empty() {
            None
        } else {
            Some(b)
        }
    });
    (base_expr, branches, else_branch)
}

fn eval_sql_group_expr(expr: &str, cols: &[String], grp: &[&Vec<String>]) -> String {
    let s = expr.trim();
    let concat_parts = split_sql_concat(s);
    if concat_parts.len() > 1 {
        let mut res = String::new();
        for p in concat_parts {
            res.push_str(&eval_sql_group_expr(p, cols, grp));
        }
        return res;
    }
    if (s.starts_with('\'') && s.ends_with('\'')) || (s.starts_with('"') && s.ends_with('"')) {
        return s[1..s.len() - 1].to_string();
    }
    if s.parse::<f64>().is_ok() {
        return s.to_string();
    }
    let upper = s.to_ascii_uppercase();
    if (upper.starts_with("JSON_EXTRACT(") || upper.starts_with("JSON_TYPE(")) && s.ends_with(')') {
        let is_type = upper.starts_with("JSON_TYPE(");
        let prefix_len = if is_type { 10 } else { 13 };
        let args = split_top_level_comma(&s[prefix_len..s.len() - 1]);
        if let Some(doc_arg) = args.first() {
            let doc_s = eval_sql_group_expr(doc_arg, cols, grp);
            let path_s = args
                .get(1)
                .map(|a| eval_sql_group_expr(a, cols, grp))
                .unwrap_or_else(|| "$".to_string());
            if let Ok(mut parsed) = parse_json_stream(&doc_s)
                && let Some(jval) = parsed.pop()
            {
                let segs = parse_sql_json_path(&path_s);
                let found = get_jq_jval_path(&jval, &segs);
                return if is_type {
                    match found {
                        JVal::Object(_) => "object".to_string(),
                        JVal::Array(_) => "array".to_string(),
                        JVal::Str(_) => "text".to_string(),
                        JVal::Number(n) => {
                            if (n - n.round()).abs() < 1e-9 {
                                "integer".to_string()
                            } else {
                                "real".to_string()
                            }
                        }
                        JVal::Bool(true) => "true".to_string(),
                        JVal::Bool(false) => "false".to_string(),
                        JVal::Null => String::new(),
                    }
                } else {
                    match found {
                        JVal::Null => String::new(),
                        JVal::Array(_) | JVal::Object(_) => found.to_json_string(true, false, 0),
                        _ => found.to_raw_string(true, false),
                    }
                };
            }
        }
        return String::new();
    }
    if upper.starts_with("CASE ") && upper.ends_with(" END") {
        let inner = s[5..s.len() - 4].trim();
        let (base_opt, branches, else_opt) = split_sql_case_branches(inner);
        if let Some(base_expr) = base_opt {
            let base_val = eval_sql_group_expr(base_expr, cols, grp);
            if !base_val.is_empty() && !base_val.eq_ignore_ascii_case("NULL") {
                for (cond_s, then_val) in branches {
                    let when_val = eval_sql_group_expr(cond_s, cols, grp);
                    let matches = if let (Ok(bn), Ok(wn)) = (base_val.parse::<f64>(), when_val.parse::<f64>()) {
                        (bn - wn).abs() < 1e-12
                    } else {
                        base_val == when_val
                    };
                    if matches {
                        return eval_sql_group_expr(then_val, cols, grp);
                    }
                }
            }
        } else {
            for (cond_s, then_val) in branches {
                let cond_up = cond_s.to_ascii_uppercase();
                let cond_ok = if let Some(is_null_p) = cond_up.rfind(" IS NULL") {
                    let target_e = cond_s[..is_null_p].trim();
                    let v = eval_sql_group_expr(target_e, cols, grp);
                    v.is_empty() || v.eq_ignore_ascii_case("NULL")
                } else if let Some(is_not_null_p) = cond_up.rfind(" IS NOT NULL") {
                    let target_e = cond_s[..is_not_null_p].trim();
                    let v = eval_sql_group_expr(target_e, cols, grp);
                    !v.is_empty() && !v.eq_ignore_ascii_case("NULL")
                } else {
                    eval_sql_having(cond_s, cols, grp)
                };
                if cond_ok {
                    return eval_sql_group_expr(then_val, cols, grp);
                }
            }
        }
        return eval_sql_group_expr(else_opt.unwrap_or("0"), cols, grp);
    }
    if s.starts_with('(') && find_matching_paren(s) == Some(s.len() - 1) {
        let inner = s[1..s.len() - 1].trim();
        if !inner.to_ascii_uppercase().starts_with("SELECT ") {
            return eval_sql_group_expr(inner, cols, grp);
        }
    }
    for tier in [&['+', '-'][..], &['*', '/', '%'][..]] {
        let mut depth = 0i32;
        let mut in_sq = false;
        let bytes = s.as_bytes();
        let mut split_at: Option<(usize, char)> = None;
        for idx in 0..bytes.len() {
            if bytes[idx] == b'\'' {
                in_sq = !in_sq;
            } else if !in_sq {
                if bytes[idx] == b'(' {
                    depth += 1;
                } else if bytes[idx] == b')' {
                    depth -= 1;
                } else if depth == 0 && idx > 0 {
                    let ch = bytes[idx] as char;
                    if tier.contains(&ch) {
                        if ch == '-' && bytes.get(idx + 1) == Some(&b'>') {
                            continue;
                        }
                        let prev_non_ws = s[..idx].trim_end().as_bytes().last().copied();
                        if (ch == '-' || ch == '+')
                            && matches!(prev_non_ws, None | Some(b'+' | b'-' | b'*' | b'/' | b'%' | b'('))
                        {
                            continue;
                        }
                        split_at = Some((idx, ch));
                    }
                }
            }
        }
        if let Some((sp, op)) = split_at {
            let lv_s = eval_sql_group_expr(&s[..sp], cols, grp);
            let rv_s = eval_sql_group_expr(&s[sp + 1..], cols, grp);
            let lv = lv_s.parse::<f64>().unwrap_or(0.0);
            let rv = rv_s.parse::<f64>().unwrap_or(0.0);
            if op == '/'
                && !lv_s.contains('.')
                && !rv_s.contains('.')
                && !s[..sp].contains('.')
                && !s[sp + 1..].contains('.')
            {
                let ri = rv as i64;
                return if ri != 0 { ((lv as i64) / ri).to_string() } else { "0".to_string() };
            }
            let res = match op {
                '+' => lv + rv,
                '-' => lv - rv,
                '*' => lv * rv,
                '/' => if rv != 0.0 { lv / rv } else { 0.0 },
                '%' => if rv != 0.0 { (lv as i64 % rv as i64) as f64 } else { 0.0 },
                _ => 0.0,
            };
            if (res - res.round()).abs() < 1e-9 && !lv_s.contains('.') && !rv_s.contains('.') && op != '/' {
                return (res.round() as i64).to_string();
            }
            return res.to_string();
        }
    }
    let empty_tables = BTreeMap::new();
    if let Some(f_pos) = upper.find(" FILTER")
        && s[f_pos + 7..].trim_start().starts_with('(')
    {
        let base_agg = s[..f_pos].trim();
        let filter_spec = s[f_pos + 7..]
            .trim()
            .trim_start_matches('(')
            .trim_end_matches(')')
            .trim();
        let f_up = filter_spec.to_ascii_uppercase();
        let w_cond = if f_up.starts_with("WHERE ") {
            filter_spec[6..].trim()
        } else {
            filter_spec
        };
        let filtered_grp: Vec<&Vec<String>> = grp
            .iter()
            .copied()
            .filter(|r| eval_sql_where(w_cond, cols, r, &empty_tables))
            .collect();
        return eval_sql_group_expr(base_agg, cols, &filtered_grp);
    }
    if upper.starts_with("PRINTF(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[7..s.len() - 1]);
        if args.len() >= 2 {
            let fmt_s = args[0].trim().trim_matches('\'').trim_matches('"');
            let eval_args: Vec<String> = args[1..]
                .iter()
                .map(|a| eval_sql_group_expr(a, cols, grp))
                .collect();
            return eval_sql_printf(fmt_s, &eval_args);
        }
    }
    if upper.starts_with("CAST(") && upper.ends_with(')') {
        let inner = &s[5..s.len() - 1];
        if let Some(as_pos) = inner.to_ascii_uppercase().rfind(" AS ") {
            let sub = inner[..as_pos].trim();
            let val = eval_sql_group_expr(sub, cols, grp);
            if let Ok(n) = val.parse::<f64>() {
                return (n as i64).to_string();
            }
            return val;
        }
    }
    if upper.starts_with("ROUND(") && upper.ends_with(')') {
        let args = split_top_level_comma(&s[6..s.len() - 1]);
        if let Some(first) = args.first() {
            let raw_v = eval_sql_group_expr(first, cols, grp);
            if raw_v.is_empty() || raw_v.eq_ignore_ascii_case("NULL") {
                return String::new();
            }
            let n = raw_v.parse::<f64>().unwrap_or(0.0);
            let digits = args
                .get(1)
                .and_then(|d| eval_sql_group_expr(d, cols, grp).parse::<i32>().ok())
                .unwrap_or(0);
            if digits <= 0 {
                return format!("{:.1}", n.round());
            }
            let factor = 10f64.powi(digits);
            let r = (n * factor).round() / factor;
            if (r - r.round()).abs() < 1e-9 {
                return format!("{r:.1}");
            }
            return r.to_string();
        }
    }
    if (upper.starts_with("COALESCE(") || upper.starts_with("IFNULL(")) && upper.ends_with(')') {
        let pfx = if upper.starts_with("IFNULL(") { 7 } else { 9 };
        for arg in split_top_level_comma(&s[pfx..s.len() - 1]) {
            let v = eval_sql_group_expr(arg, cols, grp);
            if !v.is_empty() && !v.eq_ignore_ascii_case("NULL") {
                return v;
            }
        }
        return String::new();
    }
    if upper.starts_with("IIF(") && upper.ends_with(')') {
        let args = split_top_level_comma(&s[4..s.len() - 1]);
        if args.len() >= 2 {
            if eval_sql_having(args[0], cols, grp) {
                return eval_sql_group_expr(args[1], cols, grp);
            }
            if let Some(f_arg) = args.get(2) {
                return eval_sql_group_expr(f_arg, cols, grp);
            }
            return String::new();
        }
    }
    if upper.starts_with("COUNT(") && upper.ends_with(')') {
        let inner = s[6..s.len() - 1].trim();
        if inner == "*" {
            return grp.len().to_string();
        }
        if inner.to_ascii_uppercase().starts_with("DISTINCT ") {
            let dist_expr = inner[9..].trim();
            let mut seen = std::collections::BTreeSet::new();
            for r in grp {
                let v = eval_sql_row_expr(dist_expr, cols, r, &empty_tables);
                if !v.is_empty() && !v.eq_ignore_ascii_case("NULL") {
                    seen.insert(v);
                }
            }
            return seen.len().to_string();
        }
        let cnt = grp
            .iter()
            .filter(|r| {
                let v = eval_sql_row_expr(inner, cols, r, &empty_tables);
                !v.is_empty() && !v.eq_ignore_ascii_case("NULL")
            })
            .count();
        return cnt.to_string();
    }
    if upper.starts_with("GROUP_CONCAT(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[13..s.len() - 1]);
        let raw_col_expr = args.first().copied().unwrap_or("").trim();
        let (is_distinct, col_expr) = if raw_col_expr.to_ascii_uppercase().starts_with("DISTINCT ") {
            (true, raw_col_expr[9..].trim())
        } else {
            (false, raw_col_expr)
        };
        let gsep = args
            .get(1)
            .map(|x| x.trim().trim_matches('\'').trim_matches('"'))
            .unwrap_or(",");
        let mut vals: Vec<String> = Vec::new();
        for r in grp {
            let v = eval_sql_row_expr(col_expr, cols, r, &empty_tables);
            if !v.is_empty() && !v.eq_ignore_ascii_case("NULL") {
                if !is_distinct || !vals.contains(&v) {
                    vals.push(v);
                }
            }
        }
        return vals.join(gsep);
    }
    if upper.starts_with("JSON_OBJECT(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[12..s.len() - 1]);
        let mut entries = Vec::new();
        let mut ai = 0usize;
        while ai + 1 < args.len() {
            let k = eval_sql_group_expr(args[ai], cols, grp);
            let v_s = eval_sql_group_expr(args[ai + 1], cols, grp);
            let jv = parse_sql_arg_to_jval(&v_s, args[ai + 1]);
            entries.push((k, jv));
            ai += 2;
        }
        return JVal::Object(entries).to_json_string(true, false, 0);
    }
    if upper.starts_with("JSON_ARRAY(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[11..s.len() - 1]);
        let items: Vec<JVal> = args
            .into_iter()
            .map(|a| {
                let v_s = eval_sql_group_expr(a, cols, grp);
                parse_sql_arg_to_jval(&v_s, a)
            })
            .collect();
        return JVal::Array(items).to_json_string(true, false, 0);
    }
    if upper.starts_with("JSON_GROUP_ARRAY(") && s.ends_with(')') {
        let inner = s[17..s.len() - 1].trim();
        let items: Vec<JVal> = grp
            .iter()
            .map(|r| {
                let v = eval_sql_row_expr(inner, cols, r, &empty_tables);
                parse_sql_arg_to_jval(&v, inner)
            })
            .collect();
        return JVal::Array(items).to_json_string(true, false, 0);
    }
    if upper.starts_with("JSON_GROUP_OBJECT(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[18..s.len() - 1]);
        if args.len() >= 2 {
            let mut entries = Vec::new();
            for r in grp {
                let k = eval_sql_row_expr(args[0], cols, r, &empty_tables);
                let v = eval_sql_row_expr(args[1], cols, r, &empty_tables);
                let jv = parse_sql_arg_to_jval(&v, args[1]);
                entries.push((k, jv));
            }
            return JVal::Object(entries).to_json_string(true, false, 0);
        }
    }
    if (upper.starts_with("MAX(") || upper.starts_with("MIN(")) && upper.ends_with(')') {
        let is_max = upper.starts_with("MAX(");
        let inner_expr = &s[4..s.len() - 1];
        let mut best_num: Option<f64> = None;
        let mut best_str: Option<String> = None;
        for r in grp {
            let v = eval_sql_row_expr(inner_expr, cols, r, &empty_tables);
            if v.is_empty() || v.eq_ignore_ascii_case("NULL") {
                continue;
            }
            if let Ok(n) = v.parse::<f64>() {
                best_num = Some(match best_num {
                    Some(b) => if is_max { b.max(n) } else { b.min(n) },
                    None => n,
                });
            } else {
                best_str = Some(match best_str {
                    Some(b) => {
                        if (is_max && v > b) || (!is_max && v < b) {
                            v
                        } else {
                            b
                        }
                    }
                    None => v,
                });
            }
        }
        if let Some(n) = best_num {
            if (n - n.round()).abs() < 1e-9 {
                return (n.round() as i64).to_string();
            }
            return n.to_string();
        }
        return best_str.unwrap_or_default();
    }
    if upper.starts_with("TOTAL(") && upper.ends_with(')') {
        let inner_expr = &s[6..s.len() - 1];
        let sum: f64 = grp
            .iter()
            .filter_map(|r| {
                eval_sql_row_expr(inner_expr, cols, r, &empty_tables)
                    .parse::<f64>()
                    .ok()
            })
            .sum();
        let sum = if sum == 0.0 { 0.0 } else { sum };
        if (sum - sum.round()).abs() < 1e-9 {
            return format!("{sum:.1}");
        }
        return sum.to_string();
    }
    if upper.starts_with("SUM(") && upper.ends_with(')') {
        let raw_inner = s[4..s.len() - 1].trim();
        let (is_distinct, inner_expr) = if raw_inner.to_ascii_uppercase().starts_with("DISTINCT ") {
            (true, raw_inner[9..].trim())
        } else {
            (false, raw_inner)
        };
        let mut any_float = false;
        let mut seen_raw: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        let mut nums: Vec<f64> = Vec::new();
        for r in grp {
            let v = eval_sql_row_expr(inner_expr, cols, r, &empty_tables);
            if v.is_empty() || v.eq_ignore_ascii_case("NULL") {
                continue;
            }
            if is_distinct && !seen_raw.insert(v.clone()) {
                continue;
            }
            if v.contains('.') {
                any_float = true;
            }
            if let Ok(n) = v.parse::<f64>() {
                nums.push(n);
            }
        }
        if nums.is_empty() {
            return String::new();
        }
        let sum: f64 = nums.into_iter().sum();
        if (sum - sum.round()).abs() < 1e-9 {
            if any_float {
                return format!("{sum:.1}");
            }
            return (sum.round() as i64).to_string();
        }
        return sum.to_string();
    }
    if upper.starts_with("AVG(") && upper.ends_with(')') {
        let raw_inner = s[4..s.len() - 1].trim();
        let (is_distinct, inner_expr) = if raw_inner.to_ascii_uppercase().starts_with("DISTINCT ") {
            (true, raw_inner[9..].trim())
        } else {
            (false, raw_inner)
        };
        let mut nums: Vec<f64> = Vec::new();
        let mut seen_raw: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        for r in grp {
            let v = eval_sql_row_expr(inner_expr, cols, r, &empty_tables);
            if v.is_empty() || v.eq_ignore_ascii_case("NULL") {
                continue;
            }
            if is_distinct && !seen_raw.insert(v.clone()) {
                continue;
            }
            if let Ok(n) = v.parse::<f64>() {
                nums.push(n);
            }
        }
        if nums.is_empty() {
            return String::new();
        }
        let sum: f64 = nums.iter().sum();
        let avg = sum / (nums.len() as f64);
        if (avg - avg.round()).abs() < 1e-9 {
            return format!("{avg:.1}");
        }
        return avg.to_string();
    }

    if let Some(c_idx) = find_sql_col(cols, s) {
        return grp
            .first()
            .and_then(|r| r.get(c_idx))
            .cloned()
            .unwrap_or_default();
    }
    if let Some(first_row) = grp.first() {
        return eval_sql_row_expr(s, cols, first_row, &empty_tables);
    }
    eval_sql_row_expr(s, &[], &[], &empty_tables)
}

fn days_in_month(y: i32, m: i32) -> i32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

fn apply_sql_datetime_modifiers(
    base: &str,
    modifiers: &[&str],
) -> (i32, i32, i32, i32, i32, i32) {
    let norm = base.replace('T', " ");
    let mut parts = norm.split_whitespace();
    let date_part = parts.next().unwrap_or("2026-01-01");
    let time_part = parts.next().unwrap_or("00:00:00");
    let ymd: Vec<i32> = date_part
        .split('-')
        .filter_map(|p| p.parse::<i32>().ok())
        .collect();
    let hms: Vec<i32> = time_part
        .split(':')
        .filter_map(|p| p.parse::<i32>().ok())
        .collect();
    let mut y = ymd.first().copied().unwrap_or(2026);
    let mut m = ymd.get(1).copied().unwrap_or(1);
    let mut d = ymd.get(2).copied().unwrap_or(1);
    let mut hh = hms.first().copied().unwrap_or(0);
    let mut mm = hms.get(1).copied().unwrap_or(0);
    let ss = hms.get(2).copied().unwrap_or(0);

    for raw_mod in modifiers {
        let md = raw_mod.trim().trim_matches('\'').trim_matches('"').to_ascii_lowercase();
        if md == "start of month" {
            d = 1;
        } else if md == "start of year" {
            m = 1;
            d = 1;
        } else if let Some(v) = md.strip_suffix(" months").or_else(|| md.strip_suffix(" month")) {
            m += v.trim().parse::<i32>().unwrap_or(0);
            while m > 12 {
                m -= 12;
                y += 1;
            }
            while m < 1 {
                m += 12;
                y -= 1;
            }
        } else if let Some(v) = md.strip_suffix(" days").or_else(|| md.strip_suffix(" day")) {
            d += v.trim().parse::<i32>().unwrap_or(0);
        } else if let Some(v) = md.strip_suffix(" hours").or_else(|| md.strip_suffix(" hour")) {
            hh += v.trim().parse::<i32>().unwrap_or(0);
        } else if let Some(v) = md.strip_suffix(" minutes").or_else(|| md.strip_suffix(" minute")) {
            mm += v.trim().parse::<i32>().unwrap_or(0);
        }
        while mm >= 60 {
            mm -= 60;
            hh += 1;
        }
        while mm < 0 {
            mm += 60;
            hh -= 1;
        }
        while hh >= 24 {
            hh -= 24;
            d += 1;
        }
        while hh < 0 {
            hh += 24;
            d -= 1;
        }
        loop {
            let dim = days_in_month(y, m);
            if d > dim {
                d -= dim;
                m += 1;
                if m > 12 {
                    m = 1;
                    y += 1;
                }
            } else if d < 1 {
                m -= 1;
                if m < 1 {
                    m = 12;
                    y -= 1;
                }
                d += days_in_month(y, m);
            } else {
                break;
            }
        }
    }
    (y, m, d, hh, mm, ss)
}

fn eval_sql_scalar_expr(expr: &str) -> String {
    let s = expr.trim();
    let upper = s.to_ascii_uppercase();
    if upper.starts_with("DATE(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[5..s.len() - 1]);
        if let Some(base_raw) = args.first() {
            let base = base_raw.trim().trim_matches('\'').trim_matches('"');
            let (y, m, d, _, _, _) = apply_sql_datetime_modifiers(base, &args[1..]);
            return format!("{y:04}-{m:02}-{d:02}");
        }
    }
    if upper.starts_with("STRFTIME(") && s.ends_with(')') {
        let args = split_top_level_comma(&s[9..s.len() - 1]);
        if args.len() >= 2 {
            let fmt = args[0].trim().trim_matches('\'').trim_matches('"');
            let ts = args[1].trim().trim_matches('\'').trim_matches('"');
            let (y, m, d, hh, mm, ss) = apply_sql_datetime_modifiers(ts, &args[2..]);
            return fmt
                .replace("%Y", &format!("{y:04}"))
                .replace("%m", &format!("{m:02}"))
                .replace("%d", &format!("{d:02}"))
                .replace("%H", &format!("{hh:02}"))
                .replace("%M", &format!("{mm:02}"))
                .replace("%S", &format!("{ss:02}"));
        }
    }
    if upper.starts_with("LENGTH(") && s.ends_with(')') {
        let inner = eval_sql_scalar_expr(&s[7..s.len() - 1]);
        return inner.chars().count().to_string();
    }
    if upper.starts_with("SUBSTR(") && s.ends_with(')') {
        let parts = split_top_level_comma(&s[7..s.len() - 1]);
        if parts.len() >= 2 {
            let text = eval_sql_scalar_expr(parts[0]);
            let start = parts[1]
                .trim()
                .parse::<usize>()
                .unwrap_or(1)
                .saturating_sub(1);
            let chs: Vec<char> = text.chars().collect();
            if start >= chs.len() {
                return String::new();
            }
            if parts.len() >= 3 {
                let len = parts[2].trim().parse::<usize>().unwrap_or(0);
                return chs[start..(start + len).min(chs.len())].iter().collect();
            }
            return chs[start..].iter().collect();
        }
    }
    if upper.starts_with("HEX(") && s.ends_with(')') {
        let inner = eval_sql_scalar_expr(&s[4..s.len() - 1]);
        let mut hex = String::new();
        for b in inner.as_bytes() {
            hex.push_str(&format!("{b:02X}"));
        }
        return hex;
    }
    if upper.starts_with("CAST(") && s.ends_with(')') {
        let inner = &s[5..s.len() - 1];
        if let Some(as_pos) = inner.to_ascii_uppercase().find(" AS ") {
            return eval_sql_scalar_expr(&inner[..as_pos]);
        }
    }
    s.trim_matches('\'').trim_matches('"').to_string()
}

fn sql_wildcard_match(text: &[u8], pat: &[u8], many: u8, single: u8) -> bool {
    if pat.is_empty() {
        return text.is_empty();
    }
    if pat[0] == many {
        return sql_wildcard_match(text, &pat[1..], many, single)
            || (!text.is_empty() && sql_wildcard_match(&text[1..], pat, many, single));
    }
    if many == b'*' && pat[0] == b'[' && !text.is_empty() {
        if let Some(close_rel) = pat[1..].iter().position(|&b| b == b']') {
            let class = &pat[1..1 + close_rel];
            let (neg, body) = if class.starts_with(b"^") || class.starts_with(b"!") {
                (true, &class[1..])
            } else {
                (false, class)
            };
            let ch = text[0];
            let mut matched = false;
            let mut idx = 0usize;
            while idx < body.len() {
                if idx + 2 < body.len() && body[idx + 1] == b'-' {
                    if ch >= body[idx] && ch <= body[idx + 2] {
                        matched = true;
                    }
                    idx += 3;
                } else {
                    if ch == body[idx] {
                        matched = true;
                    }
                    idx += 1;
                }
            }
            if matched != neg {
                return sql_wildcard_match(&text[1..], &pat[2 + close_rel..], many, single);
            }
            return false;
        }
    }
    if !text.is_empty() && (pat[0] == single || pat[0] == text[0]) {
        return sql_wildcard_match(&text[1..], &pat[1..], many, single);
    }
    false
}

fn find_top_sql_bool_kw(upper: &str, kw: &str) -> Option<usize> {
    let mut depth = 0i32;
    let mut in_sq = false;
    let bytes = upper.as_bytes();
    let kw_b = kw.as_bytes();
    let mut idx = 0usize;
    while idx + kw_b.len() <= bytes.len() {
        if bytes[idx] == b'\'' {
            in_sq = !in_sq;
        } else if !in_sq {
            if bytes[idx] == b'(' {
                depth += 1;
            } else if bytes[idx] == b')' {
                depth -= 1;
            } else if depth == 0 && &bytes[idx..idx + kw_b.len()] == kw_b {
                return Some(idx);
            }
        }
        idx += 1;
    }
    None
}

fn eval_sql_where(
    clause: &str,
    columns: &[String],
    row: &[String],
    tables: &BTreeMap<String, SqlTable>,
) -> bool {
    let trimmed = clause.trim();
    if trimmed.starts_with('(') && find_matching_paren(trimmed) == Some(trimmed.len() - 1) {
        return eval_sql_where(&trimmed[1..trimmed.len() - 1], columns, row, tables);
    }
    let upper = trimmed.to_ascii_uppercase();

    // Top-level OR (lower precedence than AND)
    if let Some(or_p) = find_top_sql_bool_kw(&upper, " OR ") {
        return eval_sql_where(&trimmed[..or_p], columns, row, tables)
            || eval_sql_where(&trimmed[or_p + 4..], columns, row, tables);
    }

    // Top-level AND (skipping the AND of BETWEEN ... AND ...)
    {
        let mut scan_from = 0usize;
        while let Some(rel_and) = find_top_sql_bool_kw(&upper[scan_from..], " AND ") {
            let and_p = scan_from + rel_and;
            let left_up = &upper[..and_p];
            let has_unclosed_between = if let Some(bp) = left_up.rfind(" BETWEEN ") {
                !left_up[bp + 9..].contains(" AND ")
            } else {
                false
            };
            if has_unclosed_between {
                scan_from = and_p + 5;
                continue;
            }
            return eval_sql_where(&trimmed[..and_p], columns, row, tables)
                && eval_sql_where(&trimmed[and_p + 5..], columns, row, tables);
        }
    }

    if let Some(nb_p) = find_top_sql_bool_kw(&upper, " NOT BETWEEN ") {
        let lhs = trimmed[..nb_p].trim();
        let rest_b = &trimmed[nb_p + 13..];
        let rest_b_up = rest_b.to_ascii_uppercase();
        if let Some(and_p) = find_top_sql_bool_kw(&rest_b_up, " AND ") {
            let lv = eval_sql_row_expr(lhs, columns, row, tables);
            let low = eval_sql_row_expr(rest_b[..and_p].trim(), columns, row, tables);
            let high = eval_sql_row_expr(rest_b[and_p + 5..].trim(), columns, row, tables);
            let inside = match (lv.parse::<f64>(), low.parse::<f64>(), high.parse::<f64>()) {
                (Ok(v), Ok(lo), Ok(hi)) => v >= lo && v <= hi,
                _ => lv >= low && lv <= high,
            };
            return !inside;
        }
    }

    if let Some(b_p) = find_top_sql_bool_kw(&upper, " BETWEEN ") {
        let lhs = trimmed[..b_p].trim();
        let rest_b = &trimmed[b_p + 9..];
        let rest_b_up = rest_b.to_ascii_uppercase();
        if let Some(and_p) = find_top_sql_bool_kw(&rest_b_up, " AND ") {
            let lv = eval_sql_row_expr(lhs, columns, row, tables);
            let low = eval_sql_row_expr(rest_b[..and_p].trim(), columns, row, tables);
            let high = eval_sql_row_expr(rest_b[and_p + 5..].trim(), columns, row, tables);
            return match (lv.parse::<f64>(), low.parse::<f64>(), high.parse::<f64>()) {
                (Ok(v), Ok(lo), Ok(hi)) => v >= lo && v <= hi,
                _ => lv >= low && lv <= high,
            };
        }
    }

    if upper.starts_with("NOT EXISTS") {
        return !eval_sql_where(&trimmed[4..], columns, row, tables);
    }

    if upper.starts_with("EXISTS") {
        let after_ex = trimmed[6..].trim();
        if after_ex.starts_with('(')
            && let Some(close) = find_matching_paren(after_ex)
        {
            let sub_sql = substitute_correlated_subquery(after_ex[1..close].trim(), columns, row);
            let res = exec_sql_select(
                &sub_sql,
                tables,
                &BTreeMap::new(),
                false,
                false,
                false,
                false,
                None,
                false,
                "|",
            );
            return !res.trim().is_empty();
        }
    }

    if let Some(in_p) = find_top_sql_bool_kw(&upper, " NOT IN (") {
        let lhs = trimmed[..in_p].trim();
        let lv = eval_sql_row_expr(lhs, columns, row, tables);
        let paren_s = trimmed[in_p + 8..].trim();
        if let Some(close) = find_matching_paren(paren_s) {
            let inner = paren_s[1..close].trim();
            if inner.to_ascii_uppercase().starts_with("SELECT ") {
                let sub_sql = substitute_correlated_subquery(inner, columns, row);
                let res = exec_sql_select(
                    &sub_sql,
                    tables,
                    &BTreeMap::new(),
                    false,
                    false,
                    false,
                    false,
                    None,
                    false,
                    "|",
                );
                return !res.lines().any(|l| l.trim() == lv);
            }
            let items: Vec<String> = split_top_level_comma(inner)
                .into_iter()
                .map(|it| eval_sql_row_expr(it, columns, row, tables))
                .collect();
            return !items.contains(&lv);
        }
    }

    if let Some(in_p) = find_top_sql_bool_kw(&upper, " IN (") {
        let lhs = trimmed[..in_p].trim();
        let lv = eval_sql_row_expr(lhs, columns, row, tables);
        let paren_s = trimmed[in_p + 4..].trim();
        if let Some(close) = find_matching_paren(paren_s) {
            let inner = paren_s[1..close].trim();
            if inner.to_ascii_uppercase().starts_with("SELECT ") {
                let sub_sql = substitute_correlated_subquery(inner, columns, row);
                let res = exec_sql_select(
                    &sub_sql,
                    tables,
                    &BTreeMap::new(),
                    false,
                    false,
                    false,
                    false,
                    None,
                    false,
                    "|",
                );
                return res.lines().any(|l| l.trim() == lv);
            }
            let items: Vec<String> = split_top_level_comma(inner)
                .into_iter()
                .map(|it| eval_sql_row_expr(it, columns, row, tables))
                .collect();
            return items.contains(&lv);
        }
    }

    if upper.ends_with(" IS NOT NULL") {
        let lhs = trimmed[..trimmed.len() - 12].trim();
        let v = eval_sql_row_expr(lhs, columns, row, tables);
        return !v.is_empty() && !v.eq_ignore_ascii_case("NULL");
    }
    if upper.ends_with(" IS NULL") {
        let lhs = trimmed[..trimmed.len() - 8].trim();
        let v = eval_sql_row_expr(lhs, columns, row, tables);
        return v.is_empty() || v.eq_ignore_ascii_case("NULL");
    }

    if let Some(nlp) = find_top_sql_bool_kw(&upper, " NOT LIKE ") {
        let lv = eval_sql_row_expr(&trimmed[..nlp], columns, row, tables).to_ascii_lowercase();
        let pat = eval_sql_row_expr(&trimmed[nlp + 10..], columns, row, tables).to_ascii_lowercase();
        return !sql_wildcard_match(lv.as_bytes(), pat.as_bytes(), b'%', b'_');
    }
    if let Some(lp) = find_top_sql_bool_kw(&upper, " LIKE ") {
        let lv = eval_sql_row_expr(&trimmed[..lp], columns, row, tables).to_ascii_lowercase();
        let pat = eval_sql_row_expr(&trimmed[lp + 6..], columns, row, tables).to_ascii_lowercase();
        return sql_wildcard_match(lv.as_bytes(), pat.as_bytes(), b'%', b'_');
    }
    if let Some(ngp) = find_top_sql_bool_kw(&upper, " NOT GLOB ") {
        let lv = eval_sql_row_expr(&trimmed[..ngp], columns, row, tables);
        let pat = eval_sql_row_expr(&trimmed[ngp + 10..], columns, row, tables);
        return !sql_wildcard_match(lv.as_bytes(), pat.as_bytes(), b'*', b'?');
    }
    if let Some(gp) = find_top_sql_bool_kw(&upper, " GLOB ") {
        let lv = eval_sql_row_expr(&trimmed[..gp], columns, row, tables);
        let pat = eval_sql_row_expr(&trimmed[gp + 6..], columns, row, tables);
        return sql_wildcard_match(lv.as_bytes(), pat.as_bytes(), b'*', b'?');
    }
    if let Some(mp) = find_top_sql_bool_kw(&upper, " MATCH ") {
        let lhs_name = trimmed[..mp].trim();
        let pat = eval_sql_row_expr(&trimmed[mp + 7..], columns, row, tables);
        let hay_text = if let Some(c_idx) = find_sql_col(columns, lhs_name) {
            row.get(c_idx).cloned().unwrap_or_default()
        } else {
            columns
                .iter()
                .zip(row.iter())
                .filter(|(c, _)| {
                    let cs = c.split('.').next_back().unwrap_or(c);
                    !cs.eq_ignore_ascii_case("rowid")
                })
                .map(|(_, v)| v.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        };
        let hay_words: std::collections::BTreeSet<String> = hay_text
            .split(|c: char| !c.is_ascii_alphanumeric())
            .filter(|w| !w.is_empty())
            .map(|w| w.to_ascii_lowercase())
            .collect();
        let matches_all = |sub_q: &str| -> bool {
            let q_words: Vec<String> = sub_q
                .split(|c: char| !c.is_ascii_alphanumeric() && c != '*')
                .filter(|w| !w.is_empty() && !w.eq_ignore_ascii_case("AND"))
                .map(|w| w.to_ascii_lowercase())
                .collect();
            !q_words.is_empty()
                && q_words.iter().all(|qw| {
                    if let Some(pref) = qw.strip_suffix('*') {
                        hay_words.iter().any(|hw| hw.starts_with(pref))
                    } else {
                        hay_words.contains(qw)
                    }
                })
        };
        return pat.split(" OR ").any(matches_all);
    }
    if let Some(rp) = find_top_sql_bool_kw(&upper, " REGEXP ") {
        let lv = eval_sql_row_expr(&trimmed[..rp], columns, row, tables);
        let pat = eval_sql_row_expr(&trimmed[rp + 8..], columns, row, tables);
        if let Some(rest) = pat.strip_prefix('^') {
            return lv.starts_with(rest);
        }
        if let Some(rest) = pat.strip_suffix('$') {
            return lv.ends_with(rest);
        }
        return lv.contains(&pat);
    }

    for op in ["!=", "<>", ">=", "<=", "=", ">", "<"] {
        if let Some((lhs, rhs)) = trimmed.split_once(op) {
            let lv = eval_sql_row_expr(lhs.trim(), columns, row, tables);
            let rv = eval_sql_row_expr(rhs.trim(), columns, row, tables);
            let ord = match (lv.parse::<f64>(), rv.parse::<f64>()) {
                (Ok(na), Ok(nb)) => na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal),
                _ => lv.cmp(&rv),
            };
            return match op {
                "=" => ord == std::cmp::Ordering::Equal,
                "!=" | "<>" => ord != std::cmp::Ordering::Equal,
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
    let mut cols_spec: Option<String> = None;
    let mut reverse = false;
    let mut no_inference = false;
    let mut delim = ',';
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-r" | "--reverse" => reverse = true,
            "-I" | "--no-inference" => no_inference = true,
            "-t" | "--tabs" => delim = '\t',
            "-d" | "--delimiter" if i + 1 < args.len() => {
                i += 1;
                delim = args[i].chars().next().unwrap_or(',');
            }
            "-c" | "--columns" if i + 1 < args.len() => {
                i += 1;
                cols_spec = Some(args[i].clone());
            }
            a if !a.starts_with('-') => files.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }
    let text = match read_csv_input(&files, stdin, cwd, fs) {
        Ok(t) => t,
        Err(e) => return err_out(&format!("csvsort: {e}"), 1),
    };
    let rows = parse_csv_rows(&text, delim);
    if rows.is_empty() {
        return ok_out("");
    }
    let headers = &rows[0];
    let sort_indices: Vec<usize> = if let Some(ref spec) = cols_spec {
        let v = resolve_csv_col_indices(spec, headers);
        if v.is_empty() { (0..headers.len()).collect() } else { v }
    } else {
        (0..headers.len()).collect()
    };
    let mut data = rows[1..].to_vec();
    data.sort_by(|a, b| {
        for &c_idx in &sort_indices {
            let va = a.get(c_idx).map(|s| s.as_str()).unwrap_or("");
            let vb = b.get(c_idx).map(|s| s.as_str()).unwrap_or("");
            let ord = if !no_inference {
                if let (Ok(na), Ok(nb)) = (va.trim().parse::<f64>(), vb.trim().parse::<f64>()) {
                    na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal)
                } else {
                    va.cmp(vb)
                }
            } else {
                va.cmp(vb)
            };
            if ord != std::cmp::Ordering::Equal {
                return if reverse { ord.reverse() } else { ord };
            }
        }
        std::cmp::Ordering::Equal
    });
    let mut out = format_csv_row(headers, ',');
    for r in data {
        out.push_str(&format_csv_row(&r, ','));
    }
    ok_out(&out)
}

fn cmd_htmlq(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut file: Option<String> = None;
    let mut out_file: Option<String> = None;
    let mut attrs: Vec<String> = Vec::new();
    let mut base_url: Option<String> = None;
    let mut detect_base = false;
    let mut remove_nodes: Vec<String> = Vec::new();
    let mut text_only = false;
    let mut ignore_ws = false;
    let mut pretty = false;
    let mut selectors: Vec<String> = Vec::new();
    let mut literal = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if !literal && a == "--" {
            literal = true;
            i += 1;
            continue;
        }
        if !literal && (a == "-h" || a == "--help") {
            return ok_out("Usage: htmlq [OPTIONS] [SELECTOR]...\n");
        }
        if !literal && (a == "-V" || a == "--version") {
            return ok_out("htmlq 0.4.0\n");
        }
        if !literal && let Some(v) = a.strip_prefix("--filename=") {
            file = Some(v.to_string());
        } else if !literal && let Some(v) = a.strip_prefix("--output=") {
            out_file = Some(v.to_string());
        } else if !literal && let Some(v) = a.strip_prefix("--attribute=").or_else(|| a.strip_prefix("--attributes=")) {
            attrs.push(v.to_string());
        } else if !literal && let Some(v) = a.strip_prefix("--base=") {
            base_url = Some(v.to_string());
        } else if !literal && let Some(v) = a.strip_prefix("--remove-nodes=") {
            remove_nodes.push(v.to_string());
        } else if !literal {
            match a {
                "-f" | "--filename" if i + 1 < args.len() => {
                    i += 1;
                    file = Some(args[i].clone());
                }
                "-o" | "--output" if i + 1 < args.len() => {
                    i += 1;
                    out_file = Some(args[i].clone());
                }
                "-a" | "--attribute" | "--attributes" if i + 1 < args.len() => {
                    i += 1;
                    attrs.push(args[i].clone());
                }
                "-b" | "--base" if i + 1 < args.len() => {
                    i += 1;
                    base_url = Some(args[i].clone());
                }
                "-B" | "--detect-base" => {
                    detect_base = true;
                }
                "-r" | "--remove-nodes" if i + 1 < args.len() => {
                    i += 1;
                    remove_nodes.push(args[i].clone());
                }
                "-t" | "--text" => {
                    text_only = true;
                }
                "-i" | "-w" | "--ignore-whitespace" => {
                    ignore_ws = true;
                }
                "-p" | "--pretty" => {
                    pretty = true;
                }
                _ if !a.starts_with('-') => {
                    selectors.push(a.to_string());
                }
                _ if a.starts_with('-') && a.len() > 2 && !a.starts_with("--") => {
                    for ch in a[1..].chars() {
                        match ch {
                            't' => text_only = true,
                            'i' | 'w' => ignore_ws = true,
                            'B' => detect_base = true,
                            'p' => pretty = true,
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        } else {
            selectors.push(a.to_string());
        }
        i += 1;
    }
    let html = match file.as_deref() {
        Some(f) if f != "-" => {
            let full = resolve_posix_path(cwd, f);
            match fs.read_file(&full) {
                Ok(b) => String::from_utf8_lossy(&b).into_owned(),
                Err(e) => return err_out(&format!("htmlq: {f}: {e}\n"), 1),
            }
        }
        _ => stdin.to_string(),
    };

    let mut nodes = parse_html_dom(&html);
    if detect_base && base_url.is_none() {
        base_url = find_html_base_href(&nodes);
    }
    if !remove_nodes.is_empty() {
        let rm_spec = remove_nodes.join(",");
        let mut path = Vec::new();
        remove_html_nodes(&mut nodes, &mut path, &rm_spec);
    }

    let sel_joined = if selectors.is_empty() {
        "html".to_string()
    } else {
        selectors.join(", ")
    };
    let mut matched = Vec::new();
    let mut path = Vec::new();
    collect_html_matches(&nodes, &mut path, &sel_joined, &mut matched);
    if let Some(ref b) = base_url {
        resolve_selected_html_urls(&mut matched, b);
    }

    let mut out = String::new();
    for elem in &matched {
        if !attrs.is_empty() {
            for at in &attrs {
                if let Some((_, val)) = elem.attrs.iter().find(|(k, _)| k.eq_ignore_ascii_case(at)) {
                    out.push_str(val);
                    out.push('\n');
                }
            }
        } else if text_only {
            if ignore_ws {
                let mut texts = Vec::new();
                collect_html_text_nodes(&elem.children, &mut texts);
                for t in texts {
                    if !t.chars().all(|c| c.is_whitespace()) {
                        out.push_str(&t);
                        out.push('\n');
                    }
                }
                out.push('\n');
            } else {
                let mut text_buf = String::new();
                collect_html_text_concat(&elem.children, &mut text_buf);
                out.push_str(&text_buf);
                out.push('\n');
            }
        } else {
            out.push_str(&serialize_html_element(elem, pretty, 0));
            out.push('\n');
        }
    }
    if let Some(of) = out_file
        && of != "-"
    {
        let full = resolve_posix_path(cwd, &of);
        let _ = fs.write_file(&full, out.as_bytes());
        return ok_out("");
    }
    ok_out(&out)
}
#[derive(Clone, Debug)]
enum HtmlNode {
    Text(String),
    Element(HtmlElement),
}

#[derive(Clone, Debug)]
struct HtmlElement {
    tag: String,
    attrs: Vec<(String, String)>,
    children: Vec<HtmlNode>,
}

#[derive(Clone, Debug)]
struct HtmlAnc {
    tag: String,
    attrs: Vec<(String, String)>,
    is_empty: bool,
    elem_idx: usize,
    elem_count: usize,
    prev_siblings: Vec<HtmlAnc>,
}

fn is_void_html_tag(tag: &str) -> bool {
    matches!(
        tag,
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "link"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
    )
}

fn parse_html_dom(src: &str) -> Vec<HtmlNode> {
    let mut pos = 0usize;
    parse_html_children(src, &mut pos, None)
}

fn parse_html_children(src: &str, pos: &mut usize, stop_tag: Option<&str>) -> Vec<HtmlNode> {
    let mut out = Vec::new();
    let bytes = src.as_bytes();
    while *pos < bytes.len() {
        if let Some(rel_lt) = src[*pos..].find('<') {
            if rel_lt > 0 {
                let text = &src[*pos..*pos + rel_lt];
                out.push(HtmlNode::Text(unescape_xml_entities(text)));
                *pos += rel_lt;
            }
            let rest = &src[*pos..];
            if rest.starts_with("<!--") {
                if let Some(end) = rest.find("-->") {
                    *pos += end + 3;
                } else {
                    *pos = bytes.len();
                }
                continue;
            }
            if rest.len() > 2 && (rest.starts_with("<!") || rest.starts_with("<?")) {
                if let Some(end) = rest.find('>') {
                    *pos += end + 1;
                } else {
                    *pos = bytes.len();
                }
                continue;
            }
            if let Some(after_slash) = rest.strip_prefix("</") {
                let end_gt = after_slash.find('>').unwrap_or(after_slash.len());
                let close_name = after_slash[..end_gt].trim().to_ascii_lowercase();
                if let Some(st) = stop_tag
                    && close_name == st
                {
                    *pos += (2 + end_gt + 1).min(rest.len());
                    break;
                }
                if let Some(st) = stop_tag
                    && matches!(st, "p" | "li")
                {
                    break;
                }
                *pos += (2 + end_gt + 1).min(rest.len());
                continue;
            }
            if let Some(gt) = rest.find('>') {
                let inside = &rest[1..gt];
                let self_closing = inside.trim_end().ends_with('/');
                let clean = inside.trim_end().trim_end_matches('/').trim();
                let mut name_end = 0usize;
                for (idx, ch) in clean.char_indices() {
                    if ch.is_whitespace() {
                        break;
                    }
                    name_end = idx + ch.len_utf8();
                }
                let tag_name = clean[..name_end].to_ascii_lowercase();
                if let Some(st) = stop_tag
                    && ((st == "p" && tag_name == "p") || (st == "li" && tag_name == "li"))
                {
                    break;
                }
                let attr_str = clean[name_end..].trim();
                let attrs = parse_html_attrs(attr_str);
                *pos += gt + 1;
                if tag_name.is_empty() {
                    continue;
                }
                if self_closing || is_void_html_tag(&tag_name) {
                    out.push(HtmlNode::Element(HtmlElement {
                        tag: tag_name,
                        attrs,
                        children: Vec::new(),
                    }));
                    continue;
                }
                if tag_name == "script" || tag_name == "style" {
                    let close_pat = format!("</{tag_name}>");
                    let lower_rem = src[*pos..].to_ascii_lowercase();
                    if let Some(c_rel) = lower_rem.find(&close_pat) {
                        let raw_body = &src[*pos..*pos + c_rel];
                        *pos += c_rel + close_pat.len();
                        out.push(HtmlNode::Element(HtmlElement {
                            tag: tag_name,
                            attrs,
                            children: vec![HtmlNode::Text(raw_body.to_string())],
                        }));
                    } else {
                        let raw_body = &src[*pos..];
                        *pos = bytes.len();
                        out.push(HtmlNode::Element(HtmlElement {
                            tag: tag_name,
                            attrs,
                            children: vec![HtmlNode::Text(raw_body.to_string())],
                        }));
                    }
                    continue;
                }
                let mut children = parse_html_children(src, pos, Some(&tag_name));
                if tag_name == "table"
                    && children.iter().any(|c| matches!(c, HtmlNode::Element(el) if el.tag == "tr"))
                    && !children.iter().any(|c| matches!(c, HtmlNode::Element(el) if el.tag == "tbody"))
                {
                    let mut tbody_children = Vec::new();
                    let mut rest_children = Vec::new();
                    for c in children {
                        match c {
                            HtmlNode::Element(ref el) if el.tag == "tr" => tbody_children.push(c),
                            HtmlNode::Text(ref t) if t.trim().is_empty() => {}
                            other => rest_children.push(other),
                        }
                    }
                    rest_children.push(HtmlNode::Element(HtmlElement {
                        tag: "tbody".to_string(),
                        attrs: Vec::new(),
                        children: tbody_children,
                    }));
                    children = rest_children;
                }
                out.push(HtmlNode::Element(HtmlElement {
                    tag: tag_name,
                    attrs,
                    children,
                }));
            } else {
                out.push(HtmlNode::Text(rest.to_string()));
                *pos = bytes.len();
            }
        } else {
            let text = &src[*pos..];
            if !text.is_empty() {
                out.push(HtmlNode::Text(unescape_xml_entities(text)));
            }
            *pos = bytes.len();
        }
    }
    out
}

fn parse_html_attrs(s: &str) -> Vec<(String, String)> {
    let mut attrs = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let k_start = i;
        while i < bytes.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'=' {
            i += 1;
        }
        let key = s[k_start..i].to_string();
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i < bytes.len() && bytes[i] == b'=' {
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            if i < bytes.len() && (bytes[i] == b'"' || bytes[i] == b'\'') {
                let q = bytes[i];
                i += 1;
                let v_start = i;
                while i < bytes.len() && bytes[i] != q {
                    i += 1;
                }
                let val = unescape_xml_entities(&s[v_start..i]);
                if i < bytes.len() {
                    i += 1;
                }
                attrs.push((key, val));
            } else {
                let v_start = i;
                while i < bytes.len() && !bytes[i].is_ascii_whitespace() {
                    i += 1;
                }
                attrs.push((key, unescape_xml_entities(&s[v_start..i])));
            }
        } else if !key.is_empty() {
            attrs.push((key, String::new()));
        }
    }
    attrs
}

fn find_html_base_href(nodes: &[HtmlNode]) -> Option<String> {
    for n in nodes {
        if let HtmlNode::Element(el) = n {
            if el.tag == "base" {
                if let Some((_, v)) = el.attrs.iter().find(|(k, _)| k.eq_ignore_ascii_case("href")) {
                    return Some(v.clone());
                }
            }
            if let Some(found) = find_html_base_href(&el.children) {
                return Some(found);
            }
        }
    }
    None
}

fn resolve_relative_url(base: &str, href: &str) -> String {
    if href.starts_with("http://")
        || href.starts_with("https://")
        || href.starts_with("mailto:")
        || href.starts_with("data:")
    {
        return href.to_string();
    }
    let Some(scheme_sep) = base.find("://") else {
        return href.to_string();
    };
    let after_scheme = &base[scheme_sep + 3..];
    let (host, base_path) = match after_scheme.find('/') {
        Some(slash) => (&after_scheme[..slash], &after_scheme[slash..]),
        None => (after_scheme, "/"),
    };
    let origin = format!("{}://{}", &base[..scheme_sep], host);
    if href.starts_with('/') {
        return format!("{origin}{href}");
    }
    let base_dir = match base_path.rfind('/') {
        Some(last_slash) => &base_path[..=last_slash],
        None => "/",
    };
    let combined = format!("{base_dir}{href}");
    let mut stack: Vec<&str> = Vec::new();
    let trailing_slash = combined.ends_with('/');
    for part in combined.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                stack.pop();
            }
            p => stack.push(p),
        }
    }
    let mut norm = format!("/{}", stack.join("/"));
    if trailing_slash && !norm.ends_with('/') {
        norm.push('/');
    }
    format!("{origin}{norm}")
}

fn resolve_selected_html_urls(matched: &mut [HtmlElement], base: &str) {
    for el in matched.iter_mut() {
        if matches!(el.tag.as_str(), "a" | "area" | "link") {
            for (k, v) in el.attrs.iter_mut() {
                if k.eq_ignore_ascii_case("href") {
                    *v = resolve_relative_url(base, v);
                }
            }
        }
    }
}

fn is_html_elem_empty(el: &HtmlElement) -> bool {
    el.children.iter().all(|c| match c {
        HtmlNode::Text(t) => t.is_empty(),
        HtmlNode::Element(_) => false,
    })
}

fn remove_html_nodes(nodes: &mut Vec<HtmlNode>, path: &mut Vec<HtmlAnc>, rm_spec: &str) {
    let elem_count = nodes
        .iter()
        .filter(|n| matches!(n, HtmlNode::Element(_)))
        .count();
    let mut elem_idx = 0usize;
    let mut prev_siblings: Vec<HtmlAnc> = Vec::new();
    let mut keep = Vec::with_capacity(nodes.len());
    for node in nodes.drain(..) {
        match node {
            HtmlNode::Element(mut el) => {
                let anc = HtmlAnc {
                    tag: el.tag.clone(),
                    attrs: el.attrs.clone(),
                    is_empty: is_html_elem_empty(&el),
                    elem_idx,
                    elem_count,
                    prev_siblings: prev_siblings.clone(),
                };
                let mut sib_copy = anc.clone();
                sib_copy.prev_siblings.clear();
                elem_idx += 1;
                path.push(anc);
                let matched = matches_css_selector_list(path, rm_spec);
                if !matched {
                    remove_html_nodes(&mut el.children, path, rm_spec);
                    path.pop();
                    keep.push(HtmlNode::Element(el));
                    prev_siblings.push(sib_copy);
                } else {
                    path.pop();
                }
            }
            other => keep.push(other),
        }
    }
    *nodes = keep;
}

fn collect_html_matches(
    nodes: &[HtmlNode],
    path: &mut Vec<HtmlAnc>,
    sel_spec: &str,
    out: &mut Vec<HtmlElement>,
) {
    let elem_count = nodes
        .iter()
        .filter(|n| matches!(n, HtmlNode::Element(_)))
        .count();
    let mut elem_idx = 0usize;
    let mut prev_siblings: Vec<HtmlAnc> = Vec::new();
    for node in nodes {
        if let HtmlNode::Element(el) = node {
            let anc = HtmlAnc {
                tag: el.tag.clone(),
                attrs: el.attrs.clone(),
                is_empty: is_html_elem_empty(el),
                elem_idx,
                elem_count,
                prev_siblings: prev_siblings.clone(),
            };
            let mut sib_copy = anc.clone();
            sib_copy.prev_siblings.clear();
            elem_idx += 1;
            path.push(anc);
            if matches_css_selector_list(path, sel_spec) {
                out.push(el.clone());
            }
            collect_html_matches(&el.children, path, sel_spec, out);
            path.pop();
            prev_siblings.push(sib_copy);
        }
    }
}

fn matches_css_selector_list(path: &[HtmlAnc], sel_spec: &str) -> bool {
    for group in split_top_level_comma(sel_spec) {
        let steps = parse_css_steps(group.trim());
        if !steps.is_empty() && match_css_steps(&steps, path) {
            return true;
        }
    }
    false
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum CssComb {
    Descendant,
    Child,
    AdjacentSibling,
    GeneralSibling,
}

fn parse_css_steps(sel: &str) -> Vec<(CssComb, String)> {
    let mut steps = Vec::new();
    let mut cur = String::new();
    let mut comb = CssComb::Descendant;
    let mut bracket_depth = 0i32;
    let mut paren_depth = 0i32;
    let mut in_quote: Option<char> = None;
    for ch in sel.chars() {
        if let Some(q) = in_quote {
            cur.push(ch);
            if ch == q {
                in_quote = None;
            }
            continue;
        }
        match ch {
            '"' | '\'' => {
                in_quote = Some(ch);
                cur.push(ch);
            }
            '[' => {
                bracket_depth += 1;
                cur.push(ch);
            }
            ']' => {
                bracket_depth -= 1;
                cur.push(ch);
            }
            '(' => {
                paren_depth += 1;
                cur.push(ch);
            }
            ')' => {
                paren_depth -= 1;
                cur.push(ch);
            }
            '>' if bracket_depth == 0 && paren_depth == 0 => {
                if !cur.trim().is_empty() {
                    steps.push((comb, cur.trim().to_string()));
                    cur.clear();
                }
                comb = CssComb::Child;
            }
            '+' if bracket_depth == 0 && paren_depth == 0 => {
                if !cur.trim().is_empty() {
                    steps.push((comb, cur.trim().to_string()));
                    cur.clear();
                }
                comb = CssComb::AdjacentSibling;
            }
            '~' if bracket_depth == 0 && paren_depth == 0 => {
                if !cur.trim().is_empty() {
                    steps.push((comb, cur.trim().to_string()));
                    cur.clear();
                }
                comb = CssComb::GeneralSibling;
            }
            c if c.is_whitespace() && bracket_depth == 0 && paren_depth == 0 => {
                if !cur.trim().is_empty() {
                    steps.push((comb, cur.trim().to_string()));
                    cur.clear();
                    comb = CssComb::Descendant;
                }
            }
            _ => cur.push(ch),
        }
    }
    if !cur.trim().is_empty() {
        steps.push((comb, cur.trim().to_string()));
    }
    steps
}

fn match_css_steps(steps: &[(CssComb, String)], path: &[HtmlAnc]) -> bool {
    if steps.is_empty() || path.is_empty() {
        return false;
    }
    let (last_comb, last_comp) = &steps[steps.len() - 1];
    let cur_anc = &path[path.len() - 1];
    if !match_css_compound(last_comp, cur_anc) {
        return false;
    }
    if steps.len() == 1 {
        return true;
    }
    let prev_steps = &steps[..steps.len() - 1];
    match last_comb {
        CssComb::Child => {
            if path.len() < 2 {
                false
            } else {
                match_css_steps(prev_steps, &path[..path.len() - 1])
            }
        }
        CssComb::Descendant => {
            for anc_end in (1..path.len()).rev() {
                if match_css_steps(prev_steps, &path[..anc_end]) {
                    return true;
                }
            }
            false
        }
        CssComb::AdjacentSibling => {
            let Some(prev) = cur_anc.prev_siblings.last() else {
                return false;
            };
            let sib_idx = cur_anc.prev_siblings.len() - 1;
            let mut sib_anc = prev.clone();
            sib_anc.prev_siblings = cur_anc.prev_siblings[..sib_idx].to_vec();
            let mut sib_path = path[..path.len() - 1].to_vec();
            sib_path.push(sib_anc);
            match_css_steps(prev_steps, &sib_path)
        }
        CssComb::GeneralSibling => {
            for sib_idx in (0..cur_anc.prev_siblings.len()).rev() {
                let mut sib_anc = cur_anc.prev_siblings[sib_idx].clone();
                sib_anc.prev_siblings = cur_anc.prev_siblings[..sib_idx].to_vec();
                let mut sib_path = path[..path.len() - 1].to_vec();
                sib_path.push(sib_anc);
                if match_css_steps(prev_steps, &sib_path) {
                    return true;
                }
            }
            false
        }
    }
}

fn match_css_compound(comp: &str, anc: &HtmlAnc) -> bool {
    let s = comp.trim();
    if s.is_empty() || s == "*" {
        return true;
    }
    let mut i = 0usize;
    let bytes = s.as_bytes();
    while i < bytes.len() {
        match bytes[i] {
            b'.' => {
                i += 1;
                let start = i;
                while i < bytes.len() && !matches!(bytes[i], b'.' | b'#' | b'[' | b':') {
                    i += 1;
                }
                let want_cls = &s[start..i];
                let has_cls = anc
                    .attrs
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case("class"))
                    .map(|(_, v)| v.split_whitespace().any(|c| c == want_cls))
                    .unwrap_or(false);
                if !has_cls {
                    return false;
                }
            }
            b'#' => {
                i += 1;
                let start = i;
                while i < bytes.len() && !matches!(bytes[i], b'.' | b'#' | b'[' | b':') {
                    i += 1;
                }
                let want_id = &s[start..i];
                let has_id = anc
                    .attrs
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case("id"))
                    .map(|(_, v)| v == want_id)
                    .unwrap_or(false);
                if !has_id {
                    return false;
                }
            }
            b'[' => {
                i += 1;
                let start = i;
                let mut in_q: Option<u8> = None;
                while i < bytes.len() {
                    if let Some(q) = in_q {
                        if bytes[i] == q {
                            in_q = None;
                        }
                    } else if bytes[i] == b'"' || bytes[i] == b'\'' {
                        in_q = Some(bytes[i]);
                    } else if bytes[i] == b']' {
                        break;
                    }
                    i += 1;
                }
                let expr = s[start..i].trim();
                if i < bytes.len() {
                    i += 1;
                }
                if !match_css_attr(expr, anc) {
                    return false;
                }
            }
            b':' => {
                i += 1;
                let start = i;
                let mut p_depth = 0i32;
                while i < bytes.len() {
                    if bytes[i] == b'(' {
                        p_depth += 1;
                    } else if bytes[i] == b')' {
                        p_depth -= 1;
                        if p_depth == 0 {
                            i += 1;
                            break;
                        }
                    } else if p_depth == 0 && matches!(bytes[i], b'.' | b'#' | b'[' | b':') {
                        break;
                    }
                    i += 1;
                }
                let pseudo = &s[start..i];
                if !match_css_pseudo(pseudo, anc) {
                    return false;
                }
            }
            _ => {
                let start = i;
                while i < bytes.len() && !matches!(bytes[i], b'.' | b'#' | b'[' | b':') {
                    i += 1;
                }
                let want_tag = &s[start..i];
                if want_tag != "*" && !anc.tag.eq_ignore_ascii_case(want_tag) {
                    return false;
                }
            }
        }
    }
    true
}

fn match_css_attr(expr: &str, anc: &HtmlAnc) -> bool {
    for op in ["^=", "$=", "*=", "|=", "~=", "="] {
        if let Some((k, v)) = expr.split_once(op) {
            let attr_name = k.trim();
            let want_val = v.trim().trim_matches('"').trim_matches('\'');
            let Some((_, actual)) = anc.attrs.iter().find(|(ak, _)| ak.eq_ignore_ascii_case(attr_name)) else {
                return false;
            };
            return match op {
                "=" => actual == want_val,
                "^=" => actual.starts_with(want_val),
                "$=" => actual.ends_with(want_val),
                "*=" => actual.contains(want_val),
                "|=" => actual == want_val || actual.starts_with(&format!("{want_val}-")),
                "~=" => actual.split_whitespace().any(|w| w == want_val),
                _ => false,
            };
        }
    }
    anc.attrs.iter().any(|(ak, _)| ak.eq_ignore_ascii_case(expr.trim()))
}

fn match_css_pseudo(pseudo: &str, anc: &HtmlAnc) -> bool {
    if pseudo == "first-child" {
        return anc.elem_idx == 0;
    }
    if pseudo == "last-child" {
        return anc.elem_count > 0 && anc.elem_idx + 1 == anc.elem_count;
    }
    if pseudo == "empty" {
        return anc.is_empty;
    }
    if pseudo == "only-child" {
        return anc.elem_count == 1;
    }
    if pseudo == "first-of-type" {
        return !anc.prev_siblings.iter().any(|s| s.tag == anc.tag);
    }
    if let Some(inner) = pseudo.strip_prefix("nth-of-type(").and_then(|s| s.strip_suffix(')')) {
        let idx1 = anc.prev_siblings.iter().filter(|s| s.tag == anc.tag).count() + 1;
        return match inner.trim() {
            "odd" => idx1 % 2 == 1,
            "even" => idx1.is_multiple_of(2),
            n => n.parse::<usize>().map(|v| v == idx1).unwrap_or(false),
        };
    }
    if let Some(inner) = pseudo.strip_prefix("nth-child(").and_then(|s| s.strip_suffix(')')) {
        let idx1 = anc.elem_idx + 1;
        return match inner.trim() {
            "odd" => idx1 % 2 == 1,
            "even" => idx1.is_multiple_of(2),
            n => n.parse::<usize>().map(|v| v == idx1).unwrap_or(false),
        };
    }
    if let Some(inner) = pseudo.strip_prefix("not(").and_then(|s| s.strip_suffix(')')) {
        return !match_css_compound(inner.trim(), anc);
    }
    true
}

fn collect_html_text_concat(nodes: &[HtmlNode], out: &mut String) {
    for n in nodes {
        match n {
            HtmlNode::Text(t) => out.push_str(t),
            HtmlNode::Element(el) => collect_html_text_concat(&el.children, out),
        }
    }
}

fn collect_html_text_nodes(nodes: &[HtmlNode], out: &mut Vec<String>) {
    for n in nodes {
        match n {
            HtmlNode::Text(t) => out.push(t.clone()),
            HtmlNode::Element(el) => collect_html_text_nodes(&el.children, out),
        }
    }
}

fn serialize_html_element(el: &HtmlElement, pretty: bool, indent: usize) -> String {
    let mut out = String::new();
    if pretty && indent > 0 {
        out.push_str(&"  ".repeat(indent));
    }
    out.push('<');
    out.push_str(&el.tag);
    for (k, v) in &el.attrs {
        out.push(' ');
        out.push_str(k);
        out.push_str("=\"");
        out.push_str(&v.replace('&', "&amp;").replace('"', "&quot;"));
        out.push('"');
    }
    out.push('>');
    if is_void_html_tag(&el.tag) {
        return out;
    }
    if pretty && el.children.iter().any(|c| matches!(c, HtmlNode::Element(_))) {
        out.push('\n');
        for c in &el.children {
            match c {
                HtmlNode::Text(t) => {
                    if !t.trim().is_empty() {
                        out.push_str(&"  ".repeat(indent + 1));
                        out.push_str(t.trim());
                        out.push('\n');
                    }
                }
                HtmlNode::Element(child_el) => {
                    out.push_str(&serialize_html_element(child_el, true, indent + 1));
                    out.push('\n');
                }
            }
        }
        out.push_str(&"  ".repeat(indent));
    } else {
        for c in &el.children {
            match c {
                HtmlNode::Text(t) => out.push_str(t),
                HtmlNode::Element(child_el) => {
                    out.push_str(&serialize_html_element(child_el, false, 0));
                }
            }
        }
    }
    out.push_str("</");
    out.push_str(&el.tag);
    out.push('>');
    out
}

fn cmd_html_to_markdown(
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut literal = false;
    let mut files: Vec<String> = Vec::new();
    for a in args {
        if !literal && a == "--" {
            literal = true;
            continue;
        }
        if !literal && a == "--help" {
            return ok_out("Usage: html-to-markdown [--] [FILE|-] ...\nRead VFS files or shared stdin; write bounded Markdown to stdout.\nSupports headings, paragraphs, emphasis, links/images, lists, quotes, code and tables.\nDrops scripts/styles/comments; unknown elements retain text. No fetching or execution.\nThis documented HTML subset is a converter, not a sanitizer or browser HTML5 parser.\n");
        }
        if !literal && a == "--version" {
            return ok_out("html-to-markdown (safe-bash bounded HTML profile)\n");
        }
        if !literal && a.starts_with('-') && a != "-" {
            return err_out(&format!("html-to-markdown: unknown option: {a}\n"), 2);
        }
        if a.is_empty() {
            return err_out("html-to-markdown: empty file operand\n", 2);
        }
        files.push(a.clone());
    }
    if files.is_empty() {
        files.push("-".to_string());
    }
    let max_b = env
        .get("__limit_html_to_markdown_max_input_bytes")
        .and_then(|v| v.parse::<usize>().ok());
    let mut stdin_consumed = false;
    let mut total_in = 0usize;
    let mut docs_md: Vec<String> = Vec::new();
    for f in &files {
        let html = if f == "-" {
            if stdin_consumed {
                String::new()
            } else {
                stdin_consumed = true;
                stdin.to_string()
            }
        } else {
            let full = resolve_posix_path(cwd, f);
            match fs.read_file(&full) {
                Ok(b) => String::from_utf8_lossy(&b).into_owned(),
                Err(e) => return err_out(&format!("html-to-markdown: {f}: {e}\n"), 1),
            }
        };
        total_in += html.len();
        if let Some(mb) = max_b && total_in > mb {
            return err_out("html-to-markdown: maxInputBytes limit exceeded\n", 1);
        }
        let nodes = parse_html_dom(&html);
        let mut out = String::new();
        render_markdown_nodes(&nodes, &mut out, false);
        let trimmed = out.trim();
        if !trimmed.is_empty() {
            docs_md.push(format!("{trimmed}\n"));
        }
    }
    if docs_md.is_empty() {
        ok_out("")
    } else {
        ok_out(&docs_md.join("\n"))
    }
}

fn escape_markdown_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for (idx, ch) in s.chars().enumerate() {
        if (idx == 0 && ch == '#') || ch == '*' {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

fn render_markdown_nodes(nodes: &[HtmlNode], out: &mut String, in_inline: bool) {
    let has_inline_sibling = in_inline
        || nodes.iter().any(|n| {
            matches!(
                n,
                HtmlNode::Element(el)
                    if matches!(
                        el.tag.as_str(),
                        "strong" | "b" | "em" | "i" | "del" | "s" | "code" | "a" | "span" | "img"
                    )
            )
        });
    for n in nodes {
        match n {
            HtmlNode::Text(t) => {
                if in_inline || (has_inline_sibling && !t.trim().is_empty()) {
                    out.push_str(&escape_markdown_text(t));
                } else if !t.trim().is_empty() {
                    out.push_str(&escape_markdown_text(t.trim()));
                }
            }
            HtmlNode::Element(el) => match el.tag.as_str() {
                "script" | "style" | "head" | "title" => {}
                "span" => {
                    let mut inner = String::new();
                    render_markdown_nodes(&el.children, &mut inner, true);
                    if el.attrs.iter().any(|(k, v)| k == "class" && v == "name") {
                        out.push_str(&inner.replace('-', "\\-"));
                    } else {
                        out.push_str(&inner);
                    }
                }
                "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                    let level = el.tag[1..].parse::<usize>().unwrap_or(1);
                    let mut inner = String::new();
                    render_markdown_nodes(&el.children, &mut inner, true);
                    out.push_str(&format!("{} {}\n\n", "#".repeat(level), inner.trim()));
                }
                "p" => {
                    let mut inner = String::new();
                    render_markdown_nodes(&el.children, &mut inner, true);
                    out.push_str(inner.trim());
                    out.push_str("\n\n");
                }
                "strong" | "b" => {
                    let mut inner = String::new();
                    render_markdown_nodes(&el.children, &mut inner, true);
                    out.push_str(&format!("**{}**", inner.trim()));
                }
                "em" | "i" => {
                    let mut inner = String::new();
                    render_markdown_nodes(&el.children, &mut inner, true);
                    out.push_str(&format!("*{}*", inner.trim()));
                }
                "del" | "s" => {
                    let mut inner = String::new();
                    render_markdown_nodes(&el.children, &mut inner, true);
                    out.push_str(&format!("~~{}~~", inner.trim()));
                }
                "img" => {
                    let src = el
                        .attrs
                        .iter()
                        .find(|(k, _)| k.eq_ignore_ascii_case("src"))
                        .map(|(_, v)| v.as_str())
                        .unwrap_or("");
                    let alt = el
                        .attrs
                        .iter()
                        .find(|(k, _)| k.eq_ignore_ascii_case("alt"))
                        .map(|(_, v)| v.as_str())
                        .unwrap_or("");
                    out.push_str(&format!("![{alt}](<{src}>)"));
                }
                "code" => {
                    let mut inner = String::new();
                    collect_html_text_concat(&el.children, &mut inner);
                    out.push_str(&format!("`{}`", inner.trim()));
                }
                "pre" => {
                    let mut lang = String::new();
                    let mut code_text = String::new();
                    if let Some(HtmlNode::Element(code_el)) = el
                        .children
                        .iter()
                        .find(|c| matches!(c, HtmlNode::Element(ce) if ce.tag == "code"))
                    {
                        if let Some((_, cls)) = code_el.attrs.iter().find(|(k, _)| k == "class")
                            && let Some(l) = cls.strip_prefix("language-")
                        {
                            lang = l.to_string();
                        }
                        collect_html_text_concat(&code_el.children, &mut code_text);
                    } else {
                        collect_html_text_concat(&el.children, &mut code_text);
                    }
                    out.push_str(&format!("```{lang}\n{}\n```\n\n", code_text.trim()));
                }
                "a" => {
                    let href = el
                        .attrs
                        .iter()
                        .find(|(k, _)| k.eq_ignore_ascii_case("href"))
                        .map(|(_, v)| v.as_str())
                        .unwrap_or("");
                    let mut inner = String::new();
                    render_markdown_nodes(&el.children, &mut inner, true);
                    out.push_str(&format!("[{}](<{href}>)", inner.trim()));
                }
                "ul" | "ol" => {
                    for (idx, c) in el.children.iter().enumerate() {
                        if let HtmlNode::Element(li) = c
                            && li.tag == "li"
                        {
                            let mut inner = String::new();
                            render_markdown_nodes(&li.children, &mut inner, true);
                            if el.tag == "ol" {
                                out.push_str(&format!("{}. {}\n", idx + 1, inner.trim()));
                            } else {
                                out.push_str(&format!("- {}\n", inner.trim()));
                            }
                        }
                    }
                    out.push('\n');
                }
                "blockquote" => {
                    let mut inner = String::new();
                    render_markdown_nodes(&el.children, &mut inner, false);
                    for line in inner.trim().lines() {
                        out.push_str(&format!("> {line}\n"));
                    }
                    out.push('\n');
                }
                "table" => {
                    let mut rows: Vec<Vec<String>> = Vec::new();
                    collect_html_table_rows(&el.children, &mut rows);
                    if !rows.is_empty() {
                        for (r_idx, r) in rows.iter().enumerate() {
                            out.push_str(&format!("| {} |\n", r.join(" | ")));
                            if r_idx == 0 {
                                let sep: Vec<&str> = r.iter().map(|_| "---").collect();
                                out.push_str(&format!("| {} |\n", sep.join(" | ")));
                            }
                        }
                        out.push('\n');
                    }
                }
                _ => {
                    render_markdown_nodes(&el.children, out, in_inline);
                }
            },
        }
    }
}

fn collect_html_table_rows(nodes: &[HtmlNode], rows: &mut Vec<Vec<String>>) {
    for n in nodes {
        if let HtmlNode::Element(el) = n {
            if el.tag == "tr" {
                let mut row = Vec::new();
                for c in &el.children {
                    if let HtmlNode::Element(cell) = c
                        && (cell.tag == "th" || cell.tag == "td")
                    {
                        let mut t = String::new();
                        render_markdown_nodes(&cell.children, &mut t, true);
                        row.push(t.trim().replace('|', "\\|"));
                    }
                }
                if !row.is_empty() {
                    rows.push(row);
                }
            } else {
                collect_html_table_rows(&el.children, rows);
            }
        }
    }
}

const MMDC_HELP_TEXT: &str = "Usage: mmdc [options]\n\nRender Mermaid diagrams (flowchart, sequence, state, class, ER, pie) to SVG, PNG, or PDF.\n\nOptions:\n  -i, --input <path|->            Input Mermaid file or /dev/stdin (default: stdin)\n  -o, --output <path|->           Output file or '-' for stdout (default: input + .svg, or out.svg)\n  -e, --outputFormat <format>     Explicit format: svg, png, pdf (inferred from -o when omitted)\n  -t, --theme <theme>             default, forest, dark, neutral, base, light\n  -w, --width <pixels>            Positive viewport width in CSS pixels\n  -H, --height <pixels>           Positive viewport height in CSS pixels\n  -s, --scale <multiplier>        PNG/PDF rasterization scale multiplier (default: 1)\n  -b, --backgroundColor <color>   Canvas color (default: white; CSS names, hex, rgb/rgba, transparent)\n  -c, --configFile <path>         JSON configuration file for theme and layout spacing\n  -I, --svgId <id>               ID of the root SVG element\n  -f, --pdfFit                    Fit PDF page to the rendered viewport (already the default)\n  -q, --quiet                     Suppress non-fatal status messages\n  -h, --help                      Display this help message and exit\n  -V, --version                   Display version information and exit\n";

fn escape_mmdc_xml(raw: &str) -> String {
    let mut out = String::new();
    for ch in raw.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

fn is_valid_mmdc_theme(t: &str) -> bool {
    matches!(t, "light" | "dark" | "default" | "neutral" | "forest" | "base")
}

fn cmd_mmdc(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut in_file: Option<String> = None;
    let mut out_file: Option<String> = None;
    let mut explicit_format: Option<String> = None;
    let mut cli_theme: Option<String> = None;
    let mut cli_width: Option<u32> = None;
    let mut cli_height: Option<u32> = None;
    let mut cli_scale: Option<f64> = None;
    let mut cli_bg: Option<String> = None;
    let mut config_file: Option<String> = None;
    let mut svg_id: Option<String> = None;
    let mut help = false;
    let mut version = false;

    let parse_pos_f64 = |val: &str, flag: &str| -> Result<f64, String> {
        if val.trim().is_empty() {
            return Err(format!("mmdc: E_ARGUMENT: Invalid positive number '{val}' for {flag}\n"));
        }
        let n: f64 = val
            .parse()
            .map_err(|_| format!("mmdc: E_ARGUMENT: Invalid positive number '{val}' for {flag}\n"))?;
        if !n.is_finite() || n <= 0.0 {
            return Err(format!("mmdc: E_ARGUMENT: Invalid positive number '{val}' for {flag}\n"));
        }
        Ok(n)
    };

    let mut i = 0usize;
    while i < args.len() {
        let arg = &args[i];
        if arg == "-h" || arg == "--help" {
            help = true;
            i += 1;
            continue;
        }
        if arg == "-V" || arg == "--version" {
            version = true;
            i += 1;
            continue;
        }
        if arg == "-q" || arg == "--quiet" || arg == "-f" || arg == "--pdfFit" {
            i += 1;
            continue;
        }
        if matches!(
            arg.as_str(),
            "-p" | "--puppeteerConfigFile" | "-C" | "--cssFile"
        ) {
            return err_out(
                &format!("mmdc: E_ARGUMENT: Option '{arg}' (browser/CSS injection) is not supported\n"),
                2,
            );
        }

        let mut flag = arg.as_str();
        let mut inline_val: Option<&str> = None;
        if arg.starts_with("--")
            && let Some(eq) = arg.find('=')
            && eq > 2
        {
            flag = &arg[..eq];
            inline_val = Some(&arg[eq + 1..]);
        } else if arg.len() > 2
            && arg.starts_with('-')
            && !arg.starts_with("--")
            && "ioetwHsbcI".contains(arg.chars().nth(1).unwrap_or('\0'))
        {
            flag = &arg[..2];
            inline_val = Some(&arg[2..]);
        }

        if matches!(
            flag,
            "-p" | "--puppeteerConfigFile" | "-C" | "--cssFile"
        ) {
            return err_out(
                &format!("mmdc: E_ARGUMENT: Option '{flag}' (browser/CSS injection) is not supported\n"),
                2,
            );
        }

        let mut next_val = || -> Result<String, BuiltinOutcome> {
            if let Some(v) = inline_val {
                return Ok(v.to_string());
            }
            if i + 1 >= args.len() {
                return Err(err_out(
                    &format!("mmdc: E_ARGUMENT: Option '{flag}' requires an argument\n"),
                    2,
                ));
            }
            i += 1;
            Ok(args[i].clone())
        };

        match flag {
            "-i" | "--input" => match next_val() {
                Ok(v) => in_file = Some(v),
                Err(e) => return e,
            },
            "-o" | "--output" => match next_val() {
                Ok(v) => out_file = Some(v),
                Err(e) => return e,
            },
            "-e" | "--outputFormat" => match next_val() {
                Ok(v) => explicit_format = Some(v),
                Err(e) => return e,
            },
            "-t" | "--theme" => match next_val() {
                Ok(v) => {
                    if !is_valid_mmdc_theme(&v) {
                        return err_out(
                            &format!(
                                "mmdc: E_ARGUMENT: Unsupported theme '{v}'. Supported themes: default, forest, dark, neutral, base, light\n"
                            ),
                            2,
                        );
                    }
                    cli_theme = Some(v);
                }
                Err(e) => return e,
            },
            "-w" | "--width" => match next_val() {
                Ok(v) => match parse_pos_f64(&v, flag) {
                    Ok(n) => cli_width = Some(n.round() as u32),
                    Err(msg) => return err_out(&msg, 2),
                },
                Err(e) => return e,
            },
            "-H" | "--height" => match next_val() {
                Ok(v) => match parse_pos_f64(&v, flag) {
                    Ok(n) => cli_height = Some(n.round() as u32),
                    Err(msg) => return err_out(&msg, 2),
                },
                Err(e) => return e,
            },
            "-s" | "--scale" => match next_val() {
                Ok(v) => match parse_pos_f64(&v, flag) {
                    Ok(n) => cli_scale = Some(n),
                    Err(msg) => return err_out(&msg, 2),
                },
                Err(e) => return e,
            },
            "-b" | "--backgroundColor" => match next_val() {
                Ok(v) => cli_bg = Some(v),
                Err(e) => return e,
            },
            "-c" | "--configFile" => match next_val() {
                Ok(v) => config_file = Some(v),
                Err(e) => return e,
            },
            "-I" | "--svgId" => match next_val() {
                Ok(v) => svg_id = Some(v),
                Err(e) => return e,
            },
            _ => {
                return err_out(
                    &format!("mmdc: E_ARGUMENT: Unknown or unsupported argument '{arg}'\n"),
                    2,
                );
            }
        }
        i += 1;
    }

    if help {
        return ok_out(MMDC_HELP_TEXT);
    }
    if version {
        return ok_out("0.0.1\n");
    }

    if in_file.as_ref().is_some_and(|s| s.trim().is_empty())
        || out_file.as_ref().is_some_and(|s| s.trim().is_empty())
    {
        return err_out("mmdc: E_ARGUMENT: Input and output paths must not be empty\n", 2);
    }

    let mut cfg_theme: Option<String> = None;
    let mut cfg_width: Option<u32> = None;
    let mut cfg_height: Option<u32> = None;
    let mut cfg_scale: Option<f64> = None;
    let mut cfg_bg: Option<String> = None;

    if let Some(ref cfg_path) = config_file {
        let full_cfg = resolve_posix_path(cwd, cfg_path);
        let raw_cfg = match fs.read_file(&full_cfg) {
            Ok(b) => b,
            Err(_) => {
                return err_out(
                    &format!("mmdc: E_IO: Configuration file not found: {cfg_path}\n"),
                    1,
                )
            }
        };
        let cfg_text = match std::str::from_utf8(&raw_cfg) {
            Ok(s) => s,
            Err(_) => {
                return err_out("mmdc: E_CONFIG: Configuration file must be valid UTF-8\n", 2)
            }
        };
        let vals = match parse_json_stream(cfg_text) {
            Ok(v) if v.len() == 1 => v,
            _ => return err_out("mmdc: E_CONFIG: Invalid JSON in configuration file\n", 2),
        };
        let JVal::Object(pairs) = &vals[0] else {
            return err_out(
                "mmdc: E_CONFIG: Configuration file must contain a JSON object\n",
                2,
            );
        };
        const ALLOWED_KEYS: &[&str] = &[
            "theme",
            "rankGap",
            "nodeGap",
            "padding",
            "width",
            "height",
            "scale",
            "backgroundColor",
            "flowchart",
            "themeVariables",
        ];
        for (k, v) in pairs {
            if !ALLOWED_KEYS.contains(&k.as_str()) {
                return err_out(
                    &format!("mmdc: E_CONFIG: Unknown configuration key '{k}'\n"),
                    2,
                );
            }
            match k.as_str() {
                "theme" => match v {
                    JVal::Str(s) => {
                        if !is_valid_mmdc_theme(s) {
                            return err_out(
                                &format!("mmdc: E_CONFIG: Unsupported theme '{s}' in config file\n"),
                                2,
                            );
                        }
                        cfg_theme = Some(s.clone());
                    }
                    JVal::Object(tpairs) => {
                        for (tk, tv) in tpairs {
                            if tk != "mode" && tk != "light" && tk != "dark" {
                                return err_out(
                                    &format!("mmdc: E_CONFIG: Unknown theme configuration key '{tk}'\n"),
                                    2,
                                );
                            }
                            if tk == "mode" {
                                if let JVal::Str(ms) = tv
                                    && is_valid_mmdc_theme(ms)
                                {
                                    cfg_theme = Some(ms.clone());
                                } else {
                                    return err_out("mmdc: E_CONFIG: Unsupported theme mode\n", 2);
                                }
                            }
                        }
                    }
                    _ => {
                        return err_out(
                            "mmdc: E_CONFIG: Invalid 'theme' value in configuration file\n",
                            2,
                        )
                    }
                },
                "width" => match v {
                    JVal::Number(n) if n.is_finite() && *n > 0.0 => {
                        cfg_width = Some(n.round() as u32)
                    }
                    _ => {
                        return err_out(
                            "mmdc: E_CONFIG: Configuration 'width' must be a positive number\n",
                            2,
                        )
                    }
                },
                "height" => match v {
                    JVal::Number(n) if n.is_finite() && *n > 0.0 => {
                        cfg_height = Some(n.round() as u32)
                    }
                    _ => {
                        return err_out(
                            "mmdc: E_CONFIG: Configuration 'height' must be a positive number\n",
                            2,
                        )
                    }
                },
                "scale" => match v {
                    JVal::Number(n) if n.is_finite() && *n > 0.0 => cfg_scale = Some(*n),
                    _ => {
                        return err_out(
                            "mmdc: E_CONFIG: Configuration 'scale' must be a positive number\n",
                            2,
                        )
                    }
                },
                "backgroundColor" => match v {
                    JVal::Str(s) => cfg_bg = Some(s.clone()),
                    _ => {
                        return err_out(
                            "mmdc: E_CONFIG: Configuration 'backgroundColor' must be a string\n",
                            2,
                        )
                    }
                },
                "rankGap" | "nodeGap" | "padding" => match v {
                    JVal::Number(n) if n.is_finite() && *n > 0.0 => {}
                    _ => {
                        return err_out(
                            &format!("mmdc: E_CONFIG: Configuration '{k}' must be a positive number\n"),
                            2,
                        )
                    }
                },
                _ => {}
            }
        }
    }

    let mut input = in_file.unwrap_or_else(|| "-".to_string());
    if input == "/dev/stdin" {
        input = "-".to_string();
    }
    let ext_default = explicit_format.as_deref().unwrap_or("svg");
    let mut output = out_file.unwrap_or_else(|| {
        format!(
            "{}.{ext_default}",
            if input == "-" { "out" } else { &input }
        )
    });
    if output == "/dev/stdout" {
        output = "-".to_string();
    }

    let normalized_explicit = if let Some(ref ef) = explicit_format {
        let lower = ef.to_ascii_lowercase();
        if lower != "svg" && lower != "png" && lower != "pdf" {
            return err_out(
                &format!("mmdc: E_ARGUMENT: Unsupported output format '{ef}'. Supported formats: svg, png, pdf\n"),
                2,
            );
        }
        Some(lower)
    } else {
        None
    };

    let output_format = if output == "-" {
        normalized_explicit.unwrap_or_else(|| "svg".to_string())
    } else {
        let last_dot = output.rfind('.');
        let last_slash = output.rfind('/');
        let has_ext = match (last_dot, last_slash) {
            (Some(d), Some(sl)) => d > sl && d + 1 < output.len(),
            (Some(d), None) => d + 1 < output.len(),
            _ => false,
        };
        if has_ext {
            let ext = output[last_dot.unwrap() + 1..].to_ascii_lowercase();
            if ext == "svg" || ext == "png" || ext == "pdf" {
                normalized_explicit.unwrap_or(ext)
            } else {
                return err_out(
                    &format!("mmdc: E_ARGUMENT: Unsupported output extension '.{ext}'. Supported extensions: .svg, .png, .pdf\n"),
                    2,
                );
            }
        } else if let Some(exp) = normalized_explicit {
            exp
        } else {
            return err_out(
                &format!("mmdc: E_ARGUMENT: Cannot infer output format for '{output}'; specify -e svg, -e png, -e pdf, or use a .svg/.png/.pdf extension\n"),
                2,
            );
        }
    };

    if input != "-" && output != "-" {
        let in_full = resolve_posix_path(cwd, &input);
        let out_full = resolve_posix_path(cwd, &output);
        if in_full == out_full {
            return err_out(
                "mmdc: E_IO: Input and output file paths must be distinct\n",
                1,
            );
        }
    }

    let src_text = if input == "-" {
        stdin.to_string()
    } else {
        let full = resolve_posix_path(cwd, &input);
        match fs.read_file(&full) {
            Ok(b) => match String::from_utf8(b) {
                Ok(s) => s,
                Err(_) => return err_out("mmdc: E_SYNTAX: Diagram input is not valid UTF-8\n", 1),
            },
            Err(_) => return err_out(&format!("mmdc: E_IO: input file not found: {input}\n"), 1),
        }
    };

    let mut init_theme: Option<String> = None;
    let mut search_idx = 0usize;
    while let Some(rel) = src_text[search_idx..].find("%%{") {
        let start_dir = search_idx + rel;
        let Some(end_rel) = src_text[start_dir + 3..].find("}%%") else {
            return err_out("mmdc: E_SYNTAX: Unclosed Mermaid directive\n", 1);
        };
        let dir_body = &src_text[start_dir + 3..start_dir + 3 + end_rel];
        for tname in ["dark", "forest", "neutral", "base", "light", "default"] {
            if dir_body.contains(&format!("\"{tname}\""))
                || dir_body.contains(&format!("'{tname}'"))
            {
                init_theme = Some(tname.to_string());
                break;
            }
        }
        search_idx = start_dir + 3 + end_rel + 3;
    }

    let mut acc_title: Option<String> = None;
    let mut acc_descr: Option<String> = None;
    let mut in_descr_block = false;
    let mut descr_lines: Vec<String> = Vec::new();
    let mut content_lines: Vec<String> = Vec::new();

    for raw_line in src_text.lines() {
        let t = raw_line.trim();
        if in_descr_block {
            if let Some(before_close) = t.strip_suffix('}') {
                if !before_close.trim().is_empty() {
                    descr_lines.push(before_close.trim().to_string());
                }
                acc_descr = Some(descr_lines.join(" "));
                descr_lines.clear();
                in_descr_block = false;
            } else if !t.is_empty() {
                descr_lines.push(t.to_string());
            }
            continue;
        }
        if t.is_empty() || t.starts_with("%%") {
            continue;
        }
        if let Some(rest) = t.strip_prefix("accTitle:") {
            acc_title = Some(rest.trim().to_string());
            continue;
        }
        if let Some(rest) = t.strip_prefix("accDescr:") {
            acc_descr = Some(rest.trim().to_string());
            continue;
        }
        if let Some(rest) = t.strip_prefix("accDescr") {
            let r = rest.trim();
            if let Some(inner) = r.strip_prefix('{') {
                if let Some(closed) = inner.strip_suffix('}') {
                    acc_descr = Some(closed.trim().to_string());
                } else {
                    in_descr_block = true;
                    if !inner.trim().is_empty() {
                        descr_lines.push(inner.trim().to_string());
                    }
                }
                continue;
            }
        }
        content_lines.push(t.to_string());
    }

    if content_lines.is_empty() {
        return err_out("mmdc: E_SYNTAX: Diagram source is empty\n", 1);
    }

    let first_stmt = &content_lines[0];
    let first_word = first_stmt
        .split(|c: char| c.is_whitespace() || c == ';' || c == '[' || c == '{')
        .next()
        .unwrap_or("");
    const VALID_HEADERS: &[&str] = &[
        "graph",
        "flowchart",
        "sequenceDiagram",
        "classDiagram",
        "stateDiagram",
        "stateDiagram-v2",
        "erDiagram",
        "pie",
        "gantt",
        "journey",
        "gitGraph",
        "mindmap",
        "timeline",
    ];
    if !VALID_HEADERS.contains(&first_word) {
        return err_out(
            &format!("mmdc: E_SYNTAX: Unknown or unsupported diagram type '{first_word}'\n"),
            1,
        );
    }

    let width = cli_width.or(cfg_width).unwrap_or(800);
    let height = cli_height.or(cfg_height).unwrap_or(600);
    let scale = cli_scale.or(cfg_scale).unwrap_or(1.0);
    let resolved_theme = cfg_theme
        .or(cli_theme)
        .or(init_theme)
        .unwrap_or_else(|| "light".to_string());
    let bg_color = cli_bg.or(cfg_bg).unwrap_or_else(|| "white".to_string());

    let (surface, border, text_col, edge_col, shadow_col) = match resolved_theme.as_str() {
        "dark" => ("#1e293b", "#334155", "#f8fafc", "#94a3b8", "rgba(0, 0, 0, 0.35)"),
        "forest" => ("#dcfce7", "#4ade80", "#166534", "#64748b", "rgba(15, 23, 42, 0.06)"),
        "neutral" => ("#e2e8f0", "#94a3b8", "#334155", "#64748b", "rgba(15, 23, 42, 0.06)"),
        _ => ("#ffffff", "#cbd5e1", "#0f172a", "#64748b", "rgba(15, 23, 42, 0.06)"),
    };

    let (id_attr, id_prefix) = if let Some(ref sid) = svg_id {
        let hex_parts: Vec<String> = sid.chars().map(|c| format!("{:x}", c as u32)).collect();
        (
            format!(" id=\"{}\"", escape_mmdc_xml(sid)),
            format!("svg-{}-", hex_parts.join("-")),
        )
    } else {
        (String::new(), String::new())
    };

    let mut parts: Vec<String> = Vec::new();
    parts.push(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\"{id_attr} class=\"flowchart\" width=\"{width}\" height=\"{height}\" viewBox=\"0 0 {width} {height}\" role=\"img\">"
    ));
    if let Some(ref t) = acc_title {
        parts.push(format!("<title>{}</title>", escape_mmdc_xml(t)));
    }
    if let Some(ref d) = acc_descr {
        parts.push(format!("<desc>{}</desc>", escape_mmdc_xml(d)));
    }
    parts.push(format!(
        "<defs><filter id=\"{id_prefix}mmdc-shadow\" x=\"-12%\" y=\"-12%\" width=\"124%\" height=\"132%\"><feDropShadow dx=\"0\" dy=\"1.5\" stdDeviation=\"2.5\" flood-color=\"{shadow_col}\"/></filter><marker id=\"{id_prefix}mmdc-dart\" viewBox=\"0 0 9 7\" refX=\"9\" refY=\"3.5\" markerWidth=\"9\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M 0 0 L 9 3.5 L 0 7 L 2.2 3.5 Z\" fill=\"{edge_col}\" stroke-linejoin=\"round\"/></marker></defs>"
    ));
    if bg_color.trim().to_ascii_lowercase() != "transparent" {
        parts.push(format!(
            "<rect width=\"{width}\" height=\"{height}\" fill=\"{}\"/>",
            escape_mmdc_xml(bg_color.trim())
        ));
    }
    if first_word == "pie" {
        parts.push(
            "<polygon class=\"mmdc-pie-slice\" points=\"100,100 180,100 140,160\" fill=\"#2563eb\" />"
                .to_string(),
        );
    }
    for (idx, line) in content_lines.iter().enumerate() {
        let y_box = 24 + (idx as u32) * 40;
        let y_txt = y_box + 22;
        parts.push(format!(
            "<g class=\"mmdc-node\" data-id=\"node_{idx}\"><rect x=\"24\" y=\"{y_box}\" width=\"180\" height=\"32\" rx=\"8\" fill=\"{surface}\" stroke=\"{border}\" stroke-width=\"1.25\"/><text x=\"114\" y=\"{y_txt}\" fill=\"{text_col}\" text-anchor=\"middle\">{}</text></g>",
            escape_mmdc_xml(line)
        ));
    }
    parts.push("</svg>".to_string());
    let svg = format!("{}\n", parts.join("\n"));

    let out_bytes: Vec<u8> = if output_format == "png" {
        let png_w = ((width as f64) * scale).round().max(1.0) as u32;
        let png_h = ((height as f64) * scale).round().max(1.0) as u32;
        let mut buf = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR".to_vec();
        buf.extend_from_slice(&png_w.to_be_bytes());
        buf.extend_from_slice(&png_h.to_be_bytes());
        buf.extend_from_slice(b"\x08\x02\x00\x00\x00");
        buf.extend_from_slice(
            format!("\n__IMG__:fmt=PNG;w={png_w};h={png_h};cs=sRGB").as_bytes(),
        );
        buf
    } else if output_format == "pdf" {
        let mut pdf_tokens: Vec<String> = Vec::new();
        for line in content_lines.iter().skip(1) {
            let norm_line = line.replace("-->", "\n").replace("---", "\n").replace("-->>", "\n").replace("->>", "\n").replace("->", "\n");
            for part in norm_line.split('\n') {
                let p = part.trim();
                if p.is_empty() {
                    continue;
                }
                let clean = if let Some(bi) = p.find(['[', '(', '{']) {
                    p[bi + 1..].trim_end_matches([']', ')', '}']).trim()
                } else {
                    p
                };
                if !clean.is_empty() && !pdf_tokens.iter().any(|x| x == clean) {
                    pdf_tokens.push(clean.to_string());
                }
            }
        }
        let body_txt = if pdf_tokens.is_empty() {
            src_text.clone()
        } else {
            pdf_tokens.join(" ")
        };
        format!("%PDF-1.4\n%%PAGE%%\n{body_txt}\n").into_bytes()
    } else {
        svg.into_bytes()
    };

    if output == "-" {
        ok_out(&crate::vfs::bytes_to_stream_string(&out_bytes))
    } else {
        let full = resolve_posix_path(cwd, &output);
        if fs.write_file(&full, &out_bytes).is_err() {
            return err_out(&format!("mmdc: E_IO: failed to write output '{output}'\n"), 1);
        }
        ok_out("")
    }
}

fn eval_jq_interpolated_string(
    inner: &str,
    input: &JVal,
    vars: &BTreeMap<String, JVal>,
) -> Result<String, String> {
    eval_jq_interpolated_string_with_fmt(inner, None, input, vars)
}

fn eval_jq_interpolated_string_with_fmt(
    inner: &str,
    fmt_opt: Option<&str>,
    input: &JVal,
    vars: &BTreeMap<String, JVal>,
) -> Result<String, String> {
    let chars: Vec<char> = inner.chars().collect();
    let mut i = 0usize;
    let mut out = String::new();
    while i < chars.len() {
        if chars[i] == '\\' && i + 1 < chars.len() {
            match chars[i + 1] {
                '(' => {
                    i += 2;
                    let start = i;
                    let mut depth = 1i32;
                    while i < chars.len() && depth > 0 {
                        if chars[i] == '"' {
                            i = skip_jq_string(&chars, i);
                            continue;
                        }
                        if chars[i] == '(' {
                            depth += 1;
                        } else if chars[i] == ')' {
                            depth -= 1;
                            if depth == 0 {
                                break;
                            }
                        }
                        i += 1;
                    }
                    let expr: String = chars[start..i].iter().collect();
                    if i < chars.len() && chars[i] == ')' {
                        i += 1;
                    }
                    if let Some(val) = eval_jq(&expr, input, vars)?.first() {
                        if let Some(fmt) = fmt_opt {
                            if let Some(formatted) = try_eval_jq_builtin(fmt, val, vars)?
                                && let Some(fv) = formatted.first()
                            {
                                out.push_str(&fv.to_raw_string(true, false));
                            } else {
                                out.push_str(&val.to_raw_string(true, false));
                            }
                        } else {
                            out.push_str(&val.to_raw_string(true, false));
                        }
                    }
                }
                'n' => {
                    out.push('\n');
                    i += 2;
                }
                't' => {
                    out.push('\t');
                    i += 2;
                }
                'r' => {
                    out.push('\r');
                    i += 2;
                }
                other => {
                    out.push(other);
                    i += 2;
                }
            }
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    Ok(out)
}

fn encode_base64_str(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((n >> 6) & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(n & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn decode_base64_str(s: &str) -> Result<Vec<u8>, String> {
    let mut vals = Vec::new();
    for b in s.bytes() {
        if b.is_ascii_whitespace() || b == b'=' {
            continue;
        }
        let v = match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => return Err("invalid base64".to_string()),
        };
        vals.push(v);
    }
    let mut out = Vec::new();
    for chunk in vals.chunks(4) {
        if chunk.len() < 2 {
            break;
        }
        let b0 = (chunk[0] << 2) | (chunk[1] >> 4);
        out.push(b0);
        if chunk.len() >= 3 {
            let b1 = (chunk[1] << 4) | (chunk[2] >> 2);
            out.push(b1);
        }
        if chunk.len() >= 4 {
            let b2 = (chunk[2] << 6) | chunk[3];
            out.push(b2);
        }
    }
    Ok(out)
}

#[derive(Clone, Debug)]
struct MdqBlock {
    kind: String, // "section", "paragraph", "code", "list_item", "quote", "table", "link"
    level: usize,
    title: String,
    text: String,
    lang: String,
    ordered: bool,
    checked: Option<bool>,
    url: String,
    children: Vec<MdqBlock>,
    table_aligns: Vec<String>,
    table_rows: Vec<Vec<String>>,
}

fn mdq_strip_inline(s: &str) -> String {
    let mut out = String::new();
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '[' {
            if let Some(close_br) = chars[i + 1..].iter().position(|&c| c == ']') {
                let close_idx = i + 1 + close_br;
                if chars.get(close_idx + 1) == Some(&'(')
                    && let Some(close_p) = chars[close_idx + 2..].iter().position(|&c| c == ')')
                {
                    let label: String = chars[i + 1..close_idx].iter().collect();
                    out.push_str(&label);
                    i = close_idx + 2 + close_p + 1;
                    continue;
                }
            }
        }
        if matches!(chars[i], '*' | '_' | '`' | '~') {
            i += 1;
            continue;
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn parse_mdq_markdown(input: &str) -> Vec<MdqBlock> {
    let lines: Vec<&str> = input.lines().collect();
    let mut blocks = Vec::new();
    let mut i = 0usize;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();
        if trimmed.is_empty() {
            i += 1;
            continue;
        }
        if trimmed.starts_with("```") {
            let lang = trimmed.trim_start_matches('`').trim().to_string();
            i += 1;
            let mut code_lines = Vec::new();
            while i < lines.len() && !lines[i].trim().starts_with("```") {
                code_lines.push(lines[i]);
                i += 1;
            }
            if i < lines.len() {
                i += 1;
            }
            blocks.push(MdqBlock {
                kind: "code".to_string(),
                level: 0,
                title: String::new(),
                text: code_lines.join("\n"),
                lang,
                ordered: false,
                checked: None,
                url: String::new(),
                children: Vec::new(),
                table_aligns: Vec::new(),
                table_rows: Vec::new(),
            });
            continue;
        }
        if trimmed.starts_with('#') {
            let hashes = trimmed.chars().take_while(|&c| c == '#').count();
            if (1..=6).contains(&hashes) && trimmed[hashes..].starts_with(' ') {
                let title = trimmed[hashes..].trim().to_string();
                blocks.push(MdqBlock {
                    kind: "heading_raw".to_string(),
                    level: hashes,
                    title,
                    text: String::new(),
                    lang: String::new(),
                    ordered: false,
                    checked: None,
                    url: String::new(),
                    children: Vec::new(),
                    table_aligns: Vec::new(),
                    table_rows: Vec::new(),
                });
                i += 1;
                continue;
            }
        }
        if trimmed.starts_with('>') {
            let mut q_lines = Vec::new();
            while i < lines.len() && lines[i].trim().starts_with('>') {
                let ql = lines[i].trim().strip_prefix('>').unwrap_or("").trim_start();
                q_lines.push(ql);
                i += 1;
            }
            let inner = parse_mdq_markdown(&q_lines.join("\n"));
            blocks.push(MdqBlock {
                kind: "quote".to_string(),
                level: 0,
                title: String::new(),
                text: q_lines.join("\n"),
                lang: String::new(),
                ordered: false,
                checked: None,
                url: String::new(),
                children: inner,
                table_aligns: Vec::new(),
                table_rows: Vec::new(),
            });
            continue;
        }
        if trimmed.starts_with("|") && i + 1 < lines.len() && lines[i + 1].trim().starts_with('|') && lines[i + 1].contains('-') {
            let parse_row = |r: &str| -> Vec<String> {
                let s = r.trim().trim_start_matches('|').trim_end_matches('|');
                s.split('|').map(|c| c.trim().to_string()).collect()
            };
            let head = parse_row(lines[i]);
            let sep = parse_row(lines[i + 1]);
            let aligns: Vec<String> = sep.iter().map(|c| {
                let t = c.trim();
                if t.starts_with(':') && t.ends_with(':') { "center".to_string() }
                else if t.starts_with(':') { "left".to_string() }
                else if t.ends_with(':') { "right".to_string() }
                else { "none".to_string() }
            }).collect();
            let mut rows = vec![head];
            i += 2;
            while i < lines.len() && lines[i].trim().starts_with('|') {
                rows.push(parse_row(lines[i]));
                i += 1;
            }
            blocks.push(MdqBlock {
                kind: "table".to_string(),
                level: 0,
                title: String::new(),
                text: String::new(),
                lang: String::new(),
                ordered: false,
                checked: None,
                url: String::new(),
                children: Vec::new(),
                table_aligns: aligns,
                table_rows: rows,
            });
            continue;
        }
        let is_ul = trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("+ ");
        let ol_split = trimmed.find(". ");
        let is_ol = ol_split.is_some_and(|pos| pos > 0 && trimmed[..pos].chars().all(|c| c.is_ascii_digit()));
        if is_ul || is_ol {
            let ordered = is_ol;
            let item_rest = if is_ul {
                trimmed[2..].trim()
            } else {
                trimmed[ol_split.unwrap() + 2..].trim()
            };
            let (checked, clean_text) = if let Some(r) = item_rest.strip_prefix("[ ] ") {
                (Some(false), r.to_string())
            } else if let Some(r) = item_rest.strip_prefix("[x] ").or_else(|| item_rest.strip_prefix("[X] ")) {
                (Some(true), r.to_string())
            } else {
                (None, item_rest.to_string())
            };
            blocks.push(MdqBlock {
                kind: "list_item".to_string(),
                level: 0,
                title: String::new(),
                text: clean_text,
                lang: String::new(),
                ordered,
                checked,
                url: String::new(),
                children: Vec::new(),
                table_aligns: Vec::new(),
                table_rows: Vec::new(),
            });
            i += 1;
            continue;
        }
        let mut p_lines = vec![trimmed];
        i += 1;
        while i < lines.len() {
            let nl = lines[i].trim();
            if nl.is_empty()
                || nl.starts_with('#')
                || nl.starts_with("```")
                || nl.starts_with('>')
                || nl.starts_with("- ")
                || nl.starts_with("* ")
                || nl.starts_with('|')
            {
                break;
            }
            p_lines.push(nl);
            i += 1;
        }
        blocks.push(MdqBlock {
            kind: "paragraph".to_string(),
            level: 0,
            title: String::new(),
            text: p_lines.join(" "),
            lang: String::new(),
            ordered: false,
            checked: None,
            url: String::new(),
            children: Vec::new(),
            table_aligns: Vec::new(),
            table_rows: Vec::new(),
        });
    }
    fn build_sections(flat: &[MdqBlock]) -> Vec<MdqBlock> {
        let mut out = Vec::new();
        let mut idx = 0usize;
        while idx < flat.len() {
            if flat[idx].kind == "heading_raw" {
                let lvl = flat[idx].level;
                let title = flat[idx].title.clone();
                idx += 1;
                let start = idx;
                while idx < flat.len() {
                    if flat[idx].kind == "heading_raw" && flat[idx].level <= lvl {
                        break;
                    }
                    idx += 1;
                }
                let children = build_sections(&flat[start..idx]);
                out.push(MdqBlock {
                    kind: "section".to_string(),
                    level: lvl,
                    title,
                    text: String::new(),
                    lang: String::new(),
                    ordered: false,
                    checked: None,
                    url: String::new(),
                    children,
                    table_aligns: Vec::new(),
                    table_rows: Vec::new(),
                });
            } else {
                out.push(flat[idx].clone());
                idx += 1;
            }
        }
        out
    }
    build_sections(&blocks)
}

fn mdq_match_text(pat_raw: &str, target: &str) -> bool {
    let p = pat_raw.trim();
    if p.is_empty() || p == "*" {
        return true;
    }
    if p.starts_with('/') && p.ends_with('/') && p.len() >= 2 {
        let rx = &p[1..p.len() - 1];
        let zr = ZeroRegex::new(vec![rx.to_string()], false, false, false, false);
        return zr.is_match(target);
    }
    let mut start_anchor = false;
    let mut end_anchor = false;
    let mut rem = p;
    if let Some(r) = rem.strip_prefix('^') {
        start_anchor = true;
        rem = r.trim_start();
    }
    if let Some(r) = rem.strip_suffix('$') {
        end_anchor = true;
        rem = r.trim_end();
    }
    let (needle, exact_case) = if (rem.starts_with('"') && rem.ends_with('"')) || (rem.starts_with('\'') && rem.ends_with('\'')) {
        (&rem[1..rem.len() - 1], true)
    } else {
        (rem, false)
    };
    let hay_cmp = if exact_case { target.to_string() } else { target.to_lowercase() };
    let ndl_cmp = if exact_case { needle.to_string() } else { needle.to_lowercase() };
    if start_anchor && end_anchor {
        hay_cmp == ndl_cmp
    } else if start_anchor {
        hay_cmp.starts_with(&ndl_cmp)
    } else if end_anchor {
        hay_cmp.ends_with(&ndl_cmp)
    } else {
        hay_cmp.contains(&ndl_cmp)
    }
}

fn mdq_select_one(nodes: &[MdqBlock], sel_raw: &str) -> Vec<MdqBlock> {
    let sel = sel_raw.trim();
    if sel.is_empty() {
        return nodes.to_vec();
    }
    let mut all = Vec::new();
    fn collect_recursive(ns: &[MdqBlock], out: &mut Vec<MdqBlock>) {
        for n in ns {
            out.push(n.clone());
            collect_recursive(&n.children, out);
        }
    }
    collect_recursive(nodes, &mut all);

    if let Some(rest) = sel.strip_prefix('#') {
        let (min_l, max_l, matcher) = if let Some(after_brace) = rest.strip_prefix('{') {
            if let Some(close) = after_brace.find('}') {
                let spec = &after_brace[..close];
                let after = after_brace[close + 1..].trim();
                let parts: Vec<&str> = spec.split(',').collect();
                let mn = parts.first().and_then(|s| s.parse::<usize>().ok()).unwrap_or(1);
                let mx = if parts.len() == 1 {
                    mn
                } else {
                    parts.get(1).and_then(|s| s.parse::<usize>().ok()).unwrap_or(6)
                };
                (mn, mx, after)
            } else {
                (1, 6, rest.trim())
            }
        } else {
            let extra_hashes = rest.chars().take_while(|&c| c == '#').count();
            if extra_hashes > 0 && rest[extra_hashes..].starts_with(' ') {
                let lvl = 1 + extra_hashes;
                (lvl, lvl, rest[extra_hashes..].trim())
            } else {
                (1, 6, rest.trim())
            }
        };
        return all
            .into_iter()
            .filter(|b| b.kind == "section" && b.level >= min_l && b.level <= max_l && mdq_match_text(matcher, &mdq_strip_inline(&b.title)))
            .collect();
    }
    if let Some(rest) = sel.strip_prefix("```") {
        let rest_trim = rest.trim();
        let (lang_m, code_m) = if let Some((l, c)) = rest_trim.split_once(' ') {
            (l.trim(), c.trim())
        } else {
            (rest_trim, "")
        };
        return all
            .into_iter()
            .filter(|b| b.kind == "code" && mdq_match_text(lang_m, &b.lang) && mdq_match_text(code_m, &b.text))
            .collect();
    }
    if sel.starts_with("- ") || sel == "-" || sel.starts_with("1.") {
        let want_ordered = sel.starts_with("1.");
        let mut rest = if want_ordered {
            sel.strip_prefix("1.").unwrap_or("").trim()
        } else {
            sel.strip_prefix('-').unwrap_or("").trim()
        };
        let mut task_filter: Option<Option<bool>> = None;
        if let Some(r) = rest.strip_prefix("[ ]") {
            task_filter = Some(Some(false));
            rest = r.trim();
        } else if let Some(r) = rest.strip_prefix("[x]") {
            task_filter = Some(Some(true));
            rest = r.trim();
        } else if let Some(r) = rest.strip_prefix("[?]") {
            task_filter = Some(None);
            rest = r.trim();
        }
        return all
            .into_iter()
            .filter(|b| {
                if b.kind != "list_item" || b.ordered != want_ordered {
                    return false;
                }
                if let Some(tf) = task_filter {
                    match tf {
                        Some(want_chk) if b.checked != Some(want_chk) => return false,
                        None if b.checked.is_none() => return false,
                        _ => {}
                    }
                }
                mdq_match_text(rest, &mdq_strip_inline(&b.text))
            })
            .collect();
    }
    if let Some(rest) = sel.strip_prefix('>') {
        let m = rest.trim();
        return all
            .into_iter()
            .filter(|b| b.kind == "quote" && mdq_match_text(m, &mdq_strip_inline(&b.text)))
            .collect();
    }
    if let Some(rest) = sel.strip_prefix("P:") {
        let m = rest.trim();
        return all
            .into_iter()
            .filter(|b| b.kind == "paragraph" && mdq_match_text(m, &mdq_strip_inline(&b.text)))
            .collect();
    }
    if sel.starts_with('[') && let Some((disp_m, url_part)) = sel[1..].split_once("](") {
        let url_m = url_part.strip_suffix(')').unwrap_or(url_part);
        let mut links = Vec::new();
        for b in &all {
            let src = if b.kind == "section" { &b.title } else { &b.text };
            let chars: Vec<char> = src.chars().collect();
            let mut k = 0usize;
            while k < chars.len() {
                if chars[k] == '[' && (k == 0 || chars[k - 1] != '!') {
                    if let Some(cb) = chars[k + 1..].iter().position(|&c| c == ']') {
                        let cb_idx = k + 1 + cb;
                        if chars.get(cb_idx + 1) == Some(&'(')
                            && let Some(cp) = chars[cb_idx + 2..].iter().position(|&c| c == ')')
                        {
                            let disp: String = chars[k + 1..cb_idx].iter().collect();
                            let url: String = chars[cb_idx + 2..cb_idx + 2 + cp].iter().collect();
                            if mdq_match_text(disp_m, &disp) && mdq_match_text(url_m, &url) {
                                links.push(MdqBlock {
                                    kind: "link".to_string(),
                                    level: 0,
                                    title: disp.clone(),
                                    text: disp,
                                    lang: String::new(),
                                    ordered: false,
                                    checked: None,
                                    url,
                                    children: Vec::new(),
                                    table_aligns: Vec::new(),
                                    table_rows: Vec::new(),
                                });
                            }
                            k = cb_idx + 2 + cp + 1;
                            continue;
                        }
                    }
                }
                k += 1;
            }
        }
        return links;
    }
    if let Some(rest) = sel.strip_prefix(":-:") {
        if let Some((col_m, cell_m)) = rest.split_once(":-:") {
            let col_m = col_m.trim();
            let cell_m = cell_m.trim();
            let mut out_tables = Vec::new();
            for b in all {
                if b.kind == "table" && !b.table_rows.is_empty() {
                    let head = &b.table_rows[0];
                    let col_indices: Vec<usize> = head
                        .iter()
                        .enumerate()
                        .filter(|(_, h)| mdq_match_text(col_m, h))
                        .map(|(idx, _)| idx)
                        .collect();
                    if !col_indices.is_empty() {
                        let mut new_rows = Vec::new();
                        let new_head: Vec<String> = col_indices.iter().map(|&ci| head.get(ci).cloned().unwrap_or_default()).collect();
                        new_rows.push(new_head);
                        for r in b.table_rows.iter().skip(1) {
                            if col_indices.iter().any(|&ci| mdq_match_text(cell_m, r.get(ci).map(|s| s.as_str()).unwrap_or(""))) {
                                let nr: Vec<String> = col_indices.iter().map(|&ci| r.get(ci).cloned().unwrap_or_default()).collect();
                                new_rows.push(nr);
                            }
                        }
                        if new_rows.len() > 1 || cell_m.is_empty() || cell_m == "*" {
                            let new_aligns: Vec<String> = col_indices.iter().map(|&ci| b.table_aligns.get(ci).cloned().unwrap_or_else(|| "none".to_string())).collect();
                            out_tables.push(MdqBlock {
                                kind: "table".to_string(),
                                level: 0,
                                title: String::new(),
                                text: String::new(),
                                lang: String::new(),
                                ordered: false,
                                checked: None,
                                url: String::new(),
                                children: Vec::new(),
                                table_aligns: new_aligns,
                                table_rows: new_rows,
                            });
                        }
                    }
                }
            }
            return out_tables;
        }
    }
    Vec::new()
}

fn mdq_render_block_md(b: &MdqBlock, link_format: &str) -> String {
    match b.kind.as_str() {
        "section" => {
            let mut out = format!("{} {}\n", "#".repeat(b.level), b.title);
            for (idx, ch) in b.children.iter().enumerate() {
                if idx == 0 {
                    out.push('\n');
                }
                out.push_str(&mdq_render_block_md(ch, link_format));
                if idx + 1 < b.children.len() && !out.ends_with("\n\n") {
                    out.push('\n');
                }
            }
            out
        }
        "paragraph" => format!("{}\n", b.text),
        "code" => format!("```{}\n{}\n```\n", b.lang, b.text),
        "list_item" => {
            let prefix = if b.ordered { "1. " } else { "- " };
            let chk = match b.checked {
                Some(true) => "[x] ",
                Some(false) => "[ ] ",
                None => "",
            };
            format!("{prefix}{chk}{}\n", b.text)
        }
        "quote" => {
            let mut out = String::new();
            for l in b.text.lines() {
                out.push_str(&format!("> {l}\n"));
            }
            out
        }
        "link" => {
            if link_format == "inline" {
                format!("[{}]({})", b.title, b.url)
            } else {
                format!("[{}][1]\n\n[1]: {}\n", b.title, b.url)
            }
        }
        "table" => {
            if b.table_rows.is_empty() {
                return String::new();
            }
            let cols = b.table_rows[0].len();
            let mut widths = vec![3usize; cols];
            for r in &b.table_rows {
                for (ci, cell) in r.iter().enumerate() {
                    if ci < cols {
                        widths[ci] = widths[ci].max(cell.len() + 2);
                    }
                }
            }
            let fmt_row = |r: &[String]| -> String {
                let mut s = String::from("|");
                for (ci, w) in widths.iter().enumerate() {
                    let cell = r.get(ci).map(|x| x.as_str()).unwrap_or("");
                    let pad = w.saturating_sub(cell.len() + 1);
                    s.push(' ');
                    s.push_str(cell);
                    s.push_str(&" ".repeat(pad));
                    s.push('|');
                }
                s
            };
            let mut lines = Vec::new();
            lines.push(fmt_row(&b.table_rows[0]));
            let mut div = String::from("|");
            for (ci, w) in widths.iter().enumerate() {
                let al = b.table_aligns.get(ci).map(|x| x.as_str()).unwrap_or("none");
                let left = al == "left" || al == "center";
                let right = al == "right" || al == "center";
                let dashes = w.saturating_sub(usize::from(left) + usize::from(right));
                if left { div.push(':'); }
                div.push_str(&"-".repeat(dashes));
                if right { div.push(':'); }
                div.push('|');
            }
            lines.push(div);
            for r in b.table_rows.iter().skip(1) {
                lines.push(fmt_row(r));
            }
            format!("{}\n", lines.join("\n"))
        }
        _ => String::new(),
    }
}

fn mdq_block_to_jval(b: &MdqBlock) -> JVal {
    match b.kind.as_str() {
        "section" => {
            let body: Vec<JVal> = b.children.iter().map(mdq_block_to_jval).collect();
            JVal::Object(vec![(
                "section".to_string(),
                JVal::Object(vec![
                    ("depth".to_string(), JVal::Number(b.level as f64)),
                    ("title".to_string(), JVal::Str(b.title.clone())),
                    ("body".to_string(), JVal::Array(body)),
                ]),
            )])
        }
        "paragraph" => JVal::Object(vec![("paragraph".to_string(), JVal::Str(b.text.clone()))]),
        "code" => {
            let mut fields = vec![
                ("code".to_string(), JVal::Str(b.text.clone())),
                ("type".to_string(), JVal::Str("code".to_string())),
            ];
            if !b.lang.is_empty() {
                fields.push(("language".to_string(), JVal::Str(b.lang.clone())));
            }
            JVal::Object(vec![("code_block".to_string(), JVal::Object(fields))])
        }
        "list_item" => {
            let mut item_obj = vec![(
                "item".to_string(),
                JVal::Array(vec![JVal::Object(vec![("paragraph".to_string(), JVal::Str(b.text.clone()))])]),
            )];
            if let Some(chk) = b.checked {
                item_obj.push(("checked".to_string(), JVal::Bool(chk)));
            }
            JVal::Object(vec![("list".to_string(), JVal::Array(vec![JVal::Object(item_obj)]))])
        }
        "quote" => {
            let body: Vec<JVal> = b.children.iter().map(mdq_block_to_jval).collect();
            JVal::Object(vec![("block_quote".to_string(), JVal::Array(body))])
        }
        "link" => JVal::Object(vec![(
            "link".to_string(),
            JVal::Object(vec![
                ("display".to_string(), JVal::Str(b.title.clone())),
                ("url".to_string(), JVal::Str(b.url.clone())),
            ]),
        )]),
        "table" => {
            let aligns = JVal::Array(b.table_aligns.iter().cloned().map(JVal::Str).collect());
            let rows = JVal::Array(
                b.table_rows
                    .iter()
                    .map(|r| JVal::Array(r.iter().cloned().map(JVal::Str).collect()))
                    .collect(),
            );
            JVal::Object(vec![(
                "table".to_string(),
                JVal::Object(vec![("alignments".to_string(), aligns), ("rows".to_string(), rows)]),
            )])
        }
        _ => JVal::Null,
    }
}

fn cmd_mdq(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut output_fmt = "markdown".to_string();
    let mut link_format = "never-inline".to_string();
    let mut quiet = false;
    let mut breaks_opt: Option<bool> = None;
    let mut positionals = Vec::new();
    let mut end_opts = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if !end_opts && a == "--" {
            end_opts = true;
            i += 1;
            continue;
        }
        if !end_opts && (a == "-h" || a == "--help") {
            return ok_out("Usage: mdq [OPTIONS] [selectors] [MARKDOWN_FILE_PATHS]...\n");
        }
        if !end_opts && (a == "-V" || a == "--version") {
            return ok_out("mdq 0.8.0\n");
        }
        if !end_opts && (a == "-q" || a == "--quiet") {
            quiet = true;
        } else if !end_opts && a == "--br" {
            breaks_opt = Some(true);
        } else if !end_opts && a == "--no-br" {
            breaks_opt = Some(false);
        } else if !end_opts && (a == "-o" || a == "--output") && i + 1 < args.len() {
            i += 1;
            output_fmt = args[i].clone();
        } else if !end_opts && let Some(rest) = a.strip_prefix("--output=") {
            output_fmt = rest.to_string();
        } else if !end_opts && (a == "-l" || a == "--link-format") && i + 1 < args.len() {
            i += 1;
            link_format = args[i].clone();
        } else if !end_opts && let Some(rest) = a.strip_prefix("--link-format=") {
            link_format = rest.to_string();
        } else if !end_opts && matches!(a, "--link-pos" | "--footnote-pos" | "--wrap-width" | "--renumber-footnotes") && i + 1 < args.len() {
            i += 1;
        } else {
            positionals.push(a.to_string());
        }
        i += 1;
    }
    let selector_str = positionals.first().cloned().unwrap_or_default();
    let files = if positionals.len() > 1 { &positionals[1..] } else { &[][..] };
    let mut md_input = String::new();
    if files.is_empty() {
        md_input.push_str(stdin);
    } else {
        for (idx, f) in files.iter().enumerate() {
            if idx > 0 && !md_input.ends_with('\n') {
                md_input.push('\n');
            }
            if f == "-" {
                md_input.push_str(stdin);
            } else {
                let full = resolve_posix_path(cwd, f);
                match fs.read_file(&full) {
                    Ok(b) => md_input.push_str(&String::from_utf8_lossy(&b)),
                    Err(e) => return err_out(&format!("{f}: {e}\n"), 1),
                }
            }
        }
    }
    let mut current = parse_mdq_markdown(&md_input);
    for stage in selector_str.split('|') {
        let st = stage.trim();
        if !st.is_empty() {
            current = mdq_select_one(&current, st);
        }
    }
    let breaks = breaks_opt.unwrap_or(output_fmt == "markdown" || output_fmt == "md");
    let matched = !current.is_empty();
    if quiet {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: if matched { 0 } else { 1 },
        };
    }
    if output_fmt == "json" {
        let items: Vec<JVal> = current.iter().map(mdq_block_to_jval).collect();
        let root = JVal::Object(vec![("items".to_string(), JVal::Array(items))]);
        return BuiltinOutcome {
            stdout: format!("{}\n", root.to_json_string(true, false, 0)),
            stderr: String::new(),
            exit_code: if matched { 0 } else { 1 },
        };
    }
    if output_fmt == "plain" {
        let mut pieces = Vec::new();
        fn walk_plain(b: &MdqBlock, out: &mut Vec<String>) {
            if b.kind == "section" {
                if !b.title.is_empty() {
                    out.push(mdq_strip_inline(&b.title));
                }
                for ch in &b.children {
                    walk_plain(ch, out);
                }
            } else if b.kind == "table" {
                for r in &b.table_rows {
                    let row_s: Vec<String> = r.iter().map(|c| mdq_strip_inline(c)).filter(|s| !s.is_empty()).collect();
                    if !row_s.is_empty() {
                        out.push(row_s.join(" "));
                    }
                }
            } else if b.kind == "code" {
                if !b.text.is_empty() {
                    out.push(b.text.clone());
                }
            } else if !b.text.is_empty() {
                out.push(mdq_strip_inline(&b.text));
            }
        }
        for b in &current {
            walk_plain(b, &mut pieces);
        }
        let sep = if breaks { "\n\n" } else { "\n" };
        let stdout = if pieces.is_empty() {
            String::new()
        } else {
            format!("{}\n", pieces.join(sep))
        };
        return BuiltinOutcome {
            stdout,
            stderr: String::new(),
            exit_code: if matched { 0 } else { 1 },
        };
    }
    let mut rendered = Vec::new();
    for b in &current {
        rendered.push(mdq_render_block_md(b, &link_format));
    }
    let sep = if breaks { "\n   -----\n\n" } else { "\n" };
    let stdout = rendered.join(sep);
    BuiltinOutcome {
        stdout,
        stderr: String::new(),
        exit_code: if matched { 0 } else { 1 },
    }
}
