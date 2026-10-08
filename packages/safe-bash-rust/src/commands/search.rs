use crate::shell::builtins::BuiltinOutcome;
use crate::shell::expand::glob_match;
use crate::vfs::{
    SafeBashFs, VfsEntryKind, basename_posix_path, normalize_posix_path, resolve_posix_path,
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
    match cmd {
        "grep" | "egrep" | "fgrep" | "rgrep" => Some(cmd_grep(
            cmd,
            args,
            stdin,
            cwd,
            fs,
            cmd == "fgrep",
        )),
        "rg" => Some(cmd_rg(args, stdin, cwd, fs)),
        "find" => Some(cmd_find(args, cwd, env, fs, &mut exec_sub)),
        "fd" => Some(cmd_fd(args, cwd, env, fs, &mut exec_sub)),
        "xargs" => Some(cmd_xargs(args, stdin, cwd, env, fs, &mut exec_sub)),
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
    let Some(path_str) = env.get("PATH").cloned() else {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 1,
        };
    };
    if path_str.is_empty() {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 1,
        };
    }
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
            let full = resolve_posix_path(cwd, name);
            if is_which_executable(fs, &full) {
                found.push(name.clone());
            }
        } else {
            for dir in &path_dirs {
                let search_dir = if dir.is_empty() { "." } else { *dir };
                let candidate = if search_dir == "/" {
                    format!("/{name}")
                } else {
                    format!("{}/{name}", search_dir.trim_end_matches('/'))
                };
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
            && is_known_command(cmd)
            && !is_pure_shell_builtin(cmd)
        {
            return true;
        }
    }
    false
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
    )
}

#[derive(Clone)]
pub struct ZeroRegex {
    patterns: Vec<String>,
    ignore_case: bool,
    fixed_strings: bool,
    word_regexp: bool,
    line_regexp: bool,
}

impl ZeroRegex {
    pub fn new(
        patterns: Vec<String>,
        ignore_case: bool,
        fixed_strings: bool,
        word_regexp: bool,
        line_regexp: bool,
    ) -> Self {
        Self {
            patterns,
            ignore_case,
            fixed_strings,
            word_regexp,
            line_regexp,
        }
    }

    pub fn is_match(&self, text: &str) -> bool {
        !self.find_all(text).is_empty()
    }

    pub fn find_all(&self, text: &str) -> Vec<(usize, usize)> {
        let mut results = Vec::new();
        for pat in &self.patterns {
            for m in find_single_pattern(
                pat,
                text,
                self.ignore_case,
                self.fixed_strings,
                self.word_regexp,
                self.line_regexp,
            ) {
                results.push(m);
            }
        }
        results.sort_by_key(|&(s, e)| (s, e));
        results.dedup();
        results
    }
}

fn has_unescaped_trailing_dollar(pat: &str) -> bool {
    if !pat.ends_with('$') {
        return false;
    }
    let before = &pat[..pat.len() - 1];
    let backslashes = before.chars().rev().take_while(|&c| c == '\\').count();
    backslashes.is_multiple_of(2)
}

fn find_single_pattern(
    pat: &str,
    text: &str,
    ignore_case: bool,
    fixed_strings: bool,
    word_regexp: bool,
    line_regexp: bool,
) -> Vec<(usize, usize)> {
    if !fixed_strings {
        if let Some(alts) = split_top_level_alternation(pat)
            && !alts.iter().any(|p| p.is_empty())
        {
            let mut all = Vec::new();
            for alt in alts {
                all.extend(find_single_pattern(
                    &alt,
                    text,
                    ignore_case,
                    fixed_strings,
                    word_regexp,
                    line_regexp,
                ));
            }
            return all;
        }
    }

    let hay: Vec<(usize, char)> = text.char_indices().collect();
    let mut matches = Vec::new();

    if line_regexp {
        if match_at_chars(pat, &hay, 0, ignore_case, fixed_strings) == Some(hay.len()) {
            matches.push((0, text.len()));
        }
        return matches;
    }

    let anchored_start = !fixed_strings && pat.starts_with('^');
    let anchored_end = !fixed_strings && has_unescaped_trailing_dollar(pat);
    let core_pat = if !fixed_strings {
        let s = pat.strip_prefix('^').unwrap_or(pat);
        if anchored_end {
            &s[..s.len() - 1]
        } else {
            s
        }
    } else {
        pat
    };

    if anchored_start {
        if let Some(end_idx) = match_at_chars(core_pat, &hay, 0, ignore_case, fixed_strings) {
            if !anchored_end || end_idx == hay.len() {
                let end_byte = if end_idx < hay.len() {
                    hay[end_idx].0
                } else {
                    text.len()
                };
                if !word_regexp || is_word_boundary(&hay, 0, end_idx) {
                    matches.push((0, end_byte));
                }
            }
        }
        return matches;
    }

    let mut pos = 0usize;
    while pos <= hay.len() {
        if let Some(end_idx) = match_at_chars(core_pat, &hay, pos, ignore_case, fixed_strings) {
            if (!anchored_end || end_idx == hay.len())
                && (!word_regexp || is_word_boundary(&hay, pos, end_idx))
            {
                let start_byte = if pos < hay.len() {
                    hay[pos].0
                } else {
                    text.len()
                };
                let end_byte = if end_idx < hay.len() {
                    hay[end_idx].0
                } else {
                    text.len()
                };
                matches.push((start_byte, end_byte));
                if end_idx > pos {
                    pos = end_idx;
                    continue;
                }
            }
        }
        pos += 1;
    }

    matches
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

fn split_top_level_alternation(pat: &str) -> Option<Vec<String>> {
    let normalized = pat.replace("\\|", "|");
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut depth = 0i32;
    let mut in_bracket = false;
    let mut chars = normalized.chars().peekable();
    let mut found_pipe = false;

    while let Some(c) = chars.next() {
        if c == '\\' {
            cur.push(c);
            if let Some(nc) = chars.next() {
                cur.push(nc);
            }
            continue;
        }
        if c == '[' && !in_bracket {
            in_bracket = true;
            cur.push(c);
            continue;
        }
        if c == ']' && in_bracket {
            in_bracket = false;
            cur.push(c);
            continue;
        }
        if !in_bracket {
            if c == '(' {
                depth += 1;
            } else if c == ')' {
                depth -= 1;
            } else if c == '|' && depth == 0 {
                found_pipe = true;
                parts.push(std::mem::take(&mut cur));
                continue;
            }
        }
        cur.push(c);
    }
    if found_pipe {
        parts.push(cur);
        Some(parts)
    } else {
        None
    }
}

#[derive(Debug, Clone)]
enum RxAtom {
    Any,
    Char(char),
    Digit(bool),
    Word(bool),
    Space(bool),
    Class { negate: bool, chars: Vec<(char, char)> },
    Group { alts: Vec<String>, capturing: bool },
    Backref(usize),
    WordBoundary,
    WordStart,
    WordEnd,
}

fn check_boundary_atom(atom: &RxAtom, hay: &[(usize, char)], pos: usize) -> Option<bool> {
    let before_word = pos > 0 && is_word_char(hay[pos - 1].1);
    let after_word = pos < hay.len() && is_word_char(hay[pos].1);
    match atom {
        RxAtom::WordBoundary => Some(before_word != after_word),
        RxAtom::WordStart => Some(!before_word && after_word),
        RxAtom::WordEnd => Some(before_word && !after_word),
        _ => None,
    }
}

#[derive(Debug, Clone)]
struct RxToken {
    atom: RxAtom,
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
                if matches!(nc, '(' | ')' | '+' | '?') {
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

fn preprocess_ere_pattern(pat: &str, dotall: bool) -> String {
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
        } else if chs[k] == '[' && !in_bracket {
            in_bracket = true;
            out.push('[');
            k += 1;
        } else if chs[k] == ']' && in_bracket {
            in_bracket = false;
            out.push(']');
            k += 1;
        } else if !in_bracket && dotall && chs[k] == '.' {
            out.push_str("[\\D]");
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

fn parse_rx(pat: &str, fixed: bool) -> Vec<RxToken> {
    if fixed {
        return pat
            .chars()
            .map(|c| RxToken {
                atom: RxAtom::Char(c),
                min: 1,
                max: Some(1),
                lazy: false,
            })
            .collect();
    }
    let norm = normalize_bre_escapes(pat);
    let chars: Vec<char> = norm.chars().collect();
    let mut idx = 0usize;
    let mut out = Vec::new();

    while idx < chars.len() {
        let atom = match chars[idx] {
            '.' => {
                idx += 1;
                RxAtom::Any
            }
            '\\' if idx + 1 < chars.len() => {
                let nc = chars[idx + 1];
                idx += 2;
                match nc {
                    'd' => RxAtom::Digit(false),
                    'D' => RxAtom::Digit(true),
                    'w' => RxAtom::Word(false),
                    'W' => RxAtom::Word(true),
                    's' => RxAtom::Space(false),
                    'S' => RxAtom::Space(true),
                    'b' => RxAtom::WordBoundary,
                    '<' => RxAtom::WordStart,
                    '>' => RxAtom::WordEnd,
                    'n' => RxAtom::Char('\n'),
                    't' => RxAtom::Char('\t'),
                    'r' => RxAtom::Char('\r'),
                    d @ '1'..='9' => RxAtom::Backref((d as u8 - b'1') as usize),
                    other => RxAtom::Char(other),
                }
            }
            '[' => {
                idx += 1;
                let mut negate = false;
                if idx < chars.len() && (chars[idx] == '^' || chars[idx] == '!') {
                    negate = true;
                    idx += 1;
                }
                let mut ranges = Vec::new();
                if idx < chars.len() && chars[idx] == ']' {
                    ranges.push((']', ']'));
                    idx += 1;
                }
                while idx < chars.len() && chars[idx] != ']' {
                    if chars[idx] == '[' && idx + 1 < chars.len() && chars[idx + 1] == ':' {
                        if let Some(end_pos) = chars[idx..].iter().position(|&c| c == ']') {
                            let class_str: String = chars[idx..=idx + end_pos].iter().collect();
                            match class_str.as_str() {
                                "[:digit:]" => ranges.push(('0', '9')),
                                "[:lower:]" => ranges.push(('a', 'z')),
                                "[:upper:]" => ranges.push(('A', 'Z')),
                                "[:alpha:]" => {
                                    ranges.push(('a', 'z'));
                                    ranges.push(('A', 'Z'));
                                }
                                "[:alnum:]" => {
                                    ranges.push(('0', '9'));
                                    ranges.push(('a', 'z'));
                                    ranges.push(('A', 'Z'));
                                }
                                "[:xdigit:]" => {
                                    ranges.push(('0', '9'));
                                    ranges.push(('a', 'f'));
                                    ranges.push(('A', 'F'));
                                }
                                "[:space:]" => {
                                    for ws in [' ', '\t', '\n', '\r'] {
                                        ranges.push((ws, ws));
                                    }
                                }
                                _ => {}
                            }
                            idx += end_pos + 1;
                            continue;
                        }
                    }
                    if idx + 2 < chars.len() && chars[idx + 1] == '-' && chars[idx + 2] != ']' {
                        ranges.push((chars[idx], chars[idx + 2]));
                        idx += 3;
                    } else if chars[idx] == '\\' && idx + 1 < chars.len() {
                        let esc = chars[idx + 1];
                        idx += 2;
                        match esc {
                            'd' => ranges.push(('0', '9')),
                            'w' => {
                                ranges.push(('0', '9'));
                                ranges.push(('a', 'z'));
                                ranges.push(('A', 'Z'));
                                ranges.push(('_', '_'));
                            }
                            's' => {
                                for ws in [' ', '\t', '\n', '\r'] {
                                    ranges.push((ws, ws));
                                }
                            }
                            'S' | 'D' | 'W' => {
                                ranges.push(('\0', '\u{10ffff}'));
                            }
                            'n' => ranges.push(('\n', '\n')),
                            't' => ranges.push(('\t', '\t')),
                            'r' => ranges.push(('\r', '\r')),
                            other => ranges.push((other, other)),
                        }
                    } else {
                        ranges.push((chars[idx], chars[idx]));
                        idx += 1;
                    }
                }
                if idx < chars.len() && chars[idx] == ']' {
                    idx += 1;
                }
                RxAtom::Class {
                    negate,
                    chars: ranges,
                }
            }
            '(' => {
                idx += 1;
                let mut depth = 1i32;
                let mut inner = String::new();
                while idx < chars.len() && depth > 0 {
                    if chars[idx] == '\\' && idx + 1 < chars.len() {
                        inner.push(chars[idx]);
                        inner.push(chars[idx + 1]);
                        idx += 2;
                        continue;
                    }
                    if chars[idx] == '(' {
                        depth += 1;
                    } else if chars[idx] == ')' {
                        depth -= 1;
                        if depth == 0 {
                            idx += 1;
                            break;
                        }
                    }
                    inner.push(chars[idx]);
                    idx += 1;
                }
                let (inner_clean, capturing) = if let Some(rest) = inner.strip_prefix("?:") {
                    (rest, false)
                } else if let Some(rest) = inner.strip_prefix("?P<").or_else(|| inner.strip_prefix("?<")) {
                    if !rest.starts_with('=') && !rest.starts_with('!') {
                        if let Some(gt) = rest.find('>') {
                            (&rest[gt + 1..], true)
                        } else {
                            (inner.as_str(), true)
                        }
                    } else {
                        (inner.as_str(), true)
                    }
                } else {
                    (inner.as_str(), true)
                };
                let alts = split_top_level_alternation(inner_clean)
                    .unwrap_or_else(|| vec![inner_clean.to_string()]);
                RxAtom::Group { alts, capturing }
            }
            c => {
                idx += 1;
                RxAtom::Char(c)
            }
        };

        let mut min = 1usize;
        let mut max = Some(1usize);
        let mut lazy = false;
        if matches!(
            atom,
            RxAtom::WordBoundary | RxAtom::WordStart | RxAtom::WordEnd
        ) {
            out.push(RxToken {
                atom,
                min: 1,
                max: Some(1),
                lazy: false,
            });
            continue;
        }
        if idx < chars.len() {
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
                    if let Some((m_min, m_max, consumed)) = parse_quantifier(&chars[idx..]) {
                        min = m_min;
                        max = m_max;
                        idx += consumed;
                    }
                }
                _ => {}
            }
            if idx < chars.len() && chars[idx] == '?' && (min != 1 || max != Some(1)) {
                lazy = true;
                idx += 1;
            }
        }
        out.push(RxToken {
            atom,
            min,
            max,
            lazy,
        });
    }
    out
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

fn has_backref_token(tokens: &[RxToken]) -> bool {
    tokens.iter().any(|t| match &t.atom {
        RxAtom::Backref(_) => true,
        RxAtom::Group { alts, .. } => alts.iter().any(|a| has_backref_token(&parse_rx(a, false))),
        _ => false,
    })
}

fn match_at_chars(
    pat: &str,
    hay: &[(usize, char)],
    pos: usize,
    ignore_case: bool,
    fixed: bool,
) -> Option<usize> {
    let tokens = parse_rx(pat, fixed);
    if !fixed && has_backref_token(&tokens) {
        return match_tokens_with_caps(&tokens, hay, "", pos, ignore_case).map(|(end, _)| end);
    }
    match_tokens(&tokens, hay, pos, ignore_case)
}

fn match_tokens(
    tokens: &[RxToken],
    hay: &[(usize, char)],
    pos: usize,
    ignore_case: bool,
) -> Option<usize> {
    if tokens.is_empty() {
        return Some(pos);
    }
    let tok = &tokens[0];
    let rest = &tokens[1..];

    if let Some(ok) = check_boundary_atom(&tok.atom, hay, pos) {
        if ok {
            return match_tokens(rest, hay, pos, ignore_case);
        }
        return None;
    }
    if let RxAtom::Group { alts, .. } = &tok.atom
        && tok.min == 1
        && tok.max == Some(1)
    {
        for alt in alts {
            let sub_tokens = parse_rx(alt, false);
            for end_pos in match_tokens_candidates(&sub_tokens, hay, pos, ignore_case) {
                if let Some(final_pos) = match_tokens(rest, hay, end_pos, ignore_case) {
                    return Some(final_pos);
                }
            }
        }
        return None;
    }

    let mut positions = vec![pos];
    let mut count = 0usize;
    let max_limit = tok.max.unwrap_or(hay.len().saturating_sub(pos) + 1);

    while count < max_limit {
        let cur_pos = *positions.last().unwrap();
        if let Some(next_pos) = match_single_atom(&tok.atom, hay, cur_pos, ignore_case) {
            if next_pos == cur_pos && count >= tok.min {
                break;
            }
            positions.push(next_pos);
            count += 1;
        } else {
            break;
        }
    }

    if positions.len() - 1 < tok.min {
        return None;
    }

    if tok.lazy {
        for &step_pos in &positions[tok.min..positions.len()] {
            if let Some(final_pos) = match_tokens(rest, hay, step_pos, ignore_case) {
                return Some(final_pos);
            }
        }
    } else {
        for idx in (tok.min..positions.len()).rev() {
            if let Some(final_pos) = match_tokens(rest, hay, positions[idx], ignore_case) {
                return Some(final_pos);
            }
        }
    }
    None
}

fn match_tokens_candidates(
    tokens: &[RxToken],
    hay: &[(usize, char)],
    pos: usize,
    ignore_case: bool,
) -> Vec<usize> {
    if tokens.is_empty() {
        return vec![pos];
    }
    let tok = &tokens[0];
    let rest = &tokens[1..];
    if let Some(ok) = check_boundary_atom(&tok.atom, hay, pos) {
        if ok {
            return match_tokens_candidates(rest, hay, pos, ignore_case);
        }
        return Vec::new();
    }
    if let RxAtom::Group { alts, .. } = &tok.atom
        && tok.min == 1
        && tok.max == Some(1)
    {
        let mut out = Vec::new();
        for alt in alts {
            let sub_tokens = parse_rx(alt, false);
            for end_pos in match_tokens_candidates(&sub_tokens, hay, pos, ignore_case) {
                out.extend(match_tokens_candidates(rest, hay, end_pos, ignore_case));
            }
        }
        return out;
    }
    let mut positions = vec![pos];
    let mut count = 0usize;
    let max_limit = tok.max.unwrap_or(hay.len().saturating_sub(pos) + 1);
    while count < max_limit {
        let cur_pos = *positions.last().unwrap();
        if let Some(next_pos) = match_single_atom(&tok.atom, hay, cur_pos, ignore_case) {
            if next_pos == cur_pos && count >= tok.min {
                break;
            }
            positions.push(next_pos);
            count += 1;
        } else {
            break;
        }
    }
    if positions.len() - 1 < tok.min {
        return Vec::new();
    }
    let mut out = Vec::new();
    for idx in (tok.min..positions.len()).rev() {
        out.extend(match_tokens_candidates(rest, hay, positions[idx], ignore_case));
    }
    out
}

fn match_single_atom(
    atom: &RxAtom,
    hay: &[(usize, char)],
    pos: usize,
    ignore_case: bool,
) -> Option<usize> {
    match atom {
        RxAtom::Group { alts, .. } => {
            for alt in alts {
                let sub_tokens = parse_rx(alt, false);
                if let Some(end) = match_tokens(&sub_tokens, hay, pos, ignore_case) {
                    return Some(end);
                }
            }
            None
        }
        _ => {
            if pos >= hay.len() {
                return None;
            }
            let ch = hay[pos].1;
            let matched = match atom {
                RxAtom::Any => ch != '\n',
                RxAtom::Char(expected) => {
                    if ignore_case {
                        ch.to_ascii_lowercase() == expected.to_ascii_lowercase()
                    } else {
                        ch == *expected
                    }
                }
                RxAtom::Digit(inv) => ch.is_ascii_digit() ^ inv,
                RxAtom::Word(inv) => is_word_char(ch) ^ inv,
                RxAtom::Space(inv) => ch.is_ascii_whitespace() ^ inv,
                RxAtom::Class { negate, chars } => {
                    let c_cmp = if ignore_case {
                        ch.to_ascii_lowercase()
                    } else {
                        ch
                    };
                    let mut inside = false;
                    for &(s, e) in chars {
                        let s_cmp = if ignore_case { s.to_ascii_lowercase() } else { s };
                        let e_cmp = if ignore_case { e.to_ascii_lowercase() } else { e };
                        if c_cmp >= s_cmp && c_cmp <= e_cmp {
                            inside = true;
                            break;
                        }
                    }
                    inside ^ negate
                }
                RxAtom::Group { .. }
                | RxAtom::Backref(_)
                | RxAtom::WordBoundary
                | RxAtom::WordStart
                | RxAtom::WordEnd => false,
            };
            if matched { Some(pos + 1) } else { None }
        }
    }
}

pub fn regex_captures(pat: &str, text: &str, ignore_case: bool) -> Option<Vec<String>> {
    let hay: Vec<(usize, char)> = text.char_indices().collect();
    let anchored_start = pat.starts_with('^');
    let anchored_end = pat.ends_with('$') && !pat.ends_with("\\$");
    let s = pat.strip_prefix('^').unwrap_or(pat);
    let core_pat = if anchored_end { &s[..s.len() - 1] } else { s };
    let tokens = parse_rx(core_pat, false);

    let start_positions: Vec<usize> = if anchored_start {
        vec![0]
    } else {
        (0..=hay.len()).collect()
    };

    for start_pos in start_positions {
        if let Some((end_pos, caps)) =
            match_tokens_with_caps(&tokens, &hay, text, start_pos, ignore_case)
        {
            if !anchored_end || end_pos == hay.len() {
                let start_byte = if start_pos < hay.len() {
                    hay[start_pos].0
                } else {
                    text.len()
                };
                let end_byte = if end_pos < hay.len() {
                    hay[end_pos].0
                } else {
                    text.len()
                };
                let mut res = Vec::with_capacity(caps.len() + 1);
                res.push(text[start_byte..end_byte].to_string());
                res.extend(caps);
                return Some(res);
            }
        }
    }
    None
}

fn match_tokens_with_caps(
    tokens: &[RxToken],
    hay: &[(usize, char)],
    text: &str,
    pos: usize,
    ignore_case: bool,
) -> Option<(usize, Vec<String>)> {
    match_tokens_with_caps_ctx(tokens, hay, text, pos, ignore_case, &[])
}

fn match_tokens_with_caps_ctx(
    tokens: &[RxToken],
    hay: &[(usize, char)],
    text: &str,
    pos: usize,
    ignore_case: bool,
    prior_caps: &[String],
) -> Option<(usize, Vec<String>)> {
    if tokens.is_empty() {
        return Some((pos, Vec::new()));
    }
    let tok = &tokens[0];
    let rest = &tokens[1..];

    if let Some(ok) = check_boundary_atom(&tok.atom, hay, pos) {
        if ok {
            return match_tokens_with_caps_ctx(rest, hay, text, pos, ignore_case, prior_caps);
        }
        return None;
    }
    if let RxAtom::Backref(idx) = &tok.atom {
        let expected = prior_caps.get(*idx)?;
        let exp_chars: Vec<char> = expected.chars().collect();
        let mut cur_pos = pos;
        let mut positions = vec![cur_pos];
        let mut count = 0usize;
        let max_limit = tok.max.unwrap_or(hay.len().saturating_sub(pos) + 1);
        while count < max_limit {
            if cur_pos + exp_chars.len() > hay.len() {
                break;
            }
            let ok = exp_chars.iter().enumerate().all(|(k, &ec)| {
                let hc = hay[cur_pos + k].1;
                if ignore_case {
                    hc.to_ascii_lowercase() == ec.to_ascii_lowercase()
                } else {
                    hc == ec
                }
            });
            if !ok {
                break;
            }
            let next_pos = cur_pos + exp_chars.len();
            if next_pos == cur_pos && count >= tok.min {
                break;
            }
            cur_pos = next_pos;
            positions.push(cur_pos);
            count += 1;
        }
        if positions.len() - 1 < tok.min {
            return None;
        }
        for step_idx in (tok.min..positions.len()).rev() {
            if let Some((final_pos, rest_caps)) =
                match_tokens_with_caps_ctx(rest, hay, text, positions[step_idx], ignore_case, prior_caps)
            {
                return Some((final_pos, rest_caps));
            }
        }
        return None;
    }
    if let RxAtom::Group { alts, capturing } = &tok.atom
        && tok.min == 1
        && tok.max == Some(1)
    {
        for alt in alts {
            let sub_tokens = parse_rx(alt, false);
            for (end_pos, sub_caps) in
                match_tokens_candidates_with_caps(&sub_tokens, hay, text, pos, ignore_case)
            {
                let captured_str: String = hay[pos..end_pos].iter().map(|&(_, c)| c).collect();
                let mut next_prior = prior_caps.to_vec();
                if *capturing {
                    next_prior.push(captured_str.clone());
                }
                next_prior.extend(sub_caps.clone());
                if let Some((final_pos, rest_caps)) =
                    match_tokens_with_caps_ctx(rest, hay, text, end_pos, ignore_case, &next_prior)
                {
                    let mut combined = if *capturing {
                        vec![captured_str]
                    } else {
                        Vec::new()
                    };
                    combined.extend(sub_caps);
                    combined.extend(rest_caps);
                    return Some((final_pos, combined));
                }
            }
        }
        return None;
    }

    let mut steps: Vec<(usize, Vec<String>)> = vec![(pos, Vec::new())];
    let mut count = 0usize;
    let max_limit = tok.max.unwrap_or(hay.len().saturating_sub(pos) + 1);

    while count < max_limit {
        let cur_pos = steps.last().unwrap().0;
        if let Some((next_pos, step_caps)) =
            match_single_atom_with_caps(&tok.atom, hay, text, cur_pos, ignore_case)
        {
            if next_pos == cur_pos && count >= tok.min {
                break;
            }
            steps.push((next_pos, step_caps));
            count += 1;
        } else {
            break;
        }
    }

    if steps.len() - 1 < tok.min {
        return None;
    }

    for idx in (tok.min..steps.len()).rev() {
        let (step_pos, ref step_caps) = steps[idx];
        let mut next_prior = prior_caps.to_vec();
        next_prior.extend(step_caps.clone());
        if let Some((final_pos, rest_caps)) =
            match_tokens_with_caps_ctx(rest, hay, text, step_pos, ignore_case, &next_prior)
        {
            let mut combined = step_caps.clone();
            combined.extend(rest_caps);
            return Some((final_pos, combined));
        }
    }
    None
}

fn match_tokens_candidates_with_caps(
    tokens: &[RxToken],
    hay: &[(usize, char)],
    text: &str,
    pos: usize,
    ignore_case: bool,
) -> Vec<(usize, Vec<String>)> {
    if tokens.is_empty() {
        return vec![(pos, Vec::new())];
    }
    let tok = &tokens[0];
    let rest = &tokens[1..];
    if let Some(ok) = check_boundary_atom(&tok.atom, hay, pos) {
        if ok {
            return match_tokens_candidates_with_caps(rest, hay, text, pos, ignore_case);
        }
        return Vec::new();
    }
    if let RxAtom::Group { alts, capturing } = &tok.atom
        && tok.min == 1
        && tok.max == Some(1)
    {
        let mut out = Vec::new();
        for alt in alts {
            let sub_tokens = parse_rx(alt, false);
            for (end_pos, sub_caps) in
                match_tokens_candidates_with_caps(&sub_tokens, hay, text, pos, ignore_case)
            {
                let grp_str: String = hay[pos..end_pos].iter().map(|&(_, c)| c).collect();
                let mut grp_caps = if *capturing {
                    vec![grp_str]
                } else {
                    Vec::new()
                };
                grp_caps.extend(sub_caps);
                for (final_pos, rest_caps) in
                    match_tokens_candidates_with_caps(rest, hay, text, end_pos, ignore_case)
                {
                    let mut combined = grp_caps.clone();
                    combined.extend(rest_caps);
                    out.push((final_pos, combined));
                }
            }
        }
        return out;
    }
    let mut steps: Vec<(usize, Vec<String>)> = vec![(pos, Vec::new())];
    let mut count = 0usize;
    let max_limit = tok.max.unwrap_or(hay.len().saturating_sub(pos) + 1);
    while count < max_limit {
        let cur_pos = steps.last().unwrap().0;
        if let Some((next_pos, step_caps)) =
            match_single_atom_with_caps(&tok.atom, hay, text, cur_pos, ignore_case)
        {
            if next_pos == cur_pos && count >= tok.min {
                break;
            }
            steps.push((next_pos, step_caps));
            count += 1;
        } else {
            break;
        }
    }
    if steps.len() - 1 < tok.min {
        return Vec::new();
    }
    let mut out = Vec::new();
    for idx in (tok.min..steps.len()).rev() {
        let (step_pos, ref step_caps) = steps[idx];
        for (final_pos, rest_caps) in
            match_tokens_candidates_with_caps(rest, hay, text, step_pos, ignore_case)
        {
            let mut combined = step_caps.clone();
            combined.extend(rest_caps);
            out.push((final_pos, combined));
        }
    }
    out
}

fn match_single_atom_with_caps(
    atom: &RxAtom,
    hay: &[(usize, char)],
    text: &str,
    pos: usize,
    ignore_case: bool,
) -> Option<(usize, Vec<String>)> {
    match atom {
        RxAtom::Group { alts, capturing } => {
            for alt in alts {
                let sub_tokens = parse_rx(alt, false);
                if let Some((end_pos, sub_caps)) =
                    match_tokens_with_caps(&sub_tokens, hay, text, pos, ignore_case)
                {
                    let grp_str: String = hay[pos..end_pos].iter().map(|&(_, c)| c).collect();
                    let mut caps = if *capturing {
                        vec![grp_str]
                    } else {
                        Vec::new()
                    };
                    caps.extend(sub_caps);
                    return Some((end_pos, caps));
                }
            }
            None
        }
        _ => match_single_atom(atom, hay, pos, ignore_case).map(|next| (next, Vec::new())),
    }
}

fn expand_regex_replacement(replacement: &str, matched_str: &str, caps: &[String]) -> String {
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
                    if let Some(cap) = caps.get(idx + 1) {
                        push_converted(&mut out, cap, mode, &mut next_char_case);
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
    let rx = ZeroRegex::new(vec![pat.to_string()], ignore_case, false, false, false);
    let matches = rx.find_all(text);
    if matches.is_empty() {
        return (text.to_string(), 0);
    }
    let no_caret = pat.strip_prefix('^').unwrap_or(pat);
    let core_pat = if has_unescaped_trailing_dollar(no_caret) {
        &no_caret[..no_caret.len() - 1]
    } else {
        no_caret
    };
    let mut out = String::new();
    let mut last_end = 0usize;
    let mut replace_count = 0usize;
    for (idx, (s, e)) in matches.into_iter().enumerate() {
        if s < last_end {
            continue;
        }
        let one_based = idx + 1;
        let should_replace = if global {
            nth.map(|n| one_based >= n).unwrap_or(true)
        } else {
            one_based == nth.unwrap_or(1)
        };
        out.push_str(&text[last_end..s]);
        if should_replace {
            let matched_str = &text[s..e];
            let caps = regex_captures(&format!("^{core_pat}$"), matched_str, ignore_case)
                .or_else(|| regex_captures(pat, matched_str, ignore_case))
                .unwrap_or_else(|| vec![matched_str.to_string()]);
            let expanded = expand_regex_replacement(replacement, matched_str, &caps);
            out.push_str(&expanded);
            replace_count += 1;
        } else {
            out.push_str(&text[s..e]);
        }
        last_end = e;
    }
    out.push_str(&text[last_end..]);
    (out, replace_count)
}

fn apply_rg_line_replace(
    line: &str,
    spans: &[(usize, usize)],
    rep: &str,
    rx: &ZeroRegex,
    ignore_case: bool,
) -> String {
    if spans.is_empty() {
        return line.to_string();
    }
    let pat0 = rx.patterns.first().map(|p| p.as_str()).unwrap_or("");
    let mut out = String::new();
    let mut last = 0usize;
    for &(s, e) in spans {
        if s < last || e > line.len() {
            continue;
        }
        out.push_str(&line[last..s]);
        let matched_slice = &line[s..e];
        let caps = regex_captures(&format!("^{pat0}$"), matched_slice, ignore_case)
            .or_else(|| regex_captures(pat0, matched_slice, ignore_case))
            .unwrap_or_else(|| vec![matched_slice.to_string()]);
        out.push_str(&expand_rg_replacement(rep, matched_slice, &caps, pat0));
        last = e;
    }
    out.push_str(&line[last..]);
    out
}

fn extract_named_capture_groups(pat: &str) -> Vec<(String, usize)> {
    let chs: Vec<char> = pat.chars().collect();
    let mut out = Vec::new();
    let mut idx = 0usize;
    let mut in_bracket = false;
    let mut group_num = 0usize;
    while idx < chs.len() {
        if chs[idx] == '\\' && idx + 1 < chs.len() {
            idx += 2;
            continue;
        }
        if chs[idx] == '[' && !in_bracket {
            in_bracket = true;
            idx += 1;
            continue;
        }
        if chs[idx] == ']' && in_bracket {
            in_bracket = false;
            idx += 1;
            continue;
        }
        if !in_bracket && chs[idx] == '(' {
            let rest: String = chs[idx + 1..].iter().collect();
            if rest.starts_with("?:")
                || rest.starts_with("?=")
                || rest.starts_with("?!")
                || rest.starts_with("?<=")
                || rest.starts_with("?<!")
            {
                idx += 1;
                continue;
            }
            group_num += 1;
            if let Some(after_p) = rest.strip_prefix("?P<").or_else(|| rest.strip_prefix("?<")) {
                if !after_p.starts_with('=') && !after_p.starts_with('!') {
                    if let Some(gt) = after_p.find('>') {
                        let name = &after_p[..gt];
                        if !name.is_empty() {
                            out.push((name.to_string(), group_num));
                        }
                    }
                }
            }
        }
        idx += 1;
    }
    out
}

fn expand_rg_replacement(replacement: &str, matched_str: &str, caps: &[String], pat0: &str) -> String {
    let named_groups = extract_named_capture_groups(pat0);
    let mut out = String::new();
    let mut chars = replacement.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '$' {
            match chars.peek().copied() {
                Some('{') => {
                    chars.next();
                    let mut token = String::new();
                    let mut closed = false;
                    while let Some(&nc) = chars.peek() {
                        chars.next();
                        if nc == '}' {
                            closed = true;
                            break;
                        }
                        token.push(nc);
                    }
                    if !closed {
                        out.push_str("${");
                        out.push_str(&token);
                    } else if token == "0" {
                        out.push_str(matched_str);
                    } else if !token.is_empty() && token.chars().all(|ch| ch.is_ascii_digit()) {
                        if let Ok(n) = token.parse::<usize>()
                            && let Some(cap) = caps.get(n)
                        {
                            out.push_str(cap);
                        }
                    } else if let Some((_, gidx)) = named_groups.iter().find(|(nm, _)| nm == &token) {
                        if let Some(cap) = caps.get(*gidx) {
                            out.push_str(cap);
                        }
                    }
                }
                Some(nc) if nc.is_ascii_alphanumeric() || nc == '_' => {
                    let mut token = String::new();
                    while let Some(&ch) = chars.peek() {
                        if ch.is_ascii_alphanumeric() || ch == '_' {
                            token.push(ch);
                            chars.next();
                        } else {
                            break;
                        }
                    }
                    if token == "0" {
                        out.push_str(matched_str);
                    } else if token.chars().all(|ch| ch.is_ascii_digit()) {
                        if let Ok(n) = token.parse::<usize>()
                            && let Some(cap) = caps.get(n)
                        {
                            out.push_str(cap);
                        }
                    } else if let Some((_, gidx)) = named_groups.iter().find(|(nm, _)| nm == &token) {
                        if let Some(cap) = caps.get(*gidx) {
                            out.push_str(cap);
                        }
                    }
                }
                Some('$') => {
                    chars.next();
                    out.push('$');
                }
                _ => out.push('$'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn json_escape_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            other => out.push(other),
        }
    }
    out
}

fn cmd_grep(
    invoked_as: &str,
    args: &[String],
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
    default_fixed: bool,
) -> BuiltinOutcome {
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
    let mut fixed_strings = default_fixed;
    let mut extended_regexp = invoked_as == "egrep";
    let mut matcher: Option<char> = match invoked_as {
        "egrep" => Some('E'),
        "fgrep" => Some('F'),
        _ => None,
    };
    let mut recursive = invoked_as == "rgrep";
    let mut dereference_recursive = false;
    let mut dir_action: Option<String> = None;
    let mut quiet = false;
    let mut no_filename = false;
    let mut ignore_binary = false;
    let mut with_filename = false;
    let mut initial_tab = false;
    let mut stdin_label: Option<String> = None;
    let mut max_count: Option<usize> = None;
    let mut before_ctx = 0usize;
    let mut after_ctx = 0usize;
    let mut multiline = false;
    let mut context_separator: Option<String> = Some("--".to_string());
    let mut globs: Vec<String> = Vec::new();
    let mut patterns: Vec<String> = Vec::new();
    let mut targets: Vec<String> = Vec::new();
    let mut has_explicit_pattern = false;
    let mut help_requested = false;

    let push_grep_pattern = |patterns: &mut Vec<String>, pat: &str| {
        for part in pat.split('\n') {
            patterns.push(part.to_string());
        }
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
            match a.as_str() {
                "--help" => {
                    help_requested = true;
                }
                "--ignore-case" => ignore_case = true,
                "--no-ignore-case" => ignore_case = false,
                "--invert-match" => invert = true,
                "--count" | "--count-matches" => count_only = true,
                "--line-number" => line_number = true,
                "--byte-offset" => byte_offset = true,
                "--null" => null_delim = true,
                "--null-data" => null_data = true,
                "--files-with-matches" => {
                    files_with_matches = true;
                    files_without_match = false;
                }
                "--files-without-match" => {
                    files_without_match = true;
                    files_with_matches = false;
                }
                "--only-matching" => only_matching = true,
                "--word-regexp" => word_regexp = true,
                "--line-regexp" => line_regexp = true,
                "--fixed-strings" | "--extended-regexp" | "--perl-regexp" | "--basic-regexp" => {
                    let new_m = match a.as_str() {
                        "--fixed-strings" => 'F',
                        "--extended-regexp" => 'E',
                        "--perl-regexp" => 'P',
                        _ => 'G',
                    };
                    if matcher.is_some_and(|m| m != new_m) {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("{invoked_as}: conflicting matchers specified\n"),
                            exit_code: 2,
                        };
                    }
                    matcher = Some(new_m);
                    fixed_strings = new_m == 'F';
                    extended_regexp = matches!(new_m, 'E' | 'P');
                }
                "--recursive" => {
                    recursive = true;
                    dereference_recursive = false;
                }
                "--dereference-recursive" => {
                    recursive = true;
                    dereference_recursive = true;
                }
                "--quiet" | "--silent" | "--no-messages" => quiet = true,
                "--text" | "--binary" | "--line-buffered" => {
                    if a == "--text" {
                        ignore_binary = false;
                    }
                }
                "--no-filename" => {
                    no_filename = true;
                    with_filename = false;
                }
                "--with-filename" => {
                    with_filename = true;
                    no_filename = false;
                }
                "--initial-tab" => initial_tab = true,
                "--no-group-separator" => context_separator = None,
                "--group-separator" if i + 1 < args.len() => {
                    i += 1;
                    context_separator = Some(args[i].clone());
                }
                "--label" if i + 1 < args.len() => {
                    i += 1;
                    stdin_label = Some(args[i].clone());
                }
                "--directories" if i + 1 < args.len() => {
                    i += 1;
                    if args[i] == "recurse" {
                        recursive = true;
                        dereference_recursive = false;
                    } else {
                        dir_action = Some(args[i].clone());
                    }
                }
                "--exclude-from" if i + 1 < args.len() => {
                    i += 1;
                    let resolved = resolve_posix_path(cwd, &args[i]);
                    if let Ok(bytes) = fs.read_file(&resolved) {
                        for line in String::from_utf8_lossy(&bytes).lines() {
                            let trimmed = line.trim();
                            if !trimmed.is_empty() && !trimmed.starts_with('#') {
                                globs.push(format!("!{trimmed}"));
                            }
                        }
                    }
                }
                "--include" if i + 1 < args.len() => {
                    i += 1;
                    globs.push(args[i].clone());
                }
                "--exclude" | "--exclude-dir" if i + 1 < args.len() => {
                    i += 1;
                    globs.push(format!("!{}", args[i]));
                }
                "--file" if i + 1 < args.len() => {
                    i += 1;
                    has_explicit_pattern = true;
                    let resolved = resolve_posix_path(cwd, &args[i]);
                    if let Ok(bytes) = fs.read_file(&resolved) {
                        for line in String::from_utf8_lossy(&bytes).lines() {
                            patterns.push(line.to_string());
                        }
                    }
                }
                "--regexp" if i + 1 < args.len() => {
                    i += 1;
                    has_explicit_pattern = true;
                    push_grep_pattern(&mut patterns, &args[i]);
                }
                "--max-count" if i + 1 < args.len() => {
                    i += 1;
                    if args[i].is_empty() || !args[i].chars().all(|c| c.is_ascii_digit()) {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("{invoked_as}: invalid max count\n"),
                            exit_code: 2,
                        };
                    }
                    max_count = args[i].parse().ok();
                }
                "--after-context" | "--before-context" | "--context" if i + 1 < args.len() => {
                    let flag_name = a.clone();
                    i += 1;
                    if args[i].is_empty() || !args[i].chars().all(|c| c.is_ascii_digit()) {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("{invoked_as}: {}: invalid context length argument\n", args[i]),
                            exit_code: 2,
                        };
                    }
                    let n = args[i].parse::<usize>().unwrap_or(0);
                    if flag_name == "--after-context" || flag_name == "--context" {
                        after_ctx = n;
                    }
                    if flag_name == "--before-context" || flag_name == "--context" {
                        before_ctx = n;
                    }
                }
                "--color" | "--colour" if i + 1 < args.len() => {
                    i += 1;
                    if args[i] != "never" && args[i] != "auto" {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("{invoked_as}: unsupported color mode '{}'\n", args[i]),
                            exit_code: 2,
                        };
                    }
                }
                "--binary-files" if i + 1 < args.len() => {
                    i += 1;
                    match args[i].as_str() {
                        "without-match" => ignore_binary = true,
                        "text" | "binary" => ignore_binary = false,
                        other => {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{invoked_as}: unsupported binary-files mode '{other}'; use text\n"),
                                exit_code: 2,
                            };
                        }
                    }
                }
                _ => {
                    if let Some(val) = a.strip_prefix("--max-count=") {
                        if val.is_empty() || !val.chars().all(|c| c.is_ascii_digit()) {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{invoked_as}: invalid max count\n"),
                                exit_code: 2,
                            };
                        }
                        max_count = val.parse().ok();
                    } else if let Some(val) = a
                        .strip_prefix("--after-context=")
                        .or_else(|| a.strip_prefix("--before-context="))
                        .or_else(|| a.strip_prefix("--context="))
                    {
                        if val.is_empty() || !val.chars().all(|c| c.is_ascii_digit()) {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{invoked_as}: {val}: invalid context length argument\n"),
                                exit_code: 2,
                            };
                        }
                        let n = val.parse::<usize>().unwrap_or(0);
                        if a.starts_with("--after-context=") || a.starts_with("--context=") {
                            after_ctx = n;
                        }
                        if a.starts_with("--before-context=") || a.starts_with("--context=") {
                            before_ctx = n;
                        }
                    } else if let Some(val) = a.strip_prefix("--regexp=") {
                        has_explicit_pattern = true;
                        push_grep_pattern(&mut patterns, val);
                    } else if let Some(val) = a.strip_prefix("--include=") {
                        globs.push(val.to_string());
                    } else if let Some(val) = a.strip_prefix("--exclude=") {
                        globs.push(format!("!{val}"));
                    } else if let Some(val) = a.strip_prefix("--exclude-dir=") {
                        globs.push(format!("!{val}"));
                    } else if let Some(val) = a.strip_prefix("--exclude-from=") {
                        let resolved = resolve_posix_path(cwd, val);
                        if let Ok(bytes) = fs.read_file(&resolved) {
                            for line in String::from_utf8_lossy(&bytes).lines() {
                                let trimmed = line.trim();
                                if !trimmed.is_empty() && !trimmed.starts_with('#') {
                                    globs.push(format!("!{trimmed}"));
                                }
                            }
                        }
                    } else if let Some(val) = a.strip_prefix("--label=") {
                        stdin_label = Some(val.to_string());
                    } else if let Some(val) = a.strip_prefix("--directories=") {
                        if val == "recurse" {
                            recursive = true;
                            dereference_recursive = false;
                        } else {
                            dir_action = Some(val.to_string());
                        }
                    } else if let Some(val) = a.strip_prefix("--group-separator=") {
                        context_separator = Some(val.to_string());
                    } else if let Some(val) = a.strip_prefix("--file=") {
                        has_explicit_pattern = true;
                        let resolved = resolve_posix_path(cwd, val);
                        if let Ok(bytes) = fs.read_file(&resolved) {
                            for line in String::from_utf8_lossy(&bytes).lines() {
                                patterns.push(line.to_string());
                            }
                        }
                    } else if let Some(val) = a.strip_prefix("--binary-files=") {
                        match val {
                            "without-match" => ignore_binary = true,
                            "text" | "binary" => ignore_binary = false,
                            other => {
                                return BuiltinOutcome {
                                    stdout: String::new(),
                                    stderr: format!("{invoked_as}: unsupported binary-files mode '{other}'; use text\n"),
                                    exit_code: 2,
                                };
                            }
                        }
                    } else if let Some(val) = a.strip_prefix("--color=").or_else(|| a.strip_prefix("--colour=")) {
                        if val != "never" && val != "auto" {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{invoked_as}: unsupported color mode '{val}'\n"),
                                exit_code: 2,
                            };
                        }
                    } else {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("{invoked_as}: unrecognized option '{a}'\n"),
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
                    'i' => ignore_case = true,
                    'v' => invert = true,
                    'c' => count_only = true,
                    'n' => line_number = true,
                    'b' => byte_offset = true,
                    'Z' => null_delim = true,
                    'z' => null_data = true,
                    'l' => {
                        files_with_matches = true;
                        files_without_match = false;
                    }
                    'L' => {
                        files_without_match = true;
                        files_with_matches = false;
                    }
                    'o' => only_matching = true,
                    'w' => word_regexp = true,
                    'x' => line_regexp = true,
                    'F' | 'E' | 'P' | 'G' => {
                        let new_m = chars[ci];
                        if matcher.is_some_and(|m| m != new_m) {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{invoked_as}: conflicting matchers specified\n"),
                                exit_code: 2,
                            };
                        }
                        matcher = Some(new_m);
                        fixed_strings = new_m == 'F';
                        extended_regexp = matches!(new_m, 'E' | 'P');
                    }
                    'r' => {
                        recursive = true;
                        dereference_recursive = false;
                    }
                    'R' => {
                        recursive = true;
                        dereference_recursive = true;
                    }
                    'q' | 's' => quiet = true,
                    'h' => {
                        no_filename = true;
                        with_filename = false;
                    }
                    'H' => {
                        with_filename = true;
                        no_filename = false;
                    }
                    'T' => initial_tab = true,
                    'I' => ignore_binary = true,
                    'a' => ignore_binary = false,
                    'U' => multiline = true,
                    'd' => {
                        let act = if ci + 1 < chars.len() {
                            chars[ci + 1..].iter().collect::<String>()
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            String::new()
                        };
                        if act == "recurse" {
                            recursive = true;
                            dereference_recursive = false;
                        } else {
                            dir_action = Some(act);
                        }
                        break;
                    }
                    'e' => {
                        has_explicit_pattern = true;
                        let rest: String = chars[ci + 1..].iter().collect();
                        if !rest.is_empty() {
                            push_grep_pattern(&mut patterns, &rest);
                        } else if i + 1 < args.len() {
                            i += 1;
                            push_grep_pattern(&mut patterns, &args[i]);
                        } else {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{invoked_as}: option requires an argument -- 'e'\n"),
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
                            String::new()
                        };
                        let resolved = resolve_posix_path(cwd, &file_arg);
                        if let Ok(bytes) = fs.read_file(&resolved) {
                            for line in String::from_utf8_lossy(&bytes).lines() {
                                if !line.is_empty() {
                                    patterns.push(line.to_string());
                                }
                            }
                        }
                        break;
                    }
                    'm' | 'A' | 'B' | 'C' => {
                        let flag = chars[ci];
                        let val_str = if ci + 1 < chars.len() {
                            chars[ci + 1..].iter().collect::<String>()
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            String::new()
                        };
                        if val_str.is_empty() || !val_str.chars().all(|c| c.is_ascii_digit()) {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("{invoked_as}: {val_str}: invalid context length argument\n"),
                                exit_code: 2,
                            };
                        }
                        if let Ok(n) = val_str.parse::<usize>() {
                            match flag {
                                'm' => max_count = Some(n),
                                'A' => after_ctx = n,
                                'B' => before_ctx = n,
                                'C' => {
                                    before_ctx = n;
                                    after_ctx = n;
                                }
                                _ => {}
                            }
                        }
                        break;
                    }
                    d if d.is_ascii_digit() => {
                        let mut num_str = String::new();
                        while ci < chars.len() && chars[ci].is_ascii_digit() {
                            num_str.push(chars[ci]);
                            ci += 1;
                        }
                        if let Ok(n) = num_str.parse::<usize>() {
                            before_ctx = n;
                            after_ctx = n;
                        }
                        continue;
                    }
                    other => {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("{invoked_as}: invalid option -- '{other}'\n"),
                            exit_code: 2,
                        };
                    }
                }
                ci += 1;
            }
            i += 1;
            continue;
        }
        if !has_explicit_pattern {
            has_explicit_pattern = true;
            push_grep_pattern(&mut patterns, a);
        } else {
            targets.push(a.clone());
        }
        i += 1;
    }

    if help_requested {
        return ok_out("Usage: grep [OPTION]... PATTERN [FILE]...\n");
    }
    if !has_explicit_pattern {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: format!("{invoked_as}: missing pattern\n"),
            exit_code: 2,
        };
    }

    if !fixed_strings && patterns.iter().any(|p| has_unsupported_regex_features(p)) {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "grep: invalid or unsupported regular expression\n".to_string(),
            exit_code: 2,
        };
    }

    if extended_regexp && !fixed_strings {
        patterns = patterns
            .into_iter()
            .map(|pat| preprocess_ere_pattern(&pat, false))
            .collect();
    } else if !extended_regexp && !fixed_strings {
        patterns = patterns
            .into_iter()
            .map(|pat| {
                let mut out = String::with_capacity(pat.len() + 4);
                let chs: Vec<char> = pat.chars().collect();
                let mut k = 0usize;
                let mut in_bracket = false;
                while k < chs.len() {
                    if chs[k] == '\\' && k + 1 < chs.len() {
                        out.push('\\');
                        out.push(chs[k + 1]);
                        k += 2;
                    } else if chs[k] == '[' && !in_bracket {
                        in_bracket = true;
                        out.push('[');
                        k += 1;
                    } else if chs[k] == ']' && in_bracket {
                        in_bracket = false;
                        out.push(']');
                        k += 1;
                    } else if !in_bracket && (chs[k] == '(' || chs[k] == ')') {
                        out.push('[');
                        out.push(chs[k]);
                        out.push(']');
                        k += 1;
                    } else {
                        out.push(chs[k]);
                        k += 1;
                    }
                }
                out
            })
            .collect();
    }

    run_grep_engine(
        patterns,
        targets,
        stdin,
        cwd,
        fs,
        GrepConfig {
            is_rg: false,
            ignore_case,
            invert,
            count_only,
            line_number,
            files_with_matches,
            files_without_match,
            only_matching,
            word_regexp,
            line_regexp,
            fixed_strings,
            recursive,
            quiet,
            no_filename,
            with_filename,
            max_count,
            before_ctx,
            after_ctx,
            globs,
            types_include: Vec::new(),
            types_exclude: Vec::new(),
            show_hidden: true,
            unrestricted_level: 3,
            byte_offset,
            null_delim,
            null_data,
            json_output: false,
            replace: None,
            multiline,
            show_column: false,
            ignore_binary,
            max_depth: None,
            max_filesize: None,
            count_matches: false,
            include_zero: true,
            trim: false,
            heading: false,
            crlf: false,
            context_separator,
            initial_tab,
            stdin_label,
            dir_action,
            dereference_recursive,
            max_columns: None,
            no_ignore_vcs: false,
            no_ignore_dot: false,
            custom_ignore_files: Vec::new(),
            sort_by_path: false,
            stats: false,
        },
    )
}

fn cmd_rg(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
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
    let mut files_with_matches = false;
    let mut files_without_match = false;
    let mut only_matching = false;
    let mut word_regexp = false;
    let mut line_regexp = false;
    let mut fixed_strings = false;
    let mut quiet = false;
    let mut no_filename = false;
    let mut with_filename = false;
    let mut list_files_only = false;
    let mut show_hidden = false;
    let mut unrestricted_level = 0usize;
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
    let mut custom_ignore_files: Vec<String> = Vec::new();
    let mut sort_by_path = false;
    let mut before_ctx = 0usize;
    let mut after_ctx = 0usize;
    let mut context_separator: Option<String> = Some("--".to_string());
    let mut globs: Vec<String> = Vec::new();
    let mut types_include: Vec<String> = Vec::new();
    let mut types_exclude: Vec<String> = Vec::new();
    let mut patterns: Vec<String> = Vec::new();
    let mut targets: Vec<String> = Vec::new();
    let mut has_explicit_pattern = false;
    let mut help_or_version = false;

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
            match a.as_str() {
                "--help" | "--version" => {
                    help_or_version = true;
                }
                "--no-config" | "--pcre2" | "--no-pcre2" => {}
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
                "--hidden" => show_hidden = true,
                "--no-hidden" => show_hidden = false,
                "--no-ignore" => unrestricted_level = unrestricted_level.max(1),
                "--ignore" => unrestricted_level = 0,
                "--no-ignore-vcs" => no_ignore_vcs = true,
                "--ignore-vcs" => no_ignore_vcs = false,
                "--no-ignore-dot" => no_ignore_dot = true,
                "--ignore-dot" => no_ignore_dot = false,
                "--unrestricted" => unrestricted_level += 1,
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
                "--multiline-dotall" => {
                    multiline = true;
                    multiline_dotall = true;
                }
                "--no-multiline-dotall" => multiline_dotall = false,
                "--ignore-file" if i + 1 < args.len() => {
                    i += 1;
                    custom_ignore_files.push(args[i].clone());
                }
                "--max-columns" if i + 1 < args.len() => {
                    i += 1;
                    if args[i].is_empty() || !args[i].chars().all(|c| c.is_ascii_digit()) {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: "rg: max-columns requires a nonnegative integer\n".to_string(),
                            exit_code: 2,
                        };
                    }
                    max_columns = args[i].parse().ok();
                }
                "--sort" if i + 1 < args.len() => {
                    i += 1;
                    if args[i] == "path" {
                        sort_by_path = true;
                    } else {
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
                    let resolved = resolve_posix_path(cwd, &args[i]);
                    if let Ok(bytes) = fs.read_file(&resolved) {
                        for line in String::from_utf8_lossy(&bytes).lines() {
                            if !line.is_empty() {
                                patterns.push(line.to_string());
                            }
                        }
                    }
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
                    if !is_valid_rg_type(&args[i]) {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("rg: unrecognized file type: {}\n", args[i]),
                            exit_code: 2,
                        };
                    }
                    types_include.push(args[i].clone());
                }
                "--type-not" if i + 1 < args.len() => {
                    i += 1;
                    if !is_valid_rg_type(&args[i]) {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: format!("rg: unrecognized file type: {}\n", args[i]),
                            exit_code: 2,
                        };
                    }
                    types_exclude.push(args[i].clone());
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
                "--max-count" if i + 1 < args.len() => {
                    i += 1;
                    if args[i].is_empty() || !args[i].chars().all(|c| c.is_ascii_digit()) {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: "rg: max-count requires a nonnegative integer\n".to_string(),
                            exit_code: 2,
                        };
                    }
                    max_count = args[i].parse().ok();
                }
                "--max-depth" | "--maxdepth" if i + 1 < args.len() => {
                    i += 1;
                    if args[i].is_empty() || !args[i].chars().all(|c| c.is_ascii_digit()) {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: "rg: max-depth requires a nonnegative integer\n".to_string(),
                            exit_code: 2,
                        };
                    }
                    max_depth = args[i].parse().ok();
                }
                "--max-filesize" if i + 1 < args.len() => {
                    i += 1;
                    max_filesize = parse_rg_filesize(&args[i]);
                    if max_filesize.is_none() {
                        return BuiltinOutcome {
                            stdout: String::new(),
                            stderr: "rg: max-filesize requires a valid size\n".to_string(),
                            exit_code: 2,
                        };
                    }
                }
                _ => {
                    if let Some(g) = a.strip_prefix("--glob=") {
                        globs.push(g.to_string());
                    } else if let Some(ig) = a.strip_prefix("--iglob=") {
                        globs.push(format!("i:{ig}"));
                    } else if let Some(cs) = a.strip_prefix("--context-separator=") {
                        context_separator = Some(cs.to_string());
                    } else if let Some(m) = a.strip_prefix("--max-count=") {
                        if m.is_empty() || !m.chars().all(|c| c.is_ascii_digit()) {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: "rg: max-count requires a nonnegative integer\n".to_string(),
                                exit_code: 2,
                            };
                        }
                        max_count = m.parse().ok();
                    } else if let Some(d) = a.strip_prefix("--max-depth=").or_else(|| a.strip_prefix("--maxdepth=")) {
                        if d.is_empty() || !d.chars().all(|c| c.is_ascii_digit()) {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: "rg: max-depth requires a nonnegative integer\n".to_string(),
                                exit_code: 2,
                            };
                        }
                        max_depth = d.parse().ok();
                    } else if let Some(mc) = a.strip_prefix("--max-columns=") {
                        if mc.is_empty() || !mc.chars().all(|c| c.is_ascii_digit()) {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: "rg: max-columns requires a nonnegative integer\n".to_string(),
                                exit_code: 2,
                            };
                        }
                        max_columns = mc.parse().ok();
                    } else if let Some(igf) = a.strip_prefix("--ignore-file=") {
                        custom_ignore_files.push(igf.to_string());
                    } else if let Some(srt) = a.strip_prefix("--sort=") {
                        if srt == "path" {
                            sort_by_path = true;
                        } else {
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
                    } else if let Some(fsz) = a.strip_prefix("--max-filesize=") {
                        max_filesize = parse_rg_filesize(fsz);
                        if max_filesize.is_none() {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: "rg: max-filesize requires a valid size\n".to_string(),
                                exit_code: 2,
                            };
                        }
                    } else if let Some(r) = a.strip_prefix("--replace=") {
                        replace = Some(r.to_string());
                    } else if let Some(p) = a.strip_prefix("--regexp=") {
                        has_explicit_pattern = true;
                        patterns.push(p.to_string());
                    } else if let Some(t) = a.strip_prefix("--type=") {
                        if !is_valid_rg_type(t) {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("rg: unrecognized file type: {t}\n"),
                                exit_code: 2,
                            };
                        }
                        types_include.push(t.to_string());
                    } else if let Some(t) = a.strip_prefix("--type-not=") {
                        if !is_valid_rg_type(t) {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("rg: unrecognized file type: {t}\n"),
                                exit_code: 2,
                            };
                        }
                        types_exclude.push(t.to_string());
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
                    'h' | 'V' => {
                        help_or_version = true;
                    }
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
                    'u' => unrestricted_level += 1,
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
                        if !is_valid_rg_type(&val) {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("rg: unrecognized file type: {val}\n"),
                                exit_code: 2,
                            };
                        }
                        types_include.push(val);
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
                        if !is_valid_rg_type(&val) {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("rg: unrecognized file type: {val}\n"),
                                exit_code: 2,
                            };
                        }
                        types_exclude.push(val);
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
                            String::new()
                        };
                        let resolved = resolve_posix_path(cwd, &file_arg);
                        if let Ok(bytes) = fs.read_file(&resolved) {
                            for line in String::from_utf8_lossy(&bytes).lines() {
                                if !line.is_empty() {
                                    patterns.push(line.to_string());
                                }
                            }
                        }
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
                    'm' | 'M' | 'A' | 'B' | 'C' | 'd' | 'j' => {
                        let flag = chars[ci];
                        let val_str = if ci + 1 < chars.len() {
                            chars[ci + 1..].iter().collect::<String>()
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            String::new()
                        };
                        if val_str.is_empty() || !val_str.chars().all(|c| c.is_ascii_digit()) {
                            return BuiltinOutcome {
                                stdout: String::new(),
                                stderr: format!("rg: -{flag} requires a nonnegative integer\n"),
                                exit_code: 2,
                            };
                        }
                        if let Ok(n) = val_str.parse::<usize>() {
                            match flag {
                                'm' => max_count = Some(n),
                                'M' => max_columns = Some(n),
                                'd' => max_depth = Some(n),
                                'A' => after_ctx = n,
                                'B' => before_ctx = n,
                                'C' => {
                                    before_ctx = n;
                                    after_ctx = n;
                                }
                                _ => {}
                            }
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

    if help_or_version {
        return ok_out("ripgrep (safe-bash)\n");
    }
    if !list_files_only && !has_explicit_pattern {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "rg: a search pattern is required\n".to_string(),
            exit_code: 2,
        };
    }

    if unrestricted_level >= 2 {
        show_hidden = true;
    }

    if list_files_only {
        let search_roots = if targets.is_empty() {
            vec![".".to_string()]
        } else {
            targets
        };
        let mut init_rules = Vec::new();
        for igf in &custom_ignore_files {
            let p = resolve_posix_path(cwd, igf);
            if let Ok(bytes) = fs.read_file(&p) {
                for line in String::from_utf8_lossy(&bytes).lines() {
                    let t = line.trim();
                    if !t.is_empty() && !t.starts_with('#') {
                        init_rules.push(t.to_string());
                    }
                }
            }
        }
        let mut files = Vec::new();
        for r in &search_roots {
            collect_search_files(
                r,
                cwd,
                fs,
                true,
                true,
                &globs,
                &types_include,
                &types_exclude,
                show_hidden,
                unrestricted_level == 0,
                no_ignore_vcs,
                no_ignore_dot,
                false,
                &init_rules,
                0,
                max_depth,
                max_filesize,
                &mut files,
            );
        }
        if sort_by_path {
            files.sort_by(|a, b| a.0.cmp(&b.0));
        }
        let sep = if null_delim { '\0' } else { '\n' };
        let mut out = String::new();
        for (disp, _) in files {
            let clean = disp.strip_prefix("./").unwrap_or(&disp);
            out.push_str(clean);
            out.push(sep);
        }
        return ok_out(&out);
    }

    if smart_case && !ignore_case {
        let has_upper = patterns.iter().any(|p| p.chars().any(|c| c.is_ascii_uppercase()));
        if !has_upper {
            ignore_case = true;
        }
    }

    if !fixed_strings && patterns.iter().any(|p| has_unsupported_regex_features(p)) {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: "rg: invalid or unsupported regular expression\n".to_string(),
            exit_code: 2,
        };
    }

    if !fixed_strings {
        patterns = patterns
            .into_iter()
            .map(|pat| preprocess_ere_pattern(&pat, multiline_dotall))
            .collect();
    }

    let recursive = targets.is_empty()
        || targets
            .iter()
            .any(|t| fs.is_dir(&resolve_posix_path(cwd, t)));

    let effective_targets = if targets.is_empty() && stdin.is_empty() {
        vec![".".to_string()]
    } else {
        targets
    };

    run_grep_engine(
        patterns,
        effective_targets,
        stdin,
        cwd,
        fs,
        GrepConfig {
            is_rg: true,
            ignore_case,
            invert,
            count_only,
            line_number,
            files_with_matches,
            files_without_match,
            only_matching,
            word_regexp,
            line_regexp,
            fixed_strings,
            recursive,
            quiet,
            no_filename,
            with_filename,
            max_count,
            before_ctx,
            after_ctx,
            globs,
            types_include,
            types_exclude,
            show_hidden,
            unrestricted_level,
            byte_offset,
            null_delim,
            null_data: false,
            json_output,
            replace,
            multiline,
            show_column,
            ignore_binary: false,
            max_depth,
            max_filesize,
            count_matches,
            include_zero,
            trim,
            heading,
            crlf,
            context_separator,
            initial_tab: false,
            stdin_label: None,
            dir_action: None,
            dereference_recursive: false,
            max_columns,
            no_ignore_vcs,
            no_ignore_dot,
            custom_ignore_files,
            sort_by_path,
            stats,
        },
    )
}

struct GrepConfig {
    is_rg: bool,
    ignore_case: bool,
    invert: bool,
    count_only: bool,
    line_number: bool,
    files_with_matches: bool,
    files_without_match: bool,
    only_matching: bool,
    word_regexp: bool,
    line_regexp: bool,
    fixed_strings: bool,
    recursive: bool,
    quiet: bool,
    no_filename: bool,
    with_filename: bool,
    max_count: Option<usize>,
    before_ctx: usize,
    after_ctx: usize,
    globs: Vec<String>,
    types_include: Vec<String>,
    types_exclude: Vec<String>,
    show_hidden: bool,
    unrestricted_level: usize,
    byte_offset: bool,
    null_delim: bool,
    null_data: bool,
    json_output: bool,
    replace: Option<String>,
    multiline: bool,
    show_column: bool,
    ignore_binary: bool,
    max_depth: Option<usize>,
    max_filesize: Option<usize>,
    count_matches: bool,
    include_zero: bool,
    trim: bool,
    heading: bool,
    crlf: bool,
    context_separator: Option<String>,
    initial_tab: bool,
    stdin_label: Option<String>,
    dir_action: Option<String>,
    dereference_recursive: bool,
    max_columns: Option<usize>,
    no_ignore_vcs: bool,
    no_ignore_dot: bool,
    custom_ignore_files: Vec<String>,
    sort_by_path: bool,
    stats: bool,
}

fn parse_rg_filesize(s: &str) -> Option<usize> {
    let trimmed = s.trim();
    if let Some(num) = trimmed.strip_suffix(['K', 'k']) {
        num.trim().parse::<usize>().ok().map(|n| n * 1024)
    } else if let Some(num) = trimmed.strip_suffix(['M', 'm']) {
        num.trim().parse::<usize>().ok().map(|n| n * 1024 * 1024)
    } else if let Some(num) = trimmed.strip_suffix(['G', 'g']) {
        num.trim().parse::<usize>().ok().map(|n| n * 1024 * 1024 * 1024)
    } else {
        trimmed.parse::<usize>().ok()
    }
}

fn is_valid_rg_type(t: &str) -> bool {
    matches!(
        t,
        "all"
            | "ada" | "agda" | "aidl" | "alire" | "amake" | "asciidoc" | "asm" | "asp" | "ats"
            | "avro" | "awk" | "bat" | "batch" | "bazel" | "bitbake" | "boxlang" | "brotli"
            | "buildstream" | "bzip2" | "c" | "cabal" | "candid" | "carp" | "cbor" | "ceylon"
            | "cfml" | "clojure" | "cmake" | "cmd" | "cml" | "coffeescript" | "config"
            | "container" | "coq" | "cpp" | "creole" | "crystal" | "cs" | "csharp" | "cshtml"
            | "csproj" | "css" | "csv" | "cuda" | "cython" | "d" | "dart" | "devicetree"
            | "dhall" | "diff" | "dita" | "docker" | "dockercompose" | "dts" | "dvc" | "ebuild"
            | "edn" | "elisp" | "elixir" | "elm" | "erb" | "erlang" | "fennel" | "fidl" | "fish"
            | "flatbuffers" | "fortran" | "fsharp" | "fut" | "gap" | "gdscript" | "gleam" | "gn"
            | "go" | "gprbuild" | "gradle" | "graphql" | "groovy" | "gzip" | "h" | "haml" | "hare"
            | "haskell" | "hbs" | "hs" | "html" | "hurl" | "hy" | "idris" | "janet" | "java"
            | "jinja" | "jl" | "js" | "json" | "jsonl" | "julia" | "jupyter" | "k" | "kconfig"
            | "kotlin" | "lean" | "less" | "license" | "lilypond" | "lisp" | "llvm" | "lock"
            | "log" | "lua" | "lz4" | "lzma" | "m4" | "make" | "mako" | "man" | "markdown"
            | "matlab" | "md" | "meson" | "minified" | "mint" | "mk" | "ml" | "mojo" | "motoko"
            | "msbuild" | "nim" | "nix" | "objc" | "objcpp" | "ocaml" | "org" | "pants" | "pascal"
            | "pdf" | "perl" | "php" | "pkgbuild" | "po" | "pod" | "postscript" | "prolog"
            | "proto" | "protobuf" | "ps" | "puppet" | "purs" | "py" | "python" | "qmake" | "qml"
            | "qrc" | "qui" | "r" | "racket" | "raku" | "rdoc" | "readme" | "reasonml" | "red"
            | "rescript" | "robot" | "rocq" | "rst" | "ruby" | "rust" | "sass" | "scala"
            | "scdoc" | "seed7" | "sh" | "slim" | "smarty" | "sml" | "solidity" | "soy" | "spark"
            | "spec" | "sql" | "ssa" | "stylus" | "sv" | "svelte" | "svg" | "swift" | "swig"
            | "systemd" | "taskpaper" | "tcl" | "tex" | "texinfo" | "textile" | "tf" | "thrift"
            | "toml" | "ts" | "twig" | "txt" | "typescript" | "typoscript" | "typst" | "usd"
            | "v" | "vala" | "vb" | "vcl" | "verilog" | "vhdl" | "vim" | "vimscript" | "vue"
            | "webidl" | "wgsl" | "wiki" | "xml" | "xz" | "yacc" | "yaml" | "yang" | "z"
            | "zig" | "zsh" | "zstd"
    )
}

fn file_matches_rg_type(base: &str, t: &str) -> bool {
    match t {
        "ts" | "typescript" => base.ends_with(".ts") || base.ends_with(".tsx"),
        "js" | "javascript" => {
            base.ends_with(".js")
                || base.ends_with(".jsx")
                || base.ends_with(".mjs")
                || base.ends_with(".cjs")
        }
        "py" | "python" => base.ends_with(".py"),
        "rs" | "rust" => base.ends_with(".rs"),
        "md" | "markdown" => base.ends_with(".md"),
        "json" => base.ends_with(".json"),
        "yaml" | "yml" => base.ends_with(".yaml") || base.ends_with(".yml"),
        "sh" => base.ends_with(".sh") || base.ends_with(".bash"),
        "css" => base.ends_with(".css"),
        "html" => base.ends_with(".html") || base.ends_with(".htm"),
        other => base.ends_with(&format!(".{other}")),
    }
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

#[allow(clippy::too_many_arguments)]
fn collect_search_files(
    target: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
    is_rg: bool,
    recursive: bool,
    globs: &[String],
    types_include: &[String],
    types_exclude: &[String],
    show_hidden: bool,
    respect_ignore_files: bool,
    no_ignore_vcs: bool,
    no_ignore_dot: bool,
    dereference_recursive: bool,
    parent_ignore_rules: &[String],
    cur_depth: usize,
    max_depth: Option<usize>,
    max_filesize: Option<usize>,
    out: &mut Vec<(String, String)>,
) {
    let resolved = resolve_posix_path(cwd, target);
    if fs.is_dir(&resolved) {
        if !recursive {
            return;
        }
        if let Some(md) = max_depth
            && cur_depth >= md
        {
            return;
        }
        let mut local_rules = parent_ignore_rules.to_vec();
        if respect_ignore_files {
            for ig_name in [".gitignore", ".ignore", ".rgignore"] {
                if ig_name == ".gitignore" && no_ignore_vcs {
                    continue;
                }
                if (ig_name == ".ignore" || ig_name == ".rgignore") && no_ignore_dot {
                    continue;
                }
                let ig_path = normalize_posix_path(&format!("{resolved}/{ig_name}"));
                if let Ok(bytes) = fs.read_file(&ig_path) {
                    for line in String::from_utf8_lossy(&bytes).lines() {
                        let trimmed = line.trim();
                        if !trimmed.is_empty() && !trimmed.starts_with('#') {
                            local_rules.push(trimmed.to_string());
                        }
                    }
                }
            }
        }
        if let Ok(entries) = fs.read_dir(&resolved) {
            for e in entries {
                if e == ".git" || (!show_hidden && e.starts_with('.')) {
                    continue;
                }
                let child_resolved = normalize_posix_path(&format!("{resolved}/{e}"));
                let child_is_symlink = fs
                    .lstat(&child_resolved)
                    .map(|st| st.kind == VfsEntryKind::Symlink)
                    .unwrap_or(false);
                let child_is_dir = fs.is_dir(&child_resolved);
                let disp = if target == "." {
                    e.clone()
                } else {
                    format!("{}/{}", target.trim_end_matches('/'), e)
                };
                if child_is_dir && child_is_symlink && !is_rg && !dereference_recursive {
                    continue;
                }
                if respect_ignore_files && is_ignored_by_rules(&e, child_is_dir, &local_rules) {
                    let glob_override =
                        is_rg && !child_is_dir && eval_cli_globs(globs, &e, &disp) == Some(true);
                    if !glob_override {
                        continue;
                    }
                }
                if child_is_dir {
                    let excluded_dir = globs.iter().any(|g| {
                        g.strip_prefix('!').is_some_and(|neg| {
                            let clean = neg.trim_end_matches('/');
                            glob_match(clean, &e) || glob_match(clean, &disp)
                        })
                    });
                    if excluded_dir {
                        continue;
                    }
                }
                collect_search_files(
                    &disp,
                    cwd,
                    fs,
                    is_rg,
                    true,
                    globs,
                    types_include,
                    types_exclude,
                    show_hidden,
                    respect_ignore_files,
                    no_ignore_vcs,
                    no_ignore_dot,
                    dereference_recursive,
                    &local_rules,
                    cur_depth + 1,
                    max_depth,
                    max_filesize,
                    out,
                );
            }
        }
    } else if fs.exists(&resolved) {
        if let Some(max_sz) = max_filesize {
            match fs.read_file(&resolved) {
                Ok(bytes) if bytes.len() <= max_sz => {}
                _ => return,
            }
        }
        let base = basename_posix_path(&resolved);
        if !types_include.is_empty() && !types_include.iter().any(|t| file_matches_rg_type(&base, t))
        {
            return;
        }
        if types_exclude.iter().any(|t| file_matches_rg_type(&base, t)) {
            return;
        }
        if !globs.is_empty() {
            let mut include = true;
            let mut has_pos = false;
            let mut pos_matched = false;
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
                        glob_match(neg, &base) || glob_match(neg, target)
                    };
                    if matched {
                        include = false;
                    }
                } else {
                    has_pos = true;
                    let matched = if icase {
                        glob_match(&raw_g.to_ascii_lowercase(), &base.to_ascii_lowercase())
                            || glob_match(&raw_g.to_ascii_lowercase(), &target.to_ascii_lowercase())
                    } else {
                        glob_match(raw_g, &base) || glob_match(raw_g, target)
                    };
                    if matched {
                        pos_matched = true;
                    }
                }
            }
            if !include || (has_pos && !pos_matched) {
                return;
            }
        }
        out.push((target.to_string(), resolved));
    }
}

fn run_grep_engine(
    patterns: Vec<String>,
    targets: Vec<String>,
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
    cfg: GrepConfig,
) -> BuiltinOutcome {
    let rx = ZeroRegex::new(
        patterns,
        cfg.ignore_case,
        cfg.fixed_strings,
        cfg.word_regexp,
        cfg.line_regexp,
    );

    let mut inputs: Vec<(Option<String>, String, Option<usize>)> = Vec::new();
    let mut err = String::new();
    let mut had_error = false;
    let default_stdin_label = cfg
        .stdin_label
        .clone()
        .unwrap_or_else(|| "(standard input)".to_string());

    if targets.is_empty() {
        let lbl = if cfg.with_filename {
            Some(default_stdin_label.clone())
        } else {
            None
        };
        inputs.push((lbl, stdin.to_string(), None));
    } else {
        let mut init_rules = Vec::new();
        if cfg.is_rg && cfg.unrestricted_level == 0 {
            for igf in &cfg.custom_ignore_files {
                let p = resolve_posix_path(cwd, igf);
                if let Ok(bytes) = fs.read_file(&p) {
                    for line in String::from_utf8_lossy(&bytes).lines() {
                        let t = line.trim();
                        if !t.is_empty() && !t.starts_with('#') {
                            init_rules.push(t.to_string());
                        }
                    }
                }
            }
        }
        let mut file_list = Vec::new();
        for t in &targets {
            if t == "-" {
                inputs.push((Some(default_stdin_label.clone()), stdin.to_string(), None));
                continue;
            }
            let resolved = resolve_posix_path(cwd, t);
            if !fs.exists(&resolved) {
                if !cfg.quiet {
                    err.push_str(&format!("grep: {t}: No such file or directory\n"));
                }
                had_error = true;
                continue;
            }
            if fs.is_dir(&resolved) && !cfg.recursive && cfg.dir_action.as_deref() == Some("skip") {
                continue;
            }
            collect_search_files(
                t,
                cwd,
                fs,
                cfg.is_rg,
                cfg.recursive,
                &cfg.globs,
                &cfg.types_include,
                &cfg.types_exclude,
                cfg.show_hidden,
                cfg.is_rg && cfg.unrestricted_level == 0,
                cfg.no_ignore_vcs,
                cfg.no_ignore_dot,
                cfg.dereference_recursive,
                &init_rules,
                0,
                cfg.max_depth,
                cfg.max_filesize,
                &mut file_list,
            );
        }
        if cfg.sort_by_path {
            file_list.sort_by(|a, b| a.0.cmp(&b.0));
        }
        for (disp, full) in file_list {
            if let Ok(bytes) = fs.read_file(&full) {
                let nul_off = if !cfg.null_data {
                    bytes.iter().position(|&b| b == 0)
                } else {
                    None
                };
                inputs.push((Some(disp), String::from_utf8_lossy(&bytes).into_owned(), nul_off));
            }
        }
    }

    let show_filename = if cfg.no_filename {
        false
    } else if cfg.with_filename {
        true
    } else {
        inputs.len() > 1 || targets.len() > 1 || cfg.recursive
    };

    let mut out = String::new();
    let mut any_match = false;
    let mut total_matches = 0usize;
    let mut total_matched_lines = 0usize;
    let mut searches_with_match = 0usize;

    let rec_term = if cfg.null_data { '\0' } else { '\n' };
    for (fname, content, nul_off) in &inputs {
        if nul_off.is_some() && cfg.ignore_binary {
            continue;
        }
        let lines: Vec<&str> = if cfg.null_data {
            let mut v: Vec<&str> = content.split('\0').collect();
            if v.last() == Some(&"") {
                v.pop();
            }
            v
        } else if cfg.crlf {
            let mut v: Vec<&str> = content.split('\n').collect();
            if v.last() == Some(&"") {
                v.pop();
            }
            v
        } else {
            content.lines().collect()
        };
        let mut line_offsets: Vec<usize> = Vec::with_capacity(lines.len());
        let mut cur_off = 0usize;
        for l in &lines {
            line_offsets.push(cur_off);
            cur_off += l.len() + 1;
        }
        let mut match_indices = Vec::new();
        let mut multiline_spans: Vec<(usize, usize, usize, usize)> = Vec::new();
        let mut matched_count = 0usize;
        let mut file_submatch_count = 0usize;

        if cfg.multiline && !cfg.invert {
            let full_spans = rx.find_all(content);
            for (s, e) in full_spans {
                let mut span_matched = false;
                let mut first_line = None;
                let mut last_line = 0usize;
                for (idx, line) in lines.iter().enumerate() {
                    let l_start = line_offsets[idx];
                    let l_end = l_start + line.len();
                    if s < l_end && e > l_start {
                        any_match = true;
                        if cfg.quiet && !cfg.stats && !cfg.json_output {
                            return ok_out("");
                        }
                        span_matched = true;
                        if first_line.is_none() {
                            first_line = Some(idx);
                        }
                        last_line = idx;
                        if !match_indices.iter().any(|(i, _)| *i == idx) {
                            let rel_s = s.saturating_sub(l_start).min(line.len());
                            let rel_e = e.saturating_sub(l_start).min(line.len());
                            match_indices.push((idx, vec![(rel_s, rel_e)]));
                        }
                    }
                }
                if span_matched {
                    if let Some(fl) = first_line {
                        multiline_spans.push((fl, last_line, s, e));
                    }
                    matched_count += 1;
                    file_submatch_count += 1;
                }
            }
        } else {
            for (idx, line) in lines.iter().enumerate() {
                let match_subject = if cfg.crlf {
                    line.strip_suffix('\r').unwrap_or(line)
                } else {
                    line
                };
                let line_matches = rx.find_all(match_subject);
                let is_matched = if cfg.invert {
                    line_matches.is_empty()
                } else {
                    !line_matches.is_empty()
                };
                if is_matched {
                    any_match = true;
                    if cfg.quiet && !cfg.stats && !cfg.json_output {
                        return ok_out("");
                    }
                    file_submatch_count += line_matches.len().max(1);
                    match_indices.push((idx, line_matches));
                    matched_count += 1;
                    if let Some(max_c) = cfg.max_count {
                        if matched_count >= max_c {
                            break;
                        }
                    }
                }
            }
        }

        if matched_count > 0 {
            searches_with_match += 1;
            total_matched_lines += matched_count;
            total_matches += file_submatch_count;
        }

        if cfg.json_output {
            if matched_count == 0 {
                continue;
            }
            let path_text = fname.as_deref().unwrap_or("<stdin>");
            let escaped_path = json_escape_str(path_text);
            out.push_str(&format!(
                "{{\"type\":\"begin\",\"data\":{{\"path\":{{\"text\":\"{escaped_path}\"}}}}}}\n"
            ));
            let mut printed = vec![false; lines.len()];
            for (idx, _) in &match_indices {
                let start = idx.saturating_sub(cfg.before_ctx);
                let end = (*idx + cfg.after_ctx + 1).min(lines.len());
                for p in start..end {
                    printed[p] = true;
                }
            }
            let match_map: std::collections::BTreeMap<usize, &Vec<(usize, usize)>> =
                match_indices.iter().map(|(i, m)| (*i, m)).collect();
            for (idx, should_print) in printed.iter().enumerate() {
                if !*should_print {
                    continue;
                }
                let line_text = format!("{}\n", lines[idx]);
                let escaped_line = json_escape_str(&line_text);
                let line_no = idx + 1;
                let abs_off = line_offsets.get(idx).copied().unwrap_or(0);
                if let Some(spans) = match_map.get(&idx) {
                    let mut subs_json = String::new();
                    for (si, &(s, e)) in spans.iter().enumerate() {
                        if si > 0 {
                            subs_json.push(',');
                        }
                        let mtxt = json_escape_str(&lines[idx][s..e]);
                        subs_json.push_str(&format!(
                            "{{\"match\":{{\"text\":\"{mtxt}\"}},\"start\":{s},\"end\":{e}}}"
                        ));
                    }
                    out.push_str(&format!(
                        "{{\"type\":\"match\",\"data\":{{\"path\":{{\"text\":\"{escaped_path}\"}},\"lines\":{{\"text\":\"{escaped_line}\"}},\"line_number\":{line_no},\"absolute_offset\":{abs_off},\"submatches\":[{subs_json}]}}}}\n"
                    ));
                } else {
                    out.push_str(&format!(
                        "{{\"type\":\"context\",\"data\":{{\"path\":{{\"text\":\"{escaped_path}\"}},\"lines\":{{\"text\":\"{escaped_line}\"}},\"line_number\":{line_no},\"absolute_offset\":{abs_off},\"submatches\":[]}}}}\n"
                    ));
                }
            }
            out.push_str(&format!(
                "{{\"type\":\"end\",\"data\":{{\"path\":{{\"text\":\"{escaped_path}\"}},\"stats\":{{\"matches\":{file_submatch_count},\"matched_lines\":{matched_count}}}}}}}\n"
            ));
            continue;
        }

        if let Some(off) = nul_off
            && cfg.is_rg
            && !cfg.files_with_matches
            && !cfg.files_without_match
            && !cfg.count_only
        {
            if matched_count > 0 {
                if show_filename {
                    if let Some(f) = fname {
                        out.push_str(&format!(
                            "{f}: binary file matches (found \"\\0\" byte around offset {off})\n"
                        ));
                        continue;
                    }
                }
                out.push_str(&format!(
                    "binary file matches (found \"\\0\" byte around offset {off})\n"
                ));
            }
            continue;
        }

        let file_sep = if cfg.null_delim { '\0' } else { '\n' };
        if cfg.files_with_matches {
            if matched_count > 0 {
                if let Some(f) = fname {
                    out.push_str(f);
                    out.push(file_sep);
                }
            }
            continue;
        }
        if cfg.files_without_match {
            if matched_count == 0 {
                if let Some(f) = fname {
                    out.push_str(f);
                    out.push(file_sep);
                }
            }
            continue;
        }
        if cfg.count_only {
            let count_val = if cfg.count_matches {
                file_submatch_count
            } else {
                matched_count
            };
            if cfg.is_rg && count_val == 0 && !cfg.include_zero {
                continue;
            }
            if show_filename {
                if let Some(f) = fname {
                    let fsep = if cfg.null_delim { '\0' } else { ':' };
                    out.push_str(&format!("{f}{fsep}{count_val}{rec_term}"));
                    continue;
                }
            }
            out.push_str(&format!("{count_val}{rec_term}"));
            continue;
        }

        let use_heading = cfg.heading && show_filename && !match_indices.is_empty();
        if use_heading {
            if let Some(f) = fname {
                out.push_str(f);
                out.push('\n');
            }
        }
        let line_show_filename = show_filename && !use_heading;

        if cfg.only_matching && !cfg.invert {
            if cfg.multiline {
                for &(fl, _ll, s, e) in &multiline_spans {
                    let matched_slice = &content[s..e];
                    let rendered = if let Some(rep) = &cfg.replace {
                        let pat0 = rx.patterns.first().map(|p| p.as_str()).unwrap_or("");
                        let caps = regex_captures(&format!("^{pat0}$"), matched_slice, cfg.ignore_case)
                            .or_else(|| regex_captures(pat0, matched_slice, cfg.ignore_case))
                            .unwrap_or_else(|| vec![matched_slice.to_string()]);
                        expand_rg_replacement(rep, matched_slice, &caps, pat0)
                    } else {
                        matched_slice.to_string()
                    };
                    for (chunk_idx, chunk) in rendered.split('\n').enumerate() {
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
                            out.push_str(&format!("{}:", fl + 1 + chunk_idx));
                        }
                        if cfg.byte_offset {
                            out.push_str(&format!("{s}:"));
                        }
                        if cfg.initial_tab && (line_show_filename || cfg.line_number || cfg.byte_offset) {
                            out.push('\t');
                        }
                        out.push_str(chunk);
                        out.push(rec_term);
                    }
                }
                continue;
            }
            for (idx, spans) in &match_indices {
                let line = lines[*idx];
                let line_off = line_offsets.get(*idx).copied().unwrap_or(0);
                for &(s, e) in spans {
                    if line_show_filename {
                        if let Some(f) = fname {
                            let fsep = if cfg.null_delim { '\0' } else { ':' };
                            out.push_str(&format!("{f}{fsep}"));
                        }
                    }
                    if cfg.line_number {
                        out.push_str(&format!("{}:", idx + 1));
                    }
                    if cfg.byte_offset {
                        out.push_str(&format!("{}:", line_off + s));
                    }
                    if cfg.initial_tab && (line_show_filename || cfg.line_number || cfg.byte_offset) {
                        out.push('\t');
                    }
                    let matched_slice = &line[s..e];
                    if let Some(rep) = &cfg.replace {
                        let pat0 = rx.patterns.first().map(|p| p.as_str()).unwrap_or("");
                        let caps = regex_captures(&format!("^{pat0}$"), matched_slice, cfg.ignore_case)
                            .or_else(|| regex_captures(pat0, matched_slice, cfg.ignore_case))
                            .unwrap_or_else(|| vec![matched_slice.to_string()]);
                        out.push_str(&expand_rg_replacement(rep, matched_slice, &caps, pat0));
                    } else {
                        out.push_str(matched_slice);
                    }
                    out.push(rec_term);
                }
            }
            continue;
        }

        if cfg.before_ctx > 0 || cfg.after_ctx > 0 {
            let mut printed = vec![false; lines.len()];
            for (idx, _) in &match_indices {
                let start = idx.saturating_sub(cfg.before_ctx);
                let end = (*idx + cfg.after_ctx + 1).min(lines.len());
                for p in start..end {
                    printed[p] = true;
                }
            }
            let match_map: std::collections::BTreeMap<usize, &Vec<(usize, usize)>> =
                match_indices.iter().map(|(i, m)| (*i, m)).collect();
            let mut prev_printed: Option<usize> = None;
            for (idx, should_print) in printed.iter().enumerate() {
                if !*should_print {
                    continue;
                }
                if let Some(prev) = prev_printed {
                    if idx > prev + 1 {
                        if let Some(sep_str) = &cfg.context_separator {
                            out.push_str(sep_str);
                            out.push(rec_term);
                        }
                    }
                }
                prev_printed = Some(idx);
                let is_match_line = match_map.contains_key(&idx);
                let sep = if is_match_line { ':' } else { '-' };
                if line_show_filename {
                    if let Some(f) = fname {
                        let fsep = if cfg.null_delim { '\0' } else { sep };
                        out.push_str(&format!("{f}{fsep}"));
                    }
                }
                if cfg.line_number {
                    out.push_str(&format!("{}{sep}", idx + 1));
                }
                if cfg.byte_offset {
                    let line_off = line_offsets.get(idx).copied().unwrap_or(0);
                    out.push_str(&format!("{line_off}{sep}"));
                }
                if cfg.initial_tab && (line_show_filename || cfg.line_number || cfg.byte_offset) {
                    out.push('\t');
                }
                let rendered_line = if let (Some(rep), Some(spans)) = (&cfg.replace, match_map.get(&idx)) {
                    apply_rg_line_replace(lines[idx], spans, rep, &rx, cfg.ignore_case)
                } else {
                    lines[idx].to_string()
                };
                let trimmed_line = if cfg.trim {
                    rendered_line.trim_start_matches([' ', '\t']).to_string()
                } else {
                    rendered_line
                };
                if let Some(max_cols) = cfg.max_columns
                    && max_cols > 0
                    && trimmed_line.len() + 1 > max_cols
                {
                    if is_match_line {
                        if cfg.replace.is_some() {
                            let m_cnt = match_map.get(&idx).map(|s| s.len()).unwrap_or(1);
                            out.push_str(&format!("[Omitted long line with {m_cnt} matches]"));
                        } else {
                            out.push_str("[Omitted long matching line]");
                        }
                    } else {
                        out.push_str("[Omitted long context line]");
                    }
                } else {
                    out.push_str(&trimmed_line);
                }
                out.push(rec_term);
            }
        } else if cfg.multiline && !cfg.invert && cfg.replace.is_some() {
            let rep = cfg.replace.as_deref().unwrap_or("");
            for &(fl, ll, s, e) in &multiline_spans {
                let b_start = line_offsets.get(fl).copied().unwrap_or(0);
                let b_end = line_offsets.get(ll).copied().unwrap_or(0) + lines.get(ll).map(|l| l.len()).unwrap_or(0);
                let block_slice = &content[b_start..b_end.min(content.len())];
                let rel_s = s.saturating_sub(b_start).min(block_slice.len());
                let rel_e = e.saturating_sub(b_start).min(block_slice.len());
                let rendered_line = apply_rg_line_replace(block_slice, &[(rel_s, rel_e)], rep, &rx, cfg.ignore_case);
                let mut rel_off = 0usize;
                for (chunk_idx, chunk) in rendered_line.split('\n').enumerate() {
                    if line_show_filename {
                        if let Some(f) = fname {
                            let fsep = if cfg.null_delim { '\0' } else { ':' };
                            out.push_str(&format!("{f}{fsep}"));
                        }
                    }
                    if cfg.line_number {
                        out.push_str(&format!("{}:", fl + 1 + chunk_idx));
                    }
                    if cfg.show_column {
                        let col = s.saturating_sub(b_start) + 1;
                        out.push_str(&format!("{col}:"));
                    }
                    if cfg.byte_offset {
                        out.push_str(&format!("{}:", b_start + rel_off));
                    }
                    if cfg.trim {
                        out.push_str(chunk.trim_start_matches([' ', '\t']));
                    } else {
                        out.push_str(chunk);
                    }
                    out.push(rec_term);
                    rel_off += chunk.len() + 1;
                }
            }
        } else {
            for (idx, spans) in &match_indices {
                if line_show_filename {
                    if let Some(f) = fname {
                        let fsep = if cfg.null_delim { '\0' } else { ':' };
                        out.push_str(&format!("{f}{fsep}"));
                    }
                }
                if cfg.line_number {
                    out.push_str(&format!("{}:", idx + 1));
                }
                if cfg.show_column {
                    let col = spans.first().map(|(s, _)| s + 1).unwrap_or(1);
                    out.push_str(&format!("{col}:"));
                }
                if cfg.byte_offset {
                    let line_off = line_offsets.get(*idx).copied().unwrap_or(0);
                    out.push_str(&format!("{line_off}:"));
                }
                if cfg.initial_tab && (line_show_filename || cfg.line_number || cfg.byte_offset) {
                    out.push('\t');
                }
                let rendered_line = if let Some(rep) = &cfg.replace {
                    apply_rg_line_replace(lines[*idx], spans, rep, &rx, cfg.ignore_case)
                } else {
                    lines[*idx].to_string()
                };
                let trimmed_line = if cfg.trim {
                    rendered_line.trim_start_matches([' ', '\t']).to_string()
                } else {
                    rendered_line
                };
                if let Some(max_cols) = cfg.max_columns
                    && max_cols > 0
                    && trimmed_line.len() + 1 > max_cols
                {
                    if cfg.replace.is_some() && !cfg.invert {
                        out.push_str(&format!("[Omitted long line with {} matches]", spans.len()));
                    } else {
                        out.push_str("[Omitted long matching line]");
                    }
                } else {
                    out.push_str(&trimmed_line);
                }
                out.push(rec_term);
            }
        }
    }

    if cfg.json_output {
        let searches = inputs.len();
        out.push_str(&format!(
            "{{\"type\":\"summary\",\"data\":{{\"stats\":{{\"matches\":{total_matches},\"matched_lines\":{total_matched_lines},\"searches\":{searches},\"searches_with_match\":{searches_with_match}}}}}}}\n"
        ));
    } else if cfg.stats {
        let searches = inputs.len();
        let bytes_printed = out.len();
        let bytes_searched: usize = inputs.iter().map(|(_, c, _)| c.len()).sum();
        out.push_str(&format!(
            "\n{total_matches} matches\n{total_matched_lines} matched lines\n{searches_with_match} files contained matches\n{searches} files searched\n{bytes_printed} bytes printed\n{bytes_searched} bytes searched\n0.000000 seconds spent searching\n0.000000 seconds total\n"
        ));
    }

    let exit_code = if had_error {
        2
    } else if any_match {
        0
    } else {
        1
    };

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
    Time { op: i8, count: i64, reference_ms: i64, unit_ms: i64 },
    Newer(u64),
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
                other => {
                    return Err(format!("unsupported escape '\\{other}' in -printf"));
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
                other => {
                    return Err(format!("unsupported directive '%{other}' in -printf"));
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
            VfsEntryKind::File => "f",
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
        return Err("find: invalid -size argument".to_string());
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
        return Err("find: invalid -size argument".to_string());
    }
    let n = num_str
        .parse::<usize>()
        .map_err(|_| "find: invalid -size argument".to_string())?;
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
        return Err("find: invalid -perm mode".to_string());
    }
    if rest.chars().all(|c| ('0'..='7').contains(&c)) && rest.len() <= 4 {
        let mask = u32::from_str_radix(rest, 8).unwrap_or(0) & 0o7777;
        return Ok((kind, mask));
    }
    if rest.chars().any(|c| c.is_ascii_digit()) {
        return Err("find: invalid -perm mode".to_string());
    }
    let mut mode = 0u32;
    for clause in rest.split(',') {
        if clause.is_empty() {
            return Err("find: invalid -perm mode".to_string());
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
            return Err("find: invalid -perm mode".to_string());
        }
        while i < bytes.len() {
            let op = bytes[i];
            if !matches!(op, b'+' | b'-' | b'=') {
                return Err("find: invalid -perm mode".to_string());
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
                    _ => return Err("find: invalid -perm mode".to_string()),
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
    exec_batches: Vec<(Vec<String>, Vec<String>)>,
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
            return Err((2, "find: expected expression\n".to_string()));
        };
        if matches!(tok, "!" | "-not") {
            self.idx += 1;
            let (inner, in_tree) = self.parse_primary()?;
            return Ok((FindPred::Not(Box::new(inner)), format!("NOT({in_tree})")));
        }
        if tok == "(" {
            self.idx += 1;
            if self.peek() == Some(")") {
                return Err((2, "find: empty parentheses are not allowed\n".to_string()));
            }
            let (inner, in_tree) = self.parse_list()?;
            if self.peek() != Some(")") {
                return Err((2, "find: missing closing ')'\n".to_string()));
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
                Err((2, format!("find: missing argument to '{opt}'\n")))
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
                let raw = take_arg(self, tok)?;
                if raw.is_empty() || !raw.chars().all(|c| c.is_ascii_digit()) {
                    return Err((2, format!("find: invalid argument '{raw}' to '{tok}'\n")));
                }
                let val = raw
                    .parse::<usize>()
                    .map_err(|_| (2, format!("find: invalid argument '{raw}' to '{tok}'\n")))?;
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
                    return Err((2, format!("find: invalid regex '{pat}'\n")));
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
                        return Err((2, format!("find: Unknown argument to -type: {raw}\n")));
                    }
                    let ch = part.chars().next().unwrap();
                    if !matches!(ch, 'f' | 'd' | 'l' | 'c') {
                        return Err((2, format!("find: Unknown argument to -type: {raw}\n")));
                    }
                    types.push(ch);
                }
                if types.is_empty() {
                    return Err((2, "find: Unknown argument to -type\n".to_string()));
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
                    parse_signed_count_strict(raw, "find: invalid -links count")
                        .map_err(|m| (2, format!("{m}\n")))?;
                FindPred::Links { op, count }
            }
            "-mtime" | "-atime" | "-ctime" | "-mmin" | "-amin" | "-cmin" => {
                let raw = take_arg(self, tok)?;
                let (op, count) =
                    parse_signed_count_strict(raw, &format!("find: invalid {tok} argument"))
                        .map_err(|m| (2, format!("{m}\n")))?;
                let unit_ms = if tok.ends_with("min") {
                    60_000i64
                } else {
                    86_400_000i64
                };
                FindPred::Time {
                    op,
                    count: count as i64,
                    reference_ms: self.reference_ms,
                    unit_ms,
                }
            }
            "-newer" => {
                let raw = take_arg(self, tok)?;
                let ref_full = resolve_posix_path(self.cwd, raw);
                let st = self
                    .fs
                    .stat(&ref_full)
                    .map_err(|e| (1, format!("find: '{raw}': {e}\n")))?;
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
                let fmt = take_arg(self, tok)?.to_string();
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
                    return Err((2, "find: missing argument to '-exec'\n".to_string()));
                };
                if cmd_words.is_empty() {
                    return Err((2, "find: missing command for '-exec'\n".to_string()));
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
                            "find: -exec ... + requires '{}' immediately before '+'\n".to_string(),
                        ));
                    }
                    let b_idx = self.exec_batches.len();
                    self.exec_batches
                        .push((cmd_words[..cmd_words.len() - 1].to_vec(), Vec::new()));
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
                return Err((2, format!("find: unknown predicate '{other}'\n")));
            }
        };

        Ok((pred, label_for(self.args, start, self.idx)))
    }
}

struct FindEvalState<'a, F>
where
    F: FnMut(&[String], &str, &mut String, &mut BTreeMap<String, String>) -> BuiltinOutcome,
{
    cwd: &'a mut String,
    env: &'a mut BTreeMap<String, String>,
    fs: &'a dyn SafeBashFs,
    exec_sub: &'a mut F,
    exec_batches: &'a mut Vec<(Vec<String>, Vec<String>)>,
    out: &'a mut String,
    err: &'a mut String,
    exit_code: &'a mut i32,
    quit: &'a mut bool,
}

#[allow(clippy::too_many_arguments)]
fn eval_find_pred<F>(
    pred: &FindPred,
    disp_path: &str,
    root_disp: &str,
    rel_p: &str,
    full_path: &str,
    depth: usize,
    st_opt: Option<&crate::vfs::FileStat>,
    pruned: &mut bool,
    state: &mut FindEvalState<'_, F>,
) -> bool
where
    F: FnMut(&[String], &str, &mut String, &mut BTreeMap<String, String>) -> BuiltinOutcome,
{
    match pred {
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
        FindPred::Type(types) => match st_opt {
            Some(st) => types.iter().any(|t| match t {
                'f' => st.kind == VfsEntryKind::File,
                'd' => st.kind == VfsEntryKind::Directory,
                'l' => st.kind == VfsEntryKind::Symlink,
                _ => false,
            }),
            None => false,
        },
        FindPred::Empty => match st_opt {
            Some(st) => match st.kind {
                VfsEntryKind::File => st.size == 0,
                VfsEntryKind::Directory => state
                    .fs
                    .read_dir(full_path)
                    .map(|e| e.is_empty())
                    .unwrap_or(false),
                _ => false,
            },
            None => false,
        },
        FindPred::Size { op, count, unit } => match st_opt {
            Some(st) => {
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
            }
            None => false,
        },
        FindPred::Perm { mode_kind, mask } => match st_opt {
            Some(st) => {
                let file_mode = st.mode & 0o7777;
                match mode_kind {
                    '-' => (file_mode & *mask) == *mask,
                    '/' => *mask == 0 || (file_mode & *mask) != 0,
                    _ => file_mode == *mask,
                }
            }
            None => false,
        },
        FindPred::Links { op, count } => {
            if st_opt.is_none() {
                return false;
            }
            let entries = state.fs.export_entries().unwrap_or_default();
            let mut canon = normalize_posix_path(full_path);
            for _ in 0..16 {
                if let Some(ent) = entries.iter().find(|e| e.path == canon)
                    && let Some(ref t) = ent.symlink_target
                    && let Some(rest) = t.strip_prefix("__hardlink__:")
                {
                    canon = normalize_posix_path(rest);
                } else {
                    break;
                }
            }
            let hl_tag = format!("__hardlink__:{canon}");
            let extra = entries
                .iter()
                .filter(|e| e.symlink_target.as_deref() == Some(hl_tag.as_str()))
                .count();
            let nlinks = 1 + extra;
            match op {
                1 => nlinks > *count,
                -1 => nlinks < *count,
                _ => nlinks == *count,
            }
        }
        FindPred::Time {
            op,
            count,
            reference_ms,
            unit_ms,
        } => match st_opt {
            Some(st) => {
                let diff = (*reference_ms - st.mtime_ms as i64).max(0);
                let age = diff / *unit_ms;
                match op {
                    1 => age > *count,
                    -1 => age < *count,
                    _ => age == *count,
                }
            }
            None => false,
        },
        FindPred::Newer(ref_mtime) => match st_opt {
            Some(st) => st.mtime_ms > *ref_mtime,
            None => false,
        },
        FindPred::Prune => {
            *pruned = true;
            true
        }
        FindPred::Quit => {
            *state.quit = true;
            true
        }
        FindPred::Delete => {
            let base = basename_posix_path(disp_path);
            if base == "." {
                return true;
            }
            let is_dir = st_opt
                .map(|st| st.kind == VfsEntryKind::Directory)
                .unwrap_or(false);
            if is_dir {
                if let Ok(entries) = state.fs.read_dir(full_path)
                    && !entries.is_empty()
                {
                    state.err.push_str(&format!(
                        "find: cannot delete '{disp_path}': Directory not empty\n"
                    ));
                    *state.exit_code = 1;
                    return true;
                }
            }
            if let Err(e) = state.fs.remove(full_path, false) {
                state
                    .err
                    .push_str(&format!("find: cannot delete '{disp_path}': {e}\n"));
                *state.exit_code = 1;
            }
            true
        }
        FindPred::Print { null_delim } => {
            let sep = if *null_delim { '\0' } else { '\n' };
            state.out.push_str(disp_path);
            state.out.push(sep);
            true
        }
        FindPred::Printf(fmt) => {
            let rendered =
                render_find_printf(fmt, disp_path, root_disp, rel_p, st_opt, depth);
            state.out.push_str(&rendered);
            true
        }
        FindPred::Exec { cmd, batch_idx } => {
            if let Some(b_idx) = batch_idx {
                if let Some((_, pending)) = state.exec_batches.get_mut(*b_idx) {
                    pending.push(disp_path.to_string());
                }
                true
            } else {
                let cmd_args: Vec<String> =
                    cmd.iter().map(|w| w.replace("{}", disp_path)).collect();
                let res = (state.exec_sub)(&cmd_args, "", state.cwd, state.env);
                state.out.push_str(&res.stdout);
                state.err.push_str(&res.stderr);
                res.exit_code == 0
            }
        }
        FindPred::Group(inner) => eval_find_pred(
            inner, disp_path, root_disp, rel_p, full_path, depth, st_opt, pruned, state,
        ),
        FindPred::Not(inner) => !eval_find_pred(
            inner, disp_path, root_disp, rel_p, full_path, depth, st_opt, pruned, state,
        ),
        FindPred::And(a, b) => {
            eval_find_pred(
                a, disp_path, root_disp, rel_p, full_path, depth, st_opt, pruned, state,
            ) && !*state.quit
                && eval_find_pred(
                    b, disp_path, root_disp, rel_p, full_path, depth, st_opt, pruned, state,
                )
        }
        FindPred::Or(a, b) => {
            eval_find_pred(
                a, disp_path, root_disp, rel_p, full_path, depth, st_opt, pruned, state,
            ) || (!*state.quit
                && eval_find_pred(
                    b, disp_path, root_disp, rel_p, full_path, depth, st_opt, pruned, state,
                ))
        }
        FindPred::Comma(a, b) => {
            let _ = eval_find_pred(
                a, disp_path, root_disp, rel_p, full_path, depth, st_opt, pruned, state,
            );
            if *state.quit {
                return false;
            }
            eval_find_pred(
                b, disp_path, root_disp, rel_p, full_path, depth, st_opt, pruned, state,
            )
        }
    }
}

fn realpath_find(path: &str, fs: &dyn SafeBashFs) -> Result<String, String> {
    let norm = normalize_posix_path(path);
    if norm == "/" {
        return Ok("/".to_string());
    }
    let mut cur = String::new();
    let mut queue: Vec<String> = norm
        .split('/')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    let mut hops = 0usize;
    while !queue.is_empty() {
        let seg = queue.remove(0);
        if seg == "." {
            continue;
        }
        if seg == ".." {
            cur = crate::vfs::dirname_posix_path(if cur.is_empty() { "/" } else { &cur });
            if cur == "/" {
                cur.clear();
            }
            continue;
        }
        let next = format!("{cur}/{seg}");
        if let Ok(target) = fs.readlink(&next) {
            if !target.starts_with("__hardlink__:") {
                hops += 1;
                if hops > 40 {
                    return Err("ELOOP: Too many levels of symbolic links".to_string());
                }
                let mut target_segs: Vec<String> = target
                    .split('/')
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
                    .collect();
                if target.starts_with('/') {
                    cur.clear();
                }
                target_segs.extend(queue);
                queue = target_segs;
                continue;
            }
        }
        cur = next;
    }
    if cur.is_empty() {
        Ok("/".to_string())
    } else {
        Ok(cur)
    }
}

fn cmd_find<F>(
    args: &[String],
    cwd: &mut String,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
    exec_sub: &mut F,
) -> BuiltinOutcome
where
    F: FnMut(&[String], &str, &mut String, &mut BTreeMap<String, String>) -> BuiltinOutcome,
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
                if idx >= args.len() || args[idx] != "tree" {
                    return BuiltinOutcome {
                        stdout: String::new(),
                        stderr: "find: invalid -D debug option\n".to_string(),
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

    let now_ms = 1_700_000_000_000i64;

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
                        stderr: format!("find: unexpected argument '{}'\n", args[pctx.idx]),
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
            stderr: "find: -delete implies -depth; -prune is ineffective without explicit -depth\n"
                .to_string(),
            exit_code: 1,
        };
    }

    let max_depth = pctx.max_depth;
    let min_depth = pctx.min_depth;
    let depth_first = pctx.depth_first;
    let explicit_action = pctx.explicit_action;
    let mut exec_batches = pctx.exec_batches;

    let mut out = String::new();
    let mut err = String::new();
    let mut exit_code = 0;
    let mut quit = false;

    if debug_tree {
        let rendered_tree = if explicit_action {
            tree
        } else {
            format!("AND({tree}, implicit -print)")
        };
        err.push_str(&format!(
            "find: virtual expression tree (evaluation order; no optimizer)\n{rendered_tree}\n"
        ));
    }

    let mut state = FindEvalState {
        cwd,
        env,
        fs,
        exec_sub,
        exec_batches: &mut exec_batches,
        out: &mut out,
        err: &mut err,
        exit_code: &mut exit_code,
        quit: &mut quit,
    };

    for r in &roots {
        if *state.quit {
            break;
        }
        let full = resolve_posix_path(state.cwd, r);
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

    for (cmd_prefix, pending) in exec_batches {
        if !pending.is_empty() {
            let mut cmd_args = cmd_prefix;
            cmd_args.extend(pending);
            let res = (exec_sub)(&cmd_args, "", cwd, env);
            out.push_str(&res.stdout);
            err.push_str(&res.stderr);
            if res.exit_code != 0 {
                exit_code = 1;
            }
        }
    }

    BuiltinOutcome {
        stdout: out,
        stderr: err,
        exit_code,
    }
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
    F: FnMut(&[String], &str, &mut String, &mut BTreeMap<String, String>) -> BuiltinOutcome,
{
    if *state.quit {
        return;
    }
    if let Some(max_d) = max_depth {
        if depth > max_d {
            return;
        }
    }

    let lstat_res = state.fs.lstat(full);
    let Ok(mut st) = lstat_res else {
        state
            .err
            .push_str(&format!("find: '{disp}': No such file or directory\n"));
        *state.exit_code = 1;
        return;
    };

    let is_symlink = st.kind == VfsEntryKind::Symlink;
    let should_follow = is_symlink
        && (follow_mode == FindFollowMode::Always
            || (follow_mode == FindFollowMode::RootsOnly && depth == 0)
            || disp.ends_with('/'));
    if should_follow {
        if let Err(e) = realpath_find(full, state.fs) {
            state.err.push_str(&format!("find: '{disp}': {e}\n"));
            *state.exit_code = 1;
            return;
        }
        if let Ok(target_st) = state.fs.stat(full) {
            st = target_st;
        }
    }

    if disp.ends_with('/') && st.kind != VfsEntryKind::Directory {
        state
            .err
            .push_str(&format!("find: '{disp}': ENOTDIR: Not a directory\n"));
        *state.exit_code = 1;
        return;
    }

    let mut pruned = false;
    if !depth_first && depth >= min_depth {
        let ok = match pred {
            Some(p) => eval_find_pred(
                p,
                disp,
                root_disp,
                rel,
                full,
                depth,
                Some(&st),
                &mut pruned,
                state,
            ),
            None => true,
        };
        if ok && !explicit_action {
            state.out.push_str(disp);
            state.out.push('\n');
        }
        if *state.quit {
            return;
        }
    }

    let can_descend = st.kind == VfsEntryKind::Directory
        && (!pruned || depth_first)
        && max_depth.map(|max_d| depth < max_d).unwrap_or(true);
    if can_descend {
        let physical = match realpath_find(full, state.fs) {
            Ok(p) => p,
            Err(e) => {
                state.err.push_str(&format!("find: '{disp}': {e}\n"));
                *state.exit_code = 1;
                return;
            }
        };
        if ancestors.contains(&physical) {
            state.err.push_str(&format!(
                "find: '{disp}': ELOOP: Too many levels of symbolic links\n"
            ));
            *state.exit_code = 1;
            return;
        }
        ancestors.insert(physical.clone());
        let parent = disp.trim_end_matches('/');
        if let Ok(entries) = state.fs.read_dir(full) {
            for e in entries {
                if *state.quit {
                    break;
                }
                let child_disp = format!("{parent}/{e}");
                let child_rel = if rel.is_empty() {
                    e.clone()
                } else {
                    format!("{rel}/{e}")
                };
                let child_full = normalize_posix_path(&format!("{full}/{e}"));
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

    if depth_first && depth >= min_depth && !*state.quit {
        let ok = match pred {
            Some(p) => eval_find_pred(
                p,
                disp,
                root_disp,
                rel,
                full,
                depth,
                Some(&st),
                &mut pruned,
                state,
            ),
            None => true,
        };
        if ok && !explicit_action {
            state.out.push_str(disp);
            state.out.push('\n');
        }
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

fn parse_fd_size_spec(spec: &str) -> Option<(char, usize)> {
    let s = spec.trim();
    if s.is_empty() {
        return None;
    }
    let (op, rest) = if let Some(r) = s.strip_prefix('+') {
        ('+', r)
    } else if let Some(r) = s.strip_prefix('-') {
        ('-', r)
    } else {
        ('=', s)
    };
    let num_len = rest.chars().take_while(|c| c.is_ascii_digit()).count();
    if num_len == 0 {
        return None;
    }
    let num = rest[..num_len].parse::<usize>().ok()?;
    let unit = rest[num_len..].to_ascii_lowercase();
    let mult = match unit.as_str() {
        "" | "b" => 1usize,
        "k" | "kb" => 1_000,
        "ki" | "kib" => 1_024,
        "m" | "mb" => 1_000_000,
        "mi" | "mib" => 1_048_576,
        "g" | "gb" => 1_000_000_000,
        "gi" | "gib" => 1_073_741_824,
        _ => return None,
    };
    Some((op, num.saturating_mul(mult)))
}

fn parse_fd_type_char(s: &str) -> Option<char> {
    match s.trim() {
        "f" | "file" => Some('f'),
        "d" | "dir" | "directory" => Some('d'),
        "l" | "symlink" => Some('l'),
        "x" | "executable" => Some('x'),
        "e" | "empty" => Some('e'),
        "s" | "socket" => Some('s'),
        "p" | "pipe" | "fifo" => Some('p'),
        "c" | "char-device" => Some('c'),
        "b" | "block-device" => Some('b'),
        _ => None,
    }
}

fn parse_fd_time_ms(spec: &str) -> Option<u64> {
    let s = spec.trim();
    if let Some(epoch_str) = s.strip_prefix('@') {
        if epoch_str.is_empty() || !epoch_str.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        return epoch_str.parse::<u64>().ok().map(|sec| sec * 1000);
    }
    let num_len = s.chars().take_while(|c| c.is_ascii_digit()).count();
    if num_len > 0 && num_len < s.len() {
        let n = s[..num_len].parse::<u64>().ok()?;
        let unit = s[num_len..].trim();
        let dur_ms = match unit {
            "s" | "sec" | "secs" | "second" | "seconds" => n * 1000,
            "m" | "min" | "mins" | "minute" | "minutes" => n * 60_000,
            "h" | "hr" | "hrs" | "hour" | "hours" => n * 3_600_000,
            "d" | "day" | "days" => n * 86_400_000,
            "w" | "week" | "weeks" => n * 7 * 86_400_000,
            _ => return None,
        };
        let now_ms = 1_700_000_000_000u64;
        return Some(now_ms.saturating_sub(dur_ms));
    }
    if s.len() >= 10 && s.as_bytes().get(4) == Some(&b'-') && s.as_bytes().get(7) == Some(&b'-') {
        let y = s[0..4].parse::<i64>().ok()?;
        let m = s[5..7].parse::<u32>().ok()?;
        let d = s[8..10].parse::<u32>().ok()?;
        if (1..=12).contains(&m) && (1..=31).contains(&d) {
            let days = (y - 1970) * 365 + ((y - 1969) / 4) + ((m as i64 - 1) * 30) + (d as i64 - 1);
            return Some((days.max(0) as u64) * 86_400_000);
        }
    }
    None
}

struct FdConfig {
    extensions: Vec<String>,
    types: Vec<char>,
    min_depth: usize,
    max_depth: Option<usize>,
    max_results: Option<usize>,
    excludes: Vec<String>,
    sizes: Vec<(char, usize)>,
    changed_within_ms: Option<u64>,
    changed_before_ms: Option<u64>,
    show_hidden: bool,
    respect_ignore: bool,
    no_ignore_vcs: bool,
    follow: bool,
    full_path: bool,
    absolute_path: bool,
    glob_mode: bool,
    fixed_mode: bool,
    ignore_case: bool,
    prune: bool,
    pattern: Option<String>,
    and_patterns: Vec<String>,
}

fn cmd_fd<F>(
    args: &[String],
    cwd: &mut String,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
    exec_sub: &mut F,
) -> BuiltinOutcome
where
    F: FnMut(&[String], &str, &mut String, &mut BTreeMap<String, String>) -> BuiltinOutcome,
{
    let mut extensions: Vec<String> = Vec::new();
    let mut types: Vec<char> = Vec::new();
    let mut min_depth = 1usize;
    let mut max_depth: Option<usize> = None;
    let mut max_results: Option<usize> = None;
    let mut excludes: Vec<String> = Vec::new();
    let mut sizes: Vec<(char, usize)> = Vec::new();
    let mut changed_within_ms: Option<u64> = None;
    let mut changed_before_ms: Option<u64> = None;
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
    let mut glob_mode = false;
    let mut fixed_mode = false;
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

    let parse_non_neg = |val: &str| -> Option<usize> {
        if val.is_empty() || !val.chars().all(|c| c.is_ascii_digit()) {
            None
        } else {
            val.parse::<usize>().ok()
        }
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
        if !end_of_opts && (a == "-x" || a == "--exec" || a == "-X" || a == "--exec-batch") {
            if has_exec {
                return usage_err("cannot combine --exec and --exec-batch");
            }
            has_exec = true;
            exec_batch = a == "-X" || a == "--exec-batch";
            i += 1;
            while i < args.len() && args[i] != ";" {
                exec_cmd.push(args[i].clone());
                i += 1;
            }
            if exec_cmd.is_empty() {
                return usage_err("missing command for --exec");
            }
            if i < args.len() && args[i] == ";" {
                i += 1;
            }
            continue;
        }
        if !end_of_opts && a.starts_with("--") && a.len() > 2 {
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
                "--hidden"
                | "--no-ignore"
                | "--no-ignore-vcs"
                | "--no-ignore-parent"
                | "--strip-cwd-prefix"
                | "--unrestricted"
                | "--follow"
                | "--glob"
                | "--fixed-strings"
                | "--ignore-case"
                | "--case-sensitive"
                | "--full-path"
                | "--absolute-path"
                | "--print0"
                | "--quiet"
                | "--has-results"
                | "--prune"
                | "--list-details" => {
                    if inline_val.is_some() {
                        return usage_err(&format!("option '{opt_name}' does not take a value"));
                    }
                    match opt_name {
                        "--hidden" => show_hidden = true,
                        "--no-ignore" => respect_ignore = false,
                        "--no-ignore-vcs" => no_ignore_vcs = true,
                        "--no-ignore-parent" => no_ignore_parent = true,
                        "--strip-cwd-prefix" => strip_cwd_prefix = true,
                        "--unrestricted" => {
                            unrestricted += 1;
                            respect_ignore = false;
                            if unrestricted >= 2 {
                                show_hidden = true;
                            }
                        }
                        "--follow" => follow = true,
                        "--glob" => glob_mode = true,
                        "--fixed-strings" => fixed_mode = true,
                        "--ignore-case" => case_override = Some(true),
                        "--case-sensitive" => case_override = Some(false),
                        "--full-path" => full_path = true,
                        "--absolute-path" => absolute_path = true,
                        "--print0" => print0 = true,
                        "--quiet" | "--has-results" => quiet = true,
                        "--prune" => prune = true,
                        "--list-details" => list_details = true,
                        _ => {}
                    }
                }
                "--extension" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --extension");
                    };
                    extensions.push(v.trim_start_matches('.').to_ascii_lowercase());
                }
                "--type" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --type");
                    };
                    let Some(c) = parse_fd_type_char(&v) else {
                        return usage_err(&format!("unknown file type '{v}'"));
                    };
                    types.push(c);
                }
                "--ignore-file" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --ignore-file");
                    };
                    custom_ignore_files.push(v);
                }
                "--path-separator" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --path-separator");
                    };
                    path_separator = Some(v);
                }
                "--changed-within" | "--change-newer-than" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --changed-within");
                    };
                    let Some(ms) = parse_fd_time_ms(&v) else {
                        return usage_err(&format!("invalid time '{v}'"));
                    };
                    changed_within_ms = Some(ms);
                }
                "--changed-before" | "--change-older-than" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --changed-before");
                    };
                    let Some(ms) = parse_fd_time_ms(&v) else {
                        return usage_err(&format!("invalid time '{v}'"));
                    };
                    changed_before_ms = Some(ms);
                }
                "--max-depth" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --max-depth");
                    };
                    let Some(d) = parse_non_neg(&v) else {
                        return usage_err(&format!("invalid --max-depth '{v}'"));
                    };
                    max_depth = Some(d);
                }
                "--min-depth" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --min-depth");
                    };
                    let Some(d) = parse_non_neg(&v) else {
                        return usage_err(&format!("invalid --min-depth '{v}'"));
                    };
                    min_depth = d;
                }
                "--exact-depth" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --exact-depth");
                    };
                    let Some(d) = parse_non_neg(&v) else {
                        return usage_err(&format!("invalid --exact-depth '{v}'"));
                    };
                    min_depth = d;
                    max_depth = Some(d);
                }
                "--max-results" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --max-results");
                    };
                    let Some(n) = parse_non_neg(&v) else {
                        return usage_err(&format!("invalid --max-results '{v}'"));
                    };
                    if n == 0 {
                        return usage_err("--max-results must be greater than zero");
                    }
                    max_results = Some(n);
                }
                "--exclude" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --exclude");
                    };
                    excludes.push(v);
                }
                "--size" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --size");
                    };
                    let Some(sz) = parse_fd_size_spec(&v) else {
                        return usage_err(&format!("invalid --size '{v}'"));
                    };
                    sizes.push(sz);
                }
                "--format" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --format");
                    };
                    format_tpl = Some(v);
                }
                "--search-path" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --search-path");
                    };
                    search_paths.push(v);
                }
                "--base-directory" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --base-directory");
                    };
                    base_dir = Some(v);
                }
                "--and" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --and");
                    };
                    and_patterns.push(v);
                }
                "--color" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --color");
                    };
                    if !matches!(v.as_str(), "never" | "auto" | "always") {
                        return usage_err(&format!("invalid --color '{v}'"));
                    }
                }
                "--threads" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --threads");
                    };
                    let Some(n) = parse_non_neg(&v) else {
                        return usage_err(&format!("invalid --threads '{v}'"));
                    };
                    if n == 0 {
                        return usage_err("--threads must be greater than zero");
                    }
                }
                _ => return usage_err(&format!("unknown option '{opt_name}'")),
            }
            i += 1;
            continue;
        }
        if !end_of_opts && a.starts_with('-') && a.len() > 1 {
            let chars: Vec<char> = a[1..].chars().collect();
            let mut ci = 0usize;
            while ci < chars.len() {
                match chars[ci] {
                    'H' => show_hidden = true,
                    'I' => respect_ignore = false,
                    'u' => {
                        unrestricted += 1;
                        respect_ignore = false;
                        if unrestricted >= 2 {
                            show_hidden = true;
                        }
                    }
                    'L' => follow = true,
                    'g' => glob_mode = true,
                    'F' => fixed_mode = true,
                    'i' => case_override = Some(true),
                    's' => case_override = Some(false),
                    'p' => full_path = true,
                    'a' => absolute_path = true,
                    '0' => print0 = true,
                    'q' => quiet = true,
                    'l' => list_details = true,
                    '1' => max_results = Some(1),
                    'e' | 't' | 'd' | 'E' | 'S' | 'C' | 'c' | 'j' => {
                        let flag = chars[ci];
                        let val = if ci + 1 < chars.len() {
                            let rest: String = chars[ci + 1..].iter().collect();
                            rest.strip_prefix('=').unwrap_or(&rest).to_string()
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            return usage_err(&format!("missing argument for -{flag}"));
                        };
                        match flag {
                            'e' => extensions.push(val.trim_start_matches('.').to_ascii_lowercase()),
                            't' => {
                                let Some(c) = parse_fd_type_char(&val) else {
                                    return usage_err(&format!("unknown file type '{val}'"));
                                };
                                types.push(c);
                            }
                            'd' => {
                                let Some(d) = parse_non_neg(&val) else {
                                    return usage_err(&format!("invalid depth '{val}'"));
                                };
                                max_depth = Some(d);
                            }
                            'E' => excludes.push(val),
                            'S' => {
                                let Some(sz) = parse_fd_size_spec(&val) else {
                                    return usage_err(&format!("invalid size '{val}'"));
                                };
                                sizes.push(sz);
                            }
                            'C' => base_dir = Some(val),
                            'c' => {
                                if !matches!(val.as_str(), "never" | "auto" | "always") {
                                    return usage_err(&format!("invalid color '{val}'"));
                                }
                            }
                            'j' => {
                                let Some(n) = parse_non_neg(&val) else {
                                    return usage_err(&format!("invalid threads '{val}'"));
                                };
                                if n == 0 {
                                    return usage_err("threads must be greater than zero");
                                }
                            }
                            _ => {}
                        }
                        break;
                    }
                    other => return usage_err(&format!("unknown option '-{other}'")),
                }
                ci += 1;
            }
            i += 1;
            continue;
        }
        operands.push(a.clone());
        i += 1;
    }

    if has_exec && (format_tpl.is_some() || list_details) {
        return usage_err("cannot combine --exec/--exec-batch with --format or --list-details");
    }
    if exec_batch {
        let total_ph: usize = exec_cmd.iter().map(|w| count_fd_placeholders(w)).sum();
        if total_ph > 1 {
            return usage_err("--exec-batch permits at most one placeholder");
        }
    }
    if !search_paths.is_empty() && operands.len() > 1 {
        return usage_err("cannot combine --search-path with positional path arguments");
    }

    let raw_pattern = if !operands.is_empty() {
        Some(operands.remove(0))
    } else {
        None
    };

    if !glob_mode && !fixed_mode {
        if let Some(ref p) = raw_pattern
            && !p.is_empty()
            && has_unsupported_regex_features(p)
        {
            return usage_err(&format!("invalid regex '{p}'"));
        }
        for ap in &and_patterns {
            if has_unsupported_regex_features(ap) {
                return usage_err(&format!("invalid regex '{ap}'"));
            }
        }
    }

    let pattern = match raw_pattern {
        Some(p) if !p.is_empty() => Some(p),
        _ => None,
    };

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

    let ignore_case = match case_override {
        Some(ic) => ic,
        None => {
            !pattern
                .as_ref()
                .map(|p| p.chars().any(|c| c.is_ascii_uppercase()))
                .unwrap_or(false)
                && !and_patterns
                    .iter()
                    .any(|p| p.chars().any(|c| c.is_ascii_uppercase()))
        }
    };

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
        glob_mode,
        fixed_mode,
        ignore_case,
        prune,
        pattern,
        and_patterns,
    };

    let mut init_custom_rules = Vec::new();
    for igf in &custom_ignore_files {
        let ig_path = resolve_posix_path(&effective_cwd, igf);
        match fs.read_file(&ig_path) {
            Ok(bytes) => {
                for line in String::from_utf8_lossy(&bytes).lines() {
                    let t = line.trim();
                    if !t.is_empty() && !t.starts_with('#') {
                        init_custom_rules.push(t.to_string());
                    }
                }
            }
            Err(e) => {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("fd: {igf}: {e}\n"),
                    exit_code: 1,
                };
            }
        }
    }

    let mut err = String::new();
    let mut root_failed = false;
    let mut results: Vec<(String, bool, bool)> = Vec::new();
    for r in &roots {
        let full = resolve_posix_path(&effective_cwd, r);
        match fs.stat(&full) {
            Ok(st) if st.kind == VfsEntryKind::Directory => {}
            Ok(_) => {
                err.push_str(&format!("fd: {r}: not a directory\n"));
                root_failed = true;
                continue;
            }
            Err(e) => {
                err.push_str(&format!("fd: {r}: {e}\n"));
                root_failed = true;
                continue;
            }
        }
        let mut init_rules = init_custom_rules.clone();
        if cfg.respect_ignore {
            let mut ancestor_dirs = Vec::new();
            if !no_ignore_parent {
                ancestor_dirs.push("/".to_string());
                let mut accum = String::new();
                for seg in full.split('/').filter(|s| !s.is_empty()) {
                    accum.push('/');
                    accum.push_str(seg);
                    ancestor_dirs.push(accum.clone());
                }
            } else {
                ancestor_dirs.push(full.clone());
            }
            for dir_path in ancestor_dirs {
                for ign_name in [".gitignore", ".ignore", ".fdignore"] {
                    if ign_name == ".gitignore" && cfg.no_ignore_vcs {
                        continue;
                    }
                    let ign_path = normalize_posix_path(&format!("{dir_path}/{ign_name}"));
                    if let Ok(bytes) = fs.read_file(&ign_path) {
                        for line in String::from_utf8_lossy(&bytes).lines() {
                            let t = line.trim();
                            if !t.is_empty() && !t.starts_with('#') {
                                init_rules.push(t.to_string());
                            }
                        }
                    }
                }
            }
        }
        let label = if r == "." {
            ""
        } else if r == "/" {
            "/"
        } else {
            r.trim_end_matches('/')
        };
        let prefix_cwd = r == "." || r.starts_with("./");
        walk_fd(
            label,
            "",
            &full,
            0,
            prefix_cwd,
            &cfg,
            &init_rules,
            fs,
            &mut results,
        );
    }

    if let Some(max_r) = cfg.max_results {
        results.truncate(max_r);
    }

    if quiet {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: err,
            exit_code: if root_failed || results.is_empty() { 1 } else { 0 },
        };
    }

    let format_entry_display = |raw_disp: &str, prefix_cwd: bool| -> String {
        let mut disp = raw_disp.to_string();
        if strip_cwd_prefix && prefix_cwd && disp.starts_with("./") {
            disp = disp[2..].to_string();
        } else if !strip_cwd_prefix
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

    if list_details {
        if results.is_empty() {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: err,
                exit_code: if root_failed { 1 } else { 0 },
            };
        }
        let mut ls_cmd = vec!["ls".to_string(), "-ld".to_string()];
        for (item, _, prefix_cwd) in &results {
            ls_cmd.push(format_entry_display(item, *prefix_cwd));
        }
        let res = exec_sub(&ls_cmd, "", &mut sub_cwd, env);
        err.push_str(&res.stderr);
        return BuiltinOutcome {
            stdout: res.stdout,
            stderr: err,
            exit_code: if root_failed {
                1
            } else {
                res.exit_code
            },
        };
    }

    if has_exec {
        if results.is_empty() {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: err,
                exit_code: if root_failed { 1 } else { 0 },
            };
        }
        if exec_batch {
            let mut cmd_words: Vec<String> = Vec::new();
            let any_ph = exec_cmd.iter().any(|w| has_fd_placeholder(w));
            if any_ph {
                for w in &exec_cmd {
                    if has_fd_placeholder(w) {
                        for (item, _, prefix_cwd) in &results {
                            let disp = format_entry_display(item, *prefix_cwd);
                            cmd_words.push(format_fd_template(w, &disp));
                        }
                    } else {
                        cmd_words.push(format_fd_template(w, ""));
                    }
                }
            } else {
                for w in &exec_cmd {
                    cmd_words.push(format_fd_template(w, ""));
                }
                for (item, _, prefix_cwd) in &results {
                    cmd_words.push(format_entry_display(item, *prefix_cwd));
                }
            }
            let res = exec_sub(&cmd_words, "", &mut sub_cwd, env);
            err.push_str(&res.stderr);
            return BuiltinOutcome {
                stdout: res.stdout,
                stderr: err,
                exit_code: if root_failed || res.exit_code != 0 {
                    if res.exit_code != 0 { res.exit_code } else { 1 }
                } else {
                    0
                },
            };
        } else {
            let mut out = String::new();
            let mut code = if root_failed { 1 } else { 0 };
            let any_ph = exec_cmd.iter().any(|w| has_fd_placeholder(w));
            for (item, _, prefix_cwd) in &results {
                let disp = format_entry_display(item, *prefix_cwd);
                let mut cmd_words: Vec<String> = Vec::new();
                if any_ph {
                    for w in &exec_cmd {
                        cmd_words.push(format_fd_template(w, &disp));
                    }
                } else {
                    for w in &exec_cmd {
                        cmd_words.push(format_fd_template(w, ""));
                    }
                    cmd_words.push(disp);
                }
                let res = exec_sub(&cmd_words, "", &mut sub_cwd, env);
                out.push_str(&res.stdout);
                err.push_str(&res.stderr);
                if res.exit_code != 0 {
                    code = res.exit_code;
                }
            }
            return BuiltinOutcome {
                stdout: out,
                stderr: err,
                exit_code: code,
            };
        }
    }

    let sep = if print0 { '\0' } else { '\n' };
    let dir_sep = path_separator.as_deref().unwrap_or("/");
    let mut out = String::new();
    for (item, is_dir, prefix_cwd) in results {
        let disp = format_entry_display(&item, prefix_cwd);
        if let Some(fmt) = &format_tpl {
            out.push_str(&format_fd_template(fmt, &disp));
        } else {
            out.push_str(&disp);
            if is_dir && !disp.ends_with(dir_sep) {
                out.push_str(dir_sep);
            }
        }
        out.push(sep);
    }
    BuiltinOutcome {
        stdout: out,
        stderr: err,
        exit_code: if root_failed { 1 } else { 0 },
    }
}

fn match_fd_single_pattern(pat: &str, subj: &str, cfg: &FdConfig) -> bool {
    if cfg.glob_mode {
        if cfg.ignore_case {
            glob_match(&pat.to_ascii_lowercase(), &subj.to_ascii_lowercase())
        } else {
            glob_match(pat, subj)
        }
    } else if cfg.fixed_mode {
        if cfg.ignore_case {
            subj.to_ascii_lowercase().contains(&pat.to_ascii_lowercase())
        } else {
            subj.contains(pat)
        }
    } else {
        let rx = ZeroRegex::new(vec![pat.to_string()], cfg.ignore_case, false, false, false);
        rx.is_match(subj)
    }
}

#[allow(clippy::too_many_arguments)]
fn walk_fd(
    disp: &str,
    rel: &str,
    full: &str,
    depth: usize,
    prefix_cwd: bool,
    cfg: &FdConfig,
    ignore_rules: &[String],
    fs: &dyn SafeBashFs,
    out: &mut Vec<(String, bool, bool)>,
) {
    if let Some(max_d) = cfg.max_depth {
        if depth > max_d {
            return;
        }
    }
    if let Some(max_r) = cfg.max_results {
        if out.len() >= max_r {
            return;
        }
    }

    let st_opt = if cfg.follow {
        fs.stat(full).or_else(|_| fs.lstat(full)).ok()
    } else {
        fs.lstat(full).ok()
    };
    let Some(st) = st_opt else {
        return;
    };
    let is_dir = st.kind == VfsEntryKind::Directory;

    let mut matched_here = false;
    if depth > 0 {
        let base = basename_posix_path(disp);
        if !cfg.show_hidden && base.starts_with('.') {
            return;
        }
        if cfg.excludes.iter().any(|ex| {
            let ex_clean = ex.trim_end_matches('/');
            glob_match(ex, &base)
                || glob_match(ex_clean, &base)
                || glob_match(ex, rel)
                || glob_match(ex_clean, rel)
                || glob_match(ex, disp)
        }) {
            return;
        }
        if cfg.respect_ignore && is_ignored_by_rules(&base, is_dir, ignore_rules) {
            return;
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
                        'f' => st.kind == VfsEntryKind::File,
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
                    for &(op, target) in &cfg.sizes {
                        let ok = match op {
                            '+' => st.size >= target,
                            '-' => st.size <= target,
                            _ => st.size == target,
                        };
                        if !ok {
                            matches = false;
                            break;
                        }
                    }
                }
            }

            if matches && let Some(min_ms) = cfg.changed_within_ms {
                if st.mtime_ms < min_ms {
                    matches = false;
                }
            }
            if matches && let Some(max_ms) = cfg.changed_before_ms {
                if st.mtime_ms > max_ms {
                    matches = false;
                }
            }

            if matches && !cfg.extensions.is_empty() {
                let lower = base.to_ascii_lowercase();
                matches = cfg
                    .extensions
                    .iter()
                    .any(|ext| lower.len() > ext.len() + 1 && lower.ends_with(&format!(".{ext}")));
            }

            if matches {
                let subj = if cfg.full_path {
                    if cfg.absolute_path {
                        full.to_string()
                    } else if prefix_cwd
                        && !disp.starts_with('/')
                        && !disp.starts_with("./")
                        && !disp.starts_with("../")
                    {
                        format!("./{disp}")
                    } else {
                        disp.to_string()
                    }
                } else {
                    base.clone()
                };
                if let Some(pat) = &cfg.pattern {
                    matches = match_fd_single_pattern(pat, &subj, cfg);
                }
                if matches {
                    for ap in &cfg.and_patterns {
                        if !match_fd_single_pattern(ap, &subj, cfg) {
                            matches = false;
                            break;
                        }
                    }
                }
            }

            if matches {
                matched_here = true;
                let item = if cfg.absolute_path {
                    full.to_string()
                } else {
                    disp.to_string()
                };
                out.push((item, is_dir, prefix_cwd));
            }
        }
    }

    if cfg.prune && matched_here {
        return;
    }

    if is_dir {
        if let Some(max_d) = cfg.max_depth {
            if depth >= max_d {
                return;
            }
        }
        let mut local_rules: Vec<String> = ignore_rules.to_vec();
        if depth > 0 && cfg.respect_ignore {
            for ign_name in [".gitignore", ".ignore", ".fdignore"] {
                if ign_name == ".gitignore" && cfg.no_ignore_vcs {
                    continue;
                }
                let ign_path = normalize_posix_path(&format!("{full}/{ign_name}"));
                if let Ok(bytes) = fs.read_file(&ign_path) {
                    for line in String::from_utf8_lossy(&bytes).lines() {
                        let t = line.trim();
                        if !t.is_empty() && !t.starts_with('#') {
                            local_rules.push(t.to_string());
                        }
                    }
                }
            }
        }
        if let Ok(entries) = fs.read_dir(full) {
            for e in entries {
                if !cfg.show_hidden && e.starts_with('.') {
                    continue;
                }
                let child_disp = if disp.is_empty() {
                    e.clone()
                } else if disp == "/" {
                    format!("/{e}")
                } else {
                    format!("{disp}/{e}")
                };
                let child_rel = if rel.is_empty() {
                    e.clone()
                } else {
                    format!("{rel}/{e}")
                };
                let child_full = normalize_posix_path(&format!("{full}/{e}"));
                walk_fd(
                    &child_disp,
                    &child_rel,
                    &child_full,
                    depth + 1,
                    prefix_cwd,
                    cfg,
                    &local_rules,
                    fs,
                    out,
                );
            }
        }
    }
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
    stdin: &str,
    cwd: &mut String,
    env: &mut BTreeMap<String, String>,
    fs: &dyn SafeBashFs,
    exec_sub: &mut F,
) -> BuiltinOutcome
where
    F: FnMut(&[String], &str, &mut String, &mut BTreeMap<String, String>) -> BuiltinOutcome,
{
    let mut delim_mode = XargsDelimMode::Whitespace;
    let mut batch_mode = XargsBatchMode::Default;
    let mut max_args: Option<usize> = None;
    let mut max_lines: Option<usize> = None;
    let mut max_chars: Option<usize> = None;
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
                        Some(_) => return usage_err("empty replacement string"),
                    };
                    replace_str = Some(repl);
                    batch_mode = XargsBatchMode::Replace;
                }
                "--max-lines" => {
                    let n = match inline_val {
                        None => 1usize,
                        Some(v) => {
                            let Some(parsed) = parse_pos_int(v) else {
                                return usage_err("invalid --max-lines value");
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
                        return usage_err("invalid --max-args value");
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
                    let Some(n) = parse_pos_int(&v) else {
                        return usage_err("invalid --max-chars value");
                    };
                    max_chars = Some(n);
                }
                "--max-procs" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --max-procs");
                    };
                    if v.is_empty() || !v.chars().all(|c| c.is_ascii_digit()) {
                        return usage_err("invalid --max-procs value");
                    }
                }
                "--delimiter" => {
                    let Some(v) = take_val(inline_val, &mut i) else {
                        return usage_err("missing value for --delimiter");
                    };
                    let Ok(ch) = parse_xargs_delim_strict(&v) else {
                        return usage_err("invalid --delimiter value");
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
                        return usage_err("invalid --process-slot-var value");
                    }
                    slot_var = Some(v);
                }
                _ => return usage_err(&format!("unknown option '{opt_name}'")),
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
                                return usage_err("invalid -l value");
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
                                    return usage_err("invalid -n value");
                                };
                                max_args = Some(n);
                                if !(batch_mode == XargsBatchMode::Replace && n == 1) {
                                    batch_mode = XargsBatchMode::MaxArgs;
                                }
                            }
                            'L' => {
                                let Some(n) = parse_pos_int(&val) else {
                                    return usage_err("invalid -L value");
                                };
                                max_lines = Some(n);
                                batch_mode = XargsBatchMode::MaxLines;
                            }
                            's' => {
                                let Some(n) = parse_pos_int(&val) else {
                                    return usage_err("invalid -s value");
                                };
                                max_chars = Some(n);
                            }
                            'P' => {
                                if val.is_empty() || !val.chars().all(|c| c.is_ascii_digit()) {
                                    return usage_err("invalid -P value");
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
                                    return usage_err("empty replacement string");
                                }
                                replace_str = Some(val);
                                batch_mode = XargsBatchMode::Replace;
                            }
                            'd' => {
                                let Ok(ch) = parse_xargs_delim_strict(&val) else {
                                    return usage_err("invalid -d delimiter");
                                };
                                delim_mode = XargsDelimMode::Custom(ch);
                            }
                            _ => {}
                        }
                        break;
                    }
                    other => return usage_err(&format!("unknown option '-{other}'")),
                }
                ci += 1;
            }
            i += 1;
            continue;
        }
        cmd_words.push(a.clone());
        i += 1;
    }

    if cmd_words.is_empty() {
        cmd_words.push("echo".to_string());
    }

    let mut out = String::new();
    let mut err = String::new();
    if delim_mode != XargsDelimMode::Whitespace
        && eof_marker.as_deref().is_some_and(|s| !s.is_empty())
    {
        err.push_str("xargs: warning: the -E option has no effect if -0 or -d is used.\n\n");
        eof_marker = None;
    }

    let input_buf: String;
    let input_str: &str = if let Some(ref af) = arg_file {
        let p = resolve_posix_path(cwd, af);
        match fs.read_file(&p) {
            Ok(b) => {
                input_buf = String::from_utf8_lossy(&b).into_owned();
                &input_buf
            }
            Err(e) => {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: format!("xargs: {af}: {e}\n"),
                    exit_code: 1,
                }
            }
        }
    } else {
        stdin
    };

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

    let mut child_stdin_first = if arg_file.is_some() { stdin } else { "" };
    let base_bytes: usize = cmd_words.iter().map(|w| w.len() + 1).sum();
    if let Some(mc) = max_chars
        && base_bytes > mc
    {
        err.push_str("xargs: command size limit exceeded\n");
        return BuiltinOutcome {
            stdout: out,
            stderr: err,
            exit_code: 2,
        };
    }

    let mut run_batch =
        |invoke: &[String], out: &mut String, err: &mut String, exit_code: &mut i32| -> Option<i32> {
            if verbose {
                let trace = invoke
                    .iter()
                    .map(|w| xargs_display(w))
                    .collect::<Vec<_>>()
                    .join(" ");
                err.push_str(&trace);
                err.push('\n');
            }
            let prev_slot = if let Some(ref sv) = slot_var {
                let old = env.get(sv).cloned();
                env.insert(sv.clone(), "0".to_string());
                Some((sv.clone(), old))
            } else {
                None
            };
            let sub_in = std::mem::take(&mut child_stdin_first);
            let res = exec_sub(invoke, sub_in, cwd, env);
            if let Some((sv, old)) = prev_slot {
                if let Some(val) = old {
                    env.insert(sv, val);
                } else {
                    env.remove(&sv);
                }
            }
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
                let mut invoke: Vec<String> = Vec::with_capacity(cmd_words.len());
                let mut replaced = false;
                for w in &cmd_words {
                    if w.contains(repl) {
                        replaced = true;
                        invoke.push(w.replace(repl, &item));
                    } else {
                        invoke.push(w.clone());
                    }
                }
                if !replaced {
                    invoke.push(item);
                }
                if let Some(mc) = max_chars {
                    let invoke_bytes: usize = invoke.iter().map(|w| w.len() + 1).sum();
                    if invoke_bytes > mc {
                        err.push_str("xargs: command size limit exceeded\n");
                        return BuiltinOutcome {
                            stdout: out,
                            stderr: err,
                            exit_code: 2,
                        };
                    }
                }
                if let Some(abort_code) = run_batch(&invoke, &mut out, &mut err, &mut exit_code) {
                    return BuiltinOutcome {
                        stdout: out,
                        stderr: err,
                        exit_code: abort_code,
                    };
                }
            }
        }
        XargsBatchMode::MaxLines => {
            let limit = max_lines.unwrap_or(1).max(1);
            let mut cur_batch: Vec<String> = Vec::new();
            let mut cur_bytes = 0usize;
            let mut lines_used = 0usize;
            let mut cur_line: Option<usize> = None;
            for (item, line_id) in parsed_items {
                let item_bytes = item.len() + 1;
                if let Some(mc) = max_chars && base_bytes + item_bytes > mc {
                    err.push_str("xargs: command size limit exceeded\n");
                    return BuiltinOutcome {
                        stdout: out,
                        stderr: err,
                        exit_code: 2,
                    };
                }
                let is_new_line = cur_line != Some(line_id);
                if is_new_line && lines_used >= limit && !cur_batch.is_empty() {
                    let mut invoke = cmd_words.clone();
                    invoke.extend(std::mem::take(&mut cur_batch));
                    cur_bytes = 0;
                    lines_used = 0;
                    cur_line = None;
                    if let Some(abort_code) = run_batch(&invoke, &mut out, &mut err, &mut exit_code)
                    {
                        return BuiltinOutcome {
                            stdout: out,
                            stderr: err,
                            exit_code: abort_code,
                        };
                    }
                }
                if let Some(mc) = max_chars
                    && !cur_batch.is_empty()
                    && base_bytes + cur_bytes + item_bytes > mc
                {
                    if exit_on_size {
                        err.push_str("xargs: command size limit exceeded\n");
                        return BuiltinOutcome {
                            stdout: out,
                            stderr: err,
                            exit_code: 2,
                        };
                    }
                    let mut invoke = cmd_words.clone();
                    invoke.extend(std::mem::take(&mut cur_batch));
                    cur_bytes = 0;
                    lines_used = 0;
                    cur_line = None;
                    if let Some(abort_code) = run_batch(&invoke, &mut out, &mut err, &mut exit_code)
                    {
                        return BuiltinOutcome {
                            stdout: out,
                            stderr: err,
                            exit_code: abort_code,
                        };
                    }
                }
                if cur_line != Some(line_id) {
                    cur_line = Some(line_id);
                    lines_used += 1;
                }
                cur_bytes += item_bytes;
                cur_batch.push(item);
            }
            if !cur_batch.is_empty() {
                let mut invoke = cmd_words.clone();
                invoke.extend(cur_batch);
                if let Some(abort_code) = run_batch(&invoke, &mut out, &mut err, &mut exit_code) {
                    return BuiltinOutcome {
                        stdout: out,
                        stderr: err,
                        exit_code: abort_code,
                    };
                }
            }
        }
        XargsBatchMode::Default | XargsBatchMode::MaxArgs => {
            let max_n = if batch_mode == XargsBatchMode::MaxArgs {
                max_args.unwrap_or(parsed_items.len()).max(1)
            } else {
                parsed_items.len().max(1)
            };
            let mut cur_batch: Vec<String> = Vec::new();
            let mut cur_bytes = 0usize;
            for (item, _) in parsed_items {
                let item_bytes = item.len() + 1;
                if let Some(mc) = max_chars {
                    if base_bytes + item_bytes > mc {
                        err.push_str("xargs: command size limit exceeded\n");
                        return BuiltinOutcome {
                            stdout: out,
                            stderr: err,
                            exit_code: 2,
                        };
                    }
                    if !cur_batch.is_empty() && base_bytes + cur_bytes + item_bytes > mc {
                        if exit_on_size && batch_mode == XargsBatchMode::MaxArgs {
                            err.push_str("xargs: command size limit exceeded\n");
                            return BuiltinOutcome {
                                stdout: out,
                                stderr: err,
                                exit_code: 2,
                            };
                        }
                        let mut invoke = cmd_words.clone();
                        invoke.extend(std::mem::take(&mut cur_batch));
                        cur_bytes = 0;
                        if let Some(abort_code) =
                            run_batch(&invoke, &mut out, &mut err, &mut exit_code)
                        {
                            return BuiltinOutcome {
                                stdout: out,
                                stderr: err,
                                exit_code: abort_code,
                            };
                        }
                    }
                }
                cur_bytes += item_bytes;
                cur_batch.push(item);
                if cur_batch.len() >= max_n {
                    let mut invoke = cmd_words.clone();
                    invoke.extend(std::mem::take(&mut cur_batch));
                    cur_bytes = 0;
                    if let Some(abort_code) = run_batch(&invoke, &mut out, &mut err, &mut exit_code)
                    {
                        return BuiltinOutcome {
                            stdout: out,
                            stderr: err,
                            exit_code: abort_code,
                        };
                    }
                }
            }
            if !cur_batch.is_empty() {
                let mut invoke = cmd_words.clone();
                invoke.extend(cur_batch);
                if let Some(abort_code) = run_batch(&invoke, &mut out, &mut err, &mut exit_code) {
                    return BuiltinOutcome {
                        stdout: out,
                        stderr: err,
                        exit_code: abort_code,
                    };
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
