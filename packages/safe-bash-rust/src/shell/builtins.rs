use crate::commands::search::regex_captures;
use crate::shell::expand::{
    bash_quote_value, decode_ansi_c_escapes, eval_arith, glob_match_ext, resolve_nameref_base,
    sync_array_metadata,
};
use crate::vfs::{SafeBashFs, resolve_posix_path};
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct BuiltinOutcome {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

pub fn resolve_physical_path(cwd: &str, path: &str, fs: &dyn SafeBashFs) -> String {
    let logical = resolve_posix_path(cwd, path);
    let mut cur = String::new();
    for seg in logical.split('/').filter(|s| !s.is_empty()) {
        let next = format!("{cur}/{seg}");
        let mut probe = next.clone();
        for _ in 0..16 {
            if let Ok(target) = fs.readlink(&probe) {
                let parent = match probe.rsplit_once('/') {
                    Some(("", _)) | None => "/",
                    Some((p, _)) => p,
                };
                probe = resolve_posix_path(parent, &target);
            } else {
                break;
            }
        }
        cur = probe;
    }
    if cur.is_empty() {
        "/".to_string()
    } else {
        cur
    }
}

pub fn try_run_builtin(
    cmd: &str,
    args: &[String],
    _stdin: &mut String,
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
        "pwd" => {
            let mut physical = false;
            for a in args {
                if let Some(stripped) = a.strip_prefix('-') {
                    for ch in stripped.chars() {
                        if ch == 'P' {
                            physical = true;
                        } else if ch == 'L' {
                            physical = false;
                        }
                    }
                }
            }
            let out_path = if physical {
                resolve_physical_path(cwd, cwd, fs)
            } else {
                cwd.clone()
            };
            Some(BuiltinOutcome {
                stdout: format!("{out_path}\n"),
                stderr: String::new(),
                exit_code: 0,
            })
        }
        "cd" => {
            let mut physical = false;
            let mut idx = 0usize;
            while idx < args.len() {
                let a = &args[idx];
                if a == "--" {
                    idx += 1;
                    break;
                } else if a.starts_with('-') && a.len() > 1 {
                    for ch in a[1..].chars() {
                        if ch == 'P' {
                            physical = true;
                        } else if ch == 'L' {
                            physical = false;
                        }
                    }
                    idx += 1;
                } else {
                    break;
                }
            }
            let raw_target = args.get(idx).map(|s| s.as_str());
            let mut print_new = false;
            let target = match raw_target {
                Some("-") => {
                    print_new = true;
                    match env.get("OLDPWD") {
                        Some(old) => old.clone(),
                        None => {
                            return Some(BuiltinOutcome {
                                stdout: String::new(),
                                stderr: "cd: OLDPWD not set\n".to_string(),
                                exit_code: 1,
                            });
                        }
                    }
                }
                Some(t) => t.to_string(),
                None => env.get("HOME").cloned().unwrap_or_else(|| "/".to_string()),
            };
            let resolved = if physical {
                resolve_physical_path(cwd, &target, fs)
            } else {
                resolve_posix_path(cwd, &target)
            };
            if fs.is_dir(&resolved) {
                env.insert("OLDPWD".to_string(), cwd.clone());
                *cwd = resolved.clone();
                env.insert("PWD".to_string(), resolved.clone());
                Some(BuiltinOutcome {
                    stdout: if print_new {
                        format!("{resolved}\n")
                    } else {
                        String::new()
                    },
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
        "pushd" => {
            let stack: Vec<String> = env
                .get("__dirstack")
                .filter(|s| !s.is_empty())
                .map(|s| s.split('\x1f').map(|p| p.to_string()).collect())
                .unwrap_or_default();
            let pos_arg = args.iter().find(|a| *a != "-n");
            let mut all = vec![cwd.clone()];
            all.extend(stack.clone());
            match pos_arg {
                None => {
                    if stack.is_empty() {
                        return Some(BuiltinOutcome {
                            stdout: String::new(),
                            stderr: "pushd: no other directory\n".to_string(),
                            exit_code: 1,
                        });
                    }
                    all.swap(0, 1);
                }
                Some(arg) if (arg.starts_with('+') || arg.starts_with('-')) && arg[1..].chars().all(|c| c.is_ascii_digit()) => {
                    let n = arg[1..].parse::<usize>().unwrap_or(0);
                    let len = all.len();
                    if n >= len {
                        return Some(BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("pushd: {arg}: directory stack index out of range\n"),
                            exit_code: 1,
                        });
                    }
                    if arg.starts_with('+') {
                        all.rotate_left(n);
                    } else {
                        all.rotate_right(n);
                    }
                }
                Some(target) => {
                    let resolved = resolve_posix_path(cwd, target);
                    if !fs.is_dir(&resolved) {
                        return Some(BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("pushd: {target}: No such file or directory\n"),
                            exit_code: 1,
                        });
                    }
                    all.insert(0, resolved);
                }
            }
            let new_cwd = all[0].clone();
            let new_stack = all[1..].to_vec();
            env.insert("OLDPWD".to_string(), cwd.clone());
            *cwd = new_cwd.clone();
            env.insert("PWD".to_string(), new_cwd);
            sync_dirstack_env(cwd, &new_stack, env);
            Some(BuiltinOutcome {
                stdout: format!("{}\n", all.join(" ")),
                stderr: String::new(),
                exit_code: 0,
            })
        }
        "popd" => {
            let stack: Vec<String> = env
                .get("__dirstack")
                .filter(|s| !s.is_empty())
                .map(|s| s.split('\x1f').map(|p| p.to_string()).collect())
                .unwrap_or_default();
            if stack.is_empty() {
                return Some(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: "popd: directory stack empty\n".to_string(),
                    exit_code: 1,
                });
            }
            let mut all = vec![cwd.clone()];
            all.extend(stack);
            if let Some(arg) = args.iter().find(|a| (a.starts_with('+') || a.starts_with('-')) && a[1..].chars().all(|c| c.is_ascii_digit())) {
                let n = arg[1..].parse::<usize>().unwrap_or(0);
                let idx = if arg.starts_with('+') {
                    n
                } else {
                    all.len().saturating_sub(1 + n)
                };
                if idx >= all.len() {
                    return Some(BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("popd: {arg}: directory stack index out of range\n"),
                        exit_code: 1,
                    });
                }
                all.remove(idx);
            } else {
                all.remove(0);
            }
            let new_cwd = all[0].clone();
            let new_stack = all[1..].to_vec();
            env.insert("OLDPWD".to_string(), cwd.clone());
            *cwd = new_cwd.clone();
            env.insert("PWD".to_string(), new_cwd);
            sync_dirstack_env(cwd, &new_stack, env);
            Some(BuiltinOutcome {
                stdout: format!("{}\n", all.join(" ")),
                stderr: String::new(),
                exit_code: 0,
            })
        }
        "dirs" => {
            let mut per_line = false;
            let mut verbose = false;
            let mut clear = false;
            for a in args {
                if let Some(stripped) = a.strip_prefix('-') {
                    for ch in stripped.chars() {
                        match ch {
                            'p' => per_line = true,
                            'v' => verbose = true,
                            'c' => clear = true,
                            _ => {}
                        }
                    }
                }
            }
            if clear {
                sync_dirstack_env(cwd, &[], env);
                return Some(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 0,
                });
            }
            let stack: Vec<String> = env
                .get("__dirstack")
                .filter(|s| !s.is_empty())
                .map(|s| s.split('\x1f').map(|p| p.to_string()).collect())
                .unwrap_or_default();
            let mut all = vec![cwd.clone()];
            all.extend(stack);
            let out = if verbose {
                all.iter()
                    .enumerate()
                    .map(|(i, d)| format!(" {i}  {d}\n"))
                    .collect()
            } else if per_line {
                format!("{}\n", all.join("\n"))
            } else {
                format!("{}\n", all.join(" "))
            };
            Some(BuiltinOutcome {
                stdout: out,
                stderr: String::new(),
                exit_code: 0,
            })
        }
        "echo" => {
            let mut newline = true;
            let mut interpret_escapes = false;
            let mut idx = 0usize;
            while idx < args.len() {
                let arg = &args[idx];
                if arg.starts_with('-')
                    && arg.len() > 1
                    && arg[1..].chars().all(|c| matches!(c, 'n' | 'e' | 'E'))
                {
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
                if let Some((before_c, _)) = raw.split_once("\\c") {
                    newline = false;
                    decode_ansi_c_escapes(before_c)
                } else {
                    decode_ansi_c_escapes(&raw)
                }
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
        "test" | "[" | "[[" => Some(builtin_test(cmd, args, cwd, env, fs)),
        "umask" => Some(builtin_umask(args, env)),
        "hash" => Some(builtin_hash(args, env)),
        "alias" | "unalias" => Some(BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
        }),
        "let" => {
            if args.is_empty() {
                return Some(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: "let: expression expected\n".to_string(),
                    exit_code: 1,
                });
            }
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

fn builtin_umask(args: &[String], env: &mut BTreeMap<String, String>) -> BuiltinOutcome {
    let cur_str = env
        .get("__umask")
        .cloned()
        .unwrap_or_else(|| "0022".to_string());
    let cur_val = u32::from_str_radix(&cur_str, 8).unwrap_or(0o022);

    let mut symbolic = false;
    let mut print_cmd = false;
    let mut mode_arg: Option<&str> = None;
    for a in args {
        if a == "-S" {
            symbolic = true;
        } else if a == "-p" {
            print_cmd = true;
        } else if !a.starts_with('-') {
            mode_arg = Some(a.as_str());
        }
    }

    if let Some(m) = mode_arg {
        let new_mask = if m.chars().all(|c| ('0'..='7').contains(&c)) {
            u32::from_str_radix(m, 8).unwrap_or(cur_val) & 0o777
        } else {
            let mut allowed = !cur_val & 0o777;
            for clause in m.split(',') {
                if let Some((who, perms)) = clause.split_once('=') {
                    let mut pbits = 0u32;
                    for pc in perms.chars() {
                        match pc {
                            'r' => pbits |= 4,
                            'w' => pbits |= 2,
                            'x' => pbits |= 1,
                            _ => {}
                        }
                    }
                    let who_s = if who.is_empty() { "ugo" } else { who };
                    for wc in who_s.chars() {
                        match wc {
                            'u' => allowed = (allowed & !0o700) | (pbits << 6),
                            'g' => allowed = (allowed & !0o070) | (pbits << 3),
                            'o' => allowed = (allowed & !0o007) | pbits,
                            'a' => {
                                allowed = (pbits << 6) | (pbits << 3) | pbits;
                            }
                            _ => {}
                        }
                    }
                }
            }
            (!allowed) & 0o777
        };
        env.insert("__umask".to_string(), format!("{new_mask:04o}"));
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
        };
    }

    if symbolic {
        let allowed = (!cur_val) & 0o777;
        let fmt_bits = |bits: u32| -> String {
            let mut s = String::new();
            if bits & 4 != 0 {
                s.push('r');
            }
            if bits & 2 != 0 {
                s.push('w');
            }
            if bits & 1 != 0 {
                s.push('x');
            }
            s
        };
        let u = fmt_bits((allowed >> 6) & 7);
        let g = fmt_bits((allowed >> 3) & 7);
        let o = fmt_bits(allowed & 7);
        return BuiltinOutcome {
            stdout: format!("u={u},g={g},o={o}\n"),
            stderr: String::new(),
            exit_code: 0,
        };
    }

    let out = if print_cmd {
        format!("umask {cur_val:04o}\n")
    } else {
        format!("{cur_val:04o}\n")
    };
    BuiltinOutcome {
        stdout: out,
        stderr: String::new(),
        exit_code: 0,
    }
}

fn builtin_hash(args: &[String], env: &mut BTreeMap<String, String>) -> BuiltinOutcome {
    if args.is_empty() || args.first().map(|s| s.as_str()) == Some("-r") {
        let keys: Vec<String> = env
            .keys()
            .filter(|k| k.starts_with("__hash__"))
            .cloned()
            .collect();
        for k in keys {
            env.remove(&k);
        }
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
        };
    }
    if args[0] == "-p" && args.len() >= 3 {
        let path = &args[1];
        let name = &args[2];
        env.insert(format!("__hash__{name}"), path.clone());
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
        };
    }
    if args[0] == "-d" && args.len() >= 2 {
        let name = &args[1];
        env.remove(&format!("__hash__{name}"));
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
        };
    }
    if args[0] == "-t" && args.len() >= 2 {
        let name = &args[1];
        if let Some(p) = env.get(&format!("__hash__{name}")) {
            return BuiltinOutcome {
                stdout: format!("{p}\n"),
                stderr: String::new(),
                exit_code: 0,
            };
        }
        return BuiltinOutcome {
            stdout: format!("/usr/bin/{name}\n"),
            stderr: String::new(),
            exit_code: 0,
        };
    }
    BuiltinOutcome {
        stdout: String::new(),
        stderr: String::new(),
        exit_code: 0,
    }
}

fn parse_printf_int(s: &str) -> i64 {
    let trimmed = s.trim();
    if let Some(rest) = trimmed.strip_prefix('\'').or_else(|| trimmed.strip_prefix('"')) {
        return rest.chars().next().map(|c| c as i64).unwrap_or(0);
    }
    if let Some(hex) = trimmed.strip_prefix("0x").or_else(|| trimmed.strip_prefix("0X")) {
        return i64::from_str_radix(hex, 16).unwrap_or(0);
    }
    if let Some(hex) = trimmed.strip_prefix("-0x").or_else(|| trimmed.strip_prefix("-0X")) {
        return -i64::from_str_radix(hex, 16).unwrap_or(0);
    }
    if trimmed.starts_with('0') && trimmed.len() > 1 && trimmed.chars().all(|c| ('0'..='7').contains(&c)) {
        return i64::from_str_radix(trimmed, 8).unwrap_or(0);
    }
    trimmed.parse::<i64>().unwrap_or(0)
}

fn parse_printf_uint(s: &str) -> u64 {
    parse_printf_int(s) as u64
}

pub fn builtin_printf(args: &[String], env: &mut BTreeMap<String, String>) -> BuiltinOutcome {
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
    let Some(raw_fmt) = args.get(idx) else {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
        };
    };
    let fmt = decode_ansi_c_escapes(raw_fmt);
    let val_args = &args[idx + 1..];
    let mut out = String::new();
    let mut arg_i = 0usize;
    let mut stop_all = false;

    loop {
        let start_arg_i = arg_i;
        let mut chars = fmt.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '%' {
                if chars.peek() == Some(&'%') {
                    chars.next();
                    out.push('%');
                    continue;
                }
                let mut flags = String::new();
                while let Some(&fc) = chars.peek() {
                    if matches!(fc, '-' | '+' | ' ' | '0' | '#') {
                        flags.push(chars.next().unwrap());
                    } else {
                        break;
                    }
                }
                let width: Option<isize> = if chars.peek() == Some(&'*') {
                    chars.next();
                    let w = val_args
                        .get(arg_i)
                        .map(|s| parse_printf_int(s) as isize)
                        .unwrap_or(0);
                    arg_i += 1;
                    Some(w)
                } else {
                    let mut ws = String::new();
                    while let Some(&wc) = chars.peek() {
                        if wc.is_ascii_digit() {
                            ws.push(chars.next().unwrap());
                        } else {
                            break;
                        }
                    }
                    if ws.is_empty() {
                        None
                    } else {
                        ws.parse::<isize>().ok()
                    }
                };
                let precision: Option<usize> = if chars.peek() == Some(&'.') {
                    chars.next();
                    if chars.peek() == Some(&'*') {
                        chars.next();
                        let p = val_args
                            .get(arg_i)
                            .map(|s| parse_printf_int(s).max(0) as usize)
                            .unwrap_or(0);
                        arg_i += 1;
                        Some(p)
                    } else {
                        let mut ps = String::new();
                        while let Some(&pc) = chars.peek() {
                            if pc.is_ascii_digit() {
                                ps.push(chars.next().unwrap());
                            } else {
                                break;
                            }
                        }
                        Some(ps.parse::<usize>().unwrap_or(0))
                    }
                } else {
                    None
                };

                let Some(conv) = chars.next() else {
                    break;
                };
                let raw_arg = val_args.get(arg_i).map(|s| s.as_str()).unwrap_or("");
                arg_i += 1;

                let mut left_align = flags.contains('-');
                let mut abs_width = width.unwrap_or(0);
                if abs_width < 0 {
                    left_align = true;
                    abs_width = -abs_width;
                }
                let w_usize = abs_width as usize;
                let zero_pad = flags.contains('0') && !left_align;
                let plus_sign = flags.contains('+');
                let space_sign = flags.contains(' ');
                let alt_form = flags.contains('#');

                let formatted = match conv {
                    's' => {
                        let s = if let Some(p) = precision {
                            raw_arg.chars().take(p).collect::<String>()
                        } else {
                            raw_arg.to_string()
                        };
                        pad_string(&s, w_usize, left_align, false)
                    }
                    'b' => {
                        if let Some((before_c, _)) = raw_arg.split_once("\\c") {
                            let s = decode_ansi_c_escapes(before_c);
                            out.push_str(&pad_string(&s, w_usize, left_align, false));
                            stop_all = true;
                            break;
                        }
                        let s = decode_ansi_c_escapes(raw_arg);
                        pad_string(&s, w_usize, left_align, false)
                    }
                    'q' => {
                        if raw_arg.is_empty() {
                            "''".to_string()
                        } else if raw_arg.chars().any(|c| c == '\n' || c == '\t' || c == '\r' || (c as u32) < 0x20 || (c as u32) == 0x7f) {
                            bash_quote_value(raw_arg)
                        } else if raw_arg
                            .chars()
                            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/' | ':' | '@'))
                        {
                            raw_arg.to_string()
                        } else {
                            let mut q = String::new();
                            for ch in raw_arg.chars() {
                                if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/') {
                                    q.push(ch);
                                } else {
                                    q.push('\\');
                                    q.push(ch);
                                }
                            }
                            q
                        }
                    }
                    'c' => raw_arg
                        .chars()
                        .next()
                        .map(|ch| ch.to_string())
                        .unwrap_or_default(),
                    'd' | 'i' => {
                        let n = parse_printf_int(raw_arg);
                        let sign = if n < 0 {
                            "-"
                        } else if plus_sign {
                            "+"
                        } else if space_sign {
                            " "
                        } else {
                            ""
                        };
                        let mut digits = n.unsigned_abs().to_string();
                        if let Some(p) = precision {
                            if p == 0 && n == 0 {
                                digits.clear();
                            } else if digits.len() < p {
                                digits = format!("{}{digits}", "0".repeat(p - digits.len()));
                            }
                        }
                        format_signed_num(sign, &digits, w_usize, left_align, zero_pad && precision.is_none())
                    }
                    'u' => {
                        let n = parse_printf_uint(raw_arg);
                        let mut digits = n.to_string();
                        if let Some(p) = precision
                            && digits.len() < p
                        {
                            digits = format!("{}{digits}", "0".repeat(p - digits.len()));
                        }
                        format_signed_num("", &digits, w_usize, left_align, zero_pad && precision.is_none())
                    }
                    'o' => {
                        let n = parse_printf_uint(raw_arg);
                        let mut digits = format!("{n:o}");
                        if alt_form && !digits.starts_with('0') {
                            digits = format!("0{digits}");
                        }
                        if let Some(p) = precision
                            && digits.len() < p
                        {
                            digits = format!("{}{digits}", "0".repeat(p - digits.len()));
                        }
                        format_signed_num("", &digits, w_usize, left_align, zero_pad && precision.is_none())
                    }
                    'x' | 'X' => {
                        let n = parse_printf_uint(raw_arg);
                        let mut digits = if conv == 'X' {
                            format!("{n:X}")
                        } else {
                            format!("{n:x}")
                        };
                        if let Some(p) = precision
                            && digits.len() < p
                        {
                            digits = format!("{}{digits}", "0".repeat(p - digits.len()));
                        }
                        let prefix = if alt_form && n != 0 {
                            if conv == 'X' { "0X" } else { "0x" }
                        } else {
                            ""
                        };
                        format_signed_num(prefix, &digits, w_usize, left_align, zero_pad && precision.is_none())
                    }
                    'f' | 'F' => {
                        let f = raw_arg.trim().parse::<f64>().unwrap_or(0.0);
                        let prec = precision.unwrap_or(6);
                        let sign = if f.is_sign_negative() {
                            "-"
                        } else if plus_sign {
                            "+"
                        } else if space_sign {
                            " "
                        } else {
                            ""
                        };
                        let abs_f = f.abs();
                        let body = format!("{abs_f:.prec$}");
                        format_signed_num(sign, &body, w_usize, left_align, zero_pad)
                    }
                    'e' | 'E' => {
                        let f = raw_arg.trim().parse::<f64>().unwrap_or(0.0);
                        let prec = precision.unwrap_or(6);
                        let s = format_scientific(f, prec, conv == 'E');
                        pad_string(&s, w_usize, left_align, zero_pad)
                    }
                    'g' | 'G' => {
                        let f = raw_arg.trim().parse::<f64>().unwrap_or(0.0);
                        let prec = precision.unwrap_or(6).max(1);
                        let s = format_general_float(f, prec, conv == 'G');
                        pad_string(&s, w_usize, left_align, zero_pad)
                    }
                    _ => raw_arg.to_string(),
                };
                out.push_str(&formatted);
            } else {
                out.push(c);
            }
        }
        if stop_all || arg_i >= val_args.len() || arg_i == start_arg_i {
            break;
        }
    }

    if let Some(var) = assign_var {
        let resolved = resolve_nameref_base(&var, env).to_string();
        env.insert(resolved.clone(), out);
        if let Some((base, _)) = resolved.split_once('[') {
            sync_array_metadata(base, env);
        }
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

fn pad_string(val: &str, width: usize, left_align: bool, zero_pad: bool) -> String {
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

fn format_signed_num(
    prefix: &str,
    digits: &str,
    width: usize,
    left_align: bool,
    zero_pad: bool,
) -> String {
    let total = prefix.len() + digits.len();
    if total >= width {
        return format!("{prefix}{digits}");
    }
    let pad = width - total;
    if left_align {
        format!("{prefix}{digits}{}", " ".repeat(pad))
    } else if zero_pad {
        format!("{prefix}{}{digits}", "0".repeat(pad))
    } else {
        format!("{}{prefix}{digits}", " ".repeat(pad))
    }
}

fn format_scientific(val: f64, prec: usize, upper: bool) -> String {
    if val == 0.0 {
        let e_ch = if upper { 'E' } else { 'e' };
        if prec == 0 {
            return format!("0{e_ch}+00");
        }
        return format!("0.{}{e_ch}+00", "0".repeat(prec));
    }
    let sign = if val < 0.0 { "-" } else { "" };
    let abs = val.abs();
    let exp = abs.log10().floor() as i32;
    let mant = abs / 10f64.powi(exp);
    let e_ch = if upper { 'E' } else { 'e' };
    let exp_sign = if exp >= 0 { '+' } else { '-' };
    let exp_abs = exp.unsigned_abs();
    format!("{sign}{mant:.prec$}{e_ch}{exp_sign}{exp_abs:02}")
}

fn format_general_float(val: f64, sig_digits: usize, upper: bool) -> String {
    if val == 0.0 {
        return "0".to_string();
    }
    let abs = val.abs();
    let exp = abs.log10().floor() as i32;
    if exp < -4 || exp >= sig_digits as i32 {
        let s = format_scientific(val, sig_digits.saturating_sub(1), upper);
        let e_ch = if upper { 'E' } else { 'e' };
        if let Some((m, e)) = s.split_once(e_ch) {
            let trimmed_m = m.trim_end_matches('0').trim_end_matches('.');
            return format!("{trimmed_m}{e_ch}{e}");
        }
        return s;
    }
    let frac_prec = (sig_digits as i32 - 1 - exp).max(0) as usize;
    let formatted = format!("{val:.frac_prec$}");
    if formatted.contains('.') {
        formatted
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    } else {
        formatted
    }
}

pub fn builtin_test(
    cmd: &str,
    raw_args: &[String],
    cwd: &str,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
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
    let mut pos = 0usize;
    let ok = eval_test_or(args, &mut pos, cwd, env, fs, cmd == "[[");
    BuiltinOutcome {
        stdout: String::new(),
        stderr: String::new(),
        exit_code: if ok { 0 } else { 1 },
    }
}

fn eval_test_or(
    args: &[String],
    pos: &mut usize,
    cwd: &str,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
    is_db: bool,
) -> bool {
    let mut left = eval_test_and(args, pos, cwd, env, fs, is_db);
    while let Some(tok) = args.get(*pos) {
        if tok == "||" || tok == "-o" {
            *pos += 1;
            let right = eval_test_and(args, pos, cwd, env, fs, is_db);
            left = left || right;
        } else {
            break;
        }
    }
    left
}

fn eval_test_and(
    args: &[String],
    pos: &mut usize,
    cwd: &str,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
    is_db: bool,
) -> bool {
    let mut left = eval_test_not(args, pos, cwd, env, fs, is_db);
    while let Some(tok) = args.get(*pos) {
        if tok == "&&" || tok == "-a" {
            *pos += 1;
            let right = eval_test_not(args, pos, cwd, env, fs, is_db);
            left = left && right;
        } else {
            break;
        }
    }
    left
}

fn eval_test_not(
    args: &[String],
    pos: &mut usize,
    cwd: &str,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
    is_db: bool,
) -> bool {
    if args.get(*pos).map(|s| s.as_str()) == Some("!") {
        *pos += 1;
        return !eval_test_not(args, pos, cwd, env, fs, is_db);
    }
    if args.get(*pos).map(|s| s.as_str()) == Some("(") {
        *pos += 1;
        let val = eval_test_or(args, pos, cwd, env, fs, is_db);
        if args.get(*pos).map(|s| s.as_str()) == Some(")") {
            *pos += 1;
        }
        return val;
    }
    eval_test_primary(args, pos, cwd, env, fs, is_db)
}

fn eval_test_primary(
    args: &[String],
    pos: &mut usize,
    cwd: &str,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
    is_db: bool,
) -> bool {
    if *pos >= args.len() {
        return false;
    }

    // Binary expression: left op right
    if *pos + 2 <= args.len()
        && let Some(op) = args.get(*pos + 1).map(|s| s.as_str())
        && matches!(
            op,
            "=" | "==" | "!=" | "=~" | "<" | ">" | "-eq" | "-ne" | "-lt" | "-le" | "-gt" | "-ge" | "-nt" | "-ot" | "-ef"
        )
    {
        let left = &args[*pos];
        let right = args.get(*pos + 2).map(|s| s.as_str()).unwrap_or("");
        *pos += 3;
        let nocase = env
            .get("__shopt_nocasematch")
            .map(|v| v == "1")
            .unwrap_or(false);
        return match op {
            "=" | "==" => {
                if is_db {
                    glob_match_ext(right, left, nocase)
                } else if nocase {
                    left.eq_ignore_ascii_case(right)
                } else {
                    left == right
                }
            }
            "!=" => {
                if is_db {
                    !glob_match_ext(right, left, nocase)
                } else if nocase {
                    !left.eq_ignore_ascii_case(right)
                } else {
                    left != right
                }
            }
            "=~" => {
                // Clean old BASH_REMATCH
                let old_keys: Vec<String> = env
                    .keys()
                    .filter(|k| k.starts_with("BASH_REMATCH["))
                    .cloned()
                    .collect();
                for k in old_keys {
                    env.remove(&k);
                }
                if let Some(caps) = regex_captures(right, left, nocase) {
                    for (i, cap) in caps.iter().enumerate() {
                        env.insert(format!("BASH_REMATCH[{i}]"), cap.clone());
                    }
                    sync_array_metadata("BASH_REMATCH", env);
                    true
                } else {
                    false
                }
            }
            "<" => left.as_str() < right,
            ">" => left.as_str() > right,
            "-eq" => {
                eval_arith(left, env).unwrap_or(0) == eval_arith(right, env).unwrap_or(0)
            }
            "-ne" => {
                eval_arith(left, env).unwrap_or(0) != eval_arith(right, env).unwrap_or(0)
            }
            "-lt" => {
                eval_arith(left, env).unwrap_or(0) < eval_arith(right, env).unwrap_or(0)
            }
            "-le" => {
                eval_arith(left, env).unwrap_or(0) <= eval_arith(right, env).unwrap_or(0)
            }
            "-gt" => {
                eval_arith(left, env).unwrap_or(0) > eval_arith(right, env).unwrap_or(0)
            }
            "-ge" => {
                eval_arith(left, env).unwrap_or(0) >= eval_arith(right, env).unwrap_or(0)
            }
            "-nt" => {
                let lp = resolve_posix_path(cwd, left);
                let rp = resolve_posix_path(cwd, right);
                match (fs.stat(&lp), fs.stat(&rp)) {
                    (Ok(ls), Ok(rs)) => ls.mtime_ms > rs.mtime_ms,
                    (Ok(_), Err(_)) => true,
                    _ => false,
                }
            }
            "-ot" => {
                let lp = resolve_posix_path(cwd, left);
                let rp = resolve_posix_path(cwd, right);
                match (fs.stat(&lp), fs.stat(&rp)) {
                    (Ok(ls), Ok(rs)) => ls.mtime_ms < rs.mtime_ms,
                    (Err(_), Ok(_)) => true,
                    _ => false,
                }
            }
            "-ef" => {
                resolve_physical_path(cwd, left, fs) == resolve_physical_path(cwd, right, fs)
            }
            _ => false,
        };
    }

    // Unary expression: -op arg
    if *pos + 1 < args.len()
        && matches!(
            args[*pos].as_str(),
            "-z" | "-n" | "-e" | "-a" | "-f" | "-d" | "-s" | "-L" | "-h" | "-r" | "-w" | "-x" | "-p" | "-S" | "-b" | "-c" | "-g" | "-u" | "-k" | "-O" | "-G" | "-N" | "-t" | "-v" | "-o"
        )
    {
        let op = args[*pos].as_str();
        let val = &args[*pos + 1];
        *pos += 2;
        let path = resolve_posix_path(cwd, val);
        return match op {
            "-z" => val.is_empty(),
            "-n" => !val.is_empty(),
            "-e" | "-a" => fs.stat(&path).is_ok(),
            "-f" => fs.exists(&path) && !fs.is_dir(&path),
            "-d" => fs.is_dir(&path),
            "-s" => fs.read_file(&path).map(|b| !b.is_empty()).unwrap_or(false),
            "-L" | "-h" => fs.readlink(&path).is_ok(),
            "-r" => fs.stat(&path).map(|s| s.mode & 0o444 != 0).unwrap_or(false),
            "-w" => fs.stat(&path).map(|s| s.mode & 0o222 != 0).unwrap_or(false),
            "-x" => fs
                .stat(&path)
                .map(|s| fs.is_dir(&path) || (s.mode & 0o111 != 0))
                .unwrap_or(false),
            "-v" => {
                let resolved = resolve_nameref_base(val, env);
                env.contains_key(resolved) || env.contains_key(val)
            }
            "-o" => env
                .get(&format!("__set_{val}"))
                .map(|v| v == "1")
                .unwrap_or(false),
            "-O" => {
                let euid = env
                    .get("__euid")
                    .and_then(|v| v.parse::<u32>().ok())
                    .unwrap_or(0);
                fs.exists(&path) && euid == 0
            }
            "-G" => {
                let egid = env
                    .get("__egid")
                    .and_then(|v| v.parse::<u32>().ok())
                    .unwrap_or(0);
                fs.exists(&path) && egid == 0
            }
            _ => fs.exists(&path),
        };
    }

    let single = &args[*pos];
    *pos += 1;
    !single.is_empty()
}

fn sync_dirstack_env(cwd: &str, stack: &[String], env: &mut BTreeMap<String, String>) {
    if stack.is_empty() {
        env.remove("__dirstack");
    } else {
        env.insert("__dirstack".to_string(), stack.join("\x1f"));
    }
    let old: Vec<String> = env
        .keys()
        .filter(|k| k.starts_with("DIRSTACK["))
        .cloned()
        .collect();
    for k in old {
        env.remove(&k);
    }
    env.insert("DIRSTACK".to_string(), cwd.to_string());
    env.insert("DIRSTACK[0]".to_string(), cwd.to_string());
    for (idx, d) in stack.iter().enumerate() {
        env.insert(format!("DIRSTACK[{}]", idx + 1), d.clone());
    }
    sync_array_metadata("DIRSTACK", env);
}
