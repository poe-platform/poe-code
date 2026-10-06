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
        "grep" | "egrep" | "fgrep" => Some(cmd_grep(
            cmd,
            args,
            stdin,
            cwd,
            fs,
            cmd == "fgrep",
        )),
        "rg" => Some(cmd_rg(args, stdin, cwd, fs)),
        "find" => Some(cmd_find(args, cwd, env, fs, &mut exec_sub)),
        "fd" => Some(cmd_fd(args, cwd, fs)),
        "xargs" => Some(cmd_xargs(args, stdin, cwd, env, &mut exec_sub)),
        "which" => Some(cmd_which(args)),
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

fn cmd_which(args: &[String]) -> BuiltinOutcome {
    if args.is_empty() {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 1,
        };
    }
    let mut out = String::new();
    let mut code = 0;
    for a in args {
        if a.starts_with('-') {
            continue;
        }
        if is_known_command(a) {
            out.push_str(&format!("/usr/bin/{a}\n"));
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
            | "csvcut"
            | "csvgrep"
            | "csvstat"
            | "xan"
            | "xmllint"
            | "sqlite3"
            | "tar"
            | "gzip"
            | "gunzip"
            | "zcat"
            | "zip"
            | "unzip"
            | "sha256sum"
            | "sha512sum"
            | "sha1sum"
            | "md5sum"
            | "cksum"
            | "base64"
            | "base32"
            | "xxd"
            | "od"
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

fn find_single_pattern(
    pat: &str,
    text: &str,
    ignore_case: bool,
    fixed_strings: bool,
    word_regexp: bool,
    line_regexp: bool,
) -> Vec<(usize, usize)> {
    if !fixed_strings {
        if let Some(alts) = split_top_level_alternation(pat) {
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
    let anchored_end = !fixed_strings && pat.ends_with('$') && !pat.ends_with("\\$");
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
    Group(Vec<String>),
    WordBoundary,
}

#[derive(Debug, Clone)]
struct RxToken {
    atom: RxAtom,
    min: usize,
    max: Option<usize>,
}

fn parse_rx(pat: &str, fixed: bool) -> Vec<RxToken> {
    if fixed {
        return pat
            .chars()
            .map(|c| RxToken {
                atom: RxAtom::Char(c),
                min: 1,
                max: Some(1),
            })
            .collect();
    }
    let chars: Vec<char> = pat.chars().collect();
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
                    'n' => RxAtom::Char('\n'),
                    't' => RxAtom::Char('\t'),
                    'r' => RxAtom::Char('\r'),
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
                    } else {
                        let c = if chars[idx] == '\\' && idx + 1 < chars.len() {
                            idx += 1;
                            chars[idx]
                        } else {
                            chars[idx]
                        };
                        ranges.push((c, c));
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
                let inner_clean = inner.strip_prefix("?:").unwrap_or(&inner);
                let alts = split_top_level_alternation(inner_clean)
                    .unwrap_or_else(|| vec![inner_clean.to_string()]);
                RxAtom::Group(alts)
            }
            c => {
                idx += 1;
                RxAtom::Char(c)
            }
        };

        let mut min = 1usize;
        let mut max = Some(1usize);
        if matches!(atom, RxAtom::WordBoundary) {
            out.push(RxToken { atom, min: 1, max: Some(1) });
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
        }
        out.push(RxToken { atom, min, max });
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

fn match_at_chars(
    pat: &str,
    hay: &[(usize, char)],
    pos: usize,
    ignore_case: bool,
    fixed: bool,
) -> Option<usize> {
    let tokens = parse_rx(pat, fixed);
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

    if matches!(tok.atom, RxAtom::WordBoundary) {
        let before_word = pos > 0 && is_word_char(hay[pos - 1].1);
        let after_word = pos < hay.len() && is_word_char(hay[pos].1);
        if before_word != after_word {
            return match_tokens(rest, hay, pos, ignore_case);
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

    for idx in (tok.min..positions.len()).rev() {
        if let Some(final_pos) = match_tokens(rest, hay, positions[idx], ignore_case) {
            return Some(final_pos);
        }
    }
    None
}

fn match_single_atom(
    atom: &RxAtom,
    hay: &[(usize, char)],
    pos: usize,
    ignore_case: bool,
) -> Option<usize> {
    match atom {
        RxAtom::Group(alts) => {
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
                RxAtom::Group(_) | RxAtom::WordBoundary => false,
            };
            if matched { Some(pos + 1) } else { None }
        }
    }
}

pub fn replace_regex_in_text(
    text: &str,
    pat: &str,
    replacement: &str,
    ignore_case: bool,
    global: bool,
    nth: Option<usize>,
) -> (String, bool) {
    let rx = ZeroRegex::new(vec![pat.to_string()], ignore_case, false, false, false);
    let matches = rx.find_all(text);
    if matches.is_empty() {
        return (text.to_string(), false);
    }
    let mut out = String::new();
    let mut last_end = 0usize;
    let mut replaced = false;
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
            let expanded = replacement.replace('&', matched_str);
            out.push_str(&expanded);
            replaced = true;
        } else {
            out.push_str(&text[s..e]);
        }
        last_end = e;
    }
    out.push_str(&text[last_end..]);
    (out, replaced)
}

fn cmd_grep(
    _invoked_as: &str,
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
    let mut files_with_matches = false;
    let mut files_without_match = false;
    let mut only_matching = false;
    let mut word_regexp = false;
    let mut line_regexp = false;
    let mut fixed_strings = default_fixed;
    let mut recursive = false;
    let mut quiet = false;
    let mut no_filename = false;
    let mut with_filename = false;
    let mut max_count: Option<usize> = None;
    let mut before_ctx = 0usize;
    let mut after_ctx = 0usize;
    let mut patterns: Vec<String> = Vec::new();
    let mut targets: Vec<String> = Vec::new();

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
                "--ignore-case" => ignore_case = true,
                "--invert-match" => invert = true,
                "--count" => count_only = true,
                "--line-number" => line_number = true,
                "--files-with-matches" => files_with_matches = true,
                "--files-without-match" => files_without_match = true,
                "--only-matching" => only_matching = true,
                "--word-regexp" => word_regexp = true,
                "--line-regexp" => line_regexp = true,
                "--fixed-strings" => fixed_strings = true,
                "--extended-regexp" | "--basic-regexp" => {}
                "--recursive" => recursive = true,
                "--quiet" | "--silent" => quiet = true,
                "--no-filename" => no_filename = true,
                "--with-filename" => with_filename = true,
                _ => {
                    if let Some(val) = a.strip_prefix("--max-count=") {
                        max_count = val.parse().ok();
                    } else if let Some(val) = a.strip_prefix("--regexp=") {
                        patterns.push(val.to_string());
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
                    'l' => files_with_matches = true,
                    'L' => files_without_match = true,
                    'o' => only_matching = true,
                    'w' => word_regexp = true,
                    'x' => line_regexp = true,
                    'F' => fixed_strings = true,
                    'E' | 'G' | 'P' => {}
                    'r' | 'R' => recursive = true,
                    'q' | 's' => quiet = true,
                    'h' => no_filename = true,
                    'H' => with_filename = true,
                    'e' => {
                        let rest: String = chars[ci + 1..].iter().collect();
                        if !rest.is_empty() {
                            patterns.push(rest);
                        } else if i + 1 < args.len() {
                            i += 1;
                            patterns.push(args[i].clone());
                        }
                        break;
                    }
                    'f' => {
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
                                patterns.push(line.to_string());
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
                    _ => {}
                }
                ci += 1;
            }
            i += 1;
            continue;
        }
        if patterns.is_empty() {
            patterns.push(a.clone());
        } else {
            targets.push(a.clone());
        }
        i += 1;
    }

    run_grep_engine(
        patterns,
        targets,
        stdin,
        cwd,
        fs,
        GrepConfig {
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
            globs: Vec::new(),
        },
    )
}

fn cmd_rg(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut ignore_case = false;
    let mut smart_case = false;
    let mut invert = false;
    let mut count_only = false;
    let mut line_number = false;
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
    let mut max_count: Option<usize> = None;
    let mut before_ctx = 0usize;
    let mut after_ctx = 0usize;
    let mut globs: Vec<String> = Vec::new();
    let mut patterns: Vec<String> = Vec::new();
    let mut targets: Vec<String> = Vec::new();

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
                "--files" => list_files_only = true,
                "--ignore-case" => ignore_case = true,
                "--smart-case" => smart_case = true,
                "--invert-match" => invert = true,
                "--count" => count_only = true,
                "--line-number" => line_number = true,
                "--no-line-number" => line_number = false,
                "--files-with-matches" => files_with_matches = true,
                "--files-without-match" => files_without_match = true,
                "--only-matching" => only_matching = true,
                "--word-regexp" => word_regexp = true,
                "--line-regexp" => line_regexp = true,
                "--fixed-strings" => fixed_strings = true,
                "--quiet" => quiet = true,
                "--no-filename" | "--no-heading" => no_filename = true,
                "--with-filename" => with_filename = true,
                "--glob" | "-g" if i + 1 < args.len() => {
                    i += 1;
                    globs.push(args[i].clone());
                }
                "--regexp" if i + 1 < args.len() => {
                    i += 1;
                    patterns.push(args[i].clone());
                }
                "--max-count" if i + 1 < args.len() => {
                    i += 1;
                    max_count = args[i].parse().ok();
                }
                _ => {
                    if let Some(g) = a.strip_prefix("--glob=") {
                        globs.push(g.to_string());
                    } else if let Some(m) = a.strip_prefix("--max-count=") {
                        max_count = m.parse().ok();
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
                    'S' => smart_case = true,
                    'v' => invert = true,
                    'c' => count_only = true,
                    'n' => line_number = true,
                    'N' => line_number = false,
                    'l' => files_with_matches = true,
                    'o' => only_matching = true,
                    'w' => word_regexp = true,
                    'x' => line_regexp = true,
                    'F' => fixed_strings = true,
                    'q' => quiet = true,
                    'I' => no_filename = true,
                    'H' => with_filename = true,
                    'e' => {
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
                    _ => {}
                }
                ci += 1;
            }
            i += 1;
            continue;
        }
        if !list_files_only && patterns.is_empty() {
            patterns.push(a.clone());
        } else {
            targets.push(a.clone());
        }
        i += 1;
    }

    if list_files_only {
        let search_roots = if targets.is_empty() {
            vec![".".to_string()]
        } else {
            targets
        };
        let mut files = Vec::new();
        for r in &search_roots {
            collect_search_files(r, cwd, fs, true, &globs, &mut files);
        }
        let mut out = String::new();
        for (disp, _) in files {
            let clean = disp.strip_prefix("./").unwrap_or(&disp);
            out.push_str(clean);
            out.push('\n');
        }
        return ok_out(&out);
    }

    if smart_case && !ignore_case {
        let has_upper = patterns.iter().any(|p| p.chars().any(|c| c.is_ascii_uppercase()));
        if !has_upper {
            ignore_case = true;
        }
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
        },
    )
}

struct GrepConfig {
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
}

fn collect_search_files(
    target: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
    recursive: bool,
    globs: &[String],
    out: &mut Vec<(String, String)>,
) {
    let resolved = resolve_posix_path(cwd, target);
    if fs.is_dir(&resolved) {
        if !recursive {
            return;
        }
        if let Ok(entries) = fs.read_dir(&resolved) {
            for e in entries {
                if e.starts_with('.') {
                    continue;
                }
                let disp = if target == "." {
                    e.clone()
                } else {
                    format!("{}/{}", target.trim_end_matches('/'), e)
                };
                collect_search_files(&disp, cwd, fs, true, globs, out);
            }
        }
    } else if fs.exists(&resolved) {
        let base = basename_posix_path(&resolved);
        if !globs.is_empty() {
            let mut include = true;
            let mut has_pos = false;
            let mut pos_matched = false;
            for g in globs {
                if let Some(neg) = g.strip_prefix('!') {
                    if glob_match(neg, &base) || glob_match(neg, target) {
                        include = false;
                    }
                } else {
                    has_pos = true;
                    if glob_match(g, &base) || glob_match(g, target) {
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

    let mut inputs: Vec<(Option<String>, String)> = Vec::new();
    let mut err = String::new();
    let mut had_error = false;

    if targets.is_empty() {
        inputs.push((None, stdin.to_string()));
    } else {
        let mut file_list = Vec::new();
        for t in &targets {
            if t == "-" {
                inputs.push((Some("(standard input)".to_string()), stdin.to_string()));
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
            collect_search_files(t, cwd, fs, cfg.recursive, &cfg.globs, &mut file_list);
        }
        for (disp, full) in file_list {
            if let Ok(bytes) = fs.read_file(&full) {
                inputs.push((Some(disp), String::from_utf8_lossy(&bytes).into_owned()));
            }
        }
    }

    let show_filename = if cfg.no_filename {
        false
    } else if cfg.with_filename {
        true
    } else {
        inputs.len() > 1 || cfg.recursive
    };

    let mut out = String::new();
    let mut any_match = false;

    for (fname, content) in &inputs {
        let lines: Vec<&str> = content.lines().collect();
        let mut match_indices = Vec::new();
        let mut matched_count = 0usize;

        for (idx, line) in lines.iter().enumerate() {
            let line_matches = rx.find_all(line);
            let is_matched = if cfg.invert {
                line_matches.is_empty()
            } else {
                !line_matches.is_empty()
            };
            if is_matched {
                any_match = true;
                if cfg.quiet {
                    return ok_out("");
                }
                match_indices.push((idx, line_matches));
                matched_count += 1;
                if let Some(max_c) = cfg.max_count {
                    if matched_count >= max_c {
                        break;
                    }
                }
            }
        }

        if cfg.files_with_matches {
            if matched_count > 0 {
                if let Some(f) = fname {
                    out.push_str(&format!("{f}\n"));
                }
            }
            continue;
        }
        if cfg.files_without_match {
            if matched_count == 0 {
                if let Some(f) = fname {
                    out.push_str(&format!("{f}\n"));
                }
            }
            continue;
        }
        if cfg.count_only {
            if show_filename {
                if let Some(f) = fname {
                    out.push_str(&format!("{f}:{matched_count}\n"));
                    continue;
                }
            }
            out.push_str(&format!("{matched_count}\n"));
            continue;
        }

        if cfg.only_matching && !cfg.invert {
            for (idx, spans) in &match_indices {
                let line = lines[*idx];
                for &(s, e) in spans {
                    if show_filename {
                        if let Some(f) = fname {
                            out.push_str(&format!("{f}:"));
                        }
                    }
                    if cfg.line_number {
                        out.push_str(&format!("{}:", idx + 1));
                    }
                    out.push_str(&line[s..e]);
                    out.push('\n');
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
            let match_set: std::collections::BTreeSet<usize> =
                match_indices.iter().map(|(i, _)| *i).collect();
            for (idx, should_print) in printed.iter().enumerate() {
                if !*should_print {
                    continue;
                }
                let sep = if match_set.contains(&idx) { ':' } else { '-' };
                if show_filename {
                    if let Some(f) = fname {
                        out.push_str(&format!("{f}{sep}"));
                    }
                }
                if cfg.line_number {
                    out.push_str(&format!("{}{sep}", idx + 1));
                }
                out.push_str(lines[idx]);
                out.push('\n');
            }
        } else {
            for (idx, _) in &match_indices {
                if show_filename {
                    if let Some(f) = fname {
                        out.push_str(&format!("{f}:"));
                    }
                }
                if cfg.line_number {
                    out.push_str(&format!("{}:", idx + 1));
                }
                out.push_str(lines[*idx]);
                out.push('\n');
            }
        }
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

#[derive(Clone)]
enum FindPred {
    Name { pat: String, ignore_case: bool },
    Path { pat: String, ignore_case: bool },
    Type(char),
    Empty,
    Size { op: i8, bytes: usize },
    Not(Box<FindPred>),
    And(Box<FindPred>, Box<FindPred>),
    Or(Box<FindPred>, Box<FindPred>),
}

fn eval_find_pred(
    pred: &FindPred,
    disp_path: &str,
    full_path: &str,
    depth: usize,
    fs: &dyn SafeBashFs,
) -> bool {
    match pred {
        FindPred::Name { pat, ignore_case } => {
            let base = if depth == 0 && disp_path == "." {
                ".".to_string()
            } else {
                basename_posix_path(disp_path)
            };
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
        FindPred::Type(t) => match fs.lstat(full_path) {
            Ok(st) => match t {
                'f' => st.kind == VfsEntryKind::File,
                'd' => st.kind == VfsEntryKind::Directory,
                'l' => st.kind == VfsEntryKind::Symlink,
                _ => false,
            },
            Err(_) => false,
        },
        FindPred::Empty => match fs.stat(full_path) {
            Ok(st) => match st.kind {
                VfsEntryKind::File => st.size == 0,
                VfsEntryKind::Directory => fs
                    .read_dir(full_path)
                    .map(|e| e.is_empty())
                    .unwrap_or(false),
                _ => false,
            },
            Err(_) => false,
        },
        FindPred::Size { op, bytes } => match fs.stat(full_path) {
            Ok(st) => match op {
                1 => st.size > *bytes,
                -1 => st.size < *bytes,
                _ => st.size == *bytes,
            },
            Err(_) => false,
        },
        FindPred::Not(inner) => !eval_find_pred(inner, disp_path, full_path, depth, fs),
        FindPred::And(a, b) => {
            eval_find_pred(a, disp_path, full_path, depth, fs)
                && eval_find_pred(b, disp_path, full_path, depth, fs)
        }
        FindPred::Or(a, b) => {
            eval_find_pred(a, disp_path, full_path, depth, fs)
                || eval_find_pred(b, disp_path, full_path, depth, fs)
        }
    }
}

fn parse_size_arg(s: &str) -> (i8, usize) {
    let (op, rest) = if let Some(r) = s.strip_prefix('+') {
        (1, r)
    } else if let Some(r) = s.strip_prefix('-') {
        (-1, r)
    } else {
        (0, s)
    };
    let (num_str, mult) = if let Some(n) = rest.strip_suffix('c') {
        (n, 1usize)
    } else if let Some(n) = rest.strip_suffix('k') {
        (n, 1024usize)
    } else if let Some(n) = rest.strip_suffix('M') {
        (n, 1024 * 1024usize)
    } else if let Some(n) = rest.strip_suffix('G') {
        (n, 1024 * 1024 * 1024usize)
    } else {
        (rest, 512usize)
    };
    let n = num_str.parse::<usize>().unwrap_or(0);
    (op, n * mult)
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
    let mut roots = Vec::new();
    let mut idx = 0usize;
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

    let mut max_depth: Option<usize> = None;
    let mut min_depth: usize = 0;
    let mut print0 = false;
    let mut delete_matched = false;
    let mut exec_template: Option<(Vec<String>, bool)> = None;
    let mut pred: Option<FindPred> = None;
    let mut pending_or = false;
    let mut pending_not = false;

    while idx < args.len() {
        let a = &args[idx];
        match a.as_str() {
            "(" | ")" | "-print" => {
                idx += 1;
            }
            "-print0" => {
                print0 = true;
                idx += 1;
            }
            "-delete" => {
                delete_matched = true;
                idx += 1;
            }
            "!" | "-not" => {
                pending_not = !pending_not;
                idx += 1;
            }
            "-o" | "-or" => {
                pending_or = true;
                idx += 1;
            }
            "-a" | "-and" => {
                pending_or = false;
                idx += 1;
            }
            "-maxdepth" if idx + 1 < args.len() => {
                max_depth = args[idx + 1].parse().ok();
                idx += 2;
            }
            "-mindepth" if idx + 1 < args.len() => {
                min_depth = args[idx + 1].parse().unwrap_or(0);
                idx += 2;
            }
            "-name" | "-iname" if idx + 1 < args.len() => {
                let p = FindPred::Name {
                    pat: args[idx + 1].clone(),
                    ignore_case: a == "-iname",
                };
                combine_pred(&mut pred, p, &mut pending_not, &mut pending_or);
                idx += 2;
            }
            "-path" | "-ipath" if idx + 1 < args.len() => {
                let p = FindPred::Path {
                    pat: args[idx + 1].clone(),
                    ignore_case: a == "-ipath",
                };
                combine_pred(&mut pred, p, &mut pending_not, &mut pending_or);
                idx += 2;
            }
            "-type" if idx + 1 < args.len() => {
                let tc = args[idx + 1].chars().next().unwrap_or('f');
                combine_pred(
                    &mut pred,
                    FindPred::Type(tc),
                    &mut pending_not,
                    &mut pending_or,
                );
                idx += 2;
            }
            "-empty" => {
                combine_pred(&mut pred, FindPred::Empty, &mut pending_not, &mut pending_or);
                idx += 1;
            }
            "-size" if idx + 1 < args.len() => {
                let (op, bytes) = parse_size_arg(&args[idx + 1]);
                combine_pred(
                    &mut pred,
                    FindPred::Size { op, bytes },
                    &mut pending_not,
                    &mut pending_or,
                );
                idx += 2;
            }
            "-exec" => {
                idx += 1;
                let mut cmd_words = Vec::new();
                let mut batch = false;
                while idx < args.len() {
                    if args[idx] == ";" || args[idx] == "\\;" {
                        idx += 1;
                        break;
                    }
                    if args[idx] == "+" {
                        batch = true;
                        idx += 1;
                        break;
                    }
                    cmd_words.push(args[idx].clone());
                    idx += 1;
                }
                exec_template = Some((cmd_words, batch));
            }
            _ => {
                idx += 1;
            }
        }
    }

    let mut matched_paths = Vec::new();
    let mut err = String::new();
    let mut exit_code = 0;

    for r in &roots {
        let full = resolve_posix_path(cwd, r);
        if !fs.exists(&full) {
            err.push_str(&format!("find: '{r}': No such file or directory\n"));
            exit_code = 1;
            continue;
        }
        walk_find(
            r,
            &full,
            0,
            min_depth,
            max_depth,
            &pred,
            fs,
            &mut matched_paths,
        );
    }

    if delete_matched {
        for (_, full) in matched_paths.iter().rev() {
            let _ = fs.remove(full, true);
        }
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: err,
            exit_code,
        };
    }

    if let Some((tpl, batch)) = exec_template {
        let mut out = String::new();
        if batch {
            if !matched_paths.is_empty() {
                let mut cmd_args = Vec::new();
                for w in &tpl {
                    if w == "{}" {
                        for (disp, _) in &matched_paths {
                            cmd_args.push(disp.clone());
                        }
                    } else {
                        cmd_args.push(w.clone());
                    }
                }
                let res = exec_sub(&cmd_args, "", cwd, env);
                out.push_str(&res.stdout);
                err.push_str(&res.stderr);
            }
        } else {
            for (disp, _) in &matched_paths {
                let cmd_args: Vec<String> = tpl
                    .iter()
                    .map(|w| w.replace("{}", disp))
                    .collect();
                let res = exec_sub(&cmd_args, "", cwd, env);
                out.push_str(&res.stdout);
                err.push_str(&res.stderr);
            }
        }
        return BuiltinOutcome {
            stdout: out,
            stderr: err,
            exit_code,
        };
    }

    let mut out = String::new();
    let sep = if print0 { '\0' } else { '\n' };
    for (disp, _) in matched_paths {
        out.push_str(&disp);
        out.push(sep);
    }
    BuiltinOutcome {
        stdout: out,
        stderr: err,
        exit_code,
    }
}

fn combine_pred(
    current: &mut Option<FindPred>,
    mut next: FindPred,
    pending_not: &mut bool,
    pending_or: &mut bool,
) {
    if *pending_not {
        next = FindPred::Not(Box::new(next));
        *pending_not = false;
    }
    *current = match current.take() {
        None => Some(next),
        Some(prev) => {
            if *pending_or {
                *pending_or = false;
                Some(FindPred::Or(Box::new(prev), Box::new(next)))
            } else {
                Some(FindPred::And(Box::new(prev), Box::new(next)))
            }
        }
    };
}

fn walk_find(
    disp: &str,
    full: &str,
    depth: usize,
    min_depth: usize,
    max_depth: Option<usize>,
    pred: &Option<FindPred>,
    fs: &dyn SafeBashFs,
    out: &mut Vec<(String, String)>,
) {
    if let Some(max_d) = max_depth {
        if depth > max_d {
            return;
        }
    }
    if depth >= min_depth {
        let ok = match pred {
            Some(p) => eval_find_pred(p, disp, full, depth, fs),
            None => true,
        };
        if ok {
            out.push((disp.to_string(), full.to_string()));
        }
    }
    if let Some(max_d) = max_depth {
        if depth >= max_d {
            return;
        }
    }
    if let Ok(st) = fs.lstat(full) {
        if st.kind == VfsEntryKind::Directory {
            if let Ok(entries) = fs.read_dir(full) {
                for e in entries {
                    let child_disp = if disp == "/" {
                        format!("/{e}")
                    } else {
                        format!("{}/{e}", disp.trim_end_matches('/'))
                    };
                    let child_full = normalize_posix_path(&format!("{full}/{e}"));
                    walk_find(
                        &child_disp,
                        &child_full,
                        depth + 1,
                        min_depth,
                        max_depth,
                        pred,
                        fs,
                        out,
                    );
                }
            }
        }
    }
}

fn cmd_fd(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut ext_filter: Option<String> = None;
    let mut type_filter: Option<char> = None;
    let mut max_depth: Option<usize> = None;
    let mut show_hidden = false;
    let mut print0 = false;
    let mut pattern: Option<String> = None;
    let mut roots: Vec<String> = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        match a.as_str() {
            "-H" | "--hidden" => show_hidden = true,
            "-0" | "--print0" => print0 = true,
            "-e" | "--extension" if i + 1 < args.len() => {
                i += 1;
                ext_filter = Some(args[i].trim_start_matches('.').to_string());
            }
            "-t" | "--type" if i + 1 < args.len() => {
                i += 1;
                type_filter = args[i].chars().next();
            }
            "-d" | "--max-depth" if i + 1 < args.len() => {
                i += 1;
                max_depth = args[i].parse().ok();
            }
            _ if a.starts_with('-') => {}
            _ => {
                if pattern.is_none() {
                    pattern = Some(a.clone());
                } else {
                    roots.push(a.clone());
                }
            }
        }
        i += 1;
    }

    if roots.is_empty() {
        roots.push(".".to_string());
    }

    let rx = pattern.map(|p| ZeroRegex::new(vec![p], true, false, false, false));
    let mut results = Vec::new();

    for r in &roots {
        let full = resolve_posix_path(cwd, r);
        walk_fd(
            r,
            &full,
            0,
            max_depth,
            show_hidden,
            &ext_filter,
            type_filter,
            &rx,
            fs,
            &mut results,
        );
    }

    let sep = if print0 { '\0' } else { '\n' };
    let mut out = String::new();
    for item in results {
        let clean = item.strip_prefix("./").unwrap_or(&item);
        out.push_str(clean);
        out.push(sep);
    }
    ok_out(&out)
}

fn walk_fd(
    disp: &str,
    full: &str,
    depth: usize,
    max_depth: Option<usize>,
    show_hidden: bool,
    ext_filter: &Option<String>,
    type_filter: Option<char>,
    rx: &Option<ZeroRegex>,
    fs: &dyn SafeBashFs,
    out: &mut Vec<String>,
) {
    if let Some(max_d) = max_depth {
        if depth > max_d {
            return;
        }
    }
    if depth > 0 {
        let base = basename_posix_path(disp);
        if !show_hidden && base.starts_with('.') {
            return;
        }
        let mut matches = true;
        if let Some(t) = type_filter {
            if let Ok(st) = fs.lstat(full) {
                matches = match t {
                    'f' => st.kind == VfsEntryKind::File,
                    'd' => st.kind == VfsEntryKind::Directory,
                    'l' => st.kind == VfsEntryKind::Symlink,
                    _ => true,
                };
            }
        }
        if matches {
            if let Some(ext) = ext_filter {
                matches = base.ends_with(&format!(".{ext}"));
            }
        }
        if matches {
            if let Some(r) = rx {
                matches = r.is_match(&base);
            }
        }
        if matches {
            out.push(disp.to_string());
        }
    }
    if let Ok(st) = fs.lstat(full) {
        if st.kind == VfsEntryKind::Directory {
            if let Ok(entries) = fs.read_dir(full) {
                for e in entries {
                    if !show_hidden && e.starts_with('.') {
                        continue;
                    }
                    let child_disp = if disp == "." {
                        e.clone()
                    } else {
                        format!("{}/{e}", disp.trim_end_matches('/'))
                    };
                    let child_full = normalize_posix_path(&format!("{full}/{e}"));
                    walk_fd(
                        &child_disp,
                        &child_full,
                        depth + 1,
                        max_depth,
                        show_hidden,
                        ext_filter,
                        type_filter,
                        rx,
                        fs,
                        out,
                    );
                }
            }
        }
    }
}

fn cmd_xargs<F>(
    args: &[String],
    stdin: &str,
    cwd: &mut String,
    env: &mut BTreeMap<String, String>,
    exec_sub: &mut F,
) -> BuiltinOutcome
where
    F: FnMut(&[String], &str, &mut String, &mut BTreeMap<String, String>) -> BuiltinOutcome,
{
    let mut null_delim = false;
    let mut max_args: Option<usize> = None;
    let mut replace_str: Option<String> = None;
    let mut custom_delim: Option<char> = None;
    let mut no_run_if_empty = false;
    let mut cmd_words: Vec<String> = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if cmd_words.is_empty() && a.starts_with('-') {
            match a.as_str() {
                "-0" | "--null" => null_delim = true,
                "-r" | "--no-run-if-empty" => no_run_if_empty = true,
                "-n" if i + 1 < args.len() => {
                    i += 1;
                    max_args = args[i].parse().ok();
                }
                "-I" if i + 1 < args.len() => {
                    i += 1;
                    replace_str = Some(args[i].clone());
                }
                "-d" if i + 1 < args.len() => {
                    i += 1;
                    let d = if args[i] == "\\n" {
                        '\n'
                    } else {
                        args[i].chars().next().unwrap_or('\n')
                    };
                    custom_delim = Some(d);
                }
                _ => {
                    if let Some(rest) = a.strip_prefix("-n") {
                        max_args = rest.parse().ok();
                    } else if let Some(rest) = a.strip_prefix("-I") {
                        replace_str = Some(rest.to_string());
                    }
                }
            }
        } else {
            cmd_words.push(a.clone());
        }
        i += 1;
    }

    if cmd_words.is_empty() {
        cmd_words.push("echo".to_string());
    }

    let items: Vec<String> = if null_delim {
        stdin
            .split('\0')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect()
    } else if let Some(d) = custom_delim {
        stdin
            .split(d)
            .map(|s| s.trim_end_matches('\n').to_string())
            .filter(|s| !s.is_empty())
            .collect()
    } else if replace_str.is_some() {
        stdin
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| l.to_string())
            .collect()
    } else {
        tokenize_xargs_input(stdin)
    };

    if items.is_empty() {
        if no_run_if_empty || replace_str.is_some() {
            return ok_out("");
        }
        return exec_sub(&cmd_words, "", cwd, env);
    }

    let mut out = String::new();
    let mut err = String::new();
    let mut exit_code = 0;

    if let Some(rep) = replace_str {
        for item in &items {
            let invoke: Vec<String> = cmd_words
                .iter()
                .map(|w| w.replace(&rep, item))
                .collect();
            let res = exec_sub(&invoke, "", cwd, env);
            out.push_str(&res.stdout);
            err.push_str(&res.stderr);
            if res.exit_code != 0 {
                exit_code = res.exit_code;
            }
        }
    } else {
        let batch_size = max_args.unwrap_or(items.len());
        for chunk in items.chunks(batch_size.max(1)) {
            let mut invoke = cmd_words.clone();
            invoke.extend_from_slice(chunk);
            let res = exec_sub(&invoke, "", cwd, env);
            out.push_str(&res.stdout);
            err.push_str(&res.stderr);
            if res.exit_code != 0 {
                exit_code = res.exit_code;
            }
        }
    }

    BuiltinOutcome {
        stdout: out,
        stderr: err,
        exit_code,
    }
}

fn tokenize_xargs_input(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if let Some(q) = quote {
            if c == q {
                quote = None;
            } else {
                cur.push(c);
            }
        } else if c == '\'' || c == '"' {
            quote = Some(c);
        } else if c == '\\' {
            if let Some(nc) = chars.next() {
                cur.push(nc);
            }
        } else if c.is_whitespace() {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
        } else {
            cur.push(c);
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

