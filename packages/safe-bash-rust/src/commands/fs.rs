use crate::shell::builtins::BuiltinOutcome;
use crate::vfs::{
    SafeBashFs, VfsEntryKind, basename_posix_path, normalize_posix_path, resolve_posix_path,
};
use std::collections::{BTreeMap, VecDeque};
use std::sync::{Mutex, OnceLock};

fn atime_store() -> &'static Mutex<BTreeMap<String, u64>> {
    static STORE: OnceLock<Mutex<BTreeMap<String, u64>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(BTreeMap::new()))
}

pub fn try_run_fs_command(
    cmd: &str,
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &std::collections::BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> Option<BuiltinOutcome> {
    match cmd {
        "ls" => Some(cmd_ls(args, cwd, fs)),
        "mkdir" => Some(cmd_mkdir(args, cwd, env, fs)),
        "rmdir" => Some(cmd_rmdir(args, cwd, fs)),
        "rm" => Some(cmd_rm(args, stdin, cwd, fs)),
        "cp" => Some(cmd_cp(args, cwd, fs)),
        "mv" => Some(cmd_mv(args, cwd, fs)),
        "touch" => Some(cmd_touch(args, cwd, env, fs)),
        "ln" => Some(cmd_ln(args, cwd, fs)),
        "readlink" => Some(cmd_readlink(args, cwd, fs)),
        "realpath" => Some(cmd_realpath(args, cwd, fs)),
        "chmod" => Some(cmd_chmod(args, cwd, fs)),
        "stat" => Some(cmd_stat(args, cwd, fs)),
        "du" => Some(cmd_du(args, cwd, fs)),
        "df" => Some(cmd_df(args, cwd, fs)),
        "mktemp" => Some(cmd_mktemp(args, cwd, env, fs)),
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

fn cmd_ls(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut show_all = false;
    let mut show_dots = false;
    let mut dir_only = false;
    let mut sort_mtime = false;
    let mut sort_size = false;
    let mut sort_version = false;
    let mut sort_ext = false;
    let mut reverse = false;
    let mut classify = false;
    let mut targets = Vec::new();
    for a in args {
        if a.starts_with('-') && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    'a' => {
                        show_all = true;
                        show_dots = true;
                    }
                    'A' => show_all = true,
                    'd' => dir_only = true,
                    't' => sort_mtime = true,
                    'S' => sort_size = true,
                    'v' => sort_version = true,
                    'X' => sort_ext = true,
                    'r' => reverse = true,
                    'F' => classify = true,
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
    let mut file_targets = Vec::new();
    let mut stderr = String::new();
    let mut code = 0;
    for t in &targets {
        let p = resolve_posix_path(cwd, t);
        if dir_only || (!fs.is_dir(&p) && fs.exists(&p)) {
            file_targets.push(t.clone());
        } else if fs.is_dir(&p) {
            match fs.list_dir(&p) {
                Ok(mut entries) => {
                    if show_dots {
                        entries.push(".".to_string());
                        entries.push("..".to_string());
                    }
                    if sort_mtime {
                        entries.sort_by(|a, b| {
                            let pa = resolve_posix_path(&p, a);
                            let pb = resolve_posix_path(&p, b);
                            let ma = fs.lstat(&pa).map(|s| s.mtime_ms).unwrap_or(0);
                            let mb = fs.lstat(&pb).map(|s| s.mtime_ms).unwrap_or(0);
                            mb.cmp(&ma).then_with(|| a.cmp(b))
                        });
                    } else if sort_size {
                        entries.sort_by(|a, b| {
                            let pa = resolve_posix_path(&p, a);
                            let pb = resolve_posix_path(&p, b);
                            let sa = if fs.is_dir(&pa) {
                                0
                            } else {
                                fs.lstat(&pa).map(|s| s.size).unwrap_or(0)
                            };
                            let sb = if fs.is_dir(&pb) {
                                0
                            } else {
                                fs.lstat(&pb).map(|s| s.size).unwrap_or(0)
                            };
                            sb.cmp(&sa).then_with(|| a.cmp(b))
                        });
                    } else if sort_version {
                        entries.sort_by(|a, b| natural_version_cmp(a, b));
                    } else if sort_ext {
                        entries.sort_by(|a, b| {
                            file_ext_key(a).cmp(file_ext_key(b)).then_with(|| a.cmp(b))
                        });
                    } else {
                        entries.sort();
                    }
                    if reverse {
                        entries.reverse();
                    }
                    for e in entries {
                        if !show_all && e.starts_with('.') {
                            continue;
                        }
                        let mut disp = e.clone();
                        if classify {
                            let pe = resolve_posix_path(&p, &e);
                            if fs.readlink(&pe).is_ok() {
                                disp.push('@');
                            } else if fs.is_dir(&pe) {
                                disp.push('/');
                            } else if fs.stat(&pe).map(|s| s.mode & 0o111 != 0).unwrap_or(false) {
                                disp.push('*');
                            }
                        }
                        out.push(disp);
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
    if !file_targets.is_empty() {
        if sort_mtime {
            file_targets.sort_by(|a, b| {
                let pa = resolve_posix_path(cwd, a);
                let pb = resolve_posix_path(cwd, b);
                let ma = fs.lstat(&pa).map(|s| s.mtime_ms).unwrap_or(0);
                let mb = fs.lstat(&pb).map(|s| s.mtime_ms).unwrap_or(0);
                mb.cmp(&ma).then_with(|| a.cmp(b))
            });
        } else if sort_size {
            file_targets.sort_by(|a, b| {
                let pa = resolve_posix_path(cwd, a);
                let pb = resolve_posix_path(cwd, b);
                let sa = if fs.is_dir(&pa) {
                    0
                } else {
                    fs.lstat(&pa).map(|s| s.size).unwrap_or(0)
                };
                let sb = if fs.is_dir(&pb) {
                    0
                } else {
                    fs.lstat(&pb).map(|s| s.size).unwrap_or(0)
                };
                sb.cmp(&sa).then_with(|| a.cmp(b))
            });
        } else if sort_version {
            file_targets.sort_by(|a, b| natural_version_cmp(a, b));
        } else if sort_ext {
            file_targets.sort_by(|a, b| {
                file_ext_key(a).cmp(file_ext_key(b)).then_with(|| a.cmp(b))
            });
        } else {
            file_targets.sort();
        }
        if reverse {
            file_targets.reverse();
        }
        let mut combined = file_targets;
        combined.extend(out);
        out = combined;
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
    let mut parents = false;
    for a in args {
        if a.starts_with('-') {
            if a.contains('p') {
                parents = true;
            }
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
        } else if parents {
            let mut cur = a.trim_end_matches('/').to_string();
            while let Some((parent_rel, _)) = cur.rsplit_once('/') {
                if parent_rel.is_empty() {
                    break;
                }
                let pp = resolve_posix_path(cwd, parent_rel);
                if pp == "/" || pp == cwd {
                    break;
                }
                if let Ok(entries) = fs.list_dir(&pp)
                    && entries.is_empty()
                {
                    let _ = fs.remove_path(&pp);
                    cur = parent_rel.to_string();
                } else {
                    break;
                }
            }
        }
    }
    BuiltinOutcome {
        stdout: String::new(),
        stderr,
        exit_code: code,
    }
}

fn cmd_rm(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut force = false;
    let mut interactive = false;
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
                interactive = false;
            } else if a.contains('i') {
                interactive = true;
            }
        } else {
            targets.push(a.clone());
        }
    }
    let mut stderr = String::new();
    let mut code = 0;
    let mut stdin_lines = stdin.lines();
    for t in targets {
        if interactive && !force {
            let ans = stdin_lines.next().unwrap_or("");
            let first = ans.trim().chars().next().unwrap_or('n');
            if first != 'y' && first != 'Y' {
                continue;
            }
        }
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
    copy_recursive_ext(src, dst, fs, 'P', true)
}

fn copy_recursive_ext(
    src: &str,
    dst: &str,
    fs: &dyn SafeBashFs,
    deref_mode: char,
    top: bool,
) -> Result<(), String> {
    let preserve_link = deref_mode == 'P' || (deref_mode == 'H' && !top);
    if preserve_link && let Ok(link_target) = fs.readlink(src) {
        let _ = fs.remove_path(dst);
        return fs.symlink(&link_target, dst);
    }
    if fs.is_dir(src) {
        fs.mkdir_all(dst)?;
        if let Ok(st) = fs.stat(src) {
            let _ = fs.chmod(dst, st.mode);
        }
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
            copy_recursive_ext(&s_child, &d_child, fs, deref_mode, false)?;
        }
        Ok(())
    } else {
        let data = fs.read_file(src)?;
        if fs.readlink(dst).is_ok() {
            let _ = fs.remove_path(dst);
        }
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
    let mut no_clobber = false;
    let mut update_only = false;
    let mut hard_link = false;
    let mut sym_link = false;
    let mut backup_numbered = false;
    let mut backup_simple = false;
    let mut backup_suffix = "~".to_string();
    let mut recursive = false;
    let mut deref_opt: Option<char> = None;
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
            i += 2;
            continue;
        }
        if !end_opts && a.starts_with('-') && a != "-" {
            if a == "--no-clobber" {
                no_clobber = true;
            } else if a == "--update" {
                update_only = true;
            } else if a == "--link" {
                hard_link = true;
            } else if a == "--symbolic-link" {
                sym_link = true;
            } else if a == "--dereference" {
                deref_opt = Some('L');
            } else if a == "--no-dereference" {
                deref_opt = Some('P');
            } else if a == "--archive" {
                recursive = true;
                deref_opt = Some('P');
            } else if a == "--recursive" {
                recursive = true;
            } else if a == "--backup=numbered" || a == "--backup=t" {
                backup_numbered = true;
            } else if a.starts_with("--backup") {
                backup_simple = true;
            } else if let Some(s) = a.strip_prefix("--suffix=") {
                backup_suffix = s.to_string();
            } else if !a.starts_with("--") {
                if a.contains('n') {
                    no_clobber = true;
                }
                if a.contains('u') {
                    update_only = true;
                }
                if a.contains('l') {
                    hard_link = true;
                }
                if a.contains('s') {
                    sym_link = true;
                }
                if a.contains('b') {
                    backup_simple = true;
                }
                for ch in a.chars().skip(1) {
                    match ch {
                        'r' | 'R' => recursive = true,
                        'a' => {
                            recursive = true;
                            deref_opt = Some('P');
                        }
                        'd' | 'P' => {
                            deref_opt = Some('P');
                        }
                        'L' => {
                            deref_opt = Some('L');
                        }
                        'H' => {
                            deref_opt = Some('H');
                        }
                        _ => {}
                    }
                }
            }
            i += 1;
            continue;
        }
        operands.push(a);
        i += 1;
    }
    if operands.len() < 2 {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "cp: missing file operand\n".to_string(),
            exit_code: 1,
        };
    }
    let deref_mode = deref_opt.unwrap_or(if recursive { 'P' } else { 'H' });
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
        if fs.exists(&target) {
            if no_clobber {
                continue;
            }
            if update_only {
                let sm = fs.stat(&src).map(|s| s.mtime_ms).unwrap_or(0);
                let tm = fs.stat(&target).map(|s| s.mtime_ms).unwrap_or(0);
                if sm <= tm {
                    continue;
                }
            }
            if backup_numbered {
                for k in 1..1000usize {
                    let bak = format!("{target}.~{k}~");
                    if !fs.exists(&bak) {
                        let _ = copy_recursive(&target, &bak, fs);
                        break;
                    }
                }
            } else if backup_simple {
                let bak = format!("{target}{backup_suffix}");
                let _ = copy_recursive(&target, &bak, fs);
            }
        }
        let copy_res = if sym_link {
            let _ = fs.remove_path(&target);
            fs.symlink(src_raw, &target)
        } else if hard_link {
            let _ = fs.remove_path(&target);
            fs.symlink(&format!("__hardlink__:{src}"), &target)
        } else {
            copy_recursive_ext(&src, &target, fs, deref_mode, true)
        };
        if let Err(e) = copy_res {
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
    let mut no_clobber = false;
    let mut update_only = false;
    let mut backup_numbered = false;
    let mut backup_simple = false;
    let mut backup_suffix = "~".to_string();
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
            i += 2;
            continue;
        }
        if !end_opts && a.starts_with('-') && a != "-" {
            if a == "--no-clobber" {
                no_clobber = true;
            } else if a == "--update" {
                update_only = true;
            } else if a == "--backup=numbered" || a == "--backup=t" {
                backup_numbered = true;
            } else if a.starts_with("--backup") {
                backup_simple = true;
            } else if let Some(s) = a.strip_prefix("--suffix=") {
                backup_suffix = s.to_string();
            } else if !a.starts_with("--") {
                if a.contains('n') {
                    no_clobber = true;
                }
                if a.contains('u') {
                    update_only = true;
                }
                if a.contains('b') {
                    backup_simple = true;
                }
            }
            i += 1;
            continue;
        }
        operands.push(a);
        i += 1;
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
        if fs.exists(&target) {
            if no_clobber {
                continue;
            }
            if update_only {
                let sm = fs.stat(&src).map(|s| s.mtime_ms).unwrap_or(0);
                let tm = fs.stat(&target).map(|s| s.mtime_ms).unwrap_or(0);
                if sm <= tm {
                    continue;
                }
            }
            if backup_numbered {
                for k in 1..1000usize {
                    let bak = format!("{target}.~{k}~");
                    if !fs.exists(&bak) {
                        let _ = copy_recursive(&target, &bak, fs);
                        break;
                    }
                }
            } else if backup_simple {
                let bak = format!("{target}{backup_suffix}");
                let _ = copy_recursive(&target, &bak, fs);
            }
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
    let mut only_atime = false;
    let mut only_mtime = false;
    let mut ref_mtime: Option<u64> = None;
    let mut ref_atime: Option<u64> = None;
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
                let at = atime_store()
                    .lock()
                    .ok()
                    .and_then(|m| m.get(&rp).copied())
                    .unwrap_or(st.mtime_ms);
                ref_atime = Some(at);
            }
            i += 2;
            continue;
        }
        if (a == "-d" || a == "-t") && i + 1 < args.len() {
            let ts = parse_touch_timestamp_ms(&args[i + 1]);
            ref_mtime = Some(ts);
            ref_atime = Some(ts);
            i += 2;
            continue;
        }
        if a.starts_with('-') {
            if a.contains('c') {
                no_create = true;
            }
            if a.contains('a') {
                only_atime = true;
            }
            if a.contains('m') {
                only_mtime = true;
            }
            i += 1;
            continue;
        }
        let touch_a = !only_mtime || only_atime;
        let touch_m = !only_atime || only_mtime;
        let p = resolve_posix_path(cwd, a);
        if !fs.exists(&p) {
            if !no_create {
                let _ = fs.write_file(&p, &[]);
                let mode = (0o666 & !umask_val) & 0o777;
                let _ = fs.chmod(&p, mode);
                let ms = ref_mtime.unwrap_or(1_700_000_000_000);
                let _ = fs.set_mtime(&p, ms);
                if let Ok(mut map) = atime_store().lock() {
                    map.insert(p, ref_atime.unwrap_or(ms));
                }
            }
        } else {
            let cur_mtime = fs.stat(&p).map(|st| st.mtime_ms).unwrap_or(1_700_000_000_000);
            if touch_m && !touch_a {
                if let Ok(mut map) = atime_store().lock() {
                    map.entry(p.clone()).or_insert(cur_mtime);
                }
            }
            if touch_m {
                if let Some(ms) = ref_mtime {
                    let _ = fs.set_mtime(&p, ms);
                }
            }
            if touch_a {
                if let Some(at) = ref_atime.or(ref_mtime) {
                    if let Ok(mut map) = atime_store().lock() {
                        map.insert(p, at);
                    }
                }
            }
        }
        i += 1;
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

fn parse_touch_timestamp_ms(s: &str) -> u64 {
    let trimmed = s.trim();
    if let Some(epoch) = trimmed.strip_prefix('@') {
        return epoch.parse::<u64>().unwrap_or(1_700_000_000) * 1000;
    }
    let (main_part, sec_frac) = trimmed.split_once('.').unwrap_or((trimmed, ""));
    if main_part.chars().all(|c| c.is_ascii_digit()) && (main_part.len() == 12 || main_part.len() == 10) {
        let (y, rest) = if main_part.len() == 12 {
            (main_part[0..4].parse::<i64>().unwrap_or(1970), &main_part[4..])
        } else {
            let yy = main_part[0..2].parse::<i64>().unwrap_or(70);
            let year = if yy >= 69 { 1900 + yy } else { 2000 + yy };
            (year, &main_part[2..])
        };
        let m = rest[0..2].parse::<i64>().unwrap_or(1).clamp(1, 12);
        let d = rest[2..4].parse::<i64>().unwrap_or(1).clamp(1, 31);
        let hh = rest[4..6].parse::<i64>().unwrap_or(0).clamp(0, 23);
        let mm = rest[6..8].parse::<i64>().unwrap_or(0).clamp(0, 59);
        let ss = sec_frac
            .chars()
            .take(2)
            .collect::<String>()
            .parse::<i64>()
            .unwrap_or(0)
            .clamp(0, 59);
        let days = civil_to_epoch_days(y, m, d);
        let secs = days * 86400 + hh * 3600 + mm * 60 + ss;
        return secs.max(0) as u64 * 1000;
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
        return secs.max(0) as u64 * 1000;
    }
    1_700_000_000_000
}

fn cmd_ln(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut force = false;
    let mut symbolic = false;
    let mut relative = false;
    let mut backup_numbered = false;
    let mut backup_simple = false;
    let mut operands = Vec::new();
    for a in args {
        if a.starts_with("--") {
            match a.as_str() {
                "--force" => force = true,
                "--symbolic" => symbolic = true,
                "--relative" => relative = true,
                "--backup=numbered" | "--backup=t" => backup_numbered = true,
                s if s.starts_with("--backup") => backup_simple = true,
                _ => {}
            }
        } else if a.starts_with('-') && a.len() > 1 {
            if a.contains('f') {
                force = true;
            }
            if a.contains('s') {
                symbolic = true;
            }
            if a.contains('r') {
                relative = true;
            }
            if a.contains('b') {
                backup_simple = true;
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
    if fs.exists(&link_path) || fs.lstat(&link_path).is_ok() {
        if backup_numbered {
            for k in 1..1000usize {
                let bak = format!("{link_path}.~{k}~");
                if !fs.exists(&bak) && fs.lstat(&bak).is_err() {
                    let _ = copy_recursive(&link_path, &bak, fs);
                    break;
                }
            }
        } else if backup_simple {
            let bak = format!("{link_path}~");
            let _ = copy_recursive(&link_path, &bak, fs);
        }
    }
    if force || backup_numbered || backup_simple {
        let _ = fs.remove_path(&link_path);
    }
    let stored_target = if symbolic {
        if relative {
            let target_full = resolve_posix_path(cwd, target);
            let link_dir = crate::vfs::dirname_posix_path(&link_path);
            relative_posix_path(&link_dir, &target_full)
        } else {
            target.clone()
        }
    } else {
        let target_full = resolve_posix_path(cwd, target);
        format!("__hardlink__:{target_full}")
    };
    if let Err(e) = fs.symlink(&stored_target, &link_path) {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: format!("ln: {e}\n"),
            exit_code: 1,
        };
    }
    ok_out("")
}

fn cmd_readlink(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut mode = 'L';
    let mut no_newline = false;
    let mut zero = false;
    let mut verbose = false;
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
            "--verbose" => verbose = true,
            "--quiet" | "--silent" => verbose = false,
            s if s.starts_with('-') && !s.starts_with("--") && s.len() > 1 => {
                for ch in s[1..].chars() {
                    match ch {
                        'f' => mode = 'f',
                        'e' => mode = 'e',
                        'm' => mode = 'm',
                        'n' => no_newline = true,
                        'z' => zero = true,
                        'v' => verbose = true,
                        'q' | 's' => verbose = false,
                        _ => {
                            return err_out(&format!("readlink: invalid option -- '{ch}'\n"), 1);
                        }
                    }
                }
            }
            s if s.starts_with("--") => {
                return err_out(&format!("readlink: unrecognized option '{s}'\n"), 1);
            }
            _ => targets.push(a.clone()),
        }
    }
    if targets.is_empty() {
        return err_out("readlink: missing operand\n", 1);
    }
    let mut out = String::new();
    let mut err_buf = String::new();
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
                Ok(t) if !t.starts_with("__hardlink__:") => {
                    out.push_str(&t);
                    out.push_str(term);
                }
                _ => {
                    if verbose {
                        err_buf.push_str(&format!("readlink: {target}: Invalid argument\n"));
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
                    if verbose {
                        err_buf.push_str(&format!("readlink: {target}: {msg}\n"));
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

fn canonicalize_posix_path(
    raw: &str,
    mode: char,
    no_symlinks: bool,
    fs: &dyn SafeBashFs,
) -> Result<String, String> {
    if no_symlinks {
        let lexical = normalize_posix_path(raw);
        if mode == 'e' {
            if !fs.exists(&lexical) {
                return Err("No such file or directory".to_string());
            }
            let segs: Vec<&str> = lexical.split('/').filter(|s| !s.is_empty()).collect();
            let mut prefix = String::new();
            for seg in segs.iter().take(segs.len().saturating_sub(1)) {
                prefix.push('/');
                prefix.push_str(seg);
                if !fs.is_dir(&prefix) {
                    return Err("Not a directory".to_string());
                }
            }
        } else if mode != 'm' {
            let parent = crate::vfs::dirname_posix_path(&lexical);
            if !fs.exists(&parent) {
                return Err("No such file or directory".to_string());
            }
            if !fs.is_dir(&parent) {
                return Err("Not a directory".to_string());
            }
        }
        return Ok(lexical);
    }

    let mut queue: VecDeque<String> = raw
        .split('/')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    let mut cur = String::from("/");
    let mut hops = 0usize;
    while let Some(part) = queue.pop_front() {
        if part == "." {
            if mode != 'm' && (!fs.exists(&cur) || !fs.is_dir(&cur)) {
                return Err("No such file or directory".to_string());
            }
            continue;
        }
        if part == ".." {
            if mode != 'm' && (!fs.exists(&cur) || !fs.is_dir(&cur)) {
                return Err("No such file or directory".to_string());
            }
            cur = crate::vfs::dirname_posix_path(&cur);
            continue;
        }
        if mode != 'm' {
            if !fs.exists(&cur) {
                return Err("No such file or directory".to_string());
            }
            if !fs.is_dir(&cur) {
                return Err("Not a directory".to_string());
            }
        }
        let next = if cur == "/" {
            format!("/{part}")
        } else {
            format!("{cur}/{part}")
        };
        if let Ok(link_t) = fs.readlink(&next)
            && !link_t.starts_with("__hardlink__:")
        {
            hops += 1;
            if hops > 40 {
                return Err("Too many levels of symbolic links".to_string());
            }
            if link_t.starts_with('/') {
                cur = "/".to_string();
            }
            for seg in link_t.split('/').filter(|s| !s.is_empty()).rev() {
                queue.push_front(seg.to_string());
            }
            continue;
        }
        if !queue.is_empty() {
            if mode != 'm' {
                if !fs.exists(&next) {
                    return Err("No such file or directory".to_string());
                }
                if !fs.is_dir(&next) {
                    return Err("Not a directory".to_string());
                }
            }
        } else if mode == 'e' && !fs.exists(&next) {
            return Err("No such file or directory".to_string());
        }
        cur = next;
    }
    Ok(cur)
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
    let mut rel_base: Option<String> = None;
    let mut mode = 'E';
    let mut no_symlinks = false;
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
        } else if a == "--relative-to" && i + 1 < args.len() {
            rel_to = Some(args[i + 1].clone());
            i += 2;
        } else if let Some(r) = a.strip_prefix("--relative-base=") {
            rel_base = Some(r.to_string());
            i += 1;
        } else if a == "--relative-base" && i + 1 < args.len() {
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
            i += 1;
        } else if a == "--logical" {
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
                    'P' => no_symlinks = false,
                    'L' => {}
                    'q' => quiet = true,
                    'z' => zero = true,
                    _ => return err_out(&format!("realpath: invalid option -- '{ch}'\n"), 1),
                }
            }
            i += 1;
        } else if a.starts_with("--") {
            return err_out(&format!("realpath: unrecognized option '{a}'\n"), 1);
        } else {
            targets.push(a.clone());
            i += 1;
        }
    }
    if targets.is_empty() {
        return err_out("realpath: missing operand\n", 1);
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
        Some(b) => match canonicalize_posix_path(&raw_for(b), mode, no_symlinks, fs) {
            Ok(r) => Some(r),
            Err(msg) => {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: if quiet {
                        String::new()
                    } else {
                        format!("realpath: {b}: {msg}\n")
                    },
                    exit_code: 1,
                };
            }
        },
        None => None,
    };
    let to_resolved = match to_operand {
        Some(t) => match canonicalize_posix_path(&raw_for(t), mode, no_symlinks, fs) {
            Ok(r) => Some(r),
            Err(msg) => {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: if quiet {
                        String::new()
                    } else {
                        format!("realpath: {t}: {msg}\n")
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
        let raw = raw_for(&a);
        let resolved = match canonicalize_posix_path(&raw, mode, no_symlinks, fs) {
            Ok(r) => r,
            Err(msg) => {
                if !quiet {
                    err_buf.push_str(&format!("realpath: {a}: {msg}\n"));
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
    if let Ok(oct) = u32::from_str_radix(spec, 8) {
        return oct;
    }
    let mut mode = current & 0o7777;
    let had_exec = is_dir || (mode & 0o111) != 0;
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
            let mut special_bits = 0u32;
            while let Some(&p) = chars.peek() {
                match p {
                    'r' => { perm_bits |= 0o444; chars.next(); }
                    'w' => { perm_bits |= 0o222; chars.next(); }
                    'x' => { perm_bits |= 0o111; chars.next(); }
                    'X' => {
                        if had_exec || (mode & 0o111) != 0 {
                            perm_bits |= 0o111;
                        }
                        chars.next();
                    }
                    's' => {
                        if (who_mask & 0o400) != 0 {
                            special_bits |= 0o4000;
                        }
                        if (who_mask & 0o040) != 0 {
                            special_bits |= 0o2000;
                        }
                        chars.next();
                    }
                    't' => {
                        special_bits |= 0o1000;
                        chars.next();
                    }
                    _ => break,
                }
            }
            let masked = (perm_bits & who_mask) | special_bits;
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
    let is_dir = fs.is_dir(path);
    let new_mode = eval_chmod_mode(mode_spec, cur, is_dir);
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
    let mut ref_file: Option<String> = None;
    let mut positional = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-R" || a == "--recursive" {
            recursive = true;
        } else if let Some(rf) = a.strip_prefix("--reference=") {
            ref_file = Some(rf.to_string());
        } else if a == "--reference" && i + 1 < args.len() {
            i += 1;
            ref_file = Some(args[i].clone());
        } else if !a.starts_with('-') {
            positional.push(a.clone());
        }
        i += 1;
    }
    let (mode_str, targets_slice): (String, &[String]) = if let Some(rf) = ref_file {
        let rp = resolve_posix_path(cwd, &rf);
        let ref_mode = fs.stat(&rp).map(|s| s.mode & 0o7777).unwrap_or(0o644);
        (format!("{ref_mode:o}"), &positional[..])
    } else if positional.len() >= 2 {
        (positional[0].clone(), &positional[1..])
    } else {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "chmod: missing operand\n".to_string(),
            exit_code: 1,
        };
    };
    let mut stderr = String::new();
    let mut code = 0;
    for t in targets_slice {
        let p = resolve_posix_path(cwd, t);
        if let Err(e) = apply_chmod_recursive(&p, &mode_str, recursive, fs) {
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
    let mut is_printf = false;
    let mut deref = false;
    let mut targets = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        if (args[i] == "-c" || args[i] == "--format") && i + 1 < args.len() {
            fmt_spec = Some(args[i + 1].clone());
            is_printf = false;
            i += 2;
        } else if let Some(rest) = args[i].strip_prefix("--format=") {
            fmt_spec = Some(rest.to_string());
            is_printf = false;
            i += 1;
        } else if args[i] == "--printf" && i + 1 < args.len() {
            fmt_spec = Some(args[i + 1].clone());
            is_printf = true;
            i += 2;
        } else if let Some(rest) = args[i].strip_prefix("--printf=") {
            fmt_spec = Some(rest.to_string());
            is_printf = true;
            i += 1;
        } else if args[i] == "-L" || args[i] == "--dereference" {
            deref = true;
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
        let st_res = if deref { fs.stat(&p) } else { fs.lstat(&p) };
        match st_res {
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
                    let type_ch = match st.kind {
                        VfsEntryKind::Directory => 'd',
                        VfsEntryKind::Symlink => 'l',
                        VfsEntryKind::File => '-',
                    };
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
                    let sym_perm = format!(
                        "{type_ch}{}{}{}{}{}{}{}{}{}",
                        if perm & 0o400 != 0 { 'r' } else { '-' },
                        if perm & 0o200 != 0 { 'w' } else { '-' },
                        ux,
                        if perm & 0o040 != 0 { 'r' } else { '-' },
                        if perm & 0o020 != 0 { 'w' } else { '-' },
                        gx,
                        if perm & 0o004 != 0 { 'r' } else { '-' },
                        if perm & 0o002 != 0 { 'w' } else { '-' },
                        ox,
                    );
                    let nlink = if spec.contains("%h") {
                        let hl_tag = format!("__hardlink__:{p}");
                        let extra = fs
                            .export_entries()
                            .unwrap_or_default()
                            .iter()
                            .filter(|e| e.symlink_target.as_deref() == Some(hl_tag.as_str()))
                            .count();
                        1 + extra
                    } else {
                        1
                    };
                    let quoted_n = if let Ok(lt) = fs.readlink(&p) {
                        format!("'{t}' -> '{lt}'")
                    } else {
                        format!("'{t}'")
                    };
                    let atime_ms = atime_store()
                        .lock()
                        .ok()
                        .and_then(|m| m.get(&p).copied())
                        .unwrap_or(st.mtime_ms);
                    let rendered = spec
                        .replace("%A", &sym_perm)
                        .replace("%a", &format!("{perm:o}"))
                        .replace("%h", &nlink.to_string())
                        .replace("%N", &quoted_n)
                        .replace("%s", &st.size.to_string())
                        .replace("%n", &t)
                        .replace("%F", ftype)
                        .replace("%Y", &(st.mtime_ms / 1000).to_string())
                        .replace("%X", &(atime_ms / 1000).to_string());
                    if is_printf {
                        let unescaped = rendered
                            .replace("\\n", "\n")
                            .replace("\\t", "\t")
                            .replace("\\r", "\r")
                            .replace("\\\\", "\\");
                        out.push_str(&unescaped);
                    } else {
                        out.push_str(&rendered);
                        out.push('\n');
                    }
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
    let mut summary_only = false;
    let mut max_depth: Option<usize> = None;
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
        } else if let Some(d) = a.strip_prefix("--max-depth=") {
            max_depth = d.parse().ok();
            i += 1;
        } else if a == "-d" && i + 1 < args.len() {
            max_depth = args[i + 1].parse().ok();
            i += 2;
        } else if let Some(d) = a.strip_prefix("-d") && !d.is_empty() && d.chars().all(|c| c.is_ascii_digit()) {
            max_depth = d.parse().ok();
            i += 1;
        } else if a.starts_with('-') {
            if a.contains('b') {
                bytes_mode = true;
            }
            if a.contains('s') {
                summary_only = true;
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
    if summary_only {
        max_depth = Some(0);
    }
    #[allow(clippy::too_many_arguments)]
    fn walk_du(
        disp: &str,
        full: &str,
        depth: usize,
        max_depth: Option<usize>,
        bytes_mode: bool,
        excludes: &[String],
        fs: &dyn SafeBashFs,
        out: &mut String,
    ) {
        if fs.is_dir(full) {
            let mut entries = fs.list_dir(full).unwrap_or_default();
            entries.sort();
            for name in entries {
                let child_full = if full == "/" {
                    format!("/{name}")
                } else {
                    format!("{full}/{name}")
                };
                if fs.is_dir(&child_full) {
                    let child_disp = if disp == "/" {
                        format!("/{name}")
                    } else {
                        format!("{}/{name}", disp.trim_end_matches('/'))
                    };
                    walk_du(
                        &child_disp,
                        &child_full,
                        depth + 1,
                        max_depth,
                        bytes_mode,
                        excludes,
                        fs,
                        out,
                    );
                }
            }
        }
        if max_depth.map(|md| depth <= md).unwrap_or(true) {
            let b = dir_bytes(full, excludes, fs);
            let val = if bytes_mode { b } else { b.div_ceil(1024).max(1) };
            out.push_str(&format!("{val}\t{disp}\n"));
        }
    }
    let mut out = String::new();
    for t in targets {
        let p = resolve_posix_path(cwd, &t);
        walk_du(&t, &p, 0, max_depth, bytes_mode, &excludes, fs, &mut out);
    }
    ok_out(&out)
}

fn cmd_df(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut show_type = false;
    let mut show_inodes = false;
    let mut show_total = false;
    let mut block_header = "1K-blocks".to_string();
    let mut include_types: Vec<String> = Vec::new();
    let mut exclude_types: Vec<String> = Vec::new();
    let mut output_cols: Option<Vec<String>> = None;
    let mut targets: Vec<String> = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if let Some(cols) = a.strip_prefix("--output=") {
            output_cols = Some(cols.split(',').map(|s| s.trim().to_string()).collect());
            i += 1;
        } else if a == "--total" {
            show_total = true;
            i += 1;
        } else if (a == "-B" || a == "--block-size") && i + 1 < args.len() {
            block_header = format!("{}-blocks", args[i + 1]);
            i += 2;
        } else if let Some(bs) = a.strip_prefix("--block-size=").or_else(|| a.strip_prefix("-B")) && !bs.is_empty() {
            block_header = format!("{bs}-blocks");
            i += 1;
        } else if (a == "-t" || a == "--type") && i + 1 < args.len() {
            include_types.push(args[i + 1].clone());
            i += 2;
        } else if let Some(t) = a.strip_prefix("--type=").or_else(|| a.strip_prefix("-t")) && !t.is_empty() {
            include_types.push(t.to_string());
            i += 1;
        } else if (a == "-x" || a == "--exclude-type") && i + 1 < args.len() {
            exclude_types.push(args[i + 1].clone());
            i += 2;
        } else if let Some(t) = a.strip_prefix("--exclude-type=").or_else(|| a.strip_prefix("-x")) && !t.is_empty() {
            exclude_types.push(t.to_string());
            i += 1;
        } else if a.starts_with('-') && !a.starts_with("--") {
            for ch in a[1..].chars() {
                match ch {
                    'T' => show_type = true,
                    'i' => show_inodes = true,
                    'h' | 'H' => block_header = "Size".to_string(),
                    _ => {}
                }
            }
            i += 1;
        } else if !a.starts_with('-') {
            targets.push(a.clone());
            i += 1;
        } else {
            i += 1;
        }
    }

    for t in &targets {
        let p = resolve_posix_path(cwd, t);
        if !fs.exists(&p) && fs.lstat(&p).is_err() {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("df: {t}: No such file or directory\n"),
                exit_code: 1,
            };
        }
    }

    struct DfRow {
        source: &'static str,
        fstype: &'static str,
        blocks: &'static str,
        used: &'static str,
        avail: &'static str,
        pcent: &'static str,
        target: &'static str,
    }
    let all_rows = if targets.is_empty() {
        vec![
            DfRow {
                source: "sandbox-vfs",
                fstype: "vfs",
                blocks: "65536",
                used: "8",
                avail: "65528",
                pcent: "1%",
                target: "/",
            },
            DfRow {
                source: "tmpfs",
                fstype: "tmpfs",
                blocks: "65536",
                used: "0",
                avail: "65536",
                pcent: "0%",
                target: "/tmp",
            },
        ]
    } else {
        vec![DfRow {
            source: "sandbox-vfs",
            fstype: "vfs",
            blocks: "65536",
            used: "8",
            avail: "65528",
            pcent: "1%",
            target: "/",
        }]
    };

    let rows: Vec<&DfRow> = all_rows
        .iter()
        .filter(|r| {
            (include_types.is_empty() || include_types.iter().any(|t| t == r.fstype))
                && !exclude_types.iter().any(|t| t == r.fstype)
        })
        .collect();

    let mut out = String::new();
    if let Some(cols) = output_cols {
        let hdr: Vec<&str> = cols
            .iter()
            .map(|c| match c.as_str() {
                "source" => "Filesystem",
                "fstype" => "Type",
                "target" => "Mounted on",
                "size" => block_header.as_str(),
                "used" => "Used",
                "avail" => "Avail",
                "pcent" => "Use%",
                other => other,
            })
            .collect();
        out.push_str(&format!("{}\n", hdr.join(" ")));
        for r in &rows {
            let vals: Vec<&str> = cols
                .iter()
                .map(|c| match c.as_str() {
                    "source" => r.source,
                    "fstype" => r.fstype,
                    "target" => r.target,
                    "size" => r.blocks,
                    "used" => r.used,
                    "avail" => r.avail,
                    "pcent" => r.pcent,
                    _ => "-",
                })
                .collect();
            out.push_str(&format!("{}\n", vals.join(" ")));
        }
        if show_total {
            let vals: Vec<&str> = cols
                .iter()
                .enumerate()
                .map(|(idx, c)| {
                    if idx == 0 || c == "source" {
                        "total"
                    } else {
                        "-"
                    }
                })
                .collect();
            out.push_str(&format!("{}\n", vals.join(" ")));
        }
        return ok_out(&out);
    }

    if show_inodes {
        out.push_str("Filesystem Inodes IUsed IFree IUse% Mounted on\n");
        for r in &rows {
            out.push_str(&format!(
                "{} 100000 10 99990 1% {}\n",
                r.source, r.target
            ));
        }
        return ok_out(&out);
    }

    if show_type {
        out.push_str(&format!(
            "Filesystem Type {block_header} Used Available Use% Mounted on\n"
        ));
        for r in &rows {
            out.push_str(&format!(
                "{} {} {} {} {} {} {}\n",
                r.source, r.fstype, r.blocks, r.used, r.avail, r.pcent, r.target
            ));
        }
    } else {
        out.push_str(&format!(
            "Filesystem {block_header} Used Available Use% Mounted on\n"
        ));
        for r in &rows {
            out.push_str(&format!(
                "{} {} {} {} {} {}\n",
                r.source, r.blocks, r.used, r.avail, r.pcent, r.target
            ));
        }
    }
    ok_out(&out)
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
        return err_out(&format!("mktemp: too few X's in template '{tpl}'\n"), 1);
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
                        "mktemp: failed to create {}: No such file or directory\n",
                        if is_dir { "directory" } else { "file" }
                    )
                },
                exit_code: 1,
            };
        }
        let umask = env
            .get("__SAFE_BASH_UMASK")
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
    let mut no_indent = false;
    let mut full_path = false;
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
        } else if a == "-i" {
            no_indent = true;
            i += 1;
        } else if a == "-f" {
            full_path = true;
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
    #[allow(clippy::too_many_arguments)]
    fn render_tree_text(
        dir_path: &str,
        prefix: &str,
        depth: usize,
        max_depth: Option<usize>,
        show_all: bool,
        dirs_only: bool,
        no_indent: bool,
        full_path: bool,
        ignore_pat: Option<&str>,
        match_pat: Option<&str>,
        fs: &dyn SafeBashFs,
        out: &mut String,
    ) {
        if let Some(md) = max_depth && depth >= md {
            return;
        }
        let Ok(mut names) = fs.list_dir(dir_path) else {
            return;
        };
        names.sort();
        let filtered: Vec<String> = names
            .into_iter()
            .filter(|n| {
                if !show_all && n.starts_with('.') {
                    return false;
                }
                if let Some(ig) = ignore_pat && crate::shell::expand::glob_match(ig, n) {
                    return false;
                }
                let child = resolve_posix_path(dir_path, n);
                let is_d = fs.is_dir(&child);
                if dirs_only && !is_d {
                    return false;
                }
                if !is_d && let Some(mp) = match_pat && !crate::shell::expand::glob_match(mp, n) {
                    return false;
                }
                true
            })
            .collect();
        for (idx, n) in filtered.iter().enumerate() {
            let last = idx + 1 == filtered.len();
            let child = resolve_posix_path(dir_path, n);
            let disp = if full_path { child.as_str() } else { n.as_str() };
            if no_indent {
                out.push_str(&format!("{disp}\n"));
            } else {
                let branch = if last { "`-- " } else { "|-- " };
                out.push_str(&format!("{prefix}{branch}{disp}\n"));
            }
            if fs.is_dir(&child) {
                let next_prefix = format!("{prefix}{}", if last { "    " } else { "|   " });
                render_tree_text(
                    &child,
                    &next_prefix,
                    depth + 1,
                    max_depth,
                    show_all,
                    dirs_only,
                    no_indent,
                    full_path,
                    ignore_pat,
                    match_pat,
                    fs,
                    out,
                );
            }
        }
    }
    render_tree_text(
        &root,
        "",
        0,
        max_depth,
        show_all,
        dirs_only,
        no_indent,
        full_path,
        ignore_pat.as_deref(),
        match_pat.as_deref(),
        fs,
        &mut out,
    );
    ok_out(&out)
}

fn cmd_file(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let brief = args.iter().any(|a| a == "-b" || a == "--brief");
    let mime = args.iter().any(|a| a == "--mime-type" || a == "-i");
    let deref = args.iter().any(|a| a == "-L" || a == "--dereference");
    let mut out = String::new();
    for a in args {
        if a.starts_with('-') {
            continue;
        }
        let mut p = resolve_posix_path(cwd, a);
        let is_symlink = fs.readlink(&p).is_ok();
        if is_symlink && deref {
            if let Ok(target) = fs.readlink(&p) {
                p = resolve_posix_path(&crate::vfs::dirname_posix_path(&p), &target);
            }
        }
        let desc = if is_symlink && !deref {
            if mime { "inode/symlink" } else { "symbolic link" }
        } else if fs.is_dir(&p) {
            if mime { "inode/directory" } else { "directory" }
        } else if let Ok(data) = fs.read_file(&p) {
            if data.starts_with(b"\x89PNG\r\n\x1a\n") {
                if mime { "image/png" } else { "PNG image data" }
            } else if data.starts_with(b"\xff\xd8\xff") {
                if mime { "image/jpeg" } else { "JPEG image data" }
            } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
                if mime { "image/gif" } else { "GIF image data" }
            } else if data.len() >= 12 && data.starts_with(b"RIFF") && &data[8..12] == b"WEBP" {
                if mime { "image/webp" } else { "RIFF (little-endian) data, Web/P image" }
            } else if data.starts_with(b"II*\x00") || data.starts_with(b"MM\x00*") {
                if mime { "image/tiff" } else { "TIFF image data" }
            } else if data.starts_with(b"%PDF-") {
                if mime { "application/pdf" } else { "PDF document" }
            } else if data.starts_with(b"\x00asm") {
                if mime { "application/wasm" } else { "WebAssembly binary module" }
            } else if data.starts_with(b"SQLite format 3\0")
                || p.ends_with(".db")
                || p.ends_with(".sqlite")
                || p.ends_with(".sqlite3")
            {
                if mime { "application/vnd.sqlite3" } else { "SQLite 3.x database" }
            } else if data.starts_with(b"BZh") || p.ends_with(".bz2") {
                if mime { "application/x-bzip2" } else { "bzip2 compressed data" }
            } else if data.starts_with(b"\xfd7zXZ\x00") || p.ends_with(".xz") {
                if mime { "application/x-xz" } else { "XZ compressed data" }
            } else if data.starts_with(b"\x28\xb5\x2f\xfd") || p.ends_with(".zst") {
                if mime { "application/zstd" } else { "Zstandard compressed data" }
            } else if data.starts_with(b"\x1f\x8b") || p.ends_with(".gz") {
                if mime { "application/gzip" } else { "gzip compressed data" }
            } else if data.starts_with(b"PK\x03\x04") || p.ends_with(".zip") {
                if mime { "application/zip" } else { "Zip archive data" }
            } else if data.starts_with(b"#!") {
                if mime { "text/x-shellscript" } else { "shell script, ASCII text" }
            } else if data.starts_with(b"<?xml") || data.starts_with(b"<svg") {
                if mime { "text/xml" } else { "XML 1.0 document, ASCII text" }
            } else if data.starts_with(b"{") || data.starts_with(b"[") {
                if mime { "application/json" } else { "JSON text data" }
            } else if p.ends_with(".csv") {
                if mime { "text/csv" } else { "CSV text, ASCII text" }
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
