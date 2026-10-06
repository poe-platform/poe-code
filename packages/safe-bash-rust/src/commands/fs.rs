use crate::shell::builtins::BuiltinOutcome;
use crate::vfs::{
    SafeBashFs, VfsEntryKind, basename_posix_path, normalize_posix_path, resolve_posix_path,
};

pub fn try_run_fs_command(
    cmd: &str,
    args: &[String],
    cwd: &str,
    env: &std::collections::BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> Option<BuiltinOutcome> {
    match cmd {
        "ls" => Some(cmd_ls(args, cwd, fs)),
        "mkdir" => Some(cmd_mkdir(args, cwd, env, fs)),
        "rmdir" => Some(cmd_rmdir(args, cwd, fs)),
        "rm" => Some(cmd_rm(args, cwd, fs)),
        "cp" => Some(cmd_cp(args, cwd, fs)),
        "mv" => Some(cmd_mv(args, cwd, fs)),
        "touch" => Some(cmd_touch(args, cwd, env, fs)),
        "ln" => Some(cmd_ln(args, cwd, fs)),
        "readlink" => Some(cmd_readlink(args, cwd, fs)),
        "realpath" => Some(cmd_realpath(args, cwd, fs)),
        "chmod" => Some(cmd_chmod(args, cwd, fs)),
        "stat" => Some(cmd_stat(args, cwd, fs)),
        "du" => Some(cmd_du(args, cwd, fs)),
        "df" => Some(cmd_df()),
        "mktemp" => Some(cmd_mktemp(args, cwd, fs)),
        "tree" => Some(cmd_tree(args, cwd, fs)),
        "file" => Some(cmd_file(args, cwd, fs)),
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

fn cmd_ls(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut show_all = false;
    let mut dir_only = false;
    let mut targets = Vec::new();
    for a in args {
        if a.starts_with('-') && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    'a' | 'A' => show_all = true,
                    'd' => dir_only = true,
                    _ => {}
                }
            }
        } else {
            targets.push(a.clone());
        }
    }
    if targets.is_empty() {
        targets.push(".".to_string());
    }
    let mut out = Vec::new();
    let mut stderr = String::new();
    let mut code = 0;
    for t in &targets {
        let p = resolve_posix_path(cwd, t);
        if dir_only || (!fs.is_dir(&p) && fs.exists(&p)) {
            out.push(t.clone());
        } else if fs.is_dir(&p) {
            match fs.list_dir(&p) {
                Ok(mut entries) => {
                    entries.sort();
                    for e in entries {
                        if !show_all && e.starts_with('.') {
                            continue;
                        }
                        out.push(e);
                    }
                }
                Err(e) => {
                    stderr.push_str(&format!("ls: cannot access '{t}': {e}\n"));
                    code = 2;
                }
            }
        } else {
            stderr.push_str(&format!("ls: cannot access '{t}': No such file or directory\n"));
            code = 2;
        }
    }
    BuiltinOutcome {
        stdout: if out.is_empty() {
            String::new()
        } else {
            format!("{}\n", out.join("\n"))
        },
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
    let mut stderr = String::new();
    let mut code = 0;
    let mut explicit_mode: Option<u32> = None;
    let umask_val = env
        .get("__umask")
        .and_then(|s| u32::from_str_radix(s, 8).ok())
        .unwrap_or(0o022);
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-m" && i + 1 < args.len() {
            explicit_mode = u32::from_str_radix(&args[i + 1], 8).ok();
            i += 2;
            continue;
        }
        if a.starts_with('-') {
            i += 1;
            continue;
        }
        let p = resolve_posix_path(cwd, a);
        let existed = fs.exists(&p);
        if let Err(e) = fs.mkdir_all(&p) {
            stderr.push_str(&format!("mkdir: cannot create directory '{a}': {e}\n"));
            code = 1;
        } else if !existed {
            let mode = explicit_mode.unwrap_or((0o777 & !umask_val) & 0o777);
            let _ = fs.chmod(&p, mode);
        }
        i += 1;
    }
    BuiltinOutcome {
        stdout: String::new(),
        stderr,
        exit_code: code,
    }
}

fn cmd_rmdir(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut stderr = String::new();
    let mut code = 0;
    for a in args {
        if a.starts_with('-') {
            continue;
        }
        let p = resolve_posix_path(cwd, a);
        if !fs.is_dir(&p) {
            stderr.push_str(&format!("rmdir: failed to remove '{a}': Not a directory\n"));
            code = 1;
            continue;
        }
        if let Ok(entries) = fs.list_dir(&p)
            && !entries.is_empty()
        {
            stderr.push_str(&format!("rmdir: failed to remove '{a}': Directory not empty\n"));
            code = 1;
            continue;
        }
        if let Err(e) = fs.remove_path(&p) {
            stderr.push_str(&format!("rmdir: failed to remove '{a}': {e}\n"));
            code = 1;
        }
    }
    BuiltinOutcome {
        stdout: String::new(),
        stderr,
        exit_code: code,
    }
}

fn cmd_rm(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut force = false;
    let mut targets = Vec::new();
    let mut opts_done = false;
    for a in args {
        if !opts_done && a == "--" {
            opts_done = true;
            continue;
        }
        if !opts_done && a.starts_with('-') && a.len() > 1 {
            if a.contains('f') || a == "--force" {
                force = true;
            }
        } else {
            targets.push(a.clone());
        }
    }
    let mut stderr = String::new();
    let mut code = 0;
    for t in targets {
        let p = resolve_posix_path(cwd, &t);
        if let Err(e) = fs.remove_path(&p)
            && !force
        {
            stderr.push_str(&format!("rm: cannot remove '{t}': {e}\n"));
            code = 1;
        }
    }
    BuiltinOutcome {
        stdout: String::new(),
        stderr,
        exit_code: code,
    }
}

fn copy_recursive(src: &str, dst: &str, fs: &dyn SafeBashFs) -> Result<(), String> {
    if let Ok(link_target) = fs.readlink(src) {
        let _ = fs.remove_path(dst);
        return fs.symlink(&link_target, dst);
    }
    if fs.is_dir(src) {
        fs.mkdir_all(dst)?;
        for name in fs.list_dir(src)? {
            let s_child = if src == "/" {
                format!("/{name}")
            } else {
                format!("{src}/{name}")
            };
            let d_child = if dst == "/" {
                format!("/{name}")
            } else {
                format!("{dst}/{name}")
            };
            copy_recursive(&s_child, &d_child, fs)?;
        }
        Ok(())
    } else {
        let data = fs.read_file(src)?;
        fs.write_file(dst, &data)?;
        if let Ok(st) = fs.stat(src) {
            let _ = fs.chmod(dst, st.mode);
        }
        Ok(())
    }
}

fn cmd_cp(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut operands: Vec<&String> = Vec::new();
    let mut end_opts = false;
    for a in args {
        if !end_opts && a == "--" {
            end_opts = true;
            continue;
        }
        if !end_opts && a.starts_with('-') && a != "-" {
            continue;
        }
        operands.push(a);
    }
    if operands.len() < 2 {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "cp: missing file operand\n".to_string(),
            exit_code: 1,
        };
    }
    let dst_raw = operands.last().unwrap();
    let dst_base = resolve_posix_path(cwd, dst_raw);
    let dst_is_dir = fs.is_dir(&dst_base);
    let mut stderr = String::new();
    let mut code = 0;

    for src_raw in &operands[..operands.len() - 1] {
        let src = resolve_posix_path(cwd, src_raw);
        let target = if dst_is_dir {
            let name = basename_posix_path(&src);
            if dst_base == "/" {
                format!("/{name}")
            } else {
                format!("{dst_base}/{name}")
            }
        } else {
            dst_base.clone()
        };
        if let Err(e) = copy_recursive(&src, &target, fs) {
            stderr.push_str(&format!("cp: cannot copy '{src_raw}': {e}\n"));
            code = 1;
        }
    }
    BuiltinOutcome {
        stdout: String::new(),
        stderr,
        exit_code: code,
    }
}

fn cmd_mv(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut operands: Vec<&String> = Vec::new();
    let mut end_opts = false;
    for a in args {
        if !end_opts && a == "--" {
            end_opts = true;
            continue;
        }
        if !end_opts && a.starts_with('-') && a != "-" {
            continue;
        }
        operands.push(a);
    }
    if operands.len() < 2 {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "mv: missing file operand\n".to_string(),
            exit_code: 1,
        };
    }
    let dst_raw = operands.last().unwrap();
    let dst_base = resolve_posix_path(cwd, dst_raw);
    let dst_is_dir = fs.is_dir(&dst_base);
    let mut stderr = String::new();
    let mut code = 0;

    for src_raw in &operands[..operands.len() - 1] {
        let src = resolve_posix_path(cwd, src_raw);
        let target = if dst_is_dir {
            let name = basename_posix_path(&src);
            if dst_base == "/" {
                format!("/{name}")
            } else {
                format!("{dst_base}/{name}")
            }
        } else {
            dst_base.clone()
        };
        if src == target {
            continue;
        }
        if let Err(e) = copy_recursive(&src, &target, fs).and_then(|_| fs.remove_path(&src)) {
            stderr.push_str(&format!("mv: cannot move '{src_raw}': {e}\n"));
            code = 1;
        }
    }
    BuiltinOutcome {
        stdout: String::new(),
        stderr,
        exit_code: code,
    }
}

fn cmd_touch(
    args: &[String],
    cwd: &str,
    env: &std::collections::BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut no_create = false;
    let mut ref_mtime: Option<u64> = None;
    let umask_val = env
        .get("__umask")
        .and_then(|s| u32::from_str_radix(s, 8).ok())
        .unwrap_or(0o022);
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-r" && i + 1 < args.len() {
            let rp = resolve_posix_path(cwd, &args[i + 1]);
            if let Ok(st) = fs.stat(&rp) {
                ref_mtime = Some(st.mtime_ms);
            }
            i += 2;
            continue;
        }
        if (a == "-d" || a == "-t") && i + 1 < args.len() {
            ref_mtime = Some(parse_touch_timestamp_ms(&args[i + 1]));
            i += 2;
            continue;
        }
        if a.starts_with('-') {
            if a.contains('c') {
                no_create = true;
            }
            i += 1;
            continue;
        }
        let p = resolve_posix_path(cwd, a);
        if !fs.exists(&p) {
            if !no_create {
                let _ = fs.write_file(&p, &[]);
                let mode = (0o666 & !umask_val) & 0o777;
                let _ = fs.chmod(&p, mode);
                if let Some(ms) = ref_mtime {
                    let _ = fs.set_mtime(&p, ms);
                }
            }
        } else if let Some(ms) = ref_mtime {
            let _ = fs.set_mtime(&p, ms);
        }
        i += 1;
    }
    ok_out("")
}

fn parse_touch_timestamp_ms(s: &str) -> u64 {
    let trimmed = s.trim();
    if let Some(epoch) = trimmed.strip_prefix('@') {
        return epoch.parse::<u64>().unwrap_or(1_700_000_000) * 1000;
    }
    let digits: Vec<u64> = trimmed
        .split(|c: char| !c.is_ascii_digit())
        .filter(|p| !p.is_empty())
        .filter_map(|p| p.parse::<u64>().ok())
        .collect();
    if digits.len() >= 3 && digits[0] >= 1970 {
        let y = digits[0];
        let m = digits.get(1).copied().unwrap_or(1).clamp(1, 12);
        let d = digits.get(2).copied().unwrap_or(1).clamp(1, 31);
        let hh = digits.get(3).copied().unwrap_or(0).clamp(0, 23);
        let mm = digits.get(4).copied().unwrap_or(0).clamp(0, 59);
        let ss = digits.get(5).copied().unwrap_or(0).clamp(0, 59);
        let days = (y - 1970) * 365 + (y - 1969) / 4 + (m - 1) * 30 + (d - 1);
        return (days * 86400 + hh * 3600 + mm * 60 + ss) * 1000;
    }
    1_700_000_000_000
}

fn cmd_ln(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut force = false;
    let mut operands = Vec::new();
    for a in args {
        if a.starts_with('-') {
            if a.contains('f') {
                force = true;
            }
        } else {
            operands.push(a.clone());
        }
    }
    if operands.len() < 2 {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "ln: missing file operand\n".to_string(),
            exit_code: 1,
        };
    }
    let target = &operands[0];
    let link_path = resolve_posix_path(cwd, &operands[1]);
    if force {
        let _ = fs.remove_path(&link_path);
    }
    if let Err(e) = fs.symlink(target, &link_path) {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: format!("ln: {e}\n"),
            exit_code: 1,
        };
    }
    ok_out("")
}

fn cmd_readlink(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut canonical = false;
    let mut targets = Vec::new();
    for a in args {
        if matches!(a.as_str(), "-f" | "-e" | "-m") {
            canonical = true;
        } else if !a.starts_with('-') {
            targets.push(a.clone());
        }
    }
    let Some(first) = targets.first() else {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 1,
        };
    };
    let p = resolve_posix_path(cwd, first);
    if canonical {
        if let Ok(link_t) = fs.readlink(&p) {
            let parent = crate::vfs::dirname_posix_path(&p);
            let resolved = resolve_posix_path(&parent, &link_t);
            return ok_out(&format!("{resolved}\n"));
        }
        return ok_out(&format!("{p}\n"));
    }
    match fs.readlink(&p) {
        Ok(t) => ok_out(&format!("{t}\n")),
        Err(_) => BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 1,
        },
    }
}

fn resolve_canonical_target(p: &str, fs: &dyn SafeBashFs) -> String {
    if let Ok(link_t) = fs.readlink(p) {
        let parent = crate::vfs::dirname_posix_path(p);
        resolve_posix_path(&parent, &link_t)
    } else {
        p.to_string()
    }
}

fn relative_posix_path(base: &str, target: &str) -> String {
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

fn cmd_realpath(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut rel_to: Option<String> = None;
    let mut targets = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if let Some(r) = a.strip_prefix("--relative-to=") {
            rel_to = Some(r.to_string());
            i += 1;
        } else if a == "--relative-to" && i + 1 < args.len() {
            rel_to = Some(args[i + 1].clone());
            i += 2;
        } else if !a.starts_with('-') {
            targets.push(a.clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    let base_resolved = rel_to.map(|b| resolve_canonical_target(&resolve_posix_path(cwd, &b), fs));
    let mut out = String::new();
    for a in targets {
        let p = resolve_posix_path(cwd, &a);
        let resolved = resolve_canonical_target(&p, fs);
        if let Some(ref base) = base_resolved {
            out.push_str(&format!("{}\n", relative_posix_path(base, &resolved)));
        } else {
            out.push_str(&format!("{resolved}\n"));
        }
    }
    ok_out(&out)
}

fn eval_chmod_mode(spec: &str, current: u32) -> u32 {
    if let Ok(oct) = u32::from_str_radix(spec, 8) {
        return oct;
    }
    let mut mode = current & 0o7777;
    for clause in spec.split(',') {
        let mut chars = clause.chars().peekable();
        let mut who_mask = 0u32;
        while let Some(&c) = chars.peek() {
            match c {
                'u' => { who_mask |= 0o700; chars.next(); }
                'g' => { who_mask |= 0o070; chars.next(); }
                'o' => { who_mask |= 0o007; chars.next(); }
                'a' => { who_mask |= 0o777; chars.next(); }
                _ => break,
            }
        }
        if who_mask == 0 {
            who_mask = 0o777;
        }
        while let Some(op) = chars.next() {
            if !matches!(op, '+' | '-' | '=') {
                break;
            }
            let mut perm_bits = 0u32;
            while let Some(&p) = chars.peek() {
                match p {
                    'r' => { perm_bits |= 0o444; chars.next(); }
                    'w' => { perm_bits |= 0o222; chars.next(); }
                    'x' | 'X' => { perm_bits |= 0o111; chars.next(); }
                    _ => break,
                }
            }
            let masked = perm_bits & who_mask;
            match op {
                '+' => mode |= masked,
                '-' => mode &= !masked,
                '=' => {
                    mode = (mode & !who_mask) | masked;
                }
                _ => {}
            }
        }
    }
    mode
}

fn apply_chmod_recursive(path: &str, mode_spec: &str, recursive: bool, fs: &dyn SafeBashFs) -> Result<(), String> {
    let cur = fs.stat(path).map(|st| st.mode).unwrap_or(0o644);
    let new_mode = eval_chmod_mode(mode_spec, cur);
    fs.chmod(path, new_mode)?;
    if recursive && fs.is_dir(path) {
        for name in fs.list_dir(path)? {
            let child = if path == "/" {
                format!("/{name}")
            } else {
                format!("{path}/{name}")
            };
            apply_chmod_recursive(&child, mode_spec, true, fs)?;
        }
    }
    Ok(())
}

fn cmd_chmod(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut recursive = false;
    let mut positional = Vec::new();
    for a in args {
        if a == "-R" || a == "--recursive" {
            recursive = true;
        } else if !a.starts_with('-') {
            positional.push(a.clone());
        }
    }
    if positional.len() < 2 {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "chmod: missing operand\n".to_string(),
            exit_code: 1,
        };
    }
    let mode_str = &positional[0];
    let mut stderr = String::new();
    let mut code = 0;
    for t in &positional[1..] {
        let p = resolve_posix_path(cwd, t);
        if let Err(e) = apply_chmod_recursive(&p, mode_str, recursive, fs) {
            stderr.push_str(&format!("chmod: {t}: {e}\n"));
            code = 1;
        }
    }
    BuiltinOutcome {
        stdout: String::new(),
        stderr,
        exit_code: code,
    }
}

fn cmd_stat(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut fmt_spec: Option<String> = None;
    let mut targets = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        if (args[i] == "-c" || args[i] == "--format") && i + 1 < args.len() {
            fmt_spec = Some(args[i + 1].clone());
            i += 2;
        } else if let Some(rest) = args[i].strip_prefix("--format=") {
            fmt_spec = Some(rest.to_string());
            i += 1;
        } else if !args[i].starts_with('-') {
            targets.push(args[i].clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    let mut out = String::new();
    let mut stderr = String::new();
    let mut code = 0;

    for t in targets {
        let p = resolve_posix_path(cwd, &t);
        match fs.stat(&p) {
            Ok(st) => {
                let perm = st.mode & 0o7777;
                let ftype = match st.kind {
                    VfsEntryKind::File => {
                        if st.size == 0 {
                            "regular empty file"
                        } else {
                            "regular file"
                        }
                    }
                    VfsEntryKind::Directory => "directory",
                    VfsEntryKind::Symlink => "symbolic link",
                };
                if let Some(ref spec) = fmt_spec {
                    let rendered = spec
                        .replace("%a", &format!("{perm:o}"))
                        .replace("%s", &st.size.to_string())
                        .replace("%n", &t)
                        .replace("%F", ftype)
                        .replace("%Y", &(st.mtime_ms / 1000).to_string());
                    out.push_str(&rendered);
                    out.push('\n');
                } else {
                    out.push_str(&format!("  File: {t}\n  Size: {}\t{ftype}\nAccess: ({perm:04o})\n", st.size));
                }
            }
            Err(e) => {
                stderr.push_str(&format!("stat: cannot statx '{t}': {e}\n"));
                code = 1;
            }
        }
    }
    BuiltinOutcome {
        stdout: out,
        stderr,
        exit_code: code,
    }
}

fn dir_bytes(path: &str, excludes: &[String], fs: &dyn SafeBashFs) -> usize {
    let base = basename_posix_path(path);
    if excludes.iter().any(|ex| crate::shell::expand::glob_match(ex, &base) || crate::shell::expand::glob_match(ex, path)) {
        return 0;
    }
    if fs.is_dir(path) {
        let mut sum = 0usize;
        for name in fs.list_dir(path).unwrap_or_default() {
            let child = if path == "/" {
                format!("/{name}")
            } else {
                format!("{path}/{name}")
            };
            sum += dir_bytes(&child, excludes, fs);
        }
        sum
    } else {
        fs.read_file(path).map(|b| b.len()).unwrap_or(0)
    }
}

fn cmd_du(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut bytes_mode = false;
    let mut excludes = Vec::new();
    let mut targets = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if let Some(ex) = a.strip_prefix("--exclude=") {
            excludes.push(ex.to_string());
            i += 1;
        } else if a == "--exclude" && i + 1 < args.len() {
            excludes.push(args[i + 1].clone());
            i += 2;
        } else if a.starts_with('-') {
            if a.contains('b') {
                bytes_mode = true;
            }
            i += 1;
        } else {
            targets.push(a.clone());
            i += 1;
        }
    }
    if targets.is_empty() {
        targets.push(".".to_string());
    }
    let mut out = String::new();
    for t in targets {
        let p = resolve_posix_path(cwd, &t);
        let b = dir_bytes(&p, &excludes, fs);
        let val = if bytes_mode { b } else { b.div_ceil(1024).max(1) };
        out.push_str(&format!("{val}\t{t}\n"));
    }
    ok_out(&out)
}

fn cmd_df() -> BuiltinOutcome {
    ok_out("Filesystem     1K-blocks  Used Available Use% Mounted on\ntmpfs              65536     0     65536   0% /\n")
}

fn cmd_mktemp(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut is_dir = false;
    let mut parent_dir = "/tmp".to_string();
    let mut template: Option<String> = None;
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-d" {
            is_dir = true;
            i += 1;
        } else if a == "-p" && i + 1 < args.len() {
            parent_dir = args[i + 1].clone();
            i += 2;
        } else if let Some(p) = a.strip_prefix("--tmpdir=") {
            parent_dir = p.to_string();
            i += 1;
        } else if !a.starts_with('-') {
            template = Some(a.clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    let tpl = template.unwrap_or_else(|| "tmp.XXXXXX".to_string());
    let base_dir = resolve_posix_path(cwd, &parent_dir);
    let _ = fs.mkdir_all(&base_dir);
    let mut path = String::new();
    for seq in 1..10000usize {
        let suffix = format!("{seq:06}");
        let name = if tpl.contains("XXXXXX") {
            tpl.replacen("XXXXXX", &suffix, 1)
        } else if tpl.contains("XXX") {
            tpl.replacen("XXX", &suffix[3..], 1)
        } else {
            format!("{tpl}.{suffix}")
        };
        let cand = if name.starts_with('/') {
            normalize_posix_path(&name)
        } else {
            normalize_posix_path(&format!("{base_dir}/{name}"))
        };
        if !fs.exists(&cand) {
            path = cand;
            break;
        }
    }
    if is_dir {
        let _ = fs.mkdir_all(&path);
    } else {
        let _ = fs.write_file(&path, &[]);
    }
    ok_out(&format!("{path}\n"))
}

fn build_tree_json(
    full: &str,
    name: &str,
    depth: usize,
    max_depth: Option<usize>,
    show_all: bool,
    dirs_only: bool,
    ignore_pat: Option<&str>,
    match_pat: Option<&str>,
    fs: &dyn SafeBashFs,
    dir_count: &mut usize,
    file_count: &mut usize,
) -> String {
    if let Some(md) = max_depth && depth >= md {
        return format!("{{\"type\":\"directory\",\"name\":\"{name}\",\"contents\":[]}}");
    }
    let mut names = fs.list_dir(full).unwrap_or_default();
    names.sort();
    let mut items = Vec::new();
    for n in names {
        if !show_all && n.starts_with('.') {
            continue;
        }
        if let Some(ig) = ignore_pat && crate::shell::expand::glob_match(ig, &n) {
            continue;
        }
        let child = if full == "/" { format!("/{n}") } else { format!("{full}/{n}") };
        if fs.is_dir(&child) {
            *dir_count += 1;
            items.push(build_tree_json(
                &child,
                &n,
                depth + 1,
                max_depth,
                show_all,
                dirs_only,
                ignore_pat,
                match_pat,
                fs,
                dir_count,
                file_count,
            ));
        } else if !dirs_only {
            if let Some(mp) = match_pat && !crate::shell::expand::glob_match(mp, &n) {
                continue;
            }
            *file_count += 1;
            items.push(format!("{{\"type\":\"file\",\"name\":\"{n}\"}}"));
        }
    }
    format!("{{\"type\":\"directory\",\"name\":\"{name}\",\"contents\":[{}]}}", items.join(","))
}

fn cmd_tree(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut json_mode = false;
    let mut show_all = false;
    let mut dirs_only = false;
    let mut max_depth: Option<usize> = None;
    let mut ignore_pat: Option<String> = None;
    let mut match_pat: Option<String> = None;
    let mut target = ".".to_string();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-J" {
            json_mode = true;
            i += 1;
        } else if a == "-a" {
            show_all = true;
            i += 1;
        } else if a == "-d" {
            dirs_only = true;
            i += 1;
        } else if a == "-L" && i + 1 < args.len() {
            max_depth = args[i + 1].parse().ok();
            i += 2;
        } else if a == "-I" && i + 1 < args.len() {
            ignore_pat = Some(args[i + 1].clone());
            i += 2;
        } else if a == "-P" && i + 1 < args.len() {
            match_pat = Some(args[i + 1].clone());
            i += 2;
        } else if !a.starts_with('-') {
            target = a.clone();
            i += 1;
        } else {
            i += 1;
        }
    }
    let root = resolve_posix_path(cwd, &target);
    if json_mode {
        let mut dir_count = 1usize;
        let mut file_count = 0usize;
        let tree_obj = build_tree_json(
            &root,
            &target,
            0,
            max_depth,
            show_all,
            dirs_only,
            ignore_pat.as_deref(),
            match_pat.as_deref(),
            fs,
            &mut dir_count,
            &mut file_count,
        );
        return ok_out(&format!(
            "[{tree_obj},{{\"type\":\"report\",\"directories\":{dir_count},\"files\":{file_count}}}]\n"
        ));
    }
    let mut out = format!("{target}\n");
    if let Ok(mut names) = fs.list_dir(&root) {
        names.sort();
        for n in names {
            if !show_all && n.starts_with('.') {
                continue;
            }
            if let Some(ref ig) = ignore_pat && crate::shell::expand::glob_match(ig, &n) {
                continue;
            }
            out.push_str(&format!("|-- {n}\n"));
        }
    }
    ok_out(&out)
}

fn cmd_file(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let brief = args.iter().any(|a| a == "-b" || a == "--brief");
    let mime = args.iter().any(|a| a == "--mime-type" || a == "-i");
    let mut out = String::new();
    for a in args {
        if a.starts_with('-') {
            continue;
        }
        let p = resolve_posix_path(cwd, a);
        let desc = if fs.is_dir(&p) {
            if mime { "inode/directory" } else { "directory" }
        } else if let Ok(data) = fs.read_file(&p) {
            if data.starts_with(b"\x89PNG\r\n\x1a\n") {
                if mime { "image/png" } else { "PNG image data" }
            } else if data.starts_with(b"%PDF-") {
                if mime { "application/pdf" } else { "PDF document" }
            } else if data.starts_with(b"\x1f\x8b") {
                if mime { "application/gzip" } else { "gzip compressed data" }
            } else if data.starts_with(b"PK\x03\x04") {
                if mime { "application/zip" } else { "Zip archive data" }
            } else if data.starts_with(b"#!") {
                if mime { "text/x-shellscript" } else { "POSIX shell script, ASCII text executable" }
            } else if data.starts_with(b"<?xml") || data.starts_with(b"<svg") {
                if mime { "text/xml" } else { "XML 1.0 document, ASCII text" }
            } else if data.starts_with(b"{") || data.starts_with(b"[") {
                if mime { "application/json" } else { "JSON text data" }
            } else if data.is_empty() {
                if mime { "inode/x-empty" } else { "empty" }
            } else if mime {
                "text/plain"
            } else {
                "ASCII text"
            }
        } else {
            "cannot open"
        };
        if brief {
            out.push_str(&format!("{desc}\n"));
        } else {
            out.push_str(&format!("{a}: {desc}\n"));
        }
    }
    ok_out(&out)
}
