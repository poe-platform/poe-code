use super::*;
use crate::vfs::dirname_posix_path;

pub(super) fn cmd_rm(args: &[String], stdin: CommandInput, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
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
    let stdout = String::new();
    let mut stderr = String::new();
    let mut answers = PromptAnswers::new(stdin);
    if interactive == "once" && (recursive || targets.len() > 3) {
        stderr.push_str(&format!(
            "rm: remove {} argument{}{}?",
            targets.len(),
            if targets.len() == 1 { "" } else { "s" },
            if recursive { " recursively" } else { "" }
        ));
        stderr.push(' ');
        let accepted = match answers.yes(true) {
            Ok(v) => v,
            Err(e) => { stderr.push_str(&format!("rm: {e}\n")); return BuiltinOutcome { stdout, stderr, exit_code: 1 }; }
        };
        if !accepted {
            return BuiltinOutcome {
                stdout,
                stderr,
                exit_code: 0,
            };
        }
    }

    let plain = fs.link_free_memory();
    let direct = interactive == "never" && plain;
    let mut rm = Remove { fs, cwd, plain, force, recursive, dir_mode, verbose,
        prompt: interactive == "always", answers, stdout, stderr };
    let single = targets.len() == 1 && !verbose && (recursive || !dir_mode);
    let mut code = 0;
    if !direct {
        for operand in &targets {
            let Ok(path) = command_operand(cwd,operand) else { continue; };
            if let Err(e) = rm.preflight(&path)
                && (e.starts_with("ENOTSUP:") || e.starts_with("EROFS:") || e.starts_with("ENOTEMPTY:") || e.contains("Execution aborted:")) {
                rm.stderr.push_str(&format!("rm: {e}\n"));
                return BuiltinOutcome { stdout: rm.stdout, stderr: rm.stderr, exit_code: 1 };
            }
        }
    }
    for operand in targets {
        let path = match command_operand(cwd,&operand) {
            Ok(p) => p, Err(e) => { rm.stderr.push_str(&format!("rm: {e}\n")); code = 1; continue; }
        };
        let result = if path == "/" || matches!(operand.trim_end_matches('/').rsplit('/').next(), Some("." | "..")) {
            Err(format!("EBUSY: refusing to remove root, '.' or '..' '{path}'"))
        } else if direct { rm.direct(&operand, &path, single) } else { rm.guarded(&operand, &path) };
        if let Err(e) = result {
            rm.stderr.push_str(&format!("rm: {e}\n"));
            code = 1;
            if e.contains("Execution aborted:") { break; }
        }
    }
    BuiltinOutcome { stdout: rm.stdout, stderr: rm.stderr, exit_code: code }
}

struct Remove<'a,'b> {
    fs: &'a dyn SafeBashFs, cwd: &'a str, plain: bool, force: bool, recursive: bool, dir_mode: bool,
    verbose: bool, prompt: bool, answers: PromptAnswers<'b>, stdout: String, stderr: String,
}

impl Remove<'_, '_> {
    fn inspect(&self, path: &str) -> Result<Option<FileStat>, String> {
        if self.plain && !path.ends_with('/') && self.fs.indexed_directory_entry(path) == Some(false) { return Ok(None); }
        match self.fs.inspect_command_entry(path, false, "lstat") {
            Ok((_, st)) => Ok(Some(st)),
            Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => Ok(None),
            Err(e) => Err(copy_error(&e,"lstat",path)),
        }
    }

    fn admit(&self, path: &str, directory: bool) -> Result<(), String> {
        let mut candidate = path.to_owned();
        if self.plain && path != "/dev" && !path.starts_with("/dev/") {
            let clean = normalize_posix_path(path);
            if direct_memory_capabilities(self.fs, path) { return Ok(()); }
            candidate = clean;
        }
        loop {
            match self.fs.inspect_command_entry(&candidate, true, "capabilitiesFor") {
                Ok((_, st)) => {
                    if st.mode & 0o170000 == 0o020000 || st.kind == VfsEntryKind::Directory
                        && matches!(st.identity,Some(EntryIdentity::Memory(..) | EntryIdentity::OverlayDirectory{..}))
                        && st.filesystem_type.is_none() {
                        if directory && st.uid.is_none() {
                            self.fs.command_descriptor_op()?;
                            self.fs.command_descriptor_op()?;
                            if !self.fs.list_dir(path)?.is_empty() { return Err(format!("ENOTEMPTY: directory not empty, rmdir '{path}'")); }
                        }
                        return Err(format!("ENOTSUP: operation not supported, {} '{path}'",if directory {"rmdir"} else {"rm"}));
                    }
                    return Ok(());
                }
                Err(e) if e.starts_with("ENOENT:") && candidate != "/" => candidate = dirname_posix_path(&candidate),
                Err(e) => return Err(if e.contains(", ") { e } else { copy_error(&e,"lstat",path) }),
            }
        }
    }

    fn preflight(&self, path: &str) -> Result<(),String> {
        if let Some(st) = self.inspect(path)? {
            let dir = st.kind == VfsEntryKind::Directory && !self.recursive;
            if dir { self.inspect(path)?; }
            self.admit(path, dir)?;
        }
        Ok(())
    }

    fn direct(&mut self, operand: &str, path: &str, single: bool) -> Result<bool,String> {
        if single && path != "/dev" && !path.starts_with("/dev/") && !operand.ends_with(['.','/']) {
            self.admit(path,false)?;
        }
        let dir = if self.dir_mode && !self.recursive {
            match self.inspect(path)? {
                None if self.force => return Ok(true),
                None => return Err(format!("ENOENT: no such file or directory '{path}'")),
                Some(st) => st.kind == VfsEntryKind::Directory,
            }
        } else { false };
        if (path == "/dev" || path.starts_with("/dev/")) && self.fs.lstat(path).is_ok_and(|s| s.allocated_bytes == Some(0)) {
            self.fs.command_descriptor_op()?;
            return Err(format!("EBUSY: resource busy or locked '{path}'"));
        }
        let result = if self.recursive { self.fs.command_descriptor_op().and_then(|_| self.fs.remove_path(path)) }
            else { self.fs.remove_one(path,dir) };
        if let Err(e) = result && !(self.force && e.starts_with("ENOENT:")) {
            return Err(copy_error(&e,if dir {"rmdir"} else {"rm"},path));
        }
        self.removed(operand);
        Ok(true)
    }

    fn removed(&mut self, operand: &str) {
        if self.verbose { self.stdout.push_str(&format!("removed {}\n",display_operand(operand))); }
    }

    fn guarded(&mut self, operand: &str, path: &str) -> Result<bool,String> {
        let Some(st) = self.inspect(path)? else {
            return if self.force { Ok(true) } else { Err(format!("ENOENT: no such file or directory '{path}'")) };
        };
        let dir = st.kind == VfsEntryKind::Directory;
        if dir && !self.recursive && !self.dir_mode { return Err(format!("EISDIR: illegal operation on a directory '{path}'")); }
        if self.prompt {
            if dir && self.recursive {
                self.fs.command_descriptor_op()?;
                let names = self.fs.list_dir(path).map_err(|e| copy_error(&e,"readdir",path))?;
                if !names.is_empty() {
                    self.stderr.push_str(&format!("rm: descend into directory {}? ",display_operand(operand)));
                    if !self.answers.yes(true)? { return Ok(false); }
                    let mut removed = true;
                    for name in names {
                        let child = child_disp_path(operand.trim_end_matches('/'),&name);
                        removed &= self.guarded(&child, &absolute_operand(self.cwd, &child))?;
                    }
                    if !removed { return Ok(false); }
                }
            }
            let kind = if dir { "directory" } else if st.kind == VfsEntryKind::Symlink { "symbolic link" }
                else if st.size == 0 { "regular empty file" } else { "regular file" };
            self.stderr.push_str(&format!("rm: remove {kind} {}? ",display_operand(operand)));
            if !self.answers.yes(true)? { return Ok(false); }
        }
        if dir && (!self.recursive || self.prompt) {
            self.inspect(path)?;
            self.admit(path,true)?;
            self.fs.remove_one(path,true).map_err(|e| copy_error(&e,"rmdir",path))?;
        } else {
            let parent = self.fs.access_path(&dirname_posix_path(path),true)?;
            let canonical = child_disp_path(&parent,&basename_posix_path(path));
            let current = if self.plain && canonical == path { st.clone() } else {
                self.inspect(&canonical)?.filter(|s| s.identity == st.identity && s.kind == st.kind)
                    .ok_or_else(|| format!("EAGAIN: resource temporarily unavailable, rm '{path}'"))?
            };
            let mut parent_stat = self.fs.inspect_command_entry("/",false,"lstat")?.1;
            for (end, _) in parent.match_indices('/').skip(1).chain((parent != "/").then_some((parent.len(),""))) {
                parent_stat = self.fs.inspect_command_entry(&parent[..end],false,"lstat")?.1;
            }
            let result = if current.kind == VfsEntryKind::File && current.revision.is_some() && matches!(current.identity,Some(EntryIdentity::Memory(_, _))) {
                self.fs.remove_unchanged_file(&canonical,&parent_stat,&current)
            } else if dir { self.fs.command_descriptor_op().and_then(|_| self.fs.remove_path(&canonical)) }
            else { self.fs.remove_one(&canonical,false) };
            result.map_err(|e| copy_error(&e,"rm",&canonical))?;
        }
        self.removed(operand);
        Ok(true)
    }
}
