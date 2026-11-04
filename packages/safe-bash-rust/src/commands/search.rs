mod expr_bre;
mod fd_glob;
mod grep_stream;
mod rg_stream;
mod rg_types;
use fd_glob::{FdGlob, IgnoreFile, RuleError};
mod mdq_classes;
mod mdq_class;
pub(super) use expr_bre::expr_match;
use super::{ChildIo, ChildRun, CommandInput, CommandWriter};
use crate::shell::builtins::BuiltinOutcome;
use crate::shell::expand::glob_match;
use crate::vfs::{
    SafeBashFs, VfsEntryKind, basename_posix_path, bytes_to_stream_string, resolve_posix_path, stream_byte_len, stream_string_to_bytes,
};
use std::collections::BTreeMap;

pub fn try_run_search_command<F>(
    cmd: &str,
    args: &[String],
    stdin: &str,
    cwd: &mut String,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
    mut exec_sub: F,
) -> Option<BuiltinOutcome>
where
    F: FnMut(&[String], &str, &mut String, &mut BTreeMap<String, String>) -> BuiltinOutcome,
{
    try_run_search_command_with_input(cmd, args, CommandInput { text: &mut stdin.to_owned(), file: None }, cwd, env, fs, &mut super::capture_write,
        |words, input, cwd, env, io| Ok(io.captured(exec_sub(words, input, cwd, env))))
}

#[allow(clippy::too_many_arguments)]
pub(super) fn try_run_search_command_with_input<F>(
    cmd: &str,
    args: &[String],
    input: CommandInput,
    cwd: &mut String,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
    write: &mut CommandWriter<'_>,
    mut exec_sub: F,
) -> Option<BuiltinOutcome>
where
    F: FnMut(&[String], &mut String, &mut String, &mut BTreeMap<String, String>, ChildIo) -> ChildRun,
{
    let stdin = &mut *input.text;
    match cmd {
        "grep" | "egrep" | "fgrep" | "rgrep" => Some(cmd_grep(
            cmd,
            args,
            input,
            cwd,
            !cfg!(target_arch = "wasm32") || env.contains_key("\0has_finite_input_quota"),
            fs,
            write,
        )),
        "rg" => Some(cmd_rg(args, input, cwd, env, fs, write)),
        "find" => Some(cmd_find(args, cwd, env, fs, write, &mut |words, cwd, env| exec_sub(words, stdin, cwd, env, ChildIo::Inherit { stderr_before: "" }))),
        "fd" => Some(cmd_fd(args, cwd, fs, write, &mut |words, cwd| {
            exec_sub(words, &mut String::new(), cwd, env, ChildIo::Inherit { stderr_before: "" })
        })),
        "xargs" => Some(cmd_xargs(args, input, cwd, env, fs, &mut exec_sub)),
        "which" => Some(cmd_which(args, cwd, env, fs)),
        _ => None,
    }
}

fn ok_out(stdout: &str) -> BuiltinOutcome {
    BuiltinOutcome {
        stdout: stdout.to_string(),
        stderr: String::new(),
        exit_code: 0,
    }
}

fn cmd_which(
    args: &[String],
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    const USAGE: &str = "usage: which [-as] program ...\n";
    let mut show_all = false;
    let mut silent = false;
    let mut names = Vec::new();
    let mut parse_opts = true;
    for a in args {
        if parse_opts && a == "--" {
            parse_opts = false;
            continue;
        }
        if parse_opts && a.starts_with('-') && a.len() > 1 {
            let flags = &a[1..];
            for ch in flags.chars() {
                if ch == 'a' {
                    show_all = true;
                } else if ch == 's' {
                    silent = true;
                } else {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("which: illegal option -- {ch}\n{USAGE}"),
                        exit_code: 1,
                    };
                }
            }
        } else {
            parse_opts = false;
            names.push(a.clone());
        }
    }
    if names.is_empty() {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: USAGE.to_string(),
            exit_code: 1,
        };
    }
    let path_str = if let Some(p) = env.get("PATH").cloned() {
        p
    } else if env.get("\0path_unset__").map(|v| v == "1").unwrap_or(false) {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 1,
        };
    } else {
        "/bin:/usr/bin".to_string()
    };
    let path_dirs: Vec<&str> = path_str.split(':').collect();

    let mut out = String::new();
    let mut code = 0;
    for name in &names {
        if name.is_empty() {
            code = 1;
            continue;
        }
        let mut found = Vec::new();
        if name.contains('/') {
            if !(name.ends_with('/') || name.ends_with("/.") || name.ends_with("/..")) {
                let full = resolve_posix_path(cwd, name);
                if is_which_executable(fs, &full) {
                    found.push(name.clone());
                }
            }
        } else {
            for dir in &path_dirs {
                let search_dir = if dir.is_empty() { "." } else { *dir };
                let candidate = format!("{search_dir}/{name}");
                if candidate.ends_with('/') || candidate.ends_with("/.") || candidate.ends_with("/..") {
                    continue;
                }
                let lookup = resolve_posix_path(cwd, &candidate);
                if is_which_executable(fs, &lookup) {
                    found.push(candidate);
                    if !show_all {
                        break;
                    }
                }
            }
        }
        if found.is_empty() {
            code = 1;
        } else if !silent {
            for f in found {
                out.push_str(&f);
                out.push('\n');
            }
        }
    }
    BuiltinOutcome {
        stdout: out,
        stderr: String::new(),
        exit_code: code,
    }
}

fn is_which_executable(fs: &dyn SafeBashFs, full_path: &str) -> bool {
    if let Ok(st) = fs.stat(full_path) {
        return st.kind == VfsEntryKind::File && (st.mode & 0o111) != 0;
    }
    is_virtual_executable(full_path)
}

fn is_virtual_executable(full_path: &str) -> bool {
    if matches!(full_path, "/tmp/sh" | "/tmp/bash" | "/tmp/zsh") {
        return true;
    }
    for prefix in ["/usr/bin/", "/bin/"] {
        if let Some(cmd) = full_path.strip_prefix(prefix)
            && !cmd.is_empty()
            && !cmd.contains('/')
            && is_external_command(cmd)
        {
            return true;
        }
    }
    false
}

pub(crate) fn is_external_command(name: &str) -> bool {
    is_known_command(name) && !is_pure_shell_builtin(name)
}

fn is_pure_shell_builtin(name: &str) -> bool {
    matches!(
        name,
        ":" | "."
            | "source"
            | "cd"
            | "export"
            | "unset"
            | "set"
            | "shift"
            | "local"
            | "declare"
            | "typeset"
            | "readonly"
            | "return"
            | "exit"
            | "break"
            | "continue"
            | "eval"
            | "exec"
            | "type"
            | "command"
            | "builtin"
            | "let"
            | "trap"
            | "getopts"
            | "alias"
            | "unalias"
            | "hash"
            | "umask"
            | "wait"
            | "jobs"
            | "disown"
            | "caller"
            | "read"
            | "[["
            | "shopt"
    )
}

pub fn is_known_command(name: &str) -> bool {
    #[cfg(not(target_arch = "wasm32"))]
    if matches!(name, "python" | "python3") {
        return std::env::var("SAFE_BASH_PYODIDE_MODULE_URL")
            .is_ok_and(|value| !value.is_empty());
    }
    matches!(
        name,
        ":" | "true"
            | "false"
            | "pwd"
            | "cd"
            | "echo"
            | "printf"
            | "export"
            | "unset"
            | "test"
            | "["
            | "[["
            | "read"
            | "set"
            | "shift"
            | "local"
            | "declare"
            | "typeset"
            | "readonly"
            | "return"
            | "exit"
            | "break"
            | "continue"
            | "eval"
            | "source"
            | "."
            | "type"
            | "command"
            | "builtin"
            | "let"
            | "trap"
            | "getopts"
            | "alias"
            | "unalias"
            | "hash"
            | "umask"
            | "wait"
            | "jobs"
            | "cat"
            | "head"
            | "tail"
            | "wc"
            | "sort"
            | "uniq"
            | "cut"
            | "tr"
            | "nl"
            | "tac"
            | "rev"
            | "paste"
            | "comm"
            | "tsort"
            | "truncate"
            | "expand"
            | "unexpand"
            | "tee"
            | "sponge"
            | "seq"
            | "yes"
            | "basename"
            | "dirname"
            | "env"
            | "printenv"
            | "envsubst"
            | "expr"
            | "bc"
            | "numfmt"
            | "uname"
            | "whoami"
            | "hostname"
            | "nproc"
            | "id"
            | "sleep"
            | "factor"
            | "fold"
            | "fmt"
            | "column"
            | "shuf"
            | "split"
            | "ls"
            | "mkdir"
            | "rmdir"
            | "rm"
            | "cp"
            | "mv"
            | "touch"
            | "ln"
            | "readlink"
            | "realpath"
            | "chmod"
            | "stat"
            | "du"
            | "df"
            | "mktemp"
            | "tree"
            | "file"
            | "grep"
            | "egrep"
            | "fgrep"
            | "rgrep"
            | "wdiff"
            | "openssl"
            | "gpg"
            | "mdq"
            | "rg"
            | "find"
            | "fd"
            | "xargs"
            | "which"
            | "sed"
            | "awk"
            | "diff"
            | "patch"
            | "apply_patch"
            | "apply-patch"
            | "cmp"
            | "jq"
            | "yq"
            | "join"
            | "getopt"
            | "dos2unix"
            | "unix2dos"
            | "timeout"
            | "disown"
            | "kill"
            | "csvcut"
            | "csvgrep"
            | "csvstat"
            | "csvsort"
            | "csvstack"
            | "csvjoin"
            | "csvjson"
            | "in2csv"
            | "csvformat"
            | "csvlook"
            | "csvsql"
            | "sql2csv"
            | "csvclean"
            | "xq"
            | "xan"
            | "xmllint"
            | "htmlq"
            | "unrtf"
            | "pandoc"
            | "ssconvert"
            | "ast-grep"
            | "sg"
            | "caller"
            | "sqlite3"
            | "tar"
            | "gzip"
            | "gunzip"
            | "zcat"
            | "bzip2"
            | "bunzip2"
            | "bzcat"
            | "xz"
            | "unxz"
            | "xzcat"
            | "lzma"
            | "unlzma"
            | "lzcat"
            | "zstd"
            | "unzstd"
            | "zstdcat"
            | "zip"
            | "unzip"
            | "sha256sum"
            | "sha224sum"
            | "sha384sum"
            | "sha512sum"
            | "sha1sum"
            | "md5sum"
            | "cksum"
            | "base64"
            | "base32"
            | "xxd"
            | "strings"
            | "od"
            | "hexdump"
            | "hd"
            | "iconv"
            | "csplit"
            | "pr"
            | "date"
            | "cal"
            | "getconf"
            | "locale"
            | "less"
            | "more"
            | "pathchk"
            | "dd"
            | "install"
            | "gawk"
            | "mawk"
            | "diff3"
            | "html-to-markdown"
            | "mmdc"
            | "sha256"
            | "sha224"
            | "sha384"
            | "sha512"
            | "sha1"
            | "md5"
            | "b2sum"
            | "blake2b"
            | "ffmpeg"
            | "ffprobe"
            | "soffice"
            | "libreoffice"
            | "wkhtmltopdf"
            | "pdfunite"
            | "pdfseparate"
            | "qpdf"
            | "pdftk"
            | "pdfinfo"
            | "pdffonts"
            | "pdfdetach"
            | "pdftotext"
            | "pdftohtml"
            | "pdftoppm"
            | "pdftocairo"
            | "pdfimages"
            | "diffpdf"
            | "pdfdiff"
            | "svgo"
            | "rsvg-convert"
            | "sox"
            | "soxi"
            | "qrencode"
            | "ssh"
            | "ssh-keygen"
            | "magick"
            | "convert"
            | "mogrify"
            | "composite"
            | "montage"
            | "compare"
            | "sips"
            | "exiftool"
            | "identify"
            | "csvpy"
            | "dot"
            | "gh"
            | "ncal"
            | "neato"
            | "op"
            | "tomlq"
    )
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RxSearch { Longest, Expr, BytewiseLongest, First, Mdq { continuation: usize, trailing_start: usize }, Rg { empty_pattern: bool, binary_text: bool, word_assertions: bool } }

#[derive(Clone)]
pub struct ZeroRegex {
    literal: Option<String>,
    branches: Vec<RxProgram>,
    pub(super) capture_names: Vec<(String, usize)>,
    ignore_case: bool,
    word_regexp: bool,
    anchored: bool,
    search: RxSearch,
}

impl ZeroRegex {
    pub fn new(
        patterns: Vec<String>,
        ignore_case: bool,
        fixed_strings: bool,
        word_regexp: bool,
        line_regexp: bool,
    ) -> Self {
        Self::from_branches(patterns.iter().map(|p| parse_rx_branches(p, fixed_strings, RxDialect::Auto).expect("permissive regex parser")), ignore_case, word_regexp, line_regexp)
    }

    pub(super) fn extended(pattern: &str, ignore_case: bool) -> Result<Self, String> {
        let branches = parse_rx_branches(pattern, false, RxDialect::SedExtended { ignore_case })
            .map_err(|err| err.message)?;
        Ok(Self::from_branches([branches], false, false, false))
    }

    pub(super) fn mdq(pattern: &str) -> Result<Self, RxParseError> {
        let branches = parse_rx_branches(pattern, false, RxDialect::Mdq)?;
        let mut rx = Self::from_branches([branches], false, false, false);
        rx.search = RxSearch::Mdq { continuation: 0, trailing_start: 0 };
        Ok(rx)
    }

    pub(super) fn awk(pattern: &str) -> Self {
        let branches = parse_rx_branches(pattern, false, RxDialect::Awk).expect("permissive awk regex parser");
        Self::from_branches([branches], false, false, false)
    }

    pub(super) fn jq(pattern: &str, flags: &str, filter: &str) -> Result<Self, String> {
        let pattern = preprocess_ere_pattern(pattern, flags.contains('x'));
        let branches = parse_rx_branches(&pattern, false, RxDialect::Jq(flags)).map_err(|err| {
            let message = match err.message.as_str() {
                "unterminated bracket expression" => "premature end of char-class",
                "unmatched '(' in regular expression" => "end pattern with unmatched parenthesis",
                "quantifier without an expression" if filter != "capture" => "target of repeat operator is not specified",
                "reversed character range" if filter != "capture" => "empty range in char class",
                other => other,
            };
            format!("Regex failure: {message}")
        })?;
        let mut rx = Self::from_branches([branches], false, false, false);
        rx.search = RxSearch::First;
        rx.branches[0].nonempty = flags.contains('n');
        Ok(rx)
    }

    fn from_branches(patterns: impl IntoIterator<Item = ParsedRegex>, ignore_case: bool, word_regexp: bool, line_regexp: bool) -> Self {
        let mut branches = Vec::new();
        let mut anchored = true;
        let mut capture_names = Vec::new();
        let mut group_offset = 0;
        for alternatives in patterns {
            anchored &= line_regexp || alternatives.root.iter().all(|seq| matches!(seq.first().map(|t| &t.atom), Some(RxAtom::Begin)));
            let mut program = RxProgram::new(alternatives);
            if line_regexp { program.ops.push(RxOp::Atom(RxToken { atom: RxAtom::End, case: RxCase::Sensitive, min: 1, max: Some(1), lazy: false })); }
            for (name, slot) in std::mem::take(&mut program.names) { capture_names.push((name, group_offset + slot)); }
            group_offset += program.groups;
            branches.push(program);
        }
        let literal = match branches.as_slice() {
            [program] if !ignore_case && !word_regexp && !anchored && !program.ops.is_empty() =>
                program.ops.iter().map(|op| match op {
                    RxOp::Atom(RxToken { atom: RxAtom::Char(c), case: RxCase::Sensitive, min: 1, max: Some(1), .. }) => Some(*c),
                    _ => None,
                }).collect(),
            _ => None,
        };
        Self { literal, branches, capture_names, ignore_case,
            word_regexp, anchored, search: RxSearch::Longest }
    }

    pub(super) fn replace_count(&self, text: &str, replacement: &str, global: bool, nth: Option<usize>) -> (String, usize) {
        let mut out = String::new();
        let mut last_end = 0;
        let mut occurrence = 0;
        let mut replace_count = 0;
        self.scan(text.as_bytes(), replacement.contains('\\'), |s, e, caps| {
            if s == e && s == last_end && occurrence != 0 { return true; }
            occurrence += 1;
            let matched = &text[s..e];
            out.push_str(&text[last_end..s]);
            last_end = e;
            if occurrence < nth.unwrap_or(1) {
                out.push_str(matched);
                return true;
            }
            out.push_str(&expand_regex_replacement(replacement, matched, text, caps));
            replace_count += 1;
            global
        });
        out.push_str(&text[last_end..]);
        (out, replace_count)
    }

    pub fn is_match(&self, text: &str) -> bool {
        self.scan(text.as_bytes(), false, |_, _, _| false)
    }

    pub fn find_all(&self, text: &str) -> Vec<(usize, usize)> {
        let mut results = Vec::new();
        self.scan(text.as_bytes(), false, |start, end, _| {
            results.push((start, end));
            true
        });
        results
    }

    pub(super) fn scan(&self, text: &[u8], capture: bool, mut visit: impl FnMut(usize, usize, &[Option<(usize, usize)>]) -> bool) -> bool {
        if let Some(literal) = &self.literal && let Ok(subject) = std::str::from_utf8(text) {
            let mut found = false;
            for (start, value) in subject.match_indices(literal.as_str()) {
                found = true;
                if !visit(start, start + value.len(), &[]) { break; }
            }
            return found;
        }
        let mut hay = Vec::with_capacity(text.len());
        let mut invalid = Vec::new();
        if self.search == RxSearch::BytewiseLongest {
            hay.extend(text.iter().enumerate().map(|(i, &byte)| (i, char::from(byte))));
        } else {
            let mut offset = 0;
            for chunk in text.utf8_chunks() {
                hay.extend(chunk.valid().char_indices().map(|(i, c)| (offset + i, c)));
                offset += chunk.valid().len();
                for _ in chunk.invalid() {
                    if !matches!(self.search, RxSearch::Rg { binary_text: true, .. }) { invalid.push(hay.len()); }
                    hay.push((offset, char::REPLACEMENT_CHARACTER));
                    offset += 1;
                }
            }
        }
        let mut invalid = invalid.into_iter().peekable();
        let byte_at = |i| hay.get(i).map_or(text.len(), |&(byte, _)| byte);
        let mut found = false;
        let mut pos = 0;
        let mut search = self.search;
        if let RxSearch::Mdq { trailing_start, .. } = &mut search {
            *trailing_start = hay.iter().rposition(|&(_, c)| c != '\n').map_or(0, |last| last + 1);
        }
        let last_start = if self.anchored { 0 } else { hay.len() };
        let first = !matches!(self.search, RxSearch::Longest | RxSearch::BytewiseLongest);
        let rg = matches!(self.search, RxSearch::Rg { .. });
        let mut interior_empty = None;
        while pos <= last_start {
            // Keep anchors relative to the original subject, but do not consume across an invalid byte.
            while invalid.next_if(|i| *i < pos).is_some() {}
            let bound = invalid.peek().copied().unwrap_or(hay.len());
            let mut group_offset = 0;
            let mut matches = self.branches.iter().filter_map(|program| {
                let base = group_offset;
                group_offset += program.groups;
                program.run(&hay, pos..=bound, self.ignore_case, search, capture, |end|
                    !self.word_regexp || is_word_boundary(&hay, pos, end) && (!matches!(self.search, RxSearch::Rg { word_assertions: true, .. })
                        || pos < end && is_word_char(hay[pos].1) && is_word_char(hay[end - 1].1))).map(|m| (base, m))
            });
            if let Some((base, mut m)) = if first { matches.next() } else { matches.max_by_key(|(_, m)| m.pos) } {
                found = true;
                if capture {
                    if base > 0 { m.caps.splice(0..0, std::iter::repeat_n(None, base)); }
                    for (lo, hi) in m.caps.iter_mut().flatten() { *lo = byte_at(*lo); *hi = byte_at(*hi); }
                }
                if !visit(byte_at(m.start), byte_at(m.pos), &m.caps) { break; }
                if let RxSearch::Mdq { continuation, .. } = &mut search {
                    *continuation = m.pos;
                    if m.pos <= m.start {
                        pos = m.pos + 1;
                        continue;
                    }
                }
                if m.pos > pos { pos = m.pos; continue; }
            }
            if rg && !self.word_regexp && let Some(&(start, ch)) = hay.get(pos) && byte_at(pos + 1) > start + 1 {
                // Inside a scalar neither neighbor is a newline or ASCII word character.
                // No consuming atom can start there. Evaluate that zero-width path once.
                if *interior_empty.get_or_insert_with(|| {
                    let neighbors = [(0, ch), (1, ch)];
                    self.branches.iter().any(|p| p.run(&neighbors, 1..=1, false, self.search, false, |end| end == 1).is_some())
                }) {
                    for byte in start + 1..byte_at(pos + 1) {
                        found = true;
                        // Every participating capture is empty at this byte.
                        if !visit(byte, byte, &[]) { return true; }
                    }
                }
            }
            pos += 1;
        }
        found
    }
}

fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

fn is_word_boundary(hay: &[(usize, char)], start: usize, end: usize) -> bool {
    let before_ok = if start == 0 {
        true
    } else {
        !is_word_char(hay[start - 1].1)
    };
    let after_ok = if end >= hay.len() {
        true
    } else {
        !is_word_char(hay[end].1)
    };
    before_ok && after_ok
}

#[derive(Debug, Clone)]
enum RxAtom {
    Any { newline: bool, nul: bool },
    Char(char),
    Digit(bool),
    Word(bool),
    Space(bool),
    Class { negate: bool, chars: Vec<(char, char)> },
    Group { index: usize, width: Option<usize>, nullable: bool, kind: RxGroup },
    Backref(usize),
    CaptureSet(usize),
    Begin,
    LineBegin,
    End,
    NewlineEnd { multiline: bool },
    WordBoundary(bool),
    MdqBoundary(char),
    MdqPosition(char),
    MdqClass(std::borrow::Cow<'static, [u32]>, bool),
    WordStart,
    WordEnd,
}

#[derive(Debug, Clone)]
enum RxGroup {
    Conditional,
    ConditionTest,
    Atomic,
    Capture(Option<String>),
    Plain,
    Assertion { behind: bool, positive: bool },
}

fn check_boundary_atom(atom: &RxAtom, hay: &[(usize, char)], pos: usize) -> Option<bool> {
    let before_word = pos > 0 && is_word_char(hay[pos - 1].1);
    let after_word = pos < hay.len() && is_word_char(hay[pos].1);
    match atom {
        RxAtom::MdqBoundary(kind) => {
            let word = |&(_, c): &(usize, char)| mdq_classes::WORD.partition_point(|&edge| edge <= c as u32) % 2 == 1;
            let before = pos.checked_sub(1).and_then(|i| hay.get(i)).is_some_and(word);
            let after = hay.get(pos).is_some_and(word);
            Some(match kind { 'b' => before != after, 'B' => before == after, '<' => !before && after, _ => before && !after })
        }
        RxAtom::Begin => Some(pos == 0),
        RxAtom::LineBegin => Some(pos == 0 || hay[pos - 1].1 == '\n'),
        RxAtom::End => Some(pos == hay.len()),
        RxAtom::NewlineEnd { multiline } => Some(pos == hay.len() || ((*multiline || pos + 1 == hay.len()) && hay[pos].1 == '\n')),
        RxAtom::WordBoundary(negate) => Some((before_word != after_word) ^ negate),
        RxAtom::WordStart => Some(!before_word && after_word),
        RxAtom::WordEnd => Some(before_word && !after_word),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RxCase { Sensitive, Ascii, Unicode, Mdq }

#[derive(Debug, Clone)]
struct RxToken {
    atom: RxAtom,
    case: RxCase,
    min: usize,
    max: Option<usize>,
    lazy: bool,
}

fn has_unescaped_ere_syntax(pat: &str) -> bool {
    let mut in_bracket = false;
    let mut chars = pat.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            let _ = chars.next();
            continue;
        }
        if c == '[' && !in_bracket {
            in_bracket = true;
            continue;
        }
        if c == ']' && in_bracket {
            in_bracket = false;
            continue;
        }
        if !in_bracket && matches!(c, '(' | ')' | '+' | '?' | '|') {
            return true;
        }
    }
    false
}

fn normalize_bre_escapes(pat: &str) -> String {
    if has_unescaped_ere_syntax(pat) || pat.contains("\\(\\)") {
        return pat.to_string();
    }
    if !pat.contains("\\(")
        && !pat.contains("\\)")
        && !pat.contains("\\+")
        && !pat.contains("\\|")
        && !pat.contains("\\?")
        && !pat.contains("\\{")
        && !pat.contains("\\}")
    {
        return pat.to_string();
    }
    let mut out = String::new();
    let mut chars = pat.chars().peekable();
    let mut in_bre_interval = false;
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(&nc) = chars.peek() {
                if matches!(nc, '(' | ')' | '+' | '?' | '|') {
                    out.push(chars.next().unwrap());
                    continue;
                }
                if nc == '{' {
                    let mut clone = chars.clone();
                    let _ = clone.next();
                    if clone.peek().is_some_and(|d| d.is_ascii_digit()) {
                        in_bre_interval = true;
                        out.push(chars.next().unwrap());
                        continue;
                    }
                } else if nc == '}' && in_bre_interval {
                    in_bre_interval = false;
                    out.push(chars.next().unwrap());
                    continue;
                }
                out.push(c);
                out.push(chars.next().unwrap());
                continue;
            }
        }
        out.push(c);
    }
    out
}

fn preprocess_ere_pattern(pat: &str, extended_whitespace: bool) -> String {
    let chs: Vec<char> = pat.chars().collect();
    let mut out = String::with_capacity(pat.len() + 8);
    let mut k = 0usize;
    let mut in_bracket = false;
    while k < chs.len() {
        if chs[k] == '\\' && k + 1 < chs.len() {
            let nc = chs[k + 1];
            if !in_bracket && matches!(nc, '(' | ')' | '+' | '?' | '{' | '}' | '|') {
                out.push('[');
                out.push(nc);
                out.push(']');
            } else {
                out.push('\\');
                out.push(nc);
            }
            k += 2;
        } else if !in_bracket && extended_whitespace && chs[k] == '#' {
            while k < chs.len() && chs[k] != '\n' { k += 1; }
        } else if !in_bracket && extended_whitespace && (chs[k].is_ascii_whitespace() || chs[k] == '\x0b') {
            k += 1;
        } else if chs[k] == '[' && !in_bracket {
            in_bracket = true;
            out.push('[');
            k += 1;
        } else if chs[k] == ']' && in_bracket {
            in_bracket = false;
            out.push(']');
            k += 1;
        } else {
            out.push(chs[k]);
            k += 1;
        }
    }
    out
}

fn has_unsupported_regex_features(pat: &str) -> bool {
    let chs: Vec<char> = pat.chars().collect();
    let mut k = 0usize;
    let mut in_bracket = false;
    while k < chs.len() {
        if chs[k] == '\\' && k + 1 < chs.len() {
            let nc = chs[k + 1];
            if !in_bracket && nc.is_ascii_digit() && nc != '0' {
                return true;
            }
            k += 2;
            continue;
        }
        if chs[k] == '[' && !in_bracket {
            in_bracket = true;
            k += 1;
            continue;
        }
        if chs[k] == ']' && in_bracket {
            in_bracket = false;
            k += 1;
            continue;
        }
        if !in_bracket && chs[k] == '(' && k + 2 < chs.len() && chs[k + 1] == '?' {
            let third = chs[k + 2];
            if third == '=' || third == '!' {
                return true;
            }
            if third == '<' && k + 3 < chs.len() && (chs[k + 3] == '=' || chs[k + 3] == '!') {
                return true;
            }
        }
        k += 1;
    }
    false
}

pub(super) fn posix_class_ranges(name: &str) -> Option<&'static [(char, char)]> {
    Some(match name {
        "digit" => &[('0', '9')],
        "lower" => &[('a', 'z')],
        "upper" => &[('A', 'Z')],
        "alpha" => &[('A', 'Z'), ('a', 'z')],
        "alnum" => &[('0', '9'), ('A', 'Z'), ('a', 'z')],
        "xdigit" => &[('0', '9'), ('A', 'F'), ('a', 'f')],
        "space" => &[('\t', '\r'), (' ', ' ')],
        "blank" => &[('\t', '\t'), (' ', ' ')],
        "cntrl" => &[('\0', '\x1f'), ('\x7f', '\x7f')],
        "graph" => &[('!', '~')],
        "print" => &[(' ', '~')],
        "punct" => &[('!', '/'), (':', '@'), ('[', '`'), ('{', '~')],
        _ => return None,
    })
}

fn bracket_shorthand(chars: &[char]) -> Option<&'static [(char, char)]> {
    let ['\\', c, ..] = chars else { return None };
    Some(match c {
        'd' => &[('0', '9')],
        'D' => &[('\0', '/'), (':', char::MAX)],
        'w' => &[('0', '9'), ('A', 'Z'), ('_', '_'), ('a', 'z')],
        'W' => &[('\0', '/'), (':', '@'), ('[', '^'), ('`', '`'), ('{', char::MAX)],
        's' => &[('\t', '\r'), (' ', ' ')],
        'S' => &[('\0', '\x08'), ('\x0e', '\x1f'), ('!', char::MAX)],
        _ => return None,
    })
}

type RxBranches = Vec<Vec<RxToken>>;

struct ParsedRegex {
    bounded_error: Option<(usize, &'static str)>,
    cross_line: bool,
    requires_vm: bool,
    root: RxBranches,
    groups: Vec<RxBranches>,
}

impl ParsedRegex {
    fn close_group(&mut self, branches: RxBranches, kind: RxGroup) -> RxAtom {
        let index = self.groups.len();
        let width = if matches!(kind, RxGroup::Conditional) { None } else { rx_fixed_width(&branches) };
        let nullable = branches.iter().any(|seq| seq.iter().all(|tok| tok.min == 0 || matches!(tok.atom,
            RxAtom::Begin | RxAtom::End | RxAtom::LineBegin | RxAtom::NewlineEnd { .. } | RxAtom::MdqBoundary(_) | RxAtom::MdqPosition(_) | RxAtom::CaptureSet(_) | RxAtom::WordBoundary(_)
            | RxAtom::WordStart | RxAtom::WordEnd | RxAtom::Group { nullable: true, .. })));
        self.groups.push(branches);
        RxAtom::Group { index, width, nullable, kind }
    }
}

#[derive(Clone, Copy, Default)]
struct RxFlags {
    icase: bool,
    multiline: bool,
    dotall: bool,
    extended: bool,
    ungreedy: bool,
}

enum RxDialect<'a> { Auto, SedExtended { ignore_case: bool }, Awk, Mdq, Rg { flags: RxFlags, dot_nul: bool }, Jq(&'a str) }

#[derive(Debug)]
pub(super) struct RxParseError {
    pub message: String,
    pub offset: Option<usize>,
}

impl<T: Into<String>> From<T> for RxParseError {
    fn from(message: T) -> Self { Self { message: message.into(), offset: None } }
}

impl RxParseError {
    fn at(offset: usize, message: &str) -> Self { Self { message: message.into(), offset: Some(offset) } }
}

fn mdq_escaped(c: char, chars: &[char], at: &mut usize) -> Result<char, RxParseError> {
    Ok(match c {
        'a' => '\x07', 'b' => '\x08', 'e' => '\x1b', 'f' => '\x0c',
        'n' => '\n', 'r' => '\r', 't' => '\t', 'v' => '\x0b',
        'x' | 'u' | 'U' => {
            let offset = *at;
            let braced = chars.get(*at) == Some(&'{');
            if braced { *at += 1; }
            let start = *at;
            let width = match c { 'x' => 2, 'u' => 4, _ => 8 };
            let mut value = 0u32;
            while let Some(digit) = chars.get(*at).and_then(|c| c.to_digit(16)) {
                if !braced && *at - start == width { break; }
                value = value.saturating_mul(16).saturating_add(digit);
                *at += 1;
            }
            if *at == start || if braced { chars.get(*at) != Some(&'}') } else { *at - start != width } {
                return Err(RxParseError::at(offset, "Invalid hex escape"));
            }
            if braced { *at += 1; }
            char::from_u32(value).ok_or_else(|| RxParseError::at(offset, "Invalid hex escape"))?
        }
        _ if c.is_ascii_alphabetic() => return Err(RxParseError::at(*at - 2, &format!("Invalid escape: \\{c}"))),
        _ => c,
    })
}

fn parse_rx_branches(pat: &str, fixed: bool, dialect: RxDialect<'_>) -> Result<ParsedRegex, RxParseError> {
    let jq = matches!(dialect, RxDialect::Jq(_));
    let sed = matches!(dialect, RxDialect::SedExtended { .. });
    let strict_ere = sed || jq;
    let mdq = matches!(dialect, RxDialect::Mdq);
    let assertions = jq || mdq;
    let rg = matches!(dialect, RxDialect::Rg { .. });
    let mut mode = match dialect {
        RxDialect::SedExtended { ignore_case } => RxFlags { icase: ignore_case, dotall: true, ..Default::default() },
        RxDialect::Rg { flags, .. } => flags,
        RxDialect::Jq(f) => RxFlags { icase: f.contains('i'), multiline: false, dotall: f.contains(['m', 'p']), ..Default::default() },
        _ => RxFlags::default(),
    };
    let allow_newline = !rg || mode.multiline;
    if !allow_newline && pat.contains('\n') {
        return Err(if fixed { "literal newline in pattern requires --multiline (-U)" } else { "unsupported ERE literal newline without --multiline (-U)" }.into());
    }
    if fixed {
        return Ok(ParsedRegex { bounded_error: None, cross_line: pat.contains('\n'), requires_vm: false, root: vec![pat
            .chars()
            .map(|c| RxToken {
                atom: RxAtom::Char(c),
                case: if mode.icase { RxCase::Ascii } else { RxCase::Sensitive },
                min: 1,
                max: Some(1),
                lazy: false,
            })
            .collect()], groups: Vec::new() });
    }
    let mut parsed = ParsedRegex { bounded_error: None, cross_line: mode.dotall || pat.contains('\n'), requires_vm: false, root: Vec::new(), groups: Vec::new() };
    let normalized;
    let source = if matches!(dialect, RxDialect::Auto) {
        normalized = normalize_bre_escapes(pat);
        &normalized
    } else { pat };
    let chars: Vec<char> = source.chars().collect();
    let mut idx = 0usize;
    let mut out = Vec::new();
    let mut alts = Vec::new();
    let mut groups = Vec::new();
    let mut group_count = 0;
    let mut closed = [false; 9];
    let mut rg_names = std::collections::BTreeSet::new();
    let mut mdq_names = std::collections::HashMap::<String, usize>::new();
    let mut numbered_refs = Vec::new();
    let mut numeric_ref = |index: f64| {
        numbered_refs.push(index);
        (index as usize).saturating_sub(1)
    };

    let skip = |at: &mut usize, mode: RxFlags| {
        if mode.extended {
            loop {
                while chars.get(*at).is_some_and(|c| matches!(c, ' ' | '\n' | '\t' | '\r' | '\x0b' | '\x0c')) { *at += 1; }
                if chars.get(*at) != Some(&'#') { break; }
                while chars.get(*at).is_some_and(|c| *c != '\n') { *at += 1; }
            }
        }
    };
    while idx < chars.len() {
        skip(&mut idx, mode);
        if idx == chars.len() { break; }
        let mut atom = match chars[idx] {
            '^' if (mdq || rg || jq) && mode.multiline => { idx += 1; RxAtom::LineBegin }
            '^' if mdq || rg || strict_ere || out.is_empty() => { idx += 1; RxAtom::Begin }
            '$' if (mdq || rg || sed) && !mode.multiline => { idx += 1; RxAtom::End }
            '$' if mdq || rg || jq => { idx += 1; RxAtom::NewlineEnd { multiline: mode.multiline } }
            '$' if matches!(chars.get(idx + 1), None | Some('|') | Some(')')) => { idx += 1; RxAtom::End }
            '.' => {
                idx += 1;
                RxAtom::Any { newline: mode.dotall, nul: !matches!(dialect, RxDialect::Rg { dot_nul: false, .. }) }
            }
            '\\' if idx + 1 < chars.len() => {
                let nc = chars[idx + 1];
                idx += 2;
                if mdq && let Some((edges, invert)) = mdq_class::escape(nc, &chars, &mut idx, mode.icase)? {
                    RxAtom::MdqClass(edges, invert)
                } else { match nc {
                    c @ ('b' | 'B' | '<' | '>') if mdq => RxAtom::MdqBoundary(c),
                    'd' => RxAtom::Digit(false),
                    'D' => RxAtom::Digit(true),
                    'w' => RxAtom::Word(false),
                    'W' => RxAtom::Word(true),
                    's' => RxAtom::Space(false),
                    'S' => RxAtom::Space(true),
                    'b' if matches!(dialect, RxDialect::Awk) => RxAtom::Char('\x08'),
                    'b' => RxAtom::WordBoundary(false),
                    'y' if sed => RxAtom::WordBoundary(false),
                    'B' | 'Y' if sed => RxAtom::WordBoundary(true),
                    'a' if sed => RxAtom::Char('\x07'),
                    'f' if sed => RxAtom::Char('\x0c'),
                    'v' if sed => RxAtom::Char('\x0b'),
                    'B' if rg => RxAtom::WordBoundary(true),
                    '<' => RxAtom::WordStart,
                    '>' => RxAtom::WordEnd,
                    'n' if !allow_newline => return Err("unsupported ERE '\\n' escape without --multiline (-U)".into()),
                    'n' => RxAtom::Char('\n'),
                    't' => RxAtom::Char('\t'),
                    'r' => RxAtom::Char('\r'),
                    'A' if mdq => RxAtom::Begin,
                    'z' if mdq => RxAtom::End,
                    c @ ('Z' | 'G' | 'K') if mdq => RxAtom::MdqPosition(c),
                    '0'..='9' if mdq => {
                        let start = idx - 1;
                        while chars.get(idx).is_some_and(char::is_ascii_digit) { idx += 1; }
                        let index = super::js_number(&chars[start..idx].iter().collect::<String>(), 0.);
                        if nc == '0' && index != 0.0 { return Err(RxParseError::at(start, "Invalid back reference")); }
                        RxAtom::Backref(numeric_ref(index))
                    }
                    'k' | 'g' if mdq => {
                        let error_at = idx;
                        let close = match chars.get(idx) { Some('<') => '>', Some('\'') => '\'',
                            _ => return Err(RxParseError::at(error_at, "Could not parse group name")) };
                        idx += 1;
                        let Some(len) = chars[idx..].iter().position(|&c| c == close) else {
                            return Err(RxParseError::at(error_at, "Could not parse group name"));
                        };
                        if nc == 'g' { return Err("Regex uses currently unimplemented feature: Subroutine Call".into()); }
                        let name = chars[idx..idx+len].iter().collect::<String>();
                        idx += len + 1;
                        let number = super::js_number(&name, 0.0);
                        if !name.is_empty() && number.fract() == 0.0 {
                            RxAtom::Backref(numeric_ref(if name.starts_with('-') { group_count as f64 + number + 1.0 }
                                else if name.starts_with('+') { group_count as f64 + number } else { number }))
                        } else {
                            let slot = mdq_names.get(&name).ok_or_else(|| RxParseError::at(error_at,
                                &format!("Invalid group name in back reference: {name}")))?;
                            RxAtom::Backref(*slot)
                        }
                    }
                    d @ '1'..='9' => {
                        if rg { return Err("unsupported ERE backreference".into()); }
                        let slot = (d as u8 - b'1') as usize;
                        if strict_ere && !closed[slot] { return Err("pattern references an undefined or open capture group".into()); }
                        RxAtom::Backref(slot)
                    }
                    other if mdq => RxAtom::Char(mdq_escaped(other, &chars, &mut idx)?),
                    other => RxAtom::Char(other),
                }}
            }
            '\\' if rg => return Err("invalid ERE: trailing backslash".into()),
            ')' if mdq && groups.is_empty() => return Err(RxParseError::at(idx, "General parsing error: end of string not reached")),
            '*' | '+' | '?' if mdq && (idx == 0 || chars[idx] == '*' || chars[idx - 1] == '|'
                || out.is_empty() && groups.last().is_some_and(|(_, _, kind, _, _)| matches!(kind, RxGroup::ConditionTest))) => return Err(RxParseError::at(idx, "Target of repeat operator is invalid")),
            ')' if rg && groups.is_empty() => return Err("invalid ERE: unmatched ')'".into()),
            c @ ('*' | '+' | '?' | '{') if rg => return Err(format!("invalid ERE: unexpected quantifier '{c}'").into()),
            '\\' if strict_ere => return Err("trailing backslash in regular expression".into()),
            '*' | '+' | '?' | '{' | '}' if strict_ere => return Err("quantifier without an expression".into()),
            ')' if strict_ere && groups.is_empty() => return Err("unmatched ')' in regular expression".into()),
            '[' if mdq => mdq_class::bracket(&chars, &mut idx, mode.icase, |at| skip(at, mode))?,
            '[' => {
                idx += 1;
                let mut negate = false;
                if idx < chars.len() && chars[idx] == '^' {
                    negate = true;
                    idx += 1;
                }
                parsed.cross_line |= negate;
                let mut ranges = Vec::new();
                let scalar = |idx: &mut usize| -> Result<char, RxParseError> {
                    let c = chars[*idx];
                    *idx += 1;
                    if c != '\\' { return Ok(c); }
                    let Some(&esc) = chars.get(*idx) else {
                        if rg { return Err("invalid ERE: trailing backslash in bracket expression".into()); }
                        return if jq { Err("trailing backslash in regular expression".into()) } else { Ok('\\') };
                    };
                    if sed && !matches!(esc, '\\' | 'n' | 't' | 'r' | 'f' | 'v' | 'a') { return Ok('\\'); }
                    *idx += 1;
                    if esc == 'n' && !allow_newline { return Err("unsupported ERE '\\n' escape without --multiline (-U)".into()); }
                    Ok(match esc {
                        'n' => '\n', 'r' => '\r', 't' => '\t',
                        'f' if strict_ere => '\x0c', 'v' if strict_ere => '\x0b', 'a' if strict_ere => '\x07',
                        c => c,
                    })
                };
                let mut first = true;
                while idx < chars.len() && (first || chars[idx] != ']') {
                    first = false;
                    if chars[idx..].starts_with(&['[', ':']) {
                        if let Some(end) = chars[idx + 2..].windows(2).position(|w| w == [':', ']']) {
                            let name: String = chars[idx + 2..idx + 2 + end].iter().collect();
                            parsed.cross_line |= name == "space";
                            if let Some(class) = posix_class_ranges(&name) { ranges.extend_from_slice(class); }
                            else if rg { return Err(format!("invalid ERE character class [:{name}:]").into()); }
                            else if strict_ere { return Err(format!("unsupported character class '{name}'").into()); }
                            idx += end + 4;
                            if rg && matches!(&chars[idx..], ['-', end, ..] if *end != ']') {
                                return Err("invalid ERE character range".into());
                            }
                            continue;
                        } else if rg { return Err("invalid ERE: unclosed character class".into()); }
                        else if strict_ere { return Err("unsupported character class ''".into()); }
                    }
                    if rg && let ['[', kind @ ('.' | '='), tail @ ..] = &chars[idx..] {
                        return Err(if tail.windows(2).any(|w| w == [*kind, ']']) { "unsupported ERE collating or equivalence class" }
                            else { "invalid ERE: unclosed character class" }.into());
                    }
                    if strict_ere && matches!(&chars[idx..], ['[', '.' | '=', ..]) {
                        return Err("collating and equivalence classes are not supported".into());
                    }
                    if chars[idx..].starts_with(&['\\', 'n']) { parsed.cross_line = true; }
                    if let Some(class) = bracket_shorthand(&chars[idx..]) {
                        parsed.requires_vm |= matches!(chars[idx + 1], 'S' | 'W' | 'D');
                        parsed.cross_line |= matches!(chars[idx + 1], 's' | 'S' | 'W' | 'D');
                        ranges.extend_from_slice(class);
                        idx += 2;
                        if rg && matches!(&chars[idx..], ['-', end, ..] if *end != ']') {
                            return Err("invalid ERE character range".into());
                        }
                        if strict_ere && chars.get(idx) == Some(&'-') && chars.get(idx + 1) != Some(&']') {
                            return Err("character class cannot be a range endpoint".into());
                        }
                        continue;
                    }
                    let lo = scalar(&mut idx)?;
                    let hi = if chars.get(idx) == Some(&'-') && chars.get(idx + 1).is_some_and(|c| *c != ']') {
                        idx += 1;
                        if rg && (bracket_shorthand(&chars[idx..]).is_some() || chars[idx..].starts_with(&['[', ':'])) {
                            return Err("invalid ERE character range".into());
                        }
                        if strict_ere && bracket_shorthand(&chars[idx..]).is_some() {
                            return Err("character class cannot be a range endpoint".into());
                        }
                        scalar(&mut idx)?
                    } else { lo };
                    if rg && lo > hi { return Err("invalid ERE character range".into()); }
                    if strict_ere && lo != hi {
                        // In UTF-16, supplementary characters sort between these two BMP segments.
                        let segments = [('\0', '\u{d7ff}'), ('\u{10000}', char::MAX), ('\u{e000}', '\u{ffff}')];
                        let segment = |c| if c < '\u{e000}' { 0 } else if c > '\u{ffff}' { 1 } else { 2 };
                        let (first, last) = (segment(lo), segment(hi));
                        if (first, lo) > (last, hi) { return Err("reversed character range".into()); }
                        for i in first..=last {
                            ranges.push((if i == first { lo } else { segments[i].0 },
                                         if i == last { hi } else { segments[i].1 }));
                        }
                    } else {
                        ranges.push((lo, hi));
                    }
                }
                if idx < chars.len() && chars[idx] == ']' { idx += 1; }
                else if rg { return Err("invalid ERE: unclosed bracket expression".into()); }
                else if strict_ere { return Err("unterminated bracket expression".into()); }
                RxAtom::Class {
                    negate,
                    chars: ranges,
                }
            }
            '(' if mdq && chars[idx..].starts_with(&['(', '?', '#']) => {
                idx += 3;
                let len = chars[idx..].iter().position(|&c| c == ')')
                    .ok_or_else(|| RxParseError::at(idx, "Opening parenthesis without closing parenthesis"))?;
                idx += len + 1;
                parsed.close_group(vec![Vec::new()], RxGroup::Plain)
            }
            '(' if mdq && chars[idx..].starts_with(&['(', '?', '(']) => {
                idx += 3;
                groups.push((std::mem::take(&mut out), std::mem::take(&mut alts), RxGroup::Conditional, None, mode));
                let end = chars[idx..].iter().position(|&c| c == ')').map_or(chars.len(), |n| idx+n);
                let token: String = chars[idx..end].iter().collect();
                let name = token.strip_prefix('<').and_then(|s| s.strip_suffix('>'))
                    .or_else(|| token.strip_prefix('\'').and_then(|s| s.strip_suffix('\''))).unwrap_or(&token);
                let slot = if !name.is_empty() && name.bytes().all(|c| c.is_ascii_digit()) {
                    Some(numeric_ref(super::js_number(name, 0.)))
                } else { mdq_names.get(name).copied() };
                if let Some(slot) = slot {
                    if end == chars.len() { return Err(RxParseError::at(end+1, "Opening parenthesis without closing parenthesis")); }
                    alts.push(vec![RxToken { atom: RxAtom::CaptureSet(slot), case: RxCase::Sensitive, min: 1, max: Some(1), lazy: false }]);
                    idx = end + 1;
                } else if name != token {
                    return Err(RxParseError::at(idx, &format!("Invalid group name in back reference: {name}")));
                } else {
                    groups.push((Vec::new(), Vec::new(), RxGroup::ConditionTest, None, mode));
                }
                continue;
            }
            '(' if mdq && chars[idx..].starts_with(&['(', '?', 'P', '=']) => {
                idx += 4;
                let Some(len) = chars[idx..].iter().position(|&c| c == ')') else {
                    return Err(RxParseError::at(idx, "Could not parse group name"));
                };
                let name = chars[idx..idx+len].iter().collect::<String>();
                let slot = mdq_names.get(&name).ok_or_else(|| RxParseError::at(idx,
                    &format!("Invalid group name in back reference: {name}")))?;
                idx += len + 1;
                RxAtom::Backref(*slot)
            }
            '(' => {
                idx += 1;
                let outer_mode = mode;
                let kind = match &chars[idx..] {
                    ['?', flag, ..] if (rg || jq) && "ims-".contains(*flag) || mdq && (flag.is_ascii_alphabetic() || *flag == '-') && *flag != 'P' => {
                        let start = idx - 1;
                        parsed.requires_vm = true;
                        idx += 1;
                        let mut enabled = true;
                        let mut changed = false;
                        while let Some(&flag) = chars.get(idx) {
                            match flag {
                                ')' | ':' => break,
                                '-' if enabled || mdq => { enabled = false; if !mdq { changed = false; } idx += 1; continue; }
                                'i' => mode.icase = enabled,
                                'm' => mode.multiline = enabled,
                                's' => mode.dotall = enabled,
                                'x' if mdq => mode.extended = enabled,
                                'U' if mdq => mode.ungreedy = enabled,
                                'u' if mdq && enabled => {}
                                'u' if mdq => return Err(RxParseError::at(idx, "Disabling Unicode not supported")),
                                _ if mdq => return Err(RxParseError::at(start + 2, &format!("Unknown group flag: {}", chars[start..=idx].iter().collect::<String>()))),
                                _ => return Err("unsupported inline regular expression flag".into()),
                            }
                            changed = true;
                            idx += 1;
                        }
                        if !changed { return Err("empty inline regular expression flags".into()); }
                        match chars.get(idx) {
                            Some(')') => { idx += 1; continue; }
                            Some(':') => { idx += 1; RxGroup::Plain }
                            _ => return Err("unterminated inline regular expression flags".into()),
                        }
                    }

                    ['?', '>', ..] if mdq => { idx += 2; RxGroup::Atomic }
                    ['?', ':', ..] => { idx += 2; RxGroup::Plain }
                    ['?', '=' | '!', ..] | ['?', '<', '=' | '!', ..] if rg => return Err("unsupported ERE lookaround".into()),
                    ['?', c @ ('=' | '!'), ..] if assertions => {
                        idx += 2; RxGroup::Assertion { behind: false, positive: *c == '=' }
                    }
                    ['?', '<', c @ ('=' | '!'), ..] if assertions => {
                        idx += 3; RxGroup::Assertion { behind: true, positive: *c == '=' }
                    }
                    tail if !sed && ((!jq && tail.starts_with(&['?', 'P', '<'])) || (tail.starts_with(&['?', '<']) && !matches!(tail.get(2), Some('=' | '!'))))
                        && let Some(end) = tail.iter().position(|&c| c == '>') => {
                        let start = if tail[1] == 'P' { 3 } else { 2 };
                        let name = &tail[start..end];
                        if rg && (!matches!(name.first(), Some(c) if c.is_alphabetic() || *c == '_')
                            || !name.iter().all(|c| c.is_alphanumeric() || "_.[]".contains(*c)) || !rg_names.insert(name)) {
                            return Err("invalid ERE capture name".into());
                        }
                        idx += end + 1;
                        let name = name.iter().collect::<String>();
                        if mdq && (!name.starts_with(|c: char| c == '_' || c.is_alphabetic())
                            || !name.chars().all(|c| c == '_' || c.is_alphanumeric())
                            || mdq_names.insert(name.clone(), group_count).is_some()) {
                            return Err(RxParseError::at(idx, "Could not parse group name"));
                        }
                        RxGroup::Capture(Some(name))
                    }
                    ['?', '<', ..] | ['?', 'P', '<', ..] if rg => return Err("invalid ERE capture name".into()),
                    ['?', '<', ..] if jq => return Err("invalid named capture".into()),
                    ['?', ..] if rg => return Err("unsupported ERE group syntax".into()),
                    ['?', ..] if jq => return Err("unsupported jq regular expression group".into()),
                    _ => RxGroup::Capture(None),
                };
                let slot = if (mdq || strict_ere) && matches!(kind, RxGroup::Capture(_)) {
                    group_count += 1;
                    Some(group_count - 1)
                } else { None };
                groups.push((std::mem::take(&mut out), std::mem::take(&mut alts), kind, slot, outer_mode));
                continue;
            }
            '|' => {
                parsed.requires_vm |= out.is_empty();
                idx += 1;
                alts.push(std::mem::take(&mut out));
                continue;
            }
            ')' if !groups.is_empty() => {
                idx += 1;
                let (outer, outer_alts, kind, slot, outer_mode) = groups.pop().unwrap();
                mode = outer_mode;
                if let Some(entry) = slot.and_then(|i| closed.get_mut(i)) { *entry = true; }
                parsed.requires_vm |= out.is_empty();
                alts.push(std::mem::replace(&mut out, outer));
                let mut branches = std::mem::replace(&mut alts, outer_alts);
                if matches!(kind, RxGroup::ConditionTest) {
                    let atom = parsed.close_group(branches, RxGroup::Plain);
                    alts.push(vec![RxToken { atom, case: RxCase::Sensitive, min: 1, max: Some(1), lazy: false }]);
                    continue;
                }
                if matches!(kind, RxGroup::Conditional) {
                    if branches.len() > 3 { return Err(RxParseError::at(idx, "Opening parenthesis without closing parenthesis")); }
                    branches.resize_with(3, Vec::new);
                }
                parsed.close_group(branches, kind)
            }
            c => {
                idx += 1;
                RxAtom::Char(c)
            }
        };

        parsed.requires_vm |= matches!(atom, RxAtom::MdqBoundary(_) | RxAtom::MdqPosition(_) | RxAtom::CaptureSet(_) | RxAtom::WordBoundary(_) | RxAtom::WordStart | RxAtom::WordEnd);
        parsed.cross_line |= matches!(atom, RxAtom::Any { newline: true, .. } | RxAtom::Space(_) | RxAtom::Word(true)
            | RxAtom::Digit(true) | RxAtom::Char('\n') | RxAtom::Begin | RxAtom::End);
        skip(&mut idx, mode);
        let case = if !mode.icase { RxCase::Sensitive } else if rg { RxCase::Ascii } else if mdq { RxCase::Mdq } else { RxCase::Unicode };
        let mut min = 1usize;
        let mut max = Some(1usize);
        let mut lazy = mode.ungreedy;
        if matches!(
            atom,
            RxAtom::Begin | RxAtom::LineBegin | RxAtom::End | RxAtom::NewlineEnd { .. } | RxAtom::MdqBoundary(_) | RxAtom::MdqPosition(_) | RxAtom::CaptureSet(_) | RxAtom::WordBoundary(_) | RxAtom::WordStart | RxAtom::WordEnd
        ) {
            if rg && matches!(chars.get(idx), Some('*' | '+' | '?' | '{')) {
                return Err("invalid ERE: assertion cannot be quantified".into());
            }
            if (mdq || sed) && matches!(chars.get(idx), Some('*' | '+' | '?' | '{')) {
                atom = parsed.close_group(vec![vec![RxToken {atom, case, min:1, max:Some(1), lazy:false}]], RxGroup::Plain);
            } else {
                out.push(RxToken { atom, case, min: 1, max: Some(1), lazy: false });
                continue;
            }
        }
        while idx < chars.len() {
            let before_quantifier = idx;
            match chars[idx] {
                '*' => {
                    min = 0;
                    max = None;
                    idx += 1;
                }
                '+' => {
                    min = 1;
                    max = None;
                    idx += 1;
                }
                '?' => {
                    min = 0;
                    max = Some(1);
                    idx += 1;
                }
                '{' => {
                    if mdq {
                        let mut at = idx + 1;
                        let count = |at: &mut usize| {
                            let begin = *at;
                            while chars.get(*at).is_some_and(char::is_ascii_digit) { *at += 1; }
                            (begin < *at).then(|| chars[begin..*at].iter().collect::<String>().parse::<u64>().unwrap_or(u64::MAX))
                        };
                        let low = count(&mut at);
                        let high = if chars.get(at) == Some(&',') { at += 1; count(&mut at) } else { low };
                        if chars.get(at) == Some(&'}') && (low.is_some() || high != Some(0) && at > idx + 1) {
                            const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;
                            let low = low.unwrap_or(0);
                            if low > MAX_SAFE_INTEGER || high.is_some_and(|n| n < low || n > MAX_SAFE_INTEGER) {
                                return Err("Regex error: error parsing pattern 0".into());
                            }
                            min = usize::try_from(low).unwrap_or(usize::MAX);
                            max = high.map(|n| usize::try_from(n).unwrap_or(usize::MAX));
                            idx = at + 1;
                        }
                    } else if rg {
                        let end = chars[idx..].iter().position(|&c| c == '}').ok_or("invalid ERE: unclosed repetition interval")?;
                        let body: String = chars[idx+1..idx+end].iter().collect();
                        let (lo, hi) = body.split_once(',').unwrap_or((&body, &body));
                        if lo.is_empty() || !lo.bytes().chain(hi.bytes()).all(|b| b.is_ascii_digit()) {
                            return Err(format!("invalid ERE repetition interval '{{{body}}}'").into());
                        }
                        min = lo.parse().unwrap_or(usize::MAX);
                        max = (!hi.is_empty()).then(|| hi.parse().unwrap_or(usize::MAX));
                        if min > 1000 || max.is_some_and(|n| n < min || n > 1000) {
                            return Err(format!("invalid ERE repetition bounds '{{{body}}}'").into());
                        }
                        idx += end + 1;
                    } else if let Some((m_min, m_max, consumed)) = parse_quantifier(&chars[idx..]) {
                        if strict_ere {
                            if !chars[idx+1..idx+consumed-1].iter().all(|c| c.is_ascii_digit() || *c == ',') {
                                return Err("invalid repetition interval".into());
                            }
                            if m_min > m_max.unwrap_or(usize::MAX) || (m_max.unwrap_or(m_min) as u64) > (1_u64 << 53) - 1 {
                                return Err("invalid or excessive repetition interval".into());
                            }
                        }
                        min = m_min;
                        max = m_max;
                        idx += consumed;
                    } else if strict_ere { return Err("invalid repetition interval".into()); }
                }
                _ => {}
            }
            if mdq && idx != before_quantifier && let RxAtom::Group { index, kind: RxGroup::Plain, .. } = atom
                && matches!(parsed.groups[index].as_slice(), [only] if only.is_empty()) {
                return Err(RxParseError::at(before_quantifier, "Target of repeat operator is invalid"));
            }
            if !sed && idx < chars.len() && chars[idx] == '?' && idx != before_quantifier {
                lazy = !lazy;
                parsed.requires_vm = true;
                idx += 1;
            }
            else if mdq && idx != before_quantifier && chars.get(idx) == Some(&'+') {
                idx += 1;
                let repeated = RxToken { atom, case, min, max, lazy };
                atom = parsed.close_group(vec![vec![repeated]], RxGroup::Atomic);
                min = 1;
                max = Some(1);
            }
            if mdq && idx != before_quantifier && matches!(chars.get(idx), Some('*' | '+' | '?')) {
                return Err(RxParseError::at(idx, "Target of repeat operator is invalid"));
            }
            if strict_ere && matches!(chars.get(idx), Some('*' | '+' | '?' | '{')) { return Err("nested quantifier is not supported".into()); }
            let stacked = rg && idx != before_quantifier && matches!(chars.get(idx), Some('*' | '+' | '?' | '{'));
            if rg && parsed.bounded_error.is_none() {
                let error = if matches!(atom, RxAtom::Group { nullable: true, .. }) && max.is_none_or(|n| n > 1) {
                    Some((before_quantifier, "nullable captured repetition"))
                } else if stacked { Some((idx, "stacked repetition")) } else { None };
                if let Some((pos, message)) = error {
                    let (prefix, _, headers) = translate_search_pattern(&chars[..pos].iter().collect::<String>(), true);
                    parsed.bounded_error = Some((prefix.encode_utf16().count() - headers, message));
                }
            }
            if stacked {
                let inner = RxToken { atom, case, min, max, lazy };
                atom = parsed.close_group(vec![vec![inner]], RxGroup::Plain);
                lazy = false;
                continue;
            }
            break;
        }
        out.push(RxToken {
            atom, case,
            min,
            max,
            lazy,
        });
    }
    if mdq && !groups.is_empty() { return Err(RxParseError::at(idx, "Opening parenthesis without closing parenthesis")); }
    if rg && !groups.is_empty() { return Err("invalid ERE: unclosed '('".into()); }
    if strict_ere && !groups.is_empty() { return Err("unmatched '(' in regular expression".into()); }
    while let Some((outer, outer_alts, kind, _, _)) = groups.pop() {
        alts.push(std::mem::replace(&mut out, outer));
        let atom = parsed.close_group(std::mem::replace(&mut alts, outer_alts), kind);
        out.push(RxToken { atom, case: RxCase::Sensitive, min: 1, max: Some(1), lazy: false });
    }
    if let Some(index) = numbered_refs.iter().find(|&&n| n < 1.0 || n > group_count as f64) {
        return Err(format!("Invalid back reference to group {index}").into());
    }
    if !numbered_refs.is_empty() && !mdq_names.is_empty() {
        return Err("Numbered backref/call not allowed because named group was used, use a named backref instead".into());
    }
    parsed.requires_vm |= out.is_empty() && !alts.is_empty();
    alts.push(out);
    parsed.root = alts;
    Ok(parsed)
}

fn parse_quantifier(chars: &[char]) -> Option<(usize, Option<usize>, usize)> {
    let close = chars.iter().position(|&c| c == '}')?;
    let body: String = chars[1..close].iter().collect();
    if let Some((a, b)) = body.split_once(',') {
        let min = a.trim().parse::<usize>().ok()?;
        let max = if b.trim().is_empty() {
            None
        } else {
            Some(b.trim().parse::<usize>().ok()?)
        };
        Some((min, max, close + 1))
    } else {
        let exact = body.trim().parse::<usize>().ok()?;
        Some((exact, Some(exact), close + 1))
    }
}

// A fixed-width lookbehind has exactly one possible starting position.
fn rx_fixed_width(alts: &[Vec<RxToken>]) -> Option<usize> {
    let mut width = None;
    for seq in alts {
        let mut sum = 0usize;
        for tok in seq {
            let n = match &tok.atom {
                RxAtom::Backref(_) => return None,
                RxAtom::Begin | RxAtom::LineBegin | RxAtom::End | RxAtom::NewlineEnd { .. } | RxAtom::MdqBoundary(_) | RxAtom::MdqPosition(_) | RxAtom::CaptureSet(_) | RxAtom::WordBoundary(_) | RxAtom::WordStart | RxAtom::WordEnd
                | RxAtom::Group { kind: RxGroup::Assertion { .. }, .. } => 0,
                RxAtom::Group { width, .. } => (*width)?,
                _ => 1,
            };
            if n != 0 && Some(tok.min) != tok.max { return None; }
            sum = sum.checked_add(n.checked_mul(tok.min)?)?;
        }
        if width.is_some_and(|w| w != sum) { return None; }
        width = Some(sum);
    }
    width
}

pub(super) fn mdq_fold(c: char) -> char {
    let mut lower = c.to_lowercase();
    let first = lower.next().unwrap();
    if c == 'ı' || lower.next().is_some() { return c; }
    let mut upper = first.to_uppercase();
    let candidate = upper.next().unwrap();
    if upper.next().is_some() { first } else { candidate.to_lowercase().next().unwrap() }
}

fn folded_in_range(mut folded: impl Iterator<Item = char>, lo: char, hi: char) -> bool {
    folded.next().is_some_and(|first| first >= lo && (first < hi || first == hi && folded.next().is_none()))
}

fn matches_char(token: &RxToken, ch: char, ignore_case: bool) -> bool {
    let ignore_case = ignore_case || token.case == RxCase::Ascii;
    match &token.atom {
        RxAtom::Any { newline, nul } => (*newline || ch != '\n') && (*nul || ch != '\0'),
        RxAtom::Char(expected) => {
            if token.case == RxCase::Mdq {
                ch == *expected || mdq_fold(ch) == mdq_fold(*expected)
            } else if token.case == RxCase::Unicode {
                ch == *expected || ch.to_lowercase().eq(expected.to_lowercase())
            } else if ignore_case {
                ch.to_ascii_lowercase() == expected.to_ascii_lowercase()
            } else {
                ch == *expected
            }
        }
        RxAtom::MdqClass(edges, invert) => (edges.partition_point(|&edge| edge <= ch as u32) % 2 == 1) ^ invert,
        RxAtom::Digit(inv) => ch.is_ascii_digit() ^ inv,
        RxAtom::Word(inv) => is_word_char(ch) ^ inv,
        RxAtom::Space(inv) => ch.is_ascii_whitespace() ^ inv,
        RxAtom::Class { negate, chars } => {
            let inside = chars.iter().any(|&(s, e)| {
                let range = s..=e;
                range.contains(&ch)
                    || token.case == RxCase::Unicode && (folded_in_range(ch.to_lowercase(), s, e)
                        || folded_in_range(ch.to_uppercase(), s, e))
                    || ignore_case
                        && (range.contains(&ch.to_ascii_lowercase())
                            || range.contains(&ch.to_ascii_uppercase()))
            });
            inside ^ negate
        }
        RxAtom::Group { .. }
        | RxAtom::Backref(_)
        | RxAtom::Begin
        | RxAtom::LineBegin
        | RxAtom::NewlineEnd { .. }
        | RxAtom::End
        | RxAtom::MdqBoundary(_) | RxAtom::MdqPosition(_) | RxAtom::CaptureSet(_) | RxAtom::WordBoundary(_)
        | RxAtom::WordStart
        | RxAtom::WordEnd => false,
    }
}

#[derive(Clone)]
enum RxOp {
    Atom(RxToken),
    Probe { behind: bool, positive: bool, width: Option<usize>, after: usize },
    ProbeEnd { consume: bool },
    Condition { yes: usize, no: usize },
    Split(usize),
    Jump(usize),
    Open {
        slot: usize,
        until: usize,
    },
    Close(usize),
    Enter,
    Repeat {
        min: usize,
        max: Option<usize>,
        lazy: bool,
        after: usize,
    },
    Again(usize),
}

#[derive(Clone)]
struct RxProgram {
    ops: Vec<RxOp>,
    groups: usize,
    names: Vec<(String, usize)>,
    backrefs: bool,
    nonempty: bool,
}

#[derive(Clone)]
struct RxMatch {
    pc: usize,
    start: usize,
    pos: usize,
    caps: Vec<Option<(usize, usize)>>,
    repeats: Vec<(usize, usize)>,
}

struct AssertionFrame {
    resume: RxMatch,
    body: usize,
    origin: usize,
    last_origin: usize,
    end: Option<usize>,
    positive: bool,
    otherwise: Option<usize>,
    pending_base: usize,
    seen: std::collections::HashSet<(usize, usize, Vec<(usize, usize)>, Vec<Option<(usize, usize)>>)>,
}

// Parsing, compilation and teardown all use flat storage. Each open group
// has one frame; finishing a child patches its parent's pending instructions.
#[derive(Default)]
struct CompileFrame {
    branches: std::vec::IntoIter<Vec<RxToken>>,
    tokens: std::vec::IntoIter<RxToken>,
    split: Option<usize>,
    jumps: Vec<usize>,
    close: Option<usize>,
    consume: bool,
    condition: Option<usize>,
    repeat: Option<usize>,
}

impl RxProgram {
    fn new(mut parsed: ParsedRegex) -> Self {
        let mut program = Self { ops: Vec::new(), groups: 0, names: Vec::new(), backrefs: false, nonempty: false };
        let ops = &mut program.ops;
        let mut frames = vec![CompileFrame { branches: parsed.root.into_iter(), ..Default::default() }];
        while !frames.is_empty() {
            let root = frames.len() == 1;
            let frame = frames.last_mut().unwrap();
            let repeat = if let Some(mut tok) = frame.tokens.next() {
                let grouped = matches!(tok.atom, RxAtom::Group { .. });
                let variable = tok.max != Some(tok.min);
                // A terminal scalar run can be scanned directly. Before another atom,
                // put variable counts on the worklist so converging paths share states.
                let repeat = ((grouped && (tok.min != 1 || tok.max != Some(1)))
                    || (variable && !(root && frame.tokens.len() == 0))).then(|| {
                    ops.push(RxOp::Enter);
                    let head = ops.len();
                    ops.push(RxOp::Repeat { min: tok.min, max: tok.max, lazy: tok.lazy, after: 0 });
                    head
                });
                if let RxAtom::Group { index, width, kind, .. } = tok.atom {
                    let open = ops.len();
                    // An atomic group commits to the first successful path just like
                    // a positive lookahead, but also consumes the matched input.
                    let consume = matches!(kind, RxGroup::Atomic);
                    let condition = matches!(kind, RxGroup::Conditional).then_some(open);
                    match kind {
                        RxGroup::ConditionTest => unreachable!(),
                        RxGroup::Conditional => ops.push(RxOp::Condition { yes: 0, no: 0 }),
                        RxGroup::Atomic => ops.push(RxOp::Probe { behind: false, positive: true, width: Some(0), after: 0 }),
                        RxGroup::Assertion { behind, positive } => ops.push(RxOp::Probe {
                            behind, positive, width: if behind { width } else { Some(0) }, after: 0,
                        }),
                        RxGroup::Capture(name) => {
                            let slot = program.groups;
                            if let Some(name) = name { program.names.push((name, slot)); }
                            program.groups += 1;
                            ops.push(RxOp::Open { slot, until: slot + 1 });
                        }
                        RxGroup::Plain => {}
                    }
                    frames.push(CompileFrame {
                        branches: std::mem::take(&mut parsed.groups[index]).into_iter(),
                        close: (ops.len() > open && condition.is_none()).then_some(open), consume, condition, repeat, ..Default::default()
                    });
                    continue;
                }
                program.backrefs |= matches!(tok.atom, RxAtom::Backref(_) | RxAtom::CaptureSet(_));
                if repeat.is_some() { tok.min = 1; tok.max = Some(1); }
                ops.push(RxOp::Atom(tok));
                repeat
            } else {
                if let Some(split) = frame.split.take() {
                    frame.jumps.push(ops.len());
                    ops.push(RxOp::Jump(0));
                    ops[split] = RxOp::Split(ops.len());
                }
                if let Some(seq) = frame.branches.next() {
                    if let Some(open) = frame.condition {
                        match frame.branches.len() {
                            1 => {
                                ops.push(RxOp::ProbeEnd { consume: true });
                                let dest = ops.len();
                                if let RxOp::Condition { yes, .. } = &mut ops[open] { *yes = dest; }
                            }
                            0 => {
                                frame.jumps.push(ops.len());
                                ops.push(RxOp::Jump(0));
                                let dest = ops.len();
                                if let RxOp::Condition { no, .. } = &mut ops[open] { *no = dest; }
                            }
                            _ => {}
                        }
                    } else if frame.branches.len() != 0 {
                        frame.split = Some(ops.len());
                        ops.push(RxOp::Split(0));
                    }
                    frame.tokens = seq.into_iter();
                    continue;
                }
                let frame = frames.pop().unwrap();
                for jump in frame.jumps { ops[jump] = RxOp::Jump(ops.len()); }
                if let Some(open) = frame.close {
                    let end = ops.len();
                    let close = match &mut ops[open] {
                        RxOp::Open { slot, until } => { *until = program.groups; RxOp::Close(*slot) }
                        RxOp::Probe { after, .. } => { *after = end + 1; RxOp::ProbeEnd { consume: frame.consume } }
                        _ => unreachable!(),
                    };
                    ops.push(close);
                }
                frame.repeat
            };
            if let Some(head) = repeat {
                ops.push(RxOp::Again(head));
                let end = ops.len();
                if let RxOp::Repeat { after, .. } = &mut ops[head] { *after = end; }
            }
        }
        program
    }

    fn run(
        &self,
        hay: &[(usize, char)],
        range: std::ops::RangeInclusive<usize>,
        icase: bool,
        search: RxSearch,
        capture: bool,
        accept: impl Fn(usize) -> bool,
    ) -> Option<RxMatch> {
        let first = !matches!(search, RxSearch::Longest | RxSearch::BytewiseLongest | RxSearch::Expr);
        let (start, stop) = range.into_inner();
        let mut state = RxMatch {
            pc: 0,
            start,
            pos: start,
            caps: vec![
                None;
                if capture || self.backrefs {
                    self.groups
                } else {
                    0
                }
            ],
            repeats: Vec::new(),
        };
        let mut pending = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut best: Option<RxMatch> = None;
        let mut assertions: Vec<AssertionFrame> = Vec::new();
        'search: loop {
            loop {
                let Some(op) = self.ops.get(state.pc) else {
                    if (!self.nonempty || state.pos > start) && accept(state.pos) && best.as_ref().is_none_or(|m| m.pos < state.pos) {
                        if first || state.pos == hay.len() {
                            return Some(state);
                        }
                        best = Some(state);
                    }
                    break;
                };
                state.pc += 1;
                match op {
                    RxOp::Probe { .. } | RxOp::Condition { .. } => {
                        let (behind, positive, width, after, otherwise) = match *op {
                            RxOp::Probe { behind, positive, width, after } => (behind, positive, width, after, None),
                            RxOp::Condition { yes, no } => (false, true, Some(0), yes, Some(no)),
                            _ => unreachable!(),
                        };
                        let pos = state.pos;
                        let origin = match width {
                            Some(w) if w > pos => {
                                if positive { break; }
                                state.pc = after;
                                continue;
                            }
                            Some(w) => pos - w,
                            None => 0,
                        };
                        let body = state.pc;
                        state.pc = after;
                        let probe = RxMatch { pc: body, start: state.start, pos: origin, caps: state.caps.clone(), repeats: Vec::new() };
                        assertions.push(AssertionFrame {
                            resume: state, body, origin, last_origin: if width.is_some() { origin } else { pos },
                            end: behind.then_some(pos), positive, otherwise, pending_base: pending.len(), seen: std::mem::take(&mut seen),
                        });
                        state = probe;
                    }
                    RxOp::ProbeEnd { consume } => {
                        let frame = assertions.last().unwrap();
                        if frame.end.is_some_and(|end| state.pos != end) || (self.nonempty && state.pos == frame.origin) { break; }
                        let frame = assertions.pop().unwrap();
                        seen = frame.seen;
                        pending.truncate(frame.pending_base);
                        if !frame.positive { break; }
                        state = RxMatch { start: state.start, pos: if *consume {state.pos} else {frame.resume.pos}, caps: state.caps, ..frame.resume };
                    }
                    RxOp::Jump(dest) => state.pc = *dest,
                    RxOp::Open { slot, until } if !state.caps.is_empty() => {
                        if search != RxSearch::Expr { state.caps[*slot..*until].fill(None); }
                        // mdq distinguishes an open group from a closed empty capture.
                        state.caps[*slot] = Some((state.pos, if matches!(search, RxSearch::Mdq { .. }) { usize::MAX } else { state.pos }));
                    }
                    RxOp::Close(slot) if !state.caps.is_empty() => {
                        state.caps[*slot].as_mut().unwrap().1 = state.pos;
                    }
                    RxOp::Open { .. } | RxOp::Close(_) => {}
                    RxOp::Enter => state.repeats.push((0, state.pos)),
                    RxOp::Again(head) => {
                        let RxOp::Repeat {
                            min, max, lazy, after
                        } = self.ops[*head]
                        else {
                            unreachable!()
                        };
                        let (count, from) = state.repeats.last_mut().unwrap();
                        if state.pos == *from {
                            if search == RxSearch::Expr && max.is_some() {
                                // Each optional copy may capture the empty string.
                                *count += 1;
                            } else if let Some(max) = max && matches!(search, RxSearch::Rg { .. }) {
                                // Finite repeats in the scalar matcher allow a final empty
                                // capture. Repeating that same path cannot advance the cursor.
                                *count = if lazy && *count < min { min } else { max };
                            } else {
                                if *count >= min { break; }
                                *count = min;
                            }
                        } else if max.is_some() || *count < min {
                            *count += 1;
                        }
                        if Some(*count) == max {
                            state.repeats.pop();
                            state.pc = after;
                        } else {
                            *from = state.pos;
                            state.pc = *head;
                        }
                    }
                    RxOp::Split(_) | RxOp::Repeat { .. } => {
                        // At the same instruction only backreferences can distinguish paths
                        // by their captures. Keep the first path for equal-length ties.
                        if !seen.insert((
                            state.pc,
                            state.pos,
                            state.repeats.clone(),
                            if self.backrefs {
                                state.caps.clone()
                            } else {
                                Vec::new()
                            },
                        )) {
                            break;
                        }
                        match op {
                            RxOp::Split(next) => pending.push(RxMatch {
                                pc: *next,
                                ..state.clone()
                            }),
                            RxOp::Repeat {
                                min,
                                max,
                                lazy,
                                after,
                            } => {
                                let count = state.repeats.last().unwrap().0;
                                if Some(count) == *max {
                                    state.repeats.pop();
                                    state.pc = *after;
                                } else if count >= *min {
                                    let mut exit = state.clone();
                                    exit.repeats.pop();
                                    exit.pc = *after;
                                    if *lazy {
                                        std::mem::swap(&mut state, &mut exit);
                                    }
                                    pending.push(exit);
                                }
                            }
                            _ => unreachable!(),
                        }
                    }
                    RxOp::Atom(tok) => {
                        if let RxAtom::CaptureSet(slot) = tok.atom {
                            if state.caps.get(slot).is_none_or(Option::is_none) { break; }
                            continue;
                        }
                        if let RxAtom::MdqPosition(kind) = tok.atom
                            && let RxSearch::Mdq { continuation, trailing_start } = search {
                            match kind {
                                'K' => state.start = state.pos,
                                'G' if state.pos != continuation => break,
                                'Z' if state.pos < trailing_start => break,
                                _ => {}
                            }
                            continue;
                        }
                        if let Some(ok) = check_boundary_atom(&tok.atom, hay, state.pos) {
                            if !ok {
                                break;
                            }
                            continue;
                        }
                        let reference = if let RxAtom::Backref(i) = tok.atom {
                            match state.caps.get(i).copied().flatten().filter(|&(_, end)| end != usize::MAX) {
                                Some((lo, hi)) if lo == hi => continue,
                                Some(range) => Some(range),
                                None if tok.min == 0 => continue,
                                None => break,
                            }
                        } else {
                            None
                        };
                        let width = reference.map_or(1, |(lo, hi)| hi - lo);
                        let mut end = state.pos;
                        let bound = assertions.last().and_then(|frame| frame.end).unwrap_or(stop);
                        let limit = tok.max.unwrap_or(usize::MAX).min((bound - end) / width);
                        for _ in 0..limit {
                            let ok = if let Some((lo, hi)) = reference {
                                let left = &hay[lo..hi];
                                let right = &hay[end..end + width];
                                if tok.case == RxCase::Mdq {
                                    left.iter().zip(right).all(|(&(_, a), &(_, b))| mdq_fold(a) == mdq_fold(b))
                                } else if tok.case == RxCase::Unicode && left.iter().chain(right).any(|&(_, c)| !c.is_ascii()) {
                                    let lower = |chars: &[(usize, char)]| chars.iter().map(|&(_, c)| c).collect::<String>().to_lowercase();
                                    lower(left) == lower(right)
                                } else {
                                    left.iter().zip(right).all(|(&(_, a), &(_, b))|
                                        a == b || (icase || tok.case != RxCase::Sensitive) && a.eq_ignore_ascii_case(&b))
                                }
                            } else {
                                matches_char(tok, hay[end].1, icase)
                            };
                            if !ok {
                                break;
                            }
                            end += width;
                        }
                        if (end - state.pos) / width < tok.min {
                            break;
                        }
                        let low = state.pos + tok.min * width;
                        if tok.lazy && first {
                            for n in (1..=(end - low) / width).rev() {
                                let pos = low + n * width;
                                pending.push(RxMatch {
                                    pos,
                                    ..state.clone()
                                });
                            }
                            state.pos = low;
                        } else {
                            if state.pc != self.ops.len() || !accept(end) {
                                for pos in (low..end).step_by(width) {
                                    pending.push(RxMatch {
                                        pos,
                                        ..state.clone()
                                    });
                                }
                            }
                            state.pos = end;
                        }
                    }
                }
            }
            // Once all alternatives in an assertion fail, try its next possible
            // start (variable-width lookbehind), or resume a negative assertion.
            while let Some(frame) = assertions.last_mut() {
                if pending.len() != frame.pending_base { break; }
                if frame.origin < frame.last_origin {
                    frame.origin += 1;
                    seen.clear();
                    state = RxMatch { pc: frame.body, start: frame.resume.start, pos: frame.origin, caps: frame.resume.caps.clone(), repeats: Vec::new() };
                    continue 'search;
                }
                let frame = assertions.pop().unwrap();
                seen = frame.seen;
                if let Some(dest) = frame.otherwise {
                    state = frame.resume;
                    state.pc = dest;
                    continue 'search;
                }
                if !frame.positive {
                    state = frame.resume;
                    continue 'search;
                }
            }
            match pending.pop() {
                Some(next) => state = next,
                None => return best,
            }
        }
    }
}

pub fn regex_captures(pat: &str, text: &str, ignore_case: bool) -> Option<Vec<String>> {
    let program = RxProgram::new(parse_rx_branches(pat, false, RxDialect::Auto).expect("permissive regex parser"));
    let hay: Vec<_> = text.char_indices().collect();
    let byte = |i| hay.get(i).map_or(text.len(), |&(offset, _)| offset);
    for start in 0..=hay.len() {
        if let Some(m) = program.run(&hay, start..=hay.len(), ignore_case, RxSearch::First, true, |_| true) {
            return Some(
                std::iter::once(Some((start, m.pos)))
                    .chain(m.caps)
                    .map(|cap| {
                        cap.map_or_else(String::new, |(lo, hi)| text[byte(lo)..byte(hi)].to_owned())
                    })
                    .collect(),
            );
        }
    }
    None
}

pub fn regex_capture_spans_in_hay(
    pat: &str,
    hay: &[(usize, char)],
    start: usize,
    end: usize,
    ignore_case: bool,
) -> Vec<Option<(usize, usize)>> {
    let program = RxProgram::new(parse_rx_branches(pat, false, RxDialect::Auto).expect("permissive regex parser"));
    program
        .run(hay, start..=hay.len(), ignore_case, RxSearch::First, true, |pos| pos == end)
        .map_or_else(|| vec![None; program.groups], |m| m.caps)
}

fn expand_regex_replacement(replacement: &str, matched_str: &str, text: &str, caps: &[Option<(usize, usize)>]) -> String {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum CaseMode {
        None,
        UpperAll,
        LowerAll,
    }
    let mut mode = CaseMode::None;
    let mut next_char_case: Option<bool> = None;
    let push_converted = |out: &mut String, s: &str, mode: CaseMode, next_case: &mut Option<bool>| {
        for ch in s.chars() {
            if let Some(upper) = next_case.take() {
                if upper {
                    for uc in ch.to_uppercase() {
                        out.push(uc);
                    }
                } else {
                    for lc in ch.to_lowercase() {
                        out.push(lc);
                    }
                }
            } else {
                match mode {
                    CaseMode::None => out.push(ch),
                    CaseMode::UpperAll => {
                        for uc in ch.to_uppercase() {
                            out.push(uc);
                        }
                    }
                    CaseMode::LowerAll => {
                        for lc in ch.to_lowercase() {
                            out.push(lc);
                        }
                    }
                }
            }
        }
    };
    let mut out = String::new();
    let mut chars = replacement.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('0') => {
                    push_converted(&mut out, matched_str, mode, &mut next_char_case);
                }
                Some(d @ '1'..='9') => {
                    let idx = (d as u8 - b'1') as usize;
                    if let Some(Some((lo, hi))) = caps.get(idx) {
                        push_converted(&mut out, &text[*lo..*hi], mode, &mut next_char_case);
                    }
                }
                Some('U') => mode = CaseMode::UpperAll,
                Some('L') => mode = CaseMode::LowerAll,
                Some('E') => {
                    mode = CaseMode::None;
                    next_char_case = None;
                }
                Some('u') => next_char_case = Some(true),
                Some('l') => next_char_case = Some(false),
                Some('&') => out.push('&'),
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some(other) => {
                    let mut tmp = String::new();
                    tmp.push(other);
                    push_converted(&mut out, &tmp, mode, &mut next_char_case);
                }
                None => out.push('\\'),
            }
        } else if c == '&' {
            push_converted(&mut out, matched_str, mode, &mut next_char_case);
        } else {
            let mut tmp = String::new();
            tmp.push(c);
            push_converted(&mut out, &tmp, mode, &mut next_char_case);
        }
    }
    out
}

pub fn replace_regex_in_text(
    text: &str,
    pat: &str,
    replacement: &str,
    ignore_case: bool,
    global: bool,
    nth: Option<usize>,
) -> (String, bool) {
    let (out, count) = replace_regex_count_in_text(text, pat, replacement, ignore_case, global, nth);
    (out, count > 0)
}

pub fn replace_regex_count_in_text(
    text: &str,
    pat: &str,
    replacement: &str,
    ignore_case: bool,
    global: bool,
    nth: Option<usize>,
) -> (String, usize) {
    ZeroRegex::new(vec![pat.to_string()], ignore_case, false, false, false).replace_count(text, replacement, global, nth)
}

fn apply_rg_line_replace(line: &[u8], offset: usize, spans: &[(usize, usize)], replacements: &BTreeMap<usize, Vec<u8>>) -> Vec<u8> {
    let mut out = Vec::new();
    let mut last = 0;
    for &(s, e) in spans {
        out.extend_from_slice(&line[last..s]);
        out.extend_from_slice(&replacements[&(offset + s)]);
        last = e;
    }
    out.extend_from_slice(&line[last..]);
    out
}

fn rg_json_data(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => format!("{{\"text\":\"{}\"}}", json_escape_str(&crate::vfs::shell_text(text))),
        Err(_) => format!("{{\"bytes\":\"{}\"}}", super::archive::base64_encode(bytes)),
    }
}

enum RgReplacementPart<'a> {
    Literal(&'a str),
    Match,
    Group(usize),
}

fn parse_rg_replacement<'a>(mut source: &'a str, names: &[(String, usize)]) -> Vec<RgReplacementPart<'a>> {
    use RgReplacementPart::*;
    let mut parts = Vec::new();
    while let Some((literal, rest)) = source.split_once('$') {
        if !literal.is_empty() { parts.push(Literal(literal)); }
        if let Some(tail) = rest.strip_prefix('$') {
            parts.push(Literal("$"));
            source = tail;
            continue;
        }
        let braced = rest.starts_with('{');
        let key = if braced { &rest[1..] } else { rest };
        let n = key.bytes().take_while(|c| c.is_ascii_alphanumeric() || *c == b'_').count();
        if n == 0 || (braced && !key[n..].starts_with('}')) {
            parts.push(Literal("$"));
            source = rest;
            continue;
        }
        source = &key[n + usize::from(braced)..];
        match key[..n].parse::<usize>() {
            Ok(0) => parts.push(Match),
            Ok(i) => parts.push(Group(i - 1)),
            Err(_) => if let Some((_, i)) = names.iter().rev().find(|(name, _)| name == &key[..n]) { parts.push(Group(*i)); },
        }
    }
    if !source.is_empty() { parts.push(Literal(source)); }
    parts
}

fn json_escape_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\x08' => out.push_str("\\b"),
            '\x0c' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            other => out.push(other),
        }
    }
    out
}

// Translate grep syntax to the common search parser. The bounded provider's
// diagnostics refer to its translated ERE, where group names are omitted.
fn translate_search_pattern(source: &str, extended: bool) -> (String, Option<usize>, usize) {
    let mut out = String::with_capacity(source.len());
    let mut offset = None;
    let mut group_headers = 0;
    let mut chars = source.chars().peekable();
    let mut bracket = false;
    let mut first_member = false;
    let mut branch_start = true;
    while let Some(c) = chars.next() {
        let first = branch_start;
        branch_start = false;
        if (!c.is_ascii() || c == '\0') && offset.is_none() { offset = Some(out.encode_utf16().count() - group_headers); }
        if !bracket && (extended && c == '{' || !extended && c == '\\' && chars.next_if_eq(&'{').is_some()) {
            out.push('{');
            let start = out.len();
            let mut closed = false;
            while let Some(c) = chars.next() {
                if extended && c == '}' || !extended && c == '\\' && chars.next_if_eq(&'}').is_some() { closed = true; break; }
                out.push(c);
            }
            let body = &out[start..];
            let (left, right) = body.split_once(',').unwrap_or((body, body));
            if closed && !left.is_empty() && left.bytes().chain(right.bytes()).all(|b| b.is_ascii_digit())
                && let Ok(lo @ 0..=1000) = left.parse::<usize>() {
                let hi = right.parse::<usize>().ok();
                if right.is_empty() || hi.is_some_and(|n| (lo..=1000).contains(&n)) {
                    out.truncate(start); out.push_str(&lo.to_string());
                    if hi != Some(lo) { out.push(','); if let Some(n) = hi { out.push_str(&n.to_string()); } }
                }
            }
            if closed { out.push('}'); }
        } else if c == '\\' && let Some(next) = chars.next() {
            if (!next.is_ascii() || next == '\0') && offset.is_none() { offset = Some(out.encode_utf16().count() - group_headers); }
            if !bracket && !extended && "()+?|}".contains(next) { branch_start = matches!(next, '(' | '|'); out.push(next); continue; }
            let class = match next {
                'd' | 'D' => "0-9", 'w' | 'W' => "[:alnum:]_", 's' | 'S' => "[:space:]", _ => "",
            };
            if !class.is_empty() && (!bracket || next.is_ascii_lowercase()) {
                if !bracket { out.push('['); if next.is_ascii_uppercase() { out.push('^'); } }
                out.push_str(class);
                if !bracket { out.push(']'); }
            } else if matches!(next, 't' | 'r') {
                out.push(if next == 't' { '\t' } else { '\r' });
            } else {
                let escapes = if bracket { r"]\^-nDWS" } else { r"\.^$*+?()[]{}|bB<>n123456789" };
                if escapes.contains(next) { out.push('\\'); }
                out.push(next);
            }
            first_member = false;
        } else if bracket {
            if c == '[' && chars.peek() == Some(&':') {
                out.push(c);
                for c in chars.by_ref() { out.push(c); if c == ']' { break; } }
            } else {
                if c == ']' && !first_member { bracket = false; }
                out.push(c);
            }
            first_member = false;
        } else if c == '[' {
            out.push(c);
            if chars.next_if_eq(&'^').is_some() { out.push('^'); }
            bracket = true;
            first_member = true;
        } else if extended && c == '(' && chars.peek() == Some(&'?') {
            out.push(c);
            let mut tail = chars.clone();
            tail.next();
            if tail.next_if_eq(&':').is_some() { chars = tail; continue; }
            tail.next_if_eq(&'P');
            if tail.next_if_eq(&'<').is_some() && !matches!(tail.peek(), Some('=' | '!')) {
                let start = out.len();
                for c in chars.by_ref() { out.push(c); if c == '>' { break; } }
                group_headers += out[start..].encode_utf16().count();
            }
        } else {
            if !extended && ("()+?|{}".contains(c) || first && c == '*') || c == ']' || c == '}' { out.push('\\'); }
            out.push(c);
        }
    }
    (out, offset, group_headers)
}

fn grep_literal_stdin(pattern: &str, mut stdin: CommandInput, write: &mut CommandWriter) -> BuiltinOutcome {
    let anchored = pattern.strip_prefix('^');
    let mut result = ok_out("");
    let mut selected = false;
    let mut staged = Vec::new();
    let mut pending = Vec::new();
    let mut invalid = false;
    let mut writable = true;
    let mut flush = |bytes: &mut Vec<u8>, out: &mut BuiltinOutcome| {
        let ok = bytes.is_empty() || write(1, &bytes_to_stream_string(bytes), out);
        bytes.clear();
        ok
    };
    let mut scan = |chunk: &[u8], pending: &mut Vec<u8>, tail: bool| {
        let mut rows = 0;
        let mut bytes = 0;
        let mut lines = chunk.split_inclusive(|&b| b == b'\n').peekable();
        while let Some(part) = lines.next() {
            let line = if let Some(line) = part.strip_suffix(b"\n") { line }
                else if tail { part } else { pending.extend_from_slice(part); break };
            let line = if pending.is_empty() { line } else { pending.extend_from_slice(line); pending.as_slice() };
            let Ok(text) = std::str::from_utf8(line) else { invalid = true; break };
            if line.contains(&0) { invalid = true; break; }
            if anchored.map_or_else(|| text.contains(pattern), |literal| text.starts_with(literal)) {
                selected = true;
                if staged.len() + line.len() + 1 > 65536 && !flush(&mut staged, &mut result) { return false; }
                if line.len() >= 65536 {
                    staged.extend_from_slice(line);
                    if !flush(&mut staged, &mut result) { return false; }
                    staged.push(b'\n');
                    if !flush(&mut staged, &mut result) { return false; }
                } else { staged.extend_from_slice(line); staged.push(b'\n'); }
            }
            bytes += line.len();
            rows += 1;
            pending.clear();
            // A full matcher batch can flush before the end of the producer chunk.
            if rows == 128 || bytes >= 65536 || lines.peek().is_some_and(|p| p.ends_with(b"\n") && bytes + p.len() - 1 > 65536) {
                if staged.len() >= 8192 && !flush(&mut staged, &mut result) { return false; }
                rows = 0;
                bytes = 0;
            }
        }
        flush(&mut staged, &mut result) && !invalid
    };
    let read = stdin.read_stdin(|chunk| { writable = scan(chunk, &mut pending, false); writable });
    if writable && read.is_ok() && !pending.is_empty() { scan(&pending, &mut Vec::new(), true); }
    if result.exit_code != 0 { result.exit_code = 2; }
    else if invalid || read.is_err() {
        let error = read.err().unwrap_or_else(|| "bounded regex unsupported: literal patterns and subjects require valid non-NUL UTF-8 bytes".into());
        if write(2, &format!("grep: {error}\n"), &mut result) { result.exit_code = 2; }
    } else { result.exit_code = i32::from(!selected); }
    result
}

fn cmd_grep(
    invoked_as: &str,
    args: &[String],
    mut stdin: CommandInput,
    cwd: &str,
    finite_input_quota: bool,
    fs: &dyn SafeBashFs,
    write: &mut CommandWriter,
) -> BuiltinOutcome {
    let ascii_pattern = invoked_as == "grep" && args.len() <= 2 && args.first().is_some_and(|p|
        !p.is_empty() && p.len() <= 64 && !p.starts_with('-') && p.strip_prefix('^').unwrap_or(p)
            .bytes().all(|b| (32..=126).contains(&b) && !br"$()*+.?[\]^{|}".contains(&b)));
    let literal = ascii_pattern && args[0] != "^" && args.get(1).is_none_or(|f| f == "-" || !f.starts_with('-'));
    if literal && args.get(1).is_none_or(|f| f == "-") {
        return grep_literal_stdin(&args[0], stdin, write);
    }
    let mut line_buffered = false;
    let mut ignore_case = false;
    let mut invert = false;
    let mut count_only = false;
    let mut line_number = false;
    let mut byte_offset = false;
    let mut null_delim = false;
    let mut null_data = false;
    let mut files_with_matches = false;
    let mut files_without_match = false;
    let mut only_matching = false;
    let mut word_regexp = false;
    let mut line_regexp = false;
    let mut fixed_strings = invoked_as == "fgrep";
    let mut extended_regexp = invoked_as == "egrep";
    let mut matcher: Option<char> = match invoked_as {
        "egrep" => Some('E'),
        "fgrep" => Some('F'),
        _ => None,
    };
    let mut recursive = invoked_as == "rgrep";
    let mut saw_recursive = recursive;
    let mut dereference_recursive = false;
    let mut dir_action: Option<String> = None;
    let mut quiet = false;
    let mut no_messages = false;
    let mut no_filename = false;
    let mut ignore_binary = false;
    let mut text = false;
    let mut with_filename = false;
    let mut initial_tab = false;
    let mut stdin_label: Option<String> = None;
    let mut before_ctx = 0usize;
    let mut after_ctx = 0usize;
    let mut context_separator: Option<String> = Some("--".to_string());
    let mut rules = Vec::new();
    let mut excluded_dirs = Vec::new();
    let mut pattern_args = Vec::new();
    let mut pattern_files = Vec::new();
    let mut targets = Vec::new();
    let mut help_requested = false;

    let error = |message: String| BuiltinOutcome {
        stdout: String::new(), stderr: format!("{invoked_as}: {message}\n"), exit_code: 2,
    };
    let number = |value: &str| value.parse::<u64>().ok()
        .filter(|&n| n <= (1 << 53) - 1).map(|n| usize::try_from(n).unwrap_or(usize::MAX));
    let mut color = None;
    let mut count_arg = None;
    let mut devices = None;
    let mut filters = Vec::new();
    // Production expands -NUM before parsing, even when another option consumes it.
    let mut normalized = std::borrow::Cow::Borrowed(args);
    for (i, arg) in args.iter().take_while(|a| a.as_str() != "--").enumerate() {
        if let Some(digits) = arg.strip_prefix('-') && !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
            normalized.to_mut()[i] = format!("-C{digits}");
        }
    }
    let mut args_iter = normalized.iter().map(String::as_str);
    while let Some(arg) = args_iter.next() {
        if arg == "--" {
            targets.extend(args_iter.map(str::to_owned));
            break;
        }
        if !arg.starts_with('-') || arg == "-" {
            targets.push(arg.to_owned());
            continue;
        }
        let long = arg.starts_with("--");
        let mut rest = &arg[1..];
        while !rest.is_empty() {
            let (key, attached) = if long {
                let (name, value) = arg[2..].split_once('=').map_or((&arg[2..], None), |(n,v)| (n,Some(v)));
                let key = match name {
                    "ignore-case" => "i", "invert-match" => "v", "count" => "c",
                    "line-number" => "n", "byte-offset" => "b", "null" => "Z", "null-data" => "z",
                    "files-with-matches" => "l", "files-without-match" => "L", "only-matching" => "o",
                    "word-regexp" => "w", "line-regexp" => "x", "fixed-strings" => "F",
                    "extended-regexp" => "E", "perl-regexp" => "P", "basic-regexp" => "G",
                    "recursive" => "r", "dereference-recursive" => "R", "quiet" | "silent" => "q",
                    "no-messages" => "s", "text" => "a", "no-filename" => "h", "with-filename" => "H",
                    "initial-tab" => "T", "directories" => "d", "devices" => "D", "file" => "f",
                    "regexp" => "e", "max-count" => "m", "after-context" => "A",
                    "before-context" => "B", "context" => "C", "colour" => "color",
                    "help" | "binary" | "line-buffered" | "no-group-separator" | "no-ignore-case" |
                    "group-separator" | "label" | "exclude-from" | "exclude-dir" | "include" |
                    "exclude" | "binary-files" | "color" => name,
                    _ => return error(format!("unrecognized option '{arg}'")),
                };
                rest = "";
                (key, value)
            } else {
                let (key, tail) = rest.split_at(rest.chars().next().unwrap().len_utf8());
                rest = tail;
                (key, None)
            };
            if matches!(key, "e" | "f" | "m" | "A" | "B" | "C" | "d" | "D" | "label" | "color" |
                "include" | "exclude" | "exclude-dir" | "exclude-from" | "binary-files" | "group-separator") {
                let Some(value) = attached.or_else(|| (!rest.is_empty()).then_some(rest)).or_else(|| args_iter.next()) else {
                    return error(if long { format!("option '{arg}' requires an argument") }
                        else { format!("option requires an argument -- '{key}'") });
                };
                match key {
                    "e" => pattern_args.push(value.to_owned()),
                    "f" => pattern_files.push(value.to_owned()),
                    "m" => count_arg = Some(value),
                    "A" | "B" | "C" => {
                        let Some(n) = number(value) else { return error(format!("{value}: invalid context length argument")); };
                        if key != "B" { after_ctx = n; }
                        if key != "A" { before_ctx = n; }
                    }
                    "d" => { recursive = value == "recurse"; dir_action = Some(value.to_owned()); }
                    "D" => devices = Some(value),
                    "label" => stdin_label = Some(value.to_owned()),
                    "group-separator" => context_separator = Some(value.to_owned()),
                    "color" => color = Some(value),
                    "binary-files" => match value {
                        "without-match" => ignore_binary = true,
                        "text" | "binary" => ignore_binary = false,
                        _ => return error(format!("unsupported binary-files mode '{value}'; use text")),
                    },
                    _ => filters.push((key, value)),
                }
                break;
            }
            if attached.is_some() {
                return error(format!("option '{}' does not take an argument", arg.split_once('=').unwrap().0));
            }
            match key {
                "help" => help_requested = true,
                "i" => ignore_case = true,
                "no-ignore-case" => ignore_case = false,
                "v" => invert = true,
                "c" => count_only = true,
                "n" => line_number = true,
                "b" => byte_offset = true,
                "Z" => null_delim = true,
                "z" => null_data = true,
                "l" | "L" => { files_with_matches = key == "l"; files_without_match = key == "L"; }
                "o" => only_matching = true,
                "w" => word_regexp = true,
                "x" => line_regexp = true,
                "F" | "E" | "P" | "G" => {
                    let next = key.as_bytes()[0] as char;
                    if !help_requested && matcher.is_some_and(|m| m != next) {
                        return error("conflicting matchers specified".into());
                    }
                    matcher = Some(next);
                    fixed_strings = next == 'F';
                    extended_regexp = matches!(next, 'E' | 'P');
                }
                "r" | "R" => { recursive = true; saw_recursive = true; dereference_recursive |= key == "R"; dir_action = None; }
                "q" => quiet = true,
                "s" => no_messages = true,
                "a" => { text = true; ignore_binary = false; }
                "I" => ignore_binary = true,
                "h" | "H" => { no_filename = key == "h"; with_filename = key == "H"; }
                "T" => initial_tab = true,
                "no-group-separator" => context_separator = None,
                "line-buffered" => line_buffered = true,
                "binary" => {}
                _ => return error(format!("invalid option -- '{key}'")),
            }
        }
    }

    if help_requested {
        return ok_out("Usage: grep [OPTION]... PATTERN [FILE]...\nPrint lines matching PATTERN. With no FILE, or FILE -, read standard input.\n\n  -G, --basic-regexp       Use basic regular expressions (default)\n  -E, --extended-regexp    Use extended regular expressions\n  -F, --fixed-strings      Use fixed strings\n  -e, --regexp=PATTERN     Add a pattern (repeatable)\n  -f, --file=FILE          Read patterns from FILE\n  -i, --ignore-case        Ignore case distinctions\n  -v, --invert-match       Select nonmatching lines\n  -w, --word-regexp        Match whole words\n  -x, --line-regexp        Match whole lines\n  -n, --line-number        Print line numbers\n  -H, --with-filename      Print filenames\n  -h, --no-filename        Suppress filenames\n  -o, --only-matching      Print only matching parts\n  -c, --count              Print matching line counts\n  -l, --files-with-matches Print filenames with matches\n  -L, --files-without-match Print filenames without matches\n  -q, --quiet, --silent    Suppress normal output\n  -m, --max-count=NUM      Stop after NUM selected lines per file\n  -A, --after-context=NUM  Print NUM lines after selected lines\n  -B, --before-context=NUM Print NUM lines before selected lines\n  -C, --context=NUM        Print NUM lines before and after selected lines\n  -s, --no-messages        Suppress file error messages\n  -a, --text               Process input as text\n  -z, --null-data          Use NUL-delimited records\n  -b, --byte-offset        Print byte offsets (match offsets with -o)\n  -Z, --null               Follow printed filenames with NUL\n  -r, --recursive          Search directories recursively\n  -R, --dereference-recursive Follow links during recursive search\n  -d, --directories=ACTION Read, skip or recurse into directories\n  -D, --devices=ACTION     Read or skip special files\n      --include=GLOB      Search matching basenames\n      --exclude=GLOB      Skip matching basenames\n      --exclude-dir=GLOB  Skip matching directories\n      --exclude-from=FILE Read exclusion globs from FILE\n      --no-group-separator Suppress separators between context groups\n      --no-ignore-case    Use case-sensitive matching\n      --line-buffered     Accepted; output writes are already awaited\n      --color=WHEN, --colour=WHEN Accept never or auto for non-terminal output\n      --binary-files=text Treat input as text within regex executor limits\n      --binary            Preserve bytes (no Windows text-mode translation)\n      --label=LABEL       Name standard input in filename prefixes\n      --initial-tab       Insert a tab after line prefixes\n      --group-separator=SEP Use SEP between context groups\n      --help              Display this help and exit\n      --                  End options\n\nExit status: 0 when a line is selected, 1 when none is selected, 2 on error.\nRegular expression support depends on the configured regex executor.\nThe default bounded matcher rejects BRE groups, intervals, backreferences and escape extensions.\nUse extended alternation: grep -E 'Remove upvote|Upvoted'\nFor literal alternatives: grep -F -e 'Remove upvote' -e 'Upvoted'\nIf an action succeeded but filtering failed, retry only the read-only verification;\ninspect the resulting state before repeating the action.\n");
    }
    if let Some(mode) = color && !matches!(mode, "never" | "auto") {
        return error(format!("unsupported color mode '{mode}'; use never or auto (non-terminal output)"));
    }
    if pattern_args.is_empty() && pattern_files.is_empty() {
        if targets.is_empty() {
            return BuiltinOutcome { stdout: String::new(), stderr: format!("{invoked_as}: missing pattern\n"), exit_code: 2 };
        }
        pattern_args.push(targets.remove(0));
    }
    let mut raw_patterns: Vec<_> = pattern_args.iter().flat_map(|arg| arg.split('\n').map(stream_string_to_bytes)).collect();
    for file in pattern_files {
        let bytes = if file == "-" {
            let mut bytes = Vec::new();
            if let Err(e) = stdin.read_stdin(|chunk| { bytes.extend_from_slice(chunk); true }) {
                return error(e);
            }
            bytes
        } else {
            match read_search_file(fs, &search_path(cwd, &file), "readStream") {
                Ok(bytes) => bytes,
                Err(e) => return error(e),
            }
        };
        raw_patterns.extend(bytes.split_inclusive(|&b| b == b'\n').map(|row| row.strip_suffix(b"\n").unwrap_or(row).to_vec()));
    }
    let mut patterns = Vec::with_capacity(raw_patterns.len());
    for bytes in raw_patterns {
        // The fixed-string provider admits UTF-8. The ergonomic regex parser receives
        // a string with one character per pattern byte, including bytes read from -f.
        let pat = if fixed_strings && !text {
            let Some(pat) = String::from_utf8(bytes).ok().filter(|pat| !pat.contains('\0')) else {
                return BuiltinOutcome { stdout: String::new(), stderr: format!("{invoked_as}: bounded regex unsupported: literal patterns and subjects require valid non-NUL UTF-8 bytes\n"), exit_code: 2 };
            };
            pat
        } else { bytes.into_iter().map(char::from).collect() };
        patterns.push(pat);
    }
    let mut parsed = Vec::with_capacity(patterns.len());
    let mut use_vm = text;
    let mut bounded_ere = false;
    let mut profile_error = None;
    for source in &patterns {
        let normalized;
        let pat = if fixed_strings { source } else {
            let (expr, offset, _) = translate_search_pattern(source, extended_regexp);
            if profile_error.is_none() && let Some(i) = offset {
                profile_error = Some(format!("unsupported ERE profile at {i}: only non-NUL ASCII in the C/POSIX profile"));
            }
            normalized = expr;
            &normalized
        };
        let flags = RxFlags { icase: ignore_case, multiline: false, dotall: false, ..Default::default() };
        let branches = match parse_rx_branches(pat, fixed_strings, RxDialect::Rg { flags, dot_nul: text || null_data }) {
            Ok(parsed) => parsed,
            Err(message) => return BuiltinOutcome { stdout: String::new(), stderr: format!("{invoked_as}: {}\n", message.message), exit_code: 2 },
        };
        use_vm |= branches.requires_vm;
        if profile_error.is_none() && let Some((i, message)) = branches.bounded_error {
            profile_error = Some(format!("unsupported ERE profile at {}: {message}", i + 2 * usize::from(line_regexp)));
        }
        // The delegated provider searches ASCII literals as bytes, including under -E.
        // Escaped ordinary characters translate to literals too; shorthands translate to classes.
        if !fixed_strings {
            let mut chars = pat.chars();
            while let Some(mut c) = chars.next() {
                if c == '\\' && let Some(escaped) = chars.next() {
                    c = escaped;
                    if "dDsSwW".contains(c) { bounded_ere = true; break; }
                }
                if !c.is_ascii() || r"\.^$[]()|*+?{}".contains(c) { bounded_ere = true; break; }
            }
        }
        parsed.push(branches);
    }
    if !use_vm && let Some(error) = profile_error {
        return BuiltinOutcome { stdout: String::new(), stderr: format!("{invoked_as}: {error}\n"), exit_code: 2 };
    }
    let mut rx = ZeroRegex::from_branches(parsed, false, word_regexp && !line_regexp, line_regexp);
    if use_vm {
        rx.search = RxSearch::Rg { empty_pattern: false, binary_text: text, word_assertions: true };
    } else if word_regexp && bounded_ere {
        rx.search = RxSearch::BytewiseLongest;
    }
    if !use_vm && null_data {
        // The bounded ERE dot includes LF within a NUL-delimited record.
        for op in rx.branches.iter_mut().flat_map(|p| &mut p.ops) {
            if let RxOp::Atom(RxToken { atom: RxAtom::Any { newline, .. }, .. }) = op { *newline = true; }
        }
    }
    let max_count = match count_arg {
        Some(value) => match number(value) {
            Some(n) => Some(n),
            None => return error(format!("invalid number '{value}'")),
        },
        None => None,
    };
    if let Some(action) = &dir_action && !matches!(action.as_str(), "read" | "skip" | "recurse") {
        return error(format!("invalid argument '{action}' for 'directories'"));
    }
    if let Some(action) = devices && !matches!(action, "read" | "skip") {
        return error(format!("invalid argument '{action}' for 'devices'"));
    }
    for (key, value) in filters {
        match key {
            "exclude-dir" => excluded_dirs.push(value),
            "exclude-from" => {
                let bytes = match read_search_file(fs, &search_path(cwd, value), "readStream") {
                    Ok(bytes) => bytes,
                    Err(e) => return error(e),
                };
                for line in bytes.split_inclusive(|&b| b == b'\n') {
                    rules.push((String::from_utf8_lossy(line.strip_suffix(b"\n").unwrap_or(line)).into_owned(), false));
                }
            }
            _ => rules.push((value.to_owned(), key == "include")),
        }
    }
    let cfg = GrepConfig {
        // Production's single-pattern ASCII shortcut checks every input line.
        grep_input: if literal { GrepInput::PlainLiteral }
            else if ascii_pattern && !text || bounded_ere && !use_vm { GrepInput::Bounded(invoked_as) } else { GrepInput::Bytes },
        ascii_record_rx: None,
        invert,
        count_only,
        line_number,
        files_with_matches,
        files_without_match,
        only_matching,
        quiet,
        no_messages,
        no_filename,
        with_filename,
        max_count,
        before_ctx,
        after_ctx,
        binary: RgBinary::Auto,
        byte_offset,
        null_delim,
        null_data,
        json_output: false,
        replace: None,
        multiline: false,
        show_column: false,
        ignore_binary,
        count_matches: false,
        include_zero: true,
        trim: false,
        heading: false,
        crlf: false,
        context_separator,
        initial_tab,
        stdin_label,
        files: SearchFiles::Grep(GrepFiles { name: invoked_as, rules, excluded_dirs, recursive,
            inspect: saw_recursive || recursive || dir_action.as_deref() == Some("skip") || devices == Some("skip"),
            skip_dirs: dir_action.as_deref() == Some("skip"), skip_devices: devices == Some("skip"), follow: dereference_recursive }),
        max_columns: None,
        stats: false,
    };
    if literal { run_grep_engine(rx, targets, stdin, cwd, fs, cfg, write) }
    else { grep_stream::run(rx, targets, stdin, cwd, fs, &cfg, line_buffered, finite_input_quota, write) }
}

fn cmd_rg(
    raw_args: &[String],
    mut stdin: CommandInput,
    cwd: &str,
    env: &BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
    write: &mut CommandWriter,
) -> BuiltinOutcome {
    let mut has_no_config = false;
    for a in raw_args {
        if a == "--" {
            break;
        }
        if a == "--no-config" {
            has_no_config = true;
            break;
        }
    }
    let mut combined_args: Vec<String> = Vec::new();
    if !has_no_config
        && let Some(cfg_path) = env.get("RIPGREP_CONFIG_PATH")
        && !cfg_path.is_empty()
    {
        let resolved = resolve_posix_path(cwd, cfg_path);
        let Ok(bytes) = fs.read_file(&resolved) else {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("rg: ENOENT: no such file or directory, readStream '{resolved}'\n"),
                exit_code: 2,
            };
        };
        for line in String::from_utf8_lossy(&bytes).lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() && !trimmed.starts_with('#') {
                combined_args.push(trimmed.to_string());
            }
        }
    }
    combined_args.extend_from_slice(raw_args);
    let args = &combined_args;
    let mut ignore_case = false;
    let mut smart_case = false;
    let mut invert = false;
    let mut count_only = false;
    let mut count_matches = false;
    let mut include_zero = false;
    let mut trim = false;
    let mut heading = false;
    let mut crlf = false;
    let mut line_number = false;
    let mut show_column = false;
    let mut byte_offset = false;
    let mut null_delim = false;
    let mut null_data = false;
    let mut files_with_matches = false;
    let mut files_without_match = false;
    let mut only_matching = false;
    let mut word_regexp = false;
    let mut line_regexp = false;
    let mut fixed_strings = false;
    let mut quiet = false;
    let mut no_messages = false;
    let mut no_filename = false;
    let mut with_filename = false;
    let mut list_files_only = false;
    let mut show_hidden = false;
    let mut unrestricted_level = 0usize;
    let mut respect_ignore = true;
    let mut binary = RgBinary::Auto;
    let mut json_output = false;
    let mut stats = false;
    let mut multiline = false;
    let mut multiline_dotall = false;
    let mut replace: Option<String> = None;
    let mut max_count: Option<usize> = None;
    let mut max_depth: Option<usize> = None;
    let mut max_filesize: Option<usize> = None;
    let mut max_columns: Option<usize> = None;
    let mut no_ignore_vcs = false;
    let mut no_ignore_dot = false;
    let mut use_ignore_files = true;
    let mut custom_ignore_files: Vec<String> = Vec::new();
    let mut follow = false;
    let mut before_ctx = 0usize;
    let mut after_ctx = 0usize;
    let mut context_separator: Option<String> = Some("--".to_string());
    let mut globs: Vec<String> = Vec::new();
    let mut types = rg_types::FileTypes::default();
    let mut patterns: Vec<String> = Vec::new();
    let mut pattern_files: Vec<String> = Vec::new();
    let mut targets: Vec<String> = Vec::new();
    let mut has_explicit_pattern = false;
    let mut help_requested = false;
    let mut version_mode: Option<&'static str> = None;

    let mut numeric_option = |flag: &str, inline: Option<&str>, index: &mut usize, long: bool| -> Result<bool, BuiltinOutcome> {
        let mut count = || {
            let error = |msg: String| BuiltinOutcome { stdout: String::new(), stderr: format!("rg: {msg}\n"), exit_code: 2 };
            let value = inline.or_else(|| { *index += 1; args.get(*index).map(String::as_str) })
                .ok_or_else(|| error(format!("{}{flag} requires a value", if long { "--" } else { "-" })))?;
            let (digits, scale) = if flag == "max-filesize" {
                match value.as_bytes().last() {
                    Some(b'K') => (&value[..value.len()-1], 1024),
                    Some(b'M') => (&value[..value.len()-1], 1024 * 1024),
                    Some(b'G') => (&value[..value.len()-1], 1024 * 1024 * 1024),
                    _ => (value, 1),
                }
            } else { (value, 1) };
            let n = digits.parse::<u64>().ok().filter(|&n| n < 1 << 53 && !digits.starts_with('+'))
                .ok_or_else(|| error(format!("{flag} requires a nonnegative integer")))?;
            let n = n.checked_mul(scale).filter(|&n| n < 1 << 53).ok_or_else(|| error("max-filesize is too large".into()))?;
            Ok(usize::try_from(n).unwrap_or(usize::MAX))
        };
        match flag {
            "m" | "max-count" => max_count = Some(count()?),
            "M" | "max-columns" => max_columns = Some(count()?),
            "d" | "max-depth" | "maxdepth" => max_depth = Some(count()?),
            "C" | "context" => { before_ctx = count()?; after_ctx = before_ctx; }
            "A" | "after-context" => after_ctx = count()?,
            "B" | "before-context" => before_ctx = count()?,
            "j" | "threads" => { count()?; }
            "max-filesize" => max_filesize = Some(count()?),
            _ => return Ok(false),
        }
        Ok(true)
    };
    let mut i = 0usize;
    let mut end_of_opts = false;
    while i < args.len() {
        let a = &args[i];
        if !end_of_opts && a == "--" {
            end_of_opts = true;
            i += 1;
            continue;
        }
        if !end_of_opts && a.starts_with("--") {
            let (name, value) = a[2..].split_once('=').map_or((&a[2..], None), |(name, v)| (name, Some(v)));
            match numeric_option(name, value, &mut i, true) {
                Ok(true) => { i += 1; continue; }
                Err(e) => return e,
                Ok(false) => {}
            }
            match a.as_str() {
                "--help" => help_requested = true,
                "--version" => version_mode = Some("long"),
                "--follow" => follow = true,
                "--no-follow" => follow = false,
                "--no-config" | "--pcre2" | "--no-pcre2" => {}
                "--no-messages" => no_messages = true,
                "--messages" => no_messages = false,
                "--no-ignore-files" => use_ignore_files = false,
                "--ignore-files" => use_ignore_files = true,
                "--files" => {
                    list_files_only = true;
                    count_only = false;
                    count_matches = false;
                    files_with_matches = false;
                    files_without_match = false;
                    json_output = false;
                }
                "--ignore-case" => {
                    ignore_case = true;
                    smart_case = false;
                }
                "--smart-case" => {
                    smart_case = true;
                    ignore_case = false;
                }
                "--case-sensitive" => {
                    ignore_case = false;
                    smart_case = false;
                }
                "--invert-match" => invert = true,
                "--no-invert-match" => invert = false,
                "--count" => {
                    count_only = true;
                    count_matches = false;
                    files_with_matches = false;
                    files_without_match = false;
                    list_files_only = false;
                    json_output = false;
                }
                "--count-matches" => {
                    count_only = true;
                    count_matches = true;
                    files_with_matches = false;
                    files_without_match = false;
                    list_files_only = false;
                    json_output = false;
                }
                "--stats" => stats = true,
                "--no-stats" => stats = false,
                "--include-zero" => include_zero = true,
                "--trim" => trim = true,
                "--no-trim" => trim = false,
                "--heading" => heading = true,
                "--no-heading" => heading = false,
                "--crlf" => crlf = true,
                "--no-crlf" => crlf = false,
                "--no-context-separator" => context_separator = None,
                "--context-separator" if i + 1 < args.len() => {
                    i += 1;
                    context_separator = Some(args[i].clone());
                }
                "--line-number" => line_number = true,
                "--column" => {
                    show_column = true;
                    line_number = true;
                }
                "--no-column" => show_column = false,
                "--no-line-number" => line_number = false,
                "--byte-offset" => byte_offset = true,
                "--null" => null_delim = true,
                "--null-data" => null_data = true,
                "--hidden" => show_hidden = true,
                "--no-hidden" => show_hidden = false,
                "--no-ignore" => respect_ignore = false,
                "--text" | "--a" => binary = RgBinary::Text,
                "--binary" => binary = RgBinary::Binary,
                "--no-binary" | "--no-text" => binary = RgBinary::Auto,
                "--ignore" => respect_ignore = true,
                "--no-ignore-vcs" => no_ignore_vcs = true,
                "--ignore-vcs" => no_ignore_vcs = false,
                "--no-ignore-dot" => no_ignore_dot = true,
                "--ignore-dot" => no_ignore_dot = false,
                "--unrestricted" => {
                    unrestricted_level += 1;
                    respect_ignore = false;
                    if unrestricted_level >= 2 { show_hidden = true; }
                    if unrestricted_level >= 3 { binary = RgBinary::Binary; }
                }
                "--json" => {
                    json_output = true;
                    count_only = false;
                    count_matches = false;
                    files_with_matches = false;
                    files_without_match = false;
                    list_files_only = false;
                }
                "--multiline" => multiline = true,
                "--no-multiline" => multiline = false,
                "--multiline-dotall" => multiline_dotall = true,
                "--no-multiline-dotall" => multiline_dotall = false,
                "--ignore-file" if i + 1 < args.len() => {
                    i += 1;
                    custom_ignore_files.push(args[i].clone());
                }
                "--sort" if i + 1 < args.len() => {
                    i += 1;
                    if args[i] != "path" {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: "rg: only --sort=path is supported\n".to_string(),
                            exit_code: 2,
                        };
                    }
                }
                "--color" if i + 1 < args.len() => {
                    i += 1;
                    if args[i] != "never" {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: "rg: only --color=never is supported\n".to_string(),
                            exit_code: 2,
                        };
                    }
                }
                "--file" if i + 1 < args.len() => {
                    i += 1;
                    has_explicit_pattern = true;
                    pattern_files.push(args[i].clone());
                }
                "--files-with-matches" => {
                    files_with_matches = true;
                    files_without_match = false;
                    count_only = false;
                    count_matches = false;
                    list_files_only = false;
                    json_output = false;
                }
                "--files-without-match" => {
                    files_without_match = true;
                    files_with_matches = false;
                    count_only = false;
                    count_matches = false;
                    list_files_only = false;
                    json_output = false;
                }
                "--only-matching" => only_matching = true,
                "--no-only-matching" => only_matching = false,
                "--word-regexp" => {
                    word_regexp = true;
                    line_regexp = false;
                }
                "--line-regexp" => {
                    line_regexp = true;
                    word_regexp = false;
                }
                "--fixed-strings" => fixed_strings = true,
                "--no-fixed-strings" => fixed_strings = false,
                "--quiet" => quiet = true,
                "--no-filename" => {
                    no_filename = true;
                    with_filename = false;
                }
                "--with-filename" => {
                    with_filename = true;
                    no_filename = false;
                }
                "--replace" if i + 1 < args.len() => {
                    i += 1;
                    replace = Some(args[i].clone());
                }
                "--type" if i + 1 < args.len() => {
                    i += 1;
                    if !types.select(&args[i], true) {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("rg: unrecognized file type: {}\n", args[i]),
                            exit_code: 2,
                        };
                    }
                }
                "--type-not" if i + 1 < args.len() => {
                    i += 1;
                    if !types.select(&args[i], false) {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("rg: unrecognized file type: {}\n", args[i]),
                            exit_code: 2,
                        };
                    }
                }
                "--glob" | "-g" if i + 1 < args.len() => {
                    i += 1;
                    globs.push(args[i].clone());
                }
                "--iglob" if i + 1 < args.len() => {
                    i += 1;
                    globs.push(format!("i:{}", args[i]));
                }
                "--regexp" if i + 1 < args.len() => {
                    i += 1;
                    has_explicit_pattern = true;
                    patterns.push(args[i].clone());
                }
                _ => {
                    if let Some(g) = a.strip_prefix("--glob=") {
                        globs.push(g.to_string());
                    } else if let Some(ig) = a.strip_prefix("--iglob=") {
                        globs.push(format!("i:{ig}"));
                    } else if let Some(cs) = a.strip_prefix("--context-separator=") {
                        context_separator = Some(cs.to_string());
                    } else if let Some(igf) = a.strip_prefix("--ignore-file=") {
                        custom_ignore_files.push(igf.to_string());
                    } else if let Some(srt) = a.strip_prefix("--sort=") {
                        if srt != "path" {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: "rg: only --sort=path is supported\n".to_string(),
                                exit_code: 2,
                            };
                        }
                    } else if let Some(clr) = a.strip_prefix("--color=") {
                        if clr != "never" {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: "rg: only --color=never is supported\n".to_string(),
                                exit_code: 2,
                            };
                        }
                    } else if let Some(r) = a.strip_prefix("--replace=") {
                        replace = Some(r.to_string());
                    } else if let Some(p) = a.strip_prefix("--regexp=") {
                        has_explicit_pattern = true;
                        patterns.push(p.to_string());
                    } else if let Some(f) = a.strip_prefix("--file=") {
                        has_explicit_pattern = true;
                        pattern_files.push(f.to_string());
                    } else if let Some(t) = a.strip_prefix("--type=") {
                        if !types.select(t, true) {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("rg: unrecognized file type: {t}\n"),
                                exit_code: 2,
                            };
                        }
                    } else if let Some(t) = a.strip_prefix("--type-not=") {
                        if !types.select(t, false) {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("rg: unrecognized file type: {t}\n"),
                                exit_code: 2,
                            };
                        }
                    } else {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("rg: unsupported option '{a}'\n"),
                            exit_code: 2,
                        };
                    }
                }
            }
            i += 1;
            continue;
        }
        if !end_of_opts && a.starts_with('-') && a.len() > 1 {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut ci = 0usize;
            while ci < chars.len() {
                match chars[ci] {
                    'h' => help_requested = true,
                    'V' => version_mode = Some("short"),
                    'P' => {}
                    'i' => {
                        ignore_case = true;
                        smart_case = false;
                    }
                    's' => {
                        ignore_case = false;
                        smart_case = false;
                    }
                    'S' => {
                        smart_case = true;
                        ignore_case = false;
                    }
                    'v' => invert = true,
                    'c' => {
                        count_only = true;
                        count_matches = false;
                        files_with_matches = false;
                        files_without_match = false;
                        list_files_only = false;
                        json_output = false;
                    }
                    'n' => line_number = true,
                    'N' => line_number = false,
                    'b' => byte_offset = true,
                    '0' => null_delim = true,
                    '.' => show_hidden = true,
                    'a' => binary = RgBinary::Text,
                    'u' => {
                        unrestricted_level += 1;
                        respect_ignore = false;
                        if unrestricted_level >= 2 { show_hidden = true; }
                        if unrestricted_level >= 3 { binary = RgBinary::Binary; }
                    }
                    'l' => {
                        files_with_matches = true;
                        files_without_match = false;
                        count_only = false;
                        count_matches = false;
                        list_files_only = false;
                        json_output = false;
                    }
                    'o' => only_matching = true,
                    'w' => {
                        word_regexp = true;
                        line_regexp = false;
                    }
                    'x' => {
                        line_regexp = true;
                        word_regexp = false;
                    }
                    'L' => follow = true,
                    'F' => fixed_strings = true,
                    'q' => quiet = true,
                    'I' => {
                        no_filename = true;
                        with_filename = false;
                    }
                    'H' => {
                        with_filename = true;
                        no_filename = false;
                    }
                    'r' => {
                        let rest: String = chars[ci + 1..].iter().collect();
                        if !rest.is_empty() {
                            replace = Some(rest);
                        } else if i + 1 < args.len() {
                            i += 1;
                            replace = Some(args[i].clone());
                        }
                        break;
                    }
                    't' => {
                        let rest: String = chars[ci + 1..].iter().collect();
                        let val = if !rest.is_empty() {
                            rest
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: "rg: -t requires a value\n".to_string(),
                                exit_code: 2,
                            };
                        };
                        if !types.select(&val, true) {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("rg: unrecognized file type: {val}\n"),
                                exit_code: 2,
                            };
                        }
                        break;
                    }
                    'U' => multiline = true,
                    'T' => {
                        let rest: String = chars[ci + 1..].iter().collect();
                        let val = if !rest.is_empty() {
                            rest
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: "rg: -T requires a value\n".to_string(),
                                exit_code: 2,
                            };
                        };
                        if !types.select(&val, false) {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("rg: unrecognized file type: {val}\n"),
                                exit_code: 2,
                            };
                        }
                        break;
                    }
                    'f' => {
                        has_explicit_pattern = true;
                        let file_arg = if ci + 1 < chars.len() {
                            chars[ci + 1..].iter().collect::<String>()
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: "rg: -f requires a value\n".to_string(),
                                exit_code: 2,
                            };
                        };
                        pattern_files.push(file_arg);
                        break;
                    }
                    'e' => {
                        has_explicit_pattern = true;
                        let rest: String = chars[ci + 1..].iter().collect();
                        if !rest.is_empty() {
                            patterns.push(rest);
                        } else if i + 1 < args.len() {
                            i += 1;
                            patterns.push(args[i].clone());
                        }
                        break;
                    }
                    'g' => {
                        let rest: String = chars[ci + 1..].iter().collect();
                        if !rest.is_empty() {
                            globs.push(rest);
                        } else if i + 1 < args.len() {
                            i += 1;
                            globs.push(args[i].clone());
                        }
                        break;
                    }
                    flag @ ('m' | 'M' | 'A' | 'B' | 'C' | 'd' | 'j') => {
                        let tail = (ci + 1 < chars.len()).then(|| chars[ci + 1..].iter().collect::<String>());
                        if let Err(e) = numeric_option(flag.encode_utf8(&mut [0; 4]), tail.as_deref(), &mut i, false) {
                            return e;
                        }
                        break;
                    }
                    other => {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("rg: unsupported option '-{other}'\n"),
                            exit_code: 2,
                        };
                    }
                }
                ci += 1;
            }
            i += 1;
            continue;
        }
        if !list_files_only && !has_explicit_pattern {
            has_explicit_pattern = true;
            patterns.push(a.clone());
        } else {
            targets.push(a.clone());
        }
        i += 1;
    }

    if help_requested {
        return ok_out("Usage: rg [OPTIONS] PATTERN [PATH ...]\nSearch files for PATTERN. PATH - reads standard input.\nDefault input depends on shell configuration.\n\n  -e, --regexp=PATTERN     Add a pattern (repeatable)\n  -f, --file=FILE          Read patterns from FILE\n  -r, --replace=TEXT       Replace matches with text and capture references\n      --trim              Trim leading ASCII whitespace\n  -F, --fixed-strings      Use fixed strings\n      --max-filesize=SIZE  Filter discovered files (bytes or K/M/G)\n      --ignore-file=FILE   Read an explicit virtual ignore file\n      --no-ignore-files   Disable explicit ignore files\n      --ignore-files      Enable explicit ignore files\n      --maxdepth=NUM      Alias for --max-depth\n  -j, --threads=NUM        Accept a count (virtual execution stays serial)\n  -U, --multiline          Admit line-compatible searches only\n  -i, --ignore-case        Ignore case distinctions\n  -s, --case-sensitive     Match case sensitively\n  -S, --smart-case         Infer case sensitivity from the pattern\n  -v, --invert-match       Select nonmatching lines\n  -w, --word-regexp        Match whole words\n  -x, --line-regexp        Match whole lines\n  -n, --line-number        Print line numbers\n  -N, --no-line-number     Suppress line numbers\n  -H, --with-filename      Print filenames\n  -I, --no-filename        Suppress filenames\n  -o, --only-matching      Print matching parts\n  -l, --files-with-matches Print filenames with matches\n      --files-without-match Print filenames without matches\n      --files             List files without searching\n  -c, --count              Print matching line counts\n      --count-matches     Print match counts\n      --json              Emit JSON events\n      --stats             Report aggregate search statistics\n  -q, --quiet              Suppress normal output\n  -g, --glob=GLOB          Include or exclude paths (repeatable)\n      --iglob=GLOB        Case-insensitive glob\n  -t, --type=TYPE          Include a file type\n  -T, --type-not=TYPE      Exclude a file type\n  -., --hidden             Search hidden files\n  -L, --follow             Follow symbolic links\n      --no-ignore         Disable ignore-file filtering\n  -u, --unrestricted       Relax ignore, hidden and binary filtering (repeatable)\n  -a, --text               Search binary files as text\n  -A, --after-context=NUM  Print NUM lines after matches\n  -B, --before-context=NUM Print NUM lines before matches\n  -C, --context=NUM        Print NUM lines before and after matches\n  -M, --max-columns=NUM   Omit output lines longer than NUM bytes (0 disables)\n  -m, --max-count=NUM      Limit matching lines per file\n  -d, --max-depth=NUM     Limit directory traversal depth\n      --column            Print columns\n  -b, --byte-offset        Print byte offsets\n  -0, --null               NUL-terminate filenames\n      --null-data         Use NUL-delimited records\n      --crlf              Handle CRLF line endings\n      --heading           Group output by filename\n      --sort=path         Sort paths\n      --color=never       Disable color\n  -h, --help              Display this help and exit\n  -V, --version           Display implementation information and exit\n      --                  End options\n\nExit status: 0 when a match is found, 1 when none is found, 2 on error.\nRegular expression support depends on the configured regex executor.\nThe default supports UTF-8 literals and bounded ASCII regular expressions.\nRegex operators: . ^ $ [...] (...) | * + ? {n,m}; -F treats patterns literally.\nCase and word selection support ASCII patterns and subjects.\nUnicode selection and extended regex syntax require a configured executor.\n");
    }
    if let Some(vmode) = version_mode {
        if vmode == "long" {
            return ok_out("rg (safe-bash bounded implementation)\nRegex engine: bounded ASCII regular expressions and UTF-8 literals\nNative ripgrep revision, PCRE2 and SIMD capabilities are not reported by this implementation.\n");
        }
        return ok_out("rg (safe-bash bounded implementation)\n");
    }
    if !list_files_only && !has_explicit_pattern {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "rg: a search pattern is required\n".to_string(),
            exit_code: 2,
        };
    }
    if !list_files_only && pattern_files.iter().any(|f| f == "-") && targets.iter().any(|t| t == "-") {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "rg: cannot search stdin while also reading patterns from stdin\n".to_string(),
            exit_code: 2,
        };
    }
    let mut read_patterns_from_stdin = false;
    if !list_files_only {
        let pattern_error = |message: String| BuiltinOutcome {
            stdout: String::new(), stderr: if no_messages { String::new() } else { format!("rg: {message}\n") }, exit_code: 2,
        };
        for pf in &pattern_files {
            let bytes = if pf == "-" {
                read_patterns_from_stdin = true;
                let mut bytes = Vec::new();
                if let Err(e) = stdin.read_stdin(|chunk| { bytes.extend_from_slice(chunk); true }) {
                    return pattern_error(e);
                }
                bytes
            } else {
                let resolved = resolve_posix_path(cwd, pf);
                match fs.read_file(&resolved) {
                    Ok(bytes) => bytes,
                    Err(e) => return pattern_error(search_fs_error(&e, "readFile", &resolved)),
                }
            };
            let Ok(text) = std::str::from_utf8(bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&bytes)) else {
                return pattern_error(format!("pattern file '{pf}' is not UTF-8"));
            };
            patterns.extend(text.split_terminator('\n').map(|line| line.strip_suffix('\r').unwrap_or(line).to_owned()));
        }
    }
    if !use_ignore_files {
        custom_ignore_files.clear();
    } else if respect_ignore {
        for igf in &custom_ignore_files {
            let p = resolve_posix_path(cwd, igf);
            if fs.read_file(&p).is_err() {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: if no_messages {
                        String::new()
                    } else {
                        format!("rg: ENOENT: no such file or directory, readFile '{p}'\n")
                    },
                    exit_code: 2,
                };
            }
        }
    }


    let files = RgFiles { list_files_only, follow, globs, types, show_hidden, respect_ignore,
        no_ignore_vcs, no_ignore_dot, custom_ignore_files, max_depth, max_filesize };
    if list_files_only {
        let mut out = rg_stream::Output::new(write);
        let mut found = false;
        let mut failed = false;
        for input in files.inputs(&targets, cwd, fs, false) {
            let input = match input { Ok(i) => i, Err(e) => return out.abort(&e, no_messages) };
            let label = match input {
                SearchInput::Error(message) => {
                    failed = true;
                    out.report(&message, no_messages);
                    if !out.writable { break; }
                    continue;
                }
                SearchInput::Stdin => "<stdin>".to_owned(),
                SearchInput::File(label, _, _) => label,
            };
            found = true;
            if quiet || !out.put(&format!("{label}{}", if null_delim { '\0' } else { '\n' })) { break; }
        }
        if stats && out.writable { out.put(&rg_stats(0,0,0,0,0,0)); }
        out.result.exit_code = if !out.writable || !out.flush() || failed && !(found && quiet) { 2 } else { i32::from(!found) };
        return out.result;
    }

    if smart_case && !ignore_case {
        let has_upper = patterns.iter().any(|p| p.chars().any(|c| c.is_ascii_uppercase()));
        if !has_upper {
            ignore_case = true;
        }
    }

    let flags = RxFlags { icase: ignore_case, multiline, dotall: multiline_dotall, ..Default::default() };
    let mut parsed = Vec::with_capacity(patterns.len());
    let mut cross_line = false;
    let mut bounded_error = None;
    let mut requires_vm = binary == RgBinary::Text || replace.as_deref().is_some_and(|rep| rep.contains('$'));
    let multiline_whole = multiline && (!fixed_strings || patterns.iter().any(|pat| pat.contains('\n')));
    for pattern in &patterns {
        let mut branches = match parse_rx_branches(pattern, fixed_strings, RxDialect::Rg { flags, dot_nul: null_data || binary == RgBinary::Text }) {
            Ok(branches) => branches,
            Err(error) => return BuiltinOutcome { stdout: String::new(), stderr: format!("rg: {}\n", error.message), exit_code: 2 },
        };
        if line_regexp {
            for branch in &mut branches.root {
                branch.insert(0, RxToken { atom: if multiline_whole { RxAtom::LineBegin } else { RxAtom::Begin },
                    case: RxCase::Sensitive, min: 1, max: Some(1), lazy: false });
                branch.push(RxToken { atom: if multiline_whole { RxAtom::NewlineEnd { multiline: true } } else { RxAtom::End },
                    case: RxCase::Sensitive, min: 1, max: Some(1), lazy: false });
            }
        }
        bounded_error = bounded_error.or(branches.bounded_error);
        requires_vm |= branches.requires_vm;
        cross_line |= branches.cross_line;
        parsed.push(branches);
    }
    if !requires_vm && !(multiline && cross_line) && let Some((p, at)) = patterns.iter().find_map(|p| p.find('\0').map(|at| (p, at))) {
        let literal = fixed_strings || patterns.iter().all(|p| !p.bytes().any(|b| br"\.^$[]()|*+?{}".contains(&b)));
        let message = if literal {
            "bounded regex unsupported: rg literal patterns require non-NUL Unicode scalars for UTF-8".into()
        } else {
            format!("unsupported ERE profile at {}: expected non-NUL Unicode scalars", p[..at].encode_utf16().count())
        };
        return BuiltinOutcome { stdout: String::new(), stderr: if no_messages { String::new() } else { format!("rg: {message}\n") }, exit_code: 2 };
    }
    if !requires_vm && !(multiline && cross_line) && let Some((i, message)) = bounded_error {
        return BuiltinOutcome { stdout: String::new(),
            stderr: format!("rg: unsupported ERE profile at {}: {message}\n", i + 2 * usize::from(line_regexp)), exit_code: 2 };
    }
    let mut rx = ZeroRegex::from_branches(parsed, false, !line_regexp && word_regexp, false);
    rx.search = RxSearch::Rg { word_assertions: true, binary_text: binary == RgBinary::Text, empty_pattern: !line_regexp && patterns.len() == 1 && patterns[0].is_empty() };

    // The delegated matcher checks neighboring bytes for -w and anchors NUL-delimited
    // records as a whole. The scalar matcher uses explicit word and line assertions.
    let record_anchors = null_data && multiline && rx.branches.iter().any(|p|
        p.ops.iter().any(|op| matches!(op, RxOp::Atom(t) if matches!(t.atom, RxAtom::LineBegin | RxAtom::NewlineEnd { .. }))));
    let ascii_record_rx = if !requires_vm && !(multiline && cross_line) && (rx.word_regexp || record_anchors) {
        let mut record_rx = rx.clone();
        if let RxSearch::Rg { word_assertions, .. } = &mut record_rx.search { *word_assertions = false; }
        if record_anchors {
            for program in &mut record_rx.branches {
                for op in &mut program.ops {
                    if let RxOp::Atom(token) = op {
                        match token.atom {
                            RxAtom::LineBegin => token.atom = RxAtom::Begin,
                            RxAtom::NewlineEnd { .. } => token.atom = RxAtom::End,
                            _ => {}
                        }
                    }
                }
            }
        }
        Some(record_rx)
    } else { None };

    if read_patterns_from_stdin { stdin.file = None; }
    run_grep_engine(
        rx,
        targets,
        stdin,
        cwd,
        fs,
        GrepConfig {
            grep_input: GrepInput::Bytes,
            ascii_record_rx,
            invert,
            count_only,
            line_number,
            files_with_matches,
            files_without_match,
            only_matching,
            quiet,
            no_messages,
            no_filename,
            with_filename,
            max_count,
            before_ctx,
            after_ctx,
            binary,
            byte_offset,
            null_delim,
            null_data,
            json_output,
            replace,
            multiline: multiline && cross_line,
            show_column,
            ignore_binary: false,
            count_matches,
            include_zero,
            trim,
            heading,
            crlf,
            context_separator,
            initial_tab: false,
            stdin_label: None,
            files: SearchFiles::Rg(files),
            max_columns,
            stats,
        }, write,
    )
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RgBinary { Auto, Binary, Text }

#[derive(Clone, Copy, PartialEq, Eq)]
enum GrepInput<'a> { Bytes, PlainLiteral, Bounded(&'a str) }

struct GrepConfig<'a> {
    grep_input: GrepInput<'a>,
    ascii_record_rx: Option<ZeroRegex>,
    invert: bool,
    count_only: bool,
    line_number: bool,
    files_with_matches: bool,
    files_without_match: bool,
    only_matching: bool,
    quiet: bool,
    no_messages: bool,
    no_filename: bool,
    with_filename: bool,
    max_count: Option<usize>,
    before_ctx: usize,
    after_ctx: usize,
    binary: RgBinary,
    byte_offset: bool,
    null_delim: bool,
    null_data: bool,
    json_output: bool,
    replace: Option<String>,
    multiline: bool,
    show_column: bool,
    ignore_binary: bool,
    count_matches: bool,
    include_zero: bool,
    trim: bool,
    heading: bool,
    crlf: bool,
    context_separator: Option<String>,
    initial_tab: bool,
    stdin_label: Option<String>,
    files: SearchFiles<'a>,
    max_columns: Option<usize>,
    stats: bool,
}

fn is_ignored_by_rules(name: &str, is_dir: bool, rules: &[String]) -> bool {
    let mut ignored = false;
    for rule in rules {
        let r = rule.trim();
        if r.is_empty() || r.starts_with('#') {
            continue;
        }
        if let Some(neg) = r.strip_prefix('!') {
            let neg_clean = neg.trim_start_matches('/').trim_end_matches('/');
            if glob_match(neg_clean, name) {
                ignored = false;
            }
        } else if let Some(dir_pat) = r.strip_suffix('/') {
            if is_dir && glob_match(dir_pat.trim_start_matches('/'), name) {
                ignored = true;
            }
        } else {
            let pat = r.trim_start_matches('/');
            if glob_match(pat, name) {
                ignored = true;
            }
        }
    }
    ignored
}

fn eval_cli_globs(globs: &[String], base: &str, target: &str) -> Option<bool> {
    let mut result = None;
    for g in globs {
        let (icase, raw_g) = if let Some(rest) = g.strip_prefix("i:") {
            (true, rest)
        } else {
            (false, g.as_str())
        };
        if let Some(neg) = raw_g.strip_prefix('!') {
            let matched = if icase {
                glob_match(&neg.to_ascii_lowercase(), &base.to_ascii_lowercase())
                    || glob_match(&neg.to_ascii_lowercase(), &target.to_ascii_lowercase())
            } else {
                glob_match(neg, base) || glob_match(neg, target)
            };
            if matched {
                result = Some(false);
            }
        } else {
            let matched = if icase {
                glob_match(&raw_g.to_ascii_lowercase(), &base.to_ascii_lowercase())
                    || glob_match(&raw_g.to_ascii_lowercase(), &target.to_ascii_lowercase())
            } else {
                glob_match(raw_g, base) || glob_match(raw_g, target)
            };
            if matched {
                result = Some(true);
            }
        }
    }
    result
}

struct RgFiles {
    list_files_only: bool,
    follow: bool,
    globs: Vec<String>,
    types: rg_types::FileTypes,
    show_hidden: bool,
    respect_ignore: bool,
    max_depth: Option<usize>,
    max_filesize: Option<usize>,
    no_ignore_vcs: bool,
    no_ignore_dot: bool,
    custom_ignore_files: Vec<String>,
}

enum SearchFiles<'a> { Grep(GrepFiles<'a>), Rg(RgFiles) }

impl RgFiles {
    fn inputs<'a>(&'a self, targets: &[String], cwd: &'a str, fs: &'a dyn SafeBashFs, stdin: bool)
        -> impl Iterator<Item = Result<SearchInput, String>> + 'a {
        use std::rc::Rc;
        enum Visit { Entry(String, usize, Rc<Vec<String>>), Leave(String) }
        let mut rules = Vec::new();
        if self.respect_ignore {
            for file in &self.custom_ignore_files {
                if let Ok(bytes) = fs.read_file(&resolve_posix_path(cwd, file)) {
                    rules.extend(String::from_utf8_lossy(&bytes).lines().map(str::to_owned));
                }
            }
        }
        let rules = Rc::new(rules);
        let mut pending: Vec<_> = targets.iter().rev().map(|t| Visit::Entry(t.clone(), 0, rules.clone())).collect();
        let implicit = targets.is_empty();
        if implicit {
            pending.push(Visit::Entry(if stdin { "-" } else { "." }.into(), 0, rules));
        }
        let mut ancestors = BTreeMap::new();
        let positive_glob = self.globs.iter().any(|p| !p.strip_prefix("i:").unwrap_or(p).starts_with('!'));
        std::iter::from_fn(move || loop {
            let (label, depth, mut rules) = match pending.pop()? {
                Visit::Leave(path) => { ancestors.remove(&path); continue; }
                Visit::Entry(label, depth, rules) => (label, depth, rules),
            };
            let explicit = depth == 0;
            if explicit && label == "-" { return Some(Ok(SearchInput::Stdin)); }
            let path = search_path(cwd, &label);
            if explicit && fs.has_path_capabilities()
                && let Err(e) = fs.inspect_command_entry(&path, true, "capabilitiesFor")
                && !(e.starts_with("ENOENT:") || e.starts_with("ENOTDIR:")) {
                return Some(Err(format!("rg: {}\n", super::coreutils::stream_file_error(e, "capabilitiesFor", &path))));
            }
            // The production walker can recognize a regular file from the direct
            // memory directory index. Only the subsequent read consumes an operation.
            if explicit && !self.list_files_only && !path.ends_with('/') && path != "/dev" && !path.starts_with("/dev/")
                && fs.indexed_directory_entry(&path) == Some(true) && fs.lstat(&path).is_ok_and(|st| st.kind == VfsEntryKind::File) {
                return Some(Ok(SearchInput::File(label, path, true)));
            }
            let report = |e, op| {
                let message = format!("rg: {}\n", super::coreutils::stream_file_error(e, op, &path));
                Some(if message.starts_with("rg: Execution aborted:") { Err(message) } else { Ok(SearchInput::Error(message)) })
            };
            let (resolved, stat) = match fs.inspect_command_entry(&path, explicit || self.follow, "stat") {
                Ok(entry) => entry,
                Err(e) => return report(e, "stat"),
            };
            let directory = stat.kind == VfsEntryKind::Directory;
            if !explicit {
                if stat.kind == VfsEntryKind::Symlink { continue; }
                if directory && let Some(ancestor) = ancestors.get(&resolved) {
                    return Some(Ok(SearchInput::Error(format!("rg: File system loop found: {label} points to an ancestor {ancestor}\n"))));
                }
                let base = label.rsplit('/').next().unwrap_or("");
                match eval_cli_globs(&self.globs, base, label.strip_prefix("./").unwrap_or(&label)) {
                    Some(false) => continue,
                    Some(true) => {}
                    None => {
                        if !directory && positive_glob || self.respect_ignore && is_ignored_by_rules(base, directory, &rules) { continue; }
                        let selected = (!directory).then(|| self.types.selected(base)).flatten();
                        if !selected.unwrap_or_else(|| self.show_hidden || !base.starts_with('.')) { continue; }
                    }
                }
                if !directory && self.max_filesize.is_some_and(|max| stat.size > max) { continue; }
            }
            if !directory { return Some(Ok(SearchInput::File(label, resolved, explicit))); }
            if self.max_depth.is_some_and(|max| depth >= max) { continue; }
            let mut entries = match fs.read_dir(&resolved) {
                Ok(entries) => entries,
                Err(e) => return report(e, "readdir"),
            };
            entries.sort_unstable();
            if self.respect_ignore {
                for name in [".gitignore", ".ignore", ".rgignore"] {
                    if (name == ".gitignore" && self.no_ignore_vcs) || (name != ".gitignore" && self.no_ignore_dot)
                        || entries.binary_search_by(|e| e.as_str().cmp(name)).is_err() { continue; }
                    if let Ok(bytes) = fs.read_file(&resolve_posix_path(&resolved, name)) {
                        Rc::make_mut(&mut rules).extend(String::from_utf8_lossy(&bytes).lines().map(str::to_owned));
                    }
                }
            }
            ancestors.insert(resolved.clone(), label.clone());
            pending.push(Visit::Leave(resolved));
            let prefix = label.strip_suffix('/').unwrap_or(&label);
            pending.extend(entries.into_iter().rev().map(|child| Visit::Entry(
                if implicit && explicit { child } else { format!("{prefix}/{child}") }, depth + 1, rules.clone())));
        })
    }
}

enum SearchInput { Stdin, File(String, String, bool), Error(String) }

struct GrepFiles<'a> {
    name: &'a str,
    recursive: bool,
    rules: Vec<(String, bool)>,
    excluded_dirs: Vec<&'a str>,
    inspect: bool,
    skip_dirs: bool,
    skip_devices: bool,
    follow: bool,
}

fn search_path(cwd: &str, name: &str) -> String {
    if name.is_empty() || name.starts_with('/') { name.to_owned() }
    else { format!("{}/{name}", cwd.trim_end_matches('/')) }
}

fn search_fs_error(error: &str, op: &str, path: &str) -> String {
    if path.is_empty() { return "ENOENT: no such file or directory ''".into(); }
    if error.starts_with("ELOOP:") { return format!("ELOOP: too many symbolic links encountered '{path}'"); }
    let reason = error.split_once(", ").map_or(error, |(why, _)| why);
    format!("{reason}, {op} '{path}'")
}

fn rg_record_chunks<'a>(fs: &'a dyn SafeBashFs, entry: &str, path: String) -> Result<crate::vfs::ChunkReader<'a>, String> {
    if fs.has_path_capabilities() {
        super::coreutils::open_record_input(&path, "/", fs, false)
    } else {
        super::coreutils::record_chunks(fs, entry, path)
    }
}

fn read_memory_search_file(fs: &dyn SafeBashFs, path: &str) -> Result<Vec<u8>, String> {
    let limit = fs.max_input_bytes();
    let bytes = fs.open_read_file(path, false)?.read(0, limit.saturating_add(1))?;
    if bytes.len() > limit { return Err(fs.limit_error("maxInputBytes", limit)); }
    Ok(bytes)
}

fn read_search_file(fs: &dyn SafeBashFs, path: &str, op: &str) -> Result<Vec<u8>, String> {
    fs.access_path(path, true).and_then(|resolved| fs.read_file(&resolved))
        .map_err(|e| search_fs_error(&e, op, path))
}

impl GrepFiles<'_> {
    fn inputs<'a>(&'a self, targets: &'a [String], cwd: &'a str, fs: &'a dyn SafeBashFs)
        -> impl Iterator<Item = SearchInput> + 'a {
        enum Visit { Entry(String, bool), Leave(String) }
        let mut pending = targets.iter().rev().map(|t| Visit::Entry(t.clone(), true)).collect::<Vec<_>>();
        if pending.is_empty() { pending.push(Visit::Entry(if self.recursive { "." } else { "-" }.into(), true)); }
        let mut ancestors = std::collections::BTreeSet::new();
        let default_include = !self.rules.iter().any(|(_, include)| *include);
        std::iter::from_fn(move || loop {
            let (label, explicit) = match pending.pop()? {
                Visit::Leave(path) => { ancestors.remove(&path); continue; }
                Visit::Entry(label, explicit) => (label, explicit),
            };
            if label == "-" { return Some(SearchInput::Stdin); }
            let base = label.rsplit('/').next().unwrap_or("");
            let path = search_path(cwd, &label);
            if self.inspect {
                let follow = explicit || self.follow;
                let op = if follow { "stat" } else { "lstat" };
                let (resolved, st) = match fs.inspect_command_entry(&path, follow, op) {
                    Ok(entry) => entry,
                    Err(e) => return Some(SearchInput::Error(format!("{}: {}\n", self.name, search_fs_error(&e, op, &path)))),
                };
                if st.kind == VfsEntryKind::Symlink && !follow { continue; }
                if st.kind == VfsEntryKind::Directory {
                    if self.skip_dirs { continue; }
                    if self.recursive {
                        if self.excluded_dirs.iter().any(|p| glob_match(p, base)) { continue; }
                        if ancestors.contains(&resolved) {
                            return Some(SearchInput::Error(format!("{}: {label}: recursive directory loop\n", self.name)));
                        }
                        let children = match fs.read_dir(&resolved) {
                            Ok(children) => children,
                            Err(e) => return Some(SearchInput::Error(format!("{}: {}\n", self.name, search_fs_error(&e, "readdir", &path)))),
                        };
                        ancestors.insert(resolved.clone());
                        pending.push(Visit::Leave(resolved));
                        let prefix = label.strip_suffix('/').unwrap_or(&label);
                        pending.extend(children.into_iter().rev().map(|c| Visit::Entry(format!("{prefix}/{c}"), false)));
                        continue;
                    }
                    return Some(SearchInput::File(label, path, explicit));
                }
                if self.skip_devices && st.kind != VfsEntryKind::File { continue; }
            }
            if self.rules.iter().rev().find(|(pat, _)| glob_match(pat, base)).map_or(default_include, |(_, v)| *v) {
                return Some(SearchInput::File(label, path, explicit));
            }
        })
    }
}

fn match_spans(rx: &ZeroRegex, subject: &[u8], offset: usize, unterminated: bool, is_rg: bool, capture: bool,
    replacement: Option<&[RgReplacementPart]>, replacements: &mut BTreeMap<usize, Vec<u8>>) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    rx.scan(subject, capture, |s, e, caps| {
        if is_rg && s == e && (spans.last().is_some_and(|&(_, end)| end == s)
            || matches!(rx.search, RxSearch::Rg { empty_pattern: true, .. }) && s == subject.len() && unterminated) { return true; }
        if let Some(parts) = replacement {
            let mut expanded = Vec::new();
            for part in parts {
                expanded.extend_from_slice(match part {
                    RgReplacementPart::Literal(text) => text.as_bytes(),
                    RgReplacementPart::Match => &subject[s..e],
                    RgReplacementPart::Group(i) => caps.get(*i).copied().flatten().map_or(&[][..], |(lo, hi)| &subject[lo..hi]),
                });
            }
            replacements.insert(offset + s, expanded);
        }
        spans.push((s, e));
        true
    });
    spans
}

fn emit_search_text(cfg: &GrepConfig, out: &mut String, chunk: &[u8], selected: bool, count: usize, ending: usize, has_replacement: bool, rec_term: char) {
    let chunk = if cfg.trim {
        let start = chunk.iter().position(|b| *b != b' ' && !(9..=13).contains(b)).unwrap_or(chunk.len());
        &chunk[start..]
    } else { chunk };
    let piece = selected && cfg.only_matching && !cfg.invert;
    let omitted = cfg.max_columns.is_some_and(|n| n > 0 && chunk.len() + if piece { 0 } else { ending } > n);
    if omitted {
        if has_replacement && selected {
            out.push_str(&format!("[Omitted long line with {} matches]", if piece { 1 } else { count }));
        } else if selected { out.push_str("[Omitted long matching line]"); }
        else { out.push_str("[Omitted long context line]"); }
    } else { out.push_str(&bytes_to_stream_string(chunk)); }
    if cfg.crlf && !cfg.null_data && (piece || omitted) { out.push('\r'); }
    out.push(rec_term);
}

fn render_search_record(cfg: &GrepConfig, out: &mut String, line: &[u8], spans: &[(usize,usize)], base: usize, number: usize, ending: usize,
    selected: bool, filename: Option<&str>, is_rg: bool, has_replacement: bool, replacements: &BTreeMap<usize,Vec<u8>>, rec_term: char,
    mut finish_piece: impl FnMut(&mut String) -> bool) -> bool {
    let sep = if selected { ':' } else { '-' };
    let pieces = cfg.only_matching && !cfg.invert && selected;
    for i in 0..if pieces { spans.len() } else { 1 } {
        let piece = pieces.then(|| spans[i]);
        if !is_rg && piece.is_some_and(|(s,e)| s == e) { continue; }
        if let Some(f) = filename {
            out.push_str(f); out.push(if cfg.null_delim { '\0' } else { sep });
        }
        if cfg.line_number { out.push_str(&format!("{}{sep}", number)); }
        if cfg.show_column && let Some((start, _)) = piece.or_else(|| spans.first().copied()) {
            out.push_str(&format!("{}{sep}", start + 1));
        }
        if cfg.byte_offset { out.push_str(&format!("{}{sep}", base + piece.map_or(0, |p| p.0))); }
        if cfg.initial_tab && (filename.is_some() || cfg.line_number || cfg.byte_offset) { out.push('\t'); }
        let expanded;
        let text = if let Some((s, e)) = piece {
            replacements.get(&(base + s)).map_or(&line[s..e], Vec::as_slice)
        } else if has_replacement && selected {
            expanded = apply_rg_line_replace(line, base, spans, replacements);
            &expanded
        } else { line };
        emit_search_text(cfg, out, text, selected, spans.len(), ending, has_replacement, rec_term);
        if !finish_piece(out) { return false; }
    }
    true
}

fn rg_json_begin(escaped_path: &str) -> String {
    format!("{{\"type\":\"begin\",\"data\":{{\"path\":{{\"text\":\"{escaped_path}\"}}}}}}\n")
}

fn rg_json_record(escaped_path: &str, line: &[u8], ending: Option<u8>, line_no: usize, abs_off: usize, selected: bool, spans: &[(usize, usize)]) -> String {
    let line_data = if let Some(term) = ending {
        let mut raw = Vec::with_capacity(line.len() + 1);
        raw.extend_from_slice(line);
        raw.push(term);
        rg_json_data(&raw)
    } else { rg_json_data(line) };
    let event = if selected { "match" } else { "context" };
    let mut subs_json = String::new();
    for (si, &(s, e)) in spans.iter().enumerate() {
        if si > 0 { subs_json.push(','); }
        let mtxt = rg_json_data(&line[s..e]);
        subs_json.push_str(&format!(
            "{{\"match\":{mtxt},\"start\":{s},\"end\":{e}}}"
        ));
    }
    format!(
        "{{\"type\":\"{event}\",\"data\":{{\"path\":{{\"text\":\"{escaped_path}\"}},\"lines\":{line_data},\"line_number\":{line_no},\"absolute_offset\":{abs_off},\"submatches\":[{subs_json}]}}}}\n"
    )
}

fn rg_json_end(escaped_path: &str, binary: Option<usize>, file_searched: usize, file_printed: usize, matched_count: usize, file_submatch_count: usize) -> String {
    let binary_offset = binary.map_or_else(|| "null".to_owned(), |off| off.to_string());
    format!("{{\"type\":\"end\",\"data\":{{\"path\":{{\"text\":\"{escaped_path}\"}},\"binary_offset\":{binary_offset},\"stats\":{{\"elapsed\":{{\"secs\":0,\"nanos\":0,\"human\":\"0.000000s\"}},\"searches\":1,\"searches_with_match\":1,\"bytes_searched\":{file_searched},\"bytes_printed\":{file_printed},\"matched_lines\":{matched_count},\"matches\":{file_submatch_count}}}}}}}\n")
}

fn rg_json_summary(json_bytes_printed: usize, bytes_searched: usize, total_matched_lines: usize, total_matches: usize, searches: usize, searches_with_match: usize) -> String {
    format!("{{\"data\":{{\"elapsed_total\":{{\"human\":\"0.000000s\",\"nanos\":0,\"secs\":0}},\"stats\":{{\"bytes_printed\":{json_bytes_printed},\"bytes_searched\":{bytes_searched},\"elapsed\":{{\"human\":\"0.000000s\",\"nanos\":0,\"secs\":0}},\"matched_lines\":{total_matched_lines},\"matches\":{total_matches},\"searches\":{searches},\"searches_with_match\":{searches_with_match}}}}},\"type\":\"summary\"}}\n")
}

fn rg_stats(total_matches: usize, total_matched_lines: usize, searches_with_match: usize, searches: usize, bytes_printed: usize, bytes_searched: usize) -> String {
    format!(
        "\n{total_matches} matches\n{total_matched_lines} matched lines\n{searches_with_match} files contained matches\n{searches} files searched\n{bytes_printed} bytes printed\n{bytes_searched} bytes searched\n0.000000 seconds spent searching\n0.000000 seconds total\n"
    )
}

fn run_grep_engine(
    rx: ZeroRegex,
    targets: Vec<String>,
    mut stdin: CommandInput,
    cwd: &str,
    fs: &dyn SafeBashFs,
    cfg: GrepConfig<'_>,
    write: &mut CommandWriter,
) -> BuiltinOutcome {
    let replacement = cfg.replace.as_deref()
        .filter(|_| !(cfg.count_only || cfg.quiet || cfg.json_output || cfg.files_with_matches || cfg.files_without_match || cfg.invert))
        .map(|rep| parse_rg_replacement(rep, &rx.capture_names));
    let capture = replacement.iter().flatten().any(|part| matches!(part, RgReplacementPart::Group(_)));

    let is_rg = matches!(&cfg.files, SearchFiles::Rg(_));
    if is_rg && cfg.max_count == Some(0) {
        return BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 1 };
    }
    let mut err = String::new();
    let mut had_error = false;
    let stdin_label = cfg.stdin_label.as_deref().unwrap_or(if is_rg { "<stdin>" } else { "(standard input)" });
    let multiple_files = targets.len() > 1;
    let inputs: Box<dyn Iterator<Item = Result<SearchInput, String>> + '_> = match &cfg.files {
        SearchFiles::Grep(files) => Box::new(files.inputs(&targets, cwd, fs).map(Ok)),
        SearchFiles::Rg(files) => Box::new(files.inputs(&targets, cwd, fs, stdin.file.is_some() || !stdin.text.is_empty())),
    };

    if is_rg && !cfg.multiline {
        return rg_stream::lines(&cfg, &rx, inputs, multiple_files, stdin, fs, cwd, replacement.as_deref(), capture, write);
    }
    let mut stream = rg_stream::Output::new(write);
    let mut out = String::new();
    let mut any_match = false;
    let mut total_matches = 0usize;
    let mut total_matched_lines = 0usize;
    let mut searches_with_match = 0usize;

    let rec_term = if cfg.null_data { '\0' } else { '\n' };
    let multiline = cfg.multiline;
    let mut searches = 0;
    let mut bytes_searched = 0;
    let mut json_bytes_printed = 0;
    let mut failed_batch = false;
    let mut last_label = None::<String>;
    let mut last_line = 0;
    let mut headings = std::collections::BTreeSet::new();
    'inputs: for input in inputs {
        if failed_batch { break; }
        let mut matched_count = 0usize;
        let mut read_failed = false;
        let mut chunk_ends = Vec::new();
        let output_start = stream.total;
        let input = match input { Ok(i) => i, Err(e) => return stream.abort(&e, cfg.no_messages) };
        let (fname, content, explicit) = match input {
            SearchInput::Stdin => {
                let mut bytes = Vec::new();
                let presence_only = !multiline && !cfg.stats && !cfg.json_output
                    && (cfg.quiet || cfg.files_with_matches || cfg.files_without_match);
                let binary_delimiter = is_rg && !cfg.null_data && cfg.binary != RgBinary::Text;
                let delimiter = |b| b == rec_term as u8 || binary_delimiter && b == 0;
                let selected = |line: &[u8]| {
                    let matcher = cfg.ascii_record_rx.as_ref().filter(|_| line.is_ascii() && !line.contains(&0)).unwrap_or(&rx);
                    let subject = if cfg.crlf { line.strip_suffix(b"\r").unwrap_or(line) } else { line };
                    matcher.scan(subject, false, |_, _, _| false) != cfg.invert
                };
                let result = if cfg.max_count == Some(0) { Ok(()) } else if presence_only {
                    stdin.read_stdin_records(delimiter, |line| {
                        if cfg.ignore_binary && line.contains(&0) { return false; }
                        if let GrepInput::Bounded(name) = cfg.grep_input && (line.contains(&0) || std::str::from_utf8(line).is_err()) {
                            err.push_str(&format!("{name}: bounded regex unsupported: literal patterns and subjects require valid non-NUL UTF-8 bytes\n"));
                            failed_batch = true;
                            return false;
                        }
                        matched_count = usize::from(selected(line));
                        matched_count == 0
                    })
                } else if let Some(limit) = cfg.max_count && !multiline && stdin.file.is_some() {
                    let display = !(cfg.count_only || cfg.quiet || cfg.files_with_matches || cfg.files_without_match);
                    let mut after = if display && (is_rg || !(cfg.only_matching && cfg.invert)) { cfg.after_ctx } else { 0 };
                    let (mut start, mut hits) = (0, 0);
                    stdin.read_stdin(|chunk| {
                        let base = bytes.len();
                        bytes.extend_from_slice(chunk);
                        for (i, _) in chunk.iter().enumerate().filter(|(_, b)| delimiter(**b)) {
                            let line = &bytes[start..base + i];
                            start = base + i + 1;
                            if cfg.ignore_binary && line.contains(&0) || matches!(cfg.grep_input, GrepInput::Bounded(_))
                                && (line.contains(&0) || std::str::from_utf8(line).is_err()) { return false; }
                            if hits == limit { after -= 1; }
                            else if selected(line) { hits += 1; }
                            if hits == limit && after == 0 {
                                return false;
                            }
                        }
                        true
                    })
                } else if matches!(cfg.grep_input, GrepInput::Bounded(_)) {
                    let mut start = 0;
                    stdin.read_stdin(|chunk| {
                        let base = bytes.len();
                        bytes.extend_from_slice(chunk);
                        for (i, _) in chunk.iter().enumerate().filter(|(_, b)| delimiter(**b)) {
                            let end = base + i;
                            let line = &bytes[start..end];
                            start = end + 1;
                            if line.contains(&0) || std::str::from_utf8(line).is_err() {
                                bytes.truncate(start);
                                return false;
                            }
                        }
                        if start > base { chunk_ends.push(start); }
                        true
                    })
                } else { stdin.append_bytes(&mut bytes) };
                if failed_batch { had_error = true; break; }
                if let Err(e) = result {
                    had_error = true;
                    if is_rg {
                        if e.starts_with("Execution aborted:") { stream.writable = false; break; }
                        stream.report(&format!("rg: {e}\n"), cfg.no_messages);
                        if !stream.writable { break; }
                    } else if let SearchFiles::Grep(g) = &cfg.files && !cfg.no_messages {
                        err.push_str(&format!("{}: {e}\n", g.name));
                    }
                    if cfg.count_only || cfg.files_with_matches || cfg.files_without_match || cfg.quiet || multiline { continue; }
                    read_failed = true;
                    // A failed pull does not terminate a partial record.
                    bytes.truncate(bytes.iter().rposition(|&b| delimiter(b)).map_or(0, |i| i + 1));
                }
                (Some(stdin_label), bytes, true)
            }
            SearchInput::File(ref label, ref path, explicit) => {
                let bytes = if let SearchFiles::Grep(files) = &cfg.files {
                    let fast = matches!(cfg.grep_input, GrepInput::PlainLiteral);
                    let op = if fast && path != "/dev" && !path.starts_with("/dev/") { "readFile" } else { "readStream" };
                    if cfg.max_count == Some(0) && !label.is_empty() {
                        Vec::new()
                    } else {
                        let read = if fast && op == "readFile" && fs.supplies_single_chunk_input() {
                            read_memory_search_file(fs, path).map_err(|e| search_fs_error(&e, op, path))
                        } else { read_search_file(fs, path, op) };
                        match read {
                            Ok(bytes) => bytes,
                            Err(e) => {
                                had_error = true;
                                if !cfg.no_messages { err.push_str(&format!("{}: {e}\n", files.name)); }
                                continue;
                            }
                        }
                    }
                } else {
                    // Cross-line matching needs the complete operand. Use the same
                    // bounded streaming read as the record matcher.
                    let read = (|| {
                        let mut reader = rg_record_chunks(fs, path, search_path(cwd, label))?;
                        let (mut bytes, mut chunk) = (Vec::new(), Vec::new());
                        loop {
                            reader(&mut chunk)?;
                            if chunk.is_empty() { return Ok::<_,String>(bytes); }
                            bytes.extend_from_slice(&chunk);
                        }
                    })();
                    match read {
                        Ok(bytes) => bytes,
                        Err(e) => {
                            if e.starts_with("Execution aborted:") { stream.writable = false; break; }
                            had_error = true;
                            stream.report(&format!("rg: {e}\n"), cfg.no_messages);
                            if !stream.writable { break; }
                            continue;
                        }
                    }
                };
                (Some(label.as_str()), bytes, explicit)
            }
            SearchInput::Error(message) => {
                had_error = true;
                if is_rg {
                    stream.report(&message, cfg.no_messages);
                    if !stream.writable { break; }
                } else if !cfg.no_messages { err.push_str(&message); }
                continue;
            }
        };
        let show_filename = !cfg.no_filename && (cfg.with_filename || multiple_files || !explicit);
        let nul_off = if !is_rg || cfg.null_data || cfg.binary == RgBinary::Text { None } else { content.iter().position(|&b| b == 0) };
        searches += usize::from(!read_failed);
        if nul_off.is_some() && is_rg && cfg.binary == RgBinary::Auto && !explicit {
            continue;
        }
        let mut file_searched = content.len();
        let mut line_offsets = Vec::new();
        let mut offset = 0;
        let binary_records = is_rg && nul_off.is_some();
        let delimiter = |c: &u8| *c == rec_term as u8 || binary_records && *c == 0;
        let lines: Vec<_> = content.split_inclusive(delimiter).map(|record| {
            line_offsets.push(offset);
            offset += record.len();
            if record.last().is_some_and(delimiter) { &record[..record.len()-1] } else { record }
        }).collect();
        let mut match_indices: Vec<(usize, Vec<(usize, usize)>)> = Vec::new();
        let mut multiline_spans: Vec<(usize, usize, usize, usize)> = Vec::new();
        let mut file_submatch_count = 0usize;

        let mut replacements = BTreeMap::new();
        let mut find_spans = |rx: &ZeroRegex, subject: &[u8], offset: usize| {
            match_spans(rx, subject, offset, offset + subject.len() == content.len() && !content.ends_with(&[rec_term as u8]),
                is_rg, capture, replacement.as_deref(), &mut replacements)
        };
        let limit = cfg.max_count.unwrap_or(usize::MAX);
        let whole_matches = !binary_records && multiline && replacement.is_none() && !cfg.invert && cfg.only_matching && !cfg.count_only && !cfg.json_output;
        let lf_offsets;
        let source_lines = if whole_matches && is_rg && cfg.null_data {
            lf_offsets = std::iter::once(0).chain(content.iter().enumerate().filter_map(|(i, &b)| (b == b'\n').then_some(i + 1))).collect::<Vec<_>>();
            &lf_offsets
        } else { &line_offsets };
        let mut print_end = lines.len();
        let mut skipped_binary = false;
        let mut context_matches = BTreeMap::new();
        if multiline {
            let mut block_end = None;
            let mut blocks = 0;
            for (s, e) in find_spans(&rx, &content, 0) {
                if whole_matches && is_rg {
                    let first = source_lines.partition_point(|&off| off <= s).saturating_sub(1);
                    let last = source_lines.partition_point(|&off| off <= s.max(e.saturating_sub(1))).saturating_sub(1);
                    if matched_count >= limit && block_end.is_none_or(|end| first > end) { break; }
                    matched_count += (last + 1).saturating_sub(first.max(block_end.map_or(0, |end| end + 1)));
                    block_end = Some(last);
                    multiline_spans.push((first, last, s, e));
                    continue;
                }
                if lines.is_empty() || (s == content.len() && content.ends_with(&[rec_term as u8])) { continue; }
                let first = line_offsets.partition_point(|&off| off <= s) - 1;
                let last = line_offsets.partition_point(|&off| off <= s.max(e.saturating_sub(1))) - 1;
                if block_end.is_none_or(|end| first > end) {
                    if limit == 0 || first >= print_end || whole_matches && match_indices.len() >= limit { break; }
                    blocks += 1;
                    if replacement.is_some() && blocks == limit {
                        print_end = (last + 1).saturating_add(cfg.after_ctx);
                    } else if replacement.is_some() && blocks > limit {
                        // A trailing context record may itself span several source lines.
                        print_end = print_end.saturating_add(last - first);
                    }
                } else if replacement.is_some() && blocks >= limit {
                    print_end = print_end.saturating_add(last - block_end.unwrap());
                }
                block_end = Some(last);
                for idx in first..=last {
                    let span = (s.saturating_sub(line_offsets[idx]).min(lines[idx].len()),
                                e.saturating_sub(line_offsets[idx]).min(lines[idx].len()));
                    if let Some((prev, spans)) = match_indices.last_mut()
                        && *prev == idx {
                        spans.push(span);
                    } else {
                        match_indices.push((idx, vec![span]));
                    }
                }
                multiline_spans.push((first, last, s, e));
            }
        }
        if multiline && (replacement.is_some() || whole_matches) {
            if !(whole_matches && is_rg) { matched_count = match_indices.len(); }
            file_submatch_count = multiline_spans.len();
        } else {
            let mut projected = std::mem::take(&mut match_indices).into_iter().peekable();
            let trailing = is_rg && !cfg.count_only && !cfg.quiet && !cfg.files_with_matches && !cfg.files_without_match;
            let mut batch_end = 0;
            let mut batch_rx = &rx;
            for (idx, line) in lines.iter().enumerate() {
                if idx >= print_end || limit == 0 { break; }
                if matches!(cfg.grep_input, GrepInput::PlainLiteral) && (line.contains(&0) || std::str::from_utf8(line).is_err()) {
                    had_error = true;
                    if !cfg.no_messages { err.push_str("grep: bounded regex unsupported: literal patterns and subjects require valid non-NUL UTF-8 bytes\n"); }
                    break;
                }
                if binary_records && line_offsets[idx] > 0 && trailing && !cfg.json_output && (matched_count > 0 || cfg.before_ctx > 0) {
                    file_searched = line_offsets[idx];
                    break;
                }
                let spans = if multiline {
                    projected.next_if(|(i, _)| *i == idx).map(|(_, spans)| spans).unwrap_or_default()
                } else {
                    let subject = if cfg.crlf { line.strip_suffix(b"\r").unwrap_or(line) } else { line };
                    if idx == batch_end && (cfg.ascii_record_rx.is_some() || matches!(cfg.grep_input, GrepInput::Bounded(_)) || cfg.ignore_binary) {
                        // Production dispatches whole batches to the UTF-8 matcher if any record needs it.
                        let batch_size = if cfg.max_count.is_some() || cfg.quiet && !cfg.json_output || cfg.files_with_matches
                            || cfg.files_without_match || binary_records && trailing && !cfg.json_output { 1 } else { 128 };
                        batch_end = idx + 1;
                        let mut bytes = line.len();
                        let next_chunk = chunk_ends.partition_point(|&end| end <= line_offsets[idx]);
                        let end = chunk_ends.get(next_chunk).copied().unwrap_or(usize::MAX);
                        while batch_end < lines.len() && batch_end - idx < batch_size
                            && line_offsets[batch_end] < end && bytes < 65536 && bytes + lines[batch_end].len() <= 65536
                            && (batch_end + 1 < lines.len() || content.ends_with(&[rec_term as u8])) {
                            bytes += lines[batch_end].len();
                            batch_end += 1;
                        }
                        let batch = &lines[idx..batch_end];
                        if cfg.ignore_binary && batch.iter().any(|row| row.contains(&0)) {
                            skipped_binary = true;
                            print_end = idx;
                            break;
                        }
                        if let GrepInput::Bounded(name) = cfg.grep_input && batch.iter().any(|row| row.contains(&0) || std::str::from_utf8(row).is_err()) {
                            err.push_str(&format!("{name}: bounded regex unsupported: literal patterns and subjects require valid non-NUL UTF-8 bytes\n"));
                            failed_batch = true;
                            had_error = true;
                            print_end = idx;
                            break;
                        }
                        if let Some(record_rx) = &cfg.ascii_record_rx {
                            batch_rx = if batch.iter().all(|row| row.is_ascii() && !row.contains(&0)) { record_rx } else { &rx };
                        }
                    }
                    find_spans(batch_rx, subject, line_offsets[idx])
                };
                if !is_rg && matched_count >= limit { continue; }
                let inverted_tail = trailing && cfg.invert && matched_count >= limit && idx + 1 == lines.len() && !content.ends_with(&[rec_term as u8]);
                if (spans.is_empty() == cfg.invert) || inverted_tail {
                    if !multiline { file_submatch_count += spans.len(); }
                    match_indices.push((idx, spans));
                    matched_count += 1;
                    if matched_count == limit {
                        if !trailing && (is_rg || cfg.after_ctx == 0 || cfg.count_only || cfg.quiet || cfg.files_with_matches || cfg.files_without_match) { break; }
                        print_end = (idx + 1).saturating_add(cfg.after_ctx).min(lines.len());
                    }
                    if cfg.quiet && !cfg.stats && !cfg.json_output || !is_rg && (cfg.files_with_matches || cfg.files_without_match) { break; }
                } else if cfg.invert && (cfg.show_column || cfg.json_output) && (cfg.before_ctx > 0 || cfg.after_ctx > 0) {
                    context_matches.insert(idx, spans);
                }
            }
            if multiline && !cfg.invert && let Some((last, _)) = match_indices.last() {
                file_submatch_count = multiline_spans.partition_point(|m| m.0 <= *last);
            }
        }

        let found = if is_rg && cfg.files_without_match { matched_count == 0 } else { matched_count > 0 };
        any_match |= found;
        if failed_batch && (cfg.count_only || cfg.files_with_matches || cfg.files_without_match || cfg.quiet) { break; }
        if skipped_binary { matched_count = 0; }
        if cfg.quiet && !cfg.stats && !cfg.json_output {
            if found && is_rg { break; }
            if found { return BuiltinOutcome { stdout: String::new(), stderr: err, exit_code: 0 }; }
            continue;
        }
        if matched_count > 0 && !read_failed {
            searches_with_match += 1;
            total_matched_lines += matched_count;
            total_matches += file_submatch_count;
        }

        if (cfg.stats || cfg.json_output) && !whole_matches {
            let selected_output = !cfg.quiet && !cfg.count_only && !cfg.files_with_matches && !cfg.files_without_match;
            if let Some((limited, _)) = match_indices.get(limit - 1) {
                let stop = limited.saturating_add(if selected_output { cfg.after_ctx } else { 0 });
                if stop < lines.len() {
                    let last = match_indices.last().unwrap().0;
                    let last_selected_end = line_offsets.get(last + 1).copied().unwrap_or(content.len());
                    let stop_offset = if cfg.invert || line_offsets[stop] + lines[stop].len() == content.len() { line_offsets[stop] } else { 0 };
                    file_searched = file_searched.min(last_selected_end.max(stop_offset));
                }
            }
        }
        if !read_failed { bytes_searched += file_searched; }
        if cfg.json_output {
            if matched_count == 0 || cfg.quiet { continue; }
            let path_text = fname.unwrap_or("<stdin>");
            let escaped_path = json_escape_str(path_text);
            if !stream.put(&rg_json_begin(&escaped_path)) { break; }
            let mut printed = vec![false; lines.len()];
            for (idx, _) in &match_indices {
                let start = idx.saturating_sub(cfg.before_ctx);
                let end = (idx + 1).saturating_add(cfg.after_ctx).min(lines.len());
                for p in start..end {
                    printed[p] = true;
                }
            }
            let match_map: std::collections::BTreeMap<usize, &Vec<(usize, usize)>> =
                match_indices.iter().map(|(i, m)| (*i, m)).collect();
            for (idx, should_print) in printed.iter().take(print_end).enumerate() {
                if !*should_print {
                    continue;
                }
                let end = line_offsets.get(idx + 1).copied().unwrap_or(content.len());
                let selected = match_map.contains_key(&idx);
                let spans = match_map.get(&idx).copied().or_else(|| context_matches.get(&idx)).map_or(&[][..], Vec::as_slice);
                let line = lines[idx];
                let ending = (end - line_offsets[idx] > line.len()).then_some(rec_term as u8);
                if !stream.put(&rg_json_record(&escaped_path, line, ending, idx + 1, line_offsets[idx], selected, spans)) { break 'inputs; }
            }
            if read_failed { continue; }
            let file_printed = stream.total - output_start;
            json_bytes_printed += file_printed;
            if !stream.put(&rg_json_end(&escaped_path, nul_off, file_searched, file_printed, matched_count, file_submatch_count)) { break; }
            continue;
        }

        if cfg.quiet { continue; }
        if let Some(off) = nul_off && !cfg.files_with_matches && !cfg.files_without_match && !cfg.count_only {
            let prefix = fname.filter(|_| show_filename).map(|f| format!("{f}: ")).unwrap_or_default();
            if matched_count > 0 && !stream.put(&format!("{prefix}binary file matches (found \"\\0\" byte around offset {off})\n")) { break; }
            continue;
        }

        let file_sep = if cfg.null_delim { '\0' } else { '\n' };
        let finish_piece = |piece: &mut String, stream: &mut rg_stream::Output| {
            if !is_rg { return true; }
            let writable = stream.put(piece);
            piece.clear();
            writable
        };
        if cfg.files_with_matches || cfg.files_without_match {
            if (matched_count > 0) == cfg.files_with_matches && let Some(f) = fname {
                out.push_str(f);
                out.push(file_sep);
                if !finish_piece(&mut out, &mut stream) { break; }
            }
            continue;
        }
        if cfg.count_only {
            let count_val = if !cfg.invert && (cfg.count_matches || is_rg && (cfg.only_matching || multiline)) {
                file_submatch_count
            } else {
                matched_count
            };
            if is_rg && count_val == 0 && !cfg.include_zero {
                continue;
            }
            let count_end = if is_rg { '\n' } else { rec_term };
            if show_filename {
                if let Some(f) = fname {
                    let fsep = if cfg.null_delim { '\0' } else { ':' };
                    out.push_str(&format!("{f}{fsep}{count_val}{count_end}"));
                    if !finish_piece(&mut out, &mut stream) { break; }
                    continue;
                }
            }
            out.push_str(&format!("{count_val}{count_end}"));
            if !finish_piece(&mut out, &mut stream) { break; }
            continue;
        }

        let use_heading = cfg.heading && show_filename;
        let context = cfg.before_ctx > 0 || cfg.after_ctx > 0;
        let label = fname.unwrap_or(stdin_label);
        let mut first_record = true;
        let mut start_record = |out: &mut String, stream: &mut rg_stream::Output, first: usize, last: usize| {
            if !context && !use_heading { return true; }
            if first_record && use_heading && !headings.contains(label) {
                if !headings.is_empty() {
                    out.push('\n');
                    if !finish_piece(out, stream) { return false; }
                }
                out.push_str(label);
                out.push(if cfg.null_delim { '\0' } else { '\n' });
                if !finish_piece(out, stream) { return false; }
                headings.insert(label.to_owned());
            } else if context && last_label.as_deref().is_some_and(|previous|
                previous != label || (!is_rg && first_record) || first > last_line + 1)
                && let Some(sep) = &cfg.context_separator {
                out.push_str(sep);
                out.push(if is_rg { '\n' } else { rec_term });
                if !finish_piece(out, stream) { return false; }
            }
            if first_record && last_label.as_deref() != Some(label) { last_label = Some(label.to_owned()); }
            first_record = false;
            last_line = last;
            true
        };
        let line_show_filename = show_filename && !use_heading;

        let emit_text = |out: &mut String, chunk: &[u8], selected, count: usize, ending| {
            emit_search_text(&cfg, out, chunk, selected, count, ending, replacement.is_some(), rec_term)
        };

        if multiline && replacement.is_some() {
            // Adjacent selected records share one replacement buffer. Context keeps
            // its original coordinates even if a replacement changes the line count.
            let mut at = 0;
            let mut previous_end: Option<usize> = None;
            let mut idx = 0;
            let mut blocks = 0;
            while idx < lines.len().min(print_end) {
                let start = at;
                let mut last = idx;
                while at < multiline_spans.len() && multiline_spans[at].0 <= last + usize::from(at > start && blocks < limit) {
                    if at == start || multiline_spans[at].0 > last { blocks += 1; }
                    last = multiline_spans[at].1;
                    at += 1;
                }
                let spans = &multiline_spans[start..at];
                let selected = !spans.is_empty();
                if selected { previous_end = Some(last); }
                if !selected && !(previous_end.is_some_and(|end| idx - end <= cfg.after_ctx)
                    || multiline_spans.get(at).is_some_and(|m| m.0 - idx <= cfg.before_ctx)) {
                    idx += 1;
                    continue;
                }
                if !start_record(&mut out, &mut stream, idx, last) { break 'inputs; }
                let base = line_offsets[idx];
                let sep = if selected { ':' } else { '-' };
                let mut emit = |chunk: &[u8], line, column, byte, ending: usize| {
                    if line_show_filename && let Some(f) = fname {
                        out.push_str(f); out.push(if cfg.null_delim { '\0' } else { sep });
                    }
                    if cfg.line_number { out.push_str(&format!("{line}{sep}")); }
                    if cfg.show_column && selected { out.push_str(&format!("{column}{sep}")); }
                    if cfg.byte_offset { out.push_str(&format!("{byte}{sep}")); }
                    if cfg.initial_tab && (line_show_filename || cfg.line_number || cfg.byte_offset) { out.push('\t'); }
                    emit_text(&mut out, chunk, selected, spans.len(), ending);
                    finish_piece(&mut out, &mut stream)
                };
                if !selected {
                    if !emit(lines[idx], idx + 1, 0, base, 1) { break 'inputs; }
                } else if cfg.only_matching {
                    let mut cursor = base;
                    let mut expanded_offset = 0;
                    let mut number = idx + 1;
                    for &(_, _, s, e) in spans {
                        number += content[cursor..s].iter().filter(|&&b| b == rec_term as u8).count();
                        expanded_offset += s - cursor;
                        let rendered = &replacements[&s];
                        for chunk in rendered.split_inclusive(|&b| b == rec_term as u8) {
                            let text = chunk.strip_suffix(&[rec_term as u8]).unwrap_or(chunk);
                            if !text.is_empty() && !emit(text, number, expanded_offset + 1, base + expanded_offset, 0) { break 'inputs; }
                            number += usize::from(chunk.ends_with(&[rec_term as u8]));
                        }
                        cursor = e;
                        expanded_offset += rendered.len();
                    }
                } else {
                    let end = line_offsets.get(last + 1).copied().unwrap_or(content.len());
                    let relative: Vec<_> = spans.iter().map(|&(_, _, s, e)| (s - base, e - base)).collect();
                    let rendered = apply_rg_line_replace(&content[base..end], base, &relative, &replacements);
                    let column = relative[0].0 + 1;
                    let mut byte = base;
                    if rendered.is_empty() && !emit(b"", idx + 1, column, base, 0) { break 'inputs; }
                    for (i, chunk) in rendered.split_inclusive(|&b| b == rec_term as u8).enumerate() {
                        let text = chunk.strip_suffix(&[rec_term as u8]).unwrap_or(chunk);
                        if !emit(text, idx + 1 + i, column, byte, chunk.len() - text.len()) { break 'inputs; }
                        byte += chunk.len();
                    }
                }
                idx = last + 1;
            }
            continue;
        }

        if multiline && cfg.only_matching && !cfg.invert {
            for &(fl, ll, s, e) in &multiline_spans {
                let rendered = &content[s..e];
                let line_start = source_lines.get(fl).copied().unwrap_or(0);
                let number = fl + 1 + if is_rg && cfg.null_data {
                    line_offsets.partition_point(|&off| off <= s) - line_offsets.partition_point(|&off| off <= line_start)
                } else { 0 };
                if !start_record(&mut out, &mut stream, number - 1, number - 1 + ll - fl) { break 'inputs; }
                for (chunk_idx, chunk) in rendered.split(|&b| b == rec_term as u8).enumerate() {
                    if chunk.is_empty() {
                        continue;
                    }
                    if line_show_filename {
                        if let Some(f) = fname {
                            let fsep = if cfg.null_delim { '\0' } else { ':' };
                            out.push_str(&format!("{f}{fsep}"));
                        }
                    }
                    if cfg.line_number {
                        out.push_str(&format!("{}:", number + chunk_idx));
                    }
                    if cfg.show_column { out.push_str(&format!("{}:", s - line_start + 1)); }
                    if cfg.byte_offset {
                        out.push_str(&format!("{s}:"));
                    }
                    if cfg.initial_tab && (line_show_filename || cfg.line_number || cfg.byte_offset) {
                        out.push('\t');
                    }
                    emit_text(&mut out, chunk, true, 1, 0);
                    if !finish_piece(&mut out, &mut stream) { break 'inputs; }
                }
            }
            if whole_matches && is_rg && !stream.flush() { break; }
            continue;
        }

        if !is_rg && cfg.only_matching && cfg.invert { continue; }
        let mut selected = match_indices.iter().peekable();
        let mut previous_match = None;
        for (idx, &line) in lines.iter().take(print_end).enumerate() {
            let matched = selected.next_if(|(i, _)| *i == idx);
            if matched.is_some() { previous_match = Some(idx); }
            else if !context || !(previous_match.is_some_and(|i| idx - i <= cfg.after_ctx)
                || selected.peek().is_some_and(|(i, _)| i - idx <= cfg.before_ctx)) { continue; }
            if !start_record(&mut out, &mut stream, idx, idx) { break 'inputs; }
            if !is_rg && cfg.only_matching && matched.is_none() { continue; }
            let spans = matched.map(|(_, spans)| spans).or_else(|| context_matches.get(&idx)).map_or(&[][..], Vec::as_slice);
            let base = line_offsets[idx];
            let ending = line_offsets.get(idx + 1).copied().unwrap_or(content.len()) - base - line.len();
            if !render_search_record(&cfg, &mut out, line, spans, base, idx + 1, ending, matched.is_some(), fname.filter(|_| line_show_filename),
                is_rg, replacement.is_some(), &replacements, rec_term, |piece| finish_piece(piece, &mut stream)) { break 'inputs; }
        }
    }

    if stream.writable && cfg.json_output {
        stream.put(&rg_json_summary(json_bytes_printed, bytes_searched, total_matched_lines, total_matches, searches, searches_with_match));
    } else if stream.writable && cfg.stats {
        let bytes_printed = if cfg.count_only || cfg.files_with_matches || cfg.files_without_match { 0 }
            else { stream.total };
        stream.put(&rg_stats(total_matches, total_matched_lines, searches_with_match, searches, bytes_printed, bytes_searched));
    }

    let exit_code = if had_error && !(is_rg && cfg.quiet && any_match) {
        2
    } else if any_match {
        0
    } else {
        1
    };

    if is_rg {
        stream.result.exit_code = if stream.writable && stream.flush() { exit_code } else { 2 };
        return stream.result;
    }
    BuiltinOutcome {
        stdout: out,
        stderr: err,
        exit_code,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FindFollowMode {
    Never,
    RootsOnly,
    Always,
}

#[derive(Clone)]
enum FindPred {
    True,
    False,
    Depth,
    MaxDepth,
    MinDepth,
    Name { pat: String, ignore_case: bool },
    Path { pat: String, ignore_case: bool },
    Regex { pat: String, ignore_case: bool },
    Type(Vec<char>),
    Empty,
    Size { op: i8, count: usize, unit: usize },
    Perm { mode_kind: char, mask: u32 },
    Links { op: i8, count: usize },
    Time { op: i8, stamp: fn(&crate::vfs::FileStat) -> f64, reference_ms: i64, unit_ms: i64 },
    Newer(f64),
    Prune,
    Quit,
    Delete,
    Print { null_delim: bool },
    Printf(String),
    Exec { cmd: Vec<String>, batch_idx: Option<usize> },
    Group(Box<FindPred>),
    Not(Box<FindPred>),
    And(Box<FindPred>, Box<FindPred>),
    Or(Box<FindPred>, Box<FindPred>),
    Comma(Box<FindPred>, Box<FindPred>),
}

fn validate_find_printf(fmt: &str) -> Result<(), String> {
    let chars: Vec<char> = fmt.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '\\' {
            if i + 1 >= chars.len() {
                return Err("incomplete escape in -printf".to_string());
            }
            match chars[i + 1] {
                'a' | 'b' | 'f' | 'n' | 'r' | 't' | 'v' | '\\' | 'c' => {
                    i += 2;
                }
                '0'..='7' => {
                    i += 2;
                    let mut count = 1;
                    while i < chars.len() && count < 3 && ('0'..='7').contains(&chars[i]) {
                        i += 1;
                        count += 1;
                    }
                }
                _ => {
                    return Err("unsupported printf escape".to_string());
                }
            }
        } else if chars[i] == '%' {
            if i + 1 >= chars.len() {
                return Err("incomplete format directive in -printf".to_string());
            }
            match chars[i + 1] {
                '%' | 'p' | 'f' | 'h' | 'P' | 'H' | 's' | 'd' | 'y' => {
                    i += 2;
                }
                _ => {
                    return Err("unsupported printf format directive or modifier".to_string());
                }
            }
        } else {
            i += 1;
        }
    }
    Ok(())
}

fn render_find_printf(
    fmt: &str,
    disp_path: &str,
    root_disp: &str,
    rel_p: &str,
    st_opt: Option<&crate::vfs::FileStat>,
    depth: usize,
) -> String {
    let bytes = disp_path.as_bytes();
    let mut end = bytes.len();
    while end > 1 && bytes[end - 1] == b'/' {
        end -= 1;
    }
    let mut slash = end as isize - 1;
    while slash >= 0 && bytes[slash as usize] != b'/' {
        slash -= 1;
    }
    let base = if end == 1 && bytes.first() == Some(&b'/') {
        "/".to_string()
    } else {
        disp_path[(slash + 1) as usize..end].to_string()
    };
    let dir = if slash < 0 {
        ".".to_string()
    } else if slash == 0 {
        "/".to_string()
    } else {
        disp_path[..slash as usize].to_string()
    };
    let sz = st_opt.map(|st| st.size).unwrap_or(0);
    let type_ch = st_opt
        .map(|st| match st.kind {
            VfsEntryKind::File => {
                if (st.mode & 0o170000) == 0o020000 {
                    "c"
                } else {
                    "f"
                }
            }
            VfsEntryKind::Directory => "d",
            VfsEntryKind::Symlink => "l",
        })
        .unwrap_or("?");

    let mut out = String::new();
    let chars: Vec<char> = fmt.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '\\' && i + 1 < chars.len() {
            match chars[i + 1] {
                'a' => {
                    out.push('\x07');
                    i += 2;
                }
                'b' => {
                    out.push('\x08');
                    i += 2;
                }
                'f' => {
                    out.push('\x0c');
                    i += 2;
                }
                'n' => {
                    out.push('\n');
                    i += 2;
                }
                't' => {
                    out.push('\t');
                    i += 2;
                }
                'r' => {
                    out.push('\r');
                    i += 2;
                }
                'v' => {
                    out.push('\x0b');
                    i += 2;
                }
                '\\' => {
                    out.push('\\');
                    i += 2;
                }
                'c' => break,
                '0'..='7' => {
                    let mut oct = String::new();
                    i += 1;
                    while i < chars.len() && oct.len() < 3 && ('0'..='7').contains(&chars[i]) {
                        oct.push(chars[i]);
                        i += 1;
                    }
                    let val = u8::from_str_radix(&oct, 8).unwrap_or(0);
                    out.push(val as char);
                }
                other => {
                    out.push('\\');
                    out.push(other);
                    i += 2;
                }
            }
        } else if chars[i] == '%' && i + 1 < chars.len() {
            match chars[i + 1] {
                '%' => out.push('%'),
                'p' => out.push_str(disp_path),
                'f' => out.push_str(&base),
                'h' => out.push_str(&dir),
                'P' => out.push_str(rel_p),
                'H' => out.push_str(root_disp),
                's' => out.push_str(&sz.to_string()),
                'd' => out.push_str(&depth.to_string()),
                'y' => out.push_str(type_ch),
                other => {
                    out.push('%');
                    out.push(other);
                }
            }
            i += 2;
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

fn parse_size_arg_strict(s: &str) -> Result<(i8, usize, usize), String> {
    if s.is_empty() {
        return Err(format!("find: invalid size '{s}'"));
    }
    let (op, rest) = if let Some(r) = s.strip_prefix('+') {
        (1, r)
    } else if let Some(r) = s.strip_prefix('-') {
        (-1, r)
    } else {
        (0, s)
    };
    let (num_str, mult) = if let Some(n) = rest.strip_suffix('c') {
        (n, 1usize)
    } else if let Some(n) = rest.strip_suffix('w') {
        (n, 2usize)
    } else if let Some(n) = rest.strip_suffix('b') {
        (n, 512usize)
    } else if let Some(n) = rest.strip_suffix('k') {
        (n, 1024usize)
    } else if let Some(n) = rest.strip_suffix('M') {
        (n, 1024 * 1024usize)
    } else if let Some(n) = rest.strip_suffix('G') {
        (n, 1024 * 1024 * 1024usize)
    } else {
        (rest, 512usize)
    };
    if num_str.is_empty() || !num_str.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("find: invalid size '{s}'"));
    }
    let n = num_str
        .parse::<usize>()
        .map_err(|_| format!("find: invalid size '{s}'"))?;
    Ok((op, n, mult))
}

fn parse_perm_arg_strict(s: &str) -> Result<(char, u32), String> {
    let (kind, rest) = if let Some(r) = s.strip_prefix('-') {
        ('-', r)
    } else if let Some(rest) = s.strip_prefix('/').or_else(|| s.strip_prefix('+')) {
        ('/', rest)
    } else {
        ('=', s)
    };
    if rest.is_empty() {
        return Err(format!("find: invalid mode: '{rest}'"));
    }
    if rest.chars().all(|c| ('0'..='7').contains(&c)) && rest.len() <= 4 {
        let mask = u32::from_str_radix(rest, 8).unwrap_or(0) & 0o7777;
        return Ok((kind, mask));
    }
    if rest.chars().any(|c| c.is_ascii_digit()) {
        return Err(format!("find: invalid mode: '{rest}'"));
    }
    let mut mode = 0u32;
    for clause in rest.split(',') {
        if clause.is_empty() {
            return Err(format!("find: invalid mode: '{rest}'"));
        }
        let bytes = clause.as_bytes();
        let mut i = 0usize;
        let mut who_u = false;
        let mut who_g = false;
        let mut who_o = false;
        while i < bytes.len() && matches!(bytes[i], b'u' | b'g' | b'o' | b'a') {
            match bytes[i] {
                b'u' => who_u = true,
                b'g' => who_g = true,
                b'o' => who_o = true,
                b'a' => {
                    who_u = true;
                    who_g = true;
                    who_o = true;
                }
                _ => {}
            }
            i += 1;
        }
        if !who_u && !who_g && !who_o {
            who_u = true;
            who_g = true;
            who_o = true;
        }
        if i >= bytes.len() {
            return Err(format!("find: invalid mode: '{rest}'"));
        }
        while i < bytes.len() {
            let op = bytes[i];
            if !matches!(op, b'+' | b'-' | b'=') {
                return Err(format!("find: invalid mode: '{rest}'"));
            }
            i += 1;
            let mut r = false;
            let mut w = false;
            let mut x = false;
            let mut s_bit = false;
            let mut t_bit = false;
            while i < bytes.len() && !matches!(bytes[i], b'+' | b'-' | b'=') {
                match bytes[i] {
                    b'r' => r = true,
                    b'w' => w = true,
                    b'x' | b'X' => x = true,
                    b's' => s_bit = true,
                    b't' => t_bit = true,
                    _ => return Err(format!("find: invalid mode: '{rest}'")),
                }
                i += 1;
            }
            let rwx = (if r { 4 } else { 0 }) | (if w { 2 } else { 0 }) | (if x { 1 } else { 0 });
            let mut bits = 0u32;
            let mut clear_mask = 0u32;
            if who_u {
                bits |= (rwx << 6) | (if s_bit { 0o4000 } else { 0 });
                clear_mask |= 0o4700;
            }
            if who_g {
                bits |= (rwx << 3) | (if s_bit { 0o2000 } else { 0 });
                clear_mask |= 0o2070;
            }
            if who_o {
                bits |= rwx | (if t_bit { 0o1000 } else { 0 });
                clear_mask |= 0o1007;
            }
            match op {
                b'+' => mode |= bits,
                b'-' => mode &= !bits,
                b'=' => mode = (mode & !clear_mask) | bits,
                _ => {}
            }
        }
    }
    Ok((kind, mode & 0o7777))
}

fn parse_signed_count_strict(raw: &str, err_msg: &str) -> Result<(i8, usize), String> {
    let (op, rest) = if let Some(r) = raw.strip_prefix('+') {
        (1, r)
    } else if let Some(r) = raw.strip_prefix('-') {
        (-1, r)
    } else {
        (0, raw)
    };
    if rest.is_empty() || !rest.chars().all(|c| c.is_ascii_digit()) {
        return Err(err_msg.to_string());
    }
    let count = rest.parse::<usize>().map_err(|_| err_msg.to_string())?;
    Ok((op, count))
}

struct FindExecBatch {
    words: Vec<String>,
    prefix_len: usize,
    path_bytes: usize,
}

struct FindParseContext<'a> {
    args: &'a [String],
    idx: usize,
    cwd: &'a str,
    fs: &'a dyn SafeBashFs,
    reference_ms: i64,
    max_depth: Option<usize>,
    min_depth: usize,
    depth_first: bool,
    explicit_depth: bool,
    explicit_action: bool,
    deletes: bool,
    prunes: bool,
    exec_batches: Vec<FindExecBatch>,
}

impl<'a> FindParseContext<'a> {
    fn peek(&self) -> Option<&'a str> {
        self.args.get(self.idx).map(|s| s.as_str())
    }

    fn parse_list(&mut self) -> Result<(FindPred, String), (i32, String)> {
        let (mut left, mut tree) = self.parse_or()?;
        while self.peek() == Some(",") {
            self.idx += 1;
            let (right, r_tree) = self.parse_or()?;
            left = FindPred::Comma(Box::new(left), Box::new(right));
            tree = format!("LIST({tree}, {r_tree})");
        }
        Ok((left, tree))
    }

    fn parse_or(&mut self) -> Result<(FindPred, String), (i32, String)> {
        let (mut left, mut tree) = self.parse_and()?;
        while matches!(self.peek(), Some("-o" | "-or")) {
            self.idx += 1;
            let (right, r_tree) = self.parse_and()?;
            left = FindPred::Or(Box::new(left), Box::new(right));
            tree = format!("OR({tree}, {r_tree})");
        }
        Ok((left, tree))
    }

    fn parse_and(&mut self) -> Result<(FindPred, String), (i32, String)> {
        let (mut left, mut tree) = self.parse_primary()?;
        while let Some(tok) = self.peek() {
            if matches!(tok, ")" | "-o" | "-or" | ",") {
                break;
            }
            if matches!(tok, "-a" | "-and") {
                self.idx += 1;
            }
            let (right, r_tree) = self.parse_primary()?;
            left = FindPred::And(Box::new(left), Box::new(right));
            tree = format!("AND({tree}, {r_tree})");
        }
        Ok((left, tree))
    }

    fn parse_primary(&mut self) -> Result<(FindPred, String), (i32, String)> {
        let Some(tok) = self.peek() else {
            return Err((2, "find: missing expression\n".to_string()));
        };
        if matches!(tok, "!" | "-not") {
            self.idx += 1;
            let (inner, in_tree) = self.parse_primary()?;
            return Ok((FindPred::Not(Box::new(inner)), format!("NOT({in_tree})")));
        }
        if tok == "(" {
            self.idx += 1;
            if self.peek() == Some(")") {
                return Err((2, "find: unsupported expression ')'\n".to_string()));
            }
            let (inner, in_tree) = self.parse_list()?;
            if self.peek() != Some(")") {
                return Err((2, "find: missing ')'\n".to_string()));
            }
            self.idx += 1;
            return Ok((FindPred::Group(Box::new(inner)), in_tree));
        }

        let start = self.idx;
        self.idx += 1;
        let label_for = |args: &[String], s: usize, e: usize| -> String {
            format!("[{}]", args[s..e].iter().map(|t| format!("\"{}\"", t.replace('\\', "\\\\").replace('"', "\\\""))).collect::<Vec<_>>().join(","))
        };
        let take_arg = |this: &mut Self, opt: &str| -> Result<&'a str, (i32, String)> {
            if let Some(v) = this.args.get(this.idx) {
                this.idx += 1;
                Ok(v.as_str())
            } else {
                Err((2, format!("find: {opt} requires an argument\n")))
            }
        };

        let pred = match tok {
            "-true" => FindPred::True,
            "-false" => FindPred::False,
            "-depth" | "-d" => {
                self.depth_first = true;
                self.explicit_depth = true;
                FindPred::Depth
            }
            "-maxdepth" | "-mindepth" => {
                let Some(raw) = self.args.get(self.idx).map(|s| s.as_str()) else {
                    return Err((2, format!("find: {tok} requires a number\n")));
                };
                self.idx += 1;
                if raw.is_empty() || !raw.chars().all(|c| c.is_ascii_digit()) {
                    return Err((2, format!("find: invalid number '{raw}'\n")));
                }
                let val = raw
                    .parse::<usize>()
                    .map_err(|_| (2, format!("find: invalid number '{raw}'\n")))?;
                if tok == "-maxdepth" {
                    self.max_depth = Some(val);
                    FindPred::MaxDepth
                } else {
                    self.min_depth = val;
                    FindPred::MinDepth
                }
            }
            "-name" | "-iname" => {
                let pat = take_arg(self, tok)?.to_string();
                FindPred::Name {
                    pat,
                    ignore_case: tok == "-iname",
                }
            }
            "-path" | "-wholename" | "-ipath" | "-iwholename" => {
                let pat = take_arg(self, tok)?.to_string();
                FindPred::Path {
                    pat,
                    ignore_case: tok.starts_with("-i"),
                }
            }
            "-regex" | "-iregex" => {
                let pat = take_arg(self, tok)?.to_string();
                if has_unsupported_regex_features(&pat) {
                    return Err((2, format!("find: invalid regular expression '{pat}'\n")));
                }
                FindPred::Regex {
                    pat,
                    ignore_case: tok == "-iregex",
                }
            }
            "-type" => {
                let raw = take_arg(self, tok)?;
                let mut types = Vec::new();
                for part in raw.split(',') {
                    if part.len() != 1 {
                        return Err((2, format!("find: unsupported file type '{raw}'\n")));
                    }
                    let ch = part.chars().next().unwrap();
                    if !matches!(ch, 'f' | 'd' | 'l' | 'c') {
                        return Err((2, format!("find: unsupported file type '{raw}'\n")));
                    }
                    types.push(ch);
                }
                if types.is_empty() {
                    return Err((2, format!("find: unsupported file type '{raw}'\n")));
                }
                FindPred::Type(types)
            }
            "-empty" => FindPred::Empty,
            "-size" => {
                let raw = take_arg(self, tok)?;
                let (op, count, unit) =
                    parse_size_arg_strict(raw).map_err(|m| (2, format!("{m}\n")))?;
                FindPred::Size { op, count, unit }
            }
            "-perm" => {
                let raw = take_arg(self, tok)?;
                let (mode_kind, mask) =
                    parse_perm_arg_strict(raw).map_err(|m| (2, format!("{m}\n")))?;
                FindPred::Perm { mode_kind, mask }
            }
            "-links" => {
                let raw = take_arg(self, tok)?;
                let (op, count) =
                    parse_signed_count_strict(raw, &format!("find: invalid link count '{raw}'"))
                        .map_err(|m| (2, format!("{m}\n")))?;
                FindPred::Links { op, count }
            }
            "-mtime" | "-mmin" | "-amin" | "-cmin" => {
                let raw = take_arg(self, tok)?;
                let (op, digits) = match raw.as_bytes().first() {
                    Some(b'+') => (1, &raw[1..]),
                    Some(b'-') => (-1, &raw[1..]),
                    _ => (0, raw),
                };
                if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
                    return Err((2, format!("find: invalid time '{raw}'\n")));
                }
                const MAX_SAFE: i128 = (1 << 53) - 1;
                let count = digits.parse::<i128>().ok().filter(|&n| n <= MAX_SAFE)
                    .ok_or_else(|| (2, format!("find: invalid number '{digits}'\n")))?;
                let (unit, adjustment) = if tok == "-mtime" {
                    (86_400_000, if op == -1 { 1000 } else { 86_400_000 })
                } else { (60_000, 0) };
                let offset = count * unit;
                let reference = i128::from(self.reference_ms) - adjustment - offset;
                if offset > MAX_SAFE || reference.abs() > MAX_SAFE || (reference + unit).abs() > MAX_SAFE {
                    return Err((2, format!("find: invalid time '{raw}': comparison is out of range\n")));
                }
                FindPred::Time {
                    op, reference_ms: reference as i64, unit_ms: unit as i64,
                    stamp: match tok {
                        "-amin" => |st| st.atime_ms,
                        "-cmin" => |st| st.ctime_ms.unwrap_or(st.mtime_ms),
                        _ => |st| st.mtime_ms,
                    },
                }
            }
            "-newer" => {
                let raw = take_arg(self, tok)?;
                let ref_full = resolve_posix_path(self.cwd, raw);
                let st = self
                    .fs
                    .lstat(&ref_full)
                    .map_err(|_| (1, format!("find: ENOENT: no such file or directory, lstat '{ref_full}'\n")))?;
                FindPred::Newer(st.mtime_ms)
            }
            "-prune" => {
                self.prunes = true;
                FindPred::Prune
            }
            "-quit" => {
                self.explicit_action = true;
                FindPred::Quit
            }
            "-delete" => {
                self.depth_first = true;
                self.deletes = true;
                self.explicit_action = true;
                FindPred::Delete
            }
            "-print" => {
                self.explicit_action = true;
                FindPred::Print { null_delim: false }
            }
            "-print0" => {
                self.explicit_action = true;
                FindPred::Print { null_delim: true }
            }
            "-printf" => {
                let Some(fmt) = self.args.get(self.idx).cloned() else {
                    return Err((2, "find: -printf requires a format\n".to_string()));
                };
                self.idx += 1;
                validate_find_printf(&fmt).map_err(|m| (2, format!("find: {m}\n")))?;
                self.explicit_action = true;
                FindPred::Printf(fmt)
            }
            "-exec" => {
                let mut cmd_words = Vec::new();
                let mut term: Option<&str> = None;
                while let Some(w) = self.peek() {
                    self.idx += 1;
                    if w == ";" || w == "\\;" || w == "+" {
                        term = Some(w);
                        break;
                    }
                    cmd_words.push(w.to_string());
                }
                let Some(t) = term else {
                    return Err((2, "find: -exec requires a command terminated by ';' or '+'\n".to_string()));
                };
                if cmd_words.is_empty() {
                    return Err((2, "find: -exec requires a command terminated by ';' or '+'\n".to_string()));
                }
                self.explicit_action = true;
                if t == "+" {
                    if cmd_words.last().map(|s| s.as_str()) != Some("{}")
                        || cmd_words[..cmd_words.len() - 1]
                            .iter()
                            .any(|s| s.contains("{}"))
                    {
                        return Err((
                            2,
                            "find: -exec requires a command terminated by ';' or '+'\n".to_string(),
                        ));
                    }
                    let b_idx = self.exec_batches.len();
                    cmd_words.pop();
                    self.exec_batches.push(FindExecBatch { prefix_len: cmd_words.len(), words: cmd_words, path_bytes: 0 });
                    FindPred::Exec {
                        cmd: Vec::new(),
                        batch_idx: Some(b_idx),
                    }
                } else {
                    FindPred::Exec {
                        cmd: cmd_words,
                        batch_idx: None,
                    }
                }
            }
            other => {
                return Err((2, format!("find: unsupported expression '{other}'\n")));
            }
        };

        Ok((pred, label_for(self.args, start, self.idx)))
    }
}

struct FindEvalState<'a, F>
where
    F: FnMut(&[String], &mut String, &mut BTreeMap<String, String>) -> ChildRun,
{
    cwd: &'a mut String,
    env: &'a mut BTreeMap<String, String>,
    fs: &'a dyn SafeBashFs,
    exec_sub: &'a mut F,
    exec_batches: Vec<FindExecBatch>,
    write: &'a mut CommandWriter<'a>,
    result: BuiltinOutcome,
    quit: bool,
    stopped: bool,
}

impl<F> FindEvalState<'_, F>
where
    F: FnMut(&[String], &mut String, &mut BTreeMap<String, String>) -> ChildRun,
{
    fn emit(&mut self, fd: u32, data: &str) {
        if !(self.write)(fd, data, &mut self.result) {
            self.quit = true;
            self.stopped = true;
        }
    }

    fn collect_child(&mut self, run: ChildRun) -> i32 {
        let out = run.unwrap_or_else(|err| {
            self.quit = true;
            self.stopped = true;
            self.result.exit_code = err.exit_code;
            err
        });
        self.result.stdout.push_str(&out.stdout);
        self.result.stderr.push_str(&out.stderr);
        out.exit_code
    }

    fn print_path(&mut self, path: &str, null: bool) {
        let mut line = String::new();
        if null { line.push_str(path); line.push('\0'); }
        else { super::fs::write_display_name(&mut line, path, false); line.push('\n'); }
        self.emit(1, &line);
    }

    fn flush_batch(&mut self, index: usize) {
        let batch = &mut self.exec_batches[index];
        if batch.words.len() == batch.prefix_len { return; }
        let res = (self.exec_sub)(&batch.words, self.cwd, self.env);
        batch.words.truncate(batch.prefix_len);
        batch.path_bytes = 0;
        if self.collect_child(res) != 0 { self.result.exit_code = 1; }
    }
}

struct FindEntry<'a> {
    display: &'a str,
    root: &'a str,
    relative: &'a str,
    path: &'a str,
    physical: &'a str,
    stat: &'a crate::vfs::FileStat,
    symlink: bool,
    depth: usize,
}

fn eval_find_pred<F>(
    pred: &FindPred,
    entry: &FindEntry<'_>,
    pruned: &mut bool,
    state: &mut FindEvalState<'_, F>,
) -> Result<bool, String>
where
    F: FnMut(&[String], &mut String, &mut BTreeMap<String, String>) -> ChildRun,
{
    let disp_path = entry.display;
    let full_path = entry.path;
    let st = entry.stat;
    Ok(match pred {
        FindPred::True | FindPred::Depth | FindPred::MaxDepth | FindPred::MinDepth => true,
        FindPred::False => false,
        FindPred::Name { pat, ignore_case } => {
            let base = basename_posix_path(disp_path);
            if *ignore_case {
                glob_match(&pat.to_ascii_lowercase(), &base.to_ascii_lowercase())
            } else {
                glob_match(pat, &base)
            }
        }
        FindPred::Path { pat, ignore_case } => {
            if *ignore_case {
                glob_match(&pat.to_ascii_lowercase(), &disp_path.to_ascii_lowercase())
            } else {
                glob_match(pat, disp_path)
            }
        }
        FindPred::Regex { pat, ignore_case } => {
            let rx = ZeroRegex::new(vec![pat.clone()], *ignore_case, false, false, true);
            rx.is_match(disp_path)
        }
        FindPred::Type(types) => types.iter().any(|t| match t {
            'f' => st.kind == VfsEntryKind::File && (st.mode & 0o170000) != 0o020000,
            'c' => st.kind == VfsEntryKind::File && (st.mode & 0o170000) == 0o020000,
            'd' => st.kind == VfsEntryKind::Directory,
            'l' => st.kind == VfsEntryKind::Symlink,
            _ => false,
        }),
        FindPred::Empty => match st.kind {
            VfsEntryKind::File => st.size == 0,
            VfsEntryKind::Directory => state.fs.read_dir(entry.physical)?.is_empty(),
            _ => false,
        },
        FindPred::Size { op, count, unit } => {
            let actual = if *unit <= 1 {
                st.size
            } else if st.size == 0 {
                0
            } else {
                st.size.div_ceil(*unit)
            };
            match op {
                1 => actual > *count,
                -1 => actual < *count,
                _ => actual == *count,
            }
        },
        FindPred::Perm { mode_kind, mask } => {
            let file_mode = st.mode & 0o7777;
            match mode_kind {
                '-' => (file_mode & *mask) == *mask,
                '/' => *mask == 0 || (file_mode & *mask) != 0,
                _ => file_mode == *mask,
            }
        },
        FindPred::Links { op, count } => {
            let Some(nlinks) = st.nlink else {
                return Err(format!("ENOTSUP: link count unavailable '{full_path}'"));
            };
            match op {
                1 => nlinks > *count,
                -1 => nlinks < *count,
                _ => nlinks == *count,
            }
        }
        FindPred::Time { op, stamp, reference_ms, unit_ms } => {
            let delta = stamp(st) - *reference_ms as f64;
            match op {
                1 => delta < 0.0,
                -1 => delta > 0.0,
                _ => delta > 0.0 && delta <= *unit_ms as f64,
            }
        },
        FindPred::Newer(ref_mtime) => st.mtime_ms > *ref_mtime,
        FindPred::Prune => {
            *pruned = true;
            true
        }
        FindPred::Quit => {
            state.quit = true;
            true
        }
        FindPred::Delete => {
            let base = basename_posix_path(disp_path);
            if base == "." {
                return Ok(true);
            }
            let directory = entry.stat.kind == VfsEntryKind::Directory && !entry.symlink;
            if let Err(e) = state.fs.remove_one(full_path, directory) {
                let op = if directory { "rmdir" } else { "rm" };
                state.emit(2, &format!("find: {e}, {op} '{full_path}'\n"));
                state.result.exit_code = 1;
                return Ok(false);
            }
            true
        }
        FindPred::Print { null_delim } => {
            state.print_path(disp_path, *null_delim);
            true
        }
        FindPred::Printf(fmt) => {
            let rendered =
                render_find_printf(fmt, disp_path, entry.root, entry.relative, Some(st), entry.depth);
            state.emit(1, &rendered);
            true
        }
        FindPred::Exec { cmd, batch_idx } => {
            if let Some(b_idx) = batch_idx {
                let size = stream_byte_len(disp_path) + 1;
                let batch = &state.exec_batches[*b_idx];
                if batch.words.len() - batch.prefix_len >= 1000 || batch.path_bytes + size > 65536 {
                    state.flush_batch(*b_idx);
                }
                let batch = &mut state.exec_batches[*b_idx];
                batch.words.push(disp_path.to_owned());
                batch.path_bytes += size;
                true
            } else {
                let cmd_args: Vec<String> =
                    cmd.iter().map(|w| w.replace("{}", disp_path)).collect();
                let res = (state.exec_sub)(&cmd_args, state.cwd, state.env);
                state.collect_child(res) == 0
            }
        }
        FindPred::Group(inner) => eval_find_pred(inner, entry, pruned, state)?,
        FindPred::Not(inner) => !eval_find_pred(inner, entry, pruned, state)?,
        FindPred::And(a, b) => {
            eval_find_pred(a, entry, pruned, state)? && !state.quit
                && eval_find_pred(b, entry, pruned, state)?
        }
        FindPred::Or(a, b) => {
            eval_find_pred(a, entry, pruned, state)? || (!state.quit
                && eval_find_pred(b, entry, pruned, state)?)
        }
        FindPred::Comma(a, b) => {
            let _ = eval_find_pred(a, entry, pruned, state)?;
            if state.quit {
                return Ok(false);
            }
            eval_find_pred(b, entry, pruned, state)?
        }
    })
}

fn cmd_find<F>(
    args: &[String],
    cwd: &mut String,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
    write: &mut CommandWriter<'_>,
    exec_sub: &mut F,
) -> BuiltinOutcome
where
    F: FnMut(&[String], &mut String, &mut BTreeMap<String, String>) -> ChildRun,
{
    let mut follow_mode = FindFollowMode::Never;
    let mut debug_tree = false;
    let mut roots = Vec::new();
    let mut idx = 0usize;
    while idx < args.len() {
        match args[idx].as_str() {
            "-P" => {
                follow_mode = FindFollowMode::Never;
                idx += 1;
            }
            "-H" => {
                follow_mode = FindFollowMode::RootsOnly;
                idx += 1;
            }
            "-L" => {
                follow_mode = FindFollowMode::Always;
                idx += 1;
            }
            "-D" => {
                idx += 1;
                if idx >= args.len() {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: "find: -D requires a debug option\n".to_string(),
                        exit_code: 2,
                    };
                }
                if args[idx] != "tree" {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("find: unsupported debug option '{}' (supported: tree)\n", args[idx]),
                        exit_code: 2,
                    };
                }
                debug_tree = true;
                idx += 1;
            }
            _ => break,
        }
    }
    if idx < args.len() && args[idx] == "--" {
        idx += 1;
    }
    while idx < args.len() {
        let a = &args[idx];
        if a.starts_with('-') || a == "!" || a == "(" {
            break;
        }
        roots.push(a.clone());
        idx += 1;
    }
    if roots.is_empty() {
        roots.push(".".to_string());
    }

    let now_ms = crate::vfs::now_ms() as i64;

    let mut pctx = FindParseContext {
        args,
        idx,
        cwd,
        fs,
        reference_ms: now_ms,
        max_depth: None,
        min_depth: 0,
        depth_first: false,
        explicit_depth: false,
        explicit_action: false,
        deletes: false,
        prunes: false,
        exec_batches: Vec::new(),
    };

    let (pred, tree) = if pctx.idx < args.len() {
        match pctx.parse_list() {
            Ok((p, t)) => {
                if pctx.idx < args.len() {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: format!("find: unexpected expression '{}'\n", args[pctx.idx]),
                        exit_code: 2,
                    };
                }
                (Some(p), t)
            }
            Err((code, msg)) => {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: msg,
                    exit_code: code,
                };
            }
        }
    } else {
        (None, "true".to_string())
    };

    if pctx.deletes && pctx.prunes && !pctx.explicit_depth {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "find: -delete implies -depth; -prune is ineffective unless -depth is explicitly supplied\n"
                .to_string(),
            exit_code: 1,
        };
    }

    let max_depth = pctx.max_depth;
    let min_depth = pctx.min_depth;
    let depth_first = pctx.depth_first;
    let explicit_action = pctx.explicit_action;
    let exec_batches = pctx.exec_batches;

    let mut state = FindEvalState {
        cwd, env, fs, exec_sub, exec_batches, write,
        result: ok_out(""), quit: false, stopped: false,
    };

    if debug_tree {
        let rendered_tree = if explicit_action {
            tree
        } else {
            format!("AND({tree}, implicit -print)")
        };
        state.emit(2, &format!(
            "find: virtual expression tree (evaluation order; no optimizer)\n{rendered_tree}\n"
        ));
    }

    for r in &roots {
        if state.quit {
            break;
        }
        let full = if r.is_empty() || r.starts_with('/') { r.clone() } else { format!("{}/{r}", state.cwd.trim_end_matches('/')) };
        let mut ancestors = std::collections::BTreeSet::new();
        walk_find(
            r,
            r,
            "",
            &full,
            0,
            min_depth,
            max_depth,
            depth_first,
            follow_mode,
            explicit_action,
            &pred,
            &mut ancestors,
            &mut state,
        );
    }

    for i in 0..state.exec_batches.len() {
        if state.stopped { break; }
        state.flush_batch(i);
    }
    state.result
}

#[allow(clippy::too_many_arguments)]
fn walk_find<F>(
    disp: &str,
    root_disp: &str,
    rel: &str,
    full: &str,
    depth: usize,
    min_depth: usize,
    max_depth: Option<usize>,
    depth_first: bool,
    follow_mode: FindFollowMode,
    explicit_action: bool,
    pred: &Option<FindPred>,
    ancestors: &mut std::collections::BTreeSet<String>,
    state: &mut FindEvalState<'_, F>,
) where
    F: FnMut(&[String], &mut String, &mut BTreeMap<String, String>) -> ChildRun,
{
    if state.quit {
        return;
    }
    if let Some(max_d) = max_depth {
        if depth > max_d {
            return;
        }
    }

    let inspect = |follow| state.fs.inspect_command_entry(full, follow, if follow { "stat" } else { "lstat" });
    let report = |error: String, op: &str| {
        if error.starts_with("ELOOP:") && !error.contains(", ") {
            format!("find: ELOOP: too many symbolic links encountered '{full}'\n")
        } else if error.starts_with("ENOTSUP: link count unavailable ") || (error.starts_with("EACCES:") && error.contains(", lstat '")) {
            format!("find: {error}\n")
        } else {
            let reason = if error.starts_with("ENOENT:") || error.ends_with("(os error 2)") { "ENOENT: no such file or directory" }
                else { error.split_once(", ").map_or(error.as_str(), |(reason, _)| reason) };
            format!("find: {reason}, {op} '{full}'\n")
        }
    };
    let (mut physical, mut st) = match inspect(false) {
        Ok(entry) => entry,
        Err(e) => {
            state.emit(2, &report(e, "lstat"));
            state.result.exit_code = 1;
            return;
        }
    };
    let symlink = st.kind == VfsEntryKind::Symlink;
    if symlink && (follow_mode == FindFollowMode::Always
        || follow_mode == FindFollowMode::RootsOnly && depth == 0) {
        match inspect(true) {
            Ok(entry) => (physical, st) = entry,
            Err(e) if e.starts_with("ENOENT:") => {}
            Err(e) => {
                state.emit(2, &report(e, "stat"));
                state.result.exit_code = 1;
                return;
            }
        }
    }

    let entry = FindEntry { display: disp, root: root_disp, relative: rel, path: full, physical: &physical, stat: &st, symlink, depth };
    let evaluate = |pruned: &mut bool, state: &mut FindEvalState<'_, F>| {
        let result = match pred {
            Some(p) => eval_find_pred(p, &entry, pruned, state),
            None => Ok(true),
        };
        match result {
            Ok(ok) => {
                if ok && !explicit_action { state.print_path(disp, false); }
                true
            }
            Err(e) => {
                state.emit(2, &report(e, "readdir"));
                state.result.exit_code = 1;
                false
            }
        }
    };
    let mut pruned = false;
    if !depth_first && depth >= min_depth {
        if !evaluate(&mut pruned, state) { return; }
        if state.quit {
            return;
        }
    }

    let can_descend = st.kind == VfsEntryKind::Directory
        && (!pruned || depth_first)
        && max_depth.map(|max_d| depth < max_d).unwrap_or(true);
    if can_descend {
        if ancestors.contains(&physical) {
            state.emit(2, &format!(
                "find: ELOOP: too many symbolic links encountered '{full}'\n"
            ));
            state.result.exit_code = 1;
            return;
        }
        ancestors.insert(physical.clone());
        let parent = disp.trim_end_matches('/');
        match state.fs.read_dir(&physical) {
            Err(e) => {
                state.emit(2, &report(e, "readdir"));
                state.result.exit_code = 1;
                ancestors.remove(&physical);
                return;
            }
            Ok(entries) => for e in entries {
                if state.quit {
                    break;
                }
                let child_disp = format!("{parent}/{e}");
                let child_rel = if rel.is_empty() {
                    e.clone()
                } else {
                    format!("{rel}/{e}")
                };
                let child_full = format!("{}/{e}", full.trim_end_matches('/'));
                walk_find(
                    &child_disp,
                    root_disp,
                    &child_rel,
                    &child_full,
                    depth + 1,
                    min_depth,
                    max_depth,
                    depth_first,
                    follow_mode,
                    explicit_action,
                    pred,
                    ancestors,
                    state,
                );
            }
        }
        ancestors.remove(&physical);
    }

    if depth_first && depth >= min_depth && !state.quit {
        evaluate(&mut pruned, state);
    }
}

fn format_fd_template(template: &str, path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    let base = basename_posix_path(trimmed);
    let parent = match trimmed.rfind('/') {
        Some(0) => "/".to_string(),
        Some(idx) => trimmed[..idx].to_string(),
        None => ".".to_string(),
    };
    let ext_len = match base.rfind('.') {
        Some(idx) if idx > 0 => base.len() - idx,
        _ => 0,
    };
    let no_ext_path = if ext_len > 0 {
        &trimmed[..trimmed.len() - ext_len]
    } else {
        trimmed
    };
    let no_ext_base = if ext_len > 0 {
        &base[..base.len() - ext_len]
    } else {
        &base
    };

    let mut out = String::new();
    let bytes = template.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if template[i..].starts_with("{{") {
            out.push('{');
            i += 2;
        } else if template[i..].starts_with("}}") {
            out.push('}');
            i += 2;
        } else if template[i..].starts_with("{/.}") {
            out.push_str(no_ext_base);
            i += 4;
        } else if template[i..].starts_with("{//}") {
            out.push_str(&parent);
            i += 4;
        } else if template[i..].starts_with("{/}") {
            out.push_str(&base);
            i += 3;
        } else if template[i..].starts_with("{.}") {
            out.push_str(no_ext_path);
            i += 3;
        } else if template[i..].starts_with("{}") {
            out.push_str(trimmed);
            i += 2;
        } else {
            let ch = template[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

fn count_fd_placeholders(s: &str) -> usize {
    let mut count = 0usize;
    let bytes = s.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if s[i..].starts_with("{{") || s[i..].starts_with("}}") {
            i += 2;
        } else if s[i..].starts_with("{/.}") || s[i..].starts_with("{//}") {
            count += 1;
            i += 4;
        } else if s[i..].starts_with("{/}") || s[i..].starts_with("{.}") {
            count += 1;
            i += 3;
        } else if s[i..].starts_with("{}") {
            count += 1;
            i += 2;
        } else {
            let ch = s[i..].chars().next().unwrap();
            i += ch.len_utf8();
        }
    }
    count
}

fn has_fd_placeholder(s: &str) -> bool {
    count_fd_placeholders(s) > 0
}

fn parse_fd_size_spec(spec: &str) -> Option<(char, f64)> {
    let (op, rest) = match spec.as_bytes().first() {
        Some(b'+') => ('+', &spec[1..]),
        Some(b'-') => ('-', &spec[1..]),
        _ => ('=', spec),
    };
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    let count = rest[..digits].parse::<f64>().ok()?;
    let unit = rest[digits..].to_ascii_lowercase();
    let (power, base) = match unit.as_bytes() {
        b"b" => (0, 1.0_f64),
        [prefix, suffix @ ..] => {
            let power = b"kmgt".iter().position(|c| c == prefix)? as i32 + 1;
            let base = match suffix {
                b"" | b"b" => 1000.0,
                b"i" | b"ib" => 1024.0,
                _ => return None,
            };
            (power, base)
        }
        _ => return None,
    };
    Some((op, count * base.powi(power)))
}

fn parse_fd_type_char(s: &str) -> Option<char> {
    match s {
        "f" | "file" => Some('f'),
        "d" | "dir" | "directory" => Some('d'),
        "l" | "symlink" => Some('l'),
        "x" | "executable" => Some('x'),
        "e" | "empty" => Some('e'),
        _ => None,
    }
}

fn parse_fd_time_ms(spec: &str, now: f64) -> Option<f64> {
    if let Some(epoch) = spec.strip_prefix('@') {
        let ms = super::js_number(epoch, 0.0) * 1000.0;
        return ms.is_finite().then_some(ms);
    }
    let count = spec.bytes().take_while(|b| b.is_ascii_digit() || *b == b'.').count();
    let (number, rest) = spec.split_at(count);
    if number.starts_with(|c: char| c.is_ascii_digit()) && !number.ends_with('.') {
        let multiplier = match rest.trim_start().to_ascii_lowercase().as_str() {
            "ms" => Some(1.0),
            "s" | "sec" | "second" | "seconds" => Some(1_000.0),
            "m" | "min" | "minute" | "minutes" => Some(60_000.0),
            "h" | "hour" | "hours" => Some(3_600_000.0),
            "d" | "day" | "days" => Some(86_400_000.0),
            "w" | "week" | "weeks" => Some(604_800_000.0),
            _ => None,
        };
        if let Some(scale) = multiplier {
            return Some(now - number.parse::<f64>().ok()? * scale);
        }
    }
    let date = spec.trim();
    if date.get(..4).is_some_and(|year| year.bytes().all(|b| b.is_ascii_digit()))
        && date.as_bytes().get(4) == Some(&b'-')
    {
        let (sec, ns, _) = super::coreutils::parse_absolute_date_spec(date, 0).ok()?;
        return Some((sec * 1000 + i64::from(ns / 1_000_000)) as f64);
    }
    None
}

#[derive(Clone, Copy, PartialEq)]
enum FdMode { Regex, Fixed, Glob }

enum FdPattern { Regex(ZeroRegex), Fixed(String), Glob(FdGlob) }

struct FdConfig {
    extensions: Vec<String>,
    types: Vec<char>,
    min_depth: usize,
    max_depth: Option<usize>,
    max_results: Option<usize>,
    excludes: Vec<FdGlob>,
    sizes: Vec<(char, f64)>,
    changed_within_ms: Option<f64>,
    changed_before_ms: Option<f64>,
    show_hidden: bool,
    respect_ignore: bool,
    no_ignore_vcs: bool,
    follow: bool,
    full_path: bool,
    absolute_path: bool,
    fold_subject: bool,
    prune: bool,
    patterns: Vec<FdPattern>,
}

fn cmd_fd<F>(
    args: &[String],
    cwd: &mut String,
    fs: &dyn SafeBashFs,
    write: &mut CommandWriter<'_>,
    exec_sub: &mut F,
) -> BuiltinOutcome
where
    F: FnMut(&[String], &mut String) -> ChildRun,
{
    if args.iter().any(|arg| crate::vfs::stream_utf8(arg).is_err()) {
        return BuiltinOutcome { stdout: String::new(), stderr: "fd: The encoded data was not valid for encoding utf-8\n".into(), exit_code: 1 };
    }
    let mut extensions: Vec<String> = Vec::new();
    let mut types: Vec<char> = Vec::new();
    let mut min_depth = 1usize;
    let mut max_depth: Option<usize> = None;
    let mut max_results: Option<usize> = None;
    let mut excludes: Vec<String> = Vec::new();
    let mut size_specs = Vec::new();
    let mut changed_within = None;
    let mut changed_before = None;
    let mut show_hidden = false;
    let mut respect_ignore = true;
    let mut no_ignore_vcs = false;
    let mut no_ignore_parent = false;
    let mut custom_ignore_files: Vec<String> = Vec::new();
    let mut unrestricted = 0usize;
    let mut follow = false;
    let mut full_path = false;
    let mut absolute_path = false;
    let mut print0 = false;
    let mut quiet = false;
    let mut list_details = false;
    let mut strip_cwd_prefix = false;
    let mut mode = FdMode::Regex;
    let mut case_override: Option<bool> = None;
    let mut prune = false;
    let mut format_tpl: Option<String> = None;
    let mut path_separator: Option<String> = None;
    let mut base_dir: Option<String> = None;
    let mut exec_cmd: Vec<String> = Vec::new();
    let mut exec_batch = false;
    let mut has_exec = false;
    let mut and_patterns: Vec<String> = Vec::new();
    let mut operands: Vec<String> = Vec::new();
    let mut search_paths: Vec<String> = Vec::new();

    let usage_err = |msg: &str| BuiltinOutcome {
        stdout: String::new(),
        stderr: format!("fd: {msg}\n"),
        exit_code: 2,
    };

    let mut help = false;
    let mut version = false;
    let mut argv = args.iter();
    while let Some(arg) = argv.next() {
        if arg == "--" { operands.extend(argv.cloned()); break; }
        if arg == "-" || !arg.starts_with('-') { operands.push(arg.clone()); continue; }
        let long = arg.starts_with("--");
        let mut flags = &arg[if long { 2 } else { 1 }..];
        while !flags.is_empty() {
            let (flag, inline) = if long {
                let option = flags;
                flags = "";
                option.split_once('=').map_or((option, None), |(k, v)| (k, Some(v)))
            } else {
                let n = flags.chars().next().unwrap().len_utf8();
                let (short, rest) = flags.split_at(n);
                flags = rest;
                (match short {
                    "c" => "color", "C" => "base-directory", "H" => "hidden", "I" => "no-ignore",
                    "u" => "unrestricted", "L" => "follow", "g" => "glob", "F" => "fixed-strings",
                    "s" => "case-sensitive", "i" => "ignore-case", "p" => "full-path", "a" => "absolute-path",
                    "0" => "print0", "q" => "quiet", "l" => "list-details", "d" => "max-depth",
                    "e" => "extension", "t" => "type", "E" => "exclude", "S" => "size", "1" => "one",
                    "h" => "help", "V" => "version", "x" => "exec", "X" => "exec-batch", other => other,
                }, None)
            };
            if matches!(flag, "exec" | "exec-batch") {
                if has_exec { return usage_err("execution modes cannot be combined"); }
                has_exec = true;
                exec_batch = flag == "exec-batch";
                exec_cmd.extend(argv.by_ref().take_while(|arg| arg.as_str() != ";").cloned());
                if exec_cmd.is_empty() { return usage_err("execution command is required"); }
                break;
            }
            let takes_value = matches!(flag, "search-path" | "ignore-file" | "path-separator" | "and" | "extension" |
                "type" | "exclude" | "max-depth" | "min-depth" | "exact-depth" | "max-results" | "size" |
                "changed-within" | "changed-before" | "format" | "color" | "base-directory");
            let value = if takes_value {
                if let Some(value) = inline { value }
                else if !flags.is_empty() { std::mem::take(&mut flags) }
                else if let Some(value) = argv.next().filter(|v| !v.is_empty()) { value }
                else { return usage_err(&format!("option --{flag} requires a value")); }
            } else if inline.is_some() { return usage_err(&format!("option --{flag} does not take a value")); }
            else { "" };
            match flag {
                "help" => help = true, "version" => version = true,
                "hidden" => show_hidden = true, "no-ignore" => respect_ignore = false,
                "no-ignore-vcs" => no_ignore_vcs = true, "no-ignore-parent" => no_ignore_parent = true,
                "unrestricted" => { unrestricted += 1; respect_ignore = false; show_hidden |= unrestricted >= 2; }
                "follow" => follow = true, "prune" => prune = true,
                "glob" => mode = FdMode::Glob, "fixed-strings" => mode = FdMode::Fixed,
                "ignore-case" => case_override = Some(true), "case-sensitive" => case_override = Some(false),
                "full-path" => full_path = true, "absolute-path" => absolute_path = true,
                "strip-cwd-prefix" => strip_cwd_prefix = true, "print0" => print0 = true,
                "quiet" | "has-results" => quiet = true, "list-details" => list_details = true,
                "one" => max_results = Some(1),
                "max-depth" | "min-depth" | "exact-depth" | "max-results" => {
                    let Some(count) = value.parse::<u64>().ok().filter(|n|
                        *n < (1 << 53) && value.bytes().all(|b| b.is_ascii_digit())) else {
                        return usage_err(&format!("invalid count '{value}'"));
                    };
                    let count = usize::try_from(count).unwrap_or(usize::MAX);
                    if flag == "max-results" {
                        if count == 0 { return usage_err("--max-results must be greater than zero"); }
                        max_results = Some(count);
                    } else {
                        if flag != "min-depth" { max_depth = Some(count); }
                        if flag != "max-depth" { min_depth = count; }
                    }
                }
                "type" => match parse_fd_type_char(value) {
                    Some(kind) => types.push(kind), None => return usage_err(&format!("invalid file type '{value}'")),
                },
                "color" => if !matches!(value, "never" | "auto" | "always") { return usage_err("invalid color mode"); },
                "size" => size_specs.push(value),
                "extension" => extensions.push(value.strip_prefix('.').unwrap_or(value).to_lowercase()),
                "exclude" => excludes.push(value.to_owned()), "and" => and_patterns.push(value.to_owned()),
                "search-path" => search_paths.push(value.to_owned()), "ignore-file" => custom_ignore_files.push(value.to_owned()),
                "format" => format_tpl = Some(value.to_owned()), "path-separator" => path_separator = Some(value.to_owned()),
                "base-directory" => base_dir = Some(value.to_owned()),
                "changed-within" => changed_within = Some(value), "changed-before" => changed_before = Some(value),
                _ => return usage_err(&format!("unrecognized option '--{flag}'")),
            }
        }
    }

    if !search_paths.is_empty() && operands.len() > 1 {
        return usage_err("search-path cannot be combined with positional roots");
    }

    if has_exec && (format_tpl.is_some() || list_details) {
        return usage_err("execution cannot be combined with formatting");
    }
    if exec_batch {
        let total_ph: usize = exec_cmd.iter().map(|w| count_fd_placeholders(w)).sum();
        if total_ph > 1 {
            return usage_err("batch execution accepts only one placeholder");
        }
    }
    if version { return ok_out("fd (safe-bash)\n"); }
    if help { return ok_out("Usage: fd [OPTIONS] [PATTERN] [PATH ...]\nPatterns: -g --glob, -F --fixed-strings, -s --case-sensitive, -i --ignore-case, -p --full-path, --and PATTERN\nFilters: -e EXT, -t TYPE, -E GLOB, -d DEPTH, --min-depth N, --exact-depth N, -S SIZE\n         --changed-within TIME, --changed-before TIME, -1, --max-results N, -q\nTraversal: --search-path PATH, --prune, --ignore-file PATH\nVisibility: -H, -I, --no-ignore-vcs, --no-ignore-parent, -u, -uu, -L\nOutput: -c/--color WHEN, -0, -a, -l, --format FORMAT\n        -x COMMAND ... ;, -X COMMAND ... ;\n"); }
    let mut sizes = Vec::new();
    for value in size_specs {
        let Some(size) = parse_fd_size_spec(value) else { return usage_err(&format!("invalid size '{value}'")); };
        sizes.push(size);
    }
    let mut now = None;
    let mut cutoff = |spec: &str| {
        parse_fd_time_ms(spec, *now.get_or_insert_with(crate::vfs::now_ms))
            .ok_or_else(|| usage_err(&format!("invalid time '{spec}'")))
    };
    let changed_within_ms = match changed_within.map(&mut cutoff).transpose() {
        Ok(value) => value,
        Err(error) => return error,
    };
    let changed_before_ms = match changed_before.map(cutoff).transpose() {
        Ok(value) => value,
        Err(error) => return error,
    };

    if !operands.is_empty() { and_patterns.insert(0, operands.remove(0)); }
    and_patterns.retain(|p| !p.is_empty());

    let mut roots = if !search_paths.is_empty() {
        search_paths
    } else if !operands.is_empty() {
        operands
    } else {
        vec![".".to_string()]
    };
    if roots.is_empty() {
        roots.push(".".to_string());
    }

    let ignore_case = case_override.unwrap_or_else(|| !and_patterns.iter().any(|p| p.chars().any(char::is_uppercase)));
    let fold_subject = ignore_case && mode != FdMode::Regex;

    let effective_cwd = match &base_dir {
        Some(b) => resolve_posix_path(cwd, b),
        None => cwd.clone(),
    };

    if base_dir.is_some() {
        match fs.stat(&effective_cwd) {
            Ok(st) if st.kind == VfsEntryKind::Directory => {}
            Ok(_) => {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("fd: {}: not a directory\n", base_dir.as_deref().unwrap_or("")),
                    exit_code: 1,
                };
            }
            Err(e) => {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("fd: {}: {e}\n", base_dir.as_deref().unwrap_or("")),
                    exit_code: 1,
                };
            }
        }
    }

    let mut rules = Vec::new();
    for name in &custom_ignore_files {
        let path = resolve_posix_path(&effective_cwd, name);
        match IgnoreFile::read(fs, &path, &effective_cwd, 3) {
            Ok(file) => rules.push(file),
            Err(error) => return BuiltinOutcome { stdout: String::new(), stderr: format!("fd: {}\n", error.message()), exit_code: 1 },
        }
    }
    let explicit_rules = rules.len();

    let mut patterns = Vec::new();
    for source in and_patterns {
        let source = if fold_subject { source.to_lowercase() } else { source };
        let pattern = match mode {
            FdMode::Fixed => Ok(FdPattern::Fixed(source)),
            FdMode::Glob => FdGlob::compile(&source, true).map(FdPattern::Glob),
            FdMode::Regex => {
                let (pattern, insensitive) = if let Some(p) = source.strip_prefix("(?i)") { (p, true) }
                    else if let Some(p) = source.strip_prefix("(?-i)") { (p, false) } else { (source.as_str(), ignore_case) };
                parse_rx_branches(pattern, false, RxDialect::Jq(if insensitive { "i" } else { "" }))
                    .map(|parsed| FdPattern::Regex(ZeroRegex::from_branches([parsed], false, false, false)))
                    .map_err(|error| error.message)
            }
        };
        match pattern {
            Ok(pattern) => patterns.push(pattern),
            Err(error) => return BuiltinOutcome { stdout: String::new(), stderr: format!("fd: {error}\n"), exit_code: 1 },
        }
    }
    let excludes = match excludes.iter().map(|pattern| FdGlob::compile(pattern, false)).collect::<Result<Vec<_>, _>>() {
        Ok(globs) => globs,
        Err(error) => return BuiltinOutcome { stdout: String::new(), stderr: format!("fd: {error}\n"), exit_code: 1 },
    };
    let cfg = FdConfig {
        extensions,
        types,
        min_depth,
        max_depth,
        max_results,
        excludes,
        sizes,
        changed_within_ms,
        changed_before_ms,
        show_hidden,
        respect_ignore,
        no_ignore_vcs,
        follow,
        full_path,
        absolute_path,
        fold_subject,
        prune,
        patterns,
    };

    let format_entry_display = |raw_disp: &str, prefix_cwd: bool| -> String {
        let mut disp = raw_disp.to_string();
        if !strip_cwd_prefix
            && prefix_cwd
            && (has_exec || print0 || list_details)
            && !disp.starts_with('/')
            && !disp.starts_with("./")
            && !disp.starts_with("../")
        {
            disp = format!("./{disp}");
        }
        if let Some(ref psep) = path_separator {
            disp = disp.replace('/', psep);
        }
        disp
    };

    let mut sub_cwd = effective_cwd.clone();
    let mut invoke = |paths: &[String], result: &mut BuiltinOutcome| {
        let mut words = Vec::new();
        let mut substituted = false;
        if list_details {
            words.extend(["ls".to_owned(), "-ld".to_owned()]);
        } else {
            for word in &exec_cmd {
                if has_fd_placeholder(word) {
                    substituted = true;
                    words.extend(paths.iter().map(|p| format_fd_template(word, p)));
                } else { words.push(format_fd_template(word, "")); }
            }
        }
        if !substituted { words.extend_from_slice(paths); }
        let run = exec_sub(&words, &mut sub_cwd);
        let stopped = run.is_err();
        let child = run.unwrap_or_else(std::convert::identity);
        result.stdout.push_str(&child.stdout);
        result.stderr.push_str(&child.stderr);
        if child.exit_code != 0 { result.exit_code = 1; }
        stopped
    };

    let mut result = ok_out("");
    let mut pending = Vec::new();
    let mut found = 0;
    let mut stopped = false;
    let mut visit = |entry: Result<(&str, bool, bool), String>| -> bool {
        match entry {
            Err(e) => {
                result.exit_code = 1;
                stopped = !write(2, &format!("fd: {e}\n"), &mut result);
            }
            Ok((item, is_dir, prefix_cwd)) => {
                found += 1;
                if quiet { return true; }
                let mut disp = format_entry_display(item, prefix_cwd);
                if exec_batch || list_details { pending.push(disp); }
                else if has_exec { stopped = invoke(std::slice::from_ref(&disp), &mut result); }
                else {
                    let dir_sep = path_separator.as_deref().unwrap_or("/");
                    if let Some(fmt) = &format_tpl { disp = format_fd_template(fmt, &disp); }
                    else if is_dir { disp.push_str(dir_sep); }
                    disp.push(if print0 { '\0' } else { '\n' });
                    stopped = !write(1, &disp, &mut result);
                }
                if cfg.max_results.is_some_and(|max| found >= max) { return true; }
            }
        }
        stopped
    };

    'roots: for r in &roots {
        rules.truncate(explicit_rules);
        let full = resolve_posix_path(&effective_cwd, r);
        match fs.stat(&full) {
            Ok(st) if st.kind == VfsEntryKind::Directory => {}
            Ok(_) => {
                if visit(Err(format!("search path '{r}' is not a directory"))) { break; }
                continue;
            }
            Err(e) => {
                if visit(Err(e)) { break; }
                continue;
            }
        }
        if cfg.respect_ignore && !no_ignore_parent {
            for (slash, _) in full.match_indices('/') {
                if full == "/" { break; }
                let dir = if slash == 0 { "/" } else { &full[..slash] };
                if let Err(e) = IgnoreFile::load(&mut rules, fs, dir, None, cfg.no_ignore_vcs) {
                    if visit(Err(e.message())) { break 'roots; }
                    continue 'roots;
                }
            }
        }
        let prefix_cwd = r == ".";
        let label = if prefix_cwd { "" } else { r };
        match walk_fd(
            label,
            "",
            &full,
            0,
            prefix_cwd,
            &cfg,
            &mut rules,
            fs,
            &mut std::collections::BTreeSet::new(),
            &mut visit,
        ) {
            Ok(true) => break,
            Err(error) => { if visit(Err(error)) { break; } }
            Ok(false) => {}
        }
    }

    if quiet && !stopped { result.exit_code = i32::from(found == 0); }
    if !stopped && !pending.is_empty() { invoke(&pending, &mut result); }
    result
}

#[allow(clippy::too_many_arguments)]
fn walk_fd(
    disp: &str,
    rel: &str,
    full: &str,
    depth: usize,
    prefix_cwd: bool,
    cfg: &FdConfig,
    rules: &mut Vec<IgnoreFile>,
    fs: &dyn SafeBashFs,
    ancestors: &mut std::collections::BTreeSet<String>,
    visit: &mut dyn FnMut(Result<(&str, bool, bool), String>) -> bool,
) -> Result<bool, String> {
    if let Some(max_d) = cfg.max_depth {
        if depth > max_d {
            return Ok(false);
        }
    }
    let st = if cfg.follow || depth == 0 {
        fs.stat(full).or_else(|e| if e.starts_with("ENOENT:") { fs.lstat(full) } else { Err(e) })
    } else { fs.lstat(full) };
    let st = match st { Ok(st) => st, Err(e) => return Ok(visit(Err(e))) };
    let is_dir = st.kind == VfsEntryKind::Directory;
    let canonical = if cfg.follow && is_dir {
        let Ok(path) = fs.access_path(full, true) else { return Ok(false); };
        if ancestors.contains(&path) { return Ok(false); }
        Some(path)
    } else { None };

    let mut matched_here = false;
    if depth > 0 {
        let base = basename_posix_path(disp);
        if !cfg.show_hidden && base.starts_with('.') {
            return Ok(false);
        }
        if cfg.excludes.iter().any(|ex| ex.matches(rel, is_dir, true) || ex.matches(&base, is_dir, true)) {
            return Ok(false);
        }
        if IgnoreFile::ignored(rules, full, is_dir) {
            return Ok(false);
        }

        if depth >= cfg.min_depth {
            let mut matches = true;
            if !cfg.types.is_empty() {
                let ordinary: Vec<char> = cfg
                    .types
                    .iter()
                    .copied()
                    .filter(|&c| c != 'e' && c != 'x')
                    .collect();
                let wants_exec = cfg.types.contains(&'x');
                let wants_empty = cfg.types.contains(&'e');

                if !ordinary.is_empty() || wants_exec {
                    let ord_ok = ordinary.iter().any(|&t| match t {
                        'f' => st.kind == VfsEntryKind::File && (st.mode & 0o170000) != 0o020000,
                        'd' => st.kind == VfsEntryKind::Directory,
                        'l' => st.kind == VfsEntryKind::Symlink,
                        _ => false,
                    });
                    let exec_ok =
                        wants_exec && st.kind == VfsEntryKind::File && (st.mode & 0o111) != 0;
                    matches = ord_ok || exec_ok;
                }
                if matches && wants_empty {
                    matches = match st.kind {
                        VfsEntryKind::File => st.size == 0,
                        VfsEntryKind::Directory => fs
                            .read_dir(full)
                            .map(|entries| entries.is_empty())
                            .unwrap_or(false),
                        _ => false,
                    };
                }
            }

            if matches && !cfg.sizes.is_empty() {
                if st.kind != VfsEntryKind::File {
                    matches = false;
                } else {
                    let size = st.size as f64;
                    for &(op, target) in &cfg.sizes {
                        let ok = match op {
                            '+' => size >= target,
                            '-' => size <= target,
                            _ => size == target,
                        };
                        if !ok {
                            matches = false;
                            break;
                        }
                    }
                }
            }

            if matches && let Some(min_ms) = cfg.changed_within_ms {
                if st.mtime_ms <= min_ms {
                    matches = false;
                }
            }
            if matches && let Some(max_ms) = cfg.changed_before_ms {
                if st.mtime_ms >= max_ms {
                    matches = false;
                }
            }

            if matches && !cfg.extensions.is_empty() {
                let lower = base.to_lowercase();
                matches = cfg
                    .extensions
                    .iter()
                    .any(|ext| lower.len() > ext.len() + 1 && lower.ends_with(&format!(".{ext}")));
            }

            if matches && !cfg.patterns.is_empty() {
                let subject = if cfg.full_path { if cfg.absolute_path { full } else { disp } } else { &base };
                let folded;
                let subject = if cfg.fold_subject { folded = subject.to_lowercase(); &folded } else { subject };
                matches = cfg.patterns.iter().all(|pattern| match pattern {
                    FdPattern::Fixed(needle) => subject.contains(needle),
                    FdPattern::Glob(glob) => glob.matches(subject, false, false),
                    FdPattern::Regex(regex) => regex.is_match(subject),
                });
            }

            if matches {
                matched_here = true;
                if visit(Ok((if cfg.absolute_path { full } else { disp }, is_dir, prefix_cwd))) { return Ok(true); }
            }
        }
    }

    if cfg.prune && matched_here {
        return Ok(false);
    }

    if is_dir {
        if let Some(max_d) = cfg.max_depth {
            if depth >= max_d {
                return Ok(false);
            }
        }
        let mut entries = match fs.read_dir(full) {
            Err(e) => return Ok(visit(Err(if e.starts_with("ENOENT:") {
                format!("ENOENT: no such file or directory, realpath '{full}'")
            } else { e }))),
            Ok(entries) => entries,
        };
        if cfg.respect_ignore && let Err(error) = IgnoreFile::load(rules, fs, full, (depth > 0).then_some(entries.as_slice()), cfg.no_ignore_vcs) {
            return match error { RuleError::Read(e) => Ok(visit(Err(e))), RuleError::Pattern(e) => Err(e) };
        }
        let inherited = rules.len();
        entries.sort_unstable_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
        if let Some(path) = &canonical { ancestors.insert(path.clone()); }
        for e in entries {
            if !cfg.show_hidden && e.starts_with('.') {
                continue;
            }
            let child_disp = if disp.is_empty() {
                e.clone()
            } else if disp.ends_with('/') {
                format!("{disp}{e}")
            } else {
                format!("{disp}/{e}")
            };
            let child_rel = if rel.is_empty() {
                e.clone()
            } else {
                format!("{rel}/{e}")
            };
            let child_full = format!("{}/{e}", full.trim_end_matches('/'));
            if walk_fd(
                &child_disp,
                &child_rel,
                &child_full,
                depth + 1,
                prefix_cwd,
                cfg,
                rules,
                fs,
                ancestors,
                visit,
            )? { return Ok(true); }
            rules.truncate(inherited);
        }
        if let Some(path) = canonical { ancestors.remove(&path); }
    }
    Ok(false)
}

fn xargs_display(value: &str) -> String {
    if !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'/' | b'-'))
    {
        return value.to_string();
    }
    let has_ctrl = value
        .chars()
        .any(|c| (c as u32) < 32 || ((c as u32) >= 127 && (c as u32) <= 159));
    if has_ctrl {
        let mut out = String::from("$'");
        for c in value.chars() {
            let code = c as u32;
            if c == '\'' || c == '\\' {
                out.push('\\');
                out.push(c);
            } else if code < 32 || (127..=159).contains(&code) {
                out.push_str(&format!("\\{:03o}", code));
            } else {
                out.push(c);
            }
        }
        out.push('\'');
        return out;
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn parse_xargs_delim_strict(raw: &str) -> Result<char, String> {
    if raw.is_empty() {
        return Err("xargs: invalid delimiter".to_string());
    }
    let ch = match raw {
        "\\n" => '\n',
        "\\t" => '\t',
        "\\r" => '\r',
        "\\0" => '\0',
        "\\\\" => '\\',
        _ => {
            if let Some(hex) = raw.strip_prefix("\\x") {
                if hex.is_empty() || hex.len() > 2 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
                    return Err("xargs: invalid delimiter".to_string());
                }
                let b = u8::from_str_radix(hex, 16)
                    .map_err(|_| "xargs: invalid delimiter".to_string())?;
                if b > 127 {
                    return Err("xargs: invalid delimiter".to_string());
                }
                b as char
            } else if let Some(oct) = raw.strip_prefix('\\') {
                if oct.is_empty() || oct.len() > 3 || !oct.chars().all(|c| ('0'..='7').contains(&c))
                {
                    return Err("xargs: invalid delimiter".to_string());
                }
                let b = u8::from_str_radix(oct, 8)
                    .map_err(|_| "xargs: invalid delimiter".to_string())?;
                if b > 127 {
                    return Err("xargs: invalid delimiter".to_string());
                }
                b as char
            } else {
                let mut chars = raw.chars();
                let Some(first) = chars.next() else {
                    return Err("xargs: invalid delimiter".to_string());
                };
                if chars.next().is_some() || (first as u32) > 127 {
                    return Err("xargs: invalid delimiter".to_string());
                }
                first
            }
        }
    };
    Ok(ch)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum XargsDelimMode {
    Whitespace,
    Null,
    Custom(char),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum XargsBatchMode {
    Default,
    MaxArgs,
    MaxLines,
    Replace,
}

fn cmd_xargs<F>(
    args: &[String],
    input: CommandInput,
    cwd: &mut String,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
    exec_sub: &mut F,
) -> BuiltinOutcome
where
    F: FnMut(&[String], &mut String, &mut String, &mut BTreeMap<String, String>, ChildIo) -> ChildRun,
{
    let CommandInput { text: stdin, file } = input;
    let mut delim_mode = XargsDelimMode::Whitespace;
    let mut batch_mode = XargsBatchMode::Default;
    let mut max_args: Option<usize> = None;
    let mut max_lines: Option<usize> = None;
    let mut max_bytes = usize::MAX;
    let mut eof_marker: Option<String> = None;
    let mut arg_file: Option<String> = None;
    let mut replace_str: Option<String> = None;
    let mut no_run_if_empty = false;
    let mut verbose = false;
    let mut exit_on_size = false;
    let mut slot_var: Option<String> = None;
    let mut cmd_words: Vec<String> = Vec::new();
    let mut end_of_opts = false;

    let usage_err = |msg: &str| BuiltinOutcome {
        stdout: String::new(),
        stderr: format!("xargs: {msg}\n"),
        exit_code: 2,
    };

    let parse_pos_int = |val: &str| -> Option<usize> {
        if val.is_empty() || !val.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let n = val.parse::<usize>().ok()?;
        if n == 0 { None } else { Some(n) }
    };

    let parse_size = |val: &str| if val == "Infinity" { Some(usize::MAX) } else { parse_pos_int(val) };

    let is_valid_ident = |s: &str| -> bool {
        let mut chars = s.chars();
        let Some(first) = chars.next() else {
            return false;
        };
        if !(first.is_ascii_alphabetic() || first == '_') {
            return false;
        }
        chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    };

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if cmd_words.is_empty() && !end_of_opts && a == "--" {
            end_of_opts = true;
            i += 1;
            continue;
        }
        if cmd_words.is_empty() && !end_of_opts && a.starts_with("--") && a.len() > 2 {
            let (opt_name, inline_val) = match a.split_once('=') {
                Some((k, v)) => (k, Some(v)),
                None => (a.as_str(), None),
            };
            let take_val = |inline: Option<&str>, idx: &mut usize| -> Option<String> {
                if let Some(v) = inline {
                    Some(v.to_string())
                } else if *idx + 1 < args.len() {
                    *idx += 1;
                    Some(args[*idx].clone())
                } else {
                    None
                }
            };
            match opt_name {
                "--null" | "--no-run-if-empty" | "--verbose" | "--exit" => {
                    if inline_val.is_some() {
                        return usage_err(&format!("option '{opt_name}' does not take a value"));
                    }
                    match opt_name {
                        "--null" => delim_mode = XargsDelimMode::Null,
                        "--no-run-if-empty" => no_run_if_empty = true,
                        "--verbose" => verbose = true,
                        "--exit" => exit_on_size = true,
                        _ => {}
                    }
                }
                "--replace" => {
                    let repl = match inline_val {
                        None => "{}".to_string(),
                        Some(v) if !v.is_empty() => v.to_string(),
                        Some(_) => return usage_err("replacement string cannot be empty"),
                    };
                    replace_str = Some(repl);
                    batch_mode = XargsBatchMode::Replace;
                }
                "--max-lines" => {
                    let n = match inline_val {
                        None => 1usize,
                        Some(v) => {
                            let Some(parsed) = parse_pos_int(v) else {
                                return usage_err(&format!("invalid number '{v}'"));
                            };
                            parsed
                        }
                    };
                    max_lines = Some(n);
                    batch_mode = XargsBatchMode::MaxLines;
                }
                "--eof" => {
                    let v = inline_val.unwrap_or("");
                    if v.is_empty() {
                        eof_marker = None;
                    } else {
                        eof_marker = Some(v.to_string());
                    }
                }
                "--max-args" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --max-args");
                    };
                    let Some(n) = parse_pos_int(&v) else {
                        return usage_err(&format!("invalid number '{v}'"));
                    };
                    max_args = Some(n);
                    if !(batch_mode == XargsBatchMode::Replace && n == 1) {
                        batch_mode = XargsBatchMode::MaxArgs;
                    }
                }
                "--max-chars" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --max-chars");
                    };
                    let Some(n) = parse_size(&v) else {
                        return usage_err(&format!("invalid number '{v}'"));
                    };
                    max_bytes = n;
                }
                "--max-procs" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --max-procs");
                    };
                    if v.is_empty() || !v.chars().all(|c| c.is_ascii_digit()) {
                        return usage_err(&format!("invalid number '{v}'"));
                    }
                }
                "--delimiter" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --delimiter");
                    };
                    let Ok(ch) = parse_xargs_delim_strict(&v) else {
                        return usage_err("delimiter must be one ASCII byte");
                    };
                    delim_mode = XargsDelimMode::Custom(ch);
                }
                "--arg-file" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --arg-file");
                    };
                    if v.is_empty() {
                        return usage_err("invalid --arg-file value");
                    }
                    arg_file = Some(v);
                }
                "--process-slot-var" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --process-slot-var");
                    };
                    if !is_valid_ident(&v) {
                        return usage_err("invalid environment variable name");
                    }
                    slot_var = Some(v);
                }
                _ => return usage_err(&format!("unrecognized option '{opt_name}'")),
            }
            i += 1;
            continue;
        }
        if cmd_words.is_empty() && !end_of_opts && a.starts_with('-') && a.len() > 1 {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut ci = 0usize;
            while ci < chars.len() {
                match chars[ci] {
                    '0' => delim_mode = XargsDelimMode::Null,
                    'r' => no_run_if_empty = true,
                    't' => verbose = true,
                    'x' => exit_on_size = true,
                    'i' => {
                        let repl = if ci + 1 < chars.len() {
                            chars[ci + 1..].iter().collect::<String>()
                        } else {
                            "{}".to_string()
                        };
                        replace_str = Some(repl);
                        batch_mode = XargsBatchMode::Replace;
                        break;
                    }
                    'l' => {
                        let n = if ci + 1 < chars.len() {
                            let rest: String = chars[ci + 1..].iter().collect();
                            let Some(parsed) = parse_pos_int(&rest) else {
                                return usage_err(&format!("invalid number '{rest}'"));
                            };
                            parsed
                        } else {
                            1usize
                        };
                        max_lines = Some(n);
                        batch_mode = XargsBatchMode::MaxLines;
                        break;
                    }
                    'e' => {
                        if ci + 1 < chars.len() {
                            let rest: String = chars[ci + 1..].iter().collect();
                            eof_marker = Some(rest);
                        } else {
                            eof_marker = None;
                        }
                        break;
                    }
                    'n' | 'L' | 's' | 'P' | 'E' | 'a' | 'I' | 'd' => {
                        let flag = chars[ci];
                        let val = if ci + 1 < chars.len() {
                            chars[ci + 1..].iter().collect::<String>()
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            return usage_err(&format!("missing argument for -{flag}"));
                        };
                        match flag {
                            'n' => {
                                let Some(n) = parse_pos_int(&val) else {
                                    return usage_err(&format!("invalid number '{val}'"));
                                };
                                max_args = Some(n);
                                if !(batch_mode == XargsBatchMode::Replace && n == 1) {
                                    batch_mode = XargsBatchMode::MaxArgs;
                                }
                            }
                            'L' => {
                                let Some(n) = parse_pos_int(&val) else {
                                    return usage_err(&format!("invalid number '{val}'"));
                                };
                                max_lines = Some(n);
                                batch_mode = XargsBatchMode::MaxLines;
                            }
                            's' => {
                                let Some(n) = parse_size(&val) else {
                                    return usage_err(&format!("invalid number '{val}'"));
                                };
                                max_bytes = n;
                            }
                            'P' => {
                                if val.is_empty() || !val.chars().all(|c| c.is_ascii_digit()) {
                                    return usage_err(&format!("invalid number '{val}'"));
                                }
                            }
                            'E' => {
                                if val.is_empty() {
                                    eof_marker = None;
                                } else {
                                    eof_marker = Some(val);
                                }
                            }
                            'a' => {
                                if val.is_empty() {
                                    return usage_err("invalid -a value");
                                }
                                arg_file = Some(val);
                            }
                            'I' => {
                                if val.is_empty() {
                                    return usage_err("replacement string cannot be empty");
                                }
                                replace_str = Some(val);
                                batch_mode = XargsBatchMode::Replace;
                            }
                            'd' => {
                                let Ok(ch) = parse_xargs_delim_strict(&val) else {
                                    return usage_err("delimiter must be one ASCII byte");
                                };
                                delim_mode = XargsDelimMode::Custom(ch);
                            }
                            _ => {}
                        }
                        break;
                    }
                    other => return usage_err(&format!("invalid option -- '{other}'")),
                }
                ci += 1;
            }
            i += 1;
            continue;
        }
        cmd_words.push(a.clone());
        i += 1;
    }

    let implicit_echo = cmd_words.is_empty();
    if implicit_echo {
        cmd_words.push("echo".to_string());
    }

    let base_bytes: usize = cmd_words.iter().map(|w| stream_byte_len(w) + 1).sum();
    if base_bytes >= max_bytes {
        return usage_err("initial arguments exceed command size limit");
    }
    let mut out = String::new();
    let mut err = String::new();
    if delim_mode != XargsDelimMode::Whitespace
        && eof_marker.as_deref().is_some_and(|s| !s.is_empty())
    {
        err.push_str("xargs: warning: the -E option has no effect if -0 or -d is used.\n\n");
        eof_marker = None;
    }

    let input_buf = if let Some(ref af) = arg_file {
        let p = resolve_posix_path(cwd, af);
        match fs.read_file(&p) {
            Ok(b) => String::from_utf8_lossy(&b).into_owned(),
            Err(_) => {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("xargs: ENOENT: no such file or directory, readStream '{p}'\n"),
                    exit_code: 1,
                }
            }
        }
    } else {
        if let Some(source) = file {
            if let Err(e) = source.materialize(stdin) {
                return BuiltinOutcome { stdout: out, stderr: format!("{err}xargs: {e}\n"), exit_code: 1 };
            }
            let mut pos = source.position.get();
            pos.consume(0);
            source.position.set(pos);
            source.unread.borrow_mut().clear();
        }
        std::mem::take(stdin)
    };
    let input_str = input_buf.as_str();

    if !matches!(
        delim_mode,
        XargsDelimMode::Null | XargsDelimMode::Custom('\0')
    ) && input_str.contains('\0')
    {
        err.push_str("xargs: NUL in non-NUL-delimited input\n");
        return BuiltinOutcome {
            stdout: out,
            stderr: err,
            exit_code: 2,
        };
    }

    let mut first_batch = true;
    let mut run_batch =
        |invoke: &[String], out: &mut String, err: &mut String, exit_code: &mut i32| -> Option<i32> {
            let mut before = if std::mem::take(&mut first_batch) { std::mem::take(err) } else { String::new() };
            if verbose {
                let trace = invoke
                    .iter()
                    .map(|w| xargs_display(w))
                    .collect::<Vec<_>>()
                    .join(" ");
                before.push_str(&trace);
                before.push('\n');
            }
            let prev_slot = if let Some(ref sv) = slot_var {
                let old = env.get(sv).cloned();
                env.insert(sv.clone(), "0".to_string());
                Some((sv.clone(), old))
            } else {
                None
            };
            let io = ChildIo::Inherit { stderr_before: &before };
            let result = if arg_file.is_some() {
                exec_sub(invoke, stdin, cwd, env, io)
            } else {
                let res = exec_sub(invoke, &mut String::new(), cwd, env, io);
                if let Some(source) = file { stdin.clone_from(&source.unread.borrow()); }
                res
            };
            if let Some((sv, old)) = prev_slot {
                if let Some(val) = old {
                    env.insert(sv, val);
                } else {
                    env.remove(&sv);
                }
            }
            let res = match result {
                Ok(res) => res,
                Err(failed) => { out.push_str(&failed.stdout); err.push_str(&failed.stderr); return Some(failed.exit_code); }
            };
            out.push_str(&res.stdout);
            err.push_str(&res.stderr);
            if res.exit_code == 255 {
                return Some(124);
            }
            if res.exit_code == 126 || res.exit_code == 127 {
                return Some(res.exit_code);
            }
            if res.exit_code != 0 {
                *exit_code = 123;
            }
            None
        };

    let parsed_items: Vec<(String, usize)> = match delim_mode {
        XargsDelimMode::Null => parse_xargs_delimited_items(input_str, '\0', batch_mode == XargsBatchMode::Replace),
        XargsDelimMode::Custom(d) => parse_xargs_delimited_items(input_str, d, batch_mode == XargsBatchMode::Replace),
        XargsDelimMode::Whitespace => {
            match parse_xargs_whitespace_items(
                input_str,
                batch_mode == XargsBatchMode::Replace,
                batch_mode == XargsBatchMode::MaxLines,
                eof_marker.as_deref(),
            ) {
                Ok(v) => v,
                Err(msg) => {
                    err.push_str(&format!("xargs: {msg}\n"));
                    return BuiltinOutcome {
                        stdout: out,
                        stderr: err,
                        exit_code: 2,
                    };
                }
            }
        }
    };

    if parsed_items.is_empty() {
        if no_run_if_empty || batch_mode == XargsBatchMode::Replace {
            return BuiltinOutcome {
                stdout: out,
                stderr: err,
                exit_code: 0,
            };
        }
        let mut exit_code = 0;
        if let Some(abort_code) = run_batch(&cmd_words, &mut out, &mut err, &mut exit_code) {
            exit_code = abort_code;
        }
        return BuiltinOutcome {
            stdout: out,
            stderr: err,
            exit_code,
        };
    }

    let mut exit_code = 0;
    match batch_mode {
        XargsBatchMode::Replace => {
            let repl = replace_str.as_deref().unwrap_or("{}");
            for (item, _) in parsed_items {
                let item_len = stream_byte_len(&item);
                if delim_mode != XargsDelimMode::Whitespace && item_len >= max_bytes {
                    err.push_str("xargs: single argument exceeds command size limit\n");
                    return BuiltinOutcome { stdout: out, stderr: err, exit_code: 2 };
                }
                let mut invoke = vec![cmd_words[0].clone()];
                let expanded_len = if implicit_echo {
                    base_bytes.saturating_add(item_len + 1)
                } else {
                    cmd_words[1..].iter().fold(stream_byte_len(&cmd_words[0]) + 1, |size, word| {
                        let matches = word.matches(repl).count();
                        let literal = stream_byte_len(word) - matches * stream_byte_len(repl);
                        size.saturating_add(literal + 1).saturating_add(matches.saturating_mul(item_len))
                    })
                };
                if expanded_len > max_bytes {
                    err.push_str("xargs: expanded arguments exceed command size limit\n");
                    return BuiltinOutcome { stdout: out, stderr: err, exit_code: 2 };
                }
                if implicit_echo { invoke.push(item); }
                else { invoke.extend(cmd_words[1..].iter().map(|word| word.replace(repl, &item))); }
                if let Some(abort_code) = run_batch(&invoke, &mut out, &mut err, &mut exit_code) {
                    return BuiltinOutcome {
                        stdout: out,
                        stderr: err,
                        exit_code: abort_code,
                    };
                }
            }
        }
        _ => {
            let max_args = if batch_mode == XargsBatchMode::MaxArgs { max_args } else { None };
            let max_lines = if batch_mode == XargsBatchMode::MaxLines { max_lines } else { None };
            let mut items = parsed_items.into_iter().peekable();
            let mut batch = cmd_words.clone();
            let mut bytes = base_bytes;
            let mut lines = 0;
            while let Some((item, line)) = items.next() {
                let size = stream_byte_len(&item) + 1;
                if size > max_bytes - base_bytes {
                    err.push_str("xargs: single argument exceeds command size limit\n");
                    return BuiltinOutcome { stdout: out, stderr: err, exit_code: 2 };
                }
                if size > max_bytes - bytes {
                    if exit_on_size || max_lines.is_some() {
                        err.push_str("xargs: command size limit exceeded\n");
                        return BuiltinOutcome { stdout: out, stderr: err, exit_code: 2 };
                    }
                    if let Some(code) = run_batch(&batch, &mut out, &mut err, &mut exit_code) {
                        return BuiltinOutcome { stdout: out, stderr: err, exit_code: code };
                    }
                    bytes = base_bytes;
                    batch.truncate(cmd_words.len());
                }
                bytes += size;
                batch.push(item);
                if items.peek().is_none_or(|(_, next)| *next != line) { lines += 1; }
                if Some(batch.len() - cmd_words.len()) == max_args || Some(lines) == max_lines || items.peek().is_none() {
                    if let Some(code) = run_batch(&batch, &mut out, &mut err, &mut exit_code) {
                        return BuiltinOutcome { stdout: out, stderr: err, exit_code: code };
                    }
                    bytes = base_bytes;
                    lines = 0;
                    batch.truncate(cmd_words.len());
                }
            }
        }
    }

    BuiltinOutcome {
        stdout: out,
        stderr: err,
        exit_code,
    }
}

fn parse_xargs_delimited_items(
    input: &str,
    delim: char,
    replace_mode: bool,
) -> Vec<(String, usize)> {
    if input.is_empty() {
        return Vec::new();
    }
    let parts: Vec<&str> = input.split(delim).collect();
    let end = if input.ends_with(delim) {
        parts.len().saturating_sub(1)
    } else {
        parts.len()
    };
    let mut out = Vec::new();
    for (idx, &raw) in parts[..end].iter().enumerate() {
        let mut item = raw.to_string();
        if delim == '\n' && item.ends_with('\r') {
            item.pop();
        }
        if replace_mode && item.is_empty() {
            continue;
        }
        out.push((item, idx + 1));
    }
    out
}

fn parse_xargs_whitespace_items(
    input: &str,
    replace_mode: bool,
    line_mode: bool,
    eof_marker: Option<&str>,
) -> Result<Vec<(String, usize)>, String> {
    let mut out: Vec<(String, usize)> = Vec::new();
    let mut token = String::new();
    let mut in_token = false;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut line_id = 1usize;
    let mut line_tokens: Vec<String> = Vec::new();
    let mut line_has_blank = false;

    let flush_line = |line_tokens: &mut Vec<String>,
                      out: &mut Vec<(String, usize)>,
                      line_id: &mut usize,
                      line_has_blank: &mut bool|
     -> bool {
        if line_tokens.is_empty() {
            *line_has_blank = false;
            return false;
        }
        if let Some(eof) = eof_marker {
            if !replace_mode {
                if let Some(pos) = line_tokens.iter().position(|t| t == eof) {
                    for t in line_tokens.drain(..pos) {
                        out.push((t, *line_id));
                    }
                    line_tokens.clear();
                    return true;
                }
            } else if line_tokens.len() == 1 && line_tokens[0] == eof {
                line_tokens.clear();
                return true;
            }
        }
        if line_mode && *line_has_blank {
            *line_has_blank = false;
            return false;
        }
        for t in line_tokens.drain(..) {
            out.push((t, *line_id));
        }
        *line_id += 1;
        *line_has_blank = false;
        false
    };

    for ch in input.chars() {
        if escaped {
            if ch == '\n' {
                escaped = false;
                continue;
            }
            token.push(ch);
            in_token = true;
            escaped = false;
            line_has_blank = false;
            continue;
        }
        if let Some(q) = quote {
            if ch == q {
                quote = None;
                in_token = true;
            } else if ch == '\n' {
                return Err("unmatched quote".to_string());
            } else {
                token.push(ch);
                in_token = true;
            }
            line_has_blank = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            in_token = true;
            line_has_blank = false;
            continue;
        }
        if ch == '\'' || ch == '"' {
            quote = Some(ch);
            in_token = true;
            line_has_blank = false;
            continue;
        }
        if ch == '\n' {
            if in_token {
                let mut finished = std::mem::take(&mut token);
                if replace_mode {
                    while finished.ends_with(' ') || finished.ends_with('\t') {
                        finished.pop();
                    }
                }
                in_token = false;
                if !replace_mode || !finished.is_empty() {
                    line_tokens.push(finished);
                }
            }
            if flush_line(&mut line_tokens, &mut out, &mut line_id, &mut line_has_blank) {
                return Ok(out);
            }
            continue;
        }
        if ch == ' ' || ch == '\t' || ch == '\r' {
            if replace_mode {
                if in_token && ch != '\r' {
                    token.push(ch);
                }
            } else {
                if in_token {
                    line_tokens.push(std::mem::take(&mut token));
                    in_token = false;
                }
                if ch == ' ' || ch == '\t' {
                    line_has_blank = true;
                }
            }
            continue;
        }
        token.push(ch);
        in_token = true;
        line_has_blank = false;
    }

    if escaped {
        return Err("trailing backslash".to_string());
    }
    if quote.is_some() {
        return Err("unmatched quote".to_string());
    }
    if in_token {
        if replace_mode {
            while token.ends_with(' ') || token.ends_with('\t') {
                token.pop();
            }
        }
        if !replace_mode || !token.is_empty() {
            line_tokens.push(token);
        }
    }
    if replace_mode {
        for t in &mut line_tokens {
            while t.ends_with(' ') || t.ends_with('\t') {
                t.pop();
            }
        }
        line_tokens.retain(|t| !t.is_empty());
    }
    line_has_blank = false;
    let _ = flush_line(&mut line_tokens, &mut out, &mut line_id, &mut line_has_blank);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::MemoryVfs;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn failed_search_stream_does_not_publish_a_count_or_finished_file_stats() {
        let (mut shell, _) = crate::shell::Shell::with_memory_fs();
        for script in ["grep -m2 -c hit", "rg -m2 --stats hit", "rg -m2 -c --stats hit", "rg -m2 --json hit"] {
            let bytes = if script.ends_with("--json hit") { b"hit\0partial" } else { b"hit\npartial" };
            let chunks = [Ok(bytes.to_vec()), Err("input failed".into())];
            let r = shell.exec_with_stream(script, chunks.into_iter()).unwrap();
            assert_eq!(r.exit_code, 2, "{script}");
            assert!(r.stderr.contains("input failed"), "{script}");
            if script.starts_with("grep") { assert_eq!(r.stdout, ""); }
            else if script.ends_with("--json hit") {
                assert!(r.stdout.contains("\"type\":\"match\"") && !r.stdout.contains("\"type\":\"end\""));
                assert!(r.stdout.contains("\"searches\":0"));
            } else {
                assert_eq!(r.stdout.lines().next(), Some(if script.contains(" -c ") { "" } else { "hit" }));
                assert!(r.stdout.contains("0 files searched\n0 bytes printed\n0 bytes searched\n"));
            }
        }
    }

    #[test]
    fn rg_keeps_text_printed_before_a_later_binary_chunk() {
        let (mut shell, _) = crate::shell::Shell::with_memory_fs();
        let chunks = ["hit\nx\n", "n\0hit\ny\n", "later\n"];
        let r = shell.exec_with_stream("rg -m2 -n -C1 hit", chunks.map(|c| Ok(c.as_bytes().to_vec())).into_iter()).unwrap();
        assert_eq!((r.exit_code, r.stdout.as_str(), r.stderr.as_str()), (0, "1:hit\n2-x\nbinary file matches (found \"\\0\" byte around offset 7)\n", ""));
    }

    #[test]
    fn limited_search_leaves_later_chunks_for_the_next_command() {
        let (mut shell, _) = crate::shell::Shell::with_memory_fs();
        for search in ["grep", "rg"] {
            let chunks = ["no\nhi", "t\nctx\n", "omit\nbefore\nhit\n", "ctx2\nextra\n", "later\n"];
            let result = shell.exec_with_stream(&format!("{search} -n -B1 -A1 -m2 hit; cat"), chunks.map(|s| Ok(s.as_bytes().to_vec())).into_iter()).unwrap();
            assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()),
                (0, "1-no\n2:hit\n3-ctx\n--\n5-before\n6:hit\n7-ctx2\nlater\n", ""), "{search}");
            let chunks = [Ok(b"hit\n".to_vec()), Err("read beyond match limit".into())];
            let result = shell.exec_with_stream(&format!("{search} -c -A2 -m1 hit"), chunks.into_iter()).unwrap();
            assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), (0, "1\n", ""), "{search}");
        }
    }

    #[test]
    fn quiet_and_filename_searches_stop_at_the_decisive_chunk() {
        let (mut shell, _) = crate::shell::Shell::with_memory_fs();
        for (script, expected, status) in [
            ("grep -q hit", "", 0), ("grep -l hit", "(standard input)\n", 0),
            ("grep -L hit", "", 0), ("rg -q hit", "", 0),
            ("rg -l hit", "<stdin>\n", 0), ("rg --files-without-match hit", "", 1),
        ] {
            let chunks = [Ok(b"no\nhi".to_vec()), Ok(b"t\nignored\n".to_vec()), Err("read beyond the match".into())];
            let result = shell.exec_with_stream(script, chunks.into_iter()).unwrap();
            assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), (status, expected, ""), "{script}");
        }
        for (script, first, expected) in [
            ("rg -q hit; cat", b"hit\0rest".as_slice(), "later"),
            ("grep -qv other; cat", b"hit\nrest", "later"),
            ("grep -qI hit; cat", b"bad\0record\n", "later"),
            ("rg -q --crlf '^hit$'; cat", b"hit\r\n", "later"),
        ] {
            let chunks = [Ok(first.to_vec()), Ok(b"later".to_vec())];
            let result = shell.exec_with_stream(script, chunks.into_iter()).unwrap();
            assert_eq!((result.stdout.as_str(), result.stderr.as_str()), (expected, ""), "{script}");
        }
    }

    #[test]
    fn rg_pattern_files_and_stdin_use_strict_utf8_and_preserve_blank_patterns() {
        let (mut shell, fs) = crate::shell::Shell::with_memory_fs();
        fs.write_file("/rows", b"alpha\nbeta\n").unwrap();
        for (bytes, output, code) in [
            (b"".as_slice(), "", 1), (b"\n", "alpha\nbeta\n", 0),
            (b"none\n\n", "alpha\nbeta\n", 0), ("\u{feff}alpha\r".as_bytes(), "alpha\n", 0),
            (b"\xff", "", 2),
        ] {
            fs.write_file("/patterns", bytes).unwrap();
            for file in ["/patterns", "-"] {
                let r = shell.exec_with_stream(&format!("rg -f {file} /rows"), std::iter::once(Ok(bytes.to_vec()))).unwrap();
                assert_eq!((r.exit_code, r.stdout.as_str()), (code, output), "{file}: {bytes:?}");
                assert_eq!(r.stderr, if code == 2 { format!("rg: pattern file '{file}' is not UTF-8\n") } else { String::new() });
            }
        }
    }

    #[test]
    fn rg_rejects_nul_patterns_in_the_bounded_matcher_before_opening_targets() {
        let (mut shell, fs) = crate::shell::Shell::with_memory_fs();
        fs.write_file("/lit", b"a\0b").unwrap();
        fs.write_file("/expr", b"a.\0b").unwrap();
        fs.write_file("/rows", b"a\0b\n").unwrap();
        for (args, expected) in [
            ("-f /lit", "bounded regex unsupported: rg literal patterns require non-NUL Unicode scalars for UTF-8"),
            ("-f /expr", "unsupported ERE profile at 2: expected non-NUL Unicode scalars"),
            ("-F -f /expr", "bounded regex unsupported: rg literal patterns require non-NUL Unicode scalars for UTF-8"),
        ] {
            let result = shell.exec(&format!("rg {args} /absent")).unwrap();
            assert_eq!((result.exit_code, result.stderr), (2, format!("rg: {expected}\n")));
            let quiet = shell.exec(&format!("rg --no-messages {args} /absent")).unwrap();
            assert_eq!((quiet.exit_code, quiet.stderr.as_str()), (2, ""));
        }
        assert_eq!(shell.exec("rg -a -f /lit /rows").unwrap().stdout, "a\0b\n");
    }

    #[test]
    fn unit_is_known_command_and_which_parity() {
        assert!(is_known_command("op"));
        assert!(is_known_command("gh"));
        assert!(is_known_command("sqlite3"));
        assert!(is_known_command("bzip2"));
        assert!(is_known_command("xz"));
        assert!(is_known_command("zstd"));
        assert!(!is_known_command("definitely_not_a_cmd"));

        let vfs = MemoryVfs::new();
        let mut cwd = "/".to_string();
        let mut env = BTreeMap::new();
        let which_out = try_run_search_command(
            "which",
            &args(&["op", "gh", "sqlite3"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            |_, _, _, _| BuiltinOutcome {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
            },
        )
        .unwrap();
        assert_eq!(which_out.exit_code, 0);
        assert_eq!(which_out.stdout, "/bin/op\n/bin/gh\n/bin/sqlite3\n");
    }

    #[test]
    fn fd_ignore_rules_keep_their_base_and_source_priority() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/work/sub").unwrap();
        for (path, data) in [
            (".fdignore", "!sub/pinned\n/local\n"), ("sub/.gitignore", "pinned\nignored\n"),
            ("rules", "sub/drop\n"), ("local", ""), ("sub/local", ""), ("sub/pinned", ""),
            ("sub/ignored", ""), ("sub/drop", ""),
        ] { fs.write_file(&format!("/work/{path}"), data.as_bytes()).unwrap(); }
        for (flags, stdout) in [
            ("-tf", "rules\nsub/local\nsub/pinned\n"),
            ("-Itf", "local\nrules\nsub/ignored\nsub/local\nsub/pinned\n"),
        ] {
            let r = try_run_search_command("fd", &args(&[flags, "--ignore-file", "rules"]), "",
                &mut "/work".to_owned(), &mut BTreeMap::new(), &fs, |_, _, _, _| unreachable!()).unwrap();
            assert_eq!((r.exit_code, r.stdout.as_str(), r.stderr.as_str()), (0, stdout, ""), "{flags}");
        }
    }

    #[test]
    fn fd_bad_nested_rule_stops_only_that_root() {
        let fs = MemoryVfs::new();
        for dir in ["/w/a", "/w/b", "/w/c", "/v"] { fs.mkdir_all(dir).unwrap(); }
        for path in ["/w/a/good", "/w/b/bad", "/w/c/later", "/v/second"] { fs.write_file(path, b"").unwrap(); }
        fs.write_file("/w/b/.ignore", b"x{").unwrap();
        let r = try_run_search_command("fd", &args(&["-tf", "", ".", "/v"]), "", &mut "/w".to_owned(),
            &mut BTreeMap::new(), &fs, |_, _, _, _| unreachable!()).unwrap();
        assert_eq!((r.exit_code, r.stdout.as_str(), r.stderr.as_str()), (1, "a/good\n/v/second\n", "fd: invalid glob: unclosed glob brace\n"));
    }

    #[test]
    fn fd_ignore_read_errors_report_the_file_and_preserve_preceding_matches() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/work/z").unwrap();
        for path in ["a", "z/a", "z/.ignore"] { fs.write_file(&format!("/work/{path}"), b"").unwrap(); }
        fs.chmod("/work/z/.ignore", 0).unwrap();
        for (opts, stdout, stderr) in [
            (vec!["-tf"], "a\n", "fd: EACCES: permission denied, readFile '/work/z/.ignore'\n"),
            (vec!["--ignore-file", "absent"], "", "fd: ENOENT: no such file or directory, readFile '/work/absent'\n"),
            (vec!["--ignore-file", "z"], "", "fd: EISDIR: illegal operation on a directory, readFile '/work/z'\n"),
        ] {
            let r = try_run_search_command("fd", &args(&opts), "", &mut "/work".to_owned(),
                &mut BTreeMap::new(), &fs, |_, _, _, _| unreachable!()).unwrap();
            assert_eq!((r.exit_code, r.stdout.as_str(), r.stderr.as_str()), (1, stdout, stderr));
        }
    }

    #[test]
    fn fd_compiles_patterns_in_the_last_selected_mode_and_matches_display_paths() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/w/b").unwrap();
        for name in ["AÄ.txt", "aä.txt", "a.X", "b/a.x", "b/b.x"] { fs.write_file(&format!("/w/{name}"), b"").unwrap(); }
        for (argv, stdout, stderr) in [
            (vec!["-gp", "*.x"], "a.X\n", ""),
            (vec!["-gp", "**/*.x"], "a.X\nb/a.x\nb/b.x\n", ""),
            (vec!["-gp", "b/{a,b}.x"], "b/a.x\nb/b.x\n", ""),
            (vec!["-Fg", "*.X"], "a.X\n", ""), (vec!["-gF", "*.X"], "", ""),
            (vec!["-F", "ä"], "AÄ.txt\naä.txt\n", ""), (vec!["-F", "Ä"], "AÄ.txt\n", ""),
            (vec!["(?i)A.X"], "a.X\nb/a.x\n", ""), (vec!["(?-i)a.x"], "b/a.x\n", ""),
            (vec!["(?=a)"], "AÄ.txt\na.X\naä.txt\nb/a.x\n", ""),
            (vec!["["], "", "fd: unterminated bracket expression\n"),
            (vec!["-g", "["], "", "fd: invalid glob: unclosed glob character class\n"),
        ] {
            let r = try_run_search_command("fd", &args(&argv), "", &mut "/w".to_owned(),
                &mut BTreeMap::new(), &fs, |_, _, _, _| unreachable!()).unwrap();
            assert_eq!((r.exit_code, r.stdout.as_str(), r.stderr.as_str()), (i32::from(!stderr.is_empty()), stdout, stderr), "{argv:?}");
        }
    }

    #[test]
    fn fd_glob_classes_preserve_literal_backslashes_and_portable_diagnostics() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/w").unwrap();
        for name in [r"\", "n", "z"] { fs.write_file(&format!("/w/{name}"), b"").unwrap(); }
        for (pattern, stdout, stderr) in [
            (r"[\n]", "\\\nn\n", ""),
            (r"[^\]", "n\nz\n", ""),
            ("^?a[z-a]", "", "fd: invalid ERE at 8: descending range\n"),
            ("[a-[]", "", "fd: invalid ERE at 4: nonliteral range endpoint\n"),
            ("[ü]", "", "fd: unsupported ERE profile at 1: only non-NUL ASCII in the C/POSIX profile\n"),
            ("**é", "", "fd: unsupported ERE profile at 0: only non-NUL ASCII in the C/POSIX profile\n"),
            ("[[:digit:]]", "", "fd: invalid ERE at 1: unclosed bracket expression\n"),
            ("[[:madeup:]]", "", "fd: invalid ERE at 2: unknown character class\n"),
            ("[[.a.]]", "", "fd: unsupported ERE profile at 2: collating or equivalence element\n"),
        ] {
            let r = try_run_search_command("fd", &args(&["-Ig", pattern]), "", &mut "/w".to_owned(),
                &mut BTreeMap::new(), &fs, |_, _, _, _| unreachable!()).unwrap();
            assert_eq!((r.exit_code, r.stdout.as_str(), r.stderr.as_str()), (i32::from(!stderr.is_empty()), stdout, stderr), "{pattern}");
        }
    }

    #[test]
    fn fd_exclude_globs_match_components_directories_and_alternatives() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/work/sub/deep").unwrap();
        for name in ["keep", "sub/item.txt", "sub/deep/item.log"] { fs.write_file(&format!("/work/{name}"), b"").unwrap(); }
        for (glob, stdout, stderr) in [
            ("sub/*.{txt,log}", "keep\nsub/deep/item.log\n", ""),
            ("/sub/**/item.[lt]*", "keep\n", ""),
            ("keep/", "keep\nsub/deep/item.log\nsub/item.txt\n", ""),
            ("sub/deep/", "keep\nsub/item.txt\n", ""),
            ("a{", "", "fd: invalid glob: unclosed glob brace\n"),
        ] {
            let r = try_run_search_command("fd", &args(&["-Itf", "-E", glob]), "", &mut "/work".to_owned(),
                &mut BTreeMap::new(), &fs, |_, _, _, _| unreachable!()).unwrap();
            assert_eq!((r.stdout.as_str(), r.stderr.as_str(), r.exit_code), (stdout, stderr, i32::from(!stderr.is_empty())), "{glob}");
        }
    }

    #[test]
    fn fd_limits_results_in_javascript_filename_order() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/work").unwrap();
        for file in ["\u{e000}", "😀"] { fs.write_file(&format!("/work/{file}"), b"").unwrap(); }
        let result = try_run_search_command("fd", &args(&["-1"]), "", &mut "/work".to_owned(),
            &mut BTreeMap::new(), &fs, |_, _, _, _| unreachable!()).unwrap();
        assert_eq!(result.stdout, "😀\n");
    }

    #[test]
    fn fd_aliases_share_operand_parsing_and_validate_flags_before_help() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/w").unwrap();
        for name in ["a.txt", "b.c"] { fs.write_file(&format!("/w/{name}"), b"").unwrap(); }
        for (argv, stdout, error) in [
            (vec!["--one"], "a.txt\n", ""), (vec!["--format="], "\n\n", ""),
            (vec!["-S", "bad", "-V"], "fd (safe-bash)\n", ""),
            (vec!["--threads", "1"], "", "unrecognized option '--threads'"),
            (vec!["--help", "-j"], "", "unrecognized option '--j'"),
            (vec!["--unknown="], "", "option --unknown does not take a value"),
            (vec!["--change-older-than", "@0"], "", "unrecognized option '--change-older-than'"),
            (vec!["-tc"], "", "invalid file type 'c'"), (vec!["-t", " f "], "", "invalid file type ' f '"),
            (vec!["--max-depth=4294967296"], "a.txt\nb.c\n", ""),
            (vec!["--max-depth=9007199254740992"], "", "invalid count '9007199254740992'"),
            (vec!["-d=2"], "", "invalid count '=2'"), (vec!["-e"], "", "option --extension requires a value"),
        ] {
            let r = try_run_search_command("fd", &args(&argv), "", &mut "/w".to_owned(),
                &mut BTreeMap::new(), &fs, |_, _, _, _| unreachable!()).unwrap();
            let stderr = if error.is_empty() { String::new() } else { format!("fd: {error}\n") };
            assert_eq!((r.exit_code, r.stdout.as_str(), r.stderr), (if error.is_empty() { 0 } else { 2 }, stdout, stderr), "{argv:?}");
        }
    }

    #[test]
    fn fd_keeps_explicit_root_spelling_and_always_marks_directories() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/w/d_").unwrap();
        fs.write_file("/w/d_/a", b"").unwrap();
        for (opts, stdout) in [
            (vec!["--strip-cwd-prefix", "", "./d_"], "./d_/a\n"),
            (vec!["-0", "--strip-cwd-prefix", "", "./d_"], "./d_/a\0"),
            (vec!["--format={}", "", "d_//"], "d_//a\n"),
            (vec!["--path-separator=_"], "d__\nd__a\n"),
        ] {
            let r = try_run_search_command("fd", &args(&opts), "", &mut "/w".to_owned(),
                &mut BTreeMap::new(), &fs, |_, _, _, _| unreachable!()).unwrap();
            assert_eq!((r.exit_code, r.stdout.as_str()), (0, stdout), "{opts:?}");
        }
    }

    #[test]
    fn fd_size_units_do_not_depend_on_pointer_width() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/work").unwrap();
        fs.write_file("/work/needle", &[0; 1024]).unwrap();
        for (spec, code, output) in [
            ("1KiB", 0, "needle\n"), ("1KB", 0, ""),
            ("-1TB", 0, "needle\n"), ("+1Ti", 0, ""),
            ("-18446744073709551616B", 0, "needle\n"),
            ("1024", 2, ""), (" 1kib", 2, ""),
        ] {
            let result = try_run_search_command("fd", &args(&["-S", spec, "needle"]), "",
                &mut "/work".to_owned(), &mut BTreeMap::new(), &fs, |_, _, _, _| unreachable!()).unwrap();
            assert_eq!((result.exit_code, result.stdout.as_str()), (code, output), "{spec}: {}", result.stderr);
        }
    }

    #[test]
    fn fd_compares_modification_times_at_exclusive_cutoffs() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/work").unwrap();
        fs.write_file("/work/needle", b"").unwrap();
        fs.set_mtime("/work/needle", 1000).unwrap();
        for (flag, spec, code, output) in [
            ("--changed-before", "@1", 0, ""),
            ("--changed-within", "@1", 0, ""),
            ("--changed-before", "@1.001", 0, "needle\n"),
            ("--changed-within", "@-0.5", 0, "needle\n"),
            ("--changed-before", "1970-01-01T01:00:01.001+01:00", 0, "needle\n"),
            ("--changed-before", "999999999999999999999999weeks", 0, ""),
            ("--changed-before", "1.25 MS", 0, "needle\n"),
            ("--changed-before", "1hrs", 2, ""),
        ] {
            let result = try_run_search_command("fd", &args(&[flag, spec, "needle"]), "",
                &mut "/work".to_owned(), &mut BTreeMap::new(), &fs, |_, _, _, _| unreachable!()).unwrap();
            assert_eq!((result.exit_code, result.stdout.as_str()), (code, output), "{flag} {spec}: {}", result.stderr);
        }
    }

    #[test]
    fn fd_follow_skips_active_directory_cycles_and_keeps_independent_aliases() {
        let fs = MemoryVfs::new();
        fs.write_file("/work/tree/file", b"ok").unwrap();
        fs.symlink("tree", "/work/alias").unwrap();
        fs.symlink("..", "/work/tree/back").unwrap();
        fs.symlink(".", "/work/tree/self").unwrap();
        for (argv, expected) in [
            (vec!["-LI", "-d4"], "alias/\nalias/file\ntree/\ntree/file\n"),
            (vec!["-I", "-tl"], "alias\ntree/back\ntree/self\n"),
            (vec!["-I", "-tf", ".", "alias"], "alias/file\n"),
        ] {
            let r = try_run_search_command("fd", &args(&argv), "", &mut "/work".into(), &mut BTreeMap::new(), &fs,
                |_, _, _, _| unreachable!()).unwrap();
            assert_eq!((r.exit_code, r.stdout.as_str(), r.stderr.as_str()), (0, expected, ""));
        }
    }

    #[test]
    fn find_flushes_exec_batches_at_the_path_count_and_byte_boundaries() {
        let fs = MemoryVfs::new();
        for (path, count, first) in [("a".to_owned(), 1001, 1000), ("é".repeat(63) + "x", 513, 512)] {
            fs.write_file(&format!("/{path}"), b"").unwrap();
            let mut words = vec![path; count];
            words.extend(args(&["-exec", "process", "{}", "+"]));
            let mut batches = Vec::new();
            let result = try_run_search_command("find", &words, "", &mut "/".into(), &mut BTreeMap::new(), &fs,
                |argv, _, _, _| {
                    batches.push(argv.len() - 1);
                    BuiltinOutcome { stdout: format!("{}\n", argv.len() - 1), stderr: String::new(), exit_code: i32::from(batches.len() == 1) }
                }).unwrap();
            assert_eq!(batches, [first, 1]);
            assert_eq!((result.exit_code, result.stdout), (1, format!("{first}\n1\n")));
        }
    }

    #[test]
    fn xargs_size_limits_distinguish_initial_arguments_records_and_expanded_batches() {
        let fs = MemoryVfs::new();
        for (options, input, output, error) in [
            ("-s Infinity echo", "abc", "abc\n", ""),
            ("-s 5 echo", "abc", "", "initial arguments exceed command size limit"),
            ("-s 8 echo", "abc", "", "single argument exceeds command size limit"),
            ("-s 9 echo", "abc def", "abc\ndef\n", ""),
            ("-s 9 -x echo", "abc def", "", "command size limit exceeded"),
            ("-s 9 -L1 echo", "abc def", "", "command size limit exceeded"),
            ("-s 9 -L1 echo", "abc\ntoolong", "abc\n", "single argument exceeds command size limit"),
            ("-s 11 -I{} echo {}{}", "abc", "", "expanded arguments exceed command size limit"),
            ("-s 12 -I{} echo {}{}", "abc", "abcabc\n", ""),
            ("-s 8 -0 -I{} echo", "abc\ndef\n", "", "single argument exceeds command size limit"),
            ("-s 7 -0 echo", "\u{e0ff}", "\u{e0ff}\n", ""),
        ] {
            let result = try_run_search_command("xargs", &args(&options.split_whitespace().collect::<Vec<_>>()),
                input, &mut "/".into(), &mut BTreeMap::new(), &fs,
                |words, _, _, _| ok_out(&format!("{}\n", words[1..].join(" "))),
            ).unwrap();
            let stderr = if error.is_empty() { String::new() } else { format!("xargs: {error}\n") };
            assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr), (if error.is_empty() { 0 } else { 2 }, output, stderr), "{options}");
        }
    }

    #[test]
    fn xargs_replaces_only_initial_arguments_of_an_explicit_command() {
        let fs = MemoryVfs::new();
        for (operands, expected) in [
            (vec![], vec!["echo", "abc"]),
            (vec!["show"], vec!["show"]),
            (vec!["show", "literal"], vec!["show", "literal"]),
            (vec!["show{}", "{}x{}"], vec!["show{}", "abcxabc"]),
        ] {
            let mut words = args(&["-I{}"]);
            words.extend(args(&operands));
            let mut invocations = Vec::new();
            let result = try_run_search_command("xargs", &words, "abc\n", &mut "/".into(),
                &mut BTreeMap::new(), &fs, |words, _, _, _| {
                    invocations.push(words.to_vec());
                    ok_out("")
                }).unwrap();
            assert_eq!(result.exit_code, 0);
            assert_eq!(invocations, vec![expected]);
        }
    }

    #[test]
    fn unit_grep_rg_find_fd_and_xargs() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work/sub").unwrap();
        vfs.write_file("/work/a.txt", b"alpha:10\nbeta:20\nALPHA:30\n")
            .unwrap();
        vfs.write_file("/work/sub/b.rs", b"fn main() { println!(\"beta\"); }\n")
            .unwrap();

        let mut cwd = "/work".to_string();
        let mut env = BTreeMap::new();

        let grep_out = try_run_search_command(
            "grep",
            &args(&["-i", "-n", "^alpha", "a.txt"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            |_, _, _, _| unreachable!(),
        )
        .unwrap();
        assert_eq!(grep_out.exit_code, 0);
        assert_eq!(grep_out.stdout, "1:alpha:10\n3:ALPHA:30\n");

        let rg_out = try_run_search_command(
            "rg",
            &args(&["--files", "/work"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            |_, _, _, _| unreachable!(),
        )
        .unwrap();
        assert_eq!(rg_out.exit_code, 0);
        assert!(rg_out.stdout.contains("/work/a.txt"));
        assert!(rg_out.stdout.contains("/work/sub/b.rs"));

        let find_out = try_run_search_command(
            "find",
            &args(&["/work", "-name", "*.rs"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            |_, _, _, _| unreachable!(),
        )
        .unwrap();
        assert_eq!(find_out.exit_code, 0);
        assert_eq!(find_out.stdout, "/work/sub/b.rs\n");

        let xargs_out = try_run_search_command(
            "xargs",
            &args(&["-n", "2", "echo"]),
            "one two three",
            &mut cwd,
            &mut env,
            &vfs,
            |sub_words, _, _, _| BuiltinOutcome {
                stdout: format!("{}\n", sub_words[1..].join(" ")),
                stderr: String::new(),
                exit_code: 0,
            },
        )
        .unwrap();
        assert_eq!(xargs_out.exit_code, 0);
        assert_eq!(xargs_out.stdout, "one two\nthree\n");
    }


    #[test]
    fn unit_rg_count_invert_and_find_maxdepth() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work/a/b").unwrap();
        vfs.write_file("/work/a/top.txt", b"match_me\nskip_me\nmatch_me_too\n").unwrap();
        vfs.write_file("/work/a/b/deep.txt", b"match_me\n").unwrap();
        let mut cwd = "/work".to_string();
        let mut env = BTreeMap::new();

        let rg_c = try_run_search_command(
            "rg",
            &args(&["-c", "match_me", "/work/a/top.txt"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            |_, _, _, _| BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 },
        )
        .unwrap();
        assert_eq!(rg_c.exit_code, 0);
        assert!(rg_c.stdout.trim().ends_with("2"));

        let find_d1 = try_run_search_command(
            "find",
            &args(&["/work/a", "-maxdepth", "1", "-name", "*.txt"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            |_, _, _, _| BuiltinOutcome { stdout: String::new(), stderr: String::new(), exit_code: 0 },
        )
        .unwrap();
        assert_eq!(find_d1.exit_code, 0);
        assert_eq!(find_d1.stdout.trim(), "/work/a/top.txt");
    }

    #[test]
    fn unit_fd_extension_filter_and_fgrep_fixed_strings() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/repo/pkg").unwrap();
        vfs.write_file("/repo/pkg/lib.ts", b"a.b*c\nplain\n").unwrap();
        vfs.write_file("/repo/pkg/readme.md", b"docs\n").unwrap();
        let mut cwd = "/repo".to_string();
        let mut env = BTreeMap::new();

        let fd_out = try_run_search_command(
            "fd",
            &args(&["-e", "ts", ".", "/repo"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            |_, _, _, _| unreachable!(),
        )
        .unwrap();
        assert_eq!(fd_out.exit_code, 0);
        assert!(fd_out.stdout.contains("lib.ts") && !fd_out.stdout.contains("readme.md"));

        let fgrep_out = try_run_search_command(
            "fgrep",
            &args(&["a.b*c", "/repo/pkg/lib.ts"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            |_, _, _, _| unreachable!(),
        )
        .unwrap();
        assert_eq!(fgrep_out.exit_code, 0);
        assert_eq!(fgrep_out.stdout, "a.b*c
");
    }

    #[test]
    fn unit_grep_context_rg_replace_find_prune_printf_fd_placeholders_and_xargs_eof() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work/keep").unwrap();
        vfs.mkdir_all("/work/skip").unwrap();
        vfs.write_file("/work/keep/mod.ts", b"id=42 name=alice\n").unwrap();
        vfs.write_file("/work/skip/ign.ts", b"id=99 name=bob\n").unwrap();
        let mut cwd = "/work".to_string();
        let mut env = BTreeMap::new();

        let grep_ctx = try_run_search_command(
            "grep",
            &args(&["-C", "1", "HIT"]),
            "L1\nHIT1\nL3\nL4\nL5\nHIT2\nL7\n",
            &mut cwd,
            &mut env,
            &vfs,
            |_, _, _, _| unreachable!(),
        )
        .unwrap();
        assert_eq!(grep_ctx.exit_code, 0);
        assert_eq!(grep_ctx.stdout, "L1\nHIT1\nL3\n--\nL5\nHIT2\nL7\n");

        let rg_repl = try_run_search_command(
            "rg",
            &args(&["-N", "id=([0-9]+) name=([a-z]+)", "-r", "$2:$1", "/work/keep/mod.ts"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            |_, _, _, _| unreachable!(),
        )
        .unwrap();
        assert_eq!(rg_repl.exit_code, 0);
        assert_eq!(rg_repl.stdout, "alice:42\n");

        let find_pf = try_run_search_command(
            "find",
            &args(&["/work", "-name", "skip", "-prune", "-o", "-type", "f", "-printf", "%f:%y\\n"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            |_, _, _, _| unreachable!(),
        )
        .unwrap();
        assert_eq!(find_pf.exit_code, 0);
        assert_eq!(find_pf.stdout, "mod.ts:f\n");

        let fd_exec = try_run_search_command(
            "fd",
            &args(&["-e", "ts", ".", "/work/keep", "-x", "echo", "{/}|{/.}"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            |sub_words, _, _, _| BuiltinOutcome {
                stdout: format!("{}\n", sub_words[1..].join(" ")),
                stderr: String::new(),
                exit_code: 0,
            },
        )
        .unwrap();
        assert_eq!(fd_exec.exit_code, 0);
        assert_eq!(fd_exec.stdout, "mod.ts|mod\n");

        let xargs_eof = try_run_search_command(
            "xargs",
            &args(&["-E", "STOP", "echo"]),
            "alpha beta STOP gamma\n",
            &mut cwd,
            &mut env,
            &vfs,
            |sub_words, _, _, _| BuiltinOutcome {
                stdout: format!("{}\n", sub_words[1..].join(" ")),
                stderr: String::new(),
                exit_code: 0,
            },
        )
        .unwrap();
        assert_eq!(xargs_eof.exit_code, 0);
        assert_eq!(xargs_eof.stdout, "alpha beta\n");
    }

    #[test]
    fn unit_grep_byte_offsets_group_separator_and_find_perm_prune() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work/keep").unwrap();
        vfs.mkdir_all("/work/vendor").unwrap();
        vfs.write_file("/work/pats.txt", b"WARN\nFATAL\n").unwrap();
        vfs.write_file("/work/keep/run.sh", b"123456").unwrap();
        vfs.chmod("/work/keep/run.sh", 0o755).unwrap();
        vfs.write_file("/work/vendor/skip.sh", b"999").unwrap();
        vfs.chmod("/work/vendor/skip.sh", 0o755).unwrap();
        let mut cwd = "/work".to_string();
        let mut env = BTreeMap::new();

        let grep_res = try_run_search_command(
            "grep",
            &args(&["-n", "-b", "-C", "1", "--group-separator====", "-f", "/work/pats.txt"]),
            "INFO boot\nWARN disk\nINFO steady\nINFO gap\nINFO idle\nFATAL crash\nINFO done\n",
            &mut cwd,
            &mut env,
            &vfs,
            |_, _, _, _| unreachable!(),
        )
        .unwrap();
        assert_eq!(grep_res.exit_code, 0);
        assert!(grep_res.stdout.contains("===\n5-41-INFO idle\n6:51:FATAL crash\n"));

        let find_res = try_run_search_command(
            "find",
            &args(&["/work", "-name", "vendor", "-prune", "-o", "-type", "f", "-perm", "755", "-printf", "%f|%s\\n"]),
            "",
            &mut cwd,
            &mut env,
            &vfs,
            |_, _, _, _| unreachable!(),
        )
        .unwrap();
        assert_eq!(find_res.exit_code, 0);
        assert_eq!(find_res.stdout, "run.sh|6\n");
    }

    #[test]
    fn unit_search_diagnostics_help_version_and_ripgrep_config_match_typescript() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        vfs.write_file("/work/rg.conf", b"# comment\n--ignore-case\n").unwrap();
        vfs.write_file("/work/data.txt", b"HELLO\nworld\n").unwrap();
        let mut cwd = "/work".to_string();
        let mut env = BTreeMap::new();

        let rg_v = try_run_search_command("rg", &args(&["-V"]), "", &mut cwd, &mut env, &vfs, |_, _, _, _| unreachable!()).unwrap();
        assert_eq!(rg_v.exit_code, 0);
        assert_eq!(rg_v.stdout, "rg (safe-bash bounded implementation)\n");

        let rg_ver = try_run_search_command("rg", &args(&["--version"]), "", &mut cwd, &mut env, &vfs, |_, _, _, _| unreachable!()).unwrap();
        assert_eq!(rg_ver.exit_code, 0);
        assert!(rg_ver.stdout.starts_with("rg (safe-bash bounded implementation)\nRegex engine:"));

        env.insert("RIPGREP_CONFIG_PATH".to_string(), "/work/rg.conf".to_string());
        let rg_cfg = try_run_search_command("rg", &args(&["hello", "/work/data.txt"]), "", &mut cwd, &mut env, &vfs, |_, _, _, _| unreachable!()).unwrap();
        assert_eq!(rg_cfg.exit_code, 0);
        assert_eq!(rg_cfg.stdout, "HELLO\n");

        let rg_nocfg = try_run_search_command("rg", &args(&["--no-config", "hello", "/work/data.txt"]), "", &mut cwd, &mut env, &vfs, |_, _, _, _| unreachable!()).unwrap();
        assert_eq!(rg_nocfg.exit_code, 1);
        env.remove("RIPGREP_CONFIG_PATH");

        let fd_v = try_run_search_command("fd", &args(&["-V"]), "", &mut cwd, &mut env, &vfs, |_, _, _, _| unreachable!()).unwrap();
        assert_eq!(fd_v.exit_code, 0);
        assert_eq!(fd_v.stdout, "fd (safe-bash)\n");

        let grep_s = try_run_search_command("grep", &args(&["-s", "HELLO", "/work/data.txt", "/work/missing.txt"]), "", &mut cwd, &mut env, &vfs, |_, _, _, _| unreachable!()).unwrap();
        assert_eq!(grep_s.exit_code, 2);
        assert_eq!(grep_s.stdout, "/work/data.txt:HELLO\n");
        assert_eq!(grep_s.stderr, "");
    }
}
