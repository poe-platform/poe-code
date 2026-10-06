use crate::shell::expand::{decode_ansi_c_escapes, eval_arith, glob_match};
use crate::vfs::{SafeBashFs, resolve_posix_path};
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct BuiltinOutcome {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

pub fn try_run_builtin(
    cmd: &str,
    args: &[String],
    stdin: &mut String,
    cwd: &mut String,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> Option<BuiltinOutcome> {
    match cmd {
        ":" | "true" => Some(BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
        }),
        "false" => Some(BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 1,
        }),
        "pwd" => Some(BuiltinOutcome {
            stdout: format!("{cwd}\n"),
            stderr: String::new(),
            exit_code: 0,
        }),
        "cd" => {
            let target = args
                .first()
                .map(|s| s.as_str())
                .or_else(|| env.get("HOME").map(|s| s.as_str()))
                .unwrap_or("/");
            let resolved = resolve_posix_path(cwd, target);
            if fs.is_dir(&resolved) {
                env.insert("OLDPWD".to_string(), cwd.clone());
                *cwd = resolved.clone();
                env.insert("PWD".to_string(), resolved);
                Some(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 0,
                })
            } else {
                Some(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("cd: {target}: No such file or directory\n"),
                    exit_code: 1,
                })
            }
        }
        "echo" => {
            let mut newline = true;
            let mut interpret_escapes = false;
            let mut idx = 0usize;
            while idx < args.len() {
                let arg = &args[idx];
                if arg.starts_with('-') && arg.len() > 1 && arg[1..].chars().all(|c| matches!(c, 'n' | 'e' | 'E')) {
                    for c in arg[1..].chars() {
                        match c {
                            'n' => newline = false,
                            'e' => interpret_escapes = true,
                            'E' => interpret_escapes = false,
                            _ => {}
                        }
                    }
                    idx += 1;
                } else {
                    break;
                }
            }
            let raw = args[idx..].join(" ");
            let mut body = if interpret_escapes {
                decode_ansi_c_escapes(&raw)
            } else {
                raw
            };
            if newline {
                body.push('\n');
            }
            Some(BuiltinOutcome {
                stdout: body,
                stderr: String::new(),
                exit_code: 0,
            })
        }
        "printf" => Some(builtin_printf(args, env)),
        "export" | "local" | "readonly" | "declare" | "typeset" => {
            let mut is_nameref = false;
            for arg in args {
                if arg.starts_with('-') {
                    if arg.contains('n') {
                        is_nameref = true;
                    }
                    continue;
                }
                if let Some((k, v)) = arg.split_once('=') {
                    if is_nameref {
                        env.insert(format!("__nameref__{k}"), v.to_string());
                    } else if v.starts_with('(') && v.ends_with(')') {
                        let inner = &v[1..v.len() - 1];
                        let items = split_array_initializer(inner);
                        let mut vals = Vec::new();
                        for (auto_idx, item) in items.into_iter().enumerate() {
                            if let Some(rest) = item.strip_prefix('[')
                                && let Some((sub_k, sub_v)) = rest.split_once("]=")
                            {
                                let clean_k = sub_k.trim_matches('"').trim_matches('\'');
                                let clean_v = sub_v.trim_matches('"').trim_matches('\'').to_string();
                                env.insert(format!("{k}[{clean_k}]"), clean_v.clone());
                                vals.push(clean_v);
                            } else {
                                let clean_v = item.trim_matches('"').trim_matches('\'').to_string();
                                env.insert(format!("{k}[{auto_idx}]"), clean_v.clone());
                                if auto_idx == 0 {
                                    env.insert(k.to_string(), clean_v.clone());
                                }
                                vals.push(clean_v);
                            }
                        }
                        env.insert(format!("{k}[@]"), vals.join(" "));
                        env.insert(format!("{k}[*]"), vals.join(" "));
                        env.insert(format!("{k}[#]"), vals.len().to_string());
                    } else {
                        env.insert(k.to_string(), v.to_string());
                    }
                }
            }
            Some(BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
            })
        }
        "unset" => {
            for arg in args {
                if arg == "-v" || arg == "-f" {
                    continue;
                }
                env.remove(arg);
            }
            Some(BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
            })
        }
        "test" | "[" | "[[" => Some(builtin_test(cmd, args, cwd, fs)),
        "read" => Some(builtin_read(args, stdin, env)),
        "getopts" => Some(builtin_getopts(args, env)),
        "trap" | "alias" | "unalias" | "hash" | "umask" | "wait" | "jobs" => Some(BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
        }),
        "type" => {
            let mut out = String::new();
            for a in args {
                if !a.starts_with('-') {
                    out.push_str(&format!("{a} is /usr/bin/{a}\n"));
                }
            }
            Some(BuiltinOutcome {
                stdout: out,
                stderr: String::new(),
                exit_code: 0,
            })
        },
        "let" => {
            let mut last = 0i64;
            for arg in args {
                match eval_arith(arg, env) {
                    Ok(v) => last = v,
                    Err(e) => {
                        return Some(BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("let: {e}\n"),
                            exit_code: 1,
                        });
                    }
                }
            }
            Some(BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: if last == 0 { 1 } else { 0 },
            })
        }
        _ => None,
    }
}

fn split_array_initializer(inner: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_q: Option<char> = None;
    let mut chars = inner.chars().peekable();
    while let Some(c) = chars.next() {
        if let Some(q) = in_q {
            if c == q {
                in_q = None;
            } else if c == '\\' && q == '"' {
                cur.push(c);
                if let Some(nc) = chars.next() {
                    cur.push(nc);
                }
            } else {
                cur.push(c);
            }
        } else if c == '\'' || c == '"' {
            in_q = Some(c);
        } else if c.is_whitespace() {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
        } else {
            cur.push(c);
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn builtin_printf(args: &[String], env: &mut BTreeMap<String, String>) -> BuiltinOutcome {
    let mut idx = 0usize;
    let mut assign_var: Option<String> = None;
    while idx < args.len() {
        if args[idx] == "-v" && idx + 1 < args.len() {
            assign_var = Some(args[idx + 1].clone());
            idx += 2;
        } else if args[idx] == "--" {
            idx += 1;
            break;
        } else {
            break;
        }
    }
    let Some(fmt) = args.get(idx) else {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
        };
    };
    let val_args = &args[idx + 1..];
    let mut out = String::new();
    let mut arg_i = 0usize;

    loop {
        let start_arg_i = arg_i;
        let mut chars = fmt.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '\\' {
                match chars.next() {
                    Some('n') => out.push('\n'),
                    Some('r') => out.push('\r'),
                    Some('t') => out.push('\t'),
                    Some('\\') => out.push('\\'),
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
                        if let Ok(v) = u8::from_str_radix(&hex, 16) {
                            out.push(v as char);
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
                        if let Ok(v) = u8::from_str_radix(&s, 8) {
                            out.push(v as char);
                        }
                    }
                    Some(other) => {
                        out.push('\\');
                        out.push(other);
                    }
                    None => out.push('\\'),
                }
            } else if c == '%' {
                if chars.peek() == Some(&'%') {
                    chars.next();
                    out.push('%');
                    continue;
                }
                let mut spec = String::new();
                while let Some(&sc) = chars.peek() {
                    if sc.is_ascii_alphabetic() {
                        break;
                    }
                    spec.push(chars.next().unwrap());
                }
                let conv = chars.next().unwrap_or('s');
                let raw_arg = val_args.get(arg_i).map(|s| s.as_str()).unwrap_or("");
                arg_i += 1;
                match conv {
                    's' => out.push_str(&format_width(raw_arg, &spec, false)),
                    'b' => {
                        let dec = decode_ansi_c_escapes(raw_arg);
                        out.push_str(&format_width(&dec, &spec, false));
                    }
                    'q' => {
                        if raw_arg.is_empty() {
                            out.push_str("''");
                        } else if raw_arg.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/')) {
                            out.push_str(raw_arg);
                        } else {
                            out.push_str(&format!("'{}'", raw_arg.replace('\'', "'\\''")));
                        }
                    }
                    'd' | 'i' | 'u' => {
                        let n = raw_arg.trim().parse::<i64>().unwrap_or(0);
                        out.push_str(&format_width(&n.to_string(), &spec, true));
                    }
                    'x' => {
                        let n = raw_arg.trim().parse::<u64>().unwrap_or(0);
                        out.push_str(&format_width(&format!("{n:x}"), &spec, true));
                    }
                    'X' => {
                        let n = raw_arg.trim().parse::<u64>().unwrap_or(0);
                        out.push_str(&format_width(&format!("{n:X}"), &spec, true));
                    }
                    'o' => {
                        let n = raw_arg.trim().parse::<u64>().unwrap_or(0);
                        out.push_str(&format_width(&format!("{n:o}"), &spec, true));
                    }
                    'f' => {
                        let f = raw_arg.trim().parse::<f64>().unwrap_or(0.0);
                        let prec = spec
                            .split_once('.')
                            .and_then(|(_, p)| p.parse::<usize>().ok())
                            .unwrap_or(6);
                        out.push_str(&format!("{f:.prec$}"));
                    }
                    _ => out.push_str(raw_arg),
                }
            } else {
                out.push(c);
            }
        }
        if arg_i >= val_args.len() || arg_i == start_arg_i {
            break;
        }
    }

    if let Some(var) = assign_var {
        env.insert(var, out);
        BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
        }
    } else {
        BuiltinOutcome {
            stdout: out,
            stderr: String::new(),
            exit_code: 0,
        }
    }
}

fn format_width(val: &str, spec: &str, numeric: bool) -> String {
    if spec.is_empty() {
        return val.to_string();
    }
    let left_align = spec.starts_with('-');
    let zero_pad = numeric && spec.starts_with('0');
    let width_s = spec.trim_start_matches(['-', '0', '+']);
    let width_only = width_s.split('.').next().unwrap_or("");
    let Ok(width) = width_only.parse::<usize>() else {
        return val.to_string();
    };
    if val.len() >= width {
        return val.to_string();
    }
    let pad = width - val.len();
    if left_align {
        format!("{val}{}", " ".repeat(pad))
    } else if zero_pad {
        format!("{}{val}", "0".repeat(pad))
    } else {
        format!("{}{val}", " ".repeat(pad))
    }
}

fn builtin_test(cmd: &str, raw_args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut args = raw_args;
    if cmd == "[" {
        if args.last().map(|s| s.as_str()) != Some("]") {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: "[: missing `]`\n".to_string(),
                exit_code: 2,
            };
        }
        args = &args[..args.len() - 1];
    } else if cmd == "[[" {
        if args.last().map(|s| s.as_str()) == Some("]]") {
            args = &args[..args.len() - 1];
        }
    }
    let ok = eval_test_slice(args, cwd, fs, cmd == "[[");
    BuiltinOutcome {
        stdout: String::new(),
        stderr: String::new(),
        exit_code: if ok { 0 } else { 1 },
    }
}

fn eval_test_slice(args: &[String], cwd: &str, fs: &dyn SafeBashFs, is_double_bracket: bool) -> bool {
    if args.is_empty() {
        return false;
    }
    if args[0] == "!" {
        return !eval_test_slice(&args[1..], cwd, fs, is_double_bracket);
    }
    if args.len() == 1 {
        return !args[0].is_empty();
    }
    if args.len() == 2 {
        let op = args[0].as_str();
        let val = &args[1];
        let path = resolve_posix_path(cwd, val);
        return match op {
            "-z" => val.is_empty(),
            "-n" => !val.is_empty(),
            "-e" | "-a" => fs.exists(&path),
            "-f" => fs.exists(&path) && !fs.is_dir(&path),
            "-d" => fs.is_dir(&path),
            "-s" => fs.read_file(&path).map(|b| !b.is_empty()).unwrap_or(false),
            "-L" | "-h" => fs.readlink(&path).is_ok(),
            "-r" | "-w" | "-x" => fs.exists(&path),
            _ => false,
        };
    }
    if args.len() >= 3 {
        let left = &args[0];
        let op = args[1].as_str();
        let right = &args[2];
        return match op {
            "=" | "==" => {
                if is_double_bracket && (right.contains('*') || right.contains('?') || right.contains('[')) {
                    glob_match(right, left)
                } else {
                    left == right
                }
            }
            "!=" => {
                if is_double_bracket && (right.contains('*') || right.contains('?') || right.contains('[')) {
                    !glob_match(right, left)
                } else {
                    left != right
                }
            }
            "<" => left < right,
            ">" => left > right,
            "-eq" => left.trim().parse::<i64>().unwrap_or(0) == right.trim().parse::<i64>().unwrap_or(0),
            "-ne" => left.trim().parse::<i64>().unwrap_or(0) != right.trim().parse::<i64>().unwrap_or(0),
            "-lt" => left.trim().parse::<i64>().unwrap_or(0) < right.trim().parse::<i64>().unwrap_or(0),
            "-le" => left.trim().parse::<i64>().unwrap_or(0) <= right.trim().parse::<i64>().unwrap_or(0),
            "-gt" => left.trim().parse::<i64>().unwrap_or(0) > right.trim().parse::<i64>().unwrap_or(0),
            "-ge" => left.trim().parse::<i64>().unwrap_or(0) >= right.trim().parse::<i64>().unwrap_or(0),
            _ => false,
        };
    }
    false
}

fn builtin_read(args: &[String], stdin: &mut String, env: &mut BTreeMap<String, String>) -> BuiltinOutcome {
    let mut vars = Vec::new();
    let mut idx = 0usize;
    while idx < args.len() {
        let a = &args[idx];
        if a == "-r" {
            idx += 1;
        } else if matches!(a.as_str(), "-d" | "-n" | "-p" | "-a") {
            idx += 2;
        } else {
            vars.push(a.clone());
            idx += 1;
        }
    }
    if vars.is_empty() {
        vars.push("REPLY".to_string());
    }
    if stdin.is_empty() {
        for v in vars {
            env.insert(v, String::new());
        }
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 1,
        };
    }
    let (line_owned, rest_owned) = match stdin.split_once('\n') {
        Some((l, r)) => (l.trim_end_matches('\r').to_string(), r.to_string()),
        None => (stdin.trim_end_matches('\r').to_string(), String::new()),
    };
    *stdin = rest_owned;
    let line = line_owned.as_str();
    let ifs = env.get("IFS").cloned().unwrap_or_else(|| " \t\n".to_string());
    if vars.len() == 1 {
        let trimmed = if ifs.contains(' ') {
            line.trim_matches(|c: char| ifs.contains(c))
        } else {
            line
        };
        env.insert(vars[0].clone(), trimmed.to_string());
    } else {
        let mut parts: Vec<&str> = if ifs.is_empty() {
            vec![line]
        } else {
            line.splitn(vars.len(), |c: char| ifs.contains(c))
                .filter(|s| !s.is_empty() || !ifs.contains(' '))
                .collect()
        };
        for (i, v) in vars.iter().enumerate() {
            let val = parts.get_mut(i).map(|s| *s).unwrap_or("");
            env.insert(v.clone(), val.to_string());
        }
    }
    BuiltinOutcome {
        stdout: String::new(),
        stderr: String::new(),
        exit_code: 0,
    }
}

fn builtin_getopts(args: &[String], env: &mut BTreeMap<String, String>) -> BuiltinOutcome {
    if args.len() < 2 {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 1,
        };
    }
    let optstring = &args[0];
    let var_name = &args[1];
    let opt_args = &args[2..];
    let optind = env
        .get("OPTIND")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(1)
        .max(1);
    let idx = optind - 1;
    if idx >= opt_args.len() {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 1,
        };
    }
    let cur = &opt_args[idx];
    if !cur.starts_with('-') || cur == "-" || cur == "--" {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 1,
        };
    }
    let flag_ch = cur.chars().nth(1).unwrap_or('?');
    let takes_arg = optstring.find(flag_ch).map(|p| optstring[p + flag_ch.len_utf8()..].starts_with(':')).unwrap_or(false);
    if takes_arg {
        let rest: String = cur.chars().skip(2).collect();
        if !rest.is_empty() {
            env.insert("OPTARG".to_string(), rest);
            env.insert("OPTIND".to_string(), (optind + 1).to_string());
        } else if idx + 1 < opt_args.len() {
            env.insert("OPTARG".to_string(), opt_args[idx + 1].clone());
            env.insert("OPTIND".to_string(), (optind + 2).to_string());
        } else {
            env.insert("OPTIND".to_string(), (optind + 1).to_string());
        }
    } else {
        env.insert("OPTIND".to_string(), (optind + 1).to_string());
    }
    env.insert(var_name.clone(), flag_ch.to_string());
    BuiltinOutcome {
        stdout: String::new(),
        stderr: String::new(),
        exit_code: 0,
    }
}
