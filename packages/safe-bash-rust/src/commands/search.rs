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
        "fd" => Some(cmd_fd(args, cwd, env, fs, &mut exec_sub)),
        "xargs" => Some(cmd_xargs(args, stdin, cwd, env, &mut exec_sub)),
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
    let mut show_all = false;
    let mut silent = false;
    let mut names = Vec::new();
    for a in args {
        if let Some(flags) = a.strip_prefix('-') {
            for ch in flags.chars() {
                if ch == 'a' {
                    show_all = true;
                } else if ch == 's' {
                    silent = true;
                }
            }
        } else {
            names.push(a.clone());
        }
    }
    if names.is_empty() {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 1,
        };
    }
    let path_str = env
        .get("PATH")
        .cloned()
        .unwrap_or_else(|| "/usr/local/bin:/usr/bin:/bin".to_string());
    let path_dirs: Vec<&str> = path_str.split(':').filter(|s| !s.is_empty()).collect();

    let mut out = String::new();
    let mut code = 0;
    for name in &names {
        let mut found = Vec::new();
        if name.contains('/') {
            let full = resolve_posix_path(cwd, name);
            if fs.exists(&full) && !fs.is_dir(&full) {
                found.push(name.clone());
            }
        } else {
            for dir in &path_dirs {
                let cand = resolve_posix_path(cwd, &format!("{dir}/{name}"));
                if fs.exists(&cand) && !fs.is_dir(&cand) {
                    found.push(cand);
                    if !show_all {
                        break;
                    }
                }
            }
            if found.is_empty() && is_known_command(name) {
                found.push(format!("/usr/bin/{name}"));
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
            | "unxz"
            | "unzstd"
            | "disown"
            | "kill"
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
    Group(Vec<String>),
    WordBoundary,
}

#[derive(Debug, Clone)]
struct RxToken {
    atom: RxAtom,
    min: usize,
    max: Option<usize>,
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
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(&nc) = chars.peek() {
                if matches!(nc, '(' | ')' | '+' | '?') {
                    out.push(chars.next().unwrap());
                    continue;
                }
                if nc == '{' || nc == '}' {
                    let mut clone = chars.clone();
                    let _ = clone.next();
                    if nc == '}' || clone.peek().is_some_and(|d| d.is_ascii_digit()) {
                        out.push(chars.next().unwrap());
                        continue;
                    }
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
            if idx < chars.len() && chars[idx] == '?' && (min != 1 || max != Some(1)) {
                idx += 1;
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
    if tokens.is_empty() {
        return Some((pos, Vec::new()));
    }
    let tok = &tokens[0];
    let rest = &tokens[1..];

    if matches!(tok.atom, RxAtom::WordBoundary) {
        let before_word = pos > 0 && is_word_char(hay[pos - 1].1);
        let after_word = pos < hay.len() && is_word_char(hay[pos].1);
        if before_word != after_word {
            return match_tokens_with_caps(rest, hay, text, pos, ignore_case);
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
        if let Some((final_pos, rest_caps)) =
            match_tokens_with_caps(rest, hay, text, step_pos, ignore_case)
        {
            let mut combined = step_caps.clone();
            combined.extend(rest_caps);
            return Some((final_pos, combined));
        }
    }
    None
}

fn match_single_atom_with_caps(
    atom: &RxAtom,
    hay: &[(usize, char)],
    text: &str,
    pos: usize,
    ignore_case: bool,
) -> Option<(usize, Vec<String>)> {
    match atom {
        RxAtom::Group(alts) => {
            for alt in alts {
                let sub_tokens = parse_rx(alt, false);
                if let Some((end_pos, sub_caps)) =
                    match_tokens_with_caps(&sub_tokens, hay, text, pos, ignore_case)
                {
                    let start_byte = if pos < hay.len() { hay[pos].0 } else { text.len() };
                    let end_byte = if end_pos < hay.len() {
                        hay[end_pos].0
                    } else {
                        text.len()
                    };
                    let mut caps = vec![text[start_byte..end_byte].to_string()];
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
    let mut out = String::new();
    let mut chars = replacement.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some(d @ '1'..='9') => {
                    let idx = (d as u8 - b'1') as usize;
                    if let Some(cap) = caps.get(idx + 1) {
                        out.push_str(cap);
                    }
                }
                Some('&') => out.push('&'),
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some(other) => out.push(other),
                None => out.push('\\'),
            }
        } else if c == '&' {
            out.push_str(matched_str);
        } else {
            out.push(c);
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
    let rx = ZeroRegex::new(vec![pat.to_string()], ignore_case, false, false, false);
    let matches = rx.find_all(text);
    if matches.is_empty() {
        return (text.to_string(), false);
    }
    let no_caret = pat.strip_prefix('^').unwrap_or(pat);
    let core_pat = if has_unescaped_trailing_dollar(no_caret) {
        &no_caret[..no_caret.len() - 1]
    } else {
        no_caret
    };
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
            let caps = regex_captures(&format!("^{core_pat}$"), matched_str, ignore_case)
                .or_else(|| regex_captures(pat, matched_str, ignore_case))
                .unwrap_or_else(|| vec![matched_str.to_string()]);
            let expanded = expand_regex_replacement(replacement, matched_str, &caps);
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
        out.push_str(&expand_rg_replacement(rep, matched_slice, &caps));
        last = e;
    }
    out.push_str(&line[last..]);
    out
}

fn expand_rg_replacement(replacement: &str, matched_str: &str, caps: &[String]) -> String {
    let mut out = String::new();
    let mut chars = replacement.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '$' {
            match chars.peek().copied() {
                Some('0') => {
                    chars.next();
                    out.push_str(matched_str);
                }
                Some(d @ '1'..='9') => {
                    chars.next();
                    let idx = (d as u8 - b'1') as usize;
                    if let Some(cap) = caps.get(idx + 1) {
                        out.push_str(cap);
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
    let mut byte_offset = false;
    let mut null_delim = false;
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
    let mut multiline = false;
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
                "--ignore-case" => ignore_case = true,
                "--invert-match" => invert = true,
                "--count" | "--count-matches" => count_only = true,
                "--line-number" => line_number = true,
                "--byte-offset" => byte_offset = true,
                "--null" => null_delim = true,
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
                    let resolved = resolve_posix_path(cwd, &args[i]);
                    if let Ok(bytes) = fs.read_file(&resolved) {
                        for line in String::from_utf8_lossy(&bytes).lines() {
                            patterns.push(line.to_string());
                        }
                    }
                }
                _ => {
                    if let Some(val) = a.strip_prefix("--max-count=") {
                        max_count = val.parse().ok();
                    } else if let Some(val) = a.strip_prefix("--regexp=") {
                        patterns.push(val.to_string());
                    } else if let Some(val) = a.strip_prefix("--include=") {
                        globs.push(val.to_string());
                    } else if let Some(val) = a.strip_prefix("--exclude=") {
                        globs.push(format!("!{val}"));
                    } else if let Some(val) = a.strip_prefix("--exclude-dir=") {
                        globs.push(format!("!{val}"));
                    } else if let Some(val) = a.strip_prefix("--file=") {
                        let resolved = resolve_posix_path(cwd, val);
                        if let Ok(bytes) = fs.read_file(&resolved) {
                            for line in String::from_utf8_lossy(&bytes).lines() {
                                patterns.push(line.to_string());
                            }
                        }
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
                    'U' => multiline = true,
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
            json_output: false,
            replace: None,
            multiline,
        },
    )
}

fn cmd_rg(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut ignore_case = false;
    let mut smart_case = false;
    let mut invert = false;
    let mut count_only = false;
    let mut line_number = false;
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
    let mut multiline = false;
    let mut replace: Option<String> = None;
    let mut max_count: Option<usize> = None;
    let mut before_ctx = 0usize;
    let mut after_ctx = 0usize;
    let mut globs: Vec<String> = Vec::new();
    let mut types_include: Vec<String> = Vec::new();
    let mut types_exclude: Vec<String> = Vec::new();
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
                "--count" | "--count-matches" => count_only = true,
                "--line-number" => line_number = true,
                "--no-line-number" => line_number = false,
                "--byte-offset" => byte_offset = true,
                "--null" => null_delim = true,
                "--hidden" => show_hidden = true,
                "--no-ignore" => unrestricted_level = unrestricted_level.max(1),
                "--unrestricted" => unrestricted_level += 1,
                "--json" => json_output = true,
                "--multiline" | "--multiline-dotall" => multiline = true,
                "--file" if i + 1 < args.len() => {
                    i += 1;
                    let resolved = resolve_posix_path(cwd, &args[i]);
                    if let Ok(bytes) = fs.read_file(&resolved) {
                        for line in String::from_utf8_lossy(&bytes).lines() {
                            if !line.is_empty() {
                                patterns.push(line.to_string());
                            }
                        }
                    }
                }
                "--files-with-matches" => files_with_matches = true,
                "--files-without-match" => files_without_match = true,
                "--only-matching" => only_matching = true,
                "--word-regexp" => word_regexp = true,
                "--line-regexp" => line_regexp = true,
                "--fixed-strings" => fixed_strings = true,
                "--quiet" => quiet = true,
                "--no-filename" | "--no-heading" => no_filename = true,
                "--with-filename" => with_filename = true,
                "--replace" if i + 1 < args.len() => {
                    i += 1;
                    replace = Some(args[i].clone());
                }
                "--type" if i + 1 < args.len() => {
                    i += 1;
                    types_include.push(args[i].clone());
                }
                "--type-not" if i + 1 < args.len() => {
                    i += 1;
                    types_exclude.push(args[i].clone());
                }
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
                    } else if let Some(r) = a.strip_prefix("--replace=") {
                        replace = Some(r.to_string());
                    } else if let Some(t) = a.strip_prefix("--type=") {
                        types_include.push(t.to_string());
                    } else if let Some(t) = a.strip_prefix("--type-not=") {
                        types_exclude.push(t.to_string());
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
                    'b' => byte_offset = true,
                    '0' => null_delim = true,
                    '.' => show_hidden = true,
                    'u' => unrestricted_level += 1,
                    'l' => files_with_matches = true,
                    'o' => only_matching = true,
                    'w' => word_regexp = true,
                    'x' => line_regexp = true,
                    'F' => fixed_strings = true,
                    'q' => quiet = true,
                    'I' => no_filename = true,
                    'H' => with_filename = true,
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
                        if !rest.is_empty() {
                            types_include.push(rest);
                        } else if i + 1 < args.len() {
                            i += 1;
                            types_include.push(args[i].clone());
                        }
                        break;
                    }
                    'U' => multiline = true,
                    'T' => {
                        let rest: String = chars[ci + 1..].iter().collect();
                        if !rest.is_empty() {
                            types_exclude.push(rest);
                        } else if i + 1 < args.len() {
                            i += 1;
                            types_exclude.push(args[i].clone());
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
                                if !line.is_empty() {
                                    patterns.push(line.to_string());
                                }
                            }
                        }
                        break;
                    }
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

    if unrestricted_level >= 2 {
        show_hidden = true;
    }

    if list_files_only {
        let search_roots = if targets.is_empty() {
            vec![".".to_string()]
        } else {
            targets
        };
        let mut files = Vec::new();
        for r in &search_roots {
            collect_search_files(
                r,
                cwd,
                fs,
                true,
                &globs,
                &types_include,
                &types_exclude,
                show_hidden,
                unrestricted_level == 0,
                &Vec::new(),
                &mut files,
            );
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
            json_output,
            replace,
            multiline,
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
    json_output: bool,
    replace: Option<String>,
    multiline: bool,
}

fn file_matches_rg_type(base: &str, t: &str) -> bool {
    match t {
        "ts" => base.ends_with(".ts") || base.ends_with(".tsx"),
        "js" => {
            base.ends_with(".js")
                || base.ends_with(".jsx")
                || base.ends_with(".mjs")
                || base.ends_with(".cjs")
        }
        "py" => base.ends_with(".py"),
        "rs" => base.ends_with(".rs"),
        "md" => base.ends_with(".md"),
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

#[allow(clippy::too_many_arguments)]
fn collect_search_files(
    target: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
    recursive: bool,
    globs: &[String],
    types_include: &[String],
    types_exclude: &[String],
    show_hidden: bool,
    respect_ignore_files: bool,
    parent_ignore_rules: &[String],
    out: &mut Vec<(String, String)>,
) {
    let resolved = resolve_posix_path(cwd, target);
    if fs.is_dir(&resolved) {
        if !recursive {
            return;
        }
        let mut local_rules = parent_ignore_rules.to_vec();
        if respect_ignore_files {
            for ig_name in [".gitignore", ".ignore", ".rgignore"] {
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
                let child_is_dir = fs.is_dir(&child_resolved);
                if respect_ignore_files && is_ignored_by_rules(&e, child_is_dir, &local_rules) {
                    continue;
                }
                let disp = if target == "." {
                    e.clone()
                } else {
                    format!("{}/{}", target.trim_end_matches('/'), e)
                };
                collect_search_files(
                    &disp,
                    cwd,
                    fs,
                    true,
                    globs,
                    types_include,
                    types_exclude,
                    show_hidden,
                    respect_ignore_files,
                    &local_rules,
                    out,
                );
            }
        }
    } else if fs.exists(&resolved) {
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
            collect_search_files(
                t,
                cwd,
                fs,
                cfg.recursive,
                &cfg.globs,
                &cfg.types_include,
                &cfg.types_exclude,
                cfg.show_hidden,
                cfg.is_rg && cfg.unrestricted_level == 0,
                &Vec::new(),
                &mut file_list,
            );
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
    let mut total_matches = 0usize;
    let mut total_matched_lines = 0usize;
    let mut searches_with_match = 0usize;

    for (fname, content) in &inputs {
        let lines: Vec<&str> = content.lines().collect();
        let mut line_offsets: Vec<usize> = Vec::with_capacity(lines.len());
        let mut cur_off = 0usize;
        for l in &lines {
            line_offsets.push(cur_off);
            cur_off += l.len() + 1;
        }
        let mut match_indices = Vec::new();
        let mut matched_count = 0usize;
        let mut file_submatch_count = 0usize;

        if cfg.multiline && !cfg.invert {
            let full_spans = rx.find_all(content);
            for (s, e) in full_spans {
                let mut span_matched = false;
                for (idx, line) in lines.iter().enumerate() {
                    let l_start = line_offsets[idx];
                    let l_end = l_start + line.len();
                    if s < l_end && e > l_start {
                        any_match = true;
                        if cfg.quiet {
                            return ok_out("");
                        }
                        span_matched = true;
                        if !match_indices.iter().any(|(i, _)| *i == idx) {
                            let rel_s = s.saturating_sub(l_start).min(line.len());
                            let rel_e = e.saturating_sub(l_start).min(line.len());
                            match_indices.push((idx, vec![(rel_s, rel_e)]));
                        }
                    }
                }
                if span_matched {
                    matched_count += 1;
                    file_submatch_count += 1;
                }
            }
        } else {
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
            if cfg.is_rg && matched_count == 0 {
                continue;
            }
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
                let line_off = line_offsets.get(*idx).copied().unwrap_or(0);
                for &(s, e) in spans {
                    if show_filename {
                        if let Some(f) = fname {
                            out.push_str(&format!("{f}:"));
                        }
                    }
                    if cfg.line_number {
                        out.push_str(&format!("{}:", idx + 1));
                    }
                    if cfg.byte_offset {
                        out.push_str(&format!("{}:", line_off + s));
                    }
                    let matched_slice = &line[s..e];
                    if let Some(rep) = &cfg.replace {
                        let pat0 = rx.patterns.first().map(|p| p.as_str()).unwrap_or("");
                        let caps = regex_captures(&format!("^{pat0}$"), matched_slice, cfg.ignore_case)
                            .or_else(|| regex_captures(pat0, matched_slice, cfg.ignore_case))
                            .unwrap_or_else(|| vec![matched_slice.to_string()]);
                        out.push_str(&expand_rg_replacement(rep, matched_slice, &caps));
                    } else {
                        out.push_str(matched_slice);
                    }
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
            let match_map: std::collections::BTreeMap<usize, &Vec<(usize, usize)>> =
                match_indices.iter().map(|(i, m)| (*i, m)).collect();
            let mut prev_printed: Option<usize> = None;
            for (idx, should_print) in printed.iter().enumerate() {
                if !*should_print {
                    continue;
                }
                if let Some(prev) = prev_printed {
                    if idx > prev + 1 {
                        out.push_str("--\n");
                    }
                }
                prev_printed = Some(idx);
                let sep = if match_map.contains_key(&idx) { ':' } else { '-' };
                if show_filename {
                    if let Some(f) = fname {
                        out.push_str(&format!("{f}{sep}"));
                    }
                }
                if cfg.line_number {
                    out.push_str(&format!("{}{sep}", idx + 1));
                }
                if let (Some(rep), Some(spans)) = (&cfg.replace, match_map.get(&idx)) {
                    out.push_str(&apply_rg_line_replace(lines[idx], spans, rep, &rx, cfg.ignore_case));
                } else {
                    out.push_str(lines[idx]);
                }
                out.push('\n');
            }
        } else {
            for (idx, spans) in &match_indices {
                if show_filename {
                    if let Some(f) = fname {
                        out.push_str(&format!("{f}:"));
                    }
                }
                if cfg.line_number {
                    out.push_str(&format!("{}:", idx + 1));
                }
                if cfg.byte_offset {
                    let line_off = line_offsets.get(*idx).copied().unwrap_or(0);
                    out.push_str(&format!("{line_off}:"));
                }
                if let Some(rep) = &cfg.replace {
                    out.push_str(&apply_rg_line_replace(lines[*idx], spans, rep, &rx, cfg.ignore_case));
                } else {
                    out.push_str(lines[*idx]);
                }
                out.push('\n');
            }
        }
    }

    if cfg.json_output {
        let searches = inputs.len();
        out.push_str(&format!(
            "{{\"type\":\"summary\",\"data\":{{\"stats\":{{\"matches\":{total_matches},\"matched_lines\":{total_matched_lines},\"searches\":{searches},\"searches_with_match\":{searches_with_match}}}}}}}\n"
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

#[derive(Clone)]
enum FindPred {
    Name { pat: String, ignore_case: bool },
    Path { pat: String, ignore_case: bool },
    Type(char),
    Empty,
    Size { op: i8, bytes: usize },
    Perm { mode_kind: char, mask: u32 },
    Newer(u64),
    Prune,
    Print { null_delim: bool },
    Printf(String),
    Group(Box<FindPred>),
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
    pruned: &mut bool,
    printed: &mut Vec<(String, bool)>,
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
        FindPred::Perm { mode_kind, mask } => match fs.stat(full_path) {
            Ok(st) => {
                let file_mode = st.mode & 0o7777;
                match mode_kind {
                    '-' => (file_mode & *mask) == *mask,
                    '/' => (file_mode & *mask) != 0,
                    _ => file_mode == *mask,
                }
            }
            Err(_) => false,
        },
        FindPred::Newer(ref_mtime) => match fs.stat(full_path) {
            Ok(st) => st.mtime_ms > *ref_mtime,
            Err(_) => false,
        },
        FindPred::Prune => {
            *pruned = true;
            true
        }
        FindPred::Print { null_delim } => {
            printed.push((disp_path.to_string(), *null_delim));
            true
        }
        FindPred::Printf(fmt) => {
            let base = basename_posix_path(disp_path);
            let dir = crate::vfs::dirname_posix_path(disp_path);
            let sz = fs.stat(full_path).map(|st| st.size).unwrap_or(0);
            let rendered = fmt
                .replace("%f", &base)
                .replace("%p", disp_path)
                .replace("%h", &dir)
                .replace("%s", &sz.to_string())
                .replace("\\n", "\n")
                .replace("\\t", "\t");
            let trimmed = rendered.strip_suffix('\n').unwrap_or(&rendered);
            printed.push((trimmed.to_string(), false));
            true
        }
        FindPred::Group(inner) => {
            eval_find_pred(inner, disp_path, full_path, depth, fs, pruned, printed)
        }
        FindPred::Not(inner) => {
            !eval_find_pred(inner, disp_path, full_path, depth, fs, pruned, printed)
        }
        FindPred::And(a, b) => {
            eval_find_pred(a, disp_path, full_path, depth, fs, pruned, printed)
                && eval_find_pred(b, disp_path, full_path, depth, fs, pruned, printed)
        }
        FindPred::Or(a, b) => {
            eval_find_pred(a, disp_path, full_path, depth, fs, pruned, printed)
                || eval_find_pred(b, disp_path, full_path, depth, fs, pruned, printed)
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

fn parse_perm_arg(s: &str) -> (char, u32) {
    if let Some(rest) = s.strip_prefix('-') {
        ('-', u32::from_str_radix(rest, 8).unwrap_or(0))
    } else if let Some(rest) = s.strip_prefix('/') {
        ('/', u32::from_str_radix(rest, 8).unwrap_or(0))
    } else {
        ('=', u32::from_str_radix(s, 8).unwrap_or(0))
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
    let mut explicit_print = false;
    let mut depth_first = false;
    let mut delete_matched = false;
    let mut exec_template: Option<(Vec<String>, bool)> = None;
    let mut pred: Option<FindPred> = None;
    let mut pending_or = false;
    let mut pending_not = false;
    let mut group_stack: Vec<(Option<FindPred>, bool, bool)> = Vec::new();

    while idx < args.len() {
        let a = &args[idx];
        match a.as_str() {
            "(" => {
                group_stack.push((pred.take(), pending_not, pending_or));
                pending_not = false;
                pending_or = false;
                idx += 1;
            }
            ")" => {
                let inner = pred.take().map(|p| FindPred::Group(Box::new(p)));
                if let Some((mut outer_pred, mut outer_not, mut outer_or)) = group_stack.pop() {
                    if let Some(in_p) = inner {
                        combine_pred(&mut outer_pred, in_p, &mut outer_not, &mut outer_or);
                    }
                    pred = outer_pred;
                    pending_not = outer_not;
                    pending_or = outer_or;
                } else {
                    pred = inner;
                }
                idx += 1;
            }
            "-print" => {
                explicit_print = true;
                combine_pred(
                    &mut pred,
                    FindPred::Print { null_delim: false },
                    &mut pending_not,
                    &mut pending_or,
                );
                idx += 1;
            }
            "-printf" if idx + 1 < args.len() => {
                explicit_print = true;
                combine_pred(
                    &mut pred,
                    FindPred::Printf(args[idx + 1].clone()),
                    &mut pending_not,
                    &mut pending_or,
                );
                idx += 2;
            }
            "-print0" => {
                print0 = true;
                explicit_print = true;
                combine_pred(
                    &mut pred,
                    FindPred::Print { null_delim: true },
                    &mut pending_not,
                    &mut pending_or,
                );
                idx += 1;
            }
            "-prune" => {
                combine_pred(&mut pred, FindPred::Prune, &mut pending_not, &mut pending_or);
                idx += 1;
            }
            "-depth" => {
                depth_first = true;
                idx += 1;
            }
            "-delete" => {
                delete_matched = true;
                depth_first = true;
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
            "-perm" if idx + 1 < args.len() => {
                let (mode_kind, mask) = parse_perm_arg(&args[idx + 1]);
                combine_pred(
                    &mut pred,
                    FindPred::Perm { mode_kind, mask },
                    &mut pending_not,
                    &mut pending_or,
                );
                idx += 2;
            }
            "-newer" if idx + 1 < args.len() => {
                let ref_full = resolve_posix_path(cwd, &args[idx + 1]);
                let ref_mtime = fs.stat(&ref_full).map(|st| st.mtime_ms).unwrap_or(0);
                combine_pred(
                    &mut pred,
                    FindPred::Newer(ref_mtime),
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
    let mut explicit_prints: Vec<(String, bool)> = Vec::new();
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
            depth_first,
            &pred,
            fs,
            &mut matched_paths,
            &mut explicit_prints,
        );
    }

    if delete_matched {
        for (_, full) in &matched_paths {
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

    if explicit_print {
        let mut out = String::new();
        for (disp, is_null) in explicit_prints {
            out.push_str(&disp);
            out.push(if is_null { '\0' } else { '\n' });
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
                match prev {
                    FindPred::Or(left, right) => Some(FindPred::Or(
                        left,
                        Box::new(FindPred::And(right, Box::new(next))),
                    )),
                    other => Some(FindPred::And(Box::new(other), Box::new(next))),
                }
            }
        }
    };
}

#[allow(clippy::too_many_arguments)]
fn walk_find(
    disp: &str,
    full: &str,
    depth: usize,
    min_depth: usize,
    max_depth: Option<usize>,
    depth_first: bool,
    pred: &Option<FindPred>,
    fs: &dyn SafeBashFs,
    out: &mut Vec<(String, String)>,
    explicit_prints: &mut Vec<(String, bool)>,
) {
    if let Some(max_d) = max_depth {
        if depth > max_d {
            return;
        }
    }
    let mut pruned = false;
    if !depth_first && depth >= min_depth {
        let ok = match pred {
            Some(p) => eval_find_pred(p, disp, full, depth, fs, &mut pruned, explicit_prints),
            None => true,
        };
        if ok {
            out.push((disp.to_string(), full.to_string()));
        }
    }
    let can_descend = !pruned && max_depth.map(|max_d| depth < max_d).unwrap_or(true);
    if can_descend {
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
                            depth_first,
                            pred,
                            fs,
                            out,
                            explicit_prints,
                        );
                    }
                }
            }
        }
    }
    if depth_first && depth >= min_depth {
        let ok = match pred {
            Some(p) => eval_find_pred(p, disp, full, depth, fs, &mut pruned, explicit_prints),
            None => true,
        };
        if ok {
            out.push((disp.to_string(), full.to_string()));
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

fn has_fd_placeholder(s: &str) -> bool {
    let cleaned = s.replace("{{", "").replace("}}", "");
    cleaned.contains("{}")
        || cleaned.contains("{/}")
        || cleaned.contains("{//}")
        || cleaned.contains("{.}")
        || cleaned.contains("{/.}")
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

struct FdConfig {
    extensions: Vec<String>,
    types: Vec<char>,
    min_depth: usize,
    max_depth: Option<usize>,
    max_results: Option<usize>,
    excludes: Vec<String>,
    sizes: Vec<(char, usize)>,
    show_hidden: bool,
    respect_ignore: bool,
    follow: bool,
    full_path: bool,
    absolute_path: bool,
    glob_mode: bool,
    fixed_mode: bool,
    ignore_case: bool,
    prune: bool,
    pattern: Option<String>,
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
    let mut show_hidden = false;
    let mut respect_ignore = true;
    let mut unrestricted = 0usize;
    let mut follow = false;
    let mut full_path = false;
    let mut absolute_path = false;
    let mut print0 = false;
    let mut quiet = false;
    let mut glob_mode = false;
    let mut fixed_mode = false;
    let mut case_override: Option<bool> = None;
    let mut prune = false;
    let mut format_tpl: Option<String> = None;
    let mut base_dir: Option<String> = None;
    let mut exec_cmd: Vec<String> = Vec::new();
    let mut exec_batch = false;
    let mut operands: Vec<String> = Vec::new();
    let mut search_paths: Vec<String> = Vec::new();

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
            exec_batch = a == "-X" || a == "--exec-batch";
            i += 1;
            while i < args.len() && args[i] != ";" {
                exec_cmd.push(args[i].clone());
                i += 1;
            }
            i += 1;
            continue;
        }
        if !end_of_opts && a.starts_with("--") {
            match a.as_str() {
                "--hidden" => show_hidden = true,
                "--no-ignore" | "--no-ignore-vcs" | "--no-ignore-parent" => respect_ignore = false,
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
                "--extension" if i + 1 < args.len() => {
                    i += 1;
                    extensions.push(args[i].trim_start_matches('.').to_ascii_lowercase());
                }
                "--type" if i + 1 < args.len() => {
                    i += 1;
                    if let Some(c) = args[i].chars().next() {
                        types.push(c);
                    }
                }
                "--max-depth" if i + 1 < args.len() => {
                    i += 1;
                    max_depth = args[i].parse().ok();
                }
                "--min-depth" if i + 1 < args.len() => {
                    i += 1;
                    min_depth = args[i].parse().unwrap_or(1);
                }
                "--exact-depth" if i + 1 < args.len() => {
                    i += 1;
                    if let Ok(d) = args[i].parse::<usize>() {
                        min_depth = d;
                        max_depth = Some(d);
                    }
                }
                "--max-results" if i + 1 < args.len() => {
                    i += 1;
                    max_results = args[i].parse().ok();
                }
                "--exclude" if i + 1 < args.len() => {
                    i += 1;
                    excludes.push(args[i].clone());
                }
                "--size" if i + 1 < args.len() => {
                    i += 1;
                    if let Some(sz) = parse_fd_size_spec(&args[i]) {
                        sizes.push(sz);
                    }
                }
                "--format" if i + 1 < args.len() => {
                    i += 1;
                    format_tpl = Some(args[i].clone());
                }
                "--search-path" if i + 1 < args.len() => {
                    i += 1;
                    search_paths.push(args[i].clone());
                }
                "--base-directory" if i + 1 < args.len() => {
                    i += 1;
                    base_dir = Some(args[i].clone());
                }
                _ => {
                    if let Some(v) = a.strip_prefix("--extension=") {
                        extensions.push(v.trim_start_matches('.').to_ascii_lowercase());
                    } else if let Some(v) = a.strip_prefix("--type=") {
                        if let Some(c) = v.chars().next() {
                            types.push(c);
                        }
                    } else if let Some(v) = a.strip_prefix("--max-depth=") {
                        max_depth = v.parse().ok();
                    } else if let Some(v) = a.strip_prefix("--min-depth=") {
                        min_depth = v.parse().unwrap_or(1);
                    } else if let Some(v) = a.strip_prefix("--exact-depth=") {
                        if let Ok(d) = v.parse::<usize>() {
                            min_depth = d;
                            max_depth = Some(d);
                        }
                    } else if let Some(v) = a.strip_prefix("--max-results=") {
                        max_results = v.parse().ok();
                    } else if let Some(v) = a.strip_prefix("--exclude=") {
                        excludes.push(v.to_string());
                    } else if let Some(v) = a.strip_prefix("--size=") {
                        if let Some(sz) = parse_fd_size_spec(v) {
                            sizes.push(sz);
                        }
                    } else if let Some(v) = a.strip_prefix("--format=") {
                        format_tpl = Some(v.to_string());
                    } else if let Some(v) = a.strip_prefix("--search-path=") {
                        search_paths.push(v.to_string());
                    } else if let Some(v) = a.strip_prefix("--base-directory=") {
                        base_dir = Some(v.to_string());
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
                    '1' => max_results = Some(1),
                    'e' | 't' | 'd' | 'E' | 'S' | 'C' => {
                        let flag = chars[ci];
                        let val = if ci + 1 < chars.len() {
                            chars[ci + 1..].iter().collect::<String>()
                        } else if i + 1 < args.len() {
                            i += 1;
                            args[i].clone()
                        } else {
                            String::new()
                        };
                        match flag {
                            'e' => extensions.push(val.trim_start_matches('.').to_ascii_lowercase()),
                            't' => {
                                if let Some(c) = val.chars().next() {
                                    types.push(c);
                                }
                            }
                            'd' => max_depth = val.parse().ok(),
                            'E' => excludes.push(val),
                            'S' => {
                                if let Some(sz) = parse_fd_size_spec(&val) {
                                    sizes.push(sz);
                                }
                            }
                            'C' => base_dir = Some(val),
                            _ => {}
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
        operands.push(a.clone());
        i += 1;
    }

    let pattern = if !operands.is_empty() {
        let p = operands.remove(0);
        if p.is_empty() || p == "." {
            None
        } else {
            Some(p)
        }
    } else {
        None
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
        None => !pattern
            .as_ref()
            .map(|p| p.chars().any(|c| c.is_ascii_uppercase()))
            .unwrap_or(false),
    };

    let effective_cwd = match &base_dir {
        Some(b) => resolve_posix_path(cwd, b),
        None => cwd.clone(),
    };

    let cfg = FdConfig {
        extensions,
        types,
        min_depth,
        max_depth,
        max_results,
        excludes,
        sizes,
        show_hidden,
        respect_ignore,
        follow,
        full_path,
        absolute_path,
        glob_mode,
        fixed_mode,
        ignore_case,
        prune,
        pattern,
    };

    let mut results: Vec<(String, bool)> = Vec::new();
    for r in &roots {
        let full = resolve_posix_path(&effective_cwd, r);
        let mut init_rules = Vec::new();
        if cfg.respect_ignore {
            for ign_name in [".gitignore", ".ignore", ".fdignore"] {
                let ign_path = normalize_posix_path(&format!("{full}/{ign_name}"));
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
        walk_fd(
            r,
            "",
            &full,
            0,
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
            stderr: String::new(),
            exit_code: if results.is_empty() { 1 } else { 0 },
        };
    }

    if !exec_cmd.is_empty() {
        if results.is_empty() {
            return ok_out("");
        }
        if exec_batch {
            let mut cmd_words: Vec<String> = Vec::new();
            let any_ph = exec_cmd.iter().any(|w| has_fd_placeholder(w));
            if any_ph {
                for w in &exec_cmd {
                    if has_fd_placeholder(w) {
                        for (item, _) in &results {
                            let clean = item.strip_prefix("./").unwrap_or(item);
                            cmd_words.push(format_fd_template(w, clean));
                        }
                    } else {
                        cmd_words.push(w.clone());
                    }
                }
            } else {
                cmd_words.extend(exec_cmd.clone());
                for (item, _) in &results {
                    let clean = item.strip_prefix("./").unwrap_or(item);
                    cmd_words.push(clean.to_string());
                }
            }
            return exec_sub(&cmd_words, "", cwd, env);
        } else {
            let mut out = String::new();
            let mut err = String::new();
            let mut code = 0;
            let any_ph = exec_cmd.iter().any(|w| has_fd_placeholder(w));
            for (item, _) in &results {
                let clean = item.strip_prefix("./").unwrap_or(item);
                let mut cmd_words: Vec<String> = Vec::new();
                if any_ph {
                    for w in &exec_cmd {
                        cmd_words.push(format_fd_template(w, clean));
                    }
                } else {
                    cmd_words.extend(exec_cmd.clone());
                    cmd_words.push(clean.to_string());
                }
                let res = exec_sub(&cmd_words, "", cwd, env);
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
    let mut out = String::new();
    for (item, is_dir) in results {
        let clean = item.strip_prefix("./").unwrap_or(&item);
        if let Some(fmt) = &format_tpl {
            out.push_str(&format_fd_template(fmt, clean));
        } else if is_dir && !clean.ends_with('/') {
            out.push_str(clean);
            out.push('/');
        } else {
            out.push_str(clean);
        }
        out.push(sep);
    }
    ok_out(&out)
}

#[allow(clippy::too_many_arguments)]
fn walk_fd(
    disp: &str,
    rel: &str,
    full: &str,
    depth: usize,
    cfg: &FdConfig,
    ignore_rules: &[String],
    fs: &dyn SafeBashFs,
    out: &mut Vec<(String, bool)>,
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

            if matches && !cfg.extensions.is_empty() {
                let lower = base.to_ascii_lowercase();
                matches = cfg
                    .extensions
                    .iter()
                    .any(|ext| lower.len() > ext.len() + 1 && lower.ends_with(&format!(".{ext}")));
            }

            if matches {
                if let Some(pat) = &cfg.pattern {
                    let subj = if cfg.full_path {
                        if cfg.absolute_path {
                            full
                        } else {
                            disp
                        }
                    } else {
                        &base
                    };
                    if cfg.glob_mode {
                        if cfg.ignore_case {
                            matches = glob_match(&pat.to_ascii_lowercase(), &subj.to_ascii_lowercase());
                        } else {
                            matches = glob_match(pat, subj);
                        }
                    } else {
                        let rx = ZeroRegex::new(
                            vec![pat.clone()],
                            cfg.ignore_case,
                            cfg.fixed_mode,
                            false,
                            false,
                        );
                        matches = rx.is_match(subj);
                    }
                }
            }

            if matches {
                let out_path = if cfg.absolute_path {
                    full.to_string()
                } else {
                    disp.to_string()
                };
                out.push((out_path, is_dir));
                matched_here = true;
            }
        }
    }

    if is_dir && !(cfg.prune && matched_here) {
        if let Some(max_d) = cfg.max_depth {
            if depth >= max_d {
                return;
            }
        }
        let mut local_rules: Vec<String> = ignore_rules.to_vec();
        if depth > 0 && cfg.respect_ignore {
            for ign_name in [".gitignore", ".ignore", ".fdignore"] {
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
                let child_disp = if disp == "." {
                    e.clone()
                } else {
                    format!("{}/{e}", disp.trim_end_matches('/'))
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
                    cfg,
                    &local_rules,
                    fs,
                    out,
                );
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
                "-n" | "-L" if i + 1 < args.len() => {
                    i += 1;
                    max_args = args[i].parse().ok();
                }
                "-P" | "-s" if i + 1 < args.len() => {
                    i += 1;
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
