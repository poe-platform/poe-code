use super::*;

fn admit_rename(fs: &dyn SafeBashFs, path: &str) -> Result<(), String> {
    let mut candidate = path.to_owned();
    loop {
        match fs.access_path(&candidate, true) {
            Ok(entry) => {
                match fs.lstat(&entry) {
                    Ok(st)
                        if st.allocated_bytes == Some(0)
                            && st.filesystem_type.is_none()
                            && (st.mode & 0o170000 == 0o020000
                                || st.kind == VfsEntryKind::Directory) =>
                    {
                        return Err(format!("ENOTSUP: operation not supported, mv '{path}'"));
                    }
                    Err(e)
                        if entry.starts_with("/dev/")
                            && e.contains(", overlay '")
                            && e.starts_with("ENOENT:") =>
                    {
                        candidate = crate::vfs::dirname_posix_path(&entry);
                        continue;
                    }
                    _ => {}
                }
                return Ok(());
            }
            Err(e) if candidate != "/" && e.starts_with("ENOENT:") => {
                candidate = crate::vfs::dirname_posix_path(&candidate)
            }
            Err(e) if e.starts_with("ENOTDIR:") || e.starts_with("ELOOP:") => {
                if candidate != "/"
                    && fs
                        .inspect_command_entry(&candidate, false, "lstat")
                        .is_ok_and(|(_, st)| st.kind == VfsEntryKind::Symlink)
                {
                    candidate = crate::vfs::dirname_posix_path(&candidate);
                } else {
                    return Err(e);
                }
            }
            Err(e) => return Err(e),
        }
    }
}

pub(super) fn cmd_mv(
    args: &[String],
    stdin: CommandInput,
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
    let control = backup_control.as_deref().or_else(|| {
        (backup_flag || suffix_flag).then(|| {
            env.get("VERSION_CONTROL")
                .map(String::as_str)
                .unwrap_or("existing")
        })
    });
    let backup_mode = match parse_backup_control(control) {
        Ok(mode) => mode,
        Err(e) => return err_out(&format!("mv: {e}\n"), 2),
    };
    if backup_mode != BackupMode::None && no_clobber {
        return err_out(
            "mv: options --backup and --no-clobber are mutually exclusive\n",
            2,
        );
    }
    if target_dir.is_some() && no_target_dir {
        return err_out(
            "mv: cannot combine --target-directory and --no-target-directory\n",
            2,
        );
    }
    if no_target_dir && operands.len() > 2 {
        return err_out(&format!("mv: extra operand '{}'\n", operands[2]), 2);
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
    let absolute = |path: &str| {
        if path.starts_with('/') {
            path.to_owned()
        } else {
            child_disp_path(cwd, path)
        }
    };
    let dst_raw = eff_operands.last().unwrap();
    let dst_base = absolute(dst_raw);
    let dst_is_dir = if no_target_dir {
        false
    } else if target_dir.is_some() {
        match fs.inspect_command_entry(&dst_base, true, "stat") {
            Ok((_, st)) => st.kind == VfsEntryKind::Directory,
            Err(e) => return err_out(&format!("mv: {}\n", copy_error(&e, "stat", &dst_base)), 1),
        }
    } else {
        match fs.access_path(&dst_base, true).and_then(|p| fs.stat(&p)) {
            Ok(st) => {
                // An implicit destination uses the production memory entry lookup.
                // "." and ".." can resolve to directories without being listed entries.
                let name = dst_base
                    .trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .unwrap_or_default();
                st.kind == VfsEntryKind::Directory
                    && !(target_dir.is_none()
                        && matches!(name, "." | "..")
                        && fs.indexed_directory_entry(&dst_base) == Some(false))
            }
            Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => false,
            Err(e) if e.starts_with("ENOTDIR:") || e.starts_with("ELOOP:") => {
                if fs
                    .access_path(&dst_base, false)
                    .and_then(|p| fs.lstat(&p))
                    .is_ok_and(|st| st.kind == VfsEntryKind::Symlink)
                {
                    false
                } else {
                    let error = if e.starts_with("ELOOP:") {
                        "ELOOP: too many symbolic links encountered"
                    } else {
                        "ENOTDIR: not a directory"
                    };
                    return err_out(&format!("mv: {error}, lstat '{dst_base}'\n"), 1);
                }
            }
            Err(e) => {
                return err_out(
                    &format!(
                        "mv: {}, stat '{dst_base}'\n",
                        e.split_once(", ").map_or(e.as_str(), |(reason, _)| reason)
                    ),
                    1,
                );
            }
        }
    };
    if (target_dir.is_some() || eff_operands.len() > 2) && !dst_is_dir {
        return err_out(&format!("mv: ENOTDIR: not a directory '{dst_base}'\n"), 1);
    }
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut code = 0;
    let mut declined = false;
    let mut answers = PromptAnswers::new(stdin);

    let paths = |src_raw: &str| {
        let src = absolute(src_raw);
        let name = basename_posix_path(&src);
        let target = if dst_is_dir {
            child_disp_path(&dst_base, &name)
        } else {
            dst_base.clone()
        };
        (src, name, target)
    };
    let plain = fs.link_free_memory();
    let sources = &eff_operands[..eff_operands.len() - 1];
    let inspect = |path: &str| {
        fs.inspect_command_entry(path, false, "lstat")
            .map(|(_, st)| st)
            .map_err(|e| copy_error(&e, "lstat", path))
    };
    let maybe_stat = |path: &str| match inspect(path) {
        Ok(st) => Ok(Some(st)),
        Err(e) if e.starts_with("ENOENT:") => Ok(None),
        Err(e) => Err(e),
    };
    let should_skip = |src: &str, target: &str| -> Result<bool, String> {
        if !no_clobber && !update_only {
            return Ok(false);
        }
        let Some(to) = maybe_stat(target)? else {
            return Ok(false);
        };
        if no_clobber {
            return Ok(true);
        }
        let from = inspect(src)?;
        if from.kind == VfsEntryKind::Directory
            || to.kind == VfsEntryKind::Directory
            || from
                .mtime_ms
                .partial_cmp(&to.mtime_ms)
                .is_none_or(|o| o.is_gt())
        {
            return Ok(false);
        }
        if src == target || from.identity.is_some() && from.identity == to.identity {
            return Err(format!(
                "EINVAL: source and destination are the same file '{src}' -> '{target}'"
            ));
        }
        Ok(true)
    };
    let admit_pair = |src: &str, target: &str| -> Result<(), String> {
        if plain
            && [src, target]
                .iter()
                .all(|p| direct_memory_capabilities(fs, p))
        {
            return Ok(());
        }
        admit_rename(fs, src)?;
        admit_rename(fs, target)
    };
    for operand in sources {
        let (src, _, target) = paths(operand);
        let check = || -> Result<(), String> {
            if !should_skip(&src, &target)? {
                admit_pair(&src, &target)?;
                if no_clobber {
                    admit_rename(fs, &target)?;
                }
            }
            Ok(())
        };
        if let Err(e) = check()
            && (e.contains("Execution aborted:")
                || e.starts_with("ENOTSUP:")
                || e.starts_with("EROFS:"))
        {
            return err_out(&format!("mv: {e}\n"), 1);
        }
    }
    for src_raw in sources {
        let (src, name, target) = paths(src_raw);
        let disp_target = if dst_is_dir {
            child_disp_path(dst_raw, &name)
        } else {
            dst_raw.clone()
        };
        let mut run = || -> Result<(), String> {
            let mut backup = None;
            if should_skip(&src, &target)? {
                return Ok(());
            }
            if no_clobber {
                admit_rename(fs, &target)?;
            }
            let inspect_pair = || -> Result<_, String> {
                let source = inspect(&src)?;
                let Some(to) = maybe_stat(&target)? else {
                    return Ok(None);
                };
                if src == target || source.identity.is_some() && source.identity == to.identity {
                    return Err(format!(
                        "EINVAL: source and destination are the same file '{src}' -> '{target}'"
                    ));
                }
                Ok(Some((source, to)))
            };
            if interactive && inspect_pair()?.is_some() {
                stderr.push_str(&format!(
                    "mv: overwrite {}? ",
                    shell_quoted_operand(&disp_target)
                ));
                if !answers.yes(false)? {
                    declined = true;
                    return Ok(());
                }
            }
            if backup_mode != BackupMode::None
                && let Some((source_stat, target_stat)) = inspect_pair()?
            {
                if source_stat.identity.is_none() || target_stat.identity.is_none() {
                    return Err(format!(
                        "ENOTSUP: backup rename lacks authoritative distinctness '{src}' -> '{target}'"
                    ));
                }
                if (source_stat.kind == VfsEntryKind::Directory)
                    != (target_stat.kind == VfsEntryKind::Directory)
                {
                    let reason = if source_stat.kind == VfsEntryKind::Directory {
                        "ENOTDIR: not a directory"
                    } else {
                        "EISDIR: illegal operation on a directory"
                    };
                    return Err(format!("{reason} '{target}'"));
                }
                if backup_mode != BackupMode::Simple {
                    fs.command_descriptor_op()?;
                }
                let (bak, _) = backup_path(&target, backup_mode, &backup_suffix, fs)?;
                if bak == src || bak == target {
                    return Err(format!(
                        "EINVAL: backup would overwrite source or destination '{bak}'"
                    ));
                }
                if let Some(st) = maybe_stat(&bak)?
                    && (st.identity.is_none() || source_stat.identity == st.identity)
                {
                    return Err(format!("EINVAL: backup would overwrite source '{bak}'"));
                }
                admit_pair(&target, &bak)?;
                fs.rename(&target, &bak, false)
                    .map_err(|e| format!("{e}, rename '{target}' -> '{bak}'"))?;
                backup = Some(bak);
            }
            let result = match fs.rename(&src, &target, no_clobber) {
                Err(e) if !no_clobber && e.starts_with("EXDEV:") => {
                    fs.move_across_devices(&src, &target, None)
                }
                Err(e) if no_clobber && e.starts_with("EEXIST:") => return Ok(()),
                Err(e) if e.contains(", overlay '") => Err(e),
                Err(e) => Err(format!("{e}, rename '{src}' -> '{target}'")),
                ok => ok,
            };
            if let Err(e) = result {
                if let Some(bak) = backup {
                    fs.rename(&bak, &target, false)?;
                }
                return Err(e);
            }
            if verbose {
                stdout.push_str(&format!(
                    "renamed {} -> {}\n",
                    display_operand(src_raw),
                    display_operand(&disp_target)
                ));
            }
            Ok(())
        };
        if let Err(e) = run() {
            stderr.push_str(&format!("mv: {e}\n"));
            code = 1;
            if e.contains("Execution aborted:") {
                break;
            }
        }
    }
    BuiltinOutcome {
        stdout,
        stderr,
        exit_code: if declined { 1 } else { code },
    }
}
