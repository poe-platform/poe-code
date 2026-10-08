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

fn resolve_hardlink_root_path(
    path: &str,
    entries: &[crate::vfs::VfsFileEntry],
) -> String {
    let mut cur = normalize_posix_path(path);
    for _ in 0..16 {
        if let Some(entry) = entries.iter().find(|e| e.path == cur)
            && let Some(ref target) = entry.symlink_target
            && let Some(rest) = target.strip_prefix("__hardlink__:")
        {
            cur = normalize_posix_path(rest);
        } else {
            break;
        }
    }
    cur
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
            let entries = fs.export_entries().unwrap_or_default();
            let canon = resolve_hardlink_root_path(&target_full, &entries);
            format!("__hardlink__:{canon}")
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
    if raw != "/" && raw.ends_with('/') && mode != 'm' {
        if mode == 'e' {
            if !fs.exists(&cur) {
                return Err("No such file or directory".to_string());
            }
            if !fs.is_dir(&cur) {
                return Err("Not a directory".to_string());
            }
        } else if fs.exists(&cur) && !fs.is_dir(&cur) {
            return Err("Not a directory".to_string());
        }
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
                            return Err("No such file or directory".to_string());
                        }
                        if !fs.is_dir(&prefix) {
                            return Err("Not a directory".to_string());
                        }
                    } else if fs.exists(&prefix) && !fs.is_dir(&prefix) {
                        return Err("Not a directory".to_string());
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
                        return Err("No such file or directory".to_string());
                    }
                    if idx + 1 < comps.len() && fs.exists(&prefix) && !fs.is_dir(&prefix) {
                        return Err("Not a directory".to_string());
                    }
                }
            }
            if mode == 'e' && !fs.exists(&lexical) {
                return Err("No such file or directory".to_string());
            }
        }
        if no_symlinks {
            if mode != 'm' && mode != 'e' {
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
        Some(b) => match canonicalize_realpath_operand(&raw_for(b), mode, no_symlinks, logical, fs) {
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
        Some(t) => match canonicalize_realpath_operand(&raw_for(t), mode, no_symlinks, logical, fs) {
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
        let resolved = match canonicalize_realpath_operand(&raw, mode, no_symlinks, logical, fs) {
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
    let mut filesystem = false;
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
        } else if a == "--file-system" {
            filesystem = true;
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
                            filesystem = false;
                            is_printf = false;
                        } else {
                            filesystem = true;
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
        let st_res = if deref || filesystem { fs.stat(&p) } else { fs.lstat(&p) };
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
                let spec = fmt_spec.as_deref().unwrap_or(if filesystem {
                    "  File: %n\n  Type: %T"
                } else {
                    "  File: %N\n  Size: %s\tType: %F\n  Mode: %a (%A)\nAccess: %x\nModify: %y\nChange: %z\n Birth: %w"
                });

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
                        "T" if filesystem => "memory".to_string(),
                        "h" => {
                            numeric = true;
                            if st.kind == VfsEntryKind::Directory {
                                let subdirs = fs
                                    .list_dir(&p)
                                    .unwrap_or_default()
                                    .into_iter()
                                    .filter(|name| {
                                        let child = child_disp_path(&p, name);
                                        fs.lstat(&child)
                                            .map(|s| s.kind == VfsEntryKind::Directory)
                                            .unwrap_or(false)
                                    })
                                    .count();
                                (2 + subdirs).to_string()
                            } else {
                                let entries = fs.export_entries().unwrap_or_default();
                                let canon = resolve_hardlink_root_path(&p, &entries);
                                let hl_tag = format!("__hardlink__:{canon}");
                                let extra = entries
                                    .iter()
                                    .filter(|e| e.symlink_target.as_deref() == Some(hl_tag.as_str()))
                                    .count();
                                (1 + extra).to_string()
                            }
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

    let all_entries = fs.export_entries().unwrap_or_default();
    let mut seen_inodes: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();

    #[allow(clippy::too_many_arguments)]
    fn walk_du_node(
        disp: &str,
        full: &str,
        depth: usize,
        eff_depth: Option<usize>,
        all: bool,
        inodes: bool,
        separate: bool,
        count_links: bool,
        deref_mode: char,
        excludes: &[String],
        all_entries: &[crate::vfs::VfsFileEntry],
        seen_inodes: &mut std::collections::BTreeSet<String>,
        fs: &dyn SafeBashFs,
        emit_line: &dyn Fn(usize, &str, &mut String),
        out: &mut String,
    ) -> (usize, bool) {
        if du_matches_excludes(disp, excludes) || du_matches_excludes(full, excludes) {
            return (0, false);
        }
        let sym_target = fs
            .readlink(full)
            .ok()
            .filter(|t| !t.starts_with("__hardlink__:"));
        let is_symlink = sym_target.is_some();
        let follow = is_symlink && (deref_mode == 'L' || (deref_mode == 'H' && depth == 0));

        if is_symlink && !follow {
            let amt = if inodes {
                1usize
            } else {
                sym_target.map(|t| t.len()).unwrap_or(0)
            };
            if depth == 0 || (eff_depth.map(|md| depth <= md).unwrap_or(true) && all) {
                emit_line(amt, disp, out);
            }
            return (amt, false);
        }

        let is_dir = fs.is_dir(full);
        if !count_links && !is_dir {
            let phys = if follow {
                canonicalize_posix_path(full, 'e', false, fs)
                    .unwrap_or_else(|_| normalize_posix_path(full))
            } else {
                normalize_posix_path(full)
            };
            let canon_id = resolve_hardlink_root_path(&phys, all_entries);
            if !seen_inodes.insert(canon_id) {
                return (0, false);
            }
        }

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
                    count_links,
                    deref_mode,
                    excludes,
                    all_entries,
                    seen_inodes,
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
            count_links,
            deref_mode,
            &excludes,
            &all_entries,
            &mut seen_inodes,
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
            return ok_out("Usage: df [OPTION]... [FILE]...\n");
        }
        if !end_of_options && arg == "--version" {
            return ok_out("df (Sandbox VFS-ish/GNU coreutils) 9.7\n");
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
            let is_mount_target = mounts.iter().any(|m| m.target == resolved);
            if !is_mount_target && fs.lstat(&resolved).is_err() && !fs.exists(&resolved) {
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
            .get("__umask")
            .or_else(|| env.get("__SAFE_BASH_UMASK"))
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
        .ok()
        .filter(|t| !t.starts_with("__hardlink__:"));
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
                            String::new()
                        };
                        match flag {
                            'L' => max_depth = val.parse().ok(),
                            'P' => include_pats.push(val),
                            'I' => exclude_pats.push(val),
                            _ => {}
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
    if operands.is_empty() {
        operands.push(".".to_string());
    }
    let utf8 = detect_tree_utf8(explicit_charset.as_deref(), env);
    let nl = if indent { "\n" } else { "" };
    let pad1 = if indent { "  " } else { "" };
    let mut out = String::new();
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
    ok_out(&out)
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
    if bytes.len() >= 262 && &bytes[257..262] == b"ustar" {
        return ("POSIX tar archive".to_string(), "application/x-tar", "binary");
    }
    if bytes.starts_with(b"\x00asm") {
        return ("WebAssembly (wasm) binary module".to_string(), "application/wasm", "binary");
    }
    if bytes.starts_with(b"SQLite format 3\x00") {
        return ("SQLite 3.x database".to_string(), "application/vnd.sqlite3", "binary");
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
            .chunks_exact(2)
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
                    None => return err_out(&format!("file: option '{flag}' requires an argument\n"), 1),
                };
                if flag == "-F" || flag == "--separator" {
                    fmt.separator = val;
                } else {
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
                _ => {}
            }
        }
        i += 1;
    }

    let mut all_items: Vec<(String, FileFormatOpts)> = listed;
    for n in names {
        all_items.push((n, fmt.clone()));
    }
    if all_items.is_empty() {
        return err_out("file: missing file operand\n", 1);
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
                            let bytes = fs.read_file(&p).unwrap_or_default();
                            classify_file_bytes(&bytes)
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
