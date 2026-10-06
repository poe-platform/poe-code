use crate::commands::search::{ZeroRegex, replace_regex_in_text};
use crate::shell::builtins::BuiltinOutcome;
use crate::vfs::{SafeBashFs, resolve_posix_path};
use std::collections::BTreeMap;

pub fn try_run_text_command(
    cmd: &str,
    args: &[String],
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> Option<BuiltinOutcome> {
    match cmd {
        "sed" => Some(cmd_sed(args, stdin, cwd, fs)),
        "awk" | "gawk" | "mawk" => Some(cmd_awk(args, stdin, cwd, fs)),
        "diff" => Some(cmd_diff(args, stdin, cwd, fs)),
        "diff3" => Some(cmd_diff3(args, cwd, fs)),
        "patch" => Some(cmd_patch(args, stdin, cwd, fs)),
        "apply_patch" | "apply-patch" => Some(cmd_apply_patch(args, stdin, cwd, fs)),
        "cmp" => Some(cmd_cmp(args, stdin, cwd, fs)),
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

fn err_out(stderr: &str, exit_code: i32) -> BuiltinOutcome {
    BuiltinOutcome {
        stdout: String::new(),
        stderr: stderr.to_string(),
        exit_code,
    }
}

#[derive(Clone, Debug)]
enum SedAddr {
    Line(usize),
    Last,
    Regex(String),
}

#[derive(Clone, Debug)]
enum SedOp {
    Substitute {
        pat: String,
        repl: String,
        global: bool,
        ignore_case: bool,
        print_flag: bool,
        nth: Option<usize>,
    },
    Delete,
    Print,
    Quit,
    Append(String),
    Insert(String),
    Change(String),
    Transliterate(Vec<char>, Vec<char>),
    LineNumber,
    HoldCopy,
    HoldAppend,
    GetCopy,
    GetAppend,
    Exchange,
    NextAppend,
    Label(String),
    Branch(Option<String>),
    Group(Vec<SedCmd>),
}

#[derive(Clone, Debug)]
struct SedCmd {
    addr1: Option<SedAddr>,
    addr2: Option<SedAddr>,
    negated: bool,
    op: SedOp,
    in_range: bool,
}

fn cmd_sed(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut quiet = false;
    let mut in_place = false;
    let mut scripts: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();

    let mut i = 0usize;
    let mut end_opts = false;
    while i < args.len() {
        let a = &args[i];
        if !end_opts && a == "--" {
            end_opts = true;
            i += 1;
            continue;
        }
        if !end_opts && a.starts_with('-') && a.len() > 1 {
            if a == "-n" || a == "--quiet" || a == "--silent" {
                quiet = true;
            } else if a == "-E" || a == "-r" || a == "--regexp-extended" {
            } else if a == "-i" || a.starts_with("-i") {
                in_place = true;
            } else if a == "-e" {
                if i + 1 < args.len() {
                    i += 1;
                    scripts.push(args[i].clone());
                }
            } else if let Some(rest) = a.strip_prefix("-e") {
                scripts.push(rest.to_string());
            } else if a == "-f" {
                if i + 1 < args.len() {
                    i += 1;
                    let p = resolve_posix_path(cwd, &args[i]);
                    if let Ok(b) = fs.read_file(&p) {
                        scripts.push(String::from_utf8_lossy(&b).into_owned());
                    }
                }
            } else {
                for ch in a[1..].chars() {
                    match ch {
                        'n' => quiet = true,
                        'i' => in_place = true,
                        'E' | 'r' => {}
                        _ => {}
                    }
                }
            }
            i += 1;
            continue;
        }
        if scripts.is_empty() {
            scripts.push(a.clone());
        } else {
            files.push(a.clone());
        }
        i += 1;
    }

    let mut parsed_cmds = Vec::new();
    for s in &scripts {
        for part in split_sed_statements(s) {
            if let Some(c) = parse_sed_cmd(&part) {
                parsed_cmds.push(c);
            }
        }
    }

    if in_place && !files.is_empty() {
        for f in &files {
            let full = resolve_posix_path(cwd, f);
            if let Ok(bytes) = fs.read_file(&full) {
                let content = String::from_utf8_lossy(&bytes);
                let mut cmds_copy = parsed_cmds.clone();
                let res = run_sed_on_text(&content, &mut cmds_copy, quiet);
                let _ = fs.write_file(&full, res.as_bytes());
            } else {
                return err_out(&format!("sed: {f}: No such file or directory\n"), 1);
            }
        }
        return ok_out("");
    }

    let mut combined_in = String::new();
    if files.is_empty() {
        combined_in.push_str(stdin);
    } else {
        for f in &files {
            if f == "-" {
                combined_in.push_str(stdin);
                continue;
            }
            let full = resolve_posix_path(cwd, f);
            match fs.read_file(&full) {
                Ok(b) => combined_in.push_str(&String::from_utf8_lossy(&b)),
                Err(_) => return err_out(&format!("sed: {f}: No such file or directory\n"), 1),
            }
        }
    }

    let out = run_sed_on_text(&combined_in, &mut parsed_cmds, quiet);
    ok_out(&out)
}

fn split_sed_statements(script: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in script.lines() {
        let mut cur = String::new();
        let chars: Vec<char> = line.chars().collect();
        let mut idx = 0usize;
        let mut in_slash: Option<char> = None;
        let mut slash_count = 0usize;
        let mut brace_depth = 0i32;

        while idx < chars.len() {
            let c = chars[idx];
            if c == '\\' && idx + 1 < chars.len() {
                cur.push(c);
                cur.push(chars[idx + 1]);
                idx += 2;
                continue;
            }
            if let Some(delim) = in_slash {
                cur.push(c);
                if c == delim {
                    slash_count += 1;
                    if slash_count >= 2 {
                        in_slash = None;
                    }
                }
                idx += 1;
                continue;
            }
            if (c == 's' || c == 'y')
                && idx + 1 < chars.len()
                && !chars[idx + 1].is_ascii_alphanumeric()
                && !chars[idx + 1].is_whitespace()
            {
                let delim = chars[idx + 1];
                in_slash = Some(delim);
                slash_count = 0;
                cur.push(c);
                cur.push(delim);
                idx += 2;
                continue;
            }
            if c == '{' {
                brace_depth += 1;
            } else if c == '}' {
                brace_depth = (brace_depth - 1).max(0);
            }
            if c == ';' && brace_depth == 0 {
                let t = cur.trim().to_string();
                if !t.is_empty() {
                    out.push(t);
                }
                cur.clear();
                idx += 1;
                continue;
            }
            cur.push(c);
            idx += 1;
        }
        let t = cur.trim().to_string();
        if !t.is_empty() {
            out.push(t);
        }
    }
    out
}

fn parse_sed_cmd(stmt: &str) -> Option<SedCmd> {
    let s = stmt.trim();
    if s.is_empty() || s.starts_with('#') {
        return None;
    }
    if let Some(lbl) = s.strip_prefix(':') {
        return Some(SedCmd {
            addr1: None,
            addr2: None,
            negated: false,
            op: SedOp::Label(lbl.trim().to_string()),
            in_range: false,
        });
    }
    let (addr1, addr2, negated, rest) = parse_sed_addresses(s);
    let rest = rest.trim();
    if rest.is_empty() {
        return None;
    }
    let first = rest.chars().next()?;
    let op = match first {
        'd' => SedOp::Delete,
        'p' => SedOp::Print,
        'q' => SedOp::Quit,
        '=' => SedOp::LineNumber,
        'h' => SedOp::HoldCopy,
        'H' => SedOp::HoldAppend,
        'g' => SedOp::GetCopy,
        'G' => SedOp::GetAppend,
        'x' => SedOp::Exchange,
        'N' => SedOp::NextAppend,
        ':' => SedOp::Label(rest[1..].trim().to_string()),
        'b' => {
            let target = rest[1..].trim();
            SedOp::Branch(if target.is_empty() {
                None
            } else {
                Some(target.to_string())
            })
        }
        '{' => {
            let inner = rest
                .strip_prefix('{')
                .and_then(|r| r.strip_suffix('}'))
                .unwrap_or(&rest[1..]);
            let mut sub_cmds = Vec::new();
            for part in split_sed_statements(inner) {
                if let Some(c) = parse_sed_cmd(&part) {
                    sub_cmds.push(c);
                }
            }
            SedOp::Group(sub_cmds)
        }
        'a' => {
            let text = rest[1..].trim_start_matches('\\').trim_start();
            SedOp::Append(unescape_sed_text(text))
        }
        'i' => {
            let text = rest[1..].trim_start_matches('\\').trim_start();
            SedOp::Insert(unescape_sed_text(text))
        }
        'c' => {
            let text = rest[1..].trim_start_matches('\\').trim_start();
            SedOp::Change(unescape_sed_text(text))
        }
        'y' => {
            let chars: Vec<char> = rest.chars().collect();
            if chars.len() < 4 {
                return None;
            }
            let delim = chars[1];
            let parts = split_sed_delim(&rest[2..], delim)?;
            if parts.len() < 2 {
                return None;
            }
            SedOp::Transliterate(parts[0].chars().collect(), parts[1].chars().collect())
        }
        's' => {
            let chars: Vec<char> = rest.chars().collect();
            if chars.len() < 4 {
                return None;
            }
            let delim = chars[1];
            let parts = split_sed_delim(&rest[2..], delim)?;
            if parts.len() < 2 {
                return None;
            }
            let pat = parts[0].clone();
            let repl = unescape_sed_repl(&parts[1]);
            let flags = parts.get(2).cloned().unwrap_or_default();
            let mut global = false;
            let mut ignore_case = false;
            let mut print_flag = false;
            let mut nth = None;
            for ch in flags.chars() {
                match ch {
                    'g' => global = true,
                    'i' | 'I' => ignore_case = true,
                    'p' => print_flag = true,
                    '1'..='9' => nth = Some((ch as u8 - b'0') as usize),
                    _ => {}
                }
            }
            SedOp::Substitute {
                pat,
                repl,
                global,
                ignore_case,
                print_flag,
                nth,
            }
        }
        _ => return None,
    };

    Some(SedCmd {
        addr1,
        addr2,
        negated,
        op,
        in_range: false,
    })
}

fn unescape_sed_text(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some(other) => out.push(other),
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn unescape_sed_repl(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some(d @ ('1'..='9' | '&' | '\\')) => {
                    out.push('\\');
                    out.push(d);
                }
                Some(other) => out.push(other),
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn split_sed_delim(s: &str, delim: char) -> Option<Vec<String>> {
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(&nc) = chars.peek() {
                if nc == delim {
                    cur.push(delim);
                    chars.next();
                    continue;
                }
            }
            cur.push(c);
            if let Some(nc) = chars.next() {
                cur.push(nc);
            }
            continue;
        }
        if c == delim {
            parts.push(std::mem::take(&mut cur));
            if parts.len() == 2 {
                let tail: String = chars.collect();
                parts.push(tail);
                return Some(parts);
            }
            continue;
        }
        cur.push(c);
    }
    parts.push(cur);
    Some(parts)
}

fn parse_sed_addresses(s: &str) -> (Option<SedAddr>, Option<SedAddr>, bool, &str) {
    let (a1, rest1) = parse_one_sed_addr(s.trim_start());
    let mut rest = rest1.trim_start();
    let mut a2 = None;
    if a1.is_some() && rest.starts_with(',') {
        let (parsed_a2, rest2) = parse_one_sed_addr(rest[1..].trim_start());
        a2 = parsed_a2;
        rest = rest2.trim_start();
    }
    let negated = if rest.starts_with('!') {
        rest = rest[1..].trim_start();
        true
    } else {
        false
    };
    (a1, a2, negated, rest)
}

fn parse_one_sed_addr(s: &str) -> (Option<SedAddr>, &str) {
    if let Some(rest) = s.strip_prefix('$') {
        return (Some(SedAddr::Last), rest);
    }
    if let Some(rest) = s.strip_prefix('/') {
        let mut pat = String::new();
        let mut idx = 0usize;
        let chars: Vec<char> = rest.chars().collect();
        while idx < chars.len() {
            if chars[idx] == '\\' && idx + 1 < chars.len() {
                pat.push(chars[idx]);
                pat.push(chars[idx + 1]);
                idx += 2;
                continue;
            }
            if chars[idx] == '/' {
                let byte_offset: usize = chars[..=idx].iter().map(|c| c.len_utf8()).sum();
                return (Some(SedAddr::Regex(pat)), &rest[byte_offset..]);
            }
            pat.push(chars[idx]);
            idx += 1;
        }
    }
    let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
    if !digits.is_empty() {
        if let Ok(n) = digits.parse::<usize>() {
            return (Some(SedAddr::Line(n)), &s[digits.len()..]);
        }
    }
    (None, s)
}

fn addr_matches(addr: &SedAddr, line_num: usize, is_last: bool, line: &str) -> bool {
    match addr {
        SedAddr::Line(n) => line_num == *n,
        SedAddr::Last => is_last,
        SedAddr::Regex(pat) => {
            ZeroRegex::new(vec![pat.clone()], false, false, false, false).is_match(line)
        }
    }
}

enum SedFlow {
    Continue,
    Delete,
    Quit,
    Branch(Option<String>),
}

#[allow(clippy::too_many_arguments)]
fn exec_sed_cmds(
    cmds: &mut [SedCmd],
    raw_lines: &[&str],
    line_idx: &mut usize,
    pattern_space: &mut String,
    hold_space: &mut String,
    out: &mut String,
    appends: &mut Vec<String>,
    quiet: bool,
) -> SedFlow {
    let total = raw_lines.len();
    let mut pc = 0usize;
    let mut branch_guard = 0usize;

    while pc < cmds.len() {
        let line_num = *line_idx + 1;
        let is_last = line_num == total;
        let cmd = &mut cmds[pc];
        if let SedOp::Label(_) = &cmd.op {
            pc += 1;
            continue;
        }
        let matched = match (&cmd.addr1, &cmd.addr2) {
            (None, _) => true,
            (Some(a1), None) => addr_matches(a1, line_num, is_last, pattern_space),
            (Some(a1), Some(a2)) => {
                if !cmd.in_range {
                    if addr_matches(a1, line_num, is_last, pattern_space) {
                        let end_same = match a2 {
                            SedAddr::Line(n) => *n <= line_num,
                            _ => false,
                        };
                        if !end_same {
                            cmd.in_range = true;
                        }
                        true
                    } else {
                        false
                    }
                } else {
                    if addr_matches(a2, line_num, is_last, pattern_space) {
                        cmd.in_range = false;
                    }
                    true
                }
            }
        };
        let active = if cmd.negated { !matched } else { matched };
        if !active {
            pc += 1;
            continue;
        }

        let mut branch_target: Option<Option<String>> = None;
        match &mut cmd.op {
            SedOp::Label(_) => {}
            SedOp::Delete => return SedFlow::Delete,
            SedOp::Print => {
                out.push_str(pattern_space);
                out.push('\n');
            }
            SedOp::Quit => return SedFlow::Quit,
            SedOp::LineNumber => {
                out.push_str(&format!("{line_num}\n"));
            }
            SedOp::HoldCopy => {
                *hold_space = pattern_space.clone();
            }
            SedOp::HoldAppend => {
                hold_space.push('\n');
                hold_space.push_str(pattern_space);
            }
            SedOp::GetCopy => {
                *pattern_space = hold_space.clone();
            }
            SedOp::GetAppend => {
                pattern_space.push('\n');
                pattern_space.push_str(hold_space);
            }
            SedOp::Exchange => {
                std::mem::swap(pattern_space, hold_space);
            }
            SedOp::NextAppend => {
                if *line_idx + 1 < total {
                    *line_idx += 1;
                    pattern_space.push('\n');
                    pattern_space.push_str(raw_lines[*line_idx]);
                }
            }
            SedOp::Branch(lbl) => {
                branch_target = Some(lbl.clone());
            }
            SedOp::Group(inner) => {
                match exec_sed_cmds(
                    inner,
                    raw_lines,
                    line_idx,
                    pattern_space,
                    hold_space,
                    out,
                    appends,
                    quiet,
                ) {
                    SedFlow::Continue => {}
                    SedFlow::Branch(lbl) => {
                        branch_target = Some(lbl);
                    }
                    other => return other,
                }
            }
            SedOp::Insert(text) => {
                out.push_str(text);
                out.push('\n');
            }
            SedOp::Append(text) => {
                appends.push(text.clone());
            }
            SedOp::Change(text) => {
                *pattern_space = text.clone();
                if !quiet {
                    out.push_str(pattern_space);
                    out.push('\n');
                }
                return SedFlow::Delete;
            }
            SedOp::Transliterate(src, dst) => {
                *pattern_space = pattern_space
                    .chars()
                    .map(|c| {
                        src.iter()
                            .position(|&sc| sc == c)
                            .and_then(|p| dst.get(p).copied())
                            .unwrap_or(c)
                    })
                    .collect();
            }
            SedOp::Substitute {
                pat,
                repl,
                global,
                ignore_case,
                print_flag,
                nth,
            } => {
                let (new_text, did_replace) = replace_regex_in_text(
                    pattern_space,
                    pat,
                    repl,
                    *ignore_case,
                    *global,
                    *nth,
                );
                *pattern_space = new_text;
                if did_replace && *print_flag {
                    out.push_str(pattern_space);
                    out.push('\n');
                }
            }
        }

        if let Some(target_opt) = branch_target {
            branch_guard += 1;
            if branch_guard > 1000 {
                return SedFlow::Continue;
            }
            if let Some(lbl) = target_opt {
                if let Some(pos) = cmds
                    .iter()
                    .position(|c| matches!(&c.op, SedOp::Label(l) if *l == lbl))
                {
                    pc = pos;
                    continue;
                }
                return SedFlow::Branch(Some(lbl));
            } else {
                return SedFlow::Branch(None);
            }
        }

        pc += 1;
    }
    SedFlow::Continue
}

fn run_sed_on_text(input: &str, cmds: &mut [SedCmd], quiet: bool) -> String {
    if input.is_empty() {
        return String::new();
    }
    let had_trailing_newline = input.ends_with('\n');
    let raw_lines: Vec<&str> = input.lines().collect();
    let total = raw_lines.len();
    let mut out = String::new();
    let mut hold_space = String::new();
    let mut line_idx = 0usize;

    while line_idx < total {
        let mut pattern_space = raw_lines[line_idx].to_string();
        let mut deleted = false;
        let mut quit_now = false;
        let mut appends: Vec<String> = Vec::new();

        match exec_sed_cmds(
            cmds,
            &raw_lines,
            &mut line_idx,
            &mut pattern_space,
            &mut hold_space,
            &mut out,
            &mut appends,
            quiet,
        ) {
            SedFlow::Delete => deleted = true,
            SedFlow::Quit => quit_now = true,
            SedFlow::Continue | SedFlow::Branch(_) => {}
        }

        let is_last = line_idx + 1 == total;
        if !deleted && !quiet {
            out.push_str(&pattern_space);
            if !is_last || had_trailing_newline {
                out.push('\n');
            }
        }
        for ap in appends {
            out.push_str(&ap);
            out.push('\n');
        }
        if quit_now {
            break;
        }
        line_idx += 1;
    }

    out
}

#[derive(Clone, Debug)]
enum AwkCond {
    Begin,
    End,
    Always,
    Expr(String),
    Range(String, String),
}

#[derive(Clone, Debug)]
struct AwkRule {
    cond: AwkCond,
    body: String,
    in_range: bool,
}

type AwkFuncMap = BTreeMap<String, (Vec<String>, String)>;

struct AwkState {
    vars: BTreeMap<String, String>,
    arrays: BTreeMap<String, BTreeMap<String, String>>,
    funcs: AwkFuncMap,
    fields: Vec<String>,
    line: String,
    nr: usize,
    fnr: usize,
    fs: String,
    ofs: String,
    ors: String,
    output: String,
    next_requested: bool,
    return_val: Option<String>,
    exit_code: Option<i32>,
}

impl AwkState {
    fn new(
        fs: String,
        vars: BTreeMap<String, String>,
        funcs: AwkFuncMap,
    ) -> Self {
        let ofs = vars.get("OFS").cloned().unwrap_or_else(|| " ".to_string());
        let ors = vars.get("ORS").cloned().unwrap_or_else(|| "\n".to_string());
        Self {
            vars,
            arrays: BTreeMap::new(),
            funcs,
            fields: Vec::new(),
            line: String::new(),
            nr: 0,
            fnr: 0,
            fs,
            ofs,
            ors,
            output: String::new(),
            next_requested: false,
            return_val: None,
            exit_code: None,
        }
    }

    fn set_line(&mut self, line: &str) {
        self.line = line.to_string();
        self.fields = if self.fs == " " {
            line.split_whitespace().map(|s| s.to_string()).collect()
        } else if self.fs.len() == 1 {
            line.split(&self.fs).map(|s| s.to_string()).collect()
        } else {
            let rx = ZeroRegex::new(vec![self.fs.clone()], false, false, false, false);
            let spans = rx.find_all(line);
            if spans.is_empty() {
                vec![line.to_string()]
            } else {
                let mut parts = Vec::new();
                let mut last = 0usize;
                for (s, e) in spans {
                    if s >= last {
                        parts.push(line[last..s].to_string());
                        last = e;
                    }
                }
                parts.push(line[last..].to_string());
                parts
            }
        };
    }

    fn rebuild_line_from_fields(&mut self) {
        self.line = self.fields.join(&self.ofs);
    }

    fn get_var(&self, name: &str) -> String {
        match name {
            "NF" => self.fields.len().to_string(),
            "NR" => self.nr.to_string(),
            "FNR" => self.fnr.to_string(),
            "FS" => self.fs.clone(),
            "OFS" => self.ofs.clone(),
            "ORS" => self.ors.clone(),
            _ => self.vars.get(name).cloned().unwrap_or_default(),
        }
    }

    fn set_var(&mut self, name: &str, val: String) {
        match name {
            "FS" => self.fs = val,
            "OFS" => self.ofs = val,
            "ORS" => self.ors = val,
            _ => {
                self.vars.insert(name.to_string(), val);
            }
        }
    }

    fn get_field(&self, idx: usize) -> String {
        if idx == 0 {
            self.line.clone()
        } else {
            self.fields.get(idx - 1).cloned().unwrap_or_default()
        }
    }

    fn set_field(&mut self, idx: usize, val: String) {
        if idx == 0 {
            self.set_line(&val);
        } else {
            while self.fields.len() < idx {
                self.fields.push(String::new());
            }
            self.fields[idx - 1] = val;
            self.rebuild_line_from_fields();
        }
    }
}

fn cmd_awk(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut field_sep = " ".to_string();
    let mut vars = BTreeMap::new();
    let mut program: Option<String> = None;
    let mut files = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-F" {
            if i + 1 < args.len() {
                i += 1;
                field_sep = unescape_sed_text(&args[i]);
            }
        } else if let Some(rest) = a.strip_prefix("-F") {
            field_sep = unescape_sed_text(rest);
        } else if a == "-v" {
            if i + 1 < args.len() {
                i += 1;
                if let Some((k, v)) = args[i].split_once('=') {
                    vars.insert(k.to_string(), unescape_sed_text(v));
                }
            }
        } else if let Some(rest) = a.strip_prefix("-v") {
            if let Some((k, v)) = rest.split_once('=') {
                vars.insert(k.to_string(), unescape_sed_text(v));
            }
        } else if a == "-f" {
            if i + 1 < args.len() {
                i += 1;
                let p = resolve_posix_path(cwd, &args[i]);
                if let Ok(b) = fs.read_file(&p) {
                    program = Some(String::from_utf8_lossy(&b).into_owned());
                }
            }
        } else if program.is_none() {
            program = Some(a.clone());
        } else {
            files.push(a.clone());
        }
        i += 1;
    }

    let prog_str = match program {
        Some(p) => p,
        None => return ok_out(""),
    };

    let (mut rules, funcs) = parse_awk_rules(&prog_str);
    let mut state = AwkState::new(field_sep, vars, funcs);

    for r in &rules {
        if matches!(r.cond, AwkCond::Begin) {
            exec_awk_block(&r.body, &mut state);
            if state.exit_code.is_some() {
                return BuiltinOutcome {
                    stdout: state.output,
                    stderr: String::new(),
                    exit_code: state.exit_code.unwrap_or(0),
                };
            }
        }
    }

    let has_line_rules = rules
        .iter()
        .any(|r| !matches!(r.cond, AwkCond::Begin | AwkCond::End));

    if has_line_rules {
        let mut inputs = Vec::new();
        if files.is_empty() {
            inputs.push(("".to_string(), stdin.to_string()));
        } else {
            for f in &files {
                if f == "-" {
                    inputs.push(("-".to_string(), stdin.to_string()));
                    continue;
                }
                if let Some((k, v)) = f.split_once('=') {
                    if !f.contains('/') && !fs.exists(&resolve_posix_path(cwd, f)) {
                        state.set_var(k, v.to_string());
                        continue;
                    }
                }
                let full = resolve_posix_path(cwd, f);
                match fs.read_file(&full) {
                    Ok(b) => inputs.push((f.clone(), String::from_utf8_lossy(&b).into_owned())),
                    Err(_) => {
                        return err_out(&format!("awk: can't open file {f}\n"), 2);
                    }
                }
            }
        }

        'input_loop: for (fname, content) in inputs {
            state.set_var("FILENAME", fname);
            state.fnr = 0;
            for line in content.lines() {
                state.nr += 1;
                state.fnr += 1;
                state.set_line(line);
                state.next_requested = false;

                for r in &mut rules {
                    match &r.cond {
                        AwkCond::Begin | AwkCond::End => continue,
                        AwkCond::Always => {
                            exec_awk_block(&r.body, &mut state);
                        }
                        AwkCond::Expr(expr) => {
                            if eval_awk_cond(expr, &mut state) {
                                exec_awk_block(&r.body, &mut state);
                            }
                        }
                        AwkCond::Range(start_e, end_e) => {
                            let active = if !r.in_range {
                                if eval_awk_cond(start_e, &mut state) {
                                    r.in_range = true;
                                    true
                                } else {
                                    false
                                }
                            } else {
                                if eval_awk_cond(end_e, &mut state) {
                                    r.in_range = false;
                                }
                                true
                            };
                            if active {
                                exec_awk_block(&r.body, &mut state);
                            }
                        }
                    }
                    if state.exit_code.is_some() {
                        break 'input_loop;
                    }
                    if state.next_requested {
                        break;
                    }
                }
            }
        }
    }

    for r in &rules {
        if matches!(r.cond, AwkCond::End) {
            exec_awk_block(&r.body, &mut state);
        }
    }

    BuiltinOutcome {
        stdout: state.output,
        stderr: String::new(),
        exit_code: state.exit_code.unwrap_or(0),
    }
}

fn parse_awk_rules(
    prog: &str,
) -> (Vec<AwkRule>, AwkFuncMap) {
    let mut rules = Vec::new();
    let mut funcs = BTreeMap::new();
    let chars: Vec<char> = prog.chars().collect();
    let mut idx = 0usize;

    while idx < chars.len() {
        while idx < chars.len() && (chars[idx].is_whitespace() || chars[idx] == ';') {
            idx += 1;
        }
        if idx >= chars.len() {
            break;
        }
        if chars[idx] == '#' {
            while idx < chars.len() && chars[idx] != '\n' {
                idx += 1;
            }
            continue;
        }

        let mut cond_str = String::new();
        let mut in_quote = false;
        let mut in_regex = false;
        while idx < chars.len() && chars[idx] != '{' && chars[idx] != '\n' && chars[idx] != ';' {
            let c = chars[idx];
            if c == '\\' && idx + 1 < chars.len() {
                cond_str.push(c);
                cond_str.push(chars[idx + 1]);
                idx += 2;
                continue;
            }
            if c == '"' && !in_regex {
                in_quote = !in_quote;
            } else if c == '/' && !in_quote {
                in_regex = !in_regex;
            }
            cond_str.push(c);
            idx += 1;
        }
        let cond_trim = cond_str.trim().to_string();

        while idx < chars.len() && chars[idx].is_whitespace() && chars[idx] != '\n' {
            idx += 1;
        }

        let body = if idx < chars.len() && chars[idx] == '{' {
            idx += 1;
            let mut depth = 1i32;
            let mut b = String::new();
            let mut q = false;
            while idx < chars.len() && depth > 0 {
                let c = chars[idx];
                if c == '\\' && idx + 1 < chars.len() {
                    b.push(c);
                    b.push(chars[idx + 1]);
                    idx += 2;
                    continue;
                }
                if c == '"' {
                    q = !q;
                } else if !q {
                    if c == '{' {
                        depth += 1;
                    } else if c == '}' {
                        depth -= 1;
                        if depth == 0 {
                            idx += 1;
                            break;
                        }
                    }
                }
                b.push(c);
                idx += 1;
            }
            b
        } else {
            "print $0".to_string()
        };

        if let Some(fn_sig) = cond_trim.strip_prefix("function ") {
            let fn_sig = fn_sig.trim();
            if let Some(open) = fn_sig.find('(')
                && let Some(close) = fn_sig.rfind(')')
            {
                let fn_name = fn_sig[..open].trim().to_string();
                let params: Vec<String> = fn_sig[open + 1..close]
                    .split(',')
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                    .collect();
                funcs.insert(fn_name, (params, body));
                continue;
            }
        }

        let cond = match cond_trim.as_str() {
            "" => AwkCond::Always,
            "BEGIN" => AwkCond::Begin,
            "END" => AwkCond::End,
            other => {
                let parts = split_awk_top_args(other);
                if parts.len() == 2 {
                    AwkCond::Range(parts[0].clone(), parts[1].clone())
                } else {
                    AwkCond::Expr(other.to_string())
                }
            }
        };
        rules.push(AwkRule {
            cond,
            body,
            in_range: false,
        });
    }
    (rules, funcs)
}

fn eval_awk_cond(expr: &str, state: &mut AwkState) -> bool {
    let e = expr.trim();
    if e.is_empty() {
        return true;
    }
    if e.starts_with('/') && e.ends_with('/') && e.len() >= 2 {
        let pat = &e[1..e.len() - 1];
        return ZeroRegex::new(vec![pat.to_string()], false, false, false, false)
            .is_match(&state.line);
    }
    let val = eval_awk_expr(e, state);
    is_awk_truthy(&val)
}

fn is_awk_truthy(val: &str) -> bool {
    if val.is_empty() {
        return false;
    }
    if let Ok(n) = val.trim().parse::<f64>() {
        return n != 0.0;
    }
    true
}

fn parse_awk_f64(val: &str) -> f64 {
    crate::commands::coreutils::parse_leading_f64(val)
}

fn split_awk_statements(block: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let chars: Vec<char> = block.chars().collect();
    let mut idx = 0usize;
    let mut quote = false;
    let mut paren = 0i32;
    let mut brace = 0i32;

    while idx < chars.len() {
        let c = chars[idx];
        if c == '\\' && idx + 1 < chars.len() {
            cur.push(c);
            cur.push(chars[idx + 1]);
            idx += 2;
            continue;
        }
        if c == '"' {
            quote = !quote;
            cur.push(c);
            idx += 1;
            continue;
        }
        if !quote {
            match c {
                '(' => paren += 1,
                ')' => paren -= 1,
                '{' => brace += 1,
                '}' => {
                    brace -= 1;
                    cur.push(c);
                    if brace == 0 && paren == 0 {
                        let t = cur.trim().to_string();
                        if !t.is_empty() {
                            out.push(t);
                        }
                        cur.clear();
                    }
                    idx += 1;
                    continue;
                }
                ';' | '\n' if paren == 0 && brace == 0 => {
                    let t = cur.trim().to_string();
                    if !t.is_empty() {
                        out.push(t);
                    }
                    cur.clear();
                    idx += 1;
                    continue;
                }
                _ => {}
            }
        }
        cur.push(c);
        idx += 1;
    }
    let t = cur.trim().to_string();
    if !t.is_empty() {
        out.push(t);
    }
    out
}

fn exec_awk_block(block: &str, state: &mut AwkState) {
    let stmts = split_awk_statements(block);
    let mut idx = 0usize;
    while idx < stmts.len() {
        if state.next_requested || state.return_val.is_some() || state.exit_code.is_some() {
            return;
        }
        let stmt = stmts[idx].trim();
        if stmt.is_empty() {
            idx += 1;
            continue;
        }
        if stmt == "next" {
            state.next_requested = true;
            return;
        }
        if stmt == "return" || stmt.starts_with("return ") || stmt.starts_with("return(") {
            let rest = stmt.strip_prefix("return").unwrap_or("").trim();
            let val = if rest.is_empty() {
                String::new()
            } else {
                eval_awk_expr(rest, state)
            };
            state.return_val = Some(val);
            return;
        }
        if stmt == "exit" || stmt.starts_with("exit ") {
            let code_str = stmt.strip_prefix("exit").unwrap_or("").trim();
            let code = if code_str.is_empty() {
                0
            } else {
                eval_awk_expr(code_str, state).parse::<i32>().unwrap_or(0)
            };
            state.exit_code = Some(code);
            return;
        }
        if stmt.starts_with("if") && (stmt[2..].starts_with(' ') || stmt[2..].starts_with('(')) {
            exec_awk_if(stmt, state);
            idx += 1;
            continue;
        }
        if stmt.starts_with("for") && (stmt[3..].starts_with(' ') || stmt[3..].starts_with('(')) {
            exec_awk_for(stmt, state);
            idx += 1;
            continue;
        }
        if stmt.starts_with("while")
            && (stmt[5..].starts_with(' ') || stmt[5..].starts_with('('))
        {
            exec_awk_while(stmt, state);
            idx += 1;
            continue;
        }
        if stmt == "print" || stmt.starts_with("print ") || stmt.starts_with("print(") {
            let rest = stmt.strip_prefix("print").unwrap_or("").trim();
            if rest.is_empty() {
                state.output.push_str(&state.line);
                state.output.push_str(&state.ors);
            } else {
                let args = split_awk_top_args(rest);
                let vals: Vec<String> = args.iter().map(|a| eval_awk_expr(a, state)).collect();
                state.output.push_str(&vals.join(&state.ofs));
                state.output.push_str(&state.ors);
            }
            idx += 1;
            continue;
        }
        if stmt.starts_with("printf ") || stmt.starts_with("printf(") {
            let rest = stmt.strip_prefix("printf").unwrap_or("").trim();
            let inner = if rest.starts_with('(') && rest.ends_with(')') {
                &rest[1..rest.len() - 1]
            } else {
                rest
            };
            let args = split_awk_top_args(inner);
            if !args.is_empty() {
                let fmt_str = eval_awk_expr(&args[0], state);
                let vals: Vec<String> = args[1..].iter().map(|a| eval_awk_expr(a, state)).collect();
                let formatted = format_awk_printf(&fmt_str, &vals);
                state.output.push_str(&formatted);
            }
            idx += 1;
            continue;
        }
        let _ = eval_awk_expr(stmt, state);
        idx += 1;
    }
}

fn extract_paren_and_body(stmt: &str, keyword: &str) -> Option<(String, String, Option<String>)> {
    let rest = stmt.strip_prefix(keyword)?.trim_start();
    if !rest.starts_with('(') {
        return None;
    }
    let chars: Vec<char> = rest.chars().collect();
    let mut depth = 0i32;
    let mut q = false;
    let mut close_idx = None;
    for i in 0..chars.len() {
        if chars[i] == '\\' {
            continue;
        }
        if chars[i] == '"' {
            q = !q;
        } else if !q {
            if chars[i] == '(' {
                depth += 1;
            } else if chars[i] == ')' {
                depth -= 1;
                if depth == 0 {
                    close_idx = Some(i);
                    break;
                }
            }
        }
    }
    let c_idx = close_idx?;
    let cond: String = chars[1..c_idx].iter().collect();
    let after: String = chars[c_idx + 1..].iter().collect();
    let after_trim = after.trim();

    if after_trim.starts_with('{') {
        let b_chars: Vec<char> = after_trim.chars().collect();
        let mut b_depth = 0i32;
        let mut bq = false;
        let mut b_close = None;
        for i in 0..b_chars.len() {
            if b_chars[i] == '"' {
                bq = !bq;
            } else if !bq {
                if b_chars[i] == '{' {
                    b_depth += 1;
                } else if b_chars[i] == '}' {
                    b_depth -= 1;
                    if b_depth == 0 {
                        b_close = Some(i);
                        break;
                    }
                }
            }
        }
        if let Some(bc) = b_close {
            let body: String = b_chars[1..bc].iter().collect();
            let rem: String = b_chars[bc + 1..].iter().collect();
            let rem_trim = rem.trim();
            let else_part = if let Some(el) = rem_trim.strip_prefix("else") {
                let el_t = el.trim();
                let el_body = if el_t.starts_with('{') && el_t.ends_with('}') {
                    el_t[1..el_t.len() - 1].to_string()
                } else {
                    el_t.to_string()
                };
                Some(el_body)
            } else {
                None
            };
            return Some((cond, body, else_part));
        }
    }
    Some((cond, after_trim.to_string(), None))
}

fn exec_awk_if(stmt: &str, state: &mut AwkState) {
    if let Some((cond, then_body, else_body)) = extract_paren_and_body(stmt, "if") {
        if eval_awk_cond(&cond, state) {
            exec_awk_block(&then_body, state);
        } else if let Some(eb) = else_body {
            exec_awk_block(&eb, state);
        }
    }
}

fn exec_awk_while(stmt: &str, state: &mut AwkState) {
    if let Some((cond, body, _)) = extract_paren_and_body(stmt, "while") {
        let mut guard = 0usize;
        while eval_awk_cond(&cond, state) && guard < 50_000 {
            exec_awk_block(&body, state);
            if state.next_requested || state.exit_code.is_some() {
                break;
            }
            guard += 1;
        }
    }
}

fn exec_awk_for(stmt: &str, state: &mut AwkState) {
    if let Some((header, body, _)) = extract_paren_and_body(stmt, "for") {
        if let Some((var, arr)) = header.split_once(" in ") {
            let var_name = var.trim().to_string();
            let arr_name = arr.trim().to_string();
            let keys: Vec<String> = state
                .arrays
                .get(&arr_name)
                .map(|m| m.keys().cloned().collect())
                .unwrap_or_default();
            for k in keys {
                state.set_var(&var_name, k);
                exec_awk_block(&body, state);
                if state.next_requested || state.exit_code.is_some() {
                    break;
                }
            }
        } else {
            let parts: Vec<&str> = header.split(';').collect();
            if parts.len() == 3 {
                let _ = eval_awk_expr(parts[0], state);
                let mut guard = 0usize;
                while eval_awk_cond(parts[1], state) && guard < 50_000 {
                    exec_awk_block(&body, state);
                    if state.next_requested || state.exit_code.is_some() {
                        break;
                    }
                    let _ = eval_awk_expr(parts[2], state);
                    guard += 1;
                }
            }
        }
    }
}

fn split_awk_top_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote = false;
    let mut paren = 0i32;
    let mut bracket = 0i32;
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            cur.push(c);
            if let Some(nc) = chars.next() {
                cur.push(nc);
            }
            continue;
        }
        if c == '"' {
            quote = !quote;
            cur.push(c);
            continue;
        }
        if !quote {
            match c {
                '(' => paren += 1,
                ')' => paren -= 1,
                '[' => bracket += 1,
                ']' => bracket -= 1,
                ',' if paren == 0 && bracket == 0 => {
                    out.push(cur.trim().to_string());
                    cur.clear();
                    continue;
                }
                _ => {}
            }
        }
        cur.push(c);
    }
    let t = cur.trim().to_string();
    if !t.is_empty() {
        out.push(t);
    }
    out
}

fn eval_awk_expr(expr: &str, state: &mut AwkState) -> String {
    let s = expr.trim();
    if s.is_empty() {
        return String::new();
    }
    if s.starts_with('"') && s.ends_with('"') && s.len() >= 2 && !s[1..s.len() - 1].contains('"') {
        return unescape_sed_text(&s[1..s.len() - 1]);
    }
    if let Some(var) = s.strip_suffix("++") {
        let v = var.trim();
        let old_val = parse_awk_f64(&eval_awk_expr(v, state));
        assign_awk_lvalue(v, format_awk_num(old_val + 1.0), state);
        return format_awk_num(old_val);
    }
    if let Some(var) = s.strip_prefix("++") {
        let v = var.trim();
        let new_val = parse_awk_f64(&eval_awk_expr(v, state)) + 1.0;
        let formatted = format_awk_num(new_val);
        assign_awk_lvalue(v, formatted.clone(), state);
        return formatted;
    }
    if let Some(var) = s.strip_suffix("--") {
        let v = var.trim();
        let old_val = parse_awk_f64(&eval_awk_expr(v, state));
        assign_awk_lvalue(v, format_awk_num(old_val - 1.0), state);
        return format_awk_num(old_val);
    }

    for op in ["+=", "-=", "*=", "/=", "="] {
        if let Some((lhs, rhs)) = split_awk_binary_once(s, op) {
            if op == "=" && (lhs.ends_with('!') || lhs.ends_with('<') || lhs.ends_with('>') || lhs.ends_with('=')) {
                continue;
            }
            let rval = eval_awk_expr(&rhs, state);
            let final_val = if op == "=" {
                rval
            } else {
                let lnum = parse_awk_f64(&eval_awk_expr(&lhs, state));
                let rnum = parse_awk_f64(&rval);
                let res = match op {
                    "+=" => lnum + rnum,
                    "-=" => lnum - rnum,
                    "*=" => lnum * rnum,
                    "/=" => if rnum != 0.0 { lnum / rnum } else { 0.0 },
                    _ => rnum,
                };
                format_awk_num(res)
            };
            assign_awk_lvalue(&lhs, final_val.clone(), state);
            return final_val;
        }
    }

    if let Some((cond_part, branches)) = split_awk_binary_once(s, "?") {
        if let Some((t_branch, f_branch)) = split_awk_binary_once(&branches, ":") {
            return if eval_awk_cond(&cond_part, state) {
                eval_awk_expr(&t_branch, state)
            } else {
                eval_awk_expr(&f_branch, state)
            };
        }
    }

    if let Some((a, b)) = split_awk_binary_once(s, "||") {
        return if eval_awk_cond(&a, state) || eval_awk_cond(&b, state) {
            "1".to_string()
        } else {
            "0".to_string()
        };
    }
    if let Some((a, b)) = split_awk_binary_once(s, "&&") {
        return if eval_awk_cond(&a, state) && eval_awk_cond(&b, state) {
            "1".to_string()
        } else {
            "0".to_string()
        };
    }

    for cmp_op in ["==", "!=", "<=", ">=", "!~", "~", "<", ">"] {
        if let Some((lhs, rhs)) = split_awk_binary_once(s, cmp_op) {
            let lv = eval_awk_expr(&lhs, state);
            if cmp_op == "~" || cmp_op == "!~" {
                let pat = rhs.trim().trim_matches('/').trim_matches('"');
                let matched =
                    ZeroRegex::new(vec![pat.to_string()], false, false, false, false).is_match(&lv);
                let ok = if cmp_op == "~" { matched } else { !matched };
                return if ok { "1".to_string() } else { "0".to_string() };
            }
            let rv = eval_awk_expr(&rhs, state);
            let cmp = match (lv.trim().parse::<f64>(), rv.trim().parse::<f64>()) {
                (Ok(ln), Ok(rn)) => ln.partial_cmp(&rn).unwrap_or(std::cmp::Ordering::Equal),
                _ => lv.cmp(&rv),
            };
            let ok = match cmp_op {
                "==" => cmp == std::cmp::Ordering::Equal,
                "!=" => cmp != std::cmp::Ordering::Equal,
                "<=" => cmp != std::cmp::Ordering::Greater,
                ">=" => cmp != std::cmp::Ordering::Less,
                "<" => cmp == std::cmp::Ordering::Less,
                ">" => cmp == std::cmp::Ordering::Greater,
                _ => false,
            };
            return if ok { "1".to_string() } else { "0".to_string() };
        }
    }

    if let Some(parts) = split_awk_concat(s) {
        let mut joined = String::new();
        for p in parts {
            joined.push_str(&eval_awk_expr(&p, state));
        }
        return joined;
    }

    for op in ["+", "-"] {
        if let Some((lhs, rhs)) = split_awk_binary_right(s, op) {
            if !lhs.trim().is_empty() {
                let ln = parse_awk_f64(&eval_awk_expr(&lhs, state));
                let rn = parse_awk_f64(&eval_awk_expr(&rhs, state));
                let res = if op == "+" { ln + rn } else { ln - rn };
                return format_awk_num(res);
            }
        }
    }

    for op in ["*", "/", "%"] {
        if let Some((lhs, rhs)) = split_awk_binary_right(s, op) {
            let ln = parse_awk_f64(&eval_awk_expr(&lhs, state));
            let rn = parse_awk_f64(&eval_awk_expr(&rhs, state));
            let res = match op {
                "*" => ln * rn,
                "/" => if rn != 0.0 { ln / rn } else { 0.0 },
                "%" => if rn != 0.0 { ln % rn } else { 0.0 },
                _ => 0.0,
            };
            return format_awk_num(res);
        }
    }

    if let Some(inner) = s.strip_prefix('!') {
        return if is_awk_truthy(&eval_awk_expr(inner, state)) {
            "0".to_string()
        } else {
            "1".to_string()
        };
    }

    if s.starts_with('(') && s.ends_with(')') {
        return eval_awk_expr(&s[1..s.len() - 1], state);
    }

    if let Some(func_res) = try_eval_awk_func(s, state) {
        return func_res;
    }

    if let Some(field_expr) = s.strip_prefix('$') {
        let idx = eval_awk_expr(field_expr, state)
            .parse::<usize>()
            .unwrap_or(0);
        return state.get_field(idx);
    }

    if let Some(open) = s.find('[') {
        if s.ends_with(']') {
            let arr_name = s[..open].trim();
            let key_expr = &s[open + 1..s.len() - 1];
            let key = eval_awk_expr(key_expr, state);
            return state
                .arrays
                .get(arr_name)
                .and_then(|m| m.get(&key))
                .cloned()
                .unwrap_or_default();
        }
    }

    if s.parse::<f64>().is_ok() {
        return s.to_string();
    }

    state.get_var(s)
}

fn assign_awk_lvalue(lval: &str, val: String, state: &mut AwkState) {
    let lv = lval.trim();
    if let Some(f) = lv.strip_prefix('$') {
        let idx = eval_awk_expr(f, state).parse::<usize>().unwrap_or(0);
        state.set_field(idx, val);
        return;
    }
    if let Some(open) = lv.find('[') {
        if lv.ends_with(']') {
            let arr_name = lv[..open].trim().to_string();
            let key = eval_awk_expr(&lv[open + 1..lv.len() - 1], state);
            state.arrays.entry(arr_name).or_default().insert(key, val);
            return;
        }
    }
    state.set_var(lv, val);
}

fn try_eval_awk_func(s: &str, state: &mut AwkState) -> Option<String> {
    let open = s.find('(')?;
    if !s.ends_with(')') {
        return None;
    }
    let fn_name = s[..open].trim();
    if !fn_name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return None;
    }
    let args_str = &s[open + 1..s.len() - 1];
    let args = split_awk_top_args(args_str);

    match fn_name {
        "length" => {
            let target = if args.is_empty() {
                state.line.clone()
            } else {
                eval_awk_expr(&args[0], state)
            };
            Some(target.chars().count().to_string())
        }
        "tolower" => {
            let t = args
                .first()
                .map(|a| eval_awk_expr(a, state))
                .unwrap_or_default();
            Some(t.to_lowercase())
        }
        "toupper" => {
            let t = args
                .first()
                .map(|a| eval_awk_expr(a, state))
                .unwrap_or_default();
            Some(t.to_uppercase())
        }
        "substr" => {
            if args.len() < 2 {
                return Some(String::new());
            }
            let text = eval_awk_expr(&args[0], state);
            let start = eval_awk_expr(&args[1], state)
                .parse::<usize>()
                .unwrap_or(1)
                .saturating_sub(1);
            let chars: Vec<char> = text.chars().collect();
            if start >= chars.len() {
                return Some(String::new());
            }
            if args.len() >= 3 {
                let len = eval_awk_expr(&args[2], state).parse::<usize>().unwrap_or(0);
                Some(chars[start..(start + len).min(chars.len())].iter().collect())
            } else {
                Some(chars[start..].iter().collect())
            }
        }
        "index" => {
            if args.len() < 2 {
                return Some("0".to_string());
            }
            let hay = eval_awk_expr(&args[0], state);
            let needle = eval_awk_expr(&args[1], state);
            match hay.find(&needle) {
                Some(byte_idx) => Some((hay[..byte_idx].chars().count() + 1).to_string()),
                None => Some("0".to_string()),
            }
        }
        "split" => {
            if args.len() < 2 {
                return Some("0".to_string());
            }
            let text = eval_awk_expr(&args[0], state);
            let arr_name = args[1].trim().to_string();
            let sep = if args.len() >= 3 {
                eval_awk_expr(&args[2], state)
            } else {
                state.fs.clone()
            };
            let parts: Vec<String> = if sep == " " {
                text.split_whitespace().map(|p| p.to_string()).collect()
            } else {
                text.split(&sep).map(|p| p.to_string()).collect()
            };
            let map = state.arrays.entry(arr_name).or_default();
            map.clear();
            for (i, p) in parts.iter().enumerate() {
                map.insert((i + 1).to_string(), p.clone());
            }
            Some(parts.len().to_string())
        }
        "sub" | "gsub" => {
            if args.len() < 2 {
                return Some("0".to_string());
            }
            let pat = args[0]
                .trim()
                .trim_matches('/')
                .trim_matches('"')
                .to_string();
            let repl = eval_awk_expr(&args[1], state);
            let target_lval = args.get(2).map(|s| s.as_str()).unwrap_or("$0");
            let current = eval_awk_expr(target_lval, state);
            let (updated, changed) =
                replace_regex_in_text(&current, &pat, &repl, false, fn_name == "gsub", None);
            assign_awk_lvalue(target_lval, updated, state);
            Some(if changed { "1" } else { "0" }.to_string())
        }
        "int" => {
            let n = args
                .first()
                .map(|a| parse_awk_f64(&eval_awk_expr(a, state)))
                .unwrap_or(0.0);
            Some((n as i64).to_string())
        }
        "sqrt" => {
            let n = args
                .first()
                .map(|a| parse_awk_f64(&eval_awk_expr(a, state)))
                .unwrap_or(0.0);
            Some(format_awk_num(n.sqrt()))
        }
        "sin" => {
            let n = args
                .first()
                .map(|a| parse_awk_f64(&eval_awk_expr(a, state)))
                .unwrap_or(0.0);
            Some(format_awk_num(n.sin()))
        }
        "cos" => {
            let n = args
                .first()
                .map(|a| parse_awk_f64(&eval_awk_expr(a, state)))
                .unwrap_or(0.0);
            Some(format_awk_num(n.cos()))
        }
        "exp" => {
            let n = args
                .first()
                .map(|a| parse_awk_f64(&eval_awk_expr(a, state)))
                .unwrap_or(0.0);
            Some(format_awk_num(n.exp()))
        }
        "log" => {
            let n = args
                .first()
                .map(|a| parse_awk_f64(&eval_awk_expr(a, state)))
                .unwrap_or(0.0);
            Some(format_awk_num(n.ln()))
        }
        "sprintf" => {
            if args.is_empty() {
                return Some(String::new());
            }
            let fmt_str = eval_awk_expr(&args[0], state);
            let vals: Vec<String> = args[1..].iter().map(|a| eval_awk_expr(a, state)).collect();
            Some(format_awk_printf(&fmt_str, &vals))
        }
        _ => {
            if let Some((params, body)) = state.funcs.get(fn_name).cloned() {
                let arg_vals: Vec<String> =
                    args.iter().map(|a| eval_awk_expr(a, state)).collect();
                let mut saved_vars: Vec<(String, Option<String>)> = Vec::new();
                let mut saved_arrays: Vec<(String, Option<BTreeMap<String, String>>)> = Vec::new();
                for (idx, p) in params.iter().enumerate() {
                    saved_vars.push((p.clone(), state.vars.get(p).cloned()));
                    saved_arrays.push((p.clone(), state.arrays.remove(p)));
                    let val = arg_vals.get(idx).cloned().unwrap_or_default();
                    state.vars.insert(p.clone(), val);
                }
                let prev_ret = state.return_val.take();
                exec_awk_block(&body, state);
                let ret = state.return_val.take().unwrap_or_default();
                state.return_val = prev_ret;
                for (p, old_v) in saved_vars {
                    if let Some(v) = old_v {
                        state.vars.insert(p, v);
                    } else {
                        state.vars.remove(&p);
                    }
                }
                for (p, old_a) in saved_arrays {
                    if let Some(a) = old_a {
                        state.arrays.insert(p, a);
                    } else {
                        state.arrays.remove(&p);
                    }
                }
                return Some(ret);
            }
            None
        }
    }
}

fn split_awk_binary_once(s: &str, op: &str) -> Option<(String, String)> {
    let chars: Vec<char> = s.chars().collect();
    let op_chars: Vec<char> = op.chars().collect();
    let mut quote = false;
    let mut paren = 0i32;
    let mut bracket = 0i32;
    let mut i = 0usize;

    while i + op_chars.len() <= chars.len() {
        let c = chars[i];
        if c == '\\' {
            i += 2;
            continue;
        }
        if c == '"' {
            quote = !quote;
            i += 1;
            continue;
        }
        if !quote {
            match c {
                '(' => paren += 1,
                ')' => paren -= 1,
                '[' => bracket += 1,
                ']' => bracket -= 1,
                _ => {}
            }
            if paren == 0 && bracket == 0 && chars[i..i + op_chars.len()] == op_chars[..] {
                if op == "=" && i + 1 < chars.len() && chars[i + 1] == '=' {
                    i += 2;
                    continue;
                }
                let lhs: String = chars[..i].iter().collect();
                let rhs: String = chars[i + op_chars.len()..].iter().collect();
                return Some((lhs, rhs));
            }
        }
        i += 1;
    }
    None
}

fn split_awk_binary_right(s: &str, op: &str) -> Option<(String, String)> {
    let chars: Vec<char> = s.chars().collect();
    let op_chars: Vec<char> = op.chars().collect();
    let mut quote = false;
    let mut paren = 0i32;
    let mut bracket = 0i32;
    let mut last_match = None;
    let mut i = 0usize;

    while i + op_chars.len() <= chars.len() {
        let c = chars[i];
        if c == '\\' {
            i += 2;
            continue;
        }
        if c == '"' {
            quote = !quote;
            i += 1;
            continue;
        }
        if !quote {
            match c {
                '(' => paren += 1,
                ')' => paren -= 1,
                '[' => bracket += 1,
                ']' => bracket -= 1,
                _ => {}
            }
            if paren == 0 && bracket == 0 && chars[i..i + op_chars.len()] == op_chars[..] {
                if i > 0 {
                    last_match = Some(i);
                }
            }
        }
        i += 1;
    }
    let idx = last_match?;
    let lhs: String = chars[..idx].iter().collect();
    let rhs: String = chars[idx + op_chars.len()..].iter().collect();
    Some((lhs, rhs))
}

fn split_awk_concat(s: &str) -> Option<Vec<String>> {
    let mut parts = Vec::new();
    let mut cur = String::new();
    let chars: Vec<char> = s.chars().collect();
    let mut quote = false;
    let mut paren = 0i32;
    let mut bracket = 0i32;
    let mut i = 0usize;

    while i < chars.len() {
        let c = chars[i];
        if c == '\\' && i + 1 < chars.len() {
            cur.push(c);
            cur.push(chars[i + 1]);
            i += 2;
            continue;
        }
        if c == '"' {
            if !quote && !cur.trim().is_empty() && paren == 0 && bracket == 0 {
                parts.push(std::mem::take(&mut cur));
            }
            quote = !quote;
            cur.push(c);
            if !quote && paren == 0 && bracket == 0 {
                parts.push(std::mem::take(&mut cur));
            }
            i += 1;
            continue;
        }
        if !quote {
            match c {
                '(' => paren += 1,
                ')' => paren -= 1,
                '[' => bracket += 1,
                ']' => bracket -= 1,
                ' ' | '\t' if paren == 0 && bracket == 0 => {
                    if !cur.trim().is_empty() {
                        parts.push(std::mem::take(&mut cur));
                    }
                    i += 1;
                    continue;
                }
                _ => {}
            }
        }
        cur.push(c);
        i += 1;
    }
    if !cur.trim().is_empty() {
        parts.push(cur.trim().to_string());
    }
    let is_arith_op_end = |tok: &str| -> bool {
        let t = tok.trim();
        !t.ends_with("++") && !t.ends_with("--") && t.ends_with(['+', '-', '*', '/', '%', '^'])
    };
    let is_arith_op_start = |tok: &str| -> bool {
        let t = tok.trim();
        !t.starts_with("++") && !t.starts_with("--") && t.starts_with(['+', '-', '*', '/', '%', '^'])
    };
    let mut merged: Vec<String> = Vec::new();
    for p in parts {
        if let Some(last) = merged.last_mut()
            && (is_arith_op_end(last) || is_arith_op_start(&p))
        {
            last.push(' ');
            last.push_str(&p);
        } else {
            merged.push(p);
        }
    }
    if merged.len() > 1 { Some(merged) } else { None }
}

fn format_awk_num(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n:.6}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    }
}

fn format_awk_printf(fmt_str: &str, vals: &[String]) -> String {
    let mut out = String::new();
    let chars: Vec<char> = fmt_str.chars().collect();
    let mut i = 0usize;
    let mut arg_idx = 0usize;

    while i < chars.len() {
        if chars[i] == '%' {
            if i + 1 < chars.len() && chars[i + 1] == '%' {
                out.push('%');
                i += 2;
                continue;
            }
            i += 1;
            let mut spec = String::new();
            while i < chars.len() && !matches!(chars[i], 's' | 'd' | 'i' | 'f' | 'g' | 'x' | 'c') {
                spec.push(chars[i]);
                i += 1;
            }
            let conv = if i < chars.len() {
                let c = chars[i];
                i += 1;
                c
            } else {
                's'
            };
            let val = vals.get(arg_idx).cloned().unwrap_or_default();
            arg_idx += 1;
            let formatted = match conv {
                'd' | 'i' => {
                    let n = val.parse::<f64>().unwrap_or(0.0) as i64;
                    apply_width_spec(&n.to_string(), &spec, true)
                }
                'f' => {
                    let n = val.parse::<f64>().unwrap_or(0.0);
                    let prec = spec
                        .split_once('.')
                        .and_then(|(_, p)| p.parse::<usize>().ok())
                        .unwrap_or(6);
                    let s = format!("{n:.prec$}");
                    apply_width_spec(&s, &spec, true)
                }
                'x' => {
                    let n = val.parse::<f64>().unwrap_or(0.0) as i64;
                    format!("{n:x}")
                }
                _ => apply_width_spec(&val, &spec, false),
            };
            out.push_str(&formatted);
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

fn apply_width_spec(val: &str, spec: &str, is_num: bool) -> String {
    let left_align = spec.starts_with('-');
    let zero_pad = !left_align && spec.starts_with('0') && is_num;
    let width_part = spec
        .trim_start_matches('-')
        .split('.')
        .next()
        .unwrap_or("");
    let width = width_part.parse::<usize>().unwrap_or(0);
    let len = val.chars().count();
    if width <= len {
        return val.to_string();
    }
    let pad_len = width - len;
    if left_align {
        format!("{val}{}", " ".repeat(pad_len))
    } else if zero_pad {
        format!("{}{val}", "0".repeat(pad_len))
    } else {
        format!("{}{val}", " ".repeat(pad_len))
    }
}

fn collect_rel_files(root: &str, rel_prefix: &str, fs: &dyn SafeBashFs, out: &mut Vec<String>) {
    let mut entries = fs.list_dir(root).unwrap_or_default();
    entries.sort();
    for name in entries {
        let full = if root == "/" { format!("/{name}") } else { format!("{root}/{name}") };
        let rel = if rel_prefix.is_empty() { name.clone() } else { format!("{rel_prefix}/{name}") };
        if fs.is_dir(&full) {
            collect_rel_files(&full, &rel, fs, out);
        } else {
            out.push(rel);
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DiffFormat {
    Normal,
    Unified,
    Context,
    Ed,
    Rcs,
}

#[allow(clippy::too_many_arguments)]
fn diff_two_texts(
    label_a: &str,
    label_b: &str,
    text_a: &str,
    text_b: &str,
    format: DiffFormat,
    brief: bool,
    report_identical: bool,
    ignore_case: bool,
    ignore_all_space: bool,
    ignore_blank_lines: bool,
) -> (String, bool) {
    let norm_line = |l: &str| -> String {
        let mut s = if ignore_all_space {
            l.split_whitespace().collect::<Vec<_>>().join(" ")
        } else {
            l.to_string()
        };
        if ignore_case {
            s = s.to_ascii_lowercase();
        }
        s
    };

    let a_no_nl = !text_a.is_empty() && !text_a.ends_with('\n');
    let b_no_nl = !text_b.is_empty() && !text_b.ends_with('\n');

    let lines_a: Vec<&str> = text_a
        .lines()
        .filter(|l| !ignore_blank_lines || !l.trim().is_empty())
        .collect();
    let lines_b: Vec<&str> = text_b
        .lines()
        .filter(|l| !ignore_blank_lines || !l.trim().is_empty())
        .collect();

    let norm_a: Vec<String> = lines_a.iter().map(|l| norm_line(l)).collect();
    let norm_b: Vec<String> = lines_b.iter().map(|l| norm_line(l)).collect();

    if norm_a == norm_b && a_no_nl == b_no_nl {
        if report_identical {
            return (format!("Files {label_a} and {label_b} are identical\n"), false);
        }
        return (String::new(), false);
    }

    if brief {
        return (format!("Files {label_a} and {label_b} differ\n"), true);
    }

    let edits = compute_lcs_edits(&norm_a, &norm_b);
    let mut out = String::new();
    if matches!(format, DiffFormat::Unified | DiffFormat::Context) {
        if format == DiffFormat::Context {
            out.push_str(&format!("*** {label_a}\n"));
        }
        out.push_str(&format!("--- {label_a}\n+++ {label_b}\n"));
        out.push_str(&format!(
            "@@ -1,{} +1,{} @@\n",
            lines_a.len(),
            lines_b.len()
        ));
        let last_a = lines_a.len().saturating_sub(1);
        let last_b = lines_b.len().saturating_sub(1);
        let mut cur_b_idx = 0usize;
        for edit in edits {
            match edit {
                DiffEdit::Keep(ia) => {
                    let ib = cur_b_idx;
                    cur_b_idx += 1;
                    out.push_str(&format!(" {}\n", lines_a[ia]));
                    if ia == last_a && ib == last_b && (a_no_nl || b_no_nl) {
                        out.push_str("\\ No newline at end of file\n");
                    }
                }
                DiffEdit::Delete(ia) => {
                    out.push_str(&format!("-{}\n", lines_a[ia]));
                    if ia == last_a && a_no_nl {
                        out.push_str("\\ No newline at end of file\n");
                    }
                }
                DiffEdit::Insert(ib) => {
                    cur_b_idx = ib + 1;
                    out.push_str(&format!("+{}\n", lines_b[ib]));
                    if ib == last_b && b_no_nl {
                        out.push_str("\\ No newline at end of file\n");
                    }
                }
            }
        }
    } else {
        let fmt_range = |s: usize, e: usize| -> String {
            if s == e {
                format!("{s}")
            } else {
                format!("{s},{e}")
            }
        };
        let mut idx = 0usize;
        let mut cur_a = 0usize;
        let mut cur_b = 0usize;
        let mut hunks: Vec<(usize, usize, Vec<usize>, Vec<usize>)> = Vec::new();
        while idx < edits.len() {
            if let DiffEdit::Keep(ia) = edits[idx] {
                cur_a = ia + 1;
                cur_b += 1;
                idx += 1;
                continue;
            }
            let hunk_a = cur_a;
            let hunk_b = cur_b;
            let mut dels = Vec::new();
            let mut inss = Vec::new();
            while idx < edits.len() {
                match edits[idx] {
                    DiffEdit::Keep(_) => break,
                    DiffEdit::Delete(ia) => {
                        dels.push(ia);
                        cur_a = ia + 1;
                    }
                    DiffEdit::Insert(ib) => {
                        inss.push(ib);
                        cur_b = ib + 1;
                    }
                }
                idx += 1;
            }
            hunks.push((hunk_a, hunk_b, dels, inss));
        }
        match format {
            DiffFormat::Ed => {
                for (ha, _hb, dels, inss) in hunks.into_iter().rev() {
                    if !dels.is_empty() && !inss.is_empty() {
                        let a_range = fmt_range(dels[0] + 1, *dels.last().unwrap() + 1);
                        out.push_str(&format!("{a_range}c\n"));
                        for ib in inss {
                            out.push_str(&format!("{}\n", lines_b[ib]));
                        }
                        out.push_str(".\n");
                    } else if !dels.is_empty() {
                        let a_range = fmt_range(dels[0] + 1, *dels.last().unwrap() + 1);
                        out.push_str(&format!("{a_range}d\n"));
                    } else if !inss.is_empty() {
                        out.push_str(&format!("{ha}a\n"));
                        for ib in inss {
                            out.push_str(&format!("{}\n", lines_b[ib]));
                        }
                        out.push_str(".\n");
                    }
                }
            }
            DiffFormat::Rcs => {
                for (ha, _hb, dels, inss) in hunks {
                    if !dels.is_empty() {
                        out.push_str(&format!("d{} {}\n", dels[0] + 1, dels.len()));
                    }
                    if !inss.is_empty() {
                        let after_a = if !dels.is_empty() {
                            *dels.last().unwrap() + 1
                        } else {
                            ha
                        };
                        out.push_str(&format!("a{} {}\n", after_a, inss.len()));
                        for ib in inss {
                            out.push_str(&format!("{}\n", lines_b[ib]));
                        }
                    }
                }
            }
            _ => {
                for (ha, hb, dels, inss) in hunks {
                    if !dels.is_empty() && !inss.is_empty() {
                        let a_range = fmt_range(dels[0] + 1, *dels.last().unwrap() + 1);
                        let b_range = fmt_range(inss[0] + 1, *inss.last().unwrap() + 1);
                        out.push_str(&format!("{a_range}c{b_range}\n"));
                        for ia in dels {
                            out.push_str(&format!("< {}\n", lines_a[ia]));
                        }
                        out.push_str("---\n");
                        for ib in inss {
                            out.push_str(&format!("> {}\n", lines_b[ib]));
                        }
                    } else if !dels.is_empty() {
                        let a_range = fmt_range(dels[0] + 1, *dels.last().unwrap() + 1);
                        out.push_str(&format!("{a_range}d{hb}\n"));
                        for ia in dels {
                            out.push_str(&format!("< {}\n", lines_a[ia]));
                        }
                    } else if !inss.is_empty() {
                        let b_range = fmt_range(inss[0] + 1, *inss.last().unwrap() + 1);
                        out.push_str(&format!("{ha}a{b_range}\n"));
                        for ib in inss {
                            out.push_str(&format!("> {}\n", lines_b[ib]));
                        }
                    }
                }
            }
        }
    }
    (out, true)
}

#[allow(clippy::too_many_arguments)]
fn diff_dirs_recursive(
    disp_a: &str,
    disp_b: &str,
    full_a: &str,
    full_b: &str,
    format: DiffFormat,
    new_file: bool,
    brief: bool,
    report_identical: bool,
    ignore_case: bool,
    ignore_all_space: bool,
    ignore_blank_lines: bool,
    fs: &dyn SafeBashFs,
    out: &mut String,
    any_diff: &mut bool,
) {
    let mut set = std::collections::BTreeSet::new();
    for n in fs.list_dir(full_a).unwrap_or_default() {
        set.insert(n);
    }
    for n in fs.list_dir(full_b).unwrap_or_default() {
        set.insert(n);
    }
    for name in set {
        let ca = if full_a == "/" { format!("/{name}") } else { format!("{full_a}/{name}") };
        let cb = if full_b == "/" { format!("/{name}") } else { format!("{full_b}/{name}") };
        let da = format!("{}/{name}", disp_a.trim_end_matches('/'));
        let db = format!("{}/{name}", disp_b.trim_end_matches('/'));
        let ex_a = fs.exists(&ca);
        let ex_b = fs.exists(&cb);
        if ex_a && !ex_b {
            *any_diff = true;
            if new_file {
                if fs.is_dir(&ca) {
                    let mut rels = Vec::new();
                    collect_rel_files(&ca, "", fs, &mut rels);
                    for r in rels {
                        let fa = format!("{ca}/{r}");
                        let l_a = format!("{da}/{r}");
                        let txt = fs.read_file(&fa).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
                        let ls: Vec<&str> = txt.lines().collect();
                        out.push_str(&format!("--- {l_a}\n+++ /dev/null\n@@ -1,{} +0,0 @@\n", ls.len()));
                        for l in ls {
                            out.push_str(&format!("-{l}\n"));
                        }
                    }
                } else {
                    let txt = fs.read_file(&ca).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
                    let ls: Vec<&str> = txt.lines().collect();
                    out.push_str(&format!("--- {da}\n+++ /dev/null\n@@ -1,{} +0,0 @@\n", ls.len()));
                    for l in ls {
                        out.push_str(&format!("-{l}\n"));
                    }
                }
            } else {
                out.push_str(&format!("Only in {}: {name}\n", disp_a.trim_end_matches('/')));
            }
        } else if !ex_a && ex_b {
            *any_diff = true;
            if new_file {
                if fs.is_dir(&cb) {
                    let mut rels = Vec::new();
                    collect_rel_files(&cb, "", fs, &mut rels);
                    for r in rels {
                        let fb = format!("{cb}/{r}");
                        let l_b = format!("{db}/{r}");
                        let txt = fs.read_file(&fb).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
                        let ls: Vec<&str> = txt.lines().collect();
                        out.push_str(&format!("--- /dev/null\n+++ {l_b}\n@@ -0,0 +1,{} @@\n", ls.len()));
                        for l in ls {
                            out.push_str(&format!("+{l}\n"));
                        }
                    }
                } else {
                    let txt = fs.read_file(&cb).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
                    let ls: Vec<&str> = txt.lines().collect();
                    out.push_str(&format!("--- /dev/null\n+++ {db}\n@@ -0,0 +1,{} @@\n", ls.len()));
                    for l in ls {
                        out.push_str(&format!("+{l}\n"));
                    }
                }
            } else {
                out.push_str(&format!("Only in {}: {name}\n", disp_b.trim_end_matches('/')));
            }
        } else if fs.is_dir(&ca) && fs.is_dir(&cb) {
            diff_dirs_recursive(
                &da,
                &db,
                &ca,
                &cb,
                format,
                new_file,
                brief,
                report_identical,
                ignore_case,
                ignore_all_space,
                ignore_blank_lines,
                fs,
                out,
                any_diff,
            );
        } else {
            let ta = fs.read_file(&ca).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
            let tb = fs.read_file(&cb).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
            let (d_out, differed) = diff_two_texts(
                &da,
                &db,
                &ta,
                &tb,
                format,
                brief,
                report_identical,
                ignore_case,
                ignore_all_space,
                ignore_blank_lines,
            );
            if differed {
                *any_diff = true;
            }
            out.push_str(&d_out);
        }
    }
}

fn cmd_diff(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut format = DiffFormat::Normal;
    let mut new_file = false;
    let mut brief = false;
    let mut report_identical = false;
    let mut ignore_case = false;
    let mut ignore_all_space = false;
    let mut ignore_blank_lines = false;
    let mut files = Vec::new();

    for a in args {
        match a.as_str() {
            "-u" | "--unified" => format = DiffFormat::Unified,
            "-c" | "--context" => format = DiffFormat::Context,
            "-e" | "--ed" => format = DiffFormat::Ed,
            "-n" | "--rcs" => format = DiffFormat::Rcs,
            "-N" | "--new-file" => new_file = true,
            "-q" | "--brief" => brief = true,
            "-s" | "--report-identical-files" => report_identical = true,
            "-i" | "--ignore-case" => ignore_case = true,
            "-w" | "-b" => ignore_all_space = true,
            "-B" | "--ignore-blank-lines" => ignore_blank_lines = true,
            "-r" | "--recursive" => {}
            _ if a.starts_with("-U") => format = DiffFormat::Unified,
            _ if a.starts_with("-C") => format = DiffFormat::Context,
            _ if a.starts_with('-') && a != "-" => {
                for ch in a[1..].chars() {
                    match ch {
                        'u' => format = DiffFormat::Unified,
                        'c' => format = DiffFormat::Context,
                        'e' => format = DiffFormat::Ed,
                        'n' => format = DiffFormat::Rcs,
                        'N' => new_file = true,
                        'q' => brief = true,
                        's' => report_identical = true,
                        'i' => ignore_case = true,
                        'w' | 'b' => ignore_all_space = true,
                        'B' => ignore_blank_lines = true,
                        _ => {}
                    }
                }
            }
            _ => files.push(a.clone()),
        }
    }

    if files.len() < 2 {
        return err_out("diff: missing operand\n", 2);
    }

    let full_a = resolve_posix_path(cwd, &files[0]);
    let full_b = resolve_posix_path(cwd, &files[1]);
    if files[0] != "-" && files[1] != "-" && fs.is_dir(&full_a) && fs.is_dir(&full_b) {
        let mut out = String::new();
        let mut any_diff = false;
        diff_dirs_recursive(
            &files[0],
            &files[1],
            &full_a,
            &full_b,
            format,
            new_file,
            brief,
            report_identical,
            ignore_case,
            ignore_all_space,
            ignore_blank_lines,
            fs,
            &mut out,
            &mut any_diff,
        );
        return BuiltinOutcome {
            stdout: out,
            stderr: String::new(),
            exit_code: if any_diff { 1 } else { 0 },
        };
    }

    let read_side = |name: &str| -> Result<String, String> {
        if name == "-" {
            return Ok(stdin.to_string());
        }
        let full = resolve_posix_path(cwd, name);
        let bytes = fs
            .read_file(&full)
            .map_err(|_| format!("diff: {name}: No such file or directory\n"))?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    };

    let text_a = match read_side(&files[0]) {
        Ok(t) => t,
        Err(e) => return err_out(&e, 2),
    };
    let text_b = match read_side(&files[1]) {
        Ok(t) => t,
        Err(e) => return err_out(&e, 2),
    };

    let (out, differed) = diff_two_texts(
        &files[0],
        &files[1],
        &text_a,
        &text_b,
        format,
        brief,
        report_identical,
        ignore_case,
        ignore_all_space,
        ignore_blank_lines,
    );

    BuiltinOutcome {
        stdout: out,
        stderr: String::new(),
        exit_code: if differed { 1 } else { 0 },
    }
}

enum DiffEdit {
    Keep(usize),
    Delete(usize),
    Insert(usize),
}

fn compute_lcs_edits(a: &[String], b: &[String]) -> Vec<DiffEdit> {
    let n = a.len();
    let m = b.len();
    let mut dp = vec![vec![0usize; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i][j] = if a[i] == b[j] {
                1 + dp[i + 1][j + 1]
            } else {
                dp[i + 1][j].max(dp[i][j + 1])
            };
        }
    }
    let mut edits = Vec::new();
    let mut i = 0usize;
    let mut j = 0usize;
    while i < n && j < m {
        if a[i] == b[j] {
            edits.push(DiffEdit::Keep(i));
            i += 1;
            j += 1;
        } else if dp[i + 1][j] >= dp[i][j + 1] {
            edits.push(DiffEdit::Delete(i));
            i += 1;
        } else {
            edits.push(DiffEdit::Insert(j));
            j += 1;
        }
    }
    while i < n {
        edits.push(DiffEdit::Delete(i));
        i += 1;
    }
    while j < m {
        edits.push(DiffEdit::Insert(j));
        j += 1;
    }
    edits
}

fn cmd_patch(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut strip = 0usize;
    let mut reverse = false;
    let mut dry_run = false;
    let mut backup = false;
    let mut input_file: Option<String> = None;
    let mut output_file: Option<String> = None;
    let mut reject_file: Option<String> = None;
    let mut target_file: Option<String> = None;

    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-R" || a == "--reverse" {
            reverse = true;
        } else if a == "--dry-run" {
            dry_run = true;
        } else if a == "-b" || a == "--backup" {
            backup = true;
        } else if let Some(p) = a.strip_prefix("-p") {
            if !p.is_empty() {
                strip = p.parse().unwrap_or(0);
            } else if i + 1 < args.len() {
                i += 1;
                strip = args[i].parse().unwrap_or(0);
            }
        } else if a == "-i" && i + 1 < args.len() {
            i += 1;
            input_file = Some(args[i].clone());
        } else if (a == "-o" || a == "--output") && i + 1 < args.len() {
            i += 1;
            output_file = Some(args[i].clone());
        } else if let Some(out) = a.strip_prefix("--output=") {
            output_file = Some(out.to_string());
        } else if (a == "-r" || a == "--reject-file") && i + 1 < args.len() {
            i += 1;
            reject_file = Some(args[i].clone());
        } else if let Some(rej) = a.strip_prefix("--reject-file=") {
            reject_file = Some(rej.to_string());
        } else if !a.starts_with('-') && target_file.is_none() {
            target_file = Some(a.clone());
        }
        i += 1;
    }

    let patch_text = if let Some(inf) = input_file {
        let full = resolve_posix_path(cwd, &inf);
        match fs.read_file(&full) {
            Ok(b) => String::from_utf8_lossy(&b).into_owned(),
            Err(_) => return err_out(&format!("patch: {inf}: No such file or directory\n"), 1),
        }
    } else {
        stdin.to_string()
    };

    match apply_unified_diff(
        &patch_text,
        target_file.as_deref(),
        output_file.as_deref(),
        reject_file.as_deref(),
        strip,
        reverse,
        dry_run,
        backup,
        cwd,
        fs,
    ) {
        Ok(msg) => ok_out(&msg),
        Err(e) => err_out(&format!("patch: {e}\n"), 1),
    }
}

#[allow(clippy::too_many_arguments)]
fn flush_patched_file(
    target: &str,
    output_override: Option<&str>,
    file_lines: &[String],
    no_trailing_newline: bool,
    delete_to_dev_null: bool,
    created_from_dev_null: bool,
    dry_run: bool,
    backup: bool,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> Result<(), String> {
    if dry_run {
        return Ok(());
    }
    let orig_full = resolve_posix_path(cwd, target);
    if backup && output_override.is_none() && let Ok(orig_bytes) = fs.read_file(&orig_full) {
        let _ = fs.write_file(&format!("{orig_full}.orig"), &orig_bytes);
    }
    let write_target = output_override.unwrap_or(target);
    let full = resolve_posix_path(cwd, write_target);
    if delete_to_dev_null && file_lines.is_empty() {
        let _ = fs.remove(&full, false);
        return Ok(());
    }
    let parent = crate::vfs::dirname_posix_path(&full);
    if !parent.is_empty() && parent != "/" && !fs.exists(&parent) {
        let _ = fs.mkdir_all(&parent);
        let _ = fs.chmod(&parent, 0o777);
    }
    let content = if file_lines.is_empty() {
        String::new()
    } else if no_trailing_newline {
        file_lines.join("\n")
    } else {
        format!("{}\n", file_lines.join("\n"))
    };
    fs.write_file(&full, content.as_bytes())?;
    if created_from_dev_null {
        let _ = fs.chmod(&full, 0o644);
    }
    Ok(())
}

fn parse_normal_diff_cmd(line: &str) -> Option<(char, usize)> {
    for op in ['a', 'c', 'd'] {
        if let Some((lhs, rhs)) = line.split_once(op)
            && !lhs.is_empty()
            && !rhs.is_empty()
            && lhs.chars().all(|c| c.is_ascii_digit() || c == ',')
            && rhs.chars().all(|c| c.is_ascii_digit() || c == ',')
        {
            let a_start = lhs
                .split(',')
                .next()
                .and_then(|s| s.parse::<usize>().ok())?;
            return Some((op, a_start));
        }
    }
    None
}

#[allow(clippy::too_many_arguments)]
fn apply_unified_diff(
    patch_text: &str,
    explicit_target: Option<&str>,
    output_override: Option<&str>,
    reject_file: Option<&str>,
    strip: usize,
    reverse: bool,
    dry_run: bool,
    backup: bool,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> Result<String, String> {
    if !patch_text.contains("@@ ")
        && let Some(target) = explicit_target
    {
        let p_lines: Vec<&str> = patch_text.lines().collect();
        let full = resolve_posix_path(cwd, target);
        let mut file_lines: Vec<String> = fs
            .read_file(&full)
            .map(|b| String::from_utf8_lossy(&b).lines().map(|s| s.to_string()).collect())
            .unwrap_or_default();
        let mut p_idx = 0usize;
        let mut applied_any = false;
        let mut offset: isize = 0;
        while p_idx < p_lines.len() {
            if let Some((op, a_start)) = parse_normal_diff_cmd(p_lines[p_idx]) {
                p_idx += 1;
                let mut old_lines = Vec::new();
                let mut new_lines = Vec::new();
                while p_idx < p_lines.len() && parse_normal_diff_cmd(p_lines[p_idx]).is_none() {
                    if let Some(r) = p_lines[p_idx].strip_prefix("< ") {
                        old_lines.push(r.to_string());
                    } else if let Some(a) = p_lines[p_idx].strip_prefix("> ") {
                        new_lines.push(a.to_string());
                    }
                    p_idx += 1;
                }
                if reverse {
                    std::mem::swap(&mut old_lines, &mut new_lines);
                }
                if !old_lines.is_empty() {
                    let hint = ((a_start.saturating_sub(1) as isize) + offset).max(0) as usize;
                    if let Some(pos) = find_subslice_pos(&file_lines, &old_lines, hint) {
                        let old_len = old_lines.len();
                        let new_len = new_lines.len();
                        file_lines.splice(pos..pos + old_len, new_lines);
                        offset += (new_len as isize) - (old_len as isize);
                    }
                } else if !new_lines.is_empty() {
                    let ins_pos = if op == 'a' && !reverse {
                        ((a_start as isize) + offset).clamp(0, file_lines.len() as isize) as usize
                    } else {
                        ((a_start.saturating_sub(1) as isize) + offset)
                            .clamp(0, file_lines.len() as isize) as usize
                    };
                    let new_len = new_lines.len();
                    file_lines.splice(ins_pos..ins_pos, new_lines);
                    offset += new_len as isize;
                }
                applied_any = true;
            } else {
                p_idx += 1;
            }
        }
        if applied_any {
            flush_patched_file(
                target,
                output_override,
                &file_lines,
                false,
                false,
                false,
                dry_run,
                backup,
                cwd,
                fs,
            )?;
            return Ok(format!("patching file {target}\n"));
        }
    }

    let mut current_target: Option<String> = None;
    let mut pending_minus_raw = String::new();
    let mut delete_to_dev_null = false;
    let mut created_from_dev_null = false;
    let mut no_trailing_newline = false;
    let mut file_lines: Vec<String> = Vec::new();
    let mut offset: isize = 0;

    let lines: Vec<&str> = patch_text.lines().collect();
    let mut idx = 0usize;

    while idx < lines.len() {
        let line = lines[idx];
        if let Some(minus_path) = line.strip_prefix("--- ") {
            if let Some(prev_target) = current_target.take() {
                flush_patched_file(
                    &prev_target,
                    output_override,
                    &file_lines,
                    no_trailing_newline,
                    delete_to_dev_null,
                    created_from_dev_null,
                    dry_run,
                    backup,
                    cwd,
                    fs,
                )?;
            }
            pending_minus_raw = minus_path.split_whitespace().next().unwrap_or("").to_string();
            idx += 1;
            continue;
        }
        if let Some(plus_path) = line.strip_prefix("+++ ") {
            let raw_plus = plus_path.split_whitespace().next().unwrap_or("");
            delete_to_dev_null = if reverse {
                pending_minus_raw == "/dev/null"
            } else {
                raw_plus == "/dev/null"
            };
            created_from_dev_null = if reverse {
                raw_plus == "/dev/null"
            } else {
                pending_minus_raw == "/dev/null"
            };
            let chosen_raw = if raw_plus == "/dev/null" {
                pending_minus_raw.as_str()
            } else {
                raw_plus
            };
            let stripped = strip_path_components(chosen_raw, strip);
            let target = explicit_target.unwrap_or(&stripped).to_string();
            let full = resolve_posix_path(cwd, &target);
            if let Ok(bytes) = fs.read_file(&full) {
                let s = String::from_utf8_lossy(&bytes);
                no_trailing_newline = !s.is_empty() && !s.ends_with('\n');
                file_lines = s.lines().map(|l| l.to_string()).collect();
            } else {
                no_trailing_newline = false;
                file_lines = Vec::new();
            }
            current_target = Some(target);
            offset = 0;
            idx += 1;
            continue;
        }

        if line.starts_with("@@ ") {
            if current_target.is_some() && file_lines.is_empty() && !created_from_dev_null {
                if let Some(t) = &current_target {
                    let full = resolve_posix_path(cwd, t);
                    if let Ok(bytes) = fs.read_file(&full) {
                        let s = String::from_utf8_lossy(&bytes);
                        no_trailing_newline = !s.is_empty() && !s.ends_with('\n');
                        file_lines = s.lines().map(|l| l.to_string()).collect();
                    }
                }
            }
            let (old_start, new_start) = parse_hunk_starts(line);
            let orig_start = if reverse { new_start } else { old_start };
            idx += 1;
            let mut hunk_old = Vec::new();
            let mut hunk_new = Vec::new();
            while idx < lines.len() {
                let hl = lines[idx];
                if hl.starts_with("@@ ") || hl.starts_with("--- ") || hl.starts_with("+++ ") {
                    break;
                }
                if hl.starts_with("\\ No newline at end of file") {
                    no_trailing_newline = true;
                    idx += 1;
                    continue;
                }
                if let Some(rem) = hl.strip_prefix('-') {
                    hunk_old.push(rem.to_string());
                } else if let Some(add) = hl.strip_prefix('+') {
                    hunk_new.push(add.to_string());
                } else if let Some(ctx) = hl.strip_prefix(' ') {
                    hunk_old.push(ctx.to_string());
                    hunk_new.push(ctx.to_string());
                } else if hl.is_empty() {
                    hunk_old.push(String::new());
                    hunk_new.push(String::new());
                }
                idx += 1;
            }

            if reverse {
                std::mem::swap(&mut hunk_old, &mut hunk_new);
            }
            let expected_pos = ((orig_start.saturating_sub(1) as isize) + offset).max(0) as usize;
            let pos = match find_subslice_pos(&file_lines, &hunk_old, expected_pos) {
                Some(p) => p,
                None => {
                    let rej_target = if let Some(r) = reject_file {
                        Some(r.to_string())
                    } else {
                        current_target.as_ref().map(|t| format!("{t}.rej"))
                    };
                    if let Some(rt) = rej_target
                        && !dry_run
                    {
                        let rej_full = resolve_posix_path(cwd, &rt);
                        let _ = fs.write_file(&rej_full, patch_text.as_bytes());
                    }
                    return Err("hunk failed to apply".to_string());
                }
            };
            let old_len = hunk_old.len();
            let new_len = hunk_new.len();
            file_lines.splice(pos..pos + old_len, hunk_new);
            offset += (new_len as isize) - (old_len as isize);
            continue;
        }
        idx += 1;
    }

    if let Some(target) = current_target {
        flush_patched_file(
            &target,
            output_override,
            &file_lines,
            no_trailing_newline,
            delete_to_dev_null,
            created_from_dev_null,
            dry_run,
            backup,
            cwd,
            fs,
        )?;
        Ok(format!("patching file {target}\n"))
    } else {
        Ok(String::new())
    }
}

fn strip_path_components(path: &str, strip: usize) -> String {
    if strip == 0 {
        return path.to_string();
    }
    let parts: Vec<&str> = path.split('/').collect();
    if strip >= parts.len() {
        parts.last().copied().unwrap_or(path).to_string()
    } else {
        parts[strip..].join("/")
    }
}

fn parse_hunk_starts(header: &str) -> (usize, usize) {
    let mut old_s = 1usize;
    let mut new_s = 1usize;
    for part in header.split_whitespace() {
        if let Some(rest) = part.strip_prefix('-') {
            let n: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(v) = n.parse() {
                old_s = v;
            }
        } else if let Some(rest) = part.strip_prefix('+') {
            let n: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(v) = n.parse() {
                new_s = v;
            }
        }
    }
    (old_s, new_s)
}

fn find_subslice_pos(hay: &[String], needle: &[String], hint: usize) -> Option<usize> {
    if needle.is_empty() {
        return Some(hint.min(hay.len()));
    }
    if needle.len() > hay.len() {
        return None;
    }
    let max_pos = hay.len() - needle.len();
    let start = hint.min(max_pos);
    for pos in start..=max_pos {
        if hay[pos..pos + needle.len()] == needle[..] {
            return Some(pos);
        }
    }
    for pos in 0..start {
        if hay[pos..pos + needle.len()] == needle[..] {
            return Some(pos);
        }
    }
    None
}

enum StagedPatchOp {
    Write(String, Vec<u8>),
    Delete(String),
}

fn cmd_apply_patch(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let patch_input = if !args.is_empty() {
        args.join("\n")
    } else {
        stdin.to_string()
    };
    if !patch_input.contains("*** Begin Patch") {
        return cmd_patch(args, stdin, cwd, fs);
    }

    let lines: Vec<&str> = patch_input.lines().collect();
    let mut idx = 0usize;
    let mut staged_ops: Vec<StagedPatchOp> = Vec::new();
    let mut summary_lines: Vec<String> = Vec::new();

    while idx < lines.len() {
        let line = lines[idx];
        if let Some(path) = line.strip_prefix("*** Add File: ") {
            let target = path.trim();
            idx += 1;
            let mut content_lines = Vec::new();
            while idx < lines.len() && !lines[idx].starts_with("*** ") {
                if let Some(added) = lines[idx].strip_prefix('+') {
                    content_lines.push(added);
                }
                idx += 1;
            }
            let full = resolve_posix_path(cwd, target);
            let payload = if content_lines.is_empty() {
                String::new()
            } else {
                format!("{}\n", content_lines.join("\n"))
            };
            staged_ops.push(StagedPatchOp::Write(full, payload.into_bytes()));
            summary_lines.push(format!("A {target}"));
            continue;
        }
        if let Some(path) = line.strip_prefix("*** Delete File: ") {
            let target = path.trim();
            let full = resolve_posix_path(cwd, target);
            if !fs.exists(&full) {
                return err_out(&format!("apply_patch: {target}: No such file\n"), 1);
            }
            staged_ops.push(StagedPatchOp::Delete(full));
            summary_lines.push(format!("D {target}"));
            idx += 1;
            continue;
        }
        if let Some(path) = line.strip_prefix("*** Update File: ") {
            let target = path.trim();
            let full = resolve_posix_path(cwd, target);
            let orig = match fs.read_file(&full) {
                Ok(b) => String::from_utf8_lossy(&b).into_owned(),
                Err(e) => return err_out(&format!("apply_patch: {}\n", e), 1),
            };
            let use_crlf = orig.contains("\r\n");
            let line_sep = if use_crlf { "\r\n" } else { "\n" };
            let mut file_lines: Vec<String> = orig.lines().map(|s| s.to_string()).collect();
            idx += 1;
            let mut move_to: Option<String> = None;
            if idx < lines.len() && let Some(mv) = lines[idx].strip_prefix("*** Move to: ") {
                move_to = Some(mv.trim().to_string());
                idx += 1;
            }
            while idx < lines.len()
                && (!lines[idx].starts_with("*** ") || lines[idx] == "*** End of File")
            {
                if lines[idx] == "*** End of File" {
                    idx += 1;
                    continue;
                }
                if lines[idx].starts_with("@@") {
                    let anchor = lines[idx].strip_prefix("@@").unwrap_or("").trim();
                    let mut hint = 0usize;
                    if !anchor.is_empty()
                        && let Some(apos) = file_lines
                            .iter()
                            .position(|l| l.trim() == anchor || l.contains(anchor))
                    {
                        hint = apos;
                    }
                    idx += 1;
                    let mut old_block = Vec::new();
                    let mut new_block = Vec::new();
                    while idx < lines.len()
                        && !lines[idx].starts_with("@@")
                        && !lines[idx].starts_with("*** ")
                    {
                        let hl = lines[idx];
                        if let Some(r) = hl.strip_prefix('-') {
                            old_block.push(r.to_string());
                        } else if let Some(a) = hl.strip_prefix('+') {
                            new_block.push(a.to_string());
                        } else if let Some(c) = hl.strip_prefix(' ') {
                            old_block.push(c.to_string());
                            new_block.push(c.to_string());
                        }
                        idx += 1;
                    }
                    if let Some(pos) = find_subslice_pos(&file_lines, &old_block, hint) {
                        file_lines.splice(pos..pos + old_block.len(), new_block);
                    } else {
                        return err_out("apply_patch: context mismatch\n", 1);
                    }
                } else {
                    idx += 1;
                }
            }
            let updated = format!("{}{line_sep}", file_lines.join(line_sep));
            if let Some(dest) = move_to {
                let dest_full = resolve_posix_path(cwd, &dest);
                if dest_full != full {
                    staged_ops.push(StagedPatchOp::Delete(full));
                }
                staged_ops.push(StagedPatchOp::Write(dest_full, updated.into_bytes()));
                summary_lines.push(format!("M {dest}"));
            } else {
                staged_ops.push(StagedPatchOp::Write(full, updated.into_bytes()));
                summary_lines.push(format!("M {target}"));
            }
            continue;
        }
        idx += 1;
    }

    for op in staged_ops {
        match op {
            StagedPatchOp::Write(full, bytes) => {
                let parent = crate::vfs::dirname_posix_path(&full);
                if !parent.is_empty() && parent != "/" {
                    let _ = fs.mkdir_all(&parent);
                }
                if let Err(e) = fs.write_file(&full, &bytes) {
                    return err_out(&format!("apply_patch: {e}\n"), 1);
                }
            }
            StagedPatchOp::Delete(full) => {
                let _ = fs.remove(&full, false);
            }
        }
    }

    let mut out = String::from("Success. Updated the following files:\n");
    for s in summary_lines {
        out.push_str(&format!("{s}\n"));
    }
    ok_out(&out)
}

fn cmd_cmp(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut silent = false;
    let mut verbose_list = false;
    let mut max_bytes: Option<usize> = None;
    let mut files = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-s" || a == "--quiet" || a == "--silent" {
            silent = true;
            i += 1;
        } else if a == "-l" || a == "--verbose" {
            verbose_list = true;
            i += 1;
        } else if (a == "-n" || a == "--bytes") && i + 1 < args.len() {
            max_bytes = args[i + 1].parse().ok();
            i += 2;
        } else if let Some(rest) = a.strip_prefix("--bytes=") {
            max_bytes = rest.parse().ok();
            i += 1;
        } else if let Some(rest) = a.strip_prefix("-n") && !rest.is_empty() {
            max_bytes = rest.parse().ok();
            i += 1;
        } else if !a.starts_with('-') || a == "-" {
            files.push(a.clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    if files.len() < 2 {
        return err_out("cmp: missing operand\n", 2);
    }
    let skip1 = files.get(2).and_then(|s| s.parse::<usize>().ok()).unwrap_or(0);
    let skip2 = files.get(3).and_then(|s| s.parse::<usize>().ok()).unwrap_or(0);
    let read_b = |f: &str| -> Result<Vec<u8>, String> {
        if f == "-" {
            return Ok(crate::vfs::stream_string_to_bytes(stdin));
        }
        let full = resolve_posix_path(cwd, f);
        fs.read_file(&full)
            .map_err(|_| format!("cmp: {f}: No such file or directory\n"))
    };
    let raw1 = match read_b(&files[0]) {
        Ok(b) => b,
        Err(e) => return err_out(&e, 2),
    };
    let raw2 = match read_b(&files[1]) {
        Ok(b) => b,
        Err(e) => return err_out(&e, 2),
    };
    let mut b1 = raw1[skip1.min(raw1.len())..].to_vec();
    let mut b2 = raw2[skip2.min(raw2.len())..].to_vec();
    if let Some(limit) = max_bytes {
        b1.truncate(limit);
        b2.truncate(limit);
    }
    if b1 == b2 {
        return ok_out("");
    }
    if silent {
        return BuiltinOutcome {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 1,
        };
    }
    let min_len = b1.len().min(b2.len());
    if verbose_list {
        let mut out = String::new();
        for i in 0..min_len {
            if b1[i] != b2[i] {
                out.push_str(&format!("{} {:o} {:o}\n", i + 1, b1[i], b2[i]));
            }
        }
        return BuiltinOutcome {
            stdout: out,
            stderr: String::new(),
            exit_code: 1,
        };
    }
    let mut diff_pos = min_len;
    let mut line_num = 1usize;
    for i in 0..min_len {
        if b1[i] != b2[i] {
            diff_pos = i;
            break;
        }
        if b1[i] == b'\n' {
            line_num += 1;
        }
    }
    BuiltinOutcome {
        stdout: format!(
            "{} {} differ: byte {}, line {}\n",
            files[0],
            files[1],
            diff_pos + 1,
            line_num
        ),
        stderr: String::new(),
        exit_code: 1,
    }
}

fn cmd_diff3(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut merge_mode = false;
    let mut ed_mode = false;
    let mut labels: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-m" || a == "--merge" {
            merge_mode = true;
            i += 1;
        } else if matches!(a.as_str(), "-e" | "-E" | "-x" | "-3") {
            ed_mode = true;
            i += 1;
        } else if (a == "-L" || a == "--label") && i + 1 < args.len() {
            labels.push(args[i + 1].clone());
            i += 2;
        } else if let Some(lbl) = a.strip_prefix("--label=") {
            labels.push(lbl.to_string());
            i += 1;
        } else if let Some(lbl) = a.strip_prefix("-L") && !lbl.is_empty() {
            labels.push(lbl.to_string());
            i += 1;
        } else if !a.starts_with('-') {
            files.push(a.clone());
            i += 1;
        } else {
            i += 1;
        }
    }
    if files.len() < 3 {
        return err_out("diff3: missing operand\n", 2);
    }
    let read_lines = |p: &str| -> Vec<String> {
        let full = resolve_posix_path(cwd, p);
        fs.read_file(&full)
            .map(|b| String::from_utf8_lossy(&b).lines().map(|l| l.to_string()).collect())
            .unwrap_or_default()
    };
    let ours = read_lines(&files[0]);
    let base = read_lines(&files[1]);
    let theirs = read_lines(&files[2]);
    let lbl0 = labels.first().unwrap_or(&files[0]);
    let lbl1 = labels.get(1).unwrap_or(&files[1]);
    let lbl2 = labels.get(2).unwrap_or(&files[2]);
    let max_len = ours.len().max(base.len()).max(theirs.len());
    let mut out = String::new();
    if !merge_mode && ed_mode {
        for i in (0..max_len).rev() {
            let b = base.get(i).map(|s| s.as_str()).unwrap_or("");
            let t = theirs.get(i).map(|s| s.as_str()).unwrap_or("");
            if t != b {
                out.push_str(&format!("{}c\n{t}\n.\n", i + 1));
            }
        }
        return ok_out(&out);
    }
    if !merge_mode {
        for i in 0..max_len {
            let o = ours.get(i).map(|s| s.as_str()).unwrap_or("");
            let b = base.get(i).map(|s| s.as_str()).unwrap_or("");
            let t = theirs.get(i).map(|s| s.as_str()).unwrap_or("");
            if o != b || t != b {
                out.push_str(&format!(
                    "====\n1:{}c\n  {o}\n2:{}c\n  {b}\n3:{}c\n  {t}\n",
                    i + 1,
                    i + 1,
                    i + 1
                ));
            }
        }
        return ok_out(&out);
    }
    let mut has_conflict = false;
    for i in 0..max_len {
        let o = ours.get(i).map(|s| s.as_str()).unwrap_or("");
        let b = base.get(i).map(|s| s.as_str()).unwrap_or("");
        let t = theirs.get(i).map(|s| s.as_str()).unwrap_or("");
        if o != b && t == b {
            out.push_str(&format!("{o}\n"));
        } else if t != b && o == b {
            out.push_str(&format!("{t}\n"));
        } else if o != b && t != b && o != t {
            has_conflict = true;
            out.push_str(&format!(
                "<<<<<<< {}\n{o}\n||||||| {}\n{b}\n=======\n{t}\n>>>>>>> {}\n",
                lbl0, lbl1, lbl2
            ));
        } else {
            out.push_str(&format!("{o}\n"));
        }
    }
    BuiltinOutcome {
        stdout: out,
        stderr: String::new(),
        exit_code: if has_conflict { 1 } else { 0 },
    }
}
