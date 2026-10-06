use crate::shell::builtins::BuiltinOutcome;
use crate::vfs::{
    SafeBashFs, VfsEntryKind, basename_posix_path, normalize_posix_path, resolve_posix_path,
};

pub fn try_run_fs_command(
    cmd: &str,
    args: &[String],
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> Option<BuiltinOutcome> {
    match cmd {
        "ls" => Some(cmd_ls(args, cwd, fs)),
        "mkdir" => Some(cmd_mkdir(args, cwd, fs)),
        "rmdir" => Some(cmd_rmdir(args, cwd, fs)),
        "rm" => Some(cmd_rm(args, cwd, fs)),
        "cp" => Some(cmd_cp(args, cwd, fs)),
        "mv" => Some(cmd_mv(args, cwd, fs)),
        "touch" => Some(cmd_touch(args, cwd, fs)),
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

fn cmd_mkdir(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut stderr = String::new();
    let mut code = 0;
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-m" && i + 1 < args.len() {
            i += 2;
            continue;
        }
        if a.starts_with('-') {
            i += 1;
            continue;
        }
        let p = resolve_posix_path(cwd, a);
        if let Err(e) = fs.mkdir_all(&p) {
            stderr.push_str(&format!("mkdir: cannot create directory '{a}': {e}\n"));
            code = 1;
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
    let operands: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
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
    let operands: Vec<&String> = args.iter().filter(|a| !a.starts_with('-')).collect();
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

fn cmd_touch(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if matches!(a.as_str(), "-d" | "-t" | "-r") {
            i += 2;
            continue;
        }
        if a.starts_with('-') {
            i += 1;
            continue;
        }
        let p = resolve_posix_path(cwd, a);
        if !fs.exists(&p) {
            let _ = fs.write_file(&p, &[]);
        }
        i += 1;
    }
    ok_out("")
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

fn cmd_realpath(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut out = String::new();
    for a in args {
        if a.starts_with('-') {
            continue;
        }
        let p = resolve_posix_path(cwd, a);
        if let Ok(link_t) = fs.readlink(&p) {
            let parent = crate::vfs::dirname_posix_path(&p);
            out.push_str(&format!("{}\n", resolve_posix_path(&parent, &link_t)));
        } else {
            out.push_str(&format!("{p}\n"));
        }
    }
    ok_out(&out)
}

fn apply_chmod_recursive(path: &str, mode: u32, recursive: bool, fs: &dyn SafeBashFs) -> Result<(), String> {
    fs.chmod(path, mode)?;
    if recursive && fs.is_dir(path) {
        for name in fs.list_dir(path)? {
            let child = if path == "/" {
                format!("/{name}")
            } else {
                format!("{path}/{name}")
            };
            apply_chmod_recursive(&child, mode, true, fs)?;
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
    let mode = u32::from_str_radix(mode_str, 8).unwrap_or(0o755);
    let mut stderr = String::new();
    let mut code = 0;
    for t in &positional[1..] {
        let p = resolve_posix_path(cwd, t);
        if let Err(e) = apply_chmod_recursive(&p, mode, recursive, fs) {
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

fn dir_bytes(path: &str, fs: &dyn SafeBashFs) -> usize {
    if fs.is_dir(path) {
        let mut sum = 0usize;
        for name in fs.list_dir(path).unwrap_or_default() {
            let child = if path == "/" {
                format!("/{name}")
            } else {
                format!("{path}/{name}")
            };
            sum += dir_bytes(&child, fs);
        }
        sum
    } else {
        fs.read_file(path).map(|b| b.len()).unwrap_or(0)
    }
}

fn cmd_du(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut bytes_mode = false;
    let mut targets = Vec::new();
    for a in args {
        if a.contains('b') {
            bytes_mode = true;
        } else if !a.starts_with('-') {
            targets.push(a.clone());
        }
    }
    if targets.is_empty() {
        targets.push(".".to_string());
    }
    let mut out = String::new();
    for t in targets {
        let p = resolve_posix_path(cwd, &t);
        let b = dir_bytes(&p, fs);
        let val = if bytes_mode { b } else { b.div_ceil(1024).max(1) };
        out.push_str(&format!("{val}\t{t}\n"));
    }
    ok_out(&out)
}

fn cmd_df() -> BuiltinOutcome {
    ok_out("Filesystem     1K-blocks  Used Available Use% Mounted on\ntmpfs              65536     0     65536   0% /\n")
}

fn cmd_mktemp(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let is_dir = args.iter().any(|a| a == "-d");
    let path = normalize_posix_path(&format!("{cwd}/tmp.safebash001"));
    if is_dir {
        let _ = fs.mkdir_all(&path);
    } else {
        let _ = fs.write_file(&path, &[]);
    }
    ok_out(&format!("{path}\n"))
}

fn cmd_tree(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let target = args
        .iter()
        .find(|a| !a.starts_with('-'))
        .map(|s| s.as_str())
        .unwrap_or(".");
    let root = resolve_posix_path(cwd, target);
    let mut out = format!("{target}\n");
    if let Ok(mut names) = fs.list_dir(&root) {
        names.sort();
        for n in names {
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
            } else if data.is_empty() {
                if mime { "inode/x-empty" } else { "empty" }
            } else {
                if mime { "text/plain" } else { "ASCII text" }
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
