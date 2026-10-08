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
        "cp" => Some(cmd_cp(args, cwd, env, fs)),
        "mv" => Some(cmd_mv(args, cwd, env, fs)),
        "touch" => Some(cmd_touch(args, cwd, env, fs)),
        "ln" => Some(cmd_ln(args, cwd, env, fs)),
        "readlink" => Some(cmd_readlink(args, cwd, fs)),
        "realpath" => Some(cmd_realpath(args, cwd, fs)),
        "chmod" => Some(cmd_chmod(args, cwd, env, fs)),
        "stat" => Some(cmd_stat(args, cwd, env, fs)),
        "du" => Some(cmd_du(args, cwd, env, fs)),
        "df" => Some(cmd_df(args, cwd, fs)),
        "mktemp" => Some(cmd_mktemp(args, cwd, env, fs)),
        "tree" => Some(cmd_tree(args, cwd, env, fs)),
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

fn parse_backup_control(s: &str) -> BackupMode {
    match s {
        "none" | "off" => BackupMode::None,
        "simple" | "never" => BackupMode::Simple,
        "existing" | "nil" => BackupMode::Existing,
        "numbered" | "t" => BackupMode::Numbered,
        _ => BackupMode::Existing,
    }
}

fn create_backup_for_target(
    target: &str,
    mode: BackupMode,
    suffix: &str,
    fs: &dyn SafeBashFs,
) {
    if mode == BackupMode::None || (!fs.exists(target) && fs.lstat(target).is_err()) {
        return;
    }
    let mut largest = 0usize;
    if mode != BackupMode::Simple {
        let parent = crate::vfs::dirname_posix_path(target);
        let prefix = format!("{}.~", basename_posix_path(target));
        for entry in fs.list_dir(&parent).unwrap_or_default() {
            if let Some(rest) = entry.strip_prefix(&prefix)
                && let Some(digits) = rest.strip_suffix('~')
                && !digits.is_empty()
                && !digits.starts_with('0')
                && digits.chars().all(|c| c.is_ascii_digit())
                && let Ok(n) = digits.parse::<usize>()
                && n > largest
            {
                largest = n;
            }
        }
    }
    let bak = if mode == BackupMode::Numbered || (mode == BackupMode::Existing && largest > 0) {
        format!("{target}.~{}~", largest + 1)
    } else {
        format!("{target}{suffix}")
    };
    let _ = copy_recursive(target, &bak, fs);
}

fn cmd_ls(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut show_all = false;
    let mut show_dots = false;
    let mut ignore_backups = false;
    let mut dir_only = false;
    let mut recursive = false;
    let mut sort_mode = "name";
    let mut reverse = false;
    let mut indicator = "none";
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
        } else if a == "--classify" || a == "--indicator-style=classify" {
            indicator = "classify";
        } else if a == "--file-type" || a == "--indicator-style=file-type" {
            indicator = "file-type";
        } else if a == "--indicator-style=slash" {
            indicator = "slash";
        } else if a == "--indicator-style=none" {
            indicator = "none";
        } else if let Some(s) = a.strip_prefix("--sort=") {
            sort_mode = match s {
                "time" => "time",
                "size" => "size",
                "version" => "version",
                "extension" => "ext",
                "none" => "none",
                _ => "name",
            };
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
                    _ => {}
                }
            }
        } else if !a.starts_with("--") {
            targets.push(a.clone());
        }
        i += 1;
    }
    if targets.is_empty() {
        targets.push(".".to_string());
    }

    let suffix_for = |full_path: &str| -> &'static str {
        if indicator == "none" {
            return "";
        }
        if fs.readlink(full_path).is_ok() {
            if indicator == "file-type" || indicator == "classify" {
                return "@";
            }
            return "";
        }
        if fs.is_dir(full_path) {
            return "/";
        }
        if indicator == "classify" && fs.stat(full_path).map(|s| s.mode & 0o111 != 0).unwrap_or(false) {
            return "*";
        }
        ""
    };

    let sort_items = |items: &mut Vec<(String, String)>| {
        match sort_mode {
            "time" => {
                items.sort_by(|(da, pa), (db, pb)| {
                    let ma = fs.lstat(pa).map(|s| s.mtime_ms).unwrap_or(0);
                    let mb = fs.lstat(pb).map(|s| s.mtime_ms).unwrap_or(0);
                    mb.cmp(&ma).then_with(|| da.cmp(db))
                });
            }
            "size" => {
                items.sort_by(|(da, pa), (db, pb)| {
                    let sa = if fs.is_dir(pa) && fs.readlink(pa).is_err() {
                        0
                    } else {
                        fs.lstat(pa).map(|s| s.size).unwrap_or(0)
                    };
                    let sb = if fs.is_dir(pb) && fs.readlink(pb).is_err() {
                        0
                    } else {
                        fs.lstat(pb).map(|s| s.size).unwrap_or(0)
                    };
                    sb.cmp(&sa).then_with(|| da.cmp(db))
                });
            }
            "version" => {
                items.sort_by(|(da, _), (db, _)| natural_version_cmp(da, db));
            }
            "ext" => {
                items.sort_by(|(da, _), (db, _)| {
                    file_ext_key(da).cmp(file_ext_key(db)).then_with(|| da.cmp(db))
                });
            }
            "none" => {}
            _ => {
                items.sort_by(|(da, _), (db, _)| da.cmp(db));
            }
        }
        if reverse && sort_mode != "none" {
            items.reverse();
        }
    };

    let mut file_targets: Vec<(String, String)> = Vec::new();
    let mut dir_targets: Vec<(String, String)> = Vec::new();
    let mut stderr = String::new();
    let mut code = 0;

    for t in &targets {
        let p = resolve_posix_path(cwd, t);
        if !fs.exists(&p) && fs.lstat(&p).is_err() {
            stderr.push_str(&format!("ls: cannot access '{t}': No such file or directory\n"));
            code = 1;
            continue;
        }
        if dir_only || !fs.is_dir(&p) {
            file_targets.push((t.clone(), p));
        } else {
            dir_targets.push((t.clone(), p));
        }
    }

    sort_items(&mut file_targets);
    sort_items(&mut dir_targets);

    let mut out = String::new();
    let mut output_written = false;

    for (disp, p) in &file_targets {
        out.push_str(&format!("{disp}{}\n", suffix_for(p)));
        output_written = true;
    }

    #[allow(clippy::too_many_arguments)]
    fn list_dir_tree(
        disp: &str,
        dir_p: &str,
        show_header: bool,
        show_all: bool,
        show_dots: bool,
        ignore_backups: bool,
        recursive: bool,
        fs: &dyn SafeBashFs,
        sort_items: &dyn Fn(&mut Vec<(String, String)>),
        suffix_for: &dyn Fn(&str) -> &'static str,
        output_written: &mut bool,
        out: &mut String,
        stderr: &mut String,
        code: &mut i32,
    ) {
        if show_header {
            if *output_written {
                out.push('\n');
            }
            out.push_str(&format!("{disp}:\n"));
            *output_written = true;
        }
        match fs.list_dir(dir_p) {
            Ok(entries) => {
                let mut children: Vec<(String, String)> = Vec::new();
                if show_dots {
                    children.push((".".to_string(), dir_p.to_string()));
                    children.push(("..".to_string(), crate::vfs::dirname_posix_path(dir_p)));
                }
                for e in entries {
                    if !show_all && e.starts_with('.') {
                        continue;
                    }
                    if ignore_backups && e.ends_with('~') {
                        continue;
                    }
                    let pe = resolve_posix_path(dir_p, &e);
                    children.push((e, pe));
                }
                sort_items(&mut children);
                for (name, pe) in &children {
                    out.push_str(&format!("{name}{}\n", suffix_for(pe)));
                    *output_written = true;
                }
                if recursive {
                    for (name, pe) in &children {
                        if name == "." || name == ".." {
                            continue;
                        }
                        if fs.is_dir(pe) && fs.readlink(pe).is_err() {
                            let child_disp = child_disp_path(disp, name);
                            list_dir_tree(
                                &child_disp,
                                pe,
                                true,
                                show_all,
                                show_dots,
                                ignore_backups,
                                true,
                                fs,
                                sort_items,
                                suffix_for,
                                output_written,
                                out,
                                stderr,
                                code,
                            );
                        }
                    }
                }
            }
            Err(e) => {
                stderr.push_str(&format!("ls: cannot open directory '{disp}': {e}\n"));
                *code = 1;
            }
        }
    }

    let show_top_header = targets.len() > 1 || recursive;
    for (disp, p) in &dir_targets {
        list_dir_tree(
            disp,
            p,
            show_top_header,
            show_all,
            show_dots,
            ignore_backups,
            recursive,
            fs,
            &sort_items,
            &suffix_for,
            &mut output_written,
            &mut out,
            &mut stderr,
            &mut code,
        );
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
                    _ => {}
                }
                j += 1;
            }
            i += 1;
        } else {
            operands.push(a.clone());
            i += 1;
        }
    }
    if operands.is_empty() {
        return err_out("mkdir: missing operand\n", 2);
    }
    let umask_val = env
        .get("__umask")
        .and_then(|s| u32::from_str_radix(s, 8).ok())
        .unwrap_or(0o022);
    let default_mode = (0o777 & !umask_val) & 0o777;
    let explicit_mode = match mode_spec {
        Some(ref spec) => match eval_chmod_mode_checked(spec, default_mode, true, umask_val) {
            Ok(m) => Some(m),
            Err(msg) => return err_out(&format!("mkdir: {msg}\n"), 1),
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
            stderr.push_str(&format!("mkdir: cannot create directory '{a}': File exists\n"));
            code = 1;
            continue;
        }
        if !recursive {
            let parent = crate::vfs::dirname_posix_path(&p);
            if !fs.exists(&parent) || !fs.is_dir(&parent) {
                stderr.push_str(&format!(
                    "mkdir: cannot create directory '{a}': No such file or directory\n"
                ));
                code = 1;
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
        if let Err(e) = fs.mkdir_all(&p) {
            stderr.push_str(&format!("mkdir: cannot create directory '{a}': {e}\n"));
            code = 1;
        } else {
            let mode = explicit_mode.unwrap_or(default_mode);
            let _ = fs.chmod(&p, mode);
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
                    _ => {}
                }
            }
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
        let mut cur_p = resolve_posix_path(cwd, a);
        let mut cur_disp = a.clone();
        loop {
            if !fs.exists(&cur_p) && fs.lstat(&cur_p).is_err() {
                stderr.push_str(&format!(
                    "rmdir: failed to remove '{cur_disp}': No such file or directory\n"
                ));
                code = 1;
                break;
            }
            if !fs.is_dir(&cur_p) || fs.readlink(&cur_p).is_ok() {
                stderr.push_str(&format!(
                    "rmdir: failed to remove '{cur_disp}': Not a directory\n"
                ));
                code = 1;
                break;
            }
            if let Ok(entries) = fs.list_dir(&cur_p)
                && !entries.is_empty()
            {
                if !ignore_non_empty {
                    stderr.push_str(&format!(
                        "rmdir: failed to remove '{cur_disp}': Directory not empty\n"
                    ));
                    code = 1;
                }
                break;
            }
            if let Err(e) = fs.remove_path(&cur_p) {
                stderr.push_str(&format!("rmdir: failed to remove '{cur_disp}': {e}\n"));
                code = 1;
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
    let mut interactive = false;
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
                interactive = false;
            } else if a == "--interactive" || a == "--interactive=always" || a == "--interactive=yes" {
                interactive = true;
                force = false;
            } else if a == "--interactive=never" || a == "--interactive=no" || a == "--interactive=none" {
                interactive = false;
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
                            interactive = false;
                        }
                        'i' => {
                            interactive = true;
                            force = false;
                        }
                        'r' | 'R' => recursive = true,
                        'd' => dir_mode = true,
                        'v' => verbose = true,
                        _ => {}
                    }
                }
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
    for t in targets {
        let p = resolve_posix_path(cwd, &t);
        let exists = fs.exists(&p) || fs.lstat(&p).is_ok();
        if !exists {
            if !force {
                stderr.push_str(&format!("rm: cannot remove '{t}': No such file or directory\n"));
                code = 1;
            }
            continue;
        }
        let is_real_dir = fs.is_dir(&p) && fs.readlink(&p).is_err();
        if is_real_dir && !recursive && !dir_mode {
            stderr.push_str(&format!("rm: cannot remove '{t}': Is a directory\n"));
            code = 1;
            continue;
        }
        if is_real_dir && !recursive && dir_mode {
            if fs.list_dir(&p).map(|e| !e.is_empty()).unwrap_or(false) {
                stderr.push_str(&format!("rm: cannot remove '{t}': Directory not empty\n"));
                code = 1;
                continue;
            }
        }
        if interactive && !force {
            let ans = stdin_lines.next().unwrap_or("");
            let first = ans.trim().chars().next().unwrap_or('n');
            if first != 'y' && first != 'Y' {
                continue;
            }
        }
        match fs.remove_path(&p) {
            Ok(()) => {
                if verbose {
                    stdout.push_str(&format!("removed '{t}'\n"));
                }
            }
            Err(e) => {
                if !force {
                    stderr.push_str(&format!("rm: cannot remove '{t}': {e}\n"));
                    code = 1;
                }
            }
        }
    }
    BuiltinOutcome {
        stdout,
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
            let _ = fs.set_mtime(dst, st.mtime_ms);
        }
        Ok(())
    }
}

fn cmd_cp(
    args: &[String],
    cwd: &str,
    env: &std::collections::BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut operands: Vec<String> = Vec::new();
    let mut end_opts = false;
    let mut no_clobber = false;
    let mut update_only = false;
    let mut hard_link = false;
    let mut sym_link = false;
    let mut verbose = false;
    let mut no_target_dir = false;
    let mut target_dir: Option<String> = None;
    let mut backup_flag = false;
    let mut suffix_flag = false;
    let mut backup_control: Option<String> = None;
    let mut backup_suffix = env
        .get("SIMPLE_BACKUP_SUFFIX")
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| "~".to_string());
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
            suffix_flag = true;
            i += 2;
            continue;
        }
        if !end_opts && (a == "-t" || a == "--target-directory") && i + 1 < args.len() {
            target_dir = Some(args[i + 1].clone());
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
            } else if a == "--verbose" {
                verbose = true;
            } else if a == "--no-target-directory" {
                no_target_dir = true;
            } else if let Some(td) = a.strip_prefix("--target-directory=") {
                target_dir = Some(td.to_string());
            } else if a == "--dereference" {
                deref_opt = Some('L');
            } else if a == "--no-dereference" {
                deref_opt = Some('P');
            } else if a == "--archive" {
                recursive = true;
                deref_opt = Some('P');
            } else if a == "--recursive" {
                recursive = true;
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
                        'n' => no_clobber = true,
                        'u' => update_only = true,
                        'l' => hard_link = true,
                        's' => sym_link = true,
                        'b' => backup_flag = true,
                        'v' => verbose = true,
                        'T' => no_target_dir = true,
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
                        'r' | 'R' => recursive = true,
                        'a' => {
                            recursive = true;
                            deref_opt = Some('P');
                        }
                        'd' | 'P' => deref_opt = Some('P'),
                        'L' => deref_opt = Some('L'),
                        'H' => deref_opt = Some('H'),
                        _ => {}
                    }
                    j += 1;
                }
            }
            i += 1;
            continue;
        }
        operands.push(a.clone());
        i += 1;
    }
    if target_dir.is_some() && no_target_dir {
        return err_out("cp: cannot combine --target-directory and --no-target-directory\n", 2);
    }
    let eff_operands: Vec<String> = if let Some(ref td) = target_dir {
        let mut v = operands;
        v.push(td.clone());
        v
    } else {
        operands
    };
    if eff_operands.len() < 2 {
        return err_out("cp: missing file operand\n", 2);
    }
    let backup_mode = if let Some(ref ctrl) = backup_control {
        parse_backup_control(ctrl)
    } else if backup_flag || suffix_flag {
        parse_backup_control(env.get("VERSION_CONTROL").map(|s| s.as_str()).unwrap_or("existing"))
    } else {
        BackupMode::None
    };
    let deref_mode = deref_opt.unwrap_or(if recursive { 'P' } else { 'H' });
    let dst_raw = eff_operands.last().unwrap();
    let dst_base = resolve_posix_path(cwd, dst_raw);
    let dst_is_dir = !no_target_dir && fs.is_dir(&dst_base);
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut code = 0;

    for src_raw in &eff_operands[..eff_operands.len() - 1] {
        let src = resolve_posix_path(cwd, src_raw);
        let src_is_dir = if deref_mode == 'P' {
            fs.is_dir(&src) && fs.readlink(&src).is_err()
        } else {
            fs.is_dir(&src)
        };
        if src_is_dir && !recursive && !sym_link {
            stderr.push_str(&format!("cp: -r not specified; omitting directory '{src_raw}'\n"));
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
        if fs.exists(&target) || fs.lstat(&target).is_ok() {
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
            create_backup_for_target(&target, backup_mode, &backup_suffix, fs);
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
        match copy_res {
            Ok(()) => {
                if verbose {
                    stdout.push_str(&format!("'{src_raw}' -> '{disp_target}'\n"));
                }
            }
            Err(e) => {
                stderr.push_str(&format!("cp: cannot copy '{src_raw}': {e}\n"));
                code = 1;
            }
        }
    }
    BuiltinOutcome {
        stdout,
        stderr,
        exit_code: code,
    }
}

fn cmd_mv(
    args: &[String],
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
                        _ => {}
                    }
                    j += 1;
                }
            }
            i += 1;
            continue;
        }
        operands.push(a.clone());
        i += 1;
    }
    let no_clobber = overwrite == Some('n');
    let backup_mode = if let Some(ref ctrl) = backup_control {
        parse_backup_control(ctrl)
    } else if backup_flag || suffix_flag {
        parse_backup_control(env.get("VERSION_CONTROL").map(|s| s.as_str()).unwrap_or("existing"))
    } else {
        BackupMode::None
    };
    if backup_mode != BackupMode::None && no_clobber {
        return err_out("mv: options --backup and --no-clobber are mutually exclusive\n", 2);
    }
    if target_dir.is_some() && no_target_dir {
        return err_out("mv: cannot combine --target-directory and --no-target-directory\n", 2);
    }
    let eff_operands: Vec<String> = if let Some(ref td) = target_dir {
        let mut v = operands;
        v.push(td.clone());
        v
    } else {
        operands
    };
    if eff_operands.len() < 2 {
        return err_out("mv: missing file operand\n", 2);
    }
    let dst_raw = eff_operands.last().unwrap();
    let dst_base = resolve_posix_path(cwd, dst_raw);
    let dst_is_dir = !no_target_dir && fs.is_dir(&dst_base);
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut code = 0;

    for src_raw in &eff_operands[..eff_operands.len() - 1] {
        let src = resolve_posix_path(cwd, src_raw);
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
        if src == target {
            continue;
        }
        if fs.exists(&target) || fs.lstat(&target).is_ok() {
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
            create_backup_for_target(&target, backup_mode, &backup_suffix, fs);
        }
        match copy_recursive(&src, &target, fs).and_then(|_| fs.remove_path(&src)) {
            Ok(()) => {
                if verbose {
                    stdout.push_str(&format!("renamed '{src_raw}' -> '{disp_target}'\n"));
                }
            }
            Err(e) => {
                stderr.push_str(&format!("mv: cannot move '{src_raw}': {e}\n"));
                code = 1;
            }
        }
    }
    BuiltinOutcome {
        stdout,
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

fn cmd_ln(
    args: &[String],
    cwd: &str,
    env: &std::collections::BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut force = false;
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
                "--force" => force = true,
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
                _ => {}
            }
        } else if a.starts_with('-') && a.len() > 1 {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut j = 0usize;
            while j < chars.len() {
                match chars[j] {
                    'f' => force = true,
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
                    _ => {}
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
        return err_out("ln: missing file operand\n", 2);
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
    let backup_mode = if let Some(ref ctrl) = backup_control {
        parse_backup_control(ctrl)
    } else if backup_flag || suffix_flag {
        parse_backup_control(env.get("VERSION_CONTROL").map(|s| s.as_str()).unwrap_or("existing"))
    } else {
        BackupMode::None
    };

    let last_op = eff_operands.last().unwrap();
    let target_base = resolve_posix_path(cwd, last_op);
    let is_dir = if no_target_dir {
        false
    } else if target_dir.is_some() || !no_deref {
        fs.is_dir(&target_base)
    } else {
        fs.is_dir(&target_base) && fs.readlink(&target_base).is_err()
    };
    if (target_dir.is_some() || eff_operands.len() > 2) && !is_dir {
        return err_out(&format!("ln: target '{last_op}' is not a directory\n"), 1);
    }

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut code = 0;

    for src_op in &eff_operands[..eff_operands.len() - 1] {
        let base_name = basename_posix_path(src_op);
        let link_path = if is_dir {
            child_disp_path(&target_base, &base_name)
        } else {
            target_base.clone()
        };
        let disp_target = if is_dir {
            child_disp_path(last_op, &base_name)
        } else {
            last_op.clone()
        };
        if fs.exists(&link_path) || fs.lstat(&link_path).is_ok() {
            if !force && backup_mode == BackupMode::None {
                stderr.push_str(&format!(
                    "ln: failed to create link '{disp_target}': File exists\n"
                ));
                code = 1;
                continue;
            }
            if fs.is_dir(&link_path) && fs.readlink(&link_path).is_err() {
                stderr.push_str(&format!(
                    "ln: '{disp_target}': cannot overwrite directory\n"
                ));
                code = 1;
                continue;
            }
            create_backup_for_target(&link_path, backup_mode, &backup_suffix, fs);
            let _ = fs.remove_path(&link_path);
        }
        let stored_target = if symbolic {
            if relative {
                let target_full = resolve_posix_path(cwd, src_op);
                let link_dir = crate::vfs::dirname_posix_path(&link_path);
                relative_posix_path(&link_dir, &target_full)
            } else {
                src_op.clone()
            }
        } else {
            let target_full = resolve_posix_path(cwd, src_op);
            format!("__hardlink__:{target_full}")
        };
        if let Err(e) = fs.symlink(&stored_target, &link_path) {
            stderr.push_str(&format!("ln: {e}\n"));
            code = 1;
            continue;
        }
        if verbose {
            let arrow = if symbolic { "->" } else { "=>" };
            let shown_target = if symbolic { &stored_target } else { src_op };
            stdout.push_str(&format!("'{disp_target}' {arrow} '{shown_target}'\n"));
        }
    }
    BuiltinOutcome {
        stdout,
        stderr,
        exit_code: code,
    }
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
    let st = fs.stat(path)?;
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
        .get("__umask")
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
                stderr.push_str(&format!("chmod: {t}: {e}\n"));
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

fn format_iso_stat_timestamp(ms: u64) -> String {
    let secs = (ms / 1000) as i64;
    let nanos = (ms % 1000) * 1_000_000;
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let hh = rem / 3600;
    let mm = (rem % 3600) / 60;
    let ss = rem % 60;
    let (y, m, d) = epoch_days_to_civil(days);
    format!("{y:04}-{m:02}-{d:02} {hh:02}:{mm:02}:{ss:02}.{nanos:09} +0000")
}

fn format_epoch_stat(ms: u64, precision: usize) -> String {
    let secs = ms / 1000;
    let rem_ms = ms % 1000;
    if precision == 0 {
        secs.to_string()
    } else {
        let ms_str = format!("{rem_ms:03}");
        let frac = if precision <= 3 {
            ms_str[..precision].to_string()
        } else {
            format!("{ms_str}{}", "0".repeat(precision - 3))
        };
        format!("{secs}.{frac}")
    }
}

fn quote_stat_name(text: &str, style: Option<&str>) -> String {
    if style == Some("literal") {
        text.to_string()
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
) -> String {
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
            let int_part = format_stat_field(
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
            return format!("{int_part}{}{}", &text[dot_idx..], " ".repeat(trail));
        }
    }
    let sliced = if !numeric && let Some(prec) = precision {
        let b = text.as_bytes();
        String::from_utf8_lossy(&b[..b.len().min(prec)]).into_owned()
    } else {
        text
    };
    let pad = width.saturating_sub(sliced.len());
    if flags.contains('-') {
        return format!("{sliced}{}", " ".repeat(pad));
    }
    if numeric && flags.contains('0') && (epoch || precision.is_none()) && pad > 0 {
        let pfx = if sliced.starts_with("0x") {
            "0x"
        } else if sliced.starts_with(['+', '-', ' ']) {
            &sliced[..1]
        } else {
            ""
        };
        return format!("{pfx}{}{}", "0".repeat(pad), &sliced[pfx.len()..]);
    }
    format!("{}{sliced}", " ".repeat(pad))
}

fn cmd_stat(
    args: &[String],
    cwd: &str,
    env: &std::collections::BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut fmt_spec: Option<String> = None;
    let mut is_printf = false;
    let mut is_bsd = false;
    let mut deref = false;
    let mut ended = false;
    let mut targets = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if ended || a == "-" || !a.starts_with('-') {
            targets.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if (a == "-c" || a == "--format") && i + 1 < args.len() {
            fmt_spec = Some(args[i + 1].clone());
            is_printf = false;
            is_bsd = false;
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--format=") {
            fmt_spec = Some(rest.to_string());
            is_printf = false;
            is_bsd = false;
            i += 1;
        } else if a == "--printf" && i + 1 < args.len() {
            fmt_spec = Some(args[i + 1].clone());
            is_printf = true;
            is_bsd = false;
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--printf=") {
            fmt_spec = Some(rest.to_string());
            is_printf = true;
            is_bsd = false;
            i += 1;
        } else if a == "-L" || a == "--dereference" {
            deref = true;
            i += 1;
        } else if !a.starts_with("--") {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut j = 0usize;
            while j < chars.len() {
                match chars[j] {
                    'L' => deref = true,
                    'c' => {
                        let rest: String = chars[j + 1..].iter().collect();
                        if !rest.is_empty() {
                            fmt_spec = Some(rest);
                        } else if i + 1 < args.len() {
                            i += 1;
                            fmt_spec = Some(args[i].clone());
                        }
                        is_printf = false;
                        is_bsd = false;
                        break;
                    }
                    'f' => {
                        if j + 1 == chars.len()
                            && i + 2 < args.len()
                            && args[i + 1].contains('%')
                            && !args[i + 1].starts_with("-c")
                            && !args[i + 1].starts_with("--format=")
                            && !args[i + 1].starts_with("--printf=")
                        {
                            i += 1;
                            fmt_spec = Some(args[i].clone());
                            is_bsd = true;
                            is_printf = false;
                        }
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
    if targets.is_empty() {
        return err_out("stat: missing operand\n", 1);
    }

    let quoting_style = env.get("QUOTING_STYLE").map(|s| s.as_str());
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
                let type_ch = match st.kind {
                    VfsEntryKind::Directory => 'd',
                    VfsEntryKind::Symlink => 'l',
                    VfsEntryKind::File => '-',
                };
                let sym_perm = format!("{type_ch}{}", format_perm_9(perm));
                let raw_mode = match st.kind {
                    VfsEntryKind::Directory => 0o040000 | perm,
                    VfsEntryKind::Symlink => 0o120000 | perm,
                    VfsEntryKind::File => 0o100000 | perm,
                };
                let atime_ms = atime_store()
                    .lock()
                    .ok()
                    .and_then(|m| m.get(&p).copied())
                    .unwrap_or(st.mtime_ms);
                let spec = fmt_spec.as_deref().unwrap_or(
                    "  File: %N\n  Size: %s\tType: %F\n  Mode: %a (%A)\nAccess: %x\nModify: %y\nChange: %z\n Birth: %w",
                );

                let bytes = spec.as_bytes();
                let mut idx = 0usize;
                let mut rendered = String::new();
                while idx < bytes.len() {
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
                            rendered.push(ch);
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
                            rendered.push('\\');
                            idx += 1;
                        } else {
                            rendered.push((val as u8) as char);
                            idx = off;
                        }
                        continue;
                    }
                    if bytes[idx] != b'%' {
                        let ch = spec[idx..].chars().next().unwrap();
                        rendered.push(ch);
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
                    let width = spec[width_start..p_idx].parse::<usize>().unwrap_or(0);
                    let mut prec_str: Option<&str> = None;
                    if p_idx < bytes.len() && bytes[p_idx] == b'.' {
                        p_idx += 1;
                        let ps = p_idx;
                        while p_idx < bytes.len() && bytes[p_idx].is_ascii_digit() {
                            p_idx += 1;
                        }
                        prec_str = Some(&spec[ps..p_idx]);
                    }
                    if p_idx >= bytes.len() {
                        rendered.push('%');
                        idx += 1;
                        continue;
                    }
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
                            let c1 = &rem[..1];
                            let mapped = match c1 {
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
                                other => other,
                            };
                            (mapped, 1)
                        }
                    } else {
                        (&spec[p_idx..p_idx + 1], 1usize)
                    };
                    idx = p_idx + consumed_code;

                    let epoch_code = matches!(dir_code, "X" | "Y" | "Z" | "W");
                    let precision = prec_str.map(|ps| {
                        if ps.is_empty() {
                            if epoch_code { 9 } else { 0 }
                        } else {
                            ps.parse::<usize>().unwrap_or(0)
                        }
                    });

                    let mut link_text: Option<String> = None;
                    let mut numeric = false;
                    let val_text = match dir_code {
                        "X" => {
                            numeric = true;
                            format_epoch_stat(atime_ms, precision.unwrap_or(0))
                        }
                        "Y" | "Z" | "W" => {
                            numeric = true;
                            format_epoch_stat(st.mtime_ms, precision.unwrap_or(0))
                        }
                        "x" => format_iso_stat_timestamp(atime_ms),
                        "y" | "z" | "w" => format_iso_stat_timestamp(st.mtime_ms),
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
                        "u" | "g" | "d" | "D" => {
                            numeric = true;
                            "0".to_string()
                        }
                        "U" | "G" => "root".to_string(),
                        "B" => {
                            numeric = true;
                            "512".to_string()
                        }
                        "b" => {
                            numeric = true;
                            st.size.div_ceil(512).to_string()
                        }
                        "i" => {
                            numeric = true;
                            "1".to_string()
                        }
                        "h" => {
                            numeric = true;
                            let hl_tag = format!("__hardlink__:{p}");
                            let extra = fs
                                .export_entries()
                                .unwrap_or_default()
                                .iter()
                                .filter(|e| e.symlink_target.as_deref() == Some(hl_tag.as_str()))
                                .count();
                            (1 + extra).to_string()
                        }
                        "m" => "/".to_string(),
                        other => format!("%{other}"),
                    };

                    rendered.push_str(&format_stat_field(
                        val_text,
                        dir_code,
                        flags,
                        width,
                        precision,
                        numeric,
                        epoch_code,
                    ));
                    if let Some(lt) = link_text {
                        rendered.push_str(" -> ");
                        rendered.push_str(&format_stat_field(
                            lt,
                            dir_code,
                            flags,
                            width,
                            precision,
                            false,
                            false,
                        ));
                    }
                }
                out.push_str(&rendered);
                if !is_printf {
                    out.push('\n');
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
    bytes: usize,
    inodes: bool,
    apparent: bool,
    block_unit: Option<(u64, String)>,
    human_base: Option<u64>,
) -> String {
    if inodes {
        return bytes.to_string();
    }
    if let Some(base) = human_base {
        let b = bytes as u64;
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
        let u = unit.max(1) as usize;
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
    _env: &std::collections::BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut apparent = false;
    let mut all = false;
    let mut summary_only = false;
    let mut show_total = false;
    let mut inodes = false;
    let mut separate = false;
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
            max_depth = d.parse().ok();
            i += 1;
        } else if (a == "-d" || a == "--max-depth") && i + 1 < args.len() {
            max_depth = args[i + 1].parse().ok();
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
                    'c' => show_total = true,
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
                            max_depth = rest.parse().ok();
                        } else if i + 1 < args.len() {
                            i += 1;
                            max_depth = args[i].parse().ok();
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

    let emit_line = |amt: usize, disp: &str, out: &mut String| {
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

    #[allow(clippy::too_many_arguments)]
    fn walk_du_node(
        disp: &str,
        full: &str,
        depth: usize,
        eff_depth: Option<usize>,
        all: bool,
        inodes: bool,
        separate: bool,
        excludes: &[String],
        fs: &dyn SafeBashFs,
        emit_line: &dyn Fn(usize, &str, &mut String),
        out: &mut String,
    ) -> (usize, bool) {
        if du_matches_excludes(disp, excludes) || du_matches_excludes(full, excludes) {
            return (0, false);
        }
        let is_dir = fs.is_dir(full);
        let base_amt = if inodes {
            1usize
        } else if is_dir {
            0usize
        } else {
            fs.read_file(full).map(|b| b.len()).unwrap_or(0)
        };
        let mut total_amt = base_amt;
        let mut own_amt = base_amt;
        if is_dir {
            let mut entries = fs.list_dir(full).unwrap_or_default();
            entries.sort();
            for name in entries {
                let child_full = child_disp_path(full, &name);
                let child_disp = child_disp_path(disp, &name);
                if du_matches_excludes(&child_disp, excludes)
                    || du_matches_excludes(&child_full, excludes)
                {
                    continue;
                }
                let (c_amt, c_is_dir) = walk_du_node(
                    &child_disp,
                    &child_full,
                    depth + 1,
                    eff_depth,
                    all,
                    inodes,
                    separate,
                    excludes,
                    fs,
                    emit_line,
                    out,
                );
                total_amt += c_amt;
                if separate && !c_is_dir {
                    own_amt += c_amt;
                }
            }
        }
        if depth == 0 || (eff_depth.map(|md| depth <= md).unwrap_or(true) && (is_dir || all)) {
            let reported = if separate { own_amt } else { total_amt };
            emit_line(reported, disp, out);
        }
        (total_amt, is_dir)
    }

    let mut out = String::new();
    let mut grand_total = 0usize;
    for t in targets {
        let p = resolve_posix_path(cwd, &t);
        let (amt, _) = walk_du_node(
            &t,
            &p,
            0,
            eff_depth,
            all,
            inodes,
            separate,
            &excludes,
            fs,
            &emit_line,
            &mut out,
        );
        grand_total += amt;
    }
    if show_total {
        emit_line(grand_total, "total", &mut out);
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

#[allow(clippy::too_many_arguments)]
fn build_tree_json(
    dir_path: &str,
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
    if let Some(md) = max_depth
        && depth >= md
    {
        return format!("{{\"type\":\"directory\",\"name\":\"{name}\",\"contents\":[]}}");
    }
    let mut names = fs.list_dir(dir_path).unwrap_or_default();
    names.sort();
    let mut items = Vec::new();
    for n in names {
        if !show_all && n.starts_with('.') {
            continue;
        }
        if let Some(ig) = ignore_pat
            && crate::shell::expand::glob_match(ig, &n)
        {
            continue;
        }
        let child = resolve_posix_path(dir_path, &n);
        let link_target = fs
            .readlink(&child)
            .ok()
            .filter(|t| !t.starts_with("__hardlink__:"));
        if fs.is_dir(&child) && link_target.is_none() {
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
            if let Some(mp) = match_pat
                && !crate::shell::expand::glob_match(mp, &n)
            {
                continue;
            }
            *file_count += 1;
            if let Some(lt) = link_target {
                items.push(format!(
                    "{{\"type\":\"link\",\"name\":\"{n}\",\"target\":\"{lt}\"}}"
                ));
            } else {
                items.push(format!("{{\"type\":\"file\",\"name\":\"{n}\"}}"));
            }
        }
    }
    format!(
        "{{\"type\":\"directory\",\"name\":\"{name}\",\"contents\":[{}]}}",
        items.join(",")
    )
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

fn cmd_tree(
    args: &[String],
    cwd: &str,
    env: &std::collections::BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut json_mode = false;
    let mut show_all = false;
    let mut dirs_only = false;
    let mut no_indent = false;
    let mut full_path = false;
    let mut max_depth: Option<usize> = None;
    let mut ignore_pat: Option<String> = None;
    let mut match_pat: Option<String> = None;
    let mut explicit_charset: Option<String> = None;
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
        } else if a == "--noreport" {
            i += 1;
        } else if let Some(cs) = a.strip_prefix("--charset=") {
            explicit_charset = Some(cs.to_string());
            i += 1;
        } else if a == "--charset" && i + 1 < args.len() {
            explicit_charset = Some(args[i + 1].clone());
            i += 2;
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
    let utf8 = detect_tree_utf8(explicit_charset.as_deref(), env);
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
        utf8: bool,
        ignore_pat: Option<&str>,
        match_pat: Option<&str>,
        fs: &dyn SafeBashFs,
        out: &mut String,
    ) {
        if let Some(md) = max_depth
            && depth >= md
        {
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
                if let Some(ig) = ignore_pat
                    && crate::shell::expand::glob_match(ig, n)
                {
                    return false;
                }
                let child = resolve_posix_path(dir_path, n);
                let is_link = fs
                    .readlink(&child)
                    .ok()
                    .filter(|t| !t.starts_with("__hardlink__:"))
                    .is_some();
                let is_d = fs.is_dir(&child) && !is_link;
                if dirs_only && !is_d {
                    return false;
                }
                if !is_d
                    && let Some(mp) = match_pat
                    && !crate::shell::expand::glob_match(mp, n)
                {
                    return false;
                }
                true
            })
            .collect();
        for (idx, n) in filtered.iter().enumerate() {
            let last = idx + 1 == filtered.len();
            let child = resolve_posix_path(dir_path, n);
            let base_disp = if full_path { child.as_str() } else { n.as_str() };
            let link_target = fs
                .readlink(&child)
                .ok()
                .filter(|t| !t.starts_with("__hardlink__:"));
            let disp = if let Some(ref lt) = link_target {
                format!("{base_disp} -> {lt}")
            } else {
                base_disp.to_string()
            };
            if no_indent {
                out.push_str(&format!("{disp}\n"));
            } else {
                let branch = if last {
                    if utf8 { "└── " } else { "\x60-- " }
                } else if utf8 {
                    "├── "
                } else {
                    "|-- "
                };
                out.push_str(&format!("{prefix}{branch}{disp}\n"));
            }
            if fs.is_dir(&child) && link_target.is_none() {
                let next_prefix = format!(
                    "{prefix}{}",
                    if last {
                        "    "
                    } else if utf8 {
                        "│   "
                    } else {
                        "|   "
                    }
                );
                render_tree_text(
                    &child,
                    &next_prefix,
                    depth + 1,
                    max_depth,
                    show_all,
                    dirs_only,
                    no_indent,
                    full_path,
                    utf8,
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
        utf8,
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
