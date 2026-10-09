use crate::commands::search::regex_captures;
use crate::shell::expand::{
    bash_quote_value, decode_ansi_c_escapes, decode_echo_b_escapes, eval_arith, glob_match_ext, resolve_nameref_base,
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
                if a == "--" || !a.starts_with('-') || a == "-" {
                    break;
                }
                if a == "--logical" {
                    physical = false;
                    continue;
                }
                if a == "--physical" {
                    physical = true;
                    continue;
                }
                for ch in a[1..].chars() {
                    if ch == 'P' {
                        physical = true;
                    } else if ch == 'L' {
                        physical = false;
                    } else {
                        return Some(BuiltinOutcome {
                            stdout: String::new(),
                            stderr: "pwd: invalid option\n".to_string(),
                            exit_code: 2,
                        });
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
        "cd" => Some(builtin_cd("cd", args, false, cwd, env, fs)),
        "pushd" | "popd" | "dirs" => Some(builtin_directory_stack(cmd, args, cwd, env, fs)),
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
                    decode_echo_b_escapes(before_c)
                } else {
                    decode_echo_b_escapes(&raw)
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
        "hash" => Some(builtin_hash(args, cwd, env, fs)),
        "let" => {
            if args.first().map(|s| s.as_str()) == Some("--help") {
                return Some(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: "let: --help: unsupported option\n".to_string(),
                    exit_code: 2,
                });
            }
            let offset = if args.first().map(|s| s.as_str()) == Some("--") {
                1
            } else {
                0
            };
            if args.len() == offset {
                return Some(BuiltinOutcome {
                    stdout: String::new(),
                    stderr: "let: expression expected\n".to_string(),
                    exit_code: 1,
                });
            }
            let mut last = 0i64;
            for arg in &args[offset..] {
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

fn builtin_cd(
    invoked: &str,
    args: &[String],
    skip_opts: bool,
    cwd: &mut String,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut physical = false;
    let mut offset = 0usize;
    if !skip_opts {
        while offset < args.len() {
            let option = &args[offset];
            if option == "--" {
                offset += 1;
                break;
            }
            if !option.starts_with('-') || option == "-" {
                break;
            }
            for flag in option[1..].chars() {
                if flag == 'L' || flag == 'P' {
                    physical = flag == 'P';
                } else {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("cd: -{flag}: invalid option\n"),
                        exit_code: 2,
                    };
                }
            }
            offset += 1;
        }
    }
    if args.len().saturating_sub(offset) > 1 {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: format!("{invoked}: too many arguments\n"),
            exit_code: 1,
        };
    }
    let operand = args.get(offset).map(|s| s.as_str());
    let target = match operand {
        Some("-") => match env.get("OLDPWD") {
            Some(old) => old.clone(),
            None => {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("{invoked}: OLDPWD not set\n"),
                    exit_code: 1,
                };
            }
        },
        Some(t) => t.to_string(),
        None => match env.get("HOME") {
            Some(home) => home.clone(),
            None => {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("{invoked}: HOME not set\n"),
                    exit_code: 1,
                };
            }
        },
    };

    let probe_target = if target.is_empty() {
        "."
    } else {
        target.as_str()
    };
    let check_logical_parents = |raw_path: &str| -> Result<(), &'static str> {
        let mut comps: Vec<&str> = Vec::new();
        for comp in raw_path.split('/') {
            if comp == ".." {
                let parent = if comps.is_empty() {
                    "/".to_string()
                } else {
                    format!("/{}", comps.join("/"))
                };
                if !fs.is_dir(&parent) {
                    return Err(if fs.exists(&parent) {
                        "Not a directory"
                    } else {
                        "No such file or directory"
                    });
                }
                comps.pop();
            } else if !comp.is_empty() && comp != "." {
                comps.push(comp);
            }
        }
        Ok(())
    };

    let eligible_cdpath = !probe_target.starts_with('/')
        && probe_target != "."
        && probe_target != ".."
        && !probe_target.starts_with("./")
        && !probe_target.starts_with("../");

    let mut selected: Option<(String, Option<String>)> = None;
    if eligible_cdpath
        && let Some(cdpath) = env.get("CDPATH").cloned()
        && !cdpath.is_empty()
    {
        for comp in cdpath.split(':') {
            let raw = if comp.is_empty() {
                if probe_target.starts_with('/') {
                    probe_target.to_string()
                } else if cwd == "/" {
                    format!("/{probe_target}")
                } else {
                    format!("{cwd}/{probe_target}")
                }
            } else if comp.starts_with('/') {
                format!("{comp}/{probe_target}")
            } else if cwd == "/" {
                format!("/{comp}/{probe_target}")
            } else {
                format!("{cwd}/{comp}/{probe_target}")
            };
            if !physical && check_logical_parents(&raw).is_err() {
                continue;
            }
            let candidate = if physical {
                resolve_physical_path(cwd, &raw, fs)
            } else {
                resolve_posix_path(cwd, &raw)
            };
            if fs.is_dir(&candidate) {
                let printed = if !comp.is_empty() {
                    Some(if physical {
                        format!(
                            "{comp}{}{probe_target}",
                            if comp.ends_with('/') { "" } else { "/" }
                        )
                    } else {
                        candidate.clone()
                    })
                } else {
                    None
                };
                selected = Some((candidate, printed));
                break;
            }
        }
    }

    let (resolved, printed_from_cdpath) = if let Some(sel) = selected {
        sel
    } else {
        let raw = if probe_target.starts_with('/') {
            probe_target.to_string()
        } else if cwd == "/" {
            format!("/{probe_target}")
        } else {
            format!("{cwd}/{probe_target}")
        };
        if !physical && let Err(reason) = check_logical_parents(&raw) {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("{invoked}: {target}: {reason}\n"),
                exit_code: 1,
            };
        }
        let cand = if physical {
            resolve_physical_path(cwd, probe_target, fs)
        } else {
            resolve_posix_path(cwd, probe_target)
        };
        if !fs.is_dir(&cand) {
            let reason = if fs.exists(&cand) {
                "Not a directory"
            } else {
                "No such file or directory"
            };
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("{invoked}: {target}: {reason}\n"),
                exit_code: 1,
            };
        }
        (cand, None)
    };

    if env
        .get("__attr__OLDPWD")
        .is_some_and(|a| a.contains('r'))
    {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "OLDPWD: readonly variable\n".to_string(),
            exit_code: 1,
        };
    }
    env.insert("OLDPWD".to_string(), cwd.clone());
    env.remove("__unexported__OLDPWD");
    *cwd = resolved.clone();
    if env.get("__attr__PWD").is_some_and(|a| a.contains('r')) {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "PWD: readonly variable\n".to_string(),
            exit_code: 1,
        };
    }
    env.insert("PWD".to_string(), resolved);
    env.remove("__unexported__PWD");

    let printed = printed_from_cdpath.or_else(|| {
        if operand == Some("-") {
            Some(target)
        } else {
            None
        }
    });
    BuiltinOutcome {
        stdout: printed.map(|p| format!("{p}\n")).unwrap_or_default(),
        stderr: String::new(),
        exit_code: 0,
    }
}

fn parse_dirstack_index(token: &str) -> Option<i64> {
    let bytes = token.as_bytes();
    if bytes.len() < 2 {
        return None;
    }
    let mut phase = 0u8; // 0: leading, 1: sign, 2: digits, 3: trailing
    let mut negative = false;
    let mut digits = false;
    let mut value: u128 = 0;
    for &b in &bytes[1..] {
        let ws = b == b' ' || (9..=13).contains(&b);
        if phase == 0 && ws {
            continue;
        }
        if phase == 0 && (b == b'+' || b == b'-') {
            negative = b == b'-';
            phase = 1;
            continue;
        }
        if b.is_ascii_digit() && phase != 3 {
            phase = 2;
            digits = true;
            value = value.saturating_mul(10).saturating_add((b - b'0') as u128);
            let max = if negative {
                9_223_372_036_854_775_808u128
            } else {
                9_223_372_036_854_775_807u128
            };
            if value > max {
                return None;
            }
        } else if (phase == 2 || phase == 3) && ws {
            phase = 3;
        } else {
            return None;
        }
    }
    if !digits {
        return None;
    }
    if negative {
        if value == 9_223_372_036_854_775_808u128 {
            Some(i64::MIN)
        } else {
            Some(-(value as i64))
        }
    } else {
        Some(value as i64)
    }
}

fn format_dirstack_display(
    cwd: &str,
    entries: &[String],
    long: bool,
    lines: bool,
    verbose: bool,
    single_index: Option<usize>,
    home: Option<&str>,
) -> String {
    let start = single_index.unwrap_or(0);
    let end = single_index.unwrap_or(entries.len());
    let mut out = String::new();
    for index in start..=end {
        let raw_entry = if index == 0 {
            cwd
        } else {
            entries[index - 1].as_str()
        };
        let entry = if !long
            && let Some(h) = home
            && h.len() > 1
            && raw_entry.starts_with(h)
            && (raw_entry.len() == h.len() || raw_entry.as_bytes().get(h.len()) == Some(&b'/'))
        {
            format!("~{}", &raw_entry[h.len()..])
        } else {
            raw_entry.to_string()
        };
        if index != start && !lines && !verbose {
            out.push(' ');
        }
        if verbose {
            out.push_str(&format!("{index:>2}  "));
        }
        out.push_str(&entry);
        if lines || verbose {
            out.push('\n');
        }
    }
    if !lines && !verbose {
        out.push('\n');
    }
    out
}

fn builtin_directory_stack(
    cmd: &str,
    args: &[String],
    cwd: &mut String,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let tail: Vec<String> = env
        .get("__dirstack")
        .filter(|s| !s.is_empty())
        .map(|s| s.split('\x1f').map(|p| p.to_string()).collect())
        .unwrap_or_default();
    let count = tail.len() as i64;
    let mut no_cd = false;
    let mut clear = false;
    let mut long = false;
    let mut lines = false;
    let mut verbose = false;
    let mut selected: Option<i64> = None;
    let mut target: Option<String> = None;

    let fail = |msg: &str, code: i32| BuiltinOutcome {
        stdout: String::new(),
        stderr: format!("{cmd}: {msg}\n"),
        exit_code: code,
    };

    for (offset, token) in args.iter().enumerate() {
        if token == "--" {
            if cmd == "pushd" && selected.is_none() && offset + 1 < args.len() {
                target = Some(args[offset + 1].clone());
                if !no_cd && offset + 2 < args.len() {
                    return fail("too many arguments", 1);
                }
            }
            break;
        }
        if cmd == "dirs" && matches!(token.as_str(), "-c" | "-l" | "-p" | "-v") {
            match token.as_str() {
                "-c" => clear = true,
                "-l" => long = true,
                "-p" => lines = true,
                "-v" => verbose = true,
                _ => {}
            }
            continue;
        }
        if cmd != "dirs" && token == "-n" {
            no_cd = true;
            continue;
        }
        if (token.starts_with('+') || token.starts_with('-')) && !(cmd == "pushd" && token == "-") {
            let Some(num) = parse_dirstack_index(token) else {
                return fail("invalid directory stack index", 2);
            };
            let sel = if token.starts_with('+') {
                num
            } else {
                count.saturating_sub(num)
            };
            if cmd == "pushd" && (sel < 0 || sel > count) {
                return fail("directory stack index out of range", 1);
            }
            selected = Some(sel);
            continue;
        }
        if cmd == "popd" && token.is_empty() {
            break;
        }
        if cmd != "pushd" {
            return fail("invalid directory stack argument", 2);
        }
        if selected.is_none() {
            target = Some(token.clone());
            if !no_cd && offset + 1 < args.len() {
                return fail("too many arguments", 1);
            }
        }
        break;
    }

    if cmd == "dirs" {
        if clear {
            sync_dirstack_env(cwd, &[], env);
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
            };
        }
        let single = if let Some(sel) = selected {
            if sel < 0 || sel > count {
                return fail("directory stack index out of range", 1);
            }
            Some(sel as usize)
        } else {
            None
        };
        let home = env.get("HOME").cloned();
        let out = format_dirstack_display(cwd, &tail, long, lines, verbose, single, home.as_deref());
        return BuiltinOutcome {
            stdout: out,
            stderr: String::new(),
            exit_code: 0,
        };
    }

    if cmd == "pushd" {
        if let Some(sel) = selected {
            if sel < 0 || sel > count {
                return fail("directory stack index out of range", 1);
            }
            let index = sel as usize;
            let mut out = String::new();
            if !(no_cd && index == 0) {
                let old_cwd = cwd.clone();
                let total = tail.len() + 1;
                let at = |full_idx: usize| -> String {
                    if full_idx == 0 {
                        old_cwd.clone()
                    } else {
                        tail[full_idx - 1].clone()
                    }
                };
                let next_tail: Vec<String> = (0..tail.len())
                    .map(|slot| at((index + slot + 1) % total))
                    .collect();
                let target_dir = at(index);
                sync_dirstack_env(cwd, &next_tail, env);
                if !no_cd {
                    let cd_res = builtin_cd("pushd", std::slice::from_ref(&target_dir), true, cwd, env, fs);
                    if cd_res.exit_code != 0 {
                        return cd_res;
                    }
                    out.push_str(&cd_res.stdout);
                    sync_dirstack_env(cwd, &next_tail, env);
                    let home = env.get("HOME").cloned();
                    out.push_str(&format_dirstack_display(
                        cwd,
                        &next_tail,
                        long,
                        lines,
                        verbose,
                        None,
                        home.as_deref(),
                    ));
                }
            }
            return BuiltinOutcome {
                stdout: out,
                stderr: String::new(),
                exit_code: 0,
            };
        } else if let Some(tgt) = target {
            let saved = if no_cd { tgt.clone() } else { cwd.clone() };
            let mut next_tail = Vec::with_capacity(tail.len() + 1);
            next_tail.push(saved);
            next_tail.extend(tail);
            let mut out = String::new();
            if !no_cd {
                let cd_res = builtin_cd("pushd", std::slice::from_ref(&tgt), true, cwd, env, fs);
                if cd_res.exit_code != 0 {
                    return cd_res;
                }
                out.push_str(&cd_res.stdout);
            }
            sync_dirstack_env(cwd, &next_tail, env);
            let home = env.get("HOME").cloned();
            out.push_str(&format_dirstack_display(
                cwd,
                &next_tail,
                long,
                lines,
                verbose,
                None,
                home.as_deref(),
            ));
            return BuiltinOutcome {
                stdout: out,
                stderr: String::new(),
                exit_code: 0,
            };
        } else if !no_cd {
            if tail.is_empty() {
                return fail("no other directory", 1);
            }
            let old_cwd = cwd.clone();
            let top = tail[0].clone();
            let mut next_tail = tail;
            next_tail[0] = old_cwd;
            sync_dirstack_env(cwd, &next_tail, env);
            let cd_res = builtin_cd("pushd", std::slice::from_ref(&top), true, cwd, env, fs);
            if cd_res.exit_code != 0 {
                return cd_res;
            }
            sync_dirstack_env(cwd, &next_tail, env);
            let mut out = cd_res.stdout;
            let home = env.get("HOME").cloned();
            out.push_str(&format_dirstack_display(
                cwd,
                &next_tail,
                long,
                lines,
                verbose,
                None,
                home.as_deref(),
            ));
            return BuiltinOutcome {
                stdout: out,
                stderr: String::new(),
                exit_code: 0,
            };
        }
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
        };
    }

    let sel = selected.unwrap_or(0);
    if sel < 0 || sel > count {
        return fail("directory stack index out of range", 1);
    }
    if tail.is_empty() {
        return fail("directory stack empty", 1);
    }
    let index = sel as usize;
    let removed = index.saturating_sub(1);
    let top = tail[0].clone();
    let mut next_tail = tail;
    next_tail.remove(removed);
    let mut out = String::new();
    if index == 0 && !no_cd {
        let cd_res = builtin_cd("popd", std::slice::from_ref(&top), true, cwd, env, fs);
        if cd_res.exit_code != 0 {
            return cd_res;
        }
        out.push_str(&cd_res.stdout);
    }
    sync_dirstack_env(cwd, &next_tail, env);
    let home = env.get("HOME").cloned();
    out.push_str(&format_dirstack_display(
        cwd,
        &next_tail,
        long,
        lines,
        verbose,
        None,
        home.as_deref(),
    ));
    BuiltinOutcome {
        stdout: out,
        stderr: String::new(),
        exit_code: 0,
    }
}

fn parse_umask_mode(value: &str, previous: u32) -> Option<u32> {
    let bytes = value.as_bytes();
    if !bytes.is_empty() && bytes[0].is_ascii_digit() {
        let mut mode = 0u32;
        for &b in bytes {
            if !(b'0'..=b'7').contains(&b) {
                return None;
            }
            mode = mode * 8 + (b - b'0') as u32;
            if mode > 0o777 {
                return None;
            }
        }
        return Some(mode);
    }
    let mut allowed = (!previous) & 0o777;
    for clause in value.split(',') {
        let cbytes = clause.as_bytes();
        let mut index = 0usize;
        let mut who = 0u32;
        while index < cbytes.len() {
            match cbytes[index] {
                b'u' => who |= 0o700,
                b'g' => who |= 0o070,
                b'o' => who |= 0o007,
                b'a' => who |= 0o777,
                _ => break,
            }
            index += 1;
        }
        if who == 0 {
            who = 0o777;
        }
        let mut operations = 0usize;
        while index < cbytes.len() {
            let operator = cbytes[index];
            index += 1;
            if !matches!(operator, b'+' | b'-' | b'=') {
                return None;
            }
            operations += 1;
            let mut bits = 0u32;
            while index < cbytes.len() && !matches!(cbytes[index], b'+' | b'-' | b'=') {
                match cbytes[index] {
                    b'r' => bits |= 0o444,
                    b'w' => bits |= 0o222,
                    b'x' => bits |= 0o111,
                    b'u' | b'g' | b'o' => {
                        let shift = match cbytes[index] {
                            b'u' => 6,
                            b'g' => 3,
                            _ => 0,
                        };
                        let triad = (allowed >> shift) & 7;
                        bits |= triad | (triad << 3) | (triad << 6);
                    }
                    _ => return None,
                }
                index += 1;
            }
            bits &= who;
            allowed = match operator {
                b'=' => (allowed & !who) | bits,
                b'+' => allowed | bits,
                _ => allowed & !bits,
            };
        }
        if operations == 0 {
            return None;
        }
    }
    Some((!allowed) & 0o777)
}

fn format_symbolic_umask(mask: u32) -> String {
    let allowed = (!mask) & 0o777;
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
    format!("u={u},g={g},o={o}")
}

fn builtin_umask(args: &[String], env: &mut BTreeMap<String, String>) -> BuiltinOutcome {
    let cur_str = env
        .get("__umask")
        .cloned()
        .unwrap_or_else(|| "0022".to_string());
    let mut cur_val = u32::from_str_radix(&cur_str, 8).unwrap_or(0o022);

    let mut symbolic = false;
    let mut printable = false;
    let mut index = 0usize;
    while index < args.len() && args[index].starts_with('-') && args[index] != "-" {
        let option = &args[index];
        index += 1;
        if option == "--" {
            break;
        }
        for flag in option[1..].chars() {
            if flag == 'S' {
                symbolic = true;
            } else if flag == 'p' {
                printable = true;
            } else {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("umask: {option}: invalid option\n"),
                    exit_code: 2,
                };
            }
        }
    }

    if let Some(operand) = args.get(index) {
        let Some(new_mask) = parse_umask_mode(operand, cur_val) else {
            let reason = if operand.as_bytes().first().is_some_and(|b| b.is_ascii_digit()) {
                "octal number out of range"
            } else {
                "invalid mode"
            };
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("umask: {operand}: {reason}\n"),
                exit_code: 1,
            };
        };
        cur_val = new_mask;
        env.insert("__umask".to_string(), format!("{new_mask:04o}"));
        if !symbolic {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
            };
        }
        printable = false;
    }

    let value = if symbolic {
        format_symbolic_umask(cur_val)
    } else {
        format!("{cur_val:04o}")
    };
    let prefix = if printable {
        if symbolic { "umask -S " } else { "umask " }
    } else {
        ""
    };
    BuiltinOutcome {
        stdout: format!("{prefix}{value}\n"),
        stderr: String::new(),
        exit_code: 0,
    }
}

fn resolve_hash_command(name: &str, cwd: &str, env: &BTreeMap<String, String>, fs: &dyn SafeBashFs) -> Option<String> {
    if name.contains('/') {
        let full = resolve_posix_path(cwd, name);
        if fs.exists(&full) && !fs.is_dir(&full) {
            return Some(full);
        }
        return None;
    }
    let path_env = env
        .get("PATH")
        .cloned()
        .unwrap_or_else(|| "/usr/local/bin:/usr/bin:/bin".to_string());
    for dir in path_env.split(':').filter(|d| !d.is_empty()) {
        let cand = resolve_posix_path(cwd, &format!("{dir}/{name}"));
        if fs.exists(&cand) && !fs.is_dir(&cand) {
            return Some(cand);
        }
    }
    if crate::commands::search::is_known_command(name) {
        return Some(format!("/usr/bin/{name}"));
    }
    None
}

fn builtin_hash(
    args: &[String],
    cwd: &str,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut hash_args: Vec<String> = args.to_vec();
    let mut reset = false;
    let mut list_mode = false;
    let mut delete_mode = false;
    let mut print_target = false;
    let mut custom_path: Option<String> = None;

    while let Some(first) = hash_args.first() {
        if !first.starts_with('-') || first == "-" {
            break;
        }
        let option = hash_args.remove(0);
        if option == "--" {
            break;
        }
        let chars: Vec<char> = option.chars().collect();
        let mut i = 1usize;
        while i < chars.len() {
            let flag = chars[i];
            match flag {
                'r' => reset = true,
                'l' => list_mode = true,
                'd' => delete_mode = true,
                't' => print_target = true,
                'p' => {
                    let inline: String = chars[i + 1..].iter().collect();
                    let p = if !inline.is_empty() {
                        Some(inline)
                    } else if !hash_args.is_empty() {
                        Some(hash_args.remove(0))
                    } else {
                        None
                    };
                    let Some(path) = p else {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: "hash: -p: option requires an argument\n".to_string(),
                            exit_code: 2,
                        };
                    };
                    custom_path = Some(path);
                    break;
                }
                _ => {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!(
                            "hash: -{flag}: invalid option\nhash: usage: hash [-lr] [-p pathname] [-dt] [name ...]\n"
                        ),
                        exit_code: 2,
                    };
                }
            }
            i += 1;
        }
    }

    if reset {
        let keys: Vec<String> = env
            .keys()
            .filter(|k| k.starts_with("__hash__"))
            .cloned()
            .collect();
        for k in keys {
            env.remove(&k);
        }
    }

    if print_target && hash_args.is_empty() {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "hash: -t: option requires arguments\n".to_string(),
            exit_code: 1,
        };
    }

    if hash_args.is_empty() {
        let mut stdout = String::new();
        if !reset {
            for (k, target) in env.iter() {
                if let Some(name) = k.strip_prefix("__hash__") {
                    if list_mode {
                        stdout.push_str(&format!("builtin hash -p {target} {name}\n"));
                    } else {
                        stdout.push_str(&format!("0\t{target}\n"));
                    }
                }
            }
        }
        return BuiltinOutcome {
            stdout,
            stderr: String::new(),
            exit_code: 0,
        };
    }

    let mut status = 0;
    let mut stdout = String::new();
    let mut stderr = String::new();
    for name in &hash_args {
        if delete_mode {
            if env.remove(&format!("__hash__{name}")).is_none() {
                stderr.push_str(&format!("hash: {name}: not found\n"));
                status = 1;
            }
            continue;
        }
        if let Some(ref cp) = custom_path {
            env.insert(format!("__hash__{name}"), cp.clone());
            continue;
        }
        if print_target {
            let existing = env
                .get(&format!("__hash__{name}"))
                .cloned()
                .or_else(|| resolve_hash_command(name, cwd, env, fs));
            if let Some(target) = existing {
                if hash_args.len() > 1 {
                    stdout.push_str(&format!("{name}\t{target}\n"));
                } else {
                    stdout.push_str(&format!("{target}\n"));
                }
            } else {
                stderr.push_str(&format!("hash: {name}: not found\n"));
                status = 1;
            }
            continue;
        }
        if let Some(resolved) = resolve_hash_command(name, cwd, env, fs) {
            env.insert(format!("__hash__{name}"), resolved);
        } else {
            stderr.push_str(&format!("hash: {name}: not found\n"));
            status = 1;
        }
    }

    BuiltinOutcome {
        stdout,
        stderr,
        exit_code: status,
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
                            let s = decode_echo_b_escapes(before_c);
                            out.push_str(&pad_string(&s, w_usize, left_align, false));
                            stop_all = true;
                            break;
                        }
                        let s = decode_echo_b_escapes(raw_arg);
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
        let base = resolved
            .split_once('[')
            .map(|(b, _)| b)
            .unwrap_or(&resolved);
        if env
            .get(&format!("__attr__{base}"))
            .is_some_and(|a| a.contains('r'))
        {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("printf: {base}: readonly variable\n"),
                exit_code: 1,
            };
        }
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
            "-f" => fs
                .stat(&path)
                .map(|s| s.kind == crate::vfs::VfsEntryKind::File && (s.mode & 0o170000) != 0o020000)
                .unwrap_or(false),
            "-d" => fs.is_dir(&path),
            "-c" => fs
                .stat(&path)
                .map(|s| (s.mode & 0o170000) == 0o020000)
                .unwrap_or(false),
            "-b" => fs
                .stat(&path)
                .map(|s| (s.mode & 0o170000) == 0o060000)
                .unwrap_or(false),
            "-p" => fs
                .stat(&path)
                .map(|s| (s.mode & 0o170000) == 0o010000)
                .unwrap_or(false),
            "-S" => fs
                .stat(&path)
                .map(|s| (s.mode & 0o170000) == 0o140000)
                .unwrap_or(false),
            "-u" => fs.stat(&path).map(|s| (s.mode & 0o4000) != 0).unwrap_or(false),
            "-g" => fs.stat(&path).map(|s| (s.mode & 0o2000) != 0).unwrap_or(false),
            "-k" => fs.stat(&path).map(|s| (s.mode & 0o1000) != 0).unwrap_or(false),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::MemoryVfs;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn unit_builtins_printf_test_pushd_popd_and_cd() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/a/b").unwrap();
        let mut env = BTreeMap::new();
        let mut cwd = "/a".to_string();
        let mut stdin = String::new();

        let pf = builtin_printf(&args(&["%s:%04d\\n", "item", "7"]), &mut env);
        assert_eq!(pf.exit_code, 0);
        assert_eq!(pf.stdout, "item:0007\n");

        let t_ok = builtin_test("[", &args(&["-d", "/a/b", "]"]), "/", &mut env, &vfs);
        assert_eq!(t_ok.exit_code, 0);

        let push = try_run_builtin(
            "pushd",
            &args(&["/a/b"]),
            &mut stdin,
            &mut cwd,
            &mut env,
            &vfs,
        )
        .unwrap();
        assert_eq!(push.exit_code, 0);
        assert_eq!(cwd, "/a/b");

        let pop = try_run_builtin("popd", &[], &mut stdin, &mut cwd, &mut env, &vfs).unwrap();
        assert_eq!(pop.exit_code, 0);
        assert_eq!(cwd, "/a");
    }

    #[test]
    fn unit_builtins_declare_readonly_unset_getopts_and_eval_test() {
        let vfs = MemoryVfs::new();
        let mut env = BTreeMap::new();
        let mut cwd = "/".to_string();
        let mut stdin = "alpha beta gamma\n".to_string();

        let ec = try_run_builtin(
            "echo",
            &args(&["-n", "-e", "alpha\tbeta"]),
            &mut stdin,
            &mut cwd,
            &mut env,
            &vfs,
        )
        .unwrap();
        assert_eq!(ec.exit_code, 0);
        assert_eq!(ec.stdout, "alpha\tbeta");

        let t_num = builtin_test("[", &args(&["42", "-gt", "10", "-a", "a", "=", "a", "]"]), "/", &mut env, &vfs);
        assert_eq!(t_num.exit_code, 0);
    }

    #[test]
    fn unit_builtins_printf_var_assign_regex_test_let_umask_and_dirs() {
        let vfs = MemoryVfs::new();
        let mut env = BTreeMap::new();
        let mut cwd = "/".to_string();
        let mut stdin = String::new();

        let pf = builtin_printf(&args(&["-v", "OUT_VAR", "%-6s:%03d", "tag", "9"]), &mut env);
        assert_eq!(pf.exit_code, 0);
        assert_eq!(env.get("OUT_VAR").map(String::as_str), Some("tag   :009"));

        let re_test = builtin_test(
            "[[",
            &args(&["v2.4.1", "=~", "^v([0-9]+)\\.([0-9]+)\\.([0-9]+)$", "]]"]),
            "/",
            &mut env,
            &vfs,
        );
        assert_eq!(re_test.exit_code, 0);
        assert_eq!(env.get("BASH_REMATCH[1]").map(String::as_str), Some("2"));
        assert_eq!(env.get("BASH_REMATCH[2]").map(String::as_str), Some("4"));

        let lt = try_run_builtin(
            "let",
            &args(&["A = 6 * 7", "B = A + 8"]),
            &mut stdin,
            &mut cwd,
            &mut env,
            &vfs,
        )
        .unwrap();
        assert_eq!(lt.exit_code, 0);
        assert_eq!(env.get("A").map(String::as_str), Some("42"));
        assert_eq!(env.get("B").map(String::as_str), Some("50"));

        let um = try_run_builtin("umask", &args(&["0027"]), &mut stdin, &mut cwd, &mut env, &vfs).unwrap();
        assert_eq!(um.exit_code, 0);
        let um_get = try_run_builtin("umask", &[], &mut stdin, &mut cwd, &mut env, &vfs).unwrap();
        assert_eq!(um_get.stdout, "0027\n");
    }

    #[test]
    fn unit_builtins_true_false_colon_and_pwd() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work/dir").unwrap();
        let mut env = BTreeMap::new();
        let mut cwd = "/work/dir".to_string();
        let mut stdin = String::new();
        assert_eq!(try_run_builtin("true", &[], &mut stdin, &mut cwd, &mut env, &vfs).unwrap().exit_code, 0);
        assert_eq!(try_run_builtin(":", &[], &mut stdin, &mut cwd, &mut env, &vfs).unwrap().exit_code, 0);
        assert_eq!(try_run_builtin("false", &[], &mut stdin, &mut cwd, &mut env, &vfs).unwrap().exit_code, 1);
        assert_eq!(try_run_builtin("pwd", &[], &mut stdin, &mut cwd, &mut env, &vfs).unwrap().stdout, "/work/dir\n");
    }

    #[test]
    fn unit_builtins_umask_symbolic_octal_diagnostics_and_cd_not_a_dir() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        vfs.write_file("/work/regular.txt", b"data").unwrap();
        let mut env = BTreeMap::new();
        let mut cwd = "/work".to_string();
        let mut stdin = String::new();

        let cd_file = try_run_builtin(
            "cd",
            &args(&["regular.txt"]),
            &mut stdin,
            &mut cwd,
            &mut env,
            &vfs,
        )
        .unwrap();
        assert_eq!(cd_file.exit_code, 1);
        assert_eq!(cd_file.stderr, "cd: regular.txt: Not a directory\n");

        let bad_opt = builtin_umask(&args(&["-z"]), &mut env);
        assert_eq!(bad_opt.exit_code, 2);
        assert_eq!(bad_opt.stderr, "umask: -z: invalid option\n");

        let bad_oct = builtin_umask(&args(&["0999"]), &mut env);
        assert_eq!(bad_oct.exit_code, 1);
        assert_eq!(bad_oct.stderr, "umask: 0999: octal number out of range\n");

        let bad_sym = builtin_umask(&args(&["u=z"]), &mut env);
        assert_eq!(bad_sym.exit_code, 1);
        assert_eq!(bad_sym.stderr, "umask: u=z: invalid mode\n");

        let set_sym = builtin_umask(&args(&["-S", "u=rwx,g=rx,o="]), &mut env);
        assert_eq!(set_sym.exit_code, 0);
        assert_eq!(set_sym.stdout, "u=rwx,g=rx,o=\n");

        let print_ps = builtin_umask(&args(&["-p", "-S"]), &mut env);
        assert_eq!(print_ps.exit_code, 0);
        assert_eq!(print_ps.stdout, "umask -S u=rwx,g=rx,o=\n");

        env.insert("RO_VAR".to_string(), "initial".to_string());
        env.insert("__attr__RO_VAR".to_string(), "r".to_string());
        let printf_ro = builtin_printf(&args(&["-v", "RO_VAR", "%s", "changed"]), &mut env);
        assert_eq!(printf_ro.exit_code, 1);
        assert_eq!(printf_ro.stderr, "printf: RO_VAR: readonly variable\n");
        assert_eq!(env.get("RO_VAR").map(String::as_str), Some("initial"));
    }

    #[test]
    fn unit_builtins_dirstack_tilde_cdpath_pwd_and_let_options() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/home/user/proj/sub").unwrap();
        vfs.mkdir_all("/opt/libs/target_dir").unwrap();
        let mut env = BTreeMap::new();
        env.insert("HOME".to_string(), "/home/user".to_string());
        env.insert("CDPATH".to_string(), "/opt/libs".to_string());
        let mut cwd = "/home/user".to_string();
        let mut stdin = String::new();

        let push = try_run_builtin(
            "pushd",
            &args(&["/home/user/proj/sub"]),
            &mut stdin,
            &mut cwd,
            &mut env,
            &vfs,
        )
        .unwrap();
        assert_eq!(push.exit_code, 0);
        assert_eq!(push.stdout, "~/proj/sub ~\n");

        let dirs_l = try_run_builtin(
            "dirs",
            &args(&["-l", "-v"]),
            &mut stdin,
            &mut cwd,
            &mut env,
            &vfs,
        )
        .unwrap();
        assert_eq!(dirs_l.exit_code, 0);
        assert_eq!(dirs_l.stdout, " 0  /home/user/proj/sub\n 1  /home/user\n");

        let cdpath_out = try_run_builtin(
            "cd",
            &args(&["target_dir"]),
            &mut stdin,
            &mut cwd,
            &mut env,
            &vfs,
        )
        .unwrap();
        assert_eq!(cdpath_out.exit_code, 0);
        assert_eq!(cdpath_out.stdout, "/opt/libs/target_dir\n");
        assert_eq!(cwd, "/opt/libs/target_dir");

        let pwd_err = try_run_builtin("pwd", &args(&["-z"]), &mut stdin, &mut cwd, &mut env, &vfs).unwrap();
        assert_eq!(pwd_err.exit_code, 2);
        assert_eq!(pwd_err.stderr, "pwd: invalid option\n");

        let let_help = try_run_builtin("let", &args(&["--help"]), &mut stdin, &mut cwd, &mut env, &vfs).unwrap();
        assert_eq!(let_help.exit_code, 2);
        assert_eq!(let_help.stderr, "let: --help: unsupported option\n");
    }
}
