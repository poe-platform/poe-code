use crate::commands::search::regex_captures;
use crate::shell::expand::{
    decode_ansi_c_escapes, decode_echo_b_escapes, eval_arith, glob_match_ext, resolve_nameref_base,
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
            let mut interpret_escapes = env.get("__shopt_xpg_echo").is_some_and(|v| v == "1");
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
        } else if matches!(
            name.as_str(),
            ":" | "true"
                | "false"
                | "cd"
                | "pwd"
                | "pushd"
                | "popd"
                | "dirs"
                | "echo"
                | "printf"
                | "test"
                | "["
                | "read"
                | "mapfile"
                | "readarray"
                | "getopts"
                | "set"
                | "shopt"
                | "shift"
                | "export"
                | "local"
                | "readonly"
                | "declare"
                | "typeset"
                | "unset"
                | "trap"
                | "eval"
                | "source"
                | "."
                | "exec"
                | "command"
                | "builtin"
                | "type"
                | "hash"
                | "umask"
                | "ulimit"
                | "let"
                | "exit"
                | "return"
                | "break"
                | "continue"
                | "wait"
                | "kill"
                | "jobs"
                | "disown"
                | "alias"
                | "unalias"
                | "caller"
                | "print"
                | "functions"
                | "setopt"
                | "unsetopt"
                | "bash"
                | "sh"
                | "zsh"
        ) {
            // Builtins and subshells are recognized by hash without error.
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

fn parse_printf_integer_checked(token: &str, unsigned: bool) -> (i128, Option<&'static str>) {
    if let Some(rest) = token.strip_prefix('\'').or_else(|| token.strip_prefix('"')) {
        return (rest.chars().next().map(|c| c as i128).unwrap_or(0), None);
    }
    let bytes = token.as_bytes();
    let mut offset = 0usize;
    while offset < bytes.len() && b" \t\n\r\x0b\x0c".contains(&bytes[offset]) {
        offset += 1;
    }
    let negative = bytes.get(offset) == Some(&b'-');
    if negative || bytes.get(offset) == Some(&b'+') {
        offset += 1;
    }
    let mut radix: u128 = 10;
    let hex_digit = |b: u8| -> Option<u128> {
        match b {
            b'0'..=b'9' => Some((b - b'0') as u128),
            b'a'..=b'f' => Some((b - b'a' + 10) as u128),
            b'A'..=b'F' => Some((b - b'A' + 10) as u128),
            _ => None,
        }
    };
    if bytes.get(offset) == Some(&b'0') {
        radix = 8;
        if matches!(bytes.get(offset + 1), Some(b'x' | b'X'))
            && bytes.get(offset + 2).and_then(|&b| hex_digit(b)).is_some()
        {
            radix = 16;
            offset += 2;
        }
    }
    let start = offset;
    let limit: u128 = if unsigned {
        u64::MAX as u128
    } else if negative {
        1u128 << 63
    } else {
        (1u128 << 63) - 1
    };
    let mut magnitude: u128 = 0;
    let mut overflow = false;
    while offset < bytes.len() {
        let Some(d) = hex_digit(bytes[offset]).filter(|&d| d < radix) else {
            break;
        };
        if !overflow {
            if let Some(cand) = magnitude.checked_mul(radix).and_then(|m| m.checked_add(d)) {
                if cand > limit {
                    overflow = true;
                    magnitude = limit;
                } else {
                    magnitude = cand;
                }
            } else {
                overflow = true;
                magnitude = limit;
            }
        }
        offset += 1;
    }
    let val: i128 = if unsigned {
        let u = if overflow {
            u64::MAX
        } else if negative {
            (magnitude as u64).wrapping_neg()
        } else {
            magnitude as u64
        };
        u as i128
    } else if negative {
        -(magnitude as i128)
    } else {
        magnitude as i128
    };
    let err = if overflow {
        Some("Numerical result out of range")
    } else if offset == start {
        Some("invalid number")
    } else if offset < bytes.len() {
        Some("value not completely converted")
    } else {
        None
    };
    (val, err)
}

fn printf_quote_value(s: &str, alternate: bool) -> String {
    if s.is_empty() {
        return "''".to_string();
    }
    let ansi = s
        .chars()
        .any(|c| (c as u32) < 0x20 || (c as u32) == 0x7f || c.is_control());
    if ansi {
        let mut out = String::from("$'");
        for c in s.chars() {
            match c {
                '\x07' => out.push_str("\\a"),
                '\x08' => out.push_str("\\b"),
                '\t' => out.push_str("\\t"),
                '\n' => out.push_str("\\n"),
                '\x0b' => out.push_str("\\v"),
                '\x0c' => out.push_str("\\f"),
                '\r' => out.push_str("\\r"),
                '\x1b' => out.push_str("\\E"),
                '\'' => out.push_str("\\'"),
                '\\' => out.push_str("\\\\"),
                _ if (c as u32) < 0x20 || (c as u32) == 0x7f || c.is_control() => {
                    let mut buf = [0u8; 4];
                    for &b in c.encode_utf8(&mut buf).as_bytes() {
                        out.push_str(&format!("\\{b:03o}"));
                    }
                }
                _ => out.push(c),
            }
        }
        out.push('\'');
        return out;
    }
    if alternate {
        return format!("'{}'", s.replace('\'', "'\\''"));
    }
    let mut out = String::new();
    let chars: Vec<char> = s.chars().collect();
    for (idx, &ch) in chars.iter().enumerate() {
        let safe = (ch as u32) >= 128
            || ch.is_ascii_alphanumeric()
            || "_./@%+=:-".contains(ch)
            || (ch == '#' && idx > 0)
            || (ch == '~' && idx > 0 && !matches!(chars[idx - 1], ':' | '='));
        if safe {
            out.push(ch);
        } else {
            out.push('\\');
            out.push(ch);
        }
    }
    out
}

pub fn builtin_printf(args: &[String], env: &mut BTreeMap<String, String>) -> BuiltinOutcome {
    let mut idx = 0usize;
    let mut assign_var: Option<String> = None;
    while let Some(arg) = args.get(idx) {
        if !arg.starts_with("-v") {
            break;
        }
        idx += 1;
        let target = if arg.len() > 2 {
            Some(arg[2..].to_string())
        } else {
            let t = args.get(idx).cloned();
            if t.is_some() {
                idx += 1;
            }
            t
        };
        let Some(target) = target else {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: "printf: -v: option requires an argument\n".to_string(),
                exit_code: 2,
            };
        };
        let (base, has_bracket) = match target.split_once('[') {
            Some((b, _)) => (b, true),
            None => (target.as_str(), false),
        };
        let valid_ident = !base.is_empty()
            && base
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            && base.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            && (!has_bracket || (target.ends_with(']') && !target.ends_with("[]")));
        if !valid_ident {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("printf: '{target}': not a valid identifier\n"),
                exit_code: 2,
            };
        }
        assign_var = Some(target);
    }
    let mut dash_dash = false;
    if args.get(idx).map(|s| s.as_str()) == Some("--") {
        dash_dash = true;
        idx += 1;
    }
    let Some(raw_fmt) = args.get(idx) else {
        if assign_var.is_some() {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: "printf: usage: printf [-v var] format [arguments]\n".to_string(),
                exit_code: 2,
            };
        }
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "printf: missing operand\n".to_string(),
            exit_code: 1,
        };
    };
    if !dash_dash && raw_fmt.starts_with('-') {
        if assign_var.is_some() {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: "printf: usage: printf [-v var] format [arguments]\n".to_string(),
                exit_code: 2,
            };
        }
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: format!("printf: invalid option '{raw_fmt}'\n"),
            exit_code: 1,
        };
    }
    let val_args = &args[idx + 1..];
    let mut out = String::new();
    let mut stderr = String::new();
    let mut exit_code = 0;
    let mut arg_i = 0usize;
    let mut stop_all = false;

    loop {
        let start_arg_i = arg_i;
        let mut offset = 0usize;
        while offset < raw_fmt.len() && !stop_all {
            if !raw_fmt[offset..].starts_with('%') {
                let next_pct = raw_fmt[offset..]
                    .find('%')
                    .map(|p| offset + p)
                    .unwrap_or(raw_fmt.len());
                let literal = &raw_fmt[offset..next_pct];
                out.push_str(&decode_ansi_c_escapes(literal));
                offset = next_pct;
                continue;
            }
            if raw_fmt[offset..].starts_with("%%") {
                out.push('%');
                offset += 2;
                continue;
            }
            let dir_start = offset;
            offset += 1;
            let mut flags = String::new();
            while let Some(fc) = raw_fmt[offset..].chars().next() {
                if "-+ #0'".contains(fc) {
                    if !flags.contains(fc) {
                        flags.push(fc);
                    }
                    offset += fc.len_utf8();
                } else {
                    break;
                }
            }
            let width: Option<isize> = if raw_fmt[offset..].starts_with('*') {
                offset += 1;
                let tok = val_args.get(arg_i).map(|s| s.as_str()).unwrap_or("0");
                arg_i += 1;
                let (v, err) = parse_printf_integer_checked(tok, false);
                if let Some(msg) = err {
                    stderr.push_str(&format!("printf: '{tok}': {msg}\n"));
                    exit_code = 1;
                }
                Some(v as isize)
            } else {
                let mut ws = String::new();
                while let Some(wc) = raw_fmt[offset..].chars().next() {
                    if wc.is_ascii_digit() {
                        ws.push(wc);
                        offset += 1;
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
            let precision: Option<usize> = if raw_fmt[offset..].starts_with('.') {
                offset += 1;
                if raw_fmt[offset..].starts_with('*') {
                    offset += 1;
                    let tok = val_args.get(arg_i).map(|s| s.as_str()).unwrap_or("0");
                    arg_i += 1;
                    let (v, err) = parse_printf_integer_checked(tok, false);
                    if let Some(msg) = err {
                        stderr.push_str(&format!("printf: '{tok}': {msg}\n"));
                        exit_code = 1;
                    }
                    if v < 0 {
                        None
                    } else {
                        Some(v as usize)
                    }
                } else {
                    let mut ps = String::new();
                    while let Some(pc) = raw_fmt[offset..].chars().next() {
                        if pc.is_ascii_digit() {
                            ps.push(pc);
                            offset += 1;
                        } else {
                            break;
                        }
                    }
                    Some(ps.parse::<usize>().unwrap_or(0))
                }
            } else {
                None
            };
            let mut time_format: Option<String> = None;
            if raw_fmt[offset..].starts_with('(') {
                offset += 1;
                let Some(close_rel) = raw_fmt[offset..].find(')') else {
                    return BuiltinOutcome {
                        stdout: out,
                        stderr: format!("{stderr}printf: invalid time format\n"),
                        exit_code: 1,
                    };
                };
                let tf = raw_fmt[offset..offset + close_rel].to_string();
                offset += close_rel + 1;
                if !raw_fmt[offset..].starts_with('T') {
                    return BuiltinOutcome {
                        stdout: out,
                        stderr: format!("{stderr}printf: invalid time format\n"),
                        exit_code: 1,
                    };
                }
                time_format = Some(tf);
            } else {
                while let Some(mc) = raw_fmt[offset..].chars().next() {
                    if "hlLjzt".contains(mc) {
                        offset += mc.len_utf8();
                    } else {
                        break;
                    }
                }
            }

            let Some(conv) = raw_fmt[offset..].chars().next() else {
                let preview = &raw_fmt[dir_start..];
                return BuiltinOutcome {
                    stdout: out,
                    stderr: format!("{stderr}printf: invalid format near '{preview}'\n"),
                    exit_code: 1,
                };
            };
            offset += conv.len_utf8();
            if !"sbqQcCSdiouxXfFeEgGaAT".contains(conv) {
                let preview = &raw_fmt[dir_start..];
                return BuiltinOutcome {
                    stdout: out,
                    stderr: format!("{stderr}printf: invalid format near '{preview}'\n"),
                    exit_code: 1,
                };
            }
            let supplied_idx = arg_i;
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
                's' | 'S' => {
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
                'q' | 'Q' => {
                    let src = if conv == 'Q'
                        && let Some(p) = precision
                    {
                        raw_arg.chars().take(p).collect::<String>()
                    } else {
                        raw_arg.to_string()
                    };
                    let mut quoted = printf_quote_value(&src, alt_form);
                    if conv == 'q'
                        && let Some(p) = precision
                    {
                        quoted = quoted.chars().take(p).collect::<String>();
                    }
                    pad_string(&quoted, w_usize, left_align, false)
                }
                'c' | 'C' => {
                    let ch_str = raw_arg
                        .chars()
                        .next()
                        .map(|ch| ch.to_string())
                        .unwrap_or_else(|| "\0".to_string());
                    pad_string(&ch_str, w_usize, left_align, false)
                }
                'T' => {
                    let operand = if supplied_idx < val_args.len() {
                        raw_arg
                    } else {
                        "-1"
                    };
                    let (parsed_val, err) = parse_printf_integer_checked(operand, false);
                    if let Some(msg) = err {
                        stderr.push_str(&format!("printf: '{raw_arg}': {msg}\n"));
                        exit_code = 1;
                    }
                    let secs = if parsed_val == -1 || parsed_val == -2 {
                        1_700_000_000i64
                    } else {
                        parsed_val as i64
                    };
                    let tf = time_format
                        .as_deref()
                        .filter(|s| !s.is_empty())
                        .unwrap_or("%X");
                    let mut rendered = crate::commands::coreutils::format_strftime_for_printf(
                        tf,
                        secs,
                        env.get("TZ").map(|s| s.as_str()),
                    )
                    .unwrap_or_default();
                    if let Some(p) = precision {
                        rendered = rendered.chars().take(p).collect::<String>();
                    }
                    pad_string(&rendered, w_usize, left_align, false)
                }
                'd' | 'i' => {
                    let (n_128, err) = if supplied_idx < val_args.len() {
                        parse_printf_integer_checked(raw_arg, false)
                    } else {
                        (0, None)
                    };
                    if let Some(msg) = err {
                        stderr.push_str(&format!("printf: '{raw_arg}': {msg}\n"));
                        exit_code = 1;
                    }
                    let n = n_128 as i64;
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
                    format_signed_num(
                        sign,
                        &digits,
                        w_usize,
                        left_align,
                        zero_pad && precision.is_none(),
                    )
                }
                'u' => {
                    let (n_128, err) = if supplied_idx < val_args.len() {
                        parse_printf_integer_checked(raw_arg, true)
                    } else {
                        (0, None)
                    };
                    if let Some(msg) = err {
                        stderr.push_str(&format!("printf: '{raw_arg}': {msg}\n"));
                        exit_code = 1;
                    }
                    let n = n_128 as u64;
                    let mut digits = if precision == Some(0) && n == 0 {
                        String::new()
                    } else {
                        n.to_string()
                    };
                    if let Some(p) = precision
                        && digits.len() < p
                    {
                        digits = format!("{}{digits}", "0".repeat(p - digits.len()));
                    }
                    format_signed_num(
                        "",
                        &digits,
                        w_usize,
                        left_align,
                        zero_pad && precision.is_none(),
                    )
                }
                'o' => {
                    let (n_128, err) = if supplied_idx < val_args.len() {
                        parse_printf_integer_checked(raw_arg, true)
                    } else {
                        (0, None)
                    };
                    if let Some(msg) = err {
                        stderr.push_str(&format!("printf: '{raw_arg}': {msg}\n"));
                        exit_code = 1;
                    }
                    let n = n_128 as u64;
                    let mut digits = if precision == Some(0) && n == 0 {
                        String::new()
                    } else {
                        format!("{n:o}")
                    };
                    if let Some(p) = precision
                        && digits.len() < p
                    {
                        digits = format!("{}{digits}", "0".repeat(p - digits.len()));
                    }
                    if alt_form && !digits.starts_with('0') {
                        digits = format!("0{digits}");
                    }
                    format_signed_num(
                        "",
                        &digits,
                        w_usize,
                        left_align,
                        zero_pad && precision.is_none(),
                    )
                }
                'x' | 'X' => {
                    let (n_128, err) = if supplied_idx < val_args.len() {
                        parse_printf_integer_checked(raw_arg, true)
                    } else {
                        (0, None)
                    };
                    if let Some(msg) = err {
                        stderr.push_str(&format!("printf: '{raw_arg}': {msg}\n"));
                        exit_code = 1;
                    }
                    let n = n_128 as u64;
                    let mut digits = if precision == Some(0) && n == 0 {
                        String::new()
                    } else if conv == 'X' {
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
                    format_signed_num(
                        prefix,
                        &digits,
                        w_usize,
                        left_align,
                        zero_pad && precision.is_none(),
                    )
                }
                'f' | 'F' | 'e' | 'E' | 'g' | 'G' => {
                    let f = if supplied_idx >= val_args.len() {
                        0.0
                    } else if let Some(rest) =
                        raw_arg.strip_prefix('\'').or_else(|| raw_arg.strip_prefix('"'))
                    {
                        rest.chars().next().map(|c| c as u32 as f64).unwrap_or(0.0)
                    } else {
                        match raw_arg.trim().parse::<f64>() {
                            Ok(v) if !raw_arg.is_empty() && v.is_finite() => v,
                            _ => {
                                stderr.push_str(&format!("printf: '{raw_arg}': invalid number\n"));
                                exit_code = 1;
                                0.0
                            }
                        }
                    };
                    if matches!(conv, 'f' | 'F') {
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
                    } else if matches!(conv, 'e' | 'E') {
                        let prec = precision.unwrap_or(6);
                        let s = format_scientific(f, prec, conv == 'E');
                        pad_string(&s, w_usize, left_align, zero_pad)
                    } else {
                        let prec = precision.unwrap_or(6).max(1);
                        let s = format_general_float(f, prec, conv == 'G');
                        pad_string(&s, w_usize, left_align, zero_pad)
                    }
                }
                _ => raw_arg.to_string(),
            };
            out.push_str(&formatted);
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
                stderr: format!("{stderr}printf: {base}: readonly variable\n"),
                exit_code: 1,
            };
        }
        if base != "FUNCNAME" {
            let truncated = out.split('\0').next().unwrap_or("").to_string();
            env.insert(resolved.clone(), truncated);
            if let Some((base, _)) = resolved.split_once('[') {
                sync_array_metadata(base, env);
            }
        }
        BuiltinOutcome {
            stdout: String::new(),
            stderr,
            exit_code,
        }
    } else {
        BuiltinOutcome {
            stdout: out,
            stderr,
            exit_code,
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
                stderr: "[: missing ']'\n".to_string(),
                exit_code: 2,
            };
        }
        args = &args[..args.len() - 1];
    } else if cmd == "[[" {
        if args.last().map(|s| s.as_str()) == Some("]]") {
            args = &args[..args.len() - 1];
        }
        let mut pos = 0usize;
        let ok = eval_test_or(args, &mut pos, cwd, env, fs, true);
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: if ok { 0 } else { 1 },
        };
    }

    match eval_posix_test(args, cwd, env, fs) {
        Ok(ok) => BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: if ok { 0 } else { 1 },
        },
        Err(msg) => BuiltinOutcome {
            stdout: String::new(),
            stderr: format!("{cmd}: {msg}\n"),
            exit_code: 2,
        },
    }
}

fn is_test_unary_op(op: &str) -> bool {
    matches!(
        op,
        "-n"
            | "-z"
            | "-e"
            | "-a"
            | "-f"
            | "-d"
            | "-c"
            | "-L"
            | "-h"
            | "-s"
            | "-r"
            | "-w"
            | "-x"
            | "-b"
            | "-p"
            | "-S"
            | "-u"
            | "-g"
            | "-k"
            | "-O"
            | "-G"
            | "-t"
            | "-v"
            | "-o"
            | "-R"
            | "-N"
    )
}

fn is_test_binary_op(op: &str) -> bool {
    matches!(
        op,
        "="
            | "=="
            | "!="
            | "<"
            | ">"
            | "-eq"
            | "-ne"
            | "-lt"
            | "-le"
            | "-gt"
            | "-ge"
            | "-nt"
            | "-ot"
            | "-ef"
    )
}

fn is_test_numeric_op(op: &str) -> bool {
    matches!(op, "-eq" | "-ne" | "-lt" | "-le" | "-gt" | "-ge")
}

fn parse_test_integer(text: &str) -> Result<i64, String> {
    let trimmed = text.trim_matches(|c| c == ' ' || c == '\t');
    let rest = trimmed
        .strip_prefix('+')
        .or_else(|| trimmed.strip_prefix('-'))
        .unwrap_or(trimmed);
    if rest.is_empty() || !rest.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("integer expression expected: '{text}'"));
    }
    trimmed
        .parse::<i64>()
        .map_err(|_| format!("integer expression expected: '{text}'"))
}

fn eval_test_var_present(val: &str, env: &BTreeMap<String, String>) -> bool {
    if let Some((base, sub_with_bracket)) = val.split_once('[')
        && let Some(sub) = sub_with_bracket.strip_suffix(']')
    {
        let resolved_base = resolve_nameref_base(base, env);
        if sub == "@" || sub == "*" {
            if env.contains_key(resolved_base) {
                return true;
            }
            let prefix = format!("{resolved_base}[");
            return env.keys().any(|k| {
                k.strip_prefix(&prefix)
                    .and_then(|s| s.strip_suffix(']'))
                    .is_some_and(|sub_k| !matches!(sub_k, "#" | "@" | "*"))
            });
        }
        let is_assoc = env.get(&format!("__assoc__{resolved_base}")).is_some_and(|v| v == "1");
        let key = if is_assoc {
            format!("{resolved_base}[{sub}]")
        } else {
            let idx = eval_arith(sub, &mut env.clone()).unwrap_or(0);
            if idx < 0 {
                let prefix = format!("{resolved_base}[");
                let max_idx = env
                    .keys()
                    .filter_map(|k| k.strip_prefix(&prefix)?.strip_suffix(']')?.parse::<i64>().ok())
                    .max()
                    .unwrap_or(-1);
                let eff = max_idx + 1 + idx;
                if eff < 0 {
                    return false;
                }
                format!("{resolved_base}[{eff}]")
            } else {
                format!("{resolved_base}[{idx}]")
            }
        };
        return env.contains_key(&key) || (key.ends_with("[0]") && env.contains_key(resolved_base));
    }
    let resolved = resolve_nameref_base(val, env);
    if env.contains_key(resolved) || env.contains_key(val) {
        return true;
    }
    let prefix = format!("{resolved}[");
    env.keys().any(|k| {
        k.strip_prefix(&prefix)
            .and_then(|s| s.strip_suffix(']'))
            .is_some_and(|sub_k| !matches!(sub_k, "#" | "@" | "*"))
    })
}

fn eval_test_unary_predicate(
    op: &str,
    val: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> bool {
    let path = resolve_posix_path(cwd, val);
    match op {
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
        "-t" => false,
        "-v" => eval_test_var_present(val, env),
        "-R" => {
            env.contains_key(&format!("__nameref__{val}"))
                || env
                    .get(&format!("__attr__{val}"))
                    .is_some_and(|a| a.contains('n'))
        }
        "-o" => {
            if val == "braceexpand" {
                env.get("__set_braceexpand").map(|v| v != "0").unwrap_or(true)
            } else {
                env.get(&format!("__set_{val}")).is_some_and(|v| v == "1")
            }
        }
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
        "-N" => fs.stat(&path).map(|s| s.mtime_ms > 0).unwrap_or(false),
        _ => fs.exists(&path),
    }
}

fn eval_posix_test(
    raw_args: &[String],
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> Result<bool, String> {
    let mut args: Vec<String> = raw_args.to_vec();
    let mut negate = false;
    if args.len() == 4 {
        if args[0] == "!" {
            negate = true;
            args.remove(0);
        } else if args[0] == "(" && args[3] == ")" {
            args.pop();
            args.remove(0);
        }
    }
    if args.len() == 3 && !is_test_binary_op(&args[1]) {
        if args[1] == "-a" || args[1] == "-o" {
            let val = if args[1] == "-a" {
                !args[0].is_empty() && !args[2].is_empty()
            } else {
                !args[0].is_empty() || !args[2].is_empty()
            };
            return Ok(val != negate);
        }
        if args[0] == "!" {
            negate = !negate;
            args.remove(0);
        } else if args[0] == "(" && args[2] == ")" {
            args.pop();
            args.remove(0);
        }
    }
    if args.len() == 2 && args[0] == "!" {
        negate = !negate;
        args.remove(0);
    }
    if args.len() < 2 {
        let val = args.first().is_some_and(|s| !s.is_empty());
        return Ok(val != negate);
    }

    enum TestExpr {
        Atom(bool),
        Not(Box<TestExpr>),
        Or(Vec<Vec<TestExpr>>),
    }
    struct TestFrame {
        groups: Vec<Vec<TestExpr>>,
        negate: bool,
        pending_not: bool,
    }

    let mut offset = 0usize;
    let parse_primary = |offset: &mut usize| -> Result<bool, String> {
        let Some(token) = args.get(*offset).cloned() else {
            return Err("argument expected".to_string());
        };
        *offset += 1;
        if args.len() > 3 && token == "(" && args.get(*offset + 1).map(|s| s.as_str()) == Some(")")
        {
            let val = args.get(*offset).is_some_and(|s| !s.is_empty());
            *offset += 2;
            return Ok(val);
        }
        if token == "("
            && args.get(*offset).map(|s| s.as_str()) == Some("!")
            && args.get(*offset + 2).map(|s| s.as_str()) == Some(")")
        {
            let val = !args.get(*offset + 1).is_some_and(|s| !s.is_empty());
            *offset += 3;
            return Ok(val);
        }
        let left_length = token == "-l"
            && args
                .get(*offset + 1)
                .is_some_and(|op| is_test_numeric_op(op));
        let left = if left_length {
            let l = args[*offset].clone();
            *offset += 1;
            l
        } else {
            token.clone()
        };
        if *offset + 1 < args.len()
            && let Some(operator) = args.get(*offset).cloned()
            && is_test_binary_op(&operator)
        {
            *offset += 1;
            let right_length = is_test_numeric_op(&operator)
                && args.get(*offset).map(|s| s.as_str()) == Some("-l");
            if right_length {
                *offset += 1;
            }
            let Some(right) = args.get(*offset).cloned() else {
                return Err("binary operator requires two operands".to_string());
            };
            *offset += 1;
            if is_test_numeric_op(&operator) {
                let l_num = if left_length {
                    left.len() as i64
                } else {
                    parse_test_integer(&left)?
                };
                let r_num = if right_length {
                    right.len() as i64
                } else {
                    parse_test_integer(&right)?
                };
                return Ok(match operator.as_str() {
                    "-eq" => l_num == r_num,
                    "-ne" => l_num != r_num,
                    "-lt" => l_num < r_num,
                    "-le" => l_num <= r_num,
                    "-gt" => l_num > r_num,
                    _ => l_num >= r_num,
                });
            }
            return Ok(match operator.as_str() {
                "=" | "==" => token == right,
                "!=" => token != right,
                "<" => token < right,
                ">" => token > right,
                "-nt" => {
                    let lp = resolve_posix_path(cwd, &token);
                    let rp = resolve_posix_path(cwd, &right);
                    match (fs.stat(&lp), fs.stat(&rp)) {
                        (Ok(ls), Ok(rs)) => ls.mtime_ms > rs.mtime_ms,
                        (Ok(_), Err(_)) => true,
                        _ => false,
                    }
                }
                "-ot" => {
                    let lp = resolve_posix_path(cwd, &token);
                    let rp = resolve_posix_path(cwd, &right);
                    match (fs.stat(&lp), fs.stat(&rp)) {
                        (Ok(ls), Ok(rs)) => ls.mtime_ms < rs.mtime_ms,
                        (Err(_), Ok(_)) => true,
                        _ => false,
                    }
                }
                "-ef" => {
                    let lp = resolve_posix_path(cwd, &token);
                    let rp = resolve_posix_path(cwd, &right);
                    fs.stat(&lp).is_ok()
                        && fs.stat(&rp).is_ok()
                        && resolve_physical_path(cwd, &token, fs)
                            == resolve_physical_path(cwd, &right, fs)
                }
                _ => false,
            });
        }
        if is_test_unary_op(&token) {
            let Some(operand) = args.get(*offset).cloned() else {
                return Err("unary operator requires an operand".to_string());
            };
            *offset += 1;
            return Ok(eval_test_unary_predicate(&token, &operand, cwd, env, fs));
        }
        Ok(!token.is_empty())
    };

    let mut frames = vec![TestFrame {
        groups: vec![Vec::new()],
        negate: false,
        pending_not: false,
    }];
    let mut expecting = true;
    loop {
        let tok = args.get(offset).map(|s| s.as_str());
        if expecting {
            let short_group = tok == Some("(")
                && ((args.len() > 3 && args.get(offset + 2).map(|s| s.as_str()) == Some(")"))
                    || (args.get(offset + 1).map(|s| s.as_str()) == Some("!")
                        && args.get(offset + 3).map(|s| s.as_str()) == Some(")")));
            if !short_group
                && matches!(tok, Some("!" | "("))
                && !(args.len() == 3 && offset == 0 && is_test_binary_op(&args[1]))
            {
                offset += 1;
                let frame = frames.last_mut().unwrap();
                if tok == Some("!") {
                    frame.pending_not = !frame.pending_not;
                } else {
                    let neg = frame.pending_not;
                    frame.pending_not = false;
                    frames.push(TestFrame {
                        groups: vec![Vec::new()],
                        negate: neg,
                        pending_not: false,
                    });
                }
                continue;
            }
            let atom_val = parse_primary(&mut offset)?;
            let frame = frames.last_mut().unwrap();
            let mut expr = TestExpr::Atom(atom_val);
            if frame.pending_not {
                expr = TestExpr::Not(Box::new(expr));
            }
            frame.pending_not = false;
            frame.groups.last_mut().unwrap().push(expr);
            expecting = false;
        } else if matches!(tok, Some("-a" | "-o")) {
            offset += 1;
            if tok == Some("-o") {
                frames.last_mut().unwrap().groups.push(Vec::new());
            }
            expecting = true;
        } else if frames.len() > 1 {
            if args.get(offset).map(|s| s.as_str()) != Some(")") {
                return Err("missing ')'".to_string());
            }
            offset += 1;
            let frame = frames.pop().unwrap();
            let mut expr = TestExpr::Or(frame.groups);
            if frame.negate {
                expr = TestExpr::Not(Box::new(expr));
            }
            frames
                .last_mut()
                .unwrap()
                .groups
                .last_mut()
                .unwrap()
                .push(expr);
        } else {
            break;
        }
    }
    if offset != args.len() {
        return Err(format!("unexpected argument '{}'", args[offset]));
    }

    fn eval_expr(expr: &TestExpr) -> bool {
        match expr {
            TestExpr::Atom(v) => *v,
            TestExpr::Not(inner) => !eval_expr(inner),
            TestExpr::Or(groups) => groups
                .iter()
                .any(|and_group| and_group.iter().all(eval_expr)),
        }
    }
    let root = TestExpr::Or(frames.pop().unwrap().groups);
    Ok(eval_expr(&root) != negate)
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
                let lp = resolve_posix_path(cwd, left);
                let rp = resolve_posix_path(cwd, right);
                fs.stat(&lp).is_ok()
                    && fs.stat(&rp).is_ok()
                    && resolve_physical_path(cwd, left, fs) == resolve_physical_path(cwd, right, fs)
            }
            _ => false,
        };
    }

    // Unary expression: -op arg
    if *pos + 1 < args.len()
        && is_test_unary_op(args[*pos].as_str())
    {
        let op = args[*pos].as_str();
        let val = &args[*pos + 1];
        *pos += 2;
        return eval_test_unary_predicate(op, val, cwd, env, fs);
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

    #[test]
    fn unit_builtins_printf_test_echo_xpg_and_hash_parity() {
        let vfs = MemoryVfs::new();
        let mut env = BTreeMap::new();
        let mut cwd = "/".to_string();
        let mut stdin = String::new();

        env.insert("__shopt_xpg_echo".to_string(), "1".to_string());
        let echo_xpg =
            try_run_builtin("echo", &args(&["a\\tb\\c", "ignored"]), &mut stdin, &mut cwd, &mut env, &vfs)
                .unwrap();
        assert_eq!(echo_xpg.exit_code, 0);
        assert_eq!(echo_xpg.stdout, "a\tb");

        let echo_no_esc =
            try_run_builtin("echo", &args(&["-E", "a\\tb"]), &mut stdin, &mut cwd, &mut env, &vfs)
                .unwrap();
        assert_eq!(echo_no_esc.stdout, "a\\tb\n");

        let pf_v = builtin_printf(&args(&["-vout_var", "%#q|%Q|%(%Y-%m-%d)T", "a b", "x\ny", "0"]), &mut env);
        assert_eq!(pf_v.exit_code, 0);
        assert_eq!(
            env.get("out_var").map(String::as_str),
            Some("'a b'|$'x\\ny'|1970-01-01")
        );

        let pf_bad_num = builtin_printf(&args(&["%d", "12abc"]), &mut env);
        assert_eq!(pf_bad_num.exit_code, 1);
        assert_eq!(pf_bad_num.stdout, "12");
        assert_eq!(
            pf_bad_num.stderr,
            "printf: '12abc': value not completely converted\n"
        );

        let test_len =
            try_run_builtin("test", &args(&["-l", "hello", "-eq", "5"]), &mut stdin, &mut cwd, &mut env, &vfs)
                .unwrap();
        assert_eq!(test_len.exit_code, 0);

        let test_bad_int =
            try_run_builtin("[", &args(&["1+2", "-eq", "3", "]"]), &mut stdin, &mut cwd, &mut env, &vfs)
                .unwrap();
        assert_eq!(test_bad_int.exit_code, 2);
        assert_eq!(
            test_bad_int.stderr,
            "[: integer expression expected: '1+2'\n"
        );
    }
}
