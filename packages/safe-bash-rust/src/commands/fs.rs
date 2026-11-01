use crate::shell::builtins::BuiltinOutcome;
use crate::vfs::{
    EntryIdentity, FileStat, SafeBashFs, VfsEntryKind, basename_posix_path, normalize_posix_path, resolve_posix_path,
};
use std::collections::{BTreeMap, VecDeque};

pub fn try_run_fs_command(
    cmd: &str,
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &std::collections::BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> Option<BuiltinOutcome> {
    if let Some(info) =
        crate::commands::coreutils::gnu_information_sync(cmd, args, env.contains_key("POSIXLY_CORRECT"))
    {
        return Some(info);
    }
    match cmd {
        "ls" => Some(cmd_ls(args, cwd, fs)),
        "mkdir" => Some(cmd_mkdir(args, cwd, env, fs)),
        "rmdir" => Some(cmd_rmdir(args, cwd, fs)),
        "rm" => Some(cmd_rm(args, stdin, cwd, fs)),
        "cp" => Some(cmd_cp(args, stdin, cwd, env, fs)),
        "mv" => Some(cmd_mv(args, stdin, cwd, env, fs)),
        "touch" => Some(cmd_touch(args, cwd, env, fs)),
        "ln" => Some(cmd_ln(args, stdin, cwd, env, fs)),
        "readlink" => Some(cmd_readlink(args, cwd, fs)),
        "realpath" => Some(cmd_realpath(args, cwd, fs)),
        "chmod" => Some(cmd_chmod(args, cwd, env, fs)),
        "stat" => Some(cmd_stat(args, cwd, env, fs)),
        "du" => Some(cmd_du(args, cwd, env, fs)),
        "df" => Some(cmd_df(args, cwd, env, fs)),
        "mktemp" => Some(cmd_mktemp(args, cwd, env, fs)),
        "tree" => Some(cmd_tree(args, cwd, env, fs)),
        "file" => Some(cmd_file(args, stdin, cwd, fs)),
        _ => None,
    }
}

fn ok_out(s: &str) -> BuiltinOutcome {
    BuiltinOutcome {
        stdout: s.to_string(),
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

fn natural_version_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    let mut ia = 0usize;
    let mut ib = 0usize;
    while ia < ab.len() && ib < bb.len() {
        if ab[ia].is_ascii_digit() && bb[ib].is_ascii_digit() {
            let sa = ia;
            while ia < ab.len() && ab[ia].is_ascii_digit() {
                ia += 1;
            }
            let sb = ib;
            while ib < bb.len() && bb[ib].is_ascii_digit() {
                ib += 1;
            }
            let na = a[sa..ia].parse::<u64>().unwrap_or(0);
            let nb = b[sb..ib].parse::<u64>().unwrap_or(0);
            let ord = na.cmp(&nb);
            if ord != std::cmp::Ordering::Equal {
                return ord;
            }
        } else {
            let ord = ab[ia].cmp(&bb[ib]);
            if ord != std::cmp::Ordering::Equal {
                return ord;
            }
            ia += 1;
            ib += 1;
        }
    }
    ab.len().cmp(&bb.len())
}

fn file_ext_key(name: &str) -> &str {
    let base = basename_posix_path(name);
    match base.rfind('.') {
        Some(idx) if idx > 0 => {
            let (_, after) = name.rsplit_once('.').unwrap_or(("", ""));
            after
        }
        _ => "",
    }
}

pub(super) fn absolute_operand(cwd: &str, operand: &str) -> String {
    if operand.is_empty() || operand.starts_with('/') { operand.to_owned() } else { child_disp_path(cwd, operand) }
}

fn child_disp_path(parent: &str, name: &str) -> String {
    if parent == "/" {
        format!("/{name}")
    } else {
        format!("{}/{name}", parent.trim_end_matches('/'))
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum BackupMode {
    None,
    Simple,
    Existing,
    Numbered,
}

fn parse_backup_control(control: Option<&str>) -> Result<BackupMode, String> {
    let Some(s) = control else { return Ok(BackupMode::None) };
    let mut matched = None;
    for (aliases, mode) in [(["none", "off"], BackupMode::None), (["simple", "never"], BackupMode::Simple),
        (["existing", "nil"], BackupMode::Existing), (["numbered", "t"], BackupMode::Numbered)] {
        if aliases.contains(&s) { return Ok(mode); }
        if aliases.iter().any(|a| a.starts_with(s)) && matched.replace(mode).is_some() {
            return Err(format!("ambiguous argument '{s}' for 'backup type'"));
        }
    }
    matched.ok_or_else(|| format!("invalid argument '{s}' for 'backup type'"))
}

fn backup_path(target: &str, mode: BackupMode, suffix: &str, fs: &dyn SafeBashFs) -> Result<String, String> {
    let mut largest = String::new();
    if mode != BackupMode::Simple {
        let parent = crate::vfs::dirname_posix_path(target);
        let prefix = format!("{}.~", basename_posix_path(target));
        for entry in fs.list_dir(&parent).map_err(|e| copy_error(&e, "readdir", &parent))? {
            if let Some(n) = entry.strip_prefix(&prefix).and_then(|rest| rest.strip_suffix('~'))
                && !n.is_empty() && !n.starts_with('0') && n.bytes().all(|c| c.is_ascii_digit())
                && (n.len(), n) > (largest.len(), largest.as_str()) {
                largest = n.to_owned();
            }
        }
    }
    if mode == BackupMode::Numbered || !largest.is_empty() {
        let mut number = largest.into_bytes();
        match number.iter().rposition(|&b| b != b'9') {
            Some(i) => { number[i] += 1; number[i + 1..].fill(b'0'); }
            None => { number.fill(b'0'); number.insert(0, b'1'); }
        }
        Ok(format!("{target}.~{}~", String::from_utf8(number).unwrap()))
    } else {
        let suffix = if suffix.is_empty() || suffix.contains('/') { "~" } else { suffix };
        Ok(format!("{target}{suffix}"))
    }
}

fn cmd_ls(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut show_all = false;
    let mut show_dots = false;
    let mut ignore_backups = false;
    let mut dir_only = false;
    let mut recursive = false;
    let mut sort_mode = "name";
    let mut reverse = false;
    let mut long = false;
    let mut inode = false;
    let mut follow = false;
    let mut human = false;
    let mut time_key = "mtime";
    let mut indicator = "none";
    let mut quote_name = false;
    let mut ended = false;
    let mut targets = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if ended {
            targets.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if a == "--time" || a.starts_with("--time=") {
            let sel = if let Some(value) = a.strip_prefix("--time=") { value } else {
                i += 1;
                let Some(value) = args.get(i) else { return err_out("ls: option '--time' requires an argument\n", 2) };
                value
            };
            let mut matches = ["mtime","modification","atime","access","use","ctime","status"].into_iter().filter(|s| s.starts_with(sel));
            time_key = match (matches.next(), matches.next()) {
                (Some("mtime" | "modification"), None) => "mtime",
                (Some("atime" | "access" | "use"), None) => "atime",
                (Some("ctime" | "status"), None) => "ctime",
                _ => return err_out(&format!("ls: invalid argument '{sel}' for '--time'\n"), 2),
            };
            i += 1;
            continue;
        }
        if a == "--sort" || a.starts_with("--sort=") {
            let sel = if a == "--sort" {
                if i + 1 >= args.len() {
                    return err_out("ls: --sort requires 'time' or 'size'\n", 2);
                }
                i += 1;
                args[i].as_str()
            } else {
                &a["--sort=".len()..]
            };
            sort_mode = match sel {
                "time" => "time",
                "size" => "size",
                "version" => "version",
                "extension" => "ext",
                "none" => "none",
                "name" => "name",
                _ => return err_out("ls: --sort requires 'time' or 'size'\n", 2),
            };
            i += 1;
            continue;
        }
        if a == "--indicator-style" || a.starts_with("--indicator-style=") {
            let sel = if a == "--indicator-style" {
                if i + 1 >= args.len() {
                    return err_out("ls: option '--indicator-style' requires an argument\n", 2);
                }
                i += 1;
                args[i].as_str()
            } else {
                &a["--indicator-style=".len()..]
            };
            let styles = ["none", "slash", "file-type", "classify"];
            let matches: Vec<&str> = styles
                .iter()
                .copied()
                .filter(|s| s.starts_with(sel))
                .collect();
            if matches.len() != 1 {
                return err_out(
                    &format!("ls: {} argument '{sel}' for '--indicator-style'\nValid arguments are:\n  - 'none'\n  - 'slash'\n  - 'file-type'\n  - 'classify'\nTry 'ls --help' for more information.\n", if matches.is_empty() { "invalid" } else { "ambiguous" }),
                    1,
                );
            }
            indicator = matches[0];
            i += 1;
            continue;
        }
        if a == "--all" {
            show_all = true;
            show_dots = true;
        } else if a == "--almost-all" {
            show_all = true;
            show_dots = false;
        } else if a == "--ignore-backups" {
            ignore_backups = true;
        } else if a == "--directory" {
            dir_only = true;
        } else if a == "--recursive" {
            recursive = true;
        } else if a == "--reverse" {
            reverse = true;
        } else if a == "--quote-name" {
            quote_name = true;
        } else if a == "--classify" {
            indicator = "classify";
        } else if a == "--file-type" {
            indicator = "file-type";
        } else if a == "--inode" {
            inode = true;
        } else if a == "--dereference" {
            follow = true;
        } else if a == "--human-readable" {
            human = true;
        } else if a.starts_with('-') && !a.starts_with("--") && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    'a' => {
                        show_all = true;
                        show_dots = true;
                    }
                    'A' => {
                        show_all = true;
                        show_dots = false;
                    }
                    'f' => {
                        show_all = true;
                        show_dots = true;
                        sort_mode = "none";
                    }
                    'B' => ignore_backups = true,
                    'd' => dir_only = true,
                    'R' => recursive = true,
                    't' => sort_mode = "time",
                    'S' => sort_mode = "size",
                    'v' => sort_mode = "version",
                    'X' => sort_mode = "ext",
                    'U' => sort_mode = "none",
                    'r' => reverse = true,
                    'F' => indicator = "classify",
                    'p' => indicator = "slash",
                    'Q' => quote_name = true,
                    'l' => long = true,
                    'i' => inode = true,
                    '1' => {}
                    'h' => human = true,
                    'L' => follow = true,
                    'u' => time_key = "atime",
                    'c' => time_key = "ctime",
                    other => return err_out(&format!("ls: invalid option -- '{other}'\n"), 2),
                }
            }
        } else if a.starts_with("--") {
            return err_out(&format!("ls: unrecognized option '{a}'\n"), 2);
        } else if !a.starts_with("--") {
            targets.push(a.clone());
        }
        i += 1;
    }
    if targets.is_empty() {
        targets.push(".".to_string());
    }

    if sort_mode == "name" && time_key != "mtime" && !long { sort_mode = "time"; }
    struct Entry {
        name: String,
        path: String,
        mode: u32,
        stat: Option<FileStat>,
        time: f64,
    }
    let fmt_name = |name: &str| -> String {
        let mut text = String::with_capacity(name.len() + 2);
        if quote_name { text.push('"'); }
        for b in name.bytes() {
            match b {
                b'"' if quote_name => text.push_str("\\\""),
                7 if quote_name => text.push_str("\\a"),
                8 => text.push_str("\\b"), 9 => text.push_str("\\t"),
                10 => text.push_str("\\n"), 11 => text.push_str("\\v"),
                12 => text.push_str("\\f"), 13 => text.push_str("\\r"),
                b'\\' => text.push_str("\\\\"),
                32..=126 => text.push(char::from(b)),
                _ => text.push_str(&format!("\\{b:03o}")),
            }
        }
        if quote_name { text.push('"'); }
        text
    };
    let missing_target = |e: &str| e.starts_with("ENOENT:") || e.starts_with("ENOTDIR:") || e.starts_with("ELOOP:") || e.ends_with("(os error 2)");
    let inspect = |path: String, name: String, operand: bool| -> Result<Entry, String> {
        let checked = |follow| fs.inspect_command_entry(&path, follow, "capabilitiesFor").map_err(|e| {
            if e.contains(", capabilitiesFor '") || e.starts_with("EACCES:") && e.contains(", lstat '") { return e; }
            let reason = if e.ends_with("(os error 2)") { "ENOENT: no such file or directory" }
                else { e.split_once(", ").map_or(e.as_str(), |(reason, _)| reason) };
            format!("{reason}, {} '{path}'", if follow { "stat" } else { "lstat" })
        });
        let (_, mut st) = checked(follow)?;
        if operand && st.kind == VfsEntryKind::Symlink && !dir_only && !long && indicator != "classify" {
            match checked(true) {
                Ok((_, target)) if target.kind == VfsEntryKind::Directory => st = target,
                Err(e) if !missing_target(&e) => return Err(e),
                _ => {}
            }
        }
        let time = match time_key { "atime" => st.atime_ms, "ctime" => st.ctime_ms.ok_or("ENOTSUP: filesystem does not expose ctime")?, _ => st.mtime_ms };
        Ok(Entry { name, path, mode: st.mode, stat: Some(st), time })
    };
    let order = |entries: &mut [Entry], lexical: bool| {
        if sort_mode == "none" { return; }
        if sort_mode != "name" || !lexical { entries.sort_by(|a,b| {
            (match sort_mode {
                "time" => b.time.partial_cmp(&a.time).unwrap_or(std::cmp::Ordering::Equal),
                "size" => b.stat.as_ref().unwrap().size.cmp(&a.stat.as_ref().unwrap().size),
                "version" => natural_version_cmp(&a.name, &b.name),
                "ext" => file_ext_key(&a.name).encode_utf16().cmp(file_ext_key(&b.name).encode_utf16()),
                _ => std::cmp::Ordering::Equal,
            }).then_with(|| a.name.encode_utf16().cmp(b.name.encode_utf16()))
        }); }
        if reverse { entries.reverse(); }
    };
    let suffix = |mode: u32| match mode & 0o170000 {
        0o040000 if indicator != "none" => "/",
        0o120000 if matches!(indicator, "classify" | "file-type") => "@",
        0o100000 if indicator == "classify" && mode & 0o111 != 0 => "*",
        _ => "",
    };
    let render = |entry: &Entry, out: &mut String| -> Result<(), String> {
        use std::fmt::Write;
        let mut row = String::new();
        if inode {
            match entry.stat.as_ref().and_then(|s| s.identity.as_ref()) {
                Some(EntryIdentity::Memory(_, ino) | EntryIdentity::Unix(_, ino) | EntryIdentity::OverlayDirectory { ino, .. }) => write!(row, "{ino} ").unwrap(),
                None => row.push_str("? "),
            }
        }
        if long {
            let st = entry.stat.as_ref().unwrap();
            let kind = match entry.mode & 0o170000 { 0o040000 => 'd', 0o120000 => 'l', 0o020000 => 'c', _ => '-' };
            let size = if kind == 'c' { "?, ?".into() } else if human && st.size >= 1024 {
                let bytes = st.size as u128;
                let mut scale = 1024;
                let mut units = "KMGTPEZY".chars();
                let mut unit = units.next().unwrap();
                while bytes > 1023 * scale { unit = units.next().unwrap(); scale *= 1024; }
                let tenths = (bytes * 10).div_ceil(scale);
                if tenths < 100 { format!("{}.{}{unit}", tenths / 10, tenths % 10) } else { format!("{}{unit}", bytes.div_ceil(scale)) }
            } else { st.size.to_string() };
            let date = format_iso_stat_timestamp(entry.time.trunc()).ok_or("internal error")?;
            write!(row, "{kind}{} {} {} {} {size} {} ", format_perm_9(st.mode), st.nlink.unwrap_or(1), st.uid.unwrap_or(0), st.gid.unwrap_or(0), &date[..16]).unwrap();
        }
        row.push_str(&fmt_name(&entry.name));
        if long && entry.mode & 0o170000 == 0o120000 {
            let target = fs.readlink(&entry.path)?;
            row.push_str(" -> ");
            row.push_str(&fmt_name(&target));
            if matches!(indicator, "classify" | "file-type") {
                match fs.inspect_command_entry(&entry.path, true, "stat") {
                    Ok((_, st)) => row.push_str(suffix(st.mode)),
                    Err(e) if missing_target(&e) => {}
                    Err(e) => return Err(e),
                }
            }
        } else { row.push_str(suffix(entry.mode)); }
        out.push_str(&row);
        out.push('\n');
        Ok(())
    };
    let mut files = Vec::new();
    let mut dirs = Vec::new();
    let mut stderr = String::new();
    let mut out = String::new();
    let mut code = 0;
    let mut error = |e: String| { stderr.push_str(&format!("ls: {e}\n")); code = 1; };
    let header = targets.len() > 1 || recursive;
    for name in targets {
        match inspect(absolute_operand(cwd, &name), name, true) {
            Ok(e) if !dir_only && e.mode & 0o170000 == 0o040000 => dirs.push(e),
            Ok(e) => files.push(e),
            Err(e) => error(e),
        }
    }
    order(&mut files, false);
    order(&mut dirs, false);
    for e in files { if let Err(e) = render(&e, &mut out) { error(e); } }
    let needs_stat = long || inode || matches!(sort_mode, "size" | "time");
    for root in dirs {
        let mut pending = vec![(root, 0)];
        let mut ancestors = Vec::new();
        let result = (|| -> Result<(), String> {
            while let Some((dir, depth)) = pending.pop() {
                let physical = fs.access_path(&dir.path, true)?;
                ancestors.truncate(depth);
                if ancestors.contains(&physical) { return Err(format!("ELOOP: too many symbolic links encountered '{}'", dir.path)); }
                if header {
                    if !out.is_empty() { out.push('\n'); }
                    out.push_str(&fmt_name(&dir.name));
                    out.push_str(":\n");
                }
                let mut entries = fs.directory_entries(&physical, usize::MAX).map_err(|e| if e.starts_with("EACCES:") {
                    format!("EACCES: permission denied, readdir '{}'", dir.path)
                } else { e })?;
                entries.sort_unstable_by(|(a,_), (b,_)| a.encode_utf16().cmp(b.encode_utf16()));
                entries.retain(|(n,_)| (show_all || !n.starts_with('.')) && !(ignore_backups && n.ends_with('~')));
                if show_dots {
                    for dot in [".", ".."] {
                        let pos = entries.iter().position(|(n,_)| n.as_str() > dot).unwrap_or(entries.len());
                        entries.insert(pos, (dot.into(), 0o040000));
                    }
                }
                let mut children = Vec::with_capacity(entries.len());
                let base = normalize_posix_path(&dir.path);
                for (name, mode) in entries {
                    let path = match name.as_str() {
                        "." => base.clone(),
                        ".." => crate::vfs::dirname_posix_path(&base),
                        _ => child_disp_path(&base, &name),
                    };
                    children.push(if needs_stat || follow && mode == 0o120000 || indicator == "classify" && mode == 0o100000 {
                        inspect(path, name, false)?
                    } else { Entry { name, path, mode, stat: None, time: 0.0 } });
                }
                order(&mut children, true);
                for child in &children { render(child, &mut out)?; }
                if recursive {
                    ancestors.push(physical);
                    for mut child in children.into_iter().rev() {
                        if child.mode & 0o170000 == 0o040000 && child.name != "." && child.name != ".." {
                            child.name = child_disp_path(&dir.name, &child.name);
                            pending.push((child, depth + 1));
                        }
                    }
                }
            }
            Ok(())
        })();
        if let Err(e) = result { error(e); }
    }
    BuiltinOutcome {
        stdout: out,
        stderr,
        exit_code: code,
    }
}

fn cmd_mkdir(
    args: &[String],
    cwd: &str,
    env: &std::collections::BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut code = 0;
    let mut recursive = false;
    let mut verbose = false;
    let mut mode_spec: Option<String> = None;
    let mut operands: Vec<String> = Vec::new();
    let mut ended = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if ended {
            operands.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if a == "--parents" {
            recursive = true;
            i += 1;
        } else if a == "--verbose" {
            verbose = true;
            i += 1;
        } else if let Some(m) = a.strip_prefix("--mode=") {
            mode_spec = Some(m.to_string());
            i += 1;
        } else if (a == "-m" || a == "--mode") && i + 1 < args.len() {
            mode_spec = Some(args[i + 1].clone());
            i += 2;
        } else if a.starts_with('-') && !a.starts_with("--") && a.len() > 1 {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut j = 0usize;
            while j < chars.len() {
                match chars[j] {
                    'p' => recursive = true,
                    'v' => verbose = true,
                    'm' => {
                        let rest: String = chars[j + 1..].iter().collect();
                        if !rest.is_empty() {
                            mode_spec = Some(rest);
                        } else if i + 1 < args.len() {
                            i += 1;
                            mode_spec = Some(args[i].clone());
                        } else {
                            return err_out("mkdir: option requires an argument -- 'm'\n", 2);
                        }
                        break;
                    }
                    ch => return err_out(&format!("mkdir: invalid option -- '{ch}'\n"), 2),
                }
                j += 1;
            }
            i += 1;
        } else if a.starts_with("--") {
            return err_out(&format!("mkdir: unrecognized option '{a}'\n"), 2);
        } else {
            operands.push(a.clone());
            i += 1;
        }
    }
    if operands.is_empty() {
        return err_out("mkdir: missing operand\n", 2);
    }
    let umask_val = env
        .get("\0umask")
        .and_then(|s| u32::from_str_radix(s, 8).ok())
        .unwrap_or(0o022);
    let default_mode = (0o777 & !umask_val) & 0o777;
    let explicit_mode = match mode_spec {
        Some(ref spec) => match eval_chmod_mode_checked(spec, default_mode, true, umask_val) {
            Ok(m) => Some(m),
            Err(msg) => return err_out(&format!("mkdir: {msg}\n"), 2),
        },
        None => None,
    };

    for a in &operands {
        let p = resolve_posix_path(cwd, a);
        let exists = fs.exists(&p) || fs.lstat(&p).is_ok();
        if exists {
            if recursive && fs.is_dir(&p) {
                continue;
            }
            stderr.push_str(&format!("mkdir: EEXIST: file already exists, mkdir '{p}'\n"));
            code = 1;
            continue;
        }
        let mut new_parents = Vec::new();
        if !recursive {
            let parent = crate::vfs::dirname_posix_path(&p);
            if !fs.exists(&parent) || !fs.is_dir(&parent) {
                if !fs.exists(&parent) && fs.lstat(&parent).is_err() {
                    stderr.push_str(&format!(
                        "mkdir: ENOENT: no such file or directory, mkdir '{p}'\n"
                    ));
                } else {
                    stderr.push_str(&format!(
                        "mkdir: ENOTDIR: not a directory, mkdir '{p}'\n"
                    ));
                }
                code = 1;
                continue;
            }
        } else {
            // Check that no existing ancestor component is a non-directory
            let mut anc = String::new();
            let mut blocked = false;
            for seg in p.split('/').filter(|s| !s.is_empty()) {
                anc.push('/');
                anc.push_str(seg);
                if !fs.exists(&anc) && fs.lstat(&anc).is_err() {
                    if anc != p { new_parents.push(anc.clone()); }
                } else if !fs.is_dir(&anc) {
                    stderr.push_str(&format!(
                        "mkdir: ENOTDIR: not a directory, mkdir '{p}'\n"
                    ));
                    code = 1;
                    blocked = true;
                    break;
                }
            }
            if blocked {
                continue;
            }
        }
        let mut created = Vec::new();
        if verbose {
            if recursive {
                let mut seen = std::collections::BTreeSet::new();
                let bytes = a.as_bytes();
                for idx in 1..bytes.len() {
                    if bytes[idx] != b'/' || bytes[idx - 1] == b'/' {
                        continue;
                    }
                    let parent_op = &a[..idx];
                    let parent_p = resolve_posix_path(cwd, parent_op);
                    if parent_p == p || !seen.insert(parent_p.clone()) {
                        continue;
                    }
                    if !fs.exists(&parent_p) && fs.lstat(&parent_p).is_err() {
                        created.push(parent_op.to_string());
                    }
                }
            }
            created.push(a.clone());
        }
        let result = new_parents.iter().try_for_each(|parent| fs.mkdir_one(parent, default_mode | 0o300))
            .and_then(|()| fs.mkdir_one(&p, explicit_mode.unwrap_or(default_mode)));
        if let Err(e) = result {
            stderr.push_str(&format!("mkdir: cannot create directory '{a}': {e}\n"));
            code = 1;
        } else {
            for d in created {
                stdout.push_str(&format!("mkdir: created directory '{d}'\n"));
            }
        }
    }
    BuiltinOutcome {
        stdout,
        stderr,
        exit_code: code,
    }
}

fn cmd_rmdir(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut code = 0;
    let mut parents = false;
    let mut verbose = false;
    let mut ignore_non_empty = false;
    let mut ended = false;
    let mut operands = Vec::new();
    for a in args {
        if ended {
            operands.push(a.clone());
            continue;
        }
        if a == "--" {
            ended = true;
            continue;
        }
        if a == "--parents" {
            parents = true;
        } else if a == "--verbose" {
            verbose = true;
        } else if a == "--ignore-fail-on-non-empty" {
            ignore_non_empty = true;
        } else if a.starts_with('-') && !a.starts_with("--") && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    'p' => parents = true,
                    'v' => verbose = true,
                    _ => return err_out(&format!("rmdir: invalid option -- '{ch}'\n"), 2),
                }
            }
        } else if a.starts_with("--") {
            return err_out(&format!("rmdir: unrecognized option '{a}'\n"), 2);
        } else {
            operands.push(a.clone());
        }
    }
    if operands.is_empty() {
        return err_out("rmdir: missing operand\n", 2);
    }
    for a in &operands {
        let stop = if a.starts_with('/') {
            "/".to_string()
        } else {
            let first_seg = a
                .split('/')
                .find(|s| !s.is_empty() && *s != ".")
                .unwrap_or(a.as_str());
            crate::vfs::dirname_posix_path(&resolve_posix_path(cwd, first_seg))
        };
        let mut cur_p = if a.starts_with('/') || a.is_empty() { a.clone() } else { child_disp_path(cwd, a) };
        let mut cur_disp = a.clone();
        loop {
            if cur_p == "/" {
                stderr.push_str(&format!(
                    "rmdir: failed to remove '{cur_disp}': Device or resource busy\n"
                ));
                code = 1;
                break;
            }
            if let Err(e) = fs.remove_one(&cur_p, true) {
                if !ignore_non_empty || !e.starts_with("ENOTEMPTY:") {
                    stderr.push_str(&format!("rmdir: {e}, rmdir '{cur_p}'\n"));
                    code = 1;
                }
                break;
            }
            if verbose {
                stdout.push_str(&format!("rmdir: removing directory, '{cur_disp}'\n"));
            }
            if !parents {
                break;
            }
            cur_p = crate::vfs::dirname_posix_path(&cur_p);
            if cur_p == "/" || cur_p == stop {
                break;
            }
            let trimmed = cur_disp.trim_end_matches('/');
            if let Some((parent_disp, _)) = trimmed.rsplit_once('/') {
                cur_disp = if parent_disp.is_empty() {
                    "/".to_string()
                } else {
                    parent_disp.to_string()
                };
            } else {
                break;
            }
        }
    }
    BuiltinOutcome {
        stdout,
        stderr,
        exit_code: code,
    }
}

fn cmd_rm(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut force = false;
    let mut interactive = "never";
    let mut recursive = false;
    let mut dir_mode = false;
    let mut verbose = false;
    let mut targets = Vec::new();
    let mut opts_done = false;
    for a in args {
        if !opts_done && a == "--" {
            opts_done = true;
            continue;
        }
        if !opts_done && a.starts_with('-') && a.len() > 1 {
            if a == "--force" {
                force = true;
                interactive = "never";
            } else if a == "--interactive" || a.starts_with("--interactive=") {
                let policy = if a == "--interactive" {
                    "always"
                } else {
                    &a["--interactive=".len()..]
                };
                let policies = [
                    ("never", "never"),
                    ("no", "never"),
                    ("none", "never"),
                    ("once", "once"),
                    ("always", "always"),
                    ("yes", "always"),
                ];
                let mut modes = std::collections::BTreeSet::new();
                if !policy.is_empty() {
                    for (name, mode) in policies {
                        if name.starts_with(policy) {
                            modes.insert(mode);
                        }
                    }
                }
                if modes.len() != 1 {
                    return err_out(
                        &format!("rm: invalid argument '{policy}' for '--interactive'\n"),
                        2,
                    );
                }
                interactive = modes.into_iter().next().unwrap();
                if interactive == "always" {
                    force = false;
                }
            } else if a == "--recursive" {
                recursive = true;
            } else if a == "--dir" {
                dir_mode = true;
            } else if a == "--verbose" {
                verbose = true;
            } else if !a.starts_with("--") {
                for ch in a[1..].chars() {
                    match ch {
                        'f' => {
                            force = true;
                            interactive = "never";
                        }
                        'i' => {
                            interactive = "always";
                            force = false;
                        }
                        'I' => {
                            interactive = "once";
                        }
                        'r' | 'R' => recursive = true,
                        'd' => dir_mode = true,
                        'v' => verbose = true,
                        _ => return err_out(&format!("rm: invalid option -- '{ch}'\n"), 2),
                    }
                }
            } else {
                return err_out(&format!("rm: unrecognized option '{a}'\n"), 2);
            }
        } else {
            targets.push(a.clone());
        }
    }
    if targets.is_empty() {
        if force {
            return ok_out("");
        }
        return err_out("rm: missing operand\n", 2);
    }
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut code = 0;
    let mut stdin_lines = stdin.lines();
    if interactive == "once" && (recursive || targets.len() > 3) {
        stderr.push_str(&format!(
            "rm: remove {} argument{}{}?",
            targets.len(),
            if targets.len() == 1 { "" } else { "s" },
            if recursive { " recursively" } else { "" }
        ));
        stderr.push(' ');
        let ans = stdin_lines.next().unwrap_or("");
        let first = ans.trim_start().chars().next().unwrap_or('n');
        if first != 'y' && first != 'Y' {
            return BuiltinOutcome {
                stdout,
                stderr,
                exit_code: 0,
            };
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn remove_operand(
        operand: &str,
        cwd: &str,
        force: bool,
        interactive: &str,
        recursive: bool,
        dir_mode: bool,
        verbose: bool,
        fs: &dyn SafeBashFs,
        stdin_lines: &mut std::str::Lines<'_>,
        stdout: &mut String,
        stderr: &mut String,
        code: &mut i32,
    ) -> Result<bool, ()> {
        let trimmed = operand.trim_end_matches('/');
        let last_seg = trimmed.rsplit('/').next().unwrap_or(trimmed);
        let p = resolve_posix_path(cwd, operand);
        if p == "/" || last_seg == "." || last_seg == ".." {
            stderr.push_str(&format!(
                "rm: cannot remove '{operand}': refusing to remove root, '.' or '..'\n"
            ));
            *code = 1;
            return Err(());
        }
        let raw = if operand.starts_with('/') || operand.is_empty() { operand.to_owned() } else { child_disp_path(cwd, operand) };
        let (p, stat) = match fs.access_path(raw.trim_end_matches('/'), false)
            .and_then(|p| fs.lstat(&p).map(|st| (p, st))) {
            Ok(entry) => entry,
            Err(e) => {
                if force && e.starts_with("ENOENT:") { return Ok(true); }
                let reason = if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") { "ENOENT: no such file or directory" }
                    else { e.split_once(", ").map_or(e.as_str(), |(reason, _)| reason) };
                stderr.push_str(&format!("rm: {reason}, rm '{raw}'\n"));
                *code = 1;
                return Err(());
            }
        };
        let is_sym = stat.kind == VfsEntryKind::Symlink;
        if operand.ends_with('/') && (!fs.is_dir(&p) || is_sym && !fs.is_dir(&p)) {
            stderr.push_str(&format!("rm: cannot remove '{operand}': Not a directory\n"));
            *code = 1;
            return Err(());
        }
        let is_real_dir = stat.kind == VfsEntryKind::Directory;
        if is_real_dir && !recursive && !dir_mode {
            stderr.push_str(&format!("rm: EISDIR: illegal operation on a directory, rm '{p}'\n"));
            *code = 1;
            return Err(());
        }
        if interactive == "always" {
            if is_real_dir && recursive {
                let entries = fs.list_dir(&p).map_err(|e| {
                    let reason = e.split_once(", ").map_or(e.as_str(), |(reason, _)| reason);
                    stderr.push_str(&format!("rm: {reason}, readdir '{raw}'\n"));
                    *code = 1;
                })?;
                if !entries.is_empty() {
                    stderr.push_str(&format!("rm: descend into directory '{operand}'? "));
                    let ans = stdin_lines.next().unwrap_or("");
                    let first = ans.trim_start().chars().next().unwrap_or('n');
                    if first != 'y' && first != 'Y' {
                        return Ok(false);
                    }
                    let mut all_removed = true;
                    for e in entries {
                        let child_op = child_disp_path(operand, &e);
                        if !remove_operand(
                            &child_op,
                            cwd,
                            force,
                            interactive,
                            recursive,
                            dir_mode,
                            verbose,
                            fs,
                            stdin_lines,
                            stdout,
                            stderr,
                            code,
                        )? {
                            all_removed = false;
                        }
                    }
                    if !all_removed {
                        return Ok(false);
                    }
                }
            }
            let type_label = if is_sym {
                "symbolic link"
            } else if is_real_dir {
                "directory"
            } else if stat.size == 0 {
                "regular empty file"
            } else {
                "regular file"
            };
            stderr.push_str(&format!("rm: remove {type_label} '{operand}'? "));
            let ans = stdin_lines.next().unwrap_or("");
            let first = ans.trim_start().chars().next().unwrap_or('n');
            if first != 'y' && first != 'Y' {
                return Ok(false);
            }
        }
        let single = !recursive || interactive == "always";
        let result = if single { fs.remove_one(&raw, is_real_dir) } else { fs.remove_path(&raw) };
        match result {
            Ok(()) => {
                if verbose {
                    stdout.push_str(&format!("removed '{operand}'\n"));
                }
                Ok(true)
            }
            Err(e) => {
                if !(force && e.starts_with("ENOENT:")) {
                    let op = if single && is_real_dir { "rmdir" } else { "rm" };
                    stderr.push_str(&format!("rm: {e}, {op} '{raw}'\n"));
                    *code = 1;
                }
                Err(())
            }
        }
    }

    for t in targets {
        let _ = remove_operand(
            &t,
            cwd,
            force,
            interactive,
            recursive,
            dir_mode,
            verbose,
            fs,
            &mut stdin_lines,
            &mut stdout,
            &mut stderr,
            &mut code,
        );
    }
    BuiltinOutcome {
        stdout,
        stderr,
        exit_code: code,
    }
}

fn unlink_destination(path: &str, fs: &dyn SafeBashFs) -> Result<(), String> {
    match fs.remove_one(path, false) {
        Ok(()) => Ok(()),
        Err(e) if e.starts_with("ENOENT:") => Ok(()),
        Err(e) if e.starts_with("EISDIR:") => Err(format!("EISDIR: illegal operation on a directory '{path}'")),
        Err(e) => Err(format!("{e}, rm '{path}'")),
    }
}

#[derive(Default)]
struct CopyLinks {
    first: BTreeMap<EntryIdentity, (String, Option<EntryIdentity>)>,
    targets: BTreeMap<String, EntryIdentity>,
}

#[derive(Default)]
struct CopySettings {
    one_file_system: bool,
    root_identity: Option<EntryIdentity>,
    links: Option<CopyLinks>,
    symbolic_cwd: Option<String>,
    hard_link: bool,
    attributes_only: bool,
    recursive: bool,
    no_clobber: bool,
    update_only: bool,
    archive: bool,
    dereference: char,
    mode: bool,
    timestamps: bool,
    force: bool,
    remove_destination: bool,
    backup: Option<(BackupMode, String)>,
}

impl CopySettings {
    fn skip_existing(&self, source: &FileStat, target: &FileStat) -> bool {
        self.no_clobber || self.update_only && source.kind != VfsEntryKind::Directory
            && target.kind != VfsEntryKind::Directory && source.mtime_ms <= target.mtime_ms
    }
}

fn copy_error(error: &str, op: &str, path: &str) -> String {
    if error.split_once(", ").is_some_and(|(_, at)| at.starts_with("realpath '") || at.starts_with("overlay '")) {
        return error.to_owned();
    }
    let reason = if error.starts_with("ENOENT:") || error.ends_with("(os error 2)") { "ENOENT: no such file or directory" }
        else if error.starts_with("ELOOP:") { return format!("ELOOP: too many symbolic links encountered '{path}'"); }
        else { error.split_once(", ").map_or(error, |(reason, _)| reason) };
    format!("{reason}, {op} '{path}'")
}

fn hard_link_error(error: &str, source: &str, destination: &str) -> String {
    if error.starts_with("EBUSY:") { format!("{error} '{source}'") }
    else if error.starts_with("ENOENT:") || error.starts_with("EACCES:") { copy_error(error, "link", destination) }
    else { format!("{error}, link '{source}' -> '{destination}'") }
}

fn backup_copy_target(fs: &dyn SafeBashFs, src: &str, target: &str, mode: BackupMode, suffix: &str) -> Result<(), String> {
    let backup = backup_path(target, mode, suffix, fs)?;
    let from = fs.access_path(src, false)?;
    let referent = |p: &str| match fs.inspect_command_entry(p, true, "realpath") {
        Ok((path, _)) => Ok(Some(path)),
        Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => Ok(None),
        Err(e) => Err(e),
    };
    let existing = referent(&backup)?;
    if from == backup || existing.is_some() && existing == referent(src)? {
        return Err(format!("EINVAL: backup would destroy source '{backup}'"));
    }
    fs.rename(target, &backup, false).map_err(|e| format!("{e}, rename '{target}' -> '{backup}'"))
}

struct CopyReport<'a> {
    answers: Option<std::str::Lines<'a>>,
    verbose: bool,
    stdout: String,
    stderr: String,
    declined: bool,
}

fn copy_operand_text(path: &str, prompt: bool) -> String {
    if prompt && path.contains('\'') && path.bytes().all(|b|
        (32..127).contains(&b) && !matches!(b, b'$' | 96 | b'\\' | b'"')) {
        return format!("\"{path}\"");
    }
    let mut out = String::from("'");
    let mut escaped = false;
    for b in path.bytes() {
        let special = !(32..127).contains(&b);
        if prompt && special != escaped {
            if special { out.push_str("'$'"); }
            else if b != b'\'' { out.push_str("''"); }
            escaped = special;
        }
        match b {
            7 if prompt => out.push_str("\\a"),
            8 => out.push_str("\\b"),
            9 => out.push_str("\\t"),
            10 => out.push_str("\\n"),
            11 => out.push_str("\\v"),
            12 => out.push_str("\\f"),
            13 => out.push_str("\\r"),
            b'\'' if prompt => out.push_str("'\\''"),
            b'\\' if !prompt => out.push_str("\\\\"),
            32..=126 => out.push(char::from(b)),
            _ => out.push_str(&format!("\\{b:03o}")),
        }
    }
    out.push('\'');
    out
}

impl CopyReport<'_> {
    fn confirm(&mut self, dst: &str) -> bool {
        let Some(lines) = self.answers.as_mut() else { return true };
        self.stderr.push_str(&format!("cp: overwrite {}? ", copy_operand_text(dst, true)));
        let yes = matches!(lines.next().and_then(|s| s.as_bytes().first()), Some(b'y' | b'Y'));
        self.declined |= !yes;
        yes
    }

    fn copied(&mut self, (src, dst): (&str, &str)) {
        if self.verbose { self.stdout.push_str(&format!("{} -> {}\n", copy_operand_text(src, false), copy_operand_text(dst, false))); }
    }
}

enum CopyPass<'a, 'b> {
    Admit { missing_parent: bool },
    Publish(&'a mut CopyReport<'b>),
}

fn copy_entry(src: &str, dst: &str, display: (&str, &str), fs: &dyn SafeBashFs, settings: &mut CopySettings, mut pass: CopyPass<'_, '_>, ancestors: &mut std::collections::BTreeSet<String>) -> Result<(), String> {
    let source_entry = fs.access_path(src, false).map_err(|e| copy_error(&e, "lstat", src))?;
    let link = fs.lstat(&source_entry).map_err(|e| copy_error(&e, "lstat", src))?;
    let link_mode = settings.symbolic_cwd.is_some() || settings.hard_link;
    let link_id = link.identity.clone();
    let preserve_link = link.kind == VfsEntryKind::Symlink && (settings.dereference == 'P' || settings.dereference == 'H' && !ancestors.is_empty());
    let (source, st) = if link.kind == VfsEntryKind::Symlink && !preserve_link {
        fs.inspect_command_entry(src, true, "stat").map_err(|e| copy_error(&e, "stat", src))?
    } else { (source_entry, link) };
    let directory = st.kind == VfsEntryKind::Directory;
    let replace = !directory && settings.remove_destination;
    let (entry, existing) = if matches!(pass, CopyPass::Admit { missing_parent: true }) {
        (dst.to_owned(), None)
    } else {
        let entry = fs.access_path(dst, false).map_err(|e| copy_error(&e, if directory { "mkdir" } else { "writeStream" }, dst))?;
        let existing = match fs.lstat(&entry) {
            Ok(st) => Some(st),
            Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => None,
            Err(e) => return Err(e),
        };
        (entry, existing)
    };
    let (mut target, mut target_stat) = if !link_mode && !preserve_link && !replace && existing.as_ref().is_some_and(|st| st.kind == VfsEntryKind::Symlink) {
        let (p, st) = fs.inspect_command_entry(dst, true, "realpath").map_err(|e| copy_error(&e, "realpath", dst))?;
        (p, Some(st))
    } else { (entry.clone(), existing.clone()) };
    if target == source || target_stat.as_ref().is_some_and(|t| t.identity.is_some() && t.identity == st.identity) {
        return Err(format!("EINVAL: source and destination are the same file '{src}' -> '{dst}'"));
    }
    if target_stat.as_ref().is_some_and(|t| settings.skip_existing(&st, t)) { return Ok(()); }
    if !directory && target_stat.as_ref().is_some_and(|t| t.kind != VfsEntryKind::Directory)
        && let CopyPass::Publish(report) = &mut pass && !report.confirm(display.1) {
        return Ok(());
    }
    if preserve_link && settings.timestamps && !settings.archive {
        return Err(format!("ENOTSUP: operation not supported, utimes '{dst}'"));
    }
    let copy_id = if let Some(links) = &settings.links {
        if links.targets.get(&target).is_some_and(|prior| Some(prior) != st.identity.as_ref()) {
            return Err(format!("will not overwrite just-created '{}' with '{}'", display.1, display.0));
        }
        if directory { None } else {
            Some(st.identity.clone().ok_or_else(|| format!("ENOTSUP: preserving links requires scoped file identity, cp '{src}'"))?)
        }
    } else { None };
    let physical_target = copy_id.as_ref().map(|_| target.clone());
    let previous = copy_id.as_ref().and_then(|id| settings.links.as_ref()?.first.get(id)).cloned();
    if previous.is_none() && preserve_link && !link_mode && settings.attributes_only && target_stat.is_some() && settings.backup.is_none() && !replace {
        return Err(format!("EEXIST: file already exists, symlink '{dst}'"));
    }
    if !directory && let Some(cwd) = &settings.symbolic_cwd
        && !display.0.starts_with('/') && crate::vfs::dirname_posix_path(&entry) != *cwd {
        return Err("can make relative symbolic links only in current directory".into());
    }
    if link_mode && !directory && let Some(t) = &target_stat
        && (link_id.is_none() || st.identity.is_none() || t.identity.is_none() || t.identity == link_id) {
        return Err(format!("ENOTSUP: link copy unlink lacks authoritative distinctness '{dst}'"));
    }
    if !directory && (settings.hard_link || previous.is_some()) {
        for path in [previous.as_ref().map_or(src, |(path, _)| path.as_str()), dst] {
            if !fs.supports_hard_links(path) { return Err(format!("ENOTSUP: operation not supported, cp '{path}'")); }
        }
    }
    if let Some((path, recorded)) = &previous {
        // The first copy may itself be a symlink. Link its directory entry,
        // and never unlink a replacement if the first copy has changed.
        target_stat = existing;
        if matches!(pass, CopyPass::Publish(_)) {
            if recorded.is_none() || fs.lstat(path)?.identity != *recorded {
                return Err(format!("ENOTSUP: copied hard-link source changed, cp '{path}'"));
            }
            if target_stat.as_ref().is_some_and(|t| t.identity == *recorded) { return Ok(()); }
        }
        if let Some(t) = &target_stat && (t.identity.is_none() || t.identity == st.identity || t.identity == link_id) {
            return Err(format!("ENOTSUP: hard-link copy unlink lacks authoritative distinctness '{dst}'"));
        }
    }
    if !directory && target_stat.as_ref().is_some_and(|t| t.kind == VfsEntryKind::Directory) {
        return Err(format!("EISDIR: illegal operation on a directory '{dst}'"));
    }
    if directory {
        if !settings.recursive { return Err(format!("EISDIR: omitting directory (use -R) '{src}'")); }
        if crate::vfs::is_path_within(&source, &target) {
            return Err(format!("EINVAL: cannot copy a directory into itself '{dst}'"));
        }
        if target_stat.as_ref().is_some_and(|t| t.kind != VfsEntryKind::Directory) {
            return Err(format!("ENOTDIR: not a directory '{dst}'"));
        }
    } else if matches!(pass, CopyPass::Admit { .. }) {
        if let (Some(links), Some(id), Some(target)) = (&mut settings.links, copy_id, physical_target) {
            links.first.entry(id.clone()).or_insert_with(|| (dst.to_owned(), None));
            links.targets.insert(target, id);
        }
        return Ok(());
    }
    if !directory && target_stat.is_some() && let Some((mode, suffix)) = &settings.backup {
        backup_copy_target(fs, src, &entry, *mode, suffix)?;
        target = entry.clone();
        target_stat = None;
    }
    if !directory && (settings.hard_link || previous.is_some()) {
        let from = previous.as_ref().map_or(source.as_str(), |(path, _)| path);
        if target_stat.is_some() { unlink_destination(&entry, fs)?; }
        fs.hard_link(from, &entry).map_err(|e| hard_link_error(&e, from, dst))?;
        if previous.is_some() && settings.mode && !preserve_link { fs.chmod(&entry, st.mode & 0o7777)?; }
        target = entry;
    } else if !directory && (settings.symbolic_cwd.is_some() || preserve_link) {
        let text = if settings.symbolic_cwd.is_some() { display.0.to_owned() } else { fs.readlink(&source)? };
        if target_stat.is_some() { unlink_destination(&entry, fs)?; }
        if fs.stat(&crate::vfs::dirname_posix_path(&entry))?.mode & 0o300 != 0o300 {
            return Err(format!("EACCES: permission denied, symlink '{dst}'"));
        }
        fs.symlink(&text, &entry)?;
        if settings.mode && !preserve_link { fs.chmod(&entry, st.mode & 0o7777)?; }
        target = entry;
    } else if directory {
        if !ancestors.insert(source.clone()) { return Err(format!("ELOOP: too many symbolic links encountered '{src}'")); }
        let created = target_stat.is_none();
        let mode = st.mode & 0o777;
        let publish = matches!(pass, CopyPass::Publish(_));
        if publish && created {
            fs.mkdir_one(&target, mode | 0o700).map_err(|e| copy_error(&e, "mkdir", dst))?;
        }
        if settings.one_file_system && ancestors.len() == 1 { settings.root_identity = st.identity.clone(); }
        let crosses_device = settings.one_file_system && ancestors.len() > 1 && settings.root_identity.as_ref()
            .zip(st.identity.as_ref()).is_some_and(|(root, child)| !root.same_filesystem(child));
        let children = if crosses_device { Ok(Vec::new()) } else { fs.list_dir(&source) };
        let copied = children.map_err(|e| copy_error(&e, "readdir", src)).and_then(|mut names| {
            names.sort_unstable_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            for name in names {
                let display_names = (settings.links.is_some() || settings.symbolic_cwd.is_some() || matches!(&pass, CopyPass::Publish(r) if r.verbose || r.answers.is_some()))
                    .then(|| (child_disp_path(display.0, &name), child_disp_path(display.1, &name)));
                let child_pass = match &mut pass {
                    CopyPass::Publish(report) => CopyPass::Publish(report),
                    CopyPass::Admit { .. } => CopyPass::Admit { missing_parent: created },
                };
                let display = display_names.as_ref().map_or(("", ""), |(s, d)| (s.as_str(), d.as_str()));
                copy_entry(&child_disp_path(src, &name), &child_disp_path(dst, &name), display, fs, settings, child_pass, ancestors)?;
            }
            Ok(())
        });
        ancestors.remove(&source);
        if publish && (created && mode & 0o700 != 0o700 || copied.is_ok() && settings.mode) {
            fs.chmod(&target, mode)?;
        }
        copied?;
    } else if settings.attributes_only {
        if replace && target_stat.is_some() {
            unlink_destination(&entry, fs)?;
            target_stat = None;
        }
        if target_stat.is_none() {
            fs.create_file(&target, &[], st.mode & 0o777).map_err(|e| copy_error(&e, "writeFile", dst))?;
        }
        if settings.mode { fs.chmod(&target, st.mode & 0o7777)?; }
    } else {
        if st.mode & 0o400 == 0 { return Err(format!("EACCES: permission denied, openReadFile '{source}'")); }
        if replace || settings.force && target_stat.as_ref().is_some_and(|t| t.mode & 0o200 == 0 && t.mode & 0o170000 != 0o020000) {
            if target_stat.is_some() { unlink_destination(&entry, fs)?; }
            target = entry;
            target_stat = None;
        }
        if let Some(t) = &target_stat {
            if t.mode & 0o200 == 0 { return Err(format!("EACCES: permission denied, writeStream '{dst}'")); }
        } else if fs.stat(&crate::vfs::dirname_posix_path(&target)).map_err(|e| copy_error(&e, "writeStream", dst))?.mode & 0o300 != 0o300 {
            return Err(format!("EACCES: permission denied, writeStream '{dst}'"));
        }
        let data = fs.read_file(&source)?;
        if let Some(t) = target_stat {
            fs.write_file(&target, &data)?;
            if t.mode & 0o170000 != 0o020000 {
                fs.chmod(&target, (if settings.mode { st.mode } else { t.mode }) & 0o7777)?;
            }
        } else {
            fs.create_file(&target, &data, st.mode & 0o7777).map_err(|e| copy_error(&e, "writeStream", dst))?;
        }
    }
    if settings.timestamps && !preserve_link && matches!(pass, CopyPass::Publish(_)) { fs.set_times(&target, Some(st.atime_ms), Some(st.mtime_ms))?; }
    if let (Some(links), Some(id), Some(target)) = (&mut settings.links, copy_id, physical_target) {
        if previous.is_none() { links.first.insert(id.clone(), (dst.to_owned(), fs.lstat(dst)?.identity)); }
        links.targets.insert(target, id);
    }
    if let CopyPass::Publish(report) = pass { report.copied(display); }
    Ok(())
}

fn cmd_cp(
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &std::collections::BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut operands: Vec<String> = Vec::new();
    let mut end_opts = false;
    let mut overwrite: Option<char> = None;
    let mut hard_link = false;
    let mut sym_link = false;
    let mut verbose = false;
    let mut no_target_dir = false;
    let mut target_dir: Option<String> = None;
    let mut t_count = 0usize;
    let mut backup_flag = false;
    let mut suffix_flag = false;
    let mut backup_control: Option<String> = None;
    let mut backup_suffix = env
        .get("SIMPLE_BACKUP_SUFFIX")
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| "~".to_string());
    let mut deref_opt: Option<char> = None;
    let mut settings = CopySettings::default();
    let mut preserve_links = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if !end_opts && a == "--" {
            end_opts = true;
            i += 1;
            continue;
        }
        if !end_opts && (a == "-S" || a == "--suffix") && i + 1 < args.len() {
            backup_suffix = args[i + 1].clone();
            suffix_flag = true;
            i += 2;
            continue;
        }
        if !end_opts && (a == "-t" || a == "--target-directory") && i + 1 < args.len() {
            target_dir = Some(args[i + 1].clone());
            t_count += 1;
            i += 2;
            continue;
        }
        if !end_opts && a.starts_with('-') && a != "-" {
            if a == "--no-clobber" {
                overwrite = Some('n');
            } else if a == "--interactive" {
                overwrite = Some('i');
            } else if a == "--force" {
                settings.force = true;
            } else if a == "--update" {
                settings.update_only = true;
            } else if a == "--link" {
                hard_link = true;
            } else if a == "--symbolic-link" {
                sym_link = true;
            } else if a == "--verbose" {
                verbose = true;
            } else if a == "--no-target-directory" {
                no_target_dir = true;
            } else if let Some(td) = a.strip_prefix("--target-directory=") {
                target_dir = Some(td.to_string());
                t_count += 1;
            } else if a == "--dereference" {
                deref_opt = Some('L');
            } else if a == "--no-dereference" {
                deref_opt = Some('P');
            } else if a == "--archive" {
                settings.archive = true;
                settings.recursive = true;
                deref_opt = Some('P');
                preserve_links = true;
                settings.mode = true;
                settings.timestamps = true;
            } else if a == "--preserve" {
                settings.mode = true;
                settings.timestamps = true;
            } else if let Some(attrs) = a.strip_prefix("--preserve=") {
                for attr in attrs.split(',') {
                    match attr {
                        "mode" => settings.mode = true,
                        "timestamps" => settings.timestamps = true,
                        "ownership" => {}
                        "links" => preserve_links = true,
                        "all" | "context" | "xattr" => {
                            return err_out(
                                &format!("cp: preserving {attr} is unavailable\n"),
                                1,
                            );
                        }
                        _ => {
                            return err_out(
                                &format!("cp: invalid argument '{attr}' for 'preserve'\n"),
                                2,
                            );
                        }
                    }
                }
            } else if a == "--remove-destination" {
                settings.remove_destination = true;
            } else if a == "--attributes-only" {
                settings.attributes_only = true;
            } else if a == "--one-file-system" {
                settings.one_file_system = true;
            } else if a == "--recursive" {
                settings.recursive = true;
            } else if let Some(ctrl) = a.strip_prefix("--backup=") {
                backup_control = Some(ctrl.to_string());
            } else if a == "--backup" {
                backup_flag = true;
            } else if let Some(s) = a.strip_prefix("--suffix=") {
                backup_suffix = s.to_string();
                suffix_flag = true;
            } else if !a.starts_with("--") {
                let chars: Vec<char> = a[1..].chars().collect();
                let mut j = 0usize;
                while j < chars.len() {
                    match chars[j] {
                        'n' => overwrite = Some('n'),
                        'i' => overwrite = Some('i'),
                        'f' => settings.force = true,
                        'p' => { settings.mode = true; settings.timestamps = true; }
                        'x' => settings.one_file_system = true,
                        'u' => settings.update_only = true,
                        'l' => hard_link = true,
                        's' => sym_link = true,
                        'b' => backup_flag = true,
                        'v' => verbose = true,
                        'T' => no_target_dir = true,
                        't' => {
                            t_count += 1;
                            let rest: String = chars[j + 1..].iter().collect();
                            if !rest.is_empty() {
                                target_dir = Some(rest);
                            } else if i + 1 < args.len() {
                                i += 1;
                                target_dir = Some(args[i].clone());
                            } else {
                                return err_out("cp: option requires an argument -- 't'\n", 2);
                            }
                            break;
                        }
                        'S' => {
                            suffix_flag = true;
                            let rest: String = chars[j + 1..].iter().collect();
                            if !rest.is_empty() {
                                backup_suffix = rest;
                            } else if i + 1 < args.len() {
                                i += 1;
                                backup_suffix = args[i].clone();
                            } else {
                                return err_out("cp: option requires an argument -- 'S'\n", 2);
                            }
                            break;
                        }
                        'r' | 'R' => settings.recursive = true,
                        'a' => {
                            settings.archive = true;
                            settings.recursive = true;
                            deref_opt = Some('P');
                            preserve_links = true;
                            settings.mode = true;
                            settings.timestamps = true;
                        }
                        'd' => {
                            deref_opt = Some('P');
                            preserve_links = true;
                        }
                        'P' => deref_opt = Some('P'),
                        'L' => deref_opt = Some('L'),
                        'H' => deref_opt = Some('H'),
                        ch => return err_out(&format!("cp: invalid option -- '{ch}'\n"), 2),
                    }
                    j += 1;
                }
            } else {
                return err_out(&format!("cp: unrecognized option '{a}'\n"), 2);
            }
            i += 1;
            continue;
        }
        operands.push(a.clone());
        i += 1;
    }
    let no_clobber = overwrite == Some('n');
    let interactive = overwrite == Some('i');
    if t_count > 1 {
        return err_out("cp: multiple target directories specified\n", 2);
    }
    if hard_link && sym_link {
        return err_out("cp: cannot make both hard and symbolic links\n", 2);
    }
    if target_dir.is_some() && no_target_dir {
        return err_out("cp: cannot combine --target-directory and --no-target-directory\n", 2);
    }
    if no_target_dir && operands.len() != 2 {
        return err_out("cp: invalid number of operands with -T\n", 2);
    }
    let eff_operands: Vec<String> = if let Some(ref td) = target_dir {
        let mut v = operands;
        v.push(td.clone());
        v
    } else {
        operands
    };
    if eff_operands.len() < 2 {
        return err_out("cp: missing operand\n", 2);
    }
    let control = backup_control.as_deref().or_else(|| (backup_flag || suffix_flag)
        .then(|| env.get("VERSION_CONTROL").map(String::as_str).unwrap_or("existing")));
    let backup_mode = match parse_backup_control(control) {
        Ok(mode) => mode,
        Err(e) => return err_out(&format!("cp: {e}\n"), 2),
    };
    if backup_mode != BackupMode::None && no_clobber {
        return err_out(
            "cp: options --backup and --no-clobber are mutually exclusive\n",
            2,
        );
    }
    let deref_mode = deref_opt.unwrap_or(if settings.recursive { 'P' } else { 'H' });
    settings.symbolic_cwd = sym_link.then(|| fs.access_path(cwd, true).unwrap_or_else(|_| cwd.to_owned()));
    settings.hard_link = hard_link;
    settings.dereference = deref_mode;
    settings.no_clobber = no_clobber;
    if backup_mode != BackupMode::None { settings.backup = Some((backup_mode, backup_suffix)); }
    let dst_raw = eff_operands.last().unwrap();
    let dst_operand = absolute_operand(cwd, dst_raw);
    let dst_base = match fs.access_path(&dst_operand, false) {
        Ok(entry) => entry,
        Err(e) => {
            if (sym_link || hard_link) && e.starts_with("ENOENT:") {
                let error = copy_error(&e, "realpath", &crate::vfs::dirname_posix_path(&dst_operand));
                return err_out(&format!("cp: {error}\n"), 1);
            }
            let op = if e.starts_with("ENOENT:") { "writeStream" } else if dst_operand.ends_with('/') { "lstat" } else { "stat" };
            let error = if e.contains(", lstat '") && !dst_operand.contains("/../") { e } else { copy_error(&e, op, &dst_operand) };
            return err_out(&format!("cp: {error}\n"), 1);
        }
    };
    let dst_is_dir = !no_target_dir && fs.is_dir(&dst_base);
    if (target_dir.is_some() || eff_operands.len() > 2) && !dst_is_dir {
        return err_out(&format!("cp: target '{dst_raw}' is not a directory\n"), 1);
    }
    let mut report = CopyReport { answers: interactive.then(|| stdin.lines()), verbose, stdout: String::new(), stderr: String::new(), declined: false };
    let mut code = 0;
    settings.links = preserve_links.then(CopyLinks::default);

    // Check link and timestamp support before publishing any part of the copy.
    let sources = &eff_operands[..eff_operands.len() - 1];
    if preserve_links || sym_link || hard_link || settings.timestamps && !settings.archive && (deref_mode == 'P' || settings.recursive && deref_mode == 'H') {
        for operand in sources {
            let src = absolute_operand(cwd, operand);
            let target = if dst_is_dir { child_disp_path(&dst_base, &basename_posix_path(&src)) } else { dst_base.clone() };
            if let Err(e) = copy_entry(&src, &target, (operand, &target), fs, &mut settings, CopyPass::Admit { missing_parent: false }, &mut Default::default())
                && e.starts_with("ENOTSUP:") {
                return err_out(&format!("cp: {e}\n"), 1);
            }
        }
    }
    settings.links = preserve_links.then(CopyLinks::default);
    for src_raw in sources {
        let operand = absolute_operand(cwd, src_raw);
        let (src, link) = match fs.inspect_command_entry(&operand, false, "lstat") {
            Ok(v) => v,
            Err(e) => { report.stderr.push_str(&format!("cp: {}\n", copy_error(&e, "lstat", &operand))); code = 1; continue; }
        };
        let src_is_sym = link.kind == VfsEntryKind::Symlink;
        let preserve_top_link = src_is_sym && deref_mode == 'P';
        let (phys_src, source_stat) = if src_is_sym && !preserve_top_link {
            match fs.inspect_command_entry(&src, true, "stat") {
                Ok(v) => v,
                Err(e) => { report.stderr.push_str(&format!("cp: {}\n", copy_error(&e, "stat", &operand))); code = 1; continue; }
            }
        } else { (src.clone(), link) };
        let src_is_dir = source_stat.kind == VfsEntryKind::Directory;
        if src_is_dir && !settings.recursive {
            report.stderr.push_str(&format!("cp: EISDIR: omitting directory (use -R) '{src}'\n"));
            code = 1;
            continue;
        }
        let name = basename_posix_path(&src);
        let target = if dst_is_dir {
            child_disp_path(&dst_base, &name)
        } else {
            dst_base.clone()
        };
        let disp_target = if dst_is_dir {
            child_disp_path(dst_raw, &name)
        } else {
            dst_raw.clone()
        };
        let dest_entry = fs.lstat(&target).ok();
        let follow_target = !preserve_top_link && !(settings.remove_destination && !src_is_dir) && !sym_link && !hard_link;
        let destination = if follow_target && dest_entry.as_ref().is_some_and(|t| t.kind == VfsEntryKind::Symlink) {
            fs.inspect_command_entry(&target, true, "realpath").map(|(p, t)| (p, Some(t)))
        } else {
            fs.access_path(&target, false).map(|p| (p, dest_entry))
        };
        let (phys_dst, dest_stat) = match destination {
            Ok(v) => v,
            Err(e) => { report.stderr.push_str(&format!("cp: {}\n", copy_error(&e, "realpath", &target))); code = 1; continue; }
        };
        if phys_src == phys_dst || source_stat.identity.is_some() && dest_stat.as_ref().is_some_and(|t| t.identity == source_stat.identity) {
            report.stderr.push_str(&format!("cp: EINVAL: source and destination are the same file '{operand}' -> '{target}'\n"));
            code = 1;
            continue;
        }
        if dest_stat.as_ref().is_some_and(|t| settings.skip_existing(&source_stat, t)) { continue; }
        if no_target_dir && !src_is_dir && dest_stat.as_ref().is_some_and(|t| t.kind == VfsEntryKind::Directory) {
            report.stderr.push_str(&format!("cp: EISDIR: illegal operation on a directory '{target}'\n"));
            code = 1;
            continue;
        }
        if src_is_dir && phys_dst.starts_with(&format!("{}/", phys_src.trim_end_matches('/'))) {
            report.stderr.push_str(&format!(
                "cp: cannot copy a directory, '{src_raw}', into itself, '{disp_target}'\n"
            ));
            code = 1;
            continue;
        }
        if let Err(e) = copy_entry(&src, &target, (src_raw, &disp_target), fs, &mut settings, CopyPass::Publish(&mut report), &mut Default::default()) {
            report.stderr.push_str(&format!("cp: {e}\n"));
            code = 1;
        }
    }
    BuiltinOutcome {
        stdout: report.stdout,
        stderr: report.stderr,
        exit_code: if report.declined { 1 } else { code },
    }
}

fn cmd_mv(
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &std::collections::BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut operands: Vec<String> = Vec::new();
    let mut end_opts = false;
    let mut overwrite: Option<char> = None;
    let mut update_only = false;
    let mut verbose = false;
    let mut no_target_dir = false;
    let mut target_dir: Option<String> = None;
    let mut t_count = 0usize;
    let mut backup_flag = false;
    let mut suffix_flag = false;
    let mut backup_control: Option<String> = None;
    let mut backup_suffix = env
        .get("SIMPLE_BACKUP_SUFFIX")
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| "~".to_string());
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if !end_opts && a == "--" {
            end_opts = true;
            i += 1;
            continue;
        }
        if !end_opts && (a == "-S" || a == "--suffix") && i + 1 < args.len() {
            backup_suffix = args[i + 1].clone();
            suffix_flag = true;
            i += 2;
            continue;
        }
        if !end_opts && (a == "-t" || a == "--target-directory") && i + 1 < args.len() {
            target_dir = Some(args[i + 1].clone());
            t_count += 1;
            i += 2;
            continue;
        }
        if !end_opts && a.starts_with('-') && a != "-" {
            if a == "--force" {
                overwrite = Some('f');
            } else if a == "--interactive" {
                overwrite = Some('i');
            } else if a == "--no-clobber" {
                overwrite = Some('n');
            } else if a == "--update" {
                update_only = true;
            } else if a == "--verbose" {
                verbose = true;
            } else if a == "--no-target-directory" {
                no_target_dir = true;
            } else if let Some(td) = a.strip_prefix("--target-directory=") {
                target_dir = Some(td.to_string());
                t_count += 1;
            } else if let Some(ctrl) = a.strip_prefix("--backup=") {
                backup_control = Some(ctrl.to_string());
            } else if a == "--backup" {
                backup_flag = true;
            } else if let Some(s) = a.strip_prefix("--suffix=") {
                backup_suffix = s.to_string();
                suffix_flag = true;
            } else if !a.starts_with("--") {
                let chars: Vec<char> = a[1..].chars().collect();
                let mut j = 0usize;
                while j < chars.len() {
                    match chars[j] {
                        'f' | 'i' | 'n' => overwrite = Some(chars[j]),
                        'u' => update_only = true,
                        'v' => verbose = true,
                        'T' => no_target_dir = true,
                        'b' => backup_flag = true,
                        't' => {
                            t_count += 1;
                            let rest: String = chars[j + 1..].iter().collect();
                            if !rest.is_empty() {
                                target_dir = Some(rest);
                            } else if i + 1 < args.len() {
                                i += 1;
                                target_dir = Some(args[i].clone());
                            } else {
                                return err_out("mv: option requires an argument -- 't'\n", 2);
                            }
                            break;
                        }
                        'S' => {
                            suffix_flag = true;
                            let rest: String = chars[j + 1..].iter().collect();
                            if !rest.is_empty() {
                                backup_suffix = rest;
                            } else if i + 1 < args.len() {
                                i += 1;
                                backup_suffix = args[i].clone();
                            } else {
                                return err_out("mv: option requires an argument -- 'S'\n", 2);
                            }
                            break;
                        }
                        ch => return err_out(&format!("mv: invalid option -- '{ch}'\n"), 2),
                    }
                    j += 1;
                }
            } else {
                return err_out(&format!("mv: unrecognized option '{a}'\n"), 2);
            }
            i += 1;
            continue;
        }
        operands.push(a.clone());
        i += 1;
    }
    let no_clobber = overwrite == Some('n');
    let interactive = overwrite == Some('i');
    if t_count > 1 {
        return err_out("mv: multiple target directories specified\n", 2);
    }
    let control = backup_control.as_deref().or_else(|| (backup_flag || suffix_flag)
        .then(|| env.get("VERSION_CONTROL").map(String::as_str).unwrap_or("existing")));
    let backup_mode = match parse_backup_control(control) {
        Ok(mode) => mode,
        Err(e) => return err_out(&format!("mv: {e}\n"), 2),
    };
    if backup_mode != BackupMode::None && no_clobber {
        return err_out("mv: options --backup and --no-clobber are mutually exclusive\n", 2);
    }
    if target_dir.is_some() && no_target_dir {
        return err_out("mv: cannot combine --target-directory and --no-target-directory\n", 2);
    }
    if no_target_dir && operands.len() != 2 {
        return err_out("mv: invalid number of operands with -T\n", 2);
    }
    let eff_operands: Vec<String> = if let Some(ref td) = target_dir {
        let mut v = operands;
        v.push(td.clone());
        v
    } else {
        operands
    };
    if eff_operands.len() < 2 {
        return err_out("mv: missing operand\n", 2);
    }
    let absolute = |path: &str| if path.starts_with('/') { path.to_owned() } else { child_disp_path(cwd, path) };
    let dst_raw = eff_operands.last().unwrap();
    let dst_base = absolute(dst_raw);
    let dst_is_dir = if no_target_dir {
        false
    } else {
        match fs.access_path(&dst_base, true).and_then(|p| fs.stat(&p)) {
            Ok(st) => {
                // An implicit destination uses the production memory entry lookup.
                // "." and ".." can resolve to directories without being listed entries.
                let name = dst_base.trim_end_matches('/').rsplit('/').next().unwrap_or_default();
                st.kind == VfsEntryKind::Directory && !(target_dir.is_none()
                    && matches!(name, "." | "..")
                    && fs.indexed_directory_entry(&dst_base) == Some(false))
            }
            Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => false,
            Err(e) if e.starts_with("ENOTDIR:") || e.starts_with("ELOOP:") => {
                if fs.access_path(&dst_base, false).and_then(|p| fs.lstat(&p))
                    .is_ok_and(|st| st.kind == VfsEntryKind::Symlink) {
                    false
                } else {
                    let error = if e.starts_with("ELOOP:") { "ELOOP: too many symbolic links encountered" } else { "ENOTDIR: not a directory" };
                    return err_out(&format!("mv: {error}, lstat '{dst_base}'\n"), 1);
                }
            }
            Err(e) => return err_out(&format!("mv: {}, stat '{dst_base}'\n", e.split_once(", ").map_or(e.as_str(), |(reason, _)| reason)), 1),
        }
    };
    if target_dir.is_some() && !dst_is_dir {
        if !fs.exists(&dst_base) && fs.lstat(&dst_base).is_err() {
            return err_out(
                &format!("mv: failed to access '{dst_raw}': No such file or directory\n"),
                1,
            );
        }
        return err_out(&format!("mv: target '{dst_raw}' is not a directory\n"), 1);
    }
    if eff_operands.len() > 2 && !dst_is_dir {
        return err_out(&format!("mv: target '{dst_raw}' is not a directory\n"), 1);
    }
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut code = 0;
    let mut declined = false;
    let mut stdin_lines = stdin.lines();

    for src_raw in &eff_operands[..eff_operands.len() - 1] {
        let src = absolute(src_raw);
        let name = basename_posix_path(&src);
        let target = if dst_is_dir {
            child_disp_path(&dst_base, &name)
        } else {
            dst_base.clone()
        };
        let disp_target = if dst_is_dir {
            child_disp_path(dst_raw, &name)
        } else {
            dst_raw.clone()
        };
        let mut backup = None;
        if (no_clobber || update_only || interactive || backup_mode != BackupMode::None)
            && let Ok(target_stat) = fs.lstat(&target)
        {
            if no_clobber { continue; }
            let source_stat = match fs.lstat(&src) {
                Ok(st) => st,
                Err(e) => { stderr.push_str(&format!("mv: {e}\n")); code = 1; continue; }
            };
            if src == target || (source_stat.identity.is_some() && source_stat.identity == target_stat.identity) {
                stderr.push_str(&format!("mv: EINVAL: source and destination are the same file '{src}' -> '{target}'\n"));
                code = 1;
                continue;
            }
            if update_only && source_stat.kind != VfsEntryKind::Directory && target_stat.kind != VfsEntryKind::Directory
                && source_stat.mtime_ms <= target_stat.mtime_ms { continue; }
            if interactive {
                stderr.push_str(&format!("mv: overwrite '{disp_target}'? "));
                let ans = stdin_lines.next().unwrap_or("");
                let first = ans.bytes().next().unwrap_or(b'n');
                if first != b'y' && first != b'Y' {
                    declined = true;
                    continue;
                }
            }
            if backup_mode != BackupMode::None {
                let bak = match backup_path(&target, backup_mode, &backup_suffix, fs) { Ok(p) => p, Err(e) => { stderr.push_str(&format!("mv: {e}\n")); code = 1; continue; } };
                if (source_stat.kind == VfsEntryKind::Directory) != (target_stat.kind == VfsEntryKind::Directory) {
                    let e = if source_stat.kind == VfsEntryKind::Directory { "ENOTDIR: not a directory" } else { "EISDIR: illegal operation on a directory" };
                    stderr.push_str(&format!("mv: {e} '{target}'\n")); code = 1; continue;
                }
                if bak == src || bak == target {
                    stderr.push_str(&format!("mv: EINVAL: backup would overwrite source or destination '{bak}'\n"));
                    code = 1; continue;
                }
                if let Ok(st) = fs.lstat(&bak)
                    && (source_stat.identity.is_none() || st.identity.is_none() || source_stat.identity == st.identity) {
                    stderr.push_str(&format!("mv: EINVAL: backup would overwrite source '{bak}'\n")); code = 1; continue;
                }
                if let Err(e) = fs.rename(&target, &bak, false) {
                    stderr.push_str(&format!("mv: {e}, rename '{target}' -> '{bak}'\n")); code = 1; continue;
                }
                backup = Some(bak);
            }
        }
        let result = match fs.rename(&src, &target, no_clobber) {
            Err(e) if !no_clobber && e.starts_with("EXDEV:") => fs.move_across_devices(&src, &target, None),
            Err(e) if no_clobber && e.starts_with("EEXIST:") => continue,
            Err(e) => Err(format!("{e}, rename '{src}' -> '{target}'")),
            ok => ok,
        };
        match result {
            Ok(()) => {
                if verbose {
                    stdout.push_str(&format!("renamed '{src_raw}' -> '{disp_target}'\n"));
                }
            }
            Err(e) => {
                if let Some(bak) = backup && let Err(restore) = fs.rename(&bak, &target, true) {
                    stderr.push_str(&format!("mv: {restore}, restoring '{bak}' -> '{target}'\n"));
                }
                stderr.push_str(&format!("mv: {e}\n"));
                code = 1;
            }
        }
    }
    BuiltinOutcome {
        stdout,
        stderr,
        exit_code: if declined { 1 } else { code },
    }
}
fn cmd_touch(
    args: &[String],
    cwd: &str,
    env: &std::collections::BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut no_create = false;
    let mut only_atime = false;
    let mut only_mtime = false;
    let mut has_r = false;
    let mut has_d = false;
    let mut has_t = false;
    let mut ref_file: Option<String> = None;
    let mut ref_mtime: Option<f64> = None;
    let mut ref_atime: Option<f64> = None;
    let mut operands: Vec<String> = Vec::new();
    let mut ended = false;
    let umask_val = env
        .get("\0umask")
        .and_then(|s| u32::from_str_radix(s, 8).ok())
        .unwrap_or(0o022);
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if ended {
            operands.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if (a == "-r" || a == "--reference") && i + 1 < args.len() {
            has_r = true;
            ref_file = Some(args[i + 1].clone());
            i += 2;
            continue;
        }
        if let Some(rf) = a.strip_prefix("--reference=") {
            has_r = true;
            ref_file = Some(rf.to_string());
            i += 1;
            continue;
        }
        if (a == "-d" || a == "--date") && i + 1 < args.len() {
            has_d = true;
            let Some(ts) = parse_touch_date_checked(&args[i + 1]) else {
                return err_out(
                    &format!("touch: unsupported or invalid date: {}\n", args[i + 1]),
                    1,
                );
            };
            ref_mtime = Some(ts as f64);
            ref_atime = Some(ts as f64);
            i += 2;
            continue;
        }
        if let Some(ds) = a.strip_prefix("--date=") {
            has_d = true;
            let Some(ts) = parse_touch_date_checked(ds) else {
                return err_out(&format!("touch: unsupported or invalid date: {ds}\n"), 1);
            };
            ref_mtime = Some(ts as f64);
            ref_atime = Some(ts as f64);
            i += 1;
            continue;
        }
        if a == "-t" && i + 1 < args.len() {
            has_t = true;
            let Some(ts) = parse_touch_stamp_checked(&args[i + 1]) else {
                return err_out(
                    &format!("touch: invalid date format '{}'\n", args[i + 1]),
                    1,
                );
            };
            ref_mtime = Some(ts as f64);
            ref_atime = Some(ts as f64);
            i += 2;
            continue;
        }
        if a == "--time" || a.starts_with("--time=") {
            let val = if a == "--time" {
                if i + 1 >= args.len() {
                    return err_out("touch: option '--time' requires an argument\n", 2);
                }
                i += 1;
                args[i].as_str()
            } else {
                &a["--time=".len()..]
            };
            match val {
                "atime" | "access" | "use" => only_atime = true,
                "mtime" | "modify" => only_mtime = true,
                _ => {
                    return err_out(
                        &format!("touch: invalid argument '{val}' for '--time'\n"),
                        2,
                    );
                }
            }
            i += 1;
            continue;
        }
        if a == "--no-create" {
            no_create = true;
            i += 1;
            continue;
        }
        if a == "--no-dereference" {
            i += 1;
            continue;
        }
        if a.starts_with("--") {
            return err_out(&format!("touch: unrecognized option '{a}'\n"), 2);
        }
        if a.starts_with('-') && a.len() > 1 {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut j = 0usize;
            while j < chars.len() {
                match chars[j] {
                    'c' => no_create = true,
                    'a' => only_atime = true,
                    'm' => only_mtime = true,
                    'f' | 'h' => {}
                    'r' => {
                        has_r = true;
                        let rest: String = chars[j + 1..].iter().collect();
                        if !rest.is_empty() {
                            ref_file = Some(rest);
                        } else if i + 1 < args.len() {
                            i += 1;
                            ref_file = Some(args[i].clone());
                        } else {
                            return err_out("touch: option requires an argument -- 'r'\n", 2);
                        }
                        break;
                    }
                    'd' => {
                        has_d = true;
                        let rest: String = chars[j + 1..].iter().collect();
                        let val = if !rest.is_empty() {
                            rest
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            return err_out("touch: option requires an argument -- 'd'\n", 2);
                        };
                        let Some(ts) = parse_touch_date_checked(&val) else {
                            return err_out(
                                &format!("touch: unsupported or invalid date: {val}\n"),
                                1,
                            );
                        };
                        ref_mtime = Some(ts as f64);
                        ref_atime = Some(ts as f64);
                        break;
                    }
                    't' => {
                        has_t = true;
                        let rest: String = chars[j + 1..].iter().collect();
                        let val = if !rest.is_empty() {
                            rest
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            return err_out("touch: option requires an argument -- 't'\n", 2);
                        };
                        let Some(ts) = parse_touch_stamp_checked(&val) else {
                            return err_out(
                                &format!("touch: invalid date format '{val}'\n"),
                                1,
                            );
                        };
                        ref_mtime = Some(ts as f64);
                        ref_atime = Some(ts as f64);
                        break;
                    }
                    ch => return err_out(&format!("touch: invalid option -- '{ch}'\n"), 2),
                }
                j += 1;
            }
            i += 1;
            continue;
        }
        operands.push(a.clone());
        i += 1;
    }
    if operands.is_empty() {
        return err_out("touch: missing operand\n", 2);
    }
    if has_t && (has_d || has_r) {
        return err_out("touch: cannot specify times from more than one source\n", 1);
    }
    if let Some(ref rf) = ref_file {
        let rp = resolve_posix_path(cwd, rf);
        match fs.stat(&rp) {
            Ok(st) => {
                if !has_d && !has_t {
                    ref_mtime = Some(st.mtime_ms);
                    ref_atime = Some(st.atime_ms);
                }
            }
            Err(e) => {
                return err_out(
                    &format!("touch: {e}\n"),
                    1,
                );
            }
        }
    }
    let touch_a = !only_mtime || only_atime;
    let touch_m = !only_atime || only_mtime;
    for a in &operands {
        let p = resolve_posix_path(cwd, a);
        if !fs.exists(&p) {
            if !no_create {
                let _ = fs.write_file(&p, &[]);
                let mode = (0o666 & !umask_val) & 0o777;
                let _ = fs.chmod(&p, mode);
            } else { continue; }
        }
        let now = crate::vfs::now_ms();
        if let Err(e) = fs.set_times(&p, touch_a.then(|| ref_atime.unwrap_or(now)), touch_m.then(|| ref_mtime.unwrap_or(now))) {
            return err_out(&format!("touch: {e}\n"), 1);
        }
    }
    ok_out("")
}

fn civil_to_epoch_days(year: i64, month: i64, day: i64) -> i64 {
    let y = year - if month <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m_adj = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * m_adj + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn parse_touch_stamp_checked(s: &str) -> Option<u64> {
    let trimmed = s.trim();
    let (main_part, sec_frac) = match trimmed.split_once('.') {
        Some((m, f)) => {
            if f.len() != 2 || !f.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            (m, f)
        }
        None => (trimmed, ""),
    };
    if !main_part.chars().all(|c| c.is_ascii_digit())
        || (main_part.len() != 12 && main_part.len() != 10 && main_part.len() != 8)
    {
        return None;
    }
    let (y, rest) = if main_part.len() == 12 {
        (main_part[0..4].parse::<i64>().ok()?, &main_part[4..])
    } else if main_part.len() == 10 {
        let yy = main_part[0..2].parse::<i64>().ok()?;
        let year = if yy >= 69 { 1900 + yy } else { 2000 + yy };
        (year, &main_part[2..])
    } else {
        (1970, main_part)
    };
    let m = rest[0..2].parse::<i64>().ok()?;
    let d = rest[2..4].parse::<i64>().ok()?;
    let hh = rest[4..6].parse::<i64>().ok()?;
    let mm = rest[6..8].parse::<i64>().ok()?;
    let ss = if sec_frac.is_empty() {
        0
    } else {
        sec_frac.parse::<i64>().ok()?
    };
    if !(1..=12).contains(&m)
        || !(1..=31).contains(&d)
        || !(0..=23).contains(&hh)
        || !(0..=59).contains(&mm)
        || !(0..=60).contains(&ss)
    {
        return None;
    }
    let days = civil_to_epoch_days(y, m, d);
    let secs = days * 86400 + hh * 3600 + mm * 60 + ss;
    Some(secs.max(0) as u64 * 1000)
}

fn parse_touch_date_checked(s: &str) -> Option<u64> {
    let trimmed = s.trim();
    if let Some(epoch) = trimmed.strip_prefix('@') {
        let secs = epoch.parse::<i64>().ok()?;
        return Some(secs.max(0) as u64 * 1000);
    }
    if let Some(st) = parse_touch_stamp_checked(trimmed) {
        return Some(st);
    }
    let digits: Vec<u64> = trimmed
        .split(|c: char| !c.is_ascii_digit())
        .filter(|p| !p.is_empty())
        .filter_map(|p| p.parse::<u64>().ok())
        .collect();
    if digits.len() >= 3 && digits[0] >= 1970 {
        let y = digits[0] as i64;
        let m = digits.get(1).copied().unwrap_or(1).clamp(1, 12) as i64;
        let d = digits.get(2).copied().unwrap_or(1).clamp(1, 31) as i64;
        let hh = digits.get(3).copied().unwrap_or(0).clamp(0, 23) as i64;
        let mm = digits.get(4).copied().unwrap_or(0).clamp(0, 59) as i64;
        let ss = digits.get(5).copied().unwrap_or(0).clamp(0, 59) as i64;
        let days = civil_to_epoch_days(y, m, d);
        let secs = days * 86400 + hh * 3600 + mm * 60 + ss;
        return Some(secs.max(0) as u64 * 1000);
    }
    None
}

fn cmd_ln(
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &std::collections::BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut force = false;
    let mut interactive = false;
    let mut logical = false;
    let mut symbolic = false;
    let mut relative = false;
    let mut no_deref = false;
    let mut no_target_dir = false;
    let mut target_dir: Option<String> = None;
    let mut verbose = false;
    let mut backup_flag = false;
    let mut suffix_flag = false;
    let mut backup_control: Option<String> = None;
    let mut backup_suffix = env
        .get("SIMPLE_BACKUP_SUFFIX")
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| "~".to_string());
    let mut ended = false;
    let mut operands = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if ended {
            operands.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if (a == "-S" || a == "--suffix") && i + 1 < args.len() {
            backup_suffix = args[i + 1].clone();
            suffix_flag = true;
            i += 2;
            continue;
        }
        if (a == "-t" || a == "--target-directory") && i + 1 < args.len() {
            target_dir = Some(args[i + 1].clone());
            i += 2;
            continue;
        }
        if a.starts_with("--") {
            match a.as_str() {
                "--force" => {
                    force = true;
                    interactive = false;
                }
                "--interactive" => {
                    interactive = true;
                    force = false;
                }
                "--logical" => logical = true,
                "--physical" => logical = false,
                "--symbolic" => symbolic = true,
                "--relative" => relative = true,
                "--no-dereference" => no_deref = true,
                "--no-target-directory" => no_target_dir = true,
                "--verbose" => verbose = true,
                "--backup" => backup_flag = true,
                s if s.starts_with("--backup=") => {
                    backup_control = Some(s["--backup=".len()..].to_string());
                }
                s if s.starts_with("--suffix=") => {
                    backup_suffix = s["--suffix=".len()..].to_string();
                    suffix_flag = true;
                }
                s if s.starts_with("--target-directory=") => {
                    target_dir = Some(s["--target-directory=".len()..].to_string());
                }
                _ => return err_out(&format!("ln: unrecognized option '{a}'\n"), 2),
            }
        } else if a.starts_with('-') && a.len() > 1 {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut j = 0usize;
            while j < chars.len() {
                match chars[j] {
                    'f' => {
                        force = true;
                        interactive = false;
                    }
                    'i' => {
                        interactive = true;
                        force = false;
                    }
                    'L' => logical = true,
                    'P' => logical = false,
                    's' => symbolic = true,
                    'r' => relative = true,
                    'n' | 'h' => no_deref = true,
                    'T' => no_target_dir = true,
                    'v' => verbose = true,
                    'b' => backup_flag = true,
                    't' => {
                        let rest: String = chars[j + 1..].iter().collect();
                        if !rest.is_empty() {
                            target_dir = Some(rest);
                        } else if i + 1 < args.len() {
                            i += 1;
                            target_dir = Some(args[i].clone());
                        }
                        break;
                    }
                    'S' => {
                        suffix_flag = true;
                        let rest: String = chars[j + 1..].iter().collect();
                        if !rest.is_empty() {
                            backup_suffix = rest;
                        } else if i + 1 < args.len() {
                            i += 1;
                            backup_suffix = args[i].clone();
                        }
                        break;
                    }
                    ch => return err_out(&format!("ln: invalid option -- '{ch}'\n"), 2),
                }
                j += 1;
            }
        } else {
            operands.push(a.clone());
        }
        i += 1;
    }
    if relative && !symbolic {
        return err_out("ln: cannot do --relative without --symbolic\n", 2);
    }
    if target_dir.is_some() && no_target_dir {
        return err_out("ln: cannot combine --target-directory and --no-target-directory\n", 2);
    }
    if operands.is_empty() {
        return err_out("ln: missing operand\n", 2);
    }
    if no_target_dir && operands.len() != 2 {
        return err_out("ln: missing destination file operand\n", 2);
    }
    let eff_operands: Vec<String> = if let Some(ref td) = target_dir {
        let mut v = operands;
        v.push(td.clone());
        v
    } else if operands.len() == 1 {
        vec![operands[0].clone(), ".".to_string()]
    } else {
        operands
    };
    let control = backup_control.as_deref().or_else(|| (backup_flag || suffix_flag)
        .then(|| env.get("VERSION_CONTROL").map(String::as_str).unwrap_or("existing")));
    let backup_mode = match parse_backup_control(control) {
        Ok(mode) => mode,
        Err(e) => return err_out(&format!("ln: {e}\n"), 2),
    };

    let last_op = eff_operands.last().unwrap();
    let target_operand = absolute_operand(cwd, last_op);
    let follow_dir = target_dir.is_some() || !no_deref;
    let operation = if symbolic { "symlink" } else { "link" };
    let target_base = match fs.access_path(&target_operand, false) {
        Ok(path) => path,
        Err(e) => {
            let syscall = if e.starts_with("ENOENT:") { operation }
                else if no_target_dir || !follow_dir { "lstat" } else { "stat" };
            return err_out(&format!("ln: {}\n", copy_error(&e, syscall, &target_operand)), 1);
        }
    };
    let directory = if no_target_dir { None } else {
        match fs.inspect_command_entry(&target_operand, follow_dir, if follow_dir { "stat" } else { "lstat" }) {
            Ok((path, st)) if st.kind == VfsEntryKind::Directory => Some(path),
            Ok(_) => None,
            Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => None,
            Err(e) => return err_out(&format!("ln: {}\n", copy_error(&e, if follow_dir { "stat" } else { "lstat" }, &target_operand)), 1),
        }
    };
    if (target_dir.is_some() || eff_operands.len() > 2) && directory.is_none() {
        return err_out(&format!("ln: ENOTDIR: not a directory '{target_operand}'\n"), 1);
    }

    if !symbolic {
        for operand in &eff_operands[..eff_operands.len()-1] {
            let dst = directory.as_ref().map_or_else(|| target_base.clone(), |d| child_disp_path(d, &basename_posix_path(operand)));
            if !fs.supports_hard_links(&dst) { return err_out(&format!("ln: ENOTSUP: operation not supported, ln '{dst}'\n"), 1); }
        }
    }
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut code = 0;
    let mut declined = false;
    let mut stdin_lines = stdin.lines();

    for src_op in &eff_operands[..eff_operands.len() - 1] {
        let base_name = basename_posix_path(src_op);
        let link_path = if let Some(dir) = &directory {
            child_disp_path(dir, &base_name)
        } else {
            target_base.clone()
        };
        let disp_target = if directory.is_some() {
            child_disp_path(last_op, &base_name)
        } else {
            last_op.clone()
        };
        let operand = absolute_operand(cwd, src_op);
        let existing = fs.lstat(&link_path).ok();
        let replacing = existing.is_some() && (force || interactive || backup_mode != BackupMode::None);
        let (src_full, source_stat) = if symbolic { (operand, None) } else {
            let syscall = if logical { "realpath" } else if replacing { "lstat" } else { "link" };
            match fs.inspect_command_entry(&operand, logical, syscall) {
                Ok((path, stat)) => (path, Some(stat)),
                Err(e) => {
                    stderr.push_str(&format!("ln: {}\n", copy_error(&e, syscall, &operand)));
                    code = 1;
                    continue;
                }
            }
        };
        if !symbolic && src_full == link_path {
            stderr.push_str(&format!("ln: EEXIST: file already exists '{link_path}'\n"));
            code = 1;
            continue;
        }
        let relative_target = if relative {
            let target = match canonicalize_posix_path(&src_full, 'm', false, fs) {
                Ok(path) => path,
                Err(e) => { stderr.push_str(&format!("ln: {e}\n")); code = 1; continue; }
            };
            Some(relative_posix_path(&crate::vfs::dirname_posix_path(&link_path), &target))
        } else { None };
        let mut moved_backup = None;
        if let Some(existing) = existing {
            let src_entry = fs.access_path(&src_full, false);
            if (force || interactive || backup_mode != BackupMode::None)
                && src_entry.is_ok_and(|src| fs.access_path(&link_path, false).is_ok_and(|dst| src == dst)) {
                stderr.push_str(&format!(
                    "ln: EEXIST: source and destination are the same file '{link_path}'\n"
                ));
                code = 1;
                continue;
            }
            if !force && !interactive && backup_mode == BackupMode::None {
                if symbolic {
                    stderr.push_str(&format!(
                        "ln: EEXIST: file already exists, symlink '{link_path}'\n"
                    ));
                } else {
                    stderr.push_str(&format!(
                        "ln: EEXIST: file already exists, link '{src_full}' -> '{link_path}'\n"
                    ));
                }
                code = 1;
                continue;
            }
            if existing.kind == VfsEntryKind::Directory {
                stderr.push_str(&format!("ln: EISDIR: illegal operation on a directory '{link_path}'\n"));
                code = 1;
                continue;
            }
            if interactive {
                stderr.push_str(&format!("ln: replace '{disp_target}'? "));
                let ans = stdin_lines.next().unwrap_or("");
                let first = ans.trim_start().chars().next().unwrap_or('n');
                if first != 'y' && first != 'Y' {
                    declined = true;
                    continue;
                }
            }
            if backup_mode != BackupMode::None {
                let backup = match backup_path(&link_path, backup_mode, &backup_suffix, fs) {
                    Ok(p) => p, Err(e) => { stderr.push_str(&format!("ln: {e}\n")); code = 1; continue; }
                };
                if backup == src_full || backup == link_path {
                    stderr.push_str(&format!("ln: EINVAL: backup would overwrite source or destination '{backup}'\n"));
                    code = 1; continue;
                }
                if !symbolic && let Ok(b) = fs.lstat(&backup) {
                    if !source_stat.as_ref().is_some_and(|s| s.identity.is_some() && b.identity.is_some() && s.identity != b.identity) {
                        stderr.push_str(&format!("ln: EINVAL: backup would overwrite source '{backup}'\n"));
                        code = 1; continue;
                    }
                }
                if let Err(e) = fs.rename(&link_path, &backup, false) {
                    stderr.push_str(&format!("ln: {e}, rename '{link_path}' -> '{backup}'\n")); code = 1; continue;
                }
                if fs.lstat(&link_path).is_err() { moved_backup = Some(backup); }
            } else if let Err(e) = unlink_destination(&link_path, fs) {
                stderr.push_str(&format!("ln: {e}\n"));
                code = 1;
                continue;
            }
        }
        let stored_target = relative_target.as_deref().unwrap_or(src_op);
        let result = if symbolic { fs.symlink(stored_target, &link_path) }
            else { fs.hard_link(&src_full, &link_path) };
        if let Err(e) = result {
            if let Some(backup) = moved_backup && let Err(e) = fs.rename(&backup, &link_path, true) {
                stderr.push_str(&format!("ln: {e}, restoring '{backup}' -> '{link_path}'\n"));
            }
            if !symbolic && e.starts_with("EEXIST:") {
                stderr.push_str(&format!("ln: EEXIST: file already exists, link '{src_full}' -> '{link_path}'\n"));
            } else if !symbolic { stderr.push_str(&format!("ln: {}\n", hard_link_error(&e, &src_full, &link_path))); }
            else { stderr.push_str(&format!("ln: {e}\n")); }
            code = 1;
            continue;
        }
        if verbose {
            let arrow = if symbolic { "->" } else { "=>" };
            let shown_target = stored_target;
            stdout.push_str(&format!("'{disp_target}' {arrow} '{shown_target}'\n"));
        }
    }
    BuiltinOutcome {
        stdout,
        stderr,
        exit_code: if declined { 1 } else { code },
    }
}
fn cmd_readlink(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut mode = 'L';
    let mut no_newline = false;
    let mut zero = false;
    let mut verbose_mode = "default";
    let mut ended = false;
    let mut targets = Vec::new();
    for a in args {
        if ended {
            targets.push(a.clone());
            continue;
        }
        if a == "--" {
            ended = true;
            continue;
        }
        match a.as_str() {
            "--canonicalize" => mode = 'f',
            "--canonicalize-existing" => mode = 'e',
            "--canonicalize-missing" => mode = 'm',
            "--no-newline" => no_newline = true,
            "--zero" => zero = true,
            "--verbose" => verbose_mode = "verbose",
            "--quiet" | "--silent" => verbose_mode = "quiet",
            s if s.starts_with('-') && !s.starts_with("--") && s.len() > 1 => {
                for ch in s[1..].chars() {
                    match ch {
                        'f' => mode = 'f',
                        'e' => mode = 'e',
                        'm' => mode = 'm',
                        'n' => no_newline = true,
                        'z' => zero = true,
                        'v' => verbose_mode = "verbose",
                        'q' | 's' => verbose_mode = "quiet",
                        _ => {
                            return err_out(&format!("readlink: invalid option -- '{ch}'\n"), 2);
                        }
                    }
                }
            }
            s if s.starts_with("--") => {
                return err_out(&format!("readlink: unrecognized option '{s}'\n"), 2);
            }
            _ => targets.push(a.clone()),
        }
    }
    if targets.is_empty() {
        return err_out("readlink: missing operand\n", 2);
    }
    let mut out = String::new();
    let mut err_buf = String::new();
    if no_newline && targets.len() > 1 && verbose_mode != "quiet" {
        err_buf.push_str("readlink: ignoring --no-newline with multiple arguments\n");
    }
    let mut exit_code = 0;
    let term = if no_newline && targets.len() == 1 {
        ""
    } else if zero {
        "\0"
    } else {
        "\n"
    };
    for target in &targets {
        if mode == 'L' {
            let p = resolve_posix_path(cwd, target);
            match fs.readlink(&p) {
                Ok(t) => {
                    out.push_str(&t);
                    out.push_str(term);
                }
                _ => {
                    if verbose_mode == "verbose" {
                        if fs.exists(&p) || fs.lstat(&p).is_ok() {
                            err_buf.push_str(&format!(
                                "readlink: EINVAL: invalid argument, readlink '{p}'\n"
                            ));
                        } else {
                            err_buf.push_str(&format!(
                                "readlink: ENOENT: no such file or directory, readlink '{p}'\n"
                            ));
                        }
                    }
                    exit_code = 1;
                }
            }
        } else {
            let raw = if target.starts_with('/') {
                target.clone()
            } else {
                format!("{}/{target}", cwd.trim_end_matches('/'))
            };
            match canonicalize_posix_path(&raw, mode, false, fs) {
                Ok(resolved) => {
                    out.push_str(&resolved);
                    out.push_str(term);
                }
                Err(msg) => {
                    if verbose_mode == "verbose" {
                        err_buf.push_str(&format!("readlink: {msg}\n"));
                    }
                    exit_code = 1;
                }
            }
        }
    }
    BuiltinOutcome {
        stdout: out,
        stderr: err_buf,
        exit_code,
    }
}

pub(super) fn canonicalize_posix_path(
    raw: &str,
    mode: char,
    no_symlinks: bool,
    fs: &dyn SafeBashFs,
) -> Result<String, String> {
    if no_symlinks {
        let lexical = normalize_posix_path(raw);
        if mode == 'e' {
            if !fs.exists(&lexical) {
                return Err(format!("ENOENT: no such file or directory, stat '{lexical}'"));
            }
            let segs: Vec<&str> = lexical.split('/').filter(|s| !s.is_empty()).collect();
            let mut prefix = String::new();
            for seg in segs.iter().take(segs.len().saturating_sub(1)) {
                prefix.push('/');
                prefix.push_str(seg);
                if !fs.is_dir(&prefix) {
                    return Err(format!("ENOTDIR: not a directory, stat '{lexical}'"));
                }
            }
        } else if mode != 'm' {
            let parent = crate::vfs::dirname_posix_path(&lexical);
            if !fs.exists(&parent) {
                return Err(format!("ENOENT: no such file or directory, stat '{parent}'"));
            }
            if !fs.is_dir(&parent) {
                return Err(format!("ENOTDIR: not a directory, stat '{parent}'"));
            }
        }
        return Ok(lexical);
    }

    enum Pending {
        Component(String),
        EndLink(String),
    }
    let mut expanding = std::collections::BTreeSet::new();
    let mut queue: VecDeque<Pending> = raw
        .split('/')
        .filter(|s| !s.is_empty())
        .map(|s| Pending::Component(s.to_string()))
        .collect();
    let mut cur = String::from("/");
    let mut hops = 0usize;
    while let Some(item) = queue.pop_front() {
        let part = match item {
            Pending::Component(part) => part,
            Pending::EndLink(path) => {
                expanding.remove(&path);
                continue;
            }
        };
        if part == "." {
            if mode != 'm' && (!fs.exists(&cur) || !fs.is_dir(&cur)) {
                return Err(format!("ENOENT: no such file or directory, realpath '{raw}'"));
            }
            continue;
        }
        if part == ".." {
            if mode != 'm' && (!fs.exists(&cur) || !fs.is_dir(&cur)) {
                return Err(format!("ENOENT: no such file or directory, realpath '{raw}'"));
            }
            cur = crate::vfs::dirname_posix_path(&cur);
            continue;
        }
        if mode != 'm' {
            if !fs.exists(&cur) {
                return Err(format!("ENOENT: no such file or directory, realpath '{raw}'"));
            }
            if !fs.is_dir(&cur) {
                return Err(format!("ENOTDIR: not a directory, realpath '{raw}'"));
            }
        }
        let next = if cur == "/" {
            format!("/{part}")
        } else {
            format!("{cur}/{part}")
        };
        if let Ok(link_t) = fs.readlink(&next)

        {
            if mode == 'm' {
                if !expanding.insert(next.clone()) {
                    cur = next;
                    continue;
                }
                queue.push_front(Pending::EndLink(next));
            }
            hops += 1;
            if hops > 40 {
                return Err(format!("ELOOP: too many symbolic links encountered '{raw}'"));
            }
            if link_t.starts_with('/') {
                cur = "/".to_string();
            }
            for seg in link_t.split('/').filter(|s| !s.is_empty()).rev() {
                queue.push_front(Pending::Component(seg.to_string()));
            }
            continue;
        }
        if !queue.is_empty() {
            if mode != 'm' {
                if !fs.exists(&next) {
                    return Err(format!("ENOENT: no such file or directory, realpath '{raw}'"));
                }
                if !fs.is_dir(&next) {
                    return Err(format!("ENOTDIR: not a directory, realpath '{raw}'"));
                }
            }
        } else if mode == 'e' && !fs.exists(&next) {
            return Err(format!("ENOENT: no such file or directory, realpath '{raw}'"));
        }
        cur = next;
    }
    if raw != "/" && raw.ends_with('/') && mode != 'm' {
        if mode == 'e' {
            if !fs.exists(&cur) {
                return Err(format!("ENOENT: no such file or directory, realpath '{raw}'"));
            }
            if !fs.is_dir(&cur) {
                return Err(format!("ENOTDIR: not a directory, realpath '{raw}'"));
            }
        } else if fs.exists(&cur) && !fs.is_dir(&cur) {
            return Err(format!("ENOTDIR: not a directory, realpath '{raw}'"));
        }
    }
    Ok(cur)
}

pub(super) fn relative_posix_path(base: &str, target: &str) -> String {
    let b_parts: Vec<&str> = base.split('/').filter(|s| !s.is_empty()).collect();
    let t_parts: Vec<&str> = target.split('/').filter(|s| !s.is_empty()).collect();
    let mut common = 0usize;
    while common < b_parts.len() && common < t_parts.len() && b_parts[common] == t_parts[common] {
        common += 1;
    }
    let mut rel = vec![".."; b_parts.len() - common];
    for &p in &t_parts[common..] {
        rel.push(p);
    }
    if rel.is_empty() {
        ".".to_string()
    } else {
        rel.join("/")
    }
}

fn canonicalize_realpath_operand(
    raw: &str,
    mode: char,
    no_symlinks: bool,
    logical: bool,
    fs: &dyn SafeBashFs,
) -> Result<String, String> {
    if no_symlinks || logical {
        let lexical = normalize_posix_path(raw);
        if mode != 'm' {
            let comps: Vec<&str> = raw.split('/').collect();
            let mut prefix = String::from("/");
            for (idx, comp) in comps.iter().enumerate().skip(1) {
                if comp.is_empty() && idx + 1 < comps.len() {
                    continue;
                }
                if comp.is_empty() || *comp == "." || *comp == ".." {
                    if !comp.is_empty() || mode == 'e' {
                        if !fs.exists(&prefix) {
                            return Err(format!("ENOENT: no such file or directory, stat '{prefix}'"));
                        }
                        if !fs.is_dir(&prefix) {
                            return Err(format!("ENOTDIR: not a directory, stat '{prefix}'"));
                        }
                    } else if fs.exists(&prefix) && !fs.is_dir(&prefix) {
                        return Err(format!("ENOTDIR: not a directory, stat '{prefix}'"));
                    }
                    if comp.is_empty() || *comp == "." {
                        continue;
                    }
                    prefix = crate::vfs::dirname_posix_path(&prefix);
                    continue;
                }
                prefix = if prefix == "/" {
                    format!("/{comp}")
                } else {
                    format!("{prefix}/{comp}")
                };
                if mode == 'e' || idx + 1 < comps.len() {
                    if mode == 'e' && !fs.exists(&prefix) {
                        return Err(format!("ENOENT: no such file or directory, stat '{prefix}'"));
                    }
                    if idx + 1 < comps.len() && fs.exists(&prefix) && !fs.is_dir(&prefix) {
                        return Err(format!("ENOTDIR: not a directory, stat '{prefix}'"));
                    }
                }
            }
            if mode == 'e' && !fs.exists(&lexical) {
                return Err(format!("ENOENT: no such file or directory, stat '{lexical}'"));
            }
        }
        if no_symlinks {
            return Ok(lexical);
        }
        let next_raw = if raw != "/" && raw.ends_with('/') && lexical != "/" {
            format!("{lexical}/")
        } else {
            lexical
        };
        return canonicalize_posix_path(&next_raw, mode, false, fs);
    }
    canonicalize_posix_path(raw, mode, false, fs)
}

fn cmd_realpath(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut rel_to: Option<String> = None;
    let mut rel_base: Option<String> = None;
    let mut mode = 'E';
    let mut no_symlinks = false;
    let mut logical = false;
    let mut quiet = false;
    let mut zero = false;
    let mut ended = false;
    let mut targets = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if ended {
            targets.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--" {
            ended = true;
            i += 1;
        } else if let Some(r) = a.strip_prefix("--relative-to=") {
            rel_to = Some(r.to_string());
            i += 1;
        } else if a == "--relative-to" {
            if i + 1 >= args.len() {
                return err_out("realpath: option '--relative-to' requires an argument\n", 2);
            }
            rel_to = Some(args[i + 1].clone());
            i += 2;
        } else if let Some(r) = a.strip_prefix("--relative-base=") {
            rel_base = Some(r.to_string());
            i += 1;
        } else if a == "--relative-base" {
            if i + 1 >= args.len() {
                return err_out("realpath: option '--relative-base' requires an argument\n", 2);
            }
            rel_base = Some(args[i + 1].clone());
            i += 2;
        } else if a == "--canonicalize" {
            mode = 'E';
            i += 1;
        } else if a == "--canonicalize-existing" {
            mode = 'e';
            i += 1;
        } else if a == "--canonicalize-missing" {
            mode = 'm';
            i += 1;
        } else if a == "--strip" || a == "--no-symlinks" {
            no_symlinks = true;
            i += 1;
        } else if a == "--physical" {
            no_symlinks = false;
            logical = false;
            i += 1;
        } else if a == "--logical" {
            logical = true;
            i += 1;
        } else if a == "--quiet" {
            quiet = true;
            i += 1;
        } else if a == "--zero" {
            zero = true;
            i += 1;
        } else if a.starts_with('-') && !a.starts_with("--") && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    'E' => mode = 'E',
                    'e' => mode = 'e',
                    'm' => mode = 'm',
                    's' => no_symlinks = true,
                    'P' => {
                        no_symlinks = false;
                        logical = false;
                    }
                    'L' => logical = true,
                    'q' => quiet = true,
                    'z' => zero = true,
                    _ => return err_out(&format!("realpath: invalid option -- '{ch}'\n"), 2),
                }
            }
            i += 1;
        } else if a.starts_with("--") {
            return err_out(&format!("realpath: unrecognized option '{a}'\n"), 2);
        } else {
            targets.push(a.clone());
            i += 1;
        }
    }
    if targets.is_empty() {
        return err_out("realpath: missing operand\n", 2);
    }
    let raw_for = |op: &str| {
        if op.starts_with('/') {
            op.to_string()
        } else {
            format!("{}/{op}", cwd.trim_end_matches('/'))
        }
    };
    let base_operand = rel_base.as_deref();
    let to_operand = rel_to.as_deref().or(base_operand);
    let base_resolved = match base_operand {
        Some(b) => match canonicalize_realpath_operand(&raw_for(b), mode, no_symlinks, logical, fs) {
            Ok(r) => Some(r),
            Err(msg) => {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: if quiet {
                        String::new()
                    } else {
                        format!("realpath: {msg}\n")
                    },
                    exit_code: 1,
                };
            }
        },
        None => None,
    };
    let to_resolved = match to_operand {
        Some(t) => match canonicalize_realpath_operand(&raw_for(t), mode, no_symlinks, logical, fs) {
            Ok(r) => Some(r),
            Err(msg) => {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: if quiet {
                        String::new()
                    } else {
                        format!("realpath: {msg}\n")
                    },
                    exit_code: 1,
                };
            }
        },
        None => None,
    };
    let within_base = |base: &str, p: &str| -> bool {
        p == base || base == "/" || p.starts_with(&format!("{}/", base.trim_end_matches('/')))
    };
    let term = if zero { "\0" } else { "\n" };
    let mut out = String::new();
    let mut err_buf = String::new();
    let mut exit_code = 0;
    for a in targets {
        if a.is_empty() {
            if !quiet {
                err_buf.push_str("realpath: '': No such file or directory\n");
            }
            exit_code = 1;
            continue;
        }
        let raw = raw_for(&a);
        let resolved = match canonicalize_realpath_operand(&raw, mode, no_symlinks, logical, fs) {
            Ok(r) => r,
            Err(msg) => {
                if !quiet {
                    err_buf.push_str(&format!("realpath: {msg}\n"));
                }
                exit_code = 1;
                continue;
            }
        };
        let display = if let Some(ref to_path) = to_resolved {
            let use_rel = match base_resolved {
                Some(ref rbase) => within_base(rbase, to_path) && within_base(rbase, &resolved),
                None => true,
            };
            if use_rel {
                relative_posix_path(to_path, &resolved)
            } else {
                resolved
            }
        } else {
            resolved
        };
        out.push_str(&format!("{display}{term}"));
    }
    BuiltinOutcome {
        stdout: out,
        stderr: err_buf,
        exit_code,
    }
}

pub(crate) fn eval_chmod_mode(spec: &str, current: u32, is_dir: bool) -> u32 {
    eval_chmod_mode_checked(spec, current, is_dir, 0o022).unwrap_or(current)
}

fn eval_chmod_mode_checked(
    spec: &str,
    current: u32,
    is_dir: bool,
    umask: u32,
) -> Result<u32, String> {
    if spec.is_empty() {
        return Err(format!("invalid mode: '{spec}'"));
    }
    let (num_op, num_digits) = if let Some(rest) = spec.strip_prefix('+') {
        (Some('+'), rest)
    } else if let Some(rest) = spec.strip_prefix('-') {
        (Some('-'), rest)
    } else if let Some(rest) = spec.strip_prefix('=') {
        (Some('='), rest)
    } else {
        (None, spec)
    };
    if !num_digits.is_empty() && num_digits.chars().all(|c| matches!(c, '0'..='7')) {
        let bits = u32::from_str_radix(num_digits, 8)
            .map_err(|_| format!("invalid mode: '{spec}'"))?;
        if bits > 0o7777 {
            return Err(format!("invalid mode: '{spec}'"));
        }
        let cur = current & 0o7777;
        return Ok(match num_op {
            Some('+') => cur | bits,
            Some('-') => cur & !bits,
            _ => {
                let preserve = if is_dir && num_op.is_none() && num_digits.len() < 5 {
                    cur & 0o6000
                } else {
                    0
                };
                bits | preserve
            }
        });
    }
    let mut mode = current & 0o7777;
    for clause in spec.split(',') {
        if clause.is_empty() {
            return Err(format!("invalid mode: '{spec}'"));
        }
        let mut chars = clause.chars().peekable();
        let mut who = String::new();
        while let Some(&c) = chars.peek() {
            if matches!(c, 'u' | 'g' | 'o' | 'a') {
                who.push(c);
                chars.next();
            } else {
                break;
            }
        }
        if chars.peek().is_none() {
            return Err(format!("invalid mode: '{spec}'"));
        }
        let all = who.is_empty() || who.contains('a');
        let users = (if all || who.contains('u') { 0o4700 } else { 0 })
            | (if all || who.contains('g') { 0o2070 } else { 0 })
            | (if all || who.contains('o') { 0o1007 } else { 0 });
        while let Some(op) = chars.next() {
            if !matches!(op, '+' | '-' | '=') {
                return Err(format!("invalid mode: '{spec}'"));
            }
            let mut perms = String::new();
            while let Some(&p) = chars.peek() {
                if matches!(p, '+' | '-' | '=') {
                    break;
                }
                if matches!(p, 'r' | 'w' | 'x' | 'X' | 's' | 't' | 'u' | 'g' | 'o') {
                    perms.push(p);
                    chars.next();
                } else {
                    return Err(format!("invalid mode: '{spec}'"));
                }
            }
            if perms.len() > 1 && perms.chars().any(|c| matches!(c, 'u' | 'g' | 'o')) {
                return Err(format!("invalid mode: '{spec}'"));
            }
            let mut bits = 0u32;
            if matches!(perms.as_str(), "u" | "g" | "o") {
                let shift = match perms.as_str() {
                    "u" => 6,
                    "g" => 3,
                    _ => 0,
                };
                let copied = (mode >> shift) & 7;
                bits = (copied << 6) | (copied << 3) | copied;
            } else {
                if perms.contains('r') {
                    bits |= 0o444;
                }
                if perms.contains('w') {
                    bits |= 0o222;
                }
                if perms.contains('x')
                    || (perms.contains('X') && (is_dir || (mode & 0o111) != 0))
                {
                    bits |= 0o111;
                }
                if perms.contains('s') {
                    bits |= 0o6000;
                }
                if perms.contains('t') {
                    bits |= 0o1000;
                }
            }
            bits &= users;
            if who.is_empty() {
                bits &= !umask;
            }
            match op {
                '+' => mode |= bits,
                '-' => mode &= !bits,
                '=' => {
                    let preserve = if is_dir && !perms.contains('s') {
                        0o6000
                    } else {
                        0
                    };
                    mode = (mode & !(users & !preserve)) | bits;
                }
                _ => {}
            }
        }
    }
    Ok(mode)
}

fn format_perm_9(perm: u32) -> String {
    let ux = if perm & 0o4000 != 0 {
        if perm & 0o100 != 0 { 's' } else { 'S' }
    } else if perm & 0o100 != 0 {
        'x'
    } else {
        '-'
    };
    let gx = if perm & 0o2000 != 0 {
        if perm & 0o010 != 0 { 's' } else { 'S' }
    } else if perm & 0o010 != 0 {
        'x'
    } else {
        '-'
    };
    let ox = if perm & 0o1000 != 0 {
        if perm & 0o001 != 0 { 't' } else { 'T' }
    } else if perm & 0o001 != 0 {
        'x'
    } else {
        '-'
    };
    format!(
        "{}{}{}{}{}{}{}{}{}",
        if perm & 0o400 != 0 { 'r' } else { '-' },
        if perm & 0o200 != 0 { 'w' } else { '-' },
        ux,
        if perm & 0o040 != 0 { 'r' } else { '-' },
        if perm & 0o020 != 0 { 'w' } else { '-' },
        gx,
        if perm & 0o004 != 0 { 'r' } else { '-' },
        if perm & 0o002 != 0 { 'w' } else { '-' },
        ox,
    )
}

#[allow(clippy::too_many_arguments)]
fn apply_chmod_recursive(
    path: &str,
    disp: &str,
    mode_spec: &str,
    ref_mode: Option<u32>,
    umask: u32,
    recursive: bool,
    verbose: bool,
    changes_only: bool,
    fs: &dyn SafeBashFs,
    stdout: &mut String,
) -> Result<(), String> {
    let st = fs.lstat(path)?;
    let old_mode = st.mode & 0o7777;
    let is_dir = fs.is_dir(path);
    let new_mode = match ref_mode {
        Some(rm) => rm & 0o7777,
        None => eval_chmod_mode_checked(mode_spec, old_mode, is_dir, umask)? & 0o7777,
    };
    fs.chmod(path, new_mode)?;
    if verbose || (changes_only && new_mode != old_mode) {
        let new_str = format_perm_9(new_mode);
        if new_mode == old_mode {
            stdout.push_str(&format!(
                "mode of '{disp}' retained as {new_mode:04o} ({new_str})\n"
            ));
        } else {
            let old_str = format_perm_9(old_mode);
            stdout.push_str(&format!(
                "mode of '{disp}' changed from {old_mode:04o} ({old_str}) to {new_mode:04o} ({new_str})\n"
            ));
        }
    }
    if recursive && is_dir {
        for name in fs.list_dir(path)? {
            let child = child_disp_path(path, &name);
            let child_disp = child_disp_path(disp, &name);
            apply_chmod_recursive(
                &child,
                &child_disp,
                mode_spec,
                ref_mode,
                umask,
                true,
                verbose,
                changes_only,
                fs,
                stdout,
            )?;
        }
    }
    Ok(())
}

fn cmd_chmod(
    args: &[String],
    cwd: &str,
    env: &std::collections::BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut recursive = false;
    let mut verbose = false;
    let mut changes_only = false;
    let mut silent = false;
    let mut ref_file: Option<String> = None;
    let mut mode_options: Vec<String> = Vec::new();
    let mut positional: Vec<String> = Vec::new();
    let mut ended = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if ended {
            positional.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if a == "--preserve-root" || a == "--no-preserve-root" {
            i += 1;
            continue;
        }
        if a == "--recursive" {
            recursive = true;
            i += 1;
            continue;
        }
        if a == "--verbose" {
            verbose = true;
            i += 1;
            continue;
        }
        if a == "--changes" {
            changes_only = true;
            i += 1;
            continue;
        }
        if a == "--silent" || a == "--quiet" {
            silent = true;
            i += 1;
            continue;
        }
        if let Some(rf) = a.strip_prefix("--reference=") {
            ref_file = Some(rf.to_string());
            i += 1;
            continue;
        }
        if a == "--reference" && i + 1 < args.len() {
            ref_file = Some(args[i + 1].clone());
            i += 2;
            continue;
        }
        if a.starts_with('-')
            && a.len() > 1
            && "rwxXstugo01234567".contains(a.chars().nth(1).unwrap_or(' '))
        {
            mode_options.push(a.clone());
            i += 1;
            continue;
        }
        if a.starts_with('-') && !a.starts_with("--") && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    'R' => recursive = true,
                    'v' => verbose = true,
                    'c' => changes_only = true,
                    'f' => silent = true,
                    _ => {}
                }
            }
            i += 1;
            continue;
        }
        positional.push(a.clone());
        i += 1;
    }

    let umask_val = env
        .get("\0umask")
        .and_then(|s| u32::from_str_radix(s, 8).ok())
        .unwrap_or(0o022);

    let (mode_str, ref_mode, targets_slice): (String, Option<u32>, &[String]) =
        if let Some(rf) = ref_file {
            if !mode_options.is_empty() || positional.is_empty() {
                return err_out("chmod: invalid operand combination\n", 1);
            }
            let rp = resolve_posix_path(cwd, &rf);
            match fs.stat(&rp) {
                Ok(s) => (String::new(), Some(s.mode & 0o7777), &positional[..]),
                Err(e) => {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: if silent {
                            String::new()
                        } else {
                            format!("chmod: failed to get attributes of '{rf}': {e}\n")
                        },
                        exit_code: 1,
                    };
                }
            }
        } else if !mode_options.is_empty() {
            if positional.is_empty() {
                return err_out("chmod: missing operand\n", 1);
            }
            (mode_options.join(","), None, &positional[..])
        } else if positional.len() >= 2 {
            (positional[0].clone(), None, &positional[1..])
        } else {
            return err_out("chmod: missing operand\n", 1);
        };

    if ref_mode.is_none()
        && let Err(msg) = eval_chmod_mode_checked(&mode_str, 0o644, false, umask_val)
    {
        return err_out(&format!("chmod: {msg}\n"), 1);
    }

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut code = 0;
    for t in targets_slice {
        let p = resolve_posix_path(cwd, t);
        if let Err(e) = apply_chmod_recursive(
            &p,
            t,
            &mode_str,
            ref_mode,
            umask_val,
            recursive,
            verbose,
            changes_only,
            fs,
            &mut stdout,
        ) {
            if !silent {
                stderr.push_str(&format!("chmod: {e}\n"));
            }
            code = 1;
        }
    }
    BuiltinOutcome {
        stdout,
        stderr,
        exit_code: code,
    }
}

fn epoch_days_to_civil(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    (y + if m <= 2 { 1 } else { 0 }, m, d)
}

// Use the decimal milliseconds reported by stat, before converting to seconds.
// Multiplication in binary floating point can change the last decimal places.
fn stat_seconds(ms: f64) -> (String, String) {
    let text = ms.abs().to_string();
    let (integer, fraction) = text.split_once('.').unwrap_or((&text, ""));
    let padded = format!("{integer:0>4}");
    let (seconds, millis) = padded.split_at(padded.len() - 3);
    (seconds.to_owned(), format!("{millis}{fraction}"))
}

pub(super) fn calendar_instant(ms: f64, nearest: bool) -> Option<(i64, u32)> {
    if !(-8_640_000_000_000_000.0..=8_640_000_000_000_000.0).contains(&ms) { return None; }
    let ns = if ms.fract() == 0.0 { ms as i128 * 1_000_000 } else {
        let (seconds, frac) = stat_seconds(ms);
        let increment = if nearest { frac.as_bytes().get(9).is_some_and(|b| *b >= b'5') }
            else { ms < 0.0 && frac.bytes().skip(9).any(|b| b != b'0') };
        let value = seconds.parse::<i128>().ok()? * 1_000_000_000
            + format!("{:0<9}", &frac[..frac.len().min(9)]).parse::<i128>().ok()?
            + i128::from(increment);
        if ms < 0.0 { -value } else { value }
    };
    Some((ns.div_euclid(1_000_000_000) as i64, ns.rem_euclid(1_000_000_000) as u32))
}

fn format_iso_stat_timestamp(ms: f64) -> Option<String> {
    let (secs, nanos) = calendar_instant(ms, true)?;
    let (y, m, d) = epoch_days_to_civil(secs.div_euclid(86400));
    let rem = secs.rem_euclid(86400);
    let year = if (0..=9999).contains(&y) { format!("{y:04}") } else { format!("{y:+07}") };
    Some(format!("{year}-{m:02}-{d:02} {:02}:{:02}:{:02}.{nanos:09} +0000", rem/3600, rem/60%60, rem%60))
}

fn format_epoch_stat(ms: f64, precision: usize) -> String {
    let (mut seconds, frac) = stat_seconds(ms);
    let count = frac.len().min(precision).min(9);
    let fraction = &frac[..count];
    if ms < 0.0 && fraction.bytes().all(|b| b == b'0') { seconds = (ms / 1000.0).floor().abs().to_string(); }
    let sign = if ms < 0.0 { "-" } else { "" };
    if precision == 0 { format!("{sign}{seconds}") } else { format!("{sign}{seconds}.{fraction:0<precision$}") }
}

fn quote_stat_name(text: &str, style: Option<&str>) -> String {
    if style == Some("literal") {
        text.to_string()
    } else if style != Some("shell-always")
        && text.bytes().any(|b| b < 0x20 || b == 0x7f)
    {
        let mut out = String::from("$'");
        for ch in text.chars() {
            let code = ch as u32;
            if ch == '\\' || ch == '\'' {
                out.push('\\');
                out.push(ch);
            } else if ch == '\n' {
                out.push_str("\\n");
            } else if ch == '\r' {
                out.push_str("\\r");
            } else if ch == '\t' {
                out.push_str("\\t");
            } else if code < 0x20 || code == 0x7f {
                out.push_str(&format!("\\{:03o}", code));
            } else {
                out.push(ch);
            }
        }
        out.push('\'');
        out
    } else {
        format!("'{}'", text.replace('\'', "'\\''"))
    }
}

fn format_stat_field(
    mut text: String,
    code: &str,
    flags: &str,
    width: usize,
    precision: Option<usize>,
    numeric: bool,
    epoch: bool,
) -> Vec<u8> {
    if numeric {
        let nonzero = !text.chars().all(|c| c == '0');
        if !epoch && let Some(prec) = precision {
            text = if prec == 0 && !nonzero {
                String::new()
            } else if text.len() < prec {
                format!("{}{text}", "0".repeat(prec - text.len()))
            } else {
                text
            };
        }
        if flags.contains('#') {
            if code == "a" {
                if !text.starts_with('0') {
                    text = format!("0{text}");
                }
            } else if (code == "f" || code == "D") && nonzero {
                text = format!("0x{text}");
            }
        }
        if epoch && !text.starts_with('-') && (flags.contains('+') || flags.contains(' ')) {
            let pfx = if flags.contains('+') { "+" } else { " " };
            text = format!("{pfx}{text}");
        }
    }
    if epoch && let Some(prec) = precision && prec > 0 {
        if let Some(dot_idx) = text.find('.') {
            let int_width = if width > prec + 2 && !flags.contains('-') {
                width - prec - 1
            } else {
                0
            };
            let mut int_part = format_stat_field(
                text[..dot_idx].to_string(),
                code,
                flags,
                int_width,
                None,
                true,
                false,
            );
            let trail = if int_part.len() < width && width - int_part.len() > 1 {
                (width as isize - int_part.len() as isize - 1 - prec as isize).unsigned_abs()
            } else {
                0
            };
            int_part.extend_from_slice(&text.as_bytes()[dot_idx..]);
            int_part.resize(int_part.len() + trail, b' ');
            return int_part;
        }
    }
    let mut sliced = text.into_bytes();
    if !numeric && let Some(prec) = precision { sliced.truncate(prec); }
    let pad = width.saturating_sub(sliced.len());
    if pad == 0 { return sliced; }
    if flags.contains('-') {
        sliced.resize(width, b' ');
        return sliced;
    }
    if numeric && flags.contains('0') && (epoch || precision.is_none()) {
        let prefix = if sliced.starts_with(b"0x") { 2 } else { usize::from(matches!(sliced.first(), Some(b'+' | b'-' | b' '))) };
        sliced.splice(prefix..prefix, std::iter::repeat_n(b'0', pad));
    } else {
        sliced.splice(..0, std::iter::repeat_n(b' ', pad));
    }
    sliced
}

fn cmd_stat(
    args: &[String],
    cwd: &str,
    env: &std::collections::BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut fmt_spec = None;
    let mut is_printf = false;
    let mut is_bsd = false;
    let mut filesystem = false;
    let mut terse = false;
    let mut deref = false;
    let mut ended = false;
    let mut targets = Vec::new();
    let mut operands = args.iter().map(String::as_str).peekable();
    while let Some(a) = operands.next() {
        if ended || a == "-" || !a.starts_with('-') {
            targets.push(a.to_owned());
        } else if a == "--" {
            ended = true;
        } else if a == "--dereference" {
            deref = true;
        } else if a == "--file-system" {
            filesystem = true;
        } else if matches!(a, "--cached=never" | "--cached=always" | "--cached=default") {
            continue;
        } else if a == "--terse" {
            terse = true;
        } else if a.starts_with("--") {
            let (option, inline) = a.split_once('=').map_or((a, None), |(o, v)| (o, Some(v)));
            if !matches!(option, "--format" | "--printf") { return err_out(&format!("stat: unrecognized option '{a}'\n"), 1); }
            let Some(value) = inline.or_else(|| operands.next()) else { return err_out(&format!("stat: missing format for '{a}'\n"), 1); };
            fmt_spec = Some(value);
            is_printf = option == "--printf";
            is_bsd = false;
        } else {
            let mut flags = a[1..].chars();
            while let Some(flag) = flags.next() {
                match flag {
                    'L' => deref = true,
                    't' => terse = true,
                    'c' => {
                        let rest = flags.as_str();
                        fmt_spec = if rest.is_empty() { operands.next() } else { Some(rest) };
                        if fmt_spec.is_none() { return err_out("stat: missing format for '-c'\n", 1); }
                        is_printf = false;
                        is_bsd = false;
                        break;
                    }
                    'f' if flags.as_str().is_empty() && operands.len() >= 2
                        && operands.peek().is_some_and(|v| v.contains('%') && !v.starts_with("-c") && !v.starts_with("--format=") && !v.starts_with("--printf=")) => {
                        fmt_spec = operands.next();
                        is_bsd = true;
                        filesystem = false;
                        is_printf = false;
                    }
                    'f' => filesystem = true,
                    _ => return err_out(&format!("stat: unrecognized option '{a}'\n"), 1),
                }
            }
        }
    }
    if targets.is_empty() {
        return err_out("stat: missing operand\n", 1);
    }

    let terse = terse && fmt_spec.is_none();
    let limits = fs.shell_limits();
    let limit = limits.max_output_bytes.min(limits.max_memory_bytes).min(isize::MAX as usize);
    let quoting_style = env.get("QUOTING_STYLE").map(|s| s.as_str());
    let mut out = Vec::new();
    let mut stderr = String::new();
    let mut code = 0;

    'operand: for t in targets {
        let path = absolute_operand(cwd, &t);
        let follow = deref || filesystem;
        let syscall = if follow { "stat" } else { "lstat" };
        match fs.inspect_command_entry(&path, follow, syscall) {
            Ok((p, st)) => {
                let perm = st.mode & 0o7777;
                let is_char_dev = st.kind == VfsEntryKind::File && (st.mode & 0o170000) == 0o020000;
                let ftype = match st.kind {
                    VfsEntryKind::File => {
                        if is_char_dev {
                            "character special file"
                        } else if st.size == 0 {
                            "regular empty file"
                        } else {
                            "regular file"
                        }
                    }
                    VfsEntryKind::Directory => "directory",
                    VfsEntryKind::Symlink => "symbolic link",
                };
                let type_ch = match st.kind {
                    VfsEntryKind::Directory => 'd',
                    VfsEntryKind::Symlink => 'l',
                    VfsEntryKind::File => {
                        if is_char_dev {
                            'c'
                        } else {
                            '-'
                        }
                    }
                };
                let sym_perm = format!("{type_ch}{}", format_perm_9(perm));
                let raw_mode = match st.kind {
                    VfsEntryKind::Directory => 0o040000 | perm,
                    VfsEntryKind::Symlink => 0o120000 | perm,
                    VfsEntryKind::File => {
                        if is_char_dev {
                            0o020000 | perm
                        } else {
                            0o100000 | perm
                        }
                    }
                };
                if filesystem && terse {
                    stderr.push_str("stat: ENOTSUP: filesystem terse stat is unsupported\n");
                    code = 1;
                    continue;
                }
                let spec = fmt_spec.unwrap_or(if terse {
                    "%n %s %b %f %u %g %D %i %h %t %T %X %Y %Z %W %o"
                } else if filesystem {
                    "  File: %n\n  Type: %T"
                } else {
                    "  File: %N\n  Size: %s\tType: %F\n  Mode: %a (%A)\nAccess: %x\nModify: %y\nChange: %z\n Birth: %w"
                });

                let bytes = spec.as_bytes();
                let mut idx = 0usize;
                let mut rendered = Vec::new();
                let error = loop {
                    if rendered.len() > limit.saturating_sub(out.len()) {
                        break Some("EFBIG: stat format output limit exceeded".into());
                    }
                    if idx == bytes.len() {
                        if !is_printf && rendered.len() == limit.saturating_sub(out.len()) {
                            break Some("EFBIG: metadata output limit exceeded".into());
                        }
                        break None;
                    }
                    if is_printf && bytes[idx] == b'\\' {
                        let next_ch = bytes.get(idx + 1).copied().unwrap_or(0) as char;
                        let named = match next_ch {
                            'a' => Some('\x07'),
                            'b' => Some('\x08'),
                            'e' => Some('\x1b'),
                            'f' => Some('\x0c'),
                            'n' => Some('\n'),
                            'r' => Some('\r'),
                            't' => Some('\t'),
                            'v' => Some('\x0b'),
                            '\\' => Some('\\'),
                            '"' => Some('"'),
                            _ => None,
                        };
                        if let Some(ch) = named {
                            rendered.push(ch as u8);
                            idx += 2;
                            continue;
                        }
                        let radix = if next_ch == 'x' { 16u32 } else { 8u32 };
                        let start = idx + if radix == 16 { 2 } else { 1 };
                        let end = bytes.len().min(start + if radix == 16 { 2 } else { 3 });
                        let mut off = start;
                        let mut val = 0u32;
                        while off < end {
                            let c = bytes[off] as char;
                            if let Some(d) = c.to_digit(radix) {
                                val = val * radix + d;
                                off += 1;
                            } else {
                                break;
                            }
                        }
                        if off == start {
                            rendered.push(b'\\');
                            idx += 1;
                        } else {
                            rendered.push(val as u8);
                            idx = off;
                        }
                        continue;
                    }
                    if bytes[idx] != b'%' {
                        let ch = spec[idx..].chars().next().unwrap();
                        rendered.extend_from_slice(&bytes[idx..idx + ch.len_utf8()]);
                        idx += ch.len_utf8();
                        continue;
                    }
                    let mut p_idx = idx + 1;
                    let flags_start = p_idx;
                    while p_idx < bytes.len() && b"-+ #0".contains(&bytes[p_idx]) {
                        p_idx += 1;
                    }
                    let flags = &spec[flags_start..p_idx];
                    let width_start = p_idx;
                    while p_idx < bytes.len() && bytes[p_idx].is_ascii_digit() {
                        p_idx += 1;
                    }
                    let width_str = &spec[width_start..p_idx];
                    let mut prec_str: Option<&str> = None;
                    if p_idx < bytes.len() && bytes[p_idx] == b'.' {
                        p_idx += 1;
                        let ps = p_idx;
                        while p_idx < bytes.len() && bytes[p_idx].is_ascii_digit() {
                            p_idx += 1;
                        }
                        prec_str = Some(&spec[ps..p_idx]);
                    }
                    let Some(ch) = spec[p_idx..].chars().next() else {
                        break Some("invalid stat format directive".into());
                    };
                    let single = &spec[p_idx..p_idx + ch.len_utf8()];
                    let (dir_code, consumed_code) = if is_bsd {
                        let rem = &spec[p_idx..];
                        if rem.starts_with("Lp") {
                            ("a", 2usize)
                        } else if rem.starts_with("Sp") {
                            ("A", 2)
                        } else if rem.starts_with("Su") {
                            ("U", 2)
                        } else if rem.starts_with("Sg") {
                            ("G", 2)
                        } else if rem.starts_with("HT") {
                            ("bsdType", 2)
                        } else {
                            let mapped = match single {
                                "z" => "s",
                                "N" => "n",
                                "m" => "Y",
                                "a" => "X",
                                "c" => "Z",
                                "B" => "W",
                                "u" => "u",
                                "g" => "g",
                                "i" => "i",
                                "l" => "h",
                                "Y" => "bsdTarget",
                                "%" => "%",
                                _ => {
                                    let reported = if ch.len_utf16() == 1 { ch } else { char::REPLACEMENT_CHARACTER };
                                    break Some(format!("unsupported BSD stat format: %{reported}"));
                                }
                            };
                            (mapped, 1)
                        }
                    } else {
                        if ch != '%' && !ch.is_ascii_alphabetic() { break Some("invalid stat format directive".into()); }
                        (single, 1usize)
                    };
                    let start = idx;
                    idx = p_idx + consumed_code;

                    let epoch_code = !filesystem && matches!(dir_code, "X" | "Y" | "Z" | "W");
                    let width = if width_str.is_empty() { 0 } else { width_str.parse::<usize>().unwrap_or(usize::MAX) };
                    if width > limit { break Some("EFBIG: stat format width limit exceeded".into()); }
                    let precision = prec_str.map(|ps| {
                        if ps.is_empty() {
                            if epoch_code { 9 } else { 0 }
                        } else {
                            ps.parse::<usize>().unwrap_or(usize::MAX)
                        }
                    });

                    if precision.is_some_and(|n| n > limit) { break Some("EFBIG: stat format precision limit exceeded".into()); }
                    if dir_code == "%" && idx - start != 2 { break Some("invalid stat format directive".into()); }

                    let mut link_text: Option<String> = None;
                    let mut numeric = false;
                    if filesystem && !matches!(dir_code, "%" | "n" | "T") { break Some(format!("ENOTSUP: unsupported filesystem stat format: %{dir_code}")); }
                    let val_text = match dir_code {
                        "X" | "Y" | "Z" | "W" | "x" | "y" | "z" | "w" => {
                            let ms = match dir_code {
                                "X" | "x" => Some(st.atime_ms),
                                "Y" | "y" => Some(st.mtime_ms),
                                "Z" | "z" => st.ctime_ms,
                                _ => st.birthtime_ms,
                            };
                            match ms {
                                Some(ms) if epoch_code => {
                                    numeric = true;
                                    format_epoch_stat(ms, precision.unwrap_or(0))
                                }
                                Some(ms) => match format_iso_stat_timestamp(ms) {
                                    Some(value) => value,
                                    None => break Some("EIO: invalid filesystem timestamp".into()),
                                },
                                None if dir_code == "w" => "-".into(),
                                None if terse => "?".into(),
                                None => break Some(format!("ENOTSUP: filesystem does not expose {dir_code}, stat")),
                            }
                        }
                        "bsdType" if is_char_dev => "Character Device".into(),
                        "bsdType" => match st.kind {
                            VfsEntryKind::Directory => "Directory".to_string(),
                            VfsEntryKind::Symlink => "Symbolic Link".to_string(),
                            VfsEntryKind::File => "Regular File".to_string(),
                        },
                        "bsdTarget" => {
                            if st.kind == VfsEntryKind::Symlink {
                                fs.readlink(&p).unwrap_or_default()
                            } else {
                                String::new()
                            }
                        }
                        "n" => t.clone(),
                        "N" => {
                            if st.kind == VfsEntryKind::Symlink
                                && let Ok(lt) = fs.readlink(&p)
                            {
                                link_text = Some(quote_stat_name(&lt, quoting_style));
                            }
                            quote_stat_name(&t, quoting_style)
                        }
                        "%" => "%".to_string(),
                        "A" => sym_perm.clone(),
                        "a" => {
                            numeric = true;
                            format!("{perm:o}")
                        }
                        "f" => {
                            numeric = true;
                            format!("{raw_mode:x}")
                        }
                        "s" => {
                            numeric = true;
                            st.size.to_string()
                        }
                        "F" => ftype.to_string(),
                        "T" if filesystem => match st.filesystem_type {
                            Some(name) => name.to_owned(),
                            None => break Some("ENOTSUP: filesystem does not expose its type, stat".into()),
                        },
                        "U" | "G" => {
                            let (id, field) = if dir_code == "U" { (st.uid, "u") } else { (st.gid, "g") };
                            match id {
                                Some(0) => "root".to_owned(),
                                Some(id) => id.to_string(),
                                None => break Some(format!("ENOTSUP: filesystem does not expose {field}, stat")),
                            }
                        }
                        "b" | "o" | "i" | "h" | "d" | "D" | "t" | "T" | "u" | "g" => {
                            let value = match dir_code {
                                "b" => st.allocated_bytes.map(|v| v.div_ceil(512)),
                                "o" => st.io_block_size,
                                "u" => st.uid.map(u64::from),
                                "g" => st.gid.map(u64::from),
                                "h" => st.nlink.map(|n| n as u64),
                                "i" => st.identity.as_ref().map(|id| match id {
                                    EntryIdentity::Unix(_, ino) | EntryIdentity::Memory(_, ino) | EntryIdentity::OverlayDirectory { ino, .. } => *ino,
                                }),
                                "d" | "D" => st.identity.as_ref().map(|id| match id { EntryIdentity::Unix(dev, _) => *dev, _ => 0 }),
                                _ => None,
                            };
                            match value {
                                Some(value) => {
                                    numeric = true;
                                    if dir_code == "D" { format!("{value:x}") } else { value.to_string() }
                                }
                                None if terse => "?".into(),
                                None => break Some(format!("ENOTSUP: filesystem does not expose {dir_code}, stat")),
                            }
                        }
                        "B" => {
                            numeric = true;
                            "512".to_string()
                        }
                        "m" => "/".to_string(),
                        other => break Some(format!("ENOTSUP: unsupported stat format: %{other}")),
                    };

                    rendered.extend(format_stat_field(
                        val_text,
                        dir_code,
                        flags,
                        width,
                        precision,
                        numeric,
                        epoch_code,
                    ));
                    if let Some(lt) = link_text {
                        rendered.extend_from_slice(b" -> ");
                        rendered.extend(format_stat_field(
                            lt,
                            dir_code,
                            flags,
                            width,
                            precision,
                            false,
                            false,
                        ));
                    }
                };
                if let Some(reason) = error {
                    stderr.push_str(&format!("stat: {reason}\n"));
                    code = 1;
                    if reason.starts_with("EFBIG:") { break 'operand; }
                    continue;
                }
                out.extend(rendered);
                if !is_printf {
                    out.push(b'\n');
                }
            }
            Err(e) => {
                let reason = if path.is_empty() { "ENOENT: no such file or directory ''".to_owned() }
                    else if e.starts_with("ENOTDIR: not a directory '") || e.contains(", resolve '")
                        || (e.starts_with("EACCES:") || e.starts_with("ENAMETOOLONG:")) && e.contains(", lstat '")
                        || e.ends_with(&format!(", {syscall} '{path}'")) { e }
                    else { copy_error(&e, syscall, &path) };
                stderr.push_str(&format!("stat: {reason}\n"));
                code = 1;
            }
        }
    }
    BuiltinOutcome {
        stdout: crate::vfs::bytes_to_stream_string(&out),
        stderr,
        exit_code: code,
    }
}

fn parse_du_size(s: &str, allow_neg: bool) -> Option<(i64, String)> {
    let trimmed = s.trim();
    let (neg, rest) = if allow_neg && let Some(r) = trimmed.strip_prefix('-') {
        (true, r)
    } else if allow_neg && let Some(r) = trimmed.strip_prefix('+') {
        (false, r)
    } else {
        (false, trimmed)
    };
    let mut split_idx = 0usize;
    for (idx, ch) in rest.char_indices() {
        if ch.is_ascii_digit() {
            split_idx = idx + ch.len_utf8();
        } else {
            break;
        }
    }
    let digits = &rest[..split_idx];
    let unit_str = &rest[split_idx..];
    if digits.is_empty() && unit_str.is_empty() {
        return None;
    }
    let mult: i64 = if digits.is_empty() {
        1
    } else {
        digits.parse().ok()?
    };
    let (power, base, sfx) = if unit_str.is_empty() {
        (0u32, 1024i64, String::new())
    } else {
        let mut chars = unit_str.chars();
        let letter = chars.next()?;
        let tail = chars.as_str();
        let p = match letter.to_ascii_uppercase() {
            'K' => 1u32,
            'M' => 2,
            'G' => 3,
            'T' => 4,
            'P' => 5,
            'E' => 6,
            _ => return None,
        };
        let b = match tail {
            "" | "iB" => 1024i64,
            "B" => 1000i64,
            _ => return None,
        };
        let mut suffix = String::new();
        if digits.is_empty() {
            let up = letter.to_ascii_uppercase();
            if tail == "B" {
                suffix = format!("{}B", if up == 'K' { 'k' } else { up });
            } else if tail == "iB" {
                suffix = format!("{up}iB");
            } else {
                suffix.push(up);
            }
        }
        (p, b, suffix)
    };
    let unit_val = mult.checked_mul(base.checked_pow(power)?)?;
    let signed = if neg { -unit_val } else { unit_val };
    Some((signed, sfx))
}

fn format_du_amount(
    bytes: u64,
    inodes: bool,
    apparent: bool,
    block_unit: Option<(u64, String)>,
    human_base: Option<u64>,
) -> String {
    if inodes {
        return bytes.to_string();
    }
    if let Some(base) = human_base {
        let b = bytes;
        let mut unit = 1u64;
        let mut exp = 0usize;
        while b >= unit.saturating_mul(base) && exp < 6 {
            unit *= base;
            exp += 1;
        }
        if exp == 0 {
            return b.to_string();
        }
        if b.div_ceil(unit) >= base && exp < 6 {
            unit *= base;
            exp += 1;
        }
        let tenths = (b * 10).div_ceil(unit);
        let num_str = if tenths < 100 {
            format!("{}.{}", tenths / 10, tenths % 10)
        } else {
            b.div_ceil(unit).to_string()
        };
        let suffixes = if base == 1000 {
            b"kMGTPE"
        } else {
            b"KMGTPE"
        };
        return format!("{num_str}{}", suffixes[exp - 1] as char);
    }
    if let Some((unit, ref sfx)) = block_unit {
        let u = unit.max(1);
        return format!("{}{sfx}", bytes.div_ceil(u));
    }
    if apparent {
        bytes.to_string()
    } else {
        bytes.div_ceil(1024).max(1).to_string()
    }
}

fn du_matches_excludes(path_or_disp: &str, excludes: &[String]) -> bool {
    if excludes.is_empty() {
        return false;
    }
    let base = basename_posix_path(path_or_disp);
    for ex in excludes {
        if crate::shell::expand::glob_match(ex, &base)
            || crate::shell::expand::glob_match(ex, path_or_disp)
        {
            return true;
        }
        for (idx, ch) in path_or_disp.char_indices() {
            if ch == '/' && idx + 1 < path_or_disp.len() {
                if crate::shell::expand::glob_match(ex, &path_or_disp[idx + 1..]) {
                    return true;
                }
            }
        }
    }
    false
}

fn cmd_du(
    args: &[String],
    cwd: &str,
    env: &std::collections::BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut apparent = false;
    let mut all = false;
    let mut summary_only = false;
    let mut show_total = false;
    let mut inodes = false;
    let mut separate = false;
    let mut count_links = false;
    let mut one_fs = false;
    let mut deref_mode = 'P';
    let mut null_output = false;
    let mut max_depth: Option<usize> = None;
    let mut block_unit: Option<(u64, String)> = None;
    let mut human_base: Option<u64> = None;
    let mut threshold: Option<i64> = None;
    let mut excludes: Vec<String> = Vec::new();
    let mut exclude_files: Vec<String> = Vec::new();
    let mut targets: Vec<String> = Vec::new();
    let mut ended = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if ended || a == "-" || !a.starts_with('-') {
            targets.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--help" {
            return ok_out(concat!(
                "Usage: du [OPTION]... [--] [FILE]...\n",
                "Report provider allocation; unknown allocation is an error, never logical size.\n",
                "  -a, --all                 report files as well as directories\n",
                "  -s, --summarize           report each operand only\n",
                "  -c, --total               report a complete grand total\n",
                "  -h, --human-readable      upward-rounded base-1024 units\n",
                "      --si                 upward-rounded base-1000 units\n",
                "  -k / -m                  report 1024 / 1048576 byte units\n",
                "  -B, --block-size=SIZE     positive integer with optional K/M/G/T/P suffix\n",
                "  -b, --bytes               apparent size in bytes\n",
                "      --apparent-size      file/link lengths, zero directory contribution\n",
                "  -d, --max-depth=N         reporting depth only; traversal still bounded\n",
                "  -l, --count-links         count every file and directory alias\n",
                "  -0, --null                terminate records with NUL instead of newline\n",
                "      --inodes             count entries instead of bytes\n",
                "      --exclude=PATTERN    exclude matching paths\n",
                "  -X, --exclude-from=FILE   read newline-separated exclusion patterns\n",
                "  -D, -H, --dereference-args follow operand symlinks\n",
                "  -L, --dereference         follow all symlinks\n",
                "  -P, --no-dereference      count symlinks themselves (default)\n",
                "  -S, --separate-dirs       omit subdirectory usage from directory rows\n",
                "  -t, --threshold=SIZE      report sizes >= SIZE, or <= abs(negative SIZE)\n",
                "  -x, --one-file-system     skip directories on other devices\n",
                "No mutation calls by this command; content reads only for exclusion files.\n",
                "Incomplete totals are suppressed. Unknown identities count independently.\n",
                "Traversal and output limits apply; adapters may have their own side effects.\n",
            ));
        }
        if a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if let Some(ex) = a.strip_prefix("--exclude=") {
            excludes.push(ex.to_string());
            i += 1;
        } else if a == "--exclude" && i + 1 < args.len() {
            excludes.push(args[i + 1].clone());
            i += 2;
        } else if let Some(xf) = a.strip_prefix("--exclude-from=") {
            exclude_files.push(xf.to_string());
            i += 1;
        } else if (a == "-X" || a == "--exclude-from") && i + 1 < args.len() {
            exclude_files.push(args[i + 1].clone());
            i += 2;
        } else if let Some(d) = a.strip_prefix("--max-depth=") {
            match d.parse::<usize>() {
                Ok(n) => max_depth = Some(n),
                Err(_) => return err_out(&format!("du: invalid maximum depth '{d}'\n"), 1),
            }
            i += 1;
        } else if (a == "-d" || a == "--max-depth") && i + 1 < args.len() {
            let d = &args[i + 1];
            match d.parse::<usize>() {
                Ok(n) => max_depth = Some(n),
                Err(_) => return err_out(&format!("du: invalid maximum depth '{d}'\n"), 1),
            }
            i += 2;
        } else if let Some(bs) = a.strip_prefix("--block-size=") {
            if let Some((u, sfx)) = parse_du_size(bs, false) {
                block_unit = Some((u.max(1) as u64, sfx));
                human_base = None;
            }
            i += 1;
        } else if (a == "-B" || a == "--block-size") && i + 1 < args.len() {
            if let Some((u, sfx)) = parse_du_size(&args[i + 1], false) {
                block_unit = Some((u.max(1) as u64, sfx));
                human_base = None;
            }
            i += 2;
        } else if let Some(th) = a.strip_prefix("--threshold=") {
            threshold = parse_du_size(th, true).map(|(v, _)| v);
            i += 1;
        } else if (a == "-t" || a == "--threshold") && i + 1 < args.len() {
            threshold = parse_du_size(&args[i + 1], true).map(|(v, _)| v);
            i += 2;
        } else if a == "--all" {
            all = true;
            i += 1;
        } else if a == "--summarize" {
            summary_only = true;
            i += 1;
        } else if a == "--total" {
            show_total = true;
            i += 1;
        } else if a == "--bytes" {
            apparent = true;
            block_unit = Some((1, String::new()));
            human_base = None;
            i += 1;
        } else if a == "--apparent-size" {
            apparent = true;
            i += 1;
        } else if a == "--one-file-system" {
            one_fs = true;
            i += 1;
        } else if a == "--count-links" {
            count_links = true;
            i += 1;
        } else if a == "--dereference" {
            deref_mode = 'L';
            i += 1;
        } else if a == "--dereference-args" {
            deref_mode = 'H';
            i += 1;
        } else if a == "--no-dereference" {
            deref_mode = 'P';
            i += 1;
        } else if a == "--human-readable" {
            human_base = Some(1024);
            i += 1;
        } else if a == "--si" {
            human_base = Some(1000);
            i += 1;
        } else if a == "--inodes" {
            inodes = true;
            i += 1;
        } else if a == "--separate-dirs" {
            separate = true;
            i += 1;
        } else if a == "--null" {
            null_output = true;
            i += 1;
        } else if !a.starts_with("--") {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut j = 0usize;
            while j < chars.len() {
                match chars[j] {
                    'a' => all = true,
                    's' => summary_only = true,
                    'x' => one_fs = true,
                    'c' => show_total = true,
                    'l' => count_links = true,
                    'L' => deref_mode = 'L',
                    'H' | 'D' => deref_mode = 'H',
                    'P' => deref_mode = 'P',
                    'b' => {
                        apparent = true;
                        block_unit = Some((1, String::new()));
                        human_base = None;
                    }
                    'k' => {
                        block_unit = Some((1024, String::new()));
                        human_base = None;
                    }
                    'm' => {
                        block_unit = Some((1_048_576, String::new()));
                        human_base = None;
                    }
                    'h' => human_base = Some(1024),
                    'S' => separate = true,
                    '0' => null_output = true,
                    'd' => {
                        let rest: String = chars[j + 1..].iter().collect();
                        if !rest.is_empty() {
                            match rest.parse::<usize>() {
                                Ok(n) => max_depth = Some(n),
                                Err(_) => {
                                    return err_out(
                                        &format!("du: invalid maximum depth '{rest}'\n"),
                                        1,
                                    );
                                }
                            }
                        } else if i + 1 < args.len() {
                            i += 1;
                            let d = &args[i];
                            match d.parse::<usize>() {
                                Ok(n) => max_depth = Some(n),
                                Err(_) => {
                                    return err_out(
                                        &format!("du: invalid maximum depth '{d}'\n"),
                                        1,
                                    );
                                }
                            }
                        } else {
                            return err_out("du: option requires an argument -- 'd'\n", 1);
                        }
                        break;
                    }
                    'B' => {
                        let rest: String = chars[j + 1..].iter().collect();
                        let val = if !rest.is_empty() {
                            rest
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            String::new()
                        };
                        if let Some((u, sfx)) = parse_du_size(&val, false) {
                            block_unit = Some((u.max(1) as u64, sfx));
                            human_base = None;
                        }
                        break;
                    }
                    't' => {
                        let rest: String = chars[j + 1..].iter().collect();
                        let val = if !rest.is_empty() {
                            rest
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            String::new()
                        };
                        threshold = parse_du_size(&val, true).map(|(v, _)| v);
                        break;
                    }
                    'X' => {
                        let rest: String = chars[j + 1..].iter().collect();
                        if !rest.is_empty() {
                            exclude_files.push(rest);
                        } else if i + 1 < args.len() {
                            i += 1;
                            exclude_files.push(args[i].clone());
                        }
                        break;
                    }
                    _ => {}
                }
                j += 1;
            }
            i += 1;
        } else {
            i += 1;
        }
    }

    if all && summary_only {
        return err_out("du: cannot both summarize and show all entries\n", 1);
    }
    if summary_only && max_depth.is_some() && max_depth != Some(0) {
        return err_out("du: warning: summarizing conflicts with --max-depth\n", 1);
    }
    if block_unit.is_none() && human_base.is_none() {
        let default_unit = if env.contains_key("POSIXLY_CORRECT") {
            (512u64, String::new())
        } else {
            (1024u64, String::new())
        };
        let mut selected_env: Option<&str> = None;
        for key in ["DU_BLOCK_SIZE", "BLOCK_SIZE", "BLOCKSIZE"] {
            if let Some(v) = env.get(key) {
                selected_env = Some(v.as_str());
                break;
            }
        }
        if let Some(v) = selected_env {
            if v == "human-readable" {
                human_base = Some(1024);
            } else if v == "si" {
                human_base = Some(1000);
            } else if let Some((u, sfx)) = parse_du_size(v, false)
                && u >= 1
            {
                block_unit = Some((u as u64, sfx));
            } else {
                block_unit = Some(default_unit);
            }
        } else {
            block_unit = Some(default_unit);
        }
    }

    for xf in &exclude_files {
        let p = resolve_posix_path(cwd, xf);
        if let Ok(bytes) = fs.read_file(&p) {
            let text = String::from_utf8_lossy(&bytes);
            for line in text.lines() {
                excludes.push(line.to_string());
            }
        } else {
            return err_out(&format!("du: cannot open '{xf}': No such file or directory\n"), 1);
        }
    }

    if targets.is_empty() {
        targets.push(".".to_string());
    }
    let eff_depth = if summary_only { Some(0) } else { max_depth };
    let term = if null_output { "\0" } else { "\n" };

    let emit_line = |amt: u64, disp: &str, out: &mut String| {
        if let Some(th) = threshold {
            let signed = amt as i64;
            if th >= 0 {
                if signed < th {
                    return;
                }
            } else if signed > -th {
                return;
            }
        }
        let val = format_du_amount(amt, inodes, apparent, block_unit.clone(), human_base);
        out.push_str(&format!("{val}\t{disp}{term}"));
    };

    // Size and identity come from metadata. Looking up an inode must never read a file's contents.
    enum Visit {
        Entry(String, String),
        Finish(String, Option<crate::vfs::EntryIdentity>),
    }
    let mut out = String::new();
    let mut stderr = String::new();
    let mut seen = std::collections::BTreeSet::new();
    let mut total = Some(0u64);
    const MAX_AMOUNT: u64 = (1 << 53) - 1;
    let add = |amount: &mut Option<u64>, child: Option<u64>, disp: &str, errors: &mut String| {
        *amount = match (*amount, child) {
            (Some(a), Some(b)) if a <= MAX_AMOUNT - b => Some(a + b),
            (Some(_), Some(_)) => {
                errors.push_str(&format!("du: {}: aggregate exceeds safe integer range; total suppressed\n", tree_json_escape(disp)));
                None
            }
            _ => None,
        };
    };
    for operand in targets {
        let mut pending = vec![Visit::Entry(resolve_posix_path(cwd, &operand), operand)];
        let mut ancestors = std::collections::BTreeSet::new();
        let mut dirs: Vec<(Option<u64>, Option<u64>)> = Vec::new(); // recursive total and direct children
        let mut root_device = None;
        while let Some(visit) = pending.pop() {
            let (disp, amount, own, is_dir) = match visit {
                Visit::Finish(disp, id) => {
                    if let Some(id) = id { ancestors.remove(&id); }
                    let (amount, own) = dirs.pop().unwrap();
                    (disp, amount, own, true)
                }
                Visit::Entry(full, disp) => {
                    if du_matches_excludes(&disp, &excludes) { continue; }
                    let depth = dirs.len();
                    let stat = fs.lstat(&full).and_then(|stat| {
                        if stat.kind == crate::vfs::VfsEntryKind::Symlink &&
                            (deref_mode == 'L' || deref_mode == 'H' && depth == 0) {
                            fs.stat(&full)
                        } else { Ok(stat) }
                    });
                    let mut failure = |message: &str| {
                        stderr.push_str(&format!("du: {}: {message}\n", tree_json_escape(&disp)));
                    };
                    let stat = match stat {
                        Ok(s) => s,
                        Err(err) => {
                            failure(err.split_once(": ").map_or(err.as_str(), |(_, msg)| msg));
                            if let Some((amount, own)) = dirs.last_mut() { *amount = None; *own = None; }
                            total = None;
                            continue;
                        }
                    };
                    let is_dir = stat.kind == crate::vfs::VfsEntryKind::Directory;
                    if one_fs && is_dir {
                        if depth == 0 { root_device = stat.identity.clone(); }
                        let Some((root, device)) = root_device.as_ref().zip(stat.identity.as_ref()) else {
                            failure("device identity unknown; cannot restrict traversal to one filesystem");
                            if let Some((amount, _)) = dirs.last_mut() { *amount = None; }
                            total = None;
                            continue;
                        };
                        if !root.same_filesystem(device) { continue; }
                    }
                    if is_dir && stat.identity.as_ref().is_some_and(|id| ancestors.contains(id)) {
                        failure("directory cycle detected");
                        if let Some((amount, own)) = dirs.last_mut() { *amount = None; *own = None; }
                        total = None;
                        continue;
                    }
                    let bytes = if inodes { Some(1) } else if apparent {
                        Some(if is_dir { 0 } else { stat.size as u64 })
                    } else { stat.allocated_bytes };
                    let amount = bytes.filter(|v| *v <= MAX_AMOUNT);
                    if amount.is_none() {
                        failure(&format!("{} {}; total suppressed",
                            if apparent { "apparent size" } else { "allocated bytes" },
                            if bytes.is_some() { "invalid" } else { "unknown" }));
                    }
                    if !count_links && let Some(id) = &stat.identity && !seen.insert(id.clone()) {
                        if amount.is_none() {
                            if let Some((amount, own)) = dirs.last_mut() { *amount = None; *own = None; }
                            total = None;
                        }
                        continue;
                    }
                    if is_dir {
                        match fs.list_dir(&full) {
                            Ok(mut names) => {
                                names.sort();
                                if let Some(id) = &stat.identity { ancestors.insert(id.clone()); }
                                pending.push(Visit::Finish(disp.clone(), stat.identity));
                                dirs.push((amount, amount));
                                for name in names.into_iter().rev() {
                                    pending.push(Visit::Entry(child_disp_path(&full, &name), child_disp_path(&disp, &name)));
                                }
                                continue;
                            }
                            Err(err) => {
                                failure(&err);
                                if let Some((amount, _)) = dirs.last_mut() { *amount = None; }
                                total = None;
                                continue;
                            }
                        }
                    }
                    (disp, amount, amount, false)
                }
            };
            let depth = dirs.len();
            if (depth == 0 || (eff_depth.is_none_or(|d| depth <= d) && (is_dir || all)))
                && let Some(n) = if separate { own } else { amount } {
                emit_line(n, &disp, &mut out);
            }
            if let Some((sum, direct)) = dirs.last_mut() {
                add(sum, amount, &disp, &mut stderr);
                if separate && !is_dir { add(direct, amount, &disp, &mut stderr); }
            } else if show_total { add(&mut total, amount, "total", &mut stderr); }
        }
    }
    if show_total && let Some(total) = total { emit_line(total, "total", &mut out); }
    BuiltinOutcome { stdout: out, exit_code: i32::from(!stderr.is_empty()), stderr }
}
fn parse_df_block_size(spec: &str) -> Option<(u64, String)> {
    let cleaned = spec.trim().strip_prefix('\'').unwrap_or(spec.trim());
    if cleaned.is_empty() {
        return None;
    }
    let bytes = cleaned.as_bytes();
    let mut idx = 0usize;
    while idx < bytes.len() && bytes[idx].is_ascii_digit() {
        idx += 1;
    }
    let digits = &cleaned[..idx];
    let rest = &cleaned[idx..];
    let mut unit_char: Option<char> = None;
    let mut suffix = "";
    if !rest.is_empty() {
        let mut chars = rest.chars();
        let first = chars.next().unwrap();
        let up = first.to_ascii_uppercase();
        if "KMGTPE".contains(up) {
            unit_char = Some(up);
            suffix = chars.as_str();
        } else {
            return None;
        }
    }
    if digits.is_empty() && unit_char.is_none() {
        return None;
    }
    let suffix_lower = suffix.to_ascii_lowercase();
    if !matches!(suffix_lower.as_str(), "" | "b" | "ib") {
        return None;
    }
    let count: u64 = if digits.is_empty() {
        1
    } else {
        digits.parse().ok().filter(|&n| n >= 1)?
    };
    let base: u64 = if suffix_lower == "b" { 1000 } else { 1024 };
    let exp: u32 = match unit_char {
        None => 0,
        Some('K') => 1,
        Some('M') => 2,
        Some('G') => 3,
        Some('T') => 4,
        Some('P') => 5,
        Some('E') => 6,
        _ => return None,
    };
    let factor = base.checked_pow(exp)?;
    let size = count.checked_mul(factor)?;
    if size == 0 {
        return None;
    }
    let label = if let Some(u) = unit_char {
        format!(
            "{count}{u}{}-blocks",
            if suffix_lower == "b" { "B" } else { "" }
        )
    } else {
        format!("{size}-blocks")
    };
    Some((size, label))
}

fn format_df_human(bytes: u64, base: u64) -> String {
    if bytes == 0 {
        return "0".to_string();
    }
    let units = if base == 1024 {
        ["B", "K", "M", "G", "T", "P"]
    } else {
        ["B", "k", "M", "G", "T", "P"]
    };
    let mut val = bytes as f64;
    let base_f = base as f64;
    let mut u = 0usize;
    while val >= base_f && u + 1 < units.len() {
        val /= base_f;
        u += 1;
    }
    if u == 0 {
        format!("{}", val.ceil() as u64)
    } else if val < 10.0 {
        format!("{val:.1}{}", units[u])
    } else {
        format!("{}{}", val.ceil() as u64, units[u])
    }
}

fn compute_df_vfs_usage(
    root_path: &str,
    mount_targets: &[&str],
    fs: &dyn SafeBashFs,
) -> (u64, u64) {
    let mut used_bytes: u64 = 4096;
    let mut used_inodes: u64 = 1;
    let mut queue = std::collections::VecDeque::new();
    queue.push_back(root_path.to_string());
    while let Some(cur) = queue.pop_front() {
        let mut entries = fs.list_dir(&cur).unwrap_or_default();
        entries.sort();
        for name in entries {
            let child = if cur == "/" {
                format!("/{name}")
            } else {
                format!("{cur}/{name}")
            };
            if mount_targets.contains(&child.as_str()) {
                continue;
            }
            used_inodes += 1;
            if let Ok(st) = fs.lstat(&child) {
                if st.kind == VfsEntryKind::Directory {
                    used_bytes += 4096;
                    queue.push_back(child);
                } else {
                    used_bytes += st.size as u64;
                }
            }
        }
    }
    (used_bytes, used_inodes)
}

fn cmd_df(
    args: &[String],
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    const VALID_FIELDS: &[&str] = &[
        "source", "fstype", "itotal", "iused", "iavail", "ipcent", "size", "used", "avail",
        "pcent", "file", "target",
    ];
    let posixly_correct = env.contains_key("POSIXLY_CORRECT");
    let mut show_all = false;
    let mut scale_mode = "blocks";
    let mut block_size: u64 = if posixly_correct { 512 } else { 1024 };
    let mut block_header = if posixly_correct {
        "512-blocks".to_string()
    } else {
        "1K-blocks".to_string()
    };
    let mut show_inodes = false;
    let mut portability = false;
    let mut print_type = false;
    let mut show_total = false;
    let mut output_fields: Option<Vec<String>> = None;
    let mut include_types: Vec<String> = Vec::new();
    let mut exclude_types: Vec<String> = Vec::new();
    let mut operands: Vec<String> = Vec::new();
    let mut end_of_options = false;

    if let Some(env_block) = env
        .get("DF_BLOCK_SIZE")
        .or_else(|| env.get("BLOCK_SIZE"))
        .or_else(|| env.get("BLOCKSIZE"))
        && !env_block.is_empty()
    {
        if env_block == "human-readable" {
            scale_mode = "human-1024";
        } else if env_block == "si" {
            scale_mode = "human-1000";
        } else if let Some((sz, lbl)) = parse_df_block_size(env_block) {
            block_size = sz;
            block_header = lbl;
        }
    }

    let mut i = 0usize;
    while i < args.len() {
        let arg = &args[i];
        if !end_of_options && arg == "--" {
            end_of_options = true;
            i += 1;
            continue;
        }
        if !end_of_options && arg == "--help" {
            return ok_out(concat!(
                "Usage: df [OPTION]... [FILE]...\n",
                "Show information about the file system on which each FILE resides,\n",
                "or all file systems by default (Sandbox VFS-ish/GNU).\n\n",
                "  -a, --all             include pseudo, duplicate, inaccessible file systems\n",
                "  -B, --block-size=SIZE  scale sizes by SIZE before printing them\n",
                "  -h, --human-readable  print sizes in powers of 1024 (e.g., 1023M)\n",
                "  -H, --si              print sizes in powers of 1000 (e.g., 1.1G)\n",
                "  -i, --inodes          list inode information instead of block usage\n",
                "  -k                    like --block-size=1K\n",
                "  -l, --local           limit listing to local file systems\n",
                "  -m                    like --block-size=1M\n",
                "      --no-sync         do not invoke sync before getting usage info (default)\n",
                "      --output[=FIELD_LIST]  use the output format defined by FIELD_LIST\n",
                "  -P, --portability     use the POSIX output format\n",
                "      --sync            invoke sync before getting usage info\n",
                "      --total           elide all entries insignificant to available space,\n",
                "                          and produce a grand total\n",
                "  -t, --type=TYPE       limit listing to file systems of type TYPE\n",
                "  -T, --print-type      print file system type\n",
                "  -x, --exclude-type=TYPE   limit listing to file systems not of type TYPE\n",
                "      --help            display this help and exit\n",
                "      --version         output version information and exit\n",
            ));
        }
        if !end_of_options && arg == "--version" {
            return ok_out(
                "df (Sandbox VFS-ish/GNU coreutils) 9.7\nPackaged by Safe-Bash (Sandbox VFS-ish/GNU runtime)\n",
            );
        }
        if !end_of_options && arg.starts_with("--") && arg.len() > 2 {
            if arg == "--all" {
                show_all = true;
            } else if arg == "--human-readable" {
                scale_mode = "human-1024";
            } else if arg == "--si" {
                scale_mode = "human-1000";
            } else if arg == "--inodes" {
                show_inodes = true;
            } else if arg == "--local" || arg == "--sync" || arg == "--no-sync" {
            } else if arg == "--portability" {
                portability = true;
                if scale_mode == "blocks" && block_size == 1024 && !posixly_correct {
                    block_header = "1024-blocks".to_string();
                }
            } else if arg == "--print-type" {
                print_type = true;
            } else if arg == "--total" {
                show_total = true;
            } else if arg == "--output" || arg.starts_with("--output=") {
                if arg == "--output" {
                    output_fields = Some(VALID_FIELDS.iter().map(|s| (*s).to_string()).collect());
                } else {
                    let list: Vec<String> = arg["--output=".len()..]
                        .split(',')
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string())
                        .collect();
                    if list.is_empty() {
                        return err_out(
                            "df: option '--output' requires a non-empty field list\n",
                            1,
                        );
                    }
                    for f in &list {
                        if !VALID_FIELDS.contains(&f.as_str()) {
                            return err_out(
                                &format!("df: '{f}': Crit: invalid field name for --output\n"),
                                1,
                            );
                        }
                    }
                    output_fields = Some(list);
                }
            } else if arg == "--block-size" || arg.starts_with("--block-size=") {
                let val = if arg == "--block-size" {
                    i += 1;
                    args.get(i).map(|s| s.as_str())
                } else {
                    Some(&arg["--block-size=".len()..])
                };
                let Some((sz, lbl)) = val.and_then(parse_df_block_size) else {
                    return err_out(
                        &format!(
                            "df: invalid --block-size argument '{}'\n",
                            val.unwrap_or("")
                        ),
                        1,
                    );
                };
                scale_mode = "blocks";
                block_size = sz;
                block_header = lbl;
            } else if arg == "--type" || arg.starts_with("--type=") {
                let val = if arg == "--type" {
                    i += 1;
                    args.get(i).map(|s| s.as_str())
                } else {
                    Some(&arg["--type=".len()..])
                };
                let Some(v) = val.filter(|s| !s.is_empty()) else {
                    return err_out("df: option '--type' requires an argument\n", 1);
                };
                if !include_types.contains(&v.to_string()) {
                    include_types.push(v.to_string());
                }
            } else if arg == "--exclude-type" || arg.starts_with("--exclude-type=") {
                let val = if arg == "--exclude-type" {
                    i += 1;
                    args.get(i).map(|s| s.as_str())
                } else {
                    Some(&arg["--exclude-type=".len()..])
                };
                let Some(v) = val.filter(|s| !s.is_empty()) else {
                    return err_out("df: option '--exclude-type' requires an argument\n", 1);
                };
                if !exclude_types.contains(&v.to_string()) {
                    exclude_types.push(v.to_string());
                }
            } else {
                return err_out(&format!("df: unrecognized option '{arg}'\n"), 1);
            }
            i += 1;
            continue;
        }
        if !end_of_options && arg.starts_with('-') && arg.len() > 1 {
            let chars: Vec<char> = arg[1..].chars().collect();
            let mut j = 0usize;
            while j < chars.len() {
                match chars[j] {
                    'a' => show_all = true,
                    'h' => scale_mode = "human-1024",
                    'H' => scale_mode = "human-1000",
                    'i' => show_inodes = true,
                    'k' => {
                        scale_mode = "blocks";
                        block_size = 1024;
                        block_header = if portability {
                            "1024-blocks".to_string()
                        } else {
                            "1K-blocks".to_string()
                        };
                    }
                    'm' => {
                        scale_mode = "blocks";
                        block_size = 1024 * 1024;
                        block_header = "1M-blocks".to_string();
                    }
                    'l' => {}
                    'P' => {
                        portability = true;
                        if block_size == 1024 && !posixly_correct {
                            block_header = "1024-blocks".to_string();
                        }
                    }
                    'T' => print_type = true,
                    'B' => {
                        let rest: String = chars[j + 1..].iter().collect();
                        let val = if !rest.is_empty() {
                            Some(rest)
                        } else {
                            i += 1;
                            args.get(i).cloned()
                        };
                        let Some((sz, lbl)) = val.as_deref().and_then(parse_df_block_size) else {
                            return err_out(
                                &format!(
                                    "df: invalid -B argument '{}'\n",
                                    val.as_deref().unwrap_or("")
                                ),
                                1,
                            );
                        };
                        scale_mode = "blocks";
                        block_size = sz;
                        block_header = lbl;
                        break;
                    }
                    't' => {
                        let rest: String = chars[j + 1..].iter().collect();
                        let val = if !rest.is_empty() {
                            Some(rest)
                        } else {
                            i += 1;
                            args.get(i).cloned()
                        };
                        let Some(v) = val.filter(|s| !s.is_empty()) else {
                            return err_out("df: option requires an argument -- 't'\n", 1);
                        };
                        if !include_types.contains(&v) {
                            include_types.push(v);
                        }
                        break;
                    }
                    'x' => {
                        let rest: String = chars[j + 1..].iter().collect();
                        let val = if !rest.is_empty() {
                            Some(rest)
                        } else {
                            i += 1;
                            args.get(i).cloned()
                        };
                        let Some(v) = val.filter(|s| !s.is_empty()) else {
                            return err_out("df: option requires an argument -- 'x'\n", 1);
                        };
                        if !exclude_types.contains(&v) {
                            exclude_types.push(v);
                        }
                        break;
                    }
                    ch => return err_out(&format!("df: invalid option -- '{ch}'\n"), 1),
                }
                j += 1;
            }
            i += 1;
            continue;
        }
        operands.push(arg.clone());
        i += 1;
    }

    if output_fields.is_some() && (show_inodes || print_type || portability) {
        return err_out(
            "df: options -i, -T, and -P are mutually exclusive with --output\n",
            1,
        );
    }
    for t in &include_types {
        if exclude_types.contains(t) {
            return err_out(
                &format!("df: file system type '{t}' both selected and excluded\n"),
                1,
            );
        }
    }

    #[derive(Clone)]
    struct DfMount {
        source: &'static str,
        fstype: &'static str,
        target: &'static str,
        total_bytes: u64,
        used_bytes: u64,
        total_inodes: u64,
        used_inodes: u64,
        pseudo: bool,
    }

    let mount_targets = ["/", "/tmp", "/proc"];
    let (root_used_b, root_used_i) = compute_df_vfs_usage("/", &mount_targets, fs);
    let (tmp_used_b, tmp_used_i) = compute_df_vfs_usage("/tmp", &mount_targets, fs);
    let root_total_b: u64 = 1024 * 1024 * 1024;
    let root_total_i: u64 = 1_048_576;
    let tmp_total_b: u64 = 256 * 1024 * 1024;
    let tmp_total_i: u64 = 262_144;

    let mounts = [
        DfMount {
            source: "sandbox-vfs",
            fstype: "vfs",
            target: "/",
            total_bytes: root_total_b,
            used_bytes: root_used_b.min(root_total_b),
            total_inodes: root_total_i,
            used_inodes: root_used_i.min(root_total_i),
            pseudo: false,
        },
        DfMount {
            source: "tmpfs",
            fstype: "tmpfs",
            target: "/tmp",
            total_bytes: tmp_total_b,
            used_bytes: tmp_used_b.min(tmp_total_b),
            total_inodes: tmp_total_i,
            used_inodes: tmp_used_i.min(tmp_total_i),
            pseudo: false,
        },
        DfMount {
            source: "proc",
            fstype: "proc",
            target: "/proc",
            total_bytes: 0,
            used_bytes: 0,
            total_inodes: 0,
            used_inodes: 0,
            pseudo: true,
        },
    ];

    let mut stderr = String::new();
    let mut exit_code = 0;
    let mut selected: Vec<(DfMount, String)> = Vec::new();

    if !operands.is_empty() {
        for op in &operands {
            let resolved = resolve_posix_path(cwd, op);
            let needs_walk = op.len() > 1 && (op.ends_with('/') || op.ends_with("/.") || op.contains("/./"))
                || op.split('/').any(|part| part == "..");
            let missing = if needs_walk {
                fs.inspect_command_entry(&absolute_operand(cwd, op), false, "lstat").is_err()
            } else {
                !mounts.iter().any(|m| m.target == resolved) && fs.inspect_command_entry(&resolved, false, "lstat").is_err()
            };
            if missing {
                stderr.push_str(&format!("df: '{op}': No such file or directory\n"));
                exit_code = 1;
                continue;
            }
            let mut best = mounts[0].clone();
            for m in &mounts {
                if resolved == m.target
                    || (m.target != "/" && resolved.starts_with(&format!("{}/", m.target)))
                {
                    if m.target.len() >= best.target.len() {
                        best = m.clone();
                    }
                }
            }
            selected.push((best, op.clone()));
        }
    } else {
        for m in &mounts {
            if !show_all && m.pseudo {
                continue;
            }
            selected.push((m.clone(), m.target.to_string()));
        }
    }

    let filtered: Vec<(DfMount, String)> = selected
        .into_iter()
        .filter(|(m, _)| {
            (include_types.is_empty() || include_types.iter().any(|t| t == m.fstype))
                && !exclude_types.iter().any(|t| t == m.fstype)
        })
        .collect();

    if filtered.is_empty() {
        if exit_code == 0 {
            stderr.push_str("df: no file systems processed\n");
            exit_code = 1;
        }
        return BuiltinOutcome {
            stdout: String::new(),
            stderr,
            exit_code,
        };
    }

    let format_size = |bytes: u64| -> String {
        if scale_mode == "human-1024" {
            format_df_human(bytes, 1024)
        } else if scale_mode == "human-1000" {
            format_df_human(bytes, 1000)
        } else {
            bytes.div_ceil(block_size).to_string()
        }
    };

    let format_pct = |used: u64, total: u64| -> String {
        if total == 0 {
            "-".to_string()
        } else {
            let pct = ((used as f64 / total as f64) * 100.0).ceil() as u64;
            let clamped = pct.clamp(if used > 0 { 1 } else { 0 }, 100);
            format!("{clamped}%")
        }
    };

    let is_custom_output = output_fields.is_some();
    let active_fields: Vec<String> = if let Some(cols) = output_fields {
        cols
    } else if show_inodes {
        if print_type {
            vec![
                "source", "fstype", "itotal", "iused", "iavail", "ipcent", "target",
            ]
        } else {
            vec!["source", "itotal", "iused", "iavail", "ipcent", "target"]
        }
        .into_iter()
        .map(String::from)
        .collect()
    } else if print_type {
        vec![
            "source", "fstype", "size", "used", "avail", "pcent", "target",
        ]
        .into_iter()
        .map(String::from)
        .collect()
    } else {
        vec!["source", "size", "used", "avail", "pcent", "target"]
            .into_iter()
            .map(String::from)
            .collect()
    };

    let header_row: Vec<String> = active_fields
        .iter()
        .map(|f| match f.as_str() {
            "source" => "Filesystem".to_string(),
            "fstype" => "Type".to_string(),
            "itotal" => "Inodes".to_string(),
            "iused" => "IUsed".to_string(),
            "iavail" => "IFree".to_string(),
            "ipcent" => "IUse%".to_string(),
            "size" => {
                if scale_mode == "human-1024" || scale_mode == "human-1000" {
                    "Size".to_string()
                } else {
                    block_header.clone()
                }
            }
            "used" => "Used".to_string(),
            "avail" => {
                if portability && !is_custom_output {
                    "Available".to_string()
                } else {
                    "Avail".to_string()
                }
            }
            "pcent" => {
                if portability && !is_custom_output {
                    "Capacity".to_string()
                } else {
                    "Use%".to_string()
                }
            }
            "file" => "File".to_string(),
            "target" => "Mounted on".to_string(),
            other => other.to_string(),
        })
        .collect();

    let mut data_rows: Vec<Vec<String>> = Vec::new();
    let mut sum_total_b: u64 = 0;
    let mut sum_used_b: u64 = 0;
    let mut sum_avail_b: u64 = 0;
    let mut sum_total_i: u64 = 0;
    let mut sum_used_i: u64 = 0;
    let mut sum_avail_i: u64 = 0;

    for (m, file_op) in &filtered {
        let used_b = m.used_bytes;
        let avail_b = m.total_bytes.saturating_sub(used_b);
        let used_i = m.used_inodes;
        let avail_i = m.total_inodes.saturating_sub(used_i);
        sum_total_b += m.total_bytes;
        sum_used_b += used_b;
        sum_avail_b += avail_b;
        sum_total_i += m.total_inodes;
        sum_used_i += used_i;
        sum_avail_i += avail_i;

        let row: Vec<String> = active_fields
            .iter()
            .map(|f| match f.as_str() {
                "source" => m.source.to_string(),
                "fstype" => m.fstype.to_string(),
                "itotal" => {
                    if scale_mode == "blocks" {
                        m.total_inodes.to_string()
                    } else {
                        format_size(m.total_inodes)
                    }
                }
                "iused" => {
                    if scale_mode == "blocks" {
                        used_i.to_string()
                    } else {
                        format_size(used_i)
                    }
                }
                "iavail" => {
                    if scale_mode == "blocks" {
                        avail_i.to_string()
                    } else {
                        format_size(avail_i)
                    }
                }
                "ipcent" => format_pct(used_i, m.total_inodes),
                "size" => format_size(m.total_bytes),
                "used" => format_size(used_b),
                "avail" => format_size(avail_b),
                "pcent" => format_pct(used_b, m.total_bytes),
                "file" => file_op.clone(),
                "target" => m.target.to_string(),
                _ => String::new(),
            })
            .collect();
        data_rows.push(row);
    }

    if show_total {
        let row: Vec<String> = active_fields
            .iter()
            .map(|f| match f.as_str() {
                "source" => "total".to_string(),
                "fstype" => "-".to_string(),
                "itotal" => {
                    if scale_mode == "blocks" {
                        sum_total_i.to_string()
                    } else {
                        format_size(sum_total_i)
                    }
                }
                "iused" => {
                    if scale_mode == "blocks" {
                        sum_used_i.to_string()
                    } else {
                        format_size(sum_used_i)
                    }
                }
                "iavail" => {
                    if scale_mode == "blocks" {
                        sum_avail_i.to_string()
                    } else {
                        format_size(sum_avail_i)
                    }
                }
                "ipcent" => format_pct(sum_used_i, sum_total_i),
                "size" => format_size(sum_total_b),
                "used" => format_size(sum_used_b),
                "avail" => format_size(sum_avail_b),
                "pcent" => format_pct(sum_used_b, sum_total_b),
                _ => "-".to_string(),
            })
            .collect();
        data_rows.push(row);
    }

    let widths: Vec<usize> = header_row
        .iter()
        .enumerate()
        .map(|(col, h)| {
            let mut max_w = h.len().max(if col == 0 { 14 } else { 5 });
            for r in &data_rows {
                max_w = max_w.max(r[col].len());
            }
            max_w
        })
        .collect();

    let is_right_aligned = |f: &str| {
        matches!(
            f,
            "itotal" | "iused" | "iavail" | "ipcent" | "size" | "used" | "avail" | "pcent"
        )
    };

    let format_table_row = |cells: &[String]| -> String {
        cells
            .iter()
            .enumerate()
            .map(|(idx, cell)| {
                if idx + 1 == cells.len() {
                    cell.clone()
                } else {
                    let w = widths[idx];
                    if is_right_aligned(&active_fields[idx]) {
                        format!("{cell:>w$}")
                    } else {
                        format!("{cell:<w$}")
                    }
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
    };

    let mut out = format!("{}\n", format_table_row(&header_row));
    for r in &data_rows {
        out.push_str(&format!("{}\n", format_table_row(r)));
    }
    BuiltinOutcome {
        stdout: out,
        stderr,
        exit_code,
    }
}

fn cmd_mktemp(
    args: &[String],
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut is_dir = false;
    let mut dry_run = false;
    let mut quiet = false;
    let mut use_tmpdir = false;
    let mut deprecated_tmpdir = false;
    let mut tmpdir: Option<String> = None;
    let mut suffix: Option<String> = None;
    let mut ended = false;
    let mut operands: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if ended || a == "-" || !a.starts_with('-') {
            operands.push(a.clone());
            i += 1;
        } else if a == "--" {
            ended = true;
            i += 1;
        } else if a == "--directory" {
            is_dir = true;
            i += 1;
        } else if a == "--dry-run" {
            dry_run = true;
            i += 1;
        } else if a == "--quiet" {
            quiet = true;
            i += 1;
        } else if a == "--tmpdir" {
            use_tmpdir = true;
            tmpdir = Some(String::new());
            i += 1;
        } else if let Some(p) = a.strip_prefix("--tmpdir=") {
            use_tmpdir = true;
            tmpdir = Some(p.to_string());
            i += 1;
        } else if let Some(sf) = a.strip_prefix("--suffix=") {
            suffix = Some(sf.to_string());
            i += 1;
        } else if a == "--suffix" {
            if i + 1 >= args.len() {
                return err_out("mktemp: option '--suffix' requires an argument\n", 1);
            }
            suffix = Some(args[i + 1].clone());
            i += 2;
        } else if !a.starts_with("--") {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut j = 0usize;
            while j < chars.len() {
                match chars[j] {
                    'd' => is_dir = true,
                    'u' => dry_run = true,
                    'q' => quiet = true,
                    't' => {
                        use_tmpdir = true;
                        deprecated_tmpdir = true;
                    }
                    'p' => {
                        let rest: String = chars[j + 1..].iter().collect();
                        if !rest.is_empty() {
                            tmpdir = Some(rest);
                        } else if i + 1 < args.len() {
                            i += 1;
                            tmpdir = Some(args[i].clone());
                        } else {
                            return err_out("mktemp: option requires an argument -- 'p'\n", 1);
                        }
                        use_tmpdir = true;
                        break;
                    }
                    ch => {
                        return err_out(&format!("mktemp: invalid option -- '{ch}'\n"), 1);
                    }
                }
                j += 1;
            }
            i += 1;
        } else {
            return err_out(&format!("mktemp: unrecognized option '{a}'\n"), 1);
        }
    }
    if operands.len() > 1 {
        return err_out("mktemp: too many templates\n", 1);
    }
    if operands.is_empty() {
        use_tmpdir = true;
    }
    let mut tpl = operands
        .first()
        .cloned()
        .unwrap_or_else(|| "tmp.XXXXXXXXXX".to_string());
    if deprecated_tmpdir && !tpl.contains("XXX") {
        tpl.push_str(".XXXXXXXXXX");
    }
    if deprecated_tmpdir && tpl.contains('/') {
        return err_out(
            "mktemp: invalid template, contains directory separator\n",
            1,
        );
    }
    if let Some(ref sf) = suffix
        && (sf.contains('/') || !tpl.ends_with('X'))
    {
        return err_out(
            "mktemp: with --suffix, template must end in X and suffix must not contain '/'\n",
            1,
        );
    }
    let last_comp = tpl.rsplit('/').next().unwrap_or(&tpl);
    let end = last_comp.rfind('X').map(|idx| idx + 1).unwrap_or(0);
    let mut start = end;
    let comp_bytes = last_comp.as_bytes();
    while start > 0 && comp_bytes[start - 1] == b'X' {
        start -= 1;
    }
    let x_count = end - start;
    if x_count < 3 {
        return err_out(
            "mktemp: template must contain at least three consecutive X characters in its last component\n",
            1,
        );
    }
    if use_tmpdir && tpl.starts_with('/') {
        return err_out(
            &format!("mktemp: invalid template, '{tpl}', must not be absolute\n"),
            1,
        );
    }
    let prefix_len = tpl.len() - last_comp.len() + start;
    let tpl_prefix = &tpl[..prefix_len];
    let tpl_tail = suffix.as_deref().unwrap_or(&last_comp[end..]);
    let parent_dir = if deprecated_tmpdir {
        env.get("TMPDIR")
            .filter(|s| !s.is_empty())
            .cloned()
            .or_else(|| tmpdir.clone().filter(|s| !s.is_empty()))
            .unwrap_or_else(|| "/tmp".to_string())
    } else {
        tmpdir
            .clone()
            .filter(|s| !s.is_empty())
            .or_else(|| env.get("TMPDIR").filter(|s| !s.is_empty()).cloned())
            .unwrap_or_else(|| "/tmp".to_string())
    };
    if use_tmpdir
        && parent_dir == "/tmp"
        && tmpdir.as_deref().unwrap_or("").is_empty()
        && env.get("TMPDIR").filter(|s| !s.is_empty()).is_none()
    {
        let _ = fs.mkdir_all("/tmp");
    }

    let alphabet = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let mut display_out = String::new();
    let mut resolved_path = String::new();
    for seq in 1..10000usize {
        let mut rand_part = Vec::with_capacity(x_count);
        let mut n = seq.wrapping_mul(2654435761);
        for pos in 0..x_count {
            let idx = (n.wrapping_add(pos * 17) ^ (seq * 31)) % alphabet.len();
            rand_part.push(alphabet[idx]);
            n = n.wrapping_mul(1103515245).wrapping_add(12345);
        }
        let rand_str = String::from_utf8_lossy(&rand_part);
        let generated = format!("{tpl_prefix}{rand_str}{tpl_tail}");
        let display = if use_tmpdir {
            if parent_dir == "/" {
                format!("/{generated}")
            } else {
                format!("{}/{generated}", parent_dir.trim_end_matches('/'))
            }
        } else {
            generated
        };
        let cand = resolve_posix_path(cwd, &display);
        if !fs.exists(&cand) {
            display_out = display;
            resolved_path = cand;
            break;
        }
    }
    if !dry_run {
        let parent = crate::vfs::dirname_posix_path(&resolved_path);
        if !fs.exists(&parent) || !fs.is_dir(&parent) {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: if quiet {
                    String::new()
                } else {
                    format!(
                        "mktemp: ENOENT: no such file or directory, {} '{resolved_path}'\n",
                        if is_dir { "mkdir" } else { "writeFile" }
                    )
                },
                exit_code: 1,
            };
        }
        let umask = env
            .get("\0umask")
            .and_then(|s| u32::from_str_radix(s, 8).ok())
            .unwrap_or(0o022);
        if is_dir {
            let _ = fs.mkdir_all(&resolved_path);
            let _ = fs.chmod(&resolved_path, 0o040000 | (0o700 & !umask));
        } else {
            let _ = fs.write_file(&resolved_path, &[]);
            let _ = fs.chmod(&resolved_path, 0o100000 | (0o600 & !umask));
        }
    }
    ok_out(&format!("{display_out}\n"))
}

fn detect_tree_utf8(
    explicit_charset: Option<&str>,
    env: &std::collections::BTreeMap<String, String>,
) -> bool {
    if let Some(cs) = explicit_charset {
        let up = cs.to_ascii_uppercase();
        return up == "UTF-8" || up == "UTF8";
    }
    if let Some(tc) = env.get("TREE_CHARSET") {
        let up = tc.to_ascii_uppercase();
        return up == "UTF-8" || up == "UTF8";
    }
    for key in ["LC_ALL", "LC_CTYPE", "LANG"] {
        if let Some(loc) = env.get(key)
            && !loc.is_empty()
        {
            let before_mod = loc.split('@').next().unwrap_or(loc);
            if let Some((_, enc)) = before_mod.split_once('.') {
                let up = enc.to_ascii_uppercase();
                return up == "UTF-8" || up == "UTF8";
            }
            return false;
        }
    }
    false
}

fn tree_version_cmp(left: &[u8], right: &[u8]) -> std::cmp::Ordering {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum State {
        Normal,
        Integer,
        Fraction,
        Zeros,
    }
    let is_digit = |b: Option<u8>| b.map(|x| x.is_ascii_digit()).unwrap_or(false);
    let mut state = State::Normal;
    let mut idx = 0usize;
    while idx < left.len() && idx < right.len() && left[idx] == right[idx] {
        let b = left[idx];
        idx += 1;
        if !b.is_ascii_digit() {
            state = State::Normal;
        } else if state == State::Normal {
            state = if b == b'0' { State::Zeros } else { State::Integer };
        } else if state == State::Zeros && b != b'0' {
            state = State::Fraction;
        }
    }
    let a = left.get(idx).copied().unwrap_or(0);
    let b = right.get(idx).copied().unwrap_or(0);
    if a == b {
        return std::cmp::Ordering::Equal;
    }
    if state == State::Zeros {
        if !is_digit(Some(a)) && is_digit(Some(b)) {
            return std::cmp::Ordering::Greater;
        }
        if is_digit(Some(a)) && !is_digit(Some(b)) {
            return std::cmp::Ordering::Less;
        }
    }
    if state == State::Integer {
        if is_digit(Some(a)) && !is_digit(Some(b)) {
            return std::cmp::Ordering::Greater;
        }
        if !is_digit(Some(a)) && is_digit(Some(b)) {
            return std::cmp::Ordering::Less;
        }
    }
    if is_digit(Some(a))
        && is_digit(Some(b))
        && (state == State::Integer || (state == State::Normal && a != b'0' && b != b'0'))
    {
        let mut end_a = idx + 1;
        let mut end_b = idx + 1;
        while is_digit(left.get(end_a).copied()) {
            end_a += 1;
        }
        while is_digit(right.get(end_b).copied()) {
            end_b += 1;
        }
        if end_a != end_b {
            return end_a.cmp(&end_b);
        }
    }
    a.cmp(&b)
}

fn tree_matches_pattern(pat: &str, name: &str) -> bool {
    pat.split('|').any(|alt| crate::shell::expand::glob_match(alt, name))
}

fn tree_json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\x08' => out.push_str("\\b"),
            '\x0c' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 || (0x7f..=0x9f).contains(&(c as u32)) => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[derive(Clone)]
struct TreeEntry {
    path: String,
    display: String,
    name: String,
    is_symlink: bool,
    is_dir: bool,
    target: Option<String>,
    cycle: bool,
    limited: Option<String>,
}

fn inspect_tree_entry(path: String, display: String, name: String, fs: &dyn SafeBashFs) -> TreeEntry {
    let target = fs
        .readlink(&path)
        .ok();
    let is_symlink = target.is_some();
    let is_dir = fs.is_dir(&path);
    TreeEntry {
        path,
        display,
        name,
        is_symlink,
        is_dir,
        target,
        cycle: false,
        limited: None,
    }
}

#[allow(clippy::too_many_arguments)]
fn collect_tree_children(
    entry: &mut TreeEntry,
    ancestors: &[String],
    observed_dirs: &mut Vec<String>,
    depth: usize,
    max_depth: Option<usize>,
    show_all: bool,
    dirs_only: bool,
    follow_links: bool,
    dirs_first: bool,
    sort_mode: &str,
    reverse: bool,
    filelimit: Option<usize>,
    include_pats: &[String],
    exclude_pats: &[String],
    fs: &dyn SafeBashFs,
) -> Vec<TreeEntry> {
    if !entry.is_dir || (entry.is_symlink && !follow_links) {
        return Vec::new();
    }
    let canon = canonicalize_posix_path(&entry.path, 'e', false, fs)
        .unwrap_or_else(|_| normalize_posix_path(&entry.path));
    let check_set: &[String] = if entry.is_symlink {
        observed_dirs.as_slice()
    } else {
        ancestors
    };
    if check_set.iter().any(|a| a == &canon) {
        entry.cycle = true;
        return Vec::new();
    }
    if follow_links {
        observed_dirs.push(canon);
    }
    if let Some(md) = max_depth
        && depth >= md
    {
        return Vec::new();
    }
    let Ok(listing) = fs.list_dir(&entry.path) else {
        return Vec::new();
    };
    let mut candidates: Vec<String> = listing
        .into_iter()
        .filter(|name| {
            if name == "." || name == ".." {
                return false;
            }
            if !show_all && name.starts_with('.') {
                return false;
            }
            if exclude_pats.iter().any(|p| tree_matches_pattern(p, name)) {
                return false;
            }
            true
        })
        .collect();
    if sort_mode != "none" {
        candidates.sort_by(|a, b| {
            let ord = if sort_mode == "version" {
                tree_version_cmp(a.as_bytes(), b.as_bytes())
            } else {
                a.as_bytes().cmp(b.as_bytes())
            };
            if reverse { ord.reverse() } else { ord }
        });
    }
    let mut children = Vec::new();
    for item_name in candidates {
        let child_path = resolve_posix_path(&entry.path, &item_name);
        let child_disp = format!("{}/{item_name}", entry.display.trim_end_matches('/'));
        let child = inspect_tree_entry(child_path, child_disp, item_name.clone(), fs);
        if dirs_only && !child.is_dir {
            continue;
        }
        let include_dir = (child.is_dir && !child.is_symlink) || (follow_links && child.is_dir);
        if !include_dir
            && !include_pats.is_empty()
            && !include_pats.iter().any(|p| tree_matches_pattern(p, &item_name))
        {
            continue;
        }
        children.push(child);
    }
    if let Some(limit) = filelimit
        && limit > 0
        && children.len() > limit
    {
        entry.limited = Some(format!(
            "{} entries exceeds filelimit, not opening dir",
            children.len()
        ));
        return Vec::new();
    }
    if dirs_first {
        children.sort_by(|a, b| b.is_dir.cmp(&a.is_dir));
    }
    children
}

#[allow(clippy::too_many_arguments)]
fn visit_tree_entry(
    mut entry: TreeEntry,
    ancestors: &[String],
    observed_dirs: &mut Vec<String>,
    prefix: &str,
    last: bool,
    depth: usize,
    max_depth: Option<usize>,
    show_all: bool,
    dirs_only: bool,
    follow_links: bool,
    full_path: bool,
    indent: bool,
    json_mode: bool,
    dirs_first: bool,
    sort_mode: &str,
    reverse: bool,
    filelimit: Option<usize>,
    utf8: bool,
    include_pats: &[String],
    exclude_pats: &[String],
    fs: &dyn SafeBashFs,
    dir_count: &mut usize,
    file_count: &mut usize,
    out: &mut String,
) {
    let children = collect_tree_children(
        &mut entry,
        ancestors,
        observed_dirs,
        depth,
        max_depth,
        show_all,
        dirs_only,
        follow_links,
        dirs_first,
        sort_mode,
        reverse,
        filelimit,
        include_pats,
        exclude_pats,
        fs,
    );
    if entry.is_dir {
        if depth > 0 || !children.is_empty() || entry.limited.is_some() {
            *dir_count += 1;
        }
    } else {
        *file_count += 1;
    }

    let shown_name = if depth == 0 || full_path {
        &entry.display
    } else {
        &entry.name
    };
    let canon = canonicalize_posix_path(&entry.path, 'e', false, fs)
        .unwrap_or_else(|_| normalize_posix_path(&entry.path));
    let mut next_ancestors = ancestors.to_vec();
    next_ancestors.push(canon);

    if json_mode {
        let nl = if indent { "\n" } else { "" };
        let pad = |d: usize| if indent { "  ".repeat(d) } else { String::new() };
        let type_str = if entry.is_symlink {
            "link"
        } else if entry.is_dir {
            "directory"
        } else {
            "file"
        };
        out.push_str(&pad(depth + 1));
        out.push_str(&format!(
            "{{\"type\":\"{type_str}\",\"name\":{}",
            tree_json_escape(shown_name)
        ));
        if let Some(ref lt) = entry.target {
            out.push_str(&format!(",\"target\":{}", tree_json_escape(lt)));
        }
        if entry.cycle {
            out.push_str(",\"contents\":[{\"error\":\"recursive, not followed\"}]");
        } else if let Some(ref lim) = entry.limited {
            out.push_str(&format!(
                ",\"contents\":[{{\"error\":{}}}]",
                tree_json_escape(lim)
            ));
        } else if !children.is_empty() {
            out.push_str(&format!(",\"contents\":[{nl}"));
            let len = children.len();
            for (idx, ch) in children.into_iter().enumerate() {
                if idx > 0 {
                    out.push_str(&format!(",{nl}"));
                }
                visit_tree_entry(
                    ch,
                    &next_ancestors,
                    observed_dirs,
                    "",
                    idx + 1 == len,
                    depth + 1,
                    max_depth,
                    show_all,
                    dirs_only,
                    follow_links,
                    full_path,
                    indent,
                    true,
                    dirs_first,
                    sort_mode,
                    reverse,
                    filelimit,
                    utf8,
                    include_pats,
                    exclude_pats,
                    fs,
                    dir_count,
                    file_count,
                    out,
                );
            }
            out.push_str(&format!("{nl}{}]", pad(depth + 1)));
        }
        out.push('}');
    } else {
        let branch = if indent && depth > 0 {
            let connector = if last {
                if utf8 { "└── " } else { "`-- " }
            } else if utf8 {
                "├── "
            } else {
                "|-- "
            };
            format!("{prefix}{connector}")
        } else {
            String::new()
        };
        let target_str = match entry.target {
            Some(ref lt) => format!(" -> {lt}"),
            None => String::new(),
        };
        let annot = if entry.cycle {
            Some("recursive, not followed")
        } else {
            entry.limited.as_deref()
        };
        let annot_str = match annot {
            Some(a) => format!("  [{a}]"),
            None => String::new(),
        };
        out.push_str(&format!("{branch}{shown_name}{target_str}{annot_str}\n"));
        let child_prefix = if depth == 0 {
            String::new()
        } else {
            let seg = if last {
                "    "
            } else if utf8 {
                "│   "
            } else {
                "|   "
            };
            format!("{prefix}{seg}")
        };
        let len = children.len();
        for (idx, ch) in children.into_iter().enumerate() {
            visit_tree_entry(
                ch,
                &next_ancestors,
                observed_dirs,
                &child_prefix,
                idx + 1 == len,
                depth + 1,
                max_depth,
                show_all,
                dirs_only,
                follow_links,
                full_path,
                indent,
                false,
                dirs_first,
                sort_mode,
                reverse,
                filelimit,
                utf8,
                include_pats,
                exclude_pats,
                fs,
                dir_count,
                file_count,
                out,
            );
        }
    }
}

fn cmd_tree(
    args: &[String],
    cwd: &str,
    env: &std::collections::BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut json_mode = false;
    let mut show_all = false;
    let mut dirs_only = false;
    let mut follow_links = false;
    let mut full_path = false;
    let mut indent = true;
    let mut report = true;
    let mut reverse = false;
    let mut dirs_first = false;
    let mut sort_mode = "name".to_string();
    let mut filelimit: Option<usize> = None;
    let mut max_depth: Option<usize> = None;
    let mut include_pats: Vec<String> = Vec::new();
    let mut exclude_pats: Vec<String> = Vec::new();
    let mut explicit_charset: Option<String> = None;
    let mut operands: Vec<String> = Vec::new();
    let mut ended = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if ended || !a.starts_with('-') || a == "-" {
            operands.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if a == "--help" {
            return ok_out(concat!(
                "Usage: tree [-adlfirnJvU] [-L depth] [-P pattern] [-I pattern] [--dirsfirst]\n",
                "            [--sort=name|version|none] [--filelimit=number]\n",
                "            [--charset=ASCII|US-ASCII|UTF-8|UTF8] [--noreport] [--] [path ...]\n",
                "Virtual filesystem tree; no native processes or implicit host access.\n",
                "Default: visible entries, no symlink traversal, C/UTF-8-byte name order,\n",
                "escaped filenames. Branch charset: --charset, TREE_CHARSET, virtual locale,\n",
                "then ASCII; UTF-8 changes branches only. -l follows directory links; ancestor\n",
                "cycles are skipped. -P includes files; -I excludes files and directories.\n",
                "Basename patterns: *, ?, bracket ranges, | alternatives, backslash literals.\n",
                "-J emits JSON; -i removes text branches or JSON formatting whitespace.\n",
                "Unsupported options and path/globstar patterns are rejected before VFS I/O.\n",
            ));
        }
        if a == "--version" {
            return ok_out("tree (virtual-bash bounded profile) 1\n");
        }
        if a == "--noreport" {
            report = false;
            i += 1;
        } else if a == "--dirsfirst" {
            dirs_first = true;
            i += 1;
        } else if let Some(s) = a.strip_prefix("--sort=") {
            sort_mode = s.to_string();
            i += 1;
        } else if a == "--sort" && i + 1 < args.len() {
            sort_mode = args[i + 1].clone();
            i += 2;
        } else if let Some(fl) = a.strip_prefix("--filelimit=") {
            filelimit = fl.parse().ok();
            i += 1;
        } else if a == "--filelimit" && i + 1 < args.len() {
            filelimit = args[i + 1].parse().ok();
            i += 2;
        } else if let Some(cs) = a.strip_prefix("--charset=") {
            explicit_charset = Some(cs.to_string());
            i += 1;
        } else if a == "--charset" && i + 1 < args.len() {
            explicit_charset = Some(args[i + 1].clone());
            i += 2;
        } else if !a.starts_with("--") {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut j = 0usize;
            while j < chars.len() {
                match chars[j] {
                    'a' => show_all = true,
                    'd' => dirs_only = true,
                    'l' => follow_links = true,
                    'f' => full_path = true,
                    'i' => indent = false,
                    'J' => json_mode = true,
                    'r' => reverse = true,
                    'v' => sort_mode = "version".to_string(),
                    'U' => sort_mode = "none".to_string(),
                    'n' => {}
                    'L' | 'P' | 'I' => {
                        let flag = chars[j];
                        let rest: String = chars[j + 1..].iter().collect();
                        let val = if !rest.is_empty() {
                            rest
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            return err_out(
                                &format!("tree: option requires an argument -- '{flag}'\n"),
                                2,
                            );
                        };
                        match flag {
                            'L' => match val.parse::<isize>() {
                                Ok(n) if n >= 1 => max_depth = Some(n as usize),
                                _ => {
                                    return err_out(
                                        "tree: -L must be between 1 and Infinity\n",
                                        2,
                                    );
                                }
                            },
                            'P' => include_pats.push(val),
                            'I' => exclude_pats.push(val),
                            _ => {}
                        }
                        break;
                    }
                    other => {
                        return err_out(&format!("tree: unsupported option: -{other}\n"), 2);
                    }
                }
                j += 1;
            }
            i += 1;
        } else {
            return err_out(&format!("tree: unsupported option: {a}\n"), 2);
        }
    }
    if operands.is_empty() {
        operands.push(".".to_string());
    }
    let utf8 = detect_tree_utf8(explicit_charset.as_deref(), env);
    let nl = if indent { "\n" } else { "" };
    let pad1 = if indent { "  " } else { "" };
    let mut out = String::new();
    let mut err_buf = String::new();
    let mut exit_code = 0;
    if json_mode {
        out.push_str(&format!("[{nl}"));
    }
    let mut dir_count = 0usize;
    let mut file_count = 0usize;
    for (idx, op) in operands.iter().enumerate() {
        if json_mode && idx > 0 {
            out.push_str(&format!(",{nl}"));
        }
        let root_path = resolve_posix_path(cwd, op);
        if !fs.exists(&root_path) && fs.lstat(&root_path).is_err() {
            let msg = format!("no such file or directory, lstat '{root_path}'");
            if json_mode {
                out.push_str(&format!(
                    "{pad1}{{\"type\":\"unknown\",\"name\":{},\"error\":{}}}",
                    tree_json_escape(op),
                    tree_json_escape(&msg)
                ));
            } else {
                out.push_str(&format!("{op}  [{msg}]\n"));
            }
            err_buf.push_str(&format!("tree: {op}: {msg}\n"));
            exit_code = 1;
            continue;
        }
        let entry = inspect_tree_entry(root_path, op.clone(), op.clone(), fs);
        let mut observed_dirs = Vec::new();
        visit_tree_entry(
            entry,
            &[],
            &mut observed_dirs,
            "",
            true,
            0,
            max_depth,
            show_all,
            dirs_only,
            follow_links,
            full_path,
            indent,
            json_mode,
            dirs_first,
            &sort_mode,
            reverse,
            filelimit,
            utf8,
            &include_pats,
            &exclude_pats,
            fs,
            &mut dir_count,
            &mut file_count,
            &mut out,
        );
    }
    if report {
        if json_mode {
            if dirs_only {
                out.push_str(&format!(
                    ",{nl}{pad1}{{\"type\":\"report\",\"directories\":{dir_count}}}"
                ));
            } else {
                out.push_str(&format!(
                    ",{nl}{pad1}{{\"type\":\"report\",\"directories\":{dir_count},\"files\":{file_count}}}"
                ));
            }
        } else {
            let dir_word = if dir_count == 1 { "directory" } else { "directories" };
            if dirs_only {
                out.push_str(&format!("\n{dir_count} {dir_word}\n"));
            } else {
                let file_word = if file_count == 1 { "file" } else { "files" };
                out.push_str(&format!(
                    "\n{dir_count} {dir_word}, {file_count} {file_word}\n"
                ));
            }
        }
    }
    if json_mode {
        out.push_str(&format!("{nl}]\n"));
    }
    BuiltinOutcome {
        stdout: out,
        stderr: err_buf,
        exit_code,
    }
}

fn is_csv_text(text: &str) -> bool {
    let mut records = 0usize;
    let mut columns = 0usize;
    let mut fields = 1usize;
    let mut record_start = 0usize;
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum CsvState {
        Start,
        Unquoted,
        Quoted,
        Closed,
    }
    let mut state = CsvState::Start;
    let bytes = text.as_bytes();
    let mut idx = 0usize;
    while idx < bytes.len() {
        let ch = bytes[idx];
        if state == CsvState::Quoted {
            if ch == b'"' {
                if bytes.get(idx + 1) == Some(&b'"') {
                    idx += 2;
                    continue;
                }
                state = CsvState::Closed;
            }
            idx += 1;
            continue;
        }
        if ch == b',' {
            fields += 1;
            state = CsvState::Start;
        } else if ch == b'\n' {
            if fields < 2 || (records > 0 && fields != columns) {
                return false;
            }
            records += 1;
            columns = fields;
            fields = 1;
            state = CsvState::Start;
            record_start = idx + 1;
        } else if ch == b'\r' && bytes.get(idx + 1) == Some(&b'\n') {
            // handled on \n
        } else if ch == b'"' && state == CsvState::Start {
            state = CsvState::Quoted;
        } else {
            if ch == b'"' || ch == b'\r' || state == CsvState::Closed {
                return false;
            }
            state = CsvState::Unquoted;
        }
        idx += 1;
    }
    if record_start < bytes.len() {
        if state == CsvState::Quoted || fields < 2 || (records > 0 && fields != columns) {
            return false;
        }
        records += 1;
    }
    records >= 2
}

fn detect_text_format(text: &str) -> Option<(&'static str, &'static str)> {
    if let Some(line_end) = text.find('\n')
        && text.starts_with("#!")
    {
        let header = text[2..line_end].trim().replace('\t', " ");
        let words: Vec<&str> = header.split(' ').filter(|w| !w.is_empty()).collect();
        let first = words.first().copied().unwrap_or("");
        let name = first.rsplit('/').next().unwrap_or(first);
        let interp = if name == "env" {
            words.get(1).copied().unwrap_or("")
        } else {
            name
        };
        if matches!(interp, "sh" | "bash" | "ash" | "ksh" | "zsh" | "csh" | "tcsh") {
            return Some(("shell script", "text/x-shellscript"));
        }
        if interp == "python"
            || (interp.starts_with("python")
                && interp.len() > 6
                && interp.as_bytes()[6].is_ascii_digit()
                && interp[6..].chars().all(|c| c.is_ascii_digit() || c == '.'))
        {
            return Some(("Python script", "text/x-script.python"));
        }
    }
    let lower = text.to_ascii_lowercase();
    if lower.starts_with("<?xml")
        && lower
            .as_bytes()
            .get(5)
            .map(|b| matches!(b, b' ' | b'\t' | b'\r' | b'\n'))
            .unwrap_or(false)
    {
        return Some(("XML document", "text/xml"));
    }
    for marker in ["<!doctype html", "<html", "<head", "<title"] {
        let mut search_from = 0usize;
        while let Some(rel) = lower[search_from..].find(marker) {
            let off = search_from + rel;
            let after = lower.as_bytes().get(off + marker.len()).copied().unwrap_or(0);
            if matches!(after, b' ' | b'\t' | b'\r' | b'\n' | b'\x0c' | b'>') {
                return Some(("HTML document", "text/html"));
            }
            search_from = off + marker.len();
        }
    }
    if is_csv_text(text) {
        return Some(("CSV text", "text/csv"));
    }
    None
}

fn classify_file_bytes(bytes: &[u8]) -> (String, &'static str, &'static str) {
    if bytes.is_empty() {
        return ("empty".to_string(), "inode/x-empty", "binary");
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return ("PNG image data".to_string(), "image/png", "binary");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return ("GIF image data".to_string(), "image/gif", "binary");
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return ("JPEG image data".to_string(), "image/jpeg", "binary");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return ("WebP image data".to_string(), "image/webp", "binary");
    }
    if bytes.starts_with(b"II*\x00") || bytes.starts_with(b"MM\x00*") {
        return ("TIFF image data".to_string(), "image/tiff", "binary");
    }
    if bytes.len() >= 26
        && &bytes[0..2] == b"BM"
        && matches!(
            u32::from_le_bytes([bytes[14], bytes[15], bytes[16], bytes[17]]),
            12 | 40 | 52 | 56 | 108 | 124
        )
    {
        return ("PC bitmap image data".to_string(), "image/bmp", "binary");
    }
    if bytes.len() >= 22
        && &bytes[0..4] == b"\x00\x00\x01\x00"
        && u16::from_le_bytes([bytes[4], bytes[5]]) > 0
    {
        return (
            "MS Windows icon resource".to_string(),
            "image/vnd.microsoft.icon",
            "binary",
        );
    }
    if bytes.starts_with(b"%PDF-") {
        return ("PDF document".to_string(), "application/pdf", "binary");
    }
    if bytes.starts_with(b"\x1f\x8b") {
        return ("gzip compressed data".to_string(), "application/gzip", "binary");
    }
    if bytes.starts_with(b"BZh") {
        return ("bzip2 compressed data".to_string(), "application/x-bzip2", "binary");
    }
    if bytes.starts_with(b"\xfd7zXZ\x00") {
        return ("XZ compressed data".to_string(), "application/x-xz", "binary");
    }
    if bytes.starts_with(b"\x28\xb5\x2f\xfd") {
        return ("Zstandard compressed data".to_string(), "application/zstd", "binary");
    }
    if bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") {
        return ("Zip archive data".to_string(), "application/zip", "binary");
    }
    if bytes.starts_with(b"7z\xbc\xaf\x27\x1c") {
        return ("7-zip archive data".to_string(), "application/x-7z-compressed", "binary");
    }
    if (bytes.len() >= 14 && bytes.starts_with(b"Rar!\x1a\x07\x00"))
        || (bytes.len() >= 16 && bytes.starts_with(b"Rar!\x1a\x07\x01\x00"))
    {
        return ("RAR archive data".to_string(), "application/x-rar", "binary");
    }
    if bytes.len() >= 262 && &bytes[257..262] == b"ustar" {
        return ("POSIX tar archive".to_string(), "application/x-tar", "binary");
    }
    if bytes.len() >= 52
        && bytes.starts_with(b"\x7fELF")
        && matches!(bytes[4], 1 | 2)
        && matches!(bytes[5], 1 | 2)
        && bytes[6] == 1
        && (bytes[4] == 1 || bytes.len() >= 64)
    {
        let elf_type = if bytes[5] == 1 {
            u16::from_le_bytes([bytes[16], bytes[17]])
        } else {
            u16::from_be_bytes([bytes[16], bytes[17]])
        };
        let mime = match elf_type {
            1 => "application/x-object",
            2 => "application/x-executable",
            3 => "application/x-sharedlib",
            _ => "application/octet-stream",
        };
        let bits = if bytes[4] == 1 { "32" } else { "64" };
        let kind = match elf_type {
            2 => "executable",
            3 => "shared object",
            _ => "object",
        };
        return (format!("ELF {bits}-bit {kind}"), mime, "binary");
    }
    if bytes.len() >= 64 && &bytes[0..2] == b"MZ" {
        let offset = u32::from_le_bytes([bytes[60], bytes[61], bytes[62], bytes[63]]) as usize;
        if offset >= 64 && offset + 24 <= bytes.len() && &bytes[offset..offset + 4] == b"PE\x00\x00" {
            return (
                "PE executable".to_string(),
                "application/vnd.microsoft.portable-executable",
                "binary",
            );
        }
        return ("DOS executable".to_string(), "application/x-dosexec", "binary");
    }
    if bytes.starts_with(b"\x00asm") {
        return ("WebAssembly binary module".to_string(), "application/wasm", "binary");
    }
    if bytes.starts_with(b"SQLite format 3\x00") {
        return ("SQLite 3.x database".to_string(), "application/vnd.sqlite3", "binary");
    }
    if bytes.len() >= 512
        && bytes.starts_with(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
        && bytes[28..30] == [0xfe, 0xff]
    {
        return (
            "OLE Compound Document".to_string(),
            "application/x-ole-storage",
            "binary",
        );
    }
    if bytes.starts_with(&[0xff, 0xfe, 0x00, 0x00]) || bytes.starts_with(&[0x00, 0x00, 0xfe, 0xff]) {
        return ("data".to_string(), "application/octet-stream", "binary");
    }

    let mut encoding = "utf-8";
    let mut bom = 0usize;
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        bom = 3;
    } else if bytes.starts_with(&[0xff, 0xfe]) {
        encoding = "utf-16le";
        bom = 2;
    } else if bytes.starts_with(&[0xfe, 0xff]) {
        encoding = "utf-16be";
        bom = 2;
    }

    let text: String = if encoding == "utf-16le" || encoding == "utf-16be" {
        let payload = &bytes[bom..];
        if payload.len() % 2 != 0 {
            return ("data".to_string(), "application/octet-stream", "binary");
        }
        let units: Vec<u16> = payload
            .as_chunks::<2>().0.iter()
            .map(|c| {
                if encoding == "utf-16le" {
                    u16::from_le_bytes([c[0], c[1]])
                } else {
                    u16::from_be_bytes([c[0], c[1]])
                }
            })
            .collect();
        match String::from_utf16(&units) {
            Ok(s) => s,
            Err(_) => return ("data".to_string(), "application/octet-stream", "binary"),
        }
    } else {
        match std::str::from_utf8(&bytes[bom..]) {
            Ok(s) => s.to_string(),
            Err(_) => {
                if bom > 0 {
                    return ("data".to_string(), "application/octet-stream", "binary");
                }
                encoding = "iso-8859-1";
                bytes.iter().map(|&b| b as char).collect()
            }
        }
    };

    if text.is_empty() && bytes.len() > bom {
        return ("data".to_string(), "application/octet-stream", "binary");
    }
    for ch in text.chars() {
        let code = ch as u32;
        if (code < 32 && !matches!(code, 8 | 9 | 10 | 12 | 13 | 27))
            || (127..=159).contains(&code)
        {
            return ("data".to_string(), "application/octet-stream", "binary");
        }
    }
    if bom == 0 && encoding == "utf-8" && bytes.iter().all(|&b| b < 128) {
        encoding = "us-ascii";
    }
    let trimmed = text.trim_start_matches([' ', '\t', '\r', '\n']);
    if (trimmed.starts_with('{') || trimmed.starts_with('['))
        && mcp_protocol_rust::json::parse(text.as_bytes(), mcp_protocol_rust::json::Limits::default()).is_ok()
    {
        return ("JSON text data".to_string(), "application/json", encoding);
    }
    let base_desc = match encoding {
        "us-ascii" => "ASCII text",
        "iso-8859-1" => "ISO-8859 text",
        "utf-8" => "Unicode text, UTF-8",
        "utf-16le" => "Unicode text, UTF-16, little-endian",
        "utf-16be" => "Unicode text, UTF-16, big-endian",
        _ => "ASCII text",
    };
    if let Some((fmt_desc, fmt_mime)) = detect_text_format(&text) {
        (format!("{fmt_desc}, {base_desc}"), fmt_mime, encoding)
    } else {
        (base_desc.to_string(), "text/plain", encoding)
    }
}

#[derive(Clone)]
struct FileFormatOpts {
    brief: bool,
    follow: bool,
    mime_type: bool,
    mime_encoding: bool,
    separator: String,
    print0: usize,
}

fn cmd_file(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut fmt = FileFormatOpts {
        brief: false,
        follow: false,
        mime_type: false,
        mime_encoding: false,
        separator: ":".to_string(),
        print0: 0,
    };
    let mut listed: Vec<(String, FileFormatOpts)> = Vec::new();
    let mut names: Vec<String> = Vec::new();
    let mut stdin_used = false;
    let mut has_list = false;
    let mut action: Option<&'static str> = None;
    let mut options = true;
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if options && a == "--" {
            options = false;
            i += 1;
            continue;
        }
        if !options || !a.starts_with('-') || a == "-" {
            names.push(a.clone());
            i += 1;
            continue;
        }
        let long = a.starts_with("--");
        let eq = if long { a.find('=') } else { None };
        let flags: Vec<String> = if long {
            vec![match eq {
                Some(idx) => a[..idx].to_string(),
                None => a.clone(),
            }]
        } else {
            a[1..].chars().map(|c| format!("-{c}")).collect()
        };
        for (pos, flag) in flags.iter().enumerate() {
            if flag == "-F" || flag == "--separator" || flag == "-f" || flag == "--files-from" {
                let attached = if long {
                    eq.map(|idx| a[idx + 1..].to_string())
                } else if pos + 1 < flags.len() {
                    Some(a[pos + 2..].to_string())
                } else {
                    None
                };
                let val = match attached {
                    Some(v) => v,
                    None if i + 1 < args.len() => {
                        i += 1;
                        args[i].clone()
                    }
                    None => return err_out(&format!("file: option '{flag}' requires an argument\n"), 2),
                };
                if flag == "-F" || flag == "--separator" {
                    fmt.separator = val;
                } else {
                    has_list = true;
                    let list_text = if val == "-" {
                        if stdin_used {
                            String::new()
                        } else {
                            stdin_used = true;
                            stdin.to_string()
                        }
                    } else {
                        let p = resolve_posix_path(cwd, &val);
                        match fs.read_file(&p) {
                            Ok(b) => String::from_utf8_lossy(&b).into_owned(),
                            Err(e) => return err_out(&format!("file: {val}: {e}\n"), 1),
                        }
                    };
                    let snap = fmt.clone();
                    for line in list_text.lines() {
                        listed.push((line.to_string(), snap.clone()));
                    }
                }
                break;
            }
            if long && eq.is_some() {
                return err_out(&format!("file: unsupported option '{a}'\n"), 2);
            }
            match flag.as_str() {
                "-b" | "--brief" => fmt.brief = true,
                "-L" | "--dereference" => fmt.follow = true,
                "-h" | "--no-dereference" => fmt.follow = false,
                "-i" | "--mime" => {
                    fmt.mime_type = true;
                    fmt.mime_encoding = true;
                }
                "--mime-type" => fmt.mime_type = true,
                "--mime-encoding" => fmt.mime_encoding = true,
                "-0" | "--print0" => fmt.print0 = (fmt.print0 + 1).min(2),
                "--help" => action = Some("help"),
                "--version" => action = Some("version"),
                _ => return err_out(&format!("file: unsupported option '{flag}'\n"), 2),
            }
        }
        i += 1;
    }

    if let Some(act) = action {
        if act == "help" {
            return ok_out("Usage: file [-bihL0] [-F SEPARATOR] [-f NAMEFILE] [--mime-type] [--mime-encoding] [--] FILE...\nClassify bounded VFS content; '-' reads stdin. -h is the default.\nOptions: --brief, --mime, --dereference, --no-dereference, --separator, --print0, --files-from, --help, --version\nNo decompression, external magic database, or complete format validation.\n");
        }
        return ok_out("file (virtual-bash-file-v1)\n");
    }

    let mut all_items: Vec<(String, FileFormatOpts)> = listed;
    for n in names {
        all_items.push((n, fmt.clone()));
    }
    if all_items.is_empty() && !has_list {
        return err_out("file: missing file operand (use '-' for stdin)\n", 2);
    }

    let mut out = String::new();
    for (name, fopts) in all_items {
        let describe = !fopts.mime_type && !fopts.mime_encoding;
        let content: String = if name == "-" {
            let (desc, mime, enc) = if stdin_used {
                classify_file_bytes(&[])
            } else {
                stdin_used = true;
                let raw = crate::vfs::stream_string_to_bytes(stdin);
                classify_file_bytes(&raw)
            };
            if fopts.mime_type && fopts.mime_encoding {
                format!("{mime}; charset={enc}")
            } else if fopts.mime_type {
                mime.to_string()
            } else if fopts.mime_encoding {
                enc.to_string()
            } else {
                desc
            }
        } else {
            let p = resolve_posix_path(cwd, &name);
            let st_res = if fopts.follow { fs.stat(&p) } else { fs.lstat(&p) };
            match st_res {
                Err(_) => format!("cannot open `{name}' (No such file or directory)"),
                Ok(st) => {
                    let (desc, mime, enc) = match st.kind {
                        VfsEntryKind::Directory => (
                            "directory".to_string(),
                            "inode/directory",
                            "binary",
                        ),
                        VfsEntryKind::Symlink => {
                            let target = fs.readlink(&p).unwrap_or_default();
                            let d = if describe && !target.is_empty() {
                                format!("symbolic link to {target}")
                            } else {
                                "symbolic link".to_string()
                            };
                            (d, "inode/symlink", "binary")
                        }
                        VfsEntryKind::File => {
                            if (st.mode & 0o170000) == 0o020000 {
                                (
                                    "character special".to_string(),
                                    "inode/chardevice",
                                    "binary",
                                )
                            } else {
                                let bytes = fs.read_file(&p).unwrap_or_default();
                                classify_file_bytes(&bytes)
                            }
                        }
                    };
                    if fopts.mime_type && fopts.mime_encoding {
                        format!("{mime}; charset={enc}")
                    } else if fopts.mime_type {
                        mime.to_string()
                    } else if fopts.mime_encoding {
                        enc.to_string()
                    } else {
                        desc
                    }
                }
            }
        };
        let label = if fopts.brief || name.is_empty() {
            String::new()
        } else {
            let disp = if name == "-" { "/dev/stdin" } else { name.as_str() };
            let nul_after = if fopts.print0 > 0 { "\0" } else { "" };
            let sep_part = if fopts.print0 >= 2 {
                String::new()
            } else {
                format!("{} ", fopts.separator)
            };
            format!("{disp}{nul_after}{sep_part}")
        };
        let term = if fopts.print0 >= 2 { "\0" } else { "\n" };
        out.push_str(&format!("{label}{content}{term}"));
    }
    ok_out(&out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::MemoryVfs;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn access_time_belongs_to_the_inode_and_filesystem() {
        let first = MemoryVfs::new();
        let second = MemoryVfs::new();
        for fs in [&first, &second] {
            fs.write_file("/clock", b"x").unwrap();
        }
        first.hard_link("/clock", "/alias").unwrap();
        let touched = cmd_touch(&args(&["-a", "-t", "200001010000", "/clock"]), "/", &BTreeMap::new(), &first);
        assert_eq!(touched.exit_code, 0, "{}", touched.stderr);
        let listing = |fs: &MemoryVfs, path| cmd_ls(&args(&["-lu", path]), "/", fs).stdout;
        assert_eq!(second.stat("/clock").unwrap().atime_ms, second.stat("/clock").unwrap().mtime_ms);
        assert!(listing(&first, "/alias").contains("2000-01-01 00:00"));
        first.remove_one("/clock", false).unwrap();
        first.write_file("/clock", b"new").unwrap();
        assert_eq!(first.stat("/clock").unwrap().atime_ms, first.stat("/clock").unwrap().mtime_ms);
    }

    #[test]
    fn ls_directory_reads_are_lexical_even_without_a_sort_key() {
        let fs = MemoryVfs::new();
        fs.write_file("/alpha", b"").unwrap();
        fs.write_file("/\u{10000}", b"").unwrap();
        fs.write_file("/\u{e000}", b"").unwrap();
        assert_eq!(cmd_ls(&args(&["-U"]), "/", &fs).stdout, "alpha\ndev\n\\360\\220\\200\\200\n\\356\\200\\200\n");
        fs.symlink(".", "/cycle").unwrap();
        let result = cmd_ls(&args(&["-LR"]), "/", &fs);
        assert_eq!(result.stderr, "ls: ELOOP: too many symbolic links encountered '/cycle'\n");
        assert!(!result.stdout.contains("/cycle:"));
    }

    #[test]
    fn ls_long_rows_follow_links_only_when_requested() {
        let fs = MemoryVfs::new();
        fs.write_file("/d/prog", &vec![0; 1025]).unwrap();
        fs.chmod("/d/prog", 0o4755).unwrap();
        fs.hard_link("/d/prog", "/d/also").unwrap();
        fs.symlink("prog", "/d/link").unwrap();
        fs.set_mtime("/d/prog", 0).unwrap();
        let ls = |flags, path| cmd_ls(&args(&[flags, path]), "/", &fs);
        assert_eq!(ls("-lhFQ", "/d/prog").stdout, "-rwsr-xr-x 2 0 0 1.1K 1970-01-01 00:00 \"/d/prog\"*\n");
        assert!(ls("-lF", "/d/link").stdout.ends_with(" /d/link -> prog*\n"));
        assert_eq!(ls("-liL", "/d/link").stdout.split_once(' ').unwrap().0, ls("-i", "/d/also").stdout.split_once(' ').unwrap().0);
        fs.symlink("absent", "/d/dangling").unwrap();
        let failed = ls("-lL", "/d");
        assert_eq!((failed.stdout.as_str(), failed.stderr.as_str()), ("", "ls: ENOENT: no such file or directory, stat '/d/dangling'\n"));
    }

    #[test]
    fn ls_rejects_unsupported_options_before_listing() {
        let fs = MemoryVfs::new();
        for ch in "sgonCxmkqNbH".chars() {
            let result = cmd_ls(&[format!("-l{ch}"), "missing".into()], "/", &fs);
            assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr), (2, "", format!("ls: invalid option -- '{ch}'\n")));
        }
        assert_eq!(cmd_ls(&args(&["--sort"]), "/", &fs).stderr, "ls: --sort requires 'time' or 'size'\n");
        assert_eq!(cmd_ls(&args(&["--indicator-style="]), "/", &fs).stderr, "ls: ambiguous argument '' for '--indicator-style'\nValid arguments are:\n  - 'none'\n  - 'slash'\n  - 'file-type'\n  - 'classify'\nTry 'ls --help' for more information.\n");
    }

    #[test]
    fn mv_preserves_file_identity_and_refuses_to_merge_existing_trees() {
        let fs = MemoryVfs::new();
        fs.write_file("/from", b"one").unwrap();
        fs.hard_link("/from", "/alias").unwrap();
        fs.write_file("/to", b"two").unwrap();
        let result = cmd_mv(&args(&["from", "to"]), "", "/", &BTreeMap::new(), &fs);
        assert_eq!(result.exit_code, 0);
        fs.write_file("/to", b"moved").unwrap();
        assert_eq!(fs.read_file("/alias").unwrap(), b"moved");

        fs.write_file("/tree/file", b"source").unwrap();
        fs.write_file("/dir/tree/file", b"keep").unwrap();
        let result = cmd_mv(&args(&["tree", "dir"]), "", "/", &BTreeMap::new(), &fs);
        assert_eq!(result.exit_code, 1);
        assert_eq!(result.stderr, "mv: ENOTEMPTY: directory not empty, rename '/tree' -> '/dir/tree'\n");
        assert_eq!(fs.read_file("/tree/file").unwrap(), b"source");
        assert_eq!(fs.read_file("/dir/tree/file").unwrap(), b"keep");
    }

    #[test]
    fn mv_inspects_destination_components_before_interpreting_parent_paths() {
        let fs = MemoryVfs::new();
        fs.write_file("/src", b"keep").unwrap();
        fs.write_file("/tree/file", b"existing").unwrap();
        for (path, error) in [
            ("tree/missing/..", "mv: ENOENT: no such file or directory, rename '/src' -> '/tree/missing/..'\n"),
            ("tree/file/.", "mv: ENOTDIR: not a directory, lstat '/tree/file/.'\n"),
        ] {
            let result = cmd_mv(&args(&["src", path]), "", "/", &BTreeMap::new(), &fs);
            assert_eq!(result.stderr, error);
            assert_eq!(result.exit_code, 1);
            assert_eq!(fs.read_file("/src").unwrap(), b"keep");
        }
    }

    #[test]
    fn mv_dot_destination_matches_memory_directory_entry_lookup() {
        let fs = MemoryVfs::new();
        fs.write_file("/src", b"keep").unwrap();
        fs.mkdir_all("/tree").unwrap();
        let args = args(&["src", "tree/."]);
        let plain = cmd_mv(&args, "", "/", &BTreeMap::new(), &fs);
        assert_eq!(plain.stderr, "mv: EINVAL: invalid argument, rename '/src' -> '/tree/.'\n");
        assert_eq!(fs.read_file("/src").unwrap(), b"keep");

        let repeated = cmd_mv(&["src".into(), "tree//.".into()], "", "/", &BTreeMap::new(), &fs);
        assert_eq!(repeated.exit_code, 0, "{}", repeated.stderr);
        fs.rename("/tree/src", "/src", false).unwrap();
        fs.symlink("tree", "/link").unwrap();
        let linked = cmd_mv(&args, "", "/", &BTreeMap::new(), &fs);
        assert_eq!(linked.exit_code, 0, "{}", linked.stderr);
        assert_eq!(fs.read_file("/tree/src").unwrap(), b"keep");
    }

    #[test]
    fn mv_across_mounts_publishes_before_removal_and_keeps_other_names() {
        use crate::vfs::MountVfs;
        use std::sync::Arc;
        let root = Arc::new(MemoryVfs::new());
        let dest = Arc::new(MemoryVfs::new());
        let fs = MountVfs::new(root.clone()).with_mount("/mnt", dest.clone());
        root.write_file("/tree/file", b"source").unwrap();
        root.hard_link("/tree/file", "/peer").unwrap();
        root.chmod("/tree/file", 0o640).unwrap();
        root.symlink("file", "/tree/link").unwrap();
        dest.write_file("/dest", b"old").unwrap();
        dest.hard_link("/dest", "/old-link").unwrap();
        let mv = |args_in: &[&str]| cmd_mv(&args(args_in), "", "/", &BTreeMap::new(), &fs);
        dest.chmod("/dest", 0o400).unwrap();
        root.chmod("/peer", 0o200).unwrap();
        let denied = mv(&["-b", "/peer", "/mnt/dest"]);
        assert_eq!(denied.stderr, "mv: EACCES: permission denied, openReadFile '/peer'\n");
        assert!(root.exists("/peer"));
        assert_eq!(dest.read_file("/dest").unwrap(), b"old");
        assert!(!dest.exists("/dest~"));
        root.chmod("/peer", 0o640).unwrap();
        let moved = mv(&["/peer", "/mnt/dest"]);
        assert_eq!(moved.exit_code, 0, "{}", moved.stderr);
        assert!(!root.exists("/peer"));
        assert_eq!(dest.read_file("/dest").unwrap(), b"source");
        assert_eq!(dest.read_file("/old-link").unwrap(), b"old");
        assert_eq!(dest.stat("/dest").unwrap().mode & 0o777, 0o640);

        dest.set_max_file_bytes(2);
        assert_ne!(mv(&["/tree", "/mnt/new"]).exit_code, 0);
        assert_eq!(root.read_file("/tree/file").unwrap(), b"source");
        assert!(!dest.exists("/new"));
        dest.set_max_file_bytes(64);
        let moved = mv(&["/tree", "/mnt/new"]);
        assert_eq!(moved.exit_code, 0, "{}", moved.stderr);
        assert!(!root.exists("/tree"));
        assert_eq!(dest.readlink("/new/link").unwrap(), "file");
        assert_eq!(dest.read_file("/new/file").unwrap(), b"source");
    }

    #[test]
    fn mv_keeps_backup_aliases_and_restores_destination_when_rename_fails() {
        let fs = MemoryVfs::new();
        fs.write_file("/from", b"new").unwrap();
        fs.write_file("/to", b"old").unwrap();
        fs.hard_link("/to", "/old-alias").unwrap();
        let result = cmd_mv(&args(&["-b", "from", "to"]), "", "/", &BTreeMap::new(), &fs);
        assert_eq!(result.exit_code, 0);
        fs.write_file("/to~", b"saved").unwrap();
        assert_eq!(fs.read_file("/old-alias").unwrap(), b"saved");

        fs.write_file("/locked/file", b"keep").unwrap();
        fs.chmod("/locked", 0o555).unwrap();
        let failed = cmd_mv(&args(&["-b", "locked/file", "to"]), "", "/", &BTreeMap::new(), &fs);
        assert_eq!(failed.exit_code, 1);
        assert_eq!(fs.read_file("/to").unwrap(), b"new");
        assert_eq!(fs.read_file("/locked/file").unwrap(), b"keep");
    }

    #[test]
    fn backup_selection_rejects_ambiguous_controls_and_increments_large_numbers() {
        let fs = MemoryVfs::new();
        let nines = "9".repeat(30);
        fs.write_file("/src", b"NEW").unwrap();
        fs.write_file("/dst", b"OLD").unwrap();
        fs.write_file(&format!("/dst.~{nines}~"), b"earlier").unwrap();
        for cmd in ["cp", "mv", "ln"] {
            let r = try_run_fs_command(cmd, &args(&["--backup=n", "/src", "/dst"]), "", "/", &BTreeMap::new(), &fs).unwrap();
            assert_eq!(r.exit_code, 2);
            assert_eq!(fs.read_file("/dst").unwrap(), b"OLD");
        }
        let r = cmd_cp(&args(&["--backup=nu", "/src", "/dst"]), "", "/", &BTreeMap::new(), &fs);
        assert_eq!(r.exit_code, 0);
        assert_eq!(fs.read_file(&format!("/dst.~1{}~", "0".repeat(30))).unwrap(), b"OLD");
    }

    #[test]
    fn backup_aliases_must_remain_intact_when_the_destination_is_still_linked() {
        let fs = MemoryVfs::new();
        fs.write_file("/src", b"NEW").unwrap();
        fs.write_file("/dst", b"OLD").unwrap();
        assert_eq!(cmd_ln(&args(&["/dst", "/dst~"]), "", "/", &BTreeMap::new(), &fs).exit_code, 0);
        for cmd in ["cp", "ln"] {
            let r = try_run_fs_command(cmd, &args(&["-b", "/src", "/dst"]), "", "/", &BTreeMap::new(), &fs).unwrap();
            assert_eq!(r.exit_code, 1);
            assert_eq!(fs.read_file("/dst~").unwrap(), b"OLD");
            assert_eq!(fs.read_file("/dst").unwrap(), b"OLD");
        }
    }

    #[test]
    fn backups_never_overwrite_the_source_and_retain_the_original_entry() {
        let fs = MemoryVfs::new();
        fs.write_file("/file~", b"SOURCE").unwrap();
        fs.write_file("/file", b"OLD").unwrap();
        for cmd in ["ln", "cp"] {
            let result = try_run_fs_command(cmd, &args(&["-b", "/file~", "/file"]), "", "/", &BTreeMap::new(), &fs).unwrap();
            assert_eq!(result.exit_code, 1, "{cmd}");
            assert_eq!(fs.read_file("/file~").unwrap(), b"SOURCE");
            assert_eq!(fs.read_file("/file").unwrap(), b"OLD");
        }
        fs.symlink("file", "/alias").unwrap();
        let before = fs.lstat("/alias").unwrap().identity;
        let result = cmd_cp(&args(&["-b", "/file~", "/alias"]), "", "/", &BTreeMap::new(), &fs);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(fs.lstat("/alias~").unwrap().identity, before);
        assert_eq!(fs.readlink("/alias~").unwrap(), "file");
        assert_eq!(fs.read_file("/file").unwrap(), b"OLD");
        assert_eq!(fs.read_file("/alias").unwrap(), b"SOURCE");
    }

    #[test]
    fn recursive_copy_backs_up_replaced_children_and_keeps_the_existing_directory() {
        let fs = MemoryVfs::new();
        fs.write_file("/src/a", b"NEW").unwrap();
        fs.write_file("/dst/a", b"OLD").unwrap();
        let result = cmd_cp(&args(&["-RbT", "/src", "/dst"]), "", "/", &BTreeMap::new(), &fs);
        assert_eq!(result.exit_code, 0);
        assert_eq!(fs.read_file("/dst/a~").unwrap(), b"OLD");
        assert!(!fs.exists("/dst~"));
        assert_eq!(fs.read_file("/dst/a").unwrap(), b"NEW");
    }

    #[test]
    fn attributes_only_keeps_existing_contents_and_does_not_read_source_data() {
        let fs = MemoryVfs::new();
        fs.write_file("/src/a", b"NEW").unwrap();
        fs.write_file("/dst/a", b"KEEP").unwrap();
        fs.chmod("/src/a", 0o200).unwrap();
        fs.chmod("/dst/a", 0o400).unwrap();
        fs.set_mtime("/src/a", 1234).unwrap();
        fs.set_mtime("/dst/a", 5678).unwrap();
        let copy = |argv: &[&str]| cmd_cp(&args(argv), "", "/", &BTreeMap::new(), &fs);
        for argv in [["--attributes-only", "-f", "/src/a", "/dst/a"], ["--attributes-only", "-RT", "/src", "/dst"]] {
            let result = copy(&argv);
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            let st = fs.stat("/dst/a").unwrap();
            assert_eq!((st.mode & 0o777, st.mtime_ms), (0o400, 5678.0));
            assert_eq!(fs.read_file("/dst/a").unwrap(), b"KEEP");
        }
        let result = copy(&["--attributes-only", "-RbT", "/src", "/dst"]);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(fs.read_file("/dst/a~").unwrap(), b"KEEP");
        assert_eq!(fs.stat("/dst/a").unwrap().mode & 0o777, 0o200);
        assert!(fs.read_file("/dst/a").unwrap().is_empty());
    }

    #[test]
    fn cp_rejects_unsupported_symlink_timestamps_before_changing_any_operand() {
        let fs = MemoryVfs::new();
        fs.write_file("/src/a", b"NEW").unwrap();
        fs.write_file("/dst/a", b"KEEP").unwrap();
        fs.symlink("a", "/src/z").unwrap();
        let copy = |argv: &[&str]| cmd_cp(&args(argv), "", "/", &BTreeMap::new(), &fs);
        for argv in [vec!["-Rpv", "/src", "/dst"], vec!["-HpbR", "/src", "/dst"], vec!["-Rpv", "/absent", "/src/a", "/src/z", "/dst"]] {
            let r = copy(&argv);
            let target = if argv.len() == 3 { "/dst/src/z" } else { "/dst/z" };
            assert_eq!(r.stderr, format!("cp: ENOTSUP: operation not supported, utimes '{target}'\n"));
            assert_eq!(r.stdout, "");
            assert!(!fs.exists("/dst/src"));
            assert_eq!(fs.read_file("/dst/a").unwrap(), b"KEEP");
        }
        let result = copy(&["-RpnT", "/src", "/dst"]);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert!(!fs.exists("/dst/z"));
        assert_eq!(copy(&["-RLp", "/src", "/new"]).exit_code, 0);
        assert_eq!(fs.read_file("/new/z").unwrap(), b"NEW");
    }

    #[test]
    fn link_operands_check_each_parent_before_dot_dot_and_keep_relative_link_text() {
        let fs = MemoryVfs::new();
        fs.write_file("/w/file", b"OUTER").unwrap();
        fs.write_file("/w/real/file", b"INNER").unwrap();
        fs.mkdir_all("/w/real/sub").unwrap();
        fs.symlink("real/sub", "/w/alias").unwrap();
        fs.write_file("/w/dst", b"KEEP").unwrap();
        fs.mkdir_all("/w/private").unwrap();
        fs.chmod("/w/private", 0o400).unwrap();
        let run = |argv: &[&str]| cmd_ln(&args(argv), "", "/w", &BTreeMap::new(), &fs);
        assert_eq!(run(&["-Pf", "private/../file", "dst"]).stderr, "ln: EACCES: permission denied, lstat '/w/private/../file'\n");
        assert_eq!(run(&["-sf", "file", "missing/../dst"]).stderr, "ln: ENOENT: no such file or directory, symlink '/w/missing/../dst'\n");
        assert_eq!(fs.read_file("/w/dst").unwrap(), b"KEEP");
        assert_eq!(run(&["-Pf", "alias/../file", "out"]).exit_code, 0);
        assert_eq!(fs.read_file("/w/out").unwrap(), b"INNER");
        assert_eq!(run(&["-srf", "alias/../file", "dst"]).exit_code, 0);
        assert_eq!(fs.readlink("/w/dst").unwrap(), "real/file");
        assert_eq!(run(&["-srfT", "alias/../file", "alias"]).exit_code, 0);
        assert_eq!(fs.readlink("/w/alias").unwrap(), "real/file");
    }

    #[test]
    fn hard_links_share_inodes_without_interpreting_symbolic_link_text() {
        let fs = MemoryVfs::new();
        fs.write_file("/file", b"data").unwrap();
        fs.symlink("__hardlink__:/file", "/literal").unwrap();
        assert_eq!(fs.readlink("/literal").unwrap(), "__hardlink__:/file");
        fs.symlink("file", "/src").unwrap();
        let result = cmd_ln(&args(&["-P", "/src", "/alias"]), "", "/", &BTreeMap::new(), &fs);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(fs.lstat("/src").unwrap().identity, fs.lstat("/alias").unwrap().identity);
        fs.rename("/src", "/alias", false).unwrap();
        for p in ["/src", "/alias"] { assert_eq!(fs.readlink(p).unwrap(), "file"); }
        let snapshot = fs.export_entries().unwrap();
        let other = MemoryVfs::new();
        other.replace_entries(&snapshot).unwrap();
        assert_eq!(other.lstat("/src").unwrap().identity, other.lstat("/alias").unwrap().identity);
        assert_eq!(other.readlink("/literal").unwrap(), "__hardlink__:/file");
    }

    #[test]
    fn archive_links_copied_entries_to_each_other_without_linking_back_to_source() {
        let fs = MemoryVfs::new();
        fs.write_file("/src/a", b"NEW").unwrap();
        fs.hard_link("/src/a", "/src/b").unwrap();
        fs.symlink("a", "/src/s").unwrap();
        fs.hard_link("/src/s", "/src/t").unwrap();
        fs.write_file("/dst/a", b"OLD").unwrap();
        fs.mkdir_all("/dst/keep").unwrap();
        fs.symlink("keep", "/dst/b").unwrap();
        let r = cmd_cp(&args(&["-abT", "/src", "/dst"]), "", "/", &BTreeMap::new(), &fs);
        assert_eq!(r.exit_code, 0, "{}", r.stderr);
        for (a, b) in [("a", "b"), ("s", "t")] {
            let stat = |dir: &str, name: &str| fs.lstat(&format!("/{dir}/{name}")).unwrap();
            assert_ne!(stat("dst", a).identity, stat("src", a).identity);
            assert_eq!(stat("dst", a).identity, stat("dst", b).identity);
            assert_eq!(stat("dst", a).nlink, Some(2));
        }
        assert_eq!(fs.readlink("/dst/b~").unwrap(), "keep");
        assert!(fs.is_dir("/dst/keep"));
    }

    #[test]
    fn preserve_links_rejects_unsupported_aliases_before_copying_earlier_operands() {
        let lower = MemoryVfs::new();
        lower.write_file("/first", b"A").unwrap();
        lower.hard_link("/first", "/second").unwrap();
        lower.mkdir_all("/dst").unwrap();
        let fs = crate::vfs::OverlayVfs::new(std::sync::Arc::new(lower), std::sync::Arc::new(MemoryVfs::new()));
        let r = cmd_cp(&args(&["--preserve=links", "/first", "/second", "/dst"]), "", "/", &BTreeMap::new(), &fs);
        assert_eq!(r.stderr, "cp: ENOTSUP: operation not supported, cp '/dst/first'\n");
        assert!(!fs.exists("/dst/first"));
    }

    #[test]
    fn copy_does_not_dereference_an_overlay_symlink_unconfirmed_by_its_layer() {
        let lower = MemoryVfs::new();
        lower.write_file("/src/below/data", b"lower").unwrap();
        let upper = MemoryVfs::new();
        upper.symlink("below", "/src/a").unwrap();
        let fs = crate::vfs::OverlayVfs::new(std::sync::Arc::new(lower), std::sync::Arc::new(upper));
        let r = cmd_cp(&args(&["-RL", "/src", "/dst"]), "", "/", &BTreeMap::new(), &fs);
        assert_eq!(r.stderr, "cp: ENOENT: no such file or directory, realpath '/src/a'\n");
        assert_eq!(r.exit_code, 1);
        assert!(!fs.exists("/dst/a"));
        assert_eq!(fs.readlink("/src/a").unwrap(), "below");
    }

    #[test]
    fn copy_one_file_system_keeps_mount_directories_and_resets_the_boundary_per_operand() {
        let root = MemoryVfs::new();
        root.write_file("/src/plain", b"root").unwrap();
        root.mkdir_all("/dst").unwrap();
        let other = MemoryVfs::new();
        other.write_file("/nested/data", b"mounted").unwrap();
        let fs = crate::vfs::MountVfs::new(std::sync::Arc::new(root))
            .with_mount("/src/volume", std::sync::Arc::new(other));
        for flag in ["-Rx", "--one-file-system"] {
            let r = cmd_cp(&args(&[flag, "-av", "/src", "/src/volume", "/dst"]), "", "/", &BTreeMap::new(), &fs);
            assert_eq!(r.exit_code, 0, "{}", r.stderr);
            assert_eq!(fs.read_file("/dst/src/plain").unwrap(), b"root");
            assert_eq!(fs.read_file("/dst/volume/nested/data").unwrap(), b"mounted");
            assert!(fs.list_dir("/dst/src/volume").unwrap().is_empty());
            assert!(r.stdout.contains("'/src/volume' -> '/dst/src/volume'"));
        }
    }

    #[test]
    fn recursive_hardlink_copy_links_the_selected_entry() {
        for (flags, physical) in [("-RPlT", true), ("-RLlT", false)] {
            let fs = MemoryVfs::new();
            fs.write_file("/src/a", b"DATA").unwrap();
            fs.symlink("a", "/src/l").unwrap();
            let r = cmd_cp(&args(&[flags, "/src", "/dst"]), "", "/", &BTreeMap::new(), &fs);
            assert_eq!(r.exit_code, 0, "{}", r.stderr);
            assert_eq!(fs.lstat("/dst/a").unwrap().identity, fs.lstat("/src/a").unwrap().identity);
            assert_eq!(fs.lstat("/dst/l").unwrap().identity, fs.lstat(if physical { "/src/l" } else { "/src/a" }).unwrap().identity);
        }
    }

    #[test]
    fn logical_ln_resolves_source_before_removing_or_backing_up_any_name() {
        let fs = MemoryVfs::new();
        fs.write_file("/file", b"KEEP").unwrap();
        fs.symlink("file", "/alias").unwrap();
        fs.symlink("absent", "/dang").unwrap();
        let run = |argv: &[&str]| cmd_ln(&args(argv), "", "/", &BTreeMap::new(), &fs);
        for opt in ["-Lf", "-Lb"] {
            assert_eq!(run(&[opt, "/alias", "/file"]).stderr, "ln: EEXIST: file already exists '/file'\n");
            assert_eq!(run(&[opt, "/dang", "/file"]).stderr, "ln: ENOENT: no such file or directory, realpath '/dang'\n");
            assert_eq!(fs.read_file("/file").unwrap(), b"KEEP");
            assert!(fs.lstat("/file~").is_err());
        }
        assert_eq!(run(&["-Lb", "/alias", "/alias"]).exit_code, 0);
        assert_eq!(fs.readlink("/alias~").unwrap(), "file");
        assert_eq!(fs.lstat("/alias").unwrap().identity, fs.lstat("/file").unwrap().identity);
        assert_eq!(run(&["-Pf", "/file", "/alias"]).exit_code, 0);
        assert_eq!(fs.read_file("/alias").unwrap(), b"KEEP");
    }

    #[test]
    fn symbolic_copy_creates_directory_tree_and_links_to_source_operands() {
        let fs = MemoryVfs::new();
        fs.write_file("/src/sub/a", b"NEW").unwrap();
        fs.symlink("sub/a", "/src/ref").unwrap();
        fs.write_file("/dst/sub/a", b"KEEP").unwrap();
        let run = |argv: &[&str]| cmd_cp(&args(argv), "", "/", &BTreeMap::new(), &fs);
        assert_eq!(run(&["-sT", "/src", "/new"]).stderr, "cp: EISDIR: omitting directory (use -R) '/src'\n");
        assert!(!fs.exists("/new"));
        assert_eq!(run(&["-RsbT", "src", "dst"]).stderr, "cp: can make relative symbolic links only in current directory\n");
        assert!(!fs.exists("/dst/sub/a~"));
        let r = run(&["-RsbT", "/src", "/dst"]);
        assert_eq!(r.exit_code, 0, "{}", r.stderr);
        assert_eq!(fs.read_file("/dst/sub/a~").unwrap(), b"KEEP");
        assert_eq!(fs.readlink("/dst/sub/a").unwrap(), "/src/sub/a");
        assert_eq!(fs.readlink("/dst/ref").unwrap(), "/src/ref");
    }

    #[test]
    fn link_copy_must_not_unlink_a_followed_source_symlink() {
        let fs = MemoryVfs::new();
        fs.write_file("/file", b"DATA").unwrap();
        fs.symlink("file", "/alias").unwrap();
        for opt in ["-sb", "-lb"] {
            let r = cmd_cp(&args(&[opt, "/alias", "/alias"]), "", "/", &BTreeMap::new(), &fs);
            assert_eq!(r.stderr, "cp: ENOTSUP: link copy unlink lacks authoritative distinctness '/alias'\n");
            assert_eq!(fs.readlink("/alias").unwrap(), "file");
            assert!(fs.lstat("/alias~").is_err());
        }
    }

    #[test]
    fn copy_consumes_answers_in_javascript_filename_order() {
        let fs = MemoryVfs::new();
        for name in ["𐀀", "\u{e000}"] {
            fs.write_file(&format!("/src/{name}"), b"NEW").unwrap();
            fs.write_file(&format!("/dst/{name}"), b"OLD").unwrap();
        }
        let r = cmd_cp(&args(&["-RTi", "/src", "/dst"]), "n\ny\n", "/", &BTreeMap::new(), &fs);
        assert_eq!(r.exit_code, 1);
        assert_eq!(fs.read_file("/dst/𐀀").unwrap(), b"OLD");
        assert_eq!(fs.read_file("/dst/\u{e000}").unwrap(), b"NEW");
    }

    #[test]
    fn copy_messages_escape_newlines_and_non_ascii_names() {
        let fs = MemoryVfs::new();
        fs.write_file("/src", b"new").unwrap();
        fs.write_file("/é\na", b"old").unwrap();
        let r = cmd_cp(&args(&["-iv", "src", "é\na"]), "y", "/", &BTreeMap::new(), &fs);
        assert_eq!(r.exit_code, 0);
        assert_eq!(r.stderr, r"cp: overwrite ''$'\303\251\n''a'? ");
        assert_eq!(r.stdout, "'src' -> '\\303\\251\\na'\n");
    }

    #[test]
    fn recursive_interactive_copy_prompts_before_backups_and_reports_only_completed_entries() {
        let fs = MemoryVfs::new();
        fs.write_file("/src/a", b"A").unwrap();
        fs.write_file("/src/sub/b", b"B").unwrap();
        fs.write_file("/dst/a", b"KEEP").unwrap();
        fs.write_file("/dst/sub/b", b"OLD").unwrap();
        let r = cmd_cp(&args(&["-RTibv", "src", "dst"]), "n\ny\n", "/", &BTreeMap::new(), &fs);
        assert_eq!(r.exit_code, 1);
        assert_eq!(r.stderr, "cp: overwrite 'dst/a'? cp: overwrite 'dst/sub/b'? ");
        assert_eq!(r.stdout, "'src/sub/b' -> 'dst/sub/b'\n'src/sub' -> 'dst/sub'\n'src' -> 'dst'\n");
        assert_eq!(fs.read_file("/dst/a").unwrap(), b"KEEP");
        assert!(!fs.exists("/dst/a~"));
        assert_eq!(fs.read_file("/dst/sub/b~").unwrap(), b"OLD");
        assert_eq!(fs.read_file("/dst/sub/b").unwrap(), b"B");
    }

    #[test]
    fn copy_checks_source_identity_and_dangling_links_before_skipping() {
        let fs = MemoryVfs::new();
        fs.write_file("/file", b"KEEP").unwrap();
        fs.symlink("file", "/alias").unwrap();
        fs.symlink("absent", "/dang").unwrap();
        for opt in ["-n", "-u"] {
            for (src, dst, error) in [("/alias", "/file", "EINVAL: source and destination are the same file '/alias' -> '/file'"),
                ("/file", "/dang", "ENOENT: no such file or directory, realpath '/dang'")] {
                let r = cmd_cp(&args(&[opt, src, dst]), "", "/", &BTreeMap::new(), &fs);
                assert_eq!(r.stderr, format!("cp: {error}\n"));
                assert_eq!(r.exit_code, 1);
            }
        }
    }

    #[test]
    fn update_only_skips_newer_children_before_preserving_symlink_timestamps() {
        let fs = MemoryVfs::new();
        fs.write_file("/src/a", b"NEW").unwrap();
        fs.symlink("a", "/src/z").unwrap();
        fs.write_file("/dst/a", b"KEEP").unwrap();
        fs.write_file("/dst/z", b"KEEP").unwrap();
        for path in ["/dst/a", "/dst/z"] { fs.set_mtime(path, u64::MAX).unwrap(); }
        let r = cmd_cp(&args(&["-RpuT", "/src", "/dst"]), "", "/", &BTreeMap::new(), &fs);
        assert_eq!(r.exit_code, 0, "{}", r.stderr);
        assert_eq!(fs.read_file("/dst/a").unwrap(), b"KEEP");
        assert_eq!(fs.read_file("/dst/z").unwrap(), b"KEEP");
    }

    #[test]
    fn attributes_only_copies_symlinks_without_mutating_their_referents() {
        let fs = MemoryVfs::new();
        fs.write_file("/file", b"KEEP").unwrap();
        fs.symlink("file", "/src").unwrap();
        let copy = |argv: &[&str]| cmd_cp(&args(argv), "", "/", &BTreeMap::new(), &fs);
        assert_eq!(copy(&["--attributes-only", "-P", "/src", "/file"]).stderr, "cp: EEXIST: file already exists, symlink '/file'\n");
        assert_eq!(copy(&["--attributes-only", "-Ppb", "/src", "/file"]).stderr, "cp: ENOTSUP: operation not supported, utimes '/file'\n");
        assert!(!fs.exists("/file~"));
        assert_eq!(fs.read_file("/file").unwrap(), b"KEEP");
        let result = copy(&["--attributes-only", "-ab", "/src", "/dst"]);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(fs.readlink("/dst").unwrap(), "file");
    }

    #[test]
    fn cp_follows_destination_links_and_only_preserves_requested_metadata() {
        let fs = MemoryVfs::new();
        fs.write_file("/src", b"new").unwrap();
        fs.chmod("/src", 0o600).unwrap();
        fs.write_file("/dst", b"old").unwrap();
        fs.symlink("dst", "/link").unwrap();
        fs.symlink("missing", "/dang").unwrap();
        let copy = |flags: &[&str]| cmd_cp(&args(flags), "", "/", &BTreeMap::new(), &fs);
        assert_eq!(copy(&["/src", "/link"]).exit_code, 0);
        assert_eq!(fs.readlink("/link").unwrap(), "dst");
        assert_eq!(fs.read_file("/dst").unwrap(), b"new");
        assert_eq!(fs.stat("/dst").unwrap().mode & 0o777, 0o644);
        assert_eq!(copy(&["-p", "/src", "/link"]).exit_code, 0);
        assert_eq!(fs.stat("/dst").unwrap().mode & 0o777, 0o600);
        assert_eq!(copy(&["/src", "/dang"]).exit_code, 1);
        assert_eq!(fs.readlink("/dang").unwrap(), "missing");
        assert!(!fs.exists("/missing"));
        assert_eq!(copy(&["--remove-destination", "/src", "/dang"]).exit_code, 0);
        assert_eq!(fs.read_file("/dang").unwrap(), b"new");
    }

    #[test]
    fn recursive_cp_respects_existing_directory_permissions() {
        let fs = MemoryVfs::new();
        fs.write_file("/src/file", b"new").unwrap();
        fs.mkdir_all("/dst").unwrap();
        fs.chmod("/dst", 0o500).unwrap();
        for flag in ["-RT", "-aT"] {
            let r = cmd_cp(&args(&[flag, "/src", "/dst"]), "", "/", &BTreeMap::new(), &fs);
            assert_eq!(r.exit_code, 1);
            assert!(!fs.exists("/dst/file"));
            assert_eq!(fs.stat("/dst").unwrap().mode & 0o777, 0o500);
        }
        fs.chmod("/dst", 0o750).unwrap();
        fs.chmod("/src", 0o500).unwrap();
        for (flag, mode) in [("-RT", 0o750), ("-aT", 0o500)] {
            let r = cmd_cp(&args(&[flag, "/src", "/dst"]), "", "/", &BTreeMap::new(), &fs);
            assert_eq!(r.exit_code, 0, "{}", r.stderr);
            assert_eq!(fs.stat("/dst").unwrap().mode & 0o777, mode);
        }
    }

    #[test]
    fn copying_a_link_cannot_replace_a_nonempty_directory() {
        for argv in [["-P", "/src/item", "/dst"], ["-RT", "/src", "/dst"]] {
            let fs = MemoryVfs::new();
            fs.write_file("/dst/item/child", b"KEEP").unwrap();
            fs.symlink("target", "/src/item").unwrap();
            let result = cmd_cp(&args(&argv), "", "/", &BTreeMap::new(), &fs);
            assert_eq!(fs.read_file("/dst/item/child").unwrap(), b"KEEP");
            assert_eq!(result.exit_code, 1);
            assert_eq!(result.stderr, "cp: EISDIR: illegal operation on a directory '/dst/item'\n");
        }
    }

    #[test]
    fn unit_fs_commands_mkdir_cp_mv_ln_readlink_realpath_file_stat() {
        let vfs = MemoryVfs::new();
        let env = BTreeMap::new();

        let mkdir_out = try_run_fs_command("mkdir", &args(&["-p", "/work/sub"]), "", "/", &env, &vfs).unwrap();
        assert_eq!(mkdir_out.exit_code, 0);
        vfs.write_file("/work/sub/data.txt", b"hello world\n").unwrap();

        let cp_out = try_run_fs_command(
            "cp",
            &args(&["/work/sub/data.txt", "/work/copy.txt"]),
            "",
            "/",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(cp_out.exit_code, 0);
        assert_eq!(vfs.read_file("/work/copy.txt").unwrap(), b"hello world\n");

        let ln_out = try_run_fs_command(
            "ln",
            &args(&["-s", "sub/data.txt", "/work/link.txt"]),
            "",
            "/",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(ln_out.exit_code, 0);

        let rl_out = try_run_fs_command("readlink", &args(&["/work/link.txt"]), "", "/", &env, &vfs).unwrap();
        assert_eq!(rl_out.stdout, "sub/data.txt\n");

        let rp_out = try_run_fs_command("realpath", &args(&["/work/link.txt"]), "", "/", &env, &vfs).unwrap();
        assert_eq!(rp_out.stdout, "/work/sub/data.txt\n");

        let file_out = try_run_fs_command("file", &args(&["-b", "/work/copy.txt"]), "", "/", &env, &vfs).unwrap();
        assert_eq!(file_out.exit_code, 0);
        assert!(file_out.stdout.contains("ASCII text"));
    }


    #[test]
    fn unit_chmod_touch_rm_du_and_tree() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work/dir").unwrap();
        let env = BTreeMap::new();

        assert_eq!(
            try_run_fs_command("touch", &args(&["/work/dir/f.txt"]), "", "/work", &env, &vfs)
                .unwrap()
                .exit_code,
            0
        );
        assert!(vfs.exists("/work/dir/f.txt"));

        assert_eq!(
            try_run_fs_command("chmod", &args(&["755", "/work/dir/f.txt"]), "", "/work", &env, &vfs)
                .unwrap()
                .exit_code,
            0
        );
        assert_eq!(vfs.stat("/work/dir/f.txt").unwrap().mode & 0o777, 0o755);

        let tree_out = try_run_fs_command("tree", &args(&["/work"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(tree_out.exit_code, 0);
        assert!(tree_out.stdout.contains("f.txt"));

        assert_eq!(
            try_run_fs_command("rm", &args(&["-rf", "/work/dir"]), "", "/work", &env, &vfs)
                .unwrap()
                .exit_code,
            0
        );
        assert!(!vfs.exists("/work/dir"));
    }

    #[test]
    fn stat_walks_the_operand_before_applying_dot_dot_or_a_trailing_slash() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/w/d/inner").unwrap();
        fs.write_file("/w/d/f", b"f").unwrap();
        fs.symlink("d/inner", "/w/link").unwrap();
        let run = |opt: &str, name: &str| cmd_stat(&args(&[opt, "%F", name]), "/w", &BTreeMap::new(), &fs);
        assert_eq!(run("-c", "link/../f").stdout, "regular file\n");
        assert_eq!(run("-c", "link/").stdout, "directory\n");
        assert_eq!(run("-c", "missing/../d").stderr, "stat: ENOENT: no such file or directory, lstat '/w/missing/../d'\n");
        assert_eq!(run("-Lc", "d/f/.").stderr, "stat: ENOTDIR: not a directory, stat '/w/d/f/.'\n");
        assert_eq!(run("-c", "").stderr, "stat: ENOENT: no such file or directory ''\n");
    }

    #[test]
    fn stat_printf_preserves_raw_bytes_and_pads_truncated_names_by_byte_length() {
        let fs = MemoryVfs::new();
        fs.write_file("/é", b"a").unwrap();
        let got = cmd_stat(&args(&["--printf", r"\377\x80\000%3.1n|%-3.1n", "é"]), "/", &BTreeMap::new(), &fs);
        assert_eq!(got.exit_code, 0);
        assert_eq!(crate::vfs::stream_string_to_bytes(&got.stdout), b"\xff\x80\0  \xc3|\xc3  ");
    }

    #[test]
    fn terse_stat_marks_unknown_fields_and_defers_to_explicit_formats() {
        let fs = MemoryVfs::new();
        fs.set_devices(crate::vfs::memory::Devices::Null);
        let run = |opts: &[&str]| cmd_stat(&args(opts), "/", &BTreeMap::new(), &fs);
        assert_eq!(run(&["--terse", "/dev/null"]).stdout, "/dev/null 0 0 21b6 0 0 0 1 1 ? ? 0 0 0 0 ?\n");
        assert_eq!(run(&["-tfc", "%T", "/dev/null"]).stderr, "stat: ENOTSUP: filesystem does not expose its type, stat\n");
        assert_eq!(run(&["-ft", "/"]).stderr, "stat: ENOTSUP: filesystem terse stat is unsupported\n");
        assert_eq!(run(&["-tc", "%s", "/dev/null"]).stdout, "0\n");
    }

    #[test]
    fn stat_validates_options_before_inspecting_files() {
        let fs = MemoryVfs::new();
        for (options, reason) in [
            (vec!["/missing", "--format"], "missing format for '--format'"),
            (vec!["/missing", "-Lc"], "missing format for '-c'"),
            (vec!["/missing", "-qL"], "unrecognized option '-qL'"),
            (vec!["--cached=no", "/missing"], "unrecognized option '--cached=no'"),
        ] {
            let got = cmd_stat(&args(&options), "/", &BTreeMap::new(), &fs);
            assert_eq!((got.exit_code, got.stdout, got.stderr), (1, String::new(), format!("stat: {reason}\n")));
        }
        let got = cmd_stat(&args(&["--cached=never", "-c%n", "/"]), "/", &BTreeMap::new(), &fs);
        assert_eq!(got.stdout, "/\n");
    }

    #[test]
    fn stat_rejects_invalid_or_oversized_directives_before_formatting() {
        let fs = MemoryVfs::new();
        for (opt, fmt, reason) in [
            ("-c", "%é", "invalid stat format directive"),
            ("-f", "%é", "unsupported BSD stat format: %é"),
            ("-c", "%9999999999999999999999999s", "EFBIG: stat format width limit exceeded"),
            ("-c", "%.9999999999999999999999999Y", "EFBIG: stat format precision limit exceeded"),
            ("-c", "%2%", "invalid stat format directive"),
            ("-c", "%", "invalid stat format directive"),
            ("-c", "%q", "ENOTSUP: unsupported stat format: %q"),
        ] {
            let got = cmd_stat(&args(&[opt, fmt, "/"]), "/", &BTreeMap::new(), &fs);
            assert_eq!((got.exit_code, got.stdout, got.stderr), (1, String::new(), format!("stat: {reason}\n")));
        }
    }

    #[test]
    fn df_checks_path_components_before_selecting_a_mount() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/w/tree/dir").unwrap();
        fs.write_file("/w/tree/file", b"x").unwrap();
        fs.symlink("tree/dir", "/w/link").unwrap();
        let run = |p: &str| cmd_df(&args(&["--output=target", p]), "/w", &BTreeMap::new(), &fs);
        for path in ["/proc/", "tree/file/.", "missing/../tree"] {
            let result = run(path);
            assert_eq!((result.exit_code, result.stderr), (1, format!("df: '{path}': No such file or directory\n")));
        }
        assert_eq!(run("/proc").exit_code, 0);
        assert_eq!(run("link/../file").exit_code, 0);
    }

    #[test]
    fn unit_mktemp_df_rmdir_mv_and_stat_format() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/tmp").unwrap();
        vfs.mkdir_all("/work/empty").unwrap();
        let env = BTreeMap::new();

        let mkt = try_run_fs_command("mktemp", &args(&["-d", "/tmp/test.XXXXXX"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(mkt.exit_code, 0);
        let created_dir = mkt.stdout.trim();
        assert!(vfs.exists(created_dir));

        let df = try_run_fs_command("df", &args(&["-h"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(df.exit_code, 0);
        assert!(df.stdout.contains("Filesystem"));

        let rmdir = try_run_fs_command("rmdir", &args(&["/work/empty"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(rmdir.exit_code, 0);
        assert!(!vfs.exists("/work/empty"));

        vfs.write_file("/work/mod.wasm", b"\x00asm\x01\x00\x00\x00").unwrap();
        let f_wasm = try_run_fs_command("file", &args(&["-b", "/work/mod.wasm"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(f_wasm.exit_code, 0);
        assert_eq!(f_wasm.stdout, "WebAssembly binary module\n");
    }

    #[test]
    fn unit_install_symbolic_chmod_chained_symlinks_and_realpath_relative() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work/a/b").unwrap();
        vfs.mkdir_all("/work/c/d").unwrap();
        vfs.write_file("/work/a/b/file.txt", b"hello\n").unwrap();
        let env = BTreeMap::new();

        let ln1 = try_run_fs_command(
            "ln",
            &args(&["-s", "../../a/b/file.txt", "/work/c/d/rel.txt"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(ln1.exit_code, 0);

        let rl = try_run_fs_command("readlink", &args(&["-f", "/work/c/d/rel.txt"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(rl.exit_code, 0);
        assert_eq!(rl.stdout, "/work/a/b/file.txt\n");

        let rp = try_run_fs_command(
            "realpath",
            &args(&["--relative-to=/work/c/d", "/work/a/b/file.txt"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(rp.exit_code, 0);
        assert_eq!(rp.stdout, "../../a/b/file.txt\n");

        vfs.mkdir_all("/work/opt/bin").unwrap();
        let cp = try_run_fs_command(
            "cp",
            &args(&["/work/a/b/file.txt", "/work/opt/bin/run"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(cp.exit_code, 0);

        let ch = try_run_fs_command(
            "chmod",
            &args(&["u+rwx,g+r-wx,o-rwx", "/work/opt/bin/run"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(ch.exit_code, 0);
        let st = try_run_fs_command("stat", &args(&["-c", "%a:%A", "/work/opt/bin/run"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(st.stdout, "740:-rwxr-----\n");
    }

    #[test]
    fn unit_file_binary_signatures_and_char_device_classification() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        let env = BTreeMap::new();

        // BMP (header size 40 at offset 14)
        let mut bmp = vec![0u8; 26];
        bmp[0..2].copy_from_slice(b"BM");
        bmp[14..18].copy_from_slice(&40u32.to_le_bytes());
        vfs.write_file("/work/pic.bmp", &bmp).unwrap();

        // ICO (00 00 01 00, count 1 at offset 4)
        let mut ico = vec![0u8; 22];
        ico[0..6].copy_from_slice(&[0, 0, 1, 0, 1, 0]);
        vfs.write_file("/work/app.ico", &ico).unwrap();

        // RAR v5 (Rar!\x1a\x07\x01\x00 + 8 bytes)
        let mut rar = vec![0u8; 16];
        rar[0..8].copy_from_slice(b"Rar!\x1a\x07\x01\x00");
        vfs.write_file("/work/arch.rar", &rar).unwrap();

        // ELF 64-bit shared object (class=2, data=1, version=1, type=3 at offset 16)
        let mut elf = vec![0u8; 64];
        elf[0..7].copy_from_slice(b"\x7fELF\x02\x01\x01");
        elf[16..18].copy_from_slice(&3u16.to_le_bytes());
        vfs.write_file("/work/lib.so", &elf).unwrap();

        // PE executable (MZ, PE offset 64 at 60..64, PE\0\0 at 64..68, total >= 88 bytes)
        let mut pe = vec![0u8; 88];
        pe[0..2].copy_from_slice(b"MZ");
        pe[60..64].copy_from_slice(&64u32.to_le_bytes());
        pe[64..68].copy_from_slice(b"PE\x00\x00");
        vfs.write_file("/work/app.exe", &pe).unwrap();

        // OLE Compound Document (512 bytes, magic at 0..8, FE FF at 28..30)
        let mut ole = vec![0u8; 512];
        ole[0..8].copy_from_slice(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
        ole[28..30].copy_from_slice(&[0xfe, 0xff]);
        vfs.write_file("/work/legacy.doc", &ole).unwrap();

        let desc = try_run_fs_command(
            "file",
            &args(&[
                "-b",
                "/work/pic.bmp",
                "/work/app.ico",
                "/work/arch.rar",
                "/work/lib.so",
                "/work/app.exe",
                "/work/legacy.doc",
                "/dev/null",
            ]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(desc.exit_code, 0);
        assert_eq!(
            desc.stdout,
            concat!(
                "PC bitmap image data\n",
                "MS Windows icon resource\n",
                "RAR archive data\n",
                "ELF 64-bit shared object\n",
                "PE executable\n",
                "OLE Compound Document\n",
                "character special\n",
            )
        );

        let mime = try_run_fs_command(
            "file",
            &args(&[
                "-b",
                "--mime-type",
                "/work/pic.bmp",
                "/work/app.ico",
                "/work/arch.rar",
                "/work/lib.so",
                "/work/app.exe",
                "/work/legacy.doc",
                "/dev/null",
            ]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(mime.exit_code, 0);
        assert_eq!(
            mime.stdout,
            concat!(
                "image/bmp\n",
                "image/vnd.microsoft.icon\n",
                "application/x-rar\n",
                "application/x-sharedlib\n",
                "application/vnd.microsoft.portable-executable\n",
                "application/x-ole-storage\n",
                "inode/chardevice\n",
            )
        );
    }

    #[test]
    fn du_reports_incomplete_subtrees_and_detects_directory_cycles() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/d").unwrap();
        fs.write_file("/d/f", b"abc").unwrap();
        fs.symlink(".", "/d/loop").unwrap();
        let run = |flags| cmd_du(&args(&[flags, "/d"]), "/", &Default::default(), &fs);
        let allocated = run("-ac");
        assert_eq!(allocated.exit_code, 1);
        assert_eq!(allocated.stdout, "");
        assert_eq!(allocated.stderr, ["d", "d/f", "d/loop"].map(|p|
            format!("du: \"/{p}\": allocated bytes unknown; total suppressed\n")).concat());
        let apparent = run("-ablL");
        assert_eq!(apparent.stdout, "3\t/d/f\n");
        assert_eq!(apparent.stderr, "du: \"/d/loop\": directory cycle detected\n");
    }

    #[cfg(unix)]
    #[test]
    fn du_uses_host_allocation_for_regular_files() {
        use std::os::unix::fs::MetadataExt;
        let root = env!("CARGO_MANIFEST_DIR");
        let fs = crate::vfs::RealVfs::new(root).unwrap();
        let allocated = std::fs::metadata(std::path::Path::new(root).join("Cargo.toml")).unwrap().blocks() * 512;
        let result = cmd_du(&args(&["-B1", "Cargo.toml"]), "/", &Default::default(), &fs);
        assert_eq!(result.exit_code, 0);
        assert_eq!(result.stdout, format!("{allocated}\tCargo.toml\n"));
    }

    #[test]
    fn unit_fs_diagnostics_help_version_and_validation_match_typescript() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work/dir").unwrap();
        vfs.write_file("/work/dir/inside.txt", b"hi\n").unwrap();
        vfs.write_file("/work/f.txt", b"hello\n").unwrap();
        let env = BTreeMap::new();

        // ls invalid option & missing path
        let ls_opt = try_run_fs_command("ls", &args(&["--bogus"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(ls_opt.exit_code, 2);
        assert_eq!(ls_opt.stderr, "ls: unrecognized option '--bogus'\n");
        let ls_miss = try_run_fs_command("ls", &args(&["/nope"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(ls_miss.exit_code, 1);
        assert_eq!(ls_miss.stderr, "ls: ENOENT: no such file or directory, lstat '/nope'\n");

        // mkdir invalid mode, EEXIST, ENOENT parent
        let mkdir_mode = try_run_fs_command("mkdir", &args(&["-m", "999", "/work/m"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(mkdir_mode.exit_code, 2);
        assert_eq!(mkdir_mode.stderr, "mkdir: invalid mode: '999'\n");
        let mkdir_exist = try_run_fs_command("mkdir", &args(&["/work/dir"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(mkdir_exist.exit_code, 1);
        assert_eq!(mkdir_exist.stderr, "mkdir: EEXIST: file already exists, mkdir '/work/dir'\n");
        let mkdir_parent = try_run_fs_command("mkdir", &args(&["/work/no/sub"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(mkdir_parent.exit_code, 1);
        assert_eq!(mkdir_parent.stderr, "mkdir: ENOENT: no such file or directory, mkdir '/work/no/sub'\n");

        // rmdir ENOENT, ENOTDIR, ENOTEMPTY
        let rmdir_miss = try_run_fs_command("rmdir", &args(&["/work/nope"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(rmdir_miss.stderr, "rmdir: ENOENT: no such file or directory, rmdir '/work/nope'\n");
        let rmdir_file = try_run_fs_command("rmdir", &args(&["/work/f.txt"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(rmdir_file.stderr, "rmdir: ENOTDIR: not a directory, rmdir '/work/f.txt'\n");
        let rmdir_nonempty = try_run_fs_command("rmdir", &args(&["/work/dir"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(rmdir_nonempty.stderr, "rmdir: ENOTEMPTY: directory not empty, rmdir '/work/dir'\n");

        // rm ENOENT, EISDIR, ENOTEMPTY (-d)
        let rm_miss = try_run_fs_command("rm", &args(&["/work/nope"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(rm_miss.stderr, "rm: ENOENT: no such file or directory, rm '/work/nope'\n");
        let rm_dir = try_run_fs_command("rm", &args(&["/work/dir"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(rm_dir.stderr, "rm: EISDIR: illegal operation on a directory, rm '/work/dir'\n");
        let rm_d = try_run_fs_command("rm", &args(&["-d", "/work/dir"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(rm_d.stderr, "rm: ENOTEMPTY: directory not empty, rmdir '/work/dir'\n");

        // cp & mv diagnostics
        let cp_op = try_run_fs_command("cp", &args(&[]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(cp_op.exit_code, 2);
        assert_eq!(cp_op.stderr, "cp: missing operand\n");
        let cp_dir = try_run_fs_command("cp", &args(&["/work/dir", "/work/dir2"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(cp_dir.stderr, "cp: EISDIR: omitting directory (use -R) '/work/dir'\n");
        let mv_miss = try_run_fs_command("mv", &args(&["/work/nope", "/work/dst"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(mv_miss.stderr, "mv: ENOENT: no such file or directory, rename '/work/nope' -> '/work/dst'\n");

        // ln hardlink directory EPERM & EEXIST
        let ln_dir = try_run_fs_command("ln", &args(&["/work/dir", "/work/dir_hl"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(ln_dir.exit_code, 1);
        assert_eq!(ln_dir.stderr, "ln: EPERM: operation not permitted, link '/work/dir' -> '/work/dir_hl'\n");

        // touch invalid date & stamp
        let touch_d = try_run_fs_command("touch", &args(&["-d", "not-a-date", "/work/f.txt"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(touch_d.exit_code, 1);
        assert_eq!(touch_d.stderr, "touch: unsupported or invalid date: not-a-date\n");
        let touch_t = try_run_fs_command("touch", &args(&["-t", "bad", "/work/f.txt"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(touch_t.exit_code, 1);
        assert_eq!(touch_t.stderr, "touch: invalid date format 'bad'\n");

        let usage = try_run_fs_command("du", &args(&["-ck", "f.txt"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(usage.stdout, "");
        assert_eq!(usage.stderr, "du: \"f.txt\": allocated bytes unknown; total suppressed\n");
        assert_eq!(usage.exit_code, 1);

        // du invalid max-depth & missing operand
        let du_bad = try_run_fs_command("du", &args(&["-d", "abc"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(du_bad.exit_code, 1);
        assert_eq!(du_bad.stderr, "du: invalid maximum depth 'abc'\n");
        let du_miss = try_run_fs_command("du", &args(&["-c", "/nope"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(du_miss.exit_code, 1);
        assert_eq!(du_miss.stdout, "");
        assert_eq!(du_miss.stderr, "du: \"/nope\": no such file or directory, lstat '/nope'\n");

        // tree invalid -L and missing operand
        let tree_l = try_run_fs_command("tree", &args(&["-L", "0"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(tree_l.exit_code, 2);
        assert_eq!(tree_l.stderr, "tree: -L must be between 1 and Infinity\n");
        let tree_miss = try_run_fs_command("tree", &args(&["/nope"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(tree_miss.exit_code, 1);
        assert!(tree_miss.stdout.starts_with("/nope  [no such file or directory, lstat '/nope']\n"));
        assert_eq!(tree_miss.stderr, "tree: /nope: no such file or directory, lstat '/nope'\n");
    }
}
