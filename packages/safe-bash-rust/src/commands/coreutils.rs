mod fmt_printable;
mod fmt_quote;
mod fold_widths;
mod sort_keys;
mod sort_locale;
mod sort_record;
mod sort_runs;
mod tac_regex;
use sort_record::Record as SortRecord;
use super::{CommandFailure, CommandInput};
use crate::vfs::path::absolute_operand;
use crate::shell::builtins::BuiltinOutcome;
use crate::vfs::{
    SafeBashFs, dirname_posix_path, resolve_posix_path, stream_string_to_bytes,
};
use std::collections::{BTreeMap, BTreeSet};

pub fn try_run_coreutil(
    cmd: &str,
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> Option<BuiltinOutcome> {
    try_run_coreutil_with_input(cmd, args, CommandInput { text: &mut stdin.to_owned(), file: None }, cwd, env, fs, &mut super::capture_write)
        .unwrap_or_else(|e| Some(e.diagnose("shell: line 1: ")))
}

pub(super) fn try_run_coreutil_with_input(
    cmd: &str, args: &[String], input: CommandInput, cwd: &str, env: &BTreeMap<String, String>, fs: &dyn SafeBashFs, write: &mut super::CommandWriter,
) -> Result<Option<BuiltinOutcome>, CommandFailure> {
    if cmd == "envsubst" {
        return cmd_envsubst(args, input, env).map(Some).map_err(|message| CommandFailure { output: ok_out(""), message });
    }
    if cmd == "date" { return cmd_date(args, input, cwd, env, fs).map(Some); }
    if let Some(info) = gnu_information_sync(cmd, args, env.contains_key("POSIXLY_CORRECT")) { return Ok(Some(info)); }
    if cmd == "shuf" { return Ok(Some(cmd_shuf(args, input, cwd, env, fs, write))); }
    if cmd == "dd" { return Ok(Some(cmd_dd(args, input, cwd, env, fs, write))); }
    if cmd == "cat" { return Ok(Some(cmd_cat(args, input, cwd, fs, write))); }
    if matches!(cmd, "less" | "more") { return Ok(Some(cmd_less_more(cmd, args, input, cwd, fs, write))); }
    if cmd == "expand" { return Ok(Some(cmd_expand(args, input, cwd, fs, write))); }
    if cmd == "unexpand" { return Ok(Some(cmd_unexpand(args, input, cwd, fs, write))); }
    if cmd == "rev" { return Ok(Some(cmd_rev(args, input, cwd, env, fs, write))); }
    if cmd == "fold" { return Ok(Some(cmd_fold(args, input, cwd, env, fs, write))); }
    if cmd == "pr" { return Ok(Some(cmd_pr(args, input, cwd, env, fs, write))); }
    if cmd == "nl" { return Ok(Some(cmd_nl(args, input, cwd, fs, write))); }
    if cmd == "tee" { return Ok(Some(cmd_tee(args, input, cwd, env, fs, write))); }
    if cmd == "tr" { return Ok(Some(cmd_tr(args, input, write))); }
    Ok(match coreutil(cmd, args, input, cwd, env, fs) {
        Ok(out) => out,
        Err(error) => Some(err_out(&format!("{cmd}: {error}\n"), 1)),
    })
}

fn coreutil(
    cmd: &str, args: &[String], input: CommandInput, cwd: &str, env: &BTreeMap<String, String>, fs: &dyn SafeBashFs,
) -> Result<Option<BuiltinOutcome>, String> {
    Ok(Some(match cmd {
        "wc" => cmd_wc(args, input, cwd, env, fs),
        "head" | "tail" => run_head_or_tail(cmd, args, input, cwd, fs),
        "sort" => cmd_sort(args, input, cwd, env, fs),
        "uniq" => cmd_uniq(args, input, cwd, env, fs),
        "cut" => cmd_cut(args, input, cwd, env, fs),
        "tac" => cmd_tac(args, input, cwd, fs),
        "paste" => cmd_paste(args, input, cwd, fs),
        "join" => cmd_join(args, input, cwd, fs),
        "comm" => cmd_comm(args, input, cwd, fs),
        "getopt" => cmd_getopt(args, env),
        "dos2unix" => cmd_dos2unix(args, input.buffered()?, cwd, fs, false),
        "unix2dos" => cmd_dos2unix(args, input.buffered()?, cwd, fs, true),
        "iconv" => cmd_iconv(args, input.buffered()?, cwd, env, fs),
        "sponge" => cmd_sponge(args, input.buffered()?, cwd, fs),
        "seq" => cmd_seq(args),
        "yes" => cmd_yes(args, env.contains_key("POSIXLY_CORRECT")),
        "basename" => cmd_basename(args),
        "dirname" => cmd_dirname(args),
        "env" | "printenv" => cmd_printenv(args, env),
        "cal" | "ncal" => cmd_cal(cmd, args, env),
        "getconf" => cmd_getconf(args, cwd, fs),
        "locale" => cmd_locale(args, env),
        "pathchk" => cmd_pathchk(args, cwd, fs),
        "expr" => cmd_expr(args, env),
        "bc" => cmd_bc(args, input.buffered()?, cwd, fs),
        "numfmt" => cmd_numfmt(args, input, env),
        "uname" => cmd_uname(args, env, fs),
        "whoami" => cmd_whoami(args, env, fs),
        "hostname" => cmd_hostname(args, cwd, env, fs),
        "nproc" => cmd_nproc(args, env),
        "id" => cmd_id(args, env, fs),
        "sleep" => cmd_sleep(args, env),
        "factor" => cmd_factor(args, input, env.contains_key("POSIXLY_CORRECT")),
        "tsort" => cmd_tsort(args, input.buffered()?, cwd, env, fs),
        "truncate" => cmd_truncate(args, cwd, env, fs),
        "fmt" => cmd_fmt(args, input, cwd, env, fs),
        "csplit" => cmd_csplit(args, input.buffered()?, cwd, fs),
        "column" => cmd_column(args, input.buffered()?, cwd, fs),
        "split" => cmd_split(args, input.buffered()?, cwd, env, fs),
        "install" => cmd_install(args, cwd, env, fs),
        _ => return Ok(None),
    }))
}

pub fn gnu_information_sync(
    name: &str,
    args: &[String],
    posixly_correct: bool,
) -> Option<BuiltinOutcome> {
    if !args.iter().any(|a| a == "--help" || a == "--version") {
        return None;
    }
    let (description, opts_raw, usage_raw, bit_flags): (&str, &str, &str, u8) = match name {
        "cat" => ("Concatenate input files.", "-n, --number|-b, --number-nonblank|-s, --squeeze-blank|-E, --show-ends|-T, --show-tabs|-v, --show-nonprinting|-A, --show-all", "", 4),
        "du" => ("Report virtual file allocation.", "-a, --all|-s, --summarize|-c, --total|-h, --human-readable|-B, --block-size=SIZE|-b, --bytes|--apparent-size|-d, --max-depth=NUM|-X, --exclude-from=FILE|--exclude=PATTERN|-t, --threshold=SIZE", "", 4),
        "base32" => ("Encode or decode Base32 data.", "-d, --decode|-i, --ignore-garbage|-w, --wrap=COLS", "[OPTION]... [FILE]", 0),
        "base64" => ("Encode or decode Base64 data.", "-d, --decode|-i, --ignore-garbage|-w, --wrap=COLS", "[OPTION]... [FILE]", 0),
        "basename" => ("Remove directory components and an optional suffix from names.", "-a, --multiple|-s, --suffix=SUFFIX|-z, --zero", "[OPTION]... NAME... [SUFFIX]", 1),
        "dirname" => ("Print the directory component of each name.", "-z, --zero", "[OPTION]... NAME...", 2),
        "chmod" => ("Change virtual file permissions, subject to filesystem capabilities.", "-R, --recursive|-v, --verbose|-c, --changes|-f, --silent, --quiet|--reference=FILE", "[OPTION]... MODE FILE...", 0),
        "cksum" => ("Compute checksums of files or standard input.", "-a, --algorithm=TYPE|-b, --binary|-z, --zero|--tag|--untagged|--raw|--base64", "", 0),
        "comm" => ("Compare sorted files in the C/POSIX byte locale.", "-1|-2|-3|--output-delimiter=STR|--check-order|--nocheck-order", "[OPTION]... FILE1 FILE2", 0),
        "cp" => ("Copy virtual files, subject to filesystem capabilities.", "-a, --archive|-r, -R, --recursive|-f, --force|-i, --interactive|-n, --no-clobber|-v, --verbose|-t, --target-directory=DIR|-T, --no-target-directory|-S, --suffix=SUFFIX", "[OPTION]... SOURCE... DEST", 0),
        "cut" => ("Select bytes, characters or fields from each input line.", "-b, --bytes=LIST|-c, --characters=LIST|-f, --fields=LIST|-d, --delimiter=CHAR|-s, --only-delimited|-z, --zero-terminated|--output-delimiter=STR|--complement", "", 0),
        "env" => ("Print the environment or run a registered command with a modified environment.", "-i, --ignore-environment|-u, --unset=NAME|-C, --chdir=DIR|-S, --split-string=STR|-0, --null", "[OPTION]... [NAME=VALUE]... [COMMAND [ARG]...]", 1),
        "expand" => ("Convert tabs to spaces.", "-i, --initial|-t, --tabs=LIST", "", 0),
        "fold" => ("Wrap input lines to a selected width.", "-b, --bytes|-s, --spaces|-w, --width=COLS", "", 0),
        "head" => ("Print the first ten lines by default, or a selected line/byte count.", "-n, --lines=NUM|-c, --bytes=NUM|-q, --quiet, --silent|-v, --verbose|-z, --zero-terminated", "", 0),
        "tail" => ("Print the last ten lines by default, or a selected line/byte count.", "-n, --lines=NUM|-c, --bytes=NUM|-q, --quiet, --silent|-v, --verbose|-z, --zero-terminated", "", 0),
        "join" => ("Join sorted files on a common field in the C/POSIX byte locale.", "-1=FIELD|-2=FIELD|-j=FIELD|-t=CHAR|-a=FILENUM|-v=FILENUM|-e=STR|-o=FORMAT|-i|--check-order|--nocheck-order", "[OPTION]... FILE1 FILE2", 0),
        "ln" => ("Create virtual hard or symbolic links when supported by the filesystem.", "-s, --symbolic|-r, --relative|-f, --force|-i, --interactive|-n, --no-dereference|-v, --verbose|-t, --target-directory=DIR|-T, --no-target-directory|-S, --suffix=SUFFIX", "[OPTION]... TARGET... LINK_NAME", 0),
        "ls" => ("List virtual directory entries.", "-a, --all|-A, --almost-all|-l|-1|-d, --directory|-F, --classify|-r, --reverse|-R, --recursive|-L, --dereference|-h, --human-readable", "", 0),
        "mkdir" => ("Create virtual directories.", "-p, --parents|-m, --mode=MODE|-v, --verbose", "[OPTION]... DIRECTORY...", 0),
        "mktemp" => ("Create a temporary virtual file or directory.", "-d, --directory|-q, --quiet|-u, --dry-run|-p=DIR|--tmpdir[=DIR]|--suffix=SUFFIX", "[OPTION]... [TEMPLATE]", 0),
        "mv" => ("Move virtual files, subject to filesystem capabilities.", "-f, --force|-i, --interactive|-n, --no-clobber|-u, --update|-v, --verbose|-t, --target-directory=DIR|-T, --no-target-directory|-S, --suffix=SUFFIX", "[OPTION]... SOURCE... DEST", 0),
        "nl" => ("Number input lines by section and numbering style.", "-b, --body-numbering=STYLE|-h, --header-numbering=STYLE|-f, --footer-numbering=STYLE|-v, --starting-line-number=NUM|-i, --line-increment=NUM|-s, --number-separator=STR|-w, --number-width=NUM|-n, --number-format=FORMAT|-d, --section-delimiter=STR|-l, --join-blank-lines=NUM|-p, --no-renumber", "", 0),
        "od" => ("Print input bytes in selected numeric formats.", "-A, --address-radix=RADIX|-j, --skip-bytes=NUM|-N, --read-bytes=NUM|-t, --format=TYPE, --type=TYPE|-w, --width=NUM|--endian=ORDER|-v, --output-duplicates", "", 0),
        "paste" => ("Merge corresponding or serial input lines.", "-s, --serial|-d, --delimiters=LIST|-z, --zero-terminated", "", 0),
        "readlink" => ("Print symbolic link targets or canonical virtual paths.", "-f, --canonicalize|-e, --canonicalize-existing|-m, --canonicalize-missing|-n, --no-newline|-z, --zero", "[OPTION]... FILE...", 0),
        "realpath" => ("Print canonical virtual paths.", "-e, --canonicalize-existing|-m, --canonicalize-missing|-s, --strip, --no-symlinks|-z, --zero", "[OPTION]... FILE...", 0),
        "rm" => ("Remove virtual files and directories.", "-r, -R, --recursive|-f, --force|-d, --dir|-v, --verbose|-i|-I", "[OPTION]... FILE...", 0),
        "rmdir" => ("Remove empty virtual directories.", "-p, --parents|-v, --verbose|--ignore-fail-on-non-empty", "[OPTION]... DIRECTORY...", 0),
        "seq" => ("Print a numeric sequence.", "-s, --separator=STR|-f, --format=FORMAT|-w, --equal-width", "[OPTION]... [FIRST [INCREMENT]] LAST", 0),
        "sort" => ("Sort input records using the supported byte-oriented ordering modes.", "-n, --numeric-sort|-g, --general-numeric-sort|-h, --human-numeric-sort|-V, --version-sort|-r, --reverse|-f, --ignore-case|-u, --unique|-s, --stable|-m, --merge|-k, --key=KEY|-t, --field-separator=CHAR|-o, --output=FILE|--sort=MODE|-z, --zero-terminated|-c, --check|-C, --check=quiet|-S, --buffer-size=SIZE|--batch-size=NUM|--max-input-bytes=NUM|--max-records=NUM", "", 0),
        "split" => ("Split input into virtual output files.", "-l, --lines=NUM|-b, --bytes=SIZE|-C, --line-bytes=SIZE|-a, --suffix-length=NUM|--additional-suffix=SUFFIX", "[OPTION]... [FILE [PREFIX]]", 0),
        "stat" => ("Display virtual file metadata supplied by the filesystem.", "-L, --dereference|-c, --format=FORMAT|--printf=FORMAT|-t, --terse", "[OPTION]... FILE...", 0),
        "tac" => ("Print input records in reverse order.", "-b, --before|-r, --regex|-s, --separator=STR", "", 0),
        "tee" => ("Copy standard input to standard output and virtual files.", "-a, --append|-i, --ignore-interrupts|--output-error=MODE", "", 0),
        "touch" => ("Update virtual file timestamps, creating missing files by default.", "-a|-m|-c, --no-create|-h, --no-dereference|-r, --reference=FILE|-d, --date=STR|-t=STAMP", "[OPTION]... FILE...", 0),
        "tr" => ("Translate, delete or squeeze input bytes.", "-d, --delete|-s, --squeeze-repeats|-c, -C, --complement|-t, --truncate-set1", "[OPTION]... STRING1 [STRING2]", 0),
        "unexpand" => ("Convert spaces to tabs.", "-a, --all|-t, --tabs=LIST|--first-only", "", 0),
        "uniq" => ("Filter adjacent repeated input records.", "-c, --count|-d, --repeated|-u, --unique|-i, --ignore-case|-f, --skip-fields=NUM|-s, --skip-chars=NUM|-w, --check-chars=NUM|-z, --zero-terminated", "[OPTION]... [INPUT [OUTPUT]]", 0),
        "wc" => ("Count input lines, words, bytes, characters or display width.", "-l, --lines|-w, --words|-c, --bytes|-m, --chars|-L, --max-line-length", "", 0),
        "md5sum" | "sha1sum" | "sha224sum" | "sha256sum" | "sha384sum" | "sha512sum" => (
            "Compute or verify file digests.",
            "-b, --binary|-c, --check|-t, --text|-z, --zero|--tag|--quiet|--status|--strict|--warn|--ignore-missing",
            "",
            0,
        ),
        _ => return None,
    };
    let usage = if usage_raw.is_empty() {
        "[OPTION]... [FILE]..."
    } else {
        usage_raw
    };
    let options: Vec<&str> = if opts_raw.is_empty() {
        Vec::new()
    } else {
        opts_raw.split('|').collect()
    };
    let mut flags: BTreeMap<String, &'static str> = BTreeMap::new();
    for option in &options {
        let takes_val = if option.contains("[=") {
            "optional"
        } else if option.contains('=') {
            "required"
        } else {
            "none"
        };
        for spelling in option.split(", ") {
            let key = spelling
                .split('=')
                .next()
                .unwrap_or("")
                .split('[')
                .next()
                .unwrap_or("");
            flags.insert(key.to_string(), takes_val);
        }
    }
    let mut idx = 0usize;
    while idx < args.len() {
        let arg = &args[idx];
        if arg == "--" {
            break;
        }
        if arg == "--help" || arg == "--version" {
            if arg == "--help" && (bit_flags & 4) != 0 {
                return None;
            }
            if arg == "--version" {
                return Some(ok_out(&format!("{name} (safe-bash virtual implementation)\n")));
            }
            let mut opt_lines = String::new();
            for option in &options {
                let formatted: Vec<String> = option
                    .split(", ")
                    .map(|sp| {
                        if sp.starts_with("--") {
                            sp.to_string()
                        } else {
                            sp.replace('=', " ")
                        }
                    })
                    .collect();
                opt_lines.push_str(&format!("  {}\n", formatted.join(", ")));
            }
            return Some(ok_out(&format!(
                "Usage: {name} {usage}\n{description}\n\nCommon supported options (additional behavior is documented in the package):\n{opt_lines}  --help     display this help and exit\n  --version  display implementation information and exit\n\nThis is the safe-bash virtual implementation; filesystem operations require backend capabilities.\n"
            )));
        }
        if !arg.starts_with('-') || arg == "-" {
            if (bit_flags & 1) != 0 || ((bit_flags & 2) != 0 && posixly_correct) {
                break;
            }
            idx += 1;
            continue;
        }
        if arg.starts_with("--") {
            let (spelling, has_eq) = match arg.split_once('=') {
                Some((s, _)) => (s, true),
                None => (arg.as_str(), false),
            };
            let Some(&mode) = flags.get(spelling) else {
                return None;
            };
            if mode == "required" && !has_eq {
                idx += 1;
            } else if mode == "none" && has_eq {
                return None;
            }
        } else {
            let chars: Vec<char> = arg[1..].chars().collect();
            for (offset, ch) in chars.iter().enumerate() {
                let spelling = format!("-{ch}");
                let Some(&mode) = flags.get(&spelling) else {
                    return None;
                };
                if mode == "required" {
                    if offset + 1 == chars.len() {
                        idx += 1;
                    }
                    break;
                }
            }
        }
        idx += 1;
    }
    None
}

fn ok_out(stdout: &str) -> BuiltinOutcome {
    BuiltinOutcome {
        stdout: stdout.to_string(),
        stderr: String::new(),
        exit_code: 0,
    }
}

fn err_out(stderr: &str, code: i32) -> BuiltinOutcome {
    BuiltinOutcome {
        stdout: String::new(),
        stderr: stderr.to_string(),
        exit_code: code,
    }
}

pub fn read_inputs_or_stdin(
    files: &[String],
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
    cmd_name: &str,
) -> Result<String, BuiltinOutcome> {
    if files.is_empty() || (files.len() == 1 && files[0] == "-") {
        return Ok(stdin.to_string());
    }
    let mut combined = String::new();
    let mut err_buf = String::new();
    let mut code = 0;
    for f in files {
        if f == "-" {
            combined.push_str(stdin);
            continue;
        }
        let path = resolve_posix_path(cwd, f);
        match fs.read_file(&path) {
            Ok(bytes) => combined.push_str(&crate::vfs::bytes_to_stream_string(&bytes)),
            Err(e) => {
                err_buf.push_str(&format!("{cmd_name}: {f}: {e}\n"));
                code = 1;
            }
        }
    }
    if code != 0 && combined.is_empty() {
        return Err(BuiltinOutcome {
            stdout: String::new(),
            stderr: err_buf,
            exit_code: code,
        });
    }
    Ok(combined)
}

fn take_stdin_bytes(stdin: &mut String) -> Vec<u8> {
    let bytes = stream_string_to_bytes(stdin);
    stdin.clear();
    bytes
}

pub(super) fn stream_file_error(error: String, op: &str, path: &str) -> String {
    let (reason, location) = error.split_once(", ").unwrap_or((&error, ""));
    if path.is_empty() {
        "ENOENT: no such file or directory ''".to_owned()
    } else if location.starts_with("capabilitiesFor '") || location.starts_with("overlay '")
        || location.starts_with("realpath '") || reason.starts_with("EACCES:") && location.starts_with("lstat '") {
        error
    } else if reason.starts_with("ELOOP:") {
        format!("ELOOP: too many symbolic links encountered '{path}'")
    } else {
        let reason = if reason.starts_with("ENOENT:") || error.ends_with("(os error 2)") { "ENOENT: no such file or directory" }
            else if reason.starts_with("EIO:") { "EIO: input/output error" }
            else { reason };
        format!("{reason}, {op} '{path}'")
    }
}

fn resolve_record_output(fs: &dyn SafeBashFs, path: &str) -> Result<String, String> {
    let entry = fs.access_path(path, true).map_err(|e| {
        let op = if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") { "writeStream" } else { "access" };
        stream_file_error(e, op, path)
    })?;
    match fs.lstat(&entry) {
        Ok(st) if st.mode & 0o200 == 0 => Err(format!("EACCES: permission denied, access '{path}'")),
        Ok(st) if st.kind == crate::vfs::VfsEntryKind::Directory => {
            let op = if entry == "/" { "" } else { ", writeStream" };
            Err(format!("EISDIR: illegal operation on a directory{op} '{path}'"))
        }
        Ok(_) => Ok(entry),
        Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => {
            let parent = fs.stat(&dirname_posix_path(&entry)).map_err(|e| stream_file_error(e, "writeStream", path))?;
            if parent.mode & 0o200 == 0 { Err(format!("EACCES: permission denied, writeStream '{path}'")) } else { Ok(entry) }
        }
        Err(e) => Err(stream_file_error(e, "access", path)),
    }
}

fn record_input_path(name: &str, cwd: &str, fs: &dyn SafeBashFs, stat_first: bool) -> Result<(String, String), String> {
    let path = absolute_operand(cwd, name);
    let (lookup, diagnostic) = if stat_first { ("stat", "stat") } else { ("capabilitiesFor", "readStream") };
    let (entry, stat) = fs.inspect_command_entry(&path, true, lookup)
        .map_err(|e| stream_file_error(e, diagnostic, &path))?;
    if stat.kind == crate::vfs::VfsEntryKind::Directory {
        let operation = if stat_first { "" } else { ", readStream" };
        return Err(format!("EISDIR: illegal operation on a directory{operation} '{path}'"));
    }
    Ok((path, entry))
}

pub(super) fn open_record_input<'a>(name: &str, cwd: &str, fs: &'a dyn SafeBashFs, stat_first: bool) -> Result<crate::vfs::ChunkReader<'a>, String> {
    let (path, entry) = record_input_path(name, cwd, fs, stat_first)?;
    record_chunks(fs, &entry, path)
}

pub(super) fn record_chunks<'a>(fs: &'a dyn SafeBashFs, entry: &str, path: String) -> Result<crate::vfs::ChunkReader<'a>, String> {
    let limit = fs.max_input_bytes();
    let mut available = limit;
    let mut next = fs.open_chunks(entry).map_err(|e| stream_file_error(e, "readStream", &path))?;
    Ok(Box::new(move |chunk| {
        next(chunk).map_err(|e| stream_file_error(e, "readStream", &path))?;
        available = available.checked_sub(chunk.len()).ok_or_else(|| stream_file_error(fs.limit_error("maxInputBytes", limit), "readStream", &path))?;
        Ok(())
    }))
}

fn visit_complete_records(chunk: &[u8], delimiter: impl Fn(u8) -> bool, pending: &mut Vec<u8>, mut emit: impl FnMut(&[u8]) -> bool) -> bool {
    for part in chunk.split_inclusive(|&b| delimiter(b)) {
        if let Some((&last, record)) = part.split_last() && delimiter(last) {
            let more = if pending.is_empty() { emit(record) } else {
                pending.extend_from_slice(record);
                let more = emit(pending);
                pending.clear();
                more
            };
            if !more { return false; }
        } else {
            pending.extend_from_slice(part);
        }
    }
    true
}

impl CommandInput<'_> {
    pub(super) fn next_stdin_chunk(&mut self, chunk: &mut Vec<u8>) -> Result<(), String> {
        chunk.clear();
        if let Some(source) = self.file {
            source.read(self.text, 65536, |bytes, _| { chunk.extend_from_slice(bytes); Ok((false, bytes.len())) })
        } else { *chunk = take_stdin_bytes(self.text); Ok(()) }
    }

    pub(super) fn read_stdin(&mut self, mut consume: impl FnMut(&[u8]) -> bool) -> Result<(), String> {
        if let Some(source) = self.file {
            source.read(self.text, usize::MAX, |chunk, _| Ok((consume(chunk), chunk.len())))
        } else {
            consume(&take_stdin_bytes(self.text));
            Ok(())
        }
    }

    pub(super) fn read_stdin_records(&mut self, delimiter: impl Fn(u8) -> bool, mut emit: impl FnMut(&[u8]) -> bool) -> Result<(), String> {
        let mut pending = Vec::new();
        let mut more = true;
        self.read_stdin(|chunk| {
            more = visit_complete_records(chunk, &delimiter, &mut pending, &mut emit);
            more
        })?;
        if more && !pending.is_empty() { emit(&pending); }
        Ok(())
    }

    pub(super) fn read_operand(&mut self, name: &str, cwd: &str, fs: &dyn SafeBashFs, stat_first: bool,
        mut consume: impl FnMut(&[u8]) -> bool,
    ) -> Result<(), String> {
        if name == "-" { return self.read_stdin(consume); }
        let mut next = open_record_input(name, cwd, fs, stat_first)?;
        let mut chunk = Vec::new();
        loop {
            next(&mut chunk)?;
            if chunk.is_empty() || !consume(&chunk) { return Ok(()); }
        }
    }

    fn read_records(&mut self, name: &str, cwd: &str, fs: &dyn SafeBashFs, stat_first: bool, delimiter: u8,
        mut emit: impl FnMut(&[u8]) -> Result<(), String>,
    ) -> Result<(), String> {
        let mut pending = Vec::new();
        let mut result = Ok(());
        self.read_operand(name, cwd, fs, stat_first, |chunk| {
            visit_complete_records(chunk, |b| b == delimiter, &mut pending, |record| {
                result = emit(record);
                result.is_ok()
            })
        })?;
        result?;
        if !pending.is_empty() { emit(&pending)?; }
        Ok(())
    }

    pub(super) fn append_bytes(&mut self, output: &mut Vec<u8>) -> Result<(), String> {
        self.read_stdin(|chunk| { output.extend_from_slice(chunk); true })
    }
}

fn cmd_cat(args: &[String], mut stdin: CommandInput, cwd: &str, fs: &dyn SafeBashFs, write: &mut super::CommandWriter) -> BuiltinOutcome {
    let mut flag_n = false;
    let mut flag_b = false;
    let mut flag_s = false;
    let mut flag_e_ends = false;
    let mut flag_t_tabs = false;
    let mut flag_v = false;
    let mut flag_help = false;
    let mut files = Vec::new();
    let mut opts_done = false;

    for arg in args {
        if !opts_done && arg == "--" {
            opts_done = true;
            continue;
        }
        if !opts_done && arg == "--help" {
            flag_help = true;
            continue;
        }
        if !opts_done && arg.starts_with("--") {
            match arg.as_str() {
                "--number" => flag_n = true,
                "--number-nonblank" => flag_b = true,
                "--squeeze-blank" => flag_s = true,
                "--show-ends" => flag_e_ends = true,
                "--show-tabs" => flag_t_tabs = true,
                "--show-nonprinting" => flag_v = true,
                "--show-all" => {
                    flag_v = true;
                    flag_e_ends = true;
                    flag_t_tabs = true;
                }
                _ => return err_out(&format!("cat: unrecognized option '{arg}'\n"), 2),
            }
            continue;
        }
        if !opts_done && arg.starts_with('-') && arg.len() > 1 {
            for ch in arg[1..].chars() {
                match ch {
                    'n' => flag_n = true,
                    'b' => flag_b = true,
                    's' => flag_s = true,
                    'E' => flag_e_ends = true,
                    'T' => flag_t_tabs = true,
                    'v' => flag_v = true,
                    'e' => {
                        flag_v = true;
                        flag_e_ends = true;
                    }
                    't' => {
                        flag_v = true;
                        flag_t_tabs = true;
                    }
                    'A' => {
                        flag_v = true;
                        flag_e_ends = true;
                        flag_t_tabs = true;
                    }
                    'u' => {}
                    _ => return err_out(&format!("cat: invalid option -- '{ch}'\n"), 2),
                }
            }
        } else {
            files.push(arg.clone());
        }
    }

    if flag_help {
        return ok_out(
            "Usage: cat [OPTION]... [FILE]...\nConcatenate FILEs to standard output. With no FILE, or FILE -, read standard input.\n\n  -n, --number             Number all output lines\n  -b, --number-nonblank    Number nonempty output lines (overrides -n)\n  -s, --squeeze-blank      Suppress repeated empty output lines\n  -E, --show-ends          Display $ at each line end\n  -T, --show-tabs          Display TAB characters as ^I\n  -v, --show-nonprinting   Display nonprinting characters\n  -A, --show-all           Equivalent to -vET\n  -e                      Equivalent to -vE\n  -t                      Equivalent to -vT\n  -u                      Accepted for compatibility; ignored\n      --help              Display this help and exit\n      --                  End options; remaining arguments are filenames\n",
        );
    }

    let plain = !(flag_n || flag_b || flag_s || flag_e_ends || flag_t_tabs || flag_v);
    let mut out = ok_out("");
    let show_ends_only_cr = flag_e_ends && !flag_v;
    let mut line_start = true;
    let mut blank_count = 0usize;
    let mut number = 1usize;
    let mut pending_cr = false;
    let mut out_bytes = Vec::new();
    if files.is_empty() { files.push("-".into()); }
    let path_caps = |p: &str| fs.has_path_capabilities() || p == "/dev" || p.starts_with("/dev/");
    // The command checks every named operand before it starts reading stdin or files.
    let check_all = files.iter().any(|f| f != "-" && path_caps(&absolute_operand(cwd, f)));
    if check_all {
        for f in &files {
            if f != "-" && !f.is_empty() && fs.command_descriptor_op().is_err() { return out; }
        }
    }
    for f in &files {
        let mut writable = true;
        let mut consume = |chunk: &[u8]| {
            if plain {
                writable = write(1, &crate::vfs::bytes_to_stream_string(chunk), &mut out);
                return writable;
            }
            for &byte in chunk {
                if pending_cr {
                    pending_cr = false;
                    if byte == 10 {
                        out_bytes.extend_from_slice(b"^M");
                    } else {
                        out_bytes.push(13);
                    }
                }
                if line_start && byte == 10 && flag_s && blank_count > 0 {
                    continue;
                }
                if line_start && (if flag_b { byte != 10 } else { flag_n }) {
                    out_bytes.extend_from_slice(format!("{number:>6}\t").as_bytes());
                    number += 1;
                }
                if byte == 10 {
                    if flag_e_ends {
                        out_bytes.push(b'$');
                    }
                    out_bytes.push(10);
                    blank_count = if line_start { blank_count + 1 } else { 0 };
                    line_start = true;
                } else {
                    line_start = false;
                    blank_count = 0;
                    if byte == 13 && show_ends_only_cr {
                        pending_cr = true;
                    } else if byte == 9 {
                        if flag_t_tabs {
                            out_bytes.extend_from_slice(b"^I");
                        } else {
                            out_bytes.push(9);
                        }
                    } else if flag_v {
                        let mut visible = byte;
                        if visible >= 128 {
                            out_bytes.extend_from_slice(b"M-");
                            visible -= 128;
                        }
                        if visible < 32 {
                            out_bytes.push(b'^');
                            out_bytes.push(visible + 64);
                        } else if visible == 127 {
                            out_bytes.extend_from_slice(b"^?");
                        } else {
                            out_bytes.push(visible);
                        }
                    } else {
                        out_bytes.push(byte);
                    }
                }
                if out_bytes.len() >= 8192 {
                    writable = write(1, &crate::vfs::bytes_to_stream_string(&out_bytes), &mut out);
                    out_bytes.clear();
                    if !writable { return false; }
                }
            }
            if !out_bytes.is_empty() {
                writable = write(1, &crate::vfs::bytes_to_stream_string(&out_bytes), &mut out);
                out_bytes.clear();
            }
            writable
        };
        let result = if f == "-" {
            stdin.read_stdin(consume)
        } else {
            let p = absolute_operand(cwd, f);
            (|| {
                if p.is_empty() { return Err("ENOENT: no such file or directory".into()); }
                let mut available = fs.max_input_bytes();
                let mut read = |bytes: &[u8]| {
                    available = available.checked_sub(bytes.len())
                        .ok_or_else(|| fs.limit_error("maxInputBytes", fs.max_input_bytes()))?;
                    Ok(consume(bytes))
                };
                if !path_caps(&p) && fs.supplies_single_chunk_input() {
                    return fs.read_chunks(&p, &mut read);
                }
                // The input adapter checks requirements and then resolves the read capability.
                let admitted = path_caps(&p) && fs.access_path(&p, true).is_ok();
                let (path, st) = fs.inspect_command_entry(&p, true, "capabilitiesFor").inspect_err(|_| {
                    // An absent final entry still gets as far as opening the read stream.
                    if admitted { let _ = fs.command_descriptor_op(); }
                })?;
                if st.mode & 0o170000 != 0o100000 {
                    return fs.read_chunks(&path, &mut read);
                }
                // Named regular files end at the size seen on open, even if stdout appends to them.
                let mut left = st.size;
                fs.read_chunks(&path, &mut |chunk| {
                    let n = left.min(chunk.len());
                    left -= n;
                    Ok(read(&chunk[..n])? && left != 0)
                })
            })().map_err(|e| stream_file_error(e, "readStream", &p))
        };
        if !writable { return out; }
        if let Err(e) = result {
            out.exit_code = 1;
            if !write(2, &format!("cat: {e}\n"), &mut out) { return out; }
        }
    }
    if pending_cr { write(1, "\r", &mut out); }
    out
}

fn head_tail_normalize_args(name: &str, arguments: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut ended = false;
    let mut idx = 0usize;
    while idx < arguments.len() {
        let argument = &arguments[idx];
        if argument == "--" {
            ended = true;
        }
        let bytes = argument.as_bytes();
        let mut offset = 1usize;
        while offset < bytes.len() && bytes[offset].is_ascii_digit() {
            offset += 1;
        }
        if !ended
            && !bytes.is_empty()
            && (bytes[0] == b'-' || (name == "tail" && idx == 0 && bytes[0] == b'+'))
            && offset > 1
        {
            let remainder = &argument[offset..];
            let mut unit_flag = "-n";
            let mut unit_suffix = "";
            let mut rest = remainder;
            if let Some(r) = rest.strip_prefix('c') {
                unit_flag = "-c";
                rest = r;
            } else if let Some(r) = rest.strip_prefix('b') {
                unit_flag = "-c";
                unit_suffix = "b";
                rest = r;
            } else if let Some(r) = rest.strip_prefix('k') {
                unit_flag = "-c";
                unit_suffix = "K";
                rest = r;
            } else if let Some(r) = rest.strip_prefix('m') {
                unit_flag = "-c";
                unit_suffix = "M";
                rest = r;
            } else if let Some(r) = rest.strip_prefix('l') {
                unit_flag = "-n";
                rest = r;
            }
            let allowed = if name == "tail" { "qvzfF" } else { "qvz" };
            if rest.chars().all(|ch| allowed.contains(ch)) {
                let sign = if bytes[0] == b'+' { "+" } else { "" };
                out.push(unit_flag.to_string());
                out.push(format!("{sign}{}{unit_suffix}", &argument[1..offset]));
                for ch in rest.chars() {
                    out.push(format!("-{ch}"));
                }
                idx += 1;
                continue;
            }
        }
        out.push(argument.clone());
        if !ended
            && (matches!(
                argument.as_str(),
                "--lines" | "--bytes" | "--max-idle" | "--sleep-interval" | "--max-unchanged-stats"
            ) || (argument.starts_with('-')
                && !argument.starts_with("--")
                && (argument.ends_with('n') || argument.ends_with('c') || argument.ends_with('s'))))
            && idx + 1 < arguments.len()
        {
            idx += 1;
            out.push(arguments[idx].clone());
        }
        idx += 1;
    }
    out
}

fn head_tail_count(amount: &str) -> Result<u64, String> {
    let text = amount.strip_prefix(['+', '-']).unwrap_or(amount);
    let bytes = text.as_bytes();
    let mut offset = 0usize;
    while offset < bytes.len() && bytes[offset].is_ascii_digit() {
        offset += 1;
    }
    let suffix = &text[offset..];
    let multiplier: u128 = if suffix.is_empty() {
        1
    } else if suffix == "b" {
        512
    } else {
        let first_ch = suffix.chars().next().unwrap();
        let norm_ch = if first_ch == 'k' { 'K' } else { first_ch };
        let Some(pos) = "KMGTPEZYRQ".find(norm_ch) else {
            return Err(format!("invalid number '{amount}'"));
        };
        let power = (pos + 1) as u32;
        let ending = &suffix[first_ch.len_utf8()..];
        if !matches!(ending, "" | "B" | "iB") {
            return Err(format!("invalid number '{amount}'"));
        }
        let base: u128 = if ending == "B" { 1000 } else { 1024 };
        base.saturating_pow(power)
    };
    if offset == 0 && suffix.is_empty() {
        return Err(format!("invalid number '{amount}'"));
    }
    let count_base: u128 = if offset > 0 {
        text[..offset]
            .parse::<u128>()
            .map_err(|_| format!("invalid number '{amount}'"))?
    } else {
        1
    };
    let total = count_base.saturating_mul(multiplier);
    if total > (1u128 << 53) - 1 {
        return Err(format!("invalid number '{amount}'"));
    }
    Ok(total as u64)
}

fn prefix_len(chunk: &[u8], remaining: &mut u64, bytes: bool, delimiter: u8) -> usize {
    if *remaining == 0 { return 0; }
    if bytes {
        let n = (chunk.len() as u64).min(*remaining);
        *remaining -= n;
        return n as usize;
    }
    for (i, &b) in chunk.iter().enumerate() {
        if b == delimiter {
            *remaining -= 1;
            if *remaining == 0 { return i + 1; }
        }
    }
    chunk.len()
}

fn run_head_or_tail(
    name: &str,
    raw_args: &[String],
    stdin: CommandInput,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let norm = head_tail_normalize_args(name, raw_args);
    let mut last_mode = 'n';
    let mut last_n = "10".to_string();
    let mut last_c = "10".to_string();
    let mut last_header: Option<char> = None;
    let mut zero_terminated = false;
    let mut files = Vec::new();
    let mut ended = false;
    let mut i = 0usize;

    while i < norm.len() {
        let a = &norm[i];
        if !ended && a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if ended || a == "-" || !a.starts_with('-') {
            files.push(a.clone());
            i += 1;
            continue;
        }
        if let Some(val) = a.strip_prefix("--lines=") {
            last_mode = 'n';
            last_n = val.to_string();
            i += 1;
            continue;
        }
        if a == "--lines" {
            if i + 1 >= norm.len() {
                return err_out(&format!("{name}: option '--lines' requires an argument\n"), 2);
            }
            last_mode = 'n';
            last_n = norm[i + 1].clone();
            i += 2;
            continue;
        }
        if let Some(val) = a.strip_prefix("--bytes=") {
            last_mode = 'c';
            last_c = val.to_string();
            i += 1;
            continue;
        }
        if a == "--bytes" {
            if i + 1 >= norm.len() {
                return err_out(&format!("{name}: option '--bytes' requires an argument\n"), 2);
            }
            last_mode = 'c';
            last_c = norm[i + 1].clone();
            i += 2;
            continue;
        }
        if a == "--quiet" || a == "--silent" {
            last_header = Some('q');
            i += 1;
            continue;
        }
        if a == "--verbose" {
            last_header = Some('v');
            i += 1;
            continue;
        }
        if a == "--zero-terminated" {
            zero_terminated = true;
            i += 1;
            continue;
        }
        if name == "tail"
            && (a == "--retry"
                || a == "--follow"
                || a.starts_with("--follow=")
                || a.starts_with("--sleep-interval=")
                || a.starts_with("--max-unchanged-stats=")
                || a.starts_with("--max-idle="))
        {
            i += 1;
            continue;
        }
        if name == "tail"
            && matches!(a.as_str(), "--sleep-interval" | "--max-unchanged-stats" | "--max-idle")
        {
            i += 2;
            continue;
        }
        if a.starts_with("--") {
            return err_out(&format!("{name}: unrecognized option '{a}'\n"), 2);
        }
        let chars: Vec<char> = a[1..].chars().collect();
        let mut ci = 0usize;
        while ci < chars.len() {
            let ch = chars[ci];
            match ch {
                'q' => last_header = Some('q'),
                'v' => last_header = Some('v'),
                'z' => zero_terminated = true,
                'f' | 'F' if name == "tail" => {}
                's' if name == "tail" => {
                    if ci + 1 >= chars.len() {
                        i += 1;
                    }
                    break;
                }
                'n' | 'c' => {
                    let val = if ci + 1 < chars.len() {
                        chars[ci + 1..].iter().collect::<String>()
                    } else if i + 1 < norm.len() {
                        i += 1;
                        norm[i].clone()
                    } else {
                        return err_out(&format!("{name}: option requires an argument -- '{ch}'\n"), 2);
                    };
                    last_mode = ch;
                    if ch == 'n' {
                        last_n = val;
                    } else {
                        last_c = val;
                    }
                    break;
                }
                _ => return err_out(&format!("{name}: invalid option -- '{ch}'\n"), 2),
            }
            ci += 1;
        }
        i += 1;
    }

    let bytes_mode = last_mode == 'c';
    let delimiter: u8 = if zero_terminated { 0 } else { 10 };
    let amount = if bytes_mode { &last_c } else { &last_n };
    let positive = amount.starts_with('+');
    let negative = amount.starts_with('-');
    let count = match head_tail_count(amount) {
        Ok(c) => c,
        Err(msg) => return err_out(&format!("{name}: {msg}\n"), 2),
    };
    let names = if files.is_empty() {
        vec!["-".to_string()]
    } else {
        files
    };
    let show_headers = last_header == Some('v') || (last_header != Some('q') && names.len() > 1);

    let mut out_bytes: Vec<u8> = Vec::new();
    let mut stderr = String::new();
    let mut exit_code = 0;
    let mut header_written = false;

    let mut input = None;
    let mut consumed = 0;
    for file in &names {
        let path = if file == "-" { None } else {
            let p = absolute_operand(cwd, file);
            let inspected = fs.inspect_command_entry(&p, true, "capabilitiesFor")
                .map_err(|error| stream_file_error(error, "stat", &p))
                .and_then(|(resolved, st)| {
                    if st.kind == crate::vfs::VfsEntryKind::Directory {
                        Err(format!("EISDIR: illegal operation on a directory '{p}'"))
                    } else if st.mode & 0o400 == 0 {
                        Err(format!("EACCES: permission denied, access '{p}'"))
                    } else {
                        Ok(resolved)
                    }
                });
            match inspected {
                Ok(resolved) => Some(resolved),
                Err(error) => {
                    stderr.push_str(&format!("{name}: {error}\n"));
                    exit_code = 1;
                    continue;
                }
            }
        };

        if show_headers {
            let prefix = if header_written { "\n" } else { "" };
            let label = if file == "-" { "standard input" } else { file.as_str() };
            out_bytes.extend_from_slice(format!("{prefix}==> {label} <==\n").as_bytes());
            header_written = true;
        }

        let skip = name == "tail" && positive;
        let prefix = (name == "head" && !negative) || skip;
        let mut remaining = if skip { count.saturating_sub(1) } else { count };
        if prefix && remaining == 0 && !skip { continue; }
        let limits = fs.shell_limits();
        let mut write = |bytes: &[u8]| {
            if out_bytes.len().saturating_add(bytes.len()) > limits.max_output_bytes {
                return Err(fs.limit_error("maxOutputBytes", limits.max_output_bytes));
            }
            out_bytes.extend_from_slice(bytes);
            Ok(())
        };
        let mut window = std::collections::VecDeque::<u8>::new();
        let mut records = 0usize;
        let window_limit = usize::try_from(count).unwrap_or(usize::MAX);
        let maximum = if prefix && bytes_mode && !skip { window_limit } else { usize::MAX };
        let mut copy = |chunk: &[u8], eof: bool| {
            if prefix {
                let offset = prefix_len(chunk, &mut remaining, bytes_mode, delimiter);
                write(if skip { &chunk[offset..] } else { &chunk[..offset] })?;
                return Ok((skip || remaining != 0, if skip { chunk.len() } else { offset }));
            }
            window.extend(chunk);
            let excess = if bytes_mode {
                window.len().saturating_sub(window_limit)
            } else {
                records += chunk.iter().filter(|&&b| b == delimiter).count();
                if eof && window.back().is_some_and(|&b| b != delimiter) { records += 1; }
                let excess = records.saturating_sub(window_limit);
                records -= excess;
                if excess == 0 { 0 } else {
                    window.iter().enumerate().filter(|&(_, &b)| b == delimiter)
                        .nth(excess - 1).map_or(window.len(), |(i, _)| i + 1)
                }
            };
            // head emits the evicted bytes; tail emits the retained window at EOF.
            if name == "head" {
                let (a, b) = window.as_slices();
                write(&a[..excess.min(a.len())])?;
                write(&b[..excess.saturating_sub(a.len())])?;
            }
            window.drain(..excess);
            if eof && name == "tail" {
                let (a, b) = window.as_slices();
                write(a)?;
                write(b)?;
            }
            Ok((true, chunk.len()))
        };

        let result = if let Some(ref path) = path {
            let mut available = limits.max_input_bytes;
            fs.read_chunks(path, &mut |chunk| {
                available = available.checked_sub(chunk.len())
                    .ok_or_else(|| fs.limit_error("maxInputBytes", limits.max_input_bytes))?;
                copy(chunk, false).map(|(more, _)| more)
            }).and_then(|()| copy(&[], true).map(|_| ()))
        } else if let Some(source) = stdin.file {
            let admission = if prefix && !skip { source.admit_bounded_read() } else { Ok(()) };
            admission.and_then(|()| source.read(stdin.text, maximum, &mut copy))
        } else {
            let bytes = input.get_or_insert_with(|| stream_string_to_bytes(stdin.text));
            copy(&bytes[consumed..], true).map(|(_, used)| {
                consumed += used;
            })
        };
        if let Err(err) = result {
            if path.is_some() && err.starts_with("EIO:") {
                let operand = absolute_operand(cwd, file);
                stderr.push_str(&format!("{name}: EIO: input/output error, readStream '{operand}'\n"));
            } else {
                stderr.push_str(&format!("{name}: {err}\n"));
            }
            exit_code = 1;
        }
    }

    if consumed != 0 && let Some(bytes) = input {
        *stdin.text = crate::vfs::bytes_to_stream_string(&bytes[consumed..]);
    }

    BuiltinOutcome {
        stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
        stderr,
        exit_code,
    }
}

const WC_ZERO_WIDTH_PACKED: &str = "0,v,2o,w,gx,33,9,1,7,3,8,0,2,0,l,0,69,6,4n,0,13,1,1f,1,4,19,2,0,2,1,2,1,2,8,s,3,7,a,h,a,2,0,1b,k,h,0,2u,6,3,5,3,1,2,3,x,0,3,0,v,s,2i,a,2,d,18,8,8,2,p,3,2,8,2,2,2,6,g,0,q,4,2,0,c,4,w,0,3,d,17,n,2,v,1k,0,2,0,5,7,5,0,4,6,b,1,u,0,3,0,9,1,3,1,n,0,8,0,2,2,5,2,5,5,3,1,3,0,2,7,2,3,3,0,4,3,p,4,2,0,7,3,3,1,n,0,8,0,3,0,3,0,3,3,4,n,5,0,2,6,b,1,4,0,2,b,2,0,a,0,4,0,n,0,8,0,3,0,6,2,5,7,2,0,3,2,2,e,3,3,d,6,2,7,3,0,9,1,3,1,n,0,8,0,3,0,6,2,3,0,2,5,3,1,3,9,2,3,3,0,4,3,j,a,2,0,7,2,4,0,5,2,3,0,2,0,3,2,3,2,4,2,d,3,3,0,3,2,4,0,4,2,2,5,2,d,m,5,4,0,9,0,4,0,o,0,h,2,2,2,5,i,4,1,2,1,3,3,b,6,b,0,c,0,4,0,o,0,b,0,6,2,3,0,6,1,3,0,3,8,3,5,3,0,3,3,b,0,4,d,c,0,4,0,16,1,5,4,4,0,4,0,3,3,f,3,r,1,3,0,j,2,p,0,a,0,2,1,8,7,4,5,9,5,b,1,4,b,1d,0,3,a,9,7,e,10,3,0,2,0,6,0,p,0,2,0,b,0,3,8,2,1,6,0,2,8,b,1,5,v,p,1,s,0,2,0,2,0,f,0,11,h,2,4,2,1,6,1c,9,0,7,0,e,10,1a,3,2,5,2,1,3,1,q,1,5,2,h,3,e,0,3,1,7,0,g,0,15,0,2,4,2,1,41,4f,22,0,5,1,8,0,2,0,5,1,16,0,5,1,y,0,5,1,8,0,2,0,5,1,g,0,1m,0,5,1,1w,4,u,2,r,5,2f,1,7,1,im,2,2i,6,j,2,2,8,k,1,4,8,j,d,e,0,4,e,1h,1,2,6,9,0,3,a,a,2,b,5,b,5,c,4,b,5,2i,6,6,1,z,0,2,4,1z,9,w,3,5,1,4,3,3,0,7,6,2,2,17,1,6,a,19,3,r,5,c,2,1m,1,3,2,1l,0,2,8,2,0,3,7,7,c,b,5,b,5,f,2d,1d,0,2,4,2,0,6,0,b,2,s,8,c,2,x,3,3,1,2,2,1l,0,2,1,4,0,2,2,3,7,1d,7,3,4,g,2,1p,6,18,1,c,a,2,c,2,6,5,0,7,0,4,1,2,4,5d,1r,7r,1,7,1,13,1,7,1,9,0,2,0,2,0,2,0,w,1,1i,0,g,0,f,1,7,0,k,1,4,0,a,0,c,4,p,6,1e,f,3,1,s,0,e,2,y,1q,3x,3,ig,o,c,k,1ed,1,x,0,9l,2,3,4,1a,0,2,4,2,1,1l,6,3,e,o,8,8,0,8,0,8,0,8,0,8,0,8,0,8,0,8,w,2n,x,r,0,2i,b,5z,p,1n,3,j,0,2f,3,2u,4,18,0,2n,0,2d,a,1d,0,mlq,2,1k,8,9p,j,1c,3,2,9,x,1,29,1,7,7,5o,4,3,0,2,0,6,n,h,0,4,0,5,0,q,1,6,3,b,5,1l,7,1x,9,d,n,e,0,13,7,q,a,3,a,v,5,1d,0,3,3,3,1,h,0,c,3,8,0,q,0,16,5,3,1,3,a,4,0,9,0,2,1,b,1,x,0,1g,0,2,2,3,1,6,1,2,0,2,n,i,1,9,a,7,1,7,1,7,8,8,0,8,0,1p,3,3a,0,3,0,5,2,b,5,8md,1nf,57z,1,2z,11,8,b,6,4,2,0,p,0,6,0,2,0,3,0,3,0,3i,f,ce,1,1j,6,2,v,h,f,b,l,10,0,k,0,5,3,6,0,3s,3,5b,2,7,1,7,1,7,1,4,2,8,0,8,c,3,1,d,0,r,0,k,0,3,0,g,1,f,x,3g,4,4,3,1a,2,2h,0,e,2,2,1a,1a,3m,u,2,1e,f,s,3,11,8,v,4,13,9,v,0,12,3,f,15,4f,1,b,5,11,3,11,3,15,7,1h,a,d,0,g,0,8,0,3,0,c,0,g,0,8,0,3,1u,8o,8,n,9,9,n,7,0,17,0,a,1w,7,1,2,0,19,0,3,2,2,1,o,0,21,7,a,1b,k,0,3,4,y,2,s,4,2,1r,1l,3,l,1,1c,e,5,0,4,0,u,9,a,6,a,6,1t,v,12,5,d,8,1j,2,u,1,s,4,r,6,5,b,8,27,22,1i,1g,c,1g,6,17,b,b,85,w,0,17,2,2,1,3,25,15,7,n,a,a,l,j,3,5,11,t,j,o,8,2,0,1j,e,8,3,v,0,3,1,2,b,1e,3,3,1,8,a,2,1,q,6,b,8,11,4,2,8,j,7,10,0,4,a,1h,8,b,3,3,0,h,0,l,a,j,0,t,2,3,0,2,1,7,0,3,1q,8,0,2,0,5,0,g,0,c,5,1c,0,4,c,b,7,3,0,9,1,3,1,n,0,8,0,3,0,6,2,4,0,5,1,3,1,4,1,2,5,2,4,8,4b,1l,7,3,2,2,0,m,0,2,0,4,t,1g,5,2,0,5,1,2,1,5,7,b,4l,1f,5,5,1,2,1,s,z,1g,7,3,0,2,1,5,a,b,5,e,i,18,0,2,0,3,5,2,0,3,5,b,1h,s,4,3,3,2,8,o,54,1c,8,2,1,2,2r,2c,b,9,1,2,1,9,0,3,0,v,0,3,3,2,0,5,0,4,8,b,1x,9,1,17,7,5,0,5,q,2,9,15,5,3,3,9,8,2,5,3,2,1b,c,2,1,a,c,22,6,b,6t,a,0,13,d,2,0,7,9,u,2,x,o,2,6,2,1,2,22,8,0,3,0,13,k,2,8,b,5,7,0,3,0,12,3,3,0,2,0,2,6,b,8l,k,1,5,8,g,0,11,7,3,0,2,0,o,2d,2,e,1f,c,po,2t,34,0,6,a,5h,217,2s,c,tt,g,7,33s,g8,6ns,fu,6,w,0,b,3,2a,0,b,5,v,6,2,9,1d,6,g,9,b,0,8,0,m,4,k,j3,2k,2s,24,4,1l,a,e,1r,5,b,3,d,4qh,7,yf,15,a,6w6,5,0,8,0,3,0,84,e,2,s,4,1,2,d,5,7,b1,1s3,30,4,e,2,a,6,b,1,2,1,2,3ov,39,1n,6v,9,14,1,1r,2,a,f,3,6,v,3,1q,k,1v,2,2,3d,l,b,l,b,2g,8,q,3q,2e,0,20,0,3,1,2,1,3,1,5,0,d,0,2,0,8,0,1u,0,5,1,9,0,8,0,t,0,5,0,6,0,2,2,8,0,9h,1,85,1,fn,1i,5,1d,9,0,f,0,8,vn,w,5,7,78,1r,41,1a,9,8,1,b,3,3,8v,v,h,19,3,b,4,2,cv,t,3,b,kl,8,0,5,0,3,0,g,0,5i,1,a,1b,1x,6,2,3,b,3,3,ls,1x,23,1q,5d,5,0,s,0,3,0,2,1,2,0,b,0,5,0,2,0,2,5,2,3,2,0,2,0,2,0,4,0,3,0,2,1,2,0,2,0,2,0,2,0,2,0,3,0,2,1,5,0,8,0,5,0,5,0,2,0,b,0,i,4,4,0,6,0,i,1f,3,7h,19,3,2t,b,g,1,g,0,g,0,12,9,4v,1j,u,c,19,3,a,6,3,d,7,49,rd,3,i,2,e,2,3c,3,2o,5,d,3,2,e,d,3,1l,7,b,5,15,7,v,1,3,25,9h,b,f,1,e,2,a,6,1b,0,8,7,f,3,a,6,a,6,44,0,1k,10,b,sl,wyp,v,37f,5,67,1,4g3,d,5rm,e,hb,1wh,f3,15t,3t8,4,38h,gnrj,1ekf,1,1ekf,1";
const WC_WIDE_PACKED: &str = "3cw,2n,3i3,1,e,1,5b,3,4,0,3,0,ei,1,m,1,1f,b,18,0,k,0,e,0,9,1,i,1,6,1,9,0,6,0,m,0,8,1,2,0,5,0,3,0,8,0,5,1,t,0,10,0,2,0,5,2,2,0,1q,2,p,0,f,0,nw,1,1g,0,5,0,mj,p,2,2g,d,5x,r,1l,5,g,3,2d,5,2s,6,16,2,2l,2,2b,c,1b,2,mlo,4,1i,wq,s,hw,8mb,6l9,a5,3,2x,mv,9,n,y,2,i,2,3,46,2n,3k,6,m4a,3,d,1,f,4qf,9,yd,17,8,6w8,3,2,6,2,1,2,82,g,0,u,2,3,0,f,3,9,az,c21,0,5n,0,5b,0,3,9,2u,2,e,17,5,8,8,1,f,5,4b,w,d,8,2,1x,2,l,d,16,5,4,d,g,4,0,4,1y,2,0,2,56,3,1q,e,3,2,n,j,0,r,1,e,0,2f,2c,1d,1x,7,0,4,2,3,2,5,3,c,1,8,8,6c,b,5,0,7w,1a,2,9,2,54,35,c,4,8,8,19,2,6,9,d,5,8,8,8,zs,wyn,x,37d,7,65,3,4g1,f,5rk,g,h9,1wj,f1,15v,3t6,6,38f";

fn decode_wc_ranges(packed: &str) -> Vec<(u32, u32)> {
    let parts: Vec<&str> = packed.split(',').collect();
    let mut out = Vec::with_capacity(parts.len() / 2);
    let mut cur = 0u32;
    let mut i = 0usize;
    while i + 1 < parts.len() {
        let start = cur + u32::from_str_radix(parts[i], 36).unwrap_or(0);
        let end = start + u32::from_str_radix(parts[i + 1], 36).unwrap_or(0);
        out.push((start, end));
        cur = end;
        i += 2;
    }
    out
}

fn ranges_contain(ranges: &[(u32, u32)], point: u32) -> bool {
    let mut low = 0usize;
    let mut high = ranges.len();
    while low < high {
        let mid = (low + high) >> 1;
        if point < ranges[mid].0 {
            high = mid;
        } else if point > ranges[mid].1 {
            low = mid + 1;
        } else {
            return true;
        }
    }
    false
}

fn wc_space(point: u32, posix: bool) -> bool {
    point == 32
        || (9..=13).contains(&point)
        || point == 0x1680
        || ((0x2000..=0x200a).contains(&point) && point != 0x2007)
        || point == 0x2028
        || point == 0x2029
        || point == 0x205f
        || point == 0x3000
        || (!posix && matches!(point, 0xa0 | 0x2007 | 0x202f | 0x2060))
}

fn cmd_wc(
    args: &[String],
    mut stdin: CommandInput,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut show_l = false;
    let mut show_w = false;
    let mut show_c = false;
    let mut show_m = false;
    let mut show_max_l = false;
    let mut total_mode = "auto".to_string();
    let mut files0_from: Option<String> = None;
    let mut inline_locale: Option<String> = None;
    let mut files = Vec::new();
    let mut ended = false;
    let mut i = 0usize;

    while i < args.len() {
        let a = &args[i];
        if !ended && a.starts_with("LC_ALL=") {
            inline_locale = Some(a["LC_ALL=".len()..].to_string());
            i += 1;
            continue;
        }
        if !ended && a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if ended || a == "-" || !a.starts_with('-') {
            files.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--lines" {
            show_l = true;
        } else if a == "--words" {
            show_w = true;
        } else if a == "--bytes" {
            show_c = true;
        } else if a == "--chars" {
            show_m = true;
        } else if a == "--max-line-length" {
            show_max_l = true;
        } else if let Some(val) = a.strip_prefix("--total=") {
            total_mode = val.to_string();
        } else if a == "--total" {
            if i + 1 >= args.len() {
                return err_out("wc: option '--total' requires an argument\n", 2);
            }
            total_mode = args[i + 1].clone();
            i += 1;
        } else if let Some(val) = a.strip_prefix("--files0-from=") {
            files0_from = Some(val.to_string());
        } else if a == "--files0-from" {
            if i + 1 >= args.len() {
                return err_out("wc: option '--files0-from' requires an argument\n", 2);
            }
            files0_from = Some(args[i + 1].clone());
            i += 1;
        } else if a.starts_with("--") {
            return err_out(&format!("wc: unrecognized option '{a}'\n"), 2);
        } else {
            for ch in a[1..].chars() {
                match ch {
                    'l' => show_l = true,
                    'w' => show_w = true,
                    'c' => show_c = true,
                    'm' => show_m = true,
                    'L' => show_max_l = true,
                    _ => return err_out(&format!("wc: invalid option -- '{ch}'\n"), 2),
                }
            }
        }
        i += 1;
    }

    if !matches!(total_mode.as_str(), "auto" | "always" | "only" | "never") {
        return err_out(&format!("wc: invalid argument '{total_mode}' for '--total'\n"), 2);
    }

    if !show_l && !show_w && !show_m && !show_c && !show_max_l {
        show_l = true;
        show_w = true;
        show_c = true;
    }

    if let Some(ref f0) = files0_from {
        let f_bytes = if f0 == "-" {
            let mut bytes = Vec::new();
            if let Err(error) = stdin.append_bytes(&mut bytes) { return err_out(&format!("wc: {error}\n"), 1); }
            bytes
        } else {
            let p = resolve_posix_path(cwd, f0);
            if fs.is_dir(&p) {
                return err_out(
                    &format!("wc: EISDIR: illegal operation on a directory, readFile '{p}'\n"),
                    1,
                );
            }
            match fs.read_file(&p) {
                Ok(b) => b,
                Err(_) => {
                    return err_out(
                        &format!("wc: ENOENT: no such file or directory, readFile '{p}'\n"),
                        1,
                    );
                }
            }
        };
        let f_text = String::from_utf8_lossy(&f_bytes);
        let stripped = f_text.strip_suffix('\0').unwrap_or(&f_text);
        if !stripped.is_empty() {
            for part in stripped.split('\0') {
                if !part.is_empty() {
                    files.push(part.to_string());
                }
            }
        }
    }

    let selected_count = [show_l, show_w, show_m, show_c, show_max_l]
        .iter()
        .filter(|&&b| b)
        .count();
    let has_operands = !files.is_empty();
    let names = if has_operands {
        files
    } else {
        vec!["-".to_string()]
    };

    let locale = inline_locale
        .as_deref()
        .or_else(|| env.get("LC_ALL").map(|s| s.as_str()).filter(|s| !s.is_empty()))
        .or_else(|| env.get("LC_CTYPE").map(|s| s.as_str()).filter(|s| !s.is_empty()))
        .or_else(|| env.get("LANG").map(|s| s.as_str()).filter(|s| !s.is_empty()))
        .unwrap_or("C.UTF-8");
    let single_byte = locale == "C" || locale == "POSIX";
    let posix = env.contains_key("POSIXLY_CORRECT");

    let mut width = 1usize;
    if total_mode != "only" && (names.len() > 1 || selected_count > 1) {
        let mut total_size: u128 = 0;
        for name in &names {
            if name == "-" {
                width = width.max(7);
                continue;
            }
            let p = resolve_posix_path(cwd, name);
            if let Ok(st) = fs.stat(&p) {
                if st.kind != crate::vfs::VfsEntryKind::File {
                    width = width.max(7);
                } else {
                    total_size += st.size as u128;
                }
            }
        }
        width = width.max(total_size.to_string().len());
    }

    static ZERO_RANGES: std::sync::LazyLock<Vec<(u32, u32)>> = std::sync::LazyLock::new(|| decode_wc_ranges(WC_ZERO_WIDTH_PACKED));
    static WIDE_RANGES: std::sync::LazyLock<Vec<(u32, u32)>> = std::sync::LazyLock::new(|| decode_wc_ranges(WC_WIDE_PACKED));
    let mut count_operand = |name: &str| -> Result<_, String> {
        let (mut lines, mut words, mut chars, mut bytes, mut max_cols, mut cols) = (0u64, 0u64, 0u64, 0u64, 0u64, 0u64);
        let mut in_word = false;
        let mut remaining = 0u8;
        let mut point = 0u32;
        let mut lead = 0u8;
        let mut first = false;
        let limit = fs.max_input_bytes();
        let mut exceeded = false;
        stdin.read_operand(name, cwd, fs, false, |chunk| {
            bytes += chunk.len() as u64;
            if bytes > limit as u64 { exceeded = true; return false; }
            if show_l { lines += chunk.iter().filter(|&&b| b == b'\n').count() as u64; }
            if !show_w && !show_max_l && (!show_m || single_byte) {
                if show_m { chars += chunk.len() as u64; }
                return true;
            }
            for &byte in chunk {
                // Keep UTF-8 state across reads. After an invalid continuation,
                // the current byte can still be the start of another character.
                let continuation = remaining != 0 && (0x80..=0xbf).contains(&byte)
                    && !(first && ((lead == 0xe0 && byte < 0xa0) || (lead == 0xed && byte >= 0xa0)
                    || (lead == 0xf0 && byte < 0x90) || (lead == 0xf4 && byte >= 0x90)));
                if continuation {
                    first = false;
                    point = (point << 6) | u32::from(byte & 0x3f);
                    remaining -= 1;
                    if remaining != 0 { continue; }
                } else {
                    remaining = 0;
                    if single_byte || byte < 0x80 { point = u32::from(byte); }
                    else if (0xc2..=0xf4).contains(&byte) {
                        lead = byte; first = true;
                        remaining = if byte < 0xe0 { 1 } else if byte < 0xf0 { 2 } else { 3 };
                        point = u32::from(byte & (0x7f >> (remaining + 1)));
                        continue;
                    } else { continue; }
                }
                chars += 1;
                if show_w {
                    let space = if single_byte { point == 32 || (9..=13).contains(&point) } else { wc_space(point, posix) };
                    let printable = if single_byte { (32..127).contains(&point) } else { point >= 32 && !(127..160).contains(&point) };
                    if space { in_word = false; }
                    else if printable && !in_word { words += 1; in_word = true; }
                }
                if show_max_l {
                    match point {
                        10 | 12 | 13 => { max_cols = max_cols.max(cols); cols = 0; }
                        9 => cols += 8 - (cols & 7),
                        32..=126 => cols += 1,
                        _ if !single_byte && !ranges_contain(&ZERO_RANGES, point) => cols += if ranges_contain(&WIDE_RANGES, point) { 2 } else { 1 },
                        _ => {}
                    }
                }
            }
            true
        })?;
        if exceeded { return Err(fs.limit_error("maxInputBytes", limit)); }
        Ok((lines, words, chars, bytes, max_cols.max(cols)))
    };

    let format_counts =
        |l: u64, w: u64, m: u64, c: u64, max_l: u64, label: Option<&str>| -> String {
            let mut nums = Vec::new();
            if show_l {
                nums.push(format!("{l:>width$}"));
            }
            if show_w {
                nums.push(format!("{w:>width$}"));
            }
            if show_m {
                nums.push(format!("{m:>width$}"));
            }
            if show_c {
                nums.push(format!("{c:>width$}"));
            }
            if show_max_l {
                nums.push(format!("{max_l:>width$}"));
            }
            if let Some(name) = label {
                format!("{} {name}\n", nums.join(" "))
            } else {
                format!("{}\n", nums.join(" "))
            }
        };

    let mut out = String::new();
    let mut stderr = String::new();
    let mut exit_code = 0;
    let mut tot = (0u64, 0u64, 0u64, 0u64, 0u64);

    for name in &names {
        let label = if has_operands { Some(name.as_str()) } else { None };
        match count_operand(name) {
            Ok((l, w, m, c, max_l)) => {
                tot.0 += l;
                tot.1 += w;
                tot.2 += m;
                tot.3 += c;
                tot.4 = tot.4.max(max_l);
                if total_mode != "only" {
                    out.push_str(&format_counts(l, w, m, c, max_l, label));
                }
            }
            Err(error) => {
                if error.starts_with("EISDIR:") && total_mode != "only" {
                    out.push_str(&format_counts(0, 0, 0, 0, 0, label));
                }
                stderr.push_str(&format!("wc: {error}\n"));
                exit_code = 1;
            }
        }
    }

    if total_mode == "only" {
        out.push_str(&format_counts(tot.0, tot.1, tot.2, tot.3, tot.4, None));
    } else if total_mode == "always" || (total_mode == "auto" && names.len() > 1) {
        out.push_str(&format_counts(tot.0, tot.1, tot.2, tot.3, tot.4, Some("total")));
    }

    BuiltinOutcome {
        stdout: out,
        stderr,
        exit_code,
    }
}

#[derive(Clone, Debug)]
struct SortKey {
    start: usize,
    start_character: usize,
    start_blanks: bool,
    end_blanks: bool,
    end: Option<usize>,
    end_character: Option<usize>,
    flags: BTreeSet<char>,
}

fn parse_sort_key(specification: &str) -> Result<SortKey, String> {
    let bytes = specification.as_bytes();
    let mut offset = 0usize;
    let parse_pos = |offset: &mut usize, min_val: u64| -> Result<usize, String> {
        let begin = *offset;
        while *offset < bytes.len() && bytes[*offset].is_ascii_digit() {
            *offset += 1;
        }
        if *offset == begin {
            return Err(format!("sort: invalid key '{specification}'\n"));
        }
        let raw = &specification[begin..*offset];
        let val = raw
            .parse::<u64>()
            .map_err(|_| format!("sort: invalid number '{raw}'\n"))?;
        if !(min_val..(1 << 53)).contains(&val) {
            return Err(format!("sort: invalid number '{raw}'\n"));
        }
        Ok(usize::try_from(val).unwrap_or(usize::MAX))
    };
    let mut flags = BTreeSet::new();
    let parse_endpoint = |offset: &mut usize,
                          min_char: u64,
                          flags: &mut BTreeSet<char>|
     -> Result<(usize, Option<usize>, bool), String> {
        let field = parse_pos(offset, 1)?;
        let mut character = None;
        let mut blanks = false;
        if *offset < bytes.len() && bytes[*offset] == b'.' {
            *offset += 1;
            character = Some(parse_pos(offset, min_char)?);
        }
        while *offset < bytes.len() && b"bdfghiMnrV".contains(&bytes[*offset]) {
            let f = bytes[*offset] as char;
            *offset += 1;
            flags.insert(f);
            if f == 'b' {
                blanks = true;
            }
        }
        Ok((field, character, blanks))
    };
    let (start_field, start_char, start_blanks) = parse_endpoint(&mut offset, 1, &mut flags)?;
    let mut end_field = None;
    let mut end_char = None;
    let mut end_blanks = false;
    if offset < bytes.len() && bytes[offset] == b',' {
        offset += 1;
        let (ef, ec, eb) = parse_endpoint(&mut offset, 0, &mut flags)?;
        end_field = Some(ef);
        if let Some(c) = ec
            && c > 0
        {
            end_char = Some(c);
        }
        end_blanks = eb;
    }
    if offset != bytes.len() {
        return Err(format!("sort: invalid key '{specification}'\n"));
    }
    Ok(SortKey {
        start: start_field,
        start_character: start_char.unwrap_or(1),
        start_blanks,
        end_blanks,
        end: end_field,
        end_character: end_char,
        flags,
    })
}

struct SortInput<'a> {
    file: Option<crate::vfs::ChunkReader<'a>>,
    fs: &'a dyn SafeBashFs,
    directory: &'a str,
    inline_limit: usize,
    chunk: Vec<u8>,
    offset: usize,
}

impl SortInput<'_> {
    fn next_record(&mut self, stdin: &mut CommandInput, delimiter: u8, bytes: &mut u64, records: &mut u64) -> Result<Option<SortRecord>, String> {
        let mut record = SortRecord::default();
        loop {
            if self.offset == self.chunk.len() {
                if let Some(next) = &mut self.file { next(&mut self.chunk)?; }
                else { stdin.next_stdin_chunk(&mut self.chunk)?; }
                self.offset = 0;
                *bytes = bytes.checked_sub(self.chunk.len() as u64).ok_or("EFBIG: sort input byte limit exceeded")?;
                if self.chunk.is_empty() {
                    if record.len() == 0 { return Ok(None); }
                    *records = records.checked_sub(1).ok_or("EFBIG: sort input record limit exceeded")?;
                    break;
                }
            }
            let tail = &self.chunk[self.offset..];
            if let Some(index) = tail.iter().position(|&byte| byte == delimiter) {
                *records = records.checked_sub(1).ok_or("EFBIG: sort input record limit exceeded")?;
                record.append(&tail[..index], self.inline_limit, self.fs, self.directory)?;
                self.offset += index + 1;
                break;
            }
            record.append(tail, self.inline_limit, self.fs, self.directory)?;
            self.offset = self.chunk.len();
        }
        Ok(Some(record))
    }
}

fn cmd_sort(
    args: &[String],
    mut stdin: CommandInput,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut flags: BTreeSet<char> = BTreeSet::new();
    let mut raw_sep: Option<String> = None;
    let mut out_file: Option<String> = None;
    let mut memory_arg = None;
    let mut batch_arg = None;
    let mut byte_limit_arg = None;
    let mut record_limit_arg = None;
    let mut key_specs: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();
    let mut opts_done = false;
    let mut i = 0usize;

    let apply_sort_mode = |mode: &str, flags: &mut BTreeSet<char>| -> Result<(), String> {
        let f = match mode {
            "numeric" => 'n',
            "general-numeric" => 'g',
            "human-numeric" => 'h',
            "month" => 'M',
            "version" => 'V',
            _ => return Err(format!("sort: invalid sort argument '{mode}'\n")),
        };
        flags.insert(f);
        Ok(())
    };

    while i < args.len() {
        let a = &args[i];
        if !opts_done && a == "--" {
            opts_done = true;
            i += 1;
            continue;
        }
        if !opts_done && a.starts_with("--") {
            if a == "--check" || a == "--check=diagnose-first" {
                flags.insert('c');
            } else if a == "--check=quiet" || a == "--check=silent" {
                flags.insert('C');
            } else if let Some(rest) = a.strip_prefix("--check=") {
                return err_out(&format!("sort: invalid argument '{rest}' for '--check'\n"), 2);
            } else if a == "--human-numeric-sort" {
                flags.insert('h');
            } else if a == "--numeric-sort" {
                flags.insert('n');
            } else if a == "--general-numeric-sort" {
                flags.insert('g');
            } else if a == "--month-sort" {
                flags.insert('M');
            } else if a == "--version-sort" {
                flags.insert('V');
            } else if a == "--dictionary-order" {
                flags.insert('d');
            } else if a == "--ignore-nonprinting" {
                flags.insert('i');
            } else if a == "--merge" {
                flags.insert('m');
            } else if a == "--reverse" {
                flags.insert('r');
            } else if a == "--ignore-case" {
                flags.insert('f');
            } else if a == "--ignore-leading-blanks" {
                flags.insert('b');
            } else if a == "--unique" {
                flags.insert('u');
            } else if a == "--stable" {
                flags.insert('s');
            } else if a == "--zero-terminated" {
                flags.insert('z');
            } else if a == "--field-separator" {
                if i + 1 >= args.len() {
                    return err_out("sort: option '--field-separator' requires an argument\n", 2);
                }
                raw_sep = Some(args[i + 1].clone());
                i += 1;
            } else if let Some(v) = a.strip_prefix("--field-separator=") {
                raw_sep = Some(v.to_string());
            } else if a == "--key" {
                if i + 1 >= args.len() {
                    return err_out("sort: option '--key' requires an argument\n", 2);
                }
                key_specs.push(args[i + 1].clone());
                i += 1;
            } else if let Some(v) = a.strip_prefix("--key=") {
                key_specs.push(v.to_string());
            } else if a == "--output" {
                if i + 1 >= args.len() {
                    return err_out("sort: option '--output' requires an argument\n", 2);
                }
                out_file = Some(args[i + 1].clone());
                i += 1;
            } else if let Some(v) = a.strip_prefix("--output=") {
                out_file = Some(v.to_string());
            } else if a == "--sort" {
                if i + 1 >= args.len() {
                    return err_out("sort: option '--sort' requires an argument\n", 2);
                }
                if let Err(msg) = apply_sort_mode(&args[i + 1], &mut flags) {
                    return err_out(&msg, 2);
                }
                i += 1;
            } else if let Some(v) = a.strip_prefix("--sort=") {
                if let Err(msg) = apply_sort_mode(v, &mut flags) {
                    return err_out(&msg, 2);
                }
            } else if matches!(a.split('=').next(), Some("--buffer-size" | "--max-input-bytes" | "--max-records" | "--batch-size")) {
                let (opt, val) = match a.split_once('=') {
                    Some(pair) => pair,
                    None => {
                        i += 1;
                        let Some(val) = args.get(i) else { return err_out(&format!("sort: option '{a}' requires an argument\n"), 2) };
                        (a.as_str(), val.as_str())
                    }
                };
                match opt {
                    "--buffer-size" => memory_arg = Some(val.to_owned()),
                    "--batch-size" => batch_arg = Some(val),
                    "--max-input-bytes" => byte_limit_arg = Some(val),
                    "--max-records" => record_limit_arg = Some(val),
                    _ => {}
                }
            } else {
                return err_out(&format!("sort: unrecognized option '{a}'\n"), 2);
            }
            i += 1;
            continue;
        }
        if !opts_done && a.starts_with('-') && a.len() > 1 {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut ci = 0usize;
            while ci < chars.len() {
                let ch = chars[ci];
                match ch {
                    'h' | 'n' | 'g' | 'M' | 'V' | 'd' | 'i' | 'm' | 'r' | 'f'
                    | 'b' | 'u' | 's' | 'z' | 'c' | 'C' => {
                        flags.insert(ch);
                        ci += 1;
                    }
                    't' | 'k' | 'o' | 'S' => {
                        let val = if ci + 1 < chars.len() {
                            chars[ci + 1..].iter().collect::<String>()
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            return err_out(
                                &format!("sort: option requires an argument -- '{ch}'\n"),
                                2,
                            );
                        };
                        match ch {
                            'S' => memory_arg = Some(val),
                            't' => raw_sep = Some(val),
                            'k' => key_specs.push(val),
                            'o' => out_file = Some(val),
                            _ => {}
                        }
                        break;
                    }
                    _ => return err_out(&format!("sort: invalid option -- '{ch}'\n"), 2),
                }
            }
            i += 1;
            continue;
        }
        files.push(a.clone());
        i += 1;
    }

    if flags.contains(&'c') && flags.contains(&'C') {
        return err_out("sort: options '-cC' are incompatible\n", 2);
    }
    let checking = flags.contains(&'c') || flags.contains(&'C');
    if checking && files.len() > 1 {
        return err_out(
            &format!(
                "sort: extra operand '{}' not allowed with -{}\n",
                files[1],
                if flags.contains(&'C') { 'C' } else { 'c' }
            ),
            2,
        );
    }

    let separator: Option<u8> = match raw_sep {
        None => None,
        Some(ref s) if s.is_empty() || s == "\\0" => Some(0u8),
        Some(ref s) => {
            let b = crate::vfs::stream_string_to_bytes(s);
            if b.len() != 1 {
                return err_out("sort: field separator must be one byte\n", 2);
            }
            Some(b[0])
        }
    };

    let mut keys: Vec<SortKey> = Vec::with_capacity(key_specs.len());
    for ks in &key_specs {
        match parse_sort_key(ks) {
            Ok(k) => keys.push(k),
            Err(msg) => return err_out(&msg, 2),
        }
    }

    let check_flag_set = |fset: &BTreeSet<char>| -> Result<(), String> {
        let mode_count = ['g', 'h', 'M', 'n', 'V']
            .iter()
            .filter(|f| fset.contains(f))
            .count();
        let nontextual = ['g', 'h', 'M', 'n'].iter().any(|f| fset.contains(f));
        if mode_count > 1 || (nontextual && (fset.contains(&'d') || fset.contains(&'i'))) {
            let mut order = vec!['d', 'g', 'h', 'i', 'M', 'n'];
            if mode_count > 1 {
                order.push('V');
            }
            let incompatible: String = order.into_iter().filter(|f| fset.contains(f)).collect();
            return Err(format!("sort: options '-{incompatible}' are incompatible\n"));
        }
        Ok(())
    };

    if keys.is_empty() {
        if let Err(msg) = check_flag_set(&flags) {
            return err_out(&msg, 2);
        }
    } else {
        for k in &keys {
            let active_flags = if k.flags.is_empty() { &flags } else { &k.flags };
            if let Err(msg) = check_flag_set(active_flags) {
                return err_out(&msg, 2);
            }
        }
    }

    let delim_byte = if flags.contains(&'z') { 0u8 } else { b'\n' };
    let names: Vec<String> = if files.is_empty() {
        vec!["-".to_string()]
    } else {
        files
    };

    let simple = keys.is_empty()
        && !['b', 'f', 'h', 'n', 'g', 'M', 'V', 'd', 'i']
            .iter()
            .any(|f| flags.contains(f));
    let global_rev = flags.contains(&'r');
    let stable = flags.contains(&'s');
    let unique = flags.contains(&'u');

    const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;
    let number = |v: &str, minimum: u64| {
        v.parse::<u64>().ok().filter(|&n| (minimum..=MAX_SAFE_INTEGER).contains(&n))
            .ok_or_else(|| err_out(&format!("sort: invalid number '{v}'\n"), 2))
    };
    let memory_bytes = match memory_arg.as_deref() {
        None => 8 * 1024 * 1024,
        Some(v) => {
            let shift = match v.as_bytes().last().map(u8::to_ascii_uppercase) {
                Some(b'K') => 10, Some(b'M') => 20, Some(b'G') => 30, _ => 0,
            };
            let digits = if shift == 0 { v } else { &v[..v.len() - 1] };
            match number(digits, 1) { Ok(n) => n.saturating_mul(1 << shift), Err(e) => return e }
        }
    };
    let mut remaining_bytes = match byte_limit_arg.map(|v| number(v, 0)).transpose() { Ok(n) => n.unwrap_or(u64::MAX), Err(e) => return e };
    let mut remaining_records = match record_limit_arg.map(|v| number(v, 0)).transpose() { Ok(n) => n.unwrap_or(u64::MAX), Err(e) => return e };
    let fan_in = match batch_arg.map(|v| number(v, 2)).transpose() { Ok(n) => n.unwrap_or(16), Err(e) => return e };
    if !(1024 * 1024..=MAX_SAFE_INTEGER).contains(&memory_bytes) {
        return err_out("sort: sort memory budget must be at least 1048576 bytes\n", 2);
    }
    if fan_in > 32 { return err_out("sort: sort merge fan-in must be between 2 and 32\n", 2); }
    let collator = match sort_locale::Collator::from_env(env) {
        Ok(value) => value, Err(message) => return err_out(&message, 2),
    };
    let byte_fast_path = (simple && collator.is_none()).then_some(global_rev);
    let directory = env.get("TMPDIR").filter(|s| !s.is_empty()).map_or_else(|| cwd.to_owned(), |v| absolute_operand(cwd, v));
    let record_limit = (memory_bytes / (8 * (fan_in + 4))).min(sort_record::PAGE as u64) as usize;
    let order = sort_keys::KeyOrder { collator: collator.as_ref(), keys: &keys, flags: &flags, separator, fs, directory: &directory, record_limit };
    let compare = |a: &SortRecord, b: &SortRecord| -> Result<std::cmp::Ordering, String> {
        if !simple {
            let cmp = order.compare(a, b)?;
            if !cmp.is_eq() || stable || unique { return Ok(cmp); }
        }
        let cmp = if let Some(c) = &collator {
            c.compare(&a.read_range(0, a.len())?, &b.read_range(0, b.len())?)?
        } else { a.byte_order(b)? };
        Ok(if global_rev { cmp.reverse() } else { cmp })
    };
    let merge = flags.contains(&'m');
    let mut out_bytes = Vec::new();
    let mut prev_emitted = None::<SortRecord>;
    let mut output = |record: SortRecord| -> Result<(), String> {
        if let Some(prev) = &prev_emitted && compare(prev, &record)?.is_eq() { return Ok(()); }
        record.chunks(|chunk| { out_bytes.extend_from_slice(chunk); Ok(()) })?;
        out_bytes.push(delim_byte);
        if unique { prev_emitted = Some(record); }
        Ok(())
    };
    let open = |name: &str| -> Result<SortInput, String> {
        let file = if name == "-" { None } else { Some(open_record_input(name, cwd, fs, false)?) };
        Ok(SortInput { file, fs, directory: &directory, inline_limit: record_limit.max(sort_record::PAGE - 8), chunk: Vec::new(), offset: 0 })
    };
    let mut next = |input: &mut SortInput| input.next_record(&mut stdin, delim_byte, &mut remaining_bytes, &mut remaining_records);
    let batch_limit = usize::try_from(memory_bytes / 4).unwrap_or(usize::MAX);
    let mut runs = sort_runs::SortRuns::new(fs, &directory, batch_limit);
    let sort_error = |e| err_out(&format!("sort: {e}\n"), 2);
    if merge && !checking {
        let direct = names.len() <= fan_in as usize && out_file.is_none();
        for group in names.chunks(fan_in as usize) {
            let mut run = sort_runs::Run::default();
            let result = (|| -> Result<(), String> {
                let mut sources = Vec::with_capacity(group.len());
                for name in group {
                    let mut source = open(name)?;
                    let head = next(&mut source)?;
                    if let Some(head) = head { sources.push((head, source)); }
                }
                while !sources.is_empty() {
                    let mut index = 0;
                    for i in 1..sources.len() {
                        if compare(&sources[i].0, &sources[index].0)?.is_lt() { index = i; }
                    }
                    let (head, source) = &mut sources[index];
                    if direct { output(std::mem::take(head))?; } else { runs.append(&mut run, head)?; }
                    if let Some(record) = next(source)? {
                        *head = record;
                    } else { sources.remove(index); }
                }
                Ok(())
            })();
            if let Err(e) = result {
                let mut error = err_out(&format!("sort: {e}\n"), 2);
                if direct && out_file.is_none() { error.stdout = crate::vfs::bytes_to_stream_string(&out_bytes); }
                return error;
            }
            if !direct && let Err(e) = runs.add(run, &compare) { return sort_error(e); }
        }
    } else {
        let mut batch = Vec::new();
        let mut bytes = 0usize;
        let mut spilled = false;
        let flush = |batch: &mut Vec<SortRecord>, runs: &mut sort_runs::SortRuns| -> Result<(), String> {
            sort_record::sort_batch(batch, byte_fast_path, &compare)?;
            let mut run = sort_runs::Run::default();
            for record in batch.drain(..) { runs.append(&mut run, &record)?; }
            runs.add(run, &compare)
        };
        for name in &names {
            let mut source = match open(name) { Ok(source) => source, Err(e) => return err_out(&format!("sort: {e}\n"), 2) };
            let mut previous = None::<SortRecord>;
            let mut ordinal = 0;
            loop {
                let record = match next(&mut source) {
                    Ok(Some(record)) => record, Ok(None) => break, Err(e) => return err_out(&format!("sort: {e}\n"), 2),
                };
                if checking {
                    ordinal += 1;
                    if let Some(prev) = &previous {
                        match compare(prev, &record) {
                            Ok(ord) if ord.is_gt() || unique && ord.is_eq() => return if flags.contains(&'C') { err_out("", 1) }
                                else { err_out(&format!("sort: disorder at record {ordinal}\n"), 1) },
                            Ok(_) => {}, Err(e) => return sort_error(e),
                        }
                    }
                    previous = Some(record);
                } else {
                    let charge = if record.len() <= record_limit { record.len() } else { sort_record::PAGE };
                    bytes = bytes.saturating_add(charge + 128);
                    batch.push(record);
                    if bytes >= batch_limit {
                        if let Err(e) = flush(&mut batch, &mut runs) { return sort_error(e); }
                        spilled = true;
                        bytes = 0;
                    }
                }
            }
            if checking { return ok_out(""); }
        }
        if spilled {
            if !batch.is_empty() && let Err(e) = flush(&mut batch, &mut runs) { return sort_error(e); }
        } else {
            if let Err(e) = sort_record::sort_batch(&mut batch, byte_fast_path, &compare) { return sort_error(e); }
            for record in batch { if let Err(e) = output(record) { return sort_error(e); } }
        }
    }
    if let Err(e) = runs.finish(&compare, output) { return sort_error(e); }

    if let Some(ref of) = out_file {
        let path = absolute_operand(cwd, of);
        let result = resolve_record_output(fs, &path).and_then(|entry| {
            fs.write_file(&entry, &out_bytes).map_err(|e| stream_file_error(e, "writeStream", &path))
        });
        if let Err(e) = result { return err_out(&format!("sort: {e}\n"), 2); }
        return ok_out("");
    }
    ok_out(&crate::vfs::bytes_to_stream_string(&out_bytes))
}

fn cmd_uniq(
    args: &[String],
    mut stdin: CommandInput,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut count_flag = false;
    let mut repeated_only = false;
    let mut unique_only = false;
    let mut ignore_case = false;
    let mut zero_term = false;
    let mut skip_fields = 0usize;
    let mut skip_chars = 0usize;
    let mut max_chars: Option<usize> = None;
    let mut has_all_repeated = false;
    let mut repeated_method = "none".to_string();
    let mut group_method: Option<String> = None;
    let mut operands: Vec<String> = Vec::new();
    let mut opts_done = false;
    let mut i = 0usize;

    let parse_nonneg = |val: &str, _label: &str| -> Result<usize, String> {
        if val.is_empty() || !val.bytes().all(|b| b.is_ascii_digit()) {
            return Err(format!("uniq: invalid number '{val}'\n"));
        }
        val.parse::<usize>()
            .map_err(|_| format!("uniq: invalid number '{val}'\n"))
    };

    while i < args.len() {
        let a = &args[i];
        if !opts_done && a == "--" {
            opts_done = true;
            i += 1;
            continue;
        }
        if !opts_done && a.starts_with("--") {
            if a == "--count" {
                count_flag = true;
            } else if a == "--repeated" {
                repeated_only = true;
            } else if a == "--unique" {
                unique_only = true;
            } else if a == "--ignore-case" {
                ignore_case = true;
            } else if a == "--zero-terminated" {
                zero_term = true;
            } else if a == "--all-repeated" {
                has_all_repeated = true;
                repeated_method = "none".to_string();
            } else if let Some(v) = a.strip_prefix("--all-repeated=") {
                if !matches!(v, "none" | "prepend" | "separate") {
                    return err_out(
                        &format!("uniq: invalid argument '{v}' for 'all-repeated'\n"),
                        2,
                    );
                }
                has_all_repeated = true;
                repeated_method = v.to_string();
            } else if a == "--group" {
                group_method = Some("separate".to_string());
            } else if let Some(v) = a.strip_prefix("--group=") {
                if !matches!(v, "separate" | "prepend" | "append" | "both") {
                    return err_out(&format!("uniq: invalid argument '{v}' for 'group'\n"), 2);
                }
                group_method = Some(v.to_string());
            } else if a == "--skip-fields" || a == "--skip-chars" || a == "--check-chars" {
                if i + 1 >= args.len() {
                    return err_out(&format!("uniq: option '{a}' requires an argument\n"), 2);
                }
                let n = match parse_nonneg(&args[i + 1], a) {
                    Ok(v) => v,
                    Err(msg) => return err_out(&msg, 2),
                };
                match a.as_str() {
                    "--skip-fields" => skip_fields = n,
                    "--skip-chars" => skip_chars = n,
                    _ => max_chars = Some(n),
                }
                i += 1;
            } else if let Some(v) = a.strip_prefix("--skip-fields=") {
                match parse_nonneg(v, "skip-fields") {
                    Ok(n) => skip_fields = n,
                    Err(msg) => return err_out(&msg, 2),
                }
            } else if let Some(v) = a.strip_prefix("--skip-chars=") {
                match parse_nonneg(v, "skip-chars") {
                    Ok(n) => skip_chars = n,
                    Err(msg) => return err_out(&msg, 2),
                }
            } else if let Some(v) = a.strip_prefix("--check-chars=") {
                match parse_nonneg(v, "check-chars") {
                    Ok(n) => max_chars = Some(n),
                    Err(msg) => return err_out(&msg, 2),
                }
            } else {
                return err_out(&format!("uniq: unrecognized option '{a}'\n"), 2);
            }
            i += 1;
            continue;
        }
        if !opts_done && a.starts_with('-') && a.len() > 1 {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut ci = 0usize;
            while ci < chars.len() {
                let ch = chars[ci];
                match ch {
                    'c' => count_flag = true,
                    'd' => repeated_only = true,
                    'D' => {
                        has_all_repeated = true;
                        repeated_method = "none".to_string();
                    }
                    'u' => unique_only = true,
                    'i' => ignore_case = true,
                    'z' => zero_term = true,
                    'f' | 's' | 'w' => {
                        let val_str = if ci + 1 < chars.len() {
                            chars[ci + 1..].iter().collect::<String>()
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            return err_out(
                                &format!("uniq: option requires an argument -- '{ch}'\n"),
                                2,
                            );
                        };
                        let n = match parse_nonneg(&val_str, &format!("-{ch}")) {
                            Ok(v) => v,
                            Err(msg) => return err_out(&msg, 2),
                        };
                        match ch {
                            'f' => skip_fields = n,
                            's' => skip_chars = n,
                            _ => max_chars = Some(n),
                        }
                        break;
                    }
                    _ => return err_out(&format!("uniq: invalid option -- '{ch}'\n"), 2),
                }
                ci += 1;
            }
            i += 1;
            continue;
        }
        operands.push(a.clone());
        i += 1;
    }

    if has_all_repeated && count_flag {
        return err_out(
            "uniq: printing all duplicated lines and repeat counts is meaningless\n",
            2,
        );
    }
    if group_method.is_some()
        && (has_all_repeated || count_flag || repeated_only || unique_only)
    {
        return err_out("uniq: --group is mutually exclusive with -c/-d/-D/-u\n", 2);
    }
    if operands.len() > 2 {
        return err_out(&format!("uniq: extra operand '{}'\n", operands[2]), 2);
    }
    if operands.len() == 2 && operands[0] != "-" {
        let src = absolute_operand(cwd, &operands[0]);
        let (src_entry, src_stat) = match fs.inspect_command_entry(&src, true, "stat") {
            Ok(entry) => entry,
            Err(e) => return err_out(&format!("uniq: {}\n", stream_file_error(e, "stat", &src)), 1),
        };
        let dst = absolute_operand(cwd, &operands[1]);
        match fs.inspect_command_entry(&dst, true, "stat") {
            Ok((dst_entry, dst_stat)) => {
                if src_entry == dst_entry || src_stat.identity.is_some() && src_stat.identity == dst_stat.identity {
                    return err_out("uniq: input and output must be different files\n", 2);
                }
                if src_stat.identity.is_none() || dst_stat.identity.is_none() {
                    return err_out(&format!("uniq: ENOTSUP: cannot determine whether input and output are distinct files, uniq '{src}' -> '{dst}'\n"), 1);
                }
            }
            Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => {}
            Err(e) => return err_out(&format!("uniq: {}\n", stream_file_error(e, "stat", &dst)), 1),
        }
    }

    let in_name = operands.first().map(|s| s.as_str()).unwrap_or("-");
    let destination = if let Some(name) = operands.get(1) {
        let path = absolute_operand(cwd, name);
        let entry = match resolve_record_output(fs, &path) {
            Ok(entry) => entry,
            Err(e) => return err_out(&format!("uniq: {e}\n"), 1),
        };
        if let Err(e) = fs.write_file(&entry, &[]) {
            return err_out(&format!("uniq: {}\n", stream_file_error(e, "writeStream", &path)), 1);
        }
        Some((entry, path))
    } else { None };

    let delimiter = if zero_term { 0u8 } else { b'\n' };
    let locale = env
        .get("LC_ALL")
        .or_else(|| env.get("LC_CTYPE"))
        .or_else(|| env.get("LANG"))
        .map(|s| s.as_str())
        .unwrap_or("");
    let byte_locale = locale == "C" || locale == "POSIX";
    let identity_key =
        skip_fields == 0 && skip_chars == 0 && max_chars.is_none() && !ignore_case;

    let compute_key = |bytes: &[u8]| -> Vec<u8> {
        let mut offset = 0usize;
        for _ in 0..skip_fields {
            while offset < bytes.len() && (bytes[offset] == b' ' || bytes[offset] == b'\t') {
                offset += 1;
            }
            while offset < bytes.len() && bytes[offset] != b' ' && bytes[offset] != b'\t' {
                offset += 1;
            }
        }
        let sub = &bytes[offset.min(bytes.len())..];
        let sliced: Vec<u8> = if !byte_locale
            && let Ok(text) = std::str::from_utf8(sub)
        {
            let iter = text.chars().skip(skip_chars);
            let s: String = match max_chars {
                Some(w) => iter.take(w).collect(),
                None => iter.collect(),
            };
            s.into_bytes()
        } else {
            let s_off = skip_chars.min(sub.len());
            let e_off = match max_chars {
                Some(w) => (s_off + w).min(sub.len()),
                None => sub.len(),
            };
            sub[s_off..e_off].to_vec()
        };
        if ignore_case {
            sliced.into_iter().map(|b| b.to_ascii_uppercase()).collect()
        } else {
            sliced
        }
    };

    let expanded = has_all_repeated || group_method.is_some();
    let method = group_method.as_deref().unwrap_or(&repeated_method);
    let mut out_bytes: Vec<u8> = Vec::new();
    let mut previous: Option<Vec<u8>> = None;
    let mut previous_key: Option<Vec<u8>> = None;
    let mut count = 0usize;
    let mut emitted_group = false;

    let selected = |c: usize| -> bool { (!repeated_only || c > 1) && (!unique_only || c == 1) };
    let emit_line = |out: &mut Vec<u8>, line: &[u8], c: usize| {
        if count_flag {
            let prefix = format!("{c:>7} ");
            out.extend_from_slice(prefix.as_bytes());
        }
        out.extend_from_slice(line);
        out.push(delimiter);
    };

    let flush = |out: &mut Vec<u8>| -> Result<(), String> {
        if let Some((entry, path)) = &destination && !out.is_empty() {
            let result = fs.append_file(entry, out);
            out.clear();
            result.map_err(|e| stream_file_error(e, "writeStream", path))?;
        }
        Ok(())
    };
    let result = stdin.read_records(in_name, cwd, fs, false, delimiter, |line| {
        let cur_key = (!identity_key).then(|| compute_key(line));
        if let Some(prev) = previous.as_deref()
            && previous_key.as_deref().unwrap_or(prev) == cur_key.as_deref().unwrap_or(line)
        {
            count += 1;
            if expanded && !unique_only {
                if has_all_repeated && count == 2 {
                    if method == "prepend" || (method == "separate" && emitted_group) {
                        out_bytes.push(delimiter);
                    }
                    emit_line(&mut out_bytes, prev, count);
                    emitted_group = true;
                }
                out_bytes.extend_from_slice(line);
                out_bytes.push(delimiter);
            }
        } else {
            if !expanded
                && let Some(prev) = previous.as_deref()
                && selected(count)
            {
                emit_line(&mut out_bytes, prev, count);
            }
            previous = Some(line.to_vec());
            previous_key = cur_key;
            count = 1;
            if group_method.is_some() {
                if method == "prepend" || method == "both" || emitted_group {
                    out_bytes.push(delimiter);
                }
                emit_line(&mut out_bytes, line, count);
                emitted_group = true;
            }
        }
        if destination.is_some() && out_bytes.len() >= 65536 { flush(&mut out_bytes)?; }
        Ok(())
    });
    if result.is_ok() {
        if !expanded && let Some(prev) = previous && selected(count) {
            emit_line(&mut out_bytes, &prev, count);
        }
        if emitted_group && (method == "append" || method == "both") {
            out_bytes.push(delimiter);
        }
    }
    let result = flush(&mut out_bytes).and(result);
    BuiltinOutcome {
        stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
        exit_code: i32::from(result.is_err()),
        stderr: result.err().map(|e| format!("uniq: {e}\n")).unwrap_or_default(),
    }
}

#[derive(Clone, Copy, Debug)]
struct CutRange {
    start: usize,
    end: usize,
}

fn parse_cut_ranges(list: &str) -> Result<Vec<CutRange>, (String, i32)> {
    let bytes = list.as_bytes();
    let mut ranges: Vec<CutRange> = Vec::new();
    let mut token_start = 0usize;
    let mut dash: Option<usize> = None;
    let mut start: usize = 0;
    let mut end: usize = 0;
    let mut invalid = false;
    let mut needs_range = true;

    for index in 0..=bytes.len() {
        let ch = bytes.get(index).copied();
        if matches!(ch, Some(b',') | Some(b' ') | Some(b'\t') | None) {
            if index == token_start {
                if needs_range && (ch == Some(b',') || ch.is_none()) {
                    return Err(("cut: invalid range ''\n".to_string(), 2));
                }
                if ch == Some(b',') {
                    needs_range = true;
                }
                token_start = index + 1;
                continue;
            }
            let token = &list[token_start..index];
            if invalid || (dash == Some(token_start) && dash == Some(index - 1)) {
                return Err((format!("cut: invalid range '{token}'\n"), 2));
            }
            if dash == Some(token_start) {
                start = 1;
            }
            if dash.is_none() {
                end = start;
            }
            let open_end = dash.is_some() && dash == Some(index - 1);
            if open_end {
                end = usize::MAX;
            }
            if start < 1 {
                return Err((format!("cut: invalid number in '{token}'\n"), 2));
            }
            if !open_end && end < 1 {
                return Err((format!("cut: invalid number in '{token}'\n"), 2));
            }
            if end < start {
                return Err((format!("cut: invalid decreasing range '{token}'\n"), 1));
            }
            ranges.push(CutRange { start, end });
            needs_range = ch == Some(b',');
            token_start = index + 1;
            dash = None;
            start = 0;
            end = 0;
            invalid = false;
        } else if ch == Some(b'-') && dash.is_none() {
            dash = Some(index);
        } else if let Some(b) = ch {
            if b.is_ascii_digit() {
                let digit = (b - b'0') as usize;
                if dash.is_none() {
                    start = start.saturating_mul(10).saturating_add(digit);
                } else {
                    end = end.saturating_mul(10).saturating_add(digit);
                }
            } else {
                invalid = true;
            }
        }
    }
    ranges.sort_by_key(|r| r.start);
    let mut normalized: Vec<CutRange> = Vec::new();
    for r in ranges {
        if let Some(prev) = normalized.last_mut()
            && r.start <= prev.end
        {
            prev.end = prev.end.max(r.end);
        } else {
            normalized.push(r);
        }
    }
    Ok(normalized)
}

fn cmd_cut(
    args: &[String],
    mut stdin: CommandInput,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut mode: Option<char> = None;
    let mut list_spec = String::new();
    let mut raw_delim: Option<String> = None;
    let mut out_delim: Option<String> = None;
    let mut only_delimited = false;
    let mut complement = false;
    let mut zero_term = false;
    let mut files: Vec<String> = Vec::new();
    let mut opts_done = false;
    let mut i = 0usize;

    let mut set_mode = |m: char, spec: String| -> Result<(), String> {
        if mode.is_some() && mode != Some(m) {
            return Err("cut: exactly one byte, character, or field list is required\n".to_string());
        }
        mode = Some(m);
        list_spec = spec;
        Ok(())
    };

    while i < args.len() {
        let a = &args[i];
        if !opts_done && a == "--" {
            opts_done = true;
            i += 1;
            continue;
        }
        if !opts_done && a.starts_with("--") {
            if a == "--complement" {
                complement = true;
            } else if a == "--only-delimited" {
                only_delimited = true;
            } else if a == "--zero-terminated" {
                zero_term = true;
            } else if a == "--output-delimiter" {
                if i + 1 >= args.len() {
                    return err_out("cut: option '--output-delimiter' requires an argument\n", 2);
                }
                out_delim = Some(args[i + 1].clone());
                i += 1;
            } else if let Some(v) = a.strip_prefix("--output-delimiter=") {
                out_delim = Some(v.to_string());
            } else if a == "--bytes" || a == "--characters" || a == "--fields" {
                if i + 1 >= args.len() {
                    return err_out(&format!("cut: option '{a}' requires an argument\n"), 2);
                }
                let m = a.chars().nth(2).unwrap();
                if let Err(msg) = set_mode(m, args[i + 1].clone()) {
                    return err_out(&msg, 2);
                }
                i += 1;
            } else if let Some(v) = a.strip_prefix("--bytes=") {
                if let Err(msg) = set_mode('b', v.to_string()) {
                    return err_out(&msg, 2);
                }
            } else if let Some(v) = a.strip_prefix("--characters=") {
                if let Err(msg) = set_mode('c', v.to_string()) {
                    return err_out(&msg, 2);
                }
            } else if let Some(v) = a.strip_prefix("--fields=") {
                if let Err(msg) = set_mode('f', v.to_string()) {
                    return err_out(&msg, 2);
                }
            } else if a == "--delimiter" {
                if i + 1 >= args.len() {
                    return err_out("cut: option '--delimiter' requires an argument\n", 2);
                }
                raw_delim = Some(args[i + 1].clone());
                i += 1;
            } else if let Some(v) = a.strip_prefix("--delimiter=") {
                raw_delim = Some(v.to_string());
            } else {
                return err_out(&format!("cut: unrecognized option '{a}'\n"), 2);
            }
            i += 1;
            continue;
        }
        if !opts_done && a.starts_with('-') && a.len() > 1 {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut ci = 0usize;
            while ci < chars.len() {
                let ch = chars[ci];
                match ch {
                    's' => only_delimited = true,
                    'z' => zero_term = true,
                    'n' => {}
                    'b' | 'c' | 'f' | 'd' => {
                        let val = if ci + 1 < chars.len() {
                            chars[ci + 1..].iter().collect::<String>()
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            return err_out(
                                &format!("cut: option requires an argument -- '{ch}'\n"),
                                2,
                            );
                        };
                        if ch == 'd' {
                            raw_delim = Some(val);
                        } else if let Err(msg) = set_mode(ch, val) {
                            return err_out(&msg, 2);
                        }
                        break;
                    }
                    _ => return err_out(&format!("cut: invalid option -- '{ch}'\n"), 2),
                }
                ci += 1;
            }
            i += 1;
            continue;
        }
        files.push(a.clone());
        i += 1;
    }

    let Some(active_mode) = mode else {
        return err_out("cut: exactly one byte, character, or field list is required\n", 2);
    };
    if active_mode != 'f' && (raw_delim.is_some() || only_delimited) {
        return err_out("cut: delimiter options require field mode\n", 2);
    }

    let ranges = match parse_cut_ranges(&list_spec) {
        Ok(r) => r,
        Err((msg, code)) => return err_out(&msg, code),
    };

    let delim_str = raw_delim.as_deref().unwrap_or("\t");
    let separator: Vec<u8> = if delim_str.is_empty() {
        vec![0u8]
    } else {
        let mut ch_iter = delim_str.chars();
        let first_ch = ch_iter.next().unwrap();
        if ch_iter.next().is_some() {
            return err_out("cut: delimiter must be a single character\n", 2);
        }
        let code = first_ch as u32;
        if (0xE080..=0xE0FF).contains(&code) {
            vec![(code - 0xE000) as u8]
        } else {
            let mut buf = [0u8; 4];
            first_ch.encode_utf8(&mut buf).as_bytes().to_vec()
        }
    };

    let output_delim_bytes: Vec<u8> = match out_delim {
        None => separator.clone(),
        Some(ref s) if s.is_empty() => vec![0u8],
        Some(ref s) => crate::vfs::stream_string_to_bytes(s),
    };

    let locale = env
        .get("LC_ALL")
        .or_else(|| env.get("LC_CTYPE"))
        .or_else(|| env.get("LANG"))
        .map(|s| s.as_str())
        .unwrap_or("");
    let byte_selection =
        active_mode == 'b' || (active_mode == 'c' && (locale == "C" || locale == "POSIX"));
    let record_delim = if zero_term { 0u8 } else { b'\n' };
    let names: Vec<String> = if files.is_empty() {
        vec!["-".to_string()]
    } else {
        files
    };

    let mut out_bytes: Vec<u8> = Vec::new();
    let mut stderr = String::new();
    let mut exit_code = 0;

    let find_sep = |record: &[u8], start: usize| -> Option<usize> {
        if separator.len() == 1 {
            record[start..]
                .iter()
                .position(|&b| b == separator[0])
                .map(|p| start + p)
        } else {
            record[start..]
                .windows(separator.len())
                .position(|w| w == separator.as_slice())
                .map(|p| start + p)
        }
    };

    let mut emit = |line_bytes: &[u8]| {
        let mut cursor = 0usize;
        let selected = |position: usize, cursor: &mut usize| -> isize {
            while *cursor < ranges.len() && position > ranges[*cursor].end {
                *cursor += 1;
            }
            let included = *cursor < ranges.len() && position >= ranges[*cursor].start;
            if included != complement {
                *cursor as isize
            } else {
                -1
            }
        };

        if active_mode == 'f' {
            let mut boundary = find_sep(line_bytes, 0);
            if boundary.is_none() {
                if only_delimited {
                    return Ok(());
                }
                out_bytes.extend_from_slice(line_bytes);
            } else {
                let mut field = 1usize;
                let mut start = 0usize;
                let mut emitted = false;
                loop {
                    if selected(field, &mut cursor) >= 0 {
                        if emitted {
                            out_bytes.extend_from_slice(&output_delim_bytes);
                        }
                        let end = boundary.unwrap_or(line_bytes.len());
                        out_bytes.extend_from_slice(&line_bytes[start..end]);
                        emitted = true;
                    }
                    field += 1;
                    if boundary.is_none() || (!complement && cursor >= ranges.len()) {
                        break;
                    }
                    start = boundary.unwrap() + separator.len();
                    boundary = if start <= line_bytes.len() {
                        find_sep(line_bytes, start)
                    } else {
                        None
                    };
                }
            }
        } else if byte_selection {
            let mut emitted = false;
            let mut previous_range: isize = -1;
            for (index, &b) in line_bytes.iter().enumerate() {
                let range = selected(index + 1, &mut cursor);
                if range >= 0 {
                    if range != previous_range && emitted && out_delim.is_some() {
                        out_bytes.extend_from_slice(&output_delim_bytes);
                    }
                    out_bytes.push(b);
                    emitted = true;
                }
                previous_range = range;
            }
        } else {
            let text = String::from_utf8_lossy(line_bytes);
            let mut emitted = false;
            let mut previous_range: isize = -1;
            for (index, ch) in text.chars().enumerate() {
                let range = selected(index + 1, &mut cursor);
                if range >= 0 {
                    if range != previous_range && emitted && out_delim.is_some() {
                        out_bytes.extend_from_slice(&output_delim_bytes);
                    }
                    let mut buf = [0u8; 4];
                    out_bytes.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                    emitted = true;
                }
                previous_range = range;
            }
        }
        out_bytes.push(record_delim);
        Ok(())
    };
    for name in &names {
        if let Err(e) = stdin.read_records(name, cwd, fs, false, record_delim, &mut emit) {
            stderr.push_str(&format!("cut: {e}\n"));
            exit_code = 1;
        }
    }

    BuiltinOutcome {
        stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
        stderr,
        exit_code,
    }
}

struct TrSet {
    bytes: Vec<u8>,
    case_offsets: BTreeSet<usize>,
    ends_with_class: bool,
}

fn tr_class_bytes(name: &str) -> Option<Vec<u8>> {
    match name {
        "lower" => Some((b'a'..=b'z').collect()),
        "upper" => Some((b'A'..=b'Z').collect()),
        "digit" => Some((b'0'..=b'9').collect()),
        "space" => Some(vec![9, 10, 11, 12, 13, 32]),
        "blank" => Some(vec![9, 32]),
        "cntrl" => {
            let mut v: Vec<u8> = (0..32).collect();
            v.push(127);
            Some(v)
        }
        "graph" => Some((33..=126).collect()),
        "print" => Some((32..=126).collect()),
        "alpha" => {
            let mut v: Vec<u8> = (b'A'..=b'Z').collect();
            v.extend(b'a'..=b'z');
            Some(v)
        }
        "alnum" => {
            let mut v: Vec<u8> = (b'0'..=b'9').collect();
            v.extend(b'A'..=b'Z');
            v.extend(b'a'..=b'z');
            Some(v)
        }
        "xdigit" => {
            let mut v: Vec<u8> = (b'0'..=b'9').collect();
            v.extend(b'A'..=b'F');
            v.extend(b'a'..=b'f');
            Some(v)
        }
        "punct" => Some(
            (33..=126u8)
                .filter(|b| !b.is_ascii_alphanumeric())
                .collect(),
        ),
        _ => None,
    }
}

fn parse_tr_character_set(
    specification: &str,
    repeat_length: Option<usize>,
    translating_second: bool,
) -> Result<TrSet, (String, i32)> {
    #[derive(Clone)]
    struct TrToken {
        bytes: Vec<u8>,
        literal: bool,
        repeat: Option<usize>,
        class_name: Option<String>,
    }

    let read_char = |offset: usize| -> (Vec<u8>, usize, bool) {
        let rest = &specification[offset..];
        let mut ch_iter = rest.chars();
        let first = ch_iter.next().unwrap();
        if first == '\\' {
            let start = offset + 1;
            if start >= specification.len() {
                return (vec![b'\\'], start, false);
            }
            let after = specification.as_bytes();
            let mut end = start;
            while end < after.len()
                && end - start < 3
                && (b'0'..=b'7').contains(&after[end])
            {
                end += 1;
            }
            if end > start {
                if end - start == 3 && after[start] >= b'4' {
                    end -= 1;
                }
                let val = u8::from_str_radix(&specification[start..end], 8).unwrap_or(0);
                return (vec![val], end, false);
            }
            let next_ch = specification[start..].chars().next().unwrap();
            let next_end = start + next_ch.len_utf8();
            let ctrl = match next_ch {
                'a' => Some(7u8),
                'b' => Some(8u8),
                'f' => Some(12u8),
                'n' => Some(10u8),
                'r' => Some(13u8),
                't' => Some(9u8),
                'v' => Some(11u8),
                '\\' => Some(92u8),
                _ => None,
            };
            if let Some(b) = ctrl {
                return (vec![b], next_end, false);
            }
            let code = next_ch as u32;
            let bytes = if (0xE080..=0xE0FF).contains(&code) {
                vec![(code - 0xE000) as u8]
            } else {
                let mut buf = [0u8; 4];
                next_ch.encode_utf8(&mut buf).as_bytes().to_vec()
            };
            return (bytes, next_end, false);
        }
        let end = offset + first.len_utf8();
        let code = first as u32;
        let bytes = if (0xE080..=0xE0FF).contains(&code) {
            vec![(code - 0xE000) as u8]
        } else {
            let mut buf = [0u8; 4];
            first.encode_utf8(&mut buf).as_bytes().to_vec()
        };
        (bytes, end, first == '-')
    };

    let mut tokens: Vec<TrToken> = Vec::new();
    let mut offset = 0usize;
    while offset < specification.len() {
        if specification[offset..].starts_with("[:")
            && let Some(rel_end) = specification[offset + 2..].find(":]")
        {
            let class_end = offset + 2 + rel_end;
            let first_bracket = specification[offset + 2..].find(']').map(|p| offset + 2 + p);
            if first_bracket == Some(class_end + 1) {
                let name = &specification[offset + 2..class_end];
                let Some(bytes) = tr_class_bytes(name) else {
                    return Err((format!("tr: unknown character class '{name}'\n"), 2));
                };
                if translating_second && name != "upper" && name != "lower" {
                    return Err((
                        "tr: when translating, the only character classes that may appear in string2 are 'upper' and 'lower'\n".to_string(),
                        1,
                    ));
                }
                tokens.push(TrToken {
                    bytes,
                    literal: false,
                    repeat: None,
                    class_name: Some(name.to_string()),
                });
                offset = class_end + 2;
                continue;
            }
        }
        if specification.as_bytes()[offset] == b'[' && offset + 1 < specification.len() {
            let equivalent = specification.as_bytes()[offset + 1] == b'=';
            let char_offset = offset + 1;
            let (ch_bytes, ch_end, _) = read_char(char_offset);
            if equivalent && offset + 2 < specification.len() {
                let (mem_bytes, mem_end, _) = read_char(offset + 2);
                if specification[mem_end..].starts_with("=]") {
                    if mem_bytes.len() != 1 {
                        return Err(("tr: equivalence expression requires one byte\n".to_string(), 2));
                    }
                    tokens.push(TrToken {
                        bytes: mem_bytes,
                        literal: false,
                        repeat: None,
                        class_name: None,
                    });
                    offset = mem_end + 2;
                    continue;
                }
            }
            if ch_end < specification.len()
                && specification.as_bytes()[ch_end] == b'*'
                && let Some(rel_close) = specification[ch_end + 1..].find(']')
            {
                let end = ch_end + 1 + rel_close;
                let count_str = &specification[ch_end + 1..end];
                let is_octal = count_str.starts_with('0');
                let valid_digits = count_str.bytes().all(|b| {
                    if is_octal {
                        (b'0'..=b'7').contains(&b)
                    } else {
                        b.is_ascii_digit()
                    }
                });
                if ch_bytes.len() != 1 || !valid_digits {
                    return Err(("tr: invalid repeat expression\n".to_string(), 2));
                }
                let parsed_repeat = if count_str.is_empty() {
                    0usize
                } else {
                    usize::from_str_radix(count_str, if is_octal { 8 } else { 10 }).unwrap_or(usize::MAX)
                };
                if parsed_repeat == 0 && repeat_length.is_none() {
                    return Err((
                        "tr: the [c*] construct may appear in string2 only when translating\n"
                            .to_string(),
                        2,
                    ));
                }
                let repeat = if parsed_repeat > 0 {
                    parsed_repeat.min(repeat_length.map(|r| r.max(1)).unwrap_or(65536))
                } else {
                    0
                };
                tokens.push(TrToken {
                    bytes: ch_bytes,
                    literal: false,
                    repeat: Some(repeat),
                    class_name: None,
                });
                offset = end + 1;
                continue;
            }
        }
        let (ch_bytes, ch_end, ch_lit) = read_char(offset);
        tokens.push(TrToken {
            bytes: ch_bytes,
            literal: ch_lit,
            repeat: None,
            class_name: None,
        });
        offset = ch_end;
    }

    let mut expanded: Vec<TrToken> = Vec::new();
    let mut idx = 0usize;
    while idx < tokens.len() {
        let current = &tokens[idx];
        if current.repeat.is_none()
            && current.bytes.len() == 1
            && idx + 2 < tokens.len()
            && tokens[idx + 1].literal
            && tokens[idx + 2].repeat.is_none()
            && tokens[idx + 2].bytes.len() == 1
        {
            let first = current.bytes[0];
            let last = tokens[idx + 2].bytes[0];
            if last < first {
                return Err(("tr: range endpoints are in reverse order\n".to_string(), 2));
            }
            expanded.push(TrToken {
                bytes: (first..=last).collect(),
                literal: false,
                repeat: None,
                class_name: None,
            });
            idx += 3;
        } else {
            expanded.push(current.clone());
            idx += 1;
        }
    }

    let fills = expanded.iter().filter(|t| t.repeat == Some(0)).count();
    if fills > 1 {
        return Err(("tr: only one indefinite repeat expression is allowed\n".to_string(), 2));
    }
    let length: usize = expanded
        .iter()
        .map(|t| t.repeat.unwrap_or(t.bytes.len()))
        .sum();
    let mut result: Vec<u8> = Vec::new();
    let mut case_offsets: BTreeSet<usize> = BTreeSet::new();
    for token in &expanded {
        if matches!(token.class_name.as_deref(), Some("upper") | Some("lower")) {
            case_offsets.insert(result.len());
        }
        match token.repeat {
            None => result.extend_from_slice(&token.bytes),
            Some(rep) => {
                let count = if rep > 0 {
                    rep
                } else {
                    repeat_length.unwrap_or(0).saturating_sub(length)
                };
                result.extend(std::iter::repeat_n(token.bytes[0], count));
            }
        }
    }
    let ends_with_class = expanded
        .last()
        .and_then(|t| t.class_name.as_ref())
        .is_some();
    Ok(TrSet {
        bytes: result,
        case_offsets,
        ends_with_class,
    })
}

fn cmd_tr(args: &[String], mut stdin: CommandInput, write: &mut super::CommandWriter) -> BuiltinOutcome {
    let mut deleting = false;
    let mut squeezing = false;
    let mut complement = false;
    let mut truncate_set1 = false;
    let mut operands: Vec<String> = Vec::new();
    let mut opts_done = false;
    for a in args {
        if !opts_done && a == "--" {
            opts_done = true;
            continue;
        }
        if !opts_done && a.starts_with("--") {
            match a.as_str() {
                "--delete" => deleting = true,
                "--squeeze-repeats" => squeezing = true,
                "--complement" => complement = true,
                "--truncate-set1" => truncate_set1 = true,
                _ => return err_out(&format!("tr: unrecognized option '{a}'\n"), 2),
            }
            continue;
        }
        if !opts_done && a.starts_with('-') && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    'd' => deleting = true,
                    's' => squeezing = true,
                    'c' | 'C' => complement = true,
                    't' => truncate_set1 = true,
                    _ => return err_out(&format!("tr: invalid option -- '{ch}'\n"), 2),
                }
            }
            continue;
        }
        operands.push(a.clone());
    }

    let translating = !deleting && operands.len() == 2;
    if operands.is_empty()
        || operands.len() > 2
        || (!deleting && !squeezing && operands.len() != 2)
        || (deleting && !squeezing && operands.len() != 1)
        || (deleting && squeezing && operands.len() != 2)
    {
        return err_out("tr: invalid number of character sets\n", 2);
    }

    let first_set = match parse_tr_character_set(&operands[0], None, false) {
        Ok(s) => s,
        Err((msg, code)) => return err_out(&msg, code),
    };
    let mut first = first_set.bytes;
    let mut first_case_offsets = first_set.case_offsets;
    if complement {
        let selected: BTreeSet<u8> = first.into_iter().collect();
        first = (0..=255u8).filter(|b| !selected.contains(b)).collect();
        first_case_offsets.clear();
    }

    let second_set = if let Some(op2) = operands.get(1) {
        match parse_tr_character_set(
            op2,
            if translating { Some(first.len()) } else { None },
            translating,
        ) {
            Ok(s) => s,
            Err((msg, code)) => return err_out(&msg, code),
        }
    } else {
        TrSet {
            bytes: Vec::new(),
            case_offsets: BTreeSet::new(),
            ends_with_class: false,
        }
    };
    let second = second_set.bytes;

    if translating {
        if !truncate_set1 && second_set.ends_with_class && first.len() > second.len() {
            return err_out(
                "tr: when translating with string1 longer than string2, the latter string must not end with a character class\n",
                1,
            );
        }
        for offset in &second_set.case_offsets {
            if !first_case_offsets.contains(offset) {
                return err_out("tr: misaligned [:upper:] and/or [:lower:] construct\n", 1);
            }
        }
    }
    if translating && truncate_set1 && first.len() > second.len() {
        first.truncate(second.len());
    }
    if translating && second.is_empty() && !truncate_set1 {
        return err_out("tr: second character set must not be empty\n", 2);
    }

    let mut mapping = [0u8; 256];
    for i in 0..256 {
        mapping[i] = i as u8;
    }
    if translating && !second.is_empty() {
        for (idx, &b) in first.iter().enumerate() {
            mapping[b as usize] = second[idx.min(second.len() - 1)];
        }
    }
    let mut removed = [false; 256];
    if deleting {
        for &b in &first {
            removed[b as usize] = true;
        }
    }
    let mut squeezed = [false; 256];
    if squeezing {
        let sq_source = if operands.len() == 2 { &second } else { &first };
        for &b in sq_source {
            squeezed[b as usize] = true;
        }
    }

    let mut out_bytes = Vec::new();
    let mut out = ok_out("");
    let mut prev_out = None;
    let result = stdin.read_stdin(|chunk| {
        out_bytes.clear();
        for &b in chunk {
            if removed[b as usize] { continue; }
            let mapped = mapping[b as usize];
            if squeezed[mapped as usize] && prev_out == Some(mapped) { continue; }
            prev_out = Some(mapped);
            out_bytes.push(mapped);
        }
        write(1, &crate::vfs::bytes_to_stream_string(&out_bytes), &mut out)
    });
    if let Err(e) = result {
        out.exit_code = 1;
        write(2, &format!("tr: {e}\n"), &mut out);
    }
    out
}

fn validate_nl_style(s: &str) -> Result<(), String> {
    if s == "a" || s == "t" || s == "n" || s.starts_with('p') {
        Ok(())
    } else {
        Err(format!("nl: invalid numbering style: '{s}'\n"))
    }
}

fn parse_nl_signed(s: &str) -> Result<i64, String> {
    let t = s.trim();
    let digits = t.strip_prefix(['+', '-']).unwrap_or(t);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("nl: invalid line number: '{s}'\n"));
    }
    t.parse().map_err(|_| format!("nl: line number out of range: '{s}'\n"))
}

fn cmd_nl(args: &[String], mut stdin: CommandInput, cwd: &str, fs: &dyn SafeBashFs, write: &mut super::CommandWriter) -> BuiltinOutcome {
    let mut values = BTreeMap::new();
    let mut no_renumber = false;
    let mut default_delim = [b'\\', b':'];
    let mut delim_bytes = default_delim.to_vec();
    let mut files = Vec::new();
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        if arg == "--" { files.extend(args.cloned()); break; }
        let (key, value) = if let Some(long) = arg.strip_prefix("--") {
            let (name, inline) = long.split_once('=').map_or((long, None), |(n, v)| (n, Some(v)));
            let key = match name {
                "no-renumber" => {
                    if inline.is_some() { return err_out("nl: option '--no-renumber' does not take an argument\n", 1); }
                    no_renumber = true;
                    continue;
                }
                "header-numbering" => 'h', "body-numbering" => 'b', "footer-numbering" => 'f',
                "starting-line-number" => 'v', "line-increment" => 'i', "join-blank-lines" => 'l',
                "number-separator" => 's', "number-width" => 'w', "number-format" => 'n', "section-delimiter" => 'd',
                _ => return err_out(&format!("nl: unrecognized option '{arg}'\n"), 1),
            };
            let Some(value) = inline.or_else(|| args.next().map(String::as_str)) else {
                return err_out(&format!("nl: option '--{name}' requires an argument\n"), 1);
            };
            (key, value)
        } else if let Some(short) = arg.strip_prefix('-').filter(|s| !s.is_empty()) {
            let tail = short.trim_start_matches('p');
            no_renumber |= tail.len() != short.len();
            let mut chars = tail.chars();
            let Some(key) = chars.next() else { continue; };
            if !"hbfvilswnd".contains(key) { return err_out(&format!("nl: invalid option -- '{key}'\n"), 1); }
            let value = if chars.as_str().is_empty() {
                let Some(value) = args.next() else { return err_out(&format!("nl: option requires an argument -- '{key}'\n"), 1); };
                value.as_str()
            } else { chars.as_str() };
            (key, value)
        } else { files.push(arg.clone()); continue; };
        if key == 'd' {
            let next = stream_string_to_bytes(value);
            if matches!(next.len(), 1 | 2) {
                default_delim[..next.len()].copy_from_slice(&next);
                delim_bytes = default_delim.to_vec();
            } else { delim_bytes = next; }
        } else { values.insert(key, value); }
    }
    let header_style = *values.get(&'h').unwrap_or(&"n");
    let body_style = *values.get(&'b').unwrap_or(&"t");
    let footer_style = *values.get(&'f').unwrap_or(&"n");
    for st in [header_style, body_style, footer_style] {
        if let Err(msg) = validate_nl_style(st) { return err_out(&msg, 1); }
    }
    let start_num = match parse_nl_signed(values.get(&'v').unwrap_or(&"1")) { Ok(n) => n, Err(e) => return err_out(&e, 1) };
    let incr = match parse_nl_signed(values.get(&'i').unwrap_or(&"1")) { Ok(n) => n, Err(e) => return err_out(&e, 1) };
    const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;
    let integer = |key, default, minimum| {
        let text = *values.get(&key).unwrap_or(&default);
        text.parse::<u64>().ok().filter(|n| (minimum..=MAX_SAFE_INTEGER).contains(n))
            .ok_or_else(|| err_out(&format!("nl: invalid number '{text}'\n"), 1))
    };
    let join_blanks = match integer('l', "1", 0) { Ok(n) => n.max(1), Err(e) => return e };
    let width = match integer('w', "6", 1) { Ok(n) => n, Err(e) => return e };
    let num_fmt = *values.get(&'n').unwrap_or(&"rn");
    let sep = values.get(&'s').unwrap_or(&"\t");
    if !matches!(num_fmt, "ln" | "rn" | "rz") {
        return err_out(&format!("nl: invalid line numbering format: '{num_fmt}'\n"), 1);
    }

    let targets: Vec<String> = if files.is_empty() {
        vec!["-".to_string()]
    } else {
        files
    };
    let sep_bytes = crate::vfs::stream_string_to_bytes(sep);
    if width + sep_bytes.len() as u64 > MAX_SAFE_INTEGER { return err_out("nl: EFBIG: stream-format number field limit exceeded\n", 1); }
    let d1 = delim_bytes.as_slice();
    let d2 = delim_bytes.repeat(2);
    let d3 = delim_bytes.repeat(3);
    let mut style = body_style;
    let mut n = Some(start_num);
    let mut blanks = 0u64;
    let mut out = ok_out("");
    let mut first = true;
    for name in &targets {
        let mut pending = Vec::new();
        let mut batch = Vec::new();
        let mut writable = true;
        let mut overflow = false;
        let mut consume = |chunk: &[u8], eof: bool| {
            let mut flush = |batch: &mut Vec<u8>| {
                let ok = batch.is_empty() || write(1, &crate::vfs::bytes_to_stream_string(batch), &mut out);
                batch.clear();
                ok
            };
            let mut emit = |line: &[u8]| {
                let next = if d1.is_empty() { None } else if line == d3 { Some(header_style) }
                    else if line == d2 { Some(body_style) } else if line == d1 { Some(footer_style) } else { None };
                if let Some(next) = next {
                    style = next;
                    if !no_renumber { n = Some(start_num); }
                } else {
                    let numbered = match style {
                        "a" => {
                            if line.is_empty() { blanks += 1; }
                            let number = !line.is_empty() || blanks == join_blanks;
                            if number { blanks = 0; }
                            number
                        }
                        "t" => !line.is_empty(),
                        "n" => false,
                        pattern => crate::commands::search::ZeroRegex::new(vec![pattern[1..].into()], false, false, false, false)
                            .is_match(&crate::vfs::bytes_to_stream_string(line)),
                    };
                    let mut label = String::new();
                    if numbered {
                        let Some(value) = n else { overflow = true; return false; };
                        label = value.to_string();
                        n = value.checked_add(incr);
                    }
                    let mut padding = if numbered { width.saturating_sub(label.len() as u64) } else { width + sep_bytes.len() as u64 };
                    let pad_byte = if numbered && num_fmt == "rz" { b'0' } else { b' ' };
                    let mut label = label.as_bytes();
                    if numbered && num_fmt == "ln" { batch.extend_from_slice(label); label = &[]; }
                    if pad_byte == b'0' && label.starts_with(b"-") { batch.push(b'-'); label = &label[1..]; }
                    while padding > 0 {
                        let count = padding.min((16384 - batch.len()) as u64) as usize;
                        batch.resize(batch.len() + count, pad_byte);
                        padding -= count as u64;
                        if batch.len() == 16384 && !flush(&mut batch) { writable = false; return false; }
                    }
                    batch.extend_from_slice(label);
                    if numbered { batch.extend_from_slice(&sep_bytes); }
                    batch.extend_from_slice(line);
                }
                batch.push(b'\n');
                if first || batch.len() >= 8192 {
                    first = false;
                    writable = flush(&mut batch);
                }
                writable
            };
            let more = if eof { pending.is_empty() || emit(&pending) }
                else { visit_complete_records(chunk, |b| b == b'\n', &mut pending, &mut emit) };
            if writable { writable = flush(&mut batch); }
            more && writable
        };
        let read = stdin.read_operand(name, cwd, fs, true, |chunk| consume(chunk, false));
        if read.is_ok() { consume(&[], true); }
        if !writable { break; }
        if overflow {
            out.exit_code = 1;
            write(2, "nl: line number overflow\n", &mut out);
            break;
        }
        if let Err(e) = read {
            out.exit_code = 1;
            if !write(2, &format!("nl: {e}\n"), &mut out) { break; }
        }
    }
    out
}

fn cmd_tac(args: &[String], mut stdin: CommandInput, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut sep: Option<String> = None;
    let mut before = false;
    let mut regex_mode = false;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "--" {
            files.extend(args[i + 1..].iter().cloned());
            break;
        } else if a == "-b" || a == "--before" {
            before = true;
            i += 1;
        } else if a == "-r" || a == "--regex" {
            regex_mode = true;
            i += 1;
        } else if a == "-s" || a == "--separator" {
            if i + 1 >= args.len() {
                if a == "-s" {
                    return err_out("tac: option requires an argument -- 's'\n", 1);
                }
                return err_out("tac: option '--separator' requires an argument\n", 1);
            }
            sep = Some(args[i + 1].clone());
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--separator=") {
            sep = Some(rest.to_string());
            i += 1;
        } else if a.starts_with("--") {
            return err_out(&format!("tac: unrecognized option '{a}'\n"), 1);
        } else if a.starts_with('-') && a.len() > 1 {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut ci = 0usize;
            while ci < chars.len() {
                match chars[ci] {
                    'b' => {
                        before = true;
                        ci += 1;
                    }
                    'r' => {
                        regex_mode = true;
                        ci += 1;
                    }
                    's' => {
                        let inline: String = chars[ci + 1..].iter().collect();
                        if !inline.is_empty() {
                            sep = Some(inline);
                        } else if i + 1 < args.len() {
                            i += 1;
                            sep = Some(args[i].clone());
                        } else {
                            return err_out("tac: option requires an argument -- 's'\n", 1);
                        }
                        break;
                    }
                    c => return err_out(&format!("tac: invalid option -- '{c}'\n"), 1),
                }
            }
            i += 1;
        } else {
            files.push(a.clone());
            i += 1;
        }
    }
    let sep_bytes: Vec<u8> = match sep.as_deref() {
        Some("") => vec![0u8],
        Some(s) => crate::vfs::stream_string_to_bytes(s),
        None => vec![b'\n'],
    };
    // Reverse KMP finds the rightmost non-overlapping separators in one pass,
    // even when a long separator shares a prefix with every input position.
    let mut prefix = Vec::new();
    if !regex_mode && sep_bytes.len() > 1 {
        prefix.resize(sep_bytes.len(), 0);
        let mut matched = 0;
        for i in 1..sep_bytes.len() {
            let byte = sep_bytes[sep_bytes.len() - 1 - i];
            while matched != 0 && byte != sep_bytes[sep_bytes.len() - 1 - matched] { matched = prefix[matched - 1]; }
            matched += usize::from(byte == sep_bytes[sep_bytes.len() - 1 - matched]);
            prefix[i] = matched;
        }
    }
    let targets: Vec<String> = if files.is_empty() {
        vec!["-".to_string()]
    } else {
        files
    };
    let mut out_bytes: Vec<u8> = Vec::new();
    let mut stderr = String::new();
    let mut exit_code = 0;
    for f in &targets {
        let mut bytes = Vec::new();
        if let Err(e) = stdin.read_operand(f, cwd, fs, true, |chunk| { bytes.extend_from_slice(chunk); true }) {
            stderr.push_str(&format!("tac: {e}\n"));
            exit_code = 1;
            continue;
        }
        if regex_mode {
            if let Err(error) = tac_regex::reverse(&sep_bytes, &bytes, before, &mut out_bytes) {
                stderr.push_str(&format!("tac: {error}\n"));
                exit_code = 1;
            }
        } else {
            let mut end = bytes.len();
            let mut matched = 0;
            for (index, &byte) in bytes.iter().enumerate().rev() {
                while matched != 0 && byte != sep_bytes[sep_bytes.len() - 1 - matched] { matched = prefix[matched - 1]; }
                matched += usize::from(byte == sep_bytes[sep_bytes.len() - 1 - matched]);
                if matched == sep_bytes.len() {
                    let boundary = if before { index } else { index + matched };
                    out_bytes.extend_from_slice(&bytes[boundary..end]);
                    end = boundary;
                    matched = 0;
                }
            }
            out_bytes.extend_from_slice(&bytes[0..end]);
        }
    }
    BuiltinOutcome {
        stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
        stderr,
        exit_code,
    }
}

fn cmd_rev(
    args: &[String],
    mut stdin: CommandInput,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
    write: &mut super::CommandWriter,
) -> BuiltinOutcome {
    let mut files = Vec::new();
    let mut opts_done = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if !opts_done && a == "--" {
            opts_done = true;
            i += 1;
            continue;
        }
        if !opts_done && a.starts_with("--") {
            return err_out(&format!("rev: unrecognized option '{a}'\n"), 1);
        }
        if !opts_done && a.starts_with('-') && a.len() > 1 {
            let ch = a[1..].chars().next().unwrap_or('-');
            return err_out(&format!("rev: invalid option -- '{ch}'\n"), 1);
        }
        opts_done = true;
        files.push(a.clone());
        i += 1;
    }
    let locale = env
        .get("LC_ALL")
        .filter(|s| !s.is_empty())
        .or_else(|| env.get("LC_CTYPE").filter(|s| !s.is_empty()))
        .or_else(|| env.get("LANG").filter(|s| !s.is_empty()))
        .map(|s| s.as_str())
        .unwrap_or("C");
    let lower_loc = locale.to_ascii_lowercase();
    let utf8 = lower_loc.match_indices("utf").any(|(i, _)| {
        if i != 0 && !lower_loc[..i].ends_with(['.', '_', '-']) { return false; }
        let suffix = &lower_loc[i + 3..];
        suffix.strip_prefix("-8").or_else(|| suffix.strip_prefix('8')).is_some_and(|tail|
            tail.is_empty() || (tail.starts_with('@') && !tail.contains(['\r', '\n', '\u{2028}', '\u{2029}'])))
    });
    if !utf8 && locale != "C" && locale != "POSIX" {
        return err_out(
            &format!("rev: unsupported character encoding locale: '{locale}'\n"),
            1,
        );
    }

    let mut out = ok_out("");
    let from_stdin = files.is_empty();
    if from_stdin { files.push("stdin".into()); }
    for name in files {
        let mut pending = Vec::new();
        let mut output = Vec::new();
        let mut writable = true;
        let mut valid = true;
        let mut consume = |chunk: &[u8], eof: bool| {
            let mut reverse = |record: &[u8], terminated: bool| {
                if utf8 {
                    let text = match std::str::from_utf8(record) {
                        Ok(text) => text,
                        Err(e) => {
                            valid = false;
                            std::str::from_utf8(&record[..e.valid_up_to()]).unwrap()
                        }
                    };
                    for ch in text.chars().rev() {
                        output.extend_from_slice(ch.encode_utf8(&mut [0; 4]).as_bytes());
                    }
                    if valid && terminated || !valid && !text.is_empty() { output.push(b'\n'); }
                } else {
                    output.extend(record.iter().rev());
                    if terminated { output.push(b'\n'); }
                }
                let mut blocks = output.chunks_exact(16384);
                for block in &mut blocks {
                    writable = write(1, &crate::vfs::bytes_to_stream_string(block), &mut out);
                    if !writable { return false; }
                }
                let rest = blocks.remainder().len();
                if rest < output.len() {
                    let start = output.len() - rest;
                    output.copy_within(start.., 0);
                    output.truncate(rest);
                }
                valid
            };
            if eof {
                if !pending.is_empty() { reverse(&pending, false); }
            } else {
                visit_complete_records(chunk, |b| b == b'\n', &mut pending, |record| reverse(record, true));
            }
            if writable && !valid {
                out.exit_code = 1;
                writable = write(2, &format!("rev: {name}: Illegal byte sequence\n"), &mut out);
            }
            if writable && !output.is_empty() {
                writable = write(1, &crate::vfs::bytes_to_stream_string(&output), &mut out);
                output.clear();
            }
            writable && valid
        };
        let read = if from_stdin {
            let mut more = true;
            let read = stdin.read_stdin(|chunk| {
                more = consume(chunk, false);
                more
            });
            if more && read.is_ok() { consume(&[], true); }
            read
        } else {
            record_input_path(&name, cwd, fs, true).and_then(|(path, entry)| {
                let bytes = fs.read_file(&entry).map_err(|e| stream_file_error(e, "readStream", &path))?;
                if bytes.chunks(65536).all(|chunk| consume(chunk, false)) { consume(&[], true); }
                Ok(())
            })
        };
        if !writable { break; }
        if let Err(e) = read {
            out.exit_code = 1;
            if !write(2, &format!("rev: {e}\n"), &mut out) { break; }
        }
    }
    out
}

fn parse_paste_delimiters(text: &str) -> Result<Vec<Vec<u8>>, String> {
    let chars: Vec<char> = text.chars().collect();
    let mut result: Vec<Vec<u8>> = Vec::new();
    let mut i = 0usize;
    while i < chars.len() {
        let ch = chars[i];
        if ch == '\\' {
            if i + 1 >= chars.len() {
                return Err("paste: EINVAL: delimiter list ends in an unescaped backslash\n".to_string());
            }
            i += 1;
            let esc = chars[i];
            if esc == '0' {
                result.push(Vec::new());
                i += 1;
                continue;
            }
            let mapped = match esc {
                'b' => vec![b'\x08'],
                'f' => vec![b'\x0c'],
                'n' => vec![b'\n'],
                'r' => vec![b'\r'],
                't' => vec![b'\t'],
                'v' => vec![b'\x0b'],
                '\\' => vec![b'\\'],
                other => crate::vfs::stream_string_to_bytes(&other.to_string()),
            };
            result.push(mapped);
        } else {
            result.push(crate::vfs::stream_string_to_bytes(&ch.to_string()));
        }
        i += 1;
    }
    if result.is_empty() {
        result.push(Vec::new());
    }
    Ok(result)
}

#[derive(Default)]
struct TableReader<'a> {
    file: Option<crate::vfs::ChunkReader<'a>>,
    chunk: Vec<u8>,
    offset: usize,
    eof: bool,
}

impl<'a> TableReader<'a> {
    fn open(name: &str, cwd: &str, fs: &'a dyn SafeBashFs) -> Result<Self, String> {
        if name == "-" { return Ok(Self::default()); }
        let (path, entry) = record_input_path(name, cwd, fs, true)?;
        let mut reader = None;
        let file: crate::vfs::ChunkReader = Box::new(move |chunk| {
            let next = match &mut reader {
                Some(next) => next,
                None => reader.insert(fs.open_chunks(&entry).map_err(|e| stream_file_error(e, "readStream", &path))?),
            };
            next(chunk).map_err(|e| stream_file_error(e, "readStream", &path))
        });
        Ok(Self { file: Some(file), ..Self::default() })
    }

    fn next(&mut self, stdin: &mut CommandInput, delimiter: u8, record: &mut Vec<u8>,
        available: &mut usize, fs: &dyn SafeBashFs,
    ) -> Result<bool, String> {
        record.clear();
        while !self.eof {
            if self.offset == self.chunk.len() {
                if let Some(read) = &mut self.file { read(&mut self.chunk)?; }
                else { stdin.next_stdin_chunk(&mut self.chunk)?; }
                self.offset = 0;
                *available = available.checked_sub(self.chunk.len()).ok_or_else(|| fs.limit_error("maxInputBytes", fs.max_input_bytes()))?;
                if self.chunk.is_empty() { self.eof = true; break; }
            }
            let tail = &self.chunk[self.offset..];
            if let Some(end) = tail.iter().position(|&b| b == delimiter) {
                record.extend_from_slice(&tail[..end]);
                self.offset += end + 1;
                return Ok(true);
            }
            record.extend_from_slice(tail);
            self.offset = self.chunk.len();
        }
        Ok(!record.is_empty())
    }
}

fn cmd_paste(args: &[String], mut stdin: CommandInput, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut delims: Vec<Vec<u8>> = vec![vec![b'\t']];
    let mut serial = false;
    let mut sep_byte = b'\n';
    let mut files = Vec::new();
    let mut literal = false;
    let mut i = 0usize;

    while i < args.len() {
        let token = &args[i];
        if literal || token == "-" || !token.starts_with('-') {
            files.push(token.clone());
            i += 1;
            continue;
        }
        if token == "--" {
            literal = true;
            i += 1;
            continue;
        }
        if token == "--serial" {
            serial = true;
            i += 1;
            continue;
        }
        if token == "--zero-terminated" {
            sep_byte = 0u8;
            i += 1;
            continue;
        }
        if token == "--delimiters" {
            if i + 1 >= args.len() {
                return err_out("paste: EINVAL: option --delimiters requires an argument\n", 1);
            }
            match parse_paste_delimiters(&args[i + 1]) {
                Ok(d) => delims = d,
                Err(msg) => return err_out(&msg, 1),
            }
            i += 2;
            continue;
        }
        if let Some(val) = token.strip_prefix("--delimiters=") {
            match parse_paste_delimiters(val) {
                Ok(d) => delims = d,
                Err(msg) => return err_out(&msg, 1),
            }
            i += 1;
            continue;
        }
        if token.starts_with("--") {
            return err_out(&format!("paste: EINVAL: unsupported option {token}\n"), 1);
        }
        let chars: Vec<char> = token[1..].chars().collect();
        let mut ci = 0usize;
        while ci < chars.len() {
            match chars[ci] {
                's' => {
                    serial = true;
                    ci += 1;
                }
                'z' => {
                    sep_byte = 0u8;
                    ci += 1;
                }
                'd' => {
                    let rest: String = chars[ci + 1..].iter().collect();
                    let val = if !rest.is_empty() {
                        rest
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return err_out("paste: EINVAL: option -d requires an argument\n", 1);
                    };
                    match parse_paste_delimiters(&val) {
                        Ok(d) => delims = d,
                        Err(msg) => return err_out(&msg, 1),
                    }
                    break;
                }
                c => return err_out(&format!("paste: EINVAL: unsupported option -{c}\n"), 1),
            }
        }
        i += 1;
    }

    if files.is_empty() {
        files.push("-".to_string());
    }

    let mut available = fs.max_input_bytes();
    let mut output = Vec::new();
    let max_output = fs.remaining_output_bytes();
    let mut write = |bytes: &[u8]| {
        if bytes.len() > max_output - output.len() {
            return Err(fs.limit_error("maxOutputBytes", fs.shell_limits().max_output_bytes));
        }
        output.extend_from_slice(bytes);
        Ok(())
    };
    let mut stderr = String::new();
    let result = (|| -> Result<(), String> {
        let mut standard = TableReader::default();
        let mut record = Vec::new();
        if serial {
            for name in &files {
                let mut file;
                let reader = if name == "-" { &mut standard } else {
                    match TableReader::open(name, cwd, fs) {
                        Ok(open) => file = open,
                        Err(e) => { stderr.push_str(&format!("paste: {e}\n")); continue; }
                    }
                    &mut file
                };
                let mut count = 0;
                while reader.next(&mut stdin, sep_byte, &mut record, &mut available, fs)? {
                    if count > 0 { write(&delims[(count - 1) % delims.len()])?; }
                    write(&record)?;
                    count += 1;
                }
                if count > 0 { write(&[sep_byte])?; }
            }
        } else {
            let mut readers = vec![standard];
            let mut columns = Vec::with_capacity(files.len());
            for name in &files {
                let index = if name == "-" { 0 } else {
                    readers.push(TableReader::open(name, cwd, fs)?);
                    readers.len() - 1
                };
                columns.push((index, Vec::new()));
            }
            loop {
                let mut present = false;
                for (index, record) in &mut columns {
                    present |= readers[*index].next(&mut stdin, sep_byte, record, &mut available, fs)?;
                }
                if !present { break; }
                for (i, (_, record)) in columns.iter().enumerate() {
                    if i > 0 { write(&delims[(i - 1) % delims.len()])?; }
                    write(record)?;
                }
                write(&[sep_byte])?;
            }
        }
        Ok(())
    })();
    if let Err(e) = result { stderr.push_str(&format!("paste: {e}\n")); }
    BuiltinOutcome { stdout: crate::vfs::bytes_to_stream_string(&output), exit_code: i32::from(!stderr.is_empty()), stderr }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CommOrderMode {
    Default,
    Check,
    None,
}

fn cmd_comm(args: &[String], mut stdin: CommandInput, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut suppressed = [false; 3];
    let mut show_total = false;
    let mut mode = CommOrderMode::Default;
    let mut sep_byte = b'\n';
    let mut delim: Vec<u8> = vec![b'\t'];
    let mut delim_set = false;
    let mut literal = false;
    let mut files = Vec::new();
    let mut i = 0usize;

    while i < args.len() {
        let token = &args[i];
        if literal || token == "-" || !token.starts_with('-') {
            files.push(token.clone());
            i += 1;
            continue;
        }
        if token == "--" {
            literal = true;
            i += 1;
            continue;
        }
        if token == "--check-order" {
            mode = CommOrderMode::Check;
            i += 1;
            continue;
        }
        if token == "--nocheck-order" {
            mode = CommOrderMode::None;
            i += 1;
            continue;
        }
        if token == "--total" {
            show_total = true;
            i += 1;
            continue;
        }
        if token == "--zero-terminated" {
            sep_byte = 0u8;
            i += 1;
            continue;
        }
        if token == "--output-delimiter" || token.starts_with("--output-delimiter=") {
            let val = if let Some(v) = token.strip_prefix("--output-delimiter=") {
                i += 1;
                v.to_string()
            } else if i + 1 < args.len() {
                i += 2;
                args[i - 1].clone()
            } else {
                return err_out("comm: EINVAL: option --output-delimiter requires an argument\n", 1);
            };
            let candidate = if val.is_empty() {
                vec![0u8]
            } else {
                crate::vfs::stream_string_to_bytes(&val)
            };
            if delim_set && candidate != delim {
                return err_out("comm: EINVAL: multiple conflicting output delimiters\n", 1);
            }
            delim = candidate;
            delim_set = true;
            continue;
        }
        if token.len() > 1 && token[1..].chars().all(|c| matches!(c, '1' | '2' | '3' | 'z')) {
            for ch in token[1..].chars() {
                match ch {
                    '1' => suppressed[0] = true,
                    '2' => suppressed[1] = true,
                    '3' => suppressed[2] = true,
                    'z' => sep_byte = 0u8,
                    _ => unreachable!(),
                }
            }
            i += 1;
        } else {
            return err_out(&format!("comm: EINVAL: unsupported option {token}\n"), 1);
        }
    }

    if files.len() != 2 {
        return err_out("comm: EINVAL: comm requires exactly two files\n", 1);
    }

    let mut readers = match files.iter().map(|file| TableReader::open(file, cwd, fs)).collect::<Result<Vec<_>, _>>() {
        Ok(readers) => readers,
        Err(e) => return err_out(&format!("comm: {e}\n"), 1),
    };
    let shared = files[0] == "-" && files[1] == "-";
    let mut available = fs.max_input_bytes();
    let mut next_from = |index: usize| -> Result<Option<Vec<u8>>, String> {
        let mut record = Vec::new();
        let reader = &mut readers[if shared { 0 } else { index }];
        Ok(reader.next(&mut stdin, sep_byte, &mut record, &mut available, fs)?.then_some(record))
    };
    let mut rows = [None, None];
    for (index, row) in rows.iter_mut().enumerate() {
        match next_from(index) {
            Ok(record) => *row = record,
            Err(e) => return err_out(&format!("comm: {e}\n"), 1),
        }
    }
    let mut previous: [Option<Vec<u8>>; 2] = [None, None];
    let mut totals = [0u64; 3];
    let mut unpaired = false;
    let mut failed = false;
    let mut warned = [false; 2];
    let mut pending = [false; 2];
    let mut out_bytes: Vec<u8> = Vec::new();
    let mut stderr = String::new();

    let max_output = fs.remaining_output_bytes();
    while rows[0].is_some() || rows[1].is_some() {
        let ord = match (&rows[0], &rows[1]) {
            (Some(a), Some(b)) => a.cmp(b),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => break,
        };
        let col = match ord {
            std::cmp::Ordering::Less => 0usize,
            std::cmp::Ordering::Greater => 1usize,
            std::cmp::Ordering::Equal => 2usize,
        };
        totals[col] += 1;

        if col != 2 && !unpaired {
            unpaired = true;
            for f_idx in 0..2 {
                if pending[f_idx] && !warned[f_idx] {
                    if mode == CommOrderMode::Check {
                        stderr.push_str(&format!("comm: EINVAL: file {} is not in sorted order\n", f_idx + 1));
                        return BuiltinOutcome {
                            stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
                            stderr,
                            exit_code: 1,
                        };
                    }
                    warned[f_idx] = true;
                    failed = true;
                    stderr.push_str(&format!("comm: file {} is not in sorted order\n", f_idx + 1));
                }
            }
            pending = [false; 2];
        }

        if !suppressed[col] {
            let r = rows[usize::from(col == 1)].as_ref().unwrap();
            let tabs = suppressed[..col].iter().filter(|&&hide| !hide).count();
            let size = delim.len().saturating_mul(tabs).saturating_add(r.len()).saturating_add(1);
            if size > max_output - out_bytes.len() {
                return err_out(&fs.limit_error("maxOutputBytes", fs.shell_limits().max_output_bytes), 1);
            }
            for _ in 0..tabs { out_bytes.extend_from_slice(&delim); }
            out_bytes.extend_from_slice(r);
            out_bytes.push(sep_byte);
        }

        for idx in 0..2 {
            if (idx == 0 && ord == std::cmp::Ordering::Greater)
                || (idx == 1 && ord == std::cmp::Ordering::Less)
            {
                continue;
            }
            let next = match next_from(idx) {
                Ok(record) => record,
                Err(e) => {
                    stderr.push_str(&format!("comm: {e}\n"));
                    return BuiltinOutcome { stdout: crate::vfs::bytes_to_stream_string(&out_bytes), stderr, exit_code: 1 };
                }
            };
            let (prev_chk, next_chk) = if next.is_none() {
                (previous[idx].as_ref(), rows[idx].as_ref())
            } else {
                (rows[idx].as_ref(), next.as_ref())
            };
            if mode != CommOrderMode::None && !warned[idx] {
                let disordered = match (prev_chk, next_chk) {
                    (Some(p), Some(n)) => p > n,
                    _ => false,
                };
                if mode == CommOrderMode::Default && !unpaired {
                    pending[idx] = disordered;
                } else if disordered {
                    if mode == CommOrderMode::Check {
                        stderr.push_str(&format!("comm: EINVAL: file {} is not in sorted order\n", idx + 1));
                        return BuiltinOutcome {
                            stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
                            stderr,
                            exit_code: 1,
                        };
                    }
                    warned[idx] = true;
                    failed = true;
                    stderr.push_str(&format!("comm: file {} is not in sorted order\n", idx + 1));
                }
            }
            previous[idx] = rows[idx].take();
            rows[idx] = next;
        }
    }

    if shared {
        stderr.push_str("comm: -: Bad file descriptor\n");
        return BuiltinOutcome {
            stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
            stderr,
            exit_code: 1,
        };
    }

    if show_total {
        out_bytes.extend_from_slice(totals[0].to_string().as_bytes());
        out_bytes.extend_from_slice(&delim);
        out_bytes.extend_from_slice(totals[1].to_string().as_bytes());
        out_bytes.extend_from_slice(&delim);
        out_bytes.extend_from_slice(totals[2].to_string().as_bytes());
        out_bytes.extend_from_slice(&delim);
        out_bytes.extend_from_slice(b"total");
        out_bytes.push(sep_byte);
    }

    if failed {
        stderr.push_str("comm: input is not in sorted order\n");
    }

    BuiltinOutcome {
        stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
        stderr,
        exit_code: if failed { 1 } else { 0 },
    }
}

fn cmd_tee(args: &[String], mut input: CommandInput, cwd: &str, env: &BTreeMap<String, String>, fs: &dyn SafeBashFs, write: &mut super::CommandWriter) -> BuiltinOutcome {
    let mut append = false;
    let mut error_mode: Option<String> = None;
    let mut files = Vec::new();
    let mut ended = false;
    let mut i = 0usize;

    while i < args.len() {
        let a = &args[i];
        if !ended && a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if ended || !a.starts_with('-') || a == "-" {
            files.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--append" {
            append = true;
            i += 1;
        } else if a == "--ignore-interrupts" {
            i += 1;
        } else if a == "--output-error" {
            error_mode = Some("warn-nopipe".to_string());
            i += 1;
        } else if let Some(m) = a.strip_prefix("--output-error=") {
            if !matches!(m, "warn" | "warn-nopipe" | "exit" | "exit-nopipe") {
                return err_out(&format!("tee: invalid argument '{m}' for '--output-error'\n"), 2);
            }
            error_mode = Some(m.to_string());
            i += 1;
        } else if let Some((opt @ ("--append" | "--ignore-interrupts"), _)) = a.split_once('=') {
            return err_out(&format!("tee: option '{opt}' does not take an argument\n"), 2);
        } else if a.starts_with("--") {
            return err_out(&format!("tee: unrecognized option '{a}'\n"), 2);
        } else {
            for ch in a[1..].chars() {
                match ch {
                    'a' => append = true,
                    'i' => {}
                    'p' => error_mode = Some("warn-nopipe".to_string()),
                    _ => return err_out(&format!("tee: invalid option -- '{ch}'\n"), 2),
                }
            }
            i += 1;
        }
    }

    let exit_on_error = matches!(error_mode.as_deref(), Some("exit" | "exit-nopipe"));
    let mode = 0o666 & !env.get("\0umask").and_then(|s| u32::from_str_radix(s, 8).ok()).unwrap_or(0o022);
    let mut targets = Vec::new();
    let mut out = ok_out("");
    for f in files {
        let path = absolute_operand(cwd, &f);
        match fs.open_command_stream(&path, append, false, mode, None) {
            Ok(target) => targets.push((path, target)),
            Err(e) => {
                out.exit_code = 1;
                if !write(2, &format!("tee: {e}\n"), &mut out) || exit_on_error { return out; }
            }
        }
    }
    let mut stopped = false;
    let read = input.read_stdin(|chunk| {
        if !write(1, &crate::vfs::bytes_to_stream_string(chunk), &mut out) { stopped = true; return false; }
        targets.retain_mut(|(path, target)| {
            if stopped { return true; }
            if let Err(e) = target(Some(chunk)) {
                out.exit_code = 1;
                let message = stream_file_error(e, "writeStream", path);
                stopped = !write(2, &format!("tee: {message}\n"), &mut out) || exit_on_error;
                false
            } else { true }
        });
        !stopped
    });
    if let Err(e) = read {
        out.exit_code = 1;
        write(2, &format!("tee: {e}\n"), &mut out);
    } else if !stopped {
        for (path, mut target) in targets {
            if let Err(e) = target(None) {
                out.exit_code = 1;
                let message = stream_file_error(e, "writeStream", &path);
                if !write(2, &format!("tee: {message}\n"), &mut out) { break; }
            }
        }
    }
    out
}

fn cmd_sponge(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut append = false;
    let mut files = Vec::new();
    let mut end_opts = false;
    for a in args {
        if !end_opts && a == "--" {
            end_opts = true;
            continue;
        }
        if !end_opts && a == "--append" {
            append = true;
            continue;
        }
        if !end_opts && (a == "--help" || a == "-h") {
            return ok_out("Usage: sponge [-a] [FILE]\nSoak up standard input and write to FILE (or stdout).\n");
        }
        if !end_opts && a == "--version" {
            return ok_out("sponge (virtual-bash)\n");
        }
        if !end_opts && a.starts_with('-') && a.len() > 1 {
            for ch in a[1..].chars() {
                if ch == 'a' {
                    append = true;
                } else {
                    return err_out(&format!("sponge: invalid option -- '{ch}'\n"), 2);
                }
            }
            continue;
        }
        files.push(a.clone());
    }
    if files.len() > 1 {
        return err_out("sponge: too many arguments\n", 2);
    }
    if files.is_empty() || files[0] == "-" {
        return ok_out(stdin);
    }
    let f = &files[0];
    let p = resolve_posix_path(cwd, f);
    if fs.is_dir(&p) {
        return err_out(
            &format!("sponge: EISDIR: illegal operation on a directory, writeFile '{p}'\n"),
            1,
        );
    }
    let in_bytes = crate::vfs::stream_string_to_bytes(stdin);
    let data = if append && fs.exists(&p) {
        let mut prev = match fs.read_file(&p) {
            Ok(b) => b,
            Err(_) => {
                return err_out(
                    &format!("sponge: ENOENT: no such file or directory, readFile '{p}'\n"),
                    1,
                );
            }
        };
        prev.extend_from_slice(&in_bytes);
        prev
    } else {
        in_bytes
    };
    let parent = dirname_posix_path(&p);
    if !fs.is_dir(&parent) || fs.write_file(&p, &data).is_err() {
        return err_out(
            &format!("sponge: ENOENT: no such file or directory, writeFile '{p}'\n"),
            1,
        );
    }
    ok_out("")
}

#[derive(Clone, Debug)]
struct SeqDecimal {
    coefficient: i128,
    scale: usize,
    precision: usize,
    negative_zero: bool,
    width: usize,
}

fn parse_seq_decimal(text: &str) -> Result<SeqDecimal, String> {
    let t = text.trim();
    if t.is_empty() {
        return Err(format!("seq: invalid decimal argument: '{text}'\n"));
    }
    let (sign_neg, rest) = if let Some(r) = t.strip_prefix('-') {
        (true, r)
    } else if let Some(r) = t.strip_prefix('+') {
        (false, r)
    } else {
        (false, t)
    };

    if let Some(hex_body) = rest.strip_prefix("0x").or_else(|| rest.strip_prefix("0X")) {
        let (mant, exp_str) = match hex_body.split_once(['p', 'P']) {
            Some((m, e)) => (m, Some(e)),
            None => (hex_body, None),
        };
        let (int_part, frac_part) = match mant.split_once('.') {
            Some((ip, fp)) => (ip, fp),
            None => (mant, ""),
        };
        if (int_part.is_empty() && frac_part.is_empty())
            || !int_part.chars().all(|c| c.is_ascii_hexdigit())
            || !frac_part.chars().all(|c| c.is_ascii_hexdigit())
        {
            return Err(format!("seq: invalid decimal argument: '{text}'\n"));
        }
        let exp: i32 = match exp_str {
            Some(es) => es
                .parse::<i32>()
                .map_err(|_| format!("seq: invalid decimal argument: '{text}'\n"))?,
            None => 0,
        };
        let digits = format!(
            "{}{}",
            if int_part.is_empty() { "0" } else { int_part },
            frac_part
        );
        let mut coeff = i128::from_str_radix(&digits, 16)
            .map_err(|_| format!("seq: invalid decimal argument: '{text}'\n"))?;
        if sign_neg {
            coeff = -coeff;
        }
        let power = exp - 4 * (frac_part.len() as i32);
        let scale = if power < 0 { (-power) as usize } else { 0usize };
        coeff = if power >= 0 {
            coeff << (power as u32)
        } else {
            coeff * 5i128.pow(scale as u32)
        };
        let mut precision = scale;
        let mut reduced = coeff;
        while precision > 0 && reduced % 10 == 0 {
            reduced /= 10;
            precision -= 1;
        }
        return Ok(SeqDecimal {
            coefficient: coeff,
            scale,
            precision,
            negative_zero: coeff == 0 && sign_neg,
            width: 0,
        });
    }

    let (mant, exp_str) = match rest.split_once(['e', 'E']) {
        Some((m, e)) => (m, Some(e)),
        None => (rest, None),
    };
    let (int_part, frac_part) = match mant.split_once('.') {
        Some((ip, fp)) => (ip, fp),
        None => (mant, ""),
    };
    if (int_part.is_empty() && frac_part.is_empty())
        || !int_part.chars().all(|c| c.is_ascii_digit())
        || !frac_part.chars().all(|c| c.is_ascii_digit())
    {
        return Err(format!("seq: invalid decimal argument: '{text}'\n"));
    }
    let exp: i32 = match exp_str {
        Some(es) => es
            .parse::<i32>()
            .map_err(|_| format!("seq: invalid decimal argument: '{text}'\n"))?,
        None => 0,
    };
    let digits = format!(
        "{}{}",
        if int_part.is_empty() { "0" } else { int_part },
        frac_part
    );
    let mut coeff = digits
        .parse::<i128>()
        .map_err(|_| format!("seq: invalid decimal argument: '{text}'\n"))?;
    if sign_neg {
        coeff = -coeff;
    }
    let raw_scale = (frac_part.len() as i32) - exp;
    let (scale, precision) = if raw_scale >= 0 {
        (raw_scale as usize, raw_scale as usize)
    } else {
        coeff *= 10i128.pow((-raw_scale) as u32);
        (0usize, 0usize)
    };
    let int_width = ((int_part.len() as i32) + exp.max(0)).max(1) as usize + usize::from(sign_neg);
    Ok(SeqDecimal {
        coefficient: coeff,
        scale,
        precision,
        negative_zero: coeff == 0 && sign_neg,
        width: int_width,
    })
}

fn seq_rounded(coeff: i128, scale: usize, precision: usize) -> i128 {
    if coeff == 0 {
        return 0;
    }
    if precision >= scale {
        return coeff * 10i128.pow((precision - scale) as u32);
    }
    let diff = scale - precision;
    if diff > 36 {
        return 0;
    }
    let divisor = 10i128.pow(diff as u32);
    let quotient = coeff / divisor;
    let remainder = coeff % divisor;
    let twice = remainder.abs() * 2;
    if twice > divisor || (twice == divisor && quotient % 2 != 0) {
        if coeff < 0 {
            quotient - 1
        } else {
            quotient + 1
        }
    } else {
        quotient
    }
}

fn seq_fixed(coeff: i128, scale: usize, precision: usize) -> String {
    let val = seq_rounded(coeff, scale, precision);
    let neg = coeff < 0;
    let abs_str = val.abs().to_string();
    let padded = if abs_str.len() < precision + 1 {
        format!("{}{abs_str}", "0".repeat(precision + 1 - abs_str.len()))
    } else {
        abs_str
    };
    if precision > 0 {
        let split_at = padded.len() - precision;
        format!(
            "{}{}.{}",
            if neg { "-" } else { "" },
            &padded[..split_at],
            &padded[split_at..]
        )
    } else {
        format!("{}{padded}", if neg { "-" } else { "" })
    }
}

struct SeqFormat {
    prefix: String,
    suffix: String,
    flags: String,
    width: usize,
    precision: Option<usize>,
    kind: char,
}

fn parse_seq_format(text: &str) -> Result<SeqFormat, String> {
    let chs: Vec<char> = text.chars().collect();
    let mut literal = String::new();
    let mut found: Option<SeqFormat> = None;
    let mut i = 0usize;
    while i < chs.len() {
        if chs[i] != '%' {
            literal.push(chs[i]);
            i += 1;
            continue;
        }
        if i + 1 < chs.len() && chs[i + 1] == '%' {
            literal.push('%');
            i += 2;
            continue;
        }
        if found.is_some() {
            return Err(format!("seq: format '{text}' has too many % directives\n"));
        }
        let mut cur = i + 1;
        let mut flags = String::new();
        while cur < chs.len() && "-+ #0".contains(chs[cur]) {
            flags.push(chs[cur]);
            cur += 1;
        }
        let mut width_str = String::new();
        while cur < chs.len() && chs[cur].is_ascii_digit() {
            width_str.push(chs[cur]);
            cur += 1;
        }
        let mut precision: Option<usize> = None;
        if cur < chs.len() && chs[cur] == '.' {
            cur += 1;
            let mut p_str = String::new();
            while cur < chs.len() && chs[cur].is_ascii_digit() {
                p_str.push(chs[cur]);
                cur += 1;
            }
            precision = Some(p_str.parse::<usize>().unwrap_or(0));
        }
        if cur < chs.len() && chs[cur] == 'L' {
            cur += 1;
        }
        if cur >= chs.len() || !"fFeEgGaA".contains(chs[cur]) {
            return Err("seq: format requires one f, e, g or a conversion\n".to_string());
        }
        let kind = chs[cur];
        let width = width_str.parse::<usize>().unwrap_or(0);
        found = Some(SeqFormat {
            prefix: std::mem::take(&mut literal),
            suffix: String::new(),
            flags,
            width,
            precision,
            kind,
        });
        i = cur + 1;
    }
    match found {
        Some(mut f) => {
            f.suffix = literal;
            Ok(f)
        }
        None => Err("seq: format must contain exactly one conversion\n".to_string()),
    }
}

fn format_seq_with_spec(val: f64, fmt: &SeqFormat) -> String {
    let kind_lower = fmt.kind.to_ascii_lowercase();
    let prec = fmt.precision.unwrap_or(6);
    let abs_val = val.abs();
    let neg = val.is_sign_negative();
    let mut text = match kind_lower {
        'f' => format!("{abs_val:.prec$}"),
        'e' => {
            let s = format!("{abs_val:.prec$e}");
            if let Some((m, e)) = s.split_once('e') {
                let (esign, edigits) = if let Some(r) = e.strip_prefix('-') {
                    ('-', r)
                } else if let Some(r) = e.strip_prefix('+') {
                    ('+', r)
                } else {
                    ('+', e)
                };
                format!("{m}e{esign}{edigits:0>2}")
            } else {
                s
            }
        }
        'g' => {
            let g_prec = prec.max(1);
            let exp = if abs_val == 0.0 {
                0i32
            } else {
                abs_val.log10().floor() as i32
            };
            if exp < -4 || exp >= g_prec as i32 {
                let e_prec = g_prec.saturating_sub(1);
                let s = format!("{abs_val:.e_prec$e}");
                let (mut m, e) = s.split_once('e').unwrap_or((&s, "0"));
                let mut m_owned = m.to_string();
                if !fmt.flags.contains('#') && m_owned.contains('.') {
                    m_owned = m_owned.trim_end_matches('0').trim_end_matches('.').to_string();
                } else if fmt.flags.contains('#') && !m_owned.contains('.') {
                    m_owned.push('.');
                }
                let _ = &mut m;
                let (esign, edigits) = if let Some(r) = e.strip_prefix('-') {
                    ('-', r)
                } else if let Some(r) = e.strip_prefix('+') {
                    ('+', r)
                } else {
                    ('+', e)
                };
                format!("{m_owned}e{esign}{edigits:0>2}")
            } else {
                let f_prec = (g_prec as i32 - 1 - exp).max(0) as usize;
                let mut s = format!("{abs_val:.f_prec$}");
                if !fmt.flags.contains('#') && s.contains('.') {
                    s = s.trim_end_matches('0').trim_end_matches('.').to_string();
                } else if fmt.flags.contains('#') && !s.contains('.') {
                    s.push('.');
                }
                s
            }
        }
        _ => format!("{abs_val:.prec$}"),
    };
    if fmt.flags.contains('#') && !text.contains('.') && !text.contains('e') {
        text.push('.');
    }
    if neg {
        text = format!("-{text}");
    } else if fmt.flags.contains('+') {
        text = format!("+{text}");
    } else if fmt.flags.contains(' ') {
        text = format!(" {text}");
    }
    if fmt.kind.is_ascii_uppercase() {
        text = text.to_ascii_uppercase();
    }
    if fmt.flags.contains('-') {
        if text.len() < fmt.width {
            text.push_str(&" ".repeat(fmt.width - text.len()));
        }
    } else if fmt.flags.contains('0') {
        if text.len() < fmt.width {
            let sign_len = usize::from(text.starts_with(['+', '-', ' ']));
            let pad = "0".repeat(fmt.width - text.len());
            text = format!("{}{pad}{}", &text[..sign_len], &text[sign_len..]);
        }
    } else if text.len() < fmt.width {
        text = format!("{}{text}", " ".repeat(fmt.width - text.len()));
    }
    format!("{}{text}{}", fmt.prefix, fmt.suffix)
}

fn cmd_seq(args: &[String]) -> BuiltinOutcome {
    let mut sep = "\n".to_string();
    let mut fmt_str: Option<String> = None;
    let mut equal_width = false;
    let mut operands = Vec::new();
    let mut ended = false;
    let mut i = 0usize;

    while i < args.len() {
        let a = &args[i];
        let is_neg_num = a.len() > 1
            && a.starts_with('-')
            && a.as_bytes()[1].is_ascii_digit()
            || a.starts_with("-.");
        if ended || !a.starts_with('-') || a == "-" || is_neg_num {
            operands.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if a.starts_with("--") {
            let (key, val_opt) = match a[2..].split_once('=') {
                Some((k, v)) => (k, Some(v.to_string())),
                None => (&a[2..], None),
            };
            if key == "equal-width" && val_opt.is_none() {
                equal_width = true;
                i += 1;
            } else if key == "separator" || key == "format" {
                let val = if let Some(v) = val_opt {
                    i += 1;
                    v
                } else if i + 1 < args.len() {
                    i += 2;
                    args[i - 1].clone()
                } else {
                    return err_out(&format!("seq: option '--{key}' requires an argument\n"), 1);
                };
                if key == "separator" {
                    sep = val;
                } else {
                    fmt_str = Some(val);
                }
            } else {
                return err_out(&format!("seq: unrecognized option '{a}'\n"), 1);
            }
            continue;
        }
        let chars: Vec<char> = a[1..].chars().collect();
        let mut ci = 0usize;
        while ci < chars.len() {
            match chars[ci] {
                'w' => {
                    equal_width = true;
                    ci += 1;
                }
                's' | 'f' => {
                    let key = chars[ci];
                    let rest: String = chars[ci + 1..].iter().collect();
                    let val = if !rest.is_empty() {
                        rest
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return err_out(&format!("seq: option '-{key}' requires an argument\n"), 1);
                    };
                    if key == 's' {
                        sep = val;
                    } else {
                        fmt_str = Some(val);
                    }
                    break;
                }
                c => return err_out(&format!("seq: invalid option -- '{c}'\n"), 1),
            }
        }
        i += 1;
    }

    if operands.is_empty() || operands.len() > 3 {
        return err_out("seq: expected one to three numeric operands\n", 1);
    }
    if equal_width && fmt_str.is_some() {
        return err_out(
            "seq: format string may not be specified when printing equal width strings\n",
            1,
        );
    }

    let first = match parse_seq_decimal(if operands.len() == 1 { "1" } else { &operands[0] }) {
        Ok(d) => d,
        Err(msg) => return err_out(&msg, 1),
    };
    let increment = match parse_seq_decimal(if operands.len() == 3 { &operands[1] } else { "1" }) {
        Ok(d) => d,
        Err(msg) => return err_out(&msg, 1),
    };
    let last = match parse_seq_decimal(operands.last().unwrap()) {
        Ok(d) => d,
        Err(msg) => return err_out(&msg, 1),
    };

    if increment.coefficient == 0 {
        return err_out("seq: invalid Zero increment value\n", 1);
    }

    let scale = first.scale.max(increment.scale).max(last.scale);
    let align = |d: &SeqDecimal| -> i128 {
        d.coefficient * 10i128.pow((scale - d.scale) as u32)
    };
    let mut current = align(&first);
    let step = align(&increment);
    let finish = align(&last);
    let precision = first.precision.max(increment.precision);

    if let Some(ref f_raw) = fmt_str {
        let fmt = match parse_seq_format(f_raw) {
            Ok(f) => f,
            Err(msg) => return err_out(&msg, 1),
        };
        let mut items = Vec::new();
        let mut idx = 0usize;
        while (step > 0 && current <= finish) || (step < 0 && current >= finish) {
            let val_str = seq_fixed(current, scale, scale);
            let val_f64 = val_str.parse::<f64>().unwrap_or(0.0);
            items.push(format_seq_with_spec(val_f64, &fmt));
            current += step;
            idx += 1;
            if idx > 100_000 {
                break;
            }
        }
        return if items.is_empty() {
            ok_out("")
        } else {
            ok_out(&format!("{}\n", items.join(&sep)))
        };
    }

    let first_text = format!(
        "{}{}",
        if first.negative_zero { "-" } else { "" },
        seq_fixed(current, scale, precision)
    );
    let width = if equal_width {
        let discarded = scale - precision;
        let finish_digits = finish.abs().to_string().len();
        let width_finish = if discarded >= finish_digits {
            0i128
        } else {
            finish / 10i128.pow(discarded as u32)
        };
        let last_text = format!(
            "{}{}",
            if last.negative_zero { "-" } else { "" },
            seq_fixed(width_finish, precision, precision)
        );
        let extra = if precision > 0 { precision + 1 } else { 0 };
        first_text
            .len()
            .max(last_text.len())
            .max(first.width + extra)
            .max(last.width + extra)
    } else {
        0
    };

    let pad_equal = |raw: String| -> String {
        if !equal_width || raw.len() >= width {
            return raw;
        }
        let zeros = "0".repeat(width - raw.len());
        if let Some(rest) = raw.strip_prefix('-') {
            format!("-{zeros}{rest}")
        } else {
            format!("{zeros}{raw}")
        }
    };

    let mut items = Vec::new();
    let mut idx = 0usize;
    while (step > 0 && current <= finish) || (step < 0 && current >= finish) {
        let text = if idx == 0 {
            first_text.clone()
        } else {
            seq_fixed(current, scale, precision)
        };
        items.push(pad_equal(text));
        current += step;
        idx += 1;
        if idx > 100_000 {
            break;
        }
    }

    if items.is_empty() {
        ok_out("")
    } else {
        ok_out(&format!("{}\n", items.join(&sep)))
    }
}

fn cmd_yes(args: &[String], posixly_correct: bool) -> BuiltinOutcome {
    let mut delimiter_idx: Option<usize> = None;
    for (idx, arg) in args.iter().enumerate() {
        if arg == "--" {
            delimiter_idx = Some(idx);
            break;
        }
        if arg == "-" || !arg.starts_with('-') {
            if posixly_correct { break; }
            continue;
        }
        let message = if let Some(long) = arg.strip_prefix("--") {
            let name = long.split('=').next().unwrap();
            if name.is_empty() {
                format!("option '{arg}' is ambiguous; possibilities: '--help' '--version'")
            } else if let Some(option) = ["help", "version"].into_iter().find(|opt| opt.starts_with(name)) {
                if long == name {
                    return ok_out(if option == "help" { include_str!("help/yes.txt") }
                        else { "yes (virtual-bash GNU-compatible profile)\n" });
                }
                format!("option '--{option}' doesn't allow an argument")
            } else {
                format!("unrecognized option '{arg}'")
            }
        } else {
            let bytes = stream_string_to_bytes(arg);
            format!("invalid option -- '{}'", crate::vfs::bytes_to_stream_string(&bytes[1..2]))
        };
        return err_out(&format!("yes: {message}\nTry 'yes --help' for more information.\n"), 1);
    }
    let words: Vec<&str> = args
        .iter()
        .enumerate()
        .filter_map(|(idx, a)| {
            if Some(idx) == delimiter_idx {
                None
            } else {
                Some(a.as_str())
            }
        })
        .collect();
    let word = if words.is_empty() {
        "y".to_string()
    } else {
        words.join(" ")
    };
    let line = format!("{word}\n");
    ok_out(&line.repeat(10_500))
}

fn cmd_basename(args: &[String]) -> BuiltinOutcome {
    let mut suffix: Option<String> = None;
    let mut multiple = false;
    let mut zero_term = false;
    let mut operands = Vec::new();
    let mut ended = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if !ended && a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if ended || !a.starts_with('-') || a == "-" {
            operands.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--multiple" {
            multiple = true;
            i += 1;
        } else if a == "--zero" {
            zero_term = true;
            i += 1;
        } else if a == "--suffix" {
            if i + 1 >= args.len() {
                return err_out("basename: option '--suffix' requires an argument\n", 1);
            }
            suffix = Some(args[i + 1].clone());
            multiple = true;
            i += 2;
        } else if let Some(s) = a.strip_prefix("--suffix=") {
            suffix = Some(s.to_string());
            multiple = true;
            i += 1;
        } else if a.starts_with("--") {
            return err_out(&format!("basename: unrecognized option '{a}'\n"), 1);
        } else {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut ci = 0usize;
            while ci < chars.len() {
                match chars[ci] {
                    'a' => {
                        multiple = true;
                        ci += 1;
                    }
                    'z' => {
                        zero_term = true;
                        ci += 1;
                    }
                    's' => {
                        multiple = true;
                        let rest: String = chars[ci + 1..].iter().collect();
                        if !rest.is_empty() {
                            suffix = Some(rest);
                        } else if i + 1 < args.len() {
                            i += 1;
                            suffix = Some(args[i].clone());
                        } else {
                            return err_out("basename: option requires an argument -- 's'\n", 1);
                        }
                        break;
                    }
                    c => return err_out(&format!("basename: invalid option -- '{c}'\n"), 1),
                }
            }
            i += 1;
        }
    }
    if operands.is_empty() {
        return err_out("basename: missing operand\n", 1);
    }
    if !multiple && operands.len() > 2 {
        return err_out(&format!("basename: extra operand '{}'\n", operands[2]), 1);
    }
    let term = if zero_term { '\0' } else { '\n' };
    let (paths, suf) = if multiple {
        (&operands[..], suffix.as_deref())
    } else {
        let s = suffix.as_deref().or_else(|| operands.get(1).map(|x| x.as_str()));
        (&operands[..1], s)
    };
    let mut out = String::new();
    for path in paths {
        let bytes = path.as_bytes();
        let mut end = bytes.len();
        while end > 0 && bytes[end - 1] == b'/' {
            end -= 1;
        }
        let mut start = end;
        while start > 0 && bytes[start - 1] != b'/' {
            start -= 1;
        }
        if end == 0 && !bytes.is_empty() {
            end = 1;
        }
        let mut base = &path[start..end];
        if let Some(s) = suf
            && !s.is_empty()
            && base.len() > s.len()
            && let Some(stripped) = base.strip_suffix(s)
        {
            base = stripped;
        }
        out.push_str(base);
        out.push(term);
    }
    ok_out(&out)
}

fn cmd_dirname(args: &[String]) -> BuiltinOutcome {
    let mut zero_term = false;
    let mut operands = Vec::new();
    let mut ended = false;
    for a in args {
        if !ended && a == "--" {
            ended = true;
            continue;
        }
        if ended || !a.starts_with('-') || a == "-" {
            operands.push(a);
            continue;
        }
        if a == "--zero" {
            zero_term = true;
        } else if a.starts_with("--") {
            return err_out(&format!("dirname: unrecognized option '{a}'\n"), 1);
        } else {
            for ch in a[1..].chars() {
                if ch == 'z' {
                    zero_term = true;
                } else {
                    return err_out(&format!("dirname: invalid option -- '{ch}'\n"), 1);
                }
            }
        }
    }
    if operands.is_empty() {
        return err_out("dirname: missing operand\n", 1);
    }
    let term = if zero_term { '\0' } else { '\n' };
    let mut out = String::new();
    for path in operands {
        let bytes = path.as_bytes();
        let mut end = bytes.len();
        while end > 0 && bytes[end - 1] == b'/' {
            end -= 1;
        }
        if end == 0 && !bytes.is_empty() {
            end = 1;
        } else {
            while end > 0 && bytes[end - 1] != b'/' {
                end -= 1;
            }
            while end > 1 && bytes[end - 1] == b'/' {
                end -= 1;
            }
        }
        if end > 0 {
            out.push_str(&path[..end]);
        } else {
            out.push('.');
        }
        out.push(term);
    }
    ok_out(&out)
}

fn cmd_printenv(args: &[String], env: &BTreeMap<String, String>) -> BuiltinOutcome {
    let mut sep = '\n';
    let mut offset = 0usize;
    while offset < args.len() {
        let a = &args[offset];
        if a == "--" {
            offset += 1;
            break;
        }
        if a == "--help" {
            return ok_out(
                "Usage: printenv [-0|--null] [--] [NAME ...]\nPrint only the virtual command environment.\n",
            );
        }
        if a == "--version" {
            return ok_out("printenv (safe-bash virtual command)\n");
        }
        if a == "--null" || (a.len() > 1 && a.starts_with('-') && a[1..].chars().all(|c| c == '0')) {
            sep = '\0';
            offset += 1;
            continue;
        }
        if a.starts_with('-') && a != "-" {
            return err_out(&format!("printenv: invalid option: {a}\n"), 2);
        }
        break;
    }
    let names = &args[offset..];
    if names.is_empty() {
        let mut out = String::new();
        for k in super::exported_env_names(env) {
            out.push_str(&format!("{k}={}{sep}", env[k]));
        }
        return ok_out(&out);
    }
    let mut out = String::new();
    let mut code = 0;
    for k in names {
        if k.contains(['=', '\0']) {
            code = 1;
            continue;
        }
        if crate::shell::is_exported_scalar(env, k)
            && let Some(v) = env.get(k)
        {
            out.push_str(&format!("{v}{sep}"));
        } else {
            code = 1;
        }
    }
    BuiltinOutcome {
        stdout: out,
        stderr: String::new(),
        exit_code: code,
    }
}

fn is_envsubst_ident_start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_'
}

fn is_envsubst_ident_part(b: u8) -> bool {
    is_envsubst_ident_start(b) || b.is_ascii_digit()
}

fn extract_envsubst_vars(spec: &str) -> Vec<String> {
    let bytes = spec.as_bytes();
    let mut vars = Vec::new();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] != b'$' || i + 1 >= bytes.len() {
            i += 1;
            continue;
        }
        let next = bytes[i + 1];
        if next == b'{' {
            let mut j = i + 2;
            if j < bytes.len() && is_envsubst_ident_start(bytes[j]) {
                j += 1;
                while j < bytes.len() && is_envsubst_ident_part(bytes[j]) {
                    j += 1;
                }
                if j < bytes.len() && bytes[j] == b'}' {
                    vars.push(String::from_utf8_lossy(&bytes[i + 2..j]).to_string());
                    i = j + 1;
                    continue;
                }
            }
            i += 1;
            continue;
        }
        if is_envsubst_ident_start(next) {
            let mut j = i + 2;
            while j < bytes.len() && is_envsubst_ident_part(bytes[j]) {
                j += 1;
            }
            vars.push(String::from_utf8_lossy(&bytes[i + 1..j]).to_string());
            i = j;
            continue;
        }
        i += 1;
    }
    vars
}

fn cmd_envsubst(args: &[String], mut stdin: CommandInput, env: &BTreeMap<String, String>) -> Result<BuiltinOutcome, String> {
    let mut list_vars = false;
    let mut operands = Vec::new();
    let mut end_opts = false;
    for a in args {
        if !end_opts && a == "--" {
            end_opts = true;
            continue;
        }
        if !end_opts && (a == "-h" || a == "--help") {
            return Ok(ok_out(
                "Usage: envsubst [OPTION] [SHELL-FORMAT]\n\nSubstitutes the values of environment variables.\n\nOperation mode:\n  -v, --variables             output the variables occurring in SHELL-FORMAT\n\nInformative output:\n  -h, --help                  display this help and exit\n  -V, --version               output version information and exit\n\nIn normal operation mode, standard input is copied to standard output,\nwith references to environment variables of the form $VARIABLE or ${VARIABLE}\nbeing replaced with the corresponding values.  If a SHELL-FORMAT is given,\nonly those environment variables that are referenced in SHELL-FORMAT are\nsubstituted; otherwise all environment variables references occurring in\nstandard input are substituted.\n",
            ));
        }
        if !end_opts && (a == "-V" || a == "--version") {
            return Ok(ok_out("envsubst (Sandbox VFS-ish/GNU gettext-runtime) 0.22.5\n"));
        }
        if !end_opts && (a == "-v" || a == "--variables") {
            list_vars = true;
            continue;
        }
        if !end_opts && a.starts_with('-') {
            return Ok(err_out(&format!("envsubst: invalid option '{a}'\n"), 1));
        }
        operands.push(a.clone());
    }
    if operands.len() > 1 {
        return Ok(err_out("envsubst: too many arguments\n", 1));
    }
    if list_vars {
        if operands.is_empty() {
            return Ok(err_out("envsubst: missing arguments\n", 1));
        }
        let vars = extract_envsubst_vars(&operands[0]);
        let mut out = String::new();
        for v in vars {
            out.push_str(&v);
            out.push('\n');
        }
        return Ok(ok_out(&out));
    }
    let whitelist: Option<BTreeSet<String>> = operands
        .first()
        .map(|sf| extract_envsubst_vars(sf).into_iter().collect());

    let mut bytes = Vec::new();
    stdin.append_bytes(&mut bytes)?;
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] != b'$' || i + 1 >= bytes.len() {
            out.push(bytes[i]);
            i += 1;
            continue;
        }
        let next = bytes[i + 1];
        let mut matched: Option<(&str, usize)> = None;
        if next == b'{' {
            let mut j = i + 2;
            if j < bytes.len() && is_envsubst_ident_start(bytes[j]) {
                j += 1;
                while j < bytes.len() && is_envsubst_ident_part(bytes[j]) {
                    j += 1;
                }
                if j < bytes.len() && bytes[j] == b'}' {
                    if let Ok(name) = std::str::from_utf8(&bytes[i + 2..j]) {
                        matched = Some((name, j + 1));
                    }
                }
            }
        } else if is_envsubst_ident_start(next) {
            let mut j = i + 2;
            while j < bytes.len() && is_envsubst_ident_part(bytes[j]) {
                j += 1;
            }
            if let Ok(name) = std::str::from_utf8(&bytes[i + 1..j]) {
                matched = Some((name, j));
            }
        }

        if let Some((name, end_idx)) = matched {
            let allowed = whitelist.as_ref().map(|w| w.contains(name)).unwrap_or(true);
            if allowed {
                if crate::shell::is_exported_scalar(env, name)
                    && let Some(val) = env.get(name)
                {
                    out.extend_from_slice(&stream_string_to_bytes(val));
                }
            } else {
                out.extend_from_slice(&bytes[i..end_idx]);
            }
            i = end_idx;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    Ok(ok_out(&crate::vfs::bytes_to_stream_string(&out)))
}

fn cmd_expr(args: &[String], env: &BTreeMap<String, String>) -> BuiltinOutcome {
    if args.len() == 1 && args[0] == "--help" {
        return ok_out("Usage: expr EXPRESSION\nTokens: | & < <= = == != >= > + - * / % :\nPrefixes: + TOKEN, length STRING, index STRING CHARS, substr STRING POS LENGTH, match STRING REGEXP\nGroup with ( EXPRESSION ). Each token is a separate argument.\nMatching uses bounded provider-driven BRE.\nProfiles depend on the provider: built-in portable non-NUL ASCII; Node C/POSIX byte or C.UTF-8 scalar.\n");
    }
    if args.len() == 1 && args[0] == "--version" {
        return ok_out("expr (virtual-bash)\n");
    }
    let mut pos = 0usize;
    if args.first().map(|s| s.as_str()) == Some("--") {
        pos = 1;
    }
    if pos >= args.len() {
        return err_out("expr: missing operand\nTry 'expr --help' for more information.\n", 2);
    }
    let category = |name| ["LC_ALL", name, "LANG"].into_iter()
        .find_map(|key| env.get(key).filter(|v| !v.is_empty())).map_or("C", String::as_str);
    let locale = ExprLocale { ctype: category("LC_CTYPE"), collate: category("LC_COLLATE") };
    match eval_expr_or(args, &mut pos, true, &locale) {
        Ok(res) => {
            if pos != args.len() {
                return err_out(&format!("expr: syntax error: unexpected argument {}\n", quote_bytes(args[pos].as_bytes())), 2);
            }
            let truthy = is_expr_truthy(&res);
            BuiltinOutcome {
                stdout: format!("{res}\n"),
                stderr: String::new(),
                exit_code: if truthy { 0 } else { 1 },
            }
        }
        Err((msg, code)) => err_out(&msg, code),
    }
}

struct ExprLocale<'a> {
    ctype: &'a str,
    collate: &'a str,
}

impl ExprLocale<'_> {
    // UTF-8 (without a language) and C.UTF-8 use byte ordering.
    fn utf8_language(locale: &str) -> Option<&str> {
        let (name, encoding) = locale.rsplit_once('.').unwrap_or(("", locale));
        if !encoding.eq_ignore_ascii_case("utf8") && !encoding.eq_ignore_ascii_case("utf-8") {
            return None;
        }
        if name.is_empty() || name == "C" { return Some(""); }
        let mut parts = name.split(['-', '_']);
        let language = parts.next()?;
        if !(2..=8).contains(&language.len()) || language.len() == 4 || !language.bytes().all(|b| b.is_ascii_alphabetic())
            || !parts.all(|p| (1..=8).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_alphanumeric())) {
            return None;
        }
        Some(name)
    }

    fn unicode(&self) -> Result<bool, (String, i32)> {
        if matches!(self.ctype, "C" | "POSIX") { return Ok(false); }
        if Self::utf8_language(self.ctype).is_some() { return Ok(true); }
        Err(("expr: character operations require C/POSIX or a UTF-8 locale\n".into(), 2))
    }

    fn compare(&self, left: &str, right: &str, equality: bool) -> Result<std::cmp::Ordering, (String, i32)> {
        let a = crate::vfs::stream_string_to_bytes(left);
        let b = crate::vfs::stream_string_to_bytes(right);
        if equality || matches!(self.collate, "C" | "POSIX") { return Ok(a.cmp(&b)); }
        let error = || ("expr: string comparison requires C/POSIX or a supported UTF-8 collation locale\n".to_string(), 2);
        let language = Self::utf8_language(self.collate).ok_or_else(error)?;
        if language.is_empty() { return Ok(a.cmp(&b)); }
        let collator = crate::intl::Collator::open(&language.replace('_', "-"), true).ok_or_else(error)?;
        let a = String::from_utf8_lossy(a.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&a));
        let b = String::from_utf8_lossy(b.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&b));
        collator.compare(&a, &b).map_err(|_| error())
    }
}

fn expr_units(mut bytes: &[u8], unicode: bool) -> impl Iterator<Item = &[u8]> {
    std::iter::from_fn(move || {
        let width = match *bytes.first()? {
            0xc2..=0xdf if unicode => 2,
            0xe0..=0xef if unicode => 3,
            0xf0..=0xf4 if unicode => 4,
            _ => 1,
        };
        let width = if width == 1 || bytes.get(..width).is_some_and(|s| std::str::from_utf8(s).is_ok()) { width } else { 1 };
        let (unit, rest) = bytes.split_at(width);
        bytes = rest;
        Some(unit)
    })
}

fn quote_bytes(value: &[u8]) -> String {
    use std::fmt::Write;
    let mut out = String::from("'");
    for &byte in value {
        match byte {
            b'\'' => out.push_str("\\'"),
            b'\\' => out.push_str("\\\\"),
            7..=13 => { out.push('\\'); out.push(b"abtnvfr"[usize::from(byte - 7)] as char); }
            32..=126 => out.push(char::from(byte)),
            _ => write!(out, "\\{byte:03o}").unwrap(),
        }
    }
    out.push('\'');
    out
}

fn is_expr_truthy(v: &str) -> bool {
    if v.is_empty() {
        return false;
    }
    let rest = v.strip_prefix('-').unwrap_or(v);
    if !rest.is_empty() && rest.bytes().all(|b| b == b'0') {
        return false;
    }
    true
}

fn parse_expr_int(v: &str) -> Option<(bool, &str)> {
    let rest = v.strip_prefix('-').unwrap_or(v);
    if rest.is_empty() || !rest.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let digits = rest.trim_start_matches('0');
    Some(if digits.is_empty() { (false, "0") } else { (v.starts_with('-'), digits) })
}

fn expr_arithmetic(left: &str, op: &str, right: &str) -> Result<String, (String, i32)> {
    let (Some((neg_a, a)), Some((neg_b, b))) = (parse_expr_int(left), parse_expr_int(right)) else {
        return Err(("expr: non-integer argument\n".to_string(), 2));
    };
    let digits = |s: &str| s.bytes().map(|b| b - b'0').collect::<Vec<_>>();
    let (a, b) = (digits(a), digits(b));
    let (negative, magnitude) = match op {
        "+" | "-" => {
            let neg_b = neg_b ^ (op == "-");
            if neg_a == neg_b {
                (neg_a, big_add(&a, &b))
            } else if big_cmp(&a, &b).is_lt() {
                (neg_b, big_sub(&b, &a))
            } else {
                (neg_a, big_sub(&a, &b))
            }
        }
        "*" => (neg_a ^ neg_b, big_mul(&a, &b)),
        "/" | "%" => {
            if b == [0] {
                return Err(("expr: division by zero\n".to_string(), 2));
            }
            let (quotient, remainder) = big_div_rem(&a, &b);
            if op == "/" { (neg_a ^ neg_b, quotient) } else { (neg_a, remainder) }
        }
        _ => unreachable!(),
    };
    Ok(format_big_with_scale(&magnitude, 0, negative))
}

fn eval_expr_or(args: &[String], pos: &mut usize, active: bool, locale: &ExprLocale<'_>) -> Result<String, (String, i32)> {
    let mut left = eval_expr_and(args, pos, active, locale)?;
    while *pos < args.len() && args[*pos] == "|" {
        *pos += 1;
        let left_truth = active && is_expr_truthy(&left);
        let right = eval_expr_and(args, pos, active && !left_truth, locale)?;
        if active && !left_truth {
            left = if is_expr_truthy(&right) {
                right
            } else {
                "0".to_string()
            };
        }
    }
    Ok(left)
}

fn eval_expr_and(args: &[String], pos: &mut usize, active: bool, locale: &ExprLocale<'_>) -> Result<String, (String, i32)> {
    let mut left = eval_expr_cmp(args, pos, active, locale)?;
    while *pos < args.len() && args[*pos] == "&" {
        *pos += 1;
        let left_truth = active && is_expr_truthy(&left);
        let right = eval_expr_cmp(args, pos, active && left_truth, locale)?;
        if active && !(left_truth && is_expr_truthy(&right)) {
            left = "0".to_string();
        }
    }
    Ok(left)
}

fn eval_expr_cmp(args: &[String], pos: &mut usize, active: bool, locale: &ExprLocale<'_>) -> Result<String, (String, i32)> {
    let mut left = eval_expr_add(args, pos, active, locale)?;
    while *pos < args.len() && matches!(args[*pos].as_str(), "=" | "==" | "!=" | "<" | "<=" | ">" | ">=") {
        let op = args[*pos].clone();
        *pos += 1;
        let right = eval_expr_add(args, pos, active, locale)?;
        if active {
            let order = if let (Some((neg_a, a)), Some((neg_b, b))) = (parse_expr_int(&left), parse_expr_int(&right)) {
                let magnitude = a.len().cmp(&b.len()).then_with(|| a.cmp(b));
                neg_b.cmp(&neg_a).then(if neg_a { magnitude.reverse() } else { magnitude })
            } else {
                locale.compare(&left, &right, matches!(op.as_str(), "=" | "==" | "!="))?
            };
            let res = match op.as_str() {
                "=" | "==" => order.is_eq(),
                "!=" => !order.is_eq(),
                "<" => order.is_lt(),
                "<=" => order.is_le(),
                ">" => order.is_gt(),
                ">=" => order.is_ge(),
                _ => unreachable!(),
            };
            left = if res { "1".to_string() } else { "0".to_string() };
        }
    }
    Ok(left)
}

fn eval_expr_add(args: &[String], pos: &mut usize, active: bool, locale: &ExprLocale<'_>) -> Result<String, (String, i32)> {
    let mut left = eval_expr_mul(args, pos, active, locale)?;
    while *pos < args.len() && matches!(args[*pos].as_str(), "+" | "-") {
        let op = args[*pos].clone();
        *pos += 1;
        let right = eval_expr_mul(args, pos, active, locale)?;
        if active {
            left = expr_arithmetic(&left, &op, &right)?;
        }
    }
    Ok(left)
}

fn eval_expr_mul(args: &[String], pos: &mut usize, active: bool, locale: &ExprLocale<'_>) -> Result<String, (String, i32)> {
    let mut left = eval_expr_match(args, pos, active, locale)?;
    while *pos < args.len() && matches!(args[*pos].as_str(), "*" | "/" | "%") {
        let op = args[*pos].clone();
        *pos += 1;
        let right = eval_expr_match(args, pos, active, locale)?;
        if active {
            left = expr_arithmetic(&left, &op, &right)?;
        }
    }
    Ok(left)
}

fn eval_expr_colon(lhs: &str, pat: &str, locale: &ExprLocale<'_>) -> Result<String, (String, i32)> {
    locale.unicode()?;
    if !matches!(locale.collate, "C" | "POSIX") && ExprLocale::utf8_language(locale.collate).is_none() {
        let mut bytes = pat.bytes();
        while let Some(byte) = bytes.next() {
            if byte == b'\\' { bytes.next(); }
            else if byte == b'[' {
                return Err(("expr: unsupported BRE: bracket expressions require C/POSIX or UTF-8 LC_CTYPE and LC_COLLATE\n".into(), 2));
            }
        }
    }
    crate::commands::search::expr_match(lhs, pat).map_err(|message| (format!("expr: {message}\n"), 2))
}

fn eval_expr_match(args: &[String], pos: &mut usize, active: bool, locale: &ExprLocale<'_>) -> Result<String, (String, i32)> {
    let mut left = eval_expr_primary(args, pos, active, locale)?;
    while *pos < args.len() && args[*pos] == ":" {
        *pos += 1;
        let right = eval_expr_primary(args, pos, active, locale)?;
        if active {
            left = eval_expr_colon(&left, &right, locale)?;
        }
    }
    Ok(left)
}

fn eval_expr_primary(args: &[String], pos: &mut usize, active: bool, locale: &ExprLocale<'_>) -> Result<String, (String, i32)> {
    if *pos >= args.len() {
        return Err((format!("expr: syntax error: missing argument after {}\n", quote_bytes(args[*pos - 1].as_bytes())), 2));
    }
    let tok = &args[*pos];
    if tok == ")" {
        return Err(("expr: syntax error: unexpected ')'\n".to_string(), 2));
    }
    if tok == "(" {
        *pos += 1;
        let val = eval_expr_or(args, pos, active, locale)?;
        if *pos == args.len() {
            return Err((format!("expr: syntax error: expecting ')' after {}\n", quote_bytes(args[*pos - 1].as_bytes())), 2));
        }
        if args[*pos] != ")" {
            return Err((format!("expr: syntax error: expecting ')' instead of {}\n", quote_bytes(args[*pos].as_bytes())), 2));
        }
        *pos += 1;
        return Ok(val);
    }
    if tok == "+" {
        *pos += 1;
        if *pos >= args.len() {
            return Err(("expr: syntax error: missing argument after '+'\n".to_string(), 2));
        }
        let lit = args[*pos].clone();
        *pos += 1;
        return Ok(lit);
    }
    if tok == "length" {
        *pos += 1;
        let s = eval_expr_primary(args, pos, active, locale)?;
        if !active { return Ok(String::new()); }
        let count = if locale.unicode()? {
            expr_units(&crate::vfs::stream_string_to_bytes(&s), true).count()
        } else {
            crate::vfs::stream_byte_len(&s)
        };
        return Ok(count.to_string());
    }
    if tok == "match" {
        *pos += 1;
        let s = eval_expr_primary(args, pos, active, locale)?;
        let pat = eval_expr_primary(args, pos, active, locale)?;
        return Ok(if active { eval_expr_colon(&s, &pat, locale)? } else { String::new() });
    }
    if tok == "substr" {
        *pos += 1;
        let s_str = eval_expr_primary(args, pos, active, locale)?;
        let p_str = eval_expr_primary(args, pos, active, locale)?;
        let l_str = eval_expr_primary(args, pos, active, locale)?;
        if !active {
            return Ok(String::new());
        }
        let unicode = locale.unicode()?;
        let bytes = crate::vfs::stream_string_to_bytes(&s_str);
        let index = |value: &str| match parse_expr_int(value) {
            Some((false, digits)) => digits.parse::<usize>().unwrap_or(usize::MAX),
            _ => 0,
        };
        let p = index(&p_str);
        let l = index(&l_str);
        if p == 0 || l == 0 || p > bytes.len() { return Ok(String::new()); }
        let (start, len) = if unicode {
            let mut units = expr_units(&bytes, true);
            let start = units.by_ref().take(p - 1).map(<[u8]>::len).sum::<usize>();
            (start, units.take(l).map(<[u8]>::len).sum::<usize>())
        } else {
            (p - 1, l.min(bytes.len() - (p - 1)))
        };
        return Ok(crate::vfs::bytes_to_stream_string(&bytes[start..start + len]));
    }
    if tok == "index" {
        *pos += 1;
        let s = eval_expr_primary(args, pos, active, locale)?;
        let chars_set = eval_expr_primary(args, pos, active, locale)?;
        if !active {
            return Ok(String::new());
        }
        let unicode = locale.unicode()?;
        let set_bytes = crate::vfs::stream_string_to_bytes(&chars_set);
        let set: std::collections::HashSet<_> = expr_units(&set_bytes, unicode).collect();
        let bytes = crate::vfs::stream_string_to_bytes(&s);
        let found = expr_units(&bytes, unicode).position(|unit| set.contains(unit)).map_or(0, |i| i + 1);
        return Ok(found.to_string());
    }
    *pos += 1;
    Ok(tok.clone())
}

#[derive(Clone, Debug)]
struct BcVal {
    val: f64,
    exact_int: Option<Vec<u8>>, // base-10 digits, most-significant first, non-negative
    neg: bool,
    scale: usize,
}

impl Default for BcVal {
    fn default() -> Self {
        Self::from_i64(0)
    }
}

impl BcVal {
    fn from_i64(n: i64) -> Self {
        let neg = n < 0;
        let abs = n.unsigned_abs();
        let digits = abs.to_string().bytes().map(|b| b - b'0').collect();
        Self {
            val: n as f64,
            exact_int: Some(digits),
            neg: neg && abs > 0,
            scale: 0,
        }
    }

    fn from_f64_scaled(v: f64, scale: usize) -> Self {
        Self {
            val: v,
            exact_int: None,
            neg: v < 0.0,
            scale,
        }
    }

    fn is_truthy(&self) -> bool {
        if let Some(ref d) = self.exact_int {
            d.iter().any(|&x| x != 0)
        } else {
            self.val.abs() >= 1e-15
        }
    }
}

fn big_trim(d: &mut Vec<u8>) {
    while d.len() > 1 && d[0] == 0 {
        d.remove(0);
    }
    if d.is_empty() {
        d.push(0);
    }
}

fn big_cmp(a: &[u8], b: &[u8]) -> std::cmp::Ordering {
    let mut ai = 0;
    while ai + 1 < a.len() && a[ai] == 0 {
        ai += 1;
    }
    let mut bi = 0;
    while bi + 1 < b.len() && b[bi] == 0 {
        bi += 1;
    }
    let aslice = &a[ai..];
    let bslice = &b[bi..];
    aslice.len().cmp(&bslice.len()).then_with(|| aslice.cmp(bslice))
}

fn big_add(a: &[u8], b: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(a.len().max(b.len()) + 1);
    let mut i = a.len();
    let mut j = b.len();
    let mut carry = 0u8;
    while i > 0 || j > 0 || carry > 0 {
        let da = if i > 0 { i -= 1; a[i] } else { 0 };
        let db = if j > 0 { j -= 1; b[j] } else { 0 };
        let sum = da + db + carry;
        out.push(sum % 10);
        carry = sum / 10;
    }
    out.reverse();
    big_trim(&mut out);
    out
}

fn big_sub(a: &[u8], b: &[u8]) -> Vec<u8> {
    // Assumes a >= b
    let mut out = Vec::with_capacity(a.len());
    let mut i = a.len();
    let mut j = b.len();
    let mut borrow = 0i16;
    while i > 0 {
        i -= 1;
        let da = a[i] as i16;
        let db = if j > 0 { j -= 1; b[j] as i16 } else { 0 };
        let mut diff = da - db - borrow;
        if diff < 0 {
            diff += 10;
            borrow = 1;
        } else {
            borrow = 0;
        }
        out.push(diff as u8);
    }
    out.reverse();
    big_trim(&mut out);
    out
}

fn big_mul(a: &[u8], b: &[u8]) -> Vec<u8> {
    if (a.len() == 1 && a[0] == 0) || (b.len() == 1 && b[0] == 0) {
        return vec![0];
    }
    let mut res = vec![0u32; a.len() + b.len()];
    for (i, &da) in a.iter().enumerate().rev() {
        for (j, &db) in b.iter().enumerate().rev() {
            res[i + j + 1] += u32::from(da) * u32::from(db);
        }
    }
    for k in (1..res.len()).rev() {
        let carry = res[k] / 10;
        res[k] %= 10;
        res[k - 1] += carry;
    }
    let mut out: Vec<u8> = res.into_iter().map(|x| x as u8).collect();
    big_trim(&mut out);
    out
}

fn big_div_rem(a: &[u8], b: &[u8]) -> (Vec<u8>, Vec<u8>) {
    if b.is_empty() || (b.len() == 1 && b[0] == 0) {
        return (vec![0], vec![0]);
    }
    let mut quot = Vec::with_capacity(a.len());
    let mut rem = Vec::new();
    for &digit in a {
        rem.push(digit);
        big_trim(&mut rem);
        let mut q = 0u8;
        while big_cmp(&rem, b) != std::cmp::Ordering::Less {
            rem = big_sub(&rem, b);
            q += 1;
        }
        quot.push(q);
    }
    big_trim(&mut quot);
    big_trim(&mut rem);
    (quot, rem)
}

fn big_pow(base: &[u8], mut exp: u32) -> Vec<u8> {
    let mut result = vec![1u8];
    let mut b = base.to_vec();
    while exp > 0 {
        if exp & 1 == 1 {
            result = big_mul(&result, &b);
        }
        exp >>= 1;
        if exp > 0 {
            b = big_mul(&b, &b);
        }
    }
    result
}

fn big_sqrt_scaled(n: &[u8], scale: usize) -> String {
    // Compute floor(sqrt(n * 10^(2 * scale))) via digit-by-digit / Newton in big_int
    let mut target = n.to_vec();
    target.extend(std::iter::repeat_n(0u8, scale * 2));
    big_trim(&mut target);
    if target.len() == 1 && target[0] == 0 {
        return if scale == 0 {
            "0".to_string()
        } else {
            format!(".{}", "0".repeat(scale))
        };
    }
    // Initial guess: 10^((target.len() + 1) / 2)
    let mut x = vec![1u8];
    x.extend(std::iter::repeat_n(0u8, target.len().div_ceil(2)));
    let two = vec![2u8];
    for _ in 0..80 {
        let (q, _) = big_div_rem(&target, &x);
        let sum = big_add(&x, &q);
        let (nx, _) = big_div_rem(&sum, &two);
        if big_cmp(&nx, &x) != std::cmp::Ordering::Less {
            break;
        }
        x = nx;
    }
    format_big_with_scale(&x, scale, false)
}

fn format_big_with_scale(digits: &[u8], scale: usize, neg: bool) -> String {
    if scale == 0 {
        let s: String = digits.iter().map(|&d| (b'0' + d) as char).collect();
        return if neg && s != "0" { format!("-{s}") } else { s };
    }
    let mut padded = Vec::new();
    if digits.len() <= scale {
        padded.extend(std::iter::repeat_n(0u8, scale - digits.len()));
        padded.extend_from_slice(digits);
        let frac: String = padded.iter().map(|&d| (b'0' + d) as char).collect();
        if padded.iter().all(|&d| d == 0) {
            return "0".to_string();
        }
        return if neg { format!("-.{frac}") } else { format!(".{frac}") };
    }
    let split_at = digits.len() - scale;
    let int_s: String = digits[..split_at].iter().map(|&d| (b'0' + d) as char).collect();
    let frac_s: String = digits[split_at..].iter().map(|&d| (b'0' + d) as char).collect();
    if neg {
        format!("-{int_s}.{frac_s}")
    } else {
        format!("{int_s}.{frac_s}")
    }
}

#[derive(Default, Clone)]
struct BcEnv {
    vars: BTreeMap<String, BcVal>,
    funcs: BTreeMap<String, (Vec<String>, String)>,
    scale: usize,
    ibase: u32,
    obase: u32,
    last_str_out: Option<String>,
    last: BcVal,
    runtime_err: Option<String>,
}

fn format_bc_base(mut n: u128, obase: u32) -> String {
    if n == 0 {
        return "0".to_string();
    }
    let digits = b"0123456789ABCDEF";
    let mut chars = Vec::new();
    let b = u128::from(obase.clamp(2, 16));
    while n > 0 {
        let rem = (n % b) as usize;
        chars.push(digits[rem] as char);
        n /= b;
    }
    chars.reverse();
    chars.into_iter().collect()
}

fn extract_bc_defines(input: &str, bc: &mut BcEnv) -> String {
    let mut remaining = String::new();
    let mut rest = input;
    while !rest.is_empty() {
        if let Some(literal) = rest.strip_prefix('"') {
            let size = literal.find('"').map_or(rest.len(), |end| end + 2);
            remaining.push_str(&rest[..size]);
            rest = &rest[size..];
            continue;
        }
        if let Some(after_def) = rest.strip_prefix("define ") {
            if let Some(open_p) = after_def.find('(')
                && let Some(close_p_rel) = after_def[open_p + 1..].find(')')
            {
                let close_p = open_p + 1 + close_p_rel;
                let fname = after_def[..open_p].trim().to_string();
                let params: Vec<String> = after_def[open_p + 1..close_p]
                    .split(',')
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                    .collect();
                let after_params = &after_def[close_p + 1..];
                if let Some(open_b) = after_params.find('{') {
                    let body_sub = &after_params[open_b + 1..];
                    let mut depth = 1i32;
                    let mut end_b = None;
                    let mut quoted = false;
                    for (bi, ch) in body_sub.char_indices() {
                        if ch == '"' { quoted = !quoted; }
                        if quoted { continue; }
                        if ch == '{' {
                            depth += 1;
                        } else if ch == '}' {
                            depth -= 1;
                            if depth == 0 {
                                end_b = Some(bi);
                                break;
                            }
                        }
                    }
                    if let Some(eb) = end_b {
                        let body = body_sub[..eb].trim().to_string();
                        bc.funcs.insert(fname, (params, body));
                        rest = &body_sub[eb + 1..];
                        continue;
                    }
                }
            }
        }
        let ch = rest.chars().next().unwrap();
        remaining.push(ch);
        rest = &rest[ch.len_utf8()..];
    }
    remaining
}

fn cmd_bc(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut mathlib = false;
    let mut exprs: Vec<String> = Vec::new();
    let mut files = Vec::new();
    let mut ended = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if ended {
            files.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if a == "--mathlib" {
            mathlib = true;
            i += 1;
        } else if a == "--expression" {
            exprs.push(args.get(i + 1).cloned().unwrap_or_default());
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--expression=") {
            exprs.push(rest.to_string());
            i += 1;
        } else if matches!(a.as_str(), "--quiet" | "--interactive" | "--warn" | "--standard") {
            i += 1;
        } else if a.starts_with('-') && a.len() > 1 {
            let chars: Vec<char> = a.chars().collect();
            let mut ci = 1usize;
            while ci < chars.len() {
                let f = chars[ci];
                if f == 'l' {
                    mathlib = true;
                } else if f == 'e' {
                    let rest: String = chars[ci + 1..].iter().collect();
                    if !rest.is_empty() {
                        exprs.push(rest);
                    } else {
                        i += 1;
                        exprs.push(args.get(i).cloned().unwrap_or_default());
                    }
                    break;
                } else if matches!(f, 'q' | 'i' | 'w' | 's') {
                    // valid no-op flags
                } else {
                    return err_out(&format!("bc: invalid option -- '{f}'\n"), 2);
                }
                ci += 1;
            }
            i += 1;
        } else {
            files.push(a.clone());
            i += 1;
        }
    }
    let mut input = String::new();
    for e in &exprs {
        input.push_str(e);
        input.push('\n');
    }
    if !files.is_empty() {
        match read_inputs_or_stdin(&files, stdin, cwd, fs, "bc") {
            Ok(t) => input.push_str(&t),
            Err(e) => return e,
        }
    } else if exprs.is_empty() {
        input.push_str(stdin);
    }
    let mut bc = BcEnv {
        vars: BTreeMap::new(),
        funcs: BTreeMap::new(),
        scale: if mathlib { 20 } else { 0 },
        ibase: 10,
        obase: 10,
        last_str_out: None,
        last: BcVal::default(),
        runtime_err: None,
    };
    let mut no_comments = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                no_comments.push(ch);
                for literal in chars.by_ref() {
                    no_comments.push(literal);
                    if literal == '"' { break; }
                }
            }
            '#' => {
                while let Some(c) = chars.next() {
                    if c == '\\' && chars.next_if_eq(&'\n').is_some() { continue; }
                    if c == '\n' { no_comments.push(c); break; }
                }
            }
            '/' if chars.next_if_eq(&'*').is_some() => {
                while let Some(c) = chars.next() {
                    if c == '*' && chars.next_if_eq(&'/').is_some() { break; }
                }
                no_comments.push(' ');
            }
            '\\' if chars.next_if_eq(&'\n').is_some() => {}
            _ => no_comments.push(ch),
        }
    }
    let body = extract_bc_defines(&no_comments, &mut bc);
    let mut out = String::new();
    for stmt in split_bc_top_stmts(&body) {
        let flow = exec_bc_stmt(&stmt, &mut bc, &mut out, 0);
        if matches!(flow, BcFlow::Halt) || bc.runtime_err.is_some() {
            break;
        }
    }
    if let Some(err_msg) = bc.runtime_err {
        return BuiltinOutcome {
            stdout: out,
            stderr: format!("bc: {err_msg}\n"),
            exit_code: 1,
        };
    }
    ok_out(&out)
}

#[derive(Clone, Debug)]
enum BcFlow {
    None,
    Break,
    Continue,
    Halt,
    Return(BcVal),
}

fn split_bc_top_stmts(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut pdepth = 0i32;
    let mut bdepth = 0i32;
    let mut in_quote = false;
    for (idx, ch) in s.char_indices() {
        if ch == '"' {
            in_quote = !in_quote;
            cur.push(ch);
            continue;
        }
        if in_quote {
            cur.push(ch);
            continue;
        }
        match ch {
            '(' => {
                pdepth += 1;
                cur.push(ch);
            }
            ')' => {
                pdepth -= 1;
                cur.push(ch);
            }
            '{' => {
                bdepth += 1;
                cur.push(ch);
            }
            '}' => {
                bdepth -= 1;
                cur.push(ch);
                if pdepth == 0 && bdepth == 0 {
                    if s[idx + 1..].trim_start().starts_with("else") {
                        continue;
                    }
                    let t = cur.trim();
                    if !t.is_empty() {
                        out.push(t.to_string());
                    }
                    cur.clear();
                }
            }
            ';' | '\n' if pdepth == 0 && bdepth == 0 => {
                if cur.trim_start().starts_with("if") && s[idx + 1..].trim_start().starts_with("else") {
                    cur.push(' ');
                    continue;
                }
                let t = cur.trim();
                if !t.is_empty() {
                    out.push(t.to_string());
                }
                cur.clear();
            }
            _ => cur.push(ch),
        }
    }
    let t = cur.trim();
    if !t.is_empty() {
        out.push(t.to_string());
    }
    out
}

fn resolve_bc_lvalue_key(lhs: &str, bc: &mut BcEnv, depth: usize) -> String {
    let t = lhs.trim();
    if let Some(open_b) = t.find('[')
        && t.ends_with(']')
    {
        let arr = t[..open_b].trim();
        let idx_expr = &t[open_b + 1..t.len() - 1];
        let idx = eval_bc_val(idx_expr, bc, depth + 1).val.round() as i64;
        return format!("{arr}[{idx}]");
    }
    t.to_string()
}

fn format_bc_val_line(v: &BcVal, expr_s: &str, bc: &BcEnv) -> String {
    if let Some(ref exact_s) = bc.last_str_out {
        return exact_s.clone();
    }
    if bc.obase != 10 {
        let n = if let Some(ref d) = v.exact_int {
            let mut acc = 0u128;
            for &dig in d {
                acc = acc.saturating_mul(10).saturating_add(u128::from(dig));
            }
            acc
        } else {
            v.val.trunc().max(0.0) as u128
        };
        return format_bc_base(n, bc.obase);
    }
    if let Some(ref d) = v.exact_int
        && (v.scale == 0 || v.scale > 12)
    {
        return format_big_with_scale(d, v.scale, v.neg);
    }
    let uses_scale = expr_s.contains('/')
        || expr_s.contains("sqrt(")
        || expr_s.contains("s(")
        || expr_s.contains("c(")
        || expr_s.contains("a(")
        || expr_s.contains("l(")
        || expr_s.contains("e(")
        || v.scale > 0;
    if !uses_scale && bc_expr_decimal_places(expr_s) == 0 {
        return format!("{}", v.val.round() as i128);
    }
    let sc = if v.scale > 0 {
        v.scale
    } else {
        bc.scale.max(bc_expr_decimal_places(expr_s))
    };
    if sc == 0 {
        return format!("{}", v.val.trunc() as i128);
    }
    let mut formatted = if sc <= 12 {
        let factor = 10f64.powi(sc as i32);
        let trunc_val = ((v.val + 1e-12 * v.val.signum()) * factor).trunc() / factor;
        format!("{trunc_val:.sc$}")
    } else {
        format!("{:.sc$}", v.val)
    };
    if let Some(rest) = formatted.strip_prefix("0.") {
        if rest.chars().all(|c| c == '0') {
            formatted = "0".to_string();
        } else {
            formatted = format!(".{rest}");
        }
    } else if let Some(rest) = formatted.strip_prefix("-0.") {
        if rest.chars().all(|c| c == '0') {
            formatted = "0".to_string();
        } else {
            formatted = format!("-.{rest}");
        }
    }
    formatted
}

fn exec_bc_stmt(raw: &str, bc: &mut BcEnv, out: &mut String, depth: usize) -> BcFlow {
    let s = raw.trim();
    if s.is_empty() || s.starts_with("auto ") || s == "auto" {
        return BcFlow::None;
    }
    if s == "halt" || s == "quit" {
        return BcFlow::Halt;
    }
    if s == "break" {
        return BcFlow::Break;
    }
    if s == "continue" {
        return BcFlow::Continue;
    }
    if s == "return" {
        return BcFlow::Return(BcVal::from_i64(0));
    }
    if let Some(ret_rest) = s.strip_prefix("return")
        && (ret_rest.starts_with(' ') || ret_rest.starts_with('('))
    {
        let v = eval_bc_val(ret_rest.trim(), bc, depth + 1);
        return BcFlow::Return(v);
    }
    if s.starts_with('{') && s.ends_with('}') {
        for st in split_bc_top_stmts(&s[1..s.len() - 1]) {
            let flow = exec_bc_stmt(&st, bc, out, depth + 1);
            if !matches!(flow, BcFlow::None) {
                return flow;
            }
        }
        return BcFlow::None;
    }
    if let Some(literal) = s.strip_prefix('"').and_then(|s| s.strip_suffix('"')) {
        out.push_str(literal);
        return BcFlow::None;
    }
    if let Some(print_rest) = s.strip_prefix("print ") {
        for item in split_bc_args(print_rest) {
            let t = item.trim();
            if t.starts_with('"') && t.ends_with('"') && t.len() >= 2 {
                let mut bytes = crate::vfs::stream_string_to_bytes(&t[1..t.len() - 1]);
                let mut end = 0;
                let mut i = 0;
                while i < bytes.len() {
                    let byte = bytes[i];
                    i += 1;
                    let decoded = if byte == b'\\' {
                        if i == bytes.len() { break; }
                        i += 1;
                        match bytes[i - 1] {
                            b'a' => 7, b'b' => 8, b'f' => 12, b'n' => b'\n',
                            b'q' => b'"', b'r' => b'\r', b't' => b'\t', b'\\' => b'\\',
                            _ => continue,
                        }
                    } else { byte };
                    bytes[end] = decoded;
                    end += 1;
                }
                out.push_str(&crate::vfs::bytes_to_stream_string(&bytes[..end]));
            } else {
                bc.last_str_out = None;
                let v = eval_bc_val(t, bc, depth + 1);
                if bc.runtime_err.is_some() {
                    return BcFlow::Halt;
                }
                bc.last = v.clone();
                out.push_str(&format_bc_val_line(&v, t, bc));
            }
        }
        return BcFlow::None;
    }
    if let Some(rest) = s.strip_prefix("while") {
        let r = rest.trim_start();
        if r.starts_with('(')
            && let Some(cp) = find_matching_close_paren(r)
        {
            let cond_s = &r[1..cp];
            let body_s = r[cp + 1..].trim();
            for _ in 0..100_000 {
                if !eval_bc_val(cond_s, bc, depth + 1).is_truthy() {
                    break;
                }
                let flow = exec_bc_stmt(body_s, bc, out, depth + 1);
                match flow {
                    BcFlow::None => {}
                    BcFlow::Continue => continue,
                    BcFlow::Break => break,
                    BcFlow::Halt => return BcFlow::Halt,
                    BcFlow::Return(v) => return BcFlow::Return(v),
                }
            }
            return BcFlow::None;
        }
    }
    if let Some(rest) = s.strip_prefix("for") {
        let r = rest.trim_start();
        if r.starts_with('(')
            && let Some(cp) = find_matching_close_paren(r)
        {
            let header = &r[1..cp];
            let parts: Vec<&str> = header.split(';').collect();
            if parts.len() == 3 {
                let body_s = r[cp + 1..].trim();
                if !parts[0].trim().is_empty() {
                    let _ = exec_bc_stmt(parts[0], bc, out, depth + 1);
                }
                for _ in 0..100_000 {
                    if !parts[1].trim().is_empty() && !eval_bc_val(parts[1], bc, depth + 1).is_truthy() {
                        break;
                    }
                    let flow = exec_bc_stmt(body_s, bc, out, depth + 1);
                    match flow {
                        BcFlow::None | BcFlow::Continue => {}
                        BcFlow::Break => break,
                        BcFlow::Halt => return BcFlow::Halt,
                        BcFlow::Return(v) => return BcFlow::Return(v),
                    }
                    if !parts[2].trim().is_empty() {
                        let _ = exec_bc_stmt(parts[2], bc, out, depth + 1);
                    }
                }
                return BcFlow::None;
            }
        }
    }
    if let Some(rest) = s.strip_prefix("if") {
        let r = rest.trim_start();
        if r.starts_with('(')
            && let Some(cp) = find_matching_close_paren(r)
        {
            let cond_s = &r[1..cp];
            let after_cond = r[cp + 1..].trim();
            let (then_s, else_s) = split_bc_if_branches(after_cond);
            if eval_bc_val(cond_s, bc, depth + 1).is_truthy() {
                return exec_bc_stmt(then_s, bc, out, depth + 1);
            } else if let Some(es) = else_s {
                return exec_bc_stmt(es, bc, out, depth + 1);
            }
            return BcFlow::None;
        }
    }
    if let Some(v) = s.strip_suffix("++").or_else(|| s.strip_prefix("++")) {
        let key = resolve_bc_lvalue_key(v, bc, depth);
        let cur = bc.vars.get(&key).cloned().unwrap_or_default();
        let next = apply_bc_binop(&cur, &BcVal::from_i64(1), "+", bc);
        bc.vars.insert(key, next);
        return BcFlow::None;
    }
    if let Some(v) = s.strip_suffix("--").or_else(|| s.strip_prefix("--")) {
        let key = resolve_bc_lvalue_key(v, bc, depth);
        let cur = bc.vars.get(&key).cloned().unwrap_or_default();
        let next = apply_bc_binop(&cur, &BcVal::from_i64(1), "-", bc);
        bc.vars.insert(key, next);
        return BcFlow::None;
    }
    for (op, bin_op) in [("+=", "+"), ("-=", "-"), ("*=", "*"), ("/=", "/"), ("%=", "%")] {
        if let Some((lhs, rhs)) = s.split_once(op) {
            let rv = eval_bc_val(rhs.trim(), bc, depth + 1);
            let key = resolve_bc_lvalue_key(lhs, bc, depth);
            let cur = bc.vars.get(&key).cloned().unwrap_or_default();
            let next = apply_bc_binop(&cur, &rv, bin_op, bc);
            bc.vars.insert(key, next);
            return BcFlow::None;
        }
    }
    if let Some(rest) = s.strip_prefix("scale")
        && let Some(val_s) = rest.trim().strip_prefix('=')
        && !val_s.starts_with('=')
    {
        bc.scale = eval_bc_val(val_s.trim(), bc, depth + 1).val.max(0.0) as usize;
        return BcFlow::None;
    }
    if let Some(rest) = s.strip_prefix("ibase")
        && let Some(val_s) = rest.trim().strip_prefix('=')
        && !val_s.starts_with('=')
    {
        let v = eval_bc_val(val_s.trim(), bc, depth + 1).val.round() as u32;
        bc.ibase = v.clamp(2, 16);
        return BcFlow::None;
    }
    if let Some(rest) = s.strip_prefix("obase")
        && let Some(val_s) = rest.trim().strip_prefix('=')
        && !val_s.starts_with('=')
    {
        let v = eval_bc_val(val_s.trim(), bc, depth + 1).val.round() as u32;
        bc.obase = v.clamp(2, 16);
        return BcFlow::None;
    }
    if let Some((lhs, rhs)) = split_top_level_assign(s) {
        bc.last_str_out = None;
        let mut v = eval_bc_val(rhs.trim(), bc, depth + 1);
        if let Some(str_out) = bc.last_str_out.take()
            && let Ok(fv) = str_out.parse::<f64>()
        {
            let sc = str_out.split_once('.').map(|(_, f)| f.len()).unwrap_or(0);
            let digits: Option<Vec<u8>> = if (sc == 0 && str_out.bytes().all(|b| b.is_ascii_digit()))
                || sc > 12
            {
                Some(
                    str_out
                        .bytes()
                        .filter(|b| b.is_ascii_digit())
                        .map(|b| b - b'0')
                        .collect(),
                )
            } else {
                None
            };
            v = BcVal {
                val: fv,
                exact_int: digits,
                neg: fv < 0.0,
                scale: sc,
            };
        }
        let key = resolve_bc_lvalue_key(lhs, bc, depth);
        if key == "last" {
            bc.last = v.clone();
        }
        bc.vars.insert(key, v);
        return BcFlow::None;
    }
    bc.last_str_out = None;
    let val = eval_bc_val(s, bc, depth + 1);
    if bc.runtime_err.is_some() {
        return BcFlow::Halt;
    }
    bc.last = val.clone();
    let line = format_bc_val_line(&val, s, bc);
    out.push_str(&line);
    out.push('\n');
    BcFlow::None
}

fn find_matching_close_paren(s: &str) -> Option<usize> {
    let mut pdepth = 0i32;
    for (idx, ch) in s.char_indices() {
        if ch == '(' {
            pdepth += 1;
        } else if ch == ')' {
            pdepth -= 1;
            if pdepth == 0 {
                return Some(idx);
            }
        }
    }
    None
}

fn split_bc_if_branches(after_cond: &str) -> (&str, Option<&str>) {
    let t = after_cond.trim();
    if t.starts_with('{') {
        let mut bdepth = 0i32;
        for (idx, ch) in t.char_indices() {
            if ch == '{' {
                bdepth += 1;
            } else if ch == '}' {
                bdepth -= 1;
                if bdepth == 0 {
                    let then_s = &t[..=idx];
                    let rem = t[idx + 1..].trim();
                    let else_s = rem.strip_prefix("else").map(|e| e.trim());
                    return (then_s, else_s);
                }
            }
        }
    }
    if let Some((ts, es)) = t.split_once(" else ") {
        return (ts.trim().trim_end_matches(';'), Some(es.trim()));
    }
    (t, None)
}

fn split_top_level_assign(s: &str) -> Option<(&str, &str)> {
    let bytes = s.as_bytes();
    let mut pdepth = 0i32;
    let mut bdepth = 0i32;
    for i in 0..bytes.len() {
        match bytes[i] {
            b'(' => pdepth += 1,
            b')' => pdepth -= 1,
            b'[' => bdepth += 1,
            b']' => bdepth -= 1,
            b'=' if pdepth == 0 && bdepth == 0 => {
                let prev = if i > 0 { bytes[i - 1] } else { 0 };
                let next = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
                if !matches!(prev, b'<' | b'>' | b'!' | b'=' | b'+' | b'-' | b'*' | b'/' | b'%')
                    && next != b'='
                {
                    return Some((&s[..i], &s[i + 1..]));
                }
            }
            _ => {}
        }
    }
    None
}

fn split_bc_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut pdepth = 0i32;
    let mut bdepth = 0i32;
    let mut in_quote = false;
    for ch in s.chars() {
        if ch == '"' {
            in_quote = !in_quote;
            cur.push(ch);
            continue;
        }
        if !in_quote {
            match ch {
                '(' => pdepth += 1,
                ')' => pdepth -= 1,
                '[' => bdepth += 1,
                ']' => bdepth -= 1,
                ',' if pdepth == 0 && bdepth == 0 => {
                    out.push(cur.trim().to_string());
                    cur.clear();
                    continue;
                }
                _ => {}
            }
        }
        cur.push(ch);
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

fn apply_bc_binop(l: &BcVal, r: &BcVal, op: &str, bc: &mut BcEnv) -> BcVal {
    if matches!(op, "/" | "%")
        && (r.val == 0.0 || r.exact_int.as_deref() == Some(&[0]))
    {
        if bc.runtime_err.is_none() {
            bc.runtime_err = Some("Runtime error (func=(main), adr=0): Divide by zero".to_string());
        }
        return BcVal::from_i64(0);
    }
    if let (Some(la), Some(ra)) = (&l.exact_int, &r.exact_int)
        && l.scale == 0
        && r.scale == 0
    {
        match op {
            "+" | "-" => {
                let eff_r_neg = if op == "-" { !r.neg } else { r.neg };
                let (digits, neg) = if l.neg == eff_r_neg {
                    (big_add(la, ra), l.neg)
                } else {
                    match big_cmp(la, ra) {
                        std::cmp::Ordering::Greater => (big_sub(la, ra), l.neg),
                        std::cmp::Ordering::Less => (big_sub(ra, la), eff_r_neg),
                        std::cmp::Ordering::Equal => (vec![0], false),
                    }
                };
                let f = digits.iter().fold(0.0f64, |acc, &d| acc * 10.0 + f64::from(d));
                let is_zero = digits.len() == 1 && digits[0] == 0;
                return BcVal {
                    val: if neg && !is_zero { -f } else { f },
                    exact_int: Some(digits),
                    neg: neg && !is_zero,
                    scale: 0,
                };
            }
            "*" => {
                let digits = big_mul(la, ra);
                let neg = l.neg ^ r.neg;
                let is_zero = digits.len() == 1 && digits[0] == 0;
                let f = digits.iter().fold(0.0f64, |acc, &d| acc * 10.0 + f64::from(d));
                return BcVal {
                    val: if neg && !is_zero { -f } else { f },
                    exact_int: Some(digits),
                    neg: neg && !is_zero,
                    scale: 0,
                };
            }
            "/" if bc.scale == 0 => {
                let (quot, _) = big_div_rem(la, ra);
                let neg = l.neg ^ r.neg;
                let is_zero = quot.len() == 1 && quot[0] == 0;
                let f = quot.iter().fold(0.0f64, |acc, &d| acc * 10.0 + f64::from(d));
                return BcVal {
                    val: if neg && !is_zero { -f } else { f },
                    exact_int: Some(quot),
                    neg: neg && !is_zero,
                    scale: 0,
                };
            }
            "%" if bc.scale == 0 => {
                let (_, rem) = big_div_rem(la, ra);
                let is_zero = rem.len() == 1 && rem[0] == 0;
                let f = rem.iter().fold(0.0f64, |acc, &d| acc * 10.0 + f64::from(d));
                return BcVal {
                    val: if l.neg && !is_zero { -f } else { f },
                    exact_int: Some(rem),
                    neg: l.neg && !is_zero,
                    scale: 0,
                };
            }
            "^" => {
                let exp = r.val.round().max(0.0) as u32;
                let digits = big_pow(la, exp);
                let neg = l.neg && (exp % 2 == 1);
                let is_zero = digits.len() == 1 && digits[0] == 0;
                let f = digits.iter().fold(0.0f64, |acc, &d| acc * 10.0 + f64::from(d));
                return BcVal {
                    val: if neg && !is_zero { -f } else { f },
                    exact_int: Some(digits),
                    neg: neg && !is_zero,
                    scale: 0,
                };
            }
            _ => {}
        }
    }
    let lv = l.val;
    let rv = r.val;
    match op {
        "+" => BcVal::from_f64_scaled(lv + rv, l.scale.max(r.scale)),
        "-" => BcVal::from_f64_scaled(lv - rv, l.scale.max(r.scale)),
        "*" => {
            let raw_sc = l.scale + r.scale;
            let sc = raw_sc.min(bc.scale.max(l.scale.max(r.scale)));
            BcVal::from_f64_scaled(lv * rv, sc)
        }
        "/" => {
            if rv == 0.0 {
                BcVal::from_i64(0)
            } else if bc.scale == 0 {
                BcVal::from_i64((lv / rv).trunc() as i64)
            } else if bc.scale <= 12 {
                let factor = 10f64.powi(bc.scale as i32);
                let q = lv / rv;
                let eps = if q >= 0.0 { 1e-12 } else { -1e-12 };
                let truncated = ((q * factor) + eps).trunc() / factor;
                BcVal::from_f64_scaled(truncated, bc.scale)
            } else {
                BcVal::from_f64_scaled(lv / rv, bc.scale)
            }
        }
        "%" => {
            if rv == 0.0 {
                BcVal::from_i64(0)
            } else {
                BcVal::from_i64((lv as i64) % (rv as i64))
            }
        }
        "^" => BcVal::from_f64_scaled(lv.powf(rv), if l.scale == 0 { 0 } else { bc.scale }),
        _ => BcVal::default(),
    }
}

fn eval_bc_func(fname: &str, arg_vals: &[BcVal], bc: &mut BcEnv, depth: usize) -> Option<BcVal> {
    if depth > 256 {
        return Some(BcVal::default());
    }
    let (params, body) = bc.funcs.get(fname)?.clone();
    let stmts = split_bc_top_stmts(&body);
    let mut auto_names: Vec<String> = params.clone();
    for st in &stmts {
        if let Some(rest) = st.trim().strip_prefix("auto ") {
            for v in rest.split(',') {
                let vn = v.trim().trim_end_matches("[]").trim();
                if !vn.is_empty() {
                    auto_names.push(vn.to_string());
                }
            }
        }
    }
    let mut saved: Vec<(String, Option<BcVal>)> = Vec::new();
    let mut saved_arr_keys: Vec<(String, BcVal)> = Vec::new();
    for an in &auto_names {
        saved.push((an.clone(), bc.vars.remove(an)));
        let prefix = format!("{an}[");
        let arr_k: Vec<String> = bc.vars.keys().filter(|k| k.starts_with(&prefix)).cloned().collect();
        for k in arr_k {
            if let Some(v) = bc.vars.remove(&k) {
                saved_arr_keys.push((k, v));
            }
        }
    }
    for (idx, p) in params.iter().enumerate() {
        let val = arg_vals.get(idx).cloned().unwrap_or_default();
        bc.vars.insert(p.clone(), val);
    }
    let mut dummy_out = String::new();
    let mut ret_val = BcVal::default();
    for st in stmts {
        if let BcFlow::Return(v) = exec_bc_stmt(&st, bc, &mut dummy_out, depth + 1) {
            ret_val = v;
            break;
        }
    }
    for an in &auto_names {
        let prefix = format!("{an}[");
        let arr_k: Vec<String> = bc.vars.keys().filter(|k| k.starts_with(&prefix)).cloned().collect();
        for k in arr_k {
            bc.vars.remove(&k);
        }
    }
    for (k, v) in saved_arr_keys {
        bc.vars.insert(k, v);
    }
    for (an, old) in saved {
        if let Some(v) = old {
            bc.vars.insert(an, v);
        } else {
            bc.vars.remove(&an);
        }
    }
    Some(ret_val)
}

fn bc_expr_decimal_places(s: &str) -> usize {
    if ["==", "!=", "<=", ">=", "<", ">"].iter().any(|op| s.contains(op)) {
        return 0;
    }
    let mut max_dec = 0usize;
    for tok in s.split(|c: char| !c.is_ascii_digit() && c != '.') {
        if let Some((_, frac)) = tok.split_once('.') {
            max_dec = max_dec.max(frac.len());
        }
    }
    max_dec
}

fn eval_bc_val(expr: &str, bc: &mut BcEnv, depth: usize) -> BcVal {
    let s = expr.trim();
    if s.is_empty() {
        return BcVal::default();
    }
    if s == "last" || s == "." {
        return bc.last.clone();
    }
    if let Some(inner) = s.strip_prefix('(').and_then(|r| r.strip_suffix(')'))
        && balanced_parens(inner)
    {
        return eval_bc_val(inner, bc, depth);
    }
    for cmp_op in ["==", "!=", "<=", ">=", "<", ">"] {
        if let Some((lhs, rhs)) = s.split_once(cmp_op) {
            let l = eval_bc_val(lhs, bc, depth).val;
            let r = eval_bc_val(rhs, bc, depth).val;
            let ok = match cmp_op {
                "==" => (l - r).abs() < 1e-12,
                "!=" => (l - r).abs() >= 1e-12,
                "<=" => l <= r + 1e-12,
                ">=" => l + 1e-12 >= r,
                "<" => l < r,
                ">" => l > r,
                _ => false,
            };
            return BcVal::from_i64(if ok { 1 } else { 0 });
        }
    }
    if let Some((idx, op)) = rfind_top_level_add_sub(s) {
        if idx == 0 {
            let r = eval_bc_val(&s[1..], bc, depth);
            return if op == '-' {
                apply_bc_binop(&BcVal::from_i64(0), &r, "-", bc)
            } else {
                r
            };
        }
        let l = eval_bc_val(&s[..idx], bc, depth);
        let r = eval_bc_val(&s[idx + 1..], bc, depth);
        return apply_bc_binop(&l, &r, if op == '+' { "+" } else { "-" }, bc);
    }
    if let Some((idx, op)) = rfind_top_level_any(s, &['*', '/', '%']) {
        let l = eval_bc_val(&s[..idx], bc, depth);
        let r = eval_bc_val(&s[idx + 1..], bc, depth);
        let op_s = match op {
            '*' => "*",
            '/' => "/",
            _ => "%",
        };
        if op == '/'
            && r.val != 0.0
            && r.exact_int.as_deref() != Some(&[0])
            && bc.scale > 12
            && let (Some(la), Some(ra)) = (&l.exact_int, &r.exact_int)
            && l.scale == 0
            && r.scale == 0
        {
            let mut num = la.clone();
            num.extend(std::iter::repeat_n(0u8, bc.scale));
            let (q, _) = big_div_rem(&num, ra);
            let formatted = format_big_with_scale(&q, bc.scale, l.neg ^ r.neg);
            bc.last_str_out = Some(formatted);
        }
        return apply_bc_binop(&l, &r, op_s, bc);
    }
    if let Some(idx) = rfind_top_level(s, '^') {
        let l = eval_bc_val(&s[..idx], bc, depth);
        let r = eval_bc_val(&s[idx + 1..], bc, depth);
        return apply_bc_binop(&l, &r, "^", bc);
    }
    if let Some(open_p) = s.find('(')
        && s.ends_with(')')
        && s[..open_p].trim().chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        let fname = s[..open_p].trim();
        let arg_s = &s[open_p + 1..s.len() - 1];
        let raw_args = split_bc_args(arg_s);
        let arg_vals: Vec<BcVal> = raw_args.iter().map(|a| eval_bc_val(a, bc, depth + 1)).collect();
        let first_val = arg_vals.first().cloned().unwrap_or_default();
        match fname {
            "length" => {
                if let Some(ref d) = first_val.exact_int {
                    let len = if d.len() == 1 && d[0] == 0 { 1 } else { d.len() };
                    return BcVal::from_i64(len.max(first_val.scale) as i64);
                }
                let raw_tok = raw_args.first().map(|x| x.trim()).unwrap_or("");
                if let Some(v) = bc.vars.get(raw_tok) {
                    let int_part = v.val.abs().trunc() as u128;
                    let int_digits = if int_part == 0 { 0 } else { int_part.to_string().len() };
                    return BcVal::from_i64((int_digits + v.scale).max(1) as i64);
                }
                let clean: String = raw_tok.chars().filter(|c| c.is_ascii_digit()).collect();
                let trimmed = clean.trim_start_matches('0');
                return BcVal::from_i64(trimmed.len().max(1) as i64);
            }
            "scale" => {
                let raw_tok = raw_args.first().map(|x| x.trim()).unwrap_or("");
                if let Some(v) = bc.vars.get(raw_tok) {
                    return BcVal::from_i64(v.scale as i64);
                }
                return BcVal::from_i64(first_val.scale.max(bc_expr_decimal_places(raw_tok)) as i64);
            }
            "sqrt" => {
                if first_val.val < 0.0 || first_val.neg {
                    if bc.runtime_err.is_none() {
                        bc.runtime_err =
                            Some("Runtime error: Square root of a negative number".to_string());
                    }
                    return BcVal::from_i64(0);
                }
                if bc.scale > 12
                    && let Some(ref d) = first_val.exact_int
                    && first_val.scale == 0
                {
                    bc.last_str_out = Some(big_sqrt_scaled(d, bc.scale));
                }
                let rm = first_val.val.sqrt();
                let out_v = if bc.scale > 0 && bc.scale <= 12 {
                    let factor = 10f64.powi(bc.scale as i32);
                    ((rm + 1e-12 * rm.signum()) * factor).trunc() / factor
                } else {
                    rm
                };
                return BcVal::from_f64_scaled(out_v, bc.scale);
            }
            "s" | "c" | "a" | "l" | "e" | "j" => {
                let rm = match fname {
                    "s" => first_val.val.sin(),
                    "c" => first_val.val.cos(),
                    "a" => first_val.val.atan(),
                    "l" => first_val.val.ln(),
                    "e" => first_val.val.exp(),
                    "j" => {
                        let n = first_val.val.round() as i32;
                        let x = arg_vals.get(1).map(|v| v.val).unwrap_or(0.0);
                        if x == 0.0 {
                            if n == 0 { 1.0 } else { 0.0 }
                        } else {
                            // Series expansion for J_n(x)
                            let mut sum = 0.0f64;
                            let n_abs = n.unsigned_abs() as usize;
                            for m in 0..20usize {
                                let sign = if m % 2 == 0 { 1.0 } else { -1.0 };
                                let mf: f64 = (1..=m).map(|k| k as f64).product();
                                let nmf: f64 = (1..=(m + n_abs)).map(|k| k as f64).product();
                                sum += sign * (x / 2.0).powi((2 * m + n_abs) as i32) / (mf * nmf);
                            }
                            sum
                        }
                    }
                    _ => 0.0,
                };
                let out_v = if bc.scale > 0 && bc.scale <= 12 {
                    let factor = 10f64.powi(bc.scale as i32);
                    ((rm + 1e-12 * rm.signum()) * factor).trunc() / factor
                } else {
                    rm
                };
                return BcVal::from_f64_scaled(out_v, bc.scale);
            }
            _ => {
                if let Some(res) = eval_bc_func(fname, &arg_vals, bc, depth + 1) {
                    return res;
                }
            }
        }
    }
    if let Some(_open_b) = s.find('[')
        && s.ends_with(']')
    {
        let key = resolve_bc_lvalue_key(s, bc, depth);
        return bc.vars.get(&key).cloned().unwrap_or_default();
    }
    if let Some(v) = bc.vars.get(s) {
        return v.clone();
    }
    if bc.ibase != 10
        && s.chars().all(|c| c.is_ascii_digit() || ('A'..='F').contains(&c))
        && let Ok(iv) = u128::from_str_radix(s, bc.ibase)
    {
        let digits = iv.to_string().bytes().map(|b| b - b'0').collect();
        return BcVal {
            val: iv as f64,
            exact_int: Some(digits),
            neg: false,
            scale: 0,
        };
    }
    if s.bytes().all(|b| b.is_ascii_digit()) && !s.is_empty() {
        let mut digits: Vec<u8> = s.bytes().map(|b| b - b'0').collect();
        big_trim(&mut digits);
        let fv = s.parse::<f64>().unwrap_or(0.0);
        return BcVal {
            val: fv,
            exact_int: Some(digits),
            neg: false,
            scale: 0,
        };
    }
    let sc = s.split_once('.').map(|(_, f)| f.len()).unwrap_or(0);
    BcVal::from_f64_scaled(s.parse::<f64>().unwrap_or(0.0), sc)
}

fn balanced_parens(s: &str) -> bool {
    let mut d = 0i32;
    for c in s.chars() {
        if c == '(' {
            d += 1;
        } else if c == ')' {
            d -= 1;
            if d < 0 {
                return false;
            }
        }
    }
    d == 0
}

fn rfind_top_level(s: &str, target: char) -> Option<usize> {
    rfind_top_level_any(s, &[target]).map(|(idx, _)| idx)
}

fn rfind_top_level_any(s: &str, targets: &[char]) -> Option<(usize, char)> {
    let mut d = 0i32;
    let mut b = 0i32;
    let bytes = s.as_bytes();
    for i in (0..bytes.len()).rev() {
        match bytes[i] as char {
            ')' => d += 1,
            '(' => d -= 1,
            ']' => b += 1,
            '[' => b -= 1,
            c if targets.contains(&c) && d == 0 && b == 0 => return Some((i, c)),
            _ => {}
        }
    }
    None
}

fn rfind_top_level_add_sub(s: &str) -> Option<(usize, char)> {
    let mut d = 0i32;
    let mut b = 0i32;
    let bytes = s.as_bytes();
    for i in (0..bytes.len()).rev() {
        match bytes[i] as char {
            ')' => d += 1,
            '(' => d -= 1,
            ']' => b += 1,
            '[' => b -= 1,
            c @ ('+' | '-') if d == 0 && b == 0 => {
                if i == 0 {
                    return Some((0, c));
                }
                let prev = s[..i].trim_end();
                if !prev.is_empty() && !prev.ends_with(['+', '-', '*', '/', '%', '^']) {
                    return Some((i, c));
                }
            }
            _ => {}
        }
    }
    None
}

fn cmd_numfmt(args: &[String], mut stdin: CommandInput, env: &BTreeMap<String, String>) -> BuiltinOutcome {
    let unicode = ["LC_ALL", "LC_MESSAGES", "LANG"].iter()
        .find_map(|&key| env.get(key).filter(|s| !s.is_empty()))
        .is_some_and(|s| s.to_ascii_lowercase().contains("utf"));
    let mut to_mode = "none".to_string();
    let mut from_mode = "none".to_string();
    let mut from_unit: f64 = 1.0;
    let mut to_unit: f64 = 1.0;
    let mut suffix = String::new();
    let mut unit_sep: Option<String> = None;
    let mut round_mode = "from-zero".to_string();
    let mut invalid_mode = "abort".to_string();
    let mut format_spec: Option<String> = None;
    let mut delimiter: Option<String> = None;
    let mut padding: Option<isize> = None;
    let mut header_lines = 0usize;
    let mut field_ranges: Vec<(usize, usize)> = Vec::new();
    let mut zero_terminated = false;
    let mut stopped = false;
    let mut operands = Vec::new();

    let parse_unit_arg = |spec: &str| -> Result<f64, String> {
        let s = spec.trim();
        if s.is_empty() {
            return Err(format!("numfmt: invalid unit size: '{spec}'\n"));
        }
        let prefixes = "KMGTPEZYRQ";
        let mut num_end = 0usize;
        for (idx, ch) in s.char_indices() {
            if ch.is_ascii_digit() {
                num_end = idx + ch.len_utf8();
            } else {
                break;
            }
        }
        let (base_val, tail) = if num_end == 0 {
            (1.0f64, s)
        } else {
            let Ok(v) = s[..num_end].parse::<f64>() else {
                return Err(format!("numfmt: invalid unit size: '{spec}'\n"));
            };
            if v <= 0.0 {
                return Err(format!("numfmt: invalid unit size: '{spec}'\n"));
            }
            (v, &s[num_end..])
        };
        if tail.is_empty() {
            return Ok(base_val);
        }
        let mut chars = tail.chars();
        let first = chars.next().unwrap();
        let Some(p_idx) = prefixes.find(first) else {
            return Err(format!("numfmt: invalid unit size: '{spec}'\n"));
        };
        let rest = chars.as_str();
        let step = if rest.is_empty() {
            1000.0f64
        } else if rest == "i" {
            1024.0f64
        } else {
            return Err(format!("numfmt: invalid unit size: '{spec}'\n"));
        };
        Ok(base_val * step.powi((p_idx + 1) as i32))
    };

    let parse_fields = |spec: &str, out_f: &mut Vec<(usize, usize)>| -> Result<(), String> {
        for part in spec.split(|c: char| c == ',' || c == ' ' || c == '\t') {
            if part.is_empty() {
                return Err("numfmt: fields are numbered from 1\nTry 'numfmt --help' for more information.\n".to_string());
            }
            if part == "-" {
                out_f.push((1, usize::MAX));
            } else if let Some((a, b)) = part.split_once('-') {
                if b.contains('-') {
                    return Err("numfmt: invalid field range\nTry 'numfmt --help' for more information.\n".to_string());
                }
                let st = if a.is_empty() {
                    1
                } else {
                    if !a.bytes().all(|ch| ch.is_ascii_digit()) {
                        return Err(format!("numfmt: invalid field value '{a}'\nTry 'numfmt --help' for more information.\n"));
                    }
                    a.parse::<usize>()
                        .ok()
                        .filter(|&v| v >= 1)
                        .ok_or_else(|| "numfmt: fields are numbered from 1\nTry 'numfmt --help' for more information.\n".to_string())?
                };
                let en = if b.is_empty() {
                    usize::MAX
                } else {
                    if !b.bytes().all(|ch| ch.is_ascii_digit()) {
                        return Err(format!("numfmt: invalid field value '{b}'\nTry 'numfmt --help' for more information.\n"));
                    }
                    let parsed_b = b
                        .parse::<usize>()
                        .ok()
                        .filter(|&v| v >= 1)
                        .ok_or_else(|| "numfmt: invalid decreasing range\nTry 'numfmt --help' for more information.\n".to_string())?;
                    if parsed_b < st {
                        return Err("numfmt: invalid decreasing range\nTry 'numfmt --help' for more information.\n".to_string());
                    }
                    parsed_b
                };
                out_f.push((st, en));
            } else {
                if !part.bytes().all(|ch| ch.is_ascii_digit()) {
                    return Err(format!(
                        "numfmt: invalid field value '{part}'\nTry 'numfmt --help' for more information.\n"
                    ));
                }
                let idx = part
                    .parse::<usize>()
                    .ok()
                    .filter(|&v| v >= 1)
                    .ok_or_else(|| "numfmt: fields are numbered from 1\nTry 'numfmt --help' for more information.\n".to_string())?;
                out_f.push((idx, idx));
            }
        }
        Ok(())
    };

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if !stopped && a == "--" {
            stopped = true;
            i += 1;
            continue;
        }
        if stopped || a == "-" || !a.starts_with('-') {
            operands.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--help" {
            return ok_out("Usage: numfmt [OPTION]... [NUMBER]...\nReformat NUMBER(s), or the numbers from standard input if none are specified.\n\nMandatory arguments to long options are mandatory for short options too.\n      --debug          print warnings about invalid input\n  -d, --delimiter=X    use X instead of whitespace for field delimiter\n      --field=FIELDS   replace the numbers in these input fields (default=1)\n                         see FIELDS below\n      --format=FORMAT  use printf style floating-point FORMAT;\n                         see FORMAT below for details\n      --from=UNIT      auto-scale input numbers to UNITs; default is 'none';\n                         see UNIT below\n      --from-unit=N    specify the input unit size (instead of the default 1)\n      --grouping       use locale-defined grouping of digits, e.g. 1,000,000\n                         (which means it has no effect in the C/POSIX locale)\n      --header[=N]     print (without converting) the first N header lines;\n                         N defaults to 1 if not specified\n      --invalid=MODE   failure mode for invalid numbers: MODE can be:\n                         abort (default), fail, warn, ignore\n      --padding=N      pad the output to N characters; positive N will\n                         right-align; negative N will left-align;\n                         padding is ignored if the output is wider than N;\n                         the default is to automatically pad if a whitespace\n                         is found\n      --round=METHOD   use METHOD for rounding when scaling; METHOD can be:\n                         up, down, from-zero (default), towards-zero, nearest\n      --suffix=SUFFIX  add SUFFIX to output numbers, and accept optional\n                         SUFFIX in input numbers\n      --unit-separator=SEP  insert SEP between number and unit on output,\n                         and accept optional SEP in input numbers\n      --to=UNIT        auto-scale output numbers to UNITs; see UNIT below\n      --to-unit=N      the output unit size (instead of the default 1)\n  -z, --zero-terminated    line delimiter is NUL, not newline\n      --help     display this help and exit\n      --version  output version information and exit\n\nUNIT options:\n  none       no auto-scaling is done; suffixes will trigger an error\n  auto       accept optional single/two letter suffix:\n               1K = 1000,\n               1Ki = 1024,\n               1M = 1000000,\n               1Mi = 1048576,\n  si         accept optional single letter suffix:\n               1K = 1000,\n               1M = 1000000,\n               ...\n  iec        accept optional single letter suffix:\n               1K = 1024,\n               1M = 1048576,\n               ...\n  iec-i      accept optional two-letter suffix:\n               1Ki = 1024,\n               1Mi = 1048576,\n               ...\n\nFIELDS supports cut(1) style field ranges:\n  N    N'th field, counted from 1\n  N-   from N'th field, to end of line\n  N-M  from N'th to M'th field (inclusive)\n  -M   from first to M'th field (inclusive)\n  -    all fields\nMultiple fields/ranges can be separated with commas\n\nFORMAT must be suitable for printing one floating-point argument '%f'.\nOptional quote (%'f) will enable --grouping (if supported by current locale).\nOptional width value (%10f) will pad output. Optional zero (%010f) width\nwill zero pad the number. Optional negative values (%-10f) will left align.\nOptional precision (%.1f) will override the input determined precision.\n\nExit status is 0 if all input numbers were successfully converted.\nBy default, numfmt will stop at the first conversion error with exit status 2.\nWith --invalid='fail' a warning is printed for each conversion error\nand the exit status is 2.  With --invalid='warn' each conversion error is\ndiagnosed, but the exit status is 0.  With --invalid='ignore' conversion\nerrors are not diagnosed and the exit status is 0.\n\nExamples:\n  $ numfmt --to=si 1000\n            -> \"1.0K\"\n  $ numfmt --to=iec 2048\n           -> \"2.0K\"\n  $ numfmt --to=iec-i 4096\n           -> \"4.0Ki\"\n  $ echo 1K | numfmt --from=si\n           -> \"1000\"\n  $ echo 1K | numfmt --from=iec\n           -> \"1024\"\n  $ df -B1 | numfmt --header --field 2-4 --to=si\n  $ ls -l  | numfmt --header --field 5 --to=iec\n  $ ls -lh | numfmt --header --field 5 --from=iec --padding=10\n  $ ls -lh | numfmt --header --field 5 --from=iec --format %10f\n\nGNU coreutils online help: <https://www.gnu.org/software/coreutils/>\nReport numfmt translation bugs to <https://translationproject.org/team/>\nFull documentation at: <https://www.gnu.org/software/coreutils/numfmt>\nor available locally via: info '(coreutils) numfmt invocation'\n");
        }
        if a == "--version" {
            return ok_out("numfmt (virtual-bash)\n");
        }
        if a == "-z" || a == "--zero-terminated" {
            zero_terminated = true;
        } else if a == "--grouping" || a == "--debug" || a == "---debug" {
            // accepted
        } else if let Some(v) = a.strip_prefix("--to=") {
            to_mode = v.to_string();
        } else if a == "--to" && i + 1 < args.len() {
            i += 1;
            to_mode = args[i].clone();
        } else if let Some(v) = a.strip_prefix("--from=") {
            from_mode = v.to_string();
        } else if a == "--from" && i + 1 < args.len() {
            i += 1;
            from_mode = args[i].clone();
        } else if let Some(v) = a.strip_prefix("--from-unit=") {
            match parse_unit_arg(v) {
                Ok(u) => from_unit = u,
                Err(msg) => return err_out(&msg, 1),
            }
        } else if a == "--from-unit" && i + 1 < args.len() {
            i += 1;
            match parse_unit_arg(&args[i]) {
                Ok(u) => from_unit = u,
                Err(msg) => return err_out(&msg, 1),
            }
        } else if let Some(v) = a.strip_prefix("--to-unit=") {
            match parse_unit_arg(v) {
                Ok(u) => to_unit = u,
                Err(msg) => return err_out(&msg, 1),
            }
        } else if a == "--to-unit" && i + 1 < args.len() {
            i += 1;
            match parse_unit_arg(&args[i]) {
                Ok(u) => to_unit = u,
                Err(msg) => return err_out(&msg, 1),
            }
        } else if let Some(v) = a.strip_prefix("--suffix=") {
            suffix = v.to_string();
        } else if a == "--suffix" && i + 1 < args.len() {
            i += 1;
            suffix = args[i].clone();
        } else if let Some(v) = a.strip_prefix("--unit-separator=") {
            unit_sep = Some(v.to_string());
        } else if a == "--unit-separator" && i + 1 < args.len() {
            i += 1;
            unit_sep = Some(args[i].clone());
        } else if let Some(v) = a.strip_prefix("--round=") {
            round_mode = v.to_string();
        } else if a == "--round" && i + 1 < args.len() {
            i += 1;
            round_mode = args[i].clone();
        } else if let Some(v) = a.strip_prefix("--invalid=") {
            invalid_mode = v.to_string();
        } else if a == "--invalid" && i + 1 < args.len() {
            i += 1;
            invalid_mode = args[i].clone();
        } else if let Some(v) = a.strip_prefix("--format=") {
            format_spec = Some(v.to_string());
        } else if a == "--format" && i + 1 < args.len() {
            i += 1;
            format_spec = Some(args[i].clone());
        } else if let Some(v) = a.strip_prefix("--padding=") {
            let Ok(p) = v.parse::<isize>() else {
                return err_out(&format!("numfmt: invalid padding value '{v}'\n"), 1);
            };
            if p == 0 {
                return err_out(&format!("numfmt: invalid padding value '{v}'\n"), 1);
            }
            padding = Some(p);
        } else if a == "--padding" && i + 1 < args.len() {
            i += 1;
            let Ok(p) = args[i].parse::<isize>() else {
                return err_out(&format!("numfmt: invalid padding value '{}'\n", args[i]), 1);
            };
            if p == 0 {
                return err_out(&format!("numfmt: invalid padding value '{}'\n", args[i]), 1);
            }
            padding = Some(p);
        } else if a == "--header" {
            header_lines = 1;
        } else if let Some(v) = a.strip_prefix("--header=") {
            let Ok(h) = v.parse::<usize>() else {
                return err_out(&format!("numfmt: invalid header value '{v}'\n"), 1);
            };
            if h == 0 {
                return err_out(&format!("numfmt: invalid header value '{v}'\n"), 1);
            }
            header_lines = h;
        } else if let Some(v) = a.strip_prefix("--field=") {
            if let Err(msg) = parse_fields(v, &mut field_ranges) {
                return err_out(&msg, 1);
            }
        } else if a == "--field" && i + 1 < args.len() {
            i += 1;
            if let Err(msg) = parse_fields(&args[i], &mut field_ranges) {
                return err_out(&msg, 1);
            }
        } else if let Some(v) = a.strip_prefix("--delimiter=") {
            delimiter = Some(v.to_string());
        } else if a == "--delimiter" && i + 1 < args.len() {
            i += 1;
            delimiter = Some(args[i].clone());
        } else if a == "-d" && i + 1 < args.len() {
            i += 1;
            delimiter = Some(args[i].clone());
        } else if let Some(v) = a.strip_prefix("-d") {
            delimiter = Some(v.to_string());
        } else {
            if a.starts_with("--") {
                return err_out(
                    &format!("numfmt: unrecognized option '{a}'\nTry 'numfmt --help' for more information.\n"),
                    1,
                );
            }
            let ch = a.chars().nth(1).unwrap_or('?');
            return err_out(
                &format!("numfmt: invalid option -- '{ch}'\nTry 'numfmt --help' for more information.\n"),
                1,
            );
        }
        i += 1;
    }

    if !matches!(from_mode.as_str(), "none" | "auto" | "si" | "iec" | "iec-i") {
        return err_out(
            &format!(
                "numfmt: invalid argument '{from_mode}' for '--from'\nValid arguments are:\n  - 'none'\n  - 'auto'\n  - 'si'\n  - 'iec'\n  - 'iec-i'\nTry 'numfmt --help' for more information.\n"
            ),
            1,
        );
    }
    if !matches!(to_mode.as_str(), "none" | "si" | "iec" | "iec-i") {
        return err_out(
            &format!(
                "numfmt: invalid argument '{to_mode}' for '--to'\nValid arguments are:\n  - 'none'\n  - 'si'\n  - 'iec'\n  - 'iec-i'\nTry 'numfmt --help' for more information.\n"
            ),
            1,
        );
    }
    if !matches!(round_mode.as_str(), "up" | "down" | "from-zero" | "towards-zero" | "nearest") {
        return err_out(
            &format!(
                "numfmt: invalid argument '{round_mode}' for '--round'\nValid arguments are:\n  - 'up'\n  - 'down'\n  - 'from-zero'\n  - 'towards-zero'\n  - 'nearest'\nTry 'numfmt --help' for more information.\n"
            ),
            1,
        );
    }
    if !matches!(invalid_mode.as_str(), "abort" | "fail" | "warn" | "ignore") {
        return err_out(
            &format!(
                "numfmt: invalid argument '{invalid_mode}' for '--invalid'\nValid arguments are:\n  - 'abort'\n  - 'fail'\n  - 'warn'\n  - 'ignore'\nTry 'numfmt --help' for more information.\n"
            ),
            1,
        );
    }
    if field_ranges.is_empty() {
        field_ranges.push((1, 1));
    }

    let mut fmt_prefix = String::new();
    let mut fmt_postfix = String::new();
    let mut fmt_zero_pad: usize = 0;
    let mut fmt_prec: Option<usize> = None;
    if let Some(ref fspec) = format_spec {
        let bytes = fspec.as_bytes();
        let mut idx = 0usize;
        while idx < bytes.len() {
            if bytes[idx] == b'%' {
                if idx + 1 < bytes.len() && bytes[idx + 1] == b'%' {
                    fmt_prefix.push('%');
                    idx += 2;
                    continue;
                }
                break;
            }
            let ch = fspec[idx..].chars().next().unwrap();
            fmt_prefix.push(ch);
            idx += ch.len_utf8();
        }
        if idx >= bytes.len() {
            return err_out(&format!("numfmt: format '{fspec}' has no % directive\n"), 1);
        }
        idx += 1;
        let mut zero_flag = false;
        while idx < bytes.len() {
            if bytes[idx] == b' ' || bytes[idx] == b'\'' {
                idx += 1;
            } else if bytes[idx] == b'0' {
                zero_flag = true;
                idx += 1;
            } else {
                break;
            }
        }
        let w_start = idx;
        if idx < bytes.len() && (bytes[idx] == b'-' || bytes[idx] == b'+') {
            idx += 1;
        }
        while idx < bytes.len() && bytes[idx].is_ascii_digit() {
            idx += 1;
        }
        if idx > w_start && let Ok(w) = fspec[w_start..idx].parse::<isize>() && w != 0 {
            if w < 0 {
                padding = Some(w);
            } else if zero_flag {
                fmt_zero_pad = w as usize;
            } else {
                padding = Some(w);
            }
        }
        if idx < bytes.len() && bytes[idx] == b'.' {
            idx += 1;
            let p_start = idx;
            while idx < bytes.len() && bytes[idx].is_ascii_digit() {
                idx += 1;
            }
            let p_val = if idx > p_start {
                let Ok(p) = fspec[p_start..idx].parse::<usize>() else {
                    return err_out(&format!("numfmt: invalid precision in format '{fspec}'\n"), 1);
                };
                p
            } else {
                0
            };
            fmt_prec = Some(p_val);
        }
        if idx >= bytes.len() || bytes[idx] != b'f' {
            return err_out(&format!("numfmt: invalid format '{fspec}'\n"), 1);
        }
        idx += 1;
        while idx < bytes.len() {
            if bytes[idx] == b'%' {
                if idx + 1 < bytes.len() && bytes[idx + 1] == b'%' {
                    fmt_postfix.push('%');
                    idx += 2;
                    continue;
                }
                return err_out(&format!("numfmt: format '{fspec}' has too many % directives\n"), 1);
            }
            let ch = fspec[idx..].chars().next().unwrap();
            fmt_postfix.push(ch);
            idx += ch.len_utf8();
        }
    }

    let apply_round = |v: f64, decimals: i32| -> f64 {
        let factor = 10f64.powi(decimals);
        let scaled = v * factor;
        let r = match round_mode.as_str() {
            "up" => (scaled - 1e-9).ceil(),
            "down" => (scaled + 1e-9).floor(),
            "towards-zero" => {
                if scaled >= 0.0 {
                    (scaled + 1e-9).floor()
                } else {
                    (scaled - 1e-9).ceil()
                }
            }
            "nearest" => (scaled + 1e-9 * scaled.signum()).round(),
            _ => {
                if scaled >= 0.0 {
                    (scaled - 1e-9).ceil()
                } else {
                    (scaled + 1e-9).floor()
                }
            }
        };
        let res = r / factor;
        if res == 0.0 { 0.0 } else { res }
    };

    let units = ['K', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y', 'R', 'Q'];
    let convert_field = |raw: &str| -> Result<String, String> {
        let (mut val, in_prec) = parse_human_num(raw, &from_mode, &suffix, unit_sep.as_deref(), unicode)?;
        val = val * from_unit / to_unit;
        let (mut num_s, unit_s) = if to_mode == "iec" || to_mode == "iec-i" || to_mode == "si" {
            let base = if to_mode == "si" { 1000.0 } else { 1024.0 };
            let i_suf = if to_mode == "iec-i" { "i" } else { "" };
            let mut scaled = val;
            let mut power_idx = 0usize;
            while scaled.abs() >= base && power_idx < units.len() {
                scaled /= base;
                power_idx += 1;
            }
            let adj = match fmt_prec {
                None => {
                    if scaled.abs() < 10.0 && power_idx > 0 {
                        1
                    } else {
                        0
                    }
                }
                Some(p) => p.min(power_idx * 3),
            };
            scaled = apply_round(scaled, adj as i32);
            if scaled.abs() >= base && power_idx < units.len() {
                scaled /= base;
                power_idx += 1;
            }
            let out_prec = match fmt_prec {
                None => {
                    if scaled != 0.0 && scaled.abs() < 10.0 && power_idx > 0 {
                        1
                    } else {
                        0
                    }
                }
                Some(p) => p,
            };
            let u_part = if power_idx > 0 {
                let u_ch = if to_mode == "si" && power_idx == 1 {
                    'k'
                } else {
                    units[power_idx - 1]
                };
                format!("{}{u_ch}{i_suf}", unit_sep.as_deref().unwrap_or(""))
            } else {
                String::new()
            };
            (format!("{scaled:.out_prec$}"), format!("{u_part}{suffix}"))
        } else {
            let out_prec = fmt_prec.unwrap_or(in_prec);
            let rv = apply_round(val, out_prec as i32);
            (format!("{rv:.out_prec$}"), suffix.clone())
        };

        if fmt_zero_pad > 0 {
            let is_neg = num_s.starts_with('-');
            let digits = if is_neg { &num_s[1..] } else { &num_s[..] };
            let target = fmt_zero_pad.saturating_sub(if is_neg { 1 } else { 0 });
            if digits.len() < target {
                let zeros = "0".repeat(target - digits.len());
                num_s = if is_neg {
                    format!("-{zeros}{digits}")
                } else {
                    format!("{zeros}{digits}")
                };
            }
        }
        let rendered = format!("{num_s}{unit_s}");
        let padded = if let Some(pad) = padding {
            let w = pad.unsigned_abs();
            if w > rendered.len() {
                if pad < 0 {
                    format!("{rendered:<w$}")
                } else {
                    format!("{rendered:>w$}")
                }
            } else {
                rendered
            }
        } else {
            rendered
        };
        Ok(format!("{fmt_prefix}{padded}{fmt_postfix}"))
    };

    let field_selected = |f_idx: usize| -> bool {
        field_ranges.iter().any(|&(lo, hi)| f_idx >= lo && f_idx <= hi)
    };

    let sep_char = if zero_terminated { '\0' } else { '\n' };
    let from_stdin = operands.is_empty();
    let mut out = String::new();
    let mut err = String::new();
    let mut had_invalid = false;

    let mut emit = |item: &str, has_term: bool| {
        let (mut rest, nul) = item.split_once('\0').map_or((item, false), |(text, _)| (text, true));
        if from_stdin && header_lines != 0 {
            header_lines -= 1;
            out.push_str(rest);
            if has_term && !nul { out.push(sep_char); }
            return true;
        }
        let mut field = 1;
        loop {
            let (end, separator) = if let Some(delim) = delimiter.as_deref() {
                let delim = if delim.is_empty() { "\0" } else { delim };
                (rest.find(delim).unwrap_or(rest.len()), delim)
            } else {
                let token = rest.trim_start_matches([' ', '\t', '\n']);
                let width = token.find([' ', '\t', '\n']).unwrap_or(token.len());
                (rest.len() - token.len() + width, " ")
            };
            let text = &rest[..end];
            if field_selected(field) {
                let token = text.trim_start_matches([' ', '\t']);
                match convert_field(token) {
                    Ok(value) => {
                        if padding.is_none() && delimiter.is_none() && (token.len() != text.len() || field > 1) {
                            let width = text.len();
                            out.push_str(&format!("{value:>width$}"));
                        } else {
                            out.push_str(&value);
                        }
                    }
                    Err(msg) => {
                        had_invalid = true;
                        if invalid_mode != "ignore" { err.push_str(&msg); }
                        if invalid_mode == "abort" { return false; }
                        out.push_str(text);
                    }
                }
            } else {
                out.push_str(text);
            }
            if end == rest.len() { break; }
            out.push_str(separator);
            rest = &rest[end + separator.len()..];
            field += 1;
        }
        if has_term { out.push(sep_char); }
        true
    };
    let mut read_error = None;
    if from_stdin {
        let mut pending = Vec::new();
        let mut more = true;
        read_error = stdin.read_stdin(|chunk| {
            more = visit_complete_records(chunk, |b| b == sep_char as u8, &mut pending, |record|
                emit(&crate::vfs::bytes_to_stream_string(record), true));
            more
        }).err();
        if more && !pending.is_empty() && !emit(&crate::vfs::bytes_to_stream_string(&pending), false) {
            read_error = None;
        }
    } else {
        for item in operands {
            if !emit(&item, true) { break; }
        }
    }
    if let Some(error) = read_error {
        let reason = match error.split(':').next().unwrap_or("") {
            "EISDIR" => "Is a directory", "EIO" => "Input/output error", "EBADF" => "Bad file descriptor",
            "EACCES" => "Permission denied", "EFBIG" => "File too large", _ => &error,
        };
        err.push_str(&format!("numfmt: error reading input: {reason}\n"));
    }
    let exit_code = if had_invalid && (invalid_mode == "abort" || invalid_mode == "fail") {
        2
    } else {
        0
    };
    BuiltinOutcome {
        stdout: out,
        stderr: err,
        exit_code,
    }
}

fn parse_human_num(
    s: &str,
    from_mode: &str,
    suffix: &str,
    unit_sep: Option<&str>,
    unicode: bool,
) -> Result<(f64, usize), String> {
    let mut work = s.trim_start_matches([' ', '\t']);
    if !suffix.is_empty()
        && let Some(stripped) = work.strip_suffix(suffix)
    {
        work = stripped;
    }
    let quoted = || fmt_quote::quote(work, false, unicode);
    let bytes = work.as_bytes();
    let mut idx = 0usize;
    if idx < bytes.len() && (bytes[idx] == b'-' || bytes[idx] == b'+') {
        idx += 1;
    }
    let int_start = idx;
    while idx < bytes.len() && bytes[idx].is_ascii_digit() {
        idx += 1;
    }
    if idx == int_start {
        return Err(format!("numfmt: invalid number: {}\n", quoted()));
    }
    let mut prec = 0usize;
    if idx < bytes.len() && bytes[idx] == b'.' {
        idx += 1;
        let frac_start = idx;
        while idx < bytes.len() && bytes[idx].is_ascii_digit() {
            idx += 1;
        }
        if idx == frac_start {
            return Err(format!("numfmt: invalid number: {}\n", quoted()));
        }
        prec = idx - frac_start;
    }
    let Ok(base_num) = work[..idx].parse::<f64>() else {
        return Err(format!("numfmt: invalid number: {}\n", quoted()));
    };
    let mut rem = &work[idx..];
    if let Some(sep) = unit_sep
        && !sep.is_empty()
        && let Some(after_sep) = rem.strip_prefix(sep)
    {
        rem = after_sep;
    }
    if rem.is_empty() {
        return Ok((base_num, prec));
    }
    if from_mode == "none" || from_mode.is_empty() {
        return Err(format!("numfmt: rejecting suffix in input: {}\n", quoted()));
    }
    let prefixes = "KMGTPEZYRQ";
    let mut chars = rem.chars();
    let first = chars.next().unwrap();
    let norm_first = if first == 'k' { 'K' } else { first };
    let Some(p_idx) = prefixes.find(norm_first) else {
        return Err(format!("numfmt: invalid suffix in input: {}\n", quoted()));
    };
    let after_unit = chars.as_str();
    let step = match from_mode {
        "si" => {
            if !after_unit.is_empty() {
                return Err(format!("numfmt: invalid suffix in input: {}\n", quoted()));
            }
            1000.0f64
        }
        "iec" => {
            if !after_unit.is_empty() {
                return Err(format!("numfmt: invalid suffix in input: {}\n", quoted()));
            }
            1024.0f64
        }
        "iec-i" => {
            if after_unit != "i" {
                return Err(format!("numfmt: missing 'i' suffix in input: {}\n", quoted()));
            }
            1024.0f64
        }
        "auto" => {
            if after_unit.is_empty() {
                1000.0f64
            } else if after_unit == "i" {
                1024.0f64
            } else {
                return Err(format!("numfmt: invalid suffix in input: {}\n", quoted()));
            }
        }
        _ => return Err(format!("numfmt: invalid suffix in input: {}\n", quoted())),
    };
    Ok((base_num * step.powi((p_idx + 1) as i32), 0))
}

pub(super) fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

pub(super) fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m as u32, d as u32)
}

fn gregorian_is_leap(year: i64) -> bool {
    year.rem_euclid(4) == 0 && (year.rem_euclid(100) != 0 || year.rem_euclid(400) == 0)
}

fn gregorian_days_in_month(year: i64, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => if gregorian_is_leap(year) { 29 } else { 28 },
        _ => 30,
    }
}

fn parse_tz_spec(tz_env: Option<&str>, force_utc: bool) -> (i64, String) {
    if force_utc {
        return (0, "UTC".to_string());
    }
    let Some(raw) = tz_env else {
        return (0, "UTC".to_string());
    };
    let name = raw.strip_prefix(':').unwrap_or(raw).trim();
    if name.is_empty()
        || matches!(
            name,
            "UTC" | "UTC0" | "GMT" | "GMT0" | "Etc/UTC" | "Etc/GMT" | "Z"
        )
    {
        let label = if name.starts_with("GMT") || name == "Etc/GMT" {
            "GMT"
        } else {
            "UTC"
        };
        return (0, label.to_string());
    }
    if let Some(rest) = name.strip_prefix("UTC").or_else(|| name.strip_prefix("GMT")) {
        let label = if name.starts_with("GMT") { "GMT" } else { "UTC" };
        if let Some(off) = parse_signed_offset(rest, true) {
            return (-off, label.to_string());
        }
    }
    if let Some(off) = parse_signed_offset(name, true) {
        return (off, "UTC".to_string());
    }
    (0, "UTC".to_string())
}

fn parse_signed_offset(text: &str, allow_single_digit_hour: bool) -> Option<i64> {
    let s = text.trim();
    let (sign, rest) = if let Some(r) = s.strip_prefix('+') {
        (1i64, r)
    } else if let Some(r) = s.strip_prefix('-') {
        (-1i64, r)
    } else {
        return None;
    };
    let (h, m, sec) = if let Some((h_str, tail)) = rest.split_once(':') {
        if h_str.is_empty() || h_str.len() > 2 || !h_str.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let h = h_str.parse::<i64>().ok()?;
        let (m_str, s_str) = tail.split_once(':').unwrap_or((tail, "00"));
        if m_str.len() != 2
            || s_str.len() != 2
            || !m_str.bytes().all(|b| b.is_ascii_digit())
            || !s_str.bytes().all(|b| b.is_ascii_digit())
        {
            return None;
        }
        (
            h,
            m_str.parse::<i64>().ok()?,
            s_str.parse::<i64>().ok()?,
        )
    } else if rest.bytes().all(|b| b.is_ascii_digit()) {
        match rest.len() {
            1 if allow_single_digit_hour => (rest.parse::<i64>().ok()?, 0, 0),
            2 => (rest.parse::<i64>().ok()?, 0, 0),
            4 => (
                rest[..2].parse::<i64>().ok()?,
                rest[2..4].parse::<i64>().ok()?,
                0,
            ),
            6 => (
                rest[..2].parse::<i64>().ok()?,
                rest[2..4].parse::<i64>().ok()?,
                rest[4..6].parse::<i64>().ok()?,
            ),
            _ => return None,
        }
    } else {
        return None;
    };
    if h > 23 || m > 59 || sec > 59 {
        return None;
    }
    Some(sign * (h * 3600 + m * 60 + sec))
}

fn parse_epoch_ns(s: &str) -> Option<(i64, u32)> {
    let rest = s.strip_prefix('@')?;
    let (sign, num_s) = if let Some(r) = rest.strip_prefix('-') {
        (-1i64, r)
    } else if let Some(r) = rest.strip_prefix('+') {
        (1i64, r)
    } else {
        (1i64, rest)
    };
    let (sec_part, frac_part) = num_s
        .split_once('.')
        .or_else(|| num_s.split_once(','))
        .unwrap_or((num_s, ""));
    if sec_part.is_empty() || !sec_part.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if !frac_part.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let sec_mag = sec_part.parse::<i64>().ok()?;
    let mut frac_padded = String::with_capacity(9);
    for ch in frac_part.chars().take(9) {
        frac_padded.push(ch);
    }
    while frac_padded.len() < 9 {
        frac_padded.push('0');
    }
    let ns_mag = frac_padded.parse::<u32>().ok()?;
    if sign < 0 {
        if ns_mag == 0 {
            Some((-sec_mag, 0))
        } else {
            Some((-sec_mag - 1, 1_000_000_000 - ns_mag))
        }
    } else {
        Some((sec_mag, ns_mag))
    }
}

pub(super) fn parse_absolute_date_spec(spec: &str, default_tz_offset: i64) -> Result<(i64, u32, i64), String> {
    let s = spec.trim();
    if let Some((sec, ns)) = parse_epoch_ns(s) {
        return Ok((sec, ns, default_tz_offset));
    }
    let rfc_body = if let Some((day_name, after_comma)) = s.split_once(',') {
        let dn = day_name.trim();
        if matches!(dn, "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat") {
            Some(after_comma.trim())
        } else {
            None
        }
    } else {
        Some(s)
    };
    if let Some(body) = rfc_body {
        let toks: Vec<&str> = body.split_whitespace().collect();
        if toks.len() == 5 {
            let short_months = [
                "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
            ];
            if let (Ok(d), Some(m_idx), Ok(y)) = (
                toks[0].parse::<i64>(),
                short_months.iter().position(|&m| m.eq_ignore_ascii_case(toks[1])),
                toks[2].parse::<i64>(),
            ) {
                let tparts: Vec<&str> = toks[3].split(':').collect();
                if tparts.len() == 3
                    && let (Ok(h), Ok(min), Ok(sec)) = (
                        tparts[0].parse::<i64>(),
                        tparts[1].parse::<i64>(),
                        tparts[2].parse::<i64>(),
                    )
                {
                    let tz_off = if toks[4].eq_ignore_ascii_case("UTC")
                        || toks[4].eq_ignore_ascii_case("GMT")
                        || toks[4].eq_ignore_ascii_case("Z")
                    {
                        0
                    } else if let Some(off) = parse_signed_offset(toks[4], false) {
                        off
                    } else {
                        return Err(format!("date: unsupported or invalid date: {spec}\n"));
                    };
                    let days = days_from_civil(y, (m_idx + 1) as i64, d);
                    return Ok((days * 86400 + h * 3600 + min * 60 + sec - tz_off, 0, tz_off));
                }
            }
        }
    }

    let mut work = s;
    let mut tz_off = default_tz_offset;
    if let Some(stripped) = work
        .strip_suffix("UTC")
        .or_else(|| work.strip_suffix("GMT"))
        .or_else(|| work.strip_suffix('Z'))
        .or_else(|| work.strip_suffix('z'))
    {
        work = stripped.trim_end();
        tz_off = 0;
    } else if let Some(pos) = work.rfind(['+', '-'])
        && pos >= 8
    {
        let tz_candidate = &work[pos..];
        if let Some(off) = parse_signed_offset(tz_candidate, false) {
            work = work[..pos].trim_end();
            tz_off = off;
        }
    }

    let (date_part, time_part) = work
        .split_once('T')
        .or_else(|| work.split_once('t'))
        .or_else(|| work.split_once(' '))
        .unwrap_or((work, "00:00:00"));
    let (y, m, d) = if let Some((ys, rest_m)) = date_part.split_once('-')
        && let Some((ms, ds)) = rest_m.split_once('-')
    {
        let Ok(y) = ys.parse::<i64>() else {
            return Err(format!("date: unsupported or invalid date: {spec}\n"));
        };
        let Ok(m) = ms.parse::<u32>() else {
            return Err(format!("date: unsupported or invalid date: {spec}\n"));
        };
        let Ok(d) = ds.parse::<u32>() else {
            return Err(format!("date: unsupported or invalid date: {spec}\n"));
        };
        (y, m, d)
    } else if date_part.len() == 8 && date_part.bytes().all(|b| b.is_ascii_digit()) {
        let y = date_part[..4].parse::<i64>().unwrap_or(0);
        let m = date_part[4..6].parse::<u32>().unwrap_or(0);
        let d = date_part[6..8].parse::<u32>().unwrap_or(0);
        (y, m, d)
    } else {
        return Err(format!("date: unsupported or invalid date: {spec}\n"));
    };
    if !(1..=12).contains(&m) || d < 1 || d > gregorian_days_in_month(y, m) {
        return Err(format!("date: unsupported or invalid date: {spec}\n"));
    }
    let tparts: Vec<&str> = time_part.trim().split(':').collect();
    if tparts.is_empty() || tparts.len() > 3 {
        return Err(format!("date: unsupported or invalid date: {spec}\n"));
    }
    let Ok(h) = tparts[0].parse::<u32>() else {
        return Err(format!("date: unsupported or invalid date: {spec}\n"));
    };
    let min = if tparts.len() >= 2 {
        let Ok(v) = tparts[1].parse::<u32>() else {
            return Err(format!("date: unsupported or invalid date: {spec}\n"));
        };
        v
    } else {
        0
    };
    let (sec, ns) = if tparts.len() == 3 {
        let (s_str, f_str) = tparts[2]
            .split_once('.')
            .or_else(|| tparts[2].split_once(','))
            .unwrap_or((tparts[2], ""));
        let Ok(sv) = s_str.parse::<u32>() else {
            return Err(format!("date: unsupported or invalid date: {spec}\n"));
        };
        if !f_str.bytes().all(|b| b.is_ascii_digit()) {
            return Err(format!("date: unsupported or invalid date: {spec}\n"));
        }
        let mut fp = String::with_capacity(9);
        for ch in f_str.chars().take(9) {
            fp.push(ch);
        }
        while fp.len() < 9 {
            fp.push('0');
        }
        (sv, fp.parse::<u32>().unwrap_or(0))
    } else {
        (0, 0)
    };
    if h > 23 || min > 59 || sec > 59 {
        return Err(format!("date: unsupported or invalid date: {spec}\n"));
    }
    let days = days_from_civil(y, m as i64, d as i64);
    let wall_sec = days * 86400 + (h as i64) * 3600 + (min as i64) * 60 + (sec as i64);
    Ok((wall_sec - tz_off, ns, tz_off))
}

fn normalize_year_month(year: i64, month_1based: i64) -> (i64, u32) {
    let m0 = month_1based - 1;
    let y = year + m0.div_euclid(12);
    let m = (m0.rem_euclid(12) + 1) as u32;
    (y, m)
}

fn parse_date_spec_full(
    spec: &str,
    default_tz_offset: i64,
    (now_sec, now_ns): (i64, u32),
) -> Result<(i64, u32), String> {
    let s = spec.trim();
    if s.is_empty() {
        let local_days = (now_sec + default_tz_offset).div_euclid(86400);
        return Ok((local_days * 86400 - default_tz_offset, 0));
    }
    if let Some((sec, ns)) = parse_epoch_ns(s) {
        return Ok((sec, ns));
    }
    if s == "now" || s == "today" {
        return Ok((now_sec, now_ns));
    }
    if s == "yesterday" {
        return Ok((now_sec - 86400, now_ns));
    }
    if s == "tomorrow" {
        return Ok((now_sec + 86400, now_ns));
    }

    let tokens: Vec<&str> = s.split_whitespace().collect();
    if tokens.len() >= 2 {
        let has_ago = tokens.last().copied() == Some("ago");
        let unit_idx = if has_ago {
            tokens.len().saturating_sub(2)
        } else {
            tokens.len() - 1
        };
        if unit_idx >= 1 {
            let unit_tok = tokens[unit_idx].to_ascii_lowercase();
            let is_unit = matches!(
                unit_tok.as_str(),
                "second"
                    | "seconds"
                    | "minute"
                    | "minutes"
                    | "hour"
                    | "hours"
                    | "day"
                    | "days"
                    | "week"
                    | "weeks"
                    | "month"
                    | "months"
                    | "year"
                    | "years"
            );
            if is_unit {
                let (amt_opt, base_end) = if let Ok(v) = tokens[unit_idx - 1].parse::<i64>() {
                    (Some(v), unit_idx - 1)
                } else if unit_idx >= 2
                    && (tokens[unit_idx - 2] == "+" || tokens[unit_idx - 2] == "-")
                    && let Ok(v) = tokens[unit_idx - 1].parse::<i64>()
                {
                    let sign = if tokens[unit_idx - 2] == "-" { -1 } else { 1 };
                    (Some(sign * v), unit_idx - 2)
                } else {
                    (None, 0)
                };
                if let Some(raw_amt) = amt_opt {
                    let amount = if has_ago { -raw_amt } else { raw_amt };
                    let base_str = tokens[..base_end].join(" ");
                    let (base_sec, base_ns, base_tz) =
                        if base_str.is_empty() || base_str == "now" {
                            (now_sec, now_ns, default_tz_offset)
                        } else {
                            parse_absolute_date_spec(&base_str, default_tz_offset)?
                        };
                    if unit_tok.starts_with("second") {
                        return Ok((base_sec + amount, base_ns));
                    } else if unit_tok.starts_with("minute") {
                        return Ok((base_sec + amount * 60, base_ns));
                    } else if unit_tok.starts_with("hour") {
                        return Ok((base_sec + amount * 3600, base_ns));
                    } else if unit_tok.starts_with("day") || unit_tok.starts_with("week") {
                        let mult = if unit_tok.starts_with("week") { 7 } else { 1 };
                        return Ok((base_sec + amount * mult * 86400, base_ns));
                    } else {
                        let local = base_sec + base_tz;
                        let days = local.div_euclid(86400);
                        let rem = local.rem_euclid(86400);
                        let (y, m, d) = civil_from_days(days);
                        let (ny, nm) = if unit_tok.starts_with("year") {
                            (y + amount, m)
                        } else {
                            normalize_year_month(y, (m as i64) + amount)
                        };
                        let new_days = days_from_civil(ny, nm as i64, d as i64);
                        return Ok((new_days * 86400 + rem - base_tz, base_ns));
                    }
                }
            }
        }
    }

    let (sec, ns, _) = parse_absolute_date_spec(s, default_tz_offset)?;
    Ok((sec, ns))
}

#[derive(Clone, Debug)]
struct BsdDateAdj {
    unit: char,
    amount: i64,
    relative: bool,
}

fn parse_bsd_adjustment(val: &str) -> Result<BsdDateAdj, String> {
    if val.len() < 2 {
        return Err(format!("date: invalid date adjustment: {val}\n"));
    }
    let unit = val.chars().last().unwrap();
    if !matches!(unit, 'y' | 'm' | 'w' | 'd' | 'H' | 'M' | 'S') {
        return Err(format!("date: invalid date adjustment: {val}\n"));
    }
    let num_s = &val[..val.len() - unit.len_utf8()];
    let relative = num_s.starts_with('+') || num_s.starts_with('-');
    let digits = num_s.strip_prefix(['+', '-']).unwrap_or(num_s);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("date: invalid date adjustment: {val}\n"));
    }
    let Ok(mut amount) = num_s.parse::<i64>() else {
        return Err(format!("date: invalid date adjustment: {val}\n"));
    };
    if !relative {
        let ok = match unit {
            'y' => (0..=9999).contains(&amount),
            'm' => (1..=12).contains(&amount),
            'w' => (0..=6).contains(&amount),
            'd' => (1..=31).contains(&amount),
            'H' => (0..=23).contains(&amount),
            'M' | 'S' => (0..=59).contains(&amount),
            _ => false,
        };
        if !ok {
            return Err(format!("date: invalid date adjustment: {val}\n"));
        }
        if unit == 'y' && amount <= 1900 {
            amount += if amount < 69 { 2000 } else { 1900 };
        }
    }
    Ok(BsdDateAdj {
        unit,
        amount,
        relative,
    })
}

fn apply_bsd_adjustments(
    mut sec: i64,
    adjs: &[BsdDateAdj],
    tz_offset: i64,
) -> Result<i64, String> {
    for adj in adjs {
        if adj.relative && matches!(adj.unit, 'H' | 'M' | 'S') {
            let scale = match adj.unit {
                'H' => 3600,
                'M' => 60,
                _ => 1,
            };
            sec += adj.amount * scale;
            continue;
        }
        let local = sec + tz_offset;
        let days = local.div_euclid(86400);
        let rem = local.rem_euclid(86400);
        let mut h = (rem / 3600) as i64;
        let mut min = ((rem % 3600) / 60) as i64;
        let mut s = rem % 60;
        let (mut y, mut m, mut d) = civil_from_days(days);
        match adj.unit {
            'y' | 'm' => {
                if adj.unit == 'y' {
                    y = if adj.relative { y + adj.amount } else { adj.amount };
                } else {
                    let target_m = if adj.relative {
                        (m as i64) + adj.amount
                    } else {
                        adj.amount
                    };
                    let (ny, nm) = normalize_year_month(y, target_m);
                    y = ny;
                    m = nm;
                }
                let max_d = gregorian_days_in_month(y, m);
                d = d.min(max_d);
                let new_days = days_from_civil(y, m as i64, d as i64);
                sec = new_days * 86400 + h * 3600 + min * 60 + s - tz_offset;
            }
            'w' => {
                let dow0 = (days + 4).rem_euclid(7);
                let delta = if adj.relative {
                    adj.amount * 7
                } else {
                    adj.amount - dow0
                };
                sec = (days + delta) * 86400 + h * 3600 + min * 60 + s - tz_offset;
            }
            'd' => {
                if adj.relative {
                    sec = (days + adj.amount) * 86400 + h * 3600 + min * 60 + s - tz_offset;
                } else {
                    let max_d = gregorian_days_in_month(y, m);
                    if adj.amount < 1 || (adj.amount as u32) > max_d {
                        return Err("date: invalid calendar date adjustment\n".to_string());
                    }
                    d = adj.amount as u32;
                    let new_days = days_from_civil(y, m as i64, d as i64);
                    sec = new_days * 86400 + h * 3600 + min * 60 + s - tz_offset;
                }
            }
            'H' => {
                h = adj.amount;
                sec = days * 86400 + h * 3600 + min * 60 + s - tz_offset;
            }
            'M' => {
                min = adj.amount;
                sec = days * 86400 + h * 3600 + min * 60 + s - tz_offset;
            }
            'S' => {
                s = adj.amount;
                sec = days * 86400 + h * 3600 + min * 60 + s - tz_offset;
            }
            _ => {}
        }
    }
    Ok(sec)
}

fn format_date_offset(offset: i64, colons: usize) -> (String, usize) {
    let sign = if offset < 0 { '-' } else { '+' };
    let total = offset.unsigned_abs();
    let hours = total / 3600;
    let minutes = (total % 3600) / 60;
    let seconds = total % 60;
    if colons == 0 {
        (format!("{sign}{:04}", hours * 100 + minutes), 5)
    } else if colons == 2 || (colons == 3 && seconds != 0) {
        (format!("{sign}{hours:02}:{minutes:02}:{seconds:02}"), 9)
    } else if colons == 1 || minutes != 0 {
        (format!("{sign}{hours:02}:{minutes:02}"), 6)
    } else {
        (format!("{sign}{hours:02}"), 3)
    }
}

pub(super) fn render_date_format(
    fmt: &str,
    epoch_sec: i64,
    ns: u32,
    tz_offset: i64,
    tz_label: &str,
) -> Result<String, String> {
    let local = epoch_sec + tz_offset;
    let days = local.div_euclid(86400);
    let rem = local.rem_euclid(86400);
    let hour = (rem / 3600) as u32;
    let min = ((rem % 3600) / 60) as u32;
    let sec = (rem % 60) as u32;
    let (year, month, day) = civil_from_days(days);
    let dow0 = (days + 4).rem_euclid(7) as usize;
    let dow_iso = if dow0 == 0 { 7 } else { dow0 };
    let jan1_days = days_from_civil(year, 1, 1);
    let ordinal = (days - jan1_days + 1) as u32;

    let thursday_days = days + (3 - ((dow0 as i64 + 6) % 7));
    let (iso_year, _, _) = civil_from_days(thursday_days);
    let iso_jan1 = days_from_civil(iso_year, 1, 1);
    let iso_week = ((thursday_days - iso_jan1) / 7 + 1) as u32;

    let short_days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let full_days = [
        "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
    ];
    let short_months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let full_months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ];
    let m_idx = (month.saturating_sub(1) as usize).min(11);
    let hour12 = if hour.is_multiple_of(12) { 12 } else { hour % 12 };
    let meridian = if hour < 12 { "AM" } else { "PM" };
    let nano_str = format!("{ns:09}");

    let mut out = String::with_capacity(fmt.len() + 32);
    let bytes = fmt.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] != b'%' {
            let ch = fmt[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
            continue;
        }
        let token_start = i;
        i += 1;
        let mut pad_override: Option<&str> = None;
        let mut upper = false;
        let mut swap = false;
        while i < bytes.len() {
            match bytes[i] {
                b'^' => upper = true,
                b'#' => swap = true,
                b'-' => pad_override = Some(""),
                b'_' => pad_override = Some(" "),
                b'0' => pad_override = Some("0"),
                _ => break,
            }
            i += 1;
        }
        let w_start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        let width: Option<usize> = if i > w_start {
            Some(fmt[w_start..i].parse::<usize>().unwrap_or(usize::MAX))
        } else {
            None
        };
        let mut colons = 0usize;
        while i < bytes.len() && bytes[i] == b':' {
            colons += 1;
            i += 1;
        }
        let modifier = bytes.get(i).copied().filter(|c| matches!(c, b'E' | b'O'));
        if modifier.is_some() { i += 1; }
        if i >= bytes.len() {
            return Err("date: unsupported date format directive\n".to_string());
        }
        let code = fmt[i..].chars().next().unwrap();
        i += code.len_utf8();
        if colons > 3 || (colons > 0 && code != 'z') {
            return Err("date: unsupported date format directive\n".to_string());
        }
        if code == '%' && (pad_override.is_some() || upper || swap || width.is_some() || modifier.is_some()) {
            return Err("date: only an unmodified %% literal is supported\n".into());
        }
        if let Some(m) = modifier && !(if m == b'E' { "cCxXyY" } else { "deHImMSuUVwWy" }).contains(code) {
            return Err(format!("date: unsupported date format modifier: %{}{code}\n",m as char));
        }
        // Check the size of generated padding before allocating it. An unpadded
        // conversion can accept a large width without generating a large string.
        if pad_override != Some("") && width.is_some_and(|w| w > (1usize << 29).saturating_sub(24 + out.len())) {
            return Err("date: format width limit exceeded\n".into());
        }
        if code == '%' {
            out.push('%');
            continue;
        }
        if code == 'N' {
            if &fmt[token_start..i] == "%-N" {
                out.push_str(&nano_str[..6]);
                continue;
            }
            let prec = width.unwrap_or(9);
            let sliced = &nano_str[..prec.min(9)];
            let trimmed = sliced.trim_end_matches('0');
            let digits = if trimmed.is_empty() { "0" } else { trimmed };
            if pad_override == Some("") {
                out.push_str(digits);
            } else {
                let pad_ch = pad_override.unwrap_or("0").chars().next().unwrap_or('0');
                out.push_str(digits);
                if prec > digits.len() {
                    for _ in 0..(prec - digits.len()) {
                        out.push(pad_ch);
                    }
                }
            }
            continue;
        }
        if code == 'F' {
            let y_str = if pad_override == Some("") {
                year.to_string()
            } else {
                let yw = if width.is_none() && pad_override.is_none() {
                    4
                } else {
                    width.unwrap_or(0).saturating_sub(6)
                };
                let pch = pad_override.unwrap_or("0");
                if pch == " " {
                    format!("{year:>yw$}")
                } else {
                    format!("{year:0yw$}")
                }
            };
            out.push_str(&format!("{y_str}-{month:02}-{day:02}"));
            continue;
        }

        let mut def_width = 0usize;
        let mut def_pad = "0";
        let mut val: String = match code {
            'a' => short_days[dow0].to_string(),
            'A' => full_days[dow0].to_string(),
            'b' | 'h' => short_months[m_idx].to_string(),
            'B' => full_months[m_idx].to_string(),
            'c' => format!(
                "{} {} {:2} {hour:02}:{min:02}:{sec:02} {year:04}",
                short_days[dow0], short_months[m_idx], day
            ),
            'C' => {
                def_width = 2;
                year.div_euclid(100).to_string()
            }
            'd' => {
                def_width = 2;
                day.to_string()
            }
            'e' => {
                def_width = 2;
                def_pad = " ";
                day.to_string()
            }
            'D' | 'x' => {
                let yy = (year % 100).abs();
                match (code, pad_override) {
                    ('D', Some("")) => format!("{month:02}/{day:02}/{yy}"),
                    ('D', Some(" ")) => format!("{month:02}/{day:02}/{yy:2}"),
                    _ => format!("{month:02}/{day:02}/{yy:02}"),
                }
            }
            'g' => {
                def_width = 2;
                (iso_year % 100).abs().to_string()
            }
            'G' => {
                def_width = 4;
                iso_year.to_string()
            }
            'H' => {
                def_width = 2;
                hour.to_string()
            }
            'k' => {
                def_width = 2;
                def_pad = " ";
                hour.to_string()
            }
            'I' => {
                def_width = 2;
                hour12.to_string()
            }
            'l' => {
                def_width = 2;
                def_pad = " ";
                hour12.to_string()
            }
            'j' => {
                def_width = 3;
                ordinal.to_string()
            }
            'm' => {
                def_width = 2;
                month.to_string()
            }
            'M' => {
                def_width = 2;
                min.to_string()
            }
            'n' => "\n".to_string(),
            'p' => meridian.to_string(),
            'P' => meridian.to_ascii_lowercase(),
            'q' => {
                def_width = 1;
                ((month - 1) / 3 + 1).to_string()
            }
            'r' => format!("{hour12:02}:{min:02}:{sec:02} {meridian}"),
            'R' => format!("{hour:02}:{min:02}"),
            's' => {
                def_width = 1;
                epoch_sec.to_string()
            }
            'S' => {
                def_width = 2;
                sec.to_string()
            }
            't' => "\t".to_string(),
            'T' | 'X' => format!("{hour:02}:{min:02}:{sec:02}"),
            'u' => {
                def_width = 1;
                dow_iso.to_string()
            }
            'U' => {
                def_width = 2;
                ((ordinal as usize + 6 - dow0) / 7).to_string()
            }
            'V' => {
                def_width = 2;
                iso_week.to_string()
            }
            'w' => {
                def_width = 1;
                dow0.to_string()
            }
            'W' => {
                def_width = 2;
                ((ordinal as usize + 6 - ((dow0 + 6) % 7)) / 7).to_string()
            }
            'y' => {
                def_width = 2;
                (year % 100).abs().to_string()
            }
            'Y' => {
                def_width = 4;
                year.to_string()
            }
            'z' => {
                let (s, w) = format_date_offset(tz_offset, colons);
                def_width = w;
                s
            }
            'Z' => tz_label.to_string(),
            _ => return Err(format!("date: unsupported date format directive: %{code}\n")),
        };

        if code == 'P' || (swap && (code == 'p' || code == 'Z')) {
            val = val.to_ascii_lowercase();
        } else if upper || (swap && matches!(code, 'a' | 'A' | 'b' | 'B' | 'h')) {
            val = val.to_ascii_uppercase();
        }
        let fill = pad_override.unwrap_or(if def_width > 0 || code == 'z' {
            def_pad
        } else {
            " "
        });
        let min_w = width.unwrap_or(def_width);
        if !fill.is_empty() && min_w > val.len() {
            let pad_ch = fill.chars().next().unwrap_or(' ');
            let pad_count = min_w - val.len();

            if (val.starts_with('+') || val.starts_with('-')) && pad_ch == '0' {
                let sign_ch = val.chars().next().unwrap();
                out.push(sign_ch);
                out.extend(std::iter::repeat_n(pad_ch, pad_count));
                out.push_str(&val[1..]);
            } else {
                out.extend(std::iter::repeat_n(pad_ch, pad_count));
                out.push_str(&val);
            }
            continue;
        }
        out.push_str(&val);
    }
    out.push('\n');
    Ok(out)
}

pub(crate) fn format_strftime_for_printf(
    fmt: &str,
    epoch_sec: i64,
    tz_env: Option<&str>,
) -> Result<String, String> {
    let expanded = fmt
        .replace("%+", "%a %b %e %H:%M:%S %Z %Y")
        .replace("%v", "%e-%b-%Y");
    let (tz_offset, tz_label) = parse_tz_spec(tz_env, false);
    let rendered = render_date_format(&expanded, epoch_sec, 0, tz_offset, &tz_label)?;
    Ok(rendered
        .strip_suffix('\n')
        .unwrap_or(&rendered)
        .to_string())
}

fn cmd_date(
    args: &[String],
    mut stdin: CommandInput,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> Result<BuiltinOutcome, CommandFailure> {
    let mut utc = false;
    let mut ended = false;
    let mut input_spec: Option<String> = None;
    let mut ref_spec: Option<(String, bool)> = None;
    let mut batch_file: Option<String> = None;
    let mut adjustments: Vec<BsdDateAdj> = Vec::new();
    let mut style_fmt: Option<String> = None;
    let mut plus_fmt: Option<String> = None;

    let iso_fmt = |prec: &str| -> Result<String, String> {
        if !prec.is_empty() {
            if "date".starts_with(prec) {
                return Ok("%F".to_string());
            }
            if "hours".starts_with(prec) {
                return Ok("%FT%H%:z".to_string());
            }
            if "minutes".starts_with(prec) {
                return Ok("%FT%H:%M%:z".to_string());
            }
            if "seconds".starts_with(prec) {
                return Ok("%FT%T%:z".to_string());
            }
            if "ns".starts_with(prec) {
                return Ok("%FT%T,%N%:z".to_string());
            }
        }
        Err(format!("date: unsupported ISO precision: {prec}\n"))
    };

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if !ended && a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if !ended && a.starts_with("--") {
            let (name, attached) = match a.split_once('=') {
                Some((n, v)) => (n, Some(v.to_string())),
                None => (a.as_str(), None),
            };
            match name {
                "--help" => return Ok(ok_out("Usage: date [-uj] [-d DATE | -r FILE_OR_SECONDS | -f FILE] [-v[+|-]VALUE[ymwdHMS]] [+FORMAT]\n-f, --file=FILE reads one date per line; FILE - reads stdin.\nAlso: -I[date|hours|minutes|seconds|ns], -R, --rfc-3339=PRECISION\nDATE accepts @seconds, ISO calendar/time, RFC dates, now/today/yesterday/tomorrow, and integer seconds/minutes/hours relative to now.\nVirtual TZ defaults to UTC; no clock setting or host-locale parsing.\n")),
                "--version" => return Ok(ok_out("date (safe-bash virtual command)\n")),
                "--utc" | "--universal" => utc = true,
                "--date" => {
                    let val = if let Some(v) = attached {
                        v
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return Ok(err_out("date: option requires an argument: --date\n", 1));
                    };
                    input_spec = Some(val);
                }
                "--reference" => {
                    let val = if let Some(v) = attached {
                        v
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return Ok(err_out("date: option requires an argument: --reference\n", 1));
                    };
                    ref_spec = Some((val, false));
                }
                "--file" => {
                    let val = if let Some(v) = attached {
                        v
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return Ok(err_out("date: option requires an argument: --file\n", 1));
                    };
                    batch_file = Some(val);
                }
                "--iso-8601" => {
                    let p = attached.as_deref().unwrap_or("date");
                    match iso_fmt(p) {
                        Ok(f) => style_fmt = Some(f),
                        Err(msg) => return Ok(err_out(&msg, 1)),
                    }
                }
                "--rfc-email" | "--rfc-2822" | "--rfc-822" => {
                    style_fmt = Some("%a, %d %b %Y %T %z".to_string());
                }
                "--rfc-3339" => {
                    let p = if let Some(v) = attached {
                        v
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return Ok(err_out("date: option requires an argument: --rfc-3339\n", 1));
                    };
                    if p.is_empty()
                        || !["date", "seconds", "ns"].iter().any(|item| item.starts_with(p.as_str()))
                    {
                        return Ok(err_out(&format!("date: unsupported RFC3339 precision: {p}\n"), 1));
                    }
                    let f = if "date".starts_with(p.as_str()) {
                        "%F"
                    } else if "ns".starts_with(p.as_str()) {
                        "%F %T.%N%:z"
                    } else {
                        "%F %T%:z"
                    };
                    style_fmt = Some(f.to_string());
                }
                _ => return Ok(err_out(&format!("date: unsupported option: {name}\n"), 1)),
            }
            i += 1;
            continue;
        }
        if !ended && a.starts_with('-') && a != "-" {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut pos = 0usize;
            while pos < chars.len() {
                let flag = chars[pos];
                match flag {
                    'u' => {
                        utc = true;
                        pos += 1;
                    }
                    'j' => {
                        pos += 1;
                    }
                    'R' => {
                        style_fmt = Some("%a, %d %b %Y %T %z".to_string());
                        pos += 1;
                    }
                    'I' => {
                        let rest: String = chars[pos + 1..].iter().collect();
                        let p = if rest.is_empty() { "date" } else { rest.as_str() };
                        match iso_fmt(p) {
                            Ok(f) => style_fmt = Some(f),
                            Err(msg) => return Ok(err_out(&msg, 1)),
                        }
                        break;
                    }
                    'd' | 'r' | 'f' | 'v' => {
                        let rest: String = chars[pos + 1..].iter().collect();
                        let val = if !rest.is_empty() {
                            rest
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            return Ok(err_out(
                                &format!("date: option requires an argument: -{flag}\n"),
                                1,
                            ));
                        };
                        match flag {
                            'd' => input_spec = Some(val),
                            'r' => ref_spec = Some((val, true)),
                            'f' => batch_file = Some(val),
                            'v' => match parse_bsd_adjustment(&val) {
                                Ok(adj) => adjustments.push(adj),
                                Err(msg) => return Ok(err_out(&msg, 1)),
                            },
                            _ => {}
                        }
                        break;
                    }
                    _ => return Ok(err_out(&format!("date: unsupported option: -{flag}\n"), 1)),
                }
            }
            i += 1;
            continue;
        }
        if let Some(f) = a.strip_prefix('+') {
            if plus_fmt.is_some() || style_fmt.is_some() {
                return Ok(err_out("date: multiple output formats specified\n", 1));
            }
            plus_fmt = Some(f.to_string());
            i += 1;
            continue;
        }
        return Ok(err_out(&format!("date: unexpected operand: {a}\n"), 1));
    }

    if input_spec.is_some() && ref_spec.is_some() {
        return Ok(err_out("date: --date and --reference are mutually exclusive\n", 1));
    }
    if batch_file.is_some() && (input_spec.is_some() || ref_spec.is_some()) {
        return Ok(err_out("date: --file, --date and --reference are mutually exclusive\n", 1));
    }
    let fmt = plus_fmt
        .or(style_fmt)
        .unwrap_or_else(|| "%a %b %e %H:%M:%S %Z %Y".to_string());
    let (tz_offset, tz_label) = parse_tz_spec(env.get("TZ").map(|s| s.as_str()), utc);
    let Some(now) = super::fs::calendar_instant(crate::vfs::now_ms(), false) else {
        return Ok(err_out("date: invalid clock or modification time\n", 1));
    };

    if let Some(fpath) = batch_file {
        let mut output = ok_out("");
        let mut format_failed = false;
        let result = stdin.read_records(&fpath, cwd, fs, false, b'\n', |line| {
            let line = line.strip_prefix(b"\xef\xbb\xbf").unwrap_or(line);
            let text = String::from_utf8_lossy(line);
            let (sec, ns) = match parse_date_spec_full(text.trim_end_matches('\r'), tz_offset, now) {
                Ok(instant) => instant,
                Err(msg) => {
                    output.stderr.push_str(&msg);
                    output.exit_code = 1;
                    return Ok(());
                }
            };
            let rendered = apply_bsd_adjustments(sec, &adjustments, tz_offset)
                .and_then(|sec| render_date_format(&fmt, sec, ns, tz_offset, &tz_label));
            match rendered {
                Ok(line) => { output.stdout.push_str(&line); Ok(()) }
                Err(msg) => { format_failed = true; Err(msg) }
            }
        });
        if let Err(message) = result {
            if !format_failed && fpath == "-" && message.starts_with("EFBIG:") {
                return Err(CommandFailure { output, message });
            }
            if !format_failed { output.stderr.push_str("date: "); }
            output.stderr.push_str(&message);
            if !format_failed { output.stderr.push('\n'); }
            output.exit_code = 1;
        }
        return Ok(output);
    }

    let (mut epoch_sec, ns) = if let Some(ref spec) = input_spec {
        match parse_date_spec_full(spec, tz_offset, now) {
            Ok(v) => v,
            Err(msg) => return Ok(err_out(&msg, 1)),
        }
    } else if let Some((ref rval, allow_epoch)) = ref_spec {
        let path = absolute_operand(cwd, rval);
        match fs.access_path(&path, true).and_then(|p| fs.stat(&p)) {
            Ok(st) => match super::fs::calendar_instant(st.mtime_ms, false) {
                Some(instant) => instant,
                None => return Ok(err_out("date: invalid clock or modification time\n", 1)),
            },
            Err(e) if e.starts_with("ENOENT") || e.ends_with("(os error 2)") => {
                let number = rval.strip_prefix(['+', '-']).unwrap_or(rval);
                let (whole, fraction) = number.split_once('.').map_or((number, None), |(w,f)| (w, Some(f)));
                let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
                if !allow_epoch || !digits(whole) || !fraction.is_none_or(digits) {
                    return Ok(err_out(&format!("date: ENOENT: no such file or directory, stat '{path}'\n"), 1));
                }
                match parse_epoch_ns(&format!("@{rval}")) {
                    Some((sec, ns)) if (-8_640_000_000_000..8_640_000_000_000).contains(&sec) || (sec, ns) == (8_640_000_000_000, 0) => (sec, ns),
                    _ => return Ok(err_out("date: date is outside the supported range\n", 1)),
                }
            }
            Err(e) => return Ok(err_out(&format!("date: {e}\n"), 1)),
        }
    } else {
        now
    };

    if !adjustments.is_empty() {
        epoch_sec = match apply_bsd_adjustments(epoch_sec, &adjustments, tz_offset) {
            Ok(v) => v,
            Err(msg) => return Ok(err_out(&msg, 1)),
        };
    }

    Ok(match render_date_format(&fmt, epoch_sec, ns, tz_offset, &tz_label) {
        Ok(rendered) => ok_out(&rendered),
        Err(msg) => err_out(&msg, 1),
    })
}

fn parse_cal_month_name(s: &str) -> Option<u32> {
    if let Ok(n) = s.parse::<u32>()
        && (1..=12).contains(&n)
    {
        return Some(n);
    }
    let low = s.to_ascii_lowercase();
    let names = [
        "january", "february", "march", "april", "may", "june",
        "july", "august", "september", "october", "november", "december",
    ];
    for (idx, name) in names.iter().enumerate() {
        if low.len() >= 3 && name.starts_with(&low) {
            return Some((idx + 1) as u32);
        }
    }
    None
}

fn cal_is_leap(year: u32) -> bool {
    year.is_multiple_of(4) && (year <= 1752 || !year.is_multiple_of(100) || year.is_multiple_of(400))
}

fn cal_days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => if cal_is_leap(year) { 29 } else { 28 },
        _ => 30,
    }
}

fn cal_day_of_week(year: u32, month: u32, day: u32) -> usize {
    let t = [0i64, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let mut y = year as i64;
    if month < 3 {
        y -= 1;
    }
    let m_idx = (month.clamp(1, 12) - 1) as usize;
    let d = day as i64;
    if year > 1752 || (year == 1752 && (month > 9 || (month == 9 && day >= 14))) {
        (y + y.div_euclid(4) - y.div_euclid(100) + y.div_euclid(400) + t[m_idx] + d)
            .rem_euclid(7) as usize
    } else {
        (y + y.div_euclid(4) + t[m_idx] + d + 5).rem_euclid(7) as usize
    }
}

fn cal_day_of_year(year: u32, month: u32, day: u32) -> u32 {
    let mut total = 0u32;
    for m in 1..month {
        if year == 1752 && m == 9 {
            total += 19;
        } else {
            total += cal_days_in_month(year, m);
        }
    }
    if year == 1752 && month == 9 && day >= 14 {
        total + (day - 11)
    } else {
        total + day
    }
}

struct CalMonthGrid {
    header: String,
    day_header: String,
    weeks: Vec<String>,
}

fn render_cal_month_grid(
    year: u32,
    month: u32,
    monday_first: bool,
    julian: bool,
    include_year: bool,
) -> CalMonthGrid {
    let month_names = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ];
    let mname = month_names[(month.clamp(1, 12) - 1) as usize];
    let cell_w = if julian { 3usize } else { 2usize };
    let grid_w = cell_w * 7 + 6;
    let title = if include_year {
        format!("{mname} {year}")
    } else {
        mname.to_string()
    };
    let left_pad = grid_w.saturating_sub(title.len()) / 2;
    let header = format!("{}{title}", " ".repeat(left_pad));
    let sun_days = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    let ordered: Vec<&str> = if monday_first {
        vec!["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
    } else {
        sun_days.to_vec()
    };
    let day_header = ordered
        .iter()
        .map(|d| format!("{d:>cell_w$}"))
        .collect::<Vec<_>>()
        .join(" ");

    let mut days: Vec<u32> = Vec::new();
    if year == 1752 && month == 9 {
        days.push(1);
        days.push(2);
        for d in 14..=30 {
            days.push(d);
        }
    } else {
        let dim = cal_days_in_month(year, month);
        for d in 1..=dim {
            days.push(d);
        }
    }

    let first_dow = cal_day_of_week(year, month, days[0]);
    let start_col = if monday_first { (first_dow + 6) % 7 } else { first_dow };
    let mut weeks: Vec<String> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    for _ in 0..start_col {
        row.push(" ".repeat(cell_w));
    }
    for d in days {
        let val = if julian {
            cal_day_of_year(year, month, d)
        } else {
            d
        };
        row.push(format!("{val:>cell_w$}"));
        if row.len() == 7 {
            let line = row.join(" ");
            weeks.push(format!("{line:<grid_w$}"));
            row.clear();
        }
    }
    if !row.is_empty() {
        while row.len() < 7 {
            row.push(" ".repeat(cell_w));
        }
        let line = row.join(" ");
        weeks.push(format!("{line:<grid_w$}"));
    }
    while weeks.len() < 6 {
        weeks.push(" ".repeat(grid_w));
    }
    CalMonthGrid {
        header,
        day_header,
        weeks,
    }
}

fn cal_iso_week_number(year: u32, month: u32, day: u32) -> u32 {
    let z = days_from_civil(year as i64, month as i64, day as i64);
    let dow0 = (z + 4).rem_euclid(7);
    let day_num = if dow0 == 0 { 7 } else { dow0 };
    let thu_z = z + 4 - day_num;
    let (thu_year, _, _) = civil_from_days(thu_z);
    let year_start_z = days_from_civil(thu_year, 1, 1);
    let diff_days = thu_z - year_start_z;
    ((diff_days + 7) / 7) as u32
}

fn render_vertical_ncal_month(
    year: u32,
    month: u32,
    monday_first: bool,
    julian: bool,
    include_year: bool,
    show_weeks: bool,
) -> Vec<String> {
    let month_names = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ];
    let mname = month_names[(month.clamp(1, 12) - 1) as usize];
    let cell_w = if julian { 3usize } else { 2usize };
    let title = if include_year {
        format!("{mname} {year}")
    } else {
        mname.to_string()
    };
    let left_pad = 19usize.saturating_sub(title.len()) / 2;
    let centered = format!(" {}{title}", " ".repeat(left_pad));
    let header = format!("{centered:<22}");
    let sun_days = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    let ordered: Vec<&str> = if monday_first {
        vec!["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
    } else {
        sun_days.to_vec()
    };

    let mut days: Vec<u32> = Vec::new();
    if year == 1752 && month == 9 {
        days.push(1);
        days.push(2);
        for d in 14..=30 {
            days.push(d);
        }
    } else {
        let dim = cal_days_in_month(year, month);
        for d in 1..=dim {
            days.push(d);
        }
    }

    let first_dow = cal_day_of_week(year, month, days[0]);
    let start_row = if monday_first { (first_dow + 6) % 7 } else { first_dow };

    let mut cols: Vec<[Option<u32>; 7]> = Vec::new();
    let mut cur_col = [None; 7];
    let mut r = start_row as usize;
    for d in days {
        cur_col[r] = Some(d);
        r += 1;
        if r == 7 {
            cols.push(cur_col);
            cur_col = [None; 7];
            r = 0;
        }
    }
    if r > 0 {
        cols.push(cur_col);
    }
    while cols.len() < 6 {
        cols.push([None; 7]);
    }

    let mut lines: Vec<String> = vec![header];
    for row_idx in 0..7 {
        let mut line = ordered[row_idx].to_string();
        for c in 0..6 {
            if let Some(d) = cols[c][row_idx] {
                let val = if julian {
                    cal_day_of_year(year, month, d)
                } else {
                    d
                };
                line.push(' ');
                line.push_str(&format!("{val:>cell_w$}"));
            } else {
                line.push_str(&" ".repeat(cell_w + 1));
            }
        }
        lines.push(line);
    }

    if show_weeks {
        let mut week_line = "  ".to_string();
        for c in 0..6 {
            let mut last_day: Option<u32> = None;
            for x in cols[c] {
                if x.is_some() {
                    last_day = x;
                }
            }
            if let Some(ref_day) = last_day {
                let wn = cal_iso_week_number(year, month, ref_day);
                week_line.push(' ');
                week_line.push_str(&format!("{wn:>cell_w$}"));
            } else {
                week_line.push_str(&" ".repeat(cell_w + 1));
            }
        }
        lines.push(week_line);
    }

    lines
}

fn cmd_cal(cmd: &str, args: &[String], env: &BTreeMap<String, String>) -> BuiltinOutcome {
    let is_ncal_default = cmd == "ncal";
    let mut vertical_layout = is_ncal_default;
    let mut monday_first = is_ncal_default;
    let mut julian = false;
    let mut whole_year = false;
    let mut span_months: usize = 1;
    let mut span_around = false;
    let mut show_weeks = false;
    let mut after_months: usize = 0;
    let mut before_months: usize = 0;
    let mut explicit_month: Option<u32> = None;
    let mut explicit_year: Option<u32> = None;
    let mut operands: Vec<String> = Vec::new();

    let parse_date_ym = |spec: &str| -> Option<(u32, u32)> {
        let parts: Vec<&str> = spec.split('-').collect();
        if parts.len() < 2 || parts.len() > 3 {
            return None;
        }
        if !parts[0].chars().all(|c| c.is_ascii_digit()) || !parts[1].chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let y = parts[0].parse::<u32>().ok()?;
        let m = parts[1].parse::<u32>().ok()?;
        if !(1..=9999).contains(&y) || !(1..=12).contains(&m) {
            return None;
        }
        if parts.len() == 3 {
            if !parts[2].chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            let d = parts[2].parse::<u32>().ok()?;
            if d < 1 || d > cal_days_in_month(y, m) || (y == 1752 && m == 9 && (3..=13).contains(&d)) {
                return None;
            }
        }
        Some((y, m))
    };

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "--" {
            operands.extend_from_slice(&args[i + 1..]);
            break;
        }
        if a == "--help" {
            return ok_out("Usage:\n cal [options] [[[day] month] year]\n\nDisplay a calendar, or some part of it.\n\nOptions:\n -1, --one             show only a single month (default)\n -3, --three           show three months spanning the date\n -n, --months <num>    show num months starting with date's month\n -S, --span            span the date when displaying multiple months\n -s, --sunday          Sunday as first day of week (default)\n -M, --monday          Monday as first day of week\n -b                    use oldstyle cal output for ncal\n -C                    switch to cal mode\n -N                    switch to ncal mode\n -j, --julian          use day-of-year (Julian) numbering\n -y, --year            show whole current year\n -m, --month <month>   show specified month\n -w, --week[=<num>]    show US or ISO-8601 week numbers\n -h, --no-highlight    turn off highlighting of today\n     --help            display this help\n     --version         display version\n");
        }
        if a == "--version" {
            return ok_out("cal (Sandbox VFS-ish/GNU util-linux) 2.40\n");
        }
        if a == "-1" || a == "--one" {
            span_months = 1;
            span_around = false;
            i += 1;
        } else if a == "-3" || a == "--three" {
            span_months = 3;
            span_around = true;
            i += 1;
        } else if a == "-s" || a == "--sunday" {
            monday_first = false;
            i += 1;
        } else if a == "-M" || a == "--monday" {
            monday_first = true;
            i += 1;
        } else if a == "-b" || a == "-C" {
            vertical_layout = false;
            monday_first = false;
            i += 1;
        } else if a == "-N" {
            vertical_layout = true;
            monday_first = true;
            i += 1;
        } else if a == "-j" || a == "--julian" {
            julian = true;
            i += 1;
        } else if a == "-y" || a == "--year" {
            whole_year = true;
            i += 1;
        } else if a == "-S" || a == "--span" {
            if is_ncal_default && vertical_layout {
                monday_first = false;
            } else {
                span_around = true;
            }
            i += 1;
        } else if a == "-h" || a == "--no-highlight" || a == "-J" {
            i += 1;
        } else if a == "-w" || a == "--week" || a.starts_with("--week=") {
            show_weeks = true;
            i += 1;
        } else if a == "-m" || a == "--month" || a.starts_with("--month=") {
            let val = if let Some(v) = a.strip_prefix("--month=") {
                v.to_string()
            } else if i + 1 < args.len() {
                i += 1;
                args[i].clone()
            } else {
                return err_out("cal: option requires an argument -- 'm'\n", 1);
            };
            if val.is_empty() {
                return err_out("cal: option requires an argument -- 'm'\n", 1);
            }
            let Some(m) = parse_cal_month_name(&val) else {
                return err_out(
                    &format!("cal: '{val}' is neither a month number (1..12) nor a name\n"),
                    1,
                );
            };
            explicit_month = Some(m);
            i += 1;
        } else if a == "-n" || a == "--months" || a.starts_with("--months=") {
            let val = if let Some(v) = a.strip_prefix("--months=") {
                v.to_string()
            } else if i + 1 < args.len() {
                i += 1;
                args[i].clone()
            } else {
                return err_out("cal: invalid month count ''\n", 1);
            };
            let Ok(n) = val.parse::<usize>() else {
                return err_out(&format!("cal: invalid month count '{val}'\n"), 1);
            };
            if n < 1 {
                return err_out(&format!("cal: invalid month count '{val}'\n"), 1);
            }
            span_months = n;
            i += 1;
        } else if a == "-d" || a == "--date" || a.starts_with("--date=") {
            let val = if let Some(v) = a.strip_prefix("--date=") {
                v.to_string()
            } else if i + 1 < args.len() {
                i += 1;
                args[i].clone()
            } else {
                return err_out("cal: invalid date ''\n", 1);
            };
            let Some((y, m)) = parse_date_ym(&val) else {
                return err_out(&format!("cal: invalid date '{val}'\n"), 1);
            };
            explicit_year = Some(y);
            explicit_month = Some(m);
            i += 1;
        } else if a == "-A" || a == "-B" {
            let flag = a.clone();
            if i + 1 >= args.len() {
                return err_out("cal: invalid month count ''\n", 1);
            }
            i += 1;
            let Ok(cnt) = args[i].parse::<usize>() else {
                return err_out(&format!("cal: invalid month count '{}'\n", args[i]), 1);
            };
            if flag == "-A" {
                after_months = cnt;
            } else {
                before_months = cnt;
            }
            i += 1;
        } else if let Some(flags) = a.strip_prefix('-') && !flags.is_empty() {
            let chars: Vec<char> = flags.chars().collect();
            let mut j = 0usize;
            while j < chars.len() {
                let ch = chars[j];
                match ch {
                    '1' => {
                        span_months = 1;
                        span_around = false;
                    }
                    '3' => {
                        span_months = 3;
                        span_around = true;
                    }
                    's' => monday_first = false,
                    'M' => monday_first = true,
                    'b' | 'C' => {
                        vertical_layout = false;
                        monday_first = false;
                    }
                    'N' => {
                        vertical_layout = true;
                        monday_first = true;
                    }
                    'j' => julian = true,
                    'y' => whole_year = true,
                    'S' => {
                        if is_ncal_default && vertical_layout {
                            monday_first = false;
                        } else {
                            span_around = true;
                        }
                    }
                    'h' | 'J' => {}
                    'w' => show_weeks = true,
                    'm' | 'n' | 'd' | 'A' | 'B' => {
                        let rest: String = chars[j + 1..].iter().collect();
                        let val = if !rest.is_empty() {
                            rest
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            return match ch {
                                'm' => err_out("cal: option requires an argument -- 'm'\n", 1),
                                'd' => err_out("cal: invalid date ''\n", 1),
                                _ => err_out("cal: invalid month count ''\n", 1),
                            };
                        };
                        match ch {
                            'm' => {
                                let Some(m) = parse_cal_month_name(&val) else {
                                    return err_out(
                                        &format!(
                                            "cal: '{val}' is neither a month number (1..12) nor a name\n"
                                        ),
                                        1,
                                    );
                                };
                                explicit_month = Some(m);
                            }
                            'n' => {
                                let Ok(n) = val.parse::<usize>() else {
                                    return err_out(
                                        &format!("cal: invalid month count '{val}'\n"),
                                        1,
                                    );
                                };
                                if n < 1 {
                                    return err_out(
                                        &format!("cal: invalid month count '{val}'\n"),
                                        1,
                                    );
                                }
                                span_months = n;
                            }
                            'd' => {
                                let Some((y, m)) = parse_date_ym(&val) else {
                                    return err_out(&format!("cal: invalid date '{val}'\n"), 1);
                                };
                                explicit_year = Some(y);
                                explicit_month = Some(m);
                            }
                            'A' => {
                                let Ok(cnt) = val.parse::<usize>() else {
                                    return err_out(
                                        &format!("cal: invalid month count '{val}'\n"),
                                        1,
                                    );
                                };
                                after_months = cnt;
                            }
                            'B' => {
                                let Ok(cnt) = val.parse::<usize>() else {
                                    return err_out(
                                        &format!("cal: invalid month count '{val}'\n"),
                                        1,
                                    );
                                };
                                before_months = cnt;
                            }
                            _ => {}
                        }
                        break;
                    }
                    _ => return err_out(&format!("cal: invalid option -- '{ch}'\n"), 1),
                }
                j += 1;
            }
            i += 1;
        } else {
            operands.push(a.clone());
            i += 1;
        }
    }

    if after_months > 0 || before_months > 0 {
        span_months = before_months + 1 + after_months;
    }
    let mut year = explicit_year;
    let mut month = explicit_month;

    match operands.len() {
        0 => {}
        1 => {
            if !operands[0].chars().all(|c| c.is_ascii_digit()) {
                return err_out(&format!("cal: not a valid year {}\n", operands[0]), 1);
            }
            let Ok(y) = operands[0].parse::<u32>() else {
                return err_out(&format!("cal: not a valid year {}\n", operands[0]), 1);
            };
            if !(1..=9999).contains(&y) {
                return err_out(&format!("cal: not a valid year {}\n", operands[0]), 1);
            }
            year = Some(y);
            if explicit_month.is_none() {
                whole_year = true;
            }
        }
        2 => {
            let Some(m) = parse_cal_month_name(&operands[0]) else {
                return err_out(
                    &format!(
                        "cal: '{}' is neither a month number (1..12) nor a name\n",
                        operands[0]
                    ),
                    1,
                );
            };
            if !operands[1].chars().all(|c| c.is_ascii_digit()) {
                return err_out(&format!("cal: not a valid year {}\n", operands[1]), 1);
            }
            let Ok(y) = operands[1].parse::<u32>() else {
                return err_out(&format!("cal: not a valid year {}\n", operands[1]), 1);
            };
            if !(1..=9999).contains(&y) {
                return err_out(&format!("cal: not a valid year {}\n", operands[1]), 1);
            }
            month = Some(m);
            year = Some(y);
        }
        3 => {
            let Some(m) = parse_cal_month_name(&operands[1]) else {
                return err_out("cal: invalid date arguments\n", 1);
            };
            if !operands[2].chars().all(|c| c.is_ascii_digit()) || !operands[0].chars().all(|c| c.is_ascii_digit()) {
                return err_out("cal: invalid date arguments\n", 1);
            }
            let Ok(y) = operands[2].parse::<u32>() else {
                return err_out("cal: invalid date arguments\n", 1);
            };
            let Ok(d) = operands[0].parse::<u32>() else {
                return err_out("cal: invalid date arguments\n", 1);
            };
            if !(1..=9999).contains(&y)
                || d < 1
                || d > cal_days_in_month(y, m)
                || (y == 1752 && m == 9 && (3..=13).contains(&d))
            {
                return err_out("cal: invalid date arguments\n", 1);
            }
            month = Some(m);
            year = Some(y);
        }
        _ => return err_out("cal: too many arguments\n", 1),
    }

    let count = if whole_year { 12usize } else { span_months };
    let ms = env.get("SOURCE_DATE_EPOCH").map_or_else(crate::vfs::now_ms, |s| {
        super::js_number(s, 0.0) * 1000.0
    });
    let date = (ms.abs() <= 8_640_000_000_000_000.0)
        .then(|| civil_from_days((ms as i64).div_euclid(86_400_000)));
    let Some(year) = year.map(i64::from).or_else(|| date.map(|(y, _, _)| y)) else {
        return err_out("cal: calendar span exceeds year range 1..9999\n", 1);
    };
    let month = month.or_else(|| date.map(|(_, m, _)| m)).unwrap_or(1);
    let first_total = if whole_year {
        year * 12
    } else {
        let offset = if before_months > 0 {
            before_months as i64
        } else if span_around {
            ((count - 1) / 2) as i64
        } else {
            0
        };
        year * 12 + (month as i64 - 1) - offset
    };
    if first_total < 12 || first_total + (count as i64) - 1 >= 10000 * 12 {
        return err_out("cal: calendar span exceeds year range 1..9999\n", 1);
    }

    let grid_w = if julian { 27usize } else { 20usize };
    let per_row = if julian { 2usize } else { 3usize };

    if vertical_layout {
        let mut grids: Vec<Vec<String>> = Vec::new();
        for idx in 0..count {
            let total = first_total + idx as i64;
            let gy = total.div_euclid(12) as u32;
            let gm = (total.rem_euclid(12) + 1) as u32;
            grids.push(render_vertical_ncal_month(
                gy,
                gm,
                monday_first,
                julian,
                !whole_year,
                show_weeks,
            ));
        }
        if count == 1 && !whole_year {
            let mut out = grids[0].join("\n");
            out.push('\n');
            return ok_out(&out);
        }
        let vertical_per_row = if whole_year {
            if julian { 3usize } else { 4usize }
        } else {
            per_row
        };
        let col_w = if julian { 26usize } else { 22usize };
        let mut lines: Vec<String> = Vec::new();
        if whole_year {
            let y_str = year.to_string();
            let total_w = col_w * vertical_per_row;
            let left = total_w.saturating_sub(y_str.len()) / 2;
            lines.push(format!("{}{y_str}", " ".repeat(left)));
        }
        let mut start = 0usize;
        while start < grids.len() {
            let end = (start + vertical_per_row).min(grids.len());
            let group = &grids[start..end];
            for line_idx in 0..group[0].len() {
                let mut row_str = String::new();
                for (g_idx, grid) in group.iter().enumerate() {
                    let raw = &grid[line_idx];
                    let text = if line_idx == 0 || g_idx == 0 {
                        raw.clone()
                    } else if raw.len() >= 2 {
                        format!("  {}", &raw[2..])
                    } else {
                        raw.clone()
                    };
                    row_str.push_str(&format!("{text:<col_w$}"));
                }
                lines.push(row_str);
            }
            if start + vertical_per_row < grids.len() {
                lines.push(String::new());
            }
            start += vertical_per_row;
        }
        let mut out = lines.join("\n");
        out.push('\n');
        return ok_out(&out);
    }

    if whole_year {
        let mut lines: Vec<String> = vec![format!("{}{year}", " ".repeat(28))];
        let mut start_m = 1u32;
        while start_m <= 12 {
            let mut row_grids = Vec::new();
            for k in 0..(per_row as u32) {
                if start_m + k <= 12 {
                    row_grids.push(render_cal_month_grid(
                        year as u32,
                        start_m + k,
                        monday_first,
                        julian,
                        false,
                    ));
                }
            }
            lines.push(format!(
                "{}  ",
                row_grids
                    .iter()
                    .map(|g| format!("{:<grid_w$}", g.header))
                    .collect::<Vec<_>>()
                    .join("  ")
            ));
            lines.push(format!(
                "{}  ",
                row_grids
                    .iter()
                    .map(|g| format!("{:<grid_w$}", g.day_header))
                    .collect::<Vec<_>>()
                    .join("  ")
            ));
            for w in 0..6 {
                lines.push(format!(
                    "{}  ",
                    row_grids
                        .iter()
                        .map(|g| g.weeks[w].as_str())
                        .collect::<Vec<_>>()
                        .join("  ")
                ));
            }
            if start_m + (per_row as u32) <= 12 {
                lines.push(String::new());
            }
            start_m += per_row as u32;
        }
        let mut out = lines.join("\n");
        out.push('\n');
        return ok_out(&out);
    }

    let start_year = first_total.div_euclid(12) as u32;
    let start_month = (first_total.rem_euclid(12) + 1) as u32;

    if span_months == 1 {
        let g = render_cal_month_grid(start_year, start_month, monday_first, julian, true);
        let mut lines = Vec::new();
        lines.push(format!("{:<grid_w$}  ", g.header));
        lines.push(format!("{:<grid_w$}  ", g.day_header));
        for w in g.weeks {
            lines.push(format!("{w:<grid_w$}  "));
        }
        let mut out = lines.join("\n");
        out.push('\n');
        return ok_out(&out);
    }

    let mut grids = Vec::new();
    let mut cy = start_year;
    let mut cm = start_month;
    for _ in 0..span_months {
        grids.push(render_cal_month_grid(cy, cm, monday_first, julian, true));
        cm += 1;
        if cm > 12 {
            cm = 1;
            cy += 1;
        }
    }
    let mut lines: Vec<String> = Vec::new();
    let mut r = 0usize;
    while r < grids.len() {
        let end_r = (r + per_row).min(grids.len());
        let slice = &grids[r..end_r];
        lines.push(format!(
            "{}  ",
            slice
                .iter()
                .map(|g| format!("{:<grid_w$}", g.header))
                .collect::<Vec<_>>()
                .join("  ")
        ));
        lines.push(format!(
            "{}  ",
            slice
                .iter()
                .map(|g| format!("{:<grid_w$}", g.day_header))
                .collect::<Vec<_>>()
                .join("  ")
        ));
        for w in 0..6 {
            lines.push(format!(
                "{}  ",
                slice
                    .iter()
                    .map(|g| g.weeks[w].as_str())
                    .collect::<Vec<_>>()
                    .join("  ")
            ));
        }
        if r + per_row < grids.len() {
            lines.push(String::new());
        }
        r += per_row;
    }
    let mut out = lines.join("\n");
    out.push('\n');
    ok_out(&out)
}

fn cmd_getconf(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut all_mode = false;
    let mut ended = false;
    let mut pos = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if !ended && a == "--" {
            ended = true;
            i += 1;
        } else if !ended && a == "--help" {
            return ok_out(
                "Usage: getconf [-v specification] variable_name [pathname]\n       getconf -a [pathname]\n\nQuery system configuration variables in the Sandbox VFS-ish/GNU environment.\n",
            );
        } else if !ended && a == "--version" {
            return ok_out("getconf (Sandbox VFS-ish/GNU libc) 2.39\n");
        } else if !ended && a == "-a" {
            all_mode = true;
            i += 1;
        } else if !ended && a == "-v" {
            if i + 1 >= args.len() {
                return err_out("getconf: option requires an argument -- 'v'\n", 1);
            }
            i += 2;
        } else if !ended && a.starts_with('-') {
            let ch = a.chars().nth(1).unwrap_or(' ');
            return err_out(&format!("getconf: invalid option -- '{ch}'\n"), 1);
        } else {
            pos.push(a.clone());
            i += 1;
        }
    }

    let table: &[(&str, &str)] = &[
        ("PATH", "/usr/local/bin:/usr/bin:/bin"),
        ("CS_PATH", "/usr/local/bin:/usr/bin:/bin"),
        ("ARG_MAX", "2097152"),
        ("_POSIX_ARG_MAX", "4096"),
        ("NAME_MAX", "255"),
        ("_POSIX_NAME_MAX", "14"),
        ("PATH_MAX", "4096"),
        ("_POSIX_PATH_MAX", "256"),
        ("PAGE_SIZE", "4096"),
        ("PAGESIZE", "4096"),
        ("NPROCESSORS_ONLN", "4"),
        ("_NPROCESSORS_ONLN", "4"),
        ("NPROCESSORS_CONF", "4"),
        ("_NPROCESSORS_CONF", "4"),
        ("CLK_TCK", "100"),
        ("OPEN_MAX", "1024"),
        ("_POSIX_OPEN_MAX", "20"),
        ("CHILD_MAX", "256"),
        ("_POSIX_CHILD_MAX", "25"),
        ("LINE_MAX", "2048"),
        ("_POSIX2_LINE_MAX", "2048"),
        ("PIPE_BUF", "4096"),
        ("_POSIX_PIPE_BUF", "512"),
        ("LINK_MAX", "65000"),
        ("_POSIX_LINK_MAX", "8"),
        ("MAX_CANON", "255"),
        ("_POSIX_MAX_CANON", "255"),
        ("MAX_INPUT", "255"),
        ("_POSIX_MAX_INPUT", "255"),
        ("FILESIZEBITS", "64"),
        ("SYMLINK_MAX", "4095"),
        ("SYMLOOP_MAX", "40"),
        ("_POSIX_SYMLOOP_MAX", "8"),
        ("HOST_NAME_MAX", "64"),
        ("_POSIX_HOST_NAME_MAX", "255"),
        ("LOGIN_NAME_MAX", "256"),
        ("_POSIX_LOGIN_NAME_MAX", "9"),
        ("NGROUPS_MAX", "65536"),
        ("_POSIX_NGROUPS_MAX", "8"),
        ("TZNAME_MAX", "6"),
        ("_POSIX_TZNAME_MAX", "6"),
        ("CHAR_BIT", "8"),
        ("WORD_BIT", "32"),
        ("LONG_BIT", "64"),
        ("INT_MAX", "2147483647"),
        ("INT_MIN", "-2147483648"),
        ("UINT_MAX", "4294967295"),
        ("LONG_MAX", "9223372036854775807"),
        ("ULONG_MAX", "18446744073709551615"),
        ("LLONG_MAX", "9223372036854775807"),
        ("ULLONG_MAX", "18446744073709551615"),
        ("SSIZE_MAX", "9223372036854775807"),
        ("POSIX_VERSION", "200809"),
        ("_POSIX_VERSION", "200809"),
        ("POSIX2_VERSION", "200809"),
        ("_POSIX2_VERSION", "200809"),
        ("XOPEN_VERSION", "700"),
        ("_XOPEN_VERSION", "700"),
        ("POSIX_V7_LP64_OFF64", "1"),
        ("POSIX_V6_LP64_OFF64", "1"),
        ("XBS5_LP64_OFF64", "1"),
        ("_POSIX_CHOWN_RESTRICTED", "1"),
        ("_POSIX_NO_TRUNC", "1"),
        ("_POSIX_VDISABLE", "0"),
        ("BC_BASE_MAX", "99"),
        ("BC_DIM_MAX", "2048"),
        ("BC_SCALE_MAX", "99"),
        ("BC_STRING_MAX", "1000"),
        ("COLL_WEIGHTS_MAX", "255"),
        ("EXPR_NEST_MAX", "32"),
        ("RE_DUP_MAX", "32767"),
        ("GNU_LIBC_VERSION", "glibc 2.39"),
        ("GNU_LIBPTHREAD_VERSION", "NPTL 2.39"),
        ("LFS_CFLAGS", "-D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64"),
        ("LFS_LDFLAGS", ""),
        ("LFS_LIBS", ""),
    ];

    if all_mode {
        if pos.len() > 1 {
            return err_out("getconf: too many arguments\n", 1);
        }
        if let Some(path_arg) = pos.first() {
            let p = resolve_posix_path(cwd, path_arg);
            if !fs.exists(&p) {
                return err_out(&format!("getconf: {path_arg}: No such file or directory\n"), 1);
            }
        }
        let mut out = String::new();
        for &(k, v) in table {
            out.push_str(&format!("{k:<31}{v}\n"));
        }
        return ok_out(&out);
    }

    if pos.is_empty() || pos.len() > 2 {
        return err_out(
            "Usage: getconf [-v specification] variable_name [pathname]\n       getconf -a [pathname]\n\nQuery system configuration variables in the Sandbox VFS-ish/GNU environment.\n",
            1,
        );
    }

    let var_name = pos[0].as_str();
    let normalized = var_name
        .strip_prefix("_CS_")
        .or_else(|| var_name.strip_prefix("_PC_"))
        .or_else(|| var_name.strip_prefix("_SC_"))
        .unwrap_or(var_name);
    let is_path_var = matches!(
        normalized,
        "FILESIZEBITS"
            | "LINK_MAX"
            | "MAX_CANON"
            | "MAX_INPUT"
            | "NAME_MAX"
            | "PATH_MAX"
            | "PIPE_BUF"
            | "POSIX_ALLOC_SIZE_MIN"
            | "POSIX_REC_INCR_XFER_SIZE"
            | "POSIX_REC_MAX_XFER_SIZE"
            | "POSIX_REC_MIN_XFER_SIZE"
            | "POSIX_REC_XFER_ALIGN"
            | "SYMLINK_MAX"
            | "_POSIX_CHOWN_RESTRICTED"
            | "_POSIX_NO_TRUNC"
            | "_POSIX_VDISABLE"
    );

    if pos.len() == 2 {
        if !is_path_var {
            return err_out(
                &format!("getconf: {var_name} does not accept a pathname\n"),
                1,
            );
        }
        let path_arg = &pos[1];
        let p = resolve_posix_path(cwd, path_arg);
        if !fs.exists(&p) {
            return err_out(
                &format!("getconf: {path_arg}: No such file or directory\n"),
                1,
            );
        }
    } else if is_path_var && !matches!(normalized, "NAME_MAX" | "PATH_MAX" | "PIPE_BUF") {
        return err_out(&format!("getconf: {var_name} requires a pathname\n"), 1);
    }

    let val = table
        .iter()
        .find(|&&(k, _)| k == var_name)
        .or_else(|| table.iter().find(|&&(k, _)| k == normalized))
        .map(|&(_, v)| v);

    let Some(v) = val else {
        return err_out(&format!("getconf: Unrecognized variable '{var_name}'\n"), 1);
    };
    ok_out(&format!("{v}\n"))
}

fn cmd_locale(args: &[String], env: &BTreeMap<String, String>) -> BuiltinOutcome {
    const SUPPORTED_LOCALES: &[&str] = &[
        "C",
        "C.utf8",
        "C.UTF-8",
        "POSIX",
        "en_US.utf8",
        "en_US.UTF-8",
        "UTF-8",
    ];
    const SUPPORTED_CHARMAPS: &[&str] = &["ANSI_X3.4-1968", "ASCII", "ISO-8859-1", "UTF-8"];
    const LC_CATEGORIES: &[&str] = &[
        "LC_CTYPE",
        "LC_NUMERIC",
        "LC_TIME",
        "LC_COLLATE",
        "LC_MONETARY",
        "LC_MESSAGES",
        "LC_PAPER",
        "LC_NAME",
        "LC_ADDRESS",
        "LC_TELEPHONE",
        "LC_MEASUREMENT",
        "LC_IDENTIFICATION",
    ];
    let default_locale = "C.UTF-8";

    let mut all_locales = false;
    let mut all_charmaps = false;
    let mut show_cat = false;
    let mut show_kw = false;
    let mut verbose = false;
    let mut ended = false;
    let mut operands: Vec<String> = Vec::new();

    for a in args {
        if ended {
            operands.push(a.clone());
            continue;
        }
        if a == "--" {
            ended = true;
            continue;
        }
        if a == "--help" || a == "-?" {
            return ok_out("Usage: locale [OPTION...] [NAME...]\nGet locale-specific information for the Sandbox VFS-ish/GNU environment.\n\n System information:\n  -a, --all-locales          Write names of available locales\n  -m, --charmaps             Write names of available charmaps\n\n Modify output format:\n  -c, --category-name        Write names of selected categories\n  -k, --keyword-name         Write names of selected keywords\n  -v, --verbose              Print more information\n  -?, --help                 Give this help list\n  -V, --version              Print program version\n");
        }
        if a == "--version" || a == "-V" {
            return ok_out("locale (Sandbox VFS-ish/GNU libc) 2.39\n");
        }
        if a.starts_with("--") && a.len() > 2 {
            match a.as_str() {
                "--all-locales" => all_locales = true,
                "--charmaps" => all_charmaps = true,
                "--category-name" => show_cat = true,
                "--keyword-name" => show_kw = true,
                "--verbose" => verbose = true,
                _ => return err_out(&format!("locale: unrecognized option '{a}'\n"), 1),
            }
            continue;
        }
        if a.starts_with('-') && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    'a' => all_locales = true,
                    'm' => all_charmaps = true,
                    'c' => show_cat = true,
                    'k' => show_kw = true,
                    'v' => verbose = true,
                    _ => return err_out(&format!("locale: invalid option -- '{ch}'\n"), 1),
                }
            }
            continue;
        }
        operands.push(a.clone());
    }

    let is_utf8 = |loc: &str| {
        let up = loc.to_ascii_uppercase();
        up.contains("UTF-8") || up.contains("UTF8")
    };

    if all_locales {
        if verbose {
            let blocks: Vec<String> = SUPPORTED_LOCALES
                .iter()
                .map(|&loc| {
                    let cs = if is_utf8(loc) {
                        "UTF-8"
                    } else {
                        "ANSI_X3.4-1968"
                    };
                    format!(
                        "locale: {loc:<15} archive: /usr/lib/locale/locale-archive\n-------------------------------------------------------------------------------\n    title | {loc} locale for Sandbox VFS-ish/GNU\n  codeset | {cs}\n"
                    )
                })
                .collect();
            return ok_out(&blocks.join("\n"));
        }
        return ok_out(&format!("{}\n", SUPPORTED_LOCALES.join("\n")));
    }
    if all_charmaps {
        return ok_out(&format!("{}\n", SUPPORTED_CHARMAPS.join("\n")));
    }

    let effective_for_cat = |cat: &str| -> (String, bool) {
        if let Some(lc_all) = env.get("LC_ALL").filter(|s| !s.is_empty()) {
            return (lc_all.clone(), true);
        }
        if let Some(explicit) = env.get(cat).filter(|s| !s.is_empty()) {
            return (explicit.clone(), false);
        }
        if let Some(lang) = env.get("LANG").filter(|s| !s.is_empty()) {
            return (lang.clone(), true);
        }
        (default_locale.to_string(), true)
    };

    if operands.is_empty() {
        let lang = env
            .get("LANG")
            .map(|s| s.as_str())
            .unwrap_or(default_locale);
        let mut out = format!("LANG={lang}\n");
        for &cat in LC_CATEGORIES {
            let (val, implied) = effective_for_cat(cat);
            if implied {
                out.push_str(&format!("{cat}=\"{val}\"\n"));
            } else {
                out.push_str(&format!("{cat}={val}\n"));
            }
        }
        let lc_all_val = env.get("LC_ALL").map(|s| s.as_str()).unwrap_or("");
        out.push_str(&format!("LC_ALL={lc_all_val}\n"));
        return ok_out(&out);
    }

    let (ctype_loc, _) = effective_for_cat("LC_CTYPE");
    let utf8 = is_utf8(&ctype_loc);
    let cmap = if utf8 { "UTF-8" } else { "ANSI_X3.4-1968" };
    let mb_max = if utf8 { "6" } else { "1" };
    let kw_db: &[(&str, &str, &str, bool)] = &[
        ("charmap", "LC_CTYPE", cmap, true),
        ("codeset", "LC_CTYPE", cmap, true),
        ("mb_cur_max", "LC_CTYPE", mb_max, false),
        ("decimal_point", "LC_NUMERIC", ".", true),
        ("thousands_sep", "LC_NUMERIC", "", true),
        ("grouping", "LC_NUMERIC", "-1", false),
        ("yesexpr", "LC_MESSAGES", "^[yY]", true),
        ("noexpr", "LC_MESSAGES", "^[nN]", true),
        ("yesstr", "LC_MESSAGES", "yes", true),
        ("nostr", "LC_MESSAGES", "no", true),
        ("abday", "LC_TIME", "Sun;Mon;Tue;Wed;Thu;Fri;Sat", true),
        (
            "day",
            "LC_TIME",
            "Sunday;Monday;Tuesday;Wednesday;Thursday;Friday;Saturday",
            true,
        ),
        (
            "abmon",
            "LC_TIME",
            "Jan;Feb;Mar;Apr;May;Jun;Jul;Aug;Sep;Oct;Nov;Dec",
            true,
        ),
        (
            "mon",
            "LC_TIME",
            "January;February;March;April;May;June;July;August;September;October;November;December",
            true,
        ),
        ("d_t_fmt", "LC_TIME", "%a %b %e %H:%M:%S %Y", true),
        ("d_fmt", "LC_TIME", "%m/%d/%y", true),
        ("t_fmt", "LC_TIME", "%H:%M:%S", true),
        ("am_pm", "LC_TIME", "AM;PM", true),
        ("t_fmt_ampm", "LC_TIME", "%I:%M:%S %p", true),
        ("int_curr_symbol", "LC_MONETARY", "", true),
        ("currency_symbol", "LC_MONETARY", "", true),
    ];

    let mut out_lines = Vec::new();
    let mut err_buf = String::new();
    let mut exit_code = 0;

    for name in operands {
        if LC_CATEGORIES.contains(&name.as_str()) {
            if show_cat {
                out_lines.push(name.clone());
            }
            let cat_kws: Vec<_> = kw_db
                .iter()
                .filter(|&&(_, cat, _, _)| cat == name)
                .collect();
            if cat_kws.is_empty() {
                let (eff, _) = effective_for_cat(&name);
                if show_kw {
                    out_lines.push(format!("name=\"{eff}\""));
                } else {
                    out_lines.push(eff);
                }
            } else {
                for &&(kw, _, val, quoted) in &cat_kws {
                    if show_kw {
                        if quoted {
                            out_lines.push(format!("{kw}=\"{val}\""));
                        } else {
                            out_lines.push(format!("{kw}={val}"));
                        }
                    } else {
                        out_lines.push(val.to_string());
                    }
                }
            }
            continue;
        }
        let Some(&(kw, cat, val, quoted)) = kw_db.iter().find(|&&(k, _, _, _)| k == name) else {
            err_buf.push_str(&format!(
                "locale: Cannot set LC_ALL to default locale: Unknown keyword '{name}'\n"
            ));
            exit_code = 1;
            continue;
        };
        if show_cat {
            out_lines.push(cat.to_string());
        }
        if show_kw {
            if quoted {
                out_lines.push(format!("{kw}=\"{val}\""));
            } else {
                out_lines.push(format!("{kw}={val}"));
            }
        } else {
            out_lines.push(val.to_string());
        }
    }

    let stdout = if out_lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", out_lines.join("\n"))
    };
    BuiltinOutcome {
        stdout,
        stderr: err_buf,
        exit_code,
    }
}

fn cmd_pathchk(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut posix_portable = false;
    let mut extra_portability = false;
    let mut ended = false;
    let mut paths = Vec::new();
    for a in args {
        if ended {
            paths.push(a.as_str());
        } else if a == "--" {
            ended = true;
        } else if a == "--help" {
            return ok_out("Usage: pathchk [OPTION]... NAME...\nDiagnose invalid or unportable file names.\n\n  -p                  check for most POSIX systems\n  -P                  check for empty names and leading \"-\"\n      --portability   check for all POSIX systems (equivalent to -p -P)\n      --help          display this help and exit\n      --version       output version information and exit\n");
        } else if a == "--version" {
            return ok_out("pathchk (Sandbox VFS-ish/GNU coreutils) 9.7\n");
        } else if a == "-p" {
            posix_portable = true;
        } else if a == "-P" {
            extra_portability = true;
        } else if a == "-pP" || a == "-Pp" || a == "--portability" {
            posix_portable = true;
            extra_portability = true;
        } else if a.starts_with("--") && a.len() > 2 {
            return err_out(&format!("pathchk: unrecognized option '{a}'\n"), 1);
        } else if a.starts_with('-') && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    'p' => posix_portable = true,
                    'P' => extra_portability = true,
                    _ => return err_out(&format!("pathchk: invalid option -- '{ch}'\n"), 1),
                }
            }
        } else {
            paths.push(a.as_str());
        }
    }
    if paths.is_empty() {
        return err_out("pathchk: missing operand\n", 1);
    }
    let path_max = if posix_portable { 256usize } else { 4096usize };
    let name_max = if posix_portable { 14usize } else { 255usize };
    let mut err_buf = String::new();
    let mut code = 0;
    for p in paths {
        if p.is_empty() {
            if extra_portability {
                err_buf.push_str("pathchk: empty file name\n");
            } else {
                err_buf.push_str("pathchk: '': No such file or directory\n");
            }
            code = 1;
            continue;
        }
        if p.len() >= path_max {
            err_buf.push_str(&format!(
                "pathchk: limit {path_max} exceeded by length {} of file name '{p}'\n",
                p.len()
            ));
            code = 1;
            continue;
        }
        let mut comp_failed = false;
        for comp in p.split('/').filter(|c| !c.is_empty()) {
            if extra_portability && comp.starts_with('-') {
                err_buf.push_str(&format!(
                    "pathchk: leading '-' in a component of file name '{p}'\n"
                ));
                comp_failed = true;
                break;
            }
            if posix_portable
                && let Some(bad_ch) = comp
                    .chars()
                    .find(|c| !c.is_ascii_alphanumeric() && !matches!(c, '.' | '_' | '-'))
            {
                err_buf.push_str(&format!(
                    "pathchk: nonportable character '{bad_ch}' in file name '{p}'\n"
                ));
                comp_failed = true;
                break;
            }
            if comp.len() > name_max {
                err_buf.push_str(&format!(
                    "pathchk: limit {name_max} exceeded by length {} of file name component '{comp}'\n",
                    comp.len()
                ));
                comp_failed = true;
                break;
            }
        }
        if comp_failed {
            code = 1;
            continue;
        }
        if !posix_portable {
            let resolved = resolve_posix_path(cwd, p);
            let segs: Vec<&str> = resolved.split('/').filter(|s| !s.is_empty()).collect();
            let mut accum = String::new();
            for seg in segs.iter().take(segs.len().saturating_sub(1)) {
                accum.push('/');
                accum.push_str(seg);
                if fs.exists(&accum) && !fs.is_dir(&accum) {
                    err_buf.push_str(&format!("pathchk: '{p}': Not a directory\n"));
                    code = 1;
                    break;
                }
            }
        }
    }
    BuiltinOutcome {
        stdout: String::new(),
        stderr: err_buf,
        exit_code: code,
    }
}

fn resolve_effective_hostname(env: &BTreeMap<String, String>, fs: &dyn SafeBashFs) -> String {
    if let Some(h) = env.get("HOSTNAME").filter(|s| !s.is_empty()) {
        return h.clone();
    }
    if let Ok(bytes) = fs.read_file("/etc/hostname") {
        let s = String::from_utf8_lossy(&bytes).trim().to_string();
        if !s.is_empty() {
            return s;
        }
    }
    "sandbox".to_string()
}

fn cmd_whoami(
    args: &[String],
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut end_of_options = false;
    for arg in args {
        if !end_of_options && arg == "--" {
            end_of_options = true;
            continue;
        }
        if !end_of_options && arg == "--help" {
            return ok_out("Usage: whoami [OPTION]...\nPrint the user name associated with the current effective user ID\nin the Sandbox VFS-ish/GNU environment.\nSame as id -un.\n\n      --help        display this help and exit\n      --version     output version information and exit\n");
        }
        if !end_of_options && arg == "--version" {
            return ok_out("whoami (Sandbox VFS-ish/GNU coreutils) 9.7\nPackaged by Safe-Bash (Sandbox VFS-ish/GNU runtime)\n");
        }
        if !end_of_options && arg.starts_with('-') {
            if arg.starts_with("--") {
                return err_out(&format!("whoami: unrecognized option '{arg}'\n"), 1);
            } else {
                let ch = arg.chars().nth(1).unwrap_or_default();
                return err_out(&format!("whoami: invalid option -- '{ch}'\n"), 1);
            }
        }
        return err_out(&format!("whoami: extra operand '{arg}'\n"), 1);
    }

    let raw_euid = env.get("EUID").or_else(|| env.get("UID"));
    let euid = raw_euid.and_then(|s| {
        if !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()) {
            s.parse::<u32>().ok()
        } else {
            None
        }
    });
    let mut username: Option<String> = None;
    if let Some(uid_num) = euid {
        if let Ok(bytes) = fs.read_file("/etc/passwd") {
            let text = String::from_utf8_lossy(&bytes);
            for line in text.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                let parts: Vec<&str> = trimmed.split(':').collect();
                if parts.len() >= 3 && parts[2].parse::<u32>().ok() == Some(uid_num) {
                    username = Some(parts[0].to_string());
                    break;
                }
            }
        }
        if username.is_none() {
            username = match uid_num {
                0 => Some("root".to_string()),
                65534 => Some("nobody".to_string()),
                1 => Some("daemon".to_string()),
                _ => None,
            };
        }
    }
    let resolved = username
        .or_else(|| env.get("WHOAMI").cloned())
        .or_else(|| env.get("USER").cloned())
        .or_else(|| env.get("LOGNAME").cloned())
        .unwrap_or_else(|| "sandbox".to_string());
    ok_out(&format!("{resolved}\n"))
}

fn read_hostname_file_line(cwd: &str, file_path: &str, fs: &dyn SafeBashFs) -> Result<String, ()> {
    let resolved = resolve_posix_path(cwd, file_path);
    let bytes = fs.read_file(&resolved).map_err(|_| ())?;
    let text = String::from_utf8_lossy(&bytes);
    for line in text.lines() {
        let stripped = line.split('#').next().unwrap_or("").trim();
        if !stripped.is_empty() {
            return Ok(stripped.to_string());
        }
    }
    Ok(String::new())
}

fn cmd_hostname(
    args: &[String],
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut mode = "default";
    let mut file_source: Option<String> = None;
    let mut operands: Vec<String> = Vec::new();
    let mut end_of_options = false;
    let mut i = 0usize;
    while i < args.len() {
        let arg = &args[i];
        if !end_of_options && arg == "--" {
            end_of_options = true;
            i += 1;
            continue;
        }
        if !end_of_options && (arg == "--help" || arg == "-h" || arg == "-?") {
            return ok_out("Usage: hostname [OPTION...] [NAME]\nShow or set the system's host name in the Sandbox VFS-ish/GNU environment.\n\n  -a, --alias             alias names\n  -A, --all-fqdns         all long host names (FQDNs)\n  -d, --domain            DNS domain name\n  -f, --fqdn, --long      long host name (FQDN)\n  -F, --file=FILE         read host name or NIS domain name from FILE\n  -i, --ip-address        addresses for the host name\n  -I, --all-ip-addresses  all addresses for the host\n  -s, --short             short host name\n  -y, --yp, --nis         NIS/YP domain name\n      --help              give this help list\n      --version           print program version\n");
        }
        if !end_of_options && (arg == "--version" || arg == "-V") {
            return ok_out("hostname (Sandbox VFS-ish/GNU inetutils) 2.5\nPackaged by Safe-Bash (Sandbox VFS-ish/GNU runtime)\n");
        }
        if !end_of_options && let Some(v) = arg.strip_prefix("--file=") {
            file_source = Some(v.to_string());
            i += 1;
            continue;
        }
        if !end_of_options && (arg == "--file" || arg == "-F") {
            if i + 1 >= args.len() {
                return err_out(&format!("hostname: option '{arg}' requires an argument\n"), 1);
            }
            i += 1;
            file_source = Some(args[i].clone());
            i += 1;
            continue;
        }
        if !end_of_options && arg.starts_with("--") && arg.len() > 2 {
            match arg.as_str() {
                "--short" => mode = "short",
                "--fqdn" | "--long" => mode = "fqdn",
                "--all-fqdns" => mode = "all-fqdns",
                "--domain" => mode = "domain",
                "--ip-address" => mode = "ip",
                "--all-ip-addresses" => mode = "all-ips",
                "--alias" => mode = "alias",
                "--yp" | "--nis" => mode = "nis",
                _ => return err_out(&format!("hostname: unrecognized option '{arg}'\n"), 1),
            }
            i += 1;
            continue;
        }
        if !end_of_options && arg.starts_with('-') && arg.len() > 1 {
            let chars: Vec<char> = arg[1..].chars().collect();
            let mut j = 0usize;
            while j < chars.len() {
                let ch = chars[j];
                match ch {
                    's' => mode = "short",
                    'f' => mode = "fqdn",
                    'A' => mode = "all-fqdns",
                    'd' => mode = "domain",
                    'i' => mode = "ip",
                    'I' => mode = "all-ips",
                    'a' => mode = "alias",
                    'y' => mode = "nis",
                    'F' => {
                        let rest: String = chars[j + 1..].iter().collect();
                        if !rest.is_empty() {
                            file_source = Some(rest);
                        } else if i + 1 < args.len() {
                            i += 1;
                            file_source = Some(args[i].clone());
                        } else {
                            return err_out("hostname: option requires an argument -- 'F'\n", 1);
                        }
                        break;
                    }
                    _ => return err_out(&format!("hostname: invalid option -- '{ch}'\n"), 1),
                }
                j += 1;
            }
            i += 1;
            continue;
        }
        operands.push(arg.clone());
        i += 1;
    }

    if operands.len() > 1 || (file_source.is_some() && !operands.is_empty()) {
        return err_out("hostname: too many arguments\n", 1);
    }

    if file_source.is_some() || operands.len() == 1 {
        let mut new_host = operands.first().cloned().unwrap_or_default();
        if let Some(ref src_path) = file_source {
            let Ok(h) = read_hostname_file_line(cwd, src_path, fs) else {
                return err_out(&format!("hostname: cannot open file '{src_path}'\n"), 1);
            };
            new_host = h;
        }
        let is_root = env.get("EUID").map(|s| s.as_str()) == Some("0")
            || env.get("UID").map(|s| s.as_str()) == Some("0")
            || env.get("USER").map(|s| s.as_str()) == Some("root");
        if !is_root {
            return err_out("hostname: you must be root to change the host name\n", 1);
        }
        let _ = fs.mkdir_all("/etc");
        let _ = fs.write_file("/etc/hostname", format!("{new_host}\n").as_bytes());
        return ok_out("");
    }

    let vfs_host = read_hostname_file_line(cwd, "/etc/hostname", fs).unwrap_or_default();
    let raw_host = if !vfs_host.is_empty() {
        vfs_host
    } else if let Some(h) = env.get("HOSTNAME").filter(|s| !s.is_empty()) {
        h.clone()
    } else {
        "sandbox".to_string()
    };

    let (short_name, domain_name, fqdn) = if let Some((s, d)) = raw_host.split_once('.') {
        (s.to_string(), d.to_string(), raw_host.clone())
    } else {
        (
            raw_host.clone(),
            "vfs.local".to_string(),
            format!("{raw_host}.vfs.local"),
        )
    };
    let ip = "127.0.0.1";

    match mode {
        "short" => ok_out(&format!("{short_name}\n")),
        "fqdn" => ok_out(&format!("{fqdn}\n")),
        "all-fqdns" => ok_out(&format!("{fqdn} \n")),
        "domain" => ok_out(&format!("{domain_name}\n")),
        "ip" => ok_out(&format!("{ip}\n")),
        "all-ips" => ok_out(&format!("{ip} \n")),
        "alias" => ok_out(&format!("{short_name}\n")),
        "nis" => ok_out("(none)\n"),
        _ => ok_out(&format!("{raw_host}\n")),
    }
}

fn cmd_nproc(args: &[String], env: &BTreeMap<String, String>) -> BuiltinOutcome {
    let mut all_mode = false;
    let mut ignore_n = 0usize;
    let mut ended = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if !ended && a == "--" {
            ended = true;
            i += 1;
        } else if !ended && a == "--help" {
            return ok_out("Usage: nproc [OPTION]...\nPrint the number of processing units available to the current process,\nwhich may be less than the number of online processors (Sandbox VFS-ish/GNU).\n\n      --all      print the number of installed processors\n      --ignore=N  if possible, exclude N processing units\n      --help     display this help and exit\n      --version  output version information and exit\n");
        } else if !ended && a == "--version" {
            return ok_out("nproc (Sandbox VFS-ish/GNU coreutils) 9.7\nPackaged by Safe-Bash (Sandbox VFS-ish/GNU runtime)\n");
        } else if !ended && a == "--all" {
            all_mode = true;
            i += 1;
        } else if !ended && (a == "--ignore" || a.starts_with("--ignore=")) {
            let val_str = if a == "--ignore" {
                if i + 1 >= args.len() {
                    return err_out("nproc: option '--ignore' requires an argument\n", 1);
                }
                i += 1;
                args[i].as_str()
            } else {
                &a["--ignore=".len()..]
            };
            let trimmed = val_str.trim();
            let digits = trimmed.strip_prefix('+').unwrap_or(trimmed);
            if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
                return err_out(&format!("nproc: invalid number: '{val_str}'\n"), 1);
            }
            let Ok(parsed) = digits.parse::<usize>() else {
                return err_out(&format!("nproc: invalid number: '{val_str}'\n"), 1);
            };
            ignore_n = parsed;
            i += 1;
        } else if !ended && a.starts_with('-') {
            return err_out(&format!("nproc: unrecognized option '{a}'\n"), 1);
        } else {
            return err_out(&format!("nproc: extra operand '{a}'\n"), 1);
        }
    }
    let parse_omp_pos = |raw: &str| -> Option<usize> {
        let first = raw.split(',').next()?.trim();
        let digits = first.strip_prefix('+').unwrap_or(first);
        if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        digits.parse::<usize>().ok().filter(|&n| n >= 1)
    };
    let base = env
        .get("NPROC")
        .and_then(|s| parse_omp_pos(s))
        .unwrap_or(4);
    let mut cpus = if all_mode {
        base
    } else {
        let mut c = env
            .get("OMP_NUM_THREADS")
            .and_then(|s| parse_omp_pos(s))
            .unwrap_or(base);
        if let Some(lim) = env.get("OMP_THREAD_LIMIT").and_then(|s| parse_omp_pos(s)) {
            c = c.min(lim);
        }
        c
    };
    cpus = cpus.saturating_sub(ignore_n).max(1);
    ok_out(&format!("{cpus}\n"))
}

fn cmd_uname(args: &[String], env: &BTreeMap<String, String>, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut show_s = false;
    let mut show_n = false;
    let mut show_r = false;
    let mut show_v = false;
    let mut show_m = false;
    let mut show_p = false;
    let mut show_i = false;
    let mut show_o = false;
    let mut show_all = false;
    let mut ended = false;
    for a in args {
        if !ended && a == "--" {
            ended = true;
            continue;
        }
        if !ended && a == "--help" {
            return ok_out("Usage: uname [OPTION]...\nPrint certain system information.  With no OPTION, same as -s.\nReports the Sandbox VFS-ish/GNU virtual platform identity.\n\n  -a, --all                print all information, in the following order,\n                             except omit -p and -i if unknown:\n  -s, --kernel-name        print the kernel name\n  -n, --nodename           print the network node hostname\n  -r, --kernel-release     print the kernel release\n  -v, --kernel-version     print the kernel version\n  -m, --machine            print the machine hardware name\n  -p, --processor          print the processor type (non-portable)\n  -i, --hardware-platform  print the hardware platform (non-portable)\n  -o, --operating-system   print the operating system\n      --help               display this help and exit\n      --version            output version information and exit\n");
        }
        if !ended && a == "--version" {
            return ok_out("uname (Sandbox VFS-ish/GNU coreutils) 9.7\nPackaged by Safe-Bash (Sandbox VFS-ish/GNU runtime)\n");
        }
        if !ended && a.starts_with("--") && a.len() > 2 {
            match a.as_str() {
                "--all" => show_all = true,
                "--kernel-name" | "--sysname" => show_s = true,
                "--nodename" => show_n = true,
                "--kernel-release" | "--release" => show_r = true,
                "--kernel-version" => show_v = true,
                "--machine" => show_m = true,
                "--processor" => show_p = true,
                "--hardware-platform" => show_i = true,
                "--operating-system" => show_o = true,
                _ => return err_out(&format!("uname: unrecognized option '{a}'\n"), 1),
            }
            continue;
        }
        if !ended && a.starts_with('-') && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    'a' => show_all = true,
                    's' => show_s = true,
                    'n' => show_n = true,
                    'r' => show_r = true,
                    'v' => show_v = true,
                    'm' => show_m = true,
                    'p' => show_p = true,
                    'i' => show_i = true,
                    'o' => show_o = true,
                    _ => return err_out(&format!("uname: invalid option -- '{ch}'\n"), 1),
                }
            }
            continue;
        }
        return err_out(&format!("uname: extra operand '{a}'\n"), 1);
    }
    let sysname = env.get("UNAME_S").map(|s| s.as_str()).unwrap_or("Linux");
    let nodename = env
        .get("UNAME_N")
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| resolve_effective_hostname(env, fs));
    let release = env
        .get("UNAME_R")
        .map(|s| s.as_str())
        .unwrap_or("6.6.0-sandbox-vfs");
    let version = env
        .get("UNAME_V")
        .map(|s| s.as_str())
        .unwrap_or("#1 SMP Sandbox VFS-ish/GNU");
    let machine = env.get("UNAME_M").map(|s| s.as_str()).unwrap_or("x86_64");
    let processor = env.get("UNAME_P").map(|s| s.as_str()).unwrap_or("unknown");
    let hw_platform = env.get("UNAME_I").map(|s| s.as_str()).unwrap_or("unknown");
    let os = env
        .get("UNAME_O")
        .map(|s| s.as_str())
        .unwrap_or("GNU/Linux");

    if !(show_all || show_s || show_n || show_r || show_v || show_m || show_p || show_i || show_o) {
        show_s = true;
    }
    let mut parts = Vec::new();
    if show_all || show_s {
        parts.push(sysname);
    }
    if show_all || show_n {
        parts.push(&nodename);
    }
    if show_all || show_r {
        parts.push(release);
    }
    if show_all || show_v {
        parts.push(version);
    }
    if show_all || show_m {
        parts.push(machine);
    }
    if show_p || (show_all && processor != "unknown") {
        parts.push(processor);
    }
    if show_i || (show_all && hw_platform != "unknown") {
        parts.push(hw_platform);
    }
    if show_all || show_o {
        parts.push(os);
    }
    ok_out(&format!("{}\n", parts.join(" ")))
}

fn cmd_id(args: &[String], env: &BTreeMap<String, String>, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    #[derive(Clone)]
    struct IdAccount {
        uid: u32,
        euid: u32,
        gid: u32,
        egid: u32,
        user: String,
        euser: String,
        group: String,
        egroup: String,
        groups: Vec<(u32, String)>,
        context: String,
    }

    let mut opt_u = false;
    let mut opt_g = false;
    let mut opt_groups = false;
    let mut opt_context = false;
    let mut opt_n = false;
    let mut opt_r = false;
    let mut opt_z = false;
    let mut ended = false;
    let mut operands: Vec<String> = Vec::new();

    for a in args {
        if ended {
            operands.push(a.clone());
            continue;
        }
        if a == "--" {
            ended = true;
            continue;
        }
        if a == "--help" {
            return ok_out("Usage: id [OPTION]... [USER]...\nPrint user and group information for each specified USER,\nor (when USER omitted) for the current process in the Sandbox VFS-ish/GNU environment.\n\n  -a             ignore, for compatibility with other versions\n  -Z, --context  print only the security context of the process\n  -g, --group    print only the effective group ID\n  -G, --groups   print all group IDs\n  -n, --name     print a name instead of a number, for -ugG\n  -r, --real     print the real ID instead of the effective ID, with -ugG\n  -u, --user     print only the effective user ID\n  -z, --zero     delimit entries with NUL characters, not whitespace;\n                   not permitted in default format\n      --help     display this help and exit\n      --version  output version information and exit\n\nWithout any OPTION, print some useful set of identified information (Sandbox VFS-ish/GNU).\n");
        }
        if a == "--version" {
            return ok_out("id (Sandbox VFS-ish/GNU coreutils) 9.7\nPackaged by Safe-Bash (Sandbox VFS-ish/GNU runtime)\n");
        }
        if a.starts_with("--") && a.len() > 2 {
            match a.as_str() {
                "--user" => opt_u = true,
                "--group" => opt_g = true,
                "--groups" => opt_groups = true,
                "--context" => opt_context = true,
                "--name" => opt_n = true,
                "--real" => opt_r = true,
                "--zero" => opt_z = true,
                _ => return err_out(&format!("id: unrecognized option '{a}'\n"), 1),
            }
            continue;
        }
        if a.starts_with('-') && a.len() > 1 {
            for ch in a[1..].chars() {
                match ch {
                    'u' => opt_u = true,
                    'g' => opt_g = true,
                    'G' => opt_groups = true,
                    'Z' => opt_context = true,
                    'n' => opt_n = true,
                    'r' => opt_r = true,
                    'z' => opt_z = true,
                    _ => return err_out(&format!("id: invalid option -- '{ch}'\n"), 1),
                }
            }
            continue;
        }
        operands.push(a.clone());
    }

    let choice_count = (opt_u as u8) + (opt_g as u8) + (opt_groups as u8) + (opt_context as u8);
    if choice_count > 1 {
        return err_out("id: cannot print \"only\" of more than one choice\n", 1);
    }
    if (choice_count == 0 || opt_context) && (opt_n || opt_r) {
        return err_out(
            "id: cannot print only names or real IDs in default format\n",
            1,
        );
    }
    if choice_count == 0 && opt_z {
        return err_out("id: option --zero not permitted in default format\n", 1);
    }
    if opt_context && !operands.is_empty() {
        return err_out("id: cannot print security context when user specified\n", 1);
    }

    let parse_u32 = |s: &str| -> Option<u32> {
        if !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()) {
            s.parse::<u32>().ok()
        } else {
            None
        }
    };

    let sec_context = env
        .get("SELINUX_CONTEXT")
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| "sandbox_u:sandbox_r:sandbox_t:s0".to_string());

    let mut vfs_accounts: Vec<IdAccount> = Vec::new();
    let mut group_by_gid: Vec<(u32, String, Vec<String>)> = Vec::new();
    if let Ok(gr_bytes) = fs.read_file("/etc/group") {
        for line in String::from_utf8_lossy(&gr_bytes).lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let cols: Vec<&str> = trimmed.split(':').collect();
            if cols.len() < 3 {
                continue;
            }
            let Some(gid) = parse_u32(cols[2]) else {
                continue;
            };
            let members: Vec<String> = cols
                .get(3)
                .copied()
                .unwrap_or("")
                .split(',')
                .map(|m| m.trim().to_string())
                .filter(|m| !m.is_empty())
                .collect();
            group_by_gid.push((gid, cols[0].to_string(), members));
        }
    }
    if let Ok(pw_bytes) = fs.read_file("/etc/passwd") {
        for line in String::from_utf8_lossy(&pw_bytes).lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let cols: Vec<&str> = trimmed.split(':').collect();
            if cols.len() < 4 {
                continue;
            }
            let user = cols[0].to_string();
            let (Some(uid), Some(gid)) = (parse_u32(cols[2]), parse_u32(cols[3])) else {
                continue;
            };
            let primary_group = group_by_gid
                .iter()
                .find(|(g, _, _)| *g == gid)
                .map(|(_, name, _)| name.clone())
                .unwrap_or_else(|| user.clone());
            let mut groups = vec![(gid, primary_group.clone())];
            for (other_gid, gname, members) in &group_by_gid {
                if *other_gid != gid && members.iter().any(|m| m == &user) {
                    groups.push((*other_gid, gname.clone()));
                }
            }
            vfs_accounts.push(IdAccount {
                uid,
                euid: uid,
                gid,
                egid: gid,
                user: user.clone(),
                euser: user,
                group: primary_group.clone(),
                egroup: primary_group,
                groups,
                context: sec_context.clone(),
            });
        }
    }

    let uid = env.get("UID").and_then(|s| parse_u32(s)).unwrap_or(1000);
    let euid = env.get("EUID").and_then(|s| parse_u32(s)).unwrap_or(uid);
    let gid = env
        .get("GID")
        .and_then(|s| parse_u32(s))
        .unwrap_or(if uid == 0 { 0 } else { 1000 });
    let egid = env
        .get("EGID")
        .and_then(|s| parse_u32(s))
        .unwrap_or(if euid == 0 { 0 } else { gid });

    let default_user = if uid == 0 {
        "root".to_string()
    } else {
        env.get("USER")
            .or_else(|| env.get("LOGNAME"))
            .filter(|s| !s.is_empty())
            .cloned()
            .unwrap_or_else(|| "sandbox".to_string())
    };
    let default_euser = if euid == 0 {
        "root".to_string()
    } else if euid == uid {
        default_user.clone()
    } else {
        "sandbox".to_string()
    };
    let default_group = if gid == 0 {
        "root".to_string()
    } else {
        env.get("GROUP")
            .filter(|s| !s.is_empty())
            .cloned()
            .unwrap_or_else(|| {
                if default_user == "root" {
                    "root".to_string()
                } else {
                    "sandbox".to_string()
                }
            })
    };
    let default_egroup = if egid == 0 {
        "root".to_string()
    } else if egid == gid {
        default_group.clone()
    } else {
        "sandbox".to_string()
    };
    let mut cur_groups = vec![(egid, default_egroup.clone())];
    if egid != gid {
        cur_groups.push((gid, default_group.clone()));
    }
    let current = IdAccount {
        uid,
        euid,
        gid,
        egid,
        user: default_user,
        euser: default_euser,
        group: default_group,
        egroup: default_egroup,
        groups: cur_groups,
        context: sec_context.clone(),
    };

    let mut all_accounts = vfs_accounts.clone();
    all_accounts.push(current.clone());
    all_accounts.push(IdAccount {
        uid: 1000,
        euid: 1000,
        gid: 1000,
        egid: 1000,
        user: "sandbox".to_string(),
        euser: "sandbox".to_string(),
        group: "sandbox".to_string(),
        egroup: "sandbox".to_string(),
        groups: vec![(1000, "sandbox".to_string())],
        context: sec_context.clone(),
    });
    all_accounts.push(IdAccount {
        uid: 0,
        euid: 0,
        gid: 0,
        egid: 0,
        user: "root".to_string(),
        euser: "root".to_string(),
        group: "root".to_string(),
        egroup: "root".to_string(),
        groups: vec![(0, "root".to_string())],
        context: "system_u:system_r:kernel_t:s0".to_string(),
    });
    all_accounts.push(IdAccount {
        uid: 65534,
        euid: 65534,
        gid: 65534,
        egid: 65534,
        user: "nobody".to_string(),
        euser: "nobody".to_string(),
        group: "nogroup".to_string(),
        egroup: "nogroup".to_string(),
        groups: vec![(65534, "nogroup".to_string())],
        context: sec_context.clone(),
    });
    all_accounts.push(IdAccount {
        uid: 1,
        euid: 1,
        gid: 1,
        egid: 1,
        user: "daemon".to_string(),
        euser: "daemon".to_string(),
        group: "daemon".to_string(),
        egroup: "daemon".to_string(),
        groups: vec![(1, "daemon".to_string())],
        context: sec_context,
    });

    let mut targets: Vec<IdAccount> = Vec::new();
    let mut err_buf = String::new();
    let mut exit_code = 0;

    if operands.is_empty() {
        if let Some(vfs_cur) = vfs_accounts
            .iter()
            .find(|a| a.uid == current.uid || a.user == current.user)
        {
            targets.push(vfs_cur.clone());
        } else {
            targets.push(current);
        }
    } else {
        for spec in &operands {
            let num = parse_u32(spec);
            if let Some(found) = all_accounts
                .iter()
                .find(|a| &a.user == spec || (num.is_some() && Some(a.uid) == num))
            {
                targets.push(found.clone());
            } else {
                err_buf.push_str(&format!("id: '{spec}': no such user\n"));
                exit_code = 1;
            }
        }
    }

    let term = if opt_z { "\0" } else { "\n" };
    let group_sep = if opt_z { "\0" } else { " " };
    let mut out = String::new();

    for acct in targets {
        if opt_context {
            out.push_str(&format!("{}{term}", acct.context));
        } else if opt_u {
            let val = if opt_r {
                if opt_n {
                    acct.user
                } else {
                    acct.uid.to_string()
                }
            } else if opt_n {
                acct.euser
            } else {
                acct.euid.to_string()
            };
            out.push_str(&format!("{val}{term}"));
        } else if opt_g {
            let val = if opt_r {
                if opt_n {
                    acct.group
                } else {
                    acct.gid.to_string()
                }
            } else if opt_n {
                acct.egroup
            } else {
                acct.egid.to_string()
            };
            out.push_str(&format!("{val}{term}"));
        } else if opt_groups {
            let items: Vec<String> = acct
                .groups
                .iter()
                .map(|(g, name)| {
                    if opt_n {
                        name.clone()
                    } else {
                        g.to_string()
                    }
                })
                .collect();
            out.push_str(&format!("{}{term}", items.join(group_sep)));
        } else {
            let mut parts = vec![
                format!("uid={}({})", acct.uid, acct.user),
                format!("gid={}({})", acct.gid, acct.group),
            ];
            if acct.euid != acct.uid {
                parts.push(format!("euid={}({})", acct.euid, acct.euser));
            }
            if acct.egid != acct.gid {
                parts.push(format!("egid={}({})", acct.egid, acct.egroup));
            }
            let gr_fmt: Vec<String> = acct
                .groups
                .iter()
                .map(|(g, name)| format!("{g}({name})"))
                .collect();
            parts.push(format!("groups={}", gr_fmt.join(",")));
            out.push_str(&format!("{}\n", parts.join(" ")));
        }
    }

    BuiltinOutcome {
        stdout: out,
        stderr: err_buf,
        exit_code,
    }
}

fn cmd_less_more(
    cmd: &str,
    args: &[String],
    mut stdin: CommandInput,
    cwd: &str,
    fs: &dyn SafeBashFs,
    write: &mut super::CommandWriter,
) -> BuiltinOutcome {
    let mut number_lines = false;
    let mut squeeze_blank = false;
    let mut ignore_case = false;
    let mut start_line: usize = 1;
    let mut start_pat: Option<String> = None;
    let mut files: Vec<String> = Vec::new();
    let mut end_of_options = false;

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if !end_of_options && a == "--" {
            end_of_options = true;
            i += 1;
            continue;
        }
        if !end_of_options && (a == "--help" || a == "-?") {
            return ok_out(&format!("Usage: {cmd} [-Ns] [+LINE] [+/PATTERN] [FILE...]\n"));
        }
        if !end_of_options && (a == "--version" || a == "-V") {
            return ok_out(&format!("{cmd} (virtual-bash)\n"));
        }
        if !end_of_options && let Some(rest) = a.strip_prefix('+') {
            if let Some(pat) = rest.strip_prefix('/') {
                start_pat = Some(pat.to_string());
            } else if !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()) {
                if let Ok(n) = rest.parse::<usize>() {
                    start_line = n.max(1);
                }
            }
            i += 1;
            continue;
        }
        if !end_of_options && a.starts_with("--") {
            if a == "--LINE-NUMBERS" || a == "--line-numbers" {
                number_lines = true;
            } else if a == "--squeeze-blank-lines" {
                squeeze_blank = true;
            } else if a == "--ignore-case" || a == "--IGNORE-CASE" {
                ignore_case = true;
            } else if a == "--pattern" {
                i += 1;
                start_pat = Some(args.get(i).cloned().unwrap_or_default());
            } else if let Some(pat) = a.strip_prefix("--pattern=") {
                start_pat = Some(pat.to_string());
            }
            i += 1;
            continue;
        } else if !end_of_options && a.starts_with('-') && a.len() > 1 {
            let sub = &a[1..];
            for (byte_idx, ch) in sub.char_indices() {
                let rest = &sub[byte_idx + ch.len_utf8()..];
                match ch {
                    'N' => number_lines = true,
                    'n' => number_lines = false,
                    's' => squeeze_blank = true,
                    'i' | 'I' => ignore_case = true,
                    'p' => {
                        if !rest.is_empty() {
                            start_pat = Some(rest.to_string());
                        } else {
                            i += 1;
                            start_pat = Some(args.get(i).cloned().unwrap_or_default());
                        }
                        break;
                    }
                    'P' | 'x' | 'z' => {
                        let val = if !rest.is_empty() {
                            Some(rest.to_string())
                        } else {
                            i += 1;
                            args.get(i).cloned()
                        };
                        let valid = match val.as_deref() {
                            None => false,
                            Some(_) if ch == 'P' => true,
                            Some(v) if ch == 'x' => {
                                !v.is_empty()
                                    && v.split(',').all(|part| {
                                        !part.is_empty()
                                            && part.bytes().all(|b| b.is_ascii_digit())
                                    })
                            }
                            Some(v) => {
                                let digits = v
                                    .strip_prefix('+')
                                    .or_else(|| v.strip_prefix('-'))
                                    .unwrap_or(v);
                                !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())
                            }
                        };
                        if !valid {
                            return err_out(
                                &format!("{cmd}: numeric value required after -{ch}\n"),
                                1,
                            );
                        }
                        break;
                    }
                    _ => {}
                }
            }
            i += 1;
            continue;
        } else {
            files.push(a.clone());
            i += 1;
        }
    }

    if files.is_empty() {
        files.push("-".to_string());
    }

    let pass_through =
        !number_lines && !squeeze_blank && start_line == 1 && start_pat.as_deref().unwrap_or("").is_empty();
    let mut result = ok_out("");
    let mut combined = String::new();
    let limit = fs.max_input_bytes();
    let mut remaining = limit;
    let mut admit = |size| {
        remaining = remaining.checked_sub(size).ok_or_else(|| fs.limit_error("maxInputBytes", limit))?;
        Ok::<(), String>(())
    };
    for file in &files {
        if file == "-" {
            let mut bytes = Vec::new();
            let mut status = Ok(());
            let mut writable = true;
            let read = stdin.read_stdin(|chunk| {
                status = admit(chunk.len());
                if status.is_err() { return false; }
                if pass_through {
                    writable = write(1, &crate::vfs::bytes_to_stream_string(chunk), &mut result);
                } else {
                    bytes.extend_from_slice(chunk);
                }
                writable
            });
            if let Err(e) = read.and(status) {
                result.exit_code = 1;
                write(2, &format!("{cmd}: {e}\n"), &mut result);
                return result;
            }
            if !writable { return result; }
            if !pass_through { combined.push_str(&String::from_utf8_lossy(&bytes)); }
        } else {
            let path = resolve_posix_path(cwd, file);
            match fs.read_single_chunk_input(&path, None) {
                Ok(raw) => {
                    if let Err(e) = admit(raw.len()) {
                        result.exit_code = 1;
                        write(2, &format!("{cmd}: {e}\n"), &mut result);
                        return result;
                    }
                    if pass_through {
                        if !write(1, &crate::vfs::bytes_to_stream_string(&raw), &mut result) { return result; }
                    } else {
                        combined.push_str(&String::from_utf8_lossy(&raw));
                    }
                }
                Err(e) => {
                    result.exit_code = 1;
                    let message = stream_file_error(e, "readFile", &path);
                    if !write(2, &format!("{cmd}: {file}: {message}\n"), &mut result) { return result; }
                }
            }
        }
    }
    if combined.is_empty() { return result; }

    let has_trailing_newline = combined.ends_with('\n');
    let mut raw_lines: Vec<&str> = combined.split('\n').collect();
    if has_trailing_newline {
        raw_lines.pop();
    }

    let mut start_idx = start_line.saturating_sub(1);
    if let Some(ref pat) = start_pat
        && !pat.is_empty()
    {
        let rx = match super::search::ZeroRegex::extended(&crate::vfs::host_text(pat), ignore_case) {
            Ok(rx) => rx,
            Err(e) => {
                result.exit_code = 1;
                write(2, &format!("{cmd}: {e}\n"), &mut result);
                return result;
            }
        };
        if let Some(found) = raw_lines.iter().position(|l| rx.is_match(l)) {
            start_idx = found;
        }
    }

    let mut out = String::new();
    let mut prev_blank = false;
    for (idx, &line) in raw_lines.iter().enumerate() {
        if idx < start_idx {
            continue;
        }
        let is_blank = line.is_empty();
        if squeeze_blank && is_blank && prev_blank {
            continue;
        }
        prev_blank = is_blank;
        let is_last = idx + 1 == raw_lines.len();
        if number_lines {
            out.push_str(&format!("{:6}  {line}", idx + 1));
        } else {
            out.push_str(line);
        }
        if !is_last || has_trailing_newline {
            out.push('\n');
        }
    }
    write(1, &crate::vfs::shell_text(&out), &mut result);
    result
}

fn factor_mod_pow(mut base: u128, mut exp: u128, m: u128) -> u128 {
    let mut res = 1u128;
    base %= m;
    while exp > 0 {
        if (exp & 1) == 1 {
            res = res.wrapping_mul(base) % m;
        }
        base = base.wrapping_mul(base) % m;
        exp >>= 1;
    }
    res
}

fn factor_is_prime64(n: u64) -> bool {
    if n < 2 {
        return false;
    }
    for p in [2u64, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37] {
        if n == p {
            return true;
        }
        if n.is_multiple_of(p) {
            return false;
        }
    }
    let mut d = n - 1;
    let r = d.trailing_zeros();
    d >>= r;
    let n128 = n as u128;
    for a in [2u64, 325, 9375, 28178, 450775, 9780504, 1795265022] {
        if a % n == 0 {
            continue;
        }
        let mut x = factor_mod_pow(a as u128, d as u128, n128);
        if x == 1 || x == n128 - 1 {
            continue;
        }
        let mut composite = true;
        for _ in 1..r {
            x = x.wrapping_mul(x) % n128;
            if x == n128 - 1 {
                composite = false;
                break;
            }
        }
        if composite {
            return false;
        }
    }
    true
}

fn factor_gcd(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        let r = a % b;
        a = b;
        b = r;
    }
    a
}

fn factor_pollard_rho(n: u64) -> u64 {
    if n.is_multiple_of(2) {
        return 2;
    }
    let n128 = n as u128;
    for c in 1u128.. {
        let f = |x: u64| -> u64 { (((x as u128) * (x as u128) + c) % n128) as u64 };
        let mut x = 2u64;
        let mut y = 2u64;
        let mut d = 1u64;
        while d == 1 {
            x = f(x);
            y = f(f(y));
            let diff = x.abs_diff(y);
            d = factor_gcd(diff, n);
        }
        if d != n {
            return d;
        }
    }
    n
}

fn collect_factors_u64(n: u64, out: &mut Vec<u128>) {
    if n <= 1 {
        return;
    }
    if factor_is_prime64(n) {
        out.push(n as u128);
        return;
    }
    let d = factor_pollard_rho(n);
    collect_factors_u64(d, out);
    collect_factors_u64(n / d, out);
}

fn factor_u128(mut n: u128) -> Vec<u128> {
    let mut factors = Vec::new();
    if n <= 1 {
        return factors;
    }
    while n.is_multiple_of(2) {
        factors.push(2);
        n /= 2;
    }
    let mut d = 3u128;
    while d <= 65535 && d * d <= n {
        while n.is_multiple_of(d) {
            factors.push(d);
            n /= d;
        }
        d += 2;
    }
    if n > 1 {
        if n <= u64::MAX as u128 {
            let mut tail = Vec::new();
            collect_factors_u64(n as u64, &mut tail);
            tail.sort_unstable();
            factors.extend(tail);
        } else {
            while d * d <= n {
                while n.is_multiple_of(d) {
                    factors.push(d);
                    n /= d;
                }
                d += 2;
            }
            if n > 1 {
                factors.push(n);
            }
        }
    }
    factors
}

fn cmd_factor(args: &[String], mut stdin: CommandInput, posix: bool) -> BuiltinOutcome {
    let mut exponents = false;
    let mut debug = false;
    let mut options_ended = false;
    let mut operands = Vec::new();
    let usage = |message: String| err_out(&format!("factor: {message}\nTry 'factor --help' for more information.\n"), 1);
    for arg in args {
        if !options_ended && arg == "--" {
            options_ended = true;
            continue;
        }
        if !options_ended && let Some(long) = arg.strip_prefix("--") {
            let name = long.split('=').next().unwrap();
            let mut matches = ["-debug", "exponents", "help", "version"].into_iter().filter(|opt| opt.starts_with(name));
            let Some(option) = matches.next() else { return usage(format!("unrecognized option '{arg}'")); };
            if let Some(next) = matches.next() {
                let choices = [option, next].into_iter().chain(matches).map(|s| format!("'--{s}'")).collect::<Vec<_>>().join(" ");
                return usage(format!("option '{arg}' is ambiguous; possibilities: {choices}"));
            }
            if name.len() != long.len() { return usage(format!("option '--{option}' doesn't allow an argument")); }
            match option {
                "help" => return ok_out("Usage: factor [NUMBER]...\nPrint prime factors; with no numbers, read standard input.\nOptions: --exponents (print repeated factors as powers) --help --version\nMaximum supported value: Infinity\n"),
                "version" => return ok_out("factor (virtual-bash)\n"),
                "-debug" => debug = true,
                _ => exponents = true,
            }
        } else if !options_ended && arg.len() > 1 && arg.starts_with('-') {
            if let Some(ch) = arg[1..].chars().find(|&ch| ch != 'h') {
                return usage(format!("invalid option -- '{ch}'"));
            }
            exponents = true;
        } else {
            operands.push(arg.clone());
            options_ended |= posix;
        }
    }

    let nums: Vec<String> = if operands.is_empty() {
        let mut bytes = Vec::new();
        if let Err(error) = stdin.append_bytes(&mut bytes) {
            return err_out(&format!("factor: standard input: {error}\n"), 1);
        }
        bytes.split(|&b| matches!(b, b' ' | b'\t' | b'\n')).filter(|t| !t.is_empty())
            .map(|t| crate::vfs::bytes_to_stream_string(t.split(|&b| b == 0).next().unwrap())).collect()
    } else {
        operands
    };

    let mut out = String::new();
    let mut err = String::new();
    let mut exit_code = 0;
    for raw in nums {
        let trimmed = raw.trim_start_matches(' ');
        let digits = trimmed.strip_prefix('+').unwrap_or(trimmed);
        let n = digits.bytes().all(|b| b.is_ascii_digit()).then(|| digits.parse::<u128>().ok()).flatten();
        let Some(n) = n else {
            exit_code = 1;
            let quoted = quote_bytes(&stream_string_to_bytes(&raw));
            err.push_str(&format!("factor: {quoted} is not a valid positive integer\n"));
            continue;
        };
        if debug { err.push_str("[using single-precision arithmetic] "); }
        let factors = factor_u128(n);
        out.push_str(&format!("{n}:"));
        let mut i = 0usize;
        while i < factors.len() {
            let f = factors[i];
            let mut exp = 1usize;
            if exponents {
                while i + 1 < factors.len() && factors[i + 1] == f {
                    exp += 1;
                    i += 1;
                }
            }
            if exp > 1 {
                out.push_str(&format!(" {f}^{exp}"));
            } else {
                out.push_str(&format!(" {f}"));
            }
            i += 1;
        }
        out.push('\n');
    }
    BuiltinOutcome {
        stdout: out,
        stderr: err,
        exit_code,
    }
}

fn fold_char_width(cp: u32) -> usize {
    if cp < 128 {
        usize::from(cp != 0)
    } else if ranges_contain(fold_widths::ZERO, cp) {
        0
    } else if ranges_contain(fold_widths::WIDE, cp) {
        2
    } else {
        1
    }
}

// An incomplete but valid prefix is held for the next read. At EOF each
// remaining invalid byte is a unit, as in the byte-oriented original.
fn decode_fold_unit(bytes: &[u8], utf8: bool, eof: bool) -> Option<(u32, usize, bool)> {
    let first = bytes[0];
    let size = match first { 0xc2..=0xdf => 2, 0xe0..=0xef => 3, 0xf0..=0xf4 => 4, _ => 1 };
    if !utf8 || size == 1 { return Some((first.into(), 1, first.is_ascii())); }
    match std::str::from_utf8(&bytes[..size.min(bytes.len())]) {
        Ok(text) => Some((text.chars().next()?.into(), size, true)),
        Err(e) if !eof && e.error_len().is_none() => None,
        Err(_) => Some((first.into(), 1, false)),
    }
}

fn cmd_fold(
    args: &[String],
    mut stdin: CommandInput,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
    write: &mut super::CommandWriter,
) -> BuiltinOutcome {
    if args.len() == 1 && (args[0] == "--help" || args[0] == "--version") {
        return ok_out(if args[0] == "--help" {
            "Usage: fold [OPTION]... [FILE]...\n"
        } else {
            "fold (safe-bash) 0.0.1\n"
        });
    }
    let mut widths = Vec::new();
    let mut break_spaces = false;
    let mut mode = "columns";
    let mut files = Vec::new();
    let mut iter = args.iter();
    while let Some(a) = iter.next() {
        if a == "--" {
            files.extend(iter.cloned());
            break;
        } else if a == "-" || !a.starts_with('-') {
            files.push(a.clone());
        } else if let Some(rest) = a.strip_prefix("--") {
            let (name, value) = rest
                .split_once('=')
                .map_or((rest, None), |(name, v)| (name, Some(v)));
            match name {
                "width" => {
                    let Some(v) = value.or_else(|| iter.next().map(String::as_str)) else {
                        return err_out("fold: option '--width' requires an argument\n", 1);
                    };
                    widths.push(v);
                }
                "bytes" | "spaces" => {
                    if value.is_some() {
                        return err_out(
                            &format!("fold: option '--{name}' does not take an argument\n"),
                            1,
                        );
                    }
                    if name == "spaces" {
                        break_spaces = true;
                    } else {
                        mode = "bytes";
                    }
                }
                n if !n.is_empty() && "characters".starts_with(n) => {
                    if value.is_some() {
                        return err_out(
                            &format!("fold: option '--{name}' does not take an argument\n"),
                            1,
                        );
                    }
                    mode = "characters";
                }
                _ => return err_out(&format!("fold: unrecognized option '{a}'\n"), 1),
            }
        } else {
            for (i, ch) in a[1..].char_indices() {
                match ch {
                    'b' => mode = "bytes",
                    'c' => mode = "characters",
                    's' => break_spaces = true,
                    'w' => {
                        if let Some(v) = a
                            .get(i + 2..)
                            .filter(|s| !s.is_empty())
                            .or_else(|| iter.next().map(String::as_str))
                        {
                            widths.push(v);
                        } else {
                            return err_out("fold: option requires an argument -- 'w'\n", 1);
                        }
                        break;
                    }
                    '0'..='9' => {
                        widths.push(&a[i + 1..]);
                        break;
                    }
                    _ => return err_out(&format!("fold: invalid option -- '{ch}'\n"), 1),
                }
            }
        }
    }
    let mut width = 80u64;
    for value in widths {
        let digits = value.strip_prefix('+').unwrap_or(value);
        let Some(n) = digits.parse::<u64>().ok().filter(|n| {
            (1..=9_007_199_254_740_991).contains(n) && digits.bytes().all(|b| b.is_ascii_digit())
        }) else {
            return err_out(&format!("fold: invalid number '{value}'\n"), 1);
        };
        width = n;
    }

    let locale = env
        .get("LC_ALL")
        .filter(|s| !s.is_empty())
        .or_else(|| env.get("LC_CTYPE").filter(|s| !s.is_empty()))
        .or_else(|| env.get("LANG").filter(|s| !s.is_empty()))
        .map(|s| s.as_str())
        .unwrap_or("C.UTF-8");
    let loc_upper = locale.to_ascii_uppercase();
    let loc_base = loc_upper.split('@').next().unwrap_or("");
    let utf8 = loc_base.ends_with("UTF-8") || loc_base.ends_with("UTF8");

    let adjust_col = |col: u64, cp: u32, unit_len: usize, valid: bool| -> u64 {
        if mode == "bytes" {
            col + unit_len as u64
        } else if cp == 8 {
            col.saturating_sub(1)
        } else if cp == 13 {
            0
        } else if cp == 9 {
            col + (8 - col % 8)
        } else if mode == "characters" {
            col + 1
        } else if utf8 && valid {
            col + fold_char_width(cp) as u64
        } else {
            col + 1
        }
    };

    let inputs = if files.is_empty() {
        vec!["-".to_string()]
    } else {
        files
    };
    let mut out = ok_out("");
    let mut batch = Vec::new();
    for f in &inputs {
        let mut line_buf = Vec::new();
        let mut col = 0u64;
        let mut last_blank = None;
        let mut pending = [0u8; 4];
        let mut len = 0;
        let mut transfer = |chunk: &[u8], eof: bool| {
            let mut emit = |mut bytes: &[u8]| {
                while !bytes.is_empty() {
                    let count = (16384 - batch.len()).min(bytes.len());
                    batch.extend_from_slice(&bytes[..count]);
                    bytes = &bytes[count..];
                    if batch.len() == 16384 {
                        if !write(1, &crate::vfs::bytes_to_stream_string(&batch), &mut out) { return false; }
                        batch.clear();
                    }
                }
                true
            };
            let mut emit_line = |line: &[u8]| emit(line) && emit(b"\n");
            let mut consume = |unit_slice: &[u8], cp: u32, valid: bool, direct: bool| {
                if cp == 10 {
                    if !emit_line(&line_buf) { return false; }
                    line_buf.clear();
                    col = 0;
                    last_blank = None;
                    return true;
                }
                // The original admits a direct ASCII NUL as one column when it
                // fits. On overflow, or when drained by the decoder, it uses wcwidth.
                if cp == 0 && direct && col < width {
                    col += 1;
                    line_buf.push(0);
                    return true;
                }
                while adjust_col(col, cp, unit_slice.len(), valid) > width && !line_buf.is_empty() {
                    if break_spaces && let Some(lb) = last_blank {
                        if !emit_line(&line_buf[..lb]) { return false; }
                        line_buf.drain(..lb);
                        col = 0;
                        last_blank = None;
                        let mut roff = 0usize;
                        while roff < line_buf.len() {
                            let (rcp, rulen, rvalid) = decode_fold_unit(&line_buf[roff..], utf8, true).unwrap();
                            col = if rcp == 0 { col + 1 } else { adjust_col(col, rcp, rulen, rvalid) };
                            roff += rulen;
                            if rcp == 32 || rcp == 9 {
                                last_blank = Some(roff);
                            }
                        }
                    } else {
                        if !emit_line(&line_buf) { return false; }
                        line_buf.clear();
                        col = 0;
                        last_blank = None;
                    }
                }
                col = adjust_col(col, cp, unit_slice.len(), valid);
                line_buf.extend_from_slice(unit_slice);
                if break_spaces && (cp == 32 || cp == 9) {
                    last_blank = Some(line_buf.len());
                }
                true
            };
            for byte in chunk {
                if len == 0 && (!utf8 || byte.is_ascii()) {
                    if !consume(std::slice::from_ref(byte), u32::from(*byte), byte.is_ascii(), true) { return false; }
                    continue;
                }
                pending[len] = *byte;
                len += 1;
                while len != 0 {
                    let Some((cp, used, valid)) = decode_fold_unit(&pending[..len], true, false) else { break };
                    if !consume(&pending[..used], cp, valid, false) { return false; }
                    pending.copy_within(used..len, 0);
                    len -= used;
                }
            }
            if eof {
                for byte in &pending[..len] {
                    if !consume(std::slice::from_ref(byte), u32::from(*byte), false, false) { return false; }
                }
                if !emit(&line_buf) { return false; }
            }
            let written = batch.is_empty() || write(1, &crate::vfs::bytes_to_stream_string(&batch), &mut out);
            batch.clear();
            written
        };
        let mut writable = true;
        let read = stdin.read_operand(f, cwd, fs, true, |chunk| {
            writable = transfer(chunk, false);
            writable
        });
        if !writable { break; }
        match read {
            Ok(()) => { if !transfer(&[], true) { break; } }
            Err(e) => {
                out.exit_code = 1;
                if !write(2, &format!("fold: {e}\n"), &mut out) { break; }
            }
        }
    }
    out
}

fn parse_fmt_width_val(text: &str, max_val: usize, is_goal: bool, unicode: bool) -> Result<usize, String> {
    let trimmed = text.trim_start_matches([' ', '\t', '\r', '\n', '\x0b', '\x0c']);
    let digits = trimmed.strip_prefix('+').unwrap_or(trimmed);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("fmt: invalid width: {}\n", fmt_quote::quote(text, false, unicode)));
    }
    match digits.parse::<usize>() {
        Ok(n) if n <= max_val => Ok(n),
        _ => {
            let reason = if is_goal {
                ": Value too large for defined data type"
            } else {
                ": Numerical result out of range"
            };
            Err(format!("fmt: invalid width: {}{reason}\n", fmt_quote::quote(text, false, unicode)))
        }
    }
}

#[derive(Clone)]
struct FmtWord {
    start: usize,
    length: usize,
    space: usize,
    opening: bool,
    period: bool,
    punctuation: bool,
    final_word: bool,
}

struct FmtFormatter<'a> {
    source: crate::vfs::ChunkReader<'a>,
    input: Vec<u8>,
    eof: bool,
    pos: usize,
    out: Vec<u8>,
    text: Vec<u8>,
    used: usize,
    words: Vec<FmtWord>,
    costs: Vec<i64>,
    breaks: Vec<usize>,
    lengths: Vec<usize>,
    width: usize,
    goal: usize,
    crown: bool,
    tagged: bool,
    split: bool,
    uniform: bool,
    prefix: Vec<u8>,
    leading: usize,
    full_prefix: usize,
    column: usize,
    next_prefix: usize,
    prefix_indent: usize,
    first_indent: usize,
    other_indent: usize,
    last_length: usize,
    out_column: usize,
    tabs: bool,
}

impl<'a> FmtFormatter<'a> {
    fn read(&mut self) -> Result<i32, String> {
        if self.pos == self.input.len() {
            if self.eof { return Ok(-1); }
            (self.source)(&mut self.input)?;
            self.pos = 0;
            if self.input.is_empty() { self.eof = true; return Ok(-1); }
        }
        let byte = self.input[self.pos];
        self.pos += 1;
        Ok(i32::from(byte))
    }

    fn spaces(&mut self, count: usize) {
        let target = self.out_column + count;
        let tab_end = (target / 8) * 8;
        if self.tabs && self.out_column + 1 < tab_end {
            while self.out_column < tab_end {
                self.out.push(b'\t');
                self.out_column = (self.out_column / 8 + 1) * 8;
            }
        }
        while self.out_column < target {
            self.out.push(b' ');
            self.out_column += 1;
        }
    }

    fn whitespace(&mut self, mut byte: i32) -> Result<i32, String> {
        while byte == 32 || byte == 9 {
            if byte == 32 {
                self.column += 1;
            } else {
                self.tabs = true;
                self.column = (self.column / 8 + 1) * 8;
            }
            byte = self.read()?;
        }
        Ok(byte)
    }

    fn line_start(&mut self) -> Result<i32, String> {
        self.column = 0;
        let first = self.read()?;
        let mut byte = self.whitespace(first)?;
        self.next_prefix = if !self.prefix.is_empty() {
            self.column
        } else {
            self.leading.min(self.column)
        };
        if !self.prefix.is_empty() {
            for i in 0..self.prefix.len() {
                let expected = self.prefix[i] as i32;
                if byte != expected {
                    return Ok(byte);
                }
                self.column += 1;
                byte = self.read()?;
            }
            byte = self.whitespace(byte)?;
        }
        Ok(byte)
    }

    fn compatible(&self, byte: i32) -> bool {
        byte != -1
            && byte != 10
            && self.next_prefix == self.prefix_indent
            && self.column >= self.next_prefix + self.full_prefix
    }

    fn secondary(&mut self, compat: bool) {
        if self.split {
            self.other_indent = self.first_indent;
        } else if self.crown {
            self.other_indent = if compat {
                self.column
            } else {
                self.first_indent
            };
        } else if self.tagged {
            if compat && self.column != self.first_indent {
                self.other_indent = self.column;
            } else if self.other_indent == self.first_indent {
                self.other_indent = if self.first_indent == 0 { 3 } else { 0 };
            }
        } else {
            self.other_indent = self.first_indent;
        }
    }

    fn optimize(&mut self) {
        let count = self.words.len();
        if self.costs.len() <= count {
            self.costs.resize(count + 1, 0);
            self.breaks.resize(count + 1, 0);
            self.lengths.resize(count + 1, 0);
        }
        let goal = self.goal as i64;
        let max_len = self.width;
        let first_indent = self.first_indent;
        let other_indent = self.other_indent;
        let last_length = self.last_length as i64;
        self.costs[count] = 0;

        for start in (0..count).rev() {
            let word = &self.words[start];
            let mut penalty: i64 = 4900;
            if start > 0 {
                let prev = &self.words[start - 1];
                if prev.period {
                    penalty += if prev.final_word { -2500 } else { 360000 };
                } else if prev.punctuation {
                    penalty -= 1600;
                } else if start >= 2 && self.words[start - 2].final_word {
                    penalty += 40000 / (prev.length as i64 + 2);
                }
            }
            if word.opening {
                penalty -= 1600;
            } else if word.final_word {
                penalty += 22500 / (word.length as i64 + 2);
            }
            let mut length = (if start == 0 { first_indent } else { other_indent }) + word.length;
            let mut best = i64::MAX / 4;
            let mut end = start + 1;
            loop {
                let mut cost = self.costs[end];
                if end != count {
                    let dg = goal - length as i64;
                    cost += 100 * dg * dg;
                    if self.breaks[end] != count {
                        let dl = length as i64 - self.lengths[end] as i64;
                        cost += 50 * dl * dl;
                    }
                }
                if start == 0 && last_length > 0 {
                    let dll = length as i64 - last_length;
                    cost += 50 * dll * dll;
                }
                if cost < best {
                    best = cost;
                    self.breaks[start] = end;
                    self.lengths[start] = length;
                }
                if end == count {
                    break;
                }
                length += self.words[end - 1].space + self.words[end].length;
                if length > max_len {
                    break;
                }
                end += 1;
            }
            self.costs[start] = best + penalty;
        }
    }

    fn render(&mut self, finish: usize) {
        let mut start = 0usize;
        while start < finish {
            self.out_column = 0;
            if self.prefix_indent > 0 {
                self.spaces(self.prefix_indent);
            }
            let pfx = self.prefix.clone();
            self.out.extend_from_slice(&pfx);
            self.out_column += pfx.len();
            let target_indent = if start == 0 {
                self.first_indent
            } else {
                self.other_indent
            };
            if target_indent > self.out_column {
                let needed = target_indent - self.out_column;
                self.spaces(needed);
            }
            let end = self.breaks[start];
            for idx in start..end {
                let w_start = self.words[idx].start;
                let w_len = self.words[idx].length;
                let w_space = self.words[idx].space;
                self.out.extend_from_slice(&self.text[w_start..w_start + w_len]);
                self.out_column += w_len;
                if idx + 1 != end {
                    if !self.tabs && w_space == 1 {
                        self.out.push(b' ');
                        self.out_column += 1;
                    } else {
                        self.spaces(w_space);
                    }
                }
            }
            self.last_length = self.out_column;
            self.out.push(b'\n');
            start = end;
        }
    }

    fn make_room(&mut self, current: &mut FmtWord) {
        self.secondary(true);
        if self.words.is_empty() {
            self.out.extend_from_slice(&self.text[..self.used]);
            self.used = 0;
            current.start = 0;
            return;
        }
        self.optimize();
        let mut cut = self.words.len();
        let mut score = i64::MAX;
        let mut line = self.breaks[0];
        while line != self.words.len() {
            let next = self.breaks[line];
            let candidate = self.costs[line] - self.costs[next];
            if candidate < score { cut = line; score = candidate; }
            score = score.saturating_add(9);
            line = next;
        }
        self.render(cut);
        let offset = self.words.get(cut).map_or(current.start, |w| w.start);
        self.text.copy_within(offset..self.used, 0);
        self.used -= offset;
        self.words.drain(..cut);
        for word in &mut self.words { word.start -= offset; }
        current.start -= offset;
    }

    fn read_line(&mut self, mut byte: i32) -> Result<i32, String> {
        loop {
            let mut word = FmtWord {
                start: self.used,
                length: 0,
                space: 0,
                opening: false,
                period: false,
                punctuation: false,
                final_word: false,
            };
            loop {
                if self.used == self.text.len() {
                    self.make_room(&mut word);
                }
                self.text[self.used] = byte as u8;
                self.used += 1;
                byte = self.read()?;
                if byte == -1 || byte == 32 || (9..=13).contains(&byte) {
                    break;
                }
            }
            word.length = self.used - word.start;
            self.column += word.length;
            let first = self.text[word.start];
            let last = self.text[self.used - 1];
            word.opening = matches!(first, 0 | 40 | 91 | 39 | 96 | 34);
            word.punctuation = (33..=47).contains(&last)
                || (58..=64).contains(&last)
                || (91..=96).contains(&last)
                || (123..=126).contains(&last);
            let mut terminal = self.used - 1;
            while terminal > word.start {
                let tb = self.text[terminal];
                if !matches!(tb, 0 | 41 | 93 | 39 | 34) {
                    break;
                }
                terminal -= 1;
            }
            let pb = self.text[terminal];
            word.period = matches!(pb, 0 | 46 | 63 | 33);
            let before = self.column;
            byte = self.whitespace(byte)?;
            word.space = self.column - before;
            word.final_word = byte == -1 || (word.period && (byte == 10 || word.space > 1));
            if byte == 10 || byte == -1 || self.uniform {
                word.space = if word.final_word { 2 } else { 1 };
            }
            if self.words.len() == 998 { self.make_room(&mut word); }
            self.words.push(word);
            if byte == -1 || byte == 10 {
                break;
            }
        }
        self.line_start()
    }

    fn run(&mut self) -> Result<(), String> {
        let mut byte = self.line_start()?;
        loop {
            if byte == 10
                || byte == -1
                || self.next_prefix < self.leading
                || self.column < self.next_prefix + self.full_prefix
            {
                self.out_column = 0;
                if self.column > self.next_prefix || (byte != 10 && byte != -1) {
                    let np = self.next_prefix;
                    self.spaces(np);
                    let pfx = self.prefix.clone();
                    for pb in pfx {
                        if self.out_column == self.column {
                            break;
                        }
                        self.out.push(pb);
                        self.out_column += 1;
                    }
                    if byte != -1 && byte != 10 && self.column > self.out_column {
                        let diff = self.column - self.out_column;
                        self.spaces(diff);
                    }
                    if byte == -1 && self.column >= self.next_prefix + self.prefix.len() {
                        self.out.push(b'\n');
                    }
                }
                while byte != -1 && byte != 10 {
                    self.out.push(byte as u8);
                    byte = self.read()?;
                }
                if byte == -1 {
                    break;
                }
                self.out.push(b'\n');
                byte = self.line_start()?;
                continue;
            }
            self.last_length = 0;
            self.prefix_indent = self.next_prefix;
            self.first_indent = self.column;
            self.words.clear();
            self.used = 0;
            byte = self.read_line(byte)?;
            let compat = self.compatible(byte);
            self.secondary(compat);
            if !self.split {
                let accept_second = self.compatible(byte)
                    && if self.crown || self.tagged {
                        self.crown || self.column != self.first_indent
                    } else {
                        self.column == self.other_indent
                    };
                if accept_second {
                    loop {
                        byte = self.read_line(byte)?;
                        if !(self.compatible(byte) && self.column == self.other_indent) {
                            break;
                        }
                    }
                }
            }
            if let Some(last) = self.words.last_mut() {
                last.period = true;
                last.final_word = true;
            }
            self.optimize();
            self.render(self.words.len());
        }
        Ok(())
    }
}

fn cmd_fmt(
    args: &[String],
    mut stdin: CommandInput,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let locale = ["LC_ALL", "LC_CTYPE", "LANG"].iter()
        .find_map(|key| env.get(*key).filter(|v| !v.is_empty())).map_or("C", String::as_str);
    let unicode = match locale.to_ascii_lowercase().as_str() {
        "c" | "posix" => false,
        "c.utf8" | "c.utf-8" | "en_us.utf8" | "en_us.utf-8" => true,
        _ => return err_out("fmt: Unavailable fmt byte/locale profile\n", 1),
    };
    let mut width_opt: Option<String> = None;
    let mut goal_opt: Option<String> = None;
    let mut crown = false;
    let mut tagged = false;
    let mut split = false;
    let mut uniform = false;
    let mut prefix_bytes: Vec<u8> = Vec::new();
    let mut leading = 0usize;
    let mut full_prefix = 0usize;
    let mut files: Vec<String> = Vec::new();
    let mut stopped = false;
    let posixly_correct = env.contains_key("POSIXLY_CORRECT");
    let mut i = 0usize;

    if let Some(first) = args.first()
        && first.starts_with('-')
        && first.len() > 1
        && first.as_bytes()[1].is_ascii_digit()
    {
        width_opt = Some(first[1..].to_string());
        i = 1;
    }

    let long_opts = [
        ("crown-margin", "c"),
        ("prefix", "p"),
        ("split-only", "s"),
        ("tagged-paragraph", "t"),
        ("uniform-spacing", "u"),
        ("width", "w"),
        ("goal", "g"),
        ("help", "help"),
        ("version", "version"),
    ];

    let mut apply_opt = |key: &str, val: Option<&str>| -> Result<Option<BuiltinOutcome>, String> {
        match key {
            "c" => crown = true,
            "t" => tagged = true,
            "s" => split = true,
            "u" => uniform = true,
            "w" => width_opt = Some(val.unwrap_or("").to_string()),
            "g" => goal_opt = Some(val.unwrap_or("").to_string()),
            "help" => {
                return Ok(Some(ok_out(
                    "Usage: fmt [-WIDTH] [OPTION]... [FILE]...\nReformat paragraphs; omitted FILE or '-' reads standard input.\n  -c, --crown-margin       preserve indentation of first two lines\n  -t, --tagged-paragraph   use distinct first and following margins\n  -p, --prefix=STRING      format only lines with this prefix\n  -s, --split-only         split lines without joining\n  -u, --uniform-spacing    one space between words, two after sentences\n  -w, --width=WIDTH        maximum width (default 75)\n  -g, --goal=WIDTH         preferred width (default 93% of width)\n      --help              display this help\n      --version           display virtual command identity\n",
                )))
            }
            "version" => return Ok(Some(ok_out("fmt (virtual-bash)\n"))),
            "p" => {
                let raw = crate::vfs::stream_string_to_bytes(val.unwrap_or(""));
                let mut start = 0usize;
                let mut end = raw.iter().position(|&b| b == 0).unwrap_or(raw.len());
                while start < end && raw[start] == b' ' {
                    start += 1;
                }
                leading = start;
                full_prefix = end - start;
                while end > start && raw[end - 1] == b' ' {
                    end -= 1;
                }
                prefix_bytes = raw[start..end].to_vec();
            }
            _ => {}
        }
        Ok(None)
    };

    while i < args.len() {
        let a = &args[i];
        if stopped || !a.starts_with('-') || a == "-" {
            files.push(a.clone());
            if posixly_correct {
                stopped = true;
            }
            i += 1;
            continue;
        }
        if a == "--" {
            stopped = true;
            i += 1;
            continue;
        }
        if let Some(rest) = a.strip_prefix("--") {
            let (name, eq_val) = match rest.split_once('=') {
                Some((n, v)) => (n, Some(v)),
                None => (rest, None),
            };
            let exact = long_opts.iter().find(|&&(k, _)| k == name);
            let matches: Vec<&(&str, &str)> = long_opts
                .iter()
                .filter(|&&(k, _)| k.starts_with(name))
                .collect();
            let (sel_name, key) = if let Some(&pair) = exact {
                pair
            } else if matches.len() == 1 {
                *matches[0]
            } else if matches.len() > 1 {
                let poss: Vec<String> = matches.iter().map(|&&(k, _)| format!("'--{k}'")).collect();
                return err_out(
                    &format!(
                        "fmt: option '{a}' is ambiguous; possibilities: {}\nTry 'fmt --help' for more information.\n",
                        poss.join(" ")
                    ),
                    1,
                );
            } else {
                return err_out(
                    &format!("fmt: unrecognized option '{a}'\nTry 'fmt --help' for more information.\n"),
                    1,
                );
            };
            let val = if matches!(key, "p" | "w" | "g") {
                if let Some(v) = eq_val {
                    Some(v.to_string())
                } else if i + 1 < args.len() {
                    i += 1;
                    Some(args[i].clone())
                } else {
                    return err_out(
                        &format!(
                            "fmt: option '--{sel_name}' requires an argument\nTry 'fmt --help' for more information.\n"
                        ),
                        1,
                    );
                }
            } else {
                if eq_val.is_some() {
                    return err_out(
                        &format!(
                            "fmt: option '--{sel_name}' doesn't allow an argument\nTry 'fmt --help' for more information.\n"
                        ),
                        1,
                    );
                }
                None
            };
            match apply_opt(key, val.as_deref()) {
                Ok(Some(out)) => return out,
                Ok(None) => {}
                Err(msg) => return err_out(&msg, 1),
            }
            i += 1;
        } else {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut ci = 0usize;
            while ci < chars.len() {
                let ch = chars[ci];
                if ch.is_ascii_digit() {
                    return err_out(
                        &format!("fmt: invalid option -- {ch}; -WIDTH is recognized only when it is the first\noption; use -w N instead\nTry 'fmt --help' for more information.\n"),
                        1,
                    );
                }
                if !"cstuwpg".contains(ch) {
                    let byte = stream_string_to_bytes(ch.encode_utf8(&mut [0; 4]))[0];
                    let ch = crate::vfs::bytes_to_stream_string(&[byte]);
                    return err_out(
                        &format!("fmt: invalid option -- '{ch}'\nTry 'fmt --help' for more information.\n"),
                        1,
                    );
                }
                let key_s = ch.to_string();
                if "pwg".contains(ch) {
                    let inline: String = chars[ci + 1..].iter().collect();
                    let val = if !inline.is_empty() {
                        inline
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return err_out(
                            &format!(
                                "fmt: option requires an argument -- '{ch}'\nTry 'fmt --help' for more information.\n"
                            ),
                            1,
                        );
                    };
                    match apply_opt(&key_s, Some(&val)) {
                        Ok(Some(out)) => return out,
                        Ok(None) => {}
                        Err(msg) => return err_out(&msg, 1),
                    }
                    break;
                } else {
                    let _ = apply_opt(&key_s, None);
                    ci += 1;
                }
            }
            i += 1;
        }
    }

    let mut width = 75usize;
    if let Some(ref w_str) = width_opt {
        width = match parse_fmt_width_val(w_str, 2500, false, unicode) {
            Ok(w) => w,
            Err(msg) => return err_out(&msg, 1),
        };
    }
    let goal = if let Some(ref g_str) = goal_opt {
        let g = match parse_fmt_width_val(g_str, width, true, unicode) {
            Ok(v) => v,
            Err(msg) => return err_out(&msg, 1),
        };
        if width_opt.is_none() {
            width = g + 10;
        }
        g
    } else {
        (width * 187) / 200
    };

    let inputs = if files.is_empty() {
        vec!["-".to_string()]
    } else {
        files
    };
    let mut out_bytes: Vec<u8> = Vec::new();
    let mut stderr = String::new();
    let mut exit_code = 0;
    let limit = fs.max_input_bytes();
    let mut received = 0usize;
    for f in &inputs {
        let describe_error = |error: &str| {
            let (code, _) = error.split_once(':').unwrap_or(("", error));
            let message = match code {
                "ENOENT" => "No such file or directory", "ENOTDIR" => "Not a directory", "EACCES" => "Permission denied",
                "ELOOP" => "Too many levels of symbolic links", "EISDIR" => "Is a directory", "EIO" => "Input/output error",
                "EBADF" => "Bad file descriptor", _ => return format!("fmt: {error}\n"),
            };
            if matches!(code, "ENOENT" | "ENOTDIR" | "EACCES" | "ELOOP") {
                format!("fmt: cannot open {} for reading: {message}\n", fmt_quote::quote(f, true, unicode))
            } else if f == "-" { format!("fmt: read error: {message}\n") }
            else { format!("fmt: error reading {}: {message}\n", fmt_quote::quote(f, true, unicode)) }
        };
        let mut reader = if f == "-" { None } else {
            match open_record_input(f, cwd, fs, false) {
                Ok(reader) => Some(reader),
                Err(e) => { stderr.push_str(&describe_error(&e)); exit_code = 1; continue; }
            }
        };
        let mut read_error = None;
        let mut formatter = FmtFormatter {
            source: Box::new(|chunk| {
                let result = if let Some(next) = &mut reader { next(chunk) } else { stdin.next_stdin_chunk(chunk) };
                if let Err(e) = result {
                    if e.starts_with("EFBIG:") { return Err("byte command input limit exceeded".into()); }
                    if e.starts_with("Execution aborted:") { return Err(e); }
                    read_error = Some(e);
                    chunk.clear();
                }
                received = received.checked_add(chunk.len()).filter(|&n| n <= limit)
                    .ok_or_else(|| fs.limit_error("maxInputBytes", limit))?;
                Ok(())
            }),
            input: Vec::new(),
            eof: false,
            pos: 0,
            out: Vec::new(),
            text: vec![0; 5000],
            used: 0,
            words: Vec::new(),
            costs: Vec::new(),
            breaks: Vec::new(),
            lengths: Vec::new(),
            width,
            goal,
            crown,
            tagged,
            split,
            uniform,
            prefix: prefix_bytes.clone(),
            leading,
            full_prefix,
            column: 0,
            next_prefix: 0,
            prefix_indent: 0,
            first_indent: 0,
            other_indent: 0,
            last_length: 0,
            out_column: 0,
            tabs: false,
        };
        if let Err(e) = formatter.run() {
            // The formatter publishes full 1024-byte blocks until successful EOF.
            out_bytes.extend_from_slice(&formatter.out[..formatter.out.len() / 1024 * 1024]);
            stderr.push_str(&format!("fmt: {e}\n"));
            exit_code = 1;
            break;
        }
        out_bytes.extend_from_slice(&formatter.out);
        drop(formatter);
        if let Some(e) = read_error { stderr.push_str(&describe_error(&e)); exit_code = 1; }
    }

    BuiltinOutcome {
        stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
        stderr,
        exit_code,
    }
}

fn build_csplit_suffix_formatter(
    suffix_opt: Option<&str>,
    digits: usize,
) -> Result<Box<dyn Fn(usize) -> String>, String> {
    let Some(format) = suffix_opt else {
        return Ok(Box::new(move |idx: usize| format!("{idx:0digits$}")));
    };
    let bytes = format.as_bytes();
    let mut before = String::new();
    let mut after = String::new();
    let mut conv: Option<(usize, Option<usize>, String, char)> = None;
    let mut offset = 0usize;
    while offset < bytes.len() {
        let ch = bytes[offset] as char;
        if ch != '%' || (offset + 1 < bytes.len() && bytes[offset + 1] == b'%') {
            if ch == '%' {
                offset += 1;
            }
            if conv.is_some() {
                after.push(ch);
            } else {
                before.push(ch);
            }
            offset += 1;
            continue;
        }
        if conv.is_some() {
            return Err("csplit: too many % conversion specifications in suffix\n".to_string());
        }
        offset += 1;
        let mut flags = String::new();
        while offset < bytes.len() && matches!(bytes[offset], b'-' | b'0' | b'\'' | b'#') {
            flags.push(bytes[offset] as char);
            offset += 1;
        }
        let mut width = 0usize;
        while offset < bytes.len() && bytes[offset].is_ascii_digit() {
            width = width
                .saturating_mul(10)
                .saturating_add((bytes[offset] - b'0') as usize);
            offset += 1;
        }
        let mut precision: Option<usize> = None;
        if offset < bytes.len() && bytes[offset] == b'.' {
            offset += 1;
            let mut p = 0usize;
            while offset < bytes.len() && bytes[offset].is_ascii_digit() {
                p = p
                    .saturating_mul(10)
                    .saturating_add((bytes[offset] - b'0') as usize);
                offset += 1;
            }
            precision = Some(p);
        }
        if offset >= bytes.len() {
            return Err("csplit: missing conversion specifier in suffix\n".to_string());
        }
        let spec_type = bytes[offset] as char;
        offset += 1;
        if !"diuoxX".contains(spec_type) {
            return Err(format!(
                "csplit: invalid conversion specifier in suffix: {spec_type}\n"
            ));
        }
        if ("diu".contains(spec_type) && flags.contains('#'))
            || (!"diu".contains(spec_type) && flags.contains('\''))
        {
            return Err("csplit: invalid flags in conversion specification\n".to_string());
        }
        conv = Some((width, precision, flags, spec_type));
    }
    let Some((width, precision, flags, spec_type)) = conv else {
        return Err("csplit: missing % conversion specification in suffix\n".to_string());
    };
    Ok(Box::new(move |index: usize| {
        let mut number = if index == 0 && precision == Some(0) {
            String::new()
        } else {
            match spec_type {
                'o' => format!("{index:o}"),
                'x' => format!("{index:x}"),
                'X' => format!("{index:X}"),
                _ => index.to_string(),
            }
        };
        let prec = precision.unwrap_or(0);
        if number.len() < prec {
            number = format!("{:0>width$}", number, width = prec);
        }
        let mut pfx = String::new();
        if flags.contains('#') {
            if spec_type == 'o' && !number.starts_with('0') {
                pfx.push('0');
            } else if (spec_type == 'x' || spec_type == 'X') && index != 0 {
                pfx.push_str(if spec_type == 'X' { "0X" } else { "0x" });
            }
        }
        if flags.contains('0') && !flags.contains('-') && precision.is_none() {
            let pad_w = width.saturating_sub(pfx.len());
            if number.len() < pad_w {
                number = format!("{:0>width$}", number, width = pad_w);
            }
        }
        let mut rendered = format!("{pfx}{number}");
        if rendered.len() < width {
            if flags.contains('-') {
                rendered = format!("{:<width$}", rendered, width = width);
            } else {
                rendered = format!("{:>width$}", rendered, width = width);
            }
        }
        format!("{before}{rendered}{after}")
    }))
}

fn parse_csplit_int(val: &str, signed: bool) -> Option<i64> {
    let trimmed = val.trim_start_matches([' ', '\t', '\n', '\r', '\x0b', '\x0c']);
    if trimmed.is_empty() {
        return None;
    }
    let (neg, rest) = if let Some(r) = trimmed.strip_prefix('-') {
        if !signed {
            return None;
        }
        (true, r)
    } else if let Some(r) = trimmed.strip_prefix('+') {
        (false, r)
    } else {
        (false, trimmed)
    };
    if rest.is_empty() || !rest.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n = rest.parse::<i64>().ok()?;
    Some(if neg { -n } else { n })
}

fn cmd_csplit(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut quiet = false;
    let mut elide = false;
    let mut keep = false;
    let mut suppress = false;
    let mut prefix = "xx".to_string();
    let mut suffix_fmt: Option<String> = None;
    let mut digits = 2usize;
    let mut operands: Vec<String> = Vec::new();
    let mut ended = false;

    let long_opts = [
        ("prefix", "f"),
        ("suffix-format", "b"),
        ("keep-files", "k"),
        ("elide-empty-files", "z"),
        ("digits", "n"),
        ("quiet", "q"),
        ("silent", "s"),
        ("suppress-matched", "suppress"),
        ("help", "help"),
        ("version", "version"),
    ];

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if ended || a == "-" || !a.starts_with('-') {
            operands.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if let Some(rest) = a.strip_prefix("--") {
            let (name, eq_val) = match rest.split_once('=') {
                Some((n, v)) => (n, Some(v)),
                None => (rest, None),
            };
            let exact = long_opts.iter().find(|&&(k, _)| k == name);
            let matches: Vec<&(&str, &str)> = long_opts
                .iter()
                .filter(|&&(k, _)| k.starts_with(name))
                .collect();
            let (sel_name, key) = if let Some(&pair) = exact {
                pair
            } else if matches.len() == 1 {
                *matches[0]
            } else {
                return err_out(
                    &format!("csplit: unrecognized option '{a}'\nTry 'csplit --help' for more information.\n"),
                    1,
                );
            };
            let val = if matches!(key, "f" | "b" | "n") {
                if let Some(v) = eq_val {
                    Some(v.to_string())
                } else if i + 1 < args.len() {
                    i += 1;
                    Some(args[i].clone())
                } else {
                    return err_out(
                        &format!("csplit: option '--{sel_name}' requires an argument\nTry 'csplit --help' for more information.\n"),
                        1,
                    );
                }
            } else {
                if eq_val.is_some() {
                    return err_out(
                        &format!("csplit: option '--{sel_name}' doesn't allow an argument\nTry 'csplit --help' for more information.\n"),
                        1,
                    );
                }
                None
            };
            match key {
                "f" => prefix = val.unwrap(),
                "b" => suffix_fmt = Some(val.unwrap()),
                "k" => keep = true,
                "z" => elide = true,
                "q" | "s" => quiet = true,
                "suppress" => suppress = true,
                "n" => {
                    let v_str = val.unwrap();
                    let Some(cnt) = parse_csplit_int(&v_str, true).filter(|&n| n >= 0) else {
                        return err_out(&format!("csplit: invalid number: '{v_str}'\n"), 1);
                    };
                    digits = cnt as usize;
                }
                "help" => return ok_out("Usage: csplit [OPTION]... FILE PATTERN...\nOptions: -f PREFIX, -b SUFFIX, -k, -z, -n DIGITS, -s, --suppress-matched\nPatterns: INTEGER, /REGEXP/[OFFSET], %REGEXP%[OFFSET], {INTEGER}, {*}\n"),
                "version" => return ok_out("csplit (virtual-bash)\n"),
                _ => {}
            }
            i += 1;
        } else {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut ci = 0usize;
            while ci < chars.len() {
                let ch = chars[ci];
                if !"fbknsqz".contains(ch) {
                    return err_out(
                        &format!("csplit: invalid option -- '{ch}'\nTry 'csplit --help' for more information.\n"),
                        1,
                    );
                }
                if "fbn".contains(ch) {
                    let inline: String = chars[ci + 1..].iter().collect();
                    let val = if !inline.is_empty() {
                        inline
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return err_out(
                            &format!("csplit: option requires an argument -- '{ch}'\nTry 'csplit --help' for more information.\n"),
                            1,
                        );
                    };
                    match ch {
                        'f' => prefix = val,
                        'b' => suffix_fmt = Some(val),
                        'n' => {
                            let Some(cnt) = parse_csplit_int(&val, true).filter(|&n| n >= 0) else {
                                return err_out(&format!("csplit: invalid number: '{val}'\n"), 1);
                            };
                            digits = cnt as usize;
                        }
                        _ => {}
                    }
                    break;
                } else {
                    match ch {
                        'k' => keep = true,
                        'z' => elide = true,
                        'q' | 's' => quiet = true,
                        _ => {}
                    }
                    ci += 1;
                }
            }
            i += 1;
        }
    }

    if operands.is_empty() {
        return err_out("csplit: missing operand\nTry 'csplit --help' for more information.\n", 1);
    }
    if operands.len() == 1 {
        return err_out(
            &format!("csplit: missing operand after '{}'\nTry 'csplit --help' for more information.\n", operands[0]),
            1,
        );
    }
    let suffix_fn = match build_csplit_suffix_formatter(suffix_fmt.as_deref(), digits) {
        Ok(f) => f,
        Err(msg) => return err_out(&msg, 1),
    };

    struct CsplitPattern {
        argument: String,
        line: Option<usize>,
        rx: Option<crate::commands::search::ZeroRegex>,
        ignore: bool,
        offset: i64,
        repeat: usize,
        forever: bool,
    }

    let mut parsed_patterns: Vec<CsplitPattern> = Vec::new();
    let mut last_line = 0usize;
    let mut stderr = String::new();
    let pat_args = &operands[1..];
    let mut pi = 0usize;
    while pi < pat_args.len() {
        let arg = &pat_args[pi];
        let mut pat = if arg.starts_with('/') || arg.starts_with('%') {
            let delim = arg.chars().next().unwrap();
            let Some(closing_rel) = arg[1..].rfind(delim) else {
                return err_out(&format!("csplit: {arg}: closing delimiter '{delim}' missing\n"), 1);
            };
            let closing = 1 + closing_rel;
            let expr = &arg[1..closing];
            let rx = crate::commands::search::ZeroRegex::new(
                vec![expr.to_string()],
                false,
                false,
                false,
                false,
            );
            let after_delim = &arg[closing + 1..];
            let offset = if after_delim.is_empty() {
                0
            } else if let Some(off) = parse_csplit_int(after_delim, true) {
                off
            } else {
                return err_out(&format!("csplit: '{arg}': integer expected after delimiter\n"), 1);
            };
            CsplitPattern {
                argument: arg.clone(),
                line: None,
                rx: Some(rx),
                ignore: delim == '%',
                offset,
                repeat: 0,
                forever: false,
            }
        } else {
            let Some(l_val) = parse_csplit_int(arg, false) else {
                return err_out(&format!("csplit: '{arg}': invalid pattern\n"), 1);
            };
            if l_val == 0 {
                return err_out(
                    &format!("csplit: {arg}: line number must be greater than zero\n"),
                    1,
                );
            }
            let l_usize = l_val as usize;
            if l_usize < last_line {
                return err_out(
                    &format!("csplit: line number '{arg}' is smaller than preceding line number, {last_line}\n"),
                    1,
                );
            }
            if l_usize == last_line {
                stderr.push_str(&format!(
                    "csplit: warning: line number '{arg}' is the same as preceding line number\n"
                ));
            }
            last_line = l_usize;
            CsplitPattern {
                argument: arg.clone(),
                line: Some(l_usize),
                rx: None,
                ignore: false,
                offset: 0,
                repeat: 0,
                forever: false,
            }
        };

        if pi + 1 < pat_args.len() && pat_args[pi + 1].starts_with('{') {
            pi += 1;
            let rep_arg = &pat_args[pi];
            if !rep_arg.ends_with('}') {
                return err_out(&format!("csplit: '{rep_arg}': '}}' is required in repeat count\n"), 1);
            }
            if rep_arg == "{*}" {
                pat.forever = true;
            } else {
                let inner = &rep_arg[1..rep_arg.len() - 1];
                let Some(cnt) = parse_csplit_int(inner, false) else {
                    return err_out(
                        &format!("csplit: '{inner}': integer required between '{{' and '}}'\n"),
                        1,
                    );
                };
                pat.repeat = cnt as usize;
            }
        }
        parsed_patterns.push(pat);
        pi += 1;
    }

    let input_file = &operands[0];
    let text = if input_file == "-" {
        stdin.to_string()
    } else {
        let path = resolve_posix_path(cwd, input_file);
        if fs.is_dir(&path) {
            return err_out("csplit: read error: Is a directory\n", 1);
        }
        match fs.read_file(&path) {
            Ok(bytes) => crate::vfs::bytes_to_stream_string(&bytes),
            Err(_) => {
                return err_out(
                    &format!("csplit: cannot open '{input_file}' for reading: No such file or directory\n"),
                    1,
                );
            }
        }
    };
    let lines: Vec<&str> = text.split_inclusive('\n').collect();

    let mut next_line = 1usize;
    let mut current_line = 0usize;
    let mut cur_piece: Vec<u8> = Vec::new();
    let mut piece_open = false;
    let mut created_files = Vec::new();
    let mut file_no = 0usize;
    let mut stdout = String::new();

    let input_path = (input_file != "-").then(|| resolve_posix_path(cwd, input_file));
    let mut finish_piece = |piece: &mut Vec<u8>, open: &mut bool| -> Result<(), String> {
        if !*open {
            return Ok(());
        }
        *open = false;
        let fname = format!("{prefix}{}", suffix_fn(file_no));
        let full = resolve_posix_path(cwd, &fname);
        let version = fs.generation();
        for (i, _) in full.match_indices('/').skip(1) {
            match fs.lstat(&full[..i]) {
                Ok(st) if st.kind == crate::vfs::VfsEntryKind::Directory => {}
                Ok(_) => return Err("csplit: unsafe output directory identity\n".into()),
                Err(_) => return Err(format!("csplit: {fname}: No such file or directory\n")),
            }
        }
        if fs.lstat(&full).is_ok_and(|st| st.kind != crate::vfs::VfsEntryKind::File) {
            return Err(format!("csplit: unsafe output file '{fname}'\n"));
        }
        let stamp=fs.observe_publication(&full,version,crate::vfs::PublicationMode::Rollback).map_err(|e|format!("csplit: {fname}: {e}\n"))?;
        let publication = fs.publish_file(&full, piece, input_path.as_slice(), stamp.version).map_err(|e| {
            match e.as_str() {
                "INVALID_VALUE: Input and output VFS identities must be distinct" =>
                    "csplit: output would overwrite the input file\n".into(),
                _ if e.starts_with("UNSUPPORTED_CAPABILITY:") =>
                    "csplit: atomic output mutations are not supported\n".into(),
                _ => format!("csplit: {fname}: {e}\n"),
            }
        })?;
        if elide && piece.is_empty() {
            return match fs.remove_published(&full, publication) {
                Ok(true) => Ok(()),
                Ok(false) => Err("csplit: output changed before empty-file removal\n".into()),
                Err(e) => Err(format!("csplit: {fname}: {e}\n")),
            };
        }
        file_no += 1;
        created_files.push((full, publication, stamp));
        if !quiet {
            stdout.push_str(&format!("{}\n", piece.len()));
        }
        piece.clear();
        Ok(())
    };

    let mut fail_msg: Option<String> = None;
    let mut forever_done = false;

    'outer: for pat in &parsed_patterns {
        let mut rep = 0usize;
        while pat.forever || rep <= pat.repeat {
            if let Some(ref rx) = pat.rx {
                if !pat.ignore {
                    piece_open = true;
                }
                loop {
                    current_line += 1;
                    if current_line > lines.len() {
                        if !pat.forever {
                            if !pat.ignore {
                                while next_line <= lines.len() {
                                    cur_piece.extend_from_slice(&crate::vfs::stream_string_to_bytes(
                                        lines[next_line - 1],
                                    ));
                                    current_line = current_line.max(next_line);
                                    next_line += 1;
                                }
                            }
                            fail_msg = Some(format!(
                                "csplit: '{}': match not found{}\n",
                                pat.argument,
                                if rep > 0 {
                                    format!(" on repetition {rep}")
                                } else {
                                    String::new()
                                }
                            ));
                            break 'outer;
                        }
                        if !pat.ignore {
                            while next_line <= lines.len() {
                                cur_piece.extend_from_slice(&crate::vfs::stream_string_to_bytes(
                                    lines[next_line - 1],
                                ));
                                current_line = current_line.max(next_line);
                                next_line += 1;
                            }
                            if let Err(err) = finish_piece(&mut cur_piece, &mut piece_open) {
                                fail_msg = Some(err);
                                break 'outer;
                            }
                        }
                        forever_done = true;
                        break 'outer;
                    }
                    let raw_l = lines[current_line - 1];
                    let subj = raw_l.strip_suffix('\n').unwrap_or(raw_l);
                    if rx.is_match(subj) {
                        break;
                    }
                    if pat.offset >= 0 && next_line <= lines.len() {
                        let rem_l = lines[next_line - 1];
                        current_line = current_line.max(next_line);
                        next_line += 1;
                        if !pat.ignore {
                            cur_piece.extend_from_slice(&crate::vfs::stream_string_to_bytes(rem_l));
                        }
                    }
                }
                let target = current_line as i64 + pat.offset;
                if next_line > lines.len() || (next_line as i64) > target {
                    fail_msg = Some(format!(
                        "csplit: '{}': line number out of range\n",
                        pat.argument
                    ));
                    break 'outer;
                }
                while (next_line as i64) < target {
                    if next_line > lines.len() {
                        fail_msg = Some(format!(
                            "csplit: '{}': line number out of range\n",
                            pat.argument
                        ));
                        break 'outer;
                    }
                    let rem_l = lines[next_line - 1];
                    current_line = current_line.max(next_line);
                    next_line += 1;
                    if !pat.ignore {
                        cur_piece.extend_from_slice(&crate::vfs::stream_string_to_bytes(rem_l));
                    }
                }
                if !pat.ignore {
                    if let Err(err) = finish_piece(&mut cur_piece, &mut piece_open) {
                        fail_msg = Some(err);
                        break 'outer;
                    }
                }
                if pat.offset > 0 {
                    current_line = target as usize;
                }
            } else if let Some(line_no) = pat.line {
                let target = line_no.saturating_mul(rep + 1);
                piece_open = true;
                if (suppress && current_line + 1 > lines.len()) || next_line > lines.len() {
                    fail_msg = Some(format!(
                        "csplit: '{line_no}': line number out of range\n"
                    ));
                    break 'outer;
                }
                while next_line < target {
                    if next_line > lines.len() {
                        fail_msg = Some(format!(
                            "csplit: '{line_no}': line number out of range\n"
                        ));
                        break 'outer;
                    }
                    let rem_l = lines[next_line - 1];
                    current_line = current_line.max(next_line);
                    next_line += 1;
                    cur_piece.extend_from_slice(&crate::vfs::stream_string_to_bytes(rem_l));
                }
                if let Err(err) = finish_piece(&mut cur_piece, &mut piece_open) {
                    fail_msg = Some(err);
                    break 'outer;
                }
                if !suppress && current_line + 1 > lines.len() {
                    fail_msg = Some(format!(
                        "csplit: '{line_no}': line number out of range\n"
                    ));
                    break 'outer;
                }
            }

            if suppress && next_line <= lines.len() {
                current_line = current_line.max(next_line);
                next_line += 1;
            }
            rep += 1;
        }
    }

    if fail_msg.is_none() && !forever_done {
        piece_open = true;
        while next_line <= lines.len() {
            cur_piece.extend_from_slice(&crate::vfs::stream_string_to_bytes(lines[next_line - 1]));
            current_line = current_line.max(next_line);
            next_line += 1;
        }
    }
    if let Err(err) = finish_piece(&mut cur_piece, &mut piece_open) {
        fail_msg = Some(err);
    }
    if let Some(err) = fail_msg {
        if !keep {
            for (path, publication, _stamp) in created_files {
                if let Err(e) = fs.remove_published(&path, publication) {
                    stderr.push_str(&format!("csplit: {path}: {e}\n"));
                }
            }
        }
        stderr.push_str(&err);
        return BuiltinOutcome { stdout, stderr, exit_code: 1 };
    }

    BuiltinOutcome {
        stdout,
        stderr,
        exit_code: 0,
    }
}

#[derive(Clone)]
struct PrOptions {
    files: Vec<String>,
    columns: usize,
    explicit_columns: bool,
    merge: bool,
    across: bool,
    length: usize,
    first_page: usize,
    last_page: usize,
    width: usize,
    header: Option<String>,
    date_format: Option<String>,
    extremities: bool,
    keep_ff: bool,
    form_feed: bool,
    numbered: bool,
    digits: usize,
    number_separator: char,
    start_number: i64,
    separator: String,
    use_separator: bool,
    truncate: bool,
    join: bool,
    double_space: bool,
    margin: usize,
    expand: bool,
    tabify: bool,
    input_tab: char,
    input_tab_width: usize,
    output_tab: char,
    output_tab_width: usize,
    control: bool,
    octal: bool,
    quiet: bool,
}

fn parse_pr_int(val: &str, min_val: i64, label: &str) -> Result<i64, String> {
    let trimmed = val.trim_start_matches([' ', '\t', '\r', '\n', '\x0b', '\x0c']);
    let rest = trimmed
        .strip_prefix('+')
        .or_else(|| trimmed.strip_prefix('-'))
        .unwrap_or(trimmed);
    if rest.is_empty() || !rest.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("pr: {label}: '{val}'\n"));
    }
    match trimmed.parse::<i64>() {
        Ok(n) if n >= min_val && n <= 2_147_483_647 => Ok(n),
        _ => Err(format!("pr: {label}: '{val}': Numerical result out of range\n")),
    }
}

fn parse_pr_pages(val: &str, opts: &mut PrOptions) -> Result<(), String> {
    if let Some((first_s, last_s)) = val.split_once(':') {
        let first = parse_pr_int(first_s, 1, "invalid page range")? as usize;
        let last = parse_pr_int(last_s, first as i64, "invalid page range")? as usize;
        opts.first_page = first;
        opts.last_page = last;
    } else {
        opts.first_page = parse_pr_int(val, 1, "invalid page range")? as usize;
        opts.last_page = 2_147_483_647;
    }
    Ok(())
}

struct PrReader<'a> {
    next: Option<crate::vfs::ChunkReader<'a>>,
    data: Vec<u8>,
    pos: usize,
    pushed: Option<i32>,
}

impl<'a> PrReader<'a> {
    fn new(next: crate::vfs::ChunkReader<'a>) -> Self {
        Self { next: Some(next), data: Vec::new(), pos: 0, pushed: None }
    }
}

fn pr_fs_reason(error: &str) -> &str {
    match error.split(':').next() {
        Some("ENAMETOOLONG") => "File name too long",
        Some("ENOTSUP") => "Operation not supported",
        Some("ENOENT" | "EACCES" | "EPERM" | "EISDIR" | "ENOTDIR" | "EIO" | "ELOOP") => file_error_reason(error),
        _ => error,
    }
}

enum PrStop {
    Header(&'static str),
    Read(String),
    Write,
}

struct PrIo<'a, 'b> {
    readers: Vec<PrReader<'a>>,
    pending: Vec<u8>,
    write: &'b mut dyn FnMut(u32, &str) -> bool,
}

impl PrIo<'_, '_> {
    fn flush(&mut self) -> Result<(), PrStop> {
        if !self.pending.is_empty() {
            let ok = (self.write)(1, &crate::vfs::bytes_to_stream_string(&self.pending));
            self.pending.clear();
            if !ok { return Err(PrStop::Write); }
        }
        Ok(())
    }

    fn row(&mut self, rendered: &mut Vec<u8>) -> Result<(), PrStop> {
        self.pending.append(rendered);
        if self.pending.len() >= 16384 { self.flush()?; }
        Ok(())
    }

    fn get(&mut self, index: usize) -> Result<i32, PrStop> {
        let r = &mut self.readers[index];
        if let Some(b) = r.pushed.take() { return Ok(b); }
        if r.pos == r.data.len() {
            if r.next.is_none() { return Ok(-1); }
            self.flush()?;
            let r = &mut self.readers[index];
            (r.next.as_mut().unwrap())(&mut r.data).map_err(PrStop::Read)?;
            r.pos = 0;
            if r.data.is_empty() { r.next = None; return Ok(-1); }
        }
        let r = &mut self.readers[index];
        let byte = r.data[r.pos];
        r.pos += 1;
        Ok(i32::from(byte))
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PrColStatus {
    Open,
    Held,
    Feed,
    Closed,
}

#[derive(Clone)]
struct PrStoredLine {
    text: String,
    end: usize,
}

struct PrColumn {
    reader_idx: usize,
    status: PrColStatus,
    full: bool,
    numbered: bool,
    start: usize,
    lines: Vec<PrStoredLine>,
    current: usize,
    remaining: usize,
}

struct PrFormatter {
    opts: PrOptions,
    body: usize,
    column_width: usize,
    number_width: usize,
    store: bool,
    columns: Vec<PrColumn>,
    line_number: i64,
    page_number: usize,
    input_position: usize,
    output_position: usize,
    spaces: usize,
    separators: usize,
    padding: usize,
    vertical: bool,
    empty: bool,
    align_empty: bool,
    feed_only: bool,
    print_feed: bool,
    need_header: bool,
    storing: bool,
    stored: String,
    rendered: Vec<u8>,
}

impl PrFormatter {
    fn new(mut opts: PrOptions, count: usize) -> Result<Self, String> {
        if opts.length <= 10 {
            opts.extremities = false;
            opts.keep_ff = true;
        }
        let body = (if opts.extremities {
            opts.length - 10
        } else {
            opts.length
        }) / (if opts.double_space { 2 } else { 1 });
        if body < 1 {
            return Err("pr: page has no text lines\n".to_string());
        }
        opts.columns = if opts.merge { count } else { opts.columns };
        if opts.columns > 1 {
            if !opts.use_separator {
                opts.use_separator = true;
                opts.separator = if opts.join {
                    "\t".to_string()
                } else {
                    " ".to_string()
                };
            } else if !opts.join && opts.separator == "\t" {
                opts.separator = " ".to_string();
            }
            opts.truncate = true;
            opts.expand = true;
            opts.tabify = true;
        }
        if opts.join {
            opts.truncate = false;
        }
        let number_width = if opts.number_separator == '\t' {
            opts.digits + 8 - (opts.digits % 8)
        } else {
            opts.digits + 1
        };
        let used_w = (if opts.merge && opts.numbered {
            number_width
        } else {
            0
        }) + (opts.columns.saturating_sub(1)) * opts.separator.len();
        if opts.width <= used_w || (opts.width - used_w) / opts.columns.max(1) < 1 {
            return Err("pr: page width too narrow\n".to_string());
        }
        let column_width = (opts.width - used_w) / opts.columns.max(1);
        let store = opts.columns > 1 && !opts.merge && !opts.across;
        let line_number = opts.start_number;
        Ok(Self {
            opts,
            body,
            column_width,
            number_width,
            store,
            columns: Vec::new(),
            line_number,
            page_number: 1,
            input_position: 0,
            output_position: 0,
            spaces: 0,
            separators: 0,
            padding: 0,
            vertical: false,
            empty: true,
            align_empty: false,
            feed_only: false,
            print_feed: false,
            need_header: false,
            storing: false,
            stored: String::new(),
            rendered: Vec::new(),
        })
    }

    fn append(&mut self, val: &str) {
        if self.page_number < self.opts.first_page {
            return;
        }
        self.rendered.extend_from_slice(val.as_bytes());
    }

    fn white(&mut self) {
        let mut position = self.output_position;
        let goal = position + self.spaces;
        while goal.saturating_sub(position) > 1 {
            let next =
                position + self.opts.output_tab_width - (position % self.opts.output_tab_width);
            if next > goal {
                break;
            }
            let tab_ch = self.opts.output_tab.to_string();
            self.append(&tab_ch);
            position = next;
        }
        if goal > position {
            let sp = " ".repeat(goal - position);
            self.append(&sp);
        }
        self.output_position = goal;
        self.spaces = 0;
    }

    fn pad(&mut self, position: usize) {
        if self.opts.tabify {
            self.spaces = position.saturating_sub(self.output_position);
        } else {
            if position > self.output_position {
                let sp = " ".repeat(position - self.output_position);
                self.append(&sp);
            }
            self.output_position = position;
        }
    }

    fn separator(&mut self) {
        if self.separators == 0 {
            if self.spaces > 0 {
                self.white();
            }
            return;
        }
        let sep_chars: Vec<char> = self.opts.separator.chars().collect();
        while self.separators > 0 {
            self.separators -= 1;
            for &ch in &sep_chars {
                if ch == ' ' {
                    self.spaces += 1;
                } else {
                    if self.spaces > 0 {
                        self.white();
                    }
                    let s = ch.to_string();
                    self.append(&s);
                    self.output_position += 1;
                }
            }
            if self.spaces > 0 {
                self.white();
            }
        }
    }

    fn character(&mut self, ch: char) {
        if self.storing {
            self.stored.push(ch);
            return;
        }
        if self.opts.tabify {
            if ch == ' ' {
                self.spaces += 1;
                return;
            }
            if self.spaces > 0 {
                self.white();
            }
            if (' '..='~').contains(&ch) {
                self.output_position += 1;
            } else if ch == '\x08' {
                self.output_position = self.output_position.saturating_sub(1);
            }
        }
        if self.page_number >= self.opts.first_page { self.rendered.push(ch as u8); }
    }

    fn number(&mut self, col_idx: usize) {
        let num_s = format!("{:>width$}", self.line_number, width = self.opts.digits);
        self.line_number += 1;
        let tail: String = num_s
            .chars()
            .rev()
            .take(self.opts.digits)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        for ch in tail.chars() {
            self.character(ch);
        }
        if self.columns.len() > 1 && self.opts.number_separator == '\t' {
            let pad_cnt = self.number_width.saturating_sub(self.opts.digits);
            for _ in 0..pad_cnt {
                self.character(' ');
            }
        } else {
            let sep = self.opts.number_separator;
            self.character(sep);
            if self.columns.len() == 1 && sep == '\t' {
                self.output_position += self.opts.output_tab_width
                    - (self.output_position % self.opts.output_tab_width);
            }
        }
        if self.opts.truncate && !self.opts.merge {
            self.input_position += self.number_width;
        }
        let _ = col_idx;
    }

    fn align(&mut self, col_idx: usize) {
        let col_start = self.columns[col_idx].start;
        let col_numbered = self.columns[col_idx].numbered;
        self.padding = col_start;
        if self.opts.separator.len() < self.padding {
            let p = self.padding - self.opts.separator.len();
            self.pad(p);
            self.padding = 0;
        }
        if self.opts.use_separator {
            self.separator();
        }
        if col_numbered {
            self.number(col_idx);
        }
    }

    fn clump(&mut self, byte: u8) -> String {
        let ch = byte as char;
        let width: isize;
        let mut text = ch.to_string();
        if ch == self.opts.input_tab || byte == 9 {
            let tab = if ch == self.opts.input_tab {
                self.opts.input_tab_width
            } else {
                8
            };
            let w = tab - (self.input_position % tab);
            width = w as isize;
            if self.opts.expand {
                text = " ".repeat(w);
            }
        } else if !(32..=126).contains(&byte) {
            if self.opts.octal || (self.opts.control && byte >= 128) {
                text = format!("\\{byte:03o}");
                width = 4;
            } else if self.opts.control {
                text = format!("^{}", (byte ^ 64) as char);
                width = 2;
            } else {
                width = if byte == 8 { -1 } else { 0 };
            }
        } else {
            width = 1;
        }
        if width < 0 && self.input_position == 0 {
            return String::new();
        }
        self.input_position = (self.input_position as isize + width).max(0) as usize;
        text
    }

    fn close_col(&mut self, col_idx: usize) {
        if self.opts.merge {
            self.columns[col_idx].status = PrColStatus::Closed;
            if self.columns[col_idx].lines.is_empty() {
                self.columns[col_idx].remaining = 0;
            }
        } else {
            for col in &mut self.columns {
                col.status = PrColStatus::Closed;
                if col.lines.is_empty() {
                    col.remaining = 0;
                }
            }
        }
    }

    fn hold_col(&mut self, col_idx: usize) {
        let new_status = if self.store {
            PrColStatus::Feed
        } else {
            PrColStatus::Held
        };
        if self.opts.merge {
            self.columns[col_idx].status = new_status;
        } else {
            for col in &mut self.columns {
                col.status = new_status;
            }
        }
        self.columns[col_idx].remaining = 0;
    }

    fn feed_col(&mut self, col_idx: usize, io: &mut PrIo<'_, '_>) -> Result<(), PrStop> {
        let r_idx = self.columns[col_idx].reader_idx;
        let next = io.get(r_idx)?;
        if next >= 0 && next != 10 { io.readers[r_idx].pushed = Some(next); }
        self.hold_col(col_idx);
        Ok(())
    }

    fn rest_col(&mut self, col_idx: usize, io: &mut PrIo<'_, '_>) -> Result<(), PrStop> {
        let r_idx = self.columns[col_idx].reader_idx;
        loop {
            let r = io.get(r_idx)?;
            if r == 10 {
                return Ok(());
            }
            if r == 12 {
                self.feed_col(col_idx, io)?;
                if self.opts.keep_ff {
                    self.print_feed = true;
                }
                return Ok(());
            }
            if r < 0 {
                self.close_col(col_idx);
                return Ok(());
            }
        }
    }

    fn header(&mut self, date: &str, name: Result<&str, &'static str>) -> Result<(), PrStop> {
        let name = name.map_err(PrStop::Header)?;
        self.output_position = 0;
        self.pad(self.opts.margin);
        self.white();
        let print_w = |s: &str| s.bytes().filter(|&b| b >= b' ' && b != 127).count();
        let page = format!("Page {}", self.page_number);
        let used = print_w(date) + print_w(name) + print_w(&page);
        let available = self.opts.width.saturating_sub(used);
        let left = available / 2;
        let hdr = format!(
            "\n\n{}{date}{}{name}{}{page}\n\n\n",
            " ".repeat(self.opts.margin),
            " ".repeat(left.max(1)),
            " ".repeat((available - left).max(1))
        );
        self.append(&hdr);
        self.need_header = false;
        self.output_position = 0;
        Ok(())
    }

    fn read_col(&mut self, col_idx: usize, io: &mut PrIo<'_, '_>, date: &str, name: Result<&str, &'static str>) -> Result<(), PrStop> {
        let r_idx = self.columns[col_idx].reader_idx;
        let mut byte = io.get(r_idx)?;
        if byte == 12 && self.columns[col_idx].full {
            byte = io.get(r_idx)?;
            if byte == 10 {
                byte = io.get(r_idx)?;
            }
        }
        self.columns[col_idx].full = false;
        if byte == 12 {
            self.feed_col(col_idx, io)?;
            self.feed_only = true;
            if self.need_header && !self.store {
                self.vertical = true;
                self.header(date, name)?;
            } else if self.opts.keep_ff {
                self.print_feed = true;
            }
            return Ok(());
        }
        if byte < 0 {
            self.close_col(col_idx);
            return Ok(());
        }
        let mut clump = if byte == 10 {
            String::new()
        } else {
            self.clump(byte as u8)
        };
        if self.opts.truncate && self.input_position > self.column_width {
            self.input_position = 0;
            self.rest_col(col_idx, io)?;
            return Ok(());
        }
        if !self.storing {
            self.vertical = true;
            if self.need_header && !self.store {
                self.header(date, name)?;
            }
            if self.opts.merge && self.align_empty {
                let pending = self.separators;
                self.separators = 0;
                for idx in 0..pending {
                    self.align(idx);
                    self.separators += 1;
                }
                self.padding = self.columns[col_idx].start;
                self.spaces = if self.opts.truncate {
                    self.column_width
                } else {
                    0
                };
                self.align_empty = false;
            }
            if self.opts.separator.len() < self.padding {
                let p = self.padding - self.opts.separator.len();
                self.pad(p);
                self.padding = 0;
            }
            if self.opts.use_separator {
                self.separator();
            }
        }
        if self.columns[col_idx].numbered {
            self.number(col_idx);
        }
        self.empty = false;
        if byte == 10 {
            return Ok(());
        }
        for ch in clump.chars() {
            self.character(ch);
        }
        loop {
            if !self.storing && self.rendered.len() >= 8192 { io.row(&mut self.rendered)?; }
            let rn = io.get(r_idx)?;
            if rn == 10 {
                return Ok(());
            }
            if rn == 12 {
                self.feed_col(col_idx, io)?;
                if self.opts.keep_ff {
                    self.print_feed = true;
                }
                return Ok(());
            }
            if rn < 0 {
                self.close_col(col_idx);
                return Ok(());
            }
            let prev = self.input_position;
            clump = self.clump(rn as u8);
            if self.opts.truncate && self.input_position > self.column_width {
                self.input_position = prev;
                self.rest_col(col_idx, io)?;
                return Ok(());
            }
            for ch in clump.chars() {
                self.character(ch);
            }
        }
    }

    fn ready(&self) -> bool {
        self.columns.iter().any(|c| {
            c.status == PrColStatus::Open
                || c.status == PrColStatus::Feed
                || (self.store && c.remaining > 0 && !c.lines.is_empty())
        })
    }

    fn stored_line(&mut self, col_idx: usize, date: &str, name: Result<&str, &'static str>) -> Result<(), PrStop> {
        self.vertical = true;
        if self.need_header {
            self.header(date, name)?;
        }
        if self.columns[col_idx].status == PrColStatus::Feed {
            for c in &mut self.columns {
                c.status = PrColStatus::Held;
            }
            if self.columns[0].remaining == 0 {
                if !self.opts.extremities {
                    self.vertical = false;
                }
                return Ok(());
            }
        }
        let cur = self.columns[col_idx].current;
        self.columns[col_idx].current += 1;
        let Some(line) = self.columns[col_idx].lines.get(cur).cloned() else {
            return Ok(());
        };
        if self.opts.separator.len() < self.padding {
            let p = self.padding - self.opts.separator.len();
            self.pad(p);
            self.padding = 0;
        }
        if self.opts.use_separator {
            self.separator();
        }
        for ch in line.text.chars() {
            self.character(ch);
        }
        if self.spaces == 0 {
            let col_start = self.columns[col_idx].start;
            self.output_position = col_start + line.end;
            if col_start.saturating_sub(self.opts.separator.len()) == self.opts.margin {
                self.output_position = self.output_position.saturating_sub(self.opts.separator.len());
            }
        }
        Ok(())
    }

    fn run(
        &mut self,
        io: &mut PrIo<'_, '_>,
        col_reader_indices: &[usize],
        date: &str,
        name: Result<&str, &'static str>,
    ) -> Result<(), PrStop> {
        let count = if self.opts.merge {
            col_reader_indices.len()
        } else {
            self.opts.columns
        };
        for idx in 0..count {
            let start = if idx == 0 {
                self.opts.margin + self.opts.separator.len()
            } else if self.opts.truncate {
                self.opts.margin
                    + idx * (self.column_width + self.opts.separator.len())
                    + if self.opts.merge && self.opts.numbered {
                        self.number_width
                    } else {
                        0
                    }
            } else {
                0
            };
            self.columns.push(PrColumn {
                reader_idx: if self.opts.merge {
                    col_reader_indices[idx]
                } else {
                    col_reader_indices.first().copied().unwrap_or(0)
                },
                status: PrColStatus::Open,
                full: false,
                numbered: self.opts.numbered && (!self.opts.merge || idx == 0),
                start,
                lines: Vec::new(),
                current: 0,
                remaining: 0,
            });
        }
        while self.page_number <= self.opts.last_page {
            if self.store {
                let mut lines: Vec<PrStoredLine> = Vec::new();
                self.storing = true;
                for col in &mut self.columns {
                    col.lines.clear();
                    col.current = 0;
                }
                for col_idx in 0..self.columns.len() {
                    for _ in 0..self.body {
                        if self.columns[col_idx].status != PrColStatus::Open {
                            break;
                        }
                        self.stored.clear();
                        self.input_position = 0;
                        self.read_col(col_idx, io, date, name)?;
                        if self.columns[col_idx].status == PrColStatus::Open
                            || !self.stored.is_empty()
                        {
                            lines.push(PrStoredLine {
                                text: self.stored.clone(),
                                end: self.input_position,
                            });
                        }
                    }
                }
                self.storing = false;
                let mut start = 0usize;
                let n_cols = self.columns.len();
                for (idx, col) in self.columns.iter_mut().enumerate() {
                    let cnt = lines.len() / n_cols + usize::from(idx < lines.len() % n_cols);
                    col.lines = lines[start..start + cnt].to_vec();
                    col.remaining = cnt;
                    start += cnt;
                }
            } else {
                let body = self.body;
                for col in &mut self.columns {
                    col.remaining = if col.status == PrColStatus::Open {
                        body
                    } else {
                        0
                    };
                }
            }
            if !self.ready() {
                break;
            }
            self.need_header = self.opts.extremities;
            let mut printed = false;
            let mut left = self.body * if self.opts.double_space { 2 } else { 1 };
            while left > 0 && self.ready() {
                self.output_position = 0;
                self.spaces = 0;
                self.separators = 0;
                self.vertical = false;
                self.align_empty = false;
                self.empty = true;
                for col_idx in 0..self.columns.len() {
                    self.input_position = 0;
                    if self.columns[col_idx].remaining > 0
                        || self.columns[col_idx].status == PrColStatus::Feed
                    {
                        self.feed_only = false;
                        self.padding = self.columns[col_idx].start;
                        if self.store {
                            self.stored_line(col_idx, date, name)?;
                        } else {
                            self.read_col(col_idx, io, date, name)?;
                        }
                        printed |= self.vertical;
                        self.columns[col_idx].remaining =
                            self.columns[col_idx].remaining.saturating_sub(1);
                        if self.columns[col_idx].remaining == 0 && !self.ready() {
                            break;
                        }
                        if self.opts.merge && self.columns[col_idx].status != PrColStatus::Open {
                            if self.empty {
                                self.align_empty = true;
                            } else if self.columns[col_idx].status == PrColStatus::Closed
                                || self.feed_only
                            {
                                self.align(col_idx);
                            }
                        }
                    } else if self.opts.merge {
                        if self.empty {
                            self.align_empty = true;
                        } else {
                            self.align(col_idx);
                        }
                    }
                    if self.opts.use_separator {
                        self.separators += 1;
                    }
                }
                if self.vertical {
                    self.append("\n");
                    left = left.saturating_sub(1);
                }
                if !self.ready() && !self.opts.extremities {
                    io.row(&mut self.rendered)?;
                    break;
                }
                if self.opts.double_space && printed {
                    self.append("\n");
                    left = left.saturating_sub(1);
                }
                io.row(&mut self.rendered)?;
            }
            if left == 0 {
                for col in &mut self.columns {
                    if col.status == PrColStatus::Open {
                        col.full = true;
                    }
                }
            }
            if printed && self.opts.extremities {
                if self.opts.form_feed {
                    self.append("\x0c");
                } else {
                    let nl = "\n".repeat(left + 5);
                    self.append(&nl);
                }
            } else if self.opts.keep_ff && self.print_feed {
                self.append("\x0c");
                self.print_feed = false;
            }
            io.row(&mut self.rendered)?;
            self.page_number += 1;
            for col in &mut self.columns {
                if col.status == PrColStatus::Held {
                    col.status = PrColStatus::Open;
                }
            }
        }
        Ok(())
    }
}

fn cmd_pr(
    args: &[String],
    mut stdin: CommandInput,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
    write: &mut super::CommandWriter,
) -> BuiltinOutcome {
    let mut opts = PrOptions {
        files: Vec::new(),
        columns: 1,
        explicit_columns: false,
        merge: false,
        across: false,
        length: 66,
        first_page: 1,
        last_page: 2_147_483_647,
        width: 72,
        header: None,
        date_format: None,
        extremities: true,
        keep_ff: false,
        form_feed: false,
        numbered: false,
        digits: 5,
        number_separator: '\t',
        start_number: 1,
        separator: String::new(),
        use_separator: false,
        truncate: false,
        join: false,
        double_space: false,
        margin: 0,
        expand: false,
        tabify: false,
        input_tab: '\t',
        input_tab_width: 8,
        output_tab: '\t',
        output_tab_width: 8,
        control: false,
        octal: false,
        quiet: false,
    };

    let long_opts = [
        ("date-format", "\0"),
        ("columns", "#"),
        ("pages", "p"),
        ("across", "a"),
        ("show-control-chars", "c"),
        ("double-space", "d"),
        ("expand-tabs", "e"),
        ("form-feed", "f"),
        ("header", "h"),
        ("output-tabs", "i"),
        ("join-lines", "J"),
        ("length", "l"),
        ("merge", "m"),
        ("number-lines", "n"),
        ("first-line-number", "N"),
        ("indent", "o"),
        ("no-file-warnings", "r"),
        ("separator", "s"),
        ("sep-string", "S"),
        ("omit-header", "t"),
        ("omit-pagination", "T"),
        ("show-nonprinting", "v"),
        ("width", "w"),
        ("page-width", "W"),
    ];

    let mut old_width = false;
    let mut old_separator = false;
    let mut old_options = false;
    let mut stop = false;
    let mut column_digits: Option<String> = None;
    let mut accumulating = false;
    let mut index = 0usize;

    while index < args.len() {
        let argument = &args[index];
        if stop {
            opts.files.push(argument.clone());
            index += 1;
            continue;
        }
        if argument == "--" {
            stop = true;
            index += 1;
            continue;
        }
        if argument == "--help" || argument == "--version" {
            return ok_out(if argument == "--help" {
                "Usage: pr [OPTION]... [FILE]...\nPaginate or columnate files for printing.\nOptions: -COLUMNS -h HEADER -l LENGTH -w WIDTH -t -n[SEP[DIGITS]] -m -s[SEP]\n  --date-format=FORMAT  format the header date\n"
            } else {
                "pr (virtual-bash)\n"
            });
        }
        if let Some(rest) = argument.strip_prefix('+')
            && rest.as_bytes().first().is_some_and(|b| b.is_ascii_digit())
        {
            accumulating = false;
            if let Err(msg) = parse_pr_pages(rest, &mut opts) {
                return err_out(&msg, 1);
            }
            index += 1;
            continue;
        }
        if !argument.starts_with('-') || argument == "-" {
            accumulating = false;
            opts.files.push(argument.clone());
            index += 1;
            continue;
        }
        let is_long = argument.starts_with("--");
        let mut switches = argument[1..].to_string();
        let mut attached: Option<String> = None;
        if is_long {
            let rest = &argument[2..];
            let (name, eq_val) = match rest.split_once('=') {
                Some((n, v)) => (n, Some(v.to_string())),
                None => (rest, None),
            };
            let exact = long_opts.iter().find(|&&(k, _)| k == name);
            let matches: Vec<&(&str, &str)> = long_opts
                .iter()
                .filter(|&&(k, _)| k.starts_with(name))
                .collect();
            if let Some(&(_, sw)) = exact {
                switches = sw.to_string();
            } else if matches.len() == 1 {
                switches = matches[0].1.to_string();
            } else if matches.len() > 1 {
                let poss: String = matches.iter().map(|&&(k, _)| format!(" '--{k}'")).collect();
                return err_out(
                    &format!(
                        "pr: option '{argument}' is ambiguous; possibilities:{poss}\nTry 'pr --help' for more information.\n"
                    ),
                    1,
                );
            } else {
                return err_out(
                    &format!(
                        "pr: unrecognized option '{argument}'\nTry 'pr --help' for more information.\n"
                    ),
                    1,
                );
            }
            attached = eq_val;
        }
        let sw_chars: Vec<char> = switches.chars().collect();
        let mut offset = 0usize;
        while offset < sw_chars.len() {
            let option = sw_chars[offset];
            if option.is_ascii_digit() {
                let mut cur = if accumulating {
                    column_digits.take().unwrap_or_default()
                } else {
                    String::new()
                };
                cur.push(option);
                column_digits = Some(cur);
                accumulating = true;
                offset += 1;
                continue;
            }
            accumulating = false;
            let required = "\0#phlwWNo".contains(option);
            let optional = "nseiS".contains(option);
            let mut value = attached.clone();
            if required || optional {
                if !is_long && offset + 1 < sw_chars.len() {
                    value = Some(sw_chars[offset + 1..].iter().collect());
                }
                if required && value.is_none() {
                    if index + 1 < args.len() {
                        index += 1;
                        value = Some(args[index].clone());
                    } else {
                        let msg = if is_long {
                            format!(
                                "pr: option '{argument}' requires an argument\nTry 'pr --help' for more information.\n"
                            )
                        } else {
                            format!(
                                "pr: option requires an argument -- '{option}'\nTry 'pr --help' for more information.\n"
                            )
                        };
                        return err_out(&msg, 1);
                    }
                }
                offset = sw_chars.len();
            } else if attached.is_some() {
                let opt_name = argument
                    .split_once('=')
                    .map(|(n, _)| n)
                    .unwrap_or(argument.as_str());
                return err_out(
                    &format!(
                        "pr: option '{opt_name}' doesn't allow an argument\nTry 'pr --help' for more information.\n"
                    ),
                    1,
                );
            } else {
                offset += 1;
            }

            match option {
                'p' => {
                    if !is_long {
                        return err_out(
                            "pr: invalid option -- 'p'\nTry 'pr --help' for more information.\n",
                            1,
                        );
                    }
                    if let Err(msg) = parse_pr_pages(&value.unwrap_or_default(), &mut opts) {
                        return err_out(&msg, 1);
                    }
                }
                '\0' => opts.date_format = value,
                '#' => {
                    let v = value.unwrap_or_default();
                    match parse_pr_int(&v, 1, "invalid number of columns") {
                        Ok(n) => {
                            opts.columns = n as usize;
                            opts.explicit_columns = true;
                            column_digits = None;
                        }
                        Err(msg) => return err_out(&msg, 1),
                    }
                }
                'h' => opts.header = value,
                'l' => {
                    let v = value.unwrap_or_default();
                    match parse_pr_int(&v, 1, "'-l PAGE_LENGTH' invalid number of lines") {
                        Ok(n) => opts.length = n as usize,
                        Err(msg) => return err_out(&msg, 1),
                    }
                }
                'w' => {
                    old_width = true;
                    old_options = true;
                    let v = value.unwrap_or_default();
                    match parse_pr_int(&v, 1, "'-w PAGE_WIDTH' invalid number of characters") {
                        Ok(n) => {
                            if !opts.truncate {
                                opts.width = n as usize;
                            }
                        }
                        Err(msg) => return err_out(&msg, 1),
                    }
                }
                'W' => {
                    old_width = false;
                    opts.truncate = true;
                    let v = value.unwrap_or_default();
                    match parse_pr_int(&v, 1, "'-W PAGE_WIDTH' invalid number of characters") {
                        Ok(n) => opts.width = n as usize,
                        Err(msg) => return err_out(&msg, 1),
                    }
                }
                'm' => opts.merge = true,
                'a' => opts.across = true,
                'b' => {}
                'd' => opts.double_space = true,
                'f' | 'F' => opts.form_feed = true,
                'J' => opts.join = true,
                'N' => {
                    let v = value.unwrap_or_default();
                    match parse_pr_int(&v, -2_147_483_648, "'-N NUMBER' invalid starting line number")
                    {
                        Ok(n) => opts.start_number = n,
                        Err(msg) => return err_out(&msg, 1),
                    }
                }
                'o' => {
                    let v = value.unwrap_or_default();
                    match parse_pr_int(&v, 0, "'-o MARGIN' invalid line offset") {
                        Ok(n) => opts.margin = n as usize,
                        Err(msg) => return err_out(&msg, 1),
                    }
                }
                'r' => opts.quiet = true,
                's' => {
                    old_options = true;
                    old_separator = true;
                    if !opts.use_separator && let Some(v) = value {
                        opts.separator = v;
                    }
                }
                'S' => {
                    old_separator = false;
                    opts.use_separator = true;
                    opts.separator = value.unwrap_or_default();
                }
                't' => {
                    opts.extremities = false;
                    opts.keep_ff = true;
                }
                'T' => {
                    opts.extremities = false;
                    opts.keep_ff = false;
                }
                'c' => opts.control = true,
                'v' => opts.octal = true,
                'n' | 'e' | 'i' => {
                    if option == 'n' {
                        opts.numbered = true;
                    }
                    if option == 'e' {
                        opts.expand = true;
                    }
                    if option == 'i' {
                        opts.tabify = true;
                    }
                    if let Some(mut v) = value
                        && !v.is_empty()
                    {
                        let mut ch_opt: Option<char> = None;
                        let first_ch = v.chars().next().unwrap();
                        if !first_ch.is_ascii_digit() {
                            ch_opt = Some(first_ch);
                            v = v[first_ch.len_utf8()..].to_string();
                        }
                        let mut cnt_opt: Option<usize> = None;
                        if !v.is_empty() {
                            match parse_pr_int(&v, 1, "invalid number") {
                                Ok(n) => cnt_opt = Some(n as usize),
                                Err(_) => {
                                    let v_trim = v.trim();
                                    let v_dig = v_trim.strip_prefix('+').unwrap_or(v_trim);
                                    let overflow = !v_dig.is_empty()
                                        && v_dig.bytes().all(|b| b.is_ascii_digit())
                                        && v_dig.parse::<i128>().is_ok_and(|num| num > 2_147_483_647);
                                    let suffix = if overflow {
                                        ": Value too large for defined data type"
                                    } else {
                                        ""
                                    };
                                    return err_out(
                                        &format!(
                                            "pr: '-{option}' extra characters or invalid number in the argument: '{v}'{suffix}\nTry 'pr --help' for more information.\n"
                                        ),
                                        1,
                                    );
                                }
                            }
                        }
                        match option {
                            'n' => {
                                if let Some(c) = ch_opt {
                                    opts.number_separator = c;
                                }
                                if let Some(cnt) = cnt_opt {
                                    opts.digits = cnt;
                                }
                            }
                            'e' => {
                                if let Some(c) = ch_opt {
                                    opts.input_tab = c;
                                }
                                if let Some(cnt) = cnt_opt {
                                    opts.input_tab_width = cnt;
                                }
                            }
                            'i' => {
                                if let Some(c) = ch_opt {
                                    opts.output_tab = c;
                                }
                                if let Some(cnt) = cnt_opt {
                                    opts.output_tab_width = cnt;
                                }
                            }
                            _ => {}
                        }
                    }
                }
                _ => {
                    return err_out(
                        &format!(
                            "pr: invalid option -- '{option}'\nTry 'pr --help' for more information.\n"
                        ),
                        1,
                    )
                }
            }
        }
        index += 1;
    }

    if let Some(cd) = column_digits {
        match parse_pr_int(&cd, 1, "invalid number of columns") {
            Ok(n) => {
                opts.columns = n as usize;
                opts.explicit_columns = true;
            }
            Err(msg) => return err_out(&msg, 1),
        }
    }
    if opts.merge && opts.explicit_columns {
        return err_out("pr: cannot specify number of columns when printing in parallel\n", 1);
    }
    if opts.merge && opts.across {
        return err_out(
            "pr: cannot specify both printing across and printing in parallel\n",
            1,
        );
    }
    if old_options {
        if old_width {
            if opts.merge || opts.explicit_columns {
                opts.truncate = true;
                if old_separator {
                    opts.use_separator = true;
                }
            } else {
                opts.join = true;
            }
        } else if !opts.use_separator && old_separator && (opts.merge || opts.explicit_columns) {
            if !opts.truncate {
                opts.join = true;
                if !opts.separator.is_empty() {
                    opts.use_separator = true;
                }
            } else {
                opts.use_separator = true;
            }
        }
    }

    let names = if opts.files.is_empty() {
        vec!["-".to_string()]
    } else {
        opts.files.clone()
    };
    if opts.files.is_empty() {
        opts.merge = false;
    }
    let groups: Vec<Vec<String>> = if opts.merge {
        vec![names]
    } else {
        names.into_iter().map(|n| vec![n]).collect()
    };

    let mut out = ok_out("");
    let mut exit_code = 0;

    let ctype = env
        .get("LC_ALL")
        .or_else(|| env.get("LC_CTYPE"))
        .or_else(|| env.get("LANG"))
        .filter(|s| !s.is_empty())
        .map(|s| s.as_str())
        .unwrap_or("C");
    let time_locale = env
        .get("LC_ALL")
        .or_else(|| env.get("LC_TIME"))
        .or_else(|| env.get("LANG"))
        .filter(|s| !s.is_empty())
        .map(|s| s.as_str())
        .unwrap_or("C");
    for loc in [ctype, time_locale] {
        if !matches!(loc, "C" | "POSIX" | "C.UTF-8" | "C.utf8") {
            return err_out(&format!("pr: unsupported locale '{loc}'\n"), 1);
        }
    }

    let mut sampled_clock = None;
    let format_pr_date = |ms: f64| -> Result<String, String> {
        if !(-8_640_000_000_000_000.0..=8_640_000_000_000_000.0).contains(&ms) {
            return Err("pr: invalid header timestamp\n".into());
        }
        let ms = ms as i64;
        let epoch_sec = ms.div_euclid(1000);
        let ns = (ms.rem_euclid(1000) * 1_000_000) as u32;
        if let Some(ref df) = opts.date_format {
            match render_date_format(df, epoch_sec, ns, 0, "UTC") {
                Ok(s) => Ok(s.strip_suffix('\n').unwrap_or(&s).to_string()),
                Err(msg) => Err(msg.replacen("date: ", "pr: ", 1)),
            }
        } else {
            let days = epoch_sec.div_euclid(86400);
            let rem = epoch_sec.rem_euclid(86400);
            let hour = (rem / 3600) as u32;
            let min = ((rem % 3600) / 60) as u32;
            let (year, month, day) = civil_from_days(days);
            if env.contains_key("POSIXLY_CORRECT") && matches!(time_locale, "C" | "POSIX") {
                let m_name = [
                    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov",
                    "Dec",
                ][(month.saturating_sub(1) as usize).min(11)];
                Ok(format!("{m_name} {day:>2} {hour:02}:{min:02} {year:04}"))
            } else {
                Ok(format!("{year:04}-{month:02}-{day:02} {hour:02}:{min:02}"))
            }
        }
    };

    let mut io = PrIo {
        readers: vec![PrReader::new(Box::new(move |chunk| stdin.next_stdin_chunk(chunk)
            .map_err(|e| format!("pr: 'standard input': {}\n", pr_fs_reason(&e)))))],
        pending: Vec::new(), write: &mut |fd, text| write(fd, text, &mut out),
    };

    for group in groups {
        let mut formatter = match PrFormatter::new(opts.clone(), group.len()) {
            Ok(f) => f,
            Err(msg) => return err_out(&msg, 1),
        };
        let mut col_reader_indices: Vec<usize> = Vec::new();
        let mut first_name = String::new();
        let mut first_mtime_ms = None;
        io.readers.truncate(1); // Repeated '-' operands share the same reader, including its buffered tail.
        for name in &group {
            if name == "-" {
                if first_name.is_empty() { first_name = name.clone(); }
                col_reader_indices.push(0);
            } else {
                let path = resolve_posix_path(cwd, name);
                let stat = match fs.stat(&path) {
                    Ok(st) => st,
                    Err(e) => {
                        exit_code = 1;
                        if !opts.quiet && !(io.write)(2, &format!("pr: {}: {}\n", fmt_quote::filename(name, false), pr_fs_reason(&e))) {
                            return out;
                        }
                        continue;
                    }
                };
                if first_name.is_empty() { first_name = name.clone(); first_mtime_ms = Some(stat.mtime_ms); }
                col_reader_indices.push(io.readers.len());
                let label = fmt_quote::filename(name, false);
                let mut next = None;
                io.readers.push(PrReader::new(Box::new(move |chunk| {
                    if stat.kind == crate::vfs::VfsEntryKind::Directory { return Err(format!("pr: {label}: Is a directory\n")); }
                    let detail = |e: String| format!("pr: {label}: {}\n", pr_fs_reason(&e));
                    let reader = match &mut next {
                        Some(reader) => reader,
                        None => next.insert(fs.open_chunks_sized(&path, std::num::NonZeroUsize::new(16384).unwrap()).map_err(detail)?),
                    };
                    reader(chunk).map_err(detail)
                })));
            }
        }
        if col_reader_indices.is_empty() {
            continue;
        }
        let date_ms = first_mtime_ms.filter(|_| !opts.merge)
            .unwrap_or_else(|| *sampled_clock.get_or_insert_with(crate::vfs::now_ms));
        let date_str = match format_pr_date(date_ms) {
            Ok(s) => s,
            Err(msg) => return err_out(&msg, 1),
        };
        let title = opts.header.clone().unwrap_or_else(|| {
            if opts.merge || first_name == "-" {
                String::new()
            } else {
                first_name
            }
        });
        let header = if !matches!(env.get("TZ").map(String::as_str), None | Some("" | "UTC" | "UTC0" | ":UTC" | "GMT" | "GMT0")) {
            Err("only UTC timezones are supported for headers")
        } else if matches!(ctype, "C.UTF-8" | "C.utf8") && !title.is_ascii() {
            Err("non-ASCII headers require the C locale")
        } else { Ok(title.as_str()) };
        match formatter.run(&mut io, &col_reader_indices, &date_str, header) {
            Ok(()) => { if io.flush().is_err() { return out; } }
            Err(PrStop::Write) => return out,
            Err(PrStop::Header(message)) => {
                if io.flush().is_ok() { (io.write)(2, &format!("pr: {message}\n")); }
                exit_code = 1;
                break;
            }
            Err(PrStop::Read(e)) => {
                if io.row(&mut formatter.rendered).is_ok() && io.flush().is_ok() {
                    (io.write)(2, &e);
                }
                exit_code = 1;
                break;
            }
        }
    }
    out.exit_code = exit_code;
    out
}

struct ParsedTabs {
    stops: Vec<usize>,
    repeat: usize,
    relative: bool,
}

impl ParsedTabs {
    fn parse(specs: &[String], cmd_name: &str) -> Result<Self, String> {
        let mut stops: Vec<usize> = Vec::new();
        let mut abs_repeat = 0usize;
        let mut rel_repeat = 0usize;
        for spec in specs {
            let mut marker: Option<char> = None;
            let entries: Vec<&str> = spec
                .split([',', ' ', '\t'])
                .filter(|s| !s.is_empty())
                .collect();
            for entry in entries {
                let mut prefix_len = 0usize;
                for ch in entry.chars() {
                    if ch == '+' || ch == '/' {
                        marker = Some(ch);
                        prefix_len += 1;
                    } else {
                        break;
                    }
                }
                let num_str = &entry[prefix_len..];
                if num_str.is_empty() {
                    continue;
                }
                if !num_str.bytes().all(|b| b.is_ascii_digit()) {
                    return Err(format!("{cmd_name}: invalid number '{num_str}'\n"));
                }
                let n = match num_str.parse::<usize>() {
                    Ok(v) => v,
                    Err(_) => return Err(format!("{cmd_name}: invalid number '{num_str}'\n")),
                };
                if marker.is_none() && n == 0 {
                    return Err(format!("{cmd_name}: invalid number '{num_str}'\n"));
                }
                match marker {
                    Some('+') => {
                        if rel_repeat != 0 {
                            return Err(format!("{cmd_name}: repeating tab stop must be last\n"));
                        }
                        rel_repeat = n;
                    }
                    Some('/') => {
                        if abs_repeat != 0 {
                            return Err(format!("{cmd_name}: repeating tab stop must be last\n"));
                        }
                        abs_repeat = n;
                    }
                    _ => {
                        if rel_repeat != 0 || abs_repeat != 0 {
                            return Err(format!("{cmd_name}: repeating tab stop must be last\n"));
                        }
                        if n <= stops.last().copied().unwrap_or(0) {
                            return Err(format!("{cmd_name}: tab stops must be ascending\n"));
                        }
                        stops.push(n);
                    }
                }
            }
        }
        if abs_repeat != 0 && rel_repeat != 0 {
            return Err(format!(
                "{cmd_name}: '/' specifier is mutually exclusive with '+'\n"
            ));
        }
        let mut repeat = if abs_repeat > 0 { abs_repeat } else { rel_repeat };
        let relative = rel_repeat > 0;
        if stops.is_empty() && repeat == 0 {
            repeat = 8;
        } else if stops.len() == 1 && repeat == 0 {
            repeat = stops.pop().unwrap_or(8);
        }
        Ok(Self {
            stops,
            repeat,
            relative,
        })
    }

    fn next_stop(&self, column: usize, fallback_plus_one: bool) -> Option<usize> {
        if let Some(&s) = self.stops.iter().find(|&&s| s > column) {
            return Some(s);
        }
        if self.repeat == 0 {
            return if fallback_plus_one {
                Some(column + 1)
            } else {
                None
            };
        }
        let origin = if self.relative {
            self.stops.last().copied().unwrap_or(0)
        } else {
            0
        };
        Some(column + self.repeat - (column.saturating_sub(origin)) % self.repeat)
    }
}

fn read_tab_inputs(
    mut files: Vec<String>, mut stdin: CommandInput, cwd: &str, fs: &dyn SafeBashFs,
    command: &str, write: &mut super::CommandWriter,
    mut convert: impl FnMut(&[u8], bool, &mut dyn FnMut(u8, usize) -> bool) -> bool,
) -> BuiltinOutcome {
    if files.is_empty() { files.push("-".into()); }
    let mut out = ok_out("");
    let mut bytes = Vec::new();
    let mut writable = true;
    for name in files.iter().map(Some).chain(std::iter::once(None)) {
        let mut consume = |chunk: &[u8]| {
            writable = convert(chunk, name.is_none(), &mut |byte, mut count| {
                while count != 0 {
                    let n = count.min(16384 - bytes.len());
                    bytes.resize(bytes.len() + n, byte);
                    count -= n;
                    if bytes.len() == 16384 {
                        if !write(1, &crate::vfs::bytes_to_stream_string(&bytes), &mut out) { return false; }
                        bytes.clear();
                    }
                }
                true
            });
            if writable && !bytes.is_empty() {
                writable = write(1, &crate::vfs::bytes_to_stream_string(&bytes), &mut out);
                bytes.clear();
            }
            writable
        };
        let read = match name.map(String::as_str) {
            None => { consume(&[]); Ok(()) }
            Some("-") => stdin.read_stdin(consume),
            Some(name) => record_input_path(name, cwd, fs, true).and_then(|(path, entry)| {
                if fs.supplies_single_chunk_input() && !entry.starts_with("/dev/") {
                    // Memory readStream retains the version opened even if stdout appends to it.
                    let data = fs.read_file(&entry).map_err(|e| stream_file_error(e, "readStream", &path))?;
                    for chunk in data.chunks(65536) { if !consume(chunk) { break; } }
                    Ok(())
                } else {
                    fs.read_chunks(&entry, &mut |chunk| Ok(consume(chunk))).map_err(|e| stream_file_error(e, "readStream", &path))
                }
            }),
        };
        if !writable { break; }
        if let Err(e) = read {
            out.exit_code = 1;
            if !write(2, &format!("{command}: {e}\n"), &mut out) { break; }
        }
    }
    out
}

fn cmd_expand(args: &[String], stdin: CommandInput, cwd: &str, fs: &dyn SafeBashFs, write: &mut super::CommandWriter) -> BuiltinOutcome {
    let mut tab_specs: Vec<String> = Vec::new();
    let mut initial_only = false;
    let mut files = Vec::new();
    let mut ended = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if ended || a == "-" || !a.starts_with('-') {
            files.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if let Some(rest) = a.strip_prefix("--") {
            let (name, eq_val) = match rest.split_once('=') {
                Some((n, v)) => (n, Some(v)),
                None => (rest, None),
            };
            if "--help".starts_with(a.as_str()) && eq_val.is_none() {
                return ok_out("Usage: expand [OPTION]... [FILE]...\n");
            }
            if "--version".starts_with(a.as_str()) && eq_val.is_none() {
                return ok_out("expand (GNU coreutils) 9.5\n");
            }
            if "initial".starts_with(name) && !name.is_empty() {
                if eq_val.is_some() {
                    return err_out("expand: option '--initial' doesn't allow an argument\n", 1);
                }
                initial_only = true;
                i += 1;
                continue;
            }
            if "tabs".starts_with(name) && !name.is_empty() {
                if let Some(v) = eq_val {
                    tab_specs.push(v.to_string());
                    i += 1;
                } else if i + 1 < args.len() {
                    tab_specs.push(args[i + 1].clone());
                    i += 2;
                } else {
                    return err_out("expand: option '--tabs' requires an argument\n", 1);
                }
                continue;
            }
            return err_out(&format!("expand: unrecognized option '{a}'\n"), 1);
        }
        let chars: Vec<char> = a[1..].chars().collect();
        let mut j = 0usize;
        let mut num_buf = String::new();
        while j < chars.len() {
            let ch = chars[j];
            if ch.is_ascii_digit() || ch == ',' || ch == '/' || ch == '+' {
                num_buf.push(ch);
                j += 1;
                continue;
            }
            if !num_buf.is_empty() {
                tab_specs.push(std::mem::take(&mut num_buf));
            }
            match ch {
                'i' => {
                    initial_only = true;
                    j += 1;
                }
                't' => {
                    let rest: String = chars[j + 1..].iter().collect();
                    if !rest.is_empty() {
                        tab_specs.push(rest);
                    } else if i + 1 < args.len() {
                        i += 1;
                        tab_specs.push(args[i].clone());
                    } else {
                        return err_out("expand: option requires an argument -- 't'\n", 1);
                    }
                    break;
                }
                _ => return err_out(&format!("expand: invalid option -- '{ch}'\n"), 1),
            }
        }
        if !num_buf.is_empty() {
            tab_specs.push(num_buf);
        }
        i += 1;
    }
    let tabs = match ParsedTabs::parse(&tab_specs, "expand") {
        Ok(t) => t,
        Err(msg) => return err_out(&msg, 1),
    };
    let mut column = 0usize;
    let mut initial = true;
    read_tab_inputs(files, stdin, cwd, fs, "expand", write, |chunk, _, emit| {
        for &b in chunk {
            if b == b'\t' && (!initial_only || initial) {
                let stop = tabs.next_stop(column, true).unwrap_or(column + 1);
                if !emit(b' ', stop - column) { return false; }
                column = stop;
            } else {
                if !emit(b, 1) { return false; }
                if b == b'\n' {
                    column = 0;
                    initial = true;
                } else {
                    column = if b == 8 {
                        column.saturating_sub(1)
                    } else {
                        column + 1
                    };
                    if b != b' ' && b != b'\t' {
                        initial = false;
                    }
                }
            }
        }
        true
    })
}

fn cmd_unexpand(args: &[String], stdin: CommandInput, cwd: &str, fs: &dyn SafeBashFs, write: &mut super::CommandWriter) -> BuiltinOutcome {
    let mut tab_specs: Vec<String> = Vec::new();
    let mut all_flag = false;
    let mut has_t = false;
    let mut first_only = false;
    let mut files = Vec::new();
    let mut ended = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if ended || a == "-" || !a.starts_with('-') {
            files.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if let Some(rest) = a.strip_prefix("--") {
            let (name, eq_val) = match rest.split_once('=') {
                Some((n, v)) => (n, Some(v)),
                None => (rest, None),
            };
            if "--help".starts_with(a.as_str()) && eq_val.is_none() {
                return ok_out("Usage: unexpand [OPTION]... [FILE]...\n");
            }
            if "--version".starts_with(a.as_str()) && eq_val.is_none() {
                return ok_out("unexpand (GNU coreutils) 9.5\n");
            }
            if "all".starts_with(name) && !name.is_empty() {
                if eq_val.is_some() {
                    return err_out("unexpand: option '--all' doesn't allow an argument\n", 1);
                }
                all_flag = true;
                i += 1;
                continue;
            }
            if "first-only".starts_with(name) && !name.is_empty() {
                if eq_val.is_some() {
                    return err_out(
                        "unexpand: option '--first-only' doesn't allow an argument\n",
                        1,
                    );
                }
                first_only = true;
                i += 1;
                continue;
            }
            if "tabs".starts_with(name) && !name.is_empty() {
                has_t = true;
                if let Some(v) = eq_val {
                    tab_specs.push(v.to_string());
                    i += 1;
                } else if i + 1 < args.len() {
                    tab_specs.push(args[i + 1].clone());
                    i += 2;
                } else {
                    return err_out("unexpand: option '--tabs' requires an argument\n", 1);
                }
                continue;
            }
            return err_out(&format!("unexpand: unrecognized option '{a}'\n"), 1);
        }
        let chars: Vec<char> = a[1..].chars().collect();
        let mut j = 0usize;
        let mut num_buf = String::new();
        while j < chars.len() {
            let ch = chars[j];
            if ch.is_ascii_digit() || ch == ',' || ch == '/' || ch == '+' {
                num_buf.push(ch);
                has_t = true;
                j += 1;
                continue;
            }
            if !num_buf.is_empty() {
                tab_specs.push(std::mem::take(&mut num_buf));
            }
            match ch {
                'a' => {
                    all_flag = true;
                    j += 1;
                }
                't' => {
                    has_t = true;
                    let rest: String = chars[j + 1..].iter().collect();
                    if !rest.is_empty() {
                        tab_specs.push(rest);
                    } else if i + 1 < args.len() {
                        i += 1;
                        tab_specs.push(args[i].clone());
                    } else {
                        return err_out("unexpand: option requires an argument -- 't'\n", 1);
                    }
                    break;
                }
                _ => return err_out(&format!("unexpand: invalid option -- '{ch}'\n"), 1),
            }
        }
        if !num_buf.is_empty() {
            tab_specs.push(num_buf);
        }
        i += 1;
    }
    let tabs = match ParsedTabs::parse(&tab_specs, "unexpand") {
        Ok(t) => t,
        Err(msg) => return err_out(&msg, 1),
    };
    let all = !first_only && (all_flag || has_t);
    let mut column = 0usize;
    let mut initial = true;
    let mut active = true;
    let mut pending_start = 0usize;
    let mut pending_count = 0usize;
    let mut pending_tab = false;

    read_tab_inputs(files, stdin, cwd, fs, "unexpand", write, |chunk, eof, emit| {
        let flush_blanks = |column, initial, pending_start, pending_count: &mut usize, pending_tab: &mut bool, emit: &mut dyn FnMut(u8, usize) -> bool| {
            let convert_single = initial || *pending_count > 1 || *pending_tab;
            let mut pos = pending_start;
            while *pending_count != 0 && pos < column {
                if let Some(stop) = tabs.next_stop(pos, false)
                    && stop <= column && (stop - pos > 1 || convert_single)
                {
                    if !emit(b'\t', 1) { return false; }
                    pos = stop;
                } else {
                    if !emit(b' ', 1) { return false; }
                    pos += 1;
                }
            }
            *pending_count = 0;
            *pending_tab = false;
            true
        };
        for &b in chunk {
            if active && (b == b' ' || b == b'\t') {
                if let Some(stop) = tabs.next_stop(column, false) {
                    if pending_count == 0 {
                        pending_start = column;
                    }
                    pending_count += 1;
                    if b == b'\t' {
                        pending_tab = true;
                        column = stop;
                    } else {
                        column += 1;
                    }
                    continue;
                }
                if !flush_blanks(column, initial, pending_start, &mut pending_count, &mut pending_tab, emit) { return false; }
                active = false;
            } else if pending_count > 0 {
                if !flush_blanks(column, initial, pending_start, &mut pending_count, &mut pending_tab, emit) { return false; }
            }
            if !emit(b, 1) { return false; }
            if b == b'\n' {
                column = 0;
                initial = true;
                active = true;
            } else if active {
                column = if b == 8 {
                    column.saturating_sub(1)
                } else {
                    column + 1
                };
                initial = false;
                if !all {
                    active = false;
                }
            }
        }
        !eof || flush_blanks(column, initial, pending_start, &mut pending_count, &mut pending_tab, emit)
    })
}

#[derive(Clone)]
struct ColDef {
    name: String,
    named: bool,
    flags: Vec<String>,
}

#[derive(Clone)]
struct ColOptions {
    table: bool,
    json: bool,
    names: Vec<String>,
    table_name: String,
    across: bool,
    separator: Option<BTreeSet<char>>,
    output_separator: String,
    width: usize,
    files: Vec<String>,
    help: bool,
    no_headings: bool,
    keep_empty: bool,
    maxout: bool,
    header_repeat: bool,
    column_limit: usize,
    order: String,
    hide_sel: String,
    right_sel: String,
    truncate_sel: String,
    wrap_sel: String,
    noextreme_sel: String,
    definitions: Vec<ColDef>,
}

#[derive(Clone)]
struct ColCell {
    text: String,
    width: usize,
}

fn col_whitespace(ch: char) -> bool {
    matches!(ch, ' ' | '\t' | '\r' | '\x0b' | '\x0c')
}

fn col_width_of(point: u32) -> usize {
    if (0x0300..=0x036f).contains(&point)
        || (0x1ab0..=0x1aff).contains(&point)
        || (0x1dc0..=0x1dff).contains(&point)
        || (0x20d0..=0x20ff).contains(&point)
        || (0xfe00..=0xfe0f).contains(&point)
        || (0xfe20..=0xfe2f).contains(&point)
        || (0xe0100..=0xe01ef).contains(&point)
        || (0x200b..=0x200f).contains(&point)
        || (0x2060..=0x206f).contains(&point)
        || point == 0xfeff
    {
        return 0;
    }
    if (0x1100..=0x115f).contains(&point)
        || point == 0x2329
        || point == 0x232a
        || (0x2e80..=0xa4cf).contains(&point)
        || (0xac00..=0xd7a3).contains(&point)
        || (0xf900..=0xfaff).contains(&point)
        || (0xfe10..=0xfe19).contains(&point)
        || (0xfe30..=0xfe6f).contains(&point)
        || (0xff01..=0xff60).contains(&point)
        || (0xffe0..=0xffe6).contains(&point)
        || (0x1f300..=0x1faff).contains(&point)
        || (0x20000..=0x3fffd).contains(&point)
    {
        return 2;
    }
    1
}

fn col_cell(text: &str) -> ColCell {
    let mut width = 0usize;
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        if ch == '\t' {
            let size = 8 - (width % 8);
            width += size;
            for _ in 0..size {
                out.push(' ');
            }
        } else {
            width += col_width_of(ch as u32);
            out.push(ch);
        }
    }
    ColCell { text: out, width }
}

fn col_fields(
    text: &str,
    separator: Option<&BTreeSet<char>>,
    column_limit: usize,
) -> Vec<String> {
    let mut result = Vec::new();
    let mut start = 0usize;
    for (offset, ch) in text.char_indices() {
        if column_limit > 0
            && result.len() + 1 == column_limit
            && (separator.is_some() || !col_whitespace(ch))
        {
            result.push(text[offset..].to_string());
            return result;
        }
        let is_sep = match separator {
            Some(set) => set.contains(&ch),
            None => col_whitespace(ch),
        };
        if is_sep {
            if separator.is_some() || offset > start {
                result.push(text[start..offset].to_string());
            }
            start = offset + ch.len_utf8();
        }
    }
    if separator.is_some() || text.len() > start {
        result.push(text[start..].to_string());
    }
    result
}

fn col_json_quote(s: &str) -> String {
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
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn col_selected(
    list: &str,
    count: usize,
    names: &[String],
    flags: Option<&[BTreeSet<String>]>,
    named: Option<&[bool]>,
    groups: bool,
) -> Result<Vec<usize>, String> {
    if list.is_empty() {
        return Ok(Vec::new());
    }
    if groups && list == "0" {
        return Ok((0..count).collect());
    }
    let mut name_indices: BTreeMap<String, usize> = BTreeMap::new();
    for (idx, n) in names.iter().enumerate() {
        name_indices.entry(n.clone()).or_insert(idx);
    }
    let mut last_visible = count as isize - 1;
    while last_visible >= 0 {
        if let Some(fl) = flags
            && fl[last_visible as usize].contains("hide")
        {
            last_visible -= 1;
        } else {
            break;
        }
    }
    let resolve = |val: &str| -> Result<usize, String> {
        let idx: isize = if val == "-1" {
            last_visible
        } else if !val.is_empty() && val.chars().all(|c| c.is_ascii_digit()) {
            val.parse::<isize>().unwrap_or(0) - 1
        } else {
            name_indices
                .get(val)
                .map(|&i| i as isize)
                .or_else(|| {
                    names
                        .iter()
                        .position(|n| n.eq_ignore_ascii_case(val))
                        .map(|i| i as isize)
                })
                .unwrap_or(-1)
        };
        if idx < 0 || (idx as usize) >= count {
            return Err(format!("column: EINVAL: undefined column name '{val}'\n"));
        }
        Ok(idx as usize)
    };
    let mut result: Vec<usize> = Vec::new();
    let mut push_unique = |i: usize| {
        if !result.contains(&i) {
            result.push(i);
        }
    };
    for val in list.split(',') {
        if groups && val == "-" {
            for idx in 0..count {
                let is_named = named
                    .and_then(|nm| nm.get(idx).copied())
                    .unwrap_or(idx < names.len());
                if !is_named {
                    push_unique(idx);
                }
            }
        } else {
            let dash = val.get(1..).and_then(|r| r.find('-')).map(|p| p + 1);
            if groups
                && let Some(d) = dash
                && !val[..d].is_empty()
                && !val[d + 1..].is_empty()
                && val[..d].chars().all(|c| c.is_ascii_digit())
                && val[d + 1..].chars().all(|c| c.is_ascii_digit())
            {
                let first = resolve(&val[..d])?;
                let last = resolve(&val[d + 1..])?;
                for idx in first..=last {
                    push_unique(idx);
                }
            } else {
                push_unique(resolve(val)?);
            }
        }
    }
    Ok(result)
}

fn col_fragments(
    entry: Option<&ColCell>,
    width: usize,
    wrap: bool,
    truncate: bool,
) -> Vec<ColCell> {
    let Some(entry) = entry else {
        return Vec::new();
    };
    if entry.width <= width || (!wrap && !truncate) {
        return vec![entry.clone()];
    }
    let mut result = Vec::new();
    let mut start = 0usize;
    let mut offset = 0usize;
    let mut used = 0usize;
    for ch in entry.text.chars() {
        let size = col_width_of(ch as u32);
        if used + size > width && offset > start {
            result.push(ColCell {
                text: entry.text[start..offset].to_string(),
                width: used,
            });
            if truncate {
                return result;
            }
            start = offset;
            used = 0;
        }
        if truncate && used + size > width {
            break;
        }
        used += size;
        offset += ch.len_utf8();
    }
    if offset > start {
        result.push(ColCell {
            text: entry.text[start..offset].to_string(),
            width: used,
        });
    }
    result
}

fn col_fit_widths(
    rows: &[Vec<ColCell>],
    columns: &[usize],
    widths: &mut [usize],
    minimum: &[usize],
    flags: &mut [BTreeSet<String>],
    opts: &ColOptions,
) {
    let sep_w = col_cell(&opts.output_separator).width;
    let mut total = sep_w * columns.len().saturating_sub(1);
    #[derive(Clone, Copy)]
    struct Stat {
        average: f64,
        deviation: f64,
        maximum: usize,
    }
    let mut stats: BTreeMap<usize, Stat> = BTreeMap::new();
    for &idx in columns {
        total += widths[idx];
        let mut sum = 0usize;
        let mut maximum = 0usize;
        for row in rows {
            let w = row.get(idx).map_or(0, |c| c.width);
            sum += w;
            maximum = maximum.max(w);
        }
        let average = if rows.is_empty() {
            0.0
        } else {
            (sum / rows.len()) as f64
        };
        let mut sq_sum = 0.0f64;
        for row in rows {
            let w = row.get(idx).map_or(0, |c| c.width) as f64;
            sq_sum += (w - average) * (w - average);
        }
        let deviation = if rows.len() > 1 {
            (sq_sum / ((rows.len() - 1) as f64)).sqrt()
        } else {
            0.0
        };
        stats.insert(
            idx,
            Stat {
                average,
                deviation,
                maximum,
            },
        );
    }
    let mut sorted = columns.to_vec();
    sorted.sort_by(|&first, &second| {
        let a = stats[&first];
        let b = stats[&second];
        let sa = a.average + 3.0 * a.deviation;
        let sb = b.average + 3.0 * b.deviation;
        sa.partial_cmp(&sb).unwrap_or(std::cmp::Ordering::Equal)
    });
    sorted.reverse();
    let mut minima = minimum.to_vec();
    if opts.maxout {
        let mut min_total: usize = columns
            .iter()
            .map(|&i| minima[i])
            .sum::<usize>()
            + sep_w * columns.len().saturating_sub(1);
        for &idx in columns {
            if min_total > opts.width && minima[idx] > 0 {
                minima[idx] -= 1;
                min_total -= 1;
            }
        }
    }
    let mut stage = 0usize;
    while total > opts.width && stage <= 6 {
        let before = total;
        for (position, &idx) in sorted.iter().enumerate() {
            if total <= opts.width {
                break;
            }
            let width = widths[idx];
            let min = minima[idx];
            if width == 0 || width <= min {
                continue;
            }
            let stat = stats[&idx];
            let extreme = flags[idx].contains("noextreme");
            let trunc = flags[idx].contains("truncate") || flags[idx].contains("wrap");
            if stage == 0 && (position != 0 || (!trunc && !extreme)) {
                continue;
            }
            if stage == 1 && (!extreme || stat.deviation < stat.average / 2.0) {
                continue;
            }
            if stage == 2 && !extreme {
                continue;
            }
            if stage <= 2 && stat.deviation < 1.0 {
                continue;
            }
            if stage == 3 || stage == 4 {
                continue;
            }
            if stage == 5 && (!(trunc || extreme) || stat.deviation < stat.average / 2.2) {
                continue;
            }
            if stage == 6 && !trunc && !extreme {
                continue;
            }
            let stat_target = (stat.average + stat.deviation).floor() as usize;
            let reduction = if stage <= 2 {
                (total - opts.width).min(width.saturating_sub(min.max(stat_target)))
            } else {
                (width - min).min(if position == 0 { 3 } else { 1 })
            };
            let amount = if stage <= 2 && stat_target > width {
                width.min(total - opts.width)
            } else {
                reduction
            };
            widths[idx] = width - amount;
            if amount > 0 && widths[idx] == 0 {
                flags[idx].insert("hide".to_string());
            }
            total -= amount;
        }
        if total == before {
            stage += 1;
        }
    }
    if total < opts.width {
        for &idx in &sorted {
            if !flags[idx].contains("noextreme") || widths[idx] == 0 {
                continue;
            }
            let maximum = stats[&idx].maximum as isize;
            let cur_w = widths[idx] as isize;
            let rem_w = (opts.width - total) as isize;
            let add = if maximum > 0 {
                rem_w.min(maximum - cur_w)
            } else {
                rem_w
            };
            widths[idx] = (cur_w + add).max(0) as usize;
            total = (total as isize + add).max(0) as usize;
            if total == opts.width {
                break;
            }
        }
        if opts.maxout && total < opts.width && !sorted.is_empty() {
            let extra = opts.width - total;
            let each = extra / sorted.len();
            let rem = extra % sorted.len();
            for (pos, &idx) in sorted.iter().enumerate() {
                widths[idx] += each + usize::from(pos < rem);
            }
        } else if total < opts.width
            && let Some(&last) = columns.last()
            && !flags[last].contains("right")
        {
            widths[last] += opts.width - total;
        }
    }
}

fn col_table_output(rows: &[Vec<ColCell>], widths: &[usize], separator: &str) -> String {
    let mut out = String::new();
    if rows.is_empty() || widths.is_empty() {
        return out;
    }
    let last = widths.len() - 1;
    let sep_len = separator.len();
    let mut sizes = vec![0usize; widths.len()];
    let mut next = vec![last; widths.len()];
    for idx in (0..last).rev() {
        let size = widths[idx] + sep_len;
        sizes[idx] = size + sizes[idx + 1];
        next[idx] = if size > 0 { idx } else { next[idx + 1] };
    }
    for row in rows {
        for (idx, entry) in row.iter().enumerate() {
            out.push_str(&entry.text);
            if idx + 1 < row.len() {
                let pad = widths[idx].saturating_sub(entry.width);
                if pad > 0 {
                    out.push_str(&" ".repeat(pad));
                }
                out.push_str(separator);
            }
        }
        let start = row.len();
        if start <= last {
            let gap = if start > 0 {
                widths[start - 1].saturating_sub(row[start - 1].width)
            } else {
                0
            };
            let size = if start > 0 {
                gap + sep_len + sizes[start]
            } else {
                sizes[0]
            };
            if size > 0 {
                if start > 0 {
                    if gap > 0 {
                        out.push_str(&" ".repeat(gap));
                    }
                    out.push_str(separator);
                }
                let mut idx = next[start];
                while idx < last {
                    if widths[idx] > 0 {
                        out.push_str(&" ".repeat(widths[idx]));
                    }
                    out.push_str(separator);
                    idx = next[idx + 1];
                }
            }
        }
        out.push('\n');
    }
    out
}

fn col_configured_table(
    rows: &[Vec<ColCell>],
    natural_widths: &[usize],
    opts: &ColOptions,
) -> Result<String, String> {
    if rows.is_empty() {
        return Ok(String::new());
    }
    let count = natural_widths.len().max(opts.names.len());
    let mut flags: Vec<BTreeSet<String>> = vec![BTreeSet::new(); count];
    let named: Vec<bool> = (0..count)
        .map(|idx| {
            if !opts.definitions.is_empty() {
                opts.definitions.get(idx).is_some_and(|d| d.named)
            } else {
                idx < opts.names.len()
            }
        })
        .collect();
    for (idx, def) in opts.definitions.iter().enumerate() {
        if idx < count {
            for fl in &def.flags {
                flags[idx].insert(if fl == "trunc" {
                    "truncate".to_string()
                } else {
                    fl.clone()
                });
            }
        }
    }
    for (flag_name, sel_str) in [
        ("hide", opts.hide_sel.as_str()),
        ("right", opts.right_sel.as_str()),
        ("truncate", opts.truncate_sel.as_str()),
        ("wrap", opts.wrap_sel.as_str()),
        ("noextreme", opts.noextreme_sel.as_str()),
    ] {
        let indices = col_selected(sel_str, count, &opts.names, Some(&flags), Some(&named), true)?;
        for idx in indices {
            flags[idx].insert(flag_name.to_string());
        }
    }
    if opts.noextreme_sel.is_empty() {
        for idx in (0..count).rev() {
            if !flags[idx].contains("hide") {
                flags[idx].insert("noextreme".to_string());
                break;
            }
        }
    }
    let mut ordered = col_selected(
        &opts.order,
        count,
        &opts.names,
        Some(&flags),
        Some(&named),
        false,
    )?;
    for idx in 0..count {
        if !ordered.contains(&idx) {
            ordered.push(idx);
        }
    }
    let mut columns: Vec<usize> = ordered
        .into_iter()
        .filter(|&idx| !flags[idx].contains("hide"))
        .collect();

    if opts.json {
        let lower = |s: &str| s.to_ascii_lowercase();
        let keys: Vec<String> = columns
            .iter()
            .map(|&idx| {
                col_json_quote(&lower(
                    opts.names.get(idx).map(|s| s.as_str()).unwrap_or(""),
                ))
            })
            .collect();
        let mut out = format!("{{\n   {}: [\n", col_json_quote(&lower(&opts.table_name)));
        for (row_idx, row) in rows.iter().enumerate() {
            out.push_str(if row_idx > 0 { "{\n" } else { "      {\n" });
            if keys.is_empty() {
                out.push('\n');
            }
            for (k_idx, key) in keys.iter().enumerate() {
                let col_idx = columns[k_idx];
                let val = match row.get(col_idx) {
                    Some(entry) if !entry.text.is_empty() => col_json_quote(&entry.text),
                    _ => "null".to_string(),
                };
                let comma = if k_idx + 1 < keys.len() { "," } else { "" };
                out.push_str(&format!("         {key}: {val}{comma}\n"));
            }
            let suffix = if row_idx + 1 < rows.len() { "," } else { "\n" };
            out.push_str(&format!("      }}{suffix}"));
        }
        out.push_str(&format!(
            "{}   ]\n}}\n",
            if rows.is_empty() { "\n" } else { "" }
        ));
        return Ok(out);
    }

    if columns.is_empty() {
        let mut out = String::new();
        if !opts.names.is_empty() && !opts.no_headings {
            out.push('\n');
        }
        for _ in 0..rows.len() {
            out.push('\n');
        }
        return Ok(out);
    }

    let mut headings: Vec<ColCell> = Vec::new();
    let mut widths: Vec<usize> = (0..count)
        .map(|i| natural_widths.get(i).copied().unwrap_or(0))
        .collect();
    let mut minimum: Vec<usize> = (0..count)
        .map(|i| {
            if natural_widths.get(i).copied().unwrap_or(0) > 0 {
                1
            } else {
                0
            }
        })
        .collect();
    for (idx, name) in opts.names.iter().enumerate() {
        let heading = col_cell(name);
        if idx < count {
            if !flags[idx].contains("strictwidth") {
                widths[idx] = widths[idx].max(heading.width);
            }
            minimum[idx] = 1.max(heading.width);
        }
        headings.push(heading);
    }

    let simple = opts.order.is_empty()
        && !opts.maxout
        && !opts.header_repeat
        && opts.hide_sel.is_empty()
        && opts.right_sel.is_empty()
        && opts.truncate_sel.is_empty()
        && opts.wrap_sel.is_empty()
        && opts.noextreme_sel.is_empty()
        && !opts.definitions.iter().any(|d| !d.flags.is_empty());
    if simple {
        if opts.no_headings || headings.is_empty() {
            return Ok(col_table_output(rows, &widths, &opts.output_separator));
        }
        let mut all_rows = Vec::with_capacity(rows.len() + 1);
        all_rows.push(headings);
        all_rows.extend_from_slice(rows);
        return Ok(col_table_output(&all_rows, &widths, &opts.output_separator));
    }

    col_fit_widths(rows, &columns, &mut widths, &minimum, &mut flags, opts);
    columns.retain(|&idx| !flags[idx].contains("hide"));
    let sep_w = col_cell(&opts.output_separator).width;
    let mut out = String::new();
    let mut lines = 0usize;
    let mut next_header;

    let mut emit_row = |row: &[ColCell], is_heading: bool, lines: &mut usize| {
        let mut pieces: Vec<Vec<ColCell>> = Vec::with_capacity(columns.len());
        let mut height = 1usize;
        for &idx in &columns {
            let wrap = flags[idx].contains("wrap");
            let parts = col_fragments(
                row.get(idx),
                widths[idx],
                wrap && !is_heading,
                flags[idx].contains("truncate") || (wrap && is_heading),
            );
            height = height.max(parts.len());
            pieces.push(parts);
        }
        for line_idx in 0..height {
            let mut indent = 0usize;
            for (pos, &idx) in columns.iter().enumerate() {
                let entry = pieces[pos].get(line_idx);
                let width = widths.get(idx).copied().unwrap_or(0);
                let right = flags[idx].contains("right");
                let last = pos + 1 == columns.len();
                let entry_w = entry.map_or(0, |e| e.width);
                let has_text = entry.is_some_and(|e| !e.text.is_empty());
                let gap = width.saturating_sub(entry_w);
                if right && has_text && gap > 0 {
                    out.push_str(&" ".repeat(gap));
                }
                if let Some(e) = entry {
                    out.push_str(&e.text);
                }
                if !last || opts.maxout {
                    if (!right || !has_text) && gap > 0 {
                        out.push_str(&" ".repeat(gap));
                    }
                    if !right && entry_w > width {
                        out.push('\n');
                        *lines += 1;
                        let pad = indent + width + if last { 0 } else { sep_w };
                        if pad > 0 {
                            out.push_str(&" ".repeat(pad));
                        }
                    } else if !last {
                        out.push_str(&opts.output_separator);
                    }
                }
                indent += width + sep_w;
            }
            out.push('\n');
            *lines += 1;
        }
    };

    if !headings.is_empty() && !opts.no_headings {
        emit_row(&headings, true, &mut lines);
        next_header = lines + 24;
    } else {
        next_header = 24;
    }
    for (idx, row) in rows.iter().enumerate() {
        emit_row(row, false, &mut lines);
        if opts.header_repeat
            && !headings.is_empty()
            && !opts.no_headings
            && idx + 1 < rows.len()
            && lines >= next_header
        {
            emit_row(&headings, true, &mut lines);
            next_header = lines + 24;
        }
    }
    Ok(out)
}

fn col_fill_output(rows: &[Vec<ColCell>], opts: &ColOptions) -> String {
    let mut out = String::new();
    if rows.is_empty() {
        return out;
    }
    let maximum = rows.iter().map(|r| r[0].width).max().unwrap_or(0);
    let stride = (maximum / 8 + 1) * 8;
    let columns = (opts.width / stride).min(rows.len()).max(1);
    let height = rows.len().div_ceil(columns);
    for row_idx in 0..height {
        for col_idx in 0..columns {
            let index = if opts.across {
                row_idx * columns + col_idx
            } else {
                col_idx * height + row_idx
            };
            if index >= rows.len() {
                break;
            }
            let entry = &rows[index][0];
            out.push_str(&entry.text);
            let next = if opts.across {
                index + 1
            } else {
                index + height
            };
            if col_idx + 1 < columns && next < rows.len() {
                let tabs = (stride / 8).saturating_sub(entry.width / 8);
                for _ in 0..tabs {
                    out.push('\t');
                }
            }
        }
        out.push('\n');
    }
    out
}

fn cmd_column(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut opts = ColOptions {
        table: false,
        json: false,
        names: Vec::new(),
        table_name: "table".to_string(),
        across: false,
        separator: None,
        output_separator: "  ".to_string(),
        width: 80,
        files: Vec::new(),
        help: false,
        no_headings: false,
        keep_empty: false,
        maxout: false,
        header_repeat: false,
        column_limit: 0,
        order: String::new(),
        hide_sel: String::new(),
        right_sel: String::new(),
        truncate_sel: String::new(),
        wrap_sel: String::new(),
        noextreme_sel: String::new(),
        definitions: Vec::new(),
    };
    let mut output_set = false;
    let mut literal = false;

    let set_value = |opts: &mut ColOptions,
                     output_set: &mut bool,
                     option: &str,
                     value: String|
     -> Result<(), String> {
        match option {
            "s" => {
                if value.is_empty() {
                    return Err("column: EINVAL: input separator must not be empty\n".to_string());
                }
                opts.separator = Some(value.chars().collect());
            }
            "o" => {
                opts.output_separator = value;
                *output_set = true;
            }
            "N" => {
                let names: Vec<String> = value.split(',').map(String::from).collect();
                if names.iter().any(|n| n.is_empty() || n.contains('\0')) {
                    return Err(
                        "column: EINVAL: column names must be nonempty and contain no NUL\n".to_string(),
                    );
                }
                opts.names = names;
            }
            "n" => {
                if value.is_empty() || value.contains('\0') {
                    return Err(
                        "column: EINVAL: table name must be nonempty and contain no NUL\n".to_string(),
                    );
                }
                opts.table_name = value;
            }
            "O" => {
                if opts.order.is_empty() {
                    opts.order = value;
                } else {
                    opts.order.push(',');
                    opts.order.push_str(&value);
                }
            }
            "H" => {
                if opts.hide_sel.is_empty() {
                    opts.hide_sel = value;
                } else {
                    opts.hide_sel.push(',');
                    opts.hide_sel.push_str(&value);
                }
            }
            "R" => {
                if opts.right_sel.is_empty() {
                    opts.right_sel = value;
                } else {
                    opts.right_sel.push(',');
                    opts.right_sel.push_str(&value);
                }
            }
            "T" => {
                if opts.truncate_sel.is_empty() {
                    opts.truncate_sel = value;
                } else {
                    opts.truncate_sel.push(',');
                    opts.truncate_sel.push_str(&value);
                }
            }
            "W" => {
                if opts.wrap_sel.is_empty() {
                    opts.wrap_sel = value;
                } else {
                    opts.wrap_sel.push(',');
                    opts.wrap_sel.push_str(&value);
                }
            }
            "E" => {
                if opts.noextreme_sel.is_empty() {
                    opts.noextreme_sel = value;
                } else {
                    opts.noextreme_sel.push(',');
                    opts.noextreme_sel.push_str(&value);
                }
            }
            "l" => {
                if value.is_empty() || !value.chars().all(|c| c.is_ascii_digit()) {
                    return Err("column: EINVAL: invalid columns limit\n".to_string());
                }
                let n = value.parse::<usize>().unwrap_or(0);
                if n < 1 {
                    return Err("column: EINVAL: invalid columns limit\n".to_string());
                }
                opts.column_limit = n;
            }
            "C" => {
                let mut name = String::new();
                let mut named = false;
                let mut flags = Vec::new();
                for prop in value.split(',') {
                    if let Some(rest) = prop.strip_prefix("name=") {
                        name = rest.to_string();
                        named = true;
                    } else if prop == "hidden" {
                        flags.push("hide".to_string());
                    } else if prop == "hide" {
                        continue;
                    } else if matches!(prop, "noextreme" | "noextremes" | "strictwidth") {
                        flags.push("strictwidth".to_string());
                    } else if matches!(prop, "right" | "trunc" | "wrap") {
                        flags.push(prop.to_string());
                    } else {
                        return Err(format!("column: EINVAL: unsupported column property: {prop}\n"));
                    }
                }
                opts.definitions.push(ColDef { name, named, flags });
            }
            _ => {
                if value.is_empty() || !value.chars().all(|c| c.is_ascii_digit()) {
                    return Err("column: EINVAL: invalid output width\n".to_string());
                }
                let w = value.parse::<usize>().unwrap_or(0);
                if w < 1 {
                    return Err("column: EINVAL: invalid output width\n".to_string());
                }
                opts.width = w;
            }
        }
        Ok(())
    };

    let mut index = 0usize;
    while index < args.len() {
        let token = &args[index];
        if literal || token == "-" || !token.starts_with('-') {
            opts.files.push(token.clone());
            index += 1;
            continue;
        }
        if token == "--" {
            literal = true;
            index += 1;
            continue;
        }
        if token.starts_with("--") {
            match token.as_str() {
                "--table" => {
                    opts.table = true;
                    index += 1;
                    continue;
                }
                "--json" => {
                    opts.json = true;
                    opts.table = true;
                    index += 1;
                    continue;
                }
                "--fillrows" => {
                    opts.across = true;
                    index += 1;
                    continue;
                }
                "--help" => {
                    opts.help = true;
                    index += 1;
                    continue;
                }
                "--table-noheadings" => {
                    opts.no_headings = true;
                    index += 1;
                    continue;
                }
                "--keep-empty-lines" => {
                    opts.keep_empty = true;
                    index += 1;
                    continue;
                }
                "--table-maxout" => {
                    opts.maxout = true;
                    index += 1;
                    continue;
                }
                "--table-header-repeat" => {
                    opts.header_repeat = true;
                    index += 1;
                    continue;
                }
                _ => {}
            }
            let (name, attached) = match token.split_once('=') {
                Some((n, v)) => (n, Some(v.to_string())),
                None => (token.as_str(), None),
            };
            let option = match name {
                "--separator" | "--input-separator" => Some("s"),
                "--output-separator" => Some("o"),
                "--output-width" => Some("c"),
                "--table-columns" => Some("N"),
                "--table-name" => Some("n"),
                "--table-order" => Some("O"),
                "--table-hide" => Some("H"),
                "--table-right" => Some("R"),
                "--table-truncate" => Some("T"),
                "--table-wrap" => Some("W"),
                "--table-noextreme" => Some("E"),
                "--table-columns-limit" => Some("l"),
                "--table-column" => Some("C"),
                _ => None,
            };
            let Some(opt_code) = option else {
                return err_out(&format!("column: EINVAL: unsupported option: {token}\n"), 1);
            };
            let value = if let Some(v) = attached {
                v
            } else if index + 1 < args.len() {
                index += 1;
                args[index].clone()
            } else {
                return err_out(&format!("column: EINVAL: option {name} requires an argument\n"), 1);
            };
            if let Err(msg) = set_value(&mut opts, &mut output_set, opt_code, value) {
                return err_out(&msg, 1);
            }
            index += 1;
            continue;
        }
        let chars: Vec<char> = token[1..].chars().collect();
        let mut offset = 0usize;
        while offset < chars.len() {
            let ch = chars[offset];
            match ch {
                't' => opts.table = true,
                'J' => {
                    opts.json = true;
                    opts.table = true;
                }
                'x' => opts.across = true,
                'h' => opts.help = true,
                'd' => opts.no_headings = true,
                'L' => opts.keep_empty = true,
                'm' => opts.maxout = true,
                'e' => opts.header_repeat = true,
                's' | 'o' | 'c' | 'N' | 'n' | 'O' | 'H' | 'R' | 'T' | 'W' | 'E' | 'l'
                | 'C' => {
                    let opt_code = ch.to_string();
                    let value = if offset + 1 < chars.len() {
                        chars[offset + 1..].iter().collect()
                    } else if index + 1 < args.len() {
                        index += 1;
                        args[index].clone()
                    } else {
                        return err_out(
                            &format!("column: EINVAL: option -{ch} requires an argument\n"),
                            1,
                        );
                    };
                    if let Err(msg) = set_value(&mut opts, &mut output_set, &opt_code, value) {
                        return err_out(&msg, 1);
                    }
                    break;
                }
                _ => return err_out(&format!("column: EINVAL: unsupported option: -{ch}\n"), 1),
            }
            offset += 1;
        }
        index += 1;
    }

    if opts.help {
        return ok_out(include_str!("help/column.txt"));
    }
    if opts.table && opts.across {
        return err_out("column: EINVAL: -x/--fillrows cannot be combined with table mode\n", 1);
    }
    if !opts.definitions.is_empty() && !opts.names.is_empty() {
        return err_out(
            "column: EINVAL: --table-columns and --table-column are mutually exclusive\n",
            1,
        );
    }
    if !opts.definitions.is_empty() {
        opts.names = opts.definitions.iter().map(|d| d.name.clone()).collect();
    }
    if !opts.table
        && (!opts.names.is_empty()
            || !opts.order.is_empty()
            || opts.table_name != "table"
            || !opts.hide_sel.is_empty()
            || !opts.right_sel.is_empty()
            || !opts.truncate_sel.is_empty()
            || !opts.wrap_sel.is_empty()
            || !opts.noextreme_sel.is_empty())
    {
        return err_out("column: EINVAL: table options require -t/--table\n", 1);
    }
    if opts.json
        && (opts.names.is_empty()
            || (!opts.definitions.is_empty()
                && !opts
                    .definitions
                    .iter()
                    .any(|d| d.named && !d.name.is_empty())))
    {
        return err_out("column: EINVAL: JSON output requires --table-columns\n", 1);
    }
    if !opts.table && (opts.separator.is_some() || output_set) {
        return err_out("column: EINVAL: input/output separators require -t/--table\n", 1);
    }
    if opts.files.is_empty() {
        opts.files.push("-".to_string());
    }

    let hide_tokens: Vec<&str> = if opts.hide_sel.is_empty() {
        Vec::new()
    } else {
        opts.hide_sel.split(',').collect()
    };
    let is_column_hidden = |idx: usize, count: usize| -> bool {
        if opts
            .definitions
            .get(idx)
            .is_some_and(|d| d.flags.iter().any(|f| f == "hide"))
        {
            return true;
        }
        let col = idx + 1;
        let mut last_vis = count as isize - 1;
        while last_vis >= 0
            && opts
                .definitions
                .get(last_vis as usize)
                .is_some_and(|d| d.flags.iter().any(|f| f == "hide"))
        {
            last_vis -= 1;
        }
        for &tok in &hide_tokens {
            if tok == "-" || tok == "0" {
                return true;
            }
            if tok == "-1" && (idx as isize) == last_vis {
                return true;
            }
            if !tok.is_empty()
                && tok.chars().all(|c| c.is_ascii_digit())
                && tok.parse::<usize>().ok() == Some(col)
            {
                return true;
            }
            if let Some(d) = tok.get(1..).and_then(|r| r.find('-')).map(|p| p + 1) {
                let s_part = &tok[..d];
                let e_part = &tok[d + 1..];
                if !s_part.is_empty()
                    && !e_part.is_empty()
                    && s_part.chars().all(|c| c.is_ascii_digit())
                    && e_part.chars().all(|c| c.is_ascii_digit())
                    && let (Ok(fc), Ok(lc)) = (s_part.parse::<usize>(), e_part.parse::<usize>())
                    && col >= fc
                    && col <= lc
                {
                    return true;
                }
            }
        }
        false
    };
    let is_column_named = |idx: usize| -> bool {
        if !opts.definitions.is_empty() {
            opts.definitions
                .get(idx)
                .is_some_and(|d| d.named && !d.name.is_empty())
        } else {
            idx < opts.names.len()
        }
    };

    let mut rows: Vec<Vec<ColCell>> = Vec::new();
    let mut widths: Vec<usize> = Vec::new();
    let mut stderr = String::new();
    let mut exit_code = 0;
    let mut stdin_consumed = false;

    for file in &opts.files {
        let content = if file == "-" {
            if stdin_consumed {
                String::new()
            } else {
                stdin_consumed = true;
                stdin.to_string()
            }
        } else {
            let p = resolve_posix_path(cwd, file);
            if fs.is_dir(&p) {
                stderr.push_str(&format!(
                    "column: EISDIR: illegal operation on a directory, '{p}'\n"
                ));
                exit_code = 1;
                continue;
            }
            match fs.read_file(&p) {
                Ok(b) => crate::vfs::bytes_to_stream_string(&b),
                Err(_) => {
                    stderr.push_str(&format!(
                        "column: ENOENT: no such file or directory, stat '{p}'\n"
                    ));
                    exit_code = 1;
                    continue;
                }
            }
        };
        if content.is_empty() {
            continue;
        }
        let trimmed = content.strip_suffix('\n').unwrap_or(&content);
        for line in trimmed.split('\n') {
            let mut empty = line.is_empty();
            if opts.keep_empty && !empty {
                empty = line.chars().all(col_whitespace);
            }
            if empty {
                if opts.keep_empty {
                    if opts.table {
                        rows.push(Vec::new());
                    } else {
                        rows.push(vec![ColCell {
                            text: String::new(),
                            width: 0,
                        }]);
                    }
                }
                continue;
            }
            let values = if opts.table {
                col_fields(line, opts.separator.as_ref(), opts.column_limit)
            } else {
                vec![line.to_string()]
            };
            if opts.table && values.is_empty() {
                if opts.keep_empty {
                    rows.push(Vec::new());
                }
                continue;
            }
            if !opts.table && line.chars().all(|c| c == ' ' || c == '\t') {
                continue;
            }
            if opts.json {
                let count = values.len().max(opts.names.len());
                for idx in 0..values.len() {
                    if !is_column_named(idx) && !is_column_hidden(idx, count) {
                        return err_out(
                            &format!(
                                "column: EINVAL: line {}: for JSON the name of the column {} is required\n",
                                rows.len() + 1,
                                idx + 1
                            ),
                            1,
                        );
                    }
                }
            }
            let mut row = Vec::with_capacity(values.len());
            for (idx, val) in values.into_iter().enumerate() {
                let entry = col_cell(&val);
                let w = entry.width;
                row.push(if opts.json {
                    ColCell {
                        text: val,
                        width: w,
                    }
                } else {
                    entry
                });
                if idx >= widths.len() {
                    widths.resize(idx + 1, 0);
                }
                widths[idx] = widths[idx].max(w);
            }
            rows.push(row);
        }
    }

    let stdout = if opts.table {
        if !rows.is_empty() && widths.is_empty() && opts.names.is_empty() {
            exit_code = 1;
            String::new()
        } else {
            match col_configured_table(&rows, &widths, &opts) {
                Ok(s) => s,
                Err(msg) => return err_out(&msg, 1),
            }
        }
    } else if !rows.is_empty() {
        col_fill_output(&rows, &opts)
    } else {
        String::new()
    };

    BuiltinOutcome {
        stdout,
        stderr,
        exit_code,
    }
}

fn shuf_file<'a>(name: &str, cwd: &str, fs: &'a dyn SafeBashFs) -> Result<(usize, crate::vfs::ChunkReader<'a>), String> {
    let path = absolute_operand(cwd, name);
    if path.is_empty() { return Err("ENOENT: empty path".into()); }
    let (entry, st) = fs.inspect_command_entry(&path, true, "capabilitiesFor")?;
    if st.kind == crate::vfs::VfsEntryKind::Directory { return Err("EISDIR: is a directory".into()); }
    match fs.open_read_file(&entry, false) {
        Ok(handle) => {
            fs.command_descriptor_op()?;
            let size = handle.stat()?.size;
            let mut pos = 0;
            Ok((size, Box::new(move |chunk| {
                fs.command_descriptor_op()?;
                *chunk = handle.read(pos, 65536)?;
                pos += chunk.len() as u64;
                Ok(())
            })))
        }
        Err(e) if e.starts_with("ENOTSUP") => Ok((st.size, fs.open_chunks(&entry)?)),
        Err(e) => Err(e),
    }
}

struct ShufRng<'a> {
    value: u128,
    maximum: u128,
    bytes: Vec<u8>,
    offset: usize,
    source: Option<(String, crate::vfs::ChunkReader<'a>)>,
}

impl ShufRng<'_> {
    fn refill(&mut self) -> Result<(), String> {
        if let Some((name, read)) = &mut self.source {
            read(&mut self.bytes).map_err(|e| format!("shuf: {name}: read error: {}\n", file_error_reason(&e)))?;
            if self.bytes.is_empty() { return Err(format!("shuf: {name}: end of file\n")); }
        } else {
            self.bytes.resize(4096, 0);
            crate::vfs::memory::fill_random(&mut self.bytes).map_err(|e| format!("shuf: getrandom: {}\n", file_error_reason(&e)))?;
        }
        self.offset = 0;
        Ok(())
    }

    fn next_byte(&mut self) -> Result<u8, String> {
        if self.offset == self.bytes.len() { self.refill()?; }
        let b = self.bytes[self.offset];
        self.offset += 1;
        Ok(b)
    }

    fn choose(&mut self, size: u64) -> Result<u64, String> {
        let word_max = u128::from(u64::MAX);
        let size128 = u128::from(size);
        let target = size128 - 1;
        loop {
            while self.maximum < target {
                let b = u128::from(self.next_byte()?);
                self.value = ((self.value << 8) + b) & word_max;
                self.maximum = ((self.maximum << 8) + 255) & word_max;
            }
            if self.maximum == target {
                let chosen = self.value as u64;
                self.value = 0;
                self.maximum = 0;
                return Ok(chosen);
            }
            let excess = self.maximum - target;
            let unusable = excess % size128;
            let remainder = self.value % size128;
            if self.value <= self.maximum - unusable {
                self.value /= size128;
                self.maximum = excess / size128;
                return Ok(remainder as u64);
            }
            self.value = remainder;
            self.maximum = unusable - 1;
        }
    }
}

fn cmd_shuf<'a>(
    args: &[String],
    mut stdin: CommandInput,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &'a dyn SafeBashFs,
    write: &mut super::CommandWriter,
) -> BuiltinOutcome {
    let mut echo_mode = false;
    let mut repeat = false;
    let mut zero_terminated = false;
    let mut count = u64::MAX;
    let mut range: Option<(u64, u64)> = None;
    let mut out_file: Option<String> = None;
    let mut random_source: Option<String> = None;
    let mut operands: Vec<String> = Vec::new();
    let posix = env.contains_key("POSIXLY_CORRECT");

    let parse_dec = |val: &str| -> Option<u64> {
        if val.is_empty() || !val.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        val.parse::<u64>().ok()
    };

    let mut apply_opt = |key: &str, val: &str| -> Result<(), BuiltinOutcome> {
        match key {
            "e" => echo_mode = true,
            "r" => repeat = true,
            "z" => zero_terminated = true,
            "n" => {
                let trimmed = val.trim_start();
                let clean = trimmed.strip_prefix('+').unwrap_or(trimmed);
                let Some(n) = parse_dec(clean) else {
                    return Err(err_out(&format!("shuf: invalid line count: '{val}'\n"), 1));
                };
                if n < count {
                    count = n;
                }
            }
            "i" => {
                if range.is_some() {
                    return Err(err_out("shuf: multiple -i options specified\n", 1));
                }
                let Some((lo_s, hi_s)) = val.split_once('-') else {
                    return Err(err_out(&format!("shuf: invalid input range: '{val}'\n"), 1));
                };
                let (Some(lo), Some(hi)) = (parse_dec(lo_s), parse_dec(hi_s)) else {
                    return Err(err_out(&format!("shuf: invalid input range: '{val}'\n"), 1));
                };
                let Ok(length) = u64::try_from(i128::from(hi) - i128::from(lo) + 1) else {
                    return Err(err_out(&format!("shuf: invalid input range: '{val}'\n"), 1));
                };
                range = Some((lo, length));
            }
            "o" => {
                if let Some(ref prev) = out_file
                    && prev != val
                {
                    return Err(err_out("shuf: multiple output files specified\n", 1));
                }
                out_file = Some(val.to_string());
            }
            "random" => {
                if let Some(ref prev) = random_source
                    && prev != val
                {
                    return Err(err_out("shuf: multiple random sources specified\n", 1));
                }
                random_source = Some(val.to_string());
            }
            _ => {}
        }
        Ok(())
    };

    let long_opts = [
        ("echo", "e", false),
        ("input-range", "i", true),
        ("head-count", "n", true),
        ("output", "o", true),
        ("random-source", "random", true),
        ("repeat", "r", false),
        ("zero-terminated", "z", false),
        ("help", "help", false),
        ("version", "version", false),
    ];

    let mut stopped = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if stopped || a == "-" || !a.starts_with('-') {
            operands.push(a.clone());
            if posix {
                stopped = true;
            }
            i += 1;
            continue;
        }
        if a == "--" {
            stopped = true;
            i += 1;
            continue;
        }
        if let Some(rest) = a.strip_prefix("--") {
            let (name, eq_val) = match rest.split_once('=') {
                Some((n, v)) => (n, Some(v)),
                None => (rest, None),
            };
            let exact = long_opts.iter().find(|&&(ln, _, _)| ln == name);
            let matches: Vec<_> = long_opts
                .iter()
                .filter(|&&(ln, _, _)| ln.starts_with(name))
                .collect();
            let selected = if let Some(ex) = exact {
                ex
            } else if matches.len() == 1 {
                matches[0]
            } else {
                return err_out(
                    &format!("shuf: unrecognized option '{a}'\nTry 'shuf --help' for more information.\n"),
                    1,
                );
            };
            if selected.1 == "help" {
                return ok_out(include_str!("help/shuf.txt"));
            }
            if selected.1 == "version" {
                return ok_out("shuf (virtual-bash, GNU coreutils 9.7 profile)\n");
            }
            if !selected.2 && eq_val.is_some() {
                return err_out(
                    &format!(
                        "shuf: option '--{}' doesn't allow an argument\nTry 'shuf --help' for more information.\n",
                        selected.0
                    ),
                    1,
                );
            }
            let val = if selected.2 {
                if let Some(v) = eq_val {
                    v.to_string()
                } else if i + 1 < args.len() {
                    i += 1;
                    args[i].clone()
                } else {
                    return err_out(
                        &format!(
                            "shuf: option '--{}' requires an argument\nTry 'shuf --help' for more information.\n",
                            selected.0
                        ),
                        1,
                    );
                }
            } else {
                String::new()
            };
            if let Err(e) = apply_opt(selected.1, &val) {
                return e;
            }
            i += 1;
            continue;
        }

        let chars: Vec<char> = a[1..].chars().collect();
        let mut pos = 0usize;
        while pos < chars.len() {
            let ch = chars[pos];
            if !"einorz".contains(ch) {
                return err_out(
                    &format!("shuf: invalid option -- '{ch}'\nTry 'shuf --help' for more information.\n"),
                    1,
                );
            }
            let key = ch.to_string();
            let mut val = String::new();
            if "ino".contains(ch) {
                let tail: String = chars[pos + 1..].iter().collect();
                if !tail.is_empty() {
                    val = tail;
                } else if i + 1 < args.len() {
                    i += 1;
                    val = args[i].clone();
                } else {
                    return err_out(
                        &format!(
                            "shuf: option requires an argument -- '{ch}'\nTry 'shuf --help' for more information.\n"
                        ),
                        1,
                    );
                }
                pos = chars.len();
            } else {
                pos += 1;
            }
            if let Err(e) = apply_opt(&key, &val) {
                return e;
            }
        }
        i += 1;
    }

    if echo_mode && range.is_some() {
        return err_out(
            "shuf: cannot combine -e and -i options\nTry 'shuf --help' for more information.\n",
            1,
        );
    }
    let max_ops = if range.is_some() {
        0usize
    } else if echo_mode {
        usize::MAX
    } else {
        1usize
    };
    if operands.len() > max_ops {
        return err_out(
            &format!(
                "shuf: extra operand '{}'\nTry 'shuf --help' for more information.\n",
                operands[max_ops]
            ),
            1,
        );
    }

    let sep = if zero_terminated { b'\0' } else { b'\n' };
    let unicode = ["LC_ALL","LC_CTYPE","LANG"].iter().find_map(|k| env.get(*k).filter(|s| !s.is_empty()))
        .is_some_and(|s| { let s = s.to_ascii_lowercase(); s.ends_with("utf-8") || s.ends_with("utf8") });
    let fail_open = |name: &str, e: &str| err_out(&format!("shuf: {}: {}\n", fmt_quote::filename(name, unicode), file_error_reason(e)), 1);
    let mut rng = ShufRng { value: 0, maximum: 0, bytes: Vec::new(), offset: 0, source: None };
    let open_random = |rng: &mut ShufRng<'a>, name: &str| -> Result<(), BuiltinOutcome> {
        let (_, reader) = shuf_file(name, cwd, fs).map_err(|e| fail_open(name, &e))?;
        rng.source = Some((fmt_quote::quote(name, false, unicode), reader));
        Ok(())
    };
    let mut records: Vec<Vec<u8>> = Vec::new();
    let size = if let Some((_, len)) = range { len }
    else if echo_mode {
        if count != 0 {
            for op in &operands {
                let mut rec = stream_string_to_bytes(op);
                rec.push(sep);
                records.push(rec);
            }
        }
        records.len() as u64
    } else if count == 0 && !repeat { 0 }
    else {
        let name = operands.first().filter(|s| count != 0 && s.as_str() != "-");
        let mut file = match name {
            Some(f) => match shuf_file(f, cwd, fs) {
                Ok(input) => Some(input), Err(e) => return fail_open(f, &e),
            },
            None => None,
        };
        let reservoir = !repeat && count < u64::MAX && file.as_ref().is_none_or(|(size, _)| *size > 8 * 1024 * 1024);
        if reservoir && let Some(rs) = &random_source && let Err(e) = open_random(&mut rng, rs) { return e; }
        let mut seen = 0u64;
        let mut pick = 0;
        let mut error = None;
        let mut accept = |line: &[u8]| {
            if !reservoir || seen < count || pick < count {
                let mut bytes = line.to_vec();
                bytes.push(sep);
                if reservoir && seen >= count { records[pick as usize] = bytes; }
                else { records.push(bytes); }
            }
            seen += 1;
            if reservoir && seen >= count {
                match rng.choose(seen + 1) { Ok(v) => pick = v, Err(e) => { error = Some(e); return false; } }
            }
            true
        };
        let mut pending = Vec::new();
        let mut available = fs.max_input_bytes();
        let mut exceeded = false;
        let mut consume = |chunk: &[u8]| {
            let Some(left) = available.checked_sub(chunk.len()) else { exceeded = true; return false; };
            available = left;
            visit_complete_records(chunk, |b| b == sep, &mut pending, &mut accept)
        };
        let read = if let Some((_, next)) = &mut file {
            let mut chunk = Vec::new();
            loop {
                if let Err(e) = next(&mut chunk) { break Err(e); }
                if chunk.is_empty() || !consume(&chunk) { break Ok(()); }
            }
        } else { stdin.read_stdin(consume) };
        if exceeded { return err_out(&fs.limit_error("maxInputBytes", fs.max_input_bytes()), 1); }
        if let Err(e) = read { return err_out(&format!("shuf: read error: {}\n", file_error_reason(&e)), 1); }
        if !pending.is_empty() { accept(&pending); }
        if let Some(e) = error { return err_out(&e, 1); }
        records.len() as u64
    };

    if repeat || count.min(size) != 0 {
        if let Some(rs) = &random_source {
            if rng.source.is_none() && let Err(e) = open_random(&mut rng, rs) { return e; }
        } else if repeat && let Err(e) = rng.refill() { return err_out(&e, 1); }
    }
    let ahead = if repeat || count < size { count } else { size };

    let mut swaps: BTreeMap<u64, u64> = BTreeMap::new();
    let mut choose = |index| -> Result<u64, String> {
        if repeat { return rng.choose(size); }
        let pick = index + rng.choose(size - index)?;
        let chosen = swaps.remove(&pick).unwrap_or(pick);
        if pick != index { let replacement = swaps.remove(&index).unwrap_or(index); swaps.insert(pick, replacement); }
        Ok(chosen)
    };

    // Named randomness or output requires the permutation to succeed before opening the sink.
    let prepared = !repeat && (out_file.is_some() || random_source.is_some());
    let mut permutation = Vec::new();
    if prepared {
        for index in 0..ahead {
            match choose(index) {
                Ok(n) => permutation.push(n),
                Err(msg) => return err_out(&msg, 1),
            }
        }
    }
    let mut target = if let Some(name) = out_file.as_deref() {
        let mode = 0o666 & !env.get("\0umask").and_then(|s| u32::from_str_radix(s, 8).ok()).unwrap_or(0o022);
        match fs.open_command_stream(&absolute_operand(cwd, name), false, false, mode, None) {
            Ok(sink) => Some(sink),
            Err(e) if !name.is_empty() && name.bytes().all(|b| b == b'/') && e.starts_with("EISDIR:") =>
                return fail_open(name, "EEXIST: file exists"),
            Err(e) => return fail_open(name, &e),
        }
    } else { None };
    if repeat && count != 0 && size == 0 { return err_out("shuf: no lines to repeat\n", 1); }

    let mut out = ok_out("");
    let mut emitted = 0usize;
    let limit = fs.shell_limits().max_output_bytes;
    let mut flush = |bytes: &[u8], out: &mut BuiltinOutcome| {
        if let Some(sink) = &mut target {
            if let Err(e) = sink(Some(bytes)) {
                out.exit_code = 1;
                out.stderr.push_str(&format!("shuf: write error: {}\n", file_error_reason(&e)));
                return false;
            }
        } else if !write(1, &crate::vfs::bytes_to_stream_string(bytes), out) { return false; }
        // Direct native callers can supply a capturing writer without a shell budget.
        emitted = emitted.saturating_add(bytes.len());
        if emitted > limit {
            out.exit_code = 1;
            out.stderr.push_str(&fs.limit_error("maxOutputBytes", limit));
            return false;
        }
        true
    };
    let mut batch = Vec::new();
    for index in 0..ahead {
        let chosen = if prepared { permutation[index as usize] } else {
            match choose(index) {
                Ok(n) => n,
                Err(msg) => { out.exit_code = 1; out.stderr.push_str(&msg); return out; }
            }
        };
        let number;
        let mut bytes = if let Some((lo, _)) = range {
            number = { let mut b = (lo + chosen).to_string().into_bytes(); b.push(sep); b };
            number.as_slice()
        } else { records[chosen as usize].as_slice() };
        while !bytes.is_empty() {
            let n = (16384 - batch.len()).min(bytes.len());
            batch.extend_from_slice(&bytes[..n]);
            bytes = &bytes[n..];
            if batch.len() == 16384 {
                if !flush(&batch, &mut out) { return out; }
                batch.clear();
            }
        }
        if repeat && random_source.is_some() && !batch.is_empty() {
            if !flush(&batch, &mut out) { return out; }
            batch.clear();
        }
    }
    if !batch.is_empty() && !flush(&batch, &mut out) { return out; }
    if let Some(mut sink) = target && let Err(e) = sink(None) {
        out.exit_code = 1;
        out.stderr.push_str(&format!("shuf: write error: {}\n", file_error_reason(&e)));
    }
    out
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SplitMode {
    Lines,
    Bytes,
    LineBytes,
    Chunks,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SplitChunkMode {
    Bytes,
    Lines,
    RoundRobin,
}

struct SplitArgs {
    mode: SplitMode,
    size: usize,
    chunk_mode: SplitChunkMode,
    selected_chunk: usize,
    input: String,
    prefix: String,
    alphabet: Vec<char>,
    suffix_length: usize,
    automatic: bool,
    numeric_start: String,
    additional_suffix: String,
    separator: u8,
    elide_empty: bool,
    verbose: bool,
}

struct SplitNames {
    digits: Vec<usize>,
    extension: String,
    first: bool,
    prefix: String,
    alphabet: Vec<char>,
    automatic: bool,
    additional_suffix: String,
}

impl SplitNames {
    fn new(args: &SplitArgs) -> Self {
        let mut digits = vec![0usize; args.suffix_length];
        if args.alphabet.first() == Some(&'0') {
            let mut padded = args.numeric_start.clone();
            while padded.len() < args.suffix_length {
                padded.insert(0, '0');
            }
            digits = padded
                .chars()
                .map(|d| args.alphabet.iter().position(|&c| c == d).unwrap_or(0))
                .collect();
        }
        Self {
            digits,
            extension: String::new(),
            first: true,
            prefix: args.prefix.clone(),
            alphabet: args.alphabet.clone(),
            automatic: args.automatic,
            additional_suffix: args.additional_suffix.clone(),
        }
    }

    fn next_name(&mut self) -> Result<String, String> {
        if !self.first {
            let mut advanced = false;
            for idx in (0..self.digits.len()).rev() {
                self.digits[idx] += 1;
                if idx == 0 && self.automatic && self.digits[idx] == self.alphabet.len() - 1 {
                    self.extension.push(*self.alphabet.last().unwrap());
                    self.digits = vec![0usize; self.digits.len() + 1];
                    advanced = true;
                    break;
                }
                if self.digits[idx] < self.alphabet.len() {
                    advanced = true;
                    break;
                }
                self.digits[idx] = 0;
            }
            if !advanced {
                return Err("split: output file suffixes exhausted\n".to_string());
            }
        }
        self.first = false;
        let mid: String = self.digits.iter().map(|&d| self.alphabet[d]).collect();
        Ok(format!(
            "{}{}{}{}",
            self.prefix, self.extension, mid, self.additional_suffix
        ))
    }
}

fn parse_split_number(text: &str, label: &str, units: bool, zero: bool) -> Result<usize, String> {
    let trimmed = text.trim_start_matches(['\t', '\n', '\x0b', '\x0c', '\r', ' ']);
    let body = trimmed.strip_prefix('+').unwrap_or(trimmed);
    let digit_len = body.chars().take_while(|c| c.is_ascii_digit()).count();
    let digits = &body[..digit_len];
    let suffix = &body[digit_len..];
    if !suffix.chars().all(|c| c.is_ascii_alphabetic())
        || (digits.is_empty() && (!units || suffix.is_empty() || text != suffix))
    {
        return Err(format!("split: invalid {label}: '{text}'\n"));
    }
    let mut multiplier: u128 = 1;
    if !suffix.is_empty() {
        if !units {
            return Err(format!("split: invalid {label}: '{text}'\n"));
        }
        if suffix == "b" {
            multiplier = 512;
        } else {
            let mut chars = suffix.chars();
            let first = chars.next().unwrap().to_ascii_uppercase();
            let rest = chars.as_str();
            let exp_opt = "KMGTPEZYRQ".find(first).map(|i| (i + 1) as u32);
            let Some(exp) = exp_opt else {
                return Err(format!("split: invalid {label}: '{text}'\n"));
            };
            let base: u128 = match rest {
                "" | "iB" => 1024,
                "B" => 1000,
                _ => return Err(format!("split: invalid {label}: '{text}'\n")),
            };
            multiplier = base
                .checked_pow(exp)
                .ok_or_else(|| format!("split: invalid {label}: '{text}'\n"))?;
        }
    }
    let num_val: u128 = if digits.is_empty() {
        1
    } else {
        digits
            .parse::<u128>()
            .map_err(|_| format!("split: invalid {label}: '{text}'\n"))?
    };
    let total = num_val
        .checked_mul(multiplier)
        .ok_or_else(|| format!("split: invalid {label}: '{text}'\n"))?;
    let min_val = if zero { 0 } else { 1 };
    if total < min_val || total > (usize::MAX as u128) {
        return Err(format!("split: invalid {label}: '{text}'\n"));
    }
    Ok(total as usize)
}

fn format_radix_u128(mut val: u128, radix: u32) -> String {
    if val == 0 {
        return "0".to_string();
    }
    let digits = b"0123456789abcdef";
    let mut buf = Vec::new();
    while val > 0 {
        buf.push(digits[(val % (radix as u128)) as usize] as char);
        val /= radix as u128;
    }
    buf.into_iter().rev().collect()
}

fn parse_split_args(args: &[String], max_files: Option<usize>) -> Result<SplitArgs, String> {
    let mut mode: Option<SplitMode> = None;
    let mut size = 1000usize;
    let mut chunk_mode = SplitChunkMode::Bytes;
    let mut selected_chunk = 0usize;
    let mut suffix_length = 0usize;
    let mut alphabet: Vec<char> = "abcdefghijklmnopqrstuvwxyz".chars().collect();
    let mut numeric_start_value: Option<u128> = None;
    let mut additional_suffix = String::new();
    let mut separator = b'\n';
    let mut elide_empty = false;
    let mut verbose = false;
    let mut operands: Vec<String> = Vec::new();
    let mut ended = false;

    let mut apply = |option: &str, value: Option<String>| -> Result<(), String> {
        match option {
            "d" | "x" => {
                alphabet = if option == "d" {
                    "0123456789".chars().collect()
                } else {
                    "0123456789abcdef".chars().collect()
                };
                if let Some(val) = value {
                    let lower = val.to_ascii_lowercase();
                    if lower.chars().any(|c| !alphabet.contains(&c)) {
                        return Err(format!(
                            "split: invalid start value for numerical suffix: '{val}'\n"
                        ));
                    }
                    let radix = if option == "x" { 16 } else { 10 };
                    let parsed = if lower.is_empty() {
                        0
                    } else {
                        u128::from_str_radix(&lower, radix).map_err(|_| {
                            format!(
                                "split: invalid start value for numerical suffix: '{val}'\n"
                            )
                        })?
                    };
                    numeric_start_value = Some(parsed);
                }
            }
            "a" => {
                suffix_length =
                    parse_split_number(&value.unwrap_or_default(), "suffix length", false, true)?;
            }
            "e" => elide_empty = true,
            "u" => {}
            "verbose" => verbose = true,
            "t" => {
                let val = value.unwrap_or_default();
                let bytes = if val == "\\0" {
                    vec![0u8]
                } else {
                    crate::vfs::stream_string_to_bytes(&val)
                };
                if bytes.len() != 1 {
                    return Err("split: separator must be exactly one byte\n".to_string());
                }
                separator = bytes[0];
            }
            "additional-suffix" => {
                let val = value.unwrap_or_default();
                if val.contains('/') || val.contains('\0') {
                    return Err(
                        "split: invalid additional suffix: contains directory separator or NUL\n"
                            .to_string(),
                    );
                }
                additional_suffix = val;
            }
            _ => {
                if mode.is_some() {
                    return Err("split: cannot split in more than one way\n".to_string());
                }
                mode = Some(match option {
                    "l" => SplitMode::Lines,
                    "b" => SplitMode::Bytes,
                    "n" => SplitMode::Chunks,
                    _ => SplitMode::LineBytes,
                });
                let val = value.unwrap_or_default();
                if option == "n" {
                    let mut parts: Vec<&str> = val.split('/').collect();
                    if parts.first() == Some(&"l") || parts.first() == Some(&"r") {
                        chunk_mode = if parts.remove(0) == "l" {
                            SplitChunkMode::Lines
                        } else {
                            SplitChunkMode::RoundRobin
                        };
                    }
                    if parts.is_empty() || parts.len() > 2 {
                        return Err(format!("split: invalid number of chunks: '{val}'\n"));
                    }
                    size = parse_split_number(parts.last().unwrap(), "number of chunks", false, false)?;
                    if parts.len() == 2 {
                        selected_chunk = parse_split_number(parts[0], "chunk number", false, false)?;
                        if selected_chunk > size {
                            return Err(format!("split: invalid chunk number: '{val}'\n"));
                        }
                    }
                    return Ok(());
                }
                size = parse_split_number(
                    &val,
                    if option == "l" {
                        "number of lines"
                    } else {
                        "number of bytes"
                    },
                    option == "b" || option == "C",
                    false,
                )?;
            }
        }
        Ok(())
    };

    let mut index = 0usize;
    while index < args.len() {
        let argument = &args[index];
        if ended || argument == "-" || !argument.starts_with('-') {
            operands.push(argument.clone());
            index += 1;
            continue;
        }
        if argument == "--" {
            ended = true;
            index += 1;
            continue;
        }
        if let Some(rest) = argument.strip_prefix("--") {
            let (name, eq_val) = match rest.split_once('=') {
                Some((n, v)) => (n, Some(v.to_string())),
                None => (rest, None),
            };
            let option = match name {
                "lines" => Some("l"),
                "bytes" => Some("b"),
                "line-bytes" => Some("C"),
                "suffix-length" => Some("a"),
                "numeric-suffixes" => Some("d"),
                "additional-suffix" => Some("additional-suffix"),
                "hex-suffixes" => Some("x"),
                "separator" => Some("t"),
                "elide-empty-files" => Some("e"),
                "number" => Some("n"),
                "unbuffered" => Some("u"),
                "verbose" => Some("verbose"),
                _ => None,
            };
            let Some(opt_code) = option else {
                return Err(format!("split: unrecognized option '{argument}'\n"));
            };
            if matches!(opt_code, "e" | "u" | "verbose") && eq_val.is_some() {
                return Err(format!(
                    "split: option '--{name}' doesn't allow an argument\n"
                ));
            }
            let optional = matches!(opt_code, "d" | "x" | "e" | "u" | "verbose");
            let val = if eq_val.is_some() {
                eq_val
            } else if optional {
                None
            } else if index + 1 < args.len() {
                index += 1;
                Some(args[index].clone())
            } else {
                return Err(format!("split: option '--{name}' requires an argument\n"));
            };
            apply(opt_code, val)?;
        } else if !argument[1..].is_empty() && argument[1..].chars().all(|c| c.is_ascii_digit()) {
            apply("l", Some(argument[1..].to_string()))?;
        } else {
            let chars: Vec<char> = argument[1..].chars().collect();
            let mut offset = 0usize;
            while offset < chars.len() {
                let opt = chars[offset];
                if !"lbaCdxetnu".contains(opt) {
                    return Err(format!("split: invalid option -- '{opt}'\n"));
                }
                let opt_s = opt.to_string();
                if matches!(opt, 'd' | 'x' | 'e' | 'u') {
                    apply(&opt_s, None)?;
                    offset += 1;
                } else {
                    let val = if offset + 1 < chars.len() {
                        chars[offset + 1..].iter().collect()
                    } else if index + 1 < args.len() {
                        index += 1;
                        args[index].clone()
                    } else {
                        return Err(format!(
                            "split: option requires an argument -- '{opt}'\n"
                        ));
                    };
                    apply(&opt_s, Some(val))?;
                    break;
                }
            }
        }
        index += 1;
    }

    if operands.len() > 2 {
        return Err(format!("split: extra operand '{}'\n", operands[2]));
    }
    let mut required_suffix_length = 1usize;
    if mode == Some(SplitMode::Chunks) {
        let mut capacity = alphabet.len();
        while capacity < size {
            capacity = capacity.saturating_mul(alphabet.len());
            required_suffix_length += 1;
        }
        if suffix_length != 0 && suffix_length < required_suffix_length {
            return Err(format!(
                "split: the suffix length needs to be at least {required_suffix_length}\n"
            ));
        }
    }
    let numeric_start = numeric_start_value.map(|v| format_radix_u128(v, alphabet.len() as u32));
    let automatic =
        suffix_length == 0 && numeric_start.is_none() && mode != Some(SplitMode::Chunks);
    if suffix_length == 0 {
        suffix_length = 2.max(required_suffix_length);
    }
    if let Some(ref ns) = numeric_start
        && ns.len() > suffix_length
    {
        return Err(
            "split: numerical suffix start value is too large for the suffix length\n".to_string(),
        );
    }
    if mode == Some(SplitMode::Chunks)
        && !elide_empty
        && selected_chunk == 0
        && let Some(mf) = max_files
        && size > mf
    {
        return Err("split: maxFiles limit exceeded\n".to_string());
    }
    Ok(SplitArgs {
        mode: mode.unwrap_or(SplitMode::Lines),
        size,
        chunk_mode,
        selected_chunk,
        input: operands.first().cloned().unwrap_or_else(|| "-".to_string()),
        prefix: operands.get(1).cloned().unwrap_or_else(|| "x".to_string()),
        alphabet,
        suffix_length,
        automatic,
        numeric_start: numeric_start.unwrap_or_else(|| "0".to_string()),
        additional_suffix,
        separator,
        elide_empty,
        verbose,
    })
}

fn cmd_split(
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let max_files = env
        .get("\0limit_split_max_files")
        .and_then(|v| v.parse::<usize>().ok());
    let parsed = match parse_split_args(args, max_files) {
        Ok(p) => p,
        Err(msg) => return err_out(&msg, 1),
    };
    let input_path = (parsed.input != "-").then(|| resolve_posix_path(cwd, &parsed.input));
    let mut input_id = None;
    let raw_bytes = if let Some(path) = &input_path {
        if fs.is_dir(path) {
            return err_out(&format!("split: illegal operation on a directory '{path}'\n"), 1);
        }
        let read = || -> Result<_, String> {
            if fs.supports_command_descriptor(path)
                && let Some(handle) = fs.open_redirect_file(path, crate::vfs::RedirectAccess::Read, None)?
            {
                let st = handle.stat()?;
                if st.mode & 0o170000 != 0o100000 { return Err("input is not a regular file".into()); }
                let mut bytes = Vec::new();
                while bytes.len() < st.size {
                    let chunk = handle.read_at(bytes.len(), (st.size - bytes.len()).min(65536))?;
                    if chunk.is_empty() { break; }
                    bytes.extend_from_slice(&chunk);
                }
                Ok((st.identity, bytes))
            } else {
                let st = fs.stat(path)?;
                if st.mode & 0o170000 != 0o100000 { return Err("input is not a regular file".into()); }
                Ok((st.identity, fs.read_file(path)?))
            }
        };
        match read() {
            Ok((id, bytes)) => { input_id = id; bytes }
            Err(e) if !e.starts_with("ENOENT:") => return err_out(&format!("split: {e}\n"), 1),
            Err(_) => return err_out(&format!("split: no such file or directory, stat '{path}'\n"), 1),
        }
    } else {
        stream_string_to_bytes(stdin)
    };

    if parsed.selected_chunk > 0 {
        let target_idx = parsed.selected_chunk - 1;
        let out_slice: Vec<u8> = match parsed.chunk_mode {
            SplitChunkMode::RoundRobin => {
                let mut out = Vec::new();
                let mut start = 0usize;
                let mut rec = 0usize;
                for off in 0..raw_bytes.len() {
                    if raw_bytes[off] != parsed.separator && off + 1 != raw_bytes.len() {
                        continue;
                    }
                    if rec % parsed.size == target_idx {
                        out.extend_from_slice(&raw_bytes[start..=off]);
                    }
                    rec += 1;
                    start = off + 1;
                }
                out
            }
            SplitChunkMode::Bytes | SplitChunkMode::Lines => {
                let chunk_size = raw_bytes.len() / parsed.size;
                let rem = raw_bytes.len() % parsed.size;
                let mut chunk_offset = 0usize;
                let mut selected = Vec::new();
                for idx in 0..parsed.size {
                    let mut end = chunk_size * (idx + 1) + (idx + 1).min(rem);
                    if parsed.chunk_mode == SplitChunkMode::Lines {
                        end = end.max(chunk_offset);
                        while end < raw_bytes.len()
                            && end > 0
                            && raw_bytes[end - 1] != parsed.separator
                        {
                            end += 1;
                        }
                    }
                    let slice = &raw_bytes[chunk_offset..end.min(raw_bytes.len())];
                    if idx == target_idx {
                        selected = slice.to_vec();
                        break;
                    }
                    chunk_offset = end.min(raw_bytes.len());
                }
                selected
            }
        };
        return ok_out(&crate::vfs::bytes_to_stream_string(&out_slice));
    }

    let mut chunks: Vec<Vec<u8>> = Vec::new();
    match parsed.mode {
        SplitMode::Bytes => {
            for ch in raw_bytes.chunks(parsed.size.max(1)) {
                chunks.push(ch.to_vec());
            }
        }
        SplitMode::Lines => {
            let mut start = 0usize;
            let mut lines = 0usize;
            for off in 0..raw_bytes.len() {
                if raw_bytes[off] == parsed.separator {
                    lines += 1;
                    if lines == parsed.size {
                        chunks.push(raw_bytes[start..=off].to_vec());
                        start = off + 1;
                        lines = 0;
                    }
                }
            }
            if start < raw_bytes.len() {
                chunks.push(raw_bytes[start..].to_vec());
            }
        }
        SplitMode::LineBytes => {
            let mut pos = 0usize;
            while pos < raw_bytes.len() {
                let avail = (raw_bytes.len() - pos).min(parsed.size);
                let win = &raw_bytes[pos..pos + avail];
                let mut count = avail;
                if avail == parsed.size {
                    for off in (0..avail).rev() {
                        if win[off] == parsed.separator {
                            count = off + 1;
                            break;
                        }
                    }
                }
                chunks.push(raw_bytes[pos..pos + count].to_vec());
                pos += count;
            }
        }
        SplitMode::Chunks => match parsed.chunk_mode {
            SplitChunkMode::RoundRobin => {
                let mut buckets: Vec<Vec<u8>> = vec![Vec::new(); parsed.size];
                let mut start = 0usize;
                let mut rec = 0usize;
                for off in 0..raw_bytes.len() {
                    if raw_bytes[off] != parsed.separator && off + 1 != raw_bytes.len() {
                        continue;
                    }
                    buckets[rec % parsed.size].extend_from_slice(&raw_bytes[start..=off]);
                    rec += 1;
                    start = off + 1;
                }
                chunks = buckets;
            }
            SplitChunkMode::Bytes | SplitChunkMode::Lines => {
                let chunk_size = raw_bytes.len() / parsed.size;
                let rem = raw_bytes.len() % parsed.size;
                let mut chunk_offset = 0usize;
                for idx in 0..parsed.size {
                    let mut end = chunk_size * (idx + 1) + (idx + 1).min(rem);
                    if parsed.chunk_mode == SplitChunkMode::Lines {
                        end = end.max(chunk_offset);
                        while end < raw_bytes.len()
                            && end > 0
                            && raw_bytes[end - 1] != parsed.separator
                        {
                            end += 1;
                        }
                    }
                    let clamped = end.min(raw_bytes.len());
                    chunks.push(raw_bytes[chunk_offset..clamped].to_vec());
                    chunk_offset = clamped;
                }
            }
        },
    }

    let mut names = SplitNames::new(&parsed);
    let mut files_written = 0usize;
    let mut stdout = String::new();
    let mode = 0o666 & !env.get("\0umask").and_then(|s| u32::from_str_radix(s, 8).ok()).unwrap_or(0o022);
    let mut output_ids = BTreeSet::new();
    let mut protected: Vec<_> = input_path.iter().cloned().collect();
    for chunk in chunks {
        if chunk.is_empty() && parsed.elide_empty {
            continue;
        }
        files_written += 1;
        if let Some(mf) = max_files
            && files_written > mf
        {
            return err_out("split: maxFiles limit exceeded\n", 1);
        }
        let file_name = match names.next_name() {
            Ok(n) => n,
            Err(msg) => return err_out(&msg, 1),
        };
        let out_path = resolve_posix_path(cwd, &file_name);
        let write = || -> Result<_, String> {
            let entry = fs.access_path(&out_path, true)?;
            let version = fs.generation();
            match fs.lstat(&entry) {
                Err(e) if e.starts_with("ENOENT:") => {
                    fs.create_file(&entry, &chunk, mode)?;
                    return Ok(fs.lstat(&entry)?.identity);
                }
                Err(e) => return Err(e),
                Ok(st) if st.kind == crate::vfs::VfsEntryKind::Directory => return Err("Is a directory".into()),
                Ok(_) => {}
            }
            let check = |id: &Option<crate::vfs::EntryIdentity>| -> Result<(), String> {
                if input_path.as_ref() == Some(&entry) || (id.is_some() && id == &input_id) {
                    return Err("would overwrite input; aborting".into());
                }
                if output_ids.contains(id) && id.is_some() {
                    return Err("output aliases an earlier output; aborting".into());
                }
                if (id.is_none() && !protected.is_empty()) || (input_path.is_some() && input_id.is_none()) || output_ids.contains(&None) {
                    return Err("cannot establish distinct output identity".into());
                }
                Ok(())
            };
            // Inspect the same open file that is later truncated, even if the path is replaced.
            if fs.supports_command_descriptor(&entry) {
                let handle = fs.open_redirect_file(&entry, crate::vfs::RedirectAccess::Write, None)?
                    .ok_or("output is not a regular file")?;
                let st = handle.stat()?;
                if st.mode & 0o170000 != 0o100000 { return Err("output is not a regular file".into()); }
                let id = st.identity;
                check(&id)?;
                handle.truncate_to(0)?;
                handle.write_at(Some(0), &chunk)?;
                Ok(id)
            } else {
                let stamp = fs.observe_publication(&entry, version, crate::vfs::PublicationMode::Write)?;
                check(&fs.lstat(&entry)?.identity)?;
                fs.publish_file(&entry, &chunk, &protected, stamp.version)?;
                Ok(fs.lstat(&entry)?.identity)
            }
        };
        match write() {
            Ok(id) => { output_ids.insert(id); protected.push(out_path); }
            Err(e) => return BuiltinOutcome { stdout, stderr: if e == "would overwrite input; aborting" {
                format!("split: '{file_name}' {e}\n")
            } else { format!("split: {file_name}: {e}\n") }, exit_code: 1 },
        }
        if parsed.verbose {
            stdout.push_str(&format!("creating file '{file_name}'\n"));
        }
    }
    ok_out(&stdout)
}

const DD_ASCII_HEX: &str = concat!(
    "000102039c09867f978d8e0b0c0d0e0f101112139d8508871819928f1c1d1e1f",
    "80818283840a171b88898a8b8c050607909116939495960498999a9b14159e1a",
    "20a0a1a2a3a4a5a6a7a8d52e3c282b7c26a9aaabacadaeafb0b121242a293b7e",
    "2d2fb2b3b4b5b6b7b8b9cb2c255f3e3fbabbbcbdbebfc0c1c2603a2340273d22",
    "c3616263646566676869c4c5c6c7c8c9ca6a6b6c6d6e6f7071725ecccdcecfd0",
    "d1e5737475767778797ad2d3d45bd6d7d8d9dadbdcdddedfe0e1e2e3e45de6e7",
    "7b414243444546474849e8e9eaebeced7d4a4b4c4d4e4f505152eeeff0f1f2f3",
    "5c9f535455565758595af4f5f6f7f8f930313233343536373839fafbfcfdfeff"
);

const DD_EBCDIC_HEX: &str = concat!(
    "00010203372d2e2f1605250b0c0d0e0f101112133c3d322618193f271c1d1e1f",
    "405a7f7b5b6c507d4d5d5c4e6b604b61f0f1f2f3f4f5f6f7f8f97a5e4c7e6e6f",
    "7cc1c2c3c4c5c6c7c8c9d1d2d3d4d5d6d7d8d9e2e3e4e5e6e7e8e9ade0bd9a6d",
    "79818283848586878889919293949596979899a2a3a4a5a6a7a8a9c04fd05f07",
    "202122232415061728292a2b2c090a1b30311a333435360838393a3b04143ee1",
    "4142434445464748495152535455565758596263646566676869707172737475",
    "767778808a8b8c8d8e8f906a9b9c9d9e9fa0aaabac4aaeafb0b1b2b3b4b5b6b7",
    "b8b9babbbca1bebfcacbcccdcecfdadbdcdddedfeaebecedeeeffafbfcfdfeff"
);

const DD_IBM_HEX: &str = concat!(
    "00010203372d2e2f1605250b0c0d0e0f101112133c3d322618193f271c1d1e1f",
    "405a7f7b5b6c507d4d5d5c4e6b604b61f0f1f2f3f4f5f6f7f8f97a5e4c7e6e6f",
    "7cc1c2c3c4c5c6c7c8c9d1d2d3d4d5d6d7d8d9e2e3e4e5e6e7e8e9ade0bd5f6d",
    "79818283848586878889919293949596979899a2a3a4a5a6a7a8a9c04fd0a107",
    "202122232415061728292a2b2c090a1b30311a333435360838393a3b04143ee1",
    "4142434445464748495152535455565758596263646566676869707172737475",
    "767778808a8b8c8d8e8f909a9b9c9d9e9fa0aaabacadaeafb0b1b2b3b4b5b6b7",
    "b8b9babbbcbdbebfcacbcccdcecfdadbdcdddedfeaebecedeeeffafbfcfdfeff"
);

fn parse_dd_number(text: &str, warnings: &mut Vec<String>) -> Result<usize, String> {
    let factors: Vec<&str> = text.split('x').collect();
    let mut product = 1usize;
    for &factor in &factors {
        let trimmed = factor.trim_start_matches([' ', '\t', '\r', '\n', '\x0b', '\x0c']);
        let rest = trimmed.strip_prefix('+').unwrap_or(trimmed);
        let num_len = rest.bytes().take_while(|b| b.is_ascii_digit()).count();
        let suffix = &rest[num_len..];
        let mut val = if num_len == 0 {
            if suffix.is_empty()
                || !"bcEGkKMPQRTwYZ".contains(suffix.chars().next().unwrap_or('\0'))
            {
                return Err(format!("dd: invalid number: '{text}'\n"));
            }
            1usize
        } else {
            rest[..num_len]
                .parse::<usize>()
                .map_err(|_| format!("dd: invalid number: '{text}'\n"))?
        };
        let mult = if suffix == "b" || suffix == "bB" {
            512usize
        } else if suffix == "w" || suffix == "wB" {
            2usize
        } else if suffix.is_empty() || suffix == "B" || suffix == "c" || suffix == "cB" {
            1usize
        } else {
            let first = suffix.chars().next().unwrap_or('\0');
            let tail = &suffix[first.len_utf8()..];
            let power = match first.to_ascii_uppercase() {
                'K' => 1u32,
                'M' => 2u32,
                'G' => 3u32,
                'T' => 4u32,
                'P' => 5u32,
                'E' => 6u32,
                'Z' => 7u32,
                'Y' => 8u32,
                'R' => 9u32,
                'Q' => 10u32,
                _ => return Err(format!("dd: invalid number: '{text}'\n")),
            };
            if !matches!(tail, "" | "B" | "iB" | "D") || !"kKMGTPEZYRQ".contains(first) {
                return Err(format!("dd: invalid number: '{text}'\n"));
            }
            let base = if tail == "B" || tail == "D" {
                1000usize
            } else {
                1024usize
            };
            base.saturating_pow(power)
        };
        val = val.saturating_mul(mult);
        product = product.saturating_mul(val);
    }
    if factors.len() > 1 {
        for &factor in &factors[..factors.len() - 1] {
            if factor == "0" && product == 0 {
                warnings.push(
                    "dd: warning: '0x' is a zero multiplier; use '00x' if that is intended\n"
                        .to_string(),
                );
            }
        }
    }
    Ok(product)
}

type DdFileReader<'a> = Box<dyn FnMut(usize, usize) -> Result<Vec<u8>, String> + 'a>;

fn dd_input<'a>(
    fs: &'a dyn SafeBashFs, cwd: &str, name: &str, nofollow: bool,
) -> Result<(Option<usize>, DdFileReader<'a>), String> {
    use crate::vfs::{RedirectAccess, VfsEntryKind};
    let path = absolute_operand(cwd, name);
    if path.is_empty() { return Err("ENOENT: empty path".into()); }
    let entry = fs.access_path(&path, !nofollow)?;
    let descriptor = fs.supports_command_descriptor(&entry);
    if nofollow && !descriptor { return Err("ENOTSUP: operation not supported".into()); }
    let st = if descriptor && !nofollow {
        fs.inspect_command_entry(&entry, true, "stat")?.1
    } else { fs.lstat(&entry)? };
    if nofollow && st.kind == VfsEntryKind::Symlink { return Err("ELOOP: too many symbolic links".into()); }
    if descriptor && (nofollow || st.kind != VfsEntryKind::Directory) {
        if !nofollow { fs.access_path(&entry, true)?; } // openCommandFile checks capabilities.
        if let Some(file) = fs.open_redirect_file(&entry, RedirectAccess::Read, None)? {
            fs.command_descriptor_op()?; // fstat
            return Ok(((!file.is_stream()).then_some(st.size), Box::new(move |pos, size| {
                fs.command_descriptor_op()?;
                file.read_at(pos, size)
            })));
        }
    }
    // The stream adapter checks stat, read permission and capabilities at open,
    // but doesn't start the underlying file stream until the first read.
    fs.inspect_command_entry(&entry, true, "stat")?;
    fs.command_descriptor_op()?;
    if st.mode & 0o400 == 0 { return Err("EACCES: permission denied".into()); }
    fs.command_descriptor_op()?;
    if st.kind == VfsEntryKind::Directory {
        return Ok((None, Box::new(|_, _| Err("EISDIR: is a directory".into()))));
    }
    let mut file: Option<Box<dyn crate::vfs::FileReadHandle>> = None;
    Ok((Some(st.size), Box::new(move |pos, size| {
        if file.is_none() {
            fs.command_descriptor_op()?; // readFileStream capability query
            file = Some(fs.open_read_file(&entry, false)?);
        }
        file.as_ref().unwrap().read(pos as u64, size)
    })))
}

fn dd_output<'a>(
    fs: &'a dyn SafeBashFs, cwd: &str, name: &str, flags: &[&str], conv: &BTreeSet<String>,
    start: usize, mode: u32,
) -> Result<crate::vfs::ChunkWriter<'a>, String> {
    use crate::vfs::RedirectAccess;
    let failed = |e: String| format!("failed to open '{name}': {}", file_error_reason(&e));
    let unsupported = |what: &str| format!("{what}: Operation not supported by the filesystem stream adapter");
    let path = absolute_operand(cwd, name);
    if path.is_empty() { return Err(failed("ENOENT: empty path".into())); }
    let exclusive = conv.contains("excl");
    let no_create = conv.contains("nocreat");
    let append = flags.contains(&"append");
    let keep = conv.contains("notrunc");
    let nofollow = flags.contains(&"nofollow");
    let entry = fs.access_path(&path, !(nofollow || exclusive)).map_err(failed)?;
    if !fs.supports_command_descriptor(&entry) {
        if nofollow { return Err(failed("ENOTSUP: operation not supported".into())); }
        for flag in ["dsync", "sync"] { if flags.contains(&flag) { return Err(unsupported(flag)); } }
        for flag in ["fsync", "fdatasync"] { if conv.contains(flag) { return Err(unsupported(flag)); } }
        if append && !keep && start == 0 { return Err(unsupported("append with truncation")); }
        if start != 0 || keep && !append || no_create { return Err(unsupported("positioned or existing-only output")); }
        return fs.open_command_stream(&path, append, exclusive, mode, None).map_err(failed);
    }
    if nofollow && fs.lstat(&entry).is_ok_and(|s| s.kind == crate::vfs::VfsEntryKind::Symlink) {
        return Err(failed("ELOOP: too many symbolic links".into()));
    }
    if !exclusive && !nofollow { fs.command_create_path(&entry).map_err(failed)?; }
    let access = if exclusive { RedirectAccess::Exclusive } else if !keep && start == 0 { RedirectAccess::Truncate }
        else if append { RedirectAccess::Append } else { RedirectAccess::Write };
    let handle = fs.open_redirect_file(&entry, access, (!no_create).then_some(mode)).map_err(failed)?;
    let Some(handle) = handle else { return fs.open_command_stream(&path, append, false, mode, None).map_err(failed); };
    fs.command_descriptor_op().map_err(failed)?; // fstat on the opened descriptor
    if !keep && start != 0 {
        fs.command_descriptor_op().and_then(|()| handle.truncate_to(start)).map_err(|e| format!("'{name}': cannot seek: {}", file_error_reason(&e)))?;
    }
    let mut offset = start;
    Ok(Box::new(move |chunk| {
        if let Some(bytes) = chunk {
            fs.write_command_file_at(handle.as_ref(), (!append).then_some(offset), bytes)?;
            offset = offset.saturating_add(bytes.len());
        }
        Ok(())
    }))
}

fn cmd_dd(args: &[String], stdin: CommandInput, cwd: &str, env: &BTreeMap<String, String>, fs: &dyn SafeBashFs, write: &mut super::CommandWriter) -> BuiltinOutcome {
    let mut in_file: Option<String> = None;
    let mut out_file: Option<String> = None;
    let mut bs_opt: Option<usize> = None;
    let mut ibs = 512usize;
    let mut obs = 512usize;
    let mut cbs = 0usize;
    let mut skip = 0usize;
    let mut seek = 0usize;
    let mut count: Option<usize> = None;
    let mut count_bytes = false;
    let mut skip_bytes = false;
    let mut seek_bytes = false;
    let mut status_level = "default".to_string();
    let mut conv_set: BTreeSet<String> = BTreeSet::new();
    let mut iflags = Vec::new();
    let mut oflags = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    let allowed_convs = [
        "ascii", "ebcdic", "ibm", "block", "unblock", "lcase", "ucase", "sparse", "swab", "sync",
        "noerror", "notrunc", "excl", "nocreat", "fdatasync", "fsync",
    ];
    let allowed_flags = [
        "append",
        "binary",
        "text",
        "cio",
        "direct",
        "directory",
        "dsync",
        "noatime",
        "nocache",
        "noctty",
        "nofollow",
        "nolinks",
        "nonblock",
        "sync",
        "fullblock",
        "count_bytes",
        "skip_bytes",
        "seek_bytes",
    ];

    for a in args {
        if a == "--" {
            break;
        }
        if a.starts_with("--") && a.len() > 2 {
            let opt = a.split('=').next().unwrap_or(a);
            if "--help".starts_with(opt) {
                if a.contains('=') {
                    return err_out(
                        "dd: option '--help' doesn't allow an argument\nTry 'dd --help' for more information.\n",
                        1,
                    );
                }
                return ok_out(include_str!("help/dd.txt"));
            }
            if "--version".starts_with(opt) {
                if a.contains('=') {
                    return err_out(
                        "dd: option '--version' doesn't allow an argument\nTry 'dd --help' for more information.\n",
                        1,
                    );
                }
                return ok_out("dd (virtual-bash GNU-compatible profile)\n");
            }
            return err_out(
                &format!("dd: unrecognized option `{a}'\nTry 'dd --help' for more information.\n"),
                1,
            );
        }
        if a.starts_with('-') && a != "-" {
            let ch = a.chars().nth(1).unwrap_or('-');
            return err_out(
                &format!("dd: invalid option -- '{ch}'\nTry 'dd --help' for more information.\n"),
                1,
            );
        }
    }

    let mut delim = false;
    for a in args {
        if a == "--" && !delim {
            delim = true;
            continue;
        }
        let Some((name, value)) = a.split_once('=') else {
            return err_out(
                &format!(
                    "{}{}",
                    warnings.concat(),
                    format!("dd: unrecognized operand '{a}'\nTry 'dd --help' for more information.\n")
                ),
                1,
            );
        };
        match name {
            "if" => in_file = Some(value.to_string()),
            "of" => out_file = Some(value.to_string()),
            "conv" => {
                for sym in value.split(',') {
                    if !allowed_convs.contains(&sym) {
                        return err_out(
                            &format!(
                                "{}{}",
                                warnings.concat(),
                                format!("dd: invalid conversion: '{sym}'\nTry 'dd --help' for more information.\n")
                            ),
                            1,
                        );
                    }
                    conv_set.insert(sym.to_string());
                }
            }
            "iflag" => {
                for sym in value.split(',') {
                    if !allowed_flags.contains(&sym) {
                        return err_out(
                            &format!(
                                "{}{}",
                                warnings.concat(),
                                format!("dd: invalid input flag: '{sym}'\nTry 'dd --help' for more information.\n")
                            ),
                            1,
                        );
                    }
                    iflags.push(sym);
                }
            }
            "oflag" => {
                for sym in value.split(',') {
                    if !allowed_flags.contains(&sym) || sym == "fullblock" {
                        return err_out(
                            &format!(
                                "{}{}",
                                warnings.concat(),
                                format!("dd: invalid output flag: '{sym}'\nTry 'dd --help' for more information.\n")
                            ),
                            1,
                        );
                    }
                    oflags.push(sym);
                }
            }
            "status" => {
                for sym in value.split(',') {
                    if !matches!(sym, "none" | "noxfer" | "progress") {
                        return err_out(
                            &format!(
                                "{}{}",
                                warnings.concat(),
                                format!("dd: invalid status level: '{sym}'\nTry 'dd --help' for more information.\n")
                            ),
                            1,
                        );
                    }
                    status_level = sym.to_string();
                }
            }
            "bs" | "ibs" | "obs" | "cbs" | "count" | "skip" | "iseek" | "seek" | "oseek" => {
                let n = match parse_dd_number(value, &mut warnings) {
                    Ok(v) => v,
                    Err(e) => return err_out(&format!("{}{e}", warnings.concat()), 1),
                };
                if matches!(name, "bs" | "ibs" | "obs" | "cbs") && n == 0 {
                    return err_out(
                        &format!("{}{}", warnings.concat(), format!("dd: invalid number: '{value}'\n")),
                        1,
                    );
                }
                match name {
                    "bs" => bs_opt = Some(n),
                    "ibs" => ibs = n,
                    "obs" => obs = n,
                    "cbs" => cbs = n,
                    "count" => {
                        count = Some(n);
                        count_bytes = value.contains('B');
                    }
                    "skip" | "iseek" => {
                        skip = n;
                        skip_bytes = value.contains('B');
                    }
                    "seek" | "oseek" => {
                        seek = n;
                        seek_bytes = value.contains('B');
                    }
                    _ => {}
                }
            }
            _ => {
                return err_out(
                    &format!(
                        "{}{}",
                        warnings.concat(),
                        format!("dd: unrecognized operand '{a}'\nTry 'dd --help' for more information.\n")
                    ),
                    1,
                );
            }
        }
    }

    let two_buffers = bs_opt.is_none() || ["ascii","ebcdic","ibm","block","unblock","swab","lcase","ucase"].iter().any(|f| conv_set.contains(*f));
    if let Some(b) = bs_opt {
        ibs = b;
        obs = b;
    }
    if conv_set.contains("ascii") {
        conv_set.insert("unblock".to_string());
    }
    if conv_set.contains("ebcdic") || conv_set.contains("ibm") {
        conv_set.insert("block".to_string());
    }
    if cbs == 0 {
        conv_set.remove("block");
        conv_set.remove("unblock");
    }

    let exclusive_groups: &[(&[&str], &str)] = &[
        (
            &["ascii", "ebcdic", "ibm"],
            "dd: cannot combine any two of {ascii,ebcdic,ibm}\n",
        ),
        (&["block", "unblock"], "dd: cannot combine block and unblock\n"),
        (&["lcase", "ucase"], "dd: cannot combine lcase and ucase\n"),
        (&["excl", "nocreat"], "dd: cannot combine excl and nocreat\n"),
    ];
    for &(group, msg) in exclusive_groups {
        let active = group.iter().filter(|&&k| conv_set.contains(k)).count();
        if active > 1 {
            return err_out(&format!("{}{msg}", warnings.concat()), 1);
        }
    }
    if (iflags.contains(&"direct") && iflags.contains(&"nocache"))
        || (oflags.contains(&"direct") && oflags.contains(&"nocache"))
    {
        return err_out(
            &format!("{}dd: cannot combine direct and nocache\n", warnings.concat()),
            1,
        );
    }

    count_bytes |= iflags.contains(&"count_bytes");
    skip_bytes |= iflags.contains(&"skip_bytes");
    seek_bytes |= oflags.contains(&"seek_bytes");

    let unsupported = |name: &str| err_out(
        &format!("{}dd: {name}: Operation not supported by the filesystem stream adapter\n", warnings.concat()), 1,
    );
    let check_flags = |flags: &[&str], named_output: bool| {
        flags.iter().copied().find(|&flag| !matches!(flag,
            "binary" | "text" | "noctty" | "count_bytes" | "skip_bytes" | "seek_bytes" | "fullblock" | "append" | "nofollow"
        ) && !(named_output && matches!(flag, "dsync" | "sync"))).map(unsupported)
    };
    if let Some(error) = check_flags(&iflags, false) { return error; }

    let skip_offset = if skip_bytes { skip } else { skip.saturating_mul(ibs) };
    let mut file_input = None;
    let mut input_size = None;
    if let Some(name) = in_file.as_deref() {
        let reader: DdFileReader = if name == "/dev/null" {
            Box::new(|_, _| Ok(Vec::new()))
        } else if name == "/dev/zero" {
            let length = count.map_or(0, |n| if count_bytes { n } else { n.saturating_mul(ibs) });
            let end = skip_offset.saturating_add(length).min(16 * 1024 * 1024);
            Box::new(move |pos, size| Ok(vec![0; end.saturating_sub(pos).min(size)]))
        } else {
            match dd_input(fs, cwd, name, iflags.contains(&"nofollow")) {
                Ok((size, reader)) => { input_size = size; reader }
                Err(e) => return err_out(&format!("{}dd: failed to open '{name}': {}\n", warnings.concat(), file_error_reason(&e)), 1),
            }
        };
        file_input = Some(reader);
    }

    if let Some(error) = check_flags(&oflags, out_file.is_some()) { return error; }
    if out_file.is_none() {
        for sync in ["fsync", "fdatasync"] {
            if conv_set.contains(sync) { return unsupported(sync); }
        }
        if oflags.contains(&"append") && !conv_set.contains("notrunc") && seek == 0 {
            return unsupported("append with truncation");
        }
    }

    let mut target = None;
    if let Some(name) = out_file.as_deref().filter(|p| *p != "/dev/null") {
        let start = if seek_bytes { seek } else { seek.saturating_mul(obs) };
        let mode = 0o666 & !env.get("\0umask").and_then(|v| u32::from_str_radix(v, 8).ok()).unwrap_or(0o022);
        match dd_output(fs, cwd, name, &oflags, &conv_set, start, mode) {
            Ok(writer) => target = Some(writer),
            Err(message) => return err_out(&format!("{}dd: {message}\n", warnings.concat()), 1),
        }
    }

    let translate_hex = |hex: &str, b: u8| -> u8 {
        let idx = (b as usize) * 2;
        u8::from_str_radix(&hex[idx..idx + 2], 16).unwrap_or(b)
    };

    let mut table = [0u8; 256];
    for idx in 0..256usize {
        let mut v = if conv_set.contains("ascii") {
            translate_hex(DD_ASCII_HEX, idx as u8)
        } else {
            idx as u8
        };
        if conv_set.contains("lcase") && v.is_ascii_uppercase() {
            v = v.to_ascii_lowercase();
        }
        if conv_set.contains("ucase") && v.is_ascii_lowercase() {
            v = v.to_ascii_uppercase();
        }
        if conv_set.contains("ebcdic") {
            v = translate_hex(DD_EBCDIC_HEX, v);
        }
        if conv_set.contains("ibm") {
            v = translate_hex(DD_IBM_HEX, v);
        }
        table[idx] = v;
    }

    let newline_byte = if conv_set.contains("ebcdic") || conv_set.contains("ibm") {
        37u8
    } else {
        b'\n'
    };
    let space_byte = if conv_set.contains("ebcdic") || conv_set.contains("ibm") {
        64u8
    } else {
        b' '
    };
    let do_block = conv_set.contains("block");
    let do_unblock = conv_set.contains("unblock");
    let do_swab = conv_set.contains("swab");

    let mut result = ok_out("");
    let mut output_record = Vec::new();
    let mut total_b = 0u64;
    let mut output_full = 0usize;
    let mut output_partial = 0usize;
    let sync = conv_set.contains("sync");
    let mut write_record = |record: &[u8]| {
        if out_file.is_none() {
            if !write(1, &crate::vfs::bytes_to_stream_string(record), &mut result) { return false; }
        } else if let Some(target) = &mut target && let Err(e) = target(Some(record)) {
            let stage = if two_buffers && record.len() == obs { "writing to" } else { "error writing" };
            result.stderr.push_str(&format!("dd: {stage} '{}': {}\n", out_file.as_deref().unwrap(), file_error_reason(&e)));
            result.exit_code = 1;
            return false;
        }
        if record.len() == obs { output_full += 1; } else { output_partial += 1; }
        total_b += record.len() as u64;
        true
    };
    let mut emit = |mut bytes: &[u8]| -> Result<(), ()> {
        if !two_buffers && !sync { return write_record(bytes).then_some(()).ok_or(()); }
        while !bytes.is_empty() {
            if output_record.is_empty() && bytes.len() >= obs {
                if !write_record(&bytes[..obs]) { return Err(()); }
                bytes = &bytes[obs..];
            } else {
                let n = bytes.len().min(obs - output_record.len());
                output_record.extend_from_slice(&bytes[..n]);
                bytes = &bytes[n..];
                if output_record.len() == obs {
                    if !write_record(&output_record) { return Err(()); }
                    output_record.clear();
                }
            }
        }
        Ok(())
    };
    let mut column = 0usize;
    let mut spaces = 0usize;
    let mut saved: Option<u8> = None;
    let mut truncated = 0usize;

    let mut record_byte = |b: u8, emit: &mut dyn FnMut(&[u8]) -> Result<(), ()>| -> Result<(), ()> {
        if do_block {
            if b == newline_byte {
                while column < cbs { emit(&[space_byte])?; column += 1; }
                column = 0;
            } else {
                if column < cbs { emit(&[b])?; }
                else if column == cbs { truncated += 1; }
                column = column.saturating_add(1).min(cbs.saturating_add(1));
            }
        } else if do_unblock {
            if column == cbs { emit(&[newline_byte])?; column = 0; spaces = 0; }
            column += 1;
            if b == space_byte { spaces += 1; }
            else {
                while spaces > 0 { emit(&[space_byte])?; spaces -= 1; }
                emit(&[b])?;
            }
        } else { emit(&[b])?; }
        Ok(())
    };

    let mut input_full = 0usize;
    let mut input_partial = 0usize;
    let sync_fill = if do_block || do_unblock { b' ' } else { 0 };
    let translate = ["ascii", "ebcdic", "ibm", "lcase", "ucase"].iter().any(|name| conv_set.contains(*name));
    let plain = !translate && !do_block && !do_unblock && !do_swab;
    let mut record = |bytes: &[u8]| -> Result<(), ()> {
        if bytes.len() == ibs { input_full += 1; } else { input_partial += 1; }
        let padding = if sync { ibs - bytes.len() } else { 0 };
        if plain {
            emit(bytes)?;
            let zeros = [0u8; 512];
            let mut left = padding;
            while left > 0 {
                let n = left.min(zeros.len());
                emit(&zeros[..n])?;
                left -= n;
            }
            return Ok(());
        }
        for raw in bytes.iter().copied().chain(std::iter::repeat_n(sync_fill, padding)) {
            let v = table[raw as usize];
            if do_swab {
                if let Some(prev) = saved.take() { record_byte(v, &mut emit)?; record_byte(prev, &mut emit)?; }
                else { saved = Some(v); }
            } else { record_byte(v, &mut emit)?; }
        }
        Ok(())
    };

    let mut writable = true;
    let mut read_error = None;
    if let Some(mut read) = file_input {
        let mut pos = skip_offset;
        let mut records = count.map_or(usize::MAX, |n| if count_bytes { n / ibs } else { n });
        let mut tail = if count_bytes { count.unwrap_or(0) % ibs } else { 0 };
        let fullblock = iflags.contains(&"fullblock");
        let mut previous_short = 0;
        let mut warned = false;
        while records != 0 || tail != 0 {
            let wanted = if records != 0 { records -= 1; ibs } else { std::mem::take(&mut tail) };
            let mut bytes = match read(pos, wanted) {
                Ok(bytes) if bytes.is_empty() => break,
                Ok(bytes) => bytes,
                Err(e) => { read_error = Some(e); break; }
            };
            pos = pos.saturating_add(bytes.len());
            while fullblock && bytes.len() < wanted {
                match read(pos, wanted - bytes.len()) {
                    Ok(next) if next.is_empty() => break,
                    Ok(next) => { pos = pos.saturating_add(next.len()); bytes.extend(next); }
                    Err(e) => { read_error = Some(e); break; }
                }
            }
            if read_error.is_some() { break; }
            if previous_short != 0 && !warned && !two_buffers && !fullblock
                && (skip != 0 || count.is_some()) && status_level != "none" {
                warnings.push(format!("dd: warning: partial read ({previous_short} byte{}); suggest iflag=fullblock\n",
                    if previous_short == 1 { "" } else { "s" }));
                warned = true;
            }
            previous_short = if bytes.len() < ibs { bytes.len() } else { 0 };
            writable = record(&bytes).is_ok();
            if !writable { break; }
        }
    } else {
        // Without a seekable input, count=0 still skips whole 512-byte records.
        let mut skip_left = if count == Some(0)
            && stdin.file.is_some_and(|s| matches!(s.source, super::InputSource::Chunks(_))) {
            let records = if skip_bytes { skip / ibs } else { skip };
            records.saturating_mul(512).saturating_add(if skip_bytes { skip % ibs } else { 0 })
        } else { skip_offset };
        let maximum = count.map_or(usize::MAX, |n| skip_left.saturating_add(if count_bytes { n } else { n.saturating_mul(ibs) }));
        let mut partial = Vec::new();
        let mut consume = |chunk: &[u8], _: bool| {
            let skipped = skip_left.min(chunk.len());
            skip_left -= skipped;
            let mut used = skipped;
            while used < chunk.len() {
                let n = (ibs - partial.len()).min(chunk.len() - used);
                let bytes = &chunk[used..used + n];
                used += n;
                if partial.is_empty() && n == ibs {
                    writable = record(bytes).is_ok();
                } else {
                    partial.extend_from_slice(bytes);
                    if partial.len() == ibs {
                        writable = record(&partial).is_ok();
                        partial.clear();
                    }
                }
                if !writable { break; }
            }
            Ok((writable, used))
        };
        if maximum != 0 {
            let read = if let Some(source) = stdin.file {
                source.admit_bounded_read().and_then(|()| source.read(stdin.text, maximum, consume))
            } else {
                let bytes = stream_string_to_bytes(stdin.text);
                if bytes.len() > fs.max_input_bytes() {
                    return err_out(&fs.limit_error("maxInputBytes", fs.max_input_bytes()), 1);
                }
                consume(&bytes[..bytes.len().min(maximum)], false).map(|(_, used)| {
                    *stdin.text = crate::vfs::bytes_to_stream_string(&bytes[used..]);
                })
            };
            if let Err(e) = read {
                result.stderr.push_str(&format!("dd: error reading 'standard input': {e}\n"));
                result.exit_code = 1;
                return result;
            }
        }
        if writable && !partial.is_empty() { writable = record(&partial).is_ok(); }
    }
    if writable && let Some(prev) = saved { writable = record_byte(prev, &mut emit).is_ok(); }
    if writable && do_block && column > 0 {
        while writable && column < cbs { writable = emit(&[space_byte]).is_ok(); column += 1; }
    }
    if writable && do_unblock && column > 0 { writable = emit(&[newline_byte]).is_ok(); }
    if writable && !output_record.is_empty() { writable = write_record(&output_record); }

    let mut stderr = warnings.concat();
    if let Some(e) = read_error {
        stderr.push_str(&format!("dd: error reading '{}': {}\n", in_file.as_deref().unwrap(), file_error_reason(&e)));
        result.exit_code = 1;
    }
    if status_level != "none" {
        if input_size.is_some_and(|n| n < skip_offset) {
            stderr.push_str(&format!("dd: '{}': cannot skip to specified offset\n", in_file.as_deref().unwrap()));
        }
        stderr.push_str(&format!(
            "{input_full}+{input_partial} records in\n{output_full}+{output_partial} records out\n"
        ));
        if truncated > 0 {
            stderr.push_str(&format!(
                "{truncated} truncated record{}\n",
                if truncated == 1 { "" } else { "s" }
            ));
        }
        if status_level != "noxfer" {
            stderr.push_str(&format!(
                "{total_b} {} copied, 0 s, Infinity B/s\n",
                if total_b == 1 { "byte" } else { "bytes" }
            ));
        }
    }

    if writable && let Some(mut target) = target && let Err(e) = target(None) {
        result.stderr.push_str(&format!("dd: closing output file '{}': {}\n", out_file.as_deref().unwrap(), file_error_reason(&e)));
        result.exit_code = 1;
    }
    result.stderr.push_str(&stderr);
    result
}

fn ensure_install_dirs(
    display: &str,
    final_mode: Option<(u32, u32)>,
    verbose: bool,
    cwd: &str,
    fs: &dyn SafeBashFs,
    out_buf: &mut String,
) -> Result<(), String> {
    if display.is_empty() {
        return Err("cannot create directory '': No such file or directory".into());
    }
    let mut current = if display.starts_with('/') {
        "/".to_owned()
    } else {
        String::new()
    };
    let mut parts = display.split('/').filter(|s| !s.is_empty()).peekable();
    loop {
        let part = parts.next().unwrap_or(".");
        if !current.is_empty() && current != "/" {
            current.push('/');
        }
        current.push_str(part);
        let label = fmt_quote::quote(&current, true, false);
        let fail = |e: String| format!("cannot create directory {label}: {}", file_error_reason(&e));
        let operand = absolute_operand(cwd, &current);
        let mode = final_mode.filter(|_| parts.peek().is_none());
        match fs.inspect_command_entry(&operand, true, "stat") {
            Ok((_, st)) if st.kind != crate::vfs::VfsEntryKind::Directory => {
                return Err(fail("ENOTDIR: not a directory".into()));
            }
            Ok((path, st)) => {
                if let Some((bits, mask)) = mode {
                    let wanted = st.mode & 0o7777 & !mask | bits;
                    if st.mode & 0o7777 != wanted {
                        fs.chmod(&path, wanted).map_err(|e| {
                            format!(
                                "cannot change permissions of {label}: {}",
                                file_error_reason(&e)
                            )
                        })?;
                    }
                }
            }
            Err(e) if file_error_reason(&e) == "No such file or directory" => {
                let path = fs.access_path(&operand, false).map_err(fail)?;
                fs.mkdir_one(&path, mode.map_or(0o755, |(bits, _)| bits))
                    .map_err(fail)?;
                if verbose {
                    out_buf.push_str(&format!("install: creating directory {label}\n"));
                }
            }
            Err(e) => return Err(fail(e)),
        }
        if parts.peek().is_none() {
            return Ok(());
        }
    }
}

fn file_error_reason(error: &str) -> &str {
    if error.ends_with("(os error 2)") {
        return "No such file or directory";
    }
    match error.split_once(':').map(|(code, _)| code) {
        Some("ENOENT") => "No such file or directory",
        Some("EACCES") => "Permission denied",
        Some("EPERM") => "Operation not permitted",
        Some("EEXIST") => "File exists",
        Some("EISDIR") => "Is a directory",
        Some("ENOTDIR") => "Not a directory",
        Some("ELOOP") => "Too many levels of symbolic links",
        Some("EROFS") => "Read-only file system",
        Some("ENOTSUP" | "EOPNOTSUPP") => "Operation not supported",
        Some("EIO") => "Input/output error",
        Some("ENOSPC") => "No space left on device",
        Some("EINVAL") => "Invalid argument",
        Some("EFBIG") => "File too large",
        Some("ENOTEMPTY") => "Directory not empty",
        _ => error,
    }
}

fn install_account(text: Option<&str>, kind: &str) -> Result<bool, String> {
    let Some(text) = text else { return Ok(false) };
    let digits = text.trim_start_matches([' ', '\t', '\n', '\r', '\x0b', '\x0c']);
    let digits = digits.strip_prefix('+').unwrap_or(digits);
    let (base, digits) = if let Some(hex) = digits
        .strip_prefix("0x")
        .or_else(|| digits.strip_prefix("0X"))
    {
        (16, hex)
    } else if digits.starts_with('0') && digits.len() > 1 {
        (8, &digits[1..])
    } else {
        (10, digits)
    };
    let quoted = fmt_quote::quote(text, true, false);
    if digits.is_empty() || !digits.chars().all(|c| c.is_digit(base)) {
        if text.starts_with(|c: char| !c.is_ascii_digit() && c != '+' && c != '-') {
            return Err(format!(
                "cannot resolve {kind} {quoted}: Operation not supported (account database unavailable)"
            ));
        }
        return Err(format!("invalid {kind} {quoted}"));
    }
    u32::from_str_radix(digits, base)
        .map(|id| id != u32::MAX)
        .map_err(|_| format!("invalid {kind} {quoted}"))
}

fn cmd_install(
    args: &[String],
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut create_dirs = false;
    let mut dir_mode = false;
    let mut make_backups = false;
    let mut backup_control: Option<String> = None;
    let mut suffix = env
        .get("SIMPLE_BACKUP_SUFFIX")
        .filter(|s| !s.is_empty() && !s.contains('/'))
        .cloned()
        .unwrap_or_else(|| "~".to_string());
    let mut compare_mode = false;
    let mut preserve_ts = false;
    let mut strip_mode = false;
    let mut verbose = false;
    let mut no_target_dir = false;
    let mut target_dir: Option<String> = None;
    let mut mode_spec: Option<String> = None;
    let mut ended = false;
    let mut files = Vec::new();
    let posix = env.contains_key("POSIXLY_CORRECT");

    let long_opts = [
        ("backup", "b"),
        ("compare", "C"),
        ("context", "Z"),
        ("debug", "debug"),
        ("directory", "d"),
        ("group", "g"),
        ("mode", "m"),
        ("no-target-directory", "T"),
        ("owner", "o"),
        ("preserve-timestamps", "p"),
        ("preserve-context", "preserve-context"),
        ("strip", "s"),
        ("strip-program", "strip-program"),
        ("suffix", "S"),
        ("target-directory", "t"),
        ("verbose", "v"),
        ("help", "help"),
        ("version", "version"),
    ];

    let usage = |message: &str| {
        err_out(
            &format!("install: {message}\nTry 'install --help' for more information.\n"),
            1,
        )
    };
    let (mut owner, mut group) = (None, None);
    let (mut preserve_context, mut set_context, mut strip_program) = (false, false, false);
    let mut arguments = args.iter();
    while let Some(a) = arguments.next() {
        if ended || a == "-" || !a.starts_with('-') {
            files.push(a.clone());
            ended |= posix;
            continue;
        }
        if a == "--" {
            ended = true;
            continue;
        }
        let long = a.strip_prefix("--");
        let mut keys = &a[1..];
        let mut name = "";
        let mut value = None;
        if let Some(rest) = long {
            let (prefix, attached) = rest
                .split_once('=')
                .map_or((rest, None), |(n, v)| (n, Some(v)));
            let matches: Vec<_> = long_opts
                .iter()
                .filter(|(n, ..)| n.starts_with(prefix))
                .collect();
            let selected = long_opts.iter().find(|(n, ..)| *n == prefix);
            let &(full, key) = match (selected, matches.as_slice()) {
                (Some(option), _) => option,
                (None, [option]) => *option,
                (_, []) => return usage(&format!("unrecognized option '{a}'")),
                _ => {
                    return usage(&format!(
                        "option '{a}' is ambiguous; possibilities: {}",
                        matches
                            .iter()
                            .map(|(n, ..)| format!("'--{n}'"))
                            .collect::<Vec<_>>()
                            .join(" ")
                    ));
                }
            };

            name = full;
            keys = key;
            value = attached;
        }
        while !keys.is_empty() {
            let (key, tail) = if long.is_some() {
                (keys, "")
            } else {
                keys.split_at(keys.chars().next().unwrap().len_utf8())
            };
            keys = tail;
            if matches!(key, "g" | "m" | "o" | "t" | "S" | "strip-program") {
                value = value.or_else(|| {
                    if tail.is_empty() {
                        arguments.next().map(String::as_str)
                    } else {
                        Some(tail)
                    }
                });
                if value.is_none() {
                    return if long.is_some() {
                        usage(&format!("option '--{name}' requires an argument"))
                    } else {
                        usage(&format!("option requires an argument -- '{key}'"))
                    };
                }
                keys = "";
            } else if value.is_some() && !matches!(key, "b" | "Z") {
                return usage(&format!("option '--{name}' doesn't allow an argument"));
            }
            match key {
                "help" => return ok_out(include_str!("help/install.txt")),
                "version" => return ok_out("install (safe-bash; GNU coreutils 9.7 target)\n"),
                "b" => {
                    make_backups = true;
                    if let Some(v) = value {
                        backup_control = Some(v.to_owned());
                    }
                }
                "c" => {}
                "d" => dir_mode = true,
                "D" => create_dirs = true,
                "C" => compare_mode = true,
                "p" => preserve_ts = true,
                "s" => strip_mode = true,
                "T" => no_target_dir = true,
                "v" | "debug" => verbose = true,
                "g" => group = value,
                "o" => owner = value,
                "m" => mode_spec = value.map(str::to_owned),
                "t" => {
                    if target_dir.is_some() {
                        return err_out("install: multiple target directories specified\n", 1);
                    }
                    target_dir = value.map(str::to_owned);
                }
                "S" => {
                    make_backups = true;
                    suffix = value
                        .filter(|s| !s.is_empty() && !s.contains('/'))
                        .unwrap_or("~")
                        .to_owned();
                }
                "strip-program" => strip_program = true,
                "preserve-context" => preserve_context = true,
                "Z" => set_context = true,
                _ => return usage(&format!("invalid option -- '{key}'")),
            }
        }
    }

    if dir_mode && strip_mode {
        return err_out(
            "install: the strip option may not be used when installing a directory\n",
            1,
        );
    }
    if dir_mode && target_dir.is_some() {
        return err_out(
            "install: target directory not allowed when installing a directory\n",
            1,
        );
    }
    use super::fs::{BackupMode, parse_backup_control};
    let control = make_backups.then(|| {
        backup_control
            .as_deref()
            .filter(|s| !s.is_empty())
            .or_else(|| {
                env.get("VERSION_CONTROL")
                    .map(String::as_str)
                    .filter(|s| !s.is_empty())
            })
            .unwrap_or("existing")
    });
    let backup_mode = match parse_backup_control(control) {
        Ok(mode) => mode,
        Err(message) => {
            return usage(&format!(
                "{message}\nValid arguments are:\n  - 'none', 'off'\n  - 'simple', 'never'\n  - 'existing', 'nil'\n  - 'numbered', 't'"
            ));
        }
    };
    if preserve_context && set_context {
        return err_out("install: cannot set target context and preserve it\n", 1);
    }
    if files.is_empty() {
        return usage("missing file operand");
    }
    if files.len() == 1 && !dir_mode && target_dir.is_none() {
        return usage(&format!(
            "missing destination file operand after {}",
            fmt_quote::quote(&files[0], true, false)
        ));
    }
    if no_target_dir && target_dir.is_some() {
        return err_out(
            "install: cannot combine --target-directory (-t) and --no-target-directory (-T)\n",
            1,
        );
    }
    if no_target_dir && files.len() > 2 {
        return usage(&format!(
            "extra operand {}",
            fmt_quote::quote(&files[2], true, false)
        ));
    }

    let mut out_buf = String::new();
    let mut err_buf = String::new();
    let mut exit_code = 0;

    let mut sources = files;
    let mut target_dir_opt = target_dir;
    let mut single_dest_opt = None;
    if !dir_mode {
        let explicit = target_dir_opt.is_some();
        let target = target_dir_opt.as_ref().unwrap_or_else(|| sources.last().unwrap());
        let target_label = fmt_quote::quote(target, true, false);
        if explicit && target.is_empty() {
            return err_out("install: failed to access '': No such file or directory\n", 1);
        }
        let kind = if no_target_dir || target.is_empty() {
            None
        } else {
            match fs.inspect_command_entry(&absolute_operand(cwd, target), true, "stat") {
                Ok((_, stat)) => Some(stat.kind),
                Err(e) => match file_error_reason(&e) {
                    "No such file or directory" => None,
                    "Not a directory" | "Too many levels of symbolic links" if !explicit => None,
                    reason if explicit => return err_out(&format!("install: failed to access {target_label}: {reason}\n"), 1),
                    _ => return err_out(&format!("install: {e}\n"), 1),
                }
            }
        };
        if kind == Some(VfsEntryKind::Directory) {
            if !explicit { target_dir_opt = sources.pop(); }
        } else if explicit || sources.len() > 2 {
            if !(explicit && create_dirs && kind.is_none()) {
                let action = if explicit { "failed to access" } else { "target" };
                let reason = if kind.is_some() { "Not a directory" } else { "No such file or directory" };
                return err_out(&format!("install: {action} {target_label}: {reason}\n"), 1);
            }
        } else {
            single_dest_opt = sources.pop();
        }
    }

    let (target_mode, mode_mask) = match mode_spec.as_deref() {
        None => (0o755, 0o7777),
        Some(spec) => match super::fs::eval_chmod_mode_checked(spec, 0, dir_mode, None) {
            Ok(mode) => mode,
            Err(_) => {
                return err_out(
                    &format!(
                        "install: invalid mode {}\n",
                        fmt_quote::quote(spec, false, false)
                    ),
                    1,
                );
            }
        },
    };
    if strip_program && !strip_mode {
        err_buf.push_str(
            "install: WARNING: ignoring --strip-program option as -s option was not specified\n",
        );
    }
    if compare_mode && (preserve_ts || strip_mode) {
        let option = if preserve_ts {
            "--preserve-timestamps"
        } else {
            "--strip"
        };
        return err_out(
            &format!(
                "{err_buf}install: options --compare (-C) and {option} are mutually exclusive\nTry 'install --help' for more information.\n"
            ),
            1,
        );
    }
    if compare_mode && target_mode & 0o7000 != 0 {
        err_buf.push_str("install: the --compare (-C) option is ignored when you specify a mode with non-permission bits\n");
    }
    let fail = |message: &str| err_out(&format!("{err_buf}install: {message}\n"), 1);
    let mut change_owner = false;
    for (value, kind) in [(owner, "user"), (group, "group")] {
        match install_account(value, kind) {
            Ok(change) => change_owner |= change,
            Err(message) => return fail(&message),
        }
    }
    if change_owner {
        return fail("cannot set ownership: Operation not supported (chown unavailable)");
    }
    if strip_mode {
        return fail(
            "cannot strip files: Operation not supported (trusted strip hook unavailable)",
        );
    }
    if set_context || preserve_context {
        return fail(
            "cannot apply security context: Operation not supported (host profile unavailable)",
        );
    }
    if dir_mode {
        for f in &sources {
            if let Err(e) = ensure_install_dirs(
                f,
                Some((target_mode, mode_mask)),
                verbose,
                cwd,
                fs,
                &mut out_buf,
            ) {
                err_buf.push_str(&format!("install: {e}\n"));
                exit_code = 1;
            }
        }
        return BuiltinOutcome {
            stdout: out_buf,
            stderr: err_buf,
            exit_code,
        };
    }
    if create_dirs
        && let Some(ref td) = target_dir_opt
        && let Err(e) = ensure_install_dirs(td, None, verbose, cwd, fs, &mut out_buf)
    {
        err_buf.push_str(&format!("install: {e}\n"));
        return BuiltinOutcome {
            stdout: out_buf,
            stderr: err_buf,
            exit_code: 1,
        };
    }

    use crate::vfs::VfsEntryKind;
    let mut installed = BTreeMap::new();
    for src_arg in &sources {
        let result = (|| -> Result<(), String> {
            let display = match &target_dir_opt {
                Some(td) => format!(
                    "{}/{}",
                    td.trim_end_matches('/'),
                    crate::vfs::basename_posix_path(src_arg)
                ),
                None => single_dest_opt.as_ref().unwrap().clone(),
            };
            let src_label = fmt_quote::quote(src_arg, true, false);
            let dst_label = fmt_quote::quote(&display, true, false);
            if create_dirs {
                ensure_install_dirs(
                    &dirname_posix_path(&display),
                    None,
                    verbose,
                    cwd,
                    fs,
                    &mut out_buf,
                )?;
            }
            let (src, source) = fs
                .inspect_command_entry(&absolute_operand(cwd, src_arg), true, "stat")
                .map_err(|e| format!("cannot stat {src_label}: {}", file_error_reason(&e)))?;
            let directory_error =
                || format!("cannot overwrite directory {dst_label} with non-directory {src_label}");
            if source.kind == VfsEntryKind::Directory {
                return Err(format!("omitting directory {src_label}"));
            }
            if display.is_empty() {
                return Err(directory_error());
            }
            let create_error = |e: String| {
                format!(
                    "cannot create regular file {dst_label}: {}",
                    file_error_reason(&e)
                )
            };
            let operand = absolute_operand(cwd, &display);
            let dst = match fs.access_path(&operand, false) {
                Ok(path) => path,
                Err(e) if file_error_reason(&e) == "No such file or directory" => {
                    if verbose {
                        out_buf.push_str(&format!("{src_label} -> {dst_label}\n"));
                    }
                    return Err(create_error(e));
                }
                Err(e) => return Err(create_error(e)),
            };
            let target = match fs.lstat(&dst) {
                Ok(st) => Some(st),
                Err(e) if file_error_reason(&e) == "No such file or directory" => None,
                Err(e) => return Err(create_error(e)),
            };
            let mut backup = None;
            if let Some(st) = &target {
                if backup_mode != BackupMode::Numbered && installed.get(&dst) == Some(&st.identity)
                {
                    return Err(format!(
                        "will not overwrite just-created {dst_label} with {src_label}"
                    ));
                }
                if st.kind == VfsEntryKind::Directory {
                    return Err(directory_error());
                }
                if st.kind == VfsEntryKind::File {
                    if src == dst {
                        return Err(format!("{src_label} and {dst_label} are the same file"));
                    }
                    if st.identity.is_none() || source.identity.is_none() {
                        return Err(
                            "cannot establish source/destination identity: Operation not supported"
                                .into(),
                        );
                    }
                }
                if compare_mode
                    && st.kind == VfsEntryKind::File
                    && source.kind == VfsEntryKind::File
                    && (st.mode | source.mode | target_mode) & 0o7000 == 0
                    && source.size == st.size
                    && st.mode & 0o7777 == target_mode
                {
                    return Err("cannot compare ownership: Operation not supported (caller or file identity unavailable)".into());
                }
            }
            let bytes = fs.read_file(&src).map_err(create_error)?;
            if let Some(st) = target {
                if backup_mode == BackupMode::None {
                    fs.remove_one(&dst, false).map_err(|e| {
                        format!("cannot remove {dst_label}: {}", file_error_reason(&e))
                    })?;
                    if verbose {
                        out_buf.push_str(&format!("removed {dst_label}\n"));
                    }
                } else {
                    let backup_error =
                        |e: String| format!("cannot backup {dst_label}: {}", file_error_reason(&e));
                    let (path, numbered) = super::fs::backup_path(&dst, backup_mode, &suffix, fs)
                        .map_err(backup_error)?;
                    let label =
                        fmt_quote::quote(&format!("{display}{}", &path[dst.len()..]), true, false);
                    match fs.lstat(&path) {
                        Ok(_) if src == path => {
                            return Err(format!(
                                "backing up {dst_label} might destroy source;  {src_label} not copied"
                            ));
                        }
                        Ok(previous)
                            if previous.identity.is_none() || source.identity.is_none() =>
                        {
                            return Err(format!(
                                "cannot safely replace backup {label}: Operation not supported (unknown identity)"
                            ));
                        }
                        Err(e) if file_error_reason(&e) != "No such file or directory" => {
                            return Err(backup_error(e));
                        }
                        _ => {}
                    }
                    if numbered && st.kind != VfsEntryKind::File {
                        return Err(format!(
                            "cannot backup {dst_label}: Operation not supported"
                        ));
                    }
                    fs.rename(&dst, &path, numbered).map_err(backup_error)?;
                    backup = Some((path, label));
                }
            }
            if verbose {
                out_buf.push_str(&format!("{src_label} -> {dst_label}"));
                if let Some((_, label)) = &backup {
                    out_buf.push_str(&format!(" (backup: {label})"));
                }
                out_buf.push('\n');
            }
            if let Err(e) = fs.create_file(&dst, &bytes, target_mode) {
                if let Some((path, label)) = backup
                    && fs.rename(&path, &dst, true).is_ok()
                    && verbose
                {
                    out_buf.push_str(&format!("{label} -> {dst_label} (unbackup)\n"));
                }
                return Err(create_error(e));
            }
            if preserve_ts {
                fs.set_times(&dst, Some(source.atime_ms), Some(source.mtime_ms))
                    .map_err(|e| {
                        format!("preserving times for {dst_label}: {}", file_error_reason(&e))
                    })?;
            }
            if sources.len() > 1 {
                installed.insert(dst.clone(), fs.lstat(&dst).map_err(create_error)?.identity);
            }
            Ok(())
        })();
        if let Err(e) = result {
            exit_code = 1;
            err_buf.push_str(&format!("install: {e}\n"));
        }
    }
    BuiltinOutcome {
        stdout: out_buf,
        stderr: err_buf,
        exit_code,
    }
}

fn compare_join_keys(left: &[u8], right: &[u8], fold: bool) -> std::cmp::Ordering {
    for idx in 0..left.len().min(right.len()) {
        let mut a = left[idx];
        let mut b = right[idx];
        if fold {
            a = a.to_ascii_lowercase();
            b = b.to_ascii_lowercase();
        }
        if a != b {
            return a.cmp(&b);
        }
    }
    left.len().cmp(&right.len())
}

fn cmd_join(args: &[String], mut stdin: CommandInput, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum OrderMode {
        Default,
        Check,
        None,
    }
    #[derive(Clone)]
    enum JoinFormat {
        Default,
        Auto,
        Explicit(Vec<(usize, usize)>),
    }

    let mut files: Vec<String> = Vec::new();
    let mut fields = [0usize, 0usize];
    let mut explicit_fields: [Option<usize>; 2] = [None, None];
    let mut unpaired = [false, false];
    let mut paired = true;
    let mut separator = b'\n';
    let mut delimiter: Option<u8> = None;
    let mut delimiter_choice: Option<i32> = None;
    let mut whole = false;
    let mut replacement: Vec<u8> = Vec::new();
    let mut explicit_replacement: Option<String> = None;
    let mut format = JoinFormat::Default;
    let mut fold = false;
    let mut header = false;
    let mut order_mode = OrderMode::Default;
    let mut literal = false;
    let mut field_candidates: Vec<Option<u8>> = Vec::new();
    let mut pending_fields = [0usize, 0usize];
    let mut next_field_candidate: Option<u8> = None;

    let parse_pos_num = |val: &str, label: &str| -> Result<usize, String> {
        let s = val.strip_prefix('+').unwrap_or(val);
        if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
            return Err(format!("join: EINVAL: invalid {label}: {val}\n"));
        }
        let n = s
            .parse::<usize>()
            .map_err(|_| format!("join: EINVAL: invalid {label}: {val}\n"))?;
        if n < 1 {
            return Err(format!("join: EINVAL: invalid {label}: {val}\n"));
        }
        Ok(n)
    };

    let set_field = |file_idx: usize,
                     field: usize,
                     explicit_fields: &mut [Option<usize>; 2],
                     fields: &mut [usize; 2]|
     -> Result<(), String> {
        if let Some(existing) = explicit_fields[file_idx]
            && existing != field
        {
            return Err(format!(
                "join: EINVAL: incompatible join fields {}, {}\n",
                existing, field
            ));
        }
        explicit_fields[file_idx] = Some(field);
        fields[file_idx] = field;
        Ok(())
    };

    let mut apply_flag = |flag: char,
                          value: &str,
                          explicit_fields: &mut [Option<usize>; 2],
                          fields: &mut [usize; 2]|
     -> Result<(), String> {
        match flag {
            '1' | '2' | 'j' => {
                let f = parse_pos_num(value, "field")? - 1;
                if flag != '2' {
                    set_field(0, f, explicit_fields, fields)?;
                }
                if flag != '1' {
                    set_field(1, f, explicit_fields, fields)?;
                }
            }
            'a' | 'v' => {
                if value != "1" && value != "2" {
                    return Err(format!("join: EINVAL: invalid file number: {value}\n"));
                }
                let f_idx = if value == "1" { 0 } else { 1 };
                unpaired[f_idx] = true;
                if flag == 'v' {
                    paired = false;
                }
            }
            'e' => {
                if let Some(ref ex) = explicit_replacement
                    && ex != value
                {
                    return Err(
                        "join: EINVAL: conflicting empty-field replacement strings\n".to_string(),
                    );
                }
                explicit_replacement = Some(value.to_string());
                replacement = crate::vfs::stream_string_to_bytes(value);
            }
            't' => {
                let bytes = crate::vfs::stream_string_to_bytes(value);
                let choice = if value == "\\0" {
                    0
                } else if !bytes.is_empty() {
                    bytes[0] as i32
                } else {
                    -1
                };
                if let Some(prev_c) = delimiter_choice
                    && prev_c != choice
                {
                    return Err("join: EINVAL: incompatible field delimiters\n".to_string());
                }
                delimiter_choice = Some(choice);
                if value == "\\0" {
                    delimiter = Some(0u8);
                    whole = false;
                } else if bytes.is_empty() {
                    whole = true;
                    delimiter = None;
                } else if bytes.len() != 1 {
                    return Err(
                        "join: EINVAL: join delimiter must be one byte in the C locale\n"
                            .to_string(),
                    );
                } else {
                    delimiter = Some(bytes[0]);
                    whole = false;
                }
            }
            'o' => {
                if value == "auto" {
                    if matches!(format, JoinFormat::Explicit(_)) {
                        return Err(
                            "join: EINVAL: conflicting output format specifications\n".to_string(),
                        );
                    }
                    format = JoinFormat::Auto;
                } else {
                    if matches!(format, JoinFormat::Auto) {
                        return Err(
                            "join: EINVAL: conflicting output format specifications\n".to_string(),
                        );
                    }
                    let mut specs: Vec<(usize, usize)> = Vec::new();
                    for part in value
                        .split(|c: char| c == ',' || c == ' ' || c == '\t')
                        .filter(|s| !s.is_empty())
                    {
                        if part == "0" {
                            specs.push((0, 0));
                        } else if let Some((f_s, idx_s)) = part.split_once('.')
                            && (f_s == "1" || f_s == "2")
                        {
                            let f_num = if f_s == "1" { 1usize } else { 2usize };
                            let col = parse_pos_num(idx_s, "output field")? - 1;
                            specs.push((f_num, col));
                        } else {
                            return Err(format!("join: EINVAL: invalid output field: {part}\n"));
                        }
                    }
                    if specs.is_empty() {
                        return Err(format!("join: EINVAL: invalid output field: {value}\n"));
                    }
                    match format {
                        JoinFormat::Explicit(ref mut v) => v.extend(specs),
                        _ => format = JoinFormat::Explicit(specs),
                    }
                }
            }
            _ => {}
        }
        Ok(())
    };

    let mut index = 0usize;
    while index < args.len() {
        let token = &args[index];
        let candidate = next_field_candidate.take();
        if literal || token == "-" || !token.starts_with('-') {
            if files.len() == 2 {
                let Some(pos) = field_candidates.iter().position(|c| c.is_some()) else {
                    return err_out("join: EINVAL: join requires exactly two files\n", 1);
                };
                let f_num = field_candidates[pos].unwrap();
                let flag_ch = if f_num == 1 { '1' } else { '2' };
                let f_val = files.remove(pos);
                field_candidates.remove(pos);
                if let Err(msg) = apply_flag(flag_ch, &f_val, &mut explicit_fields, &mut fields) {
                    return err_out(&msg, 1);
                }
                pending_fields[(f_num - 1) as usize] -= 1;
            }
            files.push(token.clone());
            field_candidates.push(if literal { None } else { candidate });
            index += 1;
            continue;
        }
        if token == "--" {
            literal = true;
            index += 1;
            continue;
        }
        if token.starts_with("--") {
            match token.as_str() {
                "--header" => header = true,
                "--check-order" => order_mode = OrderMode::Check,
                "--nocheck-order" => order_mode = OrderMode::None,
                "--ignore-case" => fold = true,
                "--zero-terminated" => separator = 0u8,
                _ => return err_out(&format!("join: EINVAL: unsupported option {token}\n"), 1),
            }
            index += 1;
            continue;
        }

        let chars: Vec<(usize, char)> = token[1..].char_indices().collect();
        let mut ci = 0usize;
        while ci < chars.len() {
            let (byte_pos, flag) = chars[ci];
            match flag {
                'i' => {
                    fold = true;
                    ci += 1;
                }
                'z' => {
                    separator = 0u8;
                    ci += 1;
                }
                '1' | '2' | 'j' | 'a' | 'e' | 'v' | 't' | 'o' => {
                    let rest = &token[1 + byte_pos + flag.len_utf8()..];
                    if flag == 'j' && (rest == "1" || rest == "2") && byte_pos == 0 {
                        let d = if rest == "1" { 1u8 } else { 2u8 };
                        pending_fields[(d - 1) as usize] += 1;
                        next_field_candidate = Some(d);
                        break;
                    }
                    let val = if !rest.is_empty() || ci + 1 < chars.len() {
                        rest.to_string()
                    } else if index + 1 < args.len() {
                        index += 1;
                        args[index].clone()
                    } else {
                        return err_out(
                            &format!("join: EINVAL: option -{flag} requires an argument\n"),
                            1,
                        );
                    };
                    if let Err(msg) = apply_flag(flag, &val, &mut explicit_fields, &mut fields) {
                        return err_out(&msg, 1);
                    }
                    break;
                }
                _ => return err_out(&format!("join: EINVAL: unsupported option -{flag}\n"), 1),
            }
        }
        index += 1;
    }

    if files.len() != 2 {
        return err_out("join: EINVAL: join requires exactly two files\n", 1);
    }
    if pending_fields[0] > 0
        && let Err(msg) = apply_flag('j', "1", &mut explicit_fields, &mut fields)
    {
        return err_out(&msg, 1);
    }
    if pending_fields[1] > 0
        && let Err(msg) = apply_flag('j', "2", &mut explicit_fields, &mut fields)
    {
        return err_out(&msg, 1);
    }
    if files[0] == "-" && files[1] == "-" {
        return err_out("join: EINVAL: both files cannot be standard input\n", 1);
    }

    let mut readers = match files.iter().map(|file| TableReader::open(file, cwd, fs)).collect::<Result<Vec<_>, _>>() {
        Ok(readers) => readers,
        Err(e) => return err_out(&format!("join: {e}\n"), 1),
    };
    let mut available = fs.max_input_bytes();
    let mut record = Vec::new();

    #[derive(Clone)]
    struct JoinRow {
        fields: Vec<Vec<u8>>,
        key: Vec<u8>,
    }

    let split_row = |bytes: &[u8], file_idx: usize| -> JoinRow {
        let row_fields: Vec<Vec<u8>> = if whole {
            vec![bytes.to_vec()]
        } else if let Some(d) = delimiter {
            let mut v: Vec<Vec<u8>> = Vec::new();
            let mut start = 0usize;
            for (idx, &b) in bytes.iter().enumerate() {
                if b == d {
                    v.push(bytes[start..idx].to_vec());
                    start = idx + 1;
                }
            }
            v.push(bytes[start..].to_vec());
            v
        } else {
            let is_blank =
                |b: u8| -> bool { b == b' ' || b == b'\t' || (separator == 0 && b == b'\n') };
            let mut v: Vec<Vec<u8>> = Vec::new();
            let mut offset = 0usize;
            while offset < bytes.len() {
                while offset < bytes.len() && is_blank(bytes[offset]) {
                    offset += 1;
                }
                let start = offset;
                while offset < bytes.len() && !is_blank(bytes[offset]) {
                    offset += 1;
                }
                if offset > start {
                    v.push(bytes[start..offset].to_vec());
                }
            }
            if separator == 0 && !v.is_empty() && is_blank(*bytes.last().unwrap()) {
                v.push(Vec::new());
            }
            v
        };
        let key = row_fields
            .get(fields[file_idx])
            .cloned()
            .unwrap_or_default();
        JoinRow {
            fields: row_fields,
            key,
        }
    };

    let mut prev_keys: [Option<Vec<u8>>; 2] = [None, None];
    let mut order_unpaired = false;
    let mut order_failed = false;
    let mut order_warned = [false, false];
    let mut order_pending = [false, false];
    let mut stderr = String::new();

    let report_disorder = |file_idx: usize,
                           order_mode: OrderMode,
                           order_warned: &mut [bool; 2],
                           order_failed: &mut bool,
                           stderr: &mut String|
     -> Result<(), String> {
        if order_mode == OrderMode::Check {
            return Err(format!("EINVAL: file {} is not in sorted order", file_idx + 1));
        }
        if !order_warned[file_idx] {
            order_warned[file_idx] = true;
            *order_failed = true;
            stderr.push_str(&format!(
                "join: file {} is not in sorted order\n",
                file_idx + 1
            ));
        }
        Ok(())
    };

    let mark_unpaired = |order_unpaired: &mut bool,
                             order_pending: &mut [bool; 2],
                             order_warned: &mut [bool; 2],
                             order_failed: &mut bool,
                             stderr: &mut String|
     -> Result<(), String> {
        if *order_unpaired {
            return Ok(());
        }
        *order_unpaired = true;
        for f_idx in 0..2 {
            if order_pending[f_idx] {
                order_pending[f_idx] = false;
                report_disorder(f_idx, order_mode, order_warned, order_failed, stderr)?;
            }
        }
        Ok(())
    };

    let mut next_row = |file_idx: usize,
                        reset: bool,
                        order_unpaired: &bool,
                        order_pending: &mut [bool; 2],
                        order_warned: &mut [bool; 2],
                        order_failed: &mut bool,
                        stderr: &mut String|
     -> Result<Option<JoinRow>, String> {
        if !readers[file_idx].next(&mut stdin, separator, &mut record, &mut available, fs)? { return Ok(None); }
        let row = split_row(&record, file_idx);
        if !reset && order_mode != OrderMode::None && !order_warned[file_idx] {
            let disordered = prev_keys[file_idx]
                .as_ref()
                .is_some_and(|pk| compare_join_keys(pk, &row.key, fold) == std::cmp::Ordering::Greater);
            if order_mode == OrderMode::Default && !*order_unpaired {
                order_pending[file_idx] = disordered;
            } else if disordered {
                report_disorder(file_idx, order_mode, order_warned, order_failed, stderr)?;
            }
        }
        prev_keys[file_idx] = Some(row.key.clone());
        Ok(Some(row))
    };

    let mut out_bytes: Vec<u8> = Vec::new();
    let out_delim = delimiter.unwrap_or(b' ');

    let max_output = fs.remaining_output_bytes();
    let result = (|| -> Result<(), String> {
        let mut rows = [None, None];
        for (index, row) in rows.iter_mut().enumerate() {
            *row = next_row(index, false, &order_unpaired, &mut order_pending, &mut order_warned, &mut order_failed, &mut stderr)?;
        }
        let counts = [
            rows[0].as_ref().map(|r| r.fields.len()).unwrap_or(0),
            rows[1].as_ref().map(|r| r.fields.len()).unwrap_or(0),
        ];

        let emit_row = |out: &mut Vec<u8>, left: Option<&JoinRow>, right: Option<&JoinRow>| {
            let pair = [left, right];
            let key: &[u8] = left
                .or(right)
                .map(|r| r.key.as_slice())
                .unwrap_or(&[]);
            let mut selected_fields: Vec<&[u8]> = Vec::new();
            match format {
                JoinFormat::Explicit(ref specs) => {
                    for &(f_num, col_idx) in specs {
                        if f_num == 0 {
                            selected_fields.push(key);
                        } else {
                            let val = pair[f_num - 1]
                                .and_then(|r| r.fields.get(col_idx))
                                .map(|v| v.as_slice())
                                .unwrap_or(&[]);
                            selected_fields.push(val);
                        }
                    }
                }
                JoinFormat::Auto | JoinFormat::Default => {
                    selected_fields.push(key);
                    for file_idx in 0..2 {
                        let count = if matches!(format, JoinFormat::Auto) {
                            counts[file_idx]
                        } else {
                            pair[file_idx].map(|r| r.fields.len()).unwrap_or(0)
                        };
                        for idx in 0..count {
                            if idx != fields[file_idx] {
                                let val = pair[file_idx]
                                    .and_then(|r| r.fields.get(idx))
                                    .map(|v| v.as_slice())
                                    .unwrap_or(&[]);
                                selected_fields.push(val);
                            }
                        }
                    }
                }
            }
            // One separator per field, including the terminating newline or NUL.
            let mut size = selected_fields.len().max(1);
            for field in &mut selected_fields {
                if field.is_empty() { *field = &replacement; }
                size = size.saturating_add(field.len());
            }
            if size > max_output - out.len() {
                return Err(fs.limit_error("maxOutputBytes", fs.shell_limits().max_output_bytes));
            }
            for (idx, field) in selected_fields.into_iter().enumerate() {
                if idx != 0 { out.push(out_delim); }
                out.extend_from_slice(field);
            }
            out.push(separator);
            Ok(())
        };

        if header && (rows[0].is_some() || rows[1].is_some()) {
            emit_row(&mut out_bytes, rows[0].as_ref(), rows[1].as_ref())?;
            for f_idx in 0..2 {
                if rows[f_idx].is_some() {
                    rows[f_idx] = next_row(
                        f_idx,
                        true,
                        &order_unpaired,
                        &mut order_pending,
                        &mut order_warned,
                        &mut order_failed,
                        &mut stderr,
                    )?;
                }
            }
        }

        while rows[0].is_some() && rows[1].is_some() {
            let cmp = compare_join_keys(
                &rows[0].as_ref().unwrap().key,
                &rows[1].as_ref().unwrap().key,
                fold,
            );
            if cmp != std::cmp::Ordering::Equal {
                mark_unpaired(
                    &mut order_unpaired,
                    &mut order_pending,
                    &mut order_warned,
                    &mut order_failed,
                    &mut stderr,
                )?;
                let file_idx = if cmp == std::cmp::Ordering::Less { 0 } else { 1 };
                if unpaired[file_idx] {
                    emit_row(
                        &mut out_bytes,
                        if file_idx == 0 { rows[0].as_ref() } else { None },
                        if file_idx == 1 { rows[1].as_ref() } else { None },
                    )?;
                }
                rows[file_idx] = next_row(
                    file_idx,
                    false,
                    &order_unpaired,
                    &mut order_pending,
                    &mut order_warned,
                    &mut order_failed,
                    &mut stderr,
                )?;
                continue;
            }

            let key = rows[0].as_ref().unwrap().key.clone();
            let mut groups: [Vec<JoinRow>; 2] = [Vec::new(), Vec::new()];
            for file_idx in 0..2 {
                while rows[file_idx]
                    .as_ref()
                    .is_some_and(|r| compare_join_keys(&r.key, &key, fold) == std::cmp::Ordering::Equal)
                {
                    groups[file_idx].push(rows[file_idx].take().unwrap());
                    rows[file_idx] = next_row(
                        file_idx,
                        false,
                        &order_unpaired,
                        &mut order_pending,
                        &mut order_warned,
                        &mut order_failed,
                        &mut stderr,
                    )?;
                }
            }
            if paired {
                for left in &groups[0] {
                    for right in &groups[1] {
                        emit_row(&mut out_bytes, Some(left), Some(right))?;
                    }
                }
            }
        }

        for file_idx in 0..2 {
            if !unpaired[file_idx] && order_mode == OrderMode::None {
                continue;
            }
            if rows[file_idx].is_some() {
                mark_unpaired(
                    &mut order_unpaired,
                    &mut order_pending,
                    &mut order_warned,
                    &mut order_failed,
                    &mut stderr,
                )?;
            }
            while let Some(ref cur) = rows[file_idx] {
                if unpaired[file_idx] {
                    emit_row(
                        &mut out_bytes,
                        if file_idx == 0 { Some(cur) } else { None },
                        if file_idx == 1 { Some(cur) } else { None },
                    )?;
                }
                rows[file_idx] = next_row(
                    file_idx,
                    false,
                    &order_unpaired,
                    &mut order_pending,
                    &mut order_warned,
                    &mut order_failed,
                    &mut stderr,
                )?;
            }
        }

        Ok(())
    })();
    if let Err(e) = result {
        stderr.push_str(&format!("join: {e}\n"));
        order_failed = true;
    } else if order_failed {
        stderr.push_str("join: input is not in sorted order\n");
    }

    BuiltinOutcome {
        stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
        stderr,
        exit_code: if order_failed { 1 } else { 0 },
    }
}

#[derive(Clone)]
struct GetoptLongOption {
    name: String,
    argument: u8,
    code: Option<char>,
}

enum GetoptParsed {
    Short {
        option: char,
        argument: Option<String>,
    },
    Long {
        option: GetoptLongOption,
        argument: Option<String>,
    },
    Operand(String),
    Error,
}

fn getopt_find_short(spec: &str, opt: char, start: usize) -> Option<usize> {
    spec[start..]
        .find(opt)
        .map(|rel| start + rel)
}

fn getopt_add_long_options(value: &str, options: &mut Vec<GetoptLongOption>) -> Result<(), String> {
    let bytes = value.as_bytes();
    let mut start = 0usize;
    for offset in 0..=bytes.len() {
        let is_sep = offset == bytes.len()
            || matches!(bytes[offset], b',' | b' ' | b'\t' | b'\n');
        if !is_sep {
            continue;
        }
        if offset > start {
            let mut end = offset;
            let mut argument = 0u8;
            if bytes[end - 1] == b':' {
                argument = 1;
                end -= 1;
                if end > start && bytes[end - 1] == b':' {
                    argument = 2;
                    end -= 1;
                }
            }
            if end == start {
                return Err("empty long option after -l or --long argument".to_string());
            }
            options.push(GetoptLongOption {
                name: value[start..end].to_string(),
                argument,
                code: None,
            });
        }
        start = offset + 1;
    }
    Ok(())
}

fn getopt_normalized(out: &mut String, value: &str, quote: bool, tcsh: bool) {
    if !quote {
        out.push(' ');
        out.push_str(value);
        return;
    }
    out.push_str(" '");
    for ch in value.chars() {
        let code = ch as u32;
        if code == 39
            || (tcsh && matches!(code, 33 | 9 | 11 | 12 | 13 | 32))
        {
            out.push('\'');
            out.push('\\');
            out.push(ch);
            out.push('\'');
        } else if tcsh && (code == 92 || code == 10) {
            out.push('\\');
            out.push(if code == 10 { 'n' } else { '\\' });
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
}

struct GetoptParser<'a> {
    args: &'a [String],
    specification: String,
    options: Vec<GetoptLongOption>,
    alternative: bool,
    index: usize,
    offset: usize,
    ended: bool,
    operands: Vec<String>,
    start: usize,
    order: &'static str,
    silent: bool,
    name: String,
}

impl<'a> GetoptParser<'a> {
    fn new(
        args: &'a [String],
        specification: String,
        options: Vec<GetoptLongOption>,
        alternative: bool,
        posix: bool,
        quiet: bool,
        name: String,
    ) -> Self {
        let first = specification.as_bytes().first().copied();
        let start = if matches!(first, Some(b'+') | Some(b'-')) {
            1
        } else {
            0
        };
        let order = if first == Some(b'-') {
            "return"
        } else if first == Some(b'+') || posix {
            "require"
        } else {
            "permute"
        };
        let silent = quiet || specification.as_bytes().get(start) == Some(&b':');
        Self {
            args,
            specification,
            options,
            alternative,
            index: 0,
            offset: 0,
            ended: false,
            operands: Vec::new(),
            start,
            order,
            silent,
            name,
        }
    }

    fn err(&self, stderr: &mut String, msg: &str) -> GetoptParsed {
        if !self.silent {
            stderr.push_str(&self.name);
            stderr.push_str(msg);
        }
        GetoptParsed::Error
    }

    fn parse_long(
        &mut self,
        value: &str,
        prefix: &str,
        fallback: bool,
        stderr: &mut String,
    ) -> Option<GetoptParsed> {
        let end = value.find('=').unwrap_or(value.len());
        let name_part = &value[..end];
        let mut matches: Vec<GetoptLongOption> = Vec::new();
        let mut exact: Option<GetoptLongOption> = None;
        for opt in &self.options {
            if opt.name.starts_with(name_part) {
                if opt.name.len() == end {
                    exact = Some(opt.clone());
                    break;
                }
                matches.push(opt.clone());
            }
        }
        if exact.is_none() && matches.len() > 1 {
            self.index += 1;
            self.offset = 0;
            if !self.silent {
                stderr.push_str(&format!(
                    "{}: option '{}{}' is ambiguous; possibilities:",
                    self.name, prefix, value
                ));
                for m in &matches {
                    stderr.push_str(&format!(" '{}{}'", prefix, m.name));
                }
                stderr.push('\n');
            }
            return Some(GetoptParsed::Error);
        }
        let chosen = exact.or_else(|| matches.into_iter().next());
        let Some(option) = chosen else {
            if fallback
                && let Some(first_ch) = value.chars().next()
                && getopt_find_short(&self.specification, first_ch, self.start).is_some()
            {
                return None;
            }
            self.index += 1;
            self.offset = 0;
            return Some(self.err(
                stderr,
                &format!(": unrecognized option '{}{}'\n", prefix, value),
            ));
        };
        self.index += 1;
        self.offset = 0;
        let mut argument: Option<String> = None;
        if end < value.len() {
            if option.argument == 0 {
                return Some(self.err(
                    stderr,
                    &format!(
                        ": option '{}{}' doesn't allow an argument\n",
                        prefix, option.name
                    ),
                ));
            }
            argument = Some(value[end + 1..].to_string());
        } else if option.argument == 1 {
            if self.index == self.args.len() {
                return Some(self.err(
                    stderr,
                    &format!(
                        ": option '{}{}' requires an argument\n",
                        prefix, option.name
                    ),
                ));
            }
            argument = Some(self.args[self.index].clone());
            self.index += 1;
        }
        Some(GetoptParsed::Long { option, argument })
    }

    fn next(&mut self, stderr: &mut String) -> Option<GetoptParsed> {
        if self.ended {
            return None;
        }
        if self.offset == 0 {
            while self.index < self.args.len() {
                let argument = &self.args[self.index];
                if argument == "--" {
                    self.index += 1;
                    self.ended = true;
                    return None;
                }
                if argument.len() > 1 && argument.starts_with('-') {
                    break;
                }
                if self.order == "require" {
                    self.ended = true;
                    return None;
                }
                let op = argument.clone();
                self.index += 1;
                if self.order == "return" {
                    return Some(GetoptParsed::Operand(op));
                }
                self.operands.push(op);
            }
            if self.index == self.args.len() {
                self.ended = true;
                return None;
            }
            let argument = self.args[self.index].clone();
            if let Some(rest) = argument.strip_prefix("--") {
                return self.parse_long(rest, "--", false, stderr);
            }
            let second_ch = argument[1..].chars().next().unwrap_or('\0');
            if self.alternative
                && (argument.len() > 2
                    || getopt_find_short(&self.specification, second_ch, self.start).is_none())
            {
                if let Some(res) = self.parse_long(&argument[1..], "-", true, stderr) {
                    return Some(res);
                }
            }
            self.offset = 1;
        }
        let current = self.args[self.index].clone();
        let option = current[self.offset..].chars().next().unwrap_or('\0');
        self.offset += option.len_utf8();
        if self.offset >= current.len() {
            self.offset = 0;
            self.index += 1;
        }
        let Some(found) = getopt_find_short(&self.specification, option, self.start) else {
            return Some(self.err(stderr, &format!(": invalid option -- '{option}'\n")));
        };
        if option == ':' || option == ';' {
            return Some(self.err(stderr, &format!(": invalid option -- '{option}'\n")));
        }
        let spec_bytes = self.specification.as_bytes();
        if option == 'W' && spec_bytes.get(found + 1) == Some(&b';') {
            if self.offset == 0 && self.index == self.args.len() {
                return Some(self.err(stderr, ": option requires an argument -- 'W'\n"));
            }
            let val = if self.offset > 0 {
                current[self.offset..].to_string()
            } else {
                self.args[self.index].clone()
            };
            return self.parse_long(&val, "-W ", false, stderr);
        }
        let mut argument: Option<String> = None;
        if spec_bytes.get(found + 1) == Some(&b':') {
            if self.offset > 0 {
                argument = Some(current[self.offset..].to_string());
                self.index += 1;
            } else if spec_bytes.get(found + 2) != Some(&b':') {
                if self.index == self.args.len() {
                    return Some(self.err(
                        stderr,
                        &format!(": option requires an argument -- '{option}'\n"),
                    ));
                }
                argument = Some(self.args[self.index].clone());
                self.index += 1;
            }
            self.offset = 0;
        }
        if option == '?' {
            return Some(GetoptParsed::Error);
        }
        Some(GetoptParsed::Short { option, argument })
    }
}

fn cmd_getopt(args: &[String], env: &BTreeMap<String, String>) -> BuiltinOutcome {
    let compatible = env.contains_key("GETOPT_COMPATIBLE");
    let posix = env.contains_key("POSIXLY_CORRECT");
    let mut stdout = String::new();
    let mut stderr = String::new();

    if args.is_empty() {
        if !compatible {
            return err_out(
                "getopt: missing optstring argument\nTry 'getopt --help' for more information.\n",
                2,
            );
        }
        return ok_out(" --\n");
    }

    let mut specification: Option<String> = None;
    let parameters: &[String];
    let mut long_options: Vec<GetoptLongOption> = Vec::new();
    let mut quote = true;
    let mut tcsh = false;
    let mut quiet = false;
    let mut quiet_output = false;
    let mut alternative = false;
    let mut name = "getopt".to_string();

    if compatible || !args[0].starts_with('-') {
        let trimmed = args[0].trim_start_matches(['+', '-']);
        specification = Some(trimmed.to_string());
        parameters = &args[1..];
        quote = false;
    } else {
        let wrapper_options = vec![
            GetoptLongOption { name: "options".to_string(), argument: 1, code: Some('o') },
            GetoptLongOption { name: "longoptions".to_string(), argument: 1, code: Some('l') },
            GetoptLongOption { name: "quiet".to_string(), argument: 0, code: Some('q') },
            GetoptLongOption { name: "quiet-output".to_string(), argument: 0, code: Some('Q') },
            GetoptLongOption { name: "shell".to_string(), argument: 1, code: Some('s') },
            GetoptLongOption { name: "test".to_string(), argument: 0, code: Some('T') },
            GetoptLongOption { name: "unquoted".to_string(), argument: 0, code: Some('u') },
            GetoptLongOption { name: "help".to_string(), argument: 0, code: Some('h') },
            GetoptLongOption { name: "alternative".to_string(), argument: 0, code: Some('a') },
            GetoptLongOption { name: "name".to_string(), argument: 1, code: Some('n') },
            GetoptLongOption { name: "version".to_string(), argument: 0, code: Some('V') },
        ];
        let mut wrapper = GetoptParser::new(
            args,
            "+ao:l:n:qQs:TuhV".to_string(),
            wrapper_options,
            false,
            posix,
            false,
            "getopt".to_string(),
        );
        while let Some(parsed) = wrapper.next(&mut stderr) {
            let (code, arg_val) = match parsed {
                GetoptParsed::Error => {
                    stderr.push_str("Try 'getopt --help' for more information.\n");
                    return BuiltinOutcome {
                        stdout,
                        stderr,
                        exit_code: 2,
                    };
                }
                GetoptParsed::Operand(_) => {
                    return err_out("getopt: unexpected wrapper operand\n", 1);
                }
                GetoptParsed::Long { option, argument } => (option.code.unwrap_or('\0'), argument),
                GetoptParsed::Short { option, argument } => (option, argument),
            };
            match code {
                'o' => specification = Some(arg_val.unwrap_or_default()),
                'l' => {
                    if let Err(msg) =
                        getopt_add_long_options(&arg_val.unwrap_or_default(), &mut long_options)
                    {
                        return err_out(
                            &format!("getopt: {msg}\nTry 'getopt --help' for more information.\n"),
                            2,
                        );
                    }
                }
                'n' => name = arg_val.unwrap_or_default(),
                'a' => alternative = true,
                'q' => quiet = true,
                'Q' => quiet_output = true,
                'u' => quote = false,
                's' => match arg_val.as_deref().unwrap_or("") {
                    "bash" | "sh" => tcsh = false,
                    "tcsh" | "csh" => tcsh = true,
                    _ => {
                        return err_out(
                            "getopt: unknown shell after -s or --shell argument\nTry 'getopt --help' for more information.\n",
                            2,
                        );
                    }
                },
                'T' => {
                    return BuiltinOutcome {
                        stdout,
                        stderr,
                        exit_code: 4,
                    };
                }
                'V' => return ok_out("getopt (virtual-bash)\n"),
                'h' => {
                    return ok_out(
                        include_str!("help/getopt.txt"),
                    );
                }
                _ => {}
            }
        }
        if specification.is_none() {
            if wrapper.index >= args.len() {
                return err_out(
                    "getopt: missing optstring argument\nTry 'getopt --help' for more information.\n",
                    2,
                );
            }
            specification = Some(args[wrapper.index].clone());
            wrapper.index += 1;
        }
        parameters = &args[wrapper.index..];
    }

    let spec = specification.unwrap_or_default();
    let mut parser = GetoptParser::new(
        parameters,
        spec.clone(),
        long_options,
        alternative,
        posix,
        quiet,
        name,
    );
    let mut exit_code = 0;
    while let Some(parsed) = parser.next(&mut stderr) {
        match parsed {
            GetoptParsed::Error => {
                exit_code = 1;
            }
            GetoptParsed::Operand(op) => {
                if !quiet_output {
                    getopt_normalized(&mut stdout, &op, quote, tcsh);
                }
            }
            GetoptParsed::Long { option, argument } => {
                if !quiet_output {
                    stdout.push_str(" --");
                    stdout.push_str(&option.name);
                    if option.argument > 0 {
                        getopt_normalized(
                            &mut stdout,
                            argument.as_deref().unwrap_or(""),
                            quote,
                            tcsh,
                        );
                    }
                }
            }
            GetoptParsed::Short { option, argument } => {
                if !quiet_output {
                    stdout.push_str(" -");
                    stdout.push(option);
                    if let Some(off) = getopt_find_short(&spec, option, 0)
                        && spec.as_bytes().get(off + 1) == Some(&b':')
                    {
                        getopt_normalized(
                            &mut stdout,
                            argument.as_deref().unwrap_or(""),
                            quote,
                            tcsh,
                        );
                    }
                }
            }
        }
    }
    if !quiet_output {
        stdout.push_str(" --");
        for op in &parser.operands {
            getopt_normalized(&mut stdout, op, quote, tcsh);
        }
        for rest in &parameters[parser.index..] {
            getopt_normalized(&mut stdout, rest, quote, tcsh);
        }
        stdout.push('\n');
    }

    BuiltinOutcome {
        stdout,
        stderr,
        exit_code,
    }
}

fn cmd_dos2unix(
    args: &[String],
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
    to_dos: bool,
) -> BuiltinOutcome {
    let direction = if to_dos { "unix2dos" } else { "dos2unix" };
    let mut keep_bom = to_dos;
    let mut add_bom = false;
    let mut force = false;
    let mut quiet = false;
    let mut keep_date = false;
    let mut add_eol = false;
    let mut double_nl = false;
    let mut seven_bit = false;
    let mut newfile_mode = false;
    let mut to_stdout = false;
    let mut info_flags: Option<String> = None;
    let mut files: Vec<String> = Vec::new();
    let mut i = 0usize;

    while i < args.len() {
        let a = &args[i];
        if a == "--" {
            files.extend(args[i + 1..].iter().cloned());
            break;
        } else if a == "-h" || a == "--help" {
            return ok_out(&format!(
                "Usage: {direction} [options] [file ...] [-n infile outfile ...]\nVirtual byte/UTF-16 profile:\n  -o -n -O -i[FLAGS] -e -v -b -r -m -f -s -q -k -l -u -ul -ub -7 -ascii --\n  --no-add-eol --allow-chown --no-allow-chown\n"
            ));
        } else if a == "-n" || a == "--newfile" {
            newfile_mode = true;
            i += 1;
        } else if a == "-o" || a == "--oldfile" {
            newfile_mode = false;
            to_stdout = false;
            i += 1;
        } else if a == "-O" || a == "--to-stdout" {
            newfile_mode = false;
            to_stdout = true;
            i += 1;
        } else if a == "-b" || a == "--keep-bom" {
            keep_bom = true;
            i += 1;
        } else if a == "-r" || a == "--remove-bom" {
            keep_bom = false;
            add_bom = false;
            i += 1;
        } else if a == "-m" || a == "--add-bom" {
            add_bom = true;
            i += 1;
        } else if a == "-f" || a == "--force" {
            force = true;
            i += 1;
        } else if a == "-s" || a == "--safe" {
            force = false;
            i += 1;
        } else if a == "-q" || a == "--quiet" {
            quiet = true;
            i += 1;
        } else if a == "-v" || a == "--verbose" {
            quiet = false;
            i += 1;
        } else if a == "-k" || a == "--keepdate" {
            keep_date = true;
            i += 1;
        } else if matches!(
            a.as_str(),
            "-u" | "--keep-utf16"
                | "-ul"
                | "--assume-utf16le"
                | "-ub"
                | "--assume-utf16be"
                | "-S"
                | "--skip-symlink"
                | "--allow-chown"
                | "--no-allow-chown"
        ) {
            i += 1;
        } else if a == "-7" {
            seven_bit = true;
            i += 1;
        } else if a == "-ascii" {
            seven_bit = false;
            i += 1;
        } else if a == "-c" || a == "--convmode" {
            if i + 1 >= args.len() {
                return err_out(&format!("{direction}: option '{a}' requires an argument\n"), 1);
            }
            let mode = &args[i + 1];
            if mode.eq_ignore_ascii_case("ascii") {
                seven_bit = false;
            } else if mode.eq_ignore_ascii_case("7bit") {
                seven_bit = true;
            } else {
                return err_out(
                    &format!("{direction}: invalid {mode} conversion mode specified\n"),
                    1,
                );
            }
            i += 2;
        } else if a == "-e" || a == "--add-eol" {
            add_eol = true;
            i += 1;
        } else if a == "--no-add-eol" {
            add_eol = false;
            i += 1;
        } else if a == "-l" || a == "--newline" {
            double_nl = true;
            i += 1;
        } else if a == "-i" || a == "--info" {
            info_flags = Some(String::new());
            i += 1;
        } else if let Some(rest) = a.strip_prefix("--info=") {
            for ch in rest.chars() {
                if !"0dumbtechp".contains(ch) {
                    return err_out(
                        &format!("{direction}: wrong flag '{ch}' for option -i or --info\n"),
                        1,
                    );
                }
            }
            info_flags = Some(rest.to_string());
            i += 1;
        } else if let Some(rest) = a.strip_prefix("-i") && !rest.is_empty() {
            for ch in rest.chars() {
                if !"0dumbtechp".contains(ch) {
                    return err_out(
                        &format!("{direction}: wrong flag '{ch}' for option -i or --info\n"),
                        1,
                    );
                }
            }
            info_flags = Some(rest.to_string());
            i += 1;
        } else if a.starts_with('-') && a.len() > 1 && !a.starts_with("--") {
            for ch in a[1..].chars() {
                match ch {
                    'b' => keep_bom = true,
                    'r' => {
                        keep_bom = false;
                        add_bom = false;
                    }
                    'm' => add_bom = true,
                    'f' => force = true,
                    's' => force = false,
                    'q' => quiet = true,
                    'v' => quiet = false,
                    'k' => keep_date = true,
                    'u' | 'S' => {}
                    'e' => add_eol = true,
                    'l' => double_nl = true,
                    '7' => seven_bit = true,
                    'n' => newfile_mode = true,
                    'o' => {
                        newfile_mode = false;
                        to_stdout = false;
                    }
                    'O' => {
                        newfile_mode = false;
                        to_stdout = true;
                    }
                    _ => {
                        return err_out(
                            &format!("{direction}: unsupported option in virtual profile: {a}\n"),
                            1,
                        );
                    }
                }
            }
            i += 1;
        } else if a.starts_with("--") {
            return err_out(
                &format!("{direction}: unsupported option in virtual profile: {a}\n"),
                1,
            );
        } else {
            files.push(a.clone());
            i += 1;
        }
    }

    if let Some(ref flags_str) = info_flags {
        let has_explicit = flags_str.chars().any(|c| "dumbtec".contains(c));
        let active_set = |ch: char| -> bool {
            if ch == 'e' {
                flags_str.contains('e') || (add_eol && !flags_str.contains('c'))
            } else if has_explicit {
                flags_str.contains(ch)
            } else {
                "dumbt".contains(ch)
            }
        };
        let mut out = String::new();
        let mut header_done = false;
        for f in &files {
            let p = resolve_posix_path(cwd, f);
            let Ok(raw) = fs.read_file(&p) else {
                continue;
            };
            let (bom_label, body) = if raw.starts_with(b"\xEF\xBB\xBF") {
                ("UTF-8", &raw[3..])
            } else {
                ("no_bom", &raw[..])
            };
            let mut dos = 0usize;
            let mut unix = 0usize;
            let mut mac = 0usize;
            let mut prev = None;
            let mut last = "noeol";
            let mut binary = false;
            for &b in body {
                if b < 32 && !matches!(b, 9 | 10 | 12 | 13) {
                    binary = true;
                }
                if b == 13 {
                    mac += 1;
                    last = "mac";
                } else if b == 10 && prev == Some(13) {
                    dos += 1;
                    mac = mac.saturating_sub(1);
                    last = "dos";
                } else if b == 10 {
                    unix += 1;
                    last = "unix";
                } else {
                    last = "noeol";
                }
                prev = Some(b);
            }
            if flags_str.contains('c') {
                let target_count = if to_dos { unix } else { dos };
                let target_last = if to_dos { "dos" } else { "unix" };
                if (binary && !force) || (target_count == 0 && (!add_eol || last == target_last)) {
                    continue;
                }
            }
            let mut fields: Vec<String> = Vec::new();
            if active_set('d') {
                fields.push(format!("  {dos:>6}"));
            }
            if active_set('u') {
                fields.push(format!("  {unix:>6}"));
            }
            if active_set('m') {
                fields.push(format!("  {mac:>6}"));
            }
            if active_set('b') {
                fields.push(format!("  {bom_label:<8}"));
            }
            if active_set('t') {
                fields.push(if binary {
                    "  binary".to_string()
                } else {
                    "  text  ".to_string()
                });
            }
            if active_set('e') {
                fields.push(format!(" {last:<5} "));
            }
            let display_name = if flags_str.contains('p') {
                f.rsplit(['/', '\\']).next().unwrap_or(f)
            } else {
                f.as_str()
            };
            let sep = if fields.is_empty() { "" } else { "  " };
            let term = if flags_str.contains('0') { "\0" } else { "\n" };
            if flags_str.contains('h') && !header_done {
                let mut hdr_fields: Vec<&str> = Vec::new();
                if active_set('d') {
                    hdr_fields.push("     DOS");
                }
                if active_set('u') {
                    hdr_fields.push("    UNIX");
                }
                if active_set('m') {
                    hdr_fields.push("     MAC");
                }
                if active_set('b') {
                    hdr_fields.push("  BOM     ");
                }
                if active_set('t') {
                    hdr_fields.push("  TXTBIN");
                }
                if active_set('e') {
                    hdr_fields.push(" LASTLN");
                }
                out.push_str(&format!("{}{sep}FILE{term}", hdr_fields.join("")));
                header_done = true;
            }
            out.push_str(&format!("{}{sep}{display_name}{term}", fields.join("")));
        }
        return ok_out(&out);
    }

    let convert_bytes = |raw: &[u8]| -> Option<Vec<u8>> {
        let (has_bom, body) = if raw.starts_with(b"\xEF\xBB\xBF") {
            (true, &raw[3..])
        } else {
            (false, raw)
        };
        if !force
            && body
                .iter()
                .any(|&b| b < 32 && !matches!(b, 9 | 10 | 12 | 13))
        {
            return None;
        }
        let mut out: Vec<u8> = Vec::with_capacity(raw.len() + 8);
        if add_bom || (keep_bom && has_bom) {
            out.extend_from_slice(b"\xEF\xBB\xBF");
        }
        let put_byte = |out: &mut Vec<u8>, b: u8| {
            out.push(if seven_bit && b >= 128 { b' ' } else { b });
        };
        let mut idx = 0usize;
        while idx < body.len() {
            let b = body[idx];
            if b == b'\r' && body.get(idx + 1) == Some(&b'\n') {
                let count = if double_nl { 2 } else { 1 };
                for _ in 0..count {
                    if to_dos {
                        put_byte(&mut out, b'\r');
                        put_byte(&mut out, b'\n');
                    } else {
                        put_byte(&mut out, b'\n');
                    }
                }
                idx += 2;
            } else if b == b'\n' {
                if to_dos {
                    let count = if double_nl { 2 } else { 1 };
                    for _ in 0..count {
                        put_byte(&mut out, b'\r');
                        put_byte(&mut out, b'\n');
                    }
                } else {
                    put_byte(&mut out, b'\n');
                }
                idx += 1;
            } else {
                put_byte(&mut out, b);
                idx += 1;
            }
        }
        if add_eol && !body.is_empty() && !body.ends_with(b"\n") {
            if to_dos {
                put_byte(&mut out, b'\r');
                put_byte(&mut out, b'\n');
            } else {
                put_byte(&mut out, b'\n');
            }
        }
        Some(out)
    };

    if files.is_empty() {
        let raw = crate::vfs::stream_string_to_bytes(stdin);
        let out = convert_bytes(&raw).unwrap_or(raw);
        return ok_out(&crate::vfs::bytes_to_stream_string(&out));
    }
    if to_stdout {
        let mut out_all: Vec<u8> = Vec::new();
        for f in &files {
            let p = resolve_posix_path(cwd, f);
            if let Ok(bytes) = fs.read_file(&p)
                && let Some(conv) = convert_bytes(&bytes)
            {
                out_all.extend_from_slice(&conv);
            }
        }
        return ok_out(&crate::vfs::bytes_to_stream_string(&out_all));
    }
    if newfile_mode {
        if files.len() % 2 != 0 {
            let last = files.last().map(|s| s.as_str()).unwrap_or("");
            return err_out(
                &format!("{direction}: target of file {last} not specified in new-file mode\n"),
                1,
            );
        }
        for pair in files.chunks(2) {
            if pair.len() == 2 {
                let in_p = resolve_posix_path(cwd, &pair[0]);
                let out_p = resolve_posix_path(cwd, &pair[1]);
                let orig_mtime = fs.stat(&in_p).ok().map(|st| st.mtime_ms);
                if let Ok(bytes) = fs.read_file(&in_p)
                    && let Some(conv) = convert_bytes(&bytes)
                {
                    let _ = fs.write_file(&out_p, &conv);
                    if keep_date && let Some(ms) = orig_mtime {
                        let _ = fs.set_times(&out_p, None, Some(ms));
                    }
                }
            }
        }
        return ok_out("");
    }
    let mut stderr = String::new();
    let mut exit_code = 0;
    for f in &files {
        let p = resolve_posix_path(cwd, f);
        let orig_mtime = match fs.stat(&p) {
            Ok(st) => Some(st.mtime_ms),
            Err(_) => {
                if !quiet {
                    stderr.push_str(&format!(
                        "{direction}: {f}: No such file or directory\n{direction}: Skipping {f}, not a regular file.\n"
                    ));
                    exit_code = 2;
                }
                continue;
            }
        };
        if let Ok(bytes) = fs.read_file(&p)
            && let Some(conv) = convert_bytes(&bytes)
        {
            let _ = fs.write_file(&p, &conv);
            if keep_date && let Some(ms) = orig_mtime {
                let _ = fs.set_times(&p, None, Some(ms));
            }
        }
    }
    BuiltinOutcome {
        stdout: String::new(),
        stderr,
        exit_code,
    }
}

fn iconv_c_transliterate(cp: u32) -> &'static str {
    match cp {
        160 | 8194..=8202 | 8239 | 8287 => " ",
        169 => "(C)",
        171 => "<<",
        173 | 8208..=8211 | 8213 => "-",
        174 => "(R)",
        181 => "u",
        184 | 8218 => ",",
        187 => ">>",
        188 => " 1/4 ",
        189 => " 1/2 ",
        190 => " 3/4 ",
        198 => "AE",
        215 => "x",
        223 => "ss",
        230 => "ae",
        306 => "IJ",
        307 => "ij",
        329 => "'n",
        338 => "OE",
        339 => "oe",
        383 => "s",
        8203 | 8288..=8291 => "",
        8212 => "--",
        8216 | 8217 | 8219 => "'",
        8220 | 8221 | 8223 => "\"",
        8222 => ",,",
        8226 => "o",
        8228 => ".",
        8229 => "..",
        8230 => "...",
        8249 => "<",
        8250 => ">",
        8364 => "EUR",
        8482 => "(TM)",
        _ => "?",
    }
}

fn cmd_iconv(
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    const USAGE: &str = "Usage: iconv [-lcs?V] [-f NAME] [-t NAME] [-o FILE] [--from-code=NAME]\n             [--to-code=NAME] [--list] [--output=FILE] [--silent] [--verbose]\n             [--help] [--usage] [--version] [FILE...]\n";
    const LIST_OUT: &str = "ANSI_X3.4-1968//\nASCII//\nISO-8859-1//\nISO8859-1//\nLATIN-1//\nLATIN1//\nUS-ASCII//\nUTF-16//\nUTF-16BE//\nUTF-16LE//\nUTF-8//\nUTF16//\nUTF16BE//\nUTF16LE//\nUTF8//\n";
    const HELP_OUT: &str = "Usage: iconv [-lcs?V] [-f NAME] [-t NAME] [-o FILE] [--from-code=NAME]\n             [--to-code=NAME] [--list] [--output=FILE] [--silent] [--verbose]\n             [--help] [--usage] [--version] [FILE...]\nConvert text using the safe-bash bounded encoding engine.\n  -f, --from-code=NAME  input encoding\n  -t, --to-code=NAME    output encoding\n  -l, --list            list supported encodings and aliases\n  -c                    omit invalid characters\n  -o, --output=FILE     virtual output file (- for stdout)\n  -s, --silent          suppress warnings\n      --verbose         report input operands\n  -?, --help            show help\n      --usage           show usage\n  -V, --version         show engine identity\n";

    let mut from_opt: Option<String> = None;
    let mut to_opt: Option<String> = None;
    let mut discard = false;
    let mut verbose = false;
    let mut out_file: Option<String> = None;
    let mut files = Vec::new();
    let mut ended = false;

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if ended || a == "-" || !a.starts_with('-') {
            files.push(a.clone());
            i += 1;
            continue;
        }
        if a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if a == "--list" {
            return ok_out(LIST_OUT);
        }
        if a == "--help" {
            return ok_out(HELP_OUT);
        }
        if a == "--version" {
            return ok_out("iconv (safe-bash bounded encoding engine)\n");
        }
        if a == "--usage" {
            return ok_out(USAGE);
        }
        if a == "--silent" {
            i += 1;
            continue;
        }
        if a == "--verbose" {
            verbose = true;
            i += 1;
            continue;
        }
        if a.starts_with("--") {
            let (opt, eq_val) = match a.split_once('=') {
                Some((o, v)) => (o, Some(v.to_string())),
                None => (a.as_str(), None),
            };
            if !matches!(opt, "--from-code" | "--to-code" | "--output") {
                return err_out(&format!("iconv: unsupported option: {a}\n"), 64);
            }
            let val = match eq_val {
                Some(v) => v,
                None if i + 1 < args.len() => {
                    i += 1;
                    args[i].clone()
                }
                None => return err_out(&format!("iconv: option '{opt}' requires an argument\n"), 64),
            };
            match opt {
                "--from-code" => from_opt = Some(val),
                "--to-code" => to_opt = Some(val),
                _ => out_file = Some(val),
            }
            i += 1;
            continue;
        }
        let chars: Vec<char> = a[1..].chars().collect();
        let mut pos = 0usize;
        while pos < chars.len() {
            let flag = chars[pos];
            match flag {
                'l' => return ok_out(LIST_OUT),
                '?' => return ok_out(HELP_OUT),
                'V' => return ok_out("iconv (safe-bash bounded encoding engine)\n"),
                'c' => {
                    discard = true;
                    pos += 1;
                }
                's' => {
                    pos += 1;
                }
                'f' | 't' | 'o' => {
                    let tail: String = chars[pos + 1..].iter().collect();
                    let val = if !tail.is_empty() {
                        tail
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return err_out(
                            &format!("iconv: option requires an argument -- '{flag}'\n"),
                            64,
                        );
                    };
                    match flag {
                        'f' => from_opt = Some(val),
                        't' => to_opt = Some(val),
                        _ => out_file = Some(val),
                    }
                    break;
                }
                _ => return err_out(&format!("iconv: invalid option -- '{flag}'\n"), 64),
            }
        }
        i += 1;
    }

    let mut translit = false;
    if let Some(ref raw_to) = to_opt.clone() {
        let parts: Vec<&str> = raw_to.split("//").collect();
        for &sfx in &parts[1..] {
            if sfx.eq_ignore_ascii_case("TRANSLIT") {
                translit = true;
            } else if sfx.eq_ignore_ascii_case("IGNORE") {
                discard = true;
            } else {
                return err_out(&format!("iconv: unsupported encoding suffix: {raw_to}\n"), 1);
            }
        }
        to_opt = Some(parts[0].to_string());
    }

    if from_opt.is_none() || to_opt.is_none() || translit {
        let mut locale = String::new();
        for k in ["LC_ALL", "LC_CTYPE", "LANG"] {
            if let Some(v) = env.get(k)
                && !v.is_empty()
            {
                locale = v.clone();
                break;
            }
        }
        if locale.is_empty() {
            locale = "C".to_string();
        }
        if translit && locale != "C" && locale != "POSIX" {
            return err_out(
                &format!("iconv: unsupported transliteration locale: {locale}; supported: C, POSIX, or unset\n"),
                1,
            );
        }
        if from_opt.is_none() || to_opt.is_none() {
            let fallback = if locale == "C" || locale == "POSIX" {
                "ASCII"
            } else if locale == "C.UTF-8" || locale == "C.utf8" {
                "UTF-8"
            } else {
                return err_out(
                    &format!("iconv: unsupported default encoding locale: {locale}; specify -f and -t\n"),
                    1,
                );
            };
            if from_opt.is_none() {
                from_opt = Some(fallback.to_string());
            }
            if to_opt.is_none() {
                to_opt = Some(fallback.to_string());
            }
        }
    }

    let parse_enc = |raw: &str| -> Result<&'static str, BuiltinOutcome> {
        if raw.contains("//") {
            return Err(err_out(
                &format!("iconv: unsupported encoding suffix: {raw}\n"),
                1,
            ));
        }
        match raw.to_ascii_uppercase().as_str() {
            "ASCII" | "US-ASCII" | "ANSI_X3.4-1968" => Ok("ASCII"),
            "LATIN1" | "LATIN-1" | "ISO-8859-1" | "ISO8859-1" => Ok("LATIN1"),
            "UTF8" | "UTF-8" => Ok("UTF8"),
            "UTF16" | "UTF-16" => Ok("UTF16"),
            "UTF16LE" | "UTF-16LE" => Ok("UTF16LE"),
            "UTF16BE" | "UTF-16BE" => Ok("UTF16BE"),
            _ => Err(err_out(&format!("iconv: unsupported encoding: {raw}\n"), 1)),
        }
    };

    let from_norm = match parse_enc(from_opt.as_deref().unwrap_or("ASCII")) {
        Ok(e) => e,
        Err(o) => return o,
    };
    let to_norm = match parse_enc(to_opt.as_deref().unwrap_or("ASCII")) {
        Ok(e) => e,
        Err(o) => return o,
    };

    if files.is_empty() {
        files.push("-".to_string());
    }
    if out_file.as_deref() == Some("-") {
        out_file = None;
    }

    let encode_cp = |cp: u32, to_enc: &str, out: &mut Vec<u8>| -> bool {
        if cp > 0x10ffff || (0xd800..=0xdfff).contains(&cp) {
            return false;
        }
        match to_enc {
            "ASCII" => {
                if cp < 128 {
                    out.push(cp as u8);
                    true
                } else {
                    (0xe0000..=0xe007f).contains(&cp)
                }
            }
            "LATIN1" => {
                if cp < 256 {
                    out.push(cp as u8);
                    true
                } else {
                    (0xe0000..=0xe007f).contains(&cp)
                }
            }
            "UTF16" | "UTF16LE" | "UTF16BE" => {
                let big = to_enc == "UTF16BE";
                let mut buf = [0u16; 2];
                if let Some(ch) = char::from_u32(cp) {
                    for &w in ch.encode_utf16(&mut buf).iter() {
                        let b = if big { w.to_be_bytes() } else { w.to_le_bytes() };
                        out.extend_from_slice(&b);
                    }
                    true
                } else {
                    false
                }
            }
            _ => {
                let mut buf = [0u8; 4];
                if let Some(ch) = char::from_u32(cp) {
                    out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                    true
                } else {
                    false
                }
            }
        }
    };

    let mut out_bytes: Vec<u8> = Vec::new();
    let mut stderr = String::new();
    let mut exit_code = 0;
    let mut stdin_used = false;

    for f in &files {
        if verbose && f != "-" {
            stderr.push_str(&format!("{f}:\n"));
        }
        if f == "-" && stdin_used {
            stderr.push_str("iconv: error while reading the input: Bad file descriptor\n");
            exit_code = 1;
            break;
        }
        let raw_in = if f == "-" {
            stdin_used = true;
            stream_string_to_bytes(stdin)
        } else {
            let p = resolve_posix_path(cwd, f);
            if fs.is_dir(&p) {
                stderr.push_str("iconv: error while reading the input: Is a directory\n");
                exit_code = 1;
                break;
            }
            match fs.read_file(&p) {
                Ok(b) => b,
                Err(_) => {
                    stderr.push_str(&format!(
                        "iconv: cannot open input file `{f}': No such file or directory\n"
                    ));
                    exit_code = 1;
                    continue;
                }
            }
        };

        let mut offset = 0usize;
        let mut started = false;
        let mut big = from_norm == "UTF16BE";
        if from_norm == "UTF16" && raw_in.len() >= 2 {
            if raw_in[0] == 0xfe && raw_in[1] == 0xff {
                big = true;
                offset = 2;
            } else if raw_in[0] == 0xff && raw_in[1] == 0xfe {
                big = false;
                offset = 2;
            }
        }

        let mut fatal = false;
        while offset < raw_in.len() {
            let first = raw_in[offset];
            let decoded: Result<(usize, u32), (usize, bool)> = match from_norm {
                "ASCII" => {
                    if first < 128 {
                        Ok((1, u32::from(first)))
                    } else {
                        Err((1, false))
                    }
                }
                "LATIN1" => Ok((1, u32::from(first))),
                "UTF8" => {
                    if first < 128 {
                        Ok((1, u32::from(first)))
                    } else {
                        let (count, mut val) = if (0xc2..0xe0).contains(&first) {
                            (2usize, u32::from(first & 0x1f))
                        } else if (0xe0..0xf0).contains(&first) {
                            (3usize, u32::from(first & 0x0f))
                        } else if (0xf0..0xf5).contains(&first) {
                            (4usize, u32::from(first & 0x07))
                        } else {
                            let mut c = 1usize;
                            while c < 5
                                && offset + c < raw_in.len()
                                && (raw_in[offset + c] & 0xc0) == 0x80
                            {
                                c += 1;
                            }
                            (0usize, c as u32)
                        };
                        if count == 0 {
                            Err((val as usize, false))
                        } else {
                            let mut err: Option<(usize, bool)> = None;
                            for idx in 1..count {
                                if offset + idx >= raw_in.len() {
                                    err = Some((0, true));
                                    break;
                                }
                                let b = raw_in[offset + idx];
                                if (b & 0xc0) != 0x80 {
                                    err = Some((idx, false));
                                    break;
                                }
                                val = (val << 6) | u32::from(b & 0x3f);
                            }
                            if let Some(e) = err {
                                Err(e)
                            } else if (count == 3 && val < 0x800)
                                || (count == 4 && val < 0x10000)
                                || val > 0x10ffff
                                || (0xd800..=0xdfff).contains(&val)
                            {
                                Err((count, false))
                            } else {
                                Ok((count, val))
                            }
                        }
                    }
                }
                _ => {
                    if offset + 1 >= raw_in.len() {
                        Err((0, true))
                    } else {
                        let w = if big {
                            u16::from_be_bytes([raw_in[offset], raw_in[offset + 1]])
                        } else {
                            u16::from_le_bytes([raw_in[offset], raw_in[offset + 1]])
                        };
                        if !(0xd800..=0xdfff).contains(&w) {
                            Ok((2, u32::from(w)))
                        } else if w >= 0xdc00 {
                            Err((2, false))
                        } else if offset + 3 >= raw_in.len() {
                            Err((0, true))
                        } else {
                            let w2 = if big {
                                u16::from_be_bytes([raw_in[offset + 2], raw_in[offset + 3]])
                            } else {
                                u16::from_le_bytes([raw_in[offset + 2], raw_in[offset + 3]])
                            };
                            if (0xdc00..=0xdfff).contains(&w2) {
                                let cp = 0x10000
                                    + ((u32::from(w) - 0xd800) << 10)
                                    + (u32::from(w2) - 0xdc00);
                                Ok((4, cp))
                            } else {
                                Err((2, false))
                            }
                        }
                    }
                }
            };

            match decoded {
                Ok((step, cp)) => {
                    if !started && to_norm == "UTF16" {
                        out_bytes.extend_from_slice(&[0xff, 0xfe]);
                    }
                    started = true;
                    let mut tmp = Vec::new();
                    if encode_cp(cp, to_norm, &mut tmp) {
                        out_bytes.extend_from_slice(&tmp);
                    } else if translit {
                        let repl = iconv_c_transliterate(cp);
                        for rch in repl.chars() {
                            let _ = encode_cp(rch as u32, to_norm, &mut out_bytes);
                        }
                    } else if discard {
                        exit_code = 1;
                    } else {
                        stderr.push_str(&format!(
                            "iconv: illegal input sequence at position {offset}\n"
                        ));
                        exit_code = 1;
                        fatal = true;
                        break;
                    }
                    offset += step;
                }
                Err((step, incomplete)) => {
                    if !incomplete && discard {
                        exit_code = 1;
                        offset += step.max(1);
                    } else {
                        if incomplete {
                            stderr.push_str(
                                "iconv: incomplete character or shift sequence at end of buffer\n",
                            );
                        } else {
                            stderr.push_str(&format!(
                                "iconv: illegal input sequence at position {offset}\n"
                            ));
                        }
                        exit_code = 1;
                        fatal = true;
                        break;
                    }
                }
            }
        }
        if fatal {
            break;
        }
    }

    if let Some(of) = out_file {
        let p = resolve_posix_path(cwd, &of);
        let _ = fs.write_file(&p, &out_bytes);
        BuiltinOutcome {
            stdout: String::new(),
            stderr,
            exit_code,
        }
    } else {
        BuiltinOutcome {
            stdout: crate::vfs::bytes_to_stream_string(&out_bytes),
            stderr,
            exit_code,
        }
    }
}

fn cmd_tsort(
    args: &[String],
    stdin: &str,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    if args.len() == 1 && args[0].len() > 2 {
        if "--help".starts_with(&args[0]) {
            return ok_out(
                "Usage: tsort [OPTION] [FILE]\nWrite a topological ordering of whitespace-separated node pairs.\nWith no FILE, or FILE -, read standard input.\nOptions: --help --version\n",
            );
        }
        if "--version".starts_with(&args[0]) {
            return ok_out("tsort (virtual-bash)\n");
        }
    }
    let posixly = env.contains_key("POSIXLY_CORRECT");
    let mut options_ended = false;
    let mut files: Vec<String> = Vec::new();
    for arg in args {
        if !options_ended && arg == "--" {
            options_ended = true;
            continue;
        }
        if !options_ended && arg.starts_with("--") {
            return err_out(
                &format!("tsort: unrecognized option '{arg}'\nTry 'tsort --help' for more information.\n"),
                1,
            );
        }
        if !options_ended && arg.len() > 1 && arg.starts_with('-') {
            let ch = arg.chars().nth(1).unwrap_or('-');
            return err_out(
                &format!("tsort: invalid option -- '{ch}'\nTry 'tsort --help' for more information.\n"),
                1,
            );
        }
        files.push(arg.clone());
        if posixly {
            options_ended = true;
        }
    }
    if files.len() > 1 {
        return err_out(
            &format!("tsort: extra operand '{}'\nTry 'tsort --help' for more information.\n", files[1]),
            1,
        );
    }
    let reader_name = files.first().map(|s| s.as_str()).unwrap_or("-");
    let raw_bytes = if files.is_empty() || files[0] == "-" {
        crate::vfs::stream_string_to_bytes(stdin)
    } else {
        let p = resolve_posix_path(cwd, &files[0]);
        if fs.is_dir(&p) {
            return ok_out("");
        }
        match fs.read_file(&p) {
            Ok(b) => b,
            Err(_) => {
                return err_out(
                    &format!("tsort: {}: No such file or directory\n", files[0]),
                    1,
                );
            }
        }
    };
    let tokens: Vec<&[u8]> = raw_bytes
        .split(|b| matches!(b, b' ' | b'\t' | b'\n'))
        .filter(|token| !token.is_empty())
        .map(|token| token.split(|&b| b == 0).next().unwrap())
        .collect();
    if !tokens.len().is_multiple_of(2) {
        return err_out(
            &format!("tsort: {reader_name}: input contains an odd number of tokens\n"),
            1,
        );
    }

    struct TsortNode<'a> {
        name: &'a [u8],
        count: usize,
        printed: bool,
        edges: Vec<usize>,
    }

    let unique_names: BTreeSet<_> = tokens.iter().copied().collect();
    let mut ordered: Vec<_> = unique_names
        .into_iter()
        .map(|name| TsortNode { name, count: 0, printed: false, edges: Vec::new() })
        .collect();
    let name_to_idx: BTreeMap<_, _> = ordered.iter().enumerate().map(|(i, n)| (n.name, i)).collect();

    for pair in tokens.chunks(2) {
        let u_idx = name_to_idx[&pair[0]];
        let v_idx = name_to_idx[&pair[1]];
        if u_idx != v_idx {
            ordered[u_idx].edges.insert(0, v_idx);
            ordered[v_idx].count += 1;
        }
    }

    let mut remaining = ordered.len();
    let mut status = 0;
    let mut out = String::new();
    let mut stderr = String::new();

    while remaining > 0 {
        let mut queue: std::collections::VecDeque<usize> = std::collections::VecDeque::new();
        for (idx, node) in ordered.iter().enumerate() {
            if !node.printed && node.count == 0 {
                queue.push_back(idx);
            }
        }
        while let Some(u_idx) = queue.pop_front() {
            out.push_str(&crate::vfs::bytes_to_stream_string(ordered[u_idx].name));
            out.push('\n');
            ordered[u_idx].printed = true;
            remaining -= 1;
            let edges = ordered[u_idx].edges.clone();
            for target_idx in edges {
                ordered[target_idx].count -= 1;
                if ordered[target_idx].count == 0 {
                    queue.push_back(target_idx);
                }
            }
        }
        if remaining == 0 {
            break;
        }
        status = 1;
        stderr.push_str(&format!("tsort: {reader_name}: input contains a loop:\n"));
        let mut loop_idx: Option<usize> = None;
        let mut link: Vec<Option<usize>> = vec![None; ordered.len()];
        loop {
            for idx in 0..ordered.len() {
                if ordered[idx].count == 0 {
                    continue;
                }
                if loop_idx.is_none() {
                    loop_idx = Some(idx);
                    continue;
                }
                let cur_loop = loop_idx.unwrap();
                if let Some(epos) = ordered[idx].edges.iter().position(|&t| t == cur_loop) {
                    if link[idx].is_some() {
                        while let Some(l_idx) = loop_idx {
                            let next_l = link[l_idx];
                            stderr.push_str(&format!("tsort: {}\n", crate::vfs::bytes_to_stream_string(ordered[l_idx].name)));
                            if l_idx == idx {
                                let target_idx = ordered[idx].edges[epos];
                                ordered[target_idx].count -= 1;
                                ordered[idx].edges.remove(epos);
                                link[l_idx] = None;
                                loop_idx = next_l;
                                break;
                            }
                            link[l_idx] = None;
                            loop_idx = next_l;
                        }
                        while let Some(l_idx) = loop_idx {
                            let next_l = link[l_idx];
                            link[l_idx] = None;
                            loop_idx = next_l;
                        }
                    } else {
                        link[idx] = loop_idx;
                        loop_idx = Some(idx);
                    }
                    break;
                }
            }
            if loop_idx.is_none() {
                break;
            }
        }
    }

    BuiltinOutcome {
        stdout: out,
        stderr,
        exit_code: status,
    }
}

fn parse_truncate_size(spec: &str, prev_op: char, unicode: bool) -> Result<(u64, char), String> {
    let trimmed = spec.trim_start_matches([' ', '\t', '\n', '\r', '\x0b', '\x0c']);
    let mut op = prev_op;
    let mut rest = trimmed;
    if let Some(r) = rest.strip_prefix(['<', '>', '/', '%']) {
        op = rest.chars().next().unwrap();
        rest = r.trim_start_matches([' ', '\t', '\n', '\r', '\x0b', '\x0c']);
    }
    let number = rest;
    let invalid = || format!("truncate: Invalid number: {}\n", fmt_quote::quote(number, false, unicode));
    let mut signed = false;
    if rest.starts_with('+') || rest.starts_with('-') {
        if op != '=' {
            return Err("truncate: multiple relative modifiers specified\nTry 'truncate --help' for more information.\n".to_string());
        }
        op = rest.chars().next().unwrap();
        signed = true;
        rest = &rest[1..];
    }
    let num_len = rest.bytes().take_while(|b| b.is_ascii_digit()).count();
    let unit = &rest[num_len..];
    let base_num = if num_len == 0 {
        if signed || unit.is_empty() {
            return Err(invalid());
        }
        1u128
    } else {
        rest[..num_len]
            .parse::<u128>().unwrap_or(u128::MAX)
    };
    let mult = if unit.is_empty() {
        1u128
    } else {
        let first = unit.chars().next().unwrap_or('\0');
        let tail = &unit[first.len_utf8()..];
        let power = match first {
            'k' | 'K' => 1u32,
            'm' | 'M' => 2u32,
            'g' | 'G' => 3u32,
            't' | 'T' => 4u32,
            'P' => 5u32,
            'E' => 6u32,
            'Z' => 7u32,
            'Y' => 8u32,
            'R' => 9u32,
            'Q' => 10u32,
            _ => return Err(invalid()),
        };
        if !matches!(tail, "" | "B" | "D" | "iB") {
            return Err(invalid());
        }
        let base = if tail == "B" || tail == "D" {
            1000u128
        } else {
            1024u128
        };
        base.saturating_pow(power)
    };
    let delta = base_num.saturating_mul(mult);
    if delta > (i64::MAX as u128) + u128::from(number.starts_with('-')) {
        return Err(format!("truncate: Invalid number: {}: Value too large for defined data type\n", fmt_quote::quote(number, false, unicode)));
    }
    if (op == '/' || op == '%') && delta == 0 {
        return Err("truncate: division by zero\n".to_string());
    }
    Ok((delta as u64, if prev_op == '-' && !signed && op == '-' { '+' } else { op }))
}

fn cmd_truncate(
    args: &[String],
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut has_size = false;
    let mut op = '=';
    let mut delta = 0u64;
    let mut ref_file: Option<String> = None;
    let mut no_create = false;
    let mut io_blocks = false;
    let mut ended = false;
    let mut files = Vec::new();
    let posix = env.contains_key("POSIXLY_CORRECT");
    let unicode = ["LC_ALL", "LC_CTYPE", "LANG"].iter().find_map(|k| env.get(*k).filter(|s| !s.is_empty()))
        .is_some_and(|s| { let s = s.to_ascii_lowercase(); s.ends_with("utf-8") || s.ends_with("utf8") });

    let long_opts = [
        ("no-create", "c"),
        ("io-blocks", "o"),
        ("reference", "r"),
        ("size", "s"),
        ("help", "help"),
        ("version", "version"),
    ];

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if ended || a == "-" || !a.starts_with('-') {
            files.push(a.clone());
            if posix {
                ended = true;
            }
            i += 1;
            continue;
        }
        if a == "--" {
            ended = true;
            i += 1;
            continue;
        }
        if let Some(rest) = a.strip_prefix("--") {
            let (name, eq_val) = match rest.split_once('=') {
                Some((n, v)) => (n, Some(v)),
                None => (rest, None),
            };
            let exact = long_opts.iter().find(|&&(ln, _)| ln == name);
            let matches: Vec<_> = long_opts
                .iter()
                .filter(|&&(ln, _)| ln.starts_with(name))
                .collect();
            let selected = if let Some(ex) = exact {
                ex
            } else if matches.len() == 1 {
                matches[0]
            } else {
                return err_out(
                    &format!("truncate: unrecognized option '{a}'\nTry 'truncate --help' for more information.\n"),
                    1,
                );
            };
            let (full_name, key) = *selected;
            if key == "help" {
                if eq_val.is_some() {
                    return err_out(
                        "truncate: option '--help' doesn't allow an argument\nTry 'truncate --help' for more information.\n",
                        1,
                    );
                }
                return ok_out("Usage: truncate OPTION... FILE...\nShrink or extend the size of each FILE to the specified size\n\nA FILE argument that does not exist is created.\n\nIf a FILE is larger than the specified size, the extra data is lost.\nIf a FILE is shorter, it is extended and the extended part (hole)\nreads as zero bytes.\n\nMandatory arguments to long options are mandatory for short options too.\n  -c, --no-create        do not create any files\n  -o, --io-blocks        treat SIZE as number of IO blocks instead of bytes\n  -r, --reference=RFILE  base size on RFILE\n  -s, --size=SIZE        set or adjust the file size by SIZE bytes\n      --help     display this help and exit\n      --version  output version information and exit\n\nThe SIZE argument is an integer and optional unit (example: 10K is 10*1024).\nUnits are K,M,G,T,P,E,Z,Y (powers of 1024) or KB,MB,... (powers of 1000).\n\nSIZE may also be prefixed by one of the following modifying characters:\n'+' extend by, '-' reduce by, '<' at most, '>' at least,\n'/' round down to multiple of, '%' round up to multiple of.\n\nGNU coreutils online help: <https://www.gnu.org/software/coreutils/>\nReport truncate translation bugs to <https://translationproject.org/team/>\nFull documentation at: <https://www.gnu.org/software/coreutils/truncate>\nor available locally via: info '(coreutils) truncate invocation'\n");
            }
            if key == "version" {
                if eq_val.is_some() {
                    return err_out(
                        "truncate: option '--version' doesn't allow an argument\nTry 'truncate --help' for more information.\n",
                        1,
                    );
                }
                return ok_out("truncate (virtual-bash)\n");
            }
            if key == "c" || key == "o" {
                if eq_val.is_some() {
                    return err_out(
                        &format!("truncate: option '--{full_name}' doesn't allow an argument\nTry 'truncate --help' for more information.\n"),
                        1,
                    );
                }
                if key == "c" {
                    no_create = true;
                } else {
                    io_blocks = true;
                }
                i += 1;
                continue;
            }
            let val = if let Some(v) = eq_val {
                v.to_string()
            } else if i + 1 < args.len() {
                i += 1;
                args[i].clone()
            } else {
                return err_out(
                    &format!("truncate: option '--{full_name}' requires an argument\nTry 'truncate --help' for more information.\n"),
                    1,
                );
            };
            if key == "r" {
                ref_file = Some(val);
            } else {
                match parse_truncate_size(&val, op, unicode) {
                    Ok((d, new_op)) => {
                        delta = d;
                        op = new_op;
                        has_size = true;
                    }
                    Err(msg) => return err_out(&msg, 1),
                }
            }
            i += 1;
            continue;
        }
        let chars: Vec<char> = a[1..].chars().collect();
        let mut j = 0usize;
        while j < chars.len() {
            match chars[j] {
                'c' => no_create = true,
                'o' => io_blocks = true,
                'r' | 's' => {
                    let key = chars[j];
                    let rest: String = chars[j + 1..].iter().collect();
                    let val = if !rest.is_empty() {
                        rest
                    } else if i + 1 < args.len() {
                        i += 1;
                        args[i].clone()
                    } else {
                        return err_out(
                            &format!("truncate: option requires an argument -- '{key}'\nTry 'truncate --help' for more information.\n"),
                            1,
                        );
                    };
                    if key == 'r' {
                        ref_file = Some(val);
                    } else {
                        match parse_truncate_size(&val, op, unicode) {
                            Ok((d, new_op)) => {
                                delta = d;
                                op = new_op;
                                has_size = true;
                            }
                            Err(msg) => return err_out(&msg, 1),
                        }
                    }
                    break;
                }
                ch => return err_out(
                    &format!("truncate: invalid option -- '{ch}'\nTry 'truncate --help' for more information.\n"),
                    1,
                ),
            }
            j += 1;
        }
        i += 1;
    }

    if !has_size && ref_file.is_none() {
        return err_out(
            "truncate: you must specify either '--size' or '--reference'\nTry 'truncate --help' for more information.\n",
            1,
        );
    }
    if ref_file.is_some() && has_size && op == '=' {
        return err_out(
            "truncate: you must specify a relative '--size' with '--reference'\nTry 'truncate --help' for more information.\n",
            1,
        );
    }
    if io_blocks && !has_size {
        return err_out(
            "truncate: '--io-blocks' was specified but '--size' was not\nTry 'truncate --help' for more information.\n",
            1,
        );
    }
    if files.is_empty() {
        return err_out("truncate: missing file operand\nTry 'truncate --help' for more information.\n", 1);
    }

    let ref_len = if let Some(rf) = &ref_file {
        let stat = super::fs::command_operand(cwd, rf).map_err(str::to_owned)
            .and_then(|path| fs.inspect_command_entry(&path, true, "stat"));
        match stat {
            Ok((path, st)) if st.kind == crate::vfs::VfsEntryKind::Directory => {
                match fs.open_read_file(&path, true).and_then(|handle| handle.seek_end()) {
                    Ok(end) => Some(end),
                    Err(e) => return err_out(&format!("truncate: cannot get the size of {}: {}\n", fmt_quote::quote(rf, true, unicode), file_error_reason(&e)), 1),
                }
            }
            Ok((_, st)) => Some(st.size as u64),
            Err(e) => return err_out(&format!("truncate: cannot stat {}: {}\n", fmt_quote::quote(rf, true, unicode), file_error_reason(&e)), 1),
        }
    } else { None };

    let mode = 0o666 & !env.get("\0umask").and_then(|s| u32::from_str_radix(s, 8).ok()).unwrap_or(0o022);
    let mut stderr = String::new();
    let mut exit_code = 0;
    for f in files {
        let label = fmt_quote::quote(&f, true, unicode);
        let result = (|| -> Result<(), String> {
            let open = super::fs::command_operand(cwd, &f).map_err(str::to_owned)
                .and_then(|path| {
                    let entry = path.trim_end_matches('/');
                    if !no_create && entry.len() < path.len()
                        && !matches!(entry.rsplit('/').next(), Some("" | "." | "..")) {
                        fs.access_path(entry, false)?;
                        return Err("EISDIR: illegal operation on a directory".into());
                    }
                    fs.access_path(&path, true)
                })
                .and_then(|path| fs.open_redirect_file(&path, crate::vfs::RedirectAccess::Write, (!no_create).then_some(mode)));
            let handle = match open {
                Ok(file) => file,
                Err(e) if no_create && file_error_reason(&e) == "No such file or directory" => return Ok(()),
                Err(e) => return Err(format!("cannot open {label} for writing: {}", file_error_reason(&e))),
            };
            let stat = if io_blocks || op != '=' && ref_len.is_none() {
                match &handle {
                    Some(file) => Some(file.stat().map_err(|e| format!("cannot fstat {label}: {}", file_error_reason(&e)))?),
                    None => Some(fs.stat(&absolute_operand(cwd, &f)).map_err(|e| format!("cannot fstat {label}: {}", file_error_reason(&e)))?),
                }
            } else { None };
            let base = ref_len.unwrap_or_else(|| stat.as_ref().map_or(0, |s| s.size as u64));
            let mut size = if has_size { delta } else { base };
            if io_blocks {
                let block = stat.as_ref().and_then(|s| s.io_block_size.or(s.preferred_io_block_size)).filter(|b| *b > 0)
                    .ok_or_else(|| format!("cannot get the I/O block size of {label}: Operation not supported"))?;
                size = size.checked_mul(block).filter(|s| *s <= i64::MAX as u64 + u64::from(op == '-'))
                    .ok_or_else(|| format!("overflow in {} * {block} byte blocks for file {label}", if op == '-' { -(size as i128) } else { size as i128 }))?;
            }
            let target = match op {
                '+' => base.checked_add(size).filter(|s| *s <= i64::MAX as u64).ok_or_else(|| format!("overflow extending size of file {label}"))?,
                '-' => base.saturating_sub(size),
                '<' => base.min(size),
                '>' => base.max(size),
                '/' => base / size * size,
                '%' => base.div_ceil(size).checked_mul(size).filter(|s| *s <= i64::MAX as u64).ok_or_else(|| format!("overflow rounding up size of file {label}"))?,
                _ => size,
            };
            let resized = usize::try_from(target).ok().filter(|_| target < 1 << 53)
                .ok_or_else(|| "EFBIG: file too large".to_owned())
                .and_then(|len| handle.as_ref().ok_or_else(|| "EINVAL: invalid argument".to_owned())?.truncate_to(len));
            resized.map_err(|e| format!("failed to truncate {label} at {target} bytes: {}", file_error_reason(&e)))
        })();
        if let Err(e) = result { stderr.push_str(&format!("truncate: {e}\n")); exit_code = 1; }
    }
    BuiltinOutcome {
        stdout: String::new(),
        stderr,
        exit_code,
    }
}


fn cmd_sleep(args: &[String], env: &BTreeMap<String, String>) -> BuiltinOutcome {
    let mut after_double_dash = false;
    let mut operands: Vec<&str> = Vec::new();
    for a in args {
        if !after_double_dash && a == "--" {
            after_double_dash = true;
            continue;
        }
        if !after_double_dash && a == "--help" {
            return ok_out(
                "Usage: sleep NUMBER[smhd] ...\nSum finite nonnegative decimal or hexadecimal durations; cancellation clears pending timers.\n",
            );
        }
        if !after_double_dash && a == "--version" {
            return ok_out("sleep (safe-bash virtual command)\n");
        }
        if !after_double_dash && a.starts_with('-') && a != "-" {
            return err_out(&format!("sleep: invalid option: {a}\n"), 1);
        }
        operands.push(a.as_str());
    }
    if operands.is_empty() {
        return err_out("sleep: missing operand\n", 1);
    }

    let mut parsed = Vec::with_capacity(operands.len());
    for op in operands {
        match crate::commands::parse_sleep_interval(op) {
            Ok(iv) => parsed.push(iv),
            Err(crate::commands::SleepParseError::Invalid) => {
                return err_out(&format!("sleep: invalid time interval: {op}\n"), 1);
            }
            Err(crate::commands::SleepParseError::Overflow) => {
                return err_out("sleep: time interval exceeds supported finite range\n", 1);
            }
        }
    }

    let total_ms = match crate::commands::sum_sleep_intervals_ms(&parsed) {
        Ok(ms) => ms,
        Err(()) => {
            return err_out("sleep: time interval exceeds supported finite range\n", 1);
        }
    };

    if total_ms > 0 {
        crate::commands::advance_virtual_clock(total_ms as f64, env);
    }
    ok_out("")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::MemoryVfs;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn install_empty_operands_never_redirect_a_copy_to_root() {
        let fs = MemoryVfs::new();
        fs.write_file("/w/f", b"source").unwrap();
        fs.write_file("/f", b"keep").unwrap();
        fs.chmod("/f", 0o640).unwrap();
        let before = fs.stat("/f").unwrap();
        for (operands, diagnostic) in [
            (vec!["f", ""], "cannot overwrite directory '' with non-directory 'f'"),
            (vec!["-D", "f", ""], "cannot overwrite directory '' with non-directory 'f'"),
            (vec!["-T", "f", ""], "cannot overwrite directory '' with non-directory 'f'"),
            (vec!["missing", ""], "cannot stat 'missing': No such file or directory"),
            (vec!["f", "f", ""], "target '': No such file or directory"),
            (vec!["-Dt", "", "f"], "failed to access '': No such file or directory"),
            (vec!["-t", "", "f"], "failed to access '': No such file or directory"),
            (vec!["", "/f"], "cannot stat '': No such file or directory"),
        ] {
            let r = cmd_install(&args(&operands), "/w", &BTreeMap::new(), &fs);
            assert_eq!(fs.read_file("/f").unwrap(), b"keep", "{operands:?}");
            let after = fs.stat("/f").unwrap();
            assert_eq!((&after.identity, after.mode), (&before.identity, before.mode));
            assert_eq!(r.exit_code, 1, "{operands:?}");
            assert_eq!(r.stderr, format!("install: {diagnostic}\n"), "{operands:?}");
        }
    }

    #[test]
    fn install_classifies_target_directories_after_traversing_links_and_parents() {
        let fs = MemoryVfs::new();
        fs.write_file("/w/f", b"source").unwrap();
        fs.mkdir_all("/target/deep").unwrap();
        fs.mkdir_all("/target/dir").unwrap();
        fs.symlink("/target/deep", "/w/jump").unwrap();
        for operands in [vec!["f", "jump/../dir"], vec!["-t", "jump/../dir", "f"]] {
            let r = cmd_install(&args(&operands), "/w", &BTreeMap::new(), &fs);
            assert_eq!(r.exit_code, 0, "{}", r.stderr);
            assert_eq!(fs.read_file("/target/dir/f").unwrap(), b"source");
            fs.remove_one("/target/dir/f", false).unwrap();
        }
        let r = cmd_install(&args(&["f", "f", "missing/.."]), "/w", &BTreeMap::new(), &fs);
        assert_eq!(r.stderr, "install: target 'missing/..': No such file or directory\n");
    }

    #[test]
    fn truncate_retains_write_only_bytes_and_applies_limits_after_opening() {
        let fs = MemoryVfs::new();
        fs.set_max_file_bytes(4);
        fs.write_file("/f", b"ABC").unwrap();
        fs.hard_link("/f", "/alias").unwrap();
        fs.chmod("/f", 0o200).unwrap();
        let r = cmd_truncate(&args(&["-s+1", "f"]), "/", &BTreeMap::new(), &fs);
        assert_eq!(r.exit_code, 0, "{}", r.stderr);
        fs.chmod("/f", 0o600).unwrap();
        assert_eq!(fs.read_file("/alias").unwrap(), b"ABC\0");
        let r = cmd_truncate(&args(&["-s5", "new", "f"]), "/", &BTreeMap::new(), &fs);
        assert_eq!(fs.stat("/new").unwrap().size, 0);
        assert_eq!(fs.read_file("/f").unwrap(), b"ABC\0");
        assert_eq!(r.stderr, "truncate: failed to truncate 'new' at 5 bytes: File too large\ntruncate: failed to truncate 'f' at 5 bytes: File too large\n");
        let r = cmd_truncate(&args(&["-s1", "", "missing/../f"]), "/", &BTreeMap::new(), &fs);
        assert_eq!(r.stderr, "truncate: cannot open '' for writing: No such file or directory\ntruncate: cannot open 'missing/../f' for writing: No such file or directory\n");
        assert_eq!(fs.read_file("/f").unwrap(), b"ABC\0");
    }

    #[test]
    fn truncate_creation_rejects_directory_spellings_before_creating_an_inode() {
        let fs = MemoryVfs::new();
        fs.write_file("/f", b"keep").unwrap();
        for (operands, reason) in [
            (vec!["-s0", "/dev"], "Is a directory"),
            (vec!["-s0", "new/"], "Is a directory"),
            (vec!["-s0", "f/"], "Is a directory"),
            (vec!["-cs0", "f/"], "Not a directory"),
            (vec!["-s0", "missing/../f/"], "No such file or directory"),
            (vec!["-s0", "f/child/"], "Not a directory"),
        ] {
            let r = cmd_truncate(&args(&operands), "/", &BTreeMap::new(), &fs);
            assert_eq!(r.exit_code, 1, "{operands:?}");
            assert_eq!(r.stderr, format!("truncate: cannot open '{}' for writing: {reason}\n", operands[1]));
            assert!(!fs.exists("/new"));
            assert_eq!(fs.read_file("/f").unwrap(), b"keep");
        }
    }

    #[test]
    fn truncate_uses_descriptor_block_size_and_checks_large_offsets_before_resize() {
        let fs = MemoryVfs::new();
        fs.set_max_file_bytes(4);
        let env = BTreeMap::from([("\0umask".into(), "077".into())]);
        for (operands, diagnostic) in [
            (vec!["-os1", "f"], "failed to truncate 'f' at 65536 bytes: File too large"),
            (vec!["-r", "/", "f"], "failed to truncate 'f' at 9223372036854775807 bytes: File too large"),
            (vec!["-s9007199254740992", "f"], "failed to truncate 'f' at 9007199254740992 bytes: File too large"),
            (vec!["-s1Q", "f"], "Invalid number: '1Q': Value too large for defined data type"),
        ] {
            let r = cmd_truncate(&args(&operands), "/", &env, &fs);
            assert_eq!(r.exit_code, 1);
            assert_eq!(r.stderr, format!("truncate: {diagnostic}\n"));
            let stat = fs.stat("/f").unwrap();
            assert_eq!((stat.size, stat.mode & 0o777), (0, 0o600));
        }
    }

    #[test]
    fn standalone_head_rejects_unterminated_device_input_at_the_input_limit() {
        let fs = MemoryVfs::new();
        let out = try_run_coreutil("head", &args(&["-n1", "/dev/zero"]), "", "/", &BTreeMap::new(), &fs).unwrap();
        assert_ne!(out.exit_code, 0);
        assert!(out.stderr.contains("maxInputBytes"));
    }

    #[test]
    fn csplit_publishes_binary_pieces_without_overwriting_input_aliases() {
        let fs = MemoryVfs::new();
        let bytes = b"\xff\x00\n\x80\nlast";
        fs.write_file("/src", bytes).unwrap();
        fs.write_file("/xx01", b"old").unwrap();
        fs.chmod("/xx01", 0o600).unwrap();
        let r = cmd_csplit(&args(&["src", "2"]), "", "/", &fs);
        assert_eq!((r.exit_code, r.stdout.as_str()), (0, "3\n6\n"));
        assert_eq!(fs.read_file("/xx00").unwrap(), &bytes[..3]);
        assert_eq!(fs.read_file("/xx01").unwrap(), &bytes[3..]);
        assert_eq!(fs.stat("/xx00").unwrap().mode & 0o777, 0o666);
        assert_eq!(fs.stat("/xx01").unwrap().mode & 0o777, 0o600);

        fs.remove_path("/xx00").unwrap();
        fs.hard_link("/src", "/xx00").unwrap();
        let r = cmd_csplit(&args(&["src", "2"]), "", "/", &fs);
        assert_eq!(r.stderr, "csplit: output would overwrite the input file\n");
        assert_eq!(fs.read_file("/src").unwrap(), bytes);
    }

    #[test]
    fn csplit_elides_existing_empty_piece_before_reusing_its_name() {
        let fs = MemoryVfs::new();
        fs.write_file("/src", b"one\ntwo\n").unwrap();
        fs.write_file("/xx00", b"old").unwrap();
        fs.chmod("/xx00", 0o600).unwrap();
        let r = cmd_csplit(&args(&["-z", "src", "1"]), "", "/", &fs);
        assert_eq!((r.exit_code, r.stdout.as_str()), (0, "8\n"));
        assert_eq!(fs.stat("/xx00").unwrap().mode & 0o777, 0o666);
        assert_eq!(fs.read_file("/xx00").unwrap(), b"one\ntwo\n");
    }

    #[test]
    fn csplit_preserves_unsafe_outputs_and_rolls_back_completed_pieces() {
        for keep in [false, true] {
            let fs = MemoryVfs::new();
            fs.write_file("/src", b"abc\ndef\n").unwrap();
            fs.write_file("/other", b"preserve").unwrap();
            fs.symlink("other", "/xx01").unwrap();
            let mut flags = args(&["src", "2"]);
            if keep { flags.insert(0, "-k".into()); }
            let r = cmd_csplit(&flags, "", "/", &fs);
            assert_eq!((r.exit_code, r.stdout.as_str(), r.stderr.as_str()), (1, "4\n", "csplit: unsafe output file 'xx01'\n"));
            assert_eq!(fs.exists("/xx00"), keep);
            assert_eq!(fs.read_file("/other").unwrap(), b"preserve");
            assert_eq!(fs.readlink("/xx01").unwrap(), "other");
        }
        let fs = MemoryVfs::new();
        fs.write_file("/xx00", b"a\nb\n").unwrap();
        fs.symlink("xx00", "/alias").unwrap();
        let r = cmd_csplit(&args(&["alias", "2"]), "", "/", &fs);
        assert_eq!(r.stderr, "csplit: output would overwrite the input file\n");
        assert_eq!(fs.read_file("/xx00").unwrap(), b"a\nb\n");
        let r = cmd_csplit(&args(&["-f", "missing/x", "xx00", "2"]), "", "/", &fs);
        assert_eq!(r.stderr, "csplit: missing/x00: No such file or directory\n");
        assert!(!fs.exists("/missing"));
    }

    #[test]
    fn sleep_validates_missing_invalid_negative_and_advances_virtual_clock() {
        let mut env = BTreeMap::new();
        assert_eq!(cmd_sleep(&args(&[]), &mut env).exit_code, 1);
        assert_eq!(cmd_sleep(&args(&["abc"]), &mut env).exit_code, 1);
        assert_eq!(cmd_sleep(&args(&["-1"]), &mut env).exit_code, 1);
        assert_eq!(cmd_sleep(&args(&["--", "-0.5"]), &mut env).exit_code, 1);
        assert_eq!(cmd_sleep(&args(&["0.05", "0.15s"]), &mut env).exit_code, 0);
        assert_eq!(cmd_sleep(&args(&["0x1p-4"]), &mut env).exit_code, 0);
    }

    #[test]
    fn expr_keeps_large_integers_exact() {
        let max = "170141183460469231731687303715884105727";
        let next = "170141183460469231731687303715884105728";
        let min = "-170141183460469231731687303715884105728";
        for (tokens, result) in [
            (&[max, "+", "1"][..], next),
            (&[min, "/", "-1"], next),
            (&[min, "%", "-1"], "0"),
            (&[min, "-", "1"], "-170141183460469231731687303715884105729"),
            (&[next, "*", "-2"], "-340282366920938463463374607431768211456"),
            (&["-340282366920938463463374607431768211457", "%", next], "-1"),
            (&[next, "<", "2"], "0"),
            (&["substr", "abc", "2", next], "bc"),
            (&["substr", "abc", next, "2"], ""),
        ] {
            let r = cmd_expr(&args(tokens), &BTreeMap::new());
            assert_eq!(r.stdout, format!("{result}\n"), "{tokens:?}: {}", r.stderr);
            assert_eq!(r.exit_code, i32::from(result == "0" || result.is_empty()));
        }
    }

    #[test]
    fn expr_syntax_errors_identify_the_operand() {
        for (tokens, detail) in [
            (&[][..], "missing operand\nTry 'expr --help' for more information."),
            (&["--"], "missing operand\nTry 'expr --help' for more information."),
            (&["index", "a"], "syntax error: missing argument after 'a'"),
            (&["(", "1"], "syntax error: expecting ')' after '1'"),
            (&["(", "a", "b"], "syntax error: expecting ')' instead of 'b'"),
            (&["1", "x'é\n"], r"syntax error: unexpected argument 'x\'\303\251\n'"),
        ] {
            let result = cmd_expr(&args(tokens), &BTreeMap::new());
            assert_eq!(result.exit_code, 2);
            assert_eq!(result.stderr, format!("expr: {detail}\n"));
        }
    }

    #[test]
    fn bc_expr_factor_seq_and_numfmt_calculations() {
        let vfs = MemoryVfs::new();
        let bc = cmd_bc(&args(&["-l"]), "2^10 + 24\n", "/", &vfs);
        assert_eq!(bc.exit_code, 0);
        assert_eq!(bc.stdout.trim(), "1048");

        let expr = cmd_expr(&args(&["15", "*", "3", "+", "5"]), &BTreeMap::new());
        assert_eq!(expr.exit_code, 0);
        assert_eq!(expr.stdout.trim(), "50");

        let factor = try_run_coreutil("factor", &args(&["360"]), "", "/", &BTreeMap::new(), &vfs).unwrap();
        assert_eq!(factor.exit_code, 0);
        assert_eq!(factor.stdout.trim(), "360: 2 2 2 3 3 5");
    }


    #[test]
    fn unit_sort_uniq_cut_tr_paste_comm_and_head_tail_wc() {
        assert_eq!(head_tail_count("8PiB"), Err("invalid number '8PiB'".to_string()));
        assert_eq!(head_tail_count("9007199254740991"), Ok(9_007_199_254_740_991));
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        let env = BTreeMap::new();

        let sorted = try_run_coreutil("sort", &args(&["-n", "-r"]), "10\n2\n30\n", "/work", &env, &vfs).unwrap();
        assert_eq!(sorted.stdout, "30\n10\n2\n");

        let uniq = try_run_coreutil("uniq", &args(&["-c"]), "a\na\nb\n", "/work", &env, &vfs).unwrap();
        assert!(uniq.stdout.contains("2 a") && uniq.stdout.contains("1 b"));

        let cut = try_run_coreutil("cut", &args(&["-d:", "-f2"]), "u1:alice:admin\nu2:bob:user\n", "/work", &env, &vfs).unwrap();
        assert_eq!(cut.stdout, "alice\nbob\n");

        let tr = try_run_coreutil("tr", &args(&["a-z", "A-Z"]), "hello", "/work", &env, &vfs).unwrap();
        assert_eq!(tr.stdout, "HELLO");
    }

    #[test]
    #[cfg(any(target_os = "linux", target_os = "macos", windows))]
    fn sort_honors_locale_precedence_case_order_and_invalid_utf8() {
        let fs = MemoryVfs::new();
        fs.write_file("/x", b"z\n\xc3\xa4\nA\na\n\xff\n").unwrap();
        let mut env = BTreeMap::from([
            ("LANG".into(), "sv_SE.UTF-8".into()),
            ("LC_COLLATE".into(), "de_DE".into()),
        ]);
        for (all, expected) in [
            ("", "a\nA\nä\nz\n"),
            ("sv-SE", "a\nA\nz\nä\n"),
            ("POSIX", "A\na\nz\nä\n"),
        ] {
            env.insert("LC_ALL".into(), all.into());
            let result = try_run_coreutil("sort", &args(&["/x"]), "", "/", &env, &fs).unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            assert_eq!(
                crate::vfs::stream_string_to_bytes(&result.stdout),
                [expected.as_bytes(), b"\xff\n"].concat()
            );
        }
        fs.write_file("/numbers", b"a10\na2\n").unwrap();
        for (locale, expected) in [("en-u-kn", "a2\na10\n"), ("en-u-kn-false-kn", "a10\na2\n")] {
            env.insert("LC_ALL".into(), locale.into());
            let result = try_run_coreutil("sort", &args(&["/numbers"]), "", "/", &env, &fs).unwrap();
            assert_eq!(result.stdout, expected, "{locale}");
        }
        for locale in ["zz-ZZ", "en_US@modifier", "en%%", "en-GB-oed"] {
            env.insert("LC_ALL".into(), locale.into());
            let result = try_run_coreutil("sort", &args(&["/missing"]), "", "/", &env, &fs).unwrap();
            assert_eq!(
                (result.exit_code, result.stderr),
                (
                    2,
                    format!("sort: unsupported collation locale '{locale}'\n")
                )
            );
        }
    }

    #[test]
    fn fold_uses_the_portable_width_profile_for_marks_and_wide_glyphs() {
        let input = "x\u{ad}x\nx\u{5b0}x\nx\u{231a}x\nx\u{1f321}x\nx\u{1fae8}x\nx\u{1ae0}x";
        let output = try_run_coreutil("fold", &args(&["-w2"]), input, "/", &BTreeMap::new(), &MemoryVfs::new()).unwrap();
        assert_eq!(output.stdout, "x\u{ad}x\nx\u{5b0}x\nx\n\u{231a}\nx\nx\u{1f321}\nx\nx\u{1fae8}\nx\nx\u{1ae0}x");
    }

    #[test]
    fn fold_counts_controls_and_keeps_decoder_buffered_nuls_with_their_record() {
        let fs = MemoryVfs::new();
        fs.write_file("/bytes", b"x\x01x\nx\0xx\nxx\0x\n\xe1\x81\0x\nx\xc2\x85x\n").unwrap();
        let result = try_run_coreutil("fold", &args(&["-w2", "/bytes"]), "", "/", &BTreeMap::new(), &fs).unwrap();
        assert_eq!(crate::vfs::stream_string_to_bytes(&result.stdout), b"x\x01\nx\nx\0\nxx\nxx\0\nx\n\xe1\x81\0\nx\nx\xc2\x85\nx\n");
    }

    #[test]
    fn fold_checks_widths_after_parsing_options_and_accepts_safe_integers() {
        let fs = MemoryVfs::new();
        for (options, expected) in [
            (vec!["--wi=2"], "fold: unrecognized option '--wi=2'\n"),
            (vec!["--ch=2"], "fold: option '--ch' does not take an argument\n"),
            (vec!["-w0", "--bad"], "fold: unrecognized option '--bad'\n"),
            (vec!["-w0", "-w2"], "fold: invalid number '0'\n"),
            (vec!["-w", " 2"], "fold: invalid number ' 2'\n"),
            (vec!["-9007199254740992"], "fold: invalid number '9007199254740992'\n"),
        ] {
            let result = try_run_coreutil("fold", &args(&options), "abc", "/", &BTreeMap::new(), &fs).unwrap();
            assert_eq!((result.exit_code, result.stderr.as_str()), (1, expected));
        }
        let result = try_run_coreutil("fold", &args(&["--ch", "--width=+9007199254740991"]), "abc", "/", &BTreeMap::new(), &fs).unwrap();
        assert_eq!((result.exit_code, result.stdout.as_str()), (0, "abc"));
    }

    #[test]
    fn tac_regex_uses_rightmost_byte_matches_and_full_subject_anchors() {
        let fs = MemoryVfs::new();
        for (pattern, expected) in [
            ("^a", "aabbb\nzab\nxx123a"),
            ("$", "\nxx123\nzabaaabbb"),
            ("^", "xx123zab\naaabbb\n"),
            ("[[:digit:]]+", "32aaabbb\nzab\nxx1"),
        ] {
            let result = try_run_coreutil("tac", &args(&["-rs", pattern]), "aaabbb\nzab\nxx123", "/", &BTreeMap::new(), &fs).unwrap();
            assert_eq!((result.stdout.as_str(), result.stderr.as_str(), result.exit_code), (expected, "", 0), "{pattern}");
        }
        let grouped = try_run_coreutil("tac", &args(&["-rs", r"\(a?\)+\1"]), "axaa", "/", &BTreeMap::new(), &fs).unwrap();
        assert_eq!(grouped.stdout, "aaxa");
        fs.write_file("/binary", b"a\xff\n\0a").unwrap();
        let binary = try_run_coreutil("tac", &args(&["-brs", ".", "/binary"]), "", "/", &BTreeMap::new(), &fs).unwrap();
        assert_eq!(crate::vfs::stream_string_to_bytes(&binary.stdout), b"a\0\xff\na");
        for (pattern, error) in [
            ("[z", "Unmatched [, [^, [:, [., or [="),
            (r"\1", "Invalid back reference"),
            (r"\(x", r"Unmatched ( or \("),
        ] {
            let result = try_run_coreutil("tac", &args(&["-rs", pattern]), "", "/", &BTreeMap::new(), &fs).unwrap();
            assert_eq!((result.exit_code, result.stderr), (1, format!("tac: EINVAL: {error}\n")));
        }
    }

    #[test]
    fn unit_nl_tac_rev_join_comm_tsort_and_envsubst() {
        let vfs = MemoryVfs::new();
        let mut env = BTreeMap::new();
        env.insert("APP".into(), "poe".into());

        let tac = try_run_coreutil("tac", &[], "line1\nline2\nline3\n", "/", &env, &vfs).unwrap();
        assert_eq!(tac.stdout, "line3\nline2\nline1\n");

        let rev = try_run_coreutil("rev", &[], "abcd\n1234\n", "/", &env, &vfs).unwrap();
        assert_eq!(rev.stdout, "dcba\n4321\n");

        let subst = try_run_coreutil("envsubst", &[], "service=$APP\n", "/", &env, &vfs).unwrap();
        assert_eq!(subst.stdout, "service=poe\n");

        let tsort = try_run_coreutil("tsort", &[], "a b\nb c\n", "/", &env, &vfs).unwrap();
        assert_eq!(tsort.exit_code, 0);
        assert_eq!(tsort.stdout, "a\nb\nc\n");

        let col = try_run_coreutil(
            "column",
            &args(&["-t", "-s", ",", "-o", " | ", "-N", "HOST,REGION,LATENCY,STATE", "-R", "LATENCY", "-H", "STATE"]),
            "node-a,us-east,12,online\nnode-b,eu-west,140,online\nnode-c,ap-south,8,maintenance\n",
            "/",
            &env,
            &vfs,
        ).unwrap();
        assert_eq!(col.exit_code, 0);
        assert_eq!(
            col.stdout,
            "HOST   | REGION   | LATENCY\nnode-a | us-east  |  12\nnode-b | eu-west  | 140\nnode-c | ap-south |   8\n"
        );
    }

    #[test]
    fn unit_dd_truncate_split_csplit_join_cut_nl_expand_fold_and_sponge() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        let env = BTreeMap::new();

        vfs.write_file("/work/in.bin", b"0123456789abcdef").unwrap();
        vfs.write_file("/work/out.bin", b"________________").unwrap();
        let dd = try_run_coreutil(
            "dd",
            &args(&[
                "if=/work/in.bin",
                "of=/work/out.bin",
                "bs=4",
                "skip=1",
                "seek=2",
                "count=2",
                "conv=ucase,notrunc",
            ]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(dd.exit_code, 0);
        assert_eq!(vfs.read_file("/work/out.bin").unwrap(), b"________456789AB");

        let trunc = try_run_coreutil("truncate", &args(&["-s", "8", "/work/out.bin"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(trunc.exit_code, 0);
        assert_eq!(vfs.read_file("/work/out.bin").unwrap().len(), 8);

        vfs.write_file("/work/u.csv", b"1,alice\n2,bob\n").unwrap();
        vfs.write_file("/work/r.csv", b"1,admin\n3,guest\n").unwrap();
        let jn = try_run_coreutil(
            "join",
            &args(&["-t,", "-a1", "-a2", "-e", "NA", "-o", "0,1.2,2.2", "/work/u.csv", "/work/r.csv"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(jn.exit_code, 0);
        assert_eq!(jn.stdout, "1,alice,admin\n2,bob,NA\n3,NA,guest\n");

        let nl = try_run_coreutil(
            "nl",
            &args(&["-bt", "-n", "rz", "-w", "3", "-s", ": ", "-v", "10", "-i", "5"]),
            "first\n\nsecond\n",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(nl.stdout, "010: first\n     \n015: second\n");

        let sp = try_run_coreutil("sponge", &args(&["/work/sp.txt"]), "soaked\n", "/work", &env, &vfs).unwrap();
        assert_eq!(sp.exit_code, 0);
        assert_eq!(vfs.read_file("/work/sp.txt").unwrap(), b"soaked\n");

        let inst = try_run_coreutil(
            "install",
            &args(&["-D", "-m", "755", "/work/sp.txt", "/work/opt/bin/sp"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(inst.exit_code, 0);
        assert_eq!(vfs.stat("/work/opt/bin/sp").unwrap().mode & 0o777, 0o755);
    }

    #[test]
    fn dd_version_and_option_operand_diagnostics_match_typescript() {
        let vfs = MemoryVfs::new();
        let env = BTreeMap::new();

        let ver = try_run_coreutil("dd", &args(&["--version"]), "", "/", &env, &vfs).unwrap();
        assert_eq!(ver.exit_code, 0);
        assert_eq!(ver.stdout, "dd (virtual-bash GNU-compatible profile)\n");

        let bad_long = try_run_coreutil("dd", &args(&["--bogus"]), "", "/", &env, &vfs).unwrap();
        assert_eq!(bad_long.exit_code, 1);
        assert_eq!(
            bad_long.stderr,
            "dd: unrecognized option `--bogus'\nTry 'dd --help' for more information.\n"
        );

        let bad_short = try_run_coreutil("dd", &args(&["-z"]), "", "/", &env, &vfs).unwrap();
        assert_eq!(bad_short.exit_code, 1);
        assert_eq!(
            bad_short.stderr,
            "dd: invalid option -- 'z'\nTry 'dd --help' for more information.\n"
        );

        let bad_op = try_run_coreutil("dd", &args(&["foo=bar"]), "", "/", &env, &vfs).unwrap();
        assert_eq!(bad_op.exit_code, 1);
        assert_eq!(
            bad_op.stderr,
            "dd: unrecognized operand 'foo=bar'\nTry 'dd --help' for more information.\n"
        );
    }

    #[test]
    fn bc_option_diagnostics_halt_last_and_runtime_errors_match_typescript() {
        let vfs = MemoryVfs::new();
        let env = BTreeMap::new();

        let bad_short = try_run_coreutil("bc", &args(&["-z"]), "", "/", &env, &vfs).unwrap();
        assert_eq!(bad_short.exit_code, 2);
        assert_eq!(bad_short.stderr, "bc: invalid option -- 'z'\n");

        let bad_long = try_run_coreutil("bc", &args(&["--bogus"]), "", "/", &env, &vfs).unwrap();
        assert_eq!(bad_long.exit_code, 2);
        assert_eq!(bad_long.stderr, "bc: invalid option -- '-'\n");

        let halt_res = try_run_coreutil(
            "bc",
            &[],
            "10 + 5\nlast * 2\nhalt\n999\n",
            "/",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(halt_res.exit_code, 0);
        assert_eq!(halt_res.stdout, "15\n30\n");

        let div0 = try_run_coreutil("bc", &[], "7\n1 / 0\n99\n", "/", &env, &vfs).unwrap();
        assert_eq!(div0.exit_code, 1);
        assert_eq!(div0.stdout, "7\n");
        assert_eq!(
            div0.stderr,
            "bc: Runtime error (func=(main), adr=0): Divide by zero\n"
        );

        let neg_sqrt = try_run_coreutil("bc", &[], "sqrt(-4)\n", "/", &env, &vfs).unwrap();
        assert_eq!(neg_sqrt.exit_code, 1);
        assert_eq!(
            neg_sqrt.stderr,
            "bc: Runtime error: Square root of a negative number\n"
        );
    }

    #[test]
    fn iconv_and_dos2unix_options_locales_and_diagnostics_match_typescript() {
        let vfs = MemoryVfs::new();
        let mut env = BTreeMap::new();

        let list_out = try_run_coreutil("iconv", &args(&["-l"]), "", "/", &env, &vfs).unwrap();
        assert_eq!(list_out.exit_code, 0);
        assert!(list_out.stdout.starts_with("ANSI_X3.4-1968//\nASCII//\n"));

        let bad_opt = try_run_coreutil("iconv", &args(&["--bogus"]), "", "/", &env, &vfs).unwrap();
        assert_eq!(bad_opt.exit_code, 64);
        assert_eq!(bad_opt.stderr, "iconv: unsupported option: --bogus\n");

        let bad_enc = try_run_coreutil(
            "iconv",
            &args(&["-f", "EBCDIC", "-t", "UTF-8"]),
            "",
            "/",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(bad_enc.exit_code, 1);
        assert_eq!(bad_enc.stderr, "iconv: unsupported encoding: EBCDIC\n");

        env.insert("LC_ALL".to_string(), "C.UTF-8".to_string());
        let bad_translit = try_run_coreutil(
            "iconv",
            &args(&["-f", "UTF-8", "-t", "ASCII//TRANSLIT"]),
            "ok",
            "/",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(bad_translit.exit_code, 1);
        assert_eq!(
            bad_translit.stderr,
            "iconv: unsupported transliteration locale: C.UTF-8; supported: C, POSIX, or unset\n"
        );

        let incomplete = try_run_coreutil(
            "iconv",
            &args(&["-f", "UTF-8", "-t", "UTF-8", "-c"]),
            &crate::vfs::bytes_to_stream_string(b"AB\xc3"),
            "/",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(incomplete.exit_code, 1);
        assert_eq!(incomplete.stdout, "AB");
        assert_eq!(
            incomplete.stderr,
            "iconv: incomplete character or shift sequence at end of buffer\n"
        );

        let bad_d2u = try_run_coreutil(
            "dos2unix",
            &args(&["-iZ"]),
            "",
            "/",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(bad_d2u.exit_code, 1);
        assert_eq!(
            bad_d2u.stderr,
            "dos2unix: wrong flag 'Z' for option -i or --info\n"
        );
    }

    #[test]
    fn fmt_selects_the_diagnostic_profile_before_options_and_quotes_original_bytes() {
        let fs = MemoryVfs::new();
        let mut env = BTreeMap::from([("LANG".into(), "de_DE.UTF-8".into())]);
        let run = |argv: &[&str], env: &BTreeMap<String, String>| {
            let r = try_run_coreutil("fmt", &args(argv), "", "/", env, &fs).unwrap();
            assert_eq!(r.exit_code, 1);
            crate::vfs::stream_string_to_bytes(&r.stderr)
        };
        assert_eq!(run(&["--version"], &env), b"fmt: Unavailable fmt byte/locale profile\n");
        env.insert("LC_CTYPE".into(), "EN_US.utf8".into());
        assert_eq!(run(&["-w", "é\t’"], &env), "fmt: invalid width: ‘é\\t\\’’\n".as_bytes());
        env.insert("LC_ALL".into(), "POSIX".into());
        assert_eq!(run(&["-g", "é\t'"], &env), b"fmt: invalid width: '\\303\\251\\t\\''\n");
        assert_eq!(run(&["a'b"], &env), b"fmt: cannot open \"a'b\" for reading: No such file or directory\n");
        assert_eq!(run(&["-cé"], &env), b"fmt: invalid option -- '\xc3'\nTry 'fmt --help' for more information.\n");
    }

    #[test]
    fn fmt_pr_column_nl_and_gnu_information_match_typescript() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        let mut env = BTreeMap::new();

        let fmt_ver = try_run_coreutil("fmt", &args(&["--version"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(fmt_ver.exit_code, 0);
        assert_eq!(fmt_ver.stdout, "fmt (virtual-bash)\n");

        let fmt_over_w = try_run_coreutil("fmt", &args(&["-w", "3000"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(fmt_over_w.exit_code, 1);
        assert_eq!(
            fmt_over_w.stderr,
            "fmt: invalid width: '3000': Numerical result out of range\n"
        );

        let fmt_over_g = try_run_coreutil("fmt", &args(&["-w", "60", "-g", "80"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(fmt_over_g.exit_code, 1);
        assert_eq!(
            fmt_over_g.stderr,
            "fmt: invalid width: '80': Value too large for defined data type\n"
        );

        let fmt_dir = try_run_coreutil("fmt", &args(&["/work"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(fmt_dir.exit_code, 1);
        assert_eq!(fmt_dir.stderr, "fmt: error reading '/work': Is a directory\n");

        vfs.write_file("/work/p.txt", b"hello\n").unwrap();
        vfs.set_mtime("/work/p.txt", 1_742_049_000_000).unwrap();
        let pr_df = try_run_coreutil(
            "pr",
            &args(&["--date-format=%Y/%m/%d", "-l", "12", "/work/p.txt"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(pr_df.exit_code, 0);
        assert!(pr_df.stdout.contains("2025/03/15"));

        let pr_merge_stdin = try_run_coreutil(
            "pr",
            &args(&["-m", "-t", "-", "-"]),
            "1\n2\n3\n4\n",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(pr_merge_stdin.exit_code, 0);
        assert_eq!(pr_merge_stdin.stdout, "1\t\t\t\t    2\n3\t\t\t\t    4\n");

        env.insert("LC_ALL".to_string(), "fr_FR.UTF-8".to_string());
        let pr_loc = try_run_coreutil("pr", &args(&[]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(pr_loc.exit_code, 1);
        assert_eq!(pr_loc.stderr, "pr: unsupported locale 'fr_FR.UTF-8'\n");
        env.remove("LC_ALL");

        let nl_ver = try_run_coreutil("nl", &args(&["--version"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(nl_ver.exit_code, 0);
        assert_eq!(nl_ver.stdout, "nl (safe-bash virtual implementation)\n");

        let col_err = try_run_coreutil("column", &args(&["-N", "a,b"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(col_err.exit_code, 1);
        assert_eq!(col_err.stderr, "column: EINVAL: table options require -t/--table\n");

        let paste_err = try_run_coreutil("paste", &args(&["-d", "a\\"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(paste_err.exit_code, 1);
        assert_eq!(paste_err.stderr, "paste: EINVAL: delimiter list ends in an unescaped backslash\n");

        let comm_err = try_run_coreutil("comm", &args(&["/work/p.txt"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(comm_err.exit_code, 1);
        assert_eq!(comm_err.stderr, "comm: EINVAL: comm requires exactly two files\n");

        let cut_err = try_run_coreutil("cut", &args(&["-b", "1", "-f", "1"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(cut_err.exit_code, 2);
        assert_eq!(cut_err.stderr, "cut: exactly one byte, character, or field list is required\n");
    }

    #[test]
    fn join_tsort_sponge_envsubst_tac_rev_sort_uniq_and_streams_match_typescript() {
        use crate::vfs::{MemoryVfs, SafeBashFs};

        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work/dir").unwrap();
        vfs.write_file("/work/in.txt", b"b\na\n").unwrap();
        let env: BTreeMap<String, String> = BTreeMap::new();
        let args = |items: &[&str]| -> Vec<String> { items.iter().map(|s| s.to_string()).collect() };

        let join_missing = try_run_coreutil("join", &args(&["/work/in.txt"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(join_missing.exit_code, 1);
        assert_eq!(join_missing.stderr, "join: EINVAL: join requires exactly two files\n");

        let join_order = try_run_coreutil(
            "join",
            &args(&["--check-order", "/work/in.txt", "/work/in.txt"]),
            "",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(join_order.exit_code, 1);
        assert_eq!(join_order.stderr, "join: EINVAL: file 1 is not in sorted order\n");

        let tsort_dir = try_run_coreutil("tsort", &args(&["/work/dir"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(tsort_dir.exit_code, 0);
        assert_eq!(tsort_dir.stdout, "");

        let sponge_dir = try_run_coreutil("sponge", &args(&["/work/dir"]), "hi\n", "/work", &env, &vfs).unwrap();
        assert_eq!(sponge_dir.exit_code, 1);
        assert_eq!(
            sponge_dir.stderr,
            "sponge: EISDIR: illegal operation on a directory, writeFile '/work/dir'\n"
        );

        let sort_incompat = try_run_coreutil("sort", &args(&["-n", "-h", "/work/in.txt"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(sort_incompat.exit_code, 2);
        assert_eq!(sort_incompat.stderr, "sort: options '-hn' are incompatible\n");

        let uniq_bad = try_run_coreutil("uniq", &args(&["-f", "abc", "/work/in.txt"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(uniq_bad.exit_code, 2);
        assert_eq!(uniq_bad.stderr, "uniq: invalid number 'abc'\n");

        let rev_dash = try_run_coreutil("rev", &args(&["-", "/work/in.txt"]), "x\n", "/work", &env, &vfs).unwrap();
        assert_eq!(rev_dash.exit_code, 1);
        assert_eq!(rev_dash.stdout, "b\na\n");
        assert_eq!(rev_dash.stderr, "rev: ENOENT: no such file or directory, stat '/work/-'\n");
    }

    #[test]
    fn numfmt_factor_truncate_csplit_split_expr_date_and_sysinfo_match_typescript() {
        use crate::vfs::{MemoryVfs, SafeBashFs};

        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work/dir").unwrap();
        let env: BTreeMap<String, String> = BTreeMap::new();
        let args = |items: &[&str]| -> Vec<String> { items.iter().map(|s| s.to_string()).collect() };

        let numfmt_to = try_run_coreutil("numfmt", &args(&["--to=auto", "1000"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(numfmt_to.exit_code, 1);
        assert!(numfmt_to.stderr.starts_with("numfmt: invalid argument 'auto' for '--to'\n"));

        let numfmt_field = try_run_coreutil("numfmt", &args(&["--field=0", "1000"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(numfmt_field.exit_code, 1);
        assert_eq!(
            numfmt_field.stderr,
            "numfmt: fields are numbered from 1\nTry 'numfmt --help' for more information.\n"
        );

        let factor_opt = try_run_coreutil("factor", &args(&["-1"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(factor_opt.exit_code, 1);
        assert_eq!(
            factor_opt.stderr,
            "factor: invalid option -- '1'\nTry 'factor --help' for more information.\n"
        );

        let trunc_ref = try_run_coreutil("truncate", &args(&["-r", "/nope", "/work/out"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(trunc_ref.exit_code, 1);
        assert_eq!(
            trunc_ref.stderr,
            "truncate: cannot stat '/nope': No such file or directory\n"
        );

        let csplit_one = try_run_coreutil("csplit", &args(&["/nope"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(csplit_one.exit_code, 1);
        assert_eq!(
            csplit_one.stderr,
            "csplit: missing operand after '/nope'\nTry 'csplit --help' for more information.\n"
        );

        let split_dir = try_run_coreutil("split", &args(&["/work/dir"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(split_dir.exit_code, 1);
        assert_eq!(
            split_dir.stderr,
            "split: illegal operation on a directory '/work/dir'\n"
        );

        let expr_missing = try_run_coreutil("expr", &args(&["1", "+"]), "", "/work", &env, &vfs).unwrap();
        assert_eq!(expr_missing.exit_code, 2);
        assert_eq!(expr_missing.stderr, "expr: syntax error: missing argument after '+'\n");

        let date_batch = try_run_coreutil(
            "date",
            &args(&["-u", "-f", "-", "+%F"]),
            "@0\ninvalid\n@86400\n",
            "/work",
            &env,
            &vfs,
        )
        .unwrap();
        assert_eq!(date_batch.exit_code, 1);
        assert_eq!(date_batch.stdout, "1970-01-01\n1970-01-02\n");
        assert_eq!(date_batch.stderr, "date: unsupported or invalid date: invalid\n");
    }
}
